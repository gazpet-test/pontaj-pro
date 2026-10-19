// Offline, fără instalări: Node 24. Rulează testele Deno pure și handler-ele reale cu I/O simulat.
// node --test scripts/test-ofertare-p1b.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks, stripTypeScriptTypes } from 'node:module'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import * as haiku from '../supabase/functions/_shared/haiku55.ts'
import * as core from '../supabase/functions/ofertare-organigrama-spec/core.ts'
import * as felii from '../supabase/functions/ofertare-document-nou-citeste/felii.ts'
import * as lucru from '../supabase/functions/ofertare-document-nou-citeste/lucru.ts'
import * as sursa from '../supabase/functions/ofertare-document-nou-citeste/sursa.ts'
import * as obiect from '../supabase/functions/ofertare-document-nou-citeste/obiect.ts'
import { scrieCitireNoi } from '../supabase/functions/ofertare-document-nou-citeste/scriere.ts'

// Adaptor doar pentru assert-urile folosite de testele existente; nu accesează JSR/rețeaua.
registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'jsr:@std/assert@1') return { shortCircuit: true, url: 'data:text/javascript,' + encodeURIComponent(`
    import a from 'node:assert/strict';
    export const assert = a, assertEquals = a.deepStrictEqual;
    export const assertFalse = (v, m) => a.equal(v, false, m);
  `) }
  return next(specifier, context)
} })
globalThis.Deno = {
  test: (options, fn) => {
    const name = typeof options === 'string' ? options : options.name
    const run = fn ?? options.fn
    return name.startsWith('eTimeout recunoaște abortul real')
      ? test(name, { skip: 'Necesită Deno.serve și rețea locală; rularea este strict offline.' }, run)
      : test(name, run)
  },
  readTextFileSync: p => readFileSync(p, 'utf8'),
}
for (const file of ['ofertare-organigrama-spec/core_test.ts', ...['felii', 'lucru', 'obiect', 'scriere', 'sursa'].map(n => `ofertare-document-nou-citeste/${n}_test.ts`)]) {
  await import(new URL(`../supabase/functions/${file}`, import.meta.url))
}

const linii = Object.fromEntries(['asociati', 'subcontractanti', 'beneficiar', 'proiectant', 'diriginte', 'biunivoc_cu_seful_de_santier'].map(k => [k, false]))
const spec = { obligatorie: true, faze: ['executie'], roluri_cerute: [{ rol: 'RTE' }], linii_cerute: linii,
  personal_pe_categorii: [], per_operator: false, tabel_nominal: { cerut: false, coloane: [] },
  corelare_grafic: false, documente_suport: [], format: { observatii: null }, domenii_isc_din_obiect: [], avertismente: [] }
const citire = { tip: 'document_nou', rezumat: 'Rezumat nou', modificari: [], intrebari_raspunse: [], termene: [] }
const raspuns = (j, stop = 'end_turn') => ({ stop_reason: stop, content: [{ type: 'thinking', thinking: 'ignorat' }, { type: 'text', text: JSON.stringify(j) }] })

async function invoca(nume, data, { status = 200, mod = 'text' } = {}) {
  const writes = []
  const row = nume === 'ofertare-clarificare-citeste'
    ? { id: 1, fisier_path: 'L/a.pdf', intrebare: 'Întrebare existentă', citita_la: 'vechi', citita_rezumat: 'Rezumat existent' }
    : { id: 1, licitatie_id: 1, nume_original: 'a.pdf', fisier_path: 'L/a.pdf', tip: 'alta', status_procesare: 'procesat',
      procesat_la: 'vechi', text_extras: mod === 'pdf' ? null : 'Document sursă. '.repeat(60), analiza_la: 'vechi',
      analiza: { citire_noi: { rezumat: 'Rezumat existent', citit_la: '2020-01-01' }, plansa: { ok: true } } }
  const organigrama = { id: 1, spec: { vechi: true }, spec_la: 'vechi', noduri: [{ id: 'păstrat' }] }
  const before = JSON.stringify({ row, organigrama })
  const db = {
    rpc: async () => ({ data: true }),
    storage: { from: () => ({ download: async () => ({ data: new Blob(['%PDF-1.0']) }),
      list: async () => ({ data: [{ name: 'a.pdf', id: 'obiect', updated_at: 'vechi', metadata: { size: 8 } }] }) }) },
    from: table => {
      let patch
      const b = {
        select: () => b, eq: () => b, is: () => b, not: () => b,
        update: p => { patch = p; return b }, insert: p => { patch = p; return b },
        maybeSingle: async () => ({ data: structuredClone(table === 'ofertare_organigrama' ? organigrama : row) }),
        then: (ok, ko) => (async () => {
          if (patch) {
            writes.push({ table, patch })
            if (table === 'ofertare_organigrama') Object.assign(organigrama, patch)
            if (['ofertare_documente_atribuire', 'ofertare_clarificari'].includes(table)) Object.assign(row, patch)
            return { data: [{ id: 1 }] }
          }
          return { data: table === 'ofertare_cerinte' ? [{ id: 1, text_cerinta: 'Organigrama echipei' }] : [] }
        })().then(ok, ko),
      }
      return b
    },
  }
  let handler
  const ctx = { ...haiku, ...core, ...felii, ...lucru, ...sursa, ...obiect, scrieCitireNoi,
    Request, Response, Blob, AbortSignal, Uint8Array, Date, crypto, atob, btoa, console,
    createClient: () => db,
    Deno: { serve: fn => { handler = fn }, env: { get: () => 'intern' } },
    fetch: async () => new Response(JSON.stringify(data), { status }),
    termenRO: () => '', caleBlocata: async () => null, documentEligibil: async () => ({ eligibil: true }),
    filtreazaDerivate: async (_db, _id, rows) => ({ ok: true, pastrate: rows }),
    eligibilitateLicitatie: async () => ({ ok: true, harta: {} }), esteEligibil: () => true,
  }
  if (mod === 'sinteza') {
    // Stare validă cu toate fragmentele deja citite; testăm apelul final de sinteză.
    ctx.imparteCuGranite = () => ({ felii: ['a', 'b'], granite: ['intrebare'], la: [1] })
    const parte = felii.parteDinAi(citire, 'end_turn', 1, 1)
    ctx.lucruPentru = () => ({ lucru: { inceput_la: new Date().toISOString(), parti: { 0: parte, 1: parte } } })
    ctx.urmatoareaFelie = () => -1
  }
  const file = new URL(`../supabase/functions/${nume}/index.ts`, import.meta.url)
  const source = readFileSync(file, 'utf8').replace(/^import .*$/gm, '')
  runInNewContext(stripTypeScriptTypes(source), ctx, { filename: file.pathname })
  const result = await handler(new Request('https://local.invalid', { method: 'POST',
    headers: { authorization: 'Bearer intern', 'x-radar-secret': 'intern', 'content-type': 'application/json' },
    body: JSON.stringify({ licitatie_id: 1, clarificare_id: 1, document_id: 1 }) }))
  return { result: await result.json(), writes, before, after: JSON.stringify({ row, organigrama }) }
}

for (const [nume, valid, moduri] of [
  ['ofertare-organigrama-spec', spec, ['text']],
  ['ofertare-clarificare-citeste', { rezumat: 'Rezumat nou' }, ['text']],
  ['ofertare-document-nou-citeste', citire, ['text', 'pdf', 'sinteza']],
]) {
  for (const mod of moduri) {
    for (const [caz, data, status] of [
      ['HTTP eșuat cu JSON valid', raspuns(valid), 429],
      ['max_tokens cu JSON valid', raspuns(valid, 'max_tokens')],
      ['refuz cu JSON valid', raspuns(valid, 'refusal')],
      ['fără text', { content: [{ type: 'thinking', thinking: '...' }] }],
      ['text alb', { content: [{ type: 'text', text: '  \n' }] }],
      ['JSON invalid', { content: [{ type: 'text', text: '{' }] }],
      ['obiect gol', raspuns({})],
      ['obiect parțial', raspuns(nume === 'ofertare-organigrama-spec' ? { faze: ['executie'], roluri_cerute: [{ rol: 'RTE' }] } : { nr_intrebari: 2, referinte: ['F3'] })],
      ['rezumat alb', raspuns({ rezumat: '   ' })],
      ['rezumat obiect', raspuns({ rezumat: { text: 'invalid' } })],
    ]) test(`P1 handler ${nume}/${mod}: ${caz} → eroare, zero scrieri`, async () => {
      const r = await invoca(nume, data, { status, mod })
      assert.ok(r.result.error)
      assert.deepEqual(r.writes, [])
      assert.equal(r.after, r.before)
    })
    test(`P1 handler ${nume}/${mod}: rezultat valid → scrierea existentă funcționează`, async () => {
      const r = await invoca(nume, raspuns(valid), { mod })
      assert.equal(r.result.ok, true, JSON.stringify(r.result))
      assert.ok(r.writes.length > 0)
      assert.notEqual(r.after, r.before)
    })
  }
}
