// ═══════════════════════════════════════════════════════════════════════════
// IzoBuletineNdt.jsx — Izometrie → „🧪 Buletine NDT” (PR2b, docs/izometrie/BULETINE_NDT_SPEC.md §6, §21–§24)
// Arhiva buletinelor NDT pe tronson: listă, încărcare PDF, citire cu AI (funcția edge izo-ndt-citeste) sau
// introducere manuală, ecranul de confirmare cu verificările automate (§23), anulare, metodele obligatorii
// și sudurile eliminate prin tăiere. Toate scrierile prin funcțiile fn_sud_* (20270114a), care verifică dreptul
// în corp; ecranul doar ascunde butoanele fără drept. Logica: src/izoBuletineNdtLogica.js + src/lib/izoNdt.js.
// Conținutul buletinului (scan, citire AI, text lipit) e DATE: nu declanșează nimic în afară de precompletare.
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './lib/supabase.js'
import { paginareKeyset } from './hrDeciziiUtil.js'
import { comparaCitiri, normalizeazaRezultat } from './lib/izoNdt.js'
import {
  BUCKET_NDT, METODE, METODE_OBLIGABILE, STARI_BULETIN, ETICHETA_STARE, CAMPURI_INDICATII, VARIANTE_ALEGERE,
  tronsonNrDinCod, codDinCheie, fmtMoment, fmtData, valideazaFisier, sha256Hex, caleFisier, valideazaIncarcare,
  mapeazaEroareRpc, mapeazaRaspunsEdge, randGol, randuriDinCitire, parseazaLipire, pregatesteRanduriConfirmare,
  combinaCitiri, combinaSemnaleCitiri, randArhivaPentruStare, calculeazaVerificari, filtreazaBuletine, coduriDinPachete, valideazaEliminare,
} from './izoBuletineNdtLogica.js'

const G = {
  bg:'#0D1117', card:'#161B22', surface:'#161B22', text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681', border:'#30363D', border2:'#21262D',
  green:'#2EA043', orange:'#F0883E', red:'#F85149', yellow:'#D29922', blue:'#58A6FF', purple:'#A371F7', gray:'#484F58',
}
const S = {
  card: { background:G.card, borderRadius:12, border:`1px solid ${G.border}`, padding:'14px 16px' },
  input: { background:G.bg, border:`1px solid ${G.border}`, borderRadius:8, padding:'8px 10px', color:G.text, fontSize:13, outline:'none', fontFamily:'inherit' },
  cell: { background:'transparent', border:`1px solid ${G.border2}`, borderRadius:4, padding:'3px 5px', color:G.text, fontSize:12, outline:'none', fontFamily:'inherit', width:'100%' },
  btnP: { padding:'8px 14px', background:G.purple, color:'#fff', border:'none', borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:600, fontFamily:'inherit' },
  btnS: { padding:'8px 14px', background:G.surface, color:G.text, border:`1px solid ${G.border}`, borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:500, fontFamily:'inherit' },
  btnR: { padding:'8px 14px', background:'transparent', color:G.red, border:`1px solid ${G.red}66`, borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:600, fontFamily:'inherit' },
  th: { padding:'7px 8px', textAlign:'left', fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'.4px', color:G.muted, background:G.card, position:'sticky', top:0 },
  td: { padding:'5px 8px', fontSize:12, color:G.text, borderTop:`1px solid ${G.border2}`, verticalAlign:'top' },
  badge: { display:'inline-block', padding:'2px 8px', borderRadius:6, fontSize:11, fontWeight:600 },
}
const CULOARE_STARE = { ciorna: G.yellow, confirmat: G.green, anulat: G.gray }
const CULOARE_NIVEL = { eroare: G.red, atentie: G.yellow, info: G.blue }
const BUCATA_IDS = 200
const COLOANE_BULETIN = 'id, proiect_id, tronson_id, metoda, numar, data_buletin, firma_citita, fisier_path, fisier_nume, fisier_sha256, stare, fortat_motiv, versiune, incarcat_de, incarcat_la, confirmat_de, confirmat_la, anulat_de, anulat_la, anulat_motiv'
const ETICHETA_CAMP = { cod_raw: 'Cod sudură', rezultat: 'Rezultat', data_inspectie: 'Data', start_mm: 'Start', end_mm: 'End', lungime_mm: 'Lung.', inaltime_mm: 'Înălț.', adancime_mm: 'Adânc.', observatii: 'Observații' }

const Badge = ({ c, children }) => <span style={{ ...S.badge, background: c + '22', color: c }}>{children}</span>
const Mesaj = ({ c = G.red, children }) => children ? <div style={{ fontSize:12, color:c, marginTop:6, lineHeight:1.5 }}>{children}</div> : null

// citire paginată (L23): keyset pe id până la pagina goală; `viu()` oprește bucla când ecranul a trecut la altă entitate (L24)
const tot = (construieste, viu) => paginareKeyset((ultim, pas) => {
  viu()
  let q = construieste().order('id').limit(pas)
  if (ultim != null) q = q.gt('id', ultim)
  return q
})
async function totPeBucati(ids, construieste, viu) {
  const out = []
  for (let i = 0; i < ids.length; i += BUCATA_IDS) {
    const parte = await tot(() => construieste(ids.slice(i, i + BUCATA_IDS)), viu)
    for (const x of parte) out.push(x)
  }
  return out
}
async function corpEroareEdge(error) {
  try { return error?.context && typeof error.context.json === 'function' ? await error.context.clone().json() : null } catch { return null }
}
async function urlSemnat(path, download = null) {
  const { data, error } = await supabase.storage.from(BUCKET_NDT).createSignedUrl(path, 3600, download ? { download } : undefined)
  if (error || !data?.signedUrl) throw new Error(error?.message || 'linkul PDF nu s-a putut genera')
  return data.signedUrl
}

export default function IzoBuletineNdt({ proiectId, tronsoane, initialTronsonId }) {
  const [tronsonId, setTronsonId] = useState(initialTronsonId || tronsoane?.[0]?.id || null)
  const [date, setDate] = useState(null)          // { tronsonId, buletine, eliminate, metode (null = necitite), eroareMetode }
  const [eroare, setEroare] = useState(null)
  const [loading, setLoading] = useState(false)
  const [drept, setDrept] = useState({ scriere: false, eroare: null })
  const [nume, setNume] = useState({})
  const [filtre, setFiltre] = useState({ metoda: '', stare: '' })
  const [deschis, setDeschis] = useState(null)    // id-ul buletinului deschis
  const [incarcare, setIncarcare] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [toast, setToast] = useState(null)
  const gen = useRef(0)
  const deschideDupa = useRef(null)               // buletinul de deschis după trecerea pe tronsonul lui (dublura de pe alt tronson)
  const nesalvat = useRef(false)                  // confirmarea are o citire / rânduri nesalvate (se pierd la închidere)
  const tronson = useMemo(() => (tronsoane || []).find(t => t.id === tronsonId) || null, [tronsoane, tronsonId])
  const reincarca = () => setReloadKey(k => k + 1)
  const anunta = (msg, c = G.green) => { setToast({ msg, c }); setTimeout(() => setToast(null), 4000) }
  // TODO(PR #1218 r1, P1 :291/:523): citirea AI și corecturile stau doar în ecran până la confirmare; păstrarea lor pe
  // server cere un tabel nou (decizia proprietarului). Până atunci: avertisment vizibil + confirmare la închidere.
  const poatePleca = () => !nesalvat.current || window.confirm('Citirea și rândurile din tabel nu sunt salvate (se salvează doar la confirmare). Dacă închizi, se pierd. Închizi oricum?')
  useEffect(() => {
    const laIesire = e => { if (nesalvat.current) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', laIesire)
    return () => window.removeEventListener('beforeunload', laIesire)
  }, [])

  useEffect(() => { if (!tronsonId && tronsoane?.length) setTronsonId(tronsoane[0].id) }, [tronsoane, tronsonId])
  // alt tronson: se închid panourile (rezultatele vechi nu se aplică pe tronsonul nou, L24); excepție: buletinul cerut explicit
  useEffect(() => { setDeschis(deschideDupa.current); deschideDupa.current = null; setIncarcare(false) }, [tronsonId, proiectId])

  // deschide un buletin oriunde ar fi pe proiect: pe tronsonul curent direct; pe alt tronson, trece pe el și îl deschide acolo
  const deschideBuletin = async (id, tIdCunoscut = null) => {
    let tId = tIdCunoscut
    if (tId == null) {
      if (date?.tronsonId === tronsonId && date.buletine.some(b => b.id === id)) tId = tronsonId
      else {
        const { data, error } = await supabase.from('sud_buletine').select('id, tronson_id').eq('proiect_id', proiectId).eq('id', id).maybeSingle()
        if (error || !data) { anunta(`Buletinul #${id} nu s-a putut găsi${error ? `: ${error.message}` : ''}.`, G.red); return }
        tId = data.tronson_id
      }
    }
    setIncarcare(false)
    if (tId === tronsonId) { setDeschis(id); reincarca(); return }
    if (!(tronsoane || []).some(t => t.id === tId)) { anunta(`Buletinul #${id} e pe un tronson care nu e în lista acestui proiect.`, G.red); return }
    deschideDupa.current = id
    setTronsonId(tId)
  }
  const codTronson = id => (tronsoane || []).find(t => t.id === id)?.cod || `#${id}`

  // dreptul de scriere (owner sau MP): aceeași funcție ca serverul (R9); eroare ≠ „n-ai drept” (L18)
  useEffect(() => {
    if (!proiectId) return
    let viu = true
    setDrept({ scriere: false, eroare: null })
    supabase.rpc('fn_sud_drept', { p_proiect: proiectId, p_nivel: 'scriere' }).then(({ data, error, status }) => {
      if (!viu) return
      if (error) setDrept({ scriere: false, eroare: mapeazaEroareRpc(error, status)?.mesaj || error.message })
      else setDrept({ scriere: data === true, eroare: null })
    })
    return () => { viu = false }
  }, [proiectId])

  useEffect(() => {
    if (!proiectId || !tronsonId) return
    const g = ++gen.current
    const viu = () => { if (g !== gen.current) throw new Error('citire anulată') }
    setLoading(true); setEroare(null)
    ;(async () => {
      try {
        const [buletine, eliminate, met] = await Promise.all([
          tot(() => supabase.from('sud_buletine').select(COLOANE_BULETIN).eq('proiect_id', proiectId).eq('tronson_id', tronsonId), viu),
          tot(() => supabase.from('sud_suduri_eliminate').select('id, cheie, motiv, inlocuita_de, activ, creat_de, creat_la, retras_de, retras_la, retras_motiv').eq('tronson_id', tronsonId), viu),
          supabase.from('sud_metode_proiect').select('metode, actualizat_la').eq('proiect_id', proiectId).maybeSingle(),
        ])
        if (g !== gen.current) return
        setDate({ tronsonId, buletine, eliminate, metode: met.error ? null : (met.data?.metode || []), eroareMetode: met.error?.message || null })
        // numele oamenilor (doar afișare; dacă nu se pot citi, se spune, nu se ascunde)
        const ids = [...new Set([...buletine.flatMap(b => [b.incarcat_de, b.confirmat_de, b.anulat_de]), ...eliminate.flatMap(e => [e.creat_de, e.retras_de])].filter(Boolean))]
        if (ids.length) {
          const pr = await totPeBucati(ids, b => supabase.from('profiles').select('id, name').in('id', b), viu).catch(() => null)
          if (g === gen.current) setNume(pr ? Object.fromEntries(pr.map(p => [p.id, p.name])) : { _eroare: true })
        }
      } catch (e) {
        if (g !== gen.current) return
        setDate(null); setEroare(mapeazaEroareRpc(e)?.mesaj || e?.message || String(e))
      } finally {
        if (g === gen.current) setLoading(false)
      }
    })()
    return () => { gen.current++ }
  }, [proiectId, tronsonId, reloadKey])

  const dateTronson = date && date.tronsonId === tronsonId ? date : null
  const lista = useMemo(() => filtreazaBuletine(dateTronson?.buletine, filtre), [dateTronson, filtre])
  const numeOm = id => !id ? '—' : nume[id] || (nume._eroare ? 'nume indisponibil' : '…')
  const buletinDeschis = dateTronson?.buletine.find(b => b.id === deschis) || null

  if (!tronsoane?.length) return <div style={S.card}>Proiectul nu are tronsoane.</div>

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
      {toast && <div style={{ position:'fixed', bottom:24, right:24, padding:'12px 18px', background:G.card, border:`1px solid ${toast.c}`, borderRadius:10, color:G.text, fontSize:13, zIndex:9999, maxWidth:420 }}>{toast.msg}</div>}
      <div style={{ ...S.card, display:'flex', flexWrap:'wrap', gap:12, alignItems:'center' }}>
        <div style={{ fontSize:18, fontWeight:700 }}>🧪 Buletine NDT</div>
        <select value={tronsonId || ''} onChange={e => { if (poatePleca()) setTronsonId(Number(e.target.value)) }} style={S.input} aria-label="Tronson">
          {tronsoane.map(t => <option key={t.id} value={t.id}>{t.cod}</option>)}
        </select>
        <select value={filtre.metoda} onChange={e => setFiltre(f => ({ ...f, metoda: e.target.value }))} style={S.input} aria-label="Filtru metodă">
          <option value="">toate metodele</option>
          {METODE.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <select value={filtre.stare} onChange={e => setFiltre(f => ({ ...f, stare: e.target.value }))} style={S.input} aria-label="Filtru stare">
          <option value="">toate stările</option>
          {STARI_BULETIN.map(s => <option key={s} value={s}>{ETICHETA_STARE[s]}</option>)}
        </select>
        {drept.scriere
          ? <button style={S.btnP} onClick={() => { if (!poatePleca()) return; setIncarcare(true); setDeschis(null) }} disabled={!tronson}>⬆ Încarcă buletin</button>
          : <span style={{ fontSize:12, color: drept.eroare ? G.red : G.muted }}>{drept.eroare ? `Dreptul nu s-a putut verifica: ${drept.eroare}` : 'Doar citire (încarcă managerul de proiect sau owner-ul).'}</span>}
      </div>

      {loading && <div style={S.card}>Se încarcă…</div>}
      {eroare && <div style={{ ...S.card, borderColor:G.red, color:G.red }}>Nu s-au putut citi buletinele: {eroare}</div>}

      {incarcare && tronson && drept.scriere && (
        <IncarcarePanel key={`inc-${tronson.id}`} proiectId={proiectId} tronson={tronson} codTronson={codTronson}
          onInchide={() => setIncarcare(false)} onDeschide={deschideBuletin}
          onReincarca={reincarca} />
      )}

      {buletinDeschis && tronson && (
        <BuletinDetaliu key={`b-${buletinDeschis.id}`} buletin={buletinDeschis} tronson={tronson} poateScrie={drept.scriere}
          buletineTronson={dateTronson.buletine} eliminate={dateTronson.eliminate} numeOm={numeOm}
          onNesalvat={v => { nesalvat.current = v }}
          onInchide={() => { if (poatePleca()) setDeschis(null) }} onSchimbat={(msg, c) => { if (msg) anunta(msg, c); reincarca() }} />
      )}

      {dateTronson && (
        <div style={{ ...S.card, padding:0, overflow:'auto', maxHeight:'55vh' }}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead><tr>{['Metodă', 'Număr', 'Data', 'Stare', 'Rânduri', 'PDF', 'Încărcat', 'Confirmat / anulat'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {!lista.length && <tr><td style={S.td} colSpan={8}>{dateTronson.buletine.length ? 'Niciun buletin cu filtrele alese.' : `Niciun buletin pe tronsonul ${tronson?.cod || ''}.`}</td></tr>}
              {lista.map(b => (
                <tr key={b.id} onClick={() => { if (deschis === b.id || !poatePleca()) return; setDeschis(b.id); setIncarcare(false) }} style={{ cursor:'pointer', background: deschis === b.id ? G.purple + '18' : 'transparent' }}>
                  <td style={S.td}><b>{b.metoda}</b></td>
                  <td style={S.td}>{b.numar}{b.fortat_motiv && <span title={`Încărcat forțat: ${b.fortat_motiv}`} style={{ color:G.orange }}> ⚑</span>}</td>
                  <td style={S.td}>{fmtData(b.data_buletin)}</td>
                  <td style={S.td}><Badge c={CULOARE_STARE[b.stare] || G.muted}>{ETICHETA_STARE[b.stare] || b.stare}</Badge></td>
                  <td style={S.td}><NrRanduri buletin={b} /></td>
                  <td style={S.td} onClick={e => e.stopPropagation()}><LinkPdf buletin={b} /></td>
                  <td style={S.td}>{numeOm(b.incarcat_de)}<div style={{ color:G.muted }}>{fmtMoment(b.incarcat_la)}</div></td>
                  <td style={S.td}>{b.stare === 'confirmat' ? <>{numeOm(b.confirmat_de)}<div style={{ color:G.muted }}>{fmtMoment(b.confirmat_la)}</div></>
                    : b.stare === 'anulat' ? <>{numeOm(b.anulat_de)}<div style={{ color:G.muted }}>{fmtMoment(b.anulat_la)} · {b.anulat_motiv}</div></> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dateTronson && (
        <div style={{ display:'flex', flexWrap:'wrap', gap:12, alignItems:'flex-start' }}>
          <MetodeObligatorii proiectId={proiectId} metode={dateTronson.metode} eroareMetode={dateTronson.eroareMetode} poateScrie={drept.scriere}
            onSchimbat={(msg) => { anunta(msg); reincarca() }} />
          <SuduriEliminate tronson={tronson} lista={dateTronson.eliminate} poateScrie={drept.scriere} numeOm={numeOm}
            onSchimbat={(msg) => { anunta(msg); reincarca() }} />
        </div>
      )}
    </div>
  )
}

// numărul de rânduri ale unui buletin confirmat (count exact, fără să le aducă)
function NrRanduri({ buletin }) {
  const [n, setN] = useState(null)
  useEffect(() => {
    if (buletin.stare === 'ciorna') return
    let viu = true
    supabase.from('sud_buletin_randuri').select('id', { count: 'exact', head: true }).eq('buletin_id', buletin.id)
      .then(({ count, error }) => { if (viu) setN(error ? 'eroare' : count) })
    return () => { viu = false }
  }, [buletin.id, buletin.stare])
  if (buletin.stare === 'ciorna') return <span style={{ color:G.muted }}>—</span>
  return n === null ? '…' : n === 'eroare' ? <span style={{ color:G.red }}>?</span> : n
}

function LinkPdf({ buletin }) {
  const [er, setEr] = useState(null)
  if (!buletin.fisier_path) return <span style={{ color:G.red }}>lipsă</span>
  const deschide = async () => {
    setEr(null)
    try { window.open(await urlSemnat(buletin.fisier_path, buletin.fisier_nume || `buletin_${buletin.metoda}_${buletin.numar}.pdf`), '_blank', 'noopener') }
    catch (e) { setEr(e.message) }
  }
  return <><button style={{ ...S.btnS, padding:'3px 8px', fontSize:12 }} onClick={deschide}>⬇ PDF</button>{er && <div style={{ color:G.red, fontSize:11 }}>{er}</div>}</>
}

// ── încărcarea ──────────────────────────────────────────────────────────
function IncarcarePanel({ proiectId, tronson, codTronson, onInchide, onDeschide, onReincarca }) {
  const [fisier, setFisier] = useState(null)
  const [sha, setSha] = useState(null)
  const [eroareFisier, setEroareFisier] = useState(null)
  const [dublura, setDublura] = useState(null)       // buletin existent cu aceeași amprentă (verificat înainte de urcare)
  const [f, setF] = useState({ metoda: '', numar: '', data: '', firma: '', forteazaMotiv: '' })
  const [cuForteaza, setCuForteaza] = useState(false)
  const [erori, setErori] = useState({})
  const [urcat, setUrcat] = useState(null)           // { path, sha } — fișierul deja urcat, refolosit la reîncercare (fereastra de o oră)
  const [rez, setRez] = useState(null)               // eroarea mapată a ultimei încercări
  const [lucru, setLucru] = useState(false)
  const tok = useRef(0)
  // panoul închis / înlocuit de o încărcare nouă: răspunsurile vechi nu mai închid panoul nou și nu schimbă selecția (L24)
  useEffect(() => () => { tok.current++ }, [])

  const alege = async (file) => {
    const t = ++tok.current
    setFisier(null); setSha(null); setDublura(null); setRez(null); setEroareFisier(null); setCuForteaza(false)
    if (!file) return
    const e1 = valideazaFisier(file)
    if (e1) { setEroareFisier(e1); return }
    try {
      const octeti = await file.arrayBuffer()
      const e2 = valideazaFisier(file, new Uint8Array(octeti, 0, Math.min(5, octeti.byteLength)))
      if (e2) { if (t === tok.current) setEroareFisier(e2); return }
      if (file.name.length > 300) { if (t === tok.current) setEroareFisier('Numele fișierului are peste 300 de caractere: redenumește-l.'); return }
      const h = await sha256Hex(octeti)
      if (t !== tok.current) return
      setFisier(file); setSha(h)
      // dublura pe amprentă, ÎNAINTE de orice urcare sau cost (§6 pct. 2); serverul o verifică oricum la înregistrare
      const { data, error } = await supabase.from('sud_buletine').select('id, tronson_id, metoda, numar, data_buletin, stare')
        .eq('proiect_id', proiectId).eq('fisier_sha256', h).neq('stare', 'anulat').limit(1)
      if (t !== tok.current) return
      if (error) setDublura({ eroare: error.message })
      else if (data?.length) setDublura(data[0])
    } catch (e) { if (t === tok.current) setEroareFisier(e?.message || String(e)) }
  }

  const trimite = async () => {
    const v = valideazaIncarcare({ ...f, cuForteaza })
    setErori(v.erori); setRez(null)
    if (!v.ok || !fisier || !sha || lucru) return
    const t = ++tok.current
    setLucru(true)
    try {
      let path = urcat && urcat.sha === sha ? urcat.path : null
      if (!path) {
        path = caleFisier(proiectId, tronson.id, crypto.randomUUID())
        const up = await supabase.storage.from(BUCKET_NDT).upload(path, fisier, { contentType: 'application/pdf', upsert: false })
        if (t !== tok.current) return
        if (up.error) { setRez({ tip: 'urcare', mesaj: `Fișierul nu s-a putut urca: ${up.error.message}` }); return }
        setUrcat({ path, sha })
      }
      const { data, error, status } = await supabase.rpc('fn_sud_buletin_incarca', {
        p_tronson: tronson.id, p_metoda: v.valori.metoda, p_numar: v.valori.numar, p_data: v.valori.data, p_firma: v.valori.firma,
        p_fisier_path: path, p_fisier_nume: fisier.name, p_sha256: sha, p_citiri: null, p_forteaza_motiv: v.valori.forteazaMotiv,
      })
      if (t !== tok.current) return
      if (!error && data != null) { onDeschide(Number(data), tronson.id); return }
      const m = mapeazaEroareRpc(error || { message: 'răspuns gol' }, status)
      if (m.tip === 'necunoscut') {
        // L05: nu se știe dacă înregistrarea a trecut → se recitește din bază după amprentă, nu se reîncearcă orbește
        const r = await supabase.from('sud_buletine').select('id, tronson_id').eq('proiect_id', proiectId).eq('fisier_sha256', sha).neq('stare', 'anulat').limit(1)
        if (t !== tok.current) return
        if (!r.error && r.data?.length) { onDeschide(r.data[0].id, r.data[0].tronson_id); return }
        m.mesaj += r.error ? ' Nici recitirea nu a mers: verifică lista înainte să reîncerci.' : ' Buletinul nu apare în bază: poți reîncerca.'
      }
      if (m.tip === 'fisier_expirat') setUrcat(null)
      if (m.tip === 'buletin_dublura') setCuForteaza(true)
      setRez(m)
      onReincarca()
    } catch (e) {
      if (t === tok.current) setRez({ tip: 'eroare', mesaj: e?.message || String(e) })
    } finally {
      if (t === tok.current) setLucru(false)
    }
  }

  const camp = (k, eticheta, props = {}) => (
    <label style={{ display:'flex', flexDirection:'column', gap:4, fontSize:12, color:G.muted }}>
      {eticheta}
      <input style={S.input} value={f[k]} onChange={e => setF(x => ({ ...x, [k]: e.target.value }))} {...props} />
      {erori[k] && <span style={{ color:G.red }}>{erori[k]}</span>}
    </label>
  )
  const orfan = urcat && rez && rez.tip !== 'necunoscut'
  return (
    <div style={{ ...S.card, borderColor:G.purple + '88' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
        <b>⬆ Buletin nou pe {tronson.cod}</b>
        <button style={S.btnS} onClick={onInchide}>Închide</button>
      </div>
      <div style={{ display:'flex', flexWrap:'wrap', gap:12, alignItems:'flex-start' }}>
        <label style={{ display:'flex', flexDirection:'column', gap:4, fontSize:12, color:G.muted }}>
          PDF (max. 50 MB)
          <input type="file" accept="application/pdf,.pdf" onChange={e => alege(e.target.files?.[0] || null)} disabled={lucru} />
          {eroareFisier && <span style={{ color:G.red }}>{eroareFisier}</span>}
          {sha && <span title={sha}>amprentă {sha.slice(0, 12)}…</span>}
        </label>
        <label style={{ display:'flex', flexDirection:'column', gap:4, fontSize:12, color:G.muted }}>
          Metoda
          <select style={S.input} value={f.metoda} onChange={e => setF(x => ({ ...x, metoda: e.target.value }))}>
            <option value="">alege…</option>
            {METODE.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          {erori.metoda && <span style={{ color:G.red }}>{erori.metoda}</span>}
        </label>
        {camp('numar', 'Număr buletin', { maxLength: 60 })}
        {camp('data', 'Data buletinului (ZZ.LL.AAAA)', { placeholder: 'ZZ.LL.AAAA' })}
        {camp('firma', 'Laborator (informativ)', { maxLength: 200 })}
      </div>
      {dublura && (dublura.eroare
        ? <Mesaj c={G.yellow}>Verificarea dublurii nu s-a putut face ({dublura.eroare}); serverul o face oricum la înregistrare.</Mesaj>
        : <Mesaj c={G.yellow}>Fișierul e deja încărcat: <a href="#" style={{ color:G.blue }} onClick={e => { e.preventDefault(); onDeschide(dublura.id, dublura.tronson_id) }}>buletinul {dublura.metoda} {dublura.numar} din {fmtData(dublura.data_buletin)} ({ETICHETA_STARE[dublura.stare]}){dublura.tronson_id !== tronson.id ? `, pe tronsonul ${codTronson(dublura.tronson_id)}` : ''}</a>. Nu e nevoie să-l încarci din nou.</Mesaj>)}
      {cuForteaza && (
        <div style={{ marginTop:10, padding:10, border:`1px solid ${G.orange}66`, borderRadius:8 }}>
          <div style={{ fontSize:12, color:G.orange, marginBottom:6 }}>E alt laborator, cu același număr și aceeași dată? Poți încărca oricum, cu motiv (se înregistrează).</div>
          {camp('forteazaMotiv', 'Motivul (obligatoriu)', { maxLength: 500 })}
        </div>
      )}
      {rez && (
        <Mesaj c={rez.tip === 'necunoscut' ? G.yellow : G.red}>
          {rez.mesaj}
          {(rez.tip === 'fisier_dublura' || rez.tip === 'buletin_dublura') && rez.id && <> <a href="#" style={{ color:G.blue }} onClick={e => { e.preventDefault(); onDeschide(rez.id, rez.tip === 'buletin_dublura' ? tronson.id : null) }}>Deschide buletinul #{rez.id}</a></>}
        </Mesaj>
      )}
      {orfan && rez.tip !== 'buletin_dublura' && <Mesaj c={G.muted}>Fișierul urcat rămâne în arhivă neînregistrat și se curăță automat (nu se poate șterge în primele 2 ore).</Mesaj>}
      <div style={{ display:'flex', gap:8, marginTop:12 }}>
        <button style={S.btnP} onClick={trimite} disabled={lucru || !fisier || !sha}>{lucru ? 'Se încarcă…' : cuForteaza ? 'Încarcă oricum' : 'Încarcă'}</button>
        <span style={{ fontSize:12, color:G.muted, alignSelf:'center' }}>După încărcare buletinul e ciornă: citești rândurile (AI sau manual) și confirmi.</span>
      </div>
    </div>
  )
}

// ── detaliul unui buletin: PDF alături + rânduri (confirmare sau citire) ─
function BuletinDetaliu({ buletin, tronson, poateScrie, buletineTronson, eliminate, numeOm, onNesalvat, onInchide, onSchimbat }) {
  const [url, setUrl] = useState(null)
  const [eroareUrl, setEroareUrl] = useState(null)
  const [motivAnulare, setMotivAnulare] = useState('')
  const [lucru, setLucru] = useState(false)
  const [mesaj, setMesaj] = useState(null)
  useEffect(() => {
    let viu = true
    setUrl(null); setEroareUrl(null)
    if (buletin.fisier_path) urlSemnat(buletin.fisier_path).then(u => viu && setUrl(u), e => viu && setEroareUrl(e.message))
    return () => { viu = false }
  }, [buletin.id, buletin.fisier_path])

  const anuleaza = async () => {
    if (motivAnulare.trim().length < 3 || lucru) { setMesaj({ c: G.red, t: 'Motivul anulării e obligatoriu (cel puțin 3 caractere).' }); return }
    setLucru(true); setMesaj(null)
    const { error, status } = await supabase.rpc('fn_sud_buletin_anuleaza', { p_id: buletin.id, p_motiv: motivAnulare.trim() })
    setLucru(false)
    if (!error) { onSchimbat(`Buletinul ${buletin.metoda} ${buletin.numar} a fost anulat.`); return }
    const m = mapeazaEroareRpc(error, status)
    setMesaj({ c: m.tip === 'necunoscut' ? G.yellow : G.red, t: m.mesaj })
    onSchimbat()
  }

  return (
    <div style={{ ...S.card, borderColor: (CULOARE_STARE[buletin.stare] || G.border) + '88' }}>
      <div style={{ display:'flex', flexWrap:'wrap', justifyContent:'space-between', gap:8, alignItems:'center', marginBottom:10 }}>
        <div>
          <b>{buletin.metoda} {buletin.numar}</b> din {fmtData(buletin.data_buletin)} · <Badge c={CULOARE_STARE[buletin.stare]}>{ETICHETA_STARE[buletin.stare]}</Badge>
          {buletin.firma_citita && <span style={{ color:G.muted, fontSize:12 }}> · {buletin.firma_citita}</span>}
          <div style={{ color:G.muted, fontSize:12 }}>Încărcat de {numeOm(buletin.incarcat_de)}, {fmtMoment(buletin.incarcat_la)}{buletin.fortat_motiv && <span style={{ color:G.orange }}> · forțat: {buletin.fortat_motiv}</span>}</div>
        </div>
        <button style={S.btnS} onClick={onInchide}>Închide</button>
      </div>
      <div style={{ display:'flex', flexWrap:'wrap', gap:12, alignItems:'flex-start' }}>
        <div style={{ flex:'1 1 420px', minWidth:320 }}>
          {eroareUrl ? <div style={{ color:G.red, fontSize:12 }}>PDF-ul nu s-a putut deschide: {eroareUrl}</div>
            : url ? <iframe title={`PDF ${buletin.numar}`} src={url} style={{ width:'100%', height:'78vh', border:`1px solid ${G.border}`, borderRadius:8, background:'#fff' }} />
            : <div style={{ color:G.muted, fontSize:12 }}>Se deschide PDF-ul…</div>}
        </div>
        <div style={{ flex:'1 1 520px', minWidth:360 }}>
          {buletin.stare === 'ciorna' && poateScrie
            ? <Confirmare buletin={buletin} tronson={tronson} buletineTronson={buletineTronson} eliminate={eliminate} onSchimbat={onSchimbat} onNesalvat={onNesalvat} />
            : <RanduriConfirmate buletin={buletin} />}
          {buletin.stare === 'ciorna' && !poateScrie && <Mesaj c={G.muted}>Ciornă: rândurile le confirmă managerul de proiect.</Mesaj>}
          {poateScrie && buletin.stare !== 'anulat' && (
            <div style={{ marginTop:14, paddingTop:10, borderTop:`1px solid ${G.border2}`, display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
              <input style={{ ...S.input, flex:'1 1 240px' }} placeholder="Motivul anulării (corectura = anulare + reîncărcare)" value={motivAnulare} onChange={e => setMotivAnulare(e.target.value)} maxLength={500} />
              <button style={S.btnR} onClick={anuleaza} disabled={lucru}>Anulează buletinul</button>
            </div>
          )}
          {mesaj && <Mesaj c={mesaj.c}>{mesaj.t}</Mesaj>}
        </div>
      </div>
    </div>
  )
}

function RanduriConfirmate({ buletin }) {
  const [randuri, setRanduri] = useState(null)
  const [eroare, setEroare] = useState(null)
  useEffect(() => {
    let g = true
    const viu = () => { if (!g) throw new Error('citire anulată') }
    setRanduri(null); setEroare(null)
    if (buletin.stare === 'ciorna') return
    tot(() => supabase.from('sud_buletin_randuri').select('id, ordine, cod_raw, stare_cod, motiv_cod, cheie, refacuta, rezultat, data_inspectie, ind_start, ind_end, ind_lungime, ind_inaltime, ind_adancime, observatii').eq('buletin_id', buletin.id), viu)
      .then(r => g && setRanduri(r.sort((a, b) => a.ordine - b.ordine)), e => g && setEroare(e?.message || String(e)))
    return () => { g = false }
  }, [buletin.id, buletin.stare])
  if (buletin.stare === 'ciorna') return <div style={{ fontSize:12, color:G.muted }}>Ciornă fără rânduri confirmate.</div>
  if (eroare) return <div style={{ color:G.red, fontSize:12 }}>Rândurile nu s-au putut citi: {eroare}</div>
  if (!randuri) return <div style={{ fontSize:12, color:G.muted }}>Se încarcă rândurile…</div>
  return (
    <div style={{ overflow:'auto', maxHeight:'70vh' }}>
      <table style={{ width:'100%', borderCollapse:'collapse' }}>
        <thead><tr>{['#', 'Cod din buletin', 'Sudura ERP', 'Rezultat', 'Data', 'Indicații (mm)', 'Observații'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
        <tbody>{randuri.map(r => (
          <tr key={r.id}>
            <td style={S.td}>{r.ordine}</td>
            <td style={S.td}>{r.cod_raw}</td>
            <td style={S.td}>{r.stare_cod === 'ok' ? <>{r.cheie}{r.refacuta && <Badge c={G.blue}>R</Badge>}</> : <Badge c={G.yellow}>nepotrivit · {r.motiv_cod}</Badge>}</td>
            <td style={S.td}><Badge c={r.rezultat === 'acceptat' ? G.green : G.red}>{r.rezultat}</Badge></td>
            <td style={S.td}>{fmtData(r.data_inspectie)}</td>
            <td style={S.td}>{[r.ind_start, r.ind_end, r.ind_lungime, r.ind_inaltime, r.ind_adancime].some(x => x != null) ? [r.ind_start, r.ind_end, r.ind_lungime, r.ind_inaltime, r.ind_adancime].map(x => x ?? '—').join(' / ') : ''}</td>
            <td style={S.td}>{r.observatii}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  )
}

// ── confirmarea: citire AI / manuală, verificări, alegeri, confirmare ───
function Confirmare({ buletin, tronson, buletineTronson, eliminate, onSchimbat, onNesalvat }) {
  const [randuri, setRanduri] = useState([])
  const [citire, setCitire] = useState(null)          // prima citire AI (normalizată)
  const [citire2, setCitire2] = useState(null)        // a doua citire, în comparația deschisă
  const [citire2Aplicata, setCitire2Aplicata] = useState(null)   // a doua citire din care s-au aplicat alegerile (semnalele ei rămân, L12)
  const [comparatie, setComparatie] = useState(null)  // comparaCitiri(prima, a doua)
  const [alegeri, setAlegeri] = useState({})
  const [ctx, setCtx] = useState({ coduriPachete: null, arhiva: null, eroare: null, gata: false })
  const [lipire, setLipire] = useState(null)          // textul lipit (null = panoul închis)
  const [mesaj, setMesaj] = useState(null)
  const [lucru, setLucru] = useState(null)            // 'citire' | 'citire2' | 'confirmare'
  const [verificat, setVerificat] = useState(false)
  const tok = useRef(0)
  const tNr = tronsonNrDinCod(tronson.cod)
  useEffect(() => () => { tok.current++ }, [])
  // munca nesalvată (citire AI / rânduri în tabel) se anunță părintelui: închiderea panoului cere confirmare
  const areNesalvat = !!citire || randuri.length > 0
  useEffect(() => { onNesalvat?.(areNesalvat) }, [areNesalvat]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { onNesalvat?.(false) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // pe durata unei cereri (citire / confirmare) tabelul e blocat: ce se trimite = ce se vede (L24, Jakarinos #1218 r1)
  const blocat = !!lucru

  // sursele verificărilor: sudurile din pachetele tronsonului + rândurile buletinelor confirmate (necitite = null, L18)
  const idsConfirmate = useMemo(() => buletineTronson.filter(b => b.stare === 'confirmat').map(b => b.id).join(','), [buletineTronson])
  useEffect(() => {
    let g = true
    const viu = () => { if (!g) throw new Error('citire anulată') }
    const confirmate = buletineTronson.filter(b => b.stare === 'confirmat')
    const peId = new Map(confirmate.map(b => [b.id, b]))
    ;(async () => {
      const out = { coduriPachete: null, arhiva: null, eroare: null, gata: true }
      try {
        const pachete = await tot(() => supabase.from('executie_pachete_lansare').select('id').eq('tronson_id', tronson.id), viu)
        const tevi = await totPeBucati(pachete.map(p => p.id), b => supabase.from('executie_tevi').select('id, tip_rand, sudura_cod').in('pachet_id', b), viu)
        out.coduriPachete = coduriDinPachete(tevi, tronson.cod).chei
      } catch (e) { if (!g) return; out.eroare = `pachete: ${e?.message || e}` }
      try {
        const r = await totPeBucati(confirmate.map(b => b.id), b => supabase.from('sud_buletin_randuri').select('id, buletin_id, tronson_nr, nr, sufix, refacuta, rezultat, data_inspectie').in('buletin_id', b), viu)
        out.arhiva = r.map(x => randArhivaPentruStare(x, peId.get(x.buletin_id)))
      } catch (e) { if (!g) return; out.eroare = [out.eroare, `arhivă: ${e?.message || e}`].filter(Boolean).join('; ') }
      if (g) setCtx(out)
    })()
    return () => { g = false }
  }, [tronson.id, tronson.cod, idsConfirmate]) // eslint-disable-line react-hooks/exhaustive-deps

  const cheiEliminate = useMemo(() => (Array.isArray(eliminate) ? eliminate.filter(e => e.activ).map(e => e.cheie) : null), [eliminate])
  const citireVerificata = useMemo(() => combinaSemnaleCitiri(citire, citire2Aplicata), [citire, citire2Aplicata])
  const verificari = useMemo(() => calculeazaVerificari({
    randuri, citire: citireVerificata, buletin, tronsonCod: tronson.cod, coduriPachete: ctx.gata ? ctx.coduriPachete : null, eliminate: cheiEliminate, arhiva: ctx.gata ? ctx.arhiva : null,
  }), [randuri, citireVerificata, buletin, tronson.cod, ctx, cheiEliminate])
  const pregatit = useMemo(() => pregatesteRanduriConfirmare(randuri), [randuri])
  const eroriPeRand = useMemo(() => {
    const m = {}
    for (const e of pregatit.erori) if (e.index !== null) (m[e.index] ||= []).push(e)
    return m
  }, [pregatit])

  const citeste = async (model) => {
    if (lucru) return
    if (model === 'principal' && randuri.length && !window.confirm('Tabelul are deja rânduri. Citirea cu AI le înlocuiește. Continui?')) return
    const t = ++tok.current
    setLucru(model === 'principal' ? 'citire' : 'citire2'); setMesaj(null)
    try {
      const { data, error } = await supabase.functions.invoke('izo-ndt-citeste', { body: { buletin_id: buletin.id, model } })
      const corp = error ? await corpEroareEdge(error) : null
      if (t !== tok.current) return
      const r = mapeazaRaspunsEdge({ data, error, corp })
      if (r.tip !== 'ok') { setMesaj({ c: r.tip === 'necunoscut' || r.tip === 'nepublicat' ? G.yellow : G.red, t: r.mesaj }); return }
      if (model === 'principal') {
        setCitire(r.citire); setRanduri(randuriDinCitire(r.citire)); setComparatie(null); setCitire2(null); setCitire2Aplicata(null); setAlegeri({}); setVerificat(false)
        setMesaj({ c: G.green, t: `Citite ${r.citire.randuri.length} rânduri${r.citire.model ? ` (${r.citire.model})` : ''}. Verifică-le pe PDF înainte de confirmare.` })
      } else {
        const cmp = comparaCitiri(citire, r.citire, { tronson: tNr })
        if (!cmp.ok) { setMesaj({ c: G.red, t: `Citirile nu se pot compara: ${cmp.erori.join(', ')}` }); return }
        setComparatie(cmp); setCitire2(r.citire); setAlegeri({})
        setMesaj({ c: G.blue, t: `A doua citire: ${cmp.rezumat.potrivit} rânduri potrivite, ${cmp.randuri.length - cmp.rezumat.potrivit} de ales.` })
      }
    } catch (e) {
      if (t === tok.current) setMesaj({ c: G.red, t: e?.message || String(e) })
    } finally {
      if (t === tok.current) setLucru(null)
    }
  }

  const aplicaAlegerile = () => {
    if (blocat) return
    const r = combinaCitiri(comparatie, alegeri)
    if (r.nealese.length) { setMesaj({ c: G.red, t: `Mai ai de ales pe ${r.nealese.length} rânduri.` }); return }
    // semnalele (parțial, pagini necitite, incerte, antet) ale AMBELOR citiri rămân până la confirmare
    setRanduri(r.randuri); setCitire2Aplicata(citire2); setComparatie(null); setCitire2(null); setVerificat(false)
    setMesaj({ c: G.green, t: `Tabelul are acum ${r.randuri.length} rânduri, din alegerile tale.` })
  }

  const adaugaLipite = () => {
    if (blocat) return
    const r = parseazaLipire(lipire)
    if (r.erori.length) { setMesaj({ c: G.red, t: r.erori.join(' ') }); return }
    setRanduri(x => [...x, ...r.randuri]); setLipire(null); setVerificat(false)
    const extra = [r.antetSarit && 'rândul de antet a fost sărit', r.deVerificat && `${r.deVerificat} cu codul fără cifre, marcate de verificat`].filter(Boolean)
    setMesaj({ c: r.deVerificat ? G.yellow : G.green, t: `Adăugate ${r.randuri.length} rânduri${extra.length ? ` (${extra.join('; ')})` : ''}.` })
  }

  const confirma = async () => {
    if (lucru || !pregatit.ok) return
    if (verificari.rezumat.atentie && !verificat) { setMesaj({ c: G.red, t: 'Bifează că ai verificat avertismentele pe PDF.' }); return }
    const t = ++tok.current
    setLucru('confirmare'); setMesaj(null)
    const { data, error, status } = await supabase.rpc('fn_sud_buletin_confirma', { p_id: buletin.id, p_versiune: buletin.versiune, p_randuri: pregatit.randuri })
    if (t !== tok.current) return
    setLucru(null)
    if (!error) { onSchimbat(`Buletinul ${buletin.metoda} ${buletin.numar} a fost confirmat (${data} rânduri).`); return }
    const m = mapeazaEroareRpc(error, status)
    // 40001 (versiune veche) / 55000 (nu mai e ciornă) / necunoscut: se reîncarcă buletinul; rândurile din tabel rămân pentru o nouă confirmare
    setMesaj({ c: m.tip === 'necunoscut' || m.tip === 'versiune' ? G.yellow : G.red, t: m.mesaj })
    if (['versiune', 'stare', 'necunoscut'].includes(m.tip)) onSchimbat()
  }

  // marcajul „de verificat” al lipirii rămâne cât timp codul n-are nicio cifră (corectat de om = scos)
  const schimba = (i, k, v) => {
    if (blocat) return
    setRanduri(x => x.map((r, j) => (j !== i ? r : k === 'cod_raw' && r._verifica && /\d/.test(v) ? { ...r, [k]: v, _verifica: undefined } : { ...r, [k]: v }))); setVerificat(false)
  }
  const stergeRand = i => { if (blocat) return; setRanduri(x => x.filter((_, j) => j !== i)); setVerificat(false) }
  const globale = verificari.probleme.filter(p => p.index === null)
  const ordine = { eroare: 0, atentie: 1, info: 2 }
  return (
    <div>
      <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginBottom:10 }}>
        <button style={S.btnP} onClick={() => citeste('principal')} disabled={!!lucru}>{lucru === 'citire' ? 'Se citește…' : '🤖 Citește cu AI'}</button>
        {citire && <button style={S.btnS} onClick={() => citeste('alternativ')} disabled={!!lucru}>{lucru === 'citire2' ? 'Se citește…' : 'Citește din nou cu alt model'}</button>}
        <button style={S.btnS} onClick={() => { setRanduri(x => [...x, randGol()]); setVerificat(false) }} disabled={!!lucru}>+ Rând</button>
        <button style={S.btnS} onClick={() => setLipire(lipire === null ? '' : null)} disabled={!!lucru}>📋 Lipește din Excel</button>
      </div>
      {mesaj && <Mesaj c={mesaj.c}>{mesaj.t}</Mesaj>}
      {areNesalvat && <Mesaj c={G.yellow}>⚠ {citire ? 'Citirea AI și rândurile' : 'Rândurile'} din tabel nu sunt salvate: se salvează doar la confirmare. Dacă închizi panoul înainte, se pierd{citire ? ' (iar citirea cu AI trebuie refăcută)' : ''}.</Mesaj>}
      {lipire !== null && (
        <div style={{ margin:'8px 0' }}>
          <div style={{ fontSize:12, color:G.muted }}>Coloanele, în ordine: cod, rezultat, dată, start, end, lungime, înălțime, adâncime, observații.</div>
          <textarea value={lipire} onChange={e => setLipire(e.target.value)} rows={5} style={{ ...S.input, width:'100%', fontFamily:'monospace' }} disabled={blocat} />
          <button style={S.btnS} onClick={adaugaLipite} disabled={blocat}>Adaugă rândurile</button>
        </div>
      )}
      {comparatie && <AlegeriComparatie comparatie={comparatie} alegeri={alegeri} setAlegeri={setAlegeri} blocat={blocat} onAplica={aplicaAlegerile} onRenunta={() => { if (!blocat) { setComparatie(null); setCitire2(null) } }} />}

      <div style={{ margin:'10px 0', display:'flex', flexDirection:'column', gap:4 }}>
        <div style={{ fontSize:12, fontWeight:700 }}>Verificări automate · <span style={{ color:G.yellow }}>{verificari.rezumat.atentie} avertismente</span> · <span style={{ color:G.blue }}>{verificari.rezumat.info} informații</span>{!ctx.gata && <span style={{ color:G.muted }}> · se citesc pachetele și arhiva…</span>}</div>
        {ctx.eroare && <div style={{ fontSize:12, color:G.red }}>Nu s-a putut citi: {ctx.eroare}</div>}
        {globale.sort((a, b) => ordine[a.nivel] - ordine[b.nivel]).map((p, i) => <div key={i} style={{ fontSize:12, color:CULOARE_NIVEL[p.nivel] }}>• {p.mesaj}</div>)}
      </div>

      <div style={{ overflow:'auto', maxHeight:'52vh', border:`1px solid ${G.border2}`, borderRadius:8 }}>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead><tr><th style={S.th}>#</th>{Object.keys(ETICHETA_CAMP).map(k => <th key={k} style={S.th}>{ETICHETA_CAMP[k]}</th>)}<th style={S.th} /></tr></thead>
          <tbody>
            {!randuri.length && <tr><td style={S.td} colSpan={11}>Niciun rând: citește cu AI, adaugă manual sau lipește din Excel.</td></tr>}
            {randuri.flatMap((r, i) => {
              // problemele rândului: erorile de format (blochează) + verificările (§23), colorate pe rând și scrise sub el
              const pr = [...(eroriPeRand[i] || []).map(e => ({ nivel: 'eroare', mesaj: e.mesaj, camp: e.camp })), ...(verificari.peRand[i] || [])]
              const nivel = pr.reduce((n, p) => ((ordine[p.nivel] ?? 9) < (ordine[n] ?? 9) ? p.nivel : n), 'nimic')
              const fond = nivel === 'eroare' ? G.red + '22' : nivel === 'atentie' ? G.yellow + '18' : 'transparent'
              const rez = normalizeazaRezultat(r.rezultat)
              const rand = (
                <tr key={r._id} style={{ background: fond }}>
                  <td style={S.td}>{i + 1}</td>
                  {Object.keys(ETICHETA_CAMP).map(k => (
                    <td key={k} style={{ ...S.td, minWidth: k === 'cod_raw' ? 130 : k === 'observatii' ? 140 : CAMPURI_INDICATII.includes(k) ? 54 : 84 }}>
                      <input style={{ ...S.cell, borderColor: pr.some(p => p.camp === k) ? G.red : G.border2, color: k === 'rezultat' ? (rez === 'acceptat' ? G.green : rez === 'respins' ? G.red : G.text) : G.text }}
                        value={r[k] ?? ''} onChange={e => schimba(i, k, e.target.value)} disabled={blocat} aria-label={`${ETICHETA_CAMP[k]} rând ${i + 1}`} />
                    </td>
                  ))}
                  <td style={S.td}><button style={{ ...S.btnS, padding:'2px 6px', fontSize:11 }} onClick={() => stergeRand(i)} disabled={blocat} title="Șterge rândul" aria-label={`Șterge rândul ${i + 1}`}>✕</button></td>
                </tr>
              )
              return pr.length ? [rand, <tr key={`p-${r._id}`} style={{ background: fond }}><td /><td colSpan={10} style={{ padding:'0 8px 6px', fontSize:11 }}>{pr.map((p, j) => <div key={j} style={{ color:CULOARE_NIVEL[p.nivel] }}>{p.mesaj}</div>)}</td></tr>] : [rand]
            })}
          </tbody>
        </table>
      </div>

      <div style={{ display:'flex', flexWrap:'wrap', gap:10, alignItems:'center', marginTop:12 }}>
        {verificari.rezumat.atentie > 0 && (
          <label style={{ fontSize:12, color:G.yellow, display:'flex', gap:6, alignItems:'center' }}>
            <input type="checkbox" checked={verificat} onChange={e => setVerificat(e.target.checked)} disabled={blocat} /> Am verificat avertismentele pe PDF
          </label>
        )}
        <button style={S.btnP} onClick={confirma} disabled={!!lucru || !pregatit.ok || !!comparatie}>{lucru === 'confirmare' ? 'Se confirmă…' : `✔ Confirmă ${randuri.length} rânduri`}</button>
        {!pregatit.ok && randuri.length > 0 && <span style={{ fontSize:12, color:G.red }}>{pregatit.erori.length} erori de format de corectat.</span>}
        {comparatie && <span style={{ fontSize:12, color:G.muted }}>Aplică sau renunță la a doua citire înainte de confirmare.</span>}
      </div>
      <Mesaj c={G.muted}>Rândurile se scriu o singură dată, la confirmare, și nu se mai modifică. O greșeală se corectează prin anulare și reîncărcare.</Mesaj>
    </div>
  )
}

const ETICHETA_COMPARATIE = { diferit: 'diferit', incert: 'incert', dublat: 'de două ori', doar_in_A: 'doar în prima', doar_in_B: 'doar în a doua' }
const ETICHETA_VARIANTA = { a: 'prima', b: 'a doua', pastreaza: 'păstrează', scoate: 'scoate' }
const rezumatRand = r => !r ? '—' : [r.cod_raw, r.rezultat, r.data_inspectie, ...CAMPURI_INDICATII.map(k => r[k]).filter(x => x != null && x !== ''), r.observatii].filter(x => x != null && x !== '').join(' · ')
function AlegeriComparatie({ comparatie, alegeri, setAlegeri, blocat, onAplica, onRenunta }) {
  const deAles = comparatie.randuri.filter(x => VARIANTE_ALEGERE[x.stare])
  return (
    <div style={{ margin:'10px 0', padding:10, border:`1px solid ${G.blue}66`, borderRadius:8 }}>
      <div style={{ fontSize:12, fontWeight:700, marginBottom:6 }}>A doua citire: alege varianta corectă pe fiecare rând diferit ({deAles.length})</div>
      {!comparatie.complet && <div style={{ fontSize:12, color:G.yellow }}>Cel puțin o citire e incompletă: {[...comparatie.incomplet.a.map(x => `prima ${x}`), ...comparatie.incomplet.b.map(x => `a doua ${x}`)].join(', ')}.</div>}
      {!comparatie.antet.numar.egal && <div style={{ fontSize:12, color:G.yellow }}>Numărul citit diferă: „{comparatie.antet.numar.a ?? '—'}” / „{comparatie.antet.numar.b ?? '—'}”.</div>}
      <div style={{ maxHeight:'32vh', overflow:'auto' }}>
        {deAles.map(x => (
          <div key={x.cheie} style={{ display:'flex', gap:8, alignItems:'flex-start', padding:'4px 0', borderTop:`1px solid ${G.border2}`, fontSize:12 }}>
            <div style={{ minWidth:110 }}><b>{x.cod || codDinCheie(x.cheie.split('|').slice(0, 3).join('|'))}</b>{x.refacuta && ' R'}<div style={{ color:G.yellow }}>{ETICHETA_COMPARATIE[x.stare]}{x.campuri?.length ? `: ${x.campuri.join(', ')}` : ''}</div></div>
            <div style={{ flex:1 }}>
              {VARIANTE_ALEGERE[x.stare].map(v => (
                <label key={v} style={{ display:'flex', gap:6, alignItems:'flex-start', cursor:'pointer' }}>
                  <input type="radio" name={`al-${x.cheie}`} checked={alegeri[x.cheie] === v} disabled={blocat} onChange={() => setAlegeri(a => ({ ...a, [x.cheie]: v }))} />
                  <span><b>{ETICHETA_VARIANTA[v]}</b>{v === 'a' || v === 'b' ? `: ${x.stare === 'dublat' ? (x[v] || []).map(rezumatRand).join(' | ') : rezumatRand(x[v])}` : ''}</span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div style={{ display:'flex', gap:8, marginTop:8 }}>
        <button style={S.btnP} onClick={onAplica} disabled={blocat}>Aplică alegerile</button>
        <button style={S.btnS} onClick={onRenunta} disabled={blocat}>Renunță (rămâne prima citire)</button>
      </div>
    </div>
  )
}

// ── metodele obligatorii pe proiect (D10) ───────────────────────────────
function MetodeObligatorii({ proiectId, metode, eroareMetode, poateScrie, onSchimbat }) {
  const [sel, setSel] = useState(metode || [])
  const [lucru, setLucru] = useState(false)
  const [mesaj, setMesaj] = useState(null)
  useEffect(() => { setSel(metode || []) }, [metode])
  const schimbat = metode !== null && (sel.length !== metode.length || sel.some(m => !metode.includes(m)))
  const salveaza = async () => {
    if (lucru || metode === null) return
    setLucru(true); setMesaj(null)
    const { error, status } = await supabase.rpc('fn_sud_metode_seteaza', { p_proiect: proiectId, p_metode: METODE_OBLIGABILE.filter(m => sel.includes(m)) })
    setLucru(false)
    if (!error) { onSchimbat('Metodele obligatorii au fost salvate.'); return }
    setMesaj(mapeazaEroareRpc(error, status).mesaj)
  }
  return (
    <div style={{ ...S.card, flex:'1 1 280px' }}>
      <div style={{ fontWeight:700, marginBottom:6 }}>Metode obligatorii pe proiect</div>
      {metode === null
        ? <div style={{ color:G.red, fontSize:12 }}>Setarea nu s-a putut citi{eroareMetode ? `: ${eroareMetode}` : ''}. Nu se poate modifica până nu se citește.</div>
        : <div style={{ display:'flex', gap:14, flexWrap:'wrap' }}>
            {METODE_OBLIGABILE.map(m => (
              <label key={m} style={{ fontSize:13, display:'flex', gap:6, alignItems:'center', cursor: poateScrie ? 'pointer' : 'default' }}>
                <input type="checkbox" checked={sel.includes(m)} disabled={!poateScrie || lucru} onChange={e => setSel(s => e.target.checked ? [...s, m] : s.filter(x => x !== m))} /> {m}
              </label>
            ))}
            {!metode.length && <span style={{ fontSize:12, color:G.muted }}>(nicio metodă obligatorie setată)</span>}
          </div>}
      {poateScrie && schimbat && <button style={{ ...S.btnP, marginTop:8 }} onClick={salveaza} disabled={lucru}>{lucru ? 'Se salvează…' : 'Salvează'}</button>}
      <Mesaj>{mesaj}</Mesaj>
    </div>
  )
}

// ── sudurile eliminate prin tăiere (cupon, R4) ──────────────────────────
function SuduriEliminate({ tronson, lista, poateScrie, numeOm, onSchimbat }) {
  const [f, setF] = useState({ cod: '', motiv: '', inlocuitaDe: '' })
  const [erori, setErori] = useState({})
  const [retrage, setRetrage] = useState({})    // id → motiv
  const [lucru, setLucru] = useState(false)
  const [mesaj, setMesaj] = useState(null)
  const active = (lista || []).filter(e => e.activ), retrase = (lista || []).filter(e => !e.activ)
  const marcheaza = async () => {
    const v = valideazaEliminare(f, tronson?.cod)
    setErori(v.erori); setMesaj(null)
    if (!v.ok || lucru) return
    setLucru(true)
    const { error, status } = await supabase.rpc('fn_sud_sudura_elimina', { p_tronson: tronson.id, p_cod: v.valori.cod, p_motiv: v.valori.motiv, p_inlocuita_de: v.valori.inlocuitaDe })
    setLucru(false)
    if (!error) { setF({ cod: '', motiv: '', inlocuitaDe: '' }); onSchimbat(`Sudura ${v.valori.cod} a fost marcată eliminată.`); return }
    setMesaj(mapeazaEroareRpc(error, status).mesaj)
  }
  const retrageMarcaj = async (e) => {
    const motiv = (retrage[e.id] || '').trim()
    if (motiv.length < 3) { setMesaj('Motivul retragerii e obligatoriu (cel puțin 3 caractere).'); return }
    if (lucru) return
    setLucru(true); setMesaj(null)
    const { error, status } = await supabase.rpc('fn_sud_sudura_eliminare_retrage', { p_id: e.id, p_motiv: motiv })
    setLucru(false)
    if (!error) { onSchimbat(`Marcajul pe ${e.cheie} a fost retras.`); return }
    setMesaj(mapeazaEroareRpc(error, status).mesaj)
  }
  return (
    <div style={{ ...S.card, flex:'2 1 420px' }}>
      <div style={{ fontWeight:700, marginBottom:6 }}>Suduri eliminate prin tăiere (cupon) · {tronson?.cod}</div>
      {!active.length && <div style={{ fontSize:12, color:G.muted }}>Nicio sudură eliminată pe tronson.</div>}
      {active.map(e => (
        <div key={e.id} style={{ display:'flex', flexWrap:'wrap', gap:8, alignItems:'center', padding:'5px 0', borderTop:`1px solid ${G.border2}`, fontSize:12 }}>
          <b>{e.cheie}</b><span>{e.motiv}</span>
          {e.inlocuita_de?.length > 0 && <span style={{ color:G.muted }}>→ {e.inlocuita_de.join(', ')}</span>}
          <span style={{ color:G.muted }}>{numeOm(e.creat_de)}, {fmtMoment(e.creat_la)}</span>
          {poateScrie && <>
            <input style={{ ...S.input, padding:'4px 8px', fontSize:12 }} placeholder="motivul retragerii" value={retrage[e.id] || ''} onChange={x => setRetrage(r => ({ ...r, [e.id]: x.target.value }))} />
            <button style={{ ...S.btnS, padding:'4px 8px', fontSize:12 }} onClick={() => retrageMarcaj(e)} disabled={lucru}>Retrage</button>
          </>}
        </div>
      ))}
      {retrase.length > 0 && <details style={{ marginTop:6, fontSize:12, color:G.muted }}><summary>Marcaje retrase ({retrase.length})</summary>
        {retrase.map(e => <div key={e.id}>{e.cheie} · {e.motiv} · retras de {numeOm(e.retras_de)}, {fmtMoment(e.retras_la)}: {e.retras_motiv}</div>)}</details>}
      {poateScrie && (
        <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginTop:10, alignItems:'flex-start' }}>
          {[['cod', 'Cod sudură (fără R)'], ['motiv', 'Motiv'], ['inlocuitaDe', 'Sudurile noi (opțional, ex. T12S126A T12S126B)']].map(([k, l]) => (
            <label key={k} style={{ display:'flex', flexDirection:'column', gap:3, fontSize:12, color:G.muted, flex: k === 'motiv' ? '2 1 200px' : '1 1 150px' }}>
              {l}<input style={S.input} value={f[k]} onChange={e => setF(x => ({ ...x, [k]: e.target.value }))} />
              {erori[k] && <span style={{ color:G.red }}>{erori[k]}</span>}
            </label>
          ))}
          <button style={{ ...S.btnS, alignSelf:'flex-end' }} onClick={marcheaza} disabled={lucru}>Marchează eliminată</button>
        </div>
      )}
      <Mesaj>{mesaj}</Mesaj>
    </div>
  )
}
