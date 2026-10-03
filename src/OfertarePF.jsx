import { useEffect, useReducer, useRef, useState } from 'react'
import { supabase } from './lib/supabase.js'
import { ROLURI_OFERTA, INSTRUMENTE, ROLURI, DOMENII, valideazaValoare, bani, dinBani, hashFisierClient,
  ACCES_PF_INITIAL, reduceAccesPF, abonareAccesPF, cheieDosarPF } from './ofertarePF.js'

const G = { bg:'#0D1117', card:'#1C2128', text:'#E6EDF3', muted:'#8B949E', border:'#30363D', blue:'#58A6FF', red:'#F85149', yellow:'#E3B341' }
const S = {
  card:{ background:G.card, border:`1px solid ${G.border}`, borderRadius:10, padding:14, marginBottom:12 },
  input:{ boxSizing:'border-box', width:'100%', padding:'7px 9px', background:G.bg, color:G.text, border:`1px solid ${G.border}`, borderRadius:6 },
  btn:{ background:G.bg, color:G.blue, border:`1px solid ${G.border}`, borderRadius:6, padding:'8px 12px', cursor:'pointer' },
  grid:{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))', gap:10 },
}
const rezultat = r => { if (r.error) throw r.error; return r.data }
const textEroare = e => e?.message || String(e)
const nouaValoare = () => ({ rol_valoare:'total_oferta', domeniu_valoric:'gazpet', participant:'', valoare:'', tva_inclus:false, cota_pct:'', baza_text:'', sursa:'', localizare:'', nota:'', confirm:false })
const nouDocument = () => ({ cheie:'', cod:'', denumire:'', fisier_path:'', provenienta:'', stare_depunere:'nu' })
const cheieDoc = d => d.registru_id != null ? `r:${d.registru_id}` : `e:${d.cheie}`
function Camp({ label, children }) { return <label style={{ display:'block', fontSize:12, color:G.muted }}>{label}<div style={{ marginTop:5 }}>{children}</div></label> }
function Optiuni({ valori, value, onChange }) { return <select style={S.input} value={value} onChange={e => onChange(e.target.value)}>{Object.entries(valori).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select> }

// Un singur hook per ecran (fișa licitației / dashboard-ul proiectului); rezultatul se dă ca prop lui <OfertarePF acces=…>.
// Re-verificare doar la schimbarea utilizatorului (vezi reduceAccesPF). RLS/RPC rămân autoritatea de acces.
export function useAccesPF() {
  const [acces, dispatch] = useReducer(reduceAccesPF, ACCES_PF_INITIAL)
  useEffect(() => abonareAccesPF(supabase.auth, dispatch), [])
  useEffect(() => {
    const uid = acces.deVerificat
    if (!uid) return undefined
    let live = true
    Promise.all([supabase.rpc('fn_poate_citi_pf'), supabase.rpc('fn_poate_scrie_pf')]).then(rs => {
      if (!live) return
      const e = rs.find(r => r.error)?.error
      if (e) dispatch({ tip:'eroare', uid, cod:e.code, mesaj:textEroare(e) })
      else dispatch({ tip:'rezultat', uid, citire:rs[0].data, scriere:rs[1].data })
    }).catch(e => { if (live) dispatch({ tip:'eroare', uid, cod:e?.code, mesaj:textEroare(e) }) })
    return () => { live = false }
  }, [acces.deVerificat])
  return acces
}

export default function OfertarePF({ licitatieId, proiectId, acces }) {
  if ((licitatieId != null) === (proiectId != null)) return <p role="alert">PF cere exact o licitație sau un proiect.</p>
  if (!acces) return <p role="alert">Accesul PF nu a fost verificat.</p>
  if (acces.eroareAcces) return <p role="alert" style={{ color:G.red }}>Acces PF: {acces.eroareAcces}</p>
  if (acces.incarcare) return <p>Se verifică accesul PF…</p>
  if (!acces.poateCiti) return <p>Nu ai drept de acces la propunerea financiară.</p>
  return <DosarPF key={cheieDosarPF(acces, licitatieId, proiectId)} licitatieId={licitatieId} proiectId={proiectId} poateScrie={acces.poateScrie} />
}

function DosarPF({ licitatieId, proiectId, poateScrie }) {
  const [pachete,setPachete] = useState([]), [p,setP] = useState(null), [valori,setValori] = useState([]), [control,setControl] = useState([])
  const [registru,setRegistru] = useState([]), [areRegistru,setAreRegistru] = useState(false), [err,setErr] = useState(null)
  const [busy,setBusy] = useState(false), [loading,setLoading] = useState(true), [user,setUser] = useState(null)
  const [antet,setAntet] = useState({ eticheta:'', rol_oferta:'ofertant_unic', instrument:'necunoscut', moneda:'RON' })
  const [initial,setInitial] = useState({ eticheta:'',rol_oferta:'ofertant_unic',instrument:'necunoscut',moneda:'RON' })
  const [v,setV] = useState(nouaValoare), [doc,setDoc] = useState(nouDocument), [docs,setDocs] = useState([])
  const [confirmInchide,setConfirmInchide] = useState(false), [etichetaNoua,setEtichetaNoua] = useState('')
  const generatie = useRef(0)
  const parinte = licitatieId != null ? { licitatie_id:licitatieId } : { proiect_id:proiectId }
  const draft = p?.stare === 'lucru' && poateScrie
  const selectValori = 'id,pachet_id,rol_valoare,domeniu_valoric,participant,valoare::text,tva_inclus,cota_pct::text,baza_text,sursa_registru_id,sursa_externa_cheie,localizare,confirmat_de,confirmat_la,nota'

  async function incarca(id = null) {
    const g = ++generatie.current
    setLoading(true)
    try {
      const rs = rezultat(await supabase.from('ofertare_pf_pachete').select('*').match(parinte).order('versiune',{ ascending:false }).order('id',{ ascending:false }))
      const ales = rs.find(x => String(x.id) === String(id)) || rs[0] || null
      let vs = [], cs = []
      if (ales) {
        const rez = await Promise.all([
          supabase.from('ofertare_pf_valori').select(selectValori).eq('pachet_id',ales.id).order('id'),
          supabase.from('v_ofertare_pf_control').select('pachet_id,valoare_a_id,valoare_b_id,rol_valoare,domeniu_valoric,participant,tva_inclus,diferenta::text,verdict,grafic_are_activitati,grafic_pdf_in_manifest,grafic_verdict').eq('pachet_id',ales.id),
        ])
        ;[vs,cs] = rez.map(rezultat)
      }
      if (g !== generatie.current) return
      setPachete(rs); setP(ales); setValori(vs); setControl(cs); setDocs(ales?.documente_selectate || [])
      setV(nouaValoare()); setConfirmInchide(false)
      if (ales) setAntet({ ...ales, data_depunere:ales.data_depunere || '' })
    } finally { if (g === generatie.current) setLoading(false) }
  }
  useEffect(() => {
    let live = true
    ;(async () => {
      const auth = await supabase.auth.getUser(); if (auth.error) throw auth.error
      if (!live) return
      setUser(auth.data.user)
      if (licitatieId != null) {
        const general = rezultat(await supabase.rpc('fn_are_acces_ofertare'))
        if (!live) return
        setAreRegistru(general === true)
        if (general) {
          const rs = rezultat(await supabase.from('ofertare_formulare_registru').select('id,cod,denumire,fisier_path,fisier_hash,stare_depunere').eq('licitatie_id',licitatieId).order('id'))
          if (!live) return
          setRegistru(rs)
        }
      }
      await incarca()
    })().catch(e => { if (live) { setErr(textEroare(e)); setLoading(false) } })
    return () => { live = false; generatie.current++ }
  }, [licitatieId,proiectId])

  async function executa(fn) {
    setBusy(true); setErr(null)
    try { await fn() } catch (e) { setErr(textEroare(e)) } finally { setBusy(false) }
  }
  async function scrieAntet(payload) {
    const rs = rezultat(await supabase.from('ofertare_pf_pachete').update(payload).eq('id',p.id).eq('updated_at',p.updated_at).select('id'))
    if (rs.length !== 1) throw new Error('Versiunea s-a schimbat sau accesul a fost retras. Reîncarcă înainte de salvare.')
    await incarca(p.id)
  }
  async function salveazaValoare() {
    const [tip,...rest] = v.sursa.split(':'); const sursaId = rest.join(':')
    const payload = { pachet_id:p.id, rol_valoare:v.rol_valoare, domeniu_valoric:v.domeniu_valoric, participant:v.participant || null,
      valoare:v.valoare, tva_inclus:v.tva_inclus, cota_pct:v.cota_pct || null, baza_text:v.baza_text || null,
      sursa_registru_id:tip === 'r' ? sursaId : null, sursa_externa_cheie:tip === 'e' ? sursaId : null,
      localizare:v.localizare, nota:v.nota || null, confirmat_de:v.confirm ? user.id : null, confirmat_la:v.confirm ? new Date().toISOString() : null }
    const erori = valideazaValoare(payload); if (erori.length) throw new Error(erori.join(' · '))
    payload.valoare = dinBani(bani(payload.valoare)); if (payload.cota_pct) payload.cota_pct = payload.cota_pct.replace(',','.')
    const q = v.id ? supabase.from('ofertare_pf_valori').update(payload).eq('id',v.id).eq('pachet_id',p.id) : supabase.from('ofertare_pf_valori').insert(payload)
    const rs = rezultat(await q.select('id')); if (rs.length !== 1) throw new Error('Valoarea nu a fost salvată. Reîncarcă dosarul.')
    await incarca(p.id)
  }
  const campAntet = (k,label) => <Camp label={label}><input style={S.input} value={antet[k] || ''} onChange={e => setAntet({ ...antet,[k]:e.target.value })} /></Camp>
  const campV = (k,label) => <Camp label={label}><input style={S.input} value={v[k] ?? ''} onChange={e => setV({ ...v,[k]:e.target.value,confirm:false })} /></Camp>
  const docSchimbat = p && JSON.stringify(docs) !== JSON.stringify(p.documente_selectate)
  const etichetaSursa = id => {
    const x = valori.find(row => String(row.id) === String(id))
    if (!x) return 'termen lipsă'
    const d = (p?.manifest || docs).find(row => x.sursa_registru_id != null ? String(row.registru_id) === String(x.sursa_registru_id) : row.cheie != null && row.cheie === x.sursa_externa_cheie)
    const r = registru.find(row => String(row.id) === String(x.sursa_registru_id))
    return `${d?.denumire || r?.denumire || x.sursa_externa_cheie || (x.sursa_registru_id != null ? `Registru #${x.sursa_registru_id}` : 'fără sursă')} · ${x.localizare}`
  }

  return <section style={{ color:G.text }} aria-label="Propunere financiară">
    {err && <p role="alert" style={{ color:G.red,whiteSpace:'pre-wrap' }}>{err}</p>}
    <div style={{ display:'flex',gap:8,marginBottom:12 }}><button style={S.btn} disabled={busy || loading} onClick={() => executa(() => incarca(p?.id))}>Reîncarcă</button>{loading && <span>Se încarcă dosarul…</span>}</div>
    <fieldset disabled={busy || loading} style={{ border:0,padding:0,minWidth:0 }}>
      <div style={S.card}>
        <h3 style={{ marginTop:0 }}>Versiuni</h3>
        {!pachete.length && <p>Nu există încă un dosar PF pentru acest {licitatieId != null ? 'anunț' : 'proiect'}.</p>}
        <div style={{ display:'flex',gap:8,flexWrap:'wrap' }}>{pachete.map(x => <button key={x.id} style={{ ...S.btn,borderColor:p?.id === x.id ? G.blue : G.border }} onClick={() => executa(() => incarca(x.id))}>
          V{x.versiune} · {x.eticheta} · {ROLURI_OFERTA[x.rol_oferta]} · {INSTRUMENTE[x.instrument]} · {x.stare}
        </button>)}</div>
      </div>
      {poateScrie && <details style={S.card} open={!pachete.length}>
        <summary>Dosar inițial pentru un rol nou</summary>
        <div style={{ ...S.grid,marginTop:10 }}>
          <Camp label="Rol ofertă"><Optiuni valori={ROLURI_OFERTA} value={initial.rol_oferta} onChange={x => setInitial({ ...initial,rol_oferta:x })} /></Camp>
          <Camp label="Eticheta versiunii"><input style={S.input} value={initial.eticheta} onChange={e => setInitial({ ...initial,eticheta:e.target.value })} /></Camp>
          <Camp label="Instrument"><Optiuni valori={INSTRUMENTE} value={initial.instrument} onChange={x => setInitial({ ...initial,instrument:x })} /></Camp>
          <Camp label="Monedă"><Optiuni valori={{ RON:'RON',EUR:'EUR' }} value={initial.moneda} onChange={x => setInitial({ ...initial,moneda:x })} /></Camp>
        </div>
        <button style={S.btn} onClick={() => executa(async () => {
          if (pachete.some(x => x.rol_oferta === initial.rol_oferta)) throw new Error('Rolul are deja versiuni. Folosește draftul sau Versiune nouă din curentul închis.')
          const x = rezultat(await supabase.from('ofertare_pf_pachete').insert({ ...parinte,versiune:1,...initial }).select('id').single()); await incarca(x.id)
        })}>Creează draft</button>
      </details>}
      {p && <>
        <div style={S.card}><h3>V{p.versiune} · {p.eticheta} · {p.moneda} · {p.stare}</h3>
          {draft ? <><div style={S.grid}>{campAntet('eticheta','Etichetă')}
            <Camp label="Instrument"><Optiuni valori={INSTRUMENTE} value={antet.instrument} onChange={x => setAntet({ ...antet,instrument:x })} /></Camp>
            <Camp label="Monedă"><Optiuni valori={{ RON:'RON',EUR:'EUR' }} value={antet.moneda} onChange={x => setAntet({ ...antet,moneda:x })} /></Camp>
            {campAntet('instrument_dovada','Dovada instrumentului')}{campAntet('data_depunere','Depunere ISO 8601 cu fus orar, dacă este cunoscută')}
            {campAntet('dovada_depunere','Dovada depunerii')}{campAntet('nas_folder','Folder NAS — numai proveniență')}
          </div><button style={S.btn} onClick={() => executa(() => {
            if (antet.data_depunere && !/(Z|[+-]\d{2}:\d{2})$/.test(antet.data_depunere)) throw new Error('Data depunerii cere fus orar explicit')
            return scrieAntet({ eticheta:antet.eticheta,instrument:antet.instrument,moneda:antet.moneda,instrument_dovada:antet.instrument_dovada || null,
              data_depunere:antet.data_depunere || null,dovada_depunere:antet.dovada_depunere || null,nas_folder:antet.nas_folder || null })
          })}>Salvează antetul</button></> : <><p>Închis de {p.inchis_de} la {p.inchis_la}. Orice corectură cere o versiune nouă.</p>
            <p>Instrument: {INSTRUMENTE[p.instrument]} · dovadă: {p.instrument_dovada || '—'}<br />Depunere: {p.data_depunere || '—'} · dovadă: {p.dovada_depunere || '—'}<br />Folder NAS (proveniență): {p.nas_folder || '—'}</p></>}
        </div>
        <div style={S.card}><h3>Documente selectate explicit</h3>
          {draft && <>
            {licitatieId != null && !areRegistru && <p>Registrul cere și acces general la Ofertare. Dreptul PF nu îl acordă automat.</p>}
            {proiectId != null && <p>Dosar istoric: selectează documente externe. Nu se creează licitații istorice.</p>}
            {registru.map(r => <label key={r.id} style={{ display:'block',marginBottom:6 }}><input type="checkbox" checked={docs.some(d => String(d.registru_id) === String(r.id))} onChange={e => setDocs(e.target.checked ? [...docs,{ registru_id:r.id,fisier_path:r.fisier_path }] : docs.filter(d => String(d.registru_id) !== String(r.id)))} /> {r.cod} · {r.denumire} · {r.fisier_path || 'fără fișier'}</label>)}
            <details><summary>Adaugă document extern</summary><div style={S.grid}>{Object.entries({ cheie:'Cheie document extern',cod:'Cod formular',denumire:'Denumire',fisier_path:'Cale fișier',provenienta:'Proveniență',stare_depunere:'Stare depunere' }).map(([k,label]) => <Camp key={k} label={label}><input style={S.input} value={doc[k]} onChange={e => setDoc({ ...doc,[k]:e.target.value })} /></Camp>)}</div>
              <button style={S.btn} onClick={() => executa(async () => {
                if (!doc.cheie.trim() || !doc.denumire.trim() || !doc.provenienta.trim()) throw new Error('Cheia, denumirea și proveniența sunt obligatorii')
                if (docs.some(d => d.cheie === doc.cheie.trim())) throw new Error('Cheie externă duplicată')
                setDocs([...docs,{ ...doc,cheie:doc.cheie.trim(),registru_id:null }]); setDoc(nouDocument())
              })}>Adaugă în selecție</button>
            </details>
          </>}
          {(draft ? docs : p.manifest || []).map((d,i) => <div key={cheieDoc(d)} style={{ borderTop:`1px solid ${G.border}`,padding:'10px 0' }}>
            <strong>{d.denumire || registru.find(r => String(r.id) === String(d.registru_id))?.denumire || `Registru #${d.registru_id}`}</strong> · {d.fisier_path || 'cale nespecificată'}
            {d.hash_valoare && <p style={{ overflowWrap:'anywhere' }}>Hash {d.hash_sursa === 'client' ? 'calculat în browser (client)' : 'cu proveniență necunoscută'}: {d.hash_valoare}<br />Confirmat de {d.hash_confirmat_de || 'nimeni'} · {d.hash_confirmat_la || '—'}</p>}
            {draft && <div><Camp label="Fișier local pentru calcul SHA-256 client (nu se încarcă pe server)"><input type="file" onChange={e => {
              const f = e.target.files?.[0]; if (!f) return
              executa(async () => { const h = await hashFisierClient(f); setDocs(xs => xs.map((x,j) => j === i ? { ...x,...h } : x)) })
            }} /></Camp>
              {d.hash_sursa === 'client' && <label><input type="checkbox" checked={!!d.hash_confirmat_de} onChange={e => setDocs(xs => xs.map((x,j) => j === i ? { ...x,hash_confirmat_de:e.target.checked ? user.id : null,hash_confirmat_la:e.target.checked ? new Date().toISOString() : null } : x))} /> Confirm că hash-ul este al acestui document</label>}
              <button style={S.btn} onClick={() => setDocs(xs => xs.filter((_,j) => j !== i))}>Scoate din selecție</button>
            </div>}
          </div>)}
          {draft && <button style={S.btn} onClick={() => executa(() => scrieAntet({ documente_selectate:docs }))}>Salvează selecția documentelor</button>}
          {docSchimbat && <p style={{ color:G.yellow }}>Selecția are modificări nesalvate.</p>}
          {p.manifest_hash && <p style={{ overflowWrap:'anywhere' }}>SHA-256 manifest canonic, calculat pe server: {p.manifest_hash}</p>}
        </div>
        <div style={S.card}><h3>Valori declarate</h3>
          {!valori.length && <p>Nicio valoare declarată. Control: neverificat.</p>}
          <div style={{ overflowX:'auto' }}><table style={{ width:'100%',fontSize:12 }}><thead><tr>{['Rol / domeniu','Participant','Valoare / TVA','Sursă / localizare','Confirmare',''].map((x,i) => <th key={i} style={{ textAlign:'left',padding:6 }}>{x}</th>)}</tr></thead>
            <tbody>{valori.map(x => <tr key={x.id}><td>{ROLURI[x.rol_valoare]} / {DOMENII[x.domeniu_valoric]}</td><td>{x.participant || '—'}</td><td>{x.valoare} {p.moneda} · TVA {x.tva_inclus ? 'inclus' : 'exclus'}{x.rol_valoare === 'cota' && ` · ${x.cota_pct}% · ${x.baza_text || 'bază nespecificată'}`}</td><td>{x.sursa_registru_id ? `Registru #${x.sursa_registru_id}` : x.sursa_externa_cheie || 'fără sursă'} · {x.localizare}</td><td>{x.confirmat_de ? `${x.confirmat_de} · ${x.confirmat_la}` : 'neconfirmată'}</td><td>{draft && <>
              <button style={S.btn} onClick={() => setV({ ...x,cota_pct:x.cota_pct || '',participant:x.participant || '',baza_text:x.baza_text || '',nota:x.nota || '',sursa:x.sursa_registru_id != null ? `r:${x.sursa_registru_id}` : x.sursa_externa_cheie != null ? `e:${x.sursa_externa_cheie}` : '',confirm:false })}>Editează / confirmă</button>
              <button style={S.btn} onClick={() => executa(async () => { const rs = rezultat(await supabase.from('ofertare_pf_valori').delete().eq('id',x.id).eq('pachet_id',p.id).select('id')); if (rs.length !== 1) throw new Error('Valoarea nu a fost ștearsă'); await incarca(p.id) })}>Șterge</button>
            </>}</td></tr>)}</tbody></table></div>
          {draft && <><h4>{v.id ? 'Editează valoarea' : 'Adaugă valoare'}</h4><div style={S.grid}>
            <Camp label="Rol"><Optiuni valori={ROLURI} value={v.rol_valoare} onChange={x => setV({ ...v,rol_valoare:x,confirm:false })} /></Camp>
            <Camp label="Domeniu"><Optiuni valori={DOMENII} value={v.domeniu_valoric} onChange={x => setV({ ...v,domeniu_valoric:x,confirm:false })} /></Camp>
            {campV('participant','Participant')}{campV('valoare',`Valoare ${p.moneda} (inclusiv negativă)`)}{campV('cota_pct','Procent cotă')}{campV('baza_text','Baza procentului, citată')}
            <Camp label="Sursă selectată"><select style={S.input} value={v.sursa} onChange={e => setV({ ...v,sursa:e.target.value,confirm:false })}><option value="">Fără sursă — draft</option>{(p.documente_selectate || []).map(d => <option key={cheieDoc(d)} value={cheieDoc(d)}>{d.denumire || `Registru #${d.registru_id}`}</option>)}</select></Camp>
            {campV('localizare','Pagină / foaie / celulă')}{campV('nota','Notă')}
          </div><label><input type="checkbox" checked={v.tva_inclus} onChange={e => setV({ ...v,tva_inclus:e.target.checked,confirm:false })} /> TVA inclus</label>{' '}
            <label><input type="checkbox" checked={v.confirm} onChange={e => setV({ ...v,confirm:e.target.checked })} /> Confirm valoarea și sursa citată</label>
            <div><button style={S.btn} onClick={() => executa(salveazaValoare)}>Salvează valoarea</button><button style={S.btn} onClick={() => setV(nouaValoare())}>Golește editorul</button></div>
          </>}
        </div>
        <div style={S.card}><h3>Control la ban</h3>
          {control.map((x,i) => <p key={i}>{ROLURI[x.rol_valoare] || 'Fără valori'} / {DOMENII[x.domeniu_valoric] || '—'}{x.participant ? ` / ${x.participant}` : ''} · {etichetaSursa(x.valoare_a_id)} ↔ {etichetaSursa(x.valoare_b_id)}: <strong>{x.verdict}</strong>{x.diferenta != null && ` (${x.diferenta} ${p.moneda})`}</p>)}
          <p>Activități în graficul {licitatieId != null ? 'licitației' : 'proiectului'} (Grafic lucrare): {control[0]?.grafic_are_activitati == null ? 'neverificat' : control[0].grafic_are_activitati ? 'da' : 'nu'}. PDF grafic în manifest: neverificat (documentul nu are încă un marcaj de rol). Graficul este informativ, fără verdict pe sumă.</p>
        </div>
        {draft && <div style={S.card}><button style={S.btn} disabled={!!docSchimbat} onClick={() => setConfirmInchide(true)}>Închide versiunea</button>
          {confirmInchide && <div role="alertdialog" aria-label="Confirmă închiderea"><p>Se îngheață antetul, valorile și manifestul documentelor salvate. Curentul anterior devine înlocuit. Corecturile vor cere o versiune nouă.</p>
            <button style={S.btn} onClick={() => executa(async () => { rezultat(await supabase.rpc('fn_ofertare_pf_inchide',{ p_pachet:p.id })); await incarca(p.id) })}>Confirm închiderea</button>
            <button style={S.btn} onClick={() => setConfirmInchide(false)}>Renunță</button></div>}
        </div>}
        {p.stare === 'inchis' && poateScrie && <div style={S.card}><Camp label="Eticheta noii versiuni"><input style={S.input} value={etichetaNoua} onChange={e => setEtichetaNoua(e.target.value)} /></Camp><button style={S.btn} onClick={() => executa(async () => {
          const id = rezultat(await supabase.rpc('fn_ofertare_pf_versiune_noua',{ p_pachet:p.id,p_eticheta:etichetaNoua })); setEtichetaNoua(''); await incarca(id)
        })}>Versiune nouă</button><p>Valorile se copiază fără confirmări. Versiunea închisă rămâne curentă până la închiderea draftului.</p></div>}
      </>}
    </fieldset>
  </section>
}
