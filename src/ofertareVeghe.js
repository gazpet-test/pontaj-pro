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

/** Ce a adus / anunțat veghea pentru licitație și textul notificării din UI. @param {any} r intrarea principală */
export function rezumatVeghe(r) {
  const n = v => Number(v) || 0
  const aduse = n(r?.aduse), raspunsuri = n(r?.raspunsuri_aduse), versiuni = n(r?.versiuni_anuntate)
  const parti = []
  if (aduse) parti.push(`${aduse} document(e) noi aduse`)
  if (raspunsuri) parti.push(`${raspunsuri} răspuns(uri) de la autoritate`)
  if (versiuni) parti.push(`♻ ${versiuni} versiune(i) nouă(i) anunțată(e)`)
  return { aduse, raspunsuri, versiuni, total: aduse + raspunsuri + versiuni,
    text: parti.length ? `📂 Din SEAP: ${parti.join(', ')}` : 'Nimic nou în SEAP acum.' }
}
