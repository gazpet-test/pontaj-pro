// ════════════════════════════════════════════════════════════════
// GbeEvidenta.jsx — Garanția de bună execuție (GBE) vizibilă în Ofertare și Financiar (09.09.2026)
//   Sursa unică: contracte_terti (câmpuri gbe_*) + v_gbe_per_contract (reținut/restituit/rămas) + gbe_restituiri + gbe_polite
//   — aceeași evidență ca „🔐 Evidență GBE” din Administrativ → Contracte comerciale.
//   Pentru contractele fără situații de plată în platformă (ex. Conpet) reținutul se ține în contracte_terti.gbe_retinut_manual.
//   Exporturi: GbeCard (un contract), GbeTabel (toate, pentru Financiar), GbeLicitatie (pe fișa licitației, leagă licitația de contract)
// ════════════════════════════════════════════════════════════════
import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase.js'

const G = { bg:'#0D1117', surface:'#161B22', card:'#1C2128', border:'#30363D', border2:'#21262D', text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  green:'#3FB950', blue:'#58A6FF', orange:'#F0883E', yellow:'#E3B341', red:'#F85149', purple:'#A371F7' }
const S = {
  input: { width:'100%', boxSizing:'border-box', background:G.bg, border:`1px solid ${G.border2}`, borderRadius:6, padding:'7px 10px', color:G.text, fontSize:12.5, outline:'none', colorScheme:'dark' },
  lbl: { display:'block', fontSize:10.5, color:G.muted, marginBottom:3, fontWeight:600, textTransform:'uppercase', letterSpacing:'.3px' },
  btnS: { padding:'6px 12px', background:G.surface, color:G.text, border:`1px solid ${G.border2}`, borderRadius:7, cursor:'pointer', fontSize:12, fontWeight:600 },
}
const fmtLei = v => v == null || v === '' ? '—' : Number(v).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' lei'
const fmtZi = d => d ? new Date(d.length === 10 ? d + 'T00:00:00' : d).toLocaleDateString('ro-RO') : '—'
const zile = d => { if (!d) return null; const x = new Date(d); x.setHours(0,0,0,0); const a = new Date(); a.setHours(0,0,0,0); return Math.round((x - a) / 86400000) }
const RESTITUIRE_TIP = { partiala:'Restituire parțială', receptie_terminare:'Deblocare la recepția la terminare', finala:'Restituire finală', scrisoare_garantie:'Înlocuit cu scrisoare de garanție' }

// ── alerte pe un contract (c = contracte_terti + v = rând din v_gbe_per_contract + polite active + restituiri)
export function alerteGbe(c, v, polite = [], restituiri = []) {
  const out = []
  const ramas = Number(v?.gbe_ramas ?? 0)
  const areRec = !!c.gbe_data_receptie_terminare
  const debl = restituiri.some(r => r.tip === 'receptie_terminare' || r.tip === 'finala')
  if (c.status === 'draft') out.push({ n:'info', t:'Contract nesemnat — după semnare: cont GBE deschis în 15 zile, cu suma inițială depusă' })
  if (c.gbe_tip === 'retinere' && areRec && ramas > 0 && !debl) {
    const pct = Number(c.gbe_pct_deblocare_receptie ?? 70)
    out.push({ n:'critic', t:`Recepție la terminare ${fmtZi(c.gbe_data_receptie_terminare)} — ${pct}% (${fmtLei(ramas * pct / 100)}) de cerut beneficiarului` })
  }
  // Punctul orb: fără data recepției nu se declanșează alerta de mai sus, deci banii pot sta blocați
  // la nesfârșit fără ca nimeni să afle (cazul Comișani: 327.478 lei, 7 luni). 09.09.2026
  if (c.gbe_tip === 'retinere' && !areRec && ramas > 0 && c.status !== 'draft') {
    const pct = Number(c.gbe_pct_deblocare_receptie ?? 70)
    out.push({ n: c.status === 'finalizat' ? 'critic' : 'warn',
      t:`Lipsește data recepției la terminare — caută PV-ul și completeaz-o, altfel nu se cere deblocarea de ${pct}% (${fmtLei(ramas * pct / 100)})` })
  }
  const zr = zile(c.gbe_data_estimata_recuperare)
  if (ramas > 0 && zr != null && zr <= 60) out.push({ n: zr <= 0 ? 'critic' : 'warn', t: zr <= 0 ? `Termen de recuperare depășit (${fmtZi(c.gbe_data_estimata_recuperare)}) — ${fmtLei(ramas)} de recuperat` : `Recuperare în ${zr} zile (${fmtZi(c.gbe_data_estimata_recuperare)}) — ${fmtLei(ramas)}` })
  if (c.gbe_tip === 'polita' && c.gbe_data_receptie_finala && polite.length) out.push({ n:'critic', t:`Recepție finală ${fmtZi(c.gbe_data_receptie_finala)} — poliță GBE de eliberat / restul de recuperat` })
  const zc = zile(c.gbe_cont_valabil_pana)
  if (zc != null && zc <= 90 && ramas > 0) out.push({ n: zc <= 30 ? 'critic' : 'warn', t:`Contul de garanție expiră ${fmtZi(c.gbe_cont_valabil_pana)} — prelungire la bancă` })
  for (const p of polite) { const z = zile(p.data_expirare); if (z != null && z <= 60) out.push({ n: z <= 30 ? 'critic' : 'warn', t:`Polița ${p.numar_polita || ''} expiră ${fmtZi(p.data_expirare)}` }) }
  return out
}
const culoare = n => n === 'critic' ? G.red : n === 'warn' ? G.yellow : G.blue

// ── încărcare completă pentru o listă de contracte
async function incarca(ids) {
  if (!ids?.length) return { contracte: [], view: {}, polite: {}, rest: {} }
  const [{ data: cc }, { data: vv }, { data: pp }, { data: rr }] = await Promise.all([
    supabase.from('contracte_terti').select('*, beneficiar:beneficiari(nume)').in('id', ids),
    supabase.from('v_gbe_per_contract').select('*').in('contract_id', ids),
    supabase.from('gbe_polite').select('*').in('contract_id', ids).eq('activ', true),
    supabase.from('gbe_restituiri').select('*').in('contract_id', ids).order('data_restituire', { ascending: false }),
  ])
  const grp = (arr, k) => (arr || []).reduce((m, x) => { (m[x[k]] = m[x[k]] || []).push(x); return m }, {})
  return { contracte: cc || [], view: Object.fromEntries((vv || []).map(x => [x.contract_id, x])), polite: grp(pp, 'contract_id'), rest: grp(rr, 'contract_id') }
}

// ── cardul unui contract
export function GbeCard({ c, v, polite = [], restituiri = [], accent = G.green, canEdit, onChanged, compact }) {
  const [edit, setEdit] = useState(false)
  const [f, setF] = useState({})
  const [nr, setNr] = useState(null) // formular restituire nouă
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const ramas = Number(v?.gbe_ramas ?? 0), retinut = Number(v?.gbe_retinut ?? 0), restituit = Number(v?.gbe_restituit ?? 0)
  const al = alerteGbe(c, v, polite, restituiri)
  const pornesteEdit = () => { setF({ gbe_retinut_manual: c.gbe_retinut_manual ?? '', gbe_data_receptie_terminare: c.gbe_data_receptie_terminare || '', gbe_data_receptie_finala: c.gbe_data_receptie_finala || '', gbe_data_estimata_recuperare: c.gbe_data_estimata_recuperare || '', gbe_cont_iban: c.gbe_cont_iban || '', gbe_cont_valabil_pana: c.gbe_cont_valabil_pana || '', garantie_buna_executie_pct: c.garantie_buna_executie_pct ?? '', gbe_observatii: c.gbe_observatii || '' }); setEdit(true) }
  const salveaza = async () => {
    setBusy(true); setErr(null)
    const p = { ...f }; for (const k of Object.keys(p)) if (p[k] === '') p[k] = null
    const { error } = await supabase.from('contracte_terti').update({ ...p, updated_at: new Date().toISOString() }).eq('id', c.id)
    setBusy(false); if (error) { setErr(error.message); return }
    setEdit(false); onChanged?.()
  }
  const salveazaRest = async () => {
    if (!nr.valoare_lei || !nr.data_restituire) { setErr('Data și valoarea sunt obligatorii'); return }
    setBusy(true); setErr(null)
    const { data: u } = await supabase.auth.getUser()
    const { error } = await supabase.from('gbe_restituiri').insert({ contract_id: c.id, data_restituire: nr.data_restituire, valoare_lei: Number(nr.valoare_lei), tip: nr.tip, observatii: nr.observatii || null, created_by: u?.user?.id || null })
    setBusy(false); if (error) { setErr(error.message); return }
    setNr(null); onChanged?.()
  }
  return (
    <div style={{ background:G.card, border:`1px solid ${al.some(a => a.n === 'critic') ? G.red + '66' : G.border}`, borderRadius:10, padding:'12px 14px' }}>
      <div style={{ display:'flex', gap:10, alignItems:'flex-start', flexWrap:'wrap' }}>
        <div style={{ flex:1, minWidth:220 }}>
          <div style={{ fontSize:13.5, fontWeight:800 }}>🔐 {c.numar_contract || 'fără număr'} <span style={{ color:G.muted, fontWeight:600 }}>· {c.beneficiar?.nume || v?.beneficiar || ''}</span></div>
          <div style={{ fontSize:12, color:G.muted, marginTop:2 }}>{c.denumire}</div>
          <div style={{ fontSize:11.5, color:G.dim, marginTop:4 }}>
            {c.gbe_tip === 'polita' ? '🏦 poliță' : '✂️ rețineri succesive'}{c.garantie_buna_executie_pct ? ` · ${c.garantie_buna_executie_pct}%` : ''}{c.gbe_pct_deblocare_receptie != null ? ` · ${c.gbe_pct_deblocare_receptie}/${c.gbe_pct_deblocare_final}` : ''}{c.valoare_actuala_lei || c.valoare_lei ? ` · contract ${fmtLei(c.valoare_actuala_lei || c.valoare_lei)}` : ''}{c.status === 'draft' ? ' · NESEMNAT' : ''}
          </div>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3, auto)', gap:'4px 14px', fontSize:12, textAlign:'right' }}>
          <div style={{ color:G.muted }}>Reținut</div><div style={{ color:G.muted }}>Restituit</div><div style={{ color:G.muted }}>Blocat acum</div>
          <div style={{ fontWeight:700 }}>{fmtLei(retinut)}{v?.retinut_manual ? <span title="introdus manual" style={{ color:G.dim }}> ✎</span> : ''}</div>
          <div style={{ fontWeight:700, color:G.green }}>{fmtLei(restituit)}</div>
          <div style={{ fontWeight:800, color: ramas > 0 ? accent : G.dim }}>{fmtLei(ramas)}</div>
        </div>
      </div>
      {!compact && (
        <div style={{ display:'flex', gap:14, flexWrap:'wrap', fontSize:11.5, color:G.muted, marginTop:8 }}>
          <span>Recepție la terminare: <b style={{ color:G.text }}>{fmtZi(c.gbe_data_receptie_terminare)}</b></span>
          <span>Recepție finală: <b style={{ color:G.text }}>{fmtZi(c.gbe_data_receptie_finala)}</b></span>
          <span>Recuperare estimată: <b style={{ color:G.text }}>{fmtZi(c.gbe_data_estimata_recuperare)}</b></span>
          {c.gbe_cont_iban && <span>Cont: <b style={{ color:G.text }}>{c.gbe_cont_iban}</b>{c.gbe_cont_valabil_pana ? ` (până ${fmtZi(c.gbe_cont_valabil_pana)})` : ''}</span>}
        </div>
      )}
      {al.length > 0 && (
        <div style={{ display:'flex', flexDirection:'column', gap:4, marginTop:8 }}>
          {al.map((a, i) => <div key={i} style={{ fontSize:12, color:culoare(a.n), fontWeight:600 }}>{a.n === 'critic' ? '🔴' : a.n === 'warn' ? '🟡' : 'ℹ️'} {a.t}</div>)}
        </div>
      )}
      {!compact && restituiri.length > 0 && (
        <div style={{ marginTop:8, fontSize:11.5, color:G.muted }}>
          {restituiri.map(r => <div key={r.id}>↩ {fmtZi(r.data_restituire)} · {fmtLei(r.valoare_lei)} · {RESTITUIRE_TIP[r.tip] || r.tip}{r.observatii ? ` — ${r.observatii}` : ''}</div>)}
        </div>
      )}
      {!compact && polite.length > 0 && <div style={{ marginTop:6, fontSize:11.5, color:G.muted }}>{polite.map(p => <div key={p.id}>🏦 {p.numar_polita || 'poliță'} · {p.emitent || ''}{p.valoare_lei ? ` · ${fmtLei(p.valoare_lei)}` : ''}{p.data_expirare ? ` · expiră ${fmtZi(p.data_expirare)}` : ''}</div>)}</div>}
      {!compact && c.gbe_observatii && <div style={{ marginTop:8, fontSize:12, color:G.text, whiteSpace:'pre-wrap', background:G.surface, borderRadius:7, padding:'8px 10px' }}>{c.gbe_observatii}</div>}
      {err && <div style={{ color:G.red, fontSize:12, marginTop:6 }}>{err}</div>}
      {!compact && canEdit && !edit && !nr && (
        <div style={{ display:'flex', gap:8, marginTop:10 }}>
          <button style={S.btnS} onClick={pornesteEdit}>✎ Date GBE</button>
          <button style={S.btnS} onClick={() => setNr({ data_restituire: new Date().toISOString().slice(0,10), valoare_lei: ramas > 0 ? (ramas * Number(c.gbe_pct_deblocare_receptie ?? 70) / 100).toFixed(2) : '', tip: c.gbe_data_receptie_finala ? 'finala' : 'receptie_terminare', observatii: '' })}>↩ Înregistrează restituire</button>
        </div>
      )}
      {edit && (
        <div style={{ marginTop:10, display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(170px, 1fr))', gap:8 }}>
          <div><label style={S.lbl}>GBE %</label><input type="number" step="0.01" value={f.garantie_buna_executie_pct} onChange={e => setF(x => ({ ...x, garantie_buna_executie_pct: e.target.value }))} style={S.input} /></div>
          <div><label style={S.lbl}>Reținut (manual, lei)</label><input type="number" step="0.01" value={f.gbe_retinut_manual} onChange={e => setF(x => ({ ...x, gbe_retinut_manual: e.target.value }))} style={S.input} placeholder="dacă SL nu-s în platformă" /></div>
          <div><label style={S.lbl}>Recepție la terminare</label><input type="date" value={f.gbe_data_receptie_terminare} onChange={e => setF(x => ({ ...x, gbe_data_receptie_terminare: e.target.value }))} style={S.input} /></div>
          <div><label style={S.lbl}>Recepție finală</label><input type="date" value={f.gbe_data_receptie_finala} onChange={e => setF(x => ({ ...x, gbe_data_receptie_finala: e.target.value }))} style={S.input} /></div>
          <div><label style={S.lbl}>Recuperare estimată</label><input type="date" value={f.gbe_data_estimata_recuperare} onChange={e => setF(x => ({ ...x, gbe_data_estimata_recuperare: e.target.value }))} style={S.input} /></div>
          <div><label style={S.lbl}>Cont garanție (IBAN, bancă)</label><input value={f.gbe_cont_iban} onChange={e => setF(x => ({ ...x, gbe_cont_iban: e.target.value }))} style={S.input} /></div>
          <div><label style={S.lbl}>Cont valabil până</label><input type="date" value={f.gbe_cont_valabil_pana} onChange={e => setF(x => ({ ...x, gbe_cont_valabil_pana: e.target.value }))} style={S.input} /></div>
          <div style={{ gridColumn:'1 / -1' }}><label style={S.lbl}>Observații GBE</label><textarea rows={3} value={f.gbe_observatii} onChange={e => setF(x => ({ ...x, gbe_observatii: e.target.value }))} style={{ ...S.input, resize:'vertical' }} /></div>
          <div style={{ gridColumn:'1 / -1', display:'flex', gap:8 }}>
            <button style={{ ...S.btnS, background:accent, color:'#0D1117', border:'none' }} disabled={busy} onClick={salveaza}>💾 Salvează</button>
            <button style={S.btnS} onClick={() => setEdit(false)}>Renunță</button>
          </div>
        </div>
      )}
      {nr && (
        <div style={{ marginTop:10, display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(150px, 1fr))', gap:8 }}>
          <div><label style={S.lbl}>Data</label><input type="date" value={nr.data_restituire} onChange={e => setNr(x => ({ ...x, data_restituire: e.target.value }))} style={S.input} /></div>
          <div><label style={S.lbl}>Valoare (lei)</label><input type="number" step="0.01" value={nr.valoare_lei} onChange={e => setNr(x => ({ ...x, valoare_lei: e.target.value }))} style={S.input} /></div>
          <div><label style={S.lbl}>Tip</label><select value={nr.tip} onChange={e => setNr(x => ({ ...x, tip: e.target.value }))} style={S.input}>{Object.entries(RESTITUIRE_TIP).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div style={{ gridColumn:'1 / -1' }}><label style={S.lbl}>Observații</label><input value={nr.observatii} onChange={e => setNr(x => ({ ...x, observatii: e.target.value }))} style={S.input} placeholder="nr. adresă / notă beneficiar, extras de cont" /></div>
          <div style={{ gridColumn:'1 / -1', display:'flex', gap:8 }}>
            <button style={{ ...S.btnS, background:accent, color:'#0D1117', border:'none' }} disabled={busy} onClick={salveazaRest}>💾 Salvează restituirea</button>
            <button style={S.btnS} onClick={() => setNr(null)}>Renunță</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Financiar: toate contractele cu GBE, cu alertele sus
export function GbeTabel({ accent = G.green, canEdit }) {
  const [d, setD] = useState(null)
  const [filtru, setFiltru] = useState('activ') // activ | toate
  const load = async () => {
    const { data: ids } = await supabase.from('contracte_terti').select('id').or('gbe_tip.not.is.null,garantie_buna_executie_pct.gt.0,gbe_retinut_manual.gt.0').neq('status', 'reziliat')
    setD(await incarca((ids || []).map(x => x.id)))
  }
  useEffect(() => { load() }, [])
  if (!d) return <div style={{ color:G.muted, fontSize:12 }}>Se încarcă…</div>
  const rows = d.contracte.map(c => ({ c, v: d.view[c.id], polite: d.polite[c.id] || [], rest: d.rest[c.id] || [] }))
    .map(r => ({ ...r, al: alerteGbe(r.c, r.v, r.polite, r.rest), ramas: Number(r.v?.gbe_ramas ?? 0) }))
    .filter(r => filtru === 'toate' || r.ramas > 0 || r.al.length > 0 || r.c.status !== 'finalizat')
    .sort((a, b) => (b.al.some(x => x.n === 'critic') - a.al.some(x => x.n === 'critic')) || (b.ramas - a.ramas))
  const totalBlocat = rows.reduce((s, r) => s + r.ramas, 0)
  const critice = rows.filter(r => r.al.some(x => x.n === 'critic'))
  return (
    <div>
      <div style={{ display:'flex', gap:12, alignItems:'center', flexWrap:'wrap', marginBottom:14 }}>
        <div style={{ fontSize:15, fontWeight:800 }}>🔐 Garanții de bună execuție</div>
        <span style={{ fontSize:12.5, color:G.muted }}>blocat acum: <b style={{ color:accent }}>{fmtLei(totalBlocat)}</b> pe {rows.filter(r => r.ramas > 0).length} contracte</span>
        {critice.length > 0 && <span style={{ fontSize:12, color:G.red, fontWeight:700 }}>🔴 {critice.length} cu acțiune de făcut</span>}
        <div style={{ marginLeft:'auto', display:'flex', gap:6 }}>
          {[['activ','Cu bani blocați / alerte'],['toate','Toate']].map(([k, l]) => <button key={k} onClick={() => setFiltru(k)} style={{ ...S.btnS, background: filtru === k ? accent + '22' : G.surface, color: filtru === k ? accent : G.muted, borderColor: filtru === k ? accent + '66' : G.border2 }}>{l}</button>)}
        </div>
      </div>
      <div style={{ fontSize:11.5, color:G.dim, marginBottom:10 }}>Aceeași evidență ca „Evidență GBE” din Administrativ → Contracte comerciale. Reținerile vin din situațiile de plată din platformă; unde nu există, se trec manual pe contract (✎).</div>
      {rows.length === 0 && <div style={{ color:G.muted, fontSize:12.5 }}>Nimic de arătat.</div>}
      <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
        {rows.map(r => <GbeCard key={r.c.id} c={r.c} v={r.v} polite={r.polite} restituiri={r.rest} accent={accent} canEdit={canEdit} onChanged={load} />)}
      </div>
    </div>
  )
}

// ── Ofertare: GBE pe fișa licitației (leagă licitația de contractul din Contracte comerciale)
export function GbeLicitatie({ licitatie: l, profile, accent = G.green, onChanged }) {
  const [d, setD] = useState(null)
  const [lista, setLista] = useState(null)
  const [alege, setAlege] = useState(false)
  const canEdit = profile?.is_owner === true || ['superadmin','contabilitate','admin_logistica'].includes(profile?.role)
  const load = async () => { setD(l.contract_id ? await incarca([l.contract_id]) : { contracte: [], view: {}, polite: {}, rest: {} }) }
  useEffect(() => { load() }, [l.contract_id])
  const deschideLista = async () => {
    const { data } = await supabase.from('contracte_terti').select('id, numar_contract, denumire, status, beneficiar:beneficiari(nume)').eq('sens', 'incasare').neq('status', 'reziliat').order('created_at', { ascending: false }).limit(200)
    setLista(data || []); setAlege(true)
  }
  const leaga = async (id) => {
    const { error } = await supabase.from('ofertare_licitatii').update({ contract_id: id, updated_at: new Date().toISOString() }).eq('id', l.id)
    if (error) { alert(error.message); return }
    setAlege(false); onChanged?.()
  }
  if (!['castigata','depusa'].includes(l.status) && !l.contract_id) return null
  const c = d?.contracte?.[0]
  return (
    <div style={{ background:G.surface, border:`1px solid ${G.border}`, borderRadius:10, padding:'16px 18px', marginTop:14 }}>
      <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap', marginBottom:10 }}>
        <div style={{ fontSize:15, fontWeight:800 }}>🔐 Garanție de bună execuție</div>
        <span style={{ fontSize:12, color:G.muted }}>{c ? 'contractul din Contracte comerciale' : 'după câștig: leagă licitația de contractul semnat'}</span>
        {canEdit && <button style={{ ...S.btnS, marginLeft:'auto' }} onClick={deschideLista}>{c ? '🔗 Schimbă contractul' : '🔗 Leagă contractul'}</button>}
      </div>
      {alege && (
        <div style={{ marginBottom:10, maxHeight:260, overflowY:'auto', border:`1px solid ${G.border2}`, borderRadius:8 }}>
          {(lista || []).map(x => (
            <button key={x.id} onClick={() => leaga(x.id)} style={{ display:'block', width:'100%', textAlign:'left', background: x.id === l.contract_id ? accent + '22' : 'transparent', border:'none', borderBottom:`1px solid ${G.border2}`, color:G.text, padding:'8px 10px', cursor:'pointer', fontSize:12.5 }}>
              <b>{x.numar_contract || '—'}</b> · {x.beneficiar?.nume || ''} · <span style={{ color:G.muted }}>{x.denumire?.slice(0, 90)}</span>{x.status === 'draft' ? ' · draft' : ''}
            </button>
          ))}
          <button onClick={() => setAlege(false)} style={{ ...S.btnS, margin:8 }}>Închide</button>
        </div>
      )}
      {!d ? <div style={{ color:G.muted, fontSize:12 }}>Se încarcă…</div>
        : !c ? <div style={{ color:G.dim, fontSize:12.5 }}>Nicio legătură încă. Contractul se adaugă în Administrativ → Contracte comerciale (cu rubrica GBE), apoi se leagă aici.</div>
        : <GbeCard c={c} v={d.view[c.id]} polite={d.polite[c.id] || []} restituiri={d.rest[c.id] || []} accent={accent} canEdit={canEdit} onChanged={load} />}
    </div>
  )
}
