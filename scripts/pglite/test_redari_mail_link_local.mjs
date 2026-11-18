// Proba LOCALĂ a migrării 20261131i (Redări e-mail: linkul PERSONAL de răspuns și câmpurile sesiunii completate PE FIECARE MESAJ, în snapshot) pe PGlite
// (Postgres în WASM, în memorie) — NU atinge nicio bază reală.
// Baza: schema falsă supabase/tests/20261131i_redari_mail_link_schelet.sql + funcțiile extrase EXACT din migrările lor (26a, 27a, 30k, 30m, 31a — inclusiv
//   fn_red_mail_lot_creeaza / destinatari / lot_aproba / rezerva / apel_incepe / rezultat / f2_garda); apoi 20261131h APLICATĂ ca migrare reală (ca runnerul);
//   amprentele verificate de gărzile 31i = constantele din 31i (pasul 0).
// Aplicarea 31i: ca runnerul — marcaj + plafon 5000 (AG_PLAFON_MS) + PAȘII L15 v2 GENERAȚI de scripts/livrare_amprenta_gen.sh: generarea manifestului
//   (ROLLBACK), apoi livrarea cu GLOBAL-ul citit + manifestul generat (diferența = exact manifestul) și garda finală REALĂ a runnerului (lm_fin) + COMMIT.
//   Lista obiectelor = supabase/tests/20261131i_redari_mail_link_personal.l15.obiecte.tsv (--scrie-obiecte o rescrie).
// 1. Comportamentul (valorile așteptate scrise de mână, L25), ca rolul real al fiecărei căi (owner / editor cu JWT, service_role, postgres):
//    câmpurile lotului (RPC), crearea unui lot cu 3 destinatari — fiecare mesaj cu linkul LUI, fără acolade, hash-ul peste textul final (paritate cu
//    hashMesaj din JS), subiectul completat; câmp necunoscut / scris cu minuscule / fără valoare = refuz, nimic creat; {LINK_RASPUNS} în subiect = refuz;
//    deținător fără token / cu token expirat = fara_token în inventar și refuz la creare; token expirat ÎNTRE aprobare și trimitere: la rezervare mesajul
//    e anulat (token_expirat) fără rezervare, la autorizare apel_incepe = false + anulat, fără retrimitere; tokenul nu apare în jurnale / evenimente /
//    mesajele de eroare; RLS-ul tokenului și al mesajelor neschimbat; garda „doar TEST” (fn_red_mail_f2_poate) neatinsă.
// 2. L14: pe o bază FOLOSITĂ revenirea refuză (ISTORIC_NOU) și nu șterge nimic; pe o bază NEFOLOSITĂ: aplicare → revenire → reaplicare → revenire.
// 3. Refuzurile migrării și ale revenirii. 4. MUTANȚI (migrare + revenire): fiecare TREBUIE să pice.
// Ce NU probează PGlite (o singură conexiune): concurența reală (lock-urile sunt cele din 20261131h, neschimbate aici).
// Rulare (din rădăcina repo-ului; cere bash + python în PATH): npm install --no-save @electric-sql/pglite && node scripts/pglite/test_redari_mail_link_local.mjs
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { randomBytes, createHash, webcrypto } from 'node:crypto'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto })

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const { hashMesaj } = await import(pathToFileURL(join(ROOT, 'supabase/functions/_shared/redariMailF2.mjs')).href)
const TMP = mkdtempSync(join(tmpdir(), 'maillink_'))
const citeste = rel => readFileSync(join(ROOT, rel), 'utf8').replace(/\r/g, '')
const md5 = s => createHash('md5').update(s, 'utf8').digest('hex')
const NUME = '20261131i_redari_mail_link_personal', NUME_H = '20261131h_redari_mail_f2b_trimitere'
const F_MIG = `supabase/migrations/${NUME}.sql`, F_REV = `supabase/revenire/${NUME}_ROLLBACK.sql`, F_OB = `supabase/tests/${NUME}.l15.obiecte.tsv`
const SCHELET = citeste('supabase/tests/20261131i_redari_mail_link_schelet.sql')
const MIG = citeste(F_MIG), REV = citeste(F_REV), MIG_H = citeste(`supabase/migrations/${NUME_H}.sql`)
const CAZURI = JSON.parse(citeste('src/redari/__tests__/campuri_mail_cazuri.json'))
let OBIECTE = ''; try { OBIECTE = citeste(F_OB) } catch { /* se scrie cu --scrie-obiecte */ }
const gen = (...a) => execFileSync('bash', [join(ROOT, 'scripts/livrare_amprenta_gen.sh'), ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const SECRET = 'REDARI_GMAIL_TRIMITERE_REFRESH_TOKEN'

let esec = 0
const ok = (cond, msg) => { if (cond) console.log('  OK  ' + msg); else { esec++; console.log('  NU  ' + msg) } }

// ── funcțiile, EXACT ca în migrările lor ──
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
const M = n => citeste('supabase/migrations/' + n)
const M26 = M('20261126a_redari_teren.sql'), M27 = M('20261127a_redari_uat_setari.sql'), M30K = M('20261130k_redari_mail_f1_reguli.sql')
const M30M = M('20261130m_redari_autorizare_tgz.sql'), M31A = M('20261131a_redari_mail_f2_loturi.sql')
// [text, cap, amprenta așteptată (= constanta din 20261131i / revenire, când garda o verifică)]
const FUNCTII = [
  [M26, 'CREATE FUNCTION public.fn_red_nivel()'], [M26, 'CREATE FUNCTION public.fn_red_jurnal_imuabil()'],
  [M27, 'CREATE FUNCTION public.fn_red_versiune_creste()'], [M30M, 'CREATE FUNCTION public.fn_red_informare_publicata('],
  [M30K, 'CREATE FUNCTION public.fn_red_mail_setari_reguli()'], [M30K, 'CREATE FUNCTION public.fn_red_mail_oauth_state_reguli()'],
  [M30K, 'CREATE FUNCTION public.fn_red_mail_evenimente_reguli()'],
  [M31A, 'CREATE FUNCTION public.fn_red_mail_f2_canonic('], [M31A, 'CREATE FUNCTION public.fn_red_mail_f2_hash(', '7f3cad7c24c64e7f52b82378af4d4a27'],
  [M31A, 'CREATE FUNCTION public.fn_red_mail_f2_email(', '944b38951ee8fd7c63a955d410222d93'], [M31A, 'CREATE FUNCTION public.fn_red_mail_f2_text(', '72c8fdc01d8f1a4e379bedad1d0deded'],
  [M31A, 'CREATE FUNCTION public.fn_red_mail_f2_mesaj_hash(', 'b5bf8b67b6355276d2e722a59133652b'],
  [M31A, 'CREATE FUNCTION public.fn_red_mail_f2_lot_hash('],
  [M31A, 'CREATE FUNCTION public.fn_red_mail_f2_owner()', '220cfdf1f3e97fde8cd597a5b24537ed'],
  [M31A, 'CREATE FUNCTION public.fn_red_mail_f2_audit(', '22f7267f17b19a625fc849ae217fc160'],
  [M31A, 'CREATE FUNCTION public.fn_red_mail_f2_poate('], [M31A, 'CREATE FUNCTION public.fn_red_mail_f2_setari('],
  [M31A, 'CREATE FUNCTION public.fn_red_mail_f2_retentie_poate('], [M31A, 'CREATE FUNCTION public.fn_red_mail_f2_garda()'],
  [M31A, 'CREATE FUNCTION public.fn_red_mail_rezerva('], [M31A, 'CREATE FUNCTION public.fn_red_mail_apel_incepe('],
  [M31A, 'CREATE FUNCTION public.fn_red_mail_rezultat('],
  [M31A, 'CREATE FUNCTION public.fn_red_mail_lot_creeaza(', 'a43632708f4d31f44c50f614c0b5456c'],
  [M31A, 'CREATE FUNCTION public.fn_red_mail_destinatari(', '4db265cc817f34726d109a8727058f65'],
  [M31A, 'CREATE FUNCTION public.fn_red_mail_lot_aproba('],
]
console.log('0. funcțiile extrase din migrările lor (amprentele 20261131a = constantele din 20261131i / revenire)')
let SQL_FUNCTII = ''
for (const [text, cap, amp] of FUNCTII) {
  if (amp) { const m = md5(corp(text, cap)); ok(m === amp && MIG.includes(`'${amp}'`), `${cap.replace(/^CREATE FUNCTION /, '')}: ${m}`) }
  SQL_FUNCTII += functie(text, cap) + '\n'
}
const [SCH_A, SCH_B] = SCHELET.split('-- @@FUNCTII@@')
ok(SCH_B !== undefined, 'scheletul are marcajul funcțiilor')
// 31h: amprentele corpurilor pe care 31i le verifică în $pre$ și le repune revenirea
for (const [cap, amp] of [['CREATE OR REPLACE FUNCTION public.fn_red_mail_rezerva(', 'd779e03d0644e437db412b0c3721e6c0'], ['CREATE OR REPLACE FUNCTION public.fn_red_mail_apel_incepe(', '9e8dbac708ee9512cd402a960d1d446a'],
  ['CREATE OR REPLACE FUNCTION public.fn_red_mail_f2_poate(', '01d3390b765bedc9fd64801f113109c9'], ['CREATE FUNCTION public.fn_red_proiect_e_test(', 'b3a152708e032c698980981ab0eb3cf9']]) {
  const m = md5(corp(MIG_H, cap)); ok(m === amp && MIG.includes(`'${amp}'`), `20261131h ${cap.replace(/^CREATE (OR REPLACE )?FUNCTION /, '')}: ${m}`)
}
ok(md5(corp(REV, 'CREATE OR REPLACE FUNCTION public.fn_red_mail_lot_creeaza(')) === 'a43632708f4d31f44c50f614c0b5456c'
  && md5(corp(REV, 'CREATE OR REPLACE FUNCTION public.fn_red_mail_destinatari(')) === '4db265cc817f34726d109a8727058f65'
  && md5(corp(REV, 'CREATE OR REPLACE FUNCTION public.fn_red_mail_rezerva(')) === 'd779e03d0644e437db412b0c3721e6c0'
  && md5(corp(REV, 'CREATE OR REPLACE FUNCTION public.fn_red_mail_apel_incepe(')) === '9e8dbac708ee9512cd402a960d1d446a', 'revenirea repune corpurile EXACTE din 20261131a (lot_creeaza, destinatari) și 20261131h (rezerva, apel_incepe)')
const CAP_NOI = [['public.fn_red_link_raspuns(text)', 'CREATE FUNCTION public.fn_red_link_raspuns('],
  ['public.fn_red_mail_f2_token(uuid)', 'CREATE FUNCTION public.fn_red_mail_f2_token('],
  ['public.fn_red_mail_f2_campuri(uuid,uuid)', 'CREATE FUNCTION public.fn_red_mail_f2_campuri('],
  ['public.fn_red_mail_f2_completeaza(text,jsonb)', 'CREATE FUNCTION public.fn_red_mail_f2_completeaza('],
  ['public.fn_red_mail_destinatari(uuid,uuid,uuid)', 'CREATE OR REPLACE FUNCTION public.fn_red_mail_destinatari('],
  ['public.fn_red_mail_lot_creeaza(uuid,uuid,uuid,uuid[],text,text)', 'CREATE OR REPLACE FUNCTION public.fn_red_mail_lot_creeaza('],
  ['public.fn_red_mail_rezerva(uuid)', 'CREATE OR REPLACE FUNCTION public.fn_red_mail_rezerva('],
  ['public.fn_red_mail_apel_incepe(uuid,uuid)', 'CREATE OR REPLACE FUNCTION public.fn_red_mail_apel_incepe(']]
const blocNoi = t => t.slice(t.indexOf('-- >>> AMPRENTE-NOI 20261131i'), t.indexOf('-- <<< AMPRENTE-NOI 20261131i'))
for (const [sem, cap] of CAP_NOI) {
  const m = md5(corp(MIG, cap))
  ok(blocNoi(MIG).includes(`('${sem}', '${m}'`) && blocNoi(REV).includes(`('${sem}', '${m}'`), `amprenta nouă ${sem} = ${m} (migrare + revenire)`)
}
ok(!/AMPRENTA_[A-Z_]+/.test(blocNoi(MIG)) && !/AMPRENTA_[A-Z_]+/.test(blocNoi(REV)), 'fără marcaje AMPRENTA_* rămase')
const recalculeaza = t => {
  const a = t.indexOf('-- >>> AMPRENTE-NOI 20261131i'), b = t.indexOf('-- <<< AMPRENTE-NOI 20261131i')
  const bloc = CAP_NOI.reduce((x, [sem, cap]) => x.replace(new RegExp(`(\\('${sem.replace(/[().,\[\]]/g, '\\$&')}', ')[0-9a-f]{32}`), `$1${md5(corp(t, cap))}`), t.slice(a, b))
  return t.slice(0, a) + bloc + t.slice(b)
}
// paritate L19: forma „{NUME}” din SQL (regex-ul din migrare) = cea din JS, pe același tabel de cazuri (partea JS: src/redari/mailLinkPersonal.test.js)
const RX_SQL = /regexp_matches\(p_text,'([^']+)','g'\)/.exec(MIG)?.[1]
ok(RX_SQL === '[{]([^{}]{1,40})[}]', 'regex-ul câmpurilor din migrare: ' + RX_SQL)
const PREFIX_LINK = /'(https:\/\/redari\.gazpet\.ro\/redari\/raspuns\/)'\|\|p_token/.exec(MIG)?.[1]
ok(PREFIX_LINK === 'https://redari.gazpet.ro/redari/raspuns/', 'prefixul linkului din migrare: ' + PREFIX_LINK)

// ── 0b. validatorul REAL al runnerului ──
const validator = (fisier, ...opt) => {
  try { return { ok: true, out: execFileSync('bash', ['-c', 'exec python "$@"', '_', join(ROOT, 'scripts/livrare_validator.py'), fisier, 'reg_0123456789abcdef', ...opt], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() } }
  catch (e) { return { ok: false, out: String(e.stderr || e.message).trim() } }
}
const PLAFON_LIVRARE = Number(execFileSync('bash', ['-c', '. "$1"; printf %s "$AG_PLAFON_MS"', '_', join(ROOT, 'scripts/livrare_amprenta.sh')], { encoding: 'utf8' }))
const PLAFON_REVENIRE = 2000
const garda = (nume, plafon, final) => execFileSync('bash', ['-c', '. "$1"; lm_fin "$2" "$3" "$4" lock', '_', join(ROOT, 'scripts/livrare_mesaj.sh'), nume, String(plafon), final], { encoding: 'utf8' })
console.log('0b. validatorul runnerului')
{
  ok(PLAFON_LIVRARE === 5000, `AG_PLAFON_MS = ${PLAFON_LIVRARE}`)
  const vm = validator(join(ROOT, F_MIG), '--plafon-tranzactie-ms', String(PLAFON_LIVRARE)); ok(vm.ok && /^OK \d+ /.test(vm.out), 'migrarea trece validatorul cu 5000: ' + vm.out)
  const vm2 = validator(join(ROOT, F_MIG), '--plafon-tranzactie-ms', '2000'); ok(!vm2.ok && /PLAFON_DIFERIT/.test(vm2.out), 'migrarea cu runnerul la 2000 = refuz')
  const vr = validator(join(ROOT, F_REV), '--plafon-tranzactie-ms', String(PLAFON_REVENIRE)); ok(vr.ok && /^OK \d+ /.test(vr.out), 'revenirea trece validatorul cu 2000: ' + vr.out)
  const vr2 = validator(join(ROOT, F_REV), '--plafon-tranzactie-ms', String(PLAFON_LIVRARE)); ok(!vr2.ok && /PLAFON_DIFERIT/.test(vr2.out), 'revenirea cu runnerul la 5000 = refuz')
}

// ── conturile și datele (fictive) ──
const U = { OWNER: '00000000-0000-0000-0000-0000000000a1', ADMIN: '00000000-0000-0000-0000-0000000000a2', EDITOR: '00000000-0000-0000-0000-0000000000a3' }
const P = { TEST: '00000000-0000-0000-0000-00000000b001', REAL: '00000000-0000-0000-0000-00000000b002' }
const OB = { TEST: '00000000-0000-0000-0000-0000000f0001', REAL: '00000000-0000-0000-0000-0000000f0002' }
const UAT = { A: '00000000-0000-0000-0000-00000000c001', FARA: '00000000-0000-0000-0000-00000000c002', DIF: '00000000-0000-0000-0000-00000000c003', REAL: '00000000-0000-0000-0000-00000000c004' }
const PAR = { A1: '00000000-0000-0000-0000-00000000d001', A2: '00000000-0000-0000-0000-00000000d002', FARA: '00000000-0000-0000-0000-00000000d003', REAL: '00000000-0000-0000-0000-00000000d004' }
// deținătorii UAT-ului A: D1..D3 cu token valid, D4 fără token, D5 cu token expirat, D6 valid dar fără e-mail, D9 valid (lotul fără câmpuri); UAT fără sesiune: D7 valid; proiect real: D8 valid
const D = { D1: '00000000-0000-0000-0000-0000000e0001', D2: '00000000-0000-0000-0000-0000000e0002', D3: '00000000-0000-0000-0000-0000000e0003', D4: '00000000-0000-0000-0000-0000000e0004',
  D5: '00000000-0000-0000-0000-0000000e0005', D6: '00000000-0000-0000-0000-0000000e0006', D7: '00000000-0000-0000-0000-0000000e0007', D8: '00000000-0000-0000-0000-0000000e0008', D9: '00000000-0000-0000-0000-0000000e0009' }
const T = { D1: 'T1' + 'a'.repeat(41), D2: 'T2' + 'b'.repeat(41), D3: 'T3' + 'c'.repeat(41), D5: 'T5' + 'e'.repeat(41), D6: 'T6' + 'f'.repeat(41), D7: 'T7' + 'g'.repeat(41), D8: 'T8' + 'h'.repeat(41), D9: 'T9' + 'i'.repeat(41) }
const LINK = tok => PREFIX_LINK + tok
const TEL = '0244 000 000', COMUNA = 'Comuna Testeni'
const DATE = `
INSERT INTO public.profiles (id, name, is_owner) VALUES ('${U.OWNER}', 'OWNER', true), ('${U.ADMIN}', 'ADMIN REDARI', false), ('${U.EDITOR}', 'EDITOR', false);
INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES ('${U.ADMIN}', 'redari', 'admin'), ('${U.EDITOR}', 'redari', 'editor');
INSERT INTO storage.objects (id, bucket_id, name, metadata) VALUES ('${OB.TEST}', 'redari', 'TEST-MAIL/autorizare.pdf', '{"eTag": "\\"t1\\""}'), ('${OB.REAL}', 'redari', 'LOT1-REAL/autorizare.pdf', '{"eTag": "\\"r1\\""}');
INSERT INTO public.red_proiecte (id, cod, denumire, contact_telefon, autorizare_tgz_nr, autorizare_tgz_data, autorizare_tgz_fisier, autorizare_tgz_obiect, autorizare_tgz_etag) VALUES
  ('${P.TEST}', 'TEST-MAIL', 'Proiect de TEST', '${TEL}', '1', current_date, 'TEST-MAIL/autorizare.pdf', '${OB.TEST}', '"t1"'),
  ('${P.REAL}', 'LOT1-REAL', 'Proiect real (fictiv)', '${TEL}', '2', current_date, 'LOT1-REAL/autorizare.pdf', '${OB.REAL}', '"r1"');
INSERT INTO public.red_uat (id, proiect_id, nume, uat3, sesiune_zi1, sesiune_zi2, sesiune_zi3, program_zi1, program_zi2, program_zi3) VALUES
  ('${UAT.A}', '${P.TEST}', ' ${COMUNA} ', 'TST', DATE '2026-11-24', DATE '2026-11-25', NULL, ' 09:00–16:00 ', '09:00–16:00', NULL),
  ('${UAT.FARA}', '${P.TEST}', 'Fără sesiune', 'FRS', NULL, NULL, NULL, NULL, NULL, NULL),
  ('${UAT.DIF}', '${P.TEST}', 'Programe diferite', 'DIF', DATE '2026-12-01', DATE '2026-12-02', DATE '2026-12-03', '09:00–16:00', '09:00–14:00', '09:00–16:00'),
  ('${UAT.REAL}', '${P.REAL}', 'UAT real', 'RLA', DATE '2026-11-24', NULL, NULL, '09:00–16:00', NULL, NULL);
INSERT INTO public.red_parcele (id, proiect_id, uat_id, id_parcela) VALUES ('${PAR.A1}', '${P.TEST}', '${UAT.A}', 'T1-TST-0001'), ('${PAR.A2}', '${P.TEST}', '${UAT.A}', 'T1-TST-0002'),
  ('${PAR.FARA}', '${P.TEST}', '${UAT.FARA}', 'T1-FRS-0001'), ('${PAR.REAL}', '${P.REAL}', '${UAT.REAL}', 'T1-RLA-0001');
INSERT INTO public.red_detinatori (id, parcela_id, nume) VALUES ('${D.D1}', '${PAR.A1}', 'UNU FICTIV'), ('${D.D2}', '${PAR.A1}', 'DOI FICTIV'), ('${D.D3}', '${PAR.A2}', 'TREI FICTIV'),
  ('${D.D4}', '${PAR.A2}', 'PATRU FARA TOKEN'), ('${D.D5}', '${PAR.A2}', 'CINCI EXPIRAT'), ('${D.D6}', '${PAR.A2}', 'SASE FARA EMAIL'), ('${D.D7}', '${PAR.FARA}', 'SAPTE FARA SESIUNE'), ('${D.D8}', '${PAR.REAL}', 'OPT REAL'),
  ('${D.D9}', '${PAR.A2}', 'NOUA FICTIV');
INSERT INTO public.red_detinatori_contact (detinator_id, email) VALUES ('${D.D1}', 'Unu.Fictiv@gazpet.ro'), ('${D.D2}', 'doi.fictiv@gazpet.ro'), ('${D.D3}', 'trei.fictiv@gazpet.ro'),
  ('${D.D4}', 'patru.fictiv@gazpet.ro'), ('${D.D5}', 'cinci.fictiv@gazpet.ro'), ('${D.D6}', NULL), ('${D.D7}', 'sapte.fictiv@gazpet.ro'), ('${D.D8}', 'opt.fictiv@gazpet.ro'), ('${D.D9}', 'noua.fictiv@gazpet.ro');
INSERT INTO public.red_detinatori_token (detinator_id, token_raspuns, token_expira_la) VALUES ('${D.D1}', '${T.D1}', now() + interval '30 days'), ('${D.D2}', '${T.D2}', now() + interval '30 days'),
  ('${D.D3}', '${T.D3}', NULL), ('${D.D5}', '${T.D5}', now() - interval '1 day'), ('${D.D6}', '${T.D6}', now() + interval '30 days'), ('${D.D7}', '${T.D7}', NULL), ('${D.D8}', '${T.D8}', now() + interval '30 days'),
  ('${D.D9}', '${T.D9}', now() + interval '30 days');`
const TOKENI = Object.values(T)
async function bazaNoua({ cu31h = true } = {}) {
  const db = new PGlite()
  await db.exec(SCH_A); await db.exec(SQL_FUNCTII); await db.exec(SCH_B); await db.exec(DATE)
  if (cu31h) await caRunner(db, NUME_H, MIG_H)   // 20261131h aplicată ca migrare reală (gărzile ei trec pe schelet), fără manifest
  return db
}
async function caRunner(db, nume, text, { plafon = PLAFON_LIVRARE, marcajPlafon = true, marcaj = true, l15 = 'inainte', aprobat = '-', manifest = '-', final = 'COMMIT' } = {}) {
  const pre = plafon ? `SET transaction_timeout = ${plafon};` : 'SET transaction_timeout = 0;'
  const mp = marcajPlafon ? `SELECT set_config('gazpet.plafon_tranzactie', '${plafon}:' || txid_current(), true);` : ''
  const mk = marcaj ? `SELECT set_config('gazpet.livrare_migrare', '${nume}:' || txid_current(), true);` : ''
  const Tg = randomBytes(8).toString('hex')
  const ina = l15 === 'nimic' ? '' : gen('inainte', Tg, aprobat)
  const dupa = l15 === 'livrare' ? gen('dupa', Tg, aprobat, manifest) : ''
  const jurnal = []
  try {
    await db.exec(pre)
    await db.exec(`BEGIN ISOLATION LEVEL READ COMMITTED; ${mk} ${mp}`)
    await db.exec(ina + '\n' + text + '\n;\n' + dupa, { onNotice: n => jurnal.push(n.message) })
    await db.exec(final, { onNotice: n => jurnal.push(n.message) })
  } catch (e) { try { await db.exec('ROLLBACK') } catch { /* deja anulată */ } e.jurnal = jurnal; throw e } finally { await db.exec('SET transaction_timeout = 0;') }
  return jurnal
}
const aplicaMig = (db, text = MIG, o) => caRunner(db, NUME, text, o)
const revino = (db, text = REV, o) => caRunner(db, NUME + '_ROLLBACK', text, { l15: 'nimic', plafon: PLAFON_REVENIRE, ...o })
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
const lit = s => `'${String(s).replace(/'/g, "''")}'`
// toate mesajele de eroare primite în timpul verificărilor (tokenul nu trebuie să apară în niciunul)
let ERORI = []
async function ca(db, rol, uid, sql) {
  const claims = JSON.stringify(uid ? { sub: uid, role: rol } : { role: rol })
  await db.exec(`BEGIN; SET LOCAL ROLE ${rol}; SELECT set_config('request.jwt.claims', ${lit(claims)}, true);${uid ? ` SELECT set_config('request.jwt.claim.sub', '${uid}', true);` : ''}`)
  try { const r = await db.query(sql); await db.exec('COMMIT'); return { rows: r.rows } }
  catch (e) { await db.exec('ROLLBACK'); ERORI.push(e.message); return { code: e.code, message: e.message } }
}
const setari = async db => (await db.query(`SELECT trimitere_oprita, trimitere_conectata_la, versiune FROM public.red_mail_setari WHERE id = 1`)).rows[0]
const NOI = `('fn_red_link_raspuns', 'fn_red_mail_f2_token', 'fn_red_mail_f2_campuri', 'fn_red_mail_f2_completeaza')`
const NR_NOI = 4
const nrNoi = async db => (await db.query(`SELECT count(*)::int AS n FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ${NOI}`)).rows[0].n
const amprentaFn = async (db, nume) => (await db.query(`SELECT md5(replace(p.prosrc, chr(13), '')) AS m FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = $1`, [nume])).rows[0]?.m ?? null
const checkJurnal = async db => (await db.query(`SELECT pg_get_constraintdef(c.oid) AS d FROM pg_constraint c WHERE c.conrelid = 'public.red_mail_jurnal_f2'::regclass AND c.conname = 'red_mail_jurnal_f2_cod_check'`)).rows[0]?.d
const seteaza = (db, valoare, apelant, casuta) => ca(db, 'service_role', null, `SELECT public.fn_red_mail_secret_seteaza(${lit(SECRET)}, ${lit(valoare)}, ${lit(apelant)}::uuid, ${casuta == null ? 'NULL' : lit(casuta)}) AS r`)
const f2setari = (db, uid, oprit, extern, versiune) => ca(db, 'authenticated', uid, `SELECT public.fn_red_mail_f2_setari(${oprit}, ${extern}, ${versiune == null ? 'NULL' : versiune}) AS r`)
const porneste = async db => { await seteaza(db, 'rt-fictiv', U.OWNER, 'redari@gazpet.ro'); return f2setari(db, U.OWNER, false, false, (await setari(db)).versiune) }
const campuri = (db, uid, pr, uat) => ca(db, 'authenticated', uid, `SELECT public.fn_red_mail_f2_campuri('${pr}', '${uat}') AS r`)
const destinatari = (db, uid, pr, uat) => ca(db, 'authenticated', uid, `SELECT id, nume, email, motive FROM public.fn_red_mail_destinatari('${pr}', '${uat}', NULL)`)
const creeaza = (db, uid, op, pr, uat, dst, subiect, text) => ca(db, 'authenticated', uid, `SELECT public.fn_red_mail_lot_creeaza('${op}', '${pr}', '${uat}', ARRAY[${dst.map(x => `'${x}'`).join(',')}]::uuid[], ${lit(subiect)}, ${lit(text)}) AS r`)
const aproba = async (db, uid, lot) => { const l = (await db.query(`SELECT versiune, lot_sha256 FROM public.red_mail_loturi WHERE id = $1`, [lot])).rows[0]; return ca(db, 'authenticated', uid, `SELECT public.fn_red_mail_lot_aproba('${lot}', ${l.versiune}, '${l.lot_sha256}') AS r`) }
const rezerva = (db, uid, lot) => ca(db, 'authenticated', uid, `SELECT id, stare, lease_token, detinator_id FROM public.fn_red_mail_rezerva('${lot}')`)
const apelIncepe = (db, uid, mesaj, token) => ca(db, 'authenticated', uid, `SELECT public.fn_red_mail_apel_incepe('${mesaj}', '${token}') AS r`)
const rezultat = (db, uid, mesaj, token, stare, gm, th) => ca(db, 'authenticated', uid, `SELECT public.fn_red_mail_rezultat('${mesaj}', '${token}', ${lit(stare)}, ${gm == null ? 'NULL' : lit(gm)}, ${th == null ? 'NULL' : lit(th)}) AS r`)
const mesaje = async (db, lot) => (await db.query(`SELECT * FROM public.red_mail_mesaje WHERE lot_id = $1 ORDER BY detinator_id`, [lot])).rows
const poate = async (db, lot) => (await db.query(`SELECT public.fn_red_mail_f2_poate(l) AS r FROM public.red_mail_loturi l WHERE l.id = $1`, [lot])).rows[0].r
const expira = (db, det) => db.exec(`UPDATE public.red_detinatori_token SET token_expira_la = now() - interval '1 second' WHERE detinator_id = '${det}'`)
const nrLoturi = async db => (await db.query(`SELECT count(*)::int AS n FROM public.red_mail_loturi`)).rows[0].n
const LOT = { A: '00000000-0000-0000-0000-00000000aa01', B: '00000000-0000-0000-0000-00000000aa02', C: '00000000-0000-0000-0000-00000000aa03', R: '00000000-0000-0000-0000-00000000aa04' }
// un lot + un mesaj scrise direct (postgres), fără RPC — pentru cazurile în care singura urmă trebuie să fie eroare_cod
const SQL_LOT_DIRECT = `INSERT INTO public.red_mail_loturi (id, proiect_id, uat_id, cerere_sha256, stare, lot_sha256, creat_de) VALUES ('${LOT.B}', '${P.TEST}', '${UAT.A}', repeat('a', 64), 'ciorna', repeat('b', 64), '${U.OWNER}');
INSERT INTO public.red_mail_mesaje (id, lot_id, detinator_id, nr_document, catre, subiect_final, corp_text_final, message_id, mesaj_sha256) VALUES ('00000000-0000-0000-0000-0000000e0b01', '${LOT.B}', '${D.D1}', 'M-000901', 'unu.fictiv@gazpet.ro', 'Subiect fictiv', 'Text fictiv', '<00000000-0000-0000-0000-0000000e0b01@gazpet.ro>', repeat('1', 64));`
const TEXT = `Bună ziua,\n\nLucrările pe terenul dumneavoastră din {COMUNA} s-au încheiat. Vă invităm la Primăria {COMUNA}, în una dintre zilele {ZILE}, între orele {PROGRAM}.\nNe puteți spune dacă participați la telefon {TEL} sau prin formularul dumneavoastră de răspuns: {LINK_RASPUNS}\n\nCu stimă,\nGAZPET INSTAL S.R.L.`
const SUBIECT = 'Predarea terenului – {COMUNA}, {ZILE}'
const TEXT_ASTEPTAT = tok => `Bună ziua,\n\nLucrările pe terenul dumneavoastră din ${COMUNA} s-au încheiat. Vă invităm la Primăria ${COMUNA}, în una dintre zilele 24.11.2026 și 25.11.2026, între orele 09:00–16:00.\nNe puteți spune dacă participați la telefon ${TEL} sau prin formularul dumneavoastră de răspuns: ${LINK(tok)}\n\nCu stimă,\nGAZPET INSTAL S.R.L.`
const SUBIECT_ASTEPTAT = `Predarea terenului – ${COMUNA}, 24.11.2026 și 25.11.2026`

// ── VERIFICĂRILE după migrare; întoarce lista abaterilor ──
async function verifica(db) {
  const ab = []
  ERORI = []
  const asteptCod = (r, cod, ce, re) => { if (!r.code) ab.push(`${ce}: a trecut (aștepta ${cod})`); else if (r.code !== cod || (re && !re.test(r.message))) ab.push(`${ce}: ${r.code} ${r.message} (aștepta ${cod}${re ? ' ' + re : ''})`) }
  const asteptOk = (r, ce) => { if (r.code) { ab.push(`${ce}: ${r.code} ${r.message}`); return undefined } return r.rows[0] && 'r' in r.rows[0] ? r.rows[0].r : r.rows }
  // A. câmpurile lotului: owner; editor 42501; UAT al altui proiect = tinta_invalida; UAT fără sesiune = ZILE / PROGRAM null; programe diferite = PROGRAM null
  const a1 = asteptOk(await campuri(db, U.OWNER, P.TEST, UAT.A), 'A campuri owner')
  if (JSON.stringify(a1) !== JSON.stringify({ TEL, ZILE: '24.11.2026 și 25.11.2026', COMUNA, PROGRAM: '09:00–16:00' })) ab.push('A câmpurile UAT A: ' + JSON.stringify(a1))
  asteptCod(await campuri(db, U.EDITOR, P.TEST, UAT.A), '42501', 'A campuri editor')
  asteptCod(await campuri(db, U.ADMIN, P.TEST, UAT.A), '42501', 'A campuri admin Redări (ne-owner)')
  asteptCod(await campuri(db, U.OWNER, P.TEST, UAT.REAL), 'P0001', 'A campuri UAT al altui proiect', /tinta_invalida/)
  const a2 = asteptOk(await campuri(db, U.OWNER, P.TEST, UAT.FARA), 'A campuri UAT fără sesiune')
  if (JSON.stringify(a2) !== JSON.stringify({ TEL, ZILE: null, COMUNA: 'Fără sesiune', PROGRAM: null })) ab.push('A câmpurile UAT fără sesiune: ' + JSON.stringify(a2))
  const a3 = asteptOk(await campuri(db, U.OWNER, P.TEST, UAT.DIF), 'A campuri UAT cu programe diferite')
  if (JSON.stringify(a3) !== JSON.stringify({ TEL, ZILE: '01.12.2026, 02.12.2026 și 03.12.2026', COMUNA: 'Programe diferite', PROGRAM: null })) ab.push('A câmpurile UAT cu programe diferite: ' + JSON.stringify(a3))
  // paritate L19: regex-ul SQL pe tabelul de cazuri comun
  for (const c of CAZURI) {
    const r = (await db.query(`SELECT coalesce(array_agg(rm.m[1] ORDER BY rm.ord), ARRAY[]::text[]) AS a FROM regexp_matches($1, $2, 'g') WITH ORDINALITY AS rm(m, ord)`, [c.text, RX_SQL])).rows[0].a
    const unice = r.filter((v, i) => r.indexOf(v) === i)
    if (JSON.stringify(unice) !== JSON.stringify(c.campuri)) ab.push(`A paritate regex SQL „${c.text.slice(0, 30)}”: ${JSON.stringify(unice)} ≠ ${JSON.stringify(c.campuri)}`)
  }
  // D. inventarul: D4 (fără token) și D5 (expirat) = fara_token; D6 = fara_email (tokenul valid nu ajută); D1..D3 eligibili
  const inv = asteptOk(await destinatari(db, U.OWNER, P.TEST, UAT.A), 'D inventar') || []
  const motive = Object.fromEntries(inv.map(x => [x.id, x.motive]))
  if (JSON.stringify(motive[D.D1]) !== '[]' || JSON.stringify(motive[D.D2]) !== '[]' || JSON.stringify(motive[D.D3]) !== '[]') ab.push('D D1..D3 nu sunt eligibili: ' + JSON.stringify(motive))
  if (JSON.stringify(motive[D.D4]) !== '["fara_token"]' || JSON.stringify(motive[D.D5]) !== '["fara_token"]') ab.push('D D4 / D5 fără fara_token: ' + JSON.stringify([motive[D.D4], motive[D.D5]]))
  if (JSON.stringify(motive[D.D6]) !== '["fara_email"]') ab.push('D D6: ' + JSON.stringify(motive[D.D6]))
  if (inv.some(x => TOKENI.some(t => JSON.stringify(x).includes(t)))) ab.push('D inventarul expune tokenul')
  // C. refuzuri la creare (nimic creat): câmp necunoscut, câmp cu minuscule, câmp necompletabil (UAT fără sesiune), link în subiect, destinatar fără token / expirat
  const n0 = await nrLoturi(db)
  asteptCod(await creeaza(db, U.OWNER, LOT.C, P.TEST, UAT.A, [D.D1], 'S', 'text {LINK}'), '22023', 'C câmp necunoscut {LINK}', /camp_necunoscut: LINK/)
  asteptCod(await creeaza(db, U.OWNER, LOT.C, P.TEST, UAT.A, [D.D1], 'S', 'text {link_raspuns}'), '22023', 'C câmp cu minuscule', /camp_necunoscut/)
  asteptCod(await creeaza(db, U.OWNER, LOT.C, P.TEST, UAT.A, [D.D1], 'S', 'text { LINK_RASPUNS }'), '22023', 'C câmp cu spații', /camp_necunoscut/)
  asteptCod(await creeaza(db, U.OWNER, LOT.C, P.TEST, UAT.FARA, [D.D7], 'S', 'zilele {ZILE} {LINK_RASPUNS}'), '22023', 'C {ZILE} pe UAT fără sesiune', /camp_necompletabil: ZILE/)
  asteptCod(await creeaza(db, U.OWNER, LOT.C, P.TEST, UAT.A, [D.D1], 'S {LINK_RASPUNS}', 'text {LINK_RASPUNS}'), '22023', 'C {LINK_RASPUNS} în subiect', /camp_necunoscut: LINK_RASPUNS/)
  asteptCod(await creeaza(db, U.OWNER, LOT.C, P.TEST, UAT.A, [D.D1, D.D4], 'S', 'text {LINK_RASPUNS}'), 'P0001', 'C destinatar fără token', /destinatari_neeligibili/)
  asteptCod(await creeaza(db, U.OWNER, LOT.C, P.TEST, UAT.A, [D.D5], 'S', 'text {LINK_RASPUNS}'), 'P0001', 'C destinatar cu token expirat', /destinatari_neeligibili/)
  asteptCod(await creeaza(db, U.EDITOR, LOT.C, P.TEST, UAT.A, [D.D1], 'S', 'text {LINK_RASPUNS}'), '42501', 'C creare de editor')
  if (await nrLoturi(db) !== n0) ab.push('C un refuz a creat lotul')
  // un text fără niciun câmp rămâne permis (ca azi); un text fără {LINK_RASPUNS} e avertisment în ecran, nu refuz în bază
  const c1 = asteptOk(await creeaza(db, U.OWNER, LOT.C, P.TEST, UAT.A, [D.D9], 'Fără câmpuri', 'Text simplu.'), 'C lot fără câmpuri')
  if (c1 !== LOT.C) ab.push('C lotul fără câmpuri nu s-a creat: ' + c1)
  const mc = await mesaje(db, LOT.C)
  if (mc.length !== 1 || mc[0].corp_text_final !== 'Text simplu.' || mc[0].subiect_final !== 'Fără câmpuri') ab.push('C lotul fără câmpuri: ' + JSON.stringify(mc.map(m => m.corp_text_final)))
  // B. lotul cu 3 destinatari: fiecare mesaj cu linkul LUI, fără acolade, subiectul completat, hash-ul peste textul final (SQL = JS), lotul pe hash-urile mesajelor
  const b1 = asteptOk(await creeaza(db, U.OWNER, LOT.A, P.TEST, UAT.A, [D.D1, D.D2, D.D3], SUBIECT, TEXT), 'B creare lot cu 3 destinatari')
  if (b1 !== LOT.A) ab.push('B lotul nu s-a creat: ' + b1)
  const ms = await mesaje(db, LOT.A)
  if (ms.length !== 3) ab.push('B numărul mesajelor: ' + ms.length)
  for (const [det, tok, email] of [[D.D1, T.D1, 'unu.fictiv@gazpet.ro'], [D.D2, T.D2, 'doi.fictiv@gazpet.ro'], [D.D3, T.D3, 'trei.fictiv@gazpet.ro']]) {
    const m = ms.find(x => x.detinator_id === det)
    if (!m) { ab.push('B lipsește mesajul ' + det); continue }
    if (m.corp_text_final !== TEXT_ASTEPTAT(tok)) ab.push(`B corpul ${det} diferă: ${JSON.stringify(m.corp_text_final)}`)
    if (m.subiect_final !== SUBIECT_ASTEPTAT) ab.push(`B subiectul ${det}: ${m.subiect_final}`)
    if (m.catre !== email) ab.push(`B destinatarul ${det}: ${m.catre}`)
    if (/[{}]/.test(m.corp_text_final + m.subiect_final)) ab.push(`B acolade rămase în ${det}`)
    for (const alt of TOKENI) if (alt !== tok && m.corp_text_final.includes(alt)) ab.push(`B mesajul ${det} conține tokenul altcuiva`)
    const hSql = (await db.query(`SELECT public.fn_red_mail_f2_mesaj_hash(m) AS h FROM public.red_mail_mesaje m WHERE m.id = $1`, [m.id])).rows[0].h
    const hJs = await hashMesaj(m)
    if (m.mesaj_sha256 !== hSql || m.mesaj_sha256 !== hJs) ab.push(`B hash-ul ${det}: snapshot ${m.mesaj_sha256.slice(0, 8)} SQL ${hSql.slice(0, 8)} JS ${hJs.slice(0, 8)} (hash-ul trebuie să acopere textul final)`)
  }
  const lh = (await db.query(`SELECT l.lot_sha256 = public.fn_red_mail_f2_lot_hash(l.id) AS egal FROM public.red_mail_loturi l WHERE l.id = $1`, [LOT.A])).rows[0]?.egal
  if (lh !== true) ab.push('B lot_sha256 ≠ hash-ul mesajelor (sau lotul lipsește)')
  if (b1 !== LOT.A) return ab   // fără lot nu are rost restul
  const jc = (await db.query(`SELECT count(*)::int AS n FROM public.red_mail_jurnal_f2 WHERE lot_id = $1 AND cod = 'campuri'`, [LOT.A])).rows[0].n
  if (jc !== 1) ab.push('B jurnalul F2 fără „campuri”: ' + jc)
  // idempotența pe aceeași intenție (același hash al cererii) → același lot, fără dublare
  if (asteptOk(await creeaza(db, U.OWNER, LOT.A, P.TEST, UAT.A, [D.D1, D.D2, D.D3], SUBIECT, TEXT), 'B reluarea aceleiași intenții') !== LOT.A || (await mesaje(db, LOT.A)).length !== 3) ab.push('B reluarea a dublat')
  // G. RLS neschimbat: editorul nu vede mesajele (snapshotul cu link) și nici tokenul altfel decât azi (admin / editor pot, ca în 20261126a); anon nimic
  const g1 = await ca(db, 'authenticated', U.EDITOR, `SELECT count(*)::int AS r FROM public.red_mail_mesaje`)
  if (g1.code || g1.rows[0].r !== 0) ab.push('G editorul vede mesajele: ' + JSON.stringify(g1))
  const g2 = await ca(db, 'authenticated', U.OWNER, `SELECT count(*)::int AS r FROM public.red_mail_mesaje WHERE lot_id = '${LOT.A}'`)
  if (g2.code || g2.rows[0].r !== 3) ab.push('G owner-ul nu vede mesajele: ' + JSON.stringify(g2))
  const g3 = await ca(db, 'authenticated', U.EDITOR, `SELECT count(*)::int AS r FROM public.red_detinatori_token`)
  if (g3.code || g3.rows[0].r !== 8) ab.push('G editorul nu mai citește tokenul ca azi (politica veche): ' + JSON.stringify(g3))
  asteptCod(await ca(db, 'anon', null, `SELECT count(*) AS r FROM public.red_mail_mesaje`), '42501', 'G anon pe mesaje')
  asteptCod(await ca(db, 'anon', null, `SELECT public.fn_red_mail_f2_campuri('${P.TEST}', '${UAT.A}') AS r`), '42501', 'G anon pe campuri (fără EXECUTE)')
  asteptCod(await ca(db, 'authenticated', U.OWNER, `SELECT public.fn_red_mail_f2_token('${D.D1}') AS r`), '42501', 'G owner-ul nu poate chema direct fn_red_mail_f2_token (intern)')
  asteptCod(await ca(db, 'authenticated', U.OWNER, `SELECT public.fn_red_link_raspuns('x') AS r`), '42501', 'G owner-ul nu poate chema direct fn_red_link_raspuns (intern)')
  // H. garda „doar TEST” neatinsă: lotul proiectului real e refuzat de f2_poate după pornire; corpul f2_poate = 31h
  await porneste(db)
  const r1 = asteptOk(await creeaza(db, U.OWNER, LOT.R, P.REAL, UAT.REAL, [D.D8], 'S', 'x {LINK_RASPUNS}'), 'H lot pe proiect real (crearea e permisă, trimiterea nu)')
  if (r1 === LOT.R) { await aproba(db, U.OWNER, LOT.R); if (await poate(db, LOT.R) !== 'doar_proiecte_test') ab.push('H garda doar TEST: ' + await poate(db, LOT.R)) }
  if (await amprentaFn(db, 'fn_red_mail_f2_poate') !== '01d3390b765bedc9fd64801f113109c9') ab.push('H fn_red_mail_f2_poate schimbată')
  // E. trimiterea: aprobare; m1 rezervat → autorizat → trimis; tokenul lui D2 expiră după aprobare → la rezervare m2 e anulat (token_expirat), nimic rezervat;
  //    m3 rezervat, tokenul lui D3 expiră înaintea autorizării → apel_incepe = false, m3 anulat; nimic nu se retrimite
  if (asteptOk(await aproba(db, U.OWNER, LOT.A), 'E aprobarea lotului') !== true) ab.push('E aprobarea nu a întors true')
  if (await poate(db, LOT.A) !== null) ab.push('E lotul nu poate trimite: ' + await poate(db, LOT.A))
  // rezervarea ia mesajele în ordinea id-ului (uuid aleator): următorul se citește din bază, nu se presupune deținătorul
  const urmatorul = async () => (await db.query(`SELECT detinator_id FROM public.red_mail_mesaje WHERE lot_id = $1 AND stare = 'in_coada' ORDER BY id LIMIT 1`, [LOT.A])).rows[0]?.detinator_id
  const stari = async () => Object.fromEntries((await mesaje(db, LOT.A)).map(m => [m.detinator_id, [m.stare, m.eroare_cod]]))
  const d1 = await urmatorul()
  const e1 = asteptOk(await rezerva(db, U.OWNER, LOT.A), 'E rezerva m1')
  const m1 = e1 && e1[0]
  if (!m1 || m1.stare !== 'rezervat' || m1.detinator_id !== d1) ab.push('E prima rezervare: ' + JSON.stringify(e1))
  if (m1) {
    if (asteptOk(await apelIncepe(db, U.OWNER, m1.id, m1.lease_token), 'E apel_incepe m1') !== true) ab.push('E apel_incepe m1 nu a întors true')
    if (asteptOk(await rezultat(db, U.OWNER, m1.id, m1.lease_token, 'trimis', 'gm1', 'th1'), 'E rezultat m1') !== true) ab.push('E rezultatul m1 nu a întors true')
  }
  // tokenul următorului din coadă expiră DUPĂ aprobare: la rezervare mesajul lui e anulat (token_expirat), nimic rezervat, nimic trimis
  const d2 = await urmatorul()
  await expira(db, d2)
  await db.exec(`UPDATE public.red_mail_setari SET ultim_apel_la = now() - interval '3 seconds' WHERE id = 1`)
  const e2 = asteptOk(await rezerva(db, U.OWNER, LOT.A), 'E rezerva după expirarea tokenului următorului')
  if (!e2 || e2.length !== 0) ab.push('E rezervarea cu token expirat a rezervat totuși: ' + JSON.stringify(e2))
  let st = await stari()
  if (JSON.stringify(st[d2]) !== JSON.stringify(['anulat', 'token_expirat'])) ab.push('E m2 nu e anulat token_expirat: ' + JSON.stringify(st[d2]))
  if (JSON.stringify(st[d1]) !== JSON.stringify(['trimis', null])) ab.push('E m1: ' + JSON.stringify(st[d1]))
  // al treilea: rezervat, apoi tokenul expiră ÎNTRE rezervare și autorizare: apel_incepe = false, mesajul anulat, niciun apel
  const d3 = await urmatorul()
  const e3 = asteptOk(await rezerva(db, U.OWNER, LOT.A), 'E rezerva m3')
  const m3 = e3 && e3[0]
  if (!m3 || m3.detinator_id !== d3 || m3.stare !== 'rezervat' || [d1, d2].includes(d3)) ab.push('E a treia rezervare: ' + JSON.stringify(e3))
  if (m3) {
    await expira(db, d3)
    await db.exec(`UPDATE public.red_mail_setari SET ultim_apel_la = now() - interval '3 seconds' WHERE id = 1`)   // pauza de 2 s dintre apeluri, fără așteptare
    if (asteptOk(await apelIncepe(db, U.OWNER, m3.id, m3.lease_token), 'E apel_incepe m3 cu token expirat între rezervare și autorizare') !== false) ab.push('E apel_incepe m3 a autorizat apelul cu token expirat')
    st = await stari()
    if (JSON.stringify(st[d3]) !== JSON.stringify(['anulat', 'token_expirat'])) ab.push('E m3 nu e anulat token_expirat: ' + JSON.stringify(st[d3]))
  }
  const e4 = asteptOk(await rezerva(db, U.OWNER, LOT.A), 'E rezerva după anulări (coadă goală)')
  if (!e4 || e4.length !== 0) ab.push('E ceva s-a retrimis: ' + JSON.stringify(e4))
  st = await stari()
  if (JSON.stringify(st[d2]) !== JSON.stringify(['anulat', 'token_expirat']) || JSON.stringify(st[d3]) !== JSON.stringify(['anulat', 'token_expirat']) || JSON.stringify(st[d1]) !== JSON.stringify(['trimis', null])) ab.push('E anulările nu sunt definitive: ' + JSON.stringify(st))
  const ja = (await db.query(`SELECT count(*)::int AS n FROM public.red_mail_jurnal_f2 WHERE lot_id = $1 AND cod = 'anulat'`, [LOT.A])).rows[0].n
  if (ja !== 2) ab.push('E jurnalul F2 fără cele două anulări: ' + ja)
  // F. tokenul nu apare în jurnale / evenimente / erori (apare DOAR în snapshotul mesajului)
  const jurnale = (await db.query(`SELECT string_agg(j::text, ' ') AS t FROM public.red_mail_jurnal_f2 j`)).rows[0].t || ''
  const evenimente = (await db.query(`SELECT string_agg(e::text, ' ') AS t FROM public.red_mail_evenimente e`)).rows[0].t || ''
  const loturi = (await db.query(`SELECT string_agg(l::text, ' ') AS t FROM public.red_mail_loturi l`)).rows[0].t || ''
  for (const tok of TOKENI) {
    if (jurnale.includes(tok) || evenimente.includes(tok) || loturi.includes(tok)) ab.push('F tokenul apare în jurnal / evenimente / loturi')
    if (ERORI.some(e => e.includes(tok))) ab.push('F tokenul apare într-un mesaj de eroare')
  }
  if (!ERORI.length) ab.push('F verificarea erorilor n-a avut material')
  return ab
}

// ── manifestul L15: lista obiectelor (familie, etichetă, operație) = diferența generată de pașii runnerului ──
const listaObiecte = text => text.split('\n').filter(l => l && !l.startsWith('#')).map(l => l.split('\t').slice(0, 3).join('\t')).sort()
const faraPg18 = l => !/^constrangere\tconstrangere tabel [^\t]*_not_null\tcreat$/.test(l)

console.log('1. înainte de 20261131i (20261131h aplicată = starea de pe main): textul lotului rămâne cu {LINK_RASPUNS} literal, inventarul nu știe de token, funcțiile noi lipsesc')
{
  const db = await bazaNoua()
  ok(await nrNoi(db) === 0 && (await checkJurnal(db) || '').includes("'optout'::text])") && !(await checkJurnal(db) || '').includes('campuri'), 'înainte: fără funcțiile noi, CHECK-ul jurnalului = 31a')
  ok(await amprentaFn(db, 'fn_red_mail_lot_creeaza') === 'a43632708f4d31f44c50f614c0b5456c' && await amprentaFn(db, 'fn_red_mail_rezerva') === 'd779e03d0644e437db412b0c3721e6c0', 'înainte: lot_creeaza = 31a, rezerva = 31h')
  const inv = (await destinatari(db, U.OWNER, P.TEST, UAT.A)).rows || []
  ok(inv.length === 7 && inv.every(x => !x.motive.includes('fara_token')), 'înainte (dovada pe main, SQL): deținătorii fără token / cu token expirat sunt „eligibili” — gaura pe care o închide migrarea')
  const r = await creeaza(db, U.OWNER, LOT.A, P.TEST, UAT.A, [D.D1, D.D2, D.D4], SUBIECT, TEXT)
  const ms = await mesaje(db, LOT.A)
  ok(!r.code && ms.length === 3 && ms.every(m => m.corp_text_final.includes('{LINK_RASPUNS}') && m.corp_text_final.includes('{COMUNA}')) && ms.some(m => m.detinator_id === D.D4),
    'înainte (dovada pe main, SQL): lotul se creează cu acoladele literale în fiecare mesaj și cu deținătorul fără token — ce schimbă migrarea')
  const r2 = await creeaza(db, U.OWNER, LOT.B, P.TEST, UAT.A, [D.D3], 'S', 'text {LINK}')
  ok(!r2.code, 'înainte: câmpul necunoscut {LINK} trece netulburat (textul ar pleca cu acolade)')
  await db.close()
}

console.log('2. aplicarea ca la livrare (L15 v2: manifest generat, apoi livrarea aprobată) + verificările')
{
  const db = await bazaNoua()
  let jg = []
  try { jg = await aplicaMig(db, MIG, { l15: 'livrare', aprobat: '-', manifest: '-', final: 'ROLLBACK' }) } catch (e) { jg = e.jurnal || []; console.log('     ' + e.message) }
  const G = (jg.map(m => m.match(/^AMPRENTA_GLOBALA_CITITA inainte: ([0-9a-f]{32})/)).find(Boolean) || [])[1]
  const manifest = jg.filter(m => m.startsWith('L15_DIF ')).map(m => m.slice('L15_DIF '.length)).join('\n') + '\n'
  const gener = listaObiecte(manifest).filter(faraPg18), revizuit = listaObiecte(OBIECTE)
  if (process.argv.includes('--scrie-obiecte')) writeFileSync(join(ROOT, F_OB),
    `# ${NUME.slice(0, 9)}: obiectele din manifestul L15 v2 (familie TAB eticheta TAB operatie), fara amprente; PG17 (constrangerile NOT NULL ale PG18 scoase)\n` + gener.join('\n') + '\n')
  const lipsa = revizuit.filter(x => !gener.includes(x)), plus = gener.filter(x => !revizuit.includes(x))
  ok(G && gener.length >= 9 && !lipsa.length && !plus.length, `manifestul generat (${gener.length} obiecte) = lista revizuită; lipsă [${lipsa.join(' | ')}] în plus [${plus.join(' | ')}]`)
  ok(await nrNoi(db) === 0, 'generarea manifestului (ROLLBACK) nu a schimbat nimic')
  const fManifest = join(TMP, `${NUME}.l15.tsv`)
  writeFileSync(fManifest, manifest)
  const j = await aplicaMig(db, MIG, { l15: 'livrare', aprobat: G, manifest: fManifest, final: garda(NUME, PLAFON_LIVRARE, 'COMMIT') })
  ok(j.some(m => /^AMPRENTA_GLOBALA dupa: \d+ diferente = manifestul/.test(m)), 'livrarea aprobată: diferența = manifestul')
  ok(j.some(m => new RegExp(`^PLAFON_TIMP ${NUME}: garda trecuta la \\d+ ms de la BEGIN \\(plafon 5000 ms\\)`).test(m))
    && j.some(m => new RegExp(`^LOCK_TINUT ${NUME}: lock-urile puternice ale migrarii tinute \\d+ ms`).test(m))
    && j.some(m => /lock la \d+ ms de la BEGIN \(1 incercari, \d+ ms de la prima incercare\)/.test(m)), 'garda finală a runnerului: PLAFON_TIMP (5000) + LOCK_TINUT + lock-ul la prima încercare')
  const ab = await verifica(db)
  ab.forEach(a => console.log('     ' + a))
  ok(ab.length === 0, `verificările de comportament (${ab.length} abateri)`)
  const m = await eroare(aplicaMig(db))
  ok(/reaplicare/.test(m || ''), 'reaplicarea refuzată: ' + m)
  await db.close()
}

console.log('3. L14: bază FOLOSITĂ → revenirea refuză, nimic șters; bază NEFOLOSITĂ → aplicare → revenire → reaplicare → revenire')
{
  const db = await bazaNoua()
  await aplicaMig(db)
  await creeaza(db, U.OWNER, LOT.A, P.TEST, UAT.A, [D.D1], SUBIECT, TEXT)
  const n0 = (await db.query(`SELECT count(*)::int AS n FROM public.red_mail_jurnal_f2`)).rows[0].n
  const m = await eroare(revino(db))
  ok(m && /ISTORIC_NOU/.test(m), 'revenirea după un lot creat cu câmpuri: refuz ISTORIC_NOU: ' + (m || 'A TRECUT'))
  ok((await db.query(`SELECT count(*)::int AS n FROM public.red_mail_jurnal_f2`)).rows[0].n === n0 && await nrNoi(db) === NR_NOI && (await mesaje(db, LOT.A)).length === 1, 'nimic șters / schimbat de refuz')
  await db.close()
}
{
  const db = await bazaNoua()
  await aplicaMig(db)
  ok(await nrNoi(db) === NR_NOI && (await checkJurnal(db)).includes('campuri'), 'aplicarea pe bază nefolosită: funcțiile noi + CHECK-ul')
  let j = await revino(db)
  ok(j.some(x => /20261131i revenire: sfarsit la \d+ ms/.test(x)), 'revenirea pe baza nefolosită: trece')
  const fp = (await db.query(`SELECT p.proname, md5(replace(p.prosrc, chr(13), '')) AS m FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
    AND (p.proname IN ('fn_red_mail_lot_creeaza', 'fn_red_mail_destinatari', 'fn_red_mail_rezerva', 'fn_red_mail_apel_incepe') OR p.proname IN ${NOI}) ORDER BY 1`)).rows
  ok(fp.map(x => x.proname + ':' + x.m).join(' ') === 'fn_red_mail_apel_incepe:9e8dbac708ee9512cd402a960d1d446a fn_red_mail_destinatari:4db265cc817f34726d109a8727058f65 fn_red_mail_lot_creeaza:a43632708f4d31f44c50f614c0b5456c fn_red_mail_rezerva:d779e03d0644e437db412b0c3721e6c0',
    'revenirea: corpurile 31a / 31h repuse, funcțiile noi scoase: ' + JSON.stringify(fp))
  ok(!(await checkJurnal(db)).includes('campuri'), 'revenirea: CHECK-ul jurnalului = 31a')
  const r = await creeaza(db, U.OWNER, LOT.B, P.TEST, UAT.A, [D.D4], 'S', 'x {LINK_RASPUNS}')
  ok(!r.code && (await mesaje(db, LOT.B))[0]?.corp_text_final === 'x {LINK_RASPUNS}', 'revenirea: regula veche înapoi (acolade literale, fără token acceptat)')
  await aplicaMig(db)   // lotul B (creat cu regula veche, fără urmă `campuri`) nu e istoric al migrării
  ok(await nrNoi(db) === NR_NOI, 'reaplicarea după revenire: trece')
  j = await revino(db)
  ok(j.some(x => /20261131i revenire: sfarsit/.test(x)) && await nrNoi(db) === 0, 'a doua revenire (tot nefolosită): trece')
  await aplicaMig(db)
  const c = await creeaza(db, U.OWNER, LOT.C, P.TEST, UAT.A, [D.D1], SUBIECT, TEXT)
  ok(!c.code && (await mesaje(db, LOT.C))[0]?.corp_text_final === TEXT_ASTEPTAT(T.D1), 'după reaplicare: completarea merge')
  const m = await eroare(revino(db))
  ok(m && /ISTORIC_NOU/.test(m), 'după folosire: revenirea refuză ISTORIC_NOU')
  await db.close()
}

console.log('4. refuzurile migrării (nimic schimbat)')
for (const [nume, fn, re] of [
  ['fără marcajul runnerului', db => aplicaMig(db, MIG, { marcaj: false }), /garda start invalida/],
  ['fără plafon', db => aplicaMig(db, MIG, { plafon: 0, marcajPlafon: false }), /PLAFON_TRANZACTIE lipsa/],
  ['plafonul vechi (2000) pus de runner', db => aplicaMig(db, MIG, { plafon: 2000 }), /PLAFON_TRANZACTIE lipsa: 2000\/session/],
  ['fără amprenta globală L15 v2 (pasul „înainte” lipsă)', db => aplicaMig(db, MIG, { l15: 'nimic' }), /AMPRENTA_GLOBALA_LIPSA/],
  ['20261131h neaplicată (rezerva = 31a)', async () => { const db2 = await bazaNoua({ cu31h: false }); try { return await aplicaMig(db2) } finally { await db2.close() } }, /functiile F2 nu sunt cele din 20261131a \/ 20261131h: .*fn_red_mail_rezerva/],
  ['CHECK-ul jurnalului diferit', async db => { await db.exec(`ALTER TABLE public.red_mail_jurnal_f2 DROP CONSTRAINT red_mail_jurnal_f2_cod_check; ALTER TABLE public.red_mail_jurnal_f2 ADD CONSTRAINT red_mail_jurnal_f2_cod_check CHECK (cod IN ('creat'))`); return aplicaMig(db) }, /red_mail_jurnal_f2_cod_check nu e cel din 20261131a/],
  ['fn_red_mail_lot_creeaza schimbată înainte', async db => {
    await db.exec(`CREATE OR REPLACE FUNCTION public.fn_red_mail_lot_creeaza(p_operatie uuid,p_proiect uuid,p_uat uuid,p_destinatari uuid[],p_subiect text,p_text text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $f$ BEGIN RETURN p_operatie; END $f$;`)
    return aplicaMig(db)
  }, /functiile F2 nu sunt cele din 20261131a \/ 20261131h: public\.fn_red_mail_lot_creeaza/],
  ['fn_red_mail_f2_poate schimbată înainte (gărzile 31h)', async db => { await db.exec(`CREATE OR REPLACE FUNCTION public.fn_red_mail_f2_poate(l public.red_mail_loturi) RETURNS text LANGUAGE plpgsql STABLE SET search_path=public,pg_temp AS $f$ BEGIN RETURN NULL; END $f$;`); return aplicaMig(db) }, /nu sunt cele din 20261131a \/ 20261131h: public\.fn_red_mail_f2_poate/],
  ['politica tokenului lipsă (RLS-ul 20261126a schimbat)', async db => { await db.exec(`DROP POLICY red_token_sel ON public.red_detinatori_token`); return aplicaMig(db) }, /red_detinatori_token \/ red_mail_mesaje nu au RLS-ul/],
  ['jurnalul F2 fără triggerul append-only', async db => { await db.exec(`ALTER TABLE public.red_mail_jurnal_f2 DISABLE TRIGGER trg_red_mail_f2_jurnal_imuabil`); return aplicaMig(db) }, /triggerele 20261130k \/ 20261131a/],
  ['istoric deja existent (mesaj token_expirat)', async db => {
    await db.exec(SQL_LOT_DIRECT); await db.exec(`UPDATE public.red_mail_mesaje SET stare = 'anulat', eroare_cod = 'token_expirat' WHERE lot_id = '${LOT.B}'`); return aplicaMig(db)
  }, /exista deja istoric al campurilor/],
  ['o funcție nouă deja prezentă', async db => { await db.exec(`CREATE FUNCTION public.fn_red_link_raspuns(p_token text) RETURNS text LANGUAGE sql IMMUTABLE AS $f$ SELECT p_token $f$`); return aplicaMig(db) }, /obiectele exista deja/],
  ['lock-ul obținut după termen, fără coliziune', db => aplicaMig(db, aplica(MIG, [['      LOCK TABLE public.red_mail_jurnal_f2 IN ACCESS EXCLUSIVE MODE NOWAIT;\n      EXIT;\n',
    '      LOCK TABLE public.red_mail_jurnal_f2 IN ACCESS EXCLUSIVE MODE NOWAIT;\n      PERFORM pg_sleep(1.05);\n      EXIT;\n']])), /BUGET_LOCK: lock-ul obtinut abia la \d+ ms de la prima incercare \(1 incercari/],
  ['ocupat permanent (coliziune la fiecare încercare)', db => aplicaMig(db, aplica(MIG, [['      LOCK TABLE public.red_mail_jurnal_f2 IN ACCESS EXCLUSIVE MODE NOWAIT;\n      EXIT;\n',
    "      RAISE EXCEPTION 'coliziune simulata' USING ERRCODE = '55P03';\n      EXIT;\n"]])), /BUGET_LOCK: \d+ incercari, \d+ ms de la prima incercare/],
]) {
  const db = await bazaNoua()
  const m = await eroare(fn(db))
  // nimic din ce ar fi făcut migrarea (cazurile pregătesc singure alte stări: lot_creeaza schimbată, fn_red_link_raspuns străină)
  const neschimbat = (await db.query(`SELECT count(*)::int AS n FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ('fn_red_mail_f2_token', 'fn_red_mail_f2_campuri', 'fn_red_mail_f2_completeaza')`)).rows[0].n === 0
    && await amprentaFn(db, 'fn_red_mail_apel_incepe') === '9e8dbac708ee9512cd402a960d1d446a' && !((await checkJurnal(db)) || '').includes('campuri')
  ok(m && re.test(m) && neschimbat, `${nume}: ${m ? m.slice(0, 150) : 'A TRECUT'}${neschimbat ? '' : ' (STAREA S-A SCHIMBAT)'}`)
  await db.close()
}

console.log('5. refuzurile revenirii')
for (const [nume, pregatire, o, re] of [
  ['migrarea neaplicată', async () => {}, {}, /starea nu e cea din 20261131i \(pasul 1, functii/],
  ['fără plafon', async db => aplicaMig(db), { plafon: 0, marcajPlafon: false }, /PLAFON_TRANZACTIE lipsa/],
  ['cu plafonul livrării (5000)', async db => aplicaMig(db), { plafon: 5000 }, /PLAFON_TRANZACTIE lipsa: 5000\/session/],
  ['câmpurile acordate și lui anon', async db => { await aplicaMig(db); await db.exec(`GRANT EXECUTE ON FUNCTION public.fn_red_mail_f2_campuri(uuid,uuid) TO anon`) }, {}, /starea nu e cea din 20261131i \(pasul 1, functii: drepturi/],
  ['fn_red_mail_lot_creeaza schimbată după aplicare', async db => { await aplicaMig(db); await db.exec(`CREATE OR REPLACE FUNCTION public.fn_red_mail_lot_creeaza(p_operatie uuid,p_proiect uuid,p_uat uuid,p_destinatari uuid[],p_subiect text,p_text text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $f$ BEGIN RETURN p_operatie; END $f$;`) }, {}, /starea nu e cea din 20261131i \(pasul 1, functii: public\.fn_red_mail_lot_creeaza/],
  ['CHECK-ul jurnalului schimbat după aplicare', async db => { await aplicaMig(db); await db.exec(`ALTER TABLE public.red_mail_jurnal_f2 DROP CONSTRAINT red_mail_jurnal_f2_cod_check`) }, {}, /CHECK jurnal/],
  ['istoric: lot creat cu câmpuri', async db => { await aplicaMig(db); await creeaza(db, U.OWNER, LOT.A, P.TEST, UAT.A, [D.D1], 'S', 'x {LINK_RASPUNS}') }, {}, /ISTORIC_NOU/],
  ['istoric: un rând `campuri` în jurnal', async db => { await aplicaMig(db); await db.exec(`INSERT INTO public.red_mail_jurnal_f2 (cod) VALUES ('campuri')`) }, {}, /ISTORIC_NOU/],
  // mesajul scris direct (postgres), fără RPC: singura urmă e eroare_cod = token_expirat (fără rând `campuri`)
  ['istoric: un mesaj token_expirat', async db => { await aplicaMig(db); await db.exec(SQL_LOT_DIRECT); await db.exec(`UPDATE public.red_mail_mesaje SET stare = 'anulat', eroare_cod = 'token_expirat' WHERE lot_id = '${LOT.B}'`) }, {}, /ISTORIC_NOU/],
]) {
  const db = await bazaNoua()
  await pregatire(db)
  const inainte = await nrNoi(db)
  const m = await eroare(revino(db, REV, o))
  ok(m && re.test(m) && await nrNoi(db) === inainte, `${nume}: ${m ? m.slice(0, 150) : 'A TRECUT'}`)
  await db.close()
}

console.log('6. MUTANȚI pe migrare (fiecare TREBUIE să pice: la aplicare, la postcondiții sau la verificări)')
const MUTANTI = [
  ['același link pentru toți (al primului destinatar)', [["campuri||jsonb_build_object('LINK_RASPUNS',public.fn_red_link_raspuns(tok))", "campuri||jsonb_build_object('LINK_RASPUNS',public.fn_red_link_raspuns(public.fn_red_mail_f2_token(p_destinatari[1])))"]]],
  ['subiectul necompletat', [['  msg.subiect_final:=subiect; msg.corp_text_final', '  msg.subiect_final:=public.fn_red_mail_f2_text(p_subiect); msg.corp_text_final']]],
  ['câmpul necunoscut acceptat (ramura scoasă)', [["  IF NOT (p_campuri ? nume) THEN RAISE EXCEPTION 'camp_necunoscut: %',nume USING ERRCODE='22023'; END IF;\n", '']]],
  // ambele regex-uri (bucla și verificarea finală „nimic cu acolade”): cu una singură schimbată, a doua prinde oricum (apărare în adâncime, mutant echivalent)
  ['forma câmpului doar cu majuscule (minusculele trec netulburate)', [["regexp_matches(p_text,'[{]([^{}]{1,40})[}]','g')", "regexp_matches(p_text,'[{]([A-Z_]{1,40})[}]','g')"],
    [" IF rez ~ '[{][^{}]{1,40}[}]' THEN RAISE EXCEPTION 'camp_necunoscut' USING ERRCODE='22023'; END IF;", " IF rez ~ '[{][A-Z_]{1,40}[}]' THEN RAISE EXCEPTION 'camp_necunoscut' USING ERRCODE='22023'; END IF;"]]],
  ['câmpul fără valoare completat cu gol', [["  IF v IS NULL OR btrim(v)='' THEN RAISE EXCEPTION 'camp_necompletabil: %',nume USING ERRCODE='22023'; END IF;\n", "  v:=coalesce(v,'');\n"]]],
  ['inventarul fără fara_token', [[",\n -- 20261131i: fără link personal valid (token lipsă / expirat) = exclus din lot\n CASE WHEN public.fn_red_mail_f2_token(d.id) IS NULL THEN 'fara_token' END\n", '\n']]],
  ['crearea fără refuzul destinatarilor fără token (ambele verificări)', [[" IF EXISTS(SELECT 1 FROM unnest(p_destinatari) x WHERE public.fn_red_mail_f2_token(x) IS NULL) THEN RAISE EXCEPTION 'destinatari_neeligibili'; END IF;\n", ''],
    ["  IF tok IS NULL OR public.fn_red_link_raspuns(tok) IS NULL THEN RAISE EXCEPTION 'destinatari_neeligibili'; END IF;\n", "  tok:=coalesce(tok,repeat('z',43));\n"]]],
  ['tokenul valid fără expirare', [['AND (t.token_expira_la IS NULL OR now()<=t.token_expira_la)\n', '\n']]],
  ['rezervarea fără oprirea la token expirat', [[" IF public.fn_red_mail_f2_token(m.detinator_id) IS NULL THEN UPDATE public.red_mail_mesaje SET stare='anulat',eroare_cod='token_expirat' WHERE id=m.id; PERFORM public.fn_red_mail_f2_audit(l.id,m.id,'anulat'); RETURN; END IF;\n", '']]],
  ['autorizarea apelului fără oprirea la token expirat', [[" IF public.fn_red_mail_f2_token(m.detinator_id) IS NULL THEN UPDATE public.red_mail_mesaje SET stare='anulat',eroare_cod='token_expirat' WHERE id=m.id; PERFORM public.fn_red_mail_f2_audit(l.id,m.id,'anulat'); RETURN false; END IF;\n", '']]],
  ['programul luat din prima zi chiar dacă zilele diferă', [["  v_program:=CASE WHEN programe[1]<>'' AND (SELECT count(DISTINCT x) FROM unnest(programe) x)=1 THEN programe[1] END;", "  v_program:=nullif(programe[1],'');"]]],
  ['câmpurile acordate și lui anon', [['GRANT EXECUTE ON FUNCTION public.fn_red_mail_f2_campuri(uuid,uuid) TO authenticated;', 'GRANT EXECUTE ON FUNCTION public.fn_red_mail_f2_campuri(uuid,uuid) TO authenticated, anon;']]],
  ['fn_red_mail_f2_campuri fără poarta owner', [[" PERFORM public.fn_red_mail_f2_owner();\n IF p_proiect IS NULL OR p_uat IS NULL THEN RAISE EXCEPTION 'cerere_invalida' USING ERRCODE='22023'; END IF;\n SELECT * INTO u", " IF p_proiect IS NULL OR p_uat IS NULL THEN RAISE EXCEPTION 'cerere_invalida' USING ERRCODE='22023'; END IF;\n SELECT * INTO u"]]],
  ['CHECK-ul jurnalului fără `campuri`', [["'lot_sters_final','setari','optout','campuri'));", "'lot_sters_final','setari','optout'));"]]],
  ['linkul pe alt domeniu', [["'https://redari.gazpet.ro/redari/raspuns/'||p_token", "'https://pontaj-pro-sooty.vercel.app/redari/raspuns/'||p_token"]]],
  ['jurnalul `campuri` nescris (urma L14 lipsă)', [[" PERFORM public.fn_red_mail_f2_audit(p_operatie,NULL,'creat'); PERFORM public.fn_red_mail_f2_audit(p_operatie,NULL,'campuri'); RETURN p_operatie;", " PERFORM public.fn_red_mail_f2_audit(p_operatie,NULL,'creat'); RETURN p_operatie;"]]],
]
for (const [nume, lista] of MUTANTI) {
  const db = await bazaNoua()
  let t
  try { t = recalculeaza(aplica(MIG, lista)) } catch (e) { ok(false, `${nume}: mutantul nu se aplică (${e.message})`); await db.close(); continue }
  const m = await eroare(aplicaMig(db, t))
  let prins = !!m, cum = m ? 'la aplicare: ' + m.slice(0, 110) : ''
  if (!m) { const ab = await verifica(db); prins = ab.length > 0; cum = `${ab.length} abateri (${(ab[0] || '').slice(0, 130)})` }
  ok(prins, `MUTANT ${nume} — prins ${cum}`)
  await db.close()
}

console.log('6b. MUTANȚI pe revenire (fiecare TREBUIE să pice: revenirea mutantă trece unde cea reală refuză)')
for (const [nume, lista, pregatire] of [
  ['revenirea fără refuzul L14 la istoric nou', [["      RAISE EXCEPTION '20261131i revenire: ISTORIC_NOU", "      RAISE NOTICE '20261131i revenire: ISTORIC_NOU"]],
    async db => { await creeaza(db, U.OWNER, LOT.A, P.TEST, UAT.A, [D.D1], 'S', 'x {LINK_RASPUNS}') }],
  ['revenirea fără verificarea CHECK-ului', [["      RAISE EXCEPTION '20261131i revenire: starea nu e cea din 20261131i (pasul %, CHECK jurnal: %)', v_pas, coalesce(v_def, 'lipsa');", '      NULL;']],
    async db => { await db.exec(`ALTER TABLE public.red_mail_jurnal_f2 DROP CONSTRAINT red_mail_jurnal_f2_cod_check; ALTER TABLE public.red_mail_jurnal_f2 ADD CONSTRAINT red_mail_jurnal_f2_cod_check CHECK (cod IN ('creat','aprobat','rezervat','apel_inceput','trimis','esuat_sigur','necunoscut','esuat_confirmat','anulat','lot_integritate','lot_incheiat','golit','lot_sters_final','setari','optout','campuri','altceva'))`) }],
  ['revenirea fără verificarea funcțiilor', [["      RAISE EXCEPTION '20261131i revenire: starea nu e cea din 20261131i (pasul %, functii: %)', v_pas, coalesce(v_rau, 'drepturi / variante');", '      NULL;']],
    async db => { await db.exec(`GRANT EXECUTE ON FUNCTION public.fn_red_mail_f2_campuri(uuid,uuid) TO anon`) }],
]) {
  const db = await bazaNoua()
  await aplicaMig(db)
  await pregatire(db)
  const real = await eroare(revino(db))
  let t
  try { t = aplica(REV, lista) } catch (e) { ok(false, `${nume}: mutantul nu se aplică (${e.message})`); await db.close(); continue }
  const mutant = await eroare(revino(db, t))
  ok(real !== null && mutant !== real, `MUTANT ${nume} — real: ${real ? real.slice(0, 70) : 'A TRECUT'} | mutant: ${mutant ? mutant.slice(0, 70) : 'A TRECUT'}`)
  await db.close()
}

console.log(esec ? `\nESEC: ${esec} verificări au picat` : '\nPASS: toate verificările au trecut')
process.exit(esec ? 1 : 0)
