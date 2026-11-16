// Regresie (armături, 16.11.2026): modelele în formatul de dinainte trebuie să se citească și să se DESENEZE exact ca înainte.
// Referința (nodSchema3d.regresie.json) a fost calculată cu codul de dinainte de armături (origin/main 66b3b867), pe două modele:
// exemplul din documentație (toate tipurile vechi, două grupuri amplasate, unul la 30°) și o fundație în formatul vechi
// (410 elemente: barele ca țevi, îndoirile ca coturi; două grupuri amplasate). Aici se recalculează cu codul curent și se compară:
// citirea, „Toată instalația”, cutiile, amplasarea și scena (fiecare obiect, geometrie, material, camera după încadrare).
// Review r2: scena rulează pe un DOM fals minim (nodSchema3dDomFals.testutil.js), nu pe jsdom, deci NU mai poate fi sărită;
// iar referința însăși e verificată (intrările așteptate, numărul de grupuri / elemente / scene, amprenta fișierului), ca golirea
// sau tăierea ei să pice testul, nu să lase zero cazuri.
import { describe, it, expect } from 'vitest'
import { construiesteScena } from './NodSchema3D.jsx'
import { parseModel3d, instalatia, cutieGrup, aplicaAmplasare } from './nodSchema3dLogica.js'
import { sha, amprentaScena } from './nodSchema3dAmprenta.testutil.js'
import { mediuScena } from './nodSchema3dDomFals.testutil.js'
import REF from './nodSchema3d.regresie.json'

// mediul scenei: Three.js real, renderer și controale false; ecran 800 × 600 (ca la calculul referinței)
function amprentaGrup(grup) {
  const m = mediuScena({ latime: 800, inaltime: 600 })
  try {
    const s = construiesteScena(m.THREE, m.Controale, m.gazda, grup, () => {})
    const a = amprentaScena(m.scene[0], m.camere[0], m.controale[0].target)
    s.dispose()
    return a
  } finally { m.refa() }
}

// Ce trebuie să conțină referința (scris de mână din modelele de mai sus, nu citit din fișier): cheia, grupurile, elementele pe grup,
// numărul de scene (un grup = o scenă, plus „Toată instalația”) și numărul de obiecte din fiecare scenă.
const ASTEPTAT = {
  exemplu_doc: { grupuri: 3, elemente: [9, 2, 2], scene: [17, 10, 12, 17] },
  fundatie_format_vechi: { grupuri: 2, elemente: [205, 205], scene: [13, 13, 18] },
}
// Amprenta întregului fișier de referință: o schimbare a lui (regenerare) cere și schimbarea acestei linii, explicit, în review.
const SHA_REF = 'a5ccf232ac89a44d683b004ac432d447ec88ee4b8b0d6304bdfe2e09187de231'

describe('regresie: referința însăși e întreagă (nu poate fi golită fără ca testul să pice)', () => {
  it('are exact intrările așteptate, cu toate grupurile, elementele și scenele', () => {
    expect(REF.generat_cu).toMatch(/66b3b867/)
    expect(Object.keys(REF.intrari).sort()).toEqual(Object.keys(ASTEPTAT).sort())
    expect(Object.keys(REF.amprente).sort()).toEqual(Object.keys(ASTEPTAT).sort())
    for (const [k, a] of Object.entries(ASTEPTAT)) {
      expect(REF.intrari[k].grupuri.map(g => g.elemente.length), k).toEqual(a.elemente)
      expect(REF.amprente[k].grupuri, k).toBe(a.grupuri)
      expect(REF.amprente[k].scene.map(s => s.obiecte), k).toEqual(a.scene)
      for (const s of REF.amprente[k].scene) { expect(s.scena).toMatch(/^[0-9a-f]{64}$/); expect(s.camera).toHaveLength(6) }
    }
    expect(sha(REF)).toBe(SHA_REF)
  })
})

describe('regresie: modelele vechi se citesc la fel (referința = codul de dinainte de armături)', () => {
  for (const k of Object.keys(ASTEPTAT)) {
    it(`${k}: citirea, „Toată instalația”, cutiile și amplasarea au aceleași amprente`, () => {
      const ref = REF.amprente[k]
      const p = parseModel3d(structuredClone(REF.intrari[k]))
      expect(p.erori).toHaveLength(ref.erori)
      expect(p.grupuri).toHaveLength(ref.grupuri)
      expect(p.grupuri.some(g => 'armare' in g)).toBe(false)          // grupurile vechi nu primesc câmpuri noi
      expect(sha(p)).toBe(ref.parse)
      const inst = instalatia(p)
      expect(inst ? sha(inst) : null).toBe(ref.instalatie)
      expect(p.grupuri.map(g => sha(cutieGrup(g)))).toEqual(ref.cutii)
      expect(p.grupuri.map(g => sha(aplicaAmplasare(g)))).toEqual(ref.amplasate)
    })
  }
})

describe('regresie: modelele vechi se desenează la fel (DOM fals + Three.js real; nu se sare)', () => {
  for (const k of Object.keys(ASTEPTAT)) {
    it(`${k}: fiecare scenă (pe grup și „Toată instalația”) are aceeași amprentă și aceeași cameră`, () => {
      const p = parseModel3d(structuredClone(REF.intrari[k]))
      const inst = instalatia(p)
      const acum = [...p.grupuri.map(amprentaGrup), ...(inst ? [amprentaGrup(inst)] : [])]
      expect(acum).toHaveLength(ASTEPTAT[k].scene.length)
      expect(acum).toEqual(REF.amprente[k].scene)
    })
  }
})
