#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// noduri_cuplare_import_sql.mjs — generează SQL-ul de încărcare a sudurilor unui nod de cuplare + punctele de pe schemă
// în executie_noduri_suduri (migrarea 20261201a). Îl rulează CHAT-UL, după aplicarea migrării și cu „da”-ul lui Răzvan:
//   node scripts/noduri_cuplare_import_sql.mjs --proiect <id> --nod <NOD-COD> --lista <lista.csv>
//        [--puncte <puncte_propuse.csv> --vederi <vederi.json>] --iesire <fisier.sql în AFARA repo-ului>
//   psql -X -v ON_ERROR_STOP=1 --single-transaction -f <fisier.sql>
// Datele (lista, coordonatele, desenul) sunt ale beneficiarului și repo-ul e public: ieșirea NU se scrie în repo (refuz).
// Parsarea e cea din src/nodCuplareLogica.js (aceeași definiție ca în teste). SQL-ul e idempotent: sudurile existente
// nu se suprascriu (cele cu alte valori se raportează), codurile doar din BD nu se ating, punctele se scriu doar dacă diferă.
// Orice eroare de parsare (cod invalid / duplicat, DN, câmp prea lung, punct fără sudură / vedere) oprește generarea.
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, relative, isAbsolute, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { obiecteCsv, mapeazaLista, mapeazaPuncte, parseManifest } from '../src/nodCuplareLogica.js'

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

/**
 * Construiește SQL-ul. Întoarce { sql, raport } sau aruncă o eroare cu toate problemele găsite.
 * listaCsv / puncteCsv: textul fișierelor; manifest: obiectul din vederi.json (obligatoriu dacă există puncte).
 */
export function genereazaSql({ proiect, nod, listaCsv, puncteCsv = null, manifest = null, surse = {} }) {
  if (!Number.isInteger(proiect) || proiect <= 0) throw new Error('--proiect trebuie să fie un id întreg pozitiv')
  if (!RE_NOD.test(nod || '')) throw new Error('--nod trebuie să fie un cod cu majuscule, cifre și „-” (ex. NOD-CUPLARE-PRUNISOR)')
  const probleme = []
  const l = obiecteCsv(listaCsv)
  probleme.push(...l.erori)
  const lista = mapeazaLista(l.obiecte)
  probleme.push(...lista.erori)
  let puncte = { puncte: [], erori: [], ignorate: [] }
  if (puncteCsv != null) {
    if (!manifest) probleme.push('Punctele cer manifestul vederilor (--vederi vederi.json)')
    const m = parseManifest(manifest || [])
    probleme.push(...m.erori.map(e => 'vederi.json: ' + e))
    const p = obiecteCsv(puncteCsv)
    probleme.push(...p.erori.map(e => 'puncte: ' + e))
    puncte = mapeazaPuncte(p.obiecte, { coduri: new Set(lista.suduri.map(s => s.cod)), vederi: new Set(m.vederi.map(v => v.vedere)) })
    probleme.push(...puncte.erori.map(e => 'puncte: ' + e))
  }
  if (!lista.suduri.length) probleme.push('Lista nu are nicio sudură validă')
  if (probleme.length) throw new Error('Generarea s-a oprit:\n  ' + probleme.join('\n  '))

  const P = lit(proiect), N = lit(nod)
  const motivAnulare = lit(`import: lipsește din lista importată${surse.lista ? ` (sha256 ${surse.lista.slice(0, 12)})` : ''}`)
  const valoriLista = lista.suduri.map(s => `  (${[s.cod, s.subansamblu, s.dn, s.diametru, s.poz1, s.poz2, s.certitudine].map(lit).join(', ')})`).join(',\n')
  const valoriPuncte = puncte.puncte.map(p => `  (${[p.cod, p.vedere, p.x, p.y, p.certitudine].map(lit).join(', ')}, ${lit(JSON.stringify(p.secundare))}::jsonb)`).join(',\n')
  const COL = 's.subansamblu, s.dn, s.diametru, s.poz1, s.poz2, s.certitudine'
  const sql = `-- Generat de scripts/noduri_cuplare_import_sql.mjs la ${new Date().toISOString()}. NU intră în repo (date ale beneficiarului).
-- Proiect ${proiect}, nod ${nod}: ${lista.suduri.length} suduri, ${puncte.puncte.length} suduri cu puncte.
-- Surse: ${Object.entries(surse).map(([k, v]) => `${k} sha256 ${v}`).join('; ') || '—'}
-- Rulare: psql -X -v ON_ERROR_STOP=1 --single-transaction -f <acest fișier>
-- Upsert pe (proiect, nod, cod): descrierea se actualizează (versiune + 1), starea / sudorul / NDT nu se ating. Codurile care lipsesc
-- din listă: de executat / însăilate -> anulat (motiv „import: …”); deja sudate -> IMPORTUL SE OPREȘTE (se lămuresc întâi).
-- O sudură anulată de un import și reapărută în listă revine la „de executat”. Nimic nu se șterge.
SET LOCAL standard_conforming_strings = on;
SET LOCAL lock_timeout = '5s';
DO $pre$
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'import nod: rulează ca postgres'; END IF;
  IF to_regclass('public.executie_noduri_suduri') IS NULL THEN RAISE EXCEPTION 'import nod: migrarea 20261201a nu e aplicată'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.executie_proiecte WHERE id = ${P}) THEN RAISE EXCEPTION 'import nod: proiectul ${proiect} nu există'; END IF;
END $pre$;
LOCK TABLE public.executie_noduri_suduri IN SHARE ROW EXCLUSIVE MODE;
DROP TABLE IF EXISTS pg_temp._nod_lista, pg_temp._nod_puncte;   -- a doua rulare în aceeași tranzacție (harness)
CREATE TEMP TABLE _nod_lista (cod text PRIMARY KEY, subansamblu text NOT NULL, dn integer, diametru text, poz1 text, poz2 text, certitudine text NOT NULL) ON COMMIT DROP;
INSERT INTO _nod_lista (cod, subansamblu, dn, diametru, poz1, poz2, certitudine) VALUES
${valoriLista};
CREATE TEMP TABLE _nod_puncte (cod text PRIMARY KEY, vedere text NOT NULL, x numeric(6,3) NOT NULL, y numeric(6,3) NOT NULL, cert text, sec jsonb NOT NULL) ON COMMIT DROP;
${valoriPuncte ? `INSERT INTO _nod_puncte (cod, vedere, x, y, cert, sec) VALUES\n${valoriPuncte};` : '-- fără puncte'}
DO $import$
DECLARE v_noi integer; v_modif integer; v_react integer; v_anul integer; v_pct integer; v_sudate text;
BEGIN
  -- 1. o sudură deja sudată care lipsește din listă oprește importul (nu se anulează automat)
  SELECT string_agg(s.cod || ' (' || s.stare || ')', ', ' ORDER BY s.cod) INTO v_sudate FROM public.executie_noduri_suduri s
   WHERE s.proiect_id = ${P} AND s.nod_cod = ${N} AND s.stare IN ('sudat', 'ndt', 'acceptat', 'reparat')
     AND NOT EXISTS (SELECT 1 FROM _nod_lista l WHERE l.cod = s.cod);
  IF v_sudate IS NOT NULL THEN
    RAISE EXCEPTION 'import nod: lipsesc din listă suduri deja sudate: % — se lămuresc întâi, importul nu le anulează', v_sudate;
  END IF;
  -- 2. upsert: noile se adaugă; la cele existente se actualizează doar descrierea, și doar dacă diferă
  WITH u AS (
    INSERT INTO public.executie_noduri_suduri AS s (proiect_id, nod_cod, cod, subansamblu, dn, diametru, poz1, poz2, certitudine)
    SELECT ${P}, ${N}, l.cod, l.subansamblu, l.dn, l.diametru, l.poz1, l.poz2, l.certitudine FROM _nod_lista l ORDER BY l.cod
    ON CONFLICT (proiect_id, nod_cod, cod) DO UPDATE SET subansamblu = EXCLUDED.subansamblu, dn = EXCLUDED.dn, diametru = EXCLUDED.diametru,
      poz1 = EXCLUDED.poz1, poz2 = EXCLUDED.poz2, certitudine = EXCLUDED.certitudine, versiune = s.versiune + 1
    WHERE (${COL}) IS DISTINCT FROM (EXCLUDED.subansamblu, EXCLUDED.dn, EXCLUDED.diametru, EXCLUDED.poz1, EXCLUDED.poz2, EXCLUDED.certitudine)
    RETURNING (xmax = 0) AS nou)
  SELECT count(*) FILTER (WHERE nou), count(*) FILTER (WHERE NOT nou) INTO v_noi, v_modif FROM u;
  -- 3. anulate de un import anterior și reapărute în listă -> de executat
  UPDATE public.executie_noduri_suduri s SET stare = 'de_executat', data_stare = NULL, motiv = NULL, versiune = s.versiune + 1
   WHERE s.proiect_id = ${P} AND s.nod_cod = ${N} AND s.stare = 'anulat' AND s.motiv LIKE 'import: %'
     AND EXISTS (SELECT 1 FROM _nod_lista l WHERE l.cod = s.cod);
  GET DIAGNOSTICS v_react = ROW_COUNT;
  -- 4. lipsă din listă și nesudate -> anulat (nu se șterg)
  UPDATE public.executie_noduri_suduri s SET stare = 'anulat', motiv = ${motivAnulare},
         data_stare = greatest(coalesce(s.data_stare, '-infinity'::date), (now() AT TIME ZONE 'Europe/Bucharest')::date), versiune = s.versiune + 1
   WHERE s.proiect_id = ${P} AND s.nod_cod = ${N} AND s.stare IN ('de_executat', 'insailat')
     AND NOT EXISTS (SELECT 1 FROM _nod_lista l WHERE l.cod = s.cod);
  GET DIAGNOSTICS v_anul = ROW_COUNT;
  -- 5. punctele: vederea principală + celelalte vederi, scrise doar dacă diferă
  UPDATE public.executie_noduri_suduri s SET vedere = p.vedere, x_pct = p.x, y_pct = p.y, pozitie_certitudine = p.cert, pozitii_secundare = p.sec
    FROM _nod_puncte p
   WHERE s.proiect_id = ${P} AND s.nod_cod = ${N} AND s.cod = p.cod
     AND (s.vedere, s.x_pct, s.y_pct, s.pozitie_certitudine, s.pozitii_secundare) IS DISTINCT FROM (p.vedere, p.x, p.y, p.cert, p.sec);
  GET DIAGNOSTICS v_pct = ROW_COUNT;
  -- postcondiții: fiecare cod din fișier e pe nod, cu descrierea din fișier și activ; fiecare punct e pe sudura lui
  IF EXISTS (SELECT 1 FROM _nod_lista l LEFT JOIN public.executie_noduri_suduri s ON s.proiect_id = ${P} AND s.nod_cod = ${N} AND s.cod = l.cod
              WHERE s.id IS NULL OR s.stare = 'anulat'
                 OR (${COL}) IS DISTINCT FROM (l.subansamblu, l.dn, l.diametru, l.poz1, l.poz2, l.certitudine)) THEN
    RAISE EXCEPTION 'import nod: nu toate sudurile din fișier sunt pe nod, active și la zi (o sudură anulată manual se lămurește întâi)';
  END IF;
  IF EXISTS (SELECT 1 FROM _nod_puncte p LEFT JOIN public.executie_noduri_suduri s ON s.proiect_id = ${P} AND s.nod_cod = ${N} AND s.cod = p.cod
              WHERE s.id IS NULL OR (s.vedere, s.x_pct, s.y_pct, s.pozitii_secundare) IS DISTINCT FROM (p.vedere, p.x, p.y, p.sec)) THEN
    RAISE EXCEPTION 'import nod: punctele nu au ajuns pe sudurile lor';
  END IF;
  RAISE NOTICE 'import nod %: % noi, % cu descrierea actualizată, % reactivate, % anulate (lipsă din listă), % cu punctele scrise',
    ${N}, v_noi, v_modif, v_react, v_anul, v_pct;
END $import$;
`
  return { sql, raport: { suduri: lista.suduri.length, avertismente: lista.avertismente, puncte: puncte.puncte.length, puncteIgnorate: puncte.ignorate } }
}

// ── linia de comandă ──
function argumente(argv) {
  const a = {}
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i]
    if (!['--proiect', '--nod', '--lista', '--puncte', '--vederi', '--iesire'].includes(k) || argv[i + 1] == null) throw new Error(`argument necunoscut sau fără valoare: ${k}`)
    a[k.slice(2)] = argv[i + 1]
  }
  for (const k of ['proiect', 'nod', 'lista', 'iesire']) if (!a[k]) throw new Error(`lipsește --${k}`)
  if (!!a.puncte !== !!a.vederi) throw new Error('--puncte și --vederi merg împreună')
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
    const puncte = a.puncte ? readFileSync(a.puncte) : null
    const vederi = a.vederi ? readFileSync(a.vederi) : null
    const surse = { lista: sha(lista), ...(puncte ? { puncte: sha(puncte), vederi: sha(vederi) } : {}) }
    const { sql, raport } = genereazaSql({
      proiect: Number(a.proiect), nod: a.nod, listaCsv: lista.toString('utf8'),
      puncteCsv: puncte ? puncte.toString('utf8') : null, manifest: vederi ? JSON.parse(vederi.toString('utf8').replace(/^\s+/, '').replace(new RegExp('^' + String.fromCharCode(0xFEFF)), '')) : null, surse,
    })
    writeFileSync(iesire, sql, 'utf8')
    console.log(`Scris ${iesire}: ${raport.suduri} suduri, ${raport.puncte} puncte.`)
    for (const x of raport.avertismente) console.log('  avertisment: ' + x)
    for (const x of raport.puncteIgnorate) console.log('  punct ignorat: ' + x)
  } catch (e) {
    console.error(e.message || e)
    process.exit(1)
  }
}
