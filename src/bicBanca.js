// bicBanca.js — codul BIC (SWIFT) al băncii beneficiarului, dedus din IBAN-ul românesc (poziția 5–8 = codul băncii).
// Folosit la exportul BT de diurne (App.jsx → exportBancaDiurne).
// TKT-2026-0355: pentru IBAN-urile Intesa Sanpaolo (WBAN) se scria „WBANROBUXX” în loc de WBANRO22XXX. Cauza: lipsea din
// tabel și regula de rezervă lipea „ROBUXX” la orice cod necunoscut. Tot atunci: BIC-urile din tabel aveau 10 caractere
// (ex. INGBROBUXX), iar un BIC valid are 8 sau 11 → acum băncile românești au forma completă de 11; excepția e TCCL
// (TCCLGB3L, 8 caractere, cod de bancă din afara țării, păstrat din tabelul vechi).
// r2 (review): în tabel stau DOAR băncile active azi. Codurile băncilor desființate / preluate nu primesc BIC: contul e
// pe formatul vechi și trebuie cerut angajatului IBAN-ul nou (schimbarea BIC-ului nu repară IBAN-ul). Băncile cu stare
// nesigură stau tot la „de verificat”, nu li se ghicește BIC-ul.
// r3 (review): BRMA revine (Exim Banca Românească folosește azi BIC-ul BRMAROBU și IBAN-uri cu BRMA). Niciun BIC inventat:
// un cod necunoscut nu mai primește „cod + ROBUXXX”, ci BIC gol + motiv. Împărțirea „de exportat / de verificat” se face
// ÎNAINTE de salvarea fișierului (imparteExportBanca, mai jos): rândurile de verificat nu intră în fișierul de plăți.
const BIC_PE_COD = {
  BTRL: 'BTRLRO22XXX', // Banca Transilvania
  WBAN: 'WBANRO22XXX', // Intesa Sanpaolo Bank România
  INGB: 'INGBROBUXXX', // ING Bank
  RNCB: 'RNCBROBUXXX', // BCR
  BRDE: 'BRDEROBUXXX', // BRD
  BACX: 'BACXROBUXXX', // UniCredit Bank
  RZBR: 'RZBRROBUXXX', // Raiffeisen Bank
  CECE: 'CECEROBUXXX', // CEC Bank
  UGBI: 'UGBIROBUXXX', // Garanti BBVA
  BREL: 'BRELROBUXXX', // Libra Internet Bank
  MIRO: 'MIROROBUXXX', // ProCredit Bank
  BRMA: 'BRMAROBUXXX', // Exim Banca Românească (fostă Banca Românească)
  TCCL: 'TCCLGB3L',    // conturi deschise prin The Currency Cloud (existent în tabelul vechi; 8 caractere)
}

// Bănci desființate / preluate sau cu stare nesigură: fără BIC, cu motivul pe înțelesul contabilei.
const DE_VERIFICAT_PE_COD = {
  PIRB: 'cont pe formatul vechi First Bank (bancă preluată de Intesa Sanpaolo) — cereți angajatului IBAN-ul nou, de la Intesa',
  DAFB: 'cont pe formatul vechi Leumi Bank (preluată de First Bank, apoi de Intesa Sanpaolo) — cereți angajatului IBAN-ul nou, de la Intesa',
  BPOS: 'cont pe formatul vechi Bancpost (bancă preluată de Banca Transilvania) — cereți angajatului IBAN-ul nou',
  VBBU: 'cont pe formatul vechi Volksbank (bancă preluată de Banca Transilvania) — cereți angajatului IBAN-ul nou',
  MILB: 'cont pe formatul vechi Millennium Bank (bancă preluată) — cereți angajatului IBAN-ul actual',
  CRDZ: 'cont pe formatul vechi Credit Agricole (bancă vândută) — cereți angajatului IBAN-ul actual',
  OTPV: 'cont OTP Bank (bancă preluată de Banca Transilvania) — cereți IBAN-ul nou, de la Banca Transilvania',
}

// Lista codurilor recunoscute (pentru testul de acoperire; valorile se verifică în test cu date scrise independent)
export const CODURI_RECUNOSCUTE = Object.keys(BIC_PE_COD)
export const CODURI_DE_VERIFICAT = Object.keys(DE_VERIFICAT_PE_COD)

// { bic, cunoscut, motiv } — cunoscut=false = de verificat de om înainte de trimiterea la bancă (motiv = de ce).
export function bicDinIban(iban) {
  const curat = String(iban ?? '').replace(/\s/g, '').toUpperCase()
  if (!curat) return { bic: '', cunoscut: true, motiv: '' }
  const cod = curat.substring(4, 8)
  if (BIC_PE_COD[cod]) return { bic: BIC_PE_COD[cod], cunoscut: true, motiv: '' }
  if (DE_VERIFICAT_PE_COD[cod]) return { bic: '', cunoscut: false, motiv: DE_VERIFICAT_PE_COD[cod] }
  // Cod necunoscut: fără BIC (nu se inventează), de verificat
  if (/^[A-Z]{4}$/.test(cod)) return { bic: '', cunoscut: false, motiv: `bancă necunoscută (cod ${cod}) — aflați BIC-ul băncii de la angajat` }
  return { bic: '', cunoscut: false, motiv: 'IBAN fără cod de bancă valid — verificați IBAN-ul' }
}

// IBAN românesc valid: RO + 2 cifre de control + 20 de caractere (24 în total), cifra de control corectă (mod 97 = 1).
export function ibanRoValid(iban) {
  const curat = String(iban ?? '').replace(/\s/g, '').toUpperCase()
  if (!/^RO[0-9]{2}[A-Z0-9]{20}$/.test(curat)) return false
  const rearanjat = curat.slice(4) + curat.slice(0, 4)
  let rest = 0
  for (const ch of rearanjat) {
    const v = ch >= 'A' && ch <= 'Z' ? String(ch.charCodeAt(0) - 55) : ch
    for (const c of v) rest = (rest * 10 + (c.charCodeAt(0) - 48)) % 97
  }
  return rest === 1
}

const bani = x => Math.round(x * 100) / 100

// Împarte plățile de diurnă în „de exportat” (IBAN valid + BIC cunoscut) și „de verificat” (IBAN lipsă / invalid,
// bancă dispărută, OTP, cod necunoscut). Funcție pură: nu scrie nimic, nu salvează fișiere.
// intrare: [{ name, iban, suma }] → { deExportat: [{ name, iban, bic, suma }], deVerificat: [{ name, iban, suma, motiv }],
//   totalExportat, totalLasat }
export function imparteExportBanca(plati) {
  const deExportat = [], deVerificat = []
  for (const p of plati || []) {
    const iban = String(p.iban ?? '').replace(/\s/g, '').toUpperCase()
    let motiv = ''
    let bic = ''
    if (!iban) motiv = 'IBAN lipsă — cereți angajatului IBAN-ul'
    else if (!ibanRoValid(iban)) motiv = 'IBAN invalid (lungime sau cifră de control greșită) — verificați IBAN-ul'
    else {
      const r = bicDinIban(iban)
      if (!r.cunoscut || !r.bic) motiv = r.motiv || 'bancă fără BIC cunoscut — verificați'
      else bic = r.bic
    }
    if (motiv) deVerificat.push({ name: p.name, iban, suma: p.suma, motiv })
    else deExportat.push({ name: p.name, iban, bic, suma: p.suma })
  }
  const totalExportat = bani(deExportat.reduce((s, r) => s + r.suma, 0))
  const totalLasat = bani(deVerificat.reduce((s, r) => s + r.suma, 0))
  return { deExportat, deVerificat, totalExportat, totalLasat }
}
