// identitateFisier.mjs — când un fișier extras dintr-o arhivă SEAP e „deja în platformă” (07.10.2026, PR #643).
// Folosit de worker/ofertare/seap.ts (drumul SEAP, aduLicitatie) și de supabase/functions/ofertare-seap-import (ZIP inline):
// aceeași regulă pe ambele drumuri.
//
// Regula (Copilot conv. 3, NO-GO r1 pe d688850): „deja” = ACELAȘI CONȚINUT DOVEDIT. Sha256-ul fișierului nou e egal cu
// sha256-ul unui document existent, luat DOAR din manifest cu stare 'urcat' (bytes-ii chiar urcați sub acel document_id).
// Nu sunt dovadă:
//   - mărimea sau size_bytes NULL (două PDF-uri diferite pot avea aceeași lungime);
//   - un rând 'deja_in_platforma' (cele vechi au fost scrise chiar de bugul reparat aici: alt conținut, id-ul celuilalt);
//   - un document cu sha-uri 'urcat' contradictorii.
// Fără dovadă nu e „deja”: se urcă sub numele exact dacă e liber, altfel cu prefixul arhivei, apoi cu sha-ul în nume.
// O dublură e preferabilă unui fișier pierdut în tăcere. Reluarea rămâne idempotentă: fișierul urcat de importul precedent
// are sha-ul în manifest ('urcat'), iar apelantul nu-și retrogradează propriul rând 'urcat' la o reluare (vezi pastreazaUrcat).

/** @typedef {{ exacte: Map<string, number[]>, peCheie: Map<string, number[]>, shaDoc: Map<number, string | null>, cheie: (nume: string) => string }} Stare */

/** Sha-ul dovedit per document_id din rândurile de manifest: doar stare 'urcat'; contradicție → null (fără dovadă).
 *  @param {Array<{ stare?: string, document_id?: number | null, sha256?: string }> | null | undefined} randuri
 *  @returns {Map<number, string | null>} */
export function shaDovedit(randuri) {
  const m = new Map()
  for (const r of randuri ?? []) {
    if (r?.stare !== 'urcat' || r.document_id == null || !r.sha256) continue
    const v = m.get(r.document_id)
    m.set(r.document_id, v === undefined || v === r.sha256 ? r.sha256 : null)
  }
  return m
}

/** Înregistrează un document în starea de lucru (după o urcare: cu sha-ul lui, care devine dovadă).
 *  @param {Stare} st @param {string} nume @param {number} id @param {string | null} [sha] */
export function adaugaDocument(st, nume, id, sha = null) {
  st.exacte.set(nume, [...(st.exacte.get(nume) ?? []), id])
  const k = st.cheie(nume)
  st.peCheie.set(k, [...(st.peCheie.get(k) ?? []), id])
  if (sha) st.shaDoc.set(id, sha)
}

/** Starea de lucru: documentele existente (fără placeholder-e) pe nume exact și pe cheia aproximativă a apelantului
 *  (cheieNume) + sha-urile dovedite (shaDovedit).
 *  @param {Array<{ id: number, nume_original: string }> | null | undefined} documente @param {Map<number, string | null>} shaDoc
 *  @param {(nume: string) => string} cheie @returns {Stare} */
export function stareIdentitate(documente, shaDoc, cheie) {
  const st = { exacte: new Map(), peCheie: new Map(), shaDoc, cheie }
  for (const d of documente ?? []) adaugaDocument(st, d.nume_original, d.id)
  return st
}

/** Ce se face cu un fișier extras: { deja: id } (același conținut dovedit) sau { nume } (sub ce nume se urcă).
 *  Candidații, în ordine: numele din arhivă, `<prefix>/<nume>`, `<prefix>/<sha8>_<nume>`. Un nume e luat doar dacă e liber;
 *  ocupat de alt conținut sau de unul nedovedit → următorul. Toate ocupate → ultimul (dublură, nu pierdere).
 *  @param {Stare} st @param {string} rel @param {string} prefix @param {string} sha @returns {{ deja: number } | { nume: string }} */
export function alegeNume(st, rel, prefix, sha) {
  const acelasi = (id) => st.shaDoc.get(id) === sha
  const candidati = [rel, `${prefix}/${rel}`, `${prefix}/${sha.slice(0, 8)}_${rel}`]
  for (const nume of candidati) {
    const ex = st.exacte.get(nume) ?? []
    const idEx = ex.find(acelasi)
    if (idEx != null) return { deja: idEx }
    if (ex.length) continue
    const idK = (st.peCheie.get(st.cheie(nume)) ?? []).find(acelasi)   // nume echivalent („X.PDF” / „x.pdf”), același conținut
    if (idK != null) return { deja: idK }
    return { nume }
  }
  return { nume: candidati[candidati.length - 1] }
}

/** La o reluare peste ACEEAȘI intrare de arhivă, rândul ei de manifest rămâne 'urcat' (nu 'deja_in_platforma'): altfel
 *  upsert-ul pe (licitatie_id, arhiva_cheie, cale) ar șterge chiar dovada sha, iar a treia rulare ar urca o dublură.
 *  `urcateAnterior` = rândurile 'urcat' din manifest; true dacă intrarea (arhivaCheie, cale) a fost urcată ca documentId.
 *  @param {Array<{ stare?: string, arhiva_cheie?: string, cale?: string, document_id?: number | null }> | null | undefined} urcateAnterior
 *  @param {string} arhivaCheie @param {string} cale @param {number} documentId */
export function pastreazaUrcat(urcateAnterior, arhivaCheie, cale, documentId) {
  return (urcateAnterior ?? []).some(r => r.stare === 'urcat' && r.arhiva_cheie === arhivaCheie && r.cale === cale && r.document_id === documentId)
}
