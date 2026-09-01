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
const TIP_DOCUMENT = {
  agrement:                 { label:'Agrement tehnic',            emoji:'📜', color:'#D29922' },
  certificat_calitate:      { label:'Certificat calitate material', emoji:'🧾', color:'#2FB6C9' },
  declaratie_conformitate:  { label:'Declarație de conformitate', emoji:'✍️', color:'#3FB950' },
  certificat_conformitate:  { label:'Certificat de conformitate', emoji:'🏅', color:'#BC8CFF' },
  altul:                    { label:'Alt document',               emoji:'📎', color:'#8B949E' },
}
const MAGAZIE_TIP_PRODUS_PRODUCTIE = 16 // magazie_tipuri_material 'Produs finit producție'
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
  const [materiale, setMateriale] = useState([]) // productie_materiale (materii prime)
  const [msg, setMsg] = useState(null)
  const [produsModal, setProdusModal] = useState(null)   // {} nou | rând existent
  const [lotModal, setLotModal] = useState(null)         // {produs} nou | {lot, produs} existent
  const [miscareModal, setMiscareModal] = useState(null) // {produs}
  const [facturaModal, setFacturaModal] = useState(false) // true = upload nou | {pending: rând} = factură venită pe mail
  const [facturiPending, setFacturiPending] = useState([])
  const [documente, setDocumente] = useState([])       // productie_documente
  const [docModal, setDocModal] = useState(false)      // upload agrement/certificat
  const [genModal, setGenModal] = useState(null)       // {lot, produs} → generator declarație/certificat

  const show = (text, type='ok') => { setMsg({ text, type }); setTimeout(() => setMsg(null), 4000) }

  const loadAll = useCallback(async () => {
    setLoading(true)
    const [{ data: st }, { data: lt }, { data: ms }, { data: si }, { data: mat }] = await Promise.all([
      supabase.from('v_productie_stoc').select('*').order('denumire'),
      supabase.from('productie_loturi').select('*, productie_lot_componente(*)').order('id', { ascending:false }),
      supabase.from('productie_stoc_miscari').select('*').order('data', { ascending:false }).order('id', { ascending:false }).limit(200),
      supabase.from('sites').select('id, name').eq('active', true).order('name'),
      supabase.from('productie_materiale').select('*').order('denumire'),
    ])
    const [{ data: fp }, { data: docs }] = await Promise.all([
      supabase.from('productie_facturi').select('*').eq('confirmata', false).order('id', { ascending:false }),
      supabase.from('productie_documente').select('*').order('id', { ascending:false }),
    ])
    setStoc(st || []); setLoturi(lt || []); setMiscari(ms || []); setSites(si || []); setMateriale(mat || []); setFacturiPending(fp || []); setDocumente(docs || [])
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
        <button onClick={() => setFacturaModal(true)} style={{ ...S.btnP, background:G.purple, color:'#fff', alignSelf:'center' }}>📥 Factură (AI)</button>
        <button onClick={() => setProdusModal({})} style={{ ...S.btnP, alignSelf:'center' }}>+ Produs nou</button>
      </div>

      {/* Facturi pescuite de pe mail, în așteptare de confirmare */}
      {facturiPending.length > 0 && (
        <div style={{ ...S.card, padding:'14px 18px', marginBottom:14, borderLeft:`3px solid ${G.yellow}` }}>
          <div style={{ fontWeight:800, fontSize:14, marginBottom:8 }}>⏳ Facturi în așteptare ({facturiPending.length}) — venite pe mail, verifică și confirmă</div>
          <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
            {facturiPending.map(fp => {
              const mail = fp.ai_jsonb?._mail
              const err = fp.ai_jsonb?._eroare_ai
              return (
                <div key={fp.id} onClick={() => setFacturaModal({ pending: fp })} style={{ display:'flex', alignItems:'center', gap:10, background:G.bg, border:`1px solid ${G.border2}`, borderRadius:8, padding:'8px 12px', cursor:'pointer', fontSize:13, flexWrap:'wrap' }}>
                  <span>📧</span>
                  <span style={{ fontWeight:700 }}>{fp.furnizor || 'Furnizor necunoscut'}</span>
                  <span style={{ color:G.muted }}>{fp.numar || '—'} · {fmtD(fp.data)}</span>
                  {fp.total_fara_tva != null && <span style={{ color:G.yellow }}>{fmt(fp.total_fara_tva)} lei fără TVA</span>}
                  <span style={{ flex:1 }} />
                  {err && <span style={{ color:G.red, fontSize:12 }}>⚠ AI: {err}</span>}
                  {mail?.from && <span style={{ color:G.dim, fontSize:12 }}>de la {mail.from.replace(/<.*>/, '').trim()}</span>}
                  <span style={{ ...S.btnS, padding:'3px 10px', fontSize:12 }}>Verifică →</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Agremente & certificate */}
      {!documente.some(d => d.tip === 'agrement') && (
        <div style={{ ...S.card, padding:'10px 16px', marginBottom:14, borderLeft:`3px solid ${G.orange}`, fontSize:13, color:G.orange }}>
          ⚠️ Lipsesc agrementele tehnice — Dragoș (Adrom Evolution) trebuie să le urce în secțiunea „📜 Agremente & certificate" de mai jos.
        </div>
      )}
      <div style={{ ...S.card, padding:'14px 18px', marginBottom:14 }}>
        <div style={{ display:'flex', alignItems:'center', marginBottom: documente.length ? 8 : 0 }}>
          <div style={{ fontWeight:800, fontSize:14, flex:1 }}>📜 Agremente & certificate ({documente.length})</div>
          <button onClick={() => setDocModal(true)} style={{ ...S.btnS, padding:'5px 12px', fontSize:12 }}>+ Adaugă document</button>
        </div>
        {documente.length > 0 && (
          <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
            {documente.map(d => {
              const dm = TIP_DOCUMENT[d.tip] || TIP_DOCUMENT.altul
              const prod = stoc.find(p => p.produs_id === d.produs_id)
              const mat = materiale.find(m => m.id === d.material_id)
              const expirat = d.valabil_pana && new Date(d.valabil_pana) < new Date()
              return (
                <div key={d.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'5px 0', borderBottom:`1px solid ${G.border}`, fontSize:13, flexWrap:'wrap' }}>
                  <span>{dm.emoji}</span>
                  <span style={{ color:dm.color, fontSize:11, fontWeight:800, textTransform:'uppercase' }}>{dm.label}</span>
                  <span style={{ fontWeight:700 }}>{d.denumire}</span>
                  {prod && <span style={{ color:G.muted, fontSize:12 }}>· {prod.denumire} {prod.dimensiune || ''}</span>}
                  {mat && <span style={{ color:G.muted, fontSize:12 }}>· {mat.denumire}</span>}
                  {d.valabil_pana && <span style={{ color: expirat ? G.red : G.muted, fontSize:12 }}>{expirat ? '⚠ expirat ' : 'valabil până '}{fmtD(d.valabil_pana)}</span>}
                  <span style={{ flex:1 }} />
                  {d.file_path && <button onClick={async () => { const { data } = await supabase.storage.from('productie').createSignedUrl(d.file_path, 600); if (data?.signedUrl) window.open(data.signedUrl, '_blank') }} style={{ ...S.btnS, padding:'2px 8px', fontSize:12 }}>📄 Vezi</button>}
                  <button onClick={async () => {
                    if (!window.confirm(`Ștergi documentul „${d.denumire}"?`)) return
                    const { error } = await supabase.from('productie_documente').delete().eq('id', d.id)
                    if (error) return show('Eroare: ' + error.message, 'err')
                    if (d.file_path) await supabase.storage.from('productie').remove([d.file_path])
                    loadAll()
                  }} style={{ ...S.btnS, padding:'2px 8px', fontSize:12, color:G.red }}>✕</button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Stoc materii prime pentru producție */}
      {materiale.length > 0 && (
        <div style={{ ...S.card, padding:'14px 18px', marginBottom:14 }}>
          <div style={{ fontWeight:800, fontSize:14, marginBottom:8 }}>🧱 Materii prime & componente (stoc producție)</div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
            {materiale.map(m => (
              <div key={m.id} style={{ background:G.bg, border:`1px solid ${G.border2}`, borderRadius:8, padding:'7px 12px', fontSize:12.5 }}>
                {m.denumire} · <b style={{ color: Number(m.cantitate) > 0 ? G.green : G.red }}>{fmt(m.cantitate)} {m.um}</b>
                {m.cost_mediu != null && <span style={{ color:G.muted }}> · {fmt(m.cost_mediu)} lei/{m.um}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

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
                      {l.status === 'finalizat' && <button onClick={ev => { ev.stopPropagation(); setGenModal({ lot:l, produs:p }) }} style={{ ...S.btnS, padding:'2px 9px', fontSize:12 }} title="Declarație / Certificat de conformitate">📜</button>}
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
      {lotModal && <LotModal ctx={lotModal} materiale={materiale} onClose={() => setLotModal(null)} onSaved={(t) => { setLotModal(null); loadAll(); show(t || '✓ Lot salvat') }} onError={t => show(t, 'err')} />}
      {facturaModal && <FacturaAiModal pending={facturaModal?.pending || null} onClose={() => setFacturaModal(false)} onSaved={(t) => { setFacturaModal(false); loadAll(); show(t) }} onError={t => show(t, 'err')} />}
      {miscareModal && <MiscareModal produs={miscareModal.produs} sites={sites} onClose={() => setMiscareModal(null)} onSaved={() => { setMiscareModal(null); loadAll(); show('✓ Mișcare înregistrată') }} onError={t => show(t, 'err')} />}
      {docModal && <DocumentModal stoc={stoc} materiale={materiale} onClose={() => setDocModal(false)} onSaved={() => { setDocModal(false); loadAll(); show('✓ Document salvat') }} onError={t => show(t, 'err')} />}
      {genModal && <GenDocModal ctx={genModal} documente={documente} onClose={() => setGenModal(null)} onSaved={(t) => { loadAll(); show(t) }} onError={t => show(t, 'err')} />}
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
        <div style={{ display:'flex', justifyContent:'space-between', gap:10, marginTop:18 }}>
          <div>
            {!isNew && (
              <button disabled={busy} style={{ ...S.btnS, color:G.red }} onClick={async () => {
                if (!window.confirm(`Ștergi produsul „${f.denumire}"? Merge doar dacă nu are loturi sau mișcări de stoc.`)) return
                setBusy(true)
                const { error } = await supabase.from('productie_produse').delete().eq('id', item.produs_id)
                setBusy(false)
                if (error) return onError(error.message.includes('foreign key') || error.message.includes('violates') ? 'Nu se poate șterge: produsul are loturi sau mișcări de stoc. Șterge-le întâi sau dezactivează produsul.' : 'Eroare: ' + error.message)
                onSaved()
              }}>🗑 Șterge</button>
            )}
          </div>
          <div style={{ display:'flex', gap:10 }}>
            <button onClick={onClose} style={S.btnS}>Anulează</button>
            <button onClick={save} disabled={busy} style={{ ...S.btnP, opacity: busy ? .6 : 1 }}>{busy ? '...' : 'Salvează'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Modal lot (componente + finalizare) ────────────────────────────────────
function LotModal({ ctx, materiale = [], onClose, onSaved, onError }) {
  const [matSel, setMatSel] = useState('')
  const [matCant, setMatCant] = useState('')
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

  // Consum din stocul de materii prime: scade stocul + intră drept componentă a lotului
  const adaugaDinStoc = async () => {
    if (!lot) return onError('Salvează întâi lotul')
    const mat = materiale.find(x => x.id === Number(matSel))
    const cant = Number(String(matCant).replace(',', '.'))
    if (!mat || !cant || cant <= 0) return onError('Alege materialul și cantitatea')
    if (cant > Number(mat.cantitate)) return onError(`Stoc insuficient: ${fmt(mat.cantitate)} ${mat.um} disponibil`)
    setBusy(true)
    const { data: { user } } = await supabase.auth.getUser()
    const valoare = mat.cost_mediu != null ? cant * Number(mat.cost_mediu) : null
    const { data: comp, error: e1 } = await supabase.from('productie_lot_componente').insert({
      lot_id: lot.id, tip: 'materie_prima', descriere: mat.denumire,
      cantitate: cant, um: mat.um, valoare_lei: valoare,
    }).select('*').single()
    if (e1) { setBusy(false); return onError('Eroare: ' + e1.message) }
    const { error: e2 } = await supabase.from('productie_materiale_miscari').insert({
      material_id: mat.id, tip: 'iesire_lot', cantitate: -cant, lot_id: lot.id,
      note: `Consum pe ${f.cod_lot || 'lot #' + lot.id}`, created_by: user?.id || null,
    })
    if (!e2) await supabase.from('productie_materiale').update({ cantitate: Number(mat.cantitate) - cant, updated_at: new Date().toISOString() }).eq('id', mat.id)
    setBusy(false)
    if (e2) return onError('Stoc: ' + e2.message)
    mat.cantitate = Number(mat.cantitate) - cant
    setComp([...comp2Add(comp)])
    setMatSel(''); setMatCant('')
  }
  const comp2Add = (c) => { const arr = comp.slice(); arr.push(c); return arr }

  const stergeComponenta = async (c) => {
    const { error } = await supabase.from('productie_lot_componente').delete().eq('id', c.id)
    if (error) return onError('Eroare: ' + error.message)
    setComp(comp.filter(x => x.id !== c.id))
  }

  // Flux complet #45: serii unice + magazia mare + valoare inventar (cost+3%) + mail Marilena (WinMentor)
  const finalizeaza = async () => {
    if (!lot) return
    const cant = Number(f.cantitate)
    const inventarTotal = costTotal * 1.03
    if (!window.confirm(`Finalizezi lotul? ${fmt(cant)} buc intră în stoc cu serii unice și în magazia mare.\nValoare inventar: ${fmt(costTotal)} lei + 3% pierderi tehnologice = ${fmt(inventarTotal)} lei.\nMarilena primește mail cu materialele de scăzut din WinMentor.`)) return
    setBusy(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const azi = new Date().toISOString().slice(0, 10)
      const an = new Date().getFullYear()
      // cod serie de pe produs (ex FM8) — fallback din denumire+dimensiune
      const { data: prodRow } = await supabase.from('productie_produse').select('cod_serie, denumire, dimensiune, clasa').eq('id', produs.produs_id).single()
      const cod = (prodRow?.cod_serie || (produs.denumire || 'PR').replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase() + String(produs.dimensiune || '').replace(/[^0-9]/g, '')).trim()
      // următorul număr de serie pentru codul ăsta în anul curent
      const prefix = `GZP-${cod}-${an}-`
      const { data: ultima } = await supabase.from('productie_serii').select('serie').like('serie', prefix + '%').order('serie', { ascending:false }).limit(1)
      let nr = ultima?.length ? Number(ultima[0].serie.slice(prefix.length)) || 0 : 0
      const inventarBuc = cant > 0 ? inventarTotal / cant : null

      const { error } = await supabase.from('productie_loturi').update({ status:'finalizat', data_finalizare: azi }).eq('id', lot.id)
      if (error) throw new Error(error.message)

      // per bucată: rând în magazia mare (magazie_bucati) + seria în productie_serii
      const serii = []
      for (let i = 0; i < cant; i++) {
        const serie = prefix + String(++nr).padStart(4, '0')
        const { data: bucata, error: eB } = await supabase.from('magazie_bucati').insert({
          tip_material_id: MAGAZIE_TIP_PRODUS_PRODUCTIE, serie,
          dimensiune: [prodRow?.dimensiune, prodRow?.clasa].filter(Boolean).join(' ') || null,
          cantitate: 1, um: 'buc', provenienta: 'Producție internă',
          furnizor: 'Gazpet Instal (producție proprie)', producator: 'Gazpet Instal + Adrom Evolution',
          stare: 'sosit', locatie_tip: 'sediu', data_receptie: azi,
          observatii: `${prodRow?.denumire || ''} — ${f.cod_lot || 'lot #' + lot.id} · valoare inventar ${fmt(inventarBuc)} lei/buc (cost + 3% pierderi tehnologice)`,
          atribute: { produs_id: produs.produs_id, lot_id: lot.id, valoare_inventar: inventarBuc },
          created_by: user?.id || null,
        }).select('id').single()
        if (eB) throw new Error('Magazie: ' + eB.message)
        const { error: eS } = await supabase.from('productie_serii').insert({
          produs_id: produs.produs_id, lot_id: lot.id, serie,
          magazie_bucata_id: bucata.id, valoare_inventar: inventarBuc,
        })
        if (eS) throw new Error('Serii: ' + eS.message)
        serii.push(serie)
      }

      const { error: e2 } = await supabase.from('productie_stoc_miscari').insert({
        produs_id: produs.produs_id, lot_id: lot.id, tip:'intrare_productie',
        cantitate: cant, note: `Finalizare ${f.cod_lot || 'lot #' + lot.id} · cost ${fmt(costTotal)} lei · inventar ${fmt(inventarTotal)} lei (+3%) · serii ${serii[0] || ''}${serii.length > 1 ? '…' + serii[serii.length - 1] : ''}`,
        created_by: user?.id || null,
      })
      if (e2) throw new Error('Stoc: ' + e2.message)

      // mail Marilena + Razvan (WinMentor) — eroarea de mail nu blochează finalizarea
      let mailOk = false
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const r = await fetch('https://dxczwkbciseqniprspcu.supabase.co/functions/v1/productie-lot-final', {
          method: 'POST', headers: { Authorization: `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ lot_id: lot.id }),
        })
        mailOk = (await r.json())?.ok === true
      } catch { /* raportăm mai jos */ }

      setBusy(false)
      onSaved(`✓ Lot finalizat: ${fmt(cant)} buc cu seriile ${serii.join(', ')} — în stoc + magazia mare.` + (mailOk ? ' Mail trimis la Marilena.' : ' ⚠ Mailul către Marilena NU a plecat — anunț-o manual.'))
    } catch (e) { setBusy(false); onError('Eroare: ' + (e?.message || e)) }
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
            {!finalizat && materiale.length > 0 && (
              <div style={{ marginTop:10, display:'flex', gap:8, alignItems:'center', padding:'8px 0', borderBottom:`1px dashed ${G.border2}` }}>
                <span style={{ fontSize:12.5, color:G.cyan, fontWeight:700 }}>🧱 Din stoc:</span>
                <select value={matSel} onChange={e => setMatSel(e.target.value)} style={{ ...S.input, flex:2 }}>
                  <option value="">— alege materialul —</option>
                  {materiale.filter(m => Number(m.cantitate) > 0).map(m => <option key={m.id} value={m.id}>{m.denumire} ({fmt(m.cantitate)} {m.um}{m.cost_mediu != null ? ` · ${fmt(m.cost_mediu)} lei` : ''})</option>)}
                </select>
                <input value={matCant} onChange={e => setMatCant(e.target.value)} placeholder="Cant." style={{ ...S.input, width:80 }} />
                <button onClick={adaugaDinStoc} disabled={busy} style={{ ...S.btnP, background:G.cyan, color:'#06272B' }}>Consumă</button>
              </div>
            )}
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
          <div style={{ display:'flex', gap:10 }}>
            {lot && !finalizat && <button onClick={finalizeaza} disabled={busy} style={{ ...S.btnP, background:G.blue, color:'#06182B' }}>✅ Finalizează lotul (intră în stoc)</button>}
            {lot && !finalizat && (
              <button disabled={busy} style={{ ...S.btnS, color:G.red }} onClick={async () => {
                if (!window.confirm(`Ștergi lotul ${f.cod_lot || '#' + lot.id}? Componentele lui se șterg și ele; consumurile din stocul de materii prime NU se returnează automat.`)) return
                setBusy(true)
                const { error } = await supabase.from('productie_loturi').delete().eq('id', lot.id)
                setBusy(false)
                if (error) return onError('Eroare: ' + error.message)
                onSaved('✓ Lot șters')
              }}>🗑 Șterge lotul</button>
            )}
          </div>
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

// ─── Modal factură cu AI ────────────────────────────────────────────────────
// Upload PDF → productie-factura-ai (Claude) → tabel editabil → Confirmă:
// bunurile intră în stocul de materii prime (cost mediu ponderat), serviciile
// se marchează informativ (se atașează pe lot la prelucrare).
function FacturaAiModal({ pending, onClose, onSaved, onError }) {
  // pending = rând productie_facturi cu confirmata=false (venit pe mail) → prefill + UPDATE în loc de INSERT
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [pdfPath, setPdfPath] = useState(pending?.pdf_path || null)
  const [ex, setEx] = useState(() => {   // extractia editabilă
    if (!pending) return null
    const { _mail, _eroare_ai, ...rest } = pending.ai_jsonb || {}
    return { furnizor: pending.furnizor, numar: pending.numar, data: pending.data, total_fara_tva: pending.total_fara_tva, linii: [], ...rest }
  })

  const citeste = async () => {
    if (!file) return onError('Alege PDF-ul facturii')
    setBusy(true)
    try {
      const path = `facturi/${Date.now()}_${file.name.replace(/[^\w.-]+/g, '_')}`
      const { error: upErr } = await supabase.storage.from('productie').upload(path, file, { upsert: false })
      if (upErr) throw new Error('Upload: ' + upErr.message)
      setPdfPath(path)
      const { data: { session } } = await supabase.auth.getSession()
      const r = await fetch('https://dxczwkbciseqniprspcu.supabase.co/functions/v1/productie-factura-ai', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdf_path: path }),
      })
      const j = await r.json()
      if (j.error) throw new Error(j.error)
      setEx(j.extractie)
    } catch (e) { onError('Eroare: ' + (e?.message || e)) } finally { setBusy(false) }
  }

  const setLinie = (i, patch) => setEx(x => ({ ...x, linii: x.linii.map((l, k) => k === i ? { ...l, ...patch } : l) }))
  const stergeLinie = (i) => setEx(x => ({ ...x, linii: x.linii.filter((_, k) => k !== i) }))

  const confirma = async () => {
    if (!ex?.linii?.length) return onError('Nimic de confirmat')
    setBusy(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const antet = {
        furnizor: ex.furnizor || null, numar: ex.numar || null, data: ex.data || null,
        total_fara_tva: Number(ex.total_fara_tva) || null, pdf_path: pdfPath,
        ai_jsonb: pending ? { ...ex, _mail: pending.ai_jsonb?._mail } : ex, confirmata: true,
      }
      let fact
      if (pending) {
        const { data: d, error: eF } = await supabase.from('productie_facturi').update(antet).eq('id', pending.id).select('id').single()
        if (eF) throw new Error(eF.message)
        fact = d
      } else {
        const { data: d, error: eF } = await supabase.from('productie_facturi').insert({ ...antet, created_by: user?.id || null }).select('id').single()
        if (eF) throw new Error(eF.message)
        fact = d
      }
      let intrate = 0
      for (const l of ex.linii) {
        if (l.este_serviciu) continue
        const cant = Number(l.cantitate) || 0
        if (cant <= 0) continue
        const denum = String(l.descriere || '').trim()
        // upsert material pe denumire (case-insensitive) + cost mediu ponderat
        const { data: exist } = await supabase.from('productie_materiale').select('*').ilike('denumire', denum).limit(1).maybeSingle()
        let matId
        if (exist) {
          const vNou = Number(l.pret_unitar) || 0
          const cTot = Number(exist.cantitate) + cant
          const cost = cTot > 0 && vNou > 0
            ? ((Number(exist.cost_mediu) || 0) * Number(exist.cantitate) + vNou * cant) / cTot
            : (exist.cost_mediu ?? (vNou || null))
          await supabase.from('productie_materiale').update({ cantitate: cTot, cost_mediu: cost, updated_at: new Date().toISOString() }).eq('id', exist.id)
          matId = exist.id
        } else {
          const { data: nou, error: eM } = await supabase.from('productie_materiale').insert({
            denumire: denum, um: l.um || 'buc', cantitate: cant, cost_mediu: Number(l.pret_unitar) || null,
          }).select('id').single()
          if (eM) throw new Error(eM.message)
          matId = nou.id
        }
        await supabase.from('productie_materiale_miscari').insert({
          material_id: matId, tip: 'intrare_factura', cantitate: cant,
          pret_unitar: Number(l.pret_unitar) || null, factura_id: fact.id,
          data: ex.data || new Date().toISOString().slice(0, 10),
          note: `${ex.furnizor || ''} fact. ${ex.numar || ''}`.trim(), created_by: user?.id || null,
        })
        intrate++
      }
      const servicii = ex.linii.filter(l => l.este_serviciu).length
      onSaved(`✓ Factură confirmată: ${intrate} materiale în stoc` + (servicii ? ` · ${servicii} servicii (le atașezi pe lot la prelucrare)` : ''))
    } catch (e) { onError('Eroare: ' + (e?.message || e)) } finally { setBusy(false) }
  }

  return (
    <div style={S.overlay}>
      <div style={{ ...S.modal, maxWidth: 820 }}>
        <div style={{ fontSize:17, fontWeight:800, marginBottom:6 }}>{pending ? '📧 Factură venită pe mail — verifică și confirmă' : '📥 Factură nouă — citită cu AI'}</div>
        <div style={{ fontSize:12.5, color:G.muted, marginBottom:14 }}>Urci PDF-ul, AI-ul extrage liniile, tu verifici și confirmi. Bunurile intră în stocul de materii prime; serviciile (prelucrare/manoperă) le atașezi pe lot.</div>

        {!ex && (
          <div style={{ display:'flex', gap:10, alignItems:'center' }}>
            <label style={{ ...S.btnS, cursor:'pointer', flex:1, textAlign:'center' }}>
              {file ? '📄 ' + file.name : '📎 Alege PDF-ul facturii'}
              <input type="file" accept=".pdf" onChange={e => setFile(e.target.files?.[0] || null)} style={{ display:'none' }} />
            </label>
            <button onClick={citeste} disabled={busy || !file} style={{ ...S.btnP, background:G.purple, color:'#fff', opacity: busy || !file ? .6 : 1 }}>{busy ? 'Citesc cu AI…' : '🤖 Citește factura'}</button>
          </div>
        )}

        {ex && (
          <>
            <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr 1fr 1fr', gap:10, marginBottom:12 }}>
              <div><label style={S.label}>Furnizor</label><input value={ex.furnizor || ''} onChange={e => setEx({ ...ex, furnizor: e.target.value })} style={S.input} /></div>
              <div><label style={S.label}>Nr. factură</label><input value={ex.numar || ''} onChange={e => setEx({ ...ex, numar: e.target.value })} style={S.input} /></div>
              <div><label style={S.label}>Data</label><input type="date" value={ex.data || ''} onChange={e => setEx({ ...ex, data: e.target.value })} style={S.input} /></div>
              <div><label style={S.label}>Total fără TVA</label><input value={ex.total_fara_tva ?? ''} onChange={e => setEx({ ...ex, total_fara_tva: e.target.value })} style={S.input} /></div>
            </div>
            <div style={{ ...S.card, background:G.bg, padding:12, marginBottom:14, maxHeight:340, overflowY:'auto' }}>
              {(ex.linii || []).map((l, i) => (
                <div key={i} style={{ display:'grid', gridTemplateColumns:'24px 3fr 70px 60px 90px 90px 90px 30px', gap:8, alignItems:'center', padding:'6px 0', borderBottom:`1px solid ${G.border}`, fontSize:13 }}>
                  <input type="checkbox" checked={!l.este_serviciu} onChange={e => setLinie(i, { este_serviciu: !e.target.checked })} title="Bifat = intră în stoc (bun fizic); nebifat = serviciu" />
                  <input value={l.descriere || ''} onChange={e => setLinie(i, { descriere: e.target.value })} style={{ ...S.input, padding:'6px 8px' }} />
                  <input value={l.cantitate ?? ''} onChange={e => setLinie(i, { cantitate: e.target.value })} style={{ ...S.input, padding:'6px 8px' }} />
                  <input value={l.um || ''} onChange={e => setLinie(i, { um: e.target.value })} style={{ ...S.input, padding:'6px 8px' }} />
                  <input value={l.pret_unitar ?? ''} onChange={e => setLinie(i, { pret_unitar: e.target.value })} style={{ ...S.input, padding:'6px 8px' }} title="Preț unitar fără TVA" />
                  <span style={{ color:G.yellow, textAlign:'right' }}>{l.valoare != null ? fmt(l.valoare) + ' lei' : '—'}</span>
                  <span style={{ fontSize:11, color: l.este_serviciu ? G.purple : G.green, fontWeight:700 }}>{l.este_serviciu ? 'serviciu' : '→ stoc'}</span>
                  <button onClick={() => stergeLinie(i)} style={{ ...S.btnS, padding:'2px 7px', fontSize:11, color:G.red }}>✕</button>
                </div>
              ))}
            </div>
            <div style={{ display:'flex', justifyContent:'flex-end', gap:10 }}>
              {pending && (
                <button onClick={async () => {
                  if (!window.confirm('Ștergi factura asta din așteptare? (dacă nu e a producției)')) return
                  setBusy(true)
                  const { error } = await supabase.from('productie_facturi').delete().eq('id', pending.id)
                  if (error) { onError('Eroare: ' + error.message); setBusy(false) }
                  else { if (pending.pdf_path) await supabase.storage.from('productie').remove([pending.pdf_path]); onSaved('🗑 Factură ștearsă din așteptare') }
                }} disabled={busy} style={{ ...S.btnS, color:G.red, marginRight:'auto' }}>🗑 Nu e a producției — șterge</button>
              )}
              <button onClick={onClose} style={S.btnS}>Anulează</button>
              <button onClick={confirma} disabled={busy} style={{ ...S.btnP, opacity: busy ? .6 : 1 }}>{busy ? '...' : '✅ Confirmă — bagă în stoc'}</button>
            </div>
          </>
        )}
        {!ex && <div style={{ display:'flex', justifyContent:'flex-end', marginTop:14 }}><button onClick={onClose} style={S.btnS}>Închide</button></div>}
      </div>
    </div>
  )
}

// ─── Modal document (agrement / certificat calitate) ────────────────────────
function DocumentModal({ stoc = [], materiale = [], onClose, onSaved, onError }) {
  const [f, setF] = useState({ tip:'agrement', denumire:'', produs_id:'', material_id:'', valabil_pana:'', note:'' })
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)

  const salveaza = async () => {
    if (!f.denumire.trim()) return onError('Completează denumirea documentului')
    setBusy(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      let file_path = null
      if (file) {
        const path = `documente/${Date.now()}_${file.name.replace(/[^\w.-]+/g, '_')}`
        const { error: upErr } = await supabase.storage.from('productie').upload(path, file, { upsert:false })
        if (upErr) throw new Error('Upload: ' + upErr.message)
        file_path = path
      }
      const { error } = await supabase.from('productie_documente').insert({
        tip: f.tip, denumire: f.denumire.trim(), file_path,
        produs_id: f.produs_id ? Number(f.produs_id) : null,
        material_id: f.material_id ? Number(f.material_id) : null,
        valabil_pana: f.valabil_pana || null, note: f.note.trim() || null,
        uploaded_by: user?.id || null,
      })
      if (error) throw new Error(error.message)
      // agrementul se leagă și pe produs (nr afișat pe card + folosit în declarații)
      if (f.tip === 'agrement' && f.produs_id) {
        await supabase.from('productie_produse').update({ agrement_nr: f.denumire.trim() }).eq('id', Number(f.produs_id))
      }
      setBusy(false)
      onSaved()
    } catch (e) { setBusy(false); onError('Eroare: ' + (e?.message || e)) }
  }

  return (
    <div style={S.overlay}>
      <div style={{ ...S.modal, maxWidth:560 }}>
        <div style={{ fontSize:17, fontWeight:800, marginBottom:6 }}>📜 Document nou — Producție</div>
        <div style={{ fontSize:12.5, color:G.muted, marginBottom:14 }}>Agremente tehnice (le urcă Dragoș), certificate de calitate materiale, alte documente.</div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
          <div><label style={S.label}>Tip document</label>
            <select value={f.tip} onChange={e => setF({ ...f, tip:e.target.value })} style={S.input}>
              {Object.entries(TIP_DOCUMENT).filter(([k]) => !['declaratie_conformitate','certificat_conformitate'].includes(k)).map(([k, v]) => <option key={k} value={k}>{v.emoji} {v.label}</option>)}
            </select>
          </div>
          <div><label style={S.label}>Valabil până la (opțional)</label><input type="date" value={f.valabil_pana} onChange={e => setF({ ...f, valabil_pana:e.target.value })} style={S.input} /></div>
          <div style={{ gridColumn:'1/3' }}><label style={S.label}>Denumire / număr</label><input value={f.denumire} onChange={e => setF({ ...f, denumire:e.target.value })} placeholder="ex: Agrement tehnic 016-07/1234-2026" style={S.input} /></div>
          <div><label style={S.label}>Produs (opțional)</label>
            <select value={f.produs_id} onChange={e => setF({ ...f, produs_id:e.target.value })} style={S.input}>
              <option value="">—</option>
              {stoc.map(p => <option key={p.produs_id} value={p.produs_id}>{p.denumire} {p.dimensiune || ''} {p.clasa || ''}</option>)}
            </select>
          </div>
          <div><label style={S.label}>Material (opțional)</label>
            <select value={f.material_id} onChange={e => setF({ ...f, material_id:e.target.value })} style={S.input}>
              <option value="">—</option>
              {materiale.map(m => <option key={m.id} value={m.id}>{m.denumire}</option>)}
            </select>
          </div>
          <div style={{ gridColumn:'1/3' }}><label style={S.label}>Note</label><input value={f.note} onChange={e => setF({ ...f, note:e.target.value })} style={S.input} /></div>
          <label style={{ ...S.btnS, textAlign:'center', cursor:'pointer', gridColumn:'1/3' }}>
            {file ? '📄 ' + file.name : '📎 Atașează fișierul (PDF/imagine)'}
            <input type="file" accept=".pdf,image/*" onChange={e => setFile(e.target.files?.[0] || null)} style={{ display:'none' }} />
          </label>
        </div>
        <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:16 }}>
          <button onClick={onClose} style={S.btnS}>Anulează</button>
          <button onClick={salveaza} disabled={busy} style={{ ...S.btnP, opacity: busy ? .6 : 1 }}>{busy ? '...' : 'Salvează'}</button>
        </div>
      </div>
    </div>
  )
}

// ─── Generator Declarație / Certificat de conformitate (pe lot finalizat) ───
function GenDocModal({ ctx, documente = [], onClose, onSaved, onError }) {
  const { lot, produs } = ctx
  const [f, setF] = useState({ beneficiar:'', obiect:'', nr_doc:'' })
  const [serii, setSerii] = useState([])
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    supabase.from('productie_serii').select('serie').eq('lot_id', lot.id).order('serie').then(({ data }) => setSerii((data || []).map(s => s.serie)))
  }, [lot.id])

  const agrement = produs.agrement_nr || documente.find(d => d.tip === 'agrement' && d.produs_id === produs.produs_id)?.denumire || null
  const certMat = documente.filter(d => d.tip === 'certificat_calitate')
  const numeProdus = `${produs.denumire} ${produs.dimensiune || ''} ${produs.clasa || ''}`.trim()

  const genereaza = async (tipDoc) => {
    const titlu = tipDoc === 'declaratie_conformitate' ? 'DECLARAȚIE DE CONFORMITATE' : 'CERTIFICAT DE CONFORMITATE'
    setBusy(true)
    try {
      const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      const azi = new Date().toLocaleDateString('ro-RO')
      const an = new Date().getFullYear()
      const nrDoc = f.nr_doc.trim() || `${tipDoc === 'declaratie_conformitate' ? 'DC' : 'CC'}-${lot.cod_lot || lot.id}-${an}`
      const html = `
        <div style="font-family:Arial,Helvetica,sans-serif;color:#111;padding:48px 56px;font-size:13.5px;line-height:1.6">
          <table style="width:100%;border-collapse:collapse"><tr>
            <td style="vertical-align:bottom">
              <div style="font-size:21px;font-weight:800;letter-spacing:.4px">GAZPET INSTAL S.R.L.</div>
              <div style="font-size:10.5px;color:#444;margin-top:3px">Str. Fluturilor nr. 34, Ploiești, Prahova &nbsp;·&nbsp; CUI RO 22029920 &nbsp;·&nbsp; J29/1650/2007<br/>office@gazpet.ro &nbsp;·&nbsp; tel/fax 0244/435005</div>
            </td>
            <td style="vertical-align:bottom;text-align:right;font-size:11px;color:#444">Ploiești, ${azi}</td>
          </tr></table>
          <div style="border-bottom:2.5px solid #111;margin:10px 0 30px"></div>
          <div style="text-align:center;font-size:17px;font-weight:800;letter-spacing:.6px;margin-bottom:4px">${titlu}</div>
          <div style="text-align:center;font-size:12px;color:#333;margin-bottom:28px">Nr. ${esc(nrDoc)} din ${azi}</div>
          <p style="text-align:justify;margin:0 0 16px">Subscrisa <b>GAZPET INSTAL S.R.L.</b>, cu sediul în Ploiești, str. Fluturilor nr. 34, jud. Prahova, CUI RO 22029920, în calitate de producător${tipDoc === 'declaratie_conformitate' ? ', declarăm pe propria răspundere că produsul' : ', certificăm că produsul'} descris mai jos este conform cu cerințele tehnice aplicabile și cu documentația tehnică de execuție${agrement ? `, fiind fabricat în baza <b>Agrementului tehnic ${esc(agrement)}</b> (partener de agrement: Adrom Evolution S.R.L.)` : ''}.</p>
          <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:18px">
            <tr><td style="padding:6px 10px;border:1px solid #999;background:#f2f2f2;width:200px;font-weight:700">Produs</td><td style="padding:6px 10px;border:1px solid #999">${esc(numeProdus)}</td></tr>
            <tr><td style="padding:6px 10px;border:1px solid #999;background:#f2f2f2;font-weight:700">Lot de fabricație</td><td style="padding:6px 10px;border:1px solid #999">${esc(lot.cod_lot || 'Lot #' + lot.id)} · finalizat ${fmtD(lot.data_finalizare)}</td></tr>
            <tr><td style="padding:6px 10px;border:1px solid #999;background:#f2f2f2;font-weight:700">Cantitate</td><td style="padding:6px 10px;border:1px solid #999">${fmt(lot.cantitate)} buc</td></tr>
            <tr><td style="padding:6px 10px;border:1px solid #999;background:#f2f2f2;font-weight:700">Serii unice</td><td style="padding:6px 10px;border:1px solid #999">${serii.length ? serii.map(esc).join('<br/>') : '—'}</td></tr>
            ${agrement ? `<tr><td style="padding:6px 10px;border:1px solid #999;background:#f2f2f2;font-weight:700">Agrement tehnic</td><td style="padding:6px 10px;border:1px solid #999">${esc(agrement)}</td></tr>` : ''}
            ${f.beneficiar.trim() ? `<tr><td style="padding:6px 10px;border:1px solid #999;background:#f2f2f2;font-weight:700">Beneficiar</td><td style="padding:6px 10px;border:1px solid #999">${esc(f.beneficiar.trim())}</td></tr>` : ''}
            ${f.obiect.trim() ? `<tr><td style="padding:6px 10px;border:1px solid #999;background:#f2f2f2;font-weight:700">Obiectiv / lucrare</td><td style="padding:6px 10px;border:1px solid #999">${esc(f.obiect.trim())}</td></tr>` : ''}
          </table>
          ${certMat.length ? `<p style="text-align:justify;margin:0 0 16px;font-size:12.5px">Materialele utilizate sunt însoțite de certificate de calitate: ${certMat.map(c => esc(c.denumire)).join('; ')}.</p>` : ''}
          <p style="text-align:justify;margin:0 0 16px">Produsul a fost verificat și corespunde din punct de vedere calitativ și dimensional. Prezentul document însoțește produsul la livrare.</p>
          <table style="width:100%;border-collapse:collapse;margin-top:46px"><tr>
            <td style="width:55%"></td>
            <td style="text-align:center">
              <div style="font-weight:800">GAZPET INSTAL S.R.L.</div>
              <div style="font-size:12px;margin-top:2px">Administrator</div>
              <div style="font-size:12px;font-weight:700;margin-top:2px">Trușu Răzvan</div>
            </td>
          </tr></table>
        </div>`
      const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([import('jspdf'), import('html2canvas')])
      const div = document.createElement('div')
      div.style.cssText = 'position:fixed;left:-10000px;top:0;width:794px;background:#fff'
      div.innerHTML = html
      document.body.appendChild(div)
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
      const canvas = await html2canvas(div, { scale: 2, backgroundColor: '#fff' })
      document.body.removeChild(div)
      const pdf = new jsPDF({ unit:'mm', format:'a4' })
      const imgH = canvas.height * 210 / canvas.width
      const pagini = Math.max(1, Math.ceil(imgH / 297))
      for (let i = 0; i < pagini; i++) {
        if (i > 0) pdf.addPage()
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, -i * 297, 210, imgH)
      }
      pdf.save(`${nrDoc.replace(/[^\w.-]+/g, '_')}.pdf`)
      // evidența documentelor emise
      const { data: { user } } = await supabase.auth.getUser()
      await supabase.from('productie_documente').insert({
        tip: tipDoc, denumire: nrDoc, produs_id: produs.produs_id, lot_id: lot.id,
        note: [f.beneficiar.trim(), f.obiect.trim()].filter(Boolean).join(' · ') || null, uploaded_by: user?.id || null,
      })
      setBusy(false)
      onSaved(`✓ ${titlu.charAt(0) + titlu.slice(1).toLowerCase()} generată (${nrDoc})`)
    } catch (e) { setBusy(false); onError('Eroare PDF: ' + (e?.message || e)) }
  }

  return (
    <div style={S.overlay}>
      <div style={{ ...S.modal, maxWidth:600 }}>
        <div style={{ fontSize:17, fontWeight:800, marginBottom:6 }}>📜 Declarație / Certificat de conformitate</div>
        <div style={{ fontSize:12.5, color:G.muted, marginBottom:14 }}>{numeProdus} · {lot.cod_lot || 'Lot #' + lot.id} · {fmt(lot.cantitate)} buc{serii.length ? ` · serii ${serii[0]}…${serii[serii.length - 1]}` : ''}</div>
        {!agrement && <div style={{ ...S.card, background:G.bg, padding:'8px 12px', marginBottom:12, fontSize:12.5, color:G.orange }}>⚠️ Produsul nu are agrement atașat — documentul se generează fără referință la agrement. Urcă agrementul în „📜 Agremente & certificate".</div>}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
          <div style={{ gridColumn:'1/3' }}><label style={S.label}>Beneficiar (opțional)</label><input value={f.beneficiar} onChange={e => setF({ ...f, beneficiar:e.target.value })} placeholder="ex: TRANSGAZ S.A." style={S.input} /></div>
          <div style={{ gridColumn:'1/3' }}><label style={S.label}>Obiectiv / lucrare (opțional)</label><input value={f.obiect} onChange={e => setF({ ...f, obiect:e.target.value })} style={S.input} /></div>
          <div style={{ gridColumn:'1/3' }}><label style={S.label}>Nr. document (gol = automat)</label><input value={f.nr_doc} onChange={e => setF({ ...f, nr_doc:e.target.value })} placeholder="ex: DC-FM8-2026-01" style={S.input} /></div>
        </div>
        <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:16, flexWrap:'wrap' }}>
          <button onClick={onClose} style={S.btnS}>Închide</button>
          <button onClick={() => genereaza('declaratie_conformitate')} disabled={busy} style={{ ...S.btnP, opacity: busy ? .6 : 1 }}>✍️ Declarație de conformitate</button>
          <button onClick={() => genereaza('certificat_conformitate')} disabled={busy} style={{ ...S.btnP, background:G.purple, color:'#1E0A3C', opacity: busy ? .6 : 1 }}>🏅 Certificat de conformitate</button>
        </div>
      </div>
    </div>
  )
}
