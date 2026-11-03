// Apelurile ecranului 📱 SMS: RPC-urile din 20261130a_sms_mvp + 20261130b_sms_acces_modul (nivelul owner / utilizator / test îl verifică BD-ul) + edge-ul sms-trimite.
// UI-ul nu vorbește niciodată cu furnizorul și nu scrie direct în tabele (n-are drept): schimbarea furnizorului nu atinge ecranele.
import { supabase } from '../lib/supabase.js'

const date = ({ data, error }) => { if (error) throw error; return data }

export const smsApi = {
  panou: async () => date(await supabase.rpc('fn_sms_panou')),
  angajati: async () => date(await supabase.rpc('fn_sms_angajati_lista')) || [],
  loturi: async () => date(await supabase.from('sms_v_loturi').select('*').order('creat_la', { ascending: false }).limit(50)) || [],
  mesaje: async lotId => date(await supabase.from('sms_mesaje').select('id, telefon, destinatar_tip, stare, cod_eroare, rezervat_la, trimis_la, livrat_la')
    .eq('lot_id', lotId).order('creat_la').order('id').limit(5000)) || [],
  optout: async () => date(await supabase.from('sms_optout').select('telefon, activ, motiv, actualizat_la').order('actualizat_la', { ascending: false })) || [],
  creeazaIntern: async ({ text, p_departamente, p_angajati, preview }) =>
    date(await supabase.rpc('fn_sms_lot_intern_creeaza', { p_text: text, p_departamente, p_angajati, p_doar_preview: preview })),
  creeazaRedari: async ({ text, proiectId, uatId, preview }) =>
    date(await supabase.rpc('fn_sms_lot_redari_creeaza', { p_text: text, p_proiect_id: proiectId, p_uat_id: uatId || null, p_doar_preview: preview })),
  // lista FIXATĂ în lot (nume + telefon mascat + text + segmente + cost + versiune), afișată înainte de aprobare
  destinatariLot: async lotId => date(await supabase.rpc('fn_sms_lot_destinatari', { p_lot_id: lotId })),
  aproba: async (lotId, versiune) => date(await supabase.rpc('fn_sms_lot_aproba', { p_lot_id: lotId, p_versiune: versiune })),
  anuleaza: async (lotId, motiv) => date(await supabase.rpc('fn_sms_lot_anuleaza', { p_lot_id: lotId, p_motiv: motiv || null })),
  salveazaSetari: async ({ killSwitch, plafonZi, plafonLuna, versiune }) =>
    date(await supabase.rpc('fn_sms_setari_salveaza', { p_kill_switch: killSwitch, p_plafon_zi: plafonZi, p_plafon_luna: plafonLuna, p_versiune: versiune })),
  autorizareRedari: async ({ autorizat, nr, data, versiune }) =>
    date(await supabase.rpc('fn_sms_redari_autorizare_seteaza', { p_autorizat: autorizat, p_nr: nr || null, p_data: data || null, p_versiune: versiune })),
  seteazaOptout: async (telefon, activ, motiv) => date(await supabase.rpc('fn_sms_optout_seteaza', { p_telefon: telefon, p_activ: activ, p_motiv: motiv || null })),
  // edge-ul verifică din nou nivelul (JWT + fn_sms_nivel cu JWT-ul contului); plafonul / kill-switch-ul / aprobarea / limita contului de test le verifică BD-ul
  trimite: async lotId => {
    const { data, error } = await supabase.functions.invoke('sms-trimite', { body: { lot_id: lotId } })
    if (error) throw error
    return data
  },
}

export const mesajEroare = e => e?.message || e?.details || e?.error_description || (typeof e === 'string' ? e : 'Eroare necunoscută')
