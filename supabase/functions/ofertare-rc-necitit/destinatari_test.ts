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
// 20261121a: responsabilul 2 (opțional)
Deno.test('doi responsabili valizi: TO ambii, CC owner, nume „A + B”', () => {
  const d = destinatariLicitatie([prof('Mirela Rosu', 'mirela.rosu@gazpet.ro'), prof('Oana Nica', 'Oana.Nica@gazpet.ro')], O)!
  assertEquals([d.to, d.cc, d.faraResponsabil, d.motiv, d.responsabil], [['mirela.rosu@gazpet.ro', 'oana.nica@gazpet.ro'], [O], false, null, 'Mirela Rosu + Oana Nica'])
})
Deno.test('R2 = owner-ul principal: TO ambii, fără CC dublu', () => {
  const d = destinatariLicitatie([prof('Mirela Rosu', 'mirela.rosu@gazpet.ro'), prof('Razvan Trusu', O)], O)!
  assertEquals([d.to, d.cc], [['mirela.rosu@gazpet.ro', O], []])
})
Deno.test('același email pe ambele locuri: un singur TO', () => {
  assertEquals(destinatariLicitatie([prof('A', 'a@gazpet.ro'), prof('A', 'A@gazpet.ro')], O)!.to, ['a@gazpet.ro'])
})
Deno.test('R1 invalid, R2 valid: TO doar R2, NU „FĂRĂ RESPONSABIL”, avertisment pentru R1; garda @gazpet.ro și pe R2', () => {
  const d = destinatariLicitatie([prof('X', 'x@gmail.com'), prof('Oana Nica', 'oana.nica@gazpet.ro')], O)!
  assertEquals([d.to, d.cc, d.faraResponsabil], [['oana.nica@gazpet.ro'], [O], false])
  assertEquals(d.motiv?.includes('X'), true)
  const e = destinatariLicitatie([prof('Mirela Rosu', 'mirela.rosu@gazpet.ro'), prof('Y', 'y@gazpet.ro.evil.com')], O)!
  assertEquals([e.to, e.faraResponsabil], [['mirela.rosu@gazpet.ro'], false])
})
Deno.test('fără R1, doar R2 valid: TO R2 (nu „FĂRĂ RESPONSABIL”)', () => {
  const d = destinatariLicitatie([{ stare: 'fara_responsabil' }, prof('Oana Nica', 'oana.nica@gazpet.ro')], O)!
  assertEquals([d.to, d.faraResponsabil, d.motiv], [['oana.nica@gazpet.ro'], false, null])
})
Deno.test('ambii invalizi / lipsă: TO owner, FĂRĂ RESPONSABIL', () => {
  const d = destinatariLicitatie([prof('X', null), { stare: 'profil_lipsa' }], O)!
  assertEquals([d.to, d.cc, d.faraResponsabil], [[O], [], true])
  assertEquals(destinatariLicitatie([], O)!.faraResponsabil, true)
})
