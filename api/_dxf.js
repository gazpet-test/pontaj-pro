// Citirea geometriei dintr-un fisier DXF — parser propriu, fara dependinte.
//
// DXF e text: perechi de linii (cod de grup, valoare). Ne intereseaza doar ce
// produce cantitati: poliliniile (trasee de conducta) si straturile pe care stau.
//
// Doua capcane, ambele lovite pe desenul de la Manastirea:
// 1. POLYLINE (varianta veche, 3D) NU-si tine punctele in ea — vertecsii vin dupa
//    ea ca entitati VERTEX separate, pana la SEQEND. LWPOLYLINE, in schimb, le are
//    in interior. Trebuie tratate diferit.
// 2. Numele stratului NU spune ce e obiectul: pe desenul verificat, conturele de
//    zona stateau pe un strat numit „PE100 Dn 160", iar traseul real era altundeva.
//    De aceea separam dupa geometrie (deschis = traseu, inchis = contur), nu dupa nume.

const dist2d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1])
const dist3d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], (a[2] || 0) - (b[2] || 0))

function lungime(puncte, in3d) {
  let s = 0
  for (let i = 1; i < puncte.length; i++) s += in3d ? dist3d(puncte[i - 1], puncte[i]) : dist2d(puncte[i - 1], puncte[i])
  return s
}

// Sparge fisierul in entitati: fiecare cod 0 incepe una noua.
function entitati(text) {
  const l = text.split(/\r?\n/)
  const out = []
  let curent = null
  for (let i = 0; i + 1 < l.length; i += 2) {
    const cod = parseInt(l[i].trim(), 10)
    const val = l[i + 1]
    if (Number.isNaN(cod)) continue
    if (cod === 0) {
      if (curent) out.push(curent)
      curent = { tip: (val || '').trim(), campuri: [] }
    } else if (curent) {
      curent.campuri.push([cod, val])
    }
  }
  if (curent) out.push(curent)
  return out
}

const primul = (e, cod, implicit = null) => {
  const g = e.campuri.find((c) => c[0] === cod)
  return g ? g[1].trim() : implicit
}
const numar = (e, cod, implicit = 0) => {
  const v = primul(e, cod)
  const n = v == null ? NaN : parseFloat(v)
  return Number.isFinite(n) ? n : implicit
}

// Punctele unei LWPOLYLINE: perechi 10/20 in ordine, cu o cota comuna (38).
function puncteLw(e) {
  const pts = []
  let x = null
  const z = numar(e, 38, 0)
  for (const [cod, val] of e.campuri) {
    if (cod === 10) x = parseFloat(val)
    else if (cod === 20 && x !== null) { pts.push([x, parseFloat(val), z]); x = null }
  }
  return pts
}

export function citesteDxf(text) {
  const ents = entitati(text)
  const trasee = []
  const contururi = []
  const straturi = new Set()
  const texte = []

  for (let i = 0; i < ents.length; i++) {
    const e = ents[i]
    const strat = primul(e, 8, '0')

    if (e.tip === 'LWPOLYLINE') {
      straturi.add(strat)
      const pts = puncteLw(e)
      if (pts.length < 2) continue
      const inchis = (numar(e, 70, 0) & 1) === 1
      const rand = {
        tip: 'LWPOLYLINE', strat, noduri: pts.length, inchis,
        lungime_2d_m: +lungime(pts, false).toFixed(2),
        lungime_3d_m: +lungime(pts, true).toFixed(2),
      }
      ;(inchis ? contururi : trasee).push(rand)
    } else if (e.tip === 'POLYLINE') {
      straturi.add(strat)
      // vertecsii urmeaza ca entitati separate, pana la SEQEND
      const pts = []
      let j = i + 1
      for (; j < ents.length && ents[j].tip !== 'SEQEND'; j++) {
        if (ents[j].tip !== 'VERTEX') continue
        pts.push([numar(ents[j], 10), numar(ents[j], 20), numar(ents[j], 30)])
      }
      i = j
      if (pts.length < 2) continue
      const inchis = (numar(e, 70, 0) & 1) === 1
      const zs = pts.map((p) => p[2])
      const rand = {
        tip: 'POLYLINE_3D', strat, noduri: pts.length, inchis,
        lungime_2d_m: +lungime(pts, false).toFixed(2),
        lungime_3d_m: +lungime(pts, true).toFixed(2),
        z_min: +Math.min(...zs).toFixed(3), z_max: +Math.max(...zs).toFixed(3),
      }
      ;(inchis ? contururi : trasee).push(rand)
    } else if (e.tip === 'TEXT' || e.tip === 'MTEXT') {
      const t = (primul(e, 1, '') || '').trim()
      if (t) texte.push({ text: t.slice(0, 120), x: numar(e, 10), y: numar(e, 20), strat })
    }
  }

  trasee.sort((a, b) => b.lungime_3d_m - a.lungime_3d_m)
  contururi.sort((a, b) => b.lungime_2d_m - a.lungime_2d_m)

  // O conducta pozata urmeaza terenul, deci are cote care variaza; planimetria
  // (limite cadastrale, contururi de zona) e desenata plat, la cota zero. Separarea
  // asta conteaza: pe desenul de la Manastirea, adunarea tuturor poliliniilor deschise
  // dadea 38.032 m in loc de 35.620 m, fiindca includea si doua linii de cadastru.
  for (const t of trasee) t.are_cote = t.z_min !== undefined && t.z_max !== t.z_min
  const cuCote = trasee.filter((t) => t.are_cote)
  const plate = trasee.filter((t) => !t.are_cote)
  const suma = (l, camp) => +l.reduce((s, x) => s + x[camp], 0).toFixed(2)

  return {
    straturi: [...straturi].sort(),
    trasee, contururi,
    texte: texte.slice(0, 400),
    sumar: {
      // candidatele de traseu tehnic — de aici ies cantitatile
      cu_cote: { numar: cuCote.length, lungime_3d_m: suma(cuCote, 'lungime_3d_m'), lungime_2d_m: suma(cuCote, 'lungime_2d_m') },
      // linii plate: de regula planimetrie, nu conducta
      plate: { numar: plate.length, lungime_2d_m: suma(plate, 'lungime_2d_m') },
      contururi_inchise: { numar: contururi.length, perimetru_m: suma(contururi, 'lungime_2d_m') },
    },
    nota: 'Lungimile sunt in unitatile desenului (de regula metri, Stereo 70). Pentru cantitati se iau traseele CU COTE (conducta urmeaza terenul); poliliniile plate si cele inchise sunt de regula planimetrie, nu conducta — se verifica inainte de a fi luate in deviz.',
  }
}
