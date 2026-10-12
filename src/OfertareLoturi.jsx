// ════════════════════════════════════════════════════════════════
// OfertareLoturi.jsx — MVP loturi pe licitație (migrarea 20261024b, contractul de mai jos).
//
// Decizia Răzvan 12.10.2026: licitația NEINIȚIALIZATĂ e BLOCATĂ la orice procesare plătită — fără excepții
// (după review-ul Copilot nici fișa de date nu mai trece automat). Un click o deblochează: „Fără loturi”
// sau „Are loturi” + lista de loturi. La „Are loturi”, documentele se triază manual: comun / lot X / resetează.
//
// Contract (doar citire + RPC, nicio scriere directă — triggerele din BD o refuză oricum):
//   citire:  fn_ofertare_eligibilitate(p_licitatie_id) → (document_id, eligibil, motiv)
//            v_ofertare_loturi_triere → (documente, procesabile, in_afara_loturilor, de_triat, blocate_alt_motiv)
//   scriere: fn_ofertare_licitatie_loturi_seteaza(p_licitatie_id, p_stare, p_loturi jsonb)
//            fn_ofertare_documente_lot_seteaza(p_document_ids bigint[], p_stare, p_loturi int[], p_nota)
//   drept:   owner / responsabilul licitației / admin Ofertare — altfel RPC-ul dă 42501 și mesajul se AFIȘEAZĂ.
// Conservator: nimic automat, nicio sugestie AI, nicio regulă pe nume. Eticheta „nume: LOT n” e doar informativă.
// Serverul e poarta reală (fail-closed); UI-ul doar explică și nu pornește ce știe că va fi refuzat.
// ════════════════════════════════════════════════════════════════
import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from './lib/supabase.js'

const G = {
  bg:'#0D1117', surface:'#161B22', card:'#1C2128', border:'#30363D', border2:'#21262D',
  text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  ofertare:'#3FB6E2', green:'#3FB950', blue:'#58A6FF', orange:'#F0883E',
  yellow:'#E3B341', red:'#F85149', purple:'#A371F7', teal:'#2DD4BF',
}
const S = {
  input: { boxSizing:'border-box', background:G.bg, border:`1px solid ${G.border2}`, borderRadius:6, padding:'6px 9px', color:G.text, fontSize:12.5, outline:'none' },
  btn: { padding:'6px 11px', background:G.surface, color:G.text, border:`1px solid ${G.border2}`, borderRadius:7, cursor:'pointer', fontSize:12 },
  btnP: { padding:'7px 13px', background:G.ofertare, color:'#0D1117', border:'none', borderRadius:7, cursor:'pointer', fontSize:12.5, fontWeight:700 },
  card: { background:G.card, border:`1px solid ${G.border}`, borderRadius:10 },
  chip: (on, c = G.ofertare) => ({ padding:'4px 10px', borderRadius:14, fontSize:11.5, fontWeight:700, cursor:'pointer', whiteSpace:'nowrap',
    background: on ? c + '22' : 'transparent', color: on ? c : G.muted, border:`1px solid ${on ? c + '88' : G.border2}` }),
  badge: c => ({ fontSize:10.5, fontWeight:700, color:c, border:`1px solid ${c}55`, borderRadius:6, padding:'1px 6px', whiteSpace:'nowrap' }),
}

export const STARE_LOTURI = {
  neinitializat: ['⛔ loturi nealese', G.orange],
  fara_loturi:   ['✅ fără loturi', G.green],
  are_loturi:    ['🧩 are loturi', G.ofertare],
}
// motivele porții (fn_ofertare_eligibilitate): [etichetă, culoare]
export const MOTIV_LOT = {
  fara_loturi:           ['✓ fără loturi', G.green],
  comun:                 ['✓ comun', G.green],
  lot_participam:        ['✓ lot participăm', G.green],
  loturi_neinitializate: ['⛔ loturi nealese', G.orange],
  nicio_participare:     ['⛔ niciun lot bifat', G.orange],
  de_triat:              ['⏳ de triat', G.yellow],
  in_afara_loturilor:    ['— în afara loturilor', G.dim],
  stare_invalida:        ['⚠ stare invalidă', G.red],
}
const MESAJ_MOTIV = {
  loturi_neinitializate: 'loturile licitației nu sunt alese (tab 🧩 Loturi: „Fără loturi” sau „Are loturi”)',
  nicio_participare: 'nu e bifat niciun lot la care participăm',
  de_triat: 'documentul nu e triat pe lot (comun / lot)',
  in_afara_loturilor: 'documentul e doar pe loturi la care nu participăm',
  stare_invalida: 'stare de lot invalidă',
  eroare_poarta: 'verificarea pe loturi nu a răspuns — reîncarcă pagina',
  verificare_in_curs: 'se verifică loturile…',
}
export const mesajLot = motiv => '🧩 Blocat pe loturi: ' + (MESAJ_MOTIV[motiv] || motiv)

// Obiectele de loturi lipsesc din BD (migrarea neaplicată) → UI-ul se comportă ca înainte, fără blocaje.
const lipsaInBd = e => ['PGRST202', 'PGRST205', 'PGRST200', '42883', '42P01', '42703'].includes(e?.code)
export function mesajEroareLoturi(e) {
  if (!e) return ''
  const m = e.message || String(e)
  if (e.code === '42501') return `🔒 ${m}`
  if (e.code === '23503') return '⚠️ Un lot scos din listă are documente alocate — resetează-le întâi (filtrul „Pe lot X” → Resetează), apoi salvează lista.'
  if (lipsaInBd(e)) return '⚠️ Loturile nu există încă în baza de date (migrarea 20261024b neaplicată).'
  return `⚠️ ${m}`
}

// „1.234.567,89” / „1234567.89” / „1 234 567” → număr; gol → null; text greșit → NaN
export function parseValoare(s) {
  let t = String(s ?? '').replace(/\s|lei|ron/gi, '')
  if (!t) return null
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.')
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '')
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? n : NaN
}
// DOAR informativ: numărul lotului din numele fișierului („LOT_2”, „lotul 3”, „Lot nr. 4”). Nu setează nimic.
export function lotDinNume(nume) {
  const m = String(nume || '').split('/').pop().match(/(?:^|[^a-zăâîșț])lot(?:ul)?[\s._-]*(?:nr\.?[\s._-]*)?0*(\d{1,3})(?!\d)/i)
  return m ? Number(m[1]) : null
}
export const bucati = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n))

// PostgREST taie la 1000 de rânduri — citim pe pagini (Botoșani are 507 documente, dar nu presupunem).
async function toatePaginile(fac) {
  const out = []
  for (let a = 0; a < 100000; a += 1000) {
    const { data, error } = await fac(a, a + 999)
    if (error) return { data: null, error }
    out.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return { data: out, error: null }
}

// Eligibilitatea pe loturi pentru O licitație: o singură interogare (+ numărătoarea din view), nu una per document.
// blocat(docId) → motivul blocării sau null. Inactiv (migrare lipsă / eroare) → null peste tot: serverul decide.
export function useEligibilitateLoturi(licitatieId) {
  const [st, setSt] = useState({ incarcat:false, lipsa:false, eroare:null, stare:null, triere:null, harta:new Map() })
  const [tick, setTick] = useState(0)
  const reincarca = useCallback(() => setTick(t => t + 1), [])
  useEffect(() => {
    if (!licitatieId) return
    let viu = true
    ;(async () => {
      const [rE, rV] = await Promise.all([
        toatePaginile((a, b) => supabase.rpc('fn_ofertare_eligibilitate', { p_licitatie_id: licitatieId }).order('document_id').range(a, b)),
        supabase.from('v_ofertare_loturi_triere').select('*').eq('licitatie_id', licitatieId).maybeSingle(),
      ])
      if (!viu) return
      const err = rE.error || rV.error
      if (err) { setSt(s => ({ ...s, incarcat:true, lipsa:lipsaInBd(err), eroare:lipsaInBd(err) ? null : (err.message || String(err)) })); return }
      setSt({ incarcat:true, lipsa:false, eroare:null, stare:rV.data?.stare_loturi || null, triere:rV.data || null,
        harta:new Map((rE.data || []).map(r => [Number(r.document_id), { eligibil:r.eligibil === true, motiv:String(r.motiv) }])) })
    })().catch(e => { if (viu) setSt(s => ({ ...s, incarcat:true, eroare:e?.message || String(e) })) })
    return () => { viu = false }
  }, [licitatieId, tick])
  const activ = st.incarcat && !st.lipsa && !st.eroare
  const blocat = useCallback(id => {
    // review Jakarinos P2 #9: nu „liber” cât poarta nu e citită / a căzut — motiv explicit; doar migrarea lipsă lasă serverul să decidă
    if (st.lipsa) return null
    if (st.eroare) return 'eroare_poarta'
    if (!st.incarcat) return 'verificare_in_curs'
    const e = st.harta.get(Number(id))
    if (e) return e.eligibil ? null : e.motiv
    // document apărut după ultima citire a porții: nou = necunoscut, deci starea licitației decide
    return st.stare === 'fara_loturi' ? null : st.stare === 'neinitializat' ? 'loturi_neinitializate' : 'de_triat'
  }, [activ, st])
  return { ...st, activ, blocat, reincarca }
}

// Banda din Documentație (și oriunde se pornește procesare plătită): explică de ce nu se citește.
export function BannerLoturi({ elig, onDeschide }) {
  if (elig?.eroare) return (
    <div style={{ fontSize:12, color:G.orange, marginBottom:8 }}>⚠️ Verificarea pe loturi nu a răspuns ({elig.eroare}) — serverul poate refuza procesarea plătită.</div>
  )
  if (!elig?.activ) return null
  const t = elig.triere || {}
  const btn = onDeschide && <button style={{ ...S.btn, padding:'4px 10px', fontSize:11.5, marginLeft:8 }} onClick={onDeschide}>🧩 Deschide Loturi</button>
  if (elig.stare === 'neinitializat') return (
    <div style={{ fontSize:12.5, color:G.orange, background:G.orange + '14', border:`1px solid ${G.orange}66`, borderRadius:8, padding:'8px 12px', marginBottom:8 }}>
      ⛔ <b>Procesarea plătită e blocată până alegi loturile</b> — niciun document nu se citește cu AI. Alege „Fără loturi” sau „Are loturi” în tab-ul 🧩 Loturi.{btn}
    </div>
  )
  const neproc = (t.documente || 0) - (t.procesabile || 0)
  if (!neproc) return null
  return (
    <div style={{ fontSize:12, color:G.yellow, background:G.yellow + '10', border:`1px solid ${G.yellow}55`, borderRadius:8, padding:'7px 12px', marginBottom:8 }}>
      🧩 {t.procesabile || 0} procesabile · {t.in_afara_loturilor || 0} în afara loturilor · {t.de_triat || 0} de triat · {t.blocate_alt_motiv || 0} blocate alt motiv — doar cele procesabile intră la citirea AI.{btn}
    </div>
  )
}

const PE_PAG = 100
const LOT_GOL = { nr:'', denumire:'', valoare:'', participam:false }

export default function OfertareLoturi({ licitatieId, onSchimbare = null }) {
  const elig = useEligibilitateLoturi(licitatieId)
  const [loturi, setLoturi] = useState(null)        // din BD
  const [draft, setDraft] = useState([])            // editorul
  const [editeaza, setEditeaza] = useState(false)
  const [nGen, setNGen] = useState('')
  const [docs, setDocs] = useState(null)
  const [docLot, setDocLot] = useState(() => new Map())   // document_id → [lot_nr]
  const [eroare, setEroare] = useState(null)
  const [msg, setMsg] = useState(null)              // { t, err }
  const [busy, setBusy] = useState(null)
  const [filtru, setFiltru] = useState(null)        // de_triat | comun | lot:N | in_afara | toate
  const [cauta, setCauta] = useState('')
  const [pag, setPag] = useState(0)
  const [sel, setSel] = useState(() => new Set())
  const [lotSel, setLotSel] = useState(() => new Set())
  const [nota, setNota] = useState('')

  const load = useCallback(async () => {
    if (!licitatieId) return
    const [rL, rD, rDL] = await Promise.all([
      supabase.from('ofertare_licitatie_loturi').select('nr, denumire, valoare, participam').eq('licitatie_id', licitatieId).order('nr'),
      toatePaginile((a, b) => supabase.from('ofertare_documente_atribuire').select('id, nume_original, tip, status_procesare, lot_stare, lot_nota, lot_setat_la')
        .eq('licitatie_id', licitatieId).order('id').range(a, b)),
      toatePaginile((a, b) => supabase.from('ofertare_document_loturi').select('document_id, lot_nr').eq('licitatie_id', licitatieId)
        .order('document_id').order('lot_nr').range(a, b)),
    ])
    const err = rL.error || rD.error || rDL.error
    if (err) { setEroare(mesajEroareLoturi(err)); setDocs(d => d || []); setLoturi(l => l || []); return }
    setEroare(null)
    setLoturi(rL.data || [])
    setDraft((rL.data || []).map(x => ({ nr:String(x.nr), denumire:x.denumire || '', valoare:x.valoare == null ? '' : String(x.valoare).replace('.', ','), participam:!!x.participam })))
    setDocs(rD.data || [])
    const m = new Map()
    for (const r of rDL.data || []) m.set(Number(r.document_id), [...(m.get(Number(r.document_id)) || []), r.lot_nr])
    setDocLot(m)
  }, [licitatieId])
  useEffect(() => { load() }, [load])
  const reincarcaTot = async () => { elig.reincarca(); await load(); onSchimbare?.() }

  const stare = elig.stare
  const t = elig.triere || {}
  const areLoturi = stare === 'are_loturi'
  const arataEditor = areLoturi || editeaza
  const faraParticipare = areLoturi && (loturi || []).length > 0 && !(loturi || []).some(x => x.participam)

  // ── setarea stării pe licitație ──
  const seteazaFara = async () => {
    if (!window.confirm('Licitația NU are loturi: toate documentele devin procesabile (citirea AI plătită se deblochează). Continui?')) return
    setBusy('salvez…'); setMsg(null)
    const { error } = await supabase.rpc('fn_ofertare_licitatie_loturi_seteaza', { p_licitatie_id: licitatieId, p_stare: 'fara_loturi', p_loturi: [] })
    setBusy(null)
    if (error) return setMsg({ t: mesajEroareLoturi(error), err: true })
    setEditeaza(false); setMsg({ t: '✅ Licitația e marcată „fără loturi”.' }); await reincarcaTot()
  }
  const salveazaLoturi = async () => {
    const out = [], vazute = new Set()
    for (const r of draft) {
      const nr = Number(String(r.nr).trim())
      if (!Number.isInteger(nr) || nr < 1 || nr > 999) return setMsg({ t: `⚠️ Număr de lot invalid: „${r.nr}” (1–999).`, err: true })
      if (vazute.has(nr)) return setMsg({ t: `⚠️ Lotul ${nr} apare de două ori.`, err: true })
      vazute.add(nr)
      const v = parseValoare(r.valoare)
      if (Number.isNaN(v)) return setMsg({ t: `⚠️ Valoare invalidă la lotul ${nr}: „${r.valoare}”.`, err: true })
      out.push({ nr, denumire: r.denumire.trim() || null, valoare: v, participam: !!r.participam })
    }
    if (!out.length) return setMsg({ t: '⚠️ „Are loturi” cere cel puțin un lot.', err: true })
    out.sort((a, b) => a.nr - b.nr)
    setBusy('salvez loturile…'); setMsg(null)
    const { error } = await supabase.rpc('fn_ofertare_licitatie_loturi_seteaza', { p_licitatie_id: licitatieId, p_stare: 'are_loturi', p_loturi: out })
    setBusy(null)
    if (error) return setMsg({ t: mesajEroareLoturi(error), err: true })
    setEditeaza(false)
    setMsg({ t: `✅ ${out.length} loturi salvate${out.some(x => x.participam) ? '' : ' — ⚠️ niciun lot bifat la „participăm”: nimic nu e procesabil'}.` })
    if (!filtru) setFiltru('de_triat')
    await reincarcaTot()
  }
  const genereaza = () => {
    const n = Number(nGen)
    if (!Number.isInteger(n) || n < 1 || n > 200) return setMsg({ t: '⚠️ Scrie câte loturi are licitația (1–200).', err: true })
    const exist = new Map(draft.map(r => [String(r.nr).trim(), r]))
    setDraft(Array.from({ length: n }, (_, i) => exist.get(String(i + 1)) || { ...LOT_GOL, nr: String(i + 1) }))
    setMsg(null)
  }
  const anuleazaEditor = () => {
    setDraft((loturi || []).map(x => ({ nr:String(x.nr), denumire:x.denumire || '', valoare:x.valoare == null ? '' : String(x.valoare).replace('.', ','), participam:!!x.participam })))
    setEditeaza(false); setMsg(null)
  }
  const draftModificat = useMemo(() => {
    const a = (loturi || []).map(x => [x.nr, x.denumire || '', x.valoare == null ? null : Number(x.valoare), !!x.participam])
    const b = draft.map(r => [Number(r.nr), r.denumire.trim(), parseValoare(r.valoare), !!r.participam])
    return JSON.stringify(a) !== JSON.stringify(b)
  }, [loturi, draft])

  // ── lista documentelor ──
  const contoare = useMemo(() => {
    const c = { de_triat:0, comun:0, in_afara:0, toate:(docs || []).length, lot:new Map() }
    for (const d of docs || []) {
      if (d.lot_stare === 'necunoscut') c.de_triat++
      if (d.lot_stare === 'comun') c.comun++
      if (elig.harta.get(d.id)?.motiv === 'in_afara_loturilor') c.in_afara++
      for (const nr of docLot.get(d.id) || []) c.lot.set(nr, (c.lot.get(nr) || 0) + 1)
    }
    return c
  }, [docs, docLot, elig.harta])
  const filtruEf = filtru || (areLoturi && contoare.de_triat ? 'de_triat' : 'toate')
  const filtrate = useMemo(() => {
    const q = cauta.trim().toLowerCase()
    return (docs || []).filter(d => {
      if (q && !String(d.nume_original || '').toLowerCase().includes(q)) return false
      if (filtruEf === 'de_triat') return d.lot_stare === 'necunoscut'
      if (filtruEf === 'comun') return d.lot_stare === 'comun'
      if (filtruEf === 'in_afara') return elig.harta.get(d.id)?.motiv === 'in_afara_loturilor'
      if (filtruEf.startsWith('lot:')) return (docLot.get(d.id) || []).includes(Number(filtruEf.slice(4)))
      return true
    })
  }, [docs, docLot, elig.harta, filtruEf, cauta])
  const nPag = Math.max(1, Math.ceil(filtrate.length / PE_PAG))
  const pagEf = Math.min(pag, nPag - 1)
  const pagina = filtrate.slice(pagEf * PE_PAG, pagEf * PE_PAG + PE_PAG)
  useEffect(() => { setPag(0) }, [filtruEf, cauta])
  const toataPagina = pagina.length > 0 && pagina.every(d => sel.has(d.id))
  const comutaPagina = () => setSel(s => { const n = new Set(s); pagina.forEach(d => toataPagina ? n.delete(d.id) : n.add(d.id)); return n })
  const comuta = id => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  const aplica = async (st, loturiArr = []) => {
    const ids = [...sel]
    if (!ids.length) return
    if (st === 'alocat' && !loturiArr.length) return setMsg({ t: '⚠️ Alege cel puțin un lot (bifele de lângă „Lot …”).', err: true })
    if (st === 'necunoscut' && !window.confirm(`Resetez ${ids.length} documente la „de triat”? (alocarea și nota se șterg; istoricul rămâne în jurnal)`)) return
    setMsg(null)
    let gata = 0
    for (const b of bucati(ids, 500)) {
      setBusy(`aplic ${Math.min(gata + b.length, ids.length)}/${ids.length}…`)
      const { data, error } = await supabase.rpc('fn_ofertare_documente_lot_seteaza',
        { p_document_ids: b, p_stare: st, p_loturi: st === 'alocat' ? loturiArr : [], p_nota: st === 'necunoscut' ? null : (nota.trim() || null) })
      if (error) {
        setMsg({ t: mesajEroareLoturi(error) + (gata ? ` (s-au aplicat ${gata} din ${ids.length} înainte de eroare)` : ''), err: true })
        break
      }
      gata += data?.documente ?? b.length
    }
    setBusy(null)
    if (gata) {
      const et = st === 'comun' ? 'comune' : st === 'alocat' ? `pe lot ${loturiArr.join(', ')}` : 'resetate (de triat)'
      setMsg(m => m?.err ? m : { t: `✅ ${gata} documente ${et}.` })
      setSel(new Set()); setNota('')
    }
    await reincarcaTot()
  }

  if (!licitatieId) return null
  const [stEt, stCol] = STARE_LOTURI[stare] || ['…', G.muted]
  const inp = (w, extra = {}) => ({ ...S.input, width:w, ...extra })

  return (
    <div style={{ marginTop:4, display:'flex', flexDirection:'column', gap:12 }}>
      {/* ── banda de sus ── */}
      <div style={{ ...S.card, padding:'12px 14px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
          <div style={{ fontSize:14, fontWeight:800 }}>🧩 Loturile licitației</div>
          {elig.activ && <span style={S.badge(stCol)}>{stEt}</span>}
          <div style={{ marginLeft:'auto', display:'flex', gap:8, flexWrap:'wrap' }}>
            <button style={{ ...S.btn, ...(stare === 'fara_loturi' ? { color:G.green, borderColor:G.green + '88' } : {}) }} disabled={!!busy || !elig.activ}
              onClick={seteazaFara} title="Licitația nu e împărțită pe loturi — toate documentele devin procesabile">Fără loturi</button>
            <button style={{ ...S.btn, ...(areLoturi ? { color:G.ofertare, borderColor:G.ofertare + '88' } : {}) }} disabled={!!busy || !elig.activ}
              onClick={() => { setEditeaza(true); setMsg(null) }} title="Definește loturile și bifează la care participăm">Are loturi</button>
          </div>
        </div>
        {elig.lipsa && <div style={{ fontSize:12, color:G.dim, marginTop:8 }}>Loturile nu există încă în baza de date (migrarea 20261024b neaplicată) — nimic de setat aici deocamdată.</div>}
        {elig.eroare && <div style={{ fontSize:12, color:G.red, marginTop:8 }}>⚠️ Nu pot citi poarta pe loturi: {elig.eroare}</div>}
        {elig.activ && stare === 'neinitializat' && (
          <div style={{ fontSize:12.5, color:G.orange, background:G.orange + '14', border:`1px solid ${G.orange}66`, borderRadius:8, padding:'8px 12px', marginTop:10 }}>
            ⛔ <b>Procesarea plătită e blocată până alegi loturile.</b> Niciun document nu se citește cu AI. Un click deblochează: „Fără loturi” sau „Are loturi” + lista.
          </div>
        )}
        {elig.activ && (
          <div style={{ display:'flex', gap:14, flexWrap:'wrap', fontSize:12.5, marginTop:10 }}>
            <span><b style={{ color:G.green }}>{t.procesabile || 0}</b> procesabile</span>
            <span><b style={{ color:G.dim }}>{t.in_afara_loturilor || 0}</b> în afara loturilor</span>
            <span><b style={{ color:G.yellow }}>{t.de_triat || 0}</b> de triat</span>
            <span><b style={{ color:G.orange }}>{t.blocate_alt_motiv || 0}</b> blocate alt motiv</span>
            <span style={{ color:G.dim }}>din {t.documente || 0} documente</span>
          </div>
        )}
        {elig.activ && (t.de_triat || 0) > 0 && (
          <div style={{ fontSize:12, color:G.yellow, marginTop:8 }}>⚠️ {t.de_triat} documente încă netriate — oferta nu se consideră completă cât rămân documente de triat.</div>
        )}
        {faraParticipare && <div style={{ fontSize:12, color:G.orange, marginTop:6 }}>⚠️ Nu e bifat niciun lot la „participăm” — nimic nu e procesabil.</div>}
        {busy && <div style={{ fontSize:12, color:G.blue, marginTop:8 }}>⏳ {busy}</div>}
        {msg && <div style={{ fontSize:12.5, color: msg.err ? G.red : G.green, marginTop:8 }}>{msg.t}</div>}
        {eroare && <div style={{ fontSize:12.5, color:G.red, marginTop:8 }}>{eroare}</div>}
      </div>

      {/* ── editorul de loturi ── */}
      {elig.activ && arataEditor && (
        <div style={{ ...S.card, padding:'12px 14px' }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', marginBottom:8 }}>
            <div style={{ fontSize:13, fontWeight:800 }}>Lista loturilor</div>
            <span style={{ fontSize:11.5, color:G.dim }}>(din fișa de date / anunț — doar ce bifezi la „participăm” se procesează)</span>
            <div style={{ marginLeft:'auto', display:'flex', gap:6, alignItems:'center' }}>
              <span style={{ fontSize:12, color:G.muted }}>Loturi 1…</span>
              <input style={inp(56)} value={nGen} onChange={e => setNGen(e.target.value.replace(/\D/g, ''))} onKeyDown={e => e.key === 'Enter' && genereaza()} placeholder="N" />
              <button style={S.btn} onClick={genereaza} disabled={!!busy}>Generează</button>
            </div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'70px 1fr 150px 90px 30px', gap:6, alignItems:'center', fontSize:11, color:G.muted, fontWeight:700, textTransform:'uppercase', marginBottom:4 }}>
            <span>Nr.</span><span>Denumire</span><span>Valoare (lei)</span><span>Participăm</span><span />
          </div>
          {draft.map((r, i) => {
            const upd = p => setDraft(d => d.map((x, j) => j === i ? { ...x, ...p } : x))
            return (
              <div key={i} style={{ display:'grid', gridTemplateColumns:'70px 1fr 150px 90px 30px', gap:6, alignItems:'center', marginBottom:4 }}>
                <input style={inp('100%')} value={r.nr} onChange={e => upd({ nr: e.target.value.replace(/\D/g, '') })} />
                <input style={inp('100%')} value={r.denumire} onChange={e => upd({ denumire: e.target.value })} placeholder="ex. Extindere rețea gaze — localitatea X" />
                <input style={inp('100%', { textAlign:'right' })} value={r.valoare} onChange={e => upd({ valoare: e.target.value })} placeholder="—" />
                <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:12.5, cursor:'pointer', color: r.participam ? G.green : G.muted }}>
                  <input type="checkbox" checked={r.participam} onChange={e => upd({ participam: e.target.checked })} /> {r.participam ? 'da' : 'nu'}
                </label>
                <button style={{ ...S.btn, padding:'3px 7px', color:G.red }} title="Scoate lotul din listă (refuzat dacă are documente alocate)"
                  onClick={() => setDraft(d => d.filter((_, j) => j !== i))}>✕</button>
              </div>
            )
          })}
          {!draft.length && <div style={{ fontSize:12, color:G.dim, margin:'6px 0' }}>Niciun lot încă — scrie câte loturi are licitația și apasă „Generează”, sau „+ Lot”.</div>}
          <div style={{ display:'flex', gap:8, marginTop:8, flexWrap:'wrap' }}>
            <button style={S.btn} disabled={!!busy} onClick={() => setDraft(d => [...d, { ...LOT_GOL, nr: String(Math.max(0, ...d.map(x => Number(x.nr) || 0)) + 1) }])}>+ Lot</button>
            <button style={{ ...S.btnP, opacity: draftModificat || !areLoturi ? 1 : .5 }} disabled={!!busy || (!draftModificat && areLoturi)} onClick={salveazaLoturi}>💾 Salvează loturile</button>
            {(draftModificat || (editeaza && !areLoturi)) && <button style={S.btn} disabled={!!busy} onClick={anuleazaEditor}>Anulează</button>}
          </div>
        </div>
      )}

      {/* ── trierea documentelor ── */}
      {elig.activ && docs && (
        <div style={{ ...S.card, padding:'12px 14px' }}>
          <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap', marginBottom:8 }}>
            <div style={{ fontSize:13, fontWeight:800, marginRight:6 }}>Documentele licitației</div>
            {[['de_triat', `De triat (${contoare.de_triat})`, G.yellow], ['comun', `Comune (${contoare.comun})`, G.green],
              ...(loturi || []).map(x => [`lot:${x.nr}`, `Pe lot ${x.nr} (${contoare.lot.get(x.nr) || 0})`, x.participam ? G.ofertare : G.dim]),
              ['in_afara', `În afara loturilor (${contoare.in_afara})`, G.dim], ['toate', `Toate (${contoare.toate})`, G.muted]].map(([k, et, c]) => (
              <button key={k} style={S.chip(filtruEf === k, c)} onClick={() => setFiltru(k)}>{et}</button>
            ))}
            <input style={inp(200, { marginLeft:'auto' })} value={cauta} onChange={e => setCauta(e.target.value)} placeholder="🔎 caută în nume…" />
          </div>

          {/* acțiuni în masă */}
          {sel.size > 0 && (
            <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', padding:'8px 10px', borderRadius:8, background:G.ofertare + '12', border:`1px solid ${G.ofertare}44`, marginBottom:8 }}>
              <b style={{ fontSize:12.5 }}>{sel.size} selectate</b>
              <button style={{ ...S.btn, color:G.green, borderColor:G.green + '77' }} disabled={!!busy || !areLoturi} onClick={() => aplica('comun')}
                title={areLoturi ? 'Documentul privește toate loturile' : 'Doar când licitația „are loturi”'}>Comun</button>
              <span style={{ display:'inline-flex', gap:4, alignItems:'center', flexWrap:'wrap' }}>
                {(loturi || []).map(x => (
                  <label key={x.nr} style={{ ...S.chip(lotSel.has(x.nr), x.participam ? G.ofertare : G.dim), display:'inline-flex', alignItems:'center', gap:4 }}
                    title={`${x.denumire || 'Lot ' + x.nr}${x.participam ? ' — participăm' : ' — NU participăm'}`}>
                    <input type="checkbox" style={{ margin:0 }} checked={lotSel.has(x.nr)}
                      onChange={() => setLotSel(s => { const n = new Set(s); n.has(x.nr) ? n.delete(x.nr) : n.add(x.nr); return n })} />{x.nr}
                  </label>
                ))}
                <button style={{ ...S.btn, color:G.ofertare, borderColor:G.ofertare + '77' }} disabled={!!busy || !areLoturi || !lotSel.size}
                  onClick={() => aplica('alocat', [...lotSel].sort((a, b) => a - b))}>Lot {lotSel.size ? [...lotSel].sort((a, b) => a - b).join(', ') : '…'}</button>
              </span>
              <button style={{ ...S.btn, color:G.orange, borderColor:G.orange + '77' }} disabled={!!busy} onClick={() => aplica('necunoscut')}>Resetează</button>
              <input style={inp(220)} value={nota} onChange={e => setNota(e.target.value)} placeholder="notă (opțional) — ex. „F3 lot 2, cf. fișa de date”" />
              <button style={{ ...S.btn, marginLeft:'auto' }} onClick={() => setSel(new Set())}>✕ deselectează</button>
            </div>
          )}

          <div style={{ display:'flex', alignItems:'center', gap:10, fontSize:12, color:G.muted, marginBottom:6, flexWrap:'wrap' }}>
            <label style={{ display:'flex', alignItems:'center', gap:6, cursor:'pointer' }}>
              <input type="checkbox" checked={toataPagina} onChange={comutaPagina} /> pagina ({pagina.length})
            </label>
            {filtrate.length > pagina.length && (
              <button style={{ ...S.btn, padding:'3px 9px', fontSize:11.5 }} onClick={() => setSel(s => new Set([...s, ...filtrate.map(d => d.id)]))}>
                selectează toate cele {filtrate.length} filtrate
              </button>
            )}
            <span style={{ marginLeft:'auto' }}>{filtrate.length ? `${pagEf * PE_PAG + 1}–${pagEf * PE_PAG + pagina.length} din ${filtrate.length}` : '0 documente'}</span>
            {nPag > 1 && <>
              <button style={{ ...S.btn, padding:'3px 9px' }} disabled={pagEf === 0} onClick={() => setPag(pagEf - 1)}>‹</button>
              <span>{pagEf + 1}/{nPag}</span>
              <button style={{ ...S.btn, padding:'3px 9px' }} disabled={pagEf >= nPag - 1} onClick={() => setPag(pagEf + 1)}>›</button>
            </>}
          </div>

          <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
            {pagina.map(d => {
              const lots = docLot.get(d.id) || []
              const e = elig.harta.get(d.id)
              const [mEt, mCol] = MOTIV_LOT[e?.motiv] || [e?.motiv || '—', G.muted]
              const dinNume = lotDinNume(d.nume_original)
              const stDoc = d.lot_stare === 'comun' ? ['comun', G.green] : d.lot_stare === 'alocat' ? ['alocat', G.ofertare] : ['necunoscut', G.yellow]
              return (
                <label key={d.id} style={{ display:'grid', gridTemplateColumns:'22px minmax(0,1fr) auto', gap:8, alignItems:'center', padding:'5px 8px', borderRadius:6, cursor:'pointer',
                  background: sel.has(d.id) ? G.ofertare + '14' : G.bg, border:`1px solid ${sel.has(d.id) ? G.ofertare + '55' : G.border2}` }}>
                  <input type="checkbox" checked={sel.has(d.id)} onChange={() => comuta(d.id)} />
                  <div style={{ minWidth:0 }}>
                    <div style={{ fontSize:12.5, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }} title={d.nume_original}>{String(d.nume_original || '').split('/').pop()}</div>
                    <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginTop:2, fontSize:11, color:G.dim }}>
                      {d.tip && <span>{d.tip}</span>}
                      {dinNume != null && <span style={{ color:G.purple }} title="Doar informativ: numele fișierului pomenește un lot. Nu setează nimic.">🏷 nume: LOT {dinNume}</span>}
                      {d.lot_nota && <span style={{ color:G.muted }} title={d.lot_nota}>📝 {d.lot_nota.length > 60 ? d.lot_nota.slice(0, 60) + '…' : d.lot_nota}</span>}
                    </div>
                  </div>
                  <div style={{ display:'flex', gap:6, alignItems:'center', flexWrap:'wrap', justifyContent:'flex-end' }}>
                    <span style={S.badge(stDoc[1])}>{stDoc[0]}{lots.length ? ` · lot ${lots.join(', ')}` : ''}</span>
                    <span style={S.badge(mCol)} title={e && !e.eligibil ? mesajLot(e.motiv) : 'Procesabil'}>{mEt}</span>
                  </div>
                </label>
              )
            })}
            {!pagina.length && <div style={{ fontSize:12, color:G.dim, padding:8 }}>Niciun document pe filtrul ales.</div>}
          </div>
        </div>
      )}
    </div>
  )
}
