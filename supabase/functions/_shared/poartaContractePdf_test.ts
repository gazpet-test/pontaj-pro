import { strict as assert } from 'node:assert'
import { ANTET_CONTRACTE_PDF, NUME_SECRET, caleSigura, esteApelContractePdf, valideazaCerere } from './poartaContractePdf.ts'

const BUN = 'b'.repeat(32) + '0123456789abcdef0123456789abcdef'

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
const cerere = (antet?: string) => new Request('https://local.invalid/functions/v1/contracte-pdf-link', {
  method: 'POST', headers: antet === undefined ? {} : { [ANTET_CONTRACTE_PDF]: antet },
})

Deno.test('fără antet: refuz, fără apel în BD', async () => {
  const c = client({ data: true })
  assert.equal(await esteApelContractePdf(cerere(), c), false)
  assert.equal(c.apeluri.length, 0)
})

Deno.test('antet în alt format: refuz, fără apel în BD', async () => {
  for (const a of ['', 'abc', BUN.slice(1), BUN + '0', BUN.toUpperCase(), 'g'.repeat(64)]) {
    const c = client({ data: true })
    assert.equal(await esteApelContractePdf(cerere(a), c), false, a)
    assert.equal(c.apeluri.length, 0, a)
  }
})

Deno.test('antet valid + BD confirmă: acces; verifică exact CONTRACTE_PDF_LINK_SECRET', async () => {
  const c = client({ data: true })
  assert.equal(await esteApelContractePdf(cerere(BUN), c), true)
  assert.deepEqual(c.apeluri, [{ fn: 'fn_verifica_secret', args: { p_nume: NUME_SECRET, p_secret: BUN } }])
})

Deno.test('BD răspunde false / eroare / aruncă / non-boolean: refuz', async () => {
  for (const r of [{ data: false }, { data: null }, { data: 'true' }, { data: 1 }, { data: true, error: { m: 'x' } }, { arunca: true }]) {
    assert.equal(await esteApelContractePdf(cerere(BUN), client(r)), false, JSON.stringify(r))
  }
})

Deno.test('valideazaCerere: doar contract_id întreg pozitiv', () => {
  assert.deepEqual(valideazaCerere({ contract_id: 42 }), { ok: true, contractId: 42 })
  assert.deepEqual(valideazaCerere({ contract_id: 42, altceva: 'ignorat' }), { ok: true, contractId: 42 })
  for (const rau of [null, undefined, 'x', 5, [], {}, { contract_id: '42' }, { contract_id: 0 }, { contract_id: -1 }, { contract_id: 1.5 }, { contract_id: NaN },
    { contract_id: Number.MAX_SAFE_INTEGER + 2 }, { contract_id: null }]) {
    assert.equal(valideazaCerere(rau).ok, false, JSON.stringify(rau))
  }
})

Deno.test('caleSigura: accept cale relativă normală, refuz traversări și caractere dubioase', () => {
  assert.equal(caleSigura('contracte/2026/c-12.pdf'), 'contracte/2026/c-12.pdf')
  assert.equal(caleSigura('c-12.pdf'), 'c-12.pdf')
  for (const rau of [null, undefined, 5, '', '/abs/c.pdf', '../c.pdf', 'a/../b.pdf', 'a//b.pdf', './c.pdf', 'a\\b.pdf', 'a\nb.pdf', 'x'.repeat(501), 'a/', '%2e%2e/c.pdf', 'a/%2E%2e/b.pdf', 'a%2fb.pdf', 'a%5Cb.pdf']) {
    assert.equal(caleSigura(rau), null, JSON.stringify(rau))
  }
})
