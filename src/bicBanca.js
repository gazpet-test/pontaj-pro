// bicBanca.js — codul BIC (SWIFT) al băncii beneficiarului, dedus din IBAN-ul românesc (poziția 5–8 = codul băncii).
// Folosit la exportul BT de diurne (App.jsx → exportBancaDiurne).
// TKT-2026-0355: pentru IBAN-urile Intesa Sanpaolo (WBAN) se scria „WBANROBUXX” în loc de WBANRO22XXX. Cauza: lipsea din
// tabel și regula de rezervă lipea „ROBUXX” la orice cod necunoscut. Tot atunci: BIC-urile din tabel aveau 10 caractere
// (ex. INGBROBUXX), iar un BIC valid are 8 sau 11 → acum toate au forma completă de 11.
// Codurile necunoscute primesc în continuare o valoare de rezervă (ca fișierul să rămână ca înainte), dar sunt raportate
// separat, ca să fie verificate înainte de trimiterea la bancă.
const BIC_PE_COD = {
  BTRL: 'BTRLRO22XXX', // Banca Transilvania
  WBAN: 'WBANRO22XXX', // Intesa Sanpaolo Bank România
  INGB: 'INGBROBUXXX', // ING Bank
  RNCB: 'RNCBROBUXXX', // BCR
  BRDE: 'BRDEROBUXXX', // BRD
  BACX: 'BACXROBUXXX', // UniCredit Bank
  RZBR: 'RZBRROBUXXX', // Raiffeisen Bank
  CECE: 'CECEROBUXXX', // CEC Bank
  BRMA: 'BRMAROBUXXX', // Alpha Bank
  UGBI: 'UGBIROBUXXX', // Garanti BBVA
  OTPV: 'OTPVROBUXXX', // OTP Bank
  BREL: 'BRELROBUXXX', // Libra Internet Bank
  PIRB: 'PIRBROBUXXX', // First Bank
  MIRO: 'MIROROBUXXX', // ProCredit Bank
  TCCL: 'TCCLGB3L',    // conturi deschise prin The Currency Cloud (existent în tabelul vechi)
}

// { bic, cunoscut } — cunoscut=false = BIC ghicit (cod de bancă lipsă din tabel), de verificat de om.
export function bicDinIban(iban) {
  const curat = String(iban ?? '').replace(/\s/g, '').toUpperCase()
  if (!curat) return { bic: '', cunoscut: true }
  const cod = curat.substring(4, 8)
  if (BIC_PE_COD[cod]) return { bic: BIC_PE_COD[cod], cunoscut: true }
  return { bic: /^[A-Z]{4}$/.test(cod) ? cod + 'ROBUXXX' : '', cunoscut: false }
}
