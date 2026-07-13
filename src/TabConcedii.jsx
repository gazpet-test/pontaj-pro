/* TabConcedii.jsx — Cereri concediu de odihnă (spec_cereri_concediu_mobil)
   Faza 2+3: formular cerere (nume/funcție/an auto, zile lucrătoare auto), PDF tip cu
   semnături din BD, coadă aprobare + arhivă per angajat + export ZIP.
   13.07.2026 — Generator cereri CO:
   - Auto-generare din pontaj (trigger BD) când se marchează CO fără cerere depusă +
     buton „Generează cereri lipsă" (backfill) — cererile auto poartă mesajul legal.
   - Aprobare doar Natalia Udrea (1B): unic aprobator, semnează ambii pași.
   - Edit/Delete pe cereri; aprobatele copiate și în „Documente personale" (dosar angajat).
   - Descarcă cerere goală (template) + Import cerere scanată de mână (PDF). */
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
const HR_PROFILE_ID = '38d7120e-76be-40f5-9159-47f89b907bcc' // Natalia Udrea — aprobator unic (1B)

const STATUS_INFO = {
  depusa:      { label:'Depusă — așteaptă aprobare', emoji:'📨', color:G.yellow },
  aprobata_mp: { label:'Semnată — așteaptă HR',      emoji:'🖊️', color:G.orange },
  aprobata:    { label:'Aprobată',                    emoji:'✅', color:G.green },
  respinsa:    { label:'Respinsă',                     emoji:'❌', color:G.red },
  anulata:     { label:'Anulată',                      emoji:'⛔', color:G.dim },
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

// HTML cerere tip RO → PDF A4. opts.blank = template necompletat de printat.
function buildCerereHTML(c, emp, aprobatorNume, semn, opts = {}) {
  const blank = opts.blank
  const bl = (txt, w = 220) => blank ? `<span style="display:inline-block;border-bottom:1px solid #333;min-width:${w}px;">&nbsp;</span>` : `<b>${txt}</b>`
  const semnBox = (rol, nume, dataUrl, laData) => `
    <td style="width:33%;text-align:center;vertical-align:top;padding:10px 6px;">
      <div style="font-size:10px;color:#555;">${rol}</div>
      <div style="font-size:11px;font-weight:bold;margin-top:2px;">${nume || (blank ? '&nbsp;' : '—')}</div>
      ${dataUrl ? `<img src="${dataUrl}" style="max-height:52px;max-width:150px;margin-top:6px;"/>` :
        (laData ? `<div style="margin-top:14px;font-size:9px;color:#333;border:1px solid #999;border-radius:4px;display:inline-block;padding:4px 8px;">Aprobat electronic<br/>${laData}</div>` :
          `<div style="height:52px;"></div>`)}
      ${laData ? `<div style="font-size:9px;color:#777;margin-top:3px;">${laData}</div>` : ''}
    </td>`
  const notaLegala = (!blank && c.sursa === 'reconciliere' && c.observatii) ? `
    <div style="margin-top:22px;padding:10px 12px;border:1px solid #c0392b;background:#fdecea;border-radius:6px;font-size:10.5px;color:#7b241c;line-height:1.5;">
      <b>⚠️ Notă:</b> ${c.observatii}
    </div>` : ''
  return `<div style="width:794px;background:#fff;color:#000;font-family:Arial,sans-serif;font-size:13px;padding:48px 56px;">
    <div style="text-align:right;font-size:11px;color:#333;">S.C. GAZPET INSTAL S.R.L.<br/>Nr. înreg. ______ / ____________</div>
    <div style="text-align:center;font-size:20px;font-weight:bold;letter-spacing:1px;margin:30px 0 26px;">CERERE CONCEDIU DE ODIHNĂ</div>
    <div style="line-height:2;text-align:justify;">
      Subsemnatul(a), ${bl(emp?.name || '', 260)}, angajat(ă) al S.C. GAZPET INSTAL S.R.L. în funcția de
      ${bl((emp?.functie || '').trim(), 200)}, vă rog să-mi aprobați efectuarea unui număr de
      ${bl((c?.nr_zile_lucratoare ?? '') + (blank ? '' : ' zile lucrătoare'), 60)} ${blank ? 'zile lucrătoare' : ''} de concediu de odihnă aferent anului ${bl(c?.an || '', 60)},
      în perioada ${bl(fmtD(c?.data_start), 120)} — ${bl(fmtD(c?.data_sfarsit), 120)}.
    </div>
    <div style="margin-top:30px;line-height:1.8;">Vă mulțumesc.</div>
    <table style="width:100%;border-collapse:collapse;margin-top:44px;">
      <tr>
        ${semnBox('Angajat', emp?.name, semn.angajat, null)}
        ${semnBox('Aprobat', aprobatorNume, semn.mp, semn.mpLa)}
        ${semnBox('HR', semn.hrNume || 'Natalia Udrea', semn.hr, semn.hrLa)}
      </tr>
    </table>
    ${notaLegala}
    <div style="margin-top:36px;font-size:11px;color:#333;">Data cererii: ${blank ? '____________' : fmtD(c.created_at?.slice(0,10) || new Date().toISOString().slice(0,10))}</div>
    <div style="margin-top:26px;border-top:1px solid #ccc;padding-top:8px;font-size:9px;color:#888;">
      ${blank ? 'Formular tip Gazpet ERP · Zilele lucrătoare exclud weekendurile și sărbătorile legale.' :
        `Generat automat din Gazpet ERP · Cerere #${c.id} · Zilele lucrătoare exclud weekendurile și sărbătorile legale.`}
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
  const [rute, setRute] = useState({})               // employee_id → aprobator_profile_id (păstrat pt. mobil)
  const [soldMap, setSoldMap] = useState({})         // employee_id → {drept, consumate, sold}
  const [profNames, setProfNames] = useState({})     // profile_id → name
  const [tipDocId, setTipDocId] = useState(null)     // id tip „cerere_concediu" pt. copiere în dosar
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [editC, setEditC] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [fltEmp, setFltEmp] = useState('')
  const [fltStatus, setFltStatus] = useState('active')
  const [vederArhiva, setVederArhiva] = useState(false)

  const empMap = useMemo(() => Object.fromEntries(employees.map(e => [e.id, e])), [employees])
  const isHR = profile?.is_owner || profile?.id === HR_PROFILE_ID || profile?.department === 'HR'

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [cer, rt, sold, prof, tip] = await Promise.all([
        supabase.from('hr_cereri_concediu').select('*').order('created_at', { ascending:false }),
        supabase.from('hr_concediu_rute').select('employee_id, aprobator_profile_id'),
        supabase.from('v_hr_sold_co').select('*'),
        supabase.from('profiles').select('id, name'),
        supabase.from('hr_documente_personale_tipuri').select('id').eq('cod', 'cerere_concediu').maybeSingle(),
      ])
      setCereri(cer.data || [])
      setRute(Object.fromEntries((rt.data || []).map(r => [r.employee_id, r.aprobator_profile_id])))
      setSoldMap(Object.fromEntries((sold.data || []).map(s => [s.employee_id, s])))
      setProfNames(Object.fromEntries((prof.data || []).map(p => [p.id, p.name])))
      setTipDocId(tip.data?.id || null)
    } catch (e) { showToast('Eroare încărcare concedii: ' + e.message, 'error') }
    finally { setLoading(false) }
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadAll() }, [loadAll])

  // Generează + urcă PDF-ul final (cu semnăturile disponibile la momentul respectiv)
  const regeneratePdf = async (c) => {
    const emp = empMap[c.employee_id]
    const aprobNume = profNames[c.aprobator_id] || 'Natalia Udrea'
    const semn = {
      angajat: await fetchSemnaturaDataURL(c.employee_id),
      mp: await fetchSemnaturaDataURL(APROBATOR_EMP[c.semnat_mp_de]),
      mpLa: c.semnat_mp_la ? new Date(c.semnat_mp_la).toLocaleDateString('ro-RO') : null,
      hr: await fetchSemnaturaDataURL(APROBATOR_EMP[c.semnat_hr_de]),
      hrLa: c.semnat_hr_la ? new Date(c.semnat_hr_la).toLocaleDateString('ro-RO') : null,
      hrNume: profNames[c.semnat_hr_de] || 'Natalia Udrea',
    }
    const blob = await generatePdfBlob(buildCerereHTML(c, emp, aprobNume, semn))
    const path = `concedii/${c.employee_id}/${c.an}_cerere_${c.id}.pdf`
    const { error: eUp } = await supabase.storage.from('documente-personal').upload(path, blob, { upsert:true, contentType:'application/pdf' })
    if (eUp) throw eUp
    await supabase.from('hr_cereri_concediu').update({ pdf_path: path }).eq('id', c.id)
    return path
  }

  // 3B — copiază cererea aprobată în „Documente personale" ale angajatului (dosar)
  const copiazaInDosar = async (c, pdfPath) => {
    if (!tipDocId || !pdfPath) return
    try {
      const { data: existing } = await supabase.from('hr_documente_personale')
        .select('id').eq('fisier_path', pdfPath).is('deleted_at', null).maybeSingle()
      if (existing) return
      const { data: { user } } = await supabase.auth.getUser()
      await supabase.from('hr_documente_personale').insert({
        employee_id: c.employee_id, tip_id: tipDocId,
        emitent: 'Gazpet ERP', data_emitere: c.data_start, fara_expirare: true,
        fisier_path: pdfPath, fisier_nume: `cerere_concediu_${c.an}_${c.id}.pdf`, fisier_mime: 'application/pdf',
        observatii: `Cerere CO ${fmtD(c.data_start)}–${fmtD(c.data_sfarsit)} · ${c.nr_zile_lucratoare} zile`,
        uploadat_de: user?.id || null, activ: true,
      })
    } catch (e) { console.warn('copiere dosar:', e.message) }
  }

  const openPdf = async (c) => {
    try {
      // cererile importate scanat au PDF-ul de mână în scan_path
      const path = c.scan_path || c.pdf_path || await regeneratePdf(c)
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
      if (rol === 'hr') {
        const path = await regeneratePdf(data)  // PDF final cu toate semnăturile
        await copiazaInDosar(data, path)        // 3B → dosarul angajatului
      }
      showToast(rol === 'mp' ? '🖊️ Semnat — mai trebuie semnătura HR' : '✅ Aprobată + PDF în arhivă și în dosarul angajatului')
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

  const stergeCerere = async (c) => {
    const emp = empMap[c.employee_id]
    if (!window.confirm(`Ștergi cererea ${emp?.name || '#' + c.employee_id} (${fmtD(c.data_start)}–${fmtD(c.data_sfarsit)})?\n\nAcțiune ireversibilă. PDF-ul din arhivă și copia din dosar se șterg.`)) return
    setBusyId(c.id)
    try {
      const paths = [c.pdf_path, c.scan_path].filter(Boolean)
      if (paths.length) await supabase.storage.from('documente-personal').remove(paths)
      if (c.pdf_path) await supabase.from('hr_documente_personale').update({ deleted_at: new Date().toISOString() }).eq('fisier_path', c.pdf_path)
      const { error } = await supabase.from('hr_cereri_concediu').delete().eq('id', c.id)
      if (error) throw error
      showToast('🗑 Cerere ștearsă'); loadAll()
    } catch (e) { showToast('Eroare ștergere: ' + e.message, 'error') }
    finally { setBusyId(null) }
  }

  // Descarcă cerere goală (template printabil) — pt. angajați care nu folosesc sistemul online
  const downloadTemplate = async () => {
    try {
      showToast('⏳ Generez formularul...')
      const blob = await generatePdfBlob(buildCerereHTML(null, null, null, { hrNume:'' }, { blank:true }))
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob); a.download = 'cerere_concediu_gazpet_necompletata.pdf'; a.click()
      URL.revokeObjectURL(a.href)
    } catch (e) { showToast('Eroare template: ' + e.message, 'error') }
  }

  // Backfill — generează cererile lipsă pentru tot CO-ul pontat fără cerere (2A)
  const genereazaLipsa = async () => {
    if (!window.confirm('Generez cererile de concediu lipsă pentru tot CO-ul pontat fără cerere depusă?\n\nCererile vor apărea ca „depuse", cu mesajul legal, către Natalia pentru aprobare.')) return
    setBusyId('backfill')
    try {
      const { data, error } = await supabase.rpc('fn_concediu_autogen', { p_employee_id: null })
      if (error) throw error
      showToast(data > 0 ? `✅ ${data} cereri lipsă generate` : 'Nu există CO neacoperit — nimic de generat')
      loadAll()
    } catch (e) { showToast('Eroare generare: ' + e.message, 'error') }
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
        const path = c.scan_path || c.pdf_path || await regeneratePdf(c)
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

  // Arhivă: aprobate grupate pe angajat
  const arhivaGrupata = useMemo(() => {
    const aprob = cereri.filter(c => c.status === 'aprobata' && (!fltEmp || String(c.employee_id) === fltEmp))
    const g = {}
    aprob.forEach(c => { (g[c.employee_id] = g[c.employee_id] || []).push(c) })
    return Object.entries(g)
      .map(([eid, list]) => ({ eid: Number(eid), name: empMap[Number(eid)]?.name || `#${eid}`, list }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [cereri, fltEmp, empMap])

  const pending = cereri.filter(c => ['depusa','aprobata_mp'].includes(c.status)).length

  return (
    <div>
      <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap', marginBottom:16 }}>
        <h3 style={{ margin:0, fontSize:17, color:G.text }}>🌴 Cereri concediu de odihnă {pending > 0 && <span style={{ fontSize:12, color:G.yellow }}>({pending} în așteptare)</span>}</h3>
        <div style={{ flex:1 }} />
        <select value={fltEmp} onChange={e => setFltEmp(e.target.value)} style={{ ...S.input, width:220 }}>
          <option value="">Toți angajații</option>
          {employees.filter(e => e.active !== false).map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        {!vederArhiva && (
          <select value={fltStatus} onChange={e => setFltStatus(e.target.value)} style={{ ...S.input, width:190 }}>
            <option value="active">🔔 De aprobat</option>
            <option value="toate">Toate</option>
            {Object.entries(STATUS_INFO).map(([k, v]) => <option key={k} value={k}>{v.emoji} {v.label}</option>)}
          </select>
        )}
        <button onClick={() => setVederArhiva(v => !v)} style={{ ...S.btnS, color: vederArhiva ? G.hr : G.muted, borderColor: vederArhiva ? G.hr + '88' : G.border }}>
          {vederArhiva ? '📋 Cereri' : '🗂️ Arhivă'}
        </button>
        {fltEmp && <button onClick={async () => {
          try {
            const { data } = await supabase.from('hr_concediu_tokens').select('token').eq('employee_id', parseInt(fltEmp)).eq('activ', true).maybeSingle()
            if (!data?.token) { showToast('Angajatul nu are token activ', 'error'); return }
            const url = `${window.location.origin}/co?t=${data.token}`
            await navigator.clipboard.writeText(url)
            showToast('🔗 Link mobil copiat — trimite-l angajatului pe WhatsApp')
          } catch (e) { showToast('Eroare: ' + e.message, 'error') }
        }} style={{ ...S.btnS, color:G.blue, borderColor:G.blue + '66' }}>🔗 Link mobil</button>}
        <button onClick={() => exportZip(fltEmp ? parseInt(fltEmp) : null)} style={S.btnS}>📦 Export ZIP</button>
        <button onClick={downloadTemplate} style={S.btnS} title="Cerere tip necompletată, de printat">📄 Cerere goală</button>
        {isHR && <button onClick={() => setShowImport(true)} style={S.btnS} title="Import cerere scrisă de mână (PDF scanat)">📥 Import scanată</button>}
        {isHR && <button disabled={busyId === 'backfill'} onClick={genereazaLipsa} style={{ ...S.btnS, color:G.orange, borderColor:G.orange + '66' }} title="Generează cererile lipsă din pontajul CO">
          {busyId === 'backfill' ? '⏳...' : '🔄 Generează cereri lipsă'}
        </button>}
        <button onClick={() => setShowNew(true)} style={S.btnP}>➕ Cerere nouă</button>
      </div>

      {loading ? <div style={{ padding:40, textAlign:'center', color:G.muted }}>⏳ Se încarcă...</div> : (
        vederArhiva ? (
          arhivaGrupata.length === 0 ? <div style={{ padding:40, textAlign:'center', color:G.muted, background:G.surface, borderRadius:12, border:`1px solid ${G.border}` }}>Nicio cerere aprobată în arhivă.</div> :
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
            {arhivaGrupata.map(gr => (
              <div key={gr.eid} style={{ background:G.surface, border:`1px solid ${G.border}`, borderRadius:12, padding:'12px 16px' }}>
                <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:8 }}>
                  <div style={{ fontWeight:700, color:G.text, fontSize:14 }}>{gr.name}</div>
                  <span style={{ fontSize:12, color:G.green }}>{gr.list.length} cereri aprobate</span>
                  <div style={{ flex:1 }} />
                  <button onClick={() => exportZip(gr.eid)} style={S.btnS}>📦 ZIP angajat</button>
                </div>
                <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
                  {gr.list.sort((a, b) => b.data_start.localeCompare(a.data_start)).map(c => (
                    <button key={c.id} onClick={() => openPdf(c)} style={{ ...S.btnS, color:G.text, display:'flex', alignItems:'center', gap:6 }}>
                      📄 {fmtD(c.data_start)}–{fmtD(c.data_sfarsit)} · {c.nr_zile_lucratoare}z {c.sursa === 'reconciliere' && <span title="Auto-generată" style={{ color:G.orange }}>⚙️</span>}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) :
        filtered.length === 0 ? <div style={{ padding:40, textAlign:'center', color:G.muted, background:G.surface, borderRadius:12, border:`1px solid ${G.border}` }}>Nicio cerere pe filtrele curente.</div> :
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          {filtered.map(c => {
            const emp = empMap[c.employee_id]
            const st = STATUS_INFO[c.status] || STATUS_INFO.depusa
            const sold = soldMap[c.employee_id]
            // 1B — Natalia (HR) e aprobator unic: poate semna ambii pași
            const potSemnaMp = c.status === 'depusa' && (isHR || profile?.id === c.aprobator_id)
            const potSemnaHr = c.status === 'aprobata_mp' && isHR
            const potEdita = isHR && ['depusa','aprobata_mp'].includes(c.status)
            const eAuto = c.sursa === 'reconciliere'
            const eScan = c.sursa === 'import_scanat'
            return (
              <div key={c.id} style={{ padding:'12px 16px', background:G.surface, border:`1px solid ${st.color}44`, borderRadius:10, display:'flex', gap:14, alignItems:'center', flexWrap:'wrap' }}>
                <div style={{ minWidth:210 }}>
                  <div style={{ fontWeight:700, color:G.text, fontSize:14 }}>{emp?.name || `#${c.employee_id}`}</div>
                  <div style={{ fontSize:11, color:G.muted }}>{(emp?.functie || '').trim()} · sold CO: <b style={{ color:(sold?.sold ?? 0) < 0 ? G.red : G.green }}>{sold?.sold ?? '—'}</b> zile</div>
                </div>
                <div style={{ minWidth:190 }}>
                  <div style={{ fontSize:13, color:G.text }}>{fmtD(c.data_start)} → {fmtD(c.data_sfarsit)} · <b>{c.nr_zile_lucratoare} zile</b></div>
                  <div style={{ fontSize:11, color:G.muted }}>către: {profNames[c.aprobator_id] || 'Natalia Udrea'} · an {c.an}</div>
                </div>
                <span style={{ padding:'4px 10px', borderRadius:6, fontSize:12, fontWeight:700, background:st.color + '22', color:st.color }}>{st.emoji} {st.label}</span>
                {eAuto && <span title="Generată automat din pontaj CO" style={{ padding:'4px 8px', borderRadius:6, fontSize:11, fontWeight:700, background:G.orange + '22', color:G.orange }}>⚙️ AUTO</span>}
                {eScan && <span title="Import cerere scanată de mână" style={{ padding:'4px 8px', borderRadius:6, fontSize:11, fontWeight:700, background:G.blue + '22', color:G.blue }}>📥 SCAN</span>}
                {c.motiv_respingere && <span style={{ fontSize:11, color:G.red }}>Motiv: {c.motiv_respingere}</span>}
                <div style={{ flex:1 }} />
                {potSemnaMp && <button disabled={busyId === c.id} onClick={() => semneaza(c, 'mp')} style={{ ...S.btnS, color:G.orange, borderColor:G.orange + '66' }}>🖊️ Semnează (1/2)</button>}
                {potSemnaHr && <button disabled={busyId === c.id} onClick={() => semneaza(c, 'hr')} style={{ ...S.btnS, color:G.green, borderColor:G.green + '66' }}>✅ Aprobă (HR)</button>}
                {(potSemnaMp || potSemnaHr) && <button disabled={busyId === c.id} onClick={() => respinge(c)} style={{ ...S.btnS, color:G.red, borderColor:G.red + '44' }}>❌</button>}
                {potEdita && <button disabled={busyId === c.id} onClick={() => setEditC(c)} style={S.btnS} title="Editează perioada/zilele">✏️</button>}
                {isHR && <button disabled={busyId === c.id} onClick={() => stergeCerere(c)} style={{ ...S.btnS, color:G.red, borderColor:G.red + '44' }} title="Șterge cererea">🗑</button>}
                <button onClick={() => openPdf(c)} style={S.btnS}>📄 PDF</button>
                {eAuto && c.observatii && (
                  <div style={{ flexBasis:'100%', marginTop:2, padding:'8px 10px', background:G.red + '11', border:`1px solid ${G.red}33`, borderRadius:8, fontSize:11, color:G.red, lineHeight:1.5 }}>
                    ⚠️ {c.observatii}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {showNew && <CerereNouaModal employees={employees} rute={rute} soldMap={soldMap} profNames={profNames}
        onClose={() => setShowNew(false)} onSaved={() => { setShowNew(false); loadAll(); showToast('🌴 Cerere depusă!') }} showToast={showToast} />}
      {showImport && <ImportScanModal employees={employees} soldMap={soldMap}
        onClose={() => setShowImport(false)} onSaved={() => { setShowImport(false); loadAll(); showToast('📥 Cerere scanată importată!') }} showToast={showToast} />}
      {editC && <EditCerereModal cerere={editC}
        onClose={() => setEditC(null)} onSaved={() => { setEditC(null); loadAll(); showToast('✏️ Cerere actualizată') }} showToast={showToast} />}
    </div>
  )
}

// ─────────── Modal: Cerere nouă (aprobator unic = Natalia, 1B) ───────────
function CerereNouaModal({ employees, rute, soldMap, profNames, onClose, onSaved, showToast }) {
  const [empId, setEmpId] = useState('')
  const [dataStart, setDataStart] = useState('')
  const [dataSfarsit, setDataSfarsit] = useState('')
  const [nrZile, setNrZile] = useState(null)
  const [saving, setSaving] = useState(false)
  const an = new Date().getFullYear()

  const emp = employees.find(e => String(e.id) === empId)
  const sold = empId ? soldMap[parseInt(empId)] : null

  useEffect(() => {
    if (!dataStart || !dataSfarsit || dataSfarsit < dataStart) { setNrZile(null); return }
    let alive = true
    supabase.rpc('fn_zile_lucratoare', { p_start: dataStart, p_end: dataSfarsit })
      .then(({ data, error }) => { if (alive) setNrZile(error ? null : data) })
    return () => { alive = false }
  }, [dataStart, dataSfarsit])

  const save = async () => {
    if (!empId) { showToast('Alege angajatul', 'error'); return }
    if (!dataStart || !dataSfarsit || dataSfarsit < dataStart) { showToast('Perioadă invalidă', 'error'); return }
    if (!nrZile || nrZile < 1) { showToast('Perioada nu conține zile lucrătoare', 'error'); return }
    setSaving(true)
    try {
      const { error } = await supabase.from('hr_cereri_concediu').insert({
        employee_id: parseInt(empId), an, data_start: dataStart, data_sfarsit: dataSfarsit,
        nr_zile_lucratoare: nrZile, aprobator_id: HR_PROFILE_ID, status:'depusa', sursa:'erp',
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

        <div style={{ padding:'10px 12px', background:G.hr + '11', border:`1px solid ${G.hr}44`, borderRadius:8, marginBottom:16, fontSize:12.5, color:G.text }}>
          Se aprobă de către <b>Natalia Udrea</b> (HR).
        </div>

        <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
          <button onClick={onClose} style={S.btnS} disabled={saving}>Anulează</button>
          <button onClick={save} style={S.btnP} disabled={saving}>{saving ? '⏳...' : '📨 Depune cererea'}</button>
        </div>
      </div>
    </div>
  )
}

// ─────────── Modal: Import cerere scanată de mână (PDF) ───────────
function ImportScanModal({ employees, soldMap, onClose, onSaved, showToast }) {
  const [empId, setEmpId] = useState('')
  const [dataStart, setDataStart] = useState('')
  const [dataSfarsit, setDataSfarsit] = useState('')
  const [nrZile, setNrZile] = useState(null)
  const [nrManual, setNrManual] = useState('')   // Natalia poate suprascrie manual
  const [file, setFile] = useState(null)
  const [saving, setSaving] = useState(false)
  const an = dataStart ? Number(dataStart.slice(0, 4)) : new Date().getFullYear()
  const emp = employees.find(e => String(e.id) === empId)
  const sold = empId ? soldMap[parseInt(empId)] : null

  useEffect(() => {
    if (!dataStart || !dataSfarsit || dataSfarsit < dataStart) { setNrZile(null); return }
    let alive = true
    supabase.rpc('fn_zile_lucratoare', { p_start: dataStart, p_end: dataSfarsit })
      .then(({ data, error }) => { if (alive) setNrZile(error ? null : data) })
    return () => { alive = false }
  }, [dataStart, dataSfarsit])

  const zileFinal = nrManual !== '' ? parseInt(nrManual) : nrZile

  const save = async () => {
    if (!empId) { showToast('Alege angajatul', 'error'); return }
    if (!dataStart || !dataSfarsit || dataSfarsit < dataStart) { showToast('Perioadă invalidă', 'error'); return }
    if (!zileFinal || zileFinal < 1) { showToast('Completează nr. de zile', 'error'); return }
    if (!file) { showToast('Atașează PDF-ul scanat', 'error'); return }
    if (file.type !== 'application/pdf') { showToast('Doar PDF', 'error'); return }
    if (file.size > 10485760) { showToast('PDF prea mare (max 10MB)', 'error'); return }
    setSaving(true)
    try {
      // 1) insert cerere (pt. a avea id-ul în path)
      const { data: c, error } = await supabase.from('hr_cereri_concediu').insert({
        employee_id: parseInt(empId), an, data_start: dataStart, data_sfarsit: dataSfarsit,
        nr_zile_lucratoare: zileFinal, aprobator_id: HR_PROFILE_ID, status:'depusa', sursa:'import_scanat',
        observatii:'Cerere depusă pe hârtie (scanată), completată manual de HR.',
      }).select().single()
      if (error) throw error
      // 2) upload scan
      const path = `concedii/${empId}/scan_${c.id}.pdf`
      const { error: eUp } = await supabase.storage.from('documente-personal').upload(path, file, { upsert:true, contentType:'application/pdf' })
      if (eUp) { await supabase.from('hr_cereri_concediu').delete().eq('id', c.id); throw eUp }
      await supabase.from('hr_cereri_concediu').update({ scan_path: path }).eq('id', c.id)
      onSaved()
    } catch (e) { showToast('Eroare: ' + e.message, 'error') }
    finally { setSaving(false) }
  }

  return (
    <div onClick={onClose} style={{ position:'fixed', inset:0, background:'#000A', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 }}>
      <div onClick={e => e.stopPropagation()} style={{ width:520, maxWidth:'94vw', maxHeight:'90vh', overflowY:'auto', background:G.card, border:`1px solid ${G.border}`, borderRadius:14, padding:22 }}>
        <div style={{ fontSize:17, fontWeight:800, color:G.text, marginBottom:6 }}>📥 Import cerere scanată</div>
        <div style={{ fontSize:12, color:G.muted, marginBottom:16 }}>Pentru angajații care depun cererea pe hârtie. Încarci PDF-ul scanat și completezi datele.</div>

        <label style={S.label}>Angajat *</label>
        <select value={empId} onChange={e => setEmpId(e.target.value)} style={{ ...S.input, marginBottom:12 }}>
          <option value="">— alege —</option>
          {employees.filter(e => e.active !== false).map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>

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

        <label style={S.label}>Nr. zile lucrătoare *</label>
        <input type="number" min={1} value={nrManual} onChange={e => setNrManual(e.target.value)}
          placeholder={nrZile != null ? `auto: ${nrZile}` : 'ex: 5'} style={{ ...S.input, marginBottom:6 }} />
        {nrZile != null && <div style={{ fontSize:11, color:G.muted, marginBottom:12 }}>Calcul automat din perioadă: <b style={{ color:G.green }}>{nrZile} zile</b> (lasă gol pentru a-l folosi){sold && zileFinal > sold.sold && <span style={{ color:G.yellow }}> · ⚠️ depășește soldul ({sold.sold})</span>}</div>}

        <label style={S.label}>PDF scanat *</label>
        <input type="file" accept="application/pdf" onChange={e => setFile(e.target.files?.[0] || null)} style={{ ...S.input, marginBottom:16 }} />

        <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
          <button onClick={onClose} style={S.btnS} disabled={saving}>Anulează</button>
          <button onClick={save} style={S.btnP} disabled={saving}>{saving ? '⏳...' : '📥 Importă cererea'}</button>
        </div>
      </div>
    </div>
  )
}

// ─────────── Modal: Editează cerere (perioadă / zile) ───────────
function EditCerereModal({ cerere, onClose, onSaved, showToast }) {
  const [dataStart, setDataStart] = useState(cerere.data_start)
  const [dataSfarsit, setDataSfarsit] = useState(cerere.data_sfarsit)
  const [nrZile, setNrZile] = useState(cerere.nr_zile_lucratoare)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!dataStart || !dataSfarsit || dataSfarsit < dataStart) { setNrZile(null); return }
    let alive = true
    supabase.rpc('fn_zile_lucratoare', { p_start: dataStart, p_end: dataSfarsit })
      .then(({ data, error }) => { if (alive) setNrZile(error ? null : data) })
    return () => { alive = false }
  }, [dataStart, dataSfarsit])

  const save = async () => {
    if (!dataStart || !dataSfarsit || dataSfarsit < dataStart) { showToast('Perioadă invalidă', 'error'); return }
    if (!nrZile || nrZile < 1) { showToast('Perioada nu conține zile lucrătoare', 'error'); return }
    setSaving(true)
    try {
      const { error } = await supabase.from('hr_cereri_concediu').update({
        data_start: dataStart, data_sfarsit: dataSfarsit, nr_zile_lucratoare: nrZile,
        an: Number(dataStart.slice(0, 4)),
      }).eq('id', cerere.id)
      if (error) throw error
      onSaved()
    } catch (e) { showToast('Eroare: ' + e.message, 'error') }
    finally { setSaving(false) }
  }

  return (
    <div onClick={onClose} style={{ position:'fixed', inset:0, background:'#000A', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 }}>
      <div onClick={e => e.stopPropagation()} style={{ width:460, maxWidth:'94vw', background:G.card, border:`1px solid ${G.border}`, borderRadius:14, padding:22 }}>
        <div style={{ fontSize:16, fontWeight:800, color:G.text, marginBottom:16 }}>✏️ Editează perioada cererii</div>
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
          <div style={{ padding:'10px 12px', background:G.green + '11', border:`1px solid ${G.green}44`, borderRadius:8, marginBottom:16, fontSize:13, color:G.text }}>
            📅 <b>{nrZile} zile lucrătoare</b> (fără weekenduri și sărbători legale)
          </div>
        )}
        <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
          <button onClick={onClose} style={S.btnS} disabled={saving}>Anulează</button>
          <button onClick={save} style={S.btnP} disabled={saving}>{saving ? '⏳...' : '💾 Salvează'}</button>
        </div>
      </div>
    </div>
  )
}
