// ═══════════════════════════════════════════════════════════════════════════
// INVENTAR — CORECȚII REGISTRU IMOBILIZĂRI (interfață PROVIZORIE)
// ═══════════════════════════════════════════════════════════════════════════
// Unealtă de lucru pentru proiectul de aliniere: registru contabil (WinMentor,
// Instal + Invest) ↔ logistica_active (nr. inventar, denumiri, serii).
// Se ÎNCHIDE când proiectul e gata (se scoate ruta din App.jsx + fișierul).
//
// Ce face:
//  · „De lucru": pozițiile netratate, grupate pe denumire IDENTICĂ — scrii
//    numele nou O DATĂ și se propagă pe toate pozițiile cu acel nume, iar
//    corecția intră automat în lista pentru Marilena (VECHI → NOU).
//  · Legare poziție ↔ utilaj BD (scrie matched_active_id + nr_inventar în
//    logistica_active, cu prefix GI- pentru Invest + notă de audit).
//  · „Corecții WinMentor": lista VECHI vs NOU pe firmă + export XLSX.
//  · „Registru": viewer cu triaj + căutare.
//
// Sursa de adevăr = registru_imobilizari (snapshot-ul cel mai recent pe firmă).
// Acces: is_owner + whitelist (Mitrache, Oancea, Marilena) — provizoriu.
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo } from 'react'
import { supabase } from './lib/supabase.js'
import * as XLSX from 'xlsx-js-style'

const G = {
  bg:'#0D1117', surface:'#161B22', border:'#30363D',
  text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  orange:'#F0883E', purple:'#A371F7', blue:'#58A6FF',
  green:'#3FB950', yellow:'#D29922', red:'#F85149',
}
const S = {
  page: { padding:'20px 22px', minHeight:'calc(100vh - 60px)', background:G.bg, color:G.text, fontFamily:'-apple-system,BlinkMacSystemFont,Inter,sans-serif' },
  card: { background:G.surface, borderRadius:12, border:`1px solid ${G.border}` },
  input:{ background:G.bg, border:`1px solid ${G.border}`, color:G.text, borderRadius:8, padding:'7px 11px', fontFamily:'inherit', fontSize:13, outline:'none' },
  btnP: { padding:'7px 13px', background:G.orange, color:'#fff', border:'none', borderRadius:8, cursor:'pointer', fontSize:12.5, fontWeight:700 },
  btnS: { padding:'6px 11px', background:'transparent', color:G.text, border:`1px solid ${G.border}`, borderRadius:8, cursor:'pointer', fontSize:12.5, fontWeight:600 },
  chip: (on, c) => ({ padding:'5px 11px', borderRadius:16, border:`1px solid ${on?c:G.border}`, background:on?c+'22':'transparent', color:on?c:G.muted, cursor:'pointer', fontSize:12.5, fontWeight:600, whiteSpace:'nowrap' }),
}

const WHITELIST = ['m.alexandru@gazpet.ro', 'daniel.oancea@gazpet.ro', 'marilena.tudorache@gazpet.ro']

const TRIAJ = {
  ambiguu:        { label:'Ambiguu (serie fizică)', color:G.yellow, icon:'🔍' },
  de_clarificat:  { label:'De clarificat',          color:G.purple, icon:'❓' },
  lipsa_logistica:{ label:'Lipsă din Logistică',    color:G.red,    icon:'🚨' },
  de_adaugat_bd:  { label:'De adăugat în BD',       color:G.orange, icon:'➕' },
  casare:         { label:'Casare',                 color:G.dim,    icon:'🗑️' },
  echipament_mic: { label:'Echipament mic/IT/AMC',  color:G.muted,  icon:'🔧' },
  nu_se_mapeaza:  { label:'Nu se mapează',          color:G.muted,  icon:'⛔' },
  mapat:          { label:'Mapat',                  color:G.green,  icon:'✅' },
}
// tab-ul „De lucru" arată doar ce mai cere acțiune
const TRIAJ_LUCRU = ['ambiguu', 'de_clarificat', 'lipsa_logistica', 'de_adaugat_bd', 'casare']

const COR_TIP = { denumire:'DENUMIRE', nr_inventar:'NR. INVENTAR', spargere_pozitie:'SPARGERE POZIȚIE', casare:'CASARE' }
const COR_ST  = { propus:'DE APLICAT', de_confirmat:'DE CONFIRMAT ÎNTÂI', predat:'PREDAT', aplicat:'APLICAT', verificat:'VERIFICAT ✔' }
const COR_ST_ORD = ['propus', 'de_confirmat', 'predat', 'aplicat', 'verificat']
const stColor = (s) => s === 'de_confirmat' ? G.yellow : (s === 'aplicat' || s === 'verificat') ? G.green : s === 'predat' ? G.blue : G.orange

const fmtLei = (n) => Number(n || 0).toLocaleString('ro-RO', { minimumFractionDigits:2, maximumFractionDigits:2 })

function Mesaj({ mesaj, onClose }) {
  if (!mesaj) return null
  const c = mesaj.tip === 'error' ? G.red : G.green
  return (
    <div style={{...S.card, padding:'9px 13px', marginBottom:12, borderColor:c+'55', background:c+'11',
                 display:'flex', justifyContent:'space-between', alignItems:'center', gap:10}}>
      <span style={{fontSize:13, color:c, fontWeight:600}}>{mesaj.text}</span>
      <button onClick={onClose} style={{background:'none', border:'none', color:c, cursor:'pointer', fontSize:15}}>✕</button>
    </div>
  )
}

export default function InventarCorectii({ profile }) {
  const [tab, setTab] = useState('lucru')          // lucru | corectii | registru
  const [firma, setFirma] = useState('INSTAL')
  const [rows, setRows] = useState([])             // registru (ultimele snapshot-uri, ambele firme)
  const [active, setActive] = useState([])         // logistica_active minimal, pt. legare + afișare
  const [loading, setLoading] = useState(true)
  const [mesaj, setMesaj] = useState(null)
  const [q, setQ] = useState('')
  const [triajFiltru, setTriajFiltru] = useState('')   // '' = toate din TRIAJ_LUCRU
  const [expand, setExpand] = useState(null)           // cheia grupului deschis
  const [numeNou, setNumeNou] = useState('')
  const [legare, setLegare] = useState(null)           // rândul registru pt. care căutăm activ BD
  const [qActiv, setQActiv] = useState('')

  const ok = (text) => { setMesaj({ tip:'ok', text }); setTimeout(() => setMesaj(null), 4000) }
  const err = (text) => setMesaj({ tip:'error', text })

  const areAcces = profile?.is_owner || WHITELIST.includes((profile?.email || '').toLowerCase())

  const incarca = async () => {
    setLoading(true)
    // snapshot-ul cel mai recent pe fiecare firmă (nu hardcodăm luna)
    const { data: luni, error: e1 } = await supabase.from('registru_imobilizari')
      .select('firma, luna_registru').order('luna_registru', { ascending:false })
    if (e1) { err('Nu pot citi registrul: ' + e1.message); setLoading(false); return }
    const ultima = {}
    for (const r of (luni || [])) if (!ultima[r.firma]) ultima[r.firma] = r.luna_registru
    const [r1, r2] = await Promise.all([
      supabase.from('registru_imobilizari').select('*')
        .eq('firma', 'INSTAL').eq('luna_registru', ultima.INSTAL || '1900-01-01').limit(2000),
      supabase.from('registru_imobilizari').select('*')
        .eq('firma', 'INVEST').eq('luna_registru', ultima.INVEST || '1900-01-01').limit(2000),
    ])
    if (r1.error || r2.error) { err('Eroare la citirea registrului: ' + (r1.error || r2.error).message); setLoading(false); return }
    setRows([...(r1.data || []), ...(r2.data || [])])
    const { data: acts } = await supabase.from('logistica_active')
      .select('id, model, marca, nr_inmatriculare, serie_sasiu, nr_inventar, firma_proprietara, vandut, observatii')
      .eq('vandut', false).limit(2000)
    setActive(acts || [])
    setLoading(false)
  }
  useEffect(() => { if (areAcces) incarca() }, [areAcces])

  const activById = useMemo(() => Object.fromEntries(active.map(a => [a.id, a])), [active])
  const rowsFirma = useMemo(() => rows.filter(r => r.firma === firma), [rows, firma])

  // ── „De lucru": grupare pe denumire identică ────────────────────────────
  const grupuri = useMemo(() => {
    const qq = q.trim().toLowerCase()
    const lucru = rowsFirma.filter(r => TRIAJ_LUCRU.includes(r.triaj))
      .filter(r => !triajFiltru || r.triaj === triajFiltru)
      .filter(r => !qq || (r.denumire || '').toLowerCase().includes(qq) || String(r.nr_inventar).includes(qq))
    const map = new Map()
    for (const r of lucru) {
      const k = (r.denumire || '').trim().toUpperCase()
      if (!map.has(k)) map.set(k, [])
      map.get(k).push(r)
    }
    return [...map.entries()]
      .map(([k, list]) => ({ k, list: list.sort((a, b) => String(a.nr_inventar).localeCompare(String(b.nr_inventar), 'ro', { numeric:true })) }))
      .sort((a, b) => b.list.length - a.list.length || a.k.localeCompare(b.k, 'ro'))
  }, [rowsFirma, q, triajFiltru])

  const nrLucru = useMemo(() => rowsFirma.filter(r => TRIAJ_LUCRU.includes(r.triaj)).length, [rowsFirma])
  const nrMapate = useMemo(() => rowsFirma.filter(r => r.triaj === 'mapat').length, [rowsFirma])
  const corectii = useMemo(() =>
    rows.filter(r => r.corectie_tip)
      .sort((a, b) => COR_ST_ORD.indexOf(a.corectie_status) - COR_ST_ORD.indexOf(b.corectie_status) ||
                      String(a.nr_inventar).localeCompare(String(b.nr_inventar), 'ro', { numeric:true })),
  [rows])
  const corectiiFirma = useMemo(() => corectii.filter(c => c.firma === firma), [corectii, firma])

  // ── Acțiuni ─────────────────────────────────────────────────────────────
  // Redenumire pe TOT grupul cu denumire identică → denumire_noua + corecție automată
  const aplicaNumeGrup = async (denumireVeche, listaIds) => {
    const nou = numeNou.trim()
    if (nou.length < 3) { err('Numele nou e prea scurt.'); return }
    const motiv = `Redenumire din interfața Corecții inventar (nume identice legate — ${listaIds.length} poziții), ${new Date().toLocaleDateString('ro-RO')}, de ${profile?.email || '?'}.`
    const { error } = await supabase.from('registru_imobilizari')
      .update({ denumire_noua: nou, corectie_tip:'denumire', corectie_status:'propus', corectie_motiv: motiv })
      .in('id', listaIds)
    if (error) { err('Nu am putut salva: ' + error.message); return }
    setRows(rs => rs.map(r => listaIds.includes(r.id)
      ? { ...r, denumire_noua: nou, corectie_tip:'denumire', corectie_status:'propus', corectie_motiv: motiv } : r))
    setNumeNou(''); setExpand(null)
    ok(`Nume nou propus pe ${listaIds.length} poziții („${denumireVeche.slice(0, 40)}…" → „${nou.slice(0, 40)}") — intrat în lista Marilenei.`)
  }

  const schimbaTriaj = async (row, t) => {
    const { error } = await supabase.from('registru_imobilizari')
      .update({ triaj: t, triaj_la: new Date().toISOString(), triaj_de: profile?.id || null }).eq('id', row.id)
    if (error) { err(error.message); return }
    setRows(rs => rs.map(r => r.id === row.id ? { ...r, triaj: t } : r))
    ok(`Triaj schimbat: inv ${row.nr_inventar} → ${TRIAJ[t]?.label || t}.`)
  }

  const schimbaStatusCorectie = async (row, st) => {
    const { error } = await supabase.from('registru_imobilizari').update({ corectie_status: st }).eq('id', row.id)
    if (error) { err(error.message); return }
    setRows(rs => rs.map(r => r.id === row.id ? { ...r, corectie_status: st } : r))
  }

  // Legare poziție registru ↔ activ BD: matched_active_id + nr_inventar în logistica_active
  const leagaActiv = async (rowReg, act) => {
    const invNou = (rowReg.firma === 'INVEST' ? 'GI-' : '') + rowReg.nr_inventar
    if (act.nr_inventar && act.nr_inventar !== invNou) {
      if (!window.confirm(`Utilajul „${act.model}" are deja nr. inventar ${act.nr_inventar}. Îl înlocuiesc cu ${invNou}?`)) return
    } else if (!window.confirm(`Leg poziția inv ${rowReg.nr_inventar} „${rowReg.denumire}" de „${act.model}" (${act.nr_inmatriculare || 'fără nr.'}) și scriu nr_inventar=${invNou}?`)) return
    const { error: e1 } = await supabase.from('registru_imobilizari')
      .update({ matched_active_id: act.id, match_metoda:'ui_manual', triaj:'mapat', triaj_la: new Date().toISOString(), triaj_de: profile?.id || null })
      .eq('id', rowReg.id)
    if (e1) { err('Nu am putut lega în registru: ' + e1.message); return }
    const nota = `\n[${new Date().toLocaleDateString('ro-RO')}] nr_inventar=${invNou} setat din interfața Corecții inventar de ${profile?.email || '?'} (registru ${rowReg.firma}, poziția ${rowReg.nr_inventar}: ${rowReg.denumire}).`
    const { error: e2 } = await supabase.from('logistica_active')
      .update({ nr_inventar: invNou, observatii: ((act.observatii || '') + nota) }).eq('id', act.id)
    if (e2) { err('Registrul e legat, dar nr_inventar NU s-a scris pe utilaj: ' + e2.message); return }
    setRows(rs => rs.map(r => r.id === rowReg.id ? { ...r, matched_active_id: act.id, match_metoda:'ui_manual', triaj:'mapat' } : r))
    setActive(as => as.map(a => a.id === act.id ? { ...a, nr_inventar: invNou } : a))
    setLegare(null); setQActiv('')
    ok(`Legat: inv ${rowReg.nr_inventar} ↔ ${act.model} (nr_inventar=${invNou} scris pe utilaj).`)
  }

  // Export XLSX „Corecții WinMentor" pentru Marilena (firma curentă)
  const exportCorectii = () => {
    const lot = corectiiFirma
    if (!lot.length) { err('Nu există corecții pentru ' + firma + '.'); return }
    const H = { font:{ bold:true, color:{ rgb:'FFFFFF' } }, fill:{ fgColor:{ rgb:'C00000' } } }
    const header = ['Tip corecție', 'Nr. inv.', 'Cont', 'Valoare', 'VECHI (cum e azi în WinMentor)', 'NOU (de scris în WinMentor)', 'Motiv / sursă', 'Status']
    const aoa = [header, ...lot.map(x => [
      COR_TIP[x.corectie_tip] || x.corectie_tip, x.nr_inventar, x.cont, Number(x.valoare || 0),
      x.corectie_tip === 'nr_inventar' ? x.nr_inventar : x.denumire,
      x.denumire_noua || '', x.corectie_motiv || '', COR_ST[x.corectie_status] || x.corectie_status,
    ])]
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    header.forEach((_, i) => { const c = ws[XLSX.utils.encode_cell({ r:0, c:i })]; if (c) c.s = H })
    lot.forEach((x, i) => {
      const cV = ws[XLSX.utils.encode_cell({ r:i + 1, c:4 })]; if (cV) cV.s = { font:{ color:{ rgb:'C00000' } } }
      const cN = ws[XLSX.utils.encode_cell({ r:i + 1, c:5 })]; if (cN) cN.s = { font:{ bold:true, color:{ rgb:'2E7D32' } } }
    })
    ws['!cols'] = [{ wch:16 }, { wch:9 }, { wch:8 }, { wch:12 }, { wch:44 }, { wch:46 }, { wch:52 }, { wch:18 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, `WinMentor ${firma}`)
    XLSX.writeFile(wb, `Corectii_WinMentor_${firma}_${new Date().toISOString().slice(0, 10)}.xlsx`)
    ok('Export generat — îl poți trimite Marilenei.')
  }

  // ── Randare ─────────────────────────────────────────────────────────────
  if (!areAcces) return (
    <div style={S.page}><div style={{...S.card, padding:24, maxWidth:520, margin:'40px auto', textAlign:'center'}}>
      <div style={{fontSize:28, marginBottom:8}}>🔒</div>
      <div style={{fontWeight:700}}>Interfața de corecții inventar e restricționată</div>
      <div style={{color:G.muted, fontSize:13, marginTop:6}}>Acces: Razvan, Mitrache Alexandru, Daniel Oancea, Marilena Tudorache.</div>
    </div></div>
  )

  const badgeTriaj = (t) => {
    const d = TRIAJ[t] || { label: t || '—', color: G.dim, icon:'·' }
    return <span style={{fontSize:11.5, fontWeight:700, color:d.color, whiteSpace:'nowrap'}}>{d.icon} {d.label}</span>
  }

  const actInfo = (id) => {
    const a = activById[id]
    if (!a) return null
    return <span style={{color:G.green, fontSize:12}}>→ {a.model} {a.nr_inmatriculare ? `· ${a.nr_inmatriculare}` : ''} {a.nr_inventar ? `· inv ${a.nr_inventar}` : ''}</span>
  }

  const rezultateActive = qActiv.trim().length >= 2
    ? active.filter(a => {
        const s = (a.model + ' ' + (a.marca || '') + ' ' + (a.nr_inmatriculare || '') + ' ' + (a.serie_sasiu || '')).toLowerCase()
        return qActiv.trim().toLowerCase().split(/\s+/).every(t => s.includes(t))
      }).slice(0, 12)
    : []

  return (
    <div style={S.page}>
      <div style={{display:'flex', alignItems:'center', gap:12, flexWrap:'wrap', marginBottom:14}}>
        <h2 style={{margin:0, fontSize:19}}>🏷️ Inventar — Corecții registru</h2>
        <span style={{fontSize:11, color:G.dim, border:`1px solid ${G.border}`, borderRadius:6, padding:'2px 8px'}}>PROVIZORIU — se închide la finalul proiectului</span>
        <div style={{flex:1}}/>
        {['INSTAL', 'INVEST'].map(f => (
          <button key={f} style={S.chip(firma === f, G.blue)} onClick={() => { setFirma(f); setExpand(null) }}>Gazpet {f === 'INSTAL' ? 'Instal' : 'Invest'}</button>
        ))}
      </div>

      <Mesaj mesaj={mesaj} onClose={() => setMesaj(null)} />

      <div style={{display:'flex', gap:8, flexWrap:'wrap', marginBottom:14}}>
        {[['lucru', `🔨 De lucru (${nrLucru})`], ['corectii', `📋 Corecții WinMentor (${corectiiFirma.length})`], ['registru', `📖 Registru (${rowsFirma.length} · ${nrMapate} mapate)`]].map(([t, l]) => (
          <button key={t} style={S.chip(tab === t, G.orange)} onClick={() => setTab(t)}>{l}</button>
        ))}
        <div style={{flex:1}}/>
        <input style={{...S.input, width:230}} placeholder="Caută nr. inventar / denumire…" value={q} onChange={e => setQ(e.target.value)} />
      </div>

      {loading ? <div style={{color:G.muted, padding:30, textAlign:'center'}}>Se încarcă registrul…</div> : <>

      {/* ══ TAB: DE LUCRU ══ */}
      {tab === 'lucru' && <>
        <div style={{display:'flex', gap:6, flexWrap:'wrap', marginBottom:12}}>
          <button style={S.chip(!triajFiltru, G.text)} onClick={() => setTriajFiltru('')}>Toate</button>
          {TRIAJ_LUCRU.map(t => {
            const n = rowsFirma.filter(r => r.triaj === t).length
            return n ? <button key={t} style={S.chip(triajFiltru === t, TRIAJ[t].color)} onClick={() => setTriajFiltru(triajFiltru === t ? '' : t)}>{TRIAJ[t].icon} {TRIAJ[t].label} ({n})</button> : null
          })}
        </div>
        {grupuri.length === 0 && <div style={{color:G.muted, padding:20}}>Nimic de lucru pe filtrul curent. 🎉</div>}
        {grupuri.map(({ k, list }) => {
          const deschis = expand === k
          return (
            <div key={k} style={{...S.card, marginBottom:8}}>
              <div style={{padding:'10px 14px', display:'flex', alignItems:'center', gap:10, cursor:'pointer'}} onClick={() => { setExpand(deschis ? null : k); setNumeNou('') }}>
                <span style={{fontWeight:700, fontSize:13.5, flex:1}}>{k} {list.length > 1 && <span style={{color:G.orange}}>×{list.length}</span>}</span>
                {badgeTriaj(list[0].triaj)}
                <span style={{color:G.dim, fontSize:12}}>{deschis ? '▲' : '▼'}</span>
              </div>
              {deschis && <div style={{padding:'0 14px 12px', borderTop:`1px solid ${G.border}`}}>
                <div style={{fontSize:12, color:G.muted, margin:'8px 0'}}>{list[0].triaj_nota}</div>
                {/* nume nou o dată → toate pozițiile din grup */}
                <div style={{display:'flex', gap:8, margin:'10px 0', flexWrap:'wrap'}}>
                  <input style={{...S.input, flex:1, minWidth:260}} placeholder={`Nume NOU pentru ${list.length > 1 ? `toate cele ${list.length} poziții` : 'poziție'} (intră automat în corecții)…`}
                         value={numeNou} onChange={e => setNumeNou(e.target.value)} />
                  <button style={S.btnP} onClick={() => aplicaNumeGrup(k, list.map(r => r.id))}>Propune numele nou</button>
                </div>
                <table style={{width:'100%', borderCollapse:'collapse', fontSize:12.5}}>
                  <tbody>
                    {list.map(r => (
                      <tr key={r.id} style={{borderTop:`1px solid ${G.border}`}}>
                        <td style={{padding:'7px 6px', fontWeight:700, whiteSpace:'nowrap'}}>inv {r.nr_inventar}</td>
                        <td style={{padding:'7px 6px', color:G.muted, whiteSpace:'nowrap'}}>{r.cont} · {fmtLei(r.valoare)} lei · {r.an_luna_prima_rata || '—'}</td>
                        <td style={{padding:'7px 6px'}}>{r.matched_active_id ? actInfo(r.matched_active_id) : r.denumire_noua ? <span style={{color:G.green, fontSize:12}}>NOU: {r.denumire_noua}</span> : null}</td>
                        <td style={{padding:'7px 6px', textAlign:'right', whiteSpace:'nowrap'}}>
                          {!r.matched_active_id && <button style={{...S.btnS, marginRight:6}} onClick={() => { setLegare(r); setQActiv('') }}>Leagă de utilaj</button>}
                          <select style={{...S.input, width:'auto', padding:'5px 8px', fontSize:12}} value={r.triaj || ''} onChange={e => schimbaTriaj(r, e.target.value)}>
                            {Object.keys(TRIAJ).map(t => <option key={t} value={t}>{TRIAJ[t].label}</option>)}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>}
            </div>
          )
        })}
      </>}

      {/* ══ TAB: CORECȚII WINMENTOR ══ */}
      {tab === 'corectii' && <>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10, flexWrap:'wrap', gap:8}}>
          <div style={{fontSize:12.5, color:G.muted}}>
            Flux: propus → confirmat de Razvan → predat Marilenei → aplicat în WinMentor → <b style={{color:G.green}}>verificat</b> automat la următorul import de registru.
          </div>
          <button style={S.btnP} onClick={exportCorectii}>⬇️ Export XLSX pentru Marilena ({firma})</button>
        </div>
        {corectiiFirma.length === 0 && <div style={{color:G.muted, padding:20}}>Nicio corecție pe {firma} încă.</div>}
        {corectiiFirma.map(x => (
          <div key={x.id} style={{...S.card, padding:'10px 14px', marginBottom:8}}>
            <div style={{display:'flex', gap:10, alignItems:'center', flexWrap:'wrap'}}>
              <span style={{fontSize:11, fontWeight:800, color:G.orange, whiteSpace:'nowrap'}}>{COR_TIP[x.corectie_tip]}</span>
              <span style={{fontWeight:700, fontSize:13, whiteSpace:'nowrap'}}>inv {x.nr_inventar}</span>
              <span style={{color:G.dim, fontSize:12, whiteSpace:'nowrap'}}>{x.cont} · {fmtLei(x.valoare)} lei</span>
              <div style={{flex:1}}/>
              <select style={{...S.input, width:'auto', padding:'5px 8px', fontSize:12, color:stColor(x.corectie_status)}}
                      value={x.corectie_status || 'propus'} onChange={e => schimbaStatusCorectie(x, e.target.value)}>
                {COR_ST_ORD.map(s => <option key={s} value={s}>{COR_ST[s]}</option>)}
              </select>
            </div>
            <div style={{marginTop:6, fontSize:13}}>
              <span style={{color:G.red, textDecoration: x.corectie_tip === 'denumire' ? 'line-through' : 'none'}}>{x.corectie_tip === 'nr_inventar' ? `nr. ${x.nr_inventar}` : x.denumire}</span>
              <span style={{color:G.dim}}> → </span>
              <b style={{color:G.green}}>{x.denumire_noua}</b>
            </div>
            <div style={{marginTop:4, fontSize:11.5, color:G.muted}}>{x.corectie_motiv}</div>
          </div>
        ))}
      </>}

      {/* ══ TAB: REGISTRU ══ */}
      {tab === 'registru' && (
        <div style={{...S.card, overflow:'auto'}}>
          <table style={{width:'100%', borderCollapse:'collapse', fontSize:12.5, minWidth:760}}>
            <thead><tr style={{textAlign:'left', color:G.muted, fontSize:11.5}}>
              {['Nr. inv.', 'Denumire (WinMentor)', 'Cont', 'Valoare', 'Triaj', 'Utilaj BD legat'].map(h => <th key={h} style={{padding:'9px 10px', borderBottom:`1px solid ${G.border}`, position:'sticky', top:0, background:G.surface}}>{h}</th>)}
            </tr></thead>
            <tbody>
              {rowsFirma
                .filter(r => { const qq = q.trim().toLowerCase(); return !qq || (r.denumire || '').toLowerCase().includes(qq) || String(r.nr_inventar).includes(qq) })
                .sort((a, b) => (a.cont || '').localeCompare(b.cont || '') || String(a.nr_inventar).localeCompare(String(b.nr_inventar), 'ro', { numeric:true }))
                .map(r => (
                  <tr key={r.id} style={{borderTop:`1px solid ${G.border}`}}>
                    <td style={{padding:'6px 10px', fontWeight:700, whiteSpace:'nowrap'}}>{firma === 'INVEST' ? 'GI-' : ''}{r.nr_inventar}</td>
                    <td style={{padding:'6px 10px'}}>
                      {r.denumire}
                      {r.denumire_noua && r.corectie_tip === 'denumire' && <div style={{color:G.green, fontSize:11.5, fontWeight:700}}>NOU: {r.denumire_noua}</div>}
                    </td>
                    <td style={{padding:'6px 10px', color:G.muted, whiteSpace:'nowrap'}}>{r.cont}</td>
                    <td style={{padding:'6px 10px', textAlign:'right', whiteSpace:'nowrap'}}>{fmtLei(r.valoare)}</td>
                    <td style={{padding:'6px 10px'}}>{badgeTriaj(r.triaj)}</td>
                    <td style={{padding:'6px 10px'}}>{r.matched_active_id ? actInfo(r.matched_active_id) : <span style={{color:G.dim}}>—</span>}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
      </>}

      {/* ══ Panou legare poziție ↔ utilaj BD ══ */}
      {legare && (
        <div style={{position:'fixed', inset:0, background:'#000A', display:'flex', alignItems:'flex-start', justifyContent:'center', padding:'8vh 16px', zIndex:60}}
             onClick={() => setLegare(null)}>
          <div style={{...S.card, width:'min(680px, 100%)', padding:16}} onClick={e => e.stopPropagation()}>
            <div style={{fontWeight:700, marginBottom:4}}>Leagă poziția: inv {legare.nr_inventar} — {legare.denumire}</div>
            <div style={{fontSize:12, color:G.muted, marginBottom:10}}>
              {legare.firma} · {legare.cont} · {fmtLei(legare.valoare)} lei · prima rată {legare.an_luna_prima_rata || '—'}.
              Nr. de inventar scris pe utilaj va fi <b style={{color:G.green}}>{legare.firma === 'INVEST' ? 'GI-' : ''}{legare.nr_inventar}</b>.
            </div>
            <input autoFocus style={{...S.input, width:'100%'}} placeholder="Caută utilajul în BD (model, marcă, nr. înmatriculare, serie)…"
                   value={qActiv} onChange={e => setQActiv(e.target.value)} />
            <div style={{marginTop:10, maxHeight:'46vh', overflow:'auto'}}>
              {rezultateActive.map(a => (
                <div key={a.id} style={{display:'flex', gap:10, alignItems:'center', padding:'8px 6px', borderTop:`1px solid ${G.border}`, cursor:'pointer'}}
                     onClick={() => leagaActiv(legare, a)}>
                  <div style={{flex:1}}>
                    <div style={{fontSize:13, fontWeight:600}}>{a.model} <span style={{color:G.muted, fontWeight:400}}>{a.marca || ''}</span></div>
                    <div style={{fontSize:11.5, color:G.muted}}>{a.nr_inmatriculare || 'fără nr.'} · serie {a.serie_sasiu || '—'} · {a.firma_proprietara}</div>
                  </div>
                  {a.nr_inventar
                    ? <span style={{fontSize:11.5, color:G.yellow, whiteSpace:'nowrap'}}>are inv {a.nr_inventar}</span>
                    : <span style={{fontSize:11.5, color:G.green, whiteSpace:'nowrap'}}>fără inv</span>}
                </div>
              ))}
              {qActiv.trim().length >= 2 && rezultateActive.length === 0 && <div style={{color:G.muted, padding:12, fontSize:12.5}}>Niciun utilaj găsit.</div>}
              {qActiv.trim().length < 2 && <div style={{color:G.dim, padding:12, fontSize:12.5}}>Scrie minim 2 caractere.</div>}
            </div>
            <div style={{textAlign:'right', marginTop:10}}><button style={S.btnS} onClick={() => setLegare(null)}>Închide</button></div>
          </div>
        </div>
      )}
    </div>
  )
}
