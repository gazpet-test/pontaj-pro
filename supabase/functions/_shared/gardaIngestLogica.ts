// Garda citirii automate (docs/INGEST_GARDA.md) — logică PURĂ, fără Deno/rețea: o folosesc edge-ul
// ofertare-ingest-doc, workerul NAS (worker/ofertare/garda.ts) și testele vitest (src/ingestGarda.test.js).
// Condițiile de reluare după incidentul de egress 24–25.09.2026 (doc 770, ~16.000 descărcări):
//  (1) fără cale anonimă: doar service_role cu secret dedicat (comparat în timp constant) sau utilizator cu acces Ofertare;
//  (2) contor PERSISTENT de încercări pe document, cu backoff și blocare definitivă (reactivare doar de om);
//  (3) fără descărcări complete repetate ale aceluiași fișier (plafon de descărcări + scurtcircuit pe hash/mărime/etag).

export const GARDA = {
  maxIncercari: 5,            // încercări EȘUATE consecutive → blocat
  backoffBazaSec: 60,         // 1, 2, 4, 8… minute între încercările eșuate
  backoffMaxSec: 6 * 3600,
  maxDescarcari: 80,          // descărcări complete ale aceluiași document (toate invocările, oricâte felii) → blocat
}
export type ConfigGarda = typeof GARDA

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

// ── (2) + (3) contorul ────────────────────────────────────────────────────────────────────────────
export type StareGarda = {
  incercari_esuate: number
  descarcari: number
  blocat: boolean
  urmatoarea_dupa: string | null   // ISO; înainte de ea nu se încearcă
  ingerat_hash: string | null      // sha256 al fișierului la ultima citire încheiată
  ingerat_size: number | null
  ingerat_etag: string | null
}
export type MetaObiect = { size: number | null; etag: string | null }

export type Decizie =
  | { actiune: 'blocat'; motiv: string }
  | { actiune: 'asteapta'; motiv: string; pana_la: string }
  | { actiune: 'deja_ingerat'; motiv: string }
  | { actiune: 'continua' }

// Decizia ÎNAINTE de descărcare (doar din BD + metadatele obiectului din Storage, fără octeți).
export function decizieInainte(s: StareGarda | null, meta: MetaObiect | null, docIncheiat: boolean, acum: Date, cfg: ConfigGarda = GARDA): Decizie {
  if (s?.blocat) return { actiune: 'blocat', motiv: 'document blocat de gardă — reactivare manuală din ERP' }
  if (s && s.descarcari >= cfg.maxDescarcari) return { actiune: 'blocat', motiv: `plafon de descărcări atins (${s.descarcari}/${cfg.maxDescarcari})` }
  if (s && s.incercari_esuate >= cfg.maxIncercari) return { actiune: 'blocat', motiv: `plafon de încercări eșuate atins (${s.incercari_esuate}/${cfg.maxIncercari})` }
  if (s?.urmatoarea_dupa && new Date(s.urmatoarea_dupa).getTime() > acum.getTime()) return { actiune: 'asteapta', motiv: 'backoff după eșec', pana_la: s.urmatoarea_dupa }
  if (docIncheiat && s && acelasiObiect(s, meta)) return { actiune: 'deja_ingerat', motiv: 'același fișier (mărime + etag) a fost deja citit' }
  return { actiune: 'continua' }
}

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

// Starea după un rezultat (oglinda funcției SQL ofertare_ingest_garda_rezultat — testată aici, aplicată acolo).
export function dupaRezultat(s: StareGarda, ok: boolean, acum: Date, cfg: ConfigGarda = GARDA): StareGarda & { blocat_acum: boolean } {
  const esuate = ok ? 0 : s.incercari_esuate + 1
  const blocat = s.blocat || esuate >= cfg.maxIncercari || s.descarcari >= cfg.maxDescarcari
  return {
    ...s, incercari_esuate: esuate, blocat, blocat_acum: blocat && !s.blocat,
    urmatoarea_dupa: ok ? null : new Date(acum.getTime() + backoffSec(esuate, cfg) * 1000).toISOString(),
  }
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('')
}
