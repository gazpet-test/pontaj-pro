import { supabase } from './lib/supabase.js'

// Lista inchisa: coloanele noi nu devin citibile automat.
export const EMPLOYEES_PUBLIC_COLUMNS = 'id,name,department,position,active,created_at,site_id,hire_date,termination_date,functii_extra,functie,departament_hr,rol_in_firma,are_autorizatii,cetatenie,tip_contract,procent_ocupare,co_maxim_zile,cetatenie_secundara,protejat_la_stergere,cod_cor,functie_cim,colaborare_externa_status,colaborare_externa_confirmat_de,colaborare_externa_confirmat_la,colaborare_externa_nota,colaborare_externa_document'

// Lipsa proprietatii inseamna necitit; null citit ramane editabil.
export function employeeFieldRead(source, key) {
  return source != null && Object.prototype.hasOwnProperty.call(source, key) && source[key] !== undefined
}

// Paritate cu predicatul server pentru scrierea marimilor EIP.
export function employeeMarimiCanWrite(profile, access) {
  return profile?.is_owner === true || profile?.can_access_personal_data === true ||
    (access?.module === 'magazie' && ['editor', 'admin'].includes(access.access_level))
}

// Sursa este randul citit, nu formularul care poate initializa campuri cu ''.
export function employeePersonalWrite(source, values) {
  return Object.fromEntries(Object.entries(values).filter(([key]) =>
    employeeFieldRead(source, key)))
}

// Pastreaza filtrele query-ului de baza. Dreptul este reverificat in RPC.
// onError este obligatoriu: o eroare nu devine lista goala sau camp lipsa.
export async function withEmployeePersonal(query, columns, onError, required = false) {
  try {
    const result = await query
    if (result.error) throw result.error
    const rows = Array.isArray(result.data) ? result.data : result.data ? [result.data] : []
    if (!rows.length) return result
    const { data: userData, error: userError } = await supabase.auth.getUser()
    if (userError) throw userError
    if (!userData?.user) throw new Error('Sesiune expirata')
    const { data: profile, error: profileError } = await supabase.from('profiles')
      .select('is_owner,can_access_personal_data').eq('id', userData.user.id).single()
    if (profileError) throw profileError
    if (profile.is_owner !== true && profile.can_access_personal_data !== true) {
      if (required) throw new Error('Acces personal necesar')
      return result
    }
    return await mergeEmployeeRpc(result, columns, 'fn_employees_personal', userData.user.id)
  } catch (error) {
    onError('Nu pot incarca datele angajatilor. Reincarca ecranul.', 'error')
    // Nu permite apelantilor legacy sa continue un export/formular cu date partiale.
    throw error
  }
}

// Cele doua RPC-uri folosesc aceeasi paginare si aceeasi verificare de sesiune.
async function mergeEmployeeRpc(result, columns, rpcName, userId) {
    const rows = Array.isArray(result.data) ? result.data : result.data ? [result.data] : []
    const personal = new Map()
    const ids = [...new Set(rows.map(row => row.id))]
    for (let offset = 0; offset < ids.length; offset += 100) {
      const chunk = ids.slice(offset, offset + 100)
      // Pana la pagina goala, inclusiv daca max-rows este mai mic decat pagina.
      let last = null
      while (true) {
        let request = supabase.rpc(rpcName, { p_ids: chunk })
          .select(`id,${columns}`).order('id').limit(100)
        if (last !== null) request = request.gt('id', last)
        const { data, error } = await request
        if (error) throw error
        if (!Array.isArray(data)) throw new Error('Raspuns personal invalid')
        if (!data.length) break
        for (const row of data) personal.set(row.id, row)
        const next = data[data.length - 1].id
        if (last !== null && next <= last) throw new Error('Paginare personala invalida')
        last = next
      }
    }
    if (personal.size !== ids.length) throw new Error('Date personale incomplete; reincarca lista')
    const { data: sessionData } = await supabase.auth.getSession()
    if (sessionData?.session?.user?.id !== userId) throw new Error('Sesiune schimbata')
    const merged = rows.map(row => ({ ...row, ...personal.get(row.id) }))
    return { ...result, data: Array.isArray(result.data) ? merged : merged[0] }
}

// Exceptia EIP este autorizata numai pe server; nu cere drept personal in client.
export async function withEmployeeMarimi(query, onError) {
  const result = await query
  if (result.error) throw result.error
  if (!result.data?.length) return result
  try {
    const { data, error } = await supabase.auth.getUser()
    if (error) throw error
    if (!data?.user) throw new Error('Sesiune expirata')
    return await mergeEmployeeRpc(result, 'marime_incaltaminte,marime_imbracaminte', 'fn_employees_marimi', data.user.id)
  } catch {
    onError('Marimile EIP nu pot fi incarcate. Ecranul continua fara marimi; verifica accesul Magazie sau reincarca.')
    return result
  }
}
