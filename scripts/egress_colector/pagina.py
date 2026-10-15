"""Citirea paginii Usage din Dashboard-ul Supabase prin Edge-ul EXISTENT de pe serverul AI (CDP doar pe loopback).

Reguli (Edge-ul e folosit si de canalul Copilot — taburi ChatGPT):
  * deschide un tab NOU (context.new_page()), citeste textul (inner_text("body")), INCHIDE doar tabul lui;
  * NU atinge, NU navigheaza, NU inchide celelalte taburi; NU inchide browserul (fara browser.close() — iesirea din
    sync_playwright() doar deconecteaza clientul, ca in cgpt_pw.py);
  * daca pagina cere logare / a fost redirectionata in alta parte → eroare clara, nimic scris.
Textul paginii e continut extern (al propriului cont Supabase): se parseaza ca DATE, nu se executa nimic din el.
"""
import re
import time
from urllib.parse import urlsplit

ORG = 'bfiqfdefpomddojbezjs'
URL_USAGE = f'https://supabase.com/dashboard/org/{ORG}/usage'
CDP_IMPLICIT = 'http://127.0.0.1:9333'


class EroareCitire(Exception):
    pass


class LogareNecesara(EroareCitire):
    """Profilul Edge nu mai e logat in Supabase: cineva trebuie sa se logheze manual in Edge-ul de pe 9333."""


def verifica_cdp(cdp):
    """Doar loopback (ca lansatorul run_paw: CDP 9333 care nu e pe loopback = refuz)."""
    if not re.fullmatch(r'http://(127\.0\.0\.1|localhost):\d{2,5}', cdp or ''):
        raise EroareCitire(f'adresa CDP refuzata (doar http://127.0.0.1:<port>): {cdp!r}')


def verifica_url(url):
    """Pagina finala trebuie sa fie exact pagina Usage a organizatiei; altfel (logare, alta org, eroare) → refuz."""
    u = urlsplit(url or '')
    cale = u.path.rstrip('/')
    if u.scheme == 'https' and u.hostname == 'supabase.com' and cale == f'/dashboard/org/{ORG}/usage':
        return
    if 'sign-in' in cale or 'sign-up' in cale or 'login' in cale:
        raise LogareNecesara('pagina Usage cere logare (profilul Edge de pe 9333 nu mai e logat in Supabase) — nimic scris')
    raise EroareCitire(f'pagina a fost redirectionata in afara paginii Usage ({u.hostname}{cale[:80]}) — nimic scris')


def citeste(parseaza, cdp=CDP_IMPLICIT, timp_max=75.0, pauza_ms=2000, playwright_factory=None, capteaza=None):
    """Deschide pagina Usage intr-un tab nou si asteapta o citire STABILA: doua parsari reusite consecutive, identice
    (la `pauza_ms` distanta) — nu se ia o valoare dintr-o pagina inca in incarcare. Intoarce (rezultat, url_final).
    `parseaza(text)` ridica o exceptie cu atributul `parsare = True` cand textul nu are (inca) cifrele.
    `capteaza(text)` (optional, doar diagnostic local: citeste --salveaza-text) primeste ultimul text citit."""
    verifica_cdp(cdp)
    if playwright_factory is None:
        try:
            from playwright.sync_api import sync_playwright as playwright_factory
        except ImportError:
            raise EroareCitire('playwright nu e instalat pentru acest python (pip install playwright)')
    with playwright_factory() as p:
        try:
            browser = p.chromium.connect_over_cdp(cdp, timeout=15000)
        except Exception as e:
            raise EroareCitire(f'nu ma pot conecta la Edge pe {cdp} (pornit cu --remote-debugging-port?): {type(e).__name__}')
        if not browser.contexts:
            raise EroareCitire('Edge nu are niciun context deschis (profilul logat lipseste)')
        pg = browser.contexts[0].new_page()   # tab NOU in profilul logat; celelalte taburi nu se ating
        try:
            try:
                pg.goto(URL_USAGE, wait_until='domcontentloaded', timeout=45000)
            except Exception as e:
                raise EroareCitire(f'pagina Usage nu s-a deschis: {type(e).__name__}')
            try:
                pg.wait_for_load_state('networkidle', timeout=20000)
            except Exception:
                pass   # dashboard-ul poate tine conexiuni deschise; stabilitatea o da verificarea de mai jos
            t0, anterior, ultima_eroare = time.monotonic(), None, 'pagina nu a aratat inca cifrele'
            while True:
                verifica_url(pg.url)
                try:
                    text = pg.inner_text('body', timeout=10000)
                except Exception as e:
                    raise EroareCitire(f'textul paginii nu s-a putut citi: {type(e).__name__}')
                if capteaza:
                    capteaza(text)
                try:
                    rez = parseaza(text)
                except Exception as e:
                    if not getattr(e, 'parsare', False):
                        raise
                    ultima_eroare, anterior = str(e), None
                else:
                    if anterior is not None and rez.cheie() == anterior.cheie():
                        return rez, pg.url
                    anterior = rez
                if time.monotonic() - t0 > timp_max:
                    raise EroareCitire(f'nicio citire stabila in {int(timp_max)} s — ultima problema: {ultima_eroare}')
                pg.wait_for_timeout(pauza_ms)
        finally:
            try:
                pg.close()   # doar tabul deschis aici
            except Exception:
                pass
