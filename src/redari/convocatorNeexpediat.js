/* convocatorNeexpediat.js — D4 (audit 04.11.2026): convocatoarele GENERATE dar NEEXPEDIATE ale unui deținător.
   Vederea red_v_stare_parcela are doar max(data_expediere), deci un convocator generat și neexpediat nu se vede în Registru,
   iar un al doilea click pe „📄 Convocator” consuma un număr C-nnnn nou (numerele nu se refolosesc) → convocatoare duble.
   Fără migrare: citire separată din red_convocari (keyset complet, pe loturi de id-uri — citesteNeexpediatePeDetinatori, L18/L23).
   Propunere de migrare (NU aplicată): coloanele `conv_neexpediat_nr` / `conv_neexpediat_nr_count` în red_v_stare_parcela. */

import { useCallback, useEffect, useRef, useState } from 'react'
import { dataCivilaBucuresti } from './setari.js'

// coloanele necesare (fără PII): numărul, canalul, fișierul (pentru „Descarcă din nou”) și data generării
export const COL_CONV_NEEXPEDIAT = 'id, calitate_document, detinator_id, canal, nr_document, fisier_convocator_path, created_at'

/** Filtrul „generat, neexpediat”: convocare activă, neștearsă, fără dată de expediere. */
export const filtruNeexpediate = (q) => q.eq('stare', 'activ').is('data_expediere', null).is('sters_la', null)

/** Rândurile citite → Map detinator_id → listă, cea mai recentă prima. Rândurile fără deținător se ignoră. */
export function grupeazaNeexpediate(randuri) {
  const harta = new Map()
  for (const r of randuri || []) {
    if (!r?.detinator_id) continue
    if (!harta.has(r.detinator_id)) harta.set(r.detinator_id, [])
    harta.get(r.detinator_id).push(r)
  }
  for (const lista of harta.values()) {
    lista.sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')) || String(b.id ?? '').localeCompare(String(a.id ?? '')))
  }
  return harta
}

/** Eticheta scurtă din Registru: „Convocator generat C-0002 (neexpediat)”, „… (neexpediat, fișier neîncărcat)”, „ +1”. */
export function etichetaNeexpediat(lista) {
  if (!lista?.length) return ''
  const c = lista[0]
  const fisier = c.fisier_convocator_path ? '' : ', fișier neîncărcat'
  const altele = lista.length > 1 ? ` +${lista.length - 1}` : ''
  return `Convocator generat ${c.nr_document} (neexpediat${fisier})${altele}`
}

/** Textul bifei care deblochează un convocator NOU când există deja unul neexpediat. */
export function textConfirmareNumarNou(lista) {
  const n = lista?.length || 0
  const nr = (lista || []).map(c => c.nr_document).join(', ')
  return `Înțeleg că se consumă un număr C-nnnn NOU (numerele nu se refolosesc) și că deținătorul va avea ${n + 1} convocatoare active neexpediate (există deja: ${nr}).`
}

/**
 * Se poate porni generarea cu număr NOU? existente = null → încă se citește (nu); eroare de citire → nu (fail-closed:
 * fără să știm dacă există deja unul, nu consumăm un număr); listă goală → da; listă nevidă → doar cu bifa de confirmare.
 */
export function poateGeneraNou({ existente, eroare, confirmat }) {
  if (eroare) return false
  if (!Array.isArray(existente)) return false
  return existente.length === 0 || confirmat === true
}

// ─── r2 (Jakarinos #991) ─────────────────────────────────────────────────────────────────────────────────────

export const LOT_DETINATORI = 100
export const PAGINA_KEYSET = 1000

/**
 * P2-3 (L18/L23): citire COMPLETĂ, keyset pe `id` (uuid, unic), pe loturi de deținători. Continuă până la pagina GOALĂ
 * (nu se oprește la „mai puțin decât am cerut”, ca să nu trunchieze când serverul plafonează pagina), verifică avansarea
 * cheii și aruncă la eroare sau la `data` care nu e listă (un răspuns fără listă NU înseamnă „nicio convocare”).
 * Helperul comun citesteIn rămâne neschimbat (alți apelanți).
 */
export async function citesteNeexpediatePeDetinatori(supabase, ids, { lot = LOT_DETINATORI, pagina = PAGINA_KEYSET, maxPagini = 10000 } = {}) {
  const lista = [...new Set((ids || []).filter(Boolean))]
  const tot = []
  for (let i = 0; i < lista.length; i += lot) {
    const bucata = lista.slice(i, i + lot)
    let ultim = null
    for (let p = 0; ; p++) {
      if (p >= maxPagini) throw new Error('Convocări neexpediate: prea multe pagini (citire oprită, rezultat incomplet).')
      let q = filtruNeexpediate(supabase.from('red_convocari').select(COL_CONV_NEEXPEDIAT)).in('detinator_id', bucata)
      if (ultim !== null) q = q.gt('id', ultim)
      const { data, error } = await q.order('id').limit(pagina)
      if (error) throw error
      if (!Array.isArray(data)) throw new Error('Convocări neexpediate: răspuns fără listă (citire incompletă).')
      if (!data.length) break
      const nou = String(data[data.length - 1]?.id ?? '')
      if (!nou || (ultim !== null && !(nou > ultim))) throw new Error('Convocări neexpediate: paginarea nu avansează (citire oprită).')
      tot.push(...data)
      ultim = nou
    }
  }
  return tot
}

/** P1-2: un fișier existent se poate descărca din nou indiferent de gărzile pentru un document NOU. */
export const poateDescarcaExistent = (c) => !!c?.fisier_convocator_path

/**
 * P1-2: modalul se deschide dacă se poate genera un document nou (fără motiv de blocare) SAU dacă există o convocare
 * neexpediată cu fișier (descărcare). Regenerarea aceluiași număr rămâne supusă gărzilor de conținut (motivul).
 */
export const poateDeschideConvocator = ({ motiv, existente }) => !motiv || (Array.isArray(existente) && existente.some(poateDescarcaExistent))

/**
 * P2-5 (L24): citire cu generație. Fiecare `porneste(cheie)` invalidează cererile anterioare; doar ultima își aplică
 * rezultatul. `aplica({ cheie, existente, eroare })` primește întâi, sincron, starea „se citește” (existente null).
 * `invalideaza()` (la unmount) e DEFINITIV (r3 P2-2): niciun răspuns întârziat nu mai e aplicat și niciun `porneste`
 * ulterior (ex. reconcilierea din `finally` după ce modalul s-a închis) nu mai citește și nu mai aplică nimic.
 */
export function cititorCuGeneratie(citeste, aplica) {
  let g = 0
  let inchis = false
  return {
    async porneste(cheie) {
      if (inchis) return
      const eu = ++g
      aplica({ cheie, existente: null, eroare: null })
      try {
        const r = await citeste(cheie)
        if (eu === g) aplica({ cheie, existente: r, eroare: null })
      } catch (e) {
        if (eu === g) aplica({ cheie, existente: null, eroare: e })
      }
    },
    invalideaza() { inchis = true; g++ },
  }
}

/**
 * r3 P2-1 (L17): data documentului la regenerarea cu ACELAȘI număr = data civilă Europe/Bucharest a convocării
 * (created_at e timestamptz în UTC: 2026-11-03T22:30:00Z → 2026-11-04). Fără dată validă → eroare (nu „azi”).
 */
export function dataDocumentConvocare(c) {
  const d = dataCivilaBucuresti(c?.created_at)
  if (!d) throw new Error(`Convocarea ${c?.nr_document ?? ''} nu are o dată de generare validă (created_at) — regenerarea cu același număr e oprită.`)
  return d
}

// ─── r4 (Copilot #991) ──────────────────────────────────────────────────────────────────────────────────────

/**
 * P2-03 (L24): hook-ul citirii din modal. Un cititor NOU la fiecare setup al efectului (legat de deținător), invalidat la
 * cleanup-ul LUI — robust la React StrictMode (setup → cleanup → setup) și la schimbarea deținătorului.
 * `citeste(detinatorId)` → Promise<lista>; `laCitire()` e chemat când starea trece pe „se citește” (ex. resetarea bifei).
 * @returns {{ existente: object[] | null, eroare: any, reciteste: () => Promise<void> }}
 */
export function useConvocariNeexpediate(detinatorId, citeste, { laCitire } = {}) {
  const [st, setSt] = useState({ cheie: null, existente: null, eroare: null })
  const cititorRef = useRef(null)
  const citesteRef = useRef(citeste); citesteRef.current = citeste
  const laCitireRef = useRef(laCitire); laCitireRef.current = laCitire
  useEffect(() => {
    const c = cititorCuGeneratie(k => citesteRef.current(k), (x) => { setSt(x); if (x.existente === null && !x.eroare) laCitireRef.current?.() })
    cititorRef.current = c
    c.porneste(detinatorId)
    return () => { c.invalideaza(); if (cititorRef.current === c) cititorRef.current = null }
  }, [detinatorId])
  const reciteste = useCallback(() => (cititorRef.current ? cititorRef.current.porneste(detinatorId) : Promise.resolve()), [detinatorId])
  const curenta = st.cheie === detinatorId
  return { existente: curenta ? st.existente : null, eroare: curenta ? st.eroare : null, reciteste }
}

/**
 * P2-01: convocările active neexpediate apărute între citirea afișată (și eventual confirmată) și momentul rezervării.
 * `confirmate` = lista văzută de operator (null = necunoscută → toate proaspetele sunt „noi”).
 */
export function aparuteDupaVerificare(confirmate, proaspete) {
  const vazute = new Set((confirmate || []).map(c => c.id))
  return (proaspete || []).filter(c => !vazute.has(c.id))
}

// ─── #989 r4 (Jakarinos r3 P1): protocolul atomic, COMUN căii individuale și generării în masă ──────────────────────

export const RPC_REZERVA = 'fn_red_convocare_rezerva'
export const MESAJ_FARA_PROTECTIE = 'protecția la concurență nu e activă — aplicați migrarea 20261131c (calitatea așteptată la rezervare)'
/** Răspunsul PostgREST pentru o funcție inexistentă (migrarea 20261130l neaplicată). */
export const esteFaraRpc = (res) => res?.status === 404 || res?.error?.code === 'PGRST202'

/**
 * PUNCTUL DE INTEGRARE pentru un convocator NOU (ambele căi): RPC-ul atomic `fn_red_convocare_rezerva` (migrarea 20261130l) —
 * PR3a r3: p_calitate_asteptata obligatorie, comparata sub lock inainte de numar; overload-ul vechi refuza.
 * Lock pe (proiect, deținător), recitire sub lock (deținător + parcelă, gărzile proiect/UAT → RD002), RD001 dacă există deja o convocare
 * activă neexpediată pe ACELAȘI canal (excepția: `confirmat` = bifa EXPLICITĂ din modal), apoi numărul C și INSERT-ul rândului în
 * aceeași tranzacție. Clientul NU mai inserează rândul: după rezervare încarcă doar fișierul (reincarcaConvocator pe `convocareId`).
 * Fără RPC → eroare cu `code: 'FARA_RPC'` și MESAJ_FARA_PROTECTIE (fără cale alternativă).
 * @returns {Promise<{ convocareId: string, nrDocument: string }>}
 */
export async function rezervaNumarConvocare(supabase, { detinatorId, calitateAsteptata, confirmat = false, canal = 'posta' } = {}) {
  if (!detinatorId) throw new Error('Lipsește deținătorul pentru rezervare.')
  if (typeof calitateAsteptata !== 'string' || !calitateAsteptata.trim()) throw new Error('Lipsește calitatea așteptată pentru rezervare.')
  const res = await supabase.rpc(RPC_REZERVA, { p_detinator_id: detinatorId, p_numar_nou_confirmat: confirmat === true, p_canal: canal, p_calitate_asteptata: calitateAsteptata })
  if (esteFaraRpc(res)) throw Object.assign(new Error(MESAJ_FARA_PROTECTIE), { code: 'FARA_RPC' })
  if (res.error) throw res.error
  const r0 = Array.isArray(res.data) ? res.data[0] : res.data
  if (!r0?.convocare_id || !r0?.nr_document) throw new Error('Rezervarea nu a întors convocarea și numărul.')
  if (!r0.parcela_id || !r0.uat_id || !r0.proiect_id) throw new Error('Rezervarea nu a întors identitatea parcelei / UAT-ului / proiectului.')
  return { convocareId: r0.convocare_id, nrDocument: r0.nr_document, parcelaId: r0.parcela_id, uatId: r0.uat_id, proiectId: r0.proiect_id }
}

/**
 * #989 r5 (Copilot P1-01): relația deținător → parcelă → proiect → UAT a datelor din care se face documentul, verificată ÎNAINTE de rezervare
 * (ambele căi). Întoarce null când e coerentă, altfel motivul (fără rezervare).
 */
export function motivRelatieSchimbata({ detinator, parcela, proiect, uat }) {
  if (!detinator || detinator.sters_la) return 'deținătorul nu mai e activ'
  if (!parcela || parcela.sters_la) return 'parcela nu mai e activă'
  if (detinator.parcela_id !== parcela.id) return 'deținătorul nu mai e pe parcela afișată (registrul e vechi — reîncarcă)'
  if (parcela.proiect_id !== proiect?.id) return 'parcela nu mai e în proiectul afișat'
  if (parcela.uat_id !== uat?.id) return 'parcela nu mai e în UAT-ul afișat'
  return null
}

/**
 * #989 r5 (Copilot P1-01): identitatea folosită de server la rezervare trebuie să fie EXACT cea a documentului care urmează să fie generat.
 * La nepotrivire NU se generează nimic: convocarea rămâne „fișier neîncărcat”, iar „Regenerează același număr” (Fișă / modal) o face pe datele noi.
 */
export function motivIdentitateDiferita(rez, { parcelaId, uatId, proiectId }) {
  if (rez.parcelaId === parcelaId && rez.uatId === uatId && rez.proiectId === proiectId) return null
  return `convocarea ${rez.nrDocument} a fost rezervată pe altă parcelă / UAT decât cea afișată (date schimbate între timp); nu am generat documentul — `
    + 'convocarea rămâne cu „fișier neîncărcat”; regenerează-o cu același număr după reîncărcarea registrului'
}

export const AVERTISMENT_CONCURENTA = 'Lista de mai sus e citită pe această pagină; verificarea finală o face serverul la rezervare (atomic): dacă între timp alt utilizator a generat un convocator pe același canal, rezervarea e refuzată, iar un număr nou se dă doar cu bifa de confirmare.'
