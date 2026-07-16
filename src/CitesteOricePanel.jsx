// ===========================================================================
// CITEȘTE ORICE — Panel universal (config-driven per modul)
// ===========================================================================
// 01.07.2026 — AI Document Router
//   • Dropzone universal → upload în bucket ai-documente-inbox + INSERT în coadă
//   • Clasificarea o declanșează AUTOMAT un trigger pe BD (server-side, robust);
//     UI-ul doar face polling pe status până documentul e clasificat.
//   • Tab „De confirmat": card per document cu preview + corecție entitate/tip +
//     buton Confirmă → INSERT în tabelul modulului (ZERO auto-insert).
//   • Panelul primește prop `modul` și se configurează din MODUL_CFG:
//       - executie  → executie_documente_contract  (entitate = proiect)   [Faza 1, live]
//       - hr        → hr_documente_personale        (entitate = angajat)   [Faza 2]
//       - logistica → logistica_documente           (entitate = vehicul)   [Faza 2 — în curând]
//       - financiar → contracte_subcontract_facturi (entitate = furnizor)  [Faza 2 — în curând]
// ===========================================================================

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@supabase/supabase-js'
import { jsPDF } from 'jspdf'

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

// cod tip document → etichetă RO (pt afișaj)
const TIP_LABEL = {
  ordin_incepere:'Ordin de începere', ordin_reincepere:'Ordin de reîncepere', act_aditional:'Act adițional', aviz:'Aviz',
  autorizatie:'Autorizație de construire', contract:'Contract', garantie_exec:'Garanție bună execuție',
  grafic:'Grafic de execuție', buletin:'Buletin / CI', pasaport:'Pașaport', permis_conducere:'Permis de conducere',
  cert_nastere_angajat:'Certificat naștere', cert_casatorie:'Certificat căsătorie', cert_nastere_copil:'Certificat naștere copil',
  diploma_liceu:'Diplomă liceu', diploma_studii_sup:'Diplomă studii superioare', diploma_scoala_prof:'Diplomă școală prof.',
  cert_calificare:'Certificat calificare', cazier_judiciar:'Cazier judiciar', contract_munca:'Contract de muncă (CIM)',
  fisa_post:'Fișa postului', acord_gdpr:'Acord GDPR', adeverinta_medic_familie:'Adeverință medic familie',
  extras_cont_bancar:'Extras cont bancar', decizie_handicap:'Decizie handicap', autorizatie_hr:'Autorizație (ISCIR/sudură/transport)',
  itp:'ITP', rca:'RCA', casco:'CASCO', tahograf:'Tahograf', copie_conforma:'Copie conformă',
  factura:'Factură', ipc:'IPC', certificat_plata:'Certificat de plată', altul:'Altul',
}

const MODUL_META = {
  executie:{ label:'Execuție', color:G.executie, emoji:'🏗️' },
  hr:{ label:'HR', color:G.pink, emoji:'👷' },
  logistica:{ label:'Logistică', color:G.orange, emoji:'🚚' },
  financiar:{ label:'Financiar', color:G.green, emoji:'💰' },
}

// ── Config per modul ────────────────────────────────────────────
// activ:true → confirmare completă implementată. activ:false → placeholder „în curând".
const MODUL_CFG = {
  executie: {
    activ:true, entitateLabel:'Proiect', entitateTip:'proiect', color:G.executie,
    tipuriText:['ordin_incepere','ordin_reincepere','act_aditional','aviz','autorizatie','contract','garantie_exec','grafic','altul'],
  },
  hr: {
    activ:true, entitateLabel:'Angajat', entitateTip:'angajat', color:G.pink,
    bucket:'documente-personal',
  },
  logistica: {
    activ:true, entitateLabel:'Vehicul', entitateTip:'activ', color:G.orange,
    bucket:'documente-flota',
  },
  financiar: {
    activ:true, entitateLabel:'Situație de plată', entitateTip:'situatie_plata', color:G.green,
    bucket:'executie-borderouri',
    // Financiar acceptă la confirmare DOAR certificatele de plată (se atașează la SL).
    // Facturile intră prin importul WinMentor, IPC-urile prin parserul Habau — nu se dublează aici.
  },
}

const fmtDate = v => v ? new Date(v).toLocaleDateString('ro-RO', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '—'
const fmtD = v => v ? new Date(v).toLocaleDateString('ro-RO', { day:'2-digit', month:'2-digit', year:'numeric' }) : '—'
const randId = () => Math.random().toString(36).slice(2, 10)

// Match cod tip AI (ex 'itp', 'copie_conforma') → cod real din tipuriFK (ex 'ITP',
// 'Copie conformă'). HR are coduri identice (match exact); logistică are nume RO cu
// majuscule/diacritice → normalizare (fără diacritice, fără spații/underscore).
const normTip = s => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
function resolveTipCod(rawTip, tipuriFK) {
  if (!rawTip) return ''
  const exact = (tipuriFK || []).find(t => t.cod === rawTip)
  if (exact) return exact.cod
  const n = normTip(rawTip)
  const fuzzy = (tipuriFK || []).find(t => normTip(t.cod) === n)
  return fuzzy ? fuzzy.cod : ''
}

// ─── Conversie imagine → PDF comprimat, în browser (jsPDF) ───────
// Orice poză (JPG/PNG/WEBP/HEIC-render) e redimensionată la max 1600px pe latura
// lungă + re-encodată JPEG 82% și pusă într-un PDF cu pagina = dimensiunea imaginii.
// Rezultat: din 5-8MB (poze telefon) → ~200-400KB. Edge-ul primește mereu PDF,
// deci scapă de limita de 5MB/imagine a AI-ului și de orice transform pe server.
const IMG_MAX_DIM = 1600
async function imageToPdf(file) {
  const dataUrl = await new Promise((res, rej) => {
    const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('citire fișier')); r.readAsDataURL(file)
  })
  const img = await new Promise((res, rej) => {
    const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('decodare imagine')); im.src = dataUrl
  })
  let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height
  if (!w || !h) throw new Error('dimensiuni imagine necunoscute')
  if (w > IMG_MAX_DIM || h > IMG_MAX_DIM) { const s = IMG_MAX_DIM / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s) }
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h)   // fundal alb (PNG transparent → alb, nu negru)
  ctx.drawImage(img, 0, 0, w, h)
  const jpeg = canvas.toDataURL('image/jpeg', 0.82)
  const pdf = new jsPDF({ orientation: w >= h ? 'landscape' : 'portrait', unit: 'px', format: [w, h], compress: true })
  pdf.addImage(jpeg, 'JPEG', 0, 0, w, h, undefined, 'FAST')
  const blob = pdf.output('blob')
  const nume = file.name.replace(/\.[^.]+$/, '') + '.pdf'
  return new File([blob], nume, { type: 'application/pdf' })
}

// ═══════════════════════════════════════════════════════════════
export default function CitesteOricePanel({ open, onClose, profile, modul = 'executie', proiectContextId = null, proiectContextNume = null, onConfirmed }) {
  const cfg = MODUL_CFG[modul] || MODUL_CFG.executie
  const meta = MODUL_META[modul] || MODUL_META.executie

  const [view, setView] = useState('upload')            // 'upload' | 'confirm'
  const [queue, setQueue] = useState([])
  const [entitati, setEntitati] = useState([])          // proiecte / angajați / vehicule
  const [tipuriFK, setTipuriFK] = useState([])          // pt hr/logistica: [{id,cod,denumire}]
  const [uploading, setUploading] = useState([])
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [toast, setToast] = useState(null)

  const flash = (tip, msg) => { setToast({ tip, msg }); setTimeout(() => setToast(null), 3500) }

  // ─── Încărcare coadă (doar documentele modulului curent + nedecis la executie) ──
  const loadQueue = useCallback(async () => {
    setLoading(true)
    let q = supabase.from('ai_documente_inbox').select('*').in('status', ['clasificat','eroare'])
    if (modul === 'executie') q = q.or('modul_tinta.eq.executie,modul_tinta.is.null')
    else q = q.eq('modul_tinta', modul)
    const { data } = await q.order('uploadat_la', { ascending: false })
    setQueue(data || [])
    setLoading(false)
  }, [modul])

  // ─── Încărcare entități + tipuri FK per modul ──────────────────
  const loadEntitati = useCallback(async () => {
    if (modul === 'executie') {
      const { data } = await supabase.from('executie_proiecte').select('id,nume,cod_intern').eq('activ', true).order('nume')
      setEntitati((data || []).map(p => ({ id:p.id, label:(p.cod_intern ? p.cod_intern + ' · ' : '') + p.nume })))
    } else if (modul === 'hr') {
      const today = new Date().toISOString().split('T')[0]
      const { data } = await supabase.from('employees').select('id,name')
        .or(`termination_date.is.null,termination_date.gt.${today}`).order('name')
      setEntitati((data || []).map(e => ({ id:e.id, label:e.name })))
      const { data: tp } = await supabase.from('hr_documente_personale_tipuri').select('id,cod,denumire,are_expirare').eq('activ', true).order('ordine')
      setTipuriFK(tp || [])
    } else if (modul === 'logistica') {
      const { data } = await supabase.from('logistica_active').select('id,cod_intern,nr_inmatriculare,marca').order('cod_intern')
      setEntitati((data || []).map(a => ({ id:a.id, label:[a.nr_inmatriculare, a.marca, a.cod_intern].filter(Boolean).join(' · ') })))
      const { data: tp } = await supabase.from('logistica_tipuri_documente').select('id,nume').eq('activ', true).order('nume')
      setTipuriFK((tp || []).map(t => ({ id:t.id, cod:t.nume, denumire:t.nume })))
    } else if (modul === 'financiar') {
      // Entitatea = situația de plată. Păstrez proiect_id + nr_situatie pentru path-ul PDF.
      const { data } = await supabase.from('executie_situatii_plata')
        .select('id,proiect_id,nr_situatie,luna,an,certificat_pdf_path,proiect:executie_proiecte!proiect_id(nume,cod_intern)')
        .order('id', { ascending: false }).limit(300)
      setEntitati((data || []).map(s => ({
        id:s.id, proiect_id:s.proiect_id, nr_situatie:s.nr_situatie,
        label:`${s.proiect?.cod_intern || s.proiect?.nume || 'Proiect ' + s.proiect_id} · SL ${s.nr_situatie}${s.luna ? ` (${s.luna}/${s.an})` : ''}${s.certificat_pdf_path ? ' · are certificat' : ''}`,
      })))
      setTipuriFK([{ id:'certificat_plata', cod:'certificat_plata', denumire:'Certificat de plată' }])
    }
  }, [modul])

  useEffect(() => {
    if (!open) return
    loadQueue(); loadEntitati()
    setView('upload')
  }, [open, loadQueue, loadEntitati])

  // ─── UPLOAD ───────────────────────────────────────────────────
  async function handleFiles(fileList) {
    const files = Array.from(fileList || [])
    if (!files.length) return
    for (const original of files) {
      const rowState = { nume: original.name, stare: 'upload' }
      setUploading(u => [...u, rowState])
      try {
        // Orice imagine → PDF comprimat în browser, înainte de upload.
        // Așa fișierul ajunge mereu PDF (mic) în coadă, iar AI-ul îl citește garantat.
        let file = original
        if ((original.type || '').startsWith('image/')) {
          setUploading(u => u.map(x => x === rowState ? { ...x, stare: 'convert' } : x))
          try { file = await imageToPdf(original) }
          catch (_) { file = original }   // dacă din orice motiv conversia pică, urcăm originalul
          setUploading(u => u.map(x => x === rowState ? { ...x, nume: file.name, stare: 'upload' } : x))
        }
        const ext = (file.name.split('.').pop() || 'pdf').toLowerCase()
        const path = `${profile.id}/${Date.now()}_${randId()}.${ext}`
        const { error: upErr } = await supabase.storage.from(BUCKET_INBOX).upload(path, file, { upsert: false, contentType: file.type || undefined })
        if (upErr) throw new Error(upErr.message)

        const ins = {
          fisier_path: path, fisier_nume: file.name, fisier_size_bytes: file.size,
          fisier_mime: file.type || null, status: 'in_asteptare', uploadat_de: profile.id,
        }
        if (proiectContextId && modul === 'executie') { ins.entitate_tip = 'proiect'; ins.entitate_id = proiectContextId; ins.entitate_match_confidence = 100; ins.modul_tinta = 'executie' }
        const { data: row, error: insErr } = await supabase.from('ai_documente_inbox').insert(ins).select('id').single()
        if (insErr) throw new Error(insErr.message)

        setUploading(u => u.map(x => x === rowState ? { ...x, stare: 'ai' } : x))
        const st = await pollStatus(row.id)
        if (st === 'eroare') throw new Error('AI nu a putut citi documentul')
        if (st === 'timeout') throw new Error('Clasificarea durează prea mult — reîncearcă')

        setUploading(u => u.filter(x => x !== rowState))
      } catch (e) {
        setUploading(u => u.map(x => x === rowState ? { ...x, stare: 'eroare', err: String(e.message || e) } : x))
      }
    }
    await loadQueue()
    setView('confirm')
    flash('ok', 'Document(e) citit(e). Verifică și confirmă mai jos.')
  }

  async function pollStatus(id, tries = 24) {
    for (let i = 0; i < tries; i++) {
      await new Promise(r => setTimeout(r, 2000))
      try {
        const { data } = await supabase.from('ai_documente_inbox').select('status').eq('id', id).single()
        if (data && data.status !== 'in_asteptare') return data.status
      } catch (_) { /* reîncearcă */ }
    }
    return 'timeout'
  }

  // ─── CONFIRMARE — dispecer per modul ──────────────────────────
  async function handleConfirm(row) {
    if (modul === 'executie') return confirmExecutie(row)
    if (modul === 'hr') return confirmHR(row)
    if (modul === 'logistica') return confirmLogistica(row)
    if (modul === 'financiar') return confirmFinanciar(row)
    flash('err', 'Confirmarea pentru acest modul nu e încă activă.')
  }

  // Descarcă fișierul din staging și îl urcă în bucketul destinație. Întoarce destPath.
  async function mutaFisier(row, bucketDest, prefix) {
    const { data: blob, error: dlErr } = await supabase.storage.from(BUCKET_INBOX).download(row.fisier_path)
    if (dlErr || !blob) throw new Error('Nu pot descărca fișierul: ' + (dlErr?.message || ''))
    const ext = (row.fisier_nume.split('.').pop() || 'pdf').toLowerCase()
    const destPath = `${prefix}/aidoc_${Date.now()}_${randId()}.${ext}`
    const { error: upErr } = await supabase.storage.from(bucketDest).upload(destPath, blob, { upsert: false, contentType: row.fisier_mime || undefined })
    if (upErr) throw new Error('Upload destinație: ' + upErr.message)
    return destPath
  }

  // ── Execuție (Faza 1, neschimbat) ─────────────────────────────
  async function confirmExecutie(row) {
    const proiectId = row._editEntitate ?? row.entitate_id
    const tip = row._editTip ?? row.tip_document
    if (!proiectId) { flash('err', 'Alege proiectul înainte de a confirma.'); return }
    setBusyId(row.id)
    try {
      const destPath = await mutaFisier(row, 'executie-contracte', String(proiectId))
      const { data: created, error: insErr } = await supabase.from('executie_documente_contract').insert({
        proiect_id: proiectId, tip_document: tip,
        fisier_path: destPath, fisier_nume: row.fisier_nume,
        fisier_size_bytes: row.fisier_size_bytes, fisier_mime: row.fisier_mime || 'application/pdf',
        descriere: row.payload_ai?.titlu_scurt || null, uploadat_de: profile.id,
      }).select('id').single()
      if (insErr) throw new Error('Insert document: ' + insErr.message)

      if (row._scrieDate !== false && row.payload_ai?.date_proiect) {
        const dp = row.payload_ai.date_proiect
        try {
          const { data: proj } = await supabase.from('executie_proiecte').select('data_start,data_termen,durata_contract_luni').eq('id', proiectId).single()
          const upd = {}
          if (dp.data_start && proj && !proj.data_start) upd.data_start = dp.data_start
          if (dp.data_termen && proj && !proj.data_termen) upd.data_termen = dp.data_termen
          if (dp.durata_luni && proj && !proj.durata_contract_luni) upd.durata_contract_luni = dp.durata_luni
          if (Object.keys(upd).length) { upd.updated_at = new Date().toISOString(); await supabase.from('executie_proiecte').update(upd).eq('id', proiectId) }
        } catch (_) { /* nu blochează */ }
      }
      // Ordin de începere → leagă PDF-ul și de câmpul dedicat de pe proiect (15.07),
      // ca butonul „📄 Vezi PDF" de lângă data ordinului (ProiectEditModal) să-l găsească.
      if (tip === 'ordin_incepere') {
        try {
          const { data: proj } = await supabase.from('executie_proiecte').select('doc_ordin_incepere_path').eq('id', proiectId).single()
          if (proj && !proj.doc_ordin_incepere_path) {
            await supabase.from('executie_proiecte').update({ doc_ordin_incepere_path: destPath, updated_at: new Date().toISOString() }).eq('id', proiectId)
          }
        } catch (_) { /* nu blochează */ }
      }

      await finalizeInbox(row, 'executie', tip, 'proiect', proiectId, created.id)
      flash('ok', 'Document trimis în Execuție ✓')
      await loadQueue(); onConfirmed && onConfirmed()
    } catch (e) { flash('err', String(e.message || e)) } finally { setBusyId(null) }
  }

  // ── HR (Faza 2) ───────────────────────────────────────────────
  async function confirmHR(row) {
    const angajatId = row._editEntitate ?? row.entitate_id
    const tipCod = row._editTip ?? row.tip_document
    if (!angajatId) { flash('err', 'Alege angajatul înainte de a confirma.'); return }
    const tipRow = tipuriFK.find(t => t.cod === tipCod) || tipuriFK.find(t => t.cod === row.tip_document)
    if (!tipRow) { flash('err', 'Alege tipul documentului (autorizațiile ISCIR/sudură se adaugă din secțiunea Autorizații).'); return }
    setBusyId(row.id)
    try {
      const destPath = await mutaFisier(row, cfg.bucket, String(angajatId))
      const dd = row.payload_ai?.date_document || {}
      const dataExp = dd.data_expirare || null
      const { data: created, error: insErr } = await supabase.from('hr_documente_personale').insert({
        employee_id: angajatId, tip_id: tipRow.id,
        numar_document: dd.numar || null, emitent: dd.emitent || null,
        data_emitere: dd.data_emitere || null, data_expirare: dataExp,
        fara_expirare: !dataExp,
        fisier_path: destPath, fisier_nume: row.fisier_nume,
        fisier_size_bytes: row.fisier_size_bytes, fisier_mime: row.fisier_mime || 'application/pdf',
        activ: true, observatii: row.payload_ai?.titlu_scurt || null, uploadat_de: profile.id,
      }).select('id').single()
      if (insErr) throw new Error('Insert document HR: ' + insErr.message)

      await finalizeInbox(row, 'hr', tipCod, 'angajat', angajatId, created.id)
      flash('ok', 'Document trimis în dosarul angajatului ✓')
      await loadQueue(); onConfirmed && onConfirmed()
    } catch (e) { flash('err', String(e.message || e)) } finally { setBusyId(null) }
  }

  // ── Logistică (Faza 2) ────────────────────────────────────────
  async function confirmLogistica(row) {
    const vehiculId = row._editEntitate ?? row.entitate_id
    const tipCod = row._editTip ?? resolveTipCod(row.tip_document, tipuriFK)
    if (!vehiculId) { flash('err', 'Alege vehiculul înainte de a confirma.'); return }
    const tipRow = tipuriFK.find(t => t.cod === tipCod)
    if (!tipRow) { flash('err', 'Alege tipul documentului.'); return }
    setBusyId(row.id)
    try {
      const destPath = await mutaFisier(row, cfg.bucket, String(vehiculId))
      const dd = row.payload_ai?.date_document || {}
      const dataExp = dd.data_expirare || null
      // logistica_documente: active_id + entitate_id ambele = vehiculul, entitate_tip='activ';
      // fișierul se salvează în pdf_url (nu fisier_path), created_by pentru autor.
      const { data: created, error: insErr } = await supabase.from('logistica_documente').insert({
        active_id: vehiculId, entitate_tip: 'activ', entitate_id: vehiculId,
        tip_id: tipRow.id,
        numar_document: dd.numar || null, emitent: dd.emitent || null,
        data_emitere: dd.data_emitere || null, data_expirare: dataExp,
        fara_expirare: !dataExp,
        pdf_url: destPath, pdf_locatie: 'supabase',
        observatii: row.payload_ai?.titlu_scurt || null, created_by: profile.id,
      }).select('id').single()
      if (insErr) throw new Error('Insert document flotă: ' + insErr.message)

      await finalizeInbox(row, 'logistica', tipCod, 'activ', vehiculId, created.id)
      flash('ok', 'Document trimis la vehicul ✓')
      await loadQueue(); onConfirmed && onConfirmed()
    } catch (e) { flash('err', String(e.message || e)) } finally { setBusyId(null) }
  }

  // ── Financiar (Faza 2 — DOAR certificate de plată) ────────────
  // Certificatul se ATAȘEAZĂ la situația de plată existentă (UPDATE, nu INSERT):
  // PDF în executie-borderouri la sl_{proiect_id}/{nr}_certificat.pdf (același
  // pattern ca TabSituatiiPlata, ca butonul „Vezi PDF" existent să-l găsească),
  // + fill-only-empty pe certificat_plata_nr/data din datele extrase de AI.
  // Facturile/IPC NU se confirmă aici — au fluxurile lor (WinMentor / parser Habau).
  async function confirmFinanciar(row) {
    const tipCod = row._editTip ?? row.tip_document
    if (tipCod !== 'certificat_plata') {
      flash('err', 'Aici se confirmă doar certificatele de plată. Facturile intră prin importul WinMentor, IPC-urile prin parserul dedicat.')
      return
    }
    const slId = row._editEntitate ?? row.entitate_id
    const sl = entitati.find(e => e.id === slId)
    if (!sl) { flash('err', 'Alege situația de plată înainte de a confirma.'); return }
    setBusyId(row.id)
    try {
      const { data: blob, error: dlErr } = await supabase.storage.from(BUCKET_INBOX).download(row.fisier_path)
      if (dlErr || !blob) throw new Error('Nu pot descărca fișierul: ' + (dlErr?.message || ''))
      const slNrClean = String(sl.nr_situatie || slId).toLowerCase().replace(/[^a-z0-9]/g, '_')
      const destPath = `sl_${sl.proiect_id}/${slNrClean}_certificat.pdf`
      const { error: upErr } = await supabase.storage.from(cfg.bucket).upload(destPath, blob, { upsert: true, contentType: 'application/pdf' })
      if (upErr) throw new Error('Upload certificat: ' + upErr.message)

      const dd = row.payload_ai?.date_document || {}
      const { data: cur, error: curErr } = await supabase.from('executie_situatii_plata')
        .select('certificat_plata_nr,certificat_plata_data').eq('id', slId).single()
      if (curErr) throw new Error('Citire situație: ' + curErr.message)
      const upd = { certificat_pdf_path: destPath, updated_at: new Date().toISOString() }
      if (dd.numar && !cur.certificat_plata_nr) upd.certificat_plata_nr = dd.numar
      if (dd.data_emitere && !cur.certificat_plata_data) upd.certificat_plata_data = dd.data_emitere
      const { error: updErr } = await supabase.from('executie_situatii_plata').update(upd).eq('id', slId)
      if (updErr) throw new Error('Update situație: ' + updErr.message)

      await finalizeInbox(row, 'financiar', 'certificat_plata', 'situatie_plata', slId, slId)
      flash('ok', 'Certificat atașat la situația de plată ✓')
      await loadQueue(); onConfirmed && onConfirmed()
    } catch (e) { flash('err', String(e.message || e)) } finally { setBusyId(null) }
  }

  // Marchează rândul inbox confirmat + curăță staging
  async function finalizeInbox(row, modulTinta, tip, entTip, entId, refId) {
    await supabase.from('ai_documente_inbox').update({
      status:'confirmat', modul_tinta:modulTinta, tip_document:tip,
      entitate_tip:entTip, entitate_id:entId,
      confirmat_de:profile.id, confirmat_la:new Date().toISOString(), confirmat_ref_id:refId,
    }).eq('id', row.id)
    await supabase.storage.from(BUCKET_INBOX).remove([row.fisier_path]).catch(() => {})
  }

  async function handleReject(row) {
    if (!confirm('Respingi documentul „' + row.fisier_nume + '"? Fișierul rămâne pentru audit, dar nu intră în sistem.')) return
    setBusyId(row.id)
    await supabase.from('ai_documente_inbox').update({ status:'respins', respins_motiv:'respins manual', confirmat_de:profile.id, confirmat_la:new Date().toISOString() }).eq('id', row.id)
    setBusyId(null); flash('ok', 'Respins.'); loadQueue()
  }

  async function preview(row) {
    const { data } = await supabase.storage.from(BUCKET_INBOX).createSignedUrl(row.fisier_path, 120)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  function patch(id, key, val) { setQueue(q => q.map(r => r.id === id ? { ...r, [key]: val } : r)) }

  if (!open) return null

  const accent = cfg.color

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', zIndex:1000, display:'flex', alignItems:'flex-start', justifyContent:'center', padding:'40px 16px', overflowY:'auto' }}
      onClick={onClose}>
      <div style={{ width:'100%', maxWidth:760, background:G.surface, border:`1px solid ${G.border}`, borderRadius:14, overflow:'hidden' }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding:'16px 20px', borderBottom:`1px solid ${G.border}`, display:'flex', alignItems:'center', gap:12 }}>
          <div style={{ fontSize:22 }}>📥</div>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:16, fontWeight:800, color:G.text }}>Citește Orice · <span style={{ color:accent }}>{meta.emoji} {meta.label}</span></div>
            <div style={{ fontSize:12, color:G.muted }}>
              {proiectContextNume ? <>Atașezi la proiect: <b style={{ color:accent }}>{proiectContextNume}</b></> : 'Aruncă orice document — AI îl citește și îl pregătește pentru confirmare'}
            </div>
          </div>
          <button onClick={onClose} style={{ background:'transparent', border:`1px solid ${G.border}`, color:G.muted, borderRadius:8, width:32, height:32, cursor:'pointer', fontSize:16 }}>✕</button>
        </div>

        {/* Tabs interne */}
        <div style={{ display:'flex', gap:4, padding:'10px 16px 0' }}>
          {[['upload','📤 Încarcă'], ['confirm', `🤖 De confirmat${queue.length ? ` (${queue.length})` : ''}`]].map(([k, l]) => (
            <button key={k} onClick={() => setView(k)} style={{
              padding:'8px 16px', background: view === k ? accent + '22' : 'transparent',
              color: view === k ? accent : G.muted, border:`1px solid ${view === k ? accent + '66' : G.border2}`,
              borderRadius:'8px 8px 0 0', cursor:'pointer', fontSize:13, fontWeight:700 }}>{l}</button>
          ))}
        </div>

        <div style={{ padding:20, maxHeight:'62vh', overflowY:'auto' }}>
          {view === 'upload' && (
            <div>
              <DropInline color={accent} onFiles={handleFiles} />
              {uploading.length > 0 && (
                <div style={{ marginTop:14, display:'flex', flexDirection:'column', gap:6 }}>
                  {uploading.map((u, i) => (
                    <div key={i} style={{ display:'flex', alignItems:'center', gap:8, fontSize:12.5, padding:'8px 12px', background:G.card, border:`1px solid ${G.border}`, borderRadius:8 }}>
                      <span style={{ flex:1, color:G.text }}>{u.nume}</span>
                      <span style={{ color: u.stare === 'eroare' ? G.red : u.stare === 'ai' ? G.purple : u.stare === 'convert' ? G.teal : G.muted, fontWeight:700 }}>
                        {u.stare === 'convert' ? '🖼️ pregătesc…' : u.stare === 'upload' ? '⏳ urc…' : u.stare === 'ai' ? '🤖 AI citește…' : `⚠ ${u.err || 'eroare'}`}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ marginTop:14, fontSize:11.5, color:G.dim, lineHeight:1.6 }}>
                Accept PDF sau imagini. AI-ul detectează tipul documentului și încearcă să găsească {cfg.entitateLabel.toLowerCase()}-ul potrivit. Nimic nu intră în sistem fără confirmarea ta.
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
                const eroare = row.status === 'eroare'
                const potConfirma = cfg.activ && (row.modul_tinta === modul || (modul === 'executie' && row.modul_tinta == null))
                const entMatch = entitati.find(e => e.id === (row._editEntitate ?? row.entitate_id))
                const dd = row.payload_ai?.date_document
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
                        ⚠ AI nu a putut citi documentul: {row.ai_eroare || 'eroare necunoscută'}. Poți încerca din nou sau adaugă-l manual.
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
                          {row.entitate_id && entMatch && row.entitate_match_confidence != null && (
                            <span style={{ ...chip, background:G.green + '18', color:G.green, border:`1px solid ${G.green}55` }}>
                              🔗 {cfg.entitateLabel.toLowerCase()} găsit ({row.entitate_match_confidence}%)
                            </span>
                          )}
                        </div>

                        {potConfirma ? (
                          <>
                            {/* Corecție entitate + tip */}
                            <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginBottom:12 }}>
                              <label style={{ flex:'1 1 260px', fontSize:12 }}>
                                <span style={{ color:G.muted, display:'block', marginBottom:4 }}>{cfg.entitateLabel}</span>
                                <select value={row._editEntitate ?? row.entitate_id ?? ''} onChange={e => patch(row.id, '_editEntitate', e.target.value ? Number(e.target.value) : null)} style={sel}>
                                  <option value="">— alege {cfg.entitateLabel.toLowerCase()} —</option>
                                  {entitati.map(e => <option key={e.id} value={e.id}>{e.label}</option>)}
                                </select>
                              </label>
                              <label style={{ flex:'1 1 180px', fontSize:12 }}>
                                <span style={{ color:G.muted, display:'block', marginBottom:4 }}>Tip document</span>
                                {modul === 'executie' ? (
                                  <select value={row._editTip ?? row.tip_document ?? 'altul'} onChange={e => patch(row.id, '_editTip', e.target.value)} style={sel}>
                                    {cfg.tipuriText.map(t => <option key={t} value={t}>{TIP_LABEL[t] || t}</option>)}
                                  </select>
                                ) : (
                                  <select value={row._editTip ?? resolveTipCod(row.tip_document, tipuriFK)} onChange={e => patch(row.id, '_editTip', e.target.value)} style={sel}>
                                    <option value="">— alege tipul —</option>
                                    {tipuriFK.map(t => <option key={t.id} value={t.cod}>{t.denumire}</option>)}
                                  </select>
                                )}
                              </label>
                            </div>

                            {/* Date extrase — proiect (executie) */}
                            {modul === 'executie' && (() => {
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

                            {/* Financiar: doar certificatele se confirmă aici */}
                            {modul === 'financiar' && (row._editTip ?? row.tip_document) !== 'certificat_plata' && (
                              <div style={{ marginBottom:12, padding:'10px 12px', background:G.yellow + '12', border:`1px solid ${G.yellow}44`, borderRadius:8, fontSize:12, color:G.text }}>
                                ⚠️ Aici se confirmă doar <b>certificatele de plată</b>. Facturile intră prin importul WinMentor, IPC-urile prin parserul dedicat — poți respinge documentul din coadă.
                              </div>
                            )}

                            {/* Date extrase — document (hr/logistica) */}
                            {modul !== 'executie' && dd && (dd.numar || dd.data_emitere || dd.data_expirare || dd.emitent) && (
                              <div style={{ marginBottom:12, padding:'10px 12px', background:accent + '10', border:`1px solid ${accent}33`, borderRadius:8, fontSize:11.5, color:G.text }}>
                                <div style={{ fontSize:12, fontWeight:700, color:accent, marginBottom:5 }}>📄 Date extrase din document</div>
                                <div style={{ display:'flex', flexWrap:'wrap', gap:'4px 14px' }}>
                                  {dd.numar && <span>Nr: <b>{dd.numar}</b></span>}
                                  {dd.data_emitere && <span>Emis: <b>{fmtD(dd.data_emitere)}</b></span>}
                                  {dd.data_expirare && <span>Expiră: <b>{fmtD(dd.data_expirare)}</b></span>}
                                  {dd.emitent && <span>Emitent: <b>{dd.emitent}</b></span>}
                                </div>
                                <div style={{ fontSize:10.5, color:G.dim, marginTop:5 }}>Aceste date se salvează odată cu documentul.</div>
                              </div>
                            )}

                            <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
                              <button onClick={() => handleReject(row)} disabled={busyId === row.id} style={{ ...btnS, color:G.red, borderColor:G.red + '55' }}>✕ Respinge</button>
                              <button onClick={() => handleConfirm(row)} disabled={busyId === row.id}
                                style={{ padding:'8px 18px', background:G.greenBg, color:'#fff', border:'none', borderRadius:8, fontSize:13, fontWeight:700, cursor:'pointer', opacity: busyId === row.id ? 0.5 : 1 }}>
                                {busyId === row.id ? '⏳…' : `✓ Confirmă → ${meta.label}`}
                              </button>
                            </div>
                          </>
                        ) : (
                          <div style={{ fontSize:12.5, color:G.muted, background:G.card2, padding:'10px 12px', borderRadius:8 }}>
                            {cfg.activ
                              ? <>Documentul aparține modulului <b style={{ color:mm.color }}>{mm.emoji} {mm.label}</b>. Deschide-l din acel modul pentru a-l confirma.</>
                              : <>Confirmarea pentru modulul <b style={{ color:mm.color }}>{mm.emoji} {mm.label}</b> se activează în curând — momentan rămâne în coadă.</>}
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
