#!/usr/bin/env python3
"""Portal E1 r22: lipeste in 18a (si in testul static) cele trei amprente pg_net citite pe productie, sectiunea G.

Pentru coordonator, DUPA citirea read-only pe productie:
  psql -X -At -F '|' -v ON_ERROR_STOP=1 -f scripts/portal/porti_citire.sql <conexiunea> > porti_citire_prod.out
  python3 scripts/portal/net_rel_completeaza.py porti_citire_prod.out            # doar verifica si arata ce s-ar scrie
  python3 scripts/portal/net_rel_completeaza.py porti_citire_prod.out --scrie    # scrie 18a + testul static
  (harness-ul PG17 foloseste aceeasi citire: ... <iesire> --json <fisier.json>, fara sa scrie in repo)

Refuza (cod 1, nimic scris) daca: G nu are EXACT cele trei obiecte (un al patrulea obiect accesibil prin PUBLIC = decizie
noua, nu se lipeste), un md5 nu e hex de 32, md5-ul nu corespunde textului amprentei de pe aceeasi linie, 18a nu are lista
DE_COMPLETAT exact o data (deja completata = se schimba doar prin review), testul static nu are marcajul PROD_R22 gol.
Finalurile de linie ale fisierelor se pastreaza (CRLF / LF). La final tipareste sha256 al noului 18a (octetii din fisier
si forma LF din git): SHA-ul nou intra in review si in proba cu ROLLBACK.
"""
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
M18 = ROOT / "supabase/migrations/20261118a_portal_teren_identitate.sql"
TEST = ROOT / "scripts/portal/test_static_net_rel.py"
CHEI = ["net._http_response", "net.http_request_queue", "net.http_request_queue_id_seq"]
LISTA_GOALA = ('{"net._http_response":"DE_COMPLETAT","net.http_request_queue":"DE_COMPLETAT",'
               '"net.http_request_queue_id_seq":"DE_COMPLETAT"}')
MARCAJ_TEST = re.compile(rb"^PROD_R22 = \{\}  # NET_REL_PROD_R22 [^\r\n]*", re.M)


def refuz(motiv):
    print(f"REFUZ (nimic scris): {motiv}")
    sys.exit(1)


def citeste_g(cale):
    g = {}
    for linie in Path(cale).read_text(encoding="utf-8").replace("\r\n", "\n").split("\n"):
        if not linie.startswith("G_amprenta_net|"):
            continue
        parti = linie.split("|", 3)
        if len(parti) != 4:
            refuz(f"linie G nerecunoscuta (asteptat sectiune|relatie|md5|amprenta): {linie[:80]}")
        _, rel, md5, text = parti
        if rel in g:
            refuz(f"G: {rel} apare de doua ori")
        if not re.fullmatch(r"[0-9a-f]{32}", md5):
            refuz(f"G: md5 invalid pentru {rel}")
        if hashlib.md5(text.encode("utf-8")).hexdigest() != md5:
            refuz(f"G: md5-ul lui {rel} nu corespunde textului amprentei de pe aceeasi linie (iesire trunchiata / alterata?)")
        g[rel] = md5
    if sorted(g) != CHEI:
        refuz(f"G trebuie sa aiba exact {CHEI}; are {sorted(g)} (obiect nou / lipsa = decizie noua, nu se lipeste)")
    return g


def main():
    if len(sys.argv) == 4 and sys.argv[2] == "--json":
        # harness-ul PG17: aceleasi verificari, rezultatul ca JSON pentru copia de fixture (prepare_fixture.py --net-rel)
        Path(sys.argv[3]).write_text(json.dumps(citeste_g(sys.argv[1]), sort_keys=True), encoding="utf-8")
        return
    if len(sys.argv) not in (2, 3) or (len(sys.argv) == 3 and sys.argv[2] != "--scrie"):
        print(__doc__)
        sys.exit(2)
    g = citeste_g(sys.argv[1])
    lista = "{" + ",".join(f'"{k}":"{g[k]}"' for k in CHEI) + "}"
    m18 = M18.read_bytes()
    if m18.count(LISTA_GOALA.encode()) != 1:
        refuz("18a nu are lista DE_COMPLETAT exact o data (deja completata? se schimba doar prin review)")
    test = TEST.read_bytes()
    if len(MARCAJ_TEST.findall(test)) != 1:
        refuz("testul static nu are marcajul PROD_R22 gol exact o data")
    prod_py = "PROD_R22 = {" + ", ".join(f'"{k}": "{g[k]}"' for k in CHEI) + "}"
    nou18 = m18.replace(LISTA_GOALA.encode(), lista.encode(), 1)
    nou_test = MARCAJ_TEST.sub((prod_py + "  # NET_REL_PROD_R22 (productie, porti_citire.sql G, amprenta r22)").encode(), test, 1)
    print("18a:   " + lista)
    print("test:  " + prod_py)
    if len(sys.argv) == 3:
        M18.write_bytes(nou18)
        TEST.write_bytes(nou_test)
        print("SCRIS: 18a + scripts/portal/test_static_net_rel.py")
    else:
        print("(verificare; nimic scris: adauga --scrie)")
    print("sha256 18a (octetii fisierului): " + hashlib.sha256(nou18).hexdigest())
    print("sha256 18a (forma LF, ca in git): " + hashlib.sha256(nou18.replace(b"\r\n", b"\n")).hexdigest())


if __name__ == "__main__":
    main()
