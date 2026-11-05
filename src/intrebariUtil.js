// ❓ Întreabă echipa — utilitare pure (migrarea 20261105a). Testate în intrebariUtil.test.js.
export const MODUL_INTREBARI = 'intrebari_tehnice'
export const MAX_ATASAMENTE = 5
export const MAX_MB = 25
export const MIME_OK = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
const EXT = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

/** Owner sau cheia de modul 'intrebari_tehnice' (ca hasModuleAccess din App.jsx). */
export function poateIntreba(profile) {
  if (!profile) return false
  if (profile.is_owner === true) return true
  return (profile.module_access || []).some(m => m === MODUL_INTREBARI || String(m).startsWith(MODUL_INTREBARI + '.'))
}

/** Calea în bucket: <uid>/<uuid>.<ext> — exact forma acceptată de triggerul din BD. */
export function caleAtasament(uid, mime, uuid) {
  const ext = EXT[mime]
  if (!ext || !uid) return null
  return `${uid}/${uuid}.${ext}`
}

/** null dacă fișierul e acceptat, altfel motivul. */
export function verificaFisier(f) {
  if (!MIME_OK.includes(f?.type)) return 'doar PDF sau imagini (JPG, PNG, WEBP)'
  if (f.size > MAX_MB * 1024 * 1024) return `peste ${MAX_MB} MB`
  return null
}

export const ETICHETA_STARE = {
  noua: { t: 'În coadă', c: '#D29922' },
  in_lucru: { t: 'Se analizează…', c: '#1F6FEB' },
  raspuns: { t: 'Răspuns primit', c: '#2EA043' },
  eroare: { t: 'Fără răspuns', c: '#F85149' },
}

// Markdown minimal → blocuri (fără HTML: textul se afișează ca text, React îl escapează). Suportă #/##/###, liste -, *, 1.,
// --- și **bold** / _italic_ / *italic* / `cod` în rând.
export function blocuriMd(md) {
  const out = []; let para = []; let lista = null
  const inchidePara = () => { if (para.length) { out.push({ tip: 'p', text: para.join(' ') }); para = [] } }
  const inchideLista = () => { if (lista) { out.push(lista); lista = null } }
  for (const linie of String(md ?? '').replace(/\r/g, '').split('\n')) {
    const l = linie.trim()
    let m
    if (!l) { inchidePara(); inchideLista(); continue }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(l)) { inchidePara(); inchideLista(); out.push({ tip: 'hr' }); continue }
    if ((m = l.match(/^(#{1,4})\s+(.*)$/))) { inchidePara(); inchideLista(); out.push({ tip: 'h', nivel: m[1].length, text: m[2] }); continue }
    if ((m = l.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/))) {
      inchidePara()
      const ordonata = /^\d/.test(l)
      if (!lista || lista.ordonata !== ordonata) { inchideLista(); lista = { tip: 'lista', ordonata, elemente: [] } }
      lista.elemente.push(m[1]); continue
    }
    inchideLista(); para.push(l)
  }
  inchidePara(); inchideLista()
  return out
}

/** Bucăți de rând: [{t:'text'|'b'|'i'|'cod', v}] */
export function bucatiRand(text) {
  const out = []; const re = /(\*\*[^*]+\*\*|`[^`]+`|_[^_]+_|\*[^*]+\*)/g
  let i = 0, m
  const s = String(text ?? '')
  while ((m = re.exec(s))) {
    if (m.index > i) out.push({ t: 'text', v: s.slice(i, m.index) })
    const x = m[0]
    if (x.startsWith('**')) out.push({ t: 'b', v: x.slice(2, -2) })
    else if (x.startsWith('`')) out.push({ t: 'cod', v: x.slice(1, -1) })
    else out.push({ t: 'i', v: x.slice(1, -1) })
    i = m.index + x.length
  }
  if (i < s.length) out.push({ t: 'text', v: s.slice(i) })
  return out
}
