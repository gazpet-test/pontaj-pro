// ════════════════════════════════════════════════════════════════════════
// IZOMETRIE E3 — Magazie → 🧾 Documente de intrare (aviz țeavă / listă de ambalare curbe): recepția și PV-ul
// ════════════════════════════════════════════════════════════════════════
// Gestionarul (atribuit pe proiect + depozit) introduce documentul, marchează fiecare rând primit / neconform / refuzat,
// apasă „Verifică”, apoi „Confirmă recepția” → bucățile intră în registru (sosit / carantina) și apar în 🧱 Țeavă proiecte;
// la final pune PV-ul (sosit → receptionat). Contractul RPC al sesiunii Izometrie (21.10.2026) + design E3_CONFIRMA_DESIGN.md r5.
// SCRIERI DOAR PRIN RPC-urile E3: fn_izo_doc_salveaza / _verifica / _confirma / _pv / _anuleaza_draft (+ fișierul scanului în
// bucket-ul DEDICAT `izo-documente`). Niciun INSERT / UPDATE direct pe tabelele izo_*. O ciornă o anulează gestionarul ei, cu
// motiv („Anulează ciorna”); un document CONFIRMAT se anulează doar administrativ (Răzvan) — fără buton aici.
// Fără migrarea 20261103b ecranul spune doar „Modulul de recepție e în pregătire” (doar la sonda inițială: lista);
// erorile acțiunilor se arată brut și draftul din editor rămâne.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './lib/supabase.js'
import { imageToPdf } from './CitesteOricePanel.jsx'
import { aplicaPropunereOCR, avertismenteOCR, cantitateMultiplaOCR } from './izoDocumentePrefill.js'
import {
  SABLOANE, DECIZII, COLOANE, IZOLATII, esteCurba, parseNumar, fmtNr, fmtM, randGol, validareDocument, eroriSalvare, eroriPv, eroareMotiv,
  randuriDinLipire, randDinBd, antetDinBd, argumenteSalveaza, argumenteConfirma, argumentePv, argumenteAnuleazaDraft, normalizeazaSalvare,
  normalizeazaVerificare, normalizeazaConfirmare, normalizeazaPv, normalizeazaAnulare, listaServer, lipsaReceptie, mesajEroareDoc, poateScrie,
  pregatesteScan, ataseazaScanSigur, stergeScanObiect, linkScan,
} from './izoDocumenteLogica.js'

const G = {
  bg:'#0D1117', surface:'#161B22', border:'#21262D', border2:'#30363D',
  text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  blue:'#58A6FF', green:'#3FB950', red:'#F85149', yellow:'#D29922',
  purple:'#BC8CFF', orange:'#F0883E', magazie:'#FF7B72', cyan:'#2FB6C9',
}
const S = {
  card: { background:G.surface, border:`1px solid ${G.border}`, borderRadius:12 },
  input: { background:G.bg, border:`1px solid ${G.border2}`, color:G.text, borderRadius:8, padding:'8px 10px', fontFamily:'inherit', fontSize:13.5, outline:'none', width:'100%' },
  cel: { background:G.bg, border:`1px solid ${G.border2}`, color:G.text, borderRadius:6, padding:'5px 6px', fontFamily:'inherit', fontSize:12.5, outline:'none' },
  btnS: { background:'#161B22', color:'#E6EDF3', border:'1px solid #30363D', borderRadius:8, padding:'8px 14px', fontFamily:'inherit', fontSize:13, fontWeight:600, cursor:'pointer' },
  btnP: { background:G.green, color:'#06210F', border:'none', borderRadius:8, padding:'9px 16px', fontFamily:'inherit', fontSize:13.5, fontWeight:800, cursor:'pointer' },
  th: { textAlign:'left', padding:'7px 6px', fontSize:11.5, color:G.muted, fontWeight:700, borderBottom:`1px solid ${G.border2}`, whiteSpace:'nowrap' },
  td: { padding:'4px 4px', fontSize:12.5, borderBottom:`1px solid ${G.border}`, verticalAlign:'top' },
  lbl: { fontSize:11.5, color:G.muted, marginBottom:3, display:'block' },
  modal: { position:'fixed', inset:0, background:'#000a', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 },
}
const STARE_META = { draft:{ label:'Draft', color:G.yellow }, confirmat:{ label:'Confirmat', color:G.green }, anulat:{ label:'Anulat', color:G.dim } }
const DECIZIE_CULOARE = { primit:G.green, primit_neconform:G.orange, refuzat_la_receptie:G.red }
const IZOLATIE_LABEL = { neizolata:'neizolată', PEHD:'PEHD', GRP:'GRP' }
const LATIME = { nr_crt:44, serie:118, sarja:92, lot:58, lungime_doc:74, lungime_masurata:74, greutate_kg:66, perete_mm:56, diametru_mm:56, specificatie:150,
  cod:250, item:56, unghi_doc:62, unghi_masurat:66, standard:92, cantitate:42, pachet_nr:54, dimensiuni_cm:100, net_kg:64, brut_kg:64,
  dimensiune:100, grad_otel:80, izolatie:104 }
// câmpul din validare (valori tipizate) → câmpul editorului
const CAMP_EDITOR = { lungime_doc_mm:'lungime_doc', lungime_masurata_mm:'lungime_masurata' }
const aziLocal = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) }
const fmtData = d => { if (!d) return '—'; const x = new Date(d); return isNaN(x) ? '—' : x.toLocaleDateString('ro-RO') }
const uid8 = () => Math.random().toString(36).slice(2, 10)

// ── citirea paginată pe CHEIE (cheie > ultima), până la o pagină goală: nimic trunchiat de limita max-rows a API-ului
// (rândurile se retrimit ca înlocuire integrală — un rezultat trunchiat ar șterge date chiar cu CAS valid) ──
const PAGINA = 1000
async function citestePaginat(cerere, cheie) {
  const tot = []
  for (let ultim = null; ;) {
    let q = cerere()
    if (ultim != null) q = q.gt(cheie, ultim)
    const { data, error } = await q.order(cheie).limit(PAGINA)
    if (error) throw error
    if (!data?.length) return tot
    const nou = data[data.length - 1][cheie]
    if (nou == null || nou === ultim) throw new Error(`paginarea după ${cheie} nu avansează`)
    tot.push(...data); ultim = nou
  }
}
// documentul COERENT: antetul (versiunea) → rândurile + scanurile → versiunea din nou; dacă s-a schimbat între timp, se reia
async function citesteDocument(id) {
  for (let incercare = 0; incercare < 3; incercare++) {
    const rd = await supabase.from('izo_documente_intrare').select('*').eq('id', id).maybeSingle()
    if (rd.error) throw rd.error
    if (!rd.data) throw new Error('documentul nu e vizibil (drepturi) sau nu există')
    const [randuri, scanuri] = await Promise.all([
      citestePaginat(() => supabase.from('izo_documente_intrare_randuri').select('*').eq('document_id', id), 'nr_crt'),
      citestePaginat(() => supabase.from('izo_documente_scanuri').select('*').eq('document_id', id), 'cale'),
    ])
    const rv = await supabase.from('izo_documente_intrare').select('versiune').eq('id', id).maybeSingle()
    if (rv.error) throw rv.error
    if (rv.data && Number(rv.data.versiune) === Number(rd.data.versiune)) return { d: rd.data, randuri, scanuri }
  }
  throw new Error('documentul se modifică chiar acum (salvează altcineva) — încearcă din nou peste câteva secunde')
}

export default function IzoDocumenteIntrare() {
  const [st, setSt] = useState({ incarc:true, eroare:null, neinstalat:false })
  const [eu, setEu] = useState({ owner:false, nivelMagazie:null, atribuiri:[] })
  const [proiecte, setProiecte] = useState([])
  const [depozite, setDepozite] = useState([])
  const [proiectId, setProiectId] = useState(null)
  const [docs, setDocs] = useState([])
  const [statDocs, setStatDocs] = useState({})
  const [incarcDocs, setIncarcDocs] = useState(false)
  const [ed, setEd] = useState(null)          // documentul deschis în editor (câmpurile = text); stale = id-ul de reîncărcat
  const [verif, setVerif] = useState(null)    // ultimul răspuns fn_izo_doc_verifica (normalizat) + docId
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [lipire, setLipire] = useState(null)  // { text, inlocuieste }
  const [pv, setPv] = useState(null)          // { nr, data }
  const [anulare, setAnulare] = useState(null) // { motiv }
  const [rezultat, setRezultat] = useState(null) // { titlu, avertismente } — după confirmare / PV
  const ultima = useRef(0)       // ultima cerere de listă (doar ea se aplică)
  const listaPid = useRef(null)  // proiectul listei afișate (lista altui proiect nu rămâne sub selector)
  const sondaGata = useRef(false) // după prima listă încărcată, „în pregătire” nu mai e permis: erorile se arată brut (review #826 r1)
  const cerereEd = useRef(0)     // ultima (re)încărcare a editorului: un răspuns întârziat nu suprascrie alt document / un document nou
  const revEd = useRef(0), aiLock = useRef(false), fisierSeq = useRef(0)
  const edRef = useRef(ed); edRef.current = ed
  const [pdfAI, setPdfAI] = useState(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [propunere, setPropunere] = useState(null)
  const [modAI, setModAI] = useState('completeaza')
  const [aiMeta, setAiMeta] = useState(null)
  const [aiAplicat, setAiAplicat] = useState(false)
  const [mobilFortat, setMobilFortat] = useState(null)
  const [ingust, setIngust] = useState(() => window.innerWidth < 760)
  const [mobilSalvat, setMobilSalvat] = useState(null)
  const mobil = mobilFortat ?? ingust
  useEffect(() => { const resize = () => setIngust(window.innerWidth < 760); window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize) }, [])
  const contextAI = () => JSON.stringify([cerereEd.current, edRef.current?.id, edRef.current?.proiect_id,
    edRef.current?.depozit_id, edRef.current?.sablon, revEd.current])
  const resetAI = () => { ++fisierSeq.current; setPdfAI(null); setPropunere(null); setAiMeta(null); setAiAplicat(false); setMobilSalvat(null) }

  const flash = useCallback((tip, text) => { setMsg({ tip, text }); if (tip === 'ok') setTimeout(() => setMsg(m => (m?.text === text ? null : m)), 7000) }, [])
  const inPregatire = useCallback(() => setSt({ incarc:false, eroare:null, neinstalat:true }), [])

  // ── încărcarea (SONDA inițială): proiectele cu registru activ, depozitele, drepturile mele ──
  const incarca = useCallback(async () => {
    setSt({ incarc:true, eroare:null, neinstalat:false })
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('nu ești autentificat')
      const [rSonda, rProt, rProj, rDep, rProf, rMod, rAtr] = await Promise.all([
        supabase.from('izo_documente_intrare').select('id').limit(1),     // sonda: tabelele E3 există?
        supabase.rpc('fn_izo_proiecte_protejate'),
        supabase.from('executie_proiecte').select('id, nume, cod_intern, site_id').order('id'),
        supabase.from('logistica_depozite').select('id, name, cod_3litere, site_id, activ').order('id'),
        supabase.from('profiles').select('id, is_owner').eq('id', user.id).maybeSingle(),
        supabase.from('user_module_access').select('access_level').eq('profile_id', user.id).eq('module', 'magazie').maybeSingle(),
        supabase.from('izo_atribuiri').select('proiect_id, depozit_id, rol, activ, valabil_de, valabil_pana').eq('profile_id', user.id).eq('activ', true),
      ])
      if ([rSonda, rProt, rAtr].some(r => lipsaReceptie(r.error))) { inPregatire(); return }
      for (const r of [rSonda, rProt, rProj, rDep, rProf, rAtr]) if (r.error) throw r.error
      const azi = aziLocal()
      const atribuiri = (rAtr.data || []).filter(a => (!a.valabil_de || a.valabil_de <= azi) && (!a.valabil_pana || a.valabil_pana >= azi))
      const owner = !!rProf.data?.is_owner
      const protejate = new Set((rProt.data || []).map(r => r.proiect_id))
      const cuAtribuire = new Set(atribuiri.map(a => a.proiect_id))
      const lista = (rProj.data || []).filter(p => protejate.has(p.id) && (owner || cuAtribuire.has(p.id)))
      setEu({ owner, nivelMagazie: rMod.data?.access_level || null, atribuiri })
      setProiecte(lista)
      setDepozite(rDep.data || [])
      setProiectId(pid => (lista.some(p => p.id === pid) ? pid : lista[0]?.id || null))
      setSt({ incarc:false, eroare:null, neinstalat:false })
    } catch (e) {
      console.error(e)
      setSt({ incarc:false, eroare: mesajEroareDoc(e), neinstalat:false })
    }
  }, [inPregatire])
  useEffect(() => { incarca() }, [incarca])

  // ── lista documentelor proiectului: doar ultima cerere se aplică; „în pregătire” doar la PRIMA listă (sonda), apoi erorile se arată
  // brut; la schimbarea proiectului / la eșec lista veche dispare (nu rămân documentele proiectului A sub selectorul proiectului B) ──
  const golesteLista = () => { setDocs([]); setStatDocs({}); listaPid.current = null }
  const incarcaDocs = useCallback(async (pid) => {
    const c = ++ultima.current
    if (!pid || listaPid.current !== pid) golesteLista()
    if (!pid) return
    setIncarcDocs(true)
    try {
      const data = await citestePaginat(() => supabase.from('izo_documente_intrare').select('*').eq('proiect_id', pid), 'id')
      if (c !== ultima.current) return
      data.sort((a, b) => String(b.data_document || '').localeCompare(String(a.data_document || '')) || b.id - a.id)
      const ids = data.map(d => d.id), stat = {}
      for (let i = 0; i < ids.length; i += 100) {     // statisticile pe bucăți de 100 de id-uri (URL scurt), paginate pe cheie
        const rr = await citestePaginat(() => supabase.from('izo_documente_intrare_randuri').select('id, document_id, decizie').in('document_id', ids.slice(i, i + 100)), 'id')
        if (c !== ultima.current) return
        for (const r of rr) {
          const s = stat[r.document_id] || (stat[r.document_id] = { n:0, primit:0, primit_neconform:0, refuzat_la_receptie:0 })
          s.n++; s[r.decizie] = (s[r.decizie] || 0) + 1
        }
      }
      setDocs(data); setStatDocs(stat); listaPid.current = pid; sondaGata.current = true
    } catch (e) {
      console.error(e)
      if (c !== ultima.current) return
      golesteLista()
      if (!sondaGata.current && lipsaReceptie(e)) { inPregatire(); return }
      flash('err', 'Eroare la încărcarea documentelor: ' + mesajEroareDoc(e))
    } finally { if (c === ultima.current) setIncarcDocs(false) }
  }, [flash, inPregatire])
  useEffect(() => { if (!st.incarc && !st.neinstalat) incarcaDocs(proiectId) }, [proiectId, st.incarc, st.neinstalat, incarcaDocs])

  // ── editorul: (re)încărcarea documentului; întoarce editorul nou sau null (atunci editorul curent devine „stale”). Doar ultima
  // cerere se aplică (cerereEd): un răspuns întârziat pentru A nu suprascrie documentul B deschis / editat între timp (review #826 r1) ──
  const deschide = useCallback(async (id) => {
    const c = ++cerereEd.current
    setBusy(true)
    try {
      const { d, randuri, scanuri } = await citesteDocument(id)
      if (c !== cerereEd.current) return null
      const nou = { id:d.id, versiune:d.versiune, stare:d.stare, sablon:d.sablon, proiect_id:d.proiect_id, depozit_id:d.depozit_id, bd:d,
        inlocuieste_document_id: d.inlocuieste_document_id ?? '', motiv_inlocuire: d.motiv_inlocuire ?? '',
        antet: antetDinBd(d), randuri: randuri.map(r => ({ _k:uid8(), ...randDinBd(r) })), scanuri, dirty:false, stale:null, conflict:false }
      setEd(nou); setVerif(null)
      return nou
    } catch (e) {
      console.error(e)
      if (c !== cerereEd.current) return null
      setVerif(null)
      setEd(x => (x && (x.id === id || x.id == null) ? { ...x, stale:id } : x))   // fără confirmare pe o stare care nu s-a putut reciti
      flash('err', 'Documentul nu s-a putut (re)încărca: ' + mesajEroareDoc(e)); return null
    } finally { if (c === cerereEd.current) setBusy(false) }
  }, [flash])
  const deschideDinLista = id => { if (busy) return; resetAI(); setRezultat(null); setMsg(null); deschide(id) }

  const proiect = proiecte.find(p => p.id === proiectId)
  // depozitele în care se poate crea un document: pe site-ul proiectului ȘI active (serverul, fn_izo_loc_valid, cere d.activ);
  // denumirile (depNume) rămân pentru toate, ca documentele existente pe un depozit dezactivat să se vadă corect
  const depoziteProiect = useMemo(() => depozite.filter(d => proiect && d.site_id === proiect.site_id && d.activ === true), [depozite, proiect])
  const depNume = useMemo(() => Object.fromEntries(depozite.map(d => [d.id, d.cod_3litere ? `${d.cod_3litere} — ${d.name}` : d.name])), [depozite])
  const scrie = useCallback((pid, did) => poateScrie({ owner:eu.owner, nivelMagazie:eu.nivelMagazie, atribuiri:eu.atribuiri, proiectId:pid, depozitId:did, azi:aziLocal() }), [eu])
  const depoziteScriere = useMemo(() => depoziteProiect.filter(d => scrie(proiectId, d.id)), [depoziteProiect, scrie, proiectId])
  const gestionarFaraModul = !eu.owner && !['editor', 'admin'].includes(eu.nivelMagazie) && eu.atribuiri.some(a => a.rol === 'gestionar' && a.proiect_id === proiectId)
  const val = useMemo(() => (ed ? validareDocument(ed) : null), [ed])
  // documentele anulate care se pot înlocui (încă neînlocuite de alt document; serverul verifică oricum ținta și dreptul pe ea)
  const anulate = useMemo(() => {
    const inlocuite = new Set(docs.map(d => d.inlocuieste_document_id).filter(Boolean).map(Number))
    return docs.filter(d => d.stare === 'anulat' && !inlocuite.has(Number(d.id)))
  }, [docs])

  const nou = sablon => {
    if (busy) return
    resetAI()
    setModAI('inlocuieste')
    ++cerereEd.current   // o (re)încărcare întârziată nu mai înlocuiește documentul nou
    const s = SABLOANE[sablon], antet = { furnizor:'', furnizor_cif:'', nr_document:'', data_document:'', observatii:'' }
    for (const [c] of [...s.antet, ...s.totaluri]) antet[c] = ''
    setEd({ id:null, versiune:null, stare:'draft', sablon, proiect_id:proiectId, depozit_id: depoziteScriere.length === 1 ? depoziteScriere[0].id : '',
      antet, randuri:[{ _k:uid8(), ...randGol(sablon, 1) }], scanuri:[], dirty:true, stale:null, conflict:false, inlocuieste_document_id:'', motiv_inlocuire:'' })
    setVerif(null); setRezultat(null); setMsg(null)
  }
  const modifica = fn => { ++revEd.current; setEd(e => ({ ...fn(e), dirty:true })); setVerif(null) }
  const setAntet = (k, v) => modifica(e => ({ ...e, antet:{ ...e.antet, [k]:v } }))
  const setRand = (i, k, v) => modifica(e => { const r = e.randuri.slice(); r[i] = { ...r[i], [k]:v }; return { ...e, randuri:r } })
  const nrMax = e => Math.max(0, ...e.randuri.map(r => parseNumar(r.nr_crt) || 0))
  const adaugaRand = () => modifica(e => ({ ...e, randuri:[...e.randuri, { _k:uid8(), ...randGol(e.sablon, nrMax(e) + 1, e.randuri[e.randuri.length - 1]) }] }))
  const stergeRand = i => modifica(e => ({ ...e, randuri:e.randuri.filter((_, j) => j !== i) }))
  const inchide = () => {
    if (busy) return
    if (ed?.dirty && !window.confirm('Ai modificări nesalvate. Închizi fără să salvezi?')) return
    ++cerereEd.current
    resetAI()
    setEd(null); setVerif(null); setLipire(null); setPv(null); setAnulare(null); setRezultat(null)
  }
  const e40001 = e => String(e?.code || '') === '40001'
  // editorul nu mai reflectă sigur serverul: CAS pierdut la salvare ('40001') sau o salvare cu răspuns pierdut peste modificări nesalvate
  // ('incert'). Modificările rămân în ecran, dar salvarea / verificarea / scanurile / anularea se opresc până la reîncărcarea versiunii
  // serverului, cerută explicit (altfel „Verifică” ar re-salva versiunea veche în buclă — review #826 r1; fără reîncărcare automată peste
  // modificări nesalvate — review #826 r2)
  const marcheazaConflict = (id, motiv = '40001') => setEd(x => (x && x.id === id ? { ...x, conflict:motiv } : x))
  const reincarcaDupaConflict = () => {
    if (ed?.dirty && !window.confirm('Reîncarci versiunea de pe server? Modificările tale nesalvate din ecran se pierd (copiază-le înainte, dacă ai nevoie de ele).')) return
    deschide(ed.id)
  }

  // ── acțiunile (toate prin RPC; erorile se arată brut, draftul rămâne) ──
  // oprește operațiile de scriere pe un editor care nu mai reflectă serverul (reîncărcare eșuată / CAS pierdut)
  const opritScriere = doc => {
    if (doc.stale) { flash('err', 'Reîncarcă documentul înainte de salvare.'); return true }
    if (doc.conflict) { flash('err', `${doc.conflict === 'incert' ? 'Nu se știe dacă ultima salvare s-a aplicat' : 'Documentul s-a schimbat pe server între timp'} — apasă „Reîncarcă versiunea serverului”, apoi refă ce lipsește.`); return true }
    return false
  }
  const salveaza = async (doc = ed) => {
    if (opritScriere(doc)) return null
    const err = eroriSalvare(doc)
    if (err.length) { flash('err', err.join(' ')); return null }
    setBusy(true); setVerif(null)
    try {
      const { data, error } = await supabase.rpc('fn_izo_doc_salveaza', argumenteSalveaza(doc))
      if (error) { if (e40001(error) && doc.id) marcheazaConflict(doc.id); throw error }
      const r = normalizeazaSalvare(data, doc.id || null)
      const nouEd = await deschide(r.document_id)
      incarcaDocs(proiectId)
      if (nouEd) flash('ok', `Draft salvat (versiunea ${r.versiune}).`)
      return nouEd
    } catch (e) { console.error(e); flash('err', 'Salvare eșuată: ' + mesajEroareDoc(e)); return null } finally { setBusy(false) }
  }

  const verifica = async () => {
    let cur = ed
    if (opritScriere(cur)) return
    if (!cur.id || cur.dirty) { cur = await salveaza(); if (!cur) return }
    setBusy(true)
    try {
      const { data, error } = await supabase.rpc('fn_izo_doc_verifica', { p_doc_id:cur.id })
      if (error) throw error
      const v = normalizeazaVerificare(data, cur.id)
      if (v.eroare) { setVerif(null); flash('err', 'Verificare: ' + v.eroare); return }
      if (v.versiune !== Number(cur.versiune)) {
        // altcineva a salvat între timp (ecranul n-are modificări nesalvate aici): reîncarc, nu rămân blocat pe o versiune veche
        setVerif(null); await deschide(cur.id)
        flash('err', 'Documentul a fost modificat de altcineva între timp — l-am reîncărcat; revezi rândurile și apasă din nou „Verifică”.'); return
      }
      setVerif({ ...v, docId:cur.id })
      flash(v.ok ? 'ok' : 'err', v.ok ? `Verificat: fără blocante${v.avertismente.length ? ` (${v.avertismente.length} avertismente)` : ''}. Poți confirma recepția.` : 'Verificarea serverului are blocante — vezi lista de sub tabel.')
    } catch (e) { console.error(e); setVerif(null); flash('err', 'Verificare eșuată: ' + mesajEroareDoc(e)) } finally { setBusy(false) }
  }

  const edRol = !!ed && scrie(ed.proiect_id, ed.depozit_id)
  const edScrie = !!ed && !ed.stale && ed.stare === 'draft' && (ed.id ? edRol : depoziteScriere.length > 0)
  const verifCurenta = !!verif && !!ed && !ed.dirty && !ed.stale && verif.docId === ed.id && verif.versiune === Number(ed.versiune)
  const motivConfirma = !ed ? '' : ed.stale ? 'documentul nu s-a putut reîncărca — apasă „Reîncarcă”'
    : ed.conflict ? 'editorul nu mai reflectă sigur serverul — apasă „Reîncarcă versiunea serverului”' : !ed.id ? 'salvează draftul și apasă „Verifică”'
    : ed.stare !== 'draft' ? 'documentul nu e draft'
    : !edRol ? 'doar gestionarul depozitului documentului sau owner-ul confirmă' : ed.dirty ? 'ai modificări nesalvate — apasă „Verifică”'
    : val?.blocante ? `${val.blocante} probleme blocante în ecran (roșu)` : !verif ? 'apasă întâi „Verifică”'
    : !verifCurenta ? 'documentul s-a schimbat după verificare — apasă din nou „Verifică”' : !verif.ok ? 'verificarea serverului are blocante' : ''
  const poateConfirma = !!ed && !motivConfirma && !busy
  const arePv = !!(ed?.bd && (ed.bd.pv_data || ed.bd.pv_nr_canon || ed.bd.pv_nr || ed.bd.eveniment_pv_id))
  const poatePv = !!ed && !ed.stale && ed.stare === 'confirmat' && !arePv && edRol && !busy
  const poateAnula = !!ed && !ed.stale && !ed.conflict && !!ed.id && ed.stare === 'draft' && edRol && !busy

  const confirma = async () => {
    if (!poateConfirma) return
    const t = val.totaluri, curba = esteCurba(ed.sablon), id = ed.id
    const linii = [`Confirmi recepția documentului ${ed.antet.nr_document} (${ed.antet.furnizor})?`, '',
      `Intră în registru, disponibile în depozit: ${t.primit} ${curba ? 'curbe' : `țevi · ${fmtM(t.m_real_mm / 1000)} m`}`,
      t.neconform ? `În carantină (nedisponibile): ${t.neconform}` : null, t.refuzat ? `Refuzate (nu intră în registru): ${t.refuzat}` : null, '',
      'După confirmare documentul nu se mai poate modifica; anularea lui e doar administrativă (Răzvan).'].filter(x => x !== null)
    if (!window.confirm(linii.join('\n'))) return
    setBusy(true)
    try {
      const { data, error } = await supabase.rpc('fn_izo_doc_confirma', argumenteConfirma(id, verif))
      setVerif(null)
      if (error) { if (e40001(error)) await deschide(id); throw error }
      const reincarcat = await deschide(id); incarcaDocs(proiectId)
      const r = normalizeazaConfirmare(data, id)
      const titlu = `Recepție confirmată: ${r.bucati.length} bucăți în registru${r.idempotent ? ' (era deja confirmată)' : ''}. Le vezi în 🧱 Țeavă proiecte.`
      setRezultat({ titlu, avertismente:r.avertismente })
      if (reincarcat) flash('ok', titlu)
    } catch (e) { console.error(e); flash('err', 'Confirmare eșuată: ' + mesajEroareDoc(e)) } finally { setBusy(false) }
  }

  const punePv = async () => {
    const err = eroriPv(pv?.nr, pv?.data)
    if (err.length) { flash('err', err.join(' ')); return }
    const id = ed.id
    setBusy(true)
    try {
      const { data, error } = await supabase.rpc('fn_izo_doc_pv', argumentePv(ed, pv.nr, pv.data))
      if (error) { if (e40001(error)) { setPv(null); await deschide(id) } throw error }
      const nrPv = pv.nr.trim()
      setPv(null); const reincarcat = await deschide(id); incarcaDocs(proiectId)
      const r = normalizeazaPv(data, id)
      const titlu = `PV ${nrPv} pus: ${r.bucati_receptionate} bucăți trecute în „recepționat”${r.idempotent ? ' (era deja pus)' : ''}.`
      setRezultat({ titlu, avertismente:r.avertismente })
      if (reincarcat) flash('ok', titlu)
    } catch (e) { console.error(e); flash('err', 'PV eșuat: ' + mesajEroareDoc(e)) } finally { setBusy(false) }
  }

  // anularea ciornei (gestionarul / owner-ul, cu motiv): doar antetul; registrul nu e atins
  const anuleazaCiorna = async () => {
    if (opritScriere(ed)) return
    const err = eroareMotiv(anulare?.motiv, 'motivul anulării')
    if (err) { flash('err', err); return }
    const id = ed.id
    setBusy(true)
    try {
      const { data, error } = await supabase.rpc('fn_izo_doc_anuleaza_draft', argumenteAnuleazaDraft(ed, anulare.motiv))
      setVerif(null)
      if (error) { if (e40001(error)) { setAnulare(null); await deschide(id) } throw error }
      setAnulare(null); const reincarcat = await deschide(id); incarcaDocs(proiectId)
      const r = normalizeazaAnulare(data, id)
      if (reincarcat) flash('ok', `Ciorna a fost anulată (versiunea ${r.versiune}). Documentul se poate reintroduce corectat („Corectează documentul anulat”).`)
    } catch (e) { console.error(e); flash('err', 'Anulare eșuată: ' + mesajEroareDoc(e)) } finally { setBusy(false) }
  }

  // scanul: fișierul în `izo-documente` (fără upsert), apoi salvarea cu manifestul ÎNTREG (ataseazaScanSigur). Fișierul se șterge
  // doar când e sigur în afara oricărui manifest (upload ambiguu / salvare refuzată definitiv); la o salvare cu răspuns AMBIGUU
  // rămâne și documentul se reîncarcă (manifestul reîncărcat arată adevărul) — review #826 r1
  const adaugaScan = async (fisier, document = ed) => {
    if (!fisier) return
    if (!document.id) { flash('err', 'Salvează întâi draftul — scanul se atașează unui document salvat.'); return }
    if (opritScriere(document)) return
    const err = eroriSalvare(document); if (err.length) { flash('err', err.join(' ')); return }
    const id = document.id, doc = document
    setBusy(true); setVerif(null)
    try {
      const s = await pregatesteScan(id, fisier, { imageToPdf })
      const r = await ataseazaScanSigur({ storage: supabase.storage, scan: s,
        salveaza: () => supabase.rpc('fn_izo_doc_salveaza', argumenteSalveaza(doc, { scanuri:[...doc.scanuri, s] })) })
      if (r.orfan) console.warn('izo E3: scan posibil orfan în stocare', r.orfan)
      if (r.rez === 'atasat') {
        const reincarcat = await deschide(id); incarcaDocs(proiectId)
        normalizeazaSalvare(r.data, id)
        if (reincarcat) flash('ok', `Scan atașat${doc.dirty ? ' (și modificările din ecran au fost salvate)' : ''}. Hash-ul e declarat de client până la verificarea pe server.`)
        return !!reincarcat
      } else if (r.rez === 'nesalvat') {
        if (e40001(r.error)) marcheazaConflict(id)
        flash('err', 'Scanul nu s-a atașat: ' + mesajEroareDoc(r.error))
      } else if (!doc.dirty) {
        // fără modificări nesalvate reîncărcarea nu pierde nimic: manifestul reîncărcat arată dacă salvarea s-a comis
        await deschide(id); incarcaDocs(proiectId)
        flash('err', `Nu știu sigur dacă scanul s-a atașat (răspunsul serverului s-a pierdut: ${mesajEroareDoc(r.error)}). Documentul a fost reîncărcat — dacă scanul nu apare în listă, atașează-l din nou; fișierul ${r.orfan} rămâne în stocare.`)
      } else {
        // cu modificări nesalvate: NU reîncarc automat (le-aș înlocui cu versiunea serverului); scrierile se opresc până la reîncărcarea cerută
        marcheazaConflict(id, 'incert')
        flash('err', `Nu știu sigur dacă scanul și modificările din ecran s-au salvat (răspunsul serverului s-a pierdut: ${mesajEroareDoc(r.error)}). Modificările rămân în ecran; apasă „Reîncarcă versiunea serverului” ca să vezi ce s-a salvat (fișierul ${r.orfan} rămâne în stocare).`)
      }
    } catch (e) { console.error(e); flash('err', 'Scanul nu s-a atașat: ' + mesajEroareDoc(e)) }
    finally { setBusy(false) }
  }
  const scoateScan = async s => {
    if (opritScriere(ed)) return
    if (!window.confirm('Scoți scanul din document? Fișierul se șterge după ce documentul e salvat fără el.')) return
    const err = eroriSalvare(ed); if (err.length) { flash('err', err.join(' ')); return }
    const id = ed.id
    setBusy(true); setVerif(null)
    try {
      const { data, error } = await supabase.rpc('fn_izo_doc_salveaza', argumenteSalveaza(ed, { scanuri:ed.scanuri.filter(x => x.cale !== s.cale) }))
      if (error) { if (e40001(error)) marcheazaConflict(id); throw error }   // fără DELETE: obiectul poate fi încă în manifest
      const sters = await stergeScanObiect(supabase.storage, s.cale)   // abia acum: un obiect din manifest nu se poate șterge
      const reincarcat = await deschide(id); incarcaDocs(proiectId)
      normalizeazaSalvare(data, id)
      if (reincarcat || !sters) flash(sters ? 'ok' : 'err', sters ? 'Scan scos din document și șters.' : 'Scos din document; fișierul n-a putut fi șters (rămâne orfan în stocare).')
    } catch (e) { console.error(e); flash('err', 'Scanul nu s-a scos: ' + mesajEroareDoc(e)) } finally { setBusy(false) }
  }
  const vedeScan = async s => {
    try { window.open(await linkScan(supabase.storage, s.cale), '_blank', 'noopener') }
    catch (e) { flash('err', 'Scanul nu se poate deschide: ' + (e.message || e)) }
  }

  const aplicaLipire = () => {
    const goala = ed.randuri.length === 1 && !String(ed.randuri[0].serie || '').trim()
    const inloc = lipire.inlocuieste || goala
    const rez = randuriDinLipire(lipire.text, ed.sablon, { nrStart: inloc ? 1 : nrMax(ed) + 1 })
    if (!rez.randuri.length) { flash('err', 'N-am recunoscut niciun rând (fiecare rând are nevoie de seria / bend number).'); return }
    modifica(e => ({ ...e, randuri:[...(inloc ? [] : e.randuri), ...rez.randuri.map(r => ({ _k:uid8(), ...r }))] }))
    setLipire(null)
    flash('ok', `${rez.randuri.length} rânduri adăugate din Excel${rez.ignorate ? ` (${rez.ignorate} sărite: goale / total)` : ''}. Verifică-le înainte de salvare.`)
  }

  const pregatesteAI = async fisier => {
    if (!fisier || aiLock.current || busy) return
    aiLock.current = true; setAiBusy(true)
    const context = contextAI(), seq = ++fisierSeq.current
    setPropunere(null); setPdfAI(null); setAiMeta(null); setAiAplicat(false); setMobilSalvat(null)
    try {
      if (fisier.size > 8 * 1024 * 1024) throw new Error('Fișier prea mare. Limita AI este 8 MB.')
      const pdf = fisier.type.startsWith('image/') ? await imageToPdf(fisier, { maxDim:2600, calitate:0.9 }) : fisier // rezoluție mai mare: cifrele mici din tabel (seria) se pierdeau la 1600 px
      if (pdf.size > 8 * 1024 * 1024) throw new Error('PDF-ul pregătit depășește limita de 8 MB.')
      const semn = new TextDecoder().decode(await pdf.slice(0, 5).arrayBuffer())
      if (semn !== '%PDF-') throw new Error('Fișierul nu este PDF. Alege un PDF valid sau o fotografie.')
      if (context !== contextAI() || seq !== fisierSeq.current) { flash('err', 'Editorul s-a schimbat. Alege din nou fișierul.'); return }
      setPdfAI(pdf)
    } catch (e) { flash('err', e.message || 'Nu s-a putut pregăti fișierul.') }
    finally { aiLock.current = false; setAiBusy(false) }
  }
  const citesteAI = async () => {
    if (!pdfAI || busy || aiLock.current || !edScrie || !edRol || opritScriere(ed)) return
    aiLock.current = true; setAiBusy(true); setPropunere(null); setAiMeta(null)
    const context = contextAI(), seq = fisierSeq.current
    const actual = () => context === contextAI() && seq === fisierSeq.current
    try {
      const pdf_base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.onerror = () => reject(new Error('Nu s-a putut citi PDF-ul.'))
        reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.readAsDataURL(pdfAI)
      })
      if (!actual()) { flash('err', 'Editorul s-a schimbat. Citirea AI a fost abandonată.'); return }
      const { data, error } = await supabase.functions.invoke('ocr-packing-list', { body:{ tip:'aviz_e3', proiect_id:ed.proiect_id,
        depozit_id:ed.depozit_id, sablon:esteCurba(ed.sablon) ? 'lista_curbe' : 'aviz_teava', pdf_base64, nume_fisier:pdfAI.name } })
      let raspuns = data
      if (error?.context?.json) { try { raspuns = await error.context.json() } catch { /* răspuns fără JSON */ } }
      if (!actual()) { flash('err', 'Răspuns AI ignorat: documentul, proiectul, depozitul, șablonul sau formularul s-a schimbat.'); return }
      setAiMeta(raspuns || null)
      if (error || !raspuns?.success) {
        const status = error?.context?.status, cod = raspuns?.eroare
        throw new Error(cod === 'fara_drept' || status === 403 ? 'Nu ai dreptul să citești cu AI pentru acest proiect și depozit.'
          : cod === 'plafon_depasit' || status === 429 ? 'Plafonul AI a fost depășit. Citirea nu a fost efectuată.'
          : status === 413 ? 'PDF prea mare. Limita AI este 8 MB.'
          : status === 422 ? 'PDF invalid sau citire refuzată de AI. Alege alt scan ori completează manual.'
          : 'Citirea AI a eșuat. Încearcă din nou sau completează manual.')
      }
      if (raspuns.tip !== 'aviz_e3' || raspuns.sablon !== (esteCurba(ed.sablon) ? 'lista_curbe' : 'aviz_teava')
        || !raspuns.antet || !Array.isArray(raspuns.randuri) || raspuns.randuri.some(r => !r || typeof r !== 'object' || Array.isArray(r)))
        throw new Error('Răspuns AI incompatibil cu documentul. Completează manual.')
      setPropunere({ raspuns, context })
    } catch (e) { flash('err', actual() ? e.message || 'Citirea AI a eșuat.' : 'Răspuns AI ignorat: editorul s-a schimbat.') }
    finally { aiLock.current = false; setAiBusy(false) }
  }
  const aplicaAI = mod => {
    if (!propunere || busy || aiLock.current || !edScrie || opritScriere(ed)) return
    if (propunere.context !== contextAI()) { setPropunere(null); flash('err', 'Propunerea a expirat: formularul s-a schimbat. Citește din nou documentul.'); return }
    modifica(e => aplicaPropunereOCR(e, propunere.raspuns, { mod }))
    setPropunere(null); setAiAplicat(true)
    flash('ok', 'Propunere aplicată. Verifică datele și alege decizia pentru fiecare bucată înainte de salvare.')
  }
  const ataseazaCitit = async () => {
    if (!pdfAI || busy || aiLock.current || !edScrie || opritScriere(ed)) return
    aiLock.current = true; setAiBusy(true)
    try {
      // La salvare se schimbă versiunea: atașăm exclusiv documentului întors de calea E3.
      const document = !ed.id || ed.dirty ? await salveaza(ed) : ed
      if (document && await adaugaScan(pdfAI, document)) setPdfAI(null)
    } finally { aiLock.current = false; setAiBusy(false) }
  }
  const salveazaMobil = async () => {
    if (busy || aiLock.current || !edScrie || !aiAplicat || opritScriere(ed)) return
    const erori = eroriSalvare(ed)
    if (erori.length) { flash('err', erori.join('\n') + '\nCompletează pe calculator, în ecranul complet.'); return }
    aiLock.current = true; setAiBusy(true)
    try {
      const document = await salveaza(ed)
      if (!document) return
      const atasat = pdfAI ? await adaugaScan(pdfAI, document) : false
      if (atasat) setPdfAI(null)
      setMobilSalvat({ nr:document.antet.nr_document, n:document.randuri.length, atasat })
    } finally { aiLock.current = false; setAiBusy(false) }
  }

  // ════════════════════════════════════════════════════════════════
  if (st.incarc) return <div style={{ padding:30, color:G.dim, textAlign:'center' }}>Se încarcă documentele de intrare…</div>
  if (st.neinstalat) return <div style={{ ...S.card, padding:20, color:G.muted, fontSize:14 }}>🧾 Modulul de recepție e în pregătire.</div>
  if (st.eroare) return <div style={{ ...S.card, padding:20, color:G.red }}>Eroare la încărcare: {st.eroare} <button style={{ ...S.btnS, marginLeft:10 }} onClick={incarca}>Reîncearcă</button></div>
  if (!proiecte.length) return (
    <div style={{ ...S.card, padding:20, color:G.muted, fontSize:14 }}>
      🔒 Niciun proiect cu registru de țeavă pe care să fii atribuit. Documentele de intrare le introduce gestionarul atribuit pe proiect și depozit (atribuirea o dă Răzvan).
    </div>
  )

  const mesaj = msg && (
    <div style={{ padding:'9px 12px', marginBottom:12, borderRadius:8, fontSize:13, background:(msg.tip === 'ok' ? G.green : G.red) + '18',
      border:`1px solid ${(msg.tip === 'ok' ? G.green : G.red)}55`, color: msg.tip === 'ok' ? G.green : G.red, display:'flex', gap:10, alignItems:'flex-start' }}>
      <div style={{ flex:1, wordBreak:'break-word' }}>{msg.text}</div><button onClick={() => setMsg(null)} style={{ background:'none', border:'none', color:'inherit', cursor:'pointer', fontSize:14 }}>✕</button>
    </div>
  )
  const elemServer = (x, j, culoare, semn) => (
    <div key={j} style={{ fontSize:12, marginTop:4, color:culoare }}>{semn} {x.nr_crt != null ? `rândul ${x.nr_crt}: ` : ''}{x.mesaj}{x.cod ? <span style={{ color:G.dim }}> ({x.cod})</span> : null}</div>
  )

  // ── LISTA ──
  if (!ed) return (
    <div>
      <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'center', marginBottom:12 }}>
        <select style={{ ...S.input, maxWidth:360 }} value={proiectId || ''} onChange={e => { golesteLista(); setProiectId(Number(e.target.value)) }} disabled={busy}>
          {proiecte.map(p => <option key={p.id} value={p.id}>{p.cod_intern ? `${p.cod_intern} · ` : ''}{p.nume}</option>)}
        </select>
        <div style={{ flex:1, fontSize:12, color:G.muted, minWidth:220 }}>
          Avizele de țeavă și listele de ambalare ale curbelor. După „Confirmă recepția” bucățile intră în registru și apar în 🧱 Țeavă proiecte.
        </div>
        {depoziteScriere.length > 0 && Object.entries(SABLOANE).map(([k, s]) => (
          <button key={k} style={{ ...S.btnS, color:G.green, borderColor:G.green + '66' }} onClick={() => nou(k)} disabled={busy}>+ {s.emoji} {s.label}</button>
        ))}
        <button style={S.btnS} onClick={() => incarcaDocs(proiectId)} disabled={incarcDocs}>🔄</button>
      </div>
      {mesaj}
      {!depoziteScriere.length && (
        <div style={{ ...S.card, padding:'10px 14px', marginBottom:12, fontSize:12.5, color:G.muted }}>
          👁️ Doar citire — introducerea și confirmarea le face gestionarul depozitului{gestionarFaraModul ? ' (ai atribuirea de gestionar, dar Magazie nu e la nivel editor — cere-i lui Răzvan)' : ''}.
        </div>
      )}
      <div style={{ ...S.card, padding:0, overflowX:'auto' }}>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead><tr>{['Document', 'Furnizor', 'Data', 'Depozit', 'Rânduri', 'Totaluri pe document', 'Stare', 'PV', ''].map(h => <th key={h} style={{ ...S.th, padding:'8px 10px' }}>{h}</th>)}</tr></thead>
          <tbody>
            {incarcDocs && <tr><td colSpan={9} style={{ ...S.td, padding:14, color:G.dim, textAlign:'center' }}>Se încarcă…</td></tr>}
            {!incarcDocs && !docs.length && <tr><td colSpan={9} style={{ ...S.td, padding:14, color:G.dim, textAlign:'center' }}>Niciun document de intrare pe acest proiect.</td></tr>}
            {!incarcDocs && docs.map(d => {
              const s = SABLOANE[d.sablon] || { emoji:'📄', label:d.sablon }, sm = STARE_META[d.stare] || { label:d.stare, color:G.muted }, k = statDocs[d.id]
              const tot = esteCurba(d.sablon)
                ? `${d.total_bucati ?? '—'} buc · ${d.total_pachete ?? '—'} pachete · net ${fmtNr(d.total_net_kg, 0)} kg`
                : `${fmtM(d.total_m)} m · ${fmtNr(d.total_kg, 0)} kg`
              const pvTxt = d.pv_data || d.pv_nr_canon || d.pv_nr ? `${d.pv_nr ?? d.pv_nr_canon ?? ''} · ${fmtData(d.pv_data)}` : '—'
              return (
                <tr key={d.id} style={{ opacity: d.stare === 'anulat' ? .55 : 1, cursor:'pointer' }} onClick={() => deschideDinLista(d.id)}>
                  <td style={{ ...S.td, padding:'8px 10px', fontWeight:700 }}>{s.emoji} {d.nr_document}<div style={{ fontSize:11, color:G.dim, fontWeight:500 }}>{s.label}{d.inlocuieste_document_id ? ` · înlocuiește #${d.inlocuieste_document_id}` : ''}</div></td>
                  <td style={{ ...S.td, padding:'8px 10px' }}>{d.furnizor}</td>
                  <td style={{ ...S.td, padding:'8px 10px' }}>{fmtData(d.data_document)}</td>
                  <td style={{ ...S.td, padding:'8px 10px' }}>{depNume[d.depozit_id] || '—'}</td>
                  <td style={{ ...S.td, padding:'8px 10px', whiteSpace:'nowrap' }}>{k ? <>{k.n}<span style={{ color:G.muted }}> · <span style={{ color:G.green }}>{k.primit}</span>{k.primit_neconform ? <> · <span style={{ color:G.orange }}>{k.primit_neconform} carant.</span></> : null}{k.refuzat_la_receptie ? <> · <span style={{ color:G.red }}>{k.refuzat_la_receptie} ref.</span></> : null}</span></> : '—'}</td>
                  <td style={{ ...S.td, padding:'8px 10px', color:G.muted }}>{tot}</td>
                  <td style={{ ...S.td, padding:'8px 10px', color:sm.color, fontWeight:700 }}>{sm.label}</td>
                  <td style={{ ...S.td, padding:'8px 10px', color: pvTxt === '—' ? G.dim : G.green }}>{pvTxt}</td>
                  <td style={{ ...S.td, padding:'8px 10px' }}><button style={{ ...S.btnS, padding:'5px 10px' }} disabled={busy} onClick={ev => { ev.stopPropagation(); deschideDinLista(d.id) }}>{busy ? '…' : 'Deschide'}</button></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize:11.5, color:G.dim, marginTop:8 }}>
        O ciornă o anulează gestionarul ei, cu motiv (în document: „Anulează ciorna”). Un document confirmat se anulează doar administrativ (Răzvan), cu storno în registru. Un document anulat se poate reintroduce corectat.
      </div>
    </div>
  )

  // ── EDITORUL ──
  if (!SABLOANE[ed.sablon]) return (
    <div style={{ ...S.card, padding:20, color:G.red }}>Șablon necunoscut: „{String(ed.sablon)}”. <button style={{ ...S.btnS, marginLeft:10 }} onClick={() => setEd(null)}>← Lista</button></div>
  )
  const sab = SABLOANE[ed.sablon], curba = esteCurba(ed.sablon), sm = STARE_META[ed.stare] || { label:ed.stare, color:G.muted }
  const cols = COLOANE[ed.sablon]
  const t = val.totaluri
  const optDep = ed.id ? [{ id:ed.depozit_id }] : depoziteScriere
  const avertBd = listaServer(ed.bd?.avertismente)
  const rosuAntet = k => val.document.some(x => x.camp === k && x.nivel === 'blocant')
  const inp = (k, et, tip = 'text', extra = {}) => (
    <div style={{ minWidth:150, flex:1 }} key={k}>
      <label style={S.lbl}>{et}</label>
      <input type={tip} style={{ ...S.input, borderColor: rosuAntet(k) ? G.red : G.border2 }} value={ed.antet[k] ?? ''}
        onChange={e => setAntet(k, e.target.value)} disabled={!edScrie || busy} {...extra} />
    </div>
  )
  const campuriRosii = i => new Set(ed.stare !== 'draft' ? [] : val.randuri[i].filter(x => x.nivel === 'blocant').map(x => CAMP_EDITOR[x.camp] || x.camp))
  const fmtCmp = (c, x) => (x == null ? '—' : c.fmt === 'm' ? fmtM(x) : c.fmt === 'kg' ? fmtNr(x, Number.isInteger(x) ? 0 : 1) : String(x))
  const docInlocuit = ed.inlocuieste_document_id ? docs.find(d => Number(d.id) === Number(ed.inlocuieste_document_id)) : null

  const panouAI = edScrie && !ed.conflict && (
    <div style={{ ...S.card, padding:14, marginBottom:12, overflowWrap:'anywhere' }}>
      <b>Citește documentul cu AI</b>
      <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginTop:10 }}>
        <label style={{ ...S.btnS, minHeight:44, boxSizing:'border-box' }}>📷 Fotografiază avizul
          <input type="file" accept="image/*,application/pdf" capture="environment" disabled={busy || aiBusy} style={{ display:'none' }}
            onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; pregatesteAI(f) }} />
        </label>
        <label style={{ ...S.btnS, minHeight:44, boxSizing:'border-box' }}>Alege PDF / galerie
          <input type="file" accept="image/*,application/pdf" disabled={busy || aiBusy} style={{ display:'none' }}
            onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; pregatesteAI(f) }} />
        </label>
        <button style={{ ...S.btnP, minHeight:44 }} onClick={citesteAI} disabled={!pdfAI || busy || aiBusy || !edRol}>{aiBusy ? 'Se procesează…' : 'Citește cu AI'}</button>
      </div>
      <p style={{ fontSize:12, color:G.muted }}>O fotografie per document; pentru mai multe pagini alege un PDF. Maxim 8 MB. AI propune; tu verifici și salvezi.</p>
      {pdfAI && <div style={{ fontSize:13 }}>{pdfAI.name} · {Math.ceil(pdfAI.size / 1024)} KB</div>}
      {aiMeta && <div style={{ fontSize:12, color:G.muted, marginTop:8 }}>
        {aiMeta.cost_usd != null && <>Cost: {fmtNr(aiMeta.cost_usd, 4)} USD. </>}
        {aiMeta.plafon && <>Plafon rămas: {fmtNr(Number(aiMeta.plafon.plafon_usd) - Number(aiMeta.plafon.consumat_usd) - Number(aiMeta.plafon.rezervat_usd), 4)} USD (după rezervări).</>}
      </div>}
      {propunere && <>
        <PropunereOCR raspuns={propunere.raspuns} ed={ed} mobil={mobil} />
        <label style={S.lbl}>Aplicare în formular</label>
        <select style={{ ...S.input, minHeight:44, boxSizing:'border-box', marginBottom:8 }} value={modAI} disabled={busy || aiBusy} onChange={e => setModAI(e.target.value)}>
          <option value="completeaza">Completează antetul gol și adaugă rândurile</option>
          <option value="inlocuieste">Înlocuiește antetul propus și rândurile</option>
        </select>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
          <button style={{ ...S.btnP, minHeight:44 }} disabled={busy || aiBusy} onClick={() => aplicaAI(modAI)}>Aplică în formular</button>
          <button style={{ ...S.btnS, minHeight:44 }} disabled={busy || aiBusy} onClick={() => setPropunere(null)}>Renunță</button>
        </div>
      </>}
      {!propunere && ed.ocrAvertismente?.map((x, i) => <div key={i} style={{ color:G.yellow, marginTop:8 }}>{x}</div>)}
      {pdfAI && ed.id && !mobil && <button style={{ ...S.btnS, minHeight:44, marginTop:10 }} disabled={busy || aiBusy} onClick={ataseazaCitit}>Atașează scanul citit</button>}
    </div>
  )

  if (mobil && edScrie) return <IzoAvizMobil ed={ed} proiecte={proiecte.filter(p => p.id === ed.proiect_id || depozite.some(d => d.site_id === p.site_id && d.activ === true && scrie(p.id, d.id)))} depozite={optDep} depNume={depNume} mesaj={mesaj}
    panouAI={panouAI} busy={busy || aiBusy} val={val} aiAplicat={aiAplicat} salvat={mobilSalvat}
    inchide={inchide} complet={() => setMobilFortat(false)} setRand={setRand} modifica={modifica} salveaza={salveazaMobil}
    schimbaProiect={id => { resetAI(); setProiectId(id); modifica(x => ({ ...x, proiect_id:id, depozit_id:'' })) }}
    schimbaSablon={nou} />

  return (
    <div>
      <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap', marginBottom:12 }}>
        <button style={S.btnS} onClick={inchide} disabled={busy}>← Lista</button>
        {edScrie && <button style={S.btnS} disabled={busy || aiBusy} onClick={() => setMobilFortat(true)}>Mod telefon</button>}
        <div style={{ fontSize:17, fontWeight:800 }}>{sab.emoji} {sab.label} {ed.antet.nr_document || (ed.id ? '' : '(nou)')}</div>
        <span style={{ fontSize:12, fontWeight:700, color:sm.color, border:`1px solid ${sm.color}66`, borderRadius:6, padding:'2px 8px' }}>{sm.label}</span>
        {ed.versiune != null && <span style={{ fontSize:11.5, color:G.dim }}>versiunea {ed.versiune}</span>}
        {ed.dirty && <span style={{ fontSize:11.5, color:G.yellow }}>● nesalvat</span>}
        <div style={{ flex:1 }} />
        <span style={{ fontSize:12, color:G.muted }}>{proiect?.cod_intern ? `${proiect.cod_intern} · ` : ''}{proiect?.nume}</span>
      </div>
      {mesaj}
      {panouAI}
      {ed.stale && (
        <div style={{ ...S.card, padding:'10px 14px', marginBottom:12, fontSize:12.5, color:G.yellow, borderColor:G.yellow + '66', display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
          <div style={{ flex:1 }}>⚠️ Documentul nu s-a putut reîncărca după ultima operație — ce vezi poate fi vechi. Salvarea și confirmarea sunt oprite până la reîncărcare.</div>
          <button style={S.btnS} onClick={() => deschide(ed.stale)} disabled={busy}>🔄 Reîncarcă</button>
        </div>
      )}
      {ed.conflict && !ed.stale && (
        <div style={{ ...S.card, padding:'10px 14px', marginBottom:12, fontSize:12.5, color:G.yellow, borderColor:G.yellow + '66', display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
          <div style={{ flex:1 }}>⚠️ {ed.conflict === 'incert'
            ? 'Ultima salvare a pierdut răspunsul serverului — nu se știe dacă s-a aplicat.'
            : `Documentul a fost salvat între timp de altcineva (sau din altă fereastră) — versiunea ${ed.versiune} din ecran e veche.`} Salvarea, verificarea, scanurile și anularea sunt oprite până reîncarci versiunea serverului{ed.dirty ? '; modificările tale nesalvate rămân în ecran până atunci (copiază-le dacă ai nevoie de ele)' : ''}.</div>
          <button style={S.btnS} onClick={reincarcaDupaConflict} disabled={busy}>🔄 Reîncarcă versiunea serverului</button>
        </div>
      )}
      {rezultat && (
        <div style={{ ...S.card, padding:'10px 14px', marginBottom:12, borderColor:G.green + '66' }}>
          <div style={{ display:'flex', gap:10, alignItems:'flex-start' }}>
            <div style={{ flex:1, fontSize:13, fontWeight:700, color:G.green }}>✅ {rezultat.titlu}</div>
            <button onClick={() => setRezultat(null)} style={{ background:'none', border:'none', color:G.muted, cursor:'pointer', fontSize:14 }}>✕</button>
          </div>
          {rezultat.avertismente.length > 0 && <div style={{ fontSize:12, color:G.muted, marginTop:6 }}>Avertismentele serverului ({rezultat.avertismente.length}):</div>}
          {rezultat.avertismente.map((x, j) => elemServer(x, j, G.yellow, '⚠️'))}
        </div>
      )}
      {ed.stare !== 'draft' && (
        <div style={{ ...S.card, padding:'10px 14px', marginBottom:12, fontSize:12.5, color:G.muted }}>
          {ed.stare === 'confirmat'
            ? <>✅ Recepție confirmată{ed.bd?.confirmat_la ? ` la ${fmtData(ed.bd.confirmat_la)}` : ''} — documentul nu se mai modifică.{arePv && <> PV {ed.bd.pv_nr ?? ed.bd.pv_nr_canon} din {fmtData(ed.bd.pv_data)}.</>} Anularea unui document confirmat e doar administrativă (Răzvan).</>
            : <>⛔ Document anulat{ed.bd?.anulat_la ? ` la ${fmtData(ed.bd.anulat_la)}` : ''}{ed.bd?.anulat_motiv ? ` — motiv: ${ed.bd.anulat_motiv}` : ''}. Se poate reintroduce corectat (document nou → „Corectează documentul anulat”).</>}
          {avertBd.map((x, j) => elemServer(x, j, G.yellow, '⚠️'))}
        </div>
      )}
      {ed.stare === 'draft' && !edScrie && !ed.stale && <div style={{ ...S.card, padding:'10px 14px', marginBottom:12, fontSize:12.5, color:G.muted }}>👁️ Doar citire — draftul îl editează gestionarul depozitului documentului.</div>}

      {/* antetul */}
      <div style={{ ...S.card, padding:14, marginBottom:12 }}>
        <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginBottom:10 }}>
          {inp('furnizor', 'Furnizor *')}
          {inp('furnizor_cif', 'CIF furnizor')}
          {inp('nr_document', curba ? 'Nr. listă *' : 'Nr. aviz *')}
          {inp('data_document', 'Data documentului *', 'date')}
          <div style={{ minWidth:200, flex:1 }}>
            <label style={S.lbl}>Depozit *</label>
            <select style={{ ...S.input, borderColor: !ed.depozit_id ? G.red : G.border2 }} value={ed.depozit_id || ''} disabled={!!ed.id || !edScrie || busy}
              onChange={e => modifica(x => ({ ...x, depozit_id: e.target.value ? Number(e.target.value) : '' }))}>
              <option value="">— alege —</option>
              {optDep.map(d => <option key={d.id} value={d.id}>{depNume[d.id] || `#${d.id}`}</option>)}
            </select>
          </div>
        </div>
        <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
          {sab.antet.map(([k, et, tip]) => inp(k, et, tip || 'text'))}
          {!ed.id && anulate.length > 0 && (
            <div style={{ minWidth:220, flex:1 }}>
              <label style={S.lbl}>Corectează documentul anulat (opțional)</label>
              <select style={S.input} value={ed.inlocuieste_document_id || ''} onChange={e => modifica(x => ({ ...x, inlocuieste_document_id:e.target.value }))} disabled={!edScrie || busy}>
                <option value="">—</option>
                {anulate.map(d => <option key={d.id} value={d.id}>{(SABLOANE[d.sablon] || {}).emoji || '📄'} {d.nr_document} · {fmtData(d.data_document)} · #{d.id}</option>)}
              </select>
            </div>
          )}
          {!ed.id && ed.inlocuieste_document_id && (
            <div style={{ minWidth:260, flex:2 }}>
              <label style={S.lbl}>Motivul înlocuirii * (ce s-a corectat)</label>
              <input style={{ ...S.input, borderColor: rosuAntet('motiv_inlocuire') ? G.red : G.border2 }} value={ed.motiv_inlocuire ?? ''} maxLength={1000}
                onChange={e => modifica(x => ({ ...x, motiv_inlocuire:e.target.value }))} disabled={!edScrie || busy} placeholder="ex. nr. de aviz greșit la prima introducere" />
            </div>
          )}
        </div>
        {ed.id && ed.inlocuieste_document_id && (
          <div style={{ fontSize:12, color:G.muted, marginTop:8 }}>↩️ Înlocuiește documentul anulat {docInlocuit ? `${docInlocuit.nr_document} · ${fmtData(docInlocuit.data_document)}` : ''} #{ed.inlocuieste_document_id}{ed.motiv_inlocuire ? ` — motiv: ${ed.motiv_inlocuire}` : ''}</div>
        )}
        <div style={{ marginTop:10 }}>
          <label style={S.lbl}>Observații (document)</label>
          <textarea style={{ ...S.input, minHeight:38, resize:'vertical' }} value={ed.antet.observatii ?? ''} maxLength={2000} onChange={e => setAntet('observatii', e.target.value)} disabled={!edScrie || busy} />
        </div>
        {val.document.filter(x => !['furnizor', 'nr_document', 'data_document', 'depozit_id'].includes(x.camp) && !sab.totaluri.some(([c]) => c === x.camp)).map((x, i) => (
          <div key={i} style={{ fontSize:12, color: x.nivel === 'blocant' ? G.red : G.yellow, marginTop:8 }}>{x.nivel === 'blocant' ? '⛔' : '⚠️'} {x.mesaj}</div>
        ))}
      </div>

      {/* totalurile: de pe document (introduse) lângă cele calculate din rânduri */}
      <div style={{ ...S.card, padding:14, marginBottom:12 }}>
        <div style={{ fontSize:12.5, fontWeight:700, color:G.muted, marginBottom:8 }}>Totaluri — documentul față de rânduri (rândurile refuzate intră în sumă; verificare locală, serverul le recalculează)</div>
        <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
          {t.comparatii.map(c => {
            const cul = c.bate === true ? G.green : c.bate === false ? G.red : G.dim
            const [, et] = sab.totaluri.find(([k]) => k === c.cheie) || []
            return (
              <div key={c.cheie} style={{ border:`1px solid ${cul}66`, background:cul + '12', borderRadius:10, padding:'8px 12px', minWidth:170, flex:1 }}>
                <label style={S.lbl}>{et || c.label}{c.optional ? '' : ' *'}</label>
                <input style={{ ...S.input, padding:'6px 8px' }} value={ed.antet[c.cheie] ?? ''} onChange={e => setAntet(c.cheie, e.target.value)} disabled={!edScrie || busy} placeholder="de pe document" />
                <div style={{ fontSize:12.5, marginTop:5, color:cul, fontWeight:700 }}>
                  {c.bate === true ? '✓' : c.bate === false ? '✗' : '·'} rânduri: {fmtCmp(c, c.calculat)}{c.mesaj ? <span style={{ fontWeight:500 }}> — {c.mesaj}</span> : null}
                </div>
              </div>
            )
          })}
        </div>
        <div style={{ fontSize:12.5, color:G.muted, marginTop:10 }}>
          {t.randuri} rânduri: <b style={{ color:G.green }}>{t.primit} primite</b>{t.neconform ? <> · <b style={{ color:G.orange }}>{t.neconform} neconforme → carantină</b></> : null}{t.refuzat ? <> · <b style={{ color:G.red }}>{t.refuzat} refuzate</b></> : null}
          {!curba && <> · în registru, disponibil: <b>{fmtM(t.m_primit_mm / 1000)} m</b> după aviz{t.m_real_mm !== t.m_primit_mm ? <> (<b>{fmtM(t.m_real_mm / 1000)} m</b> cu lungimile măsurate — lungimea bucății = măsurat, altfel aviz)</> : null}</>}
        </div>
      </div>

      {/* rândurile */}
      <div style={{ ...S.card, padding:0, marginBottom:12 }}>
        <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', padding:'10px 12px', borderBottom:`1px solid ${G.border}` }}>
          <div style={{ fontWeight:700, fontSize:13.5 }}>Rânduri</div>
          {ed.stare === 'draft' && <div style={{ fontSize:12, color: val.blocante ? G.red : G.muted }}>{val.blocante ? `⛔ ${val.blocante} blocante în ecran` : '✓ fără blocante în ecran'}{val.avertismente ? <span style={{ color:G.yellow }}> · ⚠️ {val.avertismente} avertismente</span> : null}<span style={{ color:G.dim }}> (verificări locale; decide „Verifică” pe server)</span></div>}
          <div style={{ flex:1 }} />
          {edScrie && <>
            <button style={S.btnS} onClick={() => setLipire({ text:'', inlocuieste:false })} disabled={busy}>📋 Lipește din Excel</button>
            <button style={S.btnS} onClick={adaugaRand} disabled={busy}>+ Rând</button>
          </>}
        </div>
        <div style={{ overflowX:'auto' }}>
          <table style={{ borderCollapse:'collapse', minWidth:'100%' }}>
            <thead><tr>
              {cols.map(([c, et]) => <th key={c} style={S.th}>{et}</th>)}
              <th style={S.th}>Decizie</th><th style={S.th}>Motiv</th><th style={S.th}>Observație</th>{edScrie && <th style={S.th} />}
            </tr></thead>
            <tbody>
              {ed.randuri.map((r, i) => {
                const rosii = campuriRosii(i), v = ed.stare === 'draft' ? val.randuri[i] : []
                return [
                  <tr key={r._k}>
                    {cols.map(([c, , tip]) => (
                      <td key={c} style={S.td}>
                        {tip === 'izolatie'
                          ? <select style={{ ...S.cel, width:LATIME[c], borderColor: rosii.has(c) ? G.red : G.border2 }} value={r[c] ?? ''} onChange={e => setRand(i, c, e.target.value)} disabled={!edScrie || busy}>
                              <option value="">—</option>
                              {IZOLATII.map(z => <option key={z} value={z}>{IZOLATIE_LABEL[z]}</option>)}
                              {r[c] && !IZOLATII.includes(r[c]) && <option value={r[c]}>{r[c]} (necunoscut)</option>}
                            </select>
                          : <input style={{ ...S.cel, width:LATIME[c] || 80, borderColor: rosii.has(c) ? G.red : G.border2, fontFamily: c === 'serie' || c === 'sarja' ? 'monospace' : 'inherit' }}
                              value={r[c] ?? ''} onChange={e => setRand(i, c, e.target.value)} disabled={!edScrie || busy} />}
                      </td>
                    ))}
                    <td style={S.td}>
                      <select style={{ ...S.cel, width:150, color:DECIZIE_CULOARE[r.decizie] || G.text, borderColor: rosii.has('decizie') ? G.red : G.border2 }} value={r.decizie || ''}
                        onChange={e => setRand(i, 'decizie', e.target.value)} disabled={!edScrie || busy}>
                        {!DECIZII.some(d => d.cheie === r.decizie) && <option value="">Alege decizia</option>}
                        {DECIZII.map(d => <option key={d.cheie} value={d.cheie}>{d.label}</option>)}
                      </select>
                    </td>
                    <td style={S.td}><input style={{ ...S.cel, width:150, borderColor: rosii.has('motiv') ? G.red : G.border2 }} value={r.motiv ?? ''} onChange={e => setRand(i, 'motiv', e.target.value)} disabled={!edScrie || busy} placeholder={r.decizie !== 'primit' ? 'obligatoriu' : ''} /></td>
                    <td style={S.td}><input style={{ ...S.cel, width:170, borderColor: rosii.has('observatie') ? G.red : G.border2 }} value={r.observatie ?? ''} onChange={e => setRand(i, 'observatie', e.target.value)} disabled={!edScrie || busy} /></td>
                    {edScrie && <td style={S.td}><button title="Șterge rândul" onClick={() => stergeRand(i)} disabled={busy} style={{ background:'none', border:'none', color:G.red, cursor:'pointer', fontSize:15, padding:'4px 6px' }}>✕</button></td>}
                  </tr>,
                  v.length > 0 && (
                    <tr key={r._k + '_v'}>
                      <td colSpan={cols.length + 4} style={{ padding:'2px 8px 6px 52px', borderBottom:`1px solid ${G.border}` }}>
                        {v.map((x, j) => <div key={j} style={{ fontSize:11.5, color: x.nivel === 'blocant' ? G.red : G.yellow }}>{x.nivel === 'blocant' ? '⛔' : '⚠️'} {x.mesaj}</div>)}
                      </td>
                    </tr>
                  ),
                ]
              })}
              {!ed.randuri.length && <tr><td colSpan={cols.length + 4} style={{ ...S.td, padding:14, color:G.dim, textAlign:'center' }}>Niciun rând. Adaugă rânduri sau lipește-le din Excel.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* scanul documentului */}
      <div style={{ ...S.card, padding:14, marginBottom:12 }}>
        <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
          <div style={{ fontWeight:700, fontSize:13.5 }}>📎 Scanul documentului</div>
          <div style={{ fontSize:11.5, color:G.dim, flex:1 }}>PDF sau poză (poza devine PDF), maxim 10 MB. Hash-ul fișierului e declarat de client până la verificarea pe server.</div>
          {edScrie && (ed.id
            ? <label style={{ ...S.btnS, display:'inline-block', opacity: busy ? .5 : 1 }}>⬆️ Atașează scan<input type="file" accept="application/pdf,image/*" style={{ display:'none' }} disabled={busy}
                onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; adaugaScan(f) }} /></label>
            : <span style={{ fontSize:12, color:G.muted }}>salvează draftul ca să atașezi scanul</span>)}
        </div>
        {ed.scanuri.length > 0 && (
          <div style={{ marginTop:10, display:'flex', flexDirection:'column', gap:6 }}>
            {ed.scanuri.map(s => (
              <div key={s.cale} style={{ display:'flex', gap:10, alignItems:'center', fontSize:12.5 }}>
                <button style={{ ...S.btnS, padding:'4px 10px' }} onClick={() => vedeScan(s)}>📄 Deschide</button>
                <span style={{ fontFamily:'monospace', color:G.muted }}>{s.cale}</span>
                <span style={{ color:G.dim }}>{s.marime ? `${Math.round(s.marime / 1024)} KB` : ''} · sha256 {String(s.sha256_original || '').slice(0, 12)}… (declarat)</span>
                {edScrie && <button style={{ background:'none', border:'none', color:G.red, cursor:'pointer', fontSize:12.5 }} onClick={() => scoateScan(s)} disabled={busy}>scoate</button>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* verificarea serverului */}
      {verif && (
        <div style={{ ...S.card, padding:14, marginBottom:12, borderColor:(verif.ok && verifCurenta ? G.green : G.red) + '66' }}>
          <div style={{ fontWeight:700, fontSize:13.5, color: verif.ok && verifCurenta ? G.green : G.red }}>
            {verif.ok ? '✓ Verificarea serverului: fără blocante' : `⛔ Verificarea serverului: ${verif.blocante.length} blocante`}{verif.avertismente.length ? ` · ${verif.avertismente.length} avertismente` : ''}
          </div>
          {!verifCurenta && <div style={{ fontSize:12, color:G.yellow, marginTop:4 }}>Verificarea e pentru versiunea {verif.versiune ?? '?'}; documentul e acum la {ed.versiune ?? '?'}{ed.dirty ? ' (cu modificări nesalvate)' : ''} — apasă din nou „Verifică”.</div>}
          {verif.blocante.map((x, j) => elemServer(x, 'b' + j, G.red, '⛔'))}
          {verif.avertismente.map((x, j) => elemServer(x, 'a' + j, G.yellow, '⚠️'))}
        </div>
      )}

      {/* acțiunile */}
      <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'center' }}>
        {edScrie && <button style={{ ...S.btnS, opacity: busy ? .6 : 1 }} onClick={() => salveaza()} disabled={busy}>💾 Salvează draft</button>}
        {ed.stare === 'draft' && edScrie && <button style={{ ...S.btnS, color:G.blue, borderColor:G.blue + '66', opacity: busy ? .6 : 1 }} onClick={verifica} disabled={busy}>🔎 Verifică</button>}
        {ed.stare === 'draft' && edRol && (
          <button style={{ ...S.btnP, opacity: poateConfirma ? 1 : .45, cursor: poateConfirma ? 'pointer' : 'not-allowed' }} onClick={confirma} disabled={!poateConfirma} title={motivConfirma}>
            ✅ Confirmă recepția
          </button>
        )}
        {ed.stare === 'confirmat' && edRol && !arePv && (
          <button style={{ ...S.btnP, background:G.blue, color:'#041A33', opacity: poatePv ? 1 : .45 }} onClick={() => setPv({ nr:'', data:aziLocal() })} disabled={!poatePv}>📝 Pune PV</button>
        )}
        {ed.stare === 'draft' && edRol && motivConfirma && <span style={{ fontSize:12, color:G.muted }}>Confirmarea: {motivConfirma}.</span>}
        <div style={{ flex:1 }} />
        {ed.id && ed.stare === 'draft' && edRol && (
          <button style={{ ...S.btnS, color:G.red, borderColor:G.red + '55', opacity: poateAnula ? 1 : .45 }} onClick={() => setAnulare({ motiv:'' })} disabled={!poateAnula}>🗑️ Anulează ciorna</button>
        )}
        {ed.stare === 'confirmat' && <span style={{ fontSize:11.5, color:G.dim }}>Un document confirmat se anulează doar administrativ (Răzvan).</span>}
      </div>

      {/* lipirea din Excel */}
      {lipire && (() => {
        const goala = ed.randuri.length === 1 && !String(ed.randuri[0].serie || '').trim()
        const rez = randuriDinLipire(lipire.text, ed.sablon, { nrStart: lipire.inlocuieste || goala ? 1 : nrMax(ed) + 1 })
        const etCol = Object.fromEntries([...cols.map(([c, et]) => [c, et]), ['decizie', 'Decizie'], ['motiv', 'Motiv'], ['observatie', 'Observație']])
        return (
          <div style={S.modal} onClick={() => setLipire(null)}>
            <div style={{ ...S.card, width:'min(760px,100%)', padding:18 }} onClick={e => e.stopPropagation()}>
              <div style={{ fontSize:16, fontWeight:800, marginBottom:4 }}>📋 Lipește rândurile din Excel</div>
              <div style={{ fontSize:12, color:G.muted, marginBottom:10 }}>
                Copiază rândurile (cu rândul de antet, ideal) și lipește-le aici. Fără antet se folosește ordinea de pe {curba ? 'lista de ambalare' : 'aviz'}. Rândurile goale și cele de „TOTAL” se sar{curba ? '; pachetul și dimensiunile se completează în jos (celulele unite)' : ''}. O decizie scrisă altfel decât primit / neconform / refuzat rămâne de ales.
              </div>
              <textarea autoFocus style={{ ...S.input, minHeight:180, fontFamily:'monospace', fontSize:12 }} value={lipire.text} onChange={e => setLipire(x => ({ ...x, text:e.target.value }))} placeholder="Ctrl+V aici" />
              <div style={{ fontSize:12.5, color: rez.randuri.length ? G.green : G.muted, marginTop:8 }}>
                {rez.randuri.length} rânduri recunoscute{lipire.text ? (rez.antet ? ' (după antet)' : ' (fără antet)') : ''}{rez.ignorate ? ` · ${rez.ignorate} sărite` : ''}
              </div>
              {rez.coloane.length > 0 && lipire.text && <div style={{ fontSize:11.5, color:G.dim, marginTop:4 }}>Coloane: {rez.coloane.map(c => (c ? etCol[c] || c : '—')).join(' · ')}</div>}
              {!goala && <label style={{ display:'flex', gap:6, alignItems:'center', fontSize:12.5, marginTop:10, color:G.muted }}>
                <input type="checkbox" checked={lipire.inlocuieste} onChange={e => setLipire(x => ({ ...x, inlocuieste:e.target.checked }))} /> Înlocuiește rândurile existente ({ed.randuri.length})
              </label>}
              <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:14 }}>
                <button style={S.btnS} onClick={() => setLipire(null)}>Anulează</button>
                <button style={{ ...S.btnP, opacity: rez.randuri.length ? 1 : .5 }} disabled={!rez.randuri.length} onClick={aplicaLipire}>Adaugă {rez.randuri.length} rânduri</button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* PV-ul */}
      {pv && (
        <div style={S.modal} onClick={() => !busy && setPv(null)}>
          <div style={{ ...S.card, width:'min(420px,100%)', padding:18 }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize:16, fontWeight:800, marginBottom:4 }}>📝 PV de recepție</div>
            <div style={{ fontSize:12, color:G.muted, marginBottom:12 }}>Bucățile primite conform ale documentului trec din „sosit” în „recepționat”. Cele din carantină rămân în carantină.</div>
            <label style={S.lbl}>Nr. PV *</label>
            <input autoFocus style={{ ...S.input, marginBottom:10 }} value={pv.nr} maxLength={80} onChange={e => setPv(x => ({ ...x, nr:e.target.value }))} />
            <label style={S.lbl}>Data PV *</label>
            <input type="date" style={S.input} value={pv.data} onChange={e => setPv(x => ({ ...x, data:e.target.value }))} />
            <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:16 }}>
              <button style={S.btnS} onClick={() => setPv(null)} disabled={busy}>Renunță</button>
              <button style={{ ...S.btnP, background:G.blue, color:'#041A33', opacity: busy ? .6 : 1 }} onClick={punePv} disabled={busy}>{busy ? '…' : 'Pune PV'}</button>
            </div>
          </div>
        </div>
      )}

      {/* anularea ciornei */}
      {anulare && (
        <div style={S.modal} onClick={() => !busy && setAnulare(null)}>
          <div style={{ ...S.card, width:'min(460px,100%)', padding:18 }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize:16, fontWeight:800, marginBottom:4, color:G.red }}>🗑️ Anulează ciorna</div>
            <div style={{ fontSize:12, color:G.muted, marginBottom:12 }}>
              Ciorna {ed.antet.nr_document || `#${ed.id}`} devine „Anulat” (registrul nu e atins). Furnizorul + numărul + data se eliberează: documentul se poate reintroduce corectat.{ed.dirty ? ' Modificările nesalvate din ecran se pierd.' : ''}
            </div>
            <label style={S.lbl}>Motivul anulării * (minim 3 caractere)</label>
            <textarea autoFocus style={{ ...S.input, minHeight:70 }} value={anulare.motiv} maxLength={1000} onChange={e => setAnulare(x => ({ ...x, motiv:e.target.value }))} />
            <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:16 }}>
              <button style={S.btnS} onClick={() => setAnulare(null)} disabled={busy}>Renunță</button>
              <button style={{ ...S.btnP, background:G.red, color:'#2A0705', opacity: busy || eroareMotiv(anulare.motiv) ? .5 : 1 }} onClick={anuleazaCiorna} disabled={busy || !!eroareMotiv(anulare.motiv)}>{busy ? '…' : 'Anulează ciorna'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Propunerea este doar o previzualizare; calculele nu înlocuiesc totalurile tipărite.
function PropunereOCR({ raspuns, ed, mobil }) {
  const doc = aplicaPropunereOCR({ ...ed, antet:{}, randuri:[] }, raspuns, { mod:'inlocuieste' })
  const comparatii = validareDocument(doc).totaluri.comparatii
  const coloane = COLOANE[ed.sablon].filter(([k]) => !['lungime_masurata', 'unghi_masurat'].includes(k))
  const etichete = Object.fromEntries([['furnizor', 'Furnizor'], ['furnizor_cif', 'CIF'], ['nr_document', 'Nr. document'],
    ['data_document', 'Data'], ['observatii', 'Observații'], ...SABLOANE[ed.sablon].antet, ...SABLOANE[ed.sablon].totaluri])
  return <div style={{ margin:'12px 0', fontSize:13, overflowWrap:'anywhere' }}>
    <b>Propunere AI — verifică după original</b>
    {Object.entries(doc.antet).map(([k, v]) => <div key={k}>{etichete[k] || k}: <b>{v || '—'}</b></div>)}
    <div>Totaluri tipărite OCR: {raspuns.totaluri_tiparite?.total_metri ?? '—'} m · {raspuns.totaluri_tiparite?.total_kg ?? '—'} kg</div>
    {comparatii.map(c => <div key={c.cheie} style={{ color:c.bate === false ? G.red : G.muted, marginTop:4 }}>
      {c.label || c.cheie}: tipărit {doc.antet[c.cheie] ?? '—'} · suma rândurilor aplicabile {c.calculat ?? '—'}
      {c.bate === false ? ' — diferență, verifică documentul' : ''}
    </div>)}
    {avertismenteOCR(raspuns).map((x, i) => <div key={i} style={{ color:G.yellow, marginTop:8 }}>⚠ {x}</div>)}
    {/* pe ecran îngust tabelul derulat tăia începutul coloanelor (seria / șarja) → carduri (test Razvan 22.10) */}
    {(mobil || (typeof window !== 'undefined' && window.innerWidth < 900)) ? raspuns.randuri.map((r, i) => <div key={i} style={{ ...S.card, padding:12, marginTop:10, borderColor:cantitateMultiplaOCR(r) ? G.yellow : G.border2 }}>
      <b>Rândul {i + 1}{cantitateMultiplaOCR(r) ? ' — nu se aplică' : ''}</b>
      {coloane.filter(([k]) => r[k] != null && r[k] !== '').map(([k, et]) => <div key={k}>{et}: {String(r[k])}</div>)}
      {cantitateMultiplaOCR(r) && <div style={{ color:G.yellow }}>Rând cu cantitate {String(r.cantitate)} fără serii individuale — introdu manual bucățile.</div>}
    </div>) : <div style={{ overflowX:'auto', marginTop:10 }}><table style={{ borderCollapse:'collapse', width:'100%' }}>
      <thead><tr>{coloane.map(([k, et]) => <th style={S.th} key={k}>{et}</th>)}<th style={S.th}>Cantitate / avertisment</th></tr></thead>
      <tbody>{raspuns.randuri.map((r, i) => <tr key={i} style={{ background:cantitateMultiplaOCR(r) ? G.yellow + '22' : undefined }}>
        {coloane.map(([k]) => <td style={{ ...S.td, whiteSpace:k === 'cod' || k === 'serie' || k === 'sarja' ? 'nowrap' : undefined }} key={k}>{r[k] == null ? '—' : String(r[k])}</td>)}
        <td style={{ ...S.td, color:G.yellow }}>{cantitateMultiplaOCR(r) ? `Rând cu cantitate ${String(r.cantitate)} fără serii individuale — introdu manual bucățile.` : String(r.cantitate ?? '1')}</td>
      </tr>)}</tbody>
    </table></div>}
  </div>
}

// Fereastra telefonului folosește același editor în memorie, fără o a doua cale de salvare.
function IzoAvizMobil({ ed, proiecte, depozite, depNume, mesaj, panouAI, busy, val, aiAplicat, salvat,
  inchide, complet, setRand, modifica, salveaza, schimbaProiect, schimbaSablon }) {
  const buton = { ...S.btnS, minHeight:44 }, input = { ...S.input, minHeight:44, boxSizing:'border-box' }
  const probleme = i => val.randuri[i].filter(v => v.camp !== 'decizie')
  const poateBulk = i => !ed.ocrAvertismente?.length && !probleme(i).length
  const coloane = COLOANE[ed.sablon].filter(([k]) => !['lungime_masurata', 'unghi_masurat'].includes(k))
  return <div style={{ width:'100%', maxWidth:720, margin:'0 auto', overflowWrap:'anywhere', boxSizing:'border-box' }}>
    <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginBottom:12 }}>
      <button style={buton} disabled={busy} onClick={inchide}>← Lista</button>
      <button style={buton} disabled={busy} onClick={complet}>Ecran complet</button>
    </div>
    {mesaj}
    {salvat ? <div style={{ ...S.card, padding:16 }}>
      <b>Ciornă salvată — nr. aviz {salvat.nr}, {salvat.n} rânduri. Verificarea și confirmarea le faci în ecranul complet.</b>
      <p style={{ color:salvat.atasat ? G.green : G.yellow }}>{salvat.atasat ? 'Scanul citit a fost atașat.' : 'Scanul nu este atașat sigur. Verifică mesajul și atașează scanul în ecranul complet.'}</p>
      <button style={buton} disabled={busy} onClick={inchide}>Înapoi la listă</button>
    </div> : <>
      <div style={{ ...S.card, padding:14, marginBottom:12 }}>
        <b>1. Proiect / depozit / șablon</b>
        <label style={S.lbl}>Proiect</label>
        <select style={input} value={ed.proiect_id} disabled={!!ed.id || busy} onChange={e => schimbaProiect(Number(e.target.value))}>
          {proiecte.map(p => <option key={p.id} value={p.id}>{p.cod_intern ? `${p.cod_intern} · ` : ''}{p.nume}</option>)}
        </select>
        <label style={S.lbl}>Depozit</label>
        <select style={input} value={ed.depozit_id || ''} disabled={!!ed.id || busy} onChange={e => modifica(x => ({ ...x, depozit_id:Number(e.target.value) || '' }))}>
          <option value="">— alege —</option>{depozite.map(d => <option key={d.id} value={d.id}>{depNume[d.id]}</option>)}
        </select>
        <label style={S.lbl}>Șablon</label>
        <select style={input} value={ed.sablon} disabled={!!ed.id || busy} onChange={e => schimbaSablon(e.target.value)}>
          {Object.entries(SABLOANE).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
        </select>
      </div>
      <div style={{ color:G.muted, marginBottom:8 }}>2–4. Fotografie / PDF → citește → verifică propunerea → aplică</div>
      {panouAI}
      {aiAplicat && <>
        <div style={{ ...S.card, padding:14, marginBottom:12 }}>
          <b>5. Verifică antetul și fiecare bucată</b>
          {[['furnizor', 'Furnizor'], ['furnizor_cif', 'CIF furnizor'], ['nr_document', 'Nr. document'], ['data_document', 'Data documentului', 'date'],
            ...SABLOANE[ed.sablon].antet, ...SABLOANE[ed.sablon].totaluri.map(([k, et]) => [k, et])].map(([k, et, tip]) => <label style={S.lbl} key={k}>
              {et}<input style={input} type={tip === 'date' ? 'date' : 'text'} disabled={busy} value={ed.antet[k] ?? ''}
                onChange={e => modifica(x => ({ ...x, antet:{ ...x.antet, [k]:e.target.value } }))} />
            </label>)}
          <button style={buton} disabled={busy} onClick={() => modifica(x => ({ ...x, randuri:x.randuri.map((r, i) => poateBulk(i) && !r.decizie ? { ...r, decizie:'primit' } : r) }))}>Toate primite (doar fără avertismente)</button>
        </div>
        {ed.randuri.map((r, i) => <div key={r._k} style={{ ...S.card, padding:14, marginBottom:12 }}>
          <b>Bucata {r.nr_crt} · {r.serie || 'serie lipsă'}</b>
          {coloane.map(([k, et]) => <div key={k}>{et}: <b>{r[k] || '—'}</b></div>)}
          {probleme(i).map((v, j) => <div key={j} style={{ color:v.nivel === 'blocant' ? G.red : G.yellow }}>{v.mesaj}</div>)}
          <div style={{ display:'flex', flexWrap:'wrap', gap:8, margin:'10px 0' }}>
            {DECIZII.map(d => <button key={d.cheie} disabled={busy} style={{ ...buton, flex:'1 1 120px', borderColor:r.decizie === d.cheie ? G.green : G.border2,
              background:r.decizie === d.cheie ? G.green + '22' : G.bg }} onClick={() => setRand(i, 'decizie', d.cheie)}>{d.label}</button>)}
          </div>
          {!r.decizie && <div style={{ color:G.yellow }}>Alege decizia</div>}
          <label style={S.lbl}>{esteCurba(ed.sablon) ? 'Unghi măsurat (°), opțional' : 'Lungime măsurată (m), opțional'}
            <input style={input} disabled={busy} inputMode="decimal" value={r[esteCurba(ed.sablon) ? 'unghi_masurat' : 'lungime_masurata']}
              onChange={e => setRand(i, esteCurba(ed.sablon) ? 'unghi_masurat' : 'lungime_masurata', e.target.value)} />
          </label>
          {r.decizie && r.decizie !== 'primit' && <label style={S.lbl}>Motiv (obligatoriu)<input style={input} disabled={busy} value={r.motiv} onChange={e => setRand(i, 'motiv', e.target.value)} /></label>}
          <label style={S.lbl}>Observație<input style={input} disabled={busy} value={r.observatie} onChange={e => setRand(i, 'observatie', e.target.value)} /></label>
        </div>)}
        <button style={{ ...S.btnP, minHeight:48, width:'100%' }} disabled={busy || !ed.randuri.length} onClick={salveaza}>6. Salvează ciorna</button>
        <p style={{ fontSize:12, color:G.muted }}>Scanul se atașează după salvare. Verificarea și confirmarea se fac în ecranul complet.</p>
      </>}
    </>}
  </div>
}
