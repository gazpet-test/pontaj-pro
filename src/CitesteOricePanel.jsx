// ===========================================================================
// CITEȘTE ORICE — Panel (Faza 1: modul Execuție)
// ===========================================================================
// 01.07.2026 — AI Document Router
//   • Dropzone universal → upload în bucket ai-documente-inbox + INSERT în coadă
//   • Apel Edge Function „citeste-orice" (Claude Vision) → clasifică modul+tip,
//     extrage câmpuri, fuzzy-match proiect pentru Execuție
//   • Tab „De confirmat": card per document cu preview + corecție proiect/tip +
//     buton Confirmă → INSERT în executie_documente_contract (ZERO auto-insert)
//   • Upload contextual: dacă primește proiectContextId, documentul e pre-legat
// Faza 1 acoperă confirmarea DOAR pentru Execuție. Documentele clasificate ca
// hr/logistică/financiar rămân în coadă pentru modulele lor (Faza 2).
// ===========================================================================

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)

const G = {
  bg:'#0D1117', surface:'#161B22', card:'#1C2128', card2:'#21262D', text:'#E6EDF3',
  muted:'#8B949E', dim:'#6E7681', border:'#30363D', border2:'#21262D',
  blue:'#58A6FF', green:'#2EA043', greenBg:'#238636', yellow:'#D29922', orange:'#F0883E',
  red:'#F85149', purple:'#A371F7', teal:'#2DD4BF', pink:'#F778BA', executie:'#58A6FF',
}

const BUCKET_INBOX = 'ai-documente-inbox'
const BUCKET_EXEC = 'executie-contracte'

// cod tip document → etichetă RO (pt afișaj)
const TIP_LABEL = {
  ordin_incepere:'Ordin de începere', ordin_reincepere:'Ordin de reîncepere', act_aditional:'Act adițional', aviz:'Aviz',
  autorizatie:'Autorizație de construire', contract:'Contract', garantie_exec:'Garanție bună execuție',
  grafic:'Grafic de execuție', autorizatie_iscir:'Autorizație ISCIR', autorizatie_transport:'Autorizație transport',
  autorizatie_sudura:'Autorizație sudură', buletin:'Buletin / CI', permis_sedere:'Permis de ședere',
  permis_munca:'Permis de muncă', aviz_medical:'Aviz medical', aviz_psihologic:'Aviz psihologic',
  itp:'ITP', rca:'RCA', casco:'CASCO', tahograf:'Tahograf', copie_conforma:'Copie conformă',
  factura:'Factură', ipc:'IPC', certificat_plata:'Certificat de plată', altul:'Altul',
}
// tipuri valide pentru destinația Execuție (dropdown corecție)
const TIPURI_EXEC = ['ordin_incepere','ordin_reincepere','act_aditional','aviz','autorizatie','contract','garantie_exec','grafic','altul']

const MODUL_META = {
  executie:{ label:'Execuție', color:G.executie, emoji:'🏗️' },
  hr:{ label:'HR', color:G.pink, emoji:'👷' },
  logistica:{ label:'Logistică', color:G.orange, emoji:'🚚' },
  financiar:{ label:'Financiar', color:G.green, emoji:'💰' },
}

const fmtDate = v => v ? new Date(v).toLocaleDateString('ro-RO', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '—'
const fmtD = v => v ? new Date(v).toLocaleDateString('ro-RO', { day:'2-digit', month:'2-digit', year:'numeric' }) : '—'
const randId = () => Math.random().toString(36).slice(2, 10)

// ═══════════════════════════════════════════════════════════════
export default function CitesteOricePanel({ open, onClose, profile, proiectContextId = null, proiectContextNume = null, onConfirmed }) {
  const [view, setView] = useState('upload')            // 'upload' | 'confirm'
  const [queue, setQueue] = useState([])
  const [proiecte, setProiecte] = useState([])
  const [uploading, setUploading] = useState([])         // [{nume, stare}]
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [toast, setToast] = useState(null)

  const flash = (tip, msg) => { setToast({ tip, msg }); setTimeout(() => setToast(null), 3500) }

  const loadQueue = useCallback(async () => {
    setLoading(true)
    // Faza 1: arăt ce e pentru Execuție sau nedecis (RLS filtrează accesul real)
    const { data } = await supabase.from('ai_documente_inbox')
      .select('*')
      .in('status', ['clasificat','eroare'])
      .or('modul_tinta.eq.executie,modul_tinta.is.null')
      .order('uploadat_la', { ascending: false })
    setQueue(data || [])
    setLoading(false)
  }, [])

  const loadProiecte = useCallback(async () => {
    const { data } = await supabase.from('executie_proiecte').select('id,nume,cod_intern').eq('activ', true).order('nume')
    setProiecte(data || [])
  }, [])

  useEffect(() => {
    if (!open) return
    loadQueue(); loadProiecte()
    setView(proiectContextId ? 'upload' : 'upload')
  }, [open, loadQueue, loadProiecte, proiectContextId])

  // ─── UPLOAD ───────────────────────────────────────────────────
  async function handleFiles(fileList) {
    const files = Array.from(fileList || [])
    if (!files.length) return
    for (const file of files) {
      const rowState = { nume: file.name, stare: 'upload' }
      setUploading(u => [...u, rowState])
      try {
        const ext = (file.name.split('.').pop() || 'pdf').toLowerCase()
        const path = `${profile.id}/${Date.now()}_${randId()}.${ext}`
        const { error: upErr } = await supabase.storage.from(BUCKET_INBOX).upload(path, file, { upsert: false, contentType: file.type || undefined })
        if (upErr) throw new Error(upErr.message)

        const ins = {
          fisier_path: path, fisier_nume: file.name, fisier_size_bytes: file.size,
          fisier_mime: file.type || null, status: 'in_asteptare', uploadat_de: profile.id,
        }
        // upload contextual → entitate deja cunoscută
        if (proiectContextId) { ins.entitate_tip = 'proiect'; ins.entitate_id = proiectContextId; ins.entitate_match_confidence = 100; ins.modul_tinta = 'executie' }
        const { data: row, error: insErr } = await supabase.from('ai_documente_inbox').insert(ins).select('id').single()
        if (insErr) throw new Error(insErr.message)

        setUploading(u => u.map(x => x === rowState ? { ...x, stare: 'ai' } : x))
        // clasificare AI
        const { error: fnErr } = await supabase.functions.invoke('citeste-orice', { body: { inbox_id: row.id } })
        if (fnErr) throw new Error('AI: ' + fnErr.message)

        setUploading(u => u.filter(x => x !== rowState))
      } catch (e) {
        setUploading(u => u.map(x => x === rowState ? { ...x, stare: 'eroare', err: String(e.message || e) } : x))
      }
    }
    await loadQueue()
    setView('confirm')
    flash('ok', 'Document(e) citit(e). Verifică și confirmă mai jos.')
  }

  // ─── CONFIRM (Execuție) ───────────────────────────────────────
  async function handleConfirm(row) {
    const proiectId = row._editProiect ?? row.entitate_id
    const tip = row._editTip ?? row.tip_document
    if (!proiectId) { flash('err', 'Alege proiectul înainte de a confirma.'); return }
    setBusyId(row.id)
    try {
      // mut fișierul din staging în bucketul definitiv de execuție
      const { data: blob, error: dlErr } = await supabase.storage.from(BUCKET_INBOX).download(row.fisier_path)
      if (dlErr || !blob) throw new Error('Nu pot descărca fișierul: ' + (dlErr?.message || ''))
      const ext = (row.fisier_nume.split('.').pop() || 'pdf').toLowerCase()
      const destPath = `${proiectId}/aidoc_${Date.now()}_${randId()}.${ext}`
      const { error: upErr } = await supabase.storage.from(BUCKET_EXEC).upload(destPath, blob, { upsert: false, contentType: row.fisier_mime || undefined })
      if (upErr) throw new Error('Upload destinație: ' + upErr.message)

      const { data: created, error: insErr } = await supabase.from('executie_documente_contract').insert({
        proiect_id: proiectId, tip_document: tip,
        fisier_path: destPath, fisier_nume: row.fisier_nume,
        fisier_size_bytes: row.fisier_size_bytes, fisier_mime: row.fisier_mime || 'application/pdf',
        descriere: row.payload_ai?.titlu_scurt || null, uploadat_de: profile.id,
      }).select('id').single()
      if (insErr) throw new Error('Insert document: ' + insErr.message)

      // Auto-completare date proiect din ce a extras AI — DOAR câmpurile goale (nu suprascrie)
      if (row._scrieDate !== false && row.payload_ai?.date_proiect) {
        const dp = row.payload_ai.date_proiect
        try {
          const { data: proj } = await supabase.from('executie_proiecte')
            .select('data_start,data_termen,durata_contract_luni').eq('id', proiectId).single()
          const upd = {}
          if (dp.data_start && proj && !proj.data_start) upd.data_start = dp.data_start
          if (dp.data_termen && proj && !proj.data_termen) upd.data_termen = dp.data_termen
          if (dp.durata_luni && proj && !proj.durata_contract_luni) upd.durata_contract_luni = dp.durata_luni
          if (Object.keys(upd).length) {
            upd.updated_at = new Date().toISOString()
            await supabase.from('executie_proiecte').update(upd).eq('id', proiectId)
          }
        } catch (_) { /* completarea datelor nu blochează confirmarea documentului */ }
      }

      await supabase.from('ai_documente_inbox').update({
        status: 'confirmat', modul_tinta: 'executie', tip_document: tip,
        entitate_tip: 'proiect', entitate_id: proiectId,
        confirmat_de: profile.id, confirmat_la: new Date().toISOString(), confirmat_ref_id: created.id,
      }).eq('id', row.id)

      // curăț fișierul din staging (rândul inbox rămâne ca istoric)
      await supabase.storage.from(BUCKET_INBOX).remove([row.fisier_path]).catch(() => {})

      flash('ok', 'Document trimis în Execuție ✓')
      await loadQueue()
      onConfirmed && onConfirmed()
    } catch (e) {
      flash('err', String(e.message || e))
    } finally { setBusyId(null) }
  }

  async function handleReject(row) {
    if (!confirm('Respingi documentul „' + row.fisier_nume + '"? Fișierul rămâne pentru audit, dar nu intră în sistem.')) return
    setBusyId(row.id)
    await supabase.from('ai_documente_inbox').update({ status: 'respins', respins_motiv: 'respins manual', confirmat_de: profile.id, confirmat_la: new Date().toISOString() }).eq('id', row.id)
    setBusyId(null); flash('ok', 'Respins.'); loadQueue()
  }

  async function preview(row) {
    const { data } = await supabase.storage.from(BUCKET_INBOX).createSignedUrl(row.fisier_path, 120)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  function patch(id, key, val) { setQueue(q => q.map(r => r.id === id ? { ...r, [key]: val } : r)) }

  if (!open) return null

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', zIndex:1000, display:'flex', alignItems:'flex-start', justifyContent:'center', padding:'40px 16px', overflowY:'auto' }}
      onClick={onClose}>
      <div style={{ width:'100%', maxWidth:760, background:G.surface, border:`1px solid ${G.border}`, borderRadius:14, overflow:'hidden' }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding:'16px 20px', borderBottom:`1px solid ${G.border}`, display:'flex', alignItems:'center', gap:12 }}>
          <div style={{ fontSize:22 }}>📥</div>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:16, fontWeight:800, color:G.text }}>Citește Orice</div>
            <div style={{ fontSize:12, color:G.muted }}>
              {proiectContextNume ? <>Atașezi la proiect: <b style={{ color:G.executie }}>{proiectContextNume}</b></> : 'Aruncă orice document — AI îl citește și îl pregătește pentru confirmare'}
            </div>
          </div>
          <button onClick={onClose} style={{ background:'transparent', border:`1px solid ${G.border}`, color:G.muted, borderRadius:8, width:32, height:32, cursor:'pointer', fontSize:16 }}>✕</button>
        </div>

        {/* Tabs interne */}
        <div style={{ display:'flex', gap:4, padding:'10px 16px 0' }}>
          {[['upload','📤 Încarcă'], ['confirm', `🤖 De confirmat${queue.length ? ` (${queue.length})` : ''}`]].map(([k, l]) => (
            <button key={k} onClick={() => setView(k)} style={{
              padding:'8px 16px', background: view === k ? G.executie + '22' : 'transparent',
              color: view === k ? G.executie : G.muted, border:`1px solid ${view === k ? G.executie + '66' : G.border2}`,
              borderRadius:'8px 8px 0 0', cursor:'pointer', fontSize:13, fontWeight:700 }}>{l}</button>
          ))}
        </div>

        <div style={{ padding:20, maxHeight:'62vh', overflowY:'auto' }}>
          {view === 'upload' && (
            <div>
              <DropInline color={G.executie} onFiles={handleFiles} />
              {uploading.length > 0 && (
                <div style={{ marginTop:14, display:'flex', flexDirection:'column', gap:6 }}>
                  {uploading.map((u, i) => (
                    <div key={i} style={{ display:'flex', alignItems:'center', gap:8, fontSize:12.5, padding:'8px 12px', background:G.card, border:`1px solid ${G.border}`, borderRadius:8 }}>
                      <span style={{ flex:1, color:G.text }}>{u.nume}</span>
                      <span style={{ color: u.stare === 'eroare' ? G.red : u.stare === 'ai' ? G.purple : G.muted, fontWeight:700 }}>
                        {u.stare === 'upload' ? '⏳ urc…' : u.stare === 'ai' ? '🤖 AI citește…' : `⚠ ${u.err || 'eroare'}`}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ marginTop:14, fontSize:11.5, color:G.dim, lineHeight:1.6 }}>
                Accept PDF sau imagini. AI-ul detectează tipul documentului și, pentru documente de proiect, încearcă să găsească proiectul potrivit. Nimic nu intră în sistem fără confirmarea ta.
              </div>
            </div>
          )}

          {view === 'confirm' && (
            <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
              {loading && <div style={{ textAlign:'center', color:G.muted, padding:20 }}>Se încarcă…</div>}
              {!loading && !queue.length && (
                <div style={{ textAlign:'center', color:G.muted, padding:'30px 10px' }}>
                  <div style={{ fontSize:26, marginBottom:8 }}>✅</div>
                  Nimic de confirmat. Încarcă un document din tab-ul „📤 Încarcă".
                </div>
              )}
              {queue.map(row => {
                const mm = MODUL_META[row.modul_tinta] || { label:'Nedecis', color:G.dim, emoji:'❓' }
                const esteExec = row.modul_tinta === 'executie' || row.modul_tinta == null
                const eroare = row.status === 'eroare'
                const proiectMatch = proiecte.find(p => p.id === (row._editProiect ?? row.entitate_id))
                return (
                  <div key={row.id} style={{ background:G.card, border:`1px solid ${eroare ? G.red + '66' : G.border}`, borderRadius:12, padding:14 }}>
                    <div style={{ display:'flex', alignItems:'flex-start', gap:10, marginBottom:10 }}>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:14, fontWeight:700, color:G.text, wordBreak:'break-word' }}>
                          {row.payload_ai?.titlu_scurt || row.fisier_nume}
                        </div>
                        <div style={{ fontSize:11.5, color:G.muted, marginTop:2 }}>{row.fisier_nume} · {fmtDate(row.uploadat_la)}</div>
                      </div>
                      <button onClick={() => preview(row)} style={{ ...btnS, color:G.blue, borderColor:G.blue + '55' }}>👁 Vezi</button>
                    </div>

                    {eroare ? (
                      <div style={{ fontSize:12.5, color:G.red, background:G.red + '11', padding:'8px 12px', borderRadius:8 }}>
                        ⚠ AI nu a putut citi documentul: {row.ai_eroare || 'eroare necunoscută'}. Poți încerca din nou sau adaugă-l manual din pagina proiectului.
                      </div>
                    ) : (
                      <>
                        {/* Ce a detectat AI */}
                        <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginBottom:12 }}>
                          <span style={{ ...chip, background:mm.color + '22', color:mm.color, border:`1px solid ${mm.color}55` }}>{mm.emoji} {mm.label}</span>
                          <span style={{ ...chip, background:G.card2, color:G.muted, border:`1px solid ${G.border}` }}>
                            {TIP_LABEL[row.tip_document] || row.tip_document}
                          </span>
                          {row.clasificare_confidence != null && (
                            <span style={{ ...chip, background:G.card2, color: row.clasificare_confidence >= 70 ? G.green : G.yellow, border:`1px solid ${G.border}` }}>
                              🎯 {row.clasificare_confidence}%
                            </span>
                          )}
                          {row.entitate_id && proiectMatch && row.entitate_match_confidence != null && (
                            <span style={{ ...chip, background:G.green + '18', color:G.green, border:`1px solid ${G.green}55` }}>
                              🔗 proiect găsit ({row.entitate_match_confidence}%)
                            </span>
                          )}
                        </div>

                        {esteExec ? (
                          <>
                            {/* Corecție proiect + tip */}
                            <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginBottom:12 }}>
                              <label style={{ flex:'1 1 260px', fontSize:12 }}>
                                <span style={{ color:G.muted, display:'block', marginBottom:4 }}>Proiect</span>
                                <select value={row._editProiect ?? row.entitate_id ?? ''} onChange={e => patch(row.id, '_editProiect', e.target.value ? Number(e.target.value) : null)}
                                  style={sel}>
                                  <option value="">— alege proiectul —</option>
                                  {proiecte.map(p => <option key={p.id} value={p.id}>{p.cod_intern ? p.cod_intern + ' · ' : ''}{p.nume}</option>)}
                                </select>
                              </label>
                              <label style={{ flex:'1 1 180px', fontSize:12 }}>
                                <span style={{ color:G.muted, display:'block', marginBottom:4 }}>Tip document</span>
                                <select value={row._editTip ?? row.tip_document ?? 'altul'} onChange={e => patch(row.id, '_editTip', e.target.value)} style={sel}>
                                  {TIPURI_EXEC.map(t => <option key={t} value={t}>{TIP_LABEL[t]}</option>)}
                                </select>
                              </label>
                            </div>

                            {/* Date extrase pentru proiect */}
                            {(() => {
                              const dp = row.payload_ai?.date_proiect
                              if (!dp || (!dp.data_start && !dp.data_termen && !dp.durata_luni)) return null
                              return (
                                <div style={{ marginBottom:12, padding:'10px 12px', background:G.teal + '12', border:`1px solid ${G.teal}44`, borderRadius:8 }}>
                                  <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', marginBottom:6 }}>
                                    <input type="checkbox" checked={row._scrieDate !== false} onChange={e => patch(row.id, '_scrieDate', e.target.checked)} />
                                    <span style={{ fontSize:12.5, fontWeight:700, color:G.teal }}>📋 Completează datele proiectului</span>
                                  </label>
                                  <div style={{ display:'flex', flexWrap:'wrap', gap:'4px 14px', fontSize:11.5, color:G.text, paddingLeft:24 }}>
                                    {dp.data_start && <span>Start: <b>{fmtD(dp.data_start)}</b></span>}
                                    {dp.data_termen && <span>Termen: <b>{fmtD(dp.data_termen)}</b></span>}
                                    {dp.durata_luni && <span>Durată: <b>{dp.durata_luni} luni</b></span>}
                                  </div>
                                  <div style={{ fontSize:10.5, color:G.dim, marginTop:5, paddingLeft:24 }}>Se completează doar câmpurile goale — nu suprascrie ce ai pus deja.</div>
                                </div>
                              )
                            })()}

                            <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
                              <button onClick={() => handleReject(row)} disabled={busyId === row.id} style={{ ...btnS, color:G.red, borderColor:G.red + '55' }}>✕ Respinge</button>
                              <button onClick={() => handleConfirm(row)} disabled={busyId === row.id}
                                style={{ padding:'8px 18px', background:G.greenBg, color:'#fff', border:'none', borderRadius:8, fontSize:13, fontWeight:700, cursor:'pointer', opacity: busyId === row.id ? 0.5 : 1 }}>
                                {busyId === row.id ? '⏳…' : '✓ Confirmă → Execuție'}
                              </button>
                            </div>
                          </>
                        ) : (
                          <div style={{ fontSize:12.5, color:G.muted, background:G.card2, padding:'10px 12px', borderRadius:8 }}>
                            Documentul aparține modulului <b style={{ color:mm.color }}>{mm.emoji} {mm.label}</b>. Confirmarea pentru acest modul se activează în Faza 2 — momentan rămâne în coadă.
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {toast && (
          <div style={{ padding:'10px 20px', background: toast.tip === 'ok' ? G.green + '18' : G.red + '18', color: toast.tip === 'ok' ? G.green : G.red, fontSize:13, fontWeight:600, borderTop:`1px solid ${G.border}` }}>
            {toast.msg}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Dropzone inline (multiple) ────────────────────────────────
function DropInline({ color, onFiles }) {
  const [drag, setDrag] = useState(false)
  let inputRef = null
  return (
    <div
      onDragOver={e => { e.preventDefault(); setDrag(true) }}
      onDragLeave={e => { e.preventDefault(); setDrag(false) }}
      onDrop={e => { e.preventDefault(); setDrag(false); onFiles(e.dataTransfer?.files) }}
      onClick={() => inputRef && inputRef.click()}
      style={{ border:`2px dashed ${drag ? color : G.border}`, background: drag ? color + '18' : G.bg, borderRadius:12, padding:'34px 20px', textAlign:'center', cursor:'pointer', transition:'.15s' }}>
      <input ref={el => (inputRef = el)} type="file" accept="application/pdf,image/*" multiple style={{ display:'none' }}
        onChange={e => { onFiles(e.target.files); e.target.value = '' }} />
      <div style={{ fontSize:34, marginBottom:8 }}>📄</div>
      <div style={{ fontSize:15, fontWeight:700, color:G.text }}>Trage documentele aici</div>
      <div style={{ fontSize:12.5, color:G.muted, marginTop:4 }}>sau click pentru a alege · PDF sau imagini · poți urca mai multe deodată</div>
    </div>
  )
}

const btnS = { padding:'7px 14px', background:'transparent', border:'1px solid', borderRadius:8, fontSize:12.5, fontWeight:700, cursor:'pointer' }
const chip = { padding:'4px 10px', borderRadius:20, fontSize:11.5, fontWeight:700 }
const sel = { width:'100%', padding:'8px 10px', background:G.card2, color:G.text, border:`1px solid ${G.border}`, borderRadius:8, fontSize:12.5 }
