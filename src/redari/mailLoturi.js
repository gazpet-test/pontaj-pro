export * from '../../supabase/functions/_shared/redariMailF2.mjs'

export const MOTIVE_MAIL = Object.freeze({ fara_email: 'Fără e-mail valid', opt_out: 'Opt-out', canal_postal: 'Canal poștal, fără e-mail valid', deja_rezervat_trimis: 'Deja rezervat / trimis' })
// Motivele vin din RPC; un rând poate avea mai multe motive, dar se numără o singură dată la excluși.
export function inventarMail(randuri) {
  const motive = Object.fromEntries(Object.keys(MOTIVE_MAIL).map(k => [k, 0]))
  let eligibili = 0
  for (const r of randuri) {
    if (!Array.isArray(r.motive) || r.motive.some(m => !Object.hasOwn(MOTIVE_MAIL, m)) || new Set(r.motive).size !== r.motive.length) throw new Error('Inventarul destinatarilor este invalid. Recitește.')
    if (!r.motive.length) eligibili++
    for (const m of r.motive) motive[m]++
  }
  return { total: randuri.length, eligibili, exclusi: randuri.length - eligibili, motive }
}

// Cheia intenției se păstrează de apelant inclusiv după timeout; serverul verifică hash-ul cererii.
export async function rpcMail(client, nume, argumente) {
  const { data, error } = await client.rpc(nume, argumente)
  if (error) throw new Error('Operația e-mail nu a fost confirmată. Recitește lotul și reia aceeași intenție.')
  return data
}
// L23: keyset până la pagina goală, chiar dacă serverul reduce max-rows.
export async function citesteMail(client, tabela, filtre, curent = () => true) {
  const toate = []
  let dupa = null
  for (;;) {
    if (!curent()) throw new Error('citire_abandonata')
    let q = client.from(tabela).select('*').order('id').limit(300)
    for (const [k, v] of Object.entries(filtre)) q = q.eq(k, v)
    if (dupa) q = q.gt('id', dupa)
    const { data, error } = await q
    if (!curent()) throw new Error('citire_abandonata')
    if (error || !Array.isArray(data)) throw new Error('Citirea e-mailurilor a eșuat.')
    if (!data.length) return toate
    if (data.some((r, i) => !r.id || (i ? r.id <= data[i - 1].id : dupa && r.id <= dupa))) throw new Error('Paginarea nu avansează.')
    toate.push(...data); dupa = data[data.length - 1].id
  }
}
