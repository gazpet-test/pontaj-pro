// deno test --node-modules-dir=none --no-lock --allow-read supabase/functions/ofertare-genereaza-capitol/scriere_test.ts
// Fix 17.10.2026: pe conflictul de versiune (INTERDICȚIA 4) funcția citea `obsId` înaintea lui `let obsId`. ReferenceError-ul era
// prins de catch-ul general ca „Eroare neasteptata”, deci mesajul de conflict nu ajungea la om. Urma (INTERDICȚIA 5) se scria
// DUPĂ text, iar dacă eșua, mesajul spunea „NU s-a salvat” deși textul era deja scris. BD simulată: se înregistrează ordinea scrierilor.
import { strict as assert } from 'node:assert'
import { amprenta, scrieCapitolCuUrma } from './scriere.ts'

type Op = { t: string; op: string; rand?: any; filtre: Record<string, unknown> }
// CHECK ofertare_pt_observatii_inchidere_chk (20260913_ofertare_pt_revizii.sql:54), reprodus în mock (Jakarinos r1 #756 P1):
// stare <> 'deschisa' cere rezolvat_la NOT NULL și raspuns negol, altfel UPDATE-ul e respins.
const CHECK_INCHIDERE = (r: any) => r.stare === undefined || r.stare === 'deschisa' || (r.rezolvat_la != null && String(r.raspuns ?? '').trim() !== '')
function bd(o: { conflict?: boolean; eroareUpd?: string; eroareObs?: string; eroareInchidere?: string } = {}) {
  const ops: Op[] = []
  const from = (t: string) => {
    const q: any = { filtre: {} as Record<string, unknown> }
    q.insert = (rand: any) => { q.op = 'insert'; q.rand = rand; return q }
    q.update = (rand: any) => { q.op = 'update'; q.rand = rand; return q }
    q.eq = (k: string, v: unknown) => { q.filtre[k] = v; return q }
    const rezultat = () => {
      ops.push({ t, op: q.op, rand: q.rand, filtre: q.filtre })
      if (t === 'ofertare_pt_observatii' && q.op === 'insert') return o.eroareObs ? { data: null, error: { message: o.eroareObs } } : { data: { id: 77 }, error: null }
      if (t === 'ofertare_pt_observatii' && q.op === 'update') {
        if (!CHECK_INCHIDERE(q.rand)) return { data: null, error: { message: 'new row for relation "ofertare_pt_observatii" violates check constraint "ofertare_pt_observatii_inchidere_chk"' } }
        if (o.eroareInchidere) return { data: null, error: { message: o.eroareInchidere } }
      }
      if (t === 'ofertare_pt_capitole' && q.op === 'update') {
        if (o.eroareUpd) return { data: null, error: { message: o.eroareUpd } }
        return { data: o.conflict ? [] : [{ id: q.filtre.id }], error: null }
      }
      return { data: null, error: null }
    }
    q.select = () => ({ single: async () => rezultat(), then: (r: any, j: any) => Promise.resolve(rezultat()).then(r, j) })
    q.then = (r: any, j: any) => Promise.resolve(rezultat()).then(r, j)   // update(...).eq(...) așteptat direct (închiderea urmei)
    return q
  }
  return { from, ops }
}
const NECONF = [{ id: 5, text_cerinta: 'Cerință A' }, { id: 9, text_cerinta: null }]
const P = { capId: 12, licitatieId: 95, versiune: 3, text: 'TEXT GENERAT', actorUid: 'u-1' }

Deno.test('conflict de versiune cu cerințe neconfirmate: răspuns de conflict (nu ReferenceError), urma scrisă ÎNAINTE și apoi închisă', async () => {
  const b = bd({ conflict: true })
  const r = await scrieCapitolCuUrma(b, { ...P, neconfirmate: NECONF })
  assert.deepEqual(r.ok ? null : r.motiv, 'conflict')
  assert.match(r.ok ? '' : r.mesaj, /modificat de altcineva/)
  assert.deepEqual(b.ops.map((x) => x.t + ':' + x.op), ['ofertare_pt_observatii:insert', 'ofertare_pt_capitole:update', 'ofertare_pt_observatii:update'])
  assert.deepEqual(b.ops[1].filtre, { id: 12, versiune: 3 })
  assert.deepEqual(b.ops[2].filtre, { id: 77 }); assert.equal(b.ops[2].rand.stare, 'rezolvata')
  // închiderea respectă CHECK-ul: rezolvat_la (ISO), raspuns, rezolvat_de = actorul; mock-ul ar fi respins-o altfel
  assert.ok(CHECK_INCHIDERE(b.ops[2].rand)); assert.ok(!Number.isNaN(Date.parse(b.ops[2].rand.rezolvat_la))); assert.equal(b.ops[2].rand.rezolvat_de, 'u-1')
  assert.equal(r.ok ? undefined : r.urma_neinchisa, undefined); assert.doesNotMatch(r.ok ? '' : r.mesaj, /DESCHISĂ/)
})

Deno.test('mock-ul reproduce CHECK-ul: închiderea fără rezolvat_la (forma din v2.3) e respinsă', () => {
  assert.equal(CHECK_INCHIDERE({ stare: 'rezolvata', raspuns: 'generarea nu s-a salvat' }), false)
  assert.equal(CHECK_INCHIDERE({ stare: 'rezolvata', rezolvat_la: '2026-10-17T10:00:00Z', raspuns: ' ' }), false)
  assert.equal(CHECK_INCHIDERE({ stare: 'rezolvata', rezolvat_la: '2026-10-17T10:00:00Z', raspuns: 'x' }), true)
})

Deno.test('închiderea urmei eșuează: eroarea NU e înghițită — logată, în mesaj și în urma_neinchisa; răspunsul rămâne de conflict', async () => {
  const loguri: string[] = []; const orig = console.error; console.error = (...a: unknown[]) => { loguri.push(a.join(' ')) }
  try {
    const b = bd({ conflict: true, eroareInchidere: 'permission denied' })
    const r = await scrieCapitolCuUrma(b, { ...P, neconfirmate: NECONF })
    assert.equal(r.ok ? null : r.motiv, 'conflict')
    assert.deepEqual(r.ok ? null : r.urma_neinchisa, { obsId: 77, eroare: 'permission denied' })
    assert.match(r.ok ? '' : r.mesaj, /modificat de altcineva.*observația #77 .* a rămas DESCHISĂ .*permission denied/)
    assert.equal(loguri.length, 1); assert.match(loguri[0], /urma 77 nu s-a putut închide: permission denied/)
    const e = await scrieCapitolCuUrma(bd({ eroareUpd: 'timeout', eroareInchidere: 'x' }), { ...P, neconfirmate: NECONF })
    assert.equal(e.ok ? null : e.motiv, 'eroare'); assert.deepEqual(e.ok ? null : e.urma_neinchisa, { obsId: 77, eroare: 'x' })
  } finally { console.error = orig }
})

Deno.test('conflict de versiune fără cerințe neconfirmate: răspuns de conflict, nicio urmă', async () => {
  const b = bd({ conflict: true })
  const r = await scrieCapitolCuUrma(b, { ...P, neconfirmate: [] })
  assert.equal(r.ok ? null : r.motiv, 'conflict')
  assert.deepEqual(b.ops.map((x) => x.t + ':' + x.op), ['ofertare_pt_capitole:update'])
})

Deno.test('eroare la scrierea textului: răspuns de eroare, urma închisă', async () => {
  const b = bd({ eroareUpd: 'timeout' })
  const r = await scrieCapitolCuUrma(b, { ...P, neconfirmate: NECONF })
  assert.equal(r.ok ? null : r.motiv, 'eroare'); assert.equal(r.ok ? '' : r.mesaj, 'textul nu s-a salvat: timeout')
  assert.deepEqual(b.ops.map((x) => x.t + ':' + x.op), ['ofertare_pt_observatii:insert', 'ofertare_pt_capitole:update', 'ofertare_pt_observatii:update'])
})

Deno.test('urma nu se poate scrie: textul NU se scrie (mesajul spune adevărul)', async () => {
  const b = bd({ eroareObs: 'rls' })
  const r = await scrieCapitolCuUrma(b, { ...P, neconfirmate: NECONF })
  assert.equal(r.ok ? null : r.motiv, 'fara_urma'); assert.match(r.ok ? '' : r.mesaj, /\(rls\) — textul generat NU s-a salvat/)
  assert.deepEqual(b.ops.map((x) => x.t + ':' + x.op), ['ofertare_pt_observatii:insert'])
})

Deno.test('succes: urma deschisă cu amprentele SHA-256, apoi textul cu sursa=ai pe versiunea citită; obsId întors', async () => {
  const b = bd()
  const r = await scrieCapitolCuUrma(b, { ...P, neconfirmate: NECONF })
  assert.deepEqual(r, { ok: true, obsId: 77 })
  const [obs, cap] = b.ops
  assert.equal(obs.rand.stare, 'deschisa'); assert.equal(obs.rand.capitol_id, 12); assert.equal(obs.rand.licitatie_id, 95); assert.equal(obs.rand.cerut_de, 'u-1')
  assert.ok(obs.rand.text.includes('Generare v4 cu 2 cerințe NECONFIRMATE') && obs.rand.text.includes(await amprenta(NECONF[0])) && obs.rand.text.includes(await amprenta(NECONF[1])))
  assert.match(await amprenta(NECONF[1]), /^#9:sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855$/)  // text null = șir gol
  assert.deepEqual(cap.rand, { continut: 'TEXT GENERAT', sursa: 'ai' }); assert.deepEqual(cap.filtre, { id: 12, versiune: 3 })
  assert.equal(b.ops.length, 2)
  const r2 = await scrieCapitolCuUrma(bd(), { ...P, neconfirmate: [] }); assert.deepEqual(r2, { ok: true, obsId: null })
})

Deno.test('index.ts folosește scriere.ts și nu mai are `obsId` citit înainte de declarare', () => {
  const s = Deno.readTextFileSync(new URL('./index.ts', import.meta.url))
  assert.ok(s.includes("import { scrieCapitolCuUrma } from './scriere.ts'"))
  assert.ok(!s.includes('let obsId') && !s.includes("from('ofertare_pt_observatii').insert"))
  assert.ok(s.includes('versiune_asteptata: cap.versiune || 1') && s.includes('fara_urma: true') && s.includes('urma_neinchisa: sc.urma_neinchisa'))
})
