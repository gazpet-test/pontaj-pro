"""python -B -m egress_colector <comanda>   (din folderul scripts al unei clone; sau PYTHONPATH=scripts)

Comenzi:
  citeste   citeste pagina Usage (tab nou in Edge-ul de pe 9333) si AFISEAZA cele 3 contoare + ciclul. Nu scrie nimic in BD.
            --arata-sql: afiseaza si SQL-ul exact pe care l-ar rula `scrie` (fara sa-l ruleze).
            Diagnostic local: --salveaza-text F (pastreaza textul paginii in F), --din-text F (parseaza F, fara browser).
  scrie     citeste pagina (ca mai sus) + INSERT un rand in public.supabase_usage_oficial (psql + pgpass, o tranzactie).
  stare     jurnalul local (ultimele rulari) + ultima citire din BD (tranzactie READ ONLY). --fara-bd = doar jurnalul.
Coduri de iesire: 0 OK · 1 eroare (nimic scris) · 2 pagina cere logare in Supabase · 3 alta rulare e in curs.
Vezi scripts/egress_colector/README.md."""
import argparse, os, re, sys, time
from datetime import datetime, timezone

from . import bd as B
from . import pagina as G
from . import parsare as P

DIR_IMPLICIT = os.path.join(os.environ.get('LOCALAPPDATA') or os.path.expanduser('~'), 'Gazpet', 'egress_colector')
JURNAL = 'egress_colector_jurnal.log'
LOCK_MAX_S = 600   # o rulare dureaza sub 3 minute; un lock mai vechi e ramas de la o rulare oprita brusc


class AltaRulare(Exception):
    pass


class Blocare:
    """O singura rulare odata (Task Scheduler + o rulare manuala): fisier creat exclusiv; unul mai vechi de LOCK_MAX_S
    e considerat ramas si se inlocuieste."""

    def __init__(self, director):
        self.cale = os.path.join(director, 'egress_colector.lock')
        self.director, self.al_meu = director, False

    def __enter__(self):
        os.makedirs(self.director, exist_ok=True)
        for _ in range(2):
            try:
                fd = os.open(self.cale, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            except FileExistsError:
                try:
                    if time.time() - os.path.getmtime(self.cale) > LOCK_MAX_S:
                        os.remove(self.cale)
                        continue
                except OSError:
                    pass
                raise AltaRulare(f'alta rulare e in curs ({self.cale})')
            os.write(fd, f'{os.getpid()} {datetime.now(timezone.utc).isoformat(timespec="seconds")}\n'.encode())
            os.close(fd)
            self.al_meu = True
            return self
        raise AltaRulare(f'lock-ul nu a putut fi luat ({self.cale})')

    def __exit__(self, *exc):
        if self.al_meu:
            try:
                os.remove(self.cale)
            except OSError:
                pass


def _curat(text, n=300):
    """O linie, fara caractere de control, taiata — pentru jurnal (mesajele pot contine fragmente din pagina)."""
    return re.sub(r'[\x00-\x1f\x7f]+', ' ', str(text))[:n]


def jurnal(director, cmd, rc, mesaj):
    """Un rand per rulare: ora UTC | comanda | cod | mesaj (Task Scheduler nu pastreaza iesirea). Fara secrete."""
    try:
        os.makedirs(director, exist_ok=True)
        with open(os.path.join(director, JURNAL), 'a', encoding='utf-8') as f:
            f.write(f'{datetime.now(timezone.utc).isoformat(timespec="seconds")} | {cmd} | {rc} | {_curat(mesaj)}\n')
    except OSError:
        pass


def rezumat(c):
    return (f'egress {P.gb(c.egress_bytes)} GB, cached {P.gb(c.cached_egress_bytes)} GB, storage {P.gb(c.storage_size_bytes)} GB, '
            f'ciclu {c.ciclu_start}..{c.ciclu_sfarsit}')


def afiseaza(c):
    print(f'  Egress         {P.gb(c.egress_bytes):>10} GB = {c.egress_bytes} bytes   (pagina: "{c.randuri["egress"]}")')
    print(f'  Cached Egress  {P.gb(c.cached_egress_bytes):>10} GB = {c.cached_egress_bytes} bytes   (pagina: "{c.randuri["cached_egress"]}")')
    print(f'  Storage Size   {P.gb(c.storage_size_bytes):>10} GB = {c.storage_size_bytes} bytes   (pagina: "{c.randuri["storage_size"]}")')
    print(f'  Ciclu          {c.ciclu_start} -> {c.ciclu_sfarsit} (sfarsit exclusiv)   (pagina: "{c.randuri["ciclu"]}")')
    print(f'  Separator zecimal dedus din pagina: {c.zecimal!r}')


def _citeste_live(a, azi):
    capteaza = None
    if a.cmd == 'citeste' and a.salveaza_text:
        def capteaza(text):
            with open(a.salveaza_text, 'w', encoding='utf-8') as f:
                f.write(text)
    c, _url = G.citeste(lambda text: P.parseaza(text, azi), cdp=a.cdp, capteaza=capteaza)
    return c


def _pg(a):
    return {'host': a.pg_host, 'port': a.pg_port, 'user': a.pg_user, 'db': a.pg_db, 'sslmode': a.pg_sslmode}


def ruleaza(a):
    """Intoarce (cod, mesaj pentru jurnal)."""
    if a.cmd == 'stare':
        return _stare(a)
    acum = datetime.now(timezone.utc)
    if a.cmd == 'citeste' and a.din_text:
        with open(a.din_text, encoding='utf-8') as f:
            c = P.parseaza(f.read(), acum.date())
        print(f'Parsare din fisier ({a.din_text}) — DOAR AFISARE, nimic scris:')
        afiseaza(c)
        return 0, None
    with Blocare(a.dir):
        c = _citeste_live(a, acum.date())
        citit_la = datetime.now(timezone.utc).replace(microsecond=0)
        if a.cmd == 'citeste':
            print(f'Pagina Usage Supabase (org {G.ORG}), citita {citit_la:%Y-%m-%d %H:%M:%S} UTC — DOAR AFISARE, nimic scris in BD:')
            afiseaza(c)
            if a.arata_sql:
                print('\n-- SQL-ul pe care l-ar rula `scrie` (NU s-a rulat):')
                print(B.construieste_sql(B.document(c, citit_la)))
            return 0, 'citit (fara scriere): ' + rezumat(c)
        id_, ts = B.scrie(c, citit_la, psql=a.psql, pg=_pg(a))
        msg = f'scris id {id_} ({ts}): ' + rezumat(c)
        print(msg)
        return 0, msg


def _stare(a):
    cale = os.path.join(a.dir, JURNAL)
    print(f'Jurnal local: {cale}')
    try:
        with open(cale, encoding='utf-8') as f:
            ultime = f.readlines()[-5:]
        for l in ultime:
            print('  ' + l.rstrip())
        if not ultime:
            print('  (gol)')
    except FileNotFoundError:
        print('  (nicio rulare inca)')
    if a.fara_bd:
        return 0, None
    s = B.stare(psql=a.psql, pg=_pg(a))
    print(f'BD (doar citire): {s["n"]} citiri in public.supabase_usage_oficial')
    if s['id'] != '-':
        print(f'  ultima: id {s["id"]}, {s["citit_la"]} UTC (acum {s["vechime_ore"]} h), ciclu {s["ciclu_start"]}..{s["ciclu_sfarsit"]}, '
              f'egress {P.gb(int(s["egress_bytes"]))} GB, cached {P.gb(int(s["cached_egress_bytes"]))} GB, '
              f'storage {s["storage_size_bytes"] if s["storage_size_bytes"] == "-" else P.gb(int(s["storage_size_bytes"])) + " GB"}')
    print(f'  monitorul oficial activat la {s["activat_la"]} UTC; alerta "colector oprit" porneste daca ultima citire '
          f'(sau, fara citiri, activarea) e mai veche de 26 h')
    return 0, None


def main(argv=None):
    for flux in (sys.stdout, sys.stderr):   # consola Windows (cp1252); sub pythonw fluxurile sunt None
        if flux is not None and hasattr(flux, 'reconfigure'):
            try:
                flux.reconfigure(errors='replace')
            except (OSError, ValueError):
                pass
    p = argparse.ArgumentParser(prog='egress_colector', description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--dir', default=os.environ.get('EGRESS_COLECTOR_DIR') or DIR_IMPLICIT,
                   help=f'jurnal + lock (implicit EGRESS_COLECTOR_DIR sau {DIR_IMPLICIT})')
    sub = p.add_subparsers(dest='cmd', required=True)
    c = sub.add_parser('citeste', help='citeste si afiseaza (fara BD)')
    c.add_argument('--arata-sql', action='store_true', help='afiseaza SQL-ul pe care l-ar rula scrie (fara sa-l ruleze)')
    c.add_argument('--salveaza-text', metavar='FISIER', help='diagnostic: pastreaza textul paginii local')
    c.add_argument('--din-text', metavar='FISIER', help='diagnostic: parseaza un text salvat, fara browser')
    w = sub.add_parser('scrie', help='citeste + INSERT un rand in public.supabase_usage_oficial')
    s = sub.add_parser('stare', help='jurnal local + ultima citire din BD (READ ONLY)')
    s.add_argument('--fara-bd', action='store_true', help='doar jurnalul local')
    for x in (c, w):
        x.add_argument('--cdp', default=G.CDP_IMPLICIT, help=f'Edge CDP, doar loopback (implicit {G.CDP_IMPLICIT})')
    for x in (w, s):
        x.add_argument('--psql', default=B.PSQL_IMPLICIT, help=f'calea psql (implicit {B.PSQL_IMPLICIT})')
        x.add_argument('--pg-host', default=B.PG_IMPLICIT['host'])
        x.add_argument('--pg-port', default=B.PG_IMPLICIT['port'])
        x.add_argument('--pg-user', default=B.PG_IMPLICIT['user'])
        x.add_argument('--pg-db', default=B.PG_IMPLICIT['db'])
        x.add_argument('--pg-sslmode', default=B.PG_IMPLICIT['sslmode'])
    a = p.parse_args(argv)
    try:
        rc, mesaj = ruleaza(a)
    except G.LogareNecesara as e:
        rc, mesaj = 2, f'LOGARE NECESARA: {e}'
    except AltaRulare as e:
        rc, mesaj = 3, f'ALTA RULARE: {e}'
    except (G.EroareCitire, P.EroareParsare, OSError) as e:
        rc, mesaj = 1, f'EROARE (nimic scris): {e}'
    except B.EroareScriere as e:   # inainte de psql sau psql cu rollback; exceptia: fara linia de rezultat (mesajul o spune)
        rc, mesaj = 1, f'EROARE BD: {e}'
    except Exception as e:   # neasteptat: tipul + mesajul, fara traceback
        rc, mesaj = 1, f'EROARE NEASTEPTATA ({type(e).__name__}): {e}'
    if rc and mesaj:
        print(_curat(mesaj, 600), file=sys.stderr)
    if a.cmd != 'stare' and not getattr(a, 'din_text', None) and mesaj:
        jurnal(a.dir, a.cmd, rc, mesaj)
    return rc


if __name__ == '__main__':
    sys.exit(main())
