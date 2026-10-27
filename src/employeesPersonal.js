import { supabase } from './lib/supabase.js'

// Lista inchisa: coloanele noi nu devin citibile automat.
export const EMPLOYEES_PUBLIC_COLUMNS = 'id,name,department,position,active,created_at,site_id,hire_date,termination_date,functii_extra,functie,departament_hr,rol_in_firma,are_autorizatii,cetatenie,tip_contract,procent_ocupare,co_maxim_zile,cetatenie_secundara,protejat_la_stergere,cod_cor,functie_cim,colaborare_externa_status,colaborare_externa_confirmat_de,colaborare_externa_confirmat_la,colaborare_externa_nota,colaborare_externa_document'

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
    const personal = new Map()
    const ids = [...new Set(rows.map(row => row.id))]
    for (let offset = 0; offset < ids.length; offset += 100) {
      const chunk = ids.slice(offset, offset + 100)
      // Pana la pagina goala, inclusiv daca max-rows este mai mic decat pagina.
      let last = null
      while (true) {
        let request = supabase.rpc('fn_employees_personal', { p_ids: chunk })
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
    if (sessionData?.session?.user?.id !== userData.user.id) throw new Error('Sesiune schimbata')
    const merged = rows.map(row => ({ ...row, ...personal.get(row.id) }))
    return { ...result, data: Array.isArray(result.data) ? merged : merged[0] }
  } catch (error) {
    onError('Nu pot incarca datele angajatilor. Reincarca ecranul.', 'error')
    // Nu permite apelantilor legacy sa continue un export/formular cu date partiale.
    throw error
  }
}
