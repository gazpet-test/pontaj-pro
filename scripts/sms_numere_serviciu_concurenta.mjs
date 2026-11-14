// Proba de CONCURENȚĂ pentru 20261220a (limita de 100 de numere de serviciu ACTIVE, L01) — DOAR pe CLONĂ PostgreSQL 17, cu DOUĂ sesiuni
// psql reale (L25). Tiparul: scripts/anon_drepturi_concurenta.mjs. Nu atinge producția. Garda țintei, înainte de orice scriere (cod 22):
//   (a) gazda dată în conexiune nu e Supabase (refuz înainte de orice conexiune);
//   (b) r4: CAPĂTUL EFECTIV al conexiunii, văzut de SERVER: inet_server_addr() = --ip și inet_server_port() = --port (pe socket Unix:
//       --ip socket și portul serverului). Valorile le dă serverul, nu numele din linia de comandă: un alias DNS, un fișier de serviciu
//       sau un tunel (ssh -L / proxy) spre altă bază arată adresa și portul CELEILALTE baze, deci refuz. Valorile așteptate se iau pe clonă
//       (SELECT inet_server_addr(), inet_server_port()), odată cu system_identifier;
//   (c) identitatea clusterului: system_identifier (pg_control_system()) EXACT --sistem;
//   (d) versiunea: PostgreSQL 17.
// Rulare (din rădăcina repo-ului; parola din pgpass, niciodată pe linia de comandă), DUPĂ ce migrarea e aplicată pe clonă (pasul 2 din raport):
//   PSQL=<calea psql> node scripts/sms_numere_serviciu_concurenta.mjs --sistem <system_identifier> --ip <inet_server_addr> --port <inet_server_port>
//        [--mutant fara_lock] -- -h <host clonă> -p <port> -U postgres -d postgres
// Starea de plecare cerută: 20261220a APLICATĂ, tabelul public.sms_numere_serviciu GOL, niciun mesaj către un număr de serviciu, un profil
//   owner (profiles.is_owner) — altfel ieșire 23 (stare) / 26 (fără owner). Apelurile merg ca prin PostgREST: tranzacție, JWT (claim.sub +
//   claims), SET LOCAL ROLE authenticated, ca owner-ul clonei (poarta fn_sms_cere_owner trece), prin RPC-ul public.fn_sms_numar_serviciu_salveaza.
// Ce face:
//   1. pregătire (o sesiune, o tranzacție): 99 de numere ACTIVE fictive (denumiri „Proba concurenta NN”, telefoane 0700 9xx xxx); r4: id-urile
//      PROPRII (întoarse de RPC) se rețin;
//   2. C1: sesiunea A adaugă al 100-lea și rămâne în tranzacție (pg_sleep, instrumentare de probă: corpul funcției NU se schimbă); când A e
//      OBSERVATĂ în somn (pg_stat_activity), sesiunea B adaugă alt număr (alt nume, alt telefon: UNIQUE nu intervine). Așteptat: B stă
//      blocată de A (pg_blocking_pids: lock-ul consultativ al adăugării), A comite, B e REFUZATĂ cu 22023 „maximum 100 de numere de serviciu
//      active”; la final EXACT 100 active (A reușită, B refuzată). Sincronizare pe stări OBSERVATE, nu pe timp;
//   3. curățenia (r4, o tranzacție, ca proprietar): ACCESS EXCLUSIVE pe tabel (așteaptă inserările în curs ale altora), triggerul de reguli
//      oprit DOAR în tranzacție, șterse DOAR rândurile PROPRII (id + denumire, din ce au întors inserările; nimic după prefix), triggerul
//      repornit; secvența identității pusă înapoi la valoarea de plecare DOAR dacă, sub acel lock, rândurile tabelului sunt EXACT cele de la
//      plecare (altfel secvența rămâne cum e și se spune). Verificarea finală compară cu plecarea RÂND CU RÂND (id + md5 pe rândul întreg),
//      plus mesajele, triggerul, secvența și corpul / drepturile funcției.
// Mutant (--mutant fara_lock): funcția de salvare înlocuită TEMPORAR (CREATE OR REPLACE din pg_get_functiondef, pe server, cu apelul
//   pg_advisory_xact_lock înlocuit de un marcaj), C1 rulat, apoi definiția de plecare pusă înapoi prin înlocuirea inversă (verificat md5
//   corp + DEFINER + config + ACL = cele de la plecare). Ieșire 0 = DEFECTUL reprodus
//   (B NU e blocată, ambele reușesc, 101 active = limita depășită) = mutant PRINS.
// Ieșire: 0 = OK (cu --mutant: prins); 1 = CONTRAR; 26 = PROBA NEFUNCȚIONALĂ (fereastra n-a fost prinsă / starea așteptată goală), prioritar;
//   22 = altă țintă (capăt efectiv / sistem / versiune / gazdă Supabase); 23 = starea de plecare nu e cea cerută; 2 = argumente;
//   25 = starea finală diferă de cea de la plecare (vezi ieșirea).
// Funcțiile exportate (SQL-ul curățeniei și al stării) le rulează și proba locală PGlite (scripts/pglite/test_sms_numere_serviciu_local.mjs).
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export const lit = (s) => "'" + String(s).replace(/'/g, "''") + "'"
// rândurile tabelului, RÂND CU RÂND: id + md5 pe rândul întreg (denumire, telefon, activ, audit, versiune), în ordinea id-ului
export const SQL_RANDURI = `(SELECT coalesce(string_agg(s.id::text || ':' || md5(row(s.*)::text), ',' ORDER BY s.id), '') FROM public.sms_numere_serviciu s)`
// liniile marcate „PROPRIU<TAB>id<TAB>denumire” din ieșirea unei sesiuni (psql -t -A) = rândurile inserate de probă
export const SQL_PROPRIU = (r) => `'PROPRIU' || chr(9) || (${r} ->> 'id') || chr(9) || (${r} ->> 'denumire')`
export function proprii(out) {
  return out.replace(/\r/g, '').split('\n').filter(l => l.startsWith('PROPRIU\t')).map(l => {
    const [, id, den] = l.split('\t')
    if (!/^\d+$/.test(id || '') || !den) throw new Error('linie PROPRIU invalidă: ' + l)
    return { id: Number(id), denumire: den }
  })
}
// curățenia: sub ACCESS EXCLUSIVE, șterge DOAR rândurile proprii (id + denumire), apoi secvența înapoi DOAR dacă rândurile = cele de la
// plecare; întoarce liniile „STERSE<TAB>n” și „SECVENTA<TAB>resetata|lasata<TAB>…”
export function sqlCuratenie({ randuri, seq, seqPlecare, randuriPlecare }) {
  const [lv, ic] = seqPlecare.split(' ')
  if (!/^\d+$/.test(lv) || !/^(t|f|true|false)$/.test(ic || '')) throw new Error('starea de plecare a secvenței invalidă: ' + seqPlecare)
  const ids = randuri.map(r => Number(r.id)), dens = randuri.map(r => lit(r.denumire))
  if (ids.some(i => !Number.isInteger(i))) throw new Error('id propriu invalid')
  return `BEGIN;
SET LOCAL lock_timeout = '10s';
LOCK TABLE public.sms_numere_serviciu IN ACCESS EXCLUSIVE MODE;
ALTER TABLE public.sms_numere_serviciu DISABLE TRIGGER trg_sms_numere_serviciu_reguli;
WITH d AS (DELETE FROM public.sms_numere_serviciu s USING unnest(ARRAY[${ids.join(', ')}]::integer[], ARRAY[${dens.join(', ')}]::text[]) AS p(id, denumire)
            WHERE s.id = p.id AND s.denumire = p.denumire RETURNING s.id)
SELECT 'STERSE' || chr(9) || count(*) FROM d;
ALTER TABLE public.sms_numere_serviciu ENABLE TRIGGER trg_sms_numere_serviciu_reguli;
SELECT CASE WHEN ${SQL_RANDURI} = ${lit(randuriPlecare)}
            THEN 'SECVENTA' || chr(9) || 'resetata' || chr(9) || setval(${lit(seq)}, ${lv}, ${ic.startsWith('t') ? 'true' : 'false'})::text
            ELSE 'SECVENTA' || chr(9) || 'lasata' || chr(9) || 'alte randuri decat cele de la plecare: ' || ${SQL_RANDURI} END;
COMMIT;\n`
}

const ESTE_MAIN = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (ESTE_MAIN) await ruleaza()

async function ruleaza() {
  const PSQL = process.env.PSQL || 'psql'
  const argv = process.argv.slice(2), sep = argv.indexOf('--')
  if (sep < 0) { console.error('lipsește „--” urmat de conexiune'); process.exit(2) }
  const opt = argv.slice(0, sep), CONN = argv.slice(sep + 1)
  const val = (n) => { const i = opt.indexOf(n); return i >= 0 ? opt[i + 1] : null }
  const SISTEM = val('--sistem'), MUTANT = val('--mutant'), IP = val('--ip'), PORT = val('--port')
  if (!/^\d+$/.test(SISTEM || '') || !/^\d+$/.test(PORT || '') || !/^(socket|[0-9a-fA-F.:]+)$/.test(IP || '') || (MUTANT && MUTANT !== 'fara_lock')) {
    console.error('argumente: --sistem <număr> --ip <inet_server_addr | socket> --port <inet_server_port> [--mutant fara_lock]'); process.exit(2)
  }
  // a doua gardă, înainte de orice conexiune: o gazdă Supabase (producția) = refuz, oricare ar fi --sistem
  if (CONN.some(x => /supabase\.(co|com)\b/i.test(x)) || /supabase\.(co|com)\b/i.test(process.env.PGHOST || '')) { console.error('refuz: gazda e Supabase (producția); proba rulează doar pe clonă'); process.exit(22) }

  const delay = (ms) => new Promise(r => setTimeout(r, ms))
  function psql(args, input, app) {
    return new Promise((res) => {
      const p = spawn(PSQL, ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-P', 'pager=off', ...CONN, ...args],
        { env: { ...process.env, PGCLIENTENCODING: 'UTF8', PGAPPNAME: app }, windowsHide: true })
      let out = '', err = ''
      p.stdout.setEncoding('utf8'); p.stderr.setEncoding('utf8')
      p.stdout.on('data', d => { out += d }); p.stderr.on('data', d => { err += d })
      p.on('error', e => res({ code: -1, out, err: err + String(e) }))
      p.on('close', code => res({ code, out, err }))
      p.stdin.end(input ?? '')
    })
  }
  const q = async (sql, app = 'sms_conc_obs') => {
    const r = await psql(['-t', '-A', '-F', '\t', '-f', '-'], sql, app)
    if (r.code !== 0) throw new Error('interogare picată: ' + r.err.trim())
    return r.out.replace(/\r/g, '').split('\n').filter(Boolean)
  }
  const unu = async (sql) => (await q(sql))[0]
  const eroare = (r) => (r.err.trim().split('\n').find(l => /ERROR/.test(l)) || r.err.trim()).slice(0, 220)
  async function asteapta(cond, ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await cond()) return true; await delay(40) } return false }
  const inSomn = (app) => async () => (await unu(`SELECT count(*) FROM pg_stat_activity WHERE application_name = '${app}' AND wait_event = 'PgSleep'`)) === '1'
  const blocataDe = (b, a) => async () => (await unu(`SELECT count(*) FROM pg_stat_activity x, pg_stat_activity y
  WHERE x.application_name = '${b}' AND y.application_name = '${a}' AND y.pid = ANY (pg_blocking_pids(x.pid))`)) === '1'

  const FN = 'public.fn_sms_numar_serviciu_salveaza(integer,text,text,integer,text,integer)'
  // mutantul se pune și se scoate PE SERVER, din pg_get_functiondef, prin înlocuire reversibilă cu un marcaj unic: corpul pus înapoi e
  // octet cu octet cel de la plecare (inclusiv eventualele CR), fără să treacă textul prin client
  const APEL_LOCK = "PERFORM pg_advisory_xact_lock(hashtextextended('sms_numere_serviciu:adaugare', 0));"
  const MARCAJ = 'NULL; /* proba sms_numere_serviciu_concurenta: mutant fara_lock */'
  const inlocuiesteCorp = (din, in_) => `DO $m$
DECLARE d text := pg_catalog.pg_get_functiondef(to_regprocedure('${FN}'));
BEGIN
  IF strpos(d, $c$${din}$c$) = 0 THEN RAISE EXCEPTION 'proba: textul de inlocuit lipseste din definitie'; END IF;
  EXECUTE replace(d, $c$${din}$c$, $c$${in_}$c$);
END $m$;\n`
  // starea funcției (corp fără CR, DEFINER, config, ACL exact) — comparată la final cu cea de la plecare
  const STARE_FN = `SELECT md5(replace(p.prosrc, chr(13), '')) || ' ' || p.prosecdef::text || ' ' || coalesce(array_to_string(p.proconfig, ';'), '-') || ' '
  || coalesce((SELECT string_agg(a.d, ',' ORDER BY a.d COLLATE "C") FROM (SELECT CASE e.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END
     || ':' || e.privilege_type AS d FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e) a), '-')
  FROM pg_catalog.pg_proc p WHERE p.oid = to_regprocedure('${FN}');`
  const STARE_TABEL = `SELECT (SELECT count(*) FROM public.sms_numere_serviciu) || ' ' || (SELECT count(*) FROM public.sms_mesaje m WHERE m.destinatar_tip = 'serviciu')
  || ' ' || (SELECT tg.tgenabled::text FROM pg_catalog.pg_trigger tg WHERE tg.tgrelid = 'public.sms_numere_serviciu'::regclass AND tg.tgname = 'trg_sms_numere_serviciu_reguli');`
  // o sesiune ca PostgREST (owner-ul clonei), cu instrucțiunile date, într-o tranzacție; ieșire fără antete (liniile PROPRIU)
  const caOwner = (uid, corp, app) => psql(['-t', '-A', '-F', '\t', '-f', '-'], `BEGIN;
SELECT set_config('request.jwt.claim.sub', ${lit(uid)}, true), set_config('request.jwt.claims', ${lit(JSON.stringify({ sub: uid, role: 'authenticated' }))}, true);
SET LOCAL ROLE authenticated;
SET LOCAL lock_timeout = '10s';
${corp}
COMMIT;\n`, app)
  const adauga = (den, tel) => `SELECT ${SQL_PROPRIU('x.r')} FROM (SELECT public.fn_sms_numar_serviciu_salveaza(NULL, ${lit(den)}, ${lit(tel)}, NULL, NULL, NULL) AS r) x;`

  const stari = []
  const nota = (sc, stare, text) => { stari.push(stare); console.log(`${sc}: ${stare} — ${text}`) }
  let PLECARE = null, SEQ = null, mutantPus = false
  const PROPRII = []   // rândurile inserate de probă (id + denumire), din ieșirea fiecărei sesiuni
  // o linie PROPRIU ilizibilă nu oprește proba: rândul ei rămâne neșters și verificarea finală (rând cu rând) iese 25
  const retine = (r) => { try { for (const x of proprii(r.out)) PROPRII.push(x) } catch (e) { console.error('ieșirea unei sesiuni: ' + e.message) } }

  async function main() {
    // garda țintei: capătul EFECTIV (văzut de server), identitatea clusterului, versiunea — prima interogare, înaintea oricărei scrieri
    const [ip, port, sis, ver] = (await unu(`SELECT coalesce(host(inet_server_addr()), 'socket'), coalesce(inet_server_port(), current_setting('port')::integer),
      (SELECT system_identifier::text FROM pg_control_system()), current_setting('server_version_num')`)).split('\t')
    if (ip !== IP || port !== PORT) { console.error(`ȚINTĂ GREȘITĂ: capătul efectiv al conexiunii (server) e ${ip}:${port} ≠ --ip ${IP} --port ${PORT} (alias / tunel / alt server)`); process.exit(22) }
    if (sis !== SISTEM) { console.error(`ȚINTĂ GREȘITĂ: system_identifier ${sis} ≠ --sistem`); process.exit(22) }
    if (Number(ver) < 170000 || Number(ver) >= 180000) { console.error(`cere PostgreSQL 17 (clona are ${ver})`); process.exit(22) }
    if (await unu(`SELECT to_regclass('public.sms_numere_serviciu') IS NOT NULL AND to_regprocedure('${FN}') IS NOT NULL`) !== 't') {
      console.error('starea de plecare: 20261220a NU e aplicată pe clonă (aplic-o întâi cu runnerul, pasul 2)'); process.exit(23)
    }
    const stTab = await unu(STARE_TABEL)
    if (stTab !== '0 0 O') { console.error(`starea de plecare: tabelul / mesajele / triggerul = ${stTab} (cerut „0 0 O”: gol, fără mesaje, trigger activ)`); process.exit(23) }
    const uid = await unu(`SELECT p.id::text FROM public.profiles p WHERE p.is_owner IS TRUE ORDER BY p.id LIMIT 1`)
    if (!uid) { console.error('PROBA_NEFUNCTIONALA: clona nu are un profil owner (profiles.is_owner)'); process.exit(26) }
    SEQ = await unu(`SELECT pg_get_serial_sequence('public.sms_numere_serviciu', 'id')`)
    const seqStare = await unu(`SELECT last_value || ' ' || is_called FROM ${SEQ}`)
    PLECARE = { fn: await unu(STARE_FN), tab: stTab, seq: seqStare, randuri: (await q(`SELECT ${SQL_RANDURI};`))[0] || '' }
    if (await unu(`SELECT strpos(p.prosrc, $c$${APEL_LOCK}$c$) > 0 FROM pg_catalog.pg_proc p WHERE p.oid = to_regprocedure('${FN}')`) !== 't') {
      console.error('PROBA_NEFUNCTIONALA: corpul funcției nu are apelul lock-ului consultativ (alt corp decât 20261220a)'); process.exit(26)
    }
    console.log(`clona PG ${ver} (capăt efectiv ${ip}:${port}); owner-ul clonei găsit; funcția 20261220a la plecare: ${PLECARE.fn.split(' ')[0]}${MUTANT ? '; MUTANT ' + MUTANT : ''}`)

    // ── 1. pregătirea: 99 de numere active, o singură tranzacție, prin RPC (ca owner-ul); id-urile proprii reținute ──
    const prep = await caOwner(uid, `SELECT ${SQL_PROPRIU('x.r')} FROM generate_series(1, 99) i, LATERAL (SELECT public.fn_sms_numar_serviciu_salveaza(NULL,
  'Proba concurenta ' || lpad(i::text, 2, '0'), '0700' || lpad((900000 + i)::text, 6, '0'), NULL, NULL, NULL) AS r) x;`, 'sms_conc_prep')
    if (prep.code !== 0) throw new Error('pregătirea a picat: ' + eroare(prep))
    retine(prep)
    const active0 = await unu(`SELECT count(*) FROM public.sms_numere_serviciu WHERE activ`)
    if (active0 !== '99' || PROPRII.length !== 99) { nota('C1', 'PROBA_NEFUNCTIONALA', `după pregătire sunt ${active0} active (${PROPRII.length} proprii), nu 99`); return }

    // mutantul: definiția fără lock-ul consultativ (temporar; pusă înapoi în finally)
    if (MUTANT === 'fara_lock') {
      const m = await psql(['-f', '-'], inlocuiesteCorp(APEL_LOCK, MARCAJ), 'sms_conc_mut')
      if (m.code !== 0) throw new Error('mutantul nu s-a putut pune: ' + eroare(m))
      mutantPus = true
    }

    // ── 2. C1: A adaugă al 100-lea și ține tranzacția; B adaugă altul cât A e în fereastră ──
    const A = caOwner(uid, adauga('Proba concurenta A', '0700 900 100') + '\nSELECT pg_sleep(1.5);', 'sms_conc_A')
    A.then(retine)
    if (!await asteapta(inSomn('sms_conc_A'))) { const a = await A; nota('C1', 'PROBA_NEFUNCTIONALA', `A nu a ajuns în fereastră (cod ${a.code}: ${eroare(a)})`); return }
    let bGata = false
    const B = caOwner(uid, adauga('Proba concurenta B', '0700 900 101'), 'sms_conc_B')
    B.then((r) => { retine(r); bGata = true })
    await asteapta(async () => bGata || await blocataDe('sms_conc_B', 'sms_conc_A')(), 1000)
    const blocata = !bGata && await blocataDe('sms_conc_B', 'sms_conc_A')()
    const inca = await inSomn('sms_conc_A')()
    const a = await A, b = await B
    const active = await unu(`SELECT count(*) FROM public.sms_numere_serviciu WHERE activ`)
    const refuzLimita = b.code !== 0 && /22023/.test(b.err) && /maximum 100 de numere de serviciu active/.test(b.err)
    if (!inca && !bGata) nota('C1', 'PROBA_NEFUNCTIONALA', 'A nu mai era în fereastră când B a fost observată')
    else if (MUTANT === 'fara_lock') {
      const prins = !blocata && a.code === 0 && b.code === 0 && active === '101'
      nota('C1', prins ? 'OK' : 'CONTRAR', `mutant: B ${blocata ? 'BLOCATĂ (?)' : 'neblocată'}, A cod ${a.code}, B cod ${b.code}${b.code ? ' (' + eroare(b) + ')' : ''}, active ${active}${prins ? ' — limita DEPĂȘITĂ, DEFECT reprodus, mutant prins' : ''}`)
    } else if (!blocata) nota('C1', 'PROBA_NEFUNCTIONALA', `B nu a fost văzută blocată de A (B ${bGata ? 'terminată' : 'în curs'}, cod ${b.code}${b.code ? ': ' + eroare(b) : ''}, active ${active})`)
    else nota('C1', a.code === 0 && refuzLimita && active === '100' ? 'OK' : 'CONTRAR',
      `B blocată de A (lock-ul consultativ al adăugării); A ${a.code === 0 ? 'a comis' : 'a PICAT: ' + eroare(a)}; B ${refuzLimita ? 'refuzată cu 22023 „maximum 100 …”' : b.code === 0 ? 'A COMIS (limita depășită)' : 'a picat ALTFEL: ' + eroare(b)}; active ${active} (așteptat 100)`)
  }

  let iesire = 0
  try { await main() } catch (e) { console.error('EROARE: ' + e.message); iesire = 26 }
  finally {
    try {
      // definiția de plecare înapoi (doar dacă mutantul a fost pus)
      if (mutantPus) {
        const r = await psql(['-f', '-'], inlocuiesteCorp(MARCAJ, APEL_LOCK), 'sms_conc_mut')
        if (r.code !== 0) { console.error('definiția de plecare NU s-a putut pune înapoi: ' + eroare(r)); iesire = 25 }
      }
      // DOAR rândurile proprii, sub ACCESS EXCLUSIVE; secvența înapoi doar dacă rândurile = cele de la plecare
      if (PLECARE) {
        const c = await psql(['-t', '-A', '-F', '\t', '-f', '-'], sqlCuratenie({ randuri: PROPRII, seq: SEQ, seqPlecare: PLECARE.seq, randuriPlecare: PLECARE.randuri }), 'sms_conc_curata')
        if (c.code !== 0) { console.error('curățenia a picat: ' + eroare(c)); iesire = 25 }
        else {
          const linii = c.out.replace(/\r/g, '').split('\n')
          const sterse = (linii.find(l => l.startsWith('STERSE\t')) || '').split('\t')[1]
          const secv = (linii.find(l => l.startsWith('SECVENTA\t')) || '').split('\t').slice(1).join(' ')
          console.log(`curățenia: ${sterse} rânduri proprii șterse (din ${PROPRII.length} raportate de sesiuni); secvența: ${secv || '?'}`)
          if (!secv.startsWith('resetata')) { console.error('secvența NU a fost resetată (rânduri străine sub lock): rămâne cum e'); iesire = 25 }
        }
        const fin = { fn: await unu(STARE_FN), tab: await unu(STARE_TABEL), seq: await unu(`SELECT last_value || ' ' || is_called FROM ${SEQ}`), randuri: (await q(`SELECT ${SQL_RANDURI};`))[0] || '' }
        for (const k of ['fn', 'tab', 'seq', 'randuri']) if (fin[k] !== PLECARE[k]) { console.error(`STAREA FINALĂ diferă de plecare (${k}): ${fin[k] || '(gol)'} ≠ ${PLECARE[k] || '(gol)'}`); iesire = 25 }
      }
    } catch (e) { console.error('curățenia finală: ' + e.message); iesire = 25 }
  }
  if (!iesire) iesire = stari.includes('PROBA_NEFUNCTIONALA') ? 26 : stari.includes('CONTRAR') ? 1 : 0
  if (!iesire && !stari.length) iesire = 26   // niciun scenariu judecat = probă nefuncțională, nu „toate OK”
  console.log(`rezultat: ${iesire === 0 ? (MUTANT ? 'mutant PRINS' : 'OK') : 'cod ' + iesire} (${stari.join(', ')})`)
  process.exit(iesire)
}
