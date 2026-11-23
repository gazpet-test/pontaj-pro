// ═══════════════════════════════════════════════════════════════════════════
// IzoBandaTronson.jsx — banda conductei pe un tronson (Izometrie → „📏 Bandă tronson”), DOAR CITIRE
// Pasul 2 din docs/izometrie/CONDUCTA_TRONSOANE_SPEC.md. Citește pachetele de lansare existente
// (executie_pachete_lansare + executie_tevi, aceleași drepturi pe proiect ca editorul) și le desenează pe km
// prin src/conductaTronsonLogica.js. Nu scrie nimic. Schema Excel confirmată NU e încă în platformă (pasul 4),
// deci ecranul spune clar: sursa = pachetele din platformă, cu revizia și starea lor; „necunoscut” ≠ „neexecutat”.
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './lib/supabase.js'
import { paginareKeyset } from './hrDeciziiUtil.js'
import { calculeazaSursa, foiDinPlatforma, fmtKmMm, fmtM, ETICHETE_STARE_BANDA, CONVENTIE_PLATFORMA, CONVENTIE_PLATFORMA_COMPARATIE } from './conductaTronsonLogica.js'

const G = {
  bg:'#0D1117', card:'#161B22', surface:'#161B22', text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681', border:'#30363D', border2:'#21262D',
  green:'#2EA043', orange:'#F0883E', red:'#F85149', yellow:'#D29922', blue:'#58A6FF', purple:'#A371F7', gray:'#484F58',
}
const S = {
  card: { background:G.card, borderRadius:12, border:`1px solid ${G.border}`, padding:'14px 16px' },
  input: { background:G.bg, border:`1px solid ${G.border}`, borderRadius:8, padding:'8px 10px', color:G.text, fontSize:13, outline:'none', fontFamily:'inherit' },
  th: { padding:'8px 10px', textAlign:'left', fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'.4px', color:G.muted, position:'sticky', top:0, background:G.card },
  td: { padding:'6px 10px', fontSize:12, color:G.text, borderTop:`1px solid ${G.border2}` },
  badge: { display:'inline-block', padding:'2px 8px', borderRadius:6, fontSize:11, fontWeight:600 },
}
const CULOARE = { realizat: G.green, restant: G.orange, necunoscut: G.gray }
const CULOARE_SUDURA = { sudata: G.green, restanta: G.orange, necunoscuta: G.muted }
const ETICHETA_SUDURA = { sudata: 'cu cod', restanta: 'de făcut (șanț)', necunoscuta: 'fără cod' }
// convenția km a pachetelor: B e rezultatul (aceeași formulă ca editorul de pachete); A apare DOAR ca o comparație cerută explicit
const ETICHETA_CONVENTIE = {
  [CONVENTIE_PLATFORMA]: 'B · km start pachet = prima sudură (primul rând al pachetului), ca în editorul de pachete',
  [CONVENTIE_PLATFORMA_COMPARATIE]: 'A · km start pachet = începutul primei țevi',
}
const FERESTRE_M = 500
const BUCATA_IDS = 200 // câte id-uri de pachet într-un .in() la citirea țevilor
const fmtData = s => {
  if (!s) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString('ro-RO', { timeZone: 'Europe/Bucharest', dateStyle: 'short', timeStyle: 'short' })
}
const calcul = (date, tronson, conventie) => (!date || !tronson || date.tronsonId !== tronson.id) ? null
  : calculeazaSursa({ sursa: 'platforma', tronson, foi: foiDinPlatforma(date.pachete, date.tevi, { conventie }) })
const fmtDif = (b, a) => (b == null || a == null ? '—' : `${a - b > 0 ? '+' : ''}${fmtM(Math.round((a - b) * 1000) / 1000)}`)

export default function IzoBandaTronson({ proiectId, tronsoane, initialTronsonId }) {
  const [tronsonId, setTronsonId] = useState(initialTronsonId || tronsoane?.[0]?.id || null)
  const [comparaA, setComparaA] = useState(false) // comparația cu A: niciodată preselectată, se resetează la schimbarea tronsonului
  const [date, setDate] = useState(null)        // { tronsonId, pachete, tevi }
  const [eroare, setEroare] = useState(null)
  const [loading, setLoading] = useState(false)
  const [fereastra, setFereastra] = useState('tot')
  const [selectat, setSelectat] = useState(null) // indexul segmentului ales pe bandă
  const gen = useRef(0)

  useEffect(() => { if (!tronsonId && tronsoane?.length) setTronsonId(tronsoane[0].id) }, [tronsoane, tronsonId])

  // citirea: pachetele tronsonului + rândurile lor, AMBELE paginate keyset pe id până la pagina goală (L23): un plafon al API-ului
  // (1000 sau mai mic) nu mai trunchiază tacit nici lista pachetelor; o pagină eșuată = eroare, fără bandă din date parțiale.
  useEffect(() => {
    if (!proiectId || !tronsonId) return
    const g = ++gen.current
    setLoading(true); setEroare(null); setDate(null); setSelectat(null); setFereastra('tot'); setComparaA(false)
    // ecran închis / alt tronson ales: bucla se oprește înaintea paginii următoare (rezultatul oricum s-ar arunca)
    const viu = () => { if (g !== gen.current) throw new Error('citire anulată') }
    ;(async () => {
      try {
        const pachete = await paginareKeyset((ultim, pas) => {
          viu()
          let q = supabase.from('executie_pachete_lansare').select('*')
            .eq('proiect_id', proiectId).eq('tronson_id', tronsonId).order('id').limit(pas)
          if (ultim != null) q = q.gt('id', ultim)
          return q
        })
        const ids = pachete.map(p => p.id)
        if (new Set(ids).size !== ids.length) throw new Error('lista pachetelor are id-uri repetate')
        // id-urile pachetelor merg în bucăți (URL-ul cererii rămâne scurt și la sute de pachete); fiecare bucată, paginată
        const tevi = []
        for (let i = 0; i < ids.length; i += BUCATA_IDS) {
          const bucata = ids.slice(i, i + BUCATA_IDS)
          const parte = await paginareKeyset((ultim, pas) => {
            viu()
            let q = supabase.from('executie_tevi')
              .select('id, pachet_id, poz_in_pachet, tip_rand, serie_unica, tip, dimensiune, sarja, lungime_m, sudura_cod, sudura_refacuta, sudura_sant_pending, pm_cod, pa_ut_cod')
              .in('pachet_id', bucata).order('id').limit(pas)
            if (ultim != null) q = q.gt('id', ultim)
            return q
          })
          for (const t of parte) tevi.push(t)
        }
        if (g !== gen.current) return
        setDate({ tronsonId, pachete, tevi })
      } catch (e) {
        if (g !== gen.current) return
        setEroare(e?.message || String(e))
      } finally {
        if (g === gen.current) setLoading(false)
      }
    })()
    return () => { gen.current++ }
  }, [proiectId, tronsonId])

  const tronson = useMemo(() => (tronsoane || []).find(t => t.id === tronsonId) || null, [tronsoane, tronsonId])
  const rez = useMemo(() => calcul(date, tronson, CONVENTIE_PLATFORMA), [date, tronson])
  const rezA = useMemo(() => (comparaA ? calcul(date, tronson, CONVENTIE_PLATFORMA_COMPARATIE) : null), [date, tronson, comparaA])

  if (!tronsoane?.length) return <div style={S.card}>Proiectul nu are tronsoane.</div>

  const lim = rez?.banda?.length ? { a: rez.banda[0].de_la_mm, b: rez.banda[rez.banda.length - 1].pana_la_mm } : null
  const cuLimite = rez?.dupa?.lungime_tronson_m != null
  const ferestre = lim ? Array.from({ length: Math.ceil((lim.b - lim.a) / (FERESTRE_M * 1000)) }, (_, i) => lim.a + i * FERESTRE_M * 1000) : []
  const vedere = lim && fereastra !== 'tot' ? { a: Number(fereastra), b: Math.min(Number(fereastra) + FERESTRE_M * 1000, lim.b) } : lim
  const seg = selectat != null ? rez?.banda?.[selectat] : null
  const pieseVizibile = !rez ? [] : rez.piese.filter(p => {
    if (seg) return seg.piese.includes(p.id) || (seg.stare !== 'realizat' && p.a_mm == null)
    if (!vedere || fereastra === 'tot') return true
    return p.a_mm == null || (p.b_mm > vedere.a && p.a_mm < vedere.b)
  }).sort((x, y) => (x.a_mm ?? Infinity) - (y.a_mm ?? Infinity) || String(x.id).localeCompare(String(y.id), 'en', { numeric: true }))

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
      <div style={{ ...S.card, display:'flex', flexWrap:'wrap', gap:12, alignItems:'center' }}>
        <div style={{ fontSize:18, fontWeight:700 }}>📏 Bandă tronson <span style={{ fontSize:12, color:G.muted, fontWeight:500 }}>· doar citire</span></div>
        <select value={tronsonId || ''} onChange={e => setTronsonId(Number(e.target.value))} style={S.input} aria-label="Tronson">
          {tronsoane.map(t => <option key={t.id} value={t.id}>{t.cod}</option>)}
        </select>
        <span data-test="conventie" style={{ fontSize:12, color:G.text }}><b>Convenția km:</b> {ETICHETA_CONVENTIE[CONVENTIE_PLATFORMA]}</span>
        <span style={{ ...S.badge, background:G.yellow + '22', color:G.yellow }}>neconfirmată pe fiecare pachet</span>
        <label style={{ fontSize:12, color:G.muted, cursor:'pointer', display:'flex', alignItems:'center', gap:6 }}>
          <input type="checkbox" data-test="compara-a" checked={comparaA} onChange={e => setComparaA(e.target.checked)} />
          compară cu convenția A (doar comparație)
        </label>
      </div>

      <div style={{ ...S.card, fontSize:12, color:G.muted, lineHeight:1.6 }}>
        <b style={{ color:G.text }}>Sursa:</b> pachetele de lansare din platformă (nu schema Excel confirmată, care nu e încă importată; data situației pe care o descriu pachetele: necunoscută).
        Verde = porțiune acoperită de țevile din pachete; <b style={{ color:G.text }}>gri = necunoscut, nu „neexecutat”</b>; portocaliu = restant confirmat (azi nu există raportări).
        Banda NU arată lansat / astupat / probat. Pozițiile sunt calculate din lungimi, pe axa pachetelor, nu măsurate.
      </div>

      {loading && <div style={S.card}>Se încarcă…</div>}
      {eroare && <div style={{ ...S.card, borderColor:G.red, color:G.red }}>Nu s-au putut citi pachetele: {eroare}</div>}

      {rez && (
        <>
          <div style={{ ...S.card, display:'flex', flexWrap:'wrap', gap:8 }}>
            {rez.foi.length === 0 && <span style={{ color:G.muted, fontSize:12 }}>Niciun pachet pe {tronson?.cod}.</span>}
            {rez.foi.map(f => (
              <span key={f.id} style={{ ...S.badge, background:G.border2, color:G.text, fontWeight:500 }}>
                {f.cod} · rev.{f.revizie ?? '—'} · {f.stare || '—'} · start {f.kmStart == null ? '—' : fmtKmMm(Math.round(f.kmStart * 1000))} · {f.randuri} rânduri
                {' '}· situație: {fmtData(f.dataSituatie) || 'necunoscută'} · import: {fmtData(f.dataImport) || 'necunoscut'} · modificat: {fmtData(f.modificatLa) || 'necunoscut'}
              </span>
            ))}
          </div>

          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(150px, 1fr))', gap:8 }}>
            <Kpi test="kpi-realizat" titlu="În pachete (pe axă)" val={fmtM(rez.dupa.realizat_m)} culoare={G.green}
              sub={cuLimite ? `din ${fmtM(rez.dupa.lungime_tronson_m)} ai tronsonului`
                : `lungimea tronsonului: necunoscută (fără km de capăt)${rez.dupa.intindere_banda_m != null ? ` · întinderea datelor: ${fmtM(rez.dupa.intindere_banda_m)}` : ''}`} />
            <Kpi test="kpi-necunoscut" titlu="Necunoscut" culoare={G.muted}
              val={rez.dupa.necunoscut_m == null ? 'necunoscut' : fmtM(rez.dupa.necunoscut_m)}
              sub={rez.dupa.necunoscut_m == null
                ? `pe tronson nu se poate calcula; goluri în întinderea datelor: ${fmtM(rez.dupa.necunoscut_in_intindere_m)}`
                : 'fără date (nu = neexecutat)'} />
            <Kpi titlu="Suprapuneri" val={fmtM(rez.dupa.suprapuneri_m)} sub="piese peste piese" culoare={rez.dupa.suprapuneri_m > 0 ? G.red : G.muted} />
            <Kpi titlu="Țevi / curbe" val={`${rez.dupa.tevi} / ${rez.dupa.curbe}`} sub={`${fmtM(rez.dupa.lungime_m)} material`} />
            <Kpi titlu="Suduri cu cod" val={rez.dupa.suduri_cu_cod} sub={`${rez.dupa.suduri_refacute} refăcute`} />
            <Kpi titlu="De făcut în șanț" val={rez.dupa.suduri_restante} sub={`${rez.dupa.capete_fara_cod} capete fără cod`} culoare={G.orange} />
            <Kpi titlu="Probleme de date" val={rez.blocante} sub={`${rez.anomalii.length - rez.blocante} avertismente`} culoare={rez.blocante ? G.red : G.muted} />
          </div>

          {rezA && (
            <div data-test="comparatie-a" style={{ ...S.card, borderColor:G.yellow + '66' }}>
              <div style={{ fontSize:12, fontWeight:700, color:G.yellow, marginBottom:6 }}>
                Comparație, nu rezultat: aceleași pachete calculate cu convenția A ({ETICHETA_CONVENTIE[CONVENTIE_PLATFORMA_COMPARATIE]}). Banda și tabelul de mai jos rămân pe B.
              </div>
              <table style={{ borderCollapse:'collapse', fontSize:12 }}>
                <thead><tr>{['Indicator', 'B (folosit)', 'A (comparație)', 'A − B'].map(h => <th key={h} style={{ ...S.th, position:'static' }}>{h}</th>)}</tr></thead>
                <tbody>
                  {[['În pachete (reuniune)', 'realizat_m'], ['Necunoscut pe tronson', 'necunoscut_m'], ['Suprapuneri', 'suprapuneri_m'], ['În afara limitelor', 'in_afara_limitelor_m']].map(([t, k]) => (
                    <tr key={k}>
                      <td style={S.td}>{t}</td>
                      <td style={{ ...S.td, textAlign:'right' }}>{rez.dupa[k] == null ? 'necunoscut' : fmtM(rez.dupa[k])}</td>
                      <td style={{ ...S.td, textAlign:'right' }}>{rezA.dupa[k] == null ? 'necunoscut' : fmtM(rezA.dupa[k])}</td>
                      <td style={{ ...S.td, textAlign:'right' }}>{fmtDif(rez.dupa[k], rezA.dupa[k])}</td>
                    </tr>
                  ))}
                  <tr><td style={S.td}>Piese fără poziție</td><td style={{ ...S.td, textAlign:'right' }}>{rez.dupa.piese_fara_pozitie}</td><td style={{ ...S.td, textAlign:'right' }}>{rezA.dupa.piese_fara_pozitie}</td><td style={{ ...S.td, textAlign:'right' }}>{rezA.dupa.piese_fara_pozitie - rez.dupa.piese_fara_pozitie}</td></tr>
                </tbody>
              </table>
            </div>
          )}

          {vedere && (
            <div style={S.card}>
              <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:10 }}>
                <BtnF activ={fereastra === 'tot'} onClick={() => { setFereastra('tot'); setSelectat(null) }}>{cuLimite ? 'Tot tronsonul' : 'Toată întinderea datelor'}</BtnF>
                {ferestre.map(a => <BtnF key={a} activ={fereastra === String(a)} onClick={() => { setFereastra(String(a)); setSelectat(null) }}>{fmtKmMm(a).slice(0, -3)}</BtnF>)}
              </div>
              <Banda rez={rez} vedere={vedere} selectat={selectat} onSelect={setSelectat} />
              <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, color:G.muted, marginTop:4, fontFamily:'monospace' }}>
                <span>{fmtKmMm(vedere.a)}</span><span>{fmtKmMm(vedere.b)}</span>
              </div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:14, fontSize:11, color:G.muted, marginTop:8 }}>
                {Object.entries(CULOARE).map(([k, c]) => <span key={k}><Patrat c={c} /> {ETICHETE_STARE_BANDA[k]}</span>)}
                <span><Patrat c={G.red} /> suprapunere</span>
                <span>Atinge un segment pentru detaliu.</span>
              </div>
              {seg && (
                <div style={{ marginTop:10, fontSize:12 }}>
                  <b>{ETICHETE_STARE_BANDA[seg.stare]}</b> · km {fmtKmMm(seg.de_la_mm)} → {fmtKmMm(seg.pana_la_mm)} ({fmtM(seg.lungime_m)})
                  {seg.motiv === 'fara_date' && <span style={{ color:G.muted }}> · nicio piesă din pachete nu acoperă porțiunea</span>}
                  {seg.suprapunere && <span style={{ color:G.red }}> · {seg.piese.length} piese suprapuse</span>}
                  {' '}<button onClick={() => setSelectat(null)} style={{ ...S.input, padding:'2px 8px', cursor:'pointer' }}>× închide</button>
                </div>
              )}
            </div>
          )}

          {rez.anomalii.length > 0 && (
            <details style={S.card}>
              <summary style={{ cursor:'pointer', fontSize:13, fontWeight:700 }}>Probleme de date ({rez.anomalii.length})</summary>
              <div style={{ maxHeight:240, overflow:'auto', marginTop:8 }}>
                {rez.anomalii.map((a, i) => (
                  <div key={i} style={{ fontSize:12, padding:'3px 0', color: a.nivel === 'blocant' ? G.text : G.muted }}>
                    <span style={{ ...S.badge, background:(a.nivel === 'blocant' ? G.red : G.yellow) + '22', color: a.nivel === 'blocant' ? G.red : G.yellow, marginRight:6 }}>{a.nivel}</span>{a.mesaj}
                  </div>
                ))}
                {rez.ignorate.length > 0 && <div style={{ fontSize:12, color:G.muted, marginTop:6 }}>Rânduri fără piesă (separatori / rânduri goale): {rez.ignorate.length}</div>}
              </div>
            </details>
          )}

          <div style={{ ...S.card, padding:0, overflow:'auto', maxHeight:520 }}>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead><tr>
                {['Km de la', 'Km până la', 'Tip', 'Serie', 'Lungime', 'Sudură (capăt)', 'Stare sudură', 'Sursa (pachet#poz)', 'Probleme'].map(h => <th key={h} style={S.th}>{h}</th>)}
              </tr></thead>
              <tbody>
                {pieseVizibile.map(p => (
                  <tr key={p.id}>
                    <td style={{ ...S.td, fontFamily:'monospace' }}>{fmtKmMm(p.a_mm)}</td>
                    <td style={{ ...S.td, fontFamily:'monospace' }}>{fmtKmMm(p.b_mm)}</td>
                    <td style={S.td}>{p.fel === 'curba' ? 'curbă' : 'țeavă'}</td>
                    <td style={{ ...S.td, fontFamily:'monospace' }}>{p.serie || '—'}</td>
                    <td style={{ ...S.td, textAlign:'right' }}>{p.lungime_mm == null ? '—' : fmtM(p.lungime_mm / 1000)}</td>
                    <td style={{ ...S.td, fontFamily:'monospace' }}>{p.sudura.original || '—'}{p.sudura.refacuta ? ' (refăcută)' : ''}</td>
                    <td style={{ ...S.td, color:CULOARE_SUDURA[p.sudura.stare] }}>{ETICHETA_SUDURA[p.sudura.stare]}</td>
                    <td style={{ ...S.td, color:G.muted }}>{p.provenienta.map(x => `${x.cod}#${x.poz ?? x.rand}`).join(' + ')}</td>
                    <td style={{ ...S.td, color:G.yellow }}>{p.anomalii.join(', ').replace(/_/g, ' ')}</td>
                  </tr>
                ))}
                {!pieseVizibile.length && <tr><td colSpan={9} style={{ ...S.td, color:G.muted, textAlign:'center' }}>Nicio piesă în această porțiune.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

function Kpi({ titlu, val, sub, culoare = G.text, test }) {
  return (
    <div data-test={test} style={{ ...S.card, padding:'10px 12px' }}>
      <div style={{ fontSize:11, color:G.muted, textTransform:'uppercase', letterSpacing:'.4px' }}>{titlu}</div>
      <div style={{ fontSize:18, fontWeight:700, color:culoare, marginTop:2 }}>{val}</div>
      <div style={{ fontSize:11, color:G.dim }}>{sub}</div>
    </div>
  )
}
const Patrat = ({ c }) => <span style={{ display:'inline-block', width:10, height:10, borderRadius:2, background:c, verticalAlign:'middle' }} />
function BtnF({ activ, onClick, children }) {
  return <button onClick={onClick} style={{ padding:'5px 10px', fontSize:12, borderRadius:6, cursor:'pointer', fontFamily:'monospace',
    background: activ ? G.purple + '22' : 'transparent', color: activ ? G.purple : G.muted, border:`1px solid ${activ ? G.purple + '66' : G.border}` }}>{children}</button>
}

// banda: segmentele în fereastra curentă + sudurile ca linii subțiri (cu cod / de făcut / fără cod)
function Banda({ rez, vedere, selectat, onSelect }) {
  const W = 1000, H = 54, Y = 14, HB = 26
  const L = vedere.b - vedere.a
  const x = mm => ((Math.min(Math.max(mm, vedere.a), vedere.b) - vedere.a) / L) * W
  const suduri = rez.suduri.filter(s => s.km_mm != null && s.km_mm >= vedere.a && s.km_mm <= vedere.b)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width:'100%', height:H, display:'block' }} role="img" aria-label="Banda tronsonului">
      {rez.banda.map((s, i) => {
        if (s.pana_la_mm <= vedere.a || s.de_la_mm >= vedere.b) return null
        const x0 = x(s.de_la_mm), w = Math.max(x(s.pana_la_mm) - x0, 0.5)
        return (
          <g key={i} onClick={() => onSelect(selectat === i ? null : i)} style={{ cursor:'pointer' }}>
            <rect x={x0} y={Y} width={w} height={HB} fill={CULOARE[s.stare]} opacity={selectat == null || selectat === i ? 1 : 0.45} />
            {s.suprapunere && <rect x={x0} y={Y - 6} width={w} height={5} fill={G.red} />}
            {selectat === i && <rect x={x0} y={Y} width={w} height={HB} fill="none" stroke="#fff" strokeWidth={1.5} />}
          </g>
        )
      })}
      {suduri.map((s, i) => (
        <line key={i} x1={x(s.km_mm)} x2={x(s.km_mm)} y1={Y + HB} y2={Y + HB + 8} stroke={CULOARE_SUDURA[s.stare]} strokeWidth={s.stare === 'sudata' ? 0.6 : 1.4} pointerEvents="none" />
      ))}
    </svg>
  )
}
