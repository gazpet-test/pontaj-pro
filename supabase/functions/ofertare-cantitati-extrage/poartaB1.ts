// PR A2 — poarta de completitudine pe felie (planul extractorului A, 17.10.2026): inventarul determinist B1 (_shared/cantAcoperire.ts,
// fără AI, 0 USD) vs observațiile DOVEDITE ale modelului pe aceeași felie. Doar pe rolurile cu tabel numerotat (f3, c6).
// Un rând de inventar „ancora” (nr. + cantitate + UM recunoscute) e ACOPERIT dacă o observație dovedită are cantitatea în blocul lui
// (de la începutul liniei lui până la începutul următorului rând din inventar sau sfârșitul feliei). Rândurile incerte NU se cer
// (promptul cere doar rândurile cu cantitate scrisă), dar se numără, ca semnal. În C6 promptul cere doar unitățile de lungime → poarta
// numără doar ancorele cu UM m / km (aceeași normalizare umNorm ca la observații).
// A2 doar MĂSOARĂ și raportează (`deficit`); A3 îl folosește ca semnal determinist de escaladare la Sonnet 5.5.
import { inventarRanduri } from '../_shared/cantAcoperire.ts'
import { umNorm } from '../_shared/cantNormalizare.ts'

export const ROLURI_POARTA = ['f3', 'c6']
const UM_LUNGIME = ['m', 'km']

export type ObsPentruPoarta = { cantitate_offset: number | null; pozitie_dovedita: boolean }
export type PoartaFelie = {
  aplicabil: boolean
  ancore: number          // rândurile cerute (ancore; la C6 doar cele de lungime)
  acoperite: number
  neacoperite: { nr_id: string | null; linie: number; offset: number }[]   // offset absolut în document; primele 20
  incerte: number         // rânduri incerte din inventar (semnal, nu se cer)
  deficit: boolean        // există ancore neacoperite de o observație dovedită
}

// text = textul feliei; deLa = offsetul feliei în document (cantitate_offset al observațiilor e absolut)
export function poartaFelie(text: string, deLa: number, rol: string | null, obs: ObsPentruPoarta[]): PoartaFelie {
  if (!rol || !ROLURI_POARTA.includes(rol)) return { aplicabil: false, ancore: 0, acoperite: 0, neacoperite: [], incerte: 0, deficit: false }
  const inv = inventarRanduri(text)
  const dovedite = obs.filter((o) => o.pozitie_dovedita && typeof o.cantitate_offset === 'number').map((o) => o.cantitate_offset as number)
  let ancore = 0, acoperite = 0, incerte = 0
  const neacoperite: PoartaFelie['neacoperite'] = []
  for (let i = 0; i < inv.length; i++) {
    const r = inv[i]
    if (r.stare !== 'ancora') { incerte++; continue }
    if (rol === 'c6' && !UM_LUNGIME.includes(umNorm(r.um) ?? '')) continue
    ancore++
    const de = deLa + r.offset
    const pana = deLa + (i + 1 < inv.length ? inv[i + 1].offset : text.length)
    if (dovedite.some((o) => o >= de && o < pana)) acoperite++
    else if (neacoperite.length < 20) neacoperite.push({ nr_id: r.nr_id, linie: r.linie, offset: de })
  }
  return { aplicabil: true, ancore, acoperite, neacoperite, incerte, deficit: acoperite < ancore }
}
