// Garda citirii automate (docs/INGEST_GARDA.md) — logică PURĂ, fără Deno/rețea: o folosesc edge-ul
// ofertare-ingest-doc, workerul NAS (worker/ofertare/garda.ts) și testele vitest (src/ingestGarda.test.js).
// Condițiile de reluare după incidentul de egress 24–25.09.2026 (doc 770, ~16.000 descărcări):
//  (1) fără cale anonimă: doar service_role cu secret dedicat (comparat în timp constant) sau utilizator cu acces Ofertare;
//  (2) contor PERSISTENT de încercări pe document, cu backoff și blocare definitivă (reactivare doar de om);
//      runda 2: o singură încercare activă pe document — LEASE persistent (incercare_token + in_curs_pana, 10 min),
//      iar fiecare încercare acordată se închide cu EXACT un rezultat (cuIncercare, mai jos);
//  (3) EGRESS MĂRGINIT (runda 2 — reformulat; NU „fără re-download”): (a) după ce documentul e încheiat și amprenta
//      lui e cunoscută, nu se mai descarcă (scurtcircuit mărime+etag înainte, sha256 după); (b) cât documentul e în
//      lucru, fiecare invocare/felie descarcă obiectul ÎNTREG, dar numărul de descărcări e plafonat: maxDescarcari
//      pe document între două reactivări ale ownerului. Plafon de egress pe document (calea edge, ≤ 60 MiB/descărcare):
//      80 × 60 MiB = 4 800 MiB ≈ 4,69 GiB ≈ 5,03 GB — vezi egressMaximDocumentBytes. Garda de BYTES (cota ciclului) e #543.

export const GARDA = {
  maxIncercari: 5,            // încercări EȘUATE consecutive → blocat
  backoffBazaSec: 60,         // 1, 2, 4, 8… minute între încercările eșuate
  backoffMaxSec: 6 * 3600,
  maxDescarcari: 80,          // descărcări complete ale aceluiași document (toate invocările, oricâte felii) → blocat
  leaseSec: 10 * 60,          // o încercare deține documentul cel mult atât; > limita unei invocări edge (400 s, Pro)
  pragEdgeBytes: 60 * 1024 * 1024,   // edge-ul refuză fără descărcare peste pragul ăsta (size_bytes din BD SAU mărimea din Storage)
}
export type ConfigGarda = typeof GARDA
// Plafonul NOMINAL de egress al căii edge pe UN document, între două reactivări, când o sursă de mărime (BD sau Storage) e
// corectă: maxDescarcari × pragEdgeBytes (= 5 033 164 800 B). Limita dură locală (ambele mărimi greșite) = 80 × 200 MB ≈ 16 GB.
// Termenul lucrului local al workerului (runda 3, J2): sub lease, ca nicio operație locală să nu depășească lease-ul.
export const TERMEN_LOCAL_MS = 8 * 60_000
export const egressMaximDocumentBytes = (cfg: ConfigGarda = GARDA) => cfg.maxDescarcari * cfg.pragEdgeBytes

// ── (1) poarta de rol ─────────────────────────────────────────────────────────────────────────────
// Comparație în timp constant (nu se oprește la primul octet diferit). Lungimea diferită → false,
// dar tot se parcurge un buffer de lungimea așteptată, ca timpul să nu depindă de secretul primit.
export function egalTimpConstant(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const x = enc.encode(a ?? ''), y = enc.encode(b ?? '')
  let dif = x.length ^ y.length
  for (let i = 0; i < y.length; i++) dif |= (x[i % Math.max(x.length, 1)] ?? 0) ^ y[i]
  return dif === 0 && y.length > 0
}

export type Identitate =
  | { tip: 'serviciu' }                      // workerul NAS: secret dedicat valid
  | { tip: 'utilizator'; uid: string }       // JWT de utilizator verificat + acces Ofertare
  | { tip: 'refuz'; status: 401 | 403; motiv: string }

export type DepsRol = {
  secretAsteptat: string | undefined               // env OFERTARE_INGEST_SECRET
  getUser: (jwt: string) => Promise<string | null>  // uid verificat de Auth (null = sesiune invalidă)
  areAcces: (jwt: string) => Promise<boolean>       // RPC fn_are_acces_ofertare pe clientul utilizatorului
}

// NU se citește rolul din payload-ul JWT (nesemnat la decodare locală) și nu se acceptă cheia anon, oricât
// ar fi coada de activă: cheia anon e publică, deci un JWT valid pentru gateway (verify_jwt) nu e o identitate.
export async function identificaApelant(headers: Headers, deps: DepsRol): Promise<Identitate> {
  const secret = headers.get('x-ingest-secret')
  if (secret !== null) {
    if (!deps.secretAsteptat || deps.secretAsteptat.length < 32) return { tip: 'refuz', status: 401, motiv: 'secretul de serviciu nu e configurat' }
    return egalTimpConstant(secret, deps.secretAsteptat) ? { tip: 'serviciu' } : { tip: 'refuz', status: 401, motiv: 'secret de serviciu invalid' }
  }
  const jwt = /^Bearer\s+(\S+)$/i.exec(headers.get('authorization') || '')?.[1]
  if (!jwt) return { tip: 'refuz', status: 401, motiv: 'lipsește Authorization' }
  let uid: string | null = null
  try { uid = await deps.getUser(jwt) } catch { uid = null }
  if (!uid) return { tip: 'refuz', status: 401, motiv: 'sesiune invalidă (cheia anon sau service_role fără secret nu sunt identități)' }
  let ok = false
  try { ok = (await deps.areAcces(jwt)) === true } catch { ok = false }
  return ok ? { tip: 'utilizator', uid } : { tip: 'refuz', status: 403, motiv: 'nu ai acces la modulul Ofertare' }
}

// ── (2) + (3) contorul, lease-ul și rezultatul ────────────────────────────────────────────────────
// Sursa de adevăr e SQL (ofertare_ingest_garda_incearca / _rezultat, testate pe PG17 în scripts/test_ingest_garda.mjs).
// decizieInainte / dupaRezultat / opritDeGarda sunt oglinda lor în TS (teste vitest + filtrul de candidați al workerului).
export type StareGarda = {
  incercari_esuate: number
  descarcari: number
  blocat: boolean
  urmatoarea_dupa: string | null   // ISO; înainte de ea nu se încearcă
  incercare_token?: string | null  // tokenul încercării care deține documentul (null = liber)
  in_curs_pana?: string | null     // ISO; lease-ul tokenului
  ingerat_hash: string | null      // sha256 al fișierului la ultima citire încheiată
  ingerat_size: number | null
  ingerat_etag: string | null
}
export type MetaObiect = { size: number | null; etag: string | null }

export type Decizie =
  | { actiune: 'blocat'; motiv: string }
  | { actiune: 'asteapta'; motiv: string; pana_la: string }
  | { actiune: 'in_curs'; motiv: string; pana_la: string }
  | { actiune: 'deja_ingerat'; motiv: string }
  | { actiune: 'continua'; token?: string; pana_la?: string; ingerat_hash?: string | null }

const ms = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : NaN)
export const leaseActiv = (s: Pick<StareGarda, 'incercare_token' | 'in_curs_pana'> | null, acum: Date) =>
  !!(s?.incercare_token && ms(s.in_curs_pana) > acum.getTime())

// Lease expirat fără rezultat = încercare ABANDONATĂ (proces oprit: memorie, limită de timp, repornire, rezultat pierdut
// pe rețea) → se numără ca eșec, cu backoff socotit de la expirarea lease-ului. Oglinda ramurii (b) din _incearca.
export function inchideAbandonata(s: StareGarda, cfg: ConfigGarda = GARDA): StareGarda {
  if (!s.incercare_token) return s
  const n = s.incercari_esuate + 1
  return { ...s, incercari_esuate: n, incercare_token: null, in_curs_pana: null,
    urmatoarea_dupa: new Date(ms(s.in_curs_pana) + backoffSec(n, cfg) * 1000).toISOString() }
}

// Decizia ÎNAINTE de descărcare (doar din BD + metadatele obiectului din Storage, fără octeți).
export function decizieInainte(s0: StareGarda | null, meta: MetaObiect | null, docIncheiat: boolean, acum: Date, cfg: ConfigGarda = GARDA): Decizie {
  if (s0?.blocat) return { actiune: 'blocat', motiv: 'document blocat de gardă — reactivare manuală din ERP' }
  if (s0 && leaseActiv(s0, acum)) return { actiune: 'in_curs', motiv: 'altă încercare lucrează pe document', pana_la: s0.in_curs_pana! }
  const s = s0 ? inchideAbandonata(s0, cfg) : null
  if (s && s.descarcari >= cfg.maxDescarcari) return { actiune: 'blocat', motiv: `plafon de descărcări atins (${s.descarcari}/${cfg.maxDescarcari})` }
  if (s && s.incercari_esuate >= cfg.maxIncercari) return { actiune: 'blocat', motiv: `plafon de încercări eșuate atins (${s.incercari_esuate}/${cfg.maxIncercari})` }
  if (s?.urmatoarea_dupa && ms(s.urmatoarea_dupa) > acum.getTime()) return { actiune: 'asteapta', motiv: 'backoff după eșec', pana_la: s.urmatoarea_dupa }
  if (docIncheiat && s && acelasiObiect(s, meta)) return { actiune: 'deja_ingerat', motiv: 'același fișier (mărime + etag) a fost deja citit' }
  return { actiune: 'continua' }
}

// Filtrul de candidați al workerului: nu alege documentele blocate, în backoff sau cu altă încercare în curs.
export const opritDeGarda = (g: Pick<StareGarda, 'blocat' | 'urmatoarea_dupa' | 'incercare_token' | 'in_curs_pana'>, acum: Date) =>
  g.blocat || ms(g.urmatoarea_dupa) > acum.getTime() || leaseActiv(g, acum)

// Aceeași mărime ȘI (etag egal, dacă ambele există). Fără etag, mărimea singură NU ajunge.
export function acelasiObiect(s: Pick<StareGarda, 'ingerat_size' | 'ingerat_etag'>, meta: MetaObiect | null): boolean {
  if (!meta || meta.size == null || s.ingerat_size == null) return false
  if (Number(meta.size) !== Number(s.ingerat_size)) return false
  return !!(meta.etag && s.ingerat_etag && normEtag(meta.etag) === normEtag(s.ingerat_etag))
}
export const normEtag = (e: string) => e.replace(/^W\//, '').replace(/"/g, '').trim()

// După descărcare: hash-ul identic cu cel deja citit, pe un document încheiat → nu se mai citește.
export const dejaIngeratLaHash = (s: StareGarda | null, sha256: string, docIncheiat: boolean) =>
  docIncheiat && !!s?.ingerat_hash && s.ingerat_hash === sha256

export function backoffSec(incercariEsuate: number, cfg: ConfigGarda = GARDA): number {
  if (incercariEsuate <= 0) return 0
  return Math.min(cfg.backoffMaxSec, cfg.backoffBazaSec * 2 ** (incercariEsuate - 1))
}

// Rezultatul unei încercări (exact unul per token):
//  succes  = documentul e încheiat (procesat/partial) — eșecurile se resetează, amprenta (sha256/mărime/etag) se memorează;
//  progres = o felie citită, documentul continuă — eșecurile se resetează;
//  predat  = workerul NAS predă documentul altei căi (edge pentru scan, citire_mare peste 60 MB) — contoarele NU se ating;
//  esec    = eșecurile +1, backoff 60 s × 2^(n−1) ≤ 6 h, blocare + notificare owner la plafon.
//  marcaj  = (runda 3) scriere intermediară a documentului + prelungirea lease-ului; încercarea rămâne deschisă.
// `doc` (runda 3, J2): coloanele documentului de scris — le scrie SERVERUL, în aceeași tranzacție cu verificarea tokenului
// (o încercare preluată/expirată nu mai poate suprascrie rezultatul alteia).
export type Rezultat = 'succes' | 'progres' | 'predat' | 'esec' | 'marcaj'
export type RaportIncercare = { rezultat: Rezultat; hash?: string | null; size?: number | null; etag?: string | null; eroare?: string | null; doc?: Record<string, unknown> | null }

// Starea după un rezultat ACCEPTAT (oglinda funcției SQL ofertare_ingest_garda_rezultat — testată aici, aplicată acolo).
export function dupaRezultat(s: StareGarda, r: Rezultat, acum: Date, cfg: ConfigGarda = GARDA): StareGarda & { blocat_acum: boolean } {
  if (r === 'marcaj') return { ...s, blocat_acum: false }
  const esuate = r === 'esec' ? s.incercari_esuate + 1 : r === 'predat' ? s.incercari_esuate : 0
  const blocat = s.blocat || esuate >= cfg.maxIncercari || s.descarcari >= cfg.maxDescarcari
  return {
    ...s, incercari_esuate: esuate, blocat, blocat_acum: blocat && !s.blocat, incercare_token: null, in_curs_pana: null,
    urmatoarea_dupa: r === 'esec' ? new Date(acum.getTime() + backoffSec(esuate, cfg) * 1000).toISOString() : r === 'predat' ? s.urmatoarea_dupa : null,
  }
}

// ── cel mult un raport de închidere trimis per token (runda 3: formularea corectă, nu „exact-once” end-to-end) ──
// + contabilizare fail-safe a unui raport pierdut: lease-ul expiră, iar următorul _incearca îl închide ca abandonat (eșec).
// Încercarea se marchează închisă SINCRON, înainte de RPC: o a doua închidere (alt drum, excepție după închidere, finally)
// nu mai trimite nimic. Eroarea RPC-ului nu se propagă (nu maschează excepția originală); rezultatul pierdut pe rețea
// lasă lease-ul să expire, iar următorul _incearca îl închide ca „abandonat” (eșec) — tot exact un rezultat per token.
export type Incercare = {
  readonly token: string
  readonly inchisa: boolean
  readonly raport: RaportIncercare | null
  readonly raspuns: any                            // răspunsul serverului la închidere ({acceptat, …}) sau null (RPC pierdut)
  inchide(r: RaportIncercare): Promise<boolean>   // true = trimis acum; false = era deja închisă (nimic trimis)
  marcheaza(doc: Record<string, unknown> | null): Promise<any>   // scriere intermediară + prelungire lease; null dacă e închisă
}
export function deschideIncercare(token: string, trimite: (token: string, r: RaportIncercare) => Promise<unknown>): Incercare {
  let raport: RaportIncercare | null = null
  let raspuns: any = null
  return {
    token,
    get inchisa() { return raport !== null },
    get raport() { return raport },
    get raspuns() { return raspuns },
    async inchide(r: RaportIncercare) {
      if (raport !== null) return false
      raport = r
      try { raspuns = await trimite(token, r) } catch (_) { raspuns = null /* lease-ul expiră → abandonată la următorul _incearca */ }
      return true
    },
    async marcheaza(doc) {
      if (raport !== null) return null
      try { return await trimite(token, { rezultat: 'marcaj', doc }) } catch (_) { return null }
    },
  }
}
export const mesajEroare = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 400)
// Plasa din `finally`: o încercare încă deschisă la ieșire se închide ca 'esec' (niciun drum nu lasă lease-ul agățat).
export const plasaExactOnce = (inc: Incercare | null): Promise<boolean> =>
  inc && !inc.inchisa ? inc.inchide({ rezultat: 'esec', eroare: 'încercare încheiată fără rezultat explicit' }) : Promise.resolve(false)
// Rulează munca unei încercări acordate. Garanții, oricum s-ar termina `lucru`:
//  - a închis-o explicit (succes/progres/predat/esec) → acela e singurul rezultat;
//  - a aruncat înainte să o închidă → 'esec' cu mesajul excepției, apoi excepția se re-aruncă (apelantul o tratează ca înainte);
//  - s-a întors fără să o închidă → 'esec' („fără rezultat explicit”) — plasa.
// Edge-ul are aceeași structură scrisă direct în handler (catch → fail() închide 'esec'; finally → plasaExactOnce).
// docLaEsec (runda 3): coloanele documentului scrise ATOMIC cu eșecul (ex. status 'eroare'), tot sub token.
export async function cuIncercare<T>(inc: Incercare, lucru: (inc: Incercare) => Promise<T>, docLaEsec?: (mesaj: string) => Record<string, unknown>): Promise<T> {
  try {
    return await lucru(inc)
  } catch (e) {
    await inc.inchide({ rezultat: 'esec', eroare: 'excepție: ' + mesajEroare(e), doc: docLaEsec ? docLaEsec(mesajEroare(e)) : null })
    throw e
  } finally {
    await plasaExactOnce(inc)
  }
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('')
}

// Termen executabil (runda 3, J2): promisiunea pierde cursa după `ms` → excepție „termen depășit” (→ 'esec' prin cuIncercare).
export function cuTermen<T>(p: Promise<T>, ms: number, ce: string): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined
  const limita = new Promise<T>((_, rej) => { t = setTimeout(() => rej(new Error(`termen depășit: ${ce} (${Math.round(ms / 1000)} s)`)), Math.max(0, ms)) })
  return Promise.race([p, limita]).finally(() => clearTimeout(t))
}
