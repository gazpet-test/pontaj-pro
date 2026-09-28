// Validare pe PostgreSQL local existent. NU recreează BD, NU citește .env.
// PGURI trebuie să indice loopback și să nu conțină override-uri libpq.
// Implicit: preview clone în BEGIN/ROLLBACK (necesită schema și sursa 5).
// --apply-test cere AUDIT_V2_RESPONSABIL_ID; clonează, verifică și șterge în
// aceeași tranzacție, apoi ROLLBACK. Secvențele locale pot avansa.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const base = new URL('../../', import.meta.url);
const read = name => readFileSync(new URL(`docs/AUDIT_OFERTARE_V2/${name}`, base), 'utf8');
export function localTarget(raw) {
  if (!raw) throw new Error('PGURI absent; SQL NU a fost validat pe PostgreSQL real.');
  const uri = new URL(raw);
  if (!['postgres:', 'postgresql:'].includes(uri.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(uri.hostname)
    || uri.search || uri.hash || !/^\/[A-Za-z0-9_-]+$/.test(uri.pathname)) {
    throw new Error('Refuz PGURI: numai loopback, nume simplu de bază și fără query/fragment.');
  }
  return uri.href;
}

export function sqlLocal({ apply = false, responsabil = '' } = {}) {
  let clone = read('90_SANDBOX_CLONA.sql');
  let rollback = read('91_SANDBOX_ROLLBACK.sql');
  if (apply) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(responsabil)) {
      throw new Error('--apply-test cere AUDIT_V2_RESPONSABIL_ID UUID al contului local existent.');
    }
    clone = clone.replace("v_mod text := 'preview';", "v_mod text := 'apply';")
      .replace('v_responsabil_id uuid := NULL;', `v_responsabil_id uuid := '${responsabil}';`);
    rollback = rollback.replace("v_mod text := 'preview';", "v_mod text := 'apply';")
      .replace('v_clona bigint := NULL;', "v_clona bigint := (SELECT id_nou FROM map_audit_v2 WHERE tabela='ofertare_licitatii' AND id_vechi=5);");
  }
  return `BEGIN;\nSET LOCAL lock_timeout='3s';\nSET LOCAL statement_timeout='60s';\n${clone}\n${apply ? rollback : ''}\nROLLBACK;\n`;
}

function main() {
  try {
    const target = localTarget(process.env.PGURI);
    const input = sqlLocal({ apply: process.argv.includes('--apply-test'), responsabil: process.env.AUDIT_V2_RESPONSABIL_ID });
    const env = { ...process.env, PGCONNECT_TIMEOUT: '5', PGCLIENTENCODING: 'UTF8',
      PGHOSTADDR: new URL(target).hostname === '[::1]' ? '::1' : '127.0.0.1' };
    // Un PGSERVICE/PGHOSTADDR moștenit nu poate redirecționa localhost către remote.
    delete env.PGSERVICE;
    delete env.PGSERVICEFILE;
    delete env.PGOPTIONS;
    // Nu afișăm URI, stdout/NOTICE (conține rânduri) sau excepții ale driverului.
    const result = spawnSync(process.env.PSQL_BIN || 'psql', ['-X', '--no-password', '-q', '-v', 'ON_ERROR_STOP=1', '--dbname', target, '--file', '-'], {
      input, encoding: 'utf8', windowsHide: true, timeout: 180000, maxBuffer: 64 * 1024 * 1024,
      env,
    });
    if (result.error || result.status !== 0) {
      // Mesaj generic intenționat: libpq poate include URL-ul sau date de autentificare.
      throw new Error(result.error?.code === 'ENOENT'
        ? 'psql indisponibil; SQL NU a fost validat pe PostgreSQL real.'
        : 'PostgreSQL a refuzat validarea; tranzacția nu a fost comisă. Verificați local schema, rolul și logul serverului.');
    }
    console.log(`PASS PostgreSQL local: ${process.argv.includes('--apply-test') ? 'clonare + rollback' : 'preview clonare'} în BEGIN/ROLLBACK.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
