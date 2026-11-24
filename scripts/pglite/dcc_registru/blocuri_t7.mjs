// Blocurile Task 7 (secțiunea 7: $post$, postcondiția de lock-uri, accesul complet). t7_lock_runner_normal / _istoric_prod aplică migrarea
// prin FIȘIERELE REALE ale runnerului, pe o bază nouă (planul, „Lock-urile migrării”, ordinea 1): trec ÎNAINTEA oricărui mutant de lock-uri.
import { U, ca, sonda, bazaGoala, citeste, gen, CALE_MIG } from './baza.mjs'
import { CHECKURI, UNICE, TABELE, TABELE_CITITE } from './inventar.mjs'
import { genereaza, prinRunner, tintaPglite } from './runner.mjs'
import { K, KN, rpc, trece, big, configurare, initSerie, aloca, alocaManual, revizieNoua, filaNoua, anexaNoua, anuleaza, creeazaContract, creeazaProiect,
  numar } from './rpc.mjs'
import { egal } from './blocuri_t5.mjs'
import { SNAP } from './blocuri_t6.mjs'

const RE = cod => new RegExp('^' + cod + ':')
const setLock = jurnal => (jurnal.find(m => m.startsWith('L15_LOCK_SET ')) || '').slice('L15_LOCK_SET '.length)
const camp = (set, k) => (new RegExp('(?:^| )' + k + '=(\\S+)').exec(set) || [])[1]
export const ISTORIC_PROD = `DROP TABLE supabase_migrations.schema_migrations;
CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, statements text[], name text, created_by text, idempotency_key text, rollback text[]);
CREATE UNIQUE INDEX schema_migrations_idempotency_key_key ON supabase_migrations.schema_migrations (idempotency_key);`

// inventarul copiat în $post$ (blocul INVENTAR) = inventar.mjs
export function inventarDinMigrare(mig) {
  const a = mig.indexOf('-- INVENTAR-START'), b = mig.indexOf('-- INVENTAR-END')
  const bloc = mig.slice(a, b)
  const [ck, uq] = bloc.split('asu(t, n) AS (VALUES')
  const c = [...ck.matchAll(/\('(dcc_[a-z_]+)', '(dcc_[a-z_]+)', '(N[1-6])'\)/g)].map(m => `${m[1]}/${m[2]}/${m[3]}`).sort()
  const u = [...(uq || '').matchAll(/\('(dcc_[a-z_]+)', '(dcc_[a-z_]+)'\)/g)].map(m => `${m[1]}/${m[2]}`).sort()
  return { c, u }
}

// ── runda 7 (proba pe clonă, 24.11.2026): relațiile EXISTENTE citite de pasul „înainte” al amprentei globale. Deparsarea interogărilor stocate
// (pg_get_viewdef pe vederi / vederi materializate, pg_get_ruledef, pg_get_function_sqlbody pe corpurile BEGIN ATOMIC) ia AccessShareLock pe
// fiecare relație din ele, până la COMMIT; pg_get_expr (valori implicite, limite de partiție, politici) NU ia lock-uri pe PG 17. Pe clonă: 214 relații
// (tabelele și vederile citite de vederile platformei, plus vault.secrets). Aici: câte una din fiecare cauză + martorii care NU sunt citiți.
export const PLATFORMA_AMPRENTA = `CREATE TABLE public.proba_baza_vedere (id int PRIMARY KEY);
CREATE VIEW public.v_proba AS SELECT id FROM public.proba_baza_vedere;
CREATE VIEW public.v_peste_vedere AS SELECT id FROM public.v_proba;
CREATE SCHEMA proba_vault; CREATE TABLE proba_vault.secrets (id int, s text); CREATE VIEW proba_vault.decrypted AS SELECT id FROM proba_vault.secrets;
CREATE TABLE public.proba_mv_baza (id int); CREATE MATERIALIZED VIEW public.proba_mv AS SELECT id FROM public.proba_mv_baza;
CREATE TABLE public.proba_regula (id int); CREATE TABLE public.proba_regula_tinta (id int);
CREATE RULE proba_r AS ON INSERT TO public.proba_regula DO ALSO INSERT INTO public.proba_regula_tinta VALUES (NEW.id);
CREATE TABLE public.proba_sqlbody (id int); CREATE FUNCTION public.proba_fn_atomic() RETURNS bigint LANGUAGE sql BEGIN ATOMIC SELECT count(*) FROM public.proba_sqlbody; END;
CREATE TABLE public.proba_cu_default (id int PRIMARY KEY, t text DEFAULT 'x');
CREATE TABLE public.proba_part (id int, k int) PARTITION BY RANGE (k); CREATE TABLE public.proba_part_1 PARTITION OF public.proba_part FOR VALUES FROM (0) TO (10);
CREATE TABLE public.proba_politica (id int); ALTER TABLE public.proba_politica ENABLE ROW LEVEL SECURITY; CREATE POLICY p ON public.proba_politica USING (id > 0);
CREATE TABLE public.proba_fara_nimic (id int);`
// EXACT relațiile pe care pasul „înainte” le lasă blocate (verificat în bloc, separat de migrare); restul relațiilor de mai sus sunt martori
export const CITITE_AMPRENTA = ['proba_vault.secrets', 'public.proba_baza_vedere', 'public.proba_mv_baza', 'public.proba_regula', 'public.proba_regula_tinta',
  'public.proba_sqlbody', 'public.v_proba']
const INAINTE_H = '  -- (h) POSTCONDIȚIA DE LOCK-URI (ultima)'
const LINIE_A = "        WHEN lk.o = ANY (v_a) AND lk.mode = 'AccessShareLock' THEN 'A'\n"
const V_A = "  v_a := coalesce(string_to_array(nullif(split_part(v_ina, ':', 2), ''), ',')::oid[], '{}'::oid[]);\n"
function oData(text, lista) {
  let t = text
  for (const [din, in_] of lista) {
    const n = t.split(din).length - 1
    if (n !== 1) throw new Error(`MUTANT_INAPLICABIL: textul apare de ${n} ori: ${din.slice(0, 100)}`)
    t = t.split(din).join(in_)
  }
  return t
}
const injecteaza = (text, sql) => oData(text, [[INAINTE_H, sql + '\n' + INAINTE_H]])
// scenariile pe baza cu PLATFORMA_AMPRENTA: [nume, transformarea textului, rezultatul așteptat pe migrarea corectă]
export const SCENARII_A = [
  ['normal', t => t, { trece: true }],   // pe migrarea corectă rulează cu COPIA runnerului (aplicare completă); pe mutanți, cu textul mutat
  ['citire_tabela_necitita_de_amprenta', t => injecteaza(t, '  PERFORM 1 FROM public.proba_fara_nimic LIMIT 1;'), { rel: 'public.proba_fara_nimic AccessShareLock' }],
  ['alt_mod_pe_relatie_a', t => injecteaza(t, '  LOCK TABLE public.proba_regula IN ROW SHARE MODE;'), { rel: 'public.proba_regula RowShareLock' }],
  ['indexul_unei_relatii_a', t => injecteaza(t, '  PERFORM 1 FROM public.proba_baza_vedere LIMIT 1;'), { rel: 'public.proba_baza_vedere_pkey AccessShareLock' }],
]
// mutanții clasei A: fiecare TREBUIE să schimbe rezultatul scenariului lui (altfel scenariul nu discriminează forma corectă)
export const MUTANTI_A = [
  ['fara_clasa_a', [[LINIE_A, '']], 'normal'],
  ['clasa_a_fara_instantaneu', [[V_A, "  SELECT coalesce(array_agg(c.oid), '{}'::oid[]) INTO v_a FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace\n" +
    "   WHERE c.relkind IN ('r', 'p', 'v') AND c.relpersistence <> 't' AND n.nspname NOT IN ('pg_catalog', 'information_schema');\n"]], 'citire_tabela_necitita_de_amprenta'],
  ['clasa_a_orice_mod', [[LINIE_A, "        WHEN lk.o = ANY (v_a) THEN 'A'\n"]], 'alt_mod_pe_relatie_a'],
  ['clasa_a_cu_dep', [[V_A, V_A + "  v_a := v_a || coalesce((SELECT array_agg(i.indexrelid) FROM pg_catalog.pg_index i WHERE i.indrelid = ANY (v_a)), '{}'::oid[]);\n"]],
    'indexul_unei_relatii_a'],
]
// text = null: COPIA runnerului (aplicare completă, cu 3_inreg); altfel textul dat. „Trece” = $post$ a trecut (NOTICE L15_LOCK_SET); un text
// schimbat se oprește apoi, corect, la 3_inreg (statements ≠ artefactul aprobat), după postcondiții
async function scenariu(text) {
  const db = await bazaGoala()
  await db.exec(PLATFORMA_AMPRENTA)
  const t = await tintaPglite(db)
  const fis = genereaza(CALE_MIG, '20270108120000', t.sistem, { tintaDb: t.tintaDb })
  try {
    const r = await prinRunner(db, fis, { copie: text })
    return { trece: true, complet: true, set: setLock(r.jurnal) }
  } catch (e) {
    const set = setLock(e.jurnal || [])
    return set ? { trece: true, complet: false, set, msg: e.message } : { trece: false, msg: e.message }
  } finally { await db.close() }
}
const potrivit = (r, a) => (a.trece ? r.trece : !r.trece && r.msg.startsWith('L15_LOCK_NEDECLARAT: ') && r.msg.includes(a.rel))

async function aplicaRunner(A, { istoricProd = false } = {}) {
  const db = await bazaGoala()
  if (istoricProd) await db.exec(ISTORIC_PROD)
  const t = await tintaPglite(db)
  const fis = genereaza(CALE_MIG, '20270108120000', t.sistem, { tintaDb: t.tintaDb })
  try {
    const r = await prinRunner(db, fis)
    return { db, ...r }
  } catch (e) {
    A.ab.push(`aplicarea prin runner (${istoricProd ? 'istoric producție' : 'istoric teste'}): ${e.message}\n          ${(e.jurnal || []).filter(x => /L15|20270108a/.test(x)).join('\n          ')}`)
    await db.close()
    return null
  }
}

export const BLOCURI_T7 = [
  {
    nume: 't7_post_ok', task: 7, cere: ['7'], fixtura: false,
    async fn(db, A, ctx) {
      const set = setLock(ctx.jurnalAplicare)
      A.ok(set !== '', `NOTICE L15_LOCK_SET la aplicarea standard: „${set}”`)
      A.ok(camp(set, 'E') === '0' && /public\.executie_proiecte:ShareRowExclusiveLock/.test(camp(set, 'M2') || ''), `clasele la aplicarea standard: ${set}`)
      const inv = inventarDinMigrare(citeste(CALE_MIG))
      egal(A, inv.c, CHECKURI.map(([t, n, c]) => `${t}/${n}/${c}`).sort(), 'inventarul CHECK din $post$ = inventar.mjs')
      egal(A, inv.u, UNICE.map(([t, n]) => `${t}/${n}`).sort(), 'lista UNIQUE din $post$ = inventar.mjs')
      // clasa E e goală până la precondiția P-E (amendament revizuit dacă nu)
      A.ok(/v_e_moduri text\[\] := ARRAY\[\]::text\[\];/.test(citeste(CALE_MIG)), 'clasa E goală (precondiția P-E nefurnizată încă)')
    },
  },
  {
    nume: 't7_lock_runner_normal', task: 7, cere: ['7'], fixtura: false,
    async fn(db0, A) {
      const r = await aplicaRunner(A)
      if (!r) return
      const set = setLock(r.jurnal)
      const r1 = camp(set, 'R1') || ''
      A.ok(r1.includes('supabase_migrations.schema_migrations:AccessShareLock') && r1.includes('supabase_migrations.schema_migrations_pkey:AccessShareLock'),
        `R1 conține tabela ȘI cheia primară a istoricului: ${r1}`)
      A.ok(camp(set, 'A') === '0', `clasa A pe schelet (fără vederi pe tabelele existente): ${camp(set, 'A')}`)
      A.ok(Number(camp(set, 'R2')) >= 2 && /public\.executie_proiecte:ShareRowExclusiveLock/.test(camp(set, 'M2') || '') && camp(set, 'E') === '0', `clasele: ${set}`)
      const inreg = (await r.db.query(`SELECT name FROM supabase_migrations.schema_migrations`)).rows.map(x => x.name)
      egal(A, inreg, ['20270108a_executie_dcc_registru'], 'migrarea înregistrată de 3_inreg')
      const oid = (await r.db.query(`SELECT 'information_schema.columns'::regclass::oid::int AS o`)).rows[0].o
      console.log(`        premisa clasei C: oid(information_schema.columns) = ${oid} (< 16384: o clasă pe oid ar fi lăsat-o să treacă); substituții: ${r.subst.join(',') || 'niciuna'}; pid ×${r.pid}; L15_LOCK_SET ${set}`)
      await r.db.close()
    },
  },
  {
    nume: 't7_lock_runner_istoric_prod', task: 7, cere: ['7'], fixtura: false,
    async fn(db0, A) {
      const r = await aplicaRunner(A, { istoricProd: true })
      if (!r) return
      const r1 = (camp(setLock(r.jurnal), 'R1') || '').split(',').sort()
      egal(A, r1, ['supabase_migrations.schema_migrations:AccessShareLock', 'supabase_migrations.schema_migrations_idempotency_key_key:AccessShareLock',
        'supabase_migrations.schema_migrations_pkey:AccessShareLock'], 'R1 pe forma de producție (tabela + cei doi indecși, din pg_index)')
      await r.db.close()
    },
  },
  {
    // runda 7: cazul clonei reprodus local (relații existente citite de amprenta globală în aceeași tranzacție) + clasa A strânsă (scenarii + mutanți)
    nume: 't7_lock_amprenta_platforma', task: 7, cere: ['7'], fixtura: false,
    async fn(db0, A) {
      // (1) cauza: pasul „înainte” SINGUR (fără migrare) lasă AccessShareLock EXACT pe relațiile citite de interogările stocate
      const db = await bazaGoala()
      await db.exec(PLATFORMA_AMPRENTA)
      await db.exec('BEGIN')
      await db.exec(gen('inainte', '0123456789abcdef', '-'))
      const lk = (await db.query(`SELECT n.nspname || '.' || c.relname AS r, l.mode FROM pg_catalog.pg_locks l JOIN pg_catalog.pg_class c ON c.oid = l.relation
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE l.locktype = 'relation' AND c.relpersistence <> 't'
        AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast') ORDER BY 1, 2`)).rows
      await db.exec('ROLLBACK')
      await db.close()
      egal(A, lk.map(x => `${x.r} ${x.mode}`), CITITE_AMPRENTA.map(x => `${x} AccessShareLock`).sort(), 'pasul „înainte” singur: lock-urile pe relațiile existente')
      console.log(`        pasul „înainte” singur: ${lk.map(x => `${x.r} ${x.mode}`).join('; ')}`)
      // (2) scenariile pe migrarea corectă, prin fișierele reale ale runnerului
      const MIG = citeste(CALE_MIG)
      for (const [nume, f, ast] of SCENARII_A) {
        const r = await scenariu(nume === 'normal' ? null : f(MIG))
        A.ok(potrivit(r, ast) && (nume !== 'normal' || r.complet), `scenariul ${nume}: ${r.trece ? (r.complet ? 'aplicat complet' : 'postcondiții trecute, oprit la ' + r.msg.slice(0, 80)) + ', L15_LOCK_SET ' + r.set : r.msg.slice(0, 300)} (aștepta ${ast.trece ? 'aplicare' : 'L15_LOCK_NEDECLARAT cu ' + ast.rel})`)
        if (nume === 'normal' && r.trece) A.ok(camp(r.set, 'A') === String(CITITE_AMPRENTA.length), `clasa A = ${camp(r.set, 'A')} relații (aștepta ${CITITE_AMPRENTA.length}): ${r.set}`)
        console.log(`        scenariul ${nume}: ${r.trece ? (r.complet ? 'aplicat complet' : 'postcondiții trecute') + '; L15_LOCK_SET ' + r.set : r.msg.slice(0, 220)}`)
      }
      // (3) mutanții clasei A schimbă rezultatul scenariului lor
      for (const [nume, inloc, sc] of MUTANTI_A) {
        const [, f, ast] = SCENARII_A.find(s => s[0] === sc)
        const r = await scenariu(f(oData(MIG, inloc)))
        A.ok(!potrivit(r, ast), `mutantul ${nume} prins de scenariul ${sc}: ${r.trece ? 'aplicat' : r.msg.slice(0, 200)}`)
        console.log(`        mutantul ${nume} (scenariul ${sc}): ${r.trece ? 'postcondiții trecute' : r.msg.slice(0, 160)}${potrivit(r, ast) ? ' — NEPRINS' : ' — prins'}`)
      }
    },
  },
  {
    nume: 't7_fara_date_module', task: 7, cere: ['7'], fixtura: false,
    async fn(db0, A) {
      const db = await bazaGoala()
      await db.exec(`INSERT INTO public.app_modules (key, parent_key, name) VALUES ('executie', NULL, 'Executie')`)
      const n = async () => [Number((await db.query('SELECT count(*) AS n FROM public.app_modules')).rows[0].n), Number((await db.query('SELECT count(*) AS n FROM public.user_module_access')).rows[0].n)]
      const inainte = await n()
      const t = await tintaPglite(db)
      const fis = genereaza(CALE_MIG, '20270108120000', t.sistem, { tintaDb: t.tintaDb })
      try { await prinRunner(db, fis) } catch (e) { A.ab.push('aplicarea: ' + e.message) }
      egal(A, await n(), inainte, 'app_modules / user_module_access: același număr de rânduri înainte și după (citit în afara tranzacției)')
      await db.close()
    },
  },
  {
    nume: 'p7_acces_intre_contracte', task: 7, cere: ['5', '6'], fixtura: false,
    async fn(db, A) {
      const c = await configurare(db, A)
      // date pe P1 (BEN/30) și P3 (BEN/43), create de owner / editor nerestrâns
      const date = {}
      for (const p of [c.P1, c.P3]) {
        await trece(A, initSerie(db, U.OWNER, p, 'TM1', 'DES', 'general', 0), `serie ${p}`)
        const d = await trece(A, aloca(db, U.ED, p, 'TM1', 'DES', 'general', { nrFile: 1 }), `doc ${p}`)
        const ax = await trece(A, anexaNoua(db, U.ED, d?.document_id), `anexa ${p}`)
        await trece(A, rpc(db, U.ADM, 'fn_dcc_istoric_importa', [p, 'lot1', JSON.stringify([{ sursa: 'excel_registru', sursa_id: 'H' + p, valori_originale: {} }]), KN()]), `istoric ${p}`)
        const s = await trece(A, rpc(db, U.ED, 'fn_dcc_marcheaza_copiat', [big([ax?.revizie_id]), JSON.stringify(SNAP({ cc: [] })), KN()]), `copiat ${p}`)
        await trece(A, rpc(db, U.ED, 'fn_dcc_confirma_trimis_manual', [big([ax?.revizie_id]), { sql: 'now()' }, 'eu@exemplu.invalid', null, s?.snapshot_id, KN()]), `confirmat ${p}`)
        date[p] = { doc: d?.document_id, fila: d?.revizii?.[0]?.revizie_id, rev: ax?.revizie_id, snap: s?.snapshot_id }
      }
      const P3 = date[c.P3]
      // identitatea la fiecare cont: auth.uid() din ambele surse JWT, rolul authenticated, fără BYPASSRLS
      for (const cont of ['L1', 'EXEC', 'OWNER']) {
        const r = await ca(db, 'authenticated', U[cont], `SELECT auth.uid() AS u, current_user::text AS c, (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS b`, { jwt: 'ambele' })
        egal(A, r.rows?.[0], { u: U[cont], c: 'authenticated', b: false }, `identitatea ${cont}`)
      }
      const vede = async (uid, t, filtru = '') => {
        const r = await ca(db, 'authenticated', uid, `SELECT count(*)::int AS n FROM public.${t} ${filtru}`, { jwt: 'ambele' })
        return r.code ? `${r.code}` : r.rows[0].n
      }
      const peProiect = { dcc_documente: 'proiect_dcc_id', dcc_istoric_aparitii: 'proiect_dcc_id', dcc_snapshoturi: 'proiect_dcc_id', dcc_mesaje: 'proiect_dcc_id', dcc_proiecte: 'id',
        v_dcc_registru: 'proiect_dcc_id' }
      for (const t of [...TABELE_CITITE, 'v_dcc_registru']) {
        if (peProiect[t]) A.ok((await vede(U.L1, t, `WHERE ${peProiect[t]} = ${c.P3}`)) === 0, `L1 nu vede P3 în ${t}`)
        A.ok((await vede(U.EXEC, t)) === 0, `EXEC (doar executie admin) ${t}: ${await vede(U.EXEC, t)}`)
      }
      for (const t of ['dcc_file', 'dcc_anexe', 'dcc_revizii']) A.ok((await vede(U.L1, t, `WHERE document_id = ${P3.doc}`)) === 0, `L1 nu vede P3 în ${t}`)
      A.ok((await vede(U.L1, 'dcc_legaturi', `WHERE revizie_id = ${P3.rev}`)) === 0 && (await vede(U.L1, 'dcc_snapshot_revizii', `WHERE snapshot_id = ${P3.snap}`)) === 0, 'L1 nu vede legăturile P3')
      for (const t of ['dcc_documente', 'dcc_file', 'dcc_anexe', 'dcc_revizii', 'dcc_istoric_aparitii', 'dcc_snapshoturi', 'dcc_mesaje', 'dcc_legaturi', 'dcc_snapshot_revizii', 'v_dcc_registru']) {
        A.ok((await vede(U.L1, t)) > 0, `L1 vede rândurile P1 în ${t} (contra-proba)`)
        A.ok((await vede(U.OWNER, t)) >= 2, `owner vede ambele proiecte în ${t}`)
      }
      // RPC-urile pe P3: 42501 cu ACELAȘI mesaj ca pe un id inexistent
      const inex = await ca(db, 'authenticated', U.L1, `SELECT public.fn_dcc_revizie_noua(999999, NULL, NULL, NULL, NULL, '${KN()}') AS r`, { jwt: 'ambele' })
      const apeluri = [
        ['serii', `SELECT * FROM public.fn_dcc_serii_proiect(${c.P3})`], ['aloca', `SELECT public.fn_dcc_aloca(${c.P3}, 'AAA', 'TM1', 'DES', 'general', 'x', NULL, NULL, '${KN()}')`],
        ['revizie', `SELECT public.fn_dcc_revizie_noua(${P3.doc}, NULL, NULL, NULL, NULL, '${KN()}')`],
        ['fila', `SELECT public.fn_dcc_fila_noua(${P3.doc}, 5, NULL, NULL, '${KN()}')`], ['anexa', `SELECT public.fn_dcc_anexa_noua(${P3.doc}, 'x', NULL, '${KN()}')`],
        ['anuleaza', `SELECT public.fn_dcc_anuleaza(${P3.doc}, NULL, 'x', '${KN()}')`],
        ['copiat', `SELECT public.fn_dcc_marcheaza_copiat(ARRAY[${P3.rev}]::bigint[], '${JSON.stringify(SNAP({ cc: [] }))}'::jsonb, '${KN()}')`],
        ['confirmat', `SELECT public.fn_dcc_confirma_trimis_manual(ARRAY[${P3.fila}]::bigint[], now(), 'eu@exemplu.invalid', NULL, NULL, '${KN()}')`],
        ['import', `SELECT public.fn_dcc_istoric_importa(${c.P3}, 'lot2', '[{"sursa": "mail_trimis", "sursa_id": "X", "valori_originale": {}}]'::jsonb, '${KN()}')`],
      ]
      for (const [ce, sql] of apeluri) {
        const r = await ca(db, 'authenticated', U.L1, sql, { jwt: 'ambele' })
        A.ok(r.code === '42501' && r.message === inex.message, `L1 ${ce} pe P3: ${r.code} „${r.message}” (aștepta 42501 „${inex.message}”)`)
        const e = await ca(db, 'authenticated', U.EXEC, sql, { jwt: 'ambele' })
        A.ok(e.code === '42501', `EXEC ${ce}: ${e.code}`)
        const an = await ca(db, 'anon', null, sql)
        A.ok(an.code === '42501' && /permission denied/.test(an.message), `anon ${ce}: ${an.code} ${an.message}`)
      }
      // scrierile directe: INSERT / UPDATE / DELETE / TRUNCATE pe fiecare tabel -> 42501
      for (const t of TABELE) {
        const col = t === 'dcc_intentii' ? 'cheie' : t === 'dcc_snapshot_revizii' ? 'snapshot_id' : 'id'
        for (const sql of [`INSERT INTO public.${t} DEFAULT VALUES`, `UPDATE public.${t} SET ${col} = ${col}`, `DELETE FROM public.${t}`, `TRUNCATE public.${t}`]) {
          A.cod(await ca(db, 'authenticated', U.L1, sql, { jwt: 'ambele' }), '42501', `L1 direct: ${sql}`)
        }
      }
    },
  },
  {
    nume: 'p7b_doua_proiecte_acelasi_contract', task: 7, cere: ['5', '6'], fixtura: false,
    async fn(db, A) {
      const c = await configurare(db, A)
      await trece(A, initSerie(db, U.OWNER, c.P1, 'TM1', 'COR', 'general', 44), 'serie COR')
      await trece(A, initSerie(db, U.OWNER, c.P1, 'TM1', 'DES', 'general', 0), 'serie DES')
      // P1: D1 (COR, Rev0 + Rev1, anexă), D2 (DES cu 2 file); P2: D3 (COR)
      const d1 = await trece(A, aloca(db, U.L1, c.P1, 'TM1', 'COR', 'general', { titlu: 'Raport P1' }), 'D1')
      const d3 = await trece(A, aloca(db, U.ED, c.P2, 'TM1', 'COR', 'general', { titlu: 'Raport secret P2' }), 'D3 pe P2')
      const d2 = await trece(A, aloca(db, U.L1, c.P1, 'TM1', 'DES', 'general', { nrFile: 2 }), 'D2')
      await trece(A, anexaNoua(db, U.L1, d1?.document_id), 'anexa D1')
      const r1 = await trece(A, revizieNoua(db, U.L1, d1?.document_id), 'Rev1 D1')
      for (const [p, rev, uid] of [[c.P1, d1?.revizii?.[0]?.revizie_id, U.L1], [c.P2, d3?.revizii?.[0]?.revizie_id, U.ED]]) {
        const s = await trece(A, rpc(db, uid, 'fn_dcc_marcheaza_copiat', [big([rev]), JSON.stringify(SNAP({ cc: [] })), KN()]), `copiat ${p}`)
        await trece(A, rpc(db, uid, 'fn_dcc_confirma_trimis_manual', [big([rev]), { sql: 'now()' }, 'eu@exemplu.invalid', null, s?.snapshot_id, KN()]), `confirmat ${p}`)
      }
      await trece(A, rpc(db, U.ADM, 'fn_dcc_istoric_importa', [c.P1, 'lot1', JSON.stringify([{ sursa: 'excel_registru', sursa_id: 'H1', valori_originale: {} },
        { sursa: 'excel_registru', sursa_id: 'H2', valori_originale: {} }]), KN()]), 'istoric P1')
      await trece(A, rpc(db, U.ADM, 'fn_dcc_istoric_importa', [c.P2, 'lot1', JSON.stringify([{ sursa: 'excel_registru', sursa_id: 'H-P2', valori_originale: {} }]), KN()]), 'istoric P2')
      // ca L1 (doar P1): EXACT rândurile P1, numărate de mână
      const asteptat = { dcc_documente: 2, dcc_file: 2, dcc_anexe: 1, dcc_revizii: 5, dcc_istoric_aparitii: 2, dcc_mesaje: 1, dcc_snapshoturi: 1, dcc_snapshot_revizii: 1,
        dcc_legaturi: 1, v_dcc_registru: 4, dcc_proiecte: 1, dcc_contracte: 1 }
      for (const [t, n] of Object.entries(asteptat)) {
        const r = await ca(db, 'authenticated', U.L1, `SELECT count(*)::int AS n FROM public.${t}`, { jwt: 'ambele' })
        A.ok(r.rows?.[0]?.n === n, `L1 ${t}: ${r.rows?.[0]?.n ?? r.code} (aștepta ${n})`)
      }
      const ct = await ca(db, 'authenticated', U.L1, `SELECT beneficiar || '/' || cod_contract AS c FROM public.dcc_contracte`, { jwt: 'ambele' })
      egal(A, ct.rows?.map(x => x.c), ['BEN/30'], 'L1 vede doar contractul propriu')
      const sr = await ca(db, 'authenticated', U.L1, `SELECT tip, ultimul_ocupat FROM public.fn_dcc_serii_proiect(${c.P1}) ORDER BY tip`, { jwt: 'ambele' })
      egal(A, sr.rows, [{ tip: 'COR', ultimul_ocupat: 46 }, { tip: 'DES', ultimul_ocupat: 1 }], 'seria comună include alocarea P2 (divulgarea declarată)')
      const urm = await trece(A, aloca(db, U.L1, c.P1, 'TM1', 'COR', 'general'), 'alocarea P1 după P2')
      A.ok(urm?.secventa === 47, `numărul următor corect: ${urm?.secventa}`)
      const inex = await revizieNoua(db, U.L1, 999999)
      const p2 = await revizieNoua(db, U.L1, d3?.document_id)
      A.ok(p2.code === '42501' && p2.message === inex.message, `revizie pe documentul P2: ${p2.code} „${p2.message}” = inexistent „${inex.message}”`)
      // aceeași identitate de sursă ca un rând P2 -> inserat pe P1 (fără oracol pe istoricul P2)
      const im = await trece(A, rpc(db, U.ADM, 'fn_dcc_istoric_importa', [c.P1, 'lot2', JSON.stringify([{ sursa: 'excel_registru', sursa_id: 'H-P2', valori_originale: {} }]), KN()]),
        'import pe P1 cu identitatea unui rând P2')
      A.ok(im?.inserate === 1 && im?.identice === 0, `inserate 1, nu identice: ${JSON.stringify(im)}`)
      // contractul manual paralel: P6 (Execuție 1, vizibil pentru L1) și P4 (Execuție 4); numărul ocupat de P4 -> DCC_COD_OCUPAT fără date ale ocupantului
      const p6 = await creeazaProiect(db, A, 1, c.c29, c.g1)
      const m4 = await trece(A, alocaManual(db, U.ED, c.P4, 'TM1', 'COR', 7, { titlu: 'Titlu ocupant secret' }), 'manual 7 pe P4')
      const m = await alocaManual(db, U.L1, p6, 'TM1', 'COR', 7)
      // mesajul e textul FIX (nicio cifră, niciun titlu): nu poate conține id-ul, titlul sau proiectul ocupantului
      A.ok(m.code === '23505' && m.message === 'DCC_COD_OCUPAT: codul e deja folosit pe contract' && !m.message.includes('Titlu ocupant') && !/[0-9]/.test(m.message),
        `manual 7 pe P6 (ocupat de P4, document ${m4?.document_id}): ${m.code} „${m.message}”`)
    },
  },
]
