// „Probă extractor” (Ofertare, 20.10.2026 — varianta (c) propusă lui Răzvan, după ce pornirea din consolă a fost blocată): rulează
// extragerea structurată (edge ofertare-cantitati-extrage, mod 'structurat') cu extractorul B (implicit, gpt-5-mini) sau A (Haiku 5.5 →
// Sonnet 5.5) din fișa licitației, prin clientul obișnuit al aplicației — fără tokeni manipulați de mână.
// Plătit: plafonul (fn_ofertare_cb_buget_seteaza), cererea de cheltuială (fn_ofertare_cb_cerere) și rularea au fiecare poarta lor pe
// SERVER (owner / responsabil / admin Ofertare; adminul ≤ 5 USD) — butoanele de aici nu ocolesc nimic, doar le cheamă, cu confirmare.
// Scrie doar observații imuabile în tabelele B (ofertare_cant_obs / _extrageri / _felii / ofertare_ai_rezervari) — NU în ofertare_cantitati.
import { useState, useEffect, useRef } from 'react'
import { supabase } from './lib/supabase.js'
import { consumBuget, cerereActiva, cereriPeLot, ruleazaPanaLaCapat, totalPasi } from './ofertareProbaExtractor.js'

const G = { surface:'#161B22', card:'#1C2128', border:'#30363D', border2:'#21262D', text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  ofertare:'#3FB6E2', green:'#3FB950', orange:'#F0883E', yellow:'#E3B341', red:'#F85149' }
const S = {
  btn: { padding:'7px 12px', background:G.surface, color:G.text, border:`1px solid ${G.border2}`, borderRadius:7, cursor:'pointer', fontSize:12 },
  btnP: { padding:'8px 14px', background:G.ofertare, color:'#0D1117', border:'none', borderRadius:7, cursor:'pointer', fontSize:12.5, fontWeight:700 },
  card: { background:G.card, border:`1px solid ${G.border}`, borderRadius:10 },
  inp: { width:80, padding:'6px 8px', background:G.surface, color:G.text, border:`1px solid ${G.border2}`, borderRadius:6, fontSize:12.5 },
}
const SCOP = 'cant_extragere'

export default function OfertareProbaExtractor({ licitatie: l }) {
  const [deschis, setDeschis] = useState(false)
  const [st, setSt] = useState(null)        // { buget, consum, cerere }
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const [plafon, setPlafon] = useState('')
  const [jurnal, setJurnal] = useState([])
  const opreste = useRef(false)
  const licCurenta = useRef(l.id)   // review Copilot / Gemini #797 r1 (P2): rezultatul unei încărcări vechi nu suprascrie altă licitație

  // altă licitație (sau închiderea secțiunii): starea veche se golește, iar o rulare în curs se oprește după pasul curent
  useEffect(() => {
    licCurenta.current = l.id
    setSt(null); setJurnal([]); setErr(null)
    return () => { opreste.current = true }
  }, [l.id])

  const load = async () => {
    const idCerut = l.id
    setErr(null)
    const [b, r, c] = await Promise.all([
      supabase.from('ofertare_ai_buget').select('plafon_usd, blocat, blocat_motiv').eq('licitatie_id', l.id).eq('scop', SCOP).maybeSingle(),
      supabase.from('ofertare_ai_rezervari').select('stare, cost_real, suma_rezervata').eq('licitatie_id', l.id).eq('scop', SCOP),
      supabase.from('ofertare_ai_cereri').select('id, scop, stare, valabil_pana, lot_domeniu, lot_nr').eq('licitatie_id', l.id).eq('scop', SCOP),
    ])
    if (licCurenta.current !== idCerut) return
    const e = b.error || r.error || c.error
    if (e) { setErr(e.message || String(e)); return }
    setSt({ buget: b.data || null, consum: consumBuget(r.data), cerere: cerereActiva(c.data, SCOP), peLot: cereriPeLot(c.data, SCOP) })
  }
  useEffect(() => { if (deschis) load() }, [deschis, l.id])

  const rpc = async (fn, args, mesaj) => {
    setBusy(true); setErr(null)
    const { data, error } = await supabase.rpc(fn, args)
    setBusy(false)
    if (error) { setErr(`${mesaj}: ${error.message}`); return null }
    await load(); return data
  }
  const seteazaPlafon = async () => {
    const v = Math.round(Number(String(plafon).replace(',', '.')) * 100) / 100
    if (!(v > 0)) return setErr('Plafon invalid')
    if (!window.confirm(`Plafonul AI pentru extragere pe ${l.nr_anunt} devine ${v.toFixed(2)} USD (consumat până acum: ${st?.consum?.toFixed(4) ?? '—'} USD). Continui?`)) return
    await rpc('fn_ofertare_cb_buget_seteaza', { p_licitatie_id: l.id, p_scop: SCOP, p_plafon_usd: v }, 'Plafon refuzat')
  }
  const aprobaCerere = async () => {
    if (l.stare_loturi && l.stare_loturi !== 'fara_loturi') return setErr('Licitație cu loturi: cererea pe lot nu e încă în acest buton.')
    if (!window.confirm(`Aprobi cheltuiala AI pentru extragerea cantităților pe ${l.nr_anunt}, valabilă 12 ore? Rularea rămâne limitată de plafon.`)) return
    await rpc('fn_ofertare_cb_cerere', { p_licitatie_id: l.id, p_scop: SCOP, p_lot_domeniu: 'toate', p_lot_nr: [], p_ore: 12 }, 'Cerere refuzată')
  }
  const ruleaza = async (extractor) => {
    if (!st?.cerere) return setErr('Fără cerere de cheltuială activă — aprob-o întâi.')
    if (!window.confirm(`Pornesc extragerea cu extractorul ${extractor} pe ${l.nr_anunt}? E plătită (rămas din plafon: ${st.buget ? (st.buget.plafon_usd - st.consum).toFixed(2) : '—'} USD); se oprește singură la plafon.`)) return
    opreste.current = false; setBusy(true); setErr(null)
    // review Copilot #797 r2 (P2): callback-urile rulării scriu DOAR dacă panoul arată încă licitația pe care a pornit rularea
    const idRulare = l.id
    const aici = () => licCurenta.current === idRulare
    const jurnalAici = (x) => { if (aici()) setJurnal(j => [...j, { t: new Date().toLocaleTimeString('ro-RO'), x }]) }
    jurnalAici(`▶ extractor ${extractor}`)
    try {
    const r = await ruleazaPanaLaCapat(
      (body) => supabase.functions.invoke('ofertare-cantitati-extrage', { body }),
      { mod: 'structurat', licitatie_id: l.id, cerere_id: st.cerere.id, extractor },
      { laPas: (i, p) => jurnalAici(p.eroare ? `pas ${i + 1}: eroare — ${p.eroare}`
          : `pas ${i + 1}: ${p.felii_apelate} felii · ${p.cost_usd.toFixed(4)} USD${p.felii_cu_deficit_b1 != null ? ` · deficit B1 ${p.felii_cu_deficit_b1}` : ''}${p.felii_escaladate != null ? ` · escaladate ${p.felii_escaladate}` : ''}${p.erori ? ` · ${p.erori} cu erori` : ''}${p.oprit ? ` · ${p.oprit}` : ''}`),
        trebuieOprit: () => opreste.current })
    const tot = totalPasi(r.pasi)
    jurnalAici(`■ ${extractor}: ${r.motiv} — ${tot.felii} felii, ${tot.cost.toFixed(4)} USD, deficit B1 ${tot.deficit}, escaladate ${tot.escaladate}, erori ${tot.erori}${r.pasi.find(p => p.extractor)?.extractor ? ` (${r.pasi.find(p => p.extractor).extractor})` : ''}`)
    } catch (e) { if (aici()) setErr('Rulare întreruptă: ' + (e?.message || String(e))) }
    finally { setBusy(false) }
    if (aici()) await load()
  }

  return (
    <div style={{ ...S.card, padding:'12px 16px', marginTop:16 }}>
      <div style={{ display:'flex', alignItems:'center', gap:10, cursor:'pointer' }} onClick={() => setDeschis(d => !d)}>
        <span style={{ fontWeight:800, fontSize:13.5 }}>🧪 Probă extractor cantități (A / B)</span>
        <span style={{ fontSize:12, color:G.muted }}>owner / responsabil / admin Ofertare · plătit · scrie doar observații de probă, nu cantitățile ofertei</span>
        <span style={{ marginLeft:'auto', color:G.muted }}>{deschis ? '▴' : '▾'}</span>
      </div>
      {deschis && <div style={{ marginTop:12, fontSize:12.5 }}>
        {st && <div style={{ display:'flex', gap:16, flexWrap:'wrap', marginBottom:10 }}>
          <span>Plafon: <b>{st.buget ? `${Number(st.buget.plafon_usd).toFixed(2)} USD` : 'nesetat'}</b>{st.buget?.blocat ? <b style={{ color:G.red }}> · BLOCAT ({st.buget.blocat_motiv})</b> : null}</span>
          <span>Consumat: <b>{st.consum.toFixed(4)} USD</b></span>
          <span>Cerere: {st.cerere ? <b style={{ color:G.green }}>#{st.cerere.id} activă (toată licitația) până la {new Date(st.cerere.valabil_pana).toLocaleString('ro-RO', { dateStyle:'short', timeStyle:'short' })}</b> : <b style={{ color:G.orange }}>niciuna activă pe toată licitația</b>}</span>
          {st.peLot?.length > 0 && <span style={{ color:G.muted }}>(cereri active pe lot, nefolosite aici: {st.peLot.map(c => `#${c.id} lot ${(c.lot_nr || []).join(',') || c.lot_domeniu}`).join('; ')})</span>}
        </div>}
        <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
          <input style={S.inp} placeholder="USD" value={plafon} onChange={e => setPlafon(e.target.value)} disabled={busy} />
          <button style={S.btn} disabled={busy} onClick={seteazaPlafon}>Setează plafonul</button>
          <button style={S.btn} disabled={busy || !!st?.cerere} onClick={aprobaCerere}>Aprobă cheltuiala (12 h)</button>
          <button style={S.btnP} disabled={busy || !st?.cerere} onClick={() => ruleaza('B')}>Rulează B (gpt-5-mini)</button>
          <button style={S.btnP} disabled={busy || !st?.cerere} onClick={() => ruleaza('A')}>Rulează A (Haiku → Sonnet)</button>
          {busy && <button style={{ ...S.btn, color:G.red }} onClick={() => { opreste.current = true }}>Oprește după pasul curent</button>}
        </div>
        {err && <div style={{ color:G.red, marginTop:8 }}>{err}</div>}
        {jurnal.length > 0 && <div style={{ marginTop:10, fontFamily:'Consolas, monospace', fontSize:11.5, color:G.muted, maxHeight:220, overflowY:'auto' }}>
          {jurnal.map((x, i) => <div key={i}>{x.t} {x.x}</div>)}
        </div>}
      </div>}
    </div>
  )
}
