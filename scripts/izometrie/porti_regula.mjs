// REGULA porților Izometrie — detectorul (docs/izometrie/PORTI_RECONCILIERE.md, secțiunea „Regula”). Fără dependențe (doar node):
//   node scripts/izometrie/porti_regula.mjs                 → verifică toate fișierele din supabase/migrations + supabase/revenire; cod 1 la abatere
//   node scripts/izometrie/porti_regula.mjs --radacina <R>  → la fel, pe alt arbore (testele)
// Rulat AUTOMAT în CI la orice PR care atinge migrările, revenirile sau detectorul (.github/workflows/izometrie-porti-regula.yml).
//
// Ce face, pe fiecare fișier care nu e în lista veche (supabase/tests/izo_porti_regula_vechi.tsv, cu sha256 pe textul fără CR):
//   1. scoate comentariile cu un lexer SQL (-- și /* */ imbricate; literalii '…', E'…', "…" și corpurile $tag$ … $tag$ recunoscute;
//      corpurile se lexează la rândul lor, ca la PostgreSQL) — textul din comentarii nu contează nici ca schimbare, nici ca verificare;
//   1b. golește literalii folosiți ca DATE (un text returnat / inserat / comentat nu e DDL); cei care pot fi executați (EXECUTE,
//      corp de funcție / DO în '…', \gexec, argument al unei funcții necunoscute, ::regclass) rămân (detaliile la 1b, mai jos);
//   2. găsește instrucțiunile care ATING perimetrul amprentat de porți (CREATE / ALTER / DROP / GRANT / REVOKE / trigger / politică /
//      index / regulă / proprietar / redenumire, pe nume; SQL dinamic cu ținta necunoscută; funcții DEFINER cu SQL dinamic; obiecte care
//      numesc registrul sau cheamă fn_izo_*; drepturi pe secvențe / pe tot schema; DML pe storage.buckets / catalog);
//   3. dacă atinge, cere STRUCTURA, în ordinea asta, în blocuri DO (fără EXCEPTION WHEN, fără COMMIT / ROLLBACK înainte de POST):
//      PRE   `IF public.fn_izo_porti_lipsa() IS DISTINCT FROM '{}'::text[] THEN RAISE EXCEPTION …` ÎNAINTEA primei atingeri;
//      cele 5 ștampile CALCULATE, după ultima atingere:
//            `EXECUTE format('COMMENT ON FUNCTION public.<f>() IS %L', '<prefix>=' || public.<f>());`
//      POST  aceeași gardă după ultima ștampilă;
//      nicio ștampilă literală / necanonică (orice alt COMMENT ON FUNCTION pe cele 5 funcții = refuz).
//   Excepție: un rând `-- IZO_PORTI: neatins — <motiv de cel puțin 10 caractere>` la început de rând, DOAR dacă toate atingerile sunt
//   „posibile” (ex. o coloană nouă pe profiles); la o atingere „sigură” (obiect izo / fn_izo_*, trigger-ele de pe tabelele E4, funcțiile
//   trigger-elor amprentate, secvențe, ținte dinamice …) excepția nu se acceptă: se face ritualul (e ieftin și sigur).
// LIMITA (declarată, nu ascunsă): e o verificare TEXTUALĂ. Nu vede ce nu e scris în fișier (DDL construit din bucăți de text pe care nu
//   le putem citi, cod mort de tipul `RETURN;` înaintea gărzii, obiecte create manual pe producție, schimbări venite din upgrade-uri
//   Supabase). Prinde omisiunile și formele naive; nu dovedește nimic. Adevărul rămâne poarta (fn_izo_porti_lipsa) + manifestul L15 la
//   livrare. Detaliile și exemplele: docs/izometrie/PORTI_RECONCILIERE.md.
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const STAMPILE = [
  ['fn_izo_porti_definitii', 'porti'], ['fn_izo_porti_e3_definitii', 'porti_e3'], ['fn_izo_porti_e3b_definitii', 'porti_e3b'],
  ['fn_izo_porti_e4_definitii', 'porti_e4'], ['fn_izo_porti_e4b_definitii', 'porti_e4b']]
export const LISTA_VECHE_REL = 'supabase/tests/izo_porti_regula_vechi.tsv'
export const POARTA_REL = 'supabase/migrations/20261230a_izometrie_porti_reconciliere.sql'
export const WORKFLOW_REL = '.github/workflows/izometrie-porti-regula.yml'
export const DIRECTOARE = ['migrations', 'revenire']

// ─── 1. lexerul ────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Întoarce { cod, simplu, regiuni, linii, eroare }:
//   cod     = textul (fără CR) cu comentariile înlocuite cu spații (aceleași poziții, rândurile păstrate);
//   simplu  = cod + conținutul literalilor '…' golit (pentru COMMIT / EXCEPTION, care nu contează dintr-un mesaj);
//   regiuni = corpurile $tag$ … $tag$: { start, end, deschis, inchis, fel: 'do' | 'functie' | 'alt', parinte, antet, coada };
//   linii   = comentariile de linie de la început de rând (pentru excepția declarată);
//   eroare  = un comentariu / literal / corp neînchis (fail-closed: fișierul se refuză).
export function lexeaza(text) {
  const t = String(text).replace(/\r/g, '')
  const out = t.split('')
  const simplu = t.split('')
  const regiuni = [], linii = [], literali = []
  let eroare = null
  const gol = (arr, a, b) => { for (let k = a; k < b; k++) if (arr[k] !== '\n') arr[k] = ' ' }
  const fel = (a, i) => {
    const inainte = out.slice(Math.max(a, i - 300), i).join('')
    if (/\bDO\s*(?:LANGUAGE\s+\w+\s*)?$/i.test(inainte)) return { fel: 'do', antet: '' }
    let s = i - 1
    while (s >= a && out[s] !== ';') s--
    const instr = out.slice(s + 1, i).join('')
    const m = /\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\b[\s\S]*$/i.exec(instr)
    if (m && /\bAS\s*$/i.test(inainte)) return { fel: 'functie', antet: m[0] }
    return { fel: 'alt', antet: '' }
  }
  const lex = (a, b, parinte) => {
    let i = a
    while (i < b && !eroare) {
      const c = t[i], d = t[i + 1]
      if (c === '-' && d === '-') {
        let j = t.indexOf('\n', i); if (j < 0 || j > b) j = b
        if (i === 0 || t[i - 1] === '\n') linii.push({ poz: i, text: t.slice(i, j) })
        gol(out, i, j); gol(simplu, i, j); i = j; continue
      }
      if (c === '/' && d === '*') {
        let n = 1, j = i + 2
        while (j < b && n > 0) {
          if (t[j] === '/' && t[j + 1] === '*') { n++; j += 2 } else if (t[j] === '*' && t[j + 1] === '/') { n--; j += 2 } else j++
        }
        if (n > 0) { eroare = `comentariu /* neînchis (poziția ${i})`; break }
        gol(out, i, j); gol(simplu, i, j); i = j; continue
      }
      if (c === "'") {
        const esc = i > 0 && /[eE]/.test(t[i - 1]) && (i < 2 || !/[A-Za-z0-9_$]/.test(t[i - 2]))
        let j = i + 1
        while (j < b) {
          if (esc && t[j] === '\\') { j += 2; continue }
          if (t[j] === "'") { if (t[j + 1] === "'") { j += 2; continue } break }
          j++
        }
        if (j >= b) { eroare = `literal '…' neînchis (poziția ${i})`; break }
        literali.push([i, j + 1]); gol(simplu, i + 1, j); i = j + 1; continue
      }
      if (c === '"') {
        let j = i + 1
        while (j < b) { if (t[j] === '"') { if (t[j + 1] === '"') { j += 2; continue } break } j++ }
        if (j >= b) { eroare = `identificator "…" neînchis (poziția ${i})`; break }
        i = j + 1; continue
      }
      if (c === '$' && (i === a || !/[A-Za-z0-9_$]/.test(t[i - 1]))) {
        const m = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(t.slice(i, Math.min(b, i + 80)))
        if (m) {
          const tag = m[0], s = i + tag.length, e = t.indexOf(tag, s)
          if (e < 0 || e + tag.length > b) { eroare = `corp ${tag} neînchis (poziția ${i})`; break }
          const f = fel(a, i)
          let k = t.indexOf(';', e + tag.length); if (k < 0 || k > b) k = b
          const reg = { start: s, end: e, deschis: i, inchis: e + tag.length, fel: f.fel, antet: f.antet, coada: '', parinte }
          regiuni.push(reg)
          lex(s, e, reg)
          reg.coada = out.slice(e + tag.length, k).join('')
          i = e + tag.length; continue
        }
      }
      i++
    }
  }
  lex(0, t.length, null)
  const rez = { cod: out.join(''), simplu: simplu.join(''), regiuni, linii, literali, eroare }
  // `exe` (vezi 1b) se calculează la cerere: perimetrul lexează toate migrările și nu-l folosește
  let exe = null
  Object.defineProperty(rez, 'exe', { enumerable: true, get: () => (exe ??= literaliExecutati(rez)) })
  return rez
}

// lanțul de corpuri care conțin poziția (cel mai interior primul)
function lant(regiuni, poz) {
  return regiuni.filter((r) => r.start <= poz && poz < r.end).sort((x, y) => y.start - x.start)
}

// ─── 2. perimetrul ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// Sursa: corpurile fn_izo_porti_*_definitii() și poarta E2 (fn_izo_porti_lipsa, ultima definiție = 20261230a). Lista NU e completă prin
// construcție (amprentele citesc catalogul, nu numele din fișiere); ce e în afara ei e declarat în docs.
const TAB_E4 = new Set(['executie_tevi', 'executie_pachete_lansare', 'executie_pachete_documente', 'executie_tronsoane', 'izo_tronson_config'])
const TAB_SIGUR = new Set(['executie_proiecte', 'executie_tronsoane', 'logistica_depozite'])                 // E4b: ACL, coloane, politici
const TAB_POSIBIL = new Set(['profiles', 'executie_tevi', 'executie_pachete_lansare', 'executie_pachete_documente',
  'executie_bonuri_consum_linii', 'storage.objects', 'storage.buckets', 'auth.users'])
// numele amprentate prin tipar: tabele / vederi / secvențe / roluri / funcții izo, trigger-ele *_izo_*, politicile izo_ / magbuc_izo_ /
// *_corectie_* / *_coreditor_*, indexurile ux_izo_ / ux_magbuc_ / ix_magbuc_
const RE_IZO = /^(?:[a-z0-9_$]*_)?izo_|^magazie_bucati|^magbuc_|^ux_magbuc_|^ix_magbuc_|_(?:corectie|coreditor)_/
// funcții numite explicit de poartă fără trigger în repo: handle_new_user (trigger-ul on_auth_user_created e pe auth.users, creat de Supabase)
const FUNCTII_EXPLICITE = ['handle_new_user']
// tabelele registrului / documentelor (închiderea citirilor porții E2) + funcțiile fn_izo_*
const RE_REF_FN = /(?<![A-Za-z0-9_$])(?:public\s*\.\s*)?"?(fn_izo_[a-z0-9_]+)/i
const RE_REF_TAB = /(?<![A-Za-z0-9_$])(?:public\s*\.\s*)?"?((?:v_)?izo_[a-z0-9_]+|magazie_bucati[a-z0-9_]*)/i
// SQL dinamic (sau „SQL dat ca text”) — ce face poarta E2 să bage funcția în închidere (20261230a, k_corp / c_fn)
const RE_DINAMIC = /\bexecute\b|\b(?:query|table|schema|database)_to_xml\w*|\bts_stat\b|\bts_rewrite\b|\bcrosstab\w*|\bconnectby\b|\bdblink\w*|\bpg_read_(?:binary_)?file\b|\blo_import\b|\bget_raw_page\b|\bU&"/i

// ─── 1b. literalii: DATE sau SQL care se poate EXECUTA (PR #1146 r2, Jakarinos P2) ─────────────────────────────────────────
// `exe` = `cod` cu conținutul literalilor folosiți ca DATE golit (aceleași poziții, rândurile păstrate). Atingerile (pasul 3) se
// caută în `exe`: un text returnat / inserat / comentat (`SELECT 'DROP TABLE public.izo_importuri;'::text`) nu e DDL executat.
// Un literal ('…', E'…' sau un $q$…$q$ care nu e corp de funcție / DO) RĂMÂNE în `exe` (= tratat ca SQL care poate rula) dacă:
//   (a) e CORP de cod: `AS '…'` într-un CREATE FUNCTION / PROCEDURE, `DO '…'` / `DO LANGUAGE x '…'`;
//   (b) e REFERINȚĂ la obiect: urmat de `::reg…` / `AS reg…` (o constantă regclass dintr-un DEFAULT / CHECK / politică intră
//       în pg_depend, ca numele scris);
//   (c) contextul lui EXECUTĂ text: corpul DO / funcție care îl conține are EXECUTE / dblink / *_to_xml / cron.schedule …
//       (orice literal din corp poate ajunge în EXECUTE printr-o variabilă); la nivelul de sus (sau în SQL-ul unui literal
//       executat), instrucțiunea lui are aceste cuvinte, ori fișierul are meta-comenzi psql (\gexec, \gset, :variabila);
//   (d) e argument (la orice adâncime) al unei funcții care NU e pe lista albă a funcțiilor pure de text (FUNCTII_PURE): o
//       funcție a noastră poate executa textul primit (`SELECT public.ruleaza('DROP …')`).
// Fail-closed: la orice dubiu literalul rămâne (= comportamentul de dinainte). Corpurile de funcții se judecă în continuare pe
// `cod` (cu literali): poarta E2 citește prosrc TEXTUAL, deci un corp care numește registrul într-un literal intră în închiderea ei.
const RE_EXECUTA = new RegExp(`${RE_DINAMIC.source}|\\bcron\\s*\\.\\s*schedule\\w*|\\bpg_background_launch\\b`, 'i')
const RE_PSQL = /\\[A-Za-z]|(?<![:\w]):['"]?[A-Za-z_]/
// funcții pure de text / json / dată (pg_catalog): nu execută și nu numesc obiecte; nextval / to_reg* / has_*_privilege NU sunt aici
export const FUNCTII_PURE = new Set(['format', 'concat', 'concat_ws', 'quote_ident', 'quote_literal', 'quote_nullable', 'replace',
  'translate', 'lower', 'upper', 'initcap', 'btrim', 'ltrim', 'rtrim', 'md5', 'length', 'char_length', 'octet_length', 'coalesce',
  'nullif', 'greatest', 'least', 'jsonb_build_object', 'json_build_object', 'jsonb_build_array', 'json_build_array', 'to_jsonb',
  'to_json', 'jsonb_set', 'array_append', 'array_prepend', 'array_to_string', 'string_to_array', 'string_agg', 'regexp_replace',
  'regexp_match', 'regexp_matches', 'split_part', 'substr', 'substring', 'left', 'right', 'position', 'strpos', 'starts_with',
  'to_char', 'to_date', 'to_timestamp', 'to_number', 'date_trunc', 'encode', 'decode', 'set_config', 'current_setting'])
// cuvinte cheie urmate de „(” (nu sunt apeluri) și cuvintele după care un nume urmat de „(” e o definiție / listă de coloane
const NU_APEL = new Set(['in', 'values', 'array', 'check', 'using', 'with', 'as', 'on', 'exists', 'any', 'all', 'some', 'not', 'and',
  'or', 'references', 'key', 'unique', 'filter', 'over', 'partition', 'cast', 'row', 'if', 'when', 'then', 'else', 'case', 'select',
  'where', 'set', 'into', 'from', 'by', 'conflict', 'do', 'distinct', 'include', 'lateral', 'returning', 'elsif', 'while', 'loop',
  'return', 'raise', 'perform', 'default', 'primary', 'exclude', 'group', 'order', 'having', 'limit', 'between', 'like', 'ilike',
  'is', 'enum', 'table', 'returns', 'window', 'escape'])
const DEFINITIE = new Set(['table', 'function', 'procedure', 'aggregate', 'routine', 'type', 'view', 'into', 'on', 'references',
  'index', 'trigger', 'only', 'exists', 'using'])
const RE_APELAT = /((?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$]*)(?:\s*\.\s*(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$]*))?)\s*$/

function literaliExecutati(lx) {
  const { cod, simplu, regiuni, literali } = lx
  const n = cod.length
  // masca unui nivel (sus = null, sau corpul unei regiuni): `simplu` cu corpurile copil acoperite (tag-uri incluse)
  const masti = new Map()
  const masca = (P) => {
    if (!masti.has(P)) {
      const m = simplu.split('')
      for (const r of regiuni) if (r.parinte === P) for (let k = r.deschis; k < r.inchis; k++) if (m[k] !== '\n') m[k] = ' '
      masti.set(P, m.join(''))
    }
    return masti.get(P)
  }
  const psql = RE_PSQL.test(masca(null))
  // elementele: literalii '…' (conținut = între ghilimele) și regiunile $…$ care nu sunt corpuri, în ordinea deschiderii
  const el = [
    ...literali.map(([a, b]) => ({ a, b, c0: a + 1, c1: b - 1, P: lant(regiuni, a)[0] || null, alt: false })),
    ...regiuni.filter((r) => r.fel === 'alt').map((r) => ({ a: r.deschis, b: r.inchis, c0: r.start, c1: r.end, P: r.parinte, alt: true })),
  ].sort((x, y) => x.a - y.a)
  const pastreaza = (e) => {
    const M = masca(e.P), a0 = e.P ? e.P.start : 0, b0 = e.P ? e.P.end : n
    let s = M.lastIndexOf(';', e.a - 1); if (s < a0) s = a0 - 1
    let f = M.indexOf(';', e.b); if (f < 0 || f > b0) f = b0
    const inainte = M.slice(Math.max(s + 1, e.a - 300), e.a)
    // (a) corp de cod
    if (/\bDO(?:\s+LANGUAGE\s+[A-Za-z_]\w*)?\s*$/i.test(inainte)) return true
    if (/\bAS\s*$/i.test(inainte) && /\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\b/i.test(M.slice(s + 1, e.a))) return true
    // (b) referință la obiect
    if (/^\s*(?:::\s*|AS\s+)"?(?:pg_catalog\s*\.\s*)?reg[a-z]+/i.test(M.slice(e.b, Math.min(b0, e.b + 100)))) return true
    // (c) contextul execută text
    if (e.P && e.P.fel !== 'alt') { if (RE_EXECUTA.test(simplu.slice(e.P.start, e.P.end))) return true }
    else if (RE_EXECUTA.test(M.slice(s + 1, f)) || (!e.P && psql)) return true
    // (d) argument al unei funcții necunoscute (fiecare paranteză deschisă care îl cuprinde, din interior spre exterior)
    let adanc = 0
    for (let k = e.a - 1; k > s; k--) {
      if (M[k] === ')') { adanc++; continue }
      if (M[k] !== '(') continue
      if (adanc > 0) { adanc--; continue }
      const pre = M.slice(Math.max(s + 1, k - 300), k), m = RE_APELAT.exec(pre)
      if (!m) continue                                                   // paranteză de grupare
      const nume = m[1].replace(/\s+/g, '').replace(/"/g, '').toLowerCase(), baza = nume.split('.').pop()
      if (NU_APEL.has(baza) && !nume.includes('.')) continue
      const cuv = /([A-Za-z_]+)\s*$/.exec(pre.slice(0, m.index))
      if (cuv && DEFINITIE.has(cuv[1].toLowerCase())) continue            // CREATE TABLE t (… DEFAULT '…'), f(p text DEFAULT '…')
      if (FUNCTII_PURE.has(baza) && (!nume.includes('.') || nume.startsWith('pg_catalog.'))) continue
      return true
    }
    return false
  }
  const out = cod.split('')
  let golitPana = -1
  for (const e of el) {
    if (e.a < golitPana) continue                                         // în interiorul unui literal-dată deja golit
    if (pastreaza(e)) continue
    for (let k = e.c0; k < e.c1; k++) if (out[k] !== '\n') out[k] = ' '
    golitPana = e.b
  }
  return out.join('')
}

// identificatori: simpli sau "citați", opțional calificați; %I / %s / %L (format) și ' (concatenare) = țintă NECUNOSCUTĂ
const ID1 = '(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$]*)'
const ID = `(?:${ID1}(?:\\s*\\.\\s*${ID1})?)`
const CAP = `((?:${ID1}\\s*\\.\\s*)?%[IsL]|'|${ID})`
const S = '\\s+'
export function normeaza(x) {
  if (x == null) return '?'
  const v = String(x).trim()
  if (v === "'" || /%[IsL]/.test(v) || v === '') return '?'
  const n = v.replace(/\s*\.\s*/g, '.').replace(/"((?:[^"]|"")+)"/g, (_, s) => s.replace(/""/g, '"')).toLowerCase()
  return n.startsWith('public.') ? n.slice(7) : n
}
// clasificarea unei ținte, după rolul ei în instrucțiune (ce amprentează porțile din ea):
//   'obiect'  = obiectul instrucțiunii (CREATE / ALTER / DROP / GRANT pe el);
//   'politica'= tabelul unei politici (E4b: executie_proiecte / executie_tronsoane / logistica_depozite; E2a / E3 / E3b: izo_*;
//               politicile ALTOR module pe storage.objects / profiles nu intră în ștampile — 20261103b r5f);
//   'index'   = tabelul unui index (E4: toate indexurile de pe profiles și izo_tronson_config);
//   'trigger' = tabelul unui trigger (E4: toate trigger-ele de pe tabelele E4, cu corpul funcției).
// Întoarce { sigur } (sigur = schimbă sigur o amprentă / poarta), sau null = în afara perimetrului.
export function clasifica(n, P, ctx = 'obiect') {
  if (n === '?') return { sigur: true, motiv: 'țintă dinamică (necunoscută)' }
  const ultim = n.split('.').pop()
  if (RE_IZO.test(ultim) || P.functii.has(ultim) || P.triggere.has(ultim)) return { sigur: true }
  if (ctx === 'politica') return TAB_SIGUR.has(n) ? { sigur: true } : null
  if (ctx === 'index') return TAB_SIGUR.has(n) || n === 'profiles' ? { sigur: true } : null
  if (ctx === 'trigger') return TAB_E4.has(n) ? { sigur: true } : (TAB_SIGUR.has(n) || TAB_POSIBIL.has(n)) ? { sigur: false } : null
  if (TAB_SIGUR.has(n) || n === 'storage.objects' || n === 'storage.buckets') return { sigur: true }
  if (TAB_POSIBIL.has(n) || TAB_E4.has(n)) return { sigur: false }
  return null
}

// trigger-ele din text: { nume, tabel, functie, poz }
const reTrigger = () => new RegExp(`\\bCREATE${S}(?:OR${S}REPLACE${S})?(?:CONSTRAINT${S})?TRIGGER${S}${CAP}([^;]*?)\\bON${S}(?:ONLY${S})?${CAP}([^;]*?)\\bEXECUTE${S}(?:FUNCTION|PROCEDURE)${S}${CAP}`, 'gi')
export function triggere(cod) {
  const r = []
  for (const m of cod.matchAll(reTrigger())) r.push({ nume: normeaza(m[1]), tabel: normeaza(m[3]), functie: normeaza(m[5]), poz: m.index })
  return r
}

// perimetrul derivat: listele revizuite din poarta E2 + funcțiile trigger-elor amprentate (din TOATE migrările), ca
// fn_executie_acces_garda (trigger-ul trg_executie_acces_garda pe executie_tevi etc., corpul intră în amprenta E4)
export function perimetru(textPoarta, texte) {
  const functii = new Set(FUNCTII_EXPLICITE), triggereRev = new Set()
  const cod = lexeaza(textPoarta).cod
  const lista = (nume) => {
    const m = new RegExp(`\\b${nume}\\b[^:;]*:=\\s*ARRAY\\[([\\s\\S]*?)\\]`, 'i').exec(cod)
    if (!m) throw new Error(`poarta: lista ${nume} negăsită (fail-closed)`)
    return [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1])
  }
  if (!/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_izo_porti_lipsa\(\)/i.test(cod)) throw new Error('poarta: fn_izo_porti_lipsa() negăsită')
  for (const e of lista('c_dinamice_revizuite')) functii.add(e.replace(/\(.*$/, '').toLowerCase())
  for (const e of lista('c_implicite_revizuite')) {
    const m = /^trigger\s+(\S+)\s+on\s+(\S+)=/.exec(e)
    if (m) triggereRev.add(m[1].toLowerCase())
  }
  const P = { functii, triggere: triggereRev }
  for (const t of texte) {
    const c = lexeaza(t).cod
    // un tabel DINAMIC (`ON public.%I`, ca în 20261209a, unde lista vine dintr-o funcție-inventar) contează când fișierul numește un tabel E4
    const numesteE4 = new RegExp(`(?<![A-Za-z0-9_$])(?:${[...TAB_E4].join('|')})(?![A-Za-z0-9_$])`, 'i').test(c)
    for (const g of triggere(c)) {
      const ultimT = g.tabel.split('.').pop()
      // corpul funcției intră în amprentă: trigger-ele de pe tabelele E4 (E4 = md5(prosrc)), trigger-ele revizuite ale porții E2
      // (c_implicite_revizuite: amprenta include corpul) și cele de pe tabelele izo (de regulă fn_izo_*, deja în perimetru)
      if ((g.tabel === '?' && numesteE4) || TAB_E4.has(g.tabel) || RE_IZO.test(ultimT) || triggereRev.has(g.nume)) {
        if (g.functie !== '?') functii.add(g.functie.split('.').pop())
      }
    }
  }
  return P
}

// ─── 3. atingerile ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// listă separată prin virgule la adâncimea 0 a parantezelor → primul identificator al fiecărui element
function elemente(s) {
  const r = []; let d = 0, cur = ''
  for (const ch of s) {
    if (ch === '(') d++
    if (ch === ')') d--
    if (ch === ',' && d === 0) { r.push(cur); cur = '' } else cur += ch
  }
  r.push(cur)
  return r.map((x) => x.trim()).filter(Boolean).map((x) => { const m = new RegExp(`^${CAP}`).exec(x); return normeaza(m ? m[1] : "'") })
}
// sfârșitul instrucțiunii: `;` sau o meta-comandă psql (`SELECT … \gexec` se termină la `\gexec`, nu la următorul `;`)
const sfarsit = (cod, i) => { const re = /;|\\[A-Za-z]/g; re.lastIndex = i; const m = re.exec(cod); return m ? m.index : cod.length }

export function atingeri(lx, P) {
  // atingerile se caută în `exe` (literalii-date goliți, 1b); `lx.cod` (cu literali) doar unde poarta citește textul literal
  const { regiuni } = lx, cod = lx.exe
  const r = []
  // opt.sigur = clasificare impusă; opt.ctx = rolul țintei (vezi clasifica)
  const adauga = (ce, n, poz, sf, opt = {}) => {
    const c = opt.sigur !== undefined ? { sigur: opt.sigur } : clasifica(n, P, opt.ctx)
    if (c) r.push({ ce: `${ce} ${n === '?' ? '<dinamic>' : n}`.trim(), sigur: c.sigur, poz, sf })
  }
  // obiect cu nume (politică / trigger / index) pe un tabel: numele dinamic pe un tabel scris, din afara perimetrului = „posibil”
  const peTabel = (fel, nume, tabel, ctx, poz, sf) => {
    if (nume === '?' && tabel !== '?' && !clasifica(tabel, P, ctx)) adauga(fel, nume, poz, sf, { sigur: false })
    else adauga(fel, nume, poz, sf)
    adauga(`${fel} … ON`, tabel, poz, sf, { ctx })
  }
  const CTX = { POLICY: 'politica', TRIGGER: 'trigger', RULE: 'obiect' }
  const scan = (re, fn) => { for (const m of cod.matchAll(re)) fn(m, m.index, sfarsit(cod, m.index)) }
  const g = (s) => new RegExp(s, 'gi')

  // CREATE <relație / tip / rol / funcție>
  scan(g(`\\bCREATE${S}(?:OR${S}REPLACE${S})?(?:(?:GLOBAL|LOCAL)${S})?(?:(TEMP|TEMPORARY)${S})?(?:UNLOGGED${S})?(TABLE|VIEW|MATERIALIZED${S}VIEW|RECURSIVE${S}VIEW|SEQUENCE|TYPE|DOMAIN|SCHEMA|ROLE|USER|GROUP|FOREIGN${S}TABLE|FUNCTION|PROCEDURE|AGGREGATE)${S}(?:IF${S}NOT${S}EXISTS${S})?${CAP}`),
    (m, i, sf) => {
      if (m[1]) return                                    // TEMP: în pg_temp, în afara amprentelor
      const fel = m[2].toUpperCase().replace(/\s+/g, ' '), n = normeaza(m[3])
      if (fel === 'SCHEMA') return                        // o schemă nouă nu e public; obiectele din ea se judecă fiecare
      adauga(`CREATE ${fel}`, n, i, sf)
    })
  scan(g(`\\b(CREATE|ALTER|DROP)${S}EVENT${S}TRIGGER\\b`), (m, i, sf) => adauga(`${m[1].toUpperCase()} EVENT TRIGGER`, '', i, sf, { sigur: false }))
  // ALTER <obiect> (+ RENAME TO / OWNER TO / ENABLE|DISABLE TRIGGER / SECURITY DEFINER în aceeași instrucțiune)
  scan(g(`\\bALTER${S}(TABLE|VIEW|MATERIALIZED${S}VIEW|SEQUENCE|FUNCTION|PROCEDURE|ROUTINE|AGGREGATE|TYPE|DOMAIN|SCHEMA|ROLE|USER|GROUP|INDEX|FOREIGN${S}TABLE)${S}(?:IF${S}EXISTS${S})?(?:ONLY${S})?${CAP}`),
    (m, i, sf) => {
      const tinta = normeaza(m[2]), rest = cod.slice(i, sf), fel = m[1].toUpperCase()
      if (/^ALL\b/i.test(m[2]) && /^(TABLE|INDEX|MATERIALIZED)/.test(fel)) return
      if (fel === 'SCHEMA') { if (tinta === 'public' || tinta === '?') adauga('ALTER SCHEMA', tinta, i, sf, { sigur: true }); return }
      adauga(`ALTER ${fel}`, tinta, i, sf)
      for (const x of rest.matchAll(g(`\\bRENAME${S}TO${S}${CAP}`))) adauga('RENAME TO', normeaza(x[1]), i, sf)
      for (const x of rest.matchAll(g(`\\bOWNER${S}TO${S}${CAP}`))) adauga('OWNER TO', normeaza(x[1]), i, sf)
      for (const x of rest.matchAll(g(`\\b(?:ENABLE|DISABLE)${S}(?:(?:ALWAYS|REPLICA)${S})?TRIGGER${S}${CAP}`))) {
        const tr = normeaza(x[1])
        adauga('ENABLE/DISABLE TRIGGER', tr, i, sf)
        if (clasifica(tinta, P, 'trigger')?.sigur) adauga(`ENABLE/DISABLE TRIGGER pe ${tinta}:`, tr, i, sf, { sigur: true })
      }
      if (/^(FUNCTION|PROCEDURE|ROUTINE)$/.test(fel) && /\bSECURITY\s+DEFINER\b/i.test(rest)) adauga(`ALTER ${fel} … SECURITY DEFINER`, tinta, i, sf, { sigur: false })
    })
  scan(g(`\\bALTER${S}(POLICY|TRIGGER|RULE)${S}(?:IF${S}EXISTS${S})?${CAP}${S}ON${S}(?:ONLY${S})?${CAP}`), (m, i, sf) => {
    const k = m[1].toUpperCase(); peTabel(`ALTER ${k}`, normeaza(m[2]), normeaza(m[3]), CTX[k], i, sf)
  })
  // DROP <listă> (+ CASCADE)
  scan(g(`\\bDROP${S}(TABLE|VIEW|MATERIALIZED${S}VIEW|SEQUENCE|FUNCTION|PROCEDURE|ROUTINE|AGGREGATE|TYPE|DOMAIN|SCHEMA|ROLE|USER|GROUP|INDEX|FOREIGN${S}TABLE|OPERATOR|CAST|EXTENSION)${S}(?:CONCURRENTLY${S})?(?:IF${S}EXISTS${S})?([^;']*)`),
    (m, i, sf) => {
      const fel = m[1].toUpperCase()
      if (/^(OPERATOR|CAST|EXTENSION)$/.test(fel)) { adauga(`DROP ${fel}`, '', i, sf, { sigur: false }); return }
      const lista = elemente(m[2].replace(/\b(CASCADE|RESTRICT)\b[\s\S]*$/i, ''))
      for (const n of (lista.length ? lista : ['?'])) adauga(`DROP ${fel}`, n, i, sf)
    })
  scan(g(`\\bDROP${S}(POLICY|TRIGGER|RULE)${S}(?:IF${S}EXISTS${S})?${CAP}${S}ON${S}(?:ONLY${S})?${CAP}`), (m, i, sf) => {
    const k = m[1].toUpperCase(); peTabel(`DROP ${k}`, normeaza(m[2]), normeaza(m[3]), CTX[k], i, sf)
  })
  scan(g(`\\bDROP${S}(?:[A-Z]+${S}){1,3}[^;]*?\\bCASCADE\\b`), (m, i, sf) => adauga('DROP … CASCADE (poate șterge dependențe amprentate)', '', i, sf, { sigur: false }))
  scan(g(`\\b(?:REASSIGN|DROP)${S}OWNED\\b`), (m, i, sf) => adauga('REASSIGN / DROP OWNED', '', i, sf, { sigur: true }))
  // CREATE INDEX / TRIGGER / POLICY / RULE
  scan(g(`\\bCREATE${S}(?:UNIQUE${S})?INDEX${S}(?:CONCURRENTLY${S})?(?:IF${S}NOT${S}EXISTS${S})?(?:(?!ON\\b)(${ID})${S})?ON${S}(?:ONLY${S})?${CAP}`),
    (m, i, sf) => { peTabel('CREATE INDEX', m[1] ? normeaza(m[1]) : '(fără nume)', normeaza(m[2]), 'index', i, sf) })
  for (const t of triggere(cod)) {
    const sf = sfarsit(cod, t.poz)
    peTabel('CREATE TRIGGER', t.nume, t.tabel, 'trigger', t.poz, sf)
    adauga('CREATE TRIGGER … EXECUTE FUNCTION', t.functie, t.poz, sf)
  }
  scan(g(`\\bCREATE${S}POLICY${S}${CAP}${S}ON${S}${CAP}`), (m, i, sf) => peTabel('CREATE POLICY', normeaza(m[1]), normeaza(m[2]), 'politica', i, sf))
  scan(g(`\\bCREATE${S}(?:OR${S}REPLACE${S})?RULE${S}${CAP}${S}AS${S}ON${S}\\w+${S}TO${S}(?:ONLY${S})?${CAP}`), (m, i, sf) => {
    adauga('CREATE RULE', normeaza(m[1]), i, sf); adauga('CREATE RULE … TO', normeaza(m[2]), i, sf)
  })
  // GRANT / REVOKE: obiectele după ON, rolurile după TO / FROM (rolurile izo_* = amprentate); fără ON = apartenență la rol
  scan(g(`\\b(GRANT|REVOKE)\\b([^;]*)`), (m, i, sf) => {
    const st = m[2]
    if (/\bON\s+ALL\s+(?:TABLES|SEQUENCES|FUNCTIONS|ROUTINES|PROCEDURES)\s+IN\s+SCHEMA\b/i.test(st)) { adauga('drepturi ON ALL … IN SCHEMA', '', i, sf, { sigur: true }); return }
    const on = /\bON\s+(?:(TABLE|SEQUENCE|FUNCTION|PROCEDURE|ROUTINE|SCHEMA|TYPE|DOMAIN|FOREIGN\s+TABLE|LARGE\s+OBJECT|DATABASE|LANGUAGE|TABLESPACE|PARAMETER)\s+)?([\s\S]*?)\s+(?:TO|FROM)\b([\s\S]*)$/i.exec(st)
    if (on) {
      const fel = (on[1] || 'TABLE').toUpperCase().replace(/\s+/g, ' ')
      let obiectAmprentat = false
      for (const n of elemente(on[2])) {
        // secvențele amprentate sunt cele izo_* / magazie_bucati_* (E2a / E3 / E3b / E4b); alta, numită, nu; una DINAMICĂ (bucla din 20261218a) da
        if (fel === 'SEQUENCE') { if (n === '?' || RE_IZO.test(n.split('.').pop())) { adauga('drepturi pe secvență', n, i, sf, { sigur: true }); obiectAmprentat = true } }
        // schema: contează doar public (E3b / E4: has_schema_privilege(<rol izo>, 'public', 'CREATE'))
        else if (fel === 'SCHEMA') { if (n === '?' || n === 'public') { adauga('drepturi pe schema', n, i, sf, { sigur: true }); obiectAmprentat = true } }
        else if (!/^(DATABASE|LANGUAGE|TABLESPACE|PARAMETER|LARGE OBJECT)$/.test(fel)) {
          if (clasifica(n, P)) obiectAmprentat = true
          adauga(`${m[1].toUpperCase()} ON ${fel}`, n, i, sf)
        }
      }
      // rolurile: izo_* = amprentate (E2a / E3 / E3b / E4 / E4b); un rol DINAMIC contează doar pe un obiect amprentat
      for (const n of elemente(on[3].replace(/\b(WITH\s+GRANT|GRANTED\s+BY|CASCADE|RESTRICT)\b[\s\S]*$/i, ''))) {
        if (RE_IZO.test(n) || (n === '?' && obiectAmprentat)) adauga(`${m[1].toUpperCase()} … TO/FROM rol`, n, i, sf)
      }
    } else {
      const tf = /^([\s\S]*?)\s+(?:TO|FROM)\b([\s\S]*)$/i.exec(st)
      if (tf) for (const n of [...elemente(tf[1].replace(/^\s*(?:ADMIN|INHERIT|SET)\s+OPTION\s+FOR\b/i, '')), ...elemente(tf[2].replace(/\b(WITH|GRANTED\s+BY|CASCADE|RESTRICT)\b[\s\S]*$/i, ''))]) {
        if (n === '?' || RE_IZO.test(n)) adauga(`${m[1].toUpperCase()} rol`, n, i, sf)
      }
    }
  })
  scan(g(`\\bALTER${S}DEFAULT${S}PRIVILEGES\\b`), (m, i, sf) => adauga('ALTER DEFAULT PRIVILEGES', '', i, sf, { sigur: false }))
  scan(g(`\\bSECURITY${S}LABEL\\b`), (m, i, sf) => adauga('SECURITY LABEL', '', i, sf, { sigur: false }))
  // DML pe storage.buckets (E3 amprentează rândul bucket-ului izo-documente) și pe catalog
  scan(g(`\\b(UPDATE|DELETE${S}FROM|INSERT${S}INTO)${S}(?:ONLY${S})?storage\\s*\\.\\s*buckets\\b`), (m, i, sf) => {
    const izo = /izo-/i.test(lx.cod.slice(i, sf))                        // id-ul bucket-ului e chiar un literal
    if (izo || !/^INSERT/i.test(m[1])) adauga(`${m[1].toUpperCase().replace(/\s+/g, ' ')} storage.buckets`, '', i, sf, { sigur: izo })
  })
  scan(g(`\\b(?:UPDATE|DELETE${S}FROM|INSERT${S}INTO)${S}(?:pg_catalog\\s*\\.\\s*)?pg_(?!temp)[a-z_]+\\b`), (m, i, sf) => adauga('scriere directă în catalog', '', i, sf, { sigur: true }))
  // instrucțiunile CREATE / ALTER care NUMESC registrul sau cheamă fn_izo_* (DEFAULT / CHECK / politică / vedere / index pe expresie …)
  let p = 0
  for (const bucata of cod.split(';')) {
    const i = p; p += bucata.length + 1
    if (!/\b(CREATE|ALTER)\b/i.test(bucata) || /\bCREATE\s+(?:(?:GLOBAL|LOCAL)\s+)?(?:TEMP|TEMPORARY)\b/i.test(bucata)) continue
    const vedere = /\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+|RECURSIVE\s+)?(?:VIEW|RULE)\b/i.test(bucata)
    // la view / regulă, fn_izo_* se caută și în literali: poarta citește pg_get_ruledef TEXTUAL (wrapper-e ale registrului);
    // tabelele registrului le leagă prin pg_depend, unde un literal nu intră
    const fn = RE_REF_FN.exec(vedere ? lx.cod.slice(i, i + bucata.length) : bucata), tab = RE_REF_TAB.exec(bucata)
    if (fn) adauga('instrucțiune care cheamă', normeaza(fn[1]), i, i + bucata.length, { sigur: true })
    else if (tab) adauga('instrucțiune care numește registrul:', normeaza(tab[1]), i, i + bucata.length, { sigur: vedere })
  }
  // corpurile de funcții: DEFINER cu SQL dinamic = intră în închiderea porții E2 (roșu); orice corp care numește registrul / fn_izo_*
  for (const rg of regiuni.filter((x) => x.fel === 'functie')) {
    // corpul pe `lx.cod` (cu literali): poarta E2 citește prosrc textual
    const decl = rg.antet + ' ' + rg.coada, corp = lx.cod.slice(rg.start, rg.end)
    const definer = /\bSECURITY\s+DEFINER\b/i.test(decl)
    const nm = new RegExp(`\\b(?:FUNCTION|PROCEDURE)${S}${CAP}`, 'i').exec(rg.antet)
    const nume = nm ? normeaza(nm[1]) : '?'
    if (definer && RE_DINAMIC.test(corp)) adauga('funcție SECURITY DEFINER cu SQL dinamic (închiderea porții E2):', nume, rg.deschis, rg.inchis, { sigur: true })
    // un corp care numește fn_izo_* (și doar într-un literal) = wrapper al registrului pentru poartă (prosrc ~* fn_izo_…): sigur,
    // oricare ar fi DEFINER-ul; unul care numește doar tabelele registrului intră în închiderea citirilor (roșu doar ca DEFINER)
    const numesteFn = RE_REF_FN.test(corp)
    if (numesteFn || RE_REF_TAB.test(corp)) adauga(`funcție ${definer ? 'DEFINER ' : ''}care numește registrul / fn_izo_*:`, nume, rg.deschis, rg.inchis, { sigur: definer || numesteFn })
  }
  // funcții DEFINER fără corp $…$ (AS '…', BEGIN ATOMIC, RETURN …): corpul nu se poate citi sigur (cele INVOKER care numesc
  // registrul sunt prinse mai sus, pe instrucțiune)
  for (const m of cod.matchAll(g(`\\bCREATE${S}(?:OR${S}REPLACE${S})?(?:FUNCTION|PROCEDURE)\\b`))) {
    const sf = sfarsit(cod, m.index)
    if (regiuni.some((x) => x.fel === 'functie' && x.deschis > m.index && x.deschis < sf)) continue
    if (/\bSECURITY\s+DEFINER\b/i.test(cod.slice(m.index, sf))) adauga('funcție SECURITY DEFINER cu corp necitibil (fără $…$)', '', m.index, sf, { sigur: true })
  }
  return r.sort((x, y) => x.poz - y.poz)
}

// ─── 4. structura ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const RE_GARDA = /\bIF\s+public\.fn_izo_porti_lipsa\(\)\s+IS\s+DISTINCT\s+FROM\s+'\{\}'::text\[\]\s+THEN\s+RAISE\s+EXCEPTION\b/gi
const RE_GARDA2 = /\b([a-z_][a-z0-9_]*)\s*:=\s*public\.fn_izo_porti_lipsa\(\)\s*;\s*IF\s+\1\s+IS\s+DISTINCT\s+FROM\s+'\{\}'::text\[\]\s+THEN\s+RAISE\s+EXCEPTION\b/gi
const reStampila = (f, p) => new RegExp(`\\bEXECUTE\\s+format\\(\\s*'COMMENT\\s+ON\\s+FUNCTION\\s+public\\.${f}\\(\\)\\s+IS\\s+%L'\\s*,\\s*'${p}='\\s*\\|\\|\\s*public\\.${f}\\(\\)\\s*\\)\\s*;`, 'gi')
const RE_COMMENT_STAMPILA = /\bCOMMENT\s+ON\s+FUNCTION\s+(?:public\s*\.\s*)?"?(fn_izo_porti_(?:e3b?_|e4b?_)?definitii)"?\s*\(\s*\)/gi
export const RE_EXCEPTIE = /^--[ \t]*IZO_PORTI:[ \t]*neatins[ \t]+—[ \t]*(\S.{9,})$/

export function verifica(text, P) {
  if (!P || !P.functii) throw new Error('verifica: perimetrul lipsește')
  const lx = lexeaza(text)
  if (lx.eroare) return { atinge: ['text nelexabil'], ok: false, lipsa: [`fișier nelexabil: ${lx.eroare}`] }
  const at = atingeri(lx, P)
  const atinge = [...new Set(at.map((a) => a.ce))]
  if (!at.length) return { atinge, ok: true }
  const { cod, simplu, regiuni, literali } = lx
  // garda / ștampila e validă doar ca cod (nu în interiorul unui literal '…' — apărare suplimentară: un ' din literal e dublat /
  // escapat, deci forma canonică nu se poate potrivi înăuntru), într-un lanț de blocuri DO (nu într-un corp de funcție sau un
  // literal $…$), fără handler EXCEPTION care s-o înghită
  const inDo = (poz) => {
    if (literali.some(([a, b]) => poz >= a && poz < b)) return false
    const l = lant(regiuni, poz)
    return l.length > 0 && l.every((r) => r.fel === 'do' && !/\bEXCEPTION\s+WHEN\b/i.test(simplu.slice(r.start, r.end)))
  }
  const garzi = [...cod.matchAll(RE_GARDA), ...cod.matchAll(RE_GARDA2)].map((m) => m.index).filter(inDo).sort((a, b) => a - b)
  const prim = Math.min(...at.map((a) => a.poz)), ultim = Math.max(...at.map((a) => a.sf))
  const lipsa = []
  // ștampilele canonice, fiecare după ultima atingere; orice alt COMMENT pe cele 5 funcții = ștampilă necalculată
  const canonice = []
  let ultimaStampila = -1
  for (const [f, p] of STAMPILE) {
    const toate = [...cod.matchAll(reStampila(f, p))]
    canonice.push(...toate.map((m) => [m.index, m.index + m[0].length]))
    const bune = toate.map((m) => m.index).filter((i) => i > ultim && inDo(i))
    if (!bune.length) lipsa.push(`ștampila ${f}() calculată (EXECUTE format('COMMENT ON FUNCTION public.${f}() IS %L', '${p}=' || public.${f}())), după ultima schimbare, într-un DO`)
    else ultimaStampila = Math.max(ultimaStampila, Math.min(...bune))
  }
  for (const m of cod.matchAll(RE_COMMENT_STAMPILA)) {
    if (!canonice.some(([a, b]) => m.index >= a && m.index < b)) lipsa.push(`ștampilă necalculată / literală pe ${m[1]}() (poziția ${m.index}): ștampila se calculează, nu se scrie`)
  }
  if (!garzi.some((g) => g < prim)) lipsa.push("PRE: IF public.fn_izo_porti_lipsa() IS DISTINCT FROM '{}'::text[] THEN RAISE EXCEPTION …, într-un DO, ÎNAINTEA primei schimbări")
  const post = garzi.filter((g) => g > Math.max(ultimaStampila, ultim))
  if (!post.length) lipsa.push("POST: IF public.fn_izo_porti_lipsa() IS DISTINCT FROM '{}'::text[] THEN RAISE EXCEPTION …, într-un DO, DUPĂ ștampile")
  // aceeași tranzacție: niciun COMMIT / ROLLBACK (sau END la nivelul de sus) înainte de POST
  const finalPost = post.length ? post[post.length - 1] : simplu.length
  for (const m of simplu.matchAll(/\b(COMMIT|ROLLBACK|ABORT)\s*(?:WORK|TRANSACTION|AND\s+(?:NO\s+)?CHAIN)?\s*;/gi)) {
    if (m.index < finalPost) lipsa.push(`${m[1].toUpperCase()} înainte de POST (poziția ${m.index}): schimbarea, ștampilele și POST-ul stau în aceeași tranzacție`)
  }
  for (const m of simplu.matchAll(/\bEND\s*(?:WORK|TRANSACTION)?\s*;/gi)) {
    if (m.index < finalPost && !lant(regiuni, m.index).length) lipsa.push(`END (= COMMIT) înainte de POST (poziția ${m.index})`)
  }
  if (!lipsa.length) return { atinge, ok: true }
  const exceptie = lx.linii.map((l) => RE_EXCEPTIE.exec(l.text)).find(Boolean)
  if (exceptie) {
    const sigure = [...new Set(at.filter((a) => a.sigur).map((a) => a.ce))]
    if (!sigure.length) return { atinge, ok: true, exceptie: exceptie[1] }
    return { atinge, ok: false, lipsa: [`excepția „neatins” nu se acceptă la atingeri sigure: ${sigure.join('; ')}`, ...lipsa] }
  }
  return { atinge, ok: false, lipsa }
}

// ─── 5. depozitul ──────────────────────────────────────────────────────────────────────────────────────────────────────────
export const sha256 = (text) => createHash('sha256').update(Buffer.from(String(text).replace(/\r/g, ''), 'utf8')).digest('hex')
export function citesteLista(text) {
  const m = new Map()
  for (const l of String(text).replace(/\r/g, '').split('\n')) {
    if (!l || l.startsWith('#')) continue
    const [cale, sha, motiv] = l.split('\t')
    if (!/^(migrations|revenire)\/[^\t/]+\.sql$/.test(cale) || !/^[0-9a-f]{64}$/.test(sha) || !/^(vechi|reconciliere)$/.test(motiv)) throw new Error(`lista veche: rând invalid: ${l}`)
    if (m.has(cale)) throw new Error(`lista veche: dublură: ${cale}`)
    m.set(cale, { sha, motiv })
  }
  return m
}
export function fisiere(radacina) {
  const r = []
  for (const d of DIRECTOARE) {
    const dir = join(radacina, 'supabase', d)
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) r.push({ cale: `${d}/${f}`, text: readFileSync(join(dir, f), 'utf8').replace(/\r/g, '') })
  }
  return r
}
export function verificaRadacina(radacina) {
  const fs = fisiere(radacina)
  const lista = citesteLista(readFileSync(join(radacina, LISTA_VECHE_REL), 'utf8'))
  const P = perimetru(readFileSync(join(radacina, POARTA_REL), 'utf8'), fs.filter((f) => f.cale.startsWith('migrations/')).map((f) => f.text))
  const probleme = [], schimbate = [], verificate = []
  let sarite = 0
  for (const f of fs) {
    const e = lista.get(f.cale)
    if (e && e.sha === sha256(f.text)) { sarite++; continue }
    if (e) schimbate.push(f.cale)
    const v = verifica(f.text, P)
    verificate.push({ cale: f.cale, ...v })
    if (!v.ok) probleme.push(`${f.cale}${e ? ` (în lista veche cu alt sha256 — ${e.motiv}; se verifică după regulă)` : ''}: atinge ${v.atinge.join('; ')} — lipsește: ${v.lipsa.join(' | ')}`)
  }
  return { probleme, schimbate, verificate, sarite, P }
}

// workflow-ul CI: rulează la orice PR pe migrări / reveniri / detector, inclusiv pe draft-uri, fără să ignore eșecul
export const CAI_WORKFLOW = ['supabase/migrations/**', 'supabase/revenire/**', 'scripts/izometrie/porti_regula.mjs', 'src/izoPortiRegula.test.js', LISTA_VECHE_REL, WORKFLOW_REL]
export function verificaWorkflow(text) {
  const t = String(text).replace(/\r/g, '')
  const p = []
  const pr = /^on:\s*\n([\s\S]*?)^\S/m.exec(t + '\nX')
  const sectiune = pr ? pr[1] : ''
  if (!/^ {2}pull_request:\s*$/m.test(sectiune)) p.push('lipsește declanșatorul pull_request')
  const cai = [...sectiune.matchAll(/^ {6}- '([^']+)'\s*$/gm)].map((m) => m[1])
  for (const c of CAI_WORKFLOW) if (!cai.includes(c)) p.push(`calea ${c} lipsește din paths`)
  if (/paths-ignore/.test(sectiune)) p.push('paths-ignore nu e permis')
  const tipuri = /^ {4}types:\s*\[([^\]]*)\]/m.exec(sectiune)
  if (tipuri) for (const x of ['opened', 'synchronize', 'reopened']) if (!tipuri[1].split(',').map((s) => s.trim()).includes(x)) p.push(`types fără ${x}`)
  if (/draft/i.test(t.replace(/^\s*#.*$/gm, ''))) p.push('condiție pe draft (regula trebuie să ruleze și pe draft-uri)')
  if (/continue-on-error:\s*true/i.test(t)) p.push('continue-on-error: true')
  if (!/^\s+run:\s*node scripts\/izometrie\/porti_regula\.mjs\s*$/m.test(t)) p.push('pasul `node scripts/izometrie/porti_regula.mjs` lipsește')
  if (!/^\s+run:\s*npx vitest run src\/izoPortiRegula\s*$/m.test(t)) p.push('pasul `npx vitest run src/izoPortiRegula` lipsește')
  return p
}

const AICI = fileURLToPath(import.meta.url)
if (process.argv[1] && resolve(process.argv[1]) === AICI) {
  const i = process.argv.indexOf('--radacina')
  const radacina = i > 0 ? resolve(process.argv[i + 1]) : resolve(dirname(AICI), '..', '..')
  let rez
  try { rez = verificaRadacina(radacina) } catch (e) { console.error(`IZO_PORTI_REGULA EROARE: ${e.message}`); process.exit(2) }
  for (const c of rez.schimbate) console.log(`schimbat față de lista veche (verificat după regulă): ${c}`)
  for (const v of rez.verificate) console.log(`${v.ok ? 'OK ' : 'NU '} ${v.cale}${v.atinge.length ? ` — atinge: ${v.atinge.join('; ')}` : ' — nu atinge perimetrul'}${v.exceptie ? ` — excepție declarată: ${v.exceptie}` : ''}`)
  if (rez.probleme.length) {
    console.error(`\nIZO_PORTI_REGULA: ${rez.probleme.length} fișier(e) încalcă regula porților (docs/izometrie/PORTI_RECONCILIERE.md):`)
    for (const p of rez.probleme) console.error(`  ✗ ${p}`)
    process.exit(1)
  }
  console.log(`IZO_PORTI_REGULA OK: ${rez.verificate.length} verificate, ${rez.sarite} din lista veche (neschimbate)`)
}
