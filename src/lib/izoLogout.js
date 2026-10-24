// Registrul rămâne disponibil după demontarea ecranului de teren, inclusiv în memorie.
export const coziDeschise = new Map()
export const coadaProfilului = (name, profil) => Boolean(profil && name?.startsWith(`izo-e4-${profil}-`))
export function situatieLogout(cozi, eroare = null) {
  const numar = cozi.reduce((n, q) => n + (q.stare?.ops?.length || 0), 0)
  return { blocat: Boolean(eroare || numar), numar, eroare, cozi }
}
export async function decideLogout({ citeste, confirma, exporta, iesire }) {
  let situatie
  try { const cozi = await citeste(); situatie = situatieLogout(cozi, cozi.eroare) }
  catch (e) { situatie = situatieLogout([], e.message || 'Coada nu poate fi citită') }
  if (!situatie.blocat) { await iesire(); return true }
  if (await confirma(`${situatie.eroare || `Ai ${situatie.numar} operații netrimise sau fără ACK.`}\nIeșirea este blocată. OK = exportă coada JSON și rămâi conectat. Anulează = continuă la opțiunile de ieșire.`)) {
    await exporta(situatie); return false
  }
  if (!await confirma('Ieși forțat cu operații nesincronizate? Coada rămâne la acest profil; datele doar în memorie se pot pierde.')) return false
  if (!await confirma('A doua confirmare: accepți riscul și confirmi explicit ieșirea forțată?')) return false
  await iesire(); return true
}
