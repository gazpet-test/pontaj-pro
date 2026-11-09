// (fără shebang: la checkout cu CRLF pe Windows, un shebang face vitest să pice la import; se rulează cu „node scripts/…”)
// Generează SQL-ul de import al fișei de contract (executie_contract_repere, migrarea 20261203a) dintr-un JSON cu secțiunile
// { clauze[], cai[], termene[], evenimente[], surse[] } (fiecare rând: cod, titlu + câmpurile secțiunii, ca în src/executieContractRepere.js).
// Utilizare:  node scripts/contract_repere_import_sql.mjs <date.json> --proiect-regex '<regex pe executie_proiecte.nume>' > import.sql
// SQL-ul NU conține id-ul proiectului: operatorul (chat-ul, ca postgres, în tranzacția lui) setează întâi
//   SELECT set_config('gazpet.import_contract_proiect', '<id>', true);
// iar importul refuză dacă proiectul nu există sau numele nu se potrivește cu regex-ul (gardă împotriva proiectului greșit).
// Ce face importul: upsert pe (proiect_id, sectiune, cod); rândurile modificate din aplicație (modificat_de nenul) NU se suprascriu
// (apar în NOTICE); nimic nu se șterge; reluarea e idempotentă (rândurile identice nu se ating, versiunea nu crește).
// Validarea e strictă (L12): un câmp necunoscut pentru secțiune, o stare/putere/dată invalidă, un text peste limită sau un text cu
// mențiuni interzise în ERP = refuz, fără SQL.
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename } from 'node:path'
import { CAMPURI, CAMPURI_DATA, LIMITE, STARI, PUTERI, ziNr } from '../src/executieContractRepere.js'

export const GRUPE = [['clauze', 'clauza'], ['cai', 'cale'], ['termene', 'termen'], ['evenimente', 'eveniment'], ['surse', 'sursa']]
export const COLOANE_IMPORT = ['sectiune', 'cod', 'ordine', 'titlu', 'clauze', 'continut', 'citat', 'conditie', 'dovezi', 'dovezi_lipsa', 'termen_text', 'efect',
  'data_eveniment', 'notificare', 'raspuns', 'stare', 'termen_urmator', 'termen_ce', 'putere', 'sursa']
const TIP = { ordine: 'integer', data_eveniment: 'date', termen_urmator: 'date' }
// texte care nu au ce căuta într-un ecran văzut de colegi (fără mențiuni de unelte interne / AI)
// („AI” / „Paw” cu majusculă exactă: „ai” e cuvânt românesc obișnuit)
const INTERZIS_EXACT = /\b(AI|LLM|Paw)\b/
const INTERZIS_ORICUM = /\b(Rocky|Claude|ChatGPT|Gemini|Jakarinos|Codex|Copilot)\b|paw-data|_lucru|\breview\b/i
export const interzis = v => INTERZIS_EXACT.test(v) || INTERZIS_ORICUM.test(v)

const lit = v => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`)

export function randuri(date) {
  const out = []
  const vazute = new Set()
  for (const [grup, sectiune] of GRUPE) {
    const lista = date[grup] ?? []
    if (!Array.isArray(lista)) throw new Error(`${grup}: trebuie să fie listă`)
    lista.forEach((x, i) => {
      const unde = `${grup}[${i}] (${x?.cod ?? '?'})`
      if (!x || typeof x !== 'object') throw new Error(`${unde}: rând invalid`)
      const permise = new Set(['cod', 'titlu', 'ordine', ...CAMPURI[sectiune].map(([c]) => c)])
      for (const k of Object.keys(x)) if (!permise.has(k)) throw new Error(`${unde}: câmpul „${k}” nu există pentru secțiunea ${sectiune}`)
      if (typeof x.cod !== 'string' || !/^[A-Z]{1,3}[0-9]{1,4}$/.test(x.cod)) throw new Error(`${unde}: cod invalid`)
      if (vazute.has(sectiune + ':' + x.cod)) throw new Error(`${unde}: cod duplicat în secțiune`)
      vazute.add(sectiune + ':' + x.cod)
      const r = { sectiune, cod: x.cod, ordine: x.ordine ?? (i + 1) * 10 }
      if (!Number.isInteger(r.ordine) || r.ordine < 0 || r.ordine > 99999) throw new Error(`${unde}: ordine invalidă`)
      for (const c of COLOANE_IMPORT.slice(3)) {
        let v = x[c]
        if (v === undefined || v === null) { r[c] = null; continue }
        if (typeof v !== 'string') throw new Error(`${unde}: „${c}” trebuie să fie text`)
        v = v.trim()
        if (v === '') { r[c] = null; continue }
        if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v)) throw new Error(`${unde}: „${c}” conține caractere de control`)
        if (interzis(v)) throw new Error(`${unde}: „${c}” conține o mențiune care nu intră în ERP`)
        if (CAMPURI_DATA.includes(c)) { if (ziNr(v) == null) throw new Error(`${unde}: „${c}” nu e o dată AAAA-LL-ZZ validă`) }
        else if (c === 'stare') { if (!STARI.includes(v)) throw new Error(`${unde}: stare necunoscută „${v}”`) }
        else if (c === 'putere') { if (!PUTERI.includes(v)) throw new Error(`${unde}: putere necunoscută „${v}”`) }
        else if (LIMITE[c] && v.length > LIMITE[c]) throw new Error(`${unde}: „${c}” are ${v.length} caractere (max ${LIMITE[c]})`)
        r[c] = v
      }
      if (!r.titlu) throw new Error(`${unde}: titlul lipsește`)
      if (sectiune === 'eveniment' && !r.stare) throw new Error(`${unde}: evenimentul nu are stare`)
      out.push(r)
    })
  }
  if (!out.length) throw new Error('niciun rând de importat')
  return out
}

export function genereaza(date, { regex, numeSursa = 'date.json', sha = '' }) {
  if (typeof regex !== 'string' || !regex.length || regex.length > 200 || /'/.test(regex)) throw new Error('--proiect-regex lipsă sau invalid')
  const rs = randuri(date)
  const cols = COLOANE_IMPORT
  const valori = rs.map(r => '    (' + cols.map(c => (r[c] == null ? `NULL::${TIP[c] || 'text'}` : TIP[c] === 'integer' ? String(r[c]) : TIP[c] === 'date' ? `${lit(r[c])}::date` : lit(r[c]))).join(', ') + ')').join(',\n')
  const fara = cols.filter(c => !['sectiune', 'cod'].includes(c))
  const tup = p => '(' + fara.map(c => `${p}.${c}`).join(', ') + ')'
  return `-- Import fișa contractului (executie_contract_repere) — generat de scripts/contract_repere_import_sql.mjs din ${basename(numeSursa)}${sha ? ' (sha256 ' + sha + ')' : ''}.
-- ${rs.length} rânduri. Rulează DOAR ca postgres, în tranzacția operatorului, DUPĂ: SELECT set_config('gazpet.import_contract_proiect', '<id>', true);
-- Garda: proiectul există și executie_proiecte.nume ~* '${regex}'. Upsert pe (proiect_id, sectiune, cod); rândurile modificate din aplicație
-- (modificat_de nenul) NU se suprascriu; nimic nu se șterge; reluarea e idempotentă. Ordinea lock-urilor: advisory pe proiect, apoi rândurile
-- (aceeași ca fn_executie_contract_salveaza).
DO $imp$
DECLARE
  v_txt text := current_setting('gazpet.import_contract_proiect', true);
  v_p bigint;
  v_scrise integer;
  v_sarite text;
  v_extra text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'import contract: rulează ca postgres'; END IF;
  IF v_txt IS NULL OR v_txt !~ '^[0-9]{1,18}$' THEN RAISE EXCEPTION 'import contract: setează întâi gazpet.import_contract_proiect'; END IF;
  v_p := v_txt::bigint;
  PERFORM set_config('search_path', 'public, pg_temp', true);
  IF NOT EXISTS (SELECT 1 FROM public.executie_proiecte WHERE id = v_p AND nume ~* '${regex}') THEN
    RAISE EXCEPTION 'import contract: proiectul % nu există sau nu e cel așteptat', v_p;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('executie_contract_repere:' || v_p, 0));
  DROP TABLE IF EXISTS pg_temp._imp_contract;
  CREATE TEMP TABLE _imp_contract (${cols.map(c => `${c} ${TIP[c] || 'text'}`).join(', ')}) ON COMMIT DROP;
  INSERT INTO _imp_contract (${cols.join(', ')}) VALUES
${valori};
  -- rândurile modificate din aplicație care diferă de fișier: rămân cum le-a lăsat utilizatorul
  SELECT string_agg(t.sectiune || ':' || t.cod, ', ' ORDER BY t.sectiune, t.cod) INTO v_sarite
    FROM public.executie_contract_repere t JOIN _imp_contract s ON s.sectiune = t.sectiune AND s.cod = t.cod
   WHERE t.proiect_id = v_p AND t.modificat_de IS NOT NULL AND ${tup('t')} IS DISTINCT FROM ${tup('s')};
  INSERT INTO public.executie_contract_repere AS t (proiect_id, ${cols.join(', ')})
  SELECT v_p, ${cols.map(c => 's.' + c).join(', ')} FROM _imp_contract s ORDER BY s.sectiune, s.cod
  ON CONFLICT (proiect_id, sectiune, cod) DO UPDATE SET
    ${fara.map(c => `${c} = EXCLUDED.${c}`).join(',\n    ')}
  WHERE t.modificat_de IS NULL AND ${tup('t')} IS DISTINCT FROM ${tup('EXCLUDED')};
  GET DIAGNOSTICS v_scrise = ROW_COUNT;
  SELECT string_agg(t.sectiune || ':' || t.cod, ', ' ORDER BY t.sectiune, t.cod) INTO v_extra
    FROM public.executie_contract_repere t
   WHERE t.proiect_id = v_p AND NOT EXISTS (SELECT 1 FROM _imp_contract s WHERE s.sectiune = t.sectiune AND s.cod = t.cod);
  RAISE NOTICE 'import contract: proiect %, % rânduri în fișier, % scrise (noi sau schimbate); sărite (modificate din aplicație): %; în BD, dar nu în fișier: %',
    v_p, ${rs.length}, v_scrise, coalesce(v_sarite, '—'), coalesce(v_extra, '—');
END $imp$;
`
}

const eDirect = process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]))
if (eDirect) {
  const args = process.argv.slice(2)
  const fisier = args.find(a => !a.startsWith('--'))
  const iR = args.indexOf('--proiect-regex')
  try {
    if (!fisier || iR < 0) throw new Error('utilizare: node scripts/contract_repere_import_sql.mjs <date.json> --proiect-regex <regex>')
    const brut = readFileSync(fisier)
    const sha = createHash('sha256').update(brut).digest('hex')
    process.stdout.write(genereaza(JSON.parse(brut.toString('utf8')), { regex: args[iR + 1], numeSursa: fisier, sha }))
  } catch (e) {
    process.stderr.write('EROARE: ' + e.message + '\n')
    process.exit(1)
  }
}
