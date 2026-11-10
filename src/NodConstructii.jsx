// ═══════════════════════════════════════════════════════════════════════════
// NodConstructii.jsx — Execuție → proiect → „🔩 Nod cuplare” → „🏗️ Construcții” (cererea lui Răzvan, 10.11.2026)
// Elementele de construcții ale nodului (fundații, cămine, suporturi, împrejmuire, poartă, platforme…), grupate pe tip, cu procentul
// pe tip și pe grup; filtrul „🛢️ Fundații rezervoare” e primul. Atingerea unui element deschide fișa lui: etapele (făcute, cu data și cine),
// „Bifează etapa următoare” și „Retrage ultima etapă” — doar cu drept de scriere pe Execuție, prin RPC-ul fn_executie_constr_etapa.
// Date: executie_noduri_constructii (migrarea 20261207a, RLS pe dreptul Execuție). Pagina nu scrie nimic altundeva.
// L24: încărcarea, numele și salvarea au fiecare generația lor; un rezultat întârziat nu se aplică pe alt context.
// L05: o salvare cu rezultat necunoscut se reîncearcă identic (aceeași cheie) sau se reconciliază întâi cu serverul.
// ═══════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './lib/supabase.js'
import { paginareKeyset } from './hrDeciziiUtil.js'
import { ziBucuresti } from './lib/izoTeren.js'
import { aplicaRand, imbinaLista, decideReincercare, incertPune, incertSterge, scadeZile, ZILE_INAPOI } from './nodCuplareLogica.js'
import {
  progres, contorConstructii, filtreaza, grupeazaPeTip, valideazaEtapa, payloadEtapa, eticheta, etichetaGrup, ETICHETE_TIP, GRUP_PRIORITAR,
} from './nodConstructiiLogica.js'
import { G, S, useGardaAtingere } from './NodCuplareVizualizare.jsx'

const COLOANE = 'id, proiect_id, nod_cod, cod, cod_detaliu, plansa_sursa, denumire, tip, grup, echipament, cantitate, um, pozitie, certitudine, observatii, etape, etape_data, etape_de, etape_la, etapa_curenta, stare, motiv, ultima_retragere, versiune, modificat_la'
const cheieNoua = () => globalThis.crypto.randomUUID()
const fmtZi = z => (z ? String(z).split('-').reverse().join('.') : '—')
const citesteSesiune = k => { try { return sessionStorage.getItem(k) || '' } catch { return '' } }
const scrieSesiune = (k, v) => { try { sessionStorage.setItem(k, v) } catch { /* fără sessionStorage: doar în memorie */ } }
// culoarea stadiului unui element: neînceput gri, în lucru galben, gata verde, anulat gri închis; formă invalidă = alb (≠ neînceput)
const C_STADIU = { neinceput: '#8B949E', lucru: '#E3B341', gata: '#3FB950', anulat: '#3D444D', invalid: '#FFFFFF' }
const stadiu = el => { if (el.stare === 'anulat') return 'anulat'; const p = progres(el); return !p.valid ? 'invalid' : p.gata ? 'gata' : p.facute > 0 ? 'lucru' : 'neinceput' }
const textEtapa = el => { if (el.stare === 'anulat') return 'Anulat'; const p = progres(el); return !p.valid ? 'etape invalide' : p.gata ? 'Gata' : eticheta(p.urmatoare) }

// `client` se poate înlocui doar în testele de componentă (date sintetice); în aplicație e mereu clientul Supabase al sesiunii
export default function NodConstructii({ proiectId, client = supabase }) {
  const [elemente, setElemente] = useState([])
  const [eroare, setEroare] = useState(null)
  const [incarc, setIncarc] = useState(true)
  const [poateScrie, setPoateScrie] = useState(false)
  const [eroareDrept, setEroareDrept] = useState(null)
  const [nume, setNume] = useState({ harta: new Map(), eroare: false })
  const [nod, setNod] = useState('')
  const [grup, setGrup] = useState(() => citesteSesiune('nod_constr_grup'))
  const [doarNeterminate, setDoarNeterminate] = useState(false)
  const [selectat, setSelectat] = useState(null)
  const [inCurs, setInCurs] = useState(null)
  const [mesaj, setMesaj] = useState(null)
  const [azi, setAzi] = useState(ziBucuresti())
  const gen = useRef(0)              // încărcarea listei
  const genNume = useRef(0)          // numele celor care au bifat
  const fisaGen = useRef(0)          // contextul fișei: crește la deschidere / închidere / schimbarea nodului sau a proiectului
  const timerInchidere = useRef(null)
  const incerte = useRef(new Map())  // L05: id element -> { cheie, payload, seq } al unei salvări cu rezultat NECUNOSCUT
  const seqIntentie = useRef(0)
  const montat = useRef(true)

  const contextNou = () => { fisaGen.current += 1; clearTimeout(timerInchidere.current); timerInchidere.current = null }
  useEffect(() => {
    montat.current = true
    return () => { montat.current = false; clearTimeout(timerInchidere.current); timerInchidere.current = null }
  }, [])
  useEffect(() => {
    const actualizeaza = () => setAzi(z => { const n = ziBucuresti(); return n === z ? z : n })
    const t = setInterval(actualizeaza, 60000)
    const vizibil = () => { if (document.visibilityState === 'visible') actualizeaza() }
    document.addEventListener('visibilitychange', vizibil)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', vizibil) }
  }, [])

  // ── elementele proiectului (toate nodurile), keyset pe id + dreptul de scriere ──
  const incarca = useCallback(async () => {
    const g = ++gen.current
    setIncarc(true); setEroare(null); setEroareDrept(null)
    try {
      const [toate, drept] = await Promise.all([
        paginareKeyset((ultim, pas) => {
          let q = client.from('executie_noduri_constructii').select(COLOANE).eq('proiect_id', proiectId).order('id').limit(pas)
          if (ultim != null) q = q.gt('id', ultim)
          return q
        }),
        client.rpc('fn_executie_nod_drept', { p_proiect: proiectId, p_scriere: true }),
      ])
      if (g !== gen.current) return
      setElemente(curente => imbinaLista(toate.filter(r => r.proiect_id === proiectId), curente))
      if (drept.error) { setPoateScrie(false); setEroareDrept('Nu am putut verifica dreptul de scriere: ' + drept.error.message) }
      else setPoateScrie(drept.data === true)
      setAzi(ziBucuresti())
    } catch (e) {
      if (g !== gen.current) return
      setElemente([]); setEroare('Nu am putut încărca elementele de construcții: ' + (e?.message || e))
    } finally { if (g === gen.current) setIncarc(false) }
  }, [proiectId, client])
  useEffect(() => {
    contextNou(); incerte.current = new Map()
    setElemente([]); setNod(''); setSelectat(null); setMesaj(null); setNume({ harta: new Map(), eroare: false })
    incarca()
  }, [incarca])

  // ── numele celor care au bifat (doar afișare; o eroare se arată, nu devine „nimeni”) ──
  const idsBifatori = useMemo(() => [...new Set(elemente.flatMap(e => (Array.isArray(e.etape_de) ? e.etape_de : []).filter(Boolean)))].sort(), [elemente])
  const cheieIds = idsBifatori.join(',')
  useEffect(() => {
    const g = ++genNume.current
    if (!idsBifatori.length) return undefined
    client.from('profiles').select('id, name').in('id', idsBifatori).then(({ data, error }) => {
      if (g !== genNume.current) return
      if (error) { setNume(n => ({ ...n, eroare: true })); return }
      setNume({ harta: new Map((data || []).map(p => [p.id, p.name])), eroare: false })
    }, () => { if (g === genNume.current) setNume(n => ({ ...n, eroare: true })) })
    return () => { genNume.current += 1 }
  }, [cheieIds, client]) // eslint-disable-line react-hooks/exhaustive-deps

  const noduri = useMemo(() => [...new Set(elemente.map(e => e.nod_cod))].sort(), [elemente])
  useEffect(() => { if (!nod && noduri.length) setNod(noduri[0]) }, [nod, noduri])
  const aleNodului = useMemo(() => elemente.filter(e => e.nod_cod === nod), [elemente, nod])
  const c = useMemo(() => contorConstructii(aleNodului, azi), [aleNodului, azi])
  const grupuriNod = useMemo(() => c.peGrup.map(x => x.cheie), [c])
  // filtrul salvat pe alt nod / alt proiect: dacă grupul nu există aici, se arată tot (nu o listă goală fără motiv)
  const grupActiv = grup && grupuriNod.includes(grup) ? grup : ''
  const filtrate = useMemo(() => filtreaza(aleNodului, { grup: grupActiv, doarNeterminate }), [aleNodului, grupActiv, doarNeterminate])
  const peTip = useMemo(() => grupeazaPeTip(filtrate), [filtrate])
  const elSel = aleNodului.find(e => String(e.id) === String(selectat)) || null

  const alegeGrup = g => { setGrup(g); scrieSesiune('nod_constr_grup', g) }
  const schimbaNod = n => { contextNou(); setNod(n); setSelectat(null); setMesaj(null) }

  // ── fișa ──
  const reconciliaza = async (id, cheie, fortat, g) => {
    let data = null, error = null
    try { ({ data, error } = await client.from('executie_noduri_constructii').select(COLOANE).eq('id', id).maybeSingle()) } catch (e) { error = e }
    if (!montat.current) return false
    if (error) { if (g === fisaGen.current) setMesaj({ ok: false, text: 'Nu am putut reîncărca elementul: ' + (error.message || error) }); return false }
    if (data) setElemente(list => aplicaRand(list, data))
    const intrare = incerte.current.get(id)
    if (intrare && intrare.cheie === cheie && (fortat || !data || Number(data.versiune) !== Number(intrare.payload.p_versiune))) {
      incerte.current = incertSterge(incerte.current, id, cheie)
    }
    return true
  }
  const deschide = id => { contextNou(); setSelectat(id); setMesaj(null) }
  const inchide = () => {
    const intrare = selectat != null ? incerte.current.get(selectat) : null
    if (intrare) reconciliaza(selectat, intrare.cheie, false, -1)
    contextNou(); setSelectat(null); setMesaj(null)
  }

  const salveaza = async form => {
    const el = elSel
    const g = fisaGen.current
    if (!el || inCurs === g) return
    const payload = payloadEtapa(el, form)
    const intrare = incerte.current.get(el.id)
    const decizie = decideReincercare(intrare, payload)
    if (decizie === 'reconciliere') {
      setInCurs(g)
      const ok = await reconciliaza(el.id, intrare.cheie, true, g)
      if (!montat.current) return
      setInCurs(x => (x === g ? null : x))
      if (ok && g === fisaGen.current) setMesaj({ ok: false, text: 'Cererea anterioară avea rezultat necunoscut; am adus starea reală a elementului. Verifică și confirmă din nou.' })
      return
    }
    const cheie = decizie === 'aceeasi' ? intrare.cheie : cheieNoua()
    const seq = decizie === 'aceeasi' ? intrare.seq : ++seqIntentie.current
    setInCurs(g); setMesaj(null)
    let r = null, error = null
    try { ({ data: r, error } = await client.rpc('fn_executie_constr_etapa', { ...payload, p_cheie: cheie })) } catch (e) { error = e }
    if (error) incerte.current = incertPune(incerte.current, payload.p_id, { cheie, payload, seq })
    else {
      incerte.current = incertSterge(incerte.current, payload.p_id, cheie)
      if (r?.element) setElemente(list => aplicaRand(list, r.element))
    }
    if (!montat.current) return
    setInCurs(x => (x === g ? null : x))
    if (g !== fisaGen.current) return
    if (error) setMesaj({ ok: false, text: 'Nu se știe dacă s-a salvat (' + (error.message || error) + '). Apasă din nou „Confirmă” fără să schimbi nimic; dacă schimbi ceva, întâi reîncarc elementul.' })
    else if (r?.ok) {
      setMesaj({ ok: true, text: r.duplicat ? 'Era deja salvat.' : 'Salvat.' })
      timerInchidere.current = setTimeout(() => { if (montat.current && g === fisaGen.current) { contextNou(); setSelectat(null); setMesaj(null) } }, 700)
    } else setMesaj({ ok: false, text: 'Elementul a fost schimbat între timp (altă apăsare sau alt utilizator). Am adus starea actuală — verifică și reîncearcă.' })
  }

  if (incarc && !elemente.length) return <Cadru><div style={{ color: G.dim, padding: 30, textAlign: 'center' }}>Se încarcă…</div></Cadru>
  if (eroare) return <Cadru><Alerta text={eroare} /><button onClick={incarca} style={{ ...S.btn, marginTop: 10 }}>Reîncearcă</button></Cadru>
  if (!noduri.length) return <Cadru><div style={{ color: G.muted, padding: 20, fontSize: 14 }}>Niciun element de construcții pe acest proiect (sau nu ai drept de citire pe Execuție). Lista nu este încă încărcată.</div></Cadru>

  const prioritar = c.peGrup.find(x => x.cheie === GRUP_PRIORITAR)
  const altele = c.peGrup.filter(x => x.cheie !== GRUP_PRIORITAR)
  return (
    <Cadru>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: G.text }}>🏗️ Construcții nod</div>
        {noduri.length > 1
          ? <select value={nod} onChange={e => schimbaNod(e.target.value)} style={{ ...S.input, width: 'auto', padding: '6px 10px', fontSize: 14 }}>{noduri.map(n => <option key={n} value={n}>{n}</option>)}</select>
          : <span style={{ fontSize: 13, color: G.muted, fontWeight: 700 }}>{nod}</span>}
        <button onClick={incarca} style={{ ...S.btn, marginLeft: 'auto', padding: '6px 12px', fontSize: 13 }}>↻ Reîncarcă</button>
      </div>
      <Contor c={c} azi={azi} />
      {eroareDrept && <Alerta text={eroareDrept} />}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '12px 0 6px' }}>
        {prioritar && <ChipGrup st={prioritar} activ={grupActiv === prioritar.cheie} onClick={() => alegeGrup(grupActiv === prioritar.cheie ? '' : prioritar.cheie)} mare />}
        <button onClick={() => alegeGrup('')} style={S.chip(grupActiv === '', G.blue)}>Toate ({c.n})</button>
        {altele.map(st => <ChipGrup key={st.cheie} st={st} activ={grupActiv === st.cheie} onClick={() => alegeGrup(grupActiv === st.cheie ? '' : st.cheie)} />)}
      </div>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: G.muted, margin: '4px 0 10px', minHeight: 32 }}>
        <input type="checkbox" checked={doarNeterminate} onChange={e => setDoarNeterminate(e.target.checked)} style={{ width: 18, height: 18 }} /> Doar nefinalizate
      </label>

      {peTip.length === 0 && <div style={{ color: G.muted, fontSize: 13, padding: '10px 0' }}>Niciun element după filtre.</div>}
      {peTip.map(gr => (
        <div key={gr.tip} style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '6px 2px', borderBottom: `1px solid ${G.border2}`, marginBottom: 6 }}>
            <span style={{ fontSize: 15, fontWeight: 800, color: G.text }}>{gr.eticheta}</span>
            <span style={{ fontSize: 12, color: G.green, fontWeight: 700 }}>{gr.pct == null ? '—' : `${gr.pct}%`}</span>
            <span style={{ fontSize: 12, color: G.muted }}>· gata {gr.gata} din {gr.n}{gr.invalide ? ` · ${gr.invalide} cu etape invalide` : ''}</span>
          </div>
          {gr.elemente.map(el => <RandElement key={el.id} el={el} onClick={() => deschide(el.id)} />)}
        </div>
      ))}
      <Legenda />

      <FisaElement el={elSel} poateScrie={poateScrie} azi={azi} nume={nume} onSalveaza={salveaza} onInchide={inchide}
        busy={inCurs != null && inCurs === fisaGen.current} mesaj={mesaj} />
    </Cadru>
  )
}

function Cadru({ children }) {
  return <div style={{ padding: '14px 12px 30px', maxWidth: 1200, margin: '0 auto', color: G.text }}>{children}</div>
}
function Alerta({ text }) {
  return <div style={{ margin: '8px 0', padding: '9px 12px', borderRadius: 10, background: G.red + '1F', color: G.red, fontSize: 13, fontWeight: 600 }}>{text}</div>
}

function Contor({ c, azi }) {
  const mare = (et, val, cul) => (
    <div style={{ flex: 1, minWidth: 0, background: G.surface, border: `1px solid ${G.border2}`, borderRadius: 12, padding: '8px 10px', textAlign: 'center' }}>
      <div style={{ fontSize: 24, fontWeight: 800, color: cul, lineHeight: 1.1 }}>{val}</div>
      <div style={{ fontSize: 11, color: G.muted, fontWeight: 600 }}>{et}</div>
    </div>
  )
  return (
    <div>
      <div style={{ display: 'flex', gap: 8 }}>
        {mare(`etape azi ${fmtZi(azi).slice(0, 5)}`, c.azi, G.blue)}
        {mare(`elemente gata din ${c.n}`, c.gata, G.green)}
        {mare('progres (etape)', c.pct == null ? '—' : `${c.pct}%`, G.yellow)}
      </div>
      {c.invalide > 0 && <div style={{ marginTop: 6, fontSize: 12, color: G.red, fontWeight: 700 }}>⚠️ {c.invalide} elemente au lista de etape invalidă (nu intră în procent)</div>}
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', marginTop: 8, paddingBottom: 2 }}>
        {c.peTip.map(t => (
          <div key={t.cheie} style={{ flexShrink: 0, background: G.surface, border: `1px solid ${G.border2}`, borderRadius: 10, padding: '5px 9px', fontSize: 12, color: G.text, whiteSpace: 'nowrap' }}>
            <b>{t.eticheta}</b><span style={{ color: G.green }}> {t.pct == null ? '—' : `${t.pct}%`}</span><span style={{ color: G.muted }}> · {t.gata}/{t.n} gata</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function ChipGrup({ st, activ, onClick, mare = false }) {
  return (
    <button onClick={onClick} style={{ ...S.chip(activ, mare ? G.yellow : G.blue), ...(mare ? { fontSize: 13, padding: '7px 12px', fontWeight: 800 } : {}) }}>
      {etichetaGrup(st.cheie)} <span style={{ color: G.green }}>{st.pct == null ? '—' : `${st.pct}%`}</span> <span style={{ color: G.dim }}>({st.n})</span>
    </button>
  )
}

function Puncte({ el }) {
  const p = progres(el)
  if (!p.valid) return <span style={{ fontSize: 11, color: G.red }}>!</span>
  return (
    <span style={{ display: 'inline-flex', gap: 2, flexShrink: 0 }} aria-label={`${p.facute} din ${p.total} etape`}>
      {el.etape.map((e, i) => <span key={e} style={{ width: 7, height: 7, borderRadius: '50%', background: i < p.facute ? G.green : G.border }} />)}
    </span>
  )
}

function RandElement({ el, onClick }) {
  const st = stadiu(el)
  const cant = !(el.um === 'buc' && Number(el.cantitate) === 1) ? ` · ${String(el.cantitate).replace('.', ',')} ${el.um}` : ''
  return (
    <button onClick={onClick} style={{ ...S.btn, width: '100%', display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, minHeight: 52, textAlign: 'left', opacity: st === 'anulat' ? 0.6 : 1 }}>
      <span style={{ width: 14, height: 14, borderRadius: '50%', background: C_STADIU[st], border: `2px solid ${st === 'invalid' ? G.red : '#FFF'}`, flexShrink: 0 }} />
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <b style={{ whiteSpace: 'nowrap', textDecoration: st === 'anulat' ? 'line-through' : 'none' }}>{el.cod}</b>
          <span style={{ fontSize: 12, color: C_STADIU[st] === '#FFFFFF' ? G.red : C_STADIU[st], fontWeight: 700, whiteSpace: 'nowrap' }}>{textEtapa(el)}</span>
          {el.certitudine !== 'sigur' && <span style={{ fontSize: 10, color: G.yellow, border: `1px solid ${G.yellow}66`, borderRadius: 6, padding: '0 4px', whiteSpace: 'nowrap' }}>de confirmat</span>}
          <span style={{ marginLeft: 'auto' }}><Puncte el={el} /></span>
        </span>
        <span style={{ display: 'block', fontSize: 12, color: G.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>{el.denumire}{cant}</span>
      </span>
    </button>
  )
}

function Legenda() {
  const L = [['neinceput', 'Neînceput'], ['lucru', 'În lucru'], ['gata', 'Gata'], ['anulat', 'Anulat']]
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, fontSize: 11, color: G.muted, marginTop: 4 }}>
      {L.map(([k, t]) => <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ width: 11, height: 11, borderRadius: '50%', background: C_STADIU[k], border: `1px solid ${G.text}55` }} />{t}</span>)}
    </div>
  )
}

// ── fișa elementului: detaliile, etapele, bifarea etapei următoare / retragerea ultimei ──
function FisaElement({ el, poateScrie, azi, nume, onSalveaza, onInchide, busy, mesaj }) {
  const [actiune, setActiune] = useState(null)
  const [data, setData] = useState(azi)
  const [motiv, setMotiv] = useState('')
  useEffect(() => { setActiune(null); setData(azi); setMotiv('') }, [el?.id, el?.versiune, azi])
  const paza = useGardaAtingere(el?.id)
  if (!el) return null
  const p = progres(el)
  const erori = actiune ? valideazaEtapa({ actiune, element: el, data, azi, motiv }) : []
  const cine = i => {
    const u = Array.isArray(el.etape_de) ? el.etape_de[i] : undefined
    if (u === null) return 'stadiu inițial (din import)'
    if (nume.harta.has(u)) return nume.harta.get(u) || 'fără nume'
    return nume.eroare ? 'nume indisponibil' : 'nume necunoscut'
  }
  const rand = (et, val) => (
    <div style={{ display: 'flex', gap: 8, padding: '5px 0', borderBottom: `1px solid ${G.border2}`, fontSize: 14 }}>
      <span style={{ color: G.muted, width: 110, flexShrink: 0 }}>{et}</span><span style={{ color: G.text, minWidth: 0, overflowWrap: 'anywhere' }}>{val || '—'}</span>
    </div>
  )
  const st = stadiu(el)
  return (
    <div onClick={onInchide} onClickCapture={paza} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 1000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: G.surface, borderTop: `1px solid ${G.border}`, borderRadius: '16px 16px 0 0', width: '100%', maxWidth: 560, maxHeight: '88vh', overflowY: 'auto', padding: '16px 16px 24px', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <span style={{ width: 18, height: 18, borderRadius: '50%', background: C_STADIU[st], border: '2px solid #FFF' }} />
          <span style={{ fontSize: 22, fontWeight: 800, color: G.text }}>{el.cod}</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: C_STADIU[st] === '#FFFFFF' ? G.red : C_STADIU[st] }}>{textEtapa(el)}{p.valid ? ` · ${p.facute}/${p.total}` : ''}</span>
          <button onClick={onInchide} style={{ ...S.btn, marginLeft: 'auto', padding: '4px 12px' }} aria-label="Închide">✕</button>
        </div>
        <div style={{ fontSize: 14, color: G.text, fontWeight: 600, marginBottom: 8 }}>{el.denumire}</div>
        {rand('Planșă detaliu', el.cod_detaliu)}
        {rand('Planșă sursă', el.plansa_sursa)}
        {rand('Tip', ETICHETE_TIP[el.tip] || el.tip)}
        {rand('Legătură', [etichetaGrup(el.grup), el.echipament].filter(Boolean).join(' · '))}
        {rand('Cantitate', `${String(el.cantitate).replace('.', ',')} ${el.um}`)}
        {rand('Poziție', el.pozitie)}
        {rand('Certitudine', el.certitudine === 'sigur' ? 'sigur' : 'de confirmat (cantitate / poziție citite de pe planșă)')}
        {el.observatii && rand('Observații', el.observatii)}
        {el.stare === 'anulat' && rand('Anulat', el.motiv)}
        {el.ultima_retragere && rand('Ultima retragere', el.ultima_retragere)}

        <div style={{ ...S.label, marginTop: 14 }}>Etape</div>
        {p.valid ? el.etape.map((e, i) => (
          <div key={e} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', fontSize: 14, borderBottom: `1px solid ${G.border2}` }}>
            <span style={{ width: 22, textAlign: 'center', color: i < p.facute ? G.green : i === p.facute ? G.yellow : G.dim, fontWeight: 800 }}>{i < p.facute ? '✓' : i === p.facute ? '▸' : '○'}</span>
            <span style={{ color: i < p.facute ? G.text : G.muted, fontWeight: i === p.facute ? 700 : 500 }}>{eticheta(e)}</span>
            {i < p.facute && <span style={{ marginLeft: 'auto', fontSize: 12, color: G.muted, textAlign: 'right' }}>{fmtZi(el.etape_data[i])} · {cine(i)}</span>}
          </div>
        )) : <Alerta text="Lista de etape a elementului e invalidă: se corectează la import." />}

        {poateScrie && el.stare === 'activ' && p.valid && (
          <div style={{ marginTop: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
              {!p.gata && (
                <button onClick={() => setActiune(a => (a === 'bifeaza' ? null : 'bifeaza'))}
                  style={{ ...S.btn, minHeight: 48, background: actiune === 'bifeaza' ? G.green : G.surface2, color: actiune === 'bifeaza' ? '#0D1117' : G.text, borderColor: G.green }}>
                  ✓ Bifează: {eticheta(p.urmatoare)}
                </button>
              )}
              {p.facute > 0 && (
                <button onClick={() => setActiune(a => (a === 'retrage' ? null : 'retrage'))}
                  style={{ ...S.btn, minHeight: 48, background: actiune === 'retrage' ? G.red : G.surface2, color: actiune === 'retrage' ? '#FFF' : G.text, borderColor: G.red }}>
                  ↩ Retrage: {eticheta(p.ultima)}
                </button>
              )}
            </div>
            {actiune && (
              <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
                {actiune === 'bifeaza' && <div><label style={S.label}>Ziua execuției</label>
                  <input type="date" value={data} min={p.ultimaData && p.ultimaData > scadeZile(azi, ZILE_INAPOI) ? p.ultimaData : scadeZile(azi, ZILE_INAPOI)} max={azi}
                    onChange={e => setData(e.target.value)} style={S.input} /></div>}
                {actiune === 'retrage' && <div><label style={S.label}>De ce se retrage (obligatoriu)</label>
                  <input value={motiv} maxLength={500} onChange={e => setMotiv(e.target.value)} style={S.input} placeholder="ex. bifat din greșeală" /></div>}
                {erori.length > 0 && <div style={{ fontSize: 12, color: G.yellow }}>{erori.join(' · ')}</div>}
                <button disabled={busy || erori.length > 0}
                  onClick={() => onSalveaza({ actiune, data, motiv })}
                  style={{ ...S.btn, minHeight: 52, fontSize: 16, background: erori.length ? G.border : actiune === 'retrage' ? G.red : G.green, color: erori.length ? G.muted : actiune === 'retrage' ? '#FFF' : '#0D1117', border: 'none', opacity: busy ? 0.6 : 1 }}>
                  {busy ? 'Se salvează…' : actiune === 'bifeaza' ? `✓ Confirmă: ${el.cod} — ${eticheta(p.urmatoare)} (${fmtZi(data)})` : `↩ Confirmă retragerea: ${el.cod} — ${eticheta(p.ultima)}`}
                </button>
              </div>
            )}
          </div>
        )}
        {!poateScrie && <div style={{ marginTop: 12, fontSize: 12, color: G.dim }}>Doar citire: bifarea etapelor cere drept de scriere pe Execuție.</div>}
        {mesaj && <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 10, fontSize: 13, fontWeight: 600, background: (mesaj.ok ? G.green : G.red) + '22', color: mesaj.ok ? G.green : G.red }}>{mesaj.text}</div>}
      </div>
    </div>
  )
}
