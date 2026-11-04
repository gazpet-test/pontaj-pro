/* convocatoareMasa.js — generarea în masă a convocatoarelor poștale pe UAT (L1, BRIEF §4.1; docs/redari/PLAN_CONVOCATOARE_MASA.md).
   Logică pură, cu clientul Supabase injectat (testabilă cu un client fals). Gărzile și generarea sunt cele de la generarea pe rând
   (motivBlocareConvocator, verificaDateConvocator, genereazaConvocator, reincarcaConvocator).
   Rezervarea (r3, Jakarinos #989 r2): DOAR prin RPC-ul fn_red_convocare_rezerva (migrarea 20261130l, SECURITY INVOKER) — lock pe (proiect,
   deținător), recitire sub lock (deținător + parcelă FOR SHARE, gărzile proiect/UAT), „nicio convocare poștală activă neexpediată”,
   fn_red_numar_document('C') + INSERT, într-o tranzacție. FĂRĂ fallback: dacă RPC-ul lipsește (PGRST202 / 404), generarea în masă refuză.
   NU marchează expediat și NU trimite nimic. */
import JSZip from 'jszip'
import * as XLSX from 'xlsx-js-style'
import { genereazaConvocator, verificaDateConvocator, reincarcaConvocator, borderouCsv, BUCKET_REDARI } from './docx.js'
import { motivBlocareConvocator, citestePaginat, LOT_IN, COL_DETINATOR, COL_CONVOCARE } from './ui/comune.jsx'
// r4: același punct de rezervare ca la calea individuală (ModalConvocator) — un singur protocol atomic
import { rezervaNumarConvocare, RPC_REZERVA, MESAJ_FARA_PROTECTIE, esteFaraRpc } from './convocatorNeexpediat.js'
export { RPC_REZERVA, MESAJ_FARA_PROTECTIE }

export const LIMITA_LOT = 200
// SQLSTATE-uri din fn_red_convocare_rezerva: RD001 = există deja convocare poștală activă neexpediată; RD002 = gărzile proiect/UAT/deținător
// recitite sub lock nu trec; P0002 = deținătorul / parcela au fost șterse; 55P03 = UAT ocupat (plicuire / modificare de deținători în curs)
export const CODURI_SCHIMBAT = ['RD001', 'RD002', 'P0002']
export const COL_PARCELA_CONVOCATOR = 'id, proiect_id, uat_id, id_parcela, tronson, sat, tarla, nr_cadastral, poz_hg, suprafata_temporara_mp, categoria_folosinta, sters_la'

export const ACTIUNI = { nou: 'nou', reia: 'reluat', reincarca: 'reîncărcat' }
const compara = (a, b) => String(a ?? '').localeCompare(String(b ?? ''), 'ro', { numeric: true })
const abandonat = () => new Error('Citire abandonată')

/** Un rând de borderou Poștă (aceleași coloane și reguli ca borderoul din Registru). */
export const randBorderou = ({ nrDocument, detinator, contact, idParcela }) => {
  const c = contact || {}
  return { nr_document: nrDocument, nume: detinator?.nume || '', adresa: [c.adresa_strada, c.adresa_sat].filter(Boolean).join(', '),
    cod_postal: c.cod_postal || '', localitate: c.adresa_comuna || c.adresa_sat || '', judet: c.adresa_judet || '', id_parcela: idParcela || '' }
}

// L23: keyset pe o cheie unică (până la pagina goală, cu verificarea avansării — citestePaginat cu `cheie`), pe loturi de LOT_IN id-uri.
// L24: esteCurent ajunge în fiecare buclă de paginare.
export async function citesteInChei(fabrica, coloana, ids, cheie, esteCurent = () => true) {
  const lista = [...new Set((ids || []).filter(Boolean))]
  const tot = []
  for (let i = 0; i < lista.length; i += LOT_IN) {
    if (!esteCurent()) throw abandonat()
    const lot = lista.slice(i, i + LOT_IN)
    tot.push(...await citestePaginat(() => fabrica().in(coloana, lot), { cheie, esteCurent }))
  }
  return tot
}


/** Există RPC-ul de rezervare atomică? Probă fără efecte: p_detinator_id = null → 22023 dacă funcția există. */
export async function detecteazaRezervare(client) {
  const res = await client.rpc(RPC_REZERVA, { p_detinator_id: null })
  if (esteFaraRpc(res)) return false
  if (!res.error || ['22023', '42501'].includes(res.error.code)) return true
  throw new Error(`Verificarea RPC-ului de rezervare a eșuat: ${res.error.message || res.error.code}`)
}

const COL_CONTACT_AMPRENTA = ['adresa_strada', 'adresa_sat', 'adresa_comuna', 'adresa_judet', 'cod_postal', 'adresa_cunoscuta']
const COL_PARCELA_AMPRENTA = ['id_parcela', 'tronson', 'sat', 'tarla', 'nr_cadastral', 'poz_hg', 'suprafata_temporara_mp', 'sters_la']
const alege = (o, chei) => o ? Object.fromEntries(chei.map(k => [k, o[k] ?? null])) : null
/** Amprenta datelor din care se face documentul + a convocărilor active; orice diferență între plan și recitire = „schimbat între timp”. */
export function amprentaRand({ detinator, parcela, contact, token, convocari = [] }) {
  return JSON.stringify({
    d: alege(detinator, ['id', 'parcela_id', 'nume', 'calitate', 'sters_la']),
    p: alege(parcela, COL_PARCELA_AMPRENTA),
    c: alege(contact, COL_CONTACT_AMPRENTA),
    t: token || null,
    v: convocari.map(c => [c.id, c.nr_document, c.fisier_convocator_path ?? null, c.data_expediere ?? null, c.stare]).sort((a, b) => compara(a[0], b[0])),
  })
}

/** Clasifică un deținător pe datele date (aceleași reguli la pregătire și la recitire). */
function clasifica({ proiect, uat, rand, detinator, parcela, contact, token, convocari }) {
  if (!detinator || detinator.sters_la) return { motiv: 'deținătorul nu mai e activ' }
  if (!parcela || parcela.sters_la) return { motiv: 'parcela nu mai e activă' }
  const r = { ...rand, calitate: detinator.calitate, adresa_cunoscuta: contact ? contact.adresa_cunoscuta : rand.adresa_cunoscuta }
  const motivRand = motivBlocareConvocator(proiect, uat, r)
  if (motivRand) return { motiv: motivRand }
  const expediate = convocari.filter(c => c.data_expediere), neexp = convocari.filter(c => !c.data_expediere)
  if (neexp.length > 1) return { motiv: `are ${neexp.length} convocări poștale neexpediate (${neexp.map(c => c.nr_document).join(', ')}) — rezolvă în Fișa parcelei` }
  if (neexp.length === 1) {
    const c = neexp[0]
    if (c.fisier_convocator_path) return { actiune: 'reia', conv: c }
    const lipsa = verificaDateConvocator({ nrDocument: c.nr_document, token, uat, contact: null, proiect, detinator, contactDetinator: contact })
    if (lipsa.length) return { motiv: `${c.nr_document} fără fișier, nu se poate regenera: ${lipsa.join('; ')}` }
    return { actiune: 'reincarca', conv: c }
  }
  if (expediate.length) return { motiv: `are deja convocare poștală expediată (${expediate.map(c => c.nr_document).join(', ')})` }
  const lipsa = verificaDateConvocator({ nrDocument: 'C-0000', token, uat, contact: null, proiect, detinator, contactDetinator: contact })
  if (lipsa.length) return { motiv: lipsa.join('; ') }
  return { actiune: 'nou' }
}

// convocările poștale active, neșterse logic (P2: `.is('sters_la', null)`, ca vederea)
const qConvocari = (client) => client.from('red_convocari').select(COL_CONVOCARE + ', sters_la').eq('canal', 'posta').eq('stare', 'activ').is('sters_la', null)

/**
 * Pregătirea lotului (DOAR citiri). Întoarce { blocat, plan, exclusi, protectie }:
 *  - blocat: motivul pe proiect / UAT (motivBlocareConvocator fără rând) → plan gol, nimic de consumat;
 *  - plan: [{ actiune: 'nou' | 'reia' | 'reincarca', rand, detinator, parcela, contact, token, conv?, amprenta }] în ordinea id_parcela, nume;
 *  - exclusi: [{ rand, motiv }]; protectie: RPC-ul de rezervare atomică există.
 */
export async function pregatesteLot(client, { proiect, uat, esteCurent = () => true }) {
  if (!client) throw new Error('Lipsește clientul Supabase')
  if (!proiect?.id || !uat?.id) throw new Error('Alege proiectul și UAT-ul.')
  const blocat = motivBlocareConvocator(proiect, uat, null)
  if (blocat) return { blocat, plan: [], exclusi: [], protectie: null }
  // r3 (fără fallback): fără RPC-ul atomic, lotul e blocat — nicio citire de date, nimic de consumat
  const protectie = await detecteazaRezervare(client)
  if (!esteCurent()) throw abandonat()
  if (!protectie) return { blocat: MESAJ_FARA_PROTECTIE, plan: [], exclusi: [], protectie: false }

  // detinator_id e unic în vedere (un deținător are o singură parcelă) → cheie keyset stabilă
  const randuri = await citestePaginat(() => client.from('red_v_stare_parcela')
    .select('parcela_id, detinator_id, uat_id, uat3, id_parcela, tronson, nume, calitate, adresa_cunoscuta')
    .eq('proiect_id', proiect.id).eq('uat_id', uat.id), { cheie: 'detinator_id', esteCurent })
  if (!esteCurent()) throw abandonat()
  const idsDet = randuri.map(r => r.detinator_id), idsParc = randuri.map(r => r.parcela_id)
  const [det, parc, cont, tok, conv] = await Promise.all([
    citesteInChei(() => client.from('red_detinatori').select(COL_DETINATOR), 'id', idsDet, 'id', esteCurent),
    citesteInChei(() => client.from('red_parcele').select(COL_PARCELA_CONVOCATOR), 'id', idsParc, 'id', esteCurent),
    citesteInChei(() => client.from('red_detinatori_contact').select('*'), 'detinator_id', idsDet, 'detinator_id', esteCurent),   // PII — doar admin/editor
    citesteInChei(() => client.from('red_detinatori_token').select('detinator_id, token_raspuns'), 'detinator_id', idsDet, 'detinator_id', esteCurent),
    citesteInChei(() => qConvocari(client), 'detinator_id', idsDet, 'id', esteCurent),
  ])
  if (!esteCurent()) throw abandonat()
  const peId = (lista, k) => Object.fromEntries((lista || []).map(x => [x[k], x]))
  const dMap = peId(det, 'id'), pMap = peId(parc, 'id'), cMap = peId(cont, 'detinator_id'), tMap = peId(tok, 'detinator_id')
  const convPeDet = {}; (conv || []).forEach(c => { (convPeDet[c.detinator_id] ||= []).push(c) })

  const plan = [], exclusi = []
  const sortate = randuri.slice().sort((a, b) => compara(a.id_parcela, b.id_parcela) || compara(a.nume, b.nume) || compara(a.detinator_id, b.detinator_id))
  for (const rand of sortate) {
    const date = { detinator: dMap[rand.detinator_id] || null, parcela: pMap[rand.parcela_id] || null, contact: cMap[rand.detinator_id] || null,
      token: tMap[rand.detinator_id]?.token_raspuns || null, convocari: convPeDet[rand.detinator_id] || [] }
    const k = clasifica({ proiect, uat, rand, ...date })
    if (k.motiv) { exclusi.push({ rand, motiv: k.motiv }); continue }
    plan.push({ rand, actiune: k.actiune, conv: k.conv, detinator: date.detinator, parcela: date.parcela, contact: date.contact, token: date.token, amprenta: amprentaRand(date) })
  }
  return { blocat: null, plan, exclusi, protectie }
}

/** P1-3: recitirea unui rând din BD chiar înainte de acțiune. */
export async function recitesteRand(client, { detinatorId, parcelaId, esteCurent = () => true }) {
  const una = async (q) => { const { data, error } = await q; if (error) throw error; return data ?? null }
  const [detinator, parcela, contact, tok, convocari] = await Promise.all([
    una(client.from('red_detinatori').select(COL_DETINATOR).eq('id', detinatorId).maybeSingle()),
    una(client.from('red_parcele').select(COL_PARCELA_CONVOCATOR).eq('id', parcelaId).maybeSingle()),
    una(client.from('red_detinatori_contact').select('*').eq('detinator_id', detinatorId).maybeSingle()),
    una(client.from('red_detinatori_token').select('detinator_id, token_raspuns').eq('detinator_id', detinatorId).maybeSingle()),
    // r3 (P2-8): convocările recitite COMPLET (keyset pe id, până la pagina goală), ca la pregătire — fără plafon
    citestePaginat(() => qConvocari(client).eq('detinator_id', detinatorId), { cheie: 'id', esteCurent }),
  ])
  return { detinator, parcela, contact, token: tok?.token_raspuns || null, convocari: convocari || [] }
}

// r3 (P1-2): proiectul și UAT-ul se recitesc din BD înainte de fiecare acțiune; orice diferență față de ce a văzut „Verifică” → „schimbat”.
// Se compară cheile obiectului primit de la UI (același select('*')), cu ordinea cheilor fixă.
const amprentaObiect = (o, chei) => JSON.stringify(chei.map(k => [k, o?.[k] ?? null]))
export async function recitesteProiectUat(client, { proiectId, uatId }) {
  const una = async (q) => { const { data, error } = await q; if (error) throw error; return data ?? null }
  const [proiect, uat] = await Promise.all([
    una(client.from('red_proiecte').select('*').eq('id', proiectId).maybeSingle()),
    una(client.from('red_uat').select('*').eq('id', uatId).maybeSingle()),
  ])
  return { proiect, uat }
}

/** Ce intră în rulare: limita se aplică DOAR acțiunilor `nou` (P1-2); `reia` doar cu includeGenerate; `reincarca` mereu (nu consumă număr). */
export function selecteazaLot(plan, { limita = LIMITA_LOT, includeGenerate = false } = {}) {
  const lim = limitaValida(limita)
  let noi = 0
  return plan.map(p => {
    if (p.actiune === 'reia' && !includeGenerate) return { p, decizie: 'deja' }
    if (p.actiune === 'nou') { noi += 1; if (noi > lim) return { p, decizie: 'amanat' } }
    return { p, decizie: 'fa' }
  })
}

/** Câte numere noi C se consumă cel mult într-o rulare. */
export const numereDeConsumat = (plan, limita = LIMITA_LOT) => Math.min(plan.filter(p => p.actiune === 'nou').length, limitaValida(limita))
export const limitaValida = (l) => { const n = Math.floor(Number(l)); return Number.isFinite(n) && n >= 1 ? Math.min(n, LIMITA_LOT) : LIMITA_LOT }

/**
 * Execută lotul. Întoarce { fisiere: [{ nume, blob }], raport: [{ rand, actiune, stare, nrDocument, motiv, borderou? }] }.
 * `protectie` trebuie să fie true (RPC-ul există); `esteCurent()` = generația UI (proiect / UAT neschimbate), verificată ca oprirea.
 * stare ∈ 'ok' | 'eroare' | 'schimbat' | 'oprit' | 'amanat' | 'deja'. O eroare pe rând se notează și lotul continuă;
 * `esteOprit()` se verifică înainte de fiecare rând.
 */
export async function executaLot(client, { plan, proiect, uat, templateArrayBuffer, limita = LIMITA_LOT, includeGenerate = false, protectie = false,
  esteOprit = () => false, esteCurent = () => true, onProgres = () => {}, deps = {} }) {
  if (!client) throw new Error('Lipsește clientul Supabase')
  if (!templateArrayBuffer) throw new Error('Lipsește șablonul convocatorului')
  if (protectie !== true) throw new Error(`Generarea în masă e oprită: ${MESAJ_FARA_PROTECTIE}.`)   // r3: fără fallback
  const blocat = motivBlocareConvocator(proiect, uat, null)
  if (blocat) throw new Error(`Nu se poate genera: ${blocat}.`)
  const { genereaza = genereazaConvocator, reincarca = reincarcaConvocator } = deps
  const lim = limitaValida(limita)
  const selectie = selecteazaLot(plan, { limita: lim, includeGenerate })
  const deFacut = selectie.filter(s => s.decizie === 'fa').length
  const cheiProiect = Object.keys(proiect).sort(), cheiUat = Object.keys(uat).sort()
  const amprentaPU = amprentaObiect(proiect, cheiProiect) + amprentaObiect(uat, cheiUat)
  const fisiere = [], raport = []
  let oprit = false, motivOprire = 'neprocesat (oprit)', i = 0
  for (const { p, decizie } of selectie) {
    const baza = { rand: p.rand, actiune: p.actiune, nrDocument: p.conv?.nr_document || '' }
    if (decizie === 'deja') { raport.push({ ...baza, stare: 'deja', motiv: 'deja generat, neexpediat — bifează „include și cele deja generate” ca să intre în zip' }); continue }
    if (decizie === 'amanat') { raport.push({ ...baza, stare: 'amanat', motiv: `peste limita de ${lim} convocatoare noi pe lot — rulează din nou` }); continue }
    if (!oprit && (esteOprit() || !esteCurent())) oprit = true
    if (oprit) { raport.push({ ...baza, stare: 'oprit', motiv: motivOprire }); continue }
    onProgres({ i: ++i, n: deFacut, rand: p.rand })
    let nrDocument = baza.nrDocument, rezervat = false
    try {
      let blob, date = p
      if (p.actiune === 'reia') {
        const { data, error } = await client.storage.from(BUCKET_REDARI).download(p.conv.fisier_convocator_path)
        if (error || !data) throw new Error(`descărcarea ${p.conv.fisier_convocator_path} a eșuat: ${error?.message || error || 'fișier gol'}`)
        blob = data
      } else {
        // P1-3: recitire din BD + aceleași gărzi pe datele proaspete; orice schimbare față de plan → „schimbat între timp”, fără număr consumat
        const [proaspat, pu] = await Promise.all([
          recitesteRand(client, { detinatorId: p.rand.detinator_id, parcelaId: p.rand.parcela_id, esteCurent }),
          recitesteProiectUat(client, { proiectId: proiect.id, uatId: uat.id }),
        ])
        // r4 (Jakarinos r3 P2): generația / identitatea UI se verifică IMEDIAT după recitiri, înainte de rezervare (un răspuns întârziat nu rezervă)
        if (!esteCurent()) { oprit = true; raport.push({ ...baza, stare: 'oprit', motiv: motivOprire }); continue }
        if (!pu.proiect || !pu.uat || amprentaObiect(pu.proiect, cheiProiect) + amprentaObiect(pu.uat, cheiUat) !== amprentaPU) {
          raport.push({ ...baza, stare: 'schimbat', motiv: 'proiectul sau UAT-ul s-a schimbat între timp — rulează din nou „Verifică”' }); continue
        }
        if (amprentaRand(proaspat) !== p.amprenta) { raport.push({ ...baza, stare: 'schimbat', motiv: 'schimbat între timp (date sau convocări) — rulează din nou „Verifică”' }); continue }
        const k = clasifica({ proiect: pu.proiect, uat: pu.uat, rand: p.rand, ...proaspat })
        if (k.motiv || k.actiune !== p.actiune) { raport.push({ ...baza, stare: 'schimbat', motiv: `schimbat între timp: ${k.motiv || 'altă acțiune'}` }); continue }
        date = { ...p, ...proaspat }
        const intrare = { detinator: date.detinator, contactDetinator: date.contact, contact: null, parcela: date.parcela, uat: pu.uat, proiect: pu.proiect, token: date.token, templateArrayBuffer }
        const cale = { proiectCod: pu.proiect.cod, uat3: p.rand.uat3, idParcela: p.rand.id_parcela }
        let convocareId = p.conv?.id
        if (p.actiune === 'nou') {
          // rezervarea atomică (lock + recitire sub lock + RD001/RD002 + număr + INSERT, o tranzacție). Fără RPC → oprire, fără cale alternativă.
          // r4: același punct ca ModalConvocator (rezervaNumarConvocare) — lotul: canal poștă, fără confirmare
          let rez
          try { rez = await rezervaNumarConvocare(client, { detinatorId: p.rand.detinator_id, confirmat: false, canal: 'posta' }) }
          catch (e) {
            if (e?.code === 'FARA_RPC') { oprit = true; motivOprire = `neprocesat: ${MESAJ_FARA_PROTECTIE}`; raport.push({ ...baza, stare: 'eroare', motiv: MESAJ_FARA_PROTECTIE }); continue }
            if (CODURI_SCHIMBAT.includes(e?.code)) { raport.push({ ...baza, stare: 'schimbat', motiv: `schimbat între timp: ${e.message || e.code}` }); continue }
            throw e
          }
          convocareId = rez.convocareId; nrDocument = rez.nrDocument; rezervat = true
        }
        // rândul există (din RPC sau convocarea fără fișier): documentul se încarcă prin calea versionată existentă (v1 la primul upload)
        const g = await genereaza({ ...intrare, nrDocument, ...(p.actiune === 'reincarca' ? { dataDocument: p.conv.created_at } : {}) })
        await reincarca(client, { convocareId, blob: g.blob, hash: g.hash, ...cale, nrDocument })
        blob = g.blob
      }
      fisiere.push({ nume: `${nrDocument}_${p.rand.id_parcela}.docx`, blob })
      raport.push({ ...baza, nrDocument, stare: 'ok', motiv: '',
        borderou: date.contact?.adresa_cunoscuta === true ? randBorderou({ nrDocument, detinator: date.detinator, contact: date.contact, idParcela: p.rand.id_parcela }) : null })
    } catch (e) {
      const m = e?.message || e?.details || String(e)
      raport.push({ ...baza, nrDocument, stare: 'eroare', motiv: rezervat ? `${m} (numărul ${nrDocument} a fost rezervat; convocarea rămâne fără fișier și se reîncarcă la rularea următoare)` : m })
    }
  }
  return { fisiere, raport }
}

/** Sumarul raportului (pentru panou). */
export function sumar(raport = [], exclusi = []) {
  const s = { nou: 0, reia: 0, reincarca: 0, erori: 0, oprite: 0, amanate: 0, schimbate: 0, deja: 0, exclusi: exclusi.length }
  for (const r of raport) {
    if (r.stare === 'ok') s[r.actiune] += 1
    else if (r.stare === 'eroare') s.erori += 1
    else if (r.stare === 'oprit') s.oprite += 1
    else if (r.stare === 'amanat') s.amanate += 1
    else if (r.stare === 'schimbat') s.schimbate += 1
    else if (r.stare === 'deja') s.deja += 1
  }
  return s
}

const ETICHETA_STARE = { ok: 'generat', eroare: 'EROARE', oprit: 'oprit', amanat: 'amânat', exclus: 'exclus', schimbat: 'schimbat', deja: 'deja generat' }
export const ANTET_OPIS = ['Nr.', 'Nr. document', 'ID parcelă', 'Deținător', 'Calitate', 'Acțiune', 'Stare', 'Motiv']

/** Opisul xlsx: foaia „Opis” (toate rândurile, cu motiv) + „Borderou” (convocările din zip, cu adresă cunoscută). */
export function opisXlsx({ proiect, uat, raport = [], exclusi = [] }) {
  const randuri = [
    ...raport.map(r => [r.nrDocument, r.rand.id_parcela, r.rand.nume, r.rand.calitate, ACTIUNI[r.actiune] || r.actiune, ETICHETA_STARE[r.stare] || r.stare, r.motiv]),
    ...exclusi.map(x => ['', x.rand.id_parcela, x.rand.nume, x.rand.calitate, '', ETICHETA_STARE.exclus, x.motiv]),
  ].map((r, i) => [i + 1, ...r.map(v => v ?? '')])
  const wb = XLSX.utils.book_new()
  const titlu = [`Opis convocatoare — ${proiect?.cod || ''} — UAT ${uat?.nume || ''}`]
  const ws = XLSX.utils.aoa_to_sheet([titlu, ANTET_OPIS, ...randuri])
  ws['!cols'] = [6, 12, 16, 32, 14, 12, 10, 60].map(wch => ({ wch }))
  XLSX.utils.book_append_sheet(wb, ws, 'Opis')
  const b = raport.filter(r => r.stare === 'ok' && r.borderou).map(r => r.borderou)
  const cols = ['nr_document', 'nume', 'adresa', 'cod_postal', 'localitate', 'judet', 'id_parcela']
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([cols, ...b.map(r => cols.map(c => r[c] ?? ''))]), 'Borderou')
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
}

// JSZip primește ArrayBuffer în browser și în Node (Blob-ul din Node nu e acceptat)
const caBuffer = (b) => (b && typeof b.arrayBuffer === 'function' ? b.arrayBuffer() : b)

/** Zip-ul lotului: DOCX-urile + borderou.csv (formatul existent) + opis.xlsx. */
export async function construiesteZip({ proiect, uat, fisiere = [], raport = [], exclusi = [] }) {
  const zip = new JSZip()
  const vazute = new Set()
  for (const f of fisiere) {
    let nume = f.nume, k = 2
    while (vazute.has(nume)) nume = f.nume.replace(/\.docx$/, `_${k++}.docx`)
    vazute.add(nume)
    zip.file(nume, await caBuffer(f.blob))
  }
  zip.file('borderou.csv', await caBuffer(borderouCsv(raport.filter(r => r.stare === 'ok' && r.borderou).map(r => r.borderou))))
  zip.file('opis.xlsx', opisXlsx({ proiect, uat, raport, exclusi }))
  return zip.generateAsync({ type: 'blob', mimeType: 'application/zip' })
}
