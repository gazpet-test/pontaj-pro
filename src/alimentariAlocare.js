// Citiri și scrieri pentru alocarea manuală a alimentărilor fără șantier (FaraSantierBulkModal) și pentru
// alocarea alimentărilor „fără QR” (Logistica → Reconciliere QR). Primesc clientul Supabase ca parametru,
// ca să poată fi testate cu un client fals (TKT-2026-0383 / 0387, corecturi după review #1184).
//
// - Lista cardurilor NU vine din primele 500 de rânduri: se citesc TOATE alimentările fără șantier (doar id + card),
//   pe chei (keyset pe id, până la pagina goală — plafonul de 1000 rânduri al serverului nu trunchiază).
// - Alegerea unui card încarcă rândurile acelui card cu filtru pe server (textul exact al cardului, cu toate
//   variantele de spații văzute în BD), tot pe chei, fără limita de 500.
// - Scrierile sunt CAS: se scrie doar dacă rândul are încă starea citită (0 rânduri întoarse = conflict).

import { paginareKeyset } from './hrDeciziiUtil.js'
import { FARA_CARD, indexCarduri } from './alimentariFaraSantierFiltru.js'

export const TABEL = 'logistica_alimentari'

export const COLOANE_BULK = `
        id, data_alimentare, cantitate_litri, pret_total, pret_per_litru,
        statie_combustibil, ore_la_alimentare, km_la_alimentare, card_combustibil,
        whatsapp_caption, whatsapp_autor, whatsapp_msg_dt,
        sursa_alocare_santier, observatii,
        logistica_active(id, cod_intern, nr_inmatriculare, marca, model)
      `

// Câte rânduri se arată când nu e ales un card (cele mai noi; trunchierea se afișează cu numărul total)
export const LIMITA_INCARCARE = 500

// O valoare pentru lista `in.(...)` din PostgREST: mereu între ghilimele, cu \ și " escapate
// (spațiile de la capete, virgulele și parantezele rămân parte din valoare).
export function valoarePostgrest(v) {
  return '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'
}
export function listaPostgrest(valori) {
  return '(' + (valori || []).map(valoarePostgrest).join(',') + ')'
}

// Filtrul pe card, aplicat pe server. `idx` = indexCarduri(...) din aceeași încărcare.
// Un card care nu (mai) apare în index se caută după textul lui exact (rezultat gol dacă nu există).
export function aplicaFiltruCard(q, card, idx) {
  if (card === FARA_CARD) {
    const goale = idx?.varianteFaraCard || []
    return goale.length
      ? q.or(`card_combustibil.is.null,card_combustibil.in.${listaPostgrest(goale)}`)
      : q.is('card_combustibil', null)
  }
  const c = (idx?.carduri || []).find(x => x.card === card)
  return q.filter('card_combustibil', 'in', listaPostgrest(c ? c.variante : [card]))
}

// Toate alimentările fără șantier (id + card), pe chei → indexul cardurilor. Eroarea se aruncă (nu listă goală).
export async function citesteIndexCarduri(supabase, pas = 1000) {
  const randuri = await paginareKeyset((ultim, n) => {
    let q = supabase.from(TABEL).select('id, card_combustibil').is('site_id', null).order('id', { ascending: true }).limit(n)
    if (ultim != null) q = q.gt('id', ultim)
    return q
  }, pas)
  return indexCarduri(randuri)
}

// Ordinea afișării: data desc, apoi id desc (aceeași ca interogarea fără card)
export function ordineAfisare(a, b) {
  const da = a.data_alimentare || '', db = b.data_alimentare || ''
  if (da !== db) return da < db ? 1 : -1
  return (b.id || 0) - (a.id || 0)
}

// Rândurile unui card (sau „fără card”), toate, cu filtru pe server, pe chei. Verificarea cu cheieCard rămâne și
// în client (filtreazaAlimentari), ca o variantă nouă apărută între citiri să nu intre pe alt card.
export async function citesteAlimentariCard(supabase, card, idx, pas = 1000) {
  const randuri = await paginareKeyset((ultim, n) => {
    let q = supabase.from(TABEL).select(COLOANE_BULK).is('site_id', null)
    q = aplicaFiltruCard(q, card, idx).order('id', { ascending: true }).limit(n)
    if (ultim != null) q = q.gt('id', ultim)
    return q
  }, pas)
  return randuri.sort(ordineAfisare)
}

// Cele mai noi LIMITA_INCARCARE alimentări fără șantier + numărul total (pentru avertismentul de trunchiere)
export async function citesteAlimentariRecente(supabase, limita = LIMITA_INCARCARE) {
  const { data, error, count } = await supabase.from(TABEL)
    .select(COLOANE_BULK, { count: 'exact' })
    .is('site_id', null)
    .order('data_alimentare', { ascending: false })
    .order('id', { ascending: false })
    .limit(limita)
  if (error) throw error
  return { randuri: data || [], total: Number.isFinite(count) ? count : null }
}

// Salvarea din Bulk: CAS pe site_id IS NULL (o alocare făcută între timp nu se suprascrie).
// Rezultat: { success, conflicte, errors: [{ id, msg }] }; o eroare de rețea / server = eroare, nu conflict.
export async function salveazaAlocariBulk(supabase, selectii, { profileId = null, acum, lot = 30 } = {}) {
  const now = acum || new Date().toISOString()
  let success = 0, conflicte = 0
  const errors = []
  for (let i = 0; i < (selectii || []).length; i += lot) {
    const slice = selectii.slice(i, i + lot)
    const results = await Promise.all(slice.map(({ id, site_id }) =>
      supabase.from(TABEL)
        .update({ site_id, sursa_alocare_santier: 'manual', aloc_santier_de: profileId, aloc_santier_la: now })
        .eq('id', id)
        .is('site_id', null)
        .select('id')
        .then(r => r, e => ({ data: null, error: { message: e?.message || String(e) } }))   // o cerere respinsă nu oprește lotul
    ))
    results.forEach((r, idx) => {
      if (r.error) errors.push({ id: slice[idx].id, msg: r.error.message })
      else if (!r.data || r.data.length === 0) conflicte++
      else success++
    })
  }
  return { success, conflicte, errors }
}

// Alocarea unei alimentări „fără QR” (vehicul + șantier). Șantierul deja pus (ex. din Bulk) se păstrează dacă nu
// s-a schimbat; CAS pe qr_status = 'real_fara_qr' și pe site_id-ul citit. Rezultat: 'ok' | 'conflict'; eroarea se aruncă.
export function planAlocareFaraQr(alim, activeId, siteId) {
  const siteVechi = alim?.site_id ?? null
  const siteNou = siteId ?? null
  const upd = { active_id: activeId, qr_status: 'matched' }
  if (siteNou !== siteVechi) {
    upd.site_id = siteNou
    upd.sursa_alocare_santier = siteNou ? 'manual' : null
  } else if (siteVechi === null) upd.sursa_alocare_santier = null
  return { upd, siteVechi }
}

export async function alocaFaraQr(supabase, alim, activeId, siteId) {
  const { upd, siteVechi } = planAlocareFaraQr(alim, activeId, siteId)
  let q = supabase.from(TABEL).update(upd).eq('id', alim.id).eq('qr_status', 'real_fara_qr')
  q = siteVechi !== null ? q.eq('site_id', siteVechi) : q.is('site_id', null)
  const { data, error } = await q.select('id')
  if (error) throw error
  return data && data.length > 0 ? 'ok' : 'conflict'
}
