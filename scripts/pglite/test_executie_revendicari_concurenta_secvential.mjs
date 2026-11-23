// Validarea SECVENȚIALĂ (fără concurență) a scriptului supabase/tests/20261224a_executie_revendicari_concurenta.sh pe PGlite:
// SQL-ul extras de blocul lui python (mutant „nu”), fixturile lui (heredoc-ul), apelurile EXACTE generate de funcțiile lui bash (ca / rez / dosar /
// termen) și verificările lui de stare. Ordinea A apoi B (după COMMIT-ul lui A) dă, în modul normal, aceleași rezultate ca bariera.
// Nu dovedește concurența (o face scriptul pe PG17): dovedește că SQL-ul și așteptările lui sunt corecte (mutanții lui cer concurența reală).
// Rulare (din rădăcina repo-ului; cere bash + python3 în PATH): npm install --no-save @electric-sql/pglite && node scripts/pglite/test_executie_revendicari_concurenta_secvential.mjs
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, mkdtempSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const R = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SH = readFileSync(join(R, 'supabase/tests/20261224a_executie_revendicari_concurenta.sh'), 'utf8').replace(/\r/g, '')
const D = mkdtempSync(join(tmpdir(), 'conc_sec_'))
const py = SH.split("<<'PY'\n")[1].split('\nPY\n')[0]
execFileSync('bash', ['-c', 'python3 - "$@"', '_', ...['supabase/tests/20261224a_executie_revendicari_schelet.sql', 'supabase/migrations/20261209a_executie_acces_proiect.sql',
  'supabase/migrations/20261203a_executie_contract_repere.sql', 'supabase/migrations/20261224a_executie_revendicari.sql'].map((p) => join(R, p)), D, 'nu'], { input: py, encoding: 'utf8' })
// funcțiile bash ale scriptului (definițiile exacte), chemate prin bash
const fnBash = ['ca', 'rez', 'dosar', 'termen'].map((f) => { const i = SH.indexOf(`\n${f}() {`); const j = SH.indexOf('\n}', i) >= 0 && !SH.slice(i + 1, SH.indexOf('\n', i + 1)).trim().endsWith('}') ? SH.indexOf('\n}', i) + 2 : SH.indexOf('\n', i + 1); return SH.slice(i + 1, j) }).join('\n')
const UID_OWNER = /UID_OWNER=(\S+)/.exec(SH)[1], UID_MP = /UID_MP=(\S+)/.exec(SH)[1]
const b = (expr) => execFileSync('bash', ['-c', `${fnBash}\nUID_OWNER=${UID_OWNER}; UID_MP=${UID_MP}\n${expr}`], { encoding: 'utf8' })
let rau = 0
const ok = (c, m) => { if (!c) rau++; console.log(`${c ? 'OK ' : 'NU '} ${m}`) }
const db = new PGlite()
await db.exec('CREATE ROLE anon NOLOGIN NOINHERIT; CREATE ROLE authenticated NOLOGIN NOINHERIT; CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;')
for (const f of ['schelet', 'restrictie', 'm03', 'contract_drept', 'ddl']) {
  try { await db.exec('BEGIN;\n' + readFileSync(join(D, f + '.sql'), 'utf8') + '\nCOMMIT;'); ok(true, 'aplicat ' + f) } catch (e) { ok(false, f + ': ' + e.message); await db.exec('ROLLBACK').catch(() => {}) }
}
const q1 = async (sql) => { const r = await db.query(sql, [], { rowMode: 'array' }); const row = r.rows[0]; return row ? row.map((v) => v === true ? 't' : v === false ? 'f' : String(v)).join('|') : '' }
const OB = await q1(`SELECT (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname LIKE 'fn\\_executie\\_revendicare\\_%'),
  (SELECT count(*) FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid WHERE NOT g.tgisinternal AND c.relnamespace = 'public'::regnamespace AND c.relname ~ '^executie_revendicar'),
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename ~ '^executie_revendicar'),
  (SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND relname ~ '^executie_revendicar' AND relrowsecurity)`)
ok(OB === '43|15|8|9', 'obiectele: 43|15|8|9 = ' + OB)
const fix = SH.split('-1 > /dev/null <<EOF\n')[1].split('\nEOF\n')[0].replaceAll('$UID_OWNER', UID_OWNER).replaceAll('$UID_MP', UID_MP)
try { await db.exec('BEGIN;\n' + fix + '\nCOMMIT;'); ok(true, 'fixturile') } catch (e) { ok(false, 'fixturile: ' + e.message) }
// o sesiune: BEGIN; prolog; SELECT … AS r; COMMIT → „<SQLSTATE> <r>”, ca \warn / \echo din script
async function sesiune(prolog, sql) {
  try { await db.exec('BEGIN;\n' + prolog); const r = await db.query(sql); await db.exec('COMMIT'); return '00000 ' + r.rows[0].r }
  catch (e) { await db.exec('ROLLBACK').catch(() => {}); return (e.code || 'XXXXX') + ' -' } finally { await db.exec('RESET ROLE').catch(() => {}) }
}
const faraId = (s) => s.replace(/:[^:]*$/, '')
const caO = b('ca "$UID_OWNER"'), caM = b('ca "$UID_MP"')
const uuid = () => crypto.randomUUID()
const dreptMP = async () => { await db.exec('BEGIN;\n' + caM); const r = await q1(`SELECT public.fn_executie_revendicare_drept(9301, 'scriere')::text || '|' || public.fn_executie_revendicare_drept(9301, 'citire')::text || '|' || (SELECT count(*) FROM public.executie_acces_proiect)::text`); await db.exec('COMMIT; RESET ROLE'); return r }
ok(await dreptMP() === 'true|true|0', 'MP-ul inainte: scriere | citire | restrictii = true|true|0')
// K1
let s = await sesiune(caO, b(`rez "$(dosar NULL NULL 'CONCURENTA-REV K1' ${uuid()})"`)); const D1 = s.split(':').pop()
ok(faraId(s) === '00000 true:false', 'K1 dosar creat: ' + s)
const V1 = Number(await q1(`SELECT versiune FROM public.executie_revendicari WHERE id = ${D1}`))
s = await sesiune(caO, b(`rez "$(dosar ${D1} ${V1} 'CONCURENTA-REV K1 A' ${uuid()})"`)); ok(faraId(s) === '00000 true:false', 'K1 A: ' + s)
s = await sesiune(caM, b(`rez "$(dosar ${D1} ${V1} 'CONCURENTA-REV K1 T' ${uuid()})"`)); ok(faraId(s) === '00000 false:conflict', 'K1 B (MP, versiunea veche): ' + s)
ok(await q1(`SELECT titlu || '|' || versiune FROM public.executie_revendicari WHERE id = ${D1}`) === `CONCURENTA-REV K1 A|${V1 + 1}`, 'K1 titlul | versiunea')
ok(await q1(`SELECT count(*) FROM public.executie_revendicare_jurnal WHERE dosar_id = ${D1} AND dupa ->> 'titlu' = 'CONCURENTA-REV K1 T'`) === '0', 'K1 jurnal fara B')
ok(await q1(`SELECT count(*) FROM public.executie_revendicare_chei WHERE dosar_id = ${D1}`) === '2', 'K1 cheile = 2')
// K2
let K = uuid()
s = await sesiune(caO, b(`rez "$(dosar NULL NULL 'CONCURENTA-REV K2' ${K})"`)); ok(faraId(s) === '00000 true:false', 'K2 A: ' + s)
const s2 = await sesiune(caO, b(`rez "$(dosar NULL NULL 'CONCURENTA-REV K2' ${K})"`)); ok(faraId(s2) === '00000 true:true', 'K2 B: ' + s2)
ok(await q1(`SELECT count(*) FROM public.executie_revendicari WHERE titlu = 'CONCURENTA-REV K2'`) === '1' && s2.split(':').pop() === s.split(':').pop(), 'K2 un dosar, acelasi id')
// K3
K = uuid()
s = await sesiune(caO, b(`rez "$(dosar NULL NULL 'CONCURENTA-REV K3 A' ${K})"`)); ok(faraId(s) === '00000 true:false', 'K3 A: ' + s)
s = await sesiune(caO, b(`rez "$(dosar NULL NULL 'CONCURENTA-REV K3 T' ${K})"`)); ok(s === '22023 -', 'K3 B: ' + s)
// K4
s = await sesiune(caO, b(`rez "$(dosar NULL NULL 'CONCURENTA-REV K4' ${uuid()})"`)); const D4 = s.split(':').pop()
const V4 = Number(await q1(`SELECT versiune FROM public.executie_revendicari WHERE id = ${D4}`))
s = await sesiune(caO, b(`rez "$(termen ${D4} ${uuid()})"`)); ok(faraId(s) === '00000 true:false', 'K4 A (termenul): ' + s)
ok(await q1(`SELECT versiune FROM public.executie_revendicari WHERE id = ${D4}`) === String(V4), 'K4 termenul nu schimba versiunea dosarului (B ar trece de CAS sub mutant)')
const cheieK4 = uuid()
const sqlB4 = b(`rez "$(dosar ${D4} ${V4} 'CONCURENTA-REV K4 T' ${cheieK4})"`)
await db.exec(`INSERT INTO public.executie_acces_proiect (profile_id, proiect_id, nivel) VALUES ('${UID_MP}', 9301, 'viewer')`)
s = await sesiune(caM, sqlB4); ok(s === '42501 -', 'K4 B (MP restrans): ' + s)
ok(await q1(`SELECT titlu FROM public.executie_revendicari WHERE id = ${D4}`) === 'CONCURENTA-REV K4', 'K4 titlul neschimbat')
ok(await q1(`SELECT count(*) FROM public.executie_revendicare_termene WHERE dosar_id = ${D4}`) === '1', 'K4 termenul lui A')
ok(await dreptMP() === 'false|true|1', 'MP-ul dupa restrictie: false|true|1')
// controlul căii legitime: fără restricție, MP-ul ar fi scris (dovada că 42501 vine din drept, nu din altă cauză)
await db.exec(`DELETE FROM public.executie_acces_proiect WHERE profile_id = '${UID_MP}'`)
s = await sesiune(caM, sqlB4); ok(faraId(s) === '00000 true:false', 'K4 control: fara restrictie, aceeasi salvare a MP-ului trece: ' + s)
await db.close()
console.log(rau ? `ESEC ${rau}` : 'TOTUL OK')
process.exit(rau ? 1 : 0)
