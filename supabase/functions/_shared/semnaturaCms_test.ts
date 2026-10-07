// deno test -A supabase/functions/_shared/semnaturaCms_test.ts — desfacerea semnăturii (var. B, Răzvan 07.10.2026; audit #8/#20)
// Containerele reale se generează cu openssl (ca test-fixtures/seap_terra/run.sh); fără openssl, testele lor se sar.
import { strict as assert } from 'node:assert'
import { cheiSeap, cheieRand, continutCms, desface, eSemnat, numeDesfacut, numeSeapEchivalente, NOTA_DESFACERE_ESUATA, NOTA_SEMNATURA_DETASATA } from './semnaturaCms.mjs'

const enc = (s: string) => new TextEncoder().encode(s)
const eq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i])

let dir: string | null = null
async function openssl(args: string[]) {
  const p = await new Deno.Command('openssl', { args, cwd: dir!, stdout: 'null', stderr: 'piped' }).output()
  if (!p.success) throw new Error(new TextDecoder().decode(p.stderr))
}
async function semneaza(continut: Uint8Array, opt: { detasat?: boolean; flux?: boolean } = {}): Promise<Uint8Array | null> {
  try {
    if (!dir) {
      dir = await Deno.makeTempDir({ prefix: 'cms_' })
      await openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'k.pem', '-out', 'c.pem', '-days', '1', '-subj', '/CN=test'])
    }
    await Deno.writeFile(`${dir}/in.bin`, continut)
    await openssl(['cms', '-sign', '-binary', ...(opt.detasat ? [] : ['-nodetach']), ...(opt.flux ? ['-stream'] : []),
      '-in', 'in.bin', '-signer', 'c.pem', '-inkey', 'k.pem', '-outform', 'DER', '-out', 'out.p7s'])
    return await Deno.readFile(`${dir}/out.p7s`)
  } catch (e) {
    console.log('SKIP (openssl indisponibil):', (e as Error).message.slice(0, 120))
    return null
  }
}

Deno.test('nume: .p7s ca până acum; .p7m pe arhivă → arhiva; .p7m pe document → „X (semnat).ext” (var. B)', () => {
  assert.equal(numeDesfacut('Caiet.pdf.p7s'), 'Caiet.pdf')
  assert.equal(numeDesfacut('PT.zip.p7s'), 'PT.zip')
  assert.equal(numeDesfacut('Raspuns consolidat.rar.p7m'), 'Raspuns consolidat.rar')
  assert.equal(numeDesfacut('X.part1.rar.P7M'), 'X.part1.rar')
  assert.equal(numeDesfacut('PT-liste de cantitati.pdf.p7m'), 'PT-liste de cantitati (semnat).pdf')
  assert.equal(numeDesfacut('Formular de propunere tehnica.docx.p7m'), 'Formular de propunere tehnica (semnat).docx')
  assert.equal(numeDesfacut('Dir (#5)/Anexa.PDF.p7m'), 'Dir (#5)/Anexa (semnat).PDF')
  for (const n of ['Caiet.pdf', 'X.p7m', 'p7m', '', 'Caiet.pdf.p7m.bak']) assert.equal(numeDesfacut(n), n, n)
  assert.ok(eSemnat('a.pdf.p7s') && eSemnat('a.rar.p7m') && eSemnat('a.doc.p7m') && eSemnat('x.p7s'))
  assert.ok(!eSemnat('a.pdf') && !eSemnat('X.p7m') && !eSemnat(null as unknown as string))
  // numele desfăcut se termină în extensia reală: consumatorii care decid după „.pdf” merg neschimbați
  assert.match(numeDesfacut('Caiet de sarcini_canalizare Vingard.pdf.p7m'), /\.pdf$/)
})

Deno.test('numeSeapEchivalente: dedup-ul caută și numele brut (urcat înainte de B), și cel desfăcut', () => {
  assert.deepEqual(numeSeapEchivalente('X.pdf.p7m'), ['X.pdf.p7m', 'X (semnat).pdf'])
  assert.deepEqual(numeSeapEchivalente('X.pdf.p7s'), ['X.pdf.p7s'])   // .p7s: cheieNume îl taie deja (echivalența veche)
  assert.deepEqual(numeSeapEchivalente('X.pdf'), ['X.pdf'])
  // arhiva semnată NU e echivalentă cu arhiva nesemnată deja urcată (Copilot NO-GO r2 pe #644): se descarcă și se compară sha
  assert.deepEqual(numeSeapEchivalente('Raspuns.zip.p7m'), ['Raspuns.zip.p7m'])
  assert.deepEqual(numeSeapEchivalente('PT.part1.rar.p7m'), ['PT.part1.rar.p7m'])
})

Deno.test('CMS real: OCTET STRING primitiv, BER în flux (bucăți, lungimi nedefinite) → conținut identic', async () => {
  const mic = enc('%PDF-1.4 mic\n%%EOF')
  const mare = new Uint8Array(300_000).map((_, i) => (i * 31 + 7) & 0xff)
  const a = await semneaza(mic)
  if (!a) return
  assert.ok(eq(continutCms(a), mic))
  const b = await semneaza(mare, { flux: true })
  assert.ok(b && eq(continutCms(b), mare), 'BER constructed, indefinite')
  const c = await semneaza(mare)
  assert.ok(c && eq(continutCms(c), mare), 'DER primitiv mare')
  const r = desface(a, 'Caiet.pdf.p7m')
  assert.deepEqual([r.stare, r.nume, r.nota], ['desfacut', 'Caiet (semnat).pdf', null])
  assert.ok(eq(r.buf, mic))
})

Deno.test('CMS sintetic: OCTET STRING „constructed” cu lungimi DEFINITE (bucăți de 64 KB, ca SEAP) → lipite în ordine', () => {
  const der = (tag: number, ...parti: Uint8Array[]) => {
    const len = parti.reduce((s, p) => s + p.length, 0)
    const l = len < 128 ? [len] : (() => { const o: number[] = []; let x = len; while (x) { o.unshift(x & 0xff); x = Math.floor(x / 256) } return [0x80 | o.length, ...o] })()
    const out = new Uint8Array(1 + l.length + len); out[0] = tag; out.set(l, 1)
    let p = 1 + l.length; for (const x of parti) { out.set(x, p); p += x.length }
    return out
  }
  const oid = (b: number[]) => der(0x06, new Uint8Array(b))
  const continut = new Uint8Array(150_000).map((_, i) => (i * 13) & 0xff)
  const bucati = [continut.subarray(0, 65536), continut.subarray(65536, 131072), continut.subarray(131072)].map(x => der(0x04, x))
  const econtent = der(0xa0, der(0x24, ...bucati))
  const eci = der(0x30, oid([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x01]), econtent)
  const sd = der(0x30, der(0x02, new Uint8Array([1])), der(0x31), eci, der(0x31))
  const ci = der(0x30, oid([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02]), der(0xa0, sd))
  assert.ok(eq(continutCms(ci), continut))
  // alt tip de container (nu SignedData) → refuzat, nu „desfăcut” la întâmplare
  const altul = der(0x30, oid([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x03]), der(0xa0, sd))
  assert.throws(() => continutCms(altul), /SignedData/)
  // Jakarinos #4 pe #649: ambalajul [0] cu DOUĂ conținuturi → refuzat (nu „desfăcut” cu primul); ambalaj gol → eroare, nu „detașat”
  const cuEci = (eciX: Uint8Array) => der(0x30, oid([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02]),
    der(0xa0, der(0x30, der(0x02, new Uint8Array([1])), der(0x31), eciX, der(0x31))))
  const idData = oid([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x01])
  assert.throws(() => continutCms(cuEci(der(0x30, idData, der(0xa0, der(0x04, new Uint8Array([1, 2])), der(0x04, new Uint8Array([3])))))), /mai multe conținuturi/)
  assert.throws(() => continutCms(cuEci(der(0x30, idData, der(0xa0)))), /ambalajul conținutului e gol/)
  assert.equal(desface(cuEci(der(0x30, idData, der(0xa0))), 'X.pdf.p7m').stare, 'esuat', 'gol ≠ detașat')
  assert.equal(desface(cuEci(der(0x30, idData)), 'X.pdf.p7m').stare, 'detasat')
  // structură construită care nu e OCTET STRING în conținut → refuzat
  assert.throws(() => continutCms(cuEci(der(0x30, idData, der(0xa0, der(0x30, der(0x04, new Uint8Array([1]))))))), /nu e OCTET STRING/)
})

Deno.test('Jakarinos #7 pe #649: arhiva .p7m rămâne întreagă pe edge / veghe / api (o desface workerul)', async () => {
  const { desfaceFaraArhiveP7m, eArhivaP7m } = await import('./semnaturaCms.mjs')
  const a = await semneaza(enc('PK\u0003\u0004 zip'))
  if (!a) return
  assert.ok(eArhivaP7m('X.rar.p7m') && !eArhivaP7m('X.pdf.p7m') && !eArhivaP7m('X.zip.p7s'))
  const r = desfaceFaraArhiveP7m(a, 'Raspuns.zip.p7m')
  assert.deepEqual([r.stare, r.nume], ['nesemnat', 'Raspuns.zip.p7m'])
  assert.ok(eq(r.buf, a))
  assert.equal(desfaceFaraArhiveP7m(a, 'Raspuns.zip.p7s').nume, 'Raspuns.zip', '.p7s pe arhivă se desface ca înainte')
  assert.equal(desfaceFaraArhiveP7m(a, 'Caiet.pdf.p7m').stare, 'desfacut')
})

Deno.test('#20: desfacere eșuată → numele rămâne cu sufixul, conținutul brut, nota explicită (nu PDF fals)', async () => {
  const gunoi = enc('nu sunt CMS, nici PDF')
  const r = desface(gunoi, 'Caiet.pdf.p7s')
  assert.equal(r.stare, 'esuat')
  assert.equal(r.nume, 'Caiet.pdf.p7s')
  assert.ok(eq(r.buf, gunoi))
  assert.ok(r.nota?.startsWith(NOTA_DESFACERE_ESUATA), r.nota ?? '')
  // trunchiat → eroare, niciodată conținut parțial
  const a = await semneaza(new Uint8Array(200_000).fill(7))
  if (a) for (const taie of [a.length >> 1, 10, 0]) assert.throws(() => continutCms(a.slice(0, taie)), Error, `taie ${taie}`)
})

Deno.test('semnătură DETAȘATĂ → stare „detasat”, numele original, nota „doar semnătura” (nu intră în poartă ca lipsă)', async () => {
  const d = await semneaza(enc('%PDF-1.4 x'), { detasat: true })
  if (!d) return
  const r = desface(d, 'Formular.pdf.p7m')
  assert.deepEqual([r.stare, r.nume], ['detasat', 'Formular.pdf.p7m'])
  assert.ok(r.nota?.startsWith(NOTA_SEMNATURA_DETASATA))
})

Deno.test('nesemnat deși numele spune semnat: PDF / ZIP deja în formatul interior → păstrat, sub numele desfăcut', () => {
  const pdf = enc('%PDF-1.7 publicat fara semnatura')
  const r = desface(pdf, 'Caiet.pdf.p7s')
  assert.deepEqual([r.stare, r.nume], ['desfacut', 'Caiet.pdf'])
  assert.ok(eq(r.buf, pdf))
  const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0])
  assert.equal(desface(zip, 'Formular.docx.p7m').nume, 'Formular (semnat).docx')
  // dar un PDF sub nume de .docx nu trece drept docx
  assert.equal(desface(pdf, 'Formular.docx.p7m').stare, 'esuat')
})

Deno.test('fișier nesemnat după nume → neatins', () => {
  const b = enc('%PDF-1.4')
  const r = desface(b, 'Caiet.pdf')
  assert.deepEqual([r.stare, r.nume, r.nota], ['nesemnat', 'Caiet.pdf', null])
  assert.equal(r.buf, b)
})

Deno.test('copia din api/ e identică byte cu byte (funcțiile Vercel nu importă din afara api/)', async () => {
  const sursa = await Deno.readFile(new URL('./semnaturaCms.mjs', import.meta.url))
  const copie = await Deno.readFile(new URL('../../../api/_semnaturaCms.js', import.meta.url))
  assert.ok(eq(sursa, copie))
})

Deno.test('cheieRand / cheiSeap (Copilot NO-GO r1 pe #649): rândul brut „X.pdf.p7s” (detașat / nedesfăcut) NU e „X.pdf”', () => {
  const cheieNume = (n: unknown) => String(n ?? '').replace(/\.p7s$/i, '').toLowerCase().replace(/[,()]/g, '').replace(/\s+/g, '')
  assert.equal(cheieRand('Caiet.pdf.p7s', cheieNume), 'caiet.pdf.p7s')
  assert.equal(cheieRand('Caiet.pdf', cheieNume), 'caiet.pdf')
  assert.equal(cheieRand('Caiet (semnat).pdf', cheieNume), 'caietsemnat.pdf')
  // un nume SEAP nesemnat nu găsește rândul brut → documentul real se descarcă
  assert.ok(!cheiSeap('Caiet.pdf', cheieNume).includes(cheieRand('Caiet.pdf.p7s', cheieNume)))
  // numele SEAP semnat găsește atât rândul desfăcut („Caiet.pdf”), cât și rândul brut (nu se re-descarcă la fiecare rulare)
  assert.deepEqual(cheiSeap('Caiet.pdf.p7s', cheieNume), ['caiet.pdf', 'caiet.pdf.p7s'])
  assert.deepEqual(cheiSeap('Caiet.pdf.p7m', cheieNume), ['caiet.pdf.p7m', 'caietsemnat.pdf'])
  assert.deepEqual(cheiSeap('Raspuns.zip.p7m', cheieNume), ['raspuns.zip.p7m'])
})
