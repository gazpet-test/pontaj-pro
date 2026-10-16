// TKT-0329 B (PR4a): comparația DETERMINISTĂ a cantităților pe perechi de roluri (spec §5.2), acoperirea pe perechi (§5.0) și H2
// tri-state. Funcții pure — fără rețea, fără BD, fără AI. Intrarea = observațiile imuabile (ofertare_cant_obs) + manifestul documentelor;
// ieșirea = calculul + rândurile de comparație, în forma lui fn_ofertare_cb_calcul_scrie (migrarea 20261031a).
//
// Reguli (spec §5.2, obligațiile PR4 din §6.6):
// - deduplicarea DOAR pe repetarea aceleiași poziții: observații dovedite cu același (document, sha, cantitate_offset) se comasează numai
//   dacă TOATE câmpurile semantice coincid (obiect, Dn, material, tip, măsură, UM, valoare, total / subtotal); orice dezacord →
//   conflict_sursa pe cheile implicate, independent de ordine; offseturi diferite = poziții distincte (valorile egale se ADUNĂ);
// - deduplicarea rulează pe TOATE observațiile, apoi se aplică relevanța (un conflict lungime / montaj la același offset rămâne conflict);
// - o cantitate fără poziție dovedită (sau ambiguă) NU intră în agregare și ține cheia `incomplet` (§6.6 PR3); fără cheie → rând
//   `incomplet` pe rol, care blochează acoperirea perechilor rolului;
// - agregarea per rol, doar `masura = lungime` (predicat comun cu acoperirea; km → m), separat pe tip_lucrare; sumele se rotunjesc o
//   singură dată; totalurile / subtotalurile NU se adună cu detaliile — se compară separat (cheia „#total” / „#subtotal”) și ÎNTOTDEAUNA
//   cu suma detaliilor din același rol (suma_vs_total / suma_vs_subtotal, lipsa_a când detaliile lipsesc);
// - două documente NECOMPLEMENTARE ale aceluiași rol cu valori pe aceeași cheie → conflict_sursa (fără alegere); părțile aceluiași fișier
//   (p01 / p02) sunt complementare și se adună;
// - cheia = lot_domeniu|lot_nr|obiect_cheie|tip_lucrare|material|dn|um_norm; potrivire exactă + aliasurile active (reprezentantul = cea mai
//   mică cheie din componentă); Dn ambiguu / multiplu / lipsă → neasociat;
// - delta_abs = val_b − val_a; delta_rel = |delta_abs| / max(|val_a|, |val_b|); rotunjire la 0,001 înainte; ambele 0 → concordant;
//   H2: delta_rel > prag_h2 → diferenta; „de semnalat” (clarificări): |delta_abs| > 1 m ȘI delta_rel > 1 %;
// - `incomplet` pe o cheie se propagă: perechea nu poate fi „gata” pentru H2.

export const ALGORITM_VERSIUNE = 'cmp-1'
export const PRAGURI_IMPLICITE = { h2_rel: 0.001, semnal_abs_m: 1, semnal_rel: 0.01, rotunjire: 0.001 }
export type Praguri = typeof PRAGURI_IMPLICITE

export type Rol = 'f3' | 'c6' | 'lista_alt' | 'atr' | 'cs' | 'fisa_date' | 'memoriu' | 'plansa' | 'raspuns' | 'alt'
// perechile comparate (spec §3): F3 față de fiecare alt rol cantitativ
export const PERECHI: [Rol, Rol][] = [['f3', 'atr'], ['f3', 'cs'], ['f3', 'fisa_date'], ['f3', 'memoriu'], ['f3', 'plansa'], ['f3', 'c6']]

export type Obs = {
  id: number; document_id: number; doc_sha256: string; rol_sursa: Rol
  lot_domeniu: string; lot_nr: number[]
  pozitie_dovedita: boolean; valoare_ambigua: boolean; cantitate_offset: number | null
  tip_lucrare: string; masura: string; obiect_cheie: string | null; material: string | null
  dn_mm: number[]; dn_ambiguu: boolean; sdr: number | null; um_norm: string | null; cantitate: number | null
  e_total: boolean; e_subtotal: boolean
}
export type DocManifest = {
  document_id: number; sha256: string; parte: string          // parte = rădăcina numelui (p01 / p02 ale aceluiași fișier = aceeași parte)
  roluri: Rol[]                                                 // rolurile secțiunilor documentului (după deciziile omului)
  extragere: 'gata' | 'partial' | 'esuat' | 'in_lucru' | 'lipsa'
  extragere_id: number | null
  text_valid: boolean; completitudine: 'integral' | 'partial'; sursa_partiala_acceptata: boolean
  rol_nerezolvat: boolean                                        // secțiune „alt” fără decizie / „model” neconfirmat
  verificat_fara_lungimi: Rol[]                                  // roluri pe care omul a decis „verificat fără lungimi” pe acest document
}
export type Alias = { id: number; cheie_a: string; cheie_b: string }
export type Cmp = {
  cheie: string; rol_a: Rol; rol_b: Rol; val_a: number | null; val_b: number | null; obs_a: number[]; obs_b: number[]
  delta_abs: number | null; delta_rel: number | null
  verdict: 'concordant' | 'diferenta' | 'lipsa_a' | 'lipsa_b' | 'conflict_sursa' | 'neasociat' | 'incomplet'
  motiv_incomplet: string | null; importanta: number; de_semnalat: boolean
}
export type Acoperire = { stare: 'gata' | 'incomplet'; lipsuri: { document_id: number | null; motiv: string }[] }

const rot = (x: number, r: number) => Math.round(x / r) * r
const r3 = (x: number) => Math.round(x * 1000) / 1000

// predicatul UNIC de relevanță (agregare + acoperire): măsura „lungime”, indiferent de UM (o lungime fără UM / fără cheie nu dispare,
// ajunge neasociată sau incompletă)
export const relevanta = (o: Obs) => o.masura === 'lungime'
// UM-ul lungimilor adus la metri înainte de praguri (km → m); restul UM-urilor rămân în cheie (nu se potrivesc cu „m”)
export const normUm = (o: Obs): Obs =>
  o.um_norm === 'km' ? { ...o, um_norm: 'm', cantitate: o.cantitate === null ? null : o.cantitate * 1000 } : o

// ── cheia ──
export function cheieObs(o: Obs): string | null {
  if (o.dn_ambiguu || o.dn_mm.length !== 1 || !o.obiect_cheie || !o.um_norm) return null
  // UM canonic în cheie (km → m): cheia exportată (aliasuri) = cheia folosită la agregare
  const um = o.um_norm === 'km' ? 'm' : o.um_norm
  return [o.lot_domeniu, o.lot_nr.join(','), o.obiect_cheie, o.tip_lucrare, o.material ?? '', o.dn_mm[0], um].join('|')
}

// aliasurile active → reprezentantul componentei (cea mai mică cheie, determinist, indiferent de ordinea aliasurilor)
export function reprezentanti(aliasuri: Alias[]): (k: string) => string {
  const par = new Map<string, string>()
  const gaseste = (k: string): string => { let x = k; while (par.has(x) && par.get(x) !== x) x = par.get(x)!; return x }
  for (const a of aliasuri) {
    const ra = gaseste(a.cheie_a), rb = gaseste(a.cheie_b)
    if (ra === rb) continue
    const [mic, mare] = ra < rb ? [ra, rb] : [rb, ra]
    par.set(mic, mic); par.set(mare, mic)
  }
  return (k: string) => gaseste(k)
}

// semnătura semantică a unei observații (tot ce, la același offset, trebuie să coincidă ca să fie aceeași poziție)
const semantica = (o: Obs) => JSON.stringify([o.obiect_cheie, o.dn_mm, o.dn_ambiguu, o.sdr ?? null, o.material, o.tip_lucrare, o.masura,
  o.um_norm, o.cantitate, o.e_total, o.e_subtotal, o.lot_domeniu, o.lot_nr, o.rol_sursa])

export type Pozitie = { ids: number[]; reprezentant: Obs }
// deduplicarea: grup = (document, sha, offset) pentru observațiile dovedite; conflict = semantici diferite în același grup
export function deduplica(obs: Obs[]): { pozitii: Pozitie[]; conflicte: Obs[][]; nedovedite: Obs[] } {
  const grupuri = new Map<string, Obs[]>()
  const nedovedite: Obs[] = []
  for (const o of [...obs].sort((a, b) => a.id - b.id)) {
    if (!o.pozitie_dovedita || o.valoare_ambigua || o.cantitate_offset === null) { nedovedite.push(o); continue }
    const k = `${o.document_id}|${o.doc_sha256}|${o.cantitate_offset}`
    grupuri.set(k, [...(grupuri.get(k) || []), o])
  }
  const pozitii: Pozitie[] = [], conflicte: Obs[][] = []
  for (const g of grupuri.values()) {
    if (new Set(g.map(semantica)).size === 1) pozitii.push({ ids: g.map((x) => x.id), reprezentant: g[0] })
    else conflicte.push(g)
  }
  return { pozitii, conflicte, nedovedite }
}

type Agregat = { val: number | null; obs: number[]; incomplet: string | null; conflict: boolean; parti: Set<string> }
const nou = (): Agregat => ({ val: null, obs: [], incomplet: null, conflict: false, parti: new Set() })

// o observație relevantă care nu are cheie, dar nu poate fi ignorată: conflict semantic fără cheie sau cantitate nedovedită fără cheie
export type Blocaj = { rol: Rol; obs: Obs; verdict: 'conflict_sursa' | 'incomplet'; motiv: string }

// agregarea pe (rol, cheie): detaliile se adună; totalurile / subtotalurile merg pe cheia „#total” / „#subtotal”.
// Deduplicarea rulează pe TOATE observațiile, înainte de filtrul de relevanță: un conflict la același offset între o variantă „lungime”
// și una „montaj” / „proba” nu se pierde prin filtrare. Sumele se rotunjesc o singură dată, la final.
export function agrega(obs: Obs[], docs: DocManifest[], aliasuri: Alias[]):
  { pe: Map<string, Map<string, Agregat>>; neasociate: Obs[]; blocaje: Blocaj[] } {
  const rep = reprezentanti(aliasuri)
  const parte = new Map(docs.map((d) => [d.document_id, d.parte]))
  // deduplicarea pe valorile BRUTE (1 km și 1000 m la același offset = două citiri diferite → conflict); normalizarea UM vine după
  const { pozitii, conflicte, nedovedite } = deduplica(obs)
  const pe = new Map<string, Map<string, Agregat>>()
  const ia = (rol: string, k: string) => { if (!pe.has(rol)) pe.set(rol, new Map()); const m = pe.get(rol)!; if (!m.has(k)) m.set(k, nou()); return m.get(k)! }
  const neasociate: Obs[] = [], blocaje: Blocaj[] = []
  const sufix = (o: Obs) => (o.e_total ? '#total' : o.e_subtotal ? '#subtotal' : '')
  const cheieFinala = (o: Obs) => { const k = cheieObs(o); return k === null ? null : rep(k) + sufix(o) }
  for (const p of pozitii) {
    const o = normUm(p.reprezentant)
    if (!relevanta(o)) continue
    const k = cheieFinala(o)
    if (k === null) { neasociate.push(o); continue }
    const a = ia(o.rol_sursa, k)
    a.val = (a.val ?? 0) + (o.cantitate ?? 0)
    a.obs.push(...p.ids)
    a.parti.add(parte.get(o.document_id) ?? String(o.document_id))
  }
  // aceeași cheie din documente NECOMPLEMENTARE (părți diferite) ale aceluiași rol → conflict_sursa
  for (const m of pe.values()) for (const a of m.values()) if (a.parti.size > 1) a.conflict = true
  // conflictele semantice la același offset: dacă ORICARE variantă e lungime, toate cheile implicate → conflict_sursa;
  // o variantă fără cheie → blocaj vizibil (nu dispare ca „neasociat”)
  for (const g of conflicte) {
    if (!g.some(relevanta)) continue
    for (const o of g) {
      const k = cheieFinala(o)
      if (k === null) { blocaje.push({ rol: o.rol_sursa, obs: o, verdict: 'conflict_sursa', motiv: `conflict semantic la același offset, fără cheie (obs ${o.id})` }); continue }
      const a = ia(o.rol_sursa, k); a.conflict = true; a.obs.push(o.id)
    }
  }
  // cantitățile nedovedite / ambigue: cheia lor e incompletă (nu intră în sumă); fără cheie → blocaj „incomplet” pe rol
  for (const o of nedovedite) {
    if (!relevanta(o)) continue
    const k = cheieFinala(o)
    if (k === null) { blocaje.push({ rol: o.rol_sursa, obs: o, verdict: 'incomplet', motiv: `poziție nedovedită fără cheie (obs ${o.id})` }); continue }
    const a = ia(o.rol_sursa, k); a.incomplet = a.incomplet ?? `poziție nedovedită (obs ${o.id})`; a.obs.push(o.id)
  }
  for (const m of pe.values()) for (const a of m.values()) {
    a.obs = [...new Set(a.obs)].sort((x, y) => x - y)
    if (a.val !== null) a.val = r3(a.val)
  }
  return { pe, neasociate, blocaje }
}

export function verdict(a: Agregat | undefined, b: Agregat | undefined, pr: Praguri):
  Pick<Cmp, 'val_a' | 'val_b' | 'delta_abs' | 'delta_rel' | 'verdict' | 'motiv_incomplet' | 'importanta' | 'de_semnalat'> {
  const baza = { val_a: a?.val ?? null, val_b: b?.val ?? null, delta_abs: null, delta_rel: null, motiv_incomplet: null, importanta: 0, de_semnalat: false }
  if (a?.incomplet || b?.incomplet) return { ...baza, verdict: 'incomplet', motiv_incomplet: (a?.incomplet || b?.incomplet)! }
  if (a?.conflict || b?.conflict) return { ...baza, verdict: 'conflict_sursa' }
  if (!a || a.val === null) return { ...baza, verdict: 'lipsa_a' }
  if (!b || b.val === null) return { ...baza, verdict: 'lipsa_b' }
  const va = rot(a.val, pr.rotunjire), vb = rot(b.val, pr.rotunjire)
  if (va === 0 && vb === 0) return { ...baza, verdict: 'concordant', delta_abs: 0, delta_rel: 0 }
  const delta_abs = r3(vb - va)
  const delta_rel = Math.abs(delta_abs) / Math.max(Math.abs(va), Math.abs(vb))
  const dif = delta_rel > pr.h2_rel
  return { ...baza, delta_abs, delta_rel: Math.round(delta_rel * 1e6) / 1e6, verdict: dif ? 'diferenta' : 'concordant', importanta: Math.abs(delta_abs),
    de_semnalat: dif && Math.abs(delta_abs) > pr.semnal_abs_m && delta_rel > pr.semnal_rel }
}

// comparația pe perechi + suma_vs_total în fiecare rol
export function compara(obs: Obs[], docs: DocManifest[], aliasuri: Alias[], pr: Praguri = PRAGURI_IMPLICITE): { cmp: Cmp[]; neasociate: Obs[] } {
  const { pe, neasociate, blocaje } = agrega(obs, docs, aliasuri)
  const cmp: Cmp[] = []
  for (const [ra, rb] of PERECHI) {
    const A = pe.get(ra) ?? new Map(), B = pe.get(rb) ?? new Map()
    if (!A.size || !B.size) continue
    for (const k of [...new Set([...A.keys(), ...B.keys()])].sort()) {
      const a = A.get(k), b = B.get(k)
      cmp.push({ cheie: k, rol_a: ra, rol_b: rb, obs_a: a?.obs ?? [], obs_b: b?.obs ?? [], ...verdict(a, b, pr) })
    }
  }
  // suma detaliilor vs totalul / subtotalul declarat, în același rol (rol_a = rol_b), pe cheia de bază; se emite ÎNTOTDEAUNA,
  // și fără detalii (lipsa_a): un total declarat fără detaliile lui nu trece neobservat
  for (const [rol, m] of pe) for (const [k, t] of [...m].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))) {
    const suf = k.endsWith('#total') ? '#total' : k.endsWith('#subtotal') ? '#subtotal' : null
    if (!suf) continue
    const kb = k.slice(0, -suf.length)
    const d = m.get(kb)
    cmp.push({ cheie: kb + (suf === '#total' ? '#suma_vs_total' : '#suma_vs_subtotal'), rol_a: rol as Rol, rol_b: rol as Rol,
      obs_a: d?.obs ?? [], obs_b: t.obs, ...verdict(d, t, pr) })
  }
  for (const o of neasociate) {
    cmp.push({ cheie: `neasociat:${o.id}`, rol_a: o.rol_sursa, rol_b: o.rol_sursa, val_a: o.cantitate, val_b: null, obs_a: [o.id], obs_b: [],
      delta_abs: null, delta_rel: null, verdict: 'neasociat', motiv_incomplet: null, importanta: 0, de_semnalat: false })
  }
  for (const b of blocaje) {
    cmp.push({ cheie: `${b.verdict === 'incomplet' ? 'nedovedit' : 'conflict'}:${b.obs.id}`, rol_a: b.rol, rol_b: b.rol, val_a: b.obs.cantitate,
      val_b: null, obs_a: [b.obs.id], obs_b: [], delta_abs: null, delta_rel: null, verdict: b.verdict,
      motiv_incomplet: b.verdict === 'incomplet' ? b.motiv : null, importanta: 0, de_semnalat: false })
  }
  return { cmp, neasociate }
}

// ── acoperirea pe perechi (spec §5.0): „gata” doar cu TOATE condițiile; altfel „incomplet”, cu lipsurile pe document ──
export function acoperirePereche(ra: Rol, rb: Rol, docs: DocManifest[], obs: Obs[], cmp: Cmp[]): Acoperire {
  const lipsuri: { document_id: number | null; motiv: string }[] = []
  for (const d of docs) if (d.rol_nerezolvat) lipsuri.push({ document_id: d.document_id, motiv: 'rol nerezolvat' })
  for (const rol of [ra, rb]) {
    const ds = docs.filter((d) => d.roluri.includes(rol))
    if (!ds.length) lipsuri.push({ document_id: null, motiv: `niciun document cu rolul ${rol}` })
    for (const d of ds) {
      if (d.extragere !== 'gata') lipsuri.push({ document_id: d.document_id, motiv: `extragere ${d.extragere} (${rol})` })
      if (!d.text_valid) lipsuri.push({ document_id: d.document_id, motiv: 'text fără proveniență validă' })
      else if (d.completitudine !== 'integral' && !d.sursa_partiala_acceptata) lipsuri.push({ document_id: d.document_id, motiv: 'text parțial' })
      const relevante = obs.filter((o) => o.document_id === d.document_id && o.doc_sha256 === d.sha256 && o.rol_sursa === rol && relevanta(o)).length
      if (!relevante && !d.verificat_fara_lungimi.includes(rol)) lipsuri.push({ document_id: d.document_id, motiv: `0 observații relevante (${rol})` })
    }
  }
  const aiPerechii = cmp.filter((c) => c.rol_a === ra && c.rol_b === rb)
  // „incomplet” se propagă și din rândurile din interiorul unui rol al perechii (suma_vs_total, poziții nedovedite fără cheie)
  if (randuriPereche(cmp, ra, rb).some((c) => c.verdict === 'incomplet')) lipsuri.push({ document_id: null, motiv: 'chei incomplete' })
  // o lungime dovedită fără cheie nu e comparată cu nimic: perechea nu e „gata” până la asociere (alias) / decizia omului
  if (randuriPereche(cmp, ra, rb).some((c) => c.verdict === 'neasociat')) lipsuri.push({ document_id: null, motiv: 'lungimi neasociate' })
  if (!aiPerechii.some((c) => ['concordant', 'diferenta'].includes(c.verdict))) lipsuri.push({ document_id: null, motiv: 'nicio cheie comună comparabilă' })
  return { stare: lipsuri.length ? 'incomplet' : 'gata', lipsuri }
}

// rândurile care contează pentru o pereche: cele ale perechii + cele din interiorul rolurilor ei (suma_vs_total / subtotal, conflicte
// fără cheie, poziții nedovedite, neasociate)
export function randuriPereche(cmp: Cmp[], ra: Rol, rb: Rol): Cmp[] {
  return cmp.filter((c) => (c.rol_a === ra && c.rol_b === rb) || (c.rol_a === c.rol_b && (c.rol_a === ra || c.rol_a === rb)))
}

// ── H2 tri-state pe pereche: necalculat (fără calcul valid) / incomplet / gata + verdictul comparatorului ──
// primește TOATE rândurile calculului și filtrează singur (anomaliile din interiorul rolurilor nu se pot pierde la apel)
export function h2(calculValid: boolean, ac: Acoperire | undefined, cmp: Cmp[], ra: Rol, rb: Rol):
  { stare: 'necalculat' | 'incomplet' | 'gata'; diferente: number; conflicte: number } {
  if (!calculValid || !ac) return { stare: 'necalculat', diferente: 0, conflicte: 0 }
  const cmpPereche = randuriPereche(cmp, ra, rb)
  const diferente = cmpPereche.filter((c) => c.verdict === 'diferenta').length
  const conflicte = cmpPereche.filter((c) => c.verdict === 'conflict_sursa').length
  if (ac.stare !== 'gata' || cmpPereche.some((c) => c.verdict === 'incomplet')) return { stare: 'incomplet', diferente, conflicte }
  return { stare: 'gata', diferente, conflicte }
}

// ── amprenta canonică (JSON cu chei sortate) peste tot ce determină calculul ──
export function canonic(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(canonic).join(',') + ']'
  if (v && typeof v === 'object') return '{' + Object.keys(v as Record<string, unknown>).sort().map((k) => JSON.stringify(k) + ':' + canonic((v as Record<string, unknown>)[k])).join(',') + '}'
  return JSON.stringify(v ?? null)
}
export async function amprenta(x: unknown): Promise<string> {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonic(x)))
  return [...new Uint8Array(b)].map((y) => y.toString(16).padStart(2, '0')).join('')
}

// calculul complet, în forma lui fn_ofertare_cb_calcul_scrie (p_calcul, p_cmp)
export async function calcul(p: { licitatie_id: number; lot_domeniu: string; lot_nr: number[]; extractor_id: string; docs: DocManifest[]
  obs: Obs[]; aliasuri: Alias[]; decizii: { id: number }[]; praguri?: Praguri; tip?: 'curent' | 'simulare'; pe_snapshot_id?: number }) {
  const pr = p.praguri ?? PRAGURI_IMPLICITE
  const { cmp } = compara(p.obs, p.docs, p.aliasuri, pr)
  const acoperire: Record<string, Acoperire> = {}
  for (const [ra, rb] of PERECHI) acoperire[`${ra}-${rb}`] = acoperirePereche(ra, rb, p.docs, p.obs, cmp)
  const doc_manifest = [...p.docs].sort((a, b) => a.document_id - b.document_id)
    // TOATE intrările acoperirii intră în amprentă (o schimbare de proveniență / completitudine / decizie umană = alt calcul)
    .map((d) => ({ document_id: d.document_id, sha256: d.sha256, parte: d.parte, roluri: [...d.roluri].sort(), extragere: d.extragere,
      extragere_id: d.extragere_id, text_valid: d.text_valid, completitudine: d.completitudine, sursa_partiala_acceptata: d.sursa_partiala_acceptata,
      rol_nerezolvat: d.rol_nerezolvat, verificat_fara_lungimi: [...d.verificat_fara_lungimi].sort() }))
  const obs_manifest = [...p.obs].sort((a, b) => a.id - b.id).map((o) => ({ id: o.id }))
  const alias_manifest = [...p.aliasuri].sort((a, b) => a.id - b.id).map((a) => ({ id: a.id, cheie_a: a.cheie_a, cheie_b: a.cheie_b }))
  const decizii_manifest = [...p.decizii].sort((a, b) => a.id - b.id).map((d) => ({ id: d.id }))
  const baza = { licitatie_id: p.licitatie_id, lot_domeniu: p.lot_domeniu, lot_nr: p.lot_nr, algoritm_versiune: ALGORITM_VERSIUNE, praguri: pr,
    extractor_id: p.extractor_id, doc_manifest, obs_manifest, alias_manifest, decizii_manifest }
  const stare = Object.values(acoperire).some((a) => a.stare === 'gata') && !cmp.some((c) => c.verdict === 'incomplet') ? 'gata' : 'incomplet'
  return {
    calcul: { ...baza, tip: p.tip ?? 'curent', ...(p.pe_snapshot_id ? { pe_snapshot_id: p.pe_snapshot_id } : {}), acoperire, stare,
      amprenta: await amprenta(baza) },
    cmp: cmp.map(({ de_semnalat: _s, ...c }) => c),
    de_semnalat: cmp.filter((c) => c.de_semnalat || c.verdict === 'conflict_sursa'),
  }
}
