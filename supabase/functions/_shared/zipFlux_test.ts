// deno test -A supabase/functions/_shared/zipFlux_test.ts — parserul ZIP în flux (audit Jakarinos #9 / #10)
// ZIP-urile reale se fac cu `zip` (Info-ZIP, ca în worker/ofertare/arhive_platforma_test.ts); fără el, testele lor se sar.
import { strict as assert } from 'node:assert'
import { Flux, fluxDinBuf, parcurgeZip, dezumfla } from './zipFlux.mjs'

const enc = (s: string) => new TextEncoder().encode(s)
async function zipCu(fisiere: Record<string, string | Uint8Array>, args: string[] = [], flux = false, intrari?: string[]): Promise<Uint8Array | null> {
  try {
    const d = await Deno.makeTempDir()
    for (const [n, c] of Object.entries(fisiere)) {
      await Deno.mkdir(`${d}/${n}`.replace(/\/[^/]+$/, ''), { recursive: true })
      await Deno.writeFile(`${d}/${n}`, typeof c === 'string' ? enc(c) : c)
    }
    // flux = scris pe stdout (pipe): Info-ZIP pune „data descriptor” cu mărimile 0 în antetul local
    const o = await new Deno.Command('zip', { args: ['-q', ...args, flux ? '-' : 'a.zip', ...(intrari ?? Object.keys(fisiere))], cwd: d, stdout: 'piped', stderr: 'piped' }).output()
    if (!o.success) throw new Error(new TextDecoder().decode(o.stderr))
    const buf = flux ? o.stdout : await Deno.readFile(`${d}/a.zip`)
    await Deno.remove(d, { recursive: true })
    return buf
  } catch (e) { console.log('SKIP (zip indisponibil):', String((e as Error).message).slice(0, 100)); return null }
}
// antetele locale, în ordine: [offset, nume, sfârșitul datelor] (fără data descriptor — zip pe fișier le are mărimile în antet)
function antete(z: Uint8Array): [number, string, number][] {
  const dv = new DataView(z.buffer, z.byteOffset, z.byteLength), out: [number, string, number][] = []
  for (let o = 0; o + 30 <= z.length && dv.getUint32(o, true) === 0x04034b50;) {
    const nl = dv.getUint16(o + 26, true), el = dv.getUint16(o + 28, true), cs = dv.getUint32(o + 18, true)
    const fin = o + 30 + nl + el + cs
    out.push([o, new TextDecoder().decode(z.subarray(o + 30, o + 30 + nl)), fin])
    o = fin
  }
  return out
}
async function parcurge(buf: Uint8Array, maxIesire = 20 * 1024 * 1024, vrea = (_h: unknown) => true) {
  const primite: [string, number][] = [], erori: [string, string][] = []
  const r = await parcurgeZip(fluxDinBuf(buf), vrea, async (h: { nume: string }, b: Uint8Array) => { primite.push([h.nume, b.length]); return 'continua' }, (n: string, m: string) => erori.push([n, m]), { maxIesire })
  return { r, primite, erori }
}

Deno.test('ZIP normal (stored + deflate, cu folder) → toate intrările, complet, folderele sărite', async () => {
  const z = await zipCu({ 'A.pdf': '%PDF-1.4 a', 'dir/B.txt': 'b'.repeat(5000) }, ['-r'], false, ['A.pdf', 'dir'])
  if (!z) return
  assert.ok(antete(z).some(([, n]) => n === 'dir/'), 'arhiva are intrarea de folder „dir/” (altfel testul nu dovedește nimic)')
  const { r, primite, erori } = await parcurge(z)
  assert.deepEqual([r.complet, r.motiv, erori], [true, null, []])
  assert.deepEqual(primite.sort(), [['A.pdf', 10], ['dir/B.txt', 5000]])
})

Deno.test('#9: arhivă trunchiată (fără directorul central) → complet=false cu motiv, nu „sfârșit normal”', async () => {
  const z = await zipCu({ 'A.pdf': '%PDF-1.4 a', 'B.pdf': '%PDF-1.4 ' + 'b'.repeat(3000) })
  if (!z) return
  // tăieturi calculate din antete (extra field-urile Info-ZIP fac offset-urile fixe greșite): în datele intrării 2, în
  // antetul ei, imediat după prima intrare (înaintea directorului central) și în antetul primei intrări
  const [[, nA, finA], [o2, nB, finB]] = antete(z)
  assert.deepEqual([nA, nB], ['A.pdf', 'B.pdf'])
  for (const taie of [finB - 1, o2 + 40, finA, 20]) {
    assert.ok(taie > 0 && taie < z.length, `taie ${taie} în interiorul arhivei`)
    const { r } = await parcurge(z.slice(0, taie))
    assert.equal(r.complet, false, `taie ${taie}`)
    assert.match(String(r.motiv), /trunchiat/, `taie ${taie}`)
  }
  // gunoi exact după prima intrare (nu în mijlocul ei) → „antet necunoscut”, nu trunchiere
  const gunoi = new Uint8Array([...z.slice(0, finA), 1, 2, 3, 4, 5, 6, 7, 8])
  const g = await parcurge(gunoi)
  assert.deepEqual([g.r.complet, g.primite.map(([n]) => n)], [false, ['A.pdf']])
  assert.match(String(g.r.motiv), /antet necunoscut 0x4030201/)
})

Deno.test('#9: intrare cu „data descriptor” și mărimi 0 în antet (ZIP scris în flux) → complet=false, nu intrări goale', async () => {
  const z = await zipCu({ 'A.pdf': '%PDF-1.4 ' + 'a'.repeat(4000) }, [], true)
  if (!z) return
  const { r, primite } = await parcurge(z)
  assert.equal(r.complet, false)
  assert.match(String(r.motiv), /data descriptor/)
  assert.deepEqual(primite, [])
})

Deno.test('#10: bombă — ieșirea peste limită → eroare pe intrare, oprit la plafon; mărimea din antet e plafonul', async () => {
  const z = await zipCu({ 'bomba.bin': new Uint8Array(30 * 1024 * 1024), 'mic.pdf': '%PDF-1.4 m' })
  if (!z) return
  assert.ok(z.length < 200_000, 'compresia face din 30 MB câțiva KB')
  const { r, primite, erori } = await parcurge(z, 20 * 1024 * 1024)
  assert.equal(r.complet, true)
  assert.deepEqual(primite, [['mic.pdf', 10]])
  assert.equal(erori.length, 1)
  assert.match(erori[0][1], /peste limita/)
  // antet mincinos: usize mic, conținut mare → oprit la mărimea declarată
  const zz = new Uint8Array(z)
  new DataView(zz.buffer).setUint32(22, 1000, true)   // prima intrare (bomba.bin) declară 1000 de octeți
  const m = await parcurge(zz, 20 * 1024 * 1024)
  assert.match(m.erori[0]?.[1] ?? '', /peste limita de 1000/)
})

Deno.test('intrare criptată / metodă necunoscută → eroare pe intrare (nu gunoi urcat), restul continuă', async () => {
  const z = await zipCu({ 'secret.pdf': '%PDF-1.4 s' }, ['-P', 'parola'])
  if (z) {
    const { r, primite, erori } = await parcurge(z)
    assert.deepEqual([r.complet, primite.length], [true, 0])
    assert.match(erori[0][1], /criptat/)
  }
  await assert.rejects(dezumfla(new Uint8Array([1, 2, 3]), 12, 1000), /nesuportat/)
})

Deno.test('mărime decomprimată ≠ antet → eroare (intrare coruptă), nu document trunchiat urcat', async () => {
  const z = await zipCu({ 'A.txt': 'a'.repeat(1000) }, ['-0'])   // stored
  if (!z) return
  const zz = new Uint8Array(z)
  new DataView(zz.buffer).setUint32(22, 999, true)   // usize mincinos, csize corect
  const { r, erori } = await parcurge(zz)
  assert.match(erori[0]?.[1] ?? '', /mărimi diferite în antet \(1000 ≠ 999\)/)
  assert.equal(r.complet, true, 'intrarea se sare în flux, parcurgerea rămâne aliniată până la directorul central')
})

Deno.test('#10 memorie: csize mincinos (uriaș) → eroare pe intrare fără buffer de octeți, nu citire în memorie', async () => {
  const z = await zipCu({ 'A.txt': 'a'.repeat(3000) })   // deflate
  if (!z) return
  const zz = new Uint8Array(z)
  new DataView(zz.buffer).setUint32(18, 0x7fff0000, true)   // csize ≈ 2 GB în antet
  const { r, primite, erori } = await parcurge(zz, 1024 * 1024)
  assert.match(erori[0]?.[1] ?? '', /peste limita de 1048576 — nu se citește în memorie/)
  assert.deepEqual([r.complet, primite], [false, []], 'sărirea consumă tot fluxul → trunchiată, nimic primit')
})

Deno.test('Flux: priveste nu consumă; exact/sari după', async () => {
  const f = fluxDinBuf(new Uint8Array([1, 2, 3, 4, 5, 6]))
  assert.deepEqual([...(await f.priveste(2))!], [1, 2])
  assert.deepEqual([...(await f.exact(3))!], [1, 2, 3])
  assert.equal(await f.sari(2), true)
  assert.deepEqual([...(await f.exact(1))!], [6])
  assert.equal(await f.exact(1), null)
  assert.ok(new Flux(new Blob([]).stream().getReader()))
})

Deno.test('copia din api/ e identică byte cu byte', async () => {
  const a = await Deno.readFile(new URL('./zipFlux.mjs', import.meta.url))
  const b = await Deno.readFile(new URL('../../../api/_zipFlux.js', import.meta.url))
  assert.ok(a.length === b.length && a.every((x, i) => x === b[i]))
})
