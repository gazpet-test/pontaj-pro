// Dreptul de a crea un șantier nou (TKT-2026-0359, migrarea 20261222a, runda 2).
// Regula stă în BD, în RPC-ul fn_sites_creeaza (SECURITY DEFINER, parametri limitați): owner, SAU contul cu 'santiere_creare' (editor / admin)
// ȘI 'executie' (editor / admin), pe un proiect permis la scriere conform restricțiilor de Execuție. Interfața doar ascunde opțiunea pentru
// conturile pe care BD-ul oricum le-ar refuza (aceeași regulă de cont; restricțiile pe proiect le știe doar BD-ul) și explică rezultatul.
// Cheia NU e 'administrativ.locatii' (aceea înseamnă „Locații închiriate”) și nu are punct: nu deschide alt modul prin prefix.
// Șantierul legat de proiect se creează ÎNTR-UN SINGUR apel (L02): RPC-ul leagă și proiectul (site_id) și nu lasă triggerul de proiect
// automat să dubleze proiectul. Contul cu drept NU are INSERT direct pe sites (politica owner-ului rămâne singura).
export const CHEIE_SANTIERE_CREARE = 'santiere_creare'
export const RPC_SANTIER = 'fn_sites_creeaza'
const SCRIERE = ['editor', 'admin']

export function poateCreaSantier(profile) {
  if (!profile) return false
  if (profile.is_owner === true) return true
  const n = profile.module_access_levels || {}
  return SCRIERE.includes(n[CHEIE_SANTIERE_CREARE]) && SCRIERE.includes(n.executie)
}

// Mesajul pentru un INSERT DIRECT în sites refuzat de BD (calea owner-ului din Admin). 42501 = politica RLS; restul = eroarea așa cum vine
// (L18: o eroare nu se ascunde sub „nu ai drept”).
export function mesajRefuzSantier(error) {
  if (!error) return null
  const rls = error.code === '42501' || /row-level security/i.test(error.message || '')
  if (rls) return 'Baza de date a refuzat crearea șantierului: contul nu are dreptul „Creare șantiere” (îl acordă owner-ul) sau nu poate scrie în Execuție pe proiectul ales.'
  return 'Eroare la crearea șantierului: ' + (error.message || 'necunoscută')
}

// Răspunsul RPC-ului → rezultat (L05 / L18):
//   ok           = id de șantier valid + creat (true / false) în răspuns;
//   indisponibil = funcția nu există (migrarea neaplicată): PostgREST PGRST202 / PostgreSQL 42883;
//   refuz        = 42501 (dreptul);
//   eroare       = orice alt cod SQLSTATE / PGRST: cererea a ajuns la bază și tranzacția a fost ANULATĂ (nimic scris), deci determinat;
//   necunoscut   = fără cod (rețea, timeout, poarta 5xx) sau răspuns fără id: nu se știe dacă s-a scris → se reconciliază din BD.
const SQLSTATE = /^[0-9A-Z]{5}$/
export function clasificaRaspuns(raspuns) {
  const { data, error } = raspuns || {}
  if (!error) {
    const id = Number(data?.site_id)
    if (Number.isSafeInteger(id) && id > 0 && typeof data?.creat === 'boolean') return { tip: 'ok', siteId: id, creat: data.creat }
    return { tip: 'necunoscut', motiv: 'răspuns fără id de șantier' }
  }
  const cod = String(error.code || '')
  if (cod === 'PGRST202' || cod === '42883') return { tip: 'indisponibil' }
  if (cod === '42501') return { tip: 'refuz' }
  if (SQLSTATE.test(cod) || /^PGRST\d{3}$/.test(cod)) return { tip: 'eroare', mesaj: error.message || cod }
  return { tip: 'necunoscut', motiv: error.message || 'fără răspuns de la server' }
}

async function apel(client, args) {
  try { return await client.rpc(RPC_SANTIER, args) }
  catch (e) { return { data: null, error: { message: String(e?.message || e) } } }
}

// Starea legăturii, citită din BD: proiect.site_id + șantierul legat înapoi de același proiect = creat (de un apel anterior).
async function stareProiect(client, proiectId) {
  try {
    const { data: p, error: e1 } = await client.from('executie_proiecte').select('site_id').eq('id', proiectId).maybeSingle()
    if (e1 || !p) return { tip: 'necunoscut', motiv: e1?.message || 'proiectul nu se poate citi' }
    if (p.site_id == null) return { tip: 'nelegat' }
    const { data: s, error: e2 } = await client.from('sites').select('id, proiect_id').eq('id', p.site_id).maybeSingle()
    if (e2 || !s) return { tip: 'necunoscut', motiv: e2?.message || 'șantierul legat nu se poate citi' }
    if (Number(s.proiect_id) !== Number(proiectId)) return { tip: 'necunoscut', motiv: 'proiectul e legat de un șantier al altui proiect' }
    return { tip: 'ok', siteId: Number(s.id), creat: false, verificat: true }
  } catch (e) { return { tip: 'necunoscut', motiv: String(e?.message || e) } }
}

// Creează un șantier prin RPC. Cu proiect: la rezultat necunoscut (L05) recitește starea din BD; dacă nu e legat, reapelează O dată cu
// ACEIAȘI parametri (RPC-ul e idempotent pe proiect: proiectul care are deja șantierul lui îl întoarce, fără să scrie). Fără proiect (Admin):
// fără reîncercare automată — un al doilea apel ar crea alt șantier.
// Runda 3 (L05 / L18): după un prim apel AMBIGUU, un eșec determinat al reîncercării (refuz, funcția dispărută, eroare) privește DOAR a doua
// tranzacție — nu dovedește că prima nu a scris (ex.: primul apel a făcut COMMIT, răspunsul s-a pierdut, apoi dreptul a fost retras). Singura
// dovadă e starea din BD: reconcilierea FINALĂ (proiect + șantier).
// Runda 4 (L05 / L18): nici „proiect nelegat” la reconcilierea finală NU dovedește eșecul: prima cerere poate fi încă în lucru (a trecut de
// verificarea dreptului și așteaptă lock-ul proiectului, sau e încă pe drum în rețea) și poate face COMMIT după citire. Clientul nu are nicio
// dovadă pozitivă că prima cerere s-a terminat, deci după un prim apel ambiguu există DOAR două rezultate: ok (șantierul legat, văzut în BD)
// sau NECUNOSCUT. Eșecul („proiect fără șantier”) se raportează doar când PRIMUL apel a fost refuzat determinat (tranzacția lui anulată).
export async function creeazaSantier(client, { nume, proiectId = null, beneficiar = null }) {
  const args = { p_nume: nume, p_proiect: proiectId, p_beneficiar: beneficiar }
  const r = clasificaRaspuns(await apel(client, args))
  if (r.tip !== 'necunoscut' || proiectId == null) return r
  const st = await stareProiect(client, proiectId)
  if (st.tip === 'ok') return st
  const r2 = clasificaRaspuns(await apel(client, args))
  if (r2.tip === 'ok') return r2
  const fin = await stareProiect(client, proiectId)
  if (fin.tip === 'ok') return fin
  return { tip: 'necunoscut', motiv: motivNecunoscut(r2, fin) }
}

// De ce rezultatul rămâne necunoscut, pe scurt, pentru om: ce a răspuns reîncercarea și ce s-a văzut în BD.
const REINCERCARE = { refuz: 'refuzată de baza de date (dreptul)', indisponibil: 'funcția nu e disponibilă' }
function motivNecunoscut(r2, fin) {
  const a2 = r2.tip === 'eroare' ? `eroare: ${r2.mesaj}` : (REINCERCARE[r2.tip] || r2.motiv || 'fără răspuns')
  const bd = fin.tip === 'nelegat' ? 'proiectul nu are încă șantier, dar prima cerere poate fi încă în lucru'
    : `starea proiectului nu s-a putut verifica: ${fin.motiv}`
  return `prima cerere fără răspuns; reîncercarea: ${a2}; ${bd}`
}

// Textul pentru om (wizard: cuProiect = true; Admin: false). ok = doar când șantierul există sigur.
export function mesajSantier(r, { cuProiect = true } = {}) {
  const fara = cuProiect ? ' Proiectul s-a creat fără șantier — leagă-l din editare.' : ''
  switch (r?.tip) {
    case 'ok':
      if (r.creat) return { ok: true, text: '🏗️ șantier nou creat' }
      if (r.verificat) return { ok: true, text: '🏗️ șantier nou creat (confirmat după o verificare în baza de date)' }
      return { ok: true, text: '🏗️ șantierul proiectului exista deja (nu s-a creat altul)' }
    case 'refuz':
      return { ok: false, text: '⚠️ Baza de date a refuzat crearea șantierului: contul nu are dreptul „Creare șantiere” sau nu poate scrie în Execuție pe proiectul ales.' + fara }
    case 'indisponibil':
      return { ok: false, text: '⚠️ Crearea șantierului nu e încă disponibilă (actualizarea bazei de date nu e aplicată).' + fara }
    case 'eroare':
      return { ok: false, text: `⚠️ Șantierul nu s-a creat: ${r.mesaj}.` + fara }
    default:
      return { ok: false, text: `⚠️ Nu se știe dacă șantierul s-a creat (${r?.motiv || 'fără răspuns'}). ` +
        (cuProiect ? 'Verifică în editarea proiectului înainte să creezi altul.' : 'Verifică lista înainte să încerci din nou.') }
  }
}
