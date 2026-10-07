// Mesaj vocal (tts-google) — partea PURĂ: poarta, textul, împărțirea pe bucăți, cheia de cache. Testată în ttsLogica_test.ts.
// Decizii Răzvan 07.10.2026: Google Cloud TTS, vocea ro-RO-Chirp3-HD-Aoede, plafon lunar 950.000 caractere (în BD).
export type Decizie = { ok: true } | { ok: false; status: 401 | 403; error: string }

export const VOCE_IMPLICITA = 'ro-RO-Chirp3-HD-Aoede'
// Lista albă: doar voci românești, ca un apel să nu poată alege modele mai scumpe (Studio, Gemini TTS etc.).
export const VOCI = new Set([VOCE_IMPLICITA, 'ro-RO-Chirp3-HD-Achird', 'ro-RO-Chirp3-HD-Algenib', 'ro-RO-Chirp3-HD-Achernar'])
export const MAX_CARACTERE = 5000          // per cerere (un mesaj vocal lung are ~1.500)
export const MAX_OCTETI_BUCATA = 4500      // limita Google e 5.000 de octeți de text per apel
export const MODUL = 'mesaj_vocal'

// Owner sau cheia de modul 'mesaj_vocal' (orice nivel). Cheia o acordă doar Răzvan (CLAUDE.md pct. 3).
export function decideAccesTts(p: { user: boolean; isOwner: boolean; areModul: boolean }): Decizie {
  if (!p.user) return { ok: false, status: 401, error: 'Neautorizat' }
  if (p.isOwner || p.areModul) return { ok: true }
  return { ok: false, status: 403, error: 'Fără acces la Mesaj vocal' }
}

// NFC + spații normalizate: același text scris puțin diferit (spații duble, CRLF) nimerește același cache.
export function normalizeazaText(t: unknown): string {
  return String(t ?? '').normalize('NFC').replace(/\r\n?/g, '\n').replace(/[ \t ]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}

// Caracterele numărate pentru cotă = code points (Google numără caractere, nu octeți).
export const numarCaractere = (t: string) => Array.from(t).length

const octeti = (s: string) => new TextEncoder().encode(s).length

// Împarte textul în bucăți de cel mult maxOcteti, pe granițe de propoziție; o propoziție prea lungă se taie pe cuvinte,
// iar un „cuvânt” prea lung (fără spații) se taie pe caractere. Concatenarea bucăților (cu spațiu) refă textul.
export function imparteText(text: string, maxOcteti = MAX_OCTETI_BUCATA): string[] {
  const t = text.trim()
  if (!t) return []
  if (octeti(t) <= maxOcteti) return [t]
  const fraze = t.match(/[^.!?…\n]+[.!?…]*\s*|\n+/g) || [t]
  const bucati: string[] = []
  let cur = ''
  const pune = (s: string) => {
    if (!s.trim()) return
    if (octeti(cur + s) <= maxOcteti) { cur += s; return }
    if (cur.trim()) bucati.push(cur.trim())
    cur = ''
    if (octeti(s) <= maxOcteti) { cur = s; return }
    for (const cuv of s.split(/(\s+)/)) {
      if (octeti(cur + cuv) <= maxOcteti) { cur += cuv; continue }
      if (cur.trim()) bucati.push(cur.trim())
      cur = ''
      if (octeti(cuv) <= maxOcteti) { cur = cuv; continue }
      let bucata = ''
      for (const ch of Array.from(cuv)) {
        if (octeti(bucata + ch) > maxOcteti) { bucati.push(bucata); bucata = '' }
        bucata += ch
      }
      cur = bucata
    }
  }
  for (const f of fraze) pune(f)
  if (cur.trim()) bucati.push(cur.trim())
  return bucati
}

export async function cheieCache(voce: string, text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${voce}\n${text}`))
  return Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, '0')).join('')
}
