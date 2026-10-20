// Contul claude@gazpet.ro în ERP, de pe serverul AI (cerere Răzvan 20.10.2026): aceleași trei acțiuni ca butoanele din
// „🧪 Probă extractor cantități” (src/OfertareProbaExtractor.jsx), prin ACELEAȘI funcții:
//   plafon  → RPC fn_ofertare_cb_buget_seteaza (p_scop 'cant_extragere')
//   aproba  → RPC fn_ofertare_cb_cerere (toată licitația: lot_domeniu 'toate', lot_nr [], 12 h ca butonul)
//   ruleaza → edge ofertare-cantitati-extrage, mod 'structurat', cu bucla ruleazaPanaLaCapat din src/ofertareProbaExtractor.js
// Nu ocolește nimic: identitatea e un utilizator obișnuit (cheia anon + login cu parolă, FĂRĂ service_role), porțile sunt pe server
// (claude@ = admin Ofertare → plafon ≤ 5 USD, aprobare + rulare doar pe cererea activă a licitației). Confirmarea butonului
// (window.confirm) = flagul --da: fără el, comanda arată doar starea și ce ar face.
//
// Utilizare (din rădăcina repo-ului, pe serverul AI):
//   node scripts/erp_claude/ofertare_cb.mjs stare   <lic>
//   node scripts/erp_claude/ofertare_cb.mjs plafon  <lic> <usd>               [--da]
//   node scripts/erp_claude/ofertare_cb.mjs aproba  <lic> [--ore 12]          [--da]
//   node scripts/erp_claude/ofertare_cb.mjs ruleaza <lic> <A|B> [--max-pasi 20] [--da]
// Fișiere (în afara repo-ului):
//   parola  — prima linie din C:/Users/Gazpet-Ai/.secrete/erp_claude_parola.txt (sau ERP_CLAUDE_PAROLA_FILE); nu se afișează, nu se scrie
//   cheia anon (publică, e și în bundle-ul aplicației) — SUPABASE_ANON_KEY sau C:/Users/Gazpet-Ai/.secrete/supabase_anon_key.txt
//   jurnal  — C:/Users/Gazpet-Ai/.secrete/erp_claude_jurnal.jsonl (sau ERP_CLAUDE_JURNAL): o linie pe comandă, fără parolă / tokeni
// Coduri de ieșire: 0 ok · 1 eroare / refuz de server · 2 utilizare greșită.
import { readFileSync, appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { consumBuget, cerereActiva, cereriPeLot, ruleazaPanaLaCapat, totalPasi } from '../../src/ofertareProbaExtractor.js'
import { mesajInvoke } from '../../src/lib/mesajInvoke.js'

const SCOP = 'cant_extragere'
const EMAIL = process.env.ERP_CLAUDE_EMAIL || 'claude@gazpet.ro'
const URL_ERP = process.env.SUPABASE_URL || 'https://dxczwkbciseqniprspcu.supabase.co'
const SECRETE = 'C:/Users/Gazpet-Ai/.secrete'
const F_PAROLA = process.env.ERP_CLAUDE_PAROLA_FILE || `${SECRETE}/erp_claude_parola.txt`
const F_ANON = `${SECRETE}/supabase_anon_key.txt`
const F_JURNAL = process.env.ERP_CLAUDE_JURNAL || `${SECRETE}/erp_claude_jurnal.jsonl`
const COMENZI = ['stare', 'plafon', 'aproba', 'ruleaza']
const MAX_ORE = 24   // serverul acceptă până la 720 h; scriptul ține cererea scurtă (butonul: 12 h)

export class EroareUtilizare extends Error {}
const gresit = (m) => { throw new EroareUtilizare(m) }

// la fel ca butonul: virgulă sau punct, rotunjit la cenți
export const plafonDin = (s) => Math.round(Number(String(s ?? '').replace(',', '.')) * 100) / 100

export function citesteArgs(argv) {
  const poz = [], o = { da: false, ore: 12, maxPasi: 20 }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--da') o.da = true
    else if (a === '--ore') o.ore = Number(argv[++i])
    else if (a === '--max-pasi') o.maxPasi = Number(argv[++i])
    else if (a.startsWith('--')) gresit(`Opțiune necunoscută: ${a}`)
    else poz.push(a)
  }
  const [cmd, licS, x] = poz
  if (!COMENZI.includes(cmd)) gresit(`Comanda trebuie să fie una din: ${COMENZI.join(', ')}`)
  const lic = Number(licS)
  if (!Number.isInteger(lic) || lic <= 0) gresit('Licitația = id numeric (ofertare_licitatii.id)')
  const asteptate = { stare: 2, plafon: 3, aproba: 2, ruleaza: 3 }[cmd]
  if (poz.length !== asteptate) gresit(`Număr greșit de argumente pentru „${cmd}”`)
  const r = { cmd, lic, ...o }
  if (cmd === 'plafon') { r.usd = plafonDin(x); if (!(r.usd > 0)) gresit('Plafon invalid') }
  if (cmd === 'ruleaza') { r.extractor = String(x).toUpperCase(); if (!['A', 'B'].includes(r.extractor)) gresit('Extractorul e A sau B') }
  if (!Number.isInteger(r.ore) || r.ore < 1 || r.ore > MAX_ORE) gresit(`--ore între 1 și ${MAX_ORE}`)
  if (!Number.isInteger(r.maxPasi) || r.maxPasi < 1 || r.maxPasi > 20) gresit('--max-pasi între 1 și 20')
  return r
}

// rândul de progres, identic cu jurnalul din buton
export const textPas = (i, p) => p.eroare ? `pas ${i + 1}: eroare — ${p.eroare}`
  : `pas ${i + 1}: ${p.felii_apelate} felii · ${p.cost_usd.toFixed(4)} USD${p.felii_cu_deficit_b1 != null ? ` · deficit B1 ${p.felii_cu_deficit_b1}` : ''}${p.felii_escaladate != null ? ` · escaladate ${p.felii_escaladate}` : ''}${p.erori ? ` · ${p.erori} cu erori` : ''}${p.oprit ? ` · ${p.oprit}` : ''}`

const primaLinie = (f, ce) => {
  let t
  try { t = readFileSync(f, 'utf8') } catch { throw new Error(`Lipsește ${ce}: ${f}`) }
  const v = t.replace(/^\uFEFF/, '').split(/\r?\n/)[0].trim()
  if (!v) throw new Error(`Fișier gol (${ce}): ${f}`)
  return v
}
const jurnal = (x) => { try { appendFileSync(F_JURNAL, JSON.stringify({ t: new Date().toISOString(), cont: EMAIL, ...x }) + '\n') } catch (e) { console.error(`(jurnal nescris: ${e.message})`) } }

// aceleași 3 citiri ca load() din buton
async function stare(sb, lic) {
  const [b, r, c] = await Promise.all([
    sb.from('ofertare_ai_buget').select('plafon_usd, blocat, blocat_motiv').eq('licitatie_id', lic).eq('scop', SCOP).maybeSingle(),
    sb.from('ofertare_ai_rezervari').select('stare, cost_real, suma_rezervata').eq('licitatie_id', lic).eq('scop', SCOP),
    sb.from('ofertare_ai_cereri').select('id, scop, stare, valabil_pana, lot_domeniu, lot_nr').eq('licitatie_id', lic).eq('scop', SCOP),
  ])
  const e = b.error || r.error || c.error
  if (e) throw new Error(`Citire refuzată: ${e.message}`)
  return { buget: b.data || null, consum: consumBuget(r.data), cerere: cerereActiva(c.data, SCOP), peLot: cereriPeLot(c.data, SCOP) }
}
const afiseaza = (l, st) => {
  console.log(`Licitația ${l.id} · ${l.nr_anunt || '—'} · loturi: ${l.stare_loturi || '—'}`)
  console.log(`  plafon: ${st.buget ? `${Number(st.buget.plafon_usd).toFixed(2)} USD` : 'nesetat'}${st.buget?.blocat ? ` · BLOCAT (${st.buget.blocat_motiv})` : ''}`
    + ` · consumat: ${st.consum.toFixed(4)} USD${st.buget ? ` · rămas: ${(st.buget.plafon_usd - st.consum).toFixed(4)} USD` : ''}`)
  console.log(`  cerere: ${st.cerere ? `#${st.cerere.id} activă (toată licitația) până la ${new Date(st.cerere.valabil_pana).toLocaleString('ro-RO')}` : 'niciuna activă pe toată licitația'}`
    + (st.peLot.length ? ` · pe lot (nefolosite aici): ${st.peLot.map(c => `#${c.id}`).join(', ')}` : ''))
}

async function main(a) {
  const anon = process.env.SUPABASE_ANON_KEY || primaLinie(F_ANON, 'cheia anon')
  const parola = primaLinie(F_PAROLA, 'parola contului')
  const sb = createClient(URL_ERP, anon, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  const { data: login, error: eLogin } = await sb.auth.signInWithPassword({ email: EMAIL, password: parola })
  if (eLogin) throw new Error(`Login refuzat pentru ${EMAIL}: ${eLogin.message}`)
  let expira = login.session.expires_at
  // rularea poate ține ~20 min: tokenul se reîmprospătează înainte de fiecare apel dacă mai are < 5 min
  const proaspat = async () => {
    if (expira - Date.now() / 1000 > 300) return
    const { data, error } = await sb.auth.refreshSession()
    if (error) throw new Error(`Sesiune expirată: ${error.message}`)
    expira = data.session.expires_at
  }
  try {
    const { data: l, error: eL } = await sb.from('ofertare_licitatii').select('id, nr_anunt, stare_loturi').eq('id', a.lic).maybeSingle()
    if (eL) throw new Error(`Citire licitație refuzată: ${eL.message}`)
    if (!l) throw new Error(`Licitația ${a.lic} nu există (sau contul nu o vede)`)
    let st = await stare(sb, a.lic)
    afiseaza(l, st)
    if (a.cmd === 'stare') return 0

    if (a.cmd === 'plafon') {
      const ce = `plafonul AI pentru extragere pe ${l.nr_anunt} devine ${a.usd.toFixed(2)} USD (consumat: ${st.consum.toFixed(4)} USD)`
      if (!a.da) { console.log(`[fără --da] ${ce} — nimic schimbat`); return 0 }
      const { data, error } = await sb.rpc('fn_ofertare_cb_buget_seteaza', { p_licitatie_id: l.id, p_scop: SCOP, p_plafon_usd: a.usd })
      jurnal({ cmd: 'plafon', lic: l.id, usd: a.usd, ok: !error, rezultat: data ?? null, eroare: error?.message ?? null })
      if (error) throw new Error(`Plafon refuzat: ${error.message}`)
      console.log(`✓ plafon ${data.plafon_usd} USD (rol ${data.rol}, consum ${data.consum})`)
    }

    if (a.cmd === 'aproba') {
      if (l.stare_loturi && l.stare_loturi !== 'fara_loturi') throw new Error('Licitație cu loturi: cererea pe lot nu e în acest script (nici în buton).')
      if (st.cerere) { console.log(`Există deja cererea #${st.cerere.id} activă — nimic de aprobat`); return 0 }
      const ce = `aprobi cheltuiala AI pentru extragerea cantităților pe ${l.nr_anunt}, valabilă ${a.ore} h (rularea rămâne limitată de plafon)`
      if (!a.da) { console.log(`[fără --da] ${ce} — nimic schimbat`); return 0 }
      const { data, error } = await sb.rpc('fn_ofertare_cb_cerere', { p_licitatie_id: l.id, p_scop: SCOP, p_lot_domeniu: 'toate', p_lot_nr: [], p_ore: a.ore })
      jurnal({ cmd: 'aproba', lic: l.id, ore: a.ore, ok: !error, rezultat: data ?? null, eroare: error?.message ?? null })
      if (error) throw new Error(`Cerere refuzată: ${error.message}`)
      console.log(`✓ cererea #${data.cerere_id} activă ${a.ore} h`)
    }

    if (a.cmd === 'ruleaza') {
      if (!st.cerere) throw new Error('Fără cerere de cheltuială activă — rulează întâi „aproba”.')
      const ce = `pornesc extragerea cu extractorul ${a.extractor} pe ${l.nr_anunt}, cererea #${st.cerere.id} — PLĂTITĂ, se oprește singură la plafon`
      if (!a.da) { console.log(`[fără --da] ${ce} — nimic pornit`); return 0 }
      let oprit = false
      const laSemnal = () => { oprit = true; console.log('… oprire cerută: se oprește după pasul curent') }
      process.once('SIGINT', laSemnal)
      console.log(`▶ extractor ${a.extractor}`)
      const r = await ruleazaPanaLaCapat(
        async (body) => {
          await proaspat()
          const x = await sb.functions.invoke('ofertare-cantitati-extrage', { body })
          // ca în ecran, dar cu motivul real din corpul răspunsului (nu „non-2xx” generic)
          return x.error ? { data: x.data, error: { message: await mesajInvoke(x.error, x.data) } } : x
        },
        { mod: 'structurat', licitatie_id: l.id, cerere_id: st.cerere.id, extractor: a.extractor },
        { maxPasi: a.maxPasi, laPas: (i, p) => console.log(`  ${new Date().toLocaleTimeString('ro-RO')} ${textPas(i, p)}`), trebuieOprit: () => oprit })
      process.off('SIGINT', laSemnal)
      const tot = totalPasi(r.pasi)
      const ext = r.pasi.find(p => p.extractor)?.extractor
      jurnal({ cmd: 'ruleaza', lic: l.id, cerere_id: st.cerere.id, extractor: a.extractor, motiv: r.motiv, ...tot, model: ext ?? null })
      console.log(`■ ${a.extractor}: ${r.motiv} — ${tot.felii} felii, ${tot.cost.toFixed(4)} USD, deficit B1 ${tot.deficit}, escaladate ${tot.escaladate}, erori ${tot.erori}${ext ? ` (${ext})` : ''}`)
      if (r.motiv === 'eroare') { st = await stare(sb, a.lic); afiseaza(l, st); return 1 }
    }

    st = await stare(sb, a.lic)
    afiseaza(l, st)
    return 0
  } finally {
    await sb.auth.signOut({ scope: 'local' }).catch(() => {})   // doar sesiunea scriptului, nu și sesiunile din browser ale contului
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  let a
  try { a = citesteArgs(process.argv.slice(2)) } catch (e) {
    console.error(e.message); console.error('Vezi antetul fișierului pentru utilizare.'); process.exit(e instanceof EroareUtilizare ? 2 : 1)
  }
  main(a).then(cod => process.exit(cod), e => { console.error(`✗ ${e.message}`); process.exit(1) })
}
