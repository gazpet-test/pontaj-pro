// ════════════════════════════════════════════════════════════════
// OfertareTriere.jsx — ETAPA 0: triere din Fișa de date (14.09.2026, cerut de Răzvan).
//
// Înainte: la orice licitație nouă colegii apăsau „Adu din SEAP" + „Procesează" și platforma citea
// TOATĂ documentația (46 fișiere la Simian, planșe de 90 MB la Potlogi) înainte ca cineva să
// decidă dacă vrem licitația. Facturile de API veneau de acolo. Înainte de platformă, trierea se
// făcea într-un Excel cu 3 coloane: cerința / ce cere / cine acoperă la Gazpet.
//
// Acum: (1) „Triere din Fișa de date" = un singur apel pe fișa de date (~0,3 USD), scoate exact
// Excel-ul ăla + verdict + clarificări de trimis; oricine din echipă o poate rula. (2) Citirea
// integrală, registrul și acoperirea le pornește DOAR ownerul sau responsabilul licitației —
// poarta e `poatePorniProcesarea` de mai jos, folosită în OfertareLicitatii.jsx.
// Trierea NU scrie în registrul de cerințe (varianta A): e o fișă ieftină, se reface liber.
// ════════════════════════════════════════════════════════════════
import { useState, useEffect } from 'react'
import * as XLSX from 'xlsx-js-style'
import { supabase } from './lib/supabase.js'

const G = { bg:'#0D1117', surface:'#161B22', card:'#1C2128', border:'#30363D', border2:'#21262D',
  text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681', ofertare:'#3FB6E2', green:'#3FB950', blue:'#58A6FF',
  orange:'#F0883E', yellow:'#E3B341', red:'#F85149', purple:'#BC8CFF' }
const S = {
  btn: { padding:'7px 12px', background:G.surface, color:G.text, border:`1px solid ${G.border2}`, borderRadius:7, cursor:'pointer', fontSize:12 },
  btnP: { padding:'8px 14px', background:G.ofertare, color:'#0D1117', border:'none', borderRadius:7, cursor:'pointer', fontSize:12.5, fontWeight:700 },
  card: { background:G.card, border:`1px solid ${G.border}`, borderRadius:10 },
}

export const VERDICT = {
  mergem:         { t:'🟢 MERGEM', c:G.green,  d:'nimic eliminatoriu neacoperit din fișa de date' },
  cu_clarificari: { t:'🟡 CU CLARIFICĂRI', c:G.yellow, d:'mergem dacă se lămuresc punctele de mai jos' },
  nu_se_poate:    { t:'🔴 NU SE POATE', c:G.red, d:'o cerință eliminatorie clar neacoperită' },
  neclar:         { t:'⚪ NECLAR', c:G.muted, d:'fișa e incompletă — verifică manual' },
}

// Poarta pe cheltuială: cine are voie să pornească citirea integrală / registrul / acoperirea.
export const poatePorniProcesarea = (profile, licitatie) =>
  !!profile && (profile.is_owner === true || (!!licitatie?.responsabil_id && profile.id === licitatie.responsabil_id))
export const MOTIV_POARTA = 'Citirea integrală costă (documente + registru + acoperire ≈ 5–25 USD/licitație). O pornește doar ownerul sau responsabilul licitației, după triere.'

// Rândurile fișei de triere, în ordinea Excel-ului colegilor
const RANDURI = [
  ['Autoritatea contractantă', r => r.autoritate],
  ['Nr. anunț SEAP', r => r.nr_anunt],
  ['Data depunere', r => r.termen_depunere],
  ['Zile pentru solicitări de clarificări', r => r.zile_clarificari],
  ['Termen răspuns AC la clarificări', r => r.termen_raspuns_ac],
  ['Amplasamentul lucrării', r => r.amplasament],
  ['Descrierea pe scurt', r => r.descriere],
  ['Valoare estimată', r => r.valoare_estimata],
  ['Termen de execuție', r => r.termen_executie],
  ['Criteriu de atribuire', r => r.criteriu],
  ['Experiență similară — cerința', r => r.experienta_similara?.cerinta],
  ['Lucrări similare acceptate', r => r.experienta_similara?.lucrari_acceptate],
  ['Cumul de funcții', r => r.cumul_functii_interzis == null ? null : (r.cumul_functii_interzis ? '⚠️ INTERZIS — o persoană nu poate îndeplini mai multe funcții' : 'permis / nespecificat')],
  ['Atestări / autorizații de firmă', r => r.atestari],
  ['Sursa de finanțare', r => r.sursa_finantare],
  ['Garanție de participare', r => r.garantie_participare],
  ['Garanție de bună execuție', r => r.garantie_buna_executie],
  ['Organizare de șantier', r => r.organizare_santier],
  ['Liste de cantități', r => r.liste_cantitati],
  ['Grafic de execuție', r => r.grafic],
  ['Laborator / încercări', r => r.laborator],
]

export function exportTriereXlsx(licitatie, rez) {
  const rows = [[licitatie.obiect || rez.obiect || '', '', 'GAZPET']]
  for (const [k, f] of RANDURI) rows.push([k, f(rez) || '', ''])
  rows.push(['Personal minim / roluri solicitate', rez.cumul_functii_interzis ? 'O persoană nu poate îndeplini în mod cumulativ mai multe funcții' : '', ''])
  for (const r of rez.roluri || []) {
    rows.push([r.rol || '', r.cerinte || '', r.propunere || 'NIMENI'])
    if (r.documente) rows.push(['', r.documente, r.propunere ? '' : (r.motiv || '')])
  }
  for (const a of rez.alte_cerinte || []) rows.push(['Altă cerință', a, ''])
  ;(rez.clarificari_propuse || []).forEach((c, i) => rows.push([`Solicitare de clarificare nr.${i + 1}`, c, '']))
  rows.push(['Verdict triere', `${(VERDICT[rez.verdict] || VERDICT.neclar).t} — ${rez.motiv_verdict || ''}`, ''])
  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = [{ wch: 42 }, { wch: 110 }, { wch: 26 }]
  const bold = { font: { bold: true } }
  ws['A1'].s = bold; ws['C1'].s = bold
  rows.forEach((r, i) => { const c = ws[`A${i + 1}`]; if (c && r[0]) c.s = { font: { bold: true }, alignment: { wrapText: true, vertical: 'top' } }
    const b = ws[`B${i + 1}`]; if (b) b.s = { alignment: { wrapText: true, vertical: 'top' } } })
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'cerinte')
  XLSX.writeFile(wb, `cerinte_licitatie_${(licitatie.nr_anunt || 'triere').replace(/[^A-Za-z0-9]+/g, '_')}.xlsx`)
}

export function CostAI({ licitatieId, refresh = 0 }) {
  const [c, setC] = useState(null)
  useEffect(() => { supabase.rpc('fn_ofertare_cost_ai', { p_lic: licitatieId }).then(({ data }) => setC(data?.[0] || null)) }, [licitatieId, refresh])
  if (!c) return null
  const usd = Number(c.cost_usd || 0)
  const det = Object.entries(c.pe_functie || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k.replace('ofertare-', '')}: ${v} USD`).join(' · ')
  return (
    <span title={det || 'niciun apel AI'} style={{ fontSize:11.5, color: usd > 10 ? G.orange : G.muted, fontWeight:700, whiteSpace:'nowrap' }}>
      💸 AI până acum: {usd.toFixed(2)} USD ({c.apeluri} apeluri)
    </span>
  )
}

export default function OfertareTriere({ licitatie, profile, showToast = null, onChanged = null, onProceseaza = null }) {
  const [tr, setTr] = useState(undefined)   // undefined = se încarcă, null = nu există
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [tick, setTick] = useState(0)
  const [areFisa, setAreFisa] = useState(null)
  const load = async () => {
    const [{ data }, { data: f }] = await Promise.all([
      supabase.from('ofertare_triere').select('*, autor:profiles!ofertare_triere_created_by_fkey(name)').eq('licitatie_id', licitatie.id).maybeSingle(),
      supabase.from('ofertare_documente_atribuire').select('id, nume_original').eq('licitatie_id', licitatie.id).eq('tip', 'fisa_date').not('fisier_path', 'like', '%/neincarcat/%').limit(1),
    ])
    setTr(data || null); setAreFisa(f?.[0] || null)
  }
  useEffect(() => { load() }, [licitatie.id])

  const ruleaza = async () => {
    setBusy(true); setErr(null)
    try {
      const { data, error } = await supabase.functions.invoke('ofertare-triere', { body: { licitatie_id: licitatie.id } })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      await load(); setTick(t => t + 1); onChanged?.()
      showToast?.(`Triere gata: ${(VERDICT[data.verdict] || VERDICT.neclar).t} · ${Number(data.cost_usd || 0).toFixed(2)} USD`, 'ok')
    } catch (e) { setErr(e?.message || String(e)) }
    finally { setBusy(false) }
  }

  const rez = tr?.rezultat || null
  const v = rez ? (VERDICT[rez.verdict] || VERDICT.neclar) : null
  const gate = poatePorniProcesarea(profile, licitatie)

  return (
    <div style={{ ...S.card, padding:16 }}>
      <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap', marginBottom:10 }}>
        <div style={{ fontSize:14, fontWeight:800 }}>⚡ Triere din Fișa de date</div>
        <span style={{ fontSize:11.5, color:G.muted }}>un singur apel pe fișa de date (~0,3 USD) — fără caiete, planșe sau formulare</span>
        <div style={{ marginLeft:'auto', display:'flex', gap:8, alignItems:'center' }}>
          <CostAI licitatieId={licitatie.id} refresh={tick} />
          {rez && <button style={S.btn} onClick={() => exportTriereXlsx(licitatie, rez)} title="Excel în formatul folosit de colegi (cerință / ce cere / cine acoperă)">📊 Excel</button>}
          {!busy && <button style={{ ...S.btnP, background: rez ? G.surface : G.ofertare, color: rez ? G.text : '#0D1117', border: rez ? `1px solid ${G.border2}` : 'none' }} onClick={ruleaza}
            disabled={areFisa === null}
            title={areFisa === null ? 'Nu există Fișa de date în documentație — apasă „Adu din SEAP" (doar descarcă) sau urcă fișa' : 'Citește DOAR fișa de date și scoate fișa de triere'}>
            {rez ? '🔁 Refă trierea' : '⚡ Triere din Fișa de date'}
          </button>}
          {busy && <span style={{ fontSize:12, color:G.ofertare }}>⏳ citesc fișa de date…</span>}
        </div>
      </div>
      {err && <div style={{ color:G.red, fontSize:12.5, marginBottom:8 }}>⚠️ {err}</div>}
      {areFisa === null && tr !== undefined && (
        <div style={{ fontSize:12.5, color:G.orange, marginBottom:8 }}>
          Licitația nu are încă Fișa de date. „⬇️ Adu din SEAP" doar descarcă documentația (gratis) — nu o citește. După descărcare, apasă trierea aici.
        </div>
      )}
      {areFisa && !rez && !busy && (
        <div style={{ fontSize:12.5, color:G.muted }}>Fișa de date găsită: <b style={{ color:G.text }}>{areFisa.nume_original.split('/').pop()}</b>. Apasă „Triere" ca să vezi în ~1 minut dacă merită să mergem mai departe.</div>
      )}

      {rez && (
        <>
          {/* verdict */}
          <div style={{ display:'flex', gap:12, alignItems:'flex-start', flexWrap:'wrap', padding:'12px 14px', borderRadius:10, border:`1px solid ${v.c}66`, background:v.c + '12', marginBottom:14 }}>
            <div>
              <div style={{ fontSize:16, fontWeight:900, color:v.c }}>{v.t}</div>
              <div style={{ fontSize:11.5, color:G.muted }}>{v.d} · încredere {rez.confidence ?? '—'}% · din „{rez.sursa?.nume?.split('/').pop()}"{rez.sursa?.pagini ? `, ${rez.sursa.pagini} pag` : ''} · {tr.autor?.name || '—'}, {new Date(tr.updated_at).toLocaleString('ro-RO', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })}</div>
              {rez.motiv_verdict && <div style={{ fontSize:13, marginTop:6 }}>{rez.motiv_verdict}</div>}
            </div>
            <div style={{ marginLeft:'auto', display:'flex', flexDirection:'column', gap:6, alignItems:'flex-end' }}>
              {onProceseaza && (gate
                ? <button style={{ ...S.btnP, background:G.green }} onClick={onProceseaza} title="Pornește citirea integrală a documentației (documente → registru → acoperire). Costă.">✅ Participăm → procesează tot</button>
                : <span style={{ fontSize:11.5, color:G.dim, maxWidth:320, textAlign:'right' }} title={MOTIV_POARTA}>🔒 Citirea integrală o pornește ownerul sau responsabilul licitației</span>)}
            </div>
          </div>

          {/* tabelul Excel */}
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12.5 }}>
            <tbody>
              {RANDURI.map(([k, f]) => { const val = f(rez); return (
                <tr key={k} style={{ borderBottom:`1px solid ${G.border2}` }}>
                  <td style={{ padding:'6px 8px', color:G.muted, fontWeight:700, width:230, verticalAlign:'top' }}>{k}</td>
                  <td style={{ padding:'6px 8px', color: val ? (k === 'Cumul de funcții' && rez.cumul_functii_interzis ? G.orange : G.text) : G.dim, whiteSpace:'pre-wrap' }}>{val || '—'}</td>
                </tr>) })}
            </tbody>
          </table>

          {/* roluri */}
          <div style={{ fontSize:13, fontWeight:800, margin:'14px 0 6px' }}>👥 Personal minim / roluri solicitate ({(rez.roluri || []).length})</div>
          {!(rez.roluri || []).length && <div style={{ fontSize:12, color:G.dim }}>Fișa nu cere personal nominalizat (sau e în caietul de sarcini — se vede la citirea integrală).</div>}
          {(rez.roluri || []).length > 0 && (
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12.5 }}>
              <thead><tr style={{ color:G.muted, fontSize:11, textTransform:'uppercase' }}>
                <th style={{ textAlign:'left', padding:'4px 8px', width:200 }}>Rol</th><th style={{ textAlign:'left', padding:'4px 8px' }}>Ce cere / documente</th><th style={{ textAlign:'left', padding:'4px 8px', width:220 }}>Gazpet</th>
              </tr></thead>
              <tbody>{rez.roluri.map((r, i) => (
                <tr key={i} style={{ borderTop:`1px solid ${G.border2}`, verticalAlign:'top' }}>
                  <td style={{ padding:'6px 8px', fontWeight:700 }}>{r.rol}</td>
                  <td style={{ padding:'6px 8px' }}>{r.cerinte}{r.documente ? <div style={{ color:G.muted, fontSize:11.5, marginTop:3 }}>📎 {r.documente}</div> : null}</td>
                  <td style={{ padding:'6px 8px' }}>
                    <div style={{ fontWeight:800, color: r.propunere ? G.green : G.red }}>{r.propunere || 'NIMENI'}</div>
                    {r.motiv && <div style={{ color:G.muted, fontSize:11.5 }}>{r.motiv}</div>}
                  </td>
                </tr>))}
              </tbody>
            </table>
          )}

          {(rez.alte_cerinte || []).length > 0 && (
            <>
              <div style={{ fontSize:13, fontWeight:800, margin:'14px 0 6px' }}>📌 Alte cerințe de ținut minte</div>
              <ul style={{ margin:0, paddingLeft:18, fontSize:12.5 }}>{rez.alte_cerinte.map((a, i) => <li key={i} style={{ marginBottom:3 }}>{a}</li>)}</ul>
            </>
          )}
          {(rez.clarificari_propuse || []).length > 0 && (
            <>
              <div style={{ fontSize:13, fontWeight:800, margin:'14px 0 6px', color:G.yellow }}>❓ Clarificări de trimis autorității ({rez.clarificari_propuse.length})</div>
              <ol style={{ margin:0, paddingLeft:20, fontSize:12.5 }}>{rez.clarificari_propuse.map((c, i) => <li key={i} style={{ marginBottom:4 }}>{c}</li>)}</ol>
              <div style={{ fontSize:11.5, color:G.dim, marginTop:6 }}>Se trimit din tab-ul „Clarificări" — aici sunt doar propuse, nimic nu pleacă singur.</div>
            </>
          )}
        </>
      )}
    </div>
  )
}
