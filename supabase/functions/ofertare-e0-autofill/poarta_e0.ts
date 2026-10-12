// Poarta E0 (review Jakarinos P1 #4): funcția citește DOAR fișa încărcată din formularul E0 (OfertareLicitatii.jsx →
// citesteFisa), nu orice obiect din bucketul `ofertare`. Forma căii e fixă, generată în browser:
//   e0/<Date.now()>_<random base36>_<nume curățat [a-zA-Z0-9._-], max 80>
// Regex strict pe toată calea: fără slash în plus, fără căi absolute, backslash, %-encoding sau spații.
// Plus: dacă aceeași cale apare ca fisier_path în ofertare_documente_atribuire, documentul trece prin poarta pe loturi
// (fn_ofertare_document_eligibil). Fail-closed: eroare la căutare sau la poartă = refuz, nu se cheamă AI.
import { documentEligibil, mesajLot } from '../_shared/eligibilLot.ts'

export const CALE_E0 = /^e0\/\d{10,16}_[a-z0-9]{0,8}_[A-Za-z0-9._-]{1,80}$/

export function caleE0Valida(p: unknown): p is string {
  return typeof p === 'string' && p.length <= 120 && CALE_E0.test(p)
}

type Db = {
  from: (t: string) => any
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>
}

// null = se poate citi; altfel mesajul de refuz (eroare de business, se întoarce ca {error}, nu throw).
export async function poartaE0(db: Db, path: unknown): Promise<string | null> {
  if (!caleE0Valida(path)) return 'path invalid: se acceptă doar fișa încărcată din formularul E0'
  try {
    const { data, error } = await db.from('ofertare_documente_atribuire').select('id').eq('fisier_path', path).limit(50)
    if (error || !Array.isArray(data)) return mesajLot('eroare_poarta')
    for (const r of data) {
      const id = Number(r?.id)
      if (!Number.isSafeInteger(id) || id <= 0) return mesajLot('eroare_poarta')
      const e = await documentEligibil(db, id)
      if (!e.eligibil) return mesajLot(e.motiv)
    }
    return null
  } catch (_) {
    return mesajLot('eroare_poarta')
  }
}
