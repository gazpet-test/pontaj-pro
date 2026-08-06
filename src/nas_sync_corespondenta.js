'use strict'
// ════════════════════════════════════════════════════════════════
// nas_sync_corespondenta.js — Gazpet NAS Sync Corespondență Email
//
// Rulează în containerul de pe NAS (același mediu ca scanner_nas_ai_processor.js),
// cu volumul montat :rw. Trage documentele noi din documente_proiect
// (ingerate din Gmail via Edge Function ingest-document) și le scrie în
// folderul proiectului de pe NAS: <folder proiect>/Corespondenta Email/<AAAA-LL>/.
// Apoi le înregistrează în nas_documente (categorie 'corespondenta',
// id_hash = md5(nas_path) — aceeași convenție ca indexerul existent),
// ca să apară imediat în Execuție → Documente NAS.
//
// Env necesare: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Opționale:    NAS_BASE_PATH (default /data/Oferte), MAX_DOCS_PER_RUN (50), DRY_RUN=1
// Cron sugerat: la 15 minute, decalat față de scannerele AI.
// ════════════════════════════════════════════════════════════════

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
const NAS_BASE     = process.env.NAS_BASE_PATH || '/data/Oferte'
const MAX_DOCS     = parseInt(process.env.MAX_DOCS_PER_RUN || '50')
const DRY_RUN      = process.env.DRY_RUN === '1'
const SUBFOLDER    = 'Corespondenta Email'

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Lipsesc SUPABASE_URL sau SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const { createClient } = require('@supabase/supabase-js')
const crypto = require('crypto')
const fs     = require('fs')
const path   = require('path')

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })

const md5 = s => crypto.createHash('md5').update(s).digest('hex')

// nas_proiecte.nas_path e relativ la share ("Oferte/1.TRANSGAZ/...");
// pe disc share-ul e montat la NAS_BASE (default /data/Oferte).
function toPhysical(nasPath) {
  const relative = nasPath.startsWith('Oferte/') ? nasPath.slice('Oferte/'.length) : nasPath
  return path.join(NAS_BASE, relative)
}

async function main() {
  console.log(`\nNAS Sync Corespondență — ${new Date().toISOString()}`)
  console.log(`  NAS: ${NAS_BASE} · Max: ${MAX_DOCS}${DRY_RUN ? ' · DRY RUN' : ''}\n`)

  const { data: pending, error } = await supabase
    .from('documente_proiect')
    .select('id, proiect_id, nume_fisier, mime_type, storage_path, data_mail, expeditor, subiect, marime_bytes')
    .eq('nas_synced', false)
    .order('id')
    .limit(MAX_DOCS)
  if (error) { console.error('Eroare documente_proiect:', error.message); process.exit(1) }
  if (!pending?.length) { console.log('Nimic de sincronizat.'); return }

  // Map proiect_id → folder NAS (prin nas_proiecte)
  const proiectIds = [...new Set(pending.map(d => d.proiect_id))]
  const { data: mapari, error: mErr } = await supabase
    .from('nas_proiecte')
    .select('executie_proiect_id, nas_path')
    .in('executie_proiect_id', proiectIds)
  if (mErr) { console.error('Eroare nas_proiecte:', mErr.message); process.exit(1) }
  const folderByProiect = {}
  for (const m of (mapari || [])) folderByProiect[m.executie_proiect_id] = m.nas_path

  let ok = 0, skip = 0, fail = 0
  for (const doc of pending) {
    const projectNasPath = folderByProiect[doc.proiect_id]
    if (!projectNasPath) {
      console.warn(`  skip #${doc.id} ${doc.nume_fisier} — proiect ${doc.proiect_id} fără folder în nas_proiecte`)
      skip++
      continue
    }
    try {
      const luna = (doc.data_mail || new Date().toISOString()).slice(0, 7) // AAAA-LL
      const relDir  = `${projectNasPath}/${SUBFOLDER}/${luna}`
      const relPath = `${relDir}/${doc.nume_fisier}`
      const physDir  = toPhysical(relDir)
      const physPath = toPhysical(relPath)

      if (DRY_RUN) { console.log(`  [DRY] aș scrie: ${relPath}`); ok++; continue }

      if (!fs.existsSync(physPath)) {
        const { data: blob, error: dlErr } = await supabase.storage
          .from('documente-proiect')
          .download(doc.storage_path)
        if (dlErr) throw new Error(`download storage: ${dlErr.message}`)
        fs.mkdirSync(physDir, { recursive: true })
        fs.writeFileSync(physPath, Buffer.from(await blob.arrayBuffer()))
      }

      // Înregistrează în indexul NAS (aceeași convenție de hash ca indexerul)
      const { error: idxErr } = await supabase.from('nas_documente').upsert({
        id_hash: md5(relPath),
        proiect_id_hash: md5(projectNasPath),
        nas_path: relPath,
        denumire: doc.nume_fisier,
        extensie: (doc.nume_fisier.split('.').pop() || '').toLowerCase(),
        categorie: 'corespondenta',
        subfolder: SUBFOLDER,
        size_bytes: doc.marime_bytes,
        data_modificare: (doc.data_mail || new Date().toISOString()).slice(0, 10),
        scanat_la: new Date().toISOString(),
      }, { onConflict: 'id_hash' })
      if (idxErr) console.warn(`  nas_documente #${doc.id}: ${idxErr.message} (fișierul e scris, indexerul îl va prinde)`)

      const { error: updErr } = await supabase
        .from('documente_proiect')
        .update({ nas_synced: true, nas_synced_la: new Date().toISOString(), nas_path: relPath })
        .eq('id', doc.id)
      if (updErr) throw new Error(`update documente_proiect: ${updErr.message}`)

      console.log(`  ✓ #${doc.id} ${relPath}`)
      ok++
    } catch (err) {
      console.error(`  ✗ #${doc.id} ${doc.nume_fisier}: ${err.message}`)
      fail++
    }
  }
  console.log(`\nGata: ${ok} sincronizate, ${skip} fără mapare, ${fail} eșuate.`)
}

main().catch(e => { console.error('Eroare fatală:', e); process.exit(1) })
