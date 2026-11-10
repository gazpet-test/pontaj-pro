// ═══════════════════════════════════════════════════════════════════════════
// NodSchema3D.jsx — schema 3D (probă) a unui grup din nodul de cuplare: țevi / coturi / robinete simplificate, colorate pe DN,
// și sudurile ca sfere colorate după stare (aceeași legendă ca în 2D). Rotire / zoom cu degetele (OrbitControls), atingerea
// unei sfere = onSelect(cheie) — pagina deschide aceeași fișă / listă ca pe vederile 2D (logica de bifare NU e aici).
// Three.js se încarcă DOAR aici, prin import dinamic (fișier separat la build; pagina principală nu crește).
// Randare la cerere (la mișcare / schimbare), nu în buclă continuă: nu consumă bateria cât ecranul stă.
// L24: încărcarea are generația ei (o încărcare întârziată nu se aplică pe alt grup sau după demontare); totul se eliberează la ieșire.
// Datele vin de la NodCuplareSchema.jsx; aici nu se citește și nu se scrie nimic în BD.
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react'
import { G, S } from './NodCuplareVizualizare.jsx'
import { celMaiAproape, RAZA_ATINGERE } from './nodCuplareLogica.js'
import { culoarePunct3d, culoareDn, dnuriGrup, diametruExterior, razaSfera, cutieGrup, spreScena, esteAtingere, gestNou, gestMisca } from './nodSchema3dLogica.js'

export default function NodSchema3D({ grup, puncte, selectatId, onSelect }) {
  const gazda = useRef(null)
  const scena = useRef(null)          // { aplicaPuncte, incadreaza, teren, dispose }
  const laSelect = useRef(onSelect)
  laSelect.current = onSelect
  const [stare, setStare] = useState('incarc')   // incarc | gata | eroare | fara_webgl
  const [eroare, setEroare] = useState('')
  const [incercare, setIncercare] = useState(0)
  const [teren, setTeren] = useState(true)

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
  useEffect(() => { if (stare === 'gata') scena.current?.aplicaPuncte(puncte || [], selectatId) }, [puncte, selectatId, stare])
  useEffect(() => { if (stare === 'gata') scena.current?.teren(teren) }, [teren, stare])

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
          <div style={{ position: 'absolute', right: 8, bottom: 8, display: 'flex', gap: 6 }}>
            <button onClick={() => setTeren(x => !x)} style={{ ...S.btn, height: 44, padding: '0 10px', fontSize: 13, background: teren ? G.surface2 : G.bg }}>{teren ? '▦ Teren' : '▢ Teren'}</button>
            <button onClick={() => scena.current?.incadreaza()} style={{ ...S.btn, height: 44, padding: '0 10px', fontSize: 13 }}>⤢ Încadrează</button>
          </div>
        )}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6, fontSize: 11, color: G.muted, alignItems: 'center' }}>
        <span>Țevi:</span>
        {dnuri.map(d => (
          <span key={d} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 16, height: 6, borderRadius: 3, background: culoareDn(d) }} />DN{d}
          </span>
        ))}
        <span style={{ color: G.dim }}>· mai deschis = estimat · un deget rotește, două degete zoom</span>
      </div>
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
  if (!renderer.getContext()) { renderer.dispose(); const x = new Error('WebGL indisponibil'); x.webgl = true; throw x }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setClearColor(G.bg)
  const canvas = renderer.domElement
  canvas.style.display = 'block'; canvas.style.width = '100%'; canvas.style.height = '100%'; canvas.style.touchAction = 'none'
  gazda.appendChild(canvas)
  // Registrul eliberărilor (review r2): fiecare resursă își pune eliberarea aici IMEDIAT după ce e creată; la ieșire sau dacă
  // construcția pică la jumătate, se eliberează tot ce s-a apucat, în ordine inversă (o eliberare care pică nu le oprește pe celelalte).
  const eliberari = [() => { renderer.dispose(); renderer.forceContextLoss?.(); canvas.remove() }]
  const elibereaza = () => {
    while (eliberari.length) {
      const f = eliberari.pop()
      try { f() } catch { /* restul se eliberează oricum */ }
    }
  }
  try {
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
    const statice = new THREE.Group()
    scene.add(statice)
    const sus = new THREE.Vector3(0, 1, 0)
    const cilindru = (a, b, r1, r2, m) => {
      const va = V(a), vb = V(b), d = vb.clone().sub(va), L = d.length()
      if (L < 1e-4) return null
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r2, r1, L, 18, 1), m)
      mesh.position.copy(va).addScaledVector(d, 0.5)
      mesh.quaternion.setFromUnitVectors(sus, d.normalize())
      statice.add(mesh)
      return mesh
    }
    const eticheta = (text, p, inaltime) => {
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
      statice.add(sp)
    }

    // mărimea grupului: etichetele și încadrarea se raportează la ea (un grup mic nu primește etichete uriașe)
    const cutie = cutieGrup(grup) || { min: [-1000, -1000, -1000], max: [1000, 1000, 1000], centru: [0, 0, 0], marime: 2000 }
    const hEt = Math.min(Math.max(mm(cutie.marime) * 0.012, 0.05), 0.3)

    // ── piesele ──
    for (const e of grup.elemente) {
      const est = e.cert === 'estimat'
      const r = e.dn ? mm(diametruExterior(e.dn)) / 2 : 0
      const m = e.dn ? mat(culoareDn(e.dn), est) : null
      switch (e.tip) {
        case 'teava': case 'stut': cilindru(e.a, e.b, r, r, m); break
        case 'flansa': cilindru(e.a, e.b, r * 1.75, r * 1.75, m); break
        case 'reductie': cilindru(e.a, e.b, r, mm(diametruExterior(e.dn2)) / 2, m); break
        case 'cot': {
          const curba = new THREE.QuadraticBezierCurve3(V(e.a), V(e.c), V(e.b))
          statice.add(new THREE.Mesh(new THREE.TubeGeometry(curba, 12, r, 14, false), m))
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
          statice.add(bila)
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
              statice.add(fund)
            }
          }
          break
        }
        case 'eticheta': eticheta(e.text, e.p, hEt); break
        default: break
      }
    }

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
    const controale = new OrbitControls(camera, canvas)
    eliberari.push(() => controale.dispose())
    controale.enableDamping = false
    controale.screenSpacePanning = true
    const centru = new THREE.Vector3(...spreScena(cutie.centru))
    // punctele reale ale pieselor și sudurilor (nu colțurile cutiei, care au mult gol): încadrarea strânsă pe geometrie
    const colturi = []
    for (const e of grup.elemente) for (const k of ['a', 'b', 'c', 'r', 'p']) if (e[k]) colturi.push(V(e[k]))
    for (const sd of grup.suduri) colturi.push(V(sd.p))
    if (!colturi.length) colturi.push(V(cutie.min), V(cutie.max))
    controale.minDistance = 0.3
    let atins = false                  // după ce omul a rotit / mărit, redimensionarea nu mai mută camera
    controale.addEventListener('start', () => { atins = true })
    // Încadrarea: toate punctele în câmpul vizual, pe ambele axe ale ecranului. Pe ecran îngust (telefon ținut vertical)
    // privim de-a lungul ansamblului (lungimea lui intră în adâncime), dinspre capătul x mic; pe ecran lat, din lateral (tot dinspre x mic).
    const incadreaza = () => {
      const f = (camera.aspect < 0.9 ? new THREE.Vector3(-1, 0.9, 0.6) : new THREE.Vector3(-0.55, 0.62, 1)).normalize()
      const dr = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), f).normalize()
      const su = new THREE.Vector3().crossVectors(f, dr)
      const tv = Math.tan((camera.fov * Math.PI) / 360), th = tv * camera.aspect
      let d = 0.5
      for (const c of colturi) {
        const p = c.clone().sub(centru)
        const z = p.dot(f)
        d = Math.max(d, Math.abs(p.dot(dr)) / th + z, Math.abs(p.dot(su)) / tv + z)
      }
      d *= 1.04
      camera.position.copy(centru).addScaledVector(f, d)
      controale.target.copy(centru)
      controale.maxDistance = d * 3
      controale.update()
      randeaza()
    }

    // ── sferele sudurilor ──
    const sfere = new THREE.Group()
    scene.add(sfere)
    let tinte = []            // [{ cheie, centru: Vector3 }] pentru atingere
    const geomSfera = new Map()
    const sfera = raza => { const k = Math.round(raza); if (!geomSfera.has(k)) geomSfera.set(k, new THREE.SphereGeometry(mm(raza), 18, 12)); return geomSfera.get(k) }
    const golesteSfere = () => {
      for (const o of [...sfere.children]) { sfere.remove(o); o.material?.dispose?.() }
    }
    eliberari.push(() => { golesteSfere(); for (const g of geomSfera.values()) g.dispose() })
    const aplicaPuncte = (lista, selectatId) => {
      golesteSfere()
      tinte = []
      for (const g of lista) {
        const ales = selectatId != null && g.puncte.some(p => String(p.sudura.id) === String(selectatId))
        const culoare = culoarePunct3d(g)
        const raza = razaSfera(g.puncte[0]?.sudura?.dn) * (ales ? 1.5 : 1)
        const c = V(g.p)
        // conturul (sferă puțin mai mare, întoarsă): închis normal, alb la selecție — sfera se vede pe orice fundal
        const contur = new THREE.Mesh(sfera(raza * 1.22), new THREE.MeshBasicMaterial({ color: ales ? 0xffffff : 0x0d1117, side: THREE.BackSide }))
        contur.position.copy(c)
        const miez = new THREE.Mesh(sfera(raza), new THREE.MeshStandardMaterial({ color: culoare, emissive: culoare, emissiveIntensity: 0.45, metalness: 0, roughness: 0.4,
          transparent: g.cert === 'estimat', opacity: g.cert === 'estimat' ? 0.8 : 1 }))
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
      incadreaza,
      teren: vizibil => { terenGrup.visible = vizibil; randeaza() },
      dispose: elibereaza,
    }
  } catch (e) {
    elibereaza()                        // scena nu s-a putut construi complet: tot ce s-a apucat se eliberează
    throw e
  }
}

