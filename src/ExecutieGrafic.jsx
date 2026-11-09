// ═══════════════════════════════════════════════════════════════════════════
// ExecutieGrafic.jsx — Execuție → proiect → „📅 Grafic” (cerere Răzvan 09.11.2026, pasul 1 al legăturii MS Project ↔ ERP)
// Graficul de execuție importat din fișierele MS Project / Primavera (o revizie = un fișier: „LOT 2 R5 sep 2026”).
// Doar citire: executie_grafic_revizii + executie_grafic_activitati (migrarea 20261202a, RLS pe dreptul Execuție);
// importul îl face scriptul de pe server, nu pagina.
// Tabel ierarhic (pliabil la nivel 1–2) + Gantt minimal pe săptămâni; roșu = finish plan trecut și realizat < 100%.
// L23: citiri pe chei (paginareKeyset), numărul activităților verificat față de revizie (L12).
// L24: fiecare citire are generația ei; un răspuns întârziat (alt proiect / altă revizie) nu se aplică.
// L18: o eroare se afișează ca eroare, nu ca „niciun grafic”.
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './lib/supabase.js'
import { paginareKeyset, aziBucuresti } from './hrDeciziiUtil.js'
import {
  revizieImplicita, verificaActivitati, arePliere, randuriVizibile, toatePliabile, eDepasita, doarDepasiteCuStramosi,
  scaraSaptamani, pozitieBara, pozitieZi, fmtData, fmtNumar, fmtPct, numeFisier, notaIncerte, descrieEroare,
} from './executieGraficLogica.js'

const G = {
  bg:'#0D1117', surface:'#161B22', card:'#1C2128', card2:'#21262D', text:'#E6EDF3',
  muted:'#8B949E', dim:'#6E7681', border:'#30363D', border2:'#21262D',
  blue:'#58A6FF', green:'#2EA043', yellow:'#D29922', orange:'#F0883E', red:'#F85149', teal:'#2DD4BF',
}
const S = {
  btn: { padding: '5px 10px', background: G.surface, color: G.text, border: `1px solid ${G.border}`, borderRadius: 6, cursor: 'pointer', fontSize: 12 },
  card: { background: G.card, border: `1px solid ${G.border}`, borderRadius: 10, padding: '12px 14px' },
  th: { padding: '0 8px', fontSize: 11, color: G.muted, fontWeight: 600, textAlign: 'left', whiteSpace: 'nowrap', borderBottom: `1px solid ${G.border}` },
  td: { padding: '0 8px', fontSize: 12, color: G.text, whiteSpace: 'nowrap', borderBottom: `1px solid ${G.border2}` },
}
const COL_REV = 'id, proiect_id, eticheta, sursa_fisier, tip_fisier, data_stare, camp_pct_plan, camp_pct_raportat, nr_activitati, metadate, importat_la, activ'
const COL_ACT = 'id, revizie_id, ordine, uid_sursa, wbs, nivel, nume, start_plan, finish_plan, start_real, finish_real, start_baseline, finish_baseline, durata_zile, pct_realizat, pct_plan, pct_raportat, milestone, rezumat, activ, predecesori, resurse'
const H_RAND = 24        // înălțimea unui rând (tabel și Gantt, ca să rămână aliniate)
const H_ANTET = 36       // antetul: 2 rânduri de 18 (ani / luni)
const LAT_SAPT = 14      // lățimea unei săptămâni în Gantt, px

// citire pe chei (keyset pe id) a unui tabel, filtrat pe o coloană
const citesteToate = (client, tabel, coloane, col, val) => paginareKeyset((ultim, pas) => {
  let q = client.from(tabel).select(coloane).eq(col, val).order('id').limit(pas)
  if (ultim != null) q = q.gt('id', ultim)
  return q
})

export default function ExecutieGrafic({ proiectId, client = supabase, azi: aziDat }) {
  const [revizii, setRevizii] = useState(null)        // null = se încarcă
  const [eroare, setEroare] = useState(null)          // { tip, text } la citirea reviziilor
  const [revId, setRevId] = useState(null)
  const [acts, setActs] = useState(null)              // null = se încarcă / nimic ales
  const [eroareActs, setEroareActs] = useState(null)
  const [pliate, setPliate] = useState(() => new Set())
  const [doarDepasite, setDoarDepasite] = useState(false)
  const [reincarc, setReincarc] = useState(0)
  const genRev = useRef(0)
  const genAct = useRef(0)
  const ganttRef = useRef(null)
  const azi = aziDat || aziBucuresti()

  // la demontare nicio citire în zbor nu se mai aplică
  useEffect(() => () => { genRev.current += 1; genAct.current += 1 }, [])

  // ── reviziile proiectului ──
  useEffect(() => {
    const g = ++genRev.current
    genAct.current += 1                                   // activitățile proiectului vechi nu se mai aplică
    setRevizii(null); setEroare(null); setRevId(null); setActs(null); setEroareActs(null); setPliate(new Set()); setDoarDepasite(false)
    ;(async () => {
      try {
        const toate = await citesteToate(client, 'executie_grafic_revizii', COL_REV, 'proiect_id', proiectId)
        if (g !== genRev.current) return
        const ale = toate.filter(r => r.proiect_id === proiectId)
        setRevizii(ale)
        setRevId(revizieImplicita(ale)?.id ?? null)
      } catch (e) {
        if (g !== genRev.current) return
        setRevizii(null); setEroare(descrieEroare(e))
      }
    })()
  }, [proiectId, client, reincarc])

  const revizie = useMemo(() => (revizii || []).find(r => r.id === revId) || null, [revizii, revId])

  // ── activitățile reviziei alese ──
  useEffect(() => {
    if (!revizie) return
    const g = ++genAct.current
    const id = revizie.id
    setActs(null); setEroareActs(null); setPliate(new Set())
    ;(async () => {
      try {
        const toate = await citesteToate(client, 'executie_grafic_activitati', COL_ACT, 'revizie_id', id)
        if (g !== genAct.current) return
        const ale = toate.filter(a => a.revizie_id === id).sort((a, b) => a.ordine - b.ordine)
        const problema = verificaActivitati(ale, revizie)
        if (problema) { setEroareActs({ tip: 'eroare', text: problema }); return }
        setActs(ale)
      } catch (e) {
        if (g !== genAct.current) return
        setEroareActs(descrieEroare(e))
      }
    })()
  }, [revizie, client])

  const vizibile = useMemo(() => {
    if (!acts) return []
    return doarDepasite ? doarDepasiteCuStramosi(acts, azi) : randuriVizibile(acts, pliate)
  }, [acts, pliate, doarDepasite, azi])
  const scara = useMemo(() => (acts ? scaraSaptamani(acts) : null), [acts])
  const nrDepasite = useMemo(() => (acts || []).filter(a => !a.rezumat && eDepasita(a, azi)).length, [acts, azi])

  // la o revizie nouă, Gantt-ul se derulează ca „azi” să fie la o treime din zona vizibilă (graficele încep cu luni în urmă)
  useEffect(() => {
    const el = ganttRef.current, x = scara ? pozitieZi(scara, azi) : null
    if (el && x != null) el.scrollLeft = Math.max(0, x * LAT_SAPT - el.clientWidth / 3)
  }, [scara, azi])

  const comuta = uid => setPliate(p => { const n = new Set(p); if (n.has(uid)) n.delete(uid); else n.add(uid); return n })

  // ── stări fără tabel ──
  if (eroare) {
    return (
      <div style={{ padding: '20px 28px' }}>
        <div data-test="eroare" style={{ ...S.card, borderColor: eroare.tip === 'lipsa' ? G.border : G.red + '88', color: eroare.tip === 'lipsa' ? G.muted : G.red, fontSize: 13 }}>
          {eroare.text}
          {eroare.tip === 'eroare' && <button style={{ ...S.btn, marginLeft: 12 }} onClick={() => setReincarc(k => k + 1)}>↻ Reîncearcă</button>}
        </div>
      </div>
    )
  }
  if (revizii == null) return <div style={{ padding: '20px 28px', color: G.muted, fontSize: 13 }}>Se încarcă graficul…</div>
  if (!revizii.length) {
    return (
      <div style={{ padding: '20px 28px' }}>
        <div data-test="gol" style={{ ...S.card, color: G.muted, fontSize: 13 }}>Niciun grafic importat pentru acest proiect.</div>
      </div>
    )
  }

  const arePlan = !!revizie?.camp_pct_plan
  const areRaport = !!revizie?.camp_pct_raportat
  const nota = notaIncerte(revizie?.metadate)
  const ordonate = [...revizii].sort((a, b) => String(b.importat_la || '').localeCompare(String(a.importat_la || '')) || b.id - a.id)
  const latGantt = scara ? scara.nrSapt * LAT_SAPT : 0
  const xAzi = scara ? pozitieZi(scara, azi) : null

  return (
    <div style={{ padding: '16px 28px', color: G.text }}>
      {/* ── antet: revizia, starea, contoarele ── */}
      <div style={{ ...S.card, display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center', marginBottom: 12 }}>
        <label style={{ fontSize: 12, color: G.muted, display: 'flex', gap: 6, alignItems: 'center' }}>
          Revizia
          <select data-test="revizie" value={revId ?? ''} onChange={e => setRevId(Number(e.target.value))}
            style={{ background: G.bg, color: G.text, border: `1px solid ${G.border}`, borderRadius: 6, padding: '4px 8px', fontSize: 12 }}>
            {ordonate.map(r => <option key={r.id} value={r.id}>{r.eticheta}{r.activ ? ' (activă)' : ''}</option>)}
          </select>
        </label>
        {revizie && (
          <div style={{ fontSize: 12, color: G.muted, display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <span>date la stare: <b style={{ color: G.text }}>{fmtData(revizie.data_stare)}</b></span>
            <span title={numeFisier(revizie.sursa_fisier)}>fișier: {numeFisier(revizie.sursa_fisier)}</span>
            <span>{revizie.nr_activitati} activități</span>
          </div>
        )}
        {acts && (
          <span data-test="depasite" style={{ fontSize: 12, fontWeight: 700, color: nrDepasite ? G.red : G.green }}>
            {nrDepasite === 1 ? '1 activitate depășită' : `${nrDepasite} activități depășite`}
          </span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ fontSize: 12, color: G.muted, display: 'flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" data-test="doar-depasite" checked={doarDepasite} onChange={e => setDoarDepasite(e.target.checked)} /> Doar depășite
          </label>
          <button style={S.btn} disabled={!acts || doarDepasite} onClick={() => setPliate(toatePliabile(acts || []))}>Restrânge tot</button>
          <button style={S.btn} disabled={!acts || doarDepasite} onClick={() => setPliate(new Set())}>Extinde tot</button>
        </div>
        {nota && <div data-test="incerte" style={{ flexBasis: '100%', fontSize: 11, color: G.yellow }}>⚠ {nota}</div>}
      </div>

      {eroareActs && (
        <div data-test="eroare-activitati" style={{ ...S.card, borderColor: G.red + '88', color: eroareActs.tip === 'lipsa' ? G.muted : G.red, fontSize: 13 }}>
          {eroareActs.text}
        </div>
      )}
      {!eroareActs && !acts && <div style={{ color: G.muted, fontSize: 13 }}>Se încarcă activitățile…</div>}

      {acts && (
        <div style={{ display: 'flex', alignItems: 'flex-start', border: `1px solid ${G.border}`, borderRadius: 8, background: G.surface }}>
          {/* ── tabelul ── */}
          <table style={{ borderCollapse: 'collapse', flexShrink: 0 }}>
            <thead>
              <tr style={{ height: H_ANTET }}>
                <th style={S.th}>WBS</th>
                <th style={{ ...S.th, minWidth: 260 }}>Activitate</th>
                <th style={S.th}>Start</th>
                <th style={S.th}>Finish</th>
                <th style={S.th} title="zile lucrătoare">Durată (zile lucr.)</th>
                <th style={S.th} title="% Complete din MS Project">% realizat</th>
                {arePlan && <th style={S.th} title={`Coloana de raport din fișier: ${revizie.camp_pct_plan}`}>% plan</th>}
                {areRaport && <th style={S.th} title={`Coloana de raport din fișier: ${revizie.camp_pct_raportat}`}>% raport</th>}
              </tr>
            </thead>
            <tbody>
              {vizibile.map(a => {
                const dep = eDepasita(a, azi)
                const inactiv = a.activ === false
                const pliat = pliate.has(a.uid_sursa)
                return (
                  <tr key={a.uid_sursa} data-wbs={a.wbs} data-depasit={dep ? '1' : '0'} data-inactiv={inactiv ? '1' : '0'}
                    style={{ height: H_RAND, opacity: inactiv ? 0.45 : 1, background: dep ? G.red + '12' : 'transparent' }}>
                    <td style={{ ...S.td, color: G.muted, borderLeft: `3px solid ${dep ? G.red : 'transparent'}` }}>{a.wbs}</td>
                    <td style={{ ...S.td, maxWidth: 380, overflow: 'hidden', textOverflow: 'ellipsis', paddingLeft: 8 + a.nivel * 14,
                      fontWeight: a.rezumat ? 700 : 400, textDecoration: inactiv ? 'line-through' : 'none' }}
                      title={[a.nume, a.predecesori && `predecesori: ${a.predecesori}`, a.resurse && `resurse: ${a.resurse}`,
                        inactiv && 'activitate inactivă în fișier'].filter(Boolean).join('\n')}>
                      {arePliere(a) && !doarDepasite
                        ? <button aria-label={pliat ? 'Desfă' : 'Pliază'} data-test="comutator" onClick={() => comuta(a.uid_sursa)}
                            style={{ background: 'transparent', border: 'none', color: G.muted, cursor: 'pointer', padding: '0 4px 0 0', fontSize: 11 }}>
                            {pliat ? '▸' : '▾'}
                          </button>
                        : <span style={{ display: 'inline-block', width: 14 }} />}
                      {a.milestone && <span style={{ color: G.yellow, marginRight: 4 }}>◆</span>}
                      {a.nume || '—'}
                    </td>
                    <td style={S.td}>{fmtData(a.start_plan)}</td>
                    <td style={{ ...S.td, color: dep ? G.red : G.text, fontWeight: dep ? 700 : 400 }}
                      title={dep ? `Termen depășit: finish ${fmtData(a.finish_plan)}, realizat ${fmtPct(a.pct_realizat)}` : undefined}>
                      {fmtData(a.finish_plan)}
                    </td>
                    <td style={{ ...S.td, textAlign: 'right' }}>{fmtNumar(a.durata_zile)}</td>
                    <td style={{ ...S.td, textAlign: 'right' }}>{fmtPct(a.pct_realizat)}</td>
                    {arePlan && <td style={{ ...S.td, textAlign: 'right', color: G.muted }}>{fmtPct(a.pct_plan)}</td>}
                    {areRaport && <td style={{ ...S.td, textAlign: 'right' }}>{fmtPct(a.pct_raportat)}</td>}
                  </tr>
                )
              })}
            </tbody>
          </table>

          {/* ── Gantt-ul pe săptămâni (scroll orizontal) ── */}
          <div ref={ganttRef} data-test="gantt" style={{ overflowX: 'auto', flex: 1, minWidth: 120, borderLeft: `1px solid ${G.border}` }}>
            {scara && (
              <div style={{ width: latGantt, position: 'relative' }}>
                <div style={{ height: H_ANTET, boxSizing: 'border-box', position: 'relative', borderBottom: `1px solid ${G.border}` }}>
                  {scara.ani.map(x => (
                    <div key={'a' + x.an} style={{ position: 'absolute', top: 0, height: 18, left: x.deLa * LAT_SAPT, width: x.nr * LAT_SAPT,
                      borderLeft: `1px solid ${G.border}`, fontSize: 10, color: G.muted, paddingLeft: 3, overflow: 'hidden', whiteSpace: 'nowrap' }}>{x.an}</div>
                  ))}
                  {scara.luni.map(x => (
                    <div key={`l${x.an}-${x.luna}`} style={{ position: 'absolute', top: 18, height: 18, left: x.deLa * LAT_SAPT, width: x.nr * LAT_SAPT,
                      borderLeft: `1px solid ${G.border2}`, fontSize: 10, color: G.dim, paddingLeft: 2, overflow: 'hidden', whiteSpace: 'nowrap' }}>
                      {x.nr * LAT_SAPT >= 26 ? x.eticheta : ''}
                    </div>
                  ))}
                </div>
                <div style={{ position: 'relative',
                  backgroundImage: `repeating-linear-gradient(to right, transparent 0, transparent ${LAT_SAPT - 1}px, ${G.border2} ${LAT_SAPT - 1}px, ${G.border2} ${LAT_SAPT}px)` }}>
                  {xAzi != null && (
                    <div title={`azi, ${fmtData(azi)}`} style={{ position: 'absolute', top: 0, bottom: 0, left: xAzi * LAT_SAPT, width: 2, background: G.orange, opacity: 0.8, zIndex: 2 }} />
                  )}
                  {vizibile.map(a => <RandGantt key={a.uid_sursa} a={a} scara={scara} dep={eDepasita(a, azi)} />)}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// Un rând din Gantt: bara plan (cu umplere pe % realizat) / rezumat subțire / jalon ◆, plus baseline-ul ca linie gri dedesubt
function RandGantt({ a, scara, dep }) {
  const bara = pozitieBara(scara, a.start_plan, a.finish_plan)
  const bl = pozitieBara(scara, a.start_baseline, a.finish_baseline)
  const pct = Math.max(0, Math.min(100, Number(a.pct_realizat) || 0))
  const culoare = dep ? G.red : a.rezumat ? G.muted : G.blue
  const inactiv = a.activ === false
  return (
    <div data-gantt={a.wbs} style={{ height: H_RAND, boxSizing: 'border-box', position: 'relative', borderBottom: `1px solid ${G.border2}`, opacity: inactiv ? 0.4 : 1 }}>
      {bl && (
        <div title={`baseline ${fmtData(a.start_baseline)} – ${fmtData(a.finish_baseline)}`}
          style={{ position: 'absolute', top: 19, height: 2, left: bl.stanga * LAT_SAPT, width: Math.max(bl.latime * LAT_SAPT, 2), background: G.dim }} />
      )}
      {a.milestone && bara ? (
        <div title={`${a.nume} · ${fmtData(a.finish_plan)}`}
          style={{ position: 'absolute', top: 3, left: (bara.stanga + bara.latime - 0.5 / 7) * LAT_SAPT - 6, fontSize: 12, lineHeight: '16px',
            color: dep ? G.red : pct >= 100 ? G.green : G.yellow }}>◆</div>
      ) : bara ? (
        <div title={`${a.nume} · ${fmtData(a.start_plan)} – ${fmtData(a.finish_plan)} · ${fmtPct(a.pct_realizat)}`}
          style={{ position: 'absolute', top: a.rezumat ? 9 : 6, height: a.rezumat ? 5 : 11, left: bara.stanga * LAT_SAPT,
            width: Math.max(bara.latime * LAT_SAPT, 2), background: culoare + '44', border: `1px solid ${culoare}`, borderRadius: 2,
            boxSizing: 'border-box', overflow: 'hidden', textDecoration: inactiv ? 'line-through' : 'none' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: culoare }} />
        </div>
      ) : null}
    </div>
  )
}
