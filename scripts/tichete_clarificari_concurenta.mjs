// Proba de CONCURENȚĂ pentru 20261223a (clarificări automate pe tichete) — DOAR pe CLONĂ PostgreSQL 17, cu DOUĂ sesiuni psql reale (L25).
// O rulează coordonatorul, DUPĂ ce a aplicat migrarea pe clonă (cu runnerul). Nu atinge producția: garda țintei = system_identifier
// (pg_control_system()) EXACT --sistem, altfel refuz (cod 22) înainte de orice scriere; o gazdă Supabase = refuz (22).
// Rulare (din rădăcina repo-ului; parola din pgpass, niciodată pe linia de comandă):
//   PSQL=<calea psql> node scripts/tichete_clarificari_concurenta.mjs --sistem <system_identifier al clonei> [--autor <uuid profil>]
//        [--mutant fara_lock] -- -h <host clonă> -p <port> -U postgres -d postgres
// Ce face: creează pe clonă tichete de PROBĂ (date inventate, titlu „PROBA CLONA clarificari”), rulează scenariile, apoi le șterge (cu
//   comentariile / istoricul lor, prin CASCADE, și notificările cu link-ul lor). Autorul = --autor sau primul profil care nu e owner.
//   ÎNAINTE de orice scriere: dacă vreun trigger de pe tichete / tichete_comentarii / notifications / tichete_istoric pare să trimită ceva în
//   afara bazei (http / net. / mail / sms / push / pg_notify), proba REFUZĂ (cod 24): pe clonă se dezactivează întâi.
// Sincronizare pe stări OBSERVATE (pg_stat_activity: A în PgSleep; B blocată de pid-ul lui A în pg_blocking_pids), nu pe timp.
// Scenarii (fiecare: OK / CONTRAR / PROBA_NEFUNCTIONALA = fereastra n-a fost prinsă, rezultatul nu se judecă):
//   C1 runda 1, două apeluri simultane: A trimite și ține tranzacția deschisă (pg_sleep 1.5 s); B cheamă aceeași rundă -> B stă blocată de A
//      (lock-ul rândului tichetului); A comite; B întoarce „deja_trimis”. Pe tichet: EXACT un comentariu automat și o notificare.
//   C2 încheierea (tăcere), la fel: după runda 1 cu mesajul mutat cu 10 zile în urmă, A încheie și ține tranzacția; B încheie -> blocată;
//      A comite; B întoarce „deja_incheiat”. EXACT un mesaj de încheiere și o notificare de încheiere.
//   T  triggerele REALE la scrierile noastre: un apel de runda 1 pe un tichet nou -> câte rânduri noi în tichete_istoric (istoric umflat?)
//      și ce notificări noi apar (cerut: EXACT una, a noastră, către autor). Notificările în plus = CONTRAR; istoricul se raportează.
// Mutant (--mutant fara_lock): fiecare sesiune își face în pg_temp o COPIE a funcției de trimitere fără „FOR NO KEY UPDATE” (funcția din
//   public nu se schimbă) și o cheamă pe aceea -> C1: două comentarii automate. Ieșire 0 = DEFECTUL reprodus (mutant PRINS).
// Ieșire: 0 = toate OK (cu --mutant: prins); 1 = CONTRAR; 26 = PROBA NEFUNCȚIONALĂ (prioritar); 22 = altă țintă; 23 = migrarea nu e pe clonă;
//   24 = triggere care pot trimite în afară; 2 = argumente.
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const citeste = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r/g, '')
const PSQL = process.env.PSQL || 'psql'
const argv = process.argv.slice(2), sep = argv.indexOf('--')
if (sep < 0) { console.error('lipsește „--” urmat de conexiune'); process.exit(2) }
const opt = argv.slice(0, sep), CONN = argv.slice(sep + 1)
const val = (n) => { const i = opt.indexOf(n); return i >= 0 ? opt[i + 1] : null }
const SISTEM = val('--sistem'), MUTANT = val('--mutant'), AUTOR = val('--autor')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
if (!/^\d+$/.test(SISTEM || '') || (MUTANT && MUTANT !== 'fara_lock') || (AUTOR && !UUID.test(AUTOR))) {
  console.error('argumente: --sistem <număr> [--autor <uuid>] [--mutant fara_lock]'); process.exit(2)
}
if (CONN.some(x => /supabase\.(co|com)\b/i.test(x)) || /supabase\.(co|com)\b/i.test(process.env.PGHOST || '')) { console.error('refuz: gazda e Supabase (producția); proba rulează doar pe clonă'); process.exit(22) }
const delay = (ms) => new Promise(r => setTimeout(r, ms))
function psql(args, input, app) {
  return new Promise((res) => {
    const p = spawn(PSQL, ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-P', 'pager=off', ...CONN, ...args],
      { env: { ...process.env, PGCLIENTENCODING: 'UTF8', PGAPPNAME: app }, windowsHide: true })
    let out = '', err = ''
    p.stdout.setEncoding('utf8'); p.stderr.setEncoding('utf8')
    p.stdout.on('data', d => { out += d }); p.stderr.on('data', d => { err += d })
    p.on('error', e => res({ code: -1, out, err: err + String(e) }))
    p.on('close', code => res({ code, out, err }))
    p.stdin.end(input ?? '')
  })
}
const q = async (sql, app = 'clar_conc_obs') => {
  const r = await psql(['-t', '-A', '-F', '\t', '-f', '-'], sql, app)
  if (r.code !== 0) throw new Error('interogare picată: ' + r.err.trim())
  return r.out.replace(/\r/g, '').split('\n').filter(Boolean)
}
async function asteapta(cond, ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await cond()) return true; await delay(40) } return false }
const inSomn = (app) => async () => (await q(`SELECT count(*) FROM pg_stat_activity WHERE application_name = '${app}' AND wait_event = 'PgSleep'`))[0] === '1'
const blocataDe = (b, a) => async () => (await q(`SELECT count(*) FROM pg_stat_activity x, pg_stat_activity y
  WHERE x.application_name = '${b}' AND y.application_name = '${a}' AND y.pid = ANY (pg_blocking_pids(x.pid))`))[0] === '1'
const rezultat = (r) => { const m = r.out.match(/"rezultat"\s*:\s*"([a-z_]+)"/); return m ? m[1] : 'EROARE: ' + (r.err.trim().split('\n').find(l => /ERROR/.test(l)) || r.err.trim()).slice(0, 200) }

// mutantul: copia funcției de trimitere în pg_temp, fără lock-ul rândului (doar în sesiunea care o creează)
const MIG = citeste('supabase/migrations/20261223a_tichete_clarificari.sql')
const corpTrimite = (() => {
  const i = MIG.indexOf('CREATE FUNCTION public.fn_tichet_clarificare_trimite(')
  return MIG.slice(i, MIG.indexOf('$f$;', MIG.indexOf('AS $f$', i) + 6) + 4)
})()
const LOCK = 'FROM public.tichete x WHERE x.id = p_tichet_id FOR NO KEY UPDATE;'
if (!corpTrimite.includes(LOCK)) { console.error('copia mutantului: lock-ul nu se găsește în funcție'); process.exit(2) }
const MUT_FN = corpTrimite.replace('CREATE FUNCTION public.fn_tichet_clarificare_trimite(', 'CREATE FUNCTION pg_temp.fn_tichet_clarificare_trimite(')
  .replace('LANGUAGE plpgsql SECURITY DEFINER', 'LANGUAGE plpgsql').replace(LOCK, 'FROM public.tichete x WHERE x.id = p_tichet_id;')
const FN_TRIMITE = MUTANT === 'fara_lock' ? 'pg_temp.fn_tichet_clarificare_trimite' : 'public.fn_tichet_clarificare_trimite'
const preambul = MUTANT === 'fara_lock' ? MUT_FN + '\n' : ''

const stari = []
const nota = (sc, stare, text) => { stari.push(stare); console.log(`${sc}: ${stare} — ${text}`) }
let tichete = []
const curata = async () => {
  if (!tichete.length) return
  const lista = tichete.join(', ')
  await q(`BEGIN;
DELETE FROM public.notifications WHERE link_to IN (${tichete.map(t => `'/tichete?id=${t}'`).join(', ')});
DELETE FROM public.tichete WHERE id IN (${lista}) AND titlu LIKE 'PROBA CLONA clarificari%';
COMMIT;`)
  console.log(`curățenie: tichetele de probă ${lista} (cu comentariile / istoricul lor) și notificările lor șterse`)
  tichete = []
}

try {
  // ── ținta și precondițiile ──
  const [sistem] = await q('SELECT system_identifier FROM pg_control_system();')
  if (sistem !== SISTEM) { console.error(`refuz: ținta are system_identifier ${sistem}, nu ${SISTEM}`); process.exit(22) }
  const [aplicata] = await q(`SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname LIKE 'fn\\_tichet\\_clarificare\\_%';`)
  if (aplicata !== '7') { console.error(`migrarea 20261223a nu e aplicată pe clonă (${aplicata} funcții din 7)`); process.exit(23) }
  const [apelant] = await q('SELECT public.fn_tichet_clarificare_apelant_ok();')
  if (apelant !== 't') { console.error('conexiunea probei nu e acceptată ca apelant (session_user postgres, fără SET ROLE)'); process.exit(26) }
  const trimitAfara = await q(`SELECT tg.tgrelid::regclass::text || '.' || tg.tgname FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid
    WHERE NOT tg.tgisinternal AND tg.tgenabled <> 'D' AND tg.tgrelid IN ('public.tichete'::regclass, 'public.tichete_comentarii'::regclass, 'public.notifications'::regclass,
          coalesce(to_regclass('public.tichete_istoric'), 'public.tichete'::regclass))
      AND p.prosrc ~* '(http|\\mnet\\.|mail|\\msms|push|pg_notify)';`)
  if (trimitAfara.length) { console.error('refuz: triggere care pot trimite în afara bazei (dezactivează-le întâi pe clonă): ' + trimitAfara.join(', ')); process.exit(24) }
  const autor = AUTOR || (await q(`SELECT id FROM public.profiles WHERE is_owner IS NOT TRUE ORDER BY id LIMIT 1;`))[0]
  if (!autor) { nota('PRE', 'PROBA_NEFUNCTIONALA', 'niciun profil de autor pe clonă'); throw new Error('fara autor') }
  const tichetNou = async (eticheta) => {
    const [id] = await q(`INSERT INTO public.tichete (departament, subcategorie, titlu, descriere, urgenta, status, deschis_de, entitate_tip, entitate_descriere, metadata)
      VALUES ('it', 'eroare_erp', 'PROBA CLONA clarificari ${eticheta}', 'Tichet de proba pe clona (date inventate).', 'normal', 'deschis', '${autor}', 'pagina_app', '/proba-clona',
              '{"sursa": "bug_report", "tip": "bug", "pagina": "/proba-clona"}'::jsonb) RETURNING id;`)
    tichete.push(id)
    return id
  }
  const numara = async (t) => {
    const [r] = await q(`SELECT (SELECT count(*) FROM public.tichete_comentarii c WHERE c.tichet_id = ${t} AND c.autor IS NULL AND c.text LIKE 'Clarificare _/2' || chr(10) || '%') || '/' ||
      (SELECT count(*) FROM public.tichete_comentarii c WHERE c.tichet_id = ${t} AND c.autor IS NULL AND c.text LIKE 'Clarificările automate s-au încheiat.%') || '/' ||
      (SELECT count(*) FROM public.notifications n WHERE n.link_to = '/tichete?id=${t}' AND n.title LIKE '❓ Întrebări de clarificare%') || '/' ||
      (SELECT count(*) FROM public.notifications n WHERE n.link_to = '/tichete?id=${t}' AND n.title LIKE 'ℹ️ Clarificări încheiate%');`)
    const [runde, incheieri, nRunde, nIncheieri] = r.split('/').map(Number)
    return { runde, incheieri, nRunde, nIncheieri }
  }

  // ── C1: două apeluri simultane pentru aceeași rundă ──
  {
    const t = await tichetNou('C1')
    const A = psql(['-t', '-A', '-f', '-'], `${preambul}BEGIN;\nSELECT ${FN_TRIMITE}(${t}, 1, ARRAY['În ce ecran apare problema?']);\nSELECT pg_sleep(1.5);\nCOMMIT;\n`, 'clar_conc_A')
    if (!await asteapta(inSomn('clar_conc_A'))) { nota('C1', 'PROBA_NEFUNCTIONALA', 'A nu a ajuns în fereastră'); await A }
    else {
      const B = psql(['-t', '-A', '-f', '-'], `${preambul}SELECT ${FN_TRIMITE}(${t}, 1, ARRAY['Ce ai apăsat înainte?']);\n`, 'clar_conc_B')
      const blocata = await asteapta(blocataDe('clar_conc_B', 'clar_conc_A'), 1200)
      const [a, b] = await Promise.all([A, B])
      const n = await numara(t)
      const ra = rezultat(a), rb = rezultat(b)
      if (MUTANT === 'fara_lock') {
        nota('C1', n.runde === 2 ? 'OK' : 'CONTRAR', `mutant fara_lock: A=${ra}, B=${rb}, comentarii automate=${n.runde} (defectul = 2)`)
      } else if (!blocata) {
        nota('C1', 'PROBA_NEFUNCTIONALA', `B nu a fost observată blocată de A (A=${ra}, B=${rb}, comentarii=${n.runde})`)
      } else {
        nota('C1', ra === 'trimis' && rb === 'deja_trimis' && n.runde === 1 && n.nRunde === 1 ? 'OK' : 'CONTRAR',
          `A=${ra}, B=${rb} (blocată de A), comentarii automate=${n.runde}, notificări=${n.nRunde}`)
      }
    }
  }
  if (MUTANT !== 'fara_lock') {
    // ── C2: două încheieri simultane (tăcere) ──
    {
      const t = await tichetNou('C2')
      await q(`SELECT public.fn_tichet_clarificare_trimite(${t}, 1, ARRAY['Ce pași ai făcut?']);`)
      await q(`UPDATE public.tichete_comentarii SET created_at = now() - interval '10 days' WHERE tichet_id = ${t} AND autor IS NULL;`)
      const [act] = await q(`SELECT public.fn_tichet_clarificare_stare_tichet(${t}) ->> 'actiune';`)
      if (act !== 'de_escaladat_tacere') nota('C2', 'PROBA_NEFUNCTIONALA', `starea pregătită nu e de_escaladat_tacere (${act})`)
      else {
        const A = psql(['-t', '-A', '-f', '-'], `BEGIN;\nSELECT public.fn_tichet_clarificare_incheie(${t}, 'tacere');\nSELECT pg_sleep(1.5);\nCOMMIT;\n`, 'clar_conc_A')
        if (!await asteapta(inSomn('clar_conc_A'))) { nota('C2', 'PROBA_NEFUNCTIONALA', 'A nu a ajuns în fereastră'); await A }
        else {
          const B = psql(['-t', '-A', '-f', '-'], `SELECT public.fn_tichet_clarificare_incheie(${t}, 'tacere');\n`, 'clar_conc_B')
          const blocata = await asteapta(blocataDe('clar_conc_B', 'clar_conc_A'), 1200)
          const [a, b] = await Promise.all([A, B])
          const n = await numara(t)
          const ra = rezultat(a), rb = rezultat(b)
          if (!blocata) nota('C2', 'PROBA_NEFUNCTIONALA', `B nu a fost observată blocată de A (A=${ra}, B=${rb})`)
          else nota('C2', ra === 'incheiat' && rb === 'deja_incheiat' && n.incheieri === 1 && n.nIncheieri === 1 ? 'OK' : 'CONTRAR',
            `A=${ra}, B=${rb} (blocată de A), mesaje de încheiere=${n.incheieri}, notificări=${n.nIncheieri}`)
        }
      }
    }
    // ── T: triggerele reale la scrierile noastre ──
    {
      const t = await tichetNou('T')
      const ist = async () => (await q(`SELECT CASE WHEN to_regclass('public.tichete_istoric') IS NULL THEN -1 ELSE (SELECT count(*) FROM public.tichete_istoric WHERE tichet_id = ${t}) END;`))[0]
      // momentul de start (după crearea tichetului: notificările de „tichet nou” nu intră), apoi notificările noi legate de tichet
      const [t0] = await q('SELECT clock_timestamp()::text;')
      const i0 = Number(await ist())
      const r = await q(`SELECT public.fn_tichet_clarificare_trimite(${t}, 1, ARRAY['Ce mesaj apare pe ecran?']) ->> 'rezultat';`)
      const i1 = Number(await ist())
      const noi = await q(`SELECT n.profile_id::text || ' | ' || coalesce(n.title, '') || ' | ' || coalesce(n.link_to, '') FROM public.notifications n
        WHERE n.created_at >= '${t0}'::timestamptz AND (n.link_to LIKE '%tichete?id=${t}' OR n.link_to LIKE '%tichete?id=${t}&%' OR n.title LIKE '%PROBA CLONA%')
        ORDER BY n.created_at;`)
      const ale_noastre = noi.filter(l => l.startsWith(autor + ' | ❓ Întrebări de clarificare') && l.endsWith(`/tichete?id=${t}`))
      nota('T', r[0] === 'trimis' && noi.length === 1 && ale_noastre.length === 1 ? 'OK' : 'CONTRAR',
        `rezultat=${r[0]}; notificări noi=${noi.length} (a noastră: ${ale_noastre.length})${noi.length > 1 ? ' — în plus: ' + noi.filter(l => !ale_noastre.includes(l)).join(' ; ') : ''}`)
      console.log(`T: istoricul tichetului la o scriere doar pe metadata: ${i0 < 0 ? 'tabelul tichete_istoric nu există' : `${i1 - i0} rânduri noi`} (de raportat în review; 0 = neumflat)`)
    }
  }
} catch (e) {
  console.error('eroare: ' + e.message)
  stari.push('PROBA_NEFUNCTIONALA')
} finally {
  try { await curata() } catch (e) { console.error('curățenia a eșuat (de șters manual pe clonă, titlu „PROBA CLONA clarificari”): ' + e.message); stari.push('PROBA_NEFUNCTIONALA') }
}
const cod = stari.includes('PROBA_NEFUNCTIONALA') ? 26 : stari.includes('CONTRAR') ? 1 : 0
console.log(`\nREZULTAT: ${cod === 0 ? (MUTANT ? 'mutant PRINS' : 'toate OK') : cod === 1 ? 'CONTRAR' : 'PROBA NEFUNCTIONALA'} (cod ${cod})`)
process.exit(cod)
