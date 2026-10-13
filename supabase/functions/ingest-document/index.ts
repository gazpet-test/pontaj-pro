// ingest-document — primește atașamente din Apps Script (Gmail) și le pune
// în Storage (documente-proiect) + tabela documente_proiect.
// Auth: verify_jwt (anon key ca Bearer) + x-ingest-secret (secret partajat).
// Erorile de business se RETURNEAZĂ (json cu ok:false), nu se aruncă.
// v2: cheia de Storage transliterată ASCII (diacriticele rup upload-ul).
// v4: dedup PER PROIECT — mailurile comune (LOT 1, LOT 2) intră în ambele proiecte.
// v17 (13.10.2026, adusă în repo din producția v16):
//  - proiect_slug = '_de_repartizat' + candidati (etichete Gmail): mesajele cu 2+ proiecte neclare intră în
//    documente_de_repartizat (fișierul sub _de_repartizat/AAAA/LL/), NU într-un proiect ghicit. Repartizarea o face
//    un om din Execuție (fn_doc_repartizeaza). Dedup pe (gmail_message_id, nume_fisier).
//  - x-ingest-secret comparat în timp constant.
// Fișa de securitate (CLAUDE.md pct. 7):
//  (a) conținut extern: atașamente și metadate de mail (expeditor, subiect) — stocate ca date, niciodată interpretate;
//  (b) scrie: Storage documente-proiect + documente_proiect / documente_de_repartizat; nu trimite mail, nu atinge bani/drepturi;
//  (c) service_role: scriptul Gmail nu are cont de utilizator, iar tabelele nu au drept de INSERT pentru authenticated;
//  (d) pornire: doar cu INGEST_SECRET (Apps Script); verify_jwt cere și cheia anon;
//  (e) repartizarea din coadă cere om (owner / acces explicit executie) — nimic automat.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { esteDeRepartizat, parseCandidati, egalConstant, caleStorage, SLUG_DE_REPARTIZAT } from './candidati.js'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const sanitize = (name: string) =>
  name.replace(/[\/\\:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 180)

function decodeaza(b64: string): Uint8Array | null {
  try {
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return bytes
  } catch { return null }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'metoda_invalida' }, 405)

  const secret = Deno.env.get('INGEST_SECRET') || ''
  if (!egalConstant(req.headers.get('x-ingest-secret') || '', secret)) {
    return json({ ok: false, error: 'secret_invalid' }, 401)
  }

  let p: any
  try { p = await req.json() } catch { return json({ ok: false, error: 'json_invalid' }, 400) }

  const eticheta = String(p.proiect_slug || p.eticheta || '').trim()
  const messageId = String(p.gmail_message_id || '').trim()
  const numeFisier = sanitize(String(p.nume_fisier || ''))
  const b64 = String(p.continut_base64 || '')
  if (!eticheta || !messageId || !numeFisier || !b64) {
    return json({ ok: false, error: 'campuri_lipsa', necesare: ['proiect_slug', 'gmail_message_id', 'nume_fisier', 'continut_base64'] }, 400)
  }

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const dataMail = p.data_mail ? new Date(p.data_mail) : new Date()

  // ── Coada „de repartizat” (2+ proiecte candidate neclare) ──
  if (esteDeRepartizat(eticheta)) {
    const candidati = parseCandidati(p.candidati)
    const { data: existent } = await sb.from('documente_de_repartizat').select('id')
      .eq('gmail_message_id', messageId).eq('nume_fisier', numeFisier).maybeSingle()
    if (existent) return json({ ok: true, duplicat: true, id: existent.id, coada: true })
    const bytes = decodeaza(b64)
    if (!bytes) return json({ ok: false, error: 'base64_invalid' }, 400)
    const storagePath = caleStorage({ prefix: SLUG_DE_REPARTIZAT, dataMail, messageId, numeFisier })
    const { error: upErr } = await sb.storage.from('documente-proiect')
      .upload(storagePath, bytes, { contentType: p.mime_type || 'application/octet-stream', upsert: true })
    if (upErr) return json({ ok: false, error: 'storage_upload', detaliu: upErr.message }, 500)
    const { data: row, error: insErr } = await sb.from('documente_de_repartizat').insert({
      sursa: 'gmail', gmail_message_id: messageId, nume_fisier: numeFisier, mime_type: p.mime_type || null,
      marime_bytes: bytes.length, expeditor: p.expeditor || null, subiect: p.subiect || null,
      data_mail: dataMail.toISOString(), candidati, storage_path: storagePath,
      drive_file_id: p.drive_file_id || null, hash_sha256: p.hash_sha256 || null,
    }).select('id').single()
    if (insErr) {
      if (insErr.code === '23505') return json({ ok: true, duplicat: true, coada: true })
      return json({ ok: false, error: 'db_insert', detaliu: insErr.message }, 500)
    }
    return json({ ok: true, id: row.id, coada: true, candidati, storage_path: storagePath })
  }

  // Rezolvă proiectul după eticheta Gmail (case-insensitive)
  const { data: proiecte, error: pErr } = await sb
    .from('executie_proiecte')
    .select('id, nume, eticheta_gmail')
    .ilike('eticheta_gmail', eticheta)
    .limit(1)
  if (pErr) return json({ ok: false, error: 'db_proiect', detaliu: pErr.message }, 500)
  if (!proiecte?.length) return json({ ok: false, error: 'proiect_necunoscut', eticheta }, 422)
  const proiect = proiecte[0]

  // Dedup PER PROIECT înainte de upload
  const { data: existent } = await sb
    .from('documente_proiect')
    .select('id')
    .eq('proiect_id', proiect.id)
    .eq('gmail_message_id', messageId)
    .eq('nume_fisier', numeFisier)
    .maybeSingle()
  if (existent) return json({ ok: true, duplicat: true, id: existent.id })

  const bytes = decodeaza(b64)
  if (!bytes) return json({ ok: false, error: 'base64_invalid' }, 400)
  const storagePath = caleStorage({ prefix: String(proiect.id), dataMail, messageId, numeFisier })

  const { error: upErr } = await sb.storage
    .from('documente-proiect')
    .upload(storagePath, bytes, { contentType: p.mime_type || 'application/octet-stream', upsert: true })
  if (upErr) return json({ ok: false, error: 'storage_upload', detaliu: upErr.message }, 500)

  const { data: row, error: insErr } = await sb
    .from('documente_proiect')
    .insert({
      proiect_id: proiect.id,
      sursa: 'gmail',
      gmail_message_id: messageId,
      nume_fisier: numeFisier,
      mime_type: p.mime_type || null,
      marime_bytes: bytes.length,
      expeditor: p.expeditor || null,
      subiect: p.subiect || null,
      data_mail: dataMail.toISOString(),
      storage_path: storagePath,
      drive_file_id: p.drive_file_id || null,
      hash_sha256: p.hash_sha256 || null,
    })
    .select('id')
    .single()
  if (insErr) {
    if (insErr.code === '23505') return json({ ok: true, duplicat: true })
    return json({ ok: false, error: 'db_insert', detaliu: insErr.message }, 500)
  }

  return json({ ok: true, id: row.id, proiect: proiect.nume, storage_path: storagePath })
})
