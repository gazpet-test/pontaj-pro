// ════════════════════════════════════════════════════════════════
// ofertareTransferRestante.js — RESTANȚELE DISTINCTE ale transferului planșă → cantități (R5, reparația rundei 1, 26.09.2026).
//
// ADDENDUM 2 Copilot (b): „Dn nestandard, adnotări fără corespondent, transfer amânat = conflicte deschise, dar ca RESTANȚE DISTINCTE,
// fiecare cu cauza și acțiunea necesară (Dn nestandard în catalog ≠ diametru imposibil; adnotare fără corespondent ≠ tronson
// suplimentar; transfer amânat ≠ contradicție a autorității). NU se generează clarificări către AC pentru erori interne de procesare.”
// (d): „Lungimile din conflicte NU sunt automat «metri lipsă» (pot fi observații suprapuse) — formulează corect.”
//
// Un tip de restanță = `tip` din analiza.transfer_cantitati.conflicte[] (handler.ts → conflicteTransfer) sau din `restante` al view-ului
// v_ofertare_transfer_conflicte / ofertare_transfer_stare (SQL, derivarea legacy). Categorii:
//   procesare_interna  — eroarea e a NOASTRĂ (citire / transfer); acțiunea e internă; NICIODATĂ o clarificare către autoritate;
//   decizie_interna    — cantitățile NOASTRE (poziții ambigue, mai multe TOTAL) cer o decizie a ofertantului; nu e o întrebare pentru AC;
//   verificare_plansa  — ofertantul verifică pe planșă; o clarificare poate veni DOAR dacă, după verificarea umană, documentația însăși
//                        rămâne lacunară / contradictorie — nu din lista asta.
// COPIE IDENTICĂ: supabase/functions/ofertare-clarificari-propune/restante.js (generatorul de clarificări rulează pe edge și pe workerul
// NAS; deploy-ul pe folder nu garantează ../../src) — testul src/ofertareTransferRestante.test.js compară octet cu octet.
// Funcții PURE, fără dependențe.
// ════════════════════════════════════════════════════════════════

export const CATEGORII_RESTANTE = {
  procesare_interna: 'eroare internă de procesare — NU e o problemă a documentației',
  decizie_interna: 'decizie a ofertantului pe cantitățile din platformă',
  verificare_plansa: 'de verificat pe planșă de ofertant',
}

// tip → { eticheta, categorie, cauza, actiune }
export const RESTANTE = {
  transfer_eroare: { eticheta: 'transfer căzut', categorie: 'procesare_interna',
    cauza: 'scrierea în cantități a eșuat — nimic din citirea asta nu e confirmat', actiune: 'reia citirea planșei (transferul se reface)' },
  transfer_amanat: { eticheta: 'transfer amânat', categorie: 'procesare_interna',
    cauza: 'zone ale planșei necitite sau lipsă din storage — transferul nu s-a făcut (nu e o contradicție a documentației)', actiune: 'reia zonele căzute / retaie planșa' },
  transfer_intrerupt: { eticheta: 'transfer întrerupt', categorie: 'procesare_interna',
    cauza: 'transferul a rămas „în curs” peste 10 minute', actiune: 'reia citirea planșei' },
  necunoscut: { eticheta: 'stare necunoscută / date corupte', categorie: 'procesare_interna',
    cauza: 'jurnalul / înregistrarea transferului nu pot fi citite', actiune: 'reia citirea planșei' },
  // runda 9 (ADDENDUM 3 Copilot, 3): jurnalul vechi = „verificare indisponibilă”, NU o contradicție a documentației și NU o recitire plătită
  // obligatorie: întâi reevaluarea DETERMINISTĂ pe observațiile salvate (fără AI; versiunea evaluării se consemnează — citire_ai.reevaluat.cod
  // + transfer_cantitati.cod_transfer); dacă observațiile salvate nu ajung (ex. citiri goale), recitire ȚINTITĂ a zonelor sau review uman documentat (✋)
  evaluare_partiala: { eticheta: 'verificare indisponibilă (jurnal vechi)', categorie: 'procesare_interna',
    cauza: 'transferul a fost evaluat de codul vechi, care nu verifica identitatea rândurilor, secvența Nr, TOTAL-ul multiplu, adnotările — incertitudine de verificare, NU o contradicție a documentației',
    actiune: 'reevaluează determinist pe observațiile salvate (fără AI; versiunea evaluării se consemnează) — dacă nu ajung: recitire țintită a zonelor sau review uman documentat (✋)' },
  // runda 9 (verificatorul BD, M12): o citire pe runde NETERMINATĂ (edge-ul publicat v25 rescrie jurnalul la fiecare rundă) — nu putem verifica
  citire_neterminata: { eticheta: 'citire neterminată', categorie: 'procesare_interna',
    cauza: 'o citire a planșei pe runde a rescris jurnalul anterior și nu s-a încheiat — conflictele transferului nu pot fi verificate (nu înseamnă zero)',
    actiune: 'termină citirea planșei (continuă rundele) sau confirmă explicit (✋ rezolvare / excepție justificată)' },
  nerezolvat_la_recitire: { eticheta: 'conflict anterior neacoperit de recitire', categorie: 'procesare_interna',
    cauza: 'recitirea nu a acoperit zonele / Dn-urile / pozițiile conflictului anterior — un rezultat parțial nu-l poate închide prin absență',
    actiune: 'recitește planșa complet sau confirmă explicit (rezolvare / excepție justificată)' },
  ambiguu: { eticheta: 'poziție ambiguă', categorie: 'decizie_interna',
    cauza: 'un grup sigur de pe planșă se potrivește cu mai multe poziții din cantități — nescris', actiune: 'alege poziția în 📋 Cantități (sau precizează denumirile), apoi recitește' },
  total_ambiguu: { eticheta: 'mai multe rânduri TOTAL', categorie: 'decizie_interna',
    cauza: 'totalul planșei NU s-a scris pe niciunul — valorile și aprobările lor rămân', actiune: 'Răzvan decide (A/B/C) care e totalul rețelei' },
  de_verificat: { eticheta: 'Dn doar „de verificat”', categorie: 'verificare_plansa',
    cauza: 'pe Dn-ul acesta sunt doar rânduri citite nesigur — nicio cifră sigură', actiune: 'verifică pe planșă (sau recitește zonele)' },
  identitate: { eticheta: 'rânduri fără identitate sigură', categorie: 'verificare_plansa',
    cauza: 'rânduri de tabel fără Nr / poziție sigură sau citite diferit în felii', actiune: 'verifică pe planșă rândurile de tabel' },
  identitate_incerta: { eticheta: 'identitate incertă (comasare / felii)', categorie: 'verificare_plansa',
    cauza: 'același tabel citit din două felii SAU două tabele identice numărate o dată; rânduri nelegate între felii', actiune: 'verifică pe planșă dacă e același tabel' },
  nr_lipsa: { eticheta: 'secvență Nr incompletă', categorie: 'verificare_plansa',
    cauza: 'lipsesc numere din secvența tabelului (metri necunoscuți)', actiune: 'verifică pe planșă rândurile lipsă (sau recitește zona)' },
  nr_fara_lungime: { eticheta: 'Nr fără lungime', categorie: 'verificare_plansa',
    cauza: 'rânduri cu Nr citit, dar fără lungime', actiune: 'citește lungimea pe planșă' },
  fara_dn: { eticheta: 'tronsoane fără Dn', categorie: 'verificare_plansa',
    cauza: 'tronsoane cu lungime, fără diametru citit', actiune: 'verifică Dn-ul pe planșă' },
  dn_nestandard: { eticheta: 'Dn nestandard (în afara catalogului)', categorie: 'verificare_plansa',
    cauza: 'Dn citit care nu e în catalogul nostru de diametre — NU înseamnă că diametrul e imposibil', actiune: 'verifică pe planșă și în catalog; corectează citirea sau adaugă Dn-ul' },
  adnotari_dn_absent: { eticheta: 'adnotări fără corespondent în tabel', categorie: 'verificare_plansa',
    cauza: 'adnotări pe desen pe un Dn absent din tabel — pot fi același tronson, NU neapărat un tronson suplimentar', actiune: 'verifică pe planșă dacă adnotarea corespunde unui rând din tabel' },
}
export const infoRestanta = tip => RESTANTE[tip] || { eticheta: String(tip || 'necunoscut'), categorie: 'procesare_interna', cauza: 'tip necunoscut', actiune: 'reia citirea planșei' }
// NICIO restanță de transfer nu e, singură, o întrebare pentru autoritate (ADDENDUM 2 Copilot, b)
export const pentruAutoritate = () => false

// restanțele pe tip, adunate din rândurile view-ului (doar documentele DESCHISE): [{document_id, deschis, restante: [{tip, n}]}] → { tip: n }
export function restantePeTip(docs) {
  /** @type {Record<string, number>} */
  const out = {}
  for (const d of docs || []) {
    if (d?.deschis !== true) continue
    // fără `restante` (view în versiunea veche): nu inventăm un tip — rămâne doar numărul, în textul apelantului
    for (const x of Array.isArray(d.restante) ? d.restante : []) if (x?.tip) out[x.tip] = (out[x.tip] || 0) + (Number(x.n) || 1)
  }
  return out
}
// „Dn nestandard (în afara catalogului) ×1 — verifică pe planșă și în catalog; …” — ordinea: procesare internă, decizie, verificare
const ORDINE_CAT = ['procesare_interna', 'decizie_interna', 'verificare_plansa']
export function textRestante(peTip, max = 6) {
  const e = Object.entries(peTip || {}).filter(([, n]) => Number(n) > 0)
    .sort((a, b) => ORDINE_CAT.indexOf(infoRestanta(a[0]).categorie) - ORDINE_CAT.indexOf(infoRestanta(b[0]).categorie) || a[0].localeCompare(b[0]))
  if (!e.length) return ''
  return e.slice(0, max).map(([t, n]) => { const i = infoRestanta(t); return `${i.eticheta} ×${n} (${i.actiune})` }).join('; ') +
    (e.length > max ? `; … încă ${e.length - max} tipuri` : '')
}
// ADDENDUM 2 Copilot (d): lungimile din conflicte sunt OBSERVAȚII pe planșă, nu metri lipsă
export const NOTA_LUNGIMI = 'lungimile din conflicte sunt observații pe planșă (pot fi suprapuse), nu metri lipsă'
