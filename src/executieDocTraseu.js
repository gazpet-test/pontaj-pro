// TKT-2026-0372 — Execuție: fișierul KML / KMZ cu traseul conductei, încărcat ca document al lucrării (varianta A: fără hartă).
// Documentele lucrării = executie_documente_contract + bucket-ul executie-contracte (calea <proiect>/<tip>/<fișier>).
// Lista de extensii era doar în client (accept=…); aici se adaugă .kml / .kmz, cu tipurile MIME corecte (browserul dă adesea
// un tip gol pentru ele), și tipul de document „Traseu (KML / KMZ)”.

export const TIP_TRASEU = 'traseu_kml'
export const MIME_KML = 'application/vnd.google-earth.kml+xml'
export const MIME_KMZ = 'application/vnd.google-earth.kmz'
export const ACCEPT_DOC_CONTRACT = `.pdf,.doc,.docx,.jpg,.jpeg,.png,.xls,.xlsx,.kml,.kmz,${MIME_KML},${MIME_KMZ}`

const ext = nume => { const m = /\.([A-Za-z0-9]{1,8})$/.exec(String(nume || '').trim()); return m ? m[1].toLowerCase() : '' }

// tipul MIME după extensie; null = nu e fișier de traseu
export function mimeTraseu(nume) {
  const e = ext(nume)
  return e === 'kml' ? MIME_KML : e === 'kmz' ? MIME_KMZ : null
}
export const esteFisierTraseu = nume => mimeTraseu(nume) != null

// Tipul de document de folosit + eventual mesajul: un fișier KML / KMZ merge mereu la „Traseu”; la „Traseu” intră doar KML / KMZ.
// → { tip, eroare?, schimbat? }
export function tipPentruFisier(tipAles, nume) {
  if (esteFisierTraseu(nume)) return { tip: TIP_TRASEU, schimbat: tipAles !== TIP_TRASEU }
  if (tipAles === TIP_TRASEU) return { tip: tipAles, eroare: 'La „Traseu (KML / KMZ)” se încarcă doar fișiere .kml sau .kmz.' }
  return { tip: tipAles }
}

// Conținutul se potrivește cu extensia? KMZ = arhivă zip („PK\x03\x04”); KML = XML cu elementul <kml (după BOM / declarația XML).
// primii octeți ai fișierului (Uint8Array) → null = în regulă, altfel mesajul
export function verificaInceputTraseu(nume, octeti) {
  const e = ext(nume)
  const b = octeti instanceof Uint8Array ? octeti : new Uint8Array(0)
  if (e === 'kmz') {
    return b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04 ? null
      : 'Fișierul .kmz nu pare o arhivă KMZ validă (verificați exportul din Google Earth).'
  }
  if (e === 'kml') {
    const BOM = String.fromCharCode(0xFEFF)
    let text = new TextDecoder('utf-8', { fatal: false }).decode(b)
    if (text.startsWith(BOM)) text = text.slice(1)
    return /<kml[\s>:]/i.test(text) ? null : 'Fișierul .kml nu pare un fișier KML (lipsește elementul <kml>).'
  }
  return null
}

// Refuzul Storage pentru tipul de fișier (bucket cu listă de tipuri permise) / pentru mărime — deterministe, cu mesaj clar.
export function clasificaEroareUpload(error) {
  if (!error) return null
  const cod = String(error.statusCode ?? error.status ?? '')
  const text = String(error.message || error.error || '')
  if (cod === '415' || /mime type .*not supported|invalid_mime_type/i.test(text)) return 'tip'
  if (cod === '413' || /payload too large|maximum allowed size|exceeded the maximum/i.test(text)) return 'marime'
  return null
}

// INSERT-ul rândului a fost refuzat determinist (constrângere / valoare invalidă)? Doar atunci fișierul abia urcat se scoate (L05:
// la rețea / timeout / 5xx starea e necunoscută și fișierul rămâne).
export const refuzDeterminist = error => !!error && /^(23514|23502|22P02|23503|PGRST204)$/.test(String(error.code || ''))
