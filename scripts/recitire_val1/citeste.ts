// Recitirea valului 1, pasul 1 (procedura §3): pilotul citirii plătite prin laboratorul ofertare-citire-test (scrie DOAR în
// ofertare_citire_test). Rulează ÎN fereastra de mentenanță, secvențial, câte UN apel AI pe invocare. Plafon dur 1,00 USD cu
// rezervare persistentă de 0,53 USD înaintea fiecărui apel; costul se confirmă doar din BD (rândul de staging + rândul ai_usage_log).
// Orice incertitudine → oprire (cod 3); README: la orice cod ≠ 0, ÎNTÂI fereastra_inchide.sql.
//
// Utilizare (chat, pe serverul AI): deno run -A scripts/recitire_val1/citeste.ts <director_lucru>
//   mediu: SUPABASE_URL, SUPABASE_ANON_KEY, RV1_EMAIL, RV1_PAROLA (contul claudetest@; nu se scriu nicăieri)
import { type Apel, ORDINE, PLAFON_USD, poatePorni, type Registru, REZERVARE_APEL_USD, normalizeazaFelie, sha256Hex } from './lib.ts'

export type Identitate = { fisier_path: string; size_bytes: number | null; pagina_offset: number; pagini: number | null }
export type StorageInfo = { etag: string | null; size: number | null; updated_at: string | null }
export type RandStaging = { id: number; doc_id: number; model: string; pagina_de_la: number; pagina_pana_la: number; text: string | null
  tokens_in: number | null; tokens_out: number | null; cost_usd: number | null; eroare: string | null; created_at: string }
export type RaspunsLab = { primit: boolean; ok?: boolean; error?: string }
export type Deps = {
  identitate: (doc: number) => Promise<Identitate>
  storage: (path: string) => Promise<StorageInfo>
  pdf: (path: string) => Promise<{ sha256: string; pagini: number }>
  lab: (doc: number, de_la0: number, felie: number) => Promise<RaspunsLab>       // primit=false → timeout / rețea (necunoscut)
  staging: (doc: number, deLa: number, panaLa: number, dupaId: number, t0: string) => Promise<RandStaging[]>
  usage: (t0: string) => Promise<{ n: number; cost: number }>                    // rândurile ofertare-citire-test din ai_usage_log de la t0
  salveaza: (r: Stare) => Promise<void>
  acum: () => string
}
export type Amprenta = { identitate: Identitate; storage: StorageInfo; pdf_sha256: string; pagini_pdf: number }
export type RezultatDoc = { document_id: number; stare: 'citit' | 'esuat'; motiv: string | null; amprenta: Amprenta | null
  felii: { id: number; de_la: number; pana_la: number }[] }
export type Stare = Registru & { documente: RezultatDoc[]; ultim_staging_id: number; usage_n: number }

const egal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const MAX_INCERCARI_INTERVAL = 3

export async function ruleaza(d: Deps, s: Stare, docs: number[] = ORDINE): Promise<{ cod: 0 | 3; stare: Stare }> {
  const opreste = async (motiv: string) => { s.oprit = motiv; await d.salveaza(s); return { cod: 3 as const, stare: s } }
  for (const doc of docs) {
    if (s.documente.some((x) => x.document_id === doc)) continue
    const rez: RezultatDoc = { document_id: doc, stare: 'esuat', motiv: null, amprenta: null, felii: [] }
    const id0 = await d.identitate(doc)
    const st0 = await d.storage(id0.fisier_path)
    const p0 = await d.pdf(id0.fisier_path)
    rez.amprenta = { identitate: id0, storage: st0, pdf_sha256: p0.sha256, pagini_pdf: p0.pagini }
    const sursaNeschimbata = async () => egal(await d.identitate(doc), id0) && egal(await d.storage(id0.fisier_path), st0)
    if (id0.pagini !== p0.pagini) { rez.motiv = `pagini_pdf ${p0.pagini} ≠ pagini ${id0.pagini}`; s.documente.push(rez); await d.salveaza(s); continue }
    let pos = 1, felie = 8, incercari = 0
    while (pos <= p0.pagini) {
      const pp = poatePorni(s)
      if (!pp.ok) return await opreste(pp.motiv!)
      if (!(await sursaNeschimbata())) { rez.motiv = 'sursa_schimbata (înaintea apelului)'; break }
      const u0 = await d.usage(s.t0)
      if (u0.n !== s.usage_n) return await opreste(`apel străin în laborator: ${u0.n - s.usage_n} rânduri ai_usage_log neatribuite`)
      const pana = Math.min(pos + felie - 1, p0.pagini)
      const apel: Apel = { nr: s.apeluri.length + 1, document_id: doc, de_la: pos, felie, stare: 'rezervat', rezervat_usd: REZERVARE_APEL_USD, cost_usd: null, staging_id: null }
      s.apeluri.push(apel); await d.salveaza(s)                                    // rezervarea e pe disc ÎNAINTEA apelului
      const r = await d.lab(doc, pos - 1, felie)
      const randuri = await d.staging(doc, pos, pana, s.ultim_staging_id, s.t0)
      const u1 = await d.usage(s.t0)
      if (!r.primit) { apel.stare = 'neconfirmat'; return await opreste(`apel ${apel.nr}: răspuns nerecepționat (timeout / rețea)`) }
      if (randuri.length > 1) { apel.stare = 'neconfirmat'; return await opreste(`apel ${apel.nr}: ${randuri.length} rânduri de staging`) }
      const rand = randuri[0]
      if (!rand) {
        // laboratorul a răspuns fără rând de staging: eroare ÎNAINTEA apelului AI (descărcare, lot) — confirmat doar dacă nici usage nu a crescut
        if (u1.n !== u0.n) { apel.stare = 'neconfirmat'; return await opreste(`apel ${apel.nr}: usage fără rând de staging`) }
        // „ok” fără rând = laboratorul a pierdut scrierea în staging (INSERT neverificat, index.ts l.100) → apel posibil facturat
        if (r.ok) { apel.stare = 'neconfirmat'; return await opreste(`apel ${apel.nr}: laboratorul a răspuns ok fără rând de staging`) }
        apel.stare = 'confirmat'; apel.cost_usd = 0
        rez.motiv = `laborator fără apel AI: ${r.error ?? 'necunoscut'}`; break
      }
      s.ultim_staging_id = Math.max(s.ultim_staging_id, rand.id)
      apel.staging_id = rand.id
      if (rand.tokens_in === null) {
        // apel AI respins de API (!resp.ok): rând cu eroare, fără usage — nefacturat
        if (u1.n !== u0.n) { apel.stare = 'neconfirmat'; return await opreste(`apel ${apel.nr}: usage pentru un apel respins`) }
        apel.stare = 'confirmat'; apel.cost_usd = 0
      } else {
        if (u1.n !== u0.n + 1 || Math.abs((u1.cost - u0.cost) - (rand.cost_usd ?? -1)) > 1e-6) {
          apel.stare = 'neconfirmat'; return await opreste(`apel ${apel.nr}: cost neconfirmat (usage +${u1.n - u0.n}, staging ${rand.cost_usd})`)
        }
        apel.stare = 'confirmat'; apel.cost_usd = rand.cost_usd
        s.usage_n = u1.n
      }
      await d.salveaza(s)
      if (!(await sursaNeschimbata())) { rez.motiv = 'sursa_schimbata (după apel)'; break }
      const bun = rand.eroare === null && rand.text !== null && rand.model === 'claude-haiku-5-5' && rand.doc_id === doc
        && rand.pagina_de_la === pos && rand.pagina_pana_la === pana && normalizeazaFelie(rand.text, pos, pana) !== null
      if (bun) { rez.felii.push({ id: rand.id, de_la: pos, pana_la: pana }); pos = pana + 1; incercari = 0; continue }
      // felie eșuată (trunchiată / refuzată / marcaje) → înjumătățire; la felia 1, încă cel mult 3 încercări, apoi documentul nu trece
      if (felie > 1) { felie = Math.max(1, Math.floor(felie / 2)); continue }
      if (++incercari >= MAX_INCERCARI_INTERVAL) { rez.motiv = `pagina ${pos}: ${rand.eroare ?? 'marcaje'} după ${incercari} încercări la felia 1`; break }
    }
    if (!rez.motiv) {
      const p1 = await d.pdf(id0.fisier_path)
      if (p1.sha256 !== p0.sha256 || !(await sursaNeschimbata())) rez.motiv = 'sursa_schimbata (la final)'
      else rez.stare = 'citit'
    }
    s.documente.push(rez); await d.salveaza(s)
  }
  return { cod: 0, stare: s }
}

// ── rularea reală (rețea) ──
if (import.meta.main) {
  const dir = Deno.args[0]
  if (!dir) { console.error('utilizare: citeste.ts <director_lucru>'); Deno.exit(2) }
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.39.0')
  const { PDFDocument } = await import('https://esm.sh/pdf-lib@1.17.1')
  const env = (k: string) => { const v = Deno.env.get(k); if (!v) { console.error(`lipsește ${k}`); Deno.exit(2) } return v! }
  const sb = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { auth: { persistSession: false } })
  const { error: eAuth } = await sb.auth.signInWithPassword({ email: env('RV1_EMAIL'), password: env('RV1_PAROLA') })
  if (eAuth) { console.error('autentificare eșuată'); Deno.exit(2) }
  const fis = `${dir}/rulare.json`
  let s: Stare
  try { s = JSON.parse(await Deno.readTextFile(fis)) } catch {
    const t0 = new Date().toISOString()
    const { count } = await sb.from('ai_usage_log').select('id', { count: 'exact', head: true }).eq('function_name', 'ofertare-citire-test').gte('created_at', t0)
    s = { t0, plafon_usd: PLAFON_USD, apeluri: [], oprit: null, documente: [], ultim_staging_id: 0, usage_n: count ?? 0 }
  }
  if (s.oprit) { console.error(`rulare oprită anterior: ${s.oprit} — decide chat-ul (registru: ${fis})`); Deno.exit(3) }
  const d: Deps = {
    identitate: async (doc) => {
      const { data, error } = await sb.from('ofertare_documente_atribuire').select('fisier_path, size_bytes, pagina_offset, pagini').eq('id', doc).single()
      if (error || !data) throw new Error(`document ${doc}: ${error?.message}`)
      return data as Identitate
    },
    storage: async (path) => {
      const i = path.lastIndexOf('/')
      const { data, error } = await sb.storage.from('ofertare').list(i >= 0 ? path.slice(0, i) : '', { search: path.slice(i + 1), limit: 100 })
      if (error) throw new Error(`storage ${path}: ${error.message}`)
      const o = (data || []).find((x: any) => x.name === path.slice(i + 1))
      return { etag: o?.metadata?.eTag ?? null, size: o?.metadata?.size ?? null, updated_at: o?.updated_at ?? null }
    },
    pdf: async (path) => {
      const { data, error } = await sb.storage.from('ofertare').download(path)
      if (error || !data) throw new Error(`descărcare ${path}: ${error?.message}`)
      const bytes = new Uint8Array(await data.arrayBuffer())
      const b = await crypto.subtle.digest('SHA-256', bytes)
      const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
      return { sha256: [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join(''), pagini: pdf.getPageCount() }
    },
    lab: async (doc, de_la0, felie) => {
      try {
        const { data, error } = await sb.functions.invoke('ofertare-citire-test', { body: { doc_id: doc, model: 'haiku55', felie, de_la: de_la0, apeluri: 1 } })
        if (error && !(error as any).context) return { primit: false, error: String(error.message) }
        return { primit: true, ok: !!data?.ok, error: data?.error ?? (error ? String(error.message) : undefined) }
      } catch (e) { return { primit: false, error: String(e) } }
    },
    staging: async (doc, deLa, panaLa, dupaId, t0) => {
      const { data, error } = await sb.from('ofertare_citire_test').select('*').eq('doc_id', doc).eq('pagina_de_la', deLa).eq('pagina_pana_la', panaLa)
        .gt('id', dupaId).gte('created_at', t0).order('id')
      if (error) throw new Error(`staging: ${error.message}`)
      return (data || []) as RandStaging[]
    },
    usage: async (t0) => {
      const { data, error } = await sb.from('ai_usage_log').select('cost_usd').eq('function_name', 'ofertare-citire-test').gte('created_at', t0)
      if (error) throw new Error(`usage: ${error.message}`)
      return { n: (data || []).length, cost: (data || []).reduce((x: number, r: any) => x + Number(r.cost_usd || 0), 0) }
    },
    salveaza: async (st) => { await Deno.writeTextFile(fis + '.tmp', JSON.stringify(st, null, 1)); await Deno.rename(fis + '.tmp', fis) },
    acum: () => new Date().toISOString(),
  }
  try {
    const { cod, stare } = await ruleaza(d, s)
    const consumat = stare.apeluri.reduce((x, a) => x + (a.stare === 'confirmat' ? (a.cost_usd ?? 0) : a.rezervat_usd), 0)
    console.log(JSON.stringify({ cod, oprit: stare.oprit, consum_usd: Math.round(consumat * 1e4) / 1e4,
      citite: stare.documente.filter((x) => x.stare === 'citit').map((x) => x.document_id),
      esuate: stare.documente.filter((x) => x.stare === 'esuat').map((x) => [x.document_id, x.motiv]) }))
    Deno.exit(cod)
  } catch (e) {
    // orice excepție (rețea, BD) după o rezervare: registrul rămâne cu rezervarea deschisă → oprire
    s.oprit = `excepție: ${String(e).slice(0, 200)}`
    await d.salveaza(s)
    console.error(s.oprit); Deno.exit(3)
  }
}
