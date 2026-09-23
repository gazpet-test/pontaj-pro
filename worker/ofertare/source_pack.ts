// worker/ofertare/source_pack.ts — P0b (23.09.2026): pack-urile validate de containerul claude-cli (out/*.pack.json, montat
// în worker ca /packs) intră în ofertare_source_pack. ATÂT. Workerul NU scrie în ofertare_cerinte (importul e o apăsare umană,
// prin fn_ofertare_source_pack_import, P0c). Rânduri: unul per pack_hash (sha256 al fișierului) — același fișier de două ori
// nu creează duplicat. Pack invalid → rând cu stare='respins' + motiv în nota (când identitatea licitației e cunoscută),
// altfel doar sidecar .respins lângă fișier. Fișierul procesat primește sidecar <nume>.importat / <nume>.respins.
// Conținutul pack-ului e conținut EXTERN (scris de model din documentele autorității): se verifică și se stochează, nu se execută.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0'

const PACKS_DIR = Deno.env.get('PACKS_DIR') ?? '/packs'
const VECHIME_MIN_MS = 30_000     // un fișier scris în ultimele 30 s poate fi încă în scriere
let dirAnuntat = false
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(0, 19).replace('T', ' '), '[source_pack]', ...a)

async function sha256Hex(b: Uint8Array): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', b)
  return [...new Uint8Array(h)].map(x => x.toString(16).padStart(2, '0')).join('')
}
async function exista(p: string) { try { await Deno.stat(p); return true } catch { return false } }
async function sidecar(p: string, continut: Record<string, unknown>) {
  try { await Deno.writeTextFile(p, JSON.stringify({ la: new Date().toISOString(), ...continut }, null, 1)) } catch (e) { log('sidecar nescris', p, (e as Error)?.message) }
}

// verificări fără AI; întoarce lista de motive (goală = valid)
function verifica(pack: any): string[] {
  const m: string[] = []
  if (!pack || typeof pack !== 'object') return ['nu e obiect JSON']
  if (pack.schema !== 'gazpet.source_pack/v1') m.push('schema ≠ gazpet.source_pack/v1')
  for (const k of ['documente', 'cerinte', 'nereusite']) if (!Array.isArray(pack[k])) m.push(`lipsește lista "${k}"`)
  if (!pack.licitatie || !Number.isInteger(pack.licitatie.licitatie_id)) m.push('licitatie.licitatie_id lipsă (launcher fără LIC_ID)')
  if (!pack.validare || typeof pack.validare !== 'object') m.push('lipsește "validare" (pack-ul nu a trecut prin verifica_pack.mjs)')
  else if (Array.isArray(pack.validare.probleme_schema) && pack.validare.probleme_schema.length) m.push('validator: ' + pack.validare.probleme_schema.join('; '))
  if (Array.isArray(pack.cerinte)) {
    const refs = new Set<string>()
    for (const c of pack.cerinte) {
      if (!c || typeof c.ref !== 'string' || !c.ref) { m.push('cerință fără ref'); break }
      if (refs.has(c.ref)) { m.push(`ref duplicat în pack: ${c.ref}`); break }
      refs.add(c.ref)
      if (!c.locator || typeof c.locator.nume_fisier !== 'string') { m.push(`${c.ref}: locator fără nume_fisier`); break }
      if (c.locator.verificat !== 'pagina' && c.locator.verificat !== 'document') { m.push(`${c.ref}: locator.verificat lipsă (validator vechi?)`); break }
    }
  }
  return m
}

export async function proceseazaSourcePacks(supabase: SupabaseClient, stare: (s: string) => void) {
  if (!(await exista(PACKS_DIR))) { if (!dirAnuntat) { log(`${PACKS_DIR} nu e montat — nu procesez pack-uri`); dirAnuntat = true } return }
  const fisiere: string[] = []
  for await (const e of Deno.readDir(PACKS_DIR)) if (e.isFile && e.name.endsWith('.pack.json')) fisiere.push(e.name)
  fisiere.sort()
  for (const nume of fisiere) {
    const cale = `${PACKS_DIR}/${nume}`
    if (await exista(cale + '.importat') || await exista(cale + '.respins')) continue
    const st = await Deno.stat(cale)
    if (st.mtime && Date.now() - st.mtime.getTime() < VECHIME_MIN_MS) continue
    stare(nume)
    const bytes = await Deno.readFile(cale)
    const hash = await sha256Hex(bytes), size = bytes.length
    let pack: any = null, motive: string[] = []
    try { pack = JSON.parse(new TextDecoder().decode(bytes)) } catch (e) { motive = ['JSON neparsabil: ' + String((e as Error)?.message).slice(0, 120)] }
    if (!motive.length) motive = verifica(pack)

    // 6. idempotent pe pack_hash: același fișier de două ori ⇒ zero rânduri noi
    const { data: dup, error: eDup } = await supabase.from('ofertare_source_pack').select('id, stare').eq('pack_hash', hash).maybeSingle()
    if (eDup) { log(nume, 'citire pack_hash:', eDup.message); continue }
    if (dup) {
      log(`${nume}: pack_hash deja în BD (id ${dup.id}, ${dup.stare}) — nu creez duplicat`)
      await sidecar(cale + '.importat', { id: dup.id, pack_hash: hash, duplicat: true })
      continue
    }

    // identitate: licitatie_id din pack (pus de launcher) trebuie să existe și nr_anunt să coincidă cu ERP-ul
    const licId: number | null = pack?.licitatie && Number.isInteger(pack.licitatie.licitatie_id) ? pack.licitatie.licitatie_id : null
    let licDb: { id: number; nr_anunt: string | null } | null = null
    if (licId != null) {
      const { data } = await supabase.from('ofertare_licitatii').select('id, nr_anunt').eq('id', licId).maybeSingle()
      licDb = data ?? null
      if (!licDb) motive.push(`licitatie_id ${licId} nu există în ofertare_licitatii`)
      else if (pack.licitatie.nr_anunt && licDb.nr_anunt && String(pack.licitatie.nr_anunt) !== String(licDb.nr_anunt)) motive.push(`nr_anunt din pack (${pack.licitatie.nr_anunt}) ≠ ERP (${licDb.nr_anunt})`)
    }

    const r = pack?.rulare && typeof pack.rulare === 'object' ? pack.rulare : {}
    const rand: Record<string, unknown> = {
      licitatie_id: licId, stamp: r.stamp ?? nume.replace(/_source_pack\.pack\.json$/, ''), fisier: nume, pack_hash: hash, sursa: 'cli',
      model: r.model ?? null, cost_usd: r.cost_usd_estimat ?? null, ture: r.ture ?? null, durata_s: r.durata_s ?? null,
      pack: pack ?? { licitatie: { licitatie_id: licId }, brut_invalid: true }, validare: pack?.validare ?? null,
      nr_cerinte: Array.isArray(pack?.cerinte) ? pack.cerinte.length : null,
      nr_nereusite: Array.isArray(pack?.nereusite) ? pack.nereusite.length : null,
      nr_erate: Array.isArray(pack?.erate) ? pack.erate.length : null,
      stare: motive.length ? 'respins' : 'primit',
      nota: motive.length ? `respins de worker: ${motive.join('; ')}`.slice(0, 2000) : null,
    }
    // 7. pack invalid → respins cu motiv (rând în BD când identitatea e cunoscută; altfel doar sidecar)
    if (licId == null || !licDb) {
      log(`${nume}: RESPINS fără rând în BD (${motive.join('; ')})`)
      await sidecar(cale + '.respins', { pack_hash: hash, size_bytes: size, motive })
      continue
    }
    const { data: ins, error: eIns } = await supabase.from('ofertare_source_pack').insert(rand).select('id, stare').single()
    if (eIns) {
      if (/pack_hash/.test(eIns.message) && /duplicate|unique/i.test(eIns.message)) { log(`${nume}: duplicat concurent pe pack_hash`); await sidecar(cale + '.importat', { pack_hash: hash, duplicat: true }); continue }
      log(`${nume}: INSERT eșuat:`, eIns.message)
      continue   // fără sidecar: se reîncearcă la următorul ciclu
    }
    log(`${nume}: ${ins.stare} → ofertare_source_pack id ${ins.id} (lic ${licId}, ${rand.nr_cerinte} cerințe, ${rand.nr_nereusite} nereușite, sha256 ${hash.slice(0, 12)}…, ${size} B)${motive.length ? ' · ' + motive.join('; ') : ''}`)
    await sidecar(cale + (ins.stare === 'respins' ? '.respins' : '.importat'), { id: ins.id, stare: ins.stare, pack_hash: hash, size_bytes: size, motive })
  }
}
