#!/usr/bin/env python3
"""Portal E1 r20: test static (fara PostgreSQL) pentru scripts/portal/porti_citire.sql.

  python3 scripts/portal/test_static_porti_citire.py

Verifica, pe textul fara comentarii si fara literali (siruri '...' si $tag$...$tag$):
  - exact o tranzactie: prima instructiune BEGIN READ ONLY, ultima ROLLBACK, intre ele doar SELECT / WITH ... SELECT
    si SET LOCAL pe lista alba (statement_timeout, lock_timeout, search_path);
  - niciun cuvant de scriere / DDL / control de tranzactie (INSERT, UPDATE, DELETE, MERGE, TRUNCATE, CREATE, ALTER,
    DROP, GRANT, REVOKE, COPY, CALL, DO, COMMIT, LOCK, ...), nicio functie cu efect (nextval, setval, set_config,
    pg_advisory_*, dblink, pg_read_file, query_to_xml, ...), nicio comanda psql (\\...);
  - nu citeste randuri din tabele de date: coada / raspunsurile pg_net, vault, auth apar doar in literali (to_regclass),
    iar cron.job.command / pg_proc.prosrc doar in predicate (~) sau in extragerea numelor public.*;
  - reparatiile r20: has_sequence_privilege doar in CASE WHEN c.relkind = 'S', has_table_privilege /
    has_any_column_privilege pe 'public' doar in CASE pe relkind, nicio ordonare pe pozitie cu COLLATE;
  - fiecare sectiune A-N apare exact o data;
  - r22 (sectiunea N, auditul tranzitiv): pg_proc.prosrc se citeste in afara predicatelor DOAR prin regexp_matches cu
    cele doua expresii ale grafului (REGEX_CORP: nume urmate de "(" si cuvinte); sectiunea are plafonul ei de timp.
  - r23 (sectiunea N, modelul precis): fara limita de adancime (inchidere cu UNION pe stari), apelul cere EXECUTE,
    functiile de trigger nu sunt radacini; sectiunile noi N_audit_radacina / N_audit_trigger_exclus;
  - r23: aceleasi reguli (doar citire, fara corpuri / comenzi afisate) pe scripts/portal/public21_apelanti.sql si
    public21_apelanti_pss.sql, cu sectiunile lor.
Mutantii (scriere, COMMIT, nextval, comanda afisata, interogarea C / A din r19, psql meta, DO, sectiune lipsa) trebuie
refuzati cu motivul exact. Rularea efectiva (PGlite, schema falsa): scripts/portal/porti_citire_pglite.mjs.
"""
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SQL = ROOT / "scripts/portal/porti_citire.sql"
SECTIUNI = ["A_scheme", "B_relatii", "C_secvente", "D_functii", "D_numar", "E_net_schema", "F_net_drepturi",
            "G_amprenta_net", "H_functii_net", "I_cron", "J_postgrest", "K_roluri_login", "L_triggere_net",
            "M_teren_executa", "N_audit_rezumat", "N_audit_nod", "N_audit_cale", "N_audit_nerezolvat",
            "N_audit_necunoscut", "N_audit_radacina", "N_audit_trigger_exclus"]
SQL_APELANTI = ROOT / "scripts/portal/public21_apelanti.sql"
SQL_APELANTI_PSS = ROOT / "scripts/portal/public21_apelanti_pss.sql"
SECTIUNI_APELANTI = ["P_clasificare", "P_apelanti_corp", "P_dependente", "P_cron", "P_pierde", "P_statistici"]
SECTIUNI_APELANTI_PSS = ["Q_statements"]
# r22 (sectiunea N): corpurile functiilor se citesc DOAR prin aceste doua expresii (nume urmate de "(" si cuvinte), ca
# sa construiasca graful; textul corpului nu iese in rezultat (iese doar numele rezolvate / necunoscute).
REGEX_CORP = {
    "'(?:([A-Za-z_][A-Za-z0-9_$]*|\"[^\"]+\")[[:space:]]*[.][[:space:]]*)?([A-Za-z_][A-Za-z0-9_$]*|\"[^\"]+\")[[:space:]]*[(]'",
    "'([A-Za-z_][A-Za-z0-9_$]*|\"[^\"]+\")'",
}
INTERZISE = ["INSERT", "UPDATE", "DELETE", "MERGE", "TRUNCATE", "CREATE", "ALTER", "DROP", "GRANT", "REVOKE", "COPY",
             "CALL", "DO", "COMMIT", "ABORT", "SAVEPOINT", "RELEASE", "PREPARE", "EXECUTE", "LOCK", "VACUUM", "ANALYZE",
             "CLUSTER", "REINDEX", "REFRESH", "NOTIFY", "LISTEN", "UNLISTEN", "DISCARD", "RESET", "IMPORT", "COMMENT",
             "SECURITY", "INTO", "DECLARE", "FETCH", "MOVE", "CHECKPOINT", "LOAD", "SHARE", "NOWAIT"]
FUNCTII_INTERZISE = ["nextval", "setval", "set_config", "pg_advisory_lock", "pg_advisory_xact_lock",
                     "pg_try_advisory_lock", "pg_try_advisory_xact_lock", "pg_advisory_lock_shared", "dblink",
                     "dblink_exec", "pg_read_file", "pg_read_binary_file", "pg_ls_dir", "pg_stat_file", "lo_import",
                     "lo_export", "lo_get", "pg_sleep", "pg_terminate_backend", "pg_cancel_backend", "pg_reload_conf",
                     "pg_notify", "pg_logical_emit_message", "query_to_xml", "query_to_xml_and_xmlschema",
                     "cursor_to_xml", "txid_current", "pg_current_xact_id", "pg_switch_wal", "pg_rotate_logfile"]
# identificatori care NU au voie sa apara in afara literalilor (ar insemna citire de randuri din tabele de date)
DATE_INTERZISE = ["http_request_queue", "_http_response", "vault", "decrypted_secrets", "auth", "users", "secrets"]
SET_PERMIS = re.compile(r"^SET LOCAL (statement_timeout|lock_timeout) = \$L\d+\$$|^SET LOCAL search_path = pg_catalog, pg_temp$")


def curata(text):
    """Scoate comentariile si inlocuieste literalii cu $L<n>$ (in ordine). Intoarce (text, literali)."""
    out, lit, i, n = [], [], 0, len(text)
    while i < n:
        c = text[i]
        if text.startswith("--", i):
            j = text.find("\n", i)
            i = n if j < 0 else j
        elif text.startswith("/*", i):
            j = text.find("*/", i + 2)
            if j < 0:
                raise ValueError("comentariu /* neinchis")
            i = j + 2
        elif c == "'":
            j = i + 1
            while True:
                k = text.find("'", j)
                if k < 0:
                    raise ValueError("literal '...' neinchis")
                if text.startswith("''", k):
                    j = k + 2
                    continue
                break
            lit.append(text[i:k + 1])
            out.append(f"$L{len(lit) - 1}$")
            i = k + 1
        elif c == "$":
            m = re.match(r"\$([A-Za-z_][A-Za-z0-9_]*)?\$", text[i:])
            if m:
                tag = m.group(0)
                k = text.find(tag, i + len(tag))
                if k < 0:
                    raise ValueError("literal $tag$ neinchis")
                lit.append(text[i:k + len(tag)])
                out.append(f"$L{len(lit) - 1}$")
                i = k + len(tag)
            else:
                out.append(c)
                i += 1
        else:
            out.append(c)
            i += 1
    return "".join(out), lit


def verifica(text, sectiuni=None):
    """Intoarce lista de motive de refuz (goala = acceptat)."""
    sectiuni = SECTIUNI if sectiuni is None else sectiuni
    motive = []
    text = text.replace("\r\n", "\n")
    try:
        t, lit = curata(text)
    except ValueError as e:
        return [f"parsare: {e}"]
    for linie in t.split("\n"):
        if linie.strip().startswith("\\"):
            motive.append(f"comanda psql: {linie.strip()[:40]}")
    instr = [re.sub(r"\s+", " ", s).strip() for s in t.split(";")]
    instr = [s for s in instr if s]
    if not instr or instr[0].upper() != "BEGIN READ ONLY":
        motive.append("prima instructiune nu e BEGIN READ ONLY")
    if not instr or instr[-1].upper() != "ROLLBACK":
        motive.append("ultima instructiune nu e ROLLBACK")
    for s in instr[1:-1]:
        u = s.upper()
        if u.startswith("SET "):
            if not SET_PERMIS.match(s):
                motive.append(f"SET nepermis: {s[:60]}")
        elif not (u.startswith("SELECT ") or u.startswith("WITH ")):
            motive.append(f"instructiune nepermisa: {s[:60]}")
        if u.startswith(("BEGIN", "START", "END", "ROLLBACK", "COMMIT", "ABORT", "SAVEPOINT", "RELEASE")):
            motive.append(f"control de tranzactie in mijloc: {s[:40]}")
    corp = " ".join(instr[1:-1])
    for w in INTERZISE:
        if re.search(rf"(?<![A-Za-z0-9_$]){w}(?![A-Za-z0-9_$])", corp, re.I):
            motive.append(f"cuvant interzis: {w}")
    for f in FUNCTII_INTERZISE:
        if re.search(rf"(?<![A-Za-z0-9_$.]){f}\s*\(", corp, re.I) or re.search(rf"\.{f}\s*\(", corp, re.I):
            motive.append(f"functie interzisa: {f}")
    for d in DATE_INTERZISE:
        if re.search(rf"(?<![A-Za-z0-9_$]){re.escape(d)}(?![A-Za-z0-9_$])", corp, re.I):
            motive.append(f"citire din tabel de date: {d}")
    # cron.job.command si pg_proc.prosrc: doar in predicate sau in extragerea numelor public.*
    for m in re.finditer(r"(?<![A-Za-z0-9_$])(\w+\.)?(command|prosrc|setconfig|rolconfig)(?![A-Za-z0-9_$])", corp):
        dupa = corp[m.end():m.end() + 40]
        inainte = corp[max(0, m.start() - 20):m.start()]
        col = m.group(2)
        if col in ("command", "prosrc") and re.match(r"\s*~", dupa):
            continue
        if col == "prosrc" and m.group(1) == "p." and inainte.endswith("regexp_matches(") \
                and re.match(r", \$L\d+\$, \$L\d+\$\)", dupa):
            a, b = (int(x) for x in re.match(r", \$L(\d+)\$, \$L(\d+)\$\)", dupa).groups())
            if lit[a] in REGEX_CORP and lit[b] == "'g'":
                continue
        if col == "command" and inainte.endswith("regexp_matches(") and re.match(r", \$L\d+\$, \$L\d+\$\)", dupa):
            idx = int(re.match(r", \$L(\d+)\$", dupa).group(1))
            if lit[idx] == "'public[.]([a-z_][a-z0-9_]*)'":
                continue
        if col == "setconfig" and m.group(1) == "rs." and inainte.endswith("unnest("):
            continue
        motive.append(f"coloana cu continut afisata / folosita liber: {m.group(0)}")
    # reparatiile r20, pe fiecare instructiune: apelul trebuie sa fie in ramura THEN a unui WHEN pe c.relkind inca
    # deschis (intre WHEN ... THEN si apel, fiecare CASE e inchis de END-ul lui: altfel apelul e in afara ramurii)
    def ramura_relkind(s, poz):
        whens = list(re.finditer(r"WHEN c\.relkind (IN \(([^)]*)\)|= (\$L\d+\$)) THEN", s[:poz]))
        if not whens:
            return None
        w = whens[-1]
        intre = s[w.end():poz]
        if len(re.findall(r"\bCASE\b", intre)) - len(re.findall(r"\bEND\b", intre)) < 0:
            return None
        lits = re.findall(r"\$L(\d+)\$", w.group(1))
        return {lit[int(x)] for x in lits}
    for s in instr[1:-1]:
        for m in re.finditer(r"has_sequence_privilege\(", s):
            r = ramura_relkind(s, m.start())
            if r is None:
                motive.append("has_sequence_privilege in afara CASE WHEN c.relkind = 'S'")
            elif r != {"'S'"}:
                motive.append("has_sequence_privilege in CASE pe alt relkind decat 'S'")
        for m in re.finditer(r"(has_table_privilege|has_any_column_privilege)\(\$L(\d+)\$, c\.oid", s):
            if lit[int(m.group(2))] != "'public'":
                continue
            r = ramura_relkind(s, m.start())
            if r is None or not r <= {"'r'", "'p'", "'v'", "'m'", "'f'"}:
                motive.append(f"{m.group(1)} pe 'public' in afara CASE pe relkind")
    if re.search(r"ORDER BY[^;]*?(?<![A-Za-z0-9_.$\"])\d+\s+COLLATE", corp, re.I):
        motive.append("ORDER BY pe pozitie cu COLLATE")
    for s in sectiuni:
        k = sum(1 for x in lit if x == f"'{s}'")
        if k != 1:
            motive.append(f"sectiunea {s} apare de {k} ori")
    return motive


class TestPortiCitire(unittest.TestCase):
    def setUp(self):
        self.text = SQL.read_text(encoding="utf-8")

    def test_real_acceptat(self):
        self.assertEqual(verifica(self.text), [])

    def test_real_crlf_acceptat(self):
        self.assertEqual(verifica(self.text.replace("\r\n", "\n").replace("\n", "\r\n")), [])

    def test_ascii(self):
        self.assertTrue(all(ord(ch) < 128 for ch in self.text), "caractere non-ASCII in script")

    def _refuz(self, text, motiv):
        m = verifica(text)
        self.assertTrue(any(motiv in x for x in m), f"asteptat refuz '{motiv}', primit {m}")

    def _inainte_de_rollback(self, bucata):
        k = self.text.rindex("ROLLBACK;")
        return self.text[:k] + bucata + "\n" + self.text[k:]

    def test_mutant_insert(self):
        self._refuz(self._inainte_de_rollback("INSERT INTO public.x VALUES (1);"), "instructiune nepermisa")

    def test_mutant_update_in_with(self):
        self._refuz(self._inainte_de_rollback("WITH u AS (UPDATE public.x SET a = 1 RETURNING 1) SELECT 1;"), "cuvant interzis: UPDATE")

    def test_mutant_commit_final(self):
        self._refuz(self.text.replace("ROLLBACK;", "COMMIT;"), "ultima instructiune nu e ROLLBACK")

    def test_mutant_commit_mijloc(self):
        self._refuz(self._inainte_de_rollback("COMMIT;"), "control de tranzactie in mijloc")

    def test_mutant_fara_read_only(self):
        self._refuz(self.text.replace("BEGIN READ ONLY;", "BEGIN;", 1), "prima instructiune nu e BEGIN READ ONLY")

    def test_mutant_nextval(self):
        self._refuz(self._inainte_de_rollback("SELECT nextval('public.diag_seq');"), "functie interzisa: nextval")

    def test_mutant_set_config(self):
        self._refuz(self._inainte_de_rollback("SELECT pg_catalog.set_config('role', 'x', true);"), "functie interzisa: set_config")

    def test_mutant_set_nepermis(self):
        self._refuz(self._inainte_de_rollback("SET LOCAL role = teren;"), "SET nepermis")

    def test_mutant_do(self):
        self._refuz(self._inainte_de_rollback("DO $x$ BEGIN PERFORM 1; END $x$;"), "instructiune nepermisa")

    def test_mutant_psql_meta(self):
        self._refuz(self._inainte_de_rollback("\\! echo x"), "comanda psql")

    def test_mutant_citire_coada(self):
        self._refuz(self._inainte_de_rollback("SELECT headers FROM net.http_request_queue;"), "citire din tabel de date: http_request_queue")

    def test_mutant_vault(self):
        self._refuz(self._inainte_de_rollback("SELECT count(*) FROM vault.decrypted_secrets;"), "citire din tabel de date: vault")

    def test_mutant_comanda_cron_afisata(self):
        self._refuz(self.text.replace("j.active AS activ,", "j.active AS activ, j.command,", 1), "coloana cu continut afisata")

    def test_mutant_prosrc_afisat(self):
        self._refuz(self.text.replace("p.prosecdef AS security_definer, pg_get_userbyid(p.proowner) AS proprietar,\n               p.prorettype",
                                      "p.prosrc, p.prosecdef AS security_definer, pg_get_userbyid(p.proowner) AS proprietar,\n               p.prorettype", 1),
                    "coloana cu continut afisata")

    def test_mutant_prosrc_alt_regex(self):
        # r22: corpul se poate citi doar cu cele doua expresii ale grafului; alta expresie (care ar scoate text) = refuz
        self._refuz(self.text.replace("regexp_matches(p.prosrc, '([A-Za-z_][A-Za-z0-9_$]*|\"[^\"]+\")', 'g')",
                                      "regexp_matches(p.prosrc, '(.*)', 'g')", 1), "coloana cu continut afisata")

    def test_mutant_prosrc_afisat_in_audit(self):
        self._refuz(self.text.replace("SELECT DISTINCT f.oid, CASE WHEN left(m.t[1], 1)",
                                      "SELECT DISTINCT f.oid, p.prosrc AS corp, CASE WHEN left(m.t[1], 1)", 1),
                    "coloana cu continut afisata")

    def test_sectiunea_n_are_plafon_propriu(self):
        t = curata(self.text.replace("\r\n", "\n"))[0]
        k = t.index("WITH RECURSIVE")
        self.assertRegex(t[:k].rstrip(), r"SET LOCAL statement_timeout = \$L\d+\$;$")

    def test_mutant_c_din_r19(self):
        # interogarea C din r19: has_sequence_privilege direct in WHERE (a picat pe productie pe un index)
        r19 = ("SELECT 'C_secvente' AS s FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace\n"
               " WHERE c.relkind = 'S' AND has_sequence_privilege('public', c.oid, 'USAGE,SELECT,UPDATE');")
        t = self.text.replace("'C_secvente'", "'C_vechi'")
        self._refuz(self._inainte_de_rollback(r19.replace("'C_secvente'", "'C_x'")) , "has_sequence_privilege in afara CASE")
        self._refuz(t, "sectiunea C_secvente apare de 0 ori")

    def test_mutant_case_alt_relkind(self):
        self._refuz(self.text.replace("CASE WHEN c.relkind = 'S' THEN has_sequence_privilege", "CASE WHEN c.relkind = 'i' THEN has_sequence_privilege", 1),
                    "CASE pe alt relkind")

    def test_mutant_table_priv_fara_case(self):
        self._refuz(self._inainte_de_rollback("SELECT 1 FROM pg_class c WHERE has_table_privilege('public', c.oid, 'SELECT');"),
                    "has_table_privilege pe 'public' in afara CASE")

    def test_mutant_a_din_r19(self):
        self._refuz(self.text.replace('ORDER BY n.nspname::text COLLATE "C";', 'ORDER BY 1 COLLATE "C";', 1), "ORDER BY pe pozitie cu COLLATE")

    def test_mutant_sectiune_dubla(self):
        self._refuz(self._inainte_de_rollback("SELECT 'I_cron' AS sectiune;"), "sectiunea I_cron apare de 2 ori")

    def test_mutant_literal_neinchis(self):
        self._refuz(self._inainte_de_rollback("SELECT 'x;"), "parsare")

    # r23: modelul precis al lui N
    def _n(self):
        t = self.text.replace("\r\n", "\n")
        return t[t.index("-- N (r23"):t.rindex("ROLLBACK;")]

    def test_n_fara_limita_de_adancime(self):
        n = curata(self._n())[0]
        self.assertNotIn("adancime_max", n)
        self.assertRegex(n, r"atins\(k, id, rol, op, net\) AS \(\s*SELECT r\.k, r\.id, r\.rol, r\.op, false FROM radacina r WHERE NOT r\.net\s*UNION\s*SELECT")

    def test_n_apelul_cere_execute_si_triggerele_nu_sunt_radacini(self):
        n = curata(self._n())[0]
        self.assertIn("JOIN exec x ON x.oid = g.oid WHERE NOT g.trigger_fn", " ".join(n.split()))
        self.assertIn("has_function_privilege((SELECT rol0 FROM par), f.oid, $L", " ".join(n.split()))
        self.assertRegex(" ".join(n.split()), r"AND NOT f\.trigger_fn AND NOT \(f\.schema = \$L\d+\$ AND f\.oid < 16384")

    def test_apelanti_acceptat(self):
        self.assertEqual(verifica(SQL_APELANTI.read_text(encoding="utf-8"), SECTIUNI_APELANTI), [])
        self.assertEqual(verifica(SQL_APELANTI_PSS.read_text(encoding="utf-8"), SECTIUNI_APELANTI_PSS), [])
        for f in (SQL_APELANTI, SQL_APELANTI_PSS):
            self.assertTrue(all(ord(ch) < 128 for ch in f.read_text(encoding="utf-8")), f.name)

    def test_apelanti_mutant_comanda_afisata(self):
        t = SQL_APELANTI.read_text(encoding="utf-8").replace("j.active AS activ,", "j.active AS activ, j.command,", 1)
        self.assertTrue(any("coloana cu continut afisata" in m for m in verifica(t, SECTIUNI_APELANTI)))

    def test_apelanti_mutant_order_by_pozitie(self):
        t = SQL_APELANTI.read_text(encoding="utf-8").replace('ORDER BY x.functie COLLATE "C", x.obiect COLLATE "C";',
                                                             'ORDER BY 2 COLLATE "C", 4 COLLATE "C";', 1)
        self.assertIn("ORDER BY pe pozitie cu COLLATE", verifica(t, SECTIUNI_APELANTI))

    def test_cuvinte_doar_in_literali_acceptate(self):
        # privilegiile 'INSERT,UPDATE,...' si to_regclass('net.http_request_queue') sunt in literali: acceptate
        self.assertEqual(verifica(self._inainte_de_rollback("SELECT 'UPDATE DELETE http_request_queue' AS z;")), [])


if __name__ == "__main__":
    r = unittest.main(exit=False, verbosity=1).result
    sys.exit(0 if r.wasSuccessful() else 1)
