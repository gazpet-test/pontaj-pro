// restDecontat/dreptRestDecontat.js — dreptul pe „Rest de decontat”, întrebat în BD (fn_rest_decontat_drept, 20270105a: aceeași funcție ca
// RLS-ul vederilor și RPC-urile de confirmare; L19). Modul fără JSX, folosit de banda Execuției (dacă fila apare) și de tab.
import { useCallback, useEffect, useRef, useState } from 'react'

export const NIVELURI_DREPT = ['citire', 'confirmare', 'documente_baza']

/**
 * useDreptRestDecontat(client, proiectId) → { stare: 'fara_proiect'|'incarcare'|'ok'|'eroare', citire, confirmare, documente_baza, eroare, reincearca }
 * Eroarea RPC-ului NU devine „fără drept” (L18) și NICI drept: banda nu arată fila, ci un mesaj separat cu „reîncearcă”; tab-ul (un link vechi
 * cu tab=rest_decontat) arată doar eroarea. L24: răspunsul altui proiect / al unei montări închise nu se aplică; „reîncearcă” = reloadKey explicit.
 */
export function useDreptRestDecontat(client, proiectId) {
  const pid = proiectId == null || proiectId === '' ? null : Number(proiectId)
  const valid = client != null && pid != null && Number.isInteger(pid) && pid > 0
  const [d, setD] = useState({ stare: valid ? 'incarcare' : 'fara_proiect' })
  const [reload, setReload] = useState(0)
  const gen = useRef(0)
  useEffect(() => {
    const g = ++gen.current
    if (!valid) { setD({ stare: 'fara_proiect' }); return undefined }
    setD({ stare: 'incarcare' })
    ;(async () => {
      try {
        const r = await Promise.all(NIVELURI_DREPT.map(n => client.rpc('fn_rest_decontat_drept', { p_proiect: pid, p_nivel: n })))
        if (g !== gen.current) return
        const e = r.find(x => x?.error)
        if (e) { setD({ stare: 'eroare', eroare: e.error.message || String(e.error) }); return }
        // doar `true` explicit e drept (null / lipsă = fără drept, nu „probabil da”)
        setD({ stare: 'ok', ...Object.fromEntries(NIVELURI_DREPT.map((n, i) => [n, r[i]?.data === true])) })
      } catch (e) { if (g === gen.current) setD({ stare: 'eroare', eroare: e?.message || String(e) }) }
    })()
    // demontare / alt proiect: generația avansează, răspunsul în zbor nu mai scrie starea
    return () => { gen.current++ }
  }, [pid, client, valid, reload])
  const reincearca = useCallback(() => setReload(x => x + 1), [])
  return { ...d, reincearca }
}

/** fila apare DOAR când BD-ul a răspuns explicit că contul poate citi; eroarea întrebării = mesaj separat (dreptEroare), nu filă */
export const filaVizibila = d => d?.stare === 'ok' && d.citire === true
/** eroarea întrebării despre drept (pentru mesajul separat din bandă); altfel null */
export const dreptEroare = d => (d?.stare === 'eroare' ? (d.eroare || 'eroare necunoscută') : null)
