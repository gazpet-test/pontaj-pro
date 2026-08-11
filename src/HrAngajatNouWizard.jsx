// ════════════════════════════════════════════════════════════════
// HrAngajatNouWizard.jsx — HR · „➕ Angajat nou" (Faza 1)
// 11.08.2026 — todo #835 (închide flow-urile de angajare 668/224/648)
//
// Un singur ecran care face toată angajarea:
//   1. Cetățenie (român / UE / non-UE) → checklist-ul de documente se
//      construiește din hr_documente_personale_tipuri (obligatoriu_ro /
//      obligatoriu_non_ue) — zero hardcodare, Natalia îl schimbă din BD.
//   2. Date angajat (nume, funcție, departament, telefon, IBAN, dată angajare).
//   3. Dropzone TOT dosarul scanat → bucket ai-documente-inbox → trigger-ul
//      BD clasifică fiecare document cu AI (citeste-orice) → tip + număr +
//      expirare + câmpuri (CNP, adresă, IBAN) detectate automat.
//   4. AI-ul precompletează DOAR câmpurile goale din formular (anti-bug
//      cunoscut: nu suprascrie ce a tastat omul).
//   5. Finish atomic: INSERT employees → fiecare document confirmat în
//      hr_documente_personale (fișier mutat în documente-personal) →
//      alertele de expirare active din prima zi.
//
// CNP / adresă / data nașterii NU au coloane în employees — se văd în
// wizard (informativ) și rămân în documentele atașate. Coloane noi = decizie
// separată cu Razvan (nu modificăm schema din proprie inițiativă).
// ════════════════════════════════════════════════════════════════
import { useEffect, useState, useMemo, useRef } from 'react'
import { createClient } from '@supabase/supabase-js'
import { jsPDF } from 'jspdf'
import { instrumenteazaStorageRls } from './lib/storageRls.js'

const supabase = instrumenteazaStorageRls(createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
))

const G = {
  bg:'#0D1117', surface:'#161B22', card:'#1C2128', card2:'#21262D', text:'#E6EDF3',
  muted:'#8B949E', dim:'#6E7681', border:'#30363D', border2:'#21262D',
  blue:'#58A6FF', green:'#2EA043', greenBg:'#238636', yellow:'#D29922', orange:'#F0883E',
  red:'#F85149', purple:'#A371F7', teal:'#2DD4BF', pink:'#F778BA', hr:'#F778BA',
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

const BUCKET_INBOX = 'ai-documente-inbox'
const BUCKET_PERSONAL = 'documente-personal'

const CETATENII = [
  { key:'roman',  label:'🇷🇴 Român',            hint:'CI, dosar standard' },
  { key:'ue',     label:'🇪🇺 UE',                hint:'CI/pașaport UE, fără aviz de muncă' },
  { key:'non_ue', label:'🌍 Non-UE (străin)',    hint:'pașaport + aviz muncă + permis ședere' },
]

const DEPARTAMENTE = ['Execuție', 'TESA', 'Logistică']

// Aceeași normalizare ca resolveTipCod din CitesteOricePanel — match cod AI → tip real
const normTip = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
const randId = () => Math.random().toString(36).slice(2, 10)

// ── Conversie imagine → PDF (identic cu CitesteOricePanel — „TOTUL PDF") ──
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
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h)
  ctx.drawImage(img, 0, 0, w, h)
  const jpeg = canvas.toDataURL('image/jpeg', 0.82)
  const pdf = new jsPDF({ orientation: w >= h ? 'landscape' : 'portrait', unit: 'px', format: [w, h], compress: true })
  pdf.addImage(jpeg, 'JPEG', 0, 0, w, h, undefined, 'FAST')
  const blob = pdf.output('blob')
  const nume = (file.name || 'poza').replace(/\.[^.]+$/, '') + '.pdf'
  return new File([blob], nume, { type: 'application/pdf' })
}

export default function HrAngajatNouWizard({ open, onClose, profile, showToast, onCreated }) {
  const [tipuri, setTipuri] = useState([])
  const [cetatenie, setCetatenie] = useState('roman')
  const [f, setF] = useState({
    nume:'', functie:'', department:'Execuție', telefon:'', email:'', iban:'',
    cnp:'', adresa:'', data_nasterii:'',
    hire_date: new Date().toISOString().slice(0, 10),
  })
  // docs: rânduri din ai_documente_inbox urcate de wizard (+ metadate locale)
  const [docs, setDocs] = useState([])
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef(null)
  const pollRef = useRef(null)

  // ─── Tipuri de documente (checklist-ul viu) ───────────────────
  useEffect(() => {
    if (!open) return
    supabase.from('hr_documente_personale_tipuri')
      .select('id,cod,denumire,categorie,are_expirare,obligatoriu_ro,obligatoriu_non_ue,permite_multiple,ordine')
      .eq('activ', true).order('ordine')
      .then(({ data }) => setTipuri(data || []))
  }, [open])

  // ─── Polling clasificare (doc-urile în așteptare) ─────────────
  useEffect(() => {
    if (!open) return
    pollRef.current = setInterval(async () => {
      const pending = docs.filter(d => d.status === 'in_asteptare' || d.status === 'procesare')
      if (!pending.length) return
      const { data } = await supabase.from('ai_documente_inbox')
        .select('id,status,tip_document,payload_ai,clasificare_confidence,ai_eroare')
        .in('id', pending.map(d => d.id))
      if (!data) return
      setDocs(list => list.map(d => {
        const upd = data.find(x => x.id === d.id)
        if (!upd || upd.status === d.status) return d
        // tip AI → tip real din listă (match exact pe cod, apoi normalizat)
        let tipId = d.tip_id
        if (!tipId && upd.tip_document) {
          const exact = tipuri.find(t => t.cod === upd.tip_document)
          const fuzzy = exact || tipuri.find(t => normTip(t.cod) === normTip(upd.tip_document))
          tipId = fuzzy?.id || null
        }
        return { ...d, ...upd, tip_id: tipId }
      }))
    }, 3500)
    return () => clearInterval(pollRef.current)
  }, [open, docs, tipuri])

  // ─── AI → precompletează DOAR câmpurile goale din formular ────
  useEffect(() => {
    const campuri = docs.map(d => d.payload_ai?.campuri || {})
    if (!campuri.length) return
    setF(prev => {
      const next = { ...prev }
      for (const c of campuri) {
        if (!next.nume.trim() && c.nume_complet) next.nume = String(c.nume_complet).toUpperCase()
        if (!next.iban.trim() && c.iban) next.iban = String(c.iban).replace(/\s+/g, '')
        if (!next.cnp.trim() && c.cnp) next.cnp = String(c.cnp).replace(/\D+/g, '')
        if (!next.adresa.trim() && c.adresa) next.adresa = String(c.adresa)
        if (!next.data_nasterii && c.data_nasterii && /^\d{4}-\d{2}-\d{2}$/.test(c.data_nasterii)) next.data_nasterii = c.data_nasterii
      }
      return next
    })
  }, [docs])

  // ─── Checklist obligatorii după cetățenie ─────────────────────
  const obligatorii = useMemo(() => {
    if (cetatenie === 'roman') return tipuri.filter(t => t.obligatoriu_ro)
    if (cetatenie === 'non_ue') return tipuri.filter(t => t.obligatoriu_non_ue)
    // UE: setul comun (RO ∩ non-UE) + identitate (CI sau pașaport, oricare)
    return tipuri.filter(t => t.obligatoriu_ro && t.obligatoriu_non_ue)
  }, [tipuri, cetatenie])

  const tipuriAcoperite = useMemo(() => new Set(docs.filter(d => d.tip_id).map(d => d.tip_id)), [docs])
  const identitateUE = useMemo(() => {
    if (cetatenie !== 'ue') return true
    const ids = tipuri.filter(t => ['buletin', 'pasaport'].includes(t.cod)).map(t => t.id)
    return ids.some(id => tipuriAcoperite.has(id))
  }, [cetatenie, tipuri, tipuriAcoperite])
  const lipsa = useMemo(() => obligatorii.filter(t => !tipuriAcoperite.has(t.id)), [obligatorii, tipuriAcoperite])

  // ─── Upload dosar ─────────────────────────────────────────────
  async function handleFiles(fileList) {
    const files = Array.from(fileList || [])
    if (!files.length) return
    setUploading(true)
    for (const orig of files) {
      try {
        let file = orig
        if ((file.type || '').startsWith('image/')) file = await imageToPdf(file)
        const path = `wizard-angajare/${Date.now()}_${randId()}/${file.name.replace(/[^\w.\-() ]+/g, '_')}`
        const { error: upErr } = await supabase.storage.from(BUCKET_INBOX)
          .upload(path, file, { upsert: false, contentType: file.type || undefined })
        if (upErr) throw upErr
        const { data: row, error: insErr } = await supabase.from('ai_documente_inbox').insert({
          fisier_path: path, fisier_nume: file.name, fisier_size_bytes: file.size,
          fisier_mime: file.type || 'application/pdf', status: 'in_asteptare',
          uploadat_de: profile?.id || null,
        }).select('id,status,fisier_nume,fisier_path').single()
        if (insErr) throw insErr
        setDocs(list => [...list, { ...row, tip_id: null, payload_ai: null, clasificare_confidence: null }])
      } catch (e) {
        showToast?.(`${orig.name}: ${e.message}`, 'error')
      }
    }
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function scoateDoc(doc) {
    setDocs(list => list.filter(d => d.id !== doc.id))
    // curățenie: fișierul din coadă + rândul (documentul n-a fost niciodată confirmat)
    try {
      await supabase.storage.from(BUCKET_INBOX).remove([doc.fisier_path])
      await supabase.from('ai_documente_inbox').delete().eq('id', doc.id)
    } catch (_) { /* rămâne în coadă, îl curăță retenția */ }
  }

  // ─── FINISH — totul în BD, atomic cât permite clientul ────────
  async function finish() {
    if (!f.nume.trim()) { showToast?.('Numele e obligatoriu (NUME_FAMILIE PRENUME)', 'error'); return }
    if (!f.hire_date) { showToast?.('Data angajării e obligatorie', 'error'); return }
    const inCurs = docs.filter(d => d.status === 'in_asteptare' || d.status === 'procesare')
    if (inCurs.length) { showToast?.(`${inCurs.length} documente încă se citesc — așteaptă câteva secunde`, 'warning'); return }
    const faraTip = docs.filter(d => d.status === 'clasificat' && !d.tip_id)
    if (faraTip.length) { showToast?.(`Alege tipul pentru: ${faraTip.map(d => d.fisier_nume).join(', ')}`, 'error'); return }

    setSaving(true)
    try {
      // 1. Angajatul
      const { data: emp, error: empErr } = await supabase.from('employees').insert({
        name: f.nume.trim().toUpperCase(),
        department: f.department,
        functie: f.functie.trim() || null,
        position: f.functie.trim() || null,
        telefon: f.telefon.trim() || null,
        email: f.email.trim() || null,
        iban: f.iban.trim() || null,
        cnp: f.cnp.trim() || null,
        adresa: f.adresa.trim() || null,
        data_nasterii: f.data_nasterii || null,
        hire_date: f.hire_date,
        cetatenie,
        active: true,
      }).select('id,name').single()
      if (empErr) throw empErr

      // 2. Documentele: inbox → documente-personal + hr_documente_personale
      let ok = 0, esuate = []
      for (const d of docs.filter(x => x.status === 'clasificat' && x.tip_id)) {
        try {
          const tip = tipuri.find(t => t.id === d.tip_id)
          const dd = d.payload_ai?.date_document || {}
          const { data: blob, error: dlErr } = await supabase.storage.from(BUCKET_INBOX).download(d.fisier_path)
          if (dlErr) throw dlErr
          const destPath = `${emp.id}/${Date.now()}_${randId()}_${d.fisier_nume.replace(/[^\w.\-() ]+/g, '_')}`
          const { error: upErr } = await supabase.storage.from(BUCKET_PERSONAL)
            .upload(destPath, blob, { upsert: false, contentType: d.fisier_mime || undefined })
          if (upErr) throw upErr
          const { data: created, error: insErr } = await supabase.from('hr_documente_personale').insert({
            employee_id: emp.id, tip_id: d.tip_id,
            numar_document: d._numar ?? dd.numar ?? null,
            data_emitere: dd.data_emitere || null,
            data_expirare: d._expira ?? dd.data_expirare ?? null,
            fara_expirare: tip?.are_expirare ? false : !(d._expira ?? dd.data_expirare),
            fisier_path: destPath, fisier_nume: d.fisier_nume,
            fisier_size_bytes: d.fisier_size_bytes || null, fisier_mime: d.fisier_mime || null,
            activ: true, uploadat_de: profile?.id || null,
          }).select('id').single()
          if (insErr) throw insErr
          await supabase.from('ai_documente_inbox').update({
            status: 'confirmat', modul_tinta: 'hr', tip_document: tip?.cod || d.tip_document,
            entitate_tip: 'angajat', entitate_id: emp.id, destinatie_tabel: 'hr_documente_personale',
            confirmat_de: profile?.id || null, confirmat_la: new Date().toISOString(), confirmat_ref_id: created.id,
          }).eq('id', d.id)
          await supabase.storage.from(BUCKET_INBOX).remove([d.fisier_path])
          ok++
        } catch (e) {
          esuate.push(`${d.fisier_nume}: ${e.message}`)
        }
      }

      // 3. Tichet „Alocare EIP" → Cristiana (todo 648): angajatul nou pleacă
      //    direct în circuitul de echipare; alocarea efectivă se face din Magazie.
      let tichetEip = null
      try {
        const { data: cristiana } = await supabase.from('profiles')
          .select('id').eq('email', 'cristiana.puscasu@gazpet.ro').maybeSingle()
        const tk = {
          departament: 'hr', subcategorie: 'alocare_eip',
          titlu: `Alocare EIP — ${emp.name}`,
          descriere: `Angajat nou din ${f.hire_date} (${f.department}${f.functie ? ', ' + f.functie : ''}). ` +
            `De alocat echipamentul individual de protecție din Magazie → Echipamente și de trecut pe inventarul personal.`,
          urgenta: 'normal',
          entitate_tip: 'angajat', entitate_id: emp.id, entitate_descriere: emp.name,
          deschis_de: profile?.id || null,
          status: cristiana?.id ? 'atribuit' : 'deschis',
          metadata: { sursa: 'wizard_angajare', employee_id: emp.id },
          ...(cristiana?.id ? {
            persoana_responsabila: cristiana.id, atribuit_de: profile?.id || null,
            data_atribuire: new Date().toISOString(), asignat_la: 'intern',
          } : {}),
        }
        const { data: tkRow, error: tkErr } = await supabase.from('tichete').insert(tk).select('id,numar_tichet').single()
        if (tkErr) throw tkErr
        tichetEip = tkRow
        if (cristiana?.id) {
          // trigger-ul pe tichete_asignati îi trimite notificarea Cristianei
          await supabase.from('tichete_asignati').insert({ tichet_id: tkRow.id, profile_id: cristiana.id, asignat_de: profile?.id || null })
        }
      } catch (e) {
        showToast?.('Angajatul e creat, dar tichetul EIP a eșuat: ' + e.message, 'warning')
      }

      const msgLipsa = lipsa.length ? ` · lipsesc din dosar: ${lipsa.map(t => t.denumire).join(', ')}` : ''
      const msgEip = tichetEip ? ` · EIP → tichet ${tichetEip.numar_tichet} la Cristiana` : ''
      if (esuate.length) showToast?.(`Angajat creat, dar ${esuate.length} documente au eșuat: ${esuate[0]}`, 'warning')
      else showToast?.(`✔ ${emp.name} creat cu ${ok} documente${msgEip}${msgLipsa}`, 'success')

      onCreated?.(emp.id)
      resetSiInchide(false)
    } catch (e) {
      showToast?.('Eroare la salvare: ' + e.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  // ─── Abandon: curăță coada de ce am urcat și nu s-a confirmat ─
  async function resetSiInchide(curata = true) {
    if (curata && docs.length) {
      const nefolosite = docs.filter(d => d.status !== 'confirmat')
      try {
        if (nefolosite.length) {
          await supabase.storage.from(BUCKET_INBOX).remove(nefolosite.map(d => d.fisier_path))
          await supabase.from('ai_documente_inbox').delete().in('id', nefolosite.map(d => d.id))
        }
      } catch (_) { /* retenția curăță ce scapă */ }
    }
    setDocs([]); setF({ nume:'', functie:'', department:'Execuție', telefon:'', email:'', iban:'', hire_date: new Date().toISOString().slice(0, 10) })
    setCetatenie('roman')
    onClose?.()
  }

  if (!open) return null

  const docBadge = d => {
    if (d.status === 'in_asteptare' || d.status === 'procesare') return <span style={{ color:G.yellow, fontSize:11 }}>⏳ se citește…</span>
    if (d.status === 'eroare') return <span style={{ color:G.red, fontSize:11 }} title={d.ai_eroare}>⚠ eroare la citire</span>
    return <span style={{ color:G.green, fontSize:11 }}>🤖 {d.clasificare_confidence ?? '–'}%</span>
  }

  return (
    <div onClick={() => !saving && resetSiInchide(true)} style={{
      position:'fixed', inset:0, background:'rgba(0,0,0,.72)', zIndex:1000,
      display:'flex', alignItems:'flex-start', justifyContent:'center', overflowY:'auto', padding:'30px 14px',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width:'min(860px, 100%)', background:G.surface, borderRadius:14,
        border:`1px solid ${G.border}`, boxShadow:'0 18px 60px rgba(0,0,0,.55)',
      }}>
        {/* Header */}
        <div style={{ padding:'16px 20px', borderBottom:`1px solid ${G.border}`, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div>
            <div style={{ fontSize:17, fontWeight:800, color:G.text }}>➕ Angajat nou</div>
            <div style={{ fontSize:11.5, color:G.muted, marginTop:2 }}>
              Arunci dosarul scanat — AI-ul citește, tu verifici, Finish face restul
            </div>
          </div>
          <button onClick={() => !saving && resetSiInchide(true)} style={{
            background:'transparent', border:`1px solid ${G.border}`, color:G.muted,
            borderRadius:8, width:32, height:32, cursor:'pointer', fontSize:15 }}>✕</button>
        </div>

        <div style={{ padding:'16px 20px' }}>
          {/* 1. Cetățenie */}
          <div style={S.sect}>
            <label style={S.lbl}>CETĂȚENIE — decide checklist-ul de documente</label>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
              {CETATENII.map(c => (
                <button key={c.key} onClick={() => setCetatenie(c.key)} style={{
                  flex:'1 1 180px', padding:'10px 12px', borderRadius:8, cursor:'pointer', textAlign:'left',
                  background: cetatenie === c.key ? G.hr + '22' : G.bg,
                  border:`1px solid ${cetatenie === c.key ? G.hr : G.border2}`,
                  color: cetatenie === c.key ? G.hr : G.muted,
                }}>
                  <div style={{ fontWeight:700, fontSize:13 }}>{c.label}</div>
                  <div style={{ fontSize:10.5, marginTop:2, opacity:.8 }}>{c.hint}</div>
                </button>
              ))}
            </div>
          </div>

          {/* 2. Date angajat */}
          <div style={S.sect}>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(210px, 1fr))', gap:12 }}>
              <div style={{ gridColumn:'1 / -1' }}>
                <label style={S.lbl}>NUME COMPLET * (NUME_FAMILIE PRENUME — ca în CI)</label>
                <input style={S.input} value={f.nume} onChange={e => setF({ ...f, nume: e.target.value })} placeholder="POPESCU ION" />
              </div>
              <div>
                <label style={S.lbl}>FUNCȚIE</label>
                <input style={S.input} value={f.functie} onChange={e => setF({ ...f, functie: e.target.value })} placeholder="sudor / lăcătuș / inginer…" />
              </div>
              <div>
                <label style={S.lbl}>DEPARTAMENT *</label>
                <select style={S.input} value={f.department} onChange={e => setF({ ...f, department: e.target.value })}>
                  {DEPARTAMENTE.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label style={S.lbl}>DATA ANGAJĂRII *</label>
                <input type="date" style={{ ...S.input, colorScheme:'dark' }} value={f.hire_date} onChange={e => setF({ ...f, hire_date: e.target.value })} />
              </div>
              <div>
                <label style={S.lbl}>TELEFON</label>
                <input style={S.input} value={f.telefon} onChange={e => setF({ ...f, telefon: e.target.value })} placeholder="07xx xxx xxx" />
              </div>
              <div>
                <label style={S.lbl}>EMAIL</label>
                <input style={S.input} value={f.email} onChange={e => setF({ ...f, email: e.target.value })} placeholder="optional" />
              </div>
              <div>
                <label style={S.lbl}>IBAN (se ia și din extrasul de cont)</label>
                <input style={S.input} value={f.iban} onChange={e => setF({ ...f, iban: e.target.value })} placeholder="RO…" />
              </div>
              <div>
                <label style={S.lbl}>CNP (se ia din CI/pașaport)</label>
                <input style={S.input} value={f.cnp} maxLength={13} onChange={e => setF({ ...f, cnp: e.target.value.replace(/\D+/g, '') })} placeholder="13 cifre" />
              </div>
              <div>
                <label style={S.lbl}>DATA NAȘTERII</label>
                <input type="date" style={{ ...S.input, colorScheme:'dark' }} value={f.data_nasterii} onChange={e => setF({ ...f, data_nasterii: e.target.value })} />
              </div>
              <div style={{ gridColumn:'1 / -1' }}>
                <label style={S.lbl}>ADRESA (domiciliul din CI)</label>
                <input style={S.input} value={f.adresa} onChange={e => setF({ ...f, adresa: e.target.value })} placeholder="se completează din actul de identitate" />
              </div>
            </div>
          </div>

          {/* 3. Dosarul — dropzone + documente */}
          <div style={S.sect}>
            <label style={S.lbl}>DOSARUL DE ANGAJARE — aruncă TOATE documentele scanate (PDF sau poze)</label>
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files) }}
              onClick={() => fileRef.current?.click()}
              style={{
                border:`2px dashed ${dragOver ? G.hr : G.border}`, borderRadius:10, padding:'22px 16px',
                textAlign:'center', cursor:'pointer', background: dragOver ? G.hr + '11' : G.bg,
                color:G.muted, fontSize:13, transition:'all .15s',
              }}>
              {uploading ? '⏳ Se încarcă…' : <>📎 Trage fișierele aici sau <b style={{ color:G.hr }}>click pentru a alege</b><br />
                <span style={{ fontSize:11, color:G.dim }}>pozele se convertesc singure în PDF · numele fișierului ajută AI-ul (ex. „POPESCU ION - CI.pdf")</span></>}
            </div>
            <input ref={fileRef} type="file" multiple accept="application/pdf,image/*" style={{ display:'none' }}
              onChange={e => handleFiles(e.target.files)} />

            {docs.length > 0 && (
              <div style={{ marginTop:12, display:'flex', flexDirection:'column', gap:8 }}>
                {docs.map(d => {
                  const dd = d.payload_ai?.date_document || {}
                  const tip = tipuri.find(t => t.id === d.tip_id)
                  return (
                    <div key={d.id} style={{ background:G.bg, border:`1px solid ${G.border2}`, borderRadius:8, padding:'9px 12px', display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
                      <span style={{ fontSize:12, color:G.text, flex:'1 1 200px', minWidth:160, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }} title={d.fisier_nume}>📄 {d.fisier_nume}</span>
                      {docBadge(d)}
                      {d.status === 'clasificat' && (
                        <>
                          <select value={d.tip_id || ''} onChange={e => setDocs(list => list.map(x => x.id === d.id ? { ...x, tip_id: e.target.value ? +e.target.value : null } : x))}
                            style={{ ...S.input, width:230, padding:'6px 8px', fontSize:12, borderColor: d.tip_id ? G.border2 : G.orange }}>
                            <option value="">— alege tipul —</option>
                            {tipuri.map(t => <option key={t.id} value={t.id}>{t.denumire}</option>)}
                          </select>
                          <input placeholder="nr. doc" defaultValue={dd.numar || ''} onChange={e => setDocs(list => list.map(x => x.id === d.id ? { ...x, _numar: e.target.value } : x))}
                            style={{ ...S.input, width:110, padding:'6px 8px', fontSize:12 }} />
                          {(tip?.are_expirare) && (
                            <input type="date" title="Data expirării" defaultValue={dd.data_expirare || ''} onChange={e => setDocs(list => list.map(x => x.id === d.id ? { ...x, _expira: e.target.value } : x))}
                              style={{ ...S.input, width:140, padding:'6px 8px', fontSize:12, colorScheme:'dark', borderColor: (dd.data_expirare || d._expira) ? G.border2 : G.yellow }} />
                          )}
                        </>
                      )}
                      <button onClick={() => scoateDoc(d)} title="Scoate din dosar" style={{ background:'transparent', border:'none', color:G.red, cursor:'pointer', fontSize:14 }}>✕</button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* 4. Checklist */}
          <div style={S.sect}>
            <label style={S.lbl}>CHECKLIST OBLIGATORII — {CETATENII.find(c => c.key === cetatenie)?.label}</label>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(240px, 1fr))', gap:6 }}>
              {obligatorii.map(t => {
                const are = tipuriAcoperite.has(t.id)
                return (
                  <div key={t.id} style={{ fontSize:12.5, color: are ? G.green : G.muted, display:'flex', gap:7, alignItems:'center' }}>
                    <span>{are ? '✅' : '⬜'}</span> {t.denumire}
                  </div>
                )
              })}
              {cetatenie === 'ue' && (
                <div style={{ fontSize:12.5, color: identitateUE ? G.green : G.muted, display:'flex', gap:7, alignItems:'center' }}>
                  <span>{identitateUE ? '✅' : '⬜'}</span> CI sau Pașaport (oricare)
                </div>
              )}
            </div>
            {lipsa.length > 0 && (
              <div style={{ marginTop:10, fontSize:11.5, color:G.yellow }}>
                ⚠ Dosar incomplet ({lipsa.length} lipsă) — poți salva oricum; documentele se adaugă ulterior prin Citește Orice.
              </div>
            )}
          </div>

          {/* Footer */}
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:10, flexWrap:'wrap' }}>
            <div style={{ fontSize:11, color:G.dim }}>
              La Finish: angajatul intră în sistem, documentele în dosarul lui, alertele de expirare pornesc singure.
            </div>
            <div style={{ display:'flex', gap:10 }}>
              <button disabled={saving} onClick={() => resetSiInchide(true)} style={{
                padding:'10px 18px', background:'transparent', border:`1px solid ${G.border}`,
                borderRadius:8, color:G.muted, cursor:'pointer', fontSize:13, fontWeight:600 }}>Renunță</button>
              <button disabled={saving || uploading} onClick={finish} style={{
                padding:'10px 26px', background:G.greenBg, border:'none', borderRadius:8,
                color:'#fff', cursor:'pointer', fontSize:14, fontWeight:800,
                opacity: saving ? .6 : 1 }}>
                {saving ? '⏳ Se salvează…' : '✓ Finish — creează angajatul'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
