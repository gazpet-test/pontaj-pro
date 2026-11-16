// Amprenta unei scene 3D / a unui model citit, pentru testul de regresie (modelele în formatul vechi trebuie să arate EXACT ca
// înainte de armături). Amprentele de referință din nodSchema3d.regresie.json au fost calculate cu codul de dinainte (origin/main
// 66b3b867), cu exact aceste funcții; testul le recalculează cu codul curent și le compară.
import { createHash } from 'node:crypto'

export const sha = x => createHash('sha256').update(typeof x === 'string' ? x : JSON.stringify(x)).digest('hex')

const r6 = v => (Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : String(v))
// camera și ținta se compară direct cu JSON-ul referinței, care nu păstrează semnul lui zero: + 0 face din -0 un 0
// (doar aici; în hash-ul geometriei octeții lui -0 rămân cum au fost la calculul referinței)
const r6z = v => (Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 + 0 : String(v))
const geom = g => {
  if (!g) return null
  const a = g.getAttribute?.('position')
  return {
    tip: g.type,
    n: a ? a.count : 0,
    poz: a ? sha(Buffer.from(Float32Array.from(a.array, r6).buffer)) : null,
    index: g.index ? g.index.count : null,
  }
}
const mat = m => (m ? { tip: m.type, culoare: m.color?.getHexString?.() ?? null, opacitate: r6(m.opacity), transparent: !!m.transparent, depthWrite: !!m.depthWrite, latura: m.side, map: !!m.map } : null)

/** Amprenta scenei: fiecare obiect (în ordinea parcurgerii) cu tipul, vizibilitatea, poziția, rotirea, scara, geometria și materialul. */
export function amprentaScena(scene, camera, tinta) {
  const obiecte = []
  scene.updateMatrixWorld(true)
  scene.traverse(o => {
    obiecte.push({
      tip: o.type, vizibil: o.visible, ordine: o.renderOrder,
      p: o.position.toArray().map(r6), q: o.quaternion.toArray().map(r6), s: o.scale.toArray().map(r6),
      g: geom(o.geometry), m: Array.isArray(o.material) ? o.material.map(mat) : mat(o.material), copii: o.children.length,
    })
  })
  return {
    obiecte: obiecte.length,
    scena: sha(obiecte),
    camera: camera ? [...camera.position.toArray(), camera.near, camera.far, camera.aspect].map(r6z) : null,
    tinta: tinta ? tinta.toArray().map(r6z) : null,
  }
}
