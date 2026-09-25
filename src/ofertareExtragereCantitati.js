// Bucla butonului „🤖 Extrage din documentație" (📋 Cantități → ofertare-cantitati-extrage), scoasă din
// componentă ca să poată fi testată fără browser (ofertareExtragereCantitati.test.js).
//
// De ce (citirea codului vechi din OfertareCantitati.jsx, 25.09.2026, cu ocazia diagnosticului Jilava):
//  1. la un răspuns non-2xx (403 de la „poarta pe cheltuială", 500 cheie lipsă) arăta mesajul generic al
//     supabase-js („Edge Function returned a non-2xx status code") — motivul real stă în corpul răspunsului;
//  2. după `break` pe eroare, ieșea din buclă și afișa imediat OK „Extragere terminată: N rânduri noi" —
//     toast-ul e unul singur, deci eroarea era înlocuită de un fals succes (showToast(err) urmat de
//     showToast('…terminată…','ok'), vezi testul „403 … NU «terminată»");
//  3. se oprea tăcut după 40 de apeluri, tot cu „terminată", chiar dacă serverul mai avea felii (continua=true);
//  4. ignora `raport[].eroare` (felii cu răspuns neinterpretabil / eroare de furnizor) → „0 rânduri" fără motiv.
// Aici fiecare caz are starea lui: ok | partial | neterminat | eroare.
// (Nu e dovedit că cineva a văzut falsul „terminată" pe Jilava: singurul POST din browser din 25.09, 15:53 UTC,
//  a primit 403, dar corpul lui avea 40 B, iar butonul trimite 29 B pentru lic. 93 — deci nu venea din buton.)
import { mesajInvoke, statusInvoke } from './lib/mesajInvoke.js'

// invoke(body) -> { data, error } (în ecran: supabase.functions.invoke('ofertare-cantitati-extrage', { body })).
// Funcția lucrează cu buget de timp și întoarce continua + urmatorul; o reluăm până termină sau până la maxApeluri.
// La eroare, `deLa` = felia cu care a pornit apelul eșuat (de acolo se poate relua), `status` = HTTP sau null.
export async function ruleazaExtragere(invoke, licId, { deLa = 0, maxApeluri = 40, onPas } = {}) {
  let pas = 0, scrise = 0, feliiTotal = null
  const erori = []
  while (pas < maxApeluri) {
    pas++
    onPas?.(deLa)
    const { data, error } = await invoke({ licitatie_id: licId, de_la: deLa })
    if (error || data?.error) {
      return { stare: 'eroare', mesaj: await mesajInvoke(error, data), status: statusInvoke(error), scrise, feliiTotal, erori, deLa }
    }
    scrise += data?.scrise || 0
    if (data?.felii_total != null) feliiTotal = data.felii_total
    for (const r of data?.raport || []) if (r?.eroare) erori.push(r)
    if (!data?.continua) return { stare: erori.length ? 'partial' : 'ok', scrise, feliiTotal, erori, deLa: null }
    deLa = data?.urmatorul ?? deLa + 1
  }
  // plafonul de apeluri a oprit bucla, dar serverul mai avea de lucru: se poate relua de la deLa
  return { stare: 'neterminat', scrise, feliiTotal, erori, deLa }
}

// De unde continuă următorul clic, ca feliile deja plătite să nu se plătească din nou (upsert-ul previne
// dublurile, NU costul). null = de la zero.
//  - neterminat (plafonul de apeluri): de la felia la care s-a oprit;
//  - eroare DUPĂ ce au trecut felii (deLa > 0), de ex. 504/546 de la gateway sau o eroare de furnizor:
//    de la felia apelului eșuat. NU la 401/403: acolo nu e o problemă trecătoare (sesiune / drept lipsă),
//    iar un „Continuă" ar sugera că reîncercarea rezolvă ceva.
export const STATUS_FARA_RELUARE = [401, 403]
export function reluareDupa(r, licId) {
  if (!r || r.deLa == null) return null
  if (r.stare === 'neterminat') return { licId, deLa: r.deLa }
  if (r.stare === 'eroare' && r.deLa > 0 && !STATUS_FARA_RELUARE.includes(r.status)) return { licId, deLa: r.deLa }
  return null
}

// Textul și culoarea toast-ului pentru rezultatul buclei.
export function mesajExtragere(r) {
  const nr = `${r.scrise} rânduri noi`
  const primaEroare = r.erori?.[0] ? ` (ex. ${r.erori[0].doc || ''} ${r.erori[0].bucata || ''}: ${r.erori[0].eroare})` : ''
  if (r.stare === 'eroare') {
    const reia = reluareDupa(r, null) ? ` — apasă din nou ca să continui de la felia ${r.deLa + 1}` : ''
    return { tip: 'err', text: `Extragere oprită: ${r.mesaj}${r.scrise ? ` — ${nr} scrise înainte de eroare` : ''}${reia}` }
  }
  if (r.stare === 'neterminat')
    return { tip: 'warn', text: `Extragere neterminată: ${nr}; oprită la felia ${r.deLa + 1}${r.feliiTotal ? ` din ${r.feliiTotal}` : ''} — apasă din nou ca să continui de acolo` }
  if (r.stare === 'partial')
    return { tip: 'warn', text: `Extragere terminată cu ${r.erori.length} felii nereușite${primaEroare}: ${nr}` }
  return { tip: 'ok', text: `Extragere terminată: ${nr}` }
}
