export const CODURI = ['cuprins', 'neverificate', 'capcane', 'goale', 'nescrise', 'cantitati_f3_grafic',
  'garantie', 'anexe', 'numere', 'pachet', 'grafic_relatii', 'grafic_sursa']
export const SERVER_OK = { stare: 'ok', blocaje: [], controale: CODURI.map(control_code => ({ control_code, stare: 'ok' })) }
export const TEXT_OK = {
  garantie_cerut_luni: 36, garantie_cerut_moment: 'pif', garantie_oferit_luni: 36, garantie_oferit_moment: 'pif',
  garantie_confirmata: true, garantie_justificata: false, garantie_luni_in_capitole: [36], garantie_cerinte_lucrari: 1,
  anexe_referite: ['Anexa 1'], anexe_existente: ['Anexa 1'], fraze_anexe: [], capitole_ref: ['Anexa 1|Metodologie'],
  bransamente_in_capitole: [372], bransamente_in_cerinte: [372], anexe_asteptate: ['Anexa 1'],
  anexe_declarate: [], anexe_responsabili: {}, pachet_stare: 'asamblat',
  pachet_fisiere: [{ nume: 'Anexa 1.pdf', rol: 'anexa', anexa_ref: 'Anexa 1', semnat: true }],
}
export const CAZURI_TEXT = [
  ['garantie', { garantie_oferit_luni: 24 }],
  ['garantie', { garantie_luni_in_capitole: [48] }],
  ['anexe', { anexe_referite: ['Anexa 2'] }],
  ['numere', { bransamente_in_capitole: [371] }],
  ['pachet', { anexe_asteptate: ['Anexa 1', 'Anexa 2'] }],
  ['pachet', { pachet_fisiere: [{ ...TEXT_OK.pachet_fisiere[0], unit_in: 'oferta.pdf' }] }],
]
