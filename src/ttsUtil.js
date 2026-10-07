// Mesaj vocal — partea PURĂ din client (testată în ttsUtil.test.js, fără DOM și fără Supabase).
// Plafonul și poarta reală sunt pe server (edge tts-google + fn_tts_rezerva); aici doar ascundem butoanele și pregătim textul.

export const MODUL_VOCE = 'mesaj_vocal'
export const MAX_CARACTERE = 5000
export const PLAFON_LUNAR = 950000

/** Owner sau cheia de modul 'mesaj_vocal' (ca hasModuleAccess din App.jsx). */
export function poateVoce(profile) {
  if (!profile) return false
  if (profile.is_owner === true) return true
  return (profile.module_access || []).some(m => m === MODUL_VOCE || String(m).startsWith(MODUL_VOCE + '.'))
}

/**
 * Text bun de citit cu voce: fără markdown (**, #, `, liste, linkuri → doar textul), fără emoji și simboluri decorative.
 * Nu schimbă cuvintele; doar scoate ce s-ar citi ca „asterisc”, „diez” etc.
 */
export function textPentruVoce(t) {
  return String(t ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/(\*\*|__|\*|_|~~)(?=\S)([\s\S]*?\S)\1/g, '$2')
    .replace(/^\s*\|.*\|\s*$/gm, ' ')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Luna de facturare Google (America/Los_Angeles), ca 'YYYY-MM-01' — aceeași cheie ca tts_cota_lunara.luna. */
export function lunaGoogle(ms = Date.now()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit' })
    .formatToParts(new Date(ms)).map(x => [x.type, x.value]))
  return `${p.year}-${p.month}-01`
}

/** Numărul de caractere ca pe server (code points). */
export const nrCaractere = t => Array.from(String(t ?? '')).length

/** Nume de fișier pentru descărcare: mesaj_vocal_2026-10-07_1530.mp3 (ora locală). */
export function numeFisierMp3(d = new Date()) {
  const p = n => String(n).padStart(2, '0')
  return `mesaj_vocal_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.mp3`
}
