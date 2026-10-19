// PR A2 — poarta de completitudine pe felie (planul extractorului A, 17.10.2026): inventarul determinist B1 (_shared/cantAcoperire.ts,
// fără AI, 0 USD) vs observațiile DOVEDITE ale modelului pe aceeași felie. Doar pe rolurile cu tabel numerotat (f3, c6).
// Rândurile CERUTE (lipsa lor = `deficit` → semnal de escaladare în A3):
//   - „ancora” (nr. + cantitate + UM recunoscute) și „incert” cu cantitate PREZENTĂ dar nerecunoscută (separator_mii_spatiu,
//     um_sau_cantitate_nerecunoscute — review Copilot / Gemini r1): acoperite DOAR de o observație dovedită al cărei cantitate_offset e
//     EXACT offsetul tokenului de cantitate expus de B1 (`RandInventar.cantitate_offset`, review Copilot r2); fără offset = deficit.
// Rândurile doar SEMNALATE (nu se cer — promptul cere doar rândurile cu cantitate scrisă): celelalte incerte (posibila_continuare,
//   lista_fara_cod_sau_cantitate) și tabelele cu secvență nedeterminată / goluri / reluări → `complet: false` (B2 tratează felia ca
//   incompletă), fără escaladare.
// În C6 promptul cere doar unitățile de lungime → la C6 se cer doar ancorele / incertele cu UM m / km (aceeași normalizare umNorm).
import { inventarRanduri, tabele } from '../_shared/cantAcoperire.ts'
import { umNorm } from '../_shared/cantNormalizare.ts'

export const ROLURI_POARTA = ['f3', 'c6']
const UM_LUNGIME = ['m', 'km']
const INCERT_CERUT = ['separator_mii_spatiu', 'um_sau_cantitate_nerecunoscute']

export type ObsPentruPoarta = { cantitate_offset: number | null; pozitie_dovedita: boolean }
export type PoartaFelie = {
  aplicabil: boolean
  ancore: number          // rânduri cerute (ancore + incerte cu cantitate nerecunoscută; la C6 doar cele de lungime)
  acoperite: number
  neacoperite: { nr_id: string | null; linie: number; offset: number }[]   // offset absolut în document; primele 20
  incerte: number         // incerte doar semnalate (nu se cer)
  tabele_nedeterminate: number   // tabele B1 cu goluri / goluri ierarhice / reluări atipice / secvență nedeterminată
  deficit: boolean        // există rânduri cerute neacoperite → semnal de escaladare
  complet: boolean        // fără deficit, fără incerte semnalate, fără tabele nedeterminate
}

// text = textul feliei; deLa = offsetul feliei în document (cantitate_offset al observațiilor e absolut)
export function poartaFelie(text: string, deLa: number, rol: string | null, obs: ObsPentruPoarta[]): PoartaFelie {
  const gol = { aplicabil: false, ancore: 0, acoperite: 0, neacoperite: [], incerte: 0, tabele_nedeterminate: 0, deficit: false, complet: true }
  if (!rol || !ROLURI_POARTA.includes(rol)) return gol
  const inv = inventarRanduri(text)
  const dovedite = obs.filter((o) => o.pozitie_dovedita && typeof o.cantitate_offset === 'number').map((o) => o.cantitate_offset as number)
  let ancore = 0, acoperite = 0, incerte = 0
  const neacoperite: PoartaFelie['neacoperite'] = []
  for (let i = 0; i < inv.length; i++) {
    const r = inv[i]
    const de = r.offset
    const cerutIncert = r.stare === 'incert' && INCERT_CERUT.includes(r.motiv ?? '')
    if (r.stare !== 'ancora' && !cerutIncert) { incerte++; continue }
    if (rol === 'c6' && !UM_LUNGIME.includes(umNorm(r.um) ?? '')) {
      // C6 fără UM de lungime: nu se cere; un incert cu UM nerecunoscută rămâne semnalat
      if (r.stare !== 'ancora') incerte++
      continue
    }
    ancore++
    // review Copilot A2 r2 (P1 / P1): acoperit DOAR de o observație dovedită pe EXACT tokenul cantității pe care B1 l-a recunoscut
    // (`cantitate_offset`) — nici altă apariție a aceleiași valori, nici altă cantitate din bloc; fără offset localizat
    // (um_sau_cantitate_nerecunoscute) nu există legătură deterministă → rămâne deficit
    const acoperit = r.cantitate_offset !== null && dovedite.includes(deLa + r.cantitate_offset)
    if (acoperit) acoperite++
    else if (neacoperite.length < 20) neacoperite.push({ nr_id: r.nr_id, linie: r.linie, offset: deLa + de })
  }
  const tabeleNed = tabele(inv).filter((t) => t.secventa_nedeterminata || t.goluri.length > 0 || t.goluri_ierarhice.length > 0 || t.reluari_atipice > 0).length
  const deficit = acoperite < ancore
  return { aplicabil: true, ancore, acoperite, neacoperite, incerte, tabele_nedeterminate: tabeleNed, deficit, complet: !deficit && incerte === 0 && tabeleNed === 0 }
}
