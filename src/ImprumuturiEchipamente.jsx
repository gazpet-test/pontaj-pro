// ===========================================================================
// LOGISTICĂ — „Împrumutat / Închiriat" (TKT-2026-0127, 28.09.2026)
// Echipament dat unui angajat sau unei firme externe, cu poze la plecare și la retur
// (starea în care a plecat vs. cum s-a întors). Tabel logistica_imprumuturi; pozele în
// bucket-ul documente-flota, sub imprumuturi/<activ>/. Un activ are cel mult un împrumut deschis.
// ===========================================================================
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase.js'

const G = {
  bg:'#0D1117', surface:'#161B22', card:'#161B22', text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  border:'#30363D', blue:'#58A6FF', green:'#3FB950', yellow:'#D29922', orange:'#F0883E', red:'#F85149',
}
const S = {
  card: { background:G.card, borderRadius:12, border:`1px solid ${G.border}`, padding:14 },
  input: { width:'100%', background:G.bg, border:`1px solid ${G.border}`, borderRadius:8, padding:'8px 10px', color:G.text, fontSize:13, boxSizing:'border-box' },
  btnP: { padding:'8px 14px', background:G.orange, color:'#0D1117', border:'none', borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:700 },
  btnS: { padding:'7px 12px', background:G.surface, color:G.text, border:`1px solid ${G.border}`, borderRadius:8, cursor:'pointer', fontSize:13 },
}
const lbl = { fontSize:11, color:G.muted, fontWeight:700, marginBottom:4, display:'block' }
const BUCKET = 'documente-flota'
const isoAzi = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) }
const fmt = d => d ? new Date(d).toLocaleDateString('ro-RO') : '—'
const numeActiv = a => a ? [a.cod_intern, a.marca, a.model, a.nr_inmatriculare].filter(Boolean).join(' · ') : '—'

async function comprima(file, maxSide = 1600) {
  if (!file.type.startsWith('image/')) return file
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url })
    const k = Math.min(1, maxSide / Math.max(img.width, img.height))
    const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k)
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
    return (await new Promise(r => c.toBlob(r, 'image/jpeg', 0.8))) || file
  } catch { return file } finally { URL.revokeObjectURL(url) }
}
async function urcaPoze(files, activId, etapa) {
  const paths = []
  for (const f of files) {
    const blob = await comprima(f)
    const p = `imprumuturi/${activId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${etapa}.jpg`
    const { error } = await supabase.storage.from(BUCKET).upload(p, blob, { contentType:'image/jpeg', upsert:false })
    if (error) throw error
    paths.push(p)
  }
  return paths
}

const GOL = { active_id:'', tip:'imprumut', catre_tip:'angajat', employee_id:'', partener_text:'', data_plecare:'', data_retur_estimata:'', stare_plecare:'', pret:'', observatii:'' }

export default function ImprumuturiEchipamente({ active = [], canEdit, showToast }) {
  const [rows, setRows] = useState([])
  const [angajati, setAngajati] = useState([])
  const [loading, setLoading] = useState(true)
  const [arata, setArata] = useState('deschise')
  const [form, setForm] = useState(null)
  const [pozeNoi, setPozeNoi] = useState([])
  const [retur, setRetur] = useState(null)   // { row, data_retur, stare_retur, files }
  const [busy, setBusy] = useState(false)
  const [urls, setUrls] = useState({})

  const incarca = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase.from('logistica_imprumuturi').select('*').order('data_plecare', { ascending:false }).limit(2000)
    if (error) showToast?.('Eroare: ' + error.message, 'error')
    setRows(data || []); setLoading(false)
    const paths = (data || []).flatMap(r => [...r.poze_plecare, ...r.poze_retur])
    if (paths.length) {
      const { data: s } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 3600)
      setUrls(Object.fromEntries((s || []).map(x => [x.path, x.signedUrl])))
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- fără showToast (anti-bug)
  useEffect(() => { incarca() }, [incarca])
  useEffect(() => {
    supabase.from('employees').select('id, name').eq('active', true).order('name').then(({ data }) => setAngajati(data || []))
  }, [])

  const activDupaId = useMemo(() => Object.fromEntries(active.map(a => [a.id, a])), [active])
  const numeAng = useMemo(() => Object.fromEntries(angajati.map(e => [e.id, e.name])), [angajati])
  const deschiseIds = useMemo(() => new Set(rows.filter(r => !r.data_retur).map(r => r.active_id)), [rows])
  const vizibile = rows.filter(r => arata === 'toate' || !r.data_retur)

  const salveazaPlecare = async () => {
    const f = form
    if (!f.active_id) return showToast?.('Alege echipamentul', 'error')
    if (f.catre_tip === 'angajat' && !f.employee_id) return showToast?.('Alege angajatul', 'error')
    if (f.catre_tip === 'extern' && !f.partener_text.trim()) return showToast?.('Completează firma / persoana externă', 'error')
    if (!pozeNoi.length) return showToast?.('Adaugă cel puțin o poză la plecare', 'error')
    setBusy(true)
    try {
      const poze = await urcaPoze(pozeNoi, f.active_id, 'plecare')
      const { error } = await supabase.from('logistica_imprumuturi').insert({
        active_id:Number(f.active_id), tip:f.tip, catre_tip:f.catre_tip,
        employee_id:f.catre_tip === 'angajat' ? Number(f.employee_id) : null,
        partener_text:f.catre_tip === 'extern' ? f.partener_text.trim() : null,
        data_plecare:f.data_plecare || isoAzi(), data_retur_estimata:f.data_retur_estimata || null,
        stare_plecare:f.stare_plecare.trim() || null, pret:f.pret === '' ? null : Number(f.pret),
        observatii:f.observatii.trim() || null, poze_plecare:poze,
      })
      if (error) throw error.code === '23505' ? new Error('Echipamentul are deja un împrumut deschis') : error
      showToast?.('✅ Împrumut înregistrat', 'success'); setForm(null); setPozeNoi([]); incarca()
    } catch (e) { showToast?.('Eroare: ' + (e.message || e), 'error') } finally { setBusy(false) }
  }

  const salveazaRetur = async () => {
    const r = retur
    if (!r.files.length) return showToast?.('Adaugă cel puțin o poză la retur', 'error')
    if ((r.data_retur || isoAzi()) < r.row.data_plecare) return showToast?.('Data returului e înaintea plecării', 'error')
    setBusy(true)
    try {
      const poze = await urcaPoze(r.files, r.row.active_id, 'retur')
      const { error } = await supabase.from('logistica_imprumuturi').update({
        data_retur:r.data_retur || isoAzi(), stare_retur:r.stare_retur.trim() || null, poze_retur:poze,
      }).eq('id', r.row.id).is('data_retur', null)
      if (error) throw error
      showToast?.('✅ Retur înregistrat', 'success'); setRetur(null); incarca()
    } catch (e) { showToast?.('Eroare: ' + (e.message || e), 'error') } finally { setBusy(false) }
  }

  const Poze = ({ paths }) => (
    <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginTop:4 }}>
      {paths.map(p => urls[p] ? <a key={p} href={urls[p]} target="_blank" rel="noreferrer"><img src={urls[p]} alt="" style={{ width:64, height:64, objectFit:'cover', borderRadius:6, border:`1px solid ${G.border}` }} /></a> : null)}
    </div>
  )

  return (
    <div>
      <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:12, flexWrap:'wrap' }}>
        <div style={{ fontSize:15, fontWeight:800, color:G.orange, flex:1 }}>🤝 Echipamente împrumutate / închiriate</div>
        {['deschise', 'toate'].map(k => <button key={k} onClick={() => setArata(k)} style={{ ...S.btnS, borderColor: arata === k ? G.orange : G.border, color: arata === k ? G.orange : G.text }}>{k === 'deschise' ? `Afară acum (${deschiseIds.size})` : 'Istoric complet'}</button>)}
        {canEdit && !form && <button style={S.btnP} onClick={() => { setForm({ ...GOL, data_plecare:isoAzi() }); setPozeNoi([]) }}>➕ Dă un echipament</button>}
      </div>

      {form && (
        <div style={{ ...S.card, marginBottom:12, borderColor:G.orange + '66' }}>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(200px, 1fr))', gap:10 }}>
            <div style={{ gridColumn:'span 2' }}><label style={lbl}>Echipament *</label>
              <select style={S.input} value={form.active_id} onChange={e => setForm(f => ({ ...f, active_id:e.target.value }))}>
                <option value="">— alege —</option>
                {active.filter(a => !deschiseIds.has(a.id)).map(a => <option key={a.id} value={a.id}>{numeActiv(a)}</option>)}
              </select></div>
            <div><label style={lbl}>Tip</label>
              <select style={S.input} value={form.tip} onChange={e => setForm(f => ({ ...f, tip:e.target.value }))}><option value="imprumut">Împrumut</option><option value="inchiriere">Închiriere</option></select></div>
            <div><label style={lbl}>Către</label>
              <select style={S.input} value={form.catre_tip} onChange={e => setForm(f => ({ ...f, catre_tip:e.target.value }))}><option value="angajat">Angajat Gazpet</option><option value="extern">Firmă / persoană externă</option></select></div>
            {form.catre_tip === 'angajat'
              ? <div><label style={lbl}>Angajat *</label><select style={S.input} value={form.employee_id} onChange={e => setForm(f => ({ ...f, employee_id:e.target.value }))}><option value="">— alege —</option>{angajati.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></div>
              : <div><label style={lbl}>Firmă / persoană *</label><input style={S.input} value={form.partener_text} onChange={e => setForm(f => ({ ...f, partener_text:e.target.value }))} /></div>}
            <div><label style={lbl}>Data plecării</label><input type="date" style={S.input} value={form.data_plecare} onChange={e => setForm(f => ({ ...f, data_plecare:e.target.value }))} /></div>
            <div><label style={lbl}>Retur estimat</label><input type="date" style={S.input} value={form.data_retur_estimata} onChange={e => setForm(f => ({ ...f, data_retur_estimata:e.target.value }))} /></div>
            {form.tip === 'inchiriere' && <div><label style={lbl}>Preț (lei)</label><input style={S.input} inputMode="decimal" value={form.pret} onChange={e => setForm(f => ({ ...f, pret:e.target.value }))} /></div>}
            <div style={{ gridColumn:'1 / -1' }}><label style={lbl}>Starea la plecare</label><input style={S.input} value={form.stare_plecare} onChange={e => setForm(f => ({ ...f, stare_plecare:e.target.value }))} placeholder="ex. funcțional, zgârietură pe capotă" /></div>
            <div style={{ gridColumn:'1 / -1' }}><label style={lbl}>Poze la plecare * ({pozeNoi.length})</label><input type="file" accept="image/*" multiple capture="environment" onChange={e => setPozeNoi([...e.target.files])} /></div>
            <div style={{ gridColumn:'1 / -1' }}><label style={lbl}>Observații</label><input style={S.input} value={form.observatii} onChange={e => setForm(f => ({ ...f, observatii:e.target.value }))} /></div>
          </div>
          <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:10 }}>
            <button style={S.btnS} disabled={busy} onClick={() => setForm(null)}>Renunță</button>
            <button style={{ ...S.btnP, opacity:busy ? .6 : 1 }} disabled={busy} onClick={salveazaPlecare}>{busy ? '⏳ Se urcă pozele…' : '💾 Înregistrează plecarea'}</button>
          </div>
        </div>
      )}

      {loading ? <div style={{ color:G.muted, padding:20 }}>⏳ Se încarcă…</div> : vizibile.length === 0
        ? <div style={{ ...S.card, color:G.muted, textAlign:'center' }}>{arata === 'deschise' ? 'Niciun echipament dat în acest moment.' : 'Niciun împrumut înregistrat.'}</div>
        : vizibile.map(r => {
          const intarziat = !r.data_retur && r.data_retur_estimata && r.data_retur_estimata < isoAzi()
          return (
            <div key={r.id} style={{ ...S.card, marginBottom:8, borderColor: intarziat ? G.red + '88' : G.border }}>
              <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'baseline' }}>
                <strong>{numeActiv(activDupaId[r.active_id])}</strong>
                <span style={{ fontSize:12, color:G.muted }}>{r.tip === 'inchiriere' ? 'închiriat' : 'împrumutat'} către <strong style={{ color:G.text }}>{r.catre_tip === 'angajat' ? (numeAng[r.employee_id] || 'angajat #' + r.employee_id) : r.partener_text}</strong>{r.pret ? ` · ${r.pret} lei` : ''}</span>
                <span style={{ fontSize:12, color: r.data_retur ? G.green : intarziat ? G.red : G.yellow, marginLeft:'auto' }}>
                  {fmt(r.data_plecare)} → {r.data_retur ? `returnat ${fmt(r.data_retur)}` : `afară${r.data_retur_estimata ? ` (retur estimat ${fmt(r.data_retur_estimata)}${intarziat ? ' — ÎNTÂRZIAT' : ''})` : ''}`}
                </span>
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginTop:8 }}>
                <div><div style={{ fontSize:11, color:G.muted, fontWeight:700 }}>LA PLECARE</div><div style={{ fontSize:12 }}>{r.stare_plecare || '—'}</div><Poze paths={r.poze_plecare} /></div>
                <div><div style={{ fontSize:11, color:G.muted, fontWeight:700 }}>LA RETUR</div>
                  {r.data_retur ? <><div style={{ fontSize:12 }}>{r.stare_retur || '—'}</div><Poze paths={r.poze_retur} /></>
                    : canEdit && (retur?.row.id === r.id ? (
                      <div style={{ display:'grid', gap:6 }}>
                        <input type="date" style={S.input} value={retur.data_retur} onChange={e => setRetur(x => ({ ...x, data_retur:e.target.value }))} />
                        <input style={S.input} placeholder="Starea la retur" value={retur.stare_retur} onChange={e => setRetur(x => ({ ...x, stare_retur:e.target.value }))} />
                        <input type="file" accept="image/*" multiple capture="environment" onChange={e => { const fl = [...e.target.files]; setRetur(x => ({ ...x, files:fl })) }} />
                        <div style={{ display:'flex', gap:6 }}><button style={S.btnS} onClick={() => setRetur(null)}>Renunță</button><button style={S.btnP} disabled={busy} onClick={salveazaRetur}>{busy ? '⏳' : '✅ Confirmă returul'}</button></div>
                      </div>
                    ) : <button style={{ ...S.btnS, marginTop:4 }} onClick={() => setRetur({ row:r, data_retur:isoAzi(), stare_retur:'', files:[] })}>↩ Înregistrează returul</button>)}
                </div>
              </div>
              {r.observatii && <div style={{ fontSize:11, color:G.muted, marginTop:6 }}>{r.observatii}</div>}
            </div>
          )
        })}
    </div>
  )
}
