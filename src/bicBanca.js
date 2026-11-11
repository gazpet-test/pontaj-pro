// bicBanca.js — codul BIC (SWIFT) al băncii beneficiarului, dedus din IBAN-ul românesc (poziția 5–8 = codul băncii).
// Folosit la exportul BT de diurne (App.jsx → exportBancaDiurne).
// TKT-2026-0355: pentru IBAN-urile Intesa Sanpaolo (WBAN) se scria „WBANROBUXX” în loc de WBANRO22XXX. Cauza: lipsea din
// tabel și regula de rezervă lipea „ROBUXX” la orice cod necunoscut. Tot atunci: BIC-urile din tabel aveau 10 caractere
// (ex. INGBROBUXX), iar un BIC valid are 8 sau 11 → acum băncile românești au forma completă de 11; excepția e TCCL
// (TCCLGB3L, 8 caractere, cod de bancă din afara țării, păstrat din tabelul vechi).
// r2 (review): în tabel stau DOAR băncile active azi. Codurile băncilor desființate / preluate nu primesc BIC: contul e
// pe formatul vechi și trebuie cerut angajatului IBAN-ul nou (schimbarea BIC-ului nu repară IBAN-ul). Băncile cu stare
// nesigură stau tot la „de verificat”, nu li se ghicește BIC-ul.
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
  OTPV: 'cont OTP Bank (bancă preluată de Banca Transilvania) — confirmați cu angajatul IBAN-ul actual',
  BRMA: 'cont Banca Românească (fuzionată cu Exim Banca Românească) — confirmați cu angajatul IBAN-ul actual',
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
  // Cod necunoscut: valoare de rezervă (ca fișierul să rămână ca înainte), dar raportat separat
  if (/^[A-Z]{4}$/.test(cod)) return { bic: cod + 'ROBUXXX', cunoscut: false, motiv: `bancă necunoscută (cod ${cod}) — verificați BIC-ul înainte de trimitere` }
  return { bic: '', cunoscut: false, motiv: 'IBAN fără cod de bancă valid — verificați IBAN-ul' }
}
