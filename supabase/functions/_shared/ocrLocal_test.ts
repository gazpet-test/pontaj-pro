import { strict as assert } from 'node:assert'
import {
  ANTET_OCR, NUME_SECRET, OPERATII, amprentaDezacord, apelDinCorp, canonic, costReal, decizieDinIesire, dinBase64, esteApelOcrLocal,
  estimeazaRezervare, MAX_TOKENI_IESIRE, sha256Hex, statusDinEroare, tipImagine,
} from './ocrLocal.ts'

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
const cerere = (antet?: string) => new Request('https://local.invalid/functions/v1/ofertare-ocr-scrie', {
  method: 'POST', headers: antet === undefined ? {} : { [ANTET_OCR]: antet },
})

Deno.test('poarta: fără antet / alt format → refuz fără apel în BD', async () => {
  for (const a of [undefined, '', 'abc', BUN.slice(1), BUN + '0', BUN.toUpperCase(), 'g'.repeat(64)]) {
    const c = client({ data: true })
    assert.equal(await esteApelOcrLocal(cerere(a), c), false, String(a))
    assert.equal(c.apeluri.length, 0)
  }
})
Deno.test('poarta: secretul verificat în BD cu numele OCR_LOCAL_SECRET; doar data === true trece', async () => {
  const c = client({ data: true })
  assert.equal(await esteApelOcrLocal(cerere(BUN), c), true)
  assert.deepEqual(c.apeluri, [{ fn: 'fn_verifica_secret', args: { p_nume: NUME_SECRET, p_secret: BUN } }])
  for (const r of [{ data: false }, { data: 'true' }, { data: 1 }, { data: true, error: { message: 'x' } }, { arunca: true }]) {
    assert.equal(await esteApelOcrLocal(cerere(BUN), client(r)), false, JSON.stringify(r))
  }
})

Deno.test('ocr-scrie: doar operațiile din listă, exact cheile, null doar unde e permis', () => {
  assert.deepEqual(Object.keys(OPERATII).sort(), ['comparatie_gata', 'dezacord', 'heartbeat', 'pagina', 'plan', 'preia', 'rezervare_abandon', 'stare'])
  for (const fn of Object.values(OPERATII).map((o) => o.fn)) assert.ok(!/pdf|cost_rezerva|scrie_arbitraj|cerere|verifica|esantion|anuleaza/.test(fn), fn)
  const ok = apelDinCorp({ op: 'stare', args: { rulare_id: 5, stare: 'citita', motiv: null } })
  assert.deepEqual(ok, { ok: true, fn: 'fn_ofertare_ocr_stare', args: { p_rulare_id: 5, p_stare: 'citita', p_motiv: null } })
  for (const corp of [null, [], 'x', { op: 'stare' }, { op: 'stare', args: [] }, { op: 'cost_rezerva', args: {} }, { op: 'toString', args: {} },
    { op: '__proto__', args: {} }, { op: 'stare', args: { rulare_id: 5, stare: 'citita' } },
    { op: 'stare', args: { rulare_id: 5, stare: 'citita', motiv: null, extra: 1 } }, { op: 'stare', args: { rulare_id: null, stare: 'x', motiv: null } },
    { op: 'stare', args: { rulare_id: 5, stare: 'citita', motiv: null }, alt: 1 }]) {
    assert.equal(apelDinCorp(corp).ok, false, JSON.stringify(corp))
  }
  const p = apelDinCorp({ op: 'pagina', args: { rulare_id: 1, document_id: 2, pagina: 3, banda: 0, cititor: 'lighton', text: 't', stare: 'citit',
    model_rev: 'm', raw_sha256: 'h', image_sha256: null, garda: null, segmente: [['text', 't']] } })
  assert.ok(p.ok && p.fn === 'fn_ofertare_ocr_scrie_pagina' && Object.keys(p.args).length === 12)
})

Deno.test('erori RPC → coduri HTTP', () => {
  assert.equal(statusDinEroare({ code: '22023' }), 422); assert.equal(statusDinEroare({ code: '55000' }), 409)
  assert.equal(statusDinEroare({ code: '23505' }), 409); assert.equal(statusDinEroare({ code: 'P0002' }), 404)
  assert.equal(statusDinEroare({ code: 'XX000' }), 500); assert.equal(statusDinEroare(null), 500)
})

// Paritatea amprentei cu scripts/ocr_local/compare.py item_hash: fișierul e generat de Python (testul Python
// test_amprente_edge_identice îl recalculează), aici se recalculează în TS.
Deno.test('amprenta dezacordului = compare.item_hash (Python), inclusiv caractere speciale', async () => {
  const fixt = JSON.parse(await Deno.readTextFile(new URL('./ocrLocal_amprente.json', import.meta.url)))
  assert.ok(fixt.length >= 3)
  for (const it of fixt) assert.equal(await amprentaDezacord(it), it.item_sha256, it.id)
  const alt = { ...fixt[0], citire_lighton: fixt[0].citire_lighton + ' ' }
  assert.notEqual(await amprentaDezacord(alt), fixt[0].item_sha256)
})
Deno.test('canonic: tipuri nepermise → excepție', () => {
  assert.throws(() => canonic(1.5)); assert.throws(() => canonic({ a: undefined })); assert.throws(() => canonic(NaN))
  assert.equal(canonic({ b: [1, true, null], a: '' }), '{"a": "", "b": [1, true, null]}')
})

Deno.test('imagine: tip după octeți, base64 strict, sha', async () => {
  assert.equal(tipImagine(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0])), 'image/png')
  assert.equal(tipImagine(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg')
  assert.equal(tipImagine(new TextEncoder().encode('%PDF-1.7 aaaa')), null)
  assert.equal(dinBase64('a b'), null); assert.equal(dinBase64('abc'), null); assert.deepEqual(dinBase64('YQ=='), new Uint8Array([97]))
  assert.equal(await sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
})

Deno.test('cost: rezervarea acoperă costul real maxim', () => {
  const textCar = 9000, rez = estimeazaRezervare(textCar)
  // cel mai rău caz real: 1 token / 2 caractere + imaginea la plafon + ieșirea la max_tokens
  assert.ok(costReal(Math.ceil(textCar / 2) + 5000, MAX_TOKENI_IESIRE) <= rez)
  assert.equal(costReal(3000, 300), 0.0135); assert.equal(costReal(3001, 300), 0.0136)  // rotunjire în sus, fără eroare de virgulă mobilă
  assert.ok(rez < 0.1)
})

Deno.test('ieșirea arbitrului: schema strictă, altfel needs_human', () => {
  const it = { citire_lighton: '0,056', citire_mineru: '0.056', e_cantitate: true, anomalie_separator: true }
  const j = (o: unknown) => JSON.stringify(o)
  const bun = { decizie: 'ales_mineru', text: 'orice', motiv: 'punct in imagine', e_cantitate: true, anomalie_separator: true }
  assert.deepEqual(decizieDinIesire(j(bun), it), { ...bun, text: '0.056' })  // textul = citirea aleasă, nu ce a scris modelul
  assert.deepEqual(decizieDinIesire('  ' + j({ ...bun, decizie: 'ales_lighton' }) + '\n', it).text, '0,056')
  assert.equal(decizieDinIesire(j({ ...bun, decizie: 'text_propus', text: '0.065' }), it).text, '0.065')
  assert.deepEqual(decizieDinIesire(j({ ...bun, decizie: 'needs_human', text: 'x' }), it).text, '')
  for (const rau of ['', 'Aleg MinerU', '```json\n' + j(bun) + '\n```', j({ ...bun, extra: 1 }), j({ ...bun, decizie: 'ales_amandoua' }),
    j({ ...bun, e_cantitate: 'da' }), j({ ...bun, motiv: 'x'.repeat(201) }), j({ ...bun, decizie: 'text_propus', text: ' \n' }), j([bun]),
    j(bun) + ' și ceva']) {
    const d = decizieDinIesire(rau, it)
    assert.equal(d.decizie, 'needs_human', rau); assert.equal(d.text, ''); assert.equal(d.e_cantitate, true)
  }
})
