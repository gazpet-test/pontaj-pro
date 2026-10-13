// ofertare-triere — matricea experților, baremul și repartizarea pe roluri (mutate din index.ts la v1.9, 13.10.2026, neschimbate,
// ca să poată fi testate: Jakarinos r1 a cerut test pe ordinea repartizare → bonus → cumul). Istoricul versiunilor: index.ts.

// Repartizare DETERMINISTĂ a experților pe roluri, din matrice (Răzvan, 22.09.2026, Jilava):
// modelul fără gândire a ales de 3 ori o repartizare sub-optimă deși matricea era corectă.
// Baremul se citește din textul cerinței rolului („2 proiecte = 1 punct; 3-4 proiecte = 3 puncte; 5 sau mai multe = 5 puncte").
// Se maximizează punctajul TOTAL al echipei, o persoană pe un singur rol; la egalitate câștigă marja minimă mai mare
// (câte proiecte peste prag), apoi totalul de proiecte. Dacă baremul nu se poate citi, propunerea AI rămâne neschimbată.
type Barem = Array<{ prag: number; puncte: number }>
// v1.7.1 (recenzie 23.09): unitatea din barem e cea din regula (6) — proiecte / contracte / lucrări / obiective. Doar „proiecte"
// făcea ca un barem în contracte să nu se citească deloc, deci scenariile, riscul și clarificarea din cod erau sărite.
const UNIT = String.raw`(?:proiecte?|contracte?|lucr[aă]r[ie]|obiective?)`
// cerința minimă OBLIGATORIE scrisă în text („minim 1 proiect similar", „cel puțin 2 contracte"); null dacă nu e scrisă
function citesteMinim(text: string): number | null {
  const m = new RegExp(String.raw`(?:minim(?:um)?|cel\s+pu[țt]in)\s*(?:de\s+)?(\d+)\s*(?:\([^)]{0,40}\)\s*)?(?:de\s+)?${UNIT}`, 'i').exec(text || '')
  return m ? Number(m[1]) : null
}
export function citesteBarem(text: string): { trepte: Barem; minim: number } {
  // v1.7: acceptă și „pct"/„p." nu doar „puncte" (Grădiștea: „2-3 proiecte suplimentare=4pct" nu se citea deloc → repartizarea
  // nu rula), iar „proiecte SUPLIMENTARE" se numără peste minimul obligatoriu (1 proiect minim + 2-3 suplimentare = prag 3).
  const brut: Array<{ prag: number; puncte: number; supl: boolean; plafon?: boolean }> = []
  // v1.7.1: „peste 5 proiecte" = prag 6, „între 2 și 3 proiecte" = prag 2, „maxim 5 proiecte" e plafon (nu se ia drept minim)
  const re = new RegExp(String.raw`(?:(peste|mai\s+mult\s+de|maxim(?:um)?)\s+)?(\d+)\s*(?:-\s*\d+|\s*[șs]i\s+\d+|\s*sau\s+mai\s+multe|\+)?\s*(?:de\s+)?${UNIT}([^=;:.]{0,40}?)(?:=>|=|:|→|[-–—])\s*(\d+(?:[.,]\d+)?)\s*(?:p(?:unct|ct)|p\b)`, 'gi')
  let m: RegExpExecArray | null
  const explicit = citesteMinim(text)
  const intregi: Array<{ idx: number; supl: boolean }> = []
  while ((m = re.exec(text || ''))) {
    const supl = /suplimentar/i.test(m[3] || ''), plafon = /maxim/i.test(m[1] || ''), peste = /peste|mai/i.test(m[1] || '')
    intregi.push({ idx: m.index, supl }); brut.push({ prag: Number(m[2]) + (peste ? 1 : 0), puncte: Number(m[4].replace(',', '.')), supl, plafon })
  }
  // treptele prescurtate („4-5 = 7 pct", „6+ = 10 pct", „2-3 suplimentare=4pct") — DOAR dacă unitatea e stabilită deja (o treaptă
  // cu unitate sau „minim N proiecte" în text — Grădiștea E2 avea numai forma asta), nu pe ani/lei/%; continuă seria treptei
  // întregi dinaintea lor (dacă aia era „suplimentare", și ele sunt)
  if (intregi.length || explicit !== null) {
    // fără interval („6 suplimentare=10pct") se acceptă doar cu „suplimentar" lângă cifră — altfel orice „5 = 3 pct" ar fi treaptă
    const reScurt = new RegExp(String.raw`(\d+)\s*(-\s*\d+|\s*sau\s+mai\s+multe|\+)?\s*([^=;:.\d]{0,40}?)(?:=>|=|:|→|[-–—])\s*(\d+(?:[.,]\d+)?)\s*(?:p(?:unct|ct)|p\b)`, 'gi')
    while ((m = reScurt.exec(text || ''))) {
      if (!m[2] && !/suplimentar/i.test(m[3] || '')) continue
      if (intregi.some(t => t.idx === m!.index || (t.idx < m!.index && m!.index - t.idx <= 14 && /^(peste|mai\s+mult\s+de|maxim(?:um)?)\s+$/i.test(text.slice(t.idx, m!.index)))) || /\b(ani|luni|lei|euro)\b|%/i.test(m[3] || '')) continue
      const anterioara = intregi.filter(t => t.idx < m!.index).pop()
      brut.push({ prag: Number(m[1]), puncte: Number(m[4].replace(',', '.')), supl: !!anterioara?.supl || /suplimentar/i.test(m[3] || '') })
    }
  }
  // baza peste care se adună „suplimentare": minimul scris, altfel primul prag nesuplimentar, altfel 1
  const baza = explicit ?? brut.find(b => !b.supl && !b.plafon)?.prag ?? 1
  const trepte = brut.map(b => ({ prag: b.supl ? b.prag + baza : b.prag, puncte: b.puncte })).sort((a, b) => a.prag - b.prag)
  // v1.7.1 (recenzie): pragul de RISC (regula 8) NU e primul prag PUNCTAT — la Grădiștea ar fi ieșit 3, cu minimul real 1 — ci
  // minimul scris în cerință; fără el, o treaptă nepunctată (0 pct) e minimul; altfel 1 (orice proiect strict scoate rolul din risc)
  const minim = explicit ?? brut.find(b => !b.supl && !b.plafon && b.puncte === 0)?.prag ?? 1
  return { trepte, minim }
}
// v1.7.1 (Grădiștea, a doua rulare reală): modelul transcrie baremul de fiecare dată altfel („= 4 pct", „-4 pct", „(0 pct)"), iar
// parserul de text pierde câte o formă la fiecare rulare. De aceea modelul completează și „barem" STRUCTURAT pe rol (minim +
// trepte cu de_la = total); el e prima sursă, textul rămâne rezervă. Dacă modelul a dat treptele ca „suplimentare" (de_la fără
// minim), iar textul citit confirmă (prima treaptă din text = de_la + minim), se corectează prin adunarea minimului.
export function baremRol(r: any): { trepte: Barem; minim: number; sursa: 'structurat' | 'text' | 'niciunul' } {
  const text = String(r?.cerinte || '') + ' ' + String(r?.motiv || '')
  const txt = citesteBarem(text)
  const b = r?.barem
  const minimStruct = Number.isFinite(Number(b?.minim)) && Number(b.minim) > 0 ? Math.floor(Number(b.minim)) : null
  const minim = minimStruct ?? txt.minim
  let trepte: Barem = (Array.isArray(b?.trepte) ? b.trepte : [])
    .map((t: any) => ({ prag: num(t?.de_la ?? t?.prag ?? t?.proiecte), puncte: Number(String(t?.puncte ?? '').replace(',', '.')) }))
    .filter((t: { prag: number; puncte: number }) => t.prag > 0 && Number.isFinite(t.puncte) && t.puncte >= 0)
    .sort((a: { prag: number }, b: { prag: number }) => a.prag - b.prag)
  if (trepte.length) {
    if (/suplimentar/i.test(text) && txt.trepte.length && trepte[0].prag + minim === txt.trepte[0].prag) trepte = trepte.map(t => ({ prag: t.prag + minim, puncte: t.puncte }))
    return { trepte, minim, sursa: 'structurat' }
  }
  return { trepte: txt.trepte, minim, sursa: txt.trepte.length ? 'text' : 'niciunul' }
}
function puncteBarem(barem: Array<{ prag: number; puncte: number }>, n: number) {
  let p = 0, prag = 0
  for (const b of barem) if (n >= b.prag && b.puncte >= p) { p = b.puncte; prag = b.prag }
  return { puncte: p, marja: p > 0 ? n - prag : -1 }
}
type Scenariu = { total: number; totalStrict: number; totalVerif: number; marja: number; proj: number; alocare: (string | null)[] }
// v1.7: două scenarii (Jakarinos, 23.09.2026). „conservator" = doar proiectele necondiționate (natura cerută, strict);
// „conditionat" = + proiectele pe transport la o cerință de distribuție, care depind de acceptarea autorității.
// Echipa propusă e cea optimă în scenariul condiționat (decizia lui Răzvan, varianta A), dar se afișează ȘI punctajul
// ACELEIAȘI echipe dacă transportul e respins, plus cea mai bună echipă pur conservatoare — două maxime obținute cu
// echipe diferite ar ascunde riscul alegerii. La egalitate pe totalul condiționat câștigă totalul conservator, apoi marja.
const norm = (s: any) => String(s || '').toLowerCase().replace(/[șş]/g, 's').replace(/[țţ]/g, 't').replace(/[ăâ]/g, 'a').replace(/î/g, 'i').replace(/\s+/g, ' ').trim()
const num = (v: any) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0 }
type RandMat = { persoana: string; proiecte: number; verificate: number; proiecte_conditionate: number; verificate_conditionate: number }
// v1.7.1 (recenzie 23.09): matricea se indexează O DATĂ pe (persoană, rol) normalizate. Rândurile dublate (același om pe același rol,
// scris de două ori sau cu diacritice/majuscule diferite) se contopesc pe MAXIM — nu pe sumă, ca o dublare din greșeală a modelului
// să nu umfle punctajul. Înainte mat.find lua doar primul rând, iar „TRUSU RAZVAN" și „Trusu Razvan" ieșeau două persoane distincte
// (aceeași persoană pe două roluri, fără notă de cumul).
// v1.7.1 (Grădiștea, rulare reală): modelul scurtează rolul în matrice („E3: RTE" față de „E3: RTE (Responsabil Tehnic cu Executia)"
// din roluri) → rolul ieșea din repartizare. Potrivire: exact, apoi pe codul din față („E3:", „2.")," apoi prefix (min. 4 caractere).
function acelasiRol(a: string, b: string) {
  const na = norm(a), nb = norm(b)
  if (!na || !nb) return false
  if (na === nb) return true
  const cod = (s: string) => (/^([a-z]?\d+)\s*[:.)]/.exec(s) || [])[1]
  const ca = cod(na), cb = cod(nb)
  if (ca && cb) return ca === cb
  // doar unul are cod („E1: Manager de Proiect" vs „Manager de Proiect") → se compară fără cod
  const fara = (s: string) => s.replace(/^[a-z]?\d+\s*[:.)]\s*/, '')
  const fa = fara(na), fb = fara(nb)
  if (fa === fb) return true
  if ((fa.length >= 4 && fb.length >= 4) && (fa.startsWith(fb) || fb.startsWith(fa))) return true
  // „Șef Șantier" ↔ „Șef de Șantier" ↔ „site manager": același rol canonic (sinonimele din ROL_CANONIC)
  const c1 = rolCanonicDin(fa), c2 = rolCanonicDin(fb)
  return c1 !== 'altul' && c1 === c2
}
function indexeazaMatrice(mat: any[]) {
  const idx = new Map<string, RandMat>(), nume = new Map<string, string>(), roluriMat: string[] = []
  const rolCheie = (rol: string) => { const n = norm(rol); if (roluriMat.includes(n)) return n; return roluriMat.find(r => acelasiRol(r, n)) }
  for (const x of mat) {
    const p = String(x?.persoana || '').trim(); if (!p) continue
    if (!nume.has(norm(p))) nume.set(norm(p), p)
    // rolul din rând se leagă de un rol deja văzut dacă e același (scris altfel), ca să nu apară două chei pentru un rol
    const rn = rolCheie(x.rol) ?? norm(x.rol)
    if (!roluriMat.includes(rn)) roluriMat.push(rn)
    const k = norm(p) + '|' + rn
    const cur = idx.get(k) || { persoana: nume.get(norm(p))!, proiecte: 0, verificate: 0, proiecte_conditionate: 0, verificate_conditionate: 0 }
    cur.proiecte = Math.max(cur.proiecte, num(x.proiecte)); cur.verificate = Math.max(cur.verificate, num(x.verificate))
    cur.proiecte_conditionate = Math.max(cur.proiecte_conditionate, num(x.proiecte_conditionate)); cur.verificate_conditionate = Math.max(cur.verificate_conditionate, num(x.verificate_conditionate))
    idx.set(k, cur)
  }
  const rand = (p: string, rol: string) => { const rn = rolCheie(rol); return rn === undefined ? undefined : idx.get(norm(p) + '|' + rn) }
  const areRol = (rol: string) => rolCheie(rol) !== undefined
  return { persoane: [...nume.values()], rand, areRol }
}
// v1.9: bonusFn = punctele bonus ale unei persoane pe un rol (certificat), adăugate doar când persoana punctează pe barem — intră
// în OPTIMIZARE și în totaluri, nu după alegere (Jakarinos r1 P1 #8).
export function repartizeazaDinMatrice(parsed: any, bonusFn: (r: any, p: string) => number = () => 0) {
  const roluri: any[] = parsed.roluri, mat: any[] = parsed.matrice_experti
  if (!roluri?.length || !mat?.length) return
  const { persoane, rand, areRol } = indexeazaMatrice(mat)
  const rolIdx: number[] = [], bareme: Barem[] = []
  roluri.forEach((r, i) => {
    const b = baremRol(r)
    r.barem_citit = { minim: b.minim, trepte: b.trepte, sursa: b.sursa }
    if (b.trepte.length && areRol(r.rol)) { rolIdx.push(i); bareme.push(b.trepte) }
  })
  if (!rolIdx.length) return
  // strict = necondiționat; cond = strict + transport condiționat. Verificatele nu pot depăși proiectele.
  const nStrict = (p: string, rol: string) => rand(p, rol)?.proiecte ?? 0
  const nCondSuplim = (p: string, rol: string) => rand(p, rol)?.proiecte_conditionate ?? 0
  const nCond = (p: string, rol: string) => nStrict(p, rol) + nCondSuplim(p, rol)
  const vStrict = (p: string, rol: string) => Math.min(nStrict(p, rol), rand(p, rol)?.verificate ?? 0)
  const vCond = (p: string, rol: string) => vStrict(p, rol) + Math.min(nCondSuplim(p, rol), rand(p, rol)?.verificate_conditionate ?? 0)
  const existaConditionate = persoane.some(p => rolIdx.some(i => nCondSuplim(p, roluri[i].rol) > 0))

  // v1.7.1 (recenzie, performanță): punctajele fiecărei (persoană, rol) în ambele scenarii se calculează O DATĂ, într-un tabel;
  // căutarea exhaustivă doar adună — înainte evalua baremul la fiecare frunză și încă o dată la fiecare comparație (12×5 → 15 s,
  // după apelul plătit; un kill pe CPU nu mai ajungea la fail())
  type Cel = { kStrict: number; kCond: number; pStrict: number; mStrict: number; pCond: number; mCond: number; pvStrict: number; pvCond: number }
  const tab = new Map<string, Cel[]>()
  for (const p of persoane) tab.set(p, rolIdx.map((i, j) => {
    const rol = roluri[i].rol, kS = nStrict(p, rol), kC = nCond(p, rol), sS = puncteBarem(bareme[j], kS), sC = puncteBarem(bareme[j], kC)
    const bon = bonusFn(roluri[i], p), cuB = (x: number) => x > 0 ? x + bon : x
    return { kStrict: kS, kCond: kC, pStrict: cuB(sS.puncte), mStrict: sS.marja, pCond: cuB(sC.puncte), mCond: sC.marja, pvStrict: cuB(puncteBarem(bareme[j], vStrict(p, rol)).puncte), pvCond: cuB(puncteBarem(bareme[j], vCond(p, rol)).puncte) }
  }))
  // evaluarea unei alocări într-un scenariu (cond = cu transport); totalul STRICT al aceleiași alocări iese în aceeași trecere
  const evalueaza = (alocare: (string | null)[], cond: boolean): Scenariu => {
    let total = 0, totalStrict = 0, totalVerif = 0, marja = Infinity, proj = 0
    alocare.forEach((p, j) => {
      if (!p) { marja = Math.min(marja, -1); return }
      const c = tab.get(p)![j]
      total += cond ? c.pCond : c.pStrict; totalStrict += c.pStrict; totalVerif += cond ? c.pvCond : c.pvStrict
      marja = Math.min(marja, cond ? c.mCond : c.mStrict); proj += cond ? c.kCond : c.kStrict
    })
    return { total, totalStrict, totalVerif, marja, proj, alocare: [...alocare] }
  }
  // căutare exhaustivă (roluri puține, persoane puține): o persoană pe un singur rol, rolul poate rămâne gol
  const cauta = (cond: boolean, maiBun: (a: Scenariu, b: Scenariu | null) => boolean): Scenariu | null => {
    let best: Scenariu | null = null
    const rec = (k: number, folosite: Set<string>, alocare: (string | null)[]) => {
      if (k === rolIdx.length) { const sc = evalueaza(alocare, cond); if (maiBun(sc, best)) best = sc; return }
      for (const p of persoane) {
        const c = tab.get(p)![k]
        if (!folosite.has(p) && (cond ? c.kCond : c.kStrict) > 0) { folosite.add(p); rec(k + 1, folosite, [...alocare, p]); folosite.delete(p) }
      }
      rec(k + 1, folosite, [...alocare, null])
    }
    rec(0, new Set(), [])
    return best
  }
  // conservator: maxim total strict; la egalitate marja, apoi proiecte
  const conservator = cauta(false, (a, b) => !b || a.total > b.total || (a.total === b.total && (a.marja > b.marja || (a.marja === b.marja && a.proj > b.proj))))
  // condiționat: maxim total cu transport; la egalitate câștigă totalul CONSERVATOR al aceleiași alocări (Jakarinos), apoi marja, apoi proiecte
  const conditionat = cauta(true, (a, b) => !b || a.total > b.total || (a.total === b.total && (a.totalStrict > b.totalStrict || (a.totalStrict === b.totalStrict && (a.marja > b.marja || (a.marja === b.marja && a.proj > b.proj))))))
  const propus = existaConditionate ? conditionat : conservator
  if (!propus || propus.total <= 0) return
  const aceeasiEchipaConservator = evalueaza(propus.alocare, false)
  // echipa propusă chiar folosește proiecte pe transport? (la egalitate câștigă conservatorul, deci poate să nu — atunci nu e „condiționată")
  const folosesteTransport = rolIdx.some((i, j) => !!propus.alocare[j] && nCondSuplim(propus.alocare[j]!, roluri[i].rol) > 0)

  const rezumat = persoane.map(p => p + ': ' + rolIdx.map(i => { const r = roluri[i].rol, a = nStrict(p, r), b = nCondSuplim(p, r); return r + '=' + a + (b ? '+' + b + 'T' : '') }).join('/')).join('; ')
  const alocati = new Map<string, string>(), alocatIdx = new Set<number>()
  propus.alocare.forEach((p, j) => { if (p) { alocati.set(norm(p), roluri[rolIdx[j]].rol); alocatIdx.add(rolIdx[j]) } })
  rolIdx.forEach((i, j) => {
    const p = propus.alocare[j], r = roluri[i]
    if (!p) return
    const kStrict = nStrict(p, r.rol), kSup = nCondSuplim(p, r.rol), kCond = kStrict + kSup
    const sCond = puncteBarem(bareme[j], kCond), sStrict = puncteBarem(bareme[j], kStrict)
    const vc = vCond(p, r.rol), sVerif = puncteBarem(bareme[j], vc)
    const schimbat = norm(r.propunere) !== norm(p)
    r.propunere = p
    const bon = bonusFn(r, p), cuB = (x: number) => x > 0 ? x + bon : x
    if (bon) { sCond.puncte = cuB(sCond.puncte); sStrict.puncte = cuB(sStrict.puncte); sVerif.puncte = cuB(sVerif.puncte) }   // inclusiv în motiv
    r.puncte_conditionat = sCond.puncte; r.puncte_conservator = sStrict.puncte; r.puncte_doar_verificate = sVerif.puncte
    r.proiecte_conditionate = kSup; r.proiecte_neconditionate = kStrict
    let m = `[Repartizare calculată din matrice] ${p}: ${kCond} proiecte pe ${r.rol}` + (kSup ? ` (din care ${kSup} pe TRANSPORT, condiționate de acceptarea autorității)` : '') +
      ` → ${sCond.puncte} puncte (marjă ${sCond.marja} peste prag)`
    if (kSup) {
      m += `; fără transport: ${kStrict} proiecte → ${sStrict.puncte} puncte`
      r.depinde_de_transport = true   // riscul de eliminare + clarificarea: marcheazaRiscTransport (regula 8)
    }
    m += `. Verificate în HR: ${vc} (punctaj doar pe verificate: ${sVerif.puncte}${vc < kCond ? ' — de confirmat în HR înainte de depunere' : ''}). Echipa: ${propus.total} puncte` +
      (folosesteTransport ? ` cu transport / ${aceeasiEchipaConservator.total} fără` : '') + `. Matrice: ${rezumat}.`
    r.motiv = m + (schimbat ? ' Propunerea AI inițială a fost înlocuită.' : '') + (r.motiv ? ' — ' + String(r.motiv) : '')
  })
  // v1.7.1 (recenzie): rolurile pe care codul nu a pus pe nimeni rămân pe propunerea AI — dar dacă acea persoană a fost repartizată
  // din matrice pe ALT rol, e cumul (regula 5): se spune în motiv și se pune clarificarea de cumul; înainte ieșea aceeași persoană
  // pe două roluri fără nicio notă
  const clarCumul: string[] = []
  roluri.forEach((r, i) => {
    if (alocatIdx.has(i) || !r.propunere) return
    const alt = alocati.get(norm(r.propunere))
    if (!alt || norm(alt) === norm(r.rol)) return
    r.cumul_cu = alt
    r.motiv = `CUMUL: ${r.propunere} e repartizat(ă) din matrice pe „${alt}", iar pe „${r.rol}" nu are proiecte dovedite în matrice — propunerea rămâne doar ca punct de plecare, cu clarificare de cumul către autoritate (regula 5). ` + String(r.motiv || '')
    clarCumul.push(`Referitor la rolurile „${alt}" și „${r.rol}": vă rugăm să precizați dacă aceeași persoană poate ocupa ambele poziții (cumul de funcții) sau dacă se solicită persoane distincte pentru fiecare rol.`)
  })
  parsed.clarificari_cumul = clarCumul
  const aloc = (sc: Scenariu | null) => sc ? rolIdx.map((i, j) => ({ rol: roluri[i].rol, persoana: sc.alocare[j] })) : []
  parsed.repartizare_calculata = {
    scenariu_propus: folosesteTransport ? 'conditionat' : 'conservator',
    depinde_de_transport: folosesteTransport && aceeasiEchipaConservator.total < propus.total,
    roluri_cu_risc_eliminare: [] as string[],   // completat de marcheazaRiscTransport
    conditionat: { total_puncte: propus.total, total_doar_verificate: propus.totalVerif, alocare: aloc(propus) },
    aceeasi_echipa_fara_transport: { total_puncte: aceeasiEchipaConservator.total, total_doar_verificate: aceeasiEchipaConservator.totalVerif },
    conservator: { total_puncte: conservator?.total ?? 0, total_doar_verificate: conservator?.totalVerif ?? 0, alocare: aloc(conservator) },
    // compatibilitate cu UI-ul vechi
    total_puncte: propus.total, alocare: aloc(propus),
  }
}
// v1.7.1 (recenzie 23.09): clarificarea „transport acceptat ca similar?" și RISCUL DE ELIMINARE (regula 8) se marchează AICI,
// pentru FIECARE rol — indiferent dacă baremul s-a putut citi sau dacă echipa a ieșit cu 0 puncte. Înainte stăteau în bucla
// de repartizare, deci un rol cu cerință minimă nepunctată („minim 1 proiect similar în distribuție") sau o echipă cu total 0
// ieșeau fără clarificare, fără risc și cu verdict „mergem" — exact ce promptul îi spune modelului că „face codul singur".
export function marcheazaRiscTransport(parsed: any) {
  const roluri: any[] = Array.isArray(parsed.roluri) ? parsed.roluri : [], mat: any[] = Array.isArray(parsed.matrice_experti) ? parsed.matrice_experti : []
  const { persoane, rand } = indexeazaMatrice(mat)
  const clar: string[] = [], roluriCuRisc: string[] = [], roluriCond: string[] = []
  for (const r of roluri) {
    const randuri = persoane.map(p => rand(p, r.rol)).filter(Boolean) as RandMat[]
    if (!randuri.some(x => x.proiecte_conditionate > 0)) continue
    // există candidați cu proiecte pe transport la rolul ăsta → întrebarea către autoritate e obligatorie, chiar dacă propusul e altcineva
    roluriCond.push(r.rol)
    const cer = String(r.cerinte || '').replace(/\s+/g, ' ').trim().slice(0, 260)
    clar.push(`Referitor la rolul „${r.rol}"${cer ? ` (cerința: „${cer}${String(r.cerinte || '').trim().length > 260 ? '…' : ''}")` : ''}: vă rugăm să confirmați dacă experiența dobândită în execuția de conducte de transport gaze naturale (presiune înaltă) este acceptată ca experiență similară/superioară pentru cerința privind rețelele de distribuție gaze naturale, atât la îndeplinirea cerinței minime, cât și la punctarea factorului de evaluare.`)
    const rp = r.propunere ? rand(String(r.propunere), r.rol) : undefined
    const kSup = rp?.proiecte_conditionate ?? 0
    if (!rp || !kSup) continue
    const kStrict = rp.proiecte, kCond = kStrict + kSup
    r.depinde_de_transport = true
    if (!Number.isFinite(r.proiecte_conditionate)) { r.proiecte_conditionate = kSup; r.proiecte_neconditionate = kStrict }
    // cerința minimă: cea scrisă în text („minim N proiecte/contracte"), altfel treapta nepunctată din barem, altfel 1
    const pragMin = baremRol(r).minim
    if (kStrict < pragMin && kCond >= pragMin) {
      r.risc_eliminare = true; roluriCuRisc.push(r.rol)
      const txt = `RISC: cerința minimă (${pragMin} proiect${pragMin > 1 ? 'e' : ''}) depinde de acceptarea transportului — la refuz oferta poate fi respinsă, nu doar depunctată.`
      if (!String(r.motiv || '').includes('RISC: cerința minimă')) r.motiv = txt + (r.motiv ? ' ' + String(r.motiv) : '')
    }
  }
  parsed.clarificari_cod = [...clar, ...(Array.isArray(parsed.clarificari_cumul) ? parsed.clarificari_cumul : [])]
  delete parsed.clarificari_cumul
  parsed.risc_transport = { roluri_conditionate: roluriCond, roluri_cu_risc_eliminare: roluriCuRisc }
  if (parsed.repartizare_calculata) parsed.repartizare_calculata.roluri_cu_risc_eliminare = roluriCuRisc
}

// v1.8 (Răzvan, 23.09.2026): MATRICEA CALCULATĂ DE COD din BD — recomandare × rol × natură, din obiectivele structurate (#1399).
// Modelul spune doar ce rol canonic și ce natură cere fișa; numărătoarea e deterministă (aceleași cifre la fiecare rulare).
// Rândurile modelului rămân rezervă pentru recomandările fără obiective structurate.
const ROL_CANONIC: Array<[RegExp, string]> = [
  [/responsabil tehnic|\brte\b/i, 'rte'], [/sef.*santier|site manager|șef.*șantier/i, 'sef_santier'],
  [/(manager|director|coordonator|sef|șef)\s*(de\s+|al\s+)?(proiect|project|contract)|project manager/i, 'manager_proiect'],
  [/\bcq\b|calitate|ctc/i, 'cq'], [/\bssm\b|securitate/i, 'ssm'], [/inginer/i, 'inginer'],
]
const rolCanonicDin = (rol: string) => { const n = norm(rol); for (const [re, c] of ROL_CANONIC) if (re.test(n)) return c; return 'altul' }
export function matriceDinBD(parsed: any, recs: any[]) {
  const roluri: any[] = Array.isArray(parsed.roluri) ? parsed.roluri : []
  const NAT = ['distributie', 'transport', 'gaze_orice']
  const calculate = roluri.filter(r => r.rol_canonic && r.rol_canonic !== 'altul' && NAT.includes(String(r.natura_ceruta || '')))
  if (!calculate.length) return
  const randuri: any[] = []
  for (const r of calculate) {
    const perPers = new Map<string, { proiecte: Set<string>; verificate: Set<string>; cond: Set<string>; verifCond: Set<string>; surse: string[] }>()
    for (const x of recs) {
      if (rolCanonicDin(String(x.rol || '')) !== r.rol_canonic) continue
      const ob: any[] = Array.isArray(x.obiective) ? x.obiective : []
      if (!ob.length) continue
      const cine = x.emp?.name || x.ext?.nume; if (!cine) continue
      const acc = perPers.get(cine) || { proiecte: new Set(), verificate: new Set(), cond: new Set(), verifCond: new Set(), surse: [] }
      let nS = 0, nC = 0, nEx = 0, idx = 0
      for (const o of ob) {
        // cheia de dedup: denumire + an + beneficiar final — între recomandări diferite; în aceeași recomandare, fiecare element
        // se numără (o listă „punere în siguranță ×15" ar fi devenit 1). Sufixul cu id-ul recomandării ține elementele ei distincte
        // când n-au an/beneficiar (nu se pot deosebi de altele decât prin poziție).
        const baza = norm(o.denumire); if (!baza) continue
        const k = (o.an || o.beneficiar_final) ? `${baza}|${o.an || ''}|${norm(o.beneficiar_final || '')}` : `${baza}|r${x.id}#${idx++}`
        const nat = String(o.natura || 'altele')
        const strict = r.natura_ceruta === 'gaze_orice' ? (nat === 'transport' || nat === 'distributie') : nat === r.natura_ceruta
        const cond = !strict && r.natura_ceruta === 'distributie' && nat === 'transport' && !r.exclude_transport
        if (strict) { acc.proiecte.add(k); if (x.verificat) acc.verificate.add(k); nS++ }
        else if (cond) { acc.cond.add(k); if (x.verificat) acc.verifCond.add(k); nC++ }
        else nEx++
      }
      acc.surse.push(`${x.beneficiar || '?'}${x.nr_document ? ' nr. ' + x.nr_document : ' fără nr.'}: ${nS} pe natura cerută${nC ? `, ${nC} transport — condiționat` : ''}${nEx ? `, excluse: ${nEx}` : ''}${x.verificat ? '' : ' [neverificată]'}`)
      perPers.set(cine, acc)
    }
    for (const [p, a] of perPers) randuri.push({ persoana: p, rol: r.rol, proiecte: a.proiecte.size, verificate: a.verificate.size, proiecte_conditionate: a.cond.size, verificate_conditionate: a.verifCond.size, surse: a.surse.join('; '), sursa_matrice: 'cod' })
  }
  // rândurile modelului rămân doar pentru rolurile necalculate și pentru persoanele fără niciun rând calculat pe rolul respectiv
  const modelRows: any[] = Array.isArray(parsed.matrice_experti) ? parsed.matrice_experti : []
  const areCod = (rol: string, p: string) => randuri.some(x => acelasiRol(x.rol, rol) && norm(x.persoana) === norm(p))
  const pastrate = modelRows.filter(m => !calculate.some(r => acelasiRol(m.rol, r.rol)) || !areCod(m.rol, m.persoana))
  parsed.matrice_experti = [...randuri, ...pastrate.map(m => ({ ...m, sursa_matrice: m.sursa_matrice || 'model' }))].slice(0, 80)
  parsed.matrice_sursa = { roluri_calculate: calculate.map(r => r.rol), randuri_cod: randuri.length, randuri_model: pastrate.length }
}
