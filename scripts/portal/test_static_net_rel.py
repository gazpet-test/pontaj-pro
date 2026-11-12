#!/usr/bin/env python3
"""Portal E1 r21 (varianta c): test static (fara PostgreSQL) pentru obiectele pg_net acceptate de poarta 18a.

  python3 scripts/portal/test_static_net_rel.py

Verifica:
  - O SINGURA definitie a amprentei (L19): textul dintre marcajele AMPRENTA_NET_REL din 18a (corpul lui
    public.fn_portal_net_rel_amprenta) = textul din sectiunea G a lui scripts/portal/porti_citire.sql (spatiile
    normalizate), fiecare marcaj exact o data; acelasi search_path (pg_catalog, pg_temp) in ambele.
  - O SINGURA lista acceptata: marcajul PORTAL_NET_REL_APROBAT exact o data in tot repo-ul (18a), cu exact cele 3 chei;
    r22: valorile sunt toate DE_COMPLETAT (necitite inca pe productie; $public_pre$ refuza cu
    PORTAL_NET_REL_LIST_NECOMPLETATA) sau toate md5 = PROD_R22 (scris de net_rel_completeaza.py din G-ul de productie);
    nicio valoare r21 (amprenta veche) nu are voie sa ramana; amprenta contine triggerele, politicile, DEFAULT-urile,
    regulile, constrangerile, indecsii si secventa (L15).
  - Poarta si preconditia folosesc ACELEASI doua predicate (fn_portal_teren_rel_drept, fn_portal_net_rel_acceptat);
    poarta nu mai are has_table_privilege / has_sequence_privilege proprii pe teren in bucla relatiilor.
  - Cei 4 helperi noi apar peste tot unde apar helperii existenti: verificarea „exista deja” din 18a, amprenta DDL din 18a
    si din revenirea 18a (liste identice), stergerile din revenirea 18a, lista alba 1b (fn_portal_1b_snapshot), controlul
    „functii ramase” din harness.
  - Postconditiile 18a / 19a si refuzurile revenirilor: IS DISTINCT FROM (NULL nu trece) si lista portilor in mesaj.
Mutantii (o litera schimbata in amprenta, o cheie in plus, un md5 schimbat, un helper uitat la revenire) sunt refuzati.
Rularea pe PostgreSQL (PGlite, schema falsa in forma productiei): scripts/portal/net_rel_pglite.mjs.
"""
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
M18 = ROOT / "supabase/migrations/20261118a_portal_teren_identitate.sql"
M19 = ROOT / "supabase/migrations/20261119a_portal_teren_provisioning.sql"
R18 = ROOT / "supabase/revenire/20261118a_portal_teren_identitate_ROLLBACK.sql"
R19 = ROOT / "supabase/revenire/20261119a_portal_teren_provisioning_ROLLBACK.sql"
CIT = ROOT / "scripts/portal/porti_citire.sql"
HARN = ROOT / "scripts/test_portal_e1.sh"

# r22: amprenta s-a completat (triggere, politici, DEFAULT-uri ...) => valorile citite pe productie pe 12.11 (forma r21)
# nu mai sunt valabile si nu au voie sa ramana in 18a. Lista din 18a e DE_COMPLETAT pana cand coordonatorul reruleaza
# porti_citire.sql pe productie; scripts/portal/net_rel_completeaza.py scrie ACELEASI valori (din G) in 18a si in PROD_R22.
CHEI = ["net._http_response", "net.http_request_queue", "net.http_request_queue_id_seq"]
NECOMPLETAT = "DE_COMPLETAT"
R21_VECHI = {
    "net._http_response": "af629f9c5992f34ede3bc889d2db669c",
    "net.http_request_queue": "e0e96a399d23c7eb05ca2216618e1b72",
    "net.http_request_queue_id_seq": "d7e907e6bf5f93c94b754f45839161d1",
}
PROD_R22 = {}  # NET_REL_PROD_R22 (productie, porti_citire.sql G, amprenta r22; gol = necitit inca)
HELPERI = ["fn_portal_net_rel_aprobat", "fn_portal_net_rel_amprenta", "fn_portal_net_rel_acceptat", "fn_portal_teren_rel_drept"]
SEMNATURI = ["public.fn_portal_net_rel_aprobat()", "public.fn_portal_net_rel_amprenta(oid)",
             "public.fn_portal_net_rel_acceptat(oid)", "public.fn_portal_teren_rel_drept(oid)"]
INCEPUT, SFARSIT = "-- AMPRENTA_NET_REL inceput", "-- AMPRENTA_NET_REL sfarsit"


def citeste(p):
    return p.read_text(encoding="utf-8").replace("\r\n", "\n")


def amprenta(text):
    """Textul dintre marcaje, cu spatiile normalizate; refuz daca un marcaj nu apare exact o data."""
    if text.count(INCEPUT) != 1 or text.count(SFARSIT) != 1:
        raise AssertionError("marcajele AMPRENTA_NET_REL trebuie sa apara exact o data")
    a = text.index(INCEPUT) + len(INCEPUT)
    b = text.index(SFARSIT)
    if not a < b:
        raise AssertionError("marcajele AMPRENTA_NET_REL sunt inversate")
    return " ".join(text[a:b].split())


def functie(text, nume):
    """Corpul CREATE FUNCTION public.<nume>(...) ... pana la urmatorul REVOKE ALL ON FUNCTION public.<nume>."""
    m = re.search(r"CREATE FUNCTION public\." + nume + r"\(.*?REVOKE ALL ON FUNCTION public\." + nume + r"\(", text, re.S)
    if not m:
        raise AssertionError(f"functia {nume} lipseste")
    return m.group(0)


def lista_aprobata(text):
    corp = functie(text, "fn_portal_net_rel_aprobat")
    m = re.findall(r"SELECT '(\{[^']*\})'::jsonb;", corp)
    if len(m) != 1:
        raise AssertionError("lista aprobata: cerut exact un literal jsonb")
    return dict(re.findall(r'"([^"]+)":"([^"]+)"', m[0])), m[0].count(":")


def lista_ddl(text):
    """Numele functiilor din amprenta DDL (WHERE n.nspname='public' AND p.proname IN (...))."""
    text = text[text.index("DO $critic$"):]
    m = re.search(r"WHERE n\.nspname='public' AND p\.proname IN \(('fn_auth_token_hook'.*?)\)\n", text, re.S)
    if not m:
        raise AssertionError("lista DDL lipseste")
    return sorted(re.findall(r"'([a-z_0-9]+)'", m.group(1)))


def verifica(m18, cit, r18, m19, r19, harn, prod=None):
    """Lista motivelor de refuz (goala = acceptat). prod = valorile de productie asteptate (implicit PROD_R22)."""
    prod = PROD_R22 if prod is None else prod
    mot = []
    try:
        if amprenta(m18) != amprenta(cit):
            mot.append("amprenta din 18a difera de sectiunea G din porti_citire.sql")
    except AssertionError as e:
        mot.append(str(e))
    try:
        corp = functie(m18, "fn_portal_net_rel_amprenta")
        if "SET search_path TO 'pg_catalog','pg_temp'" not in corp or INCEPUT not in corp:
            mot.append("fn_portal_net_rel_amprenta: search_path pg_catalog, pg_temp si marcajele in corp")
    except AssertionError as e:
        mot.append(str(e))
    if "SET LOCAL search_path = pg_catalog, pg_temp;" not in cit:
        mot.append("porti_citire.sql: search_path pg_catalog, pg_temp")
    # lista unica
    alte = [p for d in ("supabase", "scripts") for p in (ROOT / d).rglob("*.sql") if p.resolve() != M18.resolve()]
    n_marcaj = m18.count("PORTAL_NET_REL_APROBAT") + sum(citeste(p).count("PORTAL_NET_REL_APROBAT") for p in alte)
    if n_marcaj != 1 or m18.count("PORTAL_NET_REL_APROBAT") != 1:
        mot.append(f"marcajul PORTAL_NET_REL_APROBAT apare de {n_marcaj} ori (cerut exact o data, in 18a)")
    try:
        lista, nr_chei = lista_aprobata(m18)
        valori = [lista.get(k) for k in CHEI]
        if sorted(lista) != CHEI or nr_chei != len(CHEI):
            mot.append(f"lista aprobata: alte chei decat cele trei obiecte pg_net: {sorted(lista)}")
        elif all(v == NECOMPLETAT for v in valori):
            if prod:
                mot.append("lista aprobata DE_COMPLETAT, dar testul are valorile de productie (PROD_R22): lipeste-le in 18a")
        elif all(re.fullmatch(r"[0-9a-f]{32}", v or "") for v in valori):
            if lista != prod:
                mot.append(f"lista aprobata difera de productie (PROD_R22): {lista}")
        else:
            mot.append(f"lista aprobata completata pe jumatate: {lista}")
        if any(v in R21_VECHI.values() for v in valori) or any(v in m18 for v in R21_VECHI.values()):
            mot.append("valoare r21 (amprenta veche, fara triggere / politici / DEFAULT-uri) in 18a")
    except AssertionError as e:
        mot.append(str(e))
    if "PORTAL_NET_REL_LIST_NECOMPLETATA" not in m18[m18.find("DO $public_pre$"):m18.find("END $public_pre$;")]:
        mot.append("$public_pre$: refuzul listei necompletate lipseste")
    corp_amp = amprenta(m18) if m18.count(INCEPUT) == 1 and m18.count(SFARSIT) == 1 else ""
    for parte in ("pg_trigger", "pg_policy", "pg_attrdef", "pg_rewrite", "pg_constraint", "pg_index", "pg_sequence",
                  "pg_get_triggerdef", "pg_get_functiondef", "tgenabled", "attidentity", "attgenerated", "deptype"):
        if corp_amp and parte not in corp_amp:
            mot.append(f"amprenta: lipseste {parte} (L15: triggere, politici, DEFAULT-uri, secventa)")
    # aceleasi predicate in poarta si in preconditie
    try:
        poarta = functie(m18, "fn_portal_porti_lipsa")
        bucla = poarta[poarta.index("c.relkind IN ('r','p','v','m','f','S') ORDER BY c.oid LOOP"):poarta.index("END LOOP;", poarta.index("ORDER BY c.oid LOOP"))]
        if "CONTINUE WHEN public.fn_portal_teren_rel_drept(r.oid) IS NOT TRUE;" not in bucla \
                or "CONTINUE WHEN r.nspname='net' AND public.fn_portal_net_rel_acceptat(r.oid) IS TRUE;" not in bucla:
            mot.append("poarta: bucla relatiilor fara predicatele comune")
        if re.search(r"has_sequence_privilege\('teren'|has_table_privilege\('teren',r\.oid,CASE", bucla):
            mot.append("poarta: drept teren calculat a doua oara in bucla (L19)")
        if "teren PostgREST expune net" not in poarta:
            mot.append("poarta: verificarea PostgREST lipseste")
    except (AssertionError, ValueError) as e:
        mot.append(f"poarta: {e}")
    pre = m18[m18.find("DO $public_pre$"):m18.find("END $public_pre$;")]
    if "public.fn_portal_teren_rel_drept(c.oid) IS TRUE AND public.fn_portal_net_rel_acceptat(c.oid) IS NOT TRUE" not in pre \
            or "PORTAL_NET_REL_UNREVIEWED_OR_CHANGED" not in pre or "PORTAL_NET_REL_LIST_INVALID" not in pre:
        mot.append("$public_pre$: preconditia pe obiectele pg_net lipseste / nu foloseste predicatele comune")
    # helperii, peste tot
    try:
        exista = m18[m18.find("DO $pre$"):m18.find("END $pre$;")]
        for h in HELPERI:
            if f"'{h}'" not in exista:
                mot.append(f"18a $pre$: {h} lipseste din verificarea „exista deja”")
        d18, dr18 = lista_ddl(m18), lista_ddl(r18)
        if d18 != dr18:
            mot.append("amprenta DDL: listele din 18a si din revenirea 18a difera")
        for h in HELPERI:
            if h not in d18:
                mot.append(f"amprenta DDL 18a: {h} lipseste")
    except AssertionError as e:
        mot.append(str(e))
    for s in SEMNATURI:
        if f"DROP FUNCTION {s};" not in r18:
            mot.append(f"revenirea 18a nu sterge {s}")
        if f"'{s}'" not in m19[m19.find("CREATE FUNCTION public.fn_portal_1b_snapshot()"):m19.find("REVOKE ALL ON FUNCTION public.fn_portal_1b_snapshot()")]:
            mot.append(f"19a fn_portal_1b_snapshot: {s} lipseste din lista alba")
    linie = next((l for l in harn.split("\n") if "fail 'functions left'" in l), "")
    for h in HELPERI:
        if f"'{h}'" not in linie:
            mot.append(f"harness: {h} lipseste din controlul „functii ramase”")
    # postconditii / refuzuri cu lista, IS DISTINCT FROM
    for nume, t, cerute in (
            ("18a", m18, ["v_porti := public.fn_portal_porti_lipsa();",
                          "IF v_porti IS DISTINCT FROM '{}'::text[] THEN RAISE EXCEPTION 'PORTAL_POSTCONDITION_FAILED: % porti: %'"]),
            ("19a", m19, ["v_porti := public.fn_portal_porti_lipsa_1b();",
                          "IF v_porti IS DISTINCT FROM '{}'::text[] THEN RAISE EXCEPTION 'PORTAL_1B_POSTCONDITION: % porti: %'"]),
            ("revenire 18a", r18, ["v_porti := public.fn_portal_porti_lipsa();", "OR v_porti IS DISTINCT FROM '{}'::text[] THEN",
                                   "'PORTAL_ROLLBACK_NEW_DATA_OR_CONFIG: amprenta %; porti: %'"]),
            ("revenire 19a", r19, ["v_porti := public.fn_portal_porti_lipsa_1b();", "OR v_porti IS DISTINCT FROM '{}'::text[] THEN",
                                   "'PORTAL_1B_ROLLBACK_NEW_DATA_OR_CONFIG: amprenta %; porti: %'",
                                   "'PORTAL_1B_ROLLBACK_POSTCONDITION: porti 18a: %'"])):
        for c in cerute:
            if c not in t:
                mot.append(f"{nume}: lipseste {c[:70]}")
        if re.search(r"fn_portal_porti_lipsa(_1b)?\(\) <> '\{\}'", t):
            mot.append(f"{nume}: comparatie <> pe poarta (NULL ar trece)")
    return mot


class NetRel(unittest.TestCase):
    def setUp(self):
        self.f = [citeste(p) for p in (M18, CIT, R18, M19, R19, HARN)]

    def refuz(self, i, vechi, nou, motiv, count=1):
        f = list(self.f)
        self.assertIn(vechi, f[i], f"mutantul nu se aplica: {vechi[:60]}")
        f[i] = f[i].replace(vechi, nou, count)
        mot = verifica(*f)
        self.assertTrue(any(motiv in m for m in mot), f"asteptat refuz «{motiv}», primit {mot}")

    def test_real_acceptat(self):
        self.assertEqual(verifica(*self.f), [])

    def test_amprenta_un_caracter(self):
        self.refuz(1, "at.attnotnull, at.attacl::text, at.attidentity::text", "at.attnotnull, at.attidentity::text",
                   "amprenta din 18a difera")

    def test_amprenta_fara_politici_doar_in_citire(self):
        self.refuz(1, "FROM pg_policy po WHERE po.polrelid = c.oid),", "FROM pg_policy po WHERE false),",
                   "amprenta din 18a difera")

    def test_amprenta_marcaj_dublu(self):
        self.refuz(0, INCEPUT, INCEPUT + "\n" + INCEPUT, "exact o data")

    LISTA = ('{"net._http_response":"DE_COMPLETAT","net.http_request_queue":"DE_COMPLETAT",'
             '"net.http_request_queue_id_seq":"DE_COMPLETAT"}')

    def completata(self, valori):
        return '{' + ','.join(f'"{k}":"{v}"' for k, v in zip(CHEI, valori)) + '}'

    def test_cheie_in_plus(self):
        self.refuz(0, self.LISTA, self.LISTA[:-1] + ',"net.altul":"DE_COMPLETAT"}', "alte chei")

    def test_necompletat_cu_productie_in_test(self):
        mot = verifica(*self.f, prod=dict(zip(CHEI, ["a" * 32, "b" * 32, "c" * 32])))
        self.assertTrue(any("lipeste-le in 18a" in m for m in mot), mot)

    def test_completat_egal_productie_acceptat(self):
        prod = dict(zip(CHEI, ["a" * 32, "b" * 32, "c" * 32]))
        f = list(self.f)
        f[0] = f[0].replace(self.LISTA, self.completata(prod.values()))
        self.assertEqual(verifica(*f, prod=prod), [])

    def test_completat_diferit_de_productie(self):
        prod = dict(zip(CHEI, ["a" * 32, "b" * 32, "c" * 32]))
        f = list(self.f)
        f[0] = f[0].replace(self.LISTA, self.completata(["a" * 32, "b" * 32, "d" * 32]))
        self.assertTrue(any("difera de productie" in m for m in verifica(*f, prod=prod)))

    def test_completat_pe_jumatate(self):
        self.refuz(0, self.LISTA, self.completata(["a" * 32, NECOMPLETAT, NECOMPLETAT]), "pe jumatate")

    def test_valori_r21_refuzate(self):
        self.refuz(0, self.LISTA, self.completata(R21_VECHI.values()), "valoare r21")

    def test_fara_refuz_necompletat(self):
        self.refuz(0, "RAISE EXCEPTION 'PORTAL_NET_REL_LIST_NECOMPLETATA", "RAISE EXCEPTION 'PORTAL_NET_REL_LIST_X",
                   "refuzul listei necompletate")

    def test_amprenta_fara_triggere(self):
        # amprenta r21 (fara triggere / politici / DEFAULT-uri), in ambele fisiere: paritatea trece, completitudinea nu
        f = list(self.f)
        for i in (0, 1):
            a = f[i].index(INCEPUT) + len(INCEPUT)
            b = f[i].index(SFARSIT)
            f[i] = f[i][:a] + "\n jsonb_build_array(c.relkind::text, c.relacl::text)::text\n  " + f[i][b:]
        mot = verifica(*f)
        self.assertTrue(any("lipseste pg_trigger" in m for m in mot) and any("lipseste pg_policy" in m for m in mot)
                        and any("lipseste pg_attrdef" in m for m in mot), mot)

    def test_lista_a_doua_oara(self):
        self.refuz(0, "-- PORTAL_NET_REL_APROBAT:", "-- PORTAL_NET_REL_APROBAT PORTAL_NET_REL_APROBAT:", "apare de 2 ori")

    def test_poarta_fara_predicat(self):
        self.refuz(0, "CONTINUE WHEN r.nspname='net' AND public.fn_portal_net_rel_acceptat(r.oid) IS TRUE;",
                   "CONTINUE WHEN r.nspname='net';", "bucla relatiilor fara predicatele comune")

    def test_revenire_fara_drop(self):
        self.refuz(2, "  DROP FUNCTION public.fn_portal_teren_rel_drept(oid);\n", "", "nu sterge public.fn_portal_teren_rel_drept(oid)")

    def test_revenire_ddl_diferit(self):
        self.refuz(2, "'fn_portal_net_rel_acceptat',", "", "listele din 18a si din revenirea 18a difera")

    def test_1b_fara_helper(self):
        self.refuz(3, "'public.fn_portal_teren_rel_drept(oid)',", "", "fn_portal_1b_snapshot: public.fn_portal_teren_rel_drept(oid)")

    def test_postconditie_cu_diferit(self):
        self.refuz(0, "IF v_porti IS DISTINCT FROM '{}'::text[] THEN RAISE EXCEPTION 'PORTAL_POSTCONDITION_FAILED",
                   "IF v_porti <> '{}'::text[] THEN RAISE EXCEPTION 'PORTAL_POSTCONDITION_FAILED", "18a: lipseste")

    def test_search_path_diferit(self):
        self.refuz(0, "LANGUAGE sql STABLE SET search_path TO 'pg_catalog','pg_temp' AS $fn$",
                   "LANGUAGE sql STABLE SET search_path TO 'public','net','pg_temp' AS $fn$", "search_path pg_catalog")


class Completeaza(unittest.TestCase):
    """scripts/portal/net_rel_completeaza.py: citirea G (fara scriere) si refuzurile."""

    def setUp(self):
        import hashlib
        import importlib.util
        import tempfile
        spec = importlib.util.spec_from_file_location("nrc", ROOT / "scripts/portal/net_rel_completeaza.py")
        self.nrc = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.nrc)
        self.dir = tempfile.mkdtemp()
        self.md5 = lambda t: hashlib.md5(t.encode("utf-8")).hexdigest()

    def g(self, randuri, crlf=False):
        p = Path(self.dir) / f"g{len(list(Path(self.dir).iterdir()))}.out"
        text = "\n".join(["A_scheme|net|supabase_admin|f"] + randuri) + "\n"
        p.write_bytes(text.replace("\n", "\r\n" if crlf else "\n").encode("utf-8"))
        return p

    def rand(self, rel, text, md5=None):
        return f"G_amprenta_net|{rel}|{md5 or self.md5(text)}|{text}"

    def refuzat(self, cale, motiv):
        with self.assertRaises(SystemExit) as e:
            self.nrc.citeste_g(cale)
        self.assertEqual(e.exception.code, 1)

    def test_trei_obiecte_crlf_cu_bara_in_text(self):
        r = [self.rand(k, '["r", "a||b", "' + k + '"]') for k in CHEI]
        self.assertEqual(sorted(self.nrc.citeste_g(self.g(r, crlf=True))), CHEI)

    def test_al_patrulea_obiect(self):
        r = [self.rand(k, k) for k in CHEI] + [self.rand("net.portal_mutant", "x")]
        self.refuzat(self.g(r), "exact")

    def test_obiect_lipsa(self):
        self.refuzat(self.g([self.rand(k, k) for k in CHEI[:2]]), "exact")

    def test_md5_nu_corespunde_textului(self):
        r = [self.rand(k, k) for k in CHEI]
        r[1] = self.rand(CHEI[1], "trunchiat", md5=self.md5("altceva"))
        self.refuzat(self.g(r), "corespunde")

    def test_lista_din_18a_e_cea_cautata(self):
        self.assertEqual(citeste(M18).count(self.nrc.LISTA_GOALA), 1)
        self.assertEqual(len(self.nrc.MARCAJ_TEST.findall(TEST_SURSA.read_bytes())), 1)


TEST_SURSA = Path(__file__).resolve()

if __name__ == "__main__":
    unittest.main(verbosity=2)
