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

import { controlCantitati, controlGarantie, controlAnexe, controlIdentitate } from './ofertareControale.js'

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
    stare: !st.grafic_versiune ? 'warn' : (st.grafic_avertismente > 0 ? 'warn' : 'ok'),
    detalii: !st.grafic_versiune
      ? 'nicio versiune generată în grafic_versiuni'
      : `versiunea ${st.grafic_versiune}` + (st.grafic_avertismente > 0
          ? ` — înghețată cu ${st.grafic_avertismente} avertismente în poarta graficului, deschide Graficul și uită-te la ele`
          : ', fără avertismente'),
  })

  // H2 (Sprint 3): cantitățile din Cantități vs fronturile graficului. Sursele vin tot din view.
  const h2 = controlCantitati(st)
  r.push({ k: h2.k, titlu: 'Cantitățile rețelei — lista F3 vs graficul', stare: h2.stare, detalii: h2.detalii })
  // H4: garanția ca obiect (luni + moment), aceeași în cerință, formular și capitole.
  const h4 = controlGarantie(st)
  r.push({ k: h4.k, titlu: 'Garanția lucrărilor — luni și momentul de start', stare: h4.stare, detalii: h4.detalii })
  // H5: „vezi Anexa 7" ⇒ Anexa 7 există în cuprins.
  const h5 = controlAnexe(st)
  r.push({ k: h5.k, titlu: 'Trimiterile din text — anexe, formulare, capitole existente', stare: h5.stare, detalii: h5.detalii })
  // H1: numele altei lucrări rămas în text (copy-paste de la altă ofertă).
  const h1 = controlIdentitate(st)
  r.push({ k: h1.k, titlu: 'Identitatea lucrării — nume din alte licitații', stare: h1.stare, detalii: h1.detalii })

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

// Verdictul pe care îl primește semnătura din ofertare_pt_poarta. Galben = se poate depune,
// dar rămâne scris în istoric cu ce rezerve. Un singur loc care decide asta.
export const verdictSemnatura = ev => ev.stare === 'ok' ? 'verde' : 'galben'
