"""Runda 14 a runnerului (portal r18): verificarea INDEPENDENTA a fisierului 5_mesaj.sql generat de
scripts/livrare_migrare.sh --plafon-tranzactie-ms (forma „un mesaj”), fara PostgreSQL.

Utilizare: python3 scripts/test_livrare_mesaj_unic.py <5_mesaj.sql> <artefactul.sql> <sha256 aprobat> <plafon_ms> [<final>]
  <final> = COMMIT (implicit) sau ROLLBACK (proba dry_prod_e1.sh).
Expected-ul vine din artefactul original (octetii lui) si din sha-ul dat, NU din codul runnerului (L25):
  * la nivel psql: fisierul e exact „SELECT $lm_<16 hex>$<M>$lm_<16 hex>$ AS livrare_mesaj_unic \\gexec” + LF, tag-ul nu
    apare in M ⇒ psql trimite O interogare, iar \\gexec trimite celula (M) ca UN mesaj;
  * in M (impartit ca serverul: „;” in afara citatelor / $tag$ / comentariilor): prima instructiune BEGIN, ultima
    <final>, niciun alt control de tranzactie la nivel superior in afara lor; ordinea pasilor runnerului;
  * verificarea „un mesaj” (DO $mesaj_unic$, imediat dupa prolog): lungimea totala = len(M); felia „rest” incepe exact
    dupa ea si tine pana la capat, cu sha256 corect; felia copiei = octetii artefactului, la pozitia lor, sha = aprobat.
Iesire 0 = OK (tipareste MESAJ_UNIC_OK ...); 1 = ESEC (motivul pe stderr).
L15 v2 (13.11.2026, docs/LIVRARE_L15_V2.md): optional, la final, „--l15 <md5_aprobat> <manifest.l15.tsv>” cere in jurul
copiei pasii AMPRENTA_GLOBALA: imediat dupa marcajul livrarii (set_config) si imediat inaintea copiei CREATE FUNCTION
pg_temp.ag_cat_<T> (corpul = blocul AG_CATALOG v1 din scripts/amprenta_globala_v1.sql, extras aici independent), CREATE TEMP
TABLE ag_ses_<T>, CREATE FUNCTION pg_temp.ag_inainte_<T> (cu md5-ul aprobat), DO $ag_pas_<T>$; imediat dupa inregistrare
(DO $verif$) CREATE FUNCTION pg_temp.ag_dupa_<T> (md5-ul aprobat), DO $ag_pas_<T>$ cu manifestul EXACT (octetii fisierului),
DROP-urile, apoi DO $lm_timp$. Acelasi <T> in toti pasii.
"""
import hashlib
import os
import re
import sys


def esec(m):
    print(f"ESEC mesaj unic: {m}", file=sys.stderr)
    sys.exit(1)


def instructiuni(t):
    """Imparte textul (bytes decodat UTF-8) in instructiuni de nivel superior: (start, sfarsit, text fara comentarii)."""
    i, n, start, rez, scos = 0, len(t), 0, [], []
    while i < n:
        c = t[i]
        if t.startswith("--", i):
            j = t.find("\n", i)
            j = n if j < 0 else j
            scos.append((i, j))
            i = j
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
            scos.append((i, j))
            i = j
            continue
        if c in "'\"":
            j = i + 1
            while j < n:
                if t[j] == c:
                    if j + 1 < n and t[j + 1] == c:
                        j += 2
                        continue
                    break
                j += 1
            i = j + 1
            continue
        if c == "$":
            m = re.match(r"\$([A-Za-z_][A-Za-z0-9_]*)?\$", t[i:])
            if m and not (i > 0 and (t[i - 1].isalnum() or t[i - 1] in "_$")):
                j = t.find(m.group(0), i + len(m.group(0)))
                if j < 0:
                    esec(f"dollar-quote {m.group(0)} neterminat")
                i = j + len(m.group(0))
                continue
        if c == ";":
            rez.append((start, i, curat(t, start, i, scos)))
            start, scos = i + 1, []
        i += 1
    rez.append((start, n, curat(t, start, n, scos)))
    return [r for r in rez if r[2]]


def curat(t, a, b, scos):
    """Textul [a, b) fara comentariile din `scos`, cu spatiile albe comprimate."""
    parti, k = [], a
    for x, y in scos:
        parti.append(t[k:x])
        k = y
    parti.append(t[k:b])
    return " ".join(" ".join(parti).split())


def bloc_catalog():
    """Blocul AG_CATALOG v1 din fisierul versionat (fara CR), intre marcajele de linie intreaga."""
    f = os.path.join(os.path.dirname(os.path.abspath(__file__)), "amprenta_globala_v1.sql")
    linii = open(f, "rb").read().decode("utf-8").replace("\r", "").split("\n")
    a, b = "-- >>> AG_CATALOG v1", "-- <<< AG_CATALOG v1"
    if linii.count(a) != 1 or linii.count(b) != 1:
        esec("marcajele AG_CATALOG v1 nu apar exact o data in amprenta_globala_v1.sql")
    return "\n".join(linii[linii.index(a) + 1:linii.index(b)])


def verifica_l15(t, st, copie_t, md5, manifest):
    """Pasii AMPRENTA_GLOBALA in jurul copiei (vezi docstring-ul modulului)."""
    if not re.fullmatch(r"[0-9a-f]{32}", md5):
        esec("--l15: md5 aprobat invalid")
    man = open(manifest, "rb").read().decode("utf-8")
    ct = t.find(copie_t)
    # prima instructiune a copiei = cea care contine pozitia ct (incepe la LF-ul de dupa „;”-ul pasului dinainte)
    i_cop = next((k for k, s in enumerate(st) if s[1] > ct), None)
    if ct < 0 or i_cop is None or i_cop < 5:
        esec("--l15: copia nu se gaseste in M")
    ina = st[i_cop - 5:i_cop]
    m = re.match(r"CREATE FUNCTION pg_temp\.ag_cat_([0-9a-f]{16})\(\)", ina[1][2])
    if not ina[0][2].startswith("SELECT set_config('gazpet.livrare_migrare'") or not m:
        esec("--l15: inaintea copiei trebuie: marcajul livrarii, apoi CREATE FUNCTION pg_temp.ag_cat_<T>()")
    T = m.group(1)
    if not (ina[2][2].startswith(f"CREATE TEMP TABLE ag_ses_{T} AS") and ina[3][2].startswith(f"CREATE FUNCTION pg_temp.ag_inainte_{T}()")
            and ina[4][2] == f"DO $ag_pas_{T}$ BEGIN PERFORM pg_temp.ag_inainte_{T}(); END $ag_pas_{T}$"):
        esec("--l15: pasul inainte nu e [ag_cat, ag_ses, ag_inainte, DO ag_pas] chiar inaintea copiei")
    corp = t[ina[1][0]:ina[1][1]]
    tag = f"$ag_cat_{T}$"
    if corp.count(tag) != 2 or corp.split(tag)[1].strip("\n") != bloc_catalog():
        esec("--l15: corpul ag_cat nu e EXACT blocul AG_CATALOG v1")
    if f"IS DISTINCT FROM '{md5}'" not in t[ina[3][0]:ina[3][1]]:
        esec("--l15: pasul inainte nu compara cu md5-ul aprobat")
    i_ver = next((k for k in range(i_cop, len(st)) if st[k][2].startswith("DO $verif$")), None)
    if i_ver is None or i_ver + 5 >= len(st):
        esec("--l15: inregistrarea (DO $verif$) lipseste dupa copie")
    d = st[i_ver + 1:i_ver + 7]
    if not (d[0][2].startswith(f"CREATE FUNCTION pg_temp.ag_dupa_{T}(p_manifest pg_catalog.text)")
            and d[1][2].startswith(f"DO $ag_pas_{T}$ BEGIN PERFORM pg_temp.ag_dupa_{T}($ag_man_{T}$")
            and d[2][2].startswith(f"DROP FUNCTION pg_temp.ag_dupa_{T}(pg_catalog.text), pg_temp.ag_inainte_{T}(), pg_temp.ag_cat_{T}()")
            and d[3][2].startswith(f"DROP TABLE pg_temp.ag_ses_{T},") and d[4][2] == f"DROP TABLE pg_temp.ag_man_{T}"
            and d[5][2].startswith("DO $lm_timp$")):
        esec("--l15: dupa inregistrare trebuie [ag_dupa, DO ag_pas(manifest), DROP-uri, DO lm_timp], acelasi tag")
    if f"IS DISTINCT FROM '{md5}'" not in t[d[0][0]:d[0][1]]:
        esec("--l15: pasul dupa nu verifica fotografia de dinainte cu md5-ul aprobat")
    pas = t[d[1][0]:d[1][1]]
    mt = f"$ag_man_{T}$"
    if pas.count(mt) != 2 or pas.split(mt)[1] != man.rstrip("\n"):
        esec("--l15: manifestul din mesaj nu e EXACT fisierul dat")
    return T


def main(a):
    l15 = None
    if len(a) >= 3 and a[-3] == "--l15":
        l15, a = (a[-2], a[-1]), a[:-3]
    if len(a) not in (5, 6):
        print(__doc__, file=sys.stderr)
        return 2
    mesaj, mig, sha, plafon = a[1], a[2], a[3], a[4]
    final = a[5] if len(a) == 6 else "COMMIT"
    brut = open(mesaj, "rb").read()
    copie = open(mig, "rb").read()
    if hashlib.sha256(copie).hexdigest() != sha:
        esec("sha-ul dat nu e al artefactului (proba nefunctionala)")
    m = re.fullmatch(rb"SELECT \$(lm_[0-9a-f]{16})\$(.*)\$\1\$ AS livrare_mesaj_unic \\gexec\n", brut, re.S)
    if not m:
        esec("5_mesaj.sql nu are forma SELECT $lm_<tag>$<M>$lm_<tag>$ AS livrare_mesaj_unic \\gexec")
    tag, M = m.group(1), m.group(2)
    if b"$" + tag + b"$" in M:
        esec("tag-ul exterior apare in M (literalul s-ar inchide mai devreme)")
    if not M.endswith(b"\n"):
        esec("M trebuie sa se termine cu LF")
    t = M.decode("utf-8")
    st = instructiuni(t)
    txt = [s[2] for s in st]
    if txt[0] != "BEGIN" or txt[-1] != final:
        esec(f"prima / ultima instructiune: {txt[0]!r} / {txt[-1]!r} (asteptat BEGIN / {final})")
    ctl = [x for x in txt if re.match(r"(BEGIN|COMMIT|ROLLBACK|END|ABORT|START|SAVEPOINT|RELEASE)\b", x, re.I)]
    if ctl != ["BEGIN", final]:
        esec(f"control de tranzactie la nivel superior in afara de BEGIN / {final}: {ctl}")
    # ordinea pasilor runnerului (prima aparitie a fiecaruia)
    pasi = ["BEGIN", "SET TRANSACTION ISOLATION LEVEL READ COMMITTED", "DO $prolog$", "DO $mesaj_unic$",
            "SELECT pg_advisory_xact_lock(hashtext('gazpet.livrare_migrare'))", "DO $pre$",
            "SELECT set_config('gazpet.livrare_migrare'", "DO $inreg$", "INSERT INTO supabase_migrations.schema_migrations",
            "DO $verif$", "DO $lm_timp$", "SET CONSTRAINTS ALL IMMEDIATE", "SET LOCAL search_path = pg_catalog, pg_temp",
            "DO $plafon_fin$", final]
    poz = []
    for p in pasi:
        k = next((k for k, x in enumerate(txt) if x.startswith(p)), None)
        if k is None:
            esec(f"lipseste pasul {p!r}")
        poz.append(k)
    if poz != sorted(poz) or len(set(poz)) != len(poz):
        esec(f"ordinea pasilor: {list(zip(pasi, poz))}")
    if poz[3] != poz[2] + 1 or poz[2] != 4:
        esec("prologul trebuie sa fie primul dupa BEGIN (SET TRANSACTION + 2 SET LOCAL + DO), verificarea imediat dupa el")
    if poz[-1] != poz[-2] + 1 or poz[-2] != poz[-3] + 1 or poz[-3] != poz[-4] + 1:
        esec(f"SET CONSTRAINTS, search_path, garda si {final} trebuie sa fie consecutive, la final")
    # copia: exact o data, urmata de despartitor, inaintea inregistrarii
    k = M.find(copie)
    if k < 0 or M.count(copie) != 2:
        esec(f"octetii artefactului trebuie sa apara de 2 ori in M (corpul + inregistrarea), apar de {M.count(copie)} ori")
    if not M.startswith(b"\n;\n", k + len(copie)):
        esec("dupa copie trebuie despartitorul LF ; LF")
    # verificarea „un mesaj”
    s_mu = next(s for s in st if s[2].startswith("DO $mesaj_unic$"))
    corp = t[s_mu[0]:s_mu[1]]
    tot = re.findall(r"octet_length\(pg_catalog\.current_query\(\)\) IS DISTINCT FROM (\d{10})", corp)
    felii = re.findall(r"substring\(pg_catalog\.convert_to\(pg_catalog\.current_query\(\), 'UTF8'\), (\d{10}), (\d{10})\)\), "
                       r"'hex'\) IS DISTINCT FROM '([0-9a-f]{64})'", corp)
    if len(tot) != 1 or len(felii) < 2:
        esec(f"verificarea: {len(tot)} lungimi totale, {len(felii)} felii")
    if int(tot[0]) != len(M):
        esec(f"lungimea totala ceruta {int(tot[0])} != {len(M)} octeti in M")
    sf = len(t[:s_mu[1]].encode("utf-8")) + 1  # dupa „;”-ul verificarii
    if M[sf:sf + 1] != b"\n":
        esec("dupa verificare trebuie LF")
    rpoz, rlung, rsha = int(felii[0][0]), int(felii[0][1]), felii[0][2]
    if rpoz != sf + 2 or rpoz - 1 + rlung != len(M) or hashlib.sha256(M[rpoz - 1:]).hexdigest() != rsha:
        esec(f"felia rest: pozitia {rpoz} (asteptat {sf + 2}), lungimea {rlung}, sha")
    gasit = False
    for p, l, s in felii[1:]:
        p, l = int(p), int(l)
        if M[p - 1:p - 1 + l] == copie and s == sha:
            gasit = True
    if not gasit:
        esec("nicio felie nu acopera exact octetii artefactului cu sha-ul aprobat")
    # garda finala: ordinea refuzurilor, ceasul serverului, plafonul cerut
    g = next(s for s in st if s[2].startswith("DO $plafon_fin$"))[2]
    ordine = [g.find(x) for x in ("PLAFON_AMANABIL", "PLAFON_CURSOR", "PLAFON_SCHIMBAT", "PLAFON_DEPASIT", "PLAFON_TIMP")]
    if min(ordine) < 0 or ordine != sorted(ordine):
        esec(f"ordinea in garda: {ordine}")
    for x in ("pg_catalog.age(pg_catalog.xid(pg_catalog.pg_current_xact_id())) IS DISTINCT FROM 0",
              "FROM pg_catalog.pg_trigger t WHERE t.tgdeferrable AND pg_catalog.age(t.xmin) <= 0",
              "FROM pg_catalog.pg_constraint c WHERE c.condeferrable AND pg_catalog.age(c.xmin) <= 0",
              f"pg_catalog.clock_timestamp() - pg_catalog.transaction_timestamp() > interval '{plafon} milliseconds'",
              f"IS DISTINCT FROM '{plafon}/session'"):
        if x not in g:
            esec(f"garda nu contine {x!r}")
    if "\\" in t.replace(copie.decode("utf-8"), ""):
        esec("textul runnerului din M contine backslash (citirea literalilor ar depinde de standard_conforming_strings)")
    l15_txt = ""
    if l15:
        T = verifica_l15(t, st, copie.decode("utf-8"), l15[0], l15[1])
        l15_txt = f"; L15 v2: amprenta globala inainte / dupa in jurul copiei (tag {T}), md5 aprobat, manifest exact"
    print(f"MESAJ_UNIC_OK: {len(M)} octeti, {len(txt)} instructiuni intr-un mesaj, BEGIN prima, {final} ultima; "
          f"verificarea: total + rest ({rlung} octeti) + {len(felii) - 1} copie/copii = artefactul aprobat{l15_txt}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
