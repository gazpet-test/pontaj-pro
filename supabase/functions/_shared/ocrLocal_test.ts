import { strict as assert } from 'node:assert'
import {
  amprentaDezacord, ANTET_OCR, canonic, NUME_SECRET, OPERATII, apelDinCorp, citesteCorp, costReal, decizieDinIesire, dimensiuniPng, dinBase64, esteApelOcrLocal,
  cifreDiferite, diferentaNumerica, limitaCost, MAX_TOKENI_IESIRE, octeti, sha256Hex, sirCifre, statusDinEroare, tokeniImagineMax,
} from './ocrLocal.ts'

Deno.test('sirCifre / cifreDiferite (laborator 15.10): separatorul literal, spatiile si marcajele ⟦rowspan⟧ nu conteaza', () => {
  const egale: [string, string][] = [
    ['2,5', '2, 5'], ['114,3 X 4,  \n5mm', '114,3 X 4,5mm'], ['C30/37 2,7 mc', 'C30/372,7 mc'], ['- 16', '-16'], ['4.000  \nCURBA', '4.000 CURBA'],
    ['1.2 | Amenajarea', '1.2 ⟦rowspan=5⟧ | Amenajarea'], ['Teava ⟦colspan_invalid=2x⟧', 'Teava'], ['BUC. 4.000', 'BUC 4.000'],
    ['TG-INV-10914', 'TG_INV_10914'], ['masuri de protecție', 'masuri de protectie'], ['---', ''], ['ARC6 S 7666/2', 'ARC6 S 7666 / 2'],
  ]
  for (const [a, b] of egale) assert.equal(cifreDiferite(a, b), false, JSON.stringify([a, b, sirCifre(a), sirCifre(b)]))
  const diferite: [string, string][] = [
    ['0,056', '0.056'], ['1.234', '1,234'], ['10 m', '20 m'], ['', '48 | 56 | 0'], ['3/4', '34'], ['-5', '5'], ['5%', '5'], ['(.5)', '(5)'],
    ['8 -15 KG', '8 15 KG'], ['1,0 m', '10 m'], ['1.2 ⟦rowspan=5⟧', '1.3'],
  ]
  for (const [a, b] of diferite) assert.equal(cifreDiferite(a, b), true, JSON.stringify([a, b, sirCifre(a), sirCifre(b)]))
  assert.equal(sirCifre('Km 16 + 580, 2860,67 m'), '16+580,2860,67')  // virgula urmata de cifra conteaza si dupa spatiu
})

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
// PNG minim: semnătura + IHDR cu lățime / înălțime
function png(w: number, h: number): Uint8Array {
  const b = new Uint8Array(40); b.set([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82])
  const v = new DataView(b.buffer); v.setUint32(16, w); v.setUint32(20, h); return b
}

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
  assert.deepEqual(Object.keys(OPERATII).sort(), ['comparatie_gata', 'dezacord', 'heartbeat', 'needs_human', 'pagina', 'plan', 'preia', 'rezervare_abandon', 'rulari_active', 'stare', 'stare_rulare'])
  assert.deepEqual(apelDinCorp({ op: 'stare_rulare', args: { rulare_id: 7 } }), { ok: true, fn: 'fn_ofertare_ocr_rulare_stare', args: { p_rulare_id: 7 } })
  assert.deepEqual(apelDinCorp({ op: 'rulari_active', args: {} }), { ok: true, fn: 'fn_ofertare_ocr_rulari_active', args: {} })
  for (const corp of [{ op: 'rulari_active', args: { x: 1 } }, { op: 'stare_rulare', args: {} }, { op: 'stare_rulare', args: { rulare_id: null } }]) {
    assert.equal(apelDinCorp(corp).ok, false, JSON.stringify(corp))
  }
  for (const fn of Object.values(OPERATII).map((o) => o.fn)) assert.ok(!/pdf|cost_rezerva|arbitraj_rezerva|scrie_arbitraj|dezacord_arbitraj|cerere|verifica|esantion|anuleaza/.test(fn), fn)
  assert.equal(OPERATII.needs_human.fn, 'fn_ofertare_ocr_arbitraj_om')
  const ok = apelDinCorp({ op: 'stare', args: { rulare_id: 5, stare: 'citita', motiv: null } })
  assert.deepEqual(ok, { ok: true, fn: 'fn_ofertare_ocr_stare', args: { p_rulare_id: 5, p_stare: 'citita', p_motiv: null } })
  for (const corp of [null, [], 'x', { op: 'stare' }, { op: 'stare', args: [] }, { op: 'cost_rezerva', args: {} }, { op: 'toString', args: {} },
    { op: '__proto__', args: {} }, { op: 'stare', args: { rulare_id: 5, stare: 'citita' } },
    { op: 'stare', args: { rulare_id: 5, stare: 'citita', motiv: null, extra: 1 } }, { op: 'stare', args: { rulare_id: null, stare: 'x', motiv: null } },
    { op: 'stare', args: { rulare_id: 5, stare: 'citita', motiv: null }, alt: 1 }, { op: 'needs_human', args: { rulare_id: 1, dezacord_id: 2, item_sha256: 'h', motiv: null } }]) {
    assert.equal(apelDinCorp(corp).ok, false, JSON.stringify(corp))
  }
  const p = apelDinCorp({ op: 'pagina', args: { rulare_id: 1, document_id: 2, pagina: 3, banda: 0, cititor: 'lighton', text: 't', stare: 'citit',
    model_rev: 'm', raw_sha256: 'h', image_sha256: null, garda: null, segmente: [['text', 't']] } })
  assert.ok(p.ok && p.fn === 'fn_ofertare_ocr_scrie_pagina' && Object.keys(p.args).length === 12)
})

// Paritatea amprentei cu scripts/ocr_local/compare.py item_hash (Jakarinos r3 P2): obiectele NEMODIFICATE din fișierul generat de
// Python (testul Python test_amprente_edge_identice le recalculează în Python) trebuie să dea EXACT hash-ul lor în TS.
Deno.test('amprenta dezacordului = compare.item_hash (Python), pe obiectele nemodificate din fișierul de paritate', async () => {
  const fixt = JSON.parse(await Deno.readTextFile(new URL('./ocrLocal_amprente.json', import.meta.url)))
  assert.ok(fixt.length >= 3)
  for (const it of fixt) assert.equal(await amprentaDezacord(it), it.item_sha256, it.id)
  assert.notEqual(await amprentaDezacord({ ...fixt[0], citire_lighton: fixt[0].citire_lighton + ' ' }), fixt[0].item_sha256)
})
Deno.test('canonic: separatorii Python și tipuri nepermise → excepție', () => {
  assert.equal(canonic({ b: [1, true, null], a: '' }), '{"a": "", "b": [1, true, null]}')
  assert.throws(() => canonic(1.5)); assert.throws(() => canonic({ a: undefined })); assert.throws(() => canonic(NaN))
})

Deno.test('erori RPC → coduri HTTP', () => {
  assert.equal(statusDinEroare({ code: '22023' }), 422); assert.equal(statusDinEroare({ code: '55000' }), 409)
  assert.equal(statusDinEroare({ code: '23505' }), 409); assert.equal(statusDinEroare({ code: 'P0002' }), 404)
  assert.equal(statusDinEroare({ code: 'XX000' }), 500); assert.equal(statusDinEroare(null), 500)
})

Deno.test('corp: citit în flux, oprit la limită și fără Content-Length (Jakarinos r1 P2)', async () => {
  let trimis = 0
  const flux = new ReadableStream<Uint8Array>({ pull(ctl) { trimis += 1000; ctl.enqueue(new Uint8Array(1000)); if (trimis >= 1_000_000) ctl.close() } })
  const r = await citesteCorp(new Request('https://x.invalid', { method: 'POST', body: flux, duplex: 'half' } as RequestInit), 4096)
  assert.deepEqual(r, { ok: false, status: 413, error: 'Corp prea mare' }); assert.ok(trimis < 20_000, String(trimis))
  assert.deepEqual(await citesteCorp(new Request('https://x.invalid', { method: 'POST', body: '{"a":1}' }), 4096), { ok: true, corp: { a: 1 } })
  assert.equal((await citesteCorp(new Request('https://x.invalid', { method: 'POST', body: '{"a":' }), 4096)).ok, false)
  assert.equal((await citesteCorp(new Request('https://x.invalid', { method: 'POST', body: new Uint8Array([0x7b, 0xff, 0x7d]) }), 4096)).ok, false)
})

Deno.test('imagine: doar PNG cu dimensiuni din IHDR; base64 strict; sha', async () => {
  assert.deepEqual(dimensiuniPng(png(1600, 400)), { w: 1600, h: 400 })
  assert.equal(dimensiuniPng(png(0, 400)), null); assert.equal(dimensiuniPng(png(30000, 10)), null)
  assert.equal(dimensiuniPng(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(40).fill(0)])), null)
  assert.equal(dinBase64('a b'), null); assert.equal(dinBase64('abc'), null); assert.deepEqual(dinBase64('YQ=='), new Uint8Array([97]))
  assert.equal(await sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
})

Deno.test('cost: limita = octeți text + imaginea (formula × 2) + ambalaj + max ieșire; rotunjire în sus; preț pe model', () => {
  assert.equal(tokeniImagineMax(1500, 750), 3000)
  const lim = limitaCost(octeti('ăș€'), 1500, 750, 'claude-sonnet-5')  // 7 octeți
  assert.equal(lim, Math.ceil(((7 + 3000 + 300) * 2e-6 + MAX_TOKENI_IESIRE * 10e-6) * 1e4 - 1e-9) / 1e4)
  // orice consum real care respectă „un token ≥ un octet” și formula imaginii încape
  assert.ok(costReal(7 + 1500 + 300, MAX_TOKENI_IESIRE, 'claude-sonnet-5') <= lim)
  assert.equal(costReal(3000, 300, 'claude-sonnet-5'), 0.009); assert.equal(costReal(3001, 300, 'claude-sonnet-5'), 0.0091)
  assert.equal(costReal(3000, 200, 'claude-haiku-5-5'), 0.0004)                    // 0,10 / 0,50 $ pe 1M
  assert.equal(costReal(200_000, 0, 'claude-haiku-5-5'), 0.1)                     // peste 100K tokeni: 0,50 $ pe 1M
  assert.throws(() => costReal(1, 1, 'claude-necunoscut')); assert.throws(() => limitaCost(1, 10, 10, 'claude-necunoscut'))
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

Deno.test('diferentaNumerica = compare.numeric_diff (paritate pe ocrLocal_cifre.json, verificat și din Python)', async () => {
  const cazuri: [string, string, boolean][] = JSON.parse(await Deno.readTextFile(new URL('./ocrLocal_cifre.json', import.meta.url)))
  assert.ok(cazuri.length > 100)
  for (const [a, b, asteptat] of cazuri) assert.equal(diferentaNumerica(a, b), asteptat, JSON.stringify([a, b]))
})
