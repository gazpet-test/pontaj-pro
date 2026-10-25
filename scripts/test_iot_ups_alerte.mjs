// Generate isolated PG fixtures from the existing function bodies, without a database connection.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { stripTypeScriptTypes } from 'node:module'

const root = resolve(import.meta.dirname, '..')
const read = p => readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n')
const old = read('supabase/migrations/20261023d_iot_retea_limite_ai.sql').split('$corp$')[1]
const migration = read('supabase/migrations/20261112a_iot_ups_alerte.sql')
const rollback = read('supabase/revenire/20261112a_iot_ups_alerte_ROLLBACK.sql')
const decode = sql => sql.split('$iot_ups_body_20261112a$')[1].replace(/@U(\d+)@/g, (_, n) => String.fromCharCode(Number(n)))
const md5 = s => createHash('md5').update(s).digest('hex')
assert.equal(md5(old), 'd6e0db3c7c2f6b49497b267e1bf06ac5')
assert.equal(decode(rollback), old)
const body = decode(migration)
assert.equal(body.replace(/\n    -- UPS: alerte cumulative,[\s\S]*?(?=  END LOOP;\n  RETURN n;)/, ''), old)
assert.ok(migration.includes(md5(body)))
assert.ok(rollback.includes(md5(body)))
for (const sql of [migration, rollback]) {
  assert.doesNotMatch(sql, /[^\x00-\x7f]|\r/)
  assert.match(sql, /current_user <> 'postgres'/)
  assert.match(sql, /pg_advisory_xact_lock\(hashtext\('gazpet.livrare_migrare'\)\)/)
}
// Exercise the exported pure UI helpers without requiring React or bundler dependencies.
const ui = read('src/Cladire.jsx')
const nr = ui.match(/^const nr = .*$/m)[0]
const helpers = ui.slice(ui.indexOf('export const UPS_PRAGURI'), ui.indexOf('// QNAP are card propriu'))
const { UPS_PRAGURI, nivelUps, textUps } = await import('data:text/javascript,' + encodeURIComponent(nr + '\n' + helpers))
assert.match(body, new RegExp(`IF valoare < ${UPS_PRAGURI.baterie} THEN`))
assert.match(body, new RegExp(`IF valoare < ${UPS_PRAGURI.oprire} THEN`))
for (const p of [0, 20, 25, 49.9]) assert.equal(nivelUps(p, true), 'error')
for (const p of [50, 80, 100]) assert.equal(nivelUps(p, true), 'warning')
for (const p of [0, 20, 100]) assert.equal(nivelUps(p, false), 'ok')
for (const p of [null, undefined, '92', NaN, -1, 101]) assert.equal(nivelUps(p, true), 'lipsa')
assert.equal(nivelUps(92, undefined), 'lipsa')
assert.equal(textUps({ ups_pct: 92, ups_pe_baterie: false }, 'njoy Echo Pro 2000'), 'UPS njoy Echo Pro 2000: 92% - pe retea')
assert.equal(textUps({ ups_pct: 40, ups_pe_baterie: true, ups_runtime_min: 0 }), 'UPS: 40% - pe baterie - autonomie estimata 0 min')
assert.equal(textUps({ ups_pct: 92 }), 'UPS: 92% - stare necunoscuta')
assert.equal(textUps({}), '')
console.log('PASS offline: exact old body, rollback MD5, ASCII/LF, SQL/UI thresholds, pure UI helpers')

// Compatibility execution of validator tests under Node 24. This is NOT a Deno run.
const validator = stripTypeScriptTypes(read('supabase/functions/iot-retea/valideaza.ts'))
const tests = stripTypeScriptTypes(read('supabase/functions/iot-retea/valideaza_test.ts')
  .replace(/^import .*;\n/gm, ''))
const compatibility = `import { deepStrictEqual as assertEquals } from 'node:assert/strict';
let count = 0;
const Deno = { test(name, fn) { fn(); count++; } };
${validator}
${tests}
console.log('PASS Node compatibility: ' + count + ' validator tests; Deno NOT run');`
await import('data:text/javascript,' + encodeURIComponent(compatibility))

if (process.argv[2]) {
  const output = resolve(process.argv[2])
  assert.ok(output.startsWith(root + '\\') || output.startsWith(root + '/'), 'fixture output must stay inside worktree')
  const alertSource = read('supabase/migrations/20260928o_cladire_notificari_modul.sql')
  const alertFunction = alertSource.slice(alertSource.indexOf('CREATE OR REPLACE FUNCTION public.iot_alerta('), alertSource.indexOf('\nREVOKE EXECUTE'))
  const fixture = `
CREATE TABLE public.iot_dispozitive (id bigserial PRIMARY KEY, sursa text, extern_id text, nume text, meta jsonb DEFAULT '{}', ultima_citire jsonb, citit_la timestamptz, activ boolean DEFAULT true);
CREATE TABLE public.profiles (id integer PRIMARY KEY, is_owner boolean);
INSERT INTO public.profiles VALUES (1, true);
CREATE TABLE public.notifications (profile_id integer REFERENCES public.profiles, type text, modul text, title text, message text, link_to text, created_at timestamptz DEFAULT now());
${alertFunction}
REVOKE ALL ON FUNCTION public.iot_alerta(text,text,text,text) FROM PUBLIC;
CREATE FUNCTION public.iot_verifica_retea() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $old_body$${old}$old_body$;
REVOKE ALL ON FUNCTION public.iot_verifica_retea() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.iot_verifica_retea() TO service_role;
INSERT INTO public.iot_dispozitive (sursa,extern_id,nume,ultima_citire,citit_la) VALUES ('retea','192.168.1.94','Server AI','{"online":true}',now());
`
  writeFileSync(join(output, 'fixture.sql'), fixture)
  console.log('Fixture generated; SQL has NOT been executed')
}
