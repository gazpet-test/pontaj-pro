"""Portal E1 r19: verificarea INDEPENDENTA, fara PostgreSQL, a mesajului de DIAGNOSTIC al portilor 18a
(scripts/portal/dry_prod_e1.sh --diagnostic-porti), inainte de orice conexiune.

Utilizare: python3 scripts/portal/test_diag_porti_mesaj.py <5_mesaj.sql> <copia 18a> <sha256 aprobat> <plafon_ms> <diag_porti.sql>

Expected-ul vine din copia APROBATA (octetii ei + sha dat) si din blocul de diagnostic revizuit, nu din codul care taie
(L25). Taietura e verificata cu alta formulare decat scripts/portal/diag_porti_taie.py (care cauta marcajele):
  * copia din mesaj = copia aprobata din care s-a SCOS o singura bucata (stergere pura, nimic adaugat sau schimbat);
  * tot ce precede bucata se pastreaza octet cu octet (inclusiv DO $critic$ si pasii 1-4), bucata incepe cu o linie de
    comentariu urmata de postconditie (singura aparitie a PORTAL_POSTCONDITION_FAILED), iar dupa ea ramane DOAR
    „END $critic$;” si sfarsitul de linie;
Si ca mesajul NU poate fi confundat cu livrarea / nu poate comite:
  * forma psql: „SELECT $lm_<16 hex>$<M>$lm_<16 hex>$ AS diagnostic_porti_nu_e_livrare \\gexec” (alias diferit de
    livrare: verificatorul livrarii, scripts/test_livrare_mesaj_unic.py, il refuza);
  * prima instructiune BEGIN, ultima ROLLBACK, niciun alt control de tranzactie la nivel superior; cuvantul COMMIT nu
    apare nicaieri in cod (in afara comentariilor si literalilor), cu exceptia „ON COMMIT DROP” (tabelele temporare 18a);
    ROLLBACK o singura data; nicio scriere in supabase_migrations; fara $inreg$ / $verif$ (inregistrarea runnerului);
  * ordinea: prolog, verificarea un mesaj, antetul de diagnostic, 1_pre, copia, blocul de diagnostic, garda finala,
    ROLLBACK (consecutive la final); verificarea un mesaj: lungimea totala, felia rest, felia copiei taiate cu sha-ul ei;
  * blocul de diagnostic = exact fisierul revizuit, doar citire (fara cuvinte de scriere / DDL / SQL dinamic), un singur
    apel al functiei portii.
Iesire 0 = OK (tipareste DIAG_MESAJ_OK ...); 1 = ESEC (motivul pe stderr).
"""
import hashlib
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from test_livrare_mesaj_unic import instructiuni  # noqa: E402  (acelasi lexer ca verificatorul livrarii)


def esec(m):
    print(f"ESEC mesaj diagnostic: {m}", file=sys.stderr)
    sys.exit(1)


def fara_comentarii_literali(t):
    """Textul fara comentarii (-- si /* */) si fara literali '...' — scanare lexicala care trateaza si corpurile
    $tag$...$tag$ ca text (acolo sunt plpgsql, cu aceleasi reguli lexicale), ca sa vedem si cuvintele din corpuri."""
    i, n, out = 0, len(t), []
    while i < n:
        if t.startswith("--", i):
            j = t.find("\n", i)
            i = n if j < 0 else j
            continue
        if t.startswith("/*", i):
            adanc, j = 1, i + 2
            while adanc and j < n:
                if t.startswith("/*", j):
                    adanc, j = adanc + 1, j + 2
                elif t.startswith("*/", j):
                    adanc, j = adanc - 1, j + 2
                else:
                    j += 1
            i = j
            out.append(" ")
            continue
        if t[i] == "'":
            j = i + 1
            while j < n:
                if t[j] == "'":
                    if j + 1 < n and t[j + 1] == "'":
                        j += 2
                        continue
                    break
                j += 1
            i = j + 1
            out.append(" '' ")
            continue
        out.append(t[i])
        i += 1
    return "".join(out)


SCRIERI = r"\b(INSERT|UPDATE|DELETE|MERGE|TRUNCATE|CREATE|ALTER|DROP|GRANT|REVOKE|COMMIT|ROLLBACK|SAVEPOINT|EXECUTE|" \
          r"COPY|LOCK|SET|RESET|CALL|PERFORM|set_config|nextval|setval|pg_advisory\w*|dblink\w*|lo_\w+)\b"


def main(a):
    if len(a) != 6:
        print(__doc__, file=sys.stderr)
        return 2
    brut = open(a[1], "rb").read()
    C = open(a[2], "rb").read()
    sha, plafon = a[3], a[4]
    bloc = open(a[5], "rb").read()
    if hashlib.sha256(C).hexdigest() != sha:
        esec("sha-ul dat nu e al copiei 18a (proba nefunctionala)")
    m = re.fullmatch(rb"SELECT \$(lm_[0-9a-f]{16})\$(.*)\$\1\$ AS diagnostic_porti_nu_e_livrare \\gexec\n", brut, re.S)
    if not m:
        esec("5_mesaj.sql nu are forma SELECT $lm_<tag>$<M>$lm_<tag>$ AS diagnostic_porti_nu_e_livrare \\gexec")
    tag, M = m.group(1), m.group(2)
    if b"$" + tag + b"$" in M:
        esec("tag-ul exterior apare in M")
    if not M.endswith(b"\n"):
        esec("M trebuie sa se termine cu LF")
    t = M.decode("utf-8")
    st = instructiuni(t)
    txt = [s[2] for s in st]
    if txt[0] != "BEGIN" or txt[-1] != "ROLLBACK":
        esec(f"prima / ultima instructiune: {txt[0]!r} / {txt[-1]!r} (asteptat BEGIN / ROLLBACK)")
    ctl = [x for x in txt if re.match(r"(BEGIN|COMMIT|ROLLBACK|END|ABORT|START|SAVEPOINT|RELEASE|PREPARE)\b", x, re.I)]
    if ctl != ["BEGIN", "ROLLBACK"]:
        esec(f"control de tranzactie la nivel superior in afara de BEGIN / ROLLBACK: {ctl}")
    cod = fara_comentarii_literali(t)
    for k in re.finditer(r"\bCOMMIT\b", cod, re.I):
        if not re.search(r"\bON\s+$", cod[max(0, k.start() - 8):k.start()], re.I) or \
                not re.match(r"\s+DROP\b", cod[k.end():k.end() + 8], re.I):
            esec(f"COMMIT in cod (in afara de ON COMMIT DROP), langa: {cod[max(0, k.start() - 40):k.end() + 20]!r}")
    if len(re.findall(r"\bROLLBACK\b", cod, re.I)) != 1:
        esec("ROLLBACK trebuie sa apara o singura data in cod (instructiunea finala)")
    if re.search(r"\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM|MERGE\s+INTO|TRUNCATE(\s+TABLE)?|COPY)\s+(ONLY\s+)?"
                 r"\"?supabase_migrations\"?\s*\.", cod, re.I):
        esec("scriere in supabase_migrations (inregistrarea) in mesajul de diagnostic")
    if "$inreg$" in t or "$verif$" in t:
        esec("inregistrarea runnerului ($inreg$ / $verif$) in mesajul de diagnostic")
    pasi = ["BEGIN", "SET TRANSACTION ISOLATION LEVEL READ COMMITTED", "DO $prolog$", "DO $mesaj_unic$", "DO $diag_antet$",
            "SELECT pg_advisory_xact_lock(hashtext('gazpet.livrare_migrare'))", "DO $pre$",
            "SELECT set_config('gazpet.livrare_migrare'", "DO $critic$", "DO $diag_porti$", "SET CONSTRAINTS ALL IMMEDIATE",
            "SET LOCAL search_path = pg_catalog, pg_temp", "DO $plafon_fin$", "ROLLBACK"]
    poz = []
    for p in pasi:
        k = next((k for k, x in enumerate(txt) if x.startswith(p)), None)
        if k is None:
            esec(f"lipseste pasul {p!r}")
        poz.append(k)
    if poz != sorted(poz) or len(set(poz)) != len(poz):
        esec(f"ordinea pasilor: {list(zip(pasi, poz))}")
    if poz[2] != 4 or poz[3] != 5 or poz[4] != 6:
        esec("prologul primul dupa BEGIN (4 instructiuni), verificarea un mesaj imediat dupa el, apoi antetul de diagnostic")
    if poz[-4:] != list(range(len(txt) - 4, len(txt))) or poz[-5] != len(txt) - 5:
        esec("blocul de diagnostic, SET CONSTRAINTS, search_path, garda si ROLLBACK trebuie sa fie consecutive, la final")
    # verificarea „un mesaj”
    s_mu = st[poz[3]]
    corp = t[s_mu[0]:s_mu[1]]
    if "DIAGNOSTIC_PORTI" not in corp:
        esec("verificarea un mesaj nu poarta eticheta DIAGNOSTIC_PORTI")
    tot = re.findall(r"octet_length\(pg_catalog\.current_query\(\)\) IS DISTINCT FROM (\d{10})", corp)
    felii = re.findall(r"substring\(pg_catalog\.convert_to\(pg_catalog\.current_query\(\), 'UTF8'\), (\d{10}), (\d{10})\)\), "
                       r"'hex'\) IS DISTINCT FROM '([0-9a-f]{64})'", corp)
    if len(tot) != 1 or len(felii) != 2:
        esec(f"verificarea: {len(tot)} lungimi totale, {len(felii)} felii (asteptat 1 / 2: rest + copia taiata)")
    if int(tot[0]) != len(M):
        esec(f"lungimea totala ceruta {int(tot[0])} != {len(M)} octeti in M")
    sf = len(t[:s_mu[1]].encode("utf-8")) + 1
    rpoz, rlung, rsha = int(felii[0][0]), int(felii[0][1]), felii[0][2]
    if M[sf:sf + 1] != b"\n" or rpoz != sf + 2 or rpoz - 1 + rlung != len(M) or hashlib.sha256(M[rpoz - 1:]).hexdigest() != rsha:
        esec("felia rest (pozitie / lungime / sha)")
    p, l, s = int(felii[1][0]), int(felii[1][1]), felii[1][2]
    D = M[p - 1:p - 1 + l]
    if hashlib.sha256(D).hexdigest() != s or len(D) != l:
        esec("felia copiei: sha-ul din verificare nu e al octetilor de la pozitia ei")
    if not M.startswith(b"\n;\n" + bloc, p - 1 + l):
        esec("dupa copia taiata trebuie despartitorul LF ; LF si EXACT blocul de diagnostic revizuit")
    if M.count(bloc) != 1:
        esec("blocul de diagnostic trebuie sa apara o singura data")
    # copia taiata fata de copia aprobata: stergere pura a unei singure bucati, cu forma ceruta
    if not len(D) < len(C):
        esec("copia din mesaj nu e mai scurta decat copia aprobata (nu s-a taiat nimic)")
    k = 0
    while k < len(D) and D[k] == C[k]:
        k += 1
    sterse = len(C) - len(D)
    if D != C[:k] + C[k + sterse:]:
        esec("copia din mesaj nu e copia aprobata cu o singura bucata stearsa (s-a adaugat / schimbat ceva)")
    R, ramas = C[k:k + sterse], C[k + sterse:]
    if k == 0 or C[k - 1:k] != b"\n":
        esec("bucata stearsa nu incepe la inceput de linie")
    if ramas.rstrip(b"\r\n") != b"END $critic$;":
        esec(f"dupa bucata stearsa trebuie sa ramana doar END $critic$; (ramas {ramas[:60]!r})")
    linii = R.split(b"\n")
    # r21: postconditia = apelul portii intr-o variabila, apoi refuzul cu lista portilor in mesaj
    if len(linii) < 3 or not linii[0].strip().startswith(b"--") or \
            linii[1].strip() != b"v_porti := public.fn_portal_porti_lipsa();" or \
            not linii[2].strip().startswith(b"IF v_porti IS DISTINCT FROM '{}'::text[] THEN RAISE EXCEPTION 'PORTAL_POSTCONDITION_FAILED"):
        esec("bucata stearsa trebuie sa inceapa cu un comentariu urmat de postconditie (nimic din pasii 1-4)")
    if C.count(b"PORTAL_POSTCONDITION_FAILED") != 1 or b"PORTAL_POSTCONDITION_FAILED" in D:
        esec("postconditia trebuie sa fie doar in bucata stearsa")
    if C[:k].count(b"DO $critic$") != 1 or b"END $critic$" in C[:k]:
        esec("bucata stearsa nu e in corpul lui $critic$")
    # blocul de diagnostic: doar citire, un singur apel al portii
    tb = bloc.decode("utf-8")
    sb = instructiuni(tb)
    if len(sb) != 1 or not sb[0][2].startswith("DO $diag_porti$"):
        esec("blocul de diagnostic trebuie sa fie O instructiune DO $diag_porti$")
    cb = fara_comentarii_literali(tb)
    w = re.findall(SCRIERI, cb, re.I)
    if w:
        esec(f"blocul de diagnostic contine cuvinte de scriere / DDL / SQL dinamic: {sorted(set(x.upper() for x in w))}")
    if cb.count("fn_portal_porti_lipsa(") != 1 or "DIAG_PORTI_LIPSA" not in tb or "DIAG_PORTI 18a" not in tb:
        esec("blocul de diagnostic: un apel al functiei portii + liniile DIAG_PORTI 18a / DIAG_PORTI_LIPSA")
    # garda finala: aceleasi refuzuri ca la livrare, eticheta de diagnostic
    g = st[poz[-2]][2]
    for x in ("DIAGNOSTIC_PORTI", "PLAFON_AMANABIL", "PLAFON_CURSOR", "PLAFON_SCHIMBAT", "PLAFON_DEPASIT", "PLAFON_TIMP",
              f"pg_catalog.clock_timestamp() - pg_catalog.transaction_timestamp() > interval '{plafon} milliseconds'",
              f"IS DISTINCT FROM '{plafon}/session'"):
        if x not in g:
            esec(f"garda nu contine {x!r}")
    if "\\" in t.replace(D.decode("utf-8"), ""):
        esec("textul din afara copiei contine backslash")
    print(f"DIAG_MESAJ_OK: {len(M)} octeti, {len(txt)} instructiuni intr-un mesaj, BEGIN prima, ROLLBACK ultima, fara COMMIT "
          f"si fara inregistrare; copia = 18a aprobat fara {sterse} octeti (postconditia, pasul 5 din $critic$); "
          f"blocul de diagnostic doar citire")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
