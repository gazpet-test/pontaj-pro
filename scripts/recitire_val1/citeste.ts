// Recitirea valului 1, pasul 1 (procedura §3): pilotul citirii plătite prin laboratorul ofertare-citire-test (scrie DOAR în
// ofertare_citire_test). Rulează ÎN fereastra de mentenanță, secvențial, câte UN apel AI pe invocare. Plafon dur 1,00 USD cu
// rezervare persistentă de 0,53 USD înaintea fiecărui apel; costul se confirmă doar din BD: EXACT un rând de staging (document, model,
// interval, momentul apelului) + EXACT un rând ai_usage_log nou, atribuit (document, model, tokeni, cost). Orice incertitudine, apel străin
// sau sursă schimbată → oprire (cod 3); README: la orice cod ≠ 0, ÎNTÂI fereastra.ts inchide.
//
// Registrul (rulare.json) e al VALULUI, nu al ferestrei: stă în <dir_val> (același pentru toate ferestrele), are un singur T0 și
// supraviețuiește reluărilor. Un registru ilizibil oprește rularea (nu se pornește „unul nou”).
// Utilizare (chat, pe serverul AI): deno run -A scripts/recitire_val1/citeste.ts <dir_val>
//   mediu: SUPABASE_URL, SUPABASE_ANON_KEY, RV1_EMAIL, RV1_PAROLA (contul claudetest@; nu se scriu nicăieri)
import { type Apel, ORDINE, PLAFON_USD, poatePorni, type Registru, REZERVARE_APEL_USD, normalizeazaFelie } from './lib.ts'

export type Identitate = { fisier_path: string; size_bytes: number | null; pagina_offset: number; pagini: number | null }
export type StorageInfo = { etag: string | null; size: number | null; updated_at: string | null }
export type RandStaging = { id: number; doc_id: number; model: string; pagina_de_la: number; pagina_pana_la: number; text: string | null
  tokens_in: number | null; tokens_out: number | null; cost_usd: number | null; eroare: string | null; created_at: string }
export type RandUsage = { id: number; ref_id: number | null; model: string | null; tokens_in: number | null; tokens_out: number | null
  cost_usd: number | null; created_at: string }
export type RaspunsLab = { primit: boolean; ok?: boolean; error?: string }
export type Deps = {
  identitate: (doc: number) => Promise<Identitate>
  storage: (path: string) => Promise<StorageInfo>
  pdf: (path: string) => Promise<{ sha256: string; pagini: number }>
  lab: (doc: number, de_la0: number, felie: number) => Promise<RaspunsLab>       // primit=false → timeout / rețea (necunoscut)
  staging: (doc: number, deLa: number, panaLa: number, dupaId: number, t0: string) => Promise<RandStaging[]>
  usage: (t0: string) => Promise<RandUsage[]>                                    // rândurile ofertare-citire-test din ai_usage_log de la t0
  salveaza: (r: Stare) => Promise<void>
  acum: () => number                                                             // ms
}
export type Amprenta = { identitate: Identitate; storage: StorageInfo; pdf_sha256: string; pagini_pdf: number }
export type RezultatDoc = { document_id: number; stare: 'citit' | 'esuat'; motiv: string | null; amprenta: Amprenta | null
  felii: { id: number; de_la: number; pana_la: number }[] }
export type Stare = Registru & { documente: RezultatDoc[]; ultim_staging_id: number; usage_ids: number[] }

const egal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const MAX_INCERCARI_INTERVAL = 3
const MODEL = 'claude-haiku-5-5'
export const TOLERANTA_CEAS_MS = 120_000   // diferența ceas server (created_at) ↔ ceas pilot, în jurul intervalului apelului
const nr = (x: unknown) => (x === null || x === undefined ? null : Number(x))

export async function ruleaza(d: Deps, s: Stare, docs: number[] = ORDINE): Promise<{ cod: 0 | 3; stare: Stare }> {
  const opreste = async (motiv: string) => { s.oprit = motiv; await d.salveaza(s); return { cod: 3 as const, stare: s } }
  for (const doc of docs) {
    if (s.documente.some((x) => x.document_id === doc)) continue
    const rez: RezultatDoc = { document_id: doc, stare: 'esuat', motiv: null, amprenta: null, felii: [] }
    // sursa schimbată (oricând) → documentul e aruncat ȘI rularea se oprește (procedura §3 / §5: închiderea imediată a ferestrei)
    const sursaSchimbata = async (cand: string) => { rez.motiv = `sursa_schimbata (${cand})`; s.documente.push(rez); return await opreste(`doc ${doc}: ${rez.motiv}`) }
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
      if (!(await sursaNeschimbata())) return await sursaSchimbata('înaintea apelului')
      const straine0 = (await d.usage(s.t0)).filter((u) => !s.usage_ids.includes(u.id))
      if (straine0.length) return await opreste(`apel străin în laborator: ${straine0.length} rânduri ai_usage_log neatribuite`)
      const pana = Math.min(pos + felie - 1, p0.pagini)
      const apel: Apel = { nr: s.apeluri.length + 1, document_id: doc, de_la: pos, felie, stare: 'rezervat', rezervat_usd: REZERVARE_APEL_USD, cost_usd: null, staging_id: null }
      s.apeluri.push(apel); await d.salveaza(s)                                    // rezervarea e pe disc ÎNAINTEA apelului
      const tStart = d.acum()
      const r = await d.lab(doc, pos - 1, felie)
      const tEnd = d.acum()
      const neconfirmat = async (motiv: string) => { apel.stare = 'neconfirmat'; return await opreste(`apel ${apel.nr}: ${motiv}`) }
      if (!r.primit) return await neconfirmat('răspuns nerecepționat (timeout / rețea)')
      const randuri = await d.staging(doc, pos, pana, s.ultim_staging_id, s.t0)
      const noi = (await d.usage(s.t0)).filter((u) => !s.usage_ids.includes(u.id))
      // ORICE apel fără EXACT un rând de staging e incert (laboratorul poate eșua și după apelul AI) → rezervarea rămâne, oprire
      if (randuri.length !== 1) return await neconfirmat(`${randuri.length} rânduri de staging (${r.error ?? (r.ok ? 'ok' : 'fără ok')})`)
      const rand = randuri[0]
      const t = Date.parse(rand.created_at)
      if (rand.doc_id !== doc || rand.model !== MODEL || rand.pagina_de_la !== pos || rand.pagina_pana_la !== pana
          || !(t >= tStart - TOLERANTA_CEAS_MS && t <= tEnd + TOLERANTA_CEAS_MS)) {
        return await neconfirmat(`rândul de staging ${rand.id} nu corespunde apelului (document / model / interval / moment)`)
      }
      s.ultim_staging_id = Math.max(s.ultim_staging_id, rand.id)
      apel.staging_id = rand.id
      if (rand.tokens_in === null && rand.tokens_out === null && rand.cost_usd === null && rand.eroare !== null) {
        // apel respins de API (!resp.ok): rând cu eroare, fără tokeni — nefacturat; cere ZERO rânduri usage noi
        if (noi.length) return await neconfirmat(`usage nou (${noi.length}) pentru un apel respins de API`)
        apel.stare = 'confirmat'; apel.cost_usd = 0
      } else {
        const u = noi[0]
        const ok = noi.length === 1 && rand.tokens_in !== null && rand.tokens_out !== null && rand.cost_usd !== null
          && nr(u.ref_id) === doc && u.model === MODEL && nr(u.tokens_in) === rand.tokens_in && nr(u.tokens_out) === rand.tokens_out
          && Math.abs(Number(u.cost_usd) - rand.cost_usd) <= 1e-9
          && Date.parse(u.created_at) >= tStart - TOLERANTA_CEAS_MS && Date.parse(u.created_at) <= tEnd + TOLERANTA_CEAS_MS
        if (!ok) return await neconfirmat(`cost neconfirmat (usage noi: ${noi.length}; staging tokeni ${rand.tokens_in}/${rand.tokens_out}, cost ${rand.cost_usd})`)
        apel.stare = 'confirmat'; apel.cost_usd = rand.cost_usd
        s.usage_ids.push(u.id)
      }
      await d.salveaza(s)
      if (!(await sursaNeschimbata())) return await sursaSchimbata('după apel')
      const bun = rand.eroare === null && rand.text !== null && normalizeazaFelie(rand.text, pos, pana) !== null
      if (bun) { rez.felii.push({ id: rand.id, de_la: pos, pana_la: pana }); pos = pana + 1; incercari = 0; continue }
      // felie eșuată (trunchiată / refuzată / marcaje) → înjumătățire; la felia 1, încă cel mult 3 încercări, apoi documentul nu trece
      if (felie > 1) { felie = Math.max(1, Math.floor(felie / 2)); continue }
      if (++incercari >= MAX_INCERCARI_INTERVAL) { rez.motiv = `pagina ${pos}: ${rand.eroare ?? 'marcaje'} după ${incercari} încercări la felia 1`; break }
    }
    if (!rez.motiv) {
      const p1 = await d.pdf(id0.fisier_path)
      if (p1.sha256 !== p0.sha256 || !(await sursaNeschimbata())) return await sursaSchimbata('la final')
      rez.stare = 'citit'
    }
    s.documente.push(rez); await d.salveaza(s)
  }
  return { cod: 0, stare: s }
}

// registrul valului: există → îl folosește (ilizibil = oprire); lipsește → unul nou, cu T0 = acum
export async function incarcaRegistru(fis: string, nou: () => Stare): Promise<{ s: Stare } | { eroare: string }> {
  let txt: string
  try { txt = await Deno.readTextFile(fis) } catch (e) {
    if (e instanceof Deno.errors.NotFound) return { s: nou() }
    return { eroare: `registru ilizibil (${String(e).slice(0, 120)})` }
  }
  try {
    const s = JSON.parse(txt) as Stare
    if (typeof s.t0 !== 'string' || !Array.isArray(s.apeluri) || !Array.isArray(s.usage_ids) || !Array.isArray(s.documente)) return { eroare: 'registru cu formă invalidă' }
    return { s }
  } catch { return { eroare: 'registru corupt (JSON invalid)' } }
}

// ── rularea reală (rețea) ──
if (import.meta.main) {
  const dir = Deno.args[0]
  if (!dir) { console.error('utilizare: citeste.ts <dir_val>'); Deno.exit(2) }
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.39.0')
  const { PDFDocument } = await import('https://esm.sh/pdf-lib@1.17.1')
  const env = (k: string) => { const v = Deno.env.get(k); if (!v) { console.error(`lipsește ${k}`); Deno.exit(2) } return v! }
  const sb = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { auth: { persistSession: false } })
  const { error: eAuth } = await sb.auth.signInWithPassword({ email: env('RV1_EMAIL'), password: env('RV1_PAROLA') })
  if (eAuth) { console.error('autentificare eșuată'); Deno.exit(2) }
  const fis = `${dir}/rulare.json`
  const inc = await incarcaRegistru(fis, () => ({ t0: new Date().toISOString(), plafon_usd: PLAFON_USD, apeluri: [], oprit: null, documente: [],
    ultim_staging_id: 0, usage_ids: [] }))
  if ('eroare' in inc) { console.error(`${inc.eroare}: ${fis} — decide chat-ul; NU se pornește alt registru`); Deno.exit(3) }
  const s = inc.s
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
      const { data, error } = await sb.from('ai_usage_log').select('id, ref_id, model, tokens_in, tokens_out, cost_usd, created_at')
        .eq('function_name', 'ofertare-citire-test').gte('created_at', t0).order('id')
      if (error) throw new Error(`usage: ${error.message}`)
      return (data || []) as RandUsage[]
    },
    salveaza: async (st) => { await Deno.writeTextFile(fis + '.tmp', JSON.stringify(st, null, 1)); await Deno.rename(fis + '.tmp', fis) },
    acum: () => Date.now(),
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
