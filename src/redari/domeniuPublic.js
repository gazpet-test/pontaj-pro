// Redări teren — domeniul public pentru proprietari (decizia Razvan 03.11.2026).
// Linkurile și QR-urile din convocatoare duc DOAR pe redari.gazpet.ro, oricare ar fi domeniul de pe care operatorul generează documentul.
// Pe acest host se deschid doar paginile publice Redări; restul căilor merg pe domeniul principal al ERP-ului.
// Prima barieră e regula `has: host` din vercel.json; garda din client (tintaRedirectHostPublic) e a doua, dacă regula lipsește.

export const HOST_PUBLIC_REDARI = 'redari.gazpet.ro'
export const ORIGINE_PUBLICA_REDARI = `https://${HOST_PUBLIC_REDARI}`
export const ORIGINE_ERP = 'https://pontaj-pro-sooty.vercel.app'

// Pagina publică cu informarea GDPR completă (sugestie pentru câmpul link_informare_gdpr din Setări proiect)
export const LINK_INFORMARE_REDARI = `${ORIGINE_PUBLICA_REDARI}/redari/informare`

// Căile de pagină permise pe host-ul public; aceeași listă ca în vercel.json (testul domeniuPublic.test.js le compară)
const RX_CAI_PUBLICE = [/^\/redari\/raspuns\/[^/]+\/?$/, /^\/redari\/informare\/?$/]

export const esteCalePublicaRedari = (pathname) => RX_CAI_PUBLICE.some(rx => rx.test(String(pathname || '')))

/**
 * Unde trebuie dus vizitatorul, dacă e pe host-ul public și pe o cale care nu e publică Redări; altfel null (rămâne pe loc).
 * `loc` are forma lui window.location (hostname, pathname, search, hash).
 */
export function tintaRedirectHostPublic(loc) {
  if (!loc || String(loc.hostname || '').toLowerCase() !== HOST_PUBLIC_REDARI) return null
  if (esteCalePublicaRedari(loc.pathname)) return null
  return `${ORIGINE_ERP}${loc.pathname || '/'}${loc.search || ''}${loc.hash || ''}`
}
