import { strict as assert } from 'node:assert'
import { ANTET_INTERN, esteApelIntern } from './poartaIntern.ts'

const BUN = 'a'.repeat(32) + '0123456789abcdef0123456789abcdef'

function client(rasp: { data?: unknown; error?: unknown; arunca?: boolean } = {}) {
  const apeluri: { fn: string; args: Record<string, unknown> }[] = []
  return {
    apeluri,
    rpc: async (fn: string, args: Record<string, unknown>) => {
      apeluri.push({ fn, args })
      if (rasp.arunca) throw new Error('rpc indisponibil')
      return { data: rasp.data ?? null, error: rasp.error ?? null }
    },
  }
}
const cerere = (antet?: string) => new Request('https://local.invalid/functions/v1/x', {
  method: 'POST', headers: antet === undefined ? {} : { [ANTET_INTERN]: antet },
})

Deno.test('fără antet: refuz, fără apel în BD', async () => {
  const c = client({ data: true })
  assert.equal(await esteApelIntern(cerere(), c), false)
  assert.equal(c.apeluri.length, 0)
})

Deno.test('antet în alt format (lungime, majuscule, non-hex): refuz, fără apel în BD', async () => {
  for (const a of ['', 'abc', BUN.slice(1), BUN + '0', BUN.toUpperCase(), 'g'.repeat(64), ' ' + BUN.slice(1)]) {
    const c = client({ data: true })
    assert.equal(await esteApelIntern(cerere(a), c), false, a)
    assert.equal(c.apeluri.length, 0, a)
  }
})

Deno.test('antet valid + BD confirmă: acces; verifică exact INTERN_EDGE_SECRET', async () => {
  const c = client({ data: true })
  assert.equal(await esteApelIntern(cerere(BUN), c), true)
  assert.deepEqual(c.apeluri, [{ fn: 'fn_verifica_secret', args: { p_nume: 'INTERN_EDGE_SECRET', p_secret: BUN } }])
})

Deno.test('BD spune nu / eroare / aruncă / răspuns ne-boolean: refuz (fail closed)', async () => {
  for (const r of [{ data: false }, { data: null }, { data: 'true' }, { data: 1 }, { data: true, error: { message: 'x' } }, { arunca: true }]) {
    assert.equal(await esteApelIntern(cerere(BUN), client(r)), false, JSON.stringify(r))
  }
})
