// R5 condiția 2 (Copilot 26.09.2026): ce n-a scris transferul planșă → cantități devine vizibil în UI (nu doar în JSON).
// Fixture = forma reală a `sumar.cantitati` scrisă de treciInCantitati (ambigue cu grupuri / motiv „altă planșă”, doar_de_verificat).
import { describe, it, expect } from 'vitest'
import { raportTransferCantitati } from './ofertareTransferRaport.js'

describe('raportTransferCantitati', () => {
  it('coliziune pe poziția ALTEI planșe + Dn doar „de verificat” => „de_verificat”, cu metrii și pozițiile numite', () => {
    const r = raportTransferCantitati({ adaugate: 0, actualizate: 3, total_m: 1740, pe_diametre: {},
      ambigue: [{ dn: 63, material: null, metri: 590, motiv: 'mai multe grupuri sigure (Dn, material) pe aceeași poziție — cantitate_plansa neatinsă; poziția are cifra altei planșe („Planșa 2 — …”) — nu se scrie nimic pe ea, decide omul',
        grupuri: [{ dn: 63, material: 'PE', metri: 500, randuri: 1 }, { dn: 63, material: 'OL', metri: 90, randuri: 1 }], pozitii: [{ id: 1755, denumire: 'Conductă distribuție gaze Dn63' }] }],
      doar_de_verificat: [{ dn: 40, material: 'PE', pozitie_id: 1756, actiune: 'golit' }, { dn: null, material: null, pozitie_id: null, actiune: 'fara_dn' }] })
    expect(r.stare).toBe('de_verificat')
    expect(r.text).toBe('1 grup NESCRIS în cantități (590 m sigur, decide omul) · 2 Dn-uri doar „de verificat” (fără cifră sigură)')
    expect(r.linii[0]).toMatch(/^⚠ NESCRIS Dn63 PE 500 m \+ Dn63 OL 90 m → #1755 „Conductă distribuție gaze Dn63”: mai multe grupuri sigure .* cifra altei planșe/)
    expect(r.linii.slice(1)).toEqual(['… de verificat Dn40 PE: poziția: cifra veche golită, de verificat (#1756)', '… de verificat fără Dn: fără Dn citit — în nicio poziție'])
  })
  it('ambiguu simplu (două poziții pe Dn) — fără motiv explicit => „ambiguu … decide omul”; dublura din doar_de_verificat nu se repetă', () => {
    const r = raportTransferCantitati({ ambigue: [{ dn: 110, material: 'PE', metri: 780, pozitii: [{ id: 1, denumire: 'A Dn110' }, { id: 2, denumire: 'B Dn110' }] }],
      doar_de_verificat: [{ dn: 110, material: 'PE', pozitie_id: null, actiune: 'ambiguu' }] })
    expect(r.linii).toEqual(['⚠ NESCRIS Dn110 PE 780 m → #1 „A Dn110”, #2 „B Dn110”: ambiguu între mai multe poziții — decide omul'])
  })
  it('transfer curat => ok, fără text; amânat / eroare => „netrecut” cu motivul; absent => null', () => {
    expect(raportTransferCantitati({ adaugate: 6, actualizate: 0, ambigue: [], total_m: 48195 })).toMatchObject({ stare: 'ok', text: '' })
    expect(raportTransferCantitati({ amanat: '2 felii n-au putut fi citite' })).toMatchObject({ stare: 'netrecut', text: 'transferul în cantități NU s-a făcut: 2 felii n-au putut fi citite' })
    expect(raportTransferCantitati(null)).toBe(null)
  })
})
