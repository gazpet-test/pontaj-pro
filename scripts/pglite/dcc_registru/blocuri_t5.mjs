// Blocurile Task 5 (secțiunea 5: RPC-urile de configurare și ale registrului). Datele se creează PRIN RPC (baza fără fixtură); valorile
// așteptate scrise de mână (codurile complete, secvențele, stările).
import { U, ca, sonda, citeste, CALE_MIG } from './baza.mjs'
import { F } from './fixtura.mjs'
import { K, KN, rpc, trece, tab, GHIDURI, ghid, creeazaGhid, creeazaContract, creeazaProiect, seteazaProiect, configurare, initSerie, aloca, alocaManual,
  revizieNoua, filaNoua, anexaNoua, anuleaza, numar, numaraTot } from './rpc.mjs'

const RE = cod => new RegExp('^' + cod + ':')

// injecția „retragerea comisă cât RPC-ul a așteptat” (PGlite are o singură conexiune; proba cu două sesiuni reale e C7 / C9 din concurenta.sh):
// funcția din migrare (textul EXACT, găsit o dată, până la primul `END $f$;`) e recreată cu O linie în plus înaintea ancorei (care trebuie să
// apară EXACT o dată în corp și să fie pe drumul care continuă scrierea: după advisory / după claim-ul reușit), linie care retrage statutul de
// owner al apelantului în tranzacția RPC-ului, DOAR când proba cere punctul respectiv (dcc_proba.retrage). Locul = punctul de așteptare real:
// claim-ul (INSERT pe indexul unic al cheii) sau advisory-ul pe contract.
export function cuRetragere(cap, punct, ancora) {
  const MIG = citeste(CALE_MIG)
  if (MIG.split(cap).length !== 2) throw new Error('INJECTIE: ' + cap + ' nu apare exact o data')
  const i = MIG.indexOf(cap), j = MIG.indexOf('END $f$;', i) + 'END $f$;'.length
  const corp = MIG.slice(i, j)
  if (corp.split(ancora).length !== 2) throw new Error('INJECTIE: ancora ' + JSON.stringify(ancora) + ' nu apare exact o data in ' + cap)
  return corp.replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION')
    .replace(ancora, `  IF current_setting('dcc_proba.retrage', true) = '${punct}' THEN UPDATE public.profiles SET is_owner = false WHERE id = auth.uid(); END IF;\n` + ancora)
}
// runda r6 (Jakarinos #1182 r5, P1): retragerea comisă cât o SCRIERE a așteptat (cheia străină, indexul unic, ON CONFLICT). Linia intră la începutul
// corpului unui TRIGGER al tabelului scris (primul `BEGIN` al funcției), deci după reverificarea de după lock a RPC-ului și înaintea reverificării
// finale; retrage ambele surse ale dreptului (is_owner + executie_dcc) DOAR pentru apelant și DOAR la punctul 'scriere'.
export function cuRetragereLaScriere(cap) {
  const MIG = citeste(CALE_MIG)
  if (MIG.split(cap).length !== 2) throw new Error('INJECTIE: ' + cap + ' nu apare exact o data')
  const i = MIG.indexOf(cap), j = MIG.indexOf('END $f$;', i) + 'END $f$;'.length
  const corp = MIG.slice(i, j)
  const b = corp.indexOf('\nBEGIN\n')
  if (b < 0) throw new Error('INJECTIE: ' + cap + ' fara BEGIN')
  const linie = "  IF current_setting('dcc_proba.retrage', true) = 'scriere' THEN UPDATE public.profiles SET is_owner = false WHERE id = auth.uid();" +
    " DELETE FROM public.user_module_access WHERE profile_id = auth.uid() AND module = 'executie_dcc'; END IF;\n"
  return (corp.slice(0, b + 7) + linie + corp.slice(b + 7)).replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION')
}
const argsProiect = (exec, contract, ghidId, versiune, k, adresa = 'dcc@exemplu.invalid') =>
  [exec, contract, ghidId, 'AAA', 'RO', adresa, tab([]), '{}', null, 15, versiune, k]
// comparația pe forma canonică (cheile obiectelor sortate: jsonb își ordonează cheile după lungime)
export const can = x => JSON.stringify(x, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(q => [q, v[q]])) : v))
export const egal = (A, a, b, ce) => A.ok(can(a) === can(b), `${ce}: ${can(a)} (aștepta ${can(b)})`)

export const BLOCURI_T5 = [
  {
    nume: 't5_config', task: 5, cere: ['5'], fixtura: false,
    async fn(db, A) {
      const g = await trece(A, rpc(db, U.OWNER, 'fn_dcc_ghid_creeaza', [JSON.stringify(GHIDURI.G1), K(1)]), 'owner creează ghidul')
      egal(A, g && { ...g, ghid_id: typeof g.ghid_id }, { cod: 'GL1', valori: 12, reluat: false, ghid_id: 'number', versiune: 1, intervale: 1 }, 'rezultatul ghidului')
      A.cod(await rpc(db, U.ED, 'fn_dcc_ghid_creeaza', [JSON.stringify(ghid('GX', 1, F.lot1, [['general', 1, 9]])), K(2)]), '42501', 'editorul nu creează ghiduri', { re: RE('DCC_FARA_DREPT') })
      A.cod(await rpc(db, U.ADM, 'fn_dcc_contract_creeaza', ['XYZ', '11', 'automat', null, K(3)]), '42501', 'adminul DCC nu creează contracte', { re: RE('DCC_FARA_DREPT') })
      A.cod(await rpc(db, U.OWNER, 'fn_dcc_ghid_creeaza', [JSON.stringify(ghid('GS', 1, F.dde, [['SR1', 100, 199], ['SR2', 150, 249]])), K(4)]), '23P01',
        'intervale suprapuse prin RPC', { re: RE('DCC_INTERVALE_SUPRAPUSE') })
      const dublu = ghid('GD', 1, F.lot1, [['general', 1, 99999]]); dublu.valori.push({ categorie: 'tip', cod: ' cor ' })
      A.cod(await rpc(db, U.OWNER, 'fn_dcc_ghid_creeaza', [JSON.stringify(dublu), K(5)]), '22023', 'valoare dublată (după normalizare)', { re: RE('DCC_LISTA_DUBLURI') })
      const strain = { ...ghid('GC', 1, F.lot1, [['general', 1, 99999]]), alta: 1 }
      A.cod(await rpc(db, U.OWNER, 'fn_dcc_ghid_creeaza', [JSON.stringify(strain), K(6)]), '22023', 'cheie necunoscută în ghid', { re: RE('DCC_CHEI_NECUNOSCUTE') })
      const strain2 = ghid('GC', 1, F.lot1, [['general', 1, 99999]]); strain2.valori[0].alta = 1
      A.cod(await rpc(db, U.OWNER, 'fn_dcc_ghid_creeaza', [JSON.stringify(strain2), K(7)]), '22023', 'cheie necunoscută într-o valoare', { re: RE('DCC_CHEI_NECUNOSCUTE') })
      const fmt = ghid('GF', 1, F.lot2_cod, [['general', 1, 99999]])
      A.cod(await rpc(db, U.OWNER, 'fn_dcc_ghid_creeaza', [JSON.stringify(fmt), K(8)]), '22023', 'limba lipsă din ambele formate', { re: RE('DCC_FORMAT_INVALID') })
      const norm = await trece(A, rpc(db, U.OWNER, 'fn_dcc_ghid_creeaza', [JSON.stringify(ghid(' gn ', 1, F.dde, [[' General ', 300, 99999], ['sr1', 100, 199]])), K(9)]), 'ghid cu intervale de normalizat')
      if (norm) {
        const iv = (await db.query(`SELECT interval FROM public.dcc_ghid_intervale WHERE ghid_id = ${norm.ghid_id} ORDER BY interval`)).rows.map(r => r.interval)
        egal(A, [norm.cod, iv], ['GN', ['SR1', 'general']], 'codul ghidului și intervalele stocate în forma canonică')
      }
      const c = await creeazaContract(db, A, ' ben ', '30', 'Automat')
      const ct = (await db.query(`SELECT beneficiar, cod_contract, mod_alocare, creat_prin, creat_de FROM public.dcc_contracte WHERE id = ${c}`)).rows[0]
      egal(A, ct, { beneficiar: 'BEN', cod_contract: '30', mod_alocare: 'automat', creat_prin: 'om', creat_de: U.OWNER }, 'contractul normalizat')
      const p = await trece(A, seteazaProiect(db, A, 1, c, g?.ghid_id), 'owner creează proiectul DCC')
      egal(A, p && { versiune: p.versiune, creat: p.creat, reluat: p.reluat }, { versiune: 1, creat: true, reluat: false }, 'rezultatul creării proiectului')
      A.cod(await seteazaProiect(db, A, 2, c, g?.ghid_id, { uid: U.ED }), '42501', 'editorul nu setează proiecte', { re: RE('DCC_FARA_DREPT') })
      const gx = await creeazaGhid(db, A, { ...ghid('GE', 1, F.lot1, [['general', 1, 99999]]), valori: ghid('GE', 1, F.lot1, []).valori.filter(v => v.cod !== 'AAA') })
      A.cod(await seteazaProiect(db, A, 2, c, gx), '22023', 'emitentul proiectului din afara ghidului', { re: RE('DCC_EMITENT_STRAIN') })
      const u1 = await trece(A, seteazaProiect(db, A, 1, c, g?.ghid_id, { versiune: 1, adresa: 'alt@exemplu.invalid', cc: ['B@exemplu.invalid', ' a@exemplu.invalid '] }), 'CAS cu versiunea curentă')
      egal(A, u1 && [u1.versiune, u1.creat], [2, false], 'versiunea după CAS')
      const pr = (await db.query(`SELECT cc_lista, adresa_dcc FROM public.dcc_proiecte WHERE id = ${p?.proiect_dcc_id}`)).rows[0]
      egal(A, pr, { cc_lista: ['a@exemplu.invalid', 'b@exemplu.invalid'], adresa_dcc: 'alt@exemplu.invalid' }, 'CC normalizat și sortat')
      A.cod(await seteazaProiect(db, A, 1, c, g?.ghid_id, { versiune: 1 }), '40001', 'CAS cu versiune veche', { re: RE('DCC_CONFLICT_VERSIUNE') })
      A.cod(await seteazaProiect(db, A, 1, c, g?.ghid_id, { versiune: 2, cc: ['x@exemplu.invalid', 'X@exemplu.invalid'] }), '22023', 'CC dublat', { re: RE('DCC_LISTA_DUBLURI') })
      // [D2] modul: alocarea automată pe contract manual / manuală pe contract automat / seria pe contract manual -> refuz
      const cm = await creeazaContract(db, A, 'BEN', '29', 'manual')
      const pm = await creeazaProiect(db, A, 4, cm, g?.ghid_id)
      A.cod(await aloca(db, U.ED, pm, 'TM1', 'COR', 'general'), 'P0001', 'alocare automată pe contract manual', { re: RE('DCC_MOD_MANUAL') })
      A.cod(await initSerie(db, U.OWNER, pm, 'TM1', 'COR', 'general', 0), 'P0001', 'inițializare pe contract manual', { re: RE('DCC_MOD_MANUAL') })
      A.cod(await alocaManual(db, U.ED, p?.proiect_dcc_id, 'TM1', 'COR', 7), 'P0001', 'alocare manuală pe contract automat', { re: RE('DCC_MOD_AUTOMAT') })
      // o serie scrisă direct pe contractul manual (calea directă) -> alocarea manuală pe cheie refuză DCC_SERIE_AUTOMATA
      await db.exec(`INSERT INTO public.dcc_serii (contract_id, emitent, tematica, tip, interval, ghid_id, limita_inf, limita_sup, prag_initial, ultimul_ocupat, motiv_prag,
        initializata_prin) VALUES (${cm}, 'AAA', 'TM1', 'COR', 'general', ${g?.ghid_id}, 1, 99999, 0, 0, 'proba', 'server')`)
      A.cod(await alocaManual(db, U.ED, pm, 'TM1', 'COR', 7), 'P0001', 'alocare manuală pe o cheie cu serie', { re: RE('DCC_SERIE_AUTOMATA') })
      A.trece(await alocaManual(db, U.ED, pm, 'TM2', 'COR', 7), 'alocare manuală pe o cheie fără serie (contra-proba)')
    },
  },
  {
    nume: 't5_intentie', task: 5, cere: ['5'], fixtura: false,
    async fn(db, A) {
      const a = await trece(A, rpc(db, U.OWNER, 'fn_dcc_contract_creeaza', ['BEN', '30', 'automat', 'x', K(11)]), 'prima creare')
      const b = await trece(A, rpc(db, U.OWNER, 'fn_dcc_contract_creeaza', [' ben', '30 ', 'automat', ' x ', K(11)]), 'aceeași cheie, aceiași parametri (normalizați)')
      egal(A, b && { ...b, reluat: false }, a && { ...a, reluat: false }, 'același rezultat')
      A.ok(b && b.reluat === true && a && a.reluat === false, `reluat: ${a?.reluat} / ${b?.reluat}`)
      A.ok((await numar(db, 'dcc_contracte')) === 1, 'un singur contract')
      A.cod(await rpc(db, U.OWNER, 'fn_dcc_contract_creeaza', ['BEN', '31', 'automat', 'x', K(11)]), '22023', 'aceeași cheie, alți parametri', { re: RE('DCC_CHEIE_ALTI_PARAMETRI') })
      A.cod(await rpc(db, U.OWNER, 'fn_dcc_ghid_creeaza', [JSON.stringify(GHIDURI.G1), K(11)]), '22023', 'aceeași cheie, altă operație', { re: RE('DCC_CHEIE_ALTI_PARAMETRI') })
      A.cod(await rpc(db, U.OWNER, 'fn_dcc_contract_creeaza', ['BEN', '30', 'automat', 'x', null]), '22023', 'cheie NULL', { re: RE('DCC_PARAMETRU_INVALID') })
      const i = (await db.query(`SELECT operatie, actor, autor, rezultat IS NOT NULL AS are FROM public.dcc_intentii WHERE cheie = '${K(11)}'`)).rows[0]
      egal(A, i, { operatie: 'contract_creeaza', actor: 'om', autor: U.OWNER, are: true }, 'rândul intenției')
    },
  },
  {
    nume: 'p_d5_identitati', task: 5, cere: ['5'], fixtura: false,
    async fn(db, A) {
      const cine = async (rol, uid, sesiune) => (await ca(db, rol, uid, 'SELECT session_user::text AS s, current_user::text AS c, auth.uid() AS u', { sesiune })).rows?.[0]
      egal(A, await cine(null, null, null), { s: 'postgres', c: 'postgres', u: null }, 'identitatea 1 (psql ca postgres)')
      egal(A, await cine('anon', null, 'authenticator'), { s: 'authenticator', c: 'anon', u: null }, 'identitatea 2 (API anon)')
      egal(A, await cine('authenticated', null, 'authenticator'), { s: 'authenticator', c: 'authenticated', u: null }, 'identitatea 3 (API fără sub)')
      egal(A, await cine('service_role', null, 'authenticator'), { s: 'authenticator', c: 'service_role', u: null }, 'identitatea 4 (API service_role)')
      egal(A, await cine('authenticated', U.OWNER, 'authenticator'), { s: 'authenticator', c: 'authenticated', u: U.OWNER }, 'identitatea 5 (API cu JWT)')
      egal(A, await cine(null, U.ED, null), { s: 'postgres', c: 'postgres', u: U.ED }, 'identitatea 6 (postgres cu sub)')
      const contract = (k, cod) => ['BEN', cod, 'automat', null, K(k)]
      // 1. calea serverului: configurarea merge, actorul = server; alocarea -> DCC_NEAUTENTIFICAT
      const s1 = await trece(A, rpc(db, 'server', 'fn_dcc_contract_creeaza', contract(21, '30')), 'server: contract')
      const i1 = (await db.query(`SELECT actor, autor FROM public.dcc_intentii WHERE cheie = '${K(21)}'`)).rows[0]
      const c1 = (await db.query(`SELECT creat_prin, creat_de FROM public.dcc_contracte WHERE id = ${s1?.contract_id}`)).rows[0]
      egal(A, [i1, c1], [{ actor: 'server', autor: null }, { creat_prin: 'server', creat_de: null }], 'proveniența pe calea serverului')
      A.cod(await rpc(db, 'server', 'fn_dcc_aloca', [1, 'AAA', 'TM1', 'COR', 'general', 'x', null, null, K(22)]), '42501', 'server: alocare', { re: RE('DCC_NEAUTENTIFICAT') })
      A.cod(await rpc(db, 'server', 'fn_dcc_anuleaza', [1, null, 'x', K(23)]), '42501', 'server: anulare', { re: RE('DCC_NEAUTENTIFICAT') })
      // 2 / 4. API anon / service_role: fără EXECUTE
      for (const rol of ['anon', 'service_role']) {
        A.cod(await rpc(db, null, 'fn_dcc_contract_creeaza', contract(24, '31'), { rol, sesiune: 'authenticator' }), '42501', `${rol}: contract`, { re: /permission denied/ })
        A.cod(await rpc(db, null, 'fn_dcc_aloca', [1, 'AAA', 'TM1', 'COR', 'general', 'x', null, null, K(25)], { rol, sesiune: 'authenticator' }), '42501', `${rol}: alocare`, { re: /permission denied/ })
      }
      // 3. API authenticated fără sub: NU e calea serverului (session_user = authenticator)
      A.cod(await rpc(db, null, 'fn_dcc_contract_creeaza', contract(26, '32'), { sesiune: 'authenticator' }), '42501', 'authenticated fără sub: contract', { re: RE('DCC_NEAUTENTIFICAT') })
      A.cod(await rpc(db, null, 'fn_dcc_aloca', [1, 'AAA', 'TM1', 'COR', 'general', 'x', null, null, K(27)], { sesiune: 'authenticator' }), '42501', 'authenticated fără sub: alocare',
        { re: RE('DCC_NEAUTENTIFICAT') })
      A.cod(await rpc(db, null, 'fn_dcc_initializeaza_serie', [1, 'AAA', 'TM1', 'COR', 'general', 0, 'm', false, K(28)], { sesiune: 'authenticator' }), '42501',
        'authenticated fără sub: inițializare', { re: RE('DCC_NEAUTENTIFICAT') })
      // 5. API cu JWT owner: merge
      A.trece(await rpc(db, U.OWNER, 'fn_dcc_contract_creeaza', contract(29, '33'), { sesiune: 'authenticator' }), 'authenticated cu JWT owner: contract')
      // 6. postgres cu sub al unui editor = omul (NU calea serverului): nu e owner -> refuz
      A.cod(await rpc(db, U.ED, 'fn_dcc_contract_creeaza', contract(30, '34'), { rol: null }), '42501', 'postgres cu sub de editor: contract', { re: RE('DCC_FARA_DREPT') })
      A.ok((await numar(db, 'dcc_contracte')) === 2, `contractele create: ${await numar(db, 'dcc_contracte')} (aștepta 2)`)
    },
  },
  {
    nume: 't5_serii_proiect', task: 5, cere: ['5'], fixtura: false,
    async fn(db, A) {
      const c = await configurare(db, A)
      await trece(A, initSerie(db, U.OWNER, c.P1, 'TM1', 'COR', 'general', 44, { motiv: 'ultimul din Excel' }), 'inițializare')
      await trece(A, aloca(db, U.ED, c.P2, 'TM1', 'COR', 'general'), 'alocare din P2')
      const r = await ca(db, 'authenticated', U.L1, `SELECT * FROM public.fn_dcc_serii_proiect(${c.P1})`)
      const rows = A.trece(r, 'L1 citește seriile P1') || []
      egal(A, rows.length && Object.keys(rows[0]), ['serie_id', 'emitent', 'tematica', 'tip', 'interval', 'limita_inf', 'limita_sup', 'prag_initial', 'ultimul_ocupat',
        'urmatorul', 'epuizata', 'initializata_la', 'initializata_prin', 'motiv_prag'], 'coloanele')
      egal(A, rows.map(x => [x.emitent, x.tematica, x.tip, x.interval, x.limita_inf, x.limita_sup, x.prag_initial, x.ultimul_ocupat, x.urmatorul, x.epuizata, x.initializata_prin, x.motiv_prag]),
        [['AAA', 'TM1', 'COR', 'general', 1, 99999, 44, 45, 46, false, 'om', 'ultimul din Excel']], 'seria comună (cu alocarea P2 inclusă: divulgarea declarată)')
      A.cod(await ca(db, 'authenticated', U.L1, `SELECT * FROM public.fn_dcc_serii_proiect(${c.P2})`), '42501', 'L1 pe P2', { re: RE('DCC_FARA_DREPT') })
      A.cod(await ca(db, 'authenticated', U.L1, `SELECT * FROM public.fn_dcc_serii_proiect(999)`), '42501', 'L1 pe proiect inexistent', { re: RE('DCC_FARA_DREPT') })
      A.cod(await ca(db, 'authenticated', U.ED, `SELECT 1 FROM public.dcc_serii`), '42501', 'tabela seriilor nu se citește direct')
    },
  },
  {
    nume: 'p1_serie_absenta', task: 5, cere: ['5'], fixtura: false,
    async fn(db, A) {
      const c = await configurare(db, A)
      A.cod(await aloca(db, U.ED, c.P1, 'TM1', 'COR', 'general'), 'P0001', 'serie neinițializată', { re: RE('DCC_SERIE_ABSENTA') })
      A.cod(await aloca(db, U.ED, c.P1, 'TM1', 'COR', ' General '), 'P0001', 'serie neinițializată (forma necanonică)', { re: RE('DCC_SERIE_ABSENTA') })
      A.cod(await aloca(db, U.ED, c.P1, 'TM1', 'COR', 'GEN'), '22023', 'interval invalid, înaintea oricărei citiri', { re: RE('DCC_INTERVAL_INVALID') })
      A.cod(await aloca(db, U.ED, c.P1, 'TM1', 'COR', '  '), '22023', 'interval gol', { re: RE('DCC_INTERVAL_INVALID') })
      A.ok((await numar(db, 'dcc_documente')) === 0 && (await numar(db, 'dcc_intentii', "WHERE operatie = 'aloca'")) === 0, 'niciun document, nicio intenție de alocare')
    },
  },
  {
    nume: 'p1_consecutive_secvential', task: 5, cere: ['5'], fixtura: false,
    async fn(db, A) {
      const c = await configurare(db, A)
      const s = await trece(A, initSerie(db, U.ADM, c.P1, 'TM1', 'COR', 'general', 44), 'inițializare cu prag 44')
      egal(A, s && { ...s, serie_id: typeof s.serie_id }, { prag: 44, interval: 'general', reluat: false, serie_id: 'number', urmatorul: 45, limita_inf: 1, limita_sup: 99999, max_istoric: null },
        'rezultatul inițializării')
      const a = await trece(A, aloca(db, U.ED, c.P1, 'TM1', 'COR', 'general', { titlu: 'Raport 1' }), 'alocarea 1')
      const b = await trece(A, aloca(db, U.ED, c.P1, 'TM1', 'COR', 'general', { titlu: 'Raport 2' }), 'alocarea 2')
      egal(A, [a?.secventa, b?.secventa, a?.revizii?.[0]?.cod_text, b?.revizii?.[0]?.cod_text], [45, 46, '30-AAA-TM1-COR-00045.Rev0.RO', '30-AAA-TM1-COR-00046.Rev0.RO'], 'secvențe și coduri')
      egal(A, a && Object.keys(a).sort(), ['document_id', 'interval', 'reluat', 'revizii', 'secventa'], 'forma rezultatului')
      egal(A, a && Object.keys(a.revizii[0]).sort(), ['cod_text', 'fila', 'limba', 'nume_fisier_baza', 'revizie', 'revizie_id'], 'forma reviziei din rezultat')
      egal(A, a && [a.interval, a.revizii[0].fila, a.revizii[0].revizie, a.revizii[0].limba, a.revizii[0].nume_fisier_baza],
        ['general', null, 0, 'RO', '30-AAA-TM1-COR-00045.Rev0.RO'], 'valorile reviziei')
      const u = (await db.query(`SELECT ultimul_ocupat FROM public.dcc_serii WHERE id = ${s?.serie_id}`)).rows[0]?.ultimul_ocupat
      A.ok(u === 46, `ultimul_ocupat = ${u}`)
      // [D6] emitentul altul decât al proiectului
      A.cod(await aloca(db, U.ED, c.P1, 'TM1', 'COR', 'general', { emitent: 'SUB' }), '22023', 'emitent străin', { re: RE('DCC_EMITENT_STRAIN') })
      A.cod(await aloca(db, U.VIEW, c.P1, 'TM1', 'COR', 'general'), '42501', 'viewer nu alocă', { re: RE('DCC_FARA_DREPT') })
      A.cod(await aloca(db, U.ED, c.P1, 'TM9', 'COR', 'general'), '22023', 'tematică din afara ghidului', { re: RE('DCC_VALOARE_GHID') })
    },
  },
  {
    nume: 'p2_cheie_aloca', task: 5, cere: ['5'], fixtura: false,
    async fn(db, A) {
      const c = await configurare(db, A)
      await trece(A, initSerie(db, U.ADM, c.P1, 'TM1', 'COR', 'general', 44), 'inițializare')
      const k = K(40)
      const a = await trece(A, aloca(db, U.ED, c.P1, 'TM1', 'COR', 'general', { cheie: k }), 'alocarea cu K')
      const b = await trece(A, aloca(db, U.ED, c.P1, ' tm1 ', 'cor', 'GENERAL', { cheie: k }), 'aceeași cheie, aceiași parametri (netrimați)')
      egal(A, b && { ...b, reluat: false }, a && { ...a, reluat: false }, 'același obiect')
      A.ok(b?.reluat === true, 'reluat: true')
      A.ok((await numar(db, 'dcc_documente')) === 1, 'un singur document')
      A.cod(await aloca(db, U.ED, c.P1, 'TM1', 'COR', 'general', { cheie: k, titlu: 'alt titlu' }), '22023', 'aceeași cheie, alt titlu', { re: RE('DCC_CHEIE_ALTI_PARAMETRI') })
      A.cod(await aloca(db, U.ED2, c.P1, 'TM1', 'COR', 'general', { cheie: k }), '22023', 'aceeași cheie, alt utilizator', { re: RE('DCC_CHEIE_ALTI_PARAMETRI') })
      A.cod(await revizieNoua(db, U.ED, a?.document_id, { cheie: k }), '22023', 'aceeași cheie, altă operație', { re: RE('DCC_CHEIE_ALTI_PARAMETRI') })
      A.ok((await numar(db, 'dcc_documente')) === 1 && (await numar(db, 'dcc_revizii')) === 1, 'nimic nou scris')
    },
  },
  {
    nume: 'p2_cheie_revizie', task: 5, cere: ['5'], fixtura: false,
    async fn(db, A) {
      const c = await configurare(db, A)
      await trece(A, initSerie(db, U.ADM, c.P1, 'TM1', 'COR', 'general', 44), 'inițializare')
      const d = await trece(A, aloca(db, U.ED, c.P1, 'TM1', 'COR', 'general'), 'alocare')
      const k = K(41)
      const r1 = await trece(A, revizieNoua(db, U.ED, d?.document_id, { titlu: 'Revizia 1', cheie: k }), 'Rev1 cu K')
      const r2 = await trece(A, revizieNoua(db, U.ED, d?.document_id, { titlu: ' Revizia 1 ', cheie: k }), 'aceeași cheie, același titlu')
      egal(A, [r1?.revizie, r1?.cod_text, r2?.revizie_id === r1?.revizie_id, r2?.reluat], [1, '30-AAA-TM1-COR-00045.Rev1.RO', true, true], 'aceeași Rev1')
      A.cod(await revizieNoua(db, U.ED, d?.document_id, { titlu: 'alt titlu', cheie: k }), '22023', 'aceeași cheie, alt titlu', { re: RE('DCC_CHEIE_ALTI_PARAMETRI') })
      A.ok((await numar(db, 'dcc_revizii')) === 2, 'Rev0 + o singură Rev1')
      egal(A, r1 && Object.keys(r1).sort(), ['cod_text', 'document_id', 'limba', 'nume_fisier_baza', 'reluat', 'revizie', 'revizie_id', 'tinta', 'ultima_netrimisa'], 'forma rezultatului')
      egal(A, r1 && [r1.tinta, r1.ultima_netrimisa, r1.limba], [{ tip: 'document', fila: null, anexa: null }, true, 'RO'], 'ținta / ultima netrimisă / limba')
    },
  },
  {
    nume: 'p_reluare_dupa_retragere', task: 5, cere: ['5'], fixtura: false,
    async fn(db, A) {
      const c = await configurare(db, A)
      await trece(A, initSerie(db, U.ADM, c.P1, 'TM1', 'COR', 'general', 44), 'inițializare')
      const k = K(42)
      const a = await trece(A, aloca(db, U.ED, c.P1, 'TM1', 'COR', 'general', { cheie: k }), 'E alocă cu K')
      await db.exec(`DELETE FROM public.user_module_access WHERE profile_id = '${U.ED}' AND module = 'executie_dcc'`)
      const inainte = await numaraTot(db)
      const b = await trece(A, aloca(db, U.ED, c.P1, 'TM1', 'COR', 'general', { cheie: k }), 'E reia K după retragerea dreptului')
      egal(A, b && { ...b, reluat: false }, a && { ...a, reluat: false }, 'același rezultat')
      A.ok(b?.reluat === true, 'reluat: true')
      egal(A, await numaraTot(db), inainte, '0 rânduri noi în orice tabel dcc_*')
      A.cod(await aloca(db, U.ED, c.P1, 'TM1', 'COR', 'general', { cheie: k, titlu: 'alt' }), '22023', 'E cu K + alt titlu', { re: RE('DCC_CHEIE_ALTI_PARAMETRI') })
      A.cod(await aloca(db, U.ED, c.P1, 'TM1', 'COR', 'general'), '42501', 'E cu o cheie nouă', { re: RE('DCC_FARA_DREPT') })
      A.cod(await aloca(db, U.ED2, c.P1, 'TM1', 'COR', 'general', { cheie: k }), '22023', 'alt utilizator cu K', { re: RE('DCC_CHEIE_ALTI_PARAMETRI') })
    },
  },
  {
    // review r1 implementare (P2): configurarea reia cheia proprie ÎNAINTEA dreptului (L05), ca registrul; o cheie nouă = 42501
    nume: 'p_reluare_config_dupa_retragere', task: 5, cere: ['5'], fixtura: false,
    async fn(db, A) {
      const g = GHIDURI.G1, kg = K(61), kc = K(62), kp = K(63), kp2 = K(64)
      const rg = await trece(A, rpc(db, U.OWNER, 'fn_dcc_ghid_creeaza', [JSON.stringify(g), kg]), 'ghid cu Kg')
      const rc = await trece(A, rpc(db, U.OWNER, 'fn_dcc_contract_creeaza', ['BEN', '30', 'automat', null, kc]), 'contract cu Kc')
      const sp = (k, versiune) => rpc(db, U.OWNER, 'fn_dcc_proiect_seteaza', [1, rc?.contract_id, rg?.ghid_id, 'AAA', 'RO', 'dcc@exemplu.invalid', tab([]), '{}', null, 15, versiune, k])
      const rp = await trece(A, sp(kp, null), 'proiect creat cu Kp')
      const ru = await trece(A, sp(kp2, 1), 'proiect actualizat cu Kp2')
      await db.exec(`UPDATE public.profiles SET is_owner = false WHERE id = '${U.OWNER}'`)
      try {
        const inainte = await numaraTot(db)
        for (const [ce, p, a] of [['ghid', rpc(db, U.OWNER, 'fn_dcc_ghid_creeaza', [JSON.stringify(g), kg]), rg],
          ['contract', rpc(db, U.OWNER, 'fn_dcc_contract_creeaza', ['BEN', '30', 'automat', null, kc]), rc], ['proiect creat', sp(kp, null), rp], ['proiect actualizat', sp(kp2, 1), ru]]) {
          const b = await trece(A, p, `${ce} reluat după retragerea calității de proprietar`)
          egal(A, b && { ...b, reluat: false }, a && { ...a, reluat: false }, `${ce}: același rezultat`)
          A.ok(b?.reluat === true, `${ce}: reluat: true`)
        }
        egal(A, await numaraTot(db), inainte, '0 rânduri noi în orice tabel dcc_*')
        A.cod(await rpc(db, U.OWNER, 'fn_dcc_contract_creeaza', ['BEN', '31', 'automat', null, KN()]), '42501', 'contract cu o cheie nouă', { re: RE('DCC_FARA_DREPT') })
        A.cod(await sp(KN(), 2), '42501', 'proiect cu o cheie nouă', { re: RE('DCC_FARA_DREPT') })
        A.cod(await rpc(db, U.OWNER, 'fn_dcc_contract_creeaza', ['BEN', '30', 'automat', null, kp]), '22023', 'cheia altei operații', { re: RE('DCC_CHEIE_ALTI_PARAMETRI') })
      } finally {
        await db.exec(`UPDATE public.profiles SET is_owner = true WHERE id = '${U.OWNER}'`)
      }
    },
  },
  {
    nume: 'p3_revizii_secvential', task: 5, cere: ['5'], fixtura: false,
    async fn(db, A) {
      const c = await configurare(db, A)
      await trece(A, initSerie(db, U.ADM, c.P1, 'TM1', 'COR', 'general', 44), 'inițializare')
      const d = await trece(A, aloca(db, U.ED, c.P1, 'TM1', 'COR', 'general'), 'alocare')
      const r1 = await trece(A, revizieNoua(db, U.ED, d?.document_id), 'revizie cu K1')
      const r2 = await trece(A, revizieNoua(db, U.ED2, d?.document_id), 'revizie cu K2')
      egal(A, [r1?.revizie, r2?.revizie, r2?.cod_text], [1, 2, '30-AAA-TM1-COR-00045.Rev2.RO'], 'Rev1 și Rev2')
      A.cod(await sonda(db, `INSERT INTO public.dcc_revizii (contract_id, document_id, revizie, limba, ghid_id, cod_text, nume_fisier_baza, creat_de)
        VALUES (${c.c30}, ${d?.document_id}, 1, 'RO', ${c.g1}, 'ALT-COD', 'ALT-COD', '${U.ED}')`), '23505', 'a doua Rev1 scrisă direct', { constrangere: 'dcc_revizii_uq' })
    },
  },
  {
    nume: 'p4_anulare', task: 5, cere: ['5'], fixtura: false,
    async fn(db, A) {
      const c = await configurare(db, A)
      await trece(A, initSerie(db, U.ADM, c.P1, 'TM1', 'COR', 'general', 44), 'inițializare')
      const d = await trece(A, aloca(db, U.ED, c.P1, 'TM1', 'COR', 'general'), 'alocarea 45')
      A.cod(await anuleaza(db, U.ED, { doc: d?.document_id }), '42501', 'editorul nu anulează ([D7])', { re: RE('DCC_FARA_DREPT') })
      const an = await trece(A, anuleaza(db, U.ADM, { doc: d?.document_id }), 'adminul anulează documentul 45')
      egal(A, an && { ...an, document_id: null }, { tinta: 'document', reluat: false, document_id: null, revizie_id: null, revizii_anulate: [d?.revizii?.[0]?.revizie_id],
        revizii_pastrate: [] }, 'rezultatul anulării')
      const st = (await db.query(`SELECT d.stare, r.stare_transport FROM public.dcc_documente d JOIN public.dcc_revizii r ON r.document_id = d.id WHERE d.id = ${d?.document_id}`)).rows[0]
      egal(A, st, { stare: 'anulat', stare_transport: 'anulata' }, 'stările după anulare')
      const e = await trece(A, aloca(db, U.ED, c.P1, 'TM1', 'COR', 'general'), 'alocarea următoare')
      A.ok(e?.secventa === 46, `după anulare: ${e?.secventa} (aștepta 46, numărul 45 nu se refolosește)`)
      // contractul manual: numărul anulat rămâne ocupat
      const m = await trece(A, alocaManual(db, U.ED, c.P4, 'TM1', 'COR', 7), 'manual 7')
      await trece(A, anuleaza(db, U.ADM, { doc: m?.document_id }), 'anularea manualului 7')
      A.cod(await alocaManual(db, U.ED, c.P4, 'TM1', 'COR', 7), '23505', 'manual pe un număr anulat', { re: RE('DCC_COD_OCUPAT') })
      // anularea unei revizii trimise -> tranziție nepermisă; a unei revizii pe un document anulat -> EXACT DCC_DOCUMENT_ANULAT
      const r = await trece(A, revizieNoua(db, U.ED, e?.document_id), 'Rev1 pe 46')
      await db.exec(`UPDATE public.dcc_revizii SET stare_transport = 'trimisa_manual_neverificata' WHERE id = ${r?.revizie_id}`)
      A.cod(await anuleaza(db, U.ADM, { rev: r?.revizie_id }), 'P0001', 'anularea unei revizii trimise', { re: RE('DCC_TRANZITIE_NEPERMISA') })
      A.cod(await anuleaza(db, U.ADM, { rev: d?.revizii?.[0]?.revizie_id }), 'P0001', 'anularea unei revizii a unui document anulat', { re: RE('DCC_DOCUMENT_ANULAT') })
      A.cod(await anuleaza(db, U.ADM, { doc: d?.document_id }), 'P0001', 'a doua anulare a documentului', { re: RE('DCC_DOCUMENT_ANULAT') })
      A.cod(await anuleaza(db, U.ADM, { doc: e?.document_id, rev: r?.revizie_id }), '22023', 'document ȘI revizie', { re: RE('DCC_PARAMETRU_INVALID') })
      // anularea documentului 46: Rev0 netrimisă -> anulată; Rev1 trimisă rămâne (istoric)
      const an2 = await trece(A, anuleaza(db, U.ADM, { doc: e?.document_id }), 'anularea documentului 46')
      egal(A, an2 && [an2.revizii_anulate, an2.revizii_pastrate], [[e?.revizii?.[0]?.revizie_id], [{ revizie_id: r?.revizie_id, stare_transport: 'trimisa_manual_neverificata' }]],
        'reviziile anulate / păstrate')
    },
  },
  {
    nume: 'p4_motiv_anulare', task: 5, cere: ['5'], fixtura: false,
    async fn(db, A) {
      const c = await configurare(db, A)
      await trece(A, initSerie(db, U.ADM, c.P1, 'TM1', 'COR', 'general', 44), 'inițializare')
      const d = await trece(A, aloca(db, U.ED, c.P1, 'TM1', 'COR', 'general'), 'alocare')
      const r1 = await trece(A, revizieNoua(db, U.ED, d?.document_id), 'Rev1')
      const inainte = await numaraTot(db)
      for (const [m, ce] of [[null, 'NULL'], ['', 'gol'], ['   ', 'spații'], ['x'.repeat(501), '501']]) {
        A.cod(await anuleaza(db, U.ADM, { rev: r1?.revizie_id, motiv: m }), '22023', `motiv ${ce}`, { re: RE('DCC_MOTIV_LIPSA') })
      }
      egal(A, await numaraTot(db), inainte, 'nimic scris la motivele invalide')
      await trece(A, anuleaza(db, U.ADM, { rev: r1?.revizie_id, motiv: ' M1 ' }), 'anularea Rev1 cu M1')
      await trece(A, anuleaza(db, U.OWNER, { doc: d?.document_id, motiv: 'M2' }), 'anularea documentului cu M2')
      const rs = (await db.query(`SELECT revizie, motiv_anulare, anulata_prin, anulata_de FROM public.dcc_revizii WHERE document_id = ${d?.document_id} ORDER BY revizie`)).rows
      egal(A, rs, [{ revizie: 0, motiv_anulare: 'M2', anulata_prin: 'document', anulata_de: U.OWNER }, { revizie: 1, motiv_anulare: 'M1', anulata_prin: 'revizie', anulata_de: U.ADM }],
        'motivele pe revizii')
      const dm = (await db.query(`SELECT motiv_anulare, anulat_de FROM public.dcc_documente WHERE id = ${d?.document_id}`)).rows[0]
      egal(A, dm, { motiv_anulare: 'M2', anulat_de: U.OWNER }, 'motivul pe document')
    },
  },
  {
    nume: 'p4_operatii_dupa_anulare_a', task: 5, cere: ['5'], fixtura: false,
    async fn(db, A) {
      const c = await configurare(db, A)
      await trece(A, initSerie(db, U.ADM, c.P1, 'TM1', 'DES', 'general', 44), 'inițializare')
      const d = await trece(A, aloca(db, U.ED, c.P1, 'TM1', 'DES', 'general', { nrFile: 2 }), 'document cu 2 file')
      const fila1 = (await db.query(`SELECT id FROM public.dcc_file WHERE document_id = ${d?.document_id} AND fila = 1`)).rows[0]?.id
      await trece(A, anuleaza(db, U.ADM, { doc: d?.document_id }), 'anularea')
      const inainte = await numaraTot(db)
      A.cod(await revizieNoua(db, U.ED, d?.document_id, { fila: fila1 }), 'P0001', 'revizie nouă pe document anulat', { re: RE('DCC_DOCUMENT_ANULAT') })
      A.cod(await filaNoua(db, U.ED, d?.document_id, 3), 'P0001', 'filă nouă pe document anulat', { re: RE('DCC_DOCUMENT_ANULAT') })
      A.cod(await anexaNoua(db, U.ED, d?.document_id), 'P0001', 'anexă nouă pe document anulat', { re: RE('DCC_DOCUMENT_ANULAT') })
      egal(A, await numaraTot(db), inainte, '0 rânduri noi')
    },
  },
  {
    nume: 'p4_limite_interval', task: 5, cere: ['5'], fixtura: false,
    async fn(db, A) {
      const gd = await creeazaGhid(db, A, GHIDURI.GDDE)
      const c31 = await creeazaContract(db, A, 'BEN', '31', 'automat')
      const P = await creeazaProiect(db, A, 6, c31, gd)
      // SR1 cu prag 99 -> 00100
      await trece(A, initSerie(db, U.OWNER, P, 'TS', 'DES', 'SR1', 99), 'SR1 prag 99')
      const a = await trece(A, aloca(db, U.ED, P, 'TS', 'DES', ' sr1'), 'alocarea pe SR1 (forma necanonică)')
      egal(A, [a?.secventa, a?.interval, a?.revizii?.[0]?.cod_text], [100, 'SR1', '31-AAA-TS-DES-00100-RO.Rev0'], 'prima alocare SR1')
      // SR1 cu prag 198 -> 00199, apoi epuizat; SR2 a aceleiași chei neatins
      await trece(A, initSerie(db, U.OWNER, P, 'TS', 'RAP', 'SR1', 198), 'SR1 prag 198 (tip RAP)')
      const s2 = await trece(A, initSerie(db, U.OWNER, P, 'TS', 'RAP', 'SR2', 210), 'SR2 prag 210 (tip RAP)')
      const b = await trece(A, aloca(db, U.ED, P, 'TS', 'RAP', 'SR1'), 'alocarea 199')
      A.ok(b?.secventa === 199, `SR1: ${b?.secventa}`)
      A.cod(await aloca(db, U.ED, P, 'TS', 'RAP', 'SR1'), 'P0001', 'SR1 epuizat', { re: RE('DCC_INTERVAL_EPUIZAT') })
      const u2 = (await db.query(`SELECT ultimul_ocupat FROM public.dcc_serii WHERE id = ${s2?.serie_id}`)).rows[0]?.ultimul_ocupat
      A.ok(u2 === 210, `SR2 neatins: ${u2}`)
      // general cu prag 99998 -> 99999, apoi refuz; inițializarea cu 'GENERAL' găsește intervalul general
      const sg = await trece(A, initSerie(db, U.OWNER, P, 'TM1', 'COR', 'GENERAL', 99998), 'general prag 99998 (cerut GENERAL)')
      A.ok(sg?.interval === 'general', `seria are interval ${sg?.interval}`)
      const g = await trece(A, aloca(db, U.ED, P, 'TM1', 'COR', 'general'), 'alocarea 99999')
      A.ok(g?.secventa === 99999, `general: ${g?.secventa}`)
      A.cod(await aloca(db, U.ED, P, 'TM1', 'COR', 'general'), 'P0001', 'general epuizat', { re: RE('DCC_INTERVAL_EPUIZAT') })
      // aceeași cheie de intenție cu 'sr1' și apoi 'SR1' = aceeași intenție (hash pe forma canonică)
      await trece(A, initSerie(db, U.OWNER, P, 'TM2', 'COR', 'SR1', 99), 'SR1 pe TM2')
      const k = K(50)
      const x = await trece(A, aloca(db, U.ED, P, 'TM2', 'COR', 'sr1', { cheie: k }), "alocare cu 'sr1'")
      const y = await trece(A, aloca(db, U.ED, P, 'TM2', 'COR', 'SR1', { cheie: k }), "aceeași cheie cu 'SR1'")
      A.ok(y?.reluat === true && y?.document_id === x?.document_id, 'aceeași intenție')
      // prag în afara intervalului / sub un document existent
      A.cod(await initSerie(db, U.OWNER, P, 'TM2', 'DES', 'SR1', 200), '22023', 'prag 200 pe SR1', { re: RE('DCC_PARAMETRU_INVALID') })
      await db.exec(`INSERT INTO public.dcc_documente (contract_id, proiect_dcc_id, emitent, tematica, tip, secventa, interval, serie_id, mod, titlu, are_file, creat_de)
        VALUES (${c31}, ${P}, 'AAA', 'TM2', 'DES', 150, NULL, NULL, 'manual', 'Document scris direct', false, '${U.ED}')`)
      A.cod(await initSerie(db, U.OWNER, P, 'TM2', 'DES', 'SR1', 120), 'P0001', 'prag sub un document existent', { re: /^DCC_PRAG_SUB_DOCUMENTE: .*150/ })
      A.trece(await initSerie(db, U.OWNER, P, 'TM2', 'DES', 'SR1', 150), 'prag egal cu documentul existent (contra-proba)')
    },
  },
  {
    nume: 'p_intervale_intre_ghiduri', task: 5, cere: ['5'], fixtura: false,
    async fn(db, A) {
      const ga = await creeazaGhid(db, A, GHIDURI.GA)
      const gb = await creeazaGhid(db, A, GHIDURI.GB)
      const c = await creeazaContract(db, A, 'BEN', '30', 'automat')
      const P1 = await creeazaProiect(db, A, 1, c, ga)
      const P2 = await creeazaProiect(db, A, 2, c, gb)
      await trece(A, initSerie(db, U.OWNER, P1, 'TS', 'DES', 'SR1', 99), 'SR1 (100–199) din P1')
      A.cod(await initSerie(db, U.OWNER, P2, 'TS', 'DES', 'SR2', 149), '23P01', 'SR2 (150–249) din P2 pe aceeași cheie', { re: RE('DCC_INTERVALE_SUPRAPUSE') })
      A.ok((await numar(db, 'dcc_serii')) === 1, 'o singură serie')
      A.trece(await initSerie(db, U.OWNER, P2, 'TM2', 'DES', 'SR2', 149), 'SR2 din P2 pe altă cheie (contra-proba)')
    },
  },
  {
    nume: 'p_ghid_incompatibil', task: 5, cere: ['5'], fixtura: false,
    async fn(db, A) {
      const ga = await creeazaGhid(db, A, GHIDURI.GA)
      const g3 = await creeazaGhid(db, A, GHIDURI.G3)
      const g4 = await creeazaGhid(db, A, GHIDURI.G4)
      const g5 = await creeazaGhid(db, A, GHIDURI.G5)
      const c = await creeazaContract(db, A, 'BEN', '30', 'automat')
      const P1 = await creeazaProiect(db, A, 1, c, ga)
      const P2 = await creeazaProiect(db, A, 2, c, ga)
      await trece(A, initSerie(db, U.OWNER, P1, 'TS', 'DES', 'SR1', 99), 'SR1 din P1')
      A.cod(await seteazaProiect(db, A, 2, c, g3, { versiune: 1 }), 'P0001', 'P2 pe G3 (SR1 100–150)', { re: RE('DCC_GHID_INCOMPATIBIL') })
      A.ok((await db.query(`SELECT ghid_id FROM public.dcc_proiecte WHERE id = ${P2}`)).rows[0].ghid_id === ga, 'P2 neschimbat')
      await trece(A, seteazaProiect(db, A, 2, c, g4, { versiune: 1 }), 'P2 pe G4 (fără SR1)')
      A.cod(await aloca(db, U.ED, P2, 'TS', 'DES', 'SR1'), 'P0001', 'alocarea din P2 pe SR1 fără SR1 în ghid', { re: RE('DCC_INTERVAL_NECUNOSCUT') })
      await trece(A, seteazaProiect(db, A, 2, c, g5, { versiune: 2 }), 'P2 pe G5 (SR1 100–199)')
      const a = await trece(A, aloca(db, U.ED, P2, 'TS', 'DES', 'SR1'), 'alocarea din P2 continuă seria')
      A.ok(a?.secventa === 100, `secvența din P2: ${a?.secventa}`)
    },
  },
  {
    nume: 'p8_doua_proiecte_un_contract', task: 5, cere: ['5'], fixtura: false,
    async fn(db, A) {
      const c = await configurare(db, A)
      await trece(A, initSerie(db, U.ADM, c.P1, 'TM1', 'COR', 'general', 44), 'inițializare')
      const s = []
      for (const p of [c.P1, c.P2, c.P1]) s.push((await trece(A, aloca(db, U.ED, p, 'TM1', 'COR', 'general'), `alocare din ${p}`))?.secventa)
      egal(A, s, [45, 46, 47], 'secvențele alternate')
      A.cod(await sonda(db, `INSERT INTO public.dcc_documente (contract_id, proiect_dcc_id, emitent, tematica, tip, secventa, interval, serie_id, mod, titlu, are_file, creat_de)
        SELECT contract_id, ${c.P2}, emitent, tematica, tip, 46, interval, serie_id, 'automat', 'dublura', false, '${U.ED}' FROM public.dcc_documente WHERE secventa = 46`),
        '23505', 'documentul 46 scris direct pe P2', { constrangere: 'dcc_documente_cod_uq' })
    },
  },
  {
    nume: 'p_cod_text_doua_contracte', task: 5, cere: ['5'], fixtura: false,
    async fn(db, A) {
      const c = await configurare(db, A)
      await trece(A, initSerie(db, U.ADM, c.P1, 'TM1', 'COR', 'general', 44), 'BEN/30')
      await trece(A, initSerie(db, U.ADM, c.P5, 'TM1', 'COR', 'general', 44), 'ALT/30')
      const a = await trece(A, aloca(db, U.ED, c.P1, 'TM1', 'COR', 'general'), 'alocarea BEN/30')
      const b = await trece(A, aloca(db, U.ED, c.P5, 'TM1', 'COR', 'general'), 'alocarea ALT/30')
      egal(A, [a?.revizii?.[0]?.cod_text, b?.revizii?.[0]?.cod_text], ['30-AAA-TM1-COR-00045.Rev0.RO', '30-AAA-TM1-COR-00045.Rev0.RO'], 'același text pe contracte diferite')
      A.ok((await numar(db, 'dcc_documente', `WHERE contract_id = ${c.c30}`)) === 1 && (await numar(db, 'dcc_documente', `WHERE contract_id = ${c.alt30}`)) === 1, 'un document pe contract')
    },
  },
  {
    nume: 'p_cod_text_coliziune_ghiduri', task: 5, cere: ['5'], fixtura: false,
    async fn(db, A) {
      const c = await configurare(db, A)
      const g6 = await creeazaGhid(db, A, GHIDURI.G6)
      await trece(A, initSerie(db, U.ADM, c.P1, 'TM1', 'DES', 'general', 44), 'inițializare')
      const d = await trece(A, aloca(db, U.ED, c.P1, 'TM1', 'DES', 'general', { nrFile: 1 }), 'documentul D cu fila 1')
      A.ok(d?.revizii?.[0]?.cod_text === '30-AAA-TM1-DES-00045-01.Rev0.RO', `fila 1: ${d?.revizii?.[0]?.cod_text}`)
      await trece(A, seteazaProiect(db, A, 1, c.c30, g6, { versiune: 1 }), 'P1 pe G6 (fila „-F”, anexa „-”)')
      const inainte = await numaraTot(db)
      A.cod(await anexaNoua(db, U.ED, d?.document_id), '23505', 'anexa 1 cu textul filei 1', { re: RE('DCC_COD_OCUPAT') })
      const dupa = await numaraTot(db)
      egal(A, [dupa.dcc_anexe, dupa.dcc_revizii, dupa.dcc_intentii], [inainte.dcc_anexe, inainte.dcc_revizii, inainte.dcc_intentii], 'nimic scris (nici anexa, nici revizia, nici cheia)')
    },
  },
  {
    nume: 'p_mom_unicitate', task: 5, cere: ['5'], fixtura: false,
    async fn(db, A) {
      const c = await configurare(db, A)
      await trece(A, initSerie(db, U.ADM, c.P1, null, 'MOM', 'general', 0), 'seria minutelor (fără tematică)')
      const m = await trece(A, aloca(db, U.ED, c.P1, null, 'MOM', 'general', { titlu: 'Minuta 1' }), 'minuta 1')
      A.ok(m?.revizii?.[0]?.cod_text === '30-AAA-MOM-00001.Rev0.RO', `codul minutei: ${m?.revizii?.[0]?.cod_text}`)
      A.cod(await aloca(db, U.ED, c.P1, 'TM1', 'MOM', 'general'), '22023', 'minută cu tematică', { re: RE('DCC_VALOARE_GHID') })
      A.cod(await initSerie(db, U.ADM, c.P1, 'TM1', 'MOM', 'general', 0), '22023', 'seria minutelor cu tematică', { re: RE('DCC_VALOARE_GHID') })
      A.cod(await aloca(db, U.ED, c.P1, null, 'COR', 'general'), '22023', 'corespondență fără tematică', { re: RE('DCC_VALOARE_GHID') })
    },
  },
  {
    nume: 'p_file_anexe', task: 5, cere: ['5'], fixtura: false,
    async fn(db, A) {
      const c = await configurare(db, A)
      await trece(A, initSerie(db, U.ADM, c.P1, 'TM1', 'DES', 'general', 44), 'DES')
      await trece(A, initSerie(db, U.ADM, c.P1, 'TM1', 'COR', 'general', 44), 'COR')
      const d = await trece(A, aloca(db, U.ED, c.P1, 'TM1', 'DES', 'general', { nrFile: 3 }), 'document cu 3 file')
      egal(A, d?.revizii?.map(r => [r.fila, r.cod_text]), [[1, '30-AAA-TM1-DES-00045-01.Rev0.RO'], [2, '30-AAA-TM1-DES-00045-02.Rev0.RO'], [3, '30-AAA-TM1-DES-00045-03.Rev0.RO']],
        'cele trei Rev0')
      A.ok((await numar(db, 'dcc_revizii', `WHERE document_id = ${d?.document_id} AND fila_id IS NULL`)) === 0, 'nicio revizie fără filă')
      const f4 = await trece(A, filaNoua(db, U.ED, d?.document_id, 4), 'fila 4')
      A.ok(f4?.cod_text === '30-AAA-TM1-DES-00045-04.Rev0.RO', `fila 4: ${f4?.cod_text}`)
      A.cod(await filaNoua(db, U.ED, d?.document_id, 2), '23505', 'fila 2 din nou', { re: RE('DCC_FILA_EXISTA') })
      const fara = await trece(A, aloca(db, U.ED, c.P1, 'TM1', 'COR', 'general'), 'document fără file')
      A.cod(await filaNoua(db, U.ED, fara?.document_id, 1), '22023', 'filă pe un document fără file', { re: RE('DCC_FARA_FILE') })
      const ax = await trece(A, anexaNoua(db, U.ED, fara?.document_id), 'anexa 1')
      egal(A, [ax?.anexa, ax?.cod_text], [1, '30-AAA-TM1-COR-00045-A01.Rev0.RO'], 'anexa 1')
      const ra = await trece(A, revizieNoua(db, U.ED, fara?.document_id, { anexa: ax?.anexa_id }), 'revizie nouă pe anexă')
      egal(A, [ra?.revizie, ra?.cod_text, ra?.tinta], [1, '30-AAA-TM1-COR-00045-A01.Rev1.RO', { tip: 'anexa', fila: null, anexa: 1 }], 'Rev1 pe anexă')
      const ultima = (await db.query(`SELECT max(revizie) AS m FROM public.dcc_revizii WHERE document_id = ${fara?.document_id} AND anexa_id IS NULL`)).rows[0].m
      A.ok(ultima === 0, `documentul rămâne la Rev0: ${ultima}`)
      A.cod(await revizieNoua(db, U.ED, d?.document_id), '22023', 'revizie fără țintă pe un document cu file', { re: RE('DCC_TINTA_NEPOTRIVITA') })
      A.cod(await revizieNoua(db, U.ED, fara?.document_id, { fila: f4?.fila_id }), '22023', 'fila altui document', { re: RE('DCC_TINTA_STRAINA') })
    },
  },
  {
    nume: 'p_ghid_nou', task: 5, cere: ['5'], fixtura: false,
    async fn(db, A) {
      const c = await configurare(db, A)
      const fmt2 = F.lot1.map(s => (s.camp === 'revizie' ? { ...s, prefix: '-Rev' } : s))
      const g2 = await creeazaGhid(db, A, ghid('GL1', 2, fmt2, [['general', 1, 99999]]))
      await trece(A, initSerie(db, U.ADM, c.P1, 'TM1', 'COR', 'general', 44), 'inițializare')
      const d = await trece(A, aloca(db, U.ED, c.P1, 'TM1', 'COR', 'general'), 'alocare cu v1')
      await trece(A, seteazaProiect(db, A, 1, c.c30, g2, { versiune: 1 }), 'proiectul pe ghidul v2')
      const r = await trece(A, revizieNoua(db, U.ED, d?.document_id), 'revizie nouă cu v2')
      const toate = (await db.query(`SELECT revizie, cod_text, ghid_id FROM public.dcc_revizii WHERE document_id = ${d?.document_id} ORDER BY revizie`)).rows
      egal(A, toate, [{ revizie: 0, cod_text: '30-AAA-TM1-COR-00045.Rev0.RO', ghid_id: c.g1 }, { revizie: 1, cod_text: '30-AAA-TM1-COR-00045-Rev1.RO', ghid_id: g2 }],
        'Rev0 își păstrează codul; Rev1 folosește v2')
      A.ok(r?.cod_text === '30-AAA-TM1-COR-00045-Rev1.RO', `rezultatul Rev1: ${r?.cod_text}`)
    },
  },
  {
    // L01 (Jakarinos #1182 r1, P1): dreptul de owner se reverifică după claim / lock-uri în FIECARE din cele 3 RPC-uri de configurare
    // (C7 / C9 din concurenta.sh = aceleași căi cu două sesiuni reale)
    nume: 'p_owner_retras_in_asteptare', task: 5, cere: ['5'], fixtura: false,
    async fn(db, A) {
      const g = await creeazaGhid(db, A, GHIDURI.G1)
      const c = await creeazaContract(db, A, 'BEN', '30', 'automat')
      const P1 = await creeazaProiect(db, A, 1, c, g)
      // claim: după INSERT-ul reușit (ramura care continuă cu scrierile); lock: după advisory, la sfârșitul funcției
      await db.exec(cuRetragere('CREATE FUNCTION public.fn_dcc_intentie_revendica(', 'claim', '  RETURN NULL;\nEND $f$;'))
      await db.exec(cuRetragere('CREATE FUNCTION public.fn_dcc_lock_contract(', 'lock', 'END $f$;'))
      const owner = async () => (await db.query(`SELECT is_owner FROM public.profiles WHERE id = '${U.OWNER}'`)).rows[0].is_owner
      const cazuri = [
        ['ghid', 'claim', k => rpc(db, U.OWNER, 'fn_dcc_ghid_creeaza', [JSON.stringify(ghid('GR', 1, F.lot1, [['general', 1, 99999]])), k])],
        ['contract', 'claim', k => rpc(db, U.OWNER, 'fn_dcc_contract_creeaza', ['BEN', '31', 'automat', null, k])],
        ['proiect nou', 'lock', k => rpc(db, U.OWNER, 'fn_dcc_proiect_seteaza', argsProiect(2, c, g, null, k))],
        ['proiect CAS', 'lock', k => rpc(db, U.OWNER, 'fn_dcc_proiect_seteaza', argsProiect(1, c, g, 1, k, 'alt@exemplu.invalid'))],
      ]
      let n = 160
      for (const [ce, punct, f] of cazuri) {
        await db.exec(`UPDATE public.profiles SET is_owner = true WHERE id = '${U.OWNER}'`)
        const inainte = await numaraTot(db)
        await db.exec(`SELECT set_config('dcc_proba.retrage', '${punct}', false)`)
        const k = K(n++)
        const r = await f(k)
        await db.exec(`SELECT set_config('dcc_proba.retrage', '', false)`)
        A.cod(r, '42501', `${ce}: owner retras după ${punct}`, { re: RE('DCC_FARA_DREPT') })
        egal(A, await numaraTot(db), inainte, `${ce}: nimic scris (nici cheia)`)
        A.ok((await numar(db, 'dcc_intentii', `WHERE cheie = '${k}'`)) === 0, `${ce}: nicio intenție pentru cheie`)
        A.ok((await owner()) === true, `${ce}: retragerea simulată s-a anulat odată cu tranzacția RPC-ului`)
      }
      const p1 = (await db.query(`SELECT versiune, adresa_dcc FROM public.dcc_proiecte WHERE id = ${P1}`)).rows[0]
      egal(A, p1, { versiune: 1, adresa_dcc: 'dcc@exemplu.invalid' }, 'P1 neschimbat după CAS-ul refuzat')
      // contra-proba: aceleași apeluri fără retragere trec (injecția nu strică drumul normal)
      await db.exec(`UPDATE public.profiles SET is_owner = true WHERE id = '${U.OWNER}'`)
      for (const [ce, , f] of cazuri) A.trece(await f(K(n++)), `${ce}: fără retragere (contra-proba)`)
      // calea serverului (fără JWT) nu are statut de owner de pierdut: retragerea simulată nu o atinge
      await db.exec(`SELECT set_config('dcc_proba.retrage', 'claim', false)`)
      A.trece(await rpc(db, 'server', 'fn_dcc_contract_creeaza', ['BEN', '32', 'automat', null, K(n++)]), 'server: contract cu injecția activă')
      await db.exec(`SELECT set_config('dcc_proba.retrage', '', false)`)
      // runda r6: ordinea refuzurilor. Reverificarea de după lock vine ÎNAINTEA CAS-ului: un cont retras primește 42501, nu află starea versiunii
      // (P1 e acum la versiunea 2 după contra-proba; cererea cu versiunea 1 ar da 40001). Fără ea, refuzul ar veni abia din CAS sau din reverificarea finală.
      egal(A, (await db.query(`SELECT versiune FROM public.dcc_proiecte WHERE id = ${P1}`)).rows[0], { versiune: 2 }, 'P1 la versiunea 2 (pregătirea)')
      const inainteV = await numaraTot(db)
      await db.exec(`SELECT set_config('dcc_proba.retrage', 'lock', false)`)
      const kv = K(n++)
      const rv = await rpc(db, U.OWNER, 'fn_dcc_proiect_seteaza', argsProiect(1, c, g, 1, kv, 'alt2@exemplu.invalid'))
      await db.exec(`SELECT set_config('dcc_proba.retrage', '', false)`)
      A.cod(rv, '42501', 'proiect CAS cu versiune veche: owner retras după lock', { re: RE('DCC_FARA_DREPT') })
      egal(A, await numaraTot(db), inainteV, 'CAS cu versiune veche: nimic scris')
      A.ok((await owner()) === true, 'CAS cu versiune veche: retragerea simulată s-a anulat')
    },
  },
  {
    // Jakarinos #1182 r1, P2: la reluarea configurării se verifică IDENTITATEA autorului (nu dreptul): alt cont / calea serverului cu cheia
    // owner-ului = alt autor; fără autentificare = refuz înaintea reluării (completează p_reluare_config_dupa_retragere)
    nume: 'p_config_identitate_reluare', task: 5, cere: ['5'], fixtura: false,
    async fn(db, A) {
      const gj = JSON.stringify(GHIDURI.G1)
      const a1 = await trece(A, rpc(db, U.OWNER, 'fn_dcc_ghid_creeaza', [gj, K(170)]), 'owner: ghidul cu K170')
      const a2 = await trece(A, rpc(db, U.OWNER, 'fn_dcc_contract_creeaza', ['BEN', '30', 'automat', null, K(171)]), 'owner: contractul cu K171')
      await trece(A, rpc(db, U.OWNER, 'fn_dcc_proiect_seteaza', argsProiect(1, a2?.contract_id, a1?.ghid_id, null, K(172))), 'owner: proiectul cu K172')
      await db.exec(`UPDATE public.profiles SET is_owner = false WHERE id = '${U.OWNER}'`)
      const inainte = await numaraTot(db)
      A.cod(await rpc(db, U.ED, 'fn_dcc_ghid_creeaza', [gj, K(170)]), '22023', 'alt utilizator cu K170 (ghid)', { re: RE('DCC_CHEIE_ALTI_PARAMETRI') })
      A.cod(await rpc(db, U.ED, 'fn_dcc_contract_creeaza', ['BEN', '30', 'automat', null, K(171)]), '22023', 'alt utilizator cu K171 (contract)', { re: RE('DCC_CHEIE_ALTI_PARAMETRI') })
      A.cod(await rpc(db, U.ED, 'fn_dcc_proiect_seteaza', argsProiect(1, a2?.contract_id, a1?.ghid_id, null, K(172))), '22023', 'alt utilizator cu K172 (proiect)',
        { re: RE('DCC_CHEIE_ALTI_PARAMETRI') })
      A.cod(await rpc(db, 'server', 'fn_dcc_contract_creeaza', ['BEN', '30', 'automat', null, K(171)]), '22023', 'calea serverului cu K171 (autor NULL)',
        { re: RE('DCC_CHEIE_ALTI_PARAMETRI') })
      A.cod(await rpc(db, null, 'fn_dcc_contract_creeaza', ['BEN', '30', 'automat', null, K(171)], { sesiune: 'authenticator' }), '42501', 'fără sub cu K171',
        { re: RE('DCC_NEAUTENTIFICAT') })
      A.cod(await rpc(db, null, 'fn_dcc_ghid_creeaza', [gj, K(170)], { sesiune: 'authenticator' }), '42501', 'fără sub cu K170', { re: RE('DCC_NEAUTENTIFICAT') })
      const b2 = await trece(A, rpc(db, U.OWNER, 'fn_dcc_contract_creeaza', [' ben', '30 ', 'automat', null, K(171)]), 'fostul owner reia K171 cu parametri netrimați')
      A.ok(b2?.reluat === true && b2?.contract_id === a2?.contract_id, `reluarea normalizată: ${JSON.stringify(b2)}`)
      egal(A, await numaraTot(db), inainte, '0 rânduri noi')
      await db.exec(`UPDATE public.profiles SET is_owner = true WHERE id = '${U.OWNER}'`)
    },
  },
  {
    // Jakarinos #1182 r1, P2: regula 3 din fn_dcc_aloca NU e redundantă — triggerul proiectului compară ghidul cu seriile EXISTENTE la momentul
    // setării; un proiect setat înaintea seriei poate avea un ghid cu alte limite, iar triggerul documentului verifică doar limitele SERIEI
    nume: 'p_ghid_incompatibil_aloca', task: 5, cere: ['5'], fixtura: false,
    async fn(db, A) {
      const g1 = await creeazaGhid(db, A, GHIDURI.GA)   // SR1 100–199
      const g2 = await creeazaGhid(db, A, GHIDURI.G3)   // SR1 100–150
      const c = await creeazaContract(db, A, 'BEN', '30', 'automat')
      const P1 = await creeazaProiect(db, A, 1, c, g1)
      const P2 = await creeazaProiect(db, A, 2, c, g2)  // înaintea seriilor: triggerul proiectului nu are cu ce compara
      await trece(A, initSerie(db, U.OWNER, P1, 'TS', 'DES', 'SR1', 150), 'SR1 (100–199) din P1, pragul 150')
      const inainte = await numaraTot(db)
      A.cod(await aloca(db, U.ED, P2, 'TS', 'DES', 'SR1'), 'P0001', 'alocarea din P2 (G2 SR1 100–150) după pragul 150', { re: RE('DCC_GHID_INCOMPATIBIL') })
      egal(A, await numaraTot(db), inainte, 'nimic scris la refuz')
      const a = await trece(A, aloca(db, U.ED, P1, 'TS', 'DES', 'SR1'), 'alocarea din P1 (contra-proba)')
      A.ok(a?.secventa === 151, `alocarea din P1: ${a?.secventa} (aștepta 151)`)
    },
  },
]
