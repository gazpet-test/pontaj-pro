// ═══════════════════════════════════════════════════════════════════════════
// fibra_camerete_import_sql.mjs — generează SQL-ul de încărcare a listei de camerete din proiect în executie_fibra_camerete
// (migrarea 20261211a). Îl rulează CHAT-UL, după aplicarea migrării și cu „da”-ul lui Răzvan:
//   node scripts/fibra_camerete_import_sql.mjs --proiect <id> --lista <camerete.csv> --iesire <fisier.sql în AFARA repo-ului>
//   psql -X -v ON_ERROR_STOP=1 --single-transaction -f <fisier.sql>
// CSV-ul (separator „;”, antet obligatoriu): tronson;cod;km_m — tronson = codul tronsonului din Execuție (ex. T1), cod = codul
// cameretei (litere mari, cifre, . / _ -), km_m = metri întregi de la originea traseului („12350”) sau „12+350”.
// Datele (pozițiile cameretelor) sunt ale beneficiarului și repo-ul e public: ieșirea NU se scrie în repo (refuz).
// SQL-ul e idempotent: cameretele existente cu același cod (pe același tronson și km) nu se ating; un cod existent cu alt tronson /
// km OPREȘTE importul (se lămurește întâi); cameretele din proiect care lipsesc din fișier doar se raportează (nu se scot automat).
// Limitele tronsonului și proiectul le verifică trigger-ul din baza de date (pe orice cale). Orice eroare de parsare oprește generarea.
// Ordinea lock-urilor (L06): tronsoanele proiectului ORDER BY id FOR NO KEY UPDATE, apoi cameretele (aceeași ordine ca RPC-urile).
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, relative, isAbsolute, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { obiecteCsv } from '../src/nodCuplareLogica.js'
import { parseKm, RE_COD_CAMERETA, normCodCamereta } from '../src/fibraOpticaLogica.js'

const RE_TRONSON = /^[^;"\r\n]{1,60}$/
const NUL = String.fromCharCode(0)
/** literal SQL (standard_conforming_strings = on): ghilimelele simple dublate; NUL refuzat. Aceeași formă ca lit() din
 *  noduri_cuplare_import_sql.mjs (nu-l importăm: are shebang, iar la checkout CRLF importul lui pică în vitest). */
export function lit(v) {
  if (v == null) return 'NULL'
  if (typeof v === 'number') { if (!Number.isFinite(v)) throw new Error('număr invalid în SQL'); return String(v) }
  const s = String(v)
  if (s.includes(NUL)) throw new Error('caracterul NUL nu e permis')
  return "'" + s.replace(/'/g, "''") + "'"
}

/** Lista din CSV -> { camerete: [{rand, tronson, cod, km_m}], erori } (nimic nu dispare tacit: fiecare rând greșit e o eroare). */
export function mapeazaCamerete(text) {
  const { antet, obiecte, erori } = obiecteCsv(text)
  const e = [...erori]
  const lipsa = ['tronson', 'cod', 'km_m'].filter(k => !antet.includes(k))
  if (lipsa.length) return { camerete: [], erori: [...e, ...lipsa.map(k => `Antetul nu are coloana „${k}” (cere: tronson;cod;km_m)`)] }
  // rândurile structural greșite sunt deja în `erori`; restul se verifică toate, ca omul să vadă toate problemele odată
  const camerete = [], vazute = new Map()
  for (const o of obiecte) {
    const tronson = String(o.tronson ?? '').trim()
    const cod = normCodCamereta(o.cod)
    const km = parseKm(o.km_m)
    const r = `Rândul ${o._rand}`
    if (!RE_TRONSON.test(tronson)) { e.push(`${r}: tronsonul lipsește`); continue }
    if (!RE_COD_CAMERETA.test(cod)) { e.push(`${r}: codul „${o.cod}” nu e valid (litere mari, cifre și . / _ -, cel mult 30)`); continue }
    if (km == null || !Number.isInteger(km) || km < 0 || km > 9999999) { e.push(`${r} (${cod}): km „${o.km_m}” nu e valid (metri întregi sau 12+350)`); continue }
    if (vazute.has(cod)) { e.push(`${r}: codul ${cod} apare de două ori (și la rândul ${vazute.get(cod)})`); continue }
    vazute.set(cod, o._rand)
    camerete.push({ rand: o._rand, tronson, cod, km_m: km })
  }
  if (!camerete.length && !e.length) e.push('Lista nu are nicio cameretă')
  return { camerete, erori: e }
}

/** Construiește SQL-ul. Întoarce { sql, raport } sau aruncă o eroare cu toate problemele găsite. */
export function genereazaSql({ proiect, listaCsv, sursa = null }) {
  if (!Number.isInteger(proiect) || proiect <= 0) throw new Error('--proiect trebuie să fie un id întreg pozitiv')
  const { camerete, erori } = mapeazaCamerete(listaCsv)
  if (erori.length) throw new Error('Generarea s-a oprit:\n  ' + erori.join('\n  '))
  const P = lit(proiect)
  const valori = camerete.map(c => `  (${[c.rand, c.tronson, c.cod, c.km_m].map(lit).join(', ')})`).join(',\n')
  const sql = `-- Generat de scripts/fibra_camerete_import_sql.mjs la ${new Date().toISOString()}. NU intră în repo (date ale beneficiarului).
-- Proiect ${proiect}: ${camerete.length} camerete în fișier.${sursa ? ` Sursa: sha256 ${sursa}.` : ''}
-- Rulare: psql -X -v ON_ERROR_STOP=1 --single-transaction -f <acest fișier>
-- Cameretele noi intră „de montat” (sursa = proiect); cele existente identice nu se ating; un cod existent cu alt tronson / km oprește
-- importul; cameretele din proiect lipsă din fișier doar se raportează. Nimic nu se șterge.
SET LOCAL lock_timeout = '5s';
DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'import camerete: rulează ca postgres'; END IF;
  IF to_regclass('public.executie_fibra_camerete') IS NULL THEN RAISE EXCEPTION 'import camerete: migrarea 20261211a nu e aplicată'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.executie_proiecte WHERE id = ${P}) THEN RAISE EXCEPTION 'import camerete: proiectul ${proiect} nu există'; END IF;
  -- importul scrie fără identitate de aplicație (sursa = proiect)
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'import camerete: sesiunea are identitate JWT (rulează fără request.jwt.*)'; END IF;
END $pre$;
-- ordinea lock-urilor: tronsoanele proiectului (ORDER BY id), ca RPC-urile (tronson -> camerete)
SELECT count(*) AS tronsoane_blocate FROM (SELECT id FROM public.executie_tronsoane WHERE proiect_id = ${P} ORDER BY id FOR NO KEY UPDATE) x;
DROP TABLE IF EXISTS pg_temp._fo_camerete;   -- a doua rulare în aceeași tranzacție (harness)
CREATE TEMP TABLE _fo_camerete (rand integer NOT NULL, tronson text NOT NULL, cod text PRIMARY KEY, km_m integer NOT NULL) ON COMMIT DROP;
INSERT INTO _fo_camerete (rand, tronson, cod, km_m) VALUES
${valori};
DO $import$
DECLARE v_lipsa text; v_dif text; v_noi integer; v_exist integer; v_absente integer; v_lista_absente text;
BEGIN
  -- 1. fiecare tronson din fișier există pe proiect
  SELECT string_agg(DISTINCT l.tronson, ', ') INTO v_lipsa FROM _fo_camerete l
   WHERE NOT EXISTS (SELECT 1 FROM public.executie_tronsoane t WHERE t.proiect_id = ${P} AND t.cod = l.tronson);
  IF v_lipsa IS NOT NULL THEN RAISE EXCEPTION 'import camerete: tronsoane care nu există pe proiect: %', v_lipsa; END IF;
  -- 2. un cod deja în listă (nescos) cu alt tronson / km oprește importul
  SELECT string_agg(l.cod || ' (fișier ' || l.tronson || ' km ' || l.km_m || ', în ERP ' || t.cod || ' km ' || c.km_m || ')', '; ' ORDER BY l.rand) INTO v_dif
    FROM _fo_camerete l JOIN public.executie_fibra_camerete c ON c.proiect_id = ${P} AND c.cod = l.cod AND c.stare <> 'anulata'
    JOIN public.executie_tronsoane t ON t.id = c.tronson_id
   WHERE t.cod <> l.tronson OR c.km_m <> l.km_m;
  IF v_dif IS NOT NULL THEN RAISE EXCEPTION 'import camerete: coduri existente cu alt tronson / km: % — se lămuresc întâi, importul nu le schimbă', v_dif; END IF;
  SELECT count(*) INTO v_exist FROM _fo_camerete l
   WHERE EXISTS (SELECT 1 FROM public.executie_fibra_camerete c WHERE c.proiect_id = ${P} AND c.cod = l.cod AND c.stare <> 'anulata');
  -- 3. cele noi (trigger-ul verifică limitele tronsonului, proiectul și pune sursa = proiect)
  INSERT INTO public.executie_fibra_camerete (proiect_id, tronson_id, cod, km_m)
  SELECT ${P}, t.id, l.cod, l.km_m FROM _fo_camerete l JOIN public.executie_tronsoane t ON t.proiect_id = ${P} AND t.cod = l.tronson
   WHERE NOT EXISTS (SELECT 1 FROM public.executie_fibra_camerete c WHERE c.proiect_id = ${P} AND c.cod = l.cod AND c.stare <> 'anulata')
   ORDER BY l.rand;
  GET DIAGNOSTICS v_noi = ROW_COUNT;
  -- 4. cameretele din proiect care lipsesc din fișier: doar raportate
  SELECT count(*), string_agg(c.cod, ', ' ORDER BY c.cod) INTO v_absente, v_lista_absente FROM public.executie_fibra_camerete c
   WHERE c.proiect_id = ${P} AND c.sursa = 'proiect' AND c.stare <> 'anulata' AND NOT EXISTS (SELECT 1 FROM _fo_camerete l WHERE l.cod = c.cod);
  -- postcondiție: fiecare cod din fișier e în listă, pe tronsonul și km-ul lui
  IF EXISTS (SELECT 1 FROM _fo_camerete l
              LEFT JOIN public.executie_fibra_camerete c ON c.proiect_id = ${P} AND c.cod = l.cod AND c.stare <> 'anulata'
              LEFT JOIN public.executie_tronsoane t ON t.id = c.tronson_id
              WHERE c.id IS NULL OR t.cod IS DISTINCT FROM l.tronson OR c.km_m <> l.km_m) THEN
    RAISE EXCEPTION 'import camerete: nu toate cameretele din fișier sunt în listă, pe tronsonul și km-ul lor';
  END IF;
  RAISE NOTICE 'import camerete proiect %: % noi, % existau deja (identice), % din proiect lipsesc din fișier%',
    ${P}, v_noi, v_exist, v_absente, CASE WHEN v_absente > 0 THEN ': ' || v_lista_absente ELSE '' END;
END $import$;
`
  return { sql, raport: { camerete: camerete.length, tronsoane: [...new Set(camerete.map(c => c.tronson))] } }
}

// ── linia de comandă ──
function argumente(argv) {
  const a = {}
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i]
    if (!['--proiect', '--lista', '--iesire'].includes(k) || argv[i + 1] == null) throw new Error(`argument necunoscut sau fără valoare: ${k}`)
    a[k.slice(2)] = argv[i + 1]
  }
  for (const k of ['proiect', 'lista', 'iesire']) if (!a[k]) throw new Error(`lipsește --${k}`)
  return a
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const a = argumente(process.argv.slice(2))
    const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
    const iesire = resolve(a.iesire)
    const rel = relative(repo, iesire)
    if (!rel.startsWith('..') && !isAbsolute(rel)) throw new Error('ieșirea conține date ale beneficiarului: scrie-o în afara repo-ului')
    const lista = readFileSync(a.lista)
    const { sql, raport } = genereazaSql({ proiect: Number(a.proiect), listaCsv: lista.toString('utf8'), sursa: createHash('sha256').update(lista).digest('hex') })
    writeFileSync(iesire, sql, 'utf8')
    console.log(`Scris ${iesire}: ${raport.camerete} camerete pe tronsoanele ${raport.tronsoane.join(', ')}.`)
  } catch (e) {
    console.error(e.message || e)
    process.exit(1)
  }
}
