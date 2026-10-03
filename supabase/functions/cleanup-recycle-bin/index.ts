// Edge Function: cleanup-recycle-bin
// Rulat zilnic prin pg_cron (08:00 RO). Doua tipuri de curatenie:
//
// A) Module HR cu soft-delete: randurile cu deleted_at < (now - retentie_zile)
//    -> sterge fisierul din Storage + DELETE randul.
//
// B) ai_documente_inbox_respins (10.08.2026): documentele RESPINSE din Citeste
//    Orice isi lasau fisierul pe veci in bucket-ul de coada (confirmarea curata
//    corect, respingerea nu). Aici stergem DOAR fisierul, randul RAMANE pentru
//    istoric (cine/cand/de ce a respins), si marcam fisier_sters_la.
//
// Optiune: POST {"dry_run": true} sau ?dry=1 -> nu sterge nimic, doar raporteaza.
//
// Poarta (03.10.2026, task #17, migrarea 20261011a): pornita DOAR de pg_cron cu antetul x-intern-secret,
// verificat contra Vault INTERN_EDGE_SECRET prin fn_verifica_secret. Inainte, oricine avea URL-ul putea porni purjarea.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"
import { esteApelIntern } from "../_shared/poartaIntern.ts"

const BUCKET_INBOX = "ai-documente-inbox"
const MODUL_INBOX = "ai_documente_inbox_respins"

Deno.serve(async (req: Request) => {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

  if (!(await esteApelIntern(req, supabase))) {
    return new Response(JSON.stringify({ error: "neautorizat" }), { status: 401, headers: { "Content-Type": "application/json" } })
  }

  // dry_run din body sau din query string
  let dryRun = new URL(req.url).searchParams.get("dry") === "1"
  try {
    const body = await req.json()
    if (body && body.dry_run === true) dryRun = true
  } catch (_) { /* fara body = ok */ }

  const report: Record<string, { found: number; deleted_rows: number; deleted_files: number; errors: string[] }> = {}

  // 1) Citesc setari active
  const { data: setari, error: setariErr } = await supabase
    .from("setari_recycle_bin")
    .select("modul, retentie_zile, activ")
    .eq("activ", true)

  if (setariErr) {
    return new Response(JSON.stringify({ error: "Eroare setări: " + setariErr.message }), { status: 500 })
  }

  const MODULE_MAP: Record<string, { tabel: string; bucket: string }> = {
    hr_autorizatii:           { tabel: "hr_autorizatii",           bucket: "autorizatii" },
    hr_documente_personale:   { tabel: "hr_documente_personale",   bucket: "hr-documente-personale" },
    hr_semnaturi_electronice: { tabel: "hr_semnaturi_electronice", bucket: "hr-semnaturi" },
  }

  for (const setare of (setari || [])) {
    const cutoff = new Date(Date.now() - setare.retentie_zile * 86400000).toISOString()
    report[setare.modul] = { found: 0, deleted_rows: 0, deleted_files: 0, errors: [] }
    const r = report[setare.modul]

    // ---- B) Coada Citeste Orice: doar fisierul, randul ramane ----
    if (setare.modul === MODUL_INBOX) {
      const { data: respinse, error: selErr } = await supabase
        .from("ai_documente_inbox")
        .select("id, fisier_path")
        .eq("status", "respins")
        .is("fisier_sters_la", null)
        .lt("updated_at", cutoff)
        .limit(1000)

      if (selErr) { r.errors.push("select: " + selErr.message); continue }
      r.found = (respinse || []).length
      if (!respinse || !respinse.length) continue
      if (dryRun) continue

      const okIds: number[] = []
      for (let i = 0; i < respinse.length; i += 100) {
        const lot = respinse.slice(i, i + 100)
        const paths = lot.map(x => x.fisier_path).filter(Boolean) as string[]
        if (!paths.length) continue
        const { error: stErr } = await supabase.storage.from(BUCKET_INBOX).remove(paths)
        if (stErr) { r.errors.push("storage remove: " + stErr.message); continue }
        r.deleted_files += paths.length
        okIds.push(...lot.map(x => x.id))
      }
      if (okIds.length) {
        const { error: updErr } = await supabase
          .from("ai_documente_inbox")
          .update({ fisier_sters_la: new Date().toISOString() })
          .in("id", okIds)
        if (updErr) r.errors.push("update marcaj: " + updErr.message)
      }
      continue
    }

    // ---- A) Module HR cu soft-delete: fisier + rand ----
    const map = MODULE_MAP[setare.modul]
    if (!map) { delete report[setare.modul]; continue }

    const { data: expirate, error: selErr } = await supabase
      .from(map.tabel)
      .select("id, fisier_path")
      .not("deleted_at", "is", null)
      .lt("deleted_at", cutoff)

    if (selErr) { r.errors.push("select: " + selErr.message); continue }
    r.found = (expirate || []).length
    if (!expirate || expirate.length === 0) continue
    if (dryRun) continue

    const paths = expirate.map(x => x.fisier_path).filter(Boolean) as string[]
    if (paths.length > 0) {
      for (let i = 0; i < paths.length; i += 100) {
        const batch = paths.slice(i, i + 100)
        const { error: stErr } = await supabase.storage.from(map.bucket).remove(batch)
        if (stErr) r.errors.push("storage remove: " + stErr.message)
        else r.deleted_files += batch.length
      }
    }

    const ids = expirate.map(x => x.id)
    const { error: delErr } = await supabase.from(map.tabel).delete().in("id", ids)
    if (delErr) r.errors.push("delete rows: " + delErr.message)
    else r.deleted_rows = ids.length
  }

  return new Response(JSON.stringify({ ok: true, dry_run: dryRun, timestamp: new Date().toISOString(), report }, null, 2), {
    headers: { "Content-Type": "application/json" }
  })
})
