import { CHEI_ANTET, COLOANE, randGol, parseNumar } from './izoDocumenteLogica.js'

const text = v => typeof v === 'string' || typeof v === 'number' ? String(v) : ''
const gol = v => v == null || String(v).trim() === ''
export const cantitateMultiplaOCR = r => parseNumar(r?.cantitate) > 1
export function avertismenteOCR(raspuns) {
  return [...(Array.isArray(raspuns?.avertismente) ? raspuns.avertismente.filter(x => typeof x === 'string') : []),
    ...(raspuns?.randuri || []).flatMap((r, i) => cantitateMultiplaOCR(r)
      ? [`Rândul ${i + 1}: rand cu cantitate ${text(r.cantitate)} fara serii individuale - introdu manual bucatile.`] : [])]
}

// OCR furnizează numai date: identitatea, măsurătorile și deciziile rămân ale gestionarului.
export function aplicaPropunereOCR(editorDoc, raspuns, { mod = 'completeaza' } = {}) {
  const sablon = editorDoc.sablon, antet = { ...editorDoc.antet }
  const chei = [...CHEI_ANTET.comune, ...(CHEI_ANTET[sablon] || [])]
  const propus = { ...raspuns.antet }
  const totaluri = raspuns.totaluri_tiparite || {}
  if (totaluri.total_metri != null) propus.total_m = totaluri.total_metri
  if (totaluri.total_kg != null) propus.total_kg = totaluri.total_kg
  for (const k of chei) if (Object.hasOwn(propus, k) && (mod === 'inlocuieste' || gol(antet[k]))) antet[k] = text(propus[k])
  const existente = mod === 'inlocuieste' ? [] : editorDoc.randuri.map(r => ({ ...r }))
  const cheiRand = [...COLOANE[sablon].map(([k]) => k), 'observatie']
  const ocupate = new Set(editorDoc.randuri.map(r => r._k))
  let nr = Math.max(0, ...existente.map(r => parseNumar(r.nr_crt) || 0)), secventa = 0
  const randuri = (raspuns.randuri || []).filter(r => !cantitateMultiplaOCR(r)).map(r => {
    const nou = randGol(sablon, ++nr)
    for (const k of cheiRand) if (k !== 'nr_crt' && Object.hasOwn(r, k)) nou[k] = text(r[k])
    nou.decizie = ''; nou.motiv = ''; nou.lungime_masurata = ''; nou.unghi_masurat = ''
    let k
    do { k = `ocr_${++secventa}` } while (ocupate.has(k))
    ocupate.add(k)
    return { ...nou, _k:k }
  })
  return { ...editorDoc, antet, randuri:[...existente, ...randuri], ocrAvertismente:avertismenteOCR(raspuns) }
}
