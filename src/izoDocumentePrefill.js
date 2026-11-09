import { CHEI_ANTET, COLOANE, randGol, parseNumar, izolatieDinText, serieCanon } from './izoDocumenteLogica.js'

const text = v => typeof v === 'string' || typeof v === 'number' ? String(v) : ''
const gol = v => v == null || String(v).trim() === ''

// ── garda „serie repetată” (aviz COMTECH P 0160, 27.10.2026: Nr.Sarja citit ca număr de țeavă) ──
export const MESAJ_SERIE_REPETATA = 'Numărul țevii se repetă (posibil șarjă citită ca număr de țeavă) – verificați coloana'
/**
 * Seriile care apar de mai multe ori pe rândurile-piesă (cantitate goală sau 1) ale unui aviz de țeavă, după seria canonică.
 * Întoarce [{ serie, randuri:[poziția 1..N în propunere] }]. Listele de curbe nu intră: acolo aceeași serie + șarjă cu alt unghi e legitimă.
 */
export function seriiRepetateOCR(raspuns) {
  if (['lista_curbe', 'lista_ambalare_curbe'].includes(raspuns?.sablon)) return []
  const pe = new Map()
  ;(raspuns?.randuri || []).forEach((r, i) => {
    const q = parseNumar(r?.cantitate), c = serieCanon(r?.serie)
    if (!c || (q != null && q !== 1)) return
    pe.set(c, [...(pe.get(c) || []), i + 1])
  })
  return [...pe].filter(([, randuri]) => randuri.length > 1).map(([serie, randuri]) => ({ serie, randuri }))
}
export const textSeriiRepetate = rep => `${MESAJ_SERIE_REPETATA}: ${rep.map(x => `${x.serie} (rândurile ${x.randuri.join(', ')})`).join('; ')}.`

// Câmpurile de kg se citesc cu „mii: true” (123.456 = 123456), deci numărul AI nu se scrie cu punct: întreg → cifre,
// 1–2 zecimale → virgulă; 3+ zecimale = ambiguu → câmp gol + avertisment, fără rotunjire tacită (Jak E9 r1 P1).
// orice câmp *_kg (rânduri + totaluri: total_kg, total_net_kg, total_brut_kg …) — Jak E9 r2 P1
export const esteKg = k => /_kg$/.test(k)
export function textKg(v) {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? parseNumar(v) : null
  if (n == null || !Number.isFinite(n)) return { val:'', ok:v == null || String(v).trim() === '' }
  if (Number.isInteger(n)) return { val:String(n), ok:true }
  const z = String(n).split('.')[1] || ''
  return z.length <= 2 ? { val:String(n).replace('.', ','), ok:true } : { val:'', ok:false }
}
export const cantitateMultiplaOCR = r => parseNumar(r?.cantitate) > 1
export function avertismenteOCR(raspuns) {
  const rep = seriiRepetateOCR(raspuns)
  // garda serie repetată prima: e singura care cere confirmare la aplicare
  return [...new Set([...(rep.length ? [textSeriiRepetate(rep)] : []),
    ...(Array.isArray(raspuns?.avertismente) ? raspuns.avertismente.filter(x => typeof x === 'string') : []),
    ...(raspuns?.randuri || []).flatMap((r, i) => cantitateMultiplaOCR(r)
      ? [`Rândul ${i + 1}: rand cu cantitate ${text(r.cantitate)} fara serii individuale - introdu manual bucatile.`] : [])])]
}

// OCR furnizează numai date: identitatea, măsurătorile și deciziile rămân ale gestionarului.
export function aplicaPropunereOCR(editorDoc, raspuns, { mod = 'completeaza' } = {}) {
  const sablon = editorDoc.sablon, antet = { ...editorDoc.antet }
  const chei = [...CHEI_ANTET.comune, ...(CHEI_ANTET[sablon] || [])]
  const propus = { ...raspuns.antet }
  const totaluri = raspuns.totaluri_tiparite || {}
  if (totaluri.total_metri != null) propus.total_m = totaluri.total_metri
  if (totaluri.total_kg != null) propus.total_kg = totaluri.total_kg
  const avKg = []
  const valoare = (k, v, unde) => {
    if (k === 'izolatie') return izolatieDinText(text(v)) || ''
    if (!esteKg(k)) return text(v)
    const { val, ok } = textKg(v)
    if (!ok) avKg.push(`${unde}: valoarea de kg „${text(v)}” e ambiguă (3+ zecimale) — introdu-o manual de pe document.`)
    return val
  }
  for (const k of chei) if (Object.hasOwn(propus, k) && (mod === 'inlocuieste' || gol(antet[k]))) antet[k] = valoare(k, propus[k], 'Antet')
  const existente = mod === 'inlocuieste' ? [] : editorDoc.randuri.map(r => ({ ...r }))
  const cheiRand = [...COLOANE[sablon].map(([k]) => k), 'observatie']
  const ocupate = new Set(editorDoc.randuri.map(r => r._k))
  let nr = Math.max(0, ...existente.map(r => parseNumar(r.nr_crt) || 0)), secventa = 0
  const randuri = (raspuns.randuri || []).filter(r => !cantitateMultiplaOCR(r)).map(r => {
    const nou = randGol(sablon, ++nr)
    for (const k of cheiRand) if (k !== 'nr_crt' && Object.hasOwn(r, k)) nou[k] = valoare(k, r[k], `Rândul ${nr}`)
    nou.decizie = ''; nou.motiv = ''; nou.lungime_masurata = ''; nou.unghi_masurat = ''
    let k
    do { k = `ocr_${++secventa}` } while (ocupate.has(k))
    ocupate.add(k)
    return { ...nou, _k:k }
  })
  return { ...editorDoc, antet, randuri:[...existente, ...randuri], ocrAvertismente:[...avertismenteOCR(raspuns), ...avKg] }
}
