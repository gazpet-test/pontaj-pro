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

// Jakarinos r1 #755 (P2), confirmat de pagina oficială de prețuri (platform.claude.com/docs/en/about-claude/pricing, 17.10.2026:
// „On Claude Opus 5.5 and Claude Sonnet 5.5, a cache hit costs 5% of the standard input price … $0.10 USD on Claude Sonnet 5.5”)
// și de mailul Anthropic din 17.10. Skill-ul claude-api (cache 06.10) încă dădea 0,20 — e în urmă. Sonnet 5.5: intrare 2, ieșire 10,
// cache write 5 min 2,50 (1,25×), cache hit 0,10 (0,05×). Sonnet 5 rămâne 0,1× (0,20). Testul evaluează FORMULA REALĂ din
// genereaza-capitol (singura funcție atinsă care plătește cache) pe un cache hit.
Deno.test('Sonnet 5.5, cache: genereaza-capitol taxează cache hit 0,10 $/MTok (0,05×) și cache write 2,50 $/MTok (formula din sursă)', () => {
  const s = sursa('ofertare-genereaza-capitol/index.ts')
  const pret = s.match(/^const PRICE_IN = ([0-9.]+) \/ 1e6, PRICE_OUT = ([0-9.]+) \/ 1e6/m)
  const citire = s.match(/^const PRICE_CACHE_READ = ([0-9.]+) \/ 1e6/m)
  assert.ok(pret && citire, 'PRICE_IN / PRICE_OUT / PRICE_CACHE_READ negăsite')
  const PRICE_IN = Number(pret![1]) / 1e6, PRICE_OUT = Number(pret![2]) / 1e6, PRICE_CACHE_READ = Number(citire![1]) / 1e6
  const f = s.match(/cost \+= (\(u\.input_tokens \|\| 0\) \* PRICE_IN \+ cacheW \* PRICE_IN \* [0-9.]+ \+ cacheR \* PRICE_CACHE_READ \+ \(u\.output_tokens \|\| 0\) \* PRICE_OUT)/)
  assert.ok(f, 'formula de cost negăsită')
  const cost = new Function('u', 'cacheW', 'cacheR', 'PRICE_IN', 'PRICE_OUT', 'PRICE_CACHE_READ', 'return ' + f![1]) as
    (u: any, w: number, r: number, i: number, o: number, c: number) => number
  const c = (u: any, w: number, r: number) => cost(u, w, r, PRICE_IN, PRICE_OUT, PRICE_CACHE_READ)
  const aproape = (a: number, b: number) => Math.abs(a - b) < 1e-9
  // cache hit: 1M tokeni citiți din cache, 2.000 necache-uiți, 500 ieșire
  assert.ok(aproape(c({ input_tokens: 2000, output_tokens: 500 }, 0, 1_000_000), 2000 * 2e-6 + 0.10 + 500 * 10e-6))
  assert.ok(aproape(c({}, 0, 1_000_000), 0.10))          // cache hit 0,10 $/MTok (0,05 × 2), NU 0,20
  assert.ok(aproape(c({}, 1_000_000, 0), 2.50))          // cache write 5 min 2,50 $/MTok
  assert.ok(aproape(c({ input_tokens: 1_000_000, output_tokens: 1_000_000 }, 0, 0), 12))  // 2 + 10
  assert.ok(!/cacheR \* PRICE_IN \* 0\.1\b/.test(s), 'a rămas rata veche 0,1× pe cache hit')
})
