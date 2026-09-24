// OfertareParteneri.jsx — tab „🤝 Parteneri” din Referințe financiare (24.09.2026, audit UI Ofertare #1)
// Adăugare/editare parteneri (ofertare_parteneri) + documentele lor (ofertare_parteneri_documente,
// fișiere în bucket 'ofertare' la parteneri/<id>/...). Orice scriere verifică error ȘI rândurile întoarse.
import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase.js'

const G = {
  bg:'#0D1117', surface:'#161B22', card:'#1C2128', border:'#30363D', border2:'#21262D',
  text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  ofertare:'#3FB6E2', green:'#3FB950', blue:'#58A6FF', orange:'#F0883E',
  yellow:'#E3B341', red:'#F85149', purple:'#A371F7', teal:'#2DD4BF',
}
const S = {
  input: { width:'100%', boxSizing:'border-box', background:G.bg, border:`1px solid ${G.border2}`, borderRadius:6, padding:'8px 12px', color:G.text, fontSize:13, outline:'none' },
  lbl: { display:'block', fontSize:11, color:G.muted, marginBottom:4, fontWeight:600, textTransform:'uppercase', letterSpacing:'.3px' },
  btnP: { padding:'9px 18px', background:G.ofertare, color:'#0D1117', border:'none', borderRadius:7, cursor:'pointer', fontSize:13, fontWeight:700 },
  btnS: { padding:'9px 18px', background:G.surface, color:G.text, border:`1px solid ${G.border2}`, borderRadius:7, cursor:'pointer', fontSize:13 },
  btnX: { padding:'3px 9px', background:'transparent', color:G.muted, border:`1px solid ${G.border2}`, borderRadius:6, cursor:'pointer', fontSize:11.5 },
  card: { background:G.card, border:`1px solid ${G.border}`, borderRadius:10 },
}

export const TIP_RELATIE = {
  subcontractant:    { label:'🔧 subcontractant',    color:G.ofertare },
  furnizor_servicii: { label:'📦 furnizor servicii', color:G.blue },
  laborator:         { label:'🧪 laborator',         color:G.purple },
  asociat:           { label:'🤝 asociat',           color:G.teal },
}
export const CATEGORII_DOC = {
  autorizatie_isc:  '🏛 Autorizație ISC',
  iso:              '📐 Certificat ISO',
  certificat_legal: '📄 Certificat legal',
  atestat:          '🎓 Atestat',
  etalonare:        '⚖️ Etalonare',
  alta:             '📎 Altă',
}

// Badge de valabilitate: expirat (roșu) / ≤30 zile (portocaliu) / ok (verde) / fără expirare
export function badgeValabilitate(d) {
  if (d.fara_expirare) return { txt:'♾ fără expirare', color:G.teal }
  if (!d.data_valabilitate) return { txt:'? valabilitate necunoscută', color:G.dim }
  const zile = Math.floor((new Date(d.data_valabilitate + 'T00:00:00') - new Date(new Date().toDateString())) / 86400000)
  if (zile < 0) return { txt:`⛔ expirat ${d.data_valabilitate}`, color:G.red }
  if (zile <= 30) return { txt:`⚠️ expiră în ${zile} zile`, color:G.orange }
  return { txt:`✅ valabil până ${d.data_valabilitate}`, color:G.green }
}

const sanitize = n => String(n || 'fisier').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_').slice(-120)
const nul = v => (v === '' || v === undefined) ? null : v

export default function OfertareParteneri({ parteneri, showToast, onChange }) {
  const [cauta, setCauta] = useState('')
  const [edit, setEdit] = useState(null)   // null | {} (nou) | partener
  const [deschis, setDeschis] = useState({}) // partener_id -> true
  const [docs, setDocs] = useState({})       // partener_id -> [] documente
  const [nrDocs, setNrDocs] = useState(null) // partener_id -> număr (încărcat o dată)

  // numărul de documente per partener, pentru „📎 Documente (N)”
  const incarcaNr = async () => {
    const { data, error } = await supabase.from('ofertare_parteneri_documente').select('partener_id').limit(10000)
    if (error) { setNrDocs({}); return }
    const m = {}; (data || []).forEach(r => { m[r.partener_id] = (m[r.partener_id] || 0) + 1 }); setNrDocs(m)
  }
  useEffect(() => { incarcaNr() }, [])

  const incarcaDocs = async (pid) => {
    const { data, error } = await supabase.from('ofertare_parteneri_documente').select('*').eq('partener_id', pid)
      .order('categorie').order('data_valabilitate', { ascending:true, nullsFirst:false })
    if (error) { showToast?.('Eroare la documente: ' + error.message, 'error'); return }
    setDocs(d => ({ ...d, [pid]: data || [] }))
    setNrDocs(m => ({ ...(m || {}), [pid]: (data || []).length }))
  }
  const toggle = (pid) => {
    const nou = !deschis[pid]
    setDeschis(d => ({ ...d, [pid]: nou }))
    if (nou && !docs[pid]) incarcaDocs(pid)
  }

  const q = cauta.toLowerCase()
  const lista = parteneri.filter(p => !q || `${p.nume} ${p.cui || ''} ${p.contact || ''} ${p.observatii || ''}`.toLowerCase().includes(q))

  return (
    <>
      <div style={{ display:'flex', gap:10, marginBottom:12, flexWrap:'wrap' }}>
        <input style={{ ...S.input, maxWidth:420 }} placeholder="🔍 Caută partener..." value={cauta} onChange={e => setCauta(e.target.value)} />
        <button style={S.btnP} onClick={() => setEdit({})}>+ Partener nou</button>
      </div>
      {edit && !edit.id && <FormPartener p={edit} showToast={showToast} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); onChange?.() }} />}
      <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
        {lista.map(p => {
          const tr = TIP_RELATIE[p.tip_relatie] || { label: p.tip_relatie || '—', color:G.muted }
          if (edit?.id === p.id) return <FormPartener key={p.id} p={edit} showToast={showToast} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); onChange?.() }} />
          return (
            <div key={p.id} style={{ ...S.card, padding:'12px 16px', borderLeft:`3px solid ${tr.color}`, opacity: (p.abandonat || p.activ === false) ? 0.5 : 1 }}>
              <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
                <span style={{ fontWeight:800, fontSize:13.5 }}>{p.nume}</span>
                <span style={{ fontSize:10.5, fontWeight:700, color:G.muted, border:`1px solid ${G.border}`, borderRadius:10, padding:'1px 8px' }}>{tr.label}</span>
                {p.activ === false && <span style={{ fontSize:10.5, color:G.dim, fontWeight:700 }}>⏸ inactiv</span>}
                {p.abandonat && <span style={{ fontSize:10.5, color:G.red, fontWeight:700 }}>⛔ abandonat{p.abandonat_motiv ? ` — ${p.abandonat_motiv}` : ''}</span>}
                {p.cui && <span style={{ fontSize:11, color:G.dim }}>{p.cui}</span>}
                {p.contact && <span style={{ fontSize:11, color:G.dim }}>{p.contact}</span>}
                <span style={{ flex:1 }} />
                <button style={S.btnX} onClick={() => toggle(p.id)}>📎 Documente ({docs[p.id]?.length ?? nrDocs?.[p.id] ?? 0}) {deschis[p.id] ? '▴' : '▾'}</button>
                <button style={S.btnX} onClick={() => setEdit(p)}>✏️ Editează</button>
              </div>
              {p.observatii && <div style={{ fontSize:12, color:G.muted, marginTop:5 }}>{p.observatii}</div>}
              {deschis[p.id] && <DocumentePartener pid={p.id} docs={docs[p.id]} showToast={showToast} onChange={() => incarcaDocs(p.id)} />}
            </div>
          )
        })}
      </div>
      <div style={{ fontSize:11.5, color:G.dim, padding:'8px 4px' }}>
        Sursa: folderele de pe NAS din <code>Oferte\Calificare\autorizari firme</code> — documentele fiecăruia se caută în tabul 🗂 Documente NAS sau se încarcă aici, la 📎 Documente.
      </div>
    </>
  )
}

function FormPartener({ p, showToast, onClose, onSaved }) {
  const [f, setF] = useState({ nume:p.nume || '', cui:p.cui || '', contact:p.contact || '', tip_relatie:p.tip_relatie || 'subcontractant',
    observatii:p.observatii || '', activ:p.activ !== false, abandonat:!!p.abandonat, abandonat_motiv:p.abandonat_motiv || '' })
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const salveaza = async () => {
    if (!f.nume.trim()) { showToast?.('Numele e obligatoriu', 'error'); return }
    setBusy(true)
    const row = { nume:f.nume.trim(), cui:nul(f.cui.trim()), contact:nul(f.contact.trim()), tip_relatie:f.tip_relatie, observatii:nul(f.observatii.trim()),
      activ:f.activ, abandonat:f.abandonat, abandonat_motiv: f.abandonat ? nul(f.abandonat_motiv.trim()) : null }
    const { data, error } = p.id
      ? await supabase.from('ofertare_parteneri').update(row).eq('id', p.id).select('id')
      : await supabase.from('ofertare_parteneri').insert(row).select('id')
    setBusy(false)
    if (error) { showToast?.('Eroare: ' + error.message, 'error'); return }
    if (!data?.length) { showToast?.('Nu s-a salvat nimic (fără drept de scriere?)', 'error'); return }
    showToast?.(p.id ? 'Partener actualizat' : 'Partener adăugat', 'success'); onSaved()
  }
  return (
    <div style={{ ...S.card, padding:14, marginBottom:8, borderLeft:`3px solid ${G.ofertare}` }}>
      <div style={{ fontWeight:800, fontSize:13, marginBottom:10 }}>{p.id ? `✏️ ${p.nume}` : '+ Partener nou'}</div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(200px, 1fr))', gap:10 }}>
        <div><label style={S.lbl}>Nume *</label><input style={S.input} value={f.nume} onChange={e => set('nume', e.target.value)} /></div>
        <div><label style={S.lbl}>CUI</label><input style={S.input} value={f.cui} onChange={e => set('cui', e.target.value)} /></div>
        <div><label style={S.lbl}>Contact</label><input style={S.input} value={f.contact} onChange={e => set('contact', e.target.value)} /></div>
        <div><label style={S.lbl}>Tip relație</label>
          <select style={S.input} value={f.tip_relatie} onChange={e => set('tip_relatie', e.target.value)}>
            {Object.entries(TIP_RELATIE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            {f.tip_relatie && !TIP_RELATIE[f.tip_relatie] && <option value={f.tip_relatie}>{f.tip_relatie}</option>}
          </select></div>
      </div>
      <div style={{ marginTop:10 }}><label style={S.lbl}>Observații (ce acoperă)</label>
        <textarea style={{ ...S.input, minHeight:60, resize:'vertical' }} value={f.observatii} onChange={e => set('observatii', e.target.value)} /></div>
      <div style={{ display:'flex', gap:16, alignItems:'center', flexWrap:'wrap', marginTop:10, fontSize:12.5 }}>
        <label><input type="checkbox" checked={f.activ} onChange={e => set('activ', e.target.checked)} /> activ</label>
        <label><input type="checkbox" checked={f.abandonat} onChange={e => set('abandonat', e.target.checked)} /> abandonat</label>
        {f.abandonat && <input style={{ ...S.input, maxWidth:360 }} placeholder="Motiv abandon" value={f.abandonat_motiv} onChange={e => set('abandonat_motiv', e.target.value)} />}
      </div>
      <div style={{ display:'flex', gap:8, marginTop:12 }}>
        <button style={S.btnP} disabled={busy} onClick={salveaza}>{busy ? 'Se salvează…' : '💾 Salvează'}</button>
        <button style={S.btnS} onClick={onClose}>Renunță</button>
      </div>
    </div>
  )
}

function DocumentePartener({ pid, docs, showToast, onChange }) {
  const [edit, setEdit] = useState(null)
  const deschide = async (d) => {
    const { data, error } = await supabase.storage.from('ofertare').createSignedUrl(d.fisier_path, 600)
    if (error || !data?.signedUrl) { showToast?.('Nu pot deschide fișierul: ' + (error?.message || 'fără URL'), 'error'); return }
    window.open(data.signedUrl, '_blank')
  }
  const sterge = async (d) => {
    if (!window.confirm(`Ștergi documentul „${d.denumire}”?`)) return
    const { data, error } = await supabase.from('ofertare_parteneri_documente').delete().eq('id', d.id).select('id')
    if (error) { showToast?.('Eroare: ' + error.message, 'error'); return }
    if (!data?.length) { showToast?.('Nu s-a șters nimic (fără drept?)', 'error'); return }
    if (d.fisier_path) {
      const { error: eRm } = await supabase.storage.from('ofertare').remove([d.fisier_path])
      if (eRm) showToast?.('Document șters, dar fișierul a rămas în storage: ' + eRm.message, 'error')
      else showToast?.('Document șters', 'success')
    } else showToast?.('Document șters', 'success')
    onChange()
  }
  return (
    <div style={{ marginTop:10, paddingTop:10, borderTop:`1px dashed ${G.border}` }}>
      {!docs ? <div style={{ fontSize:12, color:G.muted }}>Se încarcă…</div> : (
        <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
          {!docs.length && <div style={{ fontSize:12, color:G.dim }}>Niciun document încărcat.</div>}
          {docs.map(d => {
            if (edit?.id === d.id) return <FormDocument key={d.id} pid={pid} d={edit} showToast={showToast} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); onChange() }} />
            const b = badgeValabilitate(d)
            return (
              <div key={d.id} style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', fontSize:12, background:G.surface, borderRadius:7, padding:'7px 10px' }}>
                <span style={{ color:G.muted, fontWeight:700 }}>{CATEGORII_DOC[d.categorie] || d.categorie}</span>
                <span style={{ fontWeight:700 }}>{d.denumire}</span>
                {d.numar_document && <span style={{ color:G.dim }}>nr. {d.numar_document}</span>}
                {d.emitent && <span style={{ color:G.dim }}>{d.emitent}</span>}
                {d.domeniu && <span style={{ color:G.muted }}>· {d.domeniu}</span>}
                <span style={{ color:b.color, fontWeight:700, fontSize:11 }}>{b.txt}</span>
                <span style={{ flex:1 }} />
                {d.fisier_path && <button style={S.btnX} onClick={() => deschide(d)}>📄 Deschide</button>}
                <button style={S.btnX} onClick={() => setEdit(d)}>✏️</button>
                <button style={{ ...S.btnX, color:G.red }} onClick={() => sterge(d)}>🗑</button>
              </div>
            )
          })}
          {edit && !edit.id ? <FormDocument pid={pid} d={edit} showToast={showToast} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); onChange() }} />
            : <div><button style={S.btnX} onClick={() => setEdit({})}>+ Adaugă document</button></div>}
        </div>
      )}
    </div>
  )
}

function FormDocument({ pid, d, showToast, onClose, onSaved }) {
  const [f, setF] = useState({ categorie:d.categorie || 'autorizatie_isc', denumire:d.denumire || '', numar_document:d.numar_document || '', emitent:d.emitent || '',
    data_emitere:d.data_emitere || '', data_valabilitate:d.data_valabilitate || '', fara_expirare:!!d.fara_expirare, domeniu:d.domeniu || '', observatii:d.observatii || '' })
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const salveaza = async () => {
    if (!f.denumire.trim()) { showToast?.('Denumirea e obligatorie', 'error'); return }
    if (file && !/^(application\/pdf|image\/)/.test(file.type)) { showToast?.('Doar PDF sau imagine', 'error'); return }
    setBusy(true)
    let fisier_path = d.fisier_path || null
    if (file) {
      const path = `parteneri/${pid}/${Date.now()}_${sanitize(file.name)}`
      const { error: eUp } = await supabase.storage.from('ofertare').upload(path, file, { contentType: file.type })
      if (eUp) { setBusy(false); showToast?.('Upload eșuat: ' + eUp.message, 'error'); return }
      fisier_path = path
    }
    const row = { partener_id:pid, categorie:f.categorie, denumire:f.denumire.trim(), numar_document:nul(f.numar_document.trim()), emitent:nul(f.emitent.trim()),
      data_emitere:nul(f.data_emitere), data_valabilitate: f.fara_expirare ? null : nul(f.data_valabilitate), fara_expirare:f.fara_expirare,
      domeniu:nul(f.domeniu.trim()), observatii:nul(f.observatii.trim()), fisier_path }
    const { data, error } = d.id
      ? await supabase.from('ofertare_parteneri_documente').update(row).eq('id', d.id).select('id')
      : await supabase.from('ofertare_parteneri_documente').insert(row).select('id')
    if (error || !data?.length) {
      // fișierul nou nu rămâne orfan dacă rândul nu s-a scris
      if (file && fisier_path) await supabase.storage.from('ofertare').remove([fisier_path])
      setBusy(false); showToast?.(error ? 'Eroare: ' + error.message : 'Nu s-a salvat nimic (fără drept de scriere?)', 'error'); return
    }
    // fișier înlocuit → îl scoatem pe cel vechi
    if (file && d.fisier_path && d.fisier_path !== fisier_path) {
      const { error: eRm } = await supabase.storage.from('ofertare').remove([d.fisier_path])
      if (eRm) showToast?.('Salvat, dar fișierul vechi a rămas în storage: ' + eRm.message, 'error')
    }
    setBusy(false); showToast?.(d.id ? 'Document actualizat' : 'Document adăugat', 'success'); onSaved()
  }
  return (
    <div style={{ background:G.bg, border:`1px solid ${G.border}`, borderRadius:8, padding:12 }}>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))', gap:10 }}>
        <div><label style={S.lbl}>Categorie</label>
          <select style={S.input} value={f.categorie} onChange={e => set('categorie', e.target.value)}>
            {Object.entries(CATEGORII_DOC).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></div>
        <div><label style={S.lbl}>Denumire *</label><input style={S.input} value={f.denumire} onChange={e => set('denumire', e.target.value)} /></div>
        <div><label style={S.lbl}>Nr. document</label><input style={S.input} value={f.numar_document} onChange={e => set('numar_document', e.target.value)} /></div>
        <div><label style={S.lbl}>Emitent</label><input style={S.input} value={f.emitent} onChange={e => set('emitent', e.target.value)} /></div>
        <div><label style={S.lbl}>Data emitere</label><input type="date" style={S.input} value={f.data_emitere} onChange={e => set('data_emitere', e.target.value)} /></div>
        <div><label style={S.lbl}>Valabil până la</label><input type="date" style={S.input} disabled={f.fara_expirare} value={f.fara_expirare ? '' : f.data_valabilitate} onChange={e => set('data_valabilitate', e.target.value)} />
          <label style={{ fontSize:11.5, color:G.muted }}><input type="checkbox" checked={f.fara_expirare} onChange={e => set('fara_expirare', e.target.checked)} /> fără expirare</label></div>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(240px, 1fr))', gap:10, marginTop:10 }}>
        <div><label style={S.lbl}>Domeniu</label><input style={S.input} placeholder="ex. DCVG, grad II, aderență" value={f.domeniu} onChange={e => set('domeniu', e.target.value)} /></div>
        <div><label style={S.lbl}>Observații</label><input style={S.input} value={f.observatii} onChange={e => set('observatii', e.target.value)} /></div>
        <div><label style={S.lbl}>Fișier (PDF / imagine){d.fisier_path ? ' — înlocuiește' : ''}</label>
          <input type="file" accept="application/pdf,image/*" style={{ fontSize:12, color:G.muted }} onChange={e => setFile(e.target.files?.[0] || null)} /></div>
      </div>
      <div style={{ display:'flex', gap:8, marginTop:10 }}>
        <button style={{ ...S.btnP, padding:'6px 14px', fontSize:12 }} disabled={busy} onClick={salveaza}>{busy ? 'Se salvează…' : '💾 Salvează'}</button>
        <button style={{ ...S.btnS, padding:'6px 14px', fontSize:12 }} onClick={onClose}>Renunță</button>
      </div>
    </div>
  )
}
