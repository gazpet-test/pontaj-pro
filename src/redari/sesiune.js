import { STARI_INCHISE } from './stare.js'
// Logica pura; datele calendaristice ISO se compara fara conversie UTC.
export function zileSesiune(uat) {
  return [1, 2, 3].map(nr => ({ nr, data: uat?.[`sesiune_zi${nr}`], program: uat?.[`program_zi${nr}`] || '' }))
    .filter(z => z.data).sort((a, b) => a.data.localeCompare(b.data) || a.nr - b.nr)
}

export function ziImplicita(zile, azi) {
  const date = zile.map(z => z.data).sort()
  return date.find(d => d >= azi) || date.at(-1) || ''
}

const normal = v => (v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
export function filtreazaSesiune(randuri, { cauta = '', doarNesemnate = false } = {}) {
  const text = normal(cauta).trim()
  return randuri.filter(r => (!doarNesemnate || r.pv_stare !== 'semnat') &&
    normal(`${r.nume || ''} ${r.id_parcela || ''}`).includes(text))
    .sort((a, b) => (a.id_parcela || '').localeCompare(b.id_parcela || '', 'ro', { numeric: true }) ||
      (a.nume || '').localeCompare(b.nume || '', 'ro'))
}

export function rezumatSesiune(randuri, prezentiAzi = new Set()) {
  return {
    total: randuri.length,
    semnate: randuri.filter(r => r.pv_stare === 'semnat').length,
    trimise: randuri.filter(r => r.pv_stare === 'trimis_spre_semnare').length,
    fara_pv: randuri.filter(r => r.pv_stare == null).length,
    prezenti_azi: new Set(randuri.filter(r => prezentiAzi.has(r.detinator_id)).map(r => r.detinator_id)).size,
  }
}

// Gemini f5 r1: data e timestamptz -> momentul real al prezentei (audit), nu miezul noptii UTC.
// Unicitatea pe detinator + zi Bucuresti o impune indexul red_raspunsuri_prezenta_uq (20261129e).
export const randPrezenta = ({ detinatorId, zi, acum }) => ({
  detinator_id: detinatorId, canal: 'sesiune', optiune: 'particip', zi_sesiune_aleasa: zi, data: acum,
})

// Schema existenta are data timestamptz. Miezul noptii local, inclusiv DST.
export function intervalZiBucuresti(zi) {
  const [an, luna, ziua] = zi.split('-').map(Number)
  const format = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Bucharest',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
  const miez = tinta => {
    let t = tinta
    for (let i = 0; i < 3; i++) {
      const p = Object.fromEntries(format.formatToParts(new Date(t)).map(x => [x.type, x.value]))
      const local = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second)
      t += tinta - local
    }
    return new Date(t).toISOString()
  }
  return { de: miez(Date.UTC(an, luna - 1, ziua)), pana: miez(Date.UTC(an, luna - 1, ziua + 1)) }
}

const procent = (inchise, total) => total ? Math.round(inchise * 1000 / total) / 10 : 0
export function agregaCentralizator(randuri) {
  const grupuri = new Map()
  for (const r of randuri) {
    const cheie = r.uat_id ?? r.uat3
    if (!grupuri.has(cheie)) grupuri.set(cheie, { uat3: r.uat3, uat_nume: r.uat_nume, total: 0, inchise: 0, procent: 0, pe_stare: {} })
    const u = grupuri.get(cheie), n = Number(r.numar)
    if (r.numar == null || !Number.isFinite(n) || n < 0) throw new Error('Centralizator: numar invalid.')
    u.total += n
    if (r.stare != null) u.pe_stare[r.stare] = (u.pe_stare[r.stare] || 0) + n
    if (STARI_INCHISE.includes(r.stare)) u.inchise += n
  }
  const uats = [...grupuri.values()].sort((a, b) => (a.uat_nume || '').localeCompare(b.uat_nume || '', 'ro'))
  const total = { uat3: 'TOTAL', uat_nume: 'TOTAL', total: 0, inchise: 0, procent: 0, pe_stare: {} }
  for (const u of uats) {
    u.procent = procent(u.inchise, u.total)
    total.total += u.total; total.inchise += u.inchise
    for (const [stare, n] of Object.entries(u.pe_stare)) total.pe_stare[stare] = (total.pe_stare[stare] || 0) + n
  }
  total.procent = procent(total.inchise, total.total)
  return [...uats, total]
}

export function agregaTronsoane(randuri) {
  const grupuri = new Map()
  for (const r of randuri) {
    if (!grupuri.has(r.tronson)) grupuri.set(r.tronson, { tronson: r.tronson, parcele: 0, pv_a_semnat: 0, pv_b: 0, fara_pv: 0, obiectii_deschise: 0 })
    const t = grupuri.get(r.tronson)
    t.parcele++
    // tip_pv este deja clasificat de vederea SQL: A inseamna A semnat.
    if (r.tip_pv === 'A') t.pv_a_semnat++
    if (r.tip_pv === 'B') t.pv_b++
    if (r.tip_pv == null) t.fara_pv++
    if (r.obiectii_deschise === true) t.obiectii_deschise++
  }
  return [...grupuri.values()].sort((a, b) => a.tronson - b.tronson)
}
