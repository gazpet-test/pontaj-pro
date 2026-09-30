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
# Utilizare: python3 livrare_validator.py <fișier.sql> [<tag-interzis>]
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


def valideaza(cale, tag_interzis=None):
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
        verifica_set(ln, toks)
        verifica_set_config(ln, toks)
    if not garda_in_cod(text):
        raise Refuz("lipsește garda de livrare: niciun apel current_setting('gazpet.livrare_migrare' …) în cod "
                    "(un comentariu sau un literal izolat nu ajung)")
    return len(instr)


def main(argv):
    if len(argv) not in (2, 3):
        print("Utilizare: livrare_validator.py <fișier.sql> [<tag-interzis>]", file=sys.stderr)
        return 2
    try:
        n = valideaza(argv[1], argv[2] if len(argv) == 3 else None)
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
