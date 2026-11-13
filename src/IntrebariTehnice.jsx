// ════════════════════════════════════════════════════════════════
// ❓ Întreabă echipa (/intrebari) — spețe tehnice → răspuns AI INFORMATIV (decizie Răzvan 05.11.2026, migrarea 20261105a).
// Colegul scrie speța (+ PDF / poze), workerul de pe serverul AI răspunde în câteva minute; răspunsul îl vede doar autorul
// (și ownerul) și e marcat „AI, neverificat” — decizia de a-l folosi e a colegului. Acces: owner sau cheia 'intrebari_tehnice'.
// Limita: 5 întrebări pe zi (owner 20), verificată în BD.
// ════════════════════════════════════════════════════════════════
// 13.11.2026 (deciziile owner-ului): (A) numele de persoane / firme și datele personale se ASCUND înainte de trimiterea la AI —
// mascarea reală o face workerul, cu MOTORUL UNIC src/intrebariMascare.js (r4: același modul pe care îl folosește și acest ecran);
// ecranul arată o previzualizare ORIENTATIVĂ (lista de nume pe care o poate citi contul, fără localități), iar colegul poate ascunde
// manual un cuvânt; atașamentele NU se mai trimit la AI. (B) „Da” / „Nu” doar cu un citat identic cu un paragraf întreg, dintr-o
// singură propoziție și de sine stătător, al unei surse (r5); altfel „Incert”, cu sursele alăturate.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from './lib/supabase.js'
import { poateIntreba, caleAtasament, verificaFisier, totalPreaMare, blocuriMd, bucatiRand, ETICHETA_STARE, MAX_ATASAMENTE, MAX_MB } from './intrebariUtil.js'
import { imparteRaspuns, surseAfisabile, interogariAfisabile, lipsesteMigrarea, actiuniIntrebare, prezentareRaspuns } from './intrebariSurse.js'
import { previzualizare, bucatiMascate, ascundeSelectia, dictionarDinRanduri } from './intrebariMascare.js'
import { paginareKeyset } from './hrDeciziiUtil.js'

const G = { bg:'#0D1117', surface:'#161B22', text:'#E6EDF3', muted:'#8B949E', border:'#30363D', blue:'#1F6FEB', green:'#2EA043', yellow:'#D29922', red:'#F85149', acc:'#56D4DD' }
const S = {
  card: { background:G.surface, borderRadius:12, border:`1px solid ${G.border}`, padding:16 },
  inp: { width:'100%', boxSizing:'border-box', padding:'10px 12px', background:G.bg, color:G.text, border:`1px solid ${G.border}`, borderRadius:8, fontSize:14, fontFamily:'inherit' },
  btnP: { padding:'11px 18px', background:G.acc, color:'#0D1117', border:'none', borderRadius:10, cursor:'pointer', fontSize:15, fontWeight:700 },
  btnS: { padding:'8px 12px', background:G.bg, color:G.text, border:`1px solid ${G.border}`, borderRadius:8, cursor:'pointer', fontSize:13 },
  lbl: { fontSize:12, color:G.muted, margin:'10px 0 4px', display:'block' },
}
const fmtData = d => d ? new Date(d).toLocaleString('ro-RO', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : ''

function Rand({ text }) {
  return bucatiRand(text).map((b, i) => b.t === 'b' ? <strong key={i}>{b.v}</strong>
    : b.t === 'i' ? <em key={i}>{b.v}</em>
    : b.t === 'cod' ? <code key={i} style={{ background:G.bg, padding:'1px 4px', borderRadius:4 }}>{b.v}</code>
    : <span key={i}>{b.v}</span>)
}

function Markdown({ md }) {
  return <div style={{ lineHeight:1.55, fontSize:14 }}>{blocuriMd(md).map((b, i) => {
    if (b.tip === 'hr') return <hr key={i} style={{ border:'none', borderTop:`1px solid ${G.border}`, margin:'12px 0' }}/>
    if (b.tip === 'h') return <div key={i} style={{ fontWeight:700, fontSize: b.nivel <= 2 ? 16 : 15, margin:'14px 0 6px', color:G.acc }}><Rand text={b.text}/></div>
    if (b.tip === 'lista') { const L = b.ordonata ? 'ol' : 'ul'; return <L key={i} style={{ margin:'4px 0 8px', paddingLeft:22 }}>{b.elemente.map((e, j) => <li key={j} style={{ margin:'2px 0' }}><Rand text={e}/></li>)}</L> }
    return <p key={i} style={{ margin:'6px 0' }}><Rand text={b.text}/></p>
  })}</div>
}

// Răspunsul din cercetare (20261131e): verdictul evidențiat, apoi textul, apoi sursele (web doar pe domeniile oficiale).
// Regula B: la „Incert” sursele vin IMEDIAT sub verdict („alăturate”) — omul le citește; la „Da” / „Nu” rămân după text.
function Raspuns({ q, owner }) {
  const { verdict, rest, incert } = imparteRaspuns(q.raspuns_md)
  const surse = surseAfisabile(q.surse)
  const interogari = owner ? interogariAfisabile(q.interogari_web) : []
  const lista = surse.length > 0 && <Surse surse={surse} alaturate={incert}/>
  return <>
    {verdict && <div style={{ background:G.bg, border:`2px solid ${incert ? G.yellow : G.acc}`, borderRadius:10, padding:'10px 14px', margin:'4px 0 10px', fontSize:16, fontWeight:700 }}>
      <Rand text={verdict}/></div>}
    {incert && lista}
    <Markdown md={verdict ? rest : q.raspuns_md}/>
    {!incert && lista}
    {!surse.length && <div style={{ fontSize:12, color:G.muted, marginTop:10 }}>Răspunsul nu are surse salvate (întrebare de dinainte de cercetare sau fără temei găsit).</div>}
    {owner && <Interogari lista={interogari}/>}
  </>
}

function Surse({ surse, alaturate }) {
  return <div style={{ margin: alaturate ? '0 0 12px' : '14px 0 0', borderTop:`1px solid ${G.border}`, paddingTop:10,
                       ...(alaturate ? { border:`1px solid ${G.yellow}`, borderRadius:8, padding:10 } : {}) }}>
      <div style={{ fontWeight:700, fontSize:14, marginBottom:6 }}>{alaturate ? 'Surse alăturate — citește-le tu' : 'Surse'}</div>
      {alaturate && <div style={{ fontSize:12, color:G.muted, marginBottom:6 }}>
        Niciun citat nu reproduce exact un paragraf întreg și de sine stătător dintr-o sursă, deci nu există un „Da” sau „Nu” sigur. Acestea sunt sursele consultate.</div>}
      <ol style={{ margin:0, paddingLeft:0, listStyle:'none', fontSize:13 }}>{surse.map(s => (
        <li key={s.id} style={{ margin:'0 0 8px' }}>
          <span style={{ color:G.acc, fontWeight:700, marginRight:6 }}>[{s.id}]</span>
          {s.tip === 'web'
            ? <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ color:G.blue }}>{s.titlu}</a>
            : <span title="Document intern de cercetare normativă (repo)">📄 {s.titlu} <span style={{ color:G.muted }}>· {s.cale}</span></span>}
          {s.tip === 'web' && <span style={{ color:G.muted }}> · {new URL(s.url).hostname}</span>}
          {s.extras && <div style={{ color:G.muted, fontSize:12, marginTop:2, whiteSpace:'pre-wrap', maxHeight:90, overflow:'hidden' }}>{s.extras.slice(0, 400)}</div>}
        </li>))}</ol>
    </div>
}

// Decizia A — previzualizare ORIENTATIVĂ (r4, review r3 P2-5): textul mascat cu lista de nume pe care o poate citi contul, câte nume
// / date s-au ascuns, ce NU prinde mascarea și cum ascunzi manual un cuvânt. Mascarea reală o face workerul cu același motor, dar cu
// lista completă din platformă și cu localitățile cunoscute — rezultatul poate diferi în ambele sensuri (textul de mai jos o spune).
export const AVERTISMENT_PREVIZUALIZARE = 'Serverul folosește lista completă din platformă și poate ascunde nume suplimentare. Localitățile cunoscute rămân vizibile pe server, chiar dacă aici apar ascunse. Mascarea automată nu garantează eliminarea tuturor numelor.'
// r5: lista „Nu prinde” la zi (numele scrise cu litere mici nu mai sunt integral în afara contractului) + limitele F4, separat
export const IN_AFARA_CONTRACTULUI = 'Nu prinde: porecle, greșeli de scriere sau de citire automată, litere asemănătoare din alte alfabete, litere despărțite prin spații („N u m e”), diminutive, un cuvânt al unei firme scris integral cu litere mici fără numele întreg al firmei în întrebare, un cuvânt obișnuit care e și nume („Ion”, „Mare”, „Alfa”) scris singur, fără numele întreg în întrebare, nume pe care platforma nu le cunoaște (fără „dl.”, „ing.”, „colegul” în față sau SRL / SA după), un CUI necunoscut platformei scris fără „RO” / „CUI”, adrese. Prinde și: literele late („ＮＵＭＥ”), numele scrise cu litere mici, CUI-ul cunoscut scris cu spații („2345 6789”).'
// r5 (review r4 P2): formularea EXACTĂ a garanției „fără rețea” — o proprietate a codului, nu o izolare a procesului
export const GARANTIE_RETEA = 'Pe server, mascarea rulează local, într-un proces separat; codul ei, fixat prin amprente, nu conține apeluri de rețea (verificare a codului, nu o izolare a procesului).'
function Previzualizare({ prev, nume, cuAtasamente }) {
  const faraLista = nume.stare === 'eroare' || (nume.stare === 'ok' && !nume.angajati)
  return <div style={{ marginTop:12, background:G.bg, border:`1px dashed ${G.yellow}`, borderRadius:8, padding:10, fontSize:13 }}>
    <div style={{ fontWeight:700, marginBottom:4 }}>🙈 Previzualizare orientativă — verifică înainte de trimitere</div>
    <div style={{ color:G.text, fontSize:12, marginBottom:6 }}><strong>Previzualizare orientativă.</strong> {AVERTISMENT_PREVIZUALIZARE}</div>
    <div style={{ color: prev.total ? G.yellow : G.muted, fontSize:12, marginBottom:8 }}>
      {prev.total ? `Am ascuns ${prev.total} ${prev.total === 1 ? 'nume / dată' : 'nume și date'} (${prev.rezumat}).` : 'Nu am găsit nume sau date de ascuns.'}
      {' '}Ce nu e ascuns aici pleacă așa. Ca să ascunzi un cuvânt: selectează-l și apasă „Ascunde selecția”, sau scrie-l între [[ și ]].</div>
    {prev.titlu && <div><span style={{ color:G.muted }}>Titlu: </span><Mascat text={prev.titlu}/></div>}
    {prev.context && <div><span style={{ color:G.muted }}>Context: </span><Mascat text={prev.context}/></div>}
    {prev.intrebare && <div style={{ marginTop:4 }}><span style={{ color:G.muted }}>Speța: </span><Mascat text={prev.intrebare}/></div>}
    <div style={{ color:G.muted, fontSize:12, marginTop:8 }}>
      {nume.stare === 'incarca' ? 'Se încarcă lista de nume din platformă… ' : faraLista
        ? 'Lista de nume din platformă nu se poate citi din contul tău: aici se ascund doar tiparele și ce marchezi tu. '
        : ''}
      {IN_AFARA_CONTRACTULUI} Rămân vizibile intenționat: localitățile, operatorii de rețea și instituțiile publice (Transgaz, Delgaz, ANRE …) și Gazpet.
      {' '}{GARANTIE_RETEA}
    </div>
    {cuAtasamente && <div style={{ color:G.yellow, fontSize:12, marginTop:6 }}>
      📎 Atașamentele rămân în ERP pentru colegi, dar NU se trimit la AI: numele din ele nu pot fi ascunse sigur. Scrie în speță ce e important din ele.</div>}
  </div>
}

// Textul mascat, cu etichetele evidențiate (previzualizarea orientativă).
function Mascat({ text }) {
  return <span style={{ whiteSpace:'pre-wrap' }}>{bucatiMascate(text).map((b, i) => b.t === 'eticheta'
    ? <span key={i} style={{ background:'#3D2E00', color:G.yellow, borderRadius:4, padding:'0 3px', fontFamily:'monospace', fontSize:12 }}>{b.v}</span>
    : <span key={i}>{b.v}</span>)}</span>
}

// Audit (doar ownerul): exact ce s-a trimis la căutarea web — speța nu intră în acel apel, doar interogări compuse din vocabularul aprobat.
function Interogari({ lista }) {
  return <details style={{ marginTop:10, fontSize:12, color:G.muted }}>
    <summary style={{ cursor:'pointer' }}>🔎 Interogări trimise la căutarea web ({lista.length}) · audit owner</summary>
    {lista.length ? <ul style={{ margin:'6px 0 0', paddingLeft:18 }}>{lista.map((x, i) => <li key={i}>{x}</li>)}</ul>
      : <div style={{ marginTop:6 }}>Nicio căutare web (niciun termen din vocabularul aprobat sau întrebare de dinainte de cercetare).</div>}
  </details>
}

export default function IntrebariTehnice({ profile }) {
  const [params, setParams] = useSearchParams()
  const [lista, setLista] = useState([])
  const [titlu, setTitlu] = useState('')
  const [context, setContext] = useState('')
  const [intrebare, setIntrebare] = useState('')
  const [fisiere, setFisiere] = useState([])
  const [lucru, setLucru] = useState(false)
  const [err, setErr] = useState('')
  const [info, setInfo] = useState('')
  const fileRef = useRef(null)
  const selectat = Number(params.get('id')) || null

  const [detaliu, setDetaliu] = useState(null)   // { id, rand } — întrebarea deschisă, citită separat după id (poate fi în afara listei)
  const [errDet, setErrDet] = useState('')
  const [vechi, setVechi] = useState([])         // pagini mai vechi (keyset pe creat_la, id), adăugate la cerere
  const [maiSunt, setMaiSunt] = useState(false)
  const PAG = 50
  const gen = useRef(0)                          // generația încărcării: un răspuns vechi sosit târziu nu suprascrie unul nou
  const COL_V1 = 'id, autor, titlu, context, intrebare, atasamente, stare, raspuns_md, model, eroare, creat_la, raspuns_la, profiles(name)'
  const colV2 = useRef(true)                     // coloanele `surse` / `interogari_web` (20261131e); fără migrare, ecranul merge pe v1
  const COL = () => colV2.current ? COL_V1 + ', surse, interogari_web' : COL_V1
  const lipsaV2 = e => colV2.current && lipsesteMigrarea(e) && (colV2.current = false, true)
  // runda 4 (review r3 P2): migrarea DETECTATĂ — true doar după o citire reușită cu coloanele v2; până atunci (null) sau fără ea
  // (false) butoanele care cheamă RPC-urile 20261131e nu apar (actiuniIntrebare)
  const [v2, setV2] = useState(null)
  const [lucruRand, setLucruRand] = useState(null)   // id-ul întrebării cu acțiune în curs (una singură odată)
  const [mesajRand, setMesajRand] = useState(null)   // { id, ok, text } — se afișează DOAR sub întrebarea cu acel id
  const actGen = useRef(0)                           // generația acțiunii: rezultatul uneia vechi nu suprascrie mesajul uneia noi

  // Decizia A — previzualizarea mascării: numele din platformă pe care contul curent le poate citi (angajați, terți), paginat pe id
  // (L23). Eroare ≠ listă goală (L18): o tabelă care dă eroare sau 0 rânduri (fără drept de citire) e spusă în ecran; pe server
  // mascarea folosește oricum lista completă. Rezultatul se aplică doar dacă ecranul e încă montat pe același utilizator (L24).
  const [nume, setNume] = useState({ stare: 'incarca', d: null, angajati: 0, terti: 0, eroare: '' })
  const acces = poateIntreba(profile)
  useEffect(() => {
    if (!acces) return
    let viu = true
    const pag = (tabel, col) => paginareKeyset((dupa, pas) => {
      let q = supabase.from(tabel).select(col).order('id', { ascending: true }).limit(pas)
      if (dupa != null) q = q.gt('id', dupa)
      return q
    })
    Promise.allSettled([pag('employees', 'id, name'), pag('beneficiari', 'id, nume, contact_nume, cif')]).then(([a, t]) => {
      if (!viu) return
      const ang = a.status === 'fulfilled' ? a.value : [], ter = t.status === 'fulfilled' ? t.value : []
      const erori = [a, t].filter(x => x.status === 'rejected').map(x => x.reason?.message || String(x.reason))
      setNume({ stare: erori.length ? 'eroare' : 'ok', d: dictionarDinRanduri(ang, ter), angajati: ang.length, terti: ter.length, eroare: erori.join(' · ') })
    })
    return () => { viu = false }
  }, [acces, profile?.id])
  const prev = useMemo(() => previzualizare({ titlu, intrebare, context }, nume.d), [titlu, intrebare, context, nume.d])
  const refCamp = { titlu: useRef(null), context: useRef(null), intrebare: useRef(null) }
  const ultimCamp = useRef('intrebare')
  const MAX_CAMP = { titlu: 200, context: 2000, intrebare: 12000 }
  function ascunde() {
    const camp = ultimCamp.current, el = refCamp[camp].current
    const val = { titlu, context, intrebare }[camp]
    const r = el ? ascundeSelectia(val, el.selectionStart ?? 0, el.selectionEnd ?? 0) : null
    if (!r) return setErr('Selectează întâi, în titlu, context sau speță, cuvântul de ascuns (fără rând nou, max 200 de caractere).')
    if (r.text.length > MAX_CAMP[camp]) return setErr('Textul ar depăși lungimea maximă a câmpului.')
    ;({ titlu: setTitlu, context: setContext, intrebare: setIntrebare })[camp](r.text)
    setErr('')
  }

  async function incarca() {
    const g = ++gen.current
    const cere = () => Promise.all([
      supabase.from('intrebari_tehnice').select(COL()).order('creat_la', { ascending:false }).order('id', { ascending:false }).limit(PAG),
      selectat ? supabase.from('intrebari_tehnice').select(COL()).eq('id', selectat).maybeSingle() : Promise.resolve({ data:null, error:null }),
    ])
    let [l, d] = await cere()
    if (lipsaV2(l.error) || lipsaV2(d.error)) [l, d] = await cere()
    if (g !== gen.current) return
    if (l.error) setErr('Nu s-au putut încărca întrebările: ' + l.error.message)
    else { setV2(colV2.current); setLista(l.data || []); if (!vechi.length) setMaiSunt((l.data || []).length === PAG) }
    if (selectat) {
      if (d.error) setErrDet('Întrebarea nu a putut fi încărcată: ' + d.error.message)
      else if (!d.data) setErrDet('Întrebarea nu există sau nu ai acces la ea.')
      else { setErrDet(''); setDetaliu({ id: selectat, rand: d.data }) }
    }
  }
  const incarcaRef = useRef(incarca)
  incarcaRef.current = incarca            // intervalul cheamă mereu versiunea curentă (review r3 P2-3)
  useEffect(() => { setErrDet(''); incarca() }, [selectat])   // eslint-disable-line react-hooks/exhaustive-deps

  async function incarcaVechi() {
    const toate = [...lista, ...vechi]
    const ultim = toate[toate.length - 1]
    if (!ultim) return
    const { data, error } = await supabase.from('intrebari_tehnice').select(COL())
      .or(`creat_la.lt.${ultim.creat_la},and(creat_la.eq.${ultim.creat_la},id.lt.${ultim.id})`)
      .order('creat_la', { ascending:false }).order('id', { ascending:false }).limit(PAG)
    if (error) return setErr('Nu s-au putut încărca întrebările mai vechi: ' + error.message)
    const ids = new Set(toate.map(x => x.id))
    setVechi(v => [...v, ...(data || []).filter(x => !ids.has(x.id))])
    setMaiSunt((data || []).length === PAG)
  }
  // „Răspuns neclar — trimite la verificare” (autorul): doar marchează starea, fără alte efecte.
  // „Reia cu cercetare” (doar ownerul — reluarea costă): întrebarea revine în coadă; nimic nu se reia automat.
  // Id-ul și generația se fixează la pornire: dacă între timp s-a deschis altă întrebare, mesajul rămâne legat de întrebarea
  // pe care s-a apăsat (nu apare sub alta), iar reîncărcarea folosește URL-ul CURENT (incarcaRef), nu pe cel de la apăsare.
  async function actiuneRand(rpc, id, mesajOk) {
    if (lucruRand !== null || v2 !== true) return   // fără migrarea 20261131e detectată, RPC-urile nu există
    const g = ++actGen.current
    setLucruRand(id); setMesajRand(null)
    let rez
    try {
      const { data, error } = await supabase.rpc(rpc, { p_id: id })
      if (error) throw new Error(error.message)
      if (data !== true) throw new Error('Starea întrebării s-a schimbat între timp. Reîncarcă pagina.')
      rez = { id, ok: true, text: mesajOk }
    } catch (e) { rez = { id, ok: false, text: e.message } }
    if (g === actGen.current) setMesajRand(rez)
    setLucruRand(null)
    await incarcaRef.current()
  }

  const inAsteptare = x => x && (x.stare === 'noua' || x.stare === 'in_lucru')
  const q = selectat && detaliu?.id === selectat ? detaliu.rand : null   // niciodată detaliul altei întrebări sub URL-ul curent
  const asteapta = lista.some(inAsteptare) || inAsteptare(q)
  useEffect(() => {
    if (!asteapta) return
    const t = setInterval(() => incarcaRef.current(), 20000)
    return () => clearInterval(t)
  }, [asteapta, selectat])   // eslint-disable-line react-hooks/exhaustive-deps

  if (!acces) {
    return <div style={{ minHeight:'100vh', background:G.bg, color:G.text, padding:24 }}>Nu ai acces la Întreabă echipa. <Link to="/" style={{ color:G.blue }}>← Acasă</Link></div>
  }

  function alegeFisiere(e) {
    const noi = Array.from(e.target.files || [])
    e.target.value = ''
    const probleme = noi.map(f => [f, verificaFisier(f)]).filter(([, p]) => p)
    if (probleme.length) setErr(probleme.map(([f, p]) => `${f.name}: ${p}`).join(' · '))
    else setErr('')
    setFisiere(v => {
      const toate = [...v, ...noi.filter(f => !verificaFisier(f))].slice(0, MAX_ATASAMENTE)
      if (totalPreaMare(toate)) { setErr(`Atașamentele depășesc ${MAX_MB} MB în total.`); return v }
      return toate
    })
  }

  async function trimite() {
    if (lucru) return
    if (titlu.trim().length < 3) return setErr('Scrie un titlu scurt (minim 3 caractere).')
    if (intrebare.trim().length < 10) return setErr('Descrie speța (minim 10 caractere).')
    if (totalPreaMare(fisiere)) return setErr(`Atașamentele depășesc ${MAX_MB} MB în total.`)
    setLucru(true); setErr(''); setInfo('')
    try {
      const uid = profile.id
      const atasamente = []
      for (const f of fisiere) {
        const path = caleAtasament(uid, f.type, crypto.randomUUID())
        const { error } = await supabase.storage.from('intrebari-tehnice').upload(path, f, { contentType: f.type, upsert: false })
        if (error) throw new Error(`Încărcarea „${f.name}” a eșuat: ${error.message}`)
        atasamente.push({ path, nume: f.name.slice(0, 200), mime: f.type, marime: f.size })
      }
      const { data, error } = await supabase.from('intrebari_tehnice')
        .insert({ titlu: titlu.trim(), context: context.trim() || null, intrebare: intrebare.trim(), atasamente })
        .select('id').single()
      if (error) throw new Error(error.message)
      setTitlu(''); setContext(''); setIntrebare(''); setFisiere([])
      setInfo('Întrebarea a intrat în coadă. Răspunsul vine de obicei în câteva minute; primești notificare.')
      await incarca()
      setParams({ id: String(data.id) })
    } catch (e) { setErr(e.message) } finally { setLucru(false) }
  }
  const act = q ? actiuniIntrebare({ v2, stare: q.stare, eAutor: q.autor === profile.id, eOwner: !!profile.is_owner }) : null
  // runda 5 (review r4 P2): fără migrarea detectată, răspunsul arată exact ca înainte (eticheta veche, Markdown simplu)
  const pr = q ? prezentareRaspuns({ v2, surse: q.surse, interogari: q.interogari_web }) : null

  return (
    <div style={{ minHeight:'100vh', background:G.bg, color:G.text, padding:'16px 16px 48px', fontFamily:'system-ui, sans-serif' }}>
      <div style={{ maxWidth:900, margin:'0 auto' }}>
        <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:14 }}>
          <Link to="/" style={{ color:G.muted, textDecoration:'none', fontSize:14 }}>← Acasă</Link>
          <div style={{ fontSize:20, fontWeight:700 }}>❓ Întreabă echipa</div>
        </div>
        <div style={{ ...S.card, borderColor:G.yellow, marginBottom:14, fontSize:13, color:G.muted }}>
          Răspunsurile sunt date de AI și sunt <strong style={{ color:G.yellow }}>informative</strong>. Le vezi doar tu.
          {' '}Numele de persoane și firme și datele personale se ascund înainte de trimiterea la AI (vezi previzualizarea de sub speță); atașamentele nu se trimit.
          {v2 === true ? <>
            {' '}Fiecare temei are un marcaj de sursă ([C…] = document intern de cercetare, [W…] = site oficial) — deschide sursa înainte să te bazezi pe ea.
            „Da” sau „Nu” apar doar când răspunsul citează exact o propoziție întreagă dintr-o sursă (citatul e în răspuns); altfel verdictul e „Incert”, cu sursele alăturate.
            Ce n-a fost găsit apare ca „Nu am găsit sursa oficială”.
            La răspunsurile mai vechi, fără surse, verifică temeiurile marcate „[DE VERIFICAT]”. Decizia e a ta.
          </> : <>
            {' '}Verifică temeiurile marcate „[DE VERIFICAT]” înainte să te bazezi pe ele. Decizia e a ta.
          </>}
        </div>

        {selectat && !q && <div style={{ ...S.card, color: errDet ? G.red : G.muted, fontSize:13, marginBottom:10 }}>
          {errDet || 'Se încarcă…'} <button style={{ ...S.btnS, marginLeft:8 }} onClick={() => setParams({})}>← Toate întrebările</button></div>}
        {q ? (
          <div style={S.card}>
            <button style={{ ...S.btnS, marginBottom:12 }} onClick={() => setParams({})}>← Toate întrebările</button>
            <div style={{ fontSize:17, fontWeight:700 }}>{q.titlu}</div>
            <div style={{ fontSize:12, color:G.muted, margin:'4px 0 10px' }}>
              {fmtData(q.creat_la)}{q.profiles?.name && profile.is_owner ? ` · ${q.profiles.name}` : ''}{q.context ? ` · ${q.context}` : ''}
            </div>
            <div style={{ whiteSpace:'pre-wrap', fontSize:14, background:G.bg, borderRadius:8, padding:12, border:`1px solid ${G.border}` }}>{q.intrebare}</div>
            {(q.atasamente || []).length > 0 && <div style={{ fontSize:12, color:G.muted, marginTop:6 }}>📎 {(q.atasamente || []).map(a => a.nume).join(', ')}</div>}
            <div style={{ marginTop:16 }}>
              {(pr.v2 ? (q.stare === 'raspuns' || q.stare === 'de_verificat') && q.raspuns_md : q.stare === 'raspuns') ? <>
                <div style={{ fontSize:12, color:G.yellow, marginBottom:6 }}>{pr.eticheta} · {fmtData(q.raspuns_la)}</div>
                {q.stare === 'de_verificat' && <div style={{ fontSize:12, color:ETICHETA_STARE.de_verificat.c, marginBottom:6 }}>
                  ⚑ Marcat ca neclar — așteaptă verificarea.</div>}
                {pr.v2 ? <Raspuns q={q} owner={!!profile.is_owner}/> : <Markdown md={q.raspuns_md}/>}
              </> : q.stare === 'eroare' ? <>
                <div style={{ color:G.red }}>Nu s-a putut răspunde: {q.eroare || 'eroare'}. Poți pune întrebarea din nou.</div>
                {pr.v2 && profile.is_owner && <Interogari lista={interogariAfisabile(q.interogari_web)}/>}
              </> : <div style={{ color:G.muted }}>{ETICHETA_STARE[q.stare]?.t} Pagina se actualizează singură.</div>}
            </div>
            {(act.verificare || act.reia) && <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginTop:14 }}>
              {act.verificare &&
                <button style={{ ...S.btnS, opacity: lucruRand !== null ? 0.6 : 1 }} disabled={lucruRand !== null}
                  onClick={() => actiuneRand('fn_intrebari_de_verificat', q.id, 'Răspunsul a fost trimis la verificare.')}>⚑ Răspuns neclar — trimite la verificare</button>}
              {act.reia &&
                <button style={{ ...S.btnS, borderColor:G.acc, opacity: lucruRand !== null ? 0.6 : 1 }} disabled={lucruRand !== null}
                  onClick={() => window.confirm('Reiei întrebarea cu cercetare? Răspunsul actual se înlocuiește și apelul AI costă (intră în plafonul de 40/zi).') &&
                    actiuneRand('fn_intrebari_reia', q.id, 'Întrebarea a intrat din nou în coadă.')}>🔁 Reia cu cercetare</button>}
            </div>}
            {act.nota && <div style={{ fontSize:12, color:G.muted, marginTop:8 }}>
              Trimiterea la verificare și reluarea cu cercetare sunt disponibile după actualizarea bazei de date.</div>}
            {mesajRand?.id === q.id && <div style={{ color: mesajRand.ok ? G.green : G.red, fontSize:13, marginTop:8 }}>{mesajRand.text}</div>}
          </div>
        ) : !selectat && <>
          <div style={{ ...S.card, marginBottom:16 }}>
            <label style={S.lbl}>Titlu</label>
            <input ref={refCamp.titlu} onFocus={() => { ultimCamp.current = 'titlu' }} style={S.inp} value={titlu} maxLength={200} onChange={e => setTitlu(e.target.value)} placeholder="ex. Distanța minimă față de canalizare la subtraversare"/>
            <label style={S.lbl}>Context (opțional: proiect, licitație, localitate)</label>
            <input ref={refCamp.context} onFocus={() => { ultimCamp.current = 'context' }} style={S.inp} value={context} maxLength={2000} onChange={e => setContext(e.target.value)} placeholder="ex. Rețea PE100 Dn 110, Mânăstirea, CL"/>
            <label style={S.lbl}>Speța</label>
            <textarea ref={refCamp.intrebare} onFocus={() => { ultimCamp.current = 'intrebare' }} style={{ ...S.inp, minHeight:150, resize:'vertical' }} value={intrebare} maxLength={12000} onChange={e => setIntrebare(e.target.value)}
              placeholder="Descrie situația, ce ai deja (avize, proiect, ce cere beneficiarul) și ce anume vrei să afli."/>
            <div style={{ marginTop:6 }}>
              <button style={S.btnS} onMouseDown={e => e.preventDefault()} onClick={ascunde}
                title="Selectează un cuvânt în titlu, context sau speță, apoi apasă: cuvântul nu va pleca la AI.">🙈 Ascunde selecția</button>
            </div>
            {(titlu.trim() || intrebare.trim() || context.trim()) && <Previzualizare prev={prev} nume={nume} cuAtasamente={fisiere.length > 0}/>}
            <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap', marginTop:10 }}>
              <input ref={fileRef} type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp" style={{ display:'none' }} onChange={alegeFisiere}/>
              <button style={S.btnS} disabled={fisiere.length >= MAX_ATASAMENTE} onClick={() => fileRef.current?.click()}>📎 Atașează PDF / poze ({fisiere.length}/{MAX_ATASAMENTE})</button>
              {fisiere.map((f, i) => <span key={i} style={{ fontSize:12, background:G.bg, border:`1px solid ${G.border}`, borderRadius:6, padding:'3px 8px' }}>
                {f.name} <span style={{ cursor:'pointer', color:G.red }} onClick={() => setFisiere(v => v.filter((_, j) => j !== i))}>✕</span></span>)}
            </div>
            {err && <div style={{ color:G.red, fontSize:13, marginTop:10 }}>{err}</div>}
            {info && <div style={{ color:G.green, fontSize:13, marginTop:10 }}>{info}</div>}
            <div style={{ marginTop:14 }}><button style={{ ...S.btnP, opacity: lucru ? 0.6 : 1 }} disabled={lucru} onClick={trimite}>{lucru ? 'Se trimite…' : 'Trimite întrebarea'}</button></div>
          </div>

          <div style={{ fontSize:14, fontWeight:700, margin:'0 0 8px' }}>Întrebările {profile.is_owner ? 'tuturor' : 'mele'}</div>
          {lista.length === 0 && <div style={{ color:G.muted, fontSize:13 }}>Nicio întrebare încă.</div>}
          {[...lista, ...vechi.filter(v => !lista.some(x => x.id === v.id))].map(x => (
            <div key={x.id} onClick={() => setParams({ id: String(x.id) })} style={{ ...S.card, padding:12, marginBottom:8, cursor:'pointer', display:'flex', gap:10, alignItems:'center' }}>
              <span style={{ fontSize:11, fontWeight:700, color:ETICHETA_STARE[x.stare]?.c, border:`1px solid ${ETICHETA_STARE[x.stare]?.c}`, borderRadius:6, padding:'2px 6px', whiteSpace:'nowrap' }}>{ETICHETA_STARE[x.stare]?.t}</span>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{x.titlu}</div>
                <div style={{ fontSize:12, color:G.muted }}>{fmtData(x.creat_la)}{profile.is_owner && x.profiles?.name ? ` · ${x.profiles.name}` : ''}</div>
              </div>
            </div>
          ))}
          {maiSunt && <button style={S.btnS} onClick={incarcaVechi}>Încarcă întrebările mai vechi</button>}
        </>}
      </div>
    </div>
  )
}
