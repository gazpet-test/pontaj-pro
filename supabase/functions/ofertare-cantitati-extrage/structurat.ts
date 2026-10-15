// TKT-0329 B (PR3): modul `structurat` al extragerii (spec §5.1). Rulează DOAR pe o cerere de cheltuială activă (aprobată de owner /
// responsabil), prin RPC-urile din migrarea 20261031a; scrie observații imuabile (ofertare_cant_obs), NU în ofertare_cantitati.
// Pe fiecare felie, în ordinea din spec: cache → felie (blocarea muncii) → rezervare → apel → decontare. Eroare sau rezultat necunoscut
// → rezervarea „necunoscuta” + felia „necunoscut” (nu se reia singură; reluarea e umană). Nicio reîncercare, niciun fallback.
// Dependențele sunt injectabile (structurat_test.ts): baza (RPC service_role), citirile ca utilizator (cererea, deciziile — tabelele
// noi nu au SELECT pentru service_role) și apelul AI.
import { conventieDocument, type Conventie } from '../_shared/cantNumar.ts'
import { CAMPURI_RAND, normalizeazaRand, randDinTablou, sha256Hex } from '../_shared/cantNormalizare.ts'
import { felii as feliiText } from './sectiuni.ts'
import { type Rol, type SectiuneRol, cheieSectiune, sectiuniRol } from './roluri.ts'

export const EXTRACTOR = { model: 'gpt-5-mini', prompt: 'p1', normalizator: 'n1', feliere: 'f1' }
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
export type DepsStructurat = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: any; error: any }>
  cerere: (id: number) => Promise<{ id: number; licitatie_id: number; scop: string; stare: string; valabil_pana: string; lot_domeniu: string; lot_nr: number[] } | null>
  documente: (licitatieId: number) => Promise<Document[]>
  deciziiRol: (licitatieId: number) => Promise<{ document_id: number; doc_sha256: string; rol: string; sectiune: string; decizie: string }[]>
  lotDocument: (licitatieId: number, docIds: number[]) => Promise<Map<number, { domeniu: 'toate' | 'lista' | 'necunoscut'; loturi: number[] }>>
  ai: (prompt: string) => Promise<RezultatAI>
  acum: () => number
}

export const PROMPT_STRUCTURAT = (nume: string, rol: string) => `Ești inginer de devize. Din bucata de mai jos a documentului "${nume}" (secțiune cu rolul: ${rol}), extrage FIECARE RÂND cantitativ (lungimi de conductă, branșamente, tuburi de protecție, lucrări cu cantitate).

Răspunde EXCLUSIV cu JSON: {"r":[ [${CAMPURI_RAND.map((c) => c).join(', ')}], ... ]}
- pagina: numărul din cel mai apropiat marcaj ⟦PAGINA n⟧ de dinaintea rândului, sau null;
- tabel / rand: identificatorul tabelului și al rândului, cum apar (sau null);
- cod_articol: caracter cu caracter, sau null;
- denumire: textul poziției, exact;
- obiect: obiectul / strada / tronsonul căruia îi aparține rândul (din titlul tabelului sau al listei);
- material, dn_text, sdr: cum apar în document (ex. "PE100", "Dn 90", "SDR11"), sau null;
- um: unitatea exactă din document; cantitate: cifra EXACT cum e scrisă în document, ca TEXT (ex. "570.000", "3.995,00"), null dacă lipsește;
- e_total / e_subtotal: 1 dacă rândul e un total / subtotal declarat, altfel 0;
- tip_lucrare: conducta | bransament | protectie | alt; masura: lungime | montaj | proba | material | alt;
- citat: fragmentul EXACT din document (max. 300 de caractere) care conține denumirea și cantitatea.
REGULI: nu calcula, nu aduna, nu converti; nu inventa rânduri; null ≠ 0; un rând per poziție din document. Fără nimic în afara JSON-ului.`

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

export async function extrageStructurat(deps: DepsStructurat, p: { licitatie_id: number; cerere_id: number; max_felii?: number; buget_ms?: number }): Promise<Raspuns> {
  const t0 = deps.acum()
  const buget = p.buget_ms ?? 60000
  // 1. cererea: activă, a licitației, pe scopul extragerii — altfel 402 ÎNAINTEA oricărui apel
  const c = await deps.cerere(p.cerere_id)
  if (!c || c.licitatie_id !== p.licitatie_id || c.scop !== 'cant_extragere' || c.stare !== 'activa' || Date.parse(c.valabil_pana) <= Date.now()) {
    return { status: 402, body: { ok: false, error: 'Fără cerere de cheltuială activă pentru extragere (o aprobă owner-ul sau responsabilul).' } }
  }
  // 2. documentele: ultimele versiuni, tipurile eligibile, cu text
  const docs = ultimeleVersiuni(await deps.documente(p.licitatie_id))
    .filter((d) => TIPURI_ELIGIBILE.includes(d.tip) && (d.text_extras || '').length > 0)
  const decizii = await deps.deciziiRol(p.licitatie_id)
  const loturi = await deps.lotDocument(p.licitatie_id, docs.map((d) => d.id))
  // convenția numerică pe grupuri de părți ale aceluiași PDF
  const conv = new Map<string, Conventie>()
  const grupuri = new Map<string, string[]>()
  for (const d of docs) { const k = radacinaParte(d.nume_original); grupuri.set(k, [...(grupuri.get(k) || []), d.text_extras || '']) }
  for (const [rad, texte] of grupuri) conv.set(rad, conventieDocument(texte).conventie)
  const raport: Record<string, unknown>[] = []
  let feliiFacute = 0, cost = 0, oprit: string | null = null
  for (const d of docs) {
    if (oprit) break
    const text = d.text_extras as string
    const sha = await sha256Hex(text)
    const conventie = conv.get(radacinaParte(d.nume_original)) ?? 'nedeterminata'
    const lot = loturi.get(d.id) ?? { domeniu: 'necunoscut' as const, loturi: [] }
    // 3. rolurile pe secțiune + decizia omului pe acel sha (rol_confirmat suprascrie, nu_e_sursa_cantitativa scoate secțiunea)
    const sectiuni = aplicaDecizii(sectiuniRol(text, d.nume_original, d.tip), decizii.filter((x) => x.document_id === d.id && x.doc_sha256 === sha))
    const deExtras = sectiuni.filter((s) => s.rol !== null && ROLURI_EXTRASE.includes(s.rol)) as SectiuneRol[]
    if (!deExtras.length) { raport.push({ document_id: d.id, sarit: 'fara_sectiuni_cantitative' }); continue }
    const felii: { de_la: number; pana_la: number; text: string; s: SectiuneRol }[] = []
    for (const s of deExtras) {
      let poz = s.de
      for (const b of feliiText(text.slice(s.de, s.pana))) {
        const de = text.indexOf(b, poz)
        felii.push({ de_la: de, pana_la: de + b.length, text: b, s })
        poz = de + 1
      }
    }
    // 4. extragerea (predicatul de text valid + lotul cererii + cache sunt verificate în RPC)
    const familie = String(d?.seap_meta?.inlocuieste_id ?? d.id)
    const ex = await deps.rpc('fn_ofertare_cb_extragere_incepe', { p_cerere_id: c.id, p_document_id: d.id, p_sha256: sha, p_familie_id: familie,
      p_extractor_id: EXTRACTOR_ID, p_felii_total: felii.length })
    if (ex.error) { raport.push({ document_id: d.id, eroare: 'extragere_incepe: ' + ex.error.message }); continue }
    if (ex.data?.cache) { raport.push({ document_id: d.id, cache: true, extragere_id: ex.data.extragere_id }); continue }
    if (ex.data?.refuz) { raport.push({ document_id: d.id, refuz: ex.data.refuz }); continue }
    const x = ex.data.extragere_id as number
    let gata = 0
    for (let i = 0; i < felii.length; i++) {
      if (deps.acum() - t0 > buget) { oprit = 'buget_timp'; break }
      if (p.max_felii && feliiFacute >= p.max_felii) { oprit = 'max_felii'; break }
      const f = felii[i]
      const shaFelie = await sha256Hex(f.text)
      const fi = await deps.rpc('fn_ofertare_cb_felie_incepe', { p_extragere_id: x, p_felie_nr: i, p_de_la: f.de_la, p_pana_la: f.pana_la, p_sha_felie: shaFelie })
      if (fi.error || fi.data?.refuz) { raport.push({ document_id: d.id, felie: i, refuz: fi.data?.refuz ?? fi.error?.message }); continue }
      const felieId = fi.data.felie_id as number
      const prompt = `${PROMPT_STRUCTURAT(d.nume_original, f.s.rol)}\n\n--- BUCATA ${i + 1}/${felii.length} ---\n${f.text}`
      const rz = await deps.rpc('fn_ofertare_cb_rezerva', { p_felie_id: felieId, p_suma: sumaRezervata(prompt) })
      if (rz.error || rz.data?.refuz) {
        // apelul NU a plecat: felia e „esuat” (fără rezervare); oprim tot la plafon / buget blocat / cerere
        await deps.rpc('fn_ofertare_cb_felie_inchide', { p_felie_id: felieId, p_stare: 'esuat' })
        oprit = 'rezervare:' + (rz.data?.refuz ?? rz.error?.message)
        raport.push({ document_id: d.id, felie: i, refuz_rezervare: rz.data ?? rz.error?.message })
        break
      }
      const rezId = rz.data.rezervare_id as number
      feliiFacute++
      const r = await deps.ai(prompt)
      if (r.eroare || r.necunoscut) {
        await deps.rpc('fn_ofertare_cb_rezervare_necunoscuta', { p_rezervare_id: rezId })
        await deps.rpc('fn_ofertare_cb_felie_inchide', { p_felie_id: felieId, p_stare: 'necunoscut' })
        raport.push({ document_id: d.id, felie: i, eroare: r.eroare ?? 'rezultat necunoscut' })
        continue
      }
      const costReal = r.inF * TARIF.in + r.outF * TARIF.out
      cost += costReal
      const dc = await deps.rpc('fn_ofertare_cb_deconteaza', { p_rezervare_id: rezId, p_cost: Math.round(costReal * 1e4) / 1e4,
        p_tokeni_in: r.inF, p_tokeni_out: r.outF, p_model: EXTRACTOR.model })
      if (dc.error || dc.data?.refuz) {
        // decontarea n-a mers: costul nu e înregistrat → felia rămâne „necunoscut”, rezervarea rămâne în consum
        await deps.rpc('fn_ofertare_cb_rezervare_necunoscuta', { p_rezervare_id: rezId })
        await deps.rpc('fn_ofertare_cb_felie_inchide', { p_felie_id: felieId, p_stare: 'necunoscut' })
        raport.push({ document_id: d.id, felie: i, eroare: 'decontare: ' + (dc.data?.refuz ?? dc.error?.message) })
        continue
      }
      // 5. rândurile → observații normalizate (poziția dovedită în cod)
      const randuri = parseRaspuns(r.txt)
      if (!randuri) {
        await deps.rpc('fn_ofertare_cb_felie_inchide', { p_felie_id: felieId, p_stare: 'esuat' })
        raport.push({ document_id: d.id, felie: i, eroare: 'raspuns neinterpretabil' })
      } else {
        const obs: Record<string, unknown>[] = []
        const note: Record<string, number> = {}
        for (const a of randuri) {
          const rm = randDinTablou(a)
          if (!rm) { note['rand_invalid'] = (note['rand_invalid'] || 0) + 1; continue }
          const n = await normalizeazaRand(rm, { textDoc: text, felie: f.text, felie_de_la: f.de_la, conventie, lot_domeniu: lot.domeniu,
            lot_nr: lot.domeniu === 'lista' ? lot.loturi : [], rol_sursa: f.s.rol, rol_decis_de: f.s.decis_de })
          if (!n) { note['fara_denumire_sau_citat'] = (note['fara_denumire_sau_citat'] || 0) + 1; continue }
          for (const k of n.note) note[k] = (note[k] || 0) + 1
          obs.push(n.obs)
        }
        const os = await deps.rpc('fn_ofertare_cb_obs_scrie', { p_felie_id: felieId, p_obs: obs })
        if (os.error) {
          await deps.rpc('fn_ofertare_cb_felie_inchide', { p_felie_id: felieId, p_stare: 'esuat' })
          raport.push({ document_id: d.id, felie: i, eroare: 'obs_scrie: ' + os.error.message })
        } else {
          await deps.rpc('fn_ofertare_cb_felie_inchide', { p_felie_id: felieId, p_stare: 'gata' })
          gata++
          raport.push({ document_id: d.id, felie: i, rol: f.s.rol, sectiune: cheieSectiune(f.s, false), observatii: obs.length, note })
        }
      }
      if (dc.data?.peste_rezervare) { oprit = 'cost_peste_rezervare (buget blocat)'; break }
    }
    // închiderea extragerii: „gata” doar cu toate feliile; altfel partial / esuat (la o oprire se lasă în lucru, pentru reluare)
    if (!oprit) {
      const st = gata === felii.length ? 'gata' : gata > 0 ? 'partial' : 'esuat'
      const ic = await deps.rpc('fn_ofertare_cb_extragere_inchide', { p_extragere_id: x, p_stare: st })
      raport.push({ document_id: d.id, extragere_id: x, stare: ic.data?.refuz ? 'refuz:' + ic.data.refuz : st })
    }
  }
  return { status: 200, body: { ok: true, mod: 'structurat', extractor_id: EXTRACTOR_ID, felii_apelate: feliiFacute,
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
