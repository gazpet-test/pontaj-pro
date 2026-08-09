// ════════════════════════════════════════════════════════════════
// ProiectNouWizard.jsx — Execuție · „➕ Proiect nou" (Faza 2 ingestie)
// 09.08.2026
//
// Un singur ecran care face tot ce trebuie la deschiderea unui proiect:
//   1. Date proiect (cod intern auto-slug din nume, editabil)
//   2. Contract PDF → încărcare + citire cu AI (completează DOAR golurile)
//   3. Șantier (nou / existent / fără) — legat în ambele sensuri
//   4. Folder NAS (căutare în folderele nelegate din nas_proiecte)
//   5. Etichetă + filtru Gmail → corespondența pornește singură în max 15 min
//      (Apps Script syncGmailConfig_ + edge gmail-config citesc executie_proiecte)
//
// Ordinea la salvare: site → proiect → back-link site → NAS → mutare PDF contract.
// PDF-ul se încarcă întâi în `_nou/<uuid>/` (nu știm id-ul încă) și se mută la
// `<id>/contract/` după INSERT; la abandon se șterge.
// ════════════════════════════════════════════════════════════════
import { useEffect, useState, useMemo, useRef } from 'react'
import { createClient } from '@supabase/supabase-js'
import { instrumenteazaStorageRls } from './lib/storageRls.js'
import { norm } from './lib/diacritice.js'

const supabase = instrumenteazaStorageRls(createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
))

const G = {
  bg:'#0D1117', surface:'#161B22', card:'#1C2128', card2:'#21262D', text:'#E6EDF3',
  muted:'#8B949E', dim:'#6E7681', border:'#30363D', border2:'#21262D',
  blue:'#58A6FF', green:'#2EA043', greenBg:'#238636', yellow:'#D29922', orange:'#F0883E',
  red:'#F85149', purple:'#A371F7', teal:'#2DD4BF', pink:'#F778BA', executie:'#58A6FF',
}

const S = {
  input: {
    width:'100%', boxSizing:'border-box', background:G.bg,
    border:`1px solid ${G.border2}`, borderRadius:6,
    padding:'9px 12px', color:G.text, fontSize:13, outline:'none',
  },
  lbl: { display:'block', fontSize:11, color:G.muted, marginBottom:5, fontWeight:600 },
  sect: {
    background:G.card, border:`1px solid ${G.border}`, borderRadius:10,
    padding:'16px 18px', marginBottom:14,
  },
}

const BUCKET_CONTRACTE = 'executie-contracte'

// Cuvinte care nu ajută la identificarea proiectului în eticheta Gmail
const STOP = new Set(['de','la','cu','pe','din','si','in','pentru','a','al','ale','conducta',
  'conducte','transport','gaze','naturale','gaz','executie','lucrari','punere','siguranta'])

// PRUNISOR_JUPA — la fel ca celelalte cod_intern din BD (max 50 char)
const slugCod = nume => norm(nume).replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '').toUpperCase().slice(0, 50)

// Stefan-cel-Mare — eticheta Gmail: primele cuvinte cu sens, cu cratimă
const slugEticheta = nume => {
  const cuv = norm(nume).replace(/[^a-z0-9\s-]+/g, ' ').split(/\s+/).filter(Boolean)
  const utile = cuv.filter(c => c.length > 1 && !STOP.has(c))
  return (utile.length ? utile : cuv).slice(0, 4)
    .map(c => c.charAt(0).toUpperCase() + c.slice(1)).join('-').slice(0, 40)
}

// La nivel de modul, NU în componentă: definită inline ar avea altă identitate la
// fiecare render → React ar remonta secțiunile și inputurile ar pierde focusul la tastare.
function Sectiune({ nr, titlu, sub, children, culoare = G.executie }) {
  return (
    <div style={S.sect}>
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:14 }}>
        <div style={{
          width:26, height:26, borderRadius:7, background: culoare + '22', color: culoare,
          display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, fontWeight:800, flexShrink:0,
        }}>{nr}</div>
        <div>
          <div style={{ fontSize:14, fontWeight:700, color:G.text }}>{titlu}</div>
          {sub && <div style={{ fontSize:11, color:G.muted, marginTop:2 }}>{sub}</div>}
        </div>
      </div>
      {children}
    </div>
  )
}

export default function ProiectNouWizard({ onClose, onCreated, showToast }) {
  const [f, setF] = useState({
    nume:'', cod_intern:'', beneficiar:'', beneficiar_final:'',
    nr_contract:'', data_contract:'', valoare_lei:'', valoare_eur:'',
    data_start:'', data_termen:'', durata_contract_luni:'',
    penalitati_zi_pct:'', garantie_buna_exec_pct:'',
    eticheta_gmail:'', filtru_gmail_from:'', filtru_gmail_subject:'', filtru_gmail_query:'',
    observatii:'',
  })
  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }))

  // Slug-urile se auto-generează din nume până când Razvan le atinge manual
  const codAtins = useRef(false)
  const etichetaAtinsa = useRef(false)
  const setNume = v => setF(prev => ({
    ...prev, nume: v,
    cod_intern:     codAtins.current     ? prev.cod_intern     : slugCod(v),
    eticheta_gmail: etichetaAtinsa.current ? prev.eticheta_gmail : slugEticheta(v),
  }))

  const [existente, setExistente] = useState([])   // proiecte — pentru verificare duplicat
  const [sites, setSites] = useState([])
  const [saving, setSaving] = useState(false)

  // ─── Șantier ────────────────────────────────────────────────────────────
  const [siteMod, setSiteMod] = useState('nou')    // nou | existent | fara
  const [siteNume, setSiteNume] = useState('')
  const [siteId, setSiteId] = useState('')

  // ─── Contract PDF ───────────────────────────────────────────────────────
  const [pdf, setPdf] = useState(null)             // { path, nume, size, type }
  const [pdfBusy, setPdfBusy] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiRes, setAiRes] = useState(null)         // { confidence, completate:[] }

  // ─── Folder NAS ─────────────────────────────────────────────────────────
  const [nasQ, setNasQ] = useState('')
  const [nasRez, setNasRez] = useState([])
  const [nasBusy, setNasBusy] = useState(false)
  const [nasSel, setNasSel] = useState(null)       // rând din nas_proiecte

  useEffect(() => {
    supabase.from('executie_proiecte').select('id, nume, cod_intern, eticheta_gmail')
      .then(({ data }) => setExistente(data || []))
    supabase.from('sites').select('id, name').eq('active', true).order('name')
      .then(({ data }) => setSites(data || []))
  }, [])

  // Numele șantierului: ce a tastat Razvan, altfel „Gazpet - <nume proiect>"
  const siteNumeEfectiv = siteNume.trim() || (f.nume.trim() ? `Gazpet - ${f.nume.trim()}` : '')

  // ─── Validări ───────────────────────────────────────────────────────────
  const dubluCod = useMemo(
    () => existente.find(p => norm(p.cod_intern) === norm(f.cod_intern) && f.cod_intern),
    [existente, f.cod_intern])
  const dubluEticheta = useMemo(
    () => existente.find(p => p.eticheta_gmail && norm(p.eticheta_gmail) === norm(f.eticheta_gmail) && f.eticheta_gmail),
    [existente, f.eticheta_gmail])
  const potSalva = f.nume.trim() && f.cod_intern.trim() && !dubluCod && !dubluEticheta && !saving && !pdfBusy

  // ─── Upload contract (temporar, până avem id-ul proiectului) ────────────
  const uploadPdf = async (file) => {
    if (!file) return
    if (file.type !== 'application/pdf') { showToast('Doar fișiere PDF', 'error'); return }
    if (file.size > 10 * 1024 * 1024) { showToast('PDF prea mare (max 10MB)', 'error'); return }
    setPdfBusy(true)
    try {
      if (pdf?.path) await supabase.storage.from(BUCKET_CONTRACTE).remove([pdf.path])
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = `_nou/${crypto.randomUUID()}/${safeName}`
      const { error } = await supabase.storage.from(BUCKET_CONTRACTE).upload(path, file)
      if (error) throw error
      setPdf({ path, nume: file.name, size: file.size, type: file.type || 'application/pdf' })
      setAiRes(null)
    } catch (e) { showToast('Eroare upload: ' + e.message, 'error') }
    finally { setPdfBusy(false) }
  }

  const stergePdf = async () => {
    if (!pdf?.path) return
    await supabase.storage.from(BUCKET_CONTRACTE).remove([pdf.path]).catch(() => {})
    setPdf(null); setAiRes(null)
  }

  // Citește contractul cu AI — completează DOAR câmpurile goale (nu suprascrie manualul)
  const citesteAI = async () => {
    if (!pdf?.path) return
    setAiBusy(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/parse-contract-proiect`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdf_path: pdf.path, bucket: BUCKET_CONTRACTE }),
      })
      const res = await resp.json()
      if (!resp.ok) throw new Error(res.error || `HTTP ${resp.status}`)
      const x = res.extras || {}
      const completate = []
      setF(prev => {
        const next = { ...prev }
        const pune = (camp, val) => {
          if (val === null || val === undefined || val === '') return
          if (String(next[camp] || '').trim()) return   // completat manual → intact
          next[camp] = String(val); completate.push(camp)
        }
        pune('nr_contract', x.nr_contract)
        pune('data_contract', x.data_contract)
        pune('beneficiar', x.beneficiar)
        pune('beneficiar_final', x.beneficiar_final)
        pune('valoare_lei', x.valoare_lei)
        pune('valoare_eur', x.valoare_eur)
        pune('data_start', x.data_start)
        pune('data_termen', x.data_termen)
        pune('durata_contract_luni', x.durata_contract_luni)
        pune('penalitati_zi_pct', x.penalitati_zi_pct)
        pune('garantie_buna_exec_pct', x.garantie_buna_exec_pct)
        if (!next.nume.trim() && x.nume) {
          next.nume = String(x.nume); completate.push('nume')
          if (!codAtins.current) next.cod_intern = slugCod(x.nume)
          if (!etichetaAtinsa.current) next.eticheta_gmail = slugEticheta(x.nume)
        }
        return next
      })
      setAiRes({ confidence: x.confidence ?? res.confidence ?? 0, completate })
      showToast(completate.length
        ? `AI: ${completate.length} câmpuri completate (${x.confidence ?? 0}% încredere)`
        : 'AI nu a găsit câmpuri noi de completat', completate.length ? 'success' : 'info')
    } catch (e) { showToast('Eroare AI: ' + e.message, 'error') }
    finally { setAiBusy(false) }
  }

  // ─── Căutare folder NAS (aceeași normalizare ca LinkFolderModal) ────────
  const cautaNas = async () => {
    let q = nasQ.trim().replace(/\\/g, '/')
    const idx = q.toLowerCase().indexOf('oferte/')
    if (idx !== -1) q = q.slice(idx + 'oferte/'.length)
    q = q.split('/').filter(Boolean).pop() || q
    if (q.length < 2) return
    setNasBusy(true)
    try {
      const esc = q.replace(/[%_,()]/g, ' ').trim()
      const { data } = await supabase.from('nas_proiecte')
        .select('id_hash, denumire_folder, beneficiar, nr_licitatie, nas_path')
        .or(`denumire_folder.ilike.%${esc}%,nas_path.ilike.%${esc}%`)
        .is('executie_proiect_id', null)
        .limit(10)
      setNasRez(data || [])
    } finally { setNasBusy(false) }
  }

  // ─── SALVARE ────────────────────────────────────────────────────────────
  const creeaza = async () => {
    if (!potSalva) return
    setSaving(true)
    const num = v => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null }
    try {
      // 1. Șantier nou (dacă e cazul) — proiect_id se completează după INSERT-ul proiectului.
      // RLS pe sites permite INSERT doar owner-ului: dacă pică, proiectul se creează
      // totuși, iar Razvan leagă șantierul ulterior din editare.
      let siteFinal = siteMod === 'existent' && siteId ? parseInt(siteId) : null
      let siteCreat = null
      let siteEsuat = null
      if (siteMod === 'nou') {
        const { data, error } = await supabase.from('sites')
          .insert({ name: siteNumeEfectiv, active: true, beneficiar_principal: f.beneficiar.trim() || null })
          .select('id').single()
        if (error) siteEsuat = error.message
        else { siteFinal = data.id; siteCreat = data.id }
      }

      // 2. Proiectul
      const { data: proiect, error: errP } = await supabase.from('executie_proiecte').insert({
        nume:            f.nume.trim(),
        cod_intern:      f.cod_intern.trim(),
        beneficiar:      f.beneficiar.trim() || null,
        beneficiar_final: f.beneficiar_final.trim() || null,
        nr_contract:     f.nr_contract.trim() || null,
        data_contract:   f.data_contract || null,
        data_start:      f.data_start || null,
        data_termen:     f.data_termen || null,
        valoare_lei:     num(f.valoare_lei),
        valoare_eur:     num(f.valoare_eur),
        durata_contract_luni:   f.durata_contract_luni ? parseInt(f.durata_contract_luni) : null,
        penalitati_zi_pct:      num(f.penalitati_zi_pct),
        garantie_buna_exec_pct: num(f.garantie_buna_exec_pct),
        observatii:      f.observatii.trim() || null,
        site_id:         siteFinal,
        activ:           true,
        eticheta_gmail:       f.eticheta_gmail.trim() || null,
        filtru_gmail_from:    f.filtru_gmail_from.trim() || null,
        filtru_gmail_subject: f.filtru_gmail_subject.trim() || null,
        filtru_gmail_query:   f.filtru_gmail_query.trim() || null,
      }).select('id').single()
      if (errP) throw new Error('Proiect: ' + errP.message)

      const pasi = []
      if (siteEsuat) pasi.push(`⚠️ șantierul NU s-a creat (${siteEsuat}) — leagă-l din editare`)
      // 3. Back-link șantier → proiect
      if (siteCreat) {
        const { error } = await supabase.from('sites').update({ proiect_id: proiect.id }).eq('id', siteCreat)
        pasi.push(error ? `⚠️ șantier creat, dar nelegat (${error.message})` : '🏗️ șantier nou creat')
      } else if (siteFinal) {
        pasi.push('🏗️ legat la șantierul existent')
      }

      // 4. Folder NAS
      if (nasSel) {
        const { error } = await supabase.from('nas_proiecte')
          .update({ executie_proiect_id: proiect.id }).eq('id_hash', nasSel.id_hash)
        pasi.push(error ? `⚠️ folder NAS nelegat (${error.message})` : '📁 folder NAS legat')
      }

      // 5. Contract PDF: mutat din _nou/ la <id>/contract/ + înregistrat ca document
      if (pdf?.path) {
        const safeName = pdf.nume.replace(/[^a-zA-Z0-9._-]/g, '_')
        const dest = `${proiect.id}/contract/${Date.now()}_${safeName}`
        const { error: errMove } = await supabase.storage.from(BUCKET_CONTRACTE).move(pdf.path, dest)
        const pathFinal = errMove ? pdf.path : dest      // dacă mutarea pică, păstrăm calea temporară
        const { data: { user } } = await supabase.auth.getUser()
        const { error: errDoc } = await supabase.from('executie_documente_contract').insert({
          proiect_id: proiect.id, tip_document: 'contract',
          fisier_path: pathFinal, fisier_nume: pdf.nume,
          fisier_size_bytes: pdf.size, fisier_mime: pdf.type,
          descriere: aiRes ? `Citit cu AI (${aiRes.confidence}% încredere)` : null,
          uploadat_de: user?.id,
        })
        pasi.push(errDoc ? `⚠️ contract urcat, dar neînregistrat (${errDoc.message})` : '📜 contract atașat')
        setPdf(null)   // nu mai ștergem la închidere — fișierul aparține proiectului
      }

      if (f.eticheta_gmail.trim()) pasi.push('📧 eticheta Gmail se creează automat în max 15 min')
      showToast(`Proiect creat! ${pasi.join(' · ')}`, 'success')
      onCreated(proiect.id)
    } catch (e) {
      showToast('Eroare: ' + e.message, 'error')
      setSaving(false)
    }
  }

  const inchide = async () => {
    if (pdf?.path) await supabase.storage.from(BUCKET_CONTRACTE).remove([pdf.path]).catch(() => {})
    onClose()
  }

  return (
    <div style={{
      position:'fixed', inset:0, background:'rgba(0,0,0,.85)', zIndex:1000,
      display:'flex', alignItems:'flex-start', justifyContent:'center', padding:24, overflow:'auto',
    }} onClick={e => e.target === e.currentTarget && !saving && inchide()}>
      <div style={{
        background:G.surface, border:`1px solid ${G.border}`, borderRadius:14,
        width:'100%', maxWidth:880, margin:'auto',
      }}>
        {/* Header */}
        <div style={{
          padding:'18px 24px', borderBottom:`1px solid ${G.border}`,
          display:'flex', alignItems:'center', justifyContent:'space-between', gap:12,
          position:'sticky', top:0, background:G.surface, borderRadius:'14px 14px 0 0', zIndex:2,
        }}>
          <div>
            <div style={{ fontSize:17, fontWeight:800, color:G.text }}>➕ Proiect nou</div>
            <div style={{ fontSize:12, color:G.muted, marginTop:3 }}>
              Contract, șantier, folder NAS și corespondența pe email — dintr-un singur ecran
            </div>
          </div>
          <button onClick={inchide} disabled={saving} style={{
            background:'transparent', border:'none', color:G.muted, fontSize:24, cursor:'pointer',
          }}>×</button>
        </div>

        <div style={{ padding:'18px 24px' }}>
          {/* ─── 1. DATE PROIECT ─────────────────────────────────────────── */}
          <Sectiune nr="1" titlu="Date proiect" sub="Numele și codul intern sunt obligatorii">
            <div style={{ display:'grid', gap:12 }}>
              <div>
                <label style={S.lbl}>Denumire lucrare *</label>
                <input value={f.nume} onChange={e => setNume(e.target.value)} style={S.input}
                  placeholder="ex: Punere în siguranță subtraversare Siret DN350 Siminicea" />
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                <div>
                  <label style={S.lbl}>Cod intern * <span style={{ color:G.dim, fontWeight:400 }}>(generat automat)</span></label>
                  <input value={f.cod_intern}
                    onChange={e => { codAtins.current = true; set('cod_intern', e.target.value.toUpperCase()) }}
                    style={{ ...S.input, borderColor: dubluCod ? G.red : G.border2 }} placeholder="PIS_SIMINICEA_SIRET" />
                  {dubluCod && <div style={{ fontSize:11, color:G.red, marginTop:4 }}>
                    Există deja: „{dubluCod.nume}"
                  </div>}
                </div>
                <div>
                  <label style={S.lbl}>Beneficiar</label>
                  <input value={f.beneficiar} onChange={e => set('beneficiar', e.target.value)}
                    style={S.input} placeholder="Transgaz SA" />
                </div>
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12 }}>
                <div>
                  <label style={S.lbl}>Beneficiar final</label>
                  <input value={f.beneficiar_final} onChange={e => set('beneficiar_final', e.target.value)}
                    style={S.input} placeholder="opțional" />
                </div>
                <div>
                  <label style={S.lbl}>Valoare lei (fără TVA)</label>
                  <input value={f.valoare_lei} onChange={e => set('valoare_lei', e.target.value)}
                    style={S.input} placeholder="0" inputMode="decimal" />
                </div>
                <div>
                  <label style={S.lbl}>Valoare EUR</label>
                  <input value={f.valoare_eur} onChange={e => set('valoare_eur', e.target.value)}
                    style={S.input} placeholder="opțional" inputMode="decimal" />
                </div>
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:12 }}>
                <div>
                  <label style={S.lbl}>Nr. contract</label>
                  <input value={f.nr_contract} onChange={e => set('nr_contract', e.target.value)} style={S.input} />
                </div>
                <div>
                  <label style={S.lbl}>Data contract</label>
                  <input type="date" value={f.data_contract} onChange={e => set('data_contract', e.target.value)} style={S.input} />
                </div>
                <div>
                  <label style={S.lbl}>Data start</label>
                  <input type="date" value={f.data_start} onChange={e => set('data_start', e.target.value)} style={S.input} />
                </div>
                <div>
                  <label style={S.lbl}>Termen finalizare</label>
                  <input type="date" value={f.data_termen} onChange={e => set('data_termen', e.target.value)} style={S.input} />
                </div>
              </div>
            </div>
          </Sectiune>

          {/* ─── 2. CONTRACT PDF + AI ────────────────────────────────────── */}
          <Sectiune nr="2" titlu="Contract PDF" culoare={G.purple}
            sub="Opțional — AI-ul completează doar câmpurile lăsate goale mai sus">
            {!pdf ? (
              <label style={{
                display:'flex', alignItems:'center', justifyContent:'center', gap:10,
                padding:'20px', border:`1px dashed ${G.border}`, borderRadius:9,
                cursor: pdfBusy ? 'wait' : 'pointer', color:G.muted, fontSize:13,
              }}>
                {pdfBusy ? '⏳ Se încarcă...' : '📎 Alege PDF-ul contractului (max 10MB)'}
                <input type="file" accept="application/pdf" disabled={pdfBusy} style={{ display:'none' }}
                  onChange={e => { uploadPdf(e.target.files?.[0]); e.target.value = '' }} />
              </label>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                <div style={{
                  background:G.bg, border:`1px solid ${G.border2}`, borderRadius:8, padding:'11px 14px',
                  display:'flex', alignItems:'center', justifyContent:'space-between', gap:12,
                }}>
                  <div style={{ minWidth:0, fontSize:13, color:G.text, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    📄 {pdf.nume} <span style={{ color:G.dim, fontSize:11 }}>({(pdf.size / 1024 / 1024).toFixed(1)} MB)</span>
                  </div>
                  <button onClick={stergePdf} disabled={saving} style={{
                    background:'transparent', border:'none', color:G.red, cursor:'pointer', fontSize:12, flexShrink:0,
                  }}>✕ Scoate</button>
                </div>
                <button onClick={citesteAI} disabled={aiBusy} style={{
                  padding:'11px 18px', background: aiBusy ? G.card2 : G.purple, border:'none', borderRadius:8,
                  color: aiBusy ? G.muted : '#fff', fontWeight:700, fontSize:13, cursor: aiBusy ? 'wait' : 'pointer',
                }}>{aiBusy ? '⏳ Citesc contractul...' : '🤖 Citește contractul cu AI'}</button>
                {aiRes && (
                  <div style={{ fontSize:12, color: aiRes.completate.length ? G.green : G.muted }}>
                    {aiRes.completate.length
                      ? `✓ ${aiRes.completate.length} câmpuri completate (${aiRes.confidence}% încredere) — verifică-le înainte de salvare`
                      : 'AI nu a găsit câmpuri noi de completat'}
                  </div>
                )}
                {(f.durata_contract_luni || f.penalitati_zi_pct || f.garantie_buna_exec_pct) && (
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:12 }}>
                    <div>
                      <label style={S.lbl}>Durată (luni)</label>
                      <input value={f.durata_contract_luni} onChange={e => set('durata_contract_luni', e.target.value)} style={S.input} />
                    </div>
                    <div>
                      <label style={S.lbl}>Penalități / zi (%)</label>
                      <input value={f.penalitati_zi_pct} onChange={e => set('penalitati_zi_pct', e.target.value)} style={S.input} />
                    </div>
                    <div>
                      <label style={S.lbl}>Garanție bună execuție (%)</label>
                      <input value={f.garantie_buna_exec_pct} onChange={e => set('garantie_buna_exec_pct', e.target.value)} style={S.input} />
                    </div>
                  </div>
                )}
              </div>
            )}
          </Sectiune>

          {/* ─── 3. ȘANTIER ──────────────────────────────────────────────── */}
          <Sectiune nr="3" titlu="Șantier" culoare={G.orange}
            sub="Pontajul, utilajele și rapoartele zilnice se leagă de șantier">
            <div style={{ display:'flex', gap:8, marginBottom:12, flexWrap:'wrap' }}>
              {[
                { k:'nou',      l:'🏗️ Șantier nou' },
                { k:'existent', l:'🔗 Șantier existent' },
                { k:'fara',     l:'⏭️ Fără șantier acum' },
              ].map(o => (
                <button key={o.k} onClick={() => setSiteMod(o.k)} style={{
                  padding:'8px 14px', borderRadius:7, fontSize:12, fontWeight:700, cursor:'pointer',
                  background: siteMod === o.k ? G.orange + '22' : G.bg,
                  border: `1px solid ${siteMod === o.k ? G.orange : G.border2}`,
                  color: siteMod === o.k ? G.orange : G.muted,
                }}>{o.l}</button>
              ))}
            </div>
            {siteMod === 'nou' && (
              <div>
                <label style={S.lbl}>Denumire șantier</label>
                <input value={siteNume} onChange={e => setSiteNume(e.target.value)} style={S.input}
                  placeholder={f.nume ? `Gazpet - ${f.nume}` : 'Gazpet - ...'} />
                <div style={{ fontSize:11, color:G.dim, marginTop:5 }}>
                  Se creează: <b style={{ color:G.muted }}>{siteNumeEfectiv || '—'}</b>
                </div>
              </div>
            )}
            {siteMod === 'existent' && (
              <select value={siteId} onChange={e => setSiteId(e.target.value)} style={S.input}>
                <option value="">— alege șantierul —</option>
                {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
            {siteMod === 'fara' && (
              <div style={{ fontSize:12, color:G.muted }}>
                Proiectul se creează fără șantier — îl poți lega mai târziu din „✏️ Editează proiect".
              </div>
            )}
          </Sectiune>

          {/* ─── 4. FOLDER NAS ───────────────────────────────────────────── */}
          <Sectiune nr="4" titlu="Folder NAS" culoare={G.teal}
            sub="Doar foldere neatribuite încă. Fără el, corespondența rămâne doar în platformă.">
            {nasSel ? (
              <div style={{
                background:G.bg, border:`1px solid ${G.teal}55`, borderRadius:8, padding:'11px 14px',
                display:'flex', alignItems:'center', justifyContent:'space-between', gap:12,
              }}>
                <div style={{ minWidth:0 }}>
                  <div style={{ fontSize:13, fontWeight:600, color:G.text }}>📁 {nasSel.denumire_folder}</div>
                  <div style={{ fontSize:11, color:G.muted, marginTop:2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    {nasSel.nas_path}
                  </div>
                </div>
                <button onClick={() => setNasSel(null)} style={{
                  background:'transparent', border:'none', color:G.red, cursor:'pointer', fontSize:12, flexShrink:0,
                }}>✕ Schimbă</button>
              </div>
            ) : (
              <>
                <div style={{ display:'flex', gap:8, marginBottom:10 }}>
                  <input value={nasQ} onChange={e => setNasQ(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && cautaNas()} style={{ ...S.input, flex:1 }}
                    placeholder="Caută folder (ex: 141, Siminicea) sau lipește calea din Explorer" />
                  <button onClick={cautaNas} disabled={nasBusy} style={{
                    padding:'9px 16px', background:G.teal, border:'none', borderRadius:7,
                    color:'#0D1117', fontWeight:700, fontSize:13, cursor:'pointer', whiteSpace:'nowrap',
                  }}>{nasBusy ? '...' : '🔍 Caută'}</button>
                </div>
                {nasRez.length > 0 && (
                  <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                    {nasRez.map(r => (
                      <div key={r.id_hash} style={{
                        background:G.bg, border:`1px solid ${G.border2}`, borderRadius:8, padding:'10px 13px',
                        display:'flex', alignItems:'center', justifyContent:'space-between', gap:12,
                      }}>
                        <div style={{ minWidth:0 }}>
                          <div style={{ fontSize:13, fontWeight:600, color:G.text, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                            {r.denumire_folder}
                          </div>
                          <div style={{ fontSize:11, color:G.muted, marginTop:2 }}>
                            {r.beneficiar}{r.nr_licitatie ? ` · #${r.nr_licitatie}` : ''}
                          </div>
                        </div>
                        <button onClick={() => { setNasSel(r); setNasRez([]) }} style={{
                          padding:'7px 14px', background:G.green, border:'none', borderRadius:6,
                          color:'#fff', fontWeight:700, fontSize:12, cursor:'pointer', flexShrink:0,
                        }}>Alege</button>
                      </div>
                    ))}
                  </div>
                )}
                {nasQ.trim().length >= 2 && nasRez.length === 0 && !nasBusy && (
                  <div style={{ fontSize:12, color:G.muted }}>
                    Niciun folder liber găsit. Scannerul NAS rulează la 12:00 și 22:00 — poți lega folderul și mai târziu, din tab-ul Documente.
                  </div>
                )}
              </>
            )}
          </Sectiune>

          {/* ─── 5. GMAIL ────────────────────────────────────────────────── */}
          <Sectiune nr="5" titlu="Corespondență pe email" culoare={G.pink}
            sub="Eticheta se creează singură în Gmail (automatizari@gazpet.ro) în max 15 minute">
            <div style={{ display:'grid', gap:12 }}>
              <div>
                <label style={S.lbl}>Etichetă Gmail <span style={{ color:G.dim, fontWeight:400 }}>(generată automat)</span></label>
                <input value={f.eticheta_gmail}
                  onChange={e => { etichetaAtinsa.current = true; set('eticheta_gmail', e.target.value) }}
                  style={{ ...S.input, borderColor: dubluEticheta ? G.red : G.border2 }} placeholder="PIS-Siminicea" />
                {dubluEticheta
                  ? <div style={{ fontSize:11, color:G.red, marginTop:4 }}>Eticheta e deja folosită de „{dubluEticheta.nume}"</div>
                  : <div style={{ fontSize:11, color:G.dim, marginTop:4 }}>Lasă gol dacă proiectul nu are corespondență pe email.</div>}
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                <div>
                  <label style={S.lbl}>Filtru — expeditor</label>
                  <input value={f.filtru_gmail_from} onChange={e => set('filtru_gmail_from', e.target.value)}
                    style={S.input} placeholder="dcc...@transgaz.ro" />
                </div>
                <div>
                  <label style={S.lbl}>Filtru — subiect</label>
                  <input value={f.filtru_gmail_subject} onChange={e => set('filtru_gmail_subject', e.target.value)}
                    style={S.input} placeholder='"Lot 1" OR CTG1' />
                </div>
              </div>
              <div>
                <label style={S.lbl}>Filtru — căutare liberă (conținut)</label>
                <input value={f.filtru_gmail_query} onChange={e => set('filtru_gmail_query', e.target.value)}
                  style={S.input} placeholder="Siminicea OR Siret" />
              </div>
            </div>
          </Sectiune>

          {/* Observații */}
          <div style={{ marginBottom:16 }}>
            <label style={S.lbl}>Observații</label>
            <textarea value={f.observatii} onChange={e => set('observatii', e.target.value)}
              rows={2} style={{ ...S.input, resize:'vertical' }} placeholder="opțional" />
          </div>

          {/* Rezumat + acțiune */}
          <div style={{
            background:G.card2, border:`1px solid ${G.border}`, borderRadius:10, padding:'14px 16px', marginBottom:16,
          }}>
            <div style={{ fontSize:11, color:G.muted, fontWeight:700, marginBottom:8, textTransform:'uppercase', letterSpacing:'.4px' }}>
              La salvare se face
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:5, fontSize:12, color:G.text }}>
              <div>📁 Proiect <b>{f.cod_intern || '—'}</b>{f.valoare_lei ? ` · ${f.valoare_lei} lei` : ''}</div>
              {siteMod === 'nou'      && <div>🏗️ Șantier nou: <b>{siteNumeEfectiv || '—'}</b></div>}
              {siteMod === 'existent' && <div>🏗️ Legat la: <b>{sites.find(s => String(s.id) === String(siteId))?.name || '— neales —'}</b></div>}
              {pdf                    && <div>📜 Contract atașat: <b>{pdf.nume}</b></div>}
              {nasSel                 && <div>📂 Folder NAS: <b>{nasSel.denumire_folder}</b></div>}
              {f.eticheta_gmail.trim() && <div>📧 Etichetă Gmail <b>{f.eticheta_gmail}</b> — creată automat în max 15 min</div>}
            </div>
          </div>

          <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
            <button onClick={inchide} disabled={saving} style={{
              padding:'12px 22px', background:'transparent', border:`1px solid ${G.border}`,
              borderRadius:9, color:G.muted, fontSize:13, fontWeight:600, cursor:'pointer',
            }}>Anulează</button>
            <button onClick={creeaza} disabled={!potSalva} style={{
              padding:'12px 28px', background: potSalva ? G.greenBg : G.card2, border:'none', borderRadius:9,
              color: potSalva ? '#fff' : G.dim, fontSize:14, fontWeight:800,
              cursor: potSalva ? 'pointer' : 'not-allowed',
            }}>{saving ? '⏳ Se creează...' : '✅ Creează proiectul'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
