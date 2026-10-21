// ════════════════════════════════════════════════════════════════════════
// IZOMETRIE — citirea KML-ului de traseu + axul + calibrarea km (E1, design v2.3 §1.11, §2.1)
// ════════════════════════════════════════════════════════════════════════
// Funcții pure, fără DOM și fără librării: merg și în browser (ecranul de import din
// Execuție → Tronsoane, E2) și în Node (scriptul de preview din E1).
// KML-urile nu au un format comun (LOT 2: documente tematice din shapefile; LOT 1: un singur
// folder, fără descrieri, liniile deosebite doar prin culoare), deci:
//   • punctele se clasifică după tiparul NUMELUI, nu după folder;
//   • axul îl alege OMUL dintre liniile candidate; funcțiile doar propun și compun;
//   • ce nu se poate clasifica rămâne în preview, fără efect.
// Conținutul KML-ului e dată de prelucrat, nu instrucțiune.
// Fail-closed: un KML stricat, un ax cu goluri sau ancore incoerente aruncă eroare cu motiv,
// nu dau un rezultat aproximativ.

const R_PAMANT = 6371008.8

export class EroareKml extends Error {
  constructor(cod, mesaj) { super(mesaj); this.name = 'EroareKml'; this.cod = cod }
}

// ─── parsare ────────────────────────────────────────────────────────────
const ENT = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }
const decodeaza = s => String(s ?? '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&(?:#(\d+)|#x([0-9a-f]+)|(lt|gt|amp|quot|apos));/gi, (m, dec, hex, nume) => {
    if (dec) return String.fromCodePoint(Number(dec))
    if (hex) return String.fromCodePoint(parseInt(hex, 16))
    return ENT[nume.toLowerCase()]
  })
const tag = (xml, nume) => { const m = xml.match(new RegExp(`<${nume}\\b[^>]*>([\\s\\S]*?)</${nume}>`)); return m ? m[1] : null }

// Strict: fiecare token prezent trebuie să fie „lon,lat[,alt]” numeric, în domeniu. Un token
// stricat NU se sare (A, B-corupt, C ar deveni tăcut A→C și ar schimba lungimea axului).
function parseCoord(txt, unde) {
  const s = String(txt ?? '').trim()
  if (!s) return []
  return s.split(/\s+/).map(t => {
    const p = t.split(',')
    const n = p.map(x => (x.trim() === '' ? NaN : Number(x)))
    if (p.length < 2 || p.length > 3 || !n.every(Number.isFinite)) throw new EroareKml('kml_coordonata', `coordonată invalidă „${t.slice(0, 40)}” în ${unde}`)
    const [lon, lat] = n
    if (Math.abs(lon) > 180 || Math.abs(lat) > 90) throw new EroareKml('kml_coordonata', `coordonată în afara domeniului „${t.slice(0, 40)}” în ${unde}`)
    return [lon, lat]
  })
}

// Stilurile: <Style id> cu culoarea liniei, <StyleMap id> → stilul „normal”.
function parseStiluri(xml) {
  const stil = {}, harta = {}
  for (const m of xml.matchAll(/<Style\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/Style>/g)) {
    const ls = tag(m[2], 'LineStyle')
    stil[m[1]] = { culoare: ls ? (tag(ls, 'color') || '').trim().toLowerCase() : null }
  }
  for (const m of xml.matchAll(/<StyleMap\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/StyleMap>/g)) {
    const p = [...m[2].matchAll(/<Pair>([\s\S]*?)<\/Pair>/g)].map(x => x[1]).find(x => /<key>\s*normal\s*<\/key>/.test(x))
    const u = p && tag(p, 'styleUrl')
    if (u) harta[m[1]] = u.trim().replace(/^#/, '')
  }
  return { stil, harta }
}

/**
 * Citește un KML (text). Întoarce elementele cu: id, nume, cale (folderele/documentele părinte),
 * tip ('punct' | 'linie' | 'poligon' | 'multi' | 'gol'), puncte / linii / poligoane (liste de [lon,lat]),
 * culoare (aabbggrr), date (ExtendedData). Un <MultiGeometry> dă tip 'multi' dacă amestecă geometrii;
 * toate părțile lui sunt păstrate.
 * Aruncă EroareKml pe structură stricată: <Placemark> neînchis, <Folder>/<Document> neînchise.
 * Tag-urile self-closing (<Placemark/>, <Folder/>) se ignoră.
 */
export function parseKml(text) {
  const xml = String(text || '')
  const { stil, harta } = parseStiluri(xml)
  const elemente = []
  const stiva = []
  const re = /<(\/?)(Folder|Document|Placemark)\b([^>]*?)(\/?)>/g
  let m
  while ((m = re.exec(xml))) {
    const [, inchis, tipTag, attrs, selfClosing] = m
    if (selfClosing) continue
    if (tipTag !== 'Placemark') {
      if (inchis) {
        if (!stiva.length) throw new EroareKml('kml_structura', `</${tipTag}> fără deschidere (poziția ${m.index})`)
        const sus = stiva[stiva.length - 1]
        if (sus.tip !== tipTag) throw new EroareKml('kml_structura', `</${tipTag}> închide un <${sus.tip}> „${sus.nume}” (poziția ${m.index})`)
        stiva.pop()
      } else {
        const dupa = xml.slice(re.lastIndex, re.lastIndex + 400)
        const n = dupa.match(/^\s*<name>([\s\S]*?)<\/name>/)
        stiva.push({ tip: tipTag, nume: n ? decodeaza(n[1]).trim() : '' })
      }
      continue
    }
    if (inchis) continue
    const sf = xml.indexOf('</Placemark>', re.lastIndex)
    if (sf < 0) throw new EroareKml('kml_structura', `<Placemark> neînchis (poziția ${m.index})`)
    const corp = xml.slice(re.lastIndex, sf)
    if (/<Placemark\b(?![^>]*\/>)/.test(corp)) throw new EroareKml('kml_structura', `<Placemark> imbricat în alt <Placemark> (poziția ${m.index})`)
    re.lastIndex = sf + '</Placemark>'.length
    const idAttr = (attrs.match(/\bid="([^"]+)"/) || [])[1] || null
    const nume = decodeaza(tag(corp, 'name') || '').replace(/\s+/g, ' ').trim()
    // culoarea: stil inline, apoi styleUrl → StyleMap → Style
    let culoare = null
    const lsInline = tag(corp, 'LineStyle')
    if (lsInline) culoare = (tag(lsInline, 'color') || '').trim().toLowerCase() || null
    if (!culoare) {
      let su = (tag(corp, 'styleUrl') || '').trim().replace(/^#/, '')
      if (harta[su]) su = harta[su]
      culoare = stil[su]?.culoare || null
    }
    const date = {}
    for (const d of corp.matchAll(/<(?:SimpleData|Data)\b[^>]*\bname="([^"]+)"[^>]*>([\s\S]*?)<\/(?:SimpleData|Data)>/g)) {
      const v = d[2].includes('<value>') ? tag(d[2], 'value') : d[2]
      date[d[1]] = decodeaza(v).trim()
    }
    const unde = `Placemark ${idAttr ? `id=${idAttr}` : `„${nume}”`} (poziția ${m.index})`
    const puncte = [], linii = [], poligoane = []
    for (const g of corp.matchAll(/<Point\b[^>]*>([\s\S]*?)<\/Point>/g)) {
      const c = parseCoord(tag(g[1], 'coordinates'), unde)
      if (c.length !== 1) throw new EroareKml('kml_geometrie', `<Point> cu ${c.length} coordonate (trebuie exact 1) în ${unde}`)
      puncte.push(c)
    }
    for (const g of corp.matchAll(/<LineString\b[^>]*>([\s\S]*?)<\/LineString>/g)) {
      const c = parseCoord(tag(g[1], 'coordinates'), unde)
      if (c.length < 2) throw new EroareKml('kml_geometrie', `<LineString> cu ${c.length} coordonate (trebuie ≥ 2) în ${unde}`)
      linii.push(c)
    }
    for (const g of corp.matchAll(/<outerBoundaryIs>([\s\S]*?)<\/outerBoundaryIs>/g)) {
      const c = parseCoord(tag(g[1], 'coordinates'), unde)
      const inchis = c.length >= 4 && c[0][0] === c[c.length - 1][0] && c[0][1] === c[c.length - 1][1]
      if (!inchis) throw new EroareKml('kml_geometrie', `<Polygon> cu inel invalid (${c.length} vârfuri, ${c.length >= 2 ? 'neînchis' : 'prea puține'}) în ${unde}`)
      poligoane.push(c)
    }
    const tipuri = [['punct', puncte], ['linie', linii], ['poligon', poligoane]].filter(([, v]) => v.length).map(([k]) => k)
    const tip = tipuri.length === 1 ? tipuri[0] : (tipuri.length ? 'multi' : 'gol')
    elemente.push({
      idx: elemente.length, id: idAttr, nume, cale: stiva.map(s => s.nume).filter(Boolean).join(' / '), tip, culoare, date,
      multiGeometrie: /<MultiGeometry\b/.test(corp), puncte, linii, poligoane,
    })
  }
  if (stiva.length) throw new EroareKml('kml_structura', `neînchis: ${stiva.map(s => `<${s.tip}> „${s.nume || '(fără nume)'}”`).join(' / ')}`)
  return elemente
}

/**
 * Poziția reprezentativă a unui element punctual: punctul, altfel centrul primului poligon.
 * Întoarce și un avertisment când elementul are mai multe părți (MultiGeometry), ca preview-ul
 * să-l arate explicit, nu să aleagă tacit o parte.
 */
export function pozitieElement(e) {
  const parti = e.puncte.length + e.poligoane.length
  const coord = e.puncte[0]?.[0] || (e.poligoane[0] ? centroid(e.poligoane[0]) : null)
  return { coord, avertisment: parti > 1 || e.tip === 'multi' ? `${e.tip === 'multi' ? 'geometrii amestecate' : `${parti} părți`}: s-a folosit ${e.puncte.length ? 'primul punct' : 'primul poligon'}` : null }
}

// ─── clasificarea punctelor după nume (§1.11) ─────────────────────────────
// Tiparele cer numele întreg sau un prefix permis („DJ 671E TD9”).
export function clasificaNume(numeBrut) {
  const n = String(numeBrut || '').toUpperCase().replace(/\s+/g, ' ').trim()
  let m
  if ((m = n.match(/^(\d{1,3}) ?KM$/))) return { clasa: 'borna', km_m: Number(m[1]) * 1000 }
  if ((m = n.match(/(?:^|\s)TCF ?(\d+)\b/))) return { clasa: 'TCF', nr: Number(m[1]) }
  if ((m = n.match(/(?:^|\s)TD ?(\d+)\b/))) return { clasa: 'TD', nr: Number(m[1]) }
  if ((m = n.match(/(?:^|\s)TA ?(\d+)\b/))) return { clasa: 'TA', nr: Number(m[1]) }
  if ((m = n.match(/(?:^|\s)THC ?(\d*)\b/))) return { clasa: 'THC', nr: m[1] ? Number(m[1]) : null }
  if (/^CF\b/.test(n) && !/KM/.test(n)) return { clasa: 'CF' }
  if ((m = n.match(/^(?:ROBINET )?R ?(\d+)$/))) return { clasa: 'robinet', nr: Number(m[1]) }
  if (/\bSPC ?\d*\b/.test(n)) return { clasa: 'SPC' }
  if (/^(DM\b|DEPOZIT)/.test(n)) return { clasa: 'depozit' }
  if (/^(OS\b|ORGANIZARE DE SANTIER|ORGANIZARE DE ȘANTIER)/.test(n)) return { clasa: 'os' }
  return { clasa: 'altul' }
}

// Diacriticele stricate de exportul LOT 1 („Pruniºor”) se repară DOAR la afișare.
export function reparaDiacritice(s) {
  return String(s || '').replace(/º/g, 'ș').replace(/ª/g, 'Ș').replace(/þ/g, 'ț').replace(/Þ/g, 'Ț').replace(/ã/g, 'ă').replace(/Ã/g, 'Ă')
}

// ─── geometrie ──────────────────────────────────────────────────────────
const rad = d => d * Math.PI / 180
export function haversine([lon1, lat1], [lon2, lat2]) {
  const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R_PAMANT * Math.asin(Math.min(1, Math.sqrt(a)))
}
export function lungimeLinie(c) {
  let s = 0
  for (let i = 1; i < c.length; i++) s += haversine(c[i - 1], c[i])
  return s
}
// Media vârfurilor; la un inel închis (ultimul vârf = primul) vârful dublat nu se numără de două ori.
export function centroid(c) {
  let v = c || []
  if (v.length > 1 && v[0][0] === v[v.length - 1][0] && v[0][1] === v[v.length - 1][1]) v = v.slice(0, -1)
  const n = v.length
  return n ? [v.reduce((a, p) => a + p[0], 0) / n, v.reduce((a, p) => a + p[1], 0) / n] : null
}

// Proiecția unui punct pe polilinie: distanța de la începutul axului (m, pe arc haversine),
// distanța laterală (m) și latura (+1 = stânga în sensul axului, −1 = dreapta).
export function proiecteaza(ax, p, cumul = cumulat(ax)) {
  let best = null
  for (let i = 1; i < ax.length; i++) {
    const a = ax[i - 1], b = ax[i]
    const k = Math.cos(rad((a[1] + b[1]) / 2)) * rad(1) * R_PAMANT, kl = rad(1) * R_PAMANT
    const bx = (b[0] - a[0]) * k, by = (b[1] - a[1]) * kl, px = (p[0] - a[0]) * k, py = (p[1] - a[1]) * kl
    const l2 = bx * bx + by * by
    const t = l2 ? Math.max(0, Math.min(1, (px * bx + py * by) / l2)) : 0
    const dx = px - t * bx, dy = py - t * by
    const d = Math.hypot(dx, dy)
    if (!best || d < best.lateral) {
      best = { lateral: d, dist: cumul[i - 1] + t * (cumul[i] - cumul[i - 1]), latura: Math.sign(bx * py - by * px) || 1, seg: i - 1 }
    }
  }
  return best
}
export function cumulat(ax) {
  const c = [0]
  for (let i = 1; i < ax.length; i++) c.push(c[i - 1] + haversine(ax[i - 1], ax[i]))
  return c
}

// Punctele poliliniei la cel mult `pas_m` unul de altul (vârfurile incluse). Pasul are un minim (0,5 m), iar numărul
// total de puncte o limită: o linie patologic de lungă (sau un pas prea mic) dă EroareKml, nu blochează browserul.
export function esantioneaza(l, pas_m, { max_puncte = 200000 } = {}) {
  if (!l.length) return []
  const pas = Math.max(0.5, Number(pas_m) || 0)
  const total = Math.ceil(lungimeLinie(l) / pas) + l.length
  if (total > max_puncte) throw new EroareKml('esantionare_prea_mare', `eșantionarea ar cere ${total} puncte (maxim ${max_puncte}); linia e prea lungă pentru verificare`)
  const out = [l[0]]
  for (let i = 1; i < l.length; i++) {
    const n = Math.max(1, Math.ceil(haversine(l[i - 1], l[i]) / pas))
    for (let k = 1; k <= n; k++) out.push([l[i - 1][0] + (l[i][0] - l[i - 1][0]) * k / n, l[i - 1][1] + (l[i][1] - l[i - 1][1]) * k / n])
  }
  return out
}

// Taie polilinia la distanța d (m) de la început; întoarce partea [0, d].
function taieLa(ax, d, cumul = cumulat(ax)) {
  const out = [ax[0]]
  for (let i = 1; i < ax.length; i++) {
    if (cumul[i] < d) { out.push(ax[i]); continue }
    const lung = cumul[i] - cumul[i - 1]
    const t = lung > 0 ? (d - cumul[i - 1]) / lung : 0
    out.push([ax[i - 1][0] + t * (ax[i][0] - ax[i - 1][0]), ax[i - 1][1] + t * (ax[i][1] - ax[i - 1][1])])
    break
  }
  return out
}

/**
 * Compune axul din liniile ALESE DE OM, în ordinea dată (fail-closed).
 *   • Orientarea: capătul liniei noi care stă pe axul existent devine începutul ei; dacă niciunul
 *     nu stă pe ax, se ia capătul cel mai apropiat de capătul axului.
 *   • Suprapunerea: dacă începutul liniei noi cade pe ax înainte de capăt, axul se taie acolo,
 *     ca porțiunea comună să nu se numere de două ori (LOT 1: kml_1403 / kml_1381, ~660 m).
 *     O linie cu ambele capete pe ax e conținută în el: nu adaugă nimic.
 *   • Continuitatea: între capătul axului și începutul liniei noi golul trebuie să fie
 *     ≤ `gol_max_m`; altfel EroareKml('ax_discontinuu'), nu un segment inventat.
 */
export function compuneAx(linii, { toleranta_m = 5, gol_max_m = 10 } = {}) {
  let ax = []
  const jurnal = []
  for (let li = 0; li < linii.length; li++) {
    const l0 = linii[li]
    if (!l0 || l0.length < 2) throw new EroareKml('ax_linie_goala', `linia ${li + 1} a axului are mai puțin de 2 vârfuri`)
    let l = l0.slice()
    if (!ax.length) { ax = l; jurnal.push({ linie: li + 1, adaugat_m: lungimeLinie(l), taiat_m: 0 }); continue }
    let cum = cumulat(ax)
    const lungAx = cum[cum.length - 1]
    let p0 = proiecteaza(ax, l[0], cum), p1 = proiecteaza(ax, l[l.length - 1], cum)
    const peAx0 = p0.lateral < toleranta_m, peAx1 = p1.lateral < toleranta_m
    if (peAx0 && peAx1) {
      // „conținută” doar dacă TOATE vârfurile stau pe ax; o ocolire care pleacă și revine
      // pe ax nu se aruncă tăcut — traseul e ambiguu, îl decide omul
      // se verifică și interiorul segmentelor (pas ≤ toleranța), nu doar vârfurile: o coardă
      // între două vârfuri de pe ax poate tăia un cot al axului la sute de metri de el
      const iese = esantioneaza(l, Math.max(0.5, Math.min(toleranta_m, 5))).map(v => proiecteaza(ax, v, cum).lateral).reduce((a, b) => Math.max(a, b), 0)
      if (iese >= toleranta_m) throw new EroareKml('ax_ocolire', `linia ${li + 1} a axului pleacă de pe ax și revine pe el (se depărtează până la ${Math.round(iese)} m): alege explicit varianta de traseu`)
      jurnal.push({ linie: li + 1, adaugat_m: 0, taiat_m: 0, nota: 'conținută în ax' })
      continue
    }
    if (peAx1 && !peAx0) { l.reverse(); [p0, p1] = [p1, p0] }
    else if (!peAx0 && !peAx1) {
      const capat = ax[ax.length - 1]
      if (haversine(capat, l[l.length - 1]) < haversine(capat, l[0])) { l.reverse(); [p0, p1] = [p1, p0] }
    }
    let taiat = 0
    if (p0.lateral < toleranta_m && p0.dist < lungAx - toleranta_m) {
      taiat = lungAx - p0.dist
      ax = taieLa(ax, p0.dist, cum)
    }
    const gol = haversine(ax[ax.length - 1], l[0])
    if (gol > gol_max_m) throw new EroareKml('ax_discontinuu', `între linia ${li} și linia ${li + 1} a axului e un gol de ${Math.round(gol)} m (maxim ${gol_max_m} m)`)
    // vârfurile de început ale liniei noi care stau deja pe ax nu se repetă
    while (l.length > 1 && haversine(ax[ax.length - 1], l[0]) < 0.01) l.shift()
    ax = ax.concat(l)
    jurnal.push({ linie: li + 1, adaugat_m: lungimeLinie(l0), taiat_m: taiat, gol_m: gol })
  }
  return { ax, lungime_m: lungimeLinie(ax), jurnal }
}

/** Orientează axul în sensul km crescător, după borne (ancore cu km cunoscut). */
export function orienteazaDupaBorne(ax, borne) {
  if (borne.length < 2) return ax
  const cum = cumulat(ax)
  const p = borne.map(b => ({ km: b.km_m, d: proiecteaza(ax, b.coord, cum).dist })).sort((a, b) => a.km - b.km)
  return p[p.length - 1].d < p[0].d ? ax.slice().reverse() : ax
}

/**
 * Bornele din KML sunt adesea ETICHETE de text puse lângă ax; poziția exactă e punctul în care
 * liniuța de km (linie scurtă) taie axul. Pentru fiecare bornă se caută liniuțele care taie axul
 * (≤ toleranta_m) și au un vârf la ≤ raza_m de etichetă; se ia cea mai apropiată.
 * Fără liniuță rămâne eticheta. O liniuță aleasă pentru două borne → EroareKml (fail-closed).
 */
export function ancoreDinLiniute(borne, linii, ax, { raza_m = 300, lungime_max_m = 1000, pas_m = 2, toleranta_m = 3 } = {}) {
  const cum = cumulat(ax)
  const scurte = linii.filter(l => l.length >= 2 && lungimeLinie(l) <= lungime_max_m)
  const taiere = l => {
    let best = null
    for (let i = 1; i < l.length; i++) {
      const n = Math.max(1, Math.ceil(haversine(l[i - 1], l[i]) / pas_m))
      for (let k = 0; k <= n; k++) {
        const p = [l[i - 1][0] + (l[i][0] - l[i - 1][0]) * k / n, l[i - 1][1] + (l[i][1] - l[i - 1][1]) * k / n]
        const pr = proiecteaza(ax, p, cum)
        if (!best || pr.lateral < best.lateral) best = { p, lateral: pr.lateral }
      }
    }
    return best
  }
  const cache = new Map()
  const taiereCache = l => { if (!cache.has(l)) cache.set(l, taiere(l)); return cache.get(l) }
  const folosite = new Map()
  const rez = borne.map(b => {
    const cand = scurte.filter(l => l.some(v => haversine(v, b.coord) <= raza_m)).map(l => ({ l, t: taiereCache(l) })).filter(c => c.t.lateral <= toleranta_m)
    if (!cand.length) return { ...b, sursa_ancora: 'eticheta' }
    const best = cand.reduce((x, y) => (haversine(y.t.p, b.coord) < haversine(x.t.p, b.coord) ? y : x))
    if (folosite.has(best.l)) throw new EroareKml('ancora_dubla', `aceeași liniuță de km e cea mai apropiată pentru bornele ${folosite.get(best.l)} și ${b.km_m}`)
    folosite.set(best.l, b.km_m)
    return { ...b, coord: best.t.p, sursa_ancora: 'liniuta' }
  })
  return rez
}

/**
 * Calibrarea km-ului pe ancore [K#20] (fail-closed). ancore: [{ dist, km_m }], dist = distanța pe ax.
 * Validare: cel puțin 2 ancore, distanțe distincte, km strict crescător în sensul axului
 * (axul trebuie orientat înainte); altfel EroareKml.
 * Între două ancore vecine km-ul se interpolează liniar. În afara lor se extrapolează cu panta
 * ancorelor de capăt, dar doar până la `extrapolare_max_m`; dincolo întoarce NaN.
 * Funcția întoarsă are și `.stare(d)` → 'interpolat' | 'extrapolat' | 'in_afara'.
 */
export function calibrare(ancore, { extrapolare_max_m = 500 } = {}) {
  const a = (ancore || []).slice().sort((x, y) => x.dist - y.dist)
  if (a.length < 2) throw new EroareKml('ancore_putine', `calibrarea cere cel puțin 2 ancore (sunt ${a.length})`)
  for (let i = 1; i < a.length; i++) {
    if (!(a[i].dist > a[i - 1].dist)) throw new EroareKml('ancore_dist', `două ancore la aceeași distanță pe ax (${a[i].dist.toFixed(1)} m)`)
    if (!(a[i].km_m > a[i - 1].km_m)) throw new EroareKml('ancore_monoton', `km nu crește în sensul axului: ${a[i - 1].km_m} → ${a[i].km_m}`)
  }
  const prim = a[0].dist, ultim = a[a.length - 1].dist
  const stare = d => (d >= prim && d <= ultim ? 'interpolat' : (d >= prim - extrapolare_max_m && d <= ultim + extrapolare_max_m ? 'extrapolat' : 'in_afara'))
  const f = d => {
    if (stare(d) === 'in_afara') return NaN
    let i = a.findIndex(x => x.dist >= d)
    if (i <= 0) i = i === 0 ? 1 : a.length - 1
    const p = a[i - 1], q = a[i]
    return p.km_m + (d - p.dist) * (q.km_m - p.km_m) / (q.dist - p.dist)
  }
  f.stare = stare
  return f
}

export const fmtKm = m => {
  if (m === null || m === undefined || !Number.isFinite(m)) return '—'
  const s = m < 0 ? '-' : ''
  const r = Math.round(Math.abs(m))
  return `${s}${Math.floor(r / 1000)}+${String(r % 1000).padStart(3, '0')}`
}

/**
 * Tronsonul care conține km-ul (limitele în metri, ca în executie_tronsoane).
 * Capătul de început e inclus, cel de sfârșit nu, cu excepția capătului final al ultimului tronson.
 */
export function tronsonLaKm(km_m, tronsoane) {
  if (!Number.isFinite(km_m)) return null
  const valide = tronsoane.filter(x => x.km_start_m !== null && x.km_end_m !== null)
  const t = valide.find(x => km_m >= x.km_start_m && km_m < x.km_end_m)
  if (t) return t.cod
  const ultim = valide.reduce((x, y) => (!x || y.km_end_m > x.km_end_m ? y : x), null)
  return ultim && km_m === ultim.km_end_m ? ultim.cod : null
}
