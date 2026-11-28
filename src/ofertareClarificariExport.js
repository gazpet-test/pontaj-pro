// Exportul adresei de clarificări — logică PURĂ peste răspunsul RPC-ului ofertare_clarificari_export (fără React, fără Supabase), testată în
// ofertareClarificariExport.test.js. Din 20270115a (varianta B, decizia Răzvan 27.11.2026, după review-ul #1210 r3) RPC-ul:
//   * cere poarta punctelor pe server (owner / responsabil al licitației numit de owner / de un admin Ofertare) — altfel 42501 cu mesaj clar;
//   * întoarce în ACELAȘI răspuns { clarificari: [...întrebările „de_trimis”...], temeiuri: [...temeiurile bifate „include în adresă” și confirmate,
//     de pe întrebările exportate și de pe PUNCTELE lor, cu decizia CNSC...] } — UI-ul nu mai citește temeiurile separat (join-ul cu punctele ar fi
//     întors 0 rânduri pentru un cont fără poartă, iar adresa ar fi părut completă).
// Fail-closed: eroare, răspuns în forma veche (tablou = migrarea neaplicată) sau neașteptată = refuz explicit, niciodată o adresă „pe ce avem”.
import { formatCitare, motivNeexportabil } from './ofertareTemeiuri.js'

export const MESAJ_EXPORT_POARTA = 'Export blocat: adresa o generează doar ownerul sau un responsabil al licitației (temeiurile de pe punctele întrebărilor sunt vizibile doar lor) — roagă-l să genereze adresa.'
export const MESAJ_EXPORT_MIGRARE = 'Export blocat: serverul nu întoarce încă temeiurile de pe puncte în răspuns (migrarea 20270115a nu e aplicată) — adresa nu se generează până atunci.'
export const MESAJ_EXPORT_RASPUNS = 'Export blocat: răspuns neașteptat de la server (verificare indisponibilă).'

// 42501 = refuzul porții de pe server (sau EXECUTE lipsă); mesajul brut al Postgres nu-i spune omului ce să facă
const eRefuzDrept = e => e?.code === '42501' || /insufficient_privilege|permission denied/i.test(e?.message || '')

// Răspunsul RPC-ului → { ok: true, clarificari, temeiuri } sau { ok: false, mesaj }.
export function citesteRaspunsExport(data, error) {
  if (error) {
    if (eRefuzDrept(error)) return { ok: false, mesaj: MESAJ_EXPORT_POARTA }
    const m = String(error.message || 'verificare indisponibilă')   // mesajele serverului încep deja cu „Export blocat:” (decizie, ciornă automată)
    return { ok: false, mesaj: /^Export blocat/i.test(m) ? m : 'Export blocat: ' + m }
  }
  if (Array.isArray(data)) return { ok: false, mesaj: MESAJ_EXPORT_MIGRARE }   // forma veche: doar întrebările, fără temeiuri
  if (!data || typeof data !== 'object' || !Array.isArray(data.clarificari) || !Array.isArray(data.temeiuri)) return { ok: false, mesaj: MESAJ_EXPORT_RASPUNS }
  if (data.clarificari.some(q => !q || typeof q !== 'object' || q.nr == null)) return { ok: false, mesaj: MESAJ_EXPORT_RASPUNS }
  return { ok: true, clarificari: data.clarificari, temeiuri: data.temeiuri }
}

// Practica CNSC pentru adresă: DOAR temeiurile de pe întrebările exportate, în formatul unic (formatCitare). Un temei bifat care NU poate ieși
// (decizie neverificată / modificată, doar referință, fără pagină / link, tipar sau cerință bifată prin API) BLOCHEAZĂ exportul (Copilot r2 P1,
// Jakarinos r3) — nu dispare tăcut din PDF. Întoarce { ok: true, practica: [{ nr, referinta, citat, nota }] } sau { ok: false, mesaj }.
export function practicaDinExport(clarificari, temeiuri) {
  const nrExport = new Set(clarificari.map(q => q.nr))
  const practica = []
  for (const t of temeiuri) {
    if (!t || typeof t !== 'object') return { ok: false, mesaj: MESAJ_EXPORT_RASPUNS }
    if (!nrExport.has(t.nr)) continue
    const motiv = motivNeexportabil(t)
    if (motiv) return { ok: false, mesaj: `Export blocat: temeiul bifat „adresă” la întrebarea ${t.nr}${t.tinta === 'punct' && t.punct_nr != null ? ` (punctul ${t.punct_nr})` : ''} nu poate ieși în adresă (${motiv}) — debifează-l sau corectează-l.` }
    practica.push([{ nr: t.nr, ...formatCitare(t.decizie, { loc: t.citat_loc, text: t.citat_text }) }, Number(t.id) || 0, practica.length])
  }
  // ordinea: întrebarea, apoi id-ul temeiului (ordinea serverului), apoi ordinea primită
  return { ok: true, practica: practica.sort((a, b) => (a[0].nr - b[0].nr) || (a[1] - b[1]) || (a[2] - b[2])).map(([p]) => p) }
}
