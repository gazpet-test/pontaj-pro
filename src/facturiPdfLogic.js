// facturiPdfLogic.js — „Atașează PDF-uri existente” (Financiar → Facturi emise), 13.10.2026.
// Facturile emise în afara platformei au rândul în facturi_emise, dar fără pdf_path; PDF-urile stau pe NAS
// (/Volume1/Facturi_Emise/Facturi <an>/, montat în containerul facturi-sync ca /data/facturi/Facturi <an>/).
// Potrivire DOAR după numărul din numele fișierului; orice neclaritate = sărit, nu ghicit.

// Numerele GAZ din numele fișierului: „SERIA GAZ -332”, „GAZ 351-CFI”, „GAZ-410”, „GAZ 368_…”.
export function numereDinNume(nume) {
  const out = new Set()
  for (const m of String(nume || '').matchAll(/GAZ[\s_]*-?\s*(\d{3,4})(?!\d)/gi)) out.add(Number(m[1]))
  return [...out]
}

export const estePdf = (f) => /\.pdf$/i.test(f?.name || '') || f?.type === 'application/pdf'

// fisiere: [{name, size}]; facturi: rânduri facturi_emise (id, nr, nr_complet, serie, pdf_path, …).
// Întoarce un rând per fișier PDF: {fisier, stare: 'ok'|'nepotrivit'|'ambiguu'|'are_pdf', factura?, motiv}.
export function potriveste(fisiere, facturi) {
  const pdfuri = (fisiere || []).filter(estePdf)
  const gaz = (facturi || []).filter(f => (f.serie || 'GAZ') === 'GAZ')
  const peNr = new Map()
  for (const f of gaz) { const l = peNr.get(Number(f.nr)) || []; l.push(f); peNr.set(Number(f.nr), l) }
  const rez = pdfuri.map(fisier => {
    const nr = numereDinNume(fisier.name)
    if (nr.length === 0) return { fisier, stare: 'nepotrivit', motiv: 'nu are număr GAZ în nume' }
    if (nr.length > 1) return { fisier, stare: 'ambiguu', motiv: `mai multe numere în nume (${nr.join(', ')})` }
    const cand = peNr.get(nr[0]) || []
    if (!cand.length) return { fisier, stare: 'nepotrivit', motiv: `GAZ-${nr[0]} nu există în ERP` }
    if (cand.length > 1) return { fisier, stare: 'ambiguu', motiv: `GAZ-${nr[0]} apare de ${cand.length} ori în ERP` }
    const factura = cand[0]
    if (factura.pdf_path) return { fisier, stare: 'are_pdf', factura, motiv: `GAZ-${nr[0]} are deja PDF` }
    return { fisier, stare: 'ok', factura, motiv: '' }
  })
  // Două fișiere pe aceeași factură → ambele ambigue (alegi tu fișierul corect și reiei).
  const numar = new Map()
  for (const r of rez) if (r.stare === 'ok') numar.set(r.factura.id, (numar.get(r.factura.id) || 0) + 1)
  return rez.map(r => r.stare === 'ok' && numar.get(r.factura.id) > 1
    ? { ...r, stare: 'ambiguu', motiv: `mai multe fișiere pentru ${r.factura.nr_complet || 'GAZ-' + r.factura.nr}` }
    : r)
}

// Cheie Storage: <an>/<GAZ-nnn>_<nume ASCII>.pdf (fără diacritice / spații).
export function cheieStorage(factura, numeFisier) {
  const an = String(factura?.an || String(factura?.data || '').slice(0, 4) || new Date().getFullYear())
  const baza = String(numeFisier || 'factura').replace(/\.pdf$/i, '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/_+/g, '_').replace(/^[_.]+|[_.]+$/g, '').slice(0, 120) || 'factura'
  const nr = factura?.nr_complet || `GAZ-${factura?.nr}`
  return `${an}/${nr}_${baza}.pdf`
}

// Calea de pe NAS, așa cum o vede containerul facturi-sync (același format ca facturile deja sincronizate).
export function caleNas(factura, numeFisier) {
  const an = String(factura?.an || String(factura?.data || '').slice(0, 4))
  return `/data/facturi/Facturi ${an}/${numeFisier}`
}

// Numele trebuie să fie doar nume de fișier (fără căi / caractere de control).
export const numeSigur = (n) => typeof n === 'string' && n.length > 4 && n.length <= 250 && !/[\/\\\u0000-\u001f]/.test(n)

export async function sha256Hex(buf) {
  const h = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('')
}
