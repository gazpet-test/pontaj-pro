/* convocatoareMasa.js — generarea în masă a convocatoarelor poștale pe UAT (L1, BRIEF §4.1; docs/redari/PLAN_CONVOCATOARE_MASA.md).
   Logică pură, cu clientul Supabase injectat (testabilă cu un client fals). Fără reguli noi: gărzile, numerotarea și salvarea sunt
   cele de la generarea pe rând (motivBlocareConvocator, verificaDateConvocator, fn_red_numar_document('C'), genereazaConvocator,
   salveazaConvocator / reincarcaConvocator). NU marchează expediat și NU trimite nimic. */
import JSZip from 'jszip'
import * as XLSX from 'xlsx-js-style'
import { genereazaConvocator, verificaDateConvocator, salveazaConvocator, reincarcaConvocator, borderouCsv, BUCKET_REDARI } from './docx.js'
import { motivBlocareConvocator, citestePaginat, citesteIn, COL_DETINATOR, COL_CONVOCARE } from './ui/comune.jsx'

export const LIMITA_LOT = 200
export const COL_PARCELA_CONVOCATOR = 'id, proiect_id, uat_id, id_parcela, tronson, sat, tarla, nr_cadastral, poz_hg, suprafata_temporara_mp, categoria_folosinta'

export const ACTIUNI = { nou: 'nou', reia: 'reluat', reincarca: 'reîncărcat' }
const compara = (a, b) => String(a ?? '').localeCompare(String(b ?? ''), 'ro', { numeric: true })

/** Un rând de borderou Poștă (aceleași coloane și reguli ca borderoul din Registru). */
export const randBorderou = ({ nrDocument, detinator, contact, idParcela }) => {
  const c = contact || {}
  return { nr_document: nrDocument, nume: detinator?.nume || '', adresa: [c.adresa_strada, c.adresa_sat].filter(Boolean).join(', '),
    cod_postal: c.cod_postal || '', localitate: c.adresa_comuna || c.adresa_sat || '', judet: c.adresa_judet || '', id_parcela: idParcela || '' }
}

/**
 * Pregătirea lotului (DOAR citiri). Întoarce { blocat, plan, exclusi }:
 *  - blocat: motivul pe proiect / UAT (motivBlocareConvocator fără rând) → plan gol, nimic de consumat;
 *  - plan: [{ actiune: 'nou' | 'reia' | 'reincarca', rand, detinator, parcela, contact, token, conv? }] în ordinea id_parcela, nume;
 *  - exclusi: [{ rand, motiv }].
 */
export async function pregatesteLot(client, { proiect, uat, esteCurent = () => true }) {
  if (!client) throw new Error('Lipsește clientul Supabase')
  if (!proiect?.id || !uat?.id) throw new Error('Alege proiectul și UAT-ul.')
  const blocat = motivBlocareConvocator(proiect, uat, null)
  if (blocat) return { blocat, plan: [], exclusi: [] }

  const randuri = await citestePaginat(() => client.from('red_v_stare_parcela')
    .select('parcela_id, detinator_id, uat_id, uat3, id_parcela, tronson, nume, calitate, adresa_cunoscuta')
    .eq('proiect_id', proiect.id).eq('uat_id', uat.id).order('parcela_id').order('detinator_id'))
  if (!esteCurent()) throw new Error('Citire abandonată')
  const idsDet = randuri.map(r => r.detinator_id), idsParc = randuri.map(r => r.parcela_id)
  const [det, parc, cont, tok, conv] = await Promise.all([
    citesteIn(() => client.from('red_detinatori').select(COL_DETINATOR).is('sters_la', null).order('id'), 'id', idsDet),
    citesteIn(() => client.from('red_parcele').select(COL_PARCELA_CONVOCATOR).order('id'), 'id', idsParc),
    citesteIn(() => client.from('red_detinatori_contact').select('*').order('detinator_id'), 'detinator_id', idsDet),   // PII — doar admin/editor
    citesteIn(() => client.from('red_detinatori_token').select('detinator_id, token_raspuns').order('detinator_id'), 'detinator_id', idsDet),
    citesteIn(() => client.from('red_convocari').select(COL_CONVOCARE).eq('canal', 'posta').eq('stare', 'activ').order('created_at').order('id'), 'detinator_id', idsDet),
  ])
  if (!esteCurent()) throw new Error('Citire abandonată')
  const peId = (lista, k) => Object.fromEntries((lista || []).map(x => [x[k], x]))
  const dMap = peId(det, 'id'), pMap = peId(parc, 'id'), cMap = peId(cont, 'detinator_id'), tMap = peId(tok, 'detinator_id')
  const convPeDet = {}; (conv || []).forEach(c => { (convPeDet[c.detinator_id] ||= []).push(c) })

  const plan = [], exclusi = []
  const sortate = randuri.slice().sort((a, b) => compara(a.id_parcela, b.id_parcela) || compara(a.nume, b.nume) || compara(a.detinator_id, b.detinator_id))
  for (const rand of sortate) {
    const exclude = (motiv) => exclusi.push({ rand, motiv })
    const detinator = dMap[rand.detinator_id], parcela = pMap[rand.parcela_id]
    if (!detinator) { exclude('deținătorul nu mai e activ'); continue }
    if (!parcela) { exclude('parcela nu a putut fi citită'); continue }
    const motivRand = motivBlocareConvocator(proiect, uat, rand)
    if (motivRand) { exclude(motivRand); continue }
    const lista = convPeDet[rand.detinator_id] || []
    const expediate = lista.filter(c => c.data_expediere), neexp = lista.filter(c => !c.data_expediere)
    if (neexp.length > 1) { exclude(`are ${neexp.length} convocări poștale neexpediate (${neexp.map(c => c.nr_document).join(', ')}) — rezolvă în Fișa parcelei`); continue }
    const contact = cMap[rand.detinator_id] || null, token = tMap[rand.detinator_id]?.token_raspuns || null
    const baza = { rand, detinator, parcela, contact, token }
    if (neexp.length === 1) {
      const c = neexp[0]
      if (c.fisier_convocator_path) { plan.push({ ...baza, actiune: 'reia', conv: c }); continue }
      const lipsa = verificaDateConvocator({ nrDocument: c.nr_document, token, uat, contact: null, proiect, detinator, contactDetinator: contact })
      if (lipsa.length) { exclude(`${c.nr_document} fără fișier, nu se poate regenera: ${lipsa.join('; ')}`); continue }
      plan.push({ ...baza, actiune: 'reincarca', conv: c }); continue
    }
    if (expediate.length) { exclude(`are deja convocare poștală expediată (${expediate.map(c => c.nr_document).join(', ')})`); continue }
    const lipsa = verificaDateConvocator({ nrDocument: 'C-0000', token, uat, contact: null, proiect, detinator, contactDetinator: contact })
    if (lipsa.length) { exclude(lipsa.join('; ')); continue }
    plan.push({ ...baza, actiune: 'nou' })
  }
  return { blocat: null, plan, exclusi }
}

/** Câte numere noi C se consumă pentru primele `limita` rânduri din plan. */
export const numereDeConsumat = (plan, limita = LIMITA_LOT) => plan.slice(0, limitaValida(limita)).filter(p => p.actiune === 'nou').length
export const limitaValida = (l) => { const n = Math.floor(Number(l)); return Number.isFinite(n) && n >= 1 ? Math.min(n, LIMITA_LOT) : LIMITA_LOT }

/**
 * Execută lotul: cel mult `limita` rânduri din plan; o eroare pe rând se notează și lotul continuă; `esteOprit()` se verifică
 * înainte de fiecare rând. Întoarce { fisiere: [{ nume, blob }], raport: [{ rand, actiune, stare, nrDocument, motiv, borderou? }] }.
 * stare ∈ 'ok' | 'eroare' | 'oprit' | 'amanat'.
 */
export async function executaLot(client, { plan, proiect, uat, templateArrayBuffer, limita = LIMITA_LOT, esteOprit = () => false, onProgres = () => {}, deps = {} }) {
  if (!client) throw new Error('Lipsește clientul Supabase')
  if (!templateArrayBuffer) throw new Error('Lipsește șablonul convocatorului')
  const blocat = motivBlocareConvocator(proiect, uat, null)
  if (blocat) throw new Error(`Nu se poate genera: ${blocat}.`)
  const { genereaza = genereazaConvocator, salveaza = salveazaConvocator, reincarca = reincarcaConvocator } = deps
  const lim = limitaValida(limita)
  const deFacut = plan.slice(0, lim), amanate = plan.slice(lim)
  const fisiere = [], raport = []
  let oprit = false
  for (let i = 0; i < deFacut.length; i++) {
    const p = deFacut[i]
    if (!oprit && esteOprit()) oprit = true
    if (oprit) { raport.push({ rand: p.rand, actiune: p.actiune, stare: 'oprit', nrDocument: p.conv?.nr_document || '', motiv: 'neprocesat (oprit)' }); continue }
    onProgres({ i: i + 1, n: deFacut.length, rand: p.rand })
    let nrDocument = p.conv?.nr_document || ''
    try {
      let blob
      if (p.actiune === 'reia') {
        const { data, error } = await client.storage.from(BUCKET_REDARI).download(p.conv.fisier_convocator_path)
        if (error || !data) throw new Error(`descărcarea ${p.conv.fisier_convocator_path} a eșuat: ${error?.message || error || 'fișier gol'}`)
        blob = data
      } else {
        const intrare = { detinator: p.detinator, contactDetinator: p.contact, contact: null, parcela: p.parcela, uat, proiect, token: p.token, templateArrayBuffer }
        if (p.actiune === 'reincarca') {
          const g = await genereaza({ ...intrare, nrDocument, dataDocument: p.conv.created_at })
          await reincarca(client, { convocareId: p.conv.id, blob: g.blob, hash: g.hash, proiectCod: proiect.cod, uat3: p.rand.uat3, idParcela: p.rand.id_parcela, nrDocument })
          blob = g.blob
        } else {
          // gărzile se refac chiar înainte de număr (datele pot fi schimbate între pregătire și rulare) — fără număr consumat la lipsuri
          const lipsa = verificaDateConvocator({ nrDocument: 'C-0000', token: p.token, uat, contact: null, proiect, detinator: p.detinator, contactDetinator: p.contact })
          if (lipsa.length) throw new Error(`lipsesc date (niciun număr consumat): ${lipsa.join('; ')}`)
          const { data: nr, error: eNr } = await client.rpc('fn_red_numar_document', { p_tip: 'C', p_uat3: p.rand.uat3, p_tronson: p.rand.tronson ?? null })
          if (eNr) throw eNr
          if (!nr) throw new Error('Numărul de document nu a fost generat.')
          nrDocument = nr
          const g = await genereaza({ ...intrare, nrDocument })
          await salveaza(client, { blob: g.blob, hash: g.hash, proiectCod: proiect.cod, uat3: p.rand.uat3, idParcela: p.rand.id_parcela, nrDocument, detinatorId: p.rand.detinator_id, canal: 'posta' })
          blob = g.blob
        }
      }
      fisiere.push({ nume: `${nrDocument}_${p.rand.id_parcela}.docx`, blob })
      raport.push({ rand: p.rand, actiune: p.actiune, stare: 'ok', nrDocument, motiv: '',
        borderou: p.contact?.adresa_cunoscuta === true ? randBorderou({ nrDocument, detinator: p.detinator, contact: p.contact, idParcela: p.rand.id_parcela }) : null })
    } catch (e) {
      const m = e?.message || e?.details || String(e)
      raport.push({ rand: p.rand, actiune: p.actiune, stare: 'eroare', nrDocument, motiv: nrDocument && p.actiune === 'nou' ? `${m} (numărul ${nrDocument} a fost rezervat)` : m })
    }
  }
  for (const p of amanate) raport.push({ rand: p.rand, actiune: p.actiune, stare: 'amanat', nrDocument: p.conv?.nr_document || '', motiv: `peste limita de ${lim} pe lot — rulează din nou` })
  return { fisiere, raport }
}

/** Sumarul raportului (pentru panou). */
export function sumar(raport = [], exclusi = []) {
  const s = { nou: 0, reia: 0, reincarca: 0, erori: 0, oprite: 0, amanate: 0, exclusi: exclusi.length }
  for (const r of raport) {
    if (r.stare === 'ok') s[r.actiune] += 1
    else if (r.stare === 'eroare') s.erori += 1
    else if (r.stare === 'oprit') s.oprite += 1
    else if (r.stare === 'amanat') s.amanate += 1
  }
  return s
}

const ETICHETA_STARE = { ok: 'generat', eroare: 'EROARE', oprit: 'oprit', amanat: 'amânat', exclus: 'exclus' }
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
