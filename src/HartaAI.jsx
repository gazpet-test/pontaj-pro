// Harta AI — desenatorul interactiv al automatizărilor (06.11.2026, cerere Răzvan). Primește harta ca JSON prin `date`.
// Datele NU stau în repo (repo public, harta descrie infrastructura internă). Neconectată încă la meniul ERP:
// legarea într-o pagină owner-only și citirea JSON-ului din BD se fac după decizia lui Răzvan. Format: docs/HARTA_AI.md.
// Fără librării noi: SVG + React. Zoom (rotiță / butoane / ciupit), mutare prin tragere, click pe nod → fișa lui,
// filtru pe grup, evidențierea unui flux întreg, săgeți animate discret pe direcția informației.
// Problemele (câmpul „probleme” pe noduri și săgeți, din review-uri): insigne pe tip, filtrul „doar cu probleme”,
// secțiunea din fișă și lista „Top probleme” ordonată după gravitate (click = mergi la nod / săgeată).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CAMPURI_FISA, GRAVITATI, STARI_NOD, TIPURI_LEGATURA, TIPURI_NOD, TIPURI_PROBLEMA, cautaNoduri, drumLegatura,
  insigneProbleme, limiteHarta, listaProbleme, numaraProbleme, pasiFlux, pozitiiNoduri, valideazaHarta, veciniNod, vizibile,
} from './hartaAILogica.js'

const G = { bg: '#F1F5F9', surface: '#FFFFFF', border: '#E2E8EF', text: '#263642', muted: '#617282', blue: '#24778B', green: '#38765A', red: '#B74D55', yellow: '#946B20', redBg: '#FBEDEE', yellowBg: '#FBF3E2' }
const S = {
  panel: { background: G.surface, border: `1px solid ${G.border}`, borderRadius: 10, padding: 14 },
  button: { background: G.surface, color: G.text, border: `1px solid ${G.border}`, borderRadius: 7, padding: '7px 11px', minHeight: 36, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 },
  input: { background: G.surface, color: G.text, border: `1px solid ${G.border}`, borderRadius: 7, padding: '7px 10px', minHeight: 36, fontFamily: 'inherit', fontSize: 13, minWidth: 0 },
  small: { color: G.muted, fontSize: 12, lineHeight: 1.55 },
  row: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  h: { margin: '0 0 6px', fontSize: 15, fontWeight: 700, color: G.text },
  eticheta: { fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: G.muted, margin: '10px 0 3px' },
  mono: { fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', fontSize: 12 },
}
const CULOARE_IMPLICITA = '#617282'
const K_MIN = 0.12, K_MAX = 3

export const textScurt = (s, n) => { const t = String(s || ''); return t.length > n ? `${t.slice(0, n - 1)}…` : t }
const lista = v => (Array.isArray(v) ? v : [])

const CSS = `
@keyframes hartaCurge { from { stroke-dashoffset: 24 } to { stroke-dashoffset: 0 } }
.harta-leg-anim { stroke-dasharray: 7 5; animation: hartaCurge 4s linear infinite }
.harta-leg-anim.harta-leg-tare { animation-duration: 1.4s }
@media (prefers-reduced-motion: reduce) { .harta-leg-anim { animation: none } }
.harta-nod:focus-visible { outline: none } .harta-nod:focus-visible > rect.harta-corp { stroke-width: 3.5 }
`

export default function HartaAI({ date, inaltime }) {
  const verificare = useMemo(() => valideazaHarta(date), [date])
  const [arataAvert, setArataAvert] = useState(false)
  if (verificare.erori.length) {
    return (
      <div style={{ ...S.panel, borderColor: G.red, background: G.redBg }}>
        <h3 style={{ ...S.h, color: G.red }}>Harta nu se desenează: fișierul are {verificare.erori.length} erori</h3>
        <div style={S.small}>Repară harta.json și reîncarcă. Primele erori:</div>
        <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 13 }}>
          {verificare.erori.slice(0, 30).map((e, i) => <li key={i}>{e}</li>)}
        </ul>
      </div>
    )
  }
  return (
    <div>
      {verificare.avertismente.length > 0 && (
        <div style={{ ...S.panel, background: G.yellowBg, borderColor: '#E7D3A6', marginBottom: 8, padding: '8px 12px' }}>
          <button style={{ ...S.button, minHeight: 0, padding: '2px 8px', border: 'none', background: 'transparent', color: G.yellow, fontWeight: 600 }} onClick={() => setArataAvert(v => !v)}>
            {arataAvert ? '▾' : '▸'} {verificare.avertismente.length} avertismente în fișier
          </button>
          {arataAvert && <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 12.5 }}>{verificare.avertismente.slice(0, 60).map((e, i) => <li key={i}>{e}</li>)}</ul>}
        </div>
      )}
      <HartaDesen date={date} inaltime={inaltime} />
    </div>
  )
}

function HartaDesen({ date, inaltime }) {
  const grupuri = useMemo(() => lista(date.grupuri), [date])
  const grupDupaId = useMemo(() => Object.fromEntries(grupuri.map(g => [g.id, g])), [grupuri])
  const nodDupaId = useMemo(() => Object.fromEntries(lista(date.noduri).map(n => [n.id, n])), [date])
  const poz = useMemo(() => pozitiiNoduri(date), [date])
  const limite = useMemo(() => limiteHarta(date, poz), [date, poz])

  const [grupuriAscunse, setGrupuriAscunse] = useState(() => new Set())
  const [fluxActiv, setFluxActiv] = useState(null)
  const [selectat, setSelectat] = useState(null) // { tip: 'nod' | 'leg', id }
  const [cauta, setCauta] = useState('')
  const [toateEtichetele, setToateEtichetele] = useState(false)
  const [animatie, setAnimatie] = useState(true)
  const [arataGrupuri, setArataGrupuri] = useState(null) // null = implicit: deschis pe ecran lat, închis pe telefon
  const [doarProbleme, setDoarProbleme] = useState(false)
  const [panouProbleme, setPanouProbleme] = useState(false)
  const [vedere, setVedere] = useState({ x: 0, y: 0, k: 0.4 })
  const [marime, setMarime] = useState({ w: 900, h: 600, cont: 1200, masurat: false })

  const cutieRef = useRef(null)
  const svgRef = useRef(null)
  const vedereRef = useRef(vedere)
  vedereRef.current = vedere
  const tragereRef = useRef({ pointeri: new Map(), start: null, miscat: false, pinch: null })
  // true după prima mutare / zoom / centrare făcută de om: de atunci nu mai repotrivim singuri harta.
  const atinsRef = useRef(false)
  const panouRef = useRef(null)
  const ingustRef = useRef(false)

  // Pe telefon fișa stă sub hartă: la click pe un nod / o săgeată o aducem în vedere (la un flux nu, ca să se vadă harta).
  // Pe ecran lat panoul își resetează doar derularea.
  useEffect(() => {
    const el = panouRef.current
    if (!el) return
    if (selectat && ingustRef.current) el.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
    else if (!ingustRef.current) el.scrollTop = 0
  }, [selectat, fluxActiv])

  const viz = useMemo(() => vizibile(date, grupuriAscunse), [date, grupuriAscunse])
  const flux = useMemo(() => (fluxActiv ? pasiFlux(date, fluxActiv) : null), [date, fluxActiv])
  const gasite = useMemo(() => new Set(cautaNoduri(date, cauta)), [date, cauta])
  const vecini = useMemo(() => (selectat?.tip === 'nod' ? veciniNod(date, selectat.id) : null), [date, selectat])
  const legSelectata = useMemo(() => (selectat?.tip === 'leg' ? viz.legaturi.find(x => x.cheie === selectat.id) || null : null), [viz, selectat])
  const probleme = useMemo(() => listaProbleme(date), [date])
  // Ce are probleme: nodurile cu „probleme” + capetele săgeților cu „probleme”; cheile săgeților cu probleme.
  const cuProbleme = useMemo(() => {
    const noduri = new Set(), chei = new Set()
    lista(date.noduri).forEach(n => { if (lista(n.probleme).length) noduri.add(n.id) })
    viz.legaturi.forEach(x => { if (lista(x.l.probleme).length) { chei.add(x.cheie); noduri.add(x.l.de); noduri.add(x.l.la) } })
    return { noduri, chei }
  }, [date, viz])

  // Mărimea zonei de desen + lățimea totală (sub ~860 px panoul trece sub hartă).
  useEffect(() => {
    const el = cutieRef.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect()
      const parinte = el.parentElement?.parentElement?.getBoundingClientRect()
      setMarime(m => (m.masurat && Math.abs(m.w - r.width) < 1 && Math.abs(m.h - r.height) < 1 && m.cont === (parinte?.width || m.cont) ? m : { w: r.width, h: r.height, cont: parinte?.width || r.width, masurat: true }))
    })
    ro.observe(el)
    if (el.parentElement?.parentElement) ro.observe(el.parentElement.parentElement)
    return () => ro.disconnect()
  }, [])

  const potriveste = useCallback((cutie = limite) => {
    const { w, h } = marime
    if (!(w > 0 && h > 0)) return
    const k = Math.min(K_MAX, Math.max(K_MIN, Math.min(w / cutie.w, h / cutie.h) * 0.96))
    setVedere({ k, x: (w - cutie.w * k) / 2 - cutie.x * k, y: (h - cutie.h * k) / 2 - cutie.y * k })
  }, [limite, marime])

  // Potrivire pe toată harta la fiecare schimbare de mărime (inclusiv trecerea pe o coloană, pe telefon),
  // până la prima interacțiune a omului; un fișier nou o ia de la capăt.
  useEffect(() => { atinsRef.current = false }, [date])
  useEffect(() => { if (!atinsRef.current && marime.masurat && marime.w > 0 && marime.h > 0) potriveste() }, [marime, potriveste])

  const zoomLa = useCallback((factor, px, py) => {
    atinsRef.current = true
    setVedere(v => {
      const k = Math.min(K_MAX, Math.max(K_MIN, v.k * factor))
      const cx = px ?? marime.w / 2, cy = py ?? marime.h / 2
      return { k, x: cx - (cx - v.x) * (k / v.k), y: cy - (cy - v.y) * (k / v.k) }
    })
  }, [marime])

  // Rotița: ascultător nativ, nepasiv, ca pagina să nu se deruleze în timp ce mărești harta.
  useEffect(() => {
    const el = svgRef.current
    if (!el) return undefined
    const pe = e => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      zoomLa(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top)
    }
    el.addEventListener('wheel', pe, { passive: false })
    return () => el.removeEventListener('wheel', pe)
  }, [zoomLa])

  const centreazaPe = useCallback(id => {
    const p = poz[id]
    if (!p) return
    atinsRef.current = true
    setVedere(v => {
      const k = Math.max(v.k, 0.8)
      return { k, x: marime.w / 2 - (p.x + p.w / 2) * k, y: marime.h / 2 - (p.y + p.h / 2) * k }
    })
  }, [poz, marime])

  // Centrare pe mijlocul unei săgeți (din lista de probleme).
  const centreazaPeLeg = useCallback(cheie => {
    const x = viz.legaturi.find(v => v.cheie === cheie)
    const pa = x && poz[x.l.de], pb = x && poz[x.l.la]
    if (!pa || !pb) return
    atinsRef.current = true
    const cx = (pa.x + pa.w / 2 + pb.x + pb.w / 2) / 2, cy = (pa.y + pa.h / 2 + pb.y + pb.h / 2) / 2
    setVedere(v => { const k = Math.max(v.k, 0.6); return { k, x: marime.w / 2 - cx * k, y: marime.h / 2 - cy * k } })
  }, [viz, poz, marime])

  // Tragere (mutare) și ciupit (zoom cu două degete). Captura pointerului abia după 4 px, ca un click pe nod să rămână click.
  const laApasare = e => {
    const t = tragereRef.current
    t.pointeri.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (t.pointeri.size === 1) { t.start = { x: e.clientX, y: e.clientY, v: vedereRef.current }; t.miscat = false }
    if (t.pointeri.size === 2) {
      const [a, b] = [...t.pointeri.values()]
      t.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, v: vedereRef.current }
    }
  }
  const laMiscare = e => {
    const t = tragereRef.current
    if (!t.pointeri.has(e.pointerId)) return
    t.pointeri.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const r = svgRef.current?.getBoundingClientRect()
    if (t.pointeri.size === 2 && t.pinch && r) {
      const [a, b] = [...t.pointeri.values()]
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1
      const v0 = t.pinch.v
      const k = Math.min(K_MAX, Math.max(K_MIN, v0.k * (d / t.pinch.d)))
      const cx = (a.x + b.x) / 2 - r.left, cy = (a.y + b.y) / 2 - r.top
      t.miscat = true
      atinsRef.current = true
      setVedere({ k, x: cx - (cx - v0.x) * (k / v0.k), y: cy - (cy - v0.y) * (k / v0.k) })
      return
    }
    if (!t.start) return
    const dx = e.clientX - t.start.x, dy = e.clientY - t.start.y
    if (!t.miscat && Math.hypot(dx, dy) < 4) return
    if (!t.miscat) { t.miscat = true; atinsRef.current = true; try { svgRef.current?.setPointerCapture(e.pointerId) } catch { /* pointer deja eliberat */ } }
    setVedere({ ...t.start.v, x: t.start.v.x + dx, y: t.start.v.y + dy })
  }
  const laRidicare = e => {
    const t = tragereRef.current
    t.pointeri.delete(e.pointerId)
    if (t.pointeri.size < 2) t.pinch = null
    if (t.pointeri.size === 0) t.start = null
  }
  const peClick = fn => e => { if (tragereRef.current.miscat) return; e.stopPropagation(); fn() }

  const comutaGrup = id => setGrupuriAscunse(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const alegeFlux = id => { setFluxActiv(id || null); setSelectat(null); if (id) { const pf = pasiFlux(date, id); if (pf) setGrupuriAscunse(s => { const n = new Set(s); pf.noduri.forEach(x => n.delete(nodDupaId[x]?.grup)); return n }) } }
  useEffect(() => {
    const k = e => { if (e.key === 'Escape') { setSelectat(null); setFluxActiv(null) } }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [])

  // Ce e evidențiat: fluxul activ, altfel vecinii nodului selectat, altfel legătura selectată, altfel (filtrul) ce are probleme.
  const evid = useMemo(() => {
    if (flux) return { noduri: flux.noduri, chei: flux.chei }
    if (vecini && selectat) {
      const toate = [...vecini.intrari, ...vecini.iesiri]
      return { noduri: new Set([selectat.id, ...toate.flatMap(x => [x.legatura.de, x.legatura.la])]), chei: new Set(toate.map(x => x.cheie)) }
    }
    if (legSelectata) return { noduri: new Set([legSelectata.l.de, legSelectata.l.la]), chei: new Set([legSelectata.cheie]) }
    if (doarProbleme) return cuProbleme
    return null
  }, [flux, vecini, selectat, legSelectata, doarProbleme, cuProbleme])
  const alegeTinta = t => {
    if (t.tip === 'nod') { setSelectat({ tip: 'nod', id: t.id }); centreazaPe(t.id) }
    else { setSelectat({ tip: 'leg', id: t.id }); centreazaPeLeg(t.id) }
  }

  // Decalaj pentru legăturile paralele / din sens opus între aceleași două noduri.
  const decalaje = useMemo(() => {
    const cnt = {}, out = {}
    for (const x of viz.legaturi) {
      const pereche = [x.l.de, x.l.la].sort().join('|')
      const i = cnt[pereche] = (cnt[pereche] ?? -1) + 1
      const sens = x.l.de < x.l.la ? 1 : -1
      out[x.cheie] = sens * (i === 0 ? 0 : 16 * Math.ceil(i / 2) * (i % 2 ? 1 : -1))
    }
    return out
  }, [viz])

  const lat = marime.cont
  const ingust = lat < 860
  ingustRef.current = ingust
  const grupuriDeschise = arataGrupuri ?? !ingust
  const inaltimeHarta = inaltime || (ingust ? '62vh' : 'calc(100vh - 150px)')

  const culoareGrup = id => grupDupaId[id]?.culoare || CULOARE_IMPLICITA
  const fluxuri = lista(date.fluxuri)
  const meta = date.meta || {}

  return (
    <div style={{ background: G.bg, color: G.text, fontFamily: 'inherit' }}>
      <style>{CSS}</style>
      {/* Bara de unelte */}
      <div style={{ ...S.row, marginBottom: 8 }}>
        <input aria-label="Caută în hartă" placeholder="Caută nod, cont, secret (nume)…" value={cauta} style={{ ...S.input, flex: '1 1 220px' }}
          onChange={e => setCauta(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { const p = cautaNoduri(date, cauta)[0]; if (p) { setSelectat({ tip: 'nod', id: p }); centreazaPe(p) } } }} />
        <select aria-label="Evidențiază un flux" value={fluxActiv || ''} onChange={e => alegeFlux(e.target.value)} style={{ ...S.input, flex: '1 1 220px' }}>
          <option value="">Evidențiază un flux…</option>
          {fluxuri.map(f => <option key={f.id} value={f.id}>{f.nume || f.id}</option>)}
        </select>
        <div style={S.row}>
          <button style={S.button} aria-label="Micșorează" onClick={() => zoomLa(1 / 1.25)}>−</button>
          <button style={S.button} aria-label="Mărește" onClick={() => zoomLa(1.25)}>+</button>
          <button style={S.button} onClick={() => potriveste()}>⤢ Toată harta</button>
          <button style={{ ...S.button, ...(toateEtichetele ? { borderColor: G.blue, color: G.blue } : {}) }} aria-pressed={toateEtichetele} onClick={() => setToateEtichetele(v => !v)}>Etichete</button>
          <button style={{ ...S.button, ...(animatie ? { borderColor: G.blue, color: G.blue } : {}) }} aria-pressed={animatie} onClick={() => setAnimatie(v => !v)}>〰 Animație</button>
          {probleme.length > 0 && <>
            <button style={{ ...S.button, ...(doarProbleme ? { borderColor: G.red, color: G.red } : {}) }} aria-pressed={doarProbleme} onClick={() => setDoarProbleme(v => !v)}>⚠ Doar cu probleme</button>
            <button style={{ ...S.button, ...(panouProbleme ? { borderColor: G.red, color: G.red } : {}) }} aria-pressed={panouProbleme}
              onClick={() => { setPanouProbleme(v => !v); setSelectat(null) }}>Top probleme ({probleme.length})</button>
          </>}
          <button style={S.button} aria-expanded={grupuriDeschise} onClick={() => setArataGrupuri(!grupuriDeschise)}>
            {grupuriDeschise ? '▾' : '▸'} Grupuri{grupuriAscunse.size ? ` (${grupuriAscunse.size} ascunse)` : ''}
          </button>
        </div>
      </div>
      {grupuriDeschise && <div style={{ ...S.row, marginBottom: 8, gap: 6 }}>
        {grupuri.map(g => {
          const ascuns = grupuriAscunse.has(g.id)
          return (
            <button key={g.id} aria-pressed={!ascuns} onClick={() => comutaGrup(g.id)} title={g.descriere || g.nume}
              style={{ ...S.button, minHeight: 30, padding: '4px 10px', fontSize: 12.5, borderColor: g.culoare || G.border, background: ascuns ? G.surface : `${g.culoare || CULOARE_IMPLICITA}1A`, color: ascuns ? G.muted : G.text, textDecoration: ascuns ? 'line-through' : 'none' }}>
              <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, background: g.culoare || CULOARE_IMPLICITA, marginRight: 6, opacity: ascuns ? 0.35 : 1 }} />{g.nume || g.id}
            </button>
          )
        })}
        {grupuriAscunse.size > 0 && <button style={{ ...S.button, minHeight: 30, padding: '4px 10px', fontSize: 12.5 }} onClick={() => setGrupuriAscunse(new Set())}>Arată toate</button>}
      </div>}

      <div style={{ display: 'flex', flexDirection: ingust ? 'column' : 'row', gap: 10, alignItems: 'stretch' }}>
        {/* Desenul */}
        {/* Pe telefon (coloană) flex: none, altfel flex-basis 0 anulează înălțimea și SVG-ul cade pe 150 px. */}
        <div ref={cutieRef} style={{ flex: ingust ? '0 0 auto' : '1 1 0', minWidth: 0, height: inaltimeHarta, minHeight: 420, background: G.surface, border: `1px solid ${G.border}`, borderRadius: 10, overflow: 'hidden', position: 'relative', touchAction: 'none' }}>
          <svg ref={svgRef} width="100%" height="100%" role="img" aria-label={meta.titlu || 'Harta automatizărilor'}
            style={{ position: 'absolute', inset: 0, display: 'block', cursor: 'grab', userSelect: 'none' }}
            onPointerDown={laApasare} onPointerMove={laMiscare} onPointerUp={laRidicare} onPointerCancel={laRidicare}
            onClick={() => { if (!tragereRef.current.miscat) setSelectat(null) }}>
            <defs>
              {Object.entries(TIPURI_LEGATURA).map(([tip, [, c]]) => (
                <marker key={tip} id={`harta-sageata-${tip}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
                  <path d="M0,0 L10,5 L0,10 z" fill={c} />
                </marker>
              ))}
            </defs>
            <g transform={`translate(${vedere.x},${vedere.y}) scale(${vedere.k})`}>
              {grupuri.filter(g => !grupuriAscunse.has(g.id)).map(g => (
                <g key={g.id}>
                  <rect x={g.x} y={g.y} width={g.w} height={g.h} rx={14} fill={g.culoare || CULOARE_IMPLICITA} fillOpacity={0.055} stroke={g.culoare || CULOARE_IMPLICITA} strokeOpacity={0.45} strokeWidth={1.2} />
                  <text x={g.x + 14} y={g.y + 24} fontSize={15} fontWeight={700} fill={g.culoare || CULOARE_IMPLICITA}>{g.nume || g.id}</text>
                  {g.sub && <text x={g.x + 14} y={g.y + 38} fontSize={10.5} fill={G.muted}>{textScurt(g.sub, Math.floor(g.w / 6))}</text>}
                </g>
              ))}
              {viz.legaturi.map(x => {
                const pa = poz[x.l.de], pb = poz[x.l.la]
                if (!pa || !pb) return null
                const tip = TIPURI_LEGATURA[x.l.tip] ? x.l.tip : 'date'
                const culoare = TIPURI_LEGATURA[tip][1]
                const aprins = evid ? evid.chei.has(x.cheie) : false
                const stins = evid && !aprins
                const { d } = drumLegatura(pa, pb, decalaje[x.cheie] || 0)
                return (
                  <g key={x.cheie} onClick={peClick(() => setSelectat({ tip: 'leg', id: x.cheie }))} style={{ cursor: 'pointer' }}>
                    <path d={d} fill="none" stroke="transparent" strokeWidth={12} />
                    <path d={d} fill="none" stroke={culoare} strokeWidth={aprins ? 2.6 : 1.5} strokeOpacity={stins ? 0.07 : aprins ? 1 : 0.6}
                      markerEnd={`url(#harta-sageata-${tip})`} markerStart={x.l.dublu ? `url(#harta-sageata-${tip})` : undefined}
                      className={animatie && !stins ? `harta-leg-anim${aprins ? ' harta-leg-tare' : ''}` : undefined}>
                      <title>{`${nodDupaId[x.l.de]?.nume} → ${nodDupaId[x.l.la]?.nume}: ${x.l.ce || ''}`}</title>
                    </path>
                  </g>
                )
              })}
              {viz.legaturi.map(x => {
                const pa = poz[x.l.de], pb = poz[x.l.la]
                if (!pa || !pb || !x.l.ce) return null
                const aprins = evid ? evid.chei.has(x.cheie) : false
                if (!(aprins || (toateEtichetele && !evid && vedere.k >= 0.55))) return null
                const { eticheta } = drumLegatura(pa, pb, decalaje[x.cheie] || 0)
                return (
                  <text key={`e-${x.cheie}`} x={eticheta.x} y={eticheta.y} textAnchor="middle" fontSize={10.5} fontWeight={600}
                    fill={TIPURI_LEGATURA[x.l.tip]?.[1] || G.muted} style={{ paintOrder: 'stroke', stroke: '#FFFFFF', strokeWidth: 3.5, pointerEvents: 'none' }}>
                    {textScurt(x.l.ce, 34)}
                  </text>
                )
              })}
              {viz.legaturi.map(x => {
                const ins = insigneProbleme(x.l.probleme)
                const pa = poz[x.l.de], pb = poz[x.l.la]
                if (!ins.length || !pa || !pb || (evid && !evid.chei.has(x.cheie))) return null
                const { eticheta } = drumLegatura(pa, pb, decalaje[x.cheie] || 0)
                return <Insigne key={`p-${x.cheie}`} ins={ins} x={eticheta.x} y={eticheta.y - 20} centru onClick={peClick(() => setSelectat({ tip: 'leg', id: x.cheie }))} />
              })}
              {viz.noduri.map(n => {
                const p = poz[n.id]
                if (!p) return null
                const culoare = culoareGrup(n.grup)
                const tip = TIPURI_NOD[n.tip] || ['•', 'Nod']
                const poarta = n.tip === 'poarta'
                const extern = n.tip === 'extern'
                const stins = evid && !evid.noduri.has(n.id)
                const ales = selectat?.tip === 'nod' && selectat.id === n.id
                const gasit = gasite.has(n.id)
                const pas = flux?.ordine?.[n.id]
                const stare = n.stare
                return (
                  <g key={n.id} className="harta-nod" tabIndex={0} role="button" aria-label={`${n.nume}. ${tip[1]}`} style={{ cursor: 'pointer', opacity: stins ? 0.18 : 1 }}
                    onClick={peClick(() => setSelectat({ tip: 'nod', id: n.id }))}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectat({ tip: 'nod', id: n.id }) } }}>
                    <title>{`${n.nume}${n.sub ? ` — ${n.sub}` : ''}`}</title>
                    {(gasit || ales) && <rect x={p.x - 5} y={p.y - 5} width={p.w + 10} height={p.h + 10} rx={11} fill="none" stroke={ales ? G.text : G.blue} strokeWidth={ales ? 2.5 : 2} strokeDasharray={ales ? undefined : '4 3'} />}
                    <rect className="harta-corp" x={p.x} y={p.y} width={p.w} height={p.h} rx={poarta ? 4 : n.tip === 'om' ? 24 : 8}
                      fill={poarta ? G.redBg : stare === 'oprit' ? '#F3F5F7' : G.surface}
                      stroke={poarta ? G.red : culoare} strokeWidth={poarta ? 2.4 : 1.4}
                      strokeDasharray={extern ? '5 3' : stare === 'oprit' ? '3 3' : stare === 'viitor' ? '1.5 3' : undefined} />
                    {!poarta && n.tip !== 'om' && <rect x={p.x} y={p.y + 6} width={4} height={p.h - 12} rx={2} fill={culoare} />}
                    <text x={p.x + 12} y={p.y + (n.sub ? 21 : 30)} fontSize={12.5} fontWeight={650} fill={poarta ? G.red : G.text}>{`${tip[0]} ${textScurt(n.nume, 21)}`}</text>
                    {n.sub && <text x={p.x + 12} y={p.y + 37} fontSize={10.5} fill={G.muted}>{textScurt(n.sub, 29)}</text>}
                    {(stare === 'neverificat' || stare === 'eroare') && (
                      <g><circle cx={p.x + p.w - 4} cy={p.y + 4} r={8} fill={STARI_NOD[stare][1]} /><text x={p.x + p.w - 4} y={p.y + 8} textAnchor="middle" fontSize={11} fontWeight={700} fill="#FFFFFF">{stare === 'eroare' ? '!' : '?'}</text></g>
                    )}
                    {lista(n.probleme).length > 0 && <Insigne ins={insigneProbleme(n.probleme)} x={p.x + p.w - 4} y={p.y + p.h - 8} />}
                    {pas && (
                      <g><circle cx={p.x + 2} cy={p.y + 2} r={10} fill={G.text} /><text x={p.x + 2} y={p.y + 6} textAnchor="middle" fontSize={11} fontWeight={700} fill="#FFFFFF">{pas}</text></g>
                    )}
                  </g>
                )
              })}
            </g>
          </svg>
          <div style={{ position: 'absolute', left: 8, bottom: 6, ...S.small, background: 'rgba(255,255,255,.85)', padding: '2px 6px', borderRadius: 5, pointerEvents: 'none' }}>
            {Math.round(vedere.k * 100)}% · trage ca să muți · rotița / ciupit = zoom · Esc = curăță
          </div>
        </div>

        {/* Panoul din dreapta (sau de sub hartă, pe telefon) */}
        <div ref={panouRef} style={{ width: ingust ? 'auto' : 360, flex: ingust ? 'none' : '0 0 360px', maxHeight: ingust ? 'none' : inaltimeHarta, overflowY: 'auto', ...S.panel }}>
          {selectat?.tip === 'nod' && nodDupaId[selectat.id]
            ? <FisaNod n={nodDupaId[selectat.id]} grup={grupDupaId[nodDupaId[selectat.id].grup]} vecini={vecini} nodDupaId={nodDupaId}
                probleme={probleme} alegeTinta={alegeTinta} inapoi={panouProbleme} legaturi={viz.legaturi}
                alegeNod={id => { setSelectat({ tip: 'nod', id }); centreazaPe(id) }} alegeLeg={c => setSelectat({ tip: 'leg', id: c })} inchide={() => setSelectat(null)} />
            : legSelectata
              ? <FisaLegatura x={legSelectata} nodDupaId={nodDupaId} probleme={probleme} alegeTinta={alegeTinta} inapoi={panouProbleme} legaturi={viz.legaturi}
                  alegeNod={id => { setSelectat({ tip: 'nod', id }); centreazaPe(id) }} inchide={() => setSelectat(null)} />
              : panouProbleme
                ? <TopProbleme probleme={probleme} date={date} nodDupaId={nodDupaId} legaturi={viz.legaturi} alegeTinta={alegeTinta} inchide={() => setPanouProbleme(false)} />
                : flux
                  ? <FisaFlux pf={flux} nodDupaId={nodDupaId} alegeNod={id => { setSelectat({ tip: 'nod', id }); centreazaPe(id) }} inchide={() => setFluxActiv(null)} />
                  : <Prezentare meta={meta} date={date} fluxuri={fluxuri} alegeFlux={alegeFlux} probleme={probleme} deschideProbleme={() => setPanouProbleme(true)} />}
        </div>
      </div>
    </div>
  )
}

function Inchide({ onClick, eticheta }) {
  return <button style={{ ...S.button, minHeight: 28, padding: '2px 9px', float: 'right' }} onClick={onClick} aria-label={eticheta || 'Închide'}>{eticheta ? `← ${eticheta}` : '✕'}</button>
}

// Insignele de probleme pe un nod / o săgeată: câte o pastilă pe tip (culoarea tipului, numărul de probleme).
// x = marginea dreaptă (sau centrul, cu „centru”), y = mijlocul pastilei.
const LAT_INSIGNA = 22, PAS_INSIGNA = 25
function Insigne({ ins, x, y, centru, onClick }) {
  const total = ins.length * PAS_INSIGNA - (PAS_INSIGNA - LAT_INSIGNA)
  const x0 = centru ? x - total / 2 : x - total
  return (
    <g onClick={onClick} style={onClick ? { cursor: 'pointer' } : undefined}>
      {ins.map((i, k) => (
        <g key={i.tip}>
          <title>{`${TIPURI_PROBLEMA[i.tip][0]}: ${i.numar}`}</title>
          <rect x={x0 + k * PAS_INSIGNA} y={y - 7.5} width={LAT_INSIGNA} height={15} rx={7.5} fill={i.culoare} stroke="#FFFFFF" strokeWidth={1.5} />
          <text x={x0 + k * PAS_INSIGNA + LAT_INSIGNA / 2} y={y + 4} textAnchor="middle" fontSize={10.5} fontWeight={700} fill="#FFFFFF">{i.numar}</text>
        </g>
      ))}
    </g>
  )
}

function Pastila({ culoare, text, plin }) {
  return <span style={{ display: 'inline-block', borderRadius: 9, padding: '1px 7px', fontSize: 11, fontWeight: 700, lineHeight: 1.5, color: plin ? '#FFFFFF' : culoare, background: plin ? culoare : `${culoare}1A`, border: `1px solid ${culoare}` }}>{text}</span>
}
const CULORI_GRAVITATE = { mare: G.red, medie: G.yellow, mica: G.muted }

// O problemă în fișă: tip + gravitate, titlu, dovada, propunerea, sursa; „și la” = celelalte noduri / săgeți cu aceeași problemă.
function ProblemaCard({ p, alte, alegeTinta, numeTinta }) {
  const tip = TIPURI_PROBLEMA[p.tip] || ['Problemă', G.muted]
  return (
    <div style={{ borderLeft: `4px solid ${tip[1]}`, background: G.bg, borderRadius: 6, padding: '6px 9px', margin: '6px 0' }}>
      <div style={{ ...S.row, gap: 5 }}><Pastila culoare={tip[1]} text={tip[0]} plin /><Pastila culoare={CULORI_GRAVITATE[p.gravitate] || G.muted} text={GRAVITATI[p.gravitate]?.[1] || p.gravitate} /></div>
      <div style={{ fontSize: 13, fontWeight: 650, margin: '4px 0 2px' }}>{p.titlu}</div>
      {p.propunere && <div style={{ fontSize: 12.5, lineHeight: 1.45 }}><b>Propunere:</b> {p.propunere}</div>}
      {p.dovada && <div style={{ ...S.mono, fontSize: 11.5, color: G.muted, marginTop: 3, wordBreak: 'break-word' }}>{p.dovada}</div>}
      {p.sursa && <div style={{ ...S.small, fontSize: 11.5 }}>Sursa: {p.sursa}</div>}
      {alte?.length > 0 && <div style={{ ...S.small, fontSize: 11.5 }}>Și la: {alte.map((t, i) => (
        <button key={i} style={{ border: 'none', background: 'none', padding: 0, color: G.blue, cursor: 'pointer', fontFamily: 'inherit', fontSize: 11.5, textDecoration: 'underline', marginRight: 6 }} onClick={() => alegeTinta(t)}>{numeTinta(t)}</button>
      ))}</div>}
    </div>
  )
}

// Secțiunea „Probleme” din fișa unui nod sau a unei săgeți.
function SectiuneProbleme({ proprii, tinta, probleme, alegeTinta, numeTinta }) {
  const l = lista(proprii)
  if (!l.length) return null
  const sortate = [...l].sort((a, b) => (GRAVITATI[b.gravitate]?.[0] || 0) - (GRAVITATI[a.gravitate]?.[0] || 0))
  const alteTinte = p => {
    const rec = p.id ? probleme.find(r => r.problema.id === p.id) : null
    return rec ? rec.tinte.filter(t => !(t.tip === tinta.tip && t.id === tinta.id)) : []
  }
  return (
    <div>
      <div style={{ ...S.eticheta, color: G.red }}>Probleme ({l.length})</div>
      {sortate.map((p, i) => <ProblemaCard key={p.id || i} p={p} alte={alteTinte(p)} alegeTinta={alegeTinta} numeTinta={numeTinta} />)}
    </div>
  )
}

// Lista „Top probleme”: toate problemele, o dată fiecare, ordonate după gravitate; filtre pe tip și gravitate.
function TopProbleme({ probleme, date, nodDupaId, legaturi, alegeTinta, inchide }) {
  const [tip, setTip] = useState('toate')
  const [grav, setGrav] = useState('toate')
  const nr = useMemo(() => numaraProbleme(date), [date])
  const numeTinta = useNumeTinta(nodDupaId, legaturi)
  const vizibile = probleme.filter(r => (tip === 'toate' || r.problema.tip === tip) && (grav === 'toate' || r.problema.gravitate === grav))
  const buton = (activ, culoare) => ({ ...S.button, minHeight: 28, padding: '3px 9px', fontSize: 12, ...(activ ? { borderColor: culoare, color: culoare, fontWeight: 700 } : {}) })
  return (
    <div>
      <Inchide onClick={inchide} />
      <h3 style={{ ...S.h, paddingRight: 36 }}>Top probleme ({nr.total})</h3>
      <div style={S.small}>Ordonate după gravitate. Click pe o problemă = mergi la nod / săgeată.</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, margin: '8px 0' }}>
        <thead><tr><th style={{ textAlign: 'left', fontWeight: 600, color: G.muted }}>Tip</th>{Object.entries(GRAVITATI).map(([g, [, e]]) => <th key={g} style={{ textAlign: 'right', fontWeight: 600, color: G.muted }}>{e}</th>)}<th style={{ textAlign: 'right', fontWeight: 600, color: G.muted }}>Total</th></tr></thead>
        <tbody>{Object.entries(TIPURI_PROBLEMA).map(([t, [e, c]]) => (
          <tr key={t}><td style={{ padding: '2px 0' }}><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 5, background: c, marginRight: 5 }} />{e}</td>
            {Object.keys(GRAVITATI).map(g => <td key={g} style={{ textAlign: 'right' }}>{nr[t][g]}</td>)}<td style={{ textAlign: 'right', fontWeight: 700 }}>{nr[t].total}</td></tr>
        ))}</tbody>
      </table>
      <div style={{ ...S.row, gap: 4, marginBottom: 4 }}>
        <button style={buton(tip === 'toate', G.text)} onClick={() => setTip('toate')}>Toate tipurile</button>
        {Object.entries(TIPURI_PROBLEMA).map(([t, [e, c]]) => <button key={t} style={buton(tip === t, c)} aria-pressed={tip === t} onClick={() => setTip(t)}>{e}</button>)}
      </div>
      <div style={{ ...S.row, gap: 4, marginBottom: 6 }}>
        <button style={buton(grav === 'toate', G.text)} onClick={() => setGrav('toate')}>Orice gravitate</button>
        {Object.entries(GRAVITATI).map(([g, [, e]]) => <button key={g} style={buton(grav === g, CULORI_GRAVITATE[g])} aria-pressed={grav === g} onClick={() => setGrav(g)}>{e}</button>)}
      </div>
      <div style={{ display: 'grid', gap: 5 }}>
        {vizibile.map(r => {
          const p = r.problema
          const c = TIPURI_PROBLEMA[p.tip]?.[1] || G.muted
          return (
            <button key={r.cheie} onClick={() => alegeTinta(r.tinte[0])}
              style={{ ...S.button, textAlign: 'left', minHeight: 0, padding: '6px 9px', borderLeft: `4px solid ${c}`, display: 'block', width: '100%' }}>
              <div style={{ ...S.row, gap: 5 }}><Pastila culoare={CULORI_GRAVITATE[p.gravitate] || G.muted} text={GRAVITATI[p.gravitate]?.[1] || p.gravitate} plin /><span style={{ ...S.small, fontSize: 11.5 }}>{TIPURI_PROBLEMA[p.tip]?.[0]}</span></div>
              <div style={{ fontSize: 13, fontWeight: 600, margin: '3px 0 1px' }}>{p.titlu}</div>
              <div style={{ ...S.small, fontSize: 11.5 }}>{r.tinte.map(numeTinta).join(' · ')}{p.sursa ? ` — ${p.sursa}` : ''}</div>
            </button>
          )
        })}
        {!vizibile.length && <div style={S.small}>Nicio problemă pe filtrul ales.</div>}
      </div>
    </div>
  )
}

// Numele unei ținte de problemă: numele nodului, sau „A → B” pentru o săgeată.
function useNumeTinta(nodDupaId, legaturi) {
  return useCallback(t => {
    if (t.tip === 'nod') return nodDupaId[t.id]?.nume || t.id
    const x = lista(legaturi).find(v => v.cheie === t.id)
    return x ? `${textScurt(nodDupaId[x.l.de]?.nume, 22)} → ${textScurt(nodDupaId[x.l.la]?.nume, 22)}` : 'săgeată ascunsă'
  }, [nodDupaId, legaturi])
}

function Prezentare({ meta, date, fluxuri, alegeFlux, probleme = [], deschideProbleme }) {
  const nr = lista(date.noduri).length, nl = lista(date.legaturi).length
  const neverificate = lista(date.noduri).filter(n => n.stare === 'neverificat' || lista(n.fisa?.neverificat).length).length
  const mari = probleme.filter(r => r.problema.gravitate === 'mare').length
  return (
    <div>
      <h3 style={S.h}>{meta.titlu || 'Harta automatizărilor'}</h3>
      {meta.stare_la && <div style={S.small}>Starea din {meta.stare_la}{meta.autor ? ` · ${meta.autor}` : ''}</div>}
      {meta.nota && <p style={{ fontSize: 13, lineHeight: 1.5, margin: '8px 0' }}>{meta.nota}</p>}
      <div style={S.small}>{nr} noduri · {nl} legături · {fluxuri.length} fluxuri · {neverificate} cu puncte neverificate</div>
      {probleme.length > 0 && (
        <button onClick={deschideProbleme} style={{ ...S.button, display: 'block', width: '100%', textAlign: 'left', marginTop: 8, borderColor: G.red, borderLeft: `4px solid ${G.red}` }}>
          <b style={{ color: G.red }}>⚠ {probleme.length} probleme găsite în review</b>{mari ? ` · ${mari} mari` : ''}
          <div style={{ ...S.small, marginTop: 2 }}>Deschide „Top probleme” (ordonate după gravitate)</div>
        </button>
      )}
      {fluxuri.length > 0 && <>
        <div style={S.eticheta}>Fluxuri (click = evidențiază tot drumul)</div>
        <div style={{ display: 'grid', gap: 5 }}>
          {fluxuri.map(f => (
            <button key={f.id} style={{ ...S.button, textAlign: 'left', minHeight: 0, padding: '6px 10px' }} onClick={() => alegeFlux(f.id)}>
              <b style={{ fontWeight: 600 }}>{f.nume || f.id}</b>{f.descriere && <div style={{ ...S.small, marginTop: 2 }}>{textScurt(f.descriere, 120)}</div>}
            </button>
          ))}
        </div>
      </>}
      <div style={S.eticheta}>Legendă: săgeți</div>
      <div style={{ display: 'grid', gap: 3 }}>
        {Object.entries(TIPURI_LEGATURA).map(([k, [nume, c]]) => (
          <div key={k} style={{ ...S.row, gap: 6, fontSize: 12.5 }}><svg width="34" height="10" aria-hidden="true"><line x1="0" y1="5" x2="26" y2="5" stroke={c} strokeWidth="2" /><path d="M26,1 L34,5 L26,9 z" fill={c} /></svg>{nume}</div>
        ))}
      </div>
      <div style={S.eticheta}>Legendă: noduri</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 10px', fontSize: 12.5 }}>
        {Object.entries(TIPURI_NOD).map(([k, [ic, nume]]) => <div key={k}>{ic} {nume}</div>)}
      </div>
      {probleme.length > 0 && <>
        <div style={S.eticheta}>Legendă: insigne de probleme</div>
        <div style={{ display: 'grid', gap: 3, fontSize: 12.5 }}>
          {Object.entries(TIPURI_PROBLEMA).map(([k, [nume, c]]) => <div key={k} style={{ ...S.row, gap: 6 }}><Pastila culoare={c} text="n" plin />{nume}</div>)}
        </div>
      </>}
      <div style={{ ...S.small, marginTop: 6 }}>Chenar punctat = serviciu extern · chenar întrerupt = oprit · <span style={{ color: G.yellow, fontWeight: 700 }}>?</span> = neverificat · <span style={{ color: G.red, fontWeight: 700 }}>!</span> = eroare la ultima rulare · chenar roșu = poartă umană („da”).</div>
      {meta.surse && <>
        <div style={S.eticheta}>Surse</div>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>{lista(meta.surse).map((s, i) => <li key={i}>{s}</li>)}</ul>
      </>}
      <div style={{ ...S.small, marginTop: 10 }}>Valorile secretelor nu apar niciodată pe hartă: doar numele lor.</div>
    </div>
  )
}

function Camp({ eticheta, valoare, atentie }) {
  if (valoare == null || valoare === '') return null
  return (
    <div>
      <div style={S.eticheta}>{eticheta}</div>
      <div style={{ fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap', ...(atentie ? { background: G.yellowBg, borderRadius: 5, padding: '3px 6px' } : {}) }}>{valoare}</div>
    </div>
  )
}

function FisaNod({ n, grup, vecini, nodDupaId, alegeNod, alegeLeg, inchide, probleme = [], alegeTinta, inapoi, legaturi }) {
  const f = n.fisa || {}
  const tip = TIPURI_NOD[n.tip] || ['•', n.tip || 'Nod']
  const stare = STARI_NOD[n.stare]
  const marcat = v => /neverificat|de confirmat/i.test(String(v || ''))
  const numeTinta = useNumeTinta(nodDupaId, legaturi)
  return (
    <div>
      <Inchide onClick={inchide} eticheta={inapoi ? 'Top probleme' : undefined} />
      <h3 style={{ ...S.h, paddingRight: inapoi ? 110 : 36 }}>{tip[0]} {n.nume}</h3>
      <div style={S.small}>{tip[1]}{grup ? ` · ${grup.nume}` : ''}{stare ? <> · <b style={{ color: stare[1] }}>{stare[0]}</b></> : null}</div>
      {n.sub && <div style={{ fontSize: 13, marginTop: 4 }}>{n.sub}</div>}
      <SectiuneProbleme proprii={n.probleme} tinta={{ tip: 'nod', id: n.id }} probleme={probleme} alegeTinta={alegeTinta} numeTinta={numeTinta} />
      {CAMPURI_FISA.map(([k, et]) => <Camp key={k} eticheta={et} valoare={f[k]} atentie={marcat(f[k])} />)}
      {lista(f.secrete).length > 0 && <>
        <div style={S.eticheta}>Secrete folosite (doar numele)</div>
        <div style={{ ...S.row, gap: 4 }}>{lista(f.secrete).map(s => <code key={s} style={{ ...S.mono, background: G.bg, border: `1px solid ${G.border}`, borderRadius: 5, padding: '1px 6px' }}>{s}</code>)}</div>
      </>}
      {lista(f.neverificat).length > 0 && <>
        <div style={{ ...S.eticheta, color: G.yellow }}>Neverificat — de confirmat</div>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, background: G.yellowBg, borderRadius: 6, padding: '4px 6px 4px 22px' }}>{lista(f.neverificat).map((s, i) => <li key={i}>{s}</li>)}</ul>
      </>}
      {lista(f.surse).length > 0 && <>
        <div style={S.eticheta}>Surse</div>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>{lista(f.surse).map((s, i) => <li key={i} style={S.mono}>{s}</li>)}</ul>
      </>}
      {vecini && (vecini.intrari.length > 0 || vecini.iesiri.length > 0) && <>
        <div style={S.eticheta}>Ce intră</div>
        <ListaLeg elemente={vecini.intrari} nodDupaId={nodDupaId} alegeNod={alegeNod} alegeLeg={alegeLeg} sageata="←" />
        <div style={S.eticheta}>Ce iese</div>
        <ListaLeg elemente={vecini.iesiri} nodDupaId={nodDupaId} alegeNod={alegeNod} alegeLeg={alegeLeg} sageata="→" />
      </>}
    </div>
  )
}

function ListaLeg({ elemente, nodDupaId, alegeNod, alegeLeg, sageata }) {
  if (!elemente.length) return <div style={S.small}>nimic</div>
  return (
    <div style={{ display: 'grid', gap: 3 }}>
      {elemente.map(({ cheie, legatura: l, alt }) => (
        <div key={cheie} style={{ fontSize: 12.5, lineHeight: 1.4 }}>
          <button style={{ ...S.button, minHeight: 0, padding: '1px 6px', fontSize: 12 }} onClick={() => alegeNod(alt)}>{sageata} {textScurt(nodDupaId[alt]?.nume, 26)}</button>{' '}
          <button style={{ border: 'none', background: 'none', padding: 0, color: TIPURI_LEGATURA[l.tip]?.[1] || G.muted, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, textAlign: 'left' }} onClick={() => alegeLeg(cheie)}>{l.ce}</button>
        </div>
      ))}
    </div>
  )
}

function FisaLegatura({ x, nodDupaId, alegeNod, inchide, probleme = [], alegeTinta, inapoi, legaturi }) {
  const l = x.l
  const tip = TIPURI_LEGATURA[l.tip] || TIPURI_LEGATURA.date
  const numeTinta = useNumeTinta(nodDupaId, legaturi)
  return (
    <div>
      <Inchide onClick={inchide} eticheta={inapoi ? 'Top probleme' : undefined} />
      <h3 style={{ ...S.h, paddingRight: inapoi ? 110 : 36 }}>Săgeată: {l.ce || '(fără descriere)'}</h3>
      <div style={{ ...S.small, color: tip[1], fontWeight: 600 }}>{tip[0]}{l.dublu ? ' · în ambele sensuri' : ''}</div>
      <div style={{ ...S.row, margin: '10px 0' }}>
        <button style={S.button} onClick={() => alegeNod(l.de)}>{textScurt(nodDupaId[l.de]?.nume, 28)}</button>
        <span aria-hidden="true">{l.dublu ? '⇄' : '→'}</span>
        <button style={S.button} onClick={() => alegeNod(l.la)}>{textScurt(nodDupaId[l.la]?.nume, 28)}</button>
      </div>
      <Camp eticheta="Ce trece" valoare={l.ce} />
      <Camp eticheta="Detalii" valoare={l.detaliu} atentie={/neverificat|de confirmat/i.test(l.detaliu || '')} />
      <Camp eticheta="Cât de des" valoare={l.cand} />
      <SectiuneProbleme proprii={l.probleme} tinta={{ tip: 'leg', id: x.cheie }} probleme={probleme} alegeTinta={alegeTinta} numeTinta={numeTinta} />
      {lista(l.surse).length > 0 && <><div style={S.eticheta}>Surse</div><ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>{lista(l.surse).map((s, i) => <li key={i} style={S.mono}>{s}</li>)}</ul></>}
    </div>
  )
}

function FisaFlux({ pf, nodDupaId, alegeNod, inchide }) {
  const f = pf.flux
  return (
    <div>
      <Inchide onClick={inchide} />
      <h3 style={{ ...S.h, paddingRight: 36 }}>{f.nume || f.id}</h3>
      {f.descriere && <p style={{ fontSize: 13, lineHeight: 1.5, margin: '4px 0 8px' }}>{f.descriere}</p>}
      <ol style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 6 }}>
        {pf.pasi.map((p, i) => (
          <li key={i} style={{ fontSize: 13, lineHeight: 1.45 }}>
            <button style={{ ...S.button, minHeight: 0, padding: '1px 6px', fontSize: 12 }} onClick={() => alegeNod(p.de)}>{textScurt(nodDupaId[p.de]?.nume, 24)}</button>
            {' → '}
            <button style={{ ...S.button, minHeight: 0, padding: '1px 6px', fontSize: 12 }} onClick={() => alegeNod(p.la)}>{textScurt(nodDupaId[p.la]?.nume, 24)}</button>
            <div style={{ color: TIPURI_LEGATURA[p.legatura?.tip]?.[1] || G.muted, fontWeight: 600, fontSize: 12.5 }}>{p.legatura?.ce}</div>
            {p.legatura?.detaliu && <div style={S.small}>{p.legatura.detaliu}</div>}
          </li>
        ))}
      </ol>
      {pf.ramuri.length > 0 && <>
        <div style={S.eticheta}>Ramuri</div>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5 }}>{pf.ramuri.map((r, i) => <li key={i}>{nodDupaId[r.de]?.nume} → {nodDupaId[r.la]?.nume}: {r.legatura?.ce}</li>)}</ul>
      </>}
      {lista(f.note).length > 0 && <><div style={S.eticheta}>De reținut</div><ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5 }}>{lista(f.note).map((s, i) => <li key={i}>{s}</li>)}</ul></>}
    </div>
  )
}
