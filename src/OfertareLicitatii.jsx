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
import RFQPanel from './OfertareRFQ.jsx'
import CantitatiPanel from './OfertareCantitati.jsx'

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

// Segmente de piață — dimensiune transversală (filtru pipeline, radar, calibrări), nu module separate
export const SEGMENTE = {
  transgaz:    { label:'Transgaz',         color:'#58A6FF' },
  romgaz:      { label:'Romgaz',           color:'#A371F7' },
  conpet:      { label:'Conpet',           color:'#F0883E' },
  distributie: { label:'Distribuție gaze', color:'#3FB950' },
  altele:      { label:'Altele',           color:'#8B949E' },
}
export const detectSegment = (autoritate = '', obiect = '') => {
  const t = (autoritate + ' ' + obiect).toLowerCase()
  if (t.includes('transgaz')) return 'transgaz'
  if (t.includes('romgaz')) return 'romgaz'
  if (t.includes('conpet')) return 'conpet'
  if (/gaze|gaz metan|bransament|branșament/.test(t)) return 'distributie'
  return 'altele'
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
  const [fSegment, setFSegment] = useState('')
  const [toast, setToast] = useState(null)
  const [vedere, setVedere] = useState('licitatii')   // licitatii | experienta | radar

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
  const filtrate = rows.filter(r => (fStatus === 'active' ? !FINALE.includes(r.status)
    : fStatus === 'finale' ? FINALE.includes(r.status) : true)
    && (!fSegment || r.segment === fSegment))

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
      segment: form.segment || detectSegment(form.autoritate, form.obiect),
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

      {/* Comutator: pipeline-ul de licitații / catalogul de experiență similară */}
      <div style={{ display:'flex', gap:8, marginBottom:16 }}>
        {[['licitatii', '🏛 Licitații'], ['cantitati', '📋 Cantități'], ['rfq', '🛒 Cereri ofertă'], ['experienta', '📚 Experiență similară'], ['radar', '📡 Radar'], ['referinte', '💰 Referințe']].map(([k, lbl]) => (
          <button key={k} onClick={() => setVedere(k)} style={{ ...S.btnS, padding:'7px 16px', fontSize:12.5, fontWeight:700,
            ...(vedere === k ? { background:G.ofertare + '22', color:G.ofertare, border:`1px solid ${G.ofertare}88` } : {}) }}>{lbl}</button>
        ))}
      </div>

      {vedere === 'experienta' && <ExperientaCatalog licitatii={rows} profile={profile} showToast={showToast} />}

      {vedere === 'radar' && <RadarLicitatii profile={profile} showToast={showToast} onPromovat={load} />}

      {vedere === 'referinte' && <ReferinteFinanciare showToast={showToast} />}

      {vedere === 'rfq' && <RFQPanel licitatii={rows} profile={profile} showToast={showToast} />}

      {vedere === 'cantitati' && <CantitatiPanel licitatii={rows} profile={profile} showToast={showToast} />}

      {vedere === 'licitatii' && <>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:18, flexWrap:'wrap', gap:10 }}>
        <div>
          <div style={{ fontSize:19, fontWeight:800 }}>🏛 Licitații</div>
          <div style={{ fontSize:12, color:G.muted }}>Pipeline de la anunț SEAP la depunere — countdown, GO/NO-GO, cerințe eliminatorii</div>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <select style={{ ...S.input, width:'auto' }} value={fSegment} onChange={e => setFSegment(e.target.value)}>
            <option value="">Toate segmentele</option>
            {Object.entries(SEGMENTE).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
          </select>
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
                {l.segment && SEGMENTE[l.segment] && (
                  <span style={{ color:SEGMENTE[l.segment].color, border:`1px solid ${SEGMENTE[l.segment].color}55`, borderRadius:10, padding:'1px 9px', fontSize:10.5, fontWeight:800 }}>{SEGMENTE[l.segment].label}</span>
                )}
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
      </>}

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
    segment: e0?.segment || '', fisa_path: null, fisa_nume: null, loturi_ai: null,
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
          <div><label style={S.lbl}>Segment</label>
            <select style={S.input} value={form.segment} onChange={e => set('segment', e.target.value)}>
              <option value="">auto ({SEGMENTE[detectSegment(form.autoritate, form.obiect)].label})</option>
              {Object.entries(SEGMENTE).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
            </select></div>
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

// Rând de inventar fără fișier real în storage. fisier_path e NOT NULL în BD,
// așa că poziția „știm că există documentul, dar nu-l avem" poartă marcajul din cale.
const ESTE_PLACEHOLDER = d => !d.fisier_path || d.fisier_path.includes('/neincarcat/')

function DocumenteSection({ licitatie, profile, onChanged }) {
  const [docs, setDocs] = useState(null)
  const [upBusy, setUpBusy] = useState(null)   // text progres upload
  const [procBusy, setProcBusy] = useState(null) // text progres procesare
  const [seapBusy, setSeapBusy] = useState(null) // text progres aducere din SEAP
  const stopRef = useRef(false)                // ref, nu state — loop-ul citește valoarea LIVE
  const [warn, setWarn] = useState(null)

  const load = async () => {
    const { data } = await supabase.from('ofertare_documente_atribuire')
      .select('id, nume_original, tip, status_procesare, pagini, pagini_procesate, ocr, revizie, size_bytes, eroare, fisier_path')
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
    // Dedup pe (nume, mărime) DOAR față de fișierele urcate efectiv (regula 1 — dublă-ingestie).
    // Rândurile-placeholder (poziții de inventar cu cale marcată „neincarcat" — ex. planșele
    // mari notate manual) NU blochează uploadul real: altfel „0 urcate, 3 sărite" și fișierul
    // nu ajunge niciodată în storage.
    const urcate = (docs || []).filter(d => !ESTE_PLACEHOLDER(d))
    const existente = new Set(urcate.map(d => `${d.nume_original}|${d.size_bytes || ''}`))
    const placeholders = new Map((docs || []).filter(ESTE_PLACEHOLDER).map(d => [d.nume_original, d.id]))
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
      const randNou = {
        licitatie_id: licitatie.id, fisier_path: path, nume_original: rel,
        tip: ghicesteTip(rel), size_bytes: f.size,
        status_procesare: estePdf ? 'neprocesat' : 'ignorat',
        eroare: estePdf ? null : 'non-PDF — rămâne ca fișier (docx/xls/dwg se parsează în M2)',
      }
      // dacă exista un placeholder cu acest nume, îl COMPLETĂM (nu lăsăm rând dublu)
      const idPlaceholder = placeholders.get(rel)
      if (idPlaceholder) await supabase.from('ofertare_documente_atribuire').update(randNou).eq('id', idPlaceholder)
      else await supabase.from('ofertare_documente_atribuire').insert(randNou)
      ok++
      setUpBusy(`${i + 1}/${bune.length}`)
    }
    setUpBusy(null)
    if (ok || sarite) setWarn(w => [w, `✅ ${ok} fișiere urcate${sarite ? `, ${sarite} sărite (deja există — dedup)` : ''}.`].filter(Boolean).join(' '))
    await load(); onChanged?.()
  }

  // Aducerea documentației DIRECT din SEAP — nimeni nu mai descarcă/urcă manual.
  // Edge fn-ul streamuiește arhiva publică a anunțului (butonul „Descarcă documentație
  // și clarificări") și urcă fișier cu fișier; dacă nu apucă tot într-o rulare
  // întoarce continua=true și reluăm de la indexul următor.
  const aduDinSeap = async () => {
    if (!licitatie.c_notice_id || !licitatie.sys_notice_type_id) {
      setWarn('⚠️ Licitația nu are identificatorii SEAP (c_notice_id / sys_notice_type_id). Se completează singuri la promovarea din 📡 Radar; pentru cele vechi, cere-i lui Claude să-i pună.')
      return
    }
    setWarn(null); setSeapBusy('mă conectez la SEAP...')
    let deLa = 0, runde = 0, adaugate = 0, completate = 0, mari = []
    while (runde < 12) {
      setSeapBusy(`descarc din SEAP${runde ? ` (continuare ${runde + 1})` : ''} — poate dura, arhiva are sute de MB...`)
      const { data, error } = await supabase.functions.invoke('ofertare-seap-import', {
        body: { licitatie_id: licitatie.id, de_la_index: deLa },
      })
      if (error || data?.error) { setWarn(`Eroare SEAP: ${data?.error || error.message}`); break }
      adaugate += data.adaugate || 0; completate += data.completate || 0
      if (data.sarite_mari?.length) mari = [...mari, ...data.sarite_mari]
      await load()
      if (!data.continua) {
        setWarn(`✅ Din SEAP: ${adaugate} documente noi${completate ? `, ${completate} completate` : ''}${data.sarite_existente ? `, ${data.sarite_existente} existau deja` : ''}.${mari.length ? ` Sărite (prea mari): ${mari.join(', ')}.` : ''}`)
        break
      }
      deLa = data.next_index; runde++
    }
    setSeapBusy(null); await load(); onChanged?.()
  }

  // Procesare secvențială cu continuare — un doc pe rând, apeluri repetate cât continua=true.
  // Robustețe (cerut de Razvan 26.08): eroarea pe un document primește AUTO-RETRY
  // (pauză + reîncercare — worker-ul edge crapă intermitent pe PDF-uri grele),
  // la finalul cozii se face O A DOUA TRECERE peste restanțe, iar dacă tot rămân
  // erori pleacă NOTIFICARE în clopoțel (nu doar un text care dispare de pe ecran).
  const proceseazaDoc = async (d, eticheta) => {
    let continua = true, runde = 0, incercariEsuate = 0
    while (continua && runde < 60 && !stopRef.current) {
      setProcBusy(`${eticheta} · ${d.nume_original.split('/').pop()} (rundă ${runde + 1})`)
      const { data, error } = await supabase.functions.invoke('ofertare-ingest-doc', { body: { doc_id: d.id } })
      if (error || data?.error) {
        incercariEsuate++
        if (incercariEsuate > 2) { setWarn(`Eroare persistentă la „${d.nume_original}": ${data?.error || error.message}`); return false }
        setProcBusy(`${eticheta} · ${d.nume_original.split('/').pop()} — reîncerc (${incercariEsuate}/2)...`)
        await new Promise(r => setTimeout(r, 5000))
        continue
      }
      incercariEsuate = 0
      continua = !!data?.continua
      runde++
    }
    return !continua
  }

  const proceseaza = async () => {
    const listaPdf = (ds) => (ds || []).filter(d => ['neprocesat', 'in_lucru', 'eroare'].includes(d.status_procesare) && /\.pdf$/i.test(d.nume_original))
    let deRulat = listaPdf(docs)
    if (!deRulat.length) return
    stopRef.current = false
    // 3 documente ÎN PARALEL (cerut de Razvan — serial dura ~90 min pe un fixture);
    // edge functions scalează orizontal, fiecare doc e independent
    const PARALEL = 3
    for (let trecere = 1; trecere <= 2 && deRulat.length && !stopRef.current; trecere++) {
      let urmatorul = 0
      const total = deRulat.length
      const lucrator = async () => {
        while (!stopRef.current) {
          const idx = urmatorul++
          if (idx >= total) return
          const d = deRulat[idx]
          await proceseazaDoc(d, `${trecere === 2 ? 'reluare ' : ''}${idx + 1}/${total} (3 în paralel)`)
          await load()
        }
      }
      await Promise.all(Array.from({ length: Math.min(PARALEL, total) }, () => lucrator()))
      // A doua trecere: doar restanțele (eroare / neterminate)
      const { data: fresh } = await supabase.from('ofertare_documente_atribuire')
        .select('id, nume_original, status_procesare').eq('licitatie_id', licitatie.id)
      deRulat = listaPdf(fresh)
    }
    // Restanțe după ambele treceri → notificare persistentă în clopoțel
    if (deRulat.length && !stopRef.current && profile?.id) {
      await supabase.from('notifications').insert({
        profile_id: profile.id, type: 'warning', modul: 'ofertare',
        title: `Ofertare: ${deRulat.length} documente neprocesate la ${licitatie.nr_anunt}`,
        message: `După 2 treceri au rămas cu probleme: ${deRulat.slice(0, 3).map(d => d.nume_original.split('/').pop()).join(', ')}${deRulat.length > 3 ? '…' : ''}. Deschide licitația și apasă „Procesează" din nou, sau cere-i lui Claude să le spargă în bucăți mai mici.`,
        link_to: '/ofertare',
      })
      setWarn(`⚠️ ${deRulat.length} documente au rămas neprocesate după 2 treceri — ai primit notificare în clopoțel.`)
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
        {/* Clopoțel separat pe secțiune (cerut de Razvan): erorile rămân vizibile
            oricând reintri în pagină, nu doar cât rulează procesarea */}
        {(docs || []).some(d => d.status_procesare === 'eroare') && (
          <span style={{ fontSize:11, fontWeight:800, color:G.red, background:G.red + '18', border:`1px solid ${G.red}66`, borderRadius:12, padding:'3px 10px' }}>
            🔔 {(docs || []).filter(d => d.status_procesare === 'eroare').length} cu erori — apasă Procesează pentru reluare
          </span>
        )}
        <div style={{ marginLeft:'auto', display:'flex', gap:8 }}>
          {!seapBusy && (
            <button style={{ ...S.btnP, padding:'7px 12px', fontSize:12 }} disabled={!!upBusy || !!procBusy} onClick={aduDinSeap}
              title="Descarcă singură toată documentația publicată în SEAP (inclusiv planșele de zeci de MB)">
              ⬇️ Adu din SEAP
            </button>
          )}
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
      {seapBusy && <div style={{ fontSize:12, color:G.ofertare, fontWeight:700, marginBottom:8 }}>⬇️ SEAP: {seapBusy}</div>}
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
// SECȚIUNE: REGISTRUL DE CERINȚE (E2)
// Extragere pe Opus (edge fn ofertare-cerinte, un apel/secțiune — II/III/IV/rest),
// insert cu confirmata_de NULL. Poarta E2 = confirmarea umană de aici.
// Bucla de corecție (ai_feedback): Confirm → verdict 'confirmat'; Corectez →
// diff-ul AI↔om cu verdict 'corectat' (devine few-shot la extracțiile viitoare
// pe aceeași autoritate); Respinge → 'respins' + rândul dispare.
// ════════════════════════════════════════════════════════════════
const TIP_CERINTA = {
  eliminatorie: { label:'ELIMINATORIE', color:G.red },
  propunere:    { label:'propunere',    color:G.blue },
  forma:        { label:'formă',        color:G.muted },
  contractuala: { label:'contractuală', color:G.purple },
}
const contextCheie = (autoritate) =>
  `ofertare-cerinte|fisa_date|${/romgaz/i.test(autoritate||'') ? 'romgaz' : /transgaz/i.test(autoritate||'') ? 'transgaz' : /conpet/i.test(autoritate||'') ? 'conpet' : 'alta'}`

function CerinteSection({ licitatie, profile, onChanged }) {
  const [cerinte, setCerinte] = useState(null)
  const [busy, setBusy] = useState(null)      // text progres extragere
  const [editId, setEditId] = useState(null)  // rând în editare
  const [editVal, setEditVal] = useState({})
  const [warn, setWarn] = useState(null)
  const [fTip, setFTip] = useState('')

  const load = async () => {
    const { data } = await supabase.from('ofertare_cerinte')
      .select('id, sursa_sectiune, text_cerinta, tip, lot, document_probant, cand_se_prezinta, confirmata_de, extras_de_ai')
      .eq('licitatie_id', licitatie.id).is('inlocuita_de', null)
      .order('sursa_sectiune').order('id')
    setCerinte(data || [])
  }
  useEffect(() => { load() }, [licitatie.id])

  const extrage = async () => {
    if (cerinte?.length && !window.confirm('Re-extragerea șterge cerințele NEconfirmate și le extrage din nou — din fișă ȘI din caiete/clarificări (cele confirmate rămân). Durează 15-25 min cu tot corpusul. Continui?')) return
    setWarn(null)
    const sectiuni = ['III', 'IV', 'II', 'rest']
    for (let i = 0; i < sectiuni.length; i++) {
      setBusy(`Opus citește fișa — secțiunea ${sectiuni[i]} (${i + 1}/4)...`)
      const { data, error } = await supabase.functions.invoke('ofertare-cerinte',
        { body: { licitatie_id: licitatie.id, sectiune: sectiuni[i], reset: i === 0 } })
      if (error || data?.error) { setWarn(`Secțiunea ${sectiuni[i]}: ${data?.error || error.message}`); setBusy(null); await load(); return }
      await load()
    }
    // Sweep pe corpus: caiete de sarcini + clarificări + „alta" procesate. Un original
    // spart în „— partea N" se sare (părțile îl înlocuiesc — cazul VOLUM III întreg).
    const { data: docs } = await supabase.from('ofertare_documente_atribuire')
      .select('id, nume_original, tip').eq('licitatie_id', licitatie.id)
      .eq('status_procesare', 'procesat').in('tip', ['cs_volum', 'raspuns_clarificare', 'clarificare', 'alta'])
      .order('id')
    const toateNumele = (docs || []).map(d => d.nume_original || '')
    const deCitit = (docs || []).filter(d => {
      const baza = (d.nume_original || '').replace(/\.pdf$/i, '')
      return !toateNumele.some(n => n !== d.nume_original && n.startsWith(baza + ' — partea'))
    })
    let esecuri = 0
    for (let i = 0; i < deCitit.length; i++) {
      const d = deCitit[i]
      setBusy(`Opus citește caietele/clarificările: ${i + 1}/${deCitit.length} · ${(d.nume_original || '').split('/').pop()}`)
      const { data, error } = await supabase.functions.invoke('ofertare-cerinte',
        { body: { licitatie_id: licitatie.id, doc_id: d.id } })
      if (error || data?.error) {
        esecuri++
        if (esecuri >= 3) { setWarn(`Prea multe erori la caiete (ultima: ${data?.error || error.message}) — restul se reiau mai târziu cu „Re-extrage".`); break }
        continue
      }
      await load()
    }
    setBusy(null); await load(); onChanged?.()
  }

  const feedback = async (c, verdict, corectat) => {
    await supabase.from('ai_feedback').insert({
      function_name: 'ofertare-cerinte', context_cheie: contextCheie(licitatie.autoritate),
      ref_table: 'ofertare_cerinte', ref_id: c.id,
      output_ai: { sursa_sectiune: c.sursa_sectiune, text_cerinta: c.text_cerinta, tip: c.tip, document_probant: c.document_probant },
      verdict, output_corectat: corectat || null,
      corectat_de: profile?.id || null, corectat_la: new Date().toISOString(),
    })
  }

  const confirma = async (c) => {
    await feedback(c, 'confirmat')
    await supabase.from('ofertare_cerinte').update({ confirmata_de: profile.id, confirmata_la: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', c.id)
    await load(); onChanged?.()
  }
  const salveazaCorectia = async (c) => {
    const nou = { sursa_sectiune: editVal.sursa_sectiune?.trim() || c.sursa_sectiune, text_cerinta: editVal.text_cerinta?.trim() || c.text_cerinta, tip: editVal.tip || c.tip, document_probant: editVal.document_probant?.trim() || null }
    await feedback(c, 'corectat', nou)
    await supabase.from('ofertare_cerinte').update({ ...nou, confirmata_de: profile.id, confirmata_la: new Date().toISOString(), extras_de_ai: false, updated_at: new Date().toISOString() }).eq('id', c.id)
    setEditId(null); await load(); onChanged?.()
  }
  const respinge = async (c) => {
    if (!window.confirm('Respingi cerința? (dispare din registru; respingerea se ține minte ca feedback)')) return
    await feedback(c, 'respins')
    await supabase.from('ofertare_cerinte').delete().eq('id', c.id)
    await load(); onChanged?.()
  }
  // Poarta E2 — confirmă tot ce a rămas neconfirmat, dintr-un click (după ce ai citit lista)
  const confirmaTot = async () => {
    const rest = (cerinte || []).filter(c => !c.confirmata_de)
    if (!rest.length) return
    if (!window.confirm(`Confirmi TOATE cele ${rest.length} cerințe neconfirmate? (poarta E2 — registrul devine oficial)`)) return
    setBusy('Se confirmă registrul...')
    for (const c of rest) await feedback(c, 'confirmat')
    await supabase.from('ofertare_cerinte').update({ confirmata_de: profile.id, confirmata_la: new Date().toISOString() })
      .eq('licitatie_id', licitatie.id).is('confirmata_de', null)
    setBusy(null); await load(); onChanged?.()
  }

  const filtrate = (cerinte || []).filter(c => !fTip || c.tip === fTip)
  const neconfirmate = (cerinte || []).filter(c => !c.confirmata_de).length

  return (
    <div style={{ marginTop:14, padding:14, borderRadius:10, border:`1px solid ${G.border}`, background:G.bg }}>
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10, flexWrap:'wrap' }}>
        <div style={{ fontSize:13, fontWeight:800 }}>📋 Registrul de cerințe {cerinte ? `(${cerinte.length}${neconfirmate ? ` · ${neconfirmate} neconfirmate` : ' · ✅ confirmat'})` : ''}</div>
        <div style={{ marginLeft:'auto', display:'flex', gap:8, alignItems:'center' }}>
          <select style={{ ...S.input, width:'auto', padding:'6px 10px', fontSize:12 }} value={fTip} onChange={e => setFTip(e.target.value)}>
            <option value="">toate tipurile</option>
            {Object.entries(TIP_CERINTA).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          {!busy && <button style={{ ...S.btnS, padding:'7px 12px', fontSize:12 }} onClick={extrage}>🤖 {cerinte?.length ? 'Re-extrage' : 'Extrage cerințele'} (Opus)</button>}
          {!busy && neconfirmate > 0 && <button style={{ ...S.btnP, padding:'7px 12px', fontSize:12 }} onClick={confirmaTot}>✅ Confirmă registrul ({neconfirmate})</button>}
        </div>
      </div>
      {busy && <div style={{ fontSize:12, color:G.ofertare, fontWeight:700, marginBottom:8 }}>🤖 {busy}</div>}
      {warn && <div style={{ fontSize:12, color:G.red, marginBottom:8 }}>{warn}</div>}

      {cerinte === null ? <div style={{ fontSize:12, color:G.muted }}>Se încarcă...</div> :
        !cerinte.length ? (
          <div style={{ fontSize:12, color:G.dim }}>Niciun rând încă. „🤖 Extrage cerințele" citește cu Opus fișa de date (secțiunile III, IV, II + restul) și apoi TOATE caietele de sarcini + clarificările procesate — apoi tu confirmi/corectezi fiecare rând. Corecțiile tale devin exemple pentru extracțiile viitoare.</div>
        ) : (
          <div style={{ maxHeight:340, overflowY:'auto', display:'flex', flexDirection:'column', gap:4 }}>
            {filtrate.map(c => {
              const t = TIP_CERINTA[c.tip] || TIP_CERINTA.propunere
              const inEdit = editId === c.id
              return (
                <div key={c.id} style={{ padding:'7px 10px', borderRadius:7, background:G.surface, borderLeft:`3px solid ${c.confirmata_de ? G.green : t.color}` }}>
                  <div style={{ display:'flex', alignItems:'flex-start', gap:8, flexWrap:'wrap' }}>
                    <span style={{ fontSize:10.5, fontWeight:800, color:t.color, background:t.color + '18', border:`1px solid ${t.color}55`, borderRadius:10, padding:'2px 8px', whiteSpace:'nowrap' }}>{t.label}</span>
                    <span style={{ fontSize:11, color:G.muted, fontWeight:700, whiteSpace:'nowrap' }}>{c.sursa_sectiune}{c.lot && c.lot !== 'toate' ? ` · lot ${c.lot}` : ''}</span>
                    {!inEdit && <span style={{ flex:1, fontSize:12.5, minWidth:220 }}>{c.text_cerinta}</span>}
                    {!inEdit && (
                      <span style={{ display:'flex', gap:5, marginLeft:'auto' }}>
                        {c.confirmata_de ? <span style={{ fontSize:11, color:G.green, fontWeight:700 }}>✓</span> : (<>
                          <button title="Confirm" onClick={() => confirma(c)} style={{ ...S.btnS, padding:'3px 9px', fontSize:11, color:G.green, borderColor:G.green + '66' }}>✓</button>
                          <button title="Corectez" onClick={() => { setEditId(c.id); setEditVal({ sursa_sectiune: c.sursa_sectiune, text_cerinta: c.text_cerinta, tip: c.tip, document_probant: c.document_probant || '' }) }} style={{ ...S.btnS, padding:'3px 9px', fontSize:11, color:G.orange, borderColor:G.orange + '66' }}>✏️</button>
                          <button title="Resping" onClick={() => respinge(c)} style={{ ...S.btnS, padding:'3px 9px', fontSize:11, color:G.red, borderColor:G.red + '66' }}>✕</button>
                        </>)}
                      </span>
                    )}
                  </div>
                  {c.document_probant && !inEdit && <div style={{ fontSize:11, color:G.dim, marginTop:3 }}>📄 {c.document_probant}{c.cand_se_prezinta ? ` · ${c.cand_se_prezinta}` : ''}</div>}
                  {inEdit && (
                    <div style={{ marginTop:8, display:'flex', flexDirection:'column', gap:6 }}>
                      <textarea style={{ ...S.input, minHeight:54, resize:'vertical' }} value={editVal.text_cerinta} onChange={e => setEditVal(v => ({ ...v, text_cerinta: e.target.value }))} />
                      <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                        <input style={{ ...S.input, maxWidth:120 }} value={editVal.sursa_sectiune} onChange={e => setEditVal(v => ({ ...v, sursa_sectiune: e.target.value }))} placeholder="secțiune" />
                        <select style={{ ...S.input, maxWidth:150 }} value={editVal.tip} onChange={e => setEditVal(v => ({ ...v, tip: e.target.value }))}>
                          {Object.entries(TIP_CERINTA).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                        </select>
                        <input style={{ ...S.input, flex:1, minWidth:160 }} value={editVal.document_probant} onChange={e => setEditVal(v => ({ ...v, document_probant: e.target.value }))} placeholder="document probant" />
                        <button style={{ ...S.btnP, padding:'7px 12px', fontSize:12 }} onClick={() => salveazaCorectia(c)}>💾 Salvează corecția</button>
                        <button style={{ ...S.btnS, padding:'7px 12px', fontSize:12 }} onClick={() => setEditId(null)}>Anulează</button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// SECȚIUNE: ACOPERIREA CERINȚELOR (E3) — cine acoperă fiecare cerință
// Opus propune din catalogul REAL (hr_autorizatii + parteneri); omul verifică
// pe scan (R1 — CHECK în BD: verificat cere fișier; scanul vine din autorizație).
// Golurile devin tichete (modelul TKT-2026-0139). Poarta E3: zero eliminatorii GOL.
// ════════════════════════════════════════════════════════════════
const ACOPERIRE_STATUS = {
  acoperit:          { label:'✅ acoperit',  color:G.green },
  acoperit_partener: { label:'🤝 partener',  color:G.teal },
  gol:               { label:'🔴 GOL',       color:G.red },
}

function AcoperireSection({ licitatie, profile, onChanged }) {
  const [cerinte, setCerinte] = useState(null)
  const [acoperiri, setAcoperiri] = useState({})   // cerinta_id -> rând acoperire (+ autorizația join)
  const [busy, setBusy] = useState(null)
  const [warn, setWarn] = useState(null)
  const [fDoarGoluri, setFDoarGoluri] = useState(false)

  const load = async () => {
    const { data: cs } = await supabase.from('ofertare_cerinte')
      .select('id, sursa_sectiune, text_cerinta, tip, lot')
      .eq('licitatie_id', licitatie.id).is('inlocuita_de', null)
      .in('tip', ['eliminatorie', 'propunere']).order('tip').order('sursa_sectiune')
    setCerinte(cs || [])
    if (cs?.length) {
      const { data: ac } = await supabase.from('ofertare_acoperire')
        .select('*, autorizatie:hr_autorizatii(id, numar_autorizatie, fisier_path, tip:hr_autorizatii_tipuri(denumire), emp:employees(name), ext:hr_personal_extern(nume)), partener:ofertare_parteneri(nume), doc_firma:documente_firma(id, tip, denumire, numar_document, pdf_path)')
        .in('cerinta_id', cs.map(c => c.id))
      const map = {}; (ac || []).forEach(a => { map[a.cerinta_id] = a })
      setAcoperiri(map)
    } else setAcoperiri({})
  }
  useEffect(() => { load() }, [licitatie.id])

  const propune = async () => {
    setWarn(null)
    // Felii de 55 (v3 cu ids) — registrul întreg nu încape în max_tokens la un singur apel.
    // O felie raportată „trunchiat" se reia la jumătate de mărime (o singură dată).
    const FELIE = 55
    for (const batch of ['eliminatorie', 'propunere']) {
      const ids = (cerinte || []).filter(c => c.tip === batch).map(c => c.id)
      if (!ids.length) continue
      const eticheta = batch === 'eliminatorie' ? 'eliminatoriile' : 'propunerile'
      const deReluat = []
      for (let i = 0; i < ids.length; i += FELIE) {
        const felie = ids.slice(i, i + FELIE)
        setBusy(`Opus confruntă ${eticheta} cu catalogul HR: ${Math.min(i + FELIE, ids.length)}/${ids.length}...`)
        const { data, error } = await supabase.functions.invoke('ofertare-acoperire',
          { body: { licitatie_id: licitatie.id, batch, ids: felie } })
        if (error || data?.error) { setWarn(`${batch}: ${data?.error || error.message}`); setBusy(null); await load(); onChanged?.(); return }
        if (data?.trunchiat) deReluat.push(...felie)
        await load()
      }
      for (let i = 0; i < deReluat.length; i += 27) {
        const felie = deReluat.slice(i, i + 27)
        setBusy(`Reluare felii trunchiate (${eticheta}): ${Math.min(i + 27, deReluat.length)}/${deReluat.length}...`)
        const { data, error } = await supabase.functions.invoke('ofertare-acoperire',
          { body: { licitatie_id: licitatie.id, batch, ids: felie } })
        if (error || data?.error) { setWarn(`${batch} (reluare): ${data?.error || error.message}`); break }
        await load()
      }
    }
    setBusy(null); await load(); onChanged?.()
  }

  // R1: verificarea copiază scanul autorizației în acoperire — fără scan nu se poate
  const verifica = async (a) => {
    const scan = a.autorizatie?.fisier_path
    if (!scan) { setWarn('Autorizația nu are scan încărcat în HR — încarcă scanul acolo întâi (R1).'); return }
    const { error } = await supabase.from('ofertare_acoperire').update({
      verificat_pe_scan: true, fisier_path: scan, verificat_de: profile?.id || null,
      verificat_la: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('id', a.id)
    if (error) { setWarn('Eroare: ' + error.message); return }
    await load(); onChanged?.()
  }

  const creeazaTichet = async (c, a) => {
    const eElim = c.tip === 'eliminatorie'
    const { data: tkt, error } = await supabase.from('tichete').insert({
      departament: 'hr', subcategorie: 'altele',
      titlu: `${eElim ? '🚫 ELIMINATORIE — ' : ''}Gol ofertare: ${c.text_cerinta.slice(0, 80)}`,
      descriere: `Cerință neacoperită la licitația ${licitatie.nr_anunt} (${licitatie.autoritate}), sursa ${c.sursa_sectiune}:\n\n„${c.text_cerinta}"\n\nMotiv AI: ${a?.referinta_text || '—'}\n\nGenerat din modulul Ofertare (E3).`,
      urgenta: 'normal', status: 'deschis', deschis_de: profile?.id || null,
      entitate_tip: 'altele', entitate_descriere: `Licitație ${licitatie.nr_anunt}`,
    }).select('id, numar_tichet').single()
    if (error) { setWarn('Tichet: ' + error.message); return }
    if (a) await supabase.from('ofertare_acoperire').update({ tichet_id: tkt.id, updated_at: new Date().toISOString() }).eq('id', a.id)
    setWarn(`🎫 ${tkt.numar_tichet} creat pentru gol.`)
    await load()
  }

  const stats = { acoperit: 0, acoperit_partener: 0, gol: 0, neevaluate: 0, goluriElim: 0 }
  ;(cerinte || []).forEach(c => {
    const a = acoperiri[c.id]
    if (!a) { stats.neevaluate++; return }
    stats[a.status] = (stats[a.status] || 0) + 1
    if (a.status === 'gol' && c.tip === 'eliminatorie') stats.goluriElim++
  })
  const randuri = (cerinte || []).filter(c => !fDoarGoluri || acoperiri[c.id]?.status === 'gol')

  return (
    <div style={{ marginTop:14, padding:14, borderRadius:10, border:`1px solid ${G.border}`, background:G.bg }}>
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10, flexWrap:'wrap' }}>
        <div style={{ fontSize:13, fontWeight:800 }}>🎯 Acoperirea cerințelor</div>
        {cerinte?.length > 0 && (
          <span style={{ fontSize:11.5, color:G.muted }}>
            ✅ {stats.acoperit} · 🤝 {stats.acoperit_partener} · 🔴 {stats.gol} goluri · ⬜ {stats.neevaluate} neevaluate
            {stats.goluriElim > 0 && <b style={{ color:G.red }}> · {stats.goluriElim} ELIMINATORII neacoperite!</b>}
          </span>
        )}
        <div style={{ marginLeft:'auto', display:'flex', gap:8, alignItems:'center' }}>
          <label style={{ fontSize:11.5, color:G.muted, display:'flex', alignItems:'center', gap:5, cursor:'pointer' }}>
            <input type="checkbox" checked={fDoarGoluri} onChange={e => setFDoarGoluri(e.target.checked)} style={{ accentColor:G.red }} /> doar goluri
          </label>
          {!busy && <button style={{ ...S.btnP, padding:'7px 12px', fontSize:12 }} onClick={propune}>🤖 Propune acoperiri (Opus)</button>}
        </div>
      </div>
      {busy && <div style={{ fontSize:12, color:G.ofertare, fontWeight:700, marginBottom:8 }}>🤖 {busy}</div>}
      {warn && <div style={{ fontSize:12, color:G.orange, marginBottom:8 }}>{warn}</div>}

      {cerinte === null ? <div style={{ fontSize:12, color:G.muted }}>Se încarcă...</div> :
        !cerinte.length ? <div style={{ fontSize:12, color:G.dim }}>Întâi extrage registrul de cerințe (secțiunea de mai sus) — apoi aici Opus îl confruntă cu autorizațiile din HR și partenerii.</div> :
        (
          <div style={{ maxHeight:320, overflowY:'auto', display:'flex', flexDirection:'column', gap:4 }}>
            {randuri.map(c => {
              const a = acoperiri[c.id]
              const st = a ? (ACOPERIRE_STATUS[a.status] || ACOPERIRE_STATUS.gol) : null
              const titular = a?.doc_firma ? 'GAZPET INSTAL (firmă)' : (a?.autorizatie ? (a.autorizatie.emp?.name || a.autorizatie.ext?.nume) : a?.partener?.nume)
              return (
                <div key={c.id} style={{ padding:'7px 10px', borderRadius:7, background:G.surface, borderLeft:`3px solid ${a ? st.color : G.border2}` }}>
                  <div style={{ display:'flex', alignItems:'flex-start', gap:8, flexWrap:'wrap' }}>
                    <span style={{ fontSize:10.5, fontWeight:800, color: a ? st.color : G.dim, whiteSpace:'nowrap', minWidth:82 }}>{a ? st.label : '⬜ neevaluat'}</span>
                    {c.tip === 'eliminatorie' && <span style={{ fontSize:10, fontWeight:800, color:G.red, border:`1px solid ${G.red}55`, borderRadius:8, padding:'1px 6px' }}>ELIM</span>}
                    <span style={{ fontSize:11, color:G.muted, fontWeight:700, whiteSpace:'nowrap' }}>{c.sursa_sectiune}</span>
                    <span style={{ flex:1, fontSize:12.5, minWidth:200 }}>{c.text_cerinta}</span>
                    <span style={{ display:'flex', gap:5, marginLeft:'auto', alignItems:'center' }}>
                      {a && a.status !== 'gol' && !a.verificat_pe_scan && (
                        <button title={a.autorizatie?.fisier_path ? 'Verificat pe scan (R1) — copiază scanul autorizației' : 'Autorizația nu are scan în HR'}
                          onClick={() => verifica(a)} style={{ ...S.btnS, padding:'3px 9px', fontSize:11, color:G.green, borderColor:G.green + '66', opacity: a.autorizatie?.fisier_path ? 1 : .45 }}>👁 Verificat</button>
                      )}
                      {a?.verificat_pe_scan && <span style={{ fontSize:11, color:G.green, fontWeight:700 }} title="Verificat pe scan">✓✓</span>}
                      {a && a.status === 'gol' && !a.tichet_id && (
                        <button title="Golul devine tichet" onClick={() => creeazaTichet(c, a)} style={{ ...S.btnS, padding:'3px 9px', fontSize:11, color:G.orange, borderColor:G.orange + '66' }}>🎫 Tichet</button>
                      )}
                      {a?.tichet_id && <span style={{ fontSize:11, color:G.orange, fontWeight:700 }} title="Are tichet deschis">🎫</span>}
                    </span>
                  </div>
                  {a && (titular || a.referinta_text) && (
                    <div style={{ fontSize:11, color:G.dim, marginTop:3 }}>
                      {titular && <b style={{ color:G.text }}>{titular}</b>}
                      {a.autorizatie?.tip?.denumire && <> · {a.autorizatie.tip.denumire}{a.autorizatie.numar_autorizatie ? ` nr. ${a.autorizatie.numar_autorizatie}` : ''}</>}
                      {a.doc_firma && <> · {a.doc_firma.tip}{a.doc_firma.numar_document ? ` nr. ${a.doc_firma.numar_document}` : ''}</>}
                      {a.valabil_la_depunere === false && <b style={{ color:G.red }}> · EXPIRĂ înainte de depunere!</b>}
                      {a.referinta_text && <> — {a.referinta_text}</>}
                    </div>
                  )}
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
        <DocumenteSection licitatie={l} profile={profile} />

        {/* E2: registrul de cerințe — Opus + confirmarea umană (poarta) + ai_feedback */}
        <CerinteSection licitatie={l} profile={profile} />

        {/* E3: acoperirea cerințelor — catalog HR + parteneri, goluri ca tichete */}
        <AcoperireSection licitatie={l} profile={profile} />

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

// ════════════════════════════════════════════════════════════════
// CATALOG EXPERIENȚĂ SIMILARĂ (ofertare_experienta)
// Sursa: Calificare/EXPERIENTA SIMILARA rev.1/ de pe NAS — un dosar pe lucrare
// (fișă, contract, PV recepție, DC, recomandare). Convenția valorilor: numărul
// din numele folderului = mii lei (excepția Bentu = lei, notată în observații).
// Fereastra de invocare (uzual 5 ani din termenul de depunere — Instrucțiunea
// ANAP 2/2017 art. 13) se calculează aici; combinația bifată se verifică pe
// prag valoric + număr maxim de contracte. La lucrările în ASOCIERE se invocă
// doar cota Gazpet — se verifică în fișa lucrării înainte de depunere.
// ════════════════════════════════════════════════════════════════
const TIP_PV_OPT = ['PVRTL', 'PV final', 'PV partial', 'PV PIF', 'PV']
const fmtLei = v => (v || v === 0) ? new Intl.NumberFormat('ro-RO', { maximumFractionDigits: 2 }).format(v) : '—'
const fmtZi = d => d ? new Date(d + (d.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('ro-RO') : '—'

function ExperientaCatalog({ licitatii, profile, showToast }) {
  const [lucrari, setLucrari] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [editRow, setEditRow] = useState(null)
  const [termenRef, setTermenRef] = useState(() => new Date().toISOString().slice(0, 10))
  const [aniFereastra, setAniFereastra] = useState('5')
  const [prag, setPrag] = useState('29000000')
  const [maxCtr, setMaxCtr] = useState('3')
  const [sel, setSel] = useState(() => new Set())
  const [arataInactive, setArataInactive] = useState(false)
  // Regula valorii invocate (practica beneficiarilor): la Transgaz/Romgaz/Conpet se ia
  // valoarea TOTALĂ a contractului; la distribuții (primării) valoarea EXECUTATĂ real.
  const [regulaVal, setRegulaVal] = useState('totala')   // totala | executata
  const valInv = (l) => regulaVal === 'executata' ? (Number(l.valoare_executata_lei) || Number(l.valoare_lei) || 0) : (Number(l.valoare_lei) || 0)

  const load = async () => {
    const { data, error } = await supabase.from('ofertare_experienta').select('*')
    if (error) { showToast('Eroare la încărcarea catalogului: ' + error.message, 'err'); return }
    setLucrari(data || [])
  }
  useEffect(() => { load() }, [])

  const inceput = (() => { const d = new Date(termenRef + 'T00:00:00'); d.setFullYear(d.getFullYear() - (Number(aniFereastra) || 5)); return d })()
  const inFereastra = (l) => !!l.data_pv && new Date(l.data_pv + 'T12:00:00') >= inceput && new Date(l.data_pv + 'T00:00:00') <= new Date(termenRef + 'T23:59:59')

  const vizibile = (lucrari || []).filter(l => arataInactive || l.activ)
  // Ordinea: în fereastră (valoare desc) → ieșite din fereastră → fără dată PV
  const ordonate = [...vizibile].sort((a, b) => {
    const g = l => l.data_pv ? (inFereastra(l) ? 0 : 1) : 2
    return g(a) - g(b) || valInv(b) - valInv(a)
  })
  const nrFereastra = vizibile.filter(inFereastra).length

  const toggleSel = (id) => setSel(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const selectate = vizibile.filter(l => sel.has(l.id))
  const totalSel = selectate.reduce((s, l) => s + valInv(l), 0)
  const pragN = Number(prag) || 0
  const maxN = Number(maxCtr) || 3
  const selOK = selectate.length > 0 && selectate.length <= maxN && totalSel >= pragN
  const selAsocieri = selectate.filter(l => l.asociere)
  const selPartiale = selectate.filter(l => (l.tip_pv || '').toLowerCase().includes('partial'))
  // la regula "executată", asocierile fără cota Gazpet completată intră cu valoarea totală — pericol la evaluare
  const selFaraCota = regulaVal === 'executata' ? selectate.filter(l => l.asociere && !l.valoare_executata_lei) : []

  const salveaza = async (form) => {
    const payload = {
      denumire: form.denumire.trim(),
      beneficiar: form.beneficiar.trim() || null,
      valoare_lei: form.valoare_lei !== '' ? Number(form.valoare_lei) : null,
      valoare_executata_lei: form.valoare_executata_lei !== '' ? Number(form.valoare_executata_lei) : null,
      data_pv: form.data_pv || null,
      tip_pv: form.tip_pv || null,
      piese: form.piese.trim() || null,
      folder_nas: form.folder_nas.trim() || null,
      dosar_sursa_path: form.dosar_sursa_path.trim() || null,
      asociere: !!form.asociere,
      observatii: form.observatii.trim() || null,
      activ: !!form.activ,
      updated_at: new Date().toISOString(),
    }
    const { error } = editRow
      ? await supabase.from('ofertare_experienta').update(payload).eq('id', editRow.id)
      : await supabase.from('ofertare_experienta').insert(payload)
    if (error) { showToast('Eroare la salvare: ' + error.message, 'err'); return false }
    showToast(editRow ? 'Lucrare actualizată.' : `Lucrare adăugată — ${payload.denumire}.`)
    setShowForm(false); setEditRow(null)
    await load()
    return true
  }

  const sterge = async (l) => {
    if (!profile?.is_owner) return
    if (!window.confirm(`Ștergi „${l.denumire}" din catalog? IREVERSIBIL — de regulă e mai sigur să o faci inactivă.`)) return
    const { error } = await supabase.from('ofertare_experienta').delete().eq('id', l.id)
    if (error) { showToast('Eroare: ' + error.message, 'err'); return }
    showToast(`🗑 „${l.denumire}" ștearsă.`, 'warn')
    setShowForm(false); setEditRow(null)
    setSel(s => { const n = new Set(s); n.delete(l.id); return n })
    await load()
  }

  const cuTermen = (licitatii || []).filter(x => x.termen_depunere)

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14, flexWrap:'wrap', gap:10 }}>
        <div>
          <div style={{ fontSize:19, fontWeight:800 }}>📚 Experiență similară</div>
          <div style={{ fontSize:12, color:G.muted }}>
            Catalogul lucrărilor executate — dosarele din <b>Calificare\EXPERIENTA SIMILARA rev.1</b> de pe NAS. Bifează lucrările pe care le invoci și compară cu pragul licitației.
          </div>
        </div>
        <button style={S.btnP} onClick={() => { setEditRow(null); setShowForm(true) }}>＋ Lucrare</button>
      </div>

      {/* Fereastra de invocare + pragul licitației */}
      <div style={{ ...S.card, padding:14, marginBottom:12 }}>
        <div style={{ display:'flex', gap:12, flexWrap:'wrap', alignItems:'flex-end' }}>
          <div><label style={S.lbl}>Termen depunere (referință)</label>
            <input style={{ ...S.input, width:150 }} type="date" value={termenRef} onChange={e => e.target.value && setTermenRef(e.target.value)} /></div>
          {cuTermen.length > 0 && (
            <div><label style={S.lbl}>Preia din licitație</label>
              <select style={{ ...S.input, width:190 }} value="" onChange={e => {
                const x = cuTermen.find(y => String(y.id) === e.target.value)
                if (!x) return
                setTermenRef(x.termen_depunere.slice(0, 10))
                // regula valorii după segmentul licitației țintă
                const seg = x.segment || detectSegment(x.autoritate, x.obiect)
                setRegulaVal(['transgaz', 'romgaz', 'conpet'].includes(seg) ? 'totala' : 'executata')
              }}>
                <option value="">alege...</option>
                {cuTermen.map(x => <option key={x.id} value={x.id}>{x.nr_anunt} · {fmtZi(x.termen_depunere.slice(0, 10))}</option>)}
              </select></div>
          )}
          <div><label style={S.lbl}>Valoare invocată</label>
            <select style={{ ...S.input, width:230 }} value={regulaVal} onChange={e => setRegulaVal(e.target.value)}>
              <option value="totala">totală contract (Transgaz/Romgaz/Conpet)</option>
              <option value="executata">executată Gazpet (distribuții/primării)</option>
            </select></div>
          <div><label style={S.lbl}>Fereastră (ani)</label>
            <input style={{ ...S.input, width:70 }} type="number" min="1" max="15" value={aniFereastra} onChange={e => setAniFereastra(e.target.value)} /></div>
          <div><label style={S.lbl}>Prag valoare (lei fără TVA)</label>
            <input style={{ ...S.input, width:150 }} type="number" min="0" value={prag} onChange={e => setPrag(e.target.value)} /></div>
          <div><label style={S.lbl}>Max. contracte</label>
            <input style={{ ...S.input, width:70 }} type="number" min="1" max="10" value={maxCtr} onChange={e => setMaxCtr(e.target.value)} /></div>
          <div style={{ fontSize:12, color:G.muted, paddingBottom:9 }}>
            Fereastra: <b style={{ color:G.text }}>{fmtZi(inceput.toISOString().slice(0, 10))} → {fmtZi(termenRef)}</b> · {nrFereastra}/{vizibile.length} lucrări în fereastră
          </div>
        </div>

        {/* Combinația bifată vs. cerință */}
        {selectate.length > 0 && (
          <div style={{ marginTop:12, padding:'10px 14px', borderRadius:8, display:'flex', gap:14, alignItems:'center', flexWrap:'wrap',
            border:`1px solid ${selOK ? G.green : G.red}66`, background:(selOK ? G.green : G.red) + '11' }}>
            <span style={{ fontSize:13, fontWeight:800, color: selOK ? G.green : G.red }}>
              {selOK ? '✅' : '❌'} Selecție: {selectate.length}/{maxN} contracte · {fmtLei(totalSel)} lei
            </span>
            <span style={{ fontSize:12, color:G.muted }}>prag {fmtLei(pragN)} lei — {totalSel >= pragN ? `peste cu ${fmtLei(totalSel - pragN)}` : `lipsesc ${fmtLei(pragN - totalSel)}`}</span>
            {selectate.length > maxN && <span style={{ fontSize:12, color:G.red, fontWeight:700 }}>prea multe contracte!</span>}
            {regulaVal === 'totala' && selAsocieri.length > 0 && <span style={{ fontSize:12, color:G.muted }}>ℹ {selAsocieri.length} în asociere — la Transgaz/Romgaz/Conpet se invocă valoarea totală (practica acceptată)</span>}
            {selFaraCota.length > 0 && <span style={{ fontSize:12, color:G.red, fontWeight:700 }}>⚠ {selFaraCota.length} în asociere FĂRĂ cota executată completată — intră cu totalul, risc la evaluare!</span>}
            {regulaVal === 'executata' && selAsocieri.length > selFaraCota.length && <span style={{ fontSize:12, color:G.orange, fontWeight:700 }}>⚠ asocieri invocate cu cota Gazpet</span>}
            {selPartiale.length > 0 && <span style={{ fontSize:12, color:G.orange, fontWeight:700 }}>⚠ {selPartiale.length} cu recepție parțială</span>}
            <button style={{ ...S.btnS, padding:'4px 10px', fontSize:11, marginLeft:'auto' }} onClick={() => setSel(new Set())}>golește</button>
          </div>
        )}
      </div>

      {lucrari === null && <div style={{ padding:30, textAlign:'center', color:G.muted }}>Se încarcă catalogul...</div>}
      {lucrari !== null && !ordonate.length && (
        <div style={{ ...S.card, padding:30, textAlign:'center', color:G.dim, fontSize:13 }}>Catalogul e gol — adaugă lucrări cu „＋ Lucrare".</div>
      )}

      <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
        {ordonate.map(l => {
          const inWin = inFereastra(l)
          const faraData = !l.data_pv
          return (
            <div key={l.id} style={{ ...S.card, padding:'9px 12px', opacity: l.activ ? (inWin ? 1 : .55) : .35,
              borderLeft:`3px solid ${faraData ? G.orange : inWin ? G.green : G.border}` }}>
              <div style={{ display:'flex', alignItems:'center', gap:9, flexWrap:'wrap' }}>
                <input type="checkbox" checked={sel.has(l.id)} disabled={!inWin} onChange={() => toggleSel(l.id)}
                  title={inWin ? 'Include în combinația invocată' : 'În afara ferestrei — nu se poate invoca'} style={{ accentColor:G.green, cursor: inWin ? 'pointer' : 'not-allowed' }} />
                <span style={{ fontWeight:800, fontSize:13.5 }}>{l.denumire}</span>
                {l.beneficiar && <span style={{ fontSize:11, color:G.blue, fontWeight:700, border:`1px solid ${G.blue}44`, borderRadius:10, padding:'1px 8px', whiteSpace:'nowrap' }}>{l.beneficiar}</span>}
                {l.asociere && <span style={{ fontSize:10.5, color:G.orange, fontWeight:800, border:`1px solid ${G.orange}55`, borderRadius:10, padding:'1px 7px', whiteSpace:'nowrap' }} title="Executată în asociere — se invocă doar cota Gazpet">⚠ asociere</span>}
                {(l.tip_pv || '').toLowerCase().includes('partial') && <span style={{ fontSize:10.5, color:G.orange, fontWeight:800, whiteSpace:'nowrap' }}>recepție parțială</span>}
                {faraData && <span style={{ fontSize:10.5, color:G.orange, fontWeight:800, whiteSpace:'nowrap' }}>fără dată PV!</span>}
                {!l.activ && <span style={{ fontSize:10.5, color:G.dim, fontWeight:800 }}>inactivă</span>}
                <span style={{ marginLeft:'auto', display:'flex', gap:10, alignItems:'center', whiteSpace:'nowrap' }}>
                  <span style={{ textAlign:'right' }}>
                    <span style={{ fontSize:13.5, fontWeight:800, color: inWin ? G.green : G.muted }}>{fmtLei(valInv(l))} lei</span>
                    {regulaVal === 'executata' && l.valoare_executata_lei && Number(l.valoare_executata_lei) !== Number(l.valoare_lei) && (
                      <span style={{ display:'block', fontSize:10, color:G.dim }}>executat · contract {fmtLei(l.valoare_lei)}</span>
                    )}
                    {regulaVal === 'executata' && l.asociere && !l.valoare_executata_lei && (
                      <span style={{ display:'block', fontSize:10, color:G.red, fontWeight:700 }}>cota Gazpet necompletată!</span>
                    )}
                  </span>
                  <span style={{ fontSize:11.5, color:G.muted }}>{l.tip_pv || 'PV'} {fmtZi(l.data_pv)}</span>
                  <button title="Editează" onClick={() => { setEditRow(l); setShowForm(true) }}
                    style={{ ...S.btnS, padding:'3px 9px', fontSize:11 }}>✏️</button>
                </span>
              </div>
              <div style={{ fontSize:11, color:G.dim, marginTop:3, display:'flex', gap:12, flexWrap:'wrap' }}>
                {l.piese && <span>🗂 {l.piese}</span>}
                {l.folder_nas && <span title={'Calificare\\EXPERIENTA SIMILARA rev.1\\' + l.folder_nas} style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:420 }}>📁 {l.folder_nas}</span>}
                {l.observatii && <span style={{ color:G.muted }} title={l.observatii}>💬 {l.observatii.length > 110 ? l.observatii.slice(0, 110) + '…' : l.observatii}</span>}
              </div>
            </div>
          )
        })}
      </div>

      <div style={{ display:'flex', gap:14, alignItems:'center', marginTop:10, fontSize:11.5, color:G.dim, flexWrap:'wrap' }}>
        <span>Convenție NAS: numărul din numele folderului = valoarea în <b>mii lei</b>.</span>
        <label style={{ display:'flex', alignItems:'center', gap:5, cursor:'pointer', marginLeft:'auto' }}>
          <input type="checkbox" checked={arataInactive} onChange={e => setArataInactive(e.target.checked)} style={{ accentColor:G.dim }} /> arată și inactivele
        </label>
      </div>

      {showForm && (
        <ExperientaFormModal lucrare={editRow} profile={profile}
          onClose={() => { setShowForm(false); setEditRow(null) }} onSave={salveaza} onDelete={sterge} />
      )}
    </div>
  )
}

function ExperientaFormModal({ lucrare, profile, onClose, onSave, onDelete }) {
  const e0 = lucrare
  const [form, setForm] = useState({
    denumire: e0?.denumire || '', beneficiar: e0?.beneficiar || '',
    valoare_lei: e0?.valoare_lei ?? '', valoare_executata_lei: e0?.valoare_executata_lei ?? '',
    data_pv: e0?.data_pv || '', tip_pv: e0?.tip_pv || 'PVRTL',
    piese: e0?.piese || '', folder_nas: e0?.folder_nas || '', dosar_sursa_path: e0?.dosar_sursa_path || '',
    asociere: e0?.asociere || false, observatii: e0?.observatii || '', activ: e0 ? !!e0.activ : true,
  })
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const valid = form.denumire.trim()

  const submit = async () => {
    if (!valid) return
    setSaving(true)
    const ok = await onSave(form)
    if (!ok) setSaving(false)
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.7)', zIndex:1000, display:'flex', alignItems:'flex-start', justifyContent:'center', overflowY:'auto', padding:'30px 14px' }} onClick={onClose}>
      <div style={{ ...S.card, width:'min(680px,100%)', padding:24 }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize:17, fontWeight:800, marginBottom:14 }}>📚 {e0 ? `Editează „${e0.denumire}"` : 'Lucrare nouă în catalog'}</div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
          <div style={{ gridColumn:'1 / -1' }}><label style={S.lbl}>Denumire *</label>
            <input style={S.input} value={form.denumire} onChange={e => set('denumire', e.target.value)} placeholder="ex: Balaceanca - Cond. Dn500 Plataresti - Balaceanca" /></div>
          <div><label style={S.lbl}>Beneficiar</label>
            <input style={S.input} value={form.beneficiar} onChange={e => set('beneficiar', e.target.value)} placeholder="ex: TRANSGAZ" /></div>
          <div><label style={S.lbl}>Valoare contract (lei fără TVA)</label>
            <input style={S.input} type="number" min="0" step="0.01" value={form.valoare_lei} onChange={e => set('valoare_lei', e.target.value)} placeholder="ex: 33289000" /></div>
          <div><label style={S.lbl}>Valoare executată Gazpet (la asocieri)</label>
            <input style={S.input} type="number" min="0" step="0.01" value={form.valoare_executata_lei} onChange={e => set('valoare_executata_lei', e.target.value)} placeholder="cota reală — pt. distribuții" /></div>
          <div><label style={S.lbl}>Data PV recepție</label>
            <input style={S.input} type="date" value={form.data_pv} onChange={e => set('data_pv', e.target.value)} /></div>
          <div><label style={S.lbl}>Tip PV</label>
            <select style={S.input} value={form.tip_pv} onChange={e => set('tip_pv', e.target.value)}>
              {TIP_PV_OPT.map(t => <option key={t} value={t}>{t}</option>)}
            </select></div>
          <div style={{ gridColumn:'1 / -1' }}><label style={S.lbl}>Piese în dosar (F/C/DC/R/PV)</label>
            <input style={S.input} value={form.piese} onChange={e => set('piese', e.target.value)} placeholder="ex: F, C, DC, PVRTL" /></div>
          <div style={{ gridColumn:'1 / -1' }}><label style={S.lbl}>Folder NAS (în Calificare\EXPERIENTA SIMILARA rev.1)</label>
            <input style={S.input} value={form.folder_nas} onChange={e => set('folder_nas', e.target.value)} placeholder="numele exact al folderului" /></div>
          <div style={{ gridColumn:'1 / -1' }}><label style={S.lbl}>Dosar-sursă licitație (opțional)</label>
            <input style={S.input} value={form.dosar_sursa_path} onChange={e => set('dosar_sursa_path', e.target.value)} placeholder={'ex: 1.TRANSGAZ\\63. Cond. Dn500 Plataresti Balaceanca...'} /></div>
          <div style={{ gridColumn:'1 / -1' }}><label style={S.lbl}>Observații</label>
            <textarea style={{ ...S.input, minHeight:56, resize:'vertical' }} value={form.observatii} onChange={e => set('observatii', e.target.value)} /></div>
          <label style={{ display:'flex', alignItems:'center', gap:7, fontSize:13, cursor:'pointer' }}>
            <input type="checkbox" checked={form.asociere} onChange={e => set('asociere', e.target.checked)} style={{ accentColor:G.orange }} />
            Executată în asociere <span style={{ color:G.dim, fontSize:11 }}>(se invocă doar cota Gazpet)</span>
          </label>
          {e0 && (
            <label style={{ display:'flex', alignItems:'center', gap:7, fontSize:13, cursor:'pointer' }}>
              <input type="checkbox" checked={form.activ} onChange={e => set('activ', e.target.checked)} style={{ accentColor:G.green }} />
              Activă în catalog
            </label>
          )}
        </div>
        <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:18, flexWrap:'wrap' }}>
          {e0 && profile?.is_owner && (
            <button style={{ ...S.btnS, color:G.red, borderColor:G.red + '66', marginRight:'auto' }} onClick={() => onDelete(e0)} disabled={saving}>🗑 Șterge</button>
          )}
          <button style={S.btnS} onClick={onClose} disabled={saving}>Anulează</button>
          <button style={{ ...S.btnP, opacity: valid && !saving ? 1 : .5 }} onClick={submit} disabled={!valid || saving}>
            {saving ? 'Se salvează...' : e0 ? '💾 Salvează' : '✅ Adaugă în catalog'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── 📡 Radar licitații — anunțuri SEAP scanate zilnic + scoring AI (gap-analysis) ──
// Sursa: tabela ofertare_radar, populată de edge function ofertare-radar-scan
// (cron zilnic + buton „Scanează acum"). Doar anunțurile relevante (CPV/cuvinte-cheie).
function RadarLicitatii({ profile, showToast, onPromovat }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [lastScan, setLastScan] = useState(null)
  const [scanning, setScanning] = useState(false)
  const [fStat, setFStat] = useState('activ')   // activ = nou+interesant
  const [fScor, setFScor] = useState(0)
  const [expanded, setExpanded] = useState(null)

  const load = async () => {
    setLoading(true)
    const [{ data: r }, { data: log }] = await Promise.all([
      supabase.from('ofertare_radar').select('*').eq('relevant', true)
        .order('scor_potrivire', { ascending: false, nullsFirst: false })
        .order('termen_depunere', { ascending: true }),
      supabase.from('ofertare_radar_scan_log').select('*')
        .order('pornit_la', { ascending: false }).limit(1),
    ])
    setRows(r || []); setLastScan(log?.[0] || null); setLoading(false)
  }
  useEffect(() => { load() }, [])

  const scaneaza = async () => {
    setScanning(true)
    const { data, error } = await supabase.functions.invoke('ofertare-radar-scan', { body: { zile: 2 } })
    setScanning(false)
    if (error) { showToast('Scanarea a eșuat: ' + error.message, 'err'); return }
    showToast(`📡 Scanat: ${data?.anunturi_vazute ?? '?'} anunțuri, ${data?.anunturi_noi ?? 0} noi, ${data?.relevante_noi ?? 0} relevante.`)
    await load()
  }

  const setStatus = async (r, status) => {
    const { error } = await supabase.from('ofertare_radar')
      .update({ status, actualizat_la: new Date().toISOString() }).eq('id', r.id)
    if (error) { showToast('Eroare: ' + error.message, 'err'); return }
    showToast(status === 'interesant' ? `⭐ ${r.nr_seap} — marcat interesant.` : `🙈 ${r.nr_seap} — ignorat.`)
    await load()
  }

  // Promovarea creează licitația în pipeline (E0) și leagă rândul de radar de ea
  const promoveaza = async (r) => {
    if (!window.confirm(`Promovezi ${r.nr_seap} în pipeline-ul de licitații?`)) return
    const { data: ins, error } = await supabase.from('ofertare_licitatii').insert({
      nr_anunt: r.nr_seap, autoritate: r.autoritate, obiect: r.titlu,
      link_seap: r.link, valoare_estimata: r.valoare_lei, moneda: 'RON',
      segment: r.segment || detectSegment(r.autoritate, r.titlu),
      termen_depunere: r.termen_depunere, canal: 'radar', status: 'identificata',
      observatii: r.motiv_scor ? `Radar (scor ${r.scor_potrivire}): ${r.motiv_scor}` : null,
      // identificatorii SEAP merg mai departe: cu ei butonul „Adu din SEAP"
      // descarcă singur toată documentația de atribuire (inclusiv planșele mari)
      c_notice_id: r.c_notice_id || null, sys_notice_type_id: r.sys_notice_type_id || null,
      created_by: profile?.id || null,
    }).select('id').single()
    if (error) { showToast('Eroare la promovare: ' + error.message, 'err'); return }
    await supabase.from('ofertare_radar')
      .update({ status: 'preluat', licitatie_id: ins.id, actualizat_la: new Date().toISOString() }).eq('id', r.id)
    showToast(`🏛 ${r.nr_seap} promovată în licitații — documentația se poate aduce din SEAP cu un buton.`)
    await load(); onPromovat?.()
  }

  const zileRamase = t => t ? Math.ceil((new Date(t) - Date.now()) / 86400000) : null
  const scorCul = s => s == null ? G.dim : s >= 70 ? G.green : s >= 40 ? G.yellow : G.dim

  const filtrate = rows.filter(r => {
    if (fStat === 'activ' && !['nou', 'interesant'].includes(r.status)) return false
    if (fStat !== 'activ' && fStat !== 'toate' && r.status !== fStat) return false
    if (fScor && (r.scor_potrivire == null || r.scor_potrivire < fScor)) return false
    return true
  })

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:18, flexWrap:'wrap', gap:10 }}>
        <div>
          <div style={{ fontSize:19, fontWeight:800 }}>📡 Radar licitații</div>
          <div style={{ fontSize:12, color:G.muted }}>
            Anunțuri SEAP scanate automat (conducte gaze + apă/canal) cu scor de potrivire AI
            {lastScan && ` · ultima scanare: ${fmtTermen(lastScan.pornit_la)} — ${lastScan.anunturi_vazute ?? 0} anunțuri, ${lastScan.relevante_noi ?? 0} relevante noi`}
          </div>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <select style={{ ...S.input, width:'auto' }} value={fStat} onChange={e => setFStat(e.target.value)}>
            <option value="activ">Noi + interesante</option>
            <option value="interesant">Doar interesante</option>
            <option value="ignorat">Ignorate</option>
            <option value="preluat">Preluate</option>
            <option value="toate">Toate</option>
          </select>
          <select style={{ ...S.input, width:'auto' }} value={fScor} onChange={e => setFScor(Number(e.target.value))}>
            <option value={0}>Orice scor</option>
            <option value={70}>Scor ≥ 70</option>
            <option value={40}>Scor ≥ 40</option>
          </select>
          <button style={{ ...S.btnP, opacity: scanning ? .6 : 1 }} disabled={scanning} onClick={scaneaza}>
            {scanning ? '⏳ Scanez...' : '🔄 Scanează acum'}
          </button>
        </div>
      </div>

      {loading && <div style={{ padding:40, textAlign:'center', color:G.muted }}>Se încarcă radarul...</div>}
      {!loading && !filtrate.length && (
        <div style={{ ...S.card, padding:40, textAlign:'center', color:G.dim, fontSize:14 }}>
          Nimic pe filtrul curent. Radarul scanează zilnic anunțurile noi din SEAP.
        </div>
      )}

      <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
        {filtrate.map(r => {
          const zile = zileRamase(r.termen_depunere)
          const exp = expanded === r.id
          return (
            <div key={r.id} style={{ ...S.card, padding:'14px 18px', cursor:'pointer',
              opacity: ['ignorat'].includes(r.status) ? .55 : 1 }}
              onClick={() => setExpanded(exp ? null : r.id)}>
              <div style={{ display:'flex', alignItems:'flex-start', gap:14, flexWrap:'wrap' }}>
                <div style={{ minWidth:52, textAlign:'center' }}>
                  <div style={{ fontSize:21, fontWeight:800, color: scorCul(r.scor_potrivire) }}>{r.scor_potrivire ?? '—'}</div>
                  <div style={{ fontSize:9.5, color:G.dim, textTransform:'uppercase' }}>scor</div>
                </div>
                <div style={{ flex:1, minWidth:260 }}>
                  <div style={{ fontSize:14, fontWeight:700, lineHeight:1.35 }}>
                    {r.status === 'interesant' && '⭐ '}{r.status === 'preluat' && '🏛 '}{r.titlu}
                  </div>
                  <div style={{ fontSize:12, color:G.muted, marginTop:3 }}>
                    {r.autoritate} · {fmtVal(r.valoare_lei)} lei · {r.cpv}
                  </div>
                  <div style={{ fontSize:12, marginTop:4 }}>
                    <span style={{ color: zile != null && zile <= 7 ? G.red : zile != null && zile <= 14 ? G.orange : G.muted, fontWeight:700 }}>
                      ⏱ {fmtTermen(r.termen_depunere)}{zile != null && zile >= 0 ? ` — ${zile} zile` : zile != null ? ' — EXPIRAT' : ''}
                    </span>
                    {r.tip_procedura && <span style={{ color:G.dim }}> · {r.tip_procedura}</span>}
                    {r.are_loturi && <span style={{ color:G.dim }}> · pe loturi</span>}
                  </div>
                  {r.motiv_scor && <div style={{ fontSize:12, color:G.text, marginTop:6, opacity:.85 }}>{r.motiv_scor}</div>}
                  {exp && Array.isArray(r.lipsuri) && r.lipsuri.length > 0 && (
                    <div style={{ marginTop:8, padding:'8px 12px', background:G.bg, borderRadius:7, border:`1px solid ${G.border2}` }}>
                      <div style={{ fontSize:11, fontWeight:700, color:G.orange, marginBottom:4 }}>⚠ CE NE-AR LIPSI</div>
                      {r.lipsuri.map((l, i) => <div key={i} style={{ fontSize:12, color:G.muted, marginBottom:3 }}>• {l}</div>)}
                    </div>
                  )}
                  {exp && Array.isArray(r.documente) && r.documente.length > 0 && (
                    <div style={{ marginTop:8, padding:'8px 12px', background:G.bg, borderRadius:7, border:`1px solid ${G.border2}` }}>
                      <div style={{ fontSize:11, fontWeight:700, color:G.muted, marginBottom:4 }}>📎 DOCUMENTAȚIA PUBLICATĂ ({r.documente.length}) — descărcarea cere login SEAP</div>
                      {r.documente.map((d, i) => <div key={i} style={{ fontSize:12, color:G.dim, marginBottom:2 }}>• {d.nume}</div>)}
                    </div>
                  )}
                </div>
                <div style={{ display:'flex', flexDirection:'column', gap:6, alignItems:'stretch' }} onClick={e => e.stopPropagation()}>
                  {r.link && <a href={r.link} target="_blank" rel="noreferrer" style={{ ...S.btnS, padding:'6px 12px', fontSize:12, textAlign:'center', textDecoration:'none', color:G.blue }}>SEAP ↗</a>}
                  {['nou', 'interesant'].includes(r.status) && <>
                    {r.status === 'nou' && <button style={{ ...S.btnS, padding:'6px 12px', fontSize:12 }} onClick={() => setStatus(r, 'interesant')}>⭐ Interesant</button>}
                    <button style={{ ...S.btnS, padding:'6px 12px', fontSize:12 }} onClick={() => setStatus(r, 'ignorat')}>🙈 Ignoră</button>
                    <button style={{ ...S.btnP, padding:'6px 12px', fontSize:12 }} onClick={() => promoveaza(r)}>🏛 Promovează</button>
                  </>}
                  {r.status === 'ignorat' && <button style={{ ...S.btnS, padding:'6px 12px', fontSize:12 }} onClick={() => setStatus(r, 'nou')}>↩ Readu</button>}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── 💰 Referințe financiare — calibrări istorice + prețuri unitare + materiale ──
// Sursa: anatomia celor 5 oferte depuse (doc claude: anatomia-oferta-financiara).
// Calibrări = cu ce coeficienți s-a mers per beneficiar/an. Prețurile de materiale
// sunt istoric orientativ — fluxul viu va fi generatorul de cereri de ofertă (RFQ).
function ReferinteFinanciare({ showToast }) {
  const [cal, setCal] = useState([])
  const [pu, setPu] = useState([])
  const [mat, setMat] = useState([])
  const [norme, setNorme] = useState([])
  const [loading, setLoading] = useState(true)
  const [cauta, setCauta] = useState('')
  const [tab, setTab] = useState('calibrari')  // calibrari | preturi | materiale | normative

  const loadAll = async () => {
    const [{ data: c }, { data: p }, { data: m }, { data: n }] = await Promise.all([
      supabase.from('ofertare_calibrari').select('*').order('an', { ascending: false, nullsFirst: false }),
      supabase.from('ofertare_preturi_unitare').select('*').order('an', { ascending: false, nullsFirst: false }),
      supabase.from('ofertare_preturi_materiale').select('*').order('an', { ascending: false, nullsFirst: false }),
      supabase.from('ofertare_normative').select('*').order('created_at', { ascending: false }),
    ])
    setCal(c || []); setPu(p || []); setMat(m || []); setNorme(n || []); setLoading(false)
  }
  useEffect(() => { loadAll() }, [])

  const q = cauta.toLowerCase()
  const fPu = pu.filter(r => !q || `${r.simbol} ${r.denumire} ${r.lucrare}`.toLowerCase().includes(q))
  const fMat = mat.filter(r => !q || `${r.denumire} ${r.furnizor} ${r.lucrare}`.toLowerCase().includes(q))
  const fmtPct = v => v == null ? '—' : `${Number(v)}%`
  const REZ = { castigata: ['🏆', G.green], pierduta: ['❌', G.red], depusa: ['📮', G.purple], anulata: ['⛔', G.dim] }

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16, flexWrap:'wrap', gap:10 }}>
        <div>
          <div style={{ fontSize:19, fontWeight:800 }}>💰 Referințe financiare</div>
          <div style={{ fontSize:12, color:G.muted }}>Cu ce coeficienți s-a mers istoric, pe segmente — plus prețuri unitare și materiale din ofertele depuse</div>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          {[['calibrari', `⚙️ Calibrări (${cal.length})`], ['preturi', `🔧 Prețuri unitare (${pu.length})`], ['materiale', `🧱 Materiale (${mat.length})`], ['normative', `📜 Normative (${norme.length})`]].map(([k, lbl]) => (
            <button key={k} onClick={() => setTab(k)} style={{ ...S.btnS, padding:'6px 13px', fontSize:12, fontWeight:700,
              ...(tab === k ? { background:G.ofertare + '22', color:G.ofertare, border:`1px solid ${G.ofertare}88` } : {}) }}>{lbl}</button>
          ))}
        </div>
      </div>

      {loading && <div style={{ padding:40, textAlign:'center', color:G.muted }}>Se încarcă referințele...</div>}

      {!loading && tab === 'calibrari' && (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {cal.map(r => {
            const seg = SEGMENTE[r.segment] || SEGMENTE.altele
            const [rIcon, rCol] = REZ[r.rezultat] || ['❔', G.dim]
            return (
              <div key={r.id} style={{ ...S.card, padding:'14px 18px', borderLeft:`3px solid ${seg.color}` }}>
                <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
                  <span style={{ color:seg.color, border:`1px solid ${seg.color}55`, borderRadius:10, padding:'1px 9px', fontSize:10.5, fontWeight:800 }}>{seg.label}</span>
                  <span style={{ fontWeight:700, fontSize:13.5, flex:1, minWidth:240 }}>{r.lucrare}</span>
                  <span style={{ color:rCol, fontWeight:800, fontSize:12 }}>{rIcon} {r.rezultat || '—'}</span>
                  <span style={{ color:G.dim, fontSize:12 }}>{r.an || '—'}</span>
                </div>
                <div style={{ display:'flex', gap:16, marginTop:8, flexWrap:'wrap' }}>
                  {[['Valoare', r.valoare_lei != null ? fmtVal(r.valoare_lei) + ' lei' : '—'],
                    ['Indirecte', fmtPct(r.indirecte_pct)], ['Profit', fmtPct(r.profit_pct)],
                    ['Manoperă', r.tarif_manopera != null ? `${Number(r.tarif_manopera)} lei/h` : '—'],
                    ['OS', fmtPct(r.os_pct)]].map(([k, v]) => (
                    <div key={k} style={{ background:G.bg, border:`1px solid ${G.border2}`, borderRadius:7, padding:'5px 12px' }}>
                      <div style={{ fontSize:9.5, color:G.dim, textTransform:'uppercase', fontWeight:700 }}>{k}</div>
                      <div style={{ fontSize:13.5, fontWeight:800 }}>{v}</div>
                    </div>
                  ))}
                </div>
                {r.note && <div style={{ fontSize:12, color:G.muted, marginTop:8 }}>{r.note}</div>}
              </div>
            )
          })}
          <div style={{ fontSize:11.5, color:G.dim, padding:'6px 4px' }}>
            Formula devizului: directe (mat+man+uti+tra) + CAM 2,25% pe manoperă → + indirecte % → + profit %. Rândurile se completează la fiecare ofertă depusă.
          </div>
        </div>
      )}

      {!loading && tab === 'normative' && <NormativeLista norme={norme} showToast={showToast} onChange={loadAll} />}

      {!loading && (tab === 'preturi' || tab === 'materiale') && (
        <>
          <input style={{ ...S.input, marginBottom:12, maxWidth:420 }} placeholder="🔍 Caută (denumire, simbol, lucrare, furnizor...)" value={cauta} onChange={e => setCauta(e.target.value)} />
          <div style={{ ...S.card, overflow:'hidden' }}>
            <div style={{ overflowX:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12.5 }}>
                <thead>
                  <tr style={{ background:G.surface, color:G.muted, fontSize:11, textTransform:'uppercase' }}>
                    {(tab === 'preturi' ? ['Simbol', 'Denumire', 'UM', 'Preț', 'Tip', 'Lucrare', 'An']
                      : ['Denumire', 'UM', 'Preț', 'Furnizor', 'Lucrare', 'An']).map(h => (
                      <th key={h} style={{ textAlign:'left', padding:'9px 12px', borderBottom:`1px solid ${G.border}` }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(tab === 'preturi' ? fPu : fMat).map(r => (
                    <tr key={r.id} style={{ borderBottom:`1px solid ${G.border2}` }} title={r.note || ''}>
                      {tab === 'preturi' && <td style={{ padding:'8px 12px', color:G.ofertare, fontWeight:700, whiteSpace:'nowrap' }}>{r.simbol || '—'}</td>}
                      <td style={{ padding:'8px 12px', maxWidth:380 }}>{r.denumire}{r.note ? ' *' : ''}</td>
                      <td style={{ padding:'8px 12px', color:G.dim }}>{r.um || '—'}</td>
                      <td style={{ padding:'8px 12px', fontWeight:800, whiteSpace:'nowrap' }}>{fmtVal(r.pret)} lei</td>
                      {tab === 'preturi' ? <td style={{ padding:'8px 12px', color:G.muted }}>{r.tip}</td>
                        : <td style={{ padding:'8px 12px', color:G.muted }}>{r.furnizor || '—'}</td>}
                      <td style={{ padding:'8px 12px', color:G.dim, maxWidth:180, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.lucrare || '—'}</td>
                      <td style={{ padding:'8px 12px', color:G.dim }}>{r.an || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {tab === 'materiale' && (
            <div style={{ fontSize:11.5, color:G.dim, padding:'8px 4px' }}>
              ⚠️ Prețurile de materiale se învechesc — sunt referință, nu ofertă. Fluxul complet (generator cereri de ofertă → import oferte primite → comparativ → prețuri per licitație) e următorul pas al modulului.
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── 📜 Normative — ordine ANRE, prescripții, comunicări sudură, standarde ──
// Registrul "ordinelor în vigoare" (cerut de Razvan 28.08): echipa le găsește
// într-un loc, iar AI-ul citează din ele la cereri de ofertă / clarificări /
// propuneri tehnice. Statusul (în vigoare / abrogat / înlocuit) e vital.
const NORM_TIP = { ordin_anre:'Ordin ANRE', prescriptie_iscir:'Prescripție ISCIR', lege:'Lege', hg:'HG', standard:'Standard', comunicare:'Comunicare', norma_tehnica:'Normă tehnică', altele:'Altele' }
const NORM_STATUS = { in_vigoare:['✅ în vigoare', G.green], abrogat:['⛔ abrogat', G.red], inlocuit:['🔁 înlocuit', G.orange] }

function NormativeLista({ norme, showToast, onChange }) {
  const [showAdd, setShowAdd] = useState(false)
  const [f, setF] = useState({ tip:'ordin_anre', numar:'', titlu:'', emitent:'', data_emitere:'', status:'in_vigoare', inlocuit_de:'', domenii:'', link:'', note:'' })
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))

  const salveaza = async () => {
    if (!f.titlu.trim()) { showToast('Titlul e obligatoriu.', 'err'); return }
    const { error } = await supabase.from('ofertare_normative').insert({
      tip: f.tip, numar: f.numar.trim() || null, titlu: f.titlu.trim(), emitent: f.emitent.trim() || null,
      data_emitere: f.data_emitere || null, status: f.status, inlocuit_de: f.inlocuit_de.trim() || null,
      domenii: f.domenii.trim() ? f.domenii.split(',').map(s => s.trim()).filter(Boolean) : null,
      link: f.link.trim() || null, note: f.note.trim() || null,
    })
    if (error) { showToast('Eroare: ' + error.message, 'err'); return }
    showToast('Normativ adăugat.')
    setShowAdd(false); setF({ tip:'ordin_anre', numar:'', titlu:'', emitent:'', data_emitere:'', status:'in_vigoare', inlocuit_de:'', domenii:'', link:'', note:'' })
    onChange()
  }
  const schimbaStatus = async (n, status) => {
    await supabase.from('ofertare_normative').update({ status, updated_at: new Date().toISOString() }).eq('id', n.id)
    onChange()
  }
  const sterge = async (n) => {
    if (!window.confirm(`Ștergi „${n.titlu.slice(0, 60)}"?`)) return
    await supabase.from('ofertare_normative').delete().eq('id', n.id)
    onChange()
  }

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:10 }}>
        <button style={S.btnP} onClick={() => setShowAdd(s => !s)}>{showAdd ? '✕ renunță' : '＋ Normativ'}</button>
      </div>
      {showAdd && (
        <div style={{ ...S.card, padding:14, marginBottom:12, display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:10 }}>
          <div><label style={S.lbl}>Tip</label>
            <select style={S.input} value={f.tip} onChange={e => set('tip', e.target.value)}>
              {Object.entries(NORM_TIP).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select></div>
          <div><label style={S.lbl}>Număr (ex: 89/2018)</label><input style={S.input} value={f.numar} onChange={e => set('numar', e.target.value)} /></div>
          <div><label style={S.lbl}>Emitent</label><input style={S.input} value={f.emitent} onChange={e => set('emitent', e.target.value)} placeholder="ANRE / ISCIR / Transgaz..." /></div>
          <div><label style={S.lbl}>Data emiterii</label><input style={S.input} type="date" value={f.data_emitere} onChange={e => set('data_emitere', e.target.value)} /></div>
          <div style={{ gridColumn:'1 / -1' }}><label style={S.lbl}>Titlu *</label><input style={S.input} value={f.titlu} onChange={e => set('titlu', e.target.value)} /></div>
          <div><label style={S.lbl}>Status</label>
            <select style={S.input} value={f.status} onChange={e => set('status', e.target.value)}>
              {Object.entries(NORM_STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
            </select></div>
          <div><label style={S.lbl}>Înlocuit de</label><input style={S.input} value={f.inlocuit_de} onChange={e => set('inlocuit_de', e.target.value)} /></div>
          <div><label style={S.lbl}>Domenii (virgulă)</label><input style={S.input} value={f.domenii} onChange={e => set('domenii', e.target.value)} placeholder="distributie, sudura_pe" /></div>
          <div><label style={S.lbl}>Link</label><input style={S.input} value={f.link} onChange={e => set('link', e.target.value)} /></div>
          <div style={{ gridColumn:'1 / -1', display:'flex', gap:10, alignItems:'flex-end' }}>
            <div style={{ flex:1 }}><label style={S.lbl}>Note</label><input style={S.input} value={f.note} onChange={e => set('note', e.target.value)} /></div>
            <button style={S.btnP} onClick={salveaza}>Salvează</button>
          </div>
        </div>
      )}
      <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
        {norme.map(n => {
          const [stLbl, stCol] = NORM_STATUS[n.status] || NORM_STATUS.in_vigoare
          return (
            <div key={n.id} style={{ ...S.card, padding:'11px 15px', borderLeft:`3px solid ${stCol}`, opacity: n.status === 'abrogat' ? .55 : 1 }}>
              <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
                <span style={{ fontSize:11, color:G.ofertare, fontWeight:800, border:`1px solid ${G.ofertare}44`, borderRadius:10, padding:'1px 9px', whiteSpace:'nowrap' }}>{NORM_TIP[n.tip] || n.tip}{n.numar ? ' ' + n.numar : ''}</span>
                <span style={{ fontWeight:700, fontSize:13, flex:1, minWidth:220 }}>{n.link ? <a href={n.link} target="_blank" rel="noreferrer" style={{ color:G.text }}>{n.titlu}</a> : n.titlu}</span>
                <span style={{ color:stCol, fontWeight:800, fontSize:11.5, whiteSpace:'nowrap' }}>{stLbl}{n.inlocuit_de ? ` → ${n.inlocuit_de}` : ''}</span>
                <select style={{ ...S.input, width:'auto', fontSize:11, padding:'3px 7px' }} value={n.status} onChange={e => schimbaStatus(n, e.target.value)}>
                  {Object.entries(NORM_STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
                </select>
                <button onClick={() => sterge(n)} style={{ ...S.btnS, padding:'3px 8px', fontSize:11, color:G.red, borderColor:G.red + '66' }}>✕</button>
              </div>
              <div style={{ fontSize:11.5, color:G.dim, marginTop:4, display:'flex', gap:14, flexWrap:'wrap' }}>
                {n.emitent && <span>🏛 {n.emitent}</span>}
                {n.data_emitere && <span>📅 {new Date(n.data_emitere).toLocaleDateString('ro-RO')}</span>}
                {Array.isArray(n.domenii) && n.domenii.length > 0 && <span>🏷 {n.domenii.join(', ')}</span>}
                {n.note && <span>💬 {n.note}</span>}
              </div>
            </div>
          )
        })}
        {!norme.length && <div style={{ ...S.card, padding:26, textAlign:'center', color:G.dim, fontSize:13 }}>Niciun normativ încă — adaugă ordinele ANRE și comunicările de sudură cu „＋ Normativ".</div>}
      </div>
    </div>
  )
}
