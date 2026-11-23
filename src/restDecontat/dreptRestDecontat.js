// restDecontat/dreptRestDecontat.js — dreptul pe „Rest de decontat”, întrebat în BD (fn_rest_decontat_drept, 20270105a: aceeași funcție ca
// RLS-ul vederilor și RPC-urile de confirmare; L19). Modul fără JSX, folosit de banda Execuției (dacă fila apare) și de tab.
import { useEffect, useRef, useState } from 'react'

export const NIVELURI_DREPT = ['citire', 'confirmare', 'documente_baza']

/**
 * useDreptRestDecontat(client, proiectId) → { stare: 'fara_proiect'|'incarcare'|'ok'|'eroare', citire, confirmare, documente_baza, eroare }
 * Eroarea RPC-ului NU devine „fără drept” (L18): banda arată fila, iar tab-ul arată eroarea. L24: răspunsul altui proiect nu se aplică.
 */
export function useDreptRestDecontat(client, proiectId) {
  const pid = proiectId == null || proiectId === '' ? null : Number(proiectId)
  const valid = client != null && pid != null && Number.isInteger(pid) && pid > 0
  const [d, setD] = useState({ stare: valid ? 'incarcare' : 'fara_proiect' })
  const gen = useRef(0)
  useEffect(() => {
    const g = ++gen.current
    if (!valid) { setD({ stare: 'fara_proiect' }); return }
    setD({ stare: 'incarcare' })
    ;(async () => {
      try {
        const r = await Promise.all(NIVELURI_DREPT.map(n => client.rpc('fn_rest_decontat_drept', { p_proiect: pid, p_nivel: n })))
        if (g !== gen.current) return
        const e = r.find(x => x?.error)
        if (e) { setD({ stare: 'eroare', eroare: e.error.message || String(e.error) }); return }
        setD({ stare: 'ok', ...Object.fromEntries(NIVELURI_DREPT.map((n, i) => [n, r[i]?.data === true])) })
      } catch (e) { if (g === gen.current) setD({ stare: 'eroare', eroare: e?.message || String(e) }) }
    })()
  }, [pid, client, valid])
  return d
}

/** fila apare când contul poate citi SAU când întrebarea a eșuat (tab-ul arată eroarea; fără date — vederile filtrează oricum în BD) */
export const filaVizibila = d => d?.stare === 'ok' ? d.citire === true : d?.stare === 'eroare'
