#!/usr/bin/env python3
# ============================================================================
# Validatorul migrărilor livrate prin scripts/livrare_migrare.sh — runda 6 (verdict Copilot R5,
# docs/LIVRARE_MIGRARE_VERDICT_COPILOT_R5.md). Doar Python 3 stdlib — nicio dependență nouă.
#
# Un tokenizer SQL (nivel lexical, aliniat cu scanner-ul psql/PostgreSQL) care deosebește codul de nivel superior de:
#   comentarii „--” (terminate de LF SAU CR, ca în PostgreSQL: newline = [\n\r]) și „/* */” (imbricate),
#   literali '…' (cu '' dublat), E'…' (cu escape \), U&'…', B'…', X'…', identificatori "…",
#   dollar-quoting $tag$…$tag$ (deci și corpurile PL/pgSQL). Spațiu alb = exact setul PostgreSQL [ \t\n\r\f\v].
#
# ALINIEREA LEXICALĂ cu sesiunea (runda 6):
#   * Invarianță la standard_conforming_strings: REFUZ orice backslash într-un literal obișnuit '…' (non-E, inclusiv
#     U&'…'). Fără backslash acolo, textul se împarte IDENTIC cu standard_conforming_strings = on sau off, deci nici
#     o setare venită din conexiune (ALTER ROLE/DATABASE … SET, serviciu, PGOPTIONS) nu poate schimba ce vede serverul
#     față de ce vede validatorul. Literalii cu backslash se scriu E'…' (interpretați identic în ambele moduri).
#   * REFUZ orice mențiune (oriunde, inclusiv comentarii/corpuri/literali, fără diacritice/majuscule) a parametrilor
#     lexicali: standard_conforming_strings, client_encoding, escape_string_warning, backslash_quote.
#   * La nivel superior: REFUZ RESET (orice), SET NAMES / SET SCHEMA / SET TRANSACTION / SET SESSION CHARACTERISTICS,
#     SET pe parametrii lexicali; search_path e acceptat DOAR în forma verificată „SET LOCAL search_path = public, pg_temp”
#     (orice altă formă ⇒ refuz); set_config(...) la nivel superior: primul argument TREBUIE să fie un literal care nu
#     numește un parametru protejat (argument dinamic ⇒ refuz).
#   Runda 7 (verdict Copilot R6): REFUZ orice COPY la nivel superior (COPY … FROM STDIN schimbă citirea fișierului de
#     către psql); set_config: primul argument COMPLET trebuie să fie un literal static simplu, apelul e recunoscut și
#     citat/calificat (pg_catalog."set_config"); numele SET normalizate (neciat ⇒ lower, citat ⇒ exact, calificările
#     unite; comparația cu parametrii protejați e fără majuscule, ca în PostgreSQL); SET cu sintaxă nerecunoscută ⇒ refuz.
#   Runda 8 (verdict Copilot R7): REFUZ la nivel superior orice U&"…" (identificator) și U&'…' (literal) — decodificarea
#     escape-urilor se face în server, deci numele/argumentele verificate aici n-ar mai fi cele executate; și UESCAPE.
#   Runnerul fixează în plus, în tranzacție, înaintea migrării: READ COMMITTED, standard_conforming_strings = on,
#   client_encoding = UTF8 (și PGCLIENTENCODING=UTF8 la conexiune).
#
# Pe codul de nivel superior:
#   * REFUZ orice backslash (meta-comandă psql: \i, \c, \set, \g, \! …) — psql le interpretează oriunde pe linie;
#   * REFUZ interpolarea de variabile psql (:nume, :'nume', :"nume", :{?nume}) — „::” (cast) e permis;
#   * împarte în instrucțiuni la „;” și REFUZĂ instrucțiunile de control al tranzacției:
#       BEGIN, START, COMMIT, END, ROLLBACK, ABORT, SAVEPOINT, RELEASE, PREPARE TRANSACTION
#       (COMMIT/ROLLBACK PREPARED sunt acoperite de COMMIT/ROLLBACK).
#     Un „END” din corpul unei funcții ($$…$$) NU e la nivel superior ⇒ acceptat.
#     Limită conștientă (fail-closed): corpurile SQL-standard „BEGIN ATOMIC … END” sunt refuzate — folosiți $$…$$.
#   * garda de livrare: cere un APEL real current_setting('gazpet.livrare_migrare' …) în cod (nivel superior sau corp
#     $…$ analizat lexical) — un comentariu sau un literal izolat NU ajung. E o verificare de PREZENȚĂ; poziția și
#     logica gărzilor (prima/ultima, ce refuză) rămân parte din review-ul artefactului aprobat.
# Literal/comentariu/dollar-quote neterminat, octeți non-UTF-8, NUL ⇒ REFUZ. Orice excepție ⇒ REFUZ (cod ≠ 0).
#
# Runda 11 (11.11.2026, Jakarinos r13 P2 pe PR #1054): cu --plafon-tranzactie (runnerul cu --plafon-tranzactie-ms),
#   artefactul NU are voie să atingă ceasul tranzacției, oriunde în fișier (nivel superior, DO, corpuri de funcții,
#   literali, comentarii — fail-closed, ca la parametrii lexicali):
#   * „transaction_timeout” (fără majuscule; și după eliminarea a tot ce nu e [a-z0-9_], ca 'transaction' || '_timeout')
#     și „pg_settings” apar DOAR în citirea exactă PLAFON_CITIRE de mai jos ⇒ refuz la SET / SET LOCAL / set_config /
#     RESET / ALTER ROLE|DATABASE|FUNCTION … SET / CREATE FUNCTION … SET / UPDATE pg_settings / citire necalificată;
#   * orice „RESET ALL”.
#   SQL-ul dinamic construit din bucăți (chr(), format, U& în corpuri) și apelul unei funcții EXISTENTE cu
#   SET transaction_timeout nu se pot vedea static: le prinde garda finală a runnerului (valoarea și timpul de la BEGIN,
#   runda 12: în același mesaj cu COMMIT-ul; runda 13: refuz PLAFON_AMANABIL pentru obiectele amânabile create /
#   modificate în tranzacție). Garanția exactă și limitele ei (COMMIT-ul propriu-zis, codul preexistent care rulează
#   amânat, ocolirea deliberată a runnerului) sunt în antetul scripts/livrare_migrare.sh. Validatorul și garda sunt
#   gărzi de PROTOCOL, nu dovadă și nici autorizație. Fără opțiune: regulile de dinainte, neschimbate.
# Runda 14 (12.11.2026, portal r18): cu plafon, runnerul trimite TOATĂ tranzacția într-un singur mesaj (\gexec,
#   scripts/livrare_mesaj.sh) ⇒ meta-comenzile psql (\set, \i, \if, \gexec, \;, \! …) și variabilele psql (:x, :'x')
#   din artefact NU ar mai fi interpretate de psql, ci ar ajunge la server ca text. Regula de mai sus (REFUZ orice
#   backslash / interpolare la nivel superior, cu și fără plafon) le refuză deja pe toate ⇒ codul validatorului e
#   neschimbat; cazurile sunt acum teste explicite (scripts/test_livrare_validator_plafon.py). În corpuri $…$ și în
#   literali E'…' psql nu le interpreta nici în forma veche (aceeași semantică). Invarianța la
#   standard_conforming_strings (runda 6) e cea care face sigură citirea întregului mesaj de către server la primire.
# Runda 16 (17.11.2026, decizia proprietarului: plafonul livrărilor L15 v2 = 5000 ms, docs/LIVRARE_L15_V2.md §9):
#   --plafon-tranzactie-ms <N> (forma folosită de runner) = regulile lui --plafon-tranzactie + ACORDUL plafonului:
#   fiecare valoare de plafon cerută de fișier trebuie să fie EXACT N, altfel REFUZ înainte de orice conexiune
#   (PLAFON_DIFERIT; o migrare care cere 2000 nu pleacă cu un runner care dă 5000 și invers). Se citesc, pe textul brut
#   (și comentariile — fail-closed): literalul '<D>/session' (garda pe pg_settings), marcajul '<D>:' || txid_current()
#   (garda pe gazpet.plafon_tranzactie) și mențiunea „--plafon-tranzactie-ms <D>” (antetul de livrare). Un fișier care
#   citește gazpet.plafon_tranzactie fără marcajul în forma de mai sus = REFUZ (valoarea cerută nu se poate verifica).
#   Un fișier fără nicio cerere de plafon nu are ce acorda (doar regulile statice). --plafon-tranzactie fără valoare
#   rămâne pentru testele statice vechi (doar regulile, fără acord); runnerul NU îl mai folosește.
# Runda 17 (17.11.2026, verdictul Jakarinos pe PR #1115, NO-GO: două P1):
#   P1-1: textul brut de mai sus doar REFUZĂ; ACCEPTAREA cere validarea STRUCTURALĂ a codului executabil (verifica_structura_plafon:
#     nivelul superior + corpurile $…$, fără comentarii): fiecare citire a plafonului (pg_settings / marcajul) și fiecare comparație
#     protejată are forma acceptată — UN literal simplu '<D>/session' / '<D>:' || txid_current(), termen al disjuncției unui
#     IF … THEN RAISE EXCEPTION, variabila citită folosită doar acolo sau în RAISE — și valoarea exactă N. Altă formă (concatenare,
#     cast, prefix, literal continuat, <>, AND / NOT în jur, variabila suprascrisă, marcajul scris de migrare) = PLAFON_FORMA.
#   P1-2: --fara-plafon (forma runnerului FĂRĂ --plafon-tranzactie-ms): un fișier care cere plafon = PLAFON_LIPSA, refuz local,
#     înainte de conexiune (înainte refuza abia în $pre$, după pasul „înainte”). Fără nicio cerere: regulile de dinainte.
#   Fără opțiune (testele statice): neschimbat.
#
# Utilizare: python3 livrare_validator.py <fișier.sql> [<tag-interzis>] [--plafon-tranzactie | --plafon-tranzactie-ms <N> | --fara-plafon]
#   <tag-interzis> = tag-ul dollar-quote al înregistrării generate de runner; nu are voie să apară în fișier.
# Ieșire: 0 = acceptat (tipărește „OK <n instrucțiuni>”); 1 = refuzat (motivul pe stderr); orice altceva = eroare ⇒ refuz.
# ============================================================================
import re
import sys

INTERZISE = {"BEGIN", "START", "COMMIT", "END", "ROLLBACK", "ABORT", "SAVEPOINT", "RELEASE"}
LEXICALE = ("standard_conforming_strings", "client_encoding", "escape_string_warning", "backslash_quote")
PROTEJATE = set(LEXICALE) | {"search_path"}
SET_INTERZISE = {"NAMES", "SCHEMA", "TRANSACTION", "SESSION"}  # după SET [LOCAL]: alias-uri/izolare
SEARCH_PATH_OK = ["SET", "LOCAL", "SEARCH_PATH", "=", "PUBLIC", ",", "PG_TEMP"]
GARDA = "gazpet.livrare_migrare"
# Runda 11: singura formă permisă cu --plafon-tranzactie (citire, schemă calificată, octet cu octet).
PLAFON_CITIRE = "FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout'"
PLAFON_NUME = ("transaction_timeout", "pg_settings")
RESET_ALL = re.compile(r"(?<![a-z0-9_$])reset[ \t\n\r\f\v]+all(?![a-z0-9_$])")
# Runda 16: cererile de plafon din fișier (valoarea D, în ms), comparate cu plafonul dat runnerului.
PLAFON_CERERI = (
    ("garda pe pg_settings '<D>/session'", re.compile(r"'([0-9]+)/session'")),
    ("marcajul '<D>:' || txid_current()", re.compile(r"'([0-9]+):'[ \t\n\r\f\v]*\|\|[ \t\n\r\f\v]*(?:pg_catalog\.)?txid_current\(\)", re.I)),
    ("antetul --plafon-tranzactie-ms <D>", re.compile(r"--plafon-tranzactie-ms[ \t=]+([0-9]+)")),
)
PLAFON_MARCAJ = "gazpet.plafon_tranzactie"
# Runda 17 (verdictul PR #1115, P1): formele ACCEPTATE în codul executabil (tokenii lui instructiuni(): cuvinte MAJUSCULE, literali
# ca "'"+valoare, semne câte unul). Orice altă citire / comparație a plafonului în cod = refuz (vezi verifica_structura_plafon).
PL_CIT = ["FROM", "PG_CATALOG", ".", "PG_SETTINGS", "WHERE", "NAME", "=", "'transaction_timeout"]
PL_SEL = ["SELECT", "SETTING", "|", "|", "'/", "|", "|", "SOURCE"]
PL_IDF = ["IS", "DISTINCT", "FROM"]
PL_MARCAJ_ARG = "'" + PLAFON_MARCAJ
PL_LIT_SESIUNE = re.compile(r"'([1-9][0-9]{0,5})/session")
PL_LIT_MARCAJ = re.compile(r"'([1-9][0-9]{0,5}):")
PL_INCEPUT = (";", "BEGIN", "THEN", "ELSE", "LOOP")  # începutul unei instrucțiuni PL/pgSQL (forma SELECT … INTO)
SPATIU = " \t\n\r\f\v"
IDENT_START = re.compile(r"[A-Za-z_\u0080-\U0010FFFF]")
TAG = re.compile(r"\$([A-Za-z_\u0080-\U0010FFFF][A-Za-z0-9_\u0080-\U0010FFFF]*)?\$")
CUVANT = re.compile(r"[A-Za-z_\u0080-\U0010FFFF][A-Za-z0-9_$\u0080-\U0010FFFF]*")


class Refuz(Exception):
    pass


def linie(text, poz):
    return text.count("\n", 0, poz) + 1


def instructiuni(text, corpuri=None, strict=True):
    """Întoarce lista instrucțiunilor de nivel superior: (linia, tokeni). Tokeni: cuvinte (MAJUSCULE), semne,
    literali ca "'"+valoare, identificatori citați ca '"'+nume, corpuri $…$ ca "<DOLAR>" (conținutul în `corpuri`).
    strict=False (analiza corpurilor pentru gardă): fără refuzurile de backslash/variabile."""
    i, n = 0, len(text)
    rez, cur, start = [], [], None
    while i < n:
        c = text[i]
        if c == "-" and text.startswith("--", i):
            # PostgreSQL: comment = "--"{non_newline}*, newline = [\n\r] ⇒ CR termină comentariul
            j = i + 2
            while j < n and text[j] not in "\n\r":
                j += 1
            i = j
            continue
        if c == "/" and text.startswith("/*", i):
            adanc, j = 1, i + 2
            while adanc:
                if j >= n:
                    raise Refuz(f"comentariu /* neterminat (linia {linie(text, i)})")
                if text.startswith("/*", j):
                    adanc, j = adanc + 1, j + 2
                elif text.startswith("*/", j):
                    adanc, j = adanc - 1, j + 2
                else:
                    j += 1
            i = j
            continue
        if c == "\\":
            if strict:
                raise Refuz(f"meta-comandă psql / backslash la nivel superior (linia {linie(text, i)}): "
                            f"{text[i:i + 20].splitlines()[0]!r}")
            cur.append(c)
            i += 1
            continue
        if c == ":":
            if text.startswith("::", i):
                cur.append("::")
                i += 2
                continue
            if strict and i + 1 < n and (text[i + 1] in "'\"{" or IDENT_START.match(text[i + 1])):
                raise Refuz(f"interpolare de variabilă psql la nivel superior (linia {linie(text, i)}): "
                            f"{text[i:i + 20].splitlines()[0]!r}")
            cur.append(c)
            i += 1
            continue
        if c in "'\"":
            if strict and cur[-2:] == ["U", "&"]:
                # Runda 8 (verdict Copilot R7): U&"…" (identificator) / U&'…' (literal) cu escape-uri Unicode — numele
                # real se decodifică abia în server (U&"set\005Fconfig" = set_config, cu sau fără UESCAPE), deci ar
                # ocoli verificările pe nume/argumente. REFUZ la nivel superior, indiferent de conținut (fără listă de
                # escape-uri), de majuscule (u&), de calificare și de spații/comentarii între U& și ghilimele.
                raise Refuz(f"escape Unicode U&{c}…{c} la nivel superior (linia {linie(text, i)}) — interzis "
                            f"(identificatorii/literalii U& se decodifică în server și ar ocoli validatorul)")
            # prefix E/e ⇒ escape-uri cu backslash (doar pentru '); U&, B, X, N — fără efect asupra delimitării
            esc = False
            if c == "'" and i > 0 and text[i - 1] in "eE" and not (i > 1 and (text[i - 2].isalnum() or text[i - 2] in "_$")):
                esc = True
            j = i + 1
            val = []
            while True:
                if j >= n:
                    raise Refuz(f"literal {c}…{c} neterminat (linia {linie(text, i)})")
                ch = text[j]
                if ch == "\\":
                    if esc:
                        val.append(text[j:j + 2])
                        j += 2
                        continue
                    if c == "'" and strict:
                        # invarianța la standard_conforming_strings: fără backslash în literalii obișnuiți
                        raise Refuz(f"backslash într-un literal '…' obișnuit (linia {linie(text, j)}): interpretarea "
                                    f"ar depinde de standard_conforming_strings — folosiți E'…'")
                if ch == c:
                    if j + 1 < n and text[j + 1] == c:
                        val.append(c)
                        j += 2
                        continue
                    break
                val.append(ch)
                j += 1
            if start is None:
                start = i
            cur.append(c + "".join(val))
            i = j + 1
            continue
        if c == "$":
            m = TAG.match(text, i)
            # $1 (parametru) nu e tag; un tag lipit de un identificator (ex. a$b$) nu începe un dollar-quote
            if m and not (i > 0 and (text[i - 1].isalnum() or text[i - 1] in "_$")):
                delim = m.group(0)
                j = text.find(delim, m.end())
                if j < 0:
                    raise Refuz(f"dollar-quote {delim} neterminat (linia {linie(text, i)})")
                if start is None:
                    start = i
                cur.append("<DOLAR>")
                if corpuri is not None:
                    corpuri.append(text[m.end():j])
                i = j + len(delim)
                continue
            cur.append(c)
            i += 1
            continue
        if c == ";":
            if cur:
                rez.append((linie(text, start), cur))
            cur, start = [], None
            i += 1
            continue
        if c in SPATIU:
            i += 1
            continue
        m = CUVANT.match(text, i)
        if m:
            if start is None:
                start = i
            cur.append(m.group(0).upper())
            i = m.end()
            continue
        if start is None:
            start = i
        cur.append(c)
        i += 1
    if cur:
        rez.append((linie(text, start), cur))
    return rez


def e_ident(tok):
    """Token de identificator: cuvânt (CUVANT, deja MAJUSCULE) sau identificator citat ('"'+nume)."""
    return tok.startswith('"') or (CUVANT.fullmatch(tok) is not None)


def nume_param(tok):
    """Numele unui identificator ca în PostgreSQL: neciat ⇒ lowercase; citat ⇒ conținutul exact."""
    if tok.startswith('"'):
        return tok[1:]
    return tok.lower()


def protejat(nume):
    """Numele GUC se compară în PostgreSQL FĂRĂ diferență de majuscule (guc_name_compare) ⇒ comparăm pe lower, pe
    numele întreg și pe ultima componentă (fail-closed pentru nume calificate)."""
    n = nume.strip().lower()
    return n in PROTEJATE or n.rsplit(".", 1)[-1] in PROTEJATE


def are_apel_garda(instr):
    for _, toks in instr:
        for k in range(len(toks) - 2):
            if toks[k] == "CURRENT_SETTING" and toks[k + 1] == "(" and toks[k + 2] == "'" + GARDA:
                return True
    return False


def garda_in_cod(text, adanc=0):
    corpuri = []
    try:
        instr = instructiuni(text, corpuri, strict=(adanc == 0))
    except Refuz:
        if adanc == 0:
            raise
        return False  # un corp care nu se analizează lexical ca SQL nu contează drept gardă
    if are_apel_garda(instr):
        return True
    return adanc < 8 and any(garda_in_cod(c, adanc + 1) for c in corpuri)


def verifica_set(ln, toks):
    cap = toks[0]
    if cap == "RESET":
        raise Refuz(f"RESET la nivel superior (linia {ln}): {' '.join(toks[:3])} — poate readuce setările conexiunii")
    if cap != "SET":
        return
    k = 1
    if len(toks) > k and toks[k] in ("LOCAL", "SESSION") and not (toks[k] == "SESSION" and len(toks) > 2 and toks[2] == "CHARACTERISTICS"):
        k += 1
    if len(toks) <= k:
        raise Refuz(f"SET incomplet (linia {ln})")
    if toks[k] in SET_INTERZISE or toks[1] in SET_INTERZISE - {"SESSION"}:
        raise Refuz(f"SET {toks[k]} la nivel superior (linia {ln}) — interzis (codificare/schemă/izolare)")
    # numele: ident ( "." ident )* — normalizat (neciat ⇒ lower, citat ⇒ exact), apoi „=” / TO / FROM CURRENT și o valoare
    if not e_ident(toks[k]):
        raise Refuz(f"SET cu sintaxă nerecunoscută (linia {ln}): {' '.join(toks[:4])}")
    parti = [nume_param(toks[k])]
    k += 1
    while k + 1 < len(toks) and toks[k] == "." and e_ident(toks[k + 1]):
        parti.append(nume_param(toks[k + 1]))
        k += 2
    p = ".".join(parti)
    if not (len(toks) > k + 1 and toks[k] in ("=", "TO")) and toks[k:] != ["FROM", "CURRENT"]:
        # SET ROLE / SESSION AUTHORIZATION / TIME ZONE / CONSTRAINTS / XML OPTION … ⇒ nerecunoscut ⇒ refuz
        raise Refuz(f"SET cu sintaxă nerecunoscută (linia {ln}): {' '.join(toks[:5])}")
    if p.lower() in LEXICALE or p.lower().rsplit(".", 1)[-1] in LEXICALE:
        raise Refuz(f"SET {p} la nivel superior (linia {ln}) — parametru lexical, fixat de runner")
    if protejat(p):
        if toks != SEARCH_PATH_OK:
            raise Refuz(f"SET search_path la nivel superior (linia {ln}) acceptat doar ca "
                        f"„SET LOCAL search_path = public, pg_temp”: {' '.join(toks)}")


def e_set_config(tok):
    """Apelul set_config în orice formă: set_config, SET_CONFIG, "set_config" (și "SET_CONFIG" — fail-closed); calificarea
    (pg_catalog. / "pg_catalog". / altă schemă) nu contează — se verifică numele funcției oricum ar fi calificat."""
    return tok == "SET_CONFIG" or (tok.startswith('"') and tok[1:].lower() == "set_config")


def verifica_set_config(ln, toks):
    for k, t in enumerate(toks):
        if e_set_config(t):
            # primul argument COMPLET (până la virgula de nivel 0) = UN singur literal static simplu '…' (fără prefix
            # E/U&/B/X, fără cast, fără concatenare, fără literal continuat pe linia următoare, fără $…$)
            if not (k + 3 < len(toks) and toks[k + 1] == "(" and toks[k + 2].startswith("'") and toks[k + 3] == ","):
                raise Refuz(f"set_config la nivel superior cu primul argument nerecunoscut (linia {ln}) — acceptat doar "
                            f"un literal static simplu urmat de virgulă: {' '.join(toks[k:k + 6])}")
            if protejat(toks[k + 2][1:]):
                raise Refuz(f"set_config('{toks[k + 2][1:]}') la nivel superior (linia {ln}) — parametru protejat")


def verifica_plafon(text):
    """Runda 11: cu --plafon-tranzactie, nicio atingere a ceasului tranzacției (vezi antetul). Numără pe textul BRUT
    (fail-closed: și comentariile / literalii / corpurile), fără majuscule, apoi pe textul comprimat la [a-z0-9_]."""
    mic = text.lower()
    permise = text.count(PLAFON_CITIRE)
    comprimat = re.sub(r"[^a-z0-9_]", "", mic)
    for nume in PLAFON_NUME:
        n, nc = mic.count(nume), comprimat.count(nume)
        if n != permise or nc != permise:
            raise Refuz(f"cu plafonul tranzacției activ, „{nume}” apare de {max(n, nc)} ori, dar doar {permise} în citirea "
                        f"permisă „{PLAFON_CITIRE}” — artefactul nu are voie să schimbe / reseteze / citească altfel "
                        f"ceasul tranzacției (SET, SET LOCAL, set_config, RESET, ALTER … SET, funcții cu SET)")
    m = RESET_ALL.search(mic)
    if m:
        raise Refuz(f"cu plafonul tranzacției activ, RESET ALL e interzis oriunde (linia {linie(text, m.start())})")


def verifica_acord_plafon(text, plafon_ms):
    """Runda 16: fiecare cerere de plafon din fișier = exact plafonul dat runnerului (vezi antetul). Întoarce numărul
    cererilor găsite. Fail-closed: marcajul plafonului citit într-o formă nerecunoscută = refuz."""
    gasite, diferite = 0, []
    for et, rx in PLAFON_CERERI:
        for m in rx.finditer(text):
            gasite += 1
            if int(m.group(1)) != plafon_ms:
                diferite.append(f"{m.group(1)} ms ({et}, linia {linie(text, m.start())})")
    if diferite:
        raise Refuz(f"PLAFON_DIFERIT: fișierul cere {'; '.join(diferite)}, iar runnerul dă {plafon_ms} ms — "
                    f"livrați cu plafonul cerut sau schimbați migrarea (review nou); nimic trimis")
    if PLAFON_MARCAJ in text.lower() and not PLAFON_CERERI[1][1].search(text):
        raise Refuz(f"PLAFON_DIFERIT: fișierul citește {PLAFON_MARCAJ}, dar nu îl compară în forma verificabilă "
                    f"'<D>:' || txid_current() — plafonul cerut nu se poate compara cu cel al runnerului")
    # Runda 17: textul brut de mai sus doar REFUZĂ (fail-closed, și comentariile); acceptarea cere ca FIECARE citire / comparație
    # din codul executabil să aibă forma acceptată și valoarea exactă (comentariile nu mai pot „acoperi” o comparație în altă formă).
    for et, d, ln in verifica_structura_plafon(text):
        if d != plafon_ms:
            diferite.append(f"{d} ms ({et} în cod, linia {ln})")
    if diferite:
        raise Refuz(f"PLAFON_DIFERIT: fișierul cere {'; '.join(diferite)}, iar runnerul dă {plafon_ms} ms — "
                    f"livrați cu plafonul cerut sau schimbați migrarea (review nou); nimic trimis")
    return gasite


MENTIUNI_PLAFON = ("transaction_timeout", "plafon_tranzactie", "/session")


def fluxuri_cod(text, adanc=0):
    """Runda 17: codul EXECUTABIL al fișierului = fluxul de tokeni al nivelului superior și al fiecărui corp $…$ (recursiv, ca
    garda de livrare), cu „;” între instrucțiuni; comentariile nu ajung în flux. Un corp care nu se analizează lexical ca SQL,
    sau unul prea adânc, dar care menționează plafonul = refuz (fail-closed). Întoarce [(flux, text)]."""
    corpuri = []
    instr = instructiuni(text, corpuri, strict=(adanc == 0))
    flux = []
    for _, toks in instr:
        flux += toks + [";"]
    rez = [(flux, text)]
    for c in corpuri:
        mentioneaza = any(m in c.lower() for m in MENTIUNI_PLAFON)
        if adanc >= 8:
            if mentioneaza:
                raise Refuz("un corp $…$ prea adânc (> 8 niveluri) menționează plafonul — forma nu se poate verifica")
            continue
        try:
            rez += fluxuri_cod(c, adanc + 1)
        except Refuz as e:
            if mentioneaza:
                raise Refuz(f"un corp $…$ care menționează plafonul nu se analizează lexical ({e}) — forma nu se poate verifica")
    return rez


def verifica_structura_plafon(text):
    """Runda 17 (verdictul PR #1115, P1): fiecare citire / comparație protejată a plafonului din codul EXECUTABIL are una dintre
    formele acceptate, altfel REFUZ (înainte de orice conexiune). Întoarce cererile găsite: [(eticheta, D în ms, linia)].
    Forme acceptate (tokeni, majuscule ignorate, spațiile / comentariile dintre tokeni nu contează):
      citirea pg_settings:  SELECT setting || '/' || source INTO <v> FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout';
                            sau „( SELECT setting || '/' || source FROM … 'transaction_timeout' )” urmată de comparație;
      variabila <v>:        declarată „<v> text;”, folosită DOAR în „IF|OR <v> IS DISTINCT FROM '<D>/session' OR|THEN” sau în
                            argumentele unui RAISE (diagnostic); orice altă folosire (atribuire, alt INTO, altă expresie) = refuz;
      marcajul:             current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '<D>:' || txid_current() OR|THEN
                            (pg_catalog. opțional la ambele funcții) sau în argumentele unui RAISE;
      comparația:           un termen al disjuncției de nivel 0 a unui „IF … THEN RAISE EXCEPTION” (înainte: IF / OR, după: OR / THEN,
                            fără paranteze deschise între IF și THEN); literalul = UN singur literal simplu, fără prefix (E / U& / B / X),
                            fără cast, fără concatenare, fără literal continuat pe linia următoare.
    Orice alt literal din cod (în afara argumentelor RAISE) care conține „/session” sau „plafon_tranzactie” = refuz.
    Limită declarată (ca la garda de livrare): poziția gărzii (cod mort, funcție nechemată, excepție prinsă) e a review-ului
    artefactului; valoarea reală a plafonului o impun oricum prologul și garda finală ale runnerului."""
    cereri = []
    for T, sursa in fluxuri_cod(text):
        n = len(T)
        acceptate = set()   # pozițiile literalilor validați ca parte a unei forme acceptate

        baza = linie(text, max(text.find(sursa), 0))

        def ln(i):
            # linia APROXIMATIVĂ (doar pentru mesaj): prima apariție a tokenului în sursa fluxului
            t = T[i] if 0 <= i < n else ""
            p = sursa.find(t[1:]) if t.startswith("'") else sursa.lower().find(t.lower())
            return baza + (linie(sursa, p) - 1 if p >= 0 else 0)

        def in_raise(i):
            j = i - 1
            while j >= 0 and T[j] != ";":
                if T[j] == "RAISE":
                    return True
                j -= 1
            return False

        def disjunct(s, e):
            # T[s:e] = comparația: termen al disjuncției de nivel 0 dintr-un IF … THEN RAISE EXCEPTION
            if s < 1 or e >= n or T[s - 1] not in ("IF", "OR") or T[e] not in ("OR", "THEN"):
                return False
            d, j = 0, s - 1
            while True:
                t = T[j]
                if t == ")":
                    d += 1
                elif t == "(":
                    d -= 1
                    if d < 0:
                        return False
                elif d == 0 and t == "IF":
                    if j > 0 and T[j - 1] == "END":
                        return False
                    break
                elif d == 0 and t in (";", "THEN", "ELSE", "ELSIF", "LOOP", "BEGIN", "END", "CASE", "WHEN"):
                    return False
                j -= 1
                if j < 0:
                    return False
            d, j = 0, e
            while True:
                t = T[j]
                if t == "(":
                    d += 1
                elif t == ")":
                    d -= 1
                    if d < 0:
                        return False
                elif d == 0 and t == "THEN":
                    break
                elif d == 0 and t in (";", "IF", "ELSE", "ELSIF", "LOOP", "BEGIN", "END", "CASE", "WHEN"):
                    return False
                j += 1
                if j >= n:
                    return False
            return T[j + 1:j + 3] == ["RAISE", "EXCEPTION"]

        def comparatie_sesiune(s, e, et):
            # T[e:] = IS DISTINCT FROM '<D>/session' urmat de OR / THEN; T[s:e] = citirea
            if T[e:e + 3] != PL_IDF or e + 3 >= n:
                raise Refuz(f"PLAFON_FORMA: {et} (linia ~{ln(s)}) nu e comparată în forma acceptată "
                            f"„IS DISTINCT FROM '<D>/session'”: {' '.join(T[s:e + 6])}")
            m = PL_LIT_SESIUNE.fullmatch(T[e + 3])
            if not m or not disjunct(s, e + 4):
                raise Refuz(f"PLAFON_FORMA: comparația plafonului (linia ~{ln(e + 3)}) nu are forma acceptată (UN literal simplu "
                            f"'<D>/session', termen al disjuncției unui IF … THEN RAISE EXCEPTION): {' '.join(T[s:e + 6])}")
            acceptate.add(e + 3)
            cereri.append(("garda pe pg_settings '<D>/session'", int(m.group(1)), ln(e + 3)))

        L = len(PL_SEL)
        for i in range(n):
            if T[i:i + len(PL_CIT)] != PL_CIT:
                continue
            f = i + len(PL_CIT)
            if i >= L + 2 and T[i - 2] == "INTO" and e_ident(T[i - 1]) and T[i - 2 - L:i - 2] == PL_SEL \
                    and (i - 3 - L < 0 or T[i - 3 - L] in PL_INCEPUT) and f < n and T[f] == ";":
                v = T[i - 1]
                comparatii = 0
                for j in range(n):
                    if T[j] != v or j == i - 1:
                        continue
                    if T[j + 1:j + 3] == ["TEXT", ";"] and j > 0 and T[j - 1] in ("DECLARE", ";"):
                        continue
                    if T[j + 1:j + 4] == PL_IDF:
                        comparatie_sesiune(j, j + 1, f"variabila plafonului {v.lower()}")
                        comparatii += 1
                        continue
                    if in_raise(j):
                        continue
                    raise Refuz(f"PLAFON_FORMA: variabila plafonului {v.lower()} (linia ~{ln(j)}) e folosită în afara formei "
                                f"acceptate (doar declarată „text”, comparată cu IS DISTINCT FROM '<D>/session' sau în RAISE): "
                                f"{' '.join(T[max(0, j - 3):j + 5])}")
                if not comparatii:
                    raise Refuz(f"PLAFON_FORMA: plafonul citit în {v.lower()} (linia ~{ln(i)}) nu e comparat nicăieri în forma acceptată")
            elif i >= L + 1 and T[i - 1 - L] == "(" and T[i - L:i] == PL_SEL and f < n and T[f] == ")":
                s = i - 1 - L
                if not in_raise(s):
                    comparatie_sesiune(s, f + 1, "citirea plafonului din pg_settings")
            else:
                raise Refuz(f"PLAFON_FORMA: citirea plafonului din pg_settings (linia ~{ln(i)}) nu are forma acceptată "
                            f"(SELECT setting || '/' || source INTO <v> … sau ( SELECT setting || '/' || source … ) IS DISTINCT FROM …): "
                            f"{' '.join(T[max(0, i - 10):f + 2])}")
        for j in range(n):
            t = T[j]
            if not (t.startswith("'") and PLAFON_MARCAJ.split(".")[1] in t.lower()):
                continue
            if in_raise(j):
                continue
            s = j - 2
            if s >= 2 and T[s - 2:s] == ["PG_CATALOG", "."]:
                s -= 2
            e = j + 4
            ok = t == PL_MARCAJ_ARG and T[j - 2:j] == ["CURRENT_SETTING", "("] and T[j + 1:j + 4] == [",", "TRUE", ")"]
            m = ok and T[e:e + 3] == PL_IDF and e + 3 < n and PL_LIT_MARCAJ.fullmatch(T[e + 3])
            g = e + 4
            if m and T[g:g + 2] == ["|", "|"]:
                g += 2
                if T[g:g + 2] == ["PG_CATALOG", "."]:
                    g += 2
                if T[g:g + 3] == ["TXID_CURRENT", "(", ")"] and disjunct(s, g + 3):
                    acceptate.add(e + 3)
                    cereri.append(("marcajul '<D>:' || txid_current()", int(m.group(1)), ln(e + 3)))
                    continue
            raise Refuz(f"PLAFON_FORMA: marcajul plafonului (linia ~{ln(j)}) e citit / comparat în afara formei acceptate "
                        f"„current_setting('{PLAFON_MARCAJ}', true) IS DISTINCT FROM '<D>:' || txid_current()”: "
                        f"{' '.join(T[max(0, s - 1):j + 12])}")
        for j in range(n):
            t = T[j]
            if t.startswith("'") and "/session" in t.lower() and j not in acceptate and not in_raise(j):
                raise Refuz(f"PLAFON_FORMA: literalul {t[1:]!r} (linia ~{ln(j)}) e în cod în afara unei comparații acceptate a "
                            f"plafonului (ex. concatenat, cu cast sau continuat): {' '.join(T[max(0, j - 6):j + 4])}")
    return cereri


def verifica_cere_plafon(text):
    """Runda 17 (verdictul PR #1115, P1-2): runnerul FĂRĂ --plafon-tranzactie-ms cheamă validatorul cu --fara-plafon. Un fișier
    care CERE plafon — în cod o citire a plafonului (pg_settings / marcajul) sau, oriunde (fail-closed, și comentariile), un
    literal '<D>/session', marcajul '<D>:' || txid_current() sau numele marcajului — e refuzat LOCAL, înainte de conexiune
    (altfel refuza abia în $pre$, în tranzacție, după pasul „înainte”). Fișierele fără nicio cerere: neschimbat."""
    motive = []
    for et, rx in PLAFON_CERERI[:2]:
        motive += [f"{m.group(1)} ms ({et}, linia {linie(text, m.start())})" for m in rx.finditer(text)]
    if PLAFON_MARCAJ in text.lower() and not motive:
        motive.append(f"marcajul {PLAFON_MARCAJ}")
    if "/session" in text.lower() and not motive:
        # orice altă formă a cererii (ex. ('2000' || '/session')): textul brut ajunge (fail-closed); '0/default' NU e o cerere
        motive.append("„/session” în fișier")
    if motive:
        raise Refuz(f"PLAFON_LIPSA: fișierul cere plafonul tranzacției ({'; '.join(motive)}), dar runnerul nu dă "
                    f"--plafon-tranzactie-ms — livrați cu --plafon-tranzactie-ms <D> (D = valoarea cerută); nimic trimis")


def valideaza(cale, tag_interzis=None, plafon=False, plafon_ms=None, fara_plafon=False):
    brut = open(cale, "rb").read()
    if b"\x00" in brut:
        raise Refuz("octet NUL în fișier")
    try:
        text = brut.decode("utf-8")
    except UnicodeDecodeError as e:
        raise Refuz(f"fișierul nu e UTF-8 valid ({e})")
    if tag_interzis is not None:
        if not re.fullmatch(r"[a-z_][a-z0-9_]*", tag_interzis):
            raise Refuz("tag interzis invalid")
        if f"${tag_interzis}$" in text:
            raise Refuz(f"fișierul conține tag-ul rezervat al înregistrării ${tag_interzis}$")
    mic = text.lower()
    for p in LEXICALE:
        if p in mic:
            raise Refuz(f"fișierul menționează parametrul lexical {p} (interzis oriunde; runnerul îl fixează)")
    if plafon or plafon_ms is not None:
        verifica_plafon(text)
    if plafon_ms is not None:
        verifica_acord_plafon(text, plafon_ms)
    if fara_plafon:
        verifica_cere_plafon(text)
    instr = instructiuni(text)
    if not instr:
        raise Refuz("fișier fără instrucțiuni")
    for ln, toks in instr:
        cap = toks[0]
        if cap in INTERZISE:
            raise Refuz(f"control de tranzacție la nivel superior (linia {ln}): {' '.join(toks[:3])}")
        if cap == "PREPARE" and len(toks) > 1 and toks[1] == "TRANSACTION":
            raise Refuz(f"control de tranzacție la nivel superior (linia {ln}): PREPARE TRANSACTION")
        if "COPY" in toks:
            # COPY … FROM STDIN schimbă modul în care psql citește fișierul (liniile devin date COPY până la „\.”) —
            # tokenizerul SQL nu modelează formatul de date COPY ⇒ refuzăm ORICE COPY la nivel superior (inclusiv
            # TO STDOUT / PROGRAM / fișier). Migrările actuale nu folosesc COPY.
            raise Refuz(f"COPY la nivel superior (linia {ln}) — interzis în migrările livrate prin runner")
        if "UESCAPE" in toks:
            raise Refuz(f"UESCAPE la nivel superior (linia {ln}) — escape-urile Unicode sunt interzise")
        verifica_set(ln, toks)
        verifica_set_config(ln, toks)
    if not garda_in_cod(text):
        raise Refuz("lipsește garda de livrare: niciun apel current_setting('gazpet.livrare_migrare' …) în cod "
                    "(un comentariu sau un literal izolat nu ajung)")
    return len(instr)


def main(argv):
    args = list(argv[1:])
    plafon = bool(args) and args[-1] == "--plafon-tranzactie"
    if plafon:
        args.pop()
    # runda 17: forma runnerului FĂRĂ plafon — fișierele care cer plafon sunt refuzate local (PLAFON_LIPSA)
    fara_plafon = not plafon and bool(args) and args[-1] == "--fara-plafon"
    if fara_plafon:
        args.pop()
    plafon_ms = None
    if not plafon and not fara_plafon and len(args) >= 2 and args[-2] == "--plafon-tranzactie-ms":
        # aceeași formă ca runnerul: întreg simplu 100..600000, fără zerouri în față
        if not (re.fullmatch(r"[1-9][0-9]{2,5}", args[-1]) and int(args[-1]) <= 600000):
            print(f"Utilizare: --plafon-tranzactie-ms <N> cu N întreg 100..600000 (dat: {args[-1]!r})", file=sys.stderr)
            return 2
        plafon_ms = int(args[-1])
        del args[-2:]
    if len(args) not in (1, 2) or any(a.startswith("--") for a in args):
        print("Utilizare: livrare_validator.py <fișier.sql> [<tag-interzis>] [--plafon-tranzactie | --plafon-tranzactie-ms <N> | --fara-plafon]",
              file=sys.stderr)
        return 2
    try:
        n = valideaza(args[0], args[1] if len(args) == 2 else None, plafon, plafon_ms, fara_plafon)
    except Refuz as e:
        print(f"REFUZ validator: {e}", file=sys.stderr)
        return 1
    print(f"OK {n} instrucțiuni de nivel superior")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv))
    except SystemExit:
        raise
    except BaseException as e:  # fail-closed: orice eroare neprevăzută = refuz
        print(f"REFUZ validator (eroare internă): {e!r}", file=sys.stderr)
        sys.exit(4)
