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

const R_PAMANT = 6371008.8

// ─── parsare ────────────────────────────────────────────────────────────
const ENT = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&apos;': "'" }
const decodeaza = s => String(s ?? '').replace(/&(lt|gt|amp|quot|apos);/g, m => ENT[m]).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
const tag = (xml, nume) => { const m = xml.match(new RegExp(`<${nume}\\b[^>]*>([\\s\\S]*?)</${nume}>`)); return m ? m[1] : null }

function parseCoord(txt) {
  return String(txt || '').trim().split(/\s+/).map(t => t.split(',').map(Number)).filter(a => a.length >= 2 && a.every(Number.isFinite)).map(([lon, lat]) => [lon, lat])
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
 * tip ('punct' | 'linie' | 'poligon' | 'multi'), parti (liste de [lon,lat]), culoare (aabbggrr), date (ExtendedData).
 */
export function parseKml(text) {
  const xml = String(text || '')
  const { stil, harta } = parseStiluri(xml)
  const elemente = []
  const stiva = []
  const re = /<(\/?)(Folder|Document|Placemark)\b([^>]*)>/g
  let m
  while ((m = re.exec(xml))) {
    const [, inchis, tipTag, attrs] = m
    if (tipTag !== 'Placemark') {
      if (inchis) stiva.pop()
      else {
        const dupa = xml.slice(re.lastIndex, re.lastIndex + 400)
        const n = dupa.match(/^\s*<name>([\s\S]*?)<\/name>/)
        stiva.push(n ? decodeaza(n[1]).trim() : '')
      }
      continue
    }
    if (inchis) continue
    const sf = xml.indexOf('</Placemark>', re.lastIndex)
    const corp = xml.slice(re.lastIndex, sf)
    re.lastIndex = sf + 12
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
    const parti = { punct: [], linie: [], poligon: [] }
    for (const g of corp.matchAll(/<Point\b[^>]*>([\s\S]*?)<\/Point>/g)) parti.punct.push(parseCoord(tag(g[1], 'coordinates')))
    for (const g of corp.matchAll(/<LineString\b[^>]*>([\s\S]*?)<\/LineString>/g)) parti.linie.push(parseCoord(tag(g[1], 'coordinates')))
    for (const g of corp.matchAll(/<outerBoundaryIs>([\s\S]*?)<\/outerBoundaryIs>/g)) parti.poligon.push(parseCoord(tag(g[1], 'coordinates')))
    const tipuri = Object.entries(parti).filter(([, v]) => v.length).map(([k]) => k)
    const tip = tipuri.length === 1 ? tipuri[0] : (tipuri.length ? 'multi' : 'gol')
    elemente.push({
      idx: elemente.length, id: idAttr, nume, cale: stiva.filter(Boolean).join(' / '), tip, culoare, date,
      parti: [...parti.punct, ...parti.linie, ...parti.poligon],
      linii: parti.linie, poligoane: parti.poligon, puncte: parti.punct,
    })
  }
  return elemente
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
export function centroid(c) {
  const n = c.length
  return n ? [c.reduce((a, p) => a + p[0], 0) / n, c.reduce((a, p) => a + p[1], 0) / n] : null
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

// Taie polilinia la distanța d (m) de la început; întoarce partea [0, d].
function taieLa(ax, d, cumul = cumulat(ax)) {
  const out = [ax[0]]
  for (let i = 1; i < ax.length; i++) {
    if (cumul[i] < d) { out.push(ax[i]); continue }
    const t = (d - cumul[i - 1]) / ((cumul[i] - cumul[i - 1]) || 1)
    out.push([ax[i - 1][0] + t * (ax[i][0] - ax[i - 1][0]), ax[i - 1][1] + t * (ax[i][1] - ax[i - 1][1])])
    break
  }
  return out
}

/**
 * Compune axul din liniile ALESE DE OM, în ordinea dată. Fiecare linie se orientează
 * după capătul curent al axului; dacă începutul ei cade pe ax (sub `toleranta_m`),
 * axul se taie acolo, ca suprapunerea să nu se numere de două ori
 * (LOT 1: kml_1403 și kml_1381 se suprapun pe ~660 m).
 */
export function compuneAx(linii, { toleranta_m = 5 } = {}) {
  let ax = []
  const jurnal = []
  for (const l0 of linii) {
    let l = l0.slice()
    if (!ax.length) { ax = l; jurnal.push({ adaugat_m: lungimeLinie(l), taiat_m: 0 }); continue }
    const capat = ax[ax.length - 1]
    if (haversine(capat, l[l.length - 1]) < haversine(capat, l[0])) l.reverse()
    const cum = cumulat(ax)
    const pr = proiecteaza(ax, l[0], cum)
    let taiat = 0
    if (pr && pr.lateral < toleranta_m && pr.dist < cum[cum.length - 1] - toleranta_m) {
      taiat = cum[cum.length - 1] - pr.dist
      ax = taieLa(ax, pr.dist, cum)
    }
    // vârfurile de început ale liniei noi care stau deja pe ax nu se repetă
    while (l.length > 1 && haversine(ax[ax.length - 1], l[0]) < 0.01) l.shift()
    ax = ax.concat(l)
    jurnal.push({ adaugat_m: lungimeLinie(l0), taiat_m: taiat })
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
 * Bornele din KML sunt adesea ETICHETE de text puse lângă ax; poziția exactă e liniuța
 * de km (linie scurtă care taie axul). Pentru fiecare bornă se caută liniuța cea mai
 * apropiată de etichetă (≤ raza_m) și se folosește mijlocul ei; fără liniuță rămâne eticheta.
 */
export function ancoreDinLiniute(borne, linii, ax, { raza_m = 300, lungime_max_m = 1000, pas_m = 2, toleranta_m = 3 } = {}) {
  const cum = cumulat(ax)
  const scurte = linii.filter(l => l.length >= 2 && lungimeLinie(l) <= lungime_max_m)
  // punctul în care liniuța taie axul: eșantionare pe liniuță, minimul distanței laterale
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
  return borne.map(b => {
    const cand = scurte.filter(l => l.some(v => haversine(v, b.coord) <= raza_m)).map(l => ({ l, t: taiere(l) })).filter(c => c.t.lateral <= toleranta_m)
    if (!cand.length) return { ...b, sursa_ancora: 'eticheta' }
    const best = cand.reduce((x, y) => (haversine(y.t.p, b.coord) < haversine(x.t.p, b.coord) ? y : x))
    return { ...b, coord: best.t.p, sursa_ancora: 'liniuta' }
  })
}

/**
 * Calibrarea km-ului pe ancore [K#20]: între două ancore vecine km-ul se interpolează liniar
 * pe distanța de pe linie; în afara lor se extrapolează cu panta ancorelor de capăt.
 * ancore: [{ dist, km_m }] (dist = distanța pe ax). Întoarce dist → km_m.
 */
export function calibrare(ancore) {
  const a = ancore.slice().sort((x, y) => x.dist - y.dist)
  if (a.length < 2) return d => (a[0] ? a[0].km_m + (d - a[0].dist) : d)
  return d => {
    let i = a.findIndex(x => x.dist >= d)
    if (i <= 0) i = i === 0 ? 1 : a.length - 1
    const p = a[i - 1], q = a[i]
    const panta = (q.km_m - p.km_m) / ((q.dist - p.dist) || 1)
    return p.km_m + (d - p.dist) * panta
  }
}

export const fmtKm = m => {
  if (m === null || m === undefined || !Number.isFinite(m)) return '—'
  const s = m < 0 ? '-' : ''
  const r = Math.round(Math.abs(m))
  return `${s}${Math.floor(r / 1000)}+${String(r % 1000).padStart(3, '0')}`
}

/** Tronsonul care conține km-ul (limitele în metri, ca în executie_tronsoane). */
export function tronsonLaKm(km_m, tronsoane) {
  const t = tronsoane.find(x => x.km_start_m !== null && x.km_end_m !== null && km_m >= x.km_start_m && km_m < x.km_end_m)
  return t ? t.cod : null
}
