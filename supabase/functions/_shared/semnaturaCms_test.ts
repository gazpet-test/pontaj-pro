// deno test -A supabase/functions/_shared/semnaturaCms_test.ts — desfacerea semnăturii CMS (.p7s / .p7m) din cele două edge-uri.
// Semnături REALE, generate cu openssl (cert de test, fără rețea). Copilot conv. 3, NO-GO r1 pe #644: o semnătură .p7m
// detașată nu are voie să intre sub numele documentului semnat.
import { strict as assert } from 'node:assert'
import { desfaSemnatura, semnaturaFaraContinut } from './semnaturaCms.ts'

async function semneaza(continut: Uint8Array, mod: 'atasat' | 'detasat' | 'flux'): Promise<Uint8Array> {
  const d = await Deno.makeTempDir()
  const run = async (args: string[]) => {
    const o = await new Deno.Command('openssl', { args, cwd: d, stdout: 'null', stderr: 'piped' }).output()
    assert.equal(o.code, 0, `openssl ${args[0]}: ${new TextDecoder().decode(o.stderr)}`)
  }
  try {
    await Deno.writeFile(`${d}/in.bin`, continut)
    await run(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'k.pem', '-out', 'c.pem', '-days', '1', '-subj', '/CN=test'])
    const extra = mod === 'atasat' ? ['-nodetach'] : mod === 'flux' ? ['-nodetach', '-stream'] : []
    await run(['cms', '-sign', '-binary', ...extra, '-in', 'in.bin', '-signer', 'c.pem', '-inkey', 'k.pem', '-outform', 'DER', '-out', 'out.bin'])
    return await Deno.readFile(`${d}/out.bin`)
  } finally { await Deno.remove(d, { recursive: true }) }
}
const pdf = (n: number) => { const b = new Uint8Array(n); b.set(new TextEncoder().encode('%PDF-1.4 ')); for (let i = 9; i < n; i++) b[i] = i % 251; return b }
const egal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i])

Deno.test('.p7m și .p7s cu conținut atașat (DER și flux fragmentat): conținutul exact, numele fără extensia de semnătură', async () => {
  const mic = pdf(2_000), mare = pdf(200_000)   // fluxul (-stream) taie conținutul în OCTET STRING-uri de câte ~1 KB
  for (const [nume, buf, original] of [
    ['Caiet.pdf.p7m', await semneaza(mic, 'atasat'), mic],
    ['Caiet.pdf.p7s', await semneaza(mic, 'atasat'), mic],
    ['Raspuns.rar.p7m', await semneaza(mare, 'flux'), mare],
  ] as const) {
    const r = desfaSemnatura(buf, nume)
    assert.equal(r.desfacut, true, nume)
    assert.equal(r.nume, nume.replace(/\.p7[ms]$/, ''))
    assert.ok(egal(r.buf, original), `${nume}: conținut diferit (${r.buf.length} vs ${original.length})`)
    assert.equal(semnaturaFaraContinut(nume, r), false)
  }
})

Deno.test('.p7m DETAȘAT: numele rămâne cu .p7m și apelantul îl refuză (nu ia locul lui Caiet.pdf)', async () => {
  const r = desfaSemnatura(await semneaza(pdf(2_000), 'detasat'), 'Caiet.pdf.p7m')
  assert.equal(r.desfacut, false)
  assert.equal(r.nume, 'Caiet.pdf.p7m')
  assert.equal(semnaturaFaraContinut('Caiet.pdf.p7m', r), true)
  const gunoi = desfaSemnatura(new TextEncoder().encode('nu e CMS'), 'Anexa.docx.p7m')
  assert.deepEqual([gunoi.desfacut, gunoi.nume, semnaturaFaraContinut('Anexa.docx.p7m', gunoi)], [false, 'Anexa.docx.p7m', true])
})

Deno.test('.p7s detașat / nedesfăcut: comportamentul istoric neschimbat (nume fără .p7s, nerefuzat); fără semnătură: neatins', async () => {
  const r = desfaSemnatura(await semneaza(pdf(2_000), 'detasat'), 'Caiet.pdf.p7s')
  assert.deepEqual([r.desfacut, r.nume, semnaturaFaraContinut('Caiet.pdf.p7s', r)], [false, 'Caiet.pdf', false])
  const simplu = pdf(100)
  const s = desfaSemnatura(simplu, 'Caiet.pdf')
  assert.deepEqual([s.desfacut, s.nume, s.buf === simplu, semnaturaFaraContinut('Caiet.pdf', s)], [false, 'Caiet.pdf', true, false])
})
