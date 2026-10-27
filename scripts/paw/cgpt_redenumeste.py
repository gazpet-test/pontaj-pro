# Redenumeste o conversatie ChatGPT (Copilot) prin sesiunea deja logata din Edge CDP 9333 (doar loopback).
# Regula (Razvan 27.10.2026): orice conversatie Copilot noua primeste numele "Copilot - <rol> - ZZ.LL" (ziua deschiderii).
# Folosire: python -I -X utf8 scripts/paw/cgpt_redenumeste.py <id_conversatie_complet> "<titlu>"
# Nu citeste si nu afiseaza tokenul; il foloseste doar in pagina, pentru PATCH pe propria conversatie.
import re, sys
from playwright.sync_api import sync_playwright

def main():
    if len(sys.argv) != 3:
        sys.exit('folosire: cgpt_redenumeste.py <id_conversatie> "<titlu>"')
    cid, titlu = sys.argv[1].strip(), sys.argv[2].strip()
    if not re.fullmatch(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', cid):
        sys.exit('id invalid (UUID complet, litere mici)')
    if not re.fullmatch(r'Copilot - [A-Za-z0-9 ,._-]{2,60} - \d{2}\.\d{2}', titlu):
        sys.exit('titlu invalid: "Copilot - <rol> - ZZ.LL"')
    with sync_playwright() as p:
        b = p.chromium.connect_over_cdp('http://127.0.0.1:9333')
        pg = next((x for c in b.contexts for x in c.pages if 'chatgpt.com' in x.url), None)
        if pg is None:
            sys.exit('niciun tab chatgpt.com deschis in Edge 9333')
        st = pg.evaluate("""async ([cid, titlu]) => {
          const s = await (await fetch('/api/auth/session')).json();
          const h = {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + s.accessToken};
          const r = await fetch('/backend-api/conversation/' + cid, {method: 'PATCH', headers: h, body: JSON.stringify({title: titlu})});
          if (!r.ok) return 'PATCH ' + r.status;
          const g = await (await fetch('/backend-api/conversation/' + cid, {headers: h})).json();
          return g.title === titlu ? 'OK' : 'titlu necorespunzator: ' + g.title }""", [cid, titlu])
        for x in (x for c in b.contexts for x in c.pages if cid[:8] in x.url):
            x.reload(wait_until='domcontentloaded')
        print(cid[:8], titlu, st)
        sys.exit(0 if st == 'OK' else 1)

if __name__ == '__main__':
    main()
