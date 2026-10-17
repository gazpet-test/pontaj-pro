// TKT-0329 B (PR3): modul `structurat` al extragerii (spec §5.1). Rulează DOAR pe o cerere de cheltuială activă (aprobată de owner /
// responsabil), prin RPC-urile din migrarea 20261031a; scrie observații imuabile (ofertare_cant_obs), NU în ofertare_cantitati.
// Pe fiecare felie, în ordinea din spec: cache → felie (blocarea muncii) → rezervare → apel → decontare. Eroare, excepție sau rezultat
// necunoscut → rezervarea „necunoscuta” + felia „necunoscut” (nu se reia singură; reluarea e umană). Nicio reîncercare, niciun fallback.
// Review r1: convenția numerică doar din texte VALIDE; contextul (convenția + manifestul părților valide ale grupului, deciziile de rol)
// intră în identitatea extractorului (cache-ul nu e servit pe alt context); offseturile feliilor din feliere; o extragere rămasă
// „in_lucru” se PREIA (feliile lipsă / încercările autorizate de om); un rând nenormalizabil face felia „esuat”; închidere controlată.
// Dependențele sunt injectabile (structurat_test.ts): baza (RPC service_role), citirile ca utilizator (tabelele noi au SELECT doar
// pentru authenticated) și apelul AI.
import { conventieDocument, type Conventie } from '../_shared/cantNumar.ts'
import { CAMPURI_RAND, normalizeazaRand, randDinTablou, sha256Hex } from '../_shared/cantNormalizare.ts'
import { feliiCuPozitie } from './sectiuni.ts'
import { type Rol, type SectiuneRol, cheieSectiune, sectiuniRol } from './roluri.ts'

export const EXTRACTOR = { model: 'gpt-5-mini', prompt: 'p2', normalizator: 'n4', feliere: 'f1' }
export const EXTRACTOR_ID = `${EXTRACTOR.model}@${EXTRACTOR.prompt}@${EXTRACTOR.normalizator}@${EXTRACTOR.feliere}`
// tariful din cod pentru limita superioară a rezervării (developers.openai.com/api/docs/pricing, 11.09.2026) — o depășire reală
// (tarif schimbat) blochează bugetul la decontare (§4.3)
export const TARIF = { in: 0.25 / 1e6, out: 2 / 1e6 }
export const MAX_IESIRE = 16000
const ROLURI_EXTRASE: Rol[] = ['f3', 'c6', 'lista_alt', 'atr', 'cs', 'fisa_date', 'memoriu', 'plansa', 'raspuns']
const TIPURI_ELIGIBILE = ['lista_cantitati', 'cs_volum', 'fisa_date', 'alta', 'raspuns_clarificare']

export type Raspuns = { status: number; body: Record<string, unknown> }
export type RezultatAI = { txt: string; inF: number; outF: number; eroare?: string; necunoscut?: boolean }
export type Document = { id: number; nume_original: string; tip: string; text_extras: string | null; seap_meta: any; lot_stare: string | null }
export type Decizie = { id?: number; document_id: number; doc_sha256: string; rol: string; sectiune: string; decizie: string }
export type DepsStructurat = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: any; error: any }>
  cerere: (id: number) => Promise<{ id: number; licitatie_id: number; scop: string; stare: string; valabil_pana: string; lot_domeniu: string; lot_nr: number[] } | null>
  documente: (licitatieId: number) => Promise<Document[]>
  deciziiRol: (licitatieId: number) => Promise<Decizie[]>
  lotDocument: (licitatieId: number, docIds: number[]) => Promise<Map<number, { domeniu: 'toate' | 'lista' | 'necunoscut'; loturi: number[] }>>
  // extragerea „in_lucru” existentă pe (document, sha, extractor) și ultima încercare a unei munci — citite ca utilizator
  extragereInLucru: (documentId: number, sha: string, extractorId: string) => Promise<{ id: number; cerere_id: number } | null>
  ultimaIncercare: (mucaId: string) => Promise<{ id: number; stare: string; rezervare_id: number | null } | null>
  ai: (prompt: string) => Promise<RezultatAI>
  acum: () => number
}

export const PROMPT_STRUCTURAT = (nume: string, rol: string) => `Ești inginer de devize. Din bucata de mai jos a documentului "${nume}" (secțiune cu rolul: ${rol}), extrage FIECARE RÂND cantitativ (lungimi de conductă, branșamente, tuburi de protecție, lucrări cu cantitate).

Răspunde EXCLUSIV cu JSON: {"r":[ [${CAMPURI_RAND.join(', ')}], ... ]}
- pagina: numărul din cel mai apropiat marcaj ⟦PAGINA n⟧ de dinaintea rândului, sau null;
- tabel / rand: identificatorul tabelului și al rândului, cum apar (sau null);
- cod_articol: caracter cu caracter, sau null;
- denumire: textul poziției, exact;
- obiect: obiectul / strada / tronsonul căruia îi aparține rândul (din titlul tabelului sau al listei);
- material, dn_text, sdr: cum apar în document (ex. "PE100", "Dn 90", "SDR11"), sau null;
- um: unitatea exactă din document; cantitate: cifra EXACT cum e scrisă în document, ca TEXT (ex. "570.000", "3.995,00"), null dacă lipsește;
- e_total / e_subtotal: 1 dacă rândul e un total / subtotal declarat, altfel 0;
- tip_lucrare: conducta | bransament | protectie | alt; masura: lungime | montaj | proba | material | alt;
- citat: fragmentul copiat VERBATIM, continuu, din document (max. 300 de caractere) care conține cantitatea și unitatea ei — fără „...”, fără prescurtări, fără reformulări; dacă rândul e lung, copiază doar porțiunea continuă din jurul cantității.
REGULI: nu calcula, nu aduna, nu converti; nu inventa rânduri; null ≠ 0; un rând per poziție din document; FIECARE rând are exact ${CAMPURI_RAND.length} elemente, în ordinea de mai sus (null pentru ce lipsește); cantitatea scrisă în rând se dă întotdeauna, nu null. NU include totalurile valorice (RON / lei / valoare) și nici antetele de tabel. În listele de resurse / consumuri (C6) extrage DOAR rândurile cu unitate de lungime (m, ml, km). Fără nimic în afara JSON-ului.`

// limita superioară demonstrabilă a costului unui apel: octeții UTF-8 ai promptului ≥ tokenii de intrare; ieșirea ≤ MAX_IESIRE
export function sumaRezervata(prompt: string): number {
  const octeti = new TextEncoder().encode(prompt).length
  return Math.ceil((octeti * TARIF.in + MAX_IESIRE * TARIF.out) * 1e4) / 1e4
}

// familia „parte”: un PDF împărțit în p01 / p02 … e un singur document pentru convenția numerică
export const radacinaParte = (nume: string) => nume.replace(/\s+—\s+p\d{2}_pag\d+-\d+\.pdf$/i, '').trim()

function ultimeleVersiuni(docs: Document[]): Document[] {
  const inlocuite = new Set(docs.map((d) => Number(d?.seap_meta?.inlocuieste_id)).filter((x) => Number.isFinite(x) && x > 0))
  return docs.filter((d) => !inlocuite.has(d.id))
}

// identitatea extractorului = codul + contextul care schimbă rezultatul normalizării: convenția și manifestul (document:sha) al părților
// VALIDE din grup + deciziile de rol active pe acest document și sha. Alt context = altă muncă, alt cache.
export async function extractorCuContext(conv: Conventie, manifestGrup: string[], decizii: Decizie[]): Promise<string> {
  const g = (await sha256Hex(JSON.stringify([conv, [...manifestGrup].sort()]))).slice(0, 12)
  const d = (await sha256Hex(JSON.stringify(decizii.map((x) => [x.decizie, x.rol, x.sectiune].join('|')).sort()))).slice(0, 12)
  return `${EXTRACTOR_ID}@c-${conv}-${g}@d-${d}`
}

type Felie = { nr: number; de_la: number; pana_la: number; text: string; s: SectiuneRol }

export async function extrageStructurat(deps: DepsStructurat, p: { licitatie_id: number; cerere_id: number; max_felii?: number; buget_ms?: number }): Promise<Raspuns> {
  const t0 = deps.acum()
  const buget = p.buget_ms ?? 60000
  // 1. cererea: activă, a licitației, pe scopul extragerii — altfel 402 ÎNAINTEA oricărui apel
  const c = await deps.cerere(p.cerere_id)
  if (!c || c.licitatie_id !== p.licitatie_id || c.scop !== 'cant_extragere' || c.stare !== 'activa' || Date.parse(c.valabil_pana) <= Date.now()) {
    return { status: 402, body: { ok: false, error: 'Fără cerere de cheltuială activă pentru extragere (o aprobă owner-ul sau responsabilul).' } }
  }
  // 2. documentele: ultimele versiuni, tipurile eligibile, cu text; sha + validitatea textului (predicatul unic, prin RPC)
  const docs0 = ultimeleVersiuni(await deps.documente(p.licitatie_id))
    .filter((d) => TIPURI_ELIGIBILE.includes(d.tip) && (d.text_extras || '').length > 0)
  const raport: Record<string, unknown>[] = []
  const docs: (Document & { sha: string })[] = []
  for (const d of docs0) {
    const sha = await sha256Hex(d.text_extras as string)
    const v = await deps.rpc('fn_ofertare_cb_text_valid', { p_licitatie_id: p.licitatie_id, p_document_id: d.id, p_sha256: sha })
    if (v.error || !v.data || typeof v.data !== 'object' || !v.data.tip) { raport.push({ document_id: d.id, sarit: 'text_nevalid' }); continue }
    docs.push({ ...d, sha })
  }
  const decizii = await deps.deciziiRol(p.licitatie_id)
  const loturi = await deps.lotDocument(p.licitatie_id, docs.map((d) => d.id))
  // convenția numerică pe grupuri de părți ale aceluiași PDF — DOAR din textele valide
  const grupuri = new Map<string, (Document & { sha: string })[]>()
  for (const d of docs) { const k = radacinaParte(d.nume_original); grupuri.set(k, [...(grupuri.get(k) || []), d]) }
  const conv = new Map<string, { conventie: Conventie; manifest: string[] }>()
  for (const [k, g] of grupuri) {
    conv.set(k, { conventie: conventieDocument(g.map((d) => d.text_extras as string)).conventie, manifest: g.map((d) => `${d.id}:${d.sha}`) })
  }

  let feliiApelate = 0, cost = 0, oprit: string | null = null
  for (const d of docs) {
    if (oprit) break
    const text = d.text_extras as string
    const ctxConv = conv.get(radacinaParte(d.nume_original))!
    const lot = loturi.get(d.id) ?? { domeniu: 'necunoscut' as const, loturi: [] }
    // 3. rolurile pe secțiune + decizia omului pe acel sha (rol_confirmat suprascrie, nu_e_sursa_cantitativa scoate secțiunea)
    const dDoc = decizii.filter((x) => x.document_id === d.id && x.doc_sha256 === d.sha)
    const sectiuni = aplicaDecizii(sectiuniRol(text, d.nume_original, d.tip), dDoc)
    const deExtras = sectiuni.filter((s) => s.rol !== null && ROLURI_EXTRASE.includes(s.rol)) as SectiuneRol[]
    if (!deExtras.length) { raport.push({ document_id: d.id, sarit: 'fara_sectiuni_cantitative' }); continue }
    const felii: Felie[] = []
    for (const s of deExtras) {
      for (const f of feliiCuPozitie(text.slice(s.de, s.pana))) {
        felii.push({ nr: felii.length, de_la: s.de + f.de, pana_la: s.de + f.de + f.text.length, text: f.text, s })
      }
    }
    const extractorId = await extractorCuContext(ctxConv.conventie, ctxConv.manifest, dDoc)
    // 4. extragerea, prin RPC-ul de GRUP (20261031b, review r3): sub lock-uri pe toate documentele grupului, mulțimea curentă a părților
    // valide trebuie să fie EXACT manifestul convenției (altfel „grup_schimbat”, tot grupul sărit, rularea următoare recalculează);
    // apoi, în aceeași tranzacție, predicatul de text valid + lotul cererii + cache. O extragere „in_lucru” rămasă se preia.
    const familie = String(d?.seap_meta?.inlocuieste_id ?? d.id)
    const ex = await deps.rpc('fn_ofertare_cb_extragere_incepe_grup', { p_cerere_id: c.id, p_document_id: d.id, p_sha256: d.sha, p_familie_id: familie,
      p_extractor_id: extractorId, p_felii_total: felii.length, p_manifest: ctxConv.manifest,
      p_decizii: dDoc.map((x) => Number(x.id)).filter((x) => Number.isFinite(x)) })
    if (ex.error) { raport.push({ document_id: d.id, eroare: 'extragere_incepe: ' + ex.error.message }); continue }
    // contextul s-a schimbat sub mutex (grup / decizii de rol) sau un document e ocupat de un producător: sărit, fail-closed, reîncercat
    if (['grup_schimbat', 'context_schimbat', 'grup_ocupat', 'cerere_ocupata'].includes(ex.data?.refuz)) { raport.push({ document_id: d.id, sarit: ex.data.refuz }); continue }
    if (ex.data?.cache) { raport.push({ document_id: d.id, cache: true, extragere_id: ex.data.extragere_id }); continue }
    let x: number
    if (ex.data?.refuz === 'extragere_in_lucru') {
      const preluata = await deps.extragereInLucru(d.id, d.sha, extractorId)
      if (!preluata) { raport.push({ document_id: d.id, refuz: 'extragere_in_lucru' }); continue }
      // review r2: preluarea doar pe ACEEAȘI cerere (rularea → aprobarea ei); pe altă cerere = închidere / redeschidere de om
      if (preluata.cerere_id !== c.id) { raport.push({ document_id: d.id, refuz: 'in_lucru_pe_alta_cerere', cerere_id: preluata.cerere_id }); continue }
      x = preluata.id
      raport.push({ document_id: d.id, preluata: x })
    } else if (ex.data?.refuz) { raport.push({ document_id: d.id, refuz: ex.data.refuz }); continue }
    else x = ex.data.extragere_id as number

    // conflict = altă rulare lucrează pe aceleași munci (rezervare concurentă, încercare în zbor cu rezervare): starea finală NU se
    // decide din contorul local — extragerea rămâne în lucru și se preia (review r3)
    let gata = 0, lasataInLucru = false, conflict = false
    for (const f of felii) {
      if (deps.acum() - t0 > buget) { oprit = 'buget_timp'; lasataInLucru = true; break }
      if (p.max_felii && feliiApelate >= p.max_felii) { oprit = 'max_felii'; lasataInLucru = true; break }
      const shaFelie = await sha256Hex(f.text)
      const fi = await deps.rpc('fn_ofertare_cb_felie_incepe', { p_extragere_id: x, p_felie_nr: f.nr, p_de_la: f.de_la, p_pana_la: f.pana_la, p_sha_felie: shaFelie })
      let felieId: number
      if (fi.data?.refuz === 'munca_existenta') {
        // munca există: ultima încercare decide — gata (numărată); în zbor FĂRĂ rezervare = o reluare autorizată de om (se continuă);
        // altfel (esuat / necunoscut / în zbor cu rezervare) așteaptă omul
        const u = await deps.ultimaIncercare(fi.data.munca_id)
        if (u?.stare === 'gata') { gata++; continue }
        if (!(u && u.stare === 'in_zbor' && u.rezervare_id === null)) {
          // review r4: orice felie care așteaptă omul (esuat / necunoscut / în zbor la alt worker) lasă extragerea în lucru — omul o reia
          // (felie_reia) și rularea următoare o preia; starea finală nu se decide dintr-un contor local care nu vede munca lui
          conflict = true
          raport.push({ document_id: d.id, felie: f.nr, asteapta_om: u?.stare ?? 'necunoscut' }); continue
        }
        felieId = u.id
      } else if (fi.error || fi.data?.refuz) { raport.push({ document_id: d.id, felie: f.nr, refuz: fi.data?.refuz ?? fi.error?.message }); continue }
      else felieId = fi.data.felie_id as number

      const prompt = `${PROMPT_STRUCTURAT(d.nume_original, f.s.rol)}\n\n--- BUCATA ${f.nr + 1}/${felii.length} ---\n${f.text}`
      const rz = await deps.rpc('fn_ofertare_cb_rezerva', { p_felie_id: felieId, p_suma: sumaRezervata(prompt) })
      if (rz.data?.refuz === 'felie' || rz.data?.refuz === 'munca_deja_rezervata') {
        // review r2: felia a fost rezervată între timp de alt worker (preluare concurentă) — NU o închidem; e munca lui
        conflict = true
        raport.push({ document_id: d.id, felie: f.nr, refuz_rezervare: rz.data.refuz, nota: 'rezervată concurent, lăsată worker-ului ei' })
        continue
      }
      if (rz.error || rz.data?.refuz) {
        // apelul NU a plecat: felia e „esuat” (fără rezervare); oprim la plafon / buget blocat / cerere
        await deps.rpc('fn_ofertare_cb_felie_inchide', { p_felie_id: felieId, p_stare: 'esuat' })
        oprit = 'rezervare:' + (rz.data?.refuz ?? rz.error?.message)
        raport.push({ document_id: d.id, felie: f.nr, refuz_rezervare: rz.data ?? rz.error?.message })
        break
      }
      const rezId = rz.data.rezervare_id as number
      feliiApelate++
      let r: RezultatAI
      try { r = await deps.ai(prompt) } catch (e) { r = { txt: '', inF: 0, outF: 0, eroare: 'exceptie: ' + String((e as Error)?.message || e).slice(0, 200) } }
      if (r.eroare || r.necunoscut) {
        await deps.rpc('fn_ofertare_cb_rezervare_necunoscuta', { p_rezervare_id: rezId })
        await deps.rpc('fn_ofertare_cb_felie_inchide', { p_felie_id: felieId, p_stare: 'necunoscut' })
        raport.push({ document_id: d.id, felie: f.nr, eroare: r.eroare ?? 'rezultat necunoscut' })
        continue
      }
      const costReal = r.inF * TARIF.in + r.outF * TARIF.out
      cost += costReal
      const dc = await deps.rpc('fn_ofertare_cb_deconteaza', { p_rezervare_id: rezId, p_cost: Math.round(costReal * 1e4) / 1e4,
        p_tokeni_in: r.inF, p_tokeni_out: r.outF, p_model: EXTRACTOR.model })
      if (dc.error || dc.data?.refuz) {
        // decontarea n-a mers: costul nu e înregistrat → rezervarea rămâne în consum („necunoscuta”), felia „necunoscut”
        await deps.rpc('fn_ofertare_cb_rezervare_necunoscuta', { p_rezervare_id: rezId })
        await deps.rpc('fn_ofertare_cb_felie_inchide', { p_felie_id: felieId, p_stare: 'necunoscut' })
        raport.push({ document_id: d.id, felie: f.nr, eroare: 'decontare: ' + (dc.data?.refuz ?? dc.error?.message) })
        continue
      }
      // 5. rândurile → observații normalizate. ORICE rând primit și nenormalizabil = felia „esuat”, fără observații (un candidat
      // pierdut nu poate lăsa în urmă o felie „gata”)
      const randuri = parseRaspuns(r.txt)
      const obs: Record<string, unknown>[] = []
      const note: Record<string, number> = {}
      let pierdute = randuri ? 0 : 1
      const mostre: string[] = randuri ? [] : [String(r.txt || '').slice(0, 240)]
      for (const a of randuri || []) {
        const rm = randDinTablou(a)
        const n = rm ? await normalizeazaRand(rm, { textDoc: text, felie: f.text, felie_de_la: f.de_la, conventie: ctxConv.conventie,
          lot_domeniu: lot.domeniu, lot_nr: lot.domeniu === 'lista' ? lot.loturi : [], rol_sursa: f.s.rol, rol_decis_de: f.s.decis_de }) : null
        if (!n) {
          // orice rând nenormalizabil pierde felia (review Jakarinos r1, P1: „UM diferit de m / km” nu dovedește că rândul e
          // irelevant — umNorm întoarce și forme necunoscute, iar UM-ul modelului nu e verificat în sursă); promptul p2 cere în C6
          // doar rândurile de lungime, ca să rămână mai puține rânduri de pierdut
          pierdute++
          // mostre în raport (conținut extern = date): primele 3 rânduri pierdute, trunchiate, pentru diagnoză
          if (mostre.length < 3) mostre.push(JSON.stringify(a).slice(0, 240))
          continue
        }
        for (const k of n.note) note[k] = (note[k] || 0) + 1
        obs.push(n.obs)
      }
      if (pierdute) {
        await deps.rpc('fn_ofertare_cb_felie_inchide', { p_felie_id: felieId, p_stare: 'esuat' })
        raport.push({ document_id: d.id, felie: f.nr, eroare: randuri ? `${pierdute} rânduri nenormalizabile — felia nu e completă` : 'raspuns neinterpretabil', mostre, note })
      } else {
        const os = await deps.rpc('fn_ofertare_cb_obs_scrie', { p_felie_id: felieId, p_obs: obs })
        if (os.error) {
          await deps.rpc('fn_ofertare_cb_felie_inchide', { p_felie_id: felieId, p_stare: 'esuat' })
          raport.push({ document_id: d.id, felie: f.nr, eroare: 'obs_scrie: ' + os.error.message })
        } else {
          await deps.rpc('fn_ofertare_cb_felie_inchide', { p_felie_id: felieId, p_stare: 'gata' })
          gata++
          raport.push({ document_id: d.id, felie: f.nr, rol: f.s.rol, sectiune: cheieSectiune(f.s, false), observatii: obs.length, note })
        }
      }
      if (dc.data?.peste_rezervare) { oprit = 'cost_peste_rezervare (buget blocat)'; break }
    }
    // închiderea controlată: la oprirea pe timp / număr de felii extragerea rămâne în lucru (se preia la rularea următoare); altfel
    // gata (toate feliile) / partial / esuat — RPC-ul refuză cât timp există felii în zbor (atunci rămâne în lucru și se preia)
    if (lasataInLucru || conflict) raport.push({ document_id: d.id, extragere_id: x, stare: 'in_lucru (se preia la rularea următoare)' + (conflict ? ' — muncă concurentă' : '') })
    else {
      const st = gata === felii.length ? 'gata' : gata > 0 ? 'partial' : 'esuat'
      const ic = await deps.rpc('fn_ofertare_cb_extragere_inchide', { p_extragere_id: x, p_stare: st })
      raport.push({ document_id: d.id, extragere_id: x, stare: ic.data?.refuz ? 'ramane_in_lucru:' + ic.data.refuz : st })
    }
  }
  return { status: 200, body: { ok: true, mod: 'structurat', extractor: EXTRACTOR_ID, felii_apelate: feliiApelate,
    cost_usd: Math.round(cost * 1e4) / 1e4, oprit, raport } }
}

export function parseRaspuns(txt: string): unknown[][] | null {
  try {
    const m = String(txt || '').replace(/```json?|```/g, '').match(/\{[\s\S]*\}/)
    const j = m ? JSON.parse(m[0]) : null
    return Array.isArray(j?.r) ? j.r : null
  } catch { return null }
}

export type SectiuneDecisa = Omit<SectiuneRol, 'rol'> & { rol: Rol | null }
// deciziile umane pe secțiune: „*” = tot documentul; „a-b” = paginile secțiunii trebuie să fie exact a-b
export function aplicaDecizii(s: SectiuneRol[], decizii: { rol: string; sectiune: string; decizie: string }[]): SectiuneDecisa[] {
  return s.map((x): SectiuneDecisa => {
    const cheie = cheieSectiune(x, false)
    const d = decizii.find((y) => y.sectiune === cheie) ?? decizii.find((y) => y.sectiune === '*')
    if (!d) return x
    if (d.decizie === 'nu_e_sursa_cantitativa') return { ...x, rol: null }
    if (d.decizie === 'rol_confirmat') return { ...x, rol: d.rol as Rol, decis_de: 'om' as const }
    return x
  })
}
