// Mesaj vocal — apelul la edge-ul tts-google (Google Cloud TTS, vocea ro-RO-Chirp3-HD-Aoede).
import { supabase } from './lib/supabase.js'

/**
 * Generează (sau ia din cache) MP3-ul pentru un text. Întoarce { url, din_cache, caractere, ramase?, voce }.
 * La refuz (plafon atins, fără drept, text prea lung) aruncă Error cu mesajul de pe server.
 */
export async function genereazaVoce(text, voce) {
  const { data, error } = await supabase.functions.invoke('tts-google', { body: { text, ...(voce ? { voce } : {}) } })
  if (data?.url) return data
  let mesaj = data?.error
  if (!mesaj && error?.context) {
    try { mesaj = (await (typeof error.context.clone === 'function' ? error.context.clone() : error.context).json())?.error } catch { /* corp gol */ }
  }
  throw new Error(mesaj || error?.message || 'Nu am putut genera vocea')
}

/** Aduce MP3-ul ca File (pentru partajare și descărcare). Se cere imediat după generare, ca share-ul să pornească
 *  din click fără așteptare (iPhone pierde „gestul utilizatorului” dacă între click și share e o descărcare lungă). */
export async function fisierMp3(url, numeFisier) {
  const r = await fetch(url)
  if (!r.ok) throw new Error('Descărcarea fișierului audio a eșuat')
  return new File([await r.blob()], numeFisier, { type: 'audio/mpeg' })
}

/** Poate telefonul/browserul să partajeze fișierul (meniul de share → WhatsApp)? */
export const poatePartaja = f => !!(f && navigator.canShare && navigator.canShare({ files: [f] }))

/** Deschide meniul de partajare al sistemului cu MP3-ul (WhatsApp, mail etc.). false = utilizatorul a renunțat. */
export async function partajeaza(f) {
  try { await navigator.share({ files: [f], title: 'Mesaj vocal' }); return true }
  catch (e) { if (e?.name === 'AbortError') return false; throw e }
}

/** Salvează fișierul pe dispozitiv (desktop sau browser fără share). */
export function descarca(f) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(f)
  a.download = f.name
  document.body.appendChild(a)
  a.click()
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 1000)
}
