// redariMailF2Handler.mjs — handler testabil pentru funcția edge redari-mail-trimite (F2b, 18.11.2026), fără rețea implicită.
// Plan: docs/redari/PLAN_EMAIL_REDARI.md §1.3 (pașii 1–6 și tabelul rezultatelor), §1.9, §2.4 (fișa a–e). NU acceptă identitate sau rol din
// corp (L08). ORDINEA gărzilor, probată de teste: autentificare → owner → cerere → lot (RLS cu JWT-ul omului) → flag transport → garda „doar
// TEST” pe proiectul lotului citit din bază → comutatoarele BD (trimitere_oprita, căsuța conectată, informarea, lotul aprobat / neexpirat /
// integru) → abia apoi secretul din Vault, refresh-ul și apelurile către Google. Orice refuz de dinainte = NICIO citire de secret, NICIUN apel.
// Rezultat ambiguu (5xx / timeout / rețea / 200 neinterpretabil) = `necunoscut` + oprirea buclei (BD pune pauza de 15 min): reconciliere, niciodată
// retrimitere (L05). Refresh respins (4xx) înaintea oricărei rezervări → trimiterea se oprește din BD (fn_red_mail_f2_setari OFF) și 409.
import { TRANSPORT_REAL_ACTIV, DOAR_PROIECTE_TEST, LIMITA_INVOCARE, gardaTrimitere, transportPermis, proceseazaMesaj } from './redariMailF2.mjs'
import { reimprospateaza, trimite } from './gmailTrimitere.mjs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
export const SECRET_TRIMITERE = 'REDARI_GMAIL_TRIMITERE_REFRESH_TOKEN'

export async function raspundeTrimitere({ jwt, corp }, deps) {
  const out = (status, cod, extra = {}) => ({ status, body: { cod, trimise: 0, ...extra } })
  if (!jwt) return out(401, 'neautentificat')
  const user = await deps.getUser()
  // L18: autentificarea indisponibilă (5xx / rețea / fără status) ≠ token invalid
  if (user?.error) return Number.isInteger(user.error.status) && user.error.status >= 400 && user.error.status < 500 ? out(401, 'neautentificat') : out(503, 'autentificare_neconfirmata')
  const uid = user?.data?.user?.id
  if (!uid) return out(401, 'neautentificat')
  const owner = await deps.owner()
  if (owner?.error) return out(503, 'autorizare_neconfirmata')
  if (owner?.data !== true) return out(403, 'non_owner')
  if (!corp || typeof corp !== 'object' || typeof corp.lot_id !== 'string' || !UUID.test(corp.lot_id)) return out(400, 'cerere_invalida')
  const l = await deps.lot(corp.lot_id)   // RLS cu JWT-ul omului (L09)
  if (l?.error) return out(503, 'citire_neconfirmata')
  if (!l?.data) return out(404, 'tinta_inexistenta')
  if (!TRANSPORT_REAL_ACTIV) return out(423, 'transport_real_oprit')
  if (DOAR_PROIECTE_TEST) {
    // garda „doar TEST”: codul proiectului lotului, citit din bază cu JWT-ul omului; eroare de citire ≠ „nu e de test” (L18)
    const pr = await deps.proiect(l.data.proiect_id)
    if (pr?.error) return out(503, 'citire_neconfirmata')
    const p = transportPermis({ proiectCod: pr?.data?.cod })
    if (!p.ok) return out(423, p.cod, { motiv: p.motiv })
  }
  const [s, i] = await Promise.all([deps.setari(), deps.informare(l.data.proiect_id)])
  if (s?.error || i?.error) return out(503, 'citire_neconfirmata')
  const cod = gardaTrimitere({ owner: true, setari: s.data, informare: i.data, lot: l.data })
  if (cod) return out(409, cod)
  // ── de aici încolo: secretul (doar prin RPC-ul service_role, cu uid-ul din getUser ca p_apelant) și Google, prin wrapperul cu listă închisă ──
  const sec = await deps.secret(uid)
  if (sec?.error) return out(503, 'secret_neconfirmat')
  if (typeof sec?.data !== 'string' || !sec.data) return out(409, 'casuta_neconectata')
  let http
  try { http = deps.http() } catch { return out(503, 'transport_neconfigurat') }
  const tok = await reimprospateaza(http, sec.data)
  if (!tok.ok) {
    if (tok.cod === 'token_respins' || tok.cod === 'scope_diferit') {
      // invalid_grant / scope schimbat ÎNAINTE de orice rezervare: nimic in_apel; trimiterea se oprește din BD (plan §1.3), owner-ul reconectează
      try { await deps.opreste() } catch { /* starea se recitește din BD; refuzul rămâne */ }
      return out(409, tok.cod)
    }
    return out(503, tok.cod === 'metoda_nepermisa' ? 'transport_neconfigurat' : 'token_neconfirmat')
  }
  // ── bucla: rezervare (RPC, plafoane + optout + extern_permis + hash-uri sub lock) → mesaj → pauză ≥ 2 s ──
  const n = { trimise: 0, esuate: 0, necunoscute: 0, sarite: 0, rezervate: 0 }
  let oprit = null
  for (let k = 0; k < LIMITA_INVOCARE; k++) {
    const r = await deps.rezerva(l.data.id)
    if (r?.error) { oprit = 'rezervare_neconfirmata'; break }
    const m = Array.isArray(r?.data) ? r.data[0] : null
    if (!m) break   // coadă goală / plafon / în zbor plin / oprire / lot blocat — RPC-ul a scris motivul în BD
    n.rezervate++
    let rez
    try {
      rez = await proceseazaMesaj(m, {
        descarca: cale => deps.descarca(cale),
        incepe: async x => (await deps.incepe(x.id, x.lease_token))?.data === true,
        send: raw => trimite(http, tok.accessToken, raw),
        rezultat: async (x, rr) => {
          const w = await deps.rezultat(x.id, x.lease_token, rr.stare, rr.gmail_id ?? null, rr.thread_id ?? null)
          if (w?.error) throw new Error('persistare_neconfirmata')
          return { stare: rr.stare, cod: rr.cod, persistat: w.data === true }
        },
      })
    } catch { n.necunoscute++; oprit = 'rezultat_neconfirmat'; break }   // starea reală e în BD (rezervat / in_apel); se recitește, nu se reia
    if (rez?.sarit) n.sarite++
    else if (rez?.stare === 'trimis') n.trimise++
    else if (rez?.stare === 'esuat_sigur') n.esuate++
    else { n.necunoscute++; oprit = 'rezultat_ambiguu'; break }   // necunoscut / persistare neconfirmată: BD pune pauza; reconciliere, nu retrimitere
    if (k + 1 < LIMITA_INVOCARE) await deps.pauza(2100)
  }
  return out(200, oprit || 'rulat', n)
}
