// ════════════════════════════════════════════════════════════════
// graficMotor/calendar.js — calendarul de zile lucrătoare (spec GRAFIC_AUTOMAT_SPEC.md §6.1, decizia D6).
//
// Zile lucrătoare = luni–vineri minus sărbătorile legale din România (Codul muncii art. 139):
//   1–2 ian, 6–7 ian, 24 ian, Vinerea Mare, Paștele (duminica + lunea), 1 mai, 1 iunie,
//   Rusaliile (duminica + lunea, Paștele + 49/50 de zile), 15 aug, 30 nov, 1 dec, 25–26 dec.
// Paștele ortodox se calculează (algoritmul Meeus, calendar iulian + 13 zile, valid 1900–2099).
// Lista e COD + teste, nu tabel (D6). Abaterile (sâmbete lucrate, opriri impuse de operator) vin
// doar explicit din parametri și apar în raport (calendar.abateri), nu se aplică tacit.
//
// Toate datele sunt șiruri ISO „AAAA-LL-ZZ”, calculate în UTC (fără fus orar, fără ore).
// ════════════════════════════════════════════════════════════════

const ZI_MS = 86400000
const RE_ISO = /^(\d{4})-(\d{2})-(\d{2})$/

export function dinIso(iso) {
  const m = RE_ISO.exec(String(iso ?? ''))
  if (!m) throw new Error(`dată invalidă (aștept AAAA-LL-ZZ): ${JSON.stringify(iso)}`)
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  if (laIso(t) !== iso) throw new Error(`dată inexistentă: ${iso}`)
  return t
}
export const laIso = (t) => new Date(t).toISOString().slice(0, 10)
export const adaugaZile = (iso, n) => laIso(dinIso(iso) + n * ZI_MS)
// 0 = duminică … 6 = sâmbătă
export const ziSaptamana = (iso) => new Date(dinIso(iso)).getUTCDay()

// Adaugă luni calendaristice; ziua care nu există în luna-țintă (31 → februarie) se taie la ultima zi a lunii.
export function adaugaLuni(iso, luni) {
  const d = new Date(dinIso(iso))
  const an = d.getUTCFullYear(), luna = d.getUTCMonth() + luni, zi = d.getUTCDate()
  const ultima = new Date(Date.UTC(an, luna + 1, 0)).getUTCDate()
  return laIso(Date.UTC(an, luna, Math.min(zi, ultima)))
}

// Paștele ortodox (data în calendarul gregorian). Meeus: data iuliană + 13 zile (diferența e 13 zile în 1900–2099).
export function pasteOrtodox(an) {
  if (!Number.isInteger(an) || an < 1900 || an > 2099) throw new Error(`Paștele ortodox se calculează doar pentru 1900–2099 (cerut: ${an})`)
  const a = an % 4, b = an % 7, c = an % 19
  const d = (19 * c + 15) % 30
  const e = (2 * a + 4 * b - d + 34) % 7
  const luna = Math.floor((d + e + 114) / 31)
  const zi = ((d + e + 114) % 31) + 1
  return laIso(Date.UTC(an, luna - 1, zi) + 13 * ZI_MS)
}

// Sărbătorile legale ale unui an, ordonate; aceeași dată cu două sărbători (ex. 1 iunie = a doua zi de Rusalii) apare o dată, cu ambele nume.
export function sarbatoriLegaleRO(an) {
  const p = pasteOrtodox(an)
  const f = (l, z) => `${an}-${String(l).padStart(2, '0')}-${String(z).padStart(2, '0')}`
  const lista = [
    [f(1, 1), 'Anul Nou'], [f(1, 2), 'Anul Nou (a doua zi)'], [f(1, 6), 'Boboteaza'], [f(1, 7), 'Sf. Ioan Botezătorul'],
    [f(1, 24), 'Ziua Unirii Principatelor Române'],
    [adaugaZile(p, -2), 'Vinerea Mare'], [p, 'Paștele ortodox'], [adaugaZile(p, 1), 'Paștele ortodox (a doua zi)'],
    [f(5, 1), 'Ziua Muncii'], [f(6, 1), 'Ziua Copilului'],
    [adaugaZile(p, 49), 'Rusaliile'], [adaugaZile(p, 50), 'Rusaliile (a doua zi)'],
    [f(8, 15), 'Adormirea Maicii Domnului'], [f(11, 30), 'Sf. Apostol Andrei'], [f(12, 1), 'Ziua Națională'],
    [f(12, 25), 'Crăciunul'], [f(12, 26), 'Crăciunul (a doua zi)'],
  ]
  const m = new Map()
  for (const [data, nume] of lista) m.set(data, m.has(data) ? `${m.get(data)} / ${nume}` : nume)
  return [...m.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([data, nume]) => ({ data, nume }))
}

// Parametrii de calendar (grafic_parametri.calendar), toți opționali:
//   lucratoare_suplimentare: ['AAAA-LL-ZZ', …] — zile de weekend lucrate (sau sărbători lucrate — avertisment)
//   opriri: [{ de, pana, motiv }] — perioade de oprire impuse (inclusiv capetele); bat orice zi lucrătoare
//   fara_sarbatori_legale: true — DOAR pentru diagnoză / reproducerea unui calcul vechi; interzis la depunere (verificari.js)
export function creeazaCalendar(param = {}) {
  const abateri = []
  const probleme = []
  const suplimentare = new Set()
  for (const z of param.lucratoare_suplimentare || []) {
    dinIso(z); suplimentare.add(z)
  }
  const opriri = []
  for (const o of param.opriri || []) {
    const de = dinIso(o?.de), pana = dinIso(o?.pana)
    if (pana < de) throw new Error(`oprire cu capetele inversate: ${o.de} – ${o.pana}`)
    opriri.push({ de, pana, motiv: String(o.motiv || '').trim() || 'oprire' })
    abateri.push({ tip: 'oprire', de: o.de, pana: o.pana, motiv: String(o.motiv || '').trim() || 'oprire' })
  }
  const faraSarbatori = param.fara_sarbatori_legale === true
  if (faraSarbatori) abateri.push({ tip: 'fara_sarbatori_legale', motiv: 'calendar FĂRĂ sărbătorile legale — doar pentru diagnoză' })

  const cacheSarb = new Map()
  const sarbAn = (an) => {
    if (!cacheSarb.has(an)) cacheSarb.set(an, new Map(sarbatoriLegaleRO(an).map(s => [s.data, s.nume])))
    return cacheSarb.get(an)
  }
  const sarbatoare = (iso) => (faraSarbatori ? null : sarbAn(Number(iso.slice(0, 4))).get(iso) || null)
  const inOprire = (iso) => { const t = dinIso(iso); return opriri.find(o => t >= o.de && t <= o.pana) || null }

  for (const z of [...suplimentare].sort()) {
    const s = sarbatoare(z), o = inOprire(z)
    if (o) probleme.push({ cod: 'CALENDAR_CONFLICT', gravitate: 'eroare', data: z, mesaj: `${z} e declarată lucrătoare, dar e în oprirea „${o.motiv}” — oprirea are întâietate; corectați parametrii.` })
    if (s) probleme.push({ cod: 'LUCRU_IN_SARBATOARE', gravitate: 'avertisment', data: z, mesaj: `${z} (${s}) e declarată zi lucrată.` })
    abateri.push({ tip: 'lucratoare_suplimentara', data: z, motiv: s ? `lucru în sărbătoare: ${s}` : (ziSaptamana(z) % 6 === 0 ? 'weekend lucrat' : 'zi lucrătoare deja') })
  }

  // De ce nu e lucrătoare o zi (null = e lucrătoare).
  const motivLiber = (iso) => {
    if (inOprire(iso)) return `oprire: ${inOprire(iso).motiv}`
    if (suplimentare.has(iso)) return null
    const s = sarbatoare(iso)
    if (s) return `sărbătoare legală: ${s}`
    const zs = ziSaptamana(iso)
    if (zs === 0 || zs === 6) return 'weekend'
    return null
  }
  const esteLucratoare = (iso) => motivLiber(iso) === null

  return { esteLucratoare, motivLiber, sarbatoare, abateri, probleme, faraSarbatori, suplimentare: [...suplimentare].sort(), opriri: (param.opriri || []).map(o => ({ ...o })) }
}

// Axa de zile lucrătoare a unui proiect: indexul 0 = prima zi lucrătoare de la data de start (inclusiv).
// zi(i) = data zilei lucrătoare i; index(d) = indexul ultimei zile lucrătoare ≤ d (−1 dacă d e înaintea primei).
const PLAFON_ZILE = 200000 // ~550 de ani de căutare: oprește o configurație fără nicio zi lucrătoare
export function creeazaAxa(calendar, dataStart) {
  dinIso(dataStart)
  const zile = []
  let cursor = dataStart, pasi = 0
  const CAPAT = '2099-12-31' // ultimul an cu Paștele calculat (pasteOrtodox)
  const dincolo = () => { const e = new Error(`calendarul nu merge dincolo de ${CAPAT}`); e.capatCalendar = true; return e }
  const extinde = (pana) => {
    while (zile.length <= pana) {
      if (cursor > CAPAT) throw dincolo()
      while (!calendar.esteLucratoare(cursor)) {
        if (cursor >= CAPAT) throw dincolo()
        cursor = adaugaZile(cursor, 1)
        if (++pasi > PLAFON_ZILE) throw new Error('calendarul nu are zile lucrătoare (opriri prea lungi?)')
      }
      zile.push(cursor)
      cursor = adaugaZile(cursor, 1); pasi++
    }
  }
  extinde(0)
  const zi = (i) => {
    if (!Number.isInteger(i) || i < 0) throw new Error(`index de zi invalid: ${i}`)
    extinde(i); return zile[i]
  }
  // ziua i sau null dacă ar fi dincolo de capătul calendarului (2099) — index() se oprește la ultima zi existentă (r2 Jak P2)
  const ziSauNimic = (i) => { try { return zi(i) } catch (e) { if (e.capatCalendar) return null; throw e } }
  const index = (iso) => {
    const t = dinIso(iso)
    if (t < dinIso(zile[0])) return -1
    let i = 0
    for (let u = ziSauNimic(1); u !== null && dinIso(u) <= t; u = ziSauNimic(i + 1)) i++
    return i
  }
  return { start: zile[0], startCerut: dataStart, zi, index }
}
