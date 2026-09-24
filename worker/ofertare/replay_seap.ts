// Replay de ACCEPTARE pentru extractorul izolat (cerut de Copilot 24.09.2026): un set RAR real din SEAP trece
// prin extractorul instalat, cap-coadă, FĂRĂ urcare în Storage, fără coadă de citire, fără scrieri în BD.
// Verifică: listarea + politica, extragerea, CRC-ul fiecărui fișier față de antetul arhivei, SHA-256 (manifest),
// nume + mărimi față de documentele deja urcate, intrările și fișierele de control nemodificate, durata.
// Rulare în containerul workerului:  deno run -A /app/worker/ofertare/replay_seap.ts <licitatie_id>
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0'
import { listaSeap, descarca, continutP7s, volumRar, numeVolum, verificaListare, verificaVolume, pregatesteJob, listeazaIzolat, extrageIzolat, cheieNume } from './seap.ts'

const licId = Number(Deno.args[0])
const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('')
const sha = async (cale: string) => hex(await crypto.subtle.digest('SHA-256', await Deno.readFile(cale)))
const T = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
const crc32 = (b: Uint8Array) => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = T[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return ((c ^ 0xFFFFFFFF) >>> 0).toString(16).toUpperCase().padStart(8, '0') }

const { data: lic } = await supa.from('ofertare_licitatii').select('c_notice_id, sys_notice_type_id').eq('id', licId).single()
const { docs, cookie } = await listaSeap(lic!.c_notice_id, lic!.sys_notice_type_id)
const grup = docs.filter(d => volumRar(d.nume.replace(/\.p7s$/i, '')))
const baza = volumRar(grup[0].nume.replace(/\.p7s$/i, ''))!.baza
console.log(`#${licId}: ${grup.length} volume RAR „${baza}"`)
const cifre = Math.max(...grup.map(d => d.nume.match(/\.part(\d+)/i)![1].length))

const dir = `/seap-work/replay_${licId}/0`
await Deno.remove(`/seap-work/replay_${licId}`, { recursive: true }).catch(() => {})
await pregatesteJob(dir)
const t0 = Date.now()
const nr: number[] = []
let prima = ''
for (const d of grup) {
  await descarca(d, cookie, `${dir}/in/tmp.bin`)
  const buf = continutP7s(await Deno.readFile(`${dir}/in/tmp.bin`)); await Deno.remove(`${dir}/in/tmp.bin`)
  const v = volumRar(d.nume.replace(/\.p7s$/i, ''))!
  const nume = numeVolum(v, cifre); nr.push(v.nr); if (v.nr === 1) prima = nume
  await Deno.writeFile(`${dir}/in/${nume}`, buf)
}
console.log(`descărcat + p7s: ${((Date.now() - t0) / 1000).toFixed(0)} s; set: ${verificaVolume(nr) ?? 'complet'}`)

// santinele: amprenta intrărilor ȘI a fișierelor de control, înainte
const amprenta = async () => { const m: Record<string, string> = {}; for await (const e of Deno.readDir(`${dir}/in`)) m[e.name] = await sha(`${dir}/in/${e.name}`); return m }
const inainte = await amprenta()

const t1 = Date.now()
const lst = await listeazaIzolat(dir, prima)
const v = verificaListare(lst.out)
console.log(`listare: cod ${lst.code}, ${JSON.stringify(v)}, ${((Date.now() - t1) / 1000).toFixed(0)} s`)
if (!v.ok) Deno.exit(1)
const crcAsteptat = new Map<string, string>()
for (const b of lst.out.split(/\n\s*\n/)) { const p = b.match(/^Path = (.*)$/m)?.[1]; const c = b.match(/^CRC = (\w+)$/m)?.[1]; if (p && c) crcAsteptat.set(p.replace(/\\/g, '/'), c.toUpperCase()) }
const cerereInainte = await Deno.readTextFile(`${dir}/prima`)

const t2 = Date.now()
const x = await extrageIzolat(dir)
console.log(`extragere: cod ${x.code} (${x.motiv}), ${((Date.now() - t2) / 1000).toFixed(0)} s`)

// inventar + CRC + SHA-256
let n = 0, total = 0, crcOk = 0, crcRau: string[] = [], faraCrc = 0
const manifest: { cale: string; marime: number; sha256: string }[] = []
async function* toate(d: string, rel = ''): AsyncGenerator<string> { for await (const e of Deno.readDir(d)) { const r = rel ? `${rel}/${e.name}` : e.name; if (e.isDirectory) yield* toate(`${d}/${e.name}`, r); else yield r } }
for await (const rel of toate(`${dir}/out`)) {
  const b = await Deno.readFile(`${dir}/out/${rel}`); n++; total += b.length
  const c = crcAsteptat.get(rel)
  if (!c) faraCrc++; else if (c === crc32(b)) crcOk++; else crcRau.push(rel)
  manifest.push({ cale: rel, marime: b.length, sha256: hex(await crypto.subtle.digest('SHA-256', b)) })
}
console.log(`inventar: ${n} fișiere, ${(total / 2 ** 20).toFixed(0)} MB; CRC ok ${crcOk}, CRC greșit ${crcRau.length}${crcRau.length ? ' ' + crcRau.slice(0, 3).join(', ') : ''}, fără CRC în antet ${faraCrc}; listare declara ${v.intrari}`)

// față de documentele deja urcate (nume + mărime)
const { data: urcate } = await supa.from('ofertare_documente_atribuire').select('nume_original, size_bytes').eq('licitatie_id', licId)
const bd = new Map((urcate || []).map(d => [cheieNume(d.nume_original), d.size_bytes]))
let potrivite = 0; const difera: string[] = [], lipsaBd: string[] = []
for (const f of manifest) { const s = bd.get(cheieNume(f.cale)); if (s === undefined) lipsaBd.push(f.cale); else if (s === f.marime) potrivite++; else difera.push(`${f.cale} (${s}≠${f.marime})`) }
console.log(`față de BD: ${potrivite} identice ca nume+mărime, ${difera.length} cu altă mărime, ${lipsaBd.length} fără corespondent${lipsaBd.length ? ': ' + lipsaBd.slice(0, 5).join(' | ') : ''}`)

// intrările și controlul nemodificate
const dupa = await amprenta()
const inNeatins = JSON.stringify(inainte) === JSON.stringify(dupa)
console.log(`intrări neatinse: ${inNeatins}; prima neatinsă: ${cerereInainte === await Deno.readTextFile(`${dir}/prima`)}`)
const man = manifest.map(m => `${m.sha256}  ${m.marime}  ${m.cale}`).join('\n')
console.log(`manifest SHA-256 al întregului set: ${hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(man)))} (${manifest.length} rânduri)`)
await Deno.remove(`/seap-work/replay_${licId}`, { recursive: true })
console.log('REPLAY_GATA')
