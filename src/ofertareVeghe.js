// Raspunsul veghei SEAP la „🔄 Verifică SEAP acum” (OfertareLicitatii.jsx, E7 din review PR-1 r5).
// Bug vechi: se lua PRIMA intrare a licitației din raport (poate fi una de eroare: notificare_esuata, marcare_esuata, inventar),
// iar contorul citea `.length` pe numere (`aduse`, `raspunsuri_aduse` sunt numere) → „Nimic nou” mereu. Acum: intrarea PRINCIPALĂ
// (cea cu `termen`), iar „Nimic nou” doar când nu s-a adus și nu s-a anunțat nimic (documente + răspunsuri + versiuni anunțate).

/** Intrarea principală a licitației din raportul veghei (are cheia `termen`); altfel prima a ei, altfel prima din raport.
 *  @param {any} data răspunsul veghei @param {string | null | undefined} nrAnunt */
export function intrareVeghe(data, nrAnunt) {
  if (!Array.isArray(data?.raport)) return data ?? null
  const ale = data.raport.filter(x => x?.licitatie === nrAnunt)
  const principala = x => x && typeof x === 'object' && 'termen' in x
  return ale.find(principala) || ale[0] || data.raport.find(principala) || data.raport[0] || null
}

/** Ce a adus / anunțat veghea pentru licitație și textul notificării din UI. „Nimic nou” DOAR când nu e nimic: nici document
 *  nou (adus sau rămas de urcat), nici răspuns, nici versiune anunțată / decisă și neadusă încă, nici termen mutat, nici eroare
 *  (review PR-1 r5: „Nimic nou” apărea și când autoritatea publicase ceva ce nu s-a putut aduce). @param {any} r intrarea principală */
export function rezumatVeghe(r) {
  const n = v => Number(v) || 0
  const aduse = n(r?.aduse), raspunsuri = n(r?.raspunsuri_aduse), versiuni = n(r?.versiuni_anuntate)
  // Copilot r1 pe #652 (P2): neaduse = din inventarul de DUPĂ import (coduri.versiuni_neaduse), nu decise minus anunțate — o
  // republicare identică mutată pe rândul vechi nu mai apare ca „încă neadusă”; câmpul lipsă (veghe veche) → calculul vechi
  const ramase = n(r?.ramase)
  const versiuniNeaduse = Array.isArray(r?.coduri?.versiuni_neaduse) ? r.coduri.versiuni_neaduse.length : Math.max(0, (r?.coduri?.versiuni?.length || 0) - versiuni)
  // Copilot r1 (P1): identitate neverificată (în veghe sau în import) = ceva de văzut, nu „Nimic nou”
  const neverificate = (r?.coduri?.identitate_neverificata?.length || 0) + (r?.coduri?.import_erori || []).filter(e => /identitatea nu s-a putut verifica/.test(String(e))).length
  const termen = r?.termen?.nou || null, eroare = r?.eroare || null
  const parti = []
  if (aduse) parti.push(`${aduse} document(e) noi aduse`)
  if (ramase) parti.push(`${ramase} document(e) noi de urcat manual`)
  if (raspunsuri) parti.push(`${raspunsuri} răspuns(uri) de la autoritate`)
  if (versiuni) parti.push(`♻ ${versiuni} versiune(i) nouă(i) anunțată(e)`)
  if (versiuniNeaduse) parti.push(`♻ ${versiuniNeaduse} versiune(i) nouă(i) încă neadusă(e)`)
  if (neverificate) parti.push(`⚠ ${neverificate} document(e) cu identitatea neverificată (vezi raportul)`)
  if (termen) parti.push('termenul de depunere s-a schimbat')
  const total = aduse + ramase + raspunsuri + versiuni + versiuniNeaduse + neverificate + (termen ? 1 : 0)
  const text = eroare ? `⚠️ Verificarea SEAP a dat eroare: ${eroare}` : parti.length ? `📂 Din SEAP: ${parti.join(', ')}` : 'Nimic nou în SEAP acum.'
  return { aduse, raspunsuri, versiuni, ramase, versiuniNeaduse, neverificate, termen, total, text }
}
