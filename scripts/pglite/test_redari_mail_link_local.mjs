// Proba LOCALĂ a migrării 20261131i (Redări e-mail: linkul PERSONAL de răspuns și câmpurile sesiunii completate PE FIECARE MESAJ, în snapshot) pe PGlite
// (Postgres în WASM, în memorie) — NU atinge nicio bază reală.
// Baza: schema falsă supabase/tests/20261131i_redari_mail_link_schelet.sql + funcțiile extrase EXACT din migrările lor (26a, 27a, 30k, 30m, 31a — inclusiv
//   fn_red_mail_lot_creeaza / destinatari / lot_aproba / rezerva / apel_incepe / rezultat / f2_garda); apoi 20261131h APLICATĂ ca migrare reală (ca runnerul);
//   amprentele verificate de gărzile 31i = constantele din 31i (pasul 0).
// Aplicarea 31i: ca runnerul — marcaj + plafon 5000 (AG_PLAFON_MS) + PAȘII L15 v2 GENERAȚI de scripts/livrare_amprenta_gen.sh: generarea manifestului
//   (ROLLBACK), apoi livrarea cu GLOBAL-ul citit + manifestul generat (diferența = exact manifestul) și garda finală REALĂ a runnerului (lm_fin) + COMMIT.
//   Lista obiectelor = supabase/tests/20261131i_redari_mail_link_personal.l15.obiecte.tsv (--scrie-obiecte o rescrie).
// 1. Comportamentul (valorile așteptate scrise de mână, L25), ca rolul real al fiecărei căi (owner / editor cu JWT, service_role, postgres):
//    câmpurile lotului (RPC, paritate cu convocatorul pe tabelul comun src/redari/__tests__/campuri_lot_cazuri.json), crearea unui lot cu 4 destinatari —
//    fiecare mesaj cu linkul LUI, fără acolade, hash-ul peste textul final (paritate cu hashMesaj din JS), subiectul completat; câmp necunoscut / scris cu
//    minuscule / fără valoare = refuz, nimic creat; {LINK_RASPUNS} în subiect = refuz; (r2) orice acoladă rămasă (nume de 41+ caractere, „{}”, acoladă
//    neînchisă) = refuz; (r2) un link personal LITERAL în text sau subiect (pe orice origine) sau un token copiat fără adresă = refuz link_literal, nimic
//    creat; deținător fără token / cu token expirat = fara_token în inventar și refuz la creare; token expirat ÎNTRE aprobare și trimitere: la rezervare
//    mesajul e anulat (token_expirat) și rezervarea TRECE la următorul valid (r2; la fel după opt-out), la autorizare apel_incepe = false + anulat, fără
//    retrimitere; tokenul nu apare în jurnale / evenimente / mesajele de eroare; RLS-ul tokenului și al mesajelor neschimbat; garda „doar TEST” neatinsă.
// 1b. (r2) HANDLERUL REAL al funcției edge (redariMailF2Handler.mjs) peste RPC-urile din PGlite, cu transportul Gmail fals: ordinea „expirat, valid, valid”
//    → într-o singură apăsare primul e anulat și ceilalți doi trimiși; ordinea „opt-out, expirat, valid” → cei doi anulați, al treilea trimis.
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
const { hashMesaj, linkStrain } = await import(pathToFileURL(join(ROOT, 'supabase/functions/_shared/redariMailF2.mjs')).href)
const { raspundeTrimitere } = await import(pathToFileURL(join(ROOT, 'supabase/functions/_shared/redariMailF2Handler.mjs')).href)
const { creeazaGmailHttp, GAZDA_OAUTH, GAZDA_GMAIL } = await import(pathToFileURL(join(ROOT, 'supabase/functions/_shared/gmailHttp.mjs')).href)
const TMP = mkdtempSync(join(tmpdir(), 'maillink_'))
const citeste = rel => readFileSync(join(ROOT, rel), 'utf8').replace(/\r/g, '')
const lit = s => `'${String(s).replace(/'/g, "''")}'`
const md5 = s => createHash('md5').update(s, 'utf8').digest('hex')
const NUME = '20261131i_redari_mail_link_personal', NUME_H = '20261131h_redari_mail_f2b_trimitere'
const F_MIG = `supabase/migrations/${NUME}.sql`, F_REV = `supabase/revenire/${NUME}_ROLLBACK.sql`, F_OB = `supabase/tests/${NUME}.l15.obiecte.tsv`
const SCHELET = citeste('supabase/tests/20261131i_redari_mail_link_schelet.sql')
const MIG = citeste(F_MIG), REV = citeste(F_REV), MIG_H = citeste(`supabase/migrations/${NUME_H}.sql`)
const CAZURI = JSON.parse(citeste('src/redari/__tests__/campuri_mail_cazuri.json'))
const CAZURI_LOT = JSON.parse(citeste('src/redari/__tests__/campuri_lot_cazuri.json'))   // UAT-urile fixture-ului + valorile așteptate (aceleași ca în testul JS al convocatorului)
// r3: linkul străin pe forma de căutare — tabelul comun cu testul JS (src/redari/mailLinkStrain.test.js), aceleași tokenuri fictive ca fixture-ul de mai jos
const LS = JSON.parse(citeste('src/redari/__tests__/link_strain_cazuri.json'))
const LSC = id => { const c = LS.cazuri.find(x => x.id === id); if (!c) throw new Error('lipsește cazul ' + id); return c }
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
  ['public.fn_red_mail_f2_link_forma(text)', 'CREATE FUNCTION public.fn_red_mail_f2_link_forma('],
  ['public.fn_red_mail_f2_link_strain(text,text)', 'CREATE FUNCTION public.fn_red_mail_f2_link_strain('],
  ['public.fn_red_mail_destinatari(uuid,uuid,uuid)', 'CREATE OR REPLACE FUNCTION public.fn_red_mail_destinatari('],
  ['public.fn_red_mail_lot_creeaza(uuid,uuid,uuid,uuid[],text,text)', 'CREATE OR REPLACE FUNCTION public.fn_red_mail_lot_creeaza('],
  ['public.fn_red_mail_rezerva(uuid)', 'CREATE OR REPLACE FUNCTION public.fn_red_mail_rezerva('],
  ['public.fn_red_mail_apel_incepe(uuid,uuid)', 'CREATE OR REPLACE FUNCTION public.fn_red_mail_apel_incepe(']]
const blocNoi = t => t.slice(t.indexOf('-- >>> AMPRENTE-NOI 20261131i'), t.indexOf('-- <<< AMPRENTE-NOI 20261131i'))
for (const [sem, cap] of CAP_NOI) {
  let m = null
  try { m = md5(corp(MIG, cap)) } catch { /* funcția lipsește din migrare (de ex. pe un head vechi) → eșec raportat, nu cădere */ }
  ok(m && blocNoi(MIG).includes(`('${sem}', '${m}'`) && blocNoi(REV).includes(`('${sem}', '${m}'`), `amprenta nouă ${sem} = ${m} (migrare + revenire)`)
}
ok(!/AMPRENTA_[A-Z_]+/.test(blocNoi(MIG)) && !/AMPRENTA_[A-Z_]+/.test(blocNoi(REV)), 'fără marcaje AMPRENTA_* rămase')
const recalculeaza = t => {
  const a = t.indexOf('-- >>> AMPRENTE-NOI 20261131i'), b = t.indexOf('-- <<< AMPRENTE-NOI 20261131i')
  const bloc = CAP_NOI.reduce((x, [sem, cap]) => x.replace(new RegExp(`(\\('${sem.replace(/[().,\[\]]/g, '\\$&')}', ')[0-9a-f]{32}`), `$1${md5(corp(t, cap))}`), t.slice(a, b))
  return t.slice(0, a) + bloc + t.slice(b)
}
// paritate L19: forma „{NUME}” din SQL (regex-ul din migrare, fără limită de lungime) = cea din JS, pe același tabel de cazuri (partea JS: src/redari/mailLinkPersonal.test.jsx)
const RX_SQL = /regexp_matches\(p_text,'([^']+)','g'\)/.exec(MIG)?.[1]
ok(RX_SQL === '[{]([^{}]+)[}]', 'regex-ul câmpurilor din migrare: ' + RX_SQL)
ok(MIG.includes(" IF rez ~ '[{}]' THEN RAISE EXCEPTION 'camp_necunoscut") && !MIG.includes('{1,40}'), 'verificarea finală refuză ORICE acoladă rămasă (fără limita veche de 40)')
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
// deținătorii UAT-ului A: D1..D3 + D10 cu token valid (lotul mare), D4 fără token, D5 cu token expirat, D6 valid dar fără e-mail, D9 valid (lotul fără câmpuri);
// UAT fără sesiune: D7 valid; proiect real: D8 valid
const D = { D1: '00000000-0000-0000-0000-0000000e0001', D2: '00000000-0000-0000-0000-0000000e0002', D3: '00000000-0000-0000-0000-0000000e0003', D4: '00000000-0000-0000-0000-0000000e0004',
  D5: '00000000-0000-0000-0000-0000000e0005', D6: '00000000-0000-0000-0000-0000000e0006', D7: '00000000-0000-0000-0000-0000000e0007', D8: '00000000-0000-0000-0000-0000000e0008', D9: '00000000-0000-0000-0000-0000000e0009',
  D10: '00000000-0000-0000-0000-0000000e0010' }
const T = { D1: 'T1' + 'a'.repeat(41), D2: 'T2' + 'b'.repeat(41), D3: 'T3' + 'c'.repeat(41), D5: 'T5' + 'e'.repeat(41), D6: 'T6' + 'f'.repeat(41), D7: 'T7' + 'g'.repeat(41), D8: 'T8' + 'h'.repeat(41), D9: 'T9' + 'i'.repeat(41),
  D10: 'T0' + 'j'.repeat(41) }
const LINK = tok => PREFIX_LINK + tok
// UAT-urile proiectului de TEST vin din tabelul comun cu testul JS al convocatorului (campuri_lot_cazuri.json): A, FARA, DIF — aceleași valori pe ambele căi (L19)
const CL = Object.fromEntries(CAZURI_LOT.map(c => [c.id, c]))
const TEL = CL.A.proiect.contact_telefon, COMUNA = CL.A.asteptat.COMUNA
ok(CAZURI_LOT.every(c => c.proiect.contact_telefon === TEL) && CL.A.asteptat.ZILE === '24.11.2026 și 25.11.2026' && CL.A.asteptat.PROGRAM === '09:00–16:00', 'tabelul comun al câmpurilor lotului: A / FARA / DIF cu același telefon')
const sqlUat = (id, c) => `('${id}', '${P.TEST}', ${lit(c.uat.nume)}, ${lit(c.uat.uat3)}, ${[1, 2, 3].map(i => c.uat['sesiune_zi' + i] == null ? 'NULL' : `DATE ${lit(c.uat['sesiune_zi' + i])}`).join(', ')}, ${[1, 2, 3].map(i => c.uat['program_zi' + i] == null ? 'NULL' : lit(c.uat['program_zi' + i])).join(', ')})`
const DATE = `
INSERT INTO public.profiles (id, name, is_owner) VALUES ('${U.OWNER}', 'OWNER', true), ('${U.ADMIN}', 'ADMIN REDARI', false), ('${U.EDITOR}', 'EDITOR', false);
INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES ('${U.ADMIN}', 'redari', 'admin'), ('${U.EDITOR}', 'redari', 'editor');
INSERT INTO storage.objects (id, bucket_id, name, metadata) VALUES ('${OB.TEST}', 'redari', 'TEST-MAIL/autorizare.pdf', '{"eTag": "\\"t1\\""}'), ('${OB.REAL}', 'redari', 'LOT1-REAL/autorizare.pdf', '{"eTag": "\\"r1\\""}');
INSERT INTO public.red_proiecte (id, cod, denumire, contact_telefon, autorizare_tgz_nr, autorizare_tgz_data, autorizare_tgz_fisier, autorizare_tgz_obiect, autorizare_tgz_etag) VALUES
  ('${P.TEST}', 'TEST-MAIL', 'Proiect de TEST', '${TEL}', '1', current_date, 'TEST-MAIL/autorizare.pdf', '${OB.TEST}', '"t1"'),
  ('${P.REAL}', 'LOT1-REAL', 'Proiect real (fictiv)', '${TEL}', '2', current_date, 'LOT1-REAL/autorizare.pdf', '${OB.REAL}', '"r1"');
INSERT INTO public.red_uat (id, proiect_id, nume, uat3, sesiune_zi1, sesiune_zi2, sesiune_zi3, program_zi1, program_zi2, program_zi3) VALUES
  ${sqlUat(UAT.A, CL.A)},
  ${sqlUat(UAT.FARA, CL.FARA)},
  ${sqlUat(UAT.DIF, CL.DIF)},
  ('${UAT.REAL}', '${P.REAL}', 'UAT real', 'RLA', DATE '2026-11-24', NULL, NULL, '09:00–16:00', NULL, NULL);
INSERT INTO public.red_parcele (id, proiect_id, uat_id, id_parcela) VALUES ('${PAR.A1}', '${P.TEST}', '${UAT.A}', 'T1-TST-0001'), ('${PAR.A2}', '${P.TEST}', '${UAT.A}', 'T1-TST-0002'),
  ('${PAR.FARA}', '${P.TEST}', '${UAT.FARA}', 'T1-FRS-0001'), ('${PAR.REAL}', '${P.REAL}', '${UAT.REAL}', 'T1-RLA-0001');
INSERT INTO public.red_detinatori (id, parcela_id, nume) VALUES ('${D.D1}', '${PAR.A1}', 'UNU FICTIV'), ('${D.D2}', '${PAR.A1}', 'DOI FICTIV'), ('${D.D3}', '${PAR.A2}', 'TREI FICTIV'),
  ('${D.D4}', '${PAR.A2}', 'PATRU FARA TOKEN'), ('${D.D5}', '${PAR.A2}', 'CINCI EXPIRAT'), ('${D.D6}', '${PAR.A2}', 'SASE FARA EMAIL'), ('${D.D7}', '${PAR.FARA}', 'SAPTE FARA SESIUNE'), ('${D.D8}', '${PAR.REAL}', 'OPT REAL'),
  ('${D.D9}', '${PAR.A2}', 'NOUA FICTIV'), ('${D.D10}', '${PAR.A1}', 'ZECE FICTIV');
INSERT INTO public.red_detinatori_contact (detinator_id, email) VALUES ('${D.D1}', 'Unu.Fictiv@gazpet.ro'), ('${D.D2}', 'doi.fictiv@gazpet.ro'), ('${D.D3}', 'trei.fictiv@gazpet.ro'),
  ('${D.D4}', 'patru.fictiv@gazpet.ro'), ('${D.D5}', 'cinci.fictiv@gazpet.ro'), ('${D.D6}', NULL), ('${D.D7}', 'sapte.fictiv@gazpet.ro'), ('${D.D8}', 'opt.fictiv@gazpet.ro'), ('${D.D9}', 'noua.fictiv@gazpet.ro'),
  ('${D.D10}', 'zece.fictiv@gazpet.ro');
INSERT INTO public.red_detinatori_token (detinator_id, token_raspuns, token_expira_la) VALUES ('${D.D1}', '${T.D1}', now() + interval '30 days'), ('${D.D2}', '${T.D2}', now() + interval '30 days'),
  ('${D.D3}', '${T.D3}', NULL), ('${D.D5}', '${T.D5}', now() - interval '1 day'), ('${D.D6}', '${T.D6}', now() + interval '30 days'), ('${D.D7}', '${T.D7}', NULL), ('${D.D8}', '${T.D8}', now() + interval '30 days'),
  ('${D.D9}', '${T.D9}', now() + interval '30 days'), ('${D.D10}', '${T.D10}', now() + interval '30 days');`
const TOKENI = Object.values(T)
const NR_TOKENI = TOKENI.length
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
// toate mesajele de eroare primite în timpul verificărilor (tokenul nu trebuie să apară în niciunul)
let ERORI = []
async function ca(db, rol, uid, sql) {
  const claims = JSON.stringify(uid ? { sub: uid, role: rol } : { role: rol })
  await db.exec(`BEGIN; SET LOCAL ROLE ${rol}; SELECT set_config('request.jwt.claims', ${lit(claims)}, true);${uid ? ` SELECT set_config('request.jwt.claim.sub', '${uid}', true);` : ''}`)
  try { const r = await db.query(sql); await db.exec('COMMIT'); return { rows: r.rows } }
  catch (e) { await db.exec('ROLLBACK'); ERORI.push(e.message); return { code: e.code, message: e.message } }
}
const setari = async db => (await db.query(`SELECT trimitere_oprita, trimitere_conectata_la, versiune FROM public.red_mail_setari WHERE id = 1`)).rows[0]
const NOI = `('fn_red_link_raspuns', 'fn_red_mail_f2_token', 'fn_red_mail_f2_campuri', 'fn_red_mail_f2_completeaza', 'fn_red_mail_f2_link_forma', 'fn_red_mail_f2_link_strain')`
const NR_NOI = 6
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
const optout = (db, email) => db.exec(`INSERT INTO public.red_mail_optout (email, activ, motiv, sursa, setat_de) VALUES (${lit(email)}, true, 'cerere fictiva de dezabonare', 'cerere_om', '${U.OWNER}')`)
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
// r3: textul are și forme LEGITIME care trebuie să treacă de detector: un procent („100%”) și un URL străin procent-codificat, fără token
const PLAN = 'Planul lucrărilor (100% finalizat): https://exemplu.invalid/docs/Plan%20lucrari.pdf?v=1%2C2'
const TEXT = `Bună ziua,\n\nLucrările pe terenul dumneavoastră din {COMUNA} s-au încheiat. Vă invităm la Primăria {COMUNA}, în una dintre zilele {ZILE}, între orele {PROGRAM}.\nNe puteți spune dacă participați la telefon {TEL} sau prin formularul dumneavoastră de răspuns: {LINK_RASPUNS}\n${PLAN}\n\nCu stimă,\nGAZPET INSTAL S.R.L.`
const SUBIECT = 'Predarea terenului – {COMUNA}, {ZILE}'
const TEXT_ASTEPTAT = tok => `Bună ziua,\n\nLucrările pe terenul dumneavoastră din ${COMUNA} s-au încheiat. Vă invităm la Primăria ${COMUNA}, în una dintre zilele 24.11.2026 și 25.11.2026, între orele 09:00–16:00.\nNe puteți spune dacă participați la telefon ${TEL} sau prin formularul dumneavoastră de răspuns: ${LINK(tok)}\n${PLAN}\n\nCu stimă,\nGAZPET INSTAL S.R.L.`
const SUBIECT_ASTEPTAT = `Predarea terenului – ${COMUNA}, 24.11.2026 și 25.11.2026`

// ── VERIFICĂRILE după migrare; întoarce lista abaterilor ──
async function verifica(db) {
  const ab = []
  ERORI = []
  const asteptCod = (r, cod, ce, re) => { if (!r.code) ab.push(`${ce}: a trecut (aștepta ${cod})`); else if (r.code !== cod || (re && !re.test(r.message))) ab.push(`${ce}: ${r.code} ${r.message} (aștepta ${cod}${re ? ' ' + re : ''})`) }
  const asteptOk = (r, ce) => { if (r.code) { ab.push(`${ce}: ${r.code} ${r.message}`); return undefined } return r.rows[0] && 'r' in r.rows[0] ? r.rows[0].r : r.rows }
  // A. câmpurile lotului: owner, pe tabelul comun cu testul JS al convocatorului (A: două zile cu același program; FARA: fără sesiune = ZILE / PROGRAM null;
  //    DIF: programe diferite = PROGRAM null); editor / admin 42501; UAT al altui proiect = tinta_invalida
  const cheie = o => JSON.stringify(Object.fromEntries(Object.entries(o).sort()))
  for (const [id, c] of [[UAT.A, CL.A], [UAT.FARA, CL.FARA], [UAT.DIF, CL.DIF]]) {
    const a = asteptOk(await campuri(db, U.OWNER, P.TEST, id), `A campuri owner UAT ${c.id}`)
    if (a && cheie(a) !== cheie(c.asteptat)) ab.push(`A câmpurile UAT ${c.id}: ${JSON.stringify(a)} ≠ ${JSON.stringify(c.asteptat)} (tabelul comun cu convocatorul)`)
  }
  asteptCod(await campuri(db, U.EDITOR, P.TEST, UAT.A), '42501', 'A campuri editor')
  asteptCod(await campuri(db, U.ADMIN, P.TEST, UAT.A), '42501', 'A campuri admin Redări (ne-owner)')
  asteptCod(await campuri(db, U.OWNER, P.TEST, UAT.REAL), 'P0001', 'A campuri UAT al altui proiect', /tinta_invalida/)
  // paritate L19 pe tabelul de cazuri comun: regex-ul SQL (numele câmpurilor), refuzul completării (orice acoladă rămasă) și linkul literal
  const TOATE = JSON.stringify({ LINK_RASPUNS: 'L', COMUNA: 'C', ZILE: 'Z', PROGRAM: 'P', TEL: 'T' })
  // (funcția lipsă — head vechi — = 'lipsa', ca abaterea să fie raportată, nu să cadă proba)
  const ls = async (t, tok) => { try { return (await db.query(`SELECT public.fn_red_mail_f2_link_strain($1, $2) AS b`, [t, tok])).rows[0].b } catch { return 'lipsa' } }
  for (const c of CAZURI) {
    const r = (await db.query(`SELECT coalesce(array_agg(rm.m[1] ORDER BY rm.ord), ARRAY[]::text[]) AS a FROM regexp_matches($1, $2, 'g') WITH ORDINALITY AS rm(m, ord)`, [c.text, RX_SQL])).rows[0].a
    const unice = r.filter((v, i) => r.indexOf(v) === i)
    if (JSON.stringify(unice) !== JSON.stringify(c.campuri)) ab.push(`A paritate regex SQL „${c.text.slice(0, 30)}”: ${JSON.stringify(unice)} ≠ ${JSON.stringify(c.campuri)}`)
    let refuz = false, mesaj = ''
    try { const x = (await db.query(`SELECT public.fn_red_mail_f2_completeaza($1, $2::jsonb) AS t`, [c.text, TOATE])).rows[0].t; if (/[{}]/.test(x)) ab.push(`A completarea a lăsat acolade: „${c.text.slice(0, 30)}”`) }
    catch (e) { refuz = true; mesaj = e.message; if (e.code !== '22023') ab.push(`A completarea „${c.text.slice(0, 30)}”: ${e.code} ${e.message}`) }
    if (refuz !== c.refuz) ab.push(`A paritate refuz SQL „${c.text.slice(0, 30)}”: ${refuz} (${mesaj}) ≠ ${c.refuz}`)
    const ll = await ls(c.text, null)
    if (ll !== c.link_literal) ab.push(`A paritate link literal SQL „${c.text.slice(0, 30)}”: ${ll} ≠ ${c.link_literal}`)
  }
  // link_strain pe tokenurile REALE ale fixture-ului: al destinatarului = nu e străin; al altuia (ca link sau ca token gol, fără adresă) = străin;
  // r3: tokenul lipit de alte litere e găsit (fereastra de 43), iar „t1…” cu minusculă nu e tokenul „T1…” (sensibil la majuscule)
  if (await ls('x ' + LINK(T.D1) + ' y', T.D1) !== false || await ls('x ' + LINK(T.D2) + ' y', T.D1) !== true || await ls('token copiat ' + T.D2 + ' fara adresa', T.D1) !== true
    || await ls('x ' + LINK(T.D1), null) !== true || await ls('lipit ' + T.D1 + 'x', null) !== true || await ls('minuscula ' + T.D1.toLowerCase(), null) !== false) ab.push('A fn_red_mail_f2_link_strain pe tokenurile fixture-ului')
  // r3 (Jakarinos #1138 P1): paritatea SQL = valorile scrise de mână în tabelul comun (aceleași ca în JS), pe tokenurile fixture-ului
  if (JSON.stringify([...LS.tokeni_existenti].sort()) !== JSON.stringify([...TOKENI].sort()) || LS.tokeni.A !== T.D1 || LS.tokeni.B !== T.D2) ab.push('A tabelul link_strain: tokenurile ≠ fixture-ul')
  for (const c of LS.cazuri) {
    const r = await ls(c.text, c.token == null ? null : LS.tokeni[c.token])
    if (r !== c.asteptat) ab.push(`A paritate link_strain SQL ${c.id}: ${r} ≠ ${c.asteptat}`)
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
  // r2 (P2): acolade rămase — nume de 41 de caractere (peste limita veche a parserului), „{}”, acoladă neînchisă, câmp cunoscut + acoladă = refuz, nimic creat
  asteptCod(await creeaza(db, U.OWNER, LOT.C, P.TEST, UAT.A, [D.D1], 'S', `text {${'X'.repeat(41)}} {LINK_RASPUNS}`), '22023', 'C câmp necunoscut de 41 de caractere', /camp_necunoscut/)
  asteptCod(await creeaza(db, U.OWNER, LOT.C, P.TEST, UAT.A, [D.D1], 'S', `text {${'X'.repeat(300)}} {LINK_RASPUNS}`), '22023', 'C câmp necunoscut de 300 de caractere', /camp_necunoscut/)
  asteptCod(await creeaza(db, U.OWNER, LOT.C, P.TEST, UAT.A, [D.D1], 'S', 'text {} {LINK_RASPUNS}'), '22023', 'C acolade goale', /camp_necunoscut/)
  asteptCod(await creeaza(db, U.OWNER, LOT.C, P.TEST, UAT.A, [D.D1], 'S', 'text {LINK_RASPUNS și {COMUNA'), '22023', 'C acoladă neînchisă', /camp_necunoscut/)
  asteptCod(await creeaza(db, U.OWNER, LOT.C, P.TEST, UAT.A, [D.D1], `S {${'Y'.repeat(41)}}`, 'text {LINK_RASPUNS}'), '22023', 'C câmp de 41 de caractere în subiect', /camp_necunoscut/)
  // r2 (P1): un link personal LITERAL în text (al lui D1, lângă {LINK_RASPUNS}, destinatari D1 și D2 — ar ajunge și la D2), în subiect, pe altă origine,
  //          sau tokenul copiat fără adresă = link_literal, nimic creat
  asteptCod(await creeaza(db, U.OWNER, LOT.C, P.TEST, UAT.A, [D.D1, D.D2], 'S', `Răspuns: ${LINK(T.D1)}. Link personal: {LINK_RASPUNS}`), '22023', 'C link literal în text + {LINK_RASPUNS}', /link_literal/)
  asteptCod(await creeaza(db, U.OWNER, LOT.C, P.TEST, UAT.A, [D.D1], 'S', `Răspuns: ${LINK(T.D1)}.`), '22023', 'C link literal în text, un singur destinatar (chiar al lui)', /link_literal/)
  asteptCod(await creeaza(db, U.OWNER, LOT.C, P.TEST, UAT.A, [D.D1, D.D2], `S ${LINK(T.D1)}`, 'text {LINK_RASPUNS}'), '22023', 'C link literal în subiect', /link_literal/)
  asteptCod(await creeaza(db, U.OWNER, LOT.C, P.TEST, UAT.A, [D.D1, D.D2], 'S', `https://pontaj-pro-sooty.vercel.app/redari/raspuns/${T.D2} {LINK_RASPUNS}`), '22023', 'C link literal pe altă origine', /link_literal/)
  asteptCod(await creeaza(db, U.OWNER, LOT.C, P.TEST, UAT.A, [D.D1, D.D2], 'S', `token ${T.D2} {LINK_RASPUNS}`), '22023', 'C token copiat fără adresă', /link_literal/)
  // r3 (Jakarinos #1138 P1): formele codificate / rupte / cu majuscule ale linkului sau tokenului altcuiva, în TEXT și în SUBIECT = link_literal, nimic creat
  for (const id of ['n01_pct54_rest_literal', 'n02_token_tot_codificat_in_cale', 'n03_dublu_codificat', 'n04_token_codificat_fara_cale', 'n05_token_rupt_spatiu', 'n06_token_rupt_linie',
    'n07_token_rupt_zero_width', 'n08_entitate_zecimala', 'n10_entitate_amp_imbricata', 'n11_cale_majuscule', 'n12_cale_singura', 'n13_cale_codificata', 'n17_litera_lata_nfkc',
    'n18_token_lipit_de_text', 'n20_invizibil_codificat', 'n25_pct54_fara_cale', 'n26_dublu_fara_cale', 'n27_tot_dublu_codificat_fara_cale']) {
    asteptCod(await creeaza(db, U.OWNER, LOT.C, P.TEST, UAT.A, [D.D1, D.D2], 'S', `${LSC(id).text} {LINK_RASPUNS}`), '22023', `C r3 text ${id}`, /link_literal/)
  }
  for (const id of ['n01_pct54_rest_literal', 'n02_token_tot_codificat_in_cale', 'n03_dublu_codificat', 'n05_token_rupt_spatiu', 'n07_token_rupt_zero_width', 'n08_entitate_zecimala',
    'n11_cale_majuscule', 'n13_cale_codificata', 'n25_pct54_fara_cale', 'n27_tot_dublu_codificat_fara_cale']) {
    asteptCod(await creeaza(db, U.OWNER, LOT.C, P.TEST, UAT.A, [D.D1, D.D2], LSC(id).text, 'text {LINK_RASPUNS}'), '22023', `C r3 subiect ${id}`, /link_literal/)
  }
  // r3: pe MESAJUL FINAL — tokenul lui D2 intră printr-o VALOARE de câmp (numele UAT-ului: codificat %XX, rupt de spațiu) la mesajul lui D1: link_strain
  //     (șablonul e curat; verificarea finală prinde, în corp și în subiect); la mesajul lui D2 același token e al lui, deci textul ar trece — de aceea D1 și D2
  const NUME_A = (await db.query(`SELECT nume FROM public.red_uat WHERE id = $1`, [UAT.A])).rows[0].nume
  for (const [ce, nume] of [['codificat', `Comuna %54${T.D2.slice(1)}`], ['rupt de spațiu', `Comuna ${T.D2.slice(0, 20)} ${T.D2.slice(20)}`], ['calea codificată', 'Comuna redari%2Fraspuns']]) {
    await db.exec(`UPDATE public.red_uat SET nume = ${lit(nume)} WHERE id = '${UAT.A}'`)
    asteptCod(await creeaza(db, U.OWNER, LOT.C, P.TEST, UAT.A, [D.D1, D.D2], 'S', 'Comuna {COMUNA}: {LINK_RASPUNS}'), '22023', `C r3 mesajul final, corp (${ce})`, /link_strain/)
    asteptCod(await creeaza(db, U.OWNER, LOT.C, P.TEST, UAT.A, [D.D1, D.D2], 'S {COMUNA}', 'text {LINK_RASPUNS}'), '22023', `C r3 mesajul final, subiect (${ce})`, /link_strain/)
  }
  // r5: tokenul lui D2 DUPĂ primele 64 de ferestre (lipit de un șir lung: spațiile se scot) — în bucata a 4-a / a 5-a, nu în prima; corp și subiect
  for (const [ce, nume] of [['după 250 de caractere, într-o bucată din mijloc', `Comuna ${'Q'.repeat(250)}${T.D2}${'Q'.repeat(100)}`], ['în ultima bucată, parțială', `Comuna ${'Q'.repeat(64 * 4 - 7)} ${T.D2}`]]) {
    await db.exec(`UPDATE public.red_uat SET nume = ${lit(nume)} WHERE id = '${UAT.A}'`)
    asteptCod(await creeaza(db, U.OWNER, LOT.C, P.TEST, UAT.A, [D.D1, D.D2], 'S', 'Comuna {COMUNA}: {LINK_RASPUNS}'), '22023', `C r5 bucăți, corp (${ce})`, /link_strain/)
    asteptCod(await creeaza(db, U.OWNER, LOT.C, P.TEST, UAT.A, [D.D1, D.D2], 'S {COMUNA}', 'text {LINK_RASPUNS}'), '22023', `C r5 bucăți, subiect (${ce})`, /link_strain/)
  }
  await db.exec(`UPDATE public.red_uat SET nume = ${lit(NUME_A)} WHERE id = '${UAT.A}'`)
  // r4: (1) mesajul care NU e forma comună cu linkul lui trece prin detectorul complet — un semn combinant lipit de {LINK_RASPUNS} se compune (NFC) cu ultima
  //     literă a tokenului lui D1 („a” + U+0301 = „á”): linkul lui D1 nu mai e întreg, calea rămasă cu alt token = link_strain (la D2, „b” + U+0301 nu se
  //     compune: linkul rămâne întreg, mesajul = forma comună); (2) plafonul pe lungimea BRUTĂ: textul > 19.000 / subiectul > 400 (și din spații) = text_prea_lung
  asteptCod(await creeaza(db, U.OWNER, LOT.C, P.TEST, UAT.A, [D.D1, D.D2], 'S', 'Răspuns: {LINK_RASPUNS}' + String.fromCharCode(0x301) + ' mulțumim'), '22023', 'C r4 linkul alipit de un semn combinant (mesajul ≠ forma comună)', /link_strain/)
  asteptCod(await creeaza(db, U.OWNER, LOT.C, P.TEST, UAT.A, [D.D1], 'S', 'x {LINK_RASPUNS}' + ' '.repeat(19000)), '22023', 'C r4 textul peste 19.000 de caractere brute (spații)', /text_prea_lung/)
  asteptCod(await creeaza(db, U.OWNER, LOT.C, P.TEST, UAT.A, [D.D1], 'S' + ' '.repeat(400), 'x {LINK_RASPUNS}'), '22023', 'C r4 subiectul peste 400 de caractere brute', /text_prea_lung/)
  asteptCod(await creeaza(db, U.OWNER, LOT.C, P.TEST, UAT.A, [D.D1], 'S', 'x'.repeat(19001)), '22023', 'C r4 textul de 19.001 caractere', /text_prea_lung/)
  if (await nrLoturi(db) !== n0) ab.push('C un refuz a creat lotul')
  // un text fără niciun câmp rămâne permis (ca azi); un text fără {LINK_RASPUNS} e avertisment în ecran, nu refuz în bază
  const c1 = asteptOk(await creeaza(db, U.OWNER, LOT.C, P.TEST, UAT.A, [D.D9], 'Fără câmpuri', 'Text simplu.'), 'C lot fără câmpuri')
  if (c1 !== LOT.C) ab.push('C lotul fără câmpuri nu s-a creat: ' + c1)
  const mc = await mesaje(db, LOT.C)
  if (mc.length !== 1 || mc[0].corp_text_final !== 'Text simplu.' || mc[0].subiect_final !== 'Fără câmpuri') ab.push('C lotul fără câmpuri: ' + JSON.stringify(mc.map(m => m.corp_text_final)))
  // B. lotul cu 4 destinatari: fiecare mesaj cu linkul LUI, fără acolade, subiectul completat, hash-ul peste textul final (SQL = JS), lotul pe hash-urile mesajelor
  const b1 = asteptOk(await creeaza(db, U.OWNER, LOT.A, P.TEST, UAT.A, [D.D1, D.D2, D.D3, D.D10], SUBIECT, TEXT), 'B creare lot cu 4 destinatari')
  if (b1 !== LOT.A) ab.push('B lotul nu s-a creat: ' + b1)
  const ms = await mesaje(db, LOT.A)
  if (ms.length !== 4) ab.push('B numărul mesajelor: ' + ms.length)
  for (const [det, tok, email] of [[D.D1, T.D1, 'unu.fictiv@gazpet.ro'], [D.D2, T.D2, 'doi.fictiv@gazpet.ro'], [D.D3, T.D3, 'trei.fictiv@gazpet.ro'], [D.D10, T.D10, 'zece.fictiv@gazpet.ro']]) {
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
  if (asteptOk(await creeaza(db, U.OWNER, LOT.A, P.TEST, UAT.A, [D.D1, D.D2, D.D3, D.D10], SUBIECT, TEXT), 'B reluarea aceleiași intenții') !== LOT.A || (await mesaje(db, LOT.A)).length !== 4) ab.push('B reluarea a dublat')
  // r4: forma comună se calculează ÎNAINTEA lock-ului și a verificării idempotenței — un refuz al ei (aici {ZILE} necompletabil: UAT-ul fără zile) nu are
  //     voie să schimbe reluarea: aceeași intenție întoarce tot lotul existent (L04 / L05), nimic dublat
  {
    const z = (await db.query(`SELECT sesiune_zi1::text AS a, sesiune_zi2::text AS b, sesiune_zi3::text AS c FROM public.red_uat WHERE id = $1`, [UAT.A])).rows[0]
    await db.exec(`UPDATE public.red_uat SET sesiune_zi3 = NULL, sesiune_zi2 = NULL, sesiune_zi1 = NULL WHERE id = '${UAT.A}'`)
    const rr = await creeaza(db, U.OWNER, LOT.A, P.TEST, UAT.A, [D.D1, D.D2, D.D3, D.D10], SUBIECT, TEXT)
    if (rr.code || rr.rows[0].r !== LOT.A || (await mesaje(db, LOT.A)).length !== 4) ab.push('B r4 reluarea cu forma comună refuzată: ' + (rr.code ? rr.code + ' ' + rr.message : rr.rows[0].r))
    await db.query(`UPDATE public.red_uat SET sesiune_zi1 = $1::date, sesiune_zi2 = $2::date, sesiune_zi3 = $3::date WHERE id = $4`, [z.a, z.b, z.c, UAT.A])
  }
  // G. RLS neschimbat: editorul nu vede mesajele (snapshotul cu link) și nici tokenul altfel decât azi (admin / editor pot, ca în 20261126a); anon nimic
  const g1 = await ca(db, 'authenticated', U.EDITOR, `SELECT count(*)::int AS r FROM public.red_mail_mesaje`)
  if (g1.code || g1.rows[0].r !== 0) ab.push('G editorul vede mesajele: ' + JSON.stringify(g1))
  const g2 = await ca(db, 'authenticated', U.OWNER, `SELECT count(*)::int AS r FROM public.red_mail_mesaje WHERE lot_id = '${LOT.A}'`)
  if (g2.code || g2.rows[0].r !== 4) ab.push('G owner-ul nu vede mesajele: ' + JSON.stringify(g2))
  const g3 = await ca(db, 'authenticated', U.EDITOR, `SELECT count(*)::int AS r FROM public.red_detinatori_token`)
  if (g3.code || g3.rows[0].r !== NR_TOKENI) ab.push('G editorul nu mai citește tokenul ca azi (politica veche): ' + JSON.stringify(g3))
  asteptCod(await ca(db, 'anon', null, `SELECT count(*) AS r FROM public.red_mail_mesaje`), '42501', 'G anon pe mesaje')
  asteptCod(await ca(db, 'anon', null, `SELECT public.fn_red_mail_f2_campuri('${P.TEST}', '${UAT.A}') AS r`), '42501', 'G anon pe campuri (fără EXECUTE)')
  asteptCod(await ca(db, 'authenticated', U.OWNER, `SELECT public.fn_red_mail_f2_token('${D.D1}') AS r`), '42501', 'G owner-ul nu poate chema direct fn_red_mail_f2_token (intern)')
  asteptCod(await ca(db, 'authenticated', U.OWNER, `SELECT public.fn_red_link_raspuns('x') AS r`), '42501', 'G owner-ul nu poate chema direct fn_red_link_raspuns (intern)')
  asteptCod(await ca(db, 'authenticated', U.OWNER, `SELECT public.fn_red_mail_f2_link_strain('x', NULL) AS r`), '42501', 'G owner-ul nu poate chema direct fn_red_mail_f2_link_strain (intern)')
  // H. garda „doar TEST” neatinsă: lotul proiectului real e refuzat de f2_poate după pornire; corpul f2_poate = 31h
  await porneste(db)
  const r1 = asteptOk(await creeaza(db, U.OWNER, LOT.R, P.REAL, UAT.REAL, [D.D8], 'S', 'x {LINK_RASPUNS}'), 'H lot pe proiect real (crearea e permisă, trimiterea nu)')
  if (r1 === LOT.R) { await aproba(db, U.OWNER, LOT.R); if (await poate(db, LOT.R) !== 'doar_proiecte_test') ab.push('H garda doar TEST: ' + await poate(db, LOT.R)) }
  if (await amprentaFn(db, 'fn_red_mail_f2_poate') !== '01d3390b765bedc9fd64801f113109c9') ab.push('H fn_red_mail_f2_poate schimbată')
  // E. trimiterea: aprobare; q1 rezervat → autorizat → trimis; apoi, în coadă: q2 cu opt-out, q3 cu tokenul expirat după aprobare, q4 valid → O SINGURĂ
  //    rezervare anulează q2 (optout) și q3 (token_expirat) și întoarce q4 rezervat (r2: anulările locale nu opresc coada); q4: tokenul expiră ÎNTRE
  //    rezervare și autorizare → apel_incepe = false, q4 anulat; nimic nu se retrimite
  if (asteptOk(await aproba(db, U.OWNER, LOT.A), 'E aprobarea lotului') !== true) ab.push('E aprobarea nu a întors true')
  if (await poate(db, LOT.A) !== null) ab.push('E lotul nu poate trimite: ' + await poate(db, LOT.A))
  // rezervarea ia mesajele în ordinea id-ului (uuid aleator): coada se citește din bază, nu se presupune deținătorul
  const coada = async () => (await db.query(`SELECT detinator_id, catre FROM public.red_mail_mesaje WHERE lot_id = $1 AND stare = 'in_coada' ORDER BY id`, [LOT.A])).rows
  const stari = async () => Object.fromEntries((await mesaje(db, LOT.A)).map(m => [m.detinator_id, [m.stare, m.eroare_cod]]))
  const [q1] = await coada()
  const e1 = asteptOk(await rezerva(db, U.OWNER, LOT.A), 'E rezerva q1')
  const m1 = e1 && e1[0]
  if (!m1 || m1.stare !== 'rezervat' || m1.detinator_id !== q1.detinator_id) ab.push('E prima rezervare: ' + JSON.stringify(e1))
  if (m1) {
    if (asteptOk(await apelIncepe(db, U.OWNER, m1.id, m1.lease_token), 'E apel_incepe q1') !== true) ab.push('E apel_incepe q1 nu a întors true')
    if (asteptOk(await rezultat(db, U.OWNER, m1.id, m1.lease_token, 'trimis', 'gm1', 'th1'), 'E rezultat q1') !== true) ab.push('E rezultatul q1 nu a întors true')
  }
  // q2 → opt-out; q3 → tokenul expiră DUPĂ aprobare; q4 rămâne valid: rezervarea trece peste q2 și q3 și îl rezervă pe q4 în ACEEAȘI apăsare
  const [q2, q3, q4] = await coada()
  if (!q4) ab.push('E coada nu are 3 mesaje rămase')
  await optout(db, q2.catre)
  await expira(db, q3.detinator_id)
  await db.exec(`UPDATE public.red_mail_setari SET ultim_apel_la = now() - interval '3 seconds' WHERE id = 1`)
  const e2 = asteptOk(await rezerva(db, U.OWNER, LOT.A), 'E rezerva peste opt-out și token expirat')
  const m4 = e2 && e2[0]
  if (!m4 || m4.stare !== 'rezervat' || m4.detinator_id !== q4.detinator_id) ab.push('E rezervarea nu a trecut la primul valid (q4): ' + JSON.stringify(e2) + ' (handlerul s-ar opri la zero rânduri)')
  let st = await stari()
  if (JSON.stringify(st[q2.detinator_id]) !== JSON.stringify(['anulat', 'optout'])) ab.push('E q2 nu e anulat optout: ' + JSON.stringify(st[q2.detinator_id]))
  if (JSON.stringify(st[q3.detinator_id]) !== JSON.stringify(['anulat', 'token_expirat'])) ab.push('E q3 nu e anulat token_expirat: ' + JSON.stringify(st[q3.detinator_id]))
  if (JSON.stringify(st[q1.detinator_id]) !== JSON.stringify(['trimis', null])) ab.push('E q1: ' + JSON.stringify(st[q1.detinator_id]))
  // q4: rezervat, apoi tokenul expiră ÎNTRE rezervare și autorizare: apel_incepe = false, mesajul anulat, niciun apel
  if (m4) {
    await expira(db, q4.detinator_id)
    await db.exec(`UPDATE public.red_mail_setari SET ultim_apel_la = now() - interval '3 seconds' WHERE id = 1`)   // pauza de 2 s dintre apeluri, fără așteptare
    if (asteptOk(await apelIncepe(db, U.OWNER, m4.id, m4.lease_token), 'E apel_incepe q4 cu token expirat între rezervare și autorizare') !== false) ab.push('E apel_incepe q4 a autorizat apelul cu token expirat')
    st = await stari()
    if (JSON.stringify(st[q4.detinator_id]) !== JSON.stringify(['anulat', 'token_expirat'])) ab.push('E q4 nu e anulat token_expirat: ' + JSON.stringify(st[q4.detinator_id]))
  }
  const e4 = asteptOk(await rezerva(db, U.OWNER, LOT.A), 'E rezerva după anulări (coadă goală)')
  if (!e4 || e4.length !== 0) ab.push('E ceva s-a retrimis: ' + JSON.stringify(e4))
  st = await stari()
  if (JSON.stringify(st[q2.detinator_id]) !== JSON.stringify(['anulat', 'optout']) || JSON.stringify(st[q3.detinator_id]) !== JSON.stringify(['anulat', 'token_expirat'])
    || JSON.stringify(st[q4.detinator_id]) !== JSON.stringify(['anulat', 'token_expirat']) || JSON.stringify(st[q1.detinator_id]) !== JSON.stringify(['trimis', null])) ab.push('E anulările nu sunt definitive: ' + JSON.stringify(st))
  const ja = (await db.query(`SELECT count(*)::int AS n FROM public.red_mail_jurnal_f2 WHERE lot_id = $1 AND cod = 'anulat'`, [LOT.A])).rows[0].n
  if (ja !== 2) ab.push('E jurnalul F2 fără cele două anulări token_expirat: ' + ja)
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

// ── 7. COSTUL (r4, Jakarinos #1138 r3 P2): RPC-ul complet pe lotul mare, prin corpul supabase/tests/20261131i_redari_mail_link_cost.sql (același ca pe
//    clonă), într-un worker_thread OPRIT la limita de timp (PGlite nu are statement_timeout). Baza = migrarea dată, aplicată ca runnerul, apoi dumpDataDir.
//    --doar-cost: doar secțiunile 0 / 0b + 7; --cost-mig <fișier>: măsoară alt text de migrare (de ex. head-ul r3, pentru „înainte”), fără mutanți.
const F_COST = 'supabase/tests/20261131i_redari_mail_link_cost.sql'
const COST_SQL = citeste(F_COST)
const COST_CORP = COST_SQL.slice(COST_SQL.indexOf('-- >>> COST-CORP 20261131i'), COST_SQL.indexOf('-- <<< COST-CORP 20261131i'))
const COST_PARAM = { clona: 'da', destinatari: '300', caractere: '19000', tokenuri: process.env.COST_TOKENURI || '20000', timeout: '0', prag_ms: '0' }
// pragurile pe PGlite (WASM, un fir; mult mai lent decât PostgreSQL nativ): RPC-ul complet și lock-ul global ținut; peste LIMITA_COST_MS lucrătorul e oprit
const argv = n => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null }
// (r4 pe serverul de lucru: RPC ~2,8 s, lock ~1,3 s; r3 = 267 s — pragurile lasă de ~3,5–4,5 ori loc pentru o mașină mai lentă)
const PRAG_COST_RPC_MS = 10000, PRAG_COST_LOCK_MS = 6000, LIMITA_COST_MS = Number(argv('--cost-limita') || 30000)
if (argv('--cost-tokenuri')) COST_PARAM.tokenuri = argv('--cost-tokenuri')
COST_PARAM.prag_ms = String(PRAG_COST_RPC_MS)
async function masoaraCost(textMig, { limita = LIMITA_COST_MS, param = COST_PARAM } = {}) {
  const db = await bazaNoua()
  try { await aplicaMig(db, textMig) } catch (e) { await db.close(); return { eroare: 'aplicare: ' + e.message } }
  const dump = await (await db.dumpDataDir('none')).arrayBuffer()
  await db.close()
  const { Worker } = await import('node:worker_threads')
  const w = new Worker(new URL('./redari_mail_link_cost_worker.mjs', import.meta.url), { workerData: { dump, corp: COST_CORP, parametri: param }, transferList: [dump] })
  const t0 = Date.now()
  return await new Promise(res => {
    const oprit = setTimeout(() => { w.terminate(); res({ depasit: true, ms: Date.now() - t0 }) }, limita)
    w.once('message', m => { clearTimeout(oprit); w.terminate(); res(m) })
    w.once('error', e => { clearTimeout(oprit); res({ eroare: e.message }) })
  })
}
const citesteCost = r => {
  const n = (r.note || []).find(x => x.startsWith('COST 20261131i:'))
  if (!n) return null
  return Object.fromEntries([...n.matchAll(/(\w+)=([^\s]+)/g)].map(m => [m[1], /^\d+$/.test(m[2]) ? Number(m[2]) : m[2]]))
}
async function sectiuneaCost() {
  const alt = argv('--cost-mig')
  console.log(`7. COSTUL: ${COST_PARAM.destinatari} destinatari × ${COST_PARAM.caractere} caractere, ${COST_PARAM.tokenuri} tokenuri sintetice existente (+ fixture-ul); ` +
    `praguri PGlite: RPC ≤ ${PRAG_COST_RPC_MS} ms, lock-ul global ≤ ${PRAG_COST_LOCK_MS} ms; lucrătorul oprit la ${LIMITA_COST_MS} ms${alt ? ' — MIGRAREA ' + alt : ''}`)
  // r5: fixture-ul de cost respectă regula parcelelor de pe clonă (triggerul 20261129g: id_parcela = {uat3}-{nnnn}), pe care scheletul PGlite nu o are
  //     (pe 91c0119f clona a refuzat „COST-0001”)
  const uat3 = /VALUES \(v_uat, v_pr, 'Comuna Sintetica', '([A-Z]{3})'/.exec(COST_SQL)?.[1]
  const idp = [...(/INSERT INTO public\.red_parcele[^;]*;/.exec(COST_SQL)?.[0] || '').matchAll(/'([^']*-\d+)'/g)].map(m => m[1])
  ok(uat3 && idp.length === 2 && idp.every(x => new RegExp(`^${uat3}-[0-9]{4}$`).test(x)), `fixture-ul de cost: id_parcela ${idp.join(', ')} = {uat3 ${uat3}}-{nnnn} (regula 20261129g)`)
  const r = await masoaraCost(alt ? readFileSync(alt, 'utf8').replace(/\r/g, '') : MIG)
  const c = citesteCost(r)
  console.log('     ' + (c ? JSON.stringify(c) : JSON.stringify(r).slice(0, 300)))
  // r5: lock-ul global măsurat până la ULTIMA instrucțiune înaintea ROLLBACK-ului (RPC + verificarea), nu doar până la sfârșitul RPC-ului
  ok(c && c.verdict !== 'GRESIT' && c.mesaje === Number(COST_PARAM.destinatari) && c.mesaje_cu_linkul_lor === c.mesaje && c.rpc_ms <= PRAG_COST_RPC_MS
    && c.lock_setari_tranzactie_ms <= PRAG_COST_LOCK_MS && c.lock_numerotare_tranzactie_ms <= PRAG_COST_LOCK_MS && c.lock_setari_tranzactie_ms >= c.lock_setari_rpc_ms,
    `costul lotului mare: rpc ${c?.rpc_ms} ms, lock setări ${c?.lock_setari_rpc_ms} ms până la sfârșitul RPC-ului / ${c?.lock_setari_tranzactie_ms} ms până la ROLLBACK, ` +
    `lock numerotare ${c?.lock_numerotare_tranzactie_ms} ms până la ROLLBACK, ${c?.mesaje} mesaje cu linkul lor${r.depasit ? ' — OPRIT LA LIMITĂ' : ''}`)
  if (alt) return
  // mutanții de COST: fiecare TREBUIE să depășească pragul (sau limita) — proba de timp prinde întoarcerea la căutarea pătratică / fără index / fără forma comună
  for (const [nume, lista] of MUTANTI_COST) {
    let t
    try { t = recalculeaza(aplica(MIG, lista)) } catch (e) { ok(false, `${nume}: mutantul nu se aplică (${e.message})`); continue }
    const rm = await masoaraCost(t)
    const cm = citesteCost(rm)
    const prins = rm.depasit || (cm && (cm.rpc_ms > PRAG_COST_RPC_MS || cm.lock_setari_tranzactie_ms > PRAG_COST_LOCK_MS))
    ok(prins, `MUTANT COST ${nume} — ${rm.depasit ? `oprit la limită (${rm.ms} ms)` : cm ? `rpc ${cm.rpc_ms} ms, lock ${cm.lock_setari_tranzactie_ms} ms` : 'eroare: ' + JSON.stringify(rm).slice(0, 200)}`)
  }
}
// mutanții de COST (textul migrării schimbat ca să refacă costul vechi): fiecare trebuie să depășească pragul / limita
const FARA_FORMA_COMUNA = ["  IF v_x0 IS NOT NULL AND replace(msg.corp_text_final,public.fn_red_link_raspuns(tok),'#')=v_x0 THEN\n", '  IF false THEN\n']
// r5: ferestrele de acum (conversia o dată pe șir) și forma r4 (subinterogarea aplatizată: conversia repetată pe fiecare fereastră + DISTINCT)
const FERESTRE_R5 = " WITH s AS MATERIALIZED (SELECT convert_to(r.m[1],'UTF8') AS b FROM regexp_matches(v,'[A-Za-z0-9_-]{43,}','g') r(m))\n" +
  " SELECT coalesce(array_agg(convert_from(substring(s.b FROM i FOR 43),'UTF8')),ARRAY[]::text[]) INTO ferestre\n  FROM s,generate_series(1,octet_length(s.b)-42) i;"
const FERESTRE_R4 = " SELECT coalesce(array_agg(DISTINCT w.f),ARRAY[]::text[]) INTO ferestre\n  FROM (SELECT convert_from(substring(s.b FROM i FOR 43),'UTF8') AS f\n" +
  "          FROM (SELECT convert_to(r.m[1],'UTF8') AS b FROM regexp_matches(v,'[A-Za-z0-9_-]{43,}','g') r(m)) s,generate_series(1,octet_length(s.b)-42) i) w;"
// mutantul „fără conversia unică” = forma r4 FĂRĂ DISTINCT (aceleași ferestre, cu repetări — trece postcondiția): doar costul îl deosebește
const FARA_CONVERSIE_UNICA = [FERESTRE_R5, FERESTRE_R4.replace('array_agg(DISTINCT w.f)', 'array_agg(w.f)')]
// r5: căutarea tokenurilor pe bucăți (detectorul și forma comună a lotului)
const BUC_STRAIN = " FOR buc IN SELECT array_agg(w.f) FROM unnest(v_fer) WITH ORDINALITY w(f,o) GROUP BY (w.o-1)/64 LOOP\n" +
  "  IF EXISTS(SELECT 1 FROM public.red_detinatori_token t WHERE t.token_raspuns=ANY(buc) AND t.token_raspuns IS DISTINCT FROM p_token) THEN RETURN true; END IF;\n END LOOP;\n RETURN false;"
const BUC_LOT = "  FOR v_buc IN SELECT array_agg(w.f) FROM unnest(v_fer0) WITH ORDINALITY w(f,o) GROUP BY (w.o-1)/64 LOOP\n" +
  "   v_gasite0:=v_gasite0||ARRAY(SELECT t.token_raspuns FROM public.red_detinatori_token t WHERE t.token_raspuns=ANY(v_buc));\n  END LOOP;"
const MUTANTI_COST = [
  // ca în r3: ferestrele cu substr pe TEXT (în UTF-8 substr numără caracterele de la început: pătratic) și detectorul complet pe fiecare mesaj
  ['ferestrele cu substr pe text + detectorul pe fiecare mesaj (costul r3)', [FARA_FORMA_COMUNA,
    [FERESTRE_R5, " SELECT coalesce(array_agg(w.f),ARRAY[]::text[]) INTO ferestre\n  FROM (SELECT substr(s.b,i,43) AS f\n" +
      "          FROM (SELECT r.m[1] AS b FROM regexp_matches(v,'[A-Za-z0-9_-]{43,}','g') r(m)) s,generate_series(1,length(s.b)-42) i) w;"]]],
  // fără forma comună: detectorul (liniar) pe fiecare dintre cele 300 de mesaje, sub lock-ul global
  ['fără forma comună (detectorul complet pe fiecare mesaj, sub lock)', [FARA_FORMA_COMUNA]],
  // fără index: fiecare token existent comparat cu fiecare fereastră (strpos nu folosește nici indexul, nici hash-ul) — scanarea completă
  ['fără index: scanarea tuturor tokenurilor pe fiecare fereastră', [
    [BUC_STRAIN, " RETURN EXISTS(SELECT 1 FROM public.red_detinatori_token t,unnest(v_fer) w WHERE strpos(t.token_raspuns,w)=1 AND t.token_raspuns IS DISTINCT FROM p_token);"],
    [BUC_LOT, "  SELECT coalesce(array_agg(DISTINCT t.token_raspuns),ARRAY[]::text[]) INTO v_gasite0 FROM public.red_detinatori_token t,unnest(v_fer0) w WHERE strpos(t.token_raspuns,w)=1;"]]],
]

// ── 7b. CREȘTEREA (r5, Jakarinos #1138 r4 P2): detectorul complet (fn_red_mail_f2_link_strain = forma + căutarea tokenurilor) pe un șir base64url de
//    4.000 / 8.000 / 16.000 / 19.000 de caractere (ferestre toate diferite), cu 20.000 de tokenuri existente și statistici (ANALYZE): timpul trebuie să
//    crească ~LINIAR și să rămână sub PRAG_19K_MS. Poarta de creștere = un punct EXTINS de 76.000 de caractere (de 4 ori 19k; doar funcția — plafonul
//    lotului rămâne 19.000): 76k / 19k ≤ RAPORT_CRESTERE (liniar = 4, pătratic = 16). Raportul 19k / 4k doar se afișează: la timpi de câteva ms zgomotul
//    îl mută între 4,3 și 6,1, iar partea pătratică a formei r4 abia începe să se vadă (8,5). Căutarea tokenurilor = DOAR indexul (pg_stat: zero scanări
//    secvențiale ale tabelului în timpul apelului; EXPLAIN pe interogările EXACTE din migrare, cu o bucată de 64 de ferestre: indexul unic, în planul cu
//    valori și în cel generic). Fiecare măsurătoare = mediana a 5 rulări, fiecare rulare = 5 apeluri. Mutanți: fără conversia unică (forma r4) →
//    raportul depășit; fără bucăți (un singur `= ANY(toate ferestrele)`) → interogarea pe bucăți lipsește.
const MARIMI = [4000, 8000, 16000, 19000, 76000], RAPORT_CRESTERE = 6, PRAG_19K_MS = 200, NR_TOK_CRESTERE = 20000
const TEXT_CRESTERE = n => `(SELECT left(string_agg(substr(md5('crestere-' || i), 1, 7), ' ' ORDER BY i), ${n}) FROM generate_series(1, ${n} / 8 + 2) i)`
async function bazaCrestere(textMig) {
  const db = await bazaNoua()
  await aplicaMig(db, textMig)
  await db.exec(`INSERT INTO public.red_detinatori (id, parcela_id, nume) SELECT ('0c0570c0-0000-4000-8000-' || lpad(to_hex(i), 12, '0'))::uuid, '${PAR.A2}', 'CRESTERE ' || i FROM generate_series(1, ${NR_TOK_CRESTERE}) i;
    INSERT INTO public.red_detinatori_token (detinator_id, token_raspuns, token_expira_la) SELECT ('0c0570c0-0000-4000-8000-' || lpad(to_hex(i), 12, '0'))::uuid,
      rtrim(translate(encode(sha256(convert_to('crestere-t-' || i, 'UTF8')), 'base64'), '+/', '-_'), '='), now() + interval '30 days' FROM generate_series(1, ${NR_TOK_CRESTERE}) i;
    ANALYZE public.red_detinatori_token;`)
  for (const n of MARIMI) await db.exec(`SELECT set_config('crestere.t${n}', ${TEXT_CRESTERE(n)}, false)`)
  return db
}
async function masoaraCrestere(db) {
  const timpi = {}
  for (const n of MARIMI) {
    const r = []
    for (let k = 0; k < 5; k++) {
      const t0 = performance.now()
      await db.exec(`DO $c$ BEGIN FOR k IN 1..5 LOOP PERFORM public.fn_red_mail_f2_link_strain(current_setting('crestere.t${n}'), NULL); END LOOP; END $c$`)
      r.push(performance.now() - t0)
    }
    timpi[n] = Math.round(r.sort((a, b) => a - b)[2] / 5 * 10) / 10
  }
  return timpi
}
const scanari = async db => {
  await db.query('SELECT pg_stat_force_next_flush()'); await db.query('SELECT pg_stat_clear_snapshot()')
  return (await db.query(`SELECT seq_scan::int AS s, idx_scan::int AS i FROM pg_stat_user_tables WHERE relid = 'public.red_detinatori_token'::regclass`)).rows[0]
}
// interogările de căutare EXACT din textul migrării (bucata → $1, tokenul → $2)
const RX_Q_STRAIN = /IF EXISTS\((SELECT 1 FROM public\.red_detinatori_token t WHERE t\.token_raspuns=ANY\(buc\) AND t\.token_raspuns IS DISTINCT FROM p_token)\) THEN RETURN true;/
const RX_Q_LOT = /ARRAY\((SELECT t\.token_raspuns FROM public\.red_detinatori_token t WHERE t\.token_raspuns=ANY\(v_buc\))\);/
async function sectiuneaCrestere() {
  console.log(`7b. CREȘTEREA: fn_red_mail_f2_link_strain pe ${MARIMI.join(' / ')} caractere, ${NR_TOK_CRESTERE} tokenuri (ANALYZE); 76k/19k ≤ ${RAPORT_CRESTERE}, 19k ≤ ${PRAG_19K_MS} ms; doar indexul`)
  const db = await bazaCrestere(MIG)
  const t = await masoaraCrestere(db)
  const rap = x => `19k/4k = ${(x[19000] / x[4000]).toFixed(1)}, 16k/8k = ${(x[16000] / x[8000]).toFixed(1)}, 76k/19k = ${(x[76000] / x[19000]).toFixed(1)}`
  console.log('     timpi pe apel (ms): ' + JSON.stringify(t) + ', ' + rap(t))
  ok(t[19000] <= PRAG_19K_MS && t[76000] / t[19000] <= RAPORT_CRESTERE, `creșterea ~liniară: 19k = ${t[19000]} ms (prag ${PRAG_19K_MS}), 76k/19k = ${(t[76000] / t[19000]).toFixed(1)} (prag ${RAPORT_CRESTERE})`)
  const nf = Number((await db.query(`SELECT cardinality(f.ferestre) AS n FROM public.fn_red_mail_f2_link_forma(current_setting('crestere.t19000')) f`)).rows[0].n)
  const s0 = await scanari(db)
  const rez = (await db.query(`SELECT public.fn_red_mail_f2_link_strain(current_setting('crestere.t19000'), NULL) AS x`)).rows[0].x
  const s1 = await scanari(db)
  ok(rez === false && nf > 16000 && s1.s === s0.s && s1.i > s0.i, `19k: ${nf} ferestre, ${NR_TOK_CRESTERE} tokenuri — scanări secvențiale ale tokenurilor ${s1.s - s0.s}, scanări de index ${s1.i - s0.i}`)
  // un token existent în fereastra de după prima bucată (poziția 200) și în ultima bucată, parțială: tot găsit (bucățile acoperă toate ferestrele)
  const tok = (await db.query(`SELECT token_raspuns AS t FROM public.red_detinatori_token WHERE detinator_id = '0c0570c0-0000-4000-8000-000000000007'`)).rows[0].t
  const g = async sql => (await db.query(`SELECT public.fn_red_mail_f2_link_strain(${sql}, NULL) AS x`)).rows[0].x
  ok(await g(`repeat('Q', 199) || '${tok}' || repeat('Q', 300)`) === true && await g(`repeat('Q', 64 * 3 + 5) || '${tok}'`) === true && await g(`repeat('Q', 64 * 3 + 5) || '${tok.slice(0, 42)}'`) === false,
    'tokenul existent găsit oriunde: în bucata a 4-a, în ultima bucată (parțială); 42 de caractere = nu')
  // EXPLAIN pe interogările exacte din migrare, cu o bucată reală de 64 de ferestre
  const qs = RX_Q_STRAIN.exec(MIG)?.[1], ql = RX_Q_LOT.exec(MIG)?.[1]
  ok(qs && ql && (MIG.match(/GROUP BY \(w\.o-1\)\/64 LOOP/g) || []).length === 2, 'interogările de căutare pe bucăți de 64 (detectorul + forma comună a lotului) există în migrare')
  if (qs && ql) {
    const buc = (await db.query(`SELECT f.ferestre[1:64] AS b FROM public.fn_red_mail_f2_link_forma(current_setting('crestere.t19000')) f`)).rows[0].b
    const arr = `ARRAY[${buc.map(lit).join(',')}]::text[]`
    const plan = async sql => (await db.query('EXPLAIN ' + sql)).rows.map(x => x['QUERY PLAN']).join('\n')
    const pS = await plan(qs.replace('ANY(buc)', `ANY(${arr})`).replace('p_token', 'NULL')), pL = await plan(ql.replace('ANY(v_buc)', `ANY(${arr})`))
    await db.exec(`PREPARE q_s(text[], text) AS ${qs.replace('ANY(buc)', 'ANY($1)').replace('p_token', '$2')}; PREPARE q_l(text[]) AS ${ql.replace('ANY(v_buc)', 'ANY($1)')}; SET plan_cache_mode = force_generic_plan;`)
    const gS = await plan(`EXECUTE q_s(${arr}, NULL)`), gL = await plan(`EXECUTE q_l(${arr})`)
    await db.exec('RESET plan_cache_mode')
    const peIndex = p => /Index (Only )?Scan|Bitmap Index Scan/.test(p) && /red_detinatori_token_token_raspuns_key/.test(p) && !/Seq Scan/.test(p)
    for (const [n, p] of [['detectorul, cu valori', pS], ['detectorul, generic', gS], ['forma comună, cu valori', pL], ['forma comună, generic', gL]]) {
      ok(peIndex(p), `EXPLAIN ${n}: indexul unic (${p.split('\n')[0].replace(/\s+\(cost.*$/, '')} / ${(p.match(/(Bitmap )?Index (Only )?Scan[^(]*/) || [''])[0].trim()})`)
      if (n.endsWith('cu valori') && process.argv.includes('--arata-planuri')) console.log(p.replace(/'\{[^}]*\}'/g, m => `'{… ${m.split(',').length} valori …}'`).replace(/^/gm, '        '))
    }
  }
  await db.close()
  if (argv('--cost-mig')) return
  // mutanții de CREȘTERE
  for (const [nume, lista] of [['fără conversia unică (forma r4 fără DISTINCT: subinterogarea aplatizată, conversia repetată pe fiecare fereastră)', [FARA_CONVERSIE_UNICA]]]) {
    let tm
    try { tm = recalculeaza(aplica(MIG, lista)) } catch (e) { ok(false, `${nume}: mutantul nu se aplică (${e.message})`); continue }
    let dbm
    try { dbm = await bazaCrestere(tm) } catch (e) { ok(false, `${nume}: mutantul nu se aplică (${e.message.slice(0, 120)})`); continue }
    const x = await masoaraCrestere(dbm)
    await dbm.close()
    ok(x[19000] > PRAG_19K_MS || x[76000] / x[19000] > RAPORT_CRESTERE, `MUTANT CREȘTERE ${nume} — ${JSON.stringify(x)}, ${rap(x)}`)
  }
  {
    const nume = 'fără bucăți (un singur = ANY(toate ferestrele), ca în r4)'
    const tm = aplica(MIG, [[BUC_STRAIN, ' RETURN EXISTS(SELECT 1 FROM public.red_detinatori_token t WHERE t.token_raspuns=ANY(v_fer) AND t.token_raspuns IS DISTINCT FROM p_token);'],
      [BUC_LOT, '  SELECT coalesce(array_agg(t.token_raspuns),ARRAY[]::text[]) INTO v_gasite0 FROM public.red_detinatori_token t WHERE t.token_raspuns=ANY(v_fer0);']])
    ok(!(RX_Q_STRAIN.test(tm) && RX_Q_LOT.test(tm)), `MUTANT CREȘTERE ${nume} — interogările pe bucăți lipsesc (verificarea structurală de mai sus pică)`)
  }
}

// ── manifestul L15: lista obiectelor (familie, etichetă, operație) = diferența generată de pașii runnerului ──
const listaObiecte = text => text.split('\n').filter(l => l && !l.startsWith('#')).map(l => l.split('\t').slice(0, 3).join('\t')).sort()
const faraPg18 = l => !/^constrangere\tconstrangere tabel [^\t]*_not_null\tcreat$/.test(l)

if (process.argv.includes('--doar-cost')) {
  await sectiuneaCrestere()
  await sectiuneaCost()
  console.log(esec ? `\nESEC: ${esec} verificări au picat` : '\nPASS: toate verificările au trecut')
  process.exit(esec ? 1 : 0)
}

console.log('1. înainte de 20261131i (20261131h aplicată = starea de pe main): textul lotului rămâne cu {LINK_RASPUNS} literal, inventarul nu știe de token, funcțiile noi lipsesc')
{
  const db = await bazaNoua()
  ok(await nrNoi(db) === 0 && (await checkJurnal(db) || '').includes("'optout'::text])") && !(await checkJurnal(db) || '').includes('campuri'), 'înainte: fără funcțiile noi, CHECK-ul jurnalului = 31a')
  ok(await amprentaFn(db, 'fn_red_mail_lot_creeaza') === 'a43632708f4d31f44c50f614c0b5456c' && await amprentaFn(db, 'fn_red_mail_rezerva') === 'd779e03d0644e437db412b0c3721e6c0', 'înainte: lot_creeaza = 31a, rezerva = 31h')
  const inv = (await destinatari(db, U.OWNER, P.TEST, UAT.A)).rows || []
  ok(inv.length === 8 && inv.every(x => !x.motive.includes('fara_token')), 'înainte (dovada pe main, SQL): deținătorii fără token / cu token expirat sunt „eligibili” — gaura pe care o închide migrarea')
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

// ── 2b. HANDLERUL REAL al funcției edge peste RPC-urile din PGlite (transportul Gmail fals; „pauza” de 2 s = ceasul ultimului apel mutat în urmă) ──
function depsPglite(db) {
  const trimise = []
  const raspuns = (status, body) => ({ status, ok: status < 300, json: async () => body })
  const fetch = async (url, init) => {
    if (url === GAZDA_OAUTH + '/token') return raspuns(200, { access_token: 'at-fictiv', expires_in: 3600, scope: 'https://www.googleapis.com/auth/gmail.send openid https://www.googleapis.com/auth/userinfo.email', token_type: 'Bearer' })
    if (url === GAZDA_GMAIL + '/gmail/v1/users/me/messages/send') { trimise.push(JSON.parse(init.body).raw); return raspuns(200, { id: 'gm-' + trimise.length, threadId: 'th-' + trimise.length }) }
    return raspuns(404, {})
  }
  const env = n => ({ REDARI_GMAIL_TRIMITERE_CLIENT_ID: 'client-fictiv.apps', REDARI_GMAIL_TRIMITERE_CLIENT_SECRET: 'secret-fictiv' })[n]
  // RPC-urile: ca owner, cu JWT (ca din funcția edge); eroarea RPC-ului = { error }, ca la supabase-js
  const rpc = async sql => { const r = await ca(db, 'authenticated', U.OWNER, sql); return r.code ? { error: { message: r.message } } : { data: r.rows[0]?.r ?? null } }
  const rand = async sql => ({ data: (await db.query(sql)).rows[0]?.r ?? null })
  return {
    trimise,
    getUser: async () => ({ data: { user: { id: U.OWNER } } }), owner: async () => ({ data: true }),
    lot: id => rand(`SELECT row_to_json(l) AS r FROM public.red_mail_loturi l WHERE l.id = '${id}'`),
    proiect: id => rand(`SELECT row_to_json(p) AS r FROM public.red_proiecte p WHERE p.id = '${id}'`),
    setari: () => rand(`SELECT row_to_json(s) AS r FROM public.red_mail_setari s WHERE s.id = 1`),
    informare: async () => ({ data: true }),
    secret: async () => ({ data: 'rt-fictiv' }),
    http: () => creeazaGmailHttp({ modul: 'gmailTrimitere', scop: 'trimitere', env, fetch }),
    opreste: async () => ({ data: true }),
    rezerva: async id => { const r = await ca(db, 'authenticated', U.OWNER, `SELECT row_to_json(m) AS r FROM public.fn_red_mail_rezerva('${id}') m`); return r.code ? { error: { message: r.message } } : { data: r.rows.map(x => x.r) } },
    incepe: (id, lease) => rpc(`SELECT public.fn_red_mail_apel_incepe('${id}', '${lease}') AS r`),
    rezultat: (id, lease, stare, gm, th) => rpc(`SELECT public.fn_red_mail_rezultat('${id}', '${lease}', ${lit(stare)}, ${gm == null ? 'NULL' : lit(gm)}, ${th == null ? 'NULL' : lit(th)}) AS r`),
    descarca: async () => { throw new Error('fara atasament in proba') },
    pauza: async () => { await db.exec(`UPDATE public.red_mail_setari SET ultim_apel_la = now() - interval '3 seconds' WHERE id = 1`) },
    mesaj: id => rand(`SELECT row_to_json(x) AS r FROM (SELECT stare FROM public.red_mail_mesaje WHERE id = '${id}') x`),
  }
}
console.log('2b. handlerul REAL (redariMailF2Handler.mjs) peste RPC-urile din PGlite: anulările locale nu opresc destinatarii valizi rămași (o singură apăsare)')
for (const [nume, pregateste, asteptat] of [
  ['ordinea „expirat, valid, valid”', async (db, q) => { await expira(db, q[0].detinator_id) }, { trimise: 2, rezervate: 2, stari: [['anulat', 'token_expirat'], ['trimis', null], ['trimis', null]] }],
  ['ordinea „opt-out, expirat, valid”', async (db, q) => { await optout(db, q[0].catre); await expira(db, q[1].detinator_id) }, { trimise: 1, rezervate: 1, stari: [['anulat', 'optout'], ['anulat', 'token_expirat'], ['trimis', null]] }],
  ['ordinea „valid, expirat, valid”', async (db, q) => { await expira(db, q[1].detinator_id) }, { trimise: 2, rezervate: 2, stari: [['trimis', null], ['anulat', 'token_expirat'], ['trimis', null]] }],
]) {
  const db = await bazaNoua()
  await aplicaMig(db)
  await porneste(db)
  const c = await creeaza(db, U.OWNER, LOT.A, P.TEST, UAT.A, [D.D1, D.D2, D.D3], SUBIECT, TEXT)
  if (c.code) { ok(false, `${nume}: lotul nu s-a creat: ${c.message}`); await db.close(); continue }
  await aproba(db, U.OWNER, LOT.A)
  const q = (await db.query(`SELECT id, detinator_id, catre FROM public.red_mail_mesaje WHERE lot_id = $1 ORDER BY id`, [LOT.A])).rows   // ordinea cozii = ordinea id-ului
  await pregateste(db, q)
  const d = depsPglite(db)
  const r = await raspundeTrimitere({ jwt: 'fictiv', corp: { lot_id: LOT.A } }, d)
  const st = (await db.query(`SELECT stare, eroare_cod FROM public.red_mail_mesaje WHERE lot_id = $1 ORDER BY id`, [LOT.A])).rows.map(m => [m.stare, m.eroare_cod])
  const corp = r.body || {}
  ok(r.status === 200 && corp.cod === 'rulat' && corp.trimise === asteptat.trimise && corp.rezervate === asteptat.rezervate && corp.esuate === 0 && corp.necunoscute === 0 && corp.neconfirmate === 0,
    `${nume}: o apăsare → ${JSON.stringify(corp)} (aștepta rulat, trimise ${asteptat.trimise}, rezervate ${asteptat.rezervate})`)
  ok(JSON.stringify(st) === JSON.stringify(asteptat.stari), `${nume}: stările mesajelor în ordinea cozii = ${JSON.stringify(st)}`)
  ok(d.trimise.length === asteptat.trimise, `${nume}: exact ${asteptat.trimise} apeluri Gmail (${d.trimise.length})`)
  // ce a plecat e snapshotul destinatarului lui: MIME-ul decodat conține linkul LUI și pe al nimănui altcuiva
  const mime = d.trimise.map(raw => Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('latin1'))
  const corpuri = mime.map(t => Buffer.from((t.split('\r\n\r\n')[2] || '').replace(/--.*$/s, '').replace(/\s+/g, ''), 'base64').toString('utf8'))
  const trimisi = q.filter((_, i) => st[i][0] === 'trimis').map(x => x.detinator_id)
  const tokDet = Object.fromEntries(Object.entries(D).map(([k, v]) => [v, T[k]]))
  ok(corpuri.length === trimisi.length && corpuri.every((t, i) => t.includes(LINK(tokDet[trimisi[i]])) && TOKENI.every(tk => tk === tokDet[trimisi[i]] || !t.includes(tk))),
    `${nume}: fiecare MIME trimis conține DOAR linkul destinatarului lui`)
  // r3: pe MIME-ul decodat (corp + subiect) forma de căutare nu are linkul / tokenul nimănui altcuiva (aceeași definiție ca serverul, toți tokenii
  //     fixture-ului), iar formele legitime (procentul, URL-ul străin procent-codificat) au plecat neatinse
  const subiecte = mime.map(t => (/^Subject: (.*(?:\r\n .*)*)/m.exec(t)?.[1] || '').split('\r\n ').map(w => Buffer.from(/=\?UTF-8\?B\?([^?]*)\?=/.exec(w)?.[1] || '', 'base64').toString('utf8')).join(''))
  ok(corpuri.length > 0 && corpuri.every((t, i) => !linkStrain(t, tokDet[trimisi[i]], TOKENI) && linkStrain(t, null, TOKENI) && t.includes(PLAN))
    && subiecte.every(s => s === SUBIECT_ASTEPTAT && !linkStrain(s, null, TOKENI)), `${nume}: MIME-ul decodat — niciun link / token străin în nicio formă, „100%” și „%20” neatinse, subiectul completat`)
  await db.close()
}
// r3: prin handlerul REAL, o cerere cu linkul altcuiva codificat nu ajunge niciodată la Gmail: crearea e refuzată în bază (link_literal / link_strain), deci
//     lotul nu există și apăsarea „Trimite” nu face niciun apel
{
  const db = await bazaNoua()
  await aplicaMig(db)
  await porneste(db)
  const r1 = await creeaza(db, U.OWNER, LOT.A, P.TEST, UAT.A, [D.D1, D.D2, D.D3], SUBIECT, `${LSC('n25_pct54_fara_cale').text}\n${TEXT}`)
  const r2 = await creeaza(db, U.OWNER, LOT.A, P.TEST, UAT.A, [D.D1, D.D2, D.D3], LSC('n13_cale_codificata').text, TEXT)
  await db.exec(`UPDATE public.red_uat SET nume = ${lit('Comuna %54' + T.D2.slice(1))} WHERE id = '${UAT.A}'`)
  const r3 = await creeaza(db, U.OWNER, LOT.A, P.TEST, UAT.A, [D.D1, D.D2, D.D3], SUBIECT, TEXT)
  const d = depsPglite(db)
  const r = await raspundeTrimitere({ jwt: 'fictiv', corp: { lot_id: LOT.A } }, d)
  ok(r1.code === '22023' && /link_literal/.test(r1.message) && r2.code === '22023' && /link_literal/.test(r2.message) && r3.code === '22023' && /link_strain/.test(r3.message)
    && await nrLoturi(db) === 0 && d.trimise.length === 0 && r.body?.trimise !== 1,
    `handlerul real după cererile cu tokenul lui D2 codificat (text, subiect, valoarea câmpului): ${[r1, r2, r3].map(x => x.code + ' ' + (x.message || '').slice(0, 20)).join(' | ')}; răspuns ${r.status} ${JSON.stringify(r.body)}; ${d.trimise.length} apeluri Gmail`)
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
  ['câmpul necunoscut acceptat (ramura scoasă)', [["  IF NOT (p_campuri ? nume) THEN RAISE EXCEPTION 'camp_necunoscut: %',left(nume,40) USING ERRCODE='22023'; END IF;\n", '']]],
  // ambele regex-uri (bucla și verificarea finală „nicio acoladă”): cu una singură schimbată, a doua prinde oricum (apărare în adâncime, mutant echivalent)
  ['forma câmpului doar cu majuscule (minusculele trec netulburate)', [["regexp_matches(p_text,'[{]([^{}]+)[}]','g')", "regexp_matches(p_text,'[{]([A-Z_]+)[}]','g')"],
    [" IF rez ~ '[{}]' THEN RAISE EXCEPTION 'camp_necunoscut: acolade ramase' USING ERRCODE='22023'; END IF;", " IF rez ~ '[{][A-Z_]+[}]' THEN RAISE EXCEPTION 'camp_necunoscut: acolade ramase' USING ERRCODE='22023'; END IF;"]]],
  // r2 (P2): limita veche a parserului (1–40) înapoi, în ambele locuri → numele de 41+ caractere trec netulburate
  ['limita veche de 40 de caractere (numele mai lungi trec)', [["regexp_matches(p_text,'[{]([^{}]+)[}]','g')", "regexp_matches(p_text,'[{]([^{}]{1,40})[}]','g')"],
    [" IF rez ~ '[{}]' THEN RAISE EXCEPTION 'camp_necunoscut: acolade ramase' USING ERRCODE='22023'; END IF;", " IF rez ~ '[{][^{}]{1,40}[}]' THEN RAISE EXCEPTION 'camp_necunoscut: acolade ramase' USING ERRCODE='22023'; END IF;"]]],
  ['verificarea finală a acoladelor scoasă („{}” și acoladele neînchise trec)', [[" IF rez ~ '[{}]' THEN RAISE EXCEPTION 'camp_necunoscut: acolade ramase' USING ERRCODE='22023'; END IF;\n", '']]],
  // r2 (P1): linkul literal — refuzul șablonului scos (verificarea finală prinde cu alt cod: refuz diferit), ambele scoase (linkul lui A pleacă și la B),
  //          tokenul copiat fără adresă nescăpat (lookup-ul scos); r4: textele mutate = codul liniar (forma de căutare + forma comună a lotului)
  ['refuzul linkului literal din șablon scos', [[" IF public.fn_red_mail_f2_link_strain(p_subiect,NULL) OR public.fn_red_mail_f2_link_strain(p_text,NULL) THEN RAISE EXCEPTION 'link_literal' USING ERRCODE='22023'; END IF;\n", '']]],
  ['linkul literal acceptat peste tot (refuzul șablonului ȘI verificarea mesajului final scoase)', [[" IF public.fn_red_mail_f2_link_strain(p_subiect,NULL) OR public.fn_red_mail_f2_link_strain(p_text,NULL) THEN RAISE EXCEPTION 'link_literal' USING ERRCODE='22023'; END IF;\n", ''],
    ["  IF v_strain THEN RAISE EXCEPTION 'link_strain' USING ERRCODE='22023'; END IF;\n", ''],
    [" IF public.fn_red_mail_f2_link_strain(subiect,NULL) THEN RAISE EXCEPTION 'link_strain' USING ERRCODE='22023'; END IF;\n", '']]],
  ['tokenul copiat fără adresă nu e văzut (lookup-ul în red_detinatori_token scos, în detector și în forma comună)', [[BUC_STRAIN, ' RETURN false;'], [BUC_LOT, '']]],
  // r4: forma comună a lotului — fiecare ramură a ei trebuie să conteze
  ['forma comună fără căutarea tokenurilor (tokenul altuia dintr-o valoare de câmp nu e văzut)', [[BUC_LOT, '']]],
  // r5: căutarea pe bucăți — fiecare bucată trebuie să conteze (tokenul altuia după primele 64 de ferestre: cazurile C r5)
  ['detectorul: doar prima bucată de ferestre', [['FROM unnest(v_fer) WITH ORDINALITY', 'FROM unnest(v_fer[1:64]) WITH ORDINALITY']]],
  ['forma comună: doar prima bucată de ferestre', [['FROM unnest(v_fer0) WITH ORDINALITY', 'FROM unnest(v_fer0[1:64]) WITH ORDINALITY']]],
  ['detectorul: ultima bucată (parțială) ignorată', [['GROUP BY (w.o-1)/64 LOOP\n  IF EXISTS', 'GROUP BY (w.o-1)/64 HAVING count(*)=64 LOOP\n  IF EXISTS']]],
  ['forma comună: ultima bucată (parțială) ignorată', [['GROUP BY (w.o-1)/64 LOOP\n   v_gasite0', 'GROUP BY (w.o-1)/64 HAVING count(*)=64 LOOP\n   v_gasite0']]],
  ['forma comună folosită fără comparația cu mesajul (diferențele de după completare nu mai trec prin detectorul complet)', [["  IF v_x0 IS NOT NULL AND replace(msg.corp_text_final,public.fn_red_link_raspuns(tok),'#')=v_x0 THEN\n", '  IF v_x0 IS NOT NULL THEN\n']]],
  ['forma comună fără prinderea refuzului (reluarea idempotentă a unei intenții existente refuzată înainte de lock)', [[" EXCEPTION WHEN OTHERS THEN v_x0:=NULL; v_cale0:=NULL; v_fer0:=NULL;\n", '']]],
  ['forma comună fără cale (calea formularului dintr-o valoare de câmp nu e văzută)', [['   v_strain:=v_cale0 OR EXISTS(', '   v_strain:=coalesce(v_cale0 AND false,false) OR EXISTS(']]],
  ['linkul străin pe altă origine nu e văzut (doar domeniul public)', [["position('redari/raspuns' IN pc)>0", "position('redari.gazpet.ro/redari/raspuns' IN pc)>0"]]],
  ['linkul străin comparat fără token (orice cale = a destinatarului)', [[' IF v_cale THEN RETURN true; END IF;', ' IF v_cale AND p_token IS NULL THEN RETURN true; END IF;'], ['   v_strain:=v_cale0 OR EXISTS(', '   v_strain:=EXISTS(']]],
  // r3 (Jakarinos #1138 P1): mutanți pe NORMALIZARE — fiecare trebuie să pice (la postcondiții sau pe paritatea cu tabelul comun / refuzurile C r3)
  ['fără decodarea %XX (căutarea pe textul literal, ca în runda 2)', [["CASE WHEN q.c BETWEEN 33 AND 126 THEN chr(q.c) ELSE '' END AS x", 'r.m[1] AS x']]],
  ['fără decodarea entităților HTML', [["(SELECT CASE WHEN n.c BETWEEN 33 AND 126 THEN chr(n.c) ELSE '' END\n", '(SELECT r.m[1]\n'], ["ELSE coalesce(entitati->>substring(r.m[1] FROM 2 FOR length(r.m[1])-2),'') END AS x", 'ELSE r.m[1] END AS x']]],
  ['fără eliminarea invizibilelor (spații, linii, zero-width)', [["  v:=regexp_replace(regexp_replace(v,c_inviz,'','g'),c_lin,'-','g');", "  v:=regexp_replace(v,c_lin,'-','g');"]]],
  ['fără NFKC', [[' v:=normalize(p_text,NFKC);', ' v:=p_text;']]],
  ['un singur pas de decodare (fără punct fix)', [['  IF v=ant THEN stabil:=true; EXIT; END IF;', '  stabil:=true; EXIT;']]],
  ['doar prima fereastră (tokenul lipit de text nu e văzut)', [['generate_series(1,octet_length(s.b)-42) i', 'generate_series(1,1) i']]],
  ['calea cu majuscule nu e văzută (fără litere mici)', [["pc:=replace(translate(v,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'\\','/');", "pc:=replace(v,'\\','/');"]]],
  // r2 (P2): rezervarea se oprește la prima anulare locală (RETURN în loc de CONTINUE) → handlerul s-ar opri la zero rânduri înaintea destinatarilor valizi
  ['rezervarea se oprește la token expirat (RETURN în loc de CONTINUE)', [["PERFORM public.fn_red_mail_f2_audit(l.id,m.id,'anulat'); CONTINUE; END IF;", "PERFORM public.fn_red_mail_f2_audit(l.id,m.id,'anulat'); RETURN; END IF;"]]],
  ['rezervarea se oprește la opt-out (RETURN în loc de CONTINUE)', [["UPDATE public.red_mail_mesaje SET stare='anulat',eroare_cod='optout' WHERE id=m.id; CONTINUE; END IF;", "UPDATE public.red_mail_mesaje SET stare='anulat',eroare_cod='optout' WHERE id=m.id; RETURN; END IF;"]]],
  ['câmpul fără valoare completat cu gol', [["  IF v IS NULL OR btrim(v)='' THEN RAISE EXCEPTION 'camp_necompletabil: %',nume USING ERRCODE='22023'; END IF;\n", "  v:=coalesce(v,'');\n"]]],
  ['inventarul fără fara_token', [[",\n -- 20261131i: fără link personal valid (token lipsă / expirat) = exclus din lot\n CASE WHEN public.fn_red_mail_f2_token(d.id) IS NULL THEN 'fara_token' END\n", '\n']]],
  ['crearea fără refuzul destinatarilor fără token (ambele verificări)', [[" IF EXISTS(SELECT 1 FROM unnest(p_destinatari) x WHERE public.fn_red_mail_f2_token(x) IS NULL) THEN RAISE EXCEPTION 'destinatari_neeligibili'; END IF;\n", ''],
    ["  IF tok IS NULL OR public.fn_red_link_raspuns(tok) IS NULL THEN RAISE EXCEPTION 'destinatari_neeligibili'; END IF;\n", "  tok:=coalesce(tok,repeat('z',43));\n"]]],
  ['tokenul valid fără expirare', [['AND (t.token_expira_la IS NULL OR now()<=t.token_expira_la)\n', '\n']]],
  ['rezervarea fără oprirea la token expirat', [["  IF public.fn_red_mail_f2_token(m.detinator_id) IS NULL THEN UPDATE public.red_mail_mesaje SET stare='anulat',eroare_cod='token_expirat' WHERE id=m.id; PERFORM public.fn_red_mail_f2_audit(l.id,m.id,'anulat'); CONTINUE; END IF;\n", '']]],
  ['autorizarea apelului fără oprirea la token expirat', [[" IF public.fn_red_mail_f2_token(m.detinator_id) IS NULL THEN UPDATE public.red_mail_mesaje SET stare='anulat',eroare_cod='token_expirat' WHERE id=m.id; PERFORM public.fn_red_mail_f2_audit(l.id,m.id,'anulat'); RETURN false; END IF;\n", '']]],
  ['programul luat din prima zi chiar dacă zilele diferă', [["  v_program:=CASE WHEN programe[1]<>'' AND (SELECT count(DISTINCT x) FROM unnest(programe) x)=1 THEN programe[1] END;", "  v_program:=nullif(programe[1],'');"]]],
  ['câmpurile acordate și lui anon', [['GRANT EXECUTE ON FUNCTION public.fn_red_mail_f2_campuri(uuid,uuid) TO authenticated;', 'GRANT EXECUTE ON FUNCTION public.fn_red_mail_f2_campuri(uuid,uuid) TO authenticated, anon;']]],
  ['fn_red_mail_f2_campuri fără poarta owner', [[" PERFORM public.fn_red_mail_f2_owner();\n IF p_proiect IS NULL OR p_uat IS NULL THEN RAISE EXCEPTION 'cerere_invalida' USING ERRCODE='22023'; END IF;\n SELECT * INTO u", " IF p_proiect IS NULL OR p_uat IS NULL THEN RAISE EXCEPTION 'cerere_invalida' USING ERRCODE='22023'; END IF;\n SELECT * INTO u"]]],
  ['CHECK-ul jurnalului fără `campuri`', [["'lot_sters_final','setari','optout','campuri'));", "'lot_sters_final','setari','optout'));"]]],
  ['linkul pe alt domeniu', [["'https://redari.gazpet.ro/redari/raspuns/'||p_token", "'https://pontaj-pro-sooty.vercel.app/redari/raspuns/'||p_token"]]],
  ['jurnalul `campuri` nescris (urma L14 lipsă)', [[" PERFORM public.fn_red_mail_f2_audit(p_operatie,NULL,'creat'); PERFORM public.fn_red_mail_f2_audit(p_operatie,NULL,'campuri'); RETURN p_operatie;", " PERFORM public.fn_red_mail_f2_audit(p_operatie,NULL,'creat'); RETURN p_operatie;"]]],
]
// r3: mutanții pe normalizare prinși deja de postcondiția link_strain se rulează și CU postcondiția scoasă din textul mutat — trebuie să-i prindă și
//     verificările de comportament (paritatea cu tabelul comun, refuzurile C r3, mesajul final)
// (r4: tăierea cuprinde și postcondiția formei de căutare, care urmează imediat)
const POST_LS_A = '  -- r2 + r3: linkul străin (valori fictive)', POST_LS_B = "RAISE EXCEPTION '20261131i: postconditie: fn_red_mail_f2_link_forma';\n  END IF;\n"
const faraPostLs = t => { const a = t.indexOf(POST_LS_A), b = t.indexOf(POST_LS_B, a); if (a < 0 || b < 0) throw new Error('postcondiția link_strain lipsește'); return t.slice(0, a) + t.slice(b + POST_LS_B.length) }
for (const nume of ['fără decodarea %XX (căutarea pe textul literal, ca în runda 2)', 'fără decodarea entităților HTML', 'fără eliminarea invizibilelor (spații, linii, zero-width)',
  'un singur pas de decodare (fără punct fix)', 'calea cu majuscule nu e văzută (fără litere mici)']) {
  const m = MUTANTI.find(x => x[0] === nume)
  MUTANTI.push([nume + ' — FĂRĂ postcondiția link_strain', m[1], faraPostLs])
}
{ // martorul: migrarea REALĂ fără postcondiția link_strain trece toate verificările (deci mutanții de mai jos sunt prinși de comportament, nu de tăiere)
  const db = await bazaNoua()
  const m = await eroare(aplicaMig(db, recalculeaza(faraPostLs(MIG))))
  const ab = m ? [m] : await verifica(db)
  ok(ab.length === 0, `martor: migrarea reală fără postcondiția link_strain — ${ab.length} abateri ${ab[0] ? '(' + ab[0].slice(0, 120) + ')' : ''}`)
  await db.close()
}
for (const [nume, lista, transforma] of MUTANTI) {
  const db = await bazaNoua()
  let t
  try { t = recalculeaza((transforma || (x => x))(aplica(MIG, lista))) } catch (e) { ok(false, `${nume}: mutantul nu se aplică (${e.message})`); await db.close(); continue }
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

await sectiuneaCrestere()
await sectiuneaCost()

console.log(esec ? `\nESEC: ${esec} verificări au picat` : '\nPASS: toate verificările au trecut')
process.exit(esec ? 1 : 0)
