// Citirea cu AI a documentelor noi din SEAP (ofertare-document-nou-citeste) — mesajele pentru om (Răcari, 06.10.2026).
// „Răspuns consolidat nr. 2” (2,7 MB, scanat): apelul a fost tăiat de gateway la 150 s (504), iar eroarea apărea doar
// într-un toast care dispare. Acum mesajul spune ce s-a întâmplat și ce faci, și rămâne pe cardul documentului.

export const MESAJ_TIMEOUT_UI = 'Citirea a depășit timpul (documentul e mare sau scanat). Deschide tab-ul Documentație și apasă ' +
  '«Procesează» pe acest document — îl citește pe felii, fără limită de timp. Apoi apasă din nou «Citește cu AI».'

// error = eroarea din supabase.functions.invoke (FunctionsHttpError are context = Response), data = corpul răspunsului.
export function mesajEroareCitire(error, data) {
  if (data?.error) return String(data.error)
  const st = error?.context?.status
  if (st === 504 || st === 546) return MESAJ_TIMEOUT_UI          // 504 gateway, 546 = worker oprit (limita de resurse)
  const m = String(error?.message || '')
  if (/timed? ?out|timeout/i.test(m)) return MESAJ_TIMEOUT_UI
  return m || 'eroare necunoscută'
}

// Ce scrie la „📄 Text original” când nu există text: documentul încă necitit ≠ document citit fără text (scanat).
export function mesajFaraText(status) {
  if (!status || status === 'neprocesat') return 'Încă necitit — apasă «🤖 Citește cu AI» (îl citește pe felii, ca în Documentație, apoi face rezumatul).'
  if (status === 'eroare') return 'Citirea pe felii a dat eroare — vezi motivul în Documentație, sau deschide documentul original.'
  if (status === 'ignorat') return 'Document marcat „ignorat” la procesare — deschide documentul original.'
  return 'Nu există text extras pentru acest document (poate e scanat) — deschide documentul original.'
}

// Regula de citire a documentației (Răzvan 06.10.2026: „există deja regula asta la citirea documentației”): un document
// necitit se citește întâi PE FELII, ca la „🤖 Procesează” (edge ofertare-ingest-doc, câte o rundă sub limita de 150 s,
// poarta pe cheltuială owner/responsabil impusă pe server), iar rezumatul / întrebările răspunse se fac apoi din TEXT.
// Înainte, „Citește cu AI” de la documentele noi din SEAP trimitea PDF-ul întreg într-un singur apel (Răcari: 504).
// invoke = supabase.functions.invoke (injectat pentru teste); pauza = (ms) => Promise.
export const STARI_CITITE = ['procesat', 'partial']
export const trebuieCititPeFelii = status => !STARI_CITITE.includes(status) && status !== 'ignorat'

export async function citestePeFelii(invoke, docId, { pauza = ms => new Promise(r => setTimeout(r, ms)), maxRunde = 60, onRunda } = {}) {
  let continua = true, runde = 0, esuate = 0
  while (continua && runde < maxRunde) {
    onRunda?.(runde + 1)
    const { data, error } = await invoke('ofertare-ingest-doc', { body: { doc_id: docId } })
    if (error || data?.error) {
      // 403 = poarta pe cheltuială: nu are rost să reîncercăm
      if (error?.context?.status === 403 || /ownerul sau responsabilul/i.test(String(data?.error || ''))) return { ok: false, poarta: true, eroare: mesajEroareCitire(error, data) }
      if (++esuate > 2) return { ok: false, eroare: mesajEroareCitire(error, data) }
      await pauza(5000)
      continue
    }
    esuate = 0
    continua = !!data?.continua
    runde++
  }
  return continua ? { ok: false, eroare: `Citirea pe felii nu s-a terminat după ${maxRunde} runde — continuă din Documentație («Procesează»).` } : { ok: true, runde }
}

// Copilot 06.10 (NO-GO P1 pe a44fa0c): refuzul porții pe cheltuială (403 la citirea pe felii) e TERMINAL pentru „Citește cu AI”.
// Înainte UI-ul cădea pe calea veche (PDF întreg la ofertare-document-nou-citeste) — exact apelul costisitor / cu 504 pe care
// poarta îl oprește. Acum: mesaj pe card, fără niciun apel AI. Rezumatul unui document deja citit (procesat) rămâne la îndemâna oricui.
export const MESAJ_POARTA = 'Documentul nu e citit încă, iar citirea lui costă: o pornește doar ownerul sau responsabilul licitației ' +
  '(«🤖 Citește cu AI» aici sau «Procesează» în Documentație). După ce e citit, rezumatul îl poate face oricine.'

// Tot traseul butonului, testat cap-coadă: necitit → pe felii (poarta pe server) → rezumat din text. Întoarce {ok, data} sau {ok:false, eroare, poarta?}.
export async function citesteCuAi(invoke, docId, status, opt = {}) {
  if (trebuieCititPeFelii(status)) {
    const r = await citestePeFelii(invoke, docId, opt)
    if (r.poarta) return { ok: false, poarta: true, eroare: MESAJ_POARTA }
    if (!r.ok) return { ok: false, eroare: r.eroare }
  }
  const { data, error } = await invoke('ofertare-document-nou-citeste', { body: { document_id: docId } })
  if (error || data?.error) return { ok: false, eroare: mesajEroareCitire(error, data) }
  return { ok: true, data }
}
