// ============================================================
// Citirea arhivei de alimentări (TKT-2026-0339) — contract:
// citire completă CU VERIFICARE, nu snapshot tranzacțional.
//
// Paginare keyset pe (data_alimentare desc, id desc): fiecare pagină continuă strict după
// ultima cheie citită (data < ultima, sau aceeași zi și id < ultimul), deci ștergerile și
// inserările din altă parte a listei nu mai decalează paginile. Un rând care există pe toată
// durata citirii și nu își schimbă data apare exact o dată.
// Verificări (orice abatere = reîncercare completă, de max. `incercari` ori):
//   - numărul de pe prima pagină (count exact) = rândurile adunate = o numărare finală
//     (head, count exact) cu aceleași filtre;
//   - niciun ID repetat (o alimentare a cărei dată s-a schimbat în timpul citirii).
// După reîncercări epuizate: eroare cu code = ARHIVA_INSTABILA (UI-ul nu publică nimic).
// NU se detectează: modificări compensate în zona deja citită (o ștergere + o inserare în timpul
// citirii, cu totalul neschimbat) și editări ale rândurilor existente între pagini. Pentru un
// snapshot exact e nevoie de un RPC server-side (schimbare de schemă, decizie separată).
// ============================================================

export const ARHIVA_INSTABILA = 'arhiva_instabila'
export const PAGINA_ARHIVA = 500

const COL_DATA = 'data_alimentare', COL_ID = 'id'
const ZI_ISO = /^\d{4}-\d{2}-\d{2}$/

// Cheia de paginare a unui rând; refuz valori care n-ar fi sigure în filtrul PostgREST.
function cheie(row) {
  const data = row?.[COL_DATA], id = row?.[COL_ID]
  if (typeof data !== 'string' || !ZI_ISO.test(data) || !Number.isSafeInteger(id)) {
    throw new Error('Serverul a întors o alimentare fără dată sau ID valid; arhiva nu poate fi paginată sigur.')
  }
  return { data, id }
}
const dupa = (a, b) => a.data < b.data || (a.data === b.data && a.id < b.id) // a vine după b în ordinea desc

export const filtruDupa = ultim =>
  `${COL_DATA}.lt.${ultim.data},and(${COL_DATA}.eq.${ultim.data},${COL_ID}.lt.${ultim.id})`

const numarConfirmat = count => {
  if (!Number.isInteger(count) || count < 0) throw new Error('Serverul nu a confirmat numărul total de înregistrări.')
  return count
}

// O singură trecere. Întoarce { rows, anomalie } — anomalie = text dacă datele s-au mișcat.
// Erorile de server / răspuns invalid se aruncă (nu se reîncearcă).
// interogare(optiuniSelect) → builder cu .select(coloane, optiuniSelect) + filtrele perioadei,
// FĂRĂ ordine și limită (le pune helperul). optiuniSelect: { count: 'exact' } pe prima pagină,
// {} pe următoarele, { count: 'exact', head: true } la numărarea finală.
export async function citesteOTrecere(interogare, pagina = PAGINA_ARHIVA) {
  const rows = [], ids = new Set()
  let total = null, ultim = null
  while (true) {
    let q = interogare(total === null ? { count: 'exact' } : {})
    if (ultim) q = q.or(filtruDupa(ultim))
    const { data, error, count } = await q
      .order(COL_DATA, { ascending: false })
      .order(COL_ID, { ascending: false })
      .limit(pagina)
    if (error) throw error
    if (!Array.isArray(data)) throw new Error('Serverul a întors un răspuns invalid pentru arhivă.')
    if (total === null) total = numarConfirmat(count)
    for (const row of data) {
      const k = cheie(row)
      if (ultim && !dupa(k, ultim)) throw new Error('Serverul a întors alimentările în altă ordine decât cea cerută.')
      if (ids.has(k.id)) return { rows, anomalie: `alimentarea #${k.id} a apărut de două ori (data ei s-a modificat în timpul citirii)` }
      ids.add(k.id)
      rows.push(row)
      ultim = k
    }
    if (rows.length > total) return { rows, anomalie: `au apărut alimentări noi în timpul citirii (${rows.length} față de ${total})` }
    // Gata la pagina goală, sau la pagina scurtă care a atins totalul. O pagină scurtă sub total
    // poate fi plafonul max-rows al serverului (sub `pagina`) → continui de la ultima cheie.
    if (!data.length || (data.length < pagina && rows.length >= total)) break
  }
  const { error, count } = await interogare({ count: 'exact', head: true })
  if (error) throw error
  const final = numarConfirmat(count)
  if (rows.length !== total || final !== total) {
    return { rows, anomalie: `numărul s-a modificat în timpul citirii (la început ${total}, citite ${rows.length}, la final ${final})` }
  }
  return { rows, anomalie: null }
}

// Citire completă cu verificare; reîncearcă de la zero la orice abatere detectabilă.
export async function citesteArhivaCompleta(interogare, { pagina = PAGINA_ARHIVA, incercari = 3 } = {}) {
  let anomalie = null
  for (let i = 0; i < incercari; i++) {
    const r = await citesteOTrecere(interogare, pagina)
    if (!r.anomalie) return r.rows
    anomalie = r.anomalie
  }
  const e = new Error(`Datele s-au modificat în timpul încărcării la ${incercari} încercări consecutive (ultima: ${anomalie}). Reîncercați peste câteva momente.`)
  e.code = ARHIVA_INSTABILA
  throw e
}

// Numele angajaților sunt AUXILIARE (afișare în filtrul de proprietar): o eroare aici nu
// invalidează arhiva — întoarce un avertisment, iar proprietarii apar ca „Angajat #id”.
export async function incarcaNumeAngajati(interogare) {
  try {
    const { data, error, count } = await interogare()
    if (error) throw error
    if (!Array.isArray(data)) throw new Error('răspuns invalid')
    const nume = new Map(data.filter(e => e?.id != null && e.name).map(e => [String(e.id), e.name]))
    const partial = Number.isInteger(count) && count > data.length
    return { nume, avertisment: partial ? `S-au încărcat doar ${data.length} din ${count} nume de angajați; restul apar ca „Angajat #id”.` : '' }
  } catch (e) {
    return { nume: new Map(), avertisment: `Numele angajaților nu s-au putut încărca (${e?.message || e}); proprietarii apar ca „Angajat #id”.` }
  }
}

export const numeAngajat = (nume, id) => nume.get(String(id)) || `Angajat #${id}`

// Proprietarii (contract curent) întâlniți în arhivă, sortați după nume.
export function proprietariDisponibili(arhiva, nume) {
  const ids = new Set(arhiva.map(proprietarComodatId).filter(id => id !== null))
  return Array.from(ids).map(id => ({ id, name: numeAngajat(nume, id) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ro') || a.id.localeCompare(b.id))
}

// Valoarea specială a filtrului: alimentări pe vehicule în comodat care NU cad în contractul curent.
export const COMODAT_NEATRIBUIT = 'neatribuit'

const zi = v => {
  const s = v == null ? '' : String(v).slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}

// Proprietarul comodat al alimentării, după CONTRACTUL CURENT din fișa activului
// (comodat_employee_id + comodat_data_start..comodat_data_sfarsit). Fișa nu păstrează
// proprietarii anteriori, deci o alimentare din afara perioadei contractului curent
// (sau pe un contract fără dată de start) rămâne neatribuită — nu o creditez proprietarului
// de azi. Aceeași regulă ca status_in_luna din v_audit_motorina_comodat, dar pe zi.
// Datele sunt 'YYYY-MM-DD' (coloane date), comparate ca șiruri ISO.
export function proprietarComodatId(alimentare) {
  const activ = alimentare?.logistica_active
  if (activ?.tip_proprietate !== 'comodat' || activ.comodat_employee_id == null) return null
  const data = zi(alimentare.data_alimentare), start = zi(activ.comodat_data_start)
  if (!data || !start || data < start) return null
  const sfarsit = zi(activ.comodat_data_sfarsit)
  if (activ.comodat_data_sfarsit != null && !sfarsit) return null
  if (sfarsit && data > sfarsit) return null
  return String(activ.comodat_employee_id)
}

// Vehicul în comodat, dar alimentarea nu se poate atribui contractului curent.
export function esteComodatNeatribuit(alimentare) {
  return alimentare?.logistica_active?.tip_proprietate === 'comodat' && proprietarComodatId(alimentare) === null
}
