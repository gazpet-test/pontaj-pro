// Recunoasterea unui document personal dupa numele fisierului.
//
// Regulile astea erau scrise in DocumenteBulkImportModal.jsx si mergeau doar cand
// cineva tragea fisiere cu mana in browser. Importul din Drive are nevoie de exact
// aceeasi judecata, altfel acelasi fisier ar intra pe alt tip in functie de drumul pe
// care a venit. Sunt aici ca sa existe UN SINGUR loc unde se schimba, iar modalul le
// importa de aici.
//
// Nimic din fisierul asta nu tine de browser sau de server — doar text si potriviri.

// ─── Mapping keyword → tip cod ────────────────────────────────────────────
// Ordinea conteaza: cele cu priority mai mare se verifica INTAI.
// Exemplu: „CALIFICARE STIVUITORIST - SUPLIMENT" trebuie sa prinda SUPLIMENT, NU CALIFICARE.
export const TYPE_PATTERNS = [
  // Studii — Suplimentele INAINTE de Calificari
  { cod: 'supliment_calificare', keywords: ['supliment'], priority: 100 },
  { cod: 'diploma_scoala_prof', keywords: ['scoala profesionala', 'profesionala'], priority: 95 },
  { cod: 'diploma_liceu', keywords: ['diploma liceu', 'liceu', 'bacalaureat', 'diploma de liceu'], priority: 92 },
  { cod: 'cert_calificare', keywords: ['calificare', 'calificat'], priority: 90 },
  { cod: 'diploma_studii_sup', keywords: ['diploma studii', 'diploma facultate', 'diploma master', 'licenta', 'diploma de studii'], priority: 90 },

  // Stare civila — cert nastere COPIL INAINTE de cert nastere angajat
  { cod: 'cert_nastere_copil', keywords: ['nastere copil', 'copil minor', 'copil_minor'], priority: 100 },
  { cod: 'cert_casatorie', keywords: ['casatorie'], priority: 95 },
  { cod: 'adeverinta_scoala_copil', keywords: ['adeverinta scoala', 'adev scoala', 'scoala copil'], priority: 95 },
  { cod: 'cert_nastere_angajat', keywords: ['certificat nastere', 'cert nastere', 'certificat de nastere', ' cn '], priority: 85 },

  // Identitate
  { cod: 'buletin', keywords: ['carte de identitate', 'carte identitate', 'c.i.', '(c.i)', 'buletin', ' ci ', '_ci_', '-ci-', '/ci.'], priority: 95 },
  { cod: 'pasaport', keywords: ['pasaport', 'passport'], priority: 95 },
  { cod: 'permis_conducere', keywords: ['permis de conducere', 'permis conducere'], priority: 95 },

  // Juridic
  { cod: 'cazier_judiciar', keywords: ['cazier'], priority: 95 },
  { cod: 'decl_propria_raspundere', keywords: ['declaratie proprie', 'declaratie propria', 'lipsa interdictii', 'decl_propria'], priority: 90 },

  // Angajator anterior
  { cod: 'dec_incetare_anterior', keywords: ['decizie incetare', 'dec incetare', 'decizie de incetare'], priority: 100 },
  { cod: 'adev_incetare_anterior', keywords: ['adeverinta incetare', 'adev incetare'], priority: 100 },
  { cod: 'anexa7_cotizare', keywords: ['anexa 7', 'anexa7', 'stadiu cotizare'], priority: 100 },

  // Fiscal — handicap INAINTE de orice ar putea contine „decizie"
  { cod: 'decizie_handicap', keywords: ['handicap'], priority: 100 },
  { cod: 'extras_cont_bancar', keywords: ['extras cont', 'iban'], priority: 95 },
  { cod: 'decl_persoane_intretinere', keywords: ['persoane intretinere', 'deducere taxe'], priority: 90 },

  // Medical
  { cod: 'adeverinta_medic_familie', keywords: ['adeverinta medic familie', 'adev medic familie', 'medic familie', 'apt de munca', 'apt munca'], priority: 95 },

  // Contract & Formulare interne
  { cod: 'contract_munca', keywords: ['contract individual', 'contract munca', 'contract de munca', ' cim ', '_cim_', '-cim-'], priority: 95 },
  { cod: 'fisa_post', keywords: ['fisa post', 'fisa postului', 'fisa de post', 'fişa post'], priority: 95 },
  { cod: 'acord_gdpr', keywords: ['gdpr', 'consimtamant', 'acord prelucrare'], priority: 95 },
  { cod: 'dosar_acorduri_formulare', keywords: ['dosar angajare', 'dosar acorduri', 'formulare angajare', 'minuta informare'], priority: 95 },

  // Tipare adaugate pentru dosarele de pe Drive (nume scrise de mana de-a lungul anilor)
  { cod: 'fisa_aptitudini', keywords: ['fisa aptitudini', 'fisa de aptitudini', 'aptitudini', 'medicina muncii'], priority: 96 },
  { cod: 'cv', keywords: [' cv ', 'curriculum vitae'], priority: 80 },
  { cod: 'extras_reges_vechime', keywords: ['reges', 'revisal', 'adeverinta vechime', 'vechime in munca'], priority: 94 },
  { cod: 'permis_sedere', keywords: ['permis de sedere', 'permis sedere'], priority: 97 },
  { cod: 'aviz_de_munca', keywords: ['aviz de munca', 'aviz munca'], priority: 97 },
  { cod: 'viza_intrare', keywords: ['viza de intrare', 'viza intrare'], priority: 96 },
  { cod: 'adev_venituri_6luni', keywords: ['adeverinta venituri', 'adev venituri'], priority: 94 },
  { cod: 'adev_concedii_medicale', keywords: ['concedii medicale', 'adeverinta concedii'], priority: 94 },
  { cod: 'acord_confidentialitate', keywords: ['confidentialitate'], priority: 90 },
]

// Fisiere care apar in dosarul fiecarui angajat dar NU sunt documente personale:
// sunt sabloanele goale pe care le completeaza HR-ul la angajare. Urcate ca atare,
// ar pune acelasi formular necompletat la 128 de oameni.
const SABLOANE = [
  'dosarul angajatului formulare angajare',
  'formulare angajare 2026',
  'model contract',
  'model fisa',
  'template',
]

export function normalizeStr(s) {
  return (s || '')
    .toString()
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // fara diacritice
    .replace(/[._\-]+/g, ' ')                          // separatori → spatiu
    .replace(/[^a-z0-9 ]+/g, ' ')                      // restul → spatiu
    .replace(/\s+/g, ' ')
    .trim()
}

/** True daca fisierul e un sablon gol, nu documentul cuiva. */
export function esteSablon(nume) {
  const n = normalizeStr(nume)
  return SABLOANE.some((s) => n.includes(normalizeStr(s)))
}

/**
 * Ghiceste tipul documentului din numele fisierului.
 * `tipuri` = randurile din hr_documente_personale_tipuri (au nevoie de .cod si .id).
 */
export function detectDocumentType(filename, tipuri) {
  const norm = ` ${normalizeStr(filename)} `  // spatii la capete, ca sa prinda potrivirile exacte
  const sorted = [...TYPE_PATTERNS].sort((a, b) => b.priority - a.priority)

  for (const pattern of sorted) {
    for (const kw of pattern.keywords) {
      const normKw = ` ${normalizeStr(kw)} `
      if (norm.includes(normKw)) {
        const tip = tipuri.find((t) => t.cod === pattern.cod)
        if (tip) return { tip, confidence: pattern.priority, matchedKeyword: kw }
      }
    }
  }
  return { tip: null, confidence: 0, matchedKeyword: null }
}

// Distanta de editare, plafonata: ne intereseaza doar „aproape la fel", nu cat de departe.
function distanta(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 99
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 0; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
  }
  return d[a.length][b.length]
}

// Numele transcrise din alte alfabete se scriu diferit de la un act la altul:
// „CHAMINDA" / „CHAMINGA", „JAYAWARDHA" / „JAYAWARDHANA". Doua litere diferenta pe un
// cuvant lung inseamna acelasi nume, nu alt om.
function acelasiCuvant(a, b) {
  if (a === b) return true
  const scurt = Math.min(a.length, b.length)
  // O litera in plus pe un nume scurt e tot o transcriere: „AVRAM" / „AVRAAM".
  if (scurt >= 5 && distanta(a, b) <= 1) return true
  // Doua litere se accepta doar pe nume lungi, unde nu se pot confunda doi oameni.
  return scurt >= 7 && distanta(a, b) <= 2
}

/**
 * Potriveste un text (nume de fisier SAU nume de folder) cu un angajat.
 * Cere cel putin doua cuvinte comune — un singur „MARIAN" nu inseamna nimic
 * intr-o firma cu 120 de oameni.
 *
 * Scorul se raporteaza la numele MAI SCURT dintre cele doua. Varianta care imparte
 * la numele angajatului ii pedepsea exact pe cei cu nume lungi: dosarul „SETUNGA SURESH"
 * iesea 40% fata de „SETUNGA MUDIYANSELAGE SURESH NIROSHAN PREMASIRI" si era respins,
 * desi nu exista alt SETUNGA in firma.
 */
export function potrivesteAngajat(text, employees, { includeInactivi = false } = {}) {
  const tokens = [...new Set(normalizeStr(text).split(' ').filter((t) => t.length >= 3))]
  if (tokens.length === 0) return { employee: null, confidence: 0, marja: 0 }

  let best = null
  let bestScore = 0
  let alDoilea = 0
  let laEgalitate = 0

  for (const emp of employees) {
    if (!includeInactivi && emp.active === false) continue
    const empTokens = [...new Set(normalizeStr(emp.name).split(' ').filter((t) => t.length >= 3))]
    if (empTokens.length === 0) continue

    const matches = empTokens.filter((e) => tokens.some((t) => acelasiCuvant(e, t))).length
    if (matches < 2) continue

    const score = matches / Math.min(empTokens.length, tokens.length)
    if (score > bestScore) { alDoilea = bestScore; bestScore = score; best = emp; laEgalitate = 1 }
    else if (score === bestScore) { laEgalitate++; alDoilea = score }
    else if (score > alDoilea) { alDoilea = score }
  }

  // Doi oameni cu acelasi scor inseamna ca nu se poate decide — nici macar la 100%.
  // Doi frati „POPESCU MARIA" si „POPESCU MARIAN" ar iesi amandoi perfect.
  if (laEgalitate > 1) return { employee: null, confidence: 0, marja: 0, ambiguu: true }

  return {
    employee: best,
    confidence: Math.round(Math.min(1, bestScore) * 100),
    marja: Math.round(Math.min(1, bestScore - alDoilea) * 100),
  }
}

/** Numele dosarului de pe Drive e „NUME PRENUME - FUNCTIE"; functia nu ajuta la potrivire. */
export function numeDinDosar(titluFolder) {
  return String(titluFolder || '').split(/\s+[-–]\s+/)[0].trim() || String(titluFolder || '')
}

export function detectDate(filename) {
  // YYYY-MM-DD, YYYY_MM_DD, YYYY.MM.DD
  let m = filename.match(/(\d{4})[-_.\s](\d{1,2})[-_.\s](\d{1,2})/)
  if (m && Number(m[1]) >= 1950 && Number(m[1]) <= 2050) {
    return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  }
  // DD-MM-YYYY, DD.MM.YYYY
  m = filename.match(/(\d{1,2})[-_.\s](\d{1,2})[-_.\s](\d{4})/)
  if (m && Number(m[3]) >= 1950 && Number(m[3]) <= 2050) {
    return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  }
  // Doar an (ex: VIZA 2016)
  m = filename.match(/(?:^|[^\d])(19[5-9]\d|20[0-4]\d)(?:[^\d]|$)/)
  if (m) return `${m[1]}-01-01`
  return null
}
