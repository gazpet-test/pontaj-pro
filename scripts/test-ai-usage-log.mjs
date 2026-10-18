// Node 24, offline, fără instalări. Simulează doar runtime-ul Deno și importurile JSR.
// Rulează și handler_test.ts originale; nu înlocuiește deno check/test.
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const tests = [];
globalThis.Deno = {
  test: (name, fn) => tests.push({ name, fn }),
  env: { get: () => undefined },
  serve: () => {},
};
let rows = [], loggingError = null;
globalThis.__usageTestClient = {
  from(table) {
    assert.equal(table, 'ai_usage_log');
    return { insert(row) {
      if (loggingError === 'throw') throw new Error('log unavailable');
      if (loggingError === 'reject') return Promise.reject(new Error('log unavailable'));
      rows.push(row);
      return Promise.resolve({ error: loggingError === 'result' ? { message: 'log unavailable' } : null });
    } };
  },
};
globalThis.Supabase = { ai: { Session: class { async run() { return [0.1]; } } } };
// Orice apel de rețea accidental pică local.
globalThis.fetch = async () => { throw new Error('Network disabled in offline tests'); };

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('jsr:')) return { url: specifier, shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === 'jsr:@std/assert@1') return { format: 'module', shortCircuit: true,
      source: "export { ok as assert, deepStrictEqual as assertEquals } from 'node:assert/strict';" };
    if (url === 'jsr:@supabase/supabase-js@2') return { format: 'module', shortCircuit: true,
      source: 'export const createClient = () => globalThis.__usageTestClient;' };
    if (url.endsWith('/nightly_patrol_bot/index.ts') || url.endsWith('/rag-utilaj/index.ts')) {
      const exports = url.endsWith('/nightly_patrol_bot/index.ts')
        ? 'export { callAnthropic };' : 'export { transcribeBatch, searchAndAnswer };';
      return { format: 'module-typescript', shortCircuit: true, source: readFileSync(new URL(url), 'utf8') + '\n' + exports };
    }
    return next(url, context);
  },
});

await import('../supabase/functions/extract-talon-ai/handler_test.ts');
await import('../supabase/functions/detect_plate_orphan_msgs/handler_test.ts');
const { callAnthropic } = await import('../supabase/functions/nightly_patrol_bot/index.ts');
const { transcribeBatch, searchAndAnswer } = await import('../supabase/functions/rag-utilaj/index.ts');
const usage = { input_tokens: 100_001, output_tokens: 20, cache_read_input_tokens: 100, cache_creation_input_tokens: 40 };
const expectedCost = 100_001 * (0.50 / 1e6) + 100 * (0.50 / 1e6) * 0.1 + 40 * (0.50 / 1e6) * 1.25 + 20 * (2.50 / 1e6);
const answerClient = {
  ...globalThis.__usageTestClient,
  rpc: async () => ({ data: [{ sursa: 'manual', content: 'text', document_id: 1, similarity: 1 }] }),
};
const callers = [
  { slug: 'nightly_patrol_bot', call: () => callAnthropic({ model: 'claude-haiku-5-5' }, 0) },
  { slug: 'rag-utilaj', call: () => transcribeBatch('pdf', 1, 1, globalThis.__usageTestClient, 501) },
  { slug: 'rag-utilaj', call: () => searchAndAnswer(answerClient, 'question', null, true) },
];
tests.push({ name: 'usage: HTTP eșuat, refuz, trunchiere, cache/prag și jurnal best-effort pe patrol și ambele căi RAG', fn: async () => {
  for (const caller of callers) {
    for (const status of [200, 400, 500]) {
      for (const stop_reason of ['end_turn', 'refusal', 'max_tokens']) {
        rows = []; loggingError = null;
        globalThis.fetch = async () => new Response(JSON.stringify({ usage, stop_reason, content: [{ type: 'text', text: '[{"pagina":1,"text":"ok"}]' }] }), { status });
        try { await caller.call(); } catch (e) { assert.match(e.message, /^Anthropic/); }
        assert.equal(rows.length, 1);
        assert.equal(rows[0].function_name, caller.slug);
        assert.equal(rows[0].tokens_in, usage.input_tokens);
        assert.equal(rows[0].tokens_out, usage.output_tokens);
        assert.equal(rows[0].cost_usd, expectedCost);
      }
    }
    for (const failure of ['throw', 'reject', 'result']) {
      rows = []; loggingError = failure;
      globalThis.fetch = async () => new Response(JSON.stringify({ usage, content: [{ type: 'text', text: '[{"pagina":1,"text":"ok"}]' }] }));
      const result = await caller.call();
      assert.ok(result);
      if (caller.slug === 'nightly_patrol_bot') assert.equal(result.status, 200);
      else assert.ok(Array.isArray(result) || result.answer);
    }
  }
  loggingError = null;
} });
tests.push({ name: 'patrol: fiecare tentativă cu usage primește exact un rând, fără schimbarea retry-ului', fn: async () => {
  rows = []; let calls = 0;
  globalThis.fetch = async () => new Response(JSON.stringify({ usage, content: [] }), { status: ++calls === 1 ? 500 : 200 });
  const original = globalThis.setTimeout;
  globalThis.setTimeout = (fn) => original(fn, 0);
  try {
    const result = await callAnthropic({ model: 'claude-haiku-5-5' });
    assert.equal(result.status, 200); assert.equal(calls, 2); assert.equal(rows.length, 2);
  } finally { globalThis.setTimeout = original; }
} });

let failures = 0;
for (const { name, fn } of tests) {
  try { await fn(); console.log('PASS', name); }
  catch (e) { failures++; console.error('FAIL', name, e); }
}
console.log(`${tests.length - failures}/${tests.length} passed (Node offline harness)`);
process.exitCode = failures ? 1 : 0;
