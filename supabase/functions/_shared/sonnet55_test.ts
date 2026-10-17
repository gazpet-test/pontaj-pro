// deno test --node-modules-dir=none --no-lock --allow-read supabase/functions/_shared/sonnet55_test.ts
// Trecerea Sonnet 5 → Sonnet 5.5 (17.10.2026) = „același comportament, alt ID”. Sursa: skill-ul claude-api, tabelul Thinking & Effort:
//   Sonnet 5   — fără parametrul `thinking`: rulează ADAPTIVE (gândește implicit); `disabled` acceptat.
//   Sonnet 5.5 — fără parametrul `thinking`: rulează ADAPTIVE (la fel); `disabled` = 400 → cea mai joasă setare e `between_tools`.
// Deci: (1) funcțiile care NU trimiteau `thinking` gândeau deja implicit pe Sonnet 5 (vezi comentariile din triere / ingest /
// parse-certificat-plata: „Sonnet 5 gândește implicit … intră în max_tokens”) și rămân EXACT așa — a le pune `between_tools` ar fi o
// schimbare de comportament, nu o păstrare; (2) funcțiile care trimiteau `disabled` trec pe `faraGandire(model)` (between_tools pe 5.5);
// (3) cele cu `adaptive` explicit rămân adaptive. Testul fixează cele trei grupe pe sursă, ca o schimbare viitoare să fie deliberată.
import { strict as assert } from 'node:assert'

const rad = new URL('../', import.meta.url)
const sursa = (f: string) => Deno.readTextFileSync(new URL(f, rad))
const TRIMITE_THINKING = /\bthinking\s*:/

// (2) trimiteau thinking disabled pe Sonnet 5 → faraGandire(model)
const FARA_GANDIRE = ['ofertare-ingest-doc/index.ts', 'ofertare-ocr-arbitreaza/arbitreaza.ts', 'ofertare-triere/index.ts', 'ofertare-clauze-formulare/index.ts']
// (1) nu trimiteau thinking (adaptive implicit pe Sonnet 5 ȘI pe Sonnet 5.5)
const ADAPTIV_IMPLICIT = ['citeste-orice/index.ts', 'detect-ordine/index.ts', 'meta-publish/index.ts', 'ofertare-clarificare-aplica/index.ts',
  'ofertare-document-nou-citeste/index.ts', 'ofertare-e0-autofill/index.ts', 'ofertare-organigrama-spec/index.ts', 'ofertare-raspuns-set/index.ts',
  'ofertare-rfq-import/index.ts', 'ofertare-verificare-finala/index.ts', 'parse-certificat-plata/index.ts', 'ofertare-cerinte/core.ts']
// (3) adaptive explicit
const ADAPTIV_EXPLICIT = ['ofertare-genereaza-capitol/index.ts', 'ofertare-clarificari-propune/core.ts']

Deno.test('Sonnet 5.5: nicio funcție nu mai trimite thinking disabled pe Sonnet (400); cele 4 de pe disabled trec pe faraGandire(model)', () => {
  for (const f of FARA_GANDIRE) {
    const s = sursa(f)
    assert.ok(s.includes("from '../_shared/gandire.ts'"), f + ': lipsește importul faraGandire')
    assert.ok(/thinking: faraGandire\((MODEL|model)\)/.test(s), f + ': thinking nu e pe model')
    assert.ok(!/thinking\s*:\s*\{\s*type\s*:\s*'disabled'/.test(s), f + ': a rămas thinking disabled literal')
  }
})

Deno.test('Sonnet 5.5: funcțiile fără thinking rămân fără (adaptive implicit, ca pe Sonnet 5); cele adaptive explicit rămân adaptive', () => {
  for (const f of ADAPTIV_IMPLICIT) assert.ok(!TRIMITE_THINKING.test(sursa(f)), f + ': a apărut un parametru thinking — schimbare de comportament față de Sonnet 5')
  for (const f of ADAPTIV_EXPLICIT) assert.ok(sursa(f).includes("thinking: { type: 'adaptive' }"), f + ': nu mai e adaptive explicit')
})

Deno.test('Sonnet 5.5: toate cele 18 funcții cer claude-sonnet-5-5; claude-sonnet-5 rămâne doar ca istoric / alias', () => {
  for (const f of [...FARA_GANDIRE.filter((f) => !f.startsWith('ofertare-ocr-arbitreaza/')), ...ADAPTIV_IMPLICIT, ...ADAPTIV_EXPLICIT, 'ofertare-citire-test/index.ts']) {
    assert.ok(sursa(f).includes("'claude-sonnet-5-5'"), f + ': nu cere claude-sonnet-5-5')
  }
  assert.ok(sursa('ofertare-ocr-arbitreaza/prompt.ts').includes("export const MODEL_ARBITRU = 'claude-sonnet-5-5'"))
  // 'claude-sonnet-5' (exact) apare doar ca alias spre 5.5 sau ca preț istoric al arbitrului
  for (const f of [...FARA_GANDIRE, ...ADAPTIV_IMPLICIT, ...ADAPTIV_EXPLICIT, 'ofertare-citire-test/index.ts', 'ofertare-ocr-arbitreaza/prompt.ts']) {
    const linii = sursa(f).split('\n').filter((l) => l.includes("'claude-sonnet-5'") && !l.trim().startsWith('//'))
    for (const l of linii) assert.ok(/ALIAS/.test(l), f + ': claude-sonnet-5 în afara aliasului: ' + l.trim())
  }
})
