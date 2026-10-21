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
// 21.10.2026 — HR: dublura din dosar (varianta A, TKT-2026-0343). Dacă același fișier
//   (nume + mărime) e deja la angajat (de regulă adus din Drive), rândul nu mai rămâne
//   blocat în coadă: „Închide (e deja în dosar)" îl leagă de documentul existent, iar
//   „Completează și închide" umple doar câmpurile GOALE din dosar cu ce a citit AI-ul.
//   Logica pură (clasificare, validare, ce se completează) e în citesteOriceDubluri.js.
//   Review r1: copia ACTIVĂ din dosar are prioritate; finalizeInbox nu mai aruncă: documentul
//   țintă e salvat, deci coada + ecranul părinte se reîmprospătează și când închiderea rândului
//   pică (toate modulele).
//   Review r2: același fișier doar ca document INACTIV (istoric) → doar „Închide (e deja în dosar)",
//   fără completare și fără o copie nouă (varianta A nu are inserare la „același fișier").
//   „Același nume" cu mărime necunoscută nu mai e prezentat ca „alt fișier (altă mărime)".
//   Review extern (Copilot + Jakarinos): gărzile de identitate pe documentul din dosar (angajat, nume,
//   mărime, tip, fara_expirare — F1/F6); garda finală din confirmHR nu mai depinde de o listă limitată
//   (căutare exactă + count — F3); căutarea proactivă e per angajat, iar un răspuns trunchiat e
//   eroare de căutare, nu „liber" (F4).
//   Verificare r4: la 0 rânduri, starea rândului o dă citirea lui directă, nu coada modulului (un rând
//   mutat în alt modul lipsește din coadă, dar e tot deschis — F5).
//   Simplificare: fără marcaj de reîncercare; fișierul din staging se șterge după închidere ca pe main,
//   deci de regulă o reîncercare nu mai poate salva documentul a doua oară — un rând rămas deschis se scoate cu ✕.
//   Fix-uri după simplificare: dacă ștergerea din staging pică, mesajul spune explicit că încă un
//   «✓ Confirmă» ar salva a doua oară (NH-1); mesajele numesc ambele butoane roșii (HR-2); ✕ Respinge are
//   text neutru și rezultatul verificat (RB2 / NH-2); un document „fără expirare" (sau tip fără expirare)
//   nu primește data expirării la „Completează și închide" (HR-1).
//   Review final: documentul inserat din rândul #N poartă în observații „[Citește orice #N]" — dacă închiderea
//   rândului și ștergerea din staging pică, o reîncercare îl recunoaște (oricare i-ar fi mărimea) și doar
//   închide, fără a doua inserare (J1); o eroare de transport la UPDATE-ul rândului se verifică prin citirea
//   lui, nu se raportează „neînchis" (J2); „trunchiat" după count (C1); reverificarea dosarului nu mai arată
//   rezultatul vechi al cheii (C2).
//   Verificare r6: eticheta rândului se caută în TOT dosarul HR (nu doar la angajatul ales) înainte de inserare,
//   din nou chiar înainte de INSERT și înainte de „Închide" — salvat deja la alt angajat → nu se mai salvează /
//   leagă la cel ales acum (F1); reîncărcarea cozii păstrează corecțiile de pe card (F1); rândul se închide doar
//   dacă e încă în coadă — închis între timp de altcineva = avertisment, nu rescriere (F2); fără avertismentul fals
//   de staging în HR (R1).
//   Proveniență structurală (decizia owner 21.10.2026, varianta A): eticheta „[Citește orice #N]" din observații
//   (descrisă mai sus la „Review final” / „Verificare r6”) e înlocuită de coloana hr_documente_personale.sursa_inbox_id
//   (migrarea 20261103a — pusă doar la INSERT, nemodificabilă, unică și cu deleted_at). confirmHR o pune la INSERT,
//   observațiile rămân doar titlul AI; proveniența se caută cu .eq('sursa_inbox_id', rând) la orice angajat, inclusiv
//   copiile șterse logic (fail-closed). Cursa celor două taburi e închisă în BD: al doilea INSERT cade pe indexul unic
//   (23505) → tratat ca „deja salvat din acest rând” (doar închidere, niciodată a doua inserare). Coloana lipsă
//   (42703 / PGRST204) → eroare blocantă „migrarea pentru sursa_inbox_id nu e aplicată — anunță administratorul”.
//   ORDINEA DE LIVRARE: migrarea 20261103a se aplică ÎNAINTEA merge-ului acestui UI.
//   Review extern #821: garda BD de la INSERT (rândul HR deschis, același fișier) poate refuza INSERT-ul cu 23514 când
//   rândul a fost închis / mutat între timp (ex. de wizard-ul „Angajat nou”, care pune acum și el sursa_inbox_id) →
//   'refuzata': copia se șterge, proveniența decide mesajul, coada se reîncarcă — niciodată a doua inserare.
// ===========================================================================

import { useEffect, useState, useCallback, useRef } from 'react'
import { createClient } from '@supabase/supabase-js'
import { jsPDF } from 'jspdf'

import { instrumenteazaStorageRls } from './lib/storageRls.js'
import { analizaDublura, texteAltContinut, cheieDosar, perechiDeVerificat, bucati, liniaObservatii, updateCompletare,
  marime, gardaDocDosar, potrivesteGarda, grupeDupaAngajat, rezultatCautareDosar, mesajEroareCautare, gardaFinalaHR,
  citireNecesara, stareInchidere, mesajInchidere, avertizareStaging, textConfirmareRespingere, mesajRespingere,
  mesajBlocareHR, dosarInVerificare, rezultatProvenienta, provenientaLaAltAngajat, mesajProvenienta, pastreazaEditari,
  STATUS_COADA, rezultatInserareHR, MESAJ_MIGRARE_SURSA, copieDeSters, mesajRefuzSursa } from './citesteOriceDubluri.js'

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
  upa:{ label:'Unități protejate', color:G.teal, emoji:'♿' },
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
  upa: {
    activ:true, entitateLabel:'Furnizor UPA', entitateTip:'furnizor', color:G.teal,
    bucket:'documente-upa',
    // Facturile de la unități protejate → upa_achizitii (plafonul lunar deductibil).
    tipuriText:['factura','altul'],
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

// Operațiile pe storage nu au timeout implicit. Dacă rețeaua se împotmolește la
// mijlocul unui download/upload, promisiunea nu se rezolvă NICIODATĂ: blocul
// `finally` nu mai rulează, butonul rămâne înțepenit pe „⏳…" și singura ieșire
// e reîncărcarea paginii. (Natalia, 12.08.2026: „s-a blocat aplicația".)
const TIMEOUT_STORAGE_MS = 45000
function cuTimeout(promisiune, ms, mesaj) {
  let t
  return Promise.race([
    Promise.resolve(promisiune).finally(() => clearTimeout(t)),
    new Promise((_, rej) => { t = setTimeout(() => rej(new Error(mesaj)), ms) }),
  ])
}

// Match cod tip AI (ex 'itp', 'copie_conforma') → cod real din tipuriFK (ex 'ITP',
// 'Copie conformă'). HR are coduri identice (match exact); logistică are nume RO cu
// majuscule/diacritice → normalizare (fără diacritice, fără spații/underscore).
const normTip = s => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
// Decizie 19.08 (TKT-2026-0114): sub acest prag de încredere NU pre-selectăm
// entitatea — omul alege singur (cazul MITITELU PETRONEL → PAUL MARIAN).
const PRAG_ENTITATE = 70
function entitateAleasa(row) {
  if ('_editEntitate' in row) return row._editEntitate
  if (row.entitate_match_confidence != null && row.entitate_match_confidence < PRAG_ENTITATE) return null
  return row.entitate_id
}

function resolveTipCod(rawTip, tipuriFK) {
  if (!rawTip) return ''
  const exact = (tipuriFK || []).find(t => t.cod === rawTip)
  if (exact) return exact.cod
  const n = normTip(rawTip)
  const fuzzy = (tipuriFK || []).find(t => normTip(t.cod) === n)
  return fuzzy ? fuzzy.cod : ''
}

// ─── HR: ce e deja în dosar pentru perechile (angajat, nume fișier) din coadă ───
// Review extern F4: o căutare per angajat (.eq angajat + .in nume, câte 25 de nume ca URL-ul să
// rămână scurt), nu produs cartezian angajați × nume tăiat la 1000. Un răspuns care atinge limita
// (sau count > rânduri primite) → perechile lui sunt „eroare de căutare" (avertisment vizibil;
// garda din confirmHR protejează oricum), NU „liber". Întoarce { [cheie]: { docs } | { err:true, motiv } }.
// `activ` (r1): o copie inactivă (istoric) nu trebuie să câștige în fața celei active.
// sursa_inbox_id (20261103a): documentul salvat din rând se recunoaște ca 'acelasi' oricare i-ar fi mărimea (J1)
const COLOANE_DOSAR = 'id,employee_id,tip_id,activ,numar_document,emitent,data_emitere,data_expirare,fara_expirare,fisier_path,fisier_nume,fisier_size_bytes,uploadat_de,drive_file_id,observatii,sursa_inbox_id'
const LIMITA_DOSAR = 500        // rânduri per căutare (sub max-rows al API-ului); atinsă = posibil trunchiat
const PARALEL_DOSAR = 6         // căutări simultane (o coadă mare = mulți angajați)
async function interogheaza(q) {
  try { return await q } catch (e) { return { data:null, error:e } }
}
// F1 (r6) + 20261103a: documentul salvat deja din rândul ăsta, la ORICE angajat, după proveniența structurală
// (sursa_inbox_id = id-ul rândului; unic în BD → cel mult unul). Fără filtru pe deleted_at: o copie ștearsă logic tot
// oprește o nouă inserare (indexul o numără) → { err:'migrare' | 'eroare' } | { docs }. Orice rând găsit blochează inserarea.
const cautaProvenienta = async row => rezultatProvenienta(await interogheaza(supabase.from('hr_documente_personale')
  .select('id,employee_id,activ,deleted_at,sursa_inbox_id').eq('sursa_inbox_id', row.id).order('id').limit(10)))
// gărzile din gardaDocDosar ([op, coloană, valoare], op 'eq' | 'is') aplicate pe o cerere supabase
const aplicaGarda = (q, garda) => garda.reduce((acc, [op, col, val]) => acc[op](col, val), q)
async function cautaInDosarHR(perechi) {
  const rez = {}
  for (const val of bucati(grupeDupaAngajat(perechi, 25), PARALEL_DOSAR)) {
    await Promise.all(val.map(async g => {
      const r = rezultatCautareDosar(await interogheaza(supabase.from('hr_documente_personale').select(COLOANE_DOSAR, { count:'exact' })
        .eq('employee_id', g.emp).in('fisier_nume', g.nume).is('deleted_at', null).order('id').limit(LIMITA_DOSAR)),
        { limita:LIMITA_DOSAR, cuNumar:true })
      for (const p of g.perechi) {
        rez[p.k] = r.err ? { err:true, motiv:r.err }
          : { docs: r.docs.filter(d => Number(d.employee_id) === p.emp && d.fisier_nume === p.nume) }
      }
    }))
  }
  return rez
}

// ─── Conversie imagine → PDF comprimat, în browser (jsPDF) ───────
// Orice poză (JPG/PNG/WEBP/HEIC-render) e redimensionată la max 1600px pe latura
// lungă + re-encodată JPEG 82% și pusă într-un PDF cu pagina = dimensiunea imaginii.
// Rezultat: din 5-8MB (poze telefon) → ~200-400KB. Edge-ul primește mereu PDF,
// deci scapă de limita de 5MB/imagine a AI-ului și de orice transform pe server.
const IMG_MAX_DIM = 1600
export async function imageToPdf(file) {
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

  const [view, setView] = useState('upload')
  const busyRef = useRef(new Set())   // anti dublu-click, sincron (state-ul busyId nu apucă să se randeze în <100ms)            // 'upload' | 'confirm'
  const [queue, setQueue] = useState([])
  const queueRef = useRef([])                           // coada curentă, pentru loadQueue (corecțiile de pe card — F1 r6)
  useEffect(() => { queueRef.current = queue }, [queue])
  const [entitati, setEntitati] = useState([])          // proiecte / angajați / vehicule
  const [tipuriFK, setTipuriFK] = useState([])          // pt hr/logistica: [{id,cod,denumire}]
  const [uploading, setUploading] = useState([])
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [toast, setToast] = useState(null)
  // HR: ce am găsit în dosar per (angajat, nume fișier) — { [cheie]: { docs } | { err:true } }.
  // Cheie lipsă = încă se verifică (C2: o reverificare scoate cheia la pornire). dosarSeq = ultima
  // cerere per cheie (un răspuns vechi care ajunge după unul nou nu-l mai suprascrie).
  const [dosar, setDosar] = useState({})
  const dosarSeq = useRef({ n:0, k:{} })

  // ms: mesajele de după o închidere eșuată sunt singura indicație de ieșire → stau mai mult (HR-2);
  // timer-ul vechi se anulează, ca un toast scurt de dinainte să nu-l taie pe cel nou
  const toastTimer = useRef(null)
  const flash = (tip, msg, ms = 3500) => {
    setToast({ tip, msg }); clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), ms)
  }

  // Fără flash în deps (anti-buclă): doar setState + ref-uri stabile.
  const verificaDosar = useCallback(async (rows) => {
    const perechi = perechiDeVerificat(rows, entitateAleasa)
    if (!perechi.length) return
    const seq = ++dosarSeq.current.n
    perechi.forEach(p => { dosarSeq.current.k[p.k] = seq })
    // C2: cheia trece în „verific" — rezultatul vechi (ex. A→B→A pe angajat) nu se afișează cât timp vine cel nou
    setDosar(d => dosarInVerificare(d, perechi.map(p => p.k)))
    let rez
    try { rez = await cautaInDosarHR(perechi) }
    catch (_) { rez = Object.fromEntries(perechi.map(p => [p.k, { err:true, motiv:'eroare' }])) }   // altfel cheia ar rămâne „verific"
    const proaspete = {}
    for (const [k, v] of Object.entries(rez)) if (dosarSeq.current.k[k] === seq) proaspete[k] = v
    if (Object.keys(proaspete).length) setDosar(d => ({ ...d, ...proaspete }))
  }, [])

  // ─── Încărcare coadă (doar documentele modulului curent + nedecis la executie) ──
  const loadQueue = useCallback(async () => {
    setLoading(true)
    let q = supabase.from('ai_documente_inbox').select('*').in('status', STATUS_COADA)
    if (modul === 'executie') q = q.or('modul_tinta.eq.executie,modul_tinta.is.null')
    else q = q.eq('modul_tinta', modul)
    const { data } = await q.order('uploadat_la', { ascending: false })
    // F1 (r6): rândurile proaspete păstrează corecțiile omului (angajat / tip ales pe card) — altfel reveneau tăcut la AI
    setQueue(prev => pastreazaEditari(data || [], prev))
    setLoading(false)
    // HR: dublurile din dosar se caută în fundal — lista apare imediat, panoul de dublură după
    if (modul === 'hr') verificaDosar(pastreazaEditari(data || [], queueRef.current))
  }, [modul, verificaDosar])

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
    } else if (modul === 'upa') {
      const { data } = await supabase.from('logistica_furnizori')
        .select('id,nume,cui,upa_valabil_pana').eq('este_upa', true).eq('activ', true).order('nume')
      setEntitati((data || []).map(f => ({ id:f.id, nume:f.nume, label:f.nume + (f.upa_valabil_pana ? ` (aut. până ${new Date(f.upa_valabil_pana + 'T00:00:00').toLocaleDateString('ro-RO')})` : '') })))
      setTipuriFK([{ id:'factura', cod:'factura', denumire:'Factură' }])
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
  // Fisierele se urca IN PARALEL (cate MAX_PARALEL deodata) si NU se asteapta
  // clasificarea AI inainte de a trece mai departe. Varianta veche procesa
  // strict secvential si astepta pana la 48s per document — la un dosar de
  // 10 acte, ecranul parea inghetat minute intregi, iar omul reincarca acelasi
  // fisier (de aici perechile de duplicate din 12.08).
  const MAX_PARALEL = 4

  async function urcaUnFisier(original) {
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
        // Facturile urcate din panoul UPA rămân în coada UPA, indiferent ce crede AI-ul
        // despre modul (clasificatorul respectă modul_tinta pre-setat, v18).
        if (modul === 'upa') ins.modul_tinta = 'upa'
        const { data: row, error: insErr } = await supabase.from('ai_documente_inbox').insert(ins).select('id').single()
        if (insErr) {
          // rândul nu s-a creat (ex. dublură respinsă) — scoatem fișierul din
          // bucket, altfel rămâne orfan fără nimic care să-l lege de ceva
          await supabase.storage.from(BUCKET_INBOX).remove([path]).catch(() => {})
          throw new Error(insErr.message)
        }

      // Documentul e in coada — atat trebuie sa astepte omul. Clasificarea AI
      // merge in fundal si se vede in lista de confirmare, pe masura ce vine.
      setUploading(u => u.filter(x => x !== rowState))
      return row.id
    } catch (e) {
      setUploading(u => u.map(x => x === rowState ? { ...x, stare: 'eroare', err: String(e.message || e) } : x))
      return null
    }
  }

  async function handleFiles(fileList) {
    const files = Array.from(fileList || [])
    if (!files.length) return

    // valuri de cate MAX_PARALEL — destul cat sa fie rapid, nu atat cat sa
    // sufoce reteaua sau edge-ul de clasificare cu un dosar intreg deodata
    const ids = []
    for (let i = 0; i < files.length; i += MAX_PARALEL) {
      const val = await Promise.all(files.slice(i, i + MAX_PARALEL).map(urcaUnFisier))
      ids.push(...val.filter(Boolean))
    }

    await loadQueue()
    setView('confirm')
    if (!ids.length) return
    flash('ok', ids.length === 1
      ? 'Document urcat. AI-ul îl citește — apare mai jos în câteva secunde.'
      : `${ids.length} documente urcate. AI-ul le citește — apar mai jos pe măsură ce sunt gata.`)

    // reimprospatare in fundal cat timp mai exista documente neclasificate
    asteaptaClasificarea(ids)
  }

  // Nu blocheaza nimic: verifica periodic ce s-a clasificat si reincarca lista
  // DOAR cand chiar s-a schimbat ceva. Varianta initiala reincarca toata coada
  // la fiecare 2.5s — cu 44 de documente in ea, asta tinea interfata ocupata
  // permanent si dadea senzatia de „incarca incet".
  async function asteaptaClasificarea(ids, tries = 40) {
    let inAsteptare = ids.length
    for (let i = 0; i < tries; i++) {
      await new Promise(r => setTimeout(r, 2500))
      const { data } = await supabase.from('ai_documente_inbox')
        .select('id,status').in('id', ids)
      if (!data) continue
      const restante = data.filter(d => d.status === 'in_asteptare').length
      if (restante !== inAsteptare) {
        inAsteptare = restante
        await loadQueue()
      }
      if (!restante) return
    }
  }

  // ─── CONFIRMARE — dispecer per modul ──────────────────────────
  async function handleConfirm(row, opts = {}) {
    // Blindaj dublu-click (cazul Mănăilă 18.08: 2 inserturi la 90ms): ref-ul e
    // sincron, deci al doilea click e refuzat chiar dacă UI-ul n-a apucat să se
    // re-randeze cu butonul dezactivat.
    if (busyRef.current.has(row.id)) return
    busyRef.current.add(row.id)
    try {
      if (modul === 'executie') return await confirmExecutie(row)
      if (modul === 'hr') return await confirmHR(row, opts)
      if (modul === 'logistica') return await confirmLogistica(row)
      if (modul === 'financiar') return await confirmFinanciar(row)
      if (modul === 'upa') return await confirmUPA(row)
      flash('err', 'Confirmarea pentru acest modul nu e încă activă.')
    } finally { busyRef.current.delete(row.id) }
  }

  // Descarcă fișierul din staging și îl urcă în bucketul destinație. Întoarce destPath.
  async function mutaFisier(row, bucketDest, prefix) {
    const { data: blob, error: dlErr } = await cuTimeout(
      supabase.storage.from(BUCKET_INBOX).download(row.fisier_path),
      TIMEOUT_STORAGE_MS, 'Descărcarea documentului a durat prea mult — încearcă din nou.')
    if (dlErr || !blob) throw new Error('Nu pot descărca fișierul: ' + (dlErr?.message || ''))
    const ext = (row.fisier_nume.split('.').pop() || 'pdf').toLowerCase()
    const destPath = `${prefix}/aidoc_${Date.now()}_${randId()}.${ext}`
    const { error: upErr } = await cuTimeout(
      supabase.storage.from(bucketDest).upload(destPath, blob, { upsert: false, contentType: row.fisier_mime || undefined }),
      TIMEOUT_STORAGE_MS, 'Salvarea documentului a durat prea mult — încearcă din nou.')
    if (upErr) throw new Error('Upload destinație: ' + upErr.message)
    return destPath
  }

  // ── Execuție (Faza 1, neschimbat) ─────────────────────────────
  async function confirmExecutie(row) {
    const proiectId = entitateAleasa(row)
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

      await inchideRandSiReimprospateaza(row, 'Document trimis în Execuție ✓', 'executie', tip, 'proiect', proiectId, created.id)
    } catch (e) { flash('err', String(e.message || e)) } finally { setBusyId(null) }
  }

  // ── HR (Faza 2) ───────────────────────────────────────────────
  const numeAngajat = id => (entitati.find(e => Number(e.id) === Number(id)) || {}).label || null   // mesajele F1 (r6)
  // opts.faraGardaNume (21.10): „Adaugă ca document nou" — același nume, ALT fișier (sau mărime
  // necunoscută), confirmat de om. Sare DOAR garda pe nume; același fișier (activ sau inactiv)
  // tot nu trece. opts.marimiComparate (r2): omul a confirmat „altă mărime" — dacă între timp a
  // apărut o copie fără mărime, nu mai e aceeași situație → blochează și reverifică.
  async function confirmHR(row, opts = {}) {
    const angajatId = entitateAleasa(row)
    const tipCod = row._editTip ?? row.tip_document
    if (!angajatId) { flash('err', 'Alege angajatul înainte de a confirma.'); return }
    const tipRow = tipuriFK.find(t => t.cod === tipCod) || tipuriFK.find(t => t.cod === row.tip_document)
    if (!tipRow) { flash('err', 'Alege tipul documentului (autorizațiile ISCIR/sudură se adaugă din secțiunea Autorizații).'); return }
    setBusyId(row.id)
    try {
      // F1 (r6): întâi proveniența rândului (sursa_inbox_id) în TOT dosarul (orice angajat, orice nume / mărime, și
      // copiile șterse logic; fail-closed, migrarea lipsă = blocant) — pe orice drum, inclusiv „Adaugă ca document nou".
      // Salvat deja din rând (și la alt angajat, ales înainte) → nu inserez.
      const prov = await cautaProvenienta(row)
      if (prov.err) throw new Error(mesajEroareCautare(prov.err, row.fisier_nume))
      if (prov.docs.length) {
        await verificaDosar([row])
        flash('err', mesajProvenienta(prov.docs, angajatId, numeAngajat), 12000)
        return
      }
      // Al doilea strat anti-duplicat (ultima apărare — documentul din dosar poate apărea
      // după verificarea din listă): același fișier la același angajat nu se inserează de
      // două ori. Dacă verificarea pică, NU inserăm (fail-closed).
      // Review extern F3: nu depinde de o listă eșantionată. (1) mărime cunoscută → căutare EXACTĂ
      // angajat + nume + mărime, limit 1 (copia activă întâi): găsită → blochează; (2) altfel căutare
      // completă pe nume, cu count: mai multe rânduri decât am primit → eroare, nu inserez.
      // J1: + sursa_inbox_id — documentul salvat din acest rând (închiderea a picat) blochează oricare i-ar fi mărimea,
      // deci și „Adaugă ca document nou" la mărime necunoscută nu-l mai salvează a doua oară.
      const col = 'id,employee_id,fisier_nume,fisier_size_bytes,activ,deleted_at,sursa_inbox_id'
      const sz = marime(row.fisier_size_bytes)
      const exact = sz == null ? null : rezultatCautareDosar(await interogheaza(supabase.from('hr_documente_personale').select(col)
        .eq('employee_id', angajatId).eq('fisier_nume', row.fisier_nume).eq('fisier_size_bytes', sz).is('deleted_at', null)
        .order('activ', { ascending:false, nullsFirst:true }).order('id').limit(1)))
      const peNume = exact && (exact.err || exact.docs.length) ? null
        : rezultatCautareDosar(await interogheaza(supabase.from('hr_documente_personale').select(col, { count:'exact' })
          .eq('employee_id', angajatId).eq('fisier_nume', row.fisier_nume).is('deleted_at', null).order('id').limit(LIMITA_DOSAR)),
          { limita:LIMITA_DOSAR, cuNumar:true })
      const garda = gardaFinalaHR({ row, angajatId, exact, nume:peNume, opts })
      if (garda.err) throw new Error(mesajEroareCautare(garda.err, row.fisier_nume))
      const { bloc, cls } = garda
      if (bloc) {
        // nu e fundătură: reverific rândul, ca să apară panoul de dublură cu acțiunile lui
        await verificaDosar([row])
        flash('err', mesajBlocareHR(bloc, cls, row.fisier_nume))
        return
      }
      const destPath = await mutaFisier(row, cfg.bucket, String(angajatId))
      // F2 (r6) + 20261103a: alt tab / alt om poate salva documentul din același rând cât copiez fișierul (1–5 s) —
      // fără a doua verificare aici: indexul unic pe sursa_inbox_id oprește atomic al doilea INSERT (23505, mai jos).
      const dd = row.payload_ai?.date_document || {}
      const dataExp = dd.data_expirare || null
      const ins = await interogheaza(supabase.from('hr_documente_personale').insert({
        employee_id: angajatId, tip_id: tipRow.id,
        numar_document: dd.numar || null, emitent: dd.emitent || null,
        data_emitere: dd.data_emitere || null, data_expirare: dataExp,
        fara_expirare: !dataExp,
        fisier_path: destPath, fisier_nume: row.fisier_nume,
        fisier_size_bytes: row.fisier_size_bytes, fisier_mime: row.fisier_mime || 'application/pdf',
        // proveniența = coloana (unică, nemodificabilă); observațiile = doar titlul AI, ca pe main
        activ: true, observatii: row.payload_ai?.titlu_scurt || null, uploadat_de: profile.id, sursa_inbox_id: row.id,
      }).select('id').single())
      const rIns = rezultatInserareHR(ins)
      if (copieDeSters(rIns)) {
        // refuz sigur al serverului → copia urcată acum nu e folosită de nimic
        await interogheaza(supabase.storage.from(cfg.bucket).remove([destPath]))
        if (rIns === 'migrare') throw new Error(MESAJ_MIGRARE_SURSA)
        // 23505 pe sursa_inbox_id: documentul din acest rând e deja salvat (alt tab / o încercare anterioară / wizard-ul) →
        // NU a doua inserare; îl caut după proveniență și panoul oferă doar închiderea legată de el (ca la garda de sus).
        // #821 F2 'refuzata': garda BD de la INSERT — rândul a fost închis / mutat între timp (de regulă de wizard-ul
        // „Angajat nou” sau alt tab): proveniența, dacă există, altfel „nu mai e deschis”; coada se reîncarcă.
        const p = await cautaProvenienta(row)
        const docs = p.err ? [] : p.docs
        if (rIns === 'refuzata') { await loadQueue(); flash('err', mesajRefuzSursa(docs, angajatId, numeAngajat), 12000); return }
        await verificaDosar([row])
        flash('err', mesajProvenienta(docs, angajatId, numeAngajat), 12000)
        return
      }
      if (rIns !== 'ok') throw new Error('Insert document HR: ' + (ins.error?.message || 'fără răspuns de la server'))

      // rând neînchis → o reîncercare se oprește în garda de mai sus, fără altă inserare: după proveniența rândului
      // (sursa_inbox_id, la orice angajat — J1 + F1 r6) sau după nume + mărime; iar indexul unic oprește oricum a doua
      await inchideRandSiReimprospateaza(row, 'Document trimis în dosarul angajatului ✓', 'hr', tipCod, 'angajat', angajatId, ins.data.id)
    } catch (e) {
      flash('err', String(e.message || e))
      verificaDosar([row])   // la orice eroare, panoul de dublură arată starea reală a dosarului
    } finally { setBusyId(null) }
  }

  // ── HR: dublura din dosar (21.10, varianta A, TKT-2026-0343) ──
  // Același fișier e deja la angajat → rândul se închide legat de documentul existent
  // (confirmat_ref_id = id-ul lui; fișierul din staging se șterge la închidere — e același fișier).
  // completeaza=true → întâi UPDATE doar pe câmpurile goale, cu gardă .is(camp, null) pe
  // fiecare: dacă între timp le-a pus altcineva → 0 rânduri → NU închid, reverific.
  // Reîncercarea e sigură: după o completare reușită cu rândul neînchis dosarul se reverifică —
  // câmpurile puse nu mai apar goale, deci a doua oară doar închide.
  // asteapta (r1) = starea văzută de om ('acelasi' | 'acelasi_inactiv'); dacă s-a schimbat între
  // timp (documentul a fost arhivat / reactivat / șters) → NU închid, reverific. Gărzile din UPDATE /
  // verificare (gardaDocDosar: id, angajat, nume, mărime, activ, + la completare tip și fara_expirare —
  // review extern F1/F6) leagă exact documentul văzut. Un document INACTIV doar se leagă,
  // nu se completează niciodată (și nu se adaugă o copie activă — r2: varianta A = doar închidere).
  async function inchideDublura(row, completeaza, asteapta = 'acelasi') {
    if (busyRef.current.has(row.id)) return
    busyRef.current.add(row.id)
    setBusyId(row.id)
    try {
      const angajatId = entitateAleasa(row)
      const d = stareDublura(row)
      if (!angajatId || !d?.doc || d.stare !== asteapta) {
        await verificaDosar([row])
        flash('err', 'Documentul din dosar s-a schimbat sau nu-l mai găsesc — am reverificat, nu am închis nimic.')
        return
      }
      const doc = d.doc
      // F1 (r6): documentul a fost salvat deja din acest rând (sursa_inbox_id) la ALT angajat (alegerea de atunci) → nu
      // leg rândul de copia de aici și nu completez nimic în ea; omul alege angajatul corect sau scoate rândul. Fail-closed
      // (și la migrarea lipsă). O copie ștearsă logic de la alt angajat nu oprește legarea de documentul de aici.
      const prov = await cautaProvenienta(row)
      if (prov.err) throw new Error(mesajEroareCautare(prov.err, row.fisier_nume))
      const strain = provenientaLaAltAngajat(prov.docs, angajatId)
      if (strain) {
        await verificaDosar([row])
        flash('err', mesajProvenienta([strain], angajatId, numeAngajat), 12000)
        return
      }
      const inactiv = d.stare === 'acelasi_inactiv'
      const campuri = completeaza && !inactiv ? d.campuri : []
      if (campuri.length) {
        const upd = updateCompletare(campuri, doc.observatii, liniaObservatii(row.id, new Date(), campuri))
        // Gărzi (review extern F1/F6): același document (id, angajat, nume, mărime, tip, activ/istoric, nesters),
        // câmpurile încă goale, aceleași observații (se rescriu cu linia nouă la final — nu pierd o notă
        // pusă între timp) și, dacă intră data expirării, aceeași valoare fara_expirare ca la detectare.
        const q = aplicaGarda(supabase.from('hr_documente_personale').update(upd),
          gardaDocDosar({ doc, angajatId, row, campuri }))
        const { data: upd2, error: updErr } = await q.select('id')
        if (updErr) throw new Error('Completare dosar: ' + updErr.message)
        if (!upd2?.length) {
          await verificaDosar([row])
          flash('err', 'Documentul din dosar s-a schimbat între timp (sau nu ai drept de modificare) — am reverificat, nu am închis nimic.')
          return
        }
      } else {
        // doar închidere: documentul de care leg rândul trebuie să mai existe, ACELAȘI (id, angajat, nume,
        // mărime, nesters) și în aceeași stare (activ / istoric) — F1: verificat în cerere și pe rândul întors
        const garda = gardaDocDosar({ doc, angajatId, row })
        const { data: ex, error: exErr } = await aplicaGarda(supabase.from('hr_documente_personale')
          .select('id,employee_id,fisier_nume,fisier_size_bytes,activ,deleted_at'), garda).limit(1)
        if (exErr) throw new Error('Nu am putut verifica dosarul: ' + exErr.message)
        if (!ex?.length || !potrivesteGarda(ex[0], garda)) {
          await verificaDosar([row])
          flash('err', 'Documentul din dosar nu mai există sau s-a schimbat (alt angajat / nume / mărime / activ-istoric) — am reverificat, nu am închis nimic.')
          return
        }
      }
      const tipCod = (row._editTip ?? row.tip_document) || d.tipDosar?.cod || null
      const ok = await inchideRandSiReimprospateaza(row,
        inactiv ? `Era deja în dosar (document INACTIV, istoric, #${doc.id}) — închis.`
          : campuri.length ? `Era deja în dosar — am completat: ${campuri.map(c => c.eticheta).join(', ')}.` : 'Era deja în dosar — închis.',
        'hr', tipCod, 'angajat', angajatId, doc.id)
      // r4: rândul n-a fost închis → țin butonul ocupat până dosarul e proaspăt (loadQueue nu așteaptă
      // reverificarea), ca o completare reușită să nu mai apară „de completat" (garda ar da fals „s-a schimbat")
      if (!ok) await verificaDosar([row])
    } catch (e) {
      flash('err', String(e.message || e))
      verificaDosar([row])   // după o completare reușită lista de câmpuri se golește → reîncercarea doar închide
    } finally { busyRef.current.delete(row.id); setBusyId(null) }
  }

  // ── Logistică (Faza 2) ────────────────────────────────────────
  async function confirmLogistica(row) {
    const vehiculId = entitateAleasa(row)
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

      await inchideRandSiReimprospateaza(row, 'Document trimis la vehicul ✓', 'logistica', tipCod, 'activ', vehiculId, created.id)
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
    const slId = entitateAleasa(row)
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

      await inchideRandSiReimprospateaza(row, 'Certificat atașat la situația de plată ✓', 'financiar', 'certificat_plata', 'situatie_plata', slId, slId)
    } catch (e) { flash('err', String(e.message || e)) } finally { setBusyId(null) }
  }

  // ── UPA (20.08): factura de la unitate protejată → upa_achizitii ──
  // Furnizorul TREBUIE să fie marcat este_upa în nomenclator (lista entitati e
  // deja filtrată). Valoarea și luna sunt editabile pe card; PDF-ul se mută în
  // bucketul documente-upa și rămâne dovada pentru control.
  async function confirmUPA(row) {
    const furnizorId = entitateAleasa(row)
    const fz = entitati.find(e => e.id === furnizorId)
    if (!fz) { flash('err', 'Alege furnizorul UPA. Dacă nu e în listă, marchează-l întâi ca unitate protejată în Unități protejate → Furnizori.'); return }
    if ((row._editTip ?? row.tip_document) !== 'factura') { flash('err', 'Aici se confirmă doar facturi de la unități protejate.'); return }
    const dd = row.payload_ai?.date_document || {}
    const valoare = Number(row._editValoare ?? dd.valoare_totala)
    if (!valoare || valoare <= 0) { flash('err', 'Completează valoarea facturii (lei, cu TVA).'); return }
    const lunaStr = row._editLuna || (dd.data_emitere ? dd.data_emitere.slice(0, 7) : new Date().toISOString().slice(0, 7))
    setBusyId(row.id)
    try {
      const destPath = await mutaFisier(row, cfg.bucket, String(furnizorId))
      const { data: created, error: insErr } = await supabase.from('upa_achizitii').insert({
        furnizor_id: furnizorId, furnizor_nume: fz.nume || fz.label,
        luna: lunaStr + '-01', numar_factura: dd.numar || null, data_factura: dd.data_emitere || null,
        valoare, descriere: row.payload_ai?.titlu_scurt || null,
        document_path: destPath, created_by: profile.id,
      }).select('id').single()
      if (insErr) throw new Error('Insert achiziție UPA: ' + insErr.message)
      await inchideRandSiReimprospateaza(row, `Factura ${dd.numar || ''} — ${valoare.toLocaleString('ro-RO')} lei scăzută din plafonul lunii ✓`, 'upa', 'factura', 'furnizor', furnizorId, created.id)
    } catch (e) { flash('err', String(e.message || e)) } finally { setBusyId(null) }
  }

  // UPDATE pe rândul din coadă + starea lui după (stareInchidere, cu statusul pus). NU aruncă.
  // r4: 0 rânduri fără eroare → citesc rândul DIRECT (după id), nu din coada modulului: un rând mutat
  // între timp în alt modul lipsește din coadă, dar e tot deschis. J2: la fel după o eroare care NU e un
  // refuz sigur al serverului (rețea / timeout / 5xx — UPDATE-ul poate fi intrat, doar răspunsul s-a pierdut).
  // F2 (r6): UPDATE-ul atinge rândul doar cât e încă în coadă (STATUS_COADA) — unul închis între timp din alt tab / de
  // alt om nu se rescrie (alt angajat / document legat, confirmat → respins); citirea compară și confirmat_ref_id.
  async function actualizeazaRand(row, upd) {
    let res, citire = null
    try { res = await supabase.from('ai_documente_inbox').update(upd).eq('id', row.id).in('status', STATUS_COADA).select('id') }
    catch (e) { res = { error:e } }
    if (citireNecesara(res)) citire = await interogheaza(supabase.from('ai_documente_inbox').select('id,status,confirmat_ref_id').eq('id', row.id).maybeSingle())
    return { stare:stareInchidere(res, citire, upd.status, upd.confirmat_ref_id), eroare:(res && res.error) || null }
  }

  // Marchează rândul inbox confirmat + curăță staging. Întoarce { stare:'inchis' | 'altcineva' | 'deschis' | 'necunoscut',
  // stagingRamas }. 21.10: eroarea update-ului nu se mai înghite (documentul intrase, dar rândul rămânea
  // în coadă fără ca omul să afle). NU aruncă — documentul țintă e deja salvat.
  async function finalizeInbox(row, modulTinta, tip, entTip, entId, refId) {
    const { stare } = await actualizeazaRand(row, {
      status:'confirmat', modul_tinta:modulTinta, tip_document:tip,
      entitate_tip:entTip, entitate_id:entId,
      confirmat_de:profile.id, confirmat_la:new Date().toISOString(), confirmat_ref_id:refId,
    })
    // staging-ul se șterge ORICUM (ca pe main): fără el, încă un «✓ Confirmă» pică la descărcare, nu salvează a
    // doua oară. NH-1: storage-js nu aruncă ({ error } / data = []) → dacă nu s-a șters sigur, mesajul o spune —
    // în afara HR; în HR proveniența rândului (sursa_inbox_id, unică) oprește oricum o nouă confirmare (R1, r6: fără
    // avertisment fals la „Închide").
    const rm = await interogheaza(supabase.storage.from(BUCKET_INBOX).remove([row.fisier_path]))
    return { stare, stagingRamas:avertizareStaging(modul, rm) }
  }

  // Documentul țintă e salvat → închid rândul din coadă și reîmprospătez ORICUM: și când
  // închiderea pică, ecranul părinte (lista proiectului, plafonul UPA, situația de plată,
  // dosarul angajatului) trebuie să vadă documentul nou. Întoarce true doar pe rând sigur închis.
  async function inchideRandSiReimprospateaza(row, msgOk, ...argsFinalize) {
    const { stare, stagingRamas } = await finalizeInbox(row, ...argsFinalize)
    await loadQueue()
    const m = mesajInchidere(stare, msgOk, { stagingRamas })
    flash(m.tip, m.msg, m.tip === 'ok' ? 3500 : 12000)
    onConfirmed && onConfirmed()
    return stare === 'inchis'
  }

  // RB2 / NH-2: e și ieșirea după o închidere eșuată (documentul deja salvat) → text neutru, iar
  // rezultatul se verifică (o cauză care persistă — ex. UPDATE refuzat — nu mai afișează „Respins.").
  async function handleReject(row) {
    if (!confirm(textConfirmareRespingere(row.fisier_nume))) return
    setBusyId(row.id)
    const { stare, eroare } = await actualizeazaRand(row, { status:'respins', respins_motiv:'respins manual', confirmat_de:profile.id, confirmat_la:new Date().toISOString() })
    const m = mesajRespingere(stare, eroare)
    setBusyId(null); flash(m.tip, m.msg, m.tip === 'ok' ? 3500 : 8000); loadQueue()
  }

  async function preview(row) {
    const { data } = await supabase.storage.from(BUCKET_INBOX).createSignedUrl(row.fisier_path, 120)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  function patch(id, key, val) { setQueue(q => q.map(r => r.id === id ? { ...r, [key]: val } : r)) }

  // HR: starea rândului față de dosarul angajatului ales (null în afara HR / fără angajat)
  //   'verific' | 'eroare' (căutarea a picat) | 'liber' | 'acelasi' | 'acelasi_inactiv' | 'alt_continut'
  function stareDublura(row) {
    if (modul !== 'hr') return null
    const emp = entitateAleasa(row)
    if (!emp || !row.fisier_nume) return null
    const st = dosar[cheieDosar(emp, row.fisier_nume)]
    if (!st) return { stare:'verific' }
    if (st.err) return { stare:'eroare', motiv:st.motiv || 'eroare' }
    const a = analizaDublura({ row, docs:st.docs, angajatId:emp, tipuriFK, tipAI:row._editTip ?? row.tip_document })
    return a.tip ? { stare:a.tip, ...a } : { stare:'liber' }
  }

  const numeTip = cod => (tipuriFK.find(t => t.cod === cod) || {}).denumire || TIP_LABEL[cod] || cod || '—'
  const fmtValCamp = c => c.camp.startsWith('data_') ? fmtD(c.val + 'T00:00:00') : c.val

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
                // Re-rutare modul (15.07): AI-ul mai greșește modulul (ex. decizie încetare
                // HR clasificată „ordin de începere" în Execuție cu 35%) — de aici se mută.
                const mutaModul = async (target) => {
                  if (!target || target === row.modul_tinta) return
                  const tm = MODUL_META[target]
                  const { error } = await supabase.from('ai_documente_inbox').update({
                    modul_tinta: target,
                    entitate_tip: (MODUL_CFG[target] || {}).entitateTip || null,
                    entitate_id: null, entitate_match_confidence: null,
                  }).eq('id', row.id)
                  if (error) { flash('err', 'Mutare eșuată: ' + error.message); return }
                  flash('ok', `📦 Mutat în ${tm.label} — confirmă-l din „Citește Orice" deschis în ${tm.label}.`)
                  await loadQueue()
                }
                const eroare = row.status === 'eroare'
                const potConfirma = cfg.activ && (row.modul_tinta === modul || (modul === 'executie' && row.modul_tinta == null))
                const entMatch = entitati.find(e => e.id === (entitateAleasa(row)))
                const dd = row.payload_ai?.date_document
                const dub = stareDublura(row)   // doar HR; null în rest
                const ocupat = busyId === row.id
                // r1/r2: același fișier există doar ca document INACTIV (istoric) → tot „deja în
                // dosar", dar doar închidere: fără completare și fără o copie nouă (varianta A).
                const dubAcelasi = dub?.stare === 'acelasi' || dub?.stare === 'acelasi_inactiv'
                const dubInactiv = dub?.stare === 'acelasi_inactiv'
                // J1: documentul a fost salvat deja din acest rând (sursa_inbox_id) — închiderea a picat
                const descDub = dub?.dinRand ? `salvat deja din acest rând (#${dub.doc.id})` : 'același fișier (nume + mărime)'
                const culDub = dubInactiv ? G.yellow : G.blue
                const badgeDosar = dubAcelasi && (
                  <span style={{ ...chip, background:culDub + '22', color:culDub, border:`1px solid ${culDub}55` }}>
                    {dubInactiv ? `📁 în dosar ca INACTIV${dub.dinDrive ? ' · Drive' : ''}` : `📁 deja în dosar${dub.dinDrive ? ' (Drive)' : ''}`}
                  </span>
                )
                // „Închide" e acțiunea principală când nu am ce completa (inactiv, tip diferit, câmpuri pline, rând eroare)
                const dubCompletez = dub?.stare === 'acelasi' && !dub.tipDiferit && dub.campuri.length > 0
                const btnInchide = dubAcelasi && (
                  <button onClick={() => inchideDublura(row, false, dub.stare)} disabled={ocupat}
                    style={dubCompletez
                      ? { ...btnS, color:culDub, borderColor:culDub + '55', opacity: ocupat ? 0.5 : 1 }
                      : { padding:'8px 18px', background:culDub, color:G.bg, border:'none', borderRadius:8, fontSize:13, fontWeight:700, cursor:'pointer', opacity: ocupat ? 0.5 : 1 }}>
                    {ocupat && !dubCompletez ? '⏳…' : 'Închide (e deja în dosar)'}
                  </button>
                )
                // starea verificării dosarului — și pe rândurile „eroare" (r2: o căutare picată nu se ascunde)
                const infoVerificare = dub?.stare === 'verific' ? (
                  <div style={{ marginBottom:8, fontSize:11, color:G.dim }}>⏳ verific dosarul angajatului…</div>
                ) : dub?.stare === 'eroare' ? (
                  <div style={{ marginBottom:10, display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', fontSize:11.5, color:G.yellow }}>
                    {/* 20261103a: coloana sursa_inbox_id lipsă = blocant, spus ca atare (nu „verific din nou") */}
                    <span>⚠️ {dub.motiv === 'migrare' ? MESAJ_MIGRARE_SURSA : <>{dub.motiv === 'trunchiat' ? 'dosarul are prea multe documente cu acest nume ca să le verific pe toate' : 'nu am putut verifica dosarul'} — {eroare ? 'nu știu dacă fișierul e deja acolo; reverifică înainte să-l scoți din coadă.' : 'la confirmare verific din nou.'}</>}</span>
                    <button onClick={() => verificaDosar([row])} style={{ ...btnS, padding:'3px 10px', fontSize:11.5, color:G.yellow, borderColor:G.yellow + '55' }}>↻ reverifică</button>
                  </div>
                ) : null
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
                      <>
                        <div style={{ fontSize:12.5, color:G.red, background:G.red + '11', padding:'8px 12px', borderRadius:8, marginBottom:10 }}>
                          ⚠ AI nu a putut citi documentul: {row.ai_eroare || 'eroare necunoscută'}. Poți încerca din nou sau adaugă-l manual.
                        </div>
                        {/* 21.10: AI n-a citit nimic, dar același fișier e deja în dosar → doar închidere */}
                        {infoVerificare}
                        {dubAcelasi && (
                          <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', fontSize:12, color:G.muted, marginBottom:10 }}>
                            {badgeDosar}
                            <span>{dub.dinRand ? `Documentul salvat din acest rând (#${dub.doc.id})` : 'Același fișier (nume + mărime)'} e deja la {entMatch?.label || 'acest angajat'}{dubInactiv
                              ? <>, ca document <b style={{ color:G.yellow }}>INACTIV (istoric, #{dub.doc.id})</b> — nu mai trebuie adăugat.</>
                              : ' — nu mai trebuie adăugat.'}</span>
                          </div>
                        )}
                        <div style={{ display:'flex', justifyContent:'flex-end', gap:8 }}>
                          <button onClick={() => handleReject(row)} disabled={busyId === row.id} style={{ ...btnS, color:G.red, borderColor:G.red + '55' }}>✕ Scoate din coadă</button>
                          {btnInchide}
                        </div>
                      </>
                    ) : (
                      <>
                        {/* Ce a detectat AI */}
                        <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginBottom:12, alignItems:'center' }}>
                          <select value={row.modul_tinta || 'executie'} onChange={e => mutaModul(e.target.value)}
                                  title="Modulul țintă — schimbă-l dacă AI-ul a greșit (documentul se mută în coada modulului ales)"
                                  style={{ ...chip, background:mm.color + '22', color:mm.color, border:`1px solid ${mm.color}55`, cursor:'pointer', appearance:'auto' }}>
                            {Object.entries(MODUL_META).map(([k, v]) => (
                              <option key={k} value={k} style={{ background:G.card, color:G.text }}>{v.emoji} {v.label}</option>
                            ))}
                          </select>
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
                          {row.entitate_id && !('_editEntitate' in row) && row.entitate_match_confidence != null && row.entitate_match_confidence < PRAG_ENTITATE && (
                            <span style={{ ...chip, background:G.yellow + '18', color:G.yellow, border:`1px solid ${G.yellow}55` }}>
                              ⚠️ potrivire slabă ({row.entitate_match_confidence}%) — alege manual
                            </span>
                          )}
                        </div>

                        {potConfirma ? (
                          <>
                            {modul === 'hr' && !resolveTipCod(row.tip_document, tipuriFK) && /autorizat|iscir|sudor|sudur|anre|stivuitor|macara/i.test(`${row.tip_document || ''} ${row.payload_ai?.titlu_scurt || ''}`) && (
                              <div style={{ padding:'8px 12px', marginBottom:10, borderRadius:8, background:G.yellow + '14', border:`1px solid ${G.yellow}44`, color:G.yellow, fontSize:12, lineHeight:1.5 }}>
                                ⚠️ Pare o <b>autorizație</b> (ISCIR / sudură / ANRE) — nu se încarcă de aici. Se adaugă din <b>HR → Autorizații</b>, cu tipul, numărul și valabilitatea ei. Aici se confirmă doar documente personale (CI, contracte, diplome, caziere etc.).
                              </div>
                            )}
                            {/* Corecție entitate + tip */}
                            <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginBottom:12 }}>
                              <label style={{ flex:'1 1 260px', fontSize:12 }}>
                                <span style={{ color:G.muted, display:'block', marginBottom:4 }}>{cfg.entitateLabel}</span>
                                <select value={entitateAleasa(row) ?? ''} onChange={e => {
                                  const v = e.target.value ? Number(e.target.value) : null
                                  patch(row.id, '_editEntitate', v)
                                  // HR: alt angajat → reverific dosarul LUI (dublura ține de angajat)
                                  if (modul === 'hr' && v) verificaDosar([{ ...row, _editEntitate: v }])
                                }} style={sel}>
                                  <option value="">— alege {cfg.entitateLabel.toLowerCase()} —</option>
                                  {entitati.map(e => <option key={e.id} value={e.id}>{e.label}</option>)}
                                </select>
                              </label>
                              <label style={{ flex:'1 1 180px', fontSize:12 }}>
                                <span style={{ color:G.muted, display:'block', marginBottom:4 }}>Tip document</span>
                                {cfg.tipuriText ? (
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

                            {/* UPA: valoarea și luna deducerii, editabile */}
                            {modul === 'upa' && (() => {
                              const dd = row.payload_ai?.date_document || {}
                              return (
                                <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginBottom:12 }}>
                                  <label style={{ flex:'1 1 160px', fontSize:12 }}>
                                    <span style={{ color:G.muted, display:'block', marginBottom:4 }}>Valoare factură (lei, cu TVA)</span>
                                    <input type="number" step="0.01" value={row._editValoare ?? dd.valoare_totala ?? ''}
                                      onChange={e => patch(row.id, '_editValoare', e.target.value)} style={sel} placeholder="0.00" />
                                  </label>
                                  <label style={{ flex:'1 1 150px', fontSize:12 }}>
                                    <span style={{ color:G.muted, display:'block', marginBottom:4 }}>Luna din care se scade</span>
                                    <input type="month" value={row._editLuna ?? (dd.data_emitere ? dd.data_emitere.slice(0,7) : new Date().toISOString().slice(0,7))}
                                      onChange={e => patch(row.id, '_editLuna', e.target.value)} style={sel} />
                                  </label>
                                  {dd.numar && <div style={{ alignSelf:'flex-end', fontSize:11, color:G.dim, paddingBottom:9 }}>Factura nr. <b style={{color:G.text}}>{dd.numar}</b>{dd.data_emitere ? ` din ${fmtD(dd.data_emitere)}` : ''}</div>}
                                </div>
                              )
                            })()}

                            {/* Financiar: doar certificatele se confirmă aici */}
                            {modul === 'financiar' && (row._editTip ?? row.tip_document) !== 'certificat_plata' && (
                              <div style={{ marginBottom:12, padding:'10px 12px', background:G.yellow + '12', border:`1px solid ${G.yellow}44`, borderRadius:8, fontSize:12, color:G.text }}>
                                ⚠️ Aici se confirmă doar <b>certificatele de plată</b>. Facturile intră prin importul WinMentor, IPC-urile prin parserul dedicat — poți respinge documentul din coadă.
                              </div>
                            )}

                            {/* Date extrase — document (hr/logistica). La dublura HR „deja în dosar" (activ
                                sau inactiv) nu se mai salvează un document nou → panoul de mai jos spune ce se completează. */}
                            {modul !== 'executie' && !dubAcelasi && dd && (dd.numar || dd.data_emitere || dd.data_expirare || dd.emitent) && (
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

                            {/* HR 21.10 (varianta A): starea față de dosarul angajatului */}
                            {infoVerificare}
                            {dub?.stare === 'acelasi' && (
                              <div style={{ marginBottom:12, padding:'10px 12px', background:G.blue + '10', border:`1px solid ${G.blue}44`, borderRadius:8, fontSize:12, color:G.text, lineHeight:1.55 }}>
                                <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', marginBottom:6 }}>
                                  {badgeDosar}
                                  <span style={{ fontSize:11.5, color:G.muted }}>
                                    {descDub} · {dub.tipDosar?.denumire || `tip #${dub.doc.tip_id}`}{dub.doc.data_emitere ? ` · emis ${fmtD(dub.doc.data_emitere + 'T00:00:00')}` : ''}
                                  </span>
                                </div>
                                {dub.nrIdentice > 1 && (
                                  <div style={{ fontSize:11.5, color:G.yellow, marginBottom:4 }}>⚠️ {dub.nrIdentice} copii identice în dosar{dub.nrInactive ? ` (${dub.nrInactive} inactive)` : ''} — leg de {dub.dinRand ? 'cea salvată din acest rând' : 'cea mai veche activă'} (#{dub.doc.id}).</div>
                                )}
                                {dub.dinRand ? (
                                  <div style={{ color:G.muted }}>Documentul a intrat deja în dosar din acest rând, dar rândul nu s-a închis — doar îl închid, legat de el (nu-l mai adaug a doua oară).</div>
                                ) : dub.tipDiferit ? (
                                  <div style={{ color:G.yellow }}>⚠️ tip diferit (dosar: {dub.tipDosar?.denumire || `tip #${dub.doc.tip_id}`} · AI: {numeTip(row._editTip ?? row.tip_document)}) — nu completez câmpurile</div>
                                ) : dub.campuri.length ? (
                                  <div>
                                    <span style={{ color:G.muted }}>Completez în dosar doar câmpurile goale: </span>
                                    {dub.campuri.map(c => <span key={c.camp} style={{ marginRight:12 }}>{c.eticheta}: <b>{fmtValCamp(c)}</b></span>)}
                                  </div>
                                ) : (
                                  <div style={{ color:G.dim }}>Nimic de completat — câmpurile din dosar sunt deja puse sau AI-ul n-a citit valori valide.</div>
                                )}
                                {/* HR-1: alegerea „fără expirare" din dosar (sau tipul fără expirare) nu se calcă */}
                                {dub.expirareOmisa && (
                                  <div style={{ color:G.dim, marginTop:4 }}>
                                    {dub.expirareOmisa.motiv === 'dosar' ? 'În dosar e marcat „fără expirare"' : `Tipul «${dub.tipDosar?.denumire || 'din dosar'}» nu are expirare`}
                                    {` — nu completez data expirării (AI a citit ${fmtD(dub.expirareOmisa.val + 'T00:00:00')}).`}
                                  </div>
                                )}
                              </div>
                            )}
                            {dubInactiv && (
                              <div style={{ marginBottom:12, padding:'10px 12px', background:G.yellow + '10', border:`1px solid ${G.yellow}44`, borderRadius:8, fontSize:12, color:G.text, lineHeight:1.55 }}>
                                <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', marginBottom:6 }}>
                                  {badgeDosar}
                                  <span style={{ fontSize:11.5, color:G.muted }}>
                                    {descDub} · {dub.tipDosar?.denumire || `tip #${dub.doc.tip_id}`}{dub.doc.data_emitere ? ` · emis ${fmtD(dub.doc.data_emitere + 'T00:00:00')}` : ''}
                                  </span>
                                </div>
                                <div style={{ color:G.yellow }}>
                                  ⚠️ Documentul din dosar (#{dub.doc.id}{dub.nrIdentice > 1 ? `, ${dub.dinRand ? 'cel salvat din acest rând' : 'cel mai vechi'} din ${dub.nrIdentice} copii identice, toate inactive` : ''}) e <b>INACTIV (istoric)</b> — nu apare la documentele active; nu completez nimic în el și nu adaug altă copie.
                                </div>
                                <div style={{ color:G.muted, marginTop:4 }}>
                                  Închide rândul; dacă trebuie să fie din nou activ, îl reactivezi din dosarul angajatului (editează documentul → „Document ACTIV").
                                  {dub.nrTotal > dub.nrIdentice ? ` (Mai există ${dub.nrTotal - dub.nrIdentice} cu același nume, dar alt fișier.)` : ''}
                                </div>
                              </div>
                            )}
                            {dub?.stare === 'alt_continut' && (
                              <div style={{ marginBottom:12, padding:'10px 12px', background:G.yellow + '12', border:`1px solid ${G.yellow}44`, borderRadius:8, fontSize:12, color:G.yellow, lineHeight:1.5 }}>
                                {texteAltContinut(dub, row.fisier_nume).panou}
                                <span style={{ color:G.muted }}> Dacă e un document nou, adaugă-l; dacă e același, respinge-l.</span>
                              </div>
                            )}

                            <div style={{ display:'flex', gap:8, justifyContent:'flex-end', flexWrap:'wrap' }}>
                              <button onClick={() => handleReject(row)} disabled={busyId === row.id} style={{ ...btnS, color:G.red, borderColor:G.red + '55' }}>✕ Respinge</button>
                              {dubAcelasi ? (
                                <>
                                  {btnInchide}
                                  {dubCompletez && (
                                    <button onClick={() => inchideDublura(row, true, 'acelasi')} disabled={ocupat}
                                      style={{ padding:'8px 18px', background:G.greenBg, color:'#fff', border:'none', borderRadius:8, fontSize:13, fontWeight:700, cursor:'pointer', opacity: ocupat ? 0.5 : 1 }}>
                                      {ocupat ? '⏳…' : '✓ Completează și închide'}
                                    </button>
                                  )}
                                </>
                              ) : dub?.stare === 'alt_continut' ? (
                                <button onClick={() => {
                                  // r2: textul confirmării spune „altă mărime" doar când mărimile s-au comparat
                                  const t = texteAltContinut(dub, row.fisier_nume)
                                  if (!window.confirm(t.confirmare)) return
                                  handleConfirm(row, { faraGardaNume:true, marimiComparate:!t.necunoscut })
                                }} disabled={ocupat}
                                  style={{ padding:'8px 18px', background:G.greenBg, color:'#fff', border:'none', borderRadius:8, fontSize:13, fontWeight:700, cursor:'pointer', opacity: ocupat ? 0.5 : 1 }}>
                                  {ocupat ? '⏳…' : 'Adaugă ca document nou'}
                                </button>
                              ) : (
                                <button onClick={() => handleConfirm(row)} disabled={busyId === row.id}
                                  style={{ padding:'8px 18px', background:G.greenBg, color:'#fff', border:'none', borderRadius:8, fontSize:13, fontWeight:700, cursor:'pointer', opacity: busyId === row.id ? 0.5 : 1 }}>
                                  {busyId === row.id ? '⏳…' : `✓ Confirmă → ${meta.label}`}
                                </button>
                              )}
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
          <div style={{ padding:'10px 20px', background:(toast.tip === 'ok' ? G.green : toast.tip === 'warn' ? G.yellow : G.red) + '18', color: toast.tip === 'ok' ? G.green : toast.tip === 'warn' ? G.yellow : G.red, fontSize:13, fontWeight:600, borderTop:`1px solid ${G.border}` }}>
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
