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
  if (!status || status === 'neprocesat') return 'Încă necitit — apasă «🤖 Citește cu AI». Pentru PDF-uri mari sau scanate folosește «Procesează» în Documentație (citire pe felii).'
  if (status === 'eroare') return 'Citirea pe felii a dat eroare — vezi motivul în Documentație, sau deschide documentul original.'
  if (status === 'ignorat') return 'Document marcat „ignorat” la procesare — deschide documentul original.'
  return 'Nu există text extras pentru acest document (poate e scanat) — deschide documentul original.'
}
