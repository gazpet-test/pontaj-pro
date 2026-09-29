import { poartaOfertare, type DepsPoartaOfertare } from '../_shared/poartaOfertare.ts'
import { ROLURI_DOVEDIT, verificaFisier } from './verificare.mjs'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: CORS })
type FisierManifest = { id: number; rol: string; nume: string; fisier_path: string | null; sha256: string }

export function creeazaHandler(deps: {
  poarta?: DepsPoartaOfertare,
  // Clientul se creează numai după poartă și validarea body-ului.
  service?: () => Promise<any>,
  download?: (path: string) => Promise<Response>,
} = {}) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
    const context: { userId?: string } = {}
    const denied = await poartaOfertare(req, { ...deps.poarta, context })
    if (denied) return denied
    if (req.method !== 'POST') return json({ error: 'metodă nepermisă' }, 405)
    let body
    try { body = await req.json() } catch { return json({ error: 'JSON invalid' }, 400) }
    if (!Number.isSafeInteger(body?.pachet_id) || body.pachet_id <= 0) {
      return json({ error: 'pachet_id trebuie să fie întreg pozitiv' }, 400)
    }
    try {
      const db = deps.service ? await deps.service() : (await import('npm:@supabase/supabase-js@2')).createClient(
        Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
        { auth: { persistSession: false, autoRefreshToken: false } },
      )
      const { data: pachet, error: ep } = await db.from('ofertare_pt_pachet').select('id,stare').eq('id', body.pachet_id).maybeSingle()
      if (ep) return json({ error: 'Pachetul nu se poate citi.' }, 503)
      if (!pachet) return json({ error: 'Pachet inexistent.' }, 404)
      if (pachet.stare !== 'aprobat') return json({ error: 'Verificarea depunerii cere un pachet aprobat.' }, 409)
      // Paginare explicită: limita implicită PostgREST nu poate ascunde fișiere.
      const fisiere: FisierManifest[] = []
      for (let from = 0; ; from += 500) {
        const { data, error } = await db.from('ofertare_pt_pachet_fisiere')
          .select('id,rol,nume,fisier_path,sha256').eq('pachet_id', pachet.id)
          .in('rol', ROLURI_DOVEDIT).order('id').range(from, from + 499)
        if (error || !data) return json({ error: 'Manifestul nu se poate citi.' }, 503)
        fisiere.push(...data)
        if (data.length < 500) break
      }
      const snapshot = async (id: number) => {
        const { data, error } = await db.rpc('ofertare_pt_fisier_snapshot', { p_fisier_id: id })
        if (error) throw new Error('Snapshot indisponibil') // tehnic; verificaFisier persistă REFUZ
        return data
      }
      const download = deps.download ?? ((path: string) => fetch(
        `${Deno.env.get('SUPABASE_URL')}/storage/v1/object/authenticated/ofertare/${path.split('/').map(encodeURIComponent).join('/')}`,
        { headers: { Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` },
          signal: AbortSignal.timeout(30_000), redirect: 'error', cache: 'no-store' },
      ))
      const verificari = []
      for (const f of fisiere) {
        const row = await verificaFisier(f, context.userId, { snapshot, download })
        const { error } = await db.from('ofertare_pt_pachet_verificari').insert(row)
        if (error) return json({ ok: false, error: `Verificarea pentru ${f.nume} nu s-a putut salva.`, verificari }, 503)
        verificari.push({ pachet_fisier_id: f.id, nume: f.nume, rezultat: row.rezultat, motiv: row.motiv })
      }
      const lipsa = ['depus_final', 'dovada_seap'].filter(rol => !fisiere.some(f => f.rol === rol))
      return json({ ok: lipsa.length === 0 && verificari.every(v => v.rezultat === 'PASS'), verificari,
        ...(lipsa.length ? { error: `Lipsesc fișierele cu rol: ${lipsa.join(', ')}.` } : {}) })
    } catch {
      return json({ ok: false, error: 'Verificarea serverului este indisponibilă. Pachetul rămâne aprobat.' }, 503)
    }
  }
}

if (import.meta.main) Deno.serve(creeazaHandler())
