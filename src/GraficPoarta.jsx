// ════════════════════════════════════════════════════════════════
// GraficPoarta.jsx — „Poarta grafic" + generatorul de grafic (mod ofertă / intern)
// Folosit de GraficLucrare.jsx pentru licitații (tip = 'licitatie').
// Idee (decizie Răzvan 03–04.09.2026): butonul „Generează grafic" e inactiv
// până când platforma are TOATE intrările obligatorii; la apăsare se îngheață
// un instantaneu (parametri + cantități + norme + cerințe) în grafic_versiuni.
// Mod OFERTĂ: activitățile se întind pe durata ofertată (un grafic strâmt e
// folosit împotriva noastră), se expun doar jaloanele cerute.
// Mod INTERN: durate din norme, cu rezerva vizibilă.
// Norme: ofertare_norme_productivitate (PE_LANT validat 100 m/zi/echipă).
// ════════════════════════════════════════════════════════════════
import { useState, useEffect, useMemo } from 'react'
import { supabase } from './lib/supabase.js'

const G = {
  bg:'#0D1117', surface:'#161B22', card:'#1C2128', border:'#30363D', border2:'#21262D',
  text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  accent:'#3FB6E2', green:'#3FB950', blue:'#58A6FF', orange:'#F0883E',
  yellow:'#E3B341', red:'#F85149', purple:'#A371F7',
}
const S = {
  input: { boxSizing:'border-box', background:G.bg, border:`1px solid ${G.border2}`, borderRadius:6, padding:'5px 8px', color:G.text, fontSize:12, outline:'none', width:'100%' },
  btnP: { padding:'8px 16px', background:G.accent, color:'#0D1117', border:'none', borderRadius:7, cursor:'pointer', fontSize:13, fontWeight:700 },
  btnS: { padding:'8px 16px', background:G.surface, color:G.text, border:`1px solid ${G.border2}`, borderRadius:7, cursor:'pointer', fontSize:13 },
  card: { background:G.card, border:`1px solid ${G.border}`, borderRadius:10 },
}

const PARAM_DEFAULT = {
  tip_lucrare: 'retea_pehd',
  mod: 'oferta',                 // oferta | intern
  data_start: '',                // data presupusă a ordinului de începere
  durata_luni: null,             // durata ofertată (≤ maxim din cerințe)
  cantitati_asumate: '',         // memoriu | plansa  (care coloană din cantități e baza)
  echipe: 2,                     // echipe de rețea simultane (fronturi în paralel)
  mediu: 'sat',                  // sat | oras (coef. teren greu)
  iarna: true,                   // întrerupere tehnologică explicită dec–feb
  os_zile: 15, procurare_zile: 60, receptie_zile: 30,
  include_bransamente: null,     // true | false — decizie explicită
  nr_bransamente: 0,
  srm: false, srm_zile: 120,
  fronturi: [],                  // [{nume, lungime_m, dn, echipe}]
  jaloane: ['Ordin administrativ de începere', 'Predare / preluare amplasament', 'Recepție la terminarea lucrărilor'],
  ferestre_operator: '',         // text liber: cuplări, avize, autorizații spargere
}

const zileLuni = (luni) => Math.round((Number(luni) || 0) * 30.44)
const addZile = (iso, n) => { if (!iso) return ''; const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }

// ── Motorul PEHD: cantități + norme + parametri → rânduri (id temporar negativ) ──
export function motorPEHD(p, norme) {
  const pe = norme.find(n => n.cod === 'PE_LANT')
  const norma = Number(pe?.productie_zi) || 100
  const coefTeren = p.mediu === 'oras' ? (Number(pe?.coef_teren_greu) || 0.6) : 1
  const coefIarna = p.iarna ? 1 : (Number(pe?.coef_iarna) || 0.7)   // fără oprire explicită, iarna intră ca randament mediu
  const rows = []
  let idc = 0
  const add = (r) => { idc--; rows.push({ id: idc, jalon: false, nivel: 1, predecesori: [], ...r }); return idc }

  // 1. Jaloane cerute
  const ordin = add({ denumire: p.jaloane?.[0] || 'Ordin administrativ de începere', durata_zile: 0, jalon: true, nivel: 0, resurse: 'Beneficiar' })
  const predare = add({ denumire: p.jaloane?.[1] || 'Predare / preluare amplasament', durata_zile: 0, jalon: true, nivel: 0, resurse: 'Beneficiar', predecesori: [{ id: ordin, tip: 'FS', lag: 1 }] })
  // 2. Organizare de șantier
  const os = add({ denumire: 'Organizare de șantier + mobilizare', durata_zile: p.os_zile || 15, nivel: 0, resurse: 'Executant', predecesori: [{ id: predare, tip: 'FS', lag: 0 }] })
  // 3. Procurare materiale (paralel, lung)
  const cmd = add({ denumire: 'Emitere comenzi de aprovizionare (țeavă PE, fitinguri, robineți)', durata_zile: 5, nivel: 0, resurse: 'Executant', predecesori: [{ id: ordin, tip: 'FS', lag: 0 }] })
  const livr = add({ denumire: 'Livrări eșalonate materiale', durata_zile: p.procurare_zile || 60, nivel: 0, resurse: 'Executant', predecesori: [{ id: cmd, tip: 'FS', lag: 0 }] })
  const primaLivrare = { id: livr, tip: 'SS', lag: Math.min(20, p.procurare_zile || 60), _mat: true }
  // 4. SRM (dacă e în contract)
  let srmFin = null
  if (p.srm) {
    const f = add({ denumire: 'SRM — fundații, împrejmuire, montaj echipamente', durata_zile: Math.round((p.srm_zile || 120) * 0.75), nivel: 0, resurse: 'Echipă SRM + subcontractor', predecesori: [{ id: os, tip: 'FS', lag: 0 }, primaLivrare], _fix: true })
    srmFin = add({ denumire: 'SRM — probe, verificări ISCIR/ANRE, PIF', durata_zile: Math.round((p.srm_zile || 120) * 0.25), nivel: 1, resurse: 'Echipă SRM', predecesori: [{ id: f, tip: 'FS', lag: 0 }], _fix: true })
  }
  // 5. Fronturi de lucru: round-robin pe echipe → lanțuri secvențiale per echipă
  const nEch = Math.max(1, Number(p.echipe) || 1)
  const ultimPeEchipa = Array(nEch).fill(null)
  const probeIds = []
  ;(p.fronturi || []).forEach((f, i) => {
    const L = Number(f.lungime_m) || 0
    if (!L) return
    const ech = Math.max(1, Number(f.echipe) || 1)
    const k = i % nEch
    const zileLant = Math.max(3, Math.ceil(L / (norma * ech * coefTeren * coefIarna)))
    const predStart = ultimPeEchipa[k] ? [{ id: ultimPeEchipa[k], tip: 'FS', lag: 0 }] : [{ id: os, tip: 'FS', lag: 0 }, primaLivrare]
    const titlu = add({ denumire: `${f.nume || 'Front ' + (i + 1)} — ${f.dn ? 'Dn' + f.dn + ', ' : ''}${L.toLocaleString('ro-RO')} m`, durata_zile: zileLant + 4, nivel: 0, resurse: `Echipa ${k + 1}`, predecesori: predStart, _grup: true })
    const sap = add({ denumire: 'Trasare, autorizații spargere și săpătură șanț', durata_zile: zileLant, resurse: `Echipa ${k + 1} · excavator`, predecesori: predStart })
    const mon = add({ denumire: 'Sudare PE + pozare conductă, fir trasor, bandă avertizare', durata_zile: zileLant, resurse: `Echipa ${k + 1} · sudor PE`, predecesori: [{ id: sap, tip: 'SS', lag: 2 }] })
    const ast = add({ denumire: 'Măsurători GIS șanț deschis + astupare, compactare', durata_zile: zileLant, resurse: `Echipa ${k + 1}`, predecesori: [{ id: mon, tip: 'SS', lag: 2 }] })
    let ultim = ast
    if (p.include_bransamente && p.nr_bransamente) {
      const nb = Math.round((Number(p.nr_bransamente) || 0) * L / Math.max(1, totalFronturi(p)))
      if (nb > 0) {
        const zb = Math.max(2, Math.ceil(nb / 2.5))
        ultim = add({ denumire: `Branșamente + răsuflători + PRM (~${nb} buc)`, durata_zile: zb, resurse: 'Echipă branșamente', predecesori: [{ id: mon, tip: 'SS', lag: 10 }] })
      }
    }
    const nrTr = Math.max(1, Math.ceil(L / 3000))
    const prob = add({ denumire: `Probe de presiune pe tronsoane (${nrTr} × 2 zile)`, durata_zile: nrTr * 2, resurse: `Echipa ${k + 1} · metrolog`, predecesori: [{ id: ast, tip: 'FS', lag: 0 }, ...(ultim !== ast ? [{ id: ultim, tip: 'FS', lag: 0 }] : [])] })
    const ref = add({ denumire: 'Refacere teren, alei, trotuare, carosabil', durata_zile: Math.max(3, Math.ceil(zileLant * 0.4)), resurse: `Echipa ${k + 1}`, predecesori: [{ id: prob, tip: 'FS', lag: 0 }] })
    probeIds.push(prob)
    ultimPeEchipa[k] = ref
    rows.find(r => r.id === titlu).durata_zile = 0 // grupul e doar titlu vizual (durata 0, nivel 0)
  })
  // 6. Cuplări + recepție
  const preds = [...ultimPeEchipa.filter(Boolean).map(id => ({ id, tip: 'FS', lag: 0 })), ...(srmFin ? [{ id: srmFin, tip: 'FS', lag: 0 }] : [])]
  const cupl = add({ denumire: 'Cuplări la rețea / SRM în ferestrele agreate cu operatorul, PIF pe tronsoane', durata_zile: 10, nivel: 0, resurse: 'Executant + OSD', predecesori: preds })
  const ctc = add({ denumire: 'Documentație topografică GIS, carte tehnică, probe finale', durata_zile: p.receptie_zile || 30, nivel: 0, resurse: 'Executant', predecesori: [{ id: cupl, tip: 'FS', lag: 0 }] })
  const rec = add({ denumire: p.jaloane?.[2] || 'Recepție la terminarea lucrărilor', durata_zile: 0, jalon: true, nivel: 0, resurse: 'Beneficiar, Executant', predecesori: [{ id: ctc, tip: 'FS', lag: 0 }] })

  // 7. Mod OFERTĂ: întindem execuția pe durata ofertată (rezervă finală păstrată la recepție)
  const tinta = zileLuni(p.durata_luni)
  const intern = cpmTotal(rows)
  let factor = 1
  if (p.mod === 'oferta' && tinta > 0 && intern > 0) {
    // scalăm doar activitățile de execuție din fronturi (nivel 1, fără _fix); iterativ,
    // pentru că lanțurile SS/FS nu sunt liniare — ne oprim când totalul intră în țintă (−15 zile rezervă)
    const scal = rows.filter(r => !r.jalon && r.nivel === 1 && !r._fix && r.durata_zile > 0)
    const baza = scal.map(r => r.durata_zile)
    const lagBaza = rows.map(r => r.predecesori.map(x => x.lag || 0))
    for (let it = 0, f = 1; it < 8; it++) {
      const tot = cpmTotal(rows)  // lanțurile SS/FS nu-s liniare → corecție proporțională repetată
      const tintaEf = tinta - 15
      if (Math.abs(tot - tintaEf) <= 3 && tot <= tinta) break
      f = f * (tintaEf / Math.max(1, tot))
      if (f < 1) { f = 1 }
      factor = f
      scal.forEach((r, i) => { r.durata_zile = Math.max(1, Math.round(baza[i] * f)) })
      rows.forEach((r, i) => { r.predecesori = r.predecesori.map((x, j) => ({ ...x, lag: x.tip === 'SS' && lagBaza[i][j] && !x._mat ? Math.round(lagBaza[i][j] * f) : lagBaza[i][j] })) })
    }
  }
  // 8. Iarnă: rând informativ (nu constrânge CPM-ul) plasat la 1 dec după start
  if (p.iarna && p.data_start && (p.durata_luni || 0) > 8) {
    const d0 = new Date(p.data_start + 'T00:00:00')
    const dec = new Date(d0.getFullYear() + (d0.getMonth() >= 11 ? 1 : 0), 11, 1)
    const lag = Math.round((dec - d0) / 86400000)
    const tot = cpmTotal(rows)
    for (let an = 0; lag + an * 365 + 75 <= tot; an++) {
      add({ denumire: `Întrerupere tehnologică de iarnă (${dec.getFullYear() + an}–${dec.getFullYear() + an + 1}) — fără montaj PE sub 0 °C`, durata_zile: 75, nivel: 0, resurse: '—', predecesori: [{ id: ordin, tip: 'FS', lag: lag + an * 365 }], note: 'informativ: activitățile din fronturi sunt deja întinse peste această perioadă' })
    }
  }
  rows.forEach((r, i) => { r.ordine = i + 1; delete r._grup; delete r._fix; r.predecesori = r.predecesori.map(({ _mat, ...x }) => x) })
  return { rows, factor, intern, total: cpmTotal(rows) }
}
const totalFronturi = (p) => (p.fronturi || []).reduce((s, f) => s + (Number(f.lungime_m) || 0), 0)

// CPM minimal (forward pass) pe rânduri cu id temporar — durata totală
function cpmTotal(rows) {
  const es = {}, ef = {}; const done = new Set(); let pass = 0
  while (done.size < rows.length && pass < rows.length + 5) {
    pass++
    for (const r of rows) {
      if (done.has(r.id)) continue
      const preds = (r.predecesori || [])
      if (preds.some(p => !done.has(p.id))) continue
      let s = 0
      for (const p of preds) { const c = p.tip === 'SS' ? es[p.id] + (p.lag || 0) : ef[p.id] + (p.lag || 0); if (c > s) s = c }
      es[r.id] = s; ef[r.id] = s + (r.durata_zile || 0); done.add(r.id)
    }
  }
  return Math.max(0, ...rows.map(r => ef[r.id] || 0))
}

// ── Export MSPDI (MS Project XML) — cerut editabil la clarificări (lecția Hoghilag) ──
export function exportMSPDI({ rows, rez, dataStart, titlu, fisier }) {
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const iso = (d) => `${d}T08:00:00`
  const dur = (z) => `PT${(z || 0) * 8}H0M0S`
  const uid = {}; rows.forEach((r, i) => { uid[r.id] = i + 1 })
  const tasks = rows.map((r, i) => {
    const c = rez[r.id] || { es: 0, ef: 0 }
    const links = (r.predecesori || []).filter(p => uid[p.id]).map(p =>
      `<PredecessorLink><PredecessorUID>${uid[p.id]}</PredecessorUID><Type>${p.tip === 'SS' ? 3 : 1}</Type><LinkLag>${(p.lag || 0) * 8 * 600}</LinkLag><LagFormat>7</LagFormat></PredecessorLink>`).join('')
    return `<Task><UID>${i + 1}</UID><ID>${i + 1}</ID><Name>${esc(r.denumire)}</Name><Type>0</Type><IsNull>0</IsNull><OutlineLevel>${(r.nivel || 0) + 1}</OutlineLevel>` +
      `<Start>${iso(addZile(dataStart, c.es))}</Start><Finish>${iso(addZile(dataStart, r.jalon ? c.es : Math.max(c.es, c.ef - 1)))}</Finish>` +
      `<Duration>${dur(r.durata_zile)}</Duration><DurationFormat>7</DurationFormat><Milestone>${r.jalon ? 1 : 0}</Milestone><Summary>${r.nivel === 0 && !r.jalon && r.durata_zile === 0 ? 1 : 0}</Summary>` +
      `<Critical>${rez[r.id]?.critic ? 1 : 0}</Critical><Cost>${Number(r.valoare_lei) || 0}</Cost>${links}</Task>`
  }).join('\n')
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Project xmlns="http://schemas.microsoft.com/project">
<SaveVersion>14</SaveVersion><Name>${esc(fisier)}</Name><Title>${esc(titlu)}</Title><Author>Gazpet Instal — PontajPRO</Author>
<StartDate>${iso(dataStart)}</StartDate><ScheduleFromStart>1</ScheduleFromStart><CalendarUID>1</CalendarUID>
<MinutesPerDay>480</MinutesPerDay><MinutesPerWeek>3360</MinutesPerWeek><DaysPerMonth>30</DaysPerMonth>
<DurationFormat>7</DurationFormat><NewTasksAreManual>0</NewTasksAreManual>
<Calendars><Calendar><UID>1</UID><Name>Calendaristic 7 zile</Name><IsBaseCalendar>1</IsBaseCalendar><WeekDays>${[1,2,3,4,5,6,7].map(d => `<WeekDay><DayType>${d}</DayType><DayWorking>1</DayWorking><WorkingTimes><WorkingTime><FromTime>08:00:00</FromTime><ToTime>12:00:00</ToTime></WorkingTime><WorkingTime><FromTime>13:00:00</FromTime><ToTime>17:00:00</ToTime></WorkingTime></WorkingTimes></WeekDay>`).join('')}</WeekDays></Calendar></Calendars>
<Tasks>
${tasks}
</Tasks>
</Project>`
  const blob = new Blob([xml], { type: 'application/xml' })
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${fisier}.xml`; a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

// ── Componenta: Poarta grafic ──
export default function PoartaGrafic({ licitatieId, profile, rows, dataStart, onDataStart, onGenerat, showToast }) {
  const [p, setP] = useState(null)
  const [cantitati, setCantitati] = useState([])
  const [norme, setNorme] = useState([])
  const [cerinte, setCerinte] = useState([])
  const [versiuni, setVersiuni] = useState([])
  const [deschis, setDeschis] = useState(true)
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)

  const load = async () => {
    const [{ data: par }, { data: cant }, { data: nor }, { data: cer }, { data: ver }] = await Promise.all([
      supabase.from('grafic_parametri').select('*').eq('licitatie_id', licitatieId).maybeSingle(),
      supabase.from('ofertare_cantitati').select('id, obiect, categorie, denumire, um, cantitate, cantitate_plansa, status').eq('licitatie_id', licitatieId).order('id'),
      supabase.from('ofertare_norme_productivitate').select('cod, activitate, tip_lucrare, um, productie_zi, coef_iarna, coef_teren_greu, incredere, validat_la'),
      supabase.from('ofertare_cerinte').select('id, text_cerinta, tip, sursa_sectiune, document_probant').eq('licitatie_id', licitatieId).is('inlocuita_de', null)
        .or('document_probant.ilike.%grafic%,text_cerinta.ilike.%grafic%,text_cerinta.ilike.%jalo%,text_cerinta.ilike.%durata de execu%'),
      supabase.from('grafic_versiuni').select('id, versiune, mod, generat_la, generat_de, durata_zile, nota').eq('licitatie_id', licitatieId).order('versiune', { ascending: false }),
    ])
    setCantitati(cant || []); setNorme(nor || []); setCerinte(cer || []); setVersiuni(ver || [])
    setP({ ...PARAM_DEFAULT, ...(par?.parametri || {}) })
  }
  useEffect(() => { load() }, [licitatieId])

  // durata maximă din cerințe („36 de luni", „maximum 36 luni")
  const durataMax = useMemo(() => {
    let m = null
    cerinte.forEach(c => { const x = (c.text_cerinta || '').match(/(\d{1,3})\s*(?:de\s*)?luni/i); if (x && /durat|execu|depăș|maxim/i.test(c.text_cerinta)) { const v = Number(x[1]); if (!m || v < m) m = v } })
    return m
  }, [cerinte])

  const setParam = (k, v) => { setP(x => ({ ...x, [k]: v })); setDirty(true) }
  const setFront = (i, k, v) => { setP(x => ({ ...x, fronturi: x.fronturi.map((f, j) => j === i ? { ...f, [k]: v } : f) })); setDirty(true) }

  // fronturi propuse din cantități (rândurile de rețea cu metri, fără „total")
  const propuneFronturi = () => {
    const baza = p.cantitati_asumate === 'plansa' ? 'cantitate_plansa' : 'cantitate'
    const fr = cantitati.filter(c => c.um === 'm' && /re[țt]ea/i.test(c.categorie || '') && !/total/i.test(c.obiect || '') && Number(c[baza]) > 0)
      .map(c => ({ nume: (c.denumire || '').replace(/Țeavă\s+PE\d+\s+SDR\d+\s*/i, '').split('—')[1]?.trim() || (c.denumire || '').slice(0, 40), lungime_m: Math.round(Number(c[baza])), dn: ((c.denumire || '').match(/Dn\s*(\d{2,3})/i) || [])[1] || '', echipe: 1 }))
    setParam('fronturi', fr)
  }

  const salveaza = async () => {
    setBusy(true)
    const { error } = await supabase.from('grafic_parametri').upsert({ licitatie_id: licitatieId, parametri: p, updated_at: new Date().toISOString(), updated_by: profile?.id || null }, { onConflict: 'licitatie_id' })
    setBusy(false)
    if (error) { showToast('Eroare la salvarea parametrilor: ' + error.message, 'err'); return }
    setDirty(false); showToast('Parametri salvați.')
  }

  // ── Checklist-ul porții: fiecare rând = {k, titlu, stare: ok|warn|block, detalii} ──
  const poarta = useMemo(() => {
    if (!p) return []
    const out = []
    const totalRetea = cantitati.find(c => /total/i.test(c.obiect || '') && c.um === 'm')
    const reteaRows = cantitati.filter(c => c.um === 'm' && /re[țt]ea/i.test(c.categorie || '') && !/total/i.test(c.obiect || ''))
    const cuDif = reteaRows.filter(c => c.status === 'diferenta')
    out.push({ k: 'cant', titlu: 'Cantități rețea în platformă', stare: !reteaRows.length ? 'block' : (cuDif.length && !p.cantitati_asumate) ? 'block' : cuDif.length ? 'warn' : 'ok',
      detalii: !reteaRows.length ? 'niciun rând de rețea în Cantități' : `${reteaRows.length} rânduri rețea${totalRetea ? `, total declarat ${Number(totalRetea.cantitate).toLocaleString('ro-RO')} m` : ''}${cuDif.length ? ` · ${cuDif.length} cu diferență memoriu/planșă → alege baza (memoriu / planșă)` : ''}` })
    const lf = totalFronturi(p)
    const ref = Number(totalRetea?.cantitate) || reteaRows.reduce((s, c) => s + (Number(p.cantitati_asumate === 'plansa' ? c.cantitate_plansa : c.cantitate) || 0), 0)
    const dev = ref ? Math.abs(lf - ref) / ref : 1
    out.push({ k: 'front', titlu: 'Fronturi de lucru (localități / tronsoane)', stare: !p.fronturi?.length ? 'block' : dev > 0.1 ? 'warn' : 'ok',
      detalii: !p.fronturi?.length ? 'nedefinite — „Propune din cantități" apoi ajustezi' : `${p.fronturi.length} fronturi, ${lf.toLocaleString('ro-RO')} m (${ref ? Math.round(lf / ref * 100) + '% din rețea' : 'fără referință'})` })
    const nv = norme.filter(n => n.tip_lucrare === p.tip_lucrare)
    const val = nv.filter(n => n.incredere === 'validat')
    out.push({ k: 'norme', titlu: 'Norme de productivitate validate', stare: !val.length ? 'block' : val.length < nv.length ? 'warn' : 'ok',
      detalii: `${val.length} validate din ${nv.length} pentru ${p.tip_lucrare}${val.length ? ' (' + val.map(n => `${n.cod} ${n.productie_zi} ${n.um}/zi`).join(', ') + ')' : ''}` })
    out.push({ k: 'echipe', titlu: 'Echipe alocate', stare: Number(p.echipe) >= 1 ? 'ok' : 'block', detalii: `${p.echipe || 0} echipe de rețea simultane · mediu ${p.mediu}` })
    const dl = Number(p.durata_luni)
    out.push({ k: 'durata', titlu: 'Data de start + durata ofertată', stare: !p.data_start || !dl ? 'block' : (durataMax && dl > durataMax) ? 'block' : 'ok',
      detalii: `${p.data_start || 'fără dată'} · ${dl || '—'} luni${durataMax ? ` (maxim din cerințe: ${durataMax} luni)` : ' (nu am găsit durata maximă în cerințe)'}${durataMax && dl > durataMax ? ' — DEPĂȘEȘTE' : ''}` })
    out.push({ k: 'cerinte', titlu: 'Cerințe de grafic extrase din registru', stare: cerinte.length ? 'ok' : 'block', detalii: `${cerinte.length} cerințe (durată, jaloane, format, resurse)` })
    out.push({ k: 'brans', titlu: 'Decizie branșamente', stare: p.include_bransamente === null ? 'block' : (p.include_bransamente && !Number(p.nr_bransamente)) ? 'block' : 'ok',
      detalii: p.include_bransamente === null ? 'nedecis: contractul include branșamente?' : p.include_bransamente ? `da, ${p.nr_bransamente} buc` : 'nu (doar rețeaua)' })
    out.push({ k: 'ferestre', titlu: 'Constrângeri operator (cuplări, avize, spargeri)', stare: (p.ferestre_operator || '').trim() ? 'ok' : 'warn', detalii: (p.ferestre_operator || '').trim() || 'necompletate — merg în notele graficului' })
    return out
  }, [p, cantitati, norme, cerinte, durataMax])
  const blocat = poarta.some(r => r.stare === 'block')

  const genereaza = async () => {
    if (blocat || !p) return
    if (rows?.length && !window.confirm(`Graficul curent (${rows.length} rânduri) va fi ÎNLOCUIT cu unul generat. Versiunea veche rămâne în istoric. Continui?`)) return
    setBusy(true)
    try {
      if (dirty) await salveaza()
      const { rows: gen, factor, intern, total } = motorPEHD(p, norme)
      // 1. înghețăm versiunea (înainte de a atinge grafic_activitati)
      const versiune = (versiuni[0]?.versiune || 0) + 1
      const { error: ev } = await supabase.from('grafic_versiuni').insert({
        licitatie_id: licitatieId, versiune, mod: p.mod, generat_de: profile?.id || null, durata_zile: total,
        poarta, snapshot: { parametri: p, cantitati, norme: norme.filter(n => n.tip_lucrare === p.tip_lucrare), cerinte_ids: cerinte.map(c => c.id), factor_intindere: Math.round(factor * 100) / 100, durata_interna_zile: intern },
        activitati: gen, nota: `${p.mod === 'oferta' ? 'Ofertă' : 'Intern'} · ${p.fronturi.length} fronturi · ${p.echipe} echipe · factor întindere ${factor.toFixed(2)} (intern ${intern} zile → ${total} zile)`,
      })
      if (ev) throw new Error(ev.message)
      // 2. înlocuim activitățile: insert fără predecesori → mapare id → update predecesori
      await supabase.from('grafic_activitati').delete().eq('licitatie_id', licitatieId)
      const { data: ins, error: ei } = await supabase.from('grafic_activitati').insert(gen.map(r => ({
        licitatie_id: licitatieId, denumire: r.denumire, durata_zile: r.durata_zile, jalon: !!r.jalon, predecesori: [], resurse: r.resurse || null, nivel: r.nivel || 0, ordine: r.ordine, note: r.note || null,
      }))).select('id, ordine')
      if (ei) throw new Error(ei.message)
      const map = {}; gen.forEach(r => { const real = ins.find(x => x.ordine === r.ordine); if (real) map[r.id] = real.id })
      for (const r of gen) {
        if (!r.predecesori?.length) continue
        await supabase.from('grafic_activitati').update({ predecesori: r.predecesori.map(x => ({ ...x, id: map[x.id] })).filter(x => x.id) }).eq('id', map[r.id])
      }
      if (p.data_start && onDataStart) onDataStart(p.data_start)
      showToast(`Grafic v${versiune} generat: ${gen.length} activități, ${total} zile (intern ${intern}, factor ${factor.toFixed(2)}).`)
      await load()
      onGenerat && onGenerat()
    } catch (e) { showToast('Eroare la generare: ' + (e?.message || e), 'err') }
    setBusy(false)
  }

  if (!p) return null
  const culoare = { ok: G.green, warn: G.yellow, block: G.red }
  const icon = { ok: '●', warn: '●', block: '●' }
  const lbl = { fontSize: 11, color: G.muted, display: 'block', marginBottom: 2 }

  return (
    <div style={{ ...S.card, padding: 14, marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }} onClick={() => setDeschis(d => !d)}>
        <span style={{ fontSize: 15, fontWeight: 800 }}>🚧 Poarta grafic</span>
        <span style={{ fontSize: 12, color: blocat ? G.red : G.green, fontWeight: 700 }}>{blocat ? `${poarta.filter(r => r.stare === 'block').length} intrări lipsă` : 'toate intrările obligatorii sunt în platformă'}</span>
        {versiuni[0] && <span style={{ fontSize: 11.5, color: G.dim }}>· ultima generare v{versiuni[0].versiune} ({new Date(versiuni[0].generat_la).toLocaleDateString('ro-RO')}, {versiuni[0].mod})</span>}
        <span style={{ marginLeft: 'auto', color: G.dim, fontSize: 12 }}>{deschis ? '▲' : '▼'}</span>
      </div>
      {deschis && (
        <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'minmax(300px, 1fr) minmax(360px, 1.4fr)', gap: 16 }}>
          {/* Checklist */}
          <div>
            {poarta.map(r => (
              <div key={r.k} style={{ display: 'flex', gap: 8, padding: '6px 0', borderBottom: `1px solid ${G.border2}`, fontSize: 12.5 }}>
                <span style={{ color: culoare[r.stare], fontSize: 14, lineHeight: '16px' }}>{icon[r.stare]}</span>
                <div><div style={{ fontWeight: 700 }}>{r.titlu}</div><div style={{ color: G.muted, fontSize: 11.5 }}>{r.detalii}</div></div>
              </div>
            ))}
            <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <button style={{ ...S.btnP, opacity: blocat || busy ? .45 : 1, cursor: blocat ? 'not-allowed' : 'pointer' }} disabled={blocat || busy} onClick={genereaza}
                title={blocat ? 'Inactiv până se închid rândurile roșii' : 'Generează graficul din cantități + norme + parametri și îngheață o versiune'}>⚙️ Generează grafic ({p.mod === 'oferta' ? 'ofertă' : 'intern'})</button>
              <button style={{ ...S.btnS, opacity: dirty ? 1 : .5 }} disabled={!dirty || busy} onClick={salveaza}>💾 Salvează parametrii</button>
            </div>
            {cerinte.length > 0 && (
              <details style={{ marginTop: 10, fontSize: 11.5, color: G.muted }}>
                <summary style={{ cursor: 'pointer' }}>Cerințele de grafic din registru ({cerinte.length})</summary>
                <ul style={{ paddingLeft: 16, margin: '6px 0' }}>{cerinte.map(c => <li key={c.id} style={{ marginBottom: 3 }}><b style={{ color: c.tip === 'eliminatorie' ? G.red : G.text }}>{c.sursa_sectiune || c.tip}</b>: {c.text_cerinta}</li>)}</ul>
              </details>
            )}
            {versiuni.length > 0 && (
              <details style={{ marginTop: 8, fontSize: 11.5, color: G.muted }}>
                <summary style={{ cursor: 'pointer' }}>Versiuni generate ({versiuni.length})</summary>
                {versiuni.map(v => <div key={v.id} style={{ padding: '3px 0' }}>v{v.versiune} · {new Date(v.generat_la).toLocaleString('ro-RO')} · {v.durata_zile} zile · {v.nota}</div>)}
              </details>
            )}
          </div>
          {/* Parametri */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, alignContent: 'start' }}>
            <label><span style={lbl}>Mod</span>
              <select style={S.input} value={p.mod} onChange={e => setParam('mod', e.target.value)}><option value="oferta">ofertă (întins pe durată)</option><option value="intern">intern (norme reale)</option></select></label>
            <label><span style={lbl}>Data ordin (presupusă)</span><input type="date" style={S.input} value={p.data_start || ''} onChange={e => setParam('data_start', e.target.value)} /></label>
            <label><span style={lbl}>Durata ofertată (luni){durataMax ? ` ≤ ${durataMax}` : ''}</span><input type="number" min="1" style={S.input} value={p.durata_luni ?? ''} onChange={e => setParam('durata_luni', e.target.value ? Number(e.target.value) : null)} /></label>
            <label><span style={lbl}>Baza cantităților</span>
              <select style={S.input} value={p.cantitati_asumate} onChange={e => setParam('cantitati_asumate', e.target.value)}><option value="">— alege —</option><option value="memoriu">memoriu / F3</option><option value="plansa">planșe</option></select></label>
            <label><span style={lbl}>Echipe rețea simultane</span><input type="number" min="1" style={S.input} value={p.echipe} onChange={e => setParam('echipe', Number(e.target.value) || 1)} /></label>
            <label><span style={lbl}>Mediu</span>
              <select style={S.input} value={p.mediu} onChange={e => setParam('mediu', e.target.value)}><option value="sat">sat / pământ</option><option value="oras">oraș / asfalt</option></select></label>
            <label><span style={lbl}>Branșamente în contract</span>
              <select style={S.input} value={p.include_bransamente === null ? '' : p.include_bransamente ? 'da' : 'nu'} onChange={e => setParam('include_bransamente', e.target.value === '' ? null : e.target.value === 'da')}><option value="">— nedecis —</option><option value="da">da</option><option value="nu">nu</option></select></label>
            <label><span style={lbl}>Nr. branșamente</span><input type="number" min="0" style={S.input} value={p.nr_bransamente} disabled={!p.include_bransamente} onChange={e => setParam('nr_bransamente', Number(e.target.value) || 0)} /></label>
            <label><span style={lbl}>SRM în contract</span>
              <select style={S.input} value={p.srm ? 'da' : 'nu'} onChange={e => setParam('srm', e.target.value === 'da')}><option value="nu">nu</option><option value="da">da</option></select></label>
            <label><span style={lbl}>OS (zile)</span><input type="number" style={S.input} value={p.os_zile} onChange={e => setParam('os_zile', Number(e.target.value) || 0)} /></label>
            <label><span style={lbl}>Procurare (zile)</span><input type="number" style={S.input} value={p.procurare_zile} onChange={e => setParam('procurare_zile', Number(e.target.value) || 0)} /></label>
            <label><span style={lbl}>Carte tehnică + recepție (zile)</span><input type="number" style={S.input} value={p.receptie_zile} onChange={e => setParam('receptie_zile', Number(e.target.value) || 0)} /></label>
            <label style={{ gridColumn: '1 / -1' }}><span style={lbl}>Constrângeri operator (cuplări, ferestre, avize, autorizații spargere)</span>
              <input style={S.input} value={p.ferestre_operator || ''} onChange={e => setParam('ferestre_operator', e.target.value)} placeholder="ex: cuplări doar în ferestrele Distrigaz Sud, faze determinante cu convocare 48 h" /></label>
            <label style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 }}>
              <input type="checkbox" checked={!!p.iarna} onChange={e => setParam('iarna', e.target.checked)} style={{ accentColor: G.accent }} /> Întrerupere tehnologică de iarnă explicită (peste 8 luni)</label>
            {/* Fronturi */}
            <div style={{ gridColumn: '1 / -1' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ ...lbl, marginBottom: 0 }}>Fronturi de lucru (ordinea = ordinea de execuție; se împart pe echipe rotativ)</span>
                <button style={{ ...S.btnS, padding: '3px 9px', fontSize: 11, marginLeft: 'auto' }} onClick={propuneFronturi}>Propune din cantități</button>
                <button style={{ ...S.btnS, padding: '3px 9px', fontSize: 11 }} onClick={() => setParam('fronturi', [...(p.fronturi || []), { nume: '', lungime_m: 0, dn: '', echipe: 1 }])}>＋</button>
              </div>
              {(p.fronturi || []).map((f, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 90px 70px 60px 28px 28px 28px', gap: 6, marginBottom: 4 }}>
                  <input style={S.input} value={f.nume} placeholder="localitate / tronson" onChange={e => setFront(i, 'nume', e.target.value)} />
                  <input style={S.input} type="number" value={f.lungime_m} placeholder="m" onChange={e => setFront(i, 'lungime_m', Number(e.target.value) || 0)} />
                  <input style={S.input} value={f.dn} placeholder="Dn" onChange={e => setFront(i, 'dn', e.target.value)} />
                  <input style={S.input} type="number" min="1" value={f.echipe} title="echipe pe acest front" onChange={e => setFront(i, 'echipe', Number(e.target.value) || 1)} />
                  <button style={{ ...S.btnS, padding: '2px 6px', fontSize: 11 }} disabled={i === 0} onClick={() => { const fr = [...p.fronturi]; [fr[i - 1], fr[i]] = [fr[i], fr[i - 1]]; setParam('fronturi', fr) }}>↑</button>
                  <button style={{ ...S.btnS, padding: '2px 6px', fontSize: 11 }} disabled={i === p.fronturi.length - 1} onClick={() => { const fr = [...p.fronturi]; [fr[i + 1], fr[i]] = [fr[i], fr[i + 1]]; setParam('fronturi', fr) }}>↓</button>
                  <button style={{ ...S.btnS, padding: '2px 6px', fontSize: 11, color: G.red }} onClick={() => setParam('fronturi', p.fronturi.filter((_, j) => j !== i))}>✕</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
