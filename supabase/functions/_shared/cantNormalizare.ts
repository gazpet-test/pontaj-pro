// TKT-0329 B (PR3): normalizarea deterministă a unui rând extras de model → observație pentru fn_ofertare_cb_obs_scrie (spec §4.1,
// §5.1). Modelul propune; codul decide DN-ul, UM-ul, materialul, cheia obiectului, tipul lucrării / măsura și poziția (pozitieDovedita).
import { dnDinText } from './dn.ts'
import { blocRand, codComparabil, type Conventie, identificatoriLinie, pozitieDovedita, umNorm, valoareInDocument } from './cantNumar.ts'
export { umNorm }

const faraDiacritice = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')

// rândul cerut modelului (spec §5.1), în ordinea tabloului din răspuns
export const CAMPURI_RAND = ['pagina', 'tabel', 'rand', 'cod_articol', 'denumire', 'obiect', 'material', 'dn_text', 'sdr', 'um',
  'cantitate', 'e_total', 'e_subtotal', 'tip_lucrare', 'masura', 'citat'] as const
export type RandModel = Partial<Record<(typeof CAMPURI_RAND)[number], unknown>>

export function randDinTablou(a: unknown): RandModel | null {
  // proba Răcari p2: modelul întoarce uneori OBIECTE cu cheile câmpurilor în loc de tablou — acceptate DOAR cu chei exact din
  // CAMPURI_RAND (nicio cheie străină; cheile lipsă = null). Tabloul cu alt număr de elemente rămâne respins (poziții ambigue).
  if (a && typeof a === 'object' && !Array.isArray(a)) {
    const o = a as Record<string, unknown>
    if (!Object.keys(o).length || Object.keys(o).some((k) => !(CAMPURI_RAND as readonly string[]).includes(k))) return null
    const r: RandModel = {}
    CAMPURI_RAND.forEach((c) => { r[c] = o[c] ?? null })
    return r
  }
  if (!Array.isArray(a) || a.length !== CAMPURI_RAND.length) return null
  const r: RandModel = {}
  CAMPURI_RAND.forEach((c, i) => { r[c] = a[i] })
  return r
}

const text = (v: unknown, max: number): string | null => {
  if (v === null || v === undefined) return null
  const t = String(v).trim()
  return !t || /^(null|n\/a|nu e cazul|-|—)$/i.test(t) ? null : t.slice(0, max)
}

// ── material: listă închisă (CHECK ^[A-Z0-9]{2,12}$) ──
export function materialNorm(...surse: unknown[]): string | null {
  const t = faraDiacritice(surse.map((s) => String(s ?? '')).join(' ')).toUpperCase()
  if (/\bPE\s*-?\s*100\b|PE100/.test(t)) return 'PE100'
  if (/\bPE\s*-?\s*80\b|PE80|HDPE\s*80/.test(t)) return 'PE80'
  if (/\bPEHD\b|\bHDPE\b|\bPE\b/.test(t)) return 'PEHD'
  if (/\bPVC\b/.test(t)) return 'PVC'
  if (/\bOL\b|\bOTEL\b/.test(t)) return 'OL'
  if (/\bCUPRU\b|\bCU\b(?=\s*\d)/.test(t)) return 'CU'
  return null
}

// ── cheia obiectului: fără diacritice, fără prefixe de tip, păstrează toate numerele și localitatea ──
const PREFIXE = /\b(?:obiect(?:ul)?|ob|str(?:ada)?|aleea|al|bd|bulevardul|b-dul|calea|sos(?:eaua)?|drum(?:ul)?|intr(?:area)?|inv|fundatura|loc(?:alitatea)?|sat(?:ul)?|com(?:una)?|oras(?:ul)?|jud(?:etul)?|nr|tronson(?:ul)?)\b\.?/g
export function obiectCheie(v: unknown): string | null {
  const t = faraDiacritice(String(v ?? '')).toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ').replace(PREFIXE, ' ').replace(/\s+/g, ' ').trim()
  return t ? t.slice(0, 300) : null
}

// ── tipul lucrării și măsura: valoarea modelului, verificată cu reguli pe denumire; la dezacord câștigă regula ──
const TIPURI = ['conducta', 'bransament', 'protectie', 'alt'] as const
const MASURI = ['lungime', 'montaj', 'proba', 'material', 'alt'] as const
export function tipSiMasura(denumire: string, tipModel: unknown, masuraModel: unknown, um: string | null):
  { tip_lucrare: (typeof TIPURI)[number]; masura: (typeof MASURI)[number]; dezacord: boolean } {
  const d = faraDiacritice(denumire).toLowerCase()
  const tm = String(tipModel ?? '').toLowerCase(), mm = String(masuraModel ?? '').toLowerCase()
  const tipRegula = /bransament/.test(d) ? 'bransament' : /tub(?:ul|uri)?\s+de\s+protectie|\bprotectie\b/.test(d) ? 'protectie'
    : /\b(teava|tv|conduct[ae]|retea)\b/.test(d) ? 'conducta' : null
  const masRegula = /\bmontaj|\bmontare/.test(d) ? 'montaj' : /\bprob[ae]\b/.test(d) ? 'proba' : /\bfurnizare\b/.test(d) ? 'material' : null
  const tipM = (TIPURI as readonly string[]).includes(tm) ? tm as (typeof TIPURI)[number] : null
  const masM = (MASURI as readonly string[]).includes(mm) ? mm as (typeof MASURI)[number] : null
  const tip_lucrare = (tipRegula ?? tipM ?? 'alt') as (typeof TIPURI)[number]
  const masura = (masRegula ?? masM ?? (um === 'm' ? 'lungime' : 'alt')) as (typeof MASURI)[number]
  const dezacord = (tipRegula !== null && tipM !== null && tipRegula !== tipM) || (masRegula !== null && masM !== null && masRegula !== masM)
  return { tip_lucrare, masura, dezacord }
}

// cantitatea propusă de model: număr JSON sau text; null ≠ 0
export function cantitateModel(v: unknown, conv: Conventie): number | null | 'ambigua' {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const t = String(v).trim().replace(/\s/g, '')
  if (!t || /^(null|n\/a|-)$/i.test(t)) return null
  return valoareInDocument(t, conv)
}

// pagina: din markerul absolut ⟦PAGINA n⟧ dinaintea offsetului (în cod, nu de la model)
export function paginaLa(textDoc: string, offset: number): number | null {
  const i = textDoc.lastIndexOf('⟦PAGINA', offset)
  if (i < 0) return null
  const m = /^⟦PAGINA\s*(\d{1,5})/.exec(textDoc.slice(i, i + 20))
  return m ? Number(m[1]) : null
}

export async function sha256Hex(s: string): Promise<string> {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')
}

// val 2, PR-A „dovada pe rând”: `off` = offsetul cantității în textDoc (pozitieDovedita primește textul întreg, deci offsetul ei e
// direct în textDoc). Codul de articol declarat de model trebuie să fie un IDENTIFICATOR ÎNTREG al LINIEI cantității; Dn-urile din
// denumire+citat trebuie să fie toate în BLOCUL rândului (linia + continuarea delimitată pozitiv, vezi blocRand). Un Dn în plus în bloc =
// ambiguitate păstrată, nu corecție. Review Jakarinos r2 (P1): un cod declarat într-un format nerecunoscut („SA11H1,”, „SA11H1[2]”,
// „670 1153”, „a)”) nu se poate verifica → nedovedit; singurele excepții sunt marcajele de „fără cod” (gol, „-”, „null”, „n/a”).
const FARA_COD = /^(?:|-|—|null|n\/a|nu e cazul)$/i
// coloana „[ n]” a listei lipită de cod de model, separată prin spațiu („GD19A1% [ 1]” → „GD19A1%”); altceva rămâne neschimbat
export const codFaraColoana = (v: unknown): unknown => typeof v === 'string' ? v.replace(/\s+\[\s*\d{1,3}\s*\]\s*$/, '') : v

export function verificaRand(textDoc: string, off: number, codModel: unknown, dnCod: number[]):
  { motiv: 'cod_alt_rand' | 'cod_neverificabil' | 'dn_alt_rand' | null; dnInPlus: boolean; continuare: [number, number] | null } {
  const b = blocRand(textDoc, off)
  // 20.10.2026: modelul lipește uneori coloana „[ n]” a listei de cod („GD19A1% [ 1]”) — se scoate DOAR forma separată prin spațiu
  // (coloana listei, pe care identificatoriLinie o desparte oricum); „SA11H1[2]” lipit rămâne neverificabil (PR-A r3)
  const codBrut = String(codFaraColoana(codModel) ?? '').replace(/\*/g, '').trim()
  if (!FARA_COD.test(codBrut)) {
    const cod = codComparabil(codBrut)
    if (cod === null) return { motiv: 'cod_neverificabil', dnInPlus: false, continuare: null }
    if (!identificatoriLinie(b.linie).has(cod)) return { motiv: 'cod_alt_rand', dnInPlus: false, continuare: null }
  }
  const dnBloc = dnDinText(b.bloc).dn
  if (dnCod.some((d) => !dnBloc.includes(d))) return { motiv: 'dn_alt_rand', dnInPlus: false, continuare: null }
  // decizia Răzvan 16.10 (varianta A): un Dn care NU e pe linia cantității, ci doar pe liniile de dedesubt, e o dovadă de clasă
  // separată (orientarea listei nu se poate dovedi din text — risc rezidual documentat) → intervalul întregului bloc, pentru bifa umană
  const dnLinie = dnDinText(b.linie).dn
  const continuare = b.continuare && dnCod.some((d) => !dnLinie.includes(d)) ? [b.de_la, b.pana_la] as [number, number] : null
  return { motiv: null, dnInPlus: dnBloc.some((d) => !dnCod.includes(d)), continuare }
}

export type ContextFelie = {
  textDoc: string; felie: string; felie_de_la: number; conventie: Conventie
  lot_domeniu: 'toate' | 'lista' | 'necunoscut'; lot_nr: number[]
  rol_sursa: string; rol_decis_de: 'antet' | 'marcaj' | 'titlu' | 'model' | 'om'
}

// rândul modelului → observația (forma JSON a fn_ofertare_cb_obs_scrie) + ce s-a corectat; null = rând fără denumire / citat
export async function normalizeazaRand(r: RandModel, ctx: ContextFelie): Promise<{ obs: Record<string, unknown>; note: string[] } | null> {
  const denumire = text(r.denumire, 1000), citat = text(r.citat, 300)
  if (!denumire || !citat) return null
  const note: string[] = []
  const um = umNorm(r.um)
  const cm = cantitateModel(r.cantitate, ctx.conventie)
  const cantitate = cm === 'ambigua' ? null : cm
  if (cm === 'ambigua') note.push('cantitate_model_ambigua')
  const poz = pozitieDovedita({ felie: ctx.felie, felie_de_la: ctx.felie_de_la, citat, cantitate, um, conventie: ctx.conventie, text_doc: ctx.textDoc })
  // Dn-ul codului vine din SURSĂ (denumire + citat), nu din dn_text-ul modelului; dn_text e doar propunerea de comparat
  const dnCod = dnDinText(`${denumire} ${citat}`).dn
  const dnModelTxt = text(r.dn_text, 100)
  const dnModelToate = dnModelTxt ? dnDinText(dnModelTxt).dn : []
  // mai multe Dn propuse de model = ambiguitate păstrată (review r1), nu „fără propunere”
  const dnModel = dnModelToate.length === 1 ? dnModelToate[0] : null
  // dezacordul cu modelul sau mai multe Dn → ambiguu, fără corecție automată (inclusiv modelul vede un Dn pe care codul nu-l găsește)
  const dnAmbiguu = dnCod.length > 1 || dnModelToate.length > 1 || (dnModel !== null && (dnCod.length !== 1 || dnCod[0] !== dnModel))
  if (dnAmbiguu) note.push('dn_ambiguu')
  const tm = tipSiMasura(denumire, r.tip_lucrare, r.masura, um)
  if (tm.dezacord) note.push('tip_masura_corectat_de_regula')
  const sdrM = /sdr\s*(\d{1,2}(?:[.,]\d)?)/i.exec(`${denumire} ${text(r.sdr, 20) ?? ''}`)
  const sdr = sdrM ? Number(sdrM[1].replace(',', '.')) : null
  const offsetPagina = poz.citat_interval ? poz.citat_interval[0] : null
  const obs: Record<string, unknown> = {
    lot_domeniu: ctx.lot_domeniu, lot_nr: ctx.lot_nr,
    rol_sursa: ctx.rol_sursa, rol_decis_de: ctx.rol_decis_de,
    pagina: offsetPagina !== null ? paginaLa(ctx.textDoc, offsetPagina) : null,
    // review Gemini #812 r1 (P2): codul salvat = același cu cel verificat (fără coloana „ [ n]” lipită de model prin spațiu)
    cod_articol: text(codFaraColoana(r.cod_articol), 100), denumire,
    rand_interval: poz.rand_interval ? `[${poz.rand_interval[0]},${poz.rand_interval[1]})` : null,
    citat_interval: poz.citat_interval ? `[${poz.citat_interval[0]},${poz.citat_interval[1]})` : null,
    cantitate_offset: poz.cantitate_offset, pozitie_dovedita: poz.pozitie_dovedita, valoare_ambigua: poz.valoare_ambigua || cm === 'ambigua',
    tip_lucrare: tm.tip_lucrare, masura: tm.masura,
    obiect_brut: text(r.obiect, 300), obiect_cheie: obiectCheie(r.obiect),
    material: materialNorm(r.material, denumire),
    dn_mm: dnCod, dn_model: dnModel, dn_ambiguu: dnAmbiguu, sdr,
    um_norm: um, cantitate, e_total: r.e_total === 1 || r.e_total === true, e_subtotal: r.e_subtotal === 1 || r.e_subtotal === true,
    citat,
  }
  // val 2, PR-A: o poziție dovedită trebuie să aibă pe RÂNDUL cantității codul de articol (dacă modelul a dat unul) și Dn-urile codului
  if (obs.pozitie_dovedita && poz.cantitate_offset !== null) {
    const rd = verificaRand(ctx.textDoc, poz.cantitate_offset, r.cod_articol, dnCod)
    if (rd.motiv) { obs.pozitie_dovedita = false; note.push('pozitie:' + rd.motiv) }
    else {
      if (rd.dnInPlus) { obs.dn_ambiguu = true; if (!dnAmbiguu) note.push('dn_ambiguu') }
      // marcajul persistat (fără coloană nouă): rand_interval = tot blocul (linia cantității + continuarea), deci un interval care
      // trece de sfârșitul liniei cantității = „Dn dovedit din continuare” — B2 / PR4b le arată separat, pentru bifa umană
      if (rd.continuare) { obs.rand_interval = `[${rd.continuare[0]},${rd.continuare[1]})`; note.push('dn_din_continuare') }
    }
  } else if (!poz.pozitie_dovedita) note.push('pozitie:' + poz.motiv)
  // CHECK din BD: o poziție dovedită nu poate fi și ambiguă
  if (obs.pozitie_dovedita && obs.valoare_ambigua) obs.pozitie_dovedita = false
  // identitatea rândului în felie = TOATĂ proiecția semantică normalizată (review r1): două interpretări ale aceleiași poziții care
  // diferă prin obiect / Dn / material / tip / măsură / total / subtotal NU se contopesc la ON CONFLICT — ajung la comparator (conflict_sursa)
  obs.hash_rand = await sha256Hex(JSON.stringify(Object.keys(obs).sort().map((k) => [k, obs[k]])))
  return { obs, note }
}
