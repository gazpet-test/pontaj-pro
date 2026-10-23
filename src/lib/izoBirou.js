import { uuid } from './izoCoada.js'

export const CAS_MESAJ = 'Datele s-au schimbat între timp. Reîncarcă lotul și verifică din nou selecția și deciziile.'
// O încărcare invalidată (inclusiv cleanup-ul StrictMode) nu blochează noua montare.
export function creeazaControlBirou() {
  let generatie = 0, activa = null
  return {
    invalideaza() { generatie++ },
    incepe() {
      if (activa === generatie) return null
      const token = generatie
      activa = token
      return {
        actuala: () => token === generatie,
        incheie() { if (activa === token) activa = null; return token === generatie },
      }
    },
  }
}
export function eroareBirou(e) {
  const raw = [e?.message, e?.details, e?.hint, e?.cod].filter(Boolean).join(' ') || String(e)
  return /\bcas\b|preview_vechi|dependente_schimbate|bucata_schimbata|sudura_schimbata/i.test(raw) ? CAS_MESAJ : raw
}
const motivValid = value => {
  const s = String(value || '').trim()
  if (s.length < 3 || s.length > 1000) throw Error('Motivul trebuie să aibă între 3 și 1000 de caractere.')
  return s
}
const cas = d => {
  if (!d?.id || !Number.isInteger(d.versiune) || !d.updated_at) throw Error('Lipsește versiunea văzută. Reîncarcă.')
  return { p_decl: d.id, p_versiune: d.versiune, p_updated_at: d.updated_at }
}
const operatie = (nume, args) => ({ nume, args: JSON.parse(JSON.stringify(args)) })
export const declaratiiLot = preview => (preview?.randuri || []).map(r => r.declaratie)
export const cheiDecizii = (preview, ids) => (preview?.decizii_cerute || []).filter(k => ids.some(id => k === `corectie:${id}`))

export function cerereAprobare(preview, ids, decizii = {}, id = uuid) {
  if (!preview?.amprenta || !preview.preverificare?.id) throw Error('Reîncarcă preview-ul înainte de aprobare.')
  if (!ids.length || ids.length > 200 || new Set(ids.map(String)).size !== ids.length) throw Error('Selectează între 1 și 200 de rânduri distincte.')
  const rows = declaratiiLot(preview)
  const randuri = ids.map(key => {
    const d = rows.find(r => String(r.id) === String(key))
    if (!d || d.stare !== 'trimisa') throw Error('Se aprobă numai rânduri trimise și identificate.')
    cas(d)
    return { declaratie_id: d.id, versiune: d.versiune, updated_at: d.updated_at }
  })
  // Deciziile aparțin submulțimii aprobate, nu întregului preview.
  const decisions = Object.fromEntries(cheiDecizii(preview, ids).map(k => [k, motivValid(decizii[k])]))
  return operatie('fn_izo_aproba', { p_cheie: id(), p_preverificare: preview.preverificare.id, p_randuri: randuri, p_amprenta: preview.amprenta, p_decizii: decisions })
}

// Aceeași închidere ca fn_izo_dependenti: uid + surse/copii declarați, tranzitiv.
export function descendenti(decl, declaratii, copii = []) {
  const found = new Set([String(decl.id)])
  let changed = true
  while (changed) {
    changed = false
    const uids = new Set(declaratii.filter(d => found.has(String(d.id))).map(d => d.uid))
    const children = new Set(copii.filter(c => found.has(String(c.declaratie_id))).map(c => c.uid))
    for (const d of declaratii) {
      if (found.has(String(d.id)) || ['aprobata', 'respinsa', 'stearsa'].includes(d.stare)) continue
      if (uids.has(d.depinde_de_uid) || children.has(d.bucata_decl_uid) || children.has(d.sursa_decl_uid)) { found.add(String(d.id)); changed = true }
    }
  }
  return declaratii.filter(d => String(d.id) !== String(decl.id) && found.has(String(d.id)))
}

export function cerereDecizie(tip, d, motiv, dependente = {}, id = uuid) {
  if (!['respinge', 'revizie_cere', 'serie_lamureste'].includes(tip)) throw Error('Decizie necunoscută')
  if (['aprobata', 'respinsa', 'stearsa'].includes(d?.stare)) throw Error('Rând final; nu mai poate fi modificat.')
  const args = { p_cheie: id(), ...cas(d), p_motiv: motivValid(motiv) }
  if (tip === 'respinge') {
    if (Object.values(dependente).some(x => !['blocheaza', 'respinge'].includes(x))) throw Error('Alege decizia fiecărui descendent.')
    args.p_dependente = dependente
  }
  if (tip === 'serie_lamureste') {
    if (!/^\d+$/.test(String(dependente.bucata)) || Number(dependente.bucata) <= 0) throw Error('Alege bucata reală.')
    args.p_bucata = dependente.bucata
  }
  return operatie(`fn_izo_${tip}`, args)
}
export function cerereIesire({ depozit, tronson, bucati, aviz, data }, id = uuid) {
  const nr = String(aviz || '').trim()
  if (!depozit || !tronson || !bucati.length || bucati.length > 200 || new Set(bucati.map(String)).size !== bucati.length || bucati.some(b => !/^\d+$/.test(String(b)) || Number(b) <= 0) || nr.length < 3 || nr.length > 100 || !/^\d{4}-\d{2}-\d{2}$/.test(data)) throw Error('Alege depozitul, tronsonul, 1–200 de bucăți, avizul (3–100 caractere) și data.')
  return operatie('fn_izo_iesire_tronson', { p_cheie: id(), p_depozit: depozit, p_tronson: tronson, p_bucati: bucati, p_nr_aviz: nr, p_data: data })
}
export const cerereFront = (tronson, motiv) => {
  if (!tronson) throw Error('Alege tronsonul.')
  return operatie('fn_izo_front_elibereaza', { p_tronson: tronson, p_motiv: motivValid(motiv) })
}
export const cerereTranzitie = (sudura, motiv) => operatie('fn_izo_tranzitie_confirma', { p_sudura: sudura, p_motiv: motivValid(motiv) })

// Reapelarea ACELEIAȘI cereri păstrează cheia și payload-ul inclusiv după timeout.
export async function executaBirou(rpc, cerere) {
  const { data, error } = await rpc(cerere.nume, cerere.args)
  if (error) throw error
  if (!data || ['eroare', 'conflict', 'preview_vechi', 'cas'].includes(data.cod)) throw Error(data?.motiv || data?.cod || 'Răspuns RPC lipsă')
  return data
}

// Paginare explicită: registrul proiectului poate depăși plafonul PostgREST.
export async function citestePagini(query) {
  const result = []
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await query(offset, offset + 499)
    if (error) throw error
    result.push(...(data || []))
    if (!data || data.length < 500) return result
  }
}
