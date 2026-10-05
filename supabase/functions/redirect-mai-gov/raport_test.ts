import { strict as assert } from 'node:assert'
import { curataDetaliu, randPublic, raspunsPublic } from './raport.ts'

Deno.test('rândul public păstrează doar stare, id mesaj, pas și tip', () => {
  const r = randPublic({ msg_id: 'm1', status: 'trimis', tip: 'cod', cod: '123456', catre: ['a@b.ro'], subiect_trimis: 'Cod: 123456' } as never)
  assert.deepEqual(r, { msg_id: 'm1', status: 'trimis', tip: 'cod' })
})

Deno.test('detaliul de eroare nu scapă secvențe de cifre de tip cod și e tăiat', () => {
  assert.equal(curataDetaliu('cod 482913 respins'), 'cod #### respins')
  assert.equal(curataDetaliu('x'.repeat(500)).length, 200)
  assert.equal(curataDetaliu(undefined), '')
  assert.equal(curataDetaliu('to: a.b@gazpet.ro, c@x.com'), 'to: <email>, <email>')
})

Deno.test('răspunsul nu conține adrese, coduri sau subiecte', () => {
  const out = raspunsPublic({ dry: false, polls: 8, nrDestinatari: 2, raport: [
    { msg_id: 'm1', status: 'trimis', tip: 'cod' },
    { msg_id: 'm2', status: 'eroare_resend', detaliu: 'to natalia@gazpet.ro: cod 654321 invalid' },
  ] })
  const s = JSON.stringify(out)
  assert.ok(!/654321/.test(s))
  assert.ok(!/natalia@/.test(s))
  assert.equal(out.nr_destinatari, 2)
  assert.equal(out.procesate, 2)
  assert.ok(!('destinatari' in out))
})
