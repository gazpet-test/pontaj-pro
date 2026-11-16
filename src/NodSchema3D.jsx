// ═══════════════════════════════════════════════════════════════════════════
// NodSchema3D.jsx — schema 3D (probă) a unui grup din nodul de cuplare: țevi / coturi / robinete simplificate, colorate pe DN,
// și sudurile ca sfere colorate după stare (aceeași legendă ca în 2D). Rotire / zoom cu degetele (OrbitControls), atingerea
// unei sfere = onSelect(cheie) — pagina deschide aceeași fișă / listă ca pe vederile 2D (logica de bifare NU e aici).
// Three.js se încarcă DOAR aici, prin import dinamic (fișier separat la build; pagina principală nu crește).
// Randare la cerere (la mișcare / schimbare), nu în buclă continuă: nu consumă bateria cât ecranul stă.
// L24: încărcarea are generația ei (o încărcare întârziată nu se aplică pe alt grup sau după demontare); totul se eliberează la ieșire.
// Vederea „Toată instalația” (grup.parti, varianta B): fiecare grup e o parte a scenei (ascunde / arată, „du-mă la”), etichetele
// de tip `eticheta` se ascund dintr-un buton; piesele se lipesc pe material (câteva apeluri de desenare, nu sute).
// Datele vin de la NodCuplareSchema.jsx; aici nu se citește și nu se scrie nimic în BD.
// Armături (16.11.2026): betonul (cutii semitransparente cu muchii, se poate ascunde), barele ca tuburi cu diametrul REAL și
// îndoirile rotunjite (pe mărci: ascundere, culoare pe marcă sau pe diametru), piesele înglobate (buloane, plăci) separat;
// sub scenă legenda pe mărci, starea listei, punctele de confirmat și rândul de control „greutate desenată față de extras”.
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useRef, useState } from 'react'
import { G, S } from './NodCuplareVizualizare.jsx'
import { celMaiAproape, RAZA_ATINGERE } from './nodCuplareLogica.js'
import { culoarePunct3d, culoareDn, dnuriGrup, diametruExterior, razaSfera, cutieGrup, spreScena, esteAtingere, gestNou, gestMisca, puncteVizibile, departareCamera, puncteElement } from './nodSchema3dLogica.js'
import { continutArmare, panouriArmare, cheieMarca, traseuBara, culoareMarca, culoareDiametru, DENSITATE_OTEL, PRAG_CONTROL_PROC } from './nodSchema3dArmare.js'

export default function NodSchema3D({ grup, puncte, selectatId, onSelect }) {
  const gazda = useRef(null)
  const scena = useRef(null)          // { aplicaPuncte, incadreaza, teren, dispose }
  const laSelect = useRef(onSelect)
  laSelect.current = onSelect
  const [stare, setStare] = useState('incarc')   // incarc | gata | eroare | fara_webgl
  const [eroare, setEroare] = useState('')
  const [incercare, setIncercare] = useState(0)
  const [teren, setTeren] = useState(true)
  // vederea comună („Toată instalația”, grup.parti): grupuri ascunse și etichetele de tip `eticheta`; pagina remontează
  // componenta la schimbarea vederii (key), deci aceste stări pornesc curate pe fiecare vedere
  const [ascunse, setAscunse] = useState(() => new Set())
  const [etichete, setEtichete] = useState(true)
  const comun = Array.isArray(grup?.parti)
  const areEtichete = comun && grup.elemente.some(e => e.tip === 'eticheta')
  const vizibile = useMemo(() => puncteVizibile(puncte || [], ascunse), [puncte, ascunse])
  // armături: un panou (starea listei, mărcile, controlul) pe fiecare grup cu armare — și în „Toată instalația”, unde blocul
  // `armare` stă pe părți (review r2: altfel avertismentul „neconfirmată” dispărea în vederea comună); ce se vede și culoarea.
  // Mărcile ascunse se țin pe cheia grup + marcă (cheieMarca), separat de sub-grupurile interne ale scenei (beton, piese).
  const panouri = useMemo(() => panouriArmare(grup), [grup])
  const cont = useMemo(() => continutArmare(grup), [grup])
  const areArmare = cont.bare + cont.beton + cont.buloane + cont.placi > 0
  const [ascunseMarci, setAscunseMarci] = useState(() => new Set())
  const [beton, setBeton] = useState(true)
  const [inglobate, setInglobate] = useState(true)
  const [culoareArm, setCuloareArm] = useState('marca')     // marca | diametru

  // ── încărcarea Three.js + scena statică a grupului ──
  useEffect(() => {
    let viu = true
    setStare('incarc'); setEroare('')
    ;(async () => {
      let THREE, OrbitControls
      try {
        THREE = await import('./nodSchema3dThree.js')
        OrbitControls = THREE.OrbitControls
      } catch (e) {
        if (viu) { setEroare(e?.message || String(e)); setStare('eroare') }
        return
      }
      if (!viu || !gazda.current) return
      let s
      try { s = construiesteScena(THREE, OrbitControls, gazda.current, grup, k => laSelect.current?.(k)) }
      catch (e) {
        if (!viu) return
        if (e?.webgl) setStare('fara_webgl')
        else { setEroare(e?.message || String(e)); setStare('eroare') }
        return
      }
      if (!viu) { s.dispose(); return }
      scena.current = s
      setStare('gata')
    })()
    return () => { viu = false; scena.current?.dispose(); scena.current = null }
  }, [grup, incercare])

  // ── sferele sudurilor: se refac la orice schimbare de stare / filtru / selecție, fără să reconstruiască țevile ──
  useEffect(() => { if (stare === 'gata') scena.current?.aplicaPuncte(vizibile, selectatId) }, [vizibile, selectatId, stare])
  useEffect(() => { if (stare === 'gata') scena.current?.teren(teren) }, [teren, stare])
  useEffect(() => { if (stare === 'gata') scena.current?.etichete(etichete) }, [etichete, stare])
  useEffect(() => { if (stare === 'gata') scena.current?.ascunde(ascunse) }, [ascunse, stare])
  useEffect(() => {
    if (stare === 'gata' && areArmare) scena.current?.armare({ ascunseMarci, beton, inglobate, culoare: culoareArm })
  }, [ascunseMarci, beton, inglobate, culoareArm, stare, areArmare])
  const comuta = id => setAscunse(a => { const n = new Set(a); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const comutaMarca = m => setAscunseMarci(a => { const n = new Set(a); if (n.has(m)) n.delete(m); else n.add(m); return n })
  // „du-mă la” un grup ascuns îl arată întâi (altfel camera ar merge la un loc gol)
  const mergiLa = id => {
    if (ascunse.has(id)) { const n = new Set(ascunse); n.delete(id); setAscunse(n); scena.current?.ascunde(n) }
    scena.current?.mergiLa(id)
  }

  const dnuri = dnuriGrup(grup)
  return (
    <div>
      <div style={{ position: 'relative', width: '100%', height: 'min(64vh, 620px)', minHeight: 300, background: G.bg, border: `1px solid ${G.border}`, borderRadius: 12, overflow: 'hidden' }}>
        <div ref={gazda} style={{ position: 'absolute', inset: 0 }} />
        {stare === 'incarc' && <Mesaj text="Se încarcă schema 3D…" />}
        {stare === 'fara_webgl' && <Mesaj text="Acest browser nu poate afișa 3D (WebGL indisponibil). Folosește vederile 2D." />}
        {stare === 'eroare' && (
          <Mesaj text={`Schema 3D nu s-a putut încărca${eroare ? ` (${eroare})` : ''}.`}>
            <button onClick={() => setIncercare(x => x + 1)} style={{ ...S.btn, marginTop: 10 }}>Reîncearcă</button>
          </Mesaj>
        )}
        {stare === 'gata' && (
          <div style={{ position: 'absolute', right: 8, bottom: 8, display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {cont.beton > 0 && (
              <button onClick={() => setBeton(x => !x)} title="Arată / ascunde betonul" aria-pressed={beton}
                style={{ ...S.btn, height: 44, padding: '0 10px', fontSize: 13, background: beton ? G.surface2 : G.bg }}>{beton ? '🧱 Beton' : '▢ Fără beton'}</button>
            )}
            {cont.buloane + cont.placi > 0 && (
              <button onClick={() => setInglobate(x => !x)} title="Arată / ascunde piesele înglobate (buloane, plăci)" aria-pressed={inglobate}
                style={{ ...S.btn, height: 44, padding: '0 10px', fontSize: 13, background: inglobate ? G.surface2 : G.bg }}>{inglobate ? '🔩 Piese' : '▢ Fără piese'}</button>
            )}
            {cont.bare > 0 && (
              <button onClick={() => setCuloareArm(x => (x === 'marca' ? 'diametru' : 'marca'))} title="Culoarea barelor: pe marcă sau pe diametru"
                style={{ ...S.btn, height: 44, padding: '0 10px', fontSize: 13 }}>{culoareArm === 'marca' ? '🎨 Pe marcă' : '🎨 Pe diametru'}</button>
            )}
            {areEtichete && (
              <button onClick={() => setEtichete(x => !x)} title="Arată / ascunde etichetele din schemă"
                style={{ ...S.btn, height: 44, padding: '0 10px', fontSize: 13, background: etichete ? G.surface2 : G.bg }}>{etichete ? '🏷 Etichete' : '🏷 Fără etichete'}</button>
            )}
            <button onClick={() => setTeren(x => !x)} style={{ ...S.btn, height: 44, padding: '0 10px', fontSize: 13, background: teren ? G.surface2 : G.bg }}>{teren ? '▦ Teren' : '▢ Teren'}</button>
            <button onClick={() => scena.current?.incadreaza()} style={{ ...S.btn, height: 44, padding: '0 10px', fontSize: 13 }}>⤢ Încadrează</button>
          </div>
        )}
      </div>
      {comun && stare === 'gata' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
          {grup.parti.map(p => {
            const vizibil = !ascunse.has(p.id)
            return (
              <span key={p.id} style={{ display: 'inline-flex', border: `1px solid ${G.border}`, borderRadius: 10, overflow: 'hidden', opacity: vizibil ? 1 : 0.6 }}>
                <button onClick={() => comuta(p.id)} title={vizibil ? 'Ascunde grupul' : 'Arată grupul'} aria-pressed={vizibil}
                  style={{ ...S.btn, minHeight: 44, padding: '0 10px', fontSize: 13, border: 'none', borderRadius: 0, background: vizibil ? G.surface2 : G.bg }}>
                  {vizibil ? '👁' : '🚫'} {p.titlu}
                </button>
                <button onClick={() => mergiLa(p.id)} title={`Camera pe ${p.titlu}`}
                  style={{ ...S.btn, minHeight: 44, padding: '0 10px', fontSize: 13, border: 'none', borderLeft: `1px solid ${G.border}`, borderRadius: 0 }}>
                  ⤢ Du-mă la
                </button>
              </span>
            )
          })}
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6, fontSize: 11, color: G.muted, alignItems: 'center' }}>
        {(dnuri.length > 0 || !areArmare) && <span>Țevi:</span>}
        {dnuri.map(d => (
          <span key={d} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 16, height: 6, borderRadius: 3, background: culoareDn(d) }} />DN{d}
          </span>
        ))}
        <span style={{ color: G.dim }}>{dnuri.length > 0 || !areArmare ? '· ' : ''}mai deschis = estimat · un deget rotește, două degete zoom</span>
      </div>
      {panouri.map(p => (
        <PanouArmare key={p.id} parteId={p.id} titlu={comun ? p.titlu : null} ctrl={p.ctrl} cont={p.cont}
          ascunse={ascunseMarci} comuta={comutaMarca} culoare={culoareArm} />
      ))}
    </div>
  )
}

// ── legenda armăturii: starea listei, punctele de confirmat, mărcile (ascundere), controlul față de extras ──
// Un panou pe grup (în „Toată instalația”, câte unul pe fiecare grup cu armare, cu titlul grupului). Avertismentul, punctele de
// confirmat, mărcile „estimate” și controlul NU depind de mărcile ascunse sau de culoare (doar opacitatea rândului / culoarea mostrei).
const nr = (v, z = 2) => (Number.isFinite(v) ? v.toLocaleString('ro-RO', { minimumFractionDigits: z, maximumFractionDigits: z }) : '—')
const semn = v => (v > 0 ? '+' : v < 0 ? '−' : '') + nr(Math.abs(v))
export function PanouArmare({ ctrl, cont, ascunse, comuta, culoare, parteId, titlu }) {
  const th = { textAlign: 'right', padding: '4px 6px', color: G.muted, fontWeight: 600, whiteSpace: 'nowrap' }
  const td = { textAlign: 'right', padding: '4px 6px', whiteSpace: 'nowrap' }
  const rau = { color: G.red, fontWeight: 700 }
  const lungimeDesen = m => (m.lungimeMin == null ? '—' : Math.round(m.lungimeMin) === Math.round(m.lungimeMax) ? nr(m.lungimeMin, 0) : `${nr(m.lungimeMin, 0)}…${nr(m.lungimeMax, 0)}`)
  const totalExtras = ctrl ? `${ctrl.bucExtras}${ctrl.bucExtrasNecunoscut ? ' + ?' : ''}` : ''
  return (
    <div data-panou-armare={parteId || ''} style={{ marginTop: 8, background: G.surface, border: `1px solid ${G.border2}`, borderRadius: 12, padding: '10px 12px', fontSize: 13, color: G.text }}>
      {titlu && <div style={{ fontWeight: 800, marginBottom: 6 }}>{titlu}</div>}
      {ctrl?.stareLista === 'neconfirmata' && (
        <div role="alert" style={{ border: `1px solid ${G.yellow}`, background: G.yellow + '22', borderRadius: 10, padding: '8px 10px', marginBottom: 8 }}>
          <div style={{ fontWeight: 800, color: G.yellow }}>⚠ Listă de armături NECONFIRMATĂ DE OM</div>
          <div style={{ fontSize: 12, color: G.muted, marginTop: 2 }}>Nu se folosește la debitare sau comandă până nu e verificată pe planșă.</div>
          {ctrl.deConfirmat.length > 0 && (
            <details open style={{ marginTop: 6 }}>
              <summary style={{ cursor: 'pointer', fontWeight: 700, minHeight: 32, display: 'flex', alignItems: 'center' }}>De confirmat ({ctrl.deConfirmat.length})</summary>
              <ol style={{ margin: '4px 0 0', paddingLeft: 20, fontSize: 12, lineHeight: 1.45 }}>
                {ctrl.deConfirmat.map((x, i) => <li key={i}>{x}</li>)}
              </ol>
            </details>
          )}
        </div>
      )}
      {ctrl?.stareLista === 'confirmata' && <div style={{ fontSize: 12, color: G.green, marginBottom: 6, fontWeight: 700 }}>✓ Listă de armături confirmată</div>}
      {ctrl && ctrl.marci.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${G.border}` }}>
                <th style={{ ...th, textAlign: 'left' }}>Marca</th><th style={th}>Ø</th><th style={{ ...th, textAlign: 'left' }}>Oțel</th>
                <th style={th}>Buc. desen / extras</th><th style={th}>L extras (mm)</th><th style={th}>L desen (mm)</th><th style={th}>kg desen</th>
              </tr>
            </thead>
            <tbody>
              {ctrl.marci.map(m => {
                const cheie = cheieMarca(parteId, m.marca)
                const vizibil = !ascunse?.has(cheie)
                return (
                  <tr key={m.marca} style={{ borderBottom: `1px solid ${G.border2}`, opacity: vizibil ? 1 : 0.55 }}>
                    <td style={{ ...td, textAlign: 'left' }}>
                      <button onClick={() => comuta?.(cheie)} aria-pressed={vizibil} title={(vizibil ? 'Ascunde' : 'Arată') + ` marca ${m.marca}` + (m.forma ? ` — ${m.forma}` : '')}
                        style={{ ...S.btn, minHeight: 36, padding: '0 8px', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6, background: vizibil ? G.surface2 : G.bg }}>
                        {vizibil ? '👁' : '🚫'}
                        <span style={{ width: 16, height: 6, borderRadius: 3, background: culoare === 'diametru' ? m.culoareD : m.culoare }} />
                        <b>{m.marca}</b>
                      </button>
                      {m.estimate > 0 && <span style={{ color: G.yellow, marginLeft: 6 }}>{m.estimate} estimate</span>}
                      {m.bucDesen === 0 && <span style={{ ...rau, marginLeft: 6 }}>fără bare</span>}
                    </td>
                    <td style={td}>{m.d}</td>
                    <td style={{ ...td, textAlign: 'left' }}>{m.otel}</td>
                    <td style={{ ...td, ...(m.bucOk ? {} : rau) }}>{m.bucDesen} / {m.bucExtras}</td>
                    <td style={td}>{nr(m.lungimeExtras, 0)}</td>
                    <td style={{ ...td, ...(m.lungimeOk ? {} : rau) }}>{lungimeDesen(m)}</td>
                    <td style={td}>{nr(m.kgDesen)}</td>
                  </tr>
                )
              })}
              <tr>
                <td style={{ ...td, textAlign: 'left', fontWeight: 700 }} colSpan={3}>Total</td>
                <td data-total-bucati style={{ ...td, fontWeight: 700, ...(ctrl.complet ? {} : rau) }}>{ctrl.bucDesen} / {totalExtras}</td>
                <td style={td} colSpan={2} />
                <td style={{ ...td, fontWeight: 700 }}>{nr(ctrl.kgDesen)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {/* rândul de control apare mereu când grupul are armare: fără greutatea din extras scrie „extras necunoscut” (nu lipsește, nu 0);
          verde doar cu greutatea în prag ȘI controlul complet (nicio marcă respinsă / fără bare, bucățile egale cu extrasul) */}
      {ctrl && (
        <div data-control-extras style={{ marginTop: 8, fontWeight: 700, color: ctrl.extrasKg == null ? G.yellow : ctrl.controlOk ? G.green : G.red }}>
          {ctrl.extrasKg == null
            ? `Greutate desenată ${nr(ctrl.kgDesen)} kg · extras necunoscut (modelul nu are greutatea totală din extras), control nefăcut`
            : `Greutate desenată ${nr(ctrl.kgDesen)} kg față de extras ${nr(ctrl.extrasKg)} kg (${semn(ctrl.diferentaProc)}%)` +
              (ctrl.greutateOk ? (ctrl.complet ? ' ✓' : '') : ` — peste ±${PRAG_CONTROL_PROC}%, de verificat`)}
        </div>
      )}
      {ctrl && !ctrl.complet && (
        <div data-control-incomplet role="alert" style={{ marginTop: 4, fontWeight: 700, color: G.red }}>
          ⚠ Control INCOMPLET: {ctrl.motiveIncomplet.join('; ')}.
        </div>
      )}
      {ctrl && (
        <div data-nota-greutate style={{ fontSize: 11, color: G.dim, marginTop: 4 }}>
          Lungimea desenată e măsurată ca în extras (laturile pe exterior); greutatea = lungime × {DENSITATE_OTEL} kg/m³ × secțiunea barei.
          Greutatea urmează convenția laturilor din extras, nu lungimea dezvoltată pe axa barei: e o verificare față de extras, nu masa fizică exactă.
          {ctrl.extrasSursa ? ` Extras: ${ctrl.extrasSursa}.` : ''}
        </div>
      )}
      {cont.beton > 0 && (
        <div style={{ fontSize: 12, color: G.muted, marginTop: 6 }}>
          Beton: {cont.numeBeton.length ? cont.numeBeton.join(' · ') : `${cont.beton} blocuri`}{cont.betonEstimat ? ' (unele estimate)' : ''}
        </div>
      )}
      {cont.buloane + cont.placi > 0 && (
        <div style={{ fontSize: 12, color: G.muted, marginTop: 4 }}>
          Piese înglobate (nu sunt armătură): {cont.buloane > 0 ? `${cont.buloane} buloane${cont.diametreBuloane.length ? ' Ø' + cont.diametreBuloane.join('/Ø') : ''}` : ''}
          {cont.buloane > 0 && cont.placi > 0 ? ', ' : ''}{cont.placi > 0 ? `${cont.placi} plăci` : ''}
          {cont.inglobateEstimate > 0 && <span style={{ color: G.yellow }}> · poziție estimată: {cont.inglobateEstimate}</span>}
        </div>
      )}
    </div>
  )
}

function Mesaj({ text, children }) {
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20, textAlign: 'center', color: G.muted, fontSize: 14 }}>
      <div>{text}</div>{children}
    </div>
  )
}

// ═══════════ scena (Three.js) — fără React; exportată doar pentru testul eliberării resurselor ═══════════
export function construiesteScena(THREE, OrbitControls, gazda, grup, onSelect) {
  let renderer
  try { renderer = new THREE.WebGLRenderer({ antialias: true }) } catch (e) { const x = new Error('WebGL indisponibil'); x.webgl = true; throw x }
  const canvas = renderer.domElement
  // Registrul eliberărilor (review r2 / r3): fiecare resursă își pune eliberarea aici IMEDIAT după ce e creată — rendererul primul,
  // înaintea oricărei configurări (setPixelRatio apelează intern setSize și poate arunca). La ieșire sau dacă construcția pică la
  // jumătate, se eliberează tot ce s-a apucat, în ordine inversă (o eliberare care pică nu le oprește pe celelalte).
  const eliberari = [() => { renderer.dispose(); renderer.forceContextLoss?.(); canvas.remove() }]
  const elibereaza = () => {
    while (eliberari.length) {
      const f = eliberari.pop()
      try { f() } catch { /* restul se eliberează oricum */ }
    }
  }
  try {
    if (!renderer.getContext()) { const x = new Error('WebGL indisponibil'); x.webgl = true; throw x }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setClearColor(G.bg)
    canvas.style.display = 'block'; canvas.style.width = '100%'; canvas.style.height = '100%'; canvas.style.touchAction = 'none'
    gazda.appendChild(canvas)
    const scene = new THREE.Scene()
    eliberari.push(() => scene.traverse(o => {
      o.geometry?.dispose?.()
      const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []
      for (const m of ms) { m.map?.dispose?.(); m.dispose?.() }
    }))
    scene.add(new THREE.AmbientLight(0xffffff, 0.55))
    scene.add(new THREE.HemisphereLight(0xdde6f0, 0x2a2118, 0.5))
    const soare = new THREE.DirectionalLight(0xffffff, 1.1)
    soare.position.set(8, 14, 10)
    scene.add(soare)

    const V = p => new THREE.Vector3(...spreScena(p))
    const mm = x => x / 1000
    const materiale = new Map()
    eliberari.push(() => { for (const m of materiale.values()) m.dispose() })
    const mat = (culoare, estimat, extra = {}) => {
      const k = `${culoare}|${estimat ? 1 : 0}|${JSON.stringify(extra)}`
      if (!materiale.has(k)) {
        materiale.set(k, new THREE.MeshStandardMaterial({ color: culoare, metalness: 0.25, roughness: 0.55, transparent: estimat || extra.opacity != null,
          opacity: extra.opacity ?? (estimat ? 0.42 : 1), depthWrite: !(estimat || extra.opacity != null) }))
      }
      return materiale.get(k)
    }
    // Părțile scenei: în vederea pe grup una singură (grupul); în „Toată instalația” câte una pe grup (ascundere / „du-mă la”).
    // Fiecare parte = un THREE.Group cu piesele ei + un sub-grup cu etichetele de tip `eticheta` (butonul „Etichete”).
    const parti = new Map()
    let parte = null                   // partea în construcție
    const sus = new THREE.Vector3(0, 1, 0)
    // piesele nu intră direct în scenă: se strâng pe material și se lipesc la final într-o singură plasă pe material și parte
    // (sute de piese = câteva apeluri de desenare; contează pe telefon). Atingerea nu folosește plasele (vezi „atingerea”).
    // `tinta` (armături): sub-grupul care se ascunde împreună (o marcă, betonul, piesele înglobate); fără ea = partea însăși.
    // Materialele din sub-grupuri sunt doar ale lor (cheie / instanță separată), deci o plasă lipită nu amestecă ținte.
    const adauga = (mesh, tinta) => {
      if (!parte.piese.has(mesh.material)) parte.piese.set(mesh.material, [])
      parte.piese.get(mesh.material).push(mesh)
      if (tinta) parte.tinte.set(mesh.material, tinta)
      return mesh
    }
    eliberari.push(() => { for (const p of parti.values()) for (const l of p.piese.values()) for (const x of l) x.geometry.dispose() })
    const cilindru = (a, b, r1, r2, m, tinta, laturi = 18) => {
      const va = V(a), vb = V(b), d = vb.clone().sub(va), L = d.length()
      if (L < 1e-4) return null
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r2, r1, L, laturi, 1), m)
      mesh.position.copy(va).addScaledVector(d, 0.5)
      mesh.quaternion.setFromUnitVectors(sus, d.normalize())
      return adauga(mesh, tinta)
    }
    const lipeste = p => {
      for (const [m, l] of p.piese) {
        const tinta = p.tinte.get(m) || p.obiect
        for (const x of l) { x.updateMatrix(); x.geometry.applyMatrix4(x.matrix); x.position.set(0, 0, 0); x.quaternion.identity(); x.scale.set(1, 1, 1) }
        const unit = l.length > 1 && THREE.mergeGeometries ? THREE.mergeGeometries(l.map(x => x.geometry), false) : null
        if (unit) {
          tinta.add(new THREE.Mesh(unit, m))
          for (const x of l) x.geometry.dispose()
        } else for (const x of l) tinta.add(x)              // nu s-au putut lipi: piesele merg separat (același aspect)
      }
      p.piese.clear()
    }

    // ── armături, beton, piese înglobate (create doar dacă grupul le are: modelele vechi rămân identice) ──
    // Două funcții separate (review r2): sub-grupurile interne (betonul, piesele înglobate) au identitatea lor, iar mărcile stau în
    // `parte.marci` după textul mărcii — o marcă scrisă „beton” sau „inglobate” rămâne marcă (grupul „marca:beton”), nu intră în beton.
    const subGrupIntern = cheie => {               // cheie = 'beton' | 'inglobate' (doar din cod, niciodată din model)
      if (!parte[cheie]) { parte[cheie] = new THREE.Group(); parte[cheie].name = cheie; parte.obiect.add(parte[cheie]) }
      return parte[cheie]
    }
    const subGrupMarca = marca => {
      if (!parte.marci.has(marca)) { const g = new THREE.Group(); g.name = `marca:${marca}`; parte.obiect.add(g); parte.marci.set(marca, g) }
      return parte.marci.get(marca)
    }
    // materialele barelor: câte unul pe parte + marcă + certitudine (culoarea se schimbă pe loc: pe marcă / pe diametru)
    const materialeBare = new Map()          // cheie -> { m, marca, diametru }
    eliberari.push(() => { for (const x of materialeBare.values()) x.m.dispose() })
    const matBara = (marca, d, est) => {
      const k = `${parte.id}|${marca}|${est ? 1 : 0}`
      if (!materialeBare.has(k)) {
        const i = (parte.armare?.marci || []).findIndex(x => x.marca === marca)
        const cMarca = i >= 0 ? culoareMarca(i) : '#9E9E9E', cD = culoareDiametru(d)
        materialeBare.set(k, { marca: cMarca, diametru: cD, m: new THREE.MeshStandardMaterial({ color: cMarca, metalness: 0.35, roughness: 0.5,
          transparent: est, opacity: est ? 0.42 : 1, depthWrite: !est }) })
      }
      return materialeBare.get(k).m
    }
    const matLinie = est => {
      const k = `linie|${est ? 1 : 0}`
      if (!materiale.has(k)) materiale.set(k, new THREE.LineBasicMaterial({ color: '#C8C8BE', transparent: true, opacity: est ? 0.35 : 0.75, depthWrite: false }))
      return materiale.get(k)
    }
    const rad = g => (g * Math.PI) / 180
    // o bară / un bulon: tuburi pe traseul în ax (îndoirile deja rotunjite); sferă doar la colțurile ascuțite (rază 0)
    const tub = (pts, raza, m, tinta) => {
      for (let i = 1; i < pts.length; i++) cilindru(pts[i - 1], pts[i], raza, raza, m, tinta, 10)
      for (let i = 1; i < pts.length - 1; i++) {
        const a = V(pts[i]).sub(V(pts[i - 1])).normalize(), b = V(pts[i + 1]).sub(V(pts[i])).normalize()
        if (a.dot(b) < Math.cos(rad(20))) {
          const s = new THREE.Mesh(new THREE.SphereGeometry(raza, 10, 6), m)
          s.position.copy(V(pts[i]))
          adauga(s, tinta)
        }
      }
    }
    const pieseArmare = e => {
      const est = e.cert === 'estimat'
      if (e.tip === 'bara') tub(traseuBara(e.puncte, e.r), mm(e.d) / 2, matBara(e.marca, e.d, est), subGrupMarca(e.marca))
      else if (e.tip === 'bulon') tub(traseuBara(e.puncte, e.r), mm(e.d) / 2, mat('#7B6BA8', est, { piesa: 1 }), subGrupIntern('inglobate'))
      else if (e.tip === 'placa') {
        const x = e.lx / 2, y = e.ly / 2
        const forma = new THREE.Shape([new THREE.Vector2(-x, -y), new THREE.Vector2(x, -y), new THREE.Vector2(x, y), new THREE.Vector2(-x, y)])
        if (e.gol) { const gol = new THREE.Path(); gol.absarc(0, 0, e.gol / 2, 0, Math.PI * 2, true); forma.holes.push(gol) }
        const geo = new THREE.ExtrudeGeometry(forma, { depth: e.grosime, bevelEnabled: false, curveSegments: 24 })
        geo.rotateX(-Math.PI / 2)            // (x, y, z) model -> (x, z, -y) scenă, ca spreScena
        geo.scale(0.001, 0.001, 0.001)
        const placa = new THREE.Mesh(geo, mat('#55606B', est, { piesa: 1 }))
        placa.position.copy(V(e.centru))       // centrul feței de jos
        placa.rotation.y = rad(e.rotZ)
        adauga(placa, subGrupIntern('inglobate'))
      } else if (e.tip === 'beton') {
        const g = subGrupIntern('beton')
        const geo = new THREE.BoxGeometry(mm(e.dim[0]), mm(e.dim[2]), mm(e.dim[1]))
        const muchii = new THREE.LineSegments(new THREE.EdgesGeometry(geo), matLinie(est))
        const bloc = new THREE.Mesh(geo, mat('#A3A39B', false, { opacity: est ? 0.08 : 0.16, beton: 1 }))
        for (const o of [bloc, muchii]) { o.position.copy(V(e.centru)); o.rotation.y = rad(e.rotZ) }
        g.add(muchii)                          // muchiile nu se lipesc (alt tip de obiect); sunt puține
        adauga(bloc, g)
      }
    }
    const eticheta = (text, p, inaltime, inGrupEtichete = false) => {
      const c = document.createElement('canvas')
      const ctx = c.getContext('2d')
      if (!ctx) return
      const font = 'bold 44px system-ui, sans-serif'
      ctx.font = font
      const w = Math.ceil(ctx.measureText(text).width) + 28
      c.width = w; c.height = 64
      ctx.font = font
      ctx.fillStyle = 'rgba(13,17,23,0.78)'
      ctx.fillRect(0, 0, w, 64)
      ctx.fillStyle = '#E6EDF3'
      ctx.textBaseline = 'middle'
      ctx.fillText(text, 14, 34)
      const tex = new THREE.CanvasTexture(c)
      tex.colorSpace = THREE.SRGBColorSpace
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }))
      sp.renderOrder = 10
      sp.position.copy(V(p))
      sp.scale.set(inaltime * (w / 64), inaltime, 1)
      ;(inGrupEtichete ? parte.etichete : parte.obiect).add(sp)
    }

    // mărimea grupului: etichetele și încadrarea se raportează la ea (un grup mic nu primește etichete uriașe)
    const cutie = cutieGrup(grup) || { min: [-1000, -1000, -1000], max: [1000, 1000, 1000], centru: [0, 0, 0], marime: 2000 }
    const hEt = Math.min(Math.max(mm(cutie.marime) * 0.012, 0.05), 0.3)

    // ── o piesă (în partea în construcție) ──
    const piesa = e => {
      const est = e.cert === 'estimat'
      const r = e.dn ? mm(diametruExterior(e.dn)) / 2 : 0
      const m = e.dn ? mat(culoareDn(e.dn), est) : null
      switch (e.tip) {
        case 'teava': case 'stut': cilindru(e.a, e.b, r, r, m); break
        case 'flansa': cilindru(e.a, e.b, r * 1.75, r * 1.75, m); break
        case 'reductie': cilindru(e.a, e.b, r, mm(diametruExterior(e.dn2)) / 2, m); break
        case 'cot': {
          const curba = new THREE.QuadraticBezierCurve3(V(e.a), V(e.c), V(e.b))
          adauga(new THREE.Mesh(new THREE.TubeGeometry(curba, 12, r, 14, false), m))
          break
        }
        case 'teu': {
          cilindru(e.a, e.b, r, r, m)
          const c = [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2, (e.a[2] + e.b[2]) / 2]
          const r2 = e.dn2 ? mm(diametruExterior(e.dn2)) / 2 : r
          cilindru(c, e.r, r2, r2, e.dn2 ? mat(culoareDn(e.dn2), est) : m)
          break
        }
        case 'robinet': {
          const corp = mat('#C9D1D9', est)
          cilindru(e.a, e.b, r * 1.3, r * 1.3, corp)
          const c = V([(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2, (e.a[2] + e.b[2]) / 2])
          const bila = new THREE.Mesh(new THREE.SphereGeometry(r * 1.6, 18, 12), corp)
          bila.position.copy(c)
          adauga(bila)
          if (e.et) eticheta(e.et, [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2, Math.max(e.a[2], e.b[2]) + Math.max(diametruExterior(e.dn) * 1.6, hEt * 900)], hEt * 0.8)
          break
        }
        case 'rezervor': {
          const R = mm(e.d) / 2
          const manta = mat('#AEB7C2', false, { opacity: 0.5 })
          const corp = cilindru(e.a, e.b, R, R, manta)
          if (corp) {
            for (const capat of [e.a, e.b]) {
              const fund = new THREE.Mesh(new THREE.SphereGeometry(R, 24, 14), manta)
              fund.position.copy(V(capat))
              fund.quaternion.copy(corp.quaternion)
              fund.scale.set(1, 0.5, 1)
              adauga(fund)
            }
          }
          break
        }
        case 'eticheta': eticheta(e.text, e.p, hEt, true); break
        case 'bara': case 'bulon': case 'placa': case 'beton': pieseArmare(e); break
        default: break
      }
    }
    // ── piesele, pe părți ──
    const listaParti = grup.parti || [{ id: grup.id, elemente: grup.elemente, suduri: grup.suduri, armare: grup.armare }]
    for (const pg of listaParti) {
      const obiect = new THREE.Group(), etichete = new THREE.Group()
      obiect.add(etichete)
      scene.add(obiect)                // în scenă de la început: dacă ceva pică mai jos, eliberarea (traverse) o găsește
      parte = { id: pg.id, armare: pg.armare || null, obiect, etichete, piese: new Map(), tinte: new Map(), marci: new Map(), beton: null, inglobate: null, puncte: [] }
      parti.set(pg.id, parte)
      for (const e of pg.elemente) for (const p of puncteElement(e)) parte.puncte.push(V(p))
      for (const sd of pg.suduri) parte.puncte.push(V(sd.p))
      for (const e of pg.elemente) piesa(e)
      lipeste(parte)
    }
    parte = null

    // ── terenul: plan translucid la z = teren, cu caroiaj de 1 m (țevile îngropate se văd prin el) ──
    const terenGrup = new THREE.Group()
    if (grup.terenZ != null) {
      const lx = mm(cutie.max[0] - cutie.min[0]) + 4, lz = mm(cutie.max[1] - cutie.min[1]) + 4
      const plan = new THREE.Mesh(new THREE.PlaneGeometry(lx, lz), new THREE.MeshBasicMaterial({ color: 0x6b5a3e, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }))
      plan.rotation.x = -Math.PI / 2
      const c = spreScena([cutie.centru[0], cutie.centru[1], grup.terenZ])
      plan.position.set(...c)
      terenGrup.add(plan)
      const n = Math.ceil(Math.max(lx, lz))
      const grila = new THREE.GridHelper(n, n, 0x8b7355, 0x4a3d2a)
      grila.position.set(c[0], c[1] + 0.002, c[2])
      grila.material.transparent = true
      grila.material.opacity = 0.35
      terenGrup.add(grila)
      scene.add(terenGrup)
    }

    // ── camera + rotirea / zoom-ul ──
    const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 1000)
    // sfera care cuprinde TOT ce e în scenă (piese, rezervoare, etichete, teren; sferele sudurilor stau pe piese, +1 m rezervă):
    // planul îndepărtat se potrivește după ea la fiecare randare (review r1: amplasările depărtate depășeau 1000 m și dispăreau)
    scene.updateMatrixWorld(true)
    const cutieScena = new THREE.Box3().setFromObject(scene)
    for (const p of [...parti.values()].flatMap(x => x.puncte)) cutieScena.expandByPoint(p)
    const sferaScena = cutieScena.isEmpty() ? null : cutieScena.getBoundingSphere(new THREE.Sphere())
    const potrivestePlanuri = () => {
      const far = sferaScena ? departareCamera(camera.position.distanceTo(sferaScena.center), sferaScena.radius + 1) : camera.far
      if (far !== camera.far) { camera.far = far; camera.updateProjectionMatrix() }
    }
    const controale = new OrbitControls(camera, canvas)
    eliberari.push(() => controale.dispose())
    controale.enableDamping = false
    controale.screenSpacePanning = true
    // punctele reale ale pieselor și sudurilor (nu colțurile cutiei, care au mult gol): încadrarea strânsă pe geometrie
    const toatePunctele = [...parti.values()].flatMap(p => p.puncte)
    if (!toatePunctele.length) toatePunctele.push(V(cutie.min), V(cutie.max))
    controale.minDistance = 0.3
    let atins = false                  // după ce omul a rotit / mărit / a ales „du-mă la”, redimensionarea nu mai mută camera
    const laStart = () => { atins = true }
    controale.addEventListener('start', laStart)
    eliberari.push(() => controale.removeEventListener('start', laStart))
    const centruDe = pts => {
      const mn = new THREE.Vector3(Infinity, Infinity, Infinity), mx = new THREE.Vector3(-Infinity, -Infinity, -Infinity)
      for (const c of pts) { mn.min(c); mx.max(c) }
      return mn.add(mx).multiplyScalar(0.5)
    }
    // Încadrarea: toate punctele în câmpul vizual, pe ambele axe ale ecranului. Pe ecran îngust (telefon ținut vertical)
    // privim de-a lungul ansamblului (lungimea lui intră în adâncime), dinspre capătul x mic; pe ecran lat, din lateral (tot dinspre x mic).
    // `id` = un grup („du-mă la”); fără id = grupurile vizibile (toate, dacă niciunul nu e vizibil).
    const incadreaza = id => {
      const f = (camera.aspect < 0.9 ? new THREE.Vector3(-1, 0.9, 0.6) : new THREE.Vector3(-0.55, 0.62, 1)).normalize()
      const dr = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), f).normalize()
      const su = new THREE.Vector3().crossVectors(f, dr)
      const tv = Math.tan((camera.fov * Math.PI) / 360), th = tv * camera.aspect
      const distanta = (pts, centru) => {
        let d = 0.5
        for (const c of pts) {
          const p = c.clone().sub(centru)
          const z = p.dot(f)
          d = Math.max(d, Math.abs(p.dot(dr)) / th + z, Math.abs(p.dot(su)) / tv + z)
        }
        return d * 1.04
      }
      let pts = id != null && parti.has(id) ? parti.get(id).puncte : [...parti.values()].filter(p => p.obiect.visible).flatMap(p => p.puncte)
      if (!pts.length) pts = toatePunctele
      const centru = centruDe(pts), d = distanta(pts, centru)
      camera.position.copy(centru).addScaledVector(f, d)
      controale.target.copy(centru)
      // zoom-ul înapoi trebuie să ajungă până la toată instalația și după un „du-mă la” pe un grup mic
      const centruTot = centruDe(toatePunctele)
      controale.maxDistance = Math.max(d, distanta(toatePunctele, centruTot) + centru.distanceTo(centruTot)) * 3
      controale.update()
      randeaza()
    }

    // ── sferele sudurilor ──
    const sfere = new THREE.Group()
    scene.add(sfere)
    let tinte = []            // [{ cheie, centru: Vector3 }] pentru atingere
    const geomSfera = new Map()
    const sfera = raza => { const k = Math.round(raza); if (!geomSfera.has(k)) geomSfera.set(k, new THREE.SphereGeometry(mm(raza), 18, 12)); return geomSfera.get(k) }
    // materialele sferelor: câte unul pe culoare / certitudine (nu unul pe sferă — sute de suduri în vederea comună); rămân până la ieșire
    const matSfere = new Map()
    const matSfera = (k, fa) => { if (!matSfere.has(k)) matSfere.set(k, fa()); return matSfere.get(k) }
    const golesteSfere = () => { for (const o of [...sfere.children]) sfere.remove(o) }
    eliberari.push(() => { golesteSfere(); for (const g of geomSfera.values()) g.dispose(); for (const m of matSfere.values()) m.dispose() })
    const aplicaPuncte = (lista, selectatId) => {
      golesteSfere()
      tinte = []
      for (const g of lista) {
        const ales = selectatId != null && g.puncte.some(p => String(p.sudura.id) === String(selectatId))
        const culoare = culoarePunct3d(g)
        const raza = razaSfera(g.puncte[0]?.sudura?.dn) * (ales ? 1.5 : 1)
        const c = V(g.p)
        const est = g.cert === 'estimat'
        // conturul (sferă puțin mai mare, întoarsă): închis normal, alb la selecție — sfera se vede pe orice fundal
        const contur = new THREE.Mesh(sfera(raza * 1.22), matSfera(`contur|${ales ? 1 : 0}`, () => new THREE.MeshBasicMaterial({ color: ales ? 0xffffff : 0x0d1117, side: THREE.BackSide })))
        contur.position.copy(c)
        const miez = new THREE.Mesh(sfera(raza), matSfera(`miez|${culoare}|${est ? 1 : 0}`, () => new THREE.MeshStandardMaterial({ color: culoare, emissive: culoare,
          emissiveIntensity: 0.45, metalness: 0, roughness: 0.4, transparent: est, opacity: est ? 0.8 : 1 })))
        miez.position.copy(c)
        sfere.add(contur, miez)
        tinte.push({ cheie: g.cheie, centru: c })
      }
      randeaza()
    }

    // ── atingerea: cea mai apropiată sferă PE ECRAN, în raza de atingere (ca în 2D); rotirea / zoom-ul nu deschid nimic ──
    const apasari = new Map()
    let multi = false, jos = null
    const laJos = ev => {
      apasari.set(ev.pointerId, true)
      if (apasari.size > 1) multi = true
      if (apasari.size === 1) { multi = false; jos = gestNou(ev.clientX, ev.clientY, performance.now()) }
    }
    const laSus = ev => {
      apasari.delete(ev.pointerId)
      if (apasari.size > 0) return
      const atingere = !multi && esteAtingere(jos, { x: ev.clientX, y: ev.clientY, t: performance.now() })
      jos = null
      if (!atingere) return
      const rect = canvas.getBoundingClientRect()
      const x = ev.clientX - rect.left, y = ev.clientY - rect.top
      const proiectate = []
      for (const t of tinte) {
        const p = t.centru.clone().project(camera)
        if (p.z < -1 || p.z > 1) continue                  // în spatele camerei / dincolo de planul îndepărtat
        proiectate.push({ cheie: t.cheie, x: (p.x + 1) / 2 * rect.width, y: (1 - p.y) / 2 * rect.height })
      }
      const ales = celMaiAproape(proiectate, x, y, RAZA_ATINGERE)
      if (ales) onSelect(ales.cheie)
    }
    const laAnulare = ev => { apasari.delete(ev.pointerId); if (!apasari.size) jos = null }
    // depărtarea maximă de start, pe tot gestul: o rotire care se întoarce lângă punctul inițial nu e atingere (review r1, P1)
    const laMiscare = ev => { if (apasari.size === 1 && apasari.has(ev.pointerId)) jos = gestMisca(jos, ev.clientX, ev.clientY) }
    canvas.addEventListener('pointerdown', laJos)
    canvas.addEventListener('pointerup', laSus)
    canvas.addEventListener('pointercancel', laAnulare)
    canvas.addEventListener('pointermove', laMiscare)
    eliberari.push(() => {
      canvas.removeEventListener('pointerdown', laJos)
      canvas.removeEventListener('pointerup', laSus)
      canvas.removeEventListener('pointercancel', laAnulare)
      canvas.removeEventListener('pointermove', laMiscare)
    })

    // ── randare la cerere ──
    let cadru = 0
    function randeaza() {
      potrivestePlanuri()               // imediat (nu în cadru): camera mutată de încadrare / zoom / pan își vede toată scena
      if (cadru) return
      cadru = requestAnimationFrame(() => { cadru = 0; renderer.render(scene, camera) })
    }
    controale.addEventListener('change', randeaza)
    eliberari.push(() => { cancelAnimationFrame(cadru); cadru = 0; controale.removeEventListener('change', randeaza) })
    const redimensioneaza = () => {
      const w = gazda.clientWidth || 1, h = gazda.clientHeight || 1
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      if (!atins) incadreaza()          // ex. rotirea telefonului înainte de prima atingere
      else randeaza()
    }
    const obs = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(redimensioneaza) : null
    eliberari.push(() => obs?.disconnect())
    obs?.observe(gazda)
    redimensioneaza()
    incadreaza()

    return {
      aplicaPuncte,
      incadreaza: () => incadreaza(),
      // „du-mă la”: camera pe grup; după asta redimensionarea nu mai reîncadrează pe tot
      mergiLa: id => { atins = true; incadreaza(id) },
      teren: vizibil => { terenGrup.visible = vizibil; randeaza() },
      etichete: vizibil => { for (const p of parti.values()) p.etichete.visible = vizibil; randeaza() },
      // grupurile ascunse (vederea comună); sferele lor le scoate pagina din lista dată la aplicaPuncte (puncteVizibile)
      ascunde: ascunse => { for (const [id, p] of parti) p.obiect.visible = !ascunse?.has(id); randeaza() },
      // armături: mărcile ascunse (chei grup + marcă, cheieMarca), betonul, piesele înglobate și culoarea barelor (pe marcă / pe diametru)
      armare: ({ ascunseMarci, beton = true, inglobate = true, culoare = 'marca' } = {}) => {
        for (const p of parti.values()) {
          for (const [marca, g] of p.marci) g.visible = !ascunseMarci?.has(cheieMarca(p.id, marca))
          if (p.beton) p.beton.visible = beton
          if (p.inglobate) p.inglobate.visible = inglobate
        }
        for (const x of materialeBare.values()) x.m.color.set(culoare === 'diametru' ? x.diametru : x.marca)
        randeaza()
      },
      dispose: elibereaza,
    }
  } catch (e) {
    elibereaza()                        // scena nu s-a putut construi complet: tot ce s-a apucat se eliberează
    throw e
  }
}

