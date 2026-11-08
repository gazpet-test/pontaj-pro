// Starea termenului de depunere a unei licitații — logică pură (fără React, fără Supabase), testată în ofertareStareTermen.test.js.
// Auditul Ofertare 08.11.2026 (Rocky): lista și fișa luau `zile_ramase` din v_ofertare_dashboard, care e
// GREATEST(0, ceil((termen − now) / 1 zi)) — orice termen TRECUT (și orice termen lipsă: GREATEST ignoră NULL) devenea 0, iar
// ecranul afișa 0 ca „AZI”. Pe 08.11: 16 din 19 licitații active arătau „termen: AZI”, 14 cu termenul trecut de 6–51 de zile.
// Aici starea se calculează din `termen_depunere` (timestamp exact) și statusul licitației, în zile calendaristice pe ora României,
// cu aceleași funcții ca registrul de termene (ofertareTermene.js), ca să nu existe două reguli de „azi” în aceeași fișă (L19).
import { ziRo, zileIntre, FUS } from './ofertareTermene.js'
import { poateCheltuiUI } from './ofertareResponsabili.js'

// Listă albă (L18): doar statusurile cunoscute au o stare; orice alt status iese „necunoscut”, nu „activ”.
export const NEDEPUSE = ['identificata', 'analiza', 'go', 'in_lucru']
export const FINALE = ['castigata', 'pierduta', 'abandonata']

// Ora termenului, pe ora României („17:22”)
export const oraRo = (ts) => new Date(ts).toLocaleTimeString('ro-RO', { timeZone: FUS, hour: '2-digit', minute: '2-digit' })

// { fel, zile, ora, eticheta, scurt }
//   fel: 'fara_termen' | 'viitor' | 'azi' | 'trecut' | 'depusa' | 'finala' | 'necunoscut'
//   zile: la 'viitor' = zile calendaristice până la termen (≥ 1); la 'trecut' = zile calendaristice de la termen (0 = azi, după oră)
//   eticheta: textul lung (fișă, banner); scurt: textul de pe card
export function stareTermen(lic, acum = new Date()) {
  const status = lic?.status
  if (status === 'depusa') return { fel: 'depusa', zile: null, ora: null, eticheta: 'depusă', scurt: 'depusă' }
  if (FINALE.includes(status)) return { fel: 'finala', zile: null, ora: null, eticheta: 'încheiată', scurt: '—' }
  if (!NEDEPUSE.includes(status)) return { fel: 'necunoscut', zile: null, ora: null, eticheta: 'status necunoscut', scurt: '—' }
  const ts = lic?.termen_depunere
  const t = ts ? new Date(ts) : null
  const a = acum instanceof Date ? acum : new Date(acum)
  if (!t || Number.isNaN(t.getTime()) || Number.isNaN(a.getTime())) return { fel: 'fara_termen', zile: null, ora: null, eticheta: 'fără termen de depunere', scurt: '—' }
  const ora = oraRo(t)
  const ziT = ziRo(t), ziA = ziRo(a)
  // „a trecut” se judecă pe timestamp exact (L17), nu pe zi: termen azi 10:00, acum 15:00 = trecut
  if (t.getTime() <= a.getTime()) {
    const zile = zileIntre(ziT, ziA)
    const cand = zile === 0 ? `azi la ${ora}` : zile === 1 ? 'ieri' : `acum ${zile} zile`
    return { fel: 'trecut', zile, ora, eticheta: `termenul a trecut (${cand}) — nemarcată depusă`, scurt: 'TRECUT' }
  }
  const zile = zileIntre(ziA, ziT)
  if (zile === 0) return { fel: 'azi', zile: 0, ora, eticheta: `AZI până la ${ora}`, scurt: 'AZI' }
  return { fel: 'viitor', zile, ora, eticheta: `${zile} ${zile === 1 ? 'zi' : 'zile'} (până la ${ora})`, scurt: `${zile} ${zile === 1 ? 'zi' : 'zile'}` }
}

// Pragurile de culoare ale termenului — aceleași pe card și în fișă
export function tonTermen(s) {
  if (!s) return 'neutru'
  if (s.fel === 'trecut' || s.fel === 'azi') return 'rosu'
  if (s.fel !== 'viitor') return 'neutru'
  return s.zile <= 3 ? 'rosu' : s.zile <= 7 ? 'portocaliu' : s.zile <= 21 ? 'galben' : 'verde'
}

// Cine poate închide ca „nedepusă” (review Jakarinos #1027 P1): la licitațiile fără GO (identificată / în analiză) doar ownerul —
// ieșirea lor normală e decizia GO/NO-GO, a ownerului; la cele cu GO (go / în lucru) ownerul sau un responsabil numit de owner
// (aceeași regulă ca poarta pe cheltuială, poateCheltuiUI). Regula e doar în UI: impunerea în BD cere migrare (aprobare Răzvan).
export function poateInchideNedepusa(lic, profile) {
  if (!profile?.id || !NEDEPUSE.includes(lic?.status)) return false
  if (profile.is_owner === true) return true
  return ['go', 'in_lucru'].includes(lic.status) && poateCheltuiUI(lic, profile)
}

// Nota care se adaugă la observații când omul închide o licitație cu termenul trecut, fără depunere
export function notaNedepusa(motiv, acum = new Date()) {
  const m = String(motiv ?? '').trim()
  if (!m) return null
  return `[${ziRo(acum)}] Nedepusă după termen: ${m}`
}
