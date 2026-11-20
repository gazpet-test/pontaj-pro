// ===========================================================================
// PV predare-primire din aviz (TKT-2026-0379 r2) — acțiunea din ecran, fără React (L24).
// O instanță pe montarea ecranului „Arhivă avize”: la demontare `opreste()` invalidează operația în curs.
// Generația curentă + id-ul avizului se verifică înaintea fiecărui pas care are efect
// (captură, descărcare, mesaj, stare în ecran): o operație invalidată nu mai descarcă nimic și nu atinge ecranul.
// ===========================================================================

// Mesajul pentru ecran după o generare. Operația anulată nu are mesaj (null).
// Tipurile ca la showToast: 'error' = excepție, 'warn' = refuz cu motiv (fără PDF), implicit = succes.
export function mesajRezultatPv(r) {
  if (!r || r.anulat) return null
  if (r.eroare) return { text: 'Eroare generare PV: ' + (r.eroare.message || r.eroare), tip: 'error' }
  if (!r.ok) return { text: r.mesaj || 'PV-ul nu s-a generat.', tip: 'warn' }
  return { text: `✓ ${r.fisier} descărcat (${r.nrLinii} ${r.nrLinii === 1 ? 'bun' : 'bunuri'})`, tip: undefined }
}

export function creeazaActiunePv() {
  let generatie = 0
  let oprit = false
  let curenta = null  // { gen, id } — operația în curs

  const esteCurenta = (gen, id) => !oprit && curenta !== null && curenta.gen === gen && curenta.id === id

  return {
    // genereaza(aviz, esteCurent) → { ok, ... } ; laStare(idSauNull) ; laRezultat(rez)
    // Întoarce 'pornit-deja' | 'oprit' | 'fara-aviz' | 'anulat' | 'gata'.
    async porneste(aviz, { genereaza, laStare, laRezultat }) {
      if (oprit) return 'oprit'
      if (curenta) return 'pornit-deja'          // dublu click / alt aviz cât rulează unul
      const id = aviz?.id
      if (id === null || id === undefined) return 'fara-aviz'
      const gen = ++generatie
      curenta = { gen, id }
      const curent = () => esteCurenta(gen, id)
      laStare(id)
      let rez
      try {
        rez = await genereaza(aviz, curent)
      } catch (e) {
        rez = { ok: false, eroare: e }
      }
      if (!curent()) return 'anulat'             // ecranul s-a închis între timp: nici mesaj, nici stare
      curenta = null
      laStare(null)
      laRezultat(rez)
      return 'gata'
    },
    // La demontarea ecranului: operația în curs devine necurentă (nu mai descarcă, nu mai afișează).
    opreste() {
      oprit = true
      generatie++
      curenta = null
    },
  }
}
