// Logica NFD este preluată din modelul diacritice.js din brief; modulul rămâne independent.
const norm = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const curat = s => s.replace(/\s+/g, ' ').replace(/^[\s.,_–-]+|[\s,_–-]+$/g, '').trim()
const dataRe = /(?<![\d.])\d{1,2}\.\d{1,2}\.\d{4}(?!\d)/g
const firme = /(?<![a-z0-9])(?:C\.F\.I\.|CFI|SORCHIV|HABAU|Comesad|Petroconst|EUROPAN PROD|IMPA|COLEN|FONSTER|ROMOIL)(?![a-z0-9])/gi
const firma = s => /^c\.?f\.?i\.?$/i.test(s) ? 'CFI' : s
function iso(s) {
  const [d, m, y] = s.split('.').map(Number)
  const dt = new Date(0)
  dt.setUTCFullYear(y, m - 1, d)
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
    ? `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null
}
function inceput(nume) {
  const text = typeof nume === 'string' ? nume : ''
  const m = text.match(/^\s*(\d+)(?:\.+|\s+|$)/)
  return { text, numar: m && Number.isSafeInteger(Number(m[1])) ? Number(m[1]) : null,
    rest: m ? text.slice(m[0].length) : text }
}
function extrageData(text, necunoscut, pv = false) {
  const date = []
  // Nu alegem arbitrar o zi din intervale sau din două recepții diferite.
  text = text.replace(/(?:din\s*)?\d{1,2}\.\d{1,2}\s+si\s+\d{1,2}\.\d{1,2}\.\d{4}|(?:din\s*)?\d{1,2}_\d{1,2}\.\d{1,2}\.\d{4}/gi, m => {
    necunoscut.push(m.trim()); date.push(null); return ' '
  })
  const re = pv
    ? /(?:\bdin\s*)?(?<![\d.])\d{1,2}\.\d{1,2}\.\d{4}(?!\d)/gi
    : /(?:(?:\btermen\s+depuner(?:e|ea)|\bdepuner(?:ea|e)|\b(?:termen|term)\s+dep|\btermen)\s*)?(?<![\d.])\d{1,2}\.\d{1,2}\.\d{4}(?!\d)/gi
  const gasite = []
  text = text.replace(re, m => {
    const raw = m.match(dataRe)[0]
    date.push(iso(raw)); gasite.push(m.trim()); return ' '
  })
  if (date.length !== 1 || !date[0]) necunoscut.push(...gasite)
  return { text, data: date.length === 1 ? date[0] : null }
}
export function parseNumeLicitatie(nume, categorie) {
  const start = inceput(nume)
  const out = { numar: start.numar, participat: true, stare: null, termen: null,
    rol: null, partener: null, id_seap: null, denumire: '', neinterpretat: [], este_licitatie: null }
  let text = start.rest
  // Numărul este un indiciu, nu dovada că orice folder numerotat este o procedură.
  const administrativ = /^(?:actualizare\b|foraje\b|lucrari vechi\b|rest de decontat\b|licitatii vechi\b|preturi de la\b|pv receptii\b|_fixture\b)/.test(norm(text).replace(/_/g, ' ').trim()) || /^_fixture\b/i.test(text)
  const categorieLicitatie = /^\d+\./.test(categorie || '')
  out.este_licitatie = administrativ ? false : categorieLicitatie && (start.numar !== null || /depuner|termen|\b(?:CN|SCN|ADV)\d/i.test(text)) ? true : null
  if (out.este_licitatie !== true) {
    if (start.text) out.neinterpretat.push(start.text)
    return out
  }
  text = text.replace(/^\s*NU(?=[\s._]|$)[\s._]*/i, () => { out.participat = false; return '' })
  const stari = []
  text = text.replace(/(?<![a-z0-9])(?:ANULAT[AĂ]|RELUAT[AĂ]|SUSPENDAT[AĂ])(?![a-z0-9])/gi, m => { stari.push(m); return ' ' })
  const unice = [...new Set(stari.map(norm))]
  if (unice.length === 1) out.stare = unice[0]
  else out.neinterpretat.push(...stari)
  const ids = []
  text = text.replace(/\b(?:SCN|CN|ADV)\d+\b/gi, m => { ids.push(m); return ' ' })
  if (new Set(ids.map(s => s.toUpperCase())).size === 1) out.id_seap = ids[0].toUpperCase()
  else out.neinterpretat.push(...ids)
  const dt = extrageData(text, out.neinterpretat)
  out.termen = dt.data; text = dt.text
  text = text.replace(/\(\d+\)/g, m => { out.neinterpretat.push(m); return ' ' })
  // „Firma Lider” descrie partenerul. Nu inventăm rolul nostru prin excludere.
  const lideri = []
  text = text.replace(new RegExp(`(${firme.source})\\s+Lider(?![a-z0-9])`, 'gi'), m => {
    const f = m.replace(/\s+Lider$/i, '')
    lideri.push(f)
    out.neinterpretat.push(m); return ' '
  })
  const roluri = []
  text = text.replace(/(?<![a-z0-9])(?:Ter[țţt]\s+(?:sus[țţt]in[ăa]tor\s+)?subcontractant\s+Gazpet|(?:Ter[țţt]\s+sus[țţt]in[ăa]tor|Asociat|Subcontractant|Lider)\s+Gazpet|Gazpet\s+(?:Ter[țţt]\s+sus[țţt]in[ăa]tor|Asociat|Subcontractant|Lider)(?:\s+ptr\.)?)(?![a-z0-9])/gi, m => {
    const n = norm(m)
    if (/tert.*subcontractant/.test(n)) out.neinterpretat.push(m)
    else roluri.push({ raw: m, rol: /tert/.test(n) ? 'tert_sustinator' : /subcontractant/.test(n) ? 'subcontractant' : /asociat/.test(n) ? 'asociat' : 'lider' })
    return ' '
  })
  if (new Set(roluri.map(r => r.rol)).size === 1) out.rol = roluri[0].rol
  else out.neinterpretat.push(...roluri.map(r => r.raw))
  // Loturile atribuite firmelor nu dovedesc asocierea; păstrăm fragmentul întreg pentru revizuire.
  text = text.replace(/Lot\s*\d+\s+Gazpet_Lot\s*\d+\s+\w+/gi, m => { out.neinterpretat.push(m); return ' ' })
  const parteneri = [...lideri]
  text = text.replace(firme, m => { parteneri.push(m); return ' ' })
  if (new Set(parteneri.map(f => norm(firma(f)))).size === 1) out.partener = firma(parteneri[0])
  else out.neinterpretat.push(...parteneri.filter(f => !lideri.includes(f)))
  text = text.replace(/(?<![a-z0-9])(?:asociere|lider|asociat|subcontractant|ter[țţt](?:\s+sus[țţt]in[ăa]tor)?|Gazpet|ptr\.)(?![a-z0-9])/gi, m => { out.neinterpretat.push(m); return ' ' })
  text = text.replace(/(?<![\w.])\d{6,}(?:\.\d+)?(?!\w)/g, m => { out.neinterpretat.push(m); return ' ' })
  // Un termen incomplet ori cu format nou trebuie semnalat, nu ascuns în obiectul lucrării.
  text = text.replace(/\b(?:depuner(?:ea|e)|termen|term\s+dep)\b.*$/gi, m => { out.neinterpretat.push(m.trim()); return ' ' })
  out.denumire = curat(text)
  return out
}
export function parseNumeLucrareExecutata(nume) {
  const start = inceput(nume)
  const out = { numar: start.numar, beneficiar: null, lucrare: '', nr_contract: null,
    piese: [], data_pv: null, tip_pv: null, neinterpretat: [] }
  if (start.numar === null) { if (start.text) out.neinterpretat.push(start.text); return out }
  let text = start.rest
  // Subnumerotările nu sunt obiectul lucrării și nici contracte.
  text = text.replace(/^\d+\./, m => { out.neinterpretat.push(m); return ' ' })
  const dt = extrageData(text, out.neinterpretat, true)
  text = dt.text; out.data_pv = dt.data
  text = text.replace(/\b(?:PVR\s+par[tțţ]ial[aă]|PVRTL|PVRP|PV|DC|F|C|R)(?![a-z0-9])/gi, raw => {
    const m = /^pvr\s/i.test(raw) ? 'PVRP' : raw.toUpperCase()
    if (m === 'R') out.neinterpretat.push(raw)
    else if (!out.piese.includes(m)) out.piese.push(m)
    return ' '
  })
  const tipuri = out.piese.filter(p => /^PV/.test(p))
  if (tipuri.length === 1) out.tip_pv = tipuri[0]
  else if (tipuri.length > 1) out.neinterpretat.push(...tipuri)
  if (!out.tip_pv && out.data_pv) { out.neinterpretat.push(out.data_pv); out.data_pv = null }
  text = text.replace(/\b\d+\.\d+\b/g, m => { out.neinterpretat.push(m); return ' ' })
  const contract = text.match(/(?:^|[\s,_-])(\d+)\s*[,\s]*$/)
  if (contract && !/\bLot\s*$/i.test(text.slice(0, contract.index))) { out.nr_contract = contract[1]; text = text.slice(0, contract.index) }
  text = text.replace(/\b(?:Conpet|Romgaz|Habau|cis gaz)\b/gi, m => {
    if (!out.beneficiar) { out.beneficiar = m; return ' ' }
    out.neinterpretat.push(m); return ' '
  })
  out.lucrare = curat(text)
  return out
}
