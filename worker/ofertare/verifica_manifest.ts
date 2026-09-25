// R6 (Copilot, 25.09.2026): dovada de integritate pe traseul ACTIV — original SEAP → manifest → obiect Storage.
// Pentru documentele aduse ÎNAINTE de manifest (ex. Jilava #93, 23.09) nu există amprentă. Scriptul:
//   1. re-descarcă din SEAP fiecare document al licitației (fără .p7s), despachetează arhivele cu extractorul izolat;
//   2. pentru fiecare fișier rezultat caută documentul din platformă (aceeași cheie de nume ca importul),
//      descarcă obiectul din Storage și compară SHA-256 + mărimea;
//   3. scrie câte un rând în ofertare_seap_manifest (stare 'deja_in_platforma' | 'ignorat' | 'eroare_urcare' = lipsă).
// NU urcă nimic, NU atinge ofertare_documente_atribuire, NU pornește citiri AI. Conținut SEAP = input ostil,
// tratat de aceleași controale ca la import (listare + politică înainte de extragere).
// Rulare: docker exec gazpet-ofertare-worker deno run -A /app/worker/ofertare/verifica_manifest.ts <licitatie_id> [--uscat]
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0'
import { listaSeap, descarca, continutP7s, volumRar, numeVolum, verificaListare, verificaVolume, pregatesteJob, listeazaIzolat, extrageIzolat, cheieNume } from './seap.ts'

const licId = Number(Deno.args[0])
const uscat = Deno.args.includes('--uscat')
if (!licId) { console.error('folosire: verifica_manifest.ts <licitatie_id> [--uscat]'); Deno.exit(2) }
const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
const sha = async (b: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', b))].map(x => x.toString(16).padStart(2, '0')).join('')
const JUNK_RE = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini)(\/|$)/i
const ESTE_ARHIVA = /\.(zip|rar|7z)$/i

const { data: lic, error: eL } = await supa.from('ofertare_licitatii').select('c_notice_id, sys_notice_type_id').eq('id', licId).single()
if (eL || !lic?.c_notice_id) { console.error('licitația nu are anunț SEAP legat'); Deno.exit(1) }
const { docs, cookie } = await listaSeap(lic.c_notice_id, lic.sys_notice_type_id)
const { data: dinBd } = await supa.from('ofertare_documente_atribuire').select('id, nume_original, fisier_path, size_bytes').eq('licitatie_id', licId)
const inPlatforma = new Map((dinBd || []).filter(d => d.fisier_path && !String(d.fisier_path).includes('/neincarcat/'))
  .map(d => [cheieNume(d.nume_original), d]))

type Rand = { licitatie_id: number; arhiva_cheie: string; cale: string; marime: number; sha256: string; document_id: number | null; stare: string; motiv: string | null; verificat_la: string }
const randuri: Rand[] = []
const tally = { identice: 0, diferite: 0, lipsa: 0, ignorate: 0, erori: [] as string[] }
const potrivite = new Set<number>()

async function compara(arhivaCheie: string, cale: string, buf: Uint8Array) {
  const rand: Rand = { licitatie_id: licId, arhiva_cheie: arhivaCheie, cale, marime: buf.length, sha256: await sha(buf), document_id: null, stare: 'deja_in_platforma', motiv: null, verificat_la: new Date().toISOString() }
  if (JUNK_RE.test(cale)) { rand.stare = 'ignorat'; rand.motiv = 'fișier de sistem (junk)'; tally.ignorate++; randuri.push(rand); return }
  const d = inPlatforma.get(cheieNume(cale.split('/').pop()!)) ?? inPlatforma.get(cheieNume(cale))
  if (!d) { rand.stare = 'eroare_urcare'; rand.motiv = 'LIPSĂ în platformă (verificare R6)'; tally.lipsa++; randuri.push(rand); return }
  rand.document_id = d.id; potrivite.add(d.id)
  const { data: blob, error } = await supa.storage.from('ofertare').download(d.fisier_path)
  if (error || !blob) { rand.motiv = `Storage indisponibil: ${error?.message ?? 'gol'}`; tally.erori.push(`${cale}: ${rand.motiv}`); randuri.push(rand); return }
  const stoc = new Uint8Array(await blob.arrayBuffer())
  const shaStoc = await sha(stoc)
  if (shaStoc === rand.sha256) tally.identice++
  else { tally.diferite++; rand.motiv = `DIFERIT de Storage: sha ${shaStoc.slice(0, 12)}… / ${stoc.length} B vs SEAP ${rand.sha256.slice(0, 12)}… / ${buf.length} B` }
  randuri.push(rand)
}

// volumele RAR ale aceleiași arhive se tratează împreună
const grupuri = new Map<string, typeof docs>()
for (const d of docs) {
  const v = volumRar(d.nume.replace(/\.p7s$/i, ''))
  const k = v ? `rar:${v.baza.toLowerCase()}` : `f:${d.nume}`
  grupuri.set(k, [...(grupuri.get(k) || []), d])
}
const LUCRU = Deno.env.get('SEAP_LUCRU') ?? '/seap-work'
const tmp = `${LUCRU}/verif_${licId}`
await Deno.remove(tmp, { recursive: true }).catch(() => {})
let n = 0
for (const [k, grup] of grupuri) {
  const dir = `${tmp}/${n++}`
  await pregatesteJob(dir)
  try {
    const cifre = Math.max(1, ...grup.map(d => d.nume.match(/\.part(\d+)/i)?.[1].length ?? 1))
    grup.sort((a, b) => (volumRar(a.nume.replace(/\.p7s$/i, ''))?.nr ?? 0) - (volumRar(b.nume.replace(/\.p7s$/i, ''))?.nr ?? 0))
    const locale: { nume: string; cale: string; buf: Uint8Array }[] = []
    for (const doc of grup) {
      await descarca(doc, cookie, `${dir}/in/tmp.bin`)
      let buf = await Deno.readFile(`${dir}/in/tmp.bin`)
      let nume = doc.nume
      if (/\.p7s$/i.test(nume)) { buf = continutP7s(buf); nume = nume.replace(/\.p7s$/i, '') }
      const vol = k.startsWith('rar:') ? volumRar(nume) : null
      const cale = `${dir}/in/${(vol ? numeVolum(vol, cifre) : nume).replace(/[\\/]/g, '_')}`
      await Deno.writeFile(cale, buf); await Deno.remove(`${dir}/in/tmp.bin`)
      locale.push({ nume, cale, buf })
    }
    if (k.startsWith('rar:')) { const e = verificaVolume(locale.map(l => volumRar(l.nume)?.nr ?? 0)); if (e) throw new Error(e) }
    if (k.startsWith('rar:') || (locale.length === 1 && ESTE_ARHIVA.test(locale[0].nume))) {
      const lst = await listeazaIzolat(dir, locale[0].cale.split('/').pop()!)
      const v = lst.code === 0 ? verificaListare(lst.out) : { ok: false as const, motiv: `7z l: ${(lst.err || lst.out).slice(-200)}` }
      if (!v.ok) throw new Error(v.motiv)
      const x = await extrageIzolat(dir)
      if (x.code !== 0) throw new Error(`extragere cod ${x.code}: ${x.motiv.slice(0, 200)}`)
      const arhivaCheie = cheieNume(grup[0].nume)
      const umbla = async (p: string, rel: string): Promise<void> => {
        for await (const e of Deno.readDir(p)) {
          const r = rel ? `${rel}/${e.name}` : e.name
          if (e.isDirectory) await umbla(`${p}/${e.name}`, r)
          else if (e.isFile) await compara(arhivaCheie, r, await Deno.readFile(`${p}/${e.name}`))
        }
      }
      await umbla(`${dir}/out`, '')
    } else {
      await compara(cheieNume(locale[0].nume), locale[0].nume, locale[0].buf)
    }
  } catch (e) {
    tally.erori.push(`${grup[0].nume}: ${(e as Error)?.message ?? e}`)
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {})
  }
}
await Deno.remove(tmp, { recursive: true }).catch(() => {})

// documente din platformă fără corespondent în SEAP (urcate de mână, derivate, felii) — se raportează, nu se ating
const faraSeap = (dinBd || []).filter(d => !potrivite.has(d.id) && d.fisier_path && !String(d.fisier_path).includes('/neincarcat/')).map(d => d.nume_original)
const unice = [...new Map(randuri.map(r => [`${r.arhiva_cheie}\u0000${r.cale}`, r])).values()]
let scrise = 0
if (!uscat) for (let i = 0; i < unice.length; i += 200) {
  const { error } = await supa.from('ofertare_seap_manifest').upsert(unice.slice(i, i + 200), { onConflict: 'licitatie_id,arhiva_cheie,cale' })
  if (error) tally.erori.push(`manifest: ${error.message}`); else scrise += Math.min(200, unice.length - i)
}
console.log(JSON.stringify({ licitatie: licId, seap_documente: docs.length, fisiere: unice.length, identice: tally.identice, diferite: tally.diferite, lipsa_in_platforma: tally.lipsa, ignorate: tally.ignorate, manifest_scrise: scrise, uscat, platforma_fara_seap: faraSeap, erori: tally.erori }, null, 1))
