#!/usr/bin/env python3
# ============================================================================
# Validatorul migrărilor livrate prin scripts/livrare_migrare.sh (runda 5, verdict Copilot R4).
# Doar Python 3 stdlib — nicio dependență nouă.
#
# Un tokenizer SQL (nivel lexical, ca scanner-ul psql/PostgreSQL) care deosebește codul de nivel superior de:
#   comentarii „--” și „/* */” (imbricate), literali '…' (cu '' dublat), E'…' (cu escape \), U&'…', B'…', X'…',
#   identificatori "…", dollar-quoting $tag$…$tag$ (deci și corpurile PL/pgSQL).
# Pe codul de nivel superior:
#   * REFUZ orice backslash (meta-comandă psql: \i, \c, \set, \g, \! …) — psql le interpretează oriunde pe linie;
#   * REFUZ interpolarea de variabile psql (:nume, :'nume', :"nume", :{?nume}) — „::” (cast) e permis;
#   * împarte în instrucțiuni la „;” și REFUZĂ instrucțiunile de control al tranzacției:
#       BEGIN, START, COMMIT, END, ROLLBACK, ABORT, SAVEPOINT, RELEASE, PREPARE TRANSACTION
#       (COMMIT/ROLLBACK PREPARED sunt acoperite de COMMIT/ROLLBACK).
#     Un „END” din corpul unei funcții ($$…$$) NU e la nivel superior ⇒ acceptat.
#     Limită conștientă (fail-closed): corpurile SQL-standard „BEGIN ATOMIC … END” sunt refuzate — folosiți $$…$$.
#   * cere garda de livrare: literalul 'gazpet.livrare_migrare' trebuie să apară.
# Literal/comentariu/dollar-quote neterminat, octeți non-UTF-8, NUL ⇒ REFUZ. Orice excepție ⇒ REFUZ (cod ≠ 0).
#
# Utilizare: python3 livrare_validator.py <fișier.sql> [<tag-interzis>]
#   <tag-interzis> = tag-ul dollar-quote al înregistrării generate de runner; nu are voie să apară în fișier.
# Ieșire: 0 = acceptat (tipărește „OK <n instrucțiuni>”); 1 = refuzat (motivul pe stderr); orice altceva = eroare ⇒ refuz.
# ============================================================================
import re
import sys

INTERZISE = {"BEGIN", "START", "COMMIT", "END", "ROLLBACK", "ABORT", "SAVEPOINT", "RELEASE"}
IDENT_START = re.compile(r"[A-Za-z_\u0080-\U0010FFFF]")
TAG = re.compile(r"\$([A-Za-z_\u0080-\U0010FFFF][A-Za-z0-9_\u0080-\U0010FFFF]*)?\$")
CUVANT = re.compile(r"[A-Za-z_][A-Za-z0-9_$]*")


class Refuz(Exception):
    pass


def linie(text, poz):
    return text.count("\n", 0, poz) + 1


def instructiuni(text):
    """Întoarce lista instrucțiunilor de nivel superior: fiecare = listă de cuvinte-cheie/tokeni de nivel superior
    (literalii, comentariile și corpurile $$ sunt înlocuite cu un marcaj, deci nu pot părea cod)."""
    i, n = 0, len(text)
    rez, cur, start = [], [], None
    while i < n:
        c = text[i]
        if c == "-" and text.startswith("--", i):
            j = text.find("\n", i)
            i = n if j < 0 else j + 1
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
            raise Refuz(f"meta-comandă psql / backslash la nivel superior (linia {linie(text, i)}): "
                        f"{text[i:i + 20].splitlines()[0]!r}")
        if c == ":":
            if text.startswith("::", i):
                i += 2
                continue
            if i + 1 < n and (text[i + 1] in "'\"{" or IDENT_START.match(text[i + 1])):
                raise Refuz(f"interpolare de variabilă psql la nivel superior (linia {linie(text, i)}): "
                            f"{text[i:i + 20].splitlines()[0]!r}")
            i += 1
            continue
        if c in "'\"":
            # prefix E/e ⇒ escape-uri cu backslash (doar pentru '); U&, B, X, N — fără efect asupra delimitării
            esc = False
            if c == "'" and i > 0 and text[i - 1] in "eE" and not (i > 1 and (text[i - 2].isalnum() or text[i - 2] in "_$")):
                esc = True
            j = i + 1
            while True:
                if j >= n:
                    raise Refuz(f"literal {c}…{c} neterminat (linia {linie(text, i)})")
                ch = text[j]
                if esc and ch == "\\":
                    j += 2
                    continue
                if ch == c:
                    if j + 1 < n and text[j + 1] == c:
                        j += 2
                        continue
                    break
                j += 1
            if start is None:
                start = i
            cur.append("<LIT>")
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
                i = j + len(delim)
                continue
            i += 1
            continue
        if c == ";":
            if cur:
                rez.append((linie(text, start), cur))
            cur, start = [], None
            i += 1
            continue
        if c.isspace():
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
    instr = instructiuni(text)
    if not instr:
        raise Refuz("fișier fără instrucțiuni")
    for ln, toks in instr:
        cap = toks[0]
        if cap in INTERZISE:
            raise Refuz(f"control de tranzacție la nivel superior (linia {ln}): {' '.join(toks[:3])}")
        if cap == "PREPARE" and len(toks) > 1 and toks[1] == "TRANSACTION":
            raise Refuz(f"control de tranzacție la nivel superior (linia {ln}): PREPARE TRANSACTION")
    if "'gazpet.livrare_migrare'" not in text:
        raise Refuz("lipsește garda de livrare ('gazpet.livrare_migrare')")
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
