/* TabConcedii.jsx — Cereri concediu de odihnă (spec_cereri_concediu_mobil)
   Faza 2+3: formular cerere (nume/funcție/an auto, zile lucrătoare auto), PDF tip cu
   semnături din BD, coadă aprobare MP/Șef birou + HR (2 semnatari mereu), arhivă per
   angajat + export ZIP. Rute fixe din hr_concediu_rute; fără rută → alege din MP. */
import React, { useEffect, useMemo, useState, useCallback } from 'react'
import { supabase } from './lib/supabase.js'
import { jsPDF } from 'jspdf'
import html2canvas from 'html2canvas'
import JSZip from 'jszip'

const G = {
  bg:'#0D1117', surface:'#161B22', card:'#1C2128', card2:'#21262D', text:'#E6EDF3',
  muted:'#8B949E', dim:'#6E7681', border:'#30363D', border2:'#21262D',
  blue:'#58A6FF', green:'#2EA043', greenBg:'#238636', yellow:'#D29922', orange:'#F0883E',
  red:'#F85149', purple:'#A371F7', hr:'#F778BA',
}
const S = {
  input: { width:'100%', padding:'10px 12px', background:G.card2, border:`1px solid ${G.border}`, borderRadius:8, color:G.text, fontSize:14, boxSizing:'border-box' },
  label: { display:'block', fontSize:11, fontWeight:700, color:G.muted, textTransform:'uppercase', letterSpacing:0.5, marginBottom:6 },
  btnP:  { padding:'10px 18px', background:G.hr, color:'#0D1117', border:0, borderRadius:8, fontWeight:700, fontSize:14, cursor:'pointer' },
  btnS:  { padding:'9px 14px', background:'transparent', color:G.muted, border:`1px solid ${G.border}`, borderRadius:8, fontSize:13, cursor:'pointer' },
}

// Aprobator (profile) → employee_id, pt. semnătura din hr_semnaturi_electronice
const APROBATOR_EMP = {
  '2dbb5999-a772-4ad2-96f9-97eabbb20771': 90,   // Pantea Constantin
  '9b96e3c8-de44-4acf-90d6-631c004c3691': 125,  // Marilena Tudorache
  'c338860a-6845-4ed0-93d4-2a866cf5e37c': 71,   // Mitrache Alexandru
  '01ab5a45-31f1-4868-81ec-c30fe05ab523': 121,  // Razvan Trusu
  'cb29a12a-b318-40bc-85c0-bb4f5b3bc2d3': 81,   // Eugen Nica
  '22145c33-66bb-4a46-9af4-485a34ecf2b8': 117,  // Razvan Toma
  'fff585e0-f9ea-4830-a6fb-bd51d167ef43': 14,   // Apostol Andruț
  '38d7120e-76be-40f5-9159-47f89b907bcc': 126,  // Natalia Udrea (HR)
}
const HR_PROFILE_ID = '38d7120e-76be-40f5-9159-47f89b907bcc' // Natalia Udrea

const STATUS_INFO = {
  depusa:      { label:'Depusă — așteaptă MP/Șef', emoji:'📨', color:G.yellow },
  aprobata_mp: { label:'Semnată MP — așteaptă HR', emoji:'🖊️', color:G.orange },
  aprobata:    { label:'Aprobată',                 emoji:'✅', color:G.green },
  respinsa:    { label:'Respinsă',                 emoji:'❌', color:G.red },
  anulata:     { label:'Anulată',                  emoji:'⛔', color:G.dim },
}
const fmtD = d => d ? new Date(d + 'T12:00').toLocaleDateString('ro-RO') : '—'

// Semnătură activă a unui angajat → dataURL (signed URL + fetch, anti-bug CORS)
async function fetchSemnaturaDataURL(employeeId) {
  if (!employeeId) return null
  try {
    const { data: rows } = await supabase.from('hr_semnaturi_electronice')
      .select('fisier_path').eq('employee_id', employeeId).eq('activ', true).is('deleted_at', null)
      .order('uploadat_la', { ascending:false }).limit(1)
    const path = rows?.[0]?.fisier_path
    if (!path) return null
    const { data: su } = await supabase.storage.from('hr-semnaturi').createSignedUrl(path, 120)
    if (!su?.signedUrl) return null
    const blob = await (await fetch(su.signedUrl)).blob()
    return await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob) })
  } catch (e) { console.warn('semnatura fetch:', e.message); return null }
}

// HTML cerere tip RO → PDF A4 (html2canvas, colgroup irelevant — layout simplu)
function buildCerereHTML(c, emp, aprobatorNume, semn) {
  const semnBox = (rol, nume, dataUrl, laData) => `
    <td style="width:33%;text-align:center;vertical-align:top;padding:10px 6px;">
      <div style="font-size:10px;color:#555;">${rol}</div>
      <div style="font-size:11px;font-weight:bold;margin-top:2px;">${nume || '—'}</div>
      ${dataUrl ? `<img src="${dataUrl}" style="max-height:52px;max-width:150px;margin-top:6px;"/>` :
        (laData ? `<div style="margin-top:14px;font-size:9px;color:#333;border:1px solid #999;border-radius:4px;display:inline-block;padding:4px 8px;">Aprobat electronic<br/>${laData}</div>` :
          `<div style="height:52px;"></div>`)}
      ${laData ? `<div style="font-size:9px;color:#777;margin-top:3px;">${laData}</div>` : ''}
    </td>`
  return `<div style="width:794px;background:#fff;color:#000;font-family:Arial,sans-serif;font-size:13px;padding:48px 56px;">
    <div style="text-align:right;font-size:11px;color:#333;">S.C. GAZPET INSTAL S.R.L.<br/>Nr. înreg. ______ / ____________</div>
    <div style="text-align:center;font-size:20px;font-weight:bold;letter-spacing:1px;margin:30px 0 26px;">CERERE CONCEDIU DE ODIHNĂ</div>
    <div style="line-height:2;text-align:justify;">
      Subsemnatul(a), <b>${emp?.name || ''}</b>, angajat(ă) al S.C. GAZPET INSTAL S.R.L. în funcția de
      <b>${(emp?.functie || '').trim()}</b>, vă rog să-mi aprobați efectuarea unui număr de
      <b>${c.nr_zile_lucratoare} zile lucrătoare</b> de concediu de odihnă aferent anului <b>${c.an}</b>,
      în perioada <b>${fmtD(c.data_start)}</b> — <b>${fmtD(c.data_sfarsit)}</b>.
    </div>
    <div style="margin-top:30px;line-height:1.8;">Vă mulțumesc.</div>
    <table style="width:100%;border-collapse:collapse;margin-top:44px;">
      <tr>
        ${semnBox('Angajat', emp?.name, semn.angajat, null)}
        ${semnBox('Aprobat — ' + (semn.aprobatorRol || 'MP / Șef birou'), aprobatorNume, semn.mp, semn.mpLa)}
        ${semnBox('HR', semn.hrNume || 'Natalia Udrea', semn.hr, semn.hrLa)}
      </tr>
    </table>
    <div style="margin-top:36px;font-size:11px;color:#333;">Data cererii: ${fmtD(c.created_at?.slice(0,10) || new Date().toISOString().slice(0,10))}</div>
    <div style="margin-top:26px;border-top:1px solid #ccc;padding-top:8px;font-size:9px;color:#888;">
      Generat automat din Gazpet ERP · Cerere #${c.id} · Zilele lucrătoare exclud weekendurile și sărbătorile legale.
    </div>
  </div>`
}

async function generatePdfBlob(html) {
  const holder = document.createElement('div')
  holder.style.cssText = 'position:fixed;left:-9999px;top:0;'
  holder.innerHTML = html
  document.body.appendChild(holder)
  try {
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    const canvas = await html2canvas(holder.firstElementChild, { scale: 2, backgroundColor: '#fff' })
    const pdf = new jsPDF({ unit:'mm', format:'a4' })
    const w = 210, h = canvas.height * w / canvas.width
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, w, Math.min(h, 297))
    return pdf.output('blob')
  } finally { document.body.removeChild(holder) }
}

export default function TabConcedii({ profile, employees = [], showToast }) {
  const [cereri, setCereri] = useState([])
  const [aprobatori, setAprobatori] = useState([])   // hr_aprobatori + nume profil
  const [rute, setRute] = useState({})               // employee_id → aprobator_profile_id
  const [soldMap, setSoldMap] = useState({})         // employee_id → {drept, consumate, sold}
  const [profNames, setProfNames] = useState({})     // profile_id → name
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [fltEmp, setFltEmp] = useState('')
  const [fltStatus, setFltStatus] = useState('active')

  const empMap = useMemo(() => Object.fromEntries(employees.map(e => [e.id, e])), [employees])
  const isHR = profile?.is_owner || profile?.id === HR_PROFILE_ID || profile?.department === 'HR'

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [cer, apr, rt, sold, prof] = await Promise.all([
        supabase.from('hr_cereri_concediu').select('*').order('created_at', { ascending:false }),
        supabase.from('hr_aprobatori').select('*').eq('activ', true).order('tip'),
        supabase.from('hr_concediu_rute').select('employee_id, aprobator_profile_id'),
        supabase.from('v_hr_sold_co').select('*'),
        supabase.from('profiles').select('id, name'),
      ])
      setCereri(cer.data || [])
      setAprobatori(apr.data || [])
      setRute(Object.fromEntries((rt.data || []).map(r => [r.employee_id, r.aprobator_profile_id])))
      setSoldMap(Object.fromEntries((sold.data || []).map(s => [s.employee_id, s])))
      setProfNames(Object.fromEntries((prof.data || []).map(p => [p.id, p.name])))
    } catch (e) { showToast('Eroare încărcare concedii: ' + e.message, 'error') }
    finally { setLoading(false) }
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadAll() }, [loadAll])

  // Generează + urcă PDF-ul final (cu semnăturile disponibile la momentul respectiv)
  const regeneratePdf = async (c) => {
    const emp = empMap[c.employee_id]
    const aprobNume = profNames[c.aprobator_id] || '—'
    const semn = {
      angajat: await fetchSemnaturaDataURL(c.employee_id),
      mp: await fetchSemnaturaDataURL(APROBATOR_EMP[c.semnat_mp_de]),
      mpLa: c.semnat_mp_la ? new Date(c.semnat_mp_la).toLocaleDateString('ro-RO') : null,
      hr: await fetchSemnaturaDataURL(APROBATOR_EMP[c.semnat_hr_de]),
      hrLa: c.semnat_hr_la ? new Date(c.semnat_hr_la).toLocaleDateString('ro-RO') : null,
      hrNume: profNames[c.semnat_hr_de] || 'Natalia Udrea',
      aprobatorRol: 'MP / Șef birou',
    }
    const blob = await generatePdfBlob(buildCerereHTML(c, emp, aprobNume, semn))
    const path = `concedii/${c.employee_id}/${c.an}_cerere_${c.id}.pdf`
    const { error: eUp } = await supabase.storage.from('documente-personal').upload(path, blob, { upsert:true, contentType:'application/pdf' })
    if (eUp) throw eUp
    await supabase.from('hr_cereri_concediu').update({ pdf_path: path }).eq('id', c.id)
    return path
  }

  const openPdf = async (c) => {
    try {
      const path = c.pdf_path || await regeneratePdf(c)
      const { data } = await supabase.storage.from('documente-personal').createSignedUrl(path, 300)
      if (data?.signedUrl) window.open(data.signedUrl, '_blank')
    } catch (e) { showToast('Eroare PDF: ' + e.message, 'error') }
  }

  const semneaza = async (c, rol) => {
    setBusyId(c.id)
    try {
      const patch = rol === 'mp'
        ? { status:'aprobata_mp', semnat_mp_de: profile.id, semnat_mp_la: new Date().toISOString() }
        : { status:'aprobata', semnat_hr_de: profile.id, semnat_hr_la: new Date().toISOString() }
      const { data, error } = await supabase.from('hr_cereri_concediu').update(patch).eq('id', c.id).select().single()
      if (error) throw error
      if (rol === 'hr') { await regeneratePdf(data) }  // PDF final cu toate semnăturile
      showToast(rol === 'mp' ? '🖊️ Semnat ca MP/Șef — merge la HR' : '✅ Aprobată + PDF generat în arhivă')
      loadAll()
    } catch (e) { showToast('Eroare: ' + e.message, 'error') }
    finally { setBusyId(null) }
  }

  const respinge = async (c) => {
    const motiv = window.prompt('Motivul respingerii:')
    if (motiv === null) return
    setBusyId(c.id)
    try {
      const { error } = await supabase.from('hr_cereri_concediu')
        .update({ status:'respinsa', motiv_respingere: motiv || null }).eq('id', c.id)
      if (error) throw error
      showToast('Cerere respinsă'); loadAll()
    } catch (e) { showToast('Eroare: ' + e.message, 'error') }
    finally { setBusyId(null) }
  }

  // Export ZIP — arhiva unui angajat sau toate aprobate (control ITM)
  const exportZip = async (employeeId = null) => {
    try {
      const lot = cereri.filter(c => c.status === 'aprobata' && (!employeeId || c.employee_id === employeeId))
      if (!lot.length) { showToast('Nicio cerere aprobată de exportat', 'error'); return }
      showToast(`⏳ Export ${lot.length} cereri...`)
      const zip = new JSZip()
      for (const c of lot) {
        const path = c.pdf_path || await regeneratePdf(c)
        const { data: su } = await supabase.storage.from('documente-personal').createSignedUrl(path, 120)
        if (!su?.signedUrl) continue
        const blob = await (await fetch(su.signedUrl)).blob()
        const emp = empMap[c.employee_id]
        zip.file(`${(emp?.name || 'angajat').replace(/[^\w ăâîșțĂÂÎȘȚ-]/g,'')}/${c.an}_cerere_${c.id}_${c.data_start}.pdf`, blob)
      }
      const out = await zip.generateAsync({ type:'blob' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(out)
      a.download = employeeId ? `concedii_${(empMap[employeeId]?.name || '').replace(/\s+/g,'_')}.zip` : `concedii_toate_${new Date().toISOString().slice(0,10)}.zip`
      a.click(); URL.revokeObjectURL(a.href)
    } catch (e) { showToast('Eroare export: ' + e.message, 'error') }
  }

  const filtered = useMemo(() => cereri.filter(c => {
    if (fltEmp && String(c.employee_id) !== fltEmp) return false
    if (fltStatus === 'active') return ['depusa','aprobata_mp'].includes(c.status)
    if (fltStatus !== 'toate' && c.status !== fltStatus) return false
    return true
  }), [cereri, fltEmp, fltStatus])

  const pending = cereri.filter(c => ['depusa','aprobata_mp'].includes(c.status)).length

  return (
    <div>
      <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap', marginBottom:16 }}>
        <h3 style={{ margin:0, fontSize:17, color:G.text }}>🌴 Cereri concediu de odihnă {pending > 0 && <span style={{ fontSize:12, color:G.yellow }}>({pending} în așteptare)</span>}</h3>
        <div style={{ flex:1 }} />
        <select value={fltEmp} onChange={e => setFltEmp(e.target.value)} style={{ ...S.input, width:230 }}>
          <option value="">Toți angajații</option>
          {employees.filter(e => e.active !== false).map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <select value={fltStatus} onChange={e => setFltStatus(e.target.value)} style={{ ...S.input, width:190 }}>
          <option value="active">🔔 De aprobat</option>
          <option value="toate">Toate</option>
          {Object.entries(STATUS_INFO).map(([k, v]) => <option key={k} value={k}>{v.emoji} {v.label}</option>)}
        </select>
        {fltEmp && <button onClick={async () => {
          try {
            const { data } = await supabase.from('hr_concediu_tokens').select('token').eq('employee_id', parseInt(fltEmp)).eq('activ', true).maybeSingle()
            if (!data?.token) { showToast('Angajatul nu are token activ', 'error'); return }
            // Ruta publică /co din app (edge-urile Supabase nu pot servi HTML — gateway forțează text/plain)
            const url = `${window.location.origin}/co?t=${data.token}`
            await navigator.clipboard.writeText(url)
            showToast('🔗 Link mobil copiat — trimite-l angajatului pe WhatsApp')
          } catch (e) { showToast('Eroare: ' + e.message, 'error') }
        }} style={{ ...S.btnS, color:G.blue, borderColor:G.blue + '66' }}>🔗 Link mobil</button>}
        <button onClick={() => exportZip(fltEmp ? parseInt(fltEmp) : null)} style={S.btnS}>📦 Export ZIP</button>
        <button onClick={() => setShowNew(true)} style={S.btnP}>➕ Cerere nouă</button>
      </div>

      {loading ? <div style={{ padding:40, textAlign:'center', color:G.muted }}>⏳ Se încarcă...</div> : (
        filtered.length === 0 ? <div style={{ padding:40, textAlign:'center', color:G.muted, background:G.surface, borderRadius:12, border:`1px solid ${G.border}` }}>Nicio cerere pe filtrele curente.</div> :
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          {filtered.map(c => {
            const emp = empMap[c.employee_id]
            const st = STATUS_INFO[c.status] || STATUS_INFO.depusa
            const sold = soldMap[c.employee_id]
            const potSemnaMp = c.status === 'depusa' && (profile?.id === c.aprobator_id)
            const potSemnaHr = c.status === 'aprobata_mp' && isHR && profile?.id !== c.aprobator_id
            return (
              <div key={c.id} style={{ padding:'12px 16px', background:G.surface, border:`1px solid ${st.color}44`, borderRadius:10, display:'flex', gap:14, alignItems:'center', flexWrap:'wrap' }}>
                <div style={{ minWidth:220 }}>
                  <div style={{ fontWeight:700, color:G.text, fontSize:14 }}>{emp?.name || `#${c.employee_id}`}</div>
                  <div style={{ fontSize:11, color:G.muted }}>{(emp?.functie || '').trim()} · sold CO: <b style={{ color:(sold?.sold ?? 0) < 0 ? G.red : G.green }}>{sold?.sold ?? '—'}</b> zile</div>
                </div>
                <div style={{ minWidth:200 }}>
                  <div style={{ fontSize:13, color:G.text }}>{fmtD(c.data_start)} → {fmtD(c.data_sfarsit)} · <b>{c.nr_zile_lucratoare} zile</b></div>
                  <div style={{ fontSize:11, color:G.muted }}>către: {profNames[c.aprobator_id] || '—'} · an {c.an}</div>
                </div>
                <span style={{ padding:'4px 10px', borderRadius:6, fontSize:12, fontWeight:700, background:st.color + '22', color:st.color }}>{st.emoji} {st.label}</span>
                {c.motiv_respingere && <span style={{ fontSize:11, color:G.red }}>Motiv: {c.motiv_respingere}</span>}
                <div style={{ flex:1 }} />
                {potSemnaMp && <button disabled={busyId === c.id} onClick={() => semneaza(c, 'mp')} style={{ ...S.btnS, color:G.orange, borderColor:G.orange + '66' }}>🖊️ Semnează (MP/Șef)</button>}
                {potSemnaHr && <button disabled={busyId === c.id} onClick={() => semneaza(c, 'hr')} style={{ ...S.btnS, color:G.green, borderColor:G.green + '66' }}>✅ Semnează (HR)</button>}
                {(potSemnaMp || potSemnaHr) && <button disabled={busyId === c.id} onClick={() => respinge(c)} style={{ ...S.btnS, color:G.red, borderColor:G.red + '44' }}>❌</button>}
                <button onClick={() => openPdf(c)} style={S.btnS}>📄 PDF</button>
              </div>
            )
          })}
        </div>
      )}

      {showNew && <CerereNouaModal employees={employees} aprobatori={aprobatori} rute={rute} soldMap={soldMap} profNames={profNames}
        onClose={() => setShowNew(false)} onSaved={() => { setShowNew(false); loadAll(); showToast('🌴 Cerere depusă!') }} showToast={showToast} />}
    </div>
  )
}

function CerereNouaModal({ employees, aprobatori, rute, soldMap, profNames, onClose, onSaved, showToast }) {
  const [empId, setEmpId] = useState('')
  const [dataStart, setDataStart] = useState('')
  const [dataSfarsit, setDataSfarsit] = useState('')
  const [nrZile, setNrZile] = useState(null)
  const [aprobatorId, setAprobatorId] = useState('')
  const [saving, setSaving] = useState(false)
  const an = new Date().getFullYear()

  const emp = employees.find(e => String(e.id) === empId)
  const rutaFixa = empId ? rute[parseInt(empId)] : null
  const mpList = aprobatori.filter(a => a.tip === 'mp')
  const sold = empId ? soldMap[parseInt(empId)] : null

  // Nr zile lucrătoare — calculat în BD (fără weekend + fără calendar_days)
  useEffect(() => {
    if (!dataStart || !dataSfarsit || dataSfarsit < dataStart) { setNrZile(null); return }
    let alive = true
    supabase.rpc('fn_zile_lucratoare', { p_start: dataStart, p_end: dataSfarsit })
      .then(({ data, error }) => { if (alive) setNrZile(error ? null : data) })
    return () => { alive = false }
  }, [dataStart, dataSfarsit])

  useEffect(() => { setAprobatorId(rutaFixa || '') }, [empId])  // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (!empId) { showToast('Alege angajatul', 'error'); return }
    if (!dataStart || !dataSfarsit || dataSfarsit < dataStart) { showToast('Perioadă invalidă', 'error'); return }
    if (!nrZile || nrZile < 1) { showToast('Perioada nu conține zile lucrătoare', 'error'); return }
    const aprob = rutaFixa || aprobatorId
    if (!aprob) { showToast('Alege MP-ul / Șeful de birou', 'error'); return }
    setSaving(true)
    try {
      const { error } = await supabase.from('hr_cereri_concediu').insert({
        employee_id: parseInt(empId), an, data_start: dataStart, data_sfarsit: dataSfarsit,
        nr_zile_lucratoare: nrZile, aprobator_id: aprob, status:'depusa', sursa:'erp',
      })
      if (error) throw error
      onSaved()
    } catch (e) { showToast('Eroare: ' + e.message, 'error') }
    finally { setSaving(false) }
  }

  return (
    <div onClick={onClose} style={{ position:'fixed', inset:0, background:'#000A', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 }}>
      <div onClick={e => e.stopPropagation()} style={{ width:520, maxWidth:'94vw', maxHeight:'90vh', overflowY:'auto', background:G.card, border:`1px solid ${G.border}`, borderRadius:14, padding:22 }}>
        <div style={{ fontSize:17, fontWeight:800, color:G.text, marginBottom:16 }}>🌴 Cerere concediu de odihnă — {an}</div>

        <label style={S.label}>Angajat *</label>
        <select value={empId} onChange={e => setEmpId(e.target.value)} style={{ ...S.input, marginBottom:12 }}>
          <option value="">— alege —</option>
          {employees.filter(e => e.active !== false).map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>

        {emp && (
          <div style={{ padding:'10px 12px', background:G.card2, borderRadius:8, marginBottom:12, fontSize:12, color:G.muted }}>
            Funcția: <b style={{ color:G.text }}>{(emp.functie || '—').trim()}</b>
            {sold && <> · Sold CO {an}: <b style={{ color: sold.sold < 0 ? G.red : G.green }}>{sold.sold}</b> din {sold.drept_zile} zile</>}
          </div>
        )}

        <div style={{ display:'flex', gap:10, marginBottom:12 }}>
          <div style={{ flex:1 }}>
            <label style={S.label}>De la *</label>
            <input type="date" value={dataStart} onChange={e => setDataStart(e.target.value)} style={S.input} />
          </div>
          <div style={{ flex:1 }}>
            <label style={S.label}>Până la *</label>
            <input type="date" value={dataSfarsit} min={dataStart || undefined} onChange={e => setDataSfarsit(e.target.value)} style={S.input} />
          </div>
        </div>

        {nrZile != null && (
          <div style={{ padding:'10px 12px', background:G.green + '11', border:`1px solid ${G.green}44`, borderRadius:8, marginBottom:12, fontSize:13, color:G.text }}>
            📅 <b>{nrZile} zile lucrătoare</b> (fără weekenduri și sărbători legale)
            {sold && nrZile > sold.sold && <span style={{ color:G.yellow }}> · ⚠️ depășește soldul ({sold.sold})</span>}
          </div>
        )}

        <label style={S.label}>Se aprobă de către *</label>
        {rutaFixa ? (
          <div style={{ ...S.input, marginBottom:16, background:G.card2, color:G.text }}>
            {profNames[rutaFixa] || rutaFixa} <span style={{ fontSize:11, color:G.muted }}>(rută fixă)</span>
          </div>
        ) : (
          <select value={aprobatorId} onChange={e => setAprobatorId(e.target.value)} style={{ ...S.input, marginBottom:16 }}>
            <option value="">— alege MP —</option>
            {mpList.map(a => <option key={a.id} value={a.profile_id}>{a.eticheta || profNames[a.profile_id]}</option>)}
          </select>
        )}
        <div style={{ fontSize:11, color:G.muted, marginBottom:16 }}>+ HR (Natalia Udrea) semnează întotdeauna al doilea.</div>

        <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
          <button onClick={onClose} style={S.btnS} disabled={saving}>Anulează</button>
          <button onClick={save} style={S.btnP} disabled={saving}>{saving ? '⏳...' : '📨 Depune cererea'}</button>
        </div>
      </div>
    </div>
  )
}
