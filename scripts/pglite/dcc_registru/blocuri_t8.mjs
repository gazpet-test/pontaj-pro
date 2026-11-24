// Blocurile Task 8 (livrarea L15 v2) pe PGlite: refuzurile migrării, revenirea (refuzuri, starea pe DEFINIȚII, lock-urile prin fișierele reale ale
// runnerului pe ambele forme ale istoricului, aplicare -> revenire -> reaplicare) și generatorul blocului DEFINITII (--scrie-definitii).
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { U, ca, bazaGoala, caRunner, citeste, pentruPglite, gen, NUME, CALE_MIG, CALE_REV, ROOT, PLAFON_REVENIRE } from './baza.mjs'
import { genereaza, prinRunner, tintaPglite } from './runner.mjs'
import { ISTORIC_PROD } from './blocuri_t7.mjs'
import { TABELE } from './inventar.mjs'
import { KN, rpc } from './rpc.mjs'

const MIG = () => pentruPglite(citeste(CALE_MIG)).text
const REV = () => pentruPglite(citeste(CALE_REV)).text
export const aplicaMig = (db, text = MIG(), o) => caRunner(db, NUME, text, o)
export const revino = (db, text = REV(), o) => caRunner(db, NUME + '_ROLLBACK', text, { l15: 'nimic', plafon: PLAFON_REVENIRE, ...o })
const eroare = async p => { try { await p; return null } catch (e) { return e } }
export function aplica(text, lista) {
  let t = text
  for (const [din, in_] of lista || []) {
    const n = t.split(din).length - 1
    if (n !== 1) throw new Error(`MUTANT_INAPLICABIL: textul apare de ${n} ori: ${din.slice(0, 100)}`)
    t = t.split(din).join(in_)
  }
  return t
}
const numarObiecte = async db => Number((await db.query(`SELECT (SELECT count(*) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND (c.relname LIKE 'dcc\\_%' OR c.relname = 'v_dcc_registru'))
  + (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'fn\\_dcc\\_%') + (SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'trg\\_dcc\\_%') AS n`)).rows[0].n)

// ── blocul DEFINITII: cheile (6 categorii pe tabel + vederea + secvențele + funcțiile din lista revenirii) și valorile reale, cu expresia DEF-ACTUAL
export function cheiDefinitii(rev) {
  const f = /v_functii constant text\[\] := ARRAY\[([\s\S]*?)\];/.exec(rev)[1].match(/'([^']+)'/g).map(x => x.slice(1, -1))
  const k = []
  for (const t of TABELE) for (const c of ['coloane', 'constrangeri', 'indexuri', 'politici', 'triggere', 'acl']) k.push(`${c}:${t}`)
  k.push('vedere:v_dcc_registru', 'coloane:v_dcc_registru', 'acl:v_dcc_registru', 'secvente:')
  for (const x of f) k.push(`functie:${x}`)
  return k
}
export async function valoriDefinitii(db, rev) {
  const expr = rev.slice(rev.indexOf('-- DEF-ACTUAL-START'), rev.indexOf('-- DEF-ACTUAL-END'))
  const chei = cheiDefinitii(rev)
  await db.exec('SET search_path = public, pg_temp')
  const r = await db.query(`SELECT a.cheie, (${expr}\n) AS real FROM (VALUES ${chei.map(k => `('${k.replace(/'/g, "''")}')`).join(', ')}) a(cheie) ORDER BY a.cheie`)
  await db.exec('RESET search_path')
  return r.rows
}
export async function scrieDefinitii() {
  const db = await bazaGoala()
  await aplicaMig(db)
  const rev = citeste(CALE_REV)
  const rows = await valoriDefinitii(db, rev)
  const lipsa = rows.filter(x => x.real === null)
  if (lipsa.length) throw new Error('chei fără valoare: ' + lipsa.map(x => x.cheie).join(', '))
  const bloc = rows.map(x => `        ('${x.cheie.replace(/'/g, "''")}', '${x.real}'),`).join('\n')
  const brut = readFileSync(join(ROOT, CALE_REV), 'utf8')
  const nl = brut.includes('\r\n') ? '\r\n' : '\n'
  const a = brut.indexOf('-- DEFINITII-START'), b = brut.indexOf('        -- DEFINITII-END')
  const nou = brut.slice(0, brut.indexOf('\n', a) + 1) + (bloc + '\n        (\'\', \'\')\n').replace(/\n/g, nl) + brut.slice(b)
  writeFileSync(join(ROOT, CALE_REV), nou)
  await db.close()
  return rows.length
}

// ── lista OBIECTELOR din manifestul L15 v2 (familie TAB eticheta TAB operatie): migrarea între pașii „înainte” și „după” ai amprentei globale
// (GLOBAL aprobat „-”, manifest „-”), apoi ROLLBACK; diferențele (NOTICE L15_DIF) = obiectele create. PG18 adaugă constrângerile NOT NULL: scoase.
export const CALE_OBIECTE = `supabase/tests/${NUME}.l15.obiecte.tsv`
const listaObiecte = text => [...new Set(text.split('\n').filter(l => l && !l.startsWith('#')).map(l => l.split('\t').slice(0, 3).join('\t')))].sort()
const faraPg18 = l => !/^constrangere\tconstrangere tabel [^\t]*_not_null\tcreat$/.test(l)
export async function obiecteGenerate() {
  const db = await bazaGoala()
  const T = 'fedcba9876543210'
  const jurnal = []
  try {
    await db.exec('SET transaction_timeout = 15000;')
    await db.exec(`BEGIN ISOLATION LEVEL READ COMMITTED; SELECT set_config('gazpet.livrare_migrare', '${NUME}:' || txid_current(), true);
      SELECT set_config('gazpet.plafon_tranzactie', '15000:' || txid_current(), true);`)
    await db.exec(gen('inainte', T, '-') + '\n' + MIG() + '\n;\n' + gen('dupa', T, '-', '-'), { onNotice: n => jurnal.push(n.message) })
  } catch { /* pasul „după” fără manifest refuză DUPĂ ce a tipărit diferențele */ }
  try { await db.exec('ROLLBACK') } catch { /* deja */ }
  await db.exec('SET transaction_timeout = 0;')
  await db.close()
  return listaObiecte(jurnal.filter(m => m.startsWith('L15_DIF ')).map(m => m.slice('L15_DIF '.length)).join('\n')).filter(faraPg18)
}
export async function scrieObiecte() {
  const l = await obiecteGenerate()
  writeFileSync(join(ROOT, CALE_OBIECTE), `# ${NUME}: obiectele din manifestul L15 v2 (familie TAB eticheta TAB operatie), fara amprente; PG17 (constrangerile NOT NULL ale PG18 scoase)\n` + l.join('\n') + '\n')
  return l.length
}

// injecțiile în punctul unic de blocare (textele EXACTE, verificate că apar o dată): o coliziune simulată pe primele n încercări / o încercare lentă
const LOCK_M = '      LOCK TABLE public.executie_proiecte IN SHARE ROW EXCLUSIVE MODE NOWAIT;\n      EXIT;\n'
const coliziune = (t, n) => aplica(t, [[LOCK_M, `      IF v_incercari <= ${n} THEN RAISE EXCEPTION 'coliziune simulata' USING ERRCODE = '55P03'; END IF;\n` + LOCK_M]])
const lent = t => aplica(t, [[LOCK_M, '      LOCK TABLE public.executie_proiecte IN SHARE ROW EXCLUSIVE MODE NOWAIT;\n      PERFORM pg_sleep(1.05);\n      EXIT;\n']])
const LOCK_R = '          LOCK TABLE public.executie_proiecte IN ACCESS EXCLUSIVE MODE NOWAIT;\n          EXIT;\n'

export const BLOCURI_T8 = [
  {
    // dry-run-ul clonei (supabase/tests/…_dryrun.sql + …_clona_istoric.sql) rulat întreg pe PGlite de validatorul lui, în proces separat
    nume: 'dryrun_pglite', task: 8, cere: ['7'], fixtura: false, curat: true,
    async fn(_db, A) {
      const { spawnSync } = await import('node:child_process')
      const r = spawnSync(process.execPath, [join(ROOT, 'scripts/pglite/dcc_registru/dryrun_pglite.mjs')], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1024 * 1024 * 64 })
      const out = (r.stdout || '') + (r.stderr || '')
      A.ok(r.status === 0 && out.includes('DRYRUN_PGLITE_OK'), `validatorul dry-run-ului: ieșire ${r.status}; ${out.split('\n').filter(l => /NU |DRYRUN|t_.* ok|BLOCURI/.test(l)).slice(-4).join(' | ').slice(0, 300)}`)
    },
  },
  {
    nume: 'l15_obiecte', task: 8, cere: ['7'], fixtura: false, curat: true,
    async fn(_db, A) {
      const gener = await obiecteGenerate()
      let scris = []
      try { scris = listaObiecte(citeste(CALE_OBIECTE)) } catch { A.ab.push(`${CALE_OBIECTE} lipsește (rulează --scrie-obiecte)`); return }
      const lipsa = scris.filter(x => !gener.includes(x)), plus = gener.filter(x => !scris.includes(x))
      A.ok(gener.length > 150 && !lipsa.length && !plus.length, `manifestul generat (${gener.length} obiecte) = lista din repo (${scris.length}); lipsă [${lipsa.slice(0, 5).join(' | ')}] în plus [${plus.slice(0, 5).join(' | ')}]`)
    },
  },
  {
    // Task 9: scriptul de catalog (NU migrare, NERULAT pe producție) și revenirea lui, pe PGlite
    nume: 'k_catalog_modul', task: 9, cere: ['7'], fixtura: false, curat: true,
    async fn(_db, A) {
      const CAT = citeste('scripts/executie_dcc_modul_catalog.sql'), CREV = citeste('scripts/executie_dcc_modul_catalog_revenire.sql')
      const db = await bazaGoala()
      await db.exec(`INSERT INTO public.app_modules (key, parent_key, name) VALUES ('executie', NULL, 'Executie')`)
      // baza de probă vine cu drepturi sintetice pe executie_dcc (schelet fără FK spre catalog); catalogul real pornește fără niciunul
      await db.exec(`DELETE FROM public.user_module_access WHERE module = 'executie_dcc'`)
      const fara = await eroare(db.exec(CAT))
      A.ok(fara && /migrarea 20270108a nu e aplicata/.test(fara.message), `catalogul înaintea migrării: ${fara?.message || 'a trecut'}`)
      try { await db.exec('ROLLBACK') } catch { /* deja */ }
      await aplicaMig(db)
      const e1 = await eroare(db.exec(CAT))
      const r = (await db.query(`SELECT key, parent_key, is_active, show_on_homepage FROM public.app_modules WHERE key = 'executie_dcc'`)).rows
      A.ok(!e1 && r.length === 1 && r[0].parent_key === 'executie' && r[0].is_active && !r[0].show_on_homepage, `catalogul: ${e1?.message || JSON.stringify(r)}`)
      A.ok((await db.query(`SELECT count(*)::int AS n FROM public.user_module_access WHERE module = 'executie_dcc'`)).rows[0].n === 0, 'catalogul nu acordă niciun drept')
      const e2 = await eroare(db.exec(CAT)); try { await db.exec('ROLLBACK') } catch { /* deja */ }
      A.ok(e2 && /cheia exista deja/.test(e2.message), `a doua rulare: ${e2?.message || 'a trecut'}`)
      // revenirea refuză cât există un drept pe cheie; apoi, fără drepturi, șterge exact rândul
      await db.exec(`INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES ('${U.FARA}', 'executie_dcc', 'viewer')`)
      const e3 = await eroare(db.exec(CREV)); try { await db.exec('ROLLBACK') } catch { /* deja */ }
      A.ok(e3 && /exista drepturi pe executie_dcc/.test(e3.message) && (await db.query(`SELECT count(*)::int AS n FROM public.app_modules WHERE key = 'executie_dcc'`)).rows[0].n === 1,
        `revenirea cu un drept existent: ${e3?.message || 'a trecut'}`)
      await db.exec(`DELETE FROM public.user_module_access WHERE module = 'executie_dcc'`)
      const e4 = await eroare(db.exec(CREV))
      A.ok(!e4 && (await db.query(`SELECT count(*)::int AS n FROM public.app_modules WHERE key = 'executie_dcc'`)).rows[0].n === 0, `revenirea: ${e4?.message || 'cheia scoasă'}`)
      await db.close()
    },
  },
  {
    nume: 'm_refuzuri_migrare', task: 8, cere: ['7'], fixtura: false, curat: true,
    async fn(_db, A) {
      const cazuri = [
        ['fără marcaj', db => aplicaMig(db, MIG(), { marcaj: false }), /garda start invalida/],
        ['fără plafon', db => aplicaMig(db, MIG(), { plafon: 0 }), /PLAFON_TRANZACTIE lipsa/],
        ['plafon greșit (5000)', db => aplicaMig(db, MIG(), { plafon: 5000 }), /PLAFON_TRANZACTIE lipsa/],
        ['plafon fără marcaj', db => aplicaMig(db, MIG(), { marcajPlafon: false }), /PLAFON_TRANZACTIE lipsa/],
        ['fără amprenta globală', db => aplicaMig(db, MIG(), { l15: 'nimic' }), /AMPRENTA_GLOBALA_LIPSA/],
        ['tabela „înainte” dintr-o tranzacție veche', async db => {
          await db.exec('BEGIN'); await db.exec(gen('inainte', 'abcdefabcdefabcd', '-')); await db.exec('COMMIT')
          return aplicaMig(db, MIG(), { l15: 'nimic' })
        }, /AMPRENTA_GLOBALA_LIPSA/],
        ['fn_executie_proiect_permis cu alt corp', async db => {
          await db.exec(`CREATE OR REPLACE FUNCTION public.fn_executie_proiect_permis(p_proiect bigint, p_scriere boolean DEFAULT false) RETURNS boolean
            LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$ SELECT true $f$`)
          return aplicaMig(db)
        }, /lantul de drept \(inainte\) difera/],
        ['coloană lipsă (profiles.is_owner)', async db => { await db.exec('ALTER TABLE public.profiles RENAME COLUMN is_owner TO is_owner_x'); return aplicaMig(db) }, /coloana profiles\.is_owner lipseste/],
        ['coloană cu alt tip (user_module_access.module)', async db => {
          await db.exec('ALTER TABLE public.user_module_access ALTER COLUMN module TYPE integer USING length(module)'); return aplicaMig(db)
        }, /coloana user_module_access\.module lipseste sau are alt tip/],
        ['reaplicare', async db => { await aplicaMig(db); return aplicaMig(db) }, /obiectele exista deja/],
        ['bugetul lock-ului depășit (încercare lentă)', db => aplicaMig(db, lent(MIG())), /BUGET_LOCK/],
        ['bugetul lock-ului depășit (coliziuni)', db => aplicaMig(db, coliziune(MIG(), 1000)), /BUGET_LOCK/],
      ]
      for (const [ce, f, re] of cazuri) {
        const db = await bazaGoala()
        const e = await eroare(f(db))
        const n = await numarObiecte(db)
        A.ok(e && re.test(e.message) && (ce === 'reaplicare' ? n > 0 : n === 0), `${ce}: ${e ? e.code + ' ' + e.message.slice(0, 160) : 'a trecut'}; obiecte după: ${n}`)
        if (/bugetul/.test(ce)) A.ok(e && e.code === '55P03', `${ce}: SQLSTATE ${e?.code} (aștepta 55P03)`)
        await db.close()
      }
      // contra-proba: o coliziune pe primele 2 încercări, apoi lock-ul se ia -> aplicarea trece
      const db = await bazaGoala()
      const e = await eroare(aplicaMig(db, coliziune(MIG(), 2)))
      A.ok(!e && (await numarObiecte(db)) > 0, `2 coliziuni, apoi lock obținut: ${e ? e.message : 'aplicat'}`)
      await db.close()
    },
  },
  {
    nume: 'rev_ciclu', task: 8, cere: ['7'], fixtura: false, curat: true,
    async fn(_db, A) {
      const db = await bazaGoala()
      await aplicaMig(db)
      const n0 = await numarObiecte(db)
      const j = await revino(db).catch(e => { A.ab.push('revenirea: ' + e.message); return [] })
      A.ok((await numarObiecte(db)) === 0, `după revenire: ${await numarObiecte(db)} obiecte (înainte ${n0})`)
      A.ok(j.some(m => m.startsWith('L15_LOCK_SET_REVENIRE ')), 'NOTICE L15_LOCK_SET_REVENIRE')
      const e = await eroare(aplicaMig(db))
      A.ok(!e && (await numarObiecte(db)) === n0, `reaplicarea: ${e ? e.message : 'ok'}, ${await numarObiecte(db)} obiecte`)
      // după reaplicare funcționează (o creare prin RPC)
      A.trece(await rpc(db, U.OWNER, 'fn_dcc_contract_creeaza', ['BEN', '30', 'automat', null, KN()]), 'RPC după reaplicare')
      await db.close()
    },
  },
  {
    nume: 'rev_refuzuri', task: 8, cere: ['7'], fixtura: false, curat: true,
    async fn(_db, A) {
      const cazuri = [
        ['fără marcaj', null, db => revino(db, REV(), { marcaj: false }), /garda invalida/],
        ['plafonul migrării (15000)', null, db => revino(db, REV(), { plafon: 15000 }), /PLAFON_TRANZACTIE lipsa/],
        ['un rând în dcc_intentii', async db => { await rpc(db, U.OWNER, 'fn_dcc_contract_creeaza', ['BEN', '30', 'automat', null, KN()]) }, db => revino(db), /REVENIRE_CU_DATE/],
        ['un trigger dezactivat', async db => { await db.exec('ALTER TABLE public.dcc_revizii DISABLE TRIGGER trg_dcc_revizii_garda') }, db => revino(db), /definitii: triggere:dcc_revizii/],
        ['un corp de funcție schimbat', async db => {
          await db.exec(`CREATE OR REPLACE FUNCTION public.fn_dcc_server() RETURNS boolean LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $f$ BEGIN RETURN true; END $f$`)
        }, db => revino(db), /definitii: functie:fn_dcc_server\(\)/],
        ['un drept în plus', async db => { await db.exec('GRANT INSERT ON public.dcc_documente TO authenticated') }, db => revino(db), /definitii: acl:dcc_documente/],
        ['un CHECK înlocuit sub același nume', async db => {
          await db.exec(`ALTER TABLE public.dcc_file DROP CONSTRAINT dcc_file_fila_ck, ADD CONSTRAINT dcc_file_fila_ck CHECK (fila BETWEEN 1 AND 9999)`)
        }, db => revino(db), /definitii: constrangeri:dcc_file/],
        ['o politică schimbată', async db => {
          await db.exec(`DROP POLICY dcc_documente_citire ON public.dcc_documente; CREATE POLICY dcc_documente_citire ON public.dcc_documente FOR SELECT TO authenticated USING (true)`)
        }, db => revino(db), /definitii: politici:dcc_documente/],
        ['o vedere străină dependentă', async db => { await db.exec('CREATE VIEW public.v_straina AS SELECT id FROM public.dcc_documente') }, db => revino(db), /obiecte straine depind/],
        ['bugetul lock-ului depășit', null, db => revino(db, aplica(REV(), [[LOCK_R, '          LOCK TABLE public.executie_proiecte IN ACCESS EXCLUSIVE MODE NOWAIT;\n          PERFORM pg_sleep(1.05);\n          EXIT;\n']])), /BUGET_LOCK/],
      ]
      for (const [ce, pregatire, f, re] of cazuri) {
        const db = await bazaGoala()
        await aplicaMig(db)
        if (pregatire) await pregatire(db)
        const n0 = await numarObiecte(db)
        const e = await eroare(f(db))
        A.ok(e && re.test(e.message) && (await numarObiecte(db)) === n0, `revenire ${ce}: ${e ? e.message.slice(0, 200) : 'a trecut'}; obiecte ${await numarObiecte(db)} / ${n0}`)
        await db.close()
      }
    },
  },
  {
    // revenirea prin FIȘIERELE REALE ale runnerului (plafonul 2000, fără --plafon-extins, fără amprentă globală), pe AMBELE forme ale istoricului:
    // setul ei de lock-uri (M1' + executie_proiecte + R1 cu cheia primară + C) e verificat de propria postcondiție
    nume: 'rev_lock_set', task: 8, cere: ['7'], fixtura: false, curat: true,
    async fn(_db, A) {
      for (const prod of [false, true]) {
        const db = await bazaGoala()
        if (prod) await db.exec(ISTORIC_PROD)
        await aplicaMig(db)
        const t = await tintaPglite(db)
        const fis = genereaza(CALE_REV, '20270108120001', t.sistem, { tintaDb: t.tintaDb, plafon: PLAFON_REVENIRE, extins: false })
        try {
          const r = await prinRunner(db, fis, { l15: false })
          const set = (r.jurnal.find(m => m.startsWith('L15_LOCK_SET_REVENIRE ')) || '').slice(22)
          const r1 = (/R1=(\S+)/.exec(set) || [])[1] || ''
          const asteptR1 = prod ? 3 : 2
          A.ok(r1.split(',').length === asteptR1 && r1.includes('supabase_migrations.schema_migrations_pkey:AccessShareLock'),
            `revenirea (istoric ${prod ? 'producție' : 'teste'}): R1 = ${r1} (aștepta ${asteptR1} relații, cu cheia primară)`)
          A.ok(/M2=[^ ]*public\.executie_proiecte:AccessExclusiveLock/.test(set), `revenirea: M2 = ${(/M2=(\S+)/.exec(set) || [])[1]} (modul explicit ACCESS EXCLUSIVE)`)
          A.ok((await numarObiecte(db)) === 0, 'nimic rămas după revenirea prin runner')
          console.log(`        L15_LOCK_SET_REVENIRE (istoric ${prod ? 'producție' : 'teste'}): ${set}`)
        } catch (e) {
          A.ab.push(`revenirea prin runner (istoric ${prod ? 'producție' : 'teste'}): ${e.message}`)
        }
        await db.close()
      }
    },
  },
]
