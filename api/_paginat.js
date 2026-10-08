// paginat.mjs — toate rândurile unei interogări PostgREST, pe pagini stabile (ORDER BY id), pentru inventarele motorului de
// import SEAP (audit Jakarinos 07.10.2026, #21): o licitație peste plafonul de rânduri al serverului (implicit 1000 la
// Supabase) primea un inventar TRUNCHIAT tăcut, tratat ca complet — dubluri, dovezi sha lipsă. Plus fail-closed: o eroare
// de citire NU mai devine „niciun document” (care ar fi re-adus totul); apelantul o vede și se oprește.
// Folosit de worker/ofertare/seap.ts, edge ofertare-seap-import / ofertare-seap-veghe și /api/seap-import (copia byte cu byte
// api/_paginat.js — funcțiile Vercel nu importă din afara api/).

/** @param {(de: number, la: number) => PromiseLike<{ data: unknown[] | null, error: { message: string } | null }>} fa
 *    construiește interogarea pentru intervalul [de, la] (cu .order(...).range(de, la)) și o execută
 *  @param {number} [pagina] @param {number} [maxPagini]
 *  @returns {Promise<{ data: any[] | null, error: { message: string } | null }>}
 *  Robust la plafonul serverului (max_rows), oricare ar fi el: următoarea pagină începe după rândurile PRIMITE (nu după
 *  cele cerute), iar sfârșitul e o pagină GOALĂ — o pagină scurtă poate fi doar plafonul serverului, nu finalul listei. */
export async function toatePaginile(fa, pagina = 1000, maxPagini = 100) {
  const tot = []
  for (let p = 0; p < maxPagini; p++) {
    const { data, error } = await fa(tot.length, tot.length + pagina - 1)
    if (error) return { data: null, error }
    if (!Array.isArray(data)) return { data: null, error: { message: 'interogare fără rânduri (răspuns neașteptat)' } }
    if (!data.length) return { data: tot, error: null }
    if (data.length > pagina) return { data: null, error: { message: `pagină cu ${data.length} rânduri peste cele ${pagina} cerute — intervalul a fost ignorat, oprit` } }
    tot.push(...data)
  }
  return { data: null, error: { message: `inventar de cel puțin ${tot.length} rânduri în ${maxPagini} pagini — oprit, nu se lucrează pe o listă trunchiată` } }
}
