// Analiza STATICĂ a fișierelor SQL ale registrului DCC (20270108a), fără nicio bază de date:
//   1. sintaxa: fiecare fișier se parsează cu libpg-query 17.8.2 (gramatica PG17, ca producția); variabilele psql (:'x' / :x) și meta-comenzile
//      psql (linii care încep cu „\”) se neutralizează înainte (sunt ale clientului, nu ale serverului);
//   2. corpurile plpgsql (CREATE FUNCTION … LANGUAGE plpgsql și blocurile DO) se parsează cu parsePlPgSQL din libpg-query 18.2.2 (17 nu-l exportă);
//   3. regula „fără DML pe app_modules / user_module_access” (planul, „Lock-urile migrării”, partea 2): nicio instrucțiune INSERT / UPDATE /
//      DELETE / MERGE / TRUNCATE / COPY cu ținta app_modules sau user_module_access — nici la nivel superior, nici în corpurile plpgsql / sql
//      (corpurile se re-parsează ca SQL: fiecare instrucțiune SQL din plpgsql apare ca PLpgSQL_stmt_execsql / dynexecute cu textul ei);
//   4. migrarea: fără BOM, fără CR, fără `U&'`, iar parametrii protejați ai runnerului apar doar în citirea plafonului (validatorul runnerului
//      o verifică separat, scripts/livrare_validator.py).
// stmt_location / stmt_len sunt în OCTEȚI (UTF-8): feliile se fac pe Buffer, nu pe șir.
// Rulare (unelte instalate fără salvare, o singură instalare): npm install --no-save pgq17@npm:libpg-query@17.8.2 pgq18@npm:libpg-query@18.2.2
//   node scripts/pglite/sql_static_dcc.mjs <fișier.sql> [<fișier.sql> …]   -> ieșire 0 = toate OK, 1 = cel puțin un refuz
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const pg17 = require('pgq17')
const pg18 = require('pgq18')
const TINTE = /^(app_modules|user_module_access)$/i
const fisiere = process.argv.slice(2)
if (!fisiere.length) { console.log('utilizare: node scripts/pglite/sql_static_dcc.mjs <fisier.sql> …'); process.exit(2) }

let esec = 0
const nu = msg => { esec++; console.log('  NU  ' + msg) }
const da = msg => console.log('  OK  ' + msg)

// variabilele și meta-comenzile psql -> neutre (aceeași lungime nu contează: locațiile se raportează pe textul neutralizat)
const neutralizeaza = t => t.split('\n').map(l => (/^\s*\\/.test(l) ? '-- ' + l : l)).join('\n').replace(/:'[A-Za-z_][A-Za-z0-9_]*'/g, "'psql_var'")
  .replace(/(^|[^:]):([A-Za-z_][A-Za-z0-9_]*)\b(?!:)/g, (m, a, b) => (/^(text|jsonb|regclass|int|integer|bigint|numeric|uuid|boolean)$/.test(b) ? m : `${a}'psql_var'`))

// colectează recursiv nodurile care au o țintă de DML (RangeVar în relation) și numele relației
function tinteDml(nod, acc = []) {
  if (Array.isArray(nod)) { for (const x of nod) tinteDml(x, acc); return acc }
  if (!nod || typeof nod !== 'object') return acc
  for (const [k, v] of Object.entries(nod)) {
    if (['InsertStmt', 'UpdateStmt', 'DeleteStmt', 'MergeStmt'].includes(k) && v?.relation?.relname) acc.push([k, v.relation.relname])
    if (k === 'TruncateStmt') for (const r of v?.relations || []) if (r?.RangeVar?.relname) acc.push([k, r.RangeVar.relname])
    if (k === 'CopyStmt' && v?.relation?.relname && v.is_from) acc.push([k, v.relation.relname])
    tinteDml(v, acc)
  }
  return acc
}
// textele SQL din arborele plpgsql (instrucțiuni execsql / expresii / dynexecute cu șir constant)
function sqlDinPlpgsql(nod, acc = []) {
  if (Array.isArray(nod)) { for (const x of nod) sqlDinPlpgsql(x, acc); return acc }
  if (!nod || typeof nod !== 'object') return acc
  for (const [k, v] of Object.entries(nod)) {
    if (k === 'query' && typeof v === 'string') acc.push(v)
    sqlDinPlpgsql(v, acc)
  }
  return acc
}

await pg17.loadModule(); await pg18.loadModule()
for (const f of fisiere) {
  console.log(f)
  const brut = readFileSync(f)
  if (brut[0] === 0xef && brut[1] === 0xbb && brut[2] === 0xbf) nu('BOM la început (psql pică)')
  const text = brut.toString('utf8')
  if (/^\s*--\s*Version [0-9]{14}/.test(text) && text.includes('\r')) nu('CR în migrare (finalurile de linie trebuie să fie LF)')
  if (/U&'/.test(text)) nu("U&'…' (validatorul runnerului îl refuză)")
  // doar fișierele rulate cu psql (dry-run, istoricul clonei) au variabile / meta-comenzi psql; migrarea și revenirea se parsează EXACT
  const deParsat = /(^|\n)[ \t]*\\|:'[A-Za-z_]/.test(text) ? neutralizeaza(text) : text
  let arbore
  try { arbore = pg17.parseSync(deParsat); da(`sintaxa PG17: ${arbore.stmts.length} instrucțiuni${deParsat === text ? '' : ' (variabilele psql neutralizate)'}`) } catch (e) { nu(`sintaxa PG17: ${e.message}`); continue }
  const buf = Buffer.from(deParsat, 'utf8')
  let corpuri = 0, rele = 0
  const dml = tinteDml(arbore.stmts)
  for (const s of arbore.stmts) {
    const st = s.stmt
    const loc = s.stmt_location || 0
    const felie = buf.subarray(loc, loc + (s.stmt_len || buf.length - loc)).toString('utf8')
    const fn = st.CreateFunctionStmt
    const doS = st.DoStmt
    let lang = null, corp = null
    if (fn) {
      for (const o of fn.options || []) {
        const d = o.DefElem
        if (d?.defname === 'language') lang = d.arg?.String?.sval
        if (d?.defname === 'as') corp = d.arg?.List?.items?.[0]?.String?.sval
      }
    } else if (doS) {
      lang = 'plpgsql'
      for (const o of doS.args || []) if (o.DefElem?.defname === 'as') corp = o.DefElem.arg?.String?.sval
    }
    if (!corp) continue
    corpuri++
    if (lang === 'plpgsql') {
      try {
        const p = pg18.parsePlPgSQLSync(fn ? felie : `CREATE FUNCTION pg_temp.f() RETURNS void LANGUAGE plpgsql AS $corp$${corp}$corp$;`)
        for (const q of sqlDinPlpgsql(p)) {
          try { dml.push(...tinteDml(pg17.parseSync(q).stmts)) } catch { /* expresie, nu instrucțiune */ }
        }
      } catch (e) { rele++; nu(`corp plpgsql neparsabil (${fn ? fn.funcname.map(x => x.String.sval).join('.') : 'DO'}): ${e.message}`) }
    } else if (lang === 'sql') {
      try { dml.push(...tinteDml(pg17.parseSync(corp).stmts)) } catch (e) { rele++; nu(`corp sql neparsabil: ${e.message}`) }
    }
  }
  if (!rele) da(`${corpuri} corpuri de funcții / blocuri DO parsate`)
  const interzise = dml.filter(([, r]) => TINTE.test(r))
  // regula privește migrarea și revenirea; dry-run-ul clonei creează identități sintetice într-o tranzacție ANULATĂ (ROLLBACK), deci e raportat, nu refuzat
  if (!/supabase[\\/](migrations|revenire)[\\/]/.test(f)) da(`fișier de probă (nu migrare / revenire): ${interzise.length} DML pe app_modules / user_module_access, în tranzacția lui anulată`)
  else if (interzise.length) nu(`DML pe app_modules / user_module_access: ${interzise.map(x => x.join(' ')).join(', ')}`)
  else da(`fără DML pe app_modules / user_module_access (${dml.length} ținte DML verificate)`)
}
console.log(`\n${fisiere.length} fișiere, ${esec} refuzuri`)
process.exit(esec ? 1 : 0)
