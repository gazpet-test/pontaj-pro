// Blocurile Task 6 (secțiunea 6: importul istoric, „copiat”, „confirm că am trimis”). Datele prin RPC; valorile așteptate scrise de mână.
import { U, ca, sonda, sha256 } from './baza.mjs'
import { K, KN, rpc, trece, tab, big, ghid, configurare, initSerie, aloca, alocaManual, revizieNoua, filaNoua, anexaNoua, anuleaza, numar, numaraTot } from './rpc.mjs'
import { F } from './fixtura.mjs'
import { egal, cuRetragereLaScriere } from './blocuri_t5.mjs'

const RE = cod => new RegExp('^' + cod + ':')
const importa = (db, uid, p, randuri, { lot = 'lot1', cheie: k = KN() } = {}) => rpc(db, uid, 'fn_dcc_istoric_importa', [p, lot, JSON.stringify(randuri), k])
export const SNAP = (extra = {}) => ({ to: ['dcc@exemplu.invalid'], cc: ['cc@exemplu.invalid'], subiect: '30-AAA-TM1-COR-00045.Rev0.RO Raport sintetic', corp: 'Corp sintetic',
  linkuri: ['https://transfer.exemplu.invalid/x'], manifest: [{ nume: 'b.pdf', marime: 10, sha256: 'a'.repeat(64) }, { nume: 'a.pdf', marime: 5, sha256: 'b'.repeat(64) }], ...extra })
const copiat = (db, uid, revizii, snap = SNAP(), { cheie: k = KN() } = {}) => rpc(db, uid, 'fn_dcc_marcheaza_copiat', [big(revizii), JSON.stringify(snap), k])
const confirma = (db, uid, revizii, { la = { sql: 'now()' }, casuta = 'eu@exemplu.invalid', subiect = null, snapshot = null, cheie: k = KN() } = {}) =>
  rpc(db, uid, 'fn_dcc_confirma_trimis_manual', [big(revizii), la, casuta, subiect, snapshot, k])

// textul jsonb al unei valori (forma canonică documentată a amprentei snapshotului), calculat INDEPENDENT în Node: cheile obiectelor după
// lungime, apoi octeți; separatorii „, ” și „: ” ca ieșirea jsonb
export function jsonbText(v) {
  if (v === null) return 'null'
  if (Array.isArray(v)) return '[' + v.map(jsonbText).join(', ') + ']'
  if (typeof v === 'object') {
    const k = Object.keys(v).sort((a, b) => (Buffer.byteLength(a) - Buffer.byteLength(b)) || Buffer.compare(Buffer.from(a), Buffer.from(b)))
    return '{' + k.map(x => JSON.stringify(x) + ': ' + jsonbText(v[x])).join(', ') + '}'
  }
  return JSON.stringify(v)
}

const ISTORIC = [
  { sursa: 'excel_registru', sursa_id: 'R1', valori_originale: { titlu: 'Raport A' }, cod_scris: '30-AAA-TM1-COR-00050', emitent: 'AAA', tematica: 'TM1', tip: 'COR', secventa: 50, revizie: 0 },
  { sursa: 'mail_trimis', sursa_id: 'M1', valori_originale: { subiect: 'Raport B' }, cod_scris: '30-AAA-TM1-COR-00050_rev.1', emitent: 'AAA', tematica: 'TM1', tip: 'COR',
    secventa: 50, revizie: 1, probleme: ['forma_nestandard', 'dublura'] },
  { sursa: 'excel_registru', sursa_id: 'R2', valori_originale: {}, cod_scris: '30-AAA-TM1-COR-00051', emitent: 'AAA', tematica: 'TM1', tip: 'COR', secventa: 51,
    probleme: ['revizie_necunoscuta'] },
  { sursa: 'excel_registru', sursa_id: 'R3', valori_originale: {}, cod_scris: '30-AAA-TM1-COR-00052_rev.2', emitent: 'AAA', tematica: 'TM1', tip: 'COR', secventa: 52, revizie: 2,
    probleme: ['forma_nestandard'] },
  { sursa: 'mail_trimis', sursa_id: 'M2', valori_originale: { subiect: 'fara cod' } },
  { sursa: 'excel_registru', sursa_id: 'R1', pozitie: 2, valori_originale: {}, cod_scris: '30-AAA-TM1-COR-00060', emitent: 'AAA', tematica: 'TM1', tip: 'COR', secventa: 60, revizie: 0 },
]

export const BLOCURI_T6 = [
  {
    nume: 'p5_import_idempotent', task: 6, cere: ['6'], fixtura: false,
    async fn(db, A) {
      const c = await configurare(db, A)
      const k1 = K(60)
      const a = await trece(A, importa(db, U.ADM, c.P1, ISTORIC, { cheie: k1 }), 'primul import')
      egal(A, a, { inserate: 6, identice: 0, diferite: [], total: 6, reluat: false }, 'primul import')
      const b = await trece(A, importa(db, U.ADM, c.P1, ISTORIC), 'același lot, altă cheie')
      egal(A, b, { inserate: 0, identice: 6, diferite: [], total: 6, reluat: false }, 'al doilea import')
      A.ok((await numar(db, 'dcc_istoric_aparitii')) === 6, 'tot 6 rânduri')
      const dif = ISTORIC.map(r => (r.sursa_id === 'R1' && !r.pozitie ? { ...r, valori_originale: { titlu: 'Raport A modificat' } } : r))
      const d = await trece(A, importa(db, U.ADM, c.P1, dif), 'un rând cu alt conținut')
      egal(A, d, { inserate: 0, identice: 5, diferite: [{ sursa: 'excel_registru', sursa_id: 'R1', pozitie: 1 }], total: 6, reluat: false }, 'rândul diferit listat')
      const v = (await db.query(`SELECT valori_originale FROM public.dcc_istoric_aparitii WHERE sursa_id = 'R1' AND pozitie = 1`)).rows[0].valori_originale
      egal(A, v, { titlu: 'Raport A' }, 'rândul vechi neschimbat')
      const r2 = (await db.query(`SELECT revizie, probleme FROM public.dcc_istoric_aparitii WHERE sursa_id = 'R2'`)).rows[0]
      egal(A, r2, { revizie: null, probleme: ['revizie_necunoscuta'] }, 'revizia absentă = NULL')
      const r = await trece(A, importa(db, U.ADM, c.P1, [...ISTORIC].reverse(), { cheie: k1 }), 'aceeași cheie, același lot în altă ordine')
      egal(A, r, { ...a, reluat: true }, 'reluat: true')
      A.cod(await sonda(db, `UPDATE public.dcc_istoric_aparitii SET cod_scris = 'altul' WHERE sursa_id = 'R2'`), 'P0001', 'UPDATE direct pe cod_scris', { re: RE('DCC_ISTORIC_IMUABIL') })
      // pragul seriei față de maximul istoric al CONTRACTULUI (60): refuz fără accept; cu accept, maximul salvat
      A.cod(await initSerie(db, U.ADM, c.P1, 'TM1', 'COR', 'general', 44), 'P0001', 'prag sub maximul istoric', { re: /^DCC_PRAG_SUB_ISTORIC: .*\(60\)/ })
      const s = await trece(A, initSerie(db, U.ADM, c.P1, 'TM1', 'COR', 'general', 44, { accept: true }), 'prag sub istoric acceptat explicit')
      A.ok(s?.max_istoric === 60, `max_istoric: ${s?.max_istoric}`)
      A.ok((await db.query(`SELECT max_istoric_la_init FROM public.dcc_serii WHERE id = ${s?.serie_id}`)).rows[0]?.max_istoric_la_init === 60, 'max_istoric_la_init salvat')
      // maximul unui ALT proiect al aceluiași contract contează, fără ca rândurile lui să fie vizibile
      await trece(A, importa(db, U.ADM, c.P2, [{ sursa: 'excel_registru', sursa_id: 'P2-1', valori_originale: {}, cod_scris: '30-AAA-TM1-DES-00080', emitent: 'AAA',
        tematica: 'TM1', tip: 'DES', secventa: 80, revizie: 0 }]), 'import pe P2')
      A.cod(await initSerie(db, U.ADM, c.P1, 'TM1', 'DES', 'general', 10), 'P0001', 'prag sub maximul istoric al altui proiect', { re: /^DCC_PRAG_SUB_ISTORIC: .*\(80\)/ })
      const l1 = await ca(db, 'authenticated', U.L1, `SELECT count(*)::int AS n FROM public.dcc_istoric_aparitii WHERE proiect_dcc_id <> ${c.P1}`)
      A.ok(l1.rows?.[0]?.n === 0, 'L1 nu vede istoricul P2')
      A.cod(await importa(db, U.ED, c.P1, ISTORIC), '42501', 'editorul nu importă', { re: RE('DCC_FARA_DREPT') })
      A.trece(await importa(db, 'server', c.P1, [{ sursa: 'mail_primit', sursa_id: 'S1', valori_originale: {} }]), 'calea serverului importă')
      const srv = (await db.query(`SELECT importat_prin, importat_de FROM public.dcc_istoric_aparitii WHERE sursa_id = 'S1'`)).rows[0]
      egal(A, srv, { importat_prin: 'server', importat_de: null }, 'proveniența pe calea serverului')
    },
  },
  {
    nume: 'p5_import_chei_refuzate', task: 6, cere: ['6'], fixtura: false,
    async fn(db, A) {
      const c = await configurare(db, A)
      const baza = { sursa: 'excel_registru', sursa_id: 'X1', valori_originale: {} }
      for (const k of ['id', 'contract_id', 'proiect_dcc_id', 'lot_import', 'continut_hash', 'document_id', 'revizie_id', 'legat_de', 'legat_la', 'importat_de',
        'importat_prin', 'importat_la', 'cheie_necunoscuta']) {
        A.cod(await importa(db, U.ADM, c.P1, [baza, { ...baza, sursa_id: 'X2', [k]: k === 'document_id' || k === 'revizie_id' || k === 'id' ? 1 : 'x' }]), '22023',
          `cheia refuzată ${k}`, { re: RE('DCC_CHEI_NECUNOSCUTE') })
      }
      A.cod(await importa(db, U.ADM, c.P1, [{ ...baza, revizie: '2' }]), '22023', 'revizie șir', { re: RE('DCC_LISTA_INVALIDA') })
      A.cod(await importa(db, U.ADM, c.P1, [{ ...baza, pozitie: 1.5 }]), '22023', 'poziție 1.5', { re: RE('DCC_LISTA_INVALIDA') })
      A.cod(await importa(db, U.ADM, c.P1, [{ ...baza, pozitie: 'x' }]), '22023', 'poziție text', { re: RE('DCC_LISTA_INVALIDA') })
      A.cod(await importa(db, U.ADM, c.P1, [{ ...baza, secventa: 'abc' }]), '22023', 'secvență text', { re: RE('DCC_LISTA_INVALIDA') })
      A.cod(await importa(db, U.ADM, c.P1, [{ ...baza, probleme: ['necunoscuta'] }]), '22023', 'problemă necunoscută', { re: RE('DCC_LISTA_INVALIDA') })
      A.cod(await importa(db, U.ADM, c.P1, [{ ...baza, emitent: 'aa' }]), '22023', 'emitent invalid', { re: RE('DCC_LISTA_INVALIDA') })
      A.cod(await importa(db, U.ADM, c.P1, [baza, { ...baza, valori_originale: { alt: 1 } }]), '22023', 'aceeași identitate în lot', { re: RE('DCC_LOT_DUBLURI') })
      A.cod(await importa(db, U.ADM, c.P1, Array.from({ length: 5001 }, (_, i) => ({ ...baza, sursa_id: 'Y' + i }))), '22023', '5001 de rânduri', { re: RE('DCC_LISTA_PREA_LUNGA') })
      A.cod(await importa(db, U.ADM, c.P1, []), '22023', 'lot gol', { re: RE('DCC_LISTA_GOALA') })
      A.cod(await importa(db, U.ADM, c.P1, [baza], { lot: 'lot cu spatii' }), '22023', 'lot invalid', { re: RE('DCC_PARAMETRU_INVALID') })
      A.ok((await numar(db, 'dcc_istoric_aparitii')) === 0 && (await numar(db, 'dcc_intentii', "WHERE operatie = 'istoric_importa'")) === 0, 'niciun rând nou')
    },
  },
  {
    nume: 'p6_confirma_manual', task: 6, cere: ['6'], fixtura: false,
    async fn(db, A) {
      const c = await configurare(db, A)
      await trece(A, initSerie(db, U.ADM, c.P1, 'TM1', 'COR', 'general', 44), 'inițializare')
      const d = await trece(A, aloca(db, U.ED, c.P1, 'TM1', 'COR', 'general'), 'alocare')
      const rev = d?.revizii?.[0]?.revizie_id
      A.ok((await numar(db, 'dcc_casute')) === 0, 'nicio căsuță conectată')
      A.cod(await confirma(db, U.ED, [rev], { casuta: '  ' }), '22023', 'căsuța declarată goală', { re: RE('DCC_PARAMETRU_INVALID') })
      A.cod(await confirma(db, U.ED, [rev], { la: { sql: "now() + interval '1 hour'" } }), '22023', 'data în viitor', { re: RE('DCC_PARAMETRU_INVALID') })
      const r = await trece(A, confirma(db, U.ED, [rev], { subiect: ' 30-AAA-TM1-COR-00045.Rev0.RO Raport ' }), 'confirm că am trimis')
      egal(A, r && { ...r, mesaj_id: typeof r.mesaj_id, legaturi: r.legaturi.length }, { mesaj_id: 'number', legaturi: 1, reluat: false,
        revizii: [{ revizie_id: rev, stare_anterioara: 'rezervata', stare: 'trimisa_manual_neverificata' }] }, 'rezultatul confirmării')
      const m = (await db.query(`SELECT rfc_message_id, gmail_message_id, gmail_thread_id, casuta_id, dovezi_complete, casuta_declarata, sursa, directie, subiect_original
        FROM public.dcc_mesaje WHERE id = ${r?.mesaj_id}`)).rows[0]
      egal(A, m, { rfc_message_id: null, gmail_message_id: null, gmail_thread_id: null, casuta_id: null, dovezi_complete: false, casuta_declarata: 'eu@exemplu.invalid',
        sursa: 'manual_declarat', directie: 'trimis', subiect_original: '30-AAA-TM1-COR-00045.Rev0.RO Raport' }, 'mesajul manual fără ID-uri inventate')
      const l = (await db.query(`SELECT metoda, stare, confirmat_de FROM public.dcc_legaturi WHERE mesaj_id = ${r?.mesaj_id}`)).rows
      egal(A, l, [{ metoda: 'manual', stare: 'confirmata', confirmat_de: U.ED }], 'legătura manuală confirmată')
      A.ok((await db.query(`SELECT stare_transport FROM public.dcc_revizii WHERE id = ${rev}`)).rows[0].stare_transport === 'trimisa_manual_neverificata', 'starea „neverificat”')
      A.cod(await confirma(db, U.ED, [rev]), 'P0001', 'a doua confirmare (altă cheie)', { re: RE('DCC_TRANZITIE_NEPERMISA') })
      A.cod(await sonda(db, `UPDATE public.dcc_mesaje SET rfc_message_id = '<x@exemplu.invalid>' WHERE id = ${r?.mesaj_id}`), 'P0001', 'Message-ID pus direct pe mesajul manual',
        { re: RE('DCC_MESAJ_IMUABIL') })
      A.cod(await sonda(db, `UPDATE public.dcc_mesaje SET rfc_message_id = '<x@exemplu.invalid>' WHERE id = ${r?.mesaj_id}`, { replica: true }), '23514',
        'același UPDATE fără triggere (CHECK-ul)', { constrangere: 'dcc_mesaje_manual_ck' })
      A.trece(await sonda(db, `UPDATE public.dcc_mesaje SET subiect_original = 'alt' WHERE id = ${r?.mesaj_id}`, { replica: true }), 'UPDATE pe subiect fără triggere (contra-proba)')
      A.cod(await sonda(db, `UPDATE public.dcc_revizii SET stare_transport = 'trimisa_manual_confirmata' WHERE id = ${rev}`), 'P0001', 'neverificata -> confirmata fără dovadă',
        { re: RE('DCC_TRANZITIE_NEPERMISA') })
      A.cod(await confirma(db, U.VIEW, [rev]), '42501', 'viewer nu confirmă', { re: RE('DCC_FARA_DREPT') })
    },
  },
  {
    nume: 'p_copiat', task: 6, cere: ['6'], fixtura: false,
    async fn(db, A) {
      const c = await configurare(db, A)
      await trece(A, initSerie(db, U.ADM, c.P1, 'TM1', 'COR', 'general', 44), 'inițializare')
      const d = await trece(A, aloca(db, U.ED, c.P1, 'TM1', 'COR', 'general'), 'alocare')
      const rev = d?.revizii?.[0]?.revizie_id
      const s1 = await trece(A, copiat(db, U.ED, [rev]), 'copiat 1')
      const s2 = await trece(A, copiat(db, U.ED, [rev]), 'copiat 2 (re-copiere)')
      egal(A, s1?.revizii, [{ revizie_id: rev, stare_anterioara: 'rezervata', stare: 'copiata_pentru_gmail' }], 'rezultatul copierii')
      egal(A, s2?.revizii, [{ revizie_id: rev, stare_anterioara: 'copiata_pentru_gmail', stare: 'copiata_pentru_gmail' }], 'rezultatul re-copierii')
      A.ok((await numar(db, 'dcc_snapshoturi')) === 2 && s1?.snapshot_id !== s2?.snapshot_id, 'două snapshoturi')
      // amprenta = sha256 pe forma canonică, calculată independent în Node
      const n = SNAP()
      const canonic = { tip: 'copiat_gmail', from: null, to: n.to, cc: n.cc, subiect: n.subiect, corp: n.corp, linkuri: n.linkuri,
        manifest: [{ nume: 'a.pdf', marime: 5, sha256: 'b'.repeat(64) }, { nume: 'b.pdf', marime: 10, sha256: 'a'.repeat(64) }] }
      A.ok(s1?.hash === sha256(jsonbText(canonic)), `amprenta snapshotului: ${s1?.hash} (Node: ${sha256(jsonbText(canonic))})`)
      const row = (await db.query(`SELECT to_lista, cc_lista, manifest, from_adresa, tip FROM public.dcc_snapshoturi WHERE id = ${s1?.snapshot_id}`)).rows[0]
      egal(A, row, { to_lista: n.to, cc_lista: n.cc, manifest: canonic.manifest, from_adresa: null, tip: 'copiat_gmail' }, 'snapshotul stocat (manifest sortat)')
      const inainte = await numaraTot(db)
      A.cod(await copiat(db, U.ED, [rev], SNAP({ cc: ['strain@exemplu.invalid'] })), '22023', 'CC din afara listei albe', { re: RE('DCC_CC_NEPERMIS') })
      A.cod(await copiat(db, U.ED, [rev], { ...SNAP(), bcc: ['x@exemplu.invalid'] }), '22023', 'cheia bcc', { re: RE('DCC_CHEI_NECUNOSCUTE') })
      const lipsa = SNAP(); delete lipsa.linkuri
      A.cod(await copiat(db, U.ED, [rev], lipsa), '22023', 'cheie lipsă', { re: RE('DCC_CHEI_NECUNOSCUTE') })
      A.cod(await copiat(db, U.ED, [rev], SNAP({ to: ['altcineva@exemplu.invalid'] })), '22023', 'To diferit', { re: RE('DCC_TO_DIFERIT') })
      A.cod(await copiat(db, U.ED, [rev], SNAP({ manifest: [{ nume: 'a.pdf', marime: 1, sha256: 'x' }] })), '22023', 'manifest invalid', { re: RE('DCC_PARAMETRU_INVALID') })
      A.cod(await copiat(db, U.ED, [rev], SNAP({ manifest: [{ nume: 'a.pdf', marime: 'mare', sha256: 'a'.repeat(64) }] })), '22023', 'mărime text', { re: RE('DCC_PARAMETRU_INVALID') })
      egal(A, await numaraTot(db), inainte, 'nimic scris la refuzuri')
      // CC implicit (pe tematică / tip) face parte din lista albă
      await trece(A, rpc(db, U.OWNER, 'fn_dcc_proiect_seteaza', [1, c.c30, c.g1, 'AAA', 'RO', 'dcc@exemplu.invalid', tab(['cc@exemplu.invalid']),
        JSON.stringify({ COR: ['implicit@exemplu.invalid'] }), null, 15, 1, KN()]), 'CC implicit pe tip')
      A.trece(await copiat(db, U.ED, [rev], SNAP({ cc: ['implicit@exemplu.invalid'] })), 'CC implicit acceptat (contra-proba)')
      A.cod(await sonda(db, `UPDATE public.dcc_snapshoturi SET corp = 'alt corp' WHERE id = ${s1?.snapshot_id}`), 'P0001', 'UPDATE direct pe corp', { re: RE('DCC_SNAPSHOT_IMUABIL') })
    },
  },
  {
    nume: 'p_liste_revizii', task: 6, cere: ['6'], fixtura: false,
    async fn(db, A) {
      const c = await configurare(db, A)
      await trece(A, initSerie(db, U.ADM, c.P1, 'TM1', 'COR', 'general', 44), 'inițializare')
      const a = (await trece(A, aloca(db, U.ED, c.P1, 'TM1', 'COR', 'general'), 'doc a'))?.revizii?.[0]?.revizie_id
      const b = (await trece(A, aloca(db, U.ED, c.P1, 'TM1', 'COR', 'general'), 'doc b'))?.revizii?.[0]?.revizie_id
      const p2 = (await trece(A, aloca(db, U.ED, c.P2, 'TM1', 'COR', 'general'), 'doc pe P2'))?.revizii?.[0]?.revizie_id
      const inainte = await numaraTot(db)
      for (const [ce, f] of [['copiat', l => copiat(db, U.ED, l)], ['confirmat', l => confirma(db, U.ED, l)]]) {
        A.cod(await f(null), '22023', `${ce}: NULL`, { re: RE('DCC_LISTA_GOALA') })
        A.cod(await f([]), '22023', `${ce}: listă goală`, { re: RE('DCC_LISTA_GOALA') })
        A.cod(await f([a, 'NULL']), '22023', `${ce}: element NULL`, { re: RE('DCC_LISTA_INVALIDA') })
        A.cod(await f([a, a]), '22023', `${ce}: dublură`, { re: RE('DCC_LISTA_DUBLURI') })
        A.cod(await f(Array.from({ length: 51 }, (_, i) => i + 1)), '22023', `${ce}: 51 de elemente`, { re: RE('DCC_LISTA_PREA_LUNGA') })
        A.cod(await f([a, p2]), '22023', `${ce}: revizii din două proiecte`, { re: RE('DCC_PROIECTE_AMESTECATE') })
        const x = await (ce === 'copiat' ? copiat(db, U.L1, [999999]) : confirma(db, U.L1, [999999]))
        const y = await (ce === 'copiat' ? copiat(db, U.L1, [p2]) : confirma(db, U.L1, [p2]))
        A.ok(x.code === '42501' && y.code === '42501' && x.message === y.message, `${ce}: id inexistent ${x.code} „${x.message}” vs alt proiect ${y.code} „${y.message}”`)
      }
      egal(A, await numaraTot(db), inainte, '0 rânduri noi la refuzuri')
      // aceeași mulțime în altă ordine = aceeași intenție
      const k = K(70)
      const s1 = await trece(A, copiat(db, U.ED, [b, a], SNAP(), { cheie: k }), 'copiat {b, a}')
      const s2 = await trece(A, copiat(db, U.ED, [a, b], SNAP(), { cheie: k }), 'copiat {a, b} cu aceeași cheie')
      A.ok(s2?.reluat === true && s2?.snapshot_id === s1?.snapshot_id, 'reluat: true, același snapshot')
      const k2 = K(71)
      const la = new Date(Date.now() + 60000).toISOString()   // fix (același hash la reluare), după alocare, în fereastra de 5 minute
      const c1 = await trece(A, confirma(db, U.ED, [b, a], { cheie: k2, la, snapshot: s1?.snapshot_id }), 'confirmat {b, a} cu snapshotul')
      const c2 = await trece(A, confirma(db, U.ED, [a, b], { cheie: k2, la, snapshot: s1?.snapshot_id }), 'confirmat {a, b} cu aceeași cheie')
      A.ok(c2?.reluat === true && c2?.mesaj_id === c1?.mesaj_id, 'reluat: true, același mesaj')
      // snapshotul cu alte revizii
      const dd = (await trece(A, aloca(db, U.ED, c.P1, 'TM1', 'COR', 'general'), 'doc d'))?.revizii?.[0]?.revizie_id
      const s3 = await trece(A, copiat(db, U.ED, [dd]), 'copiat d')
      const r0 = (await trece(A, aloca(db, U.ED, c.P1, 'TM1', 'COR', 'general'), 'doc e'))?.revizii?.[0]?.revizie_id
      A.cod(await confirma(db, U.ED, [r0], { snapshot: s3?.snapshot_id }), '22023', 'snapshot cu alte revizii', { re: RE('DCC_SNAPSHOT_ALTE_REVIZII') })
    },
  },
  {
    nume: 'p_contracte_amestecate', task: 6, cere: ['6'], fixtura: false,
    async fn(db, A) {
      const c = await configurare(db, A)
      await trece(A, initSerie(db, U.ADM, c.P1, 'TM1', 'COR', 'general', 44), 'BEN/30')
      await trece(A, initSerie(db, U.ADM, c.P3, 'TM1', 'COR', 'general', 44), 'BEN/43')
      const a = (await trece(A, aloca(db, U.ED, c.P1, 'TM1', 'COR', 'general'), 'BEN/30'))?.revizii?.[0]?.revizie_id
      const b = (await trece(A, aloca(db, U.ED, c.P3, 'TM1', 'COR', 'general'), 'BEN/43'))?.revizii?.[0]?.revizie_id
      const inainte = await numaraTot(db)
      A.cod(await copiat(db, U.ED, [a, b]), '22023', 'copiat pe două contracte', { re: RE('DCC_PROIECTE_AMESTECATE') })
      A.cod(await confirma(db, U.ED, [a, b]), '22023', 'confirmat pe două contracte', { re: RE('DCC_PROIECTE_AMESTECATE') })
      egal(A, await numaraTot(db), inainte, 'nimic scris')
    },
  },
  {
    nume: 'p4_operatii_dupa_anulare_b', task: 6, cere: ['6'], fixtura: false,
    async fn(db, A) {
      const c = await configurare(db, A)
      await trece(A, initSerie(db, U.ADM, c.P1, 'TM1', 'COR', 'general', 44), 'inițializare')
      const d = await trece(A, aloca(db, U.ED, c.P1, 'TM1', 'COR', 'general'), 'alocare')
      const r0 = d?.revizii?.[0]?.revizie_id
      await trece(A, confirma(db, U.ED, [r0]), 'Rev0 trimisă (neverificată)')
      const r1 = (await trece(A, revizieNoua(db, U.ED, d?.document_id), 'Rev1'))?.revizie_id
      await trece(A, anuleaza(db, U.ADM, { doc: d?.document_id }), 'anularea documentului')
      const st = (await db.query(`SELECT id, stare_transport FROM public.dcc_revizii WHERE document_id = ${d?.document_id} ORDER BY id`)).rows.map(x => x.stare_transport)
      egal(A, st, ['trimisa_manual_neverificata', 'anulata'], 'Rev0 rămâne trimisă, Rev1 anulată')
      const inainte = await numaraTot(db)
      A.cod(await copiat(db, U.ED, [r0]), 'P0001', 'copiat pe revizia trimisă a documentului anulat', { re: RE('DCC_DOCUMENT_ANULAT') })
      A.cod(await copiat(db, U.ED, [r1]), 'P0001', 'copiat pe revizia anulată', { re: RE('DCC_DOCUMENT_ANULAT') })
      A.cod(await confirma(db, U.ED, [r1]), 'P0001', 'confirmat pe documentul anulat', { re: RE('DCC_DOCUMENT_ANULAT') })
      egal(A, await numaraTot(db), inainte, '0 rânduri noi')
    },
  },
  {
    // runda r6 (Jakarinos #1182 r5, P1, principiul aplicat pe FIECARE RPC de scriere): dreptul retras cât o SCRIERE a așteptat (cheia străină,
    // indexul unic, ON CONFLICT, rândul luat de un trigger) e văzut de reverificarea FINALĂ, înaintea rezultatului. Injecția: triggerul tabelului
    // scris retrage dreptul apelantului (după reverificarea de după lock). Fiecare RPC are mutantul lui (fara_reverificare_finala_*); ghidul își
    // păstrează mutantul fara_reverificare_ghid. Contractul n-are trigger la INSERT: așteptarea lui pe indexul unic o probează C9b (concurenta.sh).
    // Cele două sesiuni reale: C10 (proiectul, cheia străină spre executie_proiecte) și C11 (importul, ON CONFLICT pe dcc_istoric_sursa_uq).
    nume: 'p_drept_retras_la_scriere', task: 6, cere: ['5', '6'], fixtura: false,
    async fn(db, A) {
      const c = await configurare(db, A)
      await trece(A, initSerie(db, U.ADM, c.P1, 'TM1', 'COR', 'general', 44), 'inițializare TM1/COR')
      const d = await trece(A, aloca(db, U.ED, c.P1, 'TM1', 'COR', 'general', { titlu: 'Doc R6' }), 'documentul')
      const df = await trece(A, aloca(db, U.ED, c.P1, 'TM1', 'COR', 'general', { titlu: 'Doc R6 file', nrFile: 1 }), 'documentul cu o filă')
      const d3 = await trece(A, aloca(db, U.ED, c.P1, 'TM1', 'COR', 'general', { titlu: 'Doc R6 trei' }), 'al treilea document')
      const d4 = await trece(A, aloca(db, U.ED, c.P1, 'TM1', 'COR', 'general', { titlu: 'Doc R6 patru' }), 'al patrulea document')
      const rev = d?.revizii?.[0]?.revizie_id, rev3 = d3?.revizii?.[0]?.revizie_id
      for (const f of ['fn_dcc_ghid_intervale_disjuncte', 'fn_dcc_proiecte_garda', 'fn_dcc_serii_garda', 'fn_dcc_documente_garda', 'fn_dcc_file_garda',
        'fn_dcc_anexe_garda', 'fn_dcc_revizii_garda', 'fn_dcc_istoric_garda', 'fn_dcc_snapshoturi_garda', 'fn_dcc_mesaje_garda']) {
        await db.exec(cuRetragereLaScriere(`CREATE FUNCTION public.${f}(`))
      }
      // [eticheta, contul, apelul]; ordinea = cea a contra-probei (fiecare apel lasă starea bună pentru următorul)
      const cazuri = [
        ['ghid', U.OWNER, k => rpc(db, U.OWNER, 'fn_dcc_ghid_creeaza', [JSON.stringify(ghid('GR6', 1, F.lot1, [['general', 1, 99999]])), k])],
        ['proiect nou', U.OWNER, k => rpc(db, U.OWNER, 'fn_dcc_proiect_seteaza', [6, c.c30, c.g1, 'AAA', 'RO', 'dcc@exemplu.invalid', tab([]), '{}', null, 15, null, k])],
        ['proiect CAS', U.OWNER, k => rpc(db, U.OWNER, 'fn_dcc_proiect_seteaza', [1, c.c30, c.g1, 'AAA', 'RO', 'dcc@exemplu.invalid', tab(['cc@exemplu.invalid']), '{}', null, 15, 1, k])],
        ['serie', U.ADM, k => initSerie(db, U.ADM, c.P1, 'TM2', 'COR', 'general', 0, { cheie: k })],
        ['aloca', U.ED, k => aloca(db, U.ED, c.P1, 'TM1', 'COR', 'general', { titlu: 'Doc R6 nou', cheie: k })],
        ['aloca manual', U.ED, k => alocaManual(db, U.ED, c.P4, 'TM1', 'COR', 7, { cheie: k })],
        ['revizie noua', U.ED, k => revizieNoua(db, U.ED, d?.document_id, { cheie: k })],
        ['fila noua', U.ED, k => filaNoua(db, U.ED, df?.document_id, 2, { cheie: k })],
        ['anexa noua', U.ED, k => anexaNoua(db, U.ED, d?.document_id, { cheie: k })],
        ['import istoric', U.ADM, k => importa(db, U.ADM, c.P1, [{ sursa: 'excel_registru', sursa_id: 'R6-1', valori_originale: { cod: 'x' } }], { cheie: k })],
        ['copiat', U.ED, k => copiat(db, U.ED, [rev], SNAP(), { cheie: k })],
        ['confirmat', U.ED, k => confirma(db, U.ED, [rev], { cheie: k })],
        ['anulare revizie', U.ADM, k => anuleaza(db, U.ADM, { rev: rev3, cheie: k })],
        ['anulare document', U.ADM, k => anuleaza(db, U.ADM, { doc: d4?.document_id, cheie: k })],
      ]
      const drept = async uid => (await db.query(`SELECT (SELECT is_owner FROM public.profiles WHERE id = '${uid}') AS o,
        (SELECT count(*)::int FROM public.user_module_access WHERE profile_id = '${uid}' AND module = 'executie_dcc') AS m`)).rows[0]
      // drepturile de pornire, refăcute înaintea fiecărui caz: pe un mutant, retragerea din trigger se COMITE odată cu scrierea și ar refuza
      // cazul următor la primul drept (înaintea claim-ului), ascunzând mutantul
      const reface = () => db.exec(`UPDATE public.profiles SET is_owner = true WHERE id = '${U.OWNER}';
        DELETE FROM public.user_module_access WHERE module = 'executie_dcc' AND profile_id IN ('${U.ED}', '${U.ADM}');
        INSERT INTO public.user_module_access (profile_id, module, access_level) VALUES ('${U.ED}', 'executie_dcc', 'editor'), ('${U.ADM}', 'executie_dcc', 'admin');`)
      let n = 600
      for (const [ce, uid, f] of cazuri) {
        await reface()
        const inainte = await numaraTot(db), dr = await drept(uid)
        const k = K(n++)
        await db.exec(`SELECT set_config('dcc_proba.retrage', 'scriere', false)`)
        const r = await f(k)
        await db.exec(`SELECT set_config('dcc_proba.retrage', '', false)`)
        A.cod(r, '42501', `${ce}: drept retras în timpul scrierii`, { re: RE('DCC_FARA_DREPT') })
        egal(A, await numaraTot(db), inainte, `${ce}: nimic scris`)
        A.ok((await numar(db, 'dcc_intentii', `WHERE cheie = '${k}'`)) === 0, `${ce}: nicio intenție pentru cheie`)
        egal(A, await drept(uid), dr, `${ce}: retragerea simulată s-a anulat odată cu tranzacția RPC-ului`)
      }
      // contra-proba: aceleași apeluri fără retragere trec (injecția nu strică drumul normal; aceleași ținte, în ordine)
      await reface()
      for (const [ce, , f] of cazuri) A.trece(await f(K(n++)), `${ce}: fără retragere (contra-proba)`)
    },
  },
]
