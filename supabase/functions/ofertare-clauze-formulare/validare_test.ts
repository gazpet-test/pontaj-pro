import { strict as assert } from 'node:assert'

Deno.test('clauze: orice element invalid respinge întregul set înainte de delete/insert, inclusiv după plafon', async () => {
  const src = await Deno.readTextFile(new URL('./index.ts', import.meta.url))
  const normSrc = src.slice(src.indexOf('export function normCitat'), src.indexOf('function textPentruModel'))
    .replace('export ', '').replace(/: string/g, '')
  const normCitat = new Function(normSrc + '\nreturn normCitat')()
  const start = src.indexOf("  if (ce === 'clauze') {")
  const bloc = src.slice(start, src.indexOf('  // formulare', start))
    .replace(/: any|: unknown|: number|: string\[\]/g, '').replace('new Set<string>()', 'new Set()')
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  const ruleaza = new AsyncFunction('ce', 'j', 'textNorm', 'normCitat', 'json', 'CATEGORII', 'IMPACT', 'licitatie', 'db',
    `const licId = licitatie, docId = 2, aruncate = [], doc = { nume_original: 'Contract' };
     const ferestre = false, tokIn = 0, tokOut = 0, PRICE_IN = 0, PRICE_OUT = 0;
     const str = (v, n) => v == null || v === '' ? null : String(v).slice(0, n);
     ${bloc}`)
  const citat = 'Plata se efectuează în termen de 30 de zile.'
  const valid = { categorie: 'plata', citat, valoare_structurata: { termen_zile: 30 },
    locator: null, impact: 'cashflow', evaluare_gazpet: 'Necesită finanțare.' }
  let stergeri = 0
  const inserari: any[] = []
  const verifica = async (clauze: unknown) => {
    stergeri = 0; inserari.length = 0
    const db = { from(t: string) {
      assert.equal(t, 'ofertare_clauze_contract')
      const q: any = {
        delete() { stergeri++; return q },
        insert(rows: any[]) { inserari.push(...rows); return q },
        select() { return q }, eq() { return q }, is() { return q },
        then(resolve: (v: unknown) => unknown) { return Promise.resolve({ data: [], error: null }).then(resolve) },
      }
      return q
    } }
    return await ruleaza('clauze', { clauze }, normCitat(citat), normCitat,
      (v: unknown) => v, ['plata'], ['cashflow'], 1, db)
  }
  for (const clauze of [[valid], [valid, valid], [{ ...valid, locator: 7, evaluare_gazpet: null }]]) {
    const r = await verifica(clauze); assert.equal(r.ok, true)
    assert.equal(stergeri, 1); assert.equal(inserari.length, 1)
  }
  for (const invalid of [null, {}, { ...valid, citat: null }, { ...valid, citat: 7 },
    { ...valid, citat: 'scurt' }, { ...valid, citat: 'Acest citat nu există în document.' },
    { ...valid, valoare_structurata: [] }, { ...valid, categorie: null }, { ...valid, locator: {} },
    { ...valid, impact: 'altceva' }]) {
    for (const clauze of [[valid, invalid], [...Array(60).fill(valid), invalid]]) {
      const r = await verifica(clauze); assert.ok(r.error)
      assert.equal(stergeri, 0); assert.equal(inserari.length, 0)
    }
  }
  for (const k of Object.keys(valid)) {
    const partial: any = { ...valid }; delete partial[k]
    assert.ok((await verifica([valid, partial])).error, k + ' lipsă')
    assert.equal(stergeri, 0); assert.equal(inserari.length, 0)
  }
  for (const clauze of [undefined, [], {}, [null]]) {
    assert.ok((await verifica(clauze)).error)
    assert.equal(stergeri, 0); assert.equal(inserari.length, 0)
  }
})
