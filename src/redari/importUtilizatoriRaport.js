// Redări PR4b — raportul importului de utilizatori / arendași (funcții pure, fără rețea): totaluri, tabel pe UAT, rândurile pe categorii
// și CSV-ul descărcabil (înainte ȘI după scriere). Intrările sunt rezultatul lui parseazaUtilizatori + planUtilizatori (importUtilizatori.js);
// starea „după scriere” se reconstituie din BD (planul refăcut după scriere), nu din ce credea ecranul (L05).
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
      motiv: '', dupa: dupa ? (dupa.get(x.rand) ?? 'neschimbat (nu era de scris)') : '', ...extra,
    })
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

/**
 * Starea după scriere, reconstituită din BD: `planDupa` = planUtilizatori(aceiași candidați, datele recitite DUPĂ scriere).
 * Rândurile „nou” din planul confirmat: în BD acum (deja deținător) = scris; încă „nou” = nescris (motivul din lot, dacă l-a dat scrierea).
 * Fără planDupa (recitirea a eșuat) → „necunoscută” pentru rândurile noi; nimic nu se declară scris fără dovadă (L18).
 */
export function stareDupaScriere(plan, planDupa, lot = null) {
  const m = new Map()
  const schimbate = new Map((lot?.diferente?.schimbate_la_scriere || []).map(s => [s.rand, s.motiv]))
  const inBd = new Set((planDupa?.deja_detinatori || []).map(d => d.rand))
  const tot = new Set((planDupa?.noi || []).map(n => n.rand))
  const negasite = new Set((planDupa?.parcela_negasita || []).map(n => n.rand))
  for (const n of plan?.noi || []) {
    if (!planDupa) m.set(n.rand, 'necunoscută — recitirea din BD după scriere a eșuat; refaceți previzualizarea')
    else if (inBd.has(n.rand)) m.set(n.rand, 'în BD: utilizator activ pe parcelă')
    else if (schimbate.has(n.rand)) m.set(n.rand, `NESCRIS: ${schimbate.get(n.rand)}`)
    else if (negasite.has(n.rand)) m.set(n.rand, 'NESCRIS: parcela nu mai e găsită în proiect')
    else if (tot.has(n.rand)) m.set(n.rand, 'NESCRIS: încă de importat (scrierea s-a oprit înainte) — refaceți previzualizarea și reluați')
    else m.set(n.rand, 'NESCRIS: exclus la recitire (coliziune) — de verificat')
  }
  return m
}

const ANTET = ['Rând Excel', 'Categorie', 'UAT', 'Parcelă (id)', 'Cheie (UAT|HG|cadastru|tarla)', 'Potrivire', 'Nume utilizator', 'Cu adresă', 'Cu telefon', 'Motiv']
/** CSV-ul raportului: UTF-8 cu BOM, „;”, CRLF; coloana „După scriere” doar în raportul de după scriere. */
export function csvRaportUtilizatori(randuri, { dupa = false } = {}) {
  const cap = dupa ? [...ANTET, 'După scriere (din BD)'] : ANTET
  const linii = (randuri || []).map(r => {
    const v = [r.rand ?? '', r.eticheta, r.uat, r.id_parcela, r.cheie_sursa, r.potrivire === 'hg' ? 'poziție HG' : r.potrivire === 'cheie' ? 'cheie exactă' : '', r.nume, r.cu_adresa, r.cu_telefon, r.motiv]
    return dupa ? [...v, r.dupa] : v
  })
  return BOM + [cap, ...linii].map(l => l.map(celulaCsv).join(';')).join('\r\n') + '\r\n'
}
