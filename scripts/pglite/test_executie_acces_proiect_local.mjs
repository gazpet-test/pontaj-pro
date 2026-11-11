// Proba LOCALĂ a migrării 20261209a (acces pe proiect în Execuție) pe PGlite (Postgres în WASM, în memorie) — NU atinge nicio bază reală.
// Rulează harness-ul REAL scripts/test_executie_acces_proiect.sql (cel pe care chat-ul îl rulează pe clonă) printr-un mini-psql
// (\ir, \set, \gset, :ERROR / :SQLSTATE / :'LAST_ERROR_MESSAGE', ON_ERROR_STOP), peste schema falsă supabase/tests/20261209a_executie_acces_proiect_schelet.sql
// + 20261201a și 20261028a întregi + funcțiile din 20261203a / 20261204a / 20261208a, extrase EXACT din migrările lor (amprentele se verifică).
// Apoi mutanți (migrare / revenire / schemă stricate intenționat): fiecare TREBUIE să pice exact unde trebuie, altfel testul nu dovedește nimic.
// Rulare (din rădăcina repo-ului): npm install --no-save @electric-sql/pglite && node scripts/pglite/test_executie_acces_proiect_local.mjs
// r3: fn_executie_swap_tevi_pozitie e creată direct în BD și nu se copiază în repo: schema falsă are un ÎNLOCUITOR cu același contract, iar
// amprenta lui ia locul amprentei reale în textul migrării (doar aici, în test). Fibra optică (20261211a) intră în forma minimă: funcția ei de
// drept delegată, exact ca în migrarea ei (amprenta se verifică), și un tabel 'drept' cu politica ei.
// r6: mutanții M26–M31 pe candidații clasificatorului (fn_executie_acces_candidati): lista contului ignorată, lista de scriere în loc de
// citire, proiectele inactive incluse, EXECUTE pentru authenticated, rândul fără cont fără candidați, revenirea care uită funcția.
// r7: M32 (UUID fără profil primește iar „toate”), M33 (refuzul prinde și rândul fără cont, NULL).
// r9: M40–M44 (predicatele citite iar ca proprietar = oracolele din r8, poarta swap fără modul, folderul propriu deschis spre alte foldere,
// scrierea în documente-proiect), P26–P27 (dreptul de citire al predicatelor INVOKER, bucla politicilor); schema falsă are RLS pe modul
// pentru pachete și șantiere (rânduri existente, dar invizibile unui cont fără modul).
// r10: M43 rescris (folderul propriu deschis spre alte foldere, fără funcția din r9) și M45 (funcția din r9 pusă la loc = oracolul din
// verdictul Jakarinos r9: fișierul propriu cu rând pe un proiect nepermis = fals, cale inexistentă = adevărat).
// r11: M46 (modificarea / ștergerea în folderul propriu permise iar, ca în r10), M47 (politicile UPDATE / DELETE fără al 4-lea argument),
// M48 (prefixul nestrict), M49 (ștergerea urmează rândul vizibil = oracol).
// r12: M50 (încărcarea fără garda căii libere = re-ocuparea din verdictul r11), M51 (garda citește ca apelantul), M52 (altă potrivire
// decât garda 4d), M53 (fără EXECUTE), M54 (garda răspunde în afara folderului propriu), M55 (revenirea o uită), P28–P29 (colația / indexul).
// r13 (contul restrâns nu folosește deloc Inboxul AI): ies M19–M21, M23–M24, M36, M43, M45–M55, P28–P29 (ramurile lor nu mai există); noi:
// M56–M57 (coada: rândurile proprii vizibile iar), M58 (folderul propriu citibil iar), M59 (garda căii libere din r12 = oracolul din
// verdictul r12), M60 (garda cozii oprită), M61–M62 (garda după garda de legătură din 20261103c), M63 (predicatul Inboxului neschimbat),
// M64–M65 (revenirea uită predicatul / garda), P30 (trigger BEFORE necunoscut înaintea gărzii), P31–P32 (predicatul Inboxului diferit).
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const MIG = join(ROOT, 'supabase/migrations/20261209a_executie_acces_proiect.sql')
const REV = join(ROOT, 'supabase/revenire/20261209a_executie_acces_proiect_ROLLBACK.sql')
const HARNESS = join(ROOT, 'scripts/test_executie_acces_proiect.sql')
const SCHELET = join(ROOT, 'supabase/tests/20261209a_executie_acces_proiect_schelet.sql')
const citeste = p => readFileSync(p, 'utf8')
const md5 = s => createHash('md5').update(s, 'utf8').digest('hex')

// corpul (între delimitatorii $…$) al primei funcții care începe cu `cap`, fără CR — ca md5(replace(prosrc, chr(13), '')) din BD
function corp(text, cap) {
  const t = text.replace(/\r/g, '')
  const i = t.indexOf(cap)
  if (i < 0) throw new Error('nu găsesc ' + cap)
  const a = /\bAS\s+(\$[A-Za-z_]*\$)/.exec(t.slice(i))
  const st = i + a.index + a[0].length
  return t.slice(st, t.indexOf(a[1], st))
}
const SWAP_REAL = '551affa41371b0ff3367b0ddebe9b603'
const SWAP_INLOCUITOR = md5(corp(citeste(SCHELET), 'CREATE FUNCTION public.fn_executie_swap_tevi_pozitie('))
const POARTA_CAP = 'CREATE FUNCTION public.fn_executie_swap_tevi_pozitie('
const POARTA_MD5 = md5(corp(citeste(MIG), POARTA_CAP))
const cuInlocuitor = t => {
  if (!t.includes(SWAP_REAL)) throw new Error('migrarea nu mai are amprenta reală a lui fn_executie_swap_tevi_pozitie')
  return t.split(SWAP_REAL).join(SWAP_INLOCUITOR)
}
// 20261213a (performanța politicilor): migrarea și revenirea ei verifică amprenta inventarului 20261209a, al cărui corp conține amprenta
// swap (înlocuită mai sus doar aici, în test) → și amprenta inventarului se înlocuiește în textele 20261213a (doar în test)
const MIG13 = join(ROOT, 'supabase/migrations/20261213a_executie_acces_proiect_perf.sql')
const DRY13 = join(ROOT, 'scripts/executie_acces_masurare_dry_20261213a.sql')
const REV13 = join(ROOT, 'supabase/revenire/20261213a_executie_acces_proiect_perf_ROLLBACK.sql')
const INV_CAP = 'CREATE FUNCTION public.fn_executie_acces_inventar('
const INV_REAL = md5(corp(citeste(MIG), INV_CAP))
const INV_PGLITE = md5(corp(cuInlocuitor(citeste(MIG)), INV_CAP))
const cuInventar13 = t => {
  if (!t.includes(INV_REAL)) throw new Error('20261213a nu mai are amprenta reală a inventarului 20261209a')
  return t.split(INV_REAL).join(INV_PGLITE)
}

// o funcție EXACT ca în migrarea ei (de la CREATE FUNCTION la sfârșitul corpului) + toate REVOKE / GRANT-urile ei
function extrageFunctie(fisier, nume) {
  const t = citeste(join(ROOT, 'supabase/migrations', fisier))
  const i = t.indexOf('CREATE FUNCTION public.' + nume + '(')
  if (i < 0) throw new Error('nu găsesc ' + nume + ' în ' + fisier)
  const a = /\bAS\s+(\$[A-Za-z_]*\$)/.exec(t.slice(i))
  const startCorp = i + a.index + a[0].length
  const sfarsit = t.indexOf(';', t.indexOf(a[1], startCorp) + a[1].length) + 1
  const acl = t.split(/\r?\n/).filter(l => /^(REVOKE|GRANT) /.test(l) && l.includes('ON FUNCTION public.' + nume + '(')).join('\n')
  return t.slice(i, sfarsit) + '\n' + acl + '\n'
}

// înlocuire obligatorie (un mutant care nu schimbă nimic nu dovedește nimic)
function inlocuieste(text, vechi, nou) {
  const n = text.replace(/\r\n/g, '\n')
  if (!n.includes(vechi)) throw new Error('mutant fără efect: nu găsesc «' + vechi.slice(0, 90) + '»')
  return n.split(vechi).join(nou)
}

// valoarea booleană a unei expresii \if (ca psql: variabilele :{?nume} / :nume, apoi true / false / on / off / 1 / 0 / yes / no)
function boolPsql(expr, st) {
  const v = expr.trim().replace(/:\{\?([A-Za-z_][A-Za-z0-9_]*)\}/g, (m, n) => (n in st.vars ? 'TRUE' : 'FALSE'))
    .replace(/^:([A-Za-z_][A-Za-z0-9_]*)$/, (m, n) => st.vars[n] ?? m).toLowerCase()
  if (['true', 'on', '1', 'yes', 't', 'y'].includes(v)) return true
  if (['false', 'off', '0', 'no', 'f', 'n'].includes(v)) return false
  throw new Error('\\if: valoare nebooleană «' + expr + '»')
}
// mini-psql: doar ce folosește harness-ul (r14 / 20261213a: și \if / \elif / \else / \endif)
async function ruleazaFisier(db, fisier, st, mut) {
  const text = mut[fisier] ? mut[fisier](citeste(fisier)) : citeste(fisier)
  const stiva = []
  const activ = () => stiva.every(s => s.activ)
  let buf = []
  const executa = async () => {
    const sql = buf.join('\n'); buf = []
    if (!sql.trim()) return
    try {
      await db.exec(sql, { onNotice: n => st.notite.push(n.message) })
      // ca psql: după o instrucțiune reușită ERROR = false și SQLSTATE = 00000 (LAST_ERROR_MESSAGE rămâne cel vechi)
      st.vars.ERROR = 'false'; st.vars.SQLSTATE = '00000'
    } catch (e) {
      if (st.vars.ON_ERROR_STOP === '0') {
        st.vars.ERROR = 'true'; st.vars.SQLSTATE = e.code || ''; st.vars.LAST_ERROR_MESSAGE = e.message
      } else {
        // DEPANARE=1: textul din jurul poziției erorii (doar local)
        if (process.env.DEPANARE) console.error('--- eroare la poziția ' + e.position + ':\n' + sql.slice(Math.max(0, (e.position | 0) - 400), (e.position | 0) + 100))
        const er = new Error(e.message); er.code = e.code; throw er
      }
    }
  }
  for (const brut of text.split('\n')) {
    const l = brut.replace(/\r$/, '')
    if (l.startsWith('\\')) {
      const [cmd, ...rest] = l.slice(1).trim().split(/\s+/)
      // ramurile condiționale (ca psql: o ramură inactivă nu execută și nu interpretează nimic)
      if (cmd === 'if') {
        if (activ()) await executa()
        const parinte = activ(); const v = parinte ? boolPsql(rest.join(' '), st) : false
        stiva.push({ parinte, activ: parinte && v, luat: v }); continue
      }
      if (cmd === 'elif' || cmd === 'else' || cmd === 'endif') {
        const s = stiva.at(-1)
        if (!s) throw new Error('\\' + cmd + ' fără \\if')
        if (cmd === 'endif') { stiva.pop(); continue }
        if (s.activ) await executa()
        if (cmd === 'else') { s.activ = s.parinte && !s.luat; s.luat = true; continue }
        const v = s.parinte && !s.luat ? boolPsql(rest.join(' '), st) : false
        s.activ = v; s.luat = s.luat || v; continue
      }
      if (!activ()) continue
      if (cmd === 'gset') {
        // interogarea din buffer, un singur rând: coloanele devin variabile (ca psql)
        const sql = buf.join('\n'); buf = []
        const r = await db.query(sql)
        if (r.rows.length !== 1) throw new Error('\\gset: ' + r.rows.length + ' rânduri')
        for (const [k, v] of Object.entries(r.rows[0])) st.vars[k] = v == null ? '' : String(v)
        continue
      }
      await executa()
      if (cmd === 'set') {
        const [nume, val = ''] = rest
        st.vars[nume] = val.startsWith(':') ? (st.vars[val.slice(1)] ?? '') : val
      } else if (cmd === 'ir') {
        await ruleazaFisier(db, resolve(dirname(fisier), rest.join(' ')), st, mut)
      } else throw new Error('meta-comandă necunoscută: ' + l)
    } else if (activ()) {
      // :'var' -> literal SQL (doar pentru variabilele definite, ca psql)
      buf.push(l.replace(/:'([A-Za-z_][A-Za-z0-9_]*)'/g, (m, v) => (v in st.vars ? "'" + String(st.vars[v]).replace(/'/g, "''") + "'" : m)))
    }
  }
  if (stiva.length) throw new Error('\\if neînchis în ' + fisier)
  await executa()
}

// opțional: node scripts/pglite/test_executie_acces_proiect_local.mjs '<regex pe numele scenariului>' (ex. '^(baza|m15)$')
const DOAR = process.argv[2] ? new RegExp(process.argv[2]) : null
// cu13a: harness-ul cu 20261213a (T9 / T9z); fără = harness-ul r13 exact (psql -v fara_20261213a=1), ca mutanții 20261209a să pice
// exact unde picau (politicile 20261213a le-ar înlocui pe cele mutate). doar13a: 20261209a aplicată, apoi `inainte13`, apoi DOAR 20261213a
// (preflight-ul ei), într-o tranzacție anulată.
async function scenariu(nume, { mutMig, mutRev, mutSchelet, mutDrept, mutDoc, inainte, doarMigrarea, cu13a, mutMig13, mutRev13, doar13a, inainte13, fara13aPlafon, doarRev13, dry13 } = {}) {
  if (DOAR && !DOAR.test(nume)) return { sarit: true }
  const db = new PGlite()
  // ca psql la pornire: LAST_ERROR_MESSAGE gol, LAST_ERROR_SQLSTATE 00000
  const st = { vars: { ON_ERROR_STOP: '1', LAST_ERROR_MESSAGE: '', LAST_ERROR_SQLSTATE: '00000' }, notite: [] }
  if (!cu13a) st.vars.fara_20261213a = '1'
  const mut = {}
  mut[MIG] = t => cuInlocuitor(mutMig ? mutMig(t) : t)
  if (mutRev) mut[REV] = t => mutRev(t)
  mut[MIG13] = t => cuInventar13(mutMig13 ? mutMig13(t) : t)
  mut[REV13] = t => cuInventar13(mutRev13 ? mutRev13(t) : t)
  try {
    let schelet = citeste(SCHELET)
    if (mutSchelet) schelet = mutSchelet(schelet)
    await db.exec(schelet)
    // 20261201a întreagă (sudurile pe nod + fn_executie_nod_drept + Storage), cu marcajul ei de livrare
    await db.exec(`BEGIN; SELECT set_config('gazpet.livrare_migrare', '20261201a_executie_noduri_suduri:' || txid_current(), true);`
      + citeste(join(ROOT, 'supabase/migrations/20261201a_executie_noduri_suduri.sql')) + '\nCOMMIT;')
    // 20261028a întreagă (coada de repartizat + fn_doc_*)
    let doc = citeste(join(ROOT, 'supabase/migrations/20261028a_documente_de_repartizat.sql'))
    if (mutDoc) doc = mutDoc(doc)
    await db.exec(`BEGIN; SELECT set_config('gazpet.livrare_migrare', '20261028a_documente_de_repartizat:' || txid_current(), true);` + doc + '\nCOMMIT;')
    // funcțiile de drept + raportul zilnic, exact ca în migrările lor
    let drept = extrageFunctie('20261203a_executie_contract_repere.sql', 'fn_executie_contract_drept')
      + extrageFunctie('20261204a_executie_grafic.sql', 'fn_executie_grafic_drept')
      + extrageFunctie('20261208a_executie_devize_tinte.sql', 'fn_executie_tinte_drept')
      + extrageFunctie('20261208a_executie_devize_tinte.sql', 'fn_raport_santier_drept')
      + extrageFunctie('20261208a_executie_devize_tinte.sql', 'fn_raport_lucrari_amprenta_linii')
      + extrageFunctie('20261208a_executie_devize_tinte.sql', 'fn_raport_lucrari_json')
      + extrageFunctie('20261208a_executie_devize_tinte.sql', 'fn_raport_zilnic_versiune')
      + 'CREATE TRIGGER trg_raport_zilnic_versiune BEFORE INSERT OR UPDATE ON public.rapoarte_zilnice FOR EACH ROW EXECUTE FUNCTION public.fn_raport_zilnic_versiune();\n'
      + extrageFunctie('20261208a_executie_devize_tinte.sql', 'fn_raport_zilnic_citeste')
      + extrageFunctie('20261208a_executie_devize_tinte.sql', 'fn_raport_zilnic_salveaza')
      // fibra optică (20261211a), forma minimă: funcția de drept delegată (corpul EXACT ca în 20261211a) + un tabel 'drept' cu politica ei
      + `CREATE FUNCTION public.fn_executie_fibra_drept(p_proiect bigint, p_scriere boolean) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT coalesce(public.fn_executie_nod_drept(p_proiect, p_scriere), false)
$f$;
REVOKE ALL ON FUNCTION public.fn_executie_fibra_drept(bigint, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_executie_fibra_drept(bigint, boolean) TO authenticated, service_role;
CREATE TABLE public.executie_fibra_intervale (id bigserial PRIMARY KEY, proiect_id bigint NOT NULL REFERENCES public.executie_proiecte(id), etapa text NOT NULL);
ALTER TABLE public.executie_fibra_intervale ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.executie_fibra_intervale FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.executie_fibra_intervale TO authenticated, service_role;
CREATE POLICY executie_fibra_intervale_citire ON public.executie_fibra_intervale FOR SELECT TO authenticated
  USING (public.fn_executie_fibra_drept(proiect_id, false));
INSERT INTO public.executie_fibra_intervale (proiect_id, etapa) VALUES (1, 'monotub'), (3, 'monotub');
`
    if (mutDrept) drept = mutDrept(drept)
    await db.exec(drept)
    if (inainte) await db.exec(inainte)
    if (doarMigrarea) {
      // preflight-ul singur (fără harness: T0 ar număra înainte pe schema stricată)
      await db.exec(`BEGIN; SELECT set_config('gazpet.livrare_migrare', '20261209a_executie_acces_proiect:' || txid_current(), true);`
        + mut[MIG](citeste(MIG)) + '\nROLLBACK;', { onNotice: n => st.notite.push(n.message) })
      return { ok: true, notite: st.notite }
    }
    if (dry13) {
      // r2: DRY-ul de producție (scripts/executie_acces_masurare_dry_20261213a.sql) pe 20261209a aplicată: înainte READ ONLY, după cu
      // plafonul (SET de sesiune 3000 + BEGIN), ROLLBACK, comparația; 20261213a NU rămâne aplicată
      await db.exec(`BEGIN; SELECT set_config('gazpet.livrare_migrare', '20261209a_executie_acces_proiect:' || txid_current(), true);`
        + mut[MIG](citeste(MIG)) + '\nCOMMIT;')
      await db.exec(`INSERT INTO public.profiles (id, name, is_owner) VALUES ('00000000-0000-0000-0000-0000000000d1', 'DRY OWNER', true),
        ('00000000-0000-0000-0000-0000000000d2', 'DRY NERESTRANS', false), ('00000000-0000-0000-0000-0000000000d3', 'DRY RESTRANS', false);
        INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES ('00000000-0000-0000-0000-0000000000d2', 'executie', 'edit'),
        ('00000000-0000-0000-0000-0000000000d3', 'executie', 'edit');
        INSERT INTO public.executie_acces_proiect (profile_id, proiect_id, nivel) VALUES ('00000000-0000-0000-0000-0000000000d3', 1, 'editor');`)
      Object.assign(st.vars, { cont: '00000000-0000-0000-0000-0000000000d3', cont_nerestrans: '00000000-0000-0000-0000-0000000000d2',
        cont_owner: '00000000-0000-0000-0000-0000000000d1' })
      await ruleazaFisier(db, DRY13, st, mut)
      const r = await db.query(`SELECT to_regprocedure('public.fn_executie_acces_politici()') IS NULL AS neaplicata,
        (SELECT setting || '/' || source FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout') AS plafon`)
      const n = k => st.notite.filter(x => x.startsWith('masurare ' + k + ' |')).length
      const ok = r.rows[0].neaplicata === true && r.rows[0].plafon === '0/default'
        && ['inainte restrans', 'inainte nerestrans', 'inainte owner', 'dupa restrans', 'dupa nerestrans', 'dupa owner'].every(k => n(k) > 40)
        && st.notite.some(x => /^20261213a LOCK: 1 incercari/.test(x))
      st.notite.push(`DRY: neaplicată după ROLLBACK = ${r.rows[0].neaplicata}, plafon după RESET = ${r.rows[0].plafon}, linii de măsurare: `
        + ['inainte restrans', 'dupa restrans', 'inainte nerestrans', 'dupa nerestrans', 'dupa owner'].map(k => k + ' ' + n(k)).join(', '))
      return { ok, eroare: ok ? undefined : 'DRY incomplet', notite: st.notite }
    }
    if (doarRev13) {
      // r2: 20261209a + 20261213a aplicate (ca runnerul, cu plafon), apoi DOAR revenirea 20261213a, într-o tranzacție PROASPĂTĂ (fără
      // lock-urile harness-ului), cu șirul din antetul ei (SET de sesiune 3000, armarea), anulată
      await db.exec(`BEGIN; SELECT set_config('gazpet.livrare_migrare', '20261209a_executie_acces_proiect:' || txid_current(), true);`
        + mut[MIG](citeste(MIG)) + '\nCOMMIT;')
      await db.exec(APLICA_13A)
      if (inainte13) await db.exec(inainte13)
      await db.exec(`SET transaction_timeout = 3000; BEGIN ISOLATION LEVEL READ COMMITTED;
SELECT set_config('gazpet.revenire_20261213a', 'REDA_POLITICILE_20261209A:' || txid_current(), true);`
        + mut[REV13](citeste(REV13)) + '\nROLLBACK; SET transaction_timeout = 0;', { onNotice: n => st.notite.push(n.message) })
      return { ok: true, notite: st.notite }
    }
    if (doar13a) {
      await db.exec(`BEGIN; SELECT set_config('gazpet.livrare_migrare', '20261209a_executie_acces_proiect:' || txid_current(), true);`
        + mut[MIG](citeste(MIG)) + '\nCOMMIT;')
      if (inainte13) await db.exec(inainte13)
      // r2: ca runnerul cu --plafon-tranzactie-ms 3000: SET de sesiune înainte de BEGIN, apoi prologul pune marcajul plafonului
      // (fara13aPlafon: fără SET / fără marcaj, ca refuzul să fie probat; PGlite nu are timere, deci ceasul nu închide nimic aici)
      const plafon = fara13aPlafon === 'tot' ? '' : `SET transaction_timeout = 3000;`
      const marcaj = fara13aPlafon ? '' : `SELECT set_config('gazpet.plafon_tranzactie', '3000:' || txid_current(), true);`
      await db.exec(`${plafon} BEGIN; SELECT set_config('gazpet.livrare_migrare', '20261213a_executie_acces_proiect_perf:' || txid_current(), true); ${marcaj}`
        + mut[MIG13](citeste(MIG13)) + '\nROLLBACK; SET transaction_timeout = 0;', { onNotice: n => st.notite.push(n.message) })
      return { ok: true, notite: st.notite }
    }
    await ruleazaFisier(db, HARNESS, st, mut)
    const ultima = st.notite.filter(n => /^T\d|^TB/.test(n)).pop() || ''
    // cu 20261213a: și T9 / T9z trebuie să fi rulat efectiv (nu doar finalul r13)
    const ok13 = !cu13a || (st.notite.some(n => /^T9 OK/.test(n)) && st.notite.some(n => /^T9z OK/.test(n)))
    return { ok: /toate testele 20261209a au trecut/.test(ultima) && ok13, notite: st.notite }
  } catch (e) {
    return { ok: false, eroare: (e.code ? e.code + ' ' : '') + e.message, notite: st.notite }
  } finally {
    await db.close()
  }
}

let esecuri = 0
const raport = (eticheta, r, asteptat, motiv) => {
  if (r.sarit) return
  // un mutant trebuie să pice EXACT unde trebuie (motiv = fragmentul erorii), nu oriunde
  const bine = r.ok === asteptat && (!motiv || motiv.test(r.eroare || ''))
  if (!bine) esecuri++
  console.log(`${bine ? 'OK  ' : 'FAIL'} ${eticheta}: ${r.ok ? 'harness trecut' : 'oprit: ' + (r.eroare || 'fără mesaj final').slice(0, 300)}`)
  if (!bine || process.env.DETALII || DOAR) for (const n of r.notite.filter(n => /^T|FAIL|NEPROBAT|20261209a|20261213a/.test(n))) console.log('      · ' + n.slice(0, 1200))
  // MASURARE=1 (sau argumentul --masurare): și liniile scriptului de măsurare (timpi / forma planului, pe fiecare obiect)
  if (process.env.MASURARE || process.argv.includes('--masurare')) for (const n of r.notite.filter(n => /^masurare /.test(n))) console.log('      ~ ' + n)
}

// 1) harness-ul real: trei proiecte pe „clonă”, apoi doar două (al treilea se creează în tranzacție)
raport('baza (3 proiecte)', await scenariu('baza'), true)
raport('doar 2 proiecte pe clonă', await scenariu('doua', {
  inainte: `DELETE FROM public.executie_situatii_plata_linii WHERE sl_id IN (SELECT id FROM public.executie_situatii_plata WHERE proiect_id = 2);
            DELETE FROM public.executie_situatii_plata WHERE proiect_id = 2; DELETE FROM public.executie_bonuri_consum WHERE proiect_id = 2;
            DELETE FROM public.executie_tronsoane WHERE proiect_id = 2; DELETE FROM public.proiect_articole WHERE proiect_id = 2;
            DELETE FROM public.executie_proiecte WHERE id = 2;`,
}), true)

// 2) mutanți pe migrare / revenire: harness-ul trebuie să-i prindă
// r8: politicile cheamă predicatele publice pe rând (boolean), nu lista / setul părinților
const POL_P_CIT = `v_cit := format('(SELECT public.fn_executie_acces_nerestrans()) OR public.fn_executie_proiect_permis(%I::bigint, false)', r.cheie);`
const POL_P_SCR = `v_scr := format('(SELECT public.fn_executie_acces_nerestrans()) OR public.fn_executie_proiect_permis(%I::bigint, true)', r.cheie);`
const POL_C_CIT = `v_cit := format('(SELECT public.fn_executie_acces_nerestrans()) OR public.fn_executie_acces_parinte_permis(%L, %I::bigint, false)', r.parinte, r.cheie);`
raport('M1 garda de scriere dezactivată pe rândul nou', await scenariu('m1', {
  mutMig: t => inlocuieste(t, 'IF NOT (v_nul AND v_nou IS NULL) AND NOT public.fn_executie_proiect_permis(v_nou, true) THEN', 'IF false THEN'),
}), false, /T3 FAIL/)
raport('M2 toată lumea „nerestrânsă”', await scenariu('m2', {
  // r6: regula stă în fn_executie_acces_nerestrans_cont (cont dat); varianta pe apelant o cheamă
  mutMig: t => inlocuieste(t, `  SELECT p_profile IS NOT NULL
    AND (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_profile AND p.is_owner IS TRUE)
         OR NOT EXISTS (SELECT 1 FROM public.executie_acces_proiect a`, `  SELECT p_profile IS NOT NULL
    AND (true
         OR NOT EXISTS (SELECT 1 FROM public.executie_acces_proiect a`),
}), false, /T3 FAIL/)
raport('M3 nivelul viewer ignorat la scriere', await scenariu('m3', {
  mutMig: t => inlocuieste(t, `     AND (p_scriere IS FALSE OR a.nivel = 'editor')\n$f$;`, `\n$f$;`),
}), false, /T3 FAIL: regula/)
raport('M4 RPC-ul de setare fără CAS', await scenariu('m4', {
  mutMig: t => inlocuieste(t, `  IF v_curent IS DISTINCT FROM v_veche THEN
    RETURN jsonb_build_object('ok', false, 'motiv', 'conflict', 'lista', v_curent);
  END IF;`, ''),
}), false, /T5 FAIL: CAS/)
raport('M5 RPC-ul acceptă lista goală (= vede tot)', await scenariu('m5', {
  mutMig: t => inlocuieste(t, `  IF p_restrans AND jsonb_array_length(v_tinta) = 0 THEN`, `  IF false THEN`),
}), false, /T5 FAIL: lista goal/)
raport('M6 politica de citire a tabelelor „proiect” lasă tot (dependențele păstrate)', await scenariu('m6', {
  mutMig: t => inlocuieste(t, POL_P_CIT, POL_P_CIT.replace(`) OR public.fn_executie_proiect_permis`, `) OR true OR public.fn_executie_proiect_permis`)),
}), false, /T3 FAIL: citire pe/)
raport('M7 revenirea nu verifică conturile restrânse', await scenariu('m7', {
  mutRev: t => inlocuieste(t, `  IF EXISTS (SELECT 1 FROM public.executie_acces_proiect) THEN
    RAISE EXCEPTION '20261209a revenire: exista conturi restranse pe proiect (ar vedea din nou toate proiectele); scoate intai restrictiile';
  END IF;`, ''),
}), false, /T7b FAIL/)
raport('M8 copiii fără politica de citire', await scenariu('m8', {
  mutMig: t => inlocuieste(t, POL_C_CIT, POL_C_CIT.replace(`) OR public.fn_executie_acces_parinte_permis`, `) OR true OR public.fn_executie_acces_parinte_permis`)),
}), false, /T3 FAIL: citire pe (executie_|raport_)/)
// r9: căutarea părintelui e sub RLS-ul apelantului, deci la CITIRE un pachet nepermis e deja invizibil (restricția lui); mutantul care
// contează e nivelul: scrierea pe copiii pachetului cu lista de CITIRE (B, viewer pe p2, ar scrie țevile lui p2)
raport('M9 părintele „pachet”: scrierea cere doar lista de citire', await scenariu('m9', {
  mutMig: t => inlocuieste(t, `    WHEN 'pachet' THEN EXISTS (SELECT 1 FROM public.executie_pachete_lansare k WHERE k.id = p_id AND public.fn_executie_proiect_permis(k.proiect_id::bigint, p_scriere))`,
    `    WHEN 'pachet' THEN EXISTS (SELECT 1 FROM public.executie_pachete_lansare k WHERE k.id = p_id AND public.fn_executie_proiect_permis(k.proiect_id::bigint, false))`),
}), false, /T3 FAIL[^\n]*executie_(pachete_documente|tevi)/)
raport('M10 raportul zilnic fără condiția de proiect', await scenariu('m10', {
  mutMig: t => inlocuieste(inlocuieste(t, `    AND (public.fn_executie_acces_nerestrans()
         OR EXISTS (SELECT 1 FROM public.sites s WHERE s.id = p_site`, `    AND (true
         OR EXISTS (SELECT 1 FROM public.sites s WHERE s.id = p_site`),
    `,\n               ('public.fn_raport_santier_drept(bigint)', '640bdc86e81468fc7c5025f6eb54a23f', false, false)) a(semnatura, amprenta, cu_service, cu_auth)`,
    `) a(semnatura, amprenta, cu_service, cu_auth)`),
}), false, /T3r FAIL/)
raport('M11 Storage: citirea obiectelor lasă tot', await scenariu('m11', {
  mutMig: t => inlocuieste(t, `'OR public.fn_executie_acces_obiect_permis(bucket_id, name, false)'`,
    `'OR true OR public.fn_executie_acces_obiect_permis(bucket_id, name, false)'`),
}), false, /T3 FAIL|T3s FAIL/)
raport('M12 garda sare peste documente_proiect', await scenariu('m12', {
  mutMig: t => inlocuieste(t, `  v_nul := TG_NARGS = 2;`,
    `  IF TG_TABLE_NAME = 'documente_proiect' THEN RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END; END IF;\n  v_nul := TG_NARGS = 2;`),
}), false, /T3 FAIL: (INSERT|calea DEFINER)[^\n]*documente_proiect/)
raport('M13 scrierea legitimă oprită de politică (regula neatinsă)', await scenariu('m13', {
  mutMig: t => inlocuieste(t, POL_P_SCR, POL_P_SCR.replace(`OR public.fn_executie_proiect_permis(%I::bigint, true)'`, `OR (public.fn_executie_proiect_permis(%I::bigint, true) AND false)'`)),
}), false, /T3 FAIL: (scrierea legitimă|INSERT-ul legitim|UPDATE \/ DELETE)/)

// r3: poarta swap dezactivată (amprenta porții recalculată, ca postcondiția / revenirea să nu fie ele cele care pică)
const POARTA_COND = `  IF auth.uid() IS NOT NULL\n     AND EXISTS`
raport('M14 poarta swap nu mai verifică proiectul', await scenariu('m14', {
  mutMig: t => {
    const m = inlocuieste(t, POARTA_COND, `  IF false\n     AND EXISTS`)
    return inlocuieste(m, POARTA_MD5, md5(corp(m, POARTA_CAP)))
  },
  mutRev: t => inlocuieste(t, POARTA_MD5, md5(corp(inlocuieste(citeste(MIG), POARTA_COND, `  IF false\n     AND EXISTS`), POARTA_CAP))),
}), false, /T3 FAIL: poarta swap/)

// r4: review r3 — „doar citire” scrie antetul raportului; graficul intern și Inboxul AI fără listă
raport('M15 antetul raportului: scrierea cere doar nivelul de citire (părintele „site”)', await scenariu('m15', {
  mutMig: t => inlocuieste(t, `WHERE si.id = p_id AND (si.proiect_id IS NULL OR public.fn_executie_proiect_permis(si.proiect_id::bigint, p_scriere)))`,
    `WHERE si.id = p_id AND (si.proiect_id IS NULL OR public.fn_executie_proiect_permis(si.proiect_id::bigint, false)))`),
}), false, /T3 FAIL[^\n]*rapoarte_zilnice|T3r FAIL[^\n]*viewer/)
raport('M16 antetul raportului rămâne exclus (ca în r3)', await scenariu('m16', {
  mutMig: t => inlocuieste(t, `  ('tabel', 'rapoarte_zilnice', 'copil', 'site_id', 'site',`, `  ('tabel', 'rapoarte_zilnice', 'exclus', NULL, NULL,`),
}), false, /T3r FAIL[^\n]*viewer/)
raport('M17 graficul intern: citirea lasă toate proiectele', await scenariu('m17', {
  mutMig: t => inlocuieste(t, `%I IS NULL OR public.fn_executie_proiect_permis(%I::bigint, false)'`,
    `true OR %I IS NULL OR public.fn_executie_proiect_permis(%I::bigint, false)'`),
}), false, /T3 FAIL: citire pe grafic_activitati/)
raport('M18 graficul intern: rândurile fără proiect ascunse (regula prea strictă)', await scenariu('m18', {
  mutMig: t => inlocuieste(t, `%I IS NULL OR public.fn_executie_proiect_permis(%I::bigint, false)'`,
    `(%I IS NULL AND false) OR public.fn_executie_proiect_permis(%I::bigint, false)'`),
}), false, /T3 FAIL: citire pe grafic_activitati/)
raport('M22 garda „proiect” lasă rândurile fără proiect și pe tabelele stricte', await scenariu('m22', {
  mutMig: t => inlocuieste(t, `  v_nul := TG_NARGS = 2;`, `  v_nul := true;`),
}), false, /T3 FAIL|T3d FAIL/)

// politica de modificare nu mai filtrează rândurile (USING lasă tot, dependențele rămân): UPDATE-ul direct al lui B pe p2 nu mai dă
// „OK 0”, ci refuzul WITH CHECK — exact „altă eroare” pe care r4 o accepta în T3r
raport('M25 antetul raportului: UPDATE direct pe p2 nefiltrat pe REST (altă eroare în loc de 0 rânduri)', await scenariu('m25', {
  mutMig: t => inlocuieste(t, `    EXECUTE format('CREATE POLICY executie_acces_modifica ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)', r.obiect, v_scr, v_scr);`,
    `    EXECUTE format('CREATE POLICY executie_acces_modifica ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)', r.obiect,
                   CASE WHEN r.obiect = 'rapoarte_zilnice' THEN v_scr || ' OR true' ELSE v_scr END, v_scr);`),
}), false, /T3 FAIL[^\n]*rapoarte_zilnice|T3r FAIL[^\n]*REST/)

// r6: review r5 P1 — clasificatorul caută doar în proiectele permise celui care a urcat (fn_executie_acces_candidati)
const CAND_FILTRU = `     AND (p_profile IS NULL OR c.tot OR e.id = ANY (c.ids)));\nEND $f$;`
raport('M26 candidații ignoră lista contului (clasificatorul ar căuta iar în toate proiectele)', await scenariu('m26', {
  mutMig: t => inlocuieste(t, CAND_FILTRU, `);\nEND $f$;`),
}), false, /T3c FAIL: candidații lui B/)
raport('M27 candidații pe lista de SCRIERE (proiectul „viewer” n-ar mai fi candidat)', await scenariu('m27', {
  mutMig: t => inlocuieste(t, `public.fn_executie_acces_lista_cont(p_profile, false) AS ids)`, `public.fn_executie_acces_lista_cont(p_profile, true) AS ids)`),
}), false, /T3c FAIL: candidații lui B/)
raport('M28 candidații și pentru proiectele inactive', await scenariu('m28', {
  mutMig: t => inlocuieste(t, `   WHERE e.activ IS TRUE\n     AND (p_profile IS NULL`, `   WHERE true\n     AND (p_profile IS NULL`),
}), false, /T3c FAIL: candidații contului/)
raport('M29 candidații apelabili de un client logat (contul e parametru)', await scenariu('m29', {
  mutMig: t => inlocuieste(t, `GRANT EXECUTE ON FUNCTION public.fn_executie_acces_candidati(uuid) TO service_role;`,
    `GRANT EXECUTE ON FUNCTION public.fn_executie_acces_candidati(uuid) TO service_role, authenticated;`),
}), false, /functii noi \(definer/)
raport('M30 candidații: contul fără rând ia „nimic” în loc de „toate” (rândurile fără cont n-ar mai fi potrivite)', await scenariu('m30', {
  mutMig: t => inlocuieste(t, CAND_FILTRU, `     AND (c.tot OR e.id = ANY (c.ids)));\nEND $f$;`),
}), false, /T3c FAIL: candidații contului nul/)
// r7: review r6 P2 — un UUID fără profil primea „toate proiectele active”
raport('M32 candidații: contul inexistent (UUID fără profil) ia iar „toate” în loc de refuz', await scenariu('m32', {
  mutMig: t => inlocuieste(t, `  IF p_profile IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_profile) THEN`,
    `  IF false AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_profile) THEN`),
}), false, /T3c FAIL: cont inexistent/)
// r7: refuzul se aplică și pe NULL (rândul fără cont n-ar mai fi potrivit) — NULL trebuie să rămână „toate”
raport('M33 candidații: refuzul prinde și rândul fără cont (NULL)', await scenariu('m33', {
  mutMig: t => inlocuieste(t, `  IF p_profile IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_profile) THEN`,
    `  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_profile) THEN`),
}), false, /22023 acces proiect: candidații cer un cont existent/)
raport('M31 revenirea uită funcția candidaților', await scenariu('m31', {
  mutRev: t => inlocuieste(t, `  DROP FUNCTION public.fn_executie_acces_candidati(uuid);`, ''),
}), false, /revenire post: au ramas obiecte|starea nu e cea/)

// r8: review SQL P1-01 / P1-02 — funcțiile apelabile direct întorc doar boolean, fără oracol de existență
const GRANT_PUBLIC_ULTIM = `GRANT EXECUTE ON FUNCTION public.fn_executie_acces_obiect_permis(text, text, boolean) TO authenticated;`
raport('M34 lista (id-uri) iar apelabilă de authenticated', await scenariu('m34', {
  mutMig: t => inlocuieste(t, GRANT_PUBLIC_ULTIM, GRANT_PUBLIC_ULTIM + `\nGRANT EXECUTE ON FUNCTION public.fn_executie_acces_lista(boolean) TO authenticated;`),
}), false, /functii noi \(definer/)
// regula GENERALĂ trebuie să prindă singură (lista exactă e „păcălită” în același mutant); r9: lista (bigint[]) în locul rezolvării scoase
const LISTA_EXACTA = `'fn_executie_acces_parinte_permis', 'fn_executie_acces_obiect_permis',\n                                          'fn_executie_acces_proiect_seteaza')))) THEN`
raport('M35 lista (id-uri) apelabilă + trecută pe lista exactă (prinde regula generală)', await scenariu('m35', {
  mutMig: t => inlocuieste(inlocuieste(t, GRANT_PUBLIC_ULTIM, GRANT_PUBLIC_ULTIM + `\nGRANT EXECUTE ON FUNCTION public.fn_executie_acces_lista(boolean) TO authenticated;`),
    LISTA_EXACTA, LISTA_EXACTA.replace(`'fn_executie_acces_proiect_seteaza'`, `'fn_executie_acces_proiect_seteaza', 'fn_executie_acces_lista'`)),
}), false, /intorc altceva decat boolean.*fn_executie_acces_lista/)
// r9: părintele „sl” inexistent = adevărat la citire (sub RLS-ul apelantului, rândul ascuns e tot „inexistent” → adevărat și el: îl prinde
// specificația, iar citirea copiilor lui p3 de către B)
raport('M37 părintele „sl” inexistent / invizibil = adevărat la citire', await scenariu('m37', {
  mutMig: t => inlocuieste(t, `    WHEN 'sl' THEN EXISTS (SELECT 1 FROM public.executie_situatii_plata s WHERE s.id = p_id AND public.fn_executie_proiect_permis(s.proiect_id::bigint, p_scriere))`,
    `    WHEN 'sl' THEN (p_scriere IS FALSE AND NOT EXISTS (SELECT 1 FROM public.executie_situatii_plata s WHERE s.id = p_id))
      OR EXISTS (SELECT 1 FROM public.executie_situatii_plata s WHERE s.id = p_id AND public.fn_executie_proiect_permis(s.proiect_id::bigint, p_scriere))`),
}), false, /T3 FAIL: citire pe executie_(situatii_plata_linii|sl_ajustari)|T3e FAIL[^\n]*parinte_sl/)
raport('M38 o politică Storage cheamă din nou o funcție internă', await scenariu('m38', {
  mutMig: t => inlocuieste(t, `'OR public.fn_executie_acces_obiect_permis(bucket_id, name, false)'`,
    `'OR (cardinality(public.fn_executie_acces_lista(false)) < 0) OR public.fn_executie_acces_obiect_permis(bucket_id, name, false)'`),
}), false, /politici care cheama functii interne/)
// r9: la citire, pachetul nepermis e invizibil (restricția lui); nivelul de scriere e cel care se poate pierde
raport('M39 Storage pachete: scrierea cere doar lista de citire', await scenariu('m39', {
  mutMig: t => inlocuieste(t, `                         WHERE k.id = substring(p_name FROM '^([1-9][0-9]{0,17})/')::bigint
                           AND public.fn_executie_proiect_permis(k.proiect_id::bigint, p_scriere))`,
    `                         WHERE k.id = substring(p_name FROM '^([1-9][0-9]{0,17})/')::bigint
                           AND public.fn_executie_proiect_permis(k.proiect_id::bigint, false))`),
}), false, /T3e FAIL[^\n]*pachete_s/)

// r9: review r8 (ambii recenzenți P1) — predicatele răspund după ce VEDE apelantul; mutanții întorc comportamentul din r8
const LISTA_DEFINER = `'fn_executie_proiect_permis', 'fn_executie_acces_proiect_seteaza',`
const caDefiner = (t, cap, nume) => inlocuieste(inlocuieste(t, cap + `\nLANGUAGE sql STABLE SECURITY INVOKER`, cap + `\nLANGUAGE sql STABLE SECURITY DEFINER`),
  LISTA_DEFINER, LISTA_DEFINER + ` '${nume}',`)
raport('M40 părintele citit ca proprietar (r8: oracolul „șantier fără proiect” / „pachet” pentru B0)', await scenariu('m40', {
  mutMig: t => caDefiner(t, 'CREATE FUNCTION public.fn_executie_acces_parinte_permis(p_tip text, p_id bigint, p_scriere boolean) RETURNS boolean', 'fn_executie_acces_parinte_permis'),
}), false, /T3e FAIL: (oracol de existență pentru b0|cazul literal r8 \(B0)/)
raport('M41 obiectul Storage căutat ca proprietar (r8: oracolul Inboxului — rând ascuns al altui modul)', await scenariu('m41', {
  mutMig: t => caDefiner(t, 'CREATE FUNCTION public.fn_executie_acces_obiect_permis(p_bucket text, p_name text, p_scriere boolean) RETURNS boolean', 'fn_executie_acces_obiect_permis'),
}), false, /T3e FAIL: (oracol de existență pentru b|cazul literal r8 \(B, Inbox)/)
// P2: poarta din r8 (fără dreptul pe modul): A0 ar ajunge iar la original (amprenta porții recalculată, ca postcondiția / revenirea să nu pice)
const POARTA_R8 = t => t.replace(`                  WHERE public.fn_executie_nod_drept(\n`, `                  WHERE public.fn_executie_proiect_permis(\n`)
raport('M42 poarta swap fără dreptul pe modul (ca în r8)', await scenariu('m42', {
  mutMig: t => {
    const m = inlocuieste(t, `                  WHERE public.fn_executie_nod_drept(\n`, `                  WHERE public.fn_executie_proiect_permis(\n`)
    return inlocuieste(m, POARTA_MD5, md5(corp(m, POARTA_CAP)))
  },
  mutRev: t => inlocuieste(t, POARTA_MD5, md5(corp(POARTA_R8(citeste(MIG).replace(/\r\n/g, '\n')), POARTA_CAP))),
}), false, /T3e FAIL[^\n]*(swap|schimbul)/)
raport('M44 documente-proiect: contul restrâns scrie după rândul vizibil (fișier comun cu un proiect ascuns)', await scenariu('m44', {
  mutMig: t => inlocuieste(t, `              WHEN p_bucket = 'documente-proiect' AND p_scriere THEN false\n`, ''),
}), false, /T3e FAIL[^\n]*documente_s/)

// r13 (decizia lui Răzvan, varianta A: un cont RESTRÂNS nu folosește deloc Inboxul AI). Mutanții redeschid, pe rând, câte o cale;
// M43, M45–M55 (folderul propriu din r10–r12) au ieșit odată cu ramura lor.
const POL_INBOX = `      v_cit := '(SELECT public.fn_executie_acces_nerestrans())';\n      v_scr := v_cit;`
const POST_INBOX = `    IF r.clasa = 'inbox'\n       AND (EXISTS (SELECT 1 FROM pg_policy pol JOIN pg_depend d`
const POL_INBOX_PROPRIU = `      v_cit := '(SELECT public.fn_executie_acces_nerestrans()) OR uploadat_de = auth.uid()';\n      v_scr := '(SELECT public.fn_executie_acces_nerestrans())';`
raport('M56 coada Inboxului: contul restrâns își vede iar rândurile proprii (postcondiția: politica citește rândul)', await scenariu('m56', {
  mutMig: t => inlocuieste(t, POL_INBOX, POL_INBOX_PROPRIU),
}), false, /coada Inboxului — politicile citesc randul/)
raport('M57 coada Inboxului: rândurile proprii vizibile iar, cu postcondiția ocolită (harness-ul trebuie să prindă)', await scenariu('m57', {
  mutMig: t => inlocuieste(inlocuieste(t, POL_INBOX, POL_INBOX_PROPRIU), POST_INBOX, POST_INBOX.replace(`IF r.clasa = 'inbox'`, `IF false`)),
}), false, /T3i FAIL/)
const INBOX_STORAGE = `              WHEN p_bucket = 'ai-documente-inbox' THEN false\n`
raport('M58 Storage Inbox: folderul propriu se citește iar (ramura din r10)', await scenariu('m58', {
  mutMig: t => inlocuieste(t, INBOX_STORAGE, `              WHEN p_bucket = 'ai-documente-inbox' THEN NOT p_scriere AND p_name LIKE auth.uid()::text || '/_%'\n`),
}), false, /T3i FAIL/)
// garda căii libere din r12 (DEFINER, „există rând pe calea mea?”) pusă la loc, la încărcare = oracolul din verdictul r12; postcondițiile
// ajustate ca mutantul să ajungă la harness (T3f / T3e trebuie să-l prindă)
const FN_R12 = `CREATE FUNCTION public.fn_executie_acces_inbox_propriu_liber(p_name text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT auth.uid() IS NOT NULL AND p_name IS NOT NULL
    AND p_name LIKE auth.uid()::text || '/_%' AND position('..' IN p_name) = 0
    AND NOT EXISTS (SELECT 1 FROM public.ai_documente_inbox i WHERE i.fisier_path = p_name)
$f$;
`
const LISTA_DEFINER_POST = `'fn_executie_proiect_permis', 'fn_executie_acces_proiect_seteaza',\n                                                                       'fn_executie_acces_candidati'))`
raport('M59 Storage Inbox: încărcarea întreabă iar „există rând pe calea mea?” ca proprietar (oracolul din verdictul r12)', await scenariu('m59', {
  mutMig: t => {
    let m = inlocuieste(t, INBOX_STORAGE, `              WHEN p_bucket = 'ai-documente-inbox' THEN p_scriere AND public.fn_executie_acces_inbox_propriu_liber(p_name)\n`)
    m = inlocuieste(m, 'CREATE FUNCTION public.fn_executie_acces_candidati(', FN_R12 + 'CREATE FUNCTION public.fn_executie_acces_candidati(')
    m = inlocuieste(m, GRANT_PUBLIC_ULTIM, GRANT_PUBLIC_ULTIM + `\nREVOKE ALL ON FUNCTION public.fn_executie_acces_inbox_propriu_liber(text) FROM PUBLIC, anon, authenticated, service_role;`
      + `\nGRANT EXECUTE ON FUNCTION public.fn_executie_acces_inbox_propriu_liber(text) TO authenticated;`)
    m = inlocuieste(m, `p.proname = 'fn_executie_proiect_permis')) <> 16\n`, `p.proname = 'fn_executie_proiect_permis')) <> 17\n`)
    m = inlocuieste(m, `     OR to_regprocedure('public.fn_executie_acces_inbox_propriu_liber(text)') IS NOT NULL\n`, '')
    m = inlocuieste(m, LISTA_DEFINER_POST, LISTA_DEFINER_POST.replace(`'fn_executie_acces_candidati'))`, `'fn_executie_acces_candidati', 'fn_executie_acces_inbox_propriu_liber'))`))
    return inlocuieste(m, LISTA_EXACTA, LISTA_EXACTA.replace(`'fn_executie_acces_obiect_permis',`, `'fn_executie_acces_obiect_permis', 'fn_executie_acces_inbox_propriu_liber',`))
  },
}), false, /T3f FAIL|T3e FAIL/)
raport('M60 garda cozii Inboxului dezactivată (calea DEFINER și INSERT-ul contului restrâns trec)', await scenariu('m60', {
  mutMig: t => inlocuieste(t, `  IF public.fn_executie_acces_nerestrans() IS NOT TRUE THEN\n    RAISE EXCEPTION 'Inbox AI:`, `  IF false THEN\n    RAISE EXCEPTION 'Inbox AI:`),
}), false, /T3i FAIL/)
// ordinea trigger-elor: garda migrării DUPĂ garda de legătură din 20261103c = mesajul deosebește „obiect existent” de „lipsă”
const redenumesteGarda = t => inlocuieste(t, 'a0_executie_acces_inbox', 'trg_executie_acces_inbox_z')
raport('M61 garda cozii după garda de legătură (postcondiția: nu e primul trigger BEFORE)', await scenariu('m61', {
  mutMig: redenumesteGarda, mutRev: redenumesteGarda,
}), false, /garda nu e primul trigger BEFORE/)
raport('M62 garda cozii după garda de legătură, cu postcondiția ocolită (harness-ul trebuie să prindă oracolul)', await scenariu('m62', {
  mutMig: t => inlocuieste(redenumesteGarda(t), POST_INBOX, POST_INBOX.replace(`IF r.clasa = 'inbox'`, `IF false`)), mutRev: redenumesteGarda,
}), false, /T3i FAIL[^\n]*INSERT-ul lui B/)
// predicatul Inboxului fără linia r13 (corpul de azi; amprentele ajustate ca mutantul să ajungă la harness)
const LINII_R13_CONF = `  -- 20261209a (r13): cont restrâns pe proiect în Execuție = fără Inbox AI (fals pentru orice modul / entitate, fără altă citire)\n  IF public.fn_executie_acces_nerestrans_cont(v_uid) IS NOT TRUE THEN RETURN false; END IF;\n`
raport('M63 predicatul Inboxului rămâne cel de azi (contul restrâns primește iar adevărat pe proiectele șantierelor lui)', await scenariu('m63', {
  mutMig: t => inlocuieste(inlocuieste(t, LINII_R13_CONF, ''), `'ee831a07d9ec33ea5be8de44a2d0a00c'`, `'1fcdef410eebff3c7ccdbb87acf8e08b'`),
  mutRev: t => inlocuieste(t, `'ee831a07d9ec33ea5be8de44a2d0a00c'`, `'1fcdef410eebff3c7ccdbb87acf8e08b'`),
}), false, /T3i FAIL[^\n]*fn_ai_inbox_poate_confirma/)
raport('M64 revenirea nu redă predicatul Inboxului', await scenariu('m64', {
  mutRev: t => inlocuieste(t, `  EXECUTE $sql$CREATE OR REPLACE FUNCTION public.fn_ai_inbox_poate_confirma(`, `  PERFORM $sql$CREATE OR REPLACE FUNCTION public.fn_ai_inbox_poate_confirma(`),
}), false, /fn_ai_inbox_poate_confirma nu a revenit la amprenta veche/)
raport('M65 revenirea uită garda cozii Inboxului', await scenariu('m65', {
  mutRev: t => inlocuieste(t, `CASE clasa WHEN 'inbox' THEN 'a0_executie_acces_inbox' ELSE 'trg_executie_acces_garda' END AS tg_nume`, `'trg_executie_acces_garda'::text AS tg_nume`),
}), false, /politicile \/ trigger-ul lipsesc pe ai_documente_inbox/)

// 3) preflight-ul refuză o schemă care ar face restricția falsă sau un inventar incomplet
raport('P1 vedere cunoscută „definer” peste proiecte', await scenariu('p1', { doarMigrarea: true,
  mutSchelet: t => inlocuieste(t, 'CREATE VIEW public.v_executie_dashboard WITH (security_invoker = on) AS', 'CREATE VIEW public.v_executie_dashboard AS'),
}), false, /vederi fara security_invoker.*v_executie_dashboard/)
raport('P2 tabel acoperit fără RLS', await scenariu('p2', { doarMigrarea: true,
  inainte: 'ALTER TABLE public.executie_ture DISABLE ROW LEVEL SECURITY;',
}), false, /nu are RLS pornit/)
raport('P3 funcția de drept diferă de amprenta revizuită', await scenariu('p3', { doarMigrarea: true,
  mutDrept: t => inlocuieste(t, `u.module = 'executie' AND u.access_level IN ('viewer', 'editor', 'admin')`, `u.module = 'executie' AND u.access_level IN ('viewer', 'editor', 'admin', 'x')`),
}), false, /amprenta revizuita/)
raport('P4 coloana de proiect lipsă', await scenariu('p4', { doarMigrarea: true,
  mutSchelet: t => inlocuieste(t, 'CREATE TABLE public.executie_tura_naveta (id bigserial PRIMARY KEY, proiect_id bigint', 'CREATE TABLE public.executie_tura_naveta (id bigserial PRIMARY KEY, proiect bigint'),
}), false, /executie_tura_naveta.proiect_id lipseste/)
raport('P5 vedere nouă „definer” peste un tabel acoperit', await scenariu('p5', { doarMigrarea: true,
  inainte: 'CREATE VIEW public.v_ture_vechi AS SELECT t.id, t.proiect_id FROM public.executie_ture t;',
}), false, /vederi fara security_invoker.*v_ture_vechi/)
raport('P6 vedere „definer” peste o vedere invoker peste un tabel acoperit', await scenariu('p6', { doarMigrarea: true,
  inainte: `CREATE VIEW public.v_ture_inv WITH (security_invoker = on) AS SELECT t.id, t.proiect_id FROM public.executie_ture t;
            CREATE VIEW public.v_peste_vedere AS SELECT * FROM public.v_ture_inv;`,
}), false, /vederi fara security_invoker.*v_peste_vedere/)
raport('P7 tabel nou legat de proiect, neclasificat', await scenariu('p7', { doarMigrarea: true,
  inainte: 'CREATE TABLE public.executie_noua (id bigserial PRIMARY KEY, proiect_id bigint REFERENCES public.executie_proiecte(id));',
}), false, /neclasificate in inventar.*executie_noua/)
raport('P8 tabel nou legat prin alt tabel (copil al situațiilor de plată), neclasificat', await scenariu('p8', { doarMigrarea: true,
  inainte: 'CREATE TABLE public.sl_note (id bigserial PRIMARY KEY, sl_id bigint REFERENCES public.executie_situatii_plata(id), nota text);',
}), false, /neclasificate in inventar.*sl_note/)
raport('P9 funcție SECURITY DEFINER nouă care citește un tabel acoperit', await scenariu('p9', { doarMigrarea: true,
  inainte: `CREATE FUNCTION public.fn_scurgere(p bigint) RETURNS SETOF public.executie_ture LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
              AS $f$ SELECT * FROM public.executie_ture WHERE proiect_id = p $f$;
            GRANT EXECUTE ON FUNCTION public.fn_scurgere(bigint) TO authenticated;`,
}), false, /functii SECURITY DEFINER.*fn_scurgere/)
raport('P10 funcție clasificată cu alt corp decât cel revizuit', await scenariu('p10', { doarMigrarea: true,
  mutDoc: t => inlocuieste(t, `nu există sau nu e activ', p_proiect_id; END IF;`, `nu există', p_proiect_id; END IF;`),
}), false, /functii SECURITY DEFINER.*fn_doc_repartizeaza/)
raport('P11 vedere materializată peste un tabel acoperit', await scenariu('p11', { doarMigrarea: true,
  inainte: 'CREATE MATERIALIZED VIEW public.mv_ture AS SELECT t.id, t.proiect_id FROM public.executie_ture t;',
}), false, /mv_ture \(materializata\)/)
raport('P12 inventar fără documente_proiect (omisiunea din r1 e prinsă din catalog)', await scenariu('p12', { doarMigrarea: true,
  mutMig: t => inlocuieste(t, `  ('tabel', 'documente_proiect', 'proiect', 'proiect_id', NULL, 'corespondența proiectului (tab Documente)'),\n`, ''),
}), false, /neclasificate in inventar.*documente_proiect/)
raport('P13 o vedere „definer” peste un tabel EXCLUS nu oprește migrarea', await scenariu('p13', { doarMigrarea: true }), true)
// r3
raport('P14 tabel „comun” care ajunge totuși la un tabel acoperit', await scenariu('p14', { doarMigrarea: true,
  inainte: 'ALTER TABLE public.employees ADD COLUMN tura_id bigint REFERENCES public.executie_ture(id);',
}), false, /clasificate „comun” care ajung.*employees/)
raport('P15 fn_executie_swap_tevi_pozitie cu alt corp decât cel revizuit', await scenariu('p15', { doarMigrarea: true,
  mutSchelet: t => inlocuieste(t, `RAISE EXCEPTION 'Tevile nu sunt in acelasi pachet'`, `RAISE EXCEPTION 'Tevile nu sunt in acelasi pachet (alt corp)'`),
}), false, /fn_executie_swap_tevi_pozitie lipseste, are alt corp/)
raport('P16 funcția de drept delegată (fibra) cu alt corp', await scenariu('p16', { doarMigrarea: true,
  mutDrept: t => inlocuieste(t, `SELECT coalesce(public.fn_executie_nod_drept(p_proiect, p_scriere), false)`, `SELECT coalesce(public.fn_executie_nod_drept(p_proiect, false), false)`),
}), false, /functii de drept delegate.*fn_executie_fibra_drept/)
raport('P17 tabel „drept” fără funcția lui', await scenariu('p17', { doarMigrarea: true,
  inainte: 'DROP POLICY executie_fibra_intervale_citire ON public.executie_fibra_intervale; DROP FUNCTION public.fn_executie_fibra_drept(bigint, boolean);',
}), false, /functie de drept lipsa sau necunoscuta.*executie_fibra_intervale/)
raport('P18 tabel nou al cumulatului (copil al unui tabel acoperit r3), neclasificat', await scenariu('p18', { doarMigrarea: true,
  inainte: 'CREATE TABLE public.cumulat_note (id bigserial PRIMARY KEY, cumulat_id bigint REFERENCES public.executie_pachete_cumulat_final(id), nota text);',
}), false, /neclasificate in inventar.*cumulat_note/)
raport('P19 funcție SECURITY DEFINER nouă cu nume „de alt modul” care citește un tabel acoperit (fără excluderi pe prefix)', await scenariu('p19', { doarMigrarea: true,
  inainte: `CREATE FUNCTION public.fn_izo_scurgere(p bigint) RETURNS SETOF public.executie_tevi LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
              AS $f$ SELECT * FROM public.executie_tevi WHERE pachet_id = p $f$;
            GRANT EXECUTE ON FUNCTION public.fn_izo_scurgere(bigint) TO authenticated;`,
}), false, /functii SECURITY DEFINER.*fn_izo_scurgere/)

// r4
raport('P20 coada Inboxului AI fără RLS', await scenariu('p20', { doarMigrarea: true,
  inainte: 'ALTER TABLE public.ai_documente_inbox DISABLE ROW LEVEL SECURITY;',
}), false, /ai_documente_inbox nu are RLS pornit/)
raport('P21 predicatul Inboxului AI cu alt corp decât cel revizuit', await scenariu('p21', { doarMigrarea: true,
  mutSchelet: t => inlocuieste(t, `IF p_modul = 'logistica'  THEN RETURN v_rec.role = 'admin_logistica'; END IF;`, `IF p_modul = 'logistica'  THEN RETURN true; END IF;`),
}), false, /fn_ai_inbox_poate_confirma lipseste, are alt corp|functii SECURITY DEFINER.*fn_ai_inbox_poate_confirma/)   // r13: îl oprește întâi preflight-ul pasului 6c
raport('P22 funcție SECURITY DEFINER nouă care citește antetul raportului zilnic', await scenariu('p22', { doarMigrarea: true,
  inainte: `CREATE FUNCTION public.fn_rapoarte_toate() RETURNS SETOF public.rapoarte_zilnice LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
              AS $f$ SELECT * FROM public.rapoarte_zilnice $f$;
            GRANT EXECUTE ON FUNCTION public.fn_rapoarte_toate() TO authenticated;`,
}), false, /functii SECURITY DEFINER.*fn_rapoarte_toate/)

// r8: review SQL P2-01 — nimic nu ține originalul swap după OID; niciun corp nu-l numește; bucket-urile predicatului = inventarul
raport('P23 funcție cu corp SQL standard legată de originalul swap (pg_depend)', await scenariu('p23', { doarMigrarea: true,
  inainte: `CREATE FUNCTION public.fn_dep_swap() RETURNS void LANGUAGE sql BEGIN ATOMIC SELECT public.fn_executie_swap_tevi_pozitie(1, 2); END;`,
}), false, /legate de fn_executie_swap_tevi_pozitie dupa OID/)
raport('P24 funcție care numește originalul swap în corp', await scenariu('p24', { doarMigrarea: true,
  inainte: `CREATE FUNCTION public.fn_cheama_swap() RETURNS void LANGUAGE plpgsql AS $f$ BEGIN PERFORM public.fn_executie_swap_tevi_pozitie(1, 2); END $f$;`,
}), false, /functii care numesc fn_executie_swap_tevi_pozitie.*fn_cheama_swap/)
raport('P25 inventarul nu mai acoperă un bucket numit de predicatul Storage', await scenariu('p25', { doarMigrarea: true,
  mutMig: t => inlocuieste(t, `  ('bucket', 'documente-proiect', 'tabel', NULL, NULL,`, `  ('bucket', 'documente-proiect', 'exclus', NULL, NULL,`),
}), false, /bucket-urile acoperite din inventar difera/)
// r9: predicatele INVOKER au nevoie de dreptul de citire pe coloanele căutate și de politici ale părinților care nu citesc copilul (buclă)
raport('P26 authenticated nu poate citi proiectul șantierului (predicatul INVOKER ar da 42501)', await scenariu('p26', { doarMigrarea: true,
  inainte: 'REVOKE SELECT ON public.sites FROM authenticated; GRANT SELECT (id, name) ON public.sites TO authenticated;',
}), false, /nu poate citi coloanele cautate.*sites\.proiect_id/)
raport('P27 politica unui părinte citește copilul (buclă la evaluare)', await scenariu('p27', { doarMigrarea: true,
  inainte: `CREATE POLICY bucla ON public.executie_pachete_lansare AS RESTRICTIVE FOR SELECT TO authenticated
              USING (EXISTS (SELECT 1 FROM public.executie_tevi t WHERE t.pachet_id = executie_pachete_lansare.id) OR true);`,
}), false, /bucla[^\n]*executie_pachete_lansare\.bucla -> executie_tevi/)
// r13: garda cozii trebuie să fie PRIMUL trigger BEFORE (un trigger necunoscut care ar răspunde înaintea ei = refuz); predicatul Inboxului
// se înlocuiește doar dacă e exact cel revizuit (DEFINER, search_path, owner, drepturi)
raport('P30 un trigger BEFORE pe coadă care rulează înaintea gărzii (ordinea numelui)', await scenariu('p30', { doarMigrarea: true,
  inainte: `CREATE FUNCTION public.t_inainte() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NEW; END $f$;
            CREATE TRIGGER a0_aaa BEFORE INSERT ON public.ai_documente_inbox FOR EACH ROW EXECUTE FUNCTION public.t_inainte();`,
}), false, /garda nu e primul trigger BEFORE/)
raport('P31 predicatul Inboxului fără SECURITY DEFINER (același corp)', await scenariu('p31', { doarMigrarea: true,
  mutSchelet: t => inlocuieste(t, ` STABLE SECURITY DEFINER\n SET search_path TO 'public', 'pg_temp'\nAS $function$\nDECLARE v_uid UUID := auth.uid(); v_owner BOOLEAN;`,
    ` STABLE\n SET search_path TO 'public', 'pg_temp'\nAS $function$\nDECLARE v_uid UUID := auth.uid(); v_owner BOOLEAN;`),
}), false, /fn_ai_inbox_poate_confirma lipseste, are alt corp/)
raport('P32 predicatul Inboxului apelabil de anon', await scenariu('p32', { doarMigrarea: true,
  inainte: 'GRANT EXECUTE ON FUNCTION public.fn_ai_inbox_poate_confirma(text, bigint) TO anon;',
}), false, /fn_ai_inbox_poate_confirma lipseste, are alt corp/)

// 4) 20261213a — performanța politicilor pentru contul restrâns (harness-ul cu T9 / T9z: echivalența rând cu rând pe 6 conturi, proba de
// plan cu prag, lista proprie, revenirea și re-aplicarea; T3–T6 peste politicile noi)
raport('B13 baza cu 20261213a (3 proiecte)', await scenariu('b13', { cu13a: true }), true)
raport('B13 doar 2 proiecte pe clonă, cu 20261213a', await scenariu('b13doua', { cu13a: true,
  inainte: `DELETE FROM public.executie_situatii_plata_linii WHERE sl_id IN (SELECT id FROM public.executie_situatii_plata WHERE proiect_id = 2);
            DELETE FROM public.executie_situatii_plata WHERE proiect_id = 2; DELETE FROM public.executie_bonuri_consum WHERE proiect_id = 2;
            DELETE FROM public.executie_tronsoane WHERE proiect_id = 2; DELETE FROM public.proiect_articole WHERE proiect_id = 2;
            DELETE FROM public.executie_proiecte WHERE id = 2;`,
}), true)
// T00: clona are DEJA 20261209a (ca producția din 11.11) / 20261209a + 20261213a — harness-ul le scoate în tranzacție și pleacă de la zero
const APLICA_09A = `BEGIN; SELECT set_config('gazpet.livrare_migrare', '20261209a_executie_acces_proiect:' || txid_current(), true);\n`
  + cuInlocuitor(citeste(MIG)) + '\nCOMMIT;\n'
// r2: ca runnerul cu --plafon-tranzactie-ms 3000 (SET de sesiune înainte de BEGIN + marcajul prologului)
const APLICA_13A = `SET transaction_timeout = 3000; BEGIN; SELECT set_config('gazpet.livrare_migrare', '20261213a_executie_acces_proiect_perf:' || txid_current(), true);\n`
  + `SELECT set_config('gazpet.plafon_tranzactie', '3000:' || txid_current(), true);\n`
  + cuInventar13(citeste(MIG13)) + '\nCOMMIT;\nSET transaction_timeout = 0;\n'
raport('B13 clona are deja 20261209a (scoasă în tranzacție, amprenta = repo)', await scenariu('b13clona', { cu13a: true, inainte: APLICA_09A }), true)
raport('B13 clona are deja 20261209a + 20261213a', await scenariu('b13clona13', { cu13a: true, inainte: APLICA_09A + APLICA_13A }), true)
raport('B13 clona are o 20261209a DIFERITĂ de repo (T00 trebuie să o vadă)', await scenariu('b13clonadif', { cu13a: true,
  inainte: APLICA_09A + `ALTER FUNCTION public.fn_executie_acces_candidati(uuid) SET work_mem = '8MB';` }), false, /T00 FAIL|starea nu e cea din 20261209a/)
// mutanți pe 20261213a: fiecare schimbă o ramură a politicilor noi; harness-ul (echivalența T9b, planul T9c, lista T9d, revenirea T9r) sau
// postcondițiile migrării trebuie să-i prindă EXACT
const N_P_CIT = `      nou_cit := format('%s OR %I::bigint = ANY (%s)', ner, r.cheie, l_c);`
const N_P_SCR = `      nou_scr := format('%s OR %I::bigint = ANY (%s)', ner, r.cheie, l_s);`
const N_C_CIT = `      nou_cit := format('%s OR %I::bigint IN (%s)', ner, r.cheie, format(v_set, l_c));`
const N_C_SCR = `      nou_scr := format('%s OR %I::bigint IN (%s)', ner, r.cheie, format(v_set, l_s));`
const N_POST_DEP = `  IF EXISTS (SELECT 1 FROM pg_depend d JOIN pg_policy x ON d.classid = 'pg_policy'::regclass AND d.objid = x.oid`
raport('N1 tabelele „proiect”: citirea cu lista de SCRIERE (B pierde proiectul „viewer”)', await scenariu('n1', { cu13a: true,
  mutMig13: t => inlocuieste(t, N_P_CIT, N_P_CIT.replace('l_c);', 'l_s);')),
}), false, /T9b FAIL: b /)
raport('N2 părintele „site”: șantierul fără proiect nu mai intră în set', await scenariu('n2', { cu13a: true,
  mutMig13: t => inlocuieste(t, `WHEN 'site' THEN 'SELECT x.id::bigint FROM public.sites x WHERE x.proiect_id IS NULL OR x.proiect_id::bigint = ANY (%1$s)'`,
    `WHEN 'site' THEN 'SELECT x.id::bigint FROM public.sites x WHERE x.proiect_id::bigint = ANY (%1$s)'`),
}), false, /T9b FAIL: (b|b0|c) /)
raport('N3 documente-proiect: scrierea urmează căile vizibile (în loc de „fals”)', await scenariu('n3', { cu13a: true,
  mutMig13: t => inlocuieste(t, `  nou_scr := format(v_set, l_s, 'false');`, `  nou_scr := format(v_set, l_s, v_doc);`),
}), false, /T9b FAIL: (b|c) /)
raport('N4 copiii: subinterogare CORELATĂ (aceeași semantică, pe rând) — pragul planului', await scenariu('n4', { cu13a: true,
  mutMig13: t => inlocuieste(t, N_C_CIT, `      nou_cit := format('%s OR EXISTS (SELECT 1 FROM (%s) s(id) WHERE s.id IS NOT DISTINCT FROM %I::bigint)', ner, format(v_set, l_c), r.cheie);`),
}), false, /T9c FAIL \(prag\): B[^\n]*subinterogări corelate/)
// (textul trebuie să difere de cel vechi, altfel ALTER POLICY nu rulează și pică numărătoarea tabelelor schimbate, nu pg_depend)
const VECHI_P = t => inlocuieste(inlocuieste(t, N_P_CIT, `      nou_cit := vechi_cit || ' OR false';`), N_P_SCR, `      nou_scr := vechi_scr || ' OR false';`)
raport('N5a tabelele „proiect” păstrează predicatul pe rând (postcondiția pg_depend)', await scenariu('n5a', { cu13a: true,
  mutMig13: VECHI_P,
}), false, /inca depinde de un predicat pe rand/)
raport('N5b la fel, cu postcondiția ocolită — pragul planului', await scenariu('n5b', { cu13a: true,
  mutMig13: t => inlocuieste(VECHI_P(t), N_POST_DEP, N_POST_DEP.replace('IF EXISTS', 'IF false AND EXISTS')),
}), false, /T9c FAIL \(prag\): B[^\n]*pe fiecare rând/)
raport('N5c tabelele „proiect” neschimbate (postcondiția: toate tabelele în afara cozii)', await scenariu('n5c', { cu13a: true,
  mutMig13: t => inlocuieste(inlocuieste(t, N_P_CIT, `      nou_cit := vechi_cit;`), N_P_SCR, `      nou_scr := vechi_scr;`),
}), false, /tabele schimbate \(asteptat toate/)
raport('N6 lista „proprie” ignoră apelantul (toate rândurile tabelului de acces)', await scenariu('n6', { cu13a: true,
  mutMig13: t => inlocuieste(t, `  SELECT public.fn_executie_acces_lista_cont(auth.uid(), false)\n$f$;`,
    `  SELECT coalesce(array_agg(DISTINCT a.proiect_id ORDER BY a.proiect_id), '{}'::bigint[]) FROM public.executie_acces_proiect a\n$f$;`),
}), false, /T9b FAIL|T9d FAIL/)
raport('N7 lista proprie apelabilă de anon (postcondiția drepturilor)', await scenariu('n7', { cu13a: true,
  mutMig13: t => inlocuieste(t, `GRANT EXECUTE ON FUNCTION public.fn_executie_acces_proprii_citire() TO authenticated;`,
    `GRANT EXECUTE ON FUNCTION public.fn_executie_acces_proprii_citire() TO authenticated, anon;`),
}), false, /functiile noi \(securitate/)
raport('N8 revenirea uită politicile Storage', await scenariu('n8', { cu13a: true,
  mutRev13: t => inlocuieste(t, `WHERE nou_cit IS DISTINCT FROM vechi_cit OR nou_scr IS DISTINCT FROM vechi_scr ORDER BY tabel LOOP`,
    `WHERE (nou_cit IS DISTINCT FROM vechi_cit OR nou_scr IS DISTINCT FROM vechi_scr) AND tabel <> 'storage.objects' ORDER BY tabel LOOP`),
}), false, /revenire post: politicile nu au revenit la forma 20261209a: storage\.objects/)
raport('N9 migrarea nu mai verifică forma veche a politicilor (o politică schimbată ar fi suprascrisă)', await scenariu('n9', { cu13a: true,
  mutMig13: t => inlocuieste(t, `v_dif := public.fn_executie_acces_politici_verifica('vechi');`, `v_dif := NULL;`),
}), false, /T9a1 FAIL/)
raport('N10 copiii: scrierea cu lista de CITIRE (B scrie copiii proiectului „viewer”)', await scenariu('n10', { cu13a: true,
  mutMig13: t => inlocuieste(t, N_C_SCR, N_C_SCR.replace('format(v_set, l_s)', 'format(v_set, l_c)')),
}), false, /T9b FAIL: b /)
raport('N11 revenirea fără gardă de armare', await scenariu('n11', { cu13a: true,
  mutRev13: t => inlocuieste(t, `  IF current_user IS DISTINCT FROM 'postgres'\n     OR current_setting('gazpet.revenire_20261213a', true) IS DISTINCT FROM 'REDA_POLITICILE_20261209A:' || txid_current() THEN\n    RAISE EXCEPTION '20261213a revenire: garda invalida`,
    `  IF current_user IS DISTINCT FROM 'postgres' THEN\n    RAISE EXCEPTION '20261213a revenire: garda invalida`),
}), false, /T9r2 FAIL/)
raport('N12 pachetele (forma „aprobare”): perechea proiect / pachet ignorată, doar pachetul', await scenariu('n12', { cu13a: true,
  mutMig13: t => inlocuieste(inlocuieste(t, `' THEN (split_part(name, ''/'', 1)::bigint, split_part(name, ''/'', 2)::bigint) IN'`,
    `' THEN (0::bigint, split_part(name, ''/'', 2)::bigint) IN'`),
    `' (SELECT k.proiect_id::bigint, k.id::bigint FROM public.executie_pachete_lansare k`, `' (SELECT 0::bigint, k.id::bigint FROM public.executie_pachete_lansare k`),
}), false, /T9b FAIL|T3s FAIL|T3 FAIL/)
raport('N13 Storage: căile cu `..` nu mai sunt refuzate', await scenariu('n13', { cu13a: true,
  mutMig13: t => inlocuieste(t, ` AND position(''..'' IN name) = 0 AND CASE bucket_id'`, ` AND CASE bucket_id'`),
}), false, /T9b FAIL: (b|c) /)
raport('N14 executie-contracte: formele cu prefix (pccvi / ordin-incepere / probe-presiune) ignorate', await scenariu('n14', { cu13a: true,
  mutMig13: t => inlocuieste(t, `' substring(name FROM ''^(?:ordin-incepere|pccvi|probe-presiune)/([1-9][0-9]{0,17})/''))::bigint = ANY (%1$s)'`,
    `' NULL::text)::bigint = ANY (%1$s)'`),
}), false, /T9b FAIL: (b|c) /)
// preflight-ul 20261213a (doar migrarea, după 20261209a)
raport('Q0 20261213a se aplică peste 20261209a (control pozitiv al preflight-ului)', await scenariu('q0', { doar13a: true }), true)
raport('Q1 predicatul pe rând al 20261209a cu alt corp (aceeași semantică)', await scenariu('q1', { doar13a: true,
  inainte13: `CREATE OR REPLACE FUNCTION public.fn_executie_proiect_permis(p_proiect bigint, p_scriere boolean DEFAULT false) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$ SELECT p_scriere IS NOT NULL AND (public.fn_executie_acces_nerestrans() OR (p_proiect IS NOT NULL AND p_proiect = ANY (public.fn_executie_acces_lista(p_scriere)))) $f$;`,
}), false, /functiile 20261209a difera/)
raport('Q2 politica unui părinte citește copilul (recursivitate la planificare, pentru toți)', await scenariu('q2', { doar13a: true,
  inainte13: `CREATE POLICY bucla ON public.executie_pachete_lansare AS PERMISSIVE FOR SELECT TO authenticated
              USING (EXISTS (SELECT 1 FROM public.executie_tevi t WHERE t.pachet_id = executie_pachete_lansare.id));`,
}), false, /recursivitate[^\n]*executie_pachete_lansare -> executie_tevi/)
raport('Q3 authenticated nu poate citi calea documentelor (coloana căutată de Storage)', await scenariu('q3', { doar13a: true,
  inainte13: 'REVOKE SELECT ON public.documente_proiect FROM authenticated; GRANT SELECT (proiect_id) ON public.documente_proiect TO authenticated;',
}), false, /documente_proiect\.storage_path[^\n]*fara drept de citire/)
raport('Q4 o funcție fn_executie_acces_* în plus (starea nu e 20261209a)', await scenariu('q4', { doar13a: true,
  inainte13: `CREATE FUNCTION public.fn_executie_acces_x() RETURNS integer LANGUAGE sql AS 'SELECT 1';`,
}), false, /functiile 20261209a difera/)
raport('Q5 lista (id-uri) din 20261209a apelabilă de authenticated (decizia r8 redeschisă)', await scenariu('q5', { doar13a: true,
  inainte13: 'GRANT EXECUTE ON FUNCTION public.fn_executie_acces_lista(boolean) TO authenticated;',
}), false, /functiile 20261209a difera/)
raport('Q6 o politică Storage a 20261209a schimbată', await scenariu('q6', { doar13a: true,
  inainte13: 'ALTER POLICY executie_acces_obiect_sterge ON storage.objects USING (true);',
}), false, /politicile nu sunt cele din 20261209a: storage\.objects\.executie_acces_obiect_sterge/)

// r2 (Jakarinos r1 P1): forma veche verificată pe TOATE politicile 20261209a. Pe fiecare clasă: politică lipsă, politică în plus cu prefixul
// nostru, expresie schimbată — fiecare trebuie refuzată cu numele politicii (nu oriunde)
const CLASE_R2 = [
  // [clasa, tabelul, politica de șters / schimbat, schimbarea, politica în plus]
  ['proiect', 'public.executie_tronsoane', 'executie_acces_modifica', 'USING (true)', 'executie_acces_x'],
  ['proiect_optional', 'public.grafic_activitati', 'executie_acces_citire', 'USING (true)', 'executie_acces_x'],
  ['copil', 'public.executie_tevi', 'executie_acces_adauga', 'WITH CHECK (true)', 'executie_acces_x'],
  ['inbox', 'public.ai_documente_inbox', 'executie_acces_sterge', 'USING (true)', 'executie_acces_x'],
  ['drept', 'public.executie_acces_proiect', 'executie_acces_proiect_citire', 'USING (true)', 'executie_acces_x'],
  ['storage', 'storage.objects', 'executie_acces_obiect_citire', 'USING (true)', 'executie_acces_obiect_x'],
]
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
for (const [clasa, tabel, pol, schimbare, inPlus] of CLASE_R2) {
  const scurt = tabel.replace(/^public\./, '')
  raport(`Q7 ${clasa}: ${pol} lipsă`, await scenariu(`q7_${clasa}_lipsa`, { doar13a: true,
    inainte13: `DROP POLICY ${pol} ON ${tabel};`,
  }), false, new RegExp('politicile nu sunt cele din 20261209a: [^\\n]*' + reEsc(scurt + '.' + pol)))
  raport(`Q7 ${clasa}: ${pol} cu altă expresie`, await scenariu(`q7_${clasa}_schimbata`, { doar13a: true,
    inainte13: `ALTER POLICY ${pol} ON ${tabel} ${schimbare};`,
  }), false, new RegExp('politicile nu sunt cele din 20261209a: [^\\n]*' + reEsc(scurt + '.' + pol)))
  raport(`Q7 ${clasa}: politică în plus ${inPlus}`, await scenariu(`q7_${clasa}_inplus`, { doar13a: true,
    inainte13: `CREATE POLICY ${inPlus} ON ${tabel} AS RESTRICTIVE FOR SELECT TO authenticated USING (true);`,
  }), false, new RegExp('politicile nu sunt cele din 20261209a: [^\\n]*in plus ' + reEsc(tabel + '.' + inPlus)))
}
// politică în plus cu prefixul nostru pe tabele din afara celor acoperite: o tabelă 'drept' a altei migrări și una 'exclus'
raport('Q7 drept (altă migrare): politică în plus executie_acces_x pe sudurile pe nod', await scenariu('q7_drept_alt', { doar13a: true,
  inainte13: 'CREATE POLICY executie_acces_x ON public.executie_noduri_suduri AS RESTRICTIVE FOR SELECT TO authenticated USING (true);',
}), false, /in plus public\.executie_noduri_suduri\.executie_acces_x/)
raport('Q7 exclus: politică în plus executie_acces_x pe șantiere', await scenariu('q7_exclus', { doar13a: true,
  inainte13: 'CREATE POLICY executie_acces_x ON public.sites AS PERMISSIVE FOR SELECT TO authenticated USING (true);',
}), false, /in plus public\.sites\.executie_acces_x/)
// RLS oprit pe tabelul de acces (politica rămâne, dar nu mai decide nimic)
raport('Q7 drept: RLS oprit pe tabelul de acces', await scenariu('q7_drept_rls', { doar13a: true,
  inainte13: 'ALTER TABLE public.executie_acces_proiect DISABLE ROW LEVEL SECURITY;',
}), false, /executie_acces_proiect: lipsa \/ fara profile_id \/ fara RLS/)
raport('Q7 drept: funcția owner-ului cu alt corp', await scenariu('q7_drept_owner', { doar13a: true,
  inainte13: `CREATE OR REPLACE FUNCTION public.fn_executie_acces_e_owner() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$ SELECT true $f$;`,
}), false, /functiile 20261209a difera/)

// r2: plafonul și punctul unic de blocare
raport('Q8 fără marcajul plafonului (SET corect, fără prologul runnerului)', await scenariu('q8_marcaj', { doar13a: true, fara13aPlafon: 'marcaj' }),
  false, /PLAFON_TRANZACTIE lipsa: 3000\/session marcaj lipsa/)
raport('Q8 fără plafon deloc', await scenariu('q8_tot', { doar13a: true, fara13aPlafon: 'tot' }), false, /PLAFON_TRANZACTIE lipsa: 0\/default/)
const PUNCT_UNIC = `  -- ── PUNCTUL UNIC de blocare (L06, r2).`
raport('Q9 un lock pe un tabel acoperit înaintea punctului unic (citire în preflight)', await scenariu('q9', { doar13a: true,
  mutMig13: t => inlocuieste(t, PUNCT_UNIC, `  PERFORM 1 FROM public.executie_tevi LIMIT 1;\n` + PUNCT_UNIC),
}), false, /lock-uri luate inaintea punctului unic de blocare: public\.executie_tevi=AccessShareLock/)
// mutanți pe 20261213a r2: harness-ul trebuie să-i prindă exact
raport('N15 migrarea fără verificarea plafonului', await scenariu('n15', { cu13a: true,
  mutMig13: t => inlocuieste(t, `  IF v_plafon IS DISTINCT FROM '3000/session'\n     OR current_setting('gazpet.plafon_tranzactie', true)`,
    `  IF false AND v_plafon IS DISTINCT FROM '3000/session'\n     OR false AND current_setting('gazpet.plafon_tranzactie', true)`),
}), false, /T9a4 FAIL/)
raport('N16 verificarea formei fără politica tabelului de acces (clasa drept)', await scenariu('n16', { cu13a: true,
  mutMig13: t => inlocuieste(t, `      v_dif := v_dif || 'executie_acces_proiect.executie_acces_proiect_citire'::text;`, `      NULL;`),
}), false, /T9a6 FAIL/)
raport('N17 verificarea formei fără mulțimea globală (politici în plus)', await scenariu('n17', { cu13a: true,
  mutMig13: t => inlocuieste(t, `                           WHERE x.polname LIKE 'executie\\_acces\\_%'\n                             AND (n.nspname`,
    `                           WHERE false AND x.polname LIKE 'executie\\_acces\\_%'\n                             AND (n.nspname`),
}), false, /T9a7 FAIL/)
raport('N18 revenirea fără verificarea plafonului', await scenariu('n18', { cu13a: true,
  mutRev13: t => inlocuieste(t, `  IF v_plafon IS DISTINCT FROM '3000/session' THEN`, `  IF false THEN`),
}), false, /T9r4 FAIL/)
raport('D1 DRY-ul de producție: înainte READ ONLY, după cu plafon, ROLLBACK (restrâns complet, nerestrâns + owner pe plan)', await scenariu('d1', { dry13: true }), true)
// (într-o tranzacție PROASPĂTĂ: în tranzacția harness-ului lock-ul pe executie_tevi e deja ținut de testele dinainte, deci nu e „adăugat”)
raport('R0 revenirea 20261213a într-o tranzacție proaspătă (control pozitiv)', await scenariu('r0', { doarRev13: true }), true)
raport('N19 revenirea citește un tabel acoperit înaintea punctului unic', await scenariu('n19', { doarRev13: true,
  mutRev13: t => inlocuieste(t, `  -- ── punctul unic de blocare, ÎNAINTEA verificării politicilor (ca migrarea, r2)`,
    `  PERFORM 1 FROM public.executie_tevi LIMIT 1;\n  -- ── punctul unic de blocare, ÎNAINTEA verificării politicilor (ca migrarea, r2)`),
}), false, /revenire: lock-uri luate inaintea punctului unic de blocare: public\.executie_tevi=AccessShareLock/)

// r2, static: lock-urile explicite ale migrării și ale revenirii = exact cele două instrucțiuni ale punctului unic, toate NOWAIT; plafonul
// cerut o singură dată, în forma pe care o acceptă validatorul runnerului (PR #1054)
for (const [eticheta, fisier] of [['migrarea', MIG13], ['revenirea', REV13]]) {
  const cod = citeste(fisier).replace(/\r/g, '').split('\n').filter(l => !/^\s*--/.test(l)).join('\n')
  const lockuri = cod.match(/LOCK TABLE[^;]*;/g) || []
  const bine = lockuri.length === 2 && lockuri.every(l => /NOWAIT/.test(l))
    && /ACCESS EXCLUSIVE MODE NOWAIT/.test(lockuri[0]) && /storage\.objects IN ACCESS EXCLUSIVE/.test(lockuri[0])
    && /LOCK TABLE public\.executie_acces_proiect, public\.sites IN ACCESS SHARE MODE NOWAIT;/.test(lockuri[1])
  const text = citeste(fisier).toLowerCase()
  const citire = "FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout'"
  const nCit = citeste(fisier).split(citire).length - 1
  // doar migrarea trece prin validator (revenirea o rulează operatorul, cu SET-ul în antet)
  const plafonOk = eticheta === 'revenirea'
    || (nCit === 1 && text.split('transaction_timeout').length - 1 === 1 && text.split('pg_settings').length - 1 === 1)
  if (!bine || !plafonOk) esecuri++
  console.log(`${bine && plafonOk ? 'OK  ' : 'FAIL'} S1 ${eticheta}: ${lockuri.length} instrucțiuni LOCK, toate NOWAIT = ${bine}; plafonul citit o dată, în forma validatorului = ${plafonOk}`)
}

console.log(esecuri ? `\n${esecuri} scenarii NU s-au comportat cum trebuie` : '\nToate scenariile s-au comportat cum trebuie')
process.exit(esecuri ? 1 : 0)
