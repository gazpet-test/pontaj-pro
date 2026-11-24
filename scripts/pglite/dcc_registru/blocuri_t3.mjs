// Blocurile Task 3 (secțiunea 3: dreptul, intențiile, politicile [D1], GRANT-urile, vederea), pe fix_baza. Valorile așteptate scrise de mână.
import { U, ca } from './baza.mjs'
import { FIX_RANDURI_P1 } from './fixtura.mjs'
import { TABELE, TABELE_CITITE } from './inventar.mjs'

// funcțiile secțiunilor 1 și 3 și EXECUTE-ul declarat pentru authenticated (internele: niciunul)
export const FUNCTII_S1 = ['fn_dcc_interval_e_canonic(text)', 'fn_dcc_interval_canonic(text)', 'fn_dcc_format_valid(jsonb)',
  'fn_dcc_cod_text(jsonb, text, text, text, text, integer, integer, integer, integer, text)', 'fn_dcc_titlu_scurt(text)',
  'fn_dcc_nume_fisier(jsonb, text, text, text, text, integer, integer, integer, integer, text, text, text)', 'fn_dcc_hash_parametri(text, jsonb)',
  'fn_dcc_tranzitie_permisa(text, text)']
export const FUNCTII_S3_AUTH = ['fn_dcc_server()', 'fn_dcc_e_owner()', 'fn_dcc_drept(bigint, text)', 'fn_dcc_contract_vizibil(bigint)', 'fn_dcc_are_modul()']
export const FUNCTII_S3_INTERNE = ['fn_dcc_intentie_reia(uuid, text, text)', 'fn_dcc_intentie_revendica(uuid, text, text)', 'fn_dcc_intentie_incheie(uuid, jsonb)',
  'fn_dcc_ghid_compatibil_intern(bigint, bigint)', 'fn_dcc_lock_contract(bigint, boolean)', 'fn_dcc_lock_cheie_serie(bigint, text, text, text, text)']

const drept = (db, uid, p, nivel, rol = 'authenticated') => ca(db, rol, uid, `SELECT public.fn_dcc_drept(${p}, ${nivel === null ? 'NULL' : `'${nivel}'`}) AS r`)

export const BLOCURI_T3 = [
  {
    nume: 't3_drept', task: 3, cere: ['3'], fixtura: true,
    async fn(db, A) {
      // [cont, proiectul DCC, {citire, scriere, admin}] — P1 = Execuție 1, P2 = Execuție 2, P3 = Execuție 3
      const M = [
        ['OWNER', 1, [true, true, true]], ['OWNER', 2, [true, true, true]], ['OWNER', 3, [true, true, true]],
        ['ED', 1, [true, true, false]], ['ED', 3, [true, true, false]],
        ['VIEW', 1, [true, false, false]], ['VIEW', 2, [true, false, false]],
        ['ADM', 1, [true, true, true]], ['ADM', 3, [true, true, true]],
        ['EXEC', 1, [false, false, false]], ['EXEC', 2, [false, false, false]],
        ['L1', 1, [true, true, false]], ['L1', 2, [false, false, false]], ['L1', 3, [false, false, false]],
        ['L1V', 1, [true, false, false]], ['L1V', 2, [false, false, false]],
        ['FARA', 1, [false, false, false]],
      ]
      for (const [cont, p, asteptat] of M) {
        for (const [i, nivel] of ['citire', 'scriere', 'admin'].entries()) {
          const r = A.trece(await drept(db, U[cont], p, nivel), `${cont} P${p} ${nivel}`)
          if (r) A.ok(r[0].r === asteptat[i], `${cont} P${p} ${nivel} = ${r[0].r} (aștepta ${asteptat[i]})`)
        }
      }
      for (const [ce, uid, p, nivel] of [['fără JWT', null, 1, 'citire'], ['nivel necunoscut', U.OWNER, 1, 'xyz'], ['nivel NULL', U.OWNER, 1, null],
        ['proiect NULL', U.OWNER, 'NULL', 'citire'], ['proiect inexistent', U.OWNER, 999, 'citire']]) {
        const r = A.trece(await drept(db, uid, p, nivel), ce)
        if (r) A.ok(r[0].r === false, `${ce} = ${r[0].r} (aștepta false, niciodată NULL)`)
      }
      A.cod(await drept(db, null, 1, 'citire', 'anon'), '42501', 'anon fără EXECUTE pe fn_dcc_drept')
      A.cod(await drept(db, null, 1, 'citire', 'service_role'), '42501', 'service_role fără EXECUTE pe fn_dcc_drept')
      // are_modul / contract_vizibil / e_owner / server
      for (const [cont, f, asteptat] of [['OWNER', 'fn_dcc_are_modul()', true], ['VIEW', 'fn_dcc_are_modul()', true], ['EXEC', 'fn_dcc_are_modul()', false],
        ['FARA', 'fn_dcc_are_modul()', false], ['L1', 'fn_dcc_contract_vizibil(1)', true], ['L1', 'fn_dcc_contract_vizibil(3)', false],
        ['L1', 'fn_dcc_contract_vizibil(2)', false], ['OWNER', 'fn_dcc_e_owner()', true], ['ED', 'fn_dcc_e_owner()', false], ['ED', 'fn_dcc_server()', false]]) {
        const r = A.trece(await ca(db, 'authenticated', U[cont], `SELECT public.${f} AS r`), `${cont} ${f}`)
        if (r) A.ok(r[0].r === asteptat, `${cont} ${f} = ${r[0].r} (aștepta ${asteptat})`)
      }
      const srv = (await db.query('SELECT public.fn_dcc_server() AS r')).rows[0].r
      A.ok(srv === true, `fn_dcc_server() ca postgres fără JWT = ${srv}`)
    },
  },
  {
    // SUCCESOR cumulativ al t2_select_inainte_de_politici: SELECT pentru authenticated acordat pe EXACT cele 14 tabele + vedere
    nume: 't3_grant', task: 3, cere: ['3'], fixtura: true,
    async fn(db, A) {
      const rel = [...TABELE, 'v_dcc_registru']
      const cit = [...TABELE_CITITE, 'v_dcc_registru']
      for (const t of rel) {
        for (const rol of ['anon', 'authenticated', 'service_role']) {
          for (const d of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
            const v = (await db.query(`SELECT has_table_privilege('${rol}', 'public.${t}', '${d}') AS v`)).rows[0].v
            const asteptat = rol === 'authenticated' && d === 'SELECT' && cit.includes(t)
            A.ok(v === asteptat, `${rol} ${d} ${t} = ${v} (aștepta ${asteptat})`)
          }
        }
      }
      const pub = (await db.query(`SELECT count(*)::int AS n FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) e
        WHERE c.oid = ANY (ARRAY[${rel.map(t => `'public.${t}'::regclass`).join(', ')}]) AND e.grantee = 0`)).rows[0].n
      A.ok(pub === 0, `PUBLIC are ${pub} drepturi pe tabele / vedere`)
      const col = (await db.query(`SELECT count(*)::int AS n FROM pg_attribute a WHERE a.attrelid = ANY (ARRAY[${rel.map(t => `'public.${t}'::regclass`).join(', ')}])
        AND a.attnum > 0 AND a.attacl IS NOT NULL`)).rows[0].n
      A.ok(col === 0, `drepturi pe coloane: ${col}`)
      const sec = (await db.query(`SELECT count(*)::int AS n FROM pg_class c, unnest(ARRAY['anon', 'authenticated', 'service_role']) r(rol), unnest(ARRAY['USAGE', 'SELECT', 'UPDATE']) d(dr)
        WHERE c.relkind = 'S' AND c.relnamespace = 'public'::regnamespace AND c.relname LIKE 'dcc%' AND has_sequence_privilege(r.rol, c.oid, d.dr)`)).rows[0].n
      A.ok(sec === 0, `drepturi pe secvențe: ${sec}`)
      for (const f of [...FUNCTII_S1, ...FUNCTII_S3_AUTH, ...FUNCTII_S3_INTERNE]) {
        const r = (await db.query(`SELECT has_function_privilege('anon', 'public.${f}', 'EXECUTE') AS an, has_function_privilege('service_role', 'public.${f}', 'EXECUTE') AS sr,
          has_function_privilege('authenticated', 'public.${f}', 'EXECUTE') AS au,
          (SELECT count(*)::int FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e WHERE e.grantee = 0) AS pub
          FROM pg_proc p WHERE p.oid = 'public.${f}'::regprocedure`)).rows[0]
        const auth = !FUNCTII_S3_INTERNE.includes(f)
        A.ok(r.an === false && r.sr === false && r.au === auth && r.pub === 0, `EXECUTE ${f}: anon ${r.an} service_role ${r.sr} authenticated ${r.au} (aștepta ${auth}) PUBLIC ${r.pub}`)
      }
    },
  },
  {
    // SUCCESOR cumulativ al t2_select_inainte_de_politici + partea de citire a CE1 înaintea RPC-urilor
    nume: 't3_rls_fixtura', task: 3, cere: ['3'], fixtura: true,
    async fn(db, A) {
      const numara = async (uid, t, filtru = '') => {
        const r = await ca(db, 'authenticated', uid, `SELECT count(*)::int AS n FROM public.${t} ${filtru}`)
        return r.code ? `${r.code} ${r.message}` : r.rows[0].n
      }
      // ca L1 (editor executie_dcc restrâns la P1): EXACT rândurile P1, 0 ale P2 (același contract) și P3 (alt contract)
      const P1 = { ...FIX_RANDURI_P1, dcc_ghiduri: 6, dcc_ghid_valori: 72, dcc_ghid_intervale: 10 }
      for (const t of TABELE_CITITE) A.ok((await numara(U.L1, t)) === P1[t], `L1 ${t}: ${await numara(U.L1, t)} rânduri (aștepta ${P1[t]})`)
      for (const t of ['dcc_documente', 'dcc_istoric_aparitii', 'dcc_snapshoturi', 'dcc_mesaje']) {
        A.ok((await numara(U.L1, t, 'WHERE proiect_dcc_id <> 1')) === 0, `L1 ${t}: rânduri din alte proiecte`)
      }
      A.ok((await numara(U.L1, 'dcc_revizii', 'WHERE document_id NOT IN (1, 3, 4)')) === 0, 'L1 dcc_revizii: revizii din alte proiecte')
      A.ok((await numara(U.L1, 'v_dcc_registru')) === 5, `L1 v_dcc_registru: ${await numara(U.L1, 'v_dcc_registru')} (aștepta 5)`)
      // owner -> tot; viewer nerestrâns -> tot; doar executie admin -> 0 peste tot (inclusiv configurația)
      // contractele cu cel puțin un proiect DCC: BEN/30, BEN/43, BEN/29 (ALT/30 n-are proiect -> invizibil și pentru owner)
      const TOT = { dcc_ghiduri: 6, dcc_ghid_valori: 72, dcc_ghid_intervale: 10, dcc_contracte: 3, dcc_proiecte: 4, dcc_documente: 5, dcc_file: 3, dcc_anexe: 1,
        dcc_revizii: 7, dcc_istoric_aparitii: 3, dcc_snapshoturi: 2, dcc_snapshot_revizii: 2, dcc_mesaje: 2, dcc_legaturi: 2 }
      for (const cont of ['OWNER', 'VIEW']) {
        for (const t of TABELE_CITITE) A.ok((await numara(U[cont], t)) === TOT[t], `${cont} ${t}: ${await numara(U[cont], t)} (aștepta ${TOT[t]})`)
      }
      for (const t of [...TABELE_CITITE, 'v_dcc_registru']) A.ok((await numara(U.EXEC, t)) === 0, `EXEC (doar executie admin) ${t}: ${await numara(U.EXEC, t)}`)
      for (const t of [...TABELE_CITITE, 'v_dcc_registru']) A.ok((await numara(null, t)) === 0, `authenticated fără JWT ${t}: ${await numara(null, t)}`)
    },
  },
  {
    nume: 't3_vedere', task: 3, cere: ['3'], fixtura: true,
    async fn(db, A) {
      const so = (await db.query(`SELECT reloptions FROM pg_class WHERE oid = 'public.v_dcc_registru'::regclass`)).rows[0].reloptions
      A.ok(Array.isArray(so) && so.includes('security_invoker=on'), `security_invoker: ${so}`)
      // o apariție istorică legată de documentul 1 (aceeași cale ca legarea din PR3) și o Rev1 pe documentul 1 (scrise direct ca postgres)
      await db.exec(`UPDATE public.dcc_istoric_aparitii SET document_id = 1, legat_de = '${U.OWNER}', legat_la = now() WHERE id = 1`)
      await db.exec(`INSERT INTO public.dcc_revizii (contract_id, document_id, revizie, limba, ghid_id, cod_text, nume_fisier_baza, creat_de)
        VALUES (1, 1, 1, 'RO', 1, '30-AAA-TM1-COR-00045.Rev1.RO', '30-AAA-TM1-COR-00045.Rev1.RO', '${U.L1}')`)
      const r = await ca(db, 'authenticated', U.OWNER, `SELECT document_id, tinta, fila, anexa, revizie, cod_text, stare_transport, aparitii_istorice::int AS ai, beneficiar, cod_contract
        FROM public.v_dcc_registru ORDER BY document_id, tinta, fila NULLS FIRST, anexa NULLS FIRST`)
      const rows = A.trece(r, 'owner citește vederea') || []
      const asteptat = [
        [1, 'document', null, null, 1, '30-AAA-TM1-COR-00045.Rev1.RO', 'rezervata', 1, 'BEN', '30'],
        [2, 'document', null, null, 0, '30-AAA-TM1-COR-00046.Rev0.RO', 'trimisa_manual_neverificata', 0, 'BEN', '30'],
        [3, 'anexa', null, 1, 0, '30-AAA-TM1-DES-00010-A01.Rev0.RO', 'rezervata', 0, 'BEN', '30'],
        [3, 'fila', 1, null, 0, '30-AAA-TM1-DES-00010-01.Rev0.RO', 'rezervata', 0, 'BEN', '30'],
        [3, 'fila', 2, null, 0, '30-AAA-TM1-DES-00010-02.Rev0.RO', 'rezervata', 0, 'BEN', '30'],
        [4, 'fila', 1, null, 0, '30-AAA-TM1-DES-00011-01.Rev0.RO', 'rezervata', 0, 'BEN', '30'],
        [5, 'document', null, null, 0, '43-AAA-TM2-COR-00001.Rev0.RO', 'rezervata', 0, 'BEN', '43'],
      ]
      const got = rows.map(x => [Number(x.document_id), x.tinta, x.fila, x.anexa, x.revizie, x.cod_text, x.stare_transport, x.ai, x.beneficiar, x.cod_contract])
      A.ok(JSON.stringify(got) === JSON.stringify(asteptat), `vederea ca owner:\n          ${JSON.stringify(got)}\n          aștepta ${JSON.stringify(asteptat)}`)
      const l1 = A.trece(await ca(db, 'authenticated', U.L1, 'SELECT DISTINCT proiect_dcc_id FROM public.v_dcc_registru'), 'L1 citește vederea') || []
      A.ok(l1.length === 1 && Number(l1[0].proiect_dcc_id) === 1, `L1 vede doar P1 în vedere: ${JSON.stringify(l1)}`)
      A.cod(await ca(db, 'anon', null, 'SELECT 1 FROM public.v_dcc_registru'), '42501', 'anon pe vedere')
    },
  },
]
