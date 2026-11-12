// Logistică / Transporturi — reguli pure folosite de lista din tab-ul Transporturi și de bannerul
// „Transporturi blocate” de pe Active (TKT-2026-0356). O singură definiție pentru „blocat” (L19).
// Datele sunt șiruri 'AAAA-LL-ZZ'; „azi” îl calculează apelantul în Europe/Bucharest (ziBucuresti).

// Statusuri „încă deschise”: transportul n-a plecat (aprobat / programat — „programat” e statusul
// vechi, afișat tot ca „aprobat”) sau a plecat și livrarea nu e confirmată (in_tranzit).
export const STATUS_NEPLECAT = ['aprobat', 'programat']
export const STATUS_DESCHIS = [...STATUS_NEPLECAT, 'in_tranzit']

// Valoarea specială a filtrului de status: exact transporturile din banner.
export const FILTRU_BLOCATE = 'blocate'

const ZI = /^\d{4}-\d{2}-\d{2}$/
const zi = v => (typeof v === 'string' && ZI.test(v.slice(0, 10)) ? v.slice(0, 10) : null)

// Ziua 'AAAA-LL-ZZ' deplasată cu n zile (calendaristic, fără fus orar).
export function adunaZile(ziua, n) {
  const z = zi(ziua)
  if (!z) return null
  const [y, m, d] = z.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

// Blocat = aprobat/programat cu data planificată trecută (n-a plecat), sau în tranzit cu data
// depășită cu cel puțin o zi (livrare neconfirmată). Fără dată = nu se poate spune → nu e blocat.
export function esteTransportBlocat(t, azi) {
  const data = zi(t?.data_transport), z = zi(azi)
  if (!data || !z) return false
  if (STATUS_NEPLECAT.includes(t.status)) return data < z
  if (t.status === 'in_tranzit') return data < adunaZile(z, -1)
  return false
}

// Intervalul filtrului de perioadă: { start, end } (end null = deschis); 'tot' = fără limite.
export function intervalPerioada(perioada, azi) {
  const z = zi(azi)
  if (!z || perioada === 'tot') return { start: null, end: null }
  if (perioada === 'azi') return { start: z, end: z }
  if (perioada === 'sapt') return { start: adunaZile(z, -7), end: null }
  if (perioada === 'luna') return { start: z.slice(0, 8) + '01', end: null }
  return { start: null, end: null }
}

// Un transport încă deschis, planificat ÎNAINTEA perioadei afișate sau FĂRĂ dată, rămâne în listă
// până pleacă / e livrat / e anulat: filtrul implicit „Luna” nu are voie să ascundă un transport
// aprobat vechi sau unul aprobat căruia nu i s-a pus data (r2, P2). Fără dată nu înseamnă „blocat”
// (esteTransportBlocat rămâne neschimbat), doar vizibil.
// Pentru 'tot' nu e nevoie (start null) — lista le are deja pe toate.
export function esteDeschisDinainte(t, start) {
  if (!start || !STATUS_DESCHIS.includes(t?.status)) return false
  const data = zi(t.data_transport)
  return t.data_transport == null || (!!data && data < start)
}

// Același criteriu, ca filtru client pentru o listă deja încărcată (paritate cu interogările).
export function inPerioadaSauDeschis(t, { start, end }) {
  if (!start && !end) return true
  const data = zi(t?.data_transport)
  if (data && (!start || data >= start) && (!end || data <= end)) return true
  return esteDeschisDinainte(t, start)
}

// Reunește rezultatele celor două interogări (perioada + deschise dinainte), fără dubluri pe id.
export function reunesteTransporturi(...liste) {
  const vazut = new Map()
  for (const lista of liste) for (const t of lista || []) if (t && !vazut.has(t.id)) vazut.set(t.id, t)
  return Array.from(vazut.values())
}

// Lista afișată: filtrul de status (inclusiv „blocate”) + ordinea.
// Aprobate / blocate: cele mai vechi sus (cele mai urgente); altfel cele mai recente sus.
export function filtreazaTransporturi(lista, statusFilter, azi) {
  let r = [...(lista || [])]
  if (statusFilter === FILTRU_BLOCATE) r = r.filter(t => esteTransportBlocat(t, azi))
  else if (statusFilter === 'aprobat') r = r.filter(t => STATUS_NEPLECAT.includes(t.status))
  else if (statusFilter !== 'Toate') r = r.filter(t => t.status === statusFilter)
  const urcator = statusFilter === 'aprobat' || statusFilter === 'programat' || statusFilter === FILTRU_BLOCATE
  // Transporturile fără dată stau la final în ambele ordini.
  r.sort((a, b) => {
    const da = a.data_transport || '', db = b.data_transport || ''
    if (!da !== !db) return da ? -1 : 1
    return urcator ? (da.localeCompare(db) || (a.id - b.id)) : (db.localeCompare(da) || (b.id - a.id))
  })
  return r
}

// ============================================================
// Citirea completă a listei (r2, P1 / L23): același contract ca citesteArhivaCompleta
// (src/lib/arhivaAlimentari.js) — numărare exactă pe prima pagină, keyset până la capăt,
// numărare finală, reîncercare de la zero la orice abatere, altfel EROARE (nu listă parțială).
// Diferența: cheia de paginare e doar `id` (unic, nu se schimbă), pentru că data_transport poate
// lipsi (aprobatele fără dată trebuie citite și ele). Ordinea afișată o pune filtreazaTransporturi.
// ============================================================

export const TRANSPORTURI_INSTABILE = 'transporturi_instabile'
export const PAGINA_TRANSPORTURI = 500

// Textele erorilor depind de ce se citește (helperul e folosit și pentru fișele de service, TKT-2026-0380 r3).
export const NUME_TRANSPORTURI = { pl: 'transporturi', plArt: 'transporturile', unul: 'un transport', art: 'transportul' }
const mare = t => t.charAt(0).toUpperCase() + t.slice(1)

const numarConfirmat = (count, nume = NUME_TRANSPORTURI) => {
  if (!Number.isInteger(count) || count < 0) throw new Error(`Serverul nu a confirmat numărul total de ${nume.pl}.`)
  return count
}

// O trecere: { rows, anomalie }. interogare(optiuni) = builder cu .select(..., optiuni) + filtre,
// FĂRĂ ordine / limită / cheie (le pune helperul). optiuni: { count: 'exact' } pe prima pagină,
// {} pe următoarele, { count: 'exact', head: true } la numărarea finală.
export async function citesteOTrecereDupaId(interogare, pagina = PAGINA_TRANSPORTURI, nume = NUME_TRANSPORTURI) {
  const rows = [], ids = new Set()
  let total = null, ultim = null
  while (true) {
    let q = interogare(total === null ? { count: 'exact' } : {})
    if (ultim !== null) q = q.gt('id', ultim)
    const { data, error, count } = await q.order('id', { ascending: true }).limit(pagina)
    if (error) throw error
    if (!Array.isArray(data)) throw new Error(`Serverul a întors un răspuns invalid pentru ${nume.pl}.`)
    if (total === null) total = numarConfirmat(count, nume)
    for (const row of data) {
      const id = row?.id
      if (!Number.isSafeInteger(id)) throw new Error(`Serverul a întors ${nume.unul} fără ID valid; lista nu poate fi paginată sigur.`)
      if (ultim !== null && !(id > ultim)) throw new Error(`Serverul a întors ${nume.plArt} în altă ordine decât cea cerută.`)
      if (ids.has(id)) return { rows, anomalie: `${nume.art} #${id} a apărut de două ori` }
      ids.add(id)
      rows.push(row)
      ultim = id
    }
    if (rows.length > total) return { rows, anomalie: `au apărut ${nume.pl} noi în timpul citirii (${rows.length} față de ${total})` }
    // Gata la pagina goală, sau la pagina scurtă care a atins totalul. O pagină scurtă sub total
    // poate fi plafonul de rânduri al serverului (sub `pagina`) → continui de la ultimul id.
    if (!data.length || (data.length < pagina && rows.length >= total)) break
  }
  const { error, count } = await interogare({ count: 'exact', head: true })
  if (error) throw error
  const final = numarConfirmat(count, nume)
  if (rows.length !== total || final !== total) {
    return { rows, anomalie: `numărul s-a modificat în timpul citirii (la început ${total}, citite ${rows.length}, la final ${final})` }
  }
  return { rows, anomalie: null }
}

export async function citesteCompletDupaId(interogare, { pagina = PAGINA_TRANSPORTURI, incercari = 3, nume = NUME_TRANSPORTURI } = {}) {
  let anomalie = null
  for (let i = 0; i < incercari; i++) {
    const r = await citesteOTrecereDupaId(interogare, pagina, nume)
    if (!r.anomalie) return r.rows
    anomalie = r.anomalie
  }
  const e = new Error(`${mare(nume.plArt)} s-au modificat în timpul încărcării la ${incercari} încercări consecutive (ultima: ${anomalie}). Reîncercați peste câteva momente.`)
  e.code = TRANSPORTURI_INSTABILE
  throw e
}

// Filtrele celor (cel mult) trei citiri ale listei, ca funcții q => q (fără select / ordine):
//  - 'perioada': transporturile din perioadă (la 'tot': toate, inclusiv cele fără dată);
//  - 'deschise_dinainte': aprobat / programat / în tranzit planificate înainte de început;
//  - 'deschise_fara_data': aceleași statusuri, fără dată (filtrul de perioadă nu le prinde).
// „Doar ale mele” se aplică pe fiecare. Citiri separate, reunite pe id (fără .or() combinat).
export function filtreTransporturi({ perioada, azi, meleId = null }) {
  const { start, end } = intervalPerioada(perioada, azi)
  const mele = q => meleId
    ? q.or(`solicitant_id.eq.${meleId},manager_destinatie_id.eq.${meleId},manager_plecare_id.eq.${meleId}`)
    : q
  const filtre = [{
    nume: 'perioada',
    aplica: q => { if (start) q = q.gte('data_transport', start); if (end) q = q.lte('data_transport', end); return mele(q) },
  }]
  if (start) {
    filtre.push({ nume: 'deschise_dinainte', aplica: q => mele(q.in('status', STATUS_DESCHIS).lt('data_transport', start)) })
    filtre.push({ nume: 'deschise_fara_data', aplica: q => mele(q.in('status', STATUS_DESCHIS).is('data_transport', null)) })
  }
  return { start, end, filtre }
}

// Încarcă TOATĂ lista pentru perioadă (orice eroare / instabilitate = excepție; apelantul nu
// publică nimic parțial). tabel() = supabase.from('logistica_transporturi'); select = coloanele.
export async function incarcaTransporturi(tabel, { select, perioada, azi, meleId = null, pagina = PAGINA_TRANSPORTURI, incercari = 3 }) {
  const { filtre } = filtreTransporturi({ perioada, azi, meleId })
  const rezultate = await Promise.all(filtre.map(f => citesteCompletDupaId(
    optiuni => f.aplica(tabel().select(optiuni.head ? 'id' : select, optiuni)),
    { pagina, incercari },
  )))
  // Filtrul e pus de server; nu mai refiltrez în client (un rând aruncat aici ar dispărea tacit, L12).
  return reunesteTransporturi(...rezultate)
}
