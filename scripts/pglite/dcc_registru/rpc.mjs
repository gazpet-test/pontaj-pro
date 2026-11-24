// Apelurile RPC ca un cont (rolul authenticated + JWT) sau pe calea serverului (postgres fără JWT) și configurarea comună a probelor de RPC
// (ghiduri, contracte, proiecte create PRIN RPC, ca owner). Valorile sintetice: beneficiari BEN / ALT, emitent AAA, tematici TM1 / TM2 / TS.
import { ca, U } from './baza.mjs'
import { F, VALORI } from './fixtura.mjs'

export const K = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
let cheie = 1000
export const KN = () => K(++cheie)
// argumentele: valori (parametri $n) sau {sql: '…'} (inserate ca text, ex. tablouri)
export async function rpc(db, uid, fn, args, { rol = 'authenticated', sesiune = null } = {}) {
  const params = []
  const ph = args.map(a => (a && typeof a === 'object' && 'sql' in a ? a.sql : (params.push(a), `$${params.length}`))).join(', ')
  const r = await ca(db, uid === 'server' ? null : rol, uid === 'server' ? null : uid, `SELECT public.${fn}(${ph}) AS r`, { params, sesiune })
  return r.code ? r : { rows: r.rows, r: r.rows[0].r }
}
export const tab = a => ({ sql: a === null ? 'NULL::text[]' : `ARRAY[${a.map(x => `'${String(x).replace(/'/g, "''")}'`).join(', ')}]::text[]` })
export const big = a => ({ sql: a === null ? 'NULL::bigint[]' : `ARRAY[${a.join(', ')}]::bigint[]` })

export const ghid = (cod, versiune, format, intervale, extra = {}) => ({
  cod, versiune, sursa: 'ghid sintetic', format_cod: format, format_fisier: extra.format_fisier || format,
  valori: VALORI.map(([categorie, c, f]) => ({ categorie, cod: c, descriere: null, ...(f ? { fara_tematica: true } : {}) })),
  intervale: intervale.map(([interval, limita_inf, limita_sup]) => ({ interval, limita_inf, limita_sup })),
})
export const GHIDURI = {
  G1: ghid('GL1', 1, F.lot1, [['general', 1, 99999]]),
  GDDE: ghid('GDDE', 1, F.dde, [['SR1', 100, 199], ['SR2', 200, 299], ['general', 300, 99999]]),
  GA: ghid('GA', 1, F.dde, [['SR1', 100, 199]]),
  GB: ghid('GB', 1, F.dde, [['SR2', 150, 249]]),
  G3: ghid('G3', 1, F.dde, [['SR1', 100, 150]]),
  G4: ghid('G4', 1, F.dde, [['SR2', 200, 299]]),
  G5: ghid('G5', 1, F.dde, [['SR1', 100, 199], ['SR3', 300, 399]]),
  G6: ghid('GL6', 1, F.g6_fila_f, [['general', 1, 99999]]),
}

export async function trece(A, p, ce) {
  const r = await p
  if (r.code) { A.ab.push(`${ce}: ${r.code} ${r.message}`); return null }
  return r.r
}
export const creeazaGhid = (db, A, g) => trece(A, rpc(db, U.OWNER, 'fn_dcc_ghid_creeaza', [JSON.stringify(g), KN()]), `ghid ${g.cod} v${g.versiune}`).then(r => r && r.ghid_id)
export const creeazaContract = (db, A, ben, cod, mod) => trece(A, rpc(db, U.OWNER, 'fn_dcc_contract_creeaza', [ben, cod, mod, null, KN()]), `contract ${ben}/${cod}`).then(r => r && r.contract_id)
export const seteazaProiect = (db, A, exec, contract, ghidId, { versiune = null, uid = U.OWNER, limba = 'RO', adresa = 'dcc@exemplu.invalid', cc = ['cc@exemplu.invalid'], cci = {} } = {}) =>
  rpc(db, uid, 'fn_dcc_proiect_seteaza', [exec, contract, ghidId, 'AAA', limba, adresa, tab(cc), JSON.stringify(cci), null, 15, versiune, KN()])
export const creeazaProiect = (db, A, exec, contract, ghidId, o) => trece(A, seteazaProiect(db, A, exec, contract, ghidId, o), `proiect exec ${exec}`).then(r => r && r.proiect_dcc_id)
export const initSerie = (db, uid, p, tem, tip, interval, prag, { accept = false, cheie: k = KN(), emitent = 'AAA', motiv = 'prag confirmat' } = {}) =>
  rpc(db, uid, 'fn_dcc_initializeaza_serie', [p, emitent, tem, tip, interval, prag, motiv, accept, k])
export const aloca = (db, uid, p, tem, tip, interval, { titlu = 'Raport sintetic', limba = null, nrFile = null, cheie: k = KN(), emitent = 'AAA' } = {}) =>
  rpc(db, uid, 'fn_dcc_aloca', [p, emitent, tem, tip, interval, titlu, limba, nrFile, k])
export const alocaManual = (db, uid, p, tem, tip, secventa, { titlu = 'Document manual', limba = null, nrFile = null, cheie: k = KN() } = {}) =>
  rpc(db, uid, 'fn_dcc_aloca_manual', [p, 'AAA', tem, tip, secventa, titlu, limba, nrFile, k])
export const revizieNoua = (db, uid, doc, { fila = null, anexa = null, titlu = null, limba = null, cheie: k = KN() } = {}) =>
  rpc(db, uid, 'fn_dcc_revizie_noua', [doc, fila, anexa, titlu, limba, k])
export const filaNoua = (db, uid, doc, fila, { titlu = null, limba = null, cheie: k = KN() } = {}) => rpc(db, uid, 'fn_dcc_fila_noua', [doc, fila, titlu, limba, k])
export const anexaNoua = (db, uid, doc, { titlu = 'Anexa sintetica', limba = null, cheie: k = KN() } = {}) => rpc(db, uid, 'fn_dcc_anexa_noua', [doc, titlu, limba, k])
export const anuleaza = (db, uid, { doc = null, rev = null, motiv = 'anulat in proba', cheie: k = KN() } = {}) => rpc(db, uid, 'fn_dcc_anuleaza', [doc, rev, motiv, k])

// configurarea standard: ghidurile G1 (lot 1) și GDDE, contractele BEN/30 (automat), ALT/30, BEN/43, BEN/29 (manual), proiectele P1, P2 (BEN/30),
// P3 (BEN/43), P4 (BEN/29), P5 (ALT/30) — toate pe G1, emitent AAA, limba RO
export async function configurare(db, A) {
  const g1 = await creeazaGhid(db, A, GHIDURI.G1)
  const gdde = await creeazaGhid(db, A, GHIDURI.GDDE)
  const c30 = await creeazaContract(db, A, 'BEN', '30', 'automat')
  const alt30 = await creeazaContract(db, A, 'ALT', '30', 'automat')
  const c43 = await creeazaContract(db, A, 'BEN', '43', 'automat')
  const c29 = await creeazaContract(db, A, 'BEN', '29', 'manual')
  const P1 = await creeazaProiect(db, A, 1, c30, g1)
  const P2 = await creeazaProiect(db, A, 2, c30, g1)
  const P3 = await creeazaProiect(db, A, 3, c43, g1)
  const P4 = await creeazaProiect(db, A, 4, c29, g1)
  const P5 = await creeazaProiect(db, A, 5, alt30, g1)
  return { g1, gdde, c30, alt30, c43, c29, P1, P2, P3, P4, P5 }
}
export const numar = async (db, t, filtru = '') => Number((await db.query(`SELECT count(*) AS n FROM public.${t} ${filtru}`)).rows[0].n)
export async function numaraTot(db) {
  const o = {}
  for (const t of ['dcc_ghiduri', 'dcc_contracte', 'dcc_proiecte', 'dcc_intentii', 'dcc_serii', 'dcc_documente', 'dcc_file', 'dcc_anexe', 'dcc_revizii',
    'dcc_istoric_aparitii', 'dcc_snapshoturi', 'dcc_snapshot_revizii', 'dcc_mesaje', 'dcc_legaturi']) o[t] = await numar(db, t)
  return o
}
