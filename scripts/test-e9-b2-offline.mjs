// Numai Node local. Execută testele pure cu shim Deno.test; NU validează Deno,
// pdf-lib, Worker sau PostgREST. Nicio instalare și nicio cerere de rețea.
import { test } from 'node:test'
import { readFile, readdir } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
const tests = []
globalThis.Deno = { test: (name, fn) => tests.push([name, fn]) }
globalThis.fetch = () => { throw new Error('Rețeaua este interzisă în harness') }
await import('../supabase/functions/izo-e3-ocr-local/handler_test.ts')
await import('../supabase/functions/ocr-packing-list/avizE3Handler_test.ts')
await import('../supabase/functions/ocr-packing-list/avizE3_test.ts')
test('sintaxă TypeScript B2, inclusiv entrypoint și validatorul Deno (fără typecheck)', async () => {
  const dir = new URL('../supabase/functions/izo-e3-ocr-local/', import.meta.url)
  for (const name of await readdir(dir)) if (name.endsWith('.ts')) stripTypeScriptTypes(await readFile(new URL(name, dir), 'utf8'))
})
for (const [name, fn] of tests) test(name, { concurrency: false }, fn)
