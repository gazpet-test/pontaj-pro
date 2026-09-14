// ════════════════════════════════════════════════════════════════
// iscRte.js — domeniile ISC ale RTE (Procedura ISC 31.08.2016), FĂRĂ React, FĂRĂ Supabase.
//
// Problema (Domnești, 14.09.2026): în hr_autorizatii.domenii scrie liber — „8.4 (D) SI 8.5", „8.4T",
// „1.1 SI 9.1", „Construcții civile", iar la autorizațiile vechi MLPAT „I", „IX", „II.3". Motorul de
// acoperire a dat „gol" la RTE pe alimentare cu apă cu motivul „lipsește domeniul apă-canal", deși
// nomenclatorul spune că alimentarea cu apă e 9.1 (edilitare) și doi oameni au 9.1 în listă.
// Aici se normalizează la coduri din nomenclator; aceeași funcție rulează și în edge function
// (copie identică în supabase/functions/ofertare-acoperire/index.ts — ține-le sincron).
// ════════════════════════════════════════════════════════════════

// Schema VECHE (MLPAT, cifre romane) — NU se echivalează automat cu cea din 2016: numerotarea nu e
// 1:1 și autorizațiile alea sunt de regulă expirate. Se păstrează ca atare, cu steag `vechi`.
const ROMAN = /^(I|II|III|IV|V|VI|VII|VIII|IX|X|XI)(\.\d+)?$/i

// Etichete în cuvinte → cod (doar cele fără ambiguitate).
const ETICHETE = [
  [/constructii civile|cladir|hala|civile/, '1.1'],
  [/drum|rutier|strazi/, '2.1'],
  [/pod(uri)?\b/, '2.3'],
  [/hidrotehnic/, '5.1'],
  [/instalatii electrice/, '6.1'],
  [/instalatii (termice|sanitare)|ventila|climatiz/, '6.2'],
  [/instalatii( de utilizare)? gaze/, '6.3'],
  [/retele electrice/, '8.1'],
  [/retele (termice|sanitare)|apa.?canal|alimentare cu apa|canalizare/, '8.2'],
  [/telecomunicati/, '8.3'],
  [/retele (de )?gaze|distributie gaze/, '8.4D'],
  [/transport gaze/, '8.4T'],
  [/petrolier|titei/, '8.5'],
  [/edilitar|gospodarie comunala/, '9.1'],
  [/fundatii/, '11.1'],
]

const fara = s => String(s || '').toLowerCase().replace(/[ăâ]/g, 'a').replace(/î/g, 'i').replace(/[șş]/g, 's').replace(/[țţ]/g, 't')

/** Un singur fragment („8.4 (D)", „8.4T", „9.1", „Construcții civile", „IX") → listă de coduri. */
export function normalizeazaDomeniuISC(fragment) {
  const t = fara(fragment).trim()
  if (!t) return { coduri: [], vechi: [] }
  const coduri = [], vechi = []
  // 8.4 cu varianta: „8.4 (D)", „8.4(T)", „8.4T", „8.4 D", „8.4-T"
  const re84 = /\b8\.4\s*[(\-]?\s*([dt])\s*\)?/gi
  let m
  while ((m = re84.exec(t))) coduri.push('8.4' + m[1].toUpperCase())
  // coduri numerice n.n (fără 8.4 fără variantă, care rămâne „8.4" = nespecificat)
  const reCod = /\b(1\.[1-4]|2\.[1-4]|3\.1|4\.[12]|5\.1|6\.[1-3]|7\.1|8\.[1-5]|9\.1|11\.1)\b(?!\s*[(\-]?\s*[dt])/gi
  while ((m = reCod.exec(t))) { const c = m[1]; if (!(c === '8.4' && coduri.some(x => x.startsWith('8.4')))) coduri.push(c) }
  // cifre romane = schema veche MLPAT
  for (const p of t.split(/[,;\/]|\s+si\s+|\s+&\s+/)) { const s = p.trim().toUpperCase(); if (ROMAN.test(s)) vechi.push(s) }
  // etichete în cuvinte, doar dacă n-a ieșit niciun cod din text
  if (!coduri.length) for (const [re, cod] of ETICHETE) if (re.test(t)) { coduri.push(cod); break }
  return { coduri: [...new Set(coduri)], vechi: [...new Set(vechi)] }
}

/** Lista brută din hr_autorizatii.domenii → { coduri: ['8.4D','8.5'], vechi: ['IX'] }. */
export function normalizeazaDomeniiISC(lista) {
  const out = { coduri: [], vechi: [] }
  for (const f of Array.isArray(lista) ? lista : (lista ? [lista] : [])) {
    const r = normalizeazaDomeniuISC(f)
    out.coduri.push(...r.coduri); out.vechi.push(...r.vechi)
  }
  out.coduri = [...new Set(out.coduri)]; out.vechi = [...new Set(out.vechi)]
  return out
}

/** Codul cerut e acoperit de lista unei autorizații? „8.4" (fără variantă) e acoperit de 8.4D sau 8.4T. */
export function acoperaDomeniul(codCerut, coduriAutorizatie) {
  const c = String(codCerut || '').toUpperCase().replace(/\s/g, '')
  const L = (coduriAutorizatie || []).map(x => String(x).toUpperCase())
  if (!c) return false
  if (L.includes(c)) return true
  if (c === '8.4') return L.some(x => x === '8.4D' || x === '8.4T')
  return false
}

/** Domeniile sugerate de textul lucrării, după cuvintele-cheie din nomenclator (isc_rte_domenii). */
export function domeniiDinText(text, nomenclator) {
  const t = fara(text)
  const out = []
  for (const d of nomenclator || []) {
    const kw = Array.isArray(d.cuvinte_cheie_lucrari) ? d.cuvinte_cheie_lucrari : []
    if (kw.some(k => k && t.includes(fara(k)))) out.push(d.cod)
  }
  return out
}
