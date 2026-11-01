// Poarta lui ofertare-cerinte (20261124a, decizia Răzvan 3A, review #908 r1: Jakarinos P1-2).
// Înainte (#51): cheia anon trecea cât timp ofertare_extragere_coada era activă — cheia anon e publică, deci oricine putea folosi fereastra
// unei cozi legitime. Acum, două căi, nimic altceva:
//  - tick-ul pg_cron (ofertare_extragere_tick): antet x-intern-secret = Vault INTERN_EDGE_SECRET (verificat în BD, _shared/poartaIntern.ts),
//    coada licitației activă ȘI cine a cerut-o (cerut_de, scris de ofertare_coada_porneste / serviciu) trece poarta pe cheltuială;
//  - utilizatorul: JWT verificat de Auth + poarta pe cheltuială.
// r3 (#908, review r2 Jakarinos P1-02 / Copilot P2-02): calea service_role (rol citit din payload) e SCOASĂ — niciun apelant n-o folosea
// (workerul NAS rulează core.ts direct), iar autentificarea serviciului nu ține loc de autorizarea cheltuielii. Fail-closed: orice eroare = refuz.
export type DepsAutorizare = {
  esteIntern: () => Promise<boolean>
  coada: (licId: number) => Promise<{ activ: boolean; cerut_de: string | null } | null>
  getUser: (jwt: string) => Promise<string | null>
  poateCheltui: (licId: number, uid: string | null) => Promise<boolean>
}

export const MESAJ_CERINTE = 'Citirea integrală o pornește doar ownerul sau un responsabil al licitației numit de owner / un admin Ofertare (costă).'

const rolDinJwt = (jwt: string): string | null => {
  try { return JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role ?? null } catch (_) { return null }
}

export async function autorizeazaCerinte(autorizare: string | null, licId: number, d: DepsAutorizare): Promise<string | null> {
  try {
    if (await d.esteIntern()) {
      if (!Number.isSafeInteger(licId) || licId <= 0) return 'licitatie_id invalid'
      const c = await d.coada(licId)
      if (!c?.activ) return 'apel intern refuzat: coada extragerii nu e activă'
      return (await d.poateCheltui(licId, c.cerut_de)) ? null : 'apel intern refuzat: cine a cerut extragerea nu trece poarta pe cheltuială'
    }
    const jwt = (autorizare || '').replace(/^Bearer\s+/i, '')
    if (!jwt) return 'lipsește Authorization'
    // cheia anon / service_role ca Bearer nu mai sunt căi de cheltuială: doar un utilizator verificat de Auth, prin poartă
    const rol = rolDinJwt(jwt)
    if (rol === 'anon' || rol === 'service_role') return `apel neautorizat (cheie ${rol})`
    const uid = await d.getUser(jwt)
    if (!uid) return 'sesiune invalidă'
    return (await d.poateCheltui(licId, uid)) ? null : MESAJ_CERINTE
  } catch (_) {
    return 'eroare la autorizare'
  }
}
