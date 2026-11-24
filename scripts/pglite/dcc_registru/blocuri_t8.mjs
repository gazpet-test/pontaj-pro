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

// injecțiile în punctul unic de blocare (textele EXACTE, verificate că apar o dată): o coliziune simulată pe primele n încercări / o încercare lentă
const LOCK_M = '      LOCK TABLE public.executie_proiecte IN SHARE ROW EXCLUSIVE MODE NOWAIT;\n      EXIT;\n'
const coliziune = (t, n) => aplica(t, [[LOCK_M, `      IF v_incercari <= ${n} THEN RAISE EXCEPTION 'coliziune simulata' USING ERRCODE = '55P03'; END IF;\n` + LOCK_M]])
const lent = t => aplica(t, [[LOCK_M, '      LOCK TABLE public.executie_proiecte IN SHARE ROW EXCLUSIVE MODE NOWAIT;\n      PERFORM pg_sleep(1.05);\n      EXIT;\n']])
const LOCK_R = '          LOCK TABLE public.executie_proiecte IN ACCESS EXCLUSIVE MODE NOWAIT;\n          EXIT;\n'

export const BLOCURI_T8 = [
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
