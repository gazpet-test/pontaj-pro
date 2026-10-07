// R6 (Copilot, 25.09.2026): dovada de integritate pe traseul ACTIV — original SEAP → manifest → obiect Storage.
// Pentru documentele aduse ÎNAINTE de manifest (ex. Jilava #93, 23.09) nu există amprentă. Scriptul:
//   1. re-descarcă din SEAP fiecare document al licitației (fără .p7s), despachetează arhivele cu extractorul izolat;
//   2. pentru fiecare fișier rezultat caută documentul din platformă (aceeași cheie de nume ca importul),
//      descarcă obiectul din Storage și compară SHA-256 + mărimea;
//   3. scrie câte un rând în ofertare_seap_manifest (stare 'deja_in_platforma' | 'ignorat' | 'eroare_urcare' = lipsă).
//      Un rând 'urcat' (dovada sha a importului, _shared/identitateFisier.mjs, #643) rămâne 'urcat' dacă Storage confirmă
//      același conținut; diferit → 'deja_in_platforma' cu motiv (dovada se invalidează explicit); Storage indisponibil → nu
//      se atinge. Audit Jakarinos 07.10 (#13): înainte, verificarea suprascria orice 'urcat' cu 'deja_in_platforma' — în
//      producție nu mai rămăsese niciun rând 'urcat', deci importurile nu mai aveau nicio dovadă sha.
// NU urcă nimic, NU atinge ofertare_documente_atribuire, NU pornește citiri AI. Conținut SEAP = input ostil,
// tratat de aceleași controale ca la import (listare + politică înainte de extragere).
import { listaSeap, descarca, volumRar, numeVolum, verificaListare, verificaVolume, pregatesteJob, listeazaIzolat, extrageIzolat, cheieNume } from './seap.ts'
import { desface, numeDesfacut } from '../../supabase/functions/_shared/semnaturaCms.mjs'

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0'

const sha = async (b: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', b as Uint8Array<ArrayBuffer>))].map(x => x.toString(16).padStart(2, '0')).join('')
const JUNK_RE = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini)(\/|$)/i
const ESTE_ARHIVA = /\.(zip|rar|7z)$/i
// Lock-ul de kernel nu protejează fiabil două apeluri din același proces.
const verificariActive = new Set<string>()

export type Raport = {
  licitatie: number; seap_documente: number; fisiere: number; identice: number; diferite: number
  lipsa_in_platforma: number; ignorate: number; manifest_scrise: number; uscat: boolean
  platforma_fara_seap: string[]; erori: string[]
}
type DocumentBd = { id: number; nume_original: string; fisier_path: string; size_bytes: number }

export async function verificaManifest(supa: SupabaseClient<any, any, any>, licId: number, opt: { uscat?: boolean; semnal?: AbortSignal; storage?: { url: string; cheie: string } } = {}): Promise<Raport> {
  const { uscat = false, semnal = new AbortController().signal } = opt
  let docs: { nume: string; url: string }[] = [], cookie = ''
  let dinBd: DocumentBd[] = []
  let inPlatforma = new Map<string, DocumentBd>()
  let scrise = 0
  const LUCRU = Deno.env.get('SEAP_LUCRU') ?? '/seap-work'
  const tmp = `${LUCRU}/verif_${licId}_${crypto.randomUUID()}`
  const lockPath = `${LUCRU}/verif_${licId}.lock`
  if (verificariActive.has(lockPath)) throw new Error(`verificare deja în curs pentru ${licId}`)
  verificariActive.add(lockPath)
  let lock: Deno.FsFile | undefined
  let lockObtinut = false
  let tmpCreat = false
  type Rand = { licitatie_id: number; arhiva_cheie: string; cale: string; marime: number; sha256: string; document_id: number | null; stare: string; motiv: string | null; verificat_la: string }
  const randuri: Rand[] = []
  const tally = { identice: 0, diferite: 0, lipsa: 0, ignorate: 0, erori: [] as string[] }
  const potrivite = new Set<number>()
  // dovezile existente ('urcat') pe (arhiva_cheie, cale) + documentele după id: verificarea le confirmă sau le invalidează
  const dovezi = new Map<string, { document_id: number | null; sha256: string }>()
  let dupaId = new Map<number, DocumentBd>()
  let faraScriere: string | null = null

  // `numeCautat` = numele sub care importul a urcat fișierul (după desfacerea semnăturii, var. B); `cale` rămâne cheia manifestului
  async function compara(arhivaCheie: string, cale: string, buf: Uint8Array, numeCautat: string = cale) {
    semnal.throwIfAborted()
    const rand: Rand = { licitatie_id: licId, arhiva_cheie: arhivaCheie, cale, marime: buf.length, sha256: await sha(buf), document_id: null, stare: 'deja_in_platforma', motiv: null, verificat_la: new Date().toISOString() }
    if (JUNK_RE.test(cale)) { rand.stare = 'ignorat'; rand.motiv = 'fișier de sistem (junk)'; tally.ignorate++; randuri.push(rand); return }
    // documentul în care importul a urcat EXACT această intrare (dovada 'urcat') are prioritate față de potrivirea pe nume
    const prec = dovezi.get(`${arhivaCheie}\u0000${cale}`)
    const dPrec = prec?.document_id != null ? dupaId.get(prec.document_id) : undefined
    const d = (dPrec && dPrec.fisier_path && !String(dPrec.fisier_path).includes('/neincarcat/') ? dPrec : undefined)
      ?? inPlatforma.get(cheieNume(numeCautat.split('/').pop()!)) ?? inPlatforma.get(cheieNume(numeCautat))
    if (!d) { rand.stare = 'eroare_urcare'; rand.motiv = 'LIPSĂ în platformă (verificare R6)'; tally.lipsa++; randuri.push(rand); return }
    rand.document_id = d.id; potrivite.add(d.id)
    const url = opt.storage?.url ?? Deno.env.get('SUPABASE_URL')
    const cheie = opt.storage?.cheie ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    semnal.throwIfAborted()
    // Storage necitit = nimic dovedit în niciun sens: rândul 'urcat' existent rămâne neatins
    if (!url || !cheie) { rand.motiv = 'Storage indisponibil: configurație lipsă'; tally.erori.push(`${cale}: ${rand.motiv}`); if (!prec) randuri.push(rand); return }
    const path = d.fisier_path.split('/').map(encodeURIComponent).join('/')
    const raspuns = await fetch(`${url.replace(/\/+$/, '')}/storage/v1/object/authenticated/ofertare/${path}`, {
      headers: { Authorization: `Bearer ${cheie}`, apikey: cheie }, signal: semnal,
    })
    if (raspuns.status !== 200) {
      await raspuns.body?.cancel()
      rand.motiv = `Storage indisponibil: HTTP ${raspuns.status}`; tally.erori.push(`${cale}: ${rand.motiv}`); if (!prec) randuri.push(rand); return
    }
    const stoc = new Uint8Array(await raspuns.arrayBuffer())
    const shaStoc = await sha(stoc)
    if (shaStoc === rand.sha256) {
      tally.identice++
      if (prec && prec.sha256 === rand.sha256 && prec.document_id === d.id) rand.stare = 'urcat'   // dovada confirmată, păstrată
    }
    else { tally.diferite++; rand.motiv = `DIFERIT de Storage: sha ${shaStoc.slice(0, 12)}… / ${stoc.length} B vs SEAP ${rand.sha256.slice(0, 12)}… / ${buf.length} B` }
    randuri.push(rand)
  }

  try {
    semnal.throwIfAborted()
    await Deno.mkdir(LUCRU, { recursive: true })
    lock = await Deno.open(lockPath, { create: true, write: true })
    lockObtinut = await lock.tryLock(true)
    if (!lockObtinut) throw new Error(`verificare deja în curs pentru ${licId}`)
    await Deno.mkdir(tmp)
    tmpCreat = true
    semnal.throwIfAborted()
    const { data: lic, error: eL } = await supa.from('ofertare_licitatii').select('c_notice_id, sys_notice_type_id').eq('id', licId).abortSignal(semnal).single()
    semnal.throwIfAborted()
    if (eL || !lic?.c_notice_id) throw new Error('licitația nu are anunț SEAP legat')
    ;({ docs, cookie } = await listaSeap(lic.c_notice_id, lic.sys_notice_type_id, semnal))
    semnal.throwIfAborted()
    const { data: dateBd } = await supa.from('ofertare_documente_atribuire').select('id, nume_original, fisier_path, size_bytes').eq('licitatie_id', licId).abortSignal(semnal)
    semnal.throwIfAborted()
    dinBd = dateBd || []
    inPlatforma = new Map((dinBd || []).filter(d => d.fisier_path && !String(d.fisier_path).includes('/neincarcat/'))
      .map(d => [cheieNume(d.nume_original), d]))
    dupaId = new Map(dinBd.map(d => [d.id, d]))
    const { data: dateDovezi, error: eDovezi } = await supa.from('ofertare_seap_manifest').select('arhiva_cheie, cale, document_id, sha256')
      .eq('licitatie_id', licId).eq('stare', 'urcat').abortSignal(semnal)
    semnal.throwIfAborted()
    // fără dovezile existente, o scriere le-ar putea suprascrie orbește → raportăm, dar nu scriem manifestul
    if (eDovezi) faraScriere = `manifest: dovezile existente nu s-au putut citi (${eDovezi.message}) — nu scriu nimic`
    for (const r of (dateDovezi || []) as { arhiva_cheie: string; cale: string; document_id: number | null; sha256: string }[]) dovezi.set(`${r.arhiva_cheie}\u0000${r.cale}`, r)

    // volumele RAR ale aceleiași arhive se tratează împreună
    const grupuri = new Map<string, typeof docs>()
    for (const d of docs) {
      const v = volumRar(d.nume.replace(/\.p7[ms]$/i, ''))
      const k = v ? `rar:${v.baza.toLowerCase()}` : `f:${d.nume}`
      grupuri.set(k, [...(grupuri.get(k) || []), d])
    }
    let n = 0
    for (const [k, grup] of grupuri) {
      const dir = `${tmp}/${n++}`
      semnal.throwIfAborted()
      try {
        await pregatesteJob(dir)
        const cifre = Math.max(1, ...grup.map(d => d.nume.match(/\.part(\d+)/i)?.[1].length ?? 1))
        grup.sort((a, b) => (volumRar(a.nume.replace(/\.p7[ms]$/i, ''))?.nr ?? 0) - (volumRar(b.nume.replace(/\.p7[ms]$/i, ''))?.nr ?? 0))
        const locale: { nume: string; cale: string; buf: Uint8Array }[] = []
        for (const doc of grup) {
          semnal.throwIfAborted()
          await descarca(doc, cookie, `${dir}/in/tmp.bin`, semnal)
          semnal.throwIfAborted()
          // aceeași desfacere ca importul (_shared/semnaturaCms.mjs): arhivă nedesfăcută = eroare; document nedesfăcut = brut
          const ds = desface(await Deno.readFile(`${dir}/in/tmp.bin`), doc.nume)
          if (ds.stare !== 'desfacut' && ds.stare !== 'nesemnat' && (k.startsWith('rar:') || ESTE_ARHIVA.test(numeDesfacut(doc.nume)))) throw new Error(`semnătura CMS: ${ds.motiv}`)
          const buf: Uint8Array = ds.buf
          const nume = ds.nume
          const vol = k.startsWith('rar:') ? volumRar(nume) : null
          const cale = `${dir}/in/${(vol ? numeVolum(vol, cifre) : nume).replace(/[\\/]/g, '_')}`
          await Deno.writeFile(cale, buf); await Deno.remove(`${dir}/in/tmp.bin`)
          locale.push({ nume, cale, buf })
        }
        if (k.startsWith('rar:')) { const e = verificaVolume(locale.map(l => volumRar(l.nume)?.nr ?? 0)); if (e) throw new Error(e) }
        if (k.startsWith('rar:') || (locale.length === 1 && ESTE_ARHIVA.test(locale[0].nume))) {
          const lst = await listeazaIzolat(dir, locale[0].cale.split('/').pop()!, undefined, semnal)
          const v = lst.code === 0 ? verificaListare(lst.out) : { ok: false as const, motiv: `7z l: ${(lst.err || lst.out).slice(-200)}` }
          if (!v.ok) throw new Error(v.motiv)
          const x = await extrageIzolat(dir, undefined, semnal)
          if (x.code !== 0) throw new Error(`extragere cod ${x.code}: ${x.motiv.slice(0, 200)}`)
          const arhivaCheie = cheieNume(grup[0].nume)
          const umbla = async (p: string, rel: string): Promise<void> => {
            for await (const e of Deno.readDir(p)) {
              semnal.throwIfAborted()
              const r = rel ? `${rel}/${e.name}` : e.name
              if (e.isDirectory) await umbla(`${p}/${e.name}`, r)
              else if (e.isFile) {   // copiii semnați: desfăcuți ca la import (#8), căutați după numele desfăcut
                const ds = desface(await Deno.readFile(`${p}/${e.name}`), r)
                await compara(arhivaCheie, r, ds.buf, ds.nume)
              }
            }
          }
          await umbla(`${dir}/out`, '')
        } else {
          await compara(cheieNume(locale[0].nume), locale[0].nume, locale[0].buf)
        }
      } catch (e) {
        semnal.throwIfAborted()
        tally.erori.push(`${grup[0].nume}: ${(e as Error)?.message ?? e}`)
      } finally {
        await Deno.remove(dir, { recursive: true }).catch(() => {})
      }
    }
    semnal.throwIfAborted()
    const unice = [...new Map(randuri.map(r => [`${r.arhiva_cheie}\u0000${r.cale}`, r])).values()]
    if (faraScriere) tally.erori.push(faraScriere)
    if (!uscat && !faraScriere) for (let i = 0; i < unice.length; i += 200) {
      semnal.throwIfAborted()
      const { error } = await supa.from('ofertare_seap_manifest').upsert(unice.slice(i, i + 200), { onConflict: 'licitatie_id,arhiva_cheie,cale' }).abortSignal(semnal)
      semnal.throwIfAborted()
      if (error) tally.erori.push(`manifest: ${error.message}`); else scrise += Math.min(200, unice.length - i)
    }
  } catch (e) {
    if (!semnal.aborted) throw e
    tally.erori.push('oprit la plafon')
  } finally {
    try {
      if (tmpCreat) await Deno.remove(tmp, { recursive: true }).catch(() => {})
      if (lock) {
        // Nu ștergem fișierul: procesele trebuie să blocheze mereu același obiect.
        try { if (lockObtinut) await lock.unlock() } finally { lock.close() }
      }
    } finally { verificariActive.delete(lockPath) }
  }
  // documente din platformă fără corespondent în SEAP (urcate de mână, derivate, felii) — se raportează, nu se ating
  const faraSeap = (dinBd || []).filter(d => !potrivite.has(d.id) && d.fisier_path && !String(d.fisier_path).includes('/neincarcat/')).map(d => d.nume_original)
  const unice = [...new Map(randuri.map(r => [`${r.arhiva_cheie}\u0000${r.cale}`, r])).values()]
  return { licitatie: licId, seap_documente: docs.length, fisiere: unice.length, identice: tally.identice, diferite: tally.diferite, lipsa_in_platforma: tally.lipsa, ignorate: tally.ignorate, manifest_scrise: scrise, uscat, platforma_fara_seap: faraSeap, erori: tally.erori }
}
