// ════════════════════════════════════════════════════════════════════════════
// MAGAZIE → TAB PRODUCȚIE — v1.0 (01.09.2026, todo #991)
// Producție internă: flanșe multifuncționale + fitinguri de refulare.
// Flux A3: materie primă + prelucrare terți (facturi, ex. FLEXON-ALL) → lot →
// finalizare = intrare stoc produs finit → ieșiri (proiect/vânzare/custodie).
// Cost/buc = suma componentelor lotului / cantitate. La vânzare se afișează
// cota partenerului de agrement (Adrom Evolution — Dragoș Burdea, 50%).
// ════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback } from 'react'
import { supabase } from './lib/supabase.js'

const G = {
  bg:'#0D1117', surface:'#161B22', border:'#21262D', border2:'#30363D',
  text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  blue:'#58A6FF', green:'#3FB950', red:'#F85149', yellow:'#D29922',
  purple:'#BC8CFF', orange:'#F0883E', magazie:'#FF7B72', cyan:'#2FB6C9',
}
const S = {
  card: { background:G.surface, border:`1px solid ${G.border}`, borderRadius:12 },
  input: { background:G.bg, border:`1px solid ${G.border2}`, color:G.text, borderRadius:8, padding:'9px 12px', fontFamily:'inherit', fontSize:14, outline:'none', width:'100%', boxSizing:'border-box' },
  label: { fontSize:11, fontWeight:700, color:G.muted, textTransform:'uppercase', letterSpacing:.4, marginBottom:4, display:'block' },
  btnS: { background:'#161B22', color:'#E6EDF3', border:'1px solid #30363D', borderRadius:8, padding:'9px 16px', fontFamily:'inherit', fontSize:13, fontWeight:600, cursor:'pointer' },
  btnP: { background:G.green, color:'#06210F', border:'none', borderRadius:8, padding:'9px 16px', fontFamily:'inherit', fontSize:13, fontWeight:800, cursor:'pointer' },
  overlay: { position:'fixed', inset:0, background:'#000A', display:'flex', alignItems:'center', justifyContent:'center', zIndex:300, padding:16 },
  modal: { background:G.surface, border:`1px solid ${G.border2}`, borderRadius:14, padding:22, width:'100%', maxWidth:640, maxHeight:'90vh', overflowY:'auto' },
}
const fmt = (n) => (n == null || isNaN(n)) ? '—' : Number(n).toLocaleString('ro-RO', { maximumFractionDigits:2 })
const fmtD = (d) => { if (!d) return '—'; const x = new Date(d); return isNaN(x) ? '—' : x.toLocaleDateString('ro-RO') }

const TIP_PRODUS = {
  flansa_multifunctionala: { label:'Flanșă multifuncțională', emoji:'🔩', color:G.cyan },
  fiting_refulare:         { label:'Fiting de refulare',      emoji:'🔧', color:G.purple },
  altul:                   { label:'Alt produs',              emoji:'📦', color:G.muted },
}
const TIP_COMPONENTA = {
  materie_prima: { label:'Materie primă', emoji:'🧱' },
  prelucrare:    { label:'Prelucrare/asamblare', emoji:'🏭' },
  componenta:    { label:'Componentă (o-ring, semiinele…)', emoji:'⚙️' },
  transport:     { label:'Transport', emoji:'🚚' },
  altele:        { label:'Altele', emoji:'📎' },
}
const TIP_MISCARE = {
  intrare_productie: { label:'Intrare din producție', emoji:'📥', color:G.green },
  iesire_proiect:    { label:'Ieșire pe proiect',     emoji:'🏗️', color:G.blue },
  iesire_vanzare:    { label:'Vânzare',               emoji:'💰', color:G.yellow },
  iesire_custodie:   { label:'Custodie/închiriere',   emoji:'🤝', color:G.purple },
  retur:             { label:'Retur în stoc',         emoji:'↩️', color:G.cyan },
  ajustare:          { label:'Ajustare inventar',     emoji:'🛠️', color:G.muted },
}

export default function ProductieTab() {
  const [loading, setLoading] = useState(true)
  const [stoc, setStoc] = useState([])          // v_productie_stoc
  const [loturi, setLoturi] = useState([])
  const [miscari, setMiscari] = useState([])
  const [sites, setSites] = useState([])
  const [msg, setMsg] = useState(null)
  const [produsModal, setProdusModal] = useState(null)   // {} nou | rând existent
  const [lotModal, setLotModal] = useState(null)         // {produs} nou | {lot, produs} existent
  const [miscareModal, setMiscareModal] = useState(null) // {produs}

  const show = (text, type='ok') => { setMsg({ text, type }); setTimeout(() => setMsg(null), 4000) }

  const loadAll = useCallback(async () => {
    setLoading(true)
    const [{ data: st }, { data: lt }, { data: ms }, { data: si }] = await Promise.all([
      supabase.from('v_productie_stoc').select('*').order('denumire'),
      supabase.from('productie_loturi').select('*, productie_lot_componente(*)').order('id', { ascending:false }),
      supabase.from('productie_stoc_miscari').select('*').order('data', { ascending:false }).order('id', { ascending:false }).limit(200),
      supabase.from('sites').select('id, name').eq('active', true).order('name'),
    ])
    setStoc(st || []); setLoturi(lt || []); setMiscari(ms || []); setSites(si || [])
    setLoading(false)
  }, [])
  useEffect(() => { loadAll() }, [loadAll])

  if (loading) return <div style={{ color:G.dim, textAlign:'center', padding:40 }}>Se încarcă producția…</div>

  const totalStoc = stoc.reduce((s, r) => s + Number(r.stoc || 0), 0)
  const loturiInLucru = loturi.filter(l => l.status === 'in_lucru')

  return (
    <div>
      {msg && (
        <div style={{ position:'fixed', top:20, right:20, zIndex:400, padding:'12px 18px', borderRadius:10, fontWeight:700, fontSize:14,
          background: msg.type === 'err' ? G.red : G.green, color: msg.type === 'err' ? '#fff' : '#06210F' }}>{msg.text}</div>
      )}

      {/* Sumar */}
      <div style={{ display:'flex', gap:12, marginBottom:16, flexWrap:'wrap' }}>
        {[
          ['📦 Stoc produse finite', fmt(totalStoc) + ' buc', G.green],
          ['🏭 Loturi în lucru', loturiInLucru.length, G.yellow],
          ['📥 Loturi finalizate', loturi.filter(l => l.status === 'finalizat').length, G.blue],
        ].map(([l, v, c]) => (
          <div key={l} style={{ ...S.card, padding:'12px 18px', minWidth:160 }}>
            <div style={{ fontSize:12, color:G.muted }}>{l}</div>
            <div style={{ fontSize:20, fontWeight:800, color:c }}>{v}</div>
          </div>
        ))}
        <div style={{ flex:1 }} />
        <button onClick={() => setProdusModal({})} style={{ ...S.btnP, alignSelf:'center' }}>+ Produs nou</button>
      </div>

      {/* Produse */}
      {stoc.length === 0 && (
        <div style={{ ...S.card, padding:30, textAlign:'center', color:G.dim }}>
          Niciun produs definit. Adaugă primul (ex: Flanșă multifuncțională 8" #300).
        </div>
      )}
      {stoc.map(p => {
        const meta = TIP_PRODUS[p.tip] || TIP_PRODUS.altul
        const loturiP = loturi.filter(l => l.produs_id === p.produs_id)
        const miscariP = miscari.filter(m => m.produs_id === p.produs_id)
        const costBuc = Number(p.produse_total) > 0 ? Number(p.cost_total_lei) / Number(p.produse_total) : null
        return (
          <div key={p.produs_id} style={{ ...S.card, padding:'16px 20px', marginBottom:12, borderLeft:`3px solid ${meta.color}` }}>
            <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
              <span style={{ fontSize:22 }}>{meta.emoji}</span>
              <div style={{ flex:1, minWidth:220 }}>
                <div style={{ fontWeight:800, fontSize:15 }}>{p.denumire} {p.dimensiune && <span style={{ color:meta.color }}>{p.dimensiune}</span>} {p.clasa && <span style={{ color:G.muted }}>{p.clasa}</span>}</div>
                <div style={{ fontSize:12, color:G.muted, marginTop:2 }}>
                  {meta.label}{p.agrement_nr ? ` · Agrement ${p.agrement_nr}` : ''}{p.partener ? ` · ${p.partener} ${fmt(p.partener_cota_pct)}%` : ''}
                </div>
              </div>
              <div style={{ textAlign:'center', minWidth:80 }}>
                <div style={{ fontSize:22, fontWeight:800, color: Number(p.stoc) > 0 ? G.green : G.dim }}>{fmt(p.stoc)}</div>
                <div style={{ fontSize:11, color:G.muted }}>în stoc</div>
              </div>
              <div style={{ textAlign:'center', minWidth:110 }}>
                <div style={{ fontSize:15, fontWeight:700, color:G.yellow }}>{costBuc != null ? fmt(costBuc) + ' lei' : '—'}</div>
                <div style={{ fontSize:11, color:G.muted }}>cost mediu/buc</div>
              </div>
              <div style={{ display:'flex', gap:8 }}>
                <button onClick={() => setLotModal({ produs:p })} style={S.btnS} title="Lot nou de producție">🏭 Lot nou</button>
                <button onClick={() => setMiscareModal({ produs:p })} style={S.btnS} title="Ieșire / mișcare stoc">📤 Mișcare</button>
                <button onClick={() => setProdusModal(p)} style={S.btnS}>✏️</button>
              </div>
            </div>

            {/* Loturi */}
            {loturiP.length > 0 && (
              <div style={{ marginTop:12, display:'flex', flexDirection:'column', gap:6 }}>
                {loturiP.map(l => {
                  const cost = (l.productie_lot_componente || []).reduce((s, c) => s + Number(c.valoare_lei || 0), 0)
                  return (
                    <div key={l.id} onClick={() => setLotModal({ produs:p, lot:l })} style={{ display:'flex', alignItems:'center', gap:10, background:G.bg, border:`1px solid ${G.border2}`, borderRadius:8, padding:'8px 12px', cursor:'pointer', fontSize:13 }}>
                      <span>{l.status === 'finalizat' ? '✅' : l.status === 'anulat' ? '❌' : '🔨'}</span>
                      <span style={{ fontWeight:700 }}>{l.cod_lot || `Lot #${l.id}`}</span>
                      <span style={{ color:G.muted }}>{fmt(l.cantitate)} buc · {fmtD(l.data_start)}{l.data_finalizare ? ' → ' + fmtD(l.data_finalizare) : ''}</span>
                      <span style={{ flex:1 }} />
                      <span style={{ color:G.yellow }}>{cost > 0 ? fmt(cost) + ' lei' : 'fără costuri încă'}</span>
                      <span style={{ color:G.dim, fontSize:12 }}>({(l.productie_lot_componente || []).length} componente)</span>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Ultimele mișcări */}
            {miscariP.length > 0 && (
              <div style={{ marginTop:10, fontSize:12.5, color:G.muted }}>
                {miscariP.slice(0, 4).map(m => {
                  const mm = TIP_MISCARE[m.tip] || TIP_MISCARE.ajustare
                  const site = sites.find(s => s.id === m.site_id)?.name
                  return (
                    <div key={m.id} style={{ padding:'3px 0' }}>
                      {mm.emoji} {fmtD(m.data)} · <span style={{ color:mm.color }}>{mm.label}</span> · {m.cantitate > 0 ? '+' : ''}{fmt(m.cantitate)} buc
                      {site ? ` · ${site}` : ''}{m.beneficiar ? ` · ${m.beneficiar}` : ''}
                      {m.tip === 'iesire_vanzare' && m.valoare_lei != null && ` · ${fmt(m.valoare_lei)} lei (cota ${p.partener?.split(' (')[0] || 'partener'}: ${fmt(Number(m.valoare_lei) * Number(p.partener_cota_pct || 0) / 100)} lei)`}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}

      {produsModal && <ProdusModal item={produsModal} onClose={() => setProdusModal(null)} onSaved={() => { setProdusModal(null); loadAll(); show('✓ Produs salvat') }} onError={t => show(t, 'err')} />}
      {lotModal && <LotModal ctx={lotModal} onClose={() => setLotModal(null)} onSaved={(t) => { setLotModal(null); loadAll(); show(t || '✓ Lot salvat') }} onError={t => show(t, 'err')} />}
      {miscareModal && <MiscareModal produs={miscareModal.produs} sites={sites} onClose={() => setMiscareModal(null)} onSaved={() => { setMiscareModal(null); loadAll(); show('✓ Mișcare înregistrată') }} onError={t => show(t, 'err')} />}
    </div>
  )
}

// ─── Modal produs ───────────────────────────────────────────────────────────
function ProdusModal({ item, onClose, onSaved, onError }) {
  const isNew = !item.produs_id
  const [f, setF] = useState({
    tip: item.tip || 'flansa_multifunctionala',
    denumire: item.denumire || '',
    dimensiune: item.dimensiune || '',
    clasa: item.clasa || '',
    agrement_nr: item.agrement_nr || '',
    partener: item.partener ?? 'Adrom Evolution (Dragoș Burdea)',
    partener_cota_pct: item.partener_cota_pct ?? 50,
  })
  const [busy, setBusy] = useState(false)
  const save = async () => {
    if (!f.denumire.trim()) return onError('Completează denumirea')
    setBusy(true)
    const payload = { ...f, denumire: f.denumire.trim(), partener_cota_pct: Number(f.partener_cota_pct) || 0 }
    const { error } = isNew
      ? await supabase.from('productie_produse').insert(payload)
      : await supabase.from('productie_produse').update(payload).eq('id', item.produs_id)
    setBusy(false)
    if (error) return onError('Eroare: ' + error.message)
    onSaved()
  }
  return (
    <div style={S.overlay}>
      <div style={S.modal}>
        <div style={{ fontSize:17, fontWeight:800, marginBottom:16 }}>{isNew ? '📦 Produs nou' : '✏️ Editează produs'}</div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
          <div style={{ gridColumn:'1/3' }}>
            <label style={S.label}>Tip</label>
            <select value={f.tip} onChange={e => setF({ ...f, tip:e.target.value })} style={S.input}>
              {Object.entries(TIP_PRODUS).map(([k, v]) => <option key={k} value={k}>{v.emoji} {v.label}</option>)}
            </select>
          </div>
          <div style={{ gridColumn:'1/3' }}>
            <label style={S.label}>Denumire</label>
            <input value={f.denumire} onChange={e => setF({ ...f, denumire:e.target.value })} placeholder="ex: Flanșă multifuncțională" style={S.input} />
          </div>
          <div><label style={S.label}>Dimensiune</label><input value={f.dimensiune} onChange={e => setF({ ...f, dimensiune:e.target.value })} placeholder={'ex: 8"'} style={S.input} /></div>
          <div><label style={S.label}>Clasă</label><input value={f.clasa} onChange={e => setF({ ...f, clasa:e.target.value })} placeholder="ex: #300" style={S.input} /></div>
          <div style={{ gridColumn:'1/3' }}><label style={S.label}>Agrement tehnic (nr.)</label><input value={f.agrement_nr} onChange={e => setF({ ...f, agrement_nr:e.target.value })} style={S.input} /></div>
          <div><label style={S.label}>Partener agrement</label><input value={f.partener} onChange={e => setF({ ...f, partener:e.target.value })} style={S.input} /></div>
          <div><label style={S.label}>Cota partener %</label><input type="number" value={f.partener_cota_pct} onChange={e => setF({ ...f, partener_cota_pct:e.target.value })} style={S.input} /></div>
        </div>
        <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:18 }}>
          <button onClick={onClose} style={S.btnS}>Anulează</button>
          <button onClick={save} disabled={busy} style={{ ...S.btnP, opacity: busy ? .6 : 1 }}>{busy ? '...' : 'Salvează'}</button>
        </div>
      </div>
    </div>
  )
}

// ─── Modal lot (componente + finalizare) ────────────────────────────────────
function LotModal({ ctx, onClose, onSaved, onError }) {
  const { produs } = ctx
  const isNew = !ctx.lot
  const [lot, setLot] = useState(ctx.lot || null)
  const [f, setF] = useState({ cod_lot: ctx.lot?.cod_lot || '', cantitate: ctx.lot?.cantitate || '', note: ctx.lot?.note || '' })
  const [comp, setComp] = useState(ctx.lot?.productie_lot_componente || [])
  const [cNou, setCNou] = useState({ tip:'prelucrare', descriere:'', furnizor:'', factura_nr:'', factura_data:'', cantitate:'', um:'buc', valoare_lei:'' })
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const finalizat = lot?.status === 'finalizat'
  const costTotal = comp.reduce((s, c) => s + Number(c.valoare_lei || 0), 0)
  const costBuc = Number(f.cantitate) > 0 ? costTotal / Number(f.cantitate) : null

  const salveazaLot = async () => {
    if (!Number(f.cantitate)) return onError('Completează cantitatea (buc)')
    setBusy(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (isNew && !lot) {
      const { data, error } = await supabase.from('productie_loturi').insert({
        produs_id: produs.produs_id, cod_lot: f.cod_lot.trim() || null,
        cantitate: Number(f.cantitate), note: f.note.trim() || null, created_by: user?.id || null,
      }).select('*').single()
      setBusy(false)
      if (error) return onError('Eroare: ' + error.message)
      setLot(data); onSaved('✓ Lot creat — adaugă componentele de cost')
    } else {
      const { error } = await supabase.from('productie_loturi').update({
        cod_lot: f.cod_lot.trim() || null, cantitate: Number(f.cantitate), note: f.note.trim() || null,
      }).eq('id', lot.id)
      setBusy(false)
      if (error) return onError('Eroare: ' + error.message)
      onSaved()
    }
  }

  const adaugaComponenta = async () => {
    if (!lot) return onError('Salvează întâi lotul')
    if (!cNou.descriere.trim()) return onError('Completează descrierea componentei')
    setBusy(true)
    let pdf_path = null
    if (file) {
      const path = `lot_${lot.id}/${Date.now()}_${file.name.replace(/[^\w.-]+/g, '_')}`
      const { error: upErr } = await supabase.storage.from('productie').upload(path, file, { upsert:false })
      if (upErr) { setBusy(false); return onError('Upload: ' + upErr.message) }
      pdf_path = path
    }
    const { data, error } = await supabase.from('productie_lot_componente').insert({
      lot_id: lot.id, tip: cNou.tip, descriere: cNou.descriere.trim(),
      furnizor: cNou.furnizor.trim() || null, factura_nr: cNou.factura_nr.trim() || null,
      factura_data: cNou.factura_data || null,
      cantitate: Number(cNou.cantitate) || null, um: cNou.um || null,
      valoare_lei: Number(String(cNou.valoare_lei).replace(',', '.')) || null, pdf_path,
    }).select('*').single()
    setBusy(false)
    if (error) return onError('Eroare: ' + error.message)
    setComp([...comp, data])
    setCNou({ tip:'prelucrare', descriere:'', furnizor:'', factura_nr:'', factura_data:'', cantitate:'', um:'buc', valoare_lei:'' })
    setFile(null)
  }

  const stergeComponenta = async (c) => {
    const { error } = await supabase.from('productie_lot_componente').delete().eq('id', c.id)
    if (error) return onError('Eroare: ' + error.message)
    setComp(comp.filter(x => x.id !== c.id))
  }

  const finalizeaza = async () => {
    if (!lot) return
    if (!window.confirm(`Finalizezi lotul? ${fmt(f.cantitate)} buc intră în stocul de produse finite.`)) return
    setBusy(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase.from('productie_loturi').update({ status:'finalizat', data_finalizare: new Date().toISOString().slice(0, 10) }).eq('id', lot.id)
    if (!error) {
      const { error: e2 } = await supabase.from('productie_stoc_miscari').insert({
        produs_id: produs.produs_id, lot_id: lot.id, tip:'intrare_productie',
        cantitate: Number(f.cantitate), note: `Finalizare ${f.cod_lot || 'lot #' + lot.id} · cost ${fmt(costTotal)} lei (${costBuc != null ? fmt(costBuc) + ' lei/buc' : '—'})`,
        created_by: user?.id || null,
      })
      setBusy(false)
      if (e2) return onError('Stoc: ' + e2.message)
      onSaved('✓ Lot finalizat — ' + fmt(f.cantitate) + ' buc în stoc')
    } else { setBusy(false); onError('Eroare: ' + error.message) }
  }

  const veziPdf = async (c) => {
    const { data } = await supabase.storage.from('productie').createSignedUrl(c.pdf_path, 600)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  return (
    <div style={S.overlay}>
      <div style={{ ...S.modal, maxWidth:760 }}>
        <div style={{ fontSize:17, fontWeight:800, marginBottom:4 }}>🏭 {isNew && !lot ? 'Lot nou' : (f.cod_lot || `Lot #${lot?.id}`)} — {produs.denumire} {produs.dimensiune} {produs.clasa}</div>
        <div style={{ fontSize:12.5, color:G.muted, marginBottom:16 }}>{finalizat ? `✅ Finalizat ${fmtD(lot.data_finalizare)}` : '🔨 În lucru — adaugă costurile (materie primă, prelucrare, componente), apoi finalizează.'}</div>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 2fr', gap:12, marginBottom:14 }}>
          <div><label style={S.label}>Cod lot</label><input value={f.cod_lot} onChange={e => setF({ ...f, cod_lot:e.target.value })} placeholder="ex: FM8-2026-01" disabled={finalizat} style={S.input} /></div>
          <div><label style={S.label}>Cantitate (buc)</label><input type="number" value={f.cantitate} onChange={e => setF({ ...f, cantitate:e.target.value })} disabled={finalizat} style={S.input} /></div>
          <div><label style={S.label}>Note</label><input value={f.note} onChange={e => setF({ ...f, note:e.target.value })} disabled={finalizat} style={S.input} /></div>
        </div>

        {/* Componente de cost */}
        {lot && (
          <div style={{ ...S.card, padding:14, marginBottom:14, background:G.bg }}>
            <div style={{ fontWeight:700, fontSize:14, marginBottom:10 }}>Componente de cost · total <span style={{ color:G.yellow }}>{fmt(costTotal)} lei</span>{costBuc != null && <span style={{ color:G.muted }}> · {fmt(costBuc)} lei/buc</span>}</div>
            {comp.map(c => (
              <div key={c.id} style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 0', borderBottom:`1px solid ${G.border}`, fontSize:13 }}>
                <span>{(TIP_COMPONENTA[c.tip] || TIP_COMPONENTA.altele).emoji}</span>
                <span style={{ flex:1 }}>{c.descriere}{c.cantitate ? ` · ${fmt(c.cantitate)} ${c.um || ''}` : ''}</span>
                <span style={{ color:G.muted, fontSize:12 }}>{c.furnizor || ''}{c.factura_nr ? ` · fact. ${c.factura_nr}${c.factura_data ? '/' + fmtD(c.factura_data) : ''}` : ''}</span>
                <span style={{ color:G.yellow, fontWeight:700, minWidth:90, textAlign:'right' }}>{c.valoare_lei != null ? fmt(c.valoare_lei) + ' lei' : '—'}</span>
                {c.pdf_path && <button onClick={() => veziPdf(c)} style={{ ...S.btnS, padding:'3px 8px', fontSize:12 }}>📄</button>}
                {!finalizat && <button onClick={() => stergeComponenta(c)} style={{ ...S.btnS, padding:'3px 8px', fontSize:12, color:G.red }}>✕</button>}
              </div>
            ))}
            {!finalizat && (
              <div style={{ marginTop:10, display:'grid', gridTemplateColumns:'1.2fr 2fr 1fr', gap:8 }}>
                <select value={cNou.tip} onChange={e => setCNou({ ...cNou, tip:e.target.value })} style={S.input}>
                  {Object.entries(TIP_COMPONENTA).map(([k, v]) => <option key={k} value={k}>{v.emoji} {v.label}</option>)}
                </select>
                <input value={cNou.descriere} onChange={e => setCNou({ ...cNou, descriere:e.target.value })} placeholder="Descriere (ex: Servicii prelucrare flanșă 8” #300)" style={S.input} />
                <input value={cNou.valoare_lei} onChange={e => setCNou({ ...cNou, valoare_lei:e.target.value })} placeholder="Valoare lei (fără TVA)" style={S.input} />
                <input value={cNou.furnizor} onChange={e => setCNou({ ...cNou, furnizor:e.target.value })} placeholder="Furnizor (ex: FLEXON-ALL)" style={S.input} />
                <div style={{ display:'flex', gap:8 }}>
                  <input value={cNou.factura_nr} onChange={e => setCNou({ ...cNou, factura_nr:e.target.value })} placeholder="Nr. factură" style={S.input} />
                  <input type="date" value={cNou.factura_data} onChange={e => setCNou({ ...cNou, factura_data:e.target.value })} style={S.input} />
                </div>
                <div style={{ display:'flex', gap:8 }}>
                  <input value={cNou.cantitate} onChange={e => setCNou({ ...cNou, cantitate:e.target.value })} placeholder="Cant." style={{ ...S.input, width:70 }} />
                  <input value={cNou.um} onChange={e => setCNou({ ...cNou, um:e.target.value })} placeholder="UM" style={{ ...S.input, width:60 }} />
                </div>
                <label style={{ ...S.btnS, textAlign:'center', cursor:'pointer', gridColumn:'1/2' }}>
                  {file ? '📄 ' + file.name.slice(0, 22) : '📎 Atașează factura (PDF)'}
                  <input type="file" accept=".pdf,image/*" onChange={e => setFile(e.target.files?.[0] || null)} style={{ display:'none' }} />
                </label>
                <button onClick={adaugaComponenta} disabled={busy} style={{ ...S.btnP, gridColumn:'2/4' }}>+ Adaugă componentă</button>
              </div>
            )}
          </div>
        )}

        <div style={{ display:'flex', justifyContent:'space-between', gap:10 }}>
          <div>{lot && !finalizat && <button onClick={finalizeaza} disabled={busy} style={{ ...S.btnP, background:G.blue, color:'#06182B' }}>✅ Finalizează lotul (intră în stoc)</button>}</div>
          <div style={{ display:'flex', gap:10 }}>
            <button onClick={onClose} style={S.btnS}>Închide</button>
            {!finalizat && <button onClick={salveazaLot} disabled={busy} style={{ ...S.btnP, opacity: busy ? .6 : 1 }}>{busy ? '...' : (lot ? 'Salvează lot' : 'Creează lot')}</button>}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Modal mișcare stoc ─────────────────────────────────────────────────────
function MiscareModal({ produs, sites, onClose, onSaved, onError }) {
  const [f, setF] = useState({ tip:'iesire_proiect', cantitate:'', site_id:'', beneficiar:'', valoare_lei:'', data: new Date().toISOString().slice(0, 10), note:'' })
  const [busy, setBusy] = useState(false)
  const esteIesire = f.tip.startsWith('iesire')
  const cotaPartener = f.tip === 'iesire_vanzare' && Number(f.valoare_lei) > 0
    ? Number(f.valoare_lei) * Number(produs.partener_cota_pct || 0) / 100 : null

  const save = async () => {
    const cant = Number(String(f.cantitate).replace(',', '.'))
    if (!cant || cant <= 0) return onError('Completează cantitatea')
    if (esteIesire && cant > Number(produs.stoc)) return onError(`Stoc insuficient (disponibil: ${fmt(produs.stoc)} buc)`)
    setBusy(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase.from('productie_stoc_miscari').insert({
      produs_id: produs.produs_id, tip: f.tip,
      cantitate: esteIesire ? -cant : cant,
      site_id: f.site_id ? Number(f.site_id) : null,
      beneficiar: f.beneficiar.trim() || null,
      valoare_lei: Number(String(f.valoare_lei).replace(',', '.')) || null,
      data: f.data, note: f.note.trim() || null, created_by: user?.id || null,
    })
    setBusy(false)
    if (error) return onError('Eroare: ' + error.message)
    onSaved()
  }
  return (
    <div style={S.overlay}>
      <div style={S.modal}>
        <div style={{ fontSize:17, fontWeight:800, marginBottom:16 }}>📤 Mișcare stoc — {produs.denumire} {produs.dimensiune} {produs.clasa} <span style={{ color:G.muted, fontSize:13 }}>(stoc: {fmt(produs.stoc)} buc)</span></div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
          <div style={{ gridColumn:'1/3' }}>
            <label style={S.label}>Tip mișcare</label>
            <select value={f.tip} onChange={e => setF({ ...f, tip:e.target.value })} style={S.input}>
              {Object.entries(TIP_MISCARE).filter(([k]) => k !== 'intrare_productie').map(([k, v]) => <option key={k} value={k}>{v.emoji} {v.label}</option>)}
            </select>
          </div>
          <div><label style={S.label}>Cantitate (buc)</label><input type="number" value={f.cantitate} onChange={e => setF({ ...f, cantitate:e.target.value })} style={S.input} /></div>
          <div><label style={S.label}>Data</label><input type="date" value={f.data} onChange={e => setF({ ...f, data:e.target.value })} style={S.input} /></div>
          {f.tip === 'iesire_proiect' && (
            <div style={{ gridColumn:'1/3' }}>
              <label style={S.label}>Șantier / lucrare</label>
              <select value={f.site_id} onChange={e => setF({ ...f, site_id:e.target.value })} style={S.input}>
                <option value="">— alege —</option>
                {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}
          {(f.tip === 'iesire_vanzare' || f.tip === 'iesire_custodie') && (
            <div style={{ gridColumn:'1/3' }}><label style={S.label}>Beneficiar / client</label><input value={f.beneficiar} onChange={e => setF({ ...f, beneficiar:e.target.value })} style={S.input} /></div>
          )}
          {f.tip === 'iesire_vanzare' && (
            <div style={{ gridColumn:'1/3' }}>
              <label style={S.label}>Valoare vânzare (lei, fără TVA)</label>
              <input value={f.valoare_lei} onChange={e => setF({ ...f, valoare_lei:e.target.value })} style={S.input} />
              {cotaPartener != null && <div style={{ fontSize:12.5, color:G.purple, marginTop:6 }}>🤝 Cota {produs.partener} ({fmt(produs.partener_cota_pct)}%): <b>{fmt(cotaPartener)} lei</b></div>}
            </div>
          )}
          <div style={{ gridColumn:'1/3' }}><label style={S.label}>Note</label><input value={f.note} onChange={e => setF({ ...f, note:e.target.value })} style={S.input} /></div>
        </div>
        <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:18 }}>
          <button onClick={onClose} style={S.btnS}>Anulează</button>
          <button onClick={save} disabled={busy} style={{ ...S.btnP, opacity: busy ? .6 : 1 }}>{busy ? '...' : 'Înregistrează'}</button>
        </div>
      </div>
    </div>
  )
}
