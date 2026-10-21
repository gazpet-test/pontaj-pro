// Ordinea interogării trebuie să fie stabilă și unică (inclusiv id).
// count exact detectează inclusiv un plafon server mai mic decât pagina cerută.
export async function citesteArhivaCompleta(createQuery) {
  const rows = [], ids = new Set()
  let total = null
  while (true) {
    const { data, error, count } = await createQuery().range(rows.length, rows.length + 499)
    if (error) throw error
    if (!Array.isArray(data) || !Number.isInteger(count) || count < 0) {
      throw new Error('Serverul nu a confirmat numărul total de înregistrări.')
    }
    if (total === null) total = count
    if (count !== total) throw new Error('Datele s-au schimbat în timpul încărcării. Reîncercați.')
    for (const row of data) {
      if (row.id == null || ids.has(String(row.id))) {
        throw new Error('Paginarea a întors înregistrări fără ID sau duplicate. Reîncercați.')
      }
      ids.add(String(row.id))
      rows.push(row)
    }
    if (rows.length === total) return rows
    if (!data.length || rows.length > total) {
      throw new Error(`Încărcare incompletă: ${rows.length} din ${total} înregistrări.`)
    }
    // Continuăm și după o pagină scurtă: max-rows poate fi sub 500.
  }
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
