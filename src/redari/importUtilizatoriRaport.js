// Redări PR4b — raportul importului de utilizatori / arendași (funcții pure, fără rețea): totaluri, tabel pe UAT, rândurile pe categorii
// și CSV-ul descărcabil (înainte ȘI după scriere). Intrările sunt rezultatul lui parseazaUtilizatori + planUtilizatori (importUtilizatori.js);
// starea „după scriere” se reconstituie din BD (reconciliazaImport: parcela confirmată, calitatea, contactul, marcajul lotului), nu din ce
// credea ecranul (L05).
// CSV: UTF-8 cu BOM, separator „;”, celulele trec prin celulaCsv (aceeași neutralizare = + - @ ca borderoul și exporturile de notificări).
import { celulaCsv } from './docx.js'

const BOM = String.fromCharCode(0xFEFF)

// Ordinea categoriilor în raport și în ecran
export const CATEGORII = [
  { cod: 'nou', eticheta: 'Nou (se importă)' },
  { cod: 'deja', eticheta: 'Deja deținător pe parcelă' },
  { cod: 'negasita', eticheta: 'Parcelă negăsită' },
  { cod: 'coliziune', eticheta: 'Coliziune' },
  { cod: 'exclus', eticheta: 'Exclus (aceeași persoană cu adrese diferite)' },
  { cod: 'dublura', eticheta: 'Dublură în fișier' },
  { cod: 'fara_cheie', eticheta: 'Fără cheie' },
  { cod: 'in_afara', eticheta: 'În afara proiectului' },
]
const ETICHETA = Object.fromEntries(CATEGORII.map(c => [c.cod, c.eticheta]))
export const MOTIV_NOU = 'utilizator nou pe parcelă'
export const MOTIV_NOU_HG = 'utilizator nou; parcela găsită după poziția HG (cheia exactă diferă) — de verificat'

const lung = v => (Array.isArray(v) ? v.length : 0)

/** Totalurile previzualizării (cifrele din cardurile ecranului și din confirmare). */
export function totaluriImport(parsat, plan) {
  const sp = parsat?.statistici || {}, pl = plan?.statistici || {}
  const noi = plan?.noi || []
  return {
    randuri: sp.randuri ?? 0, cu_utilizator: sp.cu_utilizator ?? 0, in_afara_proiectului: sp.in_afara_proiectului ?? 0,
    fara_cheie: sp.fara_cheie ?? 0, dubluri_fisier: sp.dubluri_fisier ?? 0, candidati: sp.candidati ?? lung(parsat?.candidati),
    noi: noi.length, persoane_noi: pl.persoane_noi ?? new Set(noi.map(n => n.nume_normalizat)).size,
    parcele_noi: new Set(noi.map(n => n.parcela_id)).size,
    deja_detinatori: lung(plan?.deja_detinatori), parcela_negasita: lung(plan?.parcela_negasita), coliziuni: lung(plan?.coliziuni),
    exclusi: randuriExcluse(parsat, plan).length,
    potrivire_hg: noi.filter(n => n.potrivire === 'hg').length,
    cu_adresa: noi.filter(n => n.contact?.adresa_cunoscuta).length, cu_telefon: noi.filter(n => n.contact?.telefon).length,
  }
}

// Primul rând al unei coliziuni cu adrese diferite iese din plan fără intrare proprie (planUtilizatori îl scoate din `noi`):
// îl regăsim ca orice candidat care nu e în nicio listă a planului, legat de coliziunea care îl numește în `rand_ales`.
function randuriExcluse(parsat, plan) {
  const vazute = new Set([...(plan?.noi || []), ...(plan?.deja_detinatori || []), ...(plan?.parcela_negasita || []), ...(plan?.coliziuni || [])].map(x => x.rand))
  return (parsat?.candidati || []).filter(c => !vazute.has(c.rand))
}

/** Tabelul pe UAT (doar UAT-urile proiectului; cele din afara proiectului apar doar ca număr total). */
export function totaluriPeUat(parsat, plan, uats = []) {
  const rez = new Map(uats.map(u => [u.uat3, { uat3: u.uat3, nume: u.nume, candidati: 0, noi: 0, persoane: new Set(), deja: 0, negasite: 0, coliziuni: 0, potrivire_hg: 0, fara_cheie: 0, dubluri: 0 }]))
  const rand = u => { if (!rez.has(u)) rez.set(u, { uat3: u, nume: u, candidati: 0, noi: 0, persoane: new Set(), deja: 0, negasite: 0, coliziuni: 0, potrivire_hg: 0, fara_cheie: 0, dubluri: 0 }); return rez.get(u) }
  for (const c of parsat?.candidati || []) rand(c.uat3).candidati++
  for (const f of parsat?.fara_cheie || []) rand(f.uat3).fara_cheie++
  for (const d of parsat?.dubluri_fisier || []) rand(d.uat3).dubluri++
  for (const n of plan?.noi || []) { const r = rand(n.uat3); r.noi++; r.persoane.add(n.nume_normalizat); if (n.potrivire === 'hg') r.potrivire_hg++ }
  for (const d of plan?.deja_detinatori || []) rand(d.uat3).deja++
  for (const x of plan?.parcela_negasita || []) rand(x.uat3).negasite++
  for (const x of plan?.coliziuni || []) rand(x.uat3).coliziuni++
  return [...rez.values()].map(r => ({ ...r, persoane: r.persoane.size }))
}

/**
 * Rândurile raportului: un rând Excel cu utilizator = un rând de raport, cu categoria și motivul (rândurile fără utilizator nu intră).
 * `dupa` (opțional) = Map rand → textul stării după scriere (stareDupaScriere).
 */
export function randuriRaport(parsat, plan, dupa = null) {
  const candidat = new Map((parsat?.candidati || []).map(c => [c.rand, c]))
  const out = []
  const adauga = (cod, x, extra = {}) => {
    const c = candidat.get(x.rand) || {}
    const contact = x.contact !== undefined ? x.contact : c.contact
    out.push({
      rand: x.rand ?? null, categorie: cod, eticheta: ETICHETA[cod], uat: x.uat3 ?? c.uat3 ?? x.uat ?? '',
      id_parcela: x.id_parcela ?? '', cheie_sursa: x.cheie_sursa ?? c.cheie_sursa ?? '', potrivire: x.potrivire ?? '',
      nume: x.nume ?? c.nume ?? '', cu_adresa: contact ? (contact.adresa_cunoscuta ? 'da' : 'nu') : '', cu_telefon: contact ? (contact.telefon ? 'da' : 'nu') : '',
      motiv: '', ...extra,
    })
    // r2: `dupa` = Map rand → { cod, text, id, contact } (stareDupaScriere); rândurile fără stare nu erau de scris
    const s = dupa && x.rand != null && !['dublura', 'in_afara', 'fara_cheie'].includes(cod) ? dupa.get(x.rand) : null
    Object.assign(out[out.length - 1], { dupa: dupa ? (s?.text ?? 'neschimbat (nu era de scris)') : '', dupa_cod: s?.cod ?? '', dupa_id: s?.id ?? '', dupa_contact: s?.contact ?? null })
  }
  for (const n of plan?.noi || []) adauga('nou', n, { motiv: n.potrivire === 'hg' ? MOTIV_NOU_HG : MOTIV_NOU })
  for (const d of plan?.deja_detinatori || []) adauga('deja', d, { motiv: d.motiv + (d.contact === null ? '; contactul NU se completează (aceeași persoană apare cu adrese diferite)' : '') })
  for (const x of plan?.parcela_negasita || []) adauga('negasita', x, { motiv: x.motiv })
  for (const x of plan?.coliziuni || []) adauga('coliziune', x, { motiv: `${x.motiv} (rândul ales: ${x.rand_ales})` })
  for (const c of randuriExcluse(parsat, plan)) {
    const legat = (plan?.coliziuni || []).find(x => x.rand_ales === c.rand)
    adauga('exclus', c, { motiv: `exclus: aceeași persoană pe aceeași parcelă apare${legat ? ` și la rândul ${legat.rand}` : ''} cu altă adresă — de verificat` })
  }
  for (const d of parsat?.dubluri_fisier || []) adauga('dublura', d, { motiv: `identic cu rândul ${d.rand_original} (aceeași persoană, parcelă și contact) — numărat o dată` })
  for (const f of parsat?.fara_cheie || []) adauga('fara_cheie', f, { motiv: f.motiv })
  for (const x of parsat?.in_afara_proiectului || []) adauga('in_afara', { rand: x.rand, uat3: x.uat }, { motiv: `UAT-ul „${x.uat}” nu face parte din proiect`, nume: '' })
  return out.sort((a, b) => (a.rand ?? Infinity) - (b.rand ?? Infinity) || CATEGORII.findIndex(c => c.cod === a.categorie) - CATEGORII.findIndex(c => c.cod === b.categorie))
}

// Stările după scriere (r2, Jak PR1120 P2): fiecare stare se stabilește din parcela CONFIRMATĂ a rândului + calitatea recitită + contact +
// marcajul lotului („; lot <uuid>” în sursa_date); motivul consemnat în lot („țintă schimbată”) are prioritate.
export const STARI_DUPA = {
  scris: 'scris de această operație',
  scris_fara_contact: 'scris de această operație — contact lipsă',
  de_verificat: 'de verificat: ținta s-a schimbat în timpul importului',
  exista_utilizator: 'există deja ca utilizator (nu de această operație) — nescris',
  exista_alta_calitate: 'există deja cu altă calitate — nescris',
  nescris_tinta: 'nescris: țintă schimbată',
  nescris_oprit: 'nescris: importul s-a oprit înainte — refaceți previzualizarea și reluați',
  hg_neconfirmat: 'neimportat: potrivire după poziția HG, neconfirmată — se poate importa ulterior, cu bifa',
  contact_completat: 'contact completat de această operație',
  necunoscut: 'necunoscut — de verificat',
}
const UTILIZATOR = new Set(['utilizator', 'arendas'])

/**
 * stareDupaScriere(plan, rec, lot, lotId) → Map rand → { cod, text, id?, contact? }
 *  plan = planul confirmat (complet, cu potrivirile HG); plan.hg_neconfirmate = rândurile HG pe care operatorul NU le-a inclus;
 *  rec = reconciliazaImport(...) citit DUPĂ scriere (null = recitirea a eșuat → „necunoscut”, nimic declarat scris fără dovadă, L18);
 *  lot = rândul red_import_loturi recitit (diferente.schimbate_la_scriere, contacte_scrise); lotId = id-ul lotului acestei operații (marcajul).
 */
export function stareDupaScriere(plan, rec, lot = null, lotId = null) {
  const m = new Map()
  const st = (cod, extra = {}, detaliu = '') => ({ cod, text: STARI_DUPA[cod] + (detaliu ? ` (${detaliu})` : ''), ...extra })
  const schimbate = new Map((lot?.diferente?.schimbate_la_scriere || []).map(s => [s.rand, s.motiv]))
  const hgNeconf = new Set((plan?.hg_neconfirmate || []).map(n => n.rand))
  const activ = new Map((rec?.detinatori || []).map(d => [`${d.parcela_id}|${d.nume_normalizat}`, d]))
  const deVerificat = new Map((rec?.deVerificat || []).map(v => [v.id, v.motiv]))
  const contacteLot = new Set(lot?.diferente?.contacte_scrise || [])
  const scrisDeAcest = d => !!lotId && !!d && String(d.sursa_date || '').endsWith(`; lot ${lotId}`)
  for (const n of plan?.noi || []) {
    if (hgNeconf.has(n.rand)) { m.set(n.rand, st('hg_neconfirmat')); continue }
    if (!rec) { m.set(n.rand, st('necunoscut', {}, 'recitirea din BD după scriere a eșuat; refaceți previzualizarea')); continue }
    const d = activ.get(`${n.parcela_id}|${n.nume_normalizat}`)   // DOAR pe parcela confirmată (nu pe alta găsită acum)
    const sch = schimbate.get(n.rand)
    if (scrisDeAcest(d)) {
      const contact = rec.contacte?.has(d.id) ?? false
      if (sch) m.set(n.rand, st('necunoscut', { id: d.id, contact }, 'lotul spune „nescris”, dar baza are rândul cu marcajul acestui lot'))
      else if (deVerificat.has(d.id)) m.set(n.rand, { cod: 'de_verificat', text: deVerificat.get(d.id), id: d.id, contact })
      else if (!UTILIZATOR.has(d.calitate)) m.set(n.rand, st('de_verificat', { id: d.id, contact }, `calitatea e acum „${d.calitate}”`))
      else if (!contact) m.set(n.rand, st('scris_fara_contact', { id: d.id, contact }))
      else m.set(n.rand, st('scris', { id: d.id, contact }))
    } else if (sch) m.set(n.rand, { cod: 'nescris_tinta', text: `${STARI_DUPA.nescris_tinta}: ${sch}` })
    else if (d && UTILIZATOR.has(d.calitate)) m.set(n.rand, st('exista_utilizator', { id: d.id }))
    else if (d) m.set(n.rand, st('exista_alta_calitate', { id: d.id }, `„${d.calitate}”`))
    else if (!lotId) m.set(n.rand, st('nescris_oprit', {}, 'lotul nu s-a creat'))
    else if (lot?.stare === 'finalizat') m.set(n.rand, st('necunoscut', {}, 'lotul e finalizat, dar persoana nu e activă pe parcela confirmată'))
    else m.set(n.rand, st('nescris_oprit'))
  }
  // „deja deținători”: doar contactul se poate completa; îl declarăm completat numai dacă lotul îl are în evidență ȘI baza îl are acum
  for (const x of plan?.deja_detinatori || []) {
    const d = activ.get(`${x.parcela_id}|${x.nume_normalizat}`)
    if (d && contacteLot.has(d.id) && rec?.contacte?.has(d.id)) m.set(x.rand, st('contact_completat', { id: d.id, contact: true }))
  }
  return m
}

/** Numărul rândurilor pe fiecare stare (cardurile ecranului). */
export function numaraStari(dupa) {
  const t = Object.fromEntries(Object.keys(STARI_DUPA).map(k => [k, 0]))
  for (const v of dupa?.values?.() || []) t[v.cod] = (t[v.cod] || 0) + 1
  return t
}

const ANTET = ['Rând Excel', 'Categorie', 'UAT', 'Parcelă (id)', 'Cheie (UAT|HG|cadastru|tarla)', 'Potrivire', 'Nume utilizator', 'Cu adresă', 'Cu telefon', 'Motiv']
/**
 * CSV-ul raportului: UTF-8 cu BOM, „;”, CRLF. Raportul de după scriere are în plus starea din BD, id-ul deținătorului (scris sau găsit) și
 * dacă are contact (r2 pct. 6: evidența exactă a ce s-a scris). Conține nume: se păstrează local, nu se urcă în repository / PR.
 */
export function csvRaportUtilizatori(randuri, { dupa = false } = {}) {
  const cap = dupa ? [...ANTET, 'După scriere (din BD)', 'ID deținător', 'Contact în BD'] : ANTET
  const linii = (randuri || []).map(r => {
    const v = [r.rand ?? '', r.eticheta, r.uat, r.id_parcela, r.cheie_sursa, r.potrivire === 'hg' ? 'poziție HG' : r.potrivire === 'cheie' ? 'cheie exactă' : '', r.nume, r.cu_adresa, r.cu_telefon, r.motiv]
    return dupa ? [...v, r.dupa, r.dupa_id ?? '', r.dupa_contact == null ? '' : (r.dupa_contact ? 'da' : 'nu')] : v
  })
  return BOM + [cap, ...linii].map(l => l.map(celulaCsv).join(';')).join('\r\n') + '\r\n'
}
