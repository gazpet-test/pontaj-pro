// ═══════════════════════════════════════════════════════════════════════════
// SupapeDeclaratiiSection.jsx — v1 (29.06.2026)
// Gestiune supape de siguranță per utilaj + Declarație conformitate tehnică.
//
// Logica de business (decizii Razvan):
//  - Fiecare utilaj are nr_supape (1 compresor, 2-3 booster).
//  - Fiecare supapă are o serie + ultima verificare ISCIR (conform/neconform/în așteptare).
//  - O supapă "OK" = activă + rezultat=conform + data_valabilitate >= azi.
//  - Declarația de conformitate iese DOAR când TOATE supapele montate sunt OK
//    (gating prin view v_supape_status.poate_emite_declaratie).
//  - La emitere, starea supapelor se ÎNGHEAȚĂ în snapshot (arhivă imutabilă).
//  - Valabilitatea declarației = cea mai apropiată scadență de supapă.
//  - Semnatar: Mitrache Alexandru (id 71). Semnătura se trage automat dacă există
//    în hr_semnaturi_electronice; altfel rămâne linie pentru semnat manual.
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback } from 'react'
import { supabase } from './lib/supabase.js'
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'
import LOGO_B64 from './logo.js'
import DropZone from './DropZone.jsx'
import { compressFileBeforeUpload } from './utils/compressFile'

const G = {
  bg:'#0D1117', surface:'#161B22', border:'#21262D', border2:'#30363D',
  text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  blue:'#58A6FF', green:'#3FB950', red:'#F85149', yellow:'#D29922',
  purple:'#BC8CFF', orange:'#F0883E',
  greenDim:'#1A3A1A', redDim:'#3A1A1A', yellowDim:'#3A2A0A',
  logistica:'#E3B341',
}
const S = {
  card: { background:G.surface, border:`1px solid ${G.border}`, borderRadius:12 },
  input: { background:G.bg, border:`1px solid ${G.border2}`, color:G.text, borderRadius:8, padding:'8px 12px', fontFamily:'inherit', fontSize:14, outline:'none', width:'100%' },
  btnP: { background:'#1F6FEB', color:'white', border:'none', borderRadius:8, padding:'9px 18px', fontFamily:'inherit', fontSize:14, fontWeight:700, cursor:'pointer' },
  btnS: { background:G.surface, color:G.text, border:`1px solid ${G.border}`, borderRadius:8, padding:'7px 14px', fontFamily:'inherit', fontSize:13, fontWeight:600, cursor:'pointer' },
}

const BUCKET = 'documente-flota'
const SEMNATAR = { id: 71, nume: 'MITRACHE ALEXANDRU', functie: 'Director Departament Logistică', prefix: 'ing.' }

const daysUntil = (d) => d ? Math.ceil((new Date(d) - new Date()) / 86400000) : null
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'

const REZULTAT_META = {
  conform:      { label: 'conform',      emoji: '✅', color: G.green },
  neconform:    { label: 'neconform',    emoji: '❌', color: G.red },
  in_asteptare: { label: 'în așteptare', emoji: '⏳', color: G.yellow },
}

// Status efectiv al unei supape: conform-valid / expirat / neconform / așteptare / fără verificare
function supapaStatus(s) {
  if (!s.rezultat || s.rezultat === 'in_asteptare') return { key: 'asteptare', label: '⏳ În așteptare', color: G.yellow }
  if (s.rezultat === 'neconform') return { key: 'neconform', label: '❌ Neconform', color: G.red }
  const d = daysUntil(s.data_valabilitate)
  if (d === null) return { key: 'fara_data', label: '⚠️ Fără dată', color: G.orange }
  if (d < 0) return { key: 'expirat', label: '⛔ Expirat', color: G.red }
  if (d <= 30) return { key: 'expira', label: `✅ Valabil (${d}z)`, color: G.orange }
  return { key: 'ok', label: `✅ Valabil`, color: G.green }
}

// Fetch semnătură angajat ca dataURL (signed URL → blob → base64); null dacă lipsește
async function fetchSignatureDataURL(employeeId) {
  try {
    const { data: sig } = await supabase
      .from('hr_semnaturi_electronice')
      .select('fisier_path')
      .eq('employee_id', employeeId).eq('activ', true).maybeSingle()
    if (!sig?.fisier_path) return null
    const { data: signed } = await supabase.storage.from('hr-semnaturi').createSignedUrl(sig.fisier_path, 120)
    if (!signed?.signedUrl) return null
    const resp = await fetch(signed.signedUrl)
    const blob = await resp.blob()
    return await new Promise((res) => { const r = new FileReader(); r.onloadend = () => res(r.result); r.onerror = () => res(null); r.readAsDataURL(blob) })
  } catch { return null }
}

// ── OCR client-side pentru buletine scanate (Tesseract + pdf.js din CDN, fără librării în bundle) ──
const CDN_PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
const CDN_PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
const CDN_TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js'

function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[data-src="${src}"]`)) return resolve()
    const s = document.createElement('script')
    s.src = src; s.async = true; s.dataset.src = src
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('Nu am putut încărca componenta OCR'))
    document.head.appendChild(s)
  })
}

async function pdfPrimaPaginaCanvas(file) {
  await loadScriptOnce(CDN_PDFJS)
  const pdfjsLib = window.pdfjsLib
  pdfjsLib.GlobalWorkerOptions.workerSrc = CDN_PDFJS_WORKER
  const buf = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise
  const page = await pdf.getPage(1)
  const viewport = page.getViewport({ scale: 2.5 })
  const canvas = document.createElement('canvas')
  canvas.width = viewport.width; canvas.height = viewport.height
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
  return canvas
}

async function ocrText(file, onProgress) {
  await loadScriptOnce(CDN_TESSERACT)
  const Tesseract = window.Tesseract
  let source = null, objUrl = null
  if (file.type === 'application/pdf') source = await pdfPrimaPaginaCanvas(file)
  else { objUrl = URL.createObjectURL(file); source = objUrl }
  try {
    const res = await Tesseract.recognize(source, 'ron', { logger: m => { if (m.status === 'recognizing text' && onProgress) onProgress(m.progress) } })
    return res?.data?.text || ''
  } finally { if (objUrl) URL.revokeObjectURL(objUrl) }
}

function toISODate(d) {
  if (!d) return null
  const m = d.match(/([0-9]{1,2})\.([0-9]{1,2})\.([0-9]{4})/)
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null
}

// Parser buletin ISCIR/TERMOKLIMA — regex pe text OCR (toleranț la d0→do, diacritice lipsă)
function parseBuletinText(raw) {
  const t = (raw || '').replace(/\s+/g, ' ')
  const out = { serie: null, nr_buletin: null, emitent: null, data_verificare: null, data_valabilitate: null, rezultat: null, pr_bari: null, diametru_curgere_mm: null }
  let m
  m = t.match(/num[ăa]r de fabrica[țt]ie\s+([A-Z0-9.\-]+)/i); if (m) out.serie = m[1].replace(/[.,]+$/, '')
  if (!out.serie) { m = t.match(/serie de fabrica[țt]ie\s+([A-Z0-9.\-]+)/i); if (m) out.serie = m[1].replace(/[.,]+$/, '') }
  m = t.match(/NR\.?\s*([0-9]+)\s*\/\s*([0-9]{1,2}\.[0-9]{1,2}\.[0-9]{4})/i); if (m) { out.nr_buletin = `${m[1]}/${m[2]}`; out.data_verificare = toISODate(m[2]) }
  m = t.match(/poate func[țt]iona p[âa]n[ăa] la data de\s+([0-9]{1,2}\.[0-9]{1,2}\.[0-9]{4})/i); if (m) out.data_valabilitate = toISODate(m[1])
  if (/DECLARA[țT]IE DE NECONFORMITATE/i.test(t)) out.rezultat = 'neconform'
  else if (/DECLARA[țT]IE DE CONFORMITATE/i.test(t)) out.rezultat = 'conform'
  m = t.match(/presiune[a]?\s*de\s*reglare\s*\)\s*=\s*([0-9]+(?:\.[0-9]+)?)/i); if (m) out.pr_bari = parseFloat(m[1])
  m = t.match(/diametru\s*curgere\s*\)\s*=\s*([0-9]+(?:\.[0-9]+)?)/i); if (m) out.diametru_curgere_mm = parseFloat(m[1])
  m = t.match(/(TERMOKLIMA)\s+S\.?\s*R\.?\s*L\.?/i); if (m) out.emitent = 'TERMOKLIMA S.R.L.'
  else { m = t.match(/S\.?\s*C\.?\s+([A-ZĂÂÎȘȚ][A-ZĂÂÎȘȚ ]+?)\s+S\.?\s*R\.?\s*L\.?/i); if (m) out.emitent = m[1].trim() + ' S.R.L.' }
  return out
}

export default function SupapeDeclaratiiSection({ activ, canEdit, showToast }) {
  const [nrSupape, setNrSupape] = useState(activ?.nr_supape ?? 1)
  const [supape, setSupape] = useState([])
  const [declaratii, setDeclaratii] = useState([])
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [editSupapa, setEditSupapa] = useState(null)  // {} nou sau obiect existent
  const [busy, setBusy] = useState(false)
  const [genBusy, setGenBusy] = useState(false)
  const [faraSupapa, setFaraSupapa] = useState(!!activ?.fara_supapa)
  const [categorieAreSupape, setCategorieAreSupape] = useState(false)

  const load = useCallback(async () => {
    if (!activ?.id) return
    setLoading(true)
    const [rSup, rDecl, rSt, rCat] = await Promise.all([
      supabase.from('logistica_supape').select('*').eq('activ_id', activ.id).order('activa', { ascending: false }).order('serie'),
      supabase.from('logistica_declaratii').select('*').eq('activ_id', activ.id).order('generat_la', { ascending: false }),
      supabase.from('v_supape_status').select('*').eq('activ_id', activ.id).maybeSingle(),
      activ?.categorie_id ? supabase.from('logistica_categorii').select('are_supape').eq('id', activ.categorie_id).maybeSingle() : Promise.resolve({ data: null }),
    ])
    setSupape(rSup.data || [])
    setDeclaratii(rDecl.data || [])
    setStatus(rSt.data || null)
    setCategorieAreSupape(rCat?.data?.are_supape === true)
    if (rSt.data) setNrSupape(rSt.data.nr_supape_asteptat)
    setLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activ?.id])

  useEffect(() => { load() }, [load])

  // Override „fără supapă" pe activ (ascunde secțiunea, scoate condiția din declarația tehnică)
  const toggleFaraSupapa = async (val) => {
    if (!canEdit) return
    const { error } = await supabase.from('logistica_active').update({ fara_supapa: val }).eq('id', activ.id)
    if (error) { showToast?.('Eroare la salvare', 'error'); return }
    setFaraSupapa(val)
    showToast?.(val ? '⊘ Marcat fără supapă de siguranță' : '✓ Secțiune supape reactivată', 'success')
  }

  // ── Salvare nr. supape (update direct pe utilaj) ──
  const saveNrSupape = async (n) => {
    const val = Math.max(0, parseInt(n) || 0)
    setNrSupape(val)
    const { error } = await supabase.from('logistica_active').update({ nr_supape: val }).eq('id', activ.id)
    if (error) { showToast?.('Eroare la salvarea nr. supape', 'error'); return }
    await load()
  }

  // ── Salvare supapă (insert/update) + upload buletin PDF opțional ──
  const saveSupapa = async (f, file) => {
    if (!f.serie?.trim()) { showToast?.('Seria supapei e obligatorie', 'error'); return }
    setBusy(true)
    try {
      let pdf_path = f.pdf_path || null, pdf_nume = f.pdf_nume || null
      if (file) {
        const compressed = await compressFileBeforeUpload(file)
        const ext = (file.name.split('.').pop() || 'pdf').toLowerCase()
        const path = `${activ.id}/supape/${f.serie.replace(/[^a-zA-Z0-9]/g, '')}_${Date.now()}.${ext}`
        const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, compressed, { contentType: compressed.type || 'application/pdf', upsert: false })
        if (upErr) throw upErr
        pdf_path = path; pdf_nume = file.name
      }
      const payload = {
        activ_id: activ.id,
        serie: f.serie.trim(),
        producator: f.producator?.trim() || null,
        activa: f.activa !== false,
        nr_buletin: f.nr_buletin?.trim() || null,
        emitent: f.emitent?.trim() || null,
        data_verificare: f.data_verificare || null,
        data_valabilitate: f.data_valabilitate || null,
        rezultat: f.rezultat || null,
        pr_bari: f.pr_bari !== '' && f.pr_bari != null ? Number(f.pr_bari) : null,
        diametru_curgere_mm: f.diametru_curgere_mm !== '' && f.diametru_curgere_mm != null ? Number(f.diametru_curgere_mm) : null,
        pdf_path, pdf_nume,
        observatii: f.observatii?.trim() || null,
        updated_at: new Date().toISOString(),
      }
      if (f.id) {
        const { error } = await supabase.from('logistica_supape').update(payload).eq('id', f.id)
        if (error) throw error
      } else {
        const { data: { user } } = await supabase.auth.getUser()
        const { error } = await supabase.from('logistica_supape').insert({ ...payload, created_by: user?.id || null })
        if (error) throw error
      }
      showToast?.('Supapă salvată', 'success')
      setEditSupapa(null)
      await load()
    } catch (e) {
      showToast?.('Eroare: ' + (e.message || e), 'error')
    } finally { setBusy(false) }
  }

  const stergeSupapa = async (s) => {
    if (!window.confirm(`Ștergi supapa serie ${s.serie}?`)) return
    if (s.pdf_path) { try { await supabase.storage.from(BUCKET).remove([s.pdf_path]) } catch {} }
    const { error } = await supabase.from('logistica_supape').delete().eq('id', s.id)
    if (error) { showToast?.('Eroare la ștergere', 'error'); return }
    showToast?.('Supapă ștearsă', 'success')
    await load()
  }

  const veziPDF = async (path) => {
    if (!path) return
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 120)
    if (error || !data?.signedUrl) { showToast?.('Nu pot deschide documentul', 'error'); return }
    window.open(data.signedUrl, '_blank')
  }

  // ── Generare declarație conformitate (PDF) + arhivare cu snapshot ──
  const genereazaDeclaratie = async () => {
    if (!status?.poate_emite_declaratie) return
    setGenBusy(true)
    try {
      // Snapshot supape active conforme valide
      const supapeOk = supape.filter(s => s.activa && s.rezultat === 'conform' && daysUntil(s.data_valabilitate) >= 0)
      const supapeSnapshot = supapeOk.map(s => ({
        serie: s.serie, producator: s.producator, nr_buletin: s.nr_buletin,
        emitent: s.emitent, data_verificare: s.data_verificare, data_valabilitate: s.data_valabilitate,
        pr_bari: s.pr_bari, diametru_curgere_mm: s.diametru_curgere_mm,
      }))
      // Valabilitate declarație = cea mai apropiată scadență
      const dataValab = supapeSnapshot.reduce((min, s) => (!min || (s.data_valabilitate && s.data_valabilitate < min)) ? s.data_valabilitate : min, null)
      const utilajSnapshot = {
        marca: activ.marca, model: activ.model, serie: activ.serie || activ.serie_sasiu || activ.nr_inmatriculare,
        cod_intern: activ.cod_intern, an: activ.an_fabricatie, ore: activ.ore_functionare_actuale,
      }
      // Numerotare secvențială pe an
      const an = new Date().getFullYear()
      const { count } = await supabase.from('logistica_declaratii').select('id', { count: 'exact', head: true }).gte('data_emitere', `${an}-01-01`)
      const numar = `${String((count || 0) + 1).padStart(3, '0')}/${an}`
      const dataEmitere = new Date().toISOString().slice(0, 10)

      const semnaturaImg = await fetchSignatureDataURL(SEMNATAR.id)
      const blob = await construiestePDF({ numar, dataEmitere, dataValab, utilajSnapshot, supapeSnapshot, semnaturaImg })

      const path = `${activ.id}/declaratii/DC_${numar.replace(/\//g, '-')}_${Date.now()}.pdf`
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'application/pdf', upsert: false })
      if (upErr) throw upErr

      // Lipește buletinele PDF ale supapelor conforme în spatele declarației (Edge Function pdf-lib)
      const anexePaths = supapeOk.map(s => s.pdf_path).filter(Boolean)
      if (anexePaths.length) {
        try {
          await supabase.functions.invoke('merge-declaratie-anexe', { body: { bucket: BUCKET, decl_path: path, anexe_paths: anexePaths } })
        } catch { /* dacă merge-ul eșuează, declarația rămâne fără anexe — nu blocăm */ }
      }

      const { data: { user } } = await supabase.auth.getUser()
      const { error: insErr } = await supabase.from('logistica_declaratii').insert({
        activ_id: activ.id, numar, data_emitere: dataEmitere, data_valabilitate: dataValab,
        supape_snapshot: supapeSnapshot, utilaj_snapshot: utilajSnapshot,
        semnatar_nume: `${SEMNATAR.prefix} ${SEMNATAR.nume}`, semnatar_functie: SEMNATAR.functie,
        pdf_path: path, pdf_nume: `Declaratie_conformitate_${numar.replace(/\//g, '-')}.pdf`,
        generat_de: user?.id || null,
      })
      if (insErr) throw insErr

      // download imediat versiunea finală din storage (cu anexe lipite)
      let finalBlob = blob
      try { const { data: fb } = await supabase.storage.from(BUCKET).download(path); if (fb) finalBlob = fb } catch {}
      const url = URL.createObjectURL(finalBlob)
      const a = document.createElement('a'); a.href = url; a.download = `Declaratie_conformitate_${numar.replace(/\//g, '-')}.pdf`; a.click()
      URL.revokeObjectURL(url)
      showToast?.(`Declarație ${numar} generată și arhivată`, 'success')
      await load()
    } catch (e) {
      showToast?.('Eroare generare: ' + (e.message || e), 'error')
    } finally { setGenBusy(false) }
  }

  if (!activ?.id) return null

  // Decide dacă utilajul poate avea supape: categoria marcată SAU deja are supape setate/înregistrate
  const arataSupape = categorieAreSupape || (activ?.nr_supape > 0) || supape.length > 0

  // Marcat explicit „fără supapă" → linie discretă cu opțiune de revenire
  if (faraSupapa) {
    return (
      <div style={{ marginBottom: 14 }}>
        <div style={{ ...S.card, padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', opacity: .9 }}>
          <span style={{ fontSize: 12.5, color: G.muted }}>⊘ Marcat <strong style={{ color: G.text }}>fără supapă de siguranță</strong> — secțiunea nu se aplică acestui utilaj.</span>
          {canEdit && <button onClick={() => toggleFaraSupapa(false)} style={{ ...S.btnS, fontSize: 11, padding: '5px 12px' }}>Are totuși supapă</button>}
        </div>
      </div>
    )
  }

  // Încă se încarcă → nu afișăm nimic (evită flash pe utilajele fără supape)
  if (loading) return null
  // Categorie fără supape + nicio supapă înregistrată → secțiunea nu apare (camioane, autoturisme, excavatoare etc.)
  if (!arataSupape) return null

  const motivBlocat = (() => {
    if (!status) return null
    if (status.nr_supape_asteptat === 0) return 'Setează nr. supape > 0'
    if (status.nr_supape_active < status.nr_supape_asteptat) return `Lipsesc ${status.nr_supape_asteptat - status.nr_supape_active} supape din ${status.nr_supape_asteptat}`
    if (status.nr_neconforme > 0) return `${status.nr_neconforme} supapă/e neconformă/e`
    if (status.nr_in_asteptare > 0) return `${status.nr_in_asteptare} supapă/e fără buletin (în așteptare)`
    if (status.nr_expirate > 0) return `${status.nr_expirate} verificare/i expirată/e`
    return null
  })()

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, color: G.logistica, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.6px', marginBottom: 8 }}>
        🛡️ Supape de siguranță & Declarație conformitate
      </div>

      {/* Nr. supape + status gating */}
      <div style={{ ...S.card, padding: 14, marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: status ? 12 : 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, color: G.muted }}>Nr. supape montate:</span>
            <input type="number" min="0" max="12" value={nrSupape} disabled={!canEdit}
              onChange={e => setNrSupape(e.target.value)} onBlur={e => canEdit && saveNrSupape(e.target.value)}
              style={{ ...S.input, width: 64, textAlign: 'center', fontWeight: 800, fontSize: 16, padding: '6px 8px' }} />
            <span style={{ fontSize: 11, color: G.dim }}>(1 = compresor · 2-3 = booster)</span>
          </div>
        </div>

        {status && (
          <div style={{
            padding: '10px 12px', borderRadius: 8,
            background: status.poate_emite_declaratie ? G.greenDim + 'aa' : G.bg,
            border: `1px solid ${status.poate_emite_declaratie ? G.green + '55' : G.border}`,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
          }}>
            <div style={{ fontSize: 12.5, color: G.text }}>
              <strong style={{ color: status.poate_emite_declaratie ? G.green : G.orange }}>
                {status.nr_conforme_valide}/{status.nr_supape_asteptat}
              </strong> supape conforme & valabile
              {motivBlocat && <span style={{ color: G.orange, marginLeft: 8 }}>· {motivBlocat}</span>}
            </div>
            <button
              onClick={genereazaDeclaratie}
              disabled={!status.poate_emite_declaratie || genBusy || !canEdit}
              title={status.poate_emite_declaratie ? 'Generează declarația de conformitate' : (motivBlocat || 'Necesită toate supapele conforme + valide')}
              style={{
                ...S.btnP,
                background: status.poate_emite_declaratie ? G.green : G.border,
                color: status.poate_emite_declaratie ? '#0D1117' : G.dim,
                cursor: (status.poate_emite_declaratie && canEdit && !genBusy) ? 'pointer' : 'not-allowed',
                opacity: (status.poate_emite_declaratie && canEdit) ? 1 : .7,
              }}>
              {genBusy ? 'Se generează…' : '📄 Generează declarație'}
            </button>
          </div>
        )}

        {canEdit && (
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${G.border}` }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12, color: G.muted }}>
              <input type="checkbox" checked={false} onChange={() => toggleFaraSupapa(true)} style={{ width: 15, height: 15, accentColor: G.orange }} />
              <span>⊘ Acest utilaj <strong style={{ color: G.text }}>nu are supapă</strong> de siguranță (ascunde secțiunea)</span>
            </label>
          </div>
        )}
      </div>

      {/* Lista supape */}
      <div style={{ ...S.card, padding: 0, overflow: 'hidden', marginBottom: 10 }}>
        <div style={{ padding: '8px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: supape.length ? `1px solid ${G.border}` : 'none' }}>
          <span style={{ fontSize: 11, color: G.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.4px' }}>Supape ({supape.length})</span>
          {canEdit && <button onClick={() => setEditSupapa({ activa: true, emitent: 'TERMOKLIMA S.R.L.', rezultat: 'conform' })} style={{ ...S.btnS, padding: '5px 12px', fontSize: 12, color: G.green, borderColor: G.green + '55' }}>+ Adaugă supapă</button>}
        </div>
        {loading ? (
          <div style={{ padding: 16, color: G.dim, fontSize: 12, textAlign: 'center' }}>Se încarcă…</div>
        ) : supape.length === 0 ? (
          <div style={{ padding: 16, color: G.dim, fontSize: 12.5, textAlign: 'center', fontStyle: 'italic' }}>Nicio supapă înregistrată. Adaugă supapele de siguranță cu buletinul de verificare ISCIR.</div>
        ) : supape.map((s, idx) => {
          const st = supapaStatus(s)
          return (
            <div key={s.id} style={{ padding: '10px 14px', borderBottom: idx < supape.length - 1 ? `1px solid ${G.border}` : 'none', display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'center', opacity: s.activa ? 1 : .5 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, color: G.text, fontFamily: 'monospace', fontSize: 13.5 }}>{s.serie}</span>
                  {s.producator && <span style={{ fontSize: 11, color: G.muted }}>{s.producator}</span>}
                  <span style={{ background: st.color + '22', color: st.color, borderRadius: 10, padding: '1px 9px', fontSize: 10.5, fontWeight: 800 }}>{st.label}</span>
                  {!s.activa && <span style={{ background: G.dim + '22', color: G.dim, borderRadius: 10, padding: '1px 9px', fontSize: 10, fontWeight: 700 }}>DEMONTATĂ</span>}
                </div>
                <div style={{ fontSize: 11, color: G.muted, marginTop: 3 }}>
                  {s.nr_buletin && <>Buletin <strong style={{ color: G.text }}>{s.nr_buletin}</strong></>}
                  {s.emitent && <> · {s.emitent}</>}
                  {s.pr_bari != null && <> · Pr {s.pr_bari} bari</>}
                  {s.data_valabilitate && <> · valabil până <strong style={{ color: st.color }}>{fmtDate(s.data_valabilitate)}</strong></>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {s.pdf_path && <button onClick={() => veziPDF(s.pdf_path)} title="Vezi buletin" style={{ ...S.btnS, padding: '5px 10px', fontSize: 12 }}>📄</button>}
                {canEdit && <button onClick={() => setEditSupapa({ ...s })} style={{ ...S.btnS, padding: '5px 10px', fontSize: 12 }}>✏️</button>}
                {canEdit && <button onClick={() => stergeSupapa(s)} style={{ ...S.btnS, padding: '5px 10px', fontSize: 12, color: G.red, borderColor: G.red + '44' }}>🗑</button>}
              </div>
            </div>
          )
        })}
      </div>

      {/* Arhivă declarații */}
      {declaratii.length > 0 && (
        <div style={{ ...S.card, padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '8px 14px', borderBottom: `1px solid ${G.border}` }}>
            <span style={{ fontSize: 11, color: G.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.4px' }}>📜 Declarații emise ({declaratii.length})</span>
          </div>
          {declaratii.map((d, idx) => {
            const exp = daysUntil(d.data_valabilitate)
            const expColor = exp === null ? G.muted : exp < 0 ? G.red : exp <= 30 ? G.orange : G.green
            return (
              <div key={d.id} style={{ padding: '10px 14px', borderBottom: idx < declaratii.length - 1 ? `1px solid ${G.border}` : 'none', display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 700, color: G.text, fontSize: 13 }}>Declarație nr. {d.numar}</div>
                  <div style={{ fontSize: 11, color: G.muted, marginTop: 2 }}>
                    emisă {fmtDate(d.data_emitere)} · {(d.supape_snapshot || []).length} supape
                    {d.data_valabilitate && <> · valabilă până <strong style={{ color: expColor }}>{fmtDate(d.data_valabilitate)}{exp < 0 ? ' (EXPIRATĂ)' : ''}</strong></>}
                  </div>
                </div>
                {d.pdf_path && <button onClick={() => veziPDF(d.pdf_path)} style={{ ...S.btnS, padding: '6px 12px', fontSize: 12, color: G.blue, borderColor: G.blue + '55' }}>📄 Vezi PDF</button>}
              </div>
            )
          })}
        </div>
      )}

      {editSupapa && <SupapaModal initial={editSupapa} busy={busy} onSave={saveSupapa} onClose={() => setEditSupapa(null)} />}
    </div>
  )
}

// ── Modal adăugare/editare supapă ──
function SupapaModal({ initial, busy, onSave, onClose }) {
  const [f, setF] = useState(initial)
  const [file, setFile] = useState(null)
  const [parsing, setParsing] = useState(false)
  const [parseMsg, setParseMsg] = useState(null)
  const [autoFilled, setAutoFilled] = useState({})  // câmpuri completate din PDF, de confirmat
  const set = (k, v) => { setF(p => ({ ...p, [k]: v })); if (autoFilled[k]) setAutoFilled(p => { const n = { ...p }; delete n[k]; return n }) }
  const hasAuto = Object.keys(autoFilled).length > 0
  const inp = (k) => autoFilled[k] ? { ...S.input, borderColor: G.logistica, background: G.logistica + '14' } : S.input

  const citesteDinPDF = async () => {
    if (!file) return
    setParsing(true); setParseMsg({ ok: true, text: '🔍 Se citește buletinul (OCR)… prima dată durează ~10-15s' })
    try {
      const text = await ocrText(file, (p) => { if (p < 1) setParseMsg({ ok: true, text: `🔍 Recunoaștere text… ${Math.round(p * 100)}%` }) })
      const d = parseBuletinText(text)
      setF(p => ({
        ...p,
        serie: d.serie || p.serie,
        nr_buletin: d.nr_buletin || p.nr_buletin,
        emitent: d.emitent || p.emitent,
        data_verificare: d.data_verificare || p.data_verificare,
        data_valabilitate: d.data_valabilitate || p.data_valabilitate,
        rezultat: d.rezultat || p.rezultat,
        pr_bari: d.pr_bari ?? p.pr_bari,
        diametru_curgere_mm: d.diametru_curgere_mm ?? p.diametru_curgere_mm,
      }))
      const filled = {}
      ;['serie', 'nr_buletin', 'emitent', 'data_verificare', 'data_valabilitate', 'rezultat', 'pr_bari', 'diametru_curgere_mm'].forEach(k => { if (d[k] !== null && d[k] !== undefined && d[k] !== '') filled[k] = true })
      setAutoFilled(filled)
      const n = Object.keys(filled).length
      setParseMsg({ ok: n > 0, text: n > 0 ? `✅ ${n} câmpuri citite din buletin — verifică-le și confirmă` : '⚠️ Nu am găsit datele în buletin — completează manual' })
    } catch (e) {
      setParseMsg({ ok: false, text: '⚠️ Nu am putut citi buletinul: ' + (e.message || e) })
    } finally { setParsing(false) }
  }
  const lbl = { fontSize: 12, color: G.muted, marginBottom: 4, display: 'block' }
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: 20 }} onClick={onClose}>
      <div style={{ ...S.card, padding: 22, maxWidth: 540, width: '100%', maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 17, fontWeight: 800, color: G.text, marginBottom: 16 }}>{f.id ? '✏️ Editează supapă' : '➕ Supapă nouă'}</div>
        {hasAuto && (
          <div style={{ marginBottom: 14, padding: '10px 12px', background: G.logistica + '18', border: `1px solid ${G.logistica}55`, borderRadius: 8, fontSize: 12, color: G.text }}>
            🔎 <strong>Confirmare informații PDF</strong> — câmpurile evidențiate au fost citite automat din buletin. Verifică-le și corectează ce nu e bine; se înregistrează doar când apeși <strong>✓ Salvează</strong>.
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}><label style={lbl}>Serie supapă *</label><input style={inp('serie')} value={f.serie || ''} onChange={e => set('serie', e.target.value)} placeholder="ex: 10293284" /></div>
            <div style={{ flex: 1 }}><label style={lbl}>Producător</label><input style={S.input} value={f.producator || ''} onChange={e => set('producator', e.target.value)} placeholder="ex: LESER / technical" /></div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: G.text, cursor: 'pointer' }}>
            <input type="checkbox" checked={f.activa !== false} onChange={e => set('activa', e.target.checked)} style={{ width: 16, height: 16, accentColor: G.green }} />
            Montată acum pe utilaj <span style={{ fontSize: 11, color: G.dim }}>(debifează dacă a fost demontată/înlocuită)</span>
          </label>

          <div style={{ height: 1, background: G.border, margin: '2px 0' }} />
          <div style={{ fontSize: 11, color: G.logistica, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.4px' }}>Buletin verificare ISCIR</div>

          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}><label style={lbl}>Rezultat</label>
              <select style={inp('rezultat')} value={f.rezultat || 'conform'} onChange={e => set('rezultat', e.target.value)}>
                <option value="conform">✅ Conform</option>
                <option value="neconform">❌ Neconform</option>
                <option value="in_asteptare">⏳ În așteptare</option>
              </select>
            </div>
            <div style={{ flex: 1 }}><label style={lbl}>Nr. buletin</label><input style={inp('nr_buletin')} value={f.nr_buletin || ''} onChange={e => set('nr_buletin', e.target.value)} placeholder="ex: 3467/19.06.2026" /></div>
          </div>
          <div><label style={lbl}>Emitent (unitate autorizată ISCIR)</label><input style={inp('emitent')} value={f.emitent || ''} onChange={e => set('emitent', e.target.value)} placeholder="ex: TERMOKLIMA S.R.L." /></div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}><label style={lbl}>Data verificare</label><input type="date" style={inp('data_verificare')} value={f.data_verificare || ''} onChange={e => set('data_verificare', e.target.value)} /></div>
            <div style={{ flex: 1 }}><label style={lbl}>Valabil până la</label><input type="date" style={inp('data_valabilitate')} value={f.data_valabilitate || ''} onChange={e => set('data_valabilitate', e.target.value)} /></div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}><label style={lbl}>Presiune reglare (bari)</label><input type="number" step="0.1" style={inp('pr_bari')} value={f.pr_bari ?? ''} onChange={e => set('pr_bari', e.target.value)} placeholder="ex: 74.0" /></div>
            <div style={{ flex: 1 }}><label style={lbl}>Diametru curgere (mm)</label><input type="number" step="0.1" style={inp('diametru_curgere_mm')} value={f.diametru_curgere_mm ?? ''} onChange={e => set('diametru_curgere_mm', e.target.value)} placeholder="ex: 13.0" /></div>
          </div>
          <div><label style={lbl}>Observații</label><input style={S.input} value={f.observatii || ''} onChange={e => set('observatii', e.target.value)} /></div>
          <div>
            <label style={lbl}>Buletin PDF {f.pdf_nume && <span style={{ color: G.green }}>· atașat: {f.pdf_nume}</span>}</label>
            <DropZone
              onFile={f2 => { setFile(f2); setParseMsg(null) }}
              accept="application/pdf,image/*"
              icon="📄"
              label={file ? file.name : 'Trage buletinul aici sau click'}
              hint={file ? 'Fișier selectat' : 'PDF (autofill) sau imagine'}
              color={G.logistica}
              compact
            />
            {file && file.type === 'application/pdf' && (
              <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <button type="button" onClick={citesteDinPDF} disabled={parsing}
                  style={{ ...S.btnS, padding: '6px 14px', fontSize: 12.5, color: G.purple, borderColor: G.purple + '55', cursor: parsing ? 'wait' : 'pointer', opacity: parsing ? .6 : 1 }}>
                  {parsing ? '🔍 Se citește…' : '🔍 Citește datele din PDF'}
                </button>
                {parseMsg && <span style={{ fontSize: 11.5, color: parseMsg.ok ? G.green : G.orange }}>{parseMsg.text}</span>}
              </div>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
          <button onClick={onClose} style={S.btnS}>Anulează</button>
          <button onClick={() => onSave(f, file)} disabled={busy || !f.serie?.trim()} style={{ ...S.btnP, opacity: (busy || !f.serie?.trim()) ? .5 : 1 }}>{busy ? 'Se salvează…' : '✓ Salvează'}</button>
        </div>
      </div>
    </div>
  )
}

// ── Construire PDF declarație (HTML offscreen → html2canvas → jsPDF A4) ──
async function construiestePDF({ numar, dataEmitere, dataValab, utilajSnapshot, supapeSnapshot, semnaturaImg }) {
  const fmt = (d) => d ? new Date(d).toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
  const utilajNume = [utilajSnapshot.marca, utilajSnapshot.model].filter(Boolean).join(' ') || utilajSnapshot.cod_intern || '—';

  const randuriSupape = supapeSnapshot.map(s => `
    <tr>
      <td style="border:1px solid #999;padding:6px 8px;font-family:monospace;">${s.serie || '—'}${s.producator ? ` (${s.producator})` : ''}</td>
      <td style="border:1px solid #999;padding:6px 8px;">${s.nr_buletin || '—'}</td>
      <td style="border:1px solid #999;padding:6px 8px;text-align:center;">${s.pr_bari != null ? s.pr_bari + ' bari' : '—'}</td>
      <td style="border:1px solid #999;padding:6px 8px;text-align:center;">${fmt(s.data_valabilitate)}</td>
    </tr>`).join('');

  const emitenti = [...new Set(supapeSnapshot.map(s => s.emitent).filter(Boolean))].join(', ') || 'unitate autorizată ISCIR';

  const html = `
    <div style="width:738px;padding:28px;background:#fff;color:#111;font-family:'Times New Roman',serif;font-size:13px;line-height:1.5;box-sizing:border-box;">
      <div style="display:flex;align-items:center;gap:14px;border-bottom:2px solid #E3B341;padding-bottom:12px;margin-bottom:18px;">
        <img src="${LOGO_B64}" style="height:54px;" />
        <div>
          <div style="font-size:18px;font-weight:bold;">S.C. GAZPET INSTAL S.R.L.</div>
          <div style="font-size:11px;color:#444;">Ploiești · CUI RO13038090</div>
        </div>
        <div style="margin-left:auto;text-align:right;font-size:11px;color:#444;">
          Nr. <strong>${numar}</strong><br/>Data: ${fmt(dataEmitere)}
        </div>
      </div>

      <div style="text-align:center;font-size:18px;font-weight:bold;letter-spacing:.5px;margin-bottom:4px;">DECLARAȚIE DE CONFORMITATE TEHNICĂ</div>
      <div style="text-align:center;font-size:12px;color:#555;margin-bottom:20px;">privind starea tehnică și utilizarea în siguranță a echipamentului</div>

      <p style="margin:0 0 12px 0;">
        Subscrisa <strong>S.C. GAZPET INSTAL S.R.L.</strong>, în calitate de deținător al echipamentului identificat mai jos,
        declarăm pe propria răspundere că:
      </p>

      <table style="width:100%;border-collapse:collapse;margin-bottom:14px;font-size:12.5px;">
        <tr><td style="padding:3px 6px;width:42%;color:#555;">Echipament</td><td style="padding:3px 6px;font-weight:bold;">${utilajNume}</td></tr>
        ${utilajSnapshot.serie ? `<tr><td style="padding:3px 6px;color:#555;">Serie / nr. identificare</td><td style="padding:3px 6px;">${utilajSnapshot.serie}</td></tr>` : ''}
        ${utilajSnapshot.cod_intern ? `<tr><td style="padding:3px 6px;color:#555;">Cod intern</td><td style="padding:3px 6px;">${utilajSnapshot.cod_intern}</td></tr>` : ''}
        ${utilajSnapshot.an ? `<tr><td style="padding:3px 6px;color:#555;">An fabricație</td><td style="padding:3px 6px;">${utilajSnapshot.an}</td></tr>` : ''}
        ${utilajSnapshot.ore ? `<tr><td style="padding:3px 6px;color:#555;">Ore funcționare</td><td style="padding:3px 6px;">${Number(utilajSnapshot.ore).toLocaleString('ro-RO')} ore</td></tr>` : ''}
      </table>

      <p style="margin:0 0 12px 0;">
        a fost supus operațiunilor de service și mentenanță, iar supapele de siguranță aferente au fost verificate și reglate
        de către ${emitenti}, rezultatele fiind <strong>conforme</strong> cu prescripția tehnică PT C7-2010, Colecția ISCIR:
      </p>

      <table style="width:100%;border-collapse:collapse;margin-bottom:16px;font-size:12px;">
        <thead>
          <tr style="background:#f0e6c8;">
            <th style="border:1px solid #999;padding:6px 8px;text-align:left;">Supapă (serie)</th>
            <th style="border:1px solid #999;padding:6px 8px;text-align:left;">Buletin verificare</th>
            <th style="border:1px solid #999;padding:6px 8px;">Presiune reglare</th>
            <th style="border:1px solid #999;padding:6px 8px;">Valabil până</th>
          </tr>
        </thead>
        <tbody>${randuriSupape}</tbody>
      </table>

      <p style="margin:0 0 12px 0;">
        În urma verificărilor efectuate, declarăm că echipamentul <strong>corespunde din punct de vedere tehnic și poate fi
        utilizat în condiții de siguranță</strong>, în conformitate cu destinația sa și cu prescripțiile tehnice în vigoare.
      </p>

      <p style="margin:0 0 24px 0;font-size:12px;color:#333;">
        Prezenta declarație este valabilă până la data de <strong>${fmt(dataValab)}</strong>, corespunzătoare primei scadențe
        de verificare a supapelor de siguranță, și își încetează valabilitatea la expirarea, înlocuirea sau declararea ca
        neconformă a oricăreia dintre supapele de siguranță menționate mai sus.
      </p>

      <div style="display:flex;justify-content:flex-end;margin-top:10px;">
        <div style="text-align:center;width:280px;">
          <div style="font-size:12px;color:#333;margin-bottom:4px;">Întocmit,</div>
          ${semnaturaImg ? `<img src="${semnaturaImg}" style="height:48px;margin:2px 0;" />` : `<div style="height:48px;border-bottom:1px solid #111;margin:2px 20px 4px 20px;"></div>`}
          <div style="font-weight:bold;font-size:13px;">ing. MITRACHE ALEXANDRU</div>
          <div style="font-size:11px;color:#555;">Director Departament Logistică</div>
        </div>
      </div>

      <div style="margin-top:28px;padding-top:8px;border-top:1px solid #ccc;font-size:9px;color:#999;text-align:center;">
        Document generat electronic din sistemul Gazpet ERP · ${new Date().toLocaleString('ro-RO')} · valabil cu verificările supapelor de siguranță în termen
      </div>
    </div>`;

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-9999px;top:0;';
  host.innerHTML = html;
  document.body.appendChild(host);
  try {
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const canvas = await html2canvas(host.firstElementChild, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const imgW = 210, imgH = (canvas.height * imgW) / canvas.width;
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, imgW, Math.min(imgH, 297), undefined, 'FAST');
    return pdf.output('blob');
  } finally {
    document.body.removeChild(host);
  }
}
