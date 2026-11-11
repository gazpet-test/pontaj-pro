// Propunerea (NERULATĂ) de legare a obiectelor din devizele unui lot de unitățile ERP (proiect_unitati, migrarea 20261208a):
// „0001 TRONSON 1” ↔ T1, „0012 CUPLARE …” ↔ unitatea nodului, celelalte obiecte cu perioadă în graficul de referință ↔ câte o unitate.
// Intrări (dosarul lotului, doar citire): CSV-ul devizelor (coloana „obiect” = „<cod> <nume>”), tabelul „Durate pe obiecte în graficul de
// referință” (Markdown: | obiect | start | final | … |) și, opțional, tabelul km al tronsoanelor (| T1 | 0+000 (0) | 2+000 (2000) | …).
// Ieșire: un fișier SQL pentru chat (după „da”-ul lui Răzvan): creează unitățile care lipsesc (după cod) și completează obiectul / nodul /
// perioada DOAR unde sunt goale (nu suprascrie ce a ales un om). Potrivirea tronsoanelor se verifică și cu propunePotrivire (aceeași regulă ca
// ecranul, L19). Rulare: node scripts/devize/lot1_potrivire_sql.mjs --csv <f> --grafic <f> [--km <f>] --proiect <id> [--nod <NOD-COD>] --out <f>
import fs from 'node:fs'
import { propunePotrivire } from '../../src/devizTinte.js'
import { norm } from '../../src/lib/diacritice.js'

const BOM = String.fromCharCode(0xFEFF)
const curat = s => { const t = String(s ?? '').replace(/\r/g, ''); return t.startsWith(BOM) ? t.slice(1) : t }
const lit = s => `'${String(s).replace(/'/g, "''")}'`
const dataIso = s => { const m = String(s).trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null }

/** Obiectele distincte din CSV-ul devizelor: [{obiect_cod, obiect_nume, articole}] + ce nu are forma „<cod numeric> <nume>”. */
export function obiecteDinCsv(text) {
  const linii = curat(text).split('\n').filter(l => l.trim())
  const antet = linii[0].split(';')
  const io = antet.indexOf('obiect')
  if (io < 0) throw new Error('CSV: lipsește coloana „obiect”')
  const m = new Map(), altele = new Set()
  for (const l of linii.slice(1)) {
    const v = (l.split(';')[io] || '').trim()
    const x = v.match(/^(\d{3,6})\s+(\S.*)$/)
    if (!x) { altele.add(v); continue }
    const o = m.get(x[1]) || { obiect_cod: x[1], obiect_nume: x[2].trim(), articole: 0 }
    if (o.obiect_nume !== x[2].trim()) throw new Error(`CSV: obiectul ${x[1]} are două nume („${o.obiect_nume}” / „${x[2].trim()}”)`)
    o.articole += 1
    m.set(x[1], o)
  }
  return { obiecte: [...m.values()].sort((a, b) => a.obiect_cod.localeCompare(b.obiect_cod)), altele: [...altele] }
}

/** Rândurile tabelului „Durate pe obiecte …”: [{nume, start, final}] (doar rândurile cu două date valide). */
export function perioadeDinGrafic(text) {
  const t = curat(text)
  const i = t.indexOf('Durate pe obiecte')
  if (i < 0) throw new Error('grafic: lipsește tabelul „Durate pe obiecte”')
  const out = []
  let inTabel = false
  for (const l of t.slice(i).split('\n').slice(1)) {
    if (!l.startsWith('|')) { if (inTabel) break; continue }
    inTabel = true
    const c = l.split('|').slice(1, -1).map(x => x.trim())
    const s = dataIso(c[1]), f = dataIso(c[2])
    if (c.length >= 3 && s && f) out.push({ nume: c[0], start: s, final: f })
  }
  return out
}

/** Km tronsoanelor: {T1: '0+000 – 2+000', …} */
export function kmTronsoane(text) {
  const r = {}
  for (const l of curat(text).split('\n')) {
    const m = l.match(/^\|\s*(T\d{1,2})\s*\|\s*(\d+\+\d{3})\s*\([^)]*\)\s*\|\s*(\d+\+\d{3})\s*\(/)
    if (m) r[m[1]] = `${m[2]} – ${m[3]}`
  }
  return r
}

// rândul din grafic -> obiectul din deviz: tronsonul după număr; celelalte după începutul numelui (fără diacritice), cu potrivire UNICĂ
const REGULI = [
  [/^cuplare\b/, /^cuplare\b/],
  [/^statii de robinete\b|^statie de robinete\b/, /^statie de robinete\b|^statii de robinete\b/],
  [/^protectie catodica\b/, /^protectie catodica\b/],
  [/^instalatii electrice\b/, /^instalatii electrice\b/],
  [/^fibra optica\b/, /^fibra optica\b/],
  [/^organizare de santier\b/, /^organizare de santier\b/],
]
const nrT = s => { const m = norm(s).match(/^(?:t|tronson)\s*(\d{1,2})\b/); return m ? Number(m[1]) : null }
// numele unității: ca în deviz, cu majusculă doar la început (prescurtările cu punct, ex. N.T., rămân mari)
const titlu = s => String(s).trim().split(/\s+/).map((w, i) => (w.includes('.') ? w.toUpperCase() : i === 0 ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join(' ')

/** Unitățile propuse: [{tip, cod, nume, obiect_cod, nod_cod, plan_start, plan_final}] + avertismente. */
export function propuneUnitati({ obiecte, perioade, km = {}, nodCuplare = null }) {
  const avert = []
  const plan = new Map()
  for (const p of perioade) {
    const n = nrT(p.nume)
    let gasite
    if (n != null) gasite = obiecte.filter(o => nrT(o.obiect_nume) === n)
    else {
      const r = REGULI.find(([g]) => g.test(norm(p.nume)))
      gasite = r ? obiecte.filter(o => r[1].test(norm(o.obiect_nume))) : []
    }
    if (gasite.length !== 1) { avert.push(`grafic „${p.nume}”: ${gasite.length} obiecte potrivite — nepropus`); continue }
    if (plan.has(gasite[0].obiect_cod)) { avert.push(`obiectul ${gasite[0].obiect_cod} apare de două ori în grafic — nepropus`); plan.delete(gasite[0].obiect_cod); continue }
    plan.set(gasite[0].obiect_cod, p)
  }
  const unitati = []
  for (const o of obiecte) {
    const n = nrT(o.obiect_nume)
    const p = plan.get(o.obiect_cod) || null
    if (n != null) {
      const cod = `T${n}`
      unitati.push({ tip: 'tronson', cod, nume: `Tronson ${n}${km[cod] ? ` (km ${km[cod]})` : ''}`, obiect_cod: o.obiect_cod, nod_cod: null,
        plan_start: p?.start || null, plan_final: p?.final || null })
      if (!p) avert.push(`${cod}: fără perioadă în grafic`)
    } else if (p) {
      const cuplare = /^cuplare\b/.test(norm(o.obiect_nume))
      unitati.push({ tip: 'obiect', cod: cuplare ? 'CUPLARE' : o.obiect_cod, nume: titlu(o.obiect_nume), obiect_cod: o.obiect_cod,
        nod_cod: cuplare ? nodCuplare : null, plan_start: p.start, plan_final: p.final })
    }
  }
  // verificarea cu regula ecranului (propunePotrivire): tronsoanele și nodul trebuie să iasă la fel
  const prop = propunePotrivire(unitati.map((u, i) => ({ id: i + 1, cod: u.cod, nume: u.nume, nod_cod: u.nod_cod })), obiecte)
  for (const [i, u] of unitati.entries()) {
    const p = prop.find(x => x.unitate_id === i + 1)
    if (!p || p.obiect_cod !== u.obiect_cod) avert.push(`${u.cod}: regula ecranului propune ${p ? p.obiect_cod : 'nimic'} (generatorul: ${u.obiect_cod}) — de verificat`)
  }
  return { unitati, avert, nepropuse: obiecte.filter(o => !unitati.some(u => u.obiect_cod === o.obiect_cod)) }
}

export function genereazaSql({ proiectId, unitati, avert = [], nepropuse = [], altele = [], surse = [] }) {
  if (!/^\d{1,18}$/.test(String(proiectId))) throw new Error('proiect invalid')
  const p = String(proiectId)
  const L = []
  L.push('-- NERULAT — PROPUNERE. Legarea obiectelor din deviz de unitățile ERP (proiect_unitati, migrarea 20261208a).')
  L.push(`-- Proiectul ${p}. Generat de scripts/devize/lot1_potrivire_sql.mjs din dosarul lotului (doar citire).`)
  L.push('-- Rulează chat-ul, după „da”-ul lui Răzvan (date reale): psql -X -v ON_ERROR_STOP=1 -f <fișierul acesta>.')
  L.push('-- Creează doar unitățile care lipsesc (după cod) și completează obiectul / nodul / perioada DOAR unde sunt goale.')
  L.push('-- DE CONFIRMAT: perioadele (graficul de referință, nu prognoza actuală), codul nodului, unitățile obiectelor ne-tronson.')
  for (const s of surse) L.push(`-- sursa: ${s}`)
  for (const a of avert) L.push(`-- ATENȚIE: ${a}`)
  if (nepropuse.length) L.push(`-- obiecte din deviz NEPROPUSE (fără perioadă în grafic / cheltuieli / NCS): ${nepropuse.map(o => `${o.obiect_cod} ${o.obiect_nume}`).join('; ')}`)
  if (altele.length) L.push(`-- valori „obiect” fără forma „<cod> <nume>” (ignorate): ${altele.join('; ')}`)
  L.push('\\set ON_ERROR_STOP 1', 'BEGIN;', 'DO $pre$', 'BEGIN')
  L.push("  IF current_user IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'potrivire: rulează ca postgres'; END IF;")
  L.push(`  IF NOT EXISTS (SELECT 1 FROM public.executie_proiecte WHERE id = ${p}) THEN RAISE EXCEPTION 'potrivire: proiectul ${p} nu există'; END IF;`)
  L.push("  IF to_regprocedure('public.fn_executie_tinte_calcul()') IS NULL THEN RAISE EXCEPTION 'potrivire: migrarea 20261208a nu e aplicată'; END IF;")
  L.push(`  -- un obiect din propunere legat deja de ALTĂ unitate = conflict (se rezolvă de om, nu se suprascrie)`)
  L.push(`  IF EXISTS (SELECT 1 FROM public.proiect_unitati u JOIN (VALUES ${unitati.map(u => `(${lit(u.cod)}, ${lit(u.obiect_cod)})`).join(', ')}) v(cod, obiect_cod)`)
  L.push(`               ON u.obiect_cod = v.obiect_cod WHERE u.proiect_id = ${p} AND upper(coalesce(u.cod, '')) <> upper(v.cod)) THEN`)
  L.push("    RAISE EXCEPTION 'potrivire: un obiect din propunere e deja legat de altă unitate';")
  L.push('  END IF;', 'END $pre$;')
  unitati.forEach((u, i) => {
    L.push(`-- ${u.cod}: ${u.nume} ↔ obiectul ${u.obiect_cod}${u.nod_cod ? ` · nod ${u.nod_cod}` : ''}${u.plan_start ? ` · plan ${u.plan_start} … ${u.plan_final}` : ''}`)
    L.push(`INSERT INTO public.proiect_unitati (proiect_id, tip, cod, nume, ordine, activ) SELECT ${p}, ${lit(u.tip)}, ${lit(u.cod)}, ${lit(u.nume)}, ${i + 1}, true`)
    L.push(`  WHERE NOT EXISTS (SELECT 1 FROM public.proiect_unitati WHERE proiect_id = ${p} AND upper(coalesce(cod, '')) = ${lit(u.cod.toUpperCase())});`)
    L.push(`UPDATE public.proiect_unitati SET obiect_cod = ${lit(u.obiect_cod)} WHERE proiect_id = ${p} AND upper(coalesce(cod, '')) = ${lit(u.cod.toUpperCase())} AND obiect_cod IS NULL;`)
    if (u.nod_cod) L.push(`UPDATE public.proiect_unitati SET nod_cod = ${lit(u.nod_cod)} WHERE proiect_id = ${p} AND upper(coalesce(cod, '')) = ${lit(u.cod.toUpperCase())} AND nod_cod IS NULL;`)
    if (u.plan_start) L.push(`UPDATE public.proiect_unitati SET plan_start = DATE ${lit(u.plan_start)}, plan_final = DATE ${lit(u.plan_final)} WHERE proiect_id = ${p} AND upper(coalesce(cod, '')) = ${lit(u.cod.toUpperCase())} AND plan_start IS NULL;`)
  })
  L.push(`-- control: unitățile proiectului după legare`)
  L.push(`SELECT id, tip, cod, nume, obiect_cod, nod_cod, plan_start, plan_final FROM public.proiect_unitati WHERE proiect_id = ${p} ORDER BY ordine, id;`)
  L.push('COMMIT;', '')
  return L.join('\n')
}

function arg(n) { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : null }
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const csv = arg('csv'), grafic = arg('grafic'), kmF = arg('km'), proiect = arg('proiect'), out = arg('out')
  if (!csv || !grafic || !proiect || !out) { console.error('folosire: --csv <f> --grafic <f> [--km <f>] --proiect <id> [--nod <NOD-COD>] --out <f>'); process.exit(2) }
  const { obiecte, altele } = obiecteDinCsv(fs.readFileSync(csv, 'utf8'))
  const r = propuneUnitati({ obiecte, perioade: perioadeDinGrafic(fs.readFileSync(grafic, 'utf8')), km: kmF ? kmTronsoane(fs.readFileSync(kmF, 'utf8')) : {}, nodCuplare: arg('nod') })
  fs.writeFileSync(out, genereazaSql({ proiectId: proiect, ...r, altele, surse: [csv, grafic, kmF].filter(Boolean).map(f => f.split(/[\\/]/).pop()) }), 'utf8')
  console.log(`${r.unitati.length} unități propuse, ${r.nepropuse.length} obiecte nepropuse, ${r.avert.length} avertismente -> ${out}`)
  for (const a of r.avert) console.log('  ATENȚIE:', a)
}
