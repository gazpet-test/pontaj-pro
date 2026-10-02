import { controlGarantie, controlAnexe, controlNumereCheie, controlPachetComplet } from '../_shared/ofertarePoartaText.mjs'

export const PARSER_VERSION = 'j07-text-v1'
const controale = [
  ['garantie', controlGarantie, ['garantie_cerut_luni', 'garantie_oferit_luni', 'garantie_cerut_moment', 'garantie_oferit_moment', 'garantie_luni_in_capitole', 'garantie_cerinte_lucrari']],
  ['anexe', controlAnexe, ['anexe_referite', 'anexe_existente', 'fraze_anexe', 'capitole_ref']],
  ['numere', controlNumereCheie, ['bransamente_in_capitole', 'bransamente_in_cerinte']],
  ['pachet', controlPachetComplet, ['anexe_asteptate', 'anexe_declarate', 'anexe_responsabili', 'pachet_stare', 'pachet_fisiere']],
]

// Datele provin exclusiv din RPC-ul service_role, niciodată din body-ul clientului.
// WARN rămâne WARN în detalii; J07 mută doar regulile BLOCK, fără reguli business noi.
export function evalueazaTexte(date) {
  return controale.map(([control_code, control, campuri]) => {
    try {
      if (!date || campuri.some(k => !Object.hasOwn(date, k))) throw new Error('Câmpuri lipsă în sursa curentă')
      const verdict = control(date)
      return { control_code, stare: verdict.stare === 'block' ? 'block' : 'ok', detalii: verdict }
    } catch (error) {
      return { control_code, stare: 'undetermined', detalii: { eroare: String(error?.message || error) } }
    }
  })
}
