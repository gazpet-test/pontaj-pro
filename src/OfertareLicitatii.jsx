// ════════════════════════════════════════════════════════════════
// OfertareLicitatii.jsx — M1 Modul Ofertare: dashboard licitații + E0
// Caiet de sarcini: claude_docs / modul-ofertare-caiet-sarcini
// E0 = înregistrarea licitației + decizia GO/NO-GO (a lui Răzvan, cu motivare
// păstrată). Pipeline-ul complet (E1–E11) se construiește pe tabelele ofertare_*
// din migrarea ofertare_m1_schema; aici e primul ecran: listă + countdown +
// roșu pe cerințele eliminatorii neacoperite (v_ofertare_dashboard).
// Fișier separat de Ofertare.jsx ca tab-urile vechi (calitate/probe) să rămână
// neatinse; componentele stau la nivel de modul (lecția #105 — remount).
// ════════════════════════════════════════════════════════════════
import { useState, useEffect, useRef } from 'react'
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
  card: { background:G.card, border:`1px solid ${G.border}`, borderRadius:10 },
}

export const LICITATIE_STATUS = {
  identificata: { label:'Identificată', color:G.muted,  icon:'🔍' },
  analiza:      { label:'În analiză',   color:G.yellow, icon:'🧐' },
  go:           { label:'GO',           color:G.teal,   icon:'🟢' },
  in_lucru:     { label:'În lucru',     color:G.blue,   icon:'🛠' },
  depusa:       { label:'Depusă',       color:G.purple, icon:'📮' },
  castigata:    { label:'Câștigată',    color:G.green,  icon:'🏆' },
  pierduta:     { label:'Pierdută',     color:G.red,    icon:'❌' },
  abandonata:   { label:'Abandonată',   color:G.dim,    icon:'⛔' },
}
// Tranzițiile permise din UI — restul curg prin deciziile dedicate (GO/NO-GO)
const TRANZITII = {
  identificata: ['analiza'],
  analiza:      [],                 // iese doar prin decizia GO / NO-GO
  go:           ['in_lucru'],
  in_lucru:     ['depusa'],
  depusa:       ['castigata','pierduta'],
  castigata:    [], pierduta: [], abandonata: [],
}

const fmtVal = v => (v || v === 0) ? new Intl.NumberFormat('ro-RO', { maximumFractionDigits: 0 }).format(v) : '—'
const fmtTermen = t => t ? new Date(t).toLocaleString('ro-RO', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '—'
// timestamptz → valoare pentru <input type="datetime-local"> (ora locală, nu UTC)
const toLocalInput = t => { if (!t) return ''; const d = new Date(t); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16) }

export default function OfertareLicitatiiTab() {
  const [profile, setProfile] = useState(null)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editRow, setEditRow] = useState(null)
  const [selected, setSelected] = useState(null)
  const [fStatus, setFStatus] = useState('active')
  const [toast, setToast] = useState(null)

  const showToast = (msg, tip = 'ok') => { setToast({ msg, tip }); setTimeout(() => setToast(null), 4000) }

  const load = async () => {
    setLoading(true)
    const [{ data: v }, { data: full }] = await Promise.all([
      supabase.from('v_ofertare_dashboard').select('*').order('termen_depunere', { ascending: true, nullsFirst: false }),
      supabase.from('ofertare_licitatii').select('*'),
    ])
    const fullMap = {}; (full || []).forEach(l => { fullMap[l.id] = l })
    setRows((v || []).map(r => ({ ...fullMap[r.id], ...r })))
    setLoading(false)
  }
  useEffect(() => {
    load()
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) supabase.from('profiles').select('id, name, is_owner').eq('id', user.id).single()
        .then(({ data }) => setProfile(data))
    })
  }, [])

  const FINALE = ['castigata', 'pierduta', 'abandonata']
  const filtrate = rows.filter(r => fStatus === 'active' ? !FINALE.includes(r.status)
    : fStatus === 'finale' ? FINALE.includes(r.status) : true)

  const salveaza = async (form) => {
    const payload = {
      nr_anunt: form.nr_anunt.trim(),
      autoritate: form.autoritate.trim(),
      obiect: form.obiect.trim(),
      link_seap: form.link_seap.trim() || null,
      valoare_estimata: form.valoare_estimata !== '' ? Number(form.valoare_estimata) : null,
      moneda: form.moneda,
      termen_depunere: form.termen_depunere ? new Date(form.termen_depunere).toISOString() : null,
      criteriu: form.criteriu.trim() || null,
      garantie_participare: form.garantie_participare.trim() || null,
      nas_path: form.nas_path.trim() || null,
      observatii: form.observatii.trim() || null,
      ...(form.loturi_ai ? { loturi: form.loturi_ai } : {}),
      updated_at: new Date().toISOString(),
    }
    let licId = editRow?.id
    if (editRow) {
      const { error } = await supabase.from('ofertare_licitatii').update(payload).eq('id', editRow.id)
      if (error) { showToast('Eroare la salvare: ' + error.message, 'err'); return false }
    } else {
      const { data: ins, error } = await supabase.from('ofertare_licitatii')
        .insert({ ...payload, created_by: profile?.id || null }).select('id').single()
      if (error) { showToast('Eroare la salvare: ' + error.message, 'err'); return false }
      licId = ins.id
    }
    // Fișa de date trasă în formular devine primul document al licitației (tip fisa_date)
    if (form.fisa_path && licId) {
      const { error: eDoc } = await supabase.from('ofertare_documente_atribuire').insert({
        licitatie_id: licId, fisier_path: form.fisa_path, nume_original: form.fisa_nume || 'fisa_date.pdf',
        tip: 'fisa_date', procesat_la: new Date().toISOString(),
      })
      if (eDoc) showToast('Licitația s-a salvat, dar fișa nu s-a atașat: ' + eDoc.message, 'warn')
    }
    showToast(editRow ? 'Licitație actualizată.' : `Licitație înregistrată — ${payload.nr_anunt}.`)
    setShowForm(false); setEditRow(null)
    await load()
    return true
  }

  const schimbaStatus = async (l, status) => {
    const { error } = await supabase.from('ofertare_licitatii')
      .update({ status, updated_at: new Date().toISOString() }).eq('id', l.id)
    if (error) { showToast('Eroare: ' + error.message, 'err'); return }
    showToast(`${LICITATIE_STATUS[status].icon} ${l.nr_anunt} → ${LICITATIE_STATUS[status].label}.`)
    setSelected(null); await load()
  }

  // E0: decizia GO/NO-GO — doar owner, cu motivare păstrată
  const decide = async (l, decizie, motivare) => {
    if (!profile?.is_owner) { showToast('Decizia GO/NO-GO e doar a ownerului.', 'err'); return }
    const { error } = await supabase.from('ofertare_licitatii').update({
      decizie_go: decizie, decizie_motivare: motivare?.trim() || null,
      decizie_de: profile.id, decizie_la: new Date().toISOString(),
      status: decizie === 'go' ? 'go' : 'abandonata',
      updated_at: new Date().toISOString(),
    }).eq('id', l.id)
    if (error) { showToast('Eroare: ' + error.message, 'err'); return }
    showToast(decizie === 'go' ? `🟢 GO pe ${l.nr_anunt}.` : `⛔ NO-GO pe ${l.nr_anunt} — abandonată.`, decizie === 'go' ? 'ok' : 'warn')
    setSelected(null); await load()
  }

  const sterge = async (l) => {
    if (!profile?.is_owner) return
    if (!window.confirm(`Ștergi licitația ${l.nr_anunt}?\nSe șterg și documentele/cerințele/acoperirea ei. IREVERSIBIL.`)) return
    const { error } = await supabase.from('ofertare_licitatii').delete().eq('id', l.id)
    if (error) { showToast('Eroare: ' + error.message, 'err'); return }
    showToast(`🗑 ${l.nr_anunt} ștearsă.`, 'warn')
    setSelected(null); await load()
  }

  return (
    <div style={{ padding: 28, maxWidth: 1200, margin: '0 auto' }}>
      {toast && (
        <div style={{ position:'fixed', top:76, right:20, zIndex:2000, padding:'11px 18px', borderRadius:9, fontSize:13, fontWeight:600,
          background: toast.tip === 'err' ? G.red : toast.tip === 'warn' ? G.orange : G.green, color:'#0D1117' }}>{toast.msg}</div>
      )}

      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:18, flexWrap:'wrap', gap:10 }}>
        <div>
          <div style={{ fontSize:19, fontWeight:800 }}>🏛 Licitații</div>
          <div style={{ fontSize:12, color:G.muted }}>Pipeline de la anunț SEAP la depunere — countdown, GO/NO-GO, cerințe eliminatorii</div>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <select style={{ ...S.input, width:'auto' }} value={fStatus} onChange={e => setFStatus(e.target.value)}>
            <option value="active">În desfășurare</option>
            <option value="finale">Finalizate</option>
            <option value="toate">Toate</option>
          </select>
          <button style={S.btnP} onClick={() => { setEditRow(null); setShowForm(true) }}>＋ Licitație nouă</button>
        </div>
      </div>

      {loading && <div style={{ padding:40, textAlign:'center', color:G.muted }}>Se încarcă licitațiile...</div>}
      {!loading && !filtrate.length && (
        <div style={{ ...S.card, padding:40, textAlign:'center', color:G.dim, fontSize:14 }}>
          {rows.length ? 'Nimic pe filtrul curent.' : 'Nicio licitație încă. Apasă „＋ Licitație nouă" — primul pas e anunțul SEAP + termenul de depunere.'}
        </div>
      )}

      <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
        {filtrate.map(l => {
          const st = LICITATIE_STATUS[l.status] || LICITATIE_STATUS.identificata
          const urgent = l.termen_depunere && !FINALE.includes(l.status) && l.status !== 'depusa'
          const zile = l.zile_ramase
          const cZile = zile == null ? G.muted : zile <= 3 ? G.red : zile <= 7 ? G.orange : G.green
          return (
            <div key={l.id} onClick={() => setSelected(l)} style={{ ...S.card, padding:'14px 18px', cursor:'pointer',
              borderLeft:`3px solid ${l.eliminatorii_neacoperite > 0 ? G.red : st.color}` }}>
              <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
                <span style={{ background: st.color + '22', color: st.color, border:`1px solid ${st.color}66`, borderRadius:14, padding:'3px 12px', fontSize:11.5, fontWeight:800, whiteSpace:'nowrap' }}>{st.icon} {st.label}</span>
                <span style={{ fontWeight:800, fontSize:14.5 }}>{l.nr_anunt}</span>
                <span style={{ color:G.muted, fontSize:13, flex:1, minWidth:200, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{l.obiect}</span>
                {urgent && (
                  <span style={{ color:cZile, fontWeight:800, fontSize:13, whiteSpace:'nowrap' }}>
                    ⏳ {zile == null ? 'fără termen' : zile === 0 ? 'AZI!' : `${zile} ${zile === 1 ? 'zi' : 'zile'}`}
                  </span>
                )}
                {l.eliminatorii_neacoperite > 0 && (
                  <span style={{ background:G.red + '22', color:G.red, border:`1px solid ${G.red}66`, borderRadius:14, padding:'3px 12px', fontSize:11.5, fontWeight:800, whiteSpace:'nowrap' }}>
                    🚫 {l.eliminatorii_neacoperite} eliminatorii neacoperite
                  </span>
                )}
              </div>
              <div style={{ display:'flex', gap:18, marginTop:8, fontSize:12, color:G.dim, flexWrap:'wrap' }}>
                <span>🏢 {l.autoritate}</span>
                <span>💰 {fmtVal(l.valoare_estimata)} {l.moneda}</span>
                <span>📅 depunere: {fmtTermen(l.termen_depunere)}</span>
                <span>📄 {l.nr_documente} documente</span>
                <span>📋 {l.nr_cerinte} cerințe{l.nr_eliminatorii > 0 ? ` (${l.nr_eliminatorii} eliminatorii)` : ''}</span>
              </div>
            </div>
          )
        })}
      </div>

      {showForm && (
        <LicitatieFormModal licitatie={editRow} onClose={() => { setShowForm(false); setEditRow(null) }} onSave={salveaza} />
      )}
      {selected && (
        <LicitatieDetailModal licitatie={selected} profile={profile}
          onClose={() => setSelected(null)}
          onEdit={() => { setEditRow(selected); setSelected(null); setShowForm(true) }}
          onStatus={schimbaStatus} onDecide={decide} onDelete={sterge} />
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// MODAL: LICITAȚIE NOUĂ / EDITARE (E0 — înregistrarea)
// ════════════════════════════════════════════════════════════════
function LicitatieFormModal({ licitatie, onClose, onSave }) {
  const e0 = licitatie
  const [form, setForm] = useState({
    nr_anunt: e0?.nr_anunt || '', autoritate: e0?.autoritate || '', obiect: e0?.obiect || '',
    link_seap: e0?.link_seap || '', valoare_estimata: e0?.valoare_estimata ?? '', moneda: e0?.moneda || 'RON',
    termen_depunere: toLocalInput(e0?.termen_depunere), criteriu: e0?.criteriu || '',
    garantie_participare: e0?.garantie_participare || '', nas_path: e0?.nas_path || '', observatii: e0?.observatii || '',
    fisa_path: null, fisa_nume: null, loturi_ai: null,
  })
  const [saving, setSaving] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiMsg, setAiMsg] = useState(null)   // { tip:'ok'|'err', text }
  const [dragOver, setDragOver] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const valid = form.nr_anunt.trim() && form.autoritate.trim() && form.obiect.trim()

  // E0 auto-fill: PDF-ul fișei de date → Storage → edge fn → precompletare formular.
  // AI propune, omul verifică — nimic nu se salvează până nu apeși „Înregistrează".
  const citesteFisa = async (file) => {
    if (!file) return
    if (!/\.pdf$/i.test(file.name)) { setAiMsg({ tip:'err', text:'Doar PDF — exportă fișa de date din SEAP ca PDF.' }); return }
    setAiBusy(true); setAiMsg(null)
    try {
      const safe = file.name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-80)
      const path = `e0/${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safe}`
      const { error: eUp } = await supabase.storage.from('ofertare').upload(path, file, { contentType: 'application/pdf' })
      if (eUp) throw eUp
      const { data, error } = await supabase.functions.invoke('ofertare-e0-autofill', { body: { path, fisier_nume: file.name } })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      setForm(f => ({
        ...f,
        nr_anunt: data.nr_anunt || f.nr_anunt,
        autoritate: data.autoritate || f.autoritate,
        obiect: data.obiect || f.obiect,
        valoare_estimata: data.valoare_estimata ?? f.valoare_estimata,
        moneda: data.moneda || f.moneda,
        termen_depunere: data.termen_depunere ? toLocalInput(data.termen_depunere) : f.termen_depunere,
        criteriu: data.criteriu || f.criteriu,
        garantie_participare: data.garantie_participare || f.garantie_participare,
        loturi_ai: Array.isArray(data.loturi) && data.loturi.length ? data.loturi : f.loturi_ai,
        fisa_path: path, fisa_nume: file.name,
      }))
      const gasite = ['nr_anunt','autoritate','obiect','valoare_estimata','termen_depunere','criteriu','garantie_participare'].filter(k => data[k] != null).length
      setAiMsg({ tip:'ok', text:`✨ ${gasite}/7 câmpuri completate din „${file.name}" (încredere ${data.confidence}%). Verifică-le înainte de salvare — fișa se atașează automat licitației.` })
    } catch (e) {
      setAiMsg({ tip:'err', text:'Nu am putut citi fișa: ' + (e?.message || e) })
    } finally { setAiBusy(false) }
  }

  const submit = async () => {
    if (!valid) return
    setSaving(true)
    const ok = await onSave(form)
    if (!ok) setSaving(false)
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.7)', zIndex:1000, display:'flex', alignItems:'flex-start', justifyContent:'center', overflowY:'auto', padding:'30px 14px' }} onClick={onClose}>
      <div style={{ ...S.card, width:'min(760px,100%)', padding:24 }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize:17, fontWeight:800, marginBottom:12 }}>🏛 {e0 ? `Editează ${e0.nr_anunt}` : 'Licitație nouă'}</div>

        {/* Dropzone AI — trage fișa de date, formularul se completează singur */}
        <label onDragOver={e => { e.preventDefault(); setDragOver(true) }} onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); citesteFisa(e.dataTransfer.files?.[0]) }}
          style={{ display:'block', marginBottom:16, padding:'16px 18px', borderRadius:10, textAlign:'center', cursor:'pointer',
            border:`2px dashed ${dragOver ? G.ofertare : form.fisa_path ? G.green : G.border}`,
            background: dragOver ? G.ofertare + '15' : form.fisa_path ? G.green + '0D' : G.bg }}>
          <input type="file" accept="application/pdf,.pdf" style={{ display:'none' }} disabled={aiBusy}
            onChange={e => { citesteFisa(e.target.files?.[0]); e.target.value = '' }} />
          {aiBusy ? (
            <span style={{ fontSize:13, color:G.ofertare, fontWeight:700 }}>🤖 AI citește fișa de date... (câteva secunde)</span>
          ) : form.fisa_path ? (
            <span style={{ fontSize:13, color:G.green, fontWeight:700 }}>📎 {form.fisa_nume} — atașată. Trage alt PDF ca să recitești.</span>
          ) : (
            <span style={{ fontSize:13, color:G.muted }}>✨ <b style={{ color:G.text }}>Trage aici fișa de date / anunțul de participare (PDF)</b> sau apasă pentru a alege — AI completează formularul, tu doar verifici</span>
          )}
        </label>
        {aiMsg && (
          <div style={{ marginBottom:14, padding:'9px 13px', borderRadius:8, fontSize:12.5, fontWeight:600,
            border:`1px solid ${aiMsg.tip === 'err' ? G.red : G.green}55`,
            background:(aiMsg.tip === 'err' ? G.red : G.green) + '11', color: aiMsg.tip === 'err' ? G.red : G.green }}>{aiMsg.text}</div>
        )}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
          <div><label style={S.lbl}>Nr. anunț SEAP *</label>
            <input style={S.input} value={form.nr_anunt} onChange={e => set('nr_anunt', e.target.value)} placeholder="ex: CN1094135" /></div>
          <div><label style={S.lbl}>Autoritate contractantă *</label>
            <input style={S.input} value={form.autoritate} onChange={e => set('autoritate', e.target.value)} placeholder="ex: SNGN Romgaz SA" /></div>
          <div style={{ gridColumn:'1 / -1' }}><label style={S.lbl}>Obiect *</label>
            <input style={S.input} value={form.obiect} onChange={e => set('obiect', e.target.value)} placeholder="ex: Conductă aducțiune Grup 9 Șincai – Grup 15 Râciu (Lot 2)" /></div>
          <div style={{ gridColumn:'1 / -1' }}><label style={S.lbl}>Link SEAP</label>
            <input style={S.input} value={form.link_seap} onChange={e => set('link_seap', e.target.value)} placeholder="https://e-licitatie.ro/..." /></div>
          <div><label style={S.lbl}>Valoare estimată</label>
            <div style={{ display:'flex', gap:6 }}>
              <input style={S.input} type="number" min="0" value={form.valoare_estimata} onChange={e => set('valoare_estimata', e.target.value)} placeholder="ex: 4500000" />
              <select style={{ ...S.input, width:90 }} value={form.moneda} onChange={e => set('moneda', e.target.value)}>
                <option value="RON">RON</option><option value="EUR">EUR</option>
              </select>
            </div></div>
          <div><label style={S.lbl}>Termen de depunere</label>
            <input style={S.input} type="datetime-local" value={form.termen_depunere} onChange={e => set('termen_depunere', e.target.value)} /></div>
          <div><label style={S.lbl}>Criteriu de atribuire</label>
            <input style={S.input} value={form.criteriu} onChange={e => set('criteriu', e.target.value)} placeholder="ex: prețul cel mai scăzut" /></div>
          <div><label style={S.lbl}>Garanție de participare</label>
            <input style={S.input} value={form.garantie_participare} onChange={e => set('garantie_participare', e.target.value)} placeholder="ex: 45.000 lei, SGB/virament" /></div>
          <div style={{ gridColumn:'1 / -1' }}><label style={S.lbl}>Folder NAS</label>
            <input style={S.input} value={form.nas_path} onChange={e => set('nas_path', e.target.value)} placeholder={'ex: Z:\\Oferte\\3.ROMGAZ\\31.Cond. SINCAI_BALDA...'} /></div>
          <div style={{ gridColumn:'1 / -1' }}><label style={S.lbl}>Observații</label>
            <textarea style={{ ...S.input, minHeight:60, resize:'vertical' }} value={form.observatii} onChange={e => set('observatii', e.target.value)} /></div>
        </div>
        <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:18 }}>
          <button style={S.btnS} onClick={onClose} disabled={saving}>Anulează</button>
          <button style={{ ...S.btnP, opacity: valid && !saving ? 1 : .5 }} onClick={submit} disabled={!valid || saving}>
            {saving ? 'Se salvează...' : e0 ? '💾 Salvează' : '✅ Înregistrează licitația'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// SECȚIUNE: DOCUMENTAȚIA DE ATRIBUIRE (E1 — ingestie)
// Regulile din claude_docs/ofertare-structura-nas-licitatii (corpus v5):
// - arhivele (7z/rar/zip/.001) NU se urcă din browser — se dezarhivează local
//   și se urcă FOLDERUL (regula 1); dedup pe (nume, mărime) la re-upload
// - gunoaie excluse: ~$*, .log, _Claude_*, .db, .tmp (regulile 7/23)
// - clasificarea din nume e doar INDICIU (regula 25 — „PALNSE"), omul o poate
//   schimba; conținutul decide în E2
// - procesarea AI: un document pe rând, cu continuare (pagini_procesate) —
//   edge fn ofertare-ingest-doc, felii mici sub IDLE_TIMEOUT-ul gateway-ului
// ════════════════════════════════════════════════════════════════
const JUNK_RE = /(^|\/)~\$|\.log$|_Claude_|\.db$|\.tmp$|(^|\/)Thumbs\.db$/i
const ARHIVA_RE = /\.(7z|rar|zip|z\d{2}|\d{3})$|\.part\d+\.rar$/i
const DOC_STATUS = {
  neprocesat: { label:'neprocesat', color:G.muted },
  in_lucru:   { label:'în lucru',   color:G.yellow },
  procesat:   { label:'✓ procesat', color:G.green },
  eroare:     { label:'eroare',     color:G.red },
  ignorat:    { label:'doar fișier',color:G.dim },
}
const ghicesteTip = (nume) => {
  const n = (nume || '').toLowerCase()
  if (/fisadate|fisa.de.date|instructiuni.?ofertanti/.test(n)) return 'fisa_date'
  if (/clarificare|raspuns.*consolidat|erata/.test(n)) return 'raspuns_clarificare'
  if (/formular|duae/.test(n)) return 'formular'
  if (/contract/.test(n)) return 'model_contract'
  if (/cantitat|antemasur|^f[1-3][_ .-]/.test(n)) return 'lista_cantitati'
  if (/desene|plans|palnse|\.dwg$|izometri/.test(n)) return 'plansa'
  if (/volum|caiet|memoriu|\bcs\b|sectiunea/.test(n)) return 'cs_volum'
  return 'alta'
}

function DocumenteSection({ licitatie, onChanged }) {
  const [docs, setDocs] = useState(null)
  const [upBusy, setUpBusy] = useState(null)   // text progres upload
  const [procBusy, setProcBusy] = useState(null) // text progres procesare
  const stopRef = useRef(false)                // ref, nu state — loop-ul citește valoarea LIVE
  const [warn, setWarn] = useState(null)

  const load = async () => {
    const { data } = await supabase.from('ofertare_documente_atribuire')
      .select('id, nume_original, tip, status_procesare, pagini, pagini_procesate, ocr, revizie, size_bytes, eroare')
      .eq('licitatie_id', licitatie.id).order('id')
    setDocs(data || [])
  }
  useEffect(() => { load() }, [licitatie.id])

  const urca = async (fileList) => {
    const files = Array.from(fileList || [])
    if (!files.length) return
    const arhive = files.filter(f => ARHIVA_RE.test(f.name))
    const bune = files.filter(f => !JUNK_RE.test((f.webkitRelativePath || f.name)) && !ARHIVA_RE.test(f.name))
    setWarn(arhive.length ? `⚠️ ${arhive.length} arhive sărite (${arhive.slice(0, 3).map(f => f.name).join(', ')}${arhive.length > 3 ? '…' : ''}) — dezarhivează-le local și urcă folderul rezultat.` : null)
    if (!bune.length) { setUpBusy(null); return }
    // Dedup pe (nume, mărime) față de ce e deja urcat (regula 1 — dublă-ingestie)
    const existente = new Set((docs || []).map(d => `${d.nume_original}|${d.size_bytes || ''}`))
    setUpBusy(`0/${bune.length}`)
    let ok = 0, sarite = 0
    for (let i = 0; i < bune.length; i++) {
      const f = bune[i]
      const rel = (f.webkitRelativePath || f.name).replace(/^[^/]*\//, '') // fără folderul rădăcină
      if (existente.has(`${rel}|${f.size}`) || existente.has(`${rel}|`)) { sarite++; setUpBusy(`${i + 1}/${bune.length}`); continue }
      const safe = rel.replace(/[^a-zA-Z0-9ăâîșțĂÂÎȘȚ._/-]+/g, '_').slice(-180)
      const path = `${licitatie.id}/atribuire/${Date.now().toString(36)}_${safe}`
      const { error: eUp } = await supabase.storage.from('ofertare').upload(path, f)
      if (eUp) { setWarn(`Eroare la „${rel}": ${eUp.message}`); continue }
      const estePdf = /\.pdf$/i.test(rel)
      await supabase.from('ofertare_documente_atribuire').insert({
        licitatie_id: licitatie.id, fisier_path: path, nume_original: rel,
        tip: ghicesteTip(rel), size_bytes: f.size,
        status_procesare: estePdf ? 'neprocesat' : 'ignorat',
        eroare: estePdf ? null : 'non-PDF — rămâne ca fișier (docx/xls/dwg se parsează în M2)',
      })
      ok++
      setUpBusy(`${i + 1}/${bune.length}`)
    }
    setUpBusy(null)
    if (ok || sarite) setWarn(w => [w, `✅ ${ok} fișiere urcate${sarite ? `, ${sarite} sărite (deja există — dedup)` : ''}.`].filter(Boolean).join(' '))
    await load(); onChanged?.()
  }

  // Procesare secvențială cu continuare — un doc pe rând, apeluri repetate cât continua=true
  const proceseaza = async () => {
    const deRulat = (docs || []).filter(d => ['neprocesat', 'in_lucru', 'eroare'].includes(d.status_procesare) && /\.pdf$/i.test(d.nume_original))
    if (!deRulat.length) return
    stopRef.current = false
    for (let i = 0; i < deRulat.length; i++) {
      const d = deRulat[i]
      let continua = true, runde = 0
      while (continua && runde < 60 && !stopRef.current) {
        setProcBusy(`${i + 1}/${deRulat.length} · ${d.nume_original.split('/').pop()} (rundă ${runde + 1})`)
        const { data, error } = await supabase.functions.invoke('ofertare-ingest-doc', { body: { doc_id: d.id } })
        if (error || data?.error) { setWarn(`Eroare la „${d.nume_original}": ${data?.error || error.message}`); break }
        continua = !!data?.continua
        runde++
      }
      await load()
      if (stopRef.current) break
    }
    setProcBusy(null); stopRef.current = false
    await load(); onChanged?.()
  }

  const nrDeProcesat = (docs || []).filter(d => ['neprocesat', 'in_lucru', 'eroare'].includes(d.status_procesare) && /\.pdf$/i.test(d.nume_original)).length
  const fmtMB = b => b ? (b / 1e6).toFixed(1) + ' MB' : ''

  return (
    <div style={{ marginTop:16, padding:14, borderRadius:10, border:`1px solid ${G.border}`, background:G.bg }}>
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10, flexWrap:'wrap' }}>
        <div style={{ fontSize:13, fontWeight:800 }}>📥 Documentația de atribuire {docs ? `(${docs.length})` : ''}</div>
        <div style={{ marginLeft:'auto', display:'flex', gap:8 }}>
          <label style={{ ...S.btnS, padding:'7px 12px', fontSize:12, cursor:'pointer' }}>
            📁 Urcă folder
            <input type="file" webkitdirectory="" directory="" multiple style={{ display:'none' }}
              disabled={!!upBusy} onChange={e => { urca(e.target.files); e.target.value = '' }} />
          </label>
          <label style={{ ...S.btnS, padding:'7px 12px', fontSize:12, cursor:'pointer' }}>
            📄 Urcă fișiere
            <input type="file" multiple style={{ display:'none' }}
              disabled={!!upBusy} onChange={e => { urca(e.target.files); e.target.value = '' }} />
          </label>
          {nrDeProcesat > 0 && !procBusy && (
            <button style={{ ...S.btnP, padding:'7px 12px', fontSize:12 }} onClick={proceseaza}>🤖 Procesează ({nrDeProcesat})</button>
          )}
          {procBusy && (
            <button style={{ ...S.btnS, padding:'7px 12px', fontSize:12, color:G.red, borderColor:G.red + '66' }} onClick={() => { stopRef.current = true }}>⏹ Oprește</button>
          )}
        </div>
      </div>
      {upBusy && <div style={{ fontSize:12, color:G.ofertare, fontWeight:700, marginBottom:8 }}>⬆️ Se urcă... {upBusy}</div>}
      {procBusy && <div style={{ fontSize:12, color:G.ofertare, fontWeight:700, marginBottom:8 }}>🤖 AI citește: {procBusy}</div>}
      {warn && <div style={{ fontSize:12, color:G.orange, marginBottom:8 }}>{warn}</div>}

      {docs === null ? <div style={{ fontSize:12, color:G.muted }}>Se încarcă...</div> :
        !docs.length ? (
          <div style={{ fontSize:12, color:G.dim }}>
            Niciun document încă. Dezarhivează local documentația din SEAP (7z/rar/zip nu se urcă direct) și trage folderul cu „📁 Urcă folder" — apoi „🤖 Procesează" extrage textul, antetele și reviziile.
          </div>
        ) : (
          <div style={{ maxHeight:260, overflowY:'auto', display:'flex', flexDirection:'column', gap:3 }}>
            {docs.map(d => {
              const st = DOC_STATUS[d.status_procesare] || DOC_STATUS.neprocesat
              return (
                <div key={d.id} style={{ display:'flex', alignItems:'center', gap:8, fontSize:12, padding:'5px 8px', borderRadius:6, background:G.surface }}>
                  <span style={{ color:st.color, fontWeight:700, minWidth:86 }}>{st.label}</span>
                  <span style={{ flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }} title={d.nume_original}>{d.nume_original}</span>
                  <span style={{ color:G.dim, whiteSpace:'nowrap' }}>{d.tip}{d.revizie ? ` · rev ${d.revizie}` : ''}{d.ocr ? ' · scan' : ''}</span>
                  <span style={{ color:G.dim, whiteSpace:'nowrap' }}>
                    {d.status_procesare === 'in_lucru' && d.pagini ? `${d.pagini_procesate}/${d.pagini} pag` : d.pagini ? `${d.pagini} pag` : fmtMB(d.size_bytes)}
                  </span>
                </div>
              )
            })}
          </div>
        )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// MODAL: DETALII + ACȚIUNI (pipeline + decizia GO/NO-GO)
// ════════════════════════════════════════════════════════════════
function LicitatieDetailModal({ licitatie: l, profile, onClose, onEdit, onStatus, onDecide, onDelete }) {
  const [motivare, setMotivare] = useState(l.decizie_motivare || '')
  const st = LICITATIE_STATUS[l.status] || LICITATIE_STATUS.identificata
  const next = TRANZITII[l.status] || []
  const R = ({ k, v }) => v ? (
    <div style={{ display:'flex', gap:10, padding:'6px 0', borderBottom:`1px solid ${G.border2}`, fontSize:13 }}>
      <span style={{ color:G.muted, minWidth:170 }}>{k}</span>
      <span style={{ flex:1, wordBreak:'break-word' }}>{v}</span>
    </div>
  ) : null

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.7)', zIndex:1000, display:'flex', alignItems:'flex-start', justifyContent:'center', overflowY:'auto', padding:'30px 14px' }} onClick={onClose}>
      <div style={{ ...S.card, width:'min(820px,100%)', padding:24 }} onClick={e => e.stopPropagation()}>
        <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:6, flexWrap:'wrap' }}>
          <div style={{ fontSize:18, fontWeight:800 }}>🏛 {l.nr_anunt}</div>
          <span style={{ background: st.color + '22', color: st.color, border:`1px solid ${st.color}66`, borderRadius:14, padding:'3px 12px', fontSize:12, fontWeight:800 }}>{st.icon} {st.label}</span>
          {l.decizie_go && <span style={{ fontSize:12, color: l.decizie_go === 'go' ? G.teal : G.red, fontWeight:700 }}>decizie: {l.decizie_go.toUpperCase()}</span>}
          <button onClick={onClose} style={{ marginLeft:'auto', background:'transparent', border:'none', color:G.muted, fontSize:20, cursor:'pointer' }}>✕</button>
        </div>
        <div style={{ fontSize:13.5, color:G.text, marginBottom:14 }}>{l.obiect}</div>

        <R k="Autoritate" v={l.autoritate} />
        <R k="Valoare estimată" v={l.valoare_estimata != null ? `${fmtVal(l.valoare_estimata)} ${l.moneda}` : null} />
        <R k="Termen de depunere" v={l.termen_depunere ? `${fmtTermen(l.termen_depunere)} (${l.zile_ramase ?? '—'} zile rămase)` : null} />
        <R k="Criteriu" v={l.criteriu} />
        <R k="Garanție participare" v={l.garantie_participare} />
        <R k="Link SEAP" v={l.link_seap ? <a href={l.link_seap} target="_blank" rel="noreferrer" style={{ color:G.blue }}>{l.link_seap}</a> : null} />
        <R k="Folder NAS" v={l.nas_path} />
        <R k="Documente / Cerințe" v={`${l.nr_documente} documente · ${l.nr_cerinte} cerințe (${l.nr_eliminatorii} eliminatorii, ${l.eliminatorii_neacoperite} neacoperite)`} />
        <R k="Motivare decizie" v={l.decizie_motivare} />
        <R k="Observații" v={l.observatii} />

        {/* E1: documentația de atribuire — upload folder + procesare AI */}
        <DocumenteSection licitatie={l} />

        {/* E0: decizia GO/NO-GO — doar în analiză, doar owner */}
        {l.status === 'analiza' && profile?.is_owner && (
          <div style={{ marginTop:16, padding:14, borderRadius:10, border:`1px solid ${G.teal}55`, background:G.teal + '0D' }}>
            <div style={{ fontSize:13, fontWeight:800, marginBottom:8 }}>⚡ Decizia GO / NO-GO</div>
            <input style={{ ...S.input, marginBottom:10 }} placeholder="Motivare (se păstrează — obligatorie la NO-GO)"
              value={motivare} onChange={e => setMotivare(e.target.value)} />
            <div style={{ display:'flex', gap:10 }}>
              <button style={{ ...S.btnP, background:G.teal }} onClick={() => onDecide(l, 'go', motivare)}>🟢 GO — intrăm</button>
              <button style={{ ...S.btnS, color:G.red, borderColor:G.red + '66', opacity: motivare.trim() ? 1 : .5 }}
                disabled={!motivare.trim()} onClick={() => onDecide(l, 'no_go', motivare)}>⛔ NO-GO — abandonăm</button>
            </div>
          </div>
        )}

        <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:18, flexWrap:'wrap' }}>
          {profile?.is_owner && <button style={{ ...S.btnS, color:G.red, borderColor:G.red + '66' }} onClick={() => onDelete(l)}>🗑 Șterge</button>}
          <button style={S.btnS} onClick={onEdit}>✏️ Editează</button>
          {next.map(s => (
            <button key={s} style={{ ...S.btnS, color:LICITATIE_STATUS[s].color, borderColor:LICITATIE_STATUS[s].color + '66', fontWeight:700 }}
              onClick={() => onStatus(l, s)}>{LICITATIE_STATUS[s].icon} Marchează {LICITATIE_STATUS[s].label}</button>
          ))}
        </div>
      </div>
    </div>
  )
}
