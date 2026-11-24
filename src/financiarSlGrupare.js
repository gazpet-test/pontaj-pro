// ===========================================================================
// Financiar — gruparea SL fără factură după nr. de factură scris pe SL (TKT-2026-0363)
// ===========================================================================
// Funcții pure (fără supabase), testate în financiarSlGrupare.test.js.
// Pe SL, `executie_situatii_plata.nr_factura` e text liber scris de mână ("gaz 418", "GAZ-418",
// "Gaz418"). Mai multe SL ale aceluiași proiect cu același număr = o singură factură de emis.
// Nimic nu se emite automat: gruparea doar propune, utilizatorul verifică și salvează.

// Forma recunoscută: SERIE (doar litere A-Z) + separator opțional (spații / cratime) + NUMĂR (cifre).
// Orice altceva ("418", "GAZ 418/419", "GAZ-418, GAZ-419", rânduri noi) = nerecunoscut → SL rămâne individual.
const RE_NR_FACTURA = /^([A-Z]+)[\s-]*([0-9]+)$/

// "gaz 418" → { serie:'GAZ', nr:418, canonic:'GAZ-418' }; nerecunoscut / gol → null
export function normalizeazaNrFactura(text) {
  if (text === null || text === undefined) return null
  const s = String(text)
  if (/[\r\n]/.test(s)) return null
  const t = s.trim().toUpperCase()
  if (!t) return null
  const m = RE_NR_FACTURA.exec(t)
  if (!m) return null
  const nr = Number.parseInt(m[2], 10)
  if (!Number.isSafeInteger(nr) || nr <= 0) return null
  return { serie: m[1], nr, canonic: `${m[1]}-${nr}` }
}

// Ordine cronologică unică (folosită și de alertă, și de generarea liniilor din modal):
// an, lună, apoi id; an/lună lipsă la final (ca ORDER BY ... ASC din PostgreSQL).
const _num = v => { const n = Number(v); return v === null || v === undefined || v === '' || !Number.isFinite(n) ? Infinity : n }
export function comparaCronologic(a, b) {
  return (_num(a?.an) - _num(b?.an)) || (_num(a?.luna) - _num(b?.luna)) || (_num(a?.id) - _num(b?.id)) || 0
}
export function sorteazaCronologic(lista) {
  return [...(lista || [])].sort((a, b) => {
    const d = comparaCronologic(a, b)
    return Number.isNaN(d) ? 0 : d
  })
}

// slAlert: rândurile din v_sl_fara_factura; nrFacturaPeId: Map/obiect id → nr_factura (text brut).
// Rezultat: elemente în ordinea primei SL (cronologic), fiecare:
//   { tip:'grup', cheie, proiect_id, serie, nr, canonic, sl:[...] }   (≥ 2 SL, același proiect + același nr normalizat)
//   { tip:'individual', cheie, sl:[x], nr_factura_text, nr_recunoscut }
// Fiecare SL din intrare apare exact o dată în rezultat (nimic nu dispare).
export function grupeazaSlFaraFactura(slAlert, nrFacturaPeId) {
  const nrDe = id => {
    if (!nrFacturaPeId) return null
    if (nrFacturaPeId instanceof Map) return nrFacturaPeId.has(id) ? nrFacturaPeId.get(id) : null
    return Object.prototype.hasOwnProperty.call(nrFacturaPeId, id) ? nrFacturaPeId[id] : null
  }
  const ordonate = sorteazaCronologic(slAlert)
  const grupe = new Map()   // cheie proiect|canonic → lista SL
  const info = new Map()    // id SL → { text, norm }
  for (const sl of ordonate) {
    const text = nrDe(sl.id)
    const norm = normalizeazaNrFactura(text)
    info.set(sl.id, { text: text === null || text === undefined ? null : String(text), norm })
    if (norm && sl.proiect_id !== null && sl.proiect_id !== undefined && sl.proiect_id !== '') {
      const cheie = `${String(sl.proiect_id)}|${norm.canonic}`
      if (!grupe.has(cheie)) grupe.set(cheie, [])
      grupe.get(cheie).push(sl)
    }
  }
  const rezultat = []
  const emise = new Set()
  for (const sl of ordonate) {
    const { text, norm } = info.get(sl.id)
    const cheie = norm && sl.proiect_id !== null && sl.proiect_id !== undefined && sl.proiect_id !== ''
      ? `${String(sl.proiect_id)}|${norm.canonic}` : null
    const membri = cheie ? grupe.get(cheie) : null
    if (membri && membri.length >= 2) {
      if (emise.has(cheie)) continue
      emise.add(cheie)
      rezultat.push({ tip: 'grup', cheie, proiect_id: sl.proiect_id, serie: norm.serie, nr: norm.nr, canonic: norm.canonic, sl: membri })
    } else {
      rezultat.push({ tip: 'individual', cheie: `sl|${sl.id}`, sl: [sl], nr_factura_text: text && text.trim() ? text.trim() : null, nr_recunoscut: norm ? norm.canonic : null })
    }
  }
  return rezultat
}

// Decizia de precompletare a seriei/numărului pentru o factură grupată.
// verificare: { stare:'liber' } | { stare:'folosit' } | { stare:'eroare' } (citirea exactă pe (serie, nr) din facturi_emise)
// Rezultat: { serie, nr, mesaj } — serie/nr null = câmpul rămâne cum era (serie implicită, nr gol → automat).
export function decidePrecompletare(grup, seriiPermise, verificare) {
  const canonic = grup?.canonic || '—'
  if (!grup || !grup.serie || !Number.isSafeInteger(grup.nr) || grup.nr <= 0) {
    return { serie: null, nr: null, mesaj: 'Numărul scris pe SL nu a putut fi citit: completează seria și numărul manual sau lasă numărul gol (automat).' }
  }
  if (!(seriiPermise || []).includes(grup.serie)) {
    return { serie: null, nr: null, mesaj: `Seria „${grup.serie}” din numărul scris pe SL (${canonic}) nu există în platformă: alege seria și lasă numărul gol (automat) sau completează-l manual.` }
  }
  const st = verificare?.stare
  if (st === 'liber') return { serie: grup.serie, nr: grup.nr, mesaj: `Seria și numărul au fost precompletate din SL (${canonic}). Verifică înainte de salvare.` }
  if (st === 'folosit') {
    return { serie: grup.serie, nr: null, mesaj: `Numărul ${canonic} este deja folosit de o factură din platformă: verifică factura respectivă (poate trebuie doar legate SL-urile de ea). Numărul a rămas gol.` }
  }
  return { serie: grup.serie, nr: null, mesaj: `Nu am putut verifica dacă numărul ${canonic} e liber (eroare la citire): numărul a rămas gol. Reîncearcă sau completează-l după verificare.` }
}

// ===========================================================================
// Citirile pentru generarea liniilor din SL (factura grupată + „Regenerează linii”), review #1188 P1.
// O citire eșuată NU e valoare zero: orice `error` întors de Supabase, orice excepție, SL lipsă,
// valoare nenumerică sau listă posibil trunchiată OPREȘTE generarea cu EroareCitireSL (L18).
// Rândurile lipsă de contract / beneficiar rămân „fără contract” ca înainte (nu sunt erori).
// `client` = clientul Supabase (injectat ca să fie testabil).
// ===========================================================================
export class EroareCitireSL extends Error {
  constructor(mesaj, sl) {
    super(mesaj)
    this.name = 'EroareCitireSL'
    this.sl = sl || null
  }
}

export const etichetaSL = sl => (sl && sl.nr_situatie ? `SL ${sl.nr_situatie}` : `SL #${sl?.id ?? '?'}`)
const _motiv = e => String((e && (e.message || e.details || e.code)) || 'eroare necunoscută')
const PLAFON_RANDURI = 1000   // max-rows PostgREST: o listă care atinge plafonul poate fi trunchiată

async function _citeste(cerere, ce, sl) {
  const unde = sl ? ` pentru ${etichetaSL(sl)}` : ''
  let r
  try { r = await cerere() } catch (e) { throw new EroareCitireSL(`Nu am putut citi ${ce}${unde}: ${_motiv(e)}`, sl) }
  if (!r || r.error) throw new EroareCitireSL(`Nu am putut citi ${ce}${unde}: ${_motiv(r ? r.error : null)}`, sl)
  return r.data
}

async function _citesteLista(cerere, ce, sl) {
  const data = await _citeste(cerere, ce, sl)
  if (data === null || data === undefined) return []
  if (!Array.isArray(data)) throw new EroareCitireSL(`Nu am putut citi ${ce} pentru ${etichetaSL(sl)}: răspuns neașteptat`, sl)
  if (data.length >= PLAFON_RANDURI) throw new EroareCitireSL(`Prea multe rânduri la ${ce} pentru ${etichetaSL(sl)} (lista poate fi incompletă)`, sl)
  return data
}

const _numar = (v, ce, sl) => {
  const n = parseFloat(v || 0)
  if (!Number.isFinite(n)) throw new EroareCitireSL(`Valoare nenumerică la ${ce} pentru ${etichetaSL(sl)}`, sl)
  return n
}

// Contract + beneficiar pentru proiect (aceleași reguli ca vechiul loadContractBenef, cu erorile oprite)
export async function citesteContractBenef(client, proiectId) {
  let contractRef = '', contractDenumire = '', benef = null, termenPlata = null, contactContract = null
  let cid = null
  if (proiectId) {
    const pr = await _citeste(() => client.from('executie_proiecte').select('contract_id, nr_contract').eq('id', proiectId).maybeSingle(), 'proiectul (contractul legat)')
    if (pr) { cid = pr.contract_id; if (!contractRef) contractRef = pr.nr_contract || '' }
  }
  if (cid) {
    const ct = await _citeste(() => client.from('contracte_terti')
      .select('numar_contract, data_semnare, denumire, termen_plata_zile, beneficiar_id, contact_factura_nume, contact_factura_email, contact_factura_telefon').eq('id', cid).maybeSingle(), 'contractul proiectului')
    if (ct) {
      if (ct.numar_contract) {
        const dS = ct.data_semnare ? new Date(ct.data_semnare).toLocaleDateString('ro-RO') : ''
        contractRef = dS ? `${ct.numar_contract}/${dS}` : ct.numar_contract
      }
      contractDenumire = ct.denumire || ''
      termenPlata = ct.termen_plata_zile
      contactContract = { nume: ct.contact_factura_nume || '', email: ct.contact_factura_email || '', telefon: ct.contact_factura_telefon || '' }
      if (ct.beneficiar_id) {
        const b = await _citeste(() => client.from('beneficiari')
          .select('id,nume,cif,iban_principal,banca,sediu,contact_email,telefon,contact_nume,retine_gbe_pct,retine_car_pct').eq('id', ct.beneficiar_id).maybeSingle(), 'beneficiarul contractului')
        if (b) benef = b
      }
    }
  }
  return { contractRef, contractDenumire, benef, termenPlata, contactContract }
}

// Valorile unei SL (bază / ajustare / total + ajustări retroactive). SL lipsă = eroare, nu zero.
export async function citesteValoriSL(client, sl) {
  const slF = await _citeste(() => client.from('executie_situatii_plata')
    .select('valoare_baza_lei, valoare_ajustare_lei, valoare_ajustata_lei, coeficient_ajustare').eq('id', sl.id).maybeSingle(), 'valorile', sl)
  if (!slF) throw new EroareCitireSL(`Nu am găsit ${etichetaSL(sl)}: valorile ei nu pot fi citite`, sl)
  const valBaza   = _numar(slF.valoare_baza_lei, 'valoarea de bază', sl)
  const valAjust  = _numar(slF.valoare_ajustare_lei, 'ajustare', sl)
  const valTotal  = _numar(slF.valoare_ajustata_lei || slF.valoare_baza_lei, 'valoarea ajustată', sl)
  const coefAjust = _numar(slF.coeficient_ajustare, 'coeficientul de ajustare', sl)
  const ajustariRetro = await _citesteLista(() => client.from('executie_sl_ajustari')
    .select('sl_ajustata_nr, valoare_ajustare_lei, coeficient').eq('sl_id', sl.id).order('id', { ascending: true }), 'ajustările retroactive', sl)
  return { valBaza, valAjust, valTotal, coefAjust, ajustariRetro }
}

// Toate citirile pentru o listă de SL deja ordonată; prima eroare oprește tot (nimic parțial).
export async function citesteDateGenerareSL(client, proiectId, ordered) {
  const contractInfo = await citesteContractBenef(client, proiectId)
  const perSL = []
  for (const sl of ordered || []) {
    const slVals = await citesteValoriSL(client, sl)
    const objLinii = await _citesteLista(() => client.from('executie_situatii_plata_linii').select('*').eq('sl_id', sl.id).order('ord'), 'liniile pe obiect', sl)
    perSL.push({ sl, slVals, objLinii })
  }
  return { contractInfo, perSL }
}
