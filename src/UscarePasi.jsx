// ═══════════════════════════════════════════════════════════════════════════
// UscarePasi.jsx — ecranul de TELEFON al uscării, pe pași: tronsonul → etapa 1 (introducerea pistoanelor) → etapa 2 (ieșirea) → rezumat +
// „Generează raportul”. Doar afișarea: formularul, salvarea (CAS + cheia apăsării + ciorna locală), pozele și PDF-ul sunt cele din
// UscareConducta.jsx (primite prin `p`), deci regulile de conflict, de idempotență și de context (L05, L24) sunt aceleași.
// Pasul se DEDUCE din datele salvate (uscarePasi.js → pasCurent); omul se poate opri oricând între etape și relua din listă.
// ═══════════════════════════════════════════════════════════════════════════

import { useState } from 'react'
import { G } from './NodCuplareVizualizare.jsx'
import { payloadDinFormular, ETICHETE_OBLIGATORII, MAX_BURETI, fmtKm, parseKm, fmtNr, fmtOraMinut, fmtMoment, etichetaPozaLipsa } from './uscareLogica.js'
import { textNr, parseNumar } from './izoDocumenteLogica.js'
import {
  PASI, ETICHETE_PAS, PRAG_G_PE_KM, lipsaEtapa1, lipsaEtapa2, verdictPropus, contrazice, diferentaGrame, grame, avertismenteGreutate,
  avertismentePereche, cuOraImplicita, momentAcum,
} from './uscarePasi.js'

const fmtG = g => (g == null ? '—' : `${g > 0 ? '+' : g < 0 ? '−' : ''}${fmtNr(Math.abs(g), 0)} g`)
// decizia E (runda 2): o diferență negativă se spune explicit („mai ușor cu X g”), iar una peste 1% cere verificarea cântăririi
const fmtDif = g => (g != null && g < 0 ? `mai ușor cu ${fmtNr(-g, 0)} g` : fmtG(g))
const ETICHETA_VERDICT = { trece: '✓ în prag: propun USCAT', nu_trece: '✗ peste prag: propun UMED', de_verificat: '⚠ verifică cântărirea (nu propun nimic)', necalculabil: '— nu se poate calcula' }

/** cardul unui raport ÎN LUCRU din listă: reluarea la o singură atingere, cu pasul la care a rămas; `autor` = cine a salvat ultima dată */
export function CardInLucru({ u, pas, eroarePoze, onDeschide, ST, autor = null }) {
  const t = pas === 'etapa2' ? { rand: `Etapa 1 înregistrată · pistoanele introduse la ${fmtOraMinut(u.ora_inceput)}`, actiune: 'Continuă cu etapa 2 →' }
    : pas === 'rezumat' ? { rand: 'Etapa 2 terminată · rămân detaliile și raportul', actiune: 'Generează raportul →' }
      : pas === 'etapa1' ? { rand: 'Etapa 1 în lucru (introducerea pistoanelor)', actiune: 'Continuă cu etapa 1 →' }
        : { rand: eroarePoze ? `Pasul nu s-a putut determina (pozele nu s-au citit: ${eroarePoze})` : 'În lucru', actiune: 'Deschide →' }
  return (
    <button onClick={onDeschide} style={{ ...ST.card, display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer', color: G.text, fontFamily: 'inherit', borderColor: G.blue, minHeight: 88 }}>
      <div style={{ fontSize: 17, fontWeight: 800 }}>Tronson {u.tronson}</div>
      <div style={{ fontSize: 13, color: G.muted, marginTop: 2 }}>km {fmtKm(u.km_de_la_m)} → {fmtKm(u.km_pana_la_m)}</div>
      <div style={{ fontSize: 15, marginTop: 6 }}>{t.rand}</div>
      {autor && <div style={{ fontSize: 13, color: G.muted, marginTop: 2 }}>Salvat ultima dată {fmtMoment(u.modificat_la)} {autor}</div>}
      <div style={{ fontSize: 16, fontWeight: 800, color: G.blue, marginTop: 6 }}>{t.actiune}</div>
    </button>
  )
}

function BaraPasi({ pas }) {
  const i = pas === 'inchis' || pas === 'anulat' ? PASI.length : PASI.indexOf(pas)
  return (
    <div style={{ display: 'flex', gap: 4, margin: '6px 0 4px' }} aria-label="Progres">
      {PASI.map((k, j) => (
        <div key={k} style={{ flex: 1 }}>
          <div style={{ height: 6, borderRadius: 3, background: j < i ? G.green : j === i ? G.blue : G.border }} />
          <div style={{ fontSize: 11, color: j === i ? G.text : G.muted, marginTop: 3, textAlign: 'center' }}>{['Tronson', 'Etapa 1', 'Etapa 2', 'Raport'][j]}</div>
        </div>
      ))}
    </div>
  )
}
// butonul mare, fix jos (degetul mare pe telefon); motivul pentru care e inactiv se scrie deasupra lui, în pagină.
// Runda 2 (proba pe telefon): bara stă DEASUPRA butoanelor plutitoare ale platformei (🐛, „Tichet”, asistentul) — `jos.rezerva` px de jos,
// aceeași constantă ca bara de salvare a formularului complet (UscareConducta.jsx) — complet vizibilă și apăsabilă pe toată lățimea.
function BaraJos({ jos, children }) {
  return (
    <div style={{ position: 'fixed', left: 0, right: 0, bottom: jos.rezerva, padding: 10, background: G.bg, borderTop: `1px solid ${G.border}`, borderBottom: `1px solid ${G.border}`, boxShadow: '0 -4px 16px rgba(0,0,0,.35)', zIndex: 20 }}>
      <div style={{ maxWidth: 720, margin: '0 auto', display: 'grid', gap: 6 }}>{children}</div>
    </div>
  )
}
function Lipsuri({ titlu, lista }) {
  if (!lista.length) return null
  return (
    <div role="status" style={{ border: `1px solid ${G.yellow}`, borderRadius: 12, padding: 12, margin: '12px 0', fontSize: 14 }}>
      <b>{titlu}</b>
      <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>{lista.map(t => <li key={t}>{t}</li>)}</ul>
    </div>
  )
}
const Avert = ({ lista }) => (lista.length ? <div role="alert" style={{ color: G.yellow, fontSize: 13, marginTop: 4 }}>{lista.map(t => <div key={t}>⚠ {t}</div>)}</div> : null)

export default function UscarePasi({ p }) {
  const { ST, form, rand, pas, editabil, inCurs, panouri, jos } = p
  const titlu = pas ? ETICHETE_PAS[pas] : 'Se citesc datele raportului…'
  // jos: loc pentru zona plutitoarelor + bara fixă (când există una: raport editabil sau închis, cu PDF-ul), ca ultimul câmp să nu rămână sub ea
  const areBara = editabil || pas === 'inchis'
  const incarcariDeschise = p.deschise.length > 0 && (
    <div role="alert" style={{ ...ST.card, borderColor: G.yellow, fontSize: 14 }}>
      {p.deschise.length} {p.deschise.length === 1 ? 'fotografie a rămas neterminată' : 'fotografii au rămas neterminate'} (urcare întreruptă).
      Le rezolvi în „Vezi / corectează toate datele” (înregistrează sau renunță), înainte de raport.
    </div>
  )
  let corp = null
  if (pas === 'tronson') corp = <EcranTronson p={p} />
  else if (pas === 'etapa1') corp = <EcranEtapa1 p={p} />
  else if (pas === 'etapa2') corp = p.ecranPas === 'confirmare1' ? <Confirmare1 p={p} /> : <EcranEtapa2 p={p} />
  else if (pas) corp = <EcranRezumat p={p} />
  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: `8px 12px ${jos.rezerva + (areBara ? jos.bara : 16)}px` }}>
      <div style={{ ...ST.rand, justifyContent: 'space-between', margin: '8px 0', flexWrap: 'wrap' }}>
        <button style={ST.btn} onClick={p.laLista}>← Lista</button>
        {rand && <button style={{ ...ST.btn, background: 'transparent' }} onClick={p.laComplet}>Vezi / corectează toate datele</button>}
      </div>
      <h2 style={{ fontSize: 18, margin: '6px 0 2px', color: G.text }}>{titlu}</h2>
      {form.tronson && pas !== 'tronson' && <div style={{ fontSize: 13, color: G.muted }}>Tronson {rand?.tronson || form.tronson} · km {fmtKm(rand?.km_de_la_m)} → {fmtKm(rand?.km_pana_la_m)}</div>}
      <BaraPasi pas={pas} />
      {panouri}
      {incarcariDeschise}
      {/* cât o cerere e în zbor, câmpurile sunt blocate (ca pe formularul complet) */}
      <fieldset disabled={inCurs || !editabil && pas !== 'inchis'} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
        {corp || <p style={{ color: G.muted }}>Se citesc pozele raportului…</p>}
      </fieldset>
    </div>
  )
}

// ── pasul 0: tronsonul ──
function EcranTronson({ p }) {
  const { ST, Camp, form, schimba, probe, inp, nrInp, editabil, inCurs } = p
  const [alt, setAlt] = useState(!form.proba_id)
  const { erori } = payloadDinFormular(form)
  const alegeProba = x => { setAlt(false); schimba({ proba_id: String(x.id), tronson: [x.cod, x.denumire].filter(Boolean).join(' — '), km_de_la: fmtKm(x.km_de_la_m), km_pana_la: fmtKm(x.km_pana_la_m), lungime_m: textNr(x.km_pana_la_m - x.km_de_la_m) }) }
  // „alt interval”: lungimea se propune din km (se poate corecta)
  const km = (k, v) => {
    const f = { ...form, [k]: v }, a = parseKm(f.km_de_la), b = parseKm(f.km_pana_la)
    schimba({ [k]: v, ...(Number.isFinite(a) && Number.isFinite(b) && b > a ? { lungime_m: textNr(b - a) } : {}) })
  }
  return <>
    <div style={ST.card}>
      <div style={ST.h}>Pe ce tronson faci uscarea?</div>
      {p.probeEroare && <div role="alert" style={{ color: G.red, fontSize: 13 }}>{p.probeEroare}</div>}
      <div style={{ display: 'grid', gap: 8 }}>
        {probe.map(x => {
          const ales = form.proba_id === String(x.id)
          return <button key={x.id} style={{ ...ST.mare, textAlign: 'left', borderColor: ales ? G.green : G.border, background: ales ? G.green + '33' : 'transparent' }} onClick={() => alegeProba(x)}>
            {ales ? '☒' : '☐'} {x.cod}{x.denumire ? ` — ${x.denumire}` : ''} · km {fmtKm(x.km_de_la_m)} → {fmtKm(x.km_pana_la_m)}
          </button>
        })}
        <button style={{ ...ST.mare, background: alt ? G.blue + '33' : 'transparent', borderColor: alt ? G.blue : G.border }} onClick={() => { setAlt(true); if (form.proba_id) schimba({ proba_id: '' }) }}>Alt interval / tot traseul</button>
      </div>
      {(alt || !probe.length) && <>
        <Camp eticheta="Tronson (cum apare în raport)">{inp('tronson')}</Camp>
        <div style={ST.rand}>
          <Camp eticheta="De la km">{inp('km_de_la', { placeholder: '3+200', onChange: e => km('km_de_la', e.target.value) })}</Camp>
          <Camp eticheta="La km">{inp('km_pana_la', { placeholder: '3+900', onChange: e => km('km_pana_la', e.target.value) })}</Camp>
        </div>
      </>}
      <Camp eticheta="Lungime (m)" nota="Se completează din km; corecteaz-o dacă lungimea reală e alta (pragul se calculează din ea).">{nrInp('lungime_m')}</Camp>
      <div style={ST.nota}>Constructorul, utilajele și semnatarii se iau din ultimul raport al proiectului; îi verifici la final, înainte de raport.</div>
    </div>
    {form.tronson ? erori.length > 0 && <Lipsuri titlu="De corectat:" lista={erori} /> : <div style={ST.nota}>Alege tronsonul de probă sau „Alt interval / tot traseul”.</div>}
    {editabil && <BaraJos jos={p.jos}>
      <button style={{ ...ST.mare, minHeight: 60, background: '#238636', color: '#fff' }} disabled={inCurs || erori.length > 0 || p.nelamuriteTinta.length > 0} onClick={p.incepeUscarea}>
        {inCurs ? 'Se trimite…' : 'Începe · etapa 1 →'}
      </button>
    </BaraJos>}
  </>
}

// câmpul unei ore „implicit ACUM”: gol = ora apăsării butonului etapei; „Acum” o fixează pe loc
function OraAcum({ p, k, eticheta, buton }) {
  const { Camp, form, oraInp, schimba, editabil, ST } = p
  return <>
    <Camp eticheta={eticheta}>{oraInp(k)}</Camp>
    <div style={{ ...ST.rand, marginTop: 6, flexWrap: 'wrap' }}>
      {editabil && <button style={ST.btn} onClick={() => schimba(momentAcum(form, k, p.acum()))}>⟳ Acum</button>}
      <span style={{ ...ST.nota, flex: 1 }}>{String(form[k] ?? '').trim() ? 'Ora scrisă pe ecran (o poți schimba).' : `Gol = ora la care apeși „${buton}” (acum ar fi ${fmtOraMinut(new Date(p.acum()).toISOString())}).`}</span>
    </div>
  </>
}
function Bureti({ p }) {
  const { ST, form, setBureti, editabil } = p
  const n = form.cantariri.length
  const pune = k => setBureti(String(Math.max(1, Math.min(MAX_BURETI, k))))
  return (
    <div style={{ ...ST.rand, alignItems: 'center', marginTop: 8 }}>
      <span style={{ flex: 1, fontSize: 15 }}>Câte pistoane-burete?</span>
      <button style={{ ...ST.btn, width: 56, fontSize: 22 }} aria-label="Un piston mai puțin" disabled={!editabil || n <= 1} onClick={() => pune(n - 1)}>−</button>
      <b style={{ fontSize: 22, minWidth: 36, textAlign: 'center' }} aria-label="Numărul de pistoane">{n}</b>
      <button style={{ ...ST.btn, width: 56, fontSize: 22 }} aria-label="Un piston în plus" disabled={!editabil || n >= MAX_BURETI} onClick={() => pune(n + 1)}>+</button>
    </div>
  )
}
const numePiston = (c, n) => `Pistonul ${c.nr}${n > 1 && c.nr === n ? ' · ultimul (decide uscarea)' : n > 1 && c.nr === 1 ? ' · primul introdus' : ''}`
function GreutateInp({ p, i, k, eticheta }) {
  const { ST, Camp, form, cant, editabil } = p
  const v = form.cantariri[i][k]
  const x = parseNumar(v)
  const g = typeof x === 'number' && Number.isFinite(x) && x > 0 ? grame(x) : null
  return <>
    <Camp eticheta={eticheta} nota={g != null ? `= ${fmtNr(g, 0)} g` : 'în kg, ex. 1,25'}>
      <input style={{ ...ST.in, fontSize: 20 }} inputMode="decimal" enterKeyHint="done" placeholder="0,00" disabled={!editabil} value={v} onChange={e => cant(i, { [k]: e.target.value })} />
    </Camp>
    <Avert lista={avertismenteGreutate(v)} />
  </>
}

// ── etapa 1: introducerea pistoanelor ──
function EcranEtapa1({ p }) {
  const { ST, form, rand, poze, blocPoze, editabil, inCurs, modificat } = p
  const f1 = cuOraImplicita(form, 'ora_inceput', p.acum())
  const { date, erori } = payloadDinFormular(f1)
  const lipsa = [...lipsaEtapa1({ ...rand, ...date }, poze), ...erori]
  const n = form.cantariri.length
  return <>
    <div style={ST.card}><OraAcum p={p} k="ora_inceput" eticheta="Ora introducerii pistoanelor" buton="Înregistrează etapa 1" /><Bureti p={p} /></div>
    {form.cantariri.map((c, i) => (
      <div key={c.nr} style={ST.card}>
        <div style={ST.h}>{numePiston(c, n)}</div>
        {String(c.motiv ?? '').trim() ? <div style={ST.nota}>Marcat „nu se aplică”: {c.motiv} (se schimbă din „Vezi / corectează toate datele”).</div> : <>
          <GreutateInp p={p} i={i} k="intrare_kg" eticheta="Greutatea pe cântar, la intrare [kg]" />
          {blocPoze('cantar_intrare', c.nr, 'Poza cântarului, cu kilogramele vizibile')}
        </>}
      </div>
    ))}
    <div style={ST.card}>
      <div style={ST.h}>Ansamblul de pistoane</div>
      {blocPoze('pistoane', null, 'Poza ansamblului de pistoane')}
    </div>
    <Lipsuri titlu="Ca să înregistrezi etapa 1, mai trebuie:" lista={lipsa} />
    {editabil && <BaraJos jos={p.jos}>
      <button style={{ ...ST.mare, minHeight: 60, background: lipsa.length ? G.surface2 : '#238636', color: '#fff' }} disabled={inCurs || lipsa.length > 0 || !!p.conflict || p.nelamuriteTinta.length > 0} onClick={p.inregistreazaEtapa1}>
        {inCurs ? 'Se trimite…' : '✓ Înregistrează etapa 1'}
      </button>
      {modificat && <button style={ST.btn} disabled={inCurs || !!p.conflict || p.nelamuriteTinta.length > 0} onClick={p.salveaza}>💾 Salvează pe parcurs (fără să închei etapa)</button>}
    </BaraJos>}
  </>
}

function Confirmare1({ p }) {
  const { ST, rand } = p
  return (
    <div style={{ ...ST.card, borderColor: G.green, textAlign: 'center', padding: 22 }} role="status">
      <div style={{ fontSize: 40 }}>✓</div>
      <div style={{ fontSize: 19, fontWeight: 800 }}>Etapa 1 înregistrată la {fmtOraMinut(rand.modificat_la)}</div>
      <div style={{ fontSize: 15, marginTop: 6 }}>Pistoanele introduse la {fmtOraMinut(rand.ora_inceput)}.</div>
      <div style={{ fontSize: 15, marginTop: 10 }}>Poți închide telefonul; continui la ieșirea pistoanelor (din listă: „Continuă cu etapa 2”).</div>
      <div style={{ display: 'grid', gap: 8, marginTop: 16 }}>
        <button style={{ ...ST.mare, background: '#238636', color: '#fff' }} onClick={() => p.setEcranPas(null)}>Continuă acum cu etapa 2 →</button>
        <button style={ST.mare} onClick={p.laLista}>← Lista</button>
      </div>
    </div>
  )
}

// ── etapa 2: ieșirea pistoanelor ──
function EcranEtapa2({ p }) {
  const { ST, Camp, form, rand, poze, blocPoze, editabil, inCurs, modificat, schimba, nrInp } = p
  const f2 = cuOraImplicita(form, 'ora_final', p.acum())
  const { date, erori } = payloadDinFormular(f2)
  const r2 = { ...rand, ...date }
  const v = verdictPropus(r2)
  const lipsa = [...lipsaEtapa2(r2, poze), ...erori]
  const n = form.cantariri.length
  const ales = form.piston_final_rezultat
  return <>
    <div style={ST.card}><OraAcum p={p} k="ora_final" eticheta="Ora ieșirii pistoanelor" buton="Termină etapa 2" /></div>
    {form.cantariri.map((c, i) => {
      if (String(c.motiv ?? '').trim()) return <div key={c.nr} style={ST.card}><div style={ST.h}>{numePiston(c, n)}</div><div style={ST.nota}>„Nu se aplică”: {c.motiv}</div></div>
      const d = diferentaGrame(date.cantariri[i])
      return (
        <div key={c.nr} style={ST.card}>
          <div style={ST.h}>{numePiston(c, n)}</div>
          <div style={{ fontSize: 14 }}>La intrare: <b>{fmtNr(date.cantariri[i]?.intrare_kg, 3) || '—'} kg</b></div>
          <GreutateInp p={p} i={i} k="iesire_kg" eticheta="Greutatea pe cântar, la ieșire [kg]" />
          <div style={{ fontSize: 16, marginTop: 6 }}>Diferența față de intrare: <b style={{ color: d == null ? G.muted : d > (v.prag_g ?? Infinity) ? G.red : G.green }}>{fmtDif(d)}</b></div>
          <Avert lista={avertismentePereche(date.cantariri[i], v.prag_g)} />
          {blocPoze('cantar_iesire', c.nr, 'Poza cântarului, cu kilogramele vizibile')}
        </div>
      )
    })}
    <div style={ST.card}>
      <div style={ST.h}>Presiunea în spatele buretelui (unde e posibil)</div>
      <Camp eticheta="Presiunea (bar)">{nrInp('presiune_bar')}</Camp>
      {blocPoze('manometru', null, 'Poza manometrului')}
      <div style={ST.nota}>Nu oprește etapa; raportul o cere la final (sau o completezi atunci).</div>
    </div>
    <div style={{ ...ST.card, borderColor: v.stare === 'trece' ? G.green : v.stare === 'nu_trece' ? G.red : G.yellow }}>
      <div style={ST.h}>Ultimul piston{v.nr ? ` (nr. ${v.nr})` : ''}: iese uscat?</div>
      <div style={{ fontSize: 14 }}>Pragul de lucru: {v.calcul || `${PRAG_G_PE_KM} g/km × lungimea tronsonului (lipsește lungimea)`}.</div>
      <div style={{ fontSize: 16, marginTop: 6 }}>Diferența ultimului piston: <b>{fmtDif(v.diferenta_g)}</b> → <b style={{ color: v.stare === 'de_verificat' ? G.yellow : undefined }}>{ETICHETA_VERDICT[v.stare]}</b></div>
      <div style={ST.nota}>{v.motiv}. Calculul doar propune; tu confirmi ce vezi.</div>
      <div style={{ ...ST.rand, marginTop: 10 }}>
        {[['uscat', 'USCAT', G.green], ['umed', 'UMED', G.red]].map(([k, t, cul]) => (
          <button key={k} disabled={!editabil} onClick={() => schimba({ piston_final_rezultat: ales === k ? '' : k })}
            style={{ ...ST.mare, background: ales === k ? cul + '44' : 'transparent', borderColor: ales === k ? cul : G.border }}>
            {ales === k ? '☒' : '☐'} {t}{v.propus === k ? ' (propus)' : ''}
          </button>
        ))}
      </div>
      {contrazice(ales, v) && <Camp eticheta={v.propus ? `Ai ales altceva decât calculul (${v.propus.toUpperCase()}): de ce? (se scrie în observații)` : 'Calculul nu propune nimic: de ce ai ales așa? (se scrie în observații)'}>
        <textarea style={{ ...ST.in, minHeight: 70 }} disabled={!editabil} value={form.observatii} maxLength={4000} onChange={e => schimba({ observatii: e.target.value })} />
      </Camp>}
      {blocPoze('piston_final', null, 'Poza ultimului piston')}
    </div>
    <Lipsuri titlu="Ca să termini etapa 2, mai trebuie:" lista={lipsa} />
    {editabil && <BaraJos jos={p.jos}>
      <button style={{ ...ST.mare, minHeight: 60, background: lipsa.length ? G.surface2 : '#238636', color: '#fff' }} disabled={inCurs || lipsa.length > 0 || !!p.conflict || p.nelamuriteTinta.length > 0} onClick={p.terminaEtapa2}>
        {inCurs ? 'Se trimite…' : '✓ Termină etapa 2'}
      </button>
      {modificat && <button style={ST.btn} disabled={inCurs || !!p.conflict || p.nelamuriteTinta.length > 0} onClick={p.salveaza}>💾 Salvează pe parcurs (fără să închei etapa)</button>}
    </BaraJos>}
  </>
}

// ── rezumat + detaliile cerute de beneficiar + „Generează raportul” ──
function EcranRezumat({ p }) {
  const { ST, Camp, form, rand, pas, editabil, inCurs, modificat, schimba, inp, nrInp, oraInp, blocPoze, lipsa, pozeL, v24 } = p
  const v = verdictPropus(rand)
  const deschis = pas === 'rezumat'
  const motive = []
  if (deschis) {
    if (modificat) motive.push('salvează întâi detaliile (butonul de deasupra)')
    if (p.conflict) motive.push('rezolvă conflictul de sus')
    if (p.nelamuriteTinta.length) motive.push('lămurește cererea nelămurită de sus')
    if (!p.pozeGata) motive.push('se citesc pozele raportului')
    for (const k of lipsa) motive.push(ETICHETE_OBLIGATORII[k] || k)
    if (!p.confirmat) motive.push('bifează că ai verificat detaliile de mai sus')
  }
  const rd = (e, val) => <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '5px 0', borderBottom: `1px solid ${G.border2}`, fontSize: 14 }}><span style={{ color: G.muted }}>{e}</span><b style={{ textAlign: 'right' }}>{val}</b></div>
  const cant = (rand.cantariri || []).slice().sort((a, b) => a.nr - b.nr)
  return <>
    <div style={ST.card}>
      <div style={ST.h}>Rezumat</div>
      {rd('Tronson', `${rand.tronson} · km ${fmtKm(rand.km_de_la_m)} → ${fmtKm(rand.km_pana_la_m)}`)}
      {rd('Lungime', rand.lungime_m == null ? '—' : `${fmtNr(rand.lungime_m, 1)} m`)}
      {rd('Introducere → ieșire', `${fmtMoment(rand.ora_inceput)} → ${fmtOraMinut(rand.ora_final)}`)}
      {rd('Durata', p.durata == null ? '—' : `${fmtNr(p.durata, 2)} ore`)}
      {rd('Viteza medie', p.viteza == null ? '— (lipsește timpul de deplasare)' : `${fmtNr(p.viteza, 2)} m/s`)}
      {rd('Vremea', rand.temperatura_c == null ? '— (completează mai jos)' : `${fmtNr(rand.temperatura_c, 1)} °C${rand.vreme ? `, ${rand.vreme}` : ''}`)}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 10, fontSize: 14 }}>
        <thead><tr style={{ color: G.muted, textAlign: 'right' }}><th style={{ textAlign: 'left' }}>Piston</th><th>Intrare</th><th>Ieșire</th><th>Diferența</th></tr></thead>
        <tbody>{cant.map(c => (
          <tr key={c.nr} style={{ textAlign: 'right', borderTop: `1px solid ${G.border2}` }}>
            <td style={{ textAlign: 'left', padding: '5px 0' }}>{c.nr}{c.nr === v.nr ? ' (ultimul)' : ''}</td>
            {typeof c.motiv === 'string' ? <td colSpan={3}>nu se aplică: {c.motiv}</td> : <>
              <td>{fmtNr(c.intrare_kg, 3)} kg</td><td>{fmtNr(c.iesire_kg, 3)} kg</td><td><b>{fmtG(diferentaGrame(c))}</b></td>
            </>}
          </tr>
        ))}</tbody>
      </table>
      <div style={{ fontSize: 14, marginTop: 10 }}>Pragul de lucru: {v.calcul || '—'} · calculul: {ETICHETA_VERDICT[v.stare]}</div>
      <div style={{ fontSize: 17, marginTop: 6 }}>Ultimul piston: <b style={{ color: rand.piston_final_rezultat === 'uscat' ? G.green : G.red }}>{rand.piston_final_rezultat === 'uscat' ? 'IESE USCAT' : 'NU IESE USCAT'}</b>
        {rand.concluzie && <> · concluzia <b style={{ color: rand.concluzie === 'conform' ? G.green : G.red }}>{rand.concluzie.toUpperCase()}</b></>}</div>
    </div>

    {rand.piston_final_rezultat === 'umed' && rand.stare !== 'anulata' && (
      <div style={{ ...ST.card, borderColor: G.yellow }}>
        <div style={ST.h}>Conducta nu e încă uscată</div>
        <div style={{ fontSize: 14 }}>Fiecare trecere are raportul ei (raportul ține o singură trecere: o oră de introducere, o oră de ieșire și un set de cântăriri). Generează acest raport ca NECONFORM, apoi pornește trecerea următoare pe același tronson: tronsonul, utilajele și semnatarii se copiază, greutățile nu.</div>
        {p.poateScrie ? <button style={{ ...ST.mare, marginTop: 10 }} disabled={inCurs} onClick={() => p.trecereNoua(rand)}>↻ Trecere nouă pe același tronson</button> : null}
      </div>
    )}

    {deschis && <div style={ST.card}>
      <div style={ST.h}>Detalii cerute de beneficiar</div>
      <div style={ST.nota}>Unele sunt precompletate din ultimul raport al proiectului: verifică-le dintr-o privire.</div>
      <Camp eticheta="Constructor">{inp('constructor')}</Camp>
      <div style={ST.lab}>Utilaje / echipamente</div>
      {p.blocUtilaje()}
      <div style={ST.rand}>
        <Camp eticheta="PIG metalic [buc]">{nrInp('pig_metalic_buc', { inputMode: 'numeric' })}</Camp>
        <Camp eticheta="Piston poliuretan [buc]">{nrInp('piston_pu_buc', { inputMode: 'numeric' })}</Camp>
      </div>
      <Camp eticheta="Beneficiarul notificat la">{oraInp('notificare_la')}</Camp>
      <Camp eticheta="Referința notificării (nr. adresă / mail)">{inp('notificare_ref')}</Camp>
      {v24.stare === 'sub_24h' && <div role="alert" style={{ color: G.yellow, fontSize: 14, marginTop: 6 }}>⚠ Notificarea s-a făcut cu {fmtNr(v24.ore)} h înainte; beneficiarul cere minimum 24 h.</div>}
      {v24.stare === 'ok' && <div style={{ color: G.green, fontSize: 13, marginTop: 6 }}>✓ Notificare cu {fmtNr(v24.ore)} h înainte (minimum 24 h).</div>}
      <div style={ST.rand}>
        <Camp eticheta="Temperatura exterioară (°C)">{p.nrCuSemn('temperatura_c', { onChange: e => schimba({ temperatura_c: e.target.value, temperatura_sursa: 'manual' }) })}</Camp>
        {editabil && <button style={ST.btn} onClick={p.propuneMeteo} disabled={inCurs}>🌡️ Din meteo</button>}
      </div>
      {p.meteoAlegere && <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>{p.meteoAlegere.opt.map(o => <button key={o.site_id} style={ST.btn} onClick={() => p.aplicaMeteo(o, p.meteoAlegere.gen, p.meteoAlegere.ctx)}>{o.site}: {o.temperatura_c} °C, {o.vreme} (observată la {fmtMoment(o.ora_observatiei)})</button>)}</div>}
      <Camp eticheta="Vremea">{inp('vreme')}</Camp>
      {blocPoze('temperatura', null, 'Poza termometrului')}
      <div style={ST.rand}>
        <Camp eticheta="Punctul de rouă (°C), opțional">{p.nrCuSemn('punct_roua_c')}</Camp>
        <Camp eticheta="Locul măsurării">{inp('punct_roua_loc')}</Camp>
      </div>
      <Camp eticheta="Presiunea (bar)">{nrInp('presiune_bar')}</Camp>
      <Camp eticheta="Timp deplasare (min)" nota="Calculat din ora introducerii și a ieșirii; corectează-l dacă buretele a stat.">{nrInp('timp_deplasare_min')}</Camp>
      <Camp eticheta="Observații"><textarea style={{ ...ST.in, minHeight: 80 }} disabled={!editabil} value={form.observatii} maxLength={4000} onChange={e => schimba({ observatii: e.target.value })} /></Camp>
      <div style={ST.rand}><Camp eticheta="Constructor — nume, prenume">{inp('semn_constructor_nume')}</Camp><Camp eticheta="Funcția">{inp('semn_constructor_functie')}</Camp></div>
      <div style={ST.rand}><Camp eticheta="Beneficiar — nume, prenume">{inp('semn_beneficiar_nume')}</Camp><Camp eticheta="Funcția">{inp('semn_beneficiar_functie')}</Camp></div>
      {p.pozeGata && pozeL.length > 0 && <>
        <div style={{ fontSize: 14, color: G.yellow, marginTop: 10 }}>Fotografii cerute de beneficiar încă lipsă: {pozeL.map(etichetaPozaLipsa).join(', ')}.</div>
        <Camp eticheta="Justificarea lipsei (obligatorie dacă generezi fără ele)"><textarea style={{ ...ST.in, minHeight: 60 }} disabled={!editabil} value={form.poze_justificare} maxLength={1000} onChange={e => schimba({ poze_justificare: e.target.value })} /></Camp>
      </>}
      {editabil && modificat && <button style={{ ...ST.mare, marginTop: 12 }} disabled={inCurs || !!p.conflict || p.nelamuriteTinta.length > 0} onClick={p.salveaza}>💾 Salvează detaliile</button>}
      <label style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 14, fontSize: 15, minHeight: 48 }}>
        <input type="checkbox" checked={p.confirmat} disabled={!editabil} onChange={e => p.setConfirmat(e.target.checked)} style={{ width: 26, height: 26 }} />
        Am verificat detaliile de mai sus (constructorul, utilajele, notificarea, semnatarii)
      </label>
    </div>}

    {deschis && <Lipsuri titlu="Ca să generezi raportul, mai trebuie:" lista={motive} />}
    {pas === 'inchis' && <div style={{ ...ST.card, borderColor: G.green }}>Raportul e generat (închis){rand.inchis_la ? ` la ${fmtMoment(rand.inchis_la)}` : ''}. Corecturile se fac prin redeschidere consemnată (administrator), din „Vezi / corectează toate datele”.</div>}
    {(deschis && editabil) || pas === 'inchis' ? <BaraJos jos={p.jos}>
      {deschis
        ? <button style={{ ...ST.mare, minHeight: 60, background: motive.length ? G.surface2 : '#238636', color: '#fff' }} disabled={inCurs || motive.length > 0} onClick={p.genereazaRaport}>{p.pdfInCurs ? '⏳ Se generează raportul…' : inCurs ? 'Se închide raportul…' : '📄 Generează raportul'}</button>
        : <button style={{ ...ST.mare, minHeight: 60 }} disabled={inCurs || !p.pozeGata} onClick={p.pdf}>{p.pdfInCurs ? '⏳ Se generează raportul…' : '📄 Descarcă raportul (PDF)'}</button>}
    </BaraJos> : null}
  </>
}
