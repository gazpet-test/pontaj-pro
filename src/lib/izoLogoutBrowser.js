import { coziDeschise, coadaProfilului, decideLogout } from './izoLogout.js'

async function citesteDB(name) {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(name)
    r.onupgradeneeded = () => { r.transaction.abort(); reject(Error('Coada a dispărut în timpul citirii')) }
    r.onerror = () => reject(r.error)
    r.onblocked = () => reject(Error('Citirea cozii este blocată'))
    r.onsuccess = () => {
      const db = r.result
      try {
        const tx = db.transaction('stare', 'readonly'), req = tx.objectStore('stare').get('curenta')
        tx.oncomplete = () => { db.close(); resolve(req.result) }
        tx.onerror = tx.onabort = () => { db.close(); reject(tx.error || Error('Coada nu poate fi citită')) }
      } catch (e) { db.close(); reject(e) }
    }
  })
}
export async function citesteCoziProfil(profil) {
  // Fără profil nu există coadă Izometrie a cuiva: logout-ul obișnuit nu se blochează.
  if (!profil) return Object.assign([], { eroare: null })
  let eroare = null
  const names = new Set()
  try {
    if (!globalThis.indexedDB?.databases) throw Error('Browserul nu permite inventarierea completă a cozilor')
    for (const d of await indexedDB.databases()) if (coadaProfilului(d.name, profil)) names.add(d.name)
  } catch (e) { eroare = e.message }
  for (const n of coziDeschise.keys()) if (coadaProfilului(n, profil)) names.add(n)
  const result = []
  for (const name of names) {
    const q = coziDeschise.get(name)
    try {
      const stare = q ? await (await q).citeste() : await citesteDB(name)
      result.push({ name, stare })
    } catch (e) { eroare = `Citire incompletă: ${e.message}` }
  }
  // Inventar indisponibil (browser fără indexedDB.databases) și nicio coadă cunoscută: nu blocăm ieșirea
  // tuturor utilizatorilor ERP pentru o coadă care, cel mai probabil, nu există. Tabletele (Chrome) au inventarul.
  result.eroare = names.size ? eroare : null
  return result
}
export function exportaCoziJSON(value) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }))
  const a = document.createElement('a'); a.href = url; a.download = 'izo-cozi-siguranta.json'; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
let inCurs = false
export async function logoutProtejat(profil, iesire) {
  if (inCurs) return
  inCurs = true
  try { return await decideLogout({ citeste: () => citesteCoziProfil(profil), confirma: text => window.confirm(text), exporta: exportaCoziJSON, iesire }) }
  catch (e) { window.alert(`Ieșirea nu a fost finalizată: ${e.message}`) }
  finally { inCurs = false }
}
