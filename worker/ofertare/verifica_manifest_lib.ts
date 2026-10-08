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
//   Audit #4 var. B (PR-2, 08.10.2026): un DOCUMENT simplu al cărui cod SEAP stă pe un rând din platformă se compară cu
//      ACEL rând (versiunea / fratele „N (COD).ext”), cu cheia de manifest a rândului (ca la urcare: numele fără .p7s) —
//      altfel versiunea apărea „DIFERIT” față de rândul vechi cu același nume și îi retrograda dovada 'urcat'. Doi
//      documente cu același nume și coduri diferite (lic. 100) sunt verificate separat. Fără cod pe rând → pe nume, ca înainte.
// NU urcă nimic, NU atinge ofertare_documente_atribuire, NU pornește citiri AI. Conținut SEAP = input ostil,
// tratat de aceleași controale ca la import (listare + politică înainte de extragere).
import { listaSeap, descarca, volumRar, numeVolum, verificaListare, verificaVolume, pregatesteJob, listeazaIzolat, extrageIzolat, cheieNume } from './seap.ts'
import { desface, numeDesfacut } from '../../supabase/functions/_shared/semnaturaCms.mjs'
import { toatePaginile } from '../../supabase/functions/_shared/paginat.mjs'
import { numeVersiune } from '../../supabase/functions/_shared/codSeap.mjs'

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
type DocumentBd = { id: number; nume_original: string; fisier_path: string; size_bytes: number; seap_cod?: string | null }

export async function verificaManifest(supa: SupabaseClient<any, any, any>, licId: number, opt: { uscat?: boolean; semnal?: AbortSignal; storage?: { url: string; cheie: string } } = {}): Promise<Raport> {
  const { uscat = false, semnal = new AbortController().signal } = opt
  let docs: { nume: string; url: string; cod?: string }[] = [], cookie = ''
  let dinBd: DocumentBd[] = []
  let inPlatforma = new Map<string, DocumentBd>()
  let peCod = new Map<string, DocumentBd>()
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
  // dovezile existente pe (arhiva_cheie, cale) + documentele după id: verificarea le confirmă sau le invalidează.
  // 'urcat' = importul a urcat EXACT această intrare; 'deja_in_platforma' = importul a legat intrarea de un document existent
  // cu același sha (edge, PR #651) — ambele identifică documentul de verificat, dar doar 'urcat' se confirmă ca 'urcat'
  const dovezi = new Map<string, { document_id: number | null; sha256: string; stare: string }>()
  let dupaId = new Map<number, DocumentBd>()
  let faraScriere: string | null = null

  // obiectul unui document din Storage (fetch anulabil, cheia service doar în antet): sha + mărime, sau motivul pentru care nu s-a citit
  async function dinStorage(d: DocumentBd): Promise<{ sha: string; marime: number } | { eroare: string }> {
    const url = opt.storage?.url ?? Deno.env.get('SUPABASE_URL')
    const cheie = opt.storage?.cheie ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    semnal.throwIfAborted()
    if (!url || !cheie) return { eroare: 'configurație lipsă' }
    const path = d.fisier_path.split('/').map(encodeURIComponent).join('/')
    const raspuns = await fetch(`${url.replace(/\/+$/, '')}/storage/v1/object/authenticated/ofertare/${path}`, {
      headers: { Authorization: `Bearer ${cheie}`, apikey: cheie }, signal: semnal,
    })
    if (raspuns.status !== 200) { await raspuns.body?.cancel(); return { eroare: `HTTP ${raspuns.status}` } }
    const stoc = new Uint8Array(await raspuns.arrayBuffer())
    return { sha: await sha(stoc), marime: stoc.length }
  }
  // cheile de manifest luate în rularea asta (cheie → documentul) — vezi cheiaPentru
  const luate = new Map<string, number>()

  // `numeCautat` = numele sub care importul a urcat fișierul (după desfacerea semnăturii, var. B); `cale` rămâne cheia manifestului.
  // `dCod` = rândul care poartă codul SEAP al documentului (PR-2): are prioritate față de orice potrivire pe nume
  async function compara(arhivaCheie: string, cale: string, buf: Uint8Array, numeCautat: string = cale, dCod?: DocumentBd) {
    semnal.throwIfAborted()
    const rand: Rand = { licitatie_id: licId, arhiva_cheie: arhivaCheie, cale, marime: buf.length, sha256: await sha(buf), document_id: null, stare: 'deja_in_platforma', motiv: null, verificat_la: new Date().toISOString() }
    if (JUNK_RE.test(cale)) { rand.stare = 'ignorat'; rand.motiv = 'fișier de sistem (junk)'; tally.ignorate++; randuri.push(rand); return }
    // documentul în care importul a urcat EXACT această intrare (dovada 'urcat') are prioritate față de potrivirea pe nume
    const prec = dovezi.get(`${arhivaCheie}\u0000${cale}`)
    const dPrec = prec?.document_id != null ? dupaId.get(prec.document_id) : undefined
    const d = dCod ?? (dPrec && dPrec.fisier_path && !String(dPrec.fisier_path).includes('/neincarcat/') ? dPrec : undefined)
      ?? inPlatforma.get(cheieNume(numeCautat.split('/').pop()!)) ?? inPlatforma.get(cheieNume(numeCautat))
    if (!d) { rand.stare = 'eroare_urcare'; rand.motiv = 'LIPSĂ în platformă (verificare R6)'; tally.lipsa++; randuri.push(rand); return }
    rand.document_id = d.id; potrivite.add(d.id)
    // Storage necitit = nimic dovedit în niciun sens: rândul 'urcat' existent rămâne neatins
    const st = await dinStorage(d)
    if ('eroare' in st) { rand.motiv = `Storage indisponibil: ${st.eroare}`; tally.erori.push(`${cale}: ${rand.motiv}`); if (!prec) randuri.push(rand); return }
    const shaStoc = st.sha, stoc = { length: st.marime }
    if (shaStoc === rand.sha256) {
      tally.identice++
      if (prec && prec.stare === 'urcat' && prec.sha256 === rand.sha256 && prec.document_id === d.id) rand.stare = 'urcat'   // dovada confirmată, păstrată
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
    // inventarele pe pagini, fail-closed (Copilot NO-GO r1 pe #651): peste plafonul PostgREST o listă trunchiată ar face din
    // documentele / dovezile de după plafon „lipsă” și R6 ar degrada o dovadă „urcat” reală (clasa #13)
    const { data: dateBd, error: eBd } = await toatePaginile((de: number, la: number) => supa.from('ofertare_documente_atribuire')
      .select('id, nume_original, fisier_path, size_bytes, seap_cod').eq('licitatie_id', licId).order('id').range(de, la).abortSignal(semnal))
    if (eBd) throw new Error(`inventarul documentelor nu s-a putut citi: ${eBd.message}`)
    semnal.throwIfAborted()
    dinBd = dateBd || []
    inPlatforma = new Map((dinBd || []).filter(d => d.fisier_path && !String(d.fisier_path).includes('/neincarcat/'))
      .map(d => [cheieNume(d.nume_original), d]))
    dupaId = new Map(dinBd.map(d => [d.id, d]))
    peCod = new Map(dinBd.filter(d => d.fisier_path && !String(d.fisier_path).includes('/neincarcat/') && String(d.seap_cod ?? '').trim())
      .map(d => [String(d.seap_cod).trim(), d]))
    const { data: dateDovezi, error: eDovezi } = await toatePaginile((de: number, la: number) => supa.from('ofertare_seap_manifest')
      .select('arhiva_cheie, cale, document_id, sha256, stare').eq('licitatie_id', licId).in('stare', ['urcat', 'deja_in_platforma'])
      .not('document_id', 'is', null).order('id').range(de, la).abortSignal(semnal))
    semnal.throwIfAborted()
    // fără dovezile existente, o scriere le-ar putea suprascrie orbește → raportăm, dar nu scriem manifestul
    if (eDovezi) faraScriere = `manifest: dovezile existente nu s-au putut citi (${eDovezi.message}) — nu scriu nimic`
    for (const r of (dateDovezi || []) as { arhiva_cheie: string; cale: string; document_id: number | null; sha256: string; stare: string }[]) dovezi.set(`${r.arhiva_cheie}\u0000${r.cale}`, r)

    // volumele RAR ale aceleiași arhive se tratează împreună
    const grupuri = new Map<string, typeof docs>()
    for (const d of docs) {
      const v = volumRar(d.nume.replace(/\.p7[ms]$/i, ''))
      // același nume cu coduri diferite (lic. 100) = documente diferite, verificate separat
      const k = v ? `rar:${v.baza.toLowerCase()}` : `f:${d.nume}\u0000${String(d.cod ?? '').trim()}`
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
          // PR-2: codul pe un rând → acel rând, cu cheia lui de manifest (ca la urcare: numele fără .p7s); altfel pe nume
          const cod = String(grup[0].cod ?? '').trim()
          const dCod = peCod.get(cod)
          const fara = (n: string) => n.replace(/\.p7s$/i, '')
          // numele cu cod „N (COD).ext” (ca ținta workerului: pe numele SEAP brut, apoi desfacerea semnăturii) — cheie unică per cod
          const n2 = cod ? numeVersiune(grup[0].nume, cod) : ''
          const numeCod = !cod ? '' : locale[0].nume === grup[0].nume ? n2 : numeDesfacut(n2)
          // Jakarinos r3 pe #659 (P1): cheia de manifest a unui document cu cod e a rândului lui (ca la urcare), DAR dacă o dovadă
          // existentă sau alt document din rularea asta o ține deja (două rânduri „N.pdf” cu /1 și /2), el ia cheia „N (COD).ext”
          // — fără „ultimul câștigă”: dovada fiecăruia rămâne pe documentul ei, în orice ordine a listei
          const cheiaPentru = (d: DocumentBd): [string, string] => {
            const c = fara(String(d.nume_original))
            const prec = dovezi.get(`${c.toLowerCase()}\u0000${c}`), luat = luate.get(`${c.toLowerCase()}\u0000${c}`)
            const altul = (prec?.document_id != null && prec.document_id !== d.id) || (luat != null && luat !== d.id)
            const k = altul && numeCod ? fara(numeCod) : c
            luate.set(`${k.toLowerCase()}\u0000${k}`, d.id)
            return [k.toLowerCase(), k]
          }
          if (dCod) { const [a, c] = cheiaPentru(dCod); await compara(a, c, locale[0].buf, dCod.nume_original, dCod) }
          else if (!cod) await compara(cheieNume(locale[0].nume), locale[0].nume, locale[0].buf)
          else {
            // Jakarinos r2 pe #659 (P1): un cod care nu e pe niciun rând NU cade pe numele altui cod — „N.pdf” /1 (în platformă) și
            // /2 (încă neadus) ar compara /2 cu documentul lui /1 și i-ar retrograda dovada. Fără rând propriu, cu rivali pe nume (alt cod listat sau rândul găsit pe nume are alt cod) =
            // LIPSĂ raportată pe cheia proprie a codului; fără rivali (rând vechi fără cod, nume unic) = pe nume, ca înainte.
            // Jakarinos r16 + Copilot r11 pe #659 (P1): un rând numit „N (COD).ext” FĂRĂ codul acesta nu e dovada codului doar după nume
            // (poate fi un document numit literal așa, listat sau nu) — intră între candidații familiei, acceptat DOAR pe sha (mai jos).
            // Documentele listate cu ACELAȘI cod (aceeași pereche de două ori) nu sunt „alt document”
            const eAltDocListat = (n: string) => docs.some(x => x !== grup[0] && String(x.cod ?? '').trim() !== cod
              && [x.nume, numeDesfacut(x.nume)].some(m => cheieNume(m) === cheieNume(n)))
            // TOATE rândurile reale cu numele lui (nu doar ultimul păstrat de inPlatforma — Jakarinos r6 pe #659): rival = alt cod listat
            // cu același nume sau un rând cu numele lui care poartă alt cod; ambiguu = rival sau mai multe rânduri cu același nume
            const real = (x: DocumentBd) => !!x.fisier_path && !String(x.fisier_path).includes('/neincarcat/')
            const peNumeToate = dinBd.filter(x => real(x) && (cheieNume(x.nume_original) === cheieNume(locale[0].nume) || cheieNume(x.nume_original) === cheieNume(grup[0].nume)))
            const rival = docs.some(x => x !== grup[0] && cheieNume(x.nume) === cheieNume(grup[0].nume) && String(x.cod ?? '').trim() && String(x.cod).trim() !== cod)
              || peNumeToate.some(x => String(x.seap_cod ?? '').trim() && String(x.seap_cod).trim() !== cod)
            const ambiguu = rival || peNumeToate.length > 1
            {
              // Jakarinos r3 pe #659 (P1): fratele cu conținut IDENTIC (deduplicat legitim de worker / edge, fără rând propriu) nu e
              // „LIPSĂ”: întâi sha-ul față de candidații numelui; la potrivire, legătura pe cheia proprie a codului, fără să atingă
              // dovada celuilalt. Candidat necitit = nimic scris. Jakarinos r5: căutarea rulează ÎNTOTDEAUNA pentru un cod fără rând
              // propriu, cu sau fără rival listat (/3 rămas singur în listă, deduplicat pe „N (/2).pdf”).
              const c = fara(numeCod), shaDoc = await sha(locale[0].buf)
              const coduriRivale = docs.filter(x => x !== grup[0] && cheieNume(x.nume) === cheieNume(grup[0].nume)).map(x => String(x.cod ?? '').trim()).filter(Boolean)
              // familia numelui: același nume, orice rând „N (COD).ext” (și codurile IEȘITE din listă — Jakarinos r4 pe #659: /3 deduplicat
              // pe „N (/2).pdf”, apoi /2 înlocuit de /4 → /3 nu redevine fals „LIPSĂ”), codurile rivale listate și documentul indicat de
              // dovada existentă pe cheia proprie a codului
              const Q = 'QQ0CODQQ'
              const tipare = [numeVersiune(grup[0].nume, Q), numeDesfacut(numeVersiune(grup[0].nume, Q))].map(t => t.split(Q)).filter(t => t.length === 2)
              const dinFamilie = (n: string) => tipare.some(([pre, post]) => n.length > pre.length + post.length && n.startsWith(pre) && n.endsWith(post)
                && /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+$/.test(n.slice(pre.length, n.length - post.length)))
              const precProprie = dovezi.get(`${c.toLowerCase()}\u0000${c}`)
              const candidati = [...new Map([...peNumeToate, ...dinBd.filter(x => real(x) && (dinFamilie(String(x.nume_original))
                  || (precProprie?.document_id != null && x.id === precProprie.document_id))),
                ...coduriRivale.map(rc => peCod.get(rc)).filter((x): x is DocumentBd => !!x)].map(x => [x.id, x])).values()]
              let identic: DocumentBd | undefined, necitit = ''
              for (const x of candidati) {
                if (Number(x.size_bytes) > 0 && Number(x.size_bytes) !== locale[0].buf.length) continue   // altă mărime = alt conținut
                const st = await dinStorage(x)
                if ('eroare' in st) { necitit = st.eroare; continue }
                if (st.sha === shaDoc) { identic = x; break }
              }
              const rand = { licitatie_id: licId, arhiva_cheie: c.toLowerCase(), cale: c, marime: locale[0].buf.length, sha256: shaDoc, verificat_la: new Date().toISOString() }
              // Jakarinos r16 pe #659 (P1): cheia proprie „N (COD).ext” poate fi a ALTUI document (listat cu acel nume, sau cu dovada lui
              // „urcat” pe ea) — atunci nimic scris peste dovada lui; rezultatul codului se raportează separat
              const docPrec = precProprie?.document_id != null ? dinBd.find(x => x.id === precProprie.document_id) : undefined
              const ocupata = eAltDocListat(c) || (precProprie?.stare === 'urcat' && !!docPrec && String(docPrec.seap_cod ?? '').trim() !== cod)
              // identic = legătura pe cheia proprie a codului, ÎNTOTDEAUNA (Jakarinos r6 pe #659: căderea pe nume abandona candidatul
              // confirmat și compara cu documentul altei dovezi, pe care o retrograda)
              // cheie ocupată: NICIODATĂ scriere pe ea, oricum s-ar fi terminat căutarea (Jakarinos r17: un candidat necitit urmat de
              // unul identic scria peste dovada ocupantului)
              if (ocupata && (identic || ambiguu || necitit)) {
                tally.erori.push(`${grup[0].nume} (${cod}): ${identic ? `conținut identic cu #${identic.id}` : necitit ? `Storage indisponibil (${necitit})` : 'LIPSĂ în platformă'} — cheia „${c}” e a altui document; nimic scris peste dovada lui`)
                if (identic) { tally.identice++; potrivite.add(identic.id) } else if (!necitit) tally.lipsa++
              }
              else if (identic) {
                randuri.push({ ...rand, document_id: identic.id, stare: 'deja_in_platforma', motiv: `conținut identic cu #${identic.id} — codul SEAP ${cod} nu are rând propriu (frate deduplicat)` })
                tally.identice++; potrivite.add(identic.id)
              } else if (necitit) tally.erori.push(`${grup[0].nume} (${cod}): Storage indisponibil (${necitit}) la verificarea fratelui — nimic scris`)
              else if (ambiguu) {
                randuri.push({ ...rand, document_id: null, stare: 'eroare_urcare', motiv: `LIPSĂ în platformă (verificare R6): codul SEAP ${cod} nu e pe niciun document, iar numele are alt cod sau mai multe documente` })
                tally.lipsa++
              }
              else await compara(cheieNume(locale[0].nume), locale[0].nume, locale[0].buf)   // nume neambiguu, niciun identic: pe nume, ca înainte
            }
          }
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
