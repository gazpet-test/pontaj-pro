// ═══════════════════════════════════════════════════════════════════════════
// NodCuplareVizualizare.jsx — piesele de afișare ale schemei unui nod de cuplare (fără Supabase)
// Contorul (azi / cumulat / rest pe diametre), vederea cu zoom + pan (pointer events + CSS transform, fără librării:
// un deget = pan, două degete = pinch, dublu-tap = zoom, rotița pe desktop, butonul „Încadrează”), punctele colorate după
// stare (mărime fixă pe ecran, ~30 px, la orice zoom) și fișa sudurii cu schimbarea stării.
// Datele vin de la NodCuplareSchema.jsx; aici nu se citește și nu se scrie nimic în BD.
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ETICHETE, culoareStare, esteStare, stariUrmatoare, cereSudor, cereBuletin, cereMotiv, valideazaMarcare, scadeZile, ZILE_INAPOI,
  incadreaza, limiteScala, zoomLa, ecranDinPct, distanta, mijloc, STARI, fundalGrup, celMaiAproape, RAZA_ATINGERE,
} from './nodCuplareLogica.js'

export const G = {
  bg: '#0D1117', surface: '#161B22', surface2: '#1C2230', border: '#30363D', border2: '#21262D',
  text: '#E6EDF3', muted: '#8B949E', dim: '#6E7681',
  blue: '#58A6FF', green: '#3FB950', red: '#F85149', yellow: '#D29922', purple: '#BC8CFF',
}
export const S = {
  btn: { background: G.surface2, border: `1px solid ${G.border}`, color: G.text, borderRadius: 10, padding: '9px 14px', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  input: { background: G.bg, border: `1px solid ${G.border}`, color: G.text, borderRadius: 10, padding: '10px 12px', fontSize: 16, fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box' },
  label: { fontSize: 12, color: G.muted, fontWeight: 600, display: 'block', marginBottom: 4 },
  chip: (activ, c) => ({ background: activ ? c + '33' : 'transparent', border: `1px solid ${activ ? c : G.border}`, color: activ ? G.text : G.muted, borderRadius: 999, padding: '5px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 6 }),
}
const fmtZi = z => (z ? z.split('-').reverse().join('.') : '—')
const nrCod = cod => String(cod || '').replace(/^[A-Z]+-0*/, '') || '?'

// ── contorul de sus ──
export function ContorNod({ c, ziAfisata }) {
  const mare = (eticheta, val, cul) => (
    <div style={{ flex: 1, minWidth: 0, background: G.surface, border: `1px solid ${G.border2}`, borderRadius: 12, padding: '8px 10px', textAlign: 'center' }}>
      <div style={{ fontSize: 24, fontWeight: 800, color: cul, lineHeight: 1.1 }}>{val}</div>
      <div style={{ fontSize: 11, color: G.muted, fontWeight: 600 }}>{eticheta}</div>
    </div>
  )
  return (
    <div>
      <div style={{ display: 'flex', gap: 8 }}>
        {mare(`azi ${fmtZi(ziAfisata).slice(0, 5)}`, c.azi, G.blue)}
        {mare(`cumulat din ${c.total}`, c.cumulat, G.green)}
        {mare('rest', c.rest, G.yellow)}
      </div>
      {c.necunoscute > 0 && <div style={{ marginTop: 6, fontSize: 12, color: G.red, fontWeight: 700 }}>⚠️ {c.necunoscute} suduri au o stare necunoscută (nu intră nici în cumulat, nici în rest)</div>}
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', marginTop: 8, paddingBottom: 2 }}>
        {c.peDn.map(d => (
          <div key={d.eticheta} style={{ flexShrink: 0, background: G.surface, border: `1px solid ${G.border2}`, borderRadius: 10, padding: '5px 9px', fontSize: 12, color: G.text, whiteSpace: 'nowrap' }}>
            <b>{d.eticheta}</b>
            <span style={{ color: G.blue }}> azi {d.azi}</span>
            <span style={{ color: G.green }}> · {d.cumulat}/{d.total}</span>
            <span style={{ color: G.yellow }}> · rest {d.rest}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function Legenda() {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, fontSize: 11, color: G.muted }}>
      {STARI.map(s => (
        <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 11, height: 11, borderRadius: '50%', background: culoareStare(s), border: `1px solid ${G.text}55` }} />{ETICHETE[s]}
        </span>
      ))}
    </div>
  )
}

// ── vederea cu zoom + pan ──
const R = 15   // raza CERCULUI pe ecran (30 px), aceeași la orice zoom; ținta de atingere e mai mare (RAZA_ATINGERE, ~46 px)
// cheieImagine = identitatea completă a imaginii (proiect / nod / vedere / fișier): la schimbarea ei se reîncadrează și se uită gesturile
export function SchemaVedere({ imagineUrl, cheieImagine, w, h, grupuri, selectatId, onSelect, inaltime = null, onEroareImagine }) {
  const ref = useRef(null)
  const [dim, setDim] = useState({ cw: 0, ch: 0 })
  const [v, setV] = useState({ scale: 1, tx: 0, ty: 0 })
  const vRef = useRef(v); vRef.current = v
  const atins = useRef(false)          // până la primul gest, vederea se reîncadrează la orice redimensionare (rotire, bară de adrese)
  const seteaza = f => { atins.current = true; setV(f) }
  const pointeri = useRef(new Map())
  const gest = useRef(null)
  const ultimTap = useRef(null)
  const fit = useMemo(() => incadreaza({ w, h }, dim), [w, h, dim])
  const lim = useMemo(() => limiteScala(fit), [fit])
  const limRef = useRef(lim); limRef.current = lim

  // mărimea containerului; încadrarea la schimbarea imaginii și la redimensionare cât timp utilizatorul n-a mișcat vederea
  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const masoara = () => { const r = el.getBoundingClientRect(); setDim(d => (d.cw === r.width && d.ch === r.height ? d : { cw: r.width, ch: r.height })) }
    masoara()
    if (typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(masoara)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // altă imagine (chiar cu aceleași dimensiuni): transformarea și gesturile vechi nu se păstrează
  useEffect(() => {
    atins.current = false; pointeri.current.clear(); gest.current = null; ultimTap.current = null
    if (dim.cw > 0 && dim.ch > 0) setV(incadreaza({ w, h }, dim))
  }, [cheieImagine, w, h]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!atins.current && dim.cw > 0 && dim.ch > 0) setV(fit) }, [fit, dim])

  // rotița (desktop): ascultător nativ, ne-pasiv, ca pagina să nu deruleze
  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const roata = e => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      atins.current = true
      setV(x => zoomLa(x, Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top, limRef.current))
    }
    el.addEventListener('wheel', roata, { passive: false })
    return () => el.removeEventListener('wheel', roata)
  }, [])

  const local = e => { const r = ref.current.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top } }
  const pornesteGest = () => {
    const p = [...pointeri.current.values()]
    if (p.length >= 2) gest.current = { tip: 'pinch', d0: Math.max(1, distanta(p[0], p[1])), m0: mijloc(p[0], p[1]), v0: vRef.current }
    else if (p.length === 1) gest.current = { ...(gest.current || {}), tip: 'pan', s: p[0], v0: vRef.current, mutat: gest.current?.tip === 'pinch' || gest.current?.mutat }
    else gest.current = null
  }
  const onPointerDown = e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    ref.current.setPointerCapture?.(e.pointerId)
    pointeri.current.set(e.pointerId, local(e))
    const unul = pointeri.current.size === 1
    pornesteGest()
    if (unul) gest.current = { ...gest.current, mutat: false, t: Date.now() }
  }
  const onPointerMove = e => {
    if (!pointeri.current.has(e.pointerId)) return
    pointeri.current.set(e.pointerId, local(e))
    const g = gest.current
    if (!g) return
    const p = [...pointeri.current.values()]
    if (g.tip === 'pinch' && p.length >= 2) {
      const m = mijloc(p[0], p[1])
      const z = zoomLa(g.v0, distanta(p[0], p[1]) / g.d0, g.m0.x, g.m0.y, limRef.current)
      seteaza({ scale: z.scale, tx: z.tx + (m.x - g.m0.x), ty: z.ty + (m.y - g.m0.y) })
    } else if (g.tip === 'pan') {
      const dx = p[0].x - g.s.x, dy = p[0].y - g.s.y
      if (!g.mutat && Math.hypot(dx, dy) > 6) g.mutat = true
      if (g.mutat) seteaza({ ...g.v0, tx: g.v0.tx + dx, ty: g.v0.ty + dy })
    }
  }
  const onPointerUp = e => {
    if (!pointeri.current.has(e.pointerId)) return
    const poz = pointeri.current.get(e.pointerId)
    pointeri.current.delete(e.pointerId)
    const g = gest.current
    if (pointeri.current.size > 0) { pornesteGest(); return }
    gest.current = null
    if (!g || g.tip !== 'pan' || g.mutat || e.type === 'pointercancel') return
    // atingerea: punctul cel mai apropiat de deget, în raza țintei (~46 px); la suprapunere câștigă cel mai apropiat
    const tinta = celMaiAproape(puncteEcran, poz.x, poz.y)
    if (tinta) { onSelect?.(tinta.cheie); return }
    // dublu-tap / dublu-click pe fundal = zoom ×2 în punctul atins
    const acum = Date.now(), u = ultimTap.current
    if (u && acum - u.t < 320 && Math.hypot(u.x - poz.x, u.y - poz.y) < 30) {
      ultimTap.current = null
      seteaza(x => zoomLa(x, 2, poz.x, poz.y, limRef.current))
    } else ultimTap.current = { t: acum, x: poz.x, y: poz.y }
  }
  const zoomButon = f => seteaza(x => zoomLa(x, f, dim.cw / 2, dim.ch / 2, lim))
  // înălțimea: după proporția imaginii (o vedere lată nu lasă gol mare pe telefon), între 320 px și 72% din ecran
  const inaltimeAuto = dim.cw > 0 && w > 0 ? Math.round(Math.max(320, Math.min((typeof window !== 'undefined' ? window.innerHeight : 800) * 0.72, (dim.cw * h) / w + 16))) : 320
  const etichete = v.scale >= fit.scale * 2.2
  // pozițiile de ecran ale grupurilor vizibile (aceleași pentru desen și pentru atingere)
  const puncteEcran = (grupuri || []).map(gr => ({ cheie: gr.cheie, gr, ...ecranDinPct(gr.x_pct, gr.y_pct, { w, h }, v) }))
    .filter(p => p.x >= -RAZA_ATINGERE && p.y >= -RAZA_ATINGERE && p.x <= dim.cw + RAZA_ATINGERE && p.y <= dim.ch + RAZA_ATINGERE)

  return (
    <div ref={ref} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
      style={{ position: 'relative', height: inaltime || inaltimeAuto, minHeight: 320, overflow: 'hidden', background: '#FFFFFF', borderRadius: 12, border: `1px solid ${G.border}`, touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none', cursor: gest.current?.mutat ? 'grabbing' : 'grab' }}>
      {/* imaginea are mărimea de încadrare (CSS), zoom-ul e doar transform: stratul rămâne mic și pe planșele mari (ex. 5012 px) */}
      {imagineUrl && fit.scale > 0 && <img src={imagineUrl} alt="" draggable={false} decoding="async" onError={onEroareImagine}
        style={{ position: 'absolute', left: 0, top: 0, width: w * fit.scale, height: h * fit.scale, maxWidth: 'none', transformOrigin: '0 0',
          transform: `translate(${v.tx}px, ${v.ty}px) scale(${v.scale / fit.scale})`, pointerEvents: 'none' }} />}
      {puncteEcran.map(p => {
        const gr = p.gr
        const n = gr.puncte.length, r = n > 1 ? R + 3 : R
        const s = gr.puncte[0].sudura
        const sel = gr.puncte.some(x => String(x.sudura.id) === String(selectatId))
        const textNegru = n === 1 && (s.stare === 'insailat' || !esteStare(s.stare))
        return (
          <div key={gr.cheie} data-grup={gr.cheie} title={n > 1 ? `${n} suduri în același punct` : `${s.cod} · ${ETICHETE[s.stare] || s.stare}`}
            style={{ position: 'absolute', left: p.x - r, top: p.y - r, width: 2 * r, height: 2 * r, borderRadius: '50%', background: n > 1 ? fundalGrup(gr) : culoareStare(s.stare),
              border: `${n > 1 ? 3 : 2}px ${n > 1 ? 'double' : 'solid'} ${sel ? '#000' : '#FFFFFF'}`, boxShadow: sel ? '0 0 0 3px #000' : '0 1px 3px rgba(0,0,0,.55)', boxSizing: 'border-box',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: n > 1 ? 12 : 10, fontWeight: 800, color: textNegru ? '#000' : '#FFF',
              textShadow: n > 1 ? '0 0 3px #000' : 'none', textDecoration: n === 1 && s.stare === 'anulat' ? 'line-through' : 'none', cursor: 'pointer', zIndex: sel ? 3 : 2,
              pointerEvents: 'none' }}>
            {n > 1 ? `×${n}` : nrCod(s.cod)}
            {etichete && <span style={{ position: 'absolute', left: 2 * r + 2, top: r - 8, fontSize: 11, fontWeight: 700, color: '#111', background: '#FFFFFFCC', padding: '0 3px', borderRadius: 4, whiteSpace: 'nowrap', textDecoration: 'none', textShadow: 'none' }}>
              {n > 1 ? `${s.cod} … (${n})` : s.cod}</span>}
          </div>
        )
      })}
      <div style={{ position: 'absolute', right: 8, bottom: 8, display: 'flex', flexDirection: 'column', gap: 6, zIndex: 4 }} onPointerDown={e => e.stopPropagation()}>
        <button onClick={() => zoomButon(1.6)} style={{ ...S.btn, width: 44, height: 44, padding: 0, fontSize: 22 }} aria-label="Mărește">+</button>
        <button onClick={() => zoomButon(1 / 1.6)} style={{ ...S.btn, width: 44, height: 44, padding: 0, fontSize: 22 }} aria-label="Micșorează">−</button>
        <button onClick={() => { atins.current = false; setV(fit) }} style={{ ...S.btn, height: 44, padding: '0 10px', fontSize: 13 }}>⤢ Încadrează</button>
      </div>
    </div>
  )
}

// Atingerea care deschide o fișă / o listă generează după ea un „click” în același loc, care ar cădea pe butonul de dedesubt
// (ex. o stare nouă sau prima sudură din listă). Click-urile din primele 450 ms după deschidere se ignoră. Folosită și de NodConstructii.jsx.
export function useGardaAtingere(cheie) {
  const deschisLa = useRef(0)
  useLayoutEffect(() => { deschisLa.current = Date.now() }, [cheie])
  return e => { if (Date.now() - deschisLa.current < 450) { e.stopPropagation(); e.preventDefault() } }
}

// ── fișa sudurii + schimbarea stării ──
export function FisaSudura({ sudura: s, poateScrie, azi, sudorSesiune, onSudorSesiune, onSalveaza, onInchide, busy, mesaj }) {
  const [tinta, setTinta] = useState(null)
  const [data, setData] = useState(azi)
  const [buletin, setBuletin] = useState('')
  const [motiv, setMotiv] = useState('')
  useEffect(() => { setTinta(null); setData(azi); setBuletin(''); setMotiv('') }, [s?.id, s?.versiune, azi])
  const paza = useGardaAtingere(s?.id)
  if (!s) return null
  const urm = stariUrmatoare(s.stare)
  const erori = tinta ? valideazaMarcare({ stareVeche: s.stare, stareNoua: tinta, data, azi, dataStare: s.data_stare, sudor: sudorSesiune, buletin, motiv }) : []
  const rand = (et, val) => (
    <div style={{ display: 'flex', gap: 8, padding: '5px 0', borderBottom: `1px solid ${G.border2}`, fontSize: 14 }}>
      <span style={{ color: G.muted, width: 110, flexShrink: 0 }}>{et}</span><span style={{ color: G.text, minWidth: 0, overflowWrap: 'anywhere' }}>{val || '—'}</span>
    </div>
  )
  return (
    <div onClick={onInchide} onClickCapture={paza} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 1000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: G.surface, borderTop: `1px solid ${G.border}`, borderRadius: '16px 16px 0 0', width: '100%', maxWidth: 560, maxHeight: '88vh', overflowY: 'auto', padding: '16px 16px 24px', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <span style={{ width: 18, height: 18, borderRadius: '50%', background: culoareStare(s.stare), border: '2px solid #FFF' }} />
          <span style={{ fontSize: 22, fontWeight: 800, color: G.text }}>{s.cod}</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: culoareStare(s.stare) }}>{ETICHETE[s.stare] || `stare necunoscută (${s.stare})`}</span>
          <button onClick={onInchide} style={{ ...S.btn, marginLeft: 'auto', padding: '4px 12px' }} aria-label="Închide">✕</button>
        </div>
        {rand('Diametru', [s.dn ? `DN${s.dn}` : null, s.diametru].filter(Boolean).join(' · '))}
        {rand('Poziții legate', [s.poz1, s.poz2].filter(Boolean).join('  ↔  '))}
        {rand('Subansamblu', s.subansamblu)}
        {rand('Certitudine', s.certitudine === 'sigur' ? 'sigur' : s.certitudine === 'posibil' ? 'posibilă — de confirmat' : 'de confirmat (izometrica de execuție)')}
        {rand('Sudor', s.sudor)}
        {rand('Data sudării', fmtZi(s.data_sudare))}
        {rand('Buletin NDT', s.buletin_ndt)}
        {rand('Pe schemă', s.vedere ? [`${s.vedere} (principală${s.pozitie_certitudine ? ', ' + s.pozitie_certitudine.replace(/_/g, ' ') : ''})`,
          ...(Array.isArray(s.pozitii_secundare) ? s.pozitii_secundare.map(p => p.vedere) : [])].join(' · ') : 'fără punct')}
        {rand('Ultima schimbare', s.data_stare ? `${fmtZi(s.data_stare)}${s.motiv ? ' · ' + s.motiv : ''}` : '')}

        {poateScrie && urm.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div style={S.label}>Schimbă starea</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
              {urm.map(n => (
                <button key={n} onClick={() => setTinta(t => (t === n ? null : n))}
                  style={{ ...S.btn, minHeight: 48, background: tinta === n ? culoareStare(n) : G.surface2, color: tinta === n && n !== 'insailat' ? '#FFF' : tinta === n ? '#000' : G.text, borderColor: culoareStare(n) }}>
                  {ETICHETE[n]}
                </button>
              ))}
            </div>
            {tinta && (
              <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
                <div><label style={S.label}>Data</label>
                  <input type="date" value={data} min={scadeZile(azi, ZILE_INAPOI)} max={azi} onChange={e => setData(e.target.value)} style={S.input} /></div>
                {(cereSudor(tinta) || tinta === 'insailat') && (
                  <div><label style={S.label}>Sudor (nume / poanson){cereSudor(tinta) ? ' — obligatoriu' : ' — opțional'}; rămâne ales până închizi pagina</label>
                    <input value={sudorSesiune} maxLength={80} onChange={e => onSudorSesiune(e.target.value)} style={S.input} placeholder="ex. POPESCU ION / P-12" /></div>
                )}
                {cereBuletin(tinta) && <div><label style={S.label}>Cod buletin NDT</label>
                  <input value={buletin} maxLength={80} onChange={e => setBuletin(e.target.value)} style={S.input} placeholder="ex. RT-0123" /></div>}
                {cereMotiv(tinta) && <div><label style={S.label}>{tinta === 'reparat' ? 'Defectul / de ce se repară' : 'Motivul anulării'}</label>
                  <input value={motiv} maxLength={500} onChange={e => setMotiv(e.target.value)} style={S.input} /></div>}
                {erori.length > 0 && <div style={{ fontSize: 12, color: G.yellow }}>{erori.join(' · ')}</div>}
                <button disabled={busy || erori.length > 0}
                  onClick={() => onSalveaza({ stareNoua: tinta, data, sudor: sudorSesiune, buletin, motiv })}
                  style={{ ...S.btn, minHeight: 52, fontSize: 16, background: erori.length ? G.border : G.green, color: erori.length ? G.muted : '#0D1117', border: 'none', opacity: busy ? 0.6 : 1 }}>
                  {busy ? 'Se salvează…' : `✓ Confirmă: ${s.cod} → ${ETICHETE[tinta]}`}
                </button>
              </div>
            )}
          </div>
        )}
        {!poateScrie && <div style={{ marginTop: 12, fontSize: 12, color: G.dim }}>Doar citire: schimbarea stării cere drept de scriere pe Execuție.</div>}
        {mesaj && <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 10, fontSize: 13, fontWeight: 600, background: (mesaj.ok ? G.green : G.red) + '22', color: mesaj.ok ? G.green : G.red }}>{mesaj.text}</div>}
      </div>
    </div>
  )
}

// ── filtrele de pe vedere: stările și DN-ul ──
export function FiltreNod({ stari, setStari, dn, setDn, dnuri }) {
  const comuta = s => setStari(x => (x.includes(s) ? x.filter(y => y !== s) : [...x, s]))
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
      {STARI.map(s => (
        <button key={s} onClick={() => comuta(s)} style={S.chip(stari.includes(s), culoareStare(s))}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: culoareStare(s) }} />{ETICHETE[s]}
        </button>
      ))}
      <select value={dn} onChange={e => setDn(e.target.value)} style={{ ...S.input, width: 'auto', padding: '5px 8px', fontSize: 13 }}>
        <option value="">Toate DN</option>
        {dnuri.map(d => <option key={d} value={d}>DN{d}</option>)}
      </select>
      {(stari.length > 0 || dn !== '') && <button onClick={() => { setStari([]); setDn('') }} style={{ ...S.chip(false, G.muted) }}>✕ filtre</button>}
    </div>
  )
}

// ── lista unui punct de grup (mai multe suduri cu aceleași coordonate, ex. „fără poziție pe planșă”) ──
// Aceeași listă servește și pentru „Suduri fără punct pe schemă” (titlu dat de pagină).
export function ListaGrup({ grup, onAlege, onInchide, titlu = null }) {
  const paza = useGardaAtingere(grup?.cheie)
  if (!grup) return null
  return (
    <div onClick={onInchide} onClickCapture={paza} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 1000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: G.surface, borderTop: `1px solid ${G.border}`, borderRadius: '16px 16px 0 0', width: '100%', maxWidth: 560, maxHeight: '80vh', overflowY: 'auto', padding: '14px 14px 22px', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 17, fontWeight: 800, color: G.text }}>{titlu || `${grup.puncte.length} suduri în același punct`}</span>
          <button onClick={onInchide} style={{ ...S.btn, marginLeft: 'auto', padding: '4px 12px' }} aria-label="Închide">✕</button>
        </div>
        {!titlu && grup.puncte.some(p => p.certitudine === 'fara_pozitie_pe_plansa') && <div style={{ fontSize: 12, color: G.muted, marginBottom: 8 }}>Planșa nu le dă o poziție proprie: punctul arată doar zona.</div>}
        {grup.puncte.map(({ sudura: s }) => (
          <button key={s.id} onClick={() => onAlege(s.id)} style={{ ...S.btn, width: '100%', display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, minHeight: 46, textAlign: 'left' }}>
            <span style={{ width: 16, height: 16, borderRadius: '50%', background: culoareStare(s.stare), border: '2px solid #FFF', flexShrink: 0 }} />
            <b style={{ whiteSpace: 'nowrap' }}>{s.cod}</b>
            <span style={{ color: G.muted, fontSize: 12, whiteSpace: 'nowrap' }}>{s.dn ? `DN${s.dn} · ` : ''}{ETICHETE[s.stare] || s.stare}</span>
            <span style={{ color: G.dim, fontSize: 11, marginLeft: 'auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '45%' }}>{[s.poz1, s.poz2].filter(Boolean).join(' ↔ ')}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
