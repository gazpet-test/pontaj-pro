import { assertEquals } from 'jsr:@std/assert@1'
import { destinatariLicitatie, emailValid, OWNER_PRINCIPAL } from './destinatari.ts'

const O = OWNER_PRINCIPAL

Deno.test('responsabil cu email @gazpet.ro: TO responsabil, CC owner principal', () => {
  assertEquals(destinatariLicitatie({ name: 'Mirela Rosu', email: ' Mirela.Rosu@Gazpet.ro ' }, O),
    { to: ['mirela.rosu@gazpet.ro'], cc: [O], faraResponsabil: false, motiv: null, responsabil: 'Mirela Rosu' })
})
Deno.test('responsabilul e chiar owner-ul principal: un singur destinatar, fără CC dublu', () => {
  assertEquals(destinatariLicitatie({ name: 'Razvan Trusu', email: O }, O)?.to, [O])
  assertEquals(destinatariLicitatie({ name: 'Razvan Trusu', email: O }, O)?.cc, [])
})
Deno.test('fără responsabil: TO owner, FĂRĂ RESPONSABIL', () => {
  const d = destinatariLicitatie(null, O)!
  assertEquals([d.to, d.cc, d.faraResponsabil], [[O], [], true])
})
Deno.test('email lipsă / din afara @gazpet.ro / cu caractere de injecție: TO owner, FĂRĂ RESPONSABIL', () => {
  for (const email of [null, '', 'x@gmail.com', 'x@gazpet.ro.evil.com', 'a@gazpet.ro, b@evil.com', 'a@gazpet.ro\nbcc:b@evil.com', 'x@sub.gazpet.ro']) {
    const d = destinatariLicitatie({ name: 'N', email }, O)!
    assertEquals([d.to, d.cc, d.faraResponsabil], [[O], [], true], String(email))
  }
})
Deno.test('owner principal lipsă / invalid în BD: nu se trimite (null)', () => {
  assertEquals(destinatariLicitatie({ name: 'N', email: 'n@gazpet.ro' }, null), null)
  assertEquals(destinatariLicitatie({ name: 'N', email: 'n@gazpet.ro' }, 'razvan@gmail.com'), null)
})
Deno.test('emailValid', () => {
  assertEquals(emailValid('A@GAZPET.RO'), 'a@gazpet.ro')
  assertEquals(emailValid('a b@gazpet.ro'), null)
})
