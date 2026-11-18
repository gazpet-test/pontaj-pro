// Redări — FORMA identificatorilor de parcelă care se PUBLICĂ (anunțul de afișare la primărie): o singură definiție (L19).
// Problema (review #1137 r1, P1): câmpurile sat / tarla / nr_cadastral / poz_hg / tronson sunt text liber la import (TGZ, Anexa 7) sau
// din Fișă; o valoare „contaminată” (un nume în `sat`, o adresă în `tarla`, un CNP în `nr_cadastral`, o cotă în `poz_hg`, un telefon în
// `tronson`) ar ajunge pe un afiș public. Regula: fiecare valoare publicată trebuie să AIBĂ forma așteptată a câmpului; ce nu se potrivește
// NU se publică și BLOCHEAZĂ generarea, cu lista exactă a parcelelor de corectat (id_parcela + câmpul — niciodată valoarea, care poate fi
// chiar data personală). Nimic nu se „curăță” tacit (L18).
// Formele vin din datele reale de import (importTgz.js / importAnexa7.js, fixture-urile lor și CONTRACT_SCHEMA.md):
//  - tarla: „T12”, „T 12”, „T.12”, „12”, „T12/1”, „12A” (coloana „Tarla / Nr. topo”);
//  - nr_cadastral: valoarea TGZ compusă cu „#” („52#”, „#44#”, „50029#30#”, „##”), „CF 1001”, „123/4”, „100”; un subcâmp poate fi un cod
//    scurt cu majuscule („DE” — cadastruSuspect îl marchează la import, dar e în date);
//  - poz_hg: poziția în anexa HG: „117”, „12A”, „HG 1” (fn_red_seteaza_tronson citește prefixul numeric) — FĂRĂ „/”, ca o cotă („1/2”) să nu treacă;
//  - tronson: 1..11 (CHECK în BD) — aceeași regulă ca la import (`tronsonOptional`);
//  - sat: NU text liber (un nume de persoană are aceeași formă ca un nume de sat): doar unul dintre satele DECLARATE ale UAT-ului, adică
//    satele scrise la sesiuni în „Sate / tarlale ziua 1–3” (red_uat.sate_zi1..3; nu există nomenclator de sate în schemă — vezi raportul).
// Valoarea goală (NULL / '') e permisă la orice câmp (nu publică nimic). Marcajul „necompletat” al modelelor („____”, doar liniuțe de
// subliniere, ≥ 2) e acceptat la orice câmp: nu poartă nicio informație (scripts/redari_model_anunt_afisare.mjs).
import { normalizeazaNume } from './idParcela.js'
import { tronsonOptional } from './importTgz.js'

/** Marcajul „necompletat” din modele: doar „_” (cel puțin două). */
export const RE_NECOMPLETAT = /^_{2,}$/
/** Lungimea maximă a unei valori publicate (după normalizare). */
export const LUNGIME_MAX_IDENTIFICATOR = 40

const RE_TARLA = /^(?:T(?:ARLA)?[ .]?)?[0-9]{1,4}(?:[\/-][0-9]{1,4})?[A-Z]?$/
// un subcâmp: număr cadastral / CF / topo („CF 1001”, „50029”, „123/4”, „1234/2/1”, „12A”) sau un cod scurt de 1–2 majuscule („DE”, „HC”)
const RE_CADASTRU_SUB = /^(?:CF[ ]?)?[0-9]{1,6}(?:\/[0-9]{1,6}){0,3}[A-Z]?$|^[A-Z]{1,2}$/
const RE_POZ_HG = /^(?:HG[ ]?)?[0-9]{1,5}(?:[ ]?[A-Z]|[ ]?BIS)?$/
// numele unui sat (segment din „Sate / tarlale ziua N”): litere, spații, cratimă, apostrof, punct; fără cifre; 2–40 de caractere
const RE_NUME_SAT = /^[A-Z][A-Z '.\-]{1,39}$/
// segmente din „Sate / tarlale ziua N” care NU sunt sate (indicații de program)
const RE_SEGMENT_FARA_SAT = /^(?:TARLA|TARLALE|TARLAUA|RESTUL|REST|TOATE|TOT|CELELALTE|ALTE|ALTELE|RESTUL)\b/
const RE_PREFIX_SAT = /^(?:SAT(?:UL)?|LOC(?:ALITATEA)?)\.? /

/** Normalizarea comună înaintea comparării cu forma: majuscule, fără diacritice, spații simple, trim (aceeași ca cheia de import). */
export const normalizeazaIdentificator = v => normalizeazaNume(v)

const esteGolSauNecompletat = n => n === '' || RE_NECOMPLETAT.test(n)

/**
 * Satele DECLARATE ale UAT-ului: segmentele din sate_zi1..3 (despărțite de „,” / „;” / „ și ” / „ – ”, fără parantezele cu tarlale)
 * care au forma unui nume de sat; „Satul X” intră și ca „X”. Indicațiile de program („tarlalele 1–5”, „restul”) nu sunt sate.
 */
export function sateDeclarate(uat = {}) {
  const sate = new Set()
  for (const i of [1, 2, 3]) {
    for (const seg of String(uat?.[`sate_zi${i}`] ?? '').replace(/\([^)]*\)/g, ' ').split(/[,;]|\s+[sș]i\s+|\s+[–—-]\s+/i)) {
      const n = normalizeazaIdentificator(seg)
      if (!n || /[0-9]/.test(n) || RE_SEGMENT_FARA_SAT.test(n)) continue
      const faraPrefix = n.replace(RE_PREFIX_SAT, '')
      for (const s of [n, faraPrefix]) if (RE_NUME_SAT.test(s)) sate.add(s)
    }
  }
  return sate
}

/** Forma unei valori de câmp (fără contextul UAT-ului): true = are forma așteptată (gol / „____” inclusiv). Pentru `sat` cere `ctx.sate`. */
export function areFormaIdentificator(camp, valoare, ctx = {}) {
  if (valoare === null || valoare === undefined) return true
  if (typeof valoare === 'object') return false
  const n = normalizeazaIdentificator(valoare)
  if (esteGolSauNecompletat(n)) return true
  if (n.length > LUNGIME_MAX_IDENTIFICATOR) return false
  switch (camp) {
    case 'tarla': return RE_TARLA.test(n)
    case 'nr_cadastral': return n.split('#').every(s => s === '' || RE_CADASTRU_SUB.test(s))
    case 'poz_hg': return RE_POZ_HG.test(n)
    case 'tronson': return typeof valoare === 'number' ? tronsonOptional(valoare) !== null : tronsonOptional(n) !== null
    case 'sat': {
      if (!RE_NUME_SAT.test(n)) return false
      const sate = ctx.sate instanceof Set ? ctx.sate : sateDeclarate(ctx.uat)
      return sate.has(n) || sate.has(n.replace(RE_PREFIX_SAT, ''))
    }
    default: return false   // câmp necunoscut = nu se publică
  }
}

/**
 * Verifică identificatorii PUBLICAȚI ai parcelelor: întoarce lista problemelor { id_parcela, camp } (goală = toate au forma așteptată).
 * Nu întoarce valorile (pot fi date personale). `campuri` = lista albă a coloanelor publicate; `uat` dă satele declarate.
 */
export function verificaIdentificatoriPublicati(parcele = [], campuri = [], uat = {}) {
  const sate = sateDeclarate(uat)
  const probleme = []
  for (const p of parcele) {
    if (!p) continue
    for (const camp of campuri) if (!areFormaIdentificator(camp, p[camp], { sate })) probleme.push({ id_parcela: String(p.id_parcela ?? '?'), camp })
  }
  return probleme
}

export const ETICHETA_CAMP_PUBLICAT = { sat: 'sat', tarla: 'tarla', nr_cadastral: 'nr. cadastral / parcelă', poz_hg: 'poz. HG', tronson: 'tronson' }
export const MESAJ_IDENTIFICATORI_REFUZATI = 'Anunțul de afișare nu poate fi generat: identificatori de parcelă fără forma așteptată (nu se publică nimic până la corectarea lor în Fișa parcelei)'
export const MESAJ_SAT_NEDECLARAT = 'satul trebuie să fie unul dintre satele scrise la „Sate / tarlale ziua 1–3” ale UAT-ului'

/** Textul problemelor, grupat pe câmp: „sat: HUS-0001, HUS-0002; tarla: HUS-0003” (doar coduri de parcelă și câmpuri, fără valori). */
export function textProblemeIdentificatori(probleme = []) {
  const peCamp = new Map()
  for (const { id_parcela, camp } of probleme) { if (!peCamp.has(camp)) peCamp.set(camp, []); peCamp.get(camp).push(id_parcela) }
  const parti = [...peCamp].map(([camp, ids]) => `${ETICHETA_CAMP_PUBLICAT[camp] ?? camp}: ${ids.join(', ')}`)
  if (peCamp.has('sat')) parti.push(`(${MESAJ_SAT_NEDECLARAT})`)
  return parti.join('; ')
}
