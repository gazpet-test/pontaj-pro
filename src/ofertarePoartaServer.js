// Citirea serverului nu înlocuiește controalele locale în J07.
export async function citestePoartaServer(client, licitatieId, { recalculeazaText = false } = {}) {
  try {
    if (recalculeazaText) {
      const r = await client.functions.invoke('ofertare-poarta-text', { body: { licitatie_id: licitatieId } })
      if (r.error || r.data?.error) return { poarta_server: null, poarta_server_eroare: r.data?.error || r.error?.message || 'Calcul text indisponibil' }
    }
    const { data, error } = await client.rpc('ofertare_poarta_server', { p_licitatie_id: licitatieId })
    return { poarta_server: error ? null : data, poarta_server_eroare: error?.message || null }
  } catch (error) {
    return { poarta_server: null, poarta_server_eroare: error?.message || 'Server indisponibil' }
  }
}

export function randPoartaServer(st) {
  const s = st.poarta_server
  const coduri = ['cuprins', 'neverificate', 'capcane', 'goale', 'nescrise', 'cantitati_f3_grafic',
    'garantie', 'anexe', 'numere', 'pachet', 'grafic_relatii', 'grafic_sursa']
  const valid = s && ['ok', 'block'].includes(s.stare) && Array.isArray(s.controale) && s.controale.length === 12
    && coduri.every(k => s.controale.filter(c => c.control_code === k).length === 1)
    && s.controale.every(c => ['ok', 'block', 'undetermined'].includes(c.stare)) && Array.isArray(s.blocaje)
  const blocaje = valid ? s.controale.filter(c => c.stare !== 'ok').map(c => c.control_code) : []
  return { k: 'server', titlu: 'Poarta verificată pe server',
    stare: !valid || s.stare !== 'ok' || blocaje.length || s.blocaje.length ? 'block' : 'ok',
    detalii: !valid ? `Nu putem verifica poarta pe server${st.poarta_server_eroare ? ': ' + st.poarta_server_eroare : ''}`
      : blocaje.length ? `Controale blocante: ${blocaje.join(', ')}` : s.stare !== 'ok' || s.blocaje.length ? `Serverul blochează: ${s.blocaje.join(', ')}` : 'Controalele J07 au trecut; identitatea lucrării așteaptă decizia de business',
  }
}
