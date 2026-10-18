import { deepStrictEqual as assertEquals } from 'node:assert/strict'
import { normalizeazaSpecOrganigrama, specOrganigramaValida } from './core.ts'

const linii = ['asociati', 'subcontractanti', 'beneficiar', 'proiectant', 'diriginte', 'biunivoc_cu_seful_de_santier']
for (const val of [undefined, null, false, true, 'false', 'true', 0, 1]) {
  Deno.test(`R16: toate câmpurile booleene păstrează trei stări (${String(val)})`, () => {
    const camp = (key: string) => val === undefined ? {} : { [key]: val }
    const spec = normalizeazaSpecOrganigrama({
      ...camp('obligatorie'), ...camp('per_operator'), ...camp('corelare_grafic'),
      linii_cerute: Object.assign({}, ...linii.map(camp)),
      tabel_nominal: camp('cerut'), roluri_cerute: [{ rol: 'RTE', ...camp('obligatoriu') }],
    })
    const asteptat = typeof val === 'boolean' ? val : null
    assertEquals(spec.obligatorie, asteptat)
    assertEquals(spec.per_operator, asteptat)
    assertEquals(spec.corelare_grafic, asteptat)
    assertEquals(spec.tabel_nominal.cerut, asteptat)
    assertEquals(spec.roluri_cerute[0].obligatoriu, asteptat)
    assertEquals(Object.values(spec.linii_cerute), linii.map(() => asteptat))
  })
}

Deno.test('R16: obiectele omise și intrările invalide păstrează contractul UI și necunoscut', () => {
  for (const input of [{}, null, [], 'invalid']) {
    const spec = normalizeazaSpecOrganigrama(input)
    assertEquals(spec.obligatorie, null)
    assertEquals(spec.tabel_nominal, { cerut: null, coloane: [] })
    assertEquals(Object.values(spec.linii_cerute), linii.map(() => null))
    assertEquals(spec.roluri_cerute, [])
  }
})

Deno.test('R16: normalizarea păstrează textul și filtrele existente, fără mutarea inputului', () => {
  const input = { obligatorie: false, faze: ['executie', 'invalid'], roluri_cerute: [{ rol: 'RTE', categorie: 'specialist', obligatoriu: true, domeniu_isc: '8.4(D)' }], documente_suport: ['CV'] }
  const copie = structuredClone(input)
  const spec = normalizeazaSpecOrganigrama(input)
  assertEquals(spec.faze, ['executie'])
  assertEquals(spec.roluri_cerute[0].domeniu_isc, '8.4(D)')
  assertEquals(spec.documente_suport, ['CV'])
  assertEquals(input, copie)
})

Deno.test('P1: spec gol, parțial sau fără faze/roluri utilizabile nu autorizează scrierea', () => {
  const complet = {
    obligatorie: true, faze: ['executie'], roluri_cerute: [{ rol: 'RTE' }],
    linii_cerute: Object.fromEntries(linii.map(k => [k, false])),
    personal_pe_categorii: [], per_operator: false, tabel_nominal: { cerut: false, coloane: [] },
    corelare_grafic: false, documente_suport: [], format: { observatii: null },
    domenii_isc_din_obiect: [], avertismente: [],
  }
  assertEquals(specOrganigramaValida(complet), true, 'false și listele opționale goale sunt valide')
  for (const input of [{}, [], null, { roluri_cerute: [{ rol: 'RTE' }] },
    { ...complet, faze: ['invalid'] }, { ...complet, roluri_cerute: [] },
    { ...complet, roluri_cerute: [{ rol: '   ' }] }, { ...complet, roluri_cerute: [{ rol: 123 }] },
    { ...complet, linii_cerute: {} }, { ...complet, tabel_nominal: {} }, { ...complet, format: {} }]) {
    assertEquals(specOrganigramaValida(input), false)
  }
  for (const key of Object.keys(complet)) {
    const partial: any = { ...complet }; delete partial[key]
    assertEquals(specOrganigramaValida(partial), false, `câmp lipsă: ${key}`)
  }
})
