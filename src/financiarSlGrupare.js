// ===========================================================================
// Financiar — gruparea SL fără factură după nr. de factură scris pe SL (TKT-2026-0363)
// ===========================================================================
// Funcții pure (fără supabase), testate în financiarSlGrupare.test.js.
// Pe SL, `executie_situatii_plata.nr_factura` e text liber scris de mână ("gaz 418", "GAZ-418",
// "Gaz418"). Mai multe SL ale aceluiași proiect cu același număr = o singură factură de emis.
// Nimic nu se emite automat: gruparea doar propune, utilizatorul verifică și salvează.

// Forma recunoscută: SERIE (doar litere A-Z) + separator opțional (spații / cratime) + NUMĂR (cifre).
// Orice altceva ("418", "GAZ 418/419", "GAZ-418, GAZ-419", rânduri noi) = nerecunoscut → SL rămâne individual.
const RE_NR_FACTURA = /^([A-Z]+)[\s-]*([0-9]+)$/

// "gaz 418" → { serie:'GAZ', nr:418, canonic:'GAZ-418' }; nerecunoscut / gol → null
export function normalizeazaNrFactura(text) {
  if (text === null || text === undefined) return null
  const s = String(text)
  if (/[\r\n]/.test(s)) return null
  const t = s.trim().toUpperCase()
  if (!t) return null
  const m = RE_NR_FACTURA.exec(t)
  if (!m) return null
  const nr = Number.parseInt(m[2], 10)
  if (!Number.isSafeInteger(nr) || nr <= 0) return null
  return { serie: m[1], nr, canonic: `${m[1]}-${nr}` }
}

// Ordine cronologică unică (folosită și de alertă, și de generarea liniilor din modal):
// an, lună, apoi id; an/lună lipsă la final (ca ORDER BY ... ASC din PostgreSQL).
const _num = v => { const n = Number(v); return v === null || v === undefined || v === '' || !Number.isFinite(n) ? Infinity : n }
export function comparaCronologic(a, b) {
  return (_num(a?.an) - _num(b?.an)) || (_num(a?.luna) - _num(b?.luna)) || (_num(a?.id) - _num(b?.id)) || 0
}
export function sorteazaCronologic(lista) {
  return [...(lista || [])].sort((a, b) => {
    const d = comparaCronologic(a, b)
    return Number.isNaN(d) ? 0 : d
  })
}

// slAlert: rândurile din v_sl_fara_factura; nrFacturaPeId: Map/obiect id → nr_factura (text brut).
// Rezultat: elemente în ordinea primei SL (cronologic), fiecare:
//   { tip:'grup', cheie, proiect_id, serie, nr, canonic, sl:[...] }   (≥ 2 SL, același proiect + același nr normalizat)
//   { tip:'individual', cheie, sl:[x], nr_factura_text, nr_recunoscut }
// Fiecare SL din intrare apare exact o dată în rezultat (nimic nu dispare).
export function grupeazaSlFaraFactura(slAlert, nrFacturaPeId) {
  const nrDe = id => {
    if (!nrFacturaPeId) return null
    if (nrFacturaPeId instanceof Map) return nrFacturaPeId.has(id) ? nrFacturaPeId.get(id) : null
    return Object.prototype.hasOwnProperty.call(nrFacturaPeId, id) ? nrFacturaPeId[id] : null
  }
  const ordonate = sorteazaCronologic(slAlert)
  const grupe = new Map()   // cheie proiect|canonic → lista SL
  const info = new Map()    // id SL → { text, norm }
  for (const sl of ordonate) {
    const text = nrDe(sl.id)
    const norm = normalizeazaNrFactura(text)
    info.set(sl.id, { text: text === null || text === undefined ? null : String(text), norm })
    if (norm && sl.proiect_id !== null && sl.proiect_id !== undefined && sl.proiect_id !== '') {
      const cheie = `${String(sl.proiect_id)}|${norm.canonic}`
      if (!grupe.has(cheie)) grupe.set(cheie, [])
      grupe.get(cheie).push(sl)
    }
  }
  const rezultat = []
  const emise = new Set()
  for (const sl of ordonate) {
    const { text, norm } = info.get(sl.id)
    const cheie = norm && sl.proiect_id !== null && sl.proiect_id !== undefined && sl.proiect_id !== ''
      ? `${String(sl.proiect_id)}|${norm.canonic}` : null
    const membri = cheie ? grupe.get(cheie) : null
    if (membri && membri.length >= 2) {
      if (emise.has(cheie)) continue
      emise.add(cheie)
      rezultat.push({ tip: 'grup', cheie, proiect_id: sl.proiect_id, serie: norm.serie, nr: norm.nr, canonic: norm.canonic, sl: membri })
    } else {
      rezultat.push({ tip: 'individual', cheie: `sl|${sl.id}`, sl: [sl], nr_factura_text: text && text.trim() ? text.trim() : null, nr_recunoscut: norm ? norm.canonic : null })
    }
  }
  return rezultat
}

// Decizia de precompletare a seriei/numărului pentru o factură grupată.
// verificare: { stare:'liber' } | { stare:'folosit' } | { stare:'eroare' } (citirea exactă pe (serie, nr) din facturi_emise)
// Rezultat: { serie, nr, mesaj } — serie/nr null = câmpul rămâne cum era (serie implicită, nr gol → automat).
export function decidePrecompletare(grup, seriiPermise, verificare) {
  const canonic = grup?.canonic || '—'
  if (!grup || !grup.serie || !Number.isSafeInteger(grup.nr) || grup.nr <= 0) {
    return { serie: null, nr: null, mesaj: 'Numărul scris pe SL nu a putut fi citit: completează seria și numărul manual sau lasă numărul gol (automat).' }
  }
  if (!(seriiPermise || []).includes(grup.serie)) {
    return { serie: null, nr: null, mesaj: `Seria „${grup.serie}” din numărul scris pe SL (${canonic}) nu există în platformă: alege seria și lasă numărul gol (automat) sau completează-l manual.` }
  }
  const st = verificare?.stare
  if (st === 'liber') return { serie: grup.serie, nr: grup.nr, mesaj: `Seria și numărul au fost precompletate din SL (${canonic}). Verifică înainte de salvare.` }
  if (st === 'folosit') {
    return { serie: grup.serie, nr: null, mesaj: `Numărul ${canonic} este deja folosit de o factură din platformă: verifică factura respectivă (poate trebuie doar legate SL-urile de ea). Numărul a rămas gol.` }
  }
  return { serie: grup.serie, nr: null, mesaj: `Nu am putut verifica dacă numărul ${canonic} e liber (eroare la citire): numărul a rămas gol. Reîncearcă sau completează-l după verificare.` }
}
