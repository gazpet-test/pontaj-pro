# Paw v4.6.4d (r12, r13) - captura casetei de compunere Gemini, DOAR CITIRE (RUNBOOK pasul 5g2).
# r13: + `elemente` (atributele fiecarui element din caseta, fara continutul editorului) si `descrieri` (textul tintelor aria-describedby).
# r14: + `descrieri[].tinte` (atributele tintei + numarul de elemente din ea), `zona_analiza` (zona exacta a analizei, poate fi mai mare
#   decat input-area-v2) si `editor_atribute` (DOAR atributele elementelor din editor, fara text): calibrarea listei albe a atributelor.
# Nu face nicio actiune pe pagina: fara click / tastatura / scriere in ciorna / navigare. Operatorul lipeste de mana textul in
# ciorna (fara Enter), ruleaza scriptul, apoi goleste ciorna de mana. Iesirea (JSON ASCII pe stdout) arata clasele div-ului zonei de
# drop si atributele + continutul (innerHTML, taiat) fiecarui buton din zona - adica starea pe care paza o vede la `inainte_de_enter`.
# Textul ciornei NU se afiseaza (doar lungimea lui). Se conecteaza la Edge 9333 pe loopback, ca gemini_pw.py.
# Utilizare: python captura_caseta.py <eticheta>      (eticheta: [a-z0-9-]{1,32}, ex. gol / scurt / mediu / lung)
# ASCII only.
import json, re, sys
from playwright.sync_api import sync_playwright

JS = r"""() => {
  const zone = Array.from(document.querySelectorAll('input-area-v2'));
  const atr = el => { const a = {}; for (const x of el.attributes) a[x.name] = x.value.slice(0, 300); return a; };
  const ed = document.querySelector('div[role=textbox][contenteditable]');
  return {
    zone: zone.length,
    ciorna_lungime: ed ? (ed.innerText || '').trim().length : -1,
    zona: zone.map(z => ({tag: z.tagName.toLowerCase(), attrs: atr(z)})),
    div_drop: Array.from(document.querySelectorAll('input-area-v2 [xapfileselectordropzone]')).map(el => ({tag: el.tagName.toLowerCase(), attrs: atr(el)})),
    butoane: Array.from(document.querySelectorAll('input-area-v2 button')).map(el => ({attrs: atr(el), interior: el.innerHTML.slice(0, 3000)})),
    chip_uri: document.querySelectorAll('input-area-v2 uploader-file-preview').length,
    // r13: atributele TUTUROR elementelor din caseta (fara descendentii editorului = textul ciornei), ca listele inchise ale atributelor cu
    // text sa se completeze din pagina reala; si textul descrierilor (aria-describedby -> elementul indicat, de obicei containerul CDK)
    elemente: Array.from(document.querySelectorAll('input-area-v2, input-area-v2 *'))
      .filter(el => !(ed && ed !== el && ed.contains(el))).map(el => ({tag: el.tagName.toLowerCase(), attrs: atr(el)})),
    descrieri: Array.from(document.querySelectorAll('input-area-v2 [aria-describedby]')).map(el => ({
      tag: el.tagName.toLowerCase(), ref: el.getAttribute('aria-describedby').slice(0, 300),
      texte: el.getAttribute('aria-describedby').split(/\s+/).filter(Boolean).slice(0, 5).map(i => {
        const t = document.getElementById(i); return t ? (t.textContent || '').slice(0, 300) : null; }),
      // r14: atributele tintei si cate elemente are in ea (lista alba a tintei: doar id + role=tooltip, fara elemente)
      tinte: el.getAttribute('aria-describedby').split(/\s+/).filter(Boolean).slice(0, 5).map(i => {
        const t = document.getElementById(i); return t ? {tag: t.tagName.toLowerCase(), attrs: atr(t), copii: t.children.length} : null; })})),
    // r14: zona EXACTA a analizei (cel mai exterior stramos al editorului dintre selectorii ZONA din gemini_pw.py) si atributele ei + ale
    // descendentilor (tot fara continutul editorului); separat DOAR atributele (fara text) elementelor din editor (Quill: p / br)
    zona_analiza: (() => { let z = null; for (let p = ed && ed.parentElement; p; p = p.parentElement)
        if (p.matches('input-area-v2, input-container, .input-area-container, .input-area')) z = p;
      return z ? [z, ...z.querySelectorAll('*')].filter(el => !(ed && ed !== el && ed.contains(el)))
        .map(el => ({tag: el.tagName.toLowerCase(), attrs: atr(el)})) : null; })(),
    editor_atribute: ed ? Array.from(ed.querySelectorAll('*')).slice(0, 400).map(el => ({tag: el.tagName.toLowerCase(), attrs: atr(el)})) : null,
  };
}"""


def main():
    if len(sys.argv) != 2 or not re.fullmatch(r"[a-z0-9-]{1,32}", sys.argv[1]):
        print("CAPTURA_EROARE utilizare: captura_caseta.py <eticheta [a-z0-9-]{1,32}>")
        return 2
    with sync_playwright() as p:
        b = p.chromium.connect_over_cdp("http://127.0.0.1:9333")
        taburi = [x for c in b.contexts for x in c.pages if x.url.startswith("https://gemini.google.com/")]
        if len(taburi) != 1:
            print("CAPTURA_EROARE taburi Gemini: %d (trebuie exact 1)" % len(taburi))
            return 3
        rez = taburi[0].evaluate(JS)
    print(json.dumps({"eticheta": sys.argv[1], "captura": rez}, ensure_ascii=True, indent=1))
    print("CAPTURA_GATA " + sys.argv[1])
    return 0


if __name__ == "__main__":
    sys.exit(main())
