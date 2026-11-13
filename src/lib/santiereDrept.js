// Dreptul de a crea un șantier nou (TKT-2026-0359, migrarea 20261222a).
// Regula din BD (fn_sites_drept_creare + politica sites_insert_drept_creare): owner, SAU contul cu cheia de modul 'santiere_creare' pe nivel
// editor / admin (+ drept de scriere în Execuție pe proiectul de care se leagă șantierul). BD-ul decide; interfața doar ascunde formularul
// pentru conturile pe care BD-ul oricum le-ar refuza și explică refuzul când vine.
// Cheia NU e 'administrativ.locatii' (aceea înseamnă „Locații închiriate”) și nu are punct: nu deschide alt modul prin prefix.
export const CHEIE_SANTIERE_CREARE = 'santiere_creare'

export function poateCreaSantier(profile) {
  if (!profile) return false
  if (profile.is_owner === true) return true
  const nivel = profile.module_access_levels?.[CHEIE_SANTIERE_CREARE]
  return nivel === 'editor' || nivel === 'admin'
}

// Mesajul pentru un INSERT în sites refuzat de BD. 42501 = politica RLS (contul nu are dreptul, sau nu poate scrie în Execuție pe proiectul
// ales); restul = eroarea așa cum vine (L18: o eroare nu se ascunde sub „nu ai drept”).
export function mesajRefuzSantier(error) {
  if (!error) return null
  const rls = error.code === '42501' || /row-level security/i.test(error.message || '')
  if (rls) return 'Baza de date a refuzat crearea șantierului: contul nu are dreptul „Creare șantiere” (îl acordă owner-ul) sau nu poate scrie în Execuție pe proiectul ales.'
  return 'Eroare la crearea șantierului: ' + (error.message || 'necunoscută')
}
