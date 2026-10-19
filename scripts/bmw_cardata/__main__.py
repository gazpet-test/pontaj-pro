"""python -B -m bmw_cardata <comanda> (PYTHONPATH=scripts).
Comenzi: login | refresh | setup | citeste | scrie | stare. Vezi scripts/bmw_cardata/README.md.
Coduri de iesire: 0 = OK, 1 = eroare, 2 = trebuie login din nou, 3 = limita de cereri atinsa (fara reincercare)."""
import argparse, os, re, sys
from datetime import datetime, timezone

from . import bd as B
from . import client as C
from . import valideaza as V


def _mascheaza(text):
    # plasa de siguranta: orice sir lung de tip token (>= 32 caractere base64/hex/JWT) nu ajunge pe ecran sau in jurnal
    return re.sub(r'[A-Za-z0-9_\-.~+/=]{32,}', '***', str(text))[:300]


def main(argv=None):
    for flux in (sys.stdout, sys.stderr):   # consola Windows (cp1252): un caracter neafisabil nu opreste rularea
        if hasattr(flux, 'reconfigure'):
            try:
                flux.reconfigure(errors='replace')
            except (OSError, ValueError):
                pass
    p = argparse.ArgumentParser(prog='bmw_cardata', description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--dir', help=f'directorul local cu client ID / tokenuri / stare (implicit BMW_CARDATA_DIR sau {C.DIR_IMPLICIT})')
    sub = p.add_subparsers(dest='cmd', required=True)
    sub.add_parser('login', help='Device Code Flow (o data, manual): afiseaza verification_uri + user_code, asteapta confirmarea')
    sub.add_parser('refresh', help='reinnoieste tokenul (refresh token-ul BMW e valabil 14 zile)')
    s = sub.add_parser('setup', help='VIN-ul PRIMARY + containerul cu cheile alese (o data)')
    s.add_argument('--vin', help='obligatoriu doar daca pe cont sunt mai multe vehicule PRIMARY')
    s.add_argument('--recreeaza', action='store_true', help='creeaza un container nou chiar daca exista unul (max 10/utilizator)')
    c = sub.add_parser('citeste', help='o citire telematica -> fisier local (basicData doar prima data)')
    c.add_argument('--scrie', action='store_true', help='dupa citire, scrie imediat in BD (comanda scrie)')
    w = sub.add_parser('scrie', help='scrie in Supabase (append-only, psql + pgpass) citirile locale nescrise')
    for x in (c, w):
        x.add_argument('--psql', default=B.PSQL_IMPLICIT, help=f'calea psql (implicit {B.PSQL_IMPLICIT})')
        x.add_argument('--pg-host', default=B.PG_IMPLICIT['host'])
        x.add_argument('--pg-port', default=B.PG_IMPLICIT['port'])
        x.add_argument('--pg-user', default=B.PG_IMPLICIT['user'])
        x.add_argument('--pg-db', default=B.PG_IMPLICIT['db'])
        x.add_argument('--pg-sslmode', default=B.PG_IMPLICIT['sslmode'])
    sub.add_parser('stare', help='doar citire locala: tokenuri (fara valori), setup, cereri azi, citiri nescrise')
    for x in (s, c, sub.choices['stare']):
        x.add_argument('--limita-zi', type=int, default=C.LIMITA_ZI_IMPLICIT,
                       help=f'limita locala de cereri CarData pe zi UTC (implicit {C.LIMITA_ZI_IMPLICIT}, max {C.LIMITA_ZI_MAX})')
    a = p.parse_args(argv)
    try:
        st = C.Stocare(a.dir)   # refuza un director in repo / intr-un arbore git (fara jurnal: nu scriem acolo nimic)
    except C.EroareBMW as e:
        print(f'EROARE: {_mascheaza(e)}', file=sys.stderr)
        return 1
    if a.cmd == 'stare':
        C.stare(st, C.Contor(st, a.limita_zi))
        return 0
    rc, mesaj = _ruleaza(a, st)
    if mesaj:
        print(mesaj, file=sys.stderr)
    _jurnal(st, a.cmd + (' --scrie' if getattr(a, 'scrie', False) else ''), rc, mesaj or 'OK')
    return rc


def _jurnal(st, cmd, rc, mesaj):
    """Un rand per rulare in <dir>/bmw_cardata_jurnal.log (Task Scheduler nu pastreaza iesirea): ora UTC | comanda | cod | mesaj
    mascat. Fara valori citite, fara locatie, fara tokenuri."""
    try:
        os.makedirs(st.dir, exist_ok=True)
        with open(os.path.join(st.dir, 'bmw_cardata_jurnal.log'), 'a', encoding='utf-8') as f:
            f.write(f'{datetime.now(timezone.utc).isoformat(timespec="seconds")} | {cmd} | {rc} | {_mascheaza(mesaj)}\n')
    except OSError:
        pass


def _ruleaza(a, st):
    try:
        with C.Blocare(st):
            http = C.Http()
            if a.cmd == 'login':
                C.login(st, http)
                print('login OK: tokenuri salvate local (valorile nu se afiseaza)')
            elif a.cmd == 'refresh':
                C.refresh(st, http)
                print('refresh OK: tokenuri reinnoite local')
            elif a.cmd == 'setup':
                C.setup(C.Api(st, http, C.Contor(st, a.limita_zi)), vin=a.vin, recreeaza=a.recreeaza)
            elif a.cmd in ('citeste', 'scrie'):
                pg = {'host': a.pg_host, 'port': a.pg_port, 'user': a.pg_user, 'db': a.pg_db, 'sslmode': a.pg_sslmode}
                if a.cmd == 'citeste':
                    C.citeste(C.Api(st, http, C.Contor(st, a.limita_zi)))
                if a.cmd == 'scrie' or a.scrie:
                    B.scrie(st, psql=a.psql, pg=pg)
        return 0, None
    except C.ReloginNecesar as e:
        return 2, f'LOGIN NECESAR: {_mascheaza(e)}'
    except C.LimitaAtinsa as e:
        return 3, f'LIMITA: {_mascheaza(e)}'
    except (C.EroareBMW, V.EroareValidare, B.EroareScriere) as e:
        return 1, f'EROARE: {_mascheaza(e)}'
    except Exception as e:  # neasteptat: tipul + mesaj mascat, fara traceback (poate trece prin variabile cu tokenuri)
        return 1, f'EROARE NEASTEPTATA ({type(e).__name__}): {_mascheaza(e)}'


if __name__ == '__main__':
    sys.exit(main())
