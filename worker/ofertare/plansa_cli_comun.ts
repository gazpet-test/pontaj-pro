// D4: utilitare pentru comenzile MANUALE. Nu importăm main.ts/depsReale (încarcă cheia AI).
import { createClient } from 'npm:@supabase/supabase-js@2'

export type Manifest = {
  pachet_id: string; instructiuni_sha256: string; instructiuni_lipire_sha256: string
  doc_id: number; licitatie_id: number; fisier_path: string; taiat_la: string; cale_felii: string
  felii: { eticheta: string; fisier: string; sha256: string }[]
  perechi_lipire: [string, string][]; generat_la: string
}
export type RezultatCli = {
  doc_id: number; taiat_la: string; pachet_id: string
  config_cli: { model: string; prompt_sha256: string }
  felii_verificate: Record<string, string> // SHA-256 calculat de launcher din JPEG-urile locale, înainte de CLI.
  rulare: { prompt_sha256: string; instructiuni_sha256: string; instructiuni_lipire_sha256: string; cli_version: string; model: string }
  felii: Record<string, { sha256: string; text: string }>
  lipiri: Record<string, { sha256_a: string; sha256_b: string; text: string }>
}
export type DepsCli = { supa: any; SERVICE: string; operatorDeclarat: string }
export const MODEL_CLI = 'cli:opus'
export const sha256 = async (bytes: Uint8Array): Promise<string> =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))))
    .map(b => b.toString(16).padStart(2, '0')).join('')

export const shaText = (text: string) => sha256(new TextEncoder().encode(text))
// Serializare explicită, stabilă; ordinea feliilor și orientarea perechilor fac parte din pachet.
export const calculeazaPachetId = (m: Pick<Manifest, 'doc_id' | 'taiat_la' | 'felii' | 'perechi_lipire'>,
  instructiuniSha: string, lipireSha: string) => shaText(JSON.stringify({
    doc_id: m.doc_id, taiat_la: m.taiat_la,
    felii: m.felii.map(({ eticheta, sha256 }) => ({ eticheta, sha256 })),
    perechi_lipire: m.perechi_lipire, instructiuni_sha256: instructiuniSha, instructiuni_lipire_sha256: lipireSha,
  }))

export function depsCliReale(): DepsCli {
  const url = Deno.env.get('SUPABASE_URL'), SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const operatorDeclarat = Deno.env.get('OPERATOR_DECLARAT') || ''
  if (!url || !SERVICE) throw new Error('Lipsesc SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
  return { SERVICE, operatorDeclarat, supa: createClient(url, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } }) }
}

export async function verificaOwner(d: DepsCli) {
  // Verificare administrativă, nu autentificare: UUID declarat de operatorul NAS cu service_role.
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(d.operatorDeclarat))
    throw new Error('Verificare administrativă: OPERATOR_DECLARAT trebuie să fie UUID-ul ownerului; nu este autentificare')
  const { data, error } = await d.supa.from('profiles').select('is_owner').eq('id', d.operatorDeclarat).maybeSingle()
  if (error || data?.is_owner !== true) throw new Error('Refuz administrativ: OPERATOR_DECLARAT nu este owner (nu autentificare)')
}

export async function citesteDoc(supa: any, docId: number) {
  if (!Number.isSafeInteger(docId) || docId <= 0) throw new Error('doc_id invalid')
  const { data, error } = await supa.from('ofertare_documente_atribuire')
    .select('id, licitatie_id, nume_original, fisier_path, analiza, eroare').eq('id', docId).maybeSingle()
  if (error || !data) throw new Error('Documentul nu poate fi citit')
  return data
}

export async function listaFelii(supa: any, cale: string): Promise<string[]> {
  const { data, error } = await supa.storage.from('ofertare').list(cale, { limit: 101 })
  if (error || !data) throw new Error('Lista feliilor nu poate fi citită')
  // Handlerul listează maximum 100 obiecte; nu pregătim un pachet pe care l-ar citi parțial.
  if (data.length > 100) throw new Error('Peste 100 obiecte în folder; limita handlerului ar trunchia citirea')
  const nume = data.map((f: any) => f.name).filter((n: string) => n.endsWith('.jpg')).sort((a: string, b: string) => a.localeCompare(b))
  if (!nume.length || nume.some((n: string) => !/^[a-zA-Z0-9_-]+\.jpg$/.test(n))) throw new Error('Lista JPEG este goală sau are etichete invalide')
  return nume
}

export async function descarca(supa: any, cale: string): Promise<Uint8Array> {
  const { data, error } = await supa.storage.from('ofertare').download(cale)
  if (error || !data) throw new Error('Descărcarea unei felii a eșuat')
  return new Uint8Array(await data.arrayBuffer())
}

export function perechiPosibile(etichete: string[]): [string, string][] {
  const nume = new Set(etichete), perechi: [string, string][] = []
  for (const a of etichete) {
    // z1_2 = eticheta tăietorului actual; r1c2 = exemplul din specificație.
    const m = /^(.*?\d+[_c])(\d+)$/.exec(a)
    if (!m) continue
    const b = `${m[1]}${Number(m[2]) + 1}`
    if (nume.has(b)) perechi.push([a, b])
  }
  return perechi
}

export function verificaManifest(m: Manifest) {
  if (!m || [m.pachet_id, m.instructiuni_sha256, m.instructiuni_lipire_sha256].some(h => typeof h !== 'string' || !/^[a-f0-9]{64}$/.test(h)))
    throw new Error('Manifest fără pachet_id / SHA256 prompturi valid; refă pregătirea')
  if (!m || !Number.isSafeInteger(m.doc_id) || m.doc_id <= 0 || !Number.isSafeInteger(m.licitatie_id) || m.licitatie_id <= 0 ||
      typeof m.fisier_path !== 'string' || !m.fisier_path || typeof m.taiat_la !== 'string' || !m.taiat_la ||
      typeof m.cale_felii !== 'string' || !m.cale_felii || !Array.isArray(m.felii) || !m.felii.length || !Array.isArray(m.perechi_lipire))
    throw new Error('Manifest invalid sau identitate incompletă')
  const nume = new Set<string>()
  for (const f of m.felii) {
    if (!f || !/^[a-zA-Z0-9_-]+$/.test(f.eticheta) || nume.has(f.eticheta) ||
        f.fisier !== `felii/${f.eticheta}.jpg` || !/^[a-f0-9]{64}$/.test(f.sha256)) throw new Error('Felie invalidă/duplicată în manifest')
    nume.add(f.eticheta)
  }
  const posibile = new Set(perechiPosibile([...nume]).map(p => p.join('+'))), vazute = new Set<string>()
  for (const p of m.perechi_lipire) {
    if (!Array.isArray(p) || p.length !== 2 || !posibile.has(p.join('+')) || vazute.has(p.join('+')))
      throw new Error('Pereche de lipire invalidă/duplicată în manifest')
    vazute.add(p.join('+'))
  }
}

export function verificaIdentitate(m: Manifest, doc: any) {
  const p = doc?.analiza?.plansa
  if (doc?.id !== m.doc_id || doc?.licitatie_id !== m.licitatie_id || doc?.fisier_path !== m.fisier_path ||
      p?.taiat_la !== m.taiat_la || p?.cale_felii !== m.cale_felii) throw new Error('Documentul curent diferă de manifest (identitate / taiat_la / cale_felii)')
}
