import { strict as assert } from 'node:assert'
import { randPublic, raspunsPublic } from './raport.ts'

Deno.test('rândul public păstrează doar stare, id mesaj, pas și tip — orice altceva dispare', () => {
  const r = randPublic({ msg_id: '18f2a9c0', status: 'trimis', tip: 'cod', cod: '123456', catre: ['a@b.ro'], subiect_trimis: 'Cod: 123456', detaliu: 'x' } as never)
  assert.deepEqual(r, { msg_id: '18f2a9c0', status: 'trimis', tip: 'cod' })
})

Deno.test('stare / tip / msg_id în afara listei nu trec (id de Gmail e hex)', () => {
  assert.deepEqual(randPublic({ status: 'Invalid to "ops team"@example.com' as never, tip: 'subiect Popescu', msg_id: 'a b@c' }), { status: 'eroare' })
})

Deno.test('răspunsul nu conține adrese, coduri, subiecte sau text de eroare extern', () => {
  const out = raspunsPublic({ dry: false, polls: 8, nrDestinatari: 2, raport: [
    { msg_id: 'aa1', status: 'trimis', tip: 'cod' },
    { msg_id: 'bb2', status: 'eroare_resend', detaliu: 'to "ops team"@example.com: cod 654321, subject: Confirmare Popescu' } as never,
  ] })
  const s = JSON.stringify(out)
  for (const interzis of ['654321', '@', 'Popescu', 'subject', 'detaliu']) assert.ok(!s.includes(interzis), interzis)
  assert.equal(out.nr_destinatari, 2)
  assert.equal(out.procesate, 2)
})
