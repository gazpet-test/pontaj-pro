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
//     arată ca o cotă de proprietate, nu ca o subdiviziune („123/4”, „166/2” au a > b); un subcâmp cu peste 8 cifre în total (pe toate
//     părțile lui: „0711/111/111”) e refuzat; la fel ORICE șir de COMPONENTE numerice CONSECUTIVE (grupurile de cifre ale valorii, în
//     ordine, peste „#”, „/”, paranteze și litere) care, lipite, dau un telefon (0[237] + 8 cifre; 40 / 0040 + 9 cifre) ori 13 cifre
//     (forma unui CNP) — review r3: „0711#111111#UA62A” trecea pentru că se verifica doar lipirea TUTUROR cifrelor. O fereastră începe și
//     se termină la o graniță de componentă (cifrele unui grup nu se taie): „50711#111111#” NU e prins (vezi raportul rundei 4), iar
//     telefonul fără 0 („711#111111#”, 9 cifre) trece, după decizia rundei 3 (nedeosebibil de cadastral + parcelă). O formă reală ambiguă
//     (o parcelă chiar numită „1/2”, un TGZ cu 13 cifre pe subcâmpuri consecutive) e REFUZATĂ și listată pentru decizie, nu ghicită.
// Formele vin din datele reale de import (coloanele TGZ „Tarla/Nr. Topo” și „Nr. cadastral/Parcelă”, compuse cu „#”: „31#”, „123/4#”,
// „12IV#”, „#44#”, „50029#30#”, „#12/3#”, „#12'#”, „#12'(34/5)#”, „##UA 62A”, „##”; Anexa 7: „T12”, „CF100”; fixture-urile importurilor;
// CONTRACT_SCHEMA.md §7); compatibilitatea cu TOATE valorile din BD nu e dovedită aici (fără acces la BD) — vezi raportul rundei 3:
//  - un SUBCÂMP (între „#”) = [prefix de 1–2 litere sau „TARLA”, opțional spațiu / punct] + o PARTE NUMERICĂ [+ până la 3 părți după „/”]
//    [+ „(părți)”, numerotarea veche între paranteze], SAU un cod singur de 1–2 litere („DE”, „A”); o PARTE numerică = 1–6 cifre [+ prim ' ]
//    [+ 1–3 litere lipite: „12A”, „12IV”, sau după spațiu o literă / „BIS”: „12 A”, „12 BIS”]; o parte după „/” poate fi și un cod („3/A”);
//    cuvintele de 3+ litere („ION”, „DEX”) nu sunt identificator; subcâmp gol = informație lipsă; „-” singur = marcaj „fără valoare”;
//  - DOAR la nr_cadastral (runda 5: formele reale din LOT1 refuzate fals, măsurate pe măști — cifră → 9, literă → A — fără valori): primul
//    poate fi simplu / dublu / triplu („12''”, „123''”, „12'''(34'')”); un subcâmp poate fi o LISTĂ de 2–4 articole numerice despărțite
//    de „,” sau „+” fără spațiu („12,34”, „12',34/5”, „12+34”); parantezele pot avea 1–4 elemente despărțite de „,”, iar un element
//    poate începe cu 1–2 litere lipite de cifre („12(A34,A56)”). Cota / telefonul / CNP-ul se verifică pe FIECARE articol și element
//    (inclusiv cel dinaintea parantezei: „1/2(34)” e cotă), iar ferestrele și plafonul de 8 cifre rămân pe tot subcâmpul / toată valoarea.
//    Formele cu CUVINTE („ABC 1234”, „AB_1234”, „A-ABCD”) și „#a/b#” cu a ≤ b rămân refuzate (decizie Răzvan, raportul rundei 5);
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
//
// VALORILE NESCHIMBATE DE LA IMPORT (decizia Răzvan 19.11.2026, varianta A): riscul de la care a pornit validatorul e operatorul care
// scrie MANUAL în Fișa parcelei un telefon / CNP / nume / cotă; valorile aduse de import din lista Transgaz nu sunt acest risc (pe LOT1
// fondul forestier „97#UP II <loc.>”, UA-urile „##UA 62VV”, codurile de lucrări „#HCN 949#”, topo-urile cu fracție „#1/2#”, listele
// „51384#1079/1,1079/1/1” etc. sunt identificatori reali refuzați de forma strictă). Regula, DOAR la tarla / nr_cadastral / poz_hg:
//  - o valoare IDENTICĂ (același șir, exact: majuscule, diacritice, spații) cu cea scrisă la INSERT-ul de import se publică așa cum e,
//    fără validatorul de formă, dar tot cu plafonul de lungime, fără caractere de control și fără „|”; forma publicată = aceeași
//    transformare ca pe calea strictă (majuscule, spații simple, fără spații lângă „#”, „##” → nimic);
//  - orice altă valoare (editată în Fișă, chiar și cu o singură cifră / literă mică schimbată; parcelă fără INSERT de import dovedit)
//    trece prin validatorul strict de mai sus, NESCHIMBAT; `sat` (satele declarate) și `tronson` (1..11) rămân neschimbate.
// Sursa „valorii de la import” = rândul INSERT din red_jurnal al parcelei (trg_red_jurnal: to_jsonb(NEW), append-only pentru rolurile
// aplicației), NU red_parcele.cheie_sursa: cheia e normalizată (majuscule, fără diacritice, punctuație repetată comprimată) și are
// GRANT UPDATE pentru authenticated (un admin / editor o poate rescrie prin API ca să „acopere” o valoare manuală); rândul de jurnal
// păstrează șirul brut și nu poate fi modificat de aplicație. INSERT-ul e „de import” doar dacă poartă o cheie_sursa EGALĂ cu cheia
// recalculată din valorile lui și din uat3-ul UAT-ului (importTgz.cheieSursa — exact ce scrie importul; Fișa nu inserează parcele).
// Limita (raportul PR-ului): un admin / editor care inserează DELIBERAT prin API o parcelă „ca la import” (cheie + valori fabricate) nu
// poate fi deosebit de import fără o coloană de proveniență setată de server (migrare propusă, neaplicată) — același risc acceptat la
// 20261130h (nr_crt_grup).
import { normalizeazaNume, faraDiacritice } from './idParcela.js'
import { tronsonOptional, text, cadastruGol, cheieSursa } from './importTgz.js'

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
// runda 5, DOAR nr_cadastral: prim simplu / dublu / triplu (același semn), liste „,” / „+” de articole, paranteze cu listă „,” de elemente
const PRIM_EXT = String.raw`(?:'{1,3}|’{1,3})?`
const PARTE_NUM_EXT = String.raw`[0-9]{1,6}${PRIM_EXT}(?:[A-Z]{1,3}| [A-Z]| BIS)?`
const PARTE_EXT = `(?:${PARTE_NUM_EXT}|${PARTE_COD})`
// un element din paranteze: corp numeric / cod, opțional cu 1–2 litere lipite de cifre în față („A12”; „ION” rămâne refuzat)
const ELEMENT_PARANTEZE = `(?:[A-Z]{1,2}(?=[0-9]))?${PARTE_EXT}(?:/${PARTE_EXT}){0,3}`
const ARTICOL_EXT = `${PARTE_NUM_EXT}(?:/${PARTE_EXT}){0,3}(?:\\(${ELEMENT_PARANTEZE}(?:,${ELEMENT_PARANTEZE}){0,3}\\))?`
const RE_SUBCAMP_LISTA = new RegExp(String.raw`^(?:(?:[A-Z]{1,2}|TARLA)[ .]?)?${ARTICOL_EXT}(?:[,+]${ARTICOL_EXT}){0,3}$`)
const areFormaSubcamp = (s, regula) => RE_COD.test(s) || RE_SUBCAMP_NUMERIC.test(s) || (regula.liste === true && RE_SUBCAMP_LISTA.test(s))
const RE_FARA_VALOARE = /^[-–—]$/
// „a/b” fără prefix de literă (primul ' / '' / ''' și sufixul de literă / BIS nu contează: „1/2A”, „1''/2” arată tot a cotă): cotă dacă
// a ≤ b; se aplică FIECĂREI bucăți dintre „(”, „)”, „,”, „+” (articolele unei liste, elementele din paranteze, articolul dinaintea
// parantezei). Un prefix explicit („T1/2”, „CF 1/2”, „(A1/2)”) arată că e un identificator, nu o cotă.
const SUFIX_FRACTIE = String.raw`(?:'{1,3}|’{1,3})?(?:[A-Z]{1,3}| [A-Z]| BIS)?`
const RE_FRACTIE = new RegExp(String.raw`^([0-9]+)${SUFIX_FRACTIE}/([0-9]+)${SUFIX_FRACTIE}$`)
const RE_SEPARATOR_BUCATI = /[(),+]/
// componente consecutive lipite: telefon RO (0[237] + 8 cifre), internațional (+40 / 0040 / 40 + 9 cifre), CNP (orice 13 cifre)
const RE_TELEFON_SAU_CNP = /^(?:0[237][0-9]{8}|(?:00)?40[0-9]{9}|[0-9]{13})$/   // CNP: ORICE 13 cifre, și cu 0 inițial (decizia Răzvan 19.11.2026, varianta A)
/** Cea mai lungă formă căutată (CNP / 0040 + 9 cifre): o fereastră mai lungă nu se mai potrivește. */
const MAX_CIFRE_FEREASTRA = 13
// numele unui sat (segment din „Sate / tarlale ziua N”, normalizat): litere, spații, cratimă, apostrof, punct; fără cifre; 2–40 de caractere
const RE_NUME_SAT = /^[A-Z][A-Z '.\-]{1,39}$/
// segmente din „Sate / tarlale ziua N” care NU sunt sate (indicații de program)
const RE_SEGMENT_FARA_SAT = /^(?:TARLA|TARLALE|TARLAUA|RESTUL|REST|TOATE|TOT|CELELALTE|ALTE|ALTELE)\b/
const RE_PREFIX_SAT = /^(?:SAT(?:UL)?|LOC(?:ALITATEA)?)\.? /
const RE_PREFIX_SAT_ORIGINAL = /^(?:sat(?:ul)?|loc(?:alitatea)?)\.? /i

/** Regula pe câmp: compus cu „#” (TGZ) / „/” permis / cifră obligatorie / cifre maxime pe subcâmp (cele mai lungi forme reale + marjă). */
const REGULA_CAMP = Object.freeze({
  tarla: { compus: true, slash: true, cifraObligatorie: false, maxCifre: 6 },
  nr_cadastral: { compus: true, slash: true, cifraObligatorie: false, maxCifre: MAX_CIFRE_SUBCAMP, liste: true },
  poz_hg: { compus: false, slash: false, cifraObligatorie: true, maxCifre: 5 },
})

/** Câmpurile la care o valoare IDENTICĂ cu cea de la import se publică fără validatorul de formă (varianta A, 19.11.2026). */
export const CAMPURI_DIN_IMPORT = Object.freeze(['tarla', 'nr_cadastral', 'poz_hg'])
// caractere de control / de formatare (inclusiv cele invizibile: zero-width, bidi, BOM) — refuzate și pe calea „de la import”
const RE_CONTROL = /[\p{Cc}\p{Cf}]/u
const RE_UAT3 = /^[A-Z]{3}$/

/** Valorile unui rând INSERT din jurnal, dacă e un INSERT DE IMPORT dovedit (cheie_sursa = cheia recalculată), altfel null. */
function valoriInsertImport(r, id, uat3) {
  if (r.tabela !== 'red_parcele' || r.actiune !== 'insert') return null
  const d = r.date_noi
  if (!d || typeof d !== 'object' || Array.isArray(d) || typeof d.id !== 'string' || d.id.toLowerCase() !== id) return null
  const valori = {}
  for (const camp of CAMPURI_DIN_IMPORT) {
    const x = d[camp] ?? null
    if (x !== null && typeof x !== 'string') return null
    if (x !== null && x.includes('|')) return null   // separatorul cheii chiar în valoare: cheia nu mai dovedește câmpurile → strict
    valori[camp] = x
  }
  if (typeof d.cheie_sursa !== 'string' || d.cheie_sursa === '') return null   // fără cheie = nu e import (importul nu comite fără cheie)
  if (d.cheie_sursa !== cheieSursa(uat3, valori.poz_hg, valori.nr_cadastral, valori.tarla)) return null
  return Object.freeze(valori)
}

/**
 * Valorile DE LA IMPORT ale parcelelor: Map(id parcelă, minuscule → { tarla, nr_cadastral, poz_hg }) din rândurile red_jurnal
 * (tabela red_parcele, actiune insert; coloanele id, tabela, actiune, inregistrare_id, date_noi). Intră DOAR parcelele cu exact un
 * INSERT, de import dovedit (vezi valoriInsertImport); celelalte lipsesc din Map → validare strictă. `uat3` = codul UAT-ului (3 litere).
 */
export function valoriImportDinJurnal(randuri = [], uat3) {
  if (typeof uat3 !== 'string' || !RE_UAT3.test(uat3)) return new Map()
  const peParcela = new Map()   // id → valori | null (null = nedovedit sau mai multe INSERT-uri)
  for (const r of Array.isArray(randuri) ? randuri : []) {
    if (!r || typeof r.inregistrare_id !== 'string' || !r.inregistrare_id) continue
    const id = r.inregistrare_id.toLowerCase()
    peParcela.set(id, peParcela.has(id) ? null : valoriInsertImport(r, id, uat3))
  }
  return new Map([...peParcela].filter(([, v]) => v !== null))
}

/** true = `valoare` e EXACT șirul scris la INSERT-ul de import (`laImport` = obiectul din valoriImportDinJurnal), fără control / „|”. */
function identicaCuImportul(camp, valoare, laImport) {
  if (!CAMPURI_DIN_IMPORT.includes(camp) || !laImport || typeof laImport !== 'object' || !Object.hasOwn(laImport, camp)) return false
  if (typeof valoare !== 'string' || RE_CONTROL.test(valoare) || valoare.includes('|')) return false
  const valoareImport = laImport[camp]
  return typeof valoareImport === 'string' && valoare === valoareImport
}

/** Normalizarea folosită la compararea SATULUI cu lista declarată (majuscule, fără diacritice, spații simple — ca la cheia de import). */
export const normalizeazaIdentificator = v => normalizeazaNume(v)

const ok = valoare => ({ ok: true, valoare })
const refuz = motiv => ({ ok: false, motiv })
const cifre = s => s.replace(/[^0-9]/g, '')
const pareCota = s => s.split(RE_SEPARATOR_BUCATI).some(t => {
  const m = RE_FRACTIE.exec(t)
  return m !== null && Number(m[1]) <= Number(m[2])
})

/** Componentele numerice ale valorii: grupurile maximale de cifre, în ordine („0711#111111#UA62A” → [0711, 111111, 62]). */
export const componenteNumerice = s => String(s ?? '').match(/[0-9]+/g) ?? []
/**
 * Toate lipirile de componente CONSECUTIVE (ferestre [i..j], granițele păstrate: niciun grup nu se taie), până la 13 cifre:
 * [0711, 111111, 62] → 0711, 0711111111, 071111111162, 111111, 11111162, 62.
 */
export function ferestreConsecutive(componente) {
  const ferestre = []
  for (let i = 0; i < componente.length; i++) {
    let lipit = ''
    for (let j = i; j < componente.length && lipit.length < MAX_CIFRE_FEREASTRA; j++) {
      lipit += componente[j]
      if (lipit.length <= MAX_CIFRE_FEREASTRA) ferestre.push(lipit)
    }
  }
  return ferestre
}
/** true = o fereastră de componente consecutive are forma unui telefon (0 / 40 / 0040) sau 13 cifre (CNP). */
const areTelefonSauCnp = s => ferestreConsecutive(componenteNumerice(s)).some(f => RE_TELEFON_SAU_CNP.test(f))

/** Motivul refuzului unui identificator TEXT (tarla / nr_cadastral / poz_hg) în forma canonică `canon`, sau null dacă are forma câmpului. */
function motivIdentificatorText(canon, regula) {
  if (!regula.compus && canon.includes('#')) return MOTIV.FORMA
  const subcampuri = regula.compus ? canon.split('#') : [canon]
  for (const s of subcampuri) {
    if (s === '' || RE_FARA_VALOARE.test(s)) continue
    const c = cifre(s)
    if (c.length > MAX_CIFRE_SUBCAMP) return MOTIV.TELEFON_CNP
    if (c.length > regula.maxCifre) return MOTIV.FORMA
    if (regula.cifraObligatorie && !c) return MOTIV.FORMA
    if (pareCota(s)) return MOTIV.COTA
    if (!regula.slash && s.includes('/')) return MOTIV.FORMA
    if (!areFormaSubcamp(s, regula)) return MOTIV.FORMA
  }
  // după forma fiecărui subcâmp: telefonul / CNP-ul împărțit pe componente consecutive (oriunde în valoare, nu doar toată valoarea)
  if (areTelefonSauCnp(canon)) return MOTIV.TELEFON_CNP
  return null
}

/**
 * Motivul pentru care ORTOGRAFIA unui sat (reprezentarea care se publică) nu se poate publica, sau null. Review r3 P2: se validase doar
 * cheia normalizată („Peri” + 50 de „.” → cheia „PERI.”), iar pe afiș ajungea șirul declarat, de 54 de caractere. Acum reprezentarea
 * însăși: cel mult 40 de caractere (LUNGIME) și, fără diacritice / cu majuscule, EXACT cheia ei (deci fără punctuație repetată, spații
 * duble sau la capete), cu forma unui nume de sat (FORMA).
 */
export function motivFormaSatPublicat(forma) {
  if (typeof forma !== 'string') return MOTIV.FORMA
  if (forma.length > LUNGIME_MAX_IDENTIFICATOR) return MOTIV.LUNGIME
  const cheie = normalizeazaIdentificator(forma)
  return faraDiacritice(forma).toUpperCase() === cheie && RE_NUME_SAT.test(cheie) ? null : MOTIV.FORMA
}

/**
 * Satele DECLARATE ale UAT-ului: Map(normalizat → ortografia declarată), din segmentele sate_zi1..3 (despărțite de „,” / „;” / „ și ” /
 * „ – ”, fără parantezele cu tarlale) care au forma unui nume de sat; „Satul X” intră și ca „X”. Indicațiile de program („tarlalele 1–5”,
 * „restul”) nu sunt sate. O ortografie care nu se poate publica (motivFormaSatPublicat: „Peri.....”, peste 40 de caractere) nu intră.
 * Prima ortografie declarată a unui sat câștigă.
 */
export function sateDeclarate(uat = {}) {
  const sate = new Map()
  for (const i of [1, 2, 3]) {
    for (const seg of String(uat?.[`sate_zi${i}`] ?? '').replace(/\([^)]*\)/g, ' ').split(/[,;]|\s+[sș]i\s+|\s+[–—-]\s+/i)) {
      const declarat = text(seg)
      const n = normalizeazaIdentificator(declarat)
      if (!n || /[0-9]/.test(n) || RE_SEGMENT_FARA_SAT.test(n)) continue
      for (const [cheie, forma] of [[n, declarat], [n.replace(RE_PREFIX_SAT, ''), declarat.replace(RE_PREFIX_SAT_ORIGINAL, '')]]) {
        if (RE_NUME_SAT.test(cheie) && !sate.has(cheie) && motivFormaSatPublicat(forma) === null) sate.set(cheie, forma)
      }
    }
  }
  return sate
}

/**
 * Forma CANONICĂ a unei valori publicate: { ok: true, valoare } (valoarea EXACT așa cum se publică; '' = nimic) sau { ok: false, motiv }.
 * Pentru `sat` cere `ctx.sate` (Map din sateDeclarate) sau `ctx.uat`. Nu întoarce niciodată valoarea refuzată.
 * `ctx.import` = valorile de la import ale parcelei (un element din valoriImportDinJurnal): la tarla / nr_cadastral / poz_hg, o valoare
 * IDENTICĂ cu ele se publică fără validatorul de formă ({ ok: true, valoare, din_import: true }); orice altă valoare = calea strictă.
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
      // varianta A (19.11.2026): EXACT valoarea de la import → se publică fără validatorul de formă (plafonul de lungime e aplicat mai sus)
      if (identicaCuImportul(camp, valoare, ctx.import)) return { ok: true, valoare: regula.compus && cadastruGol(sir) ? '' : sir, din_import: true }
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
      if (declarat === undefined) return refuz(MOTIV.SAT_NEDECLARAT)
      // se verifică și reprezentarea RETURNATĂ (ce se publică), nu doar cheia: și pentru o listă `ctx.sate` construită de apelant
      const motivReturnat = motivFormaSatPublicat(declarat)
      return motivReturnat ? refuz(motivReturnat) : ok(declarat)
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
 * `campuri` = lista albă a coloanelor publicate; `uat` dă satele declarate; `valoriImport` = Map din valoriImportDinJurnal (cheia = `p.id`,
 * minuscule; lipsă / altceva decât Map = nicio valoare de import, totul pe calea strictă).
 */
export function canonizeazaParcelePublicate(parcele = [], campuri = [], uat = {}, valoriImport = null) {
  const sate = sateDeclarate(uat)
  const importuri = valoriImport instanceof Map ? valoriImport : null
  const probleme = []
  const randuri = []
  for (const p of parcele) {
    if (!p) continue
    const rand = { id_parcela: String(p.id_parcela ?? '?') }
    const laImport = importuri && typeof p.id === 'string' ? importuri.get(p.id.toLowerCase()) : undefined
    for (const camp of campuri) {
      const r = canonizeazaIdentificator(camp, p[camp], { sate, import: laImport })
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
