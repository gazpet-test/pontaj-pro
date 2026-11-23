#!/usr/bin/env python3
"""Portal E1 r23 (varianta d): test static (fara PostgreSQL) pentru retragerea EXECUTE de la PUBLIC pe cele 21 de functii.

  python3 scripts/portal/test_static_public_d.py

Verifica pe artefactele de productie (18a + revenirea 18a):
  - clasificarea (PORTAL_PUBLIC_CLASIFICARE) = exact lista alba fn_portal_public_aprobat (21), fiecare o data;
  - functiile de trigger din clasificare = exact cele cu trigger_fn = t in citirea de productie (porti_citire.sql M,
    12.11.2026; expected independent de migrare, PROD_M_TRIGGER_FN mai jos); cele 3 apelabile primesc exact
    {authenticated,service_role};
  - GRANT-ul static (PORTAL_PUBLIC_D_GRANT) = exact functiile cu granturi, catre exact acele roluri; REVOKE-ul static
    (PORTAL_PUBLIC_D_REVOKE) = exact cele 21, FROM PUBLIC; ambele inaintea baseline-ului si inainte de $locks$;
  - preverificarea fara SQL dinamic, postconditia cu refuzul numit, randul 'grant_d:' in baseline (si exclus din bucla
    functiilor din poarta), poarta: in public doar cele doua functii ale portalului;
  - revenirea: REVOKE pe GRANT-urile din 'grant_d:' + GRANT ... TO PUBLIC pe lista alba, INAINTE de DROP-ul baseline-ului
    si al listei.
Mutantii (GRANT / REVOKE incomplete, o functie de trigger trecuta ca apelabila, alt rol, revenirea fara redarea PUBLIC,
poarta veche) trebuie refuzati cu motivul exact. Proba pe PostgreSQL: scripts/portal/public_d_pglite.mjs.
"""
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIG = ROOT / "supabase/migrations/20261118a_portal_teren_identitate.sql"
REV = ROOT / "supabase/revenire/20261118a_portal_teren_identitate_ROLLBACK.sql"
# porti_citire.sql M pe productie (12.11.2026, jurnalul citirii): coloana trigger_fn = f DOAR la acestea trei.
PROD_M_APELABILE = {"public.fn_claude_context_cleanup()", "public.fn_notif_lipsa_fisa_service(bigint)",
                    "public.get_istoric_importuri_evogps()"}
ROLURI = "{authenticated,service_role}"


def lista_alba(sql):
    m = re.search(r"CREATE FUNCTION public\.fn_portal_public_aprobat\(\) RETURNS text\[\].*?SELECT ARRAY\[(.*?)\]::text\[\]", sql, re.S)
    return re.findall(r"'([^']+)'", m.group(1)) if m else None


def clasificare(sql):
    m = re.search(r"CREATE TEMP TABLE portal_public_clasificare ON COMMIT DROP AS\n"
                  r"SELECT v\.semnatura, v\.granturi::text\[\] AS granturi FROM \(VALUES\n"
                  r" -- PORTAL_PUBLIC_CLASIFICARE:[^\n]*\n(.*?)\n\) v\(semnatura,granturi\);", sql, re.S)
    if not m:
        return None
    randuri = m.group(1).split("\n")
    bune = [re.match(r"^ \('([^']+)','(\{[a-z_,]*\})'\),?$", r) for r in randuri]
    if not all(bune):
        return None
    return [(b.group(1), b.group(2)) for b in bune]


def bloc(sql, marcaj):
    m = re.findall(r"-- " + marcaj + r" inceput[^\n]*\n(.*?)\n-- " + marcaj + r" sfarsit\n", sql, re.S)
    return m[0] if len(m) == 1 else None


def functii(text):
    return re.findall(r"public\.[a-z_][a-z0-9_]*\([a-z ]*\)", text)


def verifica(sql, rev):
    """Intoarce lista de motive de refuz (goala = acceptat)."""
    motive = []
    sql = sql.replace("\r\n", "\n")
    rev = rev.replace("\r\n", "\n")
    alba = lista_alba(sql)
    cl = clasificare(sql)
    if not alba or len(alba) != 21:
        return ["lista alba: nu are 21 de semnaturi"]
    if cl is None:
        return ["clasificarea lipseste sau are randuri in alta forma"]
    sem = [s for s, _ in cl]
    if sorted(sem) != sorted(alba) or len(set(sem)) != len(sem):
        motive.append("clasificarea != lista alba")
    apelabile = {s for s, g in cl if g != "{}"}
    if apelabile != PROD_M_APELABILE:
        motive.append(f"clasificarea != productia (porti_citire M): apelabile {sorted(apelabile)}")
    if any(g not in ("{}", ROLURI) for _, g in cl):
        motive.append("clasificarea: alte roluri decat {authenticated,service_role}")
    g = bloc(sql, "PORTAL_PUBLIC_D_GRANT")
    r = bloc(sql, "PORTAL_PUBLIC_D_REVOKE")
    if g is None or r is None:
        return motive + ["marcajele GRANT / REVOKE lipsesc sau sunt duble"]
    gm = re.fullmatch(r"GRANT EXECUTE ON FUNCTION (.*) TO authenticated, service_role;", " ".join(g.split()))
    if not gm or sorted(functii(gm.group(1))) != sorted(apelabile) or len(functii(gm.group(1))) != len(apelabile):
        motive.append("GRANT static != functiile cu granturi din clasificare (catre authenticated, service_role)")
    rm = re.fullmatch(r"REVOKE EXECUTE ON FUNCTION (.*) FROM PUBLIC;", " ".join(r.split()))
    if not rm or sorted(functii(rm.group(1))) != sorted(sem):
        motive.append("REVOKE static != cele 21 din clasificare (FROM PUBLIC)")
    # ordinea: preconditia -> preverificarea (d) -> GRANT -> REVOKE -> postconditia -> baseline -> $locks$
    ordine = ["END $public_pre$;", "DO $public_d_pre$", "-- PORTAL_PUBLIC_D_GRANT inceput", "-- PORTAL_PUBLIC_D_REVOKE inceput",
              "DO $public_d_post$", "ALTER TABLE public.portal_public_baseline DISABLE TRIGGER", "SELECT 'grant_d:'",
              "ALTER TABLE public.portal_public_baseline ENABLE TRIGGER", "DO $locks$"]
    poz = [sql.find(x) for x in ordine]
    if any(p < 0 for p in poz) or poz != sorted(poz):
        motive.append("ordinea pasilor (d) gresita sau un pas lipseste")
    pre = sql[sql.find("DO $public_d_pre$"):sql.find("END $public_d_pre$;")]
    if re.search(r"\bEXECUTE\s+format\b|\bEXECUTE\s+'", pre):
        motive.append("SQL dinamic in preverificarea (d)")
    for nevoie in ("PORTAL_PUBLIC_CLASIFICARE_INVALIDA", "PORTAL_PUBLIC_CLASIFICARE_SCHIMBATA", "(r.prorettype = 'trigger'::regtype) IS DISTINCT FROM (cardinality(r.granturi) = 0)"):
        if nevoie not in pre:
            motive.append(f"preverificarea (d) fara: {nevoie}")
    post = sql[sql.find("DO $public_d_post$"):sql.find("END $public_d_post$;")]
    for nevoie in ("PORTAL_PUBLIC_D_POSTCONDITIE", "a.grantee = 0", "has_function_privilege('teren', r.f, 'EXECUTE')",
                   "'public.fn_teren_eligibil(uuid)'::regprocedure, 'public.fn_portal_uid()'::regprocedure"):
        if nevoie not in post:
            motive.append(f"postconditia (d) fara: {nevoie}")
    poarta = sql[sql.find("CREATE FUNCTION public.fn_portal_porti_lipsa()"):sql.find("END $fn$;", sql.find("CREATE FUNCTION public.fn_portal_porti_lipsa()"))]
    if "AND (r.nspname = 'public' OR NOT EXISTS (SELECT FROM public.portal_public_baseline WHERE semnatura=v_signature))" not in poarta:
        motive.append("poarta: public nu e limitat la cele doua functii ale portalului")
    if "WHERE semnatura NOT LIKE 'rel:%' AND semnatura <> 'grant_d:' LOOP" not in poarta:
        motive.append("poarta: randul grant_d: nu e exclus din bucla functiilor")
    # revenirea: REVOKE pe grant_d:, GRANT ... TO PUBLIC pe lista alba, inainte de DROP baseline si DROP lista
    a = rev.find("WHERE b.semnatura = 'grant_d:' LOOP")
    b = rev.find("EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM %I'")
    c = rev.find("EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO PUBLIC'")
    d = rev.find("DROP TABLE public.portal_public_baseline;")
    e = rev.find("DROP FUNCTION public.fn_portal_public_aprobat();")
    f = rev.find("FROM unnest(public.fn_portal_public_aprobat())")
    if min(a, b, c, d, e, f) < 0 or not (a < b < f < c < d < e):
        motive.append("revenirea nu reda drepturile celor 21 (grant_d: retras, PUBLIC redat) inainte de DROP")
    return motive


class TestPublicD(unittest.TestCase):
    def setUp(self):
        self.sql = MIG.read_text(encoding="utf-8").replace("\r\n", "\n")
        self.rev = REV.read_text(encoding="utf-8").replace("\r\n", "\n")

    def _refuz(self, motiv, sql=None, rev=None):
        m = verifica(sql if sql is not None else self.sql, rev if rev is not None else self.rev)
        self.assertTrue(any(motiv in x for x in m), f"asteptat refuz '{motiv}', primit {m}")

    def _inlocuieste(self, text, a, b):
        self.assertEqual(text.count(a), 1, a)
        return text.replace(a, b)

    def test_real_acceptat(self):
        self.assertEqual(verifica(self.sql, self.rev), [])

    def test_real_crlf_acceptat(self):
        self.assertEqual(verifica(self.sql.replace("\n", "\r\n"), self.rev.replace("\n", "\r\n")), [])

    def test_clasificarea_are_18_si_3(self):
        cl = clasificare(self.sql)
        self.assertEqual(sum(1 for _, g in cl if g == "{}"), 18)
        self.assertEqual({s for s, g in cl if g == ROLURI}, PROD_M_APELABILE)

    def test_mutant_trigger_trecut_apelabil(self):
        self._refuz("clasificarea != productia", self._inlocuieste(
            self.sql, " ('public.set_updated_at()','{}')", " ('public.set_updated_at()','{authenticated,service_role}')"))

    def test_mutant_alt_rol(self):
        self._refuz("alte roluri", self._inlocuieste(
            self.sql, " ('public.get_istoric_importuri_evogps()','{authenticated,service_role}')",
            " ('public.get_istoric_importuri_evogps()','{anon,authenticated,service_role}')"))

    def test_mutant_grant_incomplet(self):
        self._refuz("GRANT static", self._inlocuieste(self.sql, "public.fn_notif_lipsa_fisa_service(bigint),\n  public.get_istoric",
                                                      "\n  public.get_istoric"))

    def test_mutant_grant_catre_anon(self):
        self._refuz("GRANT static", self._inlocuieste(self.sql, "public.get_istoric_importuri_evogps() TO authenticated, service_role;",
                                                      "public.get_istoric_importuri_evogps() TO anon, authenticated, service_role;"))

    def test_mutant_revoke_incomplet(self):
        self._refuz("REVOKE static", self._inlocuieste(self.sql, "public.update_stoc_achizitie(), public.update_stoc_rezervor() FROM PUBLIC;",
                                                       "public.update_stoc_achizitie() FROM PUBLIC;"))

    def test_mutant_revoke_de_la_anon(self):
        self._refuz("REVOKE static", self._inlocuieste(self.sql, "public.update_stoc_rezervor() FROM PUBLIC;",
                                                       "public.update_stoc_rezervor() FROM anon;"))

    def test_mutant_sql_dinamic_in_preverificare(self):
        self._refuz("SQL dinamic", self._inlocuieste(self.sql, "END $public_d_pre$;",
                                                     "  EXECUTE format('SELECT %s', 1);\nEND $public_d_pre$;"))

    def test_mutant_poarta_veche(self):
        self._refuz("poarta: public", self._inlocuieste(
            self.sql, "AND (r.nspname = 'public' OR NOT EXISTS (SELECT FROM public.portal_public_baseline WHERE semnatura=v_signature))",
            "AND NOT EXISTS (SELECT FROM public.portal_public_baseline WHERE semnatura=v_signature)"))

    def test_mutant_grant_d_in_bucla(self):
        self._refuz("grant_d: nu e exclus", self._inlocuieste(
            self.sql, "WHERE semnatura NOT LIKE 'rel:%' AND semnatura <> 'grant_d:' LOOP", "WHERE semnatura NOT LIKE 'rel:%' LOOP"))

    def test_mutant_ordine(self):
        # REVOKE dupa baseline (amprenta ar invata ACL-ul vechi) = refuz
        a = self.sql.index("-- PORTAL_PUBLIC_D_REVOKE inceput")
        b = self.sql.index("-- PORTAL_PUBLIC_D_REVOKE sfarsit\n") + len("-- PORTAL_PUBLIC_D_REVOKE sfarsit\n")
        bucata = self.sql[a:b]
        fara = self.sql[:a] + self.sql[b:]
        k = fara.index("DO $locks$")
        self._refuz("ordinea pasilor", fara[:k] + bucata + fara[k:])

    def test_mutant_revenire_fara_public(self):
        self._refuz("revenirea nu reda", rev=self._inlocuieste(
            self.rev, "EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO PUBLIC'", "EXECUTE format('SELECT %s'"))

    def test_mutant_revenire_dupa_drop(self):
        a = self.rev.index("  -- r23 (varianta d): drepturile celor 21 ca inainte de 18a")
        b = self.rev.index("  DROP TABLE public.portal_public_baseline;")
        bucata = self.rev[a:b]
        fara = self.rev[:a] + self.rev[b:]
        k = fara.index("  REVOKE teren FROM authenticator;")
        self._refuz("revenirea nu reda", rev=fara[:k] + bucata + fara[k:])


if __name__ == "__main__":
    r = unittest.main(exit=False, verbosity=1).result
    sys.exit(0 if r.wasSuccessful() else 1)
