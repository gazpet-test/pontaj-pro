import { assertEquals } from 'jsr:@std/assert@1'
import { destinatariLicitatie, emailValid, numeCurat, OWNER_PRINCIPAL } from './destinatari.ts'

const O = OWNER_PRINCIPAL
const prof = (name: string | null, email: string | null) => ({ stare: 'profil' as const, name, email })

Deno.test('responsabil cu email @gazpet.ro: TO responsabil, CC owner principal', () => {
  assertEquals(destinatariLicitatie(prof('Mirela Rosu', ' Mirela.Rosu@Gazpet.ro '), O),
    { to: ['mirela.rosu@gazpet.ro'], cc: [O], faraResponsabil: false, motiv: null, responsabil: 'Mirela Rosu' })
})
Deno.test('responsabilul e chiar owner-ul principal: un singur destinatar, fără CC dublu', () => {
  const d = destinatariLicitatie(prof('Razvan Trusu', O), O)!
  assertEquals([d.to, d.cc], [[O], []])
})
Deno.test('fără responsabil (responsabil_id NULL) / profil lipsă: TO owner, FĂRĂ RESPONSABIL, motive distincte', () => {
  const a = destinatariLicitatie({ stare: 'fara_responsabil' }, O)!
  const b = destinatariLicitatie({ stare: 'profil_lipsa' }, O)!
  assertEquals([a.to, a.cc, a.faraResponsabil, b.to, b.faraResponsabil], [[O], [], true, [O], true])
  assertEquals(a.motiv !== b.motiv, true)
})
Deno.test('email lipsă / din afara @gazpet.ro / cu caractere de injecție: TO owner, FĂRĂ RESPONSABIL', () => {
  for (const email of [null, '', 'x@gmail.com', 'x@gazpet.ro.evil.com', 'a@gazpet.ro, b@evil.com', 'a@gazpet.ro\nbcc:b@evil.com', 'x@sub.gazpet.ro', 'x@gazpetXro']) {
    const d = destinatariLicitatie(prof('N', email), O)!
    assertEquals([d.to, d.cc, d.faraResponsabil], [[O], [], true], String(email))
  }
})
Deno.test('owner principal lipsă / invalid în BD: nu se trimite (null)', () => {
  assertEquals(destinatariLicitatie(prof('N', 'n@gazpet.ro'), null), null)
  assertEquals(destinatariLicitatie(prof('N', 'n@gazpet.ro'), 'razvan@gmail.com'), null)
})
Deno.test('emailValid: regex-ul are punctul escapat (un singur backslash în sursă)', () => {
  assertEquals(emailValid('A@GAZPET.RO'), 'a@gazpet.ro')
  assertEquals(emailValid('a b@gazpet.ro'), null)
  assertEquals(emailValid('a@gazpet\\.ro'), null)
})
Deno.test('numeCurat: caractere de control / format / separatori Unicode scoase', () => {
  assertEquals(numeCurat('Mirela\tRosu​ ‮ x\r\n'), 'Mirela Rosu x')
  assertEquals(numeCurat('\u0000​'), null)
  assertEquals(numeCurat(null), null)
})
