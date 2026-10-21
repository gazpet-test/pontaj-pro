// ════════════════════════════════════════════════════════════════════════
// IZOMETRIE E3 — Magazie → 🧾 Documente de intrare (aviz țeavă / listă de ambalare curbe): recepția și PV-ul
// ════════════════════════════════════════════════════════════════════════
// Gestionarul (atribuit pe proiect + depozit) introduce documentul, marchează fiecare rând primit / neconform / refuzat,
// apasă „Verifică”, apoi „Confirmă recepția” → bucățile intră în registru (sosit / carantina) și apar în 🧱 Țeavă proiecte;
// la final pune PV-ul (sosit → receptionat). Design: docs/izometrie/E3_CONFIRMA_DESIGN.md r4 + E3_PLAN.md §4.
// SCRIERI DOAR PRIN RPC-urile E3: fn_izo_doc_salveaza / _verifica / _confirma / _pv (+ fișierul scanului în bucket-ul `avize`).
// Niciun INSERT / UPDATE direct pe tabelele izo_*. Anularea e administrativă (postgres) — fără buton aici.
// Fără migrarea 20261103b ecranul spune doar „Modulul de recepție e în pregătire” (fără erori, fără scrieri).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './lib/supabase.js'
import { imageToPdf } from './CitesteOricePanel.jsx'
import {
  SABLOANE, DECIZII, COLOANE, esteCurba, parseNumar, fmtNr, randGol, validareDocument, eroriSalvare, randuriDinLipire,
  randDinBd, antetDinBd, argumenteSalveaza, argumenteConfirma, argumentePv, normalizeazaVerificare, lipsaReceptie, mesajEroareDoc,
  poateScrie, sha256Hex,
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
}
const BUCKET = 'avize'
const STARE_META = { draft:{ label:'Draft', color:G.yellow }, confirmat:{ label:'Confirmat', color:G.green }, anulat:{ label:'Anulat', color:G.dim } }
const DECIZIE_CULOARE = { primit:G.green, primit_neconform:G.orange, refuzat_la_receptie:G.red }
const LATIME = { nr_crt:44, serie:118, sarja:92, lot:58, lungime_doc:74, lungime_masurata:74, greutate_kg:66, perete_mm:56, diametru_mm:56, specificatie:150,
  cod:190, item:44, unghi_doc:62, unghi_masurat:66, standard:92, cantitate:42, pachet_nr:54, dimensiuni_cm:100, net_kg:64, brut_kg:64 }
// câmpul din validare (valori tipizate) → câmpul editorului
const CAMP_EDITOR = { lungime_doc_mm:'lungime_doc', lungime_masurata_mm:'lungime_masurata' }
const aziLocal = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) }
const fmtData = d => { if (!d) return '—'; const x = new Date(d); return isNaN(x) ? '—' : x.toLocaleDateString('ro-RO') }
const uid8 = () => Math.random().toString(36).slice(2, 10)
const unu = data => (Array.isArray(data) ? data[0] : data)

// ── scanul documentului (design r4 §6 / §6.1) ───────────────────────────────────────────────────────────────
// TODO(E3 §6.1): calea obiectului e „dată de server” (<document_id>/<uuid>.pdf), dar designul r4 nu numește apelul care o
// întoarce. Până atunci UI-ul o compune în exact acea formă, iar politica INSERT a bucket-ului `avize` verifică pe server că
// documentul din cale e `draft` și că apelantul e autorizat pe el. Când apare RPC-ul care dă calea, se schimbă DOAR aici.
async function incarcaScanDocument(docId, fisier) {
  const tip = fisier.type || ''
  const ePoza = tip.startsWith('image/'), ePdf = tip === 'application/pdf' || /\.pdf$/i.test(fisier.name || '')
  if (!ePoza && !ePdf) throw new Error('se acceptă doar PDF sau poză')
  const pdf = ePoza ? await imageToPdf(fisier) : fisier          // „TOTUL PDF”: poza devine PDF în browser
  const sha256_original = await sha256Hex(fisier)
  const sha256_pdf = ePoza ? await sha256Hex(pdf) : sha256_original
  const cale = `${docId}/${crypto.randomUUID()}.pdf`
  const { error } = await supabase.storage.from(BUCKET).upload(cale, pdf, { contentType:'application/pdf', upsert:false })
  if (error) throw new Error(/bucket not found/i.test(error.message || '') ? 'stocarea scanurilor (bucket „avize”) nu e încă instalată' : (error.message || String(error)))
  return { cale, sha256_original, sha256_pdf, marime: pdf.size, mime:'application/pdf', nume: fisier.name }
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
  const [ed, setEd] = useState(null)          // documentul deschis în editor (câmpurile = text)
  const [verif, setVerif] = useState(null)    // ultimul răspuns fn_izo_doc_verifica (normalizat)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [lipire, setLipire] = useState(null)  // { text, inlocuieste }
  const [pv, setPv] = useState(null)          // { nr, data }
  const ultima = useRef(0)

  const flash = useCallback((tip, text) => { setMsg({ tip, text }); if (tip === 'ok') setTimeout(() => setMsg(m => (m?.text === text ? null : m)), 7000) }, [])
  const inPregatire = useCallback(() => setSt({ incarc:false, eroare:null, neinstalat:true }), [])

  // ── încărcarea: proiectele cu registru activ, depozitele, drepturile mele ──
  const incarca = useCallback(async () => {
    setSt({ incarc:true, eroare:null, neinstalat:false })
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('nu ești autentificat')
      const [rSonda, rProt, rProj, rDep, rProf, rMod, rAtr] = await Promise.all([
        supabase.from('izo_documente_intrare').select('id').limit(1),     // sonda: tabelele E3 există?
        supabase.rpc('fn_izo_proiecte_protejate'),
        supabase.from('executie_proiecte').select('id, nume, cod_intern, site_id').order('id'),
        supabase.from('logistica_depozite').select('id, name, cod_3litere, site_id').order('id'),
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
      setSt({ incarc:false, eroare: e.message || String(e), neinstalat:false })
    }
  }, [inPregatire])
  useEffect(() => { incarca() }, [incarca])

  // ── lista documentelor proiectului (doar ultima cerere se aplică) ──
  const incarcaDocs = useCallback(async (pid) => {
    const c = ++ultima.current
    if (!pid) { setDocs([]); setStatDocs({}); return }
    setIncarcDocs(true)
    try {
      const { data, error } = await supabase.from('izo_documente_intrare').select('*').eq('proiect_id', pid)
        .order('data_document', { ascending:false }).order('id', { ascending:false })
      if (c !== ultima.current) return
      if (error) { if (lipsaReceptie(error)) { inPregatire(); return } throw error }
      const ids = (data || []).map(d => d.id), stat = {}
      if (ids.length) {
        const { data: rr, error: e2 } = await supabase.from('izo_documente_intrare_randuri').select('document_id, decizie').in('document_id', ids)
        if (c !== ultima.current) return
        if (e2) { if (lipsaReceptie(e2)) { inPregatire(); return } throw e2 }
        for (const r of rr || []) {
          const s = stat[r.document_id] || (stat[r.document_id] = { n:0, primit:0, primit_neconform:0, refuzat_la_receptie:0 })
          s.n++; s[r.decizie] = (s[r.decizie] || 0) + 1
        }
      }
      setDocs(data || []); setStatDocs(stat)
    } catch (e) {
      console.error(e)
      if (c === ultima.current) flash('err', 'Eroare la încărcarea documentelor: ' + (e.message || e))
    } finally { if (c === ultima.current) setIncarcDocs(false) }
  }, [flash, inPregatire])
  useEffect(() => { if (!st.incarc && !st.neinstalat) incarcaDocs(proiectId) }, [proiectId, st.incarc, st.neinstalat, incarcaDocs])

  // ── editorul ──
  const deschide = useCallback(async (id) => {
    setBusy(true)
    try {
      const [rd, rr, rs] = await Promise.all([
        supabase.from('izo_documente_intrare').select('*').eq('id', id).maybeSingle(),
        supabase.from('izo_documente_intrare_randuri').select('*').eq('document_id', id).order('nr_crt'),
        supabase.from('izo_documente_scanuri').select('*').eq('document_id', id).order('cale'),
      ])
      for (const r of [rd, rr, rs]) if (r.error) { if (lipsaReceptie(r.error)) { inPregatire(); return null } throw r.error }
      if (!rd.data) throw new Error('documentul nu e vizibil (drepturi)')
      const d = rd.data
      setEd({ id:d.id, versiune:d.versiune, stare:d.stare, sablon:d.sablon, proiect_id:d.proiect_id, depozit_id:d.depozit_id, bd:d,
        antet: antetDinBd(d), randuri: (rr.data || []).map(r => ({ _k:uid8(), ...randDinBd(r) })), scanuri: rs.data || [], dirty:false })
      setVerif(null)
      return d.id
    } catch (e) {
      console.error(e); flash('err', 'Documentul nu s-a putut deschide: ' + (e.message || e)); return null
    } finally { setBusy(false) }
  }, [flash, inPregatire])

  const proiect = proiecte.find(p => p.id === proiectId)
  const depoziteProiect = useMemo(() => depozite.filter(d => proiect && d.site_id === proiect.site_id), [depozite, proiect])
  const depNume = useMemo(() => Object.fromEntries(depozite.map(d => [d.id, d.cod_3litere ? `${d.cod_3litere} — ${d.name}` : d.name])), [depozite])
  const scrie = useCallback((pid, did) => poateScrie({ owner:eu.owner, nivelMagazie:eu.nivelMagazie, atribuiri:eu.atribuiri, proiectId:pid, depozitId:did, azi:aziLocal() }), [eu])
  const depoziteScriere = useMemo(() => depoziteProiect.filter(d => scrie(proiectId, d.id)), [depoziteProiect, scrie, proiectId])
  const gestionarFaraModul = !eu.owner && !['editor', 'admin'].includes(eu.nivelMagazie) && eu.atribuiri.some(a => a.rol === 'gestionar' && a.proiect_id === proiectId)
  const val = useMemo(() => (ed ? validareDocument(ed) : null), [ed])
  const anulate = useMemo(() => docs.filter(d => d.stare === 'anulat'), [docs])

  const nou = sablon => {
    const s = SABLOANE[sablon], antet = { furnizor:'', furnizor_cif:'', nr_document:'', data_document:aziLocal() }
    for (const [c] of [...s.antet, ...s.totaluri]) antet[c] = ''
    setEd({ id:null, versiune:null, stare:'draft', sablon, proiect_id:proiectId, depozit_id: depoziteScriere.length === 1 ? depoziteScriere[0].id : '',
      antet, randuri:[{ _k:uid8(), ...randGol(sablon, 1) }], scanuri:[], dirty:true, inlocuieste_document_id:'' })
    setVerif(null)
  }
  const modifica = fn => { setEd(e => ({ ...fn(e), dirty:true })); setVerif(null) }
  const setAntet = (k, v) => modifica(e => ({ ...e, antet:{ ...e.antet, [k]:v } }))
  const setRand = (i, k, v) => modifica(e => { const r = e.randuri.slice(); r[i] = { ...r[i], [k]:v }; return { ...e, randuri:r } })
  const nrMax = e => Math.max(0, ...e.randuri.map(r => parseNumar(r.nr_crt) || 0))
  const adaugaRand = () => modifica(e => ({ ...e, randuri:[...e.randuri, { _k:uid8(), ...randGol(e.sablon, nrMax(e) + 1, e.randuri[e.randuri.length - 1]) }] }))
  const stergeRand = i => modifica(e => ({ ...e, randuri:e.randuri.filter((_, j) => j !== i) }))
  const inchide = () => { if (ed?.dirty && !window.confirm('Ai modificări nesalvate. Închizi fără să salvezi?')) return; setEd(null); setVerif(null); setLipire(null); setPv(null) }

  // ── acțiunile (toate prin RPC) ──
  const salveaza = async (doc = ed) => {
    const err = eroriSalvare(doc)
    if (err.length) { flash('err', err.join(' ')); return null }
    setBusy(true)
    try {
      const { data, error } = await supabase.rpc('fn_izo_doc_salveaza', argumenteSalveaza(doc))
      if (error) { if (lipsaReceptie(error)) { inPregatire(); return null } throw new Error(mesajEroareDoc(error)) }
      const r = unu(data)
      const id = r?.document_id ?? r?.id ?? doc.id
      if (!id) throw new Error('salvarea n-a întors id-ul documentului')
      const ok = await deschide(id)
      incarcaDocs(proiectId)
      if (ok) flash('ok', `Draft salvat${r?.versiune != null ? ` (versiunea ${r.versiune})` : ''}.`)
      return ok
    } catch (e) { console.error(e); flash('err', 'Salvare eșuată: ' + (e.message || e)); return null } finally { setBusy(false) }
  }

  const verifica = async () => {
    let id = ed.id
    if (!id || ed.dirty) { id = await salveaza(); if (!id) return }
    setBusy(true)
    try {
      const { data, error } = await supabase.rpc('fn_izo_doc_verifica', { p_doc_id:id })
      if (error) { if (lipsaReceptie(error)) { inPregatire(); return } throw new Error(mesajEroareDoc(error)) }
      const v = normalizeazaVerificare(data)
      setVerif({ ...v, docId:id })
      flash(v.ok ? 'ok' : 'err', v.ok ? `Verificat: fără blocante${v.lista.length ? ` (${v.lista.length} avertismente)` : ''}. Poți confirma recepția.` : 'Verificarea serverului are blocante — vezi lista de sub tabel.')
    } catch (e) { console.error(e); flash('err', 'Verificare eșuată: ' + (e.message || e)) } finally { setBusy(false) }
  }

  const edRol = !!ed && scrie(ed.proiect_id, ed.depozit_id)
  const edScrie = !!ed && ed.stare === 'draft' && (ed.id ? edRol : depoziteScriere.length > 0)
  const verifCurenta = !!verif && !!ed && verif.docId === ed.id && verif.versiune === ed.versiune
  const motivConfirma = !ed ? '' : !ed.id ? 'salvează draftul și apasă „Verifică”' : ed.stare !== 'draft' ? 'documentul nu e draft'
    : !edRol ? 'doar gestionarul depozitului documentului sau owner-ul confirmă' : ed.dirty ? 'ai modificări nesalvate — apasă „Verifică”'
    : val?.blocante ? `${val.blocante} probleme blocante în ecran (roșu)` : !verif ? 'apasă întâi „Verifică”'
    : !verifCurenta ? 'documentul s-a schimbat după verificare — apasă din nou „Verifică”' : !verif.ok ? 'verificarea serverului are blocante' : ''
  const poateConfirma = !!ed && !motivConfirma && !busy
  const arePv = !!(ed?.bd && (ed.bd.pv_data || ed.bd.pv_nr_canon || ed.bd.pv_nr || ed.bd.eveniment_pv_id))
  const poatePv = !!ed && ed.stare === 'confirmat' && !arePv && edRol && !busy

  const confirma = async () => {
    if (!poateConfirma) return
    const t = val.totaluri, curba = esteCurba(ed.sablon)
    const linii = [`Confirmi recepția documentului ${ed.antet.nr_document} (${ed.antet.furnizor})?`, '',
      `Intră în registru, disponibile în depozit: ${t.primit} ${curba ? 'curbe' : `țevi · ${fmtNr(t.m_real_mm / 1000)} m`}`,
      t.neconform ? `În carantină (nedisponibile): ${t.neconform}` : null, t.refuzat ? `Refuzate (nu intră în registru): ${t.refuzat}` : null, '',
      'După confirmare documentul nu se mai poate modifica. Anularea o face doar administratorul.'].filter(x => x !== null)
    if (!window.confirm(linii.join('\n'))) return
    setBusy(true)
    try {
      const { data, error } = await supabase.rpc('fn_izo_doc_confirma', argumenteConfirma(ed.id, verif))
      if (error) {
        if (lipsaReceptie(error)) { inPregatire(); return }
        if (/40001|s-a schimbat/i.test(`${error.code} ${error.message}`)) setVerif(null)
        throw new Error(mesajEroareDoc(error))
      }
      const r = unu(data)
      await deschide(ed.id); incarcaDocs(proiectId)
      flash('ok', `Recepție confirmată: ${r?.bucati?.length ?? '?'} bucăți în registru${r?.idempotent ? ' (era deja confirmată)' : ''}. Le vezi în 🧱 Țeavă proiecte.`)
    } catch (e) { console.error(e); flash('err', 'Confirmare eșuată: ' + (e.message || e)) } finally { setBusy(false) }
  }

  const punePv = async () => {
    if (!pv?.nr?.trim() || !pv?.data) { flash('err', 'Completează numărul și data PV-ului.'); return }
    setBusy(true)
    try {
      const { data, error } = await supabase.rpc('fn_izo_doc_pv', argumentePv(ed, pv.nr, pv.data))
      if (error) { if (lipsaReceptie(error)) { inPregatire(); return } throw new Error(mesajEroareDoc(error)) }
      const r = unu(data), nrPv = pv.nr.trim()
      setPv(null); await deschide(ed.id); incarcaDocs(proiectId)
      flash('ok', `PV ${nrPv} pus: ${r?.bucati_receptionate ?? r?.bucati?.length ?? '?'} bucăți trecute în „recepționat”${r?.idempotent ? ' (era deja pus)' : ''}.`)
    } catch (e) { console.error(e); flash('err', 'PV eșuat: ' + (e.message || e)) } finally { setBusy(false) }
  }

  // scanul: fișierul în `avize`, apoi manifestul prin salvare (versiune + 1); la eșecul salvării fișierul orfan se șterge
  const adaugaScan = async fisier => {
    if (!fisier) return
    if (!ed.id) { flash('err', 'Salvează întâi draftul — scanul se atașează unui document salvat.'); return }
    const err = eroriSalvare(ed); if (err.length) { flash('err', err.join(' ')); return }
    setBusy(true)
    let orfan = null
    try {
      const s = await incarcaScanDocument(ed.id, fisier)
      orfan = s.cale
      const { error } = await supabase.rpc('fn_izo_doc_salveaza', argumenteSalveaza({ ...ed, scanuri:[...ed.scanuri, s] }))
      if (error) { if (lipsaReceptie(error)) { inPregatire(); return } throw new Error(mesajEroareDoc(error)) }
      orfan = null
      await deschide(ed.id); incarcaDocs(proiectId)
      flash('ok', 'Scan atașat (hash-ul e declarat de client până la verificarea pe server).')
    } catch (e) { console.error(e); flash('err', 'Scanul nu s-a atașat: ' + (e.message || e)) }
    finally {
      if (orfan) await supabase.storage.from(BUCKET).remove([orfan]).catch(() => {})
      setBusy(false)
    }
  }
  const scoateScan = async s => {
    if (!window.confirm('Scoți scanul din document? Fișierul se șterge după ce documentul e salvat fără el.')) return
    const err = eroriSalvare(ed); if (err.length) { flash('err', err.join(' ')); return }
    setBusy(true)
    try {
      const { error } = await supabase.rpc('fn_izo_doc_salveaza', argumenteSalveaza({ ...ed, scanuri:ed.scanuri.filter(x => x.cale !== s.cale) }))
      if (error) { if (lipsaReceptie(error)) { inPregatire(); return } throw new Error(mesajEroareDoc(error)) }
      const { error: eDel } = await supabase.storage.from(BUCKET).remove([s.cale])
      await deschide(ed.id); incarcaDocs(proiectId)
      flash('ok', eDel ? 'Scos din document; fișierul n-a putut fi șters (rămâne orfan).' : 'Scan scos din document și șters.')
    } catch (e) { console.error(e); flash('err', 'Eroare: ' + (e.message || e)) } finally { setBusy(false) }
  }
  const vedeScan = async s => {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(s.cale, 600)
    if (error || !data?.signedUrl) { flash('err', 'Scanul nu se poate deschide: ' + (error?.message || 'fără link')); return }
    window.open(data.signedUrl, '_blank', 'noopener')
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
      <div style={{ flex:1 }}>{msg.text}</div><button onClick={() => setMsg(null)} style={{ background:'none', border:'none', color:'inherit', cursor:'pointer', fontSize:14 }}>✕</button>
    </div>
  )

  // ── LISTA ──
  if (!ed) return (
    <div>
      <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'center', marginBottom:12 }}>
        <select style={{ ...S.input, maxWidth:360 }} value={proiectId || ''} onChange={e => setProiectId(Number(e.target.value))}>
          {proiecte.map(p => <option key={p.id} value={p.id}>{p.cod_intern ? `${p.cod_intern} · ` : ''}{p.nume}</option>)}
        </select>
        <div style={{ flex:1, fontSize:12, color:G.muted, minWidth:220 }}>
          Avizele de țeavă și listele de ambalare ale curbelor. După „Confirmă recepția” bucățile intră în registru și apar în 🧱 Țeavă proiecte.
        </div>
        {depoziteScriere.length > 0 && Object.entries(SABLOANE).map(([k, s]) => (
          <button key={k} style={{ ...S.btnS, color:G.green, borderColor:G.green + '66' }} onClick={() => nou(k)}>+ {s.emoji} {s.label}</button>
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
                : `${fmtNr(d.total_m)} m · ${fmtNr(d.total_kg, 0)} kg`
              const pvTxt = d.pv_data || d.pv_nr_canon || d.pv_nr ? `${d.pv_nr ?? d.pv_nr_canon ?? ''} · ${fmtData(d.pv_data)}` : '—'
              return (
                <tr key={d.id} style={{ opacity: d.stare === 'anulat' ? .55 : 1, cursor:'pointer' }} onClick={() => deschide(d.id)}>
                  <td style={{ ...S.td, padding:'8px 10px', fontWeight:700 }}>{s.emoji} {d.nr_document ?? d.nr_document_canon}<div style={{ fontSize:11, color:G.dim, fontWeight:500 }}>{s.label}</div></td>
                  <td style={{ ...S.td, padding:'8px 10px' }}>{d.furnizor ?? d.furnizor_canon}</td>
                  <td style={{ ...S.td, padding:'8px 10px' }}>{fmtData(d.data_document)}</td>
                  <td style={{ ...S.td, padding:'8px 10px' }}>{depNume[d.depozit_id] || '—'}</td>
                  <td style={{ ...S.td, padding:'8px 10px', whiteSpace:'nowrap' }}>{k ? <>{k.n}<span style={{ color:G.muted }}> · <span style={{ color:G.green }}>{k.primit}</span>{k.primit_neconform ? <> · <span style={{ color:G.orange }}>{k.primit_neconform} carant.</span></> : null}{k.refuzat_la_receptie ? <> · <span style={{ color:G.red }}>{k.refuzat_la_receptie} ref.</span></> : null}</span></> : '—'}</td>
                  <td style={{ ...S.td, padding:'8px 10px', color:G.muted }}>{tot}</td>
                  <td style={{ ...S.td, padding:'8px 10px', color:sm.color, fontWeight:700 }}>{sm.label}</td>
                  <td style={{ ...S.td, padding:'8px 10px', color: pvTxt === '—' ? G.dim : G.green }}>{pvTxt}</td>
                  <td style={{ ...S.td, padding:'8px 10px' }}><button style={{ ...S.btnS, padding:'5px 10px' }} onClick={ev => { ev.stopPropagation(); deschide(d.id) }}>Deschide</button></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize:11.5, color:G.dim, marginTop:8 }}>Anularea unui document o face administratorul (Răzvan), cu motiv — nu din acest ecran. Un document anulat se poate reintroduce corectat.</div>
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
  const avertBd = Array.isArray(ed.bd?.avertismente) ? ed.bd.avertismente.map(x => (typeof x === 'string' ? x : x?.mesaj || JSON.stringify(x))) : []
  const inp = (k, et, tip = 'text', extra = {}) => (
    <div style={{ minWidth:150, flex:1 }} key={k}>
      <label style={S.lbl}>{et}</label>
      <input type={tip} style={{ ...S.input, borderColor: val.document.some(x => x.camp === k && x.nivel === 'blocant') ? G.red : G.border2 }} value={ed.antet[k] ?? ''}
        onChange={e => setAntet(k, e.target.value)} disabled={!edScrie || busy} {...extra} />
    </div>
  )
  const campuriRosii = i => new Set(ed.stare !== 'draft' ? [] : val.randuri[i].filter(x => x.nivel === 'blocant').map(x => CAMP_EDITOR[x.camp] || x.camp))
  const fmtCmp = (c, x) => (x == null ? '—' : c.fmt === 'm' ? fmtNr(x) : c.fmt === 'kg' ? fmtNr(x, Number.isInteger(x) ? 0 : 1) : String(x))

  return (
    <div>
      <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap', marginBottom:12 }}>
        <button style={S.btnS} onClick={inchide} disabled={busy}>← Lista</button>
        <div style={{ fontSize:17, fontWeight:800 }}>{sab.emoji} {sab.label} {ed.antet.nr_document || (ed.id ? '' : '(nou)')}</div>
        <span style={{ fontSize:12, fontWeight:700, color:sm.color, border:`1px solid ${sm.color}66`, borderRadius:6, padding:'2px 8px' }}>{sm.label}</span>
        {ed.versiune != null && <span style={{ fontSize:11.5, color:G.dim }}>versiunea {ed.versiune}</span>}
        {ed.dirty && <span style={{ fontSize:11.5, color:G.yellow }}>● nesalvat</span>}
        <div style={{ flex:1 }} />
        <span style={{ fontSize:12, color:G.muted }}>{proiect?.cod_intern ? `${proiect.cod_intern} · ` : ''}{proiect?.nume}</span>
      </div>
      {mesaj}
      {ed.stare !== 'draft' && (
        <div style={{ ...S.card, padding:'10px 14px', marginBottom:12, fontSize:12.5, color:G.muted }}>
          {ed.stare === 'confirmat' ? `✅ Recepție confirmată${ed.bd?.confirmat_la ? ` la ${fmtData(ed.bd.confirmat_la)}` : ''} — documentul nu se mai modifică.` : '⛔ Document anulat.'}
          {arePv && <> PV {ed.bd.pv_nr ?? ed.bd.pv_nr_canon} din {fmtData(ed.bd.pv_data)}.</>}
          {' '}Anularea o face administratorul.
          {avertBd.map((x, i) => <div key={i} style={{ fontSize:11.5, color:G.yellow, marginTop:3 }}>⚠️ {x}</div>)}
        </div>
      )}
      {ed.stare === 'draft' && !edScrie && <div style={{ ...S.card, padding:'10px 14px', marginBottom:12, fontSize:12.5, color:G.muted }}>👁️ Doar citire — draftul îl editează gestionarul depozitului documentului.</div>}

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
              <select style={S.input} value={ed.inlocuieste_document_id || ''} onChange={e => modifica(x => ({ ...x, inlocuieste_document_id:e.target.value }))} disabled={busy}>
                <option value="">—</option>
                {anulate.filter(d => d.sablon === ed.sablon).map(d => <option key={d.id} value={d.id}>{d.nr_document ?? d.nr_document_canon} · {fmtData(d.data_document)}</option>)}
              </select>
            </div>
          )}
        </div>
        {val.document.filter(x => !['furnizor', 'nr_document', 'data_document', 'depozit_id'].includes(x.camp) && !sab.totaluri.some(([c]) => c === x.camp)).map((x, i) => (
          <div key={i} style={{ fontSize:12, color: x.nivel === 'blocant' ? G.red : G.yellow, marginTop:8 }}>{x.nivel === 'blocant' ? '⛔' : '⚠️'} {x.mesaj}</div>
        ))}
      </div>

      {/* totalurile: de pe document (introduse) lângă cele calculate din rânduri */}
      <div style={{ ...S.card, padding:14, marginBottom:12 }}>
        <div style={{ fontSize:12.5, fontWeight:700, color:G.muted, marginBottom:8 }}>Totaluri — documentul față de rânduri (rândurile refuzate intră în sumă)</div>
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
          {!curba && <> · în registru, disponibil: <b>{fmtNr(t.m_primit_mm / 1000)} m</b> după aviz{t.m_real_mm !== t.m_primit_mm ? <> (<b>{fmtNr(t.m_real_mm / 1000)} m</b> cu lungimile măsurate — lungimea bucății = măsurat, altfel aviz)</> : null}</>}
        </div>
      </div>

      {/* rândurile */}
      <div style={{ ...S.card, padding:0, marginBottom:12 }}>
        <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', padding:'10px 12px', borderBottom:`1px solid ${G.border}` }}>
          <div style={{ fontWeight:700, fontSize:13.5 }}>Rânduri</div>
          {ed.stare === 'draft' && <div style={{ fontSize:12, color: val.blocante ? G.red : G.muted }}>{val.blocante ? `⛔ ${val.blocante} blocante` : '✓ fără blocante în ecran'}{val.avertismente ? <span style={{ color:G.yellow }}> · ⚠️ {val.avertismente} avertismente</span> : null}</div>}
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
                    {cols.map(([c]) => (
                      <td key={c} style={S.td}>
                        <input style={{ ...S.cel, width:LATIME[c] || 80, borderColor: rosii.has(c) ? G.red : G.border2, fontFamily: c === 'serie' || c === 'sarja' ? 'monospace' : 'inherit' }}
                          value={r[c] ?? ''} onChange={e => setRand(i, c, e.target.value)} disabled={!edScrie || busy} />
                      </td>
                    ))}
                    <td style={S.td}>
                      <select style={{ ...S.cel, width:150, color:DECIZIE_CULOARE[r.decizie] || G.text, borderColor: rosii.has('decizie') ? G.red : G.border2 }} value={r.decizie || ''}
                        onChange={e => setRand(i, 'decizie', e.target.value)} disabled={!edScrie || busy}>
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
          <div style={{ fontSize:11.5, color:G.dim, flex:1 }}>PDF sau poză (poza devine PDF). Hash-ul fișierului e declarat de client până la verificarea pe server.</div>
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
                <span style={{ fontFamily:'monospace', color:G.muted }}>{s.nume || s.cale}</span>
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
            {verif.ok ? '✓ Verificarea serverului: fără blocante' : `⛔ Verificarea serverului: ${verif.verdict || 'blocat'}`}{verif.blocante ? ` · ${verif.blocante} blocante` : ''}
          </div>
          {!verifCurenta && <div style={{ fontSize:12, color:G.yellow, marginTop:4 }}>Verificarea e pentru versiunea {verif.versiune ?? '?'}; documentul e acum la {ed.versiune ?? '?'} — apasă din nou „Verifică”.</div>}
          {verif.lista.map((x, j) => (
            <div key={j} style={{ fontSize:12, marginTop:4, color: x.blocant ? G.red : G.yellow }}>{x.blocant ? '⛔' : '⚠️'} {x.nr_crt != null ? `rândul ${x.nr_crt}: ` : ''}{x.mesaj}</div>
          ))}
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
        <span style={{ fontSize:11.5, color:G.dim }}>Anularea o face administratorul.</span>
      </div>

      {/* lipirea din Excel */}
      {lipire && (() => {
        const goala = ed.randuri.length === 1 && !String(ed.randuri[0].serie || '').trim()
        const rez = randuriDinLipire(lipire.text, ed.sablon, { nrStart: lipire.inlocuieste || goala ? 1 : nrMax(ed) + 1 })
        const etCol = Object.fromEntries([...cols, ['decizie', 'Decizie'], ['motiv', 'Motiv'], ['observatie', 'Observație']])
        return (
          <div style={{ position:'fixed', inset:0, background:'#000a', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }} onClick={() => setLipire(null)}>
            <div style={{ ...S.card, width:'min(760px,100%)', padding:18 }} onClick={e => e.stopPropagation()}>
              <div style={{ fontSize:16, fontWeight:800, marginBottom:4 }}>📋 Lipește rândurile din Excel</div>
              <div style={{ fontSize:12, color:G.muted, marginBottom:10 }}>
                Copiază rândurile (cu rândul de antet, ideal) și lipește-le aici. Fără antet se folosește ordinea de pe {curba ? 'lista de ambalare' : 'aviz'}. Rândurile goale și cele de „TOTAL” se sar{curba ? '; pachetul și dimensiunile se completează în jos (celulele unite)' : ''}.
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
        <div style={{ position:'fixed', inset:0, background:'#000a', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }} onClick={() => !busy && setPv(null)}>
          <div style={{ ...S.card, width:'min(420px,100%)', padding:18 }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize:16, fontWeight:800, marginBottom:4 }}>📝 PV de recepție</div>
            <div style={{ fontSize:12, color:G.muted, marginBottom:12 }}>Bucățile primite conform ale documentului trec din „sosit” în „recepționat”. Cele din carantină rămân în carantină.</div>
            <label style={S.lbl}>Nr. PV *</label>
            <input autoFocus style={{ ...S.input, marginBottom:10 }} value={pv.nr} onChange={e => setPv(x => ({ ...x, nr:e.target.value }))} />
            <label style={S.lbl}>Data PV *</label>
            <input type="date" style={S.input} value={pv.data} onChange={e => setPv(x => ({ ...x, data:e.target.value }))} />
            <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:16 }}>
              <button style={S.btnS} onClick={() => setPv(null)} disabled={busy}>Anulează</button>
              <button style={{ ...S.btnP, background:G.blue, color:'#041A33', opacity: busy ? .6 : 1 }} onClick={punePv} disabled={busy}>{busy ? '…' : 'Pune PV'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
