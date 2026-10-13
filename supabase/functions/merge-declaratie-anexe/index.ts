// merge-declaratie-anexe — lipește buletinele PDF (anexe) după declarația generată.
// Rulează în Deno (Edge Function) → pdf-lib funcționează fără problema Vercel/Rollup.
// v2 (13.10.2026, inventar securitate): sursa adusă în repo + POARTĂ. Înainte orice deținător al cheii anon (publice)
//   putea citi și suprascrie orice fișier din orice bucket (service_role). Acum: JWT utilizator, owner SAU modul
//   'logistica'; DOAR bucketul documente-flota; declarația = <activ>/declaratii/DC_*.pdf, anexele = <același activ>/supape/*.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { PDFDocument } from 'https://esm.sh/pdf-lib@1.17.1'
import { userAutorizat } from './acces.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const BUCKET = 'documente-flota'
const RE_DECL = /^(\d+)\/declaratii\/DC_[A-Za-z0-9._-]+\.pdf$/
const raspuns = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    if (!(await userAutorizat(req, supabase, ['logistica']))) return raspuns({ error: 'neautorizat' }, 403)

    const { bucket, decl_path, anexe_paths } = await req.json()
    if (bucket !== BUCKET || typeof decl_path !== 'string') return raspuns({ error: 'bucket sau decl_path invalid' }, 400)
    const m = RE_DECL.exec(decl_path)
    if (!m) return raspuns({ error: 'decl_path invalid' }, 400)
    const reAnexa = new RegExp(`^${m[1]}/supape/[A-Za-z0-9._-]+$`)
    const anexe: string[] = Array.isArray(anexe_paths) ? anexe_paths.slice(0, 30) : []
    if (anexe.some(p => typeof p !== 'string' || !reAnexa.test(p))) return raspuns({ error: 'anexe_paths invalide' }, 400)

    // 1. Declarația (prima pagină/pagini)
    const { data: declBlob, error: declErr } = await supabase.storage.from(BUCKET).download(decl_path)
    if (declErr || !declBlob) throw new Error('Nu pot descărca declarația: ' + (declErr?.message || ''))
    const merged = await PDFDocument.create()
    const declDoc = await PDFDocument.load(new Uint8Array(await declBlob.arrayBuffer()))
    const declPages = await merged.copyPages(declDoc, declDoc.getPageIndices())
    declPages.forEach(p => merged.addPage(p))

    // 2. Anexe (buletine supape) — PDF sau imagine
    const anexate: string[] = []
    const sarite: string[] = []
    for (const path of anexe) {
      try {
        const { data: blob, error } = await supabase.storage.from(BUCKET).download(path)
        if (error || !blob) { sarite.push(path); continue }
        const bytes = new Uint8Array(await blob.arrayBuffer())
        const head = String.fromCharCode(...bytes.slice(0, 5))
        if (head === '%PDF-') {
          const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
          const pages = await merged.copyPages(doc, doc.getPageIndices())
          pages.forEach(p => merged.addPage(p))
        } else {
          // imagine: embed pe pagină A4
          let img
          if (bytes[0] === 0xFF && bytes[1] === 0xD8) img = await merged.embedJpg(bytes)
          else if (bytes[0] === 0x89 && bytes[1] === 0x50) img = await merged.embedPng(bytes)
          else { sarite.push(path); continue }
          const page = merged.addPage([595.28, 841.89]) // A4 pt
          const { width, height } = img.scaleToFit(545, 790)
          page.drawImage(img, { x: (595.28 - width) / 2, y: (841.89 - height) / 2, width, height })
        }
        anexate.push(path)
      } catch (_e) { sarite.push(path) }
    }

    const out = await merged.save()
    // suprascrie declarația cu versiunea completă (declarație + anexe)
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(decl_path, out, { contentType: 'application/pdf', upsert: true })
    if (upErr) throw new Error('Upload eșuat: ' + upErr.message)

    return raspuns({ ok: true, path: decl_path, pagini: merged.getPageCount(), anexate: anexate.length, sarite })
  } catch (e) {
    return raspuns({ error: String(e?.message || e) }, 500)
  }
})
