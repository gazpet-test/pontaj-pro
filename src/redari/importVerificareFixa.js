// Redări — importul TGZ: verificarea FIXĂ (fără AI) a coloanelor de identificare, în previzualizare (decizia Răzvan 19.11.2026, pasul 1).
// Riscul: o coloană decalată în Excel-ul TGZ pune numele / adresa / telefonul deținătorului în tarla / nr_cadastral / poz_hg.
// Valorile Transgaz în sine (UP / UA, HCN, HR_, PD_, numere topo cu fracție, liste, „#”) sunt legitime și NU se semnalează.
// Rezultatul e doar un SEMNAL „de verificat”: nu blochează rândul, nu schimbă nimic din import, nu se scrie în BD.
// Raportul NU conține niciodată valoarea (poate fi chiar data personală): doar rândul, parcela (UAT + Nr.Crt.), câmpul și motivul.
//
// Regulile (pe fiecare rând care a ajuns într-un grup de parcelă, inclusiv dublurile de nume):
//  1. NUME: câmpul conține, ca CUVÂNT întreg (nu subșir — L11), un cuvânt de minim 4 litere din numele unui deținător de pe același
//     rând sau din același grup Nr.Crt., ori numele complet (toate cuvintele, în ordine, minim 4 litere în total). Comparația e
//     normalizată: fără diacritice, majuscule. Nu contează cuvintele generice ale persoanelor juridice („COMUNA”, „PRIMARIA”, „STATUL”…)
//     și nici localitățile rândului (numele UAT-ului, satul / comuna din adresa deținătorului): „UP II <Localitate>” e legitim, iar
//     „COMUNA <Localitate>” e un deținător frecvent.
//  2. ADRESĂ: câmpul conține adresa completă a unui deținător din grup (toate cuvintele, în ordine, minim 2), ori e o bucată din ea
//     (minim 2 cuvinte, dintre care unul de minim 4 litere, minim 8 caractere).
//  3. TELEFON / CNP: detectorul din identificatoriPublici.js (aceleași ferestre de componente numerice consecutive și aceeași formă:
//     0[237] + 8 cifre, 40 / 0040 + 9 cifre, 13 cifre), aplicat pe fiecare articol al valorii (despărțit de „#”, „,”, „+”, „;”):
//     un cadastru compus („40123#1234/5/6”) nu se lipește peste „#” într-un fals telefon.
//  4. E-MAIL / URL: „ceva@domeniu.tld”, „http(s)://”, „www.”, „domeniu.ro / .com / …”.
import { faraDiacritice } from './idParcela.js'
import { canonizeazaIdentificator, componenteNumerice, ferestreConsecutive, MOTIV } from './identificatoriPublici.js'
// Atenție: identificatoriPublici.js importă din importTgz.js, care importă acest modul (ciclu de module). Aici nu se apelează nimic
// importat la încărcarea modulului (doar în funcții), deci ciclul e sigur; nu adăuga constante calculate din importuri la nivelul fișierului.

/** Câmpurile verificate, în ordinea din raport. */
export const CAMPURI_VERIFICATE = Object.freeze(['poz_hg', 'nr_cadastral', 'tarla'])
export const ETICHETA_CAMP_VERIFICAT = Object.freeze({ poz_hg: 'poz. HG', nr_cadastral: 'nr. cadastral / parcelă', tarla: 'tarla / nr. topo' })
/** Motivele semnalului (coduri stabile; niciodată valoarea). */
export const MOTIV_VERIFICARE = Object.freeze({ NUME: 'nume', ADRESA: 'adresa', TELEFON_CNP: 'telefon_cnp', EMAIL_URL: 'email_url' })
export const ETICHETA_MOTIV_VERIFICARE = Object.freeze({
  nume: 'pare numele deținătorului',
  adresa: 'pare adresa deținătorului',
  telefon_cnp: 'pare telefon / CNP',
  email_url: 'pare e-mail / adresă web',
})
export const MIN_LITERE_CUVANT = 4
/** Explicația afișată în ecran și titlul secțiunii. */
export const TITLU_DE_VERIFICAT = 'De verificat (posibilă coloană decalată)'

// cuvinte din numele persoanelor juridice / mențiuni care nu identifică pe cineva anume (comparate fără diacritice, majuscule)
const CUVINTE_GENERICE = new Set([
  'COMUNA', 'COMUNEI', 'ORAS', 'ORASUL', 'ORASULUI', 'MUNICIPIUL', 'MUNICIPIULUI', 'JUDET', 'JUDETUL', 'JUDETULUI', 'SATUL',
  'PRIMARIA', 'PRIMARIEI', 'CONSILIUL', 'CONSILIULUI', 'LOCAL', 'JUDETEAN', 'STATUL', 'STATULUI', 'ROMAN', 'ROMANIA', 'ROMANESC',
  'PRIN', 'PENTRU', 'DOMENIUL', 'PUBLIC', 'PUBLICA', 'PRIVAT', 'PRIVATA', 'ADMINISTRARE', 'ADMINISTRATIA', 'AGENTIA',
  'NATIONALA', 'NATIONAL', 'DIRECTIA', 'SOCIETATEA', 'COMPANIA', 'AGRICOLA', 'ASOCIATIA', 'PAROHIA', 'BISERICA', 'ORTODOXA', 'MANASTIREA',
  'NEIDENTIFICAT', 'NEIDENTIFICATA', 'NEIDENTIFICATI', 'MOSTENITOR', 'MOSTENITORI', 'MOSTENITORII', 'DECEDAT', 'DECEDATA', 'DEFUNCT', 'DEFUNCTA',
  'SUCCESORI', 'SUCCESORII', 'PROPRIETAR', 'PROPRIETARI', 'TITULAR', 'TITULARI',
  // vocabularul coloanelor TGZ („TARLA 12”, „PARCELA 3”): un deținător cu acest nume de familie nu se poate deosebi de valoarea legitimă
  'TARLA', 'TARLAUA', 'PARCELA', 'PARCELE', 'TOPO', 'CADASTRAL', 'CADASTRU', 'NUMAR',
])

const norm = v => faraDiacritice(v).toUpperCase()
const cuvinteLitere = v => norm(v).match(/[A-Z]+/g) ?? []
const atomi = v => norm(v).match(/[A-Z0-9]+/g) ?? []   // cuvinte + numere, în ordine (separatorii nu contează)
// secvența b (nevidă) apare în a, pe atomi întregi consecutivi
const continePeAtomi = (a, b) => b.length > 0 && ` ${a.join(' ')} `.includes(` ${b.join(' ')} `)

/** Localitățile rândului: cuvintele numelui UAT-ului + satul / comuna din adresa deținătorului (deja împărțită de imparteAdresa). */
function cuvinteLocalitati({ uat_nume, adresa_sat, adresa_comuna } = {}) {
  return new Set([uat_nume, adresa_sat, adresa_comuna].flatMap(cuvinteLitere))
}

/** true = valoarea conține numele (un cuvânt ≥ 4 litere, negeneric și nu localitate, sau numele complet ≥ 4 litere). */
export function contineNume(valoare, nume, localitati = new Set()) {
  const v = cuvinteLitere(valoare); if (!v.length) return false
  const n = cuvinteLitere(nume); if (!n.length) return false
  const setV = new Set(v)
  if (n.some(w => w.length >= MIN_LITERE_CUVANT && !CUVINTE_GENERICE.has(w) && !localitati.has(w) && setV.has(w))) return true
  // numele complet (ex. „POP ION”, cuvinte scurte): toate cuvintele lui, în ordine, în valoare — dacă nu e format doar din generice / localități
  const semnificative = n.filter(w => !CUVINTE_GENERICE.has(w) && !localitati.has(w))
  return n.join('').length >= MIN_LITERE_CUVANT && semnificative.length > 0 && continePeAtomi(v, n)
}

/** true = valoarea conține adresa completă (≥ 2 atomi) sau e o bucată din adresă (≥ 2 atomi, un cuvânt ≥ 4 litere, ≥ 8 caractere). */
export function contineAdresa(valoare, adresa) {
  const v = atomi(valoare); const a = atomi(adresa)
  if (v.length === 0 || a.length < 2) return false
  if (continePeAtomi(v, a)) return true
  return v.length >= 2 && v.some(w => /^[A-Z]+$/.test(w) && w.length >= MIN_LITERE_CUVANT) && v.join(' ').length >= 8 && continePeAtomi(a, v)
}

// o fereastră de cifre (10–13) → valoare formată doar din bucăți de ≤ 6 cifre despărțite de „#”, ca detectorul din identificatoriPublici
// să judece DOAR fereastra: fiecare bucată are forma unui subcâmp de tarla (≤ 6 cifre), deci singurul motiv posibil de refuz e TELEFON_CNP,
// iar nicio altă lipire de bucăți nu are 10, 11 sau 13 cifre (10 → 5+5, 11 → 6+5, 12 → 6+6, 13 → 5+4+4: lipirile parțiale au ≤ 9 cifre).
function pareTelefonSauCnpFereastra(f) {
  if (f.length < 10 || f.length > 13) return false
  const n = Math.ceil(f.length / 6); const bucati = []
  for (let i = 0, p = 0; i < n; i++) { const l = Math.ceil((f.length - p) / (n - i)); bucati.push(f.slice(p, p + l)); p += l }
  return canonizeazaIdentificator('tarla', bucati.join('#')).motiv === MOTIV.TELEFON_CNP
}

/** true = un articol al valorii (despărțit de „#”, „,”, „+”, „;”) conține un telefon / CNP pe componente numerice consecutive. */
export function pareTelefonSauCnp(valoare) {
  return String(valoare ?? '').split(/[#,+;]/).some(articol => ferestreConsecutive(componenteNumerice(articol)).some(pareTelefonSauCnpFereastra))
}

const RE_EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/i
const RE_URL = /(?:\bhttps?:\/\/|\bwww\.|\b[A-Z0-9-]{2,}\.(?:ro|com|net|org|eu|info|biz)\b)/i
/** true = valoarea arată a e-mail sau a adresă web. */
export function pareEmailSauUrl(valoare) {
  const s = String(valoare ?? '')
  return (s.includes('@') && RE_EMAIL.test(s)) || RE_URL.test(s)
}

/**
 * verificaColoaneDecalate(randuri, { uat_nume }) → [{ rand, uat, nr_crt, cheie_parcela, camp, motive, motiv }] (fără valori).
 *  randuri = [{ rand, uat, nr_crt, cheie_parcela, poz_hg, nr_cadastral, tarla, nume, adresa, adresa_sat, adresa_comuna, uat_nume }]
 *  — rândurile grupurilor de parcelă, cu valorile BRUTE ale rândului. Numele / adresele se compară cu toți deținătorii grupului
 *  (cheie_parcela), nu doar cu rândul curent: valorile unui grup se consolidează (P1-2 r7), deci un nume din rândul 2 ajuns în
 *  tarla rândului 3 contează. O intrare per (rând, câmp), cu toate motivele ei, în ordinea rândurilor și a CAMPURI_VERIFICATE.
 */
export function verificaColoaneDecalate(randuri = []) {
  const grupuri = new Map()
  for (const r of randuri) { if (!r) continue; if (!grupuri.has(r.cheie_parcela)) grupuri.set(r.cheie_parcela, []); grupuri.get(r.cheie_parcela).push(r) }
  const out = []
  for (const r of randuri) {
    if (!r) continue
    const grup = grupuri.get(r.cheie_parcela)
    for (const camp of CAMPURI_VERIFICATE) {
      const v = r[camp]
      if (v == null || String(v).trim() === '') continue
      const motive = []
      if (grup.some(d => contineNume(v, d.nume, cuvinteLocalitati(d)))) motive.push(MOTIV_VERIFICARE.NUME)
      if (grup.some(d => contineAdresa(v, d.adresa))) motive.push(MOTIV_VERIFICARE.ADRESA)
      if (pareTelefonSauCnp(v)) motive.push(MOTIV_VERIFICARE.TELEFON_CNP)
      if (pareEmailSauUrl(v)) motive.push(MOTIV_VERIFICARE.EMAIL_URL)
      if (!motive.length) continue
      out.push({ rand: r.rand ?? null, uat: r.uat ?? '', nr_crt: r.nr_crt ?? '', cheie_parcela: r.cheie_parcela ?? '', camp, motive, motiv: `${ETICHETA_CAMP_VERIFICAT[camp]}: ${motive.map(m => ETICHETA_MOTIV_VERIFICARE[m]).join(' + ')}` })
    }
  }
  return out
}

/** Câte rânduri DISTINCTE au cel puțin un semnal (intrările fără rând se numără fiecare). */
export function numarRanduriDeVerificat(semnale = []) {
  const vazute = new Set(); let faraRand = 0
  for (const s of semnale) { if (s?.rand == null) faraRand++; else vazute.add(s.rand) }
  return vazute.size + faraRand
}
