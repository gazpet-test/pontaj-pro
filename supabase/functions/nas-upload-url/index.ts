// nas-upload-url — punte NAS (laptop Răzvan, Desktop Commander) → Supabase Storage (07.09.2026).
// Primește {bucket, path} + x-radar-secret și întoarce un signed upload URL (valabil ~2h) cu care
// scriptul PowerShell de pe laptop face PUT direct în storage (fără chei de serviciu pe laptop).
// Folosit la completarea datelor de proiect din serverul \\gazpet-tnas (ordin începere, CS, propuneri, PCCVI).
import { createClient } from 'npm:@supabase/supabase-js@2'
const H = { 'Content-Type': 'application/json' }
const ALLOWED = ['executie-contracte', 'documente-proiect', 'documente-flota']
const ALLOWED_DOWNLOAD = [...ALLOWED, 'recrutare-cv']  // doar citire (signed URL 10 min) — CV-uri pentru evaluare în chat
Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'POST' }), { status: 405, headers: H })
  if (req.headers.get('x-radar-secret') !== 'gazpet-radar-x7Q2mK-2026') return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: H })
  let b: any = {}; try { b = await req.json() } catch { /* gol */ }
  const bucket = String(b.bucket || 'executie-contracte'), path = String(b.path || '')
  // citire: {download: path} → signed URL de descărcare (10 min)
  if (b.download) {
    if (!ALLOWED_DOWNLOAD.includes(bucket)) return new Response(JSON.stringify({ error: 'bucket invalid' }), { status: 400, headers: H })
    const dbr = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data, error } = await dbr.storage.from(bucket).createSignedUrl(String(b.download), 600)
    return new Response(JSON.stringify({ ok: !error, url: data?.signedUrl, error: error?.message }), { headers: H })
  }
  if (!ALLOWED.includes(bucket)) return new Response(JSON.stringify({ error: 'bucket invalid' }), { status: 400, headers: H })
  // curățenie: {remove: [paths]} → șterge obiecte (folosit la corectarea unor urcări greșite)
  if (Array.isArray(b.remove) && b.remove.length) {
    const db0 = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data, error } = await db0.storage.from(bucket).remove(b.remove.map(String).slice(0, 100))
    return new Response(JSON.stringify({ ok: !error, sterse: (data || []).length, error: error?.message }), { headers: H })
  }
  if (!ALLOWED.includes(bucket) || !path || path.includes('..')) return new Response(JSON.stringify({ error: 'bucket/path invalid' }), { status: 400, headers: H })
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data, error } = await db.storage.from(bucket).createSignedUploadUrl(path, { upsert: true })
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: H })
  return new Response(JSON.stringify({ ok: true, bucket, path, signedUrl: data.signedUrl, token: data.token }), { headers: H })
})
