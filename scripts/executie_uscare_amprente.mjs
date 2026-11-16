// Amprentele (md5 al corpului fără CR, ca md5(replace(prosrc, chr(13), '')) din BD) ale funcțiilor create de 20261225a, citite din fișierul
// migrării. Folosit de revenire (blocul AMPRENTE-START / -END, verificat de scripts/pglite/test_executie_uscare_local.mjs) și la review.
// Rulare (din rădăcina repo-ului): node scripts/executie_uscare_amprente.mjs [--actualizeaza-revenire]
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const MIGRARE = join(ROOT, 'supabase/migrations/20261225a_executie_uscare.sql')
/** [nume, semnătura, limbajul, SECURITY DEFINER] — cele 17 funcții ale migrării, în ordinea din revenire */
export const SEMNATURI = [
  ['fn_executie_uscare_utilaje_ok', 'jsonb', 'sql', false], ['fn_executie_uscare_cantariri_ok', 'jsonb', 'sql', false],
  ['fn_executie_uscare_meteo_ok', 'jsonb', 'sql', false], ['fn_executie_uscare_poze_lipsa', 'public.executie_uscari, jsonb', 'sql', false],
  ['fn_executie_uscare_lipsa', 'public.executie_uscari, jsonb, integer', 'sql', false], ['fn_executie_uscare_lipsa_raport', 'public.executie_uscari', 'sql', false],
  ['fn_executie_uscare_tranzitie', 'text, text', 'sql', false], ['fn_executie_uscare_garda', '', 'plpgsql', false],
  ['fn_executie_uscare_poza_garda', '', 'plpgsql', false], ['fn_executie_uscare_incarcare_garda', '', 'plpgsql', false],
  ['fn_executie_uscare_jurnal_garda', '', 'plpgsql', false], ['fn_executie_uscare_fara_golire', '', 'plpgsql', false],
  ['fn_executie_uscare_salveaza', 'bigint, bigint, integer, jsonb, uuid', 'plpgsql', true], ['fn_executie_uscare_stare', 'bigint, integer, text, text, uuid', 'plpgsql', true],
  ['fn_executie_uscare_poza', 'bigint, text, bigint, text, text, integer, text, uuid', 'plpgsql', true], ['fn_executie_uscare_obiect', 'text, text, boolean', 'sql', true],
  ['fn_executie_uscare_retrage', 'bigint, uuid', 'plpgsql', true],
]
export const FUNCTII = SEMNATURI.map(s => s[0])

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
/** blocul AMPRENTE al revenirii, generat din migrare (aceleași rânduri, aceeași formă) */
export function blocRevenire(text = readFileSync(MIGRARE, 'utf8')) {
  const a = amprente(text)
  return SEMNATURI.map(([n, sem, limbaj, def]) => `        ('public.${n}(${sem})', '${limbaj}', ${def}, '${a[n]}'),`).join('\n')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = amprente()
  for (const [n, x] of Object.entries(a)) console.log(x + '  ' + n)
  // --actualizeaza-revenire: rescrie blocul AMPRENTE al revenirii (păstrează finalurile de rând ale fișierului)
  if (process.argv.includes('--actualizeaza-revenire')) {
    const { writeFileSync } = await import('node:fs')
    const t = readFileSync(REVENIRE, 'utf8')
    const nl = t.includes('\r\n') ? '\r\n' : '\n'
    const i = t.indexOf('-- AMPRENTE-START'), j = t.indexOf('        -- AMPRENTE-END')
    if (i < 0 || j < 0) throw new Error('blocul AMPRENTE lipsește din revenire')
    const s = t.indexOf('\n', i) + 1
    writeFileSync(REVENIRE, t.slice(0, s) + blocRevenire().split('\n').join(nl) + nl + t.slice(j))
    console.log('revenirea actualizată')
  }
}
