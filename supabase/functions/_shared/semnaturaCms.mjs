// semnaturaCms.mjs — desfacerea semnăturii electronice (CMS / PKCS#7, .p7s și .p7m), ACEEAȘI regulă pe toate drumurile
// motorului de import SEAP: worker NAS (worker/ofertare/seap.ts), edge ofertare-seap-import, edge ofertare-seap-veghe și
// /api/seap-import (copia byte cu byte api/_semnaturaCms.js — funcțiile Vercel nu importă din afara api/).
//
// Decizia Răzvan 07.10.2026 seara, varianta B (docs/ofertare/AUDIT_MOTOR_IMPORT_2026-10-07.md):
//   - „X.pdf.p7s”          → conținutul desfăcut, numele „X.pdf” (ca până acum);
//   - „X.zip|rar|7z.p7m”   → conținutul desfăcut, numele „X.rar” (arhivele, #644);
//   - „X.pdf|docx|….p7m”   → conținutul desfăcut, numele „X (semnat).pdf”: se termină în extensia reală (consumatorii care
//     decid după „.pdf” — triere, pdf-sparge, plansa-felii, etapa1-mail — merg neschimbați) și nu se ciocnește cu un „X.pdf”
//     nesemnat publicat alături (Copilot NO-GO r1/r2 pe #644). Numele SEAP original rămâne cheie de căutare (numeSeapEchivalente).
// Audit Jakarinos 07.10, #20: o desfacere EȘUATĂ nu mai scoate sufixul (CMS-ul brut nu mai trece drept „X.pdf” valid) — numele
// rămâne cel original, iar apelantul scrie nota. #8: aceeași funcție și pentru fișierele extrase din arhive.
//
// Parcurgem STRUCTURA (ContentInfo → [0] SignedData → encapContentInfo → [0] OCTET STRING, poate fi „constructed” în
// bucăți de ~64 KB și cu lungime nedefinită) — fără căutări de semnături magice în fișier. Conținut extern, neîncrezător:
// orice lungime care iese din buffer = eroare, nu citire în afara lui.

const OID_SIGNED_DATA = [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02]   // 1.2.840.113549.1.7.2

const RE_P7S = /\.p7s$/i
const RE_ARHIVA_P7M = /\.(zip|rar|7z)\.p7m$/i
const RE_DOC_P7M = /^(.+)\.([a-z0-9]{1,6})\.p7m$/i

/** Arhivă semnată .p7m („X.rar.p7m”): o desface DOAR workerul NAS (drumul SEAP + bucla de arhive, #644). Edge-ul, veghea
 *  și api-ul o urcă întreagă, „neprocesat”, cu numele SEAP — altfel „a intrat?” din veghe n-o mai găsește (Jakarinos #7
 *  pe #649) și „X.rar.p7m” s-ar confunda cu un „X.rar” deja urcat (Copilot NO-GO r2 pe #644).
 *  @param {string} nume */
export const eArhivaP7m = (nume) => RE_ARHIVA_P7M.test(String(nume ?? ''))

/** Numele cere desfacerea semnăturii: .p7s (orice), .p7m pe arhivă sau pe un document cu extensie („X.pdf.p7m”).
 *  @param {string} nume */
export function eSemnat(nume) {
  const n = String(nume ?? '')
  return RE_P7S.test(n) || RE_ARHIVA_P7M.test(n) || RE_DOC_P7M.test(n)
}

/** Numele după desfacere (varianta B). Nesemnat → neschimbat.
 *  @param {string} nume @returns {string} */
export function numeDesfacut(nume) {
  const n = String(nume ?? '')
  if (RE_P7S.test(n)) return n.replace(RE_P7S, '')
  if (RE_ARHIVA_P7M.test(n)) return n.replace(/\.p7m$/i, '')
  const m = RE_DOC_P7M.exec(n)
  return m ? `${m[1]} (semnat).${m[2]}` : n
}

/** Numele sub care un DOCUMENT SEAP semnat .p7m poate exista deja în platformă: numele SEAP (urcat brut înainte de B) și
 *  numele desfăcut („X (semnat).pdf”). Apelantul le trece prin cheia lui (cheieNume) — dedup-ul de dinainte de descărcare
 *  nu-l re-aduce. NU și pentru arhive: „X.rar.p7m” ≠ „X.rar” deja urcat (alt conținut posibil — Copilot NO-GO r2 pe #644);
 *  iar „.p7s” e deja tăiat de cheieNume (echivalența veche, neschimbată).
 *  Aliasul e acceptat conștient (Jakarinos #3 pe #649): „X (semnat).pdf” e convenția NOASTRĂ pentru conținutul desfăcut al
 *  lui „X.pdf.p7m” — un rând cu exact acest nume e, prin construcție, același document (urcat de drumurile de import sau de
 *  un om care a urmat convenția). O dovadă de proveniență pe rând (seap_meta) ar costa o coloană citită pe toate drumurile.
 *  @param {string} nume @returns {string[]} */
export function numeSeapEchivalente(nume) {
  const n = String(nume ?? '')
  if (RE_P7S.test(n) || RE_ARHIVA_P7M.test(n) || !RE_DOC_P7M.test(n)) return [n]
  return [n, numeDesfacut(n)]
}

/** Cheia unui RÂND existent din platformă, pentru inventarul „e deja / a intrat”: `cheieNume` a apelantului, dar un rând
 *  rămas cu semnătura BRUTĂ („X.pdf.p7s” — detașată sau nedesfăcută) își păstrează sufixul: NU e documentul „X.pdf”.
 *  Altfel o semnătură detașată ținea pe loc documentul real (Copilot conv. 3, NO-GO r1 pe #649). Un rând desfăcut cu
 *  succes poartă deja numele fără sufix, deci cheia lui rămâne cea veche.
 *  @param {string} nume @param {(n: string) => string} cheieNume @returns {string} */
export function cheieRand(nume, cheieNume) {
  const n = String(nume ?? '')
  return RE_P7S.test(n) ? `${cheieNume(n)}.p7s` : cheieNume(n)
}

/** Cheile (în sensul cheieRand) sub care un nume SEAP poate exista deja ca rând: numele desfăcut sau echivalent
 *  („X.pdf.p7s” → „x.pdf”; „X.pdf.p7m” → și „X (semnat).pdf”) și, pentru .p7s, rândul brut („x.pdf.p7s”). Un nume SEAP
 *  nesemnat („X.pdf”) NU se potrivește cu un rând brut „X.pdf.p7s”.
 *  @param {string} numeSeap @param {(n: string) => string} cheieNume @returns {string[]} */
export function cheiSeap(numeSeap, cheieNume) {
  const n = String(numeSeap ?? '')
  const k = numeSeapEchivalente(n).map((x) => (RE_P7S.test(x) ? cheieNume(x) : cheieRand(x, cheieNume)))
  if (RE_P7S.test(n)) k.push(cheieRand(n, cheieNume))
  return [...new Set(k)]
}

function antet(b, p) {
  if (p + 2 > b.length) throw new Error('DER trunchiat')
  const tag = b[p]
  let q = p + 1
  let l = b[q++]
  if (l === 0x80) return { tag, cons: (tag & 0x20) !== 0, len: null, hl: q - p }
  if (l & 0x80) {
    const n = l & 0x7f
    if (n < 1 || n > 6 || q + n > b.length) throw new Error('DER: lungime invalidă')
    l = 0
    for (let i = 0; i < n; i++) l = l * 256 + b[q++]
  }
  if (q + l > b.length) throw new Error('DER trunchiat')
  return { tag, cons: (tag & 0x20) !== 0, len: l, hl: q - p }
}

function sfarsit(b, p, adancime = 0) {
  if (adancime > 64) throw new Error('DER: imbricare prea adâncă')
  const h = antet(b, p)
  if (h.len !== null) return p + h.hl + h.len
  let q = p + h.hl
  while (!(b[q] === 0 && b[q + 1] === 0)) {
    if (q + 2 > b.length) throw new Error('DER trunchiat')
    q = sfarsit(b, q, adancime + 1)
  }
  return q + 2
}

function copii(b, p) {
  const h = antet(b, p)
  const out = []
  let q = p + h.hl
  const e = h.len !== null ? p + h.hl + h.len : null
  while (e !== null ? q < e : !(b[q] === 0 && b[q + 1] === 0)) {
    if (q + 2 > b.length) throw new Error('DER trunchiat')
    out.push(q)
    q = sfarsit(b, q)
  }
  if (e !== null && q !== e) throw new Error('DER: lungimi incoerente')
  return out
}

function octeti(b, p, acc, adancime = 0) {
  if (adancime > 64) throw new Error('DER: imbricare prea adâncă')
  const h = antet(b, p)
  if (!h.cons) {
    if (h.tag !== 0x04) throw new Error('CMS: conținutul nu e OCTET STRING')
    acc.push(b.subarray(p + h.hl, p + h.hl + h.len))
    return
  }
  // doar OCTET STRING „constructed” (0x24) se lipește din bucăți; orice altă structură = container malformat (Jakarinos #4)
  if (h.tag !== 0x24) throw new Error('CMS: conținut construit care nu e OCTET STRING')
  for (const c of copii(b, p)) octeti(b, c, acc, adancime + 1)
}

function eOid(b, p, oid) {
  const h = antet(b, p)
  if (h.tag !== 0x06 || h.len !== oid.length) return false
  for (let i = 0; i < oid.length; i++) if (b[p + h.hl + i] !== oid[i]) return false
  return true
}

/** Conținutul semnat dintr-un container CMS atașat. Aruncă eroare dacă structura nu e SignedData cu conținut
 *  (inclusiv „semnătură detașată (fără conținut)”).
 *  @param {Uint8Array} b @returns {Uint8Array} */
export function continutCms(b) {
  if (!b || b.length < 4 || b[0] !== 0x30) throw new Error('CMS: nu e o structură DER (SEQUENCE)')
  // cardinalitatea fiecărui ambalaj e verificată: un container ostil cu DOUĂ conținuturi nu trece drept „desfăcut” cu primul
  // (Jakarinos #4 pe #649); un ambalaj [0] prezent dar gol e o eroare, nu o semnătură detașată
  const ci = copii(b, 0)
  if (ci.length !== 2 || !eOid(b, ci[0], OID_SIGNED_DATA) || antet(b, ci[1]).tag !== 0xa0) throw new Error('CMS: nu e SignedData')
  const sdW = copii(b, ci[1])
  if (sdW.length !== 1 || antet(b, sdW[0]).tag !== 0x30) throw new Error('CMS: SignedData lipsă sau multiplu')
  const sdc = copii(b, sdW[0])
  if (sdc.length < 3 || antet(b, sdc[2]).tag !== 0x30) throw new Error('CMS: SignedData incomplet')
  const eci = copii(b, sdc[2])
  if (eci.length === 1) throw new Error('semnătură detașată (fără conținut)')
  if (eci.length !== 2 || antet(b, eci[0]).tag !== 0x06 || antet(b, eci[1]).tag !== 0xa0) throw new Error('CMS: encapContentInfo malformat')
  const interior = copii(b, eci[1])
  if (interior.length !== 1) throw new Error(interior.length ? 'CMS: mai multe conținuturi în același ambalaj' : 'CMS: ambalajul conținutului e gol')
  const acc = []
  octeti(b, interior[0], acc)
  const tot = acc.reduce((s, x) => s + x.length, 0)
  if (!tot) throw new Error('CMS: conținut gol')
  const out = new Uint8Array(tot)
  let o = 0
  for (const x of acc) { out.set(x, o); o += x.length }
  return out
}

// Un fișier numit .p7s / .p7m care NU e container, dar e deja formatul interior (PDF, ZIP / Office) — publicat greșit fără
// semnătură. Se păstrează ca atare, sub numele desfăcut (comportamentul vechi al edge-ului pentru .p7s, acum doar cu dovadă).
const ePdf = (b) => b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d
const eZip = (b) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04
const eRar = (b) => b.length > 6 && b[0] === 0x52 && b[1] === 0x61 && b[2] === 0x72 && b[3] === 0x21 && b[4] === 0x1a && b[5] === 0x07
const e7z = (b) => b.length > 5 && b[0] === 0x37 && b[1] === 0x7a && b[2] === 0xbc && b[3] === 0xaf && b[4] === 0x27 && b[5] === 0x1c
function dejaInterior(b, numeInterior) {
  const ext = (/\.([a-z0-9]{1,6})$/i.exec(numeInterior)?.[1] ?? '').toLowerCase()
  if (ext === 'pdf') return ePdf(b)
  if (['zip', 'docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp'].includes(ext)) return eZip(b)
  if (ext === 'rar') return eRar(b)
  if (ext === '7z') return e7z(b)
  return false
}

/** Prefixul notei pentru o desfacere eșuată (poarta de completitudine o numără: conținut posibil pierdut). */
export const NOTA_DESFACERE_ESUATA = 'Semnătura electronică nu s-a putut desface'
/** Prefixul notei pentru o semnătură detașată (doar semnătura — documentul semnat e alt fișier; nu se numără în poartă). */
export const NOTA_SEMNATURA_DETASATA = 'Doar semnătura electronică (detașată, fără conținut)'

/** Desfacerea unui fișier după nume + conținut.
 *  - nesemnat după nume → { stare: 'nesemnat', buf, nume } neatinse;
 *  - container valid → { stare: 'desfacut', buf: conținutul, nume: numeDesfacut(nume) };
 *  - nu e container, dar e deja formatul interior (PDF / ZIP / RAR / 7z) → { stare: 'desfacut', buf neatins, nume desfăcut };
 *  - altfel → { stare: 'detasat' | 'esuat', buf neatins, nume ORIGINAL, motiv, nota } — apelantul NU scoate sufixul.
 *  @param {Uint8Array} buf @param {string} nume */
export function desface(buf, nume) {
  const n = String(nume ?? '')
  if (!eSemnat(n)) return { stare: 'nesemnat', buf, nume: n, motiv: null, nota: null }
  const tinta = numeDesfacut(n)
  try {
    return { stare: 'desfacut', buf: continutCms(buf), nume: tinta, motiv: null, nota: null }
  } catch (e) {
    const motiv = String(e?.message ?? e)
    if (dejaInterior(buf, tinta)) return { stare: 'desfacut', buf, nume: tinta, motiv: `nesemnat, deși numele spune semnat (${motiv})`, nota: null }
    if (/detașată/.test(motiv)) {
      return { stare: 'detasat', buf, nume: n, motiv, nota: `${NOTA_SEMNATURA_DETASATA}: documentul semnat e alt fișier. Rămâne ca fișier.` }
    }
    return { stare: 'esuat', buf, nume: n, motiv, nota: `${NOTA_DESFACERE_ESUATA} (${motiv}): fișierul a rămas ca atare, cu semnătura. Descarcă-l și deschide-l manual (ex. cu aplicația de semnătură), apoi bifează-l.` }
  }
}

/** desface(), dar o ARHIVĂ .p7m rămâne întreagă, cu numele SEAP („X.rar.p7m”) — o desface workerul NAS (vezi eArhivaP7m).
 *  Pentru edge-ul de import, veghe și /api/seap-import.
 *  @param {Uint8Array} buf @param {string} nume */
export function desfaceFaraArhiveP7m(buf, nume) {
  const n = String(nume ?? '')
  return eArhivaP7m(n) ? { stare: 'nesemnat', buf, nume: n, motiv: null, nota: null } : desface(buf, n)
}
