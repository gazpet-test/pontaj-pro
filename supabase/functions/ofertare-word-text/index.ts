// ofertare-word-text — textul din fișierele Word ale documentației de atribuire (11.09.2026).
//
// De ce există: poarta de completitudine a arătat 16 fișiere .doc/.docx care n-au intrat NICIODATĂ
// în corpus — printre ele acordul contractual și condițiile generale/specifice HG1 de la Mostiștea,
// și formularele de la Domnești și Potlogi. Cerințele acelor licitații au fost extrase fără ele.
//
// Cum: un .docx ESTE o arhivă zip cu `word/document.xml` înăuntru. Se despachetează aici, în
// platformă, cu jszip (deja dependență în proiect) — fără Word, fără laptop, fără librărie nouă.
// Regula lui Răzvan (11.09.2026): tot ce se poate face în platformă, se face în platformă.
//
// Ce NU face: `.doc` vechi (binar, dinainte de 2007) n-are parser curat — acelea se resalvează ca
// .docx și reintră pe același flux. Funcția le respinge explicit, nu se preface că le-a citit.
//
// Paginile: un .docx n-are paginație fixă (depinde de imprimantă și de fonturi), deci `pagini`
// rămâne NULL, iar cerințele extrase de aici vor purta „document Word, fără paginație fixă”
// la proveniență — la fel ca în UI. Nu inventăm numere de pagină.
//
// Auth: JWT de utilizator (functions.invoke din UI) SAU x-radar-secret (rutine).
// Body: {doc_id} pentru un document, sau {licitatie_id} pentru toate Word-urile unei licitații.
//       {dry_run: true} → întoarce ce ar extrage, fără să scrie nimic.
// Erorile de business se întorc în răspuns, nu se aruncă (throw în try + update în catch omoară workerul).
import { createClient } from 'npm:@supabase/supabase-js@2'
import JSZip from 'npm:jszip@3.10.1'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-radar-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
}
const BUCKET = 'ofertare'
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: CORS })

// Secretul NU stă în sursă: repo-ul e public. Verificare prin RPC contra Vault, care acceptă și
// valoarea precedentă cât ține fereastra de rotire, ca să nu pice cron-urile toate deodată.
async function secretOk(req: Request): Promise<boolean> {
  const s = req.headers.get('x-radar-secret')
  if (!s) return false
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data, error } = await db.rpc('fn_verifica_radar_secret', { p_secret: s })
  return !error && data === true
}

const ENTITATI: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

// XML-ul Word → text citibil. Ordinea contează: întâi marcajele care devin separatori
// (paragraf, rând de tabel, celulă, tab, break), abia apoi se rad restul tagurilor.
function xmlToText(xml: string): string {
  return xml
    .replace(/<w:tab\b[^>]*\/?>/g, '\t')
    .replace(/<w:br\b[^>]*\/?>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<\/w:tc>/g, ' | ')     // celulele de tabel — formularele sunt aproape numai tabele
    .replace(/<\/w:tr>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|apos);/g, (_m, e) => ENTITATI[e])
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/ \| (?=\n)/g, '')
    .trim()
}

async function textDinDocx(bytes: Uint8Array): Promise<{ text: string; parti: number }> {
  const zip = await JSZip.loadAsync(bytes)
  // corpul + antetele/subsolurile: în formulare, numărul formularului stă adesea în antet
  const nume = Object.keys(zip.files).filter(n =>
    n === 'word/document.xml' || /^word\/(header|footer)\d*\.xml$/.test(n))
  nume.sort((a, b) => (a === 'word/document.xml' ? -1 : b === 'word/document.xml' ? 1 : a.localeCompare(b)))
  const bucati: string[] = []
  for (const n of nume) {
    const xml = await zip.file(n)!.async('string')
    const t = xmlToText(xml)
    if (t) bucati.push(t)
  }
  return { text: bucati.join('\n\n'), parti: bucati.length }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const SUPA_URL = Deno.env.get('SUPABASE_URL')!
  const db = createClient(SUPA_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  if (!(await secretOk(req))) {
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
    if (!jwt) return json({ error: 'fără autentificare' }, 401)
    const uc = createClient(SUPA_URL, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: `Bearer ${jwt}` } } })
    const { data: u } = await uc.auth.getUser()
    if (!u?.user) return json({ error: 'token invalid' }, 401)
  }

  let body: any = {}; try { body = await req.json() } catch { /* gol */ }
  const docId = Number(body.doc_id) || null
  const licId = Number(body.licitatie_id) || null
  const dryRun = body.dry_run === true
  if (!docId && !licId) return json({ error: 'dă doc_id sau licitatie_id' }, 400)

  let q = db.from('ofertare_documente_atribuire')
    .select('id, licitatie_id, nume_original, fisier_path, text_extras, status_procesare')
  q = docId ? q.eq('id', docId) : q.eq('licitatie_id', licId)
  const { data: randuri, error: qErr } = await q.order('id')
  if (qErr) return json({ error: 'citire documente: ' + qErr.message })
  if (!randuri?.length) return json({ error: 'niciun document găsit' }, 404)

  const deLucru = randuri.filter(r => /\.(docx|doc)$/i.test(r.nume_original || ''))
  if (!deLucru.length) return json({ ok: true, nota: 'niciun fișier Word aici', verificate: randuri.length })

  const rezultate: any[] = []
  for (const r of deLucru) {
    const vechi = (r.text_extras || '').length
    if (/\.doc$/i.test(r.nume_original)) {
      rezultate.push({ id: r.id, fisier: r.nume_original, stare: 'nesuportat',
        nota: '.doc binar (pre-2007) — n-are parser; resalvează-l ca .docx și reîncarcă-l' })
      continue
    }
    if (!r.fisier_path) {
      rezultate.push({ id: r.id, fisier: r.nume_original, stare: 'eroare', nota: 'fără fisier_path' })
      continue
    }
    const { data: blob, error: dlErr } = await db.storage.from(BUCKET).download(r.fisier_path)
    if (dlErr || !blob) {
      rezultate.push({ id: r.id, fisier: r.nume_original, stare: 'eroare', nota: 'download: ' + (dlErr?.message || 'lipsă') })
      continue
    }
    let text = '', parti = 0
    try {
      const out = await textDinDocx(new Uint8Array(await blob.arrayBuffer()))
      text = out.text; parti = out.parti
    } catch (e) {
      rezultate.push({ id: r.id, fisier: r.nume_original, stare: 'eroare', nota: 'despachetare: ' + String(e) })
      continue
    }
    if (text.length < 50) {
      rezultate.push({ id: r.id, fisier: r.nume_original, stare: 'gol',
        nota: `doar ${text.length} caractere — probabil document scanat pus într-un Word` })
      continue
    }
    if (dryRun) {
      rezultate.push({ id: r.id, fisier: r.nume_original, stare: 'ar_scrie', caractere: text.length, parti,
        inceput: text.slice(0, 300) })
      continue
    }
    const { error: upErr } = await db.from('ofertare_documente_atribuire').update({
      text_extras: text,
      status_procesare: 'procesat',
      // pagini rămâne NULL intenționat: .docx n-are paginație fixă, n-o inventăm
      pagini_procesate: 0,
      procesat_la: new Date().toISOString(),
      eroare: `text extras din .docx în platformă (${parti} părți, ${text.length} caractere) — fără paginație fixă`,
    }).eq('id', r.id)
    if (upErr) { rezultate.push({ id: r.id, fisier: r.nume_original, stare: 'eroare', nota: 'update: ' + upErr.message }); continue }
    rezultate.push({ id: r.id, fisier: r.nume_original, stare: 'scris', caractere: text.length, parti, inainte: vechi })
  }

  const n = (s: string) => rezultate.filter(x => x.stare === s).length
  return json({
    ok: true, dry_run: dryRun, total: deLucru.length,
    scrise: n('scris'), ar_scrie: n('ar_scrie'), nesuportate: n('nesuportat'), goale: n('gol'), erori: n('eroare'),
    rezultate,
  })
})
