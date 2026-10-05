// Ora României pentru termene. În BD termenele sunt timestamptz (UTC): 2026-10-14T12:00Z = 15:00 la București.
// Funcțiile edge rulează în UTC, iar un ISO brut pus într-un prompt sau într-un mail apare ca „12:00”
// (05.10.2026, Mânăstirea: drafturile adresei oficiale au pornit cu ora greșită). Orice termen arătat
// unui om sau unui model trece pe aici.
const TZ = 'Europe/Bucharest'

export const ziRO = (t?: string | null): string =>
  t ? new Date(t).toLocaleDateString('ro-RO', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'

export const termenRO = (t?: string | null): string | null => {
  if (!t) return null
  const d = new Date(t)
  if (isNaN(d.getTime())) return String(t)
  const ora = d.toLocaleTimeString('ro-RO', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false })
  return `${ziRO(t)}, ora ${ora} (ora României)`
}
