// Izometrie — ajutoare pentru picker-ul de serie din registrul de țeavă (doar citire; fără scriere în registru).

// Seria canonică, aceeași regulă ca magazie_bucati.serie_canon (20261102a):
// upper(regexp_replace(serie, '[[:space:]._/-]', '', 'g'))
export const serieCanon = (s) => String(s ?? '').toUpperCase().replace(/[\s._/-]/g, '')

// Dimensiunea scrisă din registru, în formatul rândurilor existente din executie_tevi („610X7.1”); la curbe se adaugă
// unghiul („610X8 30°”), ca extractUnghi din Izometrie.jsx să-l poată citi
export const dimensiuneDinRegistru = (b) => {
  if (!b.diametru_mm && b.perete_mm == null) return null
  const baza = `${b.diametru_mm || ''}X${b.perete_mm != null ? Number(b.perete_mm) : ''}`
  return b.tip_cod === 'curba' && b.unghi_curba != null ? `${baza} ${Number(b.unghi_curba)}°` : baza
}

// Patch-ul pentru rândul de pachet la alegerea unei bucăți: seria, șarja, lungimea (doar țeava) și dimensiunea
export const patchDinRegistru = (b) => {
  const patch = { serie_unica: b.serie }
  if (b.sarja) patch.sarja = b.sarja
  if (b.tip_cod === 'teava' && b.lungime_mm != null) patch.lungime_m = Number(b.lungime_mm) / 1000
  const dim = dimensiuneDinRegistru(b)
  if (dim) patch.dimensiune = dim
  return patch
}

// Seriile deja folosite în rândurile de pachet ale proiectului: serie canonică → [{ id, cod }]
export const indexFolosite = (randuri) => {
  const m = {}
  for (const t of randuri || []) {
    const k = serieCanon(t.serie_unica)
    if (!k) continue
    if (!m[k]) m[k] = []
    m[k].push({ id: t.id, cod: t.pachet?.cod_document_full })
  }
  return m
}

// Lista de sugestii pentru un rând: filtrată după ce s-a tastat (canonic, „conține”), cu bucățile folosite în ALT rând
// marcate și puse la final; în rest ordonate după serie
export const sugestiiRegistru = (registru, folosite, draft, rowId) => {
  const q = serieCanon(draft)
  return (registru || [])
    .filter(b => !q || serieCanon(b.serie).includes(q))
    .map(b => ({ b, alte: ((folosite || {})[serieCanon(b.serie)] || []).filter(f => f.id !== rowId) }))
    .sort((x, y) => (x.alte.length > 0) - (y.alte.length > 0) || String(x.b.serie).localeCompare(String(y.b.serie)))
}
