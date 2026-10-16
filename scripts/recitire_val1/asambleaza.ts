// Recitirea valului 1, pasul 2 (procedura §4): asamblarea + raportul, local, determinist, fără AI, fără scrieri în BD.
// Intrare: <dir>/rulare.json (de la citeste.ts). Ieșire în <dir>: texte.csv (document_id, text_b64), manifest.json,
// manifest_candidat.csv (formatul lui manifest_aprobat.csv; excepțiile nominale de calitate le completează chat-ul cu Răzvan),
// preview.md. Utilizare: deno run -A scripts/recitire_val1/asambleaza.ts <dir>   (mediu: ca la citeste.ts)
import { acoperire, asambleaza, conventieGrup, criterii, diferente, type Felie, normalizeazaFelie, radacinaParte, raport, type Raport,
  sha256Hex, WHITELIST } from './lib.ts'
import type { Amprenta, Stare } from './citeste.ts'

export type DocBD = { id: number; licitatie_id: number; nume_original: string; text_extras: string; pagini: number; status_procesare: string
  pagini_necitite: number[]; procesat_la: string; pagini_procesate: number; pagini_felie: number | null; fisier_path: string
  size_bytes: number | null; pagina_offset: number }
export type Intrare = { document_id: number; doc: DocBD; amprenta: Amprenta; felii: Felie[] }
export type Iesire = {
  document_id: number; licitatie_id: number; pagini: number; sha_vechi: string; sha_nou: string | null; text_nou: string | null
  identitate: { fisier_path: string; size_bytes: number | null; pagina_offset: number; pdf_sha256: string; storage_etag: string | null
    storage_size: number | null; storage_updated_at: string | null }
  meta_vechi: { status_procesare: string; pagini_necitite: number[]; procesat_la: string; pagini_procesate: number; pagini_felie: number | null }
  raport_vechi: Raport; raport_nou: Raport | null; diferente: ReturnType<typeof diferente>
  integritate_ok: boolean; calitate_ok: boolean; motive: string[]; staging_ids: number[]
}

export async function construieste(intrari: Intrare[]): Promise<Iesire[]> {
  // convenția pe GRUP de părți, separat pentru textele vechi și cele noi (212 + 213 împreună)
  const prima = new Map<string, Intrare[]>()
  for (const x of intrari) { const k = radacinaParte(x.doc.nume_original); prima.set(k, [...(prima.get(k) || []), x]) }
  const asamblat = new Map<number, { text: string | null; problema: string | null }>()
  for (const x of intrari) {
    if (!WHITELIST.includes(x.document_id as typeof WHITELIST[number])) throw new Error(`document în afara whitelist-ului: ${x.document_id}`)
    let problema = acoperire(x.felii, x.amprenta.pagini_pdf)
    const normalizate: Felie[] = []
    for (const f of x.felii) {
      const n = normalizeazaFelie(f.text, f.de_la, f.pana_la)
      if (n === null) { problema = problema ?? `marcaje felia ${f.de_la}-${f.pana_la}`; break }
      normalizate.push({ ...f, text: n })
    }
    if (x.amprenta.pagini_pdf !== x.doc.pagini) problema = problema ?? `pagini_pdf ${x.amprenta.pagini_pdf} ≠ pagini ${x.doc.pagini}`
    asamblat.set(x.document_id, { text: problema ? null : asambleaza(normalizate, x.doc.pagina_offset), problema })
  }
  const out: Iesire[] = []
  for (const grup of prima.values()) {
    const cVechi = conventieGrup(grup.map((x) => x.doc.text_extras))
    const noi = grup.map((x) => asamblat.get(x.document_id)!.text).filter((t): t is string => t !== null)
    const cNou = conventieGrup(noi.length === grup.length ? noi : grup.map((x) => asamblat.get(x.document_id)!.text ?? x.doc.text_extras))
    for (const x of grup) {
      const a = asamblat.get(x.document_id)!
      const rv = raport(x.doc.text_extras, x.doc.pagina_offset, x.doc.pagini, cVechi)
      const rn = a.text === null ? null : raport(a.text, x.doc.pagina_offset, x.doc.pagini, cNou)
      const cr = rn ? criterii(rn, rv, a.problema) : { integritate_ok: false, calitate_ok: false, motive: [a.problema ?? 'necitit'] }
      out.push({
        document_id: x.document_id, licitatie_id: x.doc.licitatie_id, pagini: x.doc.pagini,
        sha_vechi: await sha256Hex(x.doc.text_extras), sha_nou: a.text === null ? null : await sha256Hex(a.text), text_nou: a.text,
        identitate: { fisier_path: x.doc.fisier_path, size_bytes: x.doc.size_bytes, pagina_offset: x.doc.pagina_offset, pdf_sha256: x.amprenta.pdf_sha256,
          storage_etag: x.amprenta.storage.etag, storage_size: x.amprenta.storage.size, storage_updated_at: x.amprenta.storage.updated_at },
        meta_vechi: { status_procesare: x.doc.status_procesare, pagini_necitite: x.doc.pagini_necitite, procesat_la: x.doc.procesat_la,
          pagini_procesate: x.doc.pagini_procesate, pagini_felie: x.doc.pagini_felie },
        raport_vechi: rv, raport_nou: rn, diferente: a.text === null ? [] : diferente(x.doc.text_extras, a.text, cNou),
        ...cr, staging_ids: x.felii.map((f) => f.id),
      })
    }
  }
  return out.sort((p, q) => p.licitatie_id - q.licitatie_id || p.document_id - q.document_id)
}

// CSV (RFC 4180, LF), formatul citit de aplica.sql cu \copy … CSV HEADER
const CAMPURI = ['document_id', 'licitatie_id', 'pagini', 'sha_vechi', 'sha_nou', 'fisier_path', 'size_bytes', 'pagina_offset', 'pdf_sha256',
  'storage_etag', 'storage_size', 'storage_updated_at', 'meta_status_procesare', 'meta_pagini_necitite', 'meta_procesat_la',
  'meta_pagini_procesate', 'meta_pagini_felie', 'integritate_ok', 'calitate_ok', 'calitate_acceptata_nominal', 'motiv_acceptare'] as const
const cel = (v: unknown) => { if (v === null || v === undefined) return ''; const s = String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
export function manifestCsv(rows: Iesire[]): string {
  const linii = [CAMPURI.join(',')]
  for (const r of rows.filter((x) => x.integritate_ok)) {
    linii.push([r.document_id, r.licitatie_id, r.pagini, r.sha_vechi, r.sha_nou, r.identitate.fisier_path, r.identitate.size_bytes, r.identitate.pagina_offset,
      r.identitate.pdf_sha256, r.identitate.storage_etag, r.identitate.storage_size, r.identitate.storage_updated_at, r.meta_vechi.status_procesare,
      `{${r.meta_vechi.pagini_necitite.join(',')}}`, r.meta_vechi.procesat_la, r.meta_vechi.pagini_procesate, r.meta_vechi.pagini_felie,
      r.integritate_ok, r.calitate_ok, false, ''].map(cel).join(','))
  }
  return linii.join('\n') + '\n'
}
const b64 = (s: string) => { const b = new TextEncoder().encode(s); let x = ''; for (let i = 0; i < b.length; i += 8192) x += String.fromCharCode(...b.subarray(i, i + 8192)); return btoa(x) }
export const texteCsv = (rows: Iesire[]) => 'document_id,text_b64\n' + rows.filter((r) => r.text_nou !== null).map((r) => `${r.document_id},${b64(r.text_nou!)}`).join('\n') + '\n'
export function previewMd(rows: Iesire[], consumUsd: number): string {
  const l = [`# Recitirea valului 1 — preview`, '', `Cost citire (confirmat): ${consumUsd.toFixed(4)} USD.`, '',
    '| Doc | Lic | Pagini | Integritate | Calitate | Cantități m (vechi → nou) | Suma m (vechi → nou) | Pagini inventate (vechi → nou) | Lipsă (nou) | Motive |',
    '|---|---|---|---|---|---|---|---|---|---|']
  for (const r of rows) l.push(`| ${r.document_id} | ${r.licitatie_id} | ${r.pagini} | ${r.integritate_ok ? 'da' : 'NU'} | ${r.calitate_ok ? 'da' : 'NU'} | ${r.raport_vechi.cantitati_m} → ${r.raport_nou?.cantitati_m ?? '—'} | ${r.raport_vechi.suma_m} → ${r.raport_nou?.suma_m ?? '—'} | ${r.raport_vechi.pagini_inventate.length} → ${r.raport_nou?.pagini_inventate.length ?? '—'} | ${r.raport_nou?.pagini_lipsa.length ?? '—'} | ${r.motive.join('; ')} |`)
  l.push('', '## Diferențe de cantități (primele 20 per document, pentru verificarea în PDF)', '')
  for (const r of rows) if (r.diferente.length) {
    l.push(`### ${r.document_id}`, '', '| Pagina | Vechi | Nou |', '|---|---|---|')
    for (const d of r.diferente) l.push(`| ${d.pagina ?? '—'} | ${d.vechi.join(', ')} | ${d.nou.join(', ')} |`)
    l.push('')
  }
  return l.join('\n') + '\n'
}

if (import.meta.main) {
  const dir = Deno.args[0]
  if (!dir) { console.error('utilizare: asambleaza.ts <dir>'); Deno.exit(2) }
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.39.0')
  const env = (k: string) => { const v = Deno.env.get(k); if (!v) { console.error(`lipsește ${k}`); Deno.exit(2) } return v! }
  const sb = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { auth: { persistSession: false } })
  if ((await sb.auth.signInWithPassword({ email: env('RV1_EMAIL'), password: env('RV1_PAROLA') })).error) { console.error('autentificare eșuată'); Deno.exit(2) }
  const s: Stare = JSON.parse(await Deno.readTextFile(`${dir}/rulare.json`))
  const intrari: Intrare[] = []
  for (const r of s.documente.filter((x) => x.stare === 'citit')) {
    const { data: doc, error } = await sb.from('ofertare_documente_atribuire')
      .select('id, licitatie_id, nume_original, text_extras, pagini, status_procesare, pagini_necitite, procesat_la, pagini_procesate, pagini_felie, fisier_path, size_bytes, pagina_offset')
      .eq('id', r.document_id).single()
    if (error || !doc) { console.error(`document ${r.document_id}: ${error?.message}`); Deno.exit(4) }
    const { data: st, error: e2 } = await sb.from('ofertare_citire_test').select('id, doc_id, model, pagina_de_la, pagina_pana_la, text').in('id', r.felii.map((f) => f.id))
    if (e2) { console.error(`staging: ${e2.message}`); Deno.exit(4) }
    const felii: Felie[] = r.felii.map((f) => {
      const x = (st || []).find((y: any) => y.id === f.id)
      if (!x || x.doc_id !== r.document_id || x.model !== 'claude-haiku-5-5' || x.pagina_de_la !== f.de_la || x.pagina_pana_la !== f.pana_la || !x.text) {
        console.error(`staging ${f.id} nu corespunde rulării`); Deno.exit(4)
      }
      return { id: f.id, de_la: f.de_la, pana_la: f.pana_la, text: x.text }
    })
    intrari.push({ document_id: r.document_id, doc: doc as DocBD, amprenta: r.amprenta!, felii })
  }
  const rows = await construieste(intrari)
  const esuate = s.documente.filter((x) => x.stare === 'esuat').map((x) => `| ${x.document_id} | — | — | NU (citire: ${x.motiv}) |`)
  const consumUsd = s.apeluri.reduce((x, a) => x + (a.stare === 'confirmat' ? (a.cost_usd ?? 0) : a.rezervat_usd), 0)
  await Deno.writeTextFile(`${dir}/manifest.json`, JSON.stringify(rows.map(({ text_nou: _t, ...r }) => r), null, 1))
  await Deno.writeTextFile(`${dir}/manifest_candidat.csv`, manifestCsv(rows))
  await Deno.writeTextFile(`${dir}/texte.csv`, texteCsv(rows))
  await Deno.writeTextFile(`${dir}/preview.md`, previewMd(rows, consumUsd) + (esuate.length ? `\n## Documente necitite\n\n| Doc | | | Motiv |\n|---|---|---|---|\n${esuate.join('\n')}\n` : ''))
  console.log(JSON.stringify({ trec: rows.filter((r) => r.integritate_ok && r.calitate_ok).map((r) => r.document_id),
    doar_calitate: rows.filter((r) => r.integritate_ok && !r.calitate_ok).map((r) => r.document_id),
    nu_trec: rows.filter((r) => !r.integritate_ok).map((r) => r.document_id) }))
}
