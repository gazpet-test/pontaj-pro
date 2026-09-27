// ════════════════════════════════════════════════════════════════
// ofertareTransferRaport.js — ce N-a scris transferul planșă → cantități (R5, condiția 2 a lui Copilot, 26.09.2026).
//
// `analiza.citire_ai.sumar.cantitati` (scris de ofertare-plansa-citeste/treciInCantitati) poartă:
//   - `ambigue[]`: grupuri (Dn, material) care NU s-au scris pe nicio poziție — mai multe poziții candidate, coliziunea a două
//     grupuri sigure pe aceeași poziție, sau poziția are cifra ALTEI planșe (nu se suprascrie; decide omul);
//   - `doar_de_verificat[]`: Dn-uri cu rânduri doar „de verificat” (fără cifră sigură): poziție golită / doar notă / ambiguă /
//     fără poziție / fără Dn.
// Până acum le vedea doar JSON-ul transferului: UI-ul nu le afișa, deci metrii lor dispăreau tacit din ecran. Aici devin un
// rezumat (insignă pe document + text în mesajul de după citire). Funcție PURĂ — testată în ofertareTransferRaport.test.js.
// ════════════════════════════════════════════════════════════════

const fmt = n => (+Number(n || 0).toFixed(1)).toLocaleString('ro-RO')
const dnMat = x => `${x.dn ? `Dn${x.dn}` : 'fără Dn'}${x.material ? ` ${x.material}` : ''}`
const ACTIUNI = {
  golit: 'poziția: cifra veche golită, de verificat', nota: 'poziția: doar notă', ambiguu: 'mai multe poziții — nescris',
  fara_pozitie: 'nicio poziție în cantități', fara_dn: 'fără Dn citit — în nicio poziție', nota_fara_material: 'notă (fără material) pe o poziție de pe Dn',
  nota_total_dn: 'notă pe un subtotal pe Dn',
}

export function raportTransferCantitati(c) {
  if (!c || typeof c !== 'object') return null
  if (c.amanat || c.sarit || c.eroare) return { stare: 'netrecut', text: `transferul în cantități NU s-a făcut: ${c.amanat || c.sarit || c.eroare}`, linii: [] }
  if (c.in_curs) return { stare: 'in_curs', text: 'transferul în cantități e în curs', linii: [] }
  const amb = Array.isArray(c.ambigue) ? c.ambigue : []
  const dv = Array.isArray(c.doar_de_verificat) ? c.doar_de_verificat : []
  if (!amb.length && !dv.length) return { stare: 'ok', text: '', linii: [], ambigue: 0, de_verificat: 0 }
  const linii = [
    ...amb.map(a => {
      const gr = Array.isArray(a.grupuri) && a.grupuri.length
        ? a.grupuri.map(g => `${dnMat(g)} ${fmt(g.metri)} m`).join(' + ') : `${dnMat(a)}${a.metri ? ` ${fmt(a.metri)} m` : ''}`
      const poz = (a.pozitii || []).map(p => `#${p.id} „${String(p.denumire || '').slice(0, 40)}”`).join(', ')
      return `⚠ NESCRIS ${gr}${poz ? ` → ${poz}` : ''}: ${a.motiv || 'ambiguu între mai multe poziții — decide omul'}${a.de_verificat ? ` (de verificat: ${a.de_verificat})` : ''}`
    }),
    ...dv.filter(d => d.actiune !== 'ambiguu').map(d => `… de verificat ${dnMat(d)}: ${ACTIUNI[d.actiune] || d.actiune}${d.pozitie_id ? ` (#${d.pozitie_id})` : ''}`),
  ]
  const mAmb = amb.reduce((s, a) => s + (Number(a.metri) || 0), 0)
  const text = [amb.length ? `${amb.length} ${amb.length === 1 ? 'grup NESCRIS' : 'grupuri NESCRISE'} în cantități (${fmt(mAmb)} m sigur, decide omul)` : '',
    dv.length ? `${dv.length} ${dv.length === 1 ? 'Dn doar „de verificat”' : 'Dn-uri doar „de verificat”'} (fără cifră sigură)` : ''].filter(Boolean).join(' · ')
  return { stare: 'de_verificat', text, linii, ambigue: amb.length, de_verificat: dv.length, m_ambigue: mAmb }
}
