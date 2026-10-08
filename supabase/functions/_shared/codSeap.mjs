// codSeap.mjs — codul SEAP (`noticeDocumentCode`, ex. „CN1095546/00036”) ca IDENTITATE a documentelor din lista principală
// a anunțului (GetDfNoticeSectionFiles). Audit motor import #4, varianta B (Răzvan, 08.10.2026). Folosit de edge
// ofertare-seap-import (decide + scrie), edge ofertare-seap-veghe (doar decide; nu scrie coduri) și, în PR-2, de workerul NAS.
// Fără importuri (ca identitateFisier.mjs / paginat.mjs): cheile de nume și clientul BD le dă apelantul.
//
// De ce: dedup-ul pe NUME de dinainte de descărcare sărea în tăcere o republicare sub același nume (anti-bug Răcari 16.09:
// „Caiet de sarcini revizuit” = alt cod, același nume de fișier). Veghea folosea deja codul pe canalul de clarificări (GetAll);
// acum și lista principală. Sonda SEAP (08.10, 6 licitații × 2 apeluri): codurile sunt stabile între apeluri, fiecare document
// are cod, iar la o republicare SEAP scoate codul vechi din listă (numerotarea are goluri).
//
// Regulile (tabelul de decizie din docs/ofertare/AUDIT_MOTOR_IMPORT_2026-10-07.md, #4):
//   - fără cod → regula pe nume de azi, neschimbată (`fara_cod`);
//   - codul e deja pe un rând real → sărit fără descărcare, oricare ar fi numele;
//   - nimic cu numele lui → document nou, scris cu codul;
//   - rândul cu același nume are un cod VECHI care a ieșit din listă (același prefix, număr mai mic) → VERSIUNE nouă
//     (decizia S = B): `aparut_ulterior`, `seap_meta.inlocuieste` (insigna ♻ din Clarificări), tipul moștenit;
//   - rând vechi fără cod, unic și fără coduri concurente pe nume → codul se ADOPTĂ pe el, fără descărcare (decizia L1 = A);
//   - nume cu ≥2 coduri în listă sau ≥2 rânduri vechi fără cod → NICIODATĂ adopție pe nume, ci dovadă de conținut (sha256;
//     decizia 4 = A, lic. 100: două documente cu numele identic și un singur rând — al doilea se pierdea în tăcere);
//   - altfel → FRATE (alt document cu același nume), adus sub nume distinct.
// Completări după review-ul diff-ului PR-1 (08.10):
//   - semnătura „X.pdf.p7s” a unui document „X.pdf” listat și el nu e alt document (echivalența .p7s ≡ document de azi) →
//     sărită; codul ei contează însă ca rival pe numele documentului (adopția cere atunci dovadă de conținut, în orice ordine);
//   - un rând real FĂRĂ cod sub numele cu cod („N (COD).ext” — placeholder completat de mână) e chiar documentul → adopție;
//   - rândurile scrise sub „N (COD).ext” (versiuni / frați) rămân legate de numele N (linia lor): o nouă republicare înlocuiește
//     ultima versiune, iar republicarea unui frate e o versiune, nu alt frate tăcut;
//   - rândurile canalului de clarificări (veghea GetAll: `seap_meta.publicat`) NU pot fi „înlocuite” de un document din lista
//     principală (codurile lor nu sunt niciodată în ea) — altfel o versiune falsă + mail;
//   - siguranța „coduri instabile” nu mai sare la o republicare integrală legitimă (același prefix, numere mai mari);
//   - o „versiune” cu EXACT conținutul rândului înlocuit (republicat identic sub cod nou, F5) nu e versiune: importul mută codul
//     pe rândul înlocuit (`mutaCod`), fără upload și fără anunț; sha-ul înlocuitului necunoscut → versiune, ca înainte.
//     Îngustat (D1, `mutaPeIdentic`): doar pe un rând FĂRĂ nume de cod și fără placeholder pe N2 — altfel versiune, ca înainte.
//     R2 (r4): cu mai mulți înlocuiți posibili (frați cu același nume, republicați integral identic), decideSeap îi dă pe toți
//     (`inlocuiti`, numărul cel mai mare primul; `inlocuit` = primul, ca înainte) și importul caută conținutul identic pe FIECARE
//     candidat mutabil (`candidatiMutare`): codul se mută pe primul identic, iar un rând e ținta unei singure mutări pe rulare.
//     E1 (r5): ținta e doar capul liniei — un original cu o versiune / un frate cu nume de cod MAI NOU nu mai primește codul
//     (revenirea la un conținut vechi se anunță ca versiune, nu se mută în tăcere).
// Versiunea și fratele primesc numele `numeVersiune` („Caiet de sarcini (CN1095546-00036).pdf”, decizia N = A), hotărât pe
// numele SEAP BRUT, înainte de desfacerea semnăturii: placeholder-ul veghei, calea din Storage, cheia de manifest, marcarea
// după nume și desfacerea .p7m/.p7s dau același nume pe toate drumurile, fără gemeni cu numele vechi.
// Codul NU se propagă de la o arhivă la copiii ei (regula din worker/ofertare/seap.ts, bucla de platformă: 159 de copii
// respinși de indexul unic pe 05.10). Un cod stă doar pe rândul ai cărui octeți SUNT documentul SEAP listat.
// Indexul unic parțial ofertare_doc_seap_cod_unic (licitatie_id, seap_cod): o violare = „deja prezent” (alt drum a scris între timp).

export const INDEX_COD_UNIC = 'ofertare_doc_seap_cod_unic'
/** Cum primesc codul rândurile vechi (fără cod): 'nume' (L1 = A, Răzvan 08.10), 'sha' (doar cu dovadă de conținut), 'niciuna'. */
export const ADOPTIE = 'nume'

/** @typedef {{ id: number | null, nume_original: string, fisier_path?: string | null, seap_cod?: string | null, tip?: string | null,
 *    size_bytes?: number | null, getAll?: boolean, dinRulare?: boolean, inlocuieste_id?: number | null, cod_anterior?: string | null }} Rand
 *  @typedef {{ coduri: Map<string, Rand>, peCheie: Map<string, Rand[]>, peId: Map<number, Rand>, copii: Set<number>, decise: Set<string>,
 *    instabile: boolean, cheieRand: (nume: string) => string, cheiSeap: (nume: string) => string[],
 *    inlocuite?: Set<number>, coduriInlocuite?: Set<string> }} Inv
 *  @typedef {{ toate: Set<string>, peCheie: Map<string, Set<string>>, simple: Set<string> }} Lista */

/** Codul unei intrări SEAP („” = fără cod). @param {any} item */
export const codDin = (item) => String(item?.noticeDocumentCode ?? '').trim()

/** „CN1095546/00036” → { prefix: 'CN1095546', nr: 36 }; altfel null. @param {string | null | undefined} cod */
export function ordineCod(cod) {
  const m = /^(.+)\/(\d+)$/.exec(String(cod ?? '').trim())
  return m ? { prefix: m[1], nr: Number(m[2]) } : null
}

/** Numele determinist al unei versiuni / al unui frate, pe numele SEAP BRUT: codul (fără „/”) înaintea extensiei, care rămâne
 *  ultima (cu .p7m/.p7s și numărul de la coadă pus de SEAP): „Caiet.pdf” → „Caiet (CN1-00036).pdf”, „X.pdf.p7m” → „X (C).pdf.p7m”.
 *  @param {string} numeSeap @param {string} cod @returns {string} */
const codInNume = (cod) => String(cod ?? '').trim().replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
export function numeVersiune(numeSeap, cod) {
  const n = String(numeSeap ?? '')
  const c = codInNume(cod)
  if (!c) return n
  const m = /^(.*?)(\.[a-z0-9]{1,6}(?:\.p7[ms])?(?: *\d+)?)$/i.exec(n)
  return m && m[1].trim() ? `${m[1].trimEnd()} (${c})${m[2]}` : `${n} (${c})`
}

/** Inversul lui numeVersiune pe numele unui RÂND care poartă codul: „Caiet (CN1-00036).pdf” + CN1/00036 → „Caiet.pdf”
 *  (și „X (C) (semnat).pdf” → „X (semnat).pdf”, după desfacere). null dacă numele nu conține codul. Leagă versiunile / frații
 *  de numele SEAP N, ca o republicare ulterioară să-i găsească. @param {string} nume @param {string} cod @returns {string | null} */
export function numeBaza(nume, cod) {
  const n = String(nume ?? ''), c = codInNume(cod)
  if (!c) return null
  const t = ` (${c})`, i = n.lastIndexOf(t)
  return i > 0 ? n.slice(0, i) + n.slice(i + t.length) : null
}

/** Rândul vine din canalul de clarificări al veghei (NoticeDocument/GetAll): veghea scrie mereu `seap_meta.publicat`, iar
 *  workerul îl păstrează când desface semnătura pe loc (calea iese atunci din „/raspunsuri/”). @param {any} r */
export const eGetAll = (r) => !!(r?.seap_meta && typeof r.seap_meta === 'object' && 'publicat' in r.seap_meta) ||
  String(r?.fisier_path ?? '').includes('/raspunsuri/')

/** Volum dintr-un set RAR („X.part2.rar[.p7m]”): nu se versionează (un cod pe volum ar rupe setul). @param {string} nume */
export const esteVolumRar = (nume) => /\.part\d+[^./\\]*\.rar(\.p7[ms])?$/i.test(String(nume ?? ''))

const RE_P7S = /\.p7s$/i
const eReal = (r) => !!r?.fisier_path && !String(r.fisier_path).includes('/neincarcat/')
const codRand = (r) => (r?.seap_cod == null ? '' : String(r.seap_cod).trim())

/** Id-urile rândurilor DOVEDITE ca extrase dintr-o arhivă: „/” în nume, sau un rând de manifest 'urcat' al lor cu altă cheie de
 *  arhivă decât propriul nume (nivelul de sus: arhiva_cheie = lower(cale) sau 'seap:downloadarchive').
 *  @param {Array<{ stare?: string, document_id?: number | null, arhiva_cheie?: string, cale?: string }> | null | undefined} manifest
 *  @param {Array<{ id: number, nume_original?: string }> | null | undefined} randuri @returns {Set<number>} */
export function copiiDinManifest(manifest, randuri) {
  const ids = new Set()
  for (const r of randuri ?? []) if (String(r?.nume_original ?? '').includes('/')) ids.add(r.id)
  for (const m of manifest ?? []) {
    if (m?.stare !== 'urcat' || m.document_id == null) continue
    const ac = String(m.arhiva_cheie ?? '')
    if (ac !== 'seap:downloadarchive' && ac !== String(m.cale ?? '').toLowerCase()) ids.add(m.document_id)
  }
  return ids
}

/** Înregistrează un rând în inventar (cheie + cod). Rândurile scrise / planificate în rularea curentă vin cu dinRulare: true.
 *  Un rând cu cod scris sub „N (COD).ext” se înregistrează și pe cheia lui N (linia versiunilor / fraților).
 *  @param {Inv} inv @param {Rand} rand */
export function adaugaRand(inv, rand) {
  const c = codRand(rand)
  const chei = new Set([inv.cheieRand(rand.nume_original)])
  const baza = c ? numeBaza(rand.nume_original, c) : null
  if (baza) chei.add(inv.cheieRand(baza))
  for (const k of chei) inv.peCheie.set(k, [...(inv.peCheie.get(k) ?? []), rand])
  if (c && !inv.coduri.has(c)) inv.coduri.set(c, rand)
  if (rand.id != null) inv.peId.set(rand.id, rand)
  // Jakarinos r7: rândul pe care l-a înlocuit această versiune nu mai e cap de linie (vezi decideSeap)
  if (rand.inlocuieste_id != null) inv.inlocuite?.add(rand.inlocuieste_id)
  if (rand.cod_anterior) inv.coduriInlocuite?.add(String(rand.cod_anterior).trim())
}

/** Inventarul pentru decizie: DOAR rândurile reale (cu fișier, fără placeholder-e — aceeași mulțime ca `urcate`).
 *  `cheiSeap` = cheile sub care un nume SEAP poate exista ca rând (ca apelantul); implicit doar cheieRand.
 *  @param {Array<Rand & { seap_meta?: any }> | null | undefined} randuri
 *  @param {{ cheieRand: (n: string) => string, cheiSeap?: (n: string) => string[], copii?: Set<number> }} o @returns {Inv} */
export function inventarCod(randuri, { cheieRand, cheiSeap = (n) => [cheieRand(n)], copii = new Set() }) {
  const inv = { coduri: new Map(), peCheie: new Map(), peId: new Map(), copii, decise: new Set(), instabile: false, cheieRand, cheiSeap,
    inlocuite: new Set(), coduriInlocuite: new Set() }
  for (const r of randuri ?? []) {
    if (!eReal(r)) continue
    adaugaRand(inv, { id: r.id, nume_original: r.nume_original, fisier_path: r.fisier_path, seap_cod: codRand(r) || null,
      tip: r.tip ?? null, size_bytes: r.size_bytes ?? null, getAll: eGetAll(r),
      inlocuieste_id: r.seap_meta?.inlocuieste_id ?? null, cod_anterior: r.seap_meta?.cod_anterior ?? null })
  }
  return inv
}

/** Lista SEAP COMPLETĂ a acestui apel (nu felia de la de_la_index): toate codurile + codurile pe FIECARE cheie de nume a
 *  documentului (`chei` = cheiSeap al apelantului: „X.pdf.p7s” stă și pe „x.pdf”, deci e rival cu „X.pdf” în ambele ordini) +
 *  cheile documentelor nesemnate .p7s (`simple`: o semnătură „X.pdf.p7s” cu „X.pdf” listat alături e doar semnătura lui).
 *  @param {Array<{ nume: string, cod?: string }>} docs @param {(n: string) => string | string[]} chei @returns {Lista} */
export function indexLista(docs, chei) {
  const toate = new Set(), peCheie = new Map(), simple = new Set()
  for (const d of docs ?? []) {
    const ks = [].concat(chei(d.nume))
    if (!RE_P7S.test(String(d?.nume ?? ''))) for (const k of ks) simple.add(k)
    const c = String(d?.cod ?? '').trim()
    if (!c) continue
    toate.add(c)
    for (const k of ks) peCheie.set(k, new Set([...(peCheie.get(k) ?? []), c]))
  }
  return { toate, peCheie, simple }
}

/** Siguranța: dacă NICIUN cod listat nu e cunoscut, dar ≥3 documente cu cod nimeresc pe nume rânduri cu coduri ieșite din listă
 *  care NU arată a republicare (alt prefix, cod neparsabil sau număr mai mare decât cel nou), codurile par schimbate între apeluri
 *  → regula pe nume de azi (apelantul pune inv.instabile, erori, nerecuperate). O republicare integrală legitimă (același prefix,
 *  numere mai mari — decizia S = B) NU declanșează: e exact cazul pe care codul trebuie să-l prindă (review PR-1). Rândurile
 *  canalului de clarificări (veghea GetAll) nu contează: codurile lor nu sunt în lista principală, legitim.
 *  @param {Inv} inv @param {Lista} lista @param {Array<{ nume: string, cod?: string }>} docs @param {(n: string) => string[]} cheiSeap
 *  @returns {string | null} motivul, sau null */
export function coduriInstabile(inv, lista, docs, cheiSeap) {
  const cuCod = (docs ?? []).filter((d) => String(d?.cod ?? '').trim())
  if (cuCod.length < 3 || cuCod.some((d) => inv.coduri.has(String(d.cod).trim()))) return null
  const lovit = (d) => {
    const od = ordineCod(d.cod)
    return cheiSeap(d.nume).some((k) => (inv.peCheie.get(k) ?? []).some((r) => {
      const c = codRand(r)
      if (!c || r.getAll || lista.toate.has(c)) return false
      const or = ordineCod(c)
      return !(od && or && or.prefix === od.prefix && or.nr < od.nr)
    }))
  }
  const n = cuCod.filter(lovit).length
  return n >= 3 ? `coduri SEAP instabile: niciun cod listat nu e cunoscut, dar ${n} documente au pe nume rânduri cu coduri ieșite din listă, fără model de republicare — regula veche pe nume, documentația nu se declară adusă` : null
}

/** Decizia pentru un document din lista SEAP, ÎNAINTE de descărcare. Pură; apelantul face apoi inv.decise.add(cod).
 *  `chei` = cheiSeap(doc.nume) al apelantului (cheile rândurilor sub care documentul poate exista deja).
 *  Întoarce: { fel: 'fara_cod' } | { fel: 'sari', motiv: 'dublu' | 'cod' | 'semnatura' | 'volum' | 'nume', rand? } | { fel: 'nou', nume }
 *    | { fel: 'versiune', nume, inlocuit, inlocuiti } | { fel: 'adopta', motiv?: 'nume_cod', rand } | { fel: 'frate', nume, rude }
 *    | { fel: 'verifica', motiv: 'ambiguu' | 'sha' | 'copil', nume, candidati, dupa }.
 *  @param {Inv} inv @param {Lista} lista @param {{ nume: string, cod?: string }} doc @param {string[]} chei
 *  @param {{ adoptie?: string }} [o] */
export function decideSeap(inv, lista, doc, chei, { adoptie = ADOPTIE } = {}) {
  const cod = String(doc?.cod ?? '').trim()
  if (!cod || inv.instabile) return { fel: 'fara_cod' }
  if (inv.decise.has(cod)) return { fel: 'sari', motiv: 'dublu' }
  const deja = inv.coduri.get(cod)
  if (deja) return { fel: 'sari', motiv: 'cod', rand: deja }
  // semnătura „X.pdf.p7s” a unui „X.pdf” listat ȘI el: doar semnătura lui, nu alt document (azi o sărea regula pe nume) — fără
  // rând nou, fără descărcare. Codul ei rămâne rival pe „x.pdf” (indexLista), deci adopția documentului cere dovadă.
  if (RE_P7S.test(String(doc.nume ?? '')) && chei.some((k) => !RE_P7S.test(k) && lista.simple?.has(k))) return { fel: 'sari', motiv: 'semnatura' }
  const N2 = numeVersiune(doc.nume, cod)
  // un rând real FĂRĂ cod sub numele cu cod („N (COD).ext”: placeholder-ul veghei completat de mână, urcat sub numele exact) e
  // chiar documentul ăsta — numele poartă codul, deci adopția e fără echivoc (altfel: versiune / frate la nesfârșit + dublură)
  const peN2 = [...new Set(inv.cheiSeap(N2).flatMap((k) => inv.peCheie.get(k) ?? []))]
    .filter((r) => !codRand(r) && !r.dinRulare && !inv.copii.has(r.id))
  if (peN2.length) return { fel: 'adopta', motiv: 'nume_cod', rand: peN2[0] }
  const pot = [...new Set(chei.flatMap((k) => inv.peCheie.get(k) ?? []))]
  if (!pot.length) return { fel: 'nou', nume: doc.nume }
  const volum = esteVolumRar(doc.nume)
  // versiune: codul vechi a ieșit din listă, același prefix, număr mai mic (S = B). Un cod cu număr MAI MARE (o revizie adusă
  // de veghe din GetAll) nu face din originalul listat o „versiune nouă” (act contestabil fals). Rândurile GetAll nu se
  // „înlocuiesc” deloc: codurile lor nu sunt niciodată în lista principală, deci condiția „a ieșit din listă” nu spune nimic.
  // Linia versiunilor (adaugaRand): la a doua republicare, înlocuitul e ultima versiune (numărul cel mai mare).
  // R2 (r4): toți candidații rămân în `inlocuiti` (aceeași ordine) — F5 din import caută conținutul identic pe fiecare.
  // Jakarinos r7 (P1): doar CAPETELE liniilor de versiuni pot fi înlocuite — un rând deja înlocuit de o versiune din platformă
  // (seap_meta.inlocuieste_id / cod_anterior pe alt rând) nu mai justifică o înlocuire. „Caiet.pdf” /10 → „Caiet (…00020).pdf”
  // /20 (încă listată) + /30 nou cu același nume = FRATE, nu versiune a lui /10.
  // `linie` = toți candidații de dinainte de excludere: E1 (candidatiMutare) judecă pe ei capul liniei pentru mutarea tăcută.
  const inlocuitDeja = (r) => (r.id != null && !!inv.inlocuite?.has(r.id)) || !!inv.coduriInlocuite?.has(codRand(r))
  const o = ordineCod(cod)
  const linie = o ? pot.filter((r) => {
    const c = codRand(r), or = c && !r.getAll && !lista.toate.has(c) ? ordineCod(c) : null
    return !!or && or.prefix === o.prefix && or.nr < o.nr
  }).sort((a, b) => ordineCod(codRand(b)).nr - ordineCod(codRand(a)).nr) : []
  const inloc = linie.filter((r) => !inlocuitDeja(r))
  if (inloc.length) return volum ? { fel: 'sari', motiv: 'volum' } : { fel: 'versiune', nume: N2, inlocuit: inloc[0], inlocuiti: inloc, linie }
  const frate = volum ? { fel: 'sari', motiv: 'volum' } : { fel: 'frate', nume: N2, rude: pot.map((r) => r.id).filter((id) => id != null) }
  const libere = pot.filter((r) => !codRand(r) && !r.dinRulare && !inv.copii.has(r.id))
  if (libere.length) {
    if (adoptie === 'niciuna') return { fel: 'sari', motiv: 'nume' }
    if (adoptie === 'sha') return { fel: 'verifica', motiv: 'sha', nume: N2, candidati: libere, dupa: frate }
    // 4 = A: pe nume doar când e fără echivoc — un singur rând și un singur cod pe TOATE cheile în joc (ale documentului, cu
    // echivalența .p7s ≡ document, și ale rândului), indiferent de ordinea din listă
    const coduri = new Set([cod])
    for (const k of [...chei, ...libere.map((r) => inv.cheieRand(r.nume_original))]) for (const c of lista.peCheie.get(k) ?? []) coduri.add(c)
    if (libere.length === 1 && coduri.size === 1) return { fel: 'adopta', rand: libere[0] }
    return { fel: 'verifica', motiv: 'ambiguu', nume: N2, candidati: libere, dupa: frate }
  }
  if (volum) return frate
  // copii de arhivă / rânduri din rularea asta, fără cod: același conținut dovedit → codul pe acel rând; altfel frate
  const neadopt = pot.filter((r) => !codRand(r))
  return neadopt.length ? { fel: 'verifica', motiv: 'copil', nume: N2, candidati: neadopt, dupa: frate } : frate
}

/** Verificarea pe conținut are șanse, ÎNAINTE de descărcare: măcar un candidat are sha dovedit (`areDovada`) sau mărimea
 *  cunoscută (aceeași mărime → se citește din Storage; altă mărime = alt conținut, dovedit fără citire). Un candidat fără mărime
 *  nu se descarcă (memoria edge-ului). Fals → apelantul raportează identitatea NEVERIFICATĂ (fail-closed, Copilot r1 pe #652),
 *  nu „rămâne pe nume / există deja”. La copii ('copil') nepotrivirea duce la frate, deci se descarcă oricum.
 *  @param {any} dec @param {(r: Rand) => boolean} areDovada @returns {boolean} */
export function verificabil(dec, areDovada) {
  if (dec?.fel !== 'verifica' || dec.motiv === 'copil') return true
  return (dec.candidati ?? []).some((r) => areDovada(r) || Number(r.size_bytes) > 0)
}

/** Sha-ul „altă mărime” al unui candidat: octeții diferă dovedit (fără citire), dar nu e un sha256 — nu se potrivește niciodată. */
export const ALT_CONTINUT = 'marime-diferita'

/** Rezultatul unei verificări pe conținut. `sha` = sha256 al documentului listat (sau lista: desfăcut + brut); `shaCand` = sha-ul
 *  fiecărui candidat (id → sha | null = necunoscut). Potrivire → { fel: 'adopta', rand }. Fără potrivire: la copii ('copil')
 *  → dec.dupa (frate); la rânduri vechi ('ambiguu' / 'sha') → dec.dupa doar dacă TOȚI candidații au sha (nepotrivire dovedită),
 *  altfel { fel: 'sari', motiv: 'ambiguu' } — rămâne regula pe nume, nu se ghicește.
 *  @param {any} dec @param {string | string[]} sha @param {Map<number, string | null | undefined>} shaCand */
export function rezolvaVerificare(dec, sha, shaCand) {
  const shas = new Set((Array.isArray(sha) ? sha : [sha]).filter(Boolean))
  const rand = dec.candidati.find((r) => shas.has(shaCand.get(r.id)))
  if (rand) return { fel: 'adopta', rand }
  if (dec.motiv !== 'copil' && dec.candidati.some((r) => !shaCand.get(r.id))) return { fel: 'sari', motiv: 'ambiguu' }
  return dec.dupa
}

/** Tipul moștenit de o versiune nouă de la documentul înlocuit: niciodată pe o arhivă (container → 'alta'), și nu 'alta' /
 *  'raspuns_clarificare' / lipsă (atunci decide clasificatorul pe nume). @param {string | null | undefined} tipVechi @param {boolean} esteArhiva */
export function tipMostenit(tipVechi, esteArhiva) {
  if (esteArhiva || !tipVechi || tipVechi === 'alta' || tipVechi === 'raspuns_clarificare') return null
  return tipVechi
}

/** Câmpurile de cod pentru rândul unui document SEAP de pe NIVELUL DE SUS (niciodată pentru copiii unei arhive).
 *  seap_meta.cod_sursa = 'lista' deosebește rândurile scrise cu cod de cele adoptate (rollback).
 *  seap_meta.de_anuntat = true pe o VERSIUNE: veghea o anunță (avertisment + mail, decizia M = A) oricine ar fi adus-o primul
 *  (UI, workerul NAS, veghea însăși) și apoi pune false — anunțul nu mai depinde de cine a importat.
 *  @param {string} cod @param {any} dec @param {{ esteArhiva?: boolean }} [o] @returns {Record<string, unknown>} */
export function campuriCod(cod, dec, { esteArhiva = false } = {}) {
  const c = String(cod ?? '').trim()
  if (!c) return {}
  if (dec?.fel === 'nou') return { seap_cod: c, seap_meta: { cod_sursa: 'lista', cod: c } }
  if (dec?.fel === 'versiune') {
    const r = dec.inlocuit, t = tipMostenit(r?.tip, esteArhiva)
    return { seap_cod: c, ...(t ? { tip: t } : {}), aparut_ulterior: true,
      seap_meta: { cod_sursa: 'lista', cod: c, cod_anterior: codRand(r) || null, inlocuieste: r?.nume_original ?? null, inlocuieste_id: r?.id ?? null,
        de_anuntat: true } }
  }
  if (dec?.fel === 'frate') return { seap_cod: c, seap_meta: { cod_sursa: 'lista', cod: c, frate_cu: dec.rude ?? [] } }
  return {}
}

/** Violarea indexului unic al codului (PostgREST dă code 23505; fake-ul workerului doar mesajul). @param {any} err */
export function eDuplicatCod(err) {
  if (!err) return false
  const t = `${err.message ?? ''} ${err.details ?? ''}`
  return (String(err.code ?? '') === '23505' || /duplicate key/i.test(t)) && t.includes(INDEX_COD_UNIC)
}

/** Adopția codului pe un rând vechi: UPDATE condiționat (doar dacă e încă fără cod), idempotent și sigur la curse.
 *  'adoptat' (inv actualizat) | 'ocupat' (alt drum i-a pus între timp un cod) | 'duplicat' (codul e deja pe alt rând) | { eroare }.
 *  Nu aruncă. @param {any} supa @param {number} licitatieId @param {Inv} inv @param {Rand} rand @param {string} cod */
export async function adoptaCod(supa, licitatieId, inv, rand, cod) {
  const c = String(cod ?? '').trim()
  try {
    const { data, error } = await supa.from('ofertare_documente_atribuire').update({ seap_cod: c })
      .eq('id', rand.id).eq('licitatie_id', licitatieId).is('seap_cod', null).select('id')
    if (error) return eDuplicatCod(error) ? 'duplicat' : { eroare: String(error.message ?? error) }
    if (Array.isArray(data) && data.length === 1) {
      rand.seap_cod = c
      if (!inv.coduri.has(c)) inv.coduri.set(c, rand)
      return 'adoptat'
    }
    return 'ocupat'
  } catch (e) {
    return { eroare: String(e?.message ?? e) }
  }
}

/** F5 îngustat (review PR-1, D1): o versiune republicată IDENTIC își mută codul pe rândul înlocuit DOAR dacă (a) acesta NU e un
 *  rând cu nume de cod („N (COD).ext”: versiune / frate — codul e în numele lui; mutat, linia versiunilor s-ar rupe), deci e
 *  originalul / adoptat / cu nume vechi, și (b) NU există placeholder pe numele versiunii N2 (veghea a anunțat-o deja: îl
 *  completează versiunea, F1, cu de_anuntat = false — altfel placeholder orfan). (c) Conținutul identic îl dovedește apelantul
 *  (sha). Altfel: versiune, ca înainte. Pură. @param {Rand} inl @param {boolean} arePlaceholderN2 @returns {boolean} */
export const mutaPeIdentic = (inl, arePlaceholderN2) => !arePlaceholderN2 && numeBaza(inl?.nume_original, codRand(inl)) === null

/** R2 (review PR-1, r4): candidații F5 ai unei versiuni, în ordinea lui decideSeap (numărul cel mai mare primul): fiecare înlocuit
 *  care trece mutaPeIdentic și NU a fost deja ținta unei mutări în rularea asta (`folosite` = id-urile ținute de apelant: un al
 *  doilea document nu se mută pe același rând). Dovada de conținut (sha) o face apelantul pe toți, oprită la prima potrivire;
 *  niciunul identic → versiune cu `inlocuit` (inloc[0]), ca înainte. Pură.
 *  E1 (review PR-1, r5, Jakarinos P1): revenirea la un conținut MAI VECHI se anunță, nu se mută în tăcere — un candidat e țintă
 *  doar dacă NICIUN candidat cu nume de cod („N (COD).ext”: versiune / frate) nu are număr mai mare decât el (capul liniei, sau
 *  un original fără versiune mai nouă). Ex.: „Caiet.pdf” /10 (A), „Caiet (C-00020).pdf” /20 (B), SEAP republică /30 cu A →
 *  versiune anunțată, nu mutare pe /10. Frații fără nume de cod (lic. 100) rămân toți ținte, ca la R2.
 *  @param {any} dec @param {boolean} arePlaceholderN2 @param {Set<number>} [folosite] @returns {Rand[]} */
export function candidatiMutare(dec, arePlaceholderN2, folosite = new Set()) {
  if (dec?.fel !== 'versiune') return []
  const toti = Array.isArray(dec.inlocuiti) && dec.inlocuiti.length ? dec.inlocuiti : dec.inlocuit ? [dec.inlocuit] : []
  const nr = (r) => ordineCod(codRand(r))?.nr ?? null
  // capetele: pe toată linia (inclusiv rândurile înlocuite deja — Jakarinos r7), nu doar pe candidații rămași
  const capete = (Array.isArray(dec.linie) ? dec.linie : toti).filter((r) => numeBaza(r?.nume_original, codRand(r)) !== null).map(nr).filter((n) => n != null)
  const peLinie = (r) => !capete.some((c) => nr(r) == null || c > nr(r))
  return toti.filter((r) => mutaPeIdentic(r, arePlaceholderN2) && !(r?.id != null && folosite.has(r.id)) && peLinie(r))
}

/** Mutarea codului pe rândul ÎNLOCUIT, când „versiunea” are exact conținutul lui (review PR-1, F5: autoritatea republică
 *  documentul identic sub cod nou — fără rând nou, fără upload, fără anunț). UPDATE condiționat (id + licitație + încă codul
 *  vechi), sigur la curse. 'mutat' (inv: codul vechi scos, cel nou → rândul) | 'ocupat' (alt drum i-a schimbat codul între timp)
 *  | 'duplicat' (codul nou e deja pe alt rând) | { eroare }. Nu aruncă.
 *  @param {any} supa @param {number} licitatieId @param {Inv} inv @param {Rand} rand @param {string} codVechi @param {string} codNou */
export async function mutaCod(supa, licitatieId, inv, rand, codVechi, codNou) {
  const v = String(codVechi ?? '').trim(), n = String(codNou ?? '').trim()
  try {
    const { data, error } = await supa.from('ofertare_documente_atribuire').update({ seap_cod: n })
      .eq('id', rand.id).eq('licitatie_id', licitatieId).eq('seap_cod', v).select('id')
    if (error) return eDuplicatCod(error) ? 'duplicat' : { eroare: String(error.message ?? error) }
    if (Array.isArray(data) && data.length === 1) {
      if (inv.coduri.get(v) === rand) inv.coduri.delete(v)
      inv.coduri.set(n, rand)
      rand.seap_cod = n
      return 'mutat'
    }
    return 'ocupat'
  } catch (e) {
    return { eroare: String(e?.message ?? e) }
  }
}
