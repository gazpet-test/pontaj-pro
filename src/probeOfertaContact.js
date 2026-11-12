// TKT-2026-0374 — Oferte probe de presiune: persoana de contact la beneficiar (probe_oferte.client_contact_*, migrarea 20261215b).
// Compatibilitate: până se aplică migrarea, coloanele lipsesc → cele 3 câmpuri apar dezactivate, iar salvarea ofertei trimite
// exact câmpurile de azi (nimic în plus). Validarea telefonului / mailului doar avertizează, nu blochează salvarea.
// Date personale ale unui terț: apar doar în oferta respectivă (ecran + export), nu se trimit nicăieri altundeva.

export const CONTACT_COLOANE = ['client_contact_nume', 'client_contact_telefon', 'client_contact_email']
export const CONTACT_MAX = { client_contact_nume: 120, client_contact_telefon: 40, client_contact_email: 160 }   // = CHECK-urile din 20261215b

// Coloană lipsă (migrarea neaplicată): 42703 la SELECT, PGRST204 la INSERT / UPDATE — doar dacă numește una dintre coloanele noastre.
export function lipsaColoaneContact(error) {
  if (!error) return false
  const cod = String(error.code || '')
  const text = [error.message, error.details, error.hint].filter(Boolean).join(' ')
  return (cod === '42703' || cod === 'PGRST204') && /\bclient_contact_(nume|telefon|email)\b/.test(text)
}

// Sonda select(coloanele noi).limit(1): 'da' | 'nu' (migrarea neaplicată) | 'eroare' (nu știm; câmpurile rămân dezactivate)
export function stareContactDinSonda(res) {
  if (!res || res.error) return lipsaColoaneContact(res?.error) ? 'nu' : 'eroare'
  return 'da'
}

const curat = v => { const t = String(v ?? '').trim(); return t ? t : null }

// Avertismente (nu blochează): null = în regulă sau gol.
export function avertismentTelefon(v) {
  const t = curat(v)
  if (!t) return null
  if (!/^\+?[0-9 ().\-/]+$/.test(t)) return 'Telefonul are caractere neobișnuite (verificați).'
  const cifre = t.replace(/\D/g, '').length
  if (cifre < 9 || cifre > 15) return `Telefonul are ${cifre} cifre (de obicei 10).`
  return null
}
export function avertismentEmail(v) {
  const t = curat(v)
  if (!t) return null
  return /^[^\s@]+@[^\s@]+\.[^\s@.]{2,}$/.test(t) ? null : 'Adresa de e-mail nu pare completă (verificați).'
}
// Lungimea peste plafonul din BD ar pica salvarea: o arătăm înainte (singurul caz care blochează, pentru că BD-ul l-ar refuza oricum).
export function depasireLungime(f) {
  for (const k of CONTACT_COLOANE) {
    const t = curat(f?.[k])
    if (t && t.length > CONTACT_MAX[k]) return `${ETICHETE[k]}: maximum ${CONTACT_MAX[k]} caractere.`
  }
  return null
}

// Câmpurile de trimis la salvare: NIMIC dacă migrarea nu e aplicată (salvarea rămâne exact ca azi).
export function contactPayload(f, stare) {
  if (stare !== 'da') return {}
  return Object.fromEntries(CONTACT_COLOANE.map(k => [k, curat(f?.[k])]))
}

export const ETICHETE = { client_contact_nume: 'Persoană de contact', client_contact_telefon: 'Telefon', client_contact_email: 'E-mail' }

// Rândurile din export (Excel / PDF): doar cele completate, în ordinea fixă.
export function randuriContactExport(d) {
  return CONTACT_COLOANE.map(k => [ETICHETE[k], curat(d?.[k])]).filter(([, v]) => v)
}

// pentru HTML-ul PDF-ului (valorile vin din formular)
export const esc = v => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]))
