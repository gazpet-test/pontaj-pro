/* convocatorNeexpediat.js — D4 (audit 04.11.2026): convocatoarele GENERATE dar NEEXPEDIATE ale unui deținător.
   Vederea red_v_stare_parcela are doar max(data_expediere), deci un convocator generat și neexpediat nu se vede în Registru,
   iar un al doilea click pe „📄 Convocator” consuma un număr C-nnnn nou (numerele nu se refolosesc) → convocatoare duble.
   Fără migrare: citire separată din red_convocari (keyset complet, pe loturi de id-uri — citesteNeexpediatePeDetinatori, L18/L23).
   Propunere de migrare (NU aplicată): coloanele `conv_neexpediat_nr` / `conv_neexpediat_nr_count` în red_v_stare_parcela. */

import { useCallback, useEffect, useRef, useState } from 'react'
import { dataCivilaBucuresti } from './setari.js'

// coloanele necesare (fără PII): numărul, canalul, fișierul (pentru „Descarcă din nou”) și data generării
export const COL_CONV_NEEXPEDIAT = 'id, detinator_id, canal, nr_document, fisier_convocator_path, created_at'

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

/**
 * P2-01 (c): PUNCTUL DE INTEGRARE pentru rezervarea numărului unui convocator NOU.
 * AZI: `fn_red_numar_document('C', uat3, tronson)` — verificarea „există deja un convocator neexpediat” e făcută în UI
 * (avertisment + recitire chiar înainte de rezervare), NU e atomică: alt utilizator poate genera în paralel.
 * DUPĂ aplicarea migrării `20261130l_redari_convocare_rezerva` (PR #989): aici se cheamă RPC-ul atomic (blochează
 * deținătorul, recitește convocările active neexpediate și refuză fără confirmare), cu `detinatorId` și `confirmateIds`.
 */
export async function rezervaNumarConvocare(supabase, { uat3, tronson, detinatorId, confirmateIds = [] } = {}) {
  void detinatorId; void confirmateIds   // folosite de RPC-ul atomic din #989, după activarea protecției
  const { data, error } = await supabase.rpc('fn_red_numar_document', { p_tip: 'C', p_uat3: uat3, p_tronson: tronson ?? null })
  if (error) throw error
  if (!data) throw new Error('Numărul de document nu a fost generat.')
  return data
}

export const AVERTISMENT_CONCURENTA = 'Verificarea e făcută pe această pagină: alt utilizator poate genera în paralel un convocator pentru același deținător. Verificarea finală o va face serverul, după activarea protecției.'
