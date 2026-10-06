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
// poarta îl oprește. Acum: mesaj pe card, fără niciun apel AI. Rezumatul unui document deja citit (procesat / partial) rămâne la
// îndemâna oricui; aceeași poartă e impusă și în edge pentru PDF-ul întreg (cod 'poarta_cheltuiala').
export const MESAJ_POARTA = 'Documentul nu e citit încă, iar citirea lui costă: o pornește doar ownerul sau responsabilul licitației ' +
  '(«🤖 Citește cu AI» aici sau «Procesează» în Documentație). După ce e citit, rezumatul îl poate face oricine.'

// Tot traseul butonului, testat cap-coadă: necitit → pe felii (poarta pe server) → rezumat din text, tot pe felii. Întoarce {ok, data} sau
// {ok:false, eroare, poarta?}. opt.onProgres(text) = eticheta butonului în timpul lucrului.
export async function citesteCuAi(invoke, docId, status, opt = {}) {
  if (trebuieCititPeFelii(status)) {
    const r = await citestePeFelii(invoke, docId, { ...opt, onRunda: k => opt.onProgres?.(`⏳ citesc pe felii (${k})…`) })
    if (r.poarta) return { ok: false, poarta: true, eroare: MESAJ_POARTA }
    if (!r.ok) return { ok: false, eroare: r.eroare }
  }
  return rezumaPeFelii(invoke, docId, { pauza: opt.pauza, maxRunde: opt.maxRundeRezumat, onRunda: d => opt.onProgres?.(textProgres(d)) })
}

// Rezumatul PE FELII (Răcari 06.10, varianta A aleasă de Răzvan): edge-ul citește câte o felie de text pe apel și întoarce
// {continua, felie, din}; starea feliilor gata rămâne pe server, deci o eroare trecătoare (timp depășit, 504, rețea) se reia de
// unde a rămas. Terminale: poarta pe cheltuială, sursă schimbată, citit între timp, 401 / 403 / 404.
const TERMINAL = ['poarta_cheltuiala', 'sursa_schimbata', 'citit_intre_timp']
export const textProgres = d => (d?.din && d?.felie ? (d.felie >= d.din ? `⏳ rezumat ${d.din}/${d.din} — sinteză…` : `⏳ rezumat felia ${d.felie + 1}/${d.din}…`) : '⏳ citesc…')
export async function rezumaPeFelii(invoke, docId, { pauza = ms => new Promise(r => setTimeout(r, ms)), maxRunde = 80, onRunda } = {}) {
  let esuate = 0
  for (let runda = 0; runda < maxRunde; runda++) {
    const { data, error } = await invoke('ofertare-document-nou-citeste', { body: { document_id: docId } })
    if (error || data?.error) {
      const corp = await corpEroare(error, data)
      // poarta pe server (06.10): PDF-ul întreg fără text extras îl pornește doar owner / responsabil
      if (corp?.cod === 'poarta_cheltuiala') return { ok: false, poarta: true, eroare: MESAJ_POARTA }
      if (TERMINAL.includes(corp?.cod) || [401, 403, 404].includes(error?.context?.status)) return { ok: false, eroare: mesajEroareCitire(error, corp) }
      if (++esuate > 2) return { ok: false, eroare: mesajEroareCitire(error, corp) }
      await pauza(5000)
      continue
    }
    esuate = 0
    if (data?.continua) { onRunda?.(data); continue }
    return { ok: true, data }
  }
  return { ok: false, eroare: `Rezumatul pe felii nu s-a terminat după ${maxRunde} runde — apasă din nou «Citește cu AI» (continuă de unde a rămas).` }
}

// supabase-js întoarce data = null la un răspuns non-2xx; mesajul de business e în corpul Response-ului (error.context).
export async function corpEroare(error, data) {
  if (data || !error?.context || typeof error.context.json !== 'function') return data
  try { return await (typeof error.context.clone === 'function' ? error.context.clone() : error.context).json() } catch { return data }
}

// Copilot conv. 3 (06.10, P1): o citire făcută pe o sursă incompletă (text tăiat la plafon / pagini necitite) se arată ca PARȚIALĂ,
// nu ca rezultat complet — listele de modificări / întrebări pot lipsi. Citirile vechi (fără câmp) rămân fără avertisment.
const fmtNr = n => Number(n || 0).toLocaleString('ro-RO')
export function avertismentCitire(c) {
  if (!c || (c.citire_completa !== false && c.sursa_completa !== false)) return null
  const m = Array.isArray(c.motive_incomplet) ? c.motive_incomplet : []
  const parti = []
  if (m.includes('trunchiat')) parti.push(`AI-ul a primit doar primele ${fmtNr(c.lungime_folosita)} din ${fmtNr(c.lungime_sursa)} de caractere`)
  if (m.includes('pagini_necitite')) parti.push('unele pagini nu au putut fi citite')
  if (m.includes('lista_plafonata')) parti.push(`listele au fost plafonate (AI-ul a găsit ${fmtNr(c.total_modificari)} modificări și ${fmtNr(c.total_intrebari)} întrebări; s-au păstrat primele ${fmtNr((c.modificari || []).length)} / ${fmtNr((c.intrebari_raspunse || []).length)})`)
  if (m.includes('rezumat_taiat')) parti.push('rezumatul a fost scurtat')
  if (m.includes('raspuns_ai_taiat')) parti.push('răspunsul AI a atins limita de lungime')
  // Copilot conv. 3 (06.10, NO-GO pe d459447): tăietură între felii în afara unei întrebări / termene diferite în același document
  if (m.includes('granita_nesigura')) parti.push(`documentul a fost citit pe ${fmtNr(c.felii)} felii și cel puțin o tăietură n-a căzut la începutul unei întrebări — o pereche întrebare–răspuns sau o modificare de la graniță poate fi ruptă`)
  if (m.includes('conflict_termen')) parti.push(`documentul pomenește termene diferite (${listaTermene(c.termene, c.felii > 1)}) — AI-ul nu a ales unul; verifică în document care e cel valabil`)
  if (m.length && m.every(x => x === 'conflict_termen')) return `De verificat: ${parti.join('; ')}.`
  return `Citire PARȚIALĂ: ${parti.join('; ') || 'sursa incompletă'} — modificările / întrebările pot fi incomplete; verifică documentul original.`
}
const fmtData = s => (/^\d{4}-\d{2}-\d{2}$/.test(String(s)) ? String(s).split('-').reverse().join('.') : String(s))
const scurt = (s, n = 90) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t }
const listaTermene = (t, cuFelia) => (Array.isArray(t) ? t : []).map(x => (x && typeof x === 'object'
  ? `${fmtData(x.data)}${cuFelia && x.felie ? ` — felia ${x.felie}` : ''}${x.citat ? ` «${scurt(x.citat)}»` : ''}` : fmtData(x))).join(', ') || '—'
