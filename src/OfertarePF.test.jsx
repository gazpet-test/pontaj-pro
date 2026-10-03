import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('./lib/supabase.js', () => ({ supabase: {} }))
import OfertarePF from './OfertarePF.jsx'
import { ACCES_PF_INITIAL, reduceAccesPF, abonareAccesPF, cheieDosarPF } from './ofertarePF.js'

const A = '00000000-0000-0000-0000-00000000000a'
const B = '00000000-0000-0000-0000-00000000000b'
const sesiune = uid => (uid ? { user: { id: uid } } : null)

// auth fals, cu aceeași formă ca supabase.auth (onAuthStateChange + getSession)
function authFals(uidInitial) {
  let cb = null
  const auth = {
    onAuthStateChange(f) { cb = f; return { data: { subscription: { unsubscribe() { cb = null } } } } },
    getSession: () => Promise.resolve({ data: { session: sesiune(uidInitial) } }),
    emite: (ev, uid) => cb?.(ev, sesiune(uid)),
  }
  return auth
}
// reducerul rulat ca useReducer: păstrează referința stării, ca React să poată sări re-randarea
function magazin() {
  const s = { stare: ACCES_PF_INITIAL, randari: 0 }
  s.dispatch = ev => { const nou = reduceAccesPF(s.stare, ev); if (nou !== s.stare) { s.stare = nou; s.randari++ } }
  return s
}
const html = (acces, extra = {}) => renderToStaticMarkup(<OfertarePF licitatieId={7} acces={acces} {...extra} />)

describe('PF › poarta de acces (useAccesPF)', () => {
  it('tab switch (SIGNED_IN) și TOKEN_REFRESHED pentru același user nu schimbă starea și nu demontează DosarPF', async () => {
    const m = magazin(); const auth = authFals(A)
    const opreste = abonareAccesPF(auth, m.dispatch)
    auth.emite('INITIAL_SESSION', A); await Promise.resolve()
    expect(m.stare.deVerificat).toBe(A)
    m.dispatch({ tip: 'rezultat', uid: A, citire: true, scriere: true })
    const dupaVerificare = m.stare, randari = m.randari, cheie = cheieDosarPF(m.stare, 7, null)
    expect(html(m.stare)).toContain('aria-label="Propunere financiară"')
    for (const ev of ['SIGNED_IN', 'TOKEN_REFRESHED', 'SIGNED_IN', 'USER_UPDATED', 'TOKEN_REFRESHED']) auth.emite(ev, A)
    expect(m.stare).toBe(dupaVerificare)           // aceeași referință ⇒ fără re-randare
    expect(m.randari).toBe(randari)
    expect(m.stare.deVerificat).toBeNull()         // fără RPC nou
    expect(cheieDosarPF(m.stare, 7, null)).toBe(cheie) // aceeași cheie ⇒ DosarPF nu se remontează
    expect(html(m.stare)).toContain('aria-label="Propunere financiară"')
    expect(html(m.stare)).not.toContain('Se verifică accesul PF')
    opreste(); auth.emite('SIGNED_IN', B)
    expect(m.stare).toBe(dupaVerificare)           // după dezabonare nu mai ascultă
  })

  it('schimbarea utilizatorului re-verifică, păstrează ultimul răspuns în timpul verificării și recheiază dosarul', () => {
    let s = reduceAccesPF(ACCES_PF_INITIAL, { tip: 'auth', uid: A })
    expect(s.incarcare).toBe(true)
    s = reduceAccesPF(s, { tip: 'rezultat', uid: A, citire: true, scriere: true })
    const cheieA = cheieDosarPF(s, 7, null)
    s = reduceAccesPF(s, { tip: 'auth', uid: B })
    expect(s).toMatchObject({ uid: B, deVerificat: B, verificare: true, poateCiti: true, incarcare: false })
    expect(html(s)).toContain('aria-label="Propunere financiară"')   // fără ecranul „Se verifică…” în timpul re-verificării
    expect(cheieDosarPF(s, 7, null)).not.toBe(cheieA)                 // datele lui A nu rămân în dosarul lui B
    expect(reduceAccesPF(s, { tip: 'rezultat', uid: A, citire: true, scriere: true })).toBe(s) // răspuns întârziat pentru A: ignorat
    s = reduceAccesPF(s, { tip: 'rezultat', uid: B, citire: false, scriere: false })
    expect(s).toMatchObject({ poateCiti: false, poateScrie: false, verificare: false })
    expect(html(s)).toContain('Nu ai drept de acces')
  })

  it('deconectarea închide imediat, fără RPC', () => {
    let s = reduceAccesPF(reduceAccesPF(ACCES_PF_INITIAL, { tip: 'auth', uid: A }), { tip: 'rezultat', uid: A, citire: true, scriere: true })
    s = reduceAccesPF(s, { tip: 'auth', uid: null })
    expect(s).toMatchObject({ uid: null, deVerificat: null, poateCiti: false, poateScrie: false, incarcare: false })
  })

  it('PGRST202 (migrarea lipsă) ascunde PF fără banner; alte erori apar doar în componenta PF', () => {
    const pornit = reduceAccesPF(ACCES_PF_INITIAL, { tip: 'auth', uid: A })
    const lipsa = reduceAccesPF(pornit, { tip: 'eroare', uid: A, cod: 'PGRST202', mesaj: 'Could not find the function public.fn_poate_citi_pf' })
    expect(lipsa).toMatchObject({ poateCiti: false, eroareAcces: null, incarcare: false })
    expect(html(lipsa)).not.toContain('Could not find')
    const retea = reduceAccesPF(pornit, { tip: 'eroare', uid: A, cod: undefined, mesaj: 'Failed to fetch' })
    expect(retea.eroareAcces).toBe('Failed to fetch')
    expect(html(retea)).toContain('Acces PF: Failed to fetch')
  })

  it('scrierea cere și citirea; fără prop acces componenta refuză (fail-closed)', () => {
    const s = reduceAccesPF(reduceAccesPF(ACCES_PF_INITIAL, { tip: 'auth', uid: A }), { tip: 'rezultat', uid: A, citire: false, scriere: true })
    expect(s.poateScrie).toBe(false)
    expect(renderToStaticMarkup(<OfertarePF licitatieId={7} />)).toContain('Accesul PF nu a fost verificat')
    expect(renderToStaticMarkup(<OfertarePF licitatieId={7} proiectId={1} acces={s} />)).toContain('exact o licitație sau un proiect')
  })
})
