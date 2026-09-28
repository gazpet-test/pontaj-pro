import { deepStrictEqual as assertEquals } from 'node:assert/strict'
import { normalizeazaSpecOrganigrama } from './core.ts'

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
