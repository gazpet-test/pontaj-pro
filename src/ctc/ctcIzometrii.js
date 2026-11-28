// Lista „Izometrii generate” din CTC (exporturile din Execuție → Izometrie, read-only) + descărcarea lor.
// Livrarea separată a exportului IZO (> 50 MB: Excel-ul + PDF-urile în același dosar) se recunoaște și se descarcă EXACT
// ca în istoricul din Izometrie (esteLivrareSeparata / descarcaExportIstoric din izoExportIzoBd.js), fără o a doua definiție.
import { esteLivrareSeparata, descarcaExportIstoric } from '../izoExportIzoBd.js'

const BUCKET_PACHETE = 'executie-pachete-pdf'
const mesaj = e => (e && (e.message || e.error_description)) || String(e)

// Aprobat = pachetul are aprobarea Transgaz (aprobat_la sau status 'aprobat') sau e chiar PDF-ul de aprobare.
export function esteAprobat(doc, pachet) {
  return doc?.tip_document === 'pdf_aprobare_transgaz' || !!pachet?.aprobat_la || pachet?.status === 'aprobat'
}

// docs: executie_pachete_documente; pachete: executie_pachete_lansare (doar ale proiectului); tronsoane: executie_tronsoane.
// Întoarce rândurile ordonate: cod document, apoi revizie descrescător, apoi cel mai nou upload.
// `ultima` = cel mai nou fișier din cea mai nouă revizie, pe document și tip (centralizator / PDF aprobat).
// `separat` = rândul e Excel-ul unui export IZO livrat în fișiere separate (PDF-urile stau în dosarul lui).
export function construiesteIzometrii(docs, pachete, tronsoane) {
  const pm = new Map((pachete || []).map(p => [p.id, p]))
  const tm = new Map((tronsoane || []).map(t => [t.id, t]))
  const rows = (docs || []).filter(d => pm.has(d.pachet_id)).map(d => {
    const p = pm.get(d.pachet_id)
    const t = tm.get(p.tronson_id)
    return {
      id: d.id, pachet_id: d.pachet_id, fisier_nume: d.fisier_nume, fisier_path: d.fisier_path, tip_document: d.tip_document, uploadat_la: d.uploadat_la,
      cod: p.cod_document_full || `#${p.numar_document ?? p.id}`, revizie: p.revizie ?? 0,
      tronson: t ? [t.cod, t.denumire].filter(Boolean).join(' · ') : '—',
      aprobat: esteAprobat(d, p), ultima: false, separat: esteLivrareSeparata(d),
    }
  })
  rows.sort((a, b) => a.cod.localeCompare(b.cod, 'ro', { numeric: true }) || b.revizie - a.revizie
    || String(b.uploadat_la || '').localeCompare(String(a.uploadat_la || '')) || b.id - a.id)
  const vazut = new Set()
  for (const r of rows) { const k = r.cod + '|' + r.tip_document; if (!vazut.has(k)) { vazut.add(k); r.ultima = true } }
  return rows
}

/** fn_sud_drept(proiect, 'citire') → true / false; eroare sau alt răspuns → null (necunoscut ≠ fals, L18). */
async function dreptCitireNdt(sb, proiectId) {
  try {
    const { data, error } = await sb.rpc('fn_sud_drept', { p_proiect: proiectId, p_nivel: 'citire' })
    if (error) return null
    return data === true ? true : data === false ? false : null
  } catch { return null }
}

/**
 * „⬇ Descarcă” din CTC.
 * Un fișier (Excel vechi, ZIP-ul exportului, PDF-ul aprobat) → link semnat cu numele fișierului, ca până acum (fără arhiva NDT).
 * Livrare separată → întâi dreptul de citire pe arhiva de buletine NDT a proiectului (lista fișierelor stă în sud_exporturi,
 * vizibilă doar cu el); refuzat / neverificat = mesaj clar, nimic descărcat. Apoi TOATE fișierele exportului într-un ZIP local
 * cu structura arhivei originale (descarcaExportIstoric); listă nevalidabilă / fișier lipsă = eroare, fără ZIP parțial.
 * `semnal` (AbortSignal, L24): ecranul îl oprește la demontare / alt proiect → transferul în curs se întrerupe, următoarele
 * fișiere nu se mai cer și ZIP-ul nu se mai construiește (oprirea trece prin fetch, singura intrare a descărcării din istoric).
 * @returns {Promise<{ok:true, url:string} | {ok:true, bytes:Uint8Array, nume:string, numar:number} | {ok:false, eroare:string, anulat?:true}>}
 */
export async function descarcaIzometrie(sb, r, proiectId, fetchImpl, semnal) {
  const oprit = { ok: false, anulat: true, eroare: 'Descărcarea a fost oprită.' }
  if (!r?.separat) {
    try {
      const { data, error } = await sb.storage.from(BUCKET_PACHETE).createSignedUrl(r.fisier_path, 120, { download: r.fisier_nume || true })
      if (error || !data?.signedUrl) return { ok: false, eroare: error ? mesaj(error) : 'fișierul nu poate fi descărcat.' }
      return { ok: true, url: data.signedUrl }
    } catch (e) { return { ok: false, eroare: mesaj(e) } }
  }
  const nimic = 'nu s-a descărcat nimic.'
  if (proiectId === null || proiectId === undefined) return { ok: false, eroare: `Proiectul nu e cunoscut: ${nimic}` }
  const dr = await dreptCitireNdt(sb, proiectId)
  if (dr === false) {
    return { ok: false, eroare: `Exportul are Excel-ul și PDF-urile buletinelor în fișiere separate, iar lista lor se vede doar cu dreptul de citire pe arhiva de buletine NDT a proiectului, pe care nu îl ai: ${nimic}` }
  }
  if (dr !== true) return { ok: false, eroare: `Dreptul de citire pe arhiva de buletine NDT nu s-a putut verifica: ${nimic} Reîncearcă.` }
  if (semnal?.aborted) return oprit
  const f = fetchImpl ?? globalThis.fetch
  const fetchOpribil = (url, opt) => {
    if (semnal?.aborted) return Promise.reject(new Error('descărcare oprită'))
    return f(url, semnal ? { ...(opt || {}), signal: semnal } : opt)
  }
  let res
  try {
    res = await descarcaExportIstoric(sb, { id: r.id, pachet_id: r.pachet_id, fisier_path: r.fisier_path, fisier_nume: r.fisier_nume }, fetchOpribil)
  } catch (e) { res = { ok: false, eroare: `${mesaj(e)} — ${nimic}` } }
  return semnal?.aborted ? oprit : res
}
