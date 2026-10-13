// pontajLunaInchisa.js — corecturile de pontaj pe o lună închisă (regula Marilenei, decizie Răzvan 13.10.2026).
// Lună închisă = orice lună calendaristică trecută. Corecturile se fac până pe 12 a lunii următoare;
// după 12, doar prin tichet HR (deschis de Natalia, aprobat de Marilena). Runda 1 = UI: după termen,
// editarea cere un tichet HR existent + parola și se notează în istoricul tichetului.
// (Runda 2, separat: aprobare explicită pe tichet + trigger server-side pe pontaj_records.)

export const ZI_TERMEN_CORECTURI = 12

const parse = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''))
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return null   // lună imposibilă → invalid (Copilot P1-3)
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) }
}
const ziLocala = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

// Data pontajului ('YYYY-MM-DD') e într-o lună calendaristică anterioară lunii curente?
export function lunaInchisa(dataPontaj, azi = new Date()) {
  const p = parse(dataPontaj)
  if (!p) return false
  return p.y * 12 + p.m < azi.getFullYear() * 12 + (azi.getMonth() + 1)
}

// Ultima zi de corecturi libere pentru luna datei: 12 a lunii următoare.
export function termenCorecturi(dataPontaj) {
  const p = parse(dataPontaj)
  return p ? new Date(p.y, p.m, ZI_TERMEN_CORECTURI) : null
}

// După termen (din 13 a lunii următoare încolo) corectura cere tichet HR.
export function cereTichet(dataPontaj, azi = new Date()) {
  if (!lunaInchisa(dataPontaj, azi)) return false
  const t = termenCorecturi(dataPontaj)
  return ziLocala(azi) > t
}

// Starea afișată în pagină pentru ziua aleasă.
export function stareLuna(dataPontaj, azi = new Date()) {
  if (!lunaInchisa(dataPontaj, azi)) return { inchisa: false, cereTichet: false, termen: null }
  return { inchisa: true, cereTichet: cereTichet(dataPontaj, azi), termen: termenCorecturi(dataPontaj) }
}

// Numărul de tichet tastat → forma canonică TKT-AAAA-NNNN (acceptă „tkt 2026 287”, „2026-0287”).
export function normalizeazaTichet(text) {
  const m = /(\d{4})\D+(\d{1,5})\s*$/.exec(String(text || '').trim())
  if (!m) return null
  return `TKT-${m[1]}-${m[2].padStart(4, '0')}`
}

// Tichet valabil pentru corectură: departament HR și nerespins. Runda 1 NU verifică aprobarea Marilenei
// (nu există încă câmp de aprobare pe tichet) — o confirmă omul în tichet; runda 2 o face tehnic.
export function tichetValabil(t) {
  return !!t && t.departament === 'hr' && t.status !== 'respins'
}

export const fmtZi = (d) => d ? `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}` : ''
