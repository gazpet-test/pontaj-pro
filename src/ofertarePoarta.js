// ════════════════════════════════════════════════════════════════
// ofertarePoarta.js — UN SINGUR ADEVĂR pentru verdictul porții propunerii tehnice.
//
// Până la 13.09.2026 condiția de blocaj era copiată în TREI locuri din OfertarePropunere.jsx
// (cardul din fișa licitației, `blocat` din panou, recitirea din `semneaza`), iar copia din card
// nu conținea două dintre rândurile blocante. Deci cardul putea spune „Poarta e deschisă" în
// timp ce panoul bloca. Auditul Copilot (P0.1) a cerut centralizarea; asta e ea.
//
// REGULA: nimeni nu mai scrie `st.capitole === 0 || ...` nicăieri. Toată lumea cheamă
// evalueazaPoarta(st) și citește `stare`, `randuri`, `blocaje`, `rezerve`. Un rând nou de
// poartă se adaugă AICI și în view (v_ofertare_pt_stare) — și nicăieri altundeva.
//
// Funcție PURĂ, fără React, fără Supabase: se testează cu node, fără runner (vezi jos).
// ════════════════════════════════════════════════════════════════

import { controlCantitati, controlGarantie, controlAnexe, controlIdentitate, controlNumereCheie, controlParticipare, controlPachetComplet, controlRelatiiGrafic, controlGraficSursa } from './ofertareControale.js'
import { textRestante } from './ofertareTransferRestante.js'

// st = un rând din v_ofertare_pt_stare. null = încă se încarcă.
// Întoarce null cât timp st e null: un array gol de rânduri ar însemna „nimic de blocat",
// adică exact verdele fals din care s-a născut regula 2 din antetul modulului.
export function evalueazaPoarta(st) {
  if (!st) return null
  const r = []

  r.push({
    k:'cuprins', titlu:'Cuprinsul propunerii',
    stare: st.capitole > 0 ? 'ok' : 'block',
    detalii: st.capitole > 0 ? `${st.capitole} capitole` : 'niciun capitol — cuprinsul se ia din fișa de date, de la „Modul de prezentare al propunerii tehnice"',
  })
  r.push({
    k:'fara', titlu:'Cerințe fără capitol',
    stare: st.fara_capitol > 0 ? 'block' : 'ok',
    detalii: `${st.fara_capitol} din ${st.de_raspuns}` + (st.inchise_cu_dovada > 0 ? ` · ${st.inchise_cu_dovada} sunt închise cu dovadă în registru, nu cer capitol` : ''),
    filtru: 'fara',
  })
  r.push({
    // P0.3 — ATRIBUIREA NU E CONFORMITATE. O cerinta cu capitol, dar pe care nimeni n-a
    // confirmat-o (stare <> 'verificata', sau verificata la o versiune veche a capitolului) NU e
    // verde. BLOCK: e un fapt (exista/nu exista o verificare cu om si data), iar blocajul se
    // ridica prin actiunea corecta — cineva citeste raspunsul si il bifeaza.
    k:'neverificate', titlu:'Cerințe atribuite, dar neverificate de un om',
    stare: (st.cerinte_neverificate || 0) > 0 ? 'block' : 'ok',
    detalii: (st.cerinte_neverificate || 0) > 0
      ? `${st.cerinte_neverificate} din ${st.cu_capitol} au capitol, dar nimeni n-a confirmat că răspunsul satisface cerința (sau textul s-a schimbat de la verificare)`
      : (st.cu_capitol > 0 ? `toate cele ${st.cu_capitol} cerințe atribuite sunt verificate la versiunea curentă` : '—'),
    filtru: 'neverificate',
  })
  r.push({
    // P0c / INTERDICȚIA 5 a generatorului (24.09.2026): o cerință ATRIBUITĂ unui capitol, dar NECONFIRMATĂ de om în
    // registru (E2, confirmata_de NULL) ține poarta închisă INDIFERENT de sursa capitolului — nici generarea cu
    // „cu_neconfirmate", nici salvarea ulterioară a textului ca text de om nu ridică blocajul. Se ridică prin
    // confirmarea (sau excepția / nu-se-aplică) cerinței în registru. Coloana vine din v_ofertare_pt_cerinte_neconfirmate
    // (migrare 20260924_p0c_pt_stare_neconfirmate); lipsă / eroare = control INDISPONIBIL = block (vezi mai jos), nu zero.
    // Copilot 24.09: „control indisponibil ≠ zero”. Dacă view-ul lipsește / dă eroare / întoarce ceva invalid, NU știm dacă
    // există cerințe neconfirmate → poarta finală rămâne închisă cu mesajul „nu putem verifica”, nu „există neconfirmate”.
    // Lucrul pe draft (editare capitole) nu trece prin poartă, deci nu e afectat. Consecință practică: migrarea
    // p0c_pt_stare_neconfirmate se aplică ÎNAINTE (sau odată cu) publicarea acestui cod, altfel poarta e roșie peste tot.
    k:'neconfirmate', titlu:'Cerințe atribuite, dar neconfirmate în registru (E2)',
    stare: !Number.isInteger(st.cerinte_neconfirmate_cu_capitol) || st.cerinte_neconfirmate_cu_capitol < 0 ? 'block'
         : (st.cerinte_neconfirmate_cu_capitol > 0 ? 'block' : 'ok'),
    detalii: !Number.isInteger(st.cerinte_neconfirmate_cu_capitol) || st.cerinte_neconfirmate_cu_capitol < 0
      ? 'Nu putem verifica confirmarea cerințelor (controlul e indisponibil: view-ul v_ofertare_pt_cerinte_neconfirmate lipsește, a dat eroare sau un rezultat invalid) — nu înseamnă că există neconfirmate, înseamnă că nu știm'
      : (st.cerinte_neconfirmate_cu_capitol > 0
        ? `${st.cerinte_neconfirmate_cu_capitol} cerințe cu capitol nu sunt confirmate de un om în registru — textul scris pe ele nu e bază verificată; confirmă-le (✓) sau exceptează-le`
        : 'toate cerințele atribuite sunt confirmate în registru'),
    filtru: 'neconfirmate',
  })
  r.push({
    // P0 pas 2 (Copilot, 24.09.2026): documentația de atribuire COMPLETĂ și CITITĂ. Vine din v_ofertare_seap_completitudine
    // (enumerare SEAP, fișiere nerecuperate, caiete/PT, esențiale necitite) — același view pe care îl verifică și triggerul de pe
    // ofertare_pt_pachet, deci serverul refuză aprobarea chiar dacă UI-ul e ocolit. View lipsă / eroare = „nu putem verifica”
    // = block (control indisponibil ≠ zero). „Enumerarea SEAP a eșuat” ≠ „nu lipsește nimic”; „încărcat” ≠ „citit”.
    k:'documentatie', titlu:'Documentația de atribuire — completă și citită',
    stare: st.documentatie_verificata !== true || st.documentatie_blocaj ? 'block' : 'ok',
    detalii: st.documentatie_verificata !== true
      ? 'nu putem verifica completitudinea documentației (controlul nu a răspuns)'
      : (st.documentatie_blocaj || `toate documentele esențiale citite${st.documentatie_esentiale ? ` (${st.documentatie_esentiale})` : ''}`),
  })
  r.push({
    k:'capcane', titlu:'Capcane de respingere descoperite',
    stare: st.capcane_descoperite > 0 ? 'block' : 'ok',
    detalii: st.capcane > 0
      ? `${st.capcane_descoperite} din ${st.capcane} cerințe cu clauză de respingere · găsite de regex — verifică textul`
      : 'nicio clauză de respingere găsită în cerințe',
    filtru: 'capcane',
  })
  r.push({
    k:'goale', titlu:'Capitole obligatorii goale',
    stare: st.capitole === 0 ? 'warn' : (st.capitole_goale > 0 ? 'block' : 'ok'),
    detalii: st.capitole === 0 ? '— (se aprinde după ce creezi cuprinsul)' : `${st.capitole_goale} capitole fără conținut și fără fișier`,
  })
  r.push({
    k:'nu_e_cazul', titlu:'„nu este cazul" în capitole',
    // WARN, nu BLOCK: formularul real depus la Ștefan cel Mare îl folosește de 3 ori. Îl interzice
    // explicit doar o parte din autorități (ex. Fința). Un block universal ar fi fals și ar învăța
    // omul să ocolească semaforul.
    stare: st.capitole_nu_e_cazul > 0 ? 'warn' : 'ok',
    detalii: st.capitole_nu_e_cazul > 0
      ? `${st.capitole_nu_e_cazul} capitole conțin „nu este cazul" — verifică fișa de date: unele autorități îl interzic explicit`
      : '0',
  })
  // Conformitatea: ce AFIRMĂ propunerea vs ce are firma. Blocant DOAR la om inexistent și om
  // plecat — decizia lui Răzvan, 13.09.2026. Când nu s-a încărcat nicio afirmație, rândul spune
  // că nu s-a verificat — NU 'ok'. Cifrele vin acum din view, nu dintr-o încărcare separată,
  // ca să le vadă și cardul din fișa licitației.
  const nAf = st.afirmatii || 0, nBl = st.afirmatii_blocante || 0, nWn = st.afirmatii_de_verificat || 0
  r.push({
    k:'conformitate', titlu:'Afirmațiile propunerii, față de firmă',
    stare: nAf === 0 ? 'warn' : (nBl > 0 ? 'block' : (nWn > 0 ? 'warn' : 'ok')),
    detalii: nAf === 0
      ? 'nicio afirmație încărcată — oamenii, utilajele și partenerii din propunere n-au fost confruntați cu ERP-ul'
      : `${nAf} afirmații · ${nBl} blocante` + (nWn ? ` · ${nWn} de verificat` : ''),
  })
  r.push({
    k:'nescrise', titlu:'Capitole scrise de AI și necitite de nimeni',
    // BLOCK: fapt binar, nu interpretare. Blocajul se ridică ieftin: deschizi, citești, salvezi.
    stare: st.capitole_nescrise_de_om > 0 ? 'block' : 'ok',
    detalii: st.capitole_nescrise_de_om > 0
      ? `${st.capitole_nescrise_de_om} capitole obligatorii au text generat pe care nu l-a revăzut nimeni — deschide-le, citește-le, salvează-le`
      : '0 — tot ce e scris a trecut prin mâna unui om',
  })
  r.push({
    k:'observatii', titlu:'Observații deschise pe propunere',
    // WARN, deliberat: o observație e un canal social, nu un fapt. Un block ar da drept de veto
    // oricui scrie o propoziție. Se depune, dar semnătura rămâne galbenă în istoric.
    stare: st.observatii_deschise > 0 ? 'warn' : 'ok',
    detalii: st.observatii_deschise > 0
      ? `${st.observatii_deschise} cereri de modificare neînchise — se poate depune, dar semnătura rămâne galbenă`
      : 'nicio cerere de modificare deschisă',
  })
  r.push({
    k:'docs', titlu:'Documentația de atribuire citită integral',
    stare: st.documente === 0 ? 'block' : (st.documente_necitite > 0 ? 'warn' : 'ok'),
    detalii: st.documente === 0
      ? 'niciun document încărcat — cerințele nu pot exista'
      : `${st.documente} documente` + (st.documente_necitite > 0 ? `, ${st.documente_necitite} necitite sau cu eroare — cerințele pot veni dintr-un corpus incomplet` : ', toate citite'),
  })
  r.push({
    // NU „Cap. 4": la Contești graficul e anexă, la altele cap. 3 sau 8. Numărul vine din fișa de date.
    k:'grafic', titlu:'Graficul de execuție — versiune înghețată',
    // R5 runda 5 (minorul 5 al verificatorului): versiunea înghețată se reverifică față de cantitățile de ACUM (reverificareGraficInghetat,
    // din OfertarePropunere): un rând-sursă de front invalidat după îngheț / rânduri necesare nevalidate => WARN „de reverificat”.
    // Câmpul absent (versiune fără parametri, încărcare veche) = ca înainte; eroare la reverificare = WARN (control indisponibil ≠ zero).
    stare: !st.grafic_versiune ? 'warn'
      : (st.grafic_avertismente > 0 || st.grafic_de_reverificat > 0 || st.grafic_reverificare_eroare ? 'warn' : 'ok'),
    detalii: !st.grafic_versiune
      ? 'nicio versiune generată în grafic_versiuni'
      : `versiunea ${st.grafic_versiune}` + (st.grafic_avertismente > 0
          ? ` — înghețată cu ${st.grafic_avertismente} avertismente în poarta graficului, deschide Graficul și uită-te la ele`
          : ', fără avertismente')
        + (st.grafic_de_reverificat > 0 ? ` · DE REVERIFICAT față de cantitățile de acum (rezultat incomplet): ${st.grafic_de_reverificat_text}` : '')
        + (st.grafic_reverificare_eroare ? ` · reverificarea față de cantitățile de acum n-a putut rula (${st.grafic_reverificare_eroare}) — control indisponibil` : ''),
  })

  // H2 (Sprint 3): cantitățile din Cantități vs fronturile graficului. Sursele vin tot din view.
  const h2 = controlCantitati(st)
  r.push({ k: h2.k, titlu: 'Cantitățile rețelei — lista F3 vs graficul', stare: h2.stare, detalii: h2.detalii })
  // R5, reparația rundei 1 (ADDENDUM 2 Copilot, a + testele finale 1–2): APROBAREA FINALĂ. Poarta asta păzește doar acțiunile finale
  // (📦 semnarea „gata de depus” și 🔏 aprobarea pachetului — lucrul pe draft: capitole, parametrii / fronturile graficului, editorul de
  // cantități, nu trece prin ea). H2 rămâne WARN pe conflictele din planșe (lucru intermediar), dar un conflict de transfer DESCHIS —
  // neconfirmat ca rezolvare / excepție justificată, deci cu impactul nestabilit — sau un transfer în curs BLOCHEAZĂ aici; controlul
  // indisponibil (view lipsă / eroare / versiune fără câmp) = „nu putem verifica” = BLOCK, chiar dacă omul a confirmat avertismentul pe
  // draft. Server-side: același blocaj în trigger-ul aprobării pachetului (docs/R5_MIGRARE_PROPUSA_cantitati_nevalidate.sql, 1b).
  r.push(controlSursaAprobareFinala(st))
  // H4: garanția ca obiect (luni + moment), aceeași în cerință, formular și capitole.
  const h4 = controlGarantie(st)
  r.push({ k: h4.k, titlu: 'Garanția lucrărilor — luni și momentul de start', stare: h4.stare, detalii: h4.detalii })
  // H5: „vezi Anexa 7" ⇒ Anexa 7 există în cuprins.
  const h5 = controlAnexe(st)
  r.push({ k: h5.k, titlu: 'Trimiterile din text — anexe, formulare, capitole existente', stare: h5.stare, detalii: h5.detalii })
  // H1: numele altei lucrări rămas în text (copy-paste de la altă ofertă).
  const h1 = controlIdentitate(st)
  r.push({ k: h1.k, titlu: 'Identitatea lucrării — nume din alte licitații', stare: h1.stare, detalii: h1.detalii })
  // H6: același număr de branșamente / racorduri peste tot (Hoghilag: 372 vs 371).
  const h6 = controlNumereCheie(st)
  r.push({ k: h6.k, titlu: 'Numerele cheie — branșamente și racorduri', stare: h6.stare, detalii: h6.detalii })
  // HOG-08: asociat, subcontractant și terț susținător nu sunt sinonime.
  const h8 = controlParticipare(st)
  r.push({ k: h8.k, titlu: 'Participanții — rolurile declarate vs textul propunerii', stare: h8.stare, detalii: h8.detalii })
  // Prunisor-Jupa: piesa poate exista la participant si tot sa lipseasca din pachetul depus.
  // Distinct de H5: acolo se verifica trimiterile, aici fisierele efectiv urcate.
  const h9 = controlPachetComplet(st)
  r.push({ k: h9.k, titlu: 'Pachetul depus — piesele din opis au fișier', stare: h9.stare, detalii: h9.detalii })
  // Laza: 16 din 66 relații „FS" cu ES(succesor) < EF(predecesor) — graficul scris de mână.
  // Întâi sursa (vine dintr-o versiune înghețată?), apoi consistența (declarațiile se țin?).
  const h10 = controlGraficSursa(st)
  r.push({ k: h10.k, titlu: 'Graficul din pachet — vine dintr-o versiune înghețată', stare: h10.stare, detalii: h10.detalii })
  const h11 = controlRelatiiGrafic(st)
  r.push({ k: h11.k, titlu: 'Graficul — relațiile declarate vs datele declarate', stare: h11.stare, detalii: h11.detalii })

  const blocaje = r.filter(x => x.stare === 'block')
  const rezerve = r.filter(x => x.stare === 'warn')
  return {
    // 'block' | 'warn' | 'ok' — singurul lucru pe care îl afișează oricine, oriunde.
    stare: blocaje.length ? 'block' : (rezerve.length ? 'warn' : 'ok'),
    randuri: r,
    blocaje: blocaje.map(x => x.k),
    // Textele rezervelor, gata de pus în mesajul semnăturii: „semnat CU REZERVE: ...".
    rezerve: rezerve.map(x => `${x.titlu.toLowerCase()}: ${x.detalii}`),
  }
}

// Rândul „sursa_cantitati” (aprobarea finală) — funcție pură, testată și separat
export function controlSursaAprobareFinala(st) {
  const base = { k: 'sursa_cantitati', titlu: 'Sursa cantităților — restanțele transferului din planșe (aprobarea finală)' }
  if (st?.cantitati_nevalidate_indisponibil) return { ...base, stare: 'block',
    detalii: `nu putem verifica sursa cantităților (${st.cantitati_nevalidate_indisponibil}) — draftul poate continua, aprobarea finală rămâne blocată` }
  const tcd = st?.transfer_conflicte_docs, tic = st?.transfer_in_curs
  if (!Number.isInteger(tcd) || !Number.isInteger(tic)) return { ...base, stare: 'block',
    detalii: 'nu putem verifica restanțele transferului din planșe (v_ofertare_cantitati_nevalidate fără câmpurile transfer_*) — aprobarea finală rămâne blocată' }
  if (tcd > 0) return { ...base, stare: 'block',
    detalii: `${st.transfer_conflicte_n ?? '?'} restanțe deschise la transferul din ${tcd} ${tcd === 1 ? 'planșă' : 'planșe'}${st.transfer_conflicte_lista ? ` (${st.transfer_conflicte_lista})` : ''}` +
      `${textRestante(st.transfer_restante) ? ` — ${textRestante(st.transfer_restante)}` : ''} — impactul asupra cantității / soluției ofertate nu e stabilit: ` +
      'rezolvă-le (recitire care le acoperă) sau confirmă-le în Documente ca rezolvare / excepție justificată (drept de decizie)' }
  if (tic > 0) return { ...base, stare: 'block', detalii: `transfer din planșă în curs (${tic}) — impactul nu e stabilit; reîncarcă după ce se termină` }
  return { ...base, stare: 'ok', detalii: 'nicio restanță deschisă la transferul din planșe' }
}

// Verdictul pe care îl primește semnătura din ofertare_pt_poarta. Galben = se poate depune,
// dar rămâne scris în istoric cu ce rezerve. Un singur loc care decide asta.
export const verdictSemnatura = ev => ev.stare === 'ok' ? 'verde' : 'galben'

// ════════════════════════════════════════════════════════════════
// POARTA DE CLARIFICARE (PR 2 Laza, 14.09.2026) — SEPARATĂ de poarta propunerii.
//
// De ce separată: view-ul propunerii ia „ultima versiune de pachet"; dacă răspunsul la clarificare
// ar fi un pachet, verdictul ofertei SEMNATE s-ar recalcula retroactiv pe fișierele răspunsului.
// Unitatea e PUNCTUL (Laza: 11 puncte), nu anexa. Proveniența anexelor NU se declară — se
// demonstrează (sha256 identic cu manifestul depus = retrimis; document_date vs depus_la = pre/post).
//
// Termenul schimbă regula: la un termen de o zi, un block la ora 20 e descalificare. De aceea
// poarta are ieșirea „se trimite CU REZERVE": block-urile rămân scrise, dar nu opresc trimiterea
// când mai sunt mai puțin de ORE_REZERVE ore. Fără termen = nu se știe cât e de urgent → warn.
//
// st = un rând din v_ofertare_solicitari_ac_stare. acum = Date (injectat, ca să fie testabil).
// ════════════════════════════════════════════════════════════════

export const ORE_REZERVE = 12

export function evalueazaPoartaClarificare(st, acum = new Date()) {
  if (!st) return null
  const r = []
  const anexe = Array.isArray(st.anexe) ? st.anexe : []
  const puncte = Number(st.puncte || 0)
  const faraRaspuns = Number(st.puncte_fara_raspuns || 0)
  const faraLocator = Number(st.puncte_fara_locator || 0)

  r.push({
    k:'puncte', titlu:'Punctele solicitării au răspuns',
    stare: puncte === 0 ? 'block' : (faraRaspuns > 0 ? 'block' : 'ok'),
    detalii: puncte === 0 ? 'niciun punct introdus — solicitarea se sparge pe puncte, unul per întrebare a comisiei'
      : (faraRaspuns > 0 ? `${faraRaspuns} din ${puncte} fără răspuns` : `toate cele ${puncte} puncte au răspuns`),
  })
  // Laza: informația EXISTA în ofertă dar nu era localizabilă. Răspunsul trebuie să spună UNDE.
  r.push({
    k:'locator', titlu:'Răspunsurile trimit la pagina din oferta depusă',
    stare: faraLocator > 0 ? 'warn' : 'ok',
    detalii: faraLocator > 0 ? `${faraLocator} răspunsuri nu spun unde în oferta depusă se află informația` : 'fiecare răspuns arată unde în ofertă e informația',
  })

  const post = anexe.filter(a => a.provenienta === 'post_depunere')
  const postNejust = post.filter(a => !a.justificata)
  const faraData = anexe.filter(a => a.provenienta === 'fara_data')
  const retrimise = anexe.filter(a => a.provenienta === 'retrimis')
  const pre = anexe.filter(a => a.provenienta === 'pre_depunere')

  r.push({
    // ATSD 11.09.2026 la Laza: document de după depunere. Fără justificare = block (nu se poate
    // completa oferta post-depunere). Cu justificare scrisă = warn: calea onestă rămâne deschisă,
    // dar rămâne scris că s-a trimis un act post-depunere și de ce.
    k:'post_depunere', titlu:'Anexe datate DUPĂ depunere',
    stare: postNejust.length ? 'block' : (post.length ? 'warn' : 'ok'),
    detalii: postNejust.length
      ? `${postNejust.length} anexe cu dată după ${fmtData(st.depus_la)} fără justificare: ${postNejust.map(a => a.nume).join(', ')}`
      : (post.length ? `${post.length} anexe post-depunere, justificate în scris: ${post.map(a => a.nume).join(', ')}` : 'nicio anexă datată după depunere'),
  })
  r.push({
    k:'fara_data', titlu:'Anexe fără data documentului',
    stare: faraData.length ? 'warn' : 'ok',
    detalii: faraData.length ? `${faraData.length} anexe fără dată — proveniența nu se poate demonstra: ${faraData.map(a => a.nume).join(', ')}` : '—',
  })
  r.push({
    k:'provenienta', titlu:'Proveniența anexelor',
    stare: 'ok',
    detalii: anexe.length ? `${retrimise.length} retrimise (hash identic cu manifestul depus) · ${pre.length} dinainte de depunere · ${post.length} de după` : 'nicio anexă',
  })
  if (st.depus_sursa === 'termen_licitatie') r.push({
    k:'depus_sursa', titlu:'Data depunerii',
    stare: 'warn',
    detalii: `nu există pachet depus în ERP — data depunerii e luată din termenul licitației (${fmtData(st.depus_la)})`,
  })

  const oreRamase = st.termen_raspuns ? (new Date(st.termen_raspuns) - acum) / 36e5 : null
  r.push({
    k:'termen', titlu:'Termenul de răspuns',
    stare: oreRamase == null ? 'warn' : (oreRamase < 0 ? 'block' : (oreRamase <= ORE_REZERVE ? 'warn' : 'ok')),
    detalii: oreRamase == null ? 'termen necompletat — nu se știe cât e de urgent'
      : (oreRamase < 0 ? `termen DEPĂȘIT cu ${fmtOre(-oreRamase)}` : `${fmtOre(oreRamase)} rămase`),
  })

  const blocaje = r.filter(x => x.stare === 'block')
  const rezerve = r.filter(x => x.stare === 'warn')
  const stare = blocaje.length ? 'block' : (rezerve.length ? 'warn' : 'ok')
  // Ieșirea de urgență: sub ORE_REZERVE ore, block-urile devin rezerve scrise — dar NU termenul
  // depășit și NU „niciun punct": pe alea nu există „cu rezerve", există „prea târziu"/„nimic de trimis".
  const blocajeDure = blocaje.filter(x => x.k === 'termen' || (x.k === 'puncte' && puncte === 0))
  const poateCuRezerve = stare === 'block' && oreRamase != null && oreRamase >= 0 && oreRamase <= ORE_REZERVE && blocajeDure.length === 0
  return {
    stare, randuri: r,
    blocaje: blocaje.map(x => x.k),
    rezerve: [...rezerve, ...blocaje].map(x => `${x.titlu.toLowerCase()}: ${x.detalii}`),
    ore_ramase: oreRamase,
    poate_cu_rezerve: poateCuRezerve,
  }
}

function fmtData(d) { if (!d) return '?'; const x = new Date(d); return isNaN(x) ? String(d) : x.toLocaleDateString('ro-RO') }
function fmtOre(h) { return h >= 48 ? `${Math.floor(h / 24)} zile` : `${Math.round(h)} h` }
