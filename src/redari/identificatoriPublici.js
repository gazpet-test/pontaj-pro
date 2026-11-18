// Redări — FORMA identificatorilor de parcelă care se PUBLICĂ (anunțul de afișare la primărie): o singură definiție (L19).
// Problema (review #1137 r1 P1, r2 P1): câmpurile sat / tarla / nr_cadastral / poz_hg / tronson sunt text liber la import (TGZ, Anexa 7)
// sau din Fișă; o valoare „contaminată” (un nume în `sat`, o adresă în `tarla`, un CNP sau un telefon în `nr_cadastral`, o cotă de
// proprietate în orice coloană) ar ajunge pe un afiș public. Regula:
//  1. fiecare valoare publicată trebuie să AIBĂ forma așteptată a câmpului; ce nu se potrivește NU se publică și BLOCHEAZĂ generarea, cu
//     lista exactă a parcelelor de corectat (id_parcela + câmpul + motivul — niciodată valoarea, care poate fi chiar data personală);
//  2. se publică EXACT valoarea validată (forma canonică întoarsă de `canonizeazaIdentificator`), nu originalul (r2: „12//3” trecea
//     normalizat ca „12/3”, dar se publica „12//3”); nimic nu se „curăță” tacit (L18): o valoare care diferă de forma ei canonică altfel
//     decât prin majuscule / spații e refuzată, nu reparată;
//  3. cotele și telefoanele / CNP-urile sunt refuzate și atunci când AU forma unui identificator: „a/b” cu a ≤ b (1/2, 3/4, 1/1, 17/240)
//     arată ca o cotă de proprietate, nu ca o subdiviziune („123/4”, „166/2” au a > b); segmente cu peste 8 cifre în total sau care,
//     lipite, dau un telefon (0[237]… de 10 cifre, +40 / 0040…) ori un CNP (13 cifre) sunt refuzate. O formă reală ambiguă (o parcelă
//     chiar numită „1/2”) e REFUZATĂ și listată pentru decizie, nu ghicită (review r2).
// Formele vin din datele reale de import (coloanele TGZ „Tarla/Nr. Topo” și „Nr. cadastral/Parcelă”, compuse cu „#”: „31#”, „123/4#”,
// „12IV#”, „#44#”, „50029#30#”, „#12/3#”, „#12'#”, „#12'(34/5)#”, „##UA 62A”, „##”; Anexa 7: „T12”, „CF100”; fixture-urile importurilor;
// CONTRACT_SCHEMA.md §7); compatibilitatea cu TOATE valorile din BD nu e dovedită aici (fără acces la BD) — vezi raportul rundei 3:
//  - un SUBCÂMP (între „#”) = [prefix de 1–2 litere sau „TARLA”, opțional spațiu / punct] + o PARTE NUMERICĂ [+ până la 3 părți după „/”]
//    [+ „(părți)”, numerotarea veche între paranteze], SAU un cod singur de 1–2 litere („DE”, „A”); o PARTE numerică = 1–6 cifre [+ prim ' ]
//    [+ 1–3 litere lipite: „12A”, „12IV”, sau după spațiu o literă / „BIS”: „12 A”, „12 BIS”]; o parte după „/” poate fi și un cod („3/A”);
//    cuvintele de 3+ litere („ION”, „DEX”) nu sunt identificator; subcâmp gol = informație lipsă; „-” singur = marcaj „fără valoare”;
//  - tarla / nr_cadastral: compuse cu „#” (TGZ) sau simple (Anexa 7 / Fișă); forma publicată = EXACT șirul validat (majuscule, spații
//    simple), cu „#” cu tot, ca în documentele de până acum (cadastru.js: valoarea brută nu se schimbă în documente) — NU subcâmpurile
//    lipite cu „ / ” (din „1#2#” ar ieși „1 / 2”, adică forma unei cote); TGZ-ul fără nicio valoare („##”) → nimic;
//  - poz_hg: poziția din anexa HG („117”, „12A”, „HG 1”; fn_red_seteaza_tronson citește prefixul numeric) — fără „/” și fără „#”, cu cifră;
//  - tronson: 1..11 (CHECK în BD) — aceeași regulă ca la import (`tronsonOptional`);
//  - sat: NU text liber (un nume de persoană are aceeași formă ca un nume de sat): doar unul dintre satele DECLARATE ale UAT-ului, adică
//    satele scrise la sesiuni în „Sate / tarlale ziua 1–3” (red_uat.sate_zi1..3 — tipărite oricum pe anunț, în tabelul zilelor; nu există
//    nomenclator de sate în schemă); forma publicată = ortografia DECLARATĂ („Gârnița”), nu valoarea parcelei („GARNITA”).
// Valoarea goală (NULL / '') e permisă la orice câmp (nu publică nimic). Marcajul „necompletat” al modelelor („____”, doar liniuțe de
// subliniere, ≥ 2) e acceptat la orice câmp: nu poartă nicio informație (scripts/redari_model_anunt_afisare.mjs).
import { normalizeazaNume } from './idParcela.js'
import { tronsonOptional, text, cadastruGol } from './importTgz.js'

/** Marcajul „necompletat” din modele: doar „_” (cel puțin două). */
export const RE_NECOMPLETAT = /^_{2,}$/
/** Lungimea maximă a unei valori publicate (forma canonică). */
export const LUNGIME_MAX_IDENTIFICATOR = 40
/** Peste atâtea cifre într-un subcâmp nu mai e identificator (cel mai lung real: 6), ci telefon (9–10) / CNP (13). */
export const MAX_CIFRE_SUBCAMP = 8
/** Motivele refuzului (în `probleme[].motiv`; niciodată valoarea). */
export const MOTIV = Object.freeze({ FORMA: 'forma', COTA: 'cota', TELEFON_CNP: 'telefon_cnp', LUNGIME: 'lungime', SAT_NEDECLARAT: 'sat_nedeclarat', CAMP: 'camp' })

// o PARTE numerică: 1–6 cifre [+ prim] [+ 1–3 litere lipite („12A”, „12IV”, „12BIS”) sau, după un spațiu, o literă ori „BIS” („12 A”, „12 BIS”)]
const PARTE_NUM = String.raw`[0-9]{1,6}['’]?(?:[A-Z]{1,3}| [A-Z]| BIS)?`
// un cod de 1–2 litere („DE”, „A”): singur ca subcâmp sau ca parte după „/” („3/A”); 3+ litere („ION”, „DEX”) nu sunt identificator
const PARTE_COD = String.raw`[A-Z]{1,2}`
const PARTE = `(?:${PARTE_NUM}|${PARTE_COD})`
const CORP = `${PARTE}(?:/${PARTE}){0,3}`
const RE_COD = new RegExp(`^${PARTE_COD}$`)
// un SUBCÂMP numeric: [prefix 1–2 litere / „TARLA” + spațiu sau punct opțional] parte numerică [/ părți] [(corp: numerotarea veche)]
const RE_SUBCAMP_NUMERIC = new RegExp(String.raw`^(?:(?:[A-Z]{1,2}|TARLA)[ .]?)?${PARTE_NUM}(?:/${PARTE}){0,3}(?:\(${CORP}\))?$`)
const areFormaSubcamp = s => RE_COD.test(s) || RE_SUBCAMP_NUMERIC.test(s)
const RE_FARA_VALOARE = /^[-–—]$/
// „a/b” exact (fără prefix): cotă dacă a ≤ b; se aplică și grupului din paranteze
const RE_FRACTIE = /^([0-9]+)\/([0-9]+)$/
const RE_GRUP_PARANTEZE = /\(([^()]*)\)$/
// cifrele tuturor subcâmpurilor, lipite: telefon RO (0[237] + 8 cifre), internațional (+40 / 0040 / 40 + 9 cifre), CNP (13 cifre)
const RE_TELEFON_SAU_CNP = /^(?:0[237][0-9]{8}|(?:00)?40[0-9]{9}|[1-9][0-9]{12})$/
// numele unui sat (segment din „Sate / tarlale ziua N”, normalizat): litere, spații, cratimă, apostrof, punct; fără cifre; 2–40 de caractere
const RE_NUME_SAT = /^[A-Z][A-Z '.\-]{1,39}$/
// segmente din „Sate / tarlale ziua N” care NU sunt sate (indicații de program)
const RE_SEGMENT_FARA_SAT = /^(?:TARLA|TARLALE|TARLAUA|RESTUL|REST|TOATE|TOT|CELELALTE|ALTE|ALTELE)\b/
const RE_PREFIX_SAT = /^(?:SAT(?:UL)?|LOC(?:ALITATEA)?)\.? /
const RE_PREFIX_SAT_ORIGINAL = /^(?:sat(?:ul)?|loc(?:alitatea)?)\.? /i

/** Regula pe câmp: compus cu „#” (TGZ) / „/” permis / cifră obligatorie / cifre maxime pe subcâmp (cele mai lungi forme reale + marjă). */
const REGULA_CAMP = Object.freeze({
  tarla: { compus: true, slash: true, cifraObligatorie: false, maxCifre: 6 },
  nr_cadastral: { compus: true, slash: true, cifraObligatorie: false, maxCifre: MAX_CIFRE_SUBCAMP },
  poz_hg: { compus: false, slash: false, cifraObligatorie: true, maxCifre: 5 },
})

/** Normalizarea folosită la compararea SATULUI cu lista declarată (majuscule, fără diacritice, spații simple — ca la cheia de import). */
export const normalizeazaIdentificator = v => normalizeazaNume(v)

const ok = valoare => ({ ok: true, valoare })
const refuz = motiv => ({ ok: false, motiv })
const cifre = s => s.replace(/[^0-9]/g, '')
const pareCota = s => {
  for (const t of [s, RE_GRUP_PARANTEZE.exec(s)?.[1]]) {
    const m = t == null ? null : RE_FRACTIE.exec(t)
    if (m && Number(m[1]) <= Number(m[2])) return true
  }
  return false
}

/** Motivul refuzului unui identificator TEXT (tarla / nr_cadastral / poz_hg) în forma canonică `canon`, sau null dacă are forma câmpului. */
function motivIdentificatorText(canon, regula) {
  if (!regula.compus && canon.includes('#')) return MOTIV.FORMA
  const subcampuri = regula.compus ? canon.split('#') : [canon]
  let toateCifrele = ''
  for (const s of subcampuri) {
    if (s === '' || RE_FARA_VALOARE.test(s)) continue
    const c = cifre(s)
    if (c.length > MAX_CIFRE_SUBCAMP) return MOTIV.TELEFON_CNP
    if (c.length > regula.maxCifre) return MOTIV.FORMA
    if (regula.cifraObligatorie && !c) return MOTIV.FORMA
    if (pareCota(s)) return MOTIV.COTA
    if (!regula.slash && s.includes('/')) return MOTIV.FORMA
    if (!areFormaSubcamp(s)) return MOTIV.FORMA
    toateCifrele += c
  }
  if (RE_TELEFON_SAU_CNP.test(toateCifrele)) return MOTIV.TELEFON_CNP
  return null
}

/**
 * Satele DECLARATE ale UAT-ului: Map(normalizat → ortografia declarată), din segmentele sate_zi1..3 (despărțite de „,” / „;” / „ și ” /
 * „ – ”, fără parantezele cu tarlale) care au forma unui nume de sat; „Satul X” intră și ca „X”. Indicațiile de program („tarlalele 1–5”,
 * „restul”) nu sunt sate. Prima ortografie declarată a unui sat câștigă.
 */
export function sateDeclarate(uat = {}) {
  const sate = new Map()
  for (const i of [1, 2, 3]) {
    for (const seg of String(uat?.[`sate_zi${i}`] ?? '').replace(/\([^)]*\)/g, ' ').split(/[,;]|\s+[sș]i\s+|\s+[–—-]\s+/i)) {
      const declarat = text(seg)
      const n = normalizeazaIdentificator(declarat)
      if (!n || /[0-9]/.test(n) || RE_SEGMENT_FARA_SAT.test(n)) continue
      for (const [cheie, forma] of [[n, declarat], [n.replace(RE_PREFIX_SAT, ''), declarat.replace(RE_PREFIX_SAT_ORIGINAL, '')]]) {
        if (RE_NUME_SAT.test(cheie) && !sate.has(cheie)) sate.set(cheie, forma)
      }
    }
  }
  return sate
}

/**
 * Forma CANONICĂ a unei valori publicate: { ok: true, valoare } (valoarea EXACT așa cum se publică; '' = nimic) sau { ok: false, motiv }.
 * Pentru `sat` cere `ctx.sate` (Map din sateDeclarate) sau `ctx.uat`. Nu întoarce niciodată valoarea refuzată.
 */
export function canonizeazaIdentificator(camp, valoare, ctx = {}) {
  if (valoare === null || valoare === undefined) return ok('')
  if (typeof valoare === 'object' || typeof valoare === 'function') return refuz(MOTIV.FORMA)
  const canon = text(valoare).toUpperCase()
  if (canon === '' || RE_NECOMPLETAT.test(canon)) return ok(canon)
  if (canon.length > LUNGIME_MAX_IDENTIFICATOR) return refuz(MOTIV.LUNGIME)
  switch (camp) {
    case 'tarla': case 'nr_cadastral': case 'poz_hg': {
      const regula = REGULA_CAMP[camp]
      // la TGZ-ul compus, spațiile din jurul lui „#” nu poartă informație: „# 44 #” → „#44#” (validarea și publicarea pe ACELAȘI șir)
      const sir = regula.compus ? canon.replace(/ ?# ?/g, '#') : canon
      const motiv = motivIdentificatorText(sir, regula)
      if (motiv) return refuz(motiv)
      // se publică EXACT șirul validat (cu „#” cu tot), NU o formă recompusă: lipirea subcâmpurilor validate separat („1#2#” → „1 / 2”)
      // ar produce pe afiș exact forma unei cote. Singura excepție: TGZ-ul fără nicio valoare („##”) → nimic (cadastruGol, L19).
      return ok(regula.compus && cadastruGol(sir) ? '' : sir)
    }
    case 'tronson': {
      if (cifre(canon).length > MAX_CIFRE_SUBCAMP) return refuz(MOTIV.TELEFON_CNP)
      const n = tronsonOptional(typeof valoare === 'number' ? valoare : canon)
      return n === null ? refuz(MOTIV.FORMA) : ok(String(n))
    }
    case 'sat': {
      const n = normalizeazaIdentificator(valoare)
      if (!RE_NUME_SAT.test(n)) return refuz(MOTIV.FORMA)
      const sate = ctx.sate instanceof Map ? ctx.sate : sateDeclarate(ctx.uat)
      const declarat = sate.get(n) ?? sate.get(n.replace(RE_PREFIX_SAT, ''))
      return declarat === undefined ? refuz(MOTIV.SAT_NEDECLARAT) : ok(declarat)
    }
    default: return refuz(MOTIV.CAMP)   // câmp necunoscut = nu se publică
  }
}

/** true = valoarea are forma așteptată a câmpului (gol / „____” inclusiv). */
export function areFormaIdentificator(camp, valoare, ctx = {}) { return canonizeazaIdentificator(camp, valoare, ctx).ok }

/**
 * Canonizează identificatorii PUBLICAȚI ai parcelelor: { probleme, randuri }.
 *  - probleme = [{ id_parcela, camp, motiv }] (fără valori); goală = toate valorile au forma așteptată;
 *  - randuri = [{ id_parcela, <camp>: forma canonică }] — DOAR formele canonice (niciodată valorile originale) și DOAR dacă `probleme` e
 *    goală (altfel []), ca nimic să nu se poată publica dintr-o listă cu refuzuri.
 * `campuri` = lista albă a coloanelor publicate; `uat` dă satele declarate.
 */
export function canonizeazaParcelePublicate(parcele = [], campuri = [], uat = {}) {
  const sate = sateDeclarate(uat)
  const probleme = []
  const randuri = []
  for (const p of parcele) {
    if (!p) continue
    const rand = { id_parcela: String(p.id_parcela ?? '?') }
    for (const camp of campuri) {
      const r = canonizeazaIdentificator(camp, p[camp], { sate })
      if (r.ok) rand[camp] = r.valoare
      else probleme.push({ id_parcela: rand.id_parcela, camp, motiv: r.motiv })
    }
    randuri.push(rand)
  }
  return { probleme, randuri: probleme.length ? [] : randuri }
}

/** Doar lista problemelor (vezi canonizeazaParcelePublicate). */
export function verificaIdentificatoriPublicati(parcele = [], campuri = [], uat = {}) {
  return canonizeazaParcelePublicate(parcele, campuri, uat).probleme
}

export const ETICHETA_CAMP_PUBLICAT = { sat: 'sat', tarla: 'tarla', nr_cadastral: 'nr. cadastral / parcelă', poz_hg: 'poz. HG', tronson: 'tronson' }
/** Eticheta motivului, pe lângă codul parcelei (null = fără etichetă: forma nu se potrivește, sau satul — explicat la final). */
export const ETICHETA_MOTIV = { [MOTIV.COTA]: 'arată ca o cotă', [MOTIV.TELEFON_CNP]: 'prea multe cifre: telefon / CNP?', [MOTIV.LUNGIME]: 'prea lung' }
export const MESAJ_IDENTIFICATORI_REFUZATI = 'Anunțul de afișare nu poate fi generat: identificatori de parcelă fără forma așteptată (nu se publică nimic până la corectarea lor în Fișa parcelei)'
export const MESAJ_SAT_NEDECLARAT = 'satul trebuie să fie unul dintre satele scrise la „Sate / tarlale ziua 1–3” ale UAT-ului'

/** Textul problemelor, grupat pe câmp: „sat: HUS-0001, HUS-0002; tarla: HUS-0003 (arată ca o cotă)” (coduri de parcelă, câmpuri, motive — fără valori). */
export function textProblemeIdentificatori(probleme = []) {
  const peCamp = new Map()
  for (const { id_parcela, camp, motiv } of probleme) {
    if (!peCamp.has(camp)) peCamp.set(camp, [])
    peCamp.get(camp).push(ETICHETA_MOTIV[motiv] ? `${id_parcela} (${ETICHETA_MOTIV[motiv]})` : id_parcela)
  }
  const parti = [...peCamp].map(([camp, ids]) => `${ETICHETA_CAMP_PUBLICAT[camp] ?? camp}: ${ids.join(', ')}`)
  if (peCamp.has('sat')) parti.push(`(${MESAJ_SAT_NEDECLARAT})`)
  return parti.join('; ')
}
