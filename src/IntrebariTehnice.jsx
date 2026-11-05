// ════════════════════════════════════════════════════════════════
// ❓ Întreabă echipa (/intrebari) — spețe tehnice → răspuns AI INFORMATIV (decizie Răzvan 05.11.2026, migrarea 20261105a).
// Colegul scrie speța (+ PDF / poze), workerul de pe serverul AI răspunde în câteva minute; răspunsul îl vede doar autorul
// (și ownerul) și e marcat „AI, neverificat” — decizia de a-l folosi e a colegului. Acces: owner sau cheia 'intrebari_tehnice'.
// Limita: 5 întrebări pe zi (owner 20), verificată în BD.
// ════════════════════════════════════════════════════════════════
import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from './lib/supabase.js'
import { poateIntreba, caleAtasament, verificaFisier, totalPreaMare, blocuriMd, bucatiRand, ETICHETA_STARE, MAX_ATASAMENTE, MAX_MB } from './intrebariUtil.js'

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
  const [limita, setLimita] = useState(100)
  const gen = useRef(0)                          // generația încărcării: un răspuns vechi sosit târziu nu suprascrie unul nou
  const COL = 'id, autor, titlu, context, intrebare, atasamente, stare, raspuns_md, model, eroare, creat_la, raspuns_la, profiles(name)'

  async function incarca() {
    const g = ++gen.current
    const [l, d] = await Promise.all([
      supabase.from('intrebari_tehnice').select(COL).order('creat_la', { ascending:false }).limit(limita),
      selectat ? supabase.from('intrebari_tehnice').select(COL).eq('id', selectat).maybeSingle() : Promise.resolve({ data:null, error:null }),
    ])
    if (g !== gen.current) return
    if (l.error) setErr('Nu s-au putut încărca întrebările: ' + l.error.message); else setLista(l.data || [])
    if (selectat) {
      if (d.error) setErrDet('Întrebarea nu a putut fi încărcată: ' + d.error.message)
      else if (!d.data) setErrDet('Întrebarea nu există sau nu ai acces la ea.')
      else { setErrDet(''); setDetaliu({ id: selectat, rand: d.data }) }
    }
  }
  useEffect(() => { setErrDet(''); incarca() }, [selectat, limita])   // eslint-disable-line react-hooks/exhaustive-deps
  const inAsteptare = x => x && (x.stare === 'noua' || x.stare === 'in_lucru')
  const q = selectat && detaliu?.id === selectat ? detaliu.rand : null   // niciodată detaliul altei întrebări sub URL-ul curent
  const asteapta = lista.some(inAsteptare) || inAsteptare(q)
  useEffect(() => {
    if (!asteapta) return
    const t = setInterval(incarca, 20000)
    return () => clearInterval(t)
  }, [asteapta, selectat])   // eslint-disable-line react-hooks/exhaustive-deps

  if (!poateIntreba(profile)) {
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


  return (
    <div style={{ minHeight:'100vh', background:G.bg, color:G.text, padding:'16px 16px 48px', fontFamily:'system-ui, sans-serif' }}>
      <div style={{ maxWidth:900, margin:'0 auto' }}>
        <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:14 }}>
          <Link to="/" style={{ color:G.muted, textDecoration:'none', fontSize:14 }}>← Acasă</Link>
          <div style={{ fontSize:20, fontWeight:700 }}>❓ Întreabă echipa</div>
        </div>
        <div style={{ ...S.card, borderColor:G.yellow, marginBottom:14, fontSize:13, color:G.muted }}>
          Răspunsurile sunt date de AI și sunt <strong style={{ color:G.yellow }}>informative</strong>. Le vezi doar tu.
          Verifică temeiurile marcate „[DE VERIFICAT]” înainte să te bazezi pe ele. Decizia e a ta.
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
              {q.stare === 'raspuns' ? <>
                <div style={{ fontSize:12, color:G.yellow, marginBottom:6 }}>🤖 Răspuns AI · informativ, neverificat · {fmtData(q.raspuns_la)}</div>
                <Markdown md={q.raspuns_md}/>
              </> : q.stare === 'eroare' ? <div style={{ color:G.red }}>Nu s-a putut răspunde: {q.eroare || 'eroare'}. Poți pune întrebarea din nou.</div>
                : <div style={{ color:G.muted }}>{ETICHETA_STARE[q.stare]?.t} Pagina se actualizează singură.</div>}
            </div>
          </div>
        ) : !selectat && <>
          <div style={{ ...S.card, marginBottom:16 }}>
            <label style={S.lbl}>Titlu</label>
            <input style={S.inp} value={titlu} maxLength={200} onChange={e => setTitlu(e.target.value)} placeholder="ex. Distanța minimă față de canalizare la subtraversare"/>
            <label style={S.lbl}>Context (opțional: proiect, licitație, localitate)</label>
            <input style={S.inp} value={context} maxLength={2000} onChange={e => setContext(e.target.value)} placeholder="ex. Rețea PE100 Dn 110, Mânăstirea, CL"/>
            <label style={S.lbl}>Speța</label>
            <textarea style={{ ...S.inp, minHeight:150, resize:'vertical' }} value={intrebare} maxLength={12000} onChange={e => setIntrebare(e.target.value)}
              placeholder="Descrie situația, ce ai deja (avize, proiect, ce cere beneficiarul) și ce anume vrei să afli."/>
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
          {lista.map(x => (
            <div key={x.id} onClick={() => setParams({ id: String(x.id) })} style={{ ...S.card, padding:12, marginBottom:8, cursor:'pointer', display:'flex', gap:10, alignItems:'center' }}>
              <span style={{ fontSize:11, fontWeight:700, color:ETICHETA_STARE[x.stare]?.c, border:`1px solid ${ETICHETA_STARE[x.stare]?.c}`, borderRadius:6, padding:'2px 6px', whiteSpace:'nowrap' }}>{ETICHETA_STARE[x.stare]?.t}</span>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{x.titlu}</div>
                <div style={{ fontSize:12, color:G.muted }}>{fmtData(x.creat_la)}{profile.is_owner && x.profiles?.name ? ` · ${x.profiles.name}` : ''}</div>
              </div>
            </div>
          ))}
          {lista.length >= limita && <button style={S.btnS} onClick={() => setLimita(n => n + 100)}>Încarcă întrebările mai vechi</button>}
        </>}
      </div>
    </div>
  )
}
