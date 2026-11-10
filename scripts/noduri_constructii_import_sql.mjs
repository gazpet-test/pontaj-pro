// ═══════════════════════════════════════════════════════════════════════════
// noduri_constructii_import_sql.mjs — generează SQL-ul de încărcare a elementelor de CONSTRUCȚII ale unui nod de cuplare
// în executie_noduri_constructii (migrarea 20261207a). Îl rulează CHAT-UL, după aplicarea migrării și cu „da”-ul lui Răzvan:
//   node scripts/noduri_constructii_import_sql.mjs --proiect <id> --nod <NOD-COD> --lista <elemente_constructii.csv> --iesire <fisier.sql în AFARA repo-ului>
//   psql -X -v ON_ERROR_STOP=1 --single-transaction -f <fisier.sql>
// Datele (lista din planșele beneficiarului) nu intră în repo-ul public: ieșirea în repo = refuz.
// Parsarea e cea din src/nodConstructiiLogica.js (aceeași definiție ca în teste). SQL-ul e idempotent: o a doua rulare nu schimbă nimic.
// Orice eroare de parsare (cod invalid / duplicat, tip, grup, UM, etape, cantitate, câmp prea lung, stadiu) oprește generarea.
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, relative, isAbsolute, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { obiecteCsv } from '../src/nodCuplareLogica.js'
import { mapeazaElemente } from '../src/nodConstructiiLogica.js'

const RE_NOD = /^[A-Z0-9][A-Z0-9-]{1,59}$/
const NUL = String.fromCharCode(0)

/** literal SQL (standard_conforming_strings = on): ghilimelele simple dublate; NUL refuzat */
export function lit(v) {
  if (v == null) return 'NULL'
  if (typeof v === 'number') { if (!Number.isFinite(v)) throw new Error('număr invalid în SQL'); return String(v) }
  const s = String(v)
  if (s.includes(NUL)) throw new Error('caracterul NUL nu e permis')
  return "'" + s.replace(/'/g, "''") + "'"
}
const litArr = a => `ARRAY[${a.map(lit).join(', ')}]::text[]`

/** Construiește SQL-ul. Întoarce { sql, raport } sau aruncă o eroare cu toate problemele găsite. */
export function genereazaSql({ proiect, nod, listaCsv, surse = {} }) {
  if (!Number.isInteger(proiect) || proiect <= 0) throw new Error('--proiect trebuie să fie un id întreg pozitiv')
  if (!RE_NOD.test(nod || '')) throw new Error('--nod trebuie să fie un cod cu majuscule, cifre și „-” (ex. NOD-CUPLARE-PRUNISOR)')
  const probleme = []
  const l = obiecteCsv(listaCsv)
  probleme.push(...l.erori)
  for (const k of ['cod', 'cod_detaliu', 'plansa_sursa', 'denumire', 'tip', 'grup', 'cantitate', 'um', 'etape', 'certitudine']) {
    if (l.antet.length && !l.antet.includes(k)) probleme.push(`Antetul nu are coloana „${k}”`)
  }
  const lista = mapeazaElemente(l.obiecte)
  probleme.push(...lista.erori)
  if (!lista.elemente.length) probleme.push('Lista nu are niciun element valid')
  if (probleme.length) throw new Error('Generarea s-a oprit:\n  ' + probleme.join('\n  '))

  const P = lit(proiect), N = lit(nod)
  const motivAnulare = lit(`import: lipsește din lista importată${surse.lista ? ` (sha256 ${surse.lista.slice(0, 12)})` : ''}`)
  const valori = lista.elemente.map(e => `  (${[e.cod, e.cod_detaliu, e.plansa_sursa, e.denumire, e.tip, e.grup, e.echipament, e.cantitate, e.um, e.pozitie,
    e.certitudine, e.observatii].map(lit).join(', ')}, ${litArr(e.etape)}, ${e.stadiu ? e.stadiu.k : 'NULL'}, ${e.stadiu ? `${lit(e.stadiu.data)}::date` : 'NULL'})`).join(',\n')
  const COL = 's.cod_detaliu, s.plansa_sursa, s.denumire, s.tip, s.grup, s.echipament, s.cantitate, s.um, s.pozitie, s.certitudine, s.observatii, s.etape'
  const COL_L = 'l.cod_detaliu, l.plansa_sursa, l.denumire, l.tip, l.grup, l.echipament, l.cantitate, l.um, l.pozitie, l.certitudine, l.observatii, l.etape'
  const cuStadiu = lista.elemente.filter(e => e.stadiu).length
  const sql = `-- Generat de scripts/noduri_constructii_import_sql.mjs la ${new Date().toISOString()}. NU intră în repo (date ale beneficiarului).
-- Proiect ${proiect}, nod ${nod}: ${lista.elemente.length} elemente, ${cuStadiu} cu stadiu inițial.
-- Surse: ${Object.entries(surse).map(([k, v]) => `${k} sha256 ${v}`).join('; ') || '—'}
-- Rulare: psql -X -v ON_ERROR_STOP=1 --single-transaction -f <acest fișier>
-- Upsert pe (proiect, nod, cod): descrierea și lista etapelor se actualizează (versiune + 1) doar dacă diferă; etapele bifate nu se ating.
-- IMPORTUL SE OPREȘTE (nimic scris) dacă: un element cu etape bifate lipsește din listă; lista nouă de etape a unui element bifat nu păstrează
-- etapele deja bifate (aceleași, în aceeași ordine); stadiul inițial cerut nu se regăsește în primele etape bifate (număr sau dată).
-- Elementele fără bifări care lipsesc din listă -> anulat (motiv „import: …”); un element anulat de un import și reapărut -> activ. Nimic nu se șterge.
SET LOCAL standard_conforming_strings = on;
SET LOCAL lock_timeout = '5s';
DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'import constructii: rulează ca postgres'; END IF;
  IF to_regclass('public.executie_noduri_constructii') IS NULL THEN RAISE EXCEPTION 'import constructii: migrarea 20261207a nu e aplicată'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.executie_proiecte WHERE id = ${P}) THEN RAISE EXCEPTION 'import constructii: proiectul ${proiect} nu există'; END IF;
END $pre$;
-- Ordinea lock-urilor (L06), ca în RPC: ÎNTÂI tabelul (SHARE ROW EXCLUSIVE: exclude RPC-ul, care ia ROW EXCLUSIVE înaintea rândului), APOI rândurile.
LOCK TABLE public.executie_noduri_constructii IN SHARE ROW EXCLUSIVE MODE;
DROP TABLE IF EXISTS pg_temp._constr_lista;   -- a doua rulare în aceeași tranzacție (harness)
CREATE TEMP TABLE _constr_lista (cod text PRIMARY KEY, cod_detaliu text NOT NULL, plansa_sursa text NOT NULL, denumire text NOT NULL, tip text NOT NULL,
  grup text NOT NULL, echipament text, cantitate numeric(10,2) NOT NULL, um text NOT NULL, pozitie text, certitudine text NOT NULL, observatii text,
  etape text[] NOT NULL, stadiu_k integer, stadiu_data date) ON COMMIT DROP;
INSERT INTO _constr_lista (cod, cod_detaliu, plansa_sursa, denumire, tip, grup, echipament, cantitate, um, pozitie, certitudine, observatii, etape, stadiu_k, stadiu_data) VALUES
${valori};
DO $import$
DECLARE v_noi integer; v_modif integer; v_react integer; v_anul integer; v_stadiu integer; v_pb text;
BEGIN
  -- 0. stadiul inițial nu poate avea o dată din viitor (Europe/Bucharest)
  SELECT string_agg(l.cod, ', ' ORDER BY l.cod) INTO v_pb FROM _constr_lista l WHERE l.stadiu_data > (now() AT TIME ZONE 'Europe/Bucharest')::date;
  IF v_pb IS NOT NULL THEN RAISE EXCEPTION 'import constructii: stadiu inițial cu dată în viitor la: %', v_pb; END IF;
  -- 1. un element cu etape bifate care lipsește din listă oprește importul (nu se anulează automat)
  SELECT string_agg(s.cod || ' (' || cardinality(s.etape_data) || ' etape bifate)', ', ' ORDER BY s.cod) INTO v_pb FROM public.executie_noduri_constructii s
   WHERE s.proiect_id = ${P} AND s.nod_cod = ${N} AND cardinality(s.etape_data) > 0
     AND NOT EXISTS (SELECT 1 FROM _constr_lista l WHERE l.cod = s.cod);
  IF v_pb IS NOT NULL THEN
    RAISE EXCEPTION 'import constructii: lipsesc din listă elemente cu etape bifate: % — se lămuresc întâi, importul nu le anulează', v_pb;
  END IF;
  -- 2. lista nouă de etape trebuie să păstreze etapele deja bifate (aceleași coduri, în aceeași ordine, la început)
  SELECT string_agg(s.cod, ', ' ORDER BY s.cod) INTO v_pb FROM public.executie_noduri_constructii s JOIN _constr_lista l ON l.cod = s.cod
   WHERE s.proiect_id = ${P} AND s.nod_cod = ${N} AND cardinality(s.etape_data) > 0
     AND (cardinality(l.etape) < cardinality(s.etape_data) OR l.etape[1:cardinality(s.etape_data)] IS DISTINCT FROM s.etape[1:cardinality(s.etape_data)]);
  IF v_pb IS NOT NULL THEN
    RAISE EXCEPTION 'import constructii: lista nouă de etape nu păstrează etapele deja bifate la: %', v_pb;
  END IF;
  -- 3. stadiul inițial se scrie doar pe elementele fără bifări; pe un element bifat, primele k etape bifate trebuie să fie exact stadiul cerut
  --    (aceleași k etape, toate cu data stadiului): reluarea aceluiași fișier trece și după bifări noi în aplicație; altă dată / alt k = oprire
  SELECT string_agg(s.cod, ', ' ORDER BY s.cod) INTO v_pb FROM public.executie_noduri_constructii s JOIN _constr_lista l ON l.cod = s.cod
   WHERE s.proiect_id = ${P} AND s.nod_cod = ${N} AND l.stadiu_k IS NOT NULL AND cardinality(s.etape_data) > 0
     AND (cardinality(s.etape_data) < l.stadiu_k OR s.etape_data[1:l.stadiu_k] IS DISTINCT FROM array_fill(l.stadiu_data, ARRAY[l.stadiu_k]));
  IF v_pb IS NOT NULL THEN
    RAISE EXCEPTION 'import constructii: stadiul inițial diferă de etapele deja bifate la: % (se lămurește în aplicație, nu prin import)', v_pb;
  END IF;
  -- 4. upsert: noile se adaugă; la cele existente se actualizează descrierea / etapele, și doar dacă diferă
  WITH u AS (
    INSERT INTO public.executie_noduri_constructii AS s (proiect_id, nod_cod, cod, cod_detaliu, plansa_sursa, denumire, tip, grup, echipament, cantitate, um,
      pozitie, certitudine, observatii, etape)
    SELECT ${P}, ${N}, l.cod, ${COL_L} FROM _constr_lista l ORDER BY l.cod
    ON CONFLICT (proiect_id, nod_cod, cod) DO UPDATE SET cod_detaliu = EXCLUDED.cod_detaliu, plansa_sursa = EXCLUDED.plansa_sursa, denumire = EXCLUDED.denumire,
      tip = EXCLUDED.tip, grup = EXCLUDED.grup, echipament = EXCLUDED.echipament, cantitate = EXCLUDED.cantitate, um = EXCLUDED.um, pozitie = EXCLUDED.pozitie,
      certitudine = EXCLUDED.certitudine, observatii = EXCLUDED.observatii, etape = EXCLUDED.etape, versiune = s.versiune + 1
    WHERE (${COL}) IS DISTINCT FROM (EXCLUDED.cod_detaliu, EXCLUDED.plansa_sursa, EXCLUDED.denumire, EXCLUDED.tip, EXCLUDED.grup, EXCLUDED.echipament,
      EXCLUDED.cantitate, EXCLUDED.um, EXCLUDED.pozitie, EXCLUDED.certitudine, EXCLUDED.observatii, EXCLUDED.etape)
    RETURNING (xmax = 0) AS nou)
  SELECT count(*) FILTER (WHERE nou), count(*) FILTER (WHERE NOT nou) INTO v_noi, v_modif FROM u;
  -- 5. anulate de un import anterior și reapărute în listă -> activ
  UPDATE public.executie_noduri_constructii s SET stare = 'activ', motiv = NULL, versiune = s.versiune + 1
   WHERE s.proiect_id = ${P} AND s.nod_cod = ${N} AND s.stare = 'anulat' AND s.motiv LIKE 'import: %'
     AND EXISTS (SELECT 1 FROM _constr_lista l WHERE l.cod = s.cod);
  GET DIAGNOSTICS v_react = ROW_COUNT;
  -- 6. lipsă din listă și fără bifări -> anulat (nu se șterg)
  UPDATE public.executie_noduri_constructii s SET stare = 'anulat', motiv = ${motivAnulare}, versiune = s.versiune + 1
   WHERE s.proiect_id = ${P} AND s.nod_cod = ${N} AND s.stare = 'activ' AND cardinality(s.etape_data) = 0
     AND NOT EXISTS (SELECT 1 FROM _constr_lista l WHERE l.cod = s.cod);
  GET DIAGNOSTICS v_anul = ROW_COUNT;
  -- 7. stadiul inițial: primele k etape făcute la data dată, fără utilizator (etape_de NULL = „din import”), doar pe elementele fără bifări
  UPDATE public.executie_noduri_constructii s SET etape_data = array_fill(l.stadiu_data, ARRAY[l.stadiu_k]),
         etape_de = array_fill(NULL::uuid, ARRAY[l.stadiu_k]), etape_la = array_fill(now(), ARRAY[l.stadiu_k]), versiune = s.versiune + 1
    FROM _constr_lista l
   WHERE s.proiect_id = ${P} AND s.nod_cod = ${N} AND s.cod = l.cod AND l.stadiu_k IS NOT NULL AND cardinality(s.etape_data) = 0;
  GET DIAGNOSTICS v_stadiu = ROW_COUNT;
  -- postcondiții: fiecare cod din fișier e pe nod, activ, cu descrierea / etapele din fișier și (dacă e cerut) cu stadiul cerut
  IF EXISTS (SELECT 1 FROM _constr_lista l LEFT JOIN public.executie_noduri_constructii s ON s.proiect_id = ${P} AND s.nod_cod = ${N} AND s.cod = l.cod
              WHERE s.id IS NULL OR s.stare <> 'activ'
                 OR (${COL}) IS DISTINCT FROM (${COL_L})
                 OR (l.stadiu_k IS NOT NULL AND (cardinality(s.etape_data) < l.stadiu_k
                     OR s.etape_data[1:l.stadiu_k] IS DISTINCT FROM array_fill(l.stadiu_data, ARRAY[l.stadiu_k])))) THEN
    RAISE EXCEPTION 'import constructii: nu toate elementele din fișier sunt pe nod, active și la zi (un element anulat manual se lămurește întâi)';
  END IF;
  RAISE NOTICE 'import constructii %: % noi, % actualizate, % reactivate, % anulate (lipsă din listă), % cu stadiu inițial scris',
    ${N}, v_noi, v_modif, v_react, v_anul, v_stadiu;
END $import$;
`
  return { sql, raport: { elemente: lista.elemente.length, cuStadiu, avertismente: lista.avertismente } }
}

// ── linia de comandă ──
function argumente(argv) {
  const a = {}
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i]
    if (!['--proiect', '--nod', '--lista', '--iesire'].includes(k) || argv[i + 1] == null) throw new Error(`argument necunoscut sau fără valoare: ${k}`)
    a[k.slice(2)] = argv[i + 1]
  }
  for (const k of ['proiect', 'nod', 'lista', 'iesire']) if (!a[k]) throw new Error(`lipsește --${k}`)
  return a
}
const sha = buf => createHash('sha256').update(buf).digest('hex')

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const a = argumente(process.argv.slice(2))
    const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
    const iesire = resolve(a.iesire)
    const rel = relative(repo, iesire)
    if (!rel.startsWith('..') && !isAbsolute(rel)) throw new Error('ieșirea conține date ale beneficiarului: scrie-o în afara repo-ului')
    const lista = readFileSync(a.lista)
    const { sql, raport } = genereazaSql({ proiect: Number(a.proiect), nod: a.nod, listaCsv: lista.toString('utf8'), surse: { lista: sha(lista) } })
    writeFileSync(iesire, sql, 'utf8')
    console.log(`Scris ${iesire}: ${raport.elemente} elemente, ${raport.cuStadiu} cu stadiu inițial.`)
    for (const x of raport.avertismente) console.log('  avertisment: ' + x)
  } catch (e) {
    console.error(e.message || e)
    process.exit(1)
  }
}
