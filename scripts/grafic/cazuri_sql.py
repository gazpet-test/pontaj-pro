"""Cazurile COMUNE de validare Python / SQL (L19): test-fixtures/grafic/cazuri_validare.json -> documente complete -> fragmentul
SQL scripts/fixtures/grafic/cazuri_validare.sql, inclus de harness-ul scripts/test_executie_grafic.sql (testul „TV”).
Documentele se construiesc AICI, o singură dată; testul Python le dă lui valideaza_document, iar harness-ul trimite exact
aceleași documente lui fn_executie_grafic_importa (doar proiect_id se pune pe proiectul de test).
Utilizare (din rădăcina repo-ului): python -I -X utf8 scripts/grafic/cazuri_sql.py [--verifica]
  fără argumente: (re)scrie fișierul SQL; --verifica: cod 1 dacă fișierul din repo nu e la zi.
"""
import copy, hashlib, json, os, sys

RADACINA = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
SURSA = os.path.join(RADACINA, 'test-fixtures', 'grafic', 'cazuri_validare.json')
TINTA = os.path.join(RADACINA, 'scripts', 'fixtures', 'grafic', 'cazuri_validare.sql')


def incarca():
    with open(SURSA, encoding='utf-8') as f:
        return json.load(f)


def aplica(doc, op):
    """[\"set\", cale, valoare] (creează cheia lipsă), [\"sterge\", cale] sau [\"set_n\", cale, valoare, n] (lista cu valoarea de n ori)."""
    tip, cale = op[0], op[1]
    t = doc
    for k in cale[:-1]:
        t = t[k]
    if tip == 'set':
        t[cale[-1]] = copy.deepcopy(op[2])
    elif tip == 'sterge':
        del t[cale[-1]]
    elif tip == 'set_n':
        t[cale[-1]] = [copy.deepcopy(op[2]) for _ in range(op[3])]
    else:
        raise ValueError(f'operație necunoscută: {tip}')


def documente(date=None):
    """[(nr, nume, asteptat, sqlstate, document)] — fiecare caz cu eticheta CAZ-<nr> și un sha256 propriu, apoi operațiile lui."""
    date = date or incarca()
    rez = []
    for i, caz in enumerate(date['cazuri'], 1):
        d = copy.deepcopy(date['baza'])
        d['revizie']['eticheta'] = f'CAZ-{i:02d}'
        d['revizie']['sursa_sha256'] = hashlib.sha256(f'caz {i} {caz["nume"]}'.encode('utf-8')).hexdigest()
        for op in caz['op']:
            aplica(d, op)
        if caz['asteptat'] not in ('ok', 'refuz') or (caz['asteptat'] == 'refuz') != bool(caz.get('sqlstate')):
            raise ValueError(f'caz {i}: „asteptat” / „sqlstate” incoerente')
        rez.append((i, caz['nume'], caz['asteptat'], caz.get('sqlstate'), d))
    return rez


def genereaza(date=None):
    cazuri = documente(date)
    L = ['-- GENERAT de scripts/grafic/cazuri_sql.py din test-fixtures/grafic/cazuri_validare.json. NU se editează de mână',
         '-- (scripts/grafic/test_import_mpp.py verifică că e la zi). Inclus de scripts/test_executie_grafic.sql (TV), ca postgres:',
         '-- fiecare caz „refuz” trebuie refuzat de fn_executie_grafic_importa cu SQLSTATE-ul așteptat, fiecare „ok” trebuie să treacă',
         '-- (și să fie „deja” la reimport identic); la final reviziile CAZ-* se șterg. Aceleași documente le validează și Python.',
         'DO $tv$', 'DECLARE p bigint := pg_temp.t_g(\'p\')::bigint; d jsonb; res jsonb;', 'BEGIN']
    nr_ok = nr_refuz = 0
    for i, nume, asteptat, stare, doc in cazuri:
        corp = json.dumps(doc, ensure_ascii=False, separators=(',', ':'))
        tag = f'c{i:02d}'
        if f'${tag}$' in corp or '$tv$' in corp or '\n' in nume or "'" in nume:
            raise ValueError(f'caz {i}: conținut incompatibil cu literalul SQL')
        L.append(f'  -- caz {i:02d}: {nume} ({asteptat}{" " + stare if stare else ""})')
        L.append(f"  d := jsonb_set(${tag}${corp}${tag}$::jsonb, '{{revizie,proiect_id}}', to_jsonb(p));")
        if asteptat == 'refuz':
            nr_refuz += 1
            L.append(f"  IF NOT pg_temp.t_refuza(format('SELECT pg_temp.t_imp(%L::jsonb, false)', d::text), '{stare}') THEN")
            L.append(f"    RAISE EXCEPTION 'TV FAIL: caz {i:02d} ({nume}) nu a fost refuzat cu {stare}';")
            L.append('  END IF;')
        else:
            nr_ok += 1
            n = len(doc['activitati'])
            L.append('  res := pg_temp.t_imp(d, false);')
            L.append(f"  IF (res->>'ok')::boolean IS NOT TRUE OR (res->>'deja')::boolean IS NOT FALSE OR (res->>'activitati')::integer <> {n}")
            L.append(f"     OR (SELECT count(*) FROM public.executie_grafic_activitati WHERE revizie_id = (res->>'revizie_id')::bigint) <> {n}")
            L.append("     OR (pg_temp.t_imp(d, false)->>'deja')::boolean IS NOT TRUE THEN")
            L.append(f"    RAISE EXCEPTION 'TV FAIL: caz {i:02d} ({nume}) trebuia să treacă: %', res;")
            L.append('  END IF;')
    L += ["  DELETE FROM public.executie_grafic_revizii WHERE eticheta LIKE 'CAZ-%';",
          f"  RAISE NOTICE 'TV OK ({nr_refuz + nr_ok} cazuri comune Python / SQL: {nr_refuz} refuzate cu SQLSTATE-ul așteptat, {nr_ok} acceptate)';",
          'END $tv$;', '']
    return '\n'.join(L)


if __name__ == '__main__':
    text = genereaza()
    if sys.argv[1:] == ['--verifica']:
        try:
            with open(TINTA, encoding='utf-8', newline='') as f:
                ok = f.read().replace('\r\n', '\n') == text
        except FileNotFoundError:
            ok = False
        print('la zi' if ok else 'NU e la zi: rulează scripts/grafic/cazuri_sql.py')
        sys.exit(0 if ok else 1)
    if sys.argv[1:]:
        sys.exit('utilizare: cazuri_sql.py [--verifica]')
    os.makedirs(os.path.dirname(TINTA), exist_ok=True)
    with open(TINTA, 'w', encoding='utf-8', newline='\n') as f:
        f.write(text)
    print('OK', os.path.relpath(TINTA, RADACINA))
