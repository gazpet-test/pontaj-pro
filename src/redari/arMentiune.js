// juridic#021 pct. 5: AR semnat de altă persoană — convocările rămân „AR primit”, cu mențiunea vizibilă în registru și în PV B.
// juridic#026 pct. 1: la „altă persoană” se cere și calitatea primitorului (listă scurtă). Pe plic: ar_primit_de / ar_primit_calitate / ar_mentiune;
// se atașează convocărilor din plic la citire. Către Transgaz (registrul TGZ, PV B) merge DOAR calitatea; textul liber rămâne în registrul intern.
export const CALITATI_AR = [
  { cod: 'membru_familie', eticheta: 'membru de familie' },
  { cod: 'vecin', eticheta: 'vecin' },
  { cod: 'alta_persoana', eticheta: 'altă persoană' },
]
const ETICHETE = CALITATI_AR.map(c => c.eticheta)
// cod necunoscut sau lipsă (date vechi) -> '' (fără calitate), niciodată textul primit
export const etichetaCalitateAr = cod => CALITATI_AR.find(c => c.cod === cod)?.eticheta ?? ''

// Registrul intern citește și mențiunea liberă; exporturile către TGZ (registrul TGZ, PV B) citesc doar calitatea.
export const COL_PLIC_AR = 'id,ar_primit_de,ar_primit_calitate,ar_mentiune'
export const COL_PLIC_AR_TGZ = 'id,ar_primit_de,ar_primit_calitate'
const PREFIX = ' (primit de altă persoană'

export function atasezaMentiuniAr(convocari = [], plicuri = []) {
  const pe = new Map(plicuri.map(p => [p.id, p]))
  return convocari.map(c => {
    const p = c?.plic_id ? pe.get(c.plic_id) : null
    if (p?.ar_primit_de !== 'alta_persoana') return c
    return { ...c, ar_alta_persoana: String(p.ar_mentiune ?? '').trim() || 'fără mențiune', ar_alta_calitate: p.ar_primit_calitate ?? null }
  })
}

// Textul adăugat după data confirmării.
// Detaliat (registrul intern): „ (primit de altă persoană — membru de familie: <mențiunea>)”.
// Scurt (TGZ / PV B): „ (primit de altă persoană: membru de familie)”, fără textul liber și fără nume.
// Date vechi, fără calitate: „ (primit de altă persoană: <mențiunea>)” / „ (primit de altă persoană)”.
export function mentiuneAr(conv, { detaliat = true } = {}) {
  if (!conv?.ar_alta_persoana) return ''
  const cal = etichetaCalitateAr(conv.ar_alta_calitate)
  if (!detaliat) return cal ? `${PREFIX}: ${cal})` : `${PREFIX})`
  return cal ? `${PREFIX} — ${cal}: ${conv.ar_alta_persoana})` : `${PREFIX}: ${conv.ar_alta_persoana})`
}

// Varianta TGZ a unei celule din registrul intern: păstrează doar calitatea (dacă e una din listă), restul mențiunii dispare.
// Idempotentă (o celulă deja scurtă rămâne la fel), deci se poate aplica de două ori.
export function scurteazaMentiuneAr(v) {
  if (typeof v !== 'string') return v
  const i = v.indexOf(PREFIX)
  if (i < 0) return v
  const rest = v.slice(i + PREFIX.length)
  const cal = ETICHETE.find(e => rest.startsWith(` — ${e}: `) || rest === `: ${e})`)
  return v.slice(0, i) + (cal ? `${PREFIX}: ${cal})` : `${PREFIX})`)
}

// Afișarea în tabelul Plicuri (intern): calitatea și mențiunea de pe cartonaș.
export function descriereArPlic(p) {
  if (p?.ar_primit_de !== 'alta_persoana') return ''
  const cal = etichetaCalitateAr(p.ar_primit_calitate)
  return ` · semnat de altă persoană${cal ? ` (${cal})` : ''}: ${String(p.ar_mentiune ?? '').trim() || 'fără mențiune'}`
}
