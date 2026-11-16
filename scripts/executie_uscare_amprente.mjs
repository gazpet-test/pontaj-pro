// Amprentele (md5 al corpului fără CR, ca md5(replace(prosrc, chr(13), '')) din BD) ale funcțiilor create de 20261225a, citite din fișierul
// migrării. Folosit de revenire (blocul AMPRENTE-START / -END, verificat de scripts/pglite/test_executie_uscare_local.mjs) și la review.
// Rulare (din rădăcina repo-ului): node scripts/executie_uscare_amprente.mjs
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const MIGRARE = join(ROOT, 'supabase/migrations/20261225a_executie_uscare.sql')
export const FUNCTII = ['fn_executie_uscare_utilaje_ok', 'fn_executie_uscare_cantariri_ok', 'fn_executie_uscare_lipsa', 'fn_executie_uscare_tranzitie',
  'fn_executie_uscare_garda', 'fn_executie_uscare_poza_garda', 'fn_executie_uscare_jurnal_garda', 'fn_executie_uscare_fara_golire',
  'fn_executie_uscare_salveaza', 'fn_executie_uscare_stare', 'fn_executie_uscare_poza', 'fn_executie_uscare_obiect']

/** corpul (între delimitatorii $…$) al funcției `nume` din text, fără CR */
export function corpFunctie(text, nume) {
  const t = text.replace(/\r/g, '')
  const cap = 'CREATE FUNCTION public.' + nume + '('
  const i = t.indexOf(cap)
  if (i < 0) throw new Error('nu găsesc ' + nume)
  const a = /\bAS\s+(\$[A-Za-z_]*\$)/.exec(t.slice(i))
  const st = i + a.index + a[0].length
  return t.slice(st, t.indexOf(a[1], st))
}
export const md5 = s => createHash('md5').update(s, 'utf8').digest('hex')
export function amprente(text = readFileSync(MIGRARE, 'utf8')) {
  return Object.fromEntries(FUNCTII.map(n => [n, md5(corpFunctie(text, n))]))
}

export const REVENIRE = join(ROOT, 'supabase/revenire/20261225a_executie_uscare_ROLLBACK.sql')
/** amprentele scrise în blocul AMPRENTE al revenirii: { nume: md5 } */
export function amprenteRevenire(text = readFileSync(REVENIRE, 'utf8')) {
  const t = text.replace(/\r/g, '')
  const bloc = t.slice(t.indexOf('-- AMPRENTE-START'), t.indexOf('-- AMPRENTE-END'))
  return Object.fromEntries([...bloc.matchAll(/\('public\.([a-z_]+)\([^']*\)', '[a-z]+', (?:true|false), '([0-9a-f]{32})'\)/g)].map(m => [m[1], m[2]]))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = amprente()
  for (const [n, x] of Object.entries(a)) console.log(x + '  ' + n)
  // --actualizeaza-revenire: rescrie amprentele din blocul revenirii (păstrează finalurile de rând ale fișierului)
  if (process.argv.includes('--actualizeaza-revenire')) {
    const { writeFileSync } = await import('node:fs')
    let t = readFileSync(REVENIRE, 'utf8')
    for (const [n, x] of Object.entries(a)) {
      const re = new RegExp(`(\\('public\\.${n}\\([^']*\\)', '[a-z]+', (?:true|false), ')[0-9a-f]{32}('\\))`)
      if (!re.test(t)) throw new Error('nu găsesc rândul revenirii pentru ' + n)
      t = t.replace(re, `$1${x}$2`)
    }
    writeFileSync(REVENIRE, t)
    console.log('revenirea actualizată')
  }
}
