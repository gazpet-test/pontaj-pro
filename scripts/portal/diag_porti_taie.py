"""Portal E1 r19: copia de DIAGNOSTIC a lui 18a = copia protejata a runnerului FARA blocul postconditiei (pasul 5 din
$critic$), ca diagnosticul (scripts/portal/dry_prod_e1.sh --diagnostic-porti) sa poata tipari lista portilor lipsa in
aceeasi tranzactie, inainte de ROLLBACK. NU e forma de livrare: livrarea trimite copia intreaga, cu sha256 aprobat.

Utilizare: python3 scripts/portal/diag_porti_taie.py <copia 18a> <iesire>

Taietura, pe marcajele EXISTENTE din 18a (octeti, fara regex pe SQL; refuz daca vreunul nu apare exact o data):
  * inceputul = linia „  -- 5. postconditia (poarta completa) si amprenta pentru revenire” (comentariul pasului 5);
  * sfarsitul = linia „END $critic$;” (pastrata, cu tot ce urmeaza dupa ea: doar sfarsitul de linie);
  * intre ele trebuie sa fie postconditia (r21: v_porti := public.fn_portal_porti_lipsa(); apoi refuzul cu lista),
    iar „PORTAL_POSTCONDITION_FAILED” sa apara o singura data in tot fisierul (deci copia taiata nu-l mai contine);
  * „DO $critic$” exact o data, inaintea inceputului (taietura e in corpul lui $critic$, care ramane inchis).
Iesire 0 = copia scrisa (tipareste DIAG_TAIE_OK ...); 1 = refuz (motivul pe stderr), nimic scris.
Verificarea independenta a mesajului (alta formulare a aceleiasi taieturi): scripts/portal/test_diag_porti_mesaj.py.
"""
import sys

INCEPUT = b"  -- 5. postconditia (poarta completa) si amprenta pentru revenire"
SFARSIT = b"END $critic$;"
# r21: postconditia are acum doua linii (apelul portii intr-o variabila + refuzul cu lista portilor in mesaj).
APEL = b"  v_porti := public.fn_portal_porti_lipsa();"
POSTCOND = (b"IF v_porti IS DISTINCT FROM '{}'::text[] THEN RAISE EXCEPTION 'PORTAL_POSTCONDITION_FAILED: % porti: %', "
            b"coalesce(cardinality(v_porti)::text, 'NECUNOSCUT'), coalesce(array_to_string(v_porti, '; '), 'NECUNOSCUT'); END IF;")
CRITIC = b"DO $critic$"


def refuz(m):
    print(f"REFUZ taietura diagnostic: {m}", file=sys.stderr)
    sys.exit(1)


def linie_unica(b, marcaj, nume):
    """Pozitia liniei care e EXACT marcajul (inceput de linie, urmat de CRLF / LF / sfarsit), unica in fisier."""
    if b.count(marcaj) != 1:
        refuz(f"marcajul {nume} apare de {b.count(marcaj)} ori (cerut exact o data)")
    k = b.index(marcaj)
    if k > 0 and b[k - 1:k] != b"\n":
        refuz(f"marcajul {nume} nu e la inceput de linie")
    dupa = b[k + len(marcaj):k + len(marcaj) + 2]
    if not (dupa.startswith(b"\n") or dupa == b"\r\n" or dupa == b""):
        refuz(f"marcajul {nume} nu e o linie intreaga")
    return k


def main(a):
    if len(a) != 3:
        print(__doc__, file=sys.stderr)
        return 2
    b = open(a[1], "rb").read()
    i = linie_unica(b, INCEPUT, "inceput (pasul 5)")
    s = linie_unica(b, SFARSIT, "END $critic$;")
    if b.count(CRITIC) != 1 or b.index(CRITIC) > i:
        refuz("DO $critic$ trebuie sa apara exact o data, inaintea pasului 5")
    if not i < s:
        refuz("pasul 5 trebuie sa fie inaintea lui END $critic$;")
    if b.count(b"PORTAL_POSTCONDITION_FAILED") != 1 or b.count(POSTCOND) != 1 or b.count(APEL) != 1:
        refuz("postconditia (apelul portii + refuzul) trebuie sa apara exact o data")
    p, pa = b.index(POSTCOND), b.index(APEL)
    if not i < pa < p < s:
        refuz("postconditia nu e intre pasul 5 si END $critic$; (apelul portii inaintea refuzului)")
    if b[s + len(SFARSIT):].strip(b"\r\n") != b"":
        refuz("dupa END $critic$; mai urmeaza ceva (fisierul nu mai are forma revizuita)")
    rez = b[:i] + b[s:]
    if b"PORTAL_POSTCONDITION_FAILED" in rez or APEL in rez:
        refuz("copia taiata inca contine postconditia (eroare interna)")
    with open(a[2], "xb") as f:
        f.write(rez)
    print(f"DIAG_TAIE_OK: {len(b) - len(rez)} octeti scosi (pasul 5 din $critic$: postconditia + amprenta pentru revenire), "
          f"{len(rez)} ramasi; END $critic$; pastrat")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
