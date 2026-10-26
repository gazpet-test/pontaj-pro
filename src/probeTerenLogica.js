// Contract UI E2b. Ora operatiilor este stabilita exclusiv de server.
export const FAZE = { aer: ['pistonare', 'uscare', 'calibrare', 'proba'], apa: ['umplere', 'presurizare'] }
export const ERORI = {
  pt_acces: 'Nu ai drept de scriere Probe presiune.',
  pt_actiune: 'Actiune nepermisa.', pt_beneficiar: 'Verifica beneficiarul, clientul si referinta.',
  pt_bord: 'Introdu ore de bord valide.', pt_bord_salt: 'Saltul de ore este mare. Confirma cu motiv.',
  pt_bord_scade: 'Orele de bord nu pot scadea.', pt_cheie: 'Lipseste cheia operatiei.',
  pt_cheie_conflict: 'Operatia are deja alt continut. Reincarca proba inainte de alta actiune.',
  pt_citire_devreme: 'Citirea se poate trimite dupa minimum 6 ore.', pt_date: 'Verifica valorile introduse.',
  pt_faza_admis: 'Admis este permis numai din faza proba.',
  pt_faza_legacy: 'Proba veche fara faze. Foloseste ecranul existent.',
  pt_faza_tip: 'Tipul probei nu corespunde fazei.', pt_faza_tranzitie: 'Poti trece numai la faza urmatoare.',
  pt_faza_utilaj: 'Intervalul utilajului nu corespunde fazei.',
  pt_hidraulic_citiri: 'Lipseste citirea de inceput sau cea de la jumatate, cu poza.',
  pt_hidraulic_faza: 'Citirea hidraulica se face numai in presurizare.',
  pt_hidraulic_motiv: 'Scrie motivul respingerii.', pt_hidraulic_numar: 'Citirea de la jumatate exista deja.',
  pt_hidraulic_poza: 'Adauga poza manometrului.', pt_hidraulic_utilaje: 'Lista contine pompe care nu sunt active.',
  pt_inchidere: 'Utilajele trebuie inchise cu dovezile complete.', pt_inlocuitor: 'Inlocuitor invalid sau ocupat.',
  pt_motiv: 'Alege motivul opririi si explica daca ai ales Altul.', pt_oferta_calc: 'Oferta nu corespunde calculului.',
  pt_poza: 'Poza lipseste sau nu apartine acestei probe.', pt_poza_reutilizata: 'Aceasta poza a fost folosita deja. Fa alta poza.',
  pt_presiune: 'Introdu o presiune valida, minimum zero.', pt_proba: 'Proba nu mai exista.',
  pt_proiect: 'Alege lucrarea.', pt_rezultat: 'Alege Admis sau Respins.', pt_rol: 'Alege rolul utilajului.',
  pt_rpc: 'Scriere permisa numai prin functiile probei.', pt_status: 'Starea probei s-a schimbat. Reincarca.',
  pt_timp: 'Ora serverului s-a schimbat. Reincearca.', pt_tronson: 'Alege un tronson al lucrarii.',
  pt_utilaj: 'Utilajul nu mai este activ in proba.', pt_utilaj_ocupat: 'Utilajul lucreaza deja la alta proba.',
  pt_utilaje: 'Verifica lista completa a utilajelor active, fara duplicate.',
  pt_schema: 'Etapa 2a necesita verificare de catre administrator.',
  pt_preflight: 'Schema necesita verificare de catre administrator.',
  pt_garda: 'Operatie indisponibila.', pt_izolare: 'Operatie indisponibila.',
}
export const codEroare = e => String(e?.message || e || '').match(/\bpt_[a-z_]+\b/)?.[0]
export function mesajEroare(e) {
  const cod = codEroare(e)
  if (cod) return ERORI[cod] || 'Serverul a refuzat operatia. Cere verificarea probei.'
  if (!e?.code || /fetch|network|timeout/i.test(e?.message || '')) return 'Nu s-a trimis, reincerc'
  if (['PGRST202', 'PGRST204', '42703', '42P01'].includes(e.code)) return ERORI.pt_schema
  return 'Nu s-a putut incarca sau salva. Reincearca.'
}
export function fazaUrmatoare(proba) {
  const faze = FAZE[proba.tip_fluid] || []
  return faze[faze.indexOf(proba.faza_curenta) + 1] || null
}
export function programCitire(proba, citiri, acum = Date.now()) {
  const pres = citiri.filter(c => c.faza === proba.faza_curenta && c.presiune_citita_bar != null)
    .sort((a, b) => Date.parse(a.ora_citire) - Date.parse(b.ora_citire))
  const ultima = pres.at(-1)
  if (proba.tip_fluid === 'apa') {
    const inceput = pres.find(c => c.limita_faza)
    const intermediara = pres.some(c => !c.limita_faza)
    const urmatoarea = proba.faza_curenta === 'presurizare' && inceput && !intermediara
      ? Date.parse(inceput.ora_citire) + 3 * 3600000 : null
    return { numar: pres.length, urmatoarea, intarziata: false, ramaseMs: urmatoarea == null ? null : urmatoarea - acum }
  }
  const baza = ultima && Date.parse(ultima.ora_citire)
  const urmatoarea = proba.faza_curenta === 'proba' && Number.isFinite(baza) ? baza + 6 * 3600000 : null
  return { numar: pres.length, urmatoarea, intarziata: urmatoarea != null && acum - baza > 8 * 3600000,
    ramaseMs: urmatoarea == null ? null : urmatoarea - acum }
}
export function cereManometru(proba, actiune, rezultat) {
  return actiune !== 'opreste_utilaj' && !(proba.tip_fluid === 'apa' &&
    (actiune === 'porneste' || (actiune === 'inchide' && proba.faza_curenta === 'umplere' && rezultat === 'respins')))
}
const numar = x => x !== '' && x != null && Number.isFinite(Number(x)) && Number(x) >= 0
export function ceLipseste({ proba, actiune, presiune, poza, utilaje = [], rezultat, observatii = '', motiv, inlocuitor }) {
  const lipsuri = []
  if (cereManometru(proba, actiune, rezultat)) {
    if (!numar(presiune)) lipsuri.push('Presiune valida')
    if (!poza) lipsuri.push('Poza manometru')
  }
  if (actiune === 'inchide') {
    if (!['admis', 'respins'].includes(rezultat)) lipsuri.push('Rezultat')
    if (rezultat === 'respins' && !observatii.trim()) lipsuri.push('Motiv respingere')
    if (rezultat === 'admis' && proba.faza_curenta !== (proba.tip_fluid === 'apa' ? 'presurizare' : 'proba')) lipsuri.push('Faza finala')
  }
  if (actiune === 'porneste' && proba.tip_fluid === 'aer' && !utilaje.length) lipsuri.push('Cel putin un utilaj')
  if (actiune === 'opreste_utilaj' && (!motiv || (motiv === 'altul' && !observatii.trim()))) lipsuri.push('Motiv oprire')
  if (actiune === 'opreste_utilaj' && utilaje.length !== 1) lipsuri.push('Alege un singur utilaj de oprit')
  const lista = [...utilaje, ...(inlocuitor ? [inlocuitor] : [])]
  if (new Set(lista.map(u => String(u.active_id))).size !== lista.length) lipsuri.push('Utilaje duplicate')
  for (const u of lista) {
    if (!u.active_id) lipsuri.push('Alege utilajul')
    if ((actiune === 'porneste' || u === inlocuitor) && proba.tip_fluid === 'aer' && !['compresor', 'booster', 'pompa'].includes(u.rol)) lipsuri.push('Rol utilaj')
    if (proba.tip_fluid === 'aer') {
      if (!numar(u.ore_bord)) lipsuri.push('Ore bord utilaj')
      if (!u.poza_path) lipsuri.push('Poza ceas utilaj')
    }
    if (u.confirma_salt && !u.motiv_salt?.trim()) lipsuri.push('Motiv salt ore')
  }
  return [...new Set(lipsuri)]
}
export const RPC_SCRIERI = ['fn_probe_creeaza_teren', 'fn_probe_porneste', 'fn_probe_citire', 'fn_probe_schimba_faza', 'fn_probe_opreste_utilaj', 'fn_probe_inchide']
export function operatieValida(op) {
  return !!(op && RPC_SCRIERI.includes(op.nom) && op.args && typeof op.args.p_cheie === 'string' && op.args.p_cheie.length > 0)
}
export function formularActiune(proba, actiune, rezultat, active = []) {
  return { proba, actiune, rezultat, presiune: '', poza: '', observatii: '', motiv: 'terminat',
    utilaje: (actiune === 'porneste' ? [] : active).map(u => ({ ...u, ore_bord: '', poza_path: '' })), inlocuitor: null }
}
export function pregatesteCreare({ proiect, tronson, nrTronsoane, fluid, beneficiar, referintaTip, referintaId, comanda = '', client = '' }, cheie) {
  if (!proiect || !FAZE[fluid]) throw new Error('Alege lucrarea si tipul probei.')
  if (nrTronsoane > 1 && !tronson) throw new Error('Alege tronsonul.')
  if (!['gazpet', 'tert'].includes(beneficiar)) throw new Error('Alege beneficiarul.')
  const tert = beneficiar === 'tert'
  if (tert && (!client.trim() || !['oferta', 'contract', 'comanda'].includes(referintaTip) ||
    (referintaTip === 'comanda' ? comanda.trim().length < 3 : !referintaId))) throw new Error('Completeaza clientul si referinta tertului.')
  return { nom: 'fn_probe_creeaza_teren', args: { p_proiect_id: Number(proiect), p_tronson_id: tronson ? Number(tronson) : null,
    p_tip_fluid: fluid, p_beneficiar_tip: beneficiar, p_tert_ref_tip: tert ? referintaTip : null,
    p_tert_ref_id: tert && referintaTip !== 'comanda' ? Number(referintaId) : null,
    p_tert_ref_text: tert && referintaTip === 'comanda' ? comanda.trim() : null,
    p_tert_client: tert ? client.trim() : null, p_cheie: cheie } }
}
export function utilajPayload(u, fluid) {
  const p = { active_id: Number(u.active_id), rol: fluid === 'apa' ? 'pompa' : u.rol,
    ore_bord: fluid === 'apa' ? null : Number(u.ore_bord), poza_path: fluid === 'apa' ? null : u.poza_path }
  if (u.confirma_salt) { p.confirma_salt = true; p.motiv_salt = u.motiv_salt.trim() }
  return p
}
export function pregatestePayload(f, cheie) {
  const lipsuri = ceLipseste(f)
  if (lipsuri.length) throw new Error(lipsuri.join(', '))
  const { proba: p, actiune: a } = f
  const utilaje = f.utilaje.map(u => utilajPayload(u, p.tip_fluid))
  const manometru = cereManometru(p, a, f.rezultat)
  const args = { p_calc_id: p.id, p_cheie: cheie }
  if (a === 'opreste_utilaj') {
    const u = utilaje[0]
    return { nom: 'fn_probe_opreste_utilaj', args: { ...args, p_active_id: u.active_id,
      p_ore_bord: u.ore_bord, p_poza: u.poza_path, p_motiv: f.motiv, p_observatii: f.observatii || null,
      p_inlocuitor: f.inlocuitor ? utilajPayload(f.inlocuitor, p.tip_fluid) : null,
      p_confirma_salt: !!u.confirma_salt, p_motiv_salt: u.motiv_salt || null } }
  }
  Object.assign(args, { p_utilaje: utilaje, p_poza_manometru: manometru ? f.poza : null,
    [a === 'inchide' ? 'p_presiune_finala_bar' : 'p_presiune_bar']: manometru ? Number(f.presiune) : null })
  if (a !== 'porneste') args.p_observatii = f.observatii || null
  if (a === 'citire' || a === 'schimba_faza') Object.assign(args, { p_confirma_salt: false, p_motiv_salt: null })
  if (a === 'inchide') args.p_rezultat = f.rezultat
  if (a === 'schimba_faza') args.p_faza_noua = fazaUrmatoare(p)
  return { nom: `fn_probe_${a}`, args }
}
// Confirmarea dupa refuz nu are operatie comisa. Pastram cheia si toate dovezile.
export function confirmaSalt(op, motiv) {
  if (!motiv.trim()) throw new Error('Motiv salt ore obligatoriu')
  const copie = JSON.parse(JSON.stringify(op))
  const aplica = u => ({ ...u, confirma_salt: true, motiv_salt: motiv.trim() })
  if (copie.args.p_utilaje) copie.args.p_utilaje = copie.args.p_utilaje.map(aplica)
  else Object.assign(copie.args, { p_confirma_salt: true, p_motiv_salt: motiv.trim() })
  if (copie.args.p_inlocuitor) copie.args.p_inlocuitor = aplica(copie.args.p_inlocuitor)
  return copie
}
