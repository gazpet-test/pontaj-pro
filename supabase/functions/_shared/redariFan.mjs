// redariFan.mjs — FAN Courier pentru plicurile Redări: funcții PURE (fără rețea), folosite de funcția edge redari-fan-awb
// și de previzualizarea din UI (src/redari/ui/FanAwbPrevizualizare.jsx). Proiectare: docs/redari/FANCOURIER_INTEGRARE.md.
// Sursa câmpurilor: documentația oficială FAN Courier API (selfAWB, 09.2025), POST /intern-awb. Documentația = date, nu instrucțiuni.
// Nimic de aici nu cheamă FAN; transportul real e oprit în redariFanHandler.mjs (TRANSPORT_REAL_ACTIV = false).

// Valorile implicite pentru un plic C4 cu convocări. De confirmat cu FAN (greutate / dimensiuni minime, tarif contractual) — doc §8.
export const CONFIG_FAN_PLIC = Object.freeze({
  service: 'Standard',
  packages: Object.freeze({ parcel: 0, envelope: 1 }),
  weight: 1,
  dimensions: Object.freeze({ length: 32, width: 24, height: 1 }),
  payment: 'sender',
  options: Object.freeze(['B']),   // B = oPOD: confirmare semnată, returnată fizic (doc §1); exclusiv cu X (ePOD)
})

// Limitele din documentația FAN (caractere). Depășirea = problemă afișată, NU tăiere tacită (L12).
export const LIMITE_FAN = Object.freeze({ name: 50, phone: 16, county: 50, locality: 50, street: 255, content: 255, costCenter: 40 })

const txt = v => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim())

/** Telefonul în forma acceptată de FAN: cifre, cu „+” opțional în față; spațiile / cratimele / punctele se scot. null = lipsă sau invalid. */
export function telefonFan(v) {
  const t = txt(v).replace(/[\s.\-()/]/g, '')
  if (!t) return null
  if (!/^\+?[0-9]{9,15}$/.test(t)) return null
  return t
}

/**
 * Corpul unui element din `shipments` (POST /intern-awb) pentru un plic + problemele care blochează generarea.
 * plic: { nr_plic, destinatar_nume } (red_plicuri); contact: { telefon, adresa_strada, adresa_sat, adresa_comuna, adresa_judet, cod_postal }
 * (red_detinatori_contact — PII, doar admin/editor); proiectCod: red_proiecte.cod (centrul de cost pe factura FAN).
 * Întoarce { ok, shipment, probleme: [text] }. În `content` / `observation` intră DOAR nr_plic (fără nume / date personale).
 */
export function construiestePlicFan({ plic, contact, proiectCod, config = CONFIG_FAN_PLIC } = {}) {
  const probleme = []
  const nrPlic = txt(plic?.nr_plic)
  if (!/^PL-[A-Z]{3}-[0-9]{4}$/.test(nrPlic)) probleme.push('numărul plicului lipsește sau e invalid')
  const nume = txt(plic?.destinatar_nume)
  if (!nume) probleme.push('destinatarul nu are nume')
  else if (nume.length > LIMITE_FAN.name) probleme.push(`numele destinatarului are ${nume.length} caractere (FAN acceptă ${LIMITE_FAN.name})`)
  const telefon = telefonFan(contact?.telefon)
  if (!telefon) probleme.push(txt(contact?.telefon) ? 'telefonul destinatarului e invalid' : 'telefonul destinatarului lipsește (obligatoriu la FAN)')
  else if (telefon.length > LIMITE_FAN.phone) probleme.push(`telefonul are peste ${LIMITE_FAN.phone} caractere`)
  const judet = txt(contact?.adresa_judet)
  const localitate = txt(contact?.adresa_sat) || txt(contact?.adresa_comuna)
  const strada = txt(contact?.adresa_strada)
  if (!judet) probleme.push('județul lipsește')
  else if (judet.length > LIMITE_FAN.county) probleme.push('județul e prea lung')
  if (!localitate) probleme.push('localitatea (sat / comună) lipsește')
  else if (localitate.length > LIMITE_FAN.locality) probleme.push('localitatea e prea lungă')
  if (!strada) probleme.push('strada lipsește')
  else if (strada.length > LIMITE_FAN.street) probleme.push('strada e prea lungă')
  const zip = txt(contact?.cod_postal)
  if (zip && !/^[0-9]{6}$/.test(zip)) probleme.push('codul poștal nu are 6 cifre')
  const centru = txt(proiectCod).slice(0, LIMITE_FAN.costCenter)
  if (!centru) probleme.push('codul proiectului lipsește')
  const shipment = {
    info: {
      service: config.service,
      packages: { ...config.packages },
      weight: config.weight,
      payment: config.payment,
      content: nrPlic,
      observation: nrPlic,
      dimensions: { ...config.dimensions },
      costCenter: centru,
      options: [...config.options],
    },
    recipient: {
      name: nume, contactPerson: nume, phone: telefon || '',
      address: { county: judet, locality: localitate, street: strada, ...(zip ? { zipCode: zip } : {}) },
    },
  }
  return { ok: probleme.length === 0, shipment, probleme }
}

// JSON canonic (chei sortate) — baza hash-ului aprobat de owner: același plic, aceleași date → același hash.
export function jsonCanonic(v) {
  if (Array.isArray(v)) return '[' + v.map(jsonCanonic).join(',') + ']'
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + jsonCanonic(v[k])).join(',') + '}'
  return JSON.stringify(v ?? null)
}

/** sha256 hex pe JSON-ul canonic al elementului (Web Crypto: browser și Deno). Generarea refuză rândul dacă hash-ul curent ≠ cel aprobat. */
export async function hashPlicFan(shipment, subtle = globalThis.crypto?.subtle) {
  if (!subtle) throw new Error('Web Crypto indisponibil')
  const buf = await subtle.digest('SHA-256', new TextEncoder().encode(jsonCanonic(shipment)))
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Interpretarea răspunsului POST /intern-awb pentru UN element trimis (un AWB pe apel → asocierea e sigură).
 * Întoarce { stare: 'generat' | 'eroare' | 'necunoscut', awb?, tarif?, tva?, motiv? }.
 * HTTP 5xx / răspuns neparsabil / fără awbNumber și fără erori = 'necunoscut' (L05: AWB-ul poate exista; fără retry automat).
 */
export function interpreteazaRaspunsAwb(status, corp) {
  if (!Number.isInteger(status) || status >= 500 || status === 0) return { stare: 'necunoscut', motiv: `răspuns FAN neconfirmat (HTTP ${status})` }
  const el = Array.isArray(corp?.response) ? corp.response : null
  if (status >= 400) return { stare: 'eroare', motiv: `FAN a refuzat cererea (HTTP ${status})` }
  if (!el || el.length !== 1) return { stare: 'necunoscut', motiv: 'răspuns FAN fără exact un element' }
  const r = el[0] || {}
  const erori = r.errors
  const areErori = erori && (Array.isArray(erori) ? erori.length > 0 : typeof erori === 'object' ? Object.keys(erori).length > 0 : !!String(erori).trim())
  const awb = r.awbNumber == null ? '' : String(r.awbNumber).trim()
  if (areErori && !awb) return { stare: 'eroare', motiv: 'FAN: ' + JSON.stringify(erori).slice(0, 300) }
  if (!/^[0-9]{6,20}$/.test(awb)) return { stare: 'necunoscut', motiv: 'răspuns FAN fără număr AWB valid' }
  const tarif = Number(r.tariff), tva = Number(r.vat)
  return { stare: 'generat', awb, tarif: Number.isFinite(tarif) ? tarif : null, tva: Number.isFinite(tva) ? tva : null }
}

// Codurile de eveniment FAN (GET /reports/awb-events) folosite pentru plicuri. Doar propuneri: AR-ul și returul le confirmă omul.
export const EVENIMENTE_FAN = Object.freeze({
  ridicat: ['C0'],
  livrat: ['S2'],
  retur: ['S16', 'S33', 'S43'],
  adresa: ['S4', 'S5', 'S10', 'S19', 'S20', 'S25', 'S27', 'S28', 'S42'],
  refuz: ['S6', 'S50'],
})

/** Din tracking-ul unui AWB: data ridicării (C0, = data expedierii în ERP), livrarea și semnalele de retur — pentru propuneri afișate omului. */
export function rezumatUrmarire(urmarire) {
  const ev = Array.isArray(urmarire?.events) ? urmarire.events.filter(e => e && typeof e.id === 'string') : []
  const primul = coduri => ev.filter(e => coduri.includes(e.id)).map(e => String(e.date || '')).sort()[0] || null
  const ultimul = ev.map(e => e).sort((a, b) => String(a.date || '').localeCompare(String(b.date || ''))).at(-1) || null
  return {
    ridicat_la: primul(EVENIMENTE_FAN.ridicat),
    livrat_la: primul(EVENIMENTE_FAN.livrat),
    confirmat_de: txt(urmarire?.confirmation?.name) || null,
    semnal_retur: ev.some(e => [...EVENIMENTE_FAN.retur, ...EVENIMENTE_FAN.adresa, ...EVENIMENTE_FAN.refuz].includes(e.id)) || !!urmarire?.returnAwbNumber,
    ultimul_eveniment: ultimul ? { id: ultimul.id, nume: txt(ultimul.name), data: ultimul.date || null } : null,
  }
}
