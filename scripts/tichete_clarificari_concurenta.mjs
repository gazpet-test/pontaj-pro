// Proba de CONCURENȚĂ pentru 20261223a (clarificări automate pe tichete; r2: evidența în tabelul tichete_clarificari) — DOAR pe CLONĂ
// PostgreSQL 17, cu DOUĂ sesiuni psql reale (L25).
// O rulează coordonatorul, DUPĂ ce a aplicat migrarea pe clonă (cu runnerul). Nu atinge producția: garda țintei = system_identifier
// (pg_control_system()) EXACT --sistem, altfel refuz (cod 22) înainte de orice scriere; o gazdă Supabase = refuz (22).
// Rulare (din rădăcina repo-ului; parola din pgpass, niciodată pe linia de comandă):
//   PSQL=<calea psql> node scripts/tichete_clarificari_concurenta.mjs --sistem <system_identifier al clonei> [--autor <uuid profil>]
//        [--mutant fara_lock] -- -h <host clonă> -p <port> -U postgres -d postgres
// Ce face: creează pe clonă tichete de PROBĂ (date inventate, titlu „PROBA CLONA clarificari”), rulează scenariile, apoi le șterge (cu
//   comentariile / istoricul lor, prin CASCADE, rândurile lor din tichete_clarificari și notificările cu link-ul lor). Autorul = --autor
//   sau primul profil care nu e owner. Fiecare scriere primește versiune_context citită chiar înainte (ca rutina).
//   ÎNAINTE de orice scriere: dacă vreun trigger de pe tichete / tichete_comentarii / notifications / tichete_istoric pare să trimită ceva în
//   afara bazei (http / net. / mail / sms / push / pg_notify), proba REFUZĂ (cod 24): pe clonă se dezactivează întâi.
// Sincronizare pe stări OBSERVATE (pg_stat_activity: A în PgSleep; B blocată de pid-ul lui A în pg_blocking_pids), nu pe timp.
// Scenarii (fiecare: OK / CONTRAR / PROBA_NEFUNCTIONALA = fereastra n-a fost prinsă, rezultatul nu se judecă):
//   C1 runda 1, două apeluri simultane: A trimite și ține tranzacția deschisă (pg_sleep 1.5 s); B cheamă aceeași rundă -> B stă blocată de A
//      (lock-ul rândului tichetului); A comite; B întoarce „deja_trimis”. Pe tichet: EXACT un comentariu automat, o notificare, un rând.
//   C2 încheierea (tăcere), la fel: după runda 1 cu momentul ei (creat_la din evidență) mutat cu 10 zile în urmă, A încheie și ține
//      tranzacția; B încheie -> blocată; A comite; B întoarce „deja_incheiat”. EXACT un mesaj de încheiere, o notificare, un rând.
//   C3 un comentariu al autorului scris în timp ce A ține runda 1 deschisă: NU e blocat de A (KEY SHARE față de FOR NO KEY UPDATE) și,
//      nefiind în instantaneul rundei, e socotit răspuns la ea (de_evaluat_raspuns: rutina îl citește, nu escaladează tăcerea).
//   T  triggerele REALE la scrierile noastre: un apel de runda 1 pe un tichet nou -> câte rânduri noi în tichete_istoric (cerut: 0, tichetul
//      nu se mai modifică) și ce notificări noi apar (cerut: EXACT una, a noastră, către autor). Altceva = CONTRAR.
//   C4 (r3, P2) BARIERĂ PG17 în fereastra dintre verificare și scriere: runda 2 după răspunsul R1; A cheamă o COPIE în pg_temp a funcției
//      de trimitere, identică textual cu cea din migrare, care cheamă o copie a stării cu o barieră (pg_advisory_lock pe o cheie ținută de
//      B) după citirea evidenței; cât A stă la barieră (observat: wait_event advisory), C scrie și CONFIRMĂ un comentariu X al autorului
//      (ca din aplicație); B eliberează; A întoarce „trimis”. Cerut: instantaneul rundei 2 FĂRĂ X, iar după ea X e răspuns
//      (de_evaluat_raspuns). Funcțiile din public NU se schimbă (copiile trăiesc doar în sesiunea A).
//   C5 (r3) închiderea CONCURENTĂ: A trimite runda 1 și stă la aceeași barieră (ține lock-ul rândului); C schimbă statusul în „rezolvat” ->
//      C e blocată de A (pg_blocking_pids); după A, C trece, ancora iese („status”), starea = neeligibil; un singur mesaj.
//   Tichetele de probă se creează CA DIN APLICAȚIE (r3): rolul authenticated + JWT-ul autorului (politica de INSERT), ca trigger-ul să
//   le ancoreze; fără ancoră = PROBA_NEFUNCTIONALA.
// Mutanți: (--mutant fara_lock) fiecare sesiune își face în pg_temp o COPIE a funcției de trimitere fără „FOR NO KEY UPDATE” (funcția din
//   public nu se schimbă) și o cheamă pe aceea -> C1: B NU mai e oprită de lock-ul rândului; o oprește abia cheia unică a evidenței, cu
//   EROARE (cheie duplicată) în loc de „deja_trimis”. Ieșire 0 = DEFECTUL reprodus (mutant PRINS): B în eroare și tot un singur mesaj.
//   (--mutant instantaneu_separat) doar C4, cu copia care recitește instantaneul separat (r2): ieșire 0 = DEFECTUL reprodus (X în
//   instantaneul rundei 2, starea asteapta_autor).
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
if (!/^\d+$/.test(SISTEM || '') || (MUTANT && !['fara_lock', 'instantaneu_separat'].includes(MUTANT)) || (AUTOR && !UUID.test(AUTOR))) {
  console.error('argumente: --sistem <număr> [--autor <uuid>] [--mutant fara_lock | instantaneu_separat]'); process.exit(2)
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
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`
const preambul = MUTANT === 'fara_lock' ? MUT_FN + '\n' : ''
// C4 / C5: copiile cu barieră (doar în sesiunea A): starea cu pg_advisory_lock(K) după citirea evidenței, trimiterea care o cheamă
const extrage = (nume) => {
  const i = MIG.indexOf(`CREATE FUNCTION public.${nume}(`)
  return MIG.slice(i, MIG.indexOf('$f$;', MIG.indexOf('AS $f$', i) + 6) + 4)
}
const CHEIE_BARIERA = 20261223
const PUNCT_BARIERA = '  -- răspunsul la ultima rundă = un comentariu al AUTORULUI ANCORAT'
const LINIE_STARE = 's := public.fn_tichet_clarificare_stare_tichet(p_tichet_id);'
const INST_FOTO = "  v_inst := ARRAY(SELECT j.v::bigint FROM jsonb_array_elements_text(s -> 'instantaneu_autor') WITH ORDINALITY AS j(v, n) ORDER BY j.n);\n  -- textul: DOAR"
const INST_SEPARAT = "  SELECT coalesce(array_agg(c.id ORDER BY c.id), '{}') INTO v_inst FROM public.tichete_comentarii c WHERE c.tichet_id = t.id AND c.autor = t.deschis_de;\n  -- textul: DOAR"
for (const [ce, text] of [['punctul barierei', PUNCT_BARIERA], ['apelul stării', LINIE_STARE], ['instantaneul din fotografie', INST_FOTO]]) {
  if (!MIG.includes(text)) { console.error('copiile cu barieră: ' + ce + ' nu se găsește în migrare'); process.exit(2) }
}
const STARE_BARIERA = extrage('fn_tichet_clarificare_stare_tichet')
  .replace('CREATE FUNCTION public.fn_tichet_clarificare_stare_tichet(', 'CREATE FUNCTION pg_temp.fn_tichet_clarificare_stare_tichet(')
  .replace(PUNCT_BARIERA, `  PERFORM pg_advisory_lock(${CHEIE_BARIERA}); PERFORM pg_advisory_unlock(${CHEIE_BARIERA});\n${PUNCT_BARIERA}`)
const TRIMITE_BARIERA = (mutant) => extrage('fn_tichet_clarificare_trimite')
  .replace('CREATE FUNCTION public.fn_tichet_clarificare_trimite(', 'CREATE FUNCTION pg_temp.fn_tichet_clarificare_trimite(')
  .replace('LANGUAGE plpgsql SECURITY DEFINER', 'LANGUAGE plpgsql')
  .replace(LINIE_STARE, 's := pg_temp.fn_tichet_clarificare_stare_tichet(p_tichet_id);')
  .replace(INST_FOTO, mutant ? INST_SEPARAT : INST_FOTO)
const PREAMBUL_BARIERA = (mutant) => STARE_BARIERA + '\n' + TRIMITE_BARIERA(mutant) + '\n'

const stari = []
const nota = (sc, stare, text) => { stari.push(stare); console.log(`${sc}: ${stare} — ${text}`) }
let tichete = []
const curata = async () => {
  if (!tichete.length) return
  const lista = tichete.join(', ')
  await q(`BEGIN;
DELETE FROM public.notifications WHERE link_to IN (${tichete.map(t => `'/tichete?id=${t}'`).join(', ')});
DELETE FROM public.tichete_clarificari WHERE tichet_id IN (${lista}) AND tichet_id IN (SELECT id FROM public.tichete WHERE titlu LIKE 'PROBA CLONA clarificari%');
DELETE FROM public.tichete_clarificari_ancore WHERE tichet_id IN (${lista}) AND tichet_id IN (SELECT id FROM public.tichete WHERE titlu LIKE 'PROBA CLONA clarificari%');
DELETE FROM public.tichete WHERE id IN (${lista}) AND titlu LIKE 'PROBA CLONA clarificari%';
COMMIT;`)
  console.log(`curățenie: tichetele de probă ${lista} (cu comentariile / istoricul / evidența / ancorele lor) și notificările lor șterse`)
  tichete = []
}

try {
  // ── ținta și precondițiile ──
  const [sistem] = await q('SELECT system_identifier FROM pg_control_system();')
  if (sistem !== SISTEM) { console.error(`refuz: ținta are system_identifier ${sistem}, nu ${SISTEM}`); process.exit(22) }
  const [aplicata] = await q(`SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname LIKE 'fn\\_tichet\\_clarificare\\_%';`)
  const [tabel] = await q(`SELECT to_regclass('public.tichete_clarificari') IS NOT NULL AND to_regclass('public.tichete_clarificari_ancore') IS NOT NULL
    AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.tichete'::regclass AND tgname = 'trg_tichet_clarificare_ancora' AND tgenabled = 'O');`)
  if (aplicata !== '10' || tabel !== 't') { console.error(`migrarea 20261223a nu e aplicată pe clonă (${aplicata} funcții din 10, tabelele + trigger-ul ancorei: ${tabel})`); process.exit(23) }
  const [apelant] = await q('SELECT public.fn_tichet_clarificare_apelant_ok();')
  if (apelant !== 't') { console.error('conexiunea probei nu e acceptată ca apelant (session_user postgres, fără SET ROLE)'); process.exit(26) }
  const trimitAfara = await q(`SELECT tg.tgrelid::regclass::text || '.' || tg.tgname FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid
    WHERE NOT tg.tgisinternal AND tg.tgenabled <> 'D' AND tg.tgrelid IN ('public.tichete'::regclass, 'public.tichete_comentarii'::regclass, 'public.notifications'::regclass,
          coalesce(to_regclass('public.tichete_istoric'), 'public.tichete'::regclass))
      AND p.prosrc ~* '(http|\\mnet\\.|mail|\\msms|push|pg_notify)';`)
  if (trimitAfara.length) { console.error('refuz: triggere care pot trimite în afara bazei (dezactivează-le întâi pe clonă): ' + trimitAfara.join(', ')); process.exit(24) }
  const autor = AUTOR || (await q(`SELECT id FROM public.profiles WHERE is_owner IS NOT TRUE ORDER BY id LIMIT 1;`))[0]
  if (!autor) { nota('PRE', 'PROBA_NEFUNCTIONALA', 'niciun profil de autor pe clonă'); throw new Error('fara autor') }
  // ca din aplicație (r3): rolul authenticated + JWT-ul autorului (ambele surse ale lui auth.uid()), politica reală de INSERT; ancora
  // trebuie să apară (altfel proba nu verifică protocolul)
  const caAutorul = (sql) => `BEGIN;\nSET LOCAL ROLE authenticated;\nSELECT set_config('request.jwt.claim.sub', '${autor}', true);\n`
    + `SELECT set_config('request.jwt.claims', '{"sub": "${autor}", "role": "authenticated"}', true);\n${sql}\nCOMMIT;`
  const tichetNou = async (eticheta) => {
    const linii = await q(caAutorul(`INSERT INTO public.tichete (departament, subcategorie, titlu, descriere, urgenta, status, deschis_de, entitate_tip, entitate_descriere, metadata)
      VALUES ('it', 'eroare_erp', 'PROBA CLONA clarificari ${eticheta}', 'Tichet de proba pe clona (date inventate).', 'normal', 'deschis', '${autor}', 'pagina_app', '/proba-clona',
              '{"sursa": "bug_report", "tip": "bug", "pagina": "/proba-clona"}'::jsonb) RETURNING id;`))
    const id = linii[linii.length - 1]
    if (!/^\d+$/.test(id || '')) throw new Error('tichetul de probă nu s-a creat: ' + linii.join(' | '))
    tichete.push(id)
    const [anc] = await q(`SELECT count(*) FROM public.tichete_clarificari_ancore WHERE tichet_id = ${id} AND autor = '${autor}' AND iesit_la IS NULL;`)
    if (anc !== '1') { nota('PRE', 'PROBA_NEFUNCTIONALA', `tichetul de probă ${id} nu a fost ancorat (trigger-ul / JWT-ul)`); throw new Error('fara ancora') }
    return id
  }
  const comentariuAutor = (t, text, app) => psql(['-t', '-A', '-f', '-'], caAutorul(`INSERT INTO public.tichete_comentarii (tichet_id, autor, text) VALUES (${t}, '${autor}', ${lit(text)}) RETURNING id;`), app)
  const numara = async (t) => {
    const [r] = await q(`SELECT (SELECT count(*) FROM public.tichete_comentarii c WHERE c.tichet_id = ${t} AND c.autor IS NULL AND c.text LIKE 'Clarificare _/2' || chr(10) || '%') || '/' ||
      (SELECT count(*) FROM public.tichete_comentarii c WHERE c.tichet_id = ${t} AND c.autor IS NULL AND c.text LIKE 'Clarificările automate s-au încheiat.%') || '/' ||
      (SELECT count(*) FROM public.notifications n WHERE n.link_to = '/tichete?id=${t}' AND n.title LIKE '❓ Întrebări de clarificare%') || '/' ||
      (SELECT count(*) FROM public.notifications n WHERE n.link_to = '/tichete?id=${t}' AND n.title LIKE 'ℹ️ Clarificări încheiate%') || '/' ||
      (SELECT count(*) FROM public.tichete_clarificari e WHERE e.tichet_id = ${t} AND e.fel = 'runda') || '/' ||
      (SELECT count(*) FROM public.tichete_clarificari e WHERE e.tichet_id = ${t} AND e.fel IN ('incheiere', 'clarificat'));`)
    const [runde, incheieri, nRunde, nIncheieri, eRunde, eIncheieri] = r.split('/').map(Number)
    return { runde, incheieri, nRunde, nIncheieri, eRunde, eIncheieri }
  }
  const versiune = async (t) => (await q(`SELECT public.fn_tichet_clarificare_context(${t});`))[0]

  // ── C1: două apeluri simultane pentru aceeași rundă ──
  if (MUTANT !== 'instantaneu_separat') {
    const t = await tichetNou('C1')
    const v = await versiune(t)
    const A = psql(['-t', '-A', '-f', '-'], `${preambul}BEGIN;\nSELECT ${FN_TRIMITE}(${t}, 1, ARRAY['În ce ecran apare problema?'], ${lit(v)});\nSELECT pg_sleep(1.5);\nCOMMIT;\n`, 'clar_conc_A')
    if (!await asteapta(inSomn('clar_conc_A'))) { nota('C1', 'PROBA_NEFUNCTIONALA', 'A nu a ajuns în fereastră'); await A }
    else {
      const B = psql(['-t', '-A', '-f', '-'], `${preambul}SELECT ${FN_TRIMITE}(${t}, 1, ARRAY['Ce ai apăsat înainte?'], ${lit(v)});\n`, 'clar_conc_B')
      const blocata = await asteapta(blocataDe('clar_conc_B', 'clar_conc_A'), 1200)
      const [a, b] = await Promise.all([A, B])
      const n = await numara(t)
      const ra = rezultat(a), rb = rezultat(b)
      if (MUTANT === 'fara_lock') {
        nota('C1', ra === 'trimis' && /EROARE/.test(rb) && /duplicate key|23505|tichete_clarificari_cheie/.test(rb + ' ' + b.err) && n.runde === 1 && n.eRunde === 1 ? 'OK' : 'CONTRAR',
          `mutant fara_lock: A=${ra}, B=${rb.slice(0, 120)} (defectul = B în eroare de cheie duplicată, nu deja_trimis), comentarii automate=${n.runde}, rânduri=${n.eRunde}`)
      } else if (!blocata) {
        nota('C1', 'PROBA_NEFUNCTIONALA', `B nu a fost observată blocată de A (A=${ra}, B=${rb}, comentarii=${n.runde})`)
      } else {
        nota('C1', ra === 'trimis' && rb === 'deja_trimis' && n.runde === 1 && n.nRunde === 1 && n.eRunde === 1 ? 'OK' : 'CONTRAR',
          `A=${ra}, B=${rb} (blocată de A), comentarii automate=${n.runde}, notificări=${n.nRunde}, rânduri de evidență=${n.eRunde}`)
      }
    }
  }
  if (!MUTANT) {
    // ── C2: două încheieri simultane (tăcere) ──
    {
      const t = await tichetNou('C2')
      await q(`SELECT public.fn_tichet_clarificare_trimite(${t}, 1, ARRAY['Ce pași ai făcut?'], ${lit(await versiune(t))});`)
      await q(`UPDATE public.tichete_clarificari SET creat_la = now() - interval '10 days' WHERE tichet_id = ${t} AND fel = 'runda';`)
      const [act] = await q(`SELECT public.fn_tichet_clarificare_stare_tichet(${t}) ->> 'actiune';`)
      if (act !== 'de_escaladat_tacere') nota('C2', 'PROBA_NEFUNCTIONALA', `starea pregătită nu e de_escaladat_tacere (${act})`)
      else {
        const v = await versiune(t)
        const A = psql(['-t', '-A', '-f', '-'], `BEGIN;\nSELECT public.fn_tichet_clarificare_incheie(${t}, 'tacere', ${lit(v)});\nSELECT pg_sleep(1.5);\nCOMMIT;\n`, 'clar_conc_A')
        if (!await asteapta(inSomn('clar_conc_A'))) { nota('C2', 'PROBA_NEFUNCTIONALA', 'A nu a ajuns în fereastră'); await A }
        else {
          const B = psql(['-t', '-A', '-f', '-'], `SELECT public.fn_tichet_clarificare_incheie(${t}, 'tacere', ${lit(v)});\n`, 'clar_conc_B')
          const blocata = await asteapta(blocataDe('clar_conc_B', 'clar_conc_A'), 1200)
          const [a, b] = await Promise.all([A, B])
          const n = await numara(t)
          const ra = rezultat(a), rb = rezultat(b)
          if (!blocata) nota('C2', 'PROBA_NEFUNCTIONALA', `B nu a fost observată blocată de A (A=${ra}, B=${rb})`)
          else nota('C2', ra === 'incheiat' && rb === 'deja_incheiat' && n.incheieri === 1 && n.nIncheieri === 1 && n.eIncheieri === 1 ? 'OK' : 'CONTRAR',
            `A=${ra}, B=${rb} (blocată de A), mesaje de încheiere=${n.incheieri}, notificări=${n.nIncheieri}, rânduri de încheiere=${n.eIncheieri}`)
        }
      }
    }
    // ── C3: comentariul autorului scris cât A ține runda 1 deschisă ──
    {
      const t = await tichetNou('C3')
      const v = await versiune(t)
      const A = psql(['-t', '-A', '-f', '-'], `BEGIN;\nSELECT public.fn_tichet_clarificare_trimite(${t}, 1, ARRAY['Ce mesaj apare?'], ${lit(v)});\nSELECT pg_sleep(1.5);\nCOMMIT;\n`, 'clar_conc_A')
      if (!await asteapta(inSomn('clar_conc_A'))) { nota('C3', 'PROBA_NEFUNCTIONALA', 'A nu a ajuns în fereastră'); await A }
      else {
        const t0 = Date.now()
        const B = await psql(['-t', '-A', '-f', '-'], `INSERT INTO public.tichete_comentarii (tichet_id, autor, text) VALUES (${t}, ${lit(autor)}, 'Raspuns scris in timpul rundei (proba clona).');\n`, 'clar_conc_B')
        const durataB = Date.now() - t0
        const [stA] = await q("SELECT count(*) FROM pg_stat_activity WHERE application_name = 'clar_conc_A' AND wait_event = 'PgSleep';")
        const a = await A
        const [act] = await q(`SELECT public.fn_tichet_clarificare_stare_tichet(${t}) ->> 'actiune';`)
        if (stA !== '1') nota('C3', 'PROBA_NEFUNCTIONALA', `comentariul s-a scris după ce A își terminase fereastra (B=${durataB} ms)`)
        else nota('C3', B.code === 0 && rezultat(a) === 'trimis' && act === 'de_evaluat_raspuns' ? 'OK' : 'CONTRAR',
          `comentariul autorului: ${B.code === 0 ? 'scris fără să aștepte A' : 'EROARE ' + B.err.trim().slice(0, 120)} (${durataB} ms), A=${rezultat(a)}, starea după=${act} (cerut de_evaluat_raspuns)`)
      }
    }
    // ── T: triggerele reale la scrierile noastre ──
    {
      const t = await tichetNou('T')
      const ist = async () => (await q(`SELECT CASE WHEN to_regclass('public.tichete_istoric') IS NULL THEN -1 ELSE (SELECT count(*) FROM public.tichete_istoric WHERE tichet_id = ${t}) END;`))[0]
      // momentul de start (după crearea tichetului: notificările de „tichet nou” nu intră), apoi notificările noi legate de tichet
      const [t0] = await q('SELECT clock_timestamp()::text;')
      const i0 = Number(await ist())
      const r = await q(`SELECT public.fn_tichet_clarificare_trimite(${t}, 1, ARRAY['Ce mesaj apare pe ecran?'], ${lit(await versiune(t))}) ->> 'rezultat';`)
      const i1 = Number(await ist())
      const noi = await q(`SELECT n.profile_id::text || ' | ' || coalesce(n.title, '') || ' | ' || coalesce(n.link_to, '') FROM public.notifications n
        WHERE n.created_at >= '${t0}'::timestamptz AND (n.link_to LIKE '%tichete?id=${t}' OR n.link_to LIKE '%tichete?id=${t}&%' OR n.title LIKE '%PROBA CLONA%')
        ORDER BY n.created_at;`)
      const ale_noastre = noi.filter(l => l.startsWith(autor + ' | ❓ Întrebări de clarificare') && l.endsWith(`/tichete?id=${t}`))
      nota('T', r[0] === 'trimis' && noi.length === 1 && ale_noastre.length === 1 && (i0 < 0 || i1 === i0) ? 'OK' : 'CONTRAR',
        `rezultat=${r[0]}; notificări noi=${noi.length} (a noastră: ${ale_noastre.length})${noi.length > 1 ? ' — în plus: ' + noi.filter(l => !ale_noastre.includes(l)).join(' ; ') : ''}; `
        + `istoricul tichetului: ${i0 < 0 ? 'tabelul tichete_istoric nu există' : `${i1 - i0} rânduri noi (cerut 0: tichetul nu se modifică)`}`)
    }
  }
  // ── C4 / C5: bariera PG17 în fereastra dintre verificare și scriere (copiile din pg_temp, doar în sesiunea A) ──
  const laBariera = (app) => async () => (await q(`SELECT count(*) FROM pg_stat_activity WHERE application_name = '${app}' AND wait_event_type = 'Lock' AND wait_event = 'advisory'`))[0] === '1'
  const tineBariera = () => psql(['-t', '-A', '-f', '-'], `SELECT pg_advisory_lock(${CHEIE_BARIERA});\nSELECT pg_sleep(2.5);\nSELECT pg_advisory_unlock(${CHEIE_BARIERA});\n`, 'clar_conc_B')
  if (MUTANT !== 'fara_lock') {
    const t = await tichetNou('C4')
    await q(`SELECT public.fn_tichet_clarificare_trimite(${t}, 1, ARRAY['În ce ecran apare problema?'], ${lit(await versiune(t))});`)
    const r1 = await comentariuAutor(t, 'Raspunsul la runda 1 (proba clona).', 'clar_conc_C')
    const idR1 = (r1.out.replace(/\r/g, '').split('\n').filter(Boolean).pop() || '').trim()
    const v = await versiune(t)
    const B = tineBariera()
    if (!await asteapta(inSomn('clar_conc_B'))) { nota('C4', 'PROBA_NEFUNCTIONALA', 'B nu a luat bariera'); await B }
    else {
      const A = psql(['-t', '-A', '-f', '-'], `${PREAMBUL_BARIERA(MUTANT === 'instantaneu_separat')}SELECT pg_temp.fn_tichet_clarificare_trimite(${t}, 2, ARRAY['Ce mesaj apare exact?'], ${lit(v)});\n`, 'clar_conc_A')
      const ajuns = await asteapta(laBariera('clar_conc_A'), 2000)
      const X = ajuns ? await comentariuAutor(t, 'Scris in fereastra rundei 2 (proba clona).', 'clar_conc_C') : null
      const idX = X ? (X.out.replace(/\r/g, '').split('\n').filter(Boolean).pop() || '').trim() : ''
      const incaLaBariera = ajuns && await laBariera('clar_conc_A')()
      const [a] = await Promise.all([A, B])
      const [inst] = await q(`SELECT coalesce(array_to_string(instantaneu_autor, ','), '') FROM public.tichete_clarificari WHERE tichet_id = ${t} AND fel = 'runda' AND runda = 2;`)
      const [act] = await q(`SELECT public.fn_tichet_clarificare_stare_tichet(${t}) ->> 'actiune';`)
      const areX = (inst || '').split(',').includes(idX)
      if (!ajuns || !X || X.code !== 0 || !/^\d+$/.test(idX) || !incaLaBariera) {
        nota('C4', 'PROBA_NEFUNCTIONALA', `fereastra nu a fost prinsă (A la barieră: ${ajuns}, X scris: ${X ? X.code : '-'}, A încă la barieră după X: ${incaLaBariera})`)
      } else if (MUTANT === 'instantaneu_separat') {
        nota('C4', rezultat(a) === 'trimis' && areX && act === 'asteapta_autor' ? 'OK' : 'CONTRAR',
          `mutant instantaneu_separat: A=${rezultat(a)}, instantaneul rundei 2=[${inst}] (defectul = conține X ${idX}), starea după=${act} (defectul = asteapta_autor)`)
      } else {
        nota('C4', rezultat(a) === 'trimis' && !areX && (inst || '').split(',').includes(idR1) && act === 'de_evaluat_raspuns' ? 'OK' : 'CONTRAR',
          `A=${rezultat(a)}, instantaneul rundei 2=[${inst}] (cerut: R1 ${idR1}, FĂRĂ X ${idX}), starea după=${act} (cerut de_evaluat_raspuns)`)
      }
    }
  }
  if (!MUTANT) {
    const t = await tichetNou('C5')
    const v = await versiune(t)
    const B = tineBariera()
    if (!await asteapta(inSomn('clar_conc_B'))) { nota('C5', 'PROBA_NEFUNCTIONALA', 'B nu a luat bariera'); await B }
    else {
      const A = psql(['-t', '-A', '-f', '-'], `${PREAMBUL_BARIERA(false)}SELECT pg_temp.fn_tichet_clarificare_trimite(${t}, 1, ARRAY['Ce pași ai făcut?'], ${lit(v)});\n`, 'clar_conc_A')
      const ajuns = await asteapta(laBariera('clar_conc_A'), 2000)
      const C = ajuns ? psql(['-t', '-A', '-f', '-'], `UPDATE public.tichete SET status = 'rezolvat' WHERE id = ${t};\n`, 'clar_conc_C') : null
      const blocata = ajuns && await asteapta(blocataDe('clar_conc_C', 'clar_conc_A'), 1200)
      const [a, b, c] = await Promise.all([A, B, C])
      const n = await numara(t)
      const [anc] = await q(`SELECT coalesce(iesit_motiv, '-') FROM public.tichete_clarificari_ancore WHERE tichet_id = ${t};`)
      const [st] = await q(`SELECT (public.fn_tichet_clarificare_stare_tichet(${t}) ->> 'eligibil') || '/' || coalesce(public.fn_tichet_clarificare_stare_tichet(${t}) ->> 'motiv', '-');`)
      if (!ajuns || !blocata) nota('C5', 'PROBA_NEFUNCTIONALA', `fereastra nu a fost prinsă (A la barieră: ${ajuns}, C blocată de A: ${blocata})`)
      else nota('C5', rezultat(a) === 'trimis' && c.code === 0 && n.runde === 1 && n.eRunde === 1 && anc === 'status' && st === 'false/status' ? 'OK' : 'CONTRAR',
        `A=${rezultat(a)}, închiderea C ${c.code === 0 ? 'trecută după A' : 'EROARE ' + c.err.trim().slice(0, 120)}, mesaje=${n.runde}, rânduri=${n.eRunde}, ancora ieșită=${anc} (cerut status), starea=${st} (cerut false/status)`)
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
