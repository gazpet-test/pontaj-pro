// ============================================================
// PiesePozeSection.jsx — Piese schimbate pe un activ: denumire, cod, SERIE + POZE
// (08.09.2026). Se afișează în Logistică → Service → 📜 Istoric Service (per activ).
//   - tabel logistica_piese_istoric (există din importurile xls) + coloana nouă `serie`
//   - poze în logistica_piese_poze → bucket documente-flota, cale activ-<id>/piese/<piesaId>-<ts>.jpg
//   - pozele se COMPRIMĂ în browser înainte de upload (max 1600px, JPEG 0.8) — ~200–300 KB/poză
//   - pozele vechi importate de pe serverul vechi au sursa='server_vechi'
// ============================================================
import { useState, useEffect, useCallback } from 'react'
import { supabase } from './lib/supabase.js'

const BUCKET = 'documente-flota'
const G = {
  bg:'#0D1117', surface:'#161B22', border:'#21262D', border2:'#30363D',
  text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  blue:'#58A6FF', green:'#3FB950', red:'#F85149', yellow:'#D29922', orange:'#F0883E',
  logistica:'#E3B341',
}
const S = {
  card: { background:G.surface, border:`1px solid ${G.border}`, borderRadius:12 },
  input: { background:G.bg, border:`1px solid ${G.border2}`, color:G.text, borderRadius:8, padding:'7px 10px', fontFamily:'inherit', fontSize:13, outline:'none', width:'100%' },
  btnP: { background:'#1F6FEB', color:'white', border:'none', borderRadius:8, padding:'8px 14px', fontFamily:'inherit', fontSize:13, fontWeight:700, cursor:'pointer' },
  btnS: { background:G.surface, color:G.text, border:`1px solid ${G.border}`, borderRadius:8, padding:'6px 12px', fontFamily:'inherit', fontSize:12, fontWeight:600, cursor:'pointer' },
}
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('ro-RO', { day:'2-digit', month:'2-digit', year:'numeric' }) : '—'

// Comprimă o imagine în browser: max 1600px pe latura mare, JPEG 0.8. Întoarce Blob.
async function compressImage(file, maxSide = 1600, quality = 0.8) {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url })
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height))
    const w = Math.round(img.width * scale), h = Math.round(img.height * scale)
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h
    canvas.getContext('2d').drawImage(img, 0, 0, w, h)
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', quality))
    return blob || file
  } catch { return file } finally { URL.revokeObjectURL(url) }
}

export default function PiesePozeSection({ activ, canEdit, showToast }) {
  const [piese, setPiese] = useState([])
  const [poze, setPoze] = useState({})       // piesa_id → [ {id, storage_path, url} ]
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(null)     // piesa_id în upload
  const [adding, setAdding] = useState(false)
  const [nou, setNou] = useState({ denumire:'', cod_piesa:'', serie:'', data_service: new Date().toISOString().slice(0,10), cantitate:1 })
  const [editSerie, setEditSerie] = useState({})  // piesa_id → text
  const [lightbox, setLightbox] = useState(null)

  const load = useCallback(async () => {
    if (!activ?.id) return
    setLoading(true)
    const [{ data: p, error: e1 }, { data: f, error: e2 }] = await Promise.all([
      supabase.from('logistica_piese_istoric').select('id, denumire, cod_piesa, serie, cantitate, data_service, km_service, locatie_service, observatii, sursa_import').eq('active_id', activ.id).order('data_service', { ascending:false, nullsFirst:false }).order('id', { ascending:false }),
      supabase.from('logistica_piese_poze').select('id, piesa_id, storage_path, sursa, created_at').eq('active_id', activ.id).order('id'),
    ])
    if (e1 || e2) showToast?.(`Eroare piese: ${(e1 || e2).message}`, 'error')
    setPiese(p || [])
    const paths = (f || []).map(x => x.storage_path)
    let urlMap = {}
    if (paths.length) {
      const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 3600)
      ;(signed || []).forEach(s => { if (s?.signedUrl) urlMap[s.path] = s.signedUrl })
    }
    const byPiesa = {}
    ;(f || []).forEach(x => { (byPiesa[x.piesa_id] ||= []).push({ ...x, url: urlMap[x.storage_path] }) })
    setPoze(byPiesa)
    setLoading(false)
  }, [activ?.id])  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])

  const uploadPoze = async (piesaId, files) => {
    if (!files?.length) return
    setBusy(piesaId)
    let ok = 0
    for (const file of Array.from(files)) {
      try {
        const blob = await compressImage(file)
        const path = `activ-${activ.id}/piese/${piesaId}-${Date.now()}-${Math.random().toString(36).slice(2,6)}.jpg`
        const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType:'image/jpeg', upsert:false })
        if (upErr) throw upErr
        const { data: { user } } = await supabase.auth.getUser()
        const { error: insErr } = await supabase.from('logistica_piese_poze').insert({ piesa_id: piesaId, active_id: activ.id, storage_path: path, mime:'image/jpeg', size_bytes: blob.size, sursa:'manual', created_by: user?.id || null })
        if (insErr) throw insErr
        ok++
      } catch (e) { showToast?.(`Poza nu s-a urcat: ${e.message}`, 'error') }
    }
    setBusy(null)
    if (ok) { showToast?.(`${ok} ${ok === 1 ? 'poză urcată' : 'poze urcate'}`, 'success'); load() }
  }

  const stergePoza = async (p) => {
    if (!window.confirm('Ștergi poza?')) return
    await supabase.storage.from(BUCKET).remove([p.storage_path])
    const { error } = await supabase.from('logistica_piese_poze').delete().eq('id', p.id)
    if (error) showToast?.(error.message, 'error'); else load()
  }

  const salveazaSerie = async (piesaId) => {
    const v = (editSerie[piesaId] ?? '').trim()
    const { error } = await supabase.from('logistica_piese_istoric').update({ serie: v || null }).eq('id', piesaId)
    if (error) return showToast?.(error.message, 'error')
    setEditSerie(s => { const c = { ...s }; delete c[piesaId]; return c })
    load()
  }

  const adaugaPiesa = async () => {
    if (!nou.denumire.trim()) return showToast?.('Scrie denumirea piesei', 'error')
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase.from('logistica_piese_istoric').insert({
      active_id: activ.id, denumire: nou.denumire.trim(), cod_piesa: nou.cod_piesa.trim() || null, serie: nou.serie.trim() || null,
      data_service: nou.data_service || null, cantitate: Number(nou.cantitate) || 1, sursa_import:'manual', created_by: user?.id || null,
    })
    if (error) return showToast?.(error.message, 'error')
    setNou({ denumire:'', cod_piesa:'', serie:'', data_service: new Date().toISOString().slice(0,10), cantitate:1 })
    setAdding(false); load()
  }

  const stergePiesa = async (p) => {
    const n = (poze[p.id] || []).length
    if (!window.confirm(`Ștergi piesa „${p.denumire}"${n ? ` și cele ${n} poze` : ''}?`)) return
    if (n) await supabase.storage.from(BUCKET).remove(poze[p.id].map(x => x.storage_path))
    const { error } = await supabase.from('logistica_piese_istoric').delete().eq('id', p.id)
    if (error) showToast?.(error.message, 'error'); else load()
  }

  const totalPoze = Object.values(poze).reduce((s, a) => s + a.length, 0)

  return (
    <div style={{ marginTop:18 }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
        <div style={{ fontSize:11, color:G.logistica, fontWeight:700, textTransform:'uppercase', letterSpacing:'.6px' }}>
          🔩 Piese schimbate ({piese.length}) · 📷 {totalPoze} poze
        </div>
        {canEdit && !adding && <button onClick={() => setAdding(true)} style={S.btnS}>+ Piesă</button>}
      </div>

      {adding && (
        <div style={{ ...S.card, padding:12, marginBottom:10, borderLeft:`3px solid ${G.logistica}` }}>
          <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr 1fr 110px 60px', gap:8, marginBottom:8 }}>
            <input style={S.input} placeholder="Denumire piesă *" value={nou.denumire} onChange={e => setNou({ ...nou, denumire:e.target.value })} autoFocus />
            <input style={S.input} placeholder="Cod piesă" value={nou.cod_piesa} onChange={e => setNou({ ...nou, cod_piesa:e.target.value })} />
            <input style={S.input} placeholder="Serie" value={nou.serie} onChange={e => setNou({ ...nou, serie:e.target.value })} />
            <input style={S.input} type="date" value={nou.data_service} onChange={e => setNou({ ...nou, data_service:e.target.value })} />
            <input style={S.input} type="number" min="1" value={nou.cantitate} onChange={e => setNou({ ...nou, cantitate:e.target.value })} />
          </div>
          <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
            <button onClick={() => setAdding(false)} style={S.btnS}>Renunță</button>
            <button onClick={adaugaPiesa} style={S.btnP}>Salvează piesa</button>
          </div>
          <div style={{ fontSize:11, color:G.muted, marginTop:6 }}>După salvare apare butonul 📷 pe rând — pozele se comprimă automat (≈250 KB fiecare).</div>
        </div>
      )}

      {loading ? (
        <div style={{ padding:20, textAlign:'center', color:G.muted }}>⏳ Se încarcă piesele...</div>
      ) : piese.length === 0 ? (
        <div style={{ padding:20, textAlign:'center', color:G.muted, ...S.card }}>Nicio piesă înregistrată pe acest activ.</div>
      ) : (
        <div style={{ ...S.card, overflow:'hidden', maxHeight:'45vh', overflowY:'auto' }}>
          {piese.map(p => {
            const pz = poze[p.id] || []
            const editing = p.id in editSerie
            return (
              <div key={p.id} style={{ padding:'10px 12px', borderBottom:`1px solid ${G.border}` }}>
                <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
                  <div style={{ width:80, fontSize:12, color:G.text, fontVariantNumeric:'tabular-nums' }}>{fmtDate(p.data_service)}</div>
                  <div style={{ flex:1, minWidth:180 }}>
                    <div style={{ fontWeight:600, fontSize:13, color:G.text }}>{p.denumire}{p.cantitate > 1 ? <span style={{ color:G.muted, fontWeight:400 }}> × {p.cantitate}</span> : null}</div>
                    <div style={{ fontSize:11, color:G.muted }}>
                      {p.cod_piesa && <span style={{ fontFamily:'monospace', marginRight:8 }}>cod {p.cod_piesa}</span>}
                      {p.km_service ? <span style={{ marginRight:8 }}>{Number(p.km_service).toLocaleString('ro-RO')} km</span> : null}
                      {p.locatie_service && <span style={{ marginRight:8 }}>📍 {p.locatie_service}</span>}
                      {p.sursa_import === 'poze_server_vechi' && <span style={{ color:G.dim }}>· arhivă server vechi</span>}
                    </div>
                  </div>
                  <div style={{ width:210, display:'flex', alignItems:'center', gap:6 }}>
                    <span style={{ fontSize:10, color:G.muted, textTransform:'uppercase' }}>Serie</span>
                    {editing ? (
                      <>
                        <input style={{ ...S.input, padding:'4px 8px', fontSize:12, fontFamily:'monospace' }} value={editSerie[p.id]} onChange={e => setEditSerie({ ...editSerie, [p.id]: e.target.value })}
                               onKeyDown={e => { if (e.key === 'Enter') salveazaSerie(p.id); if (e.key === 'Escape') setEditSerie(s => { const c = { ...s }; delete c[p.id]; return c }) }} autoFocus />
                        <button onClick={() => salveazaSerie(p.id)} style={{ ...S.btnS, padding:'4px 8px', color:G.green }}>✓</button>
                      </>
                    ) : (
                      <span onClick={() => canEdit && setEditSerie({ ...editSerie, [p.id]: p.serie || '' })} title={canEdit ? 'Click pentru editare' : ''}
                            style={{ fontFamily:'monospace', fontSize:12, color: p.serie ? G.text : G.dim, cursor: canEdit ? 'text' : 'default', borderBottom: canEdit ? `1px dashed ${G.border2}` : 'none' }}>
                        {p.serie || '—'}
                      </span>
                    )}
                  </div>
                  <div style={{ display:'flex', gap:4 }}>
                    {canEdit && (
                      <label style={{ ...S.btnS, padding:'4px 9px', cursor: busy === p.id ? 'wait' : 'pointer' }} title="Adaugă poze">
                        {busy === p.id ? '⏳' : '📷'}
                        <input type="file" accept="image/*" multiple capture="environment" style={{ display:'none' }} disabled={busy === p.id}
                               onChange={e => { uploadPoze(p.id, e.target.files); e.target.value = '' }} />
                      </label>
                    )}
                    {canEdit && <button onClick={() => stergePiesa(p)} style={{ ...S.btnS, padding:'4px 9px', color:G.red }} title="Șterge piesa">🗑</button>}
                  </div>
                </div>
                {pz.length > 0 && (
                  <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginTop:8, paddingLeft:90 }}>
                    {pz.map(x => (
                      <div key={x.id} style={{ position:'relative' }}>
                        <img src={x.url} alt="" loading="lazy" onClick={() => setLightbox(x)}
                             style={{ width:72, height:72, objectFit:'cover', borderRadius:6, border:`1px solid ${G.border2}`, cursor:'zoom-in', background:G.bg }} />
                        {canEdit && <button onClick={() => stergePoza(x)} title="Șterge poza"
                                 style={{ position:'absolute', top:-6, right:-6, width:18, height:18, borderRadius:9, border:'none', background:G.red, color:'white', fontSize:11, cursor:'pointer', lineHeight:'18px', padding:0 }}>×</button>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {lightbox && (
        <div onClick={() => setLightbox(null)} style={{ position:'fixed', inset:0, background:'#000000e6', zIndex:400, display:'flex', alignItems:'center', justifyContent:'center', padding:20, cursor:'zoom-out' }}>
          <img src={lightbox.url} alt="" style={{ maxWidth:'95vw', maxHeight:'92vh', borderRadius:8, boxShadow:'0 20px 80px rgba(0,0,0,.8)' }} />
          <a href={lightbox.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
             style={{ position:'absolute', bottom:16, right:20, ...S.btnS }}>↗ Deschide</a>
        </div>
      )}
    </div>
  )
}
