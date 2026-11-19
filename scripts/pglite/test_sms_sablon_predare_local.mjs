// Proba LOCALĂ a migrării 20261226b (SMS Redări: șablonul cu „predare”, versiunea provizoriu-2026-11-17) pe PGlite — NU atinge nicio bază reală.
// Baza: schema falsă supabase/tests/20261226b_sms_redari_sablon_predare_schelet.sql + funcțiile extrase EXACT din 20261130a (textul GSM-7) și
//   20261130c (modelul, versiunea, completarea, regula aprobării, motivul lotului); amprentele = constantele din 20261226b (pasul 0).
// Aplicarea: ca runnerul (marcaj + plafon 5000 + pașii L15 v2 generați: manifestul cu ROLLBACK, apoi livrarea aprobată + garda finală reală).
// 1. PARITATEA JS <-> SQL (L19) pe ACELAȘI tabel de cazuri (src/sms/sablonRedari.cazuri.js, texte scrise de mână): completeazaSablon() din
//    src/sms/sablonRedari.js și fn_sms_redari_sablon_calc() după migrare dau același rezultat (ok, text, lungime GSM-7, lipsuri, motiv) și
//    rezultatul scris de mână; un singur segment în aceleași condiții ca înainte (P10 rămâne prea lung).
// 2. Loturile: unul creat înainte (versiunea veche, textul cu „redare”) e refuzat după migrare ('sablon_neaprobat'), la fel unul nou pe un
//    proiect real (versiunea rămâne provizorie); unul nou pe TEST- trece; versiunea nouă cu textul vechi = 'text_schimbat'; NOTICE-ul loturilor.
// 3. Aplicare -> revenire -> reaplicare; refuzurile migrării și ale revenirii; MUTANȚI.
// Rulare (din rădăcina repo-ului; cere bash + python3 în PATH): npm install --no-save @electric-sql/pglite && node scripts/pglite/test_sms_sablon_predare_local.mjs
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { randomBytes, createHash } from 'node:crypto'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const TMP = mkdtempSync(join(tmpdir(), 'smspredare_'))
const citeste = rel => readFileSync(join(ROOT, rel), 'utf8').replace(/\r/g, '')
const md5 = s => createHash('md5').update(s, 'utf8').digest('hex')
const F_MIG = 'supabase/migrations/20261226b_sms_redari_sablon_predare.sql'
const F_REV = 'supabase/revenire/20261226b_sms_redari_sablon_predare_ROLLBACK.sql'
const SCHELET = citeste('supabase/tests/20261226b_sms_redari_sablon_predare_schelet.sql')
const MIG = citeste(F_MIG)
const REV = citeste(F_REV)
const OBIECTE = citeste('supabase/tests/20261226b_sms_redari_sablon_predare.l15.obiecte.tsv')
const gen = (...a) => execFileSync('bash', [join(ROOT, 'scripts/livrare_amprenta_gen.sh'), ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const { completeazaSablon, SABLON_REDARI, SABLON_REDARI_VERSIUNE } = await import(pathToFileURL(join(ROOT, 'src/sms/sablonRedari.js')).href)
const { CAZURI, AZI, ORA } = await import(pathToFileURL(join(ROOT, 'src/sms/sablonRedari.cazuri.js')).href)
const MODEL_NOU = 'Gazpet pt Transgaz: sesiune predare teren la Primaria {COMUNA}, {ZI} ora {ORA}. Raspuns si online, cu QR-ul din scrisoare. Tel {TEL}'
const MODEL_VECHI = 'Gazpet pt Transgaz: sesiune redare teren la Primaria {COMUNA}, {ZI} ora {ORA}. Raspuns si online, cu QR-ul din scrisoare. Tel {TEL}'

let esec = 0
const ok = (cond, msg) => { if (cond) console.log('  OK  ' + msg); else { esec++; console.log('  NU  ' + msg) } }
function functie(text, cap) {
  const i = text.indexOf(cap)
  if (i < 0) throw new Error('nu găsesc ' + cap)
  const a = /\bAS\s+(\$[A-Za-z_]*\$)/.exec(text.slice(i))
  const startCorp = i + a.index + a[0].length
  const sfarsit = text.indexOf(';', text.indexOf(a[1], startCorp) + a[1].length) + 1
  return text.slice(i, sfarsit).replace('CREATE OR REPLACE FUNCTION', 'CREATE FUNCTION')
}
function corp(text, cap) {
  const i = text.indexOf(cap)
  if (i < 0) throw new Error('nu găsesc ' + cap)
  const a = /\bAS\s+(\$[A-Za-z_]*\$)/.exec(text.slice(i))
  const start = i + a.index + a[0].length
  return text.slice(start, text.indexOf(a[1], start))
}
const M30A = citeste('supabase/migrations/20261130a_sms_mvp.sql'), M30C = citeste('supabase/migrations/20261130c_sms_redari_sablon.sql')
const FUNCTII = [
  [M30A, 'CREATE FUNCTION public.fn_sms_text_final('], [M30A, 'CREATE FUNCTION public.fn_sms_text_verifica(', 'fb828f896937261687a9b2c386284218'],
  [M30C, 'CREATE FUNCTION public.fn_sms_redari_sablon_model()', '228429272ed678584a9410ba0a3bb326'],
  [M30C, 'CREATE FUNCTION public.fn_sms_redari_sablon_aprobat(', '549e00f42578299142a97c84f6663145'],
  [M30C, 'CREATE FUNCTION public.fn_sms_redari_sablon_versiune()', 'a95b87be01cbf56f72af91c691255dc3'],
  [M30C, 'CREATE FUNCTION public.fn_sms_redari_sablon_calc(', '45e1189c4d887ca36fb3707df701a8ad'],
  [M30C, 'CREATE FUNCTION public.fn_sms_redari_lot_motiv_la('],
]
console.log('0. funcțiile extrase din migrările lor (amprentele = constantele din 20261226b / revenire)')
let SQL_FUNCTII = ''
for (const [text, cap, amp] of FUNCTII) {
  if (amp) { const m = md5(corp(text, cap)); ok(m === amp && MIG.includes(`'${amp}'`), `${cap.replace('CREATE FUNCTION ', '')}: ${m}`) }
  SQL_FUNCTII += functie(text, cap) + '\n'
}
SQL_FUNCTII += `REVOKE ALL ON FUNCTION public.fn_sms_text_final(text), public.fn_sms_text_verifica(text), public.fn_sms_redari_sablon_model(),
  public.fn_sms_redari_sablon_aprobat(text, text, uuid, integer), public.fn_sms_redari_sablon_versiune(), public.fn_sms_redari_sablon_calc(text, date[], text[], text, timestamp),
  public.fn_sms_redari_lot_motiv_la(public.sms_loturi, timestamptz) FROM PUBLIC, anon, authenticated, service_role;\n`
ok(md5(corp(REV, 'CREATE OR REPLACE FUNCTION public.fn_sms_redari_sablon_model()')) === '228429272ed678584a9410ba0a3bb326'
  && md5(corp(REV, 'CREATE OR REPLACE FUNCTION public.fn_sms_redari_sablon_versiune()')) === 'a95b87be01cbf56f72af91c691255dc3', 'revenirea repune corpurile EXACTE din 20261130c')
const CAP_NOI = [['public.fn_sms_redari_sablon_model()', 'CREATE OR REPLACE FUNCTION public.fn_sms_redari_sablon_model()'],
  ['public.fn_sms_redari_sablon_versiune()', 'CREATE OR REPLACE FUNCTION public.fn_sms_redari_sablon_versiune()']]
const blocNoi = t => t.slice(t.indexOf('-- >>> AMPRENTE-NOI 20261226b'), t.indexOf('-- <<< AMPRENTE-NOI 20261226b'))
for (const [sem, cap] of CAP_NOI) {
  const m = md5(corp(MIG, cap))
  ok(blocNoi(MIG).includes(`('${sem}', '${m}')`) && blocNoi(REV).includes(`('${sem}', '${m}')`), `amprenta nouă ${sem} = ${m} (migrare + revenire)`)
}
// DOAR în blocul AMPRENTE-NOI (garda de start are aceleași etichete, cu amprentele 20261130c, și trebuie să rămână neatinsă)
const recalculeaza = t => {
  const a = t.indexOf('-- >>> AMPRENTE-NOI 20261226b'), b = t.indexOf('-- <<< AMPRENTE-NOI 20261226b')
  const bloc = CAP_NOI.reduce((x, [sem, cap]) => x.replace(new RegExp(`(\\('${sem.replace(/[().]/g, '\\$&')}', ')[0-9a-f]{32}`), `$1${md5(corp(t, cap))}`), t.slice(a, b))
  return t.slice(0, a) + bloc + t.slice(b)
}
// constanta JS = modelul / versiunea SQL din migrare (aceeași livrare)
ok(SABLON_REDARI === MODEL_NOU && MIG.includes(`'${MODEL_NOU}'::text`), 'SABLON_REDARI (JS) = modelul din 20261226b')
ok(SABLON_REDARI_VERSIUNE === 'provizoriu-2026-11-17' && MIG.includes(`'${SABLON_REDARI_VERSIUNE}'::text`), 'SABLON_REDARI_VERSIUNE (JS) = versiunea din 20261226b (provizorie)')

const validator = (fisier, ...opt) => {
  try {
    const o = execFileSync('bash', ['-c', 'exec python3 "$@"', '_', join(ROOT, 'scripts/livrare_validator.py'), fisier, 'reg_0123456789abcdef', ...opt],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { ok: true, out: o.trim() }
  } catch (e) { return { ok: false, out: String(e.stderr || e.message).trim() } }
}
const PLAFON_LIVRARE = Number(execFileSync('bash', ['-c', '. "$1"; printf %s "$AG_PLAFON_MS"', '_', join(ROOT, 'scripts/livrare_amprenta.sh')], { encoding: 'utf8' }))
const PLAFON_REVENIRE = 2000
const garda = (nume, plafon, final) => execFileSync('bash', ['-c', '. "$1"; lm_fin "$2" "$3" "$4" lock', '_', join(ROOT, 'scripts/livrare_mesaj.sh'), nume, String(plafon), final], { encoding: 'utf8' })
console.log('0b. validatorul runnerului')
{
  const vm = validator(join(ROOT, F_MIG), '--plafon-tranzactie-ms', String(PLAFON_LIVRARE))
  ok(vm.ok && /^OK \d+ /.test(vm.out), 'migrarea trece validatorul cu 5000: ' + vm.out)
  const vm2 = validator(join(ROOT, F_MIG), '--plafon-tranzactie-ms', '2000')
  ok(!vm2.ok && /PLAFON_DIFERIT/.test(vm2.out), 'migrarea cu runnerul la 2000 = refuz')
  const vmf = validator(join(ROOT, F_MIG), '--fara-plafon')
  ok(!vmf.ok && /PLAFON_LIPSA/.test(vmf.out), 'migrarea fără plafon = refuz local')
  const vr = validator(join(ROOT, F_REV), '--plafon-tranzactie-ms', String(PLAFON_REVENIRE))
  ok(vr.ok && /^OK \d+ /.test(vr.out), 'revenirea trece validatorul cu 2000: ' + vr.out)
  const vr2 = validator(join(ROOT, F_REV), '--plafon-tranzactie-ms', String(PLAFON_LIVRARE))
  ok(!vr2.ok && /PLAFON_DIFERIT/.test(vr2.out), 'revenirea cu runnerul la 5000 = refuz')
}

// ── 0c. proba fluxului pe clonă (scriptul coordonatorului, nerulat aici): sintaxa bash, scenariile F1-F7, gărzile, legătura cu sursele ──
console.log('0c. scriptul pentru clonă (fluxul complet): bash -n + F1-F7 + gărzi + mesajele așteptate = textele din migrări')
{
  const F_FL = join(ROOT, 'supabase/tests/20261226b_sms_predare_flux_clona.sh')
  let sn = null; try { execFileSync('bash', ['-n', F_FL], { stdio: ['ignore', 'pipe', 'pipe'] }) } catch (e) { sn = String(e.stderr || e.message) }
  ok(sn === null, 'scriptul fluxului: bash -n ' + (sn || 'OK'))
  const fl = readFileSync(F_FL, 'utf8').replace(/\r/g, '')
  const M30B = citeste('supabase/migrations/20261130b_sms_acces_modul.sql'), DOC_B = citeste('docs/sms/LIVRARE_20261226b_SABLON_PREDARE.md')
  // fiecare scenariu: descris în antet (rezultatul așteptat scris de mână) ȘI verificat (o etichetă OK / NU care începe cu el)
  const lipsa = ['F1a', 'F1', 'F2', 'F3', 'F4a', 'F4c', 'F4b', 'F5', 'F6', 'F7'].filter(f => !new RegExp(`^#   ${f} `, 'm').test(fl) || !fl.includes(`"${f} `))
  ok(lipsa.length === 0, 'scenariile F1-F7 (cu F4c) au antet + verificări' + (lipsa.length ? ': lipsesc ' + lipsa.join(', ') : ''))
  // gărzile înaintea oricărei scrieri: ținta (22), A + B aplicate (23), conturile (24), mediul (27), izolarea SMS (28), resturile (25);
  // PASS doar din curățenie (semantica gărzilor 25 / 28 și a curățeniei: scripts/pglite/test_sms_predare_flux_clona_local.mjs)
  const iS0 = fl.indexOf('# ── S0 datele sintetice')
  const garzi = [/REAL="\$\(q "SELECT system_identifier FROM pg_control_system\(\)"\)"/, /exit 22; \}/, /fn_red_optiune_retrasa\(text\)/, /exit 23; \}/, /exit 24; \}/,
    /exit 25; \}/, /exit 27; \}/, /pg_cron/, /ESEC=1; exit 28/, /^izolare_verifica "la pornire"$/m]
  ok(iS0 > 0 && garzi.every(r => { const m = r.exec(fl); return m && m.index < iS0 }), 'gărzile (system_identifier, A + B aplicate, conturi, mediu, izolare SMS, resturi) vin înaintea primei scrieri (S0)')
  ok((fl.match(/PASS: /g) || []).length === 1 && fl.indexOf('PASS: ') > fl.indexOf('curatenie() {') && fl.indexOf('PASS: ') < fl.indexOf('trap curatenie EXIT')
    && /exit 26/.test(fl), 'PASS se tipărește doar din curățenie, după verificare; curățenia picată = 26')
  // amprentele din gărzi = cele din surse (postcondiția 20261226b; 20261130c / 20261130b pentru lanțul SMS)
  const noi = /AMPRENTE-NOI 20261226b([\s\S]*?)<<< AMPRENTE-NOI/.exec(MIG)[1].match(/[0-9a-f]{32}/g)
  ok(noi.length === 2 && noi.every(h => fl.includes(h)), 'garda B = amprentele postcondiției 20261226b: ' + noi.join(', '))
  const lant = ['88991164518c47220941896f7d53deb6', '380000981deb53acfa21dbf26569066c', 'b565d0c4c1ff62320c14ae384ed6bb94', '1f14c19429a94c1146557e41db01e190']
  ok(lant.every(h => fl.includes(h) && M30C.includes(h)) && fl.includes('b641f8c12d851541be4e0fc300f44dc3') && M30B.includes('b641f8c12d851541be4e0fc300f44dc3'),
    'garda lanțului SMS = amprentele din 20261130c / 20261130b')
  // versiunile și modelul: aceleași ca sursa (JS + migrații), textul scris de mână în script = modelul cu câmpurile completate
  ok(new RegExp(`^VERS_NOUA=${SABLON_REDARI_VERSIUNE}; VERS_VECHE=provizoriu-2026-11-03$`, 'm').test(fl) && M30C.includes("SELECT 'provizoriu-2026-11-03'::text"),
    'versiunile din script = SABLON_REDARI_VERSIUNE și versiunea din 20261130c')
  const fmt = MODEL_NOU.replace('predare', '%s').replace('{COMUNA}', '%s').replace('{ZI}', '%s').replace('{ORA}', '09:00').replace('{TEL}', '%s')
  ok(fl.includes(`printf '${fmt}'`) && SABLON_REDARI === MODEL_NOU, 'textul scris de mână în script = modelul din documentul B (cu „predare” / „redare”)')
  // mesajele de refuz așteptate în script există EXACT în migrări (nu sunt inventate)
  const mesaje = [
    ['sms redari: blocat - asteapta autorizarea scrisa Transgaz', M30C], ['sms redari: textul s-a schimbat fata de cel afisat', M30C],
    ['sms: nu ai acces la modulul SMS', M30B], ['sms: lotul s-a schimbat de la previzualizare', M30B],
    ['sms redari: UAT-ul are deja un lot activ', M30C], ['sms redari: campania pentru acest UAT si ziua de sesiune', M30C]]
  const nepotrivite = mesaje.filter(([m, src]) => !fl.includes(m) || !src.includes(m)).map(([m]) => m)
  ok(nepotrivite.length === 0 && M30B.includes("'sms: lotul e deja inchis (%)'") && fl.includes('sms: lotul e deja inchis \\(coada_golita\\)')
    && M30C.includes("RAISE EXCEPTION 'sms redari: % - %; anuleaza lotul si creeaza altul', v_motiv") && fl.includes("'^ERR 22023 sms redari: sablon_neaprobat - '")
    && M30C.includes("'motiv', 'redari_neautorizat'") && M30C.includes("RETURN 'sablon_neaprobat'"),
    'mesajele / motivele așteptate de script = textele din 20261130b / 20261130c' + (nepotrivite.length ? ': ' + nepotrivite.join('; ') : ''))
  // interogarea documentului B §4, verbatim în script (clasificarea loturilor vechi)
  const q4 = /```sql\n(  SELECT l\.id, l\.stare, l\.uat_id[\s\S]*?GROUP BY l\.id ORDER BY l\.creat_la;)\n  ```/.exec(DOC_B)
  const q4s = q4 && q4[1].replace(/;$/, '')
  ok(q4s && fl.includes(q4s), 'interogarea din documentul B §4 apare verbatim în script (F6)')
  // căile reale, fără furnizor / edge / cron: RPC-urile aplicației și ale workerului; nicio cerere HTTP; nicio rezervare fără lot (cronul)
  const rpc = ['fn_sms_lot_redari_sablon_creeaza', 'fn_sms_lot_aproba', 'fn_sms_rezerva', 'fn_sms_rezultat', 'fn_sms_lot_anuleaza', 'fn_sms_redari_autorizare_seteaza', 'fn_sms_lot_destinatari']
  ok(rpc.every(f => fl.includes(`public.${f}(`)) && !/curl |functions\/v1|net\.http|fn_sms_rezerva\(NULL/.test(fl),
    'scriptul folosește RPC-urile reale, fără HTTP / edge / cron (fn_sms_rezerva mereu cu lot)')
  // triggerele oprite doar în tranzacții care le reactivează și le verifică înainte de COMMIT (fixture-ul F6 și curățenia)
  const opriri = (fl.match(/DISABLE TRIGGER/g) || []).length, porniri = (fl.match(/ENABLE TRIGGER/g) || []).length
  ok(opriri === porniri && opriri > 0 && /tgenabled <> 'O'/.test(fl) && /tgenabled = 'D'/.test(fl), `triggerele: ${opriri} opriri = ${porniri} reporniri, verificate înainte de COMMIT`)
}

// ── datele (fictive) ──
const PT = '00000000-0000-0000-0000-00000000f001', PR = '00000000-0000-0000-0000-00000000f002'
const UT = '00000000-0000-0000-0000-00000000f011', UR = '00000000-0000-0000-0000-00000000f012'
const L = { VECHI: '00000000-0000-0000-0000-00000000f101', GOLITA: '00000000-0000-0000-0000-00000000f102', ANULAT: '00000000-0000-0000-0000-00000000f103',
  INTERN: '00000000-0000-0000-0000-00000000f104', NOU: '00000000-0000-0000-0000-00000000f105', NOU_REAL: '00000000-0000-0000-0000-00000000f106',
  AMESTEC: '00000000-0000-0000-0000-00000000f107' }
const textCalc = uat => `(SELECT public.fn_sms_redari_sablon_calc(u.nume, ARRAY[u.sesiune_zi1, u.sesiune_zi2, u.sesiune_zi3], ARRAY[u.program_zi1, u.program_zi2, u.program_zi3],
  p.contact_telefon, (now() AT TIME ZONE 'Europe/Bucharest')) ->> 'text' FROM public.red_uat u JOIN public.red_proiecte p ON p.id = u.proiect_id WHERE u.id = '${uat}')`
// ver = 'curenta' -> versiunea curentă din BD (așa o scrie crearea lotului), altfel literalul dat
const filtru = ver => `jsonb_build_object('sablon', 'redari_v1', 'sablon_versiune', ${ver === 'curenta' ? 'public.fn_sms_redari_sablon_versiune()' : `'${ver}'`}, 'zi', to_char(current_date + 5, 'YYYY-MM-DD'), 'ora', '09:00')`
const lot = (id, proiect, uat, ver, stare = 'draft', text = textCalc(uat)) =>
  `INSERT INTO public.sms_loturi (id, categorie, stare, text, filtru, proiect_id, uat_id, nr_destinatari) VALUES ('${id}', 'redari', '${stare}', ${text}, ${filtru(ver)}, '${proiect}', '${uat}', 2);`
const DATE = `
INSERT INTO public.red_proiecte (id, cod, contact_telefon) VALUES ('${PT}', 'TEST-PROIECT-SMS', '0700 000 111'), ('${PR}', 'LOT-FICTIV-REAL', '0700 000 111');
INSERT INTO public.red_uat (id, proiect_id, nume, sesiune_zi1, program_zi1) VALUES ('${UT}', '${PT}', 'Testeni', current_date + 5, '09:00 - 16:00'), ('${UR}', '${PR}', 'Testeni', current_date + 5, '09:00 - 16:00');
-- loturile create ÎNAINTE de migrare (versiunea veche, textul cu „redare”, calculat de modelul vechi)
${lot(L.VECHI, PT, UT, 'provizoriu-2026-11-03')}
${lot(L.GOLITA, PT, UT, 'provizoriu-2026-11-03', 'coada_golita')}
INSERT INTO public.sms_mesaje (lot_id, stare) VALUES ('${L.GOLITA}', 'necunoscut');
${lot(L.ANULAT, PT, UT, 'provizoriu-2026-11-03', 'anulat')}
INSERT INTO public.sms_loturi (id, categorie, stare, text, filtru) VALUES ('${L.INTERN}', 'intern', 'draft', 'text intern', '{}');`

async function bazaNoua() {
  const db = new PGlite()
  await db.exec(SCHELET)
  await db.exec(SQL_FUNCTII)
  await db.exec(DATE)
  return db
}
async function caRunner(db, nume, text, { plafon = PLAFON_LIVRARE, marcajPlafon = true, marcaj = true, l15 = 'inainte', aprobat = '-', manifest = '-', final = 'COMMIT' } = {}) {
  const pre = plafon ? `SET transaction_timeout = ${plafon};` : 'SET transaction_timeout = 0;'
  const mp = marcajPlafon ? `SELECT set_config('gazpet.plafon_tranzactie', '${plafon}:' || txid_current(), true);` : ''
  const mk = marcaj ? `SELECT set_config('gazpet.livrare_migrare', '${nume}:' || txid_current(), true);` : ''
  const T = randomBytes(8).toString('hex')
  const ina = l15 === 'nimic' ? '' : gen('inainte', T, aprobat)
  const dupa = l15 === 'livrare' ? gen('dupa', T, aprobat, manifest) : ''
  const jurnal = []
  try {
    await db.exec(pre)
    await db.exec(`BEGIN ISOLATION LEVEL READ COMMITTED; ${mk} ${mp}`)
    await db.exec(ina + '\n' + text + '\n;\n' + dupa, { onNotice: n => jurnal.push(n.message) })
    await db.exec(final, { onNotice: n => jurnal.push(n.message) })
  } catch (e) { try { await db.exec('ROLLBACK') } catch { /* deja anulată */ } e.jurnal = jurnal; throw e } finally { await db.exec('SET transaction_timeout = 0;') }
  return jurnal
}
const aplicaMig = (db, text = MIG, o) => caRunner(db, '20261226b_sms_redari_sablon_predare', text, o)
const revino = (db, text = REV, o) => caRunner(db, '20261226b_sms_redari_sablon_predare_ROLLBACK', text, { l15: 'nimic', plafon: PLAFON_REVENIRE, ...o })
function aplica(text, lista) {
  let t = text
  for (const [din, in_] of lista || []) {
    if (!t.includes(din)) throw new Error('mutantul nu găsește textul: ' + din.slice(0, 90))
    if (t.split(din).length !== 2) throw new Error('mutantul găsește textul de mai multe ori: ' + din.slice(0, 90))
    t = t.split(din).join(in_)
  }
  return t
}
const eroare = async p => { try { await p; return null } catch (e) { return e.message } }
const lit = s => s == null ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`
const motiv = async (db, id) => (await db.query(`SELECT public.fn_sms_redari_lot_motiv_la(l, now()) AS m FROM public.sms_loturi l WHERE l.id = '${id}'`)).rows[0].m

// ── paritatea JS <-> SQL pe tabelul comun de cazuri ──
async function paritate(db) {
  const ab = []
  for (const [cod, uat, proiect, astept, oraAcum = ORA] of CAZURI) {
    const js = completeazaSablon({ uat, proiect, azi: AZI, oraAcum })
    const zile = [1, 2, 3].map(n => lit(uat[`sesiune_zi${n}`])).join(', '), prog = [1, 2, 3].map(n => lit(uat[`program_zi${n}`])).join(', ')
    const sql = (await db.query(`SELECT public.fn_sms_redari_sablon_calc(${lit(uat.nume)}, ARRAY[${zile}]::date[], ARRAY[${prog}]::text[], ${lit(proiect.contact_telefon)},
      ${lit(AZI + ' ' + oraAcum)}::timestamp) AS r`)).rows[0].r
    const jsN = { ok: js.ok, text: js.text, lungime: js.lungime, lipsuri: js.lipsuri.map(l => l.cod), motiv: js.motiv ?? null }
    const sqlN = { ok: sql.ok, text: sql.text, lungime: sql.lungime, lipsuri: sql.lipsuri, motiv: sql.motiv ?? null }
    if (JSON.stringify(jsN) !== JSON.stringify(sqlN)) ab.push(`${cod} JS ${JSON.stringify(jsN)} != SQL ${JSON.stringify(sqlN)}`)
    if (typeof astept === 'string' && (sqlN.text !== astept || sqlN.ok !== true || sqlN.lungime !== astept.length || sqlN.lungime > 160)) ab.push(`${cod} SQL ${JSON.stringify(sqlN)} != scris de mână`)
    if (Array.isArray(astept) && JSON.stringify(sqlN.lipsuri) !== JSON.stringify(astept)) ab.push(`${cod} lipsuri SQL ${JSON.stringify(sqlN.lipsuri)}`)
    if (astept?.prea_lung && (sqlN.motiv !== 'prea_lung' || sqlN.text !== astept.prea_lung)) ab.push(`${cod} prea_lung SQL ${JSON.stringify(sqlN)}`)
  }
  return ab
}
// ── loturile după migrare ──
async function verificaLoturi(db) {
  const ab = []
  const m = async (id, astept, ce) => { const v = await motiv(db, id); if (v !== astept) ab.push(`${ce}: ${v} (aștepta ${astept})`) }
  await m(L.VECHI, 'sablon_neaprobat', 'lotul vechi (versiunea veche) refuzat')
  await m(L.GOLITA, 'sablon_neaprobat', 'lotul vechi coada_golita refuzat')
  const vc = (await db.query('SELECT public.fn_sms_redari_sablon_versiune() AS v')).rows[0].v
  if (vc !== 'provizoriu-2026-11-17') ab.push('versiunea curentă: ' + vc)
  await db.exec(lot(L.NOU, PT, UT, 'curenta'))
  await m(L.NOU, null, 'lotul nou pe TEST- (versiunea nouă, textul nou) trece')
  const tNou = (await db.query(`SELECT text FROM public.sms_loturi WHERE id = '${L.NOU}'`)).rows[0].text
  if (!/^Gazpet pt Transgaz: sesiune predare teren la Primaria Testeni, \d\d\.\d\d ora 09:00\. Raspuns si online, cu QR-ul din scrisoare\. Tel 0700 000 111$/.test(tNou)) ab.push('textul lotului nou: ' + tNou)
  await db.exec(lot(L.NOU_REAL, PR, UR, 'curenta'))
  await m(L.NOU_REAL, 'sablon_neaprobat', 'lotul nou pe proiect real (versiune provizorie) refuzat')
  await db.exec(lot(L.AMESTEC, PT, UT, 'curenta', 'draft', `replace(${textCalc(UT)}, 'predare', 'redare')`))
  await m(L.AMESTEC, 'text_schimbat', 'versiunea nouă cu textul vechi = text_schimbat')
  for (const rol of ['anon', 'authenticated', 'service_role']) {
    try { await db.exec(`BEGIN; SET LOCAL ROLE ${rol}; SELECT public.fn_sms_redari_sablon_model(); COMMIT;`); ab.push(`${rol} cheamă modelul`) }
    catch (e) { await db.exec('ROLLBACK'); if (e.code !== '42501') ab.push(`${rol}: ${e.code} ${e.message}`) }
  }
  return ab
}
const listaObiecte = text => text.split('\n').filter(l => l && !l.startsWith('#')).map(l => l.split('\t').slice(0, 3).join('\t')).sort()

console.log('1. înainte de migrare: reperul (lotul vechi trece pe TEST-, modelul cu „redare”)')
{
  const db = await bazaNoua()
  ok(await motiv(db, L.VECHI) === null && (await db.query('SELECT public.fn_sms_redari_sablon_model() AS m')).rows[0].m === MODEL_VECHI, 'înainte: lotul vechi valid, modelul vechi')
  await db.close()
}

console.log('2. aplicarea ca la livrare (L15 v2) + paritatea + loturile')
{
  const db = await bazaNoua()
  let jg = []
  try { jg = await aplicaMig(db, MIG, { l15: 'livrare', aprobat: '-', manifest: '-', final: 'ROLLBACK' }) } catch (e) { jg = e.jurnal || []; console.log('     ' + e.message) }
  const G = (jg.map(m => m.match(/^AMPRENTA_GLOBALA_CITITA inainte: ([0-9a-f]{32})/)).find(Boolean) || [])[1]
  const manifest = jg.filter(m => m.startsWith('L15_DIF ')).map(m => m.slice('L15_DIF '.length)).join('\n') + '\n'
  const gener = listaObiecte(manifest), revizuit = listaObiecte(OBIECTE)
  if (process.argv.includes('--scrie-obiecte')) writeFileSync(join(ROOT, 'supabase/tests/20261226b_sms_redari_sablon_predare.l15.obiecte.tsv'),
    '# 20261226b: obiectele din manifestul L15 v2 (familie TAB eticheta TAB operatie), fara amprente\n' + gener.join('\n') + '\n')
  const lipsa = revizuit.filter(x => !gener.includes(x)), plus = gener.filter(x => !revizuit.includes(x))
  ok(G && gener.length === 2 && !lipsa.length && !plus.length, `manifestul generat (${gener.length} obiecte) = lista revizuită; lipsă [${lipsa.join(' | ')}] în plus [${plus.join(' | ')}]`)
  const fManifest = join(TMP, '20261226b_sms_redari_sablon_predare.l15.tsv')
  writeFileSync(fManifest, manifest)
  const j = await aplicaMig(db, MIG, { l15: 'livrare', aprobat: G, manifest: fManifest, final: garda('20261226b_sms_redari_sablon_predare', PLAFON_LIVRARE, 'COMMIT') })
  ok(j.some(m => /^AMPRENTA_GLOBALA dupa: \d+ diferente = manifestul/.test(m)) && j.some(m => /^PLAFON_TIMP 20261226b_sms_redari_sablon_predare: garda trecuta la \d+ ms de la BEGIN \(plafon 5000 ms\)/.test(m)),
    'livrarea aprobată: diferența = manifestul; PLAFON_TIMP (5000)')
  const nl = j.find(m => /loturi Redari active/.test(m)) || ''
  ok(new RegExp(`loturi Redari active cu alta versiune decat provizoriu-2026-11-17: 2 \\(${L.VECHI} draft; ${L.GOLITA} coada_golita;`).test(nl), 'NOTICE-ul loturilor de anulat (draft + coada_golita cu „necunoscut”; nu anulat / intern): ' + nl.slice(0, 160))
  ok((await db.query('SELECT public.fn_sms_redari_sablon_model() AS m, public.fn_sms_redari_sablon_versiune() AS v')).rows[0].v === 'provizoriu-2026-11-17', 'versiunea = provizoriu-2026-11-17')
  const ap = await paritate(db)
  ap.forEach(a => console.log('     ' + a))
  ok(ap.length === 0, `paritatea JS <-> SQL pe ${CAZURI.length} cazuri (${ap.length} abateri)`)
  const al = await verificaLoturi(db)
  al.forEach(a => console.log('     ' + a))
  ok(al.length === 0, `loturile după migrare (${al.length} abateri)`)
  const m = await eroare(aplicaMig(db))
  ok(/reaplicare/.test(m || ''), 'reaplicarea refuzată: ' + m)
  // revenire -> reaplicare
  const jr = await revino(db)
  ok((await db.query('SELECT public.fn_sms_redari_sablon_model() AS m')).rows[0].m === MODEL_VECHI && await motiv(db, L.VECHI) === null
    && await motiv(db, L.NOU) === 'sablon_neaprobat', 'revenirea: modelul vechi; lotul vechi trece iar, lotul nou refuzat')
  ok(jr.some(m => /revenire: loturi Redari active cu alta versiune decat provizoriu-2026-11-03: 3 /.test(m)), 'NOTICE-ul revenirii (NOU, NOU_REAL, AMESTEC): ' + (jr.find(m => /revenire: loturi/.test(m)) || '').slice(0, 120))
  await aplicaMig(db)
  ok(await motiv(db, L.VECHI) === 'sablon_neaprobat' && await motiv(db, L.NOU) === null, 'reaplicarea: aceeași stare')
  await db.close()
}

console.log('3. refuzurile migrării (nimic schimbat)')
for (const [nume, fn, re] of [
  ['fără marcajul runnerului', db => aplicaMig(db, MIG, { marcaj: false }), /garda start invalida/],
  ['fără plafon', db => aplicaMig(db, MIG, { plafon: 0, marcajPlafon: false }), /PLAFON_TRANZACTIE lipsa/],
  ['plafonul vechi (2000)', db => aplicaMig(db, MIG, { plafon: 2000 }), /PLAFON_TRANZACTIE lipsa: 2000\/session/],
  ['fără amprenta globală L15 v2', db => aplicaMig(db, MIG, { l15: 'nimic' }), /AMPRENTA_GLOBALA_LIPSA/],
  ['modelul schimbat înainte', async db => {
    await db.exec(`CREATE OR REPLACE FUNCTION public.fn_sms_redari_sablon_model() RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $f$ SELECT 'alt text'::text $f$;`)
    return aplicaMig(db)
  }, /functiile sablonului nu sunt cele din 20261130c/],
  ['regula aprobării schimbată înainte', async db => {
    await db.exec(`CREATE OR REPLACE FUNCTION public.fn_sms_redari_sablon_aprobat(p_versiune text, p_versiune_curenta text, p_proiect_id uuid, p_nr integer) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$ SELECT true $f$;`)
    return aplicaMig(db)
  }, /functiile sablonului nu sunt cele din 20261130c/],
  ['modelul primit de authenticated', async db => { await db.exec(`GRANT EXECUTE ON FUNCTION public.fn_sms_redari_sablon_model() TO authenticated`); return aplicaMig(db) }, /functiile sablonului nu sunt cele din 20261130c/],
  ['verificarea GSM-7 schimbată', async db => {
    await db.exec(`CREATE OR REPLACE FUNCTION public.fn_sms_text_verifica(p text, OUT text_final text, OUT lungime integer, OUT segmente integer, OUT nepermise text)
      LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $f$ BEGIN text_final := p; lungime := 0; segmente := 1; nepermise := ''; END $f$;`)
    return aplicaMig(db)
  }, /fn_sms_text_verifica nu e cea din 20261130a/],
]) {
  const db = await bazaNoua()
  const m = await eroare(fn(db))
  const neschimbat = (await db.query('SELECT public.fn_sms_redari_sablon_versiune() AS v')).rows[0].v === 'provizoriu-2026-11-03'
  ok(m && re.test(m) && neschimbat, `${nume}: ${m ? m.slice(0, 140) : 'A TRECUT'}`)
  await db.close()
}

console.log('4. refuzurile revenirii')
for (const [nume, pregatire, o, re] of [
  ['migrarea neaplicată', async () => {}, {}, /starea nu e cea din 20261226b/],
  ['fără plafon', async db => aplicaMig(db), { plafon: 0, marcajPlafon: false }, /PLAFON_TRANZACTIE lipsa/],
  ['cu plafonul livrării (5000)', async db => aplicaMig(db), { plafon: 5000 }, /PLAFON_TRANZACTIE lipsa: 5000\/session/],
  ['modelul schimbat după aplicare', async db => {
    await aplicaMig(db)
    await db.exec(`CREATE OR REPLACE FUNCTION public.fn_sms_redari_sablon_model() RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $f$ SELECT 'alt text'::text $f$;`)
  }, {}, /starea nu e cea din 20261226b/],
]) {
  const db = await bazaNoua()
  await pregatire(db)
  const inainte = (await db.query('SELECT public.fn_sms_redari_sablon_model() AS m')).rows[0].m
  const m = await eroare(revino(db, REV, o))
  ok(m && re.test(m) && (await db.query('SELECT public.fn_sms_redari_sablon_model() AS m')).rows[0].m === inainte, `${nume}: ${m ? m.slice(0, 140) : 'A TRECUT'}`)
  await db.close()
}

console.log('5. MUTANȚI (fiecare TREBUIE să pice: la aplicare, la paritate sau la loturi)')
const POST_START = MIG.indexOf('DO $post$'), POST_SF = MIG.indexOf('END $post$;') + 'END $post$;'.length
const FARA_POST = [MIG.slice(POST_START, POST_SF), 'SELECT 1;']
const MOD_NOU = `  SELECT '${MODEL_NOU}'::text\n`, VER_NOU = "  SELECT 'provizoriu-2026-11-17'::text\n"
for (const [nume, lista] of [
  ['modelul SQL lăsat cu „redare” (doar JS schimbat)', [[MOD_NOU, `  SELECT '${MODEL_VECHI}'::text\n`]]],
  ['modelul SQL lăsat cu „redare” + fără postcondiții', [[MOD_NOU, `  SELECT '${MODEL_VECHI}'::text\n`], FARA_POST]],
  ['versiunea neschimbată', [[VER_NOU, "  SELECT 'provizoriu-2026-11-03'::text\n"]]],
  ['versiunea neschimbată + fără postcondiții', [[VER_NOU, "  SELECT 'provizoriu-2026-11-03'::text\n"], FARA_POST]],
  ['versiunea marcată finală (nu mai e provizorie)', [[VER_NOU, "  SELECT 'final-2026-11-17'::text\n"]]],
  ['versiunea marcată finală + fără postcondiții', [[VER_NOU, "  SELECT 'final-2026-11-17'::text\n"], FARA_POST]],
]) {
  const db = await bazaNoua()
  let t
  try { t = recalculeaza(aplica(MIG, lista)) } catch (e) { ok(false, `${nume}: mutantul nu se aplică (${e.message})`); continue }
  const m = await eroare(aplicaMig(db, t))
  let prins = !!m, cum = m ? 'la aplicare: ' + m.slice(0, 100) : ''
  if (!m) { const ab = [...await paritate(db), ...await verificaLoturi(db)]; prins = ab.length > 0; cum = `${ab.length} abateri (${(ab[0] || '').slice(0, 110)})` }
  ok(prins, `MUTANT ${nume} — prins ${cum}`)
  await db.close()
}

console.log(esec ? `\nESEC: ${esec} verificări au picat` : '\nPASS: toate verificările au trecut')
process.exit(esec ? 1 : 0)
