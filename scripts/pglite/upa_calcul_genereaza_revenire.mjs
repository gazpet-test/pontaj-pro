// Generatorul revenirii 20270101a (rulat o dată, rezultatul e revizuit în PR; proba PGlite verifică textul):
//   (1) blocul AMPRENTA din migrare -> revenire (identic, între marcajele AMPRENTA_20270101a_INCEPUT / _SFARSIT);
//   (2) cele 5 funcții din 20261229a înlocuite de 20270101a -> revenire, copiate EXACT (CREATE FUNCTION -> CREATE OR REPLACE FUNCTION);
//   (3) cu --constanta <md5>: constanta amprentei în ambele fișiere.
// Rulare (din rădăcina repo-ului): node scripts/pglite/upa_calcul_genereaza_revenire.mjs [--constanta <md5>] [--jurnal <md5 fel>,<md5 forma>]
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const F_MIG = join(ROOT, 'supabase/migrations/20270101a_administrativ_upa_calcul.sql')
const F_REV = join(ROOT, 'supabase/revenire/20270101a_administrativ_upa_calcul_ROLLBACK.sql')
const F_A = join(ROOT, 'supabase/migrations/20261229a_administrativ_upa_alerta.sql')
const lf = f => readFileSync(f, 'utf8').replace(/\r/g, '')
let mig = lf(F_MIG), rev = lf(F_REV)
const A = lf(F_A)

const INC = '  -- AMPRENTA_20270101a_INCEPUT', SF = '  -- AMPRENTA_20270101a_SFARSIT'
const bloc = t => { const i = t.indexOf(INC), j = t.indexOf(SF); if (i < 0 || j < 0) return null; return t.slice(i, j + SF.length) }
const bm = bloc(mig)
if (!bm) throw new Error('migrarea nu are blocul AMPRENTA')
if (rev.includes('  -- @@AMPRENTA@@')) rev = rev.replace('  -- @@AMPRENTA@@', bm)
else { const br = bloc(rev); if (!br) throw new Error('revenirea nu are blocul AMPRENTA'); rev = rev.replace(br, bm) }

// runda 2: fn_upa_campuri_intentie nu mai e înlocuită (amprenta v2 e o funcție nouă); triggerul fn_upa_achizitii_intentie da
const FUNCTII = ['fn_upa_achizitii_intentie()', 'fn_upa_achizitie_adauga(', 'fn_upa_alerta_inscrie(', 'fn_upa_alerta_rezerva_la(', 'fn_upa_alerta_proba()']
const ref = FUNCTII.map(sig => {
  const i = A.indexOf('CREATE FUNCTION public.' + sig)
  if (i < 0) throw new Error('lipsește în 20261229a: ' + sig)
  const a0 = A.indexOf('$f$', i) + 3
  const j = A.indexOf('$f$;', a0) + '$f$;'.length
  return 'CREATE OR REPLACE FUNCTION' + A.slice(i + 'CREATE FUNCTION'.length, j)
}).join('\n')
const R0 = '-- @@REFACERE@@', RI = '-- REFACERE_20261229a_INCEPUT', RS = '-- REFACERE_20261229a_SFARSIT'
const bucata = `${RI}\n${ref}\n${RS}`
if (rev.includes(R0)) rev = rev.replace(R0, bucata)
else { const i = rev.indexOf(RI), j = rev.indexOf(RS); if (i < 0 || j < 0) throw new Error('revenirea nu are blocul REFACERE'); rev = rev.slice(0, i) + bucata + rev.slice(j + RS.length) }

const k = process.argv.indexOf('--constanta')
if (k > 0) {
  const c = process.argv[k + 1]
  if (!/^[0-9a-f]{32}$/.test(c || '')) throw new Error('constanta invalidă')
  const inloc = t => t.replace(/(IF md5\(coalesce\(v_amp, ''\)\) IS DISTINCT FROM ')[0-9a-f]{32}(' THEN\n    RAISE NOTICE 'AMPRENTA_20270101a_TEXT)/, `$1${c}$2`)
    .replace(/(AMPRENTA obiectelor % \(asteptat )[0-9a-f]{32}\)/, `$1${c})`)
  mig = inloc(mig); rev = inloc(rev)
}
// (4) cu --jurnal <md5 fel>,<md5 forma_cheie>: amprentele CHECK-urilor upa_alerta_jurnal din 20261229a (preflight-ul migrării + post-ul revenirii)
const kj = process.argv.indexOf('--jurnal')
if (kj > 0) {
  const [f, c] = String(process.argv[kj + 1] || '').split(',')
  if (!/^[0-9a-f]{32}$/.test(f || '') || !/^[0-9a-f]{32}$/.test(c || '')) throw new Error('--jurnal <md5>,<md5>')
  const inloc = t => t.replace(/upa_alerta_jurnal_fel=(@@FEL_VECHI@@|[0-9a-f]{32}),upa_alerta_jurnal_forma_cheie=(@@FORMA_VECHE@@|[0-9a-f]{32})/g,
    `upa_alerta_jurnal_fel=${f},upa_alerta_jurnal_forma_cheie=${c}`)
  mig = inloc(mig); rev = inloc(rev)
}
// fișierele repo-ului sunt CRLF în copia de lucru (git le normalizează)
writeFileSync(F_MIG, mig.replace(/\n/g, '\r\n'))
writeFileSync(F_REV, rev.replace(/\n/g, '\r\n'))
console.log('ok: bloc', bm.length, 'caractere; refacere', ref.length, 'caractere')
