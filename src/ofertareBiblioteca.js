// Bibliotecă juridică (Ofertare › ⚖️) — logică pură, testată în ofertareBiblioteca.test.js.
// Pasul A din docs/juridic/MAPARE_CNSC_IN_ERP.md (claude_docs tema_biblioteca_juridica_A): read-only peste
// cnsc_decizii (216), norme_cerinte (919) și clarificari_tipare (119). Fără tabel nou, fără RPC, fără AI.
// Regula de export (§4): o citare se copiază DOAR cu decizie verificată + pagină + link, într-un singur format;
// orice element lipsă = butonul dezactivat (fail-closed). Deciziile atacate în instanță poartă avertismentul și în text.

// Căutare fără diacritice și fără majuscule (ș/ş, ț/ţ, ă, â, î → s, t, a, a, i)
export const normalizeaza = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

// Toate cuvintele căutate trebuie să apară în câmpurile date (ȘI între cuvinte)
export function potrivesteCautare(campuri, q) {
  const cuvinte = normalizeaza(q).split(/\s+/).filter(Boolean)
  if (!cuvinte.length) return true
  const text = normalizeaza((campuri || []).filter(v => v != null).map(v => (typeof v === 'string' ? v : JSON.stringify(v))).join(' \u0001 '))
  return cuvinte.every(c => text.includes(c))
}

export const fmtData = d => (d && /^\d{4}-\d{2}-\d{2}/.test(String(d)) ? String(d).slice(0, 10).split('-').reverse().join('.') : null)

// Numărul EXACT al deciziei („3657/C1/4067,4182”) sau null dacă e anonimizat / incomplet („1237/2026 (BO, …)”,
// „BO2026_1149 (…)”, „12/C?/…”). Paranteza cu note de la final nu face parte din număr.
export function nrExact(nr) {
  if (nr == null) return null
  const baza = String(nr).split(' (')[0].trim()
  return /^\d+\/C\d+\/\d+(?:\s*[,/]\s*\d+)*$/.test(baza) ? baza : null
}

// Pagina din `loc` („p. 13 (din 19)” → „13”, „p. 13-14 (din 19)” → „13-14”); fără pagină (ex. „analiza cash-flow”) → null
export function paginaDinLoc(loc) {
  const m = /(?:^|[\s(])p\.\s*(\d+(?:\s*[-–]\s*\d+)?)/i.exec(String(loc ?? ''))
  return m ? m[1].replace(/\s*[-–]\s*/, '-') : null
}

const REZULTATE_CJ = ['mentinuta', 'modificata', 'desfiintata']
// Controlul judiciar: menținută / modificată / desființată; orice altceva (lipsă, „necunoscut”) → necunoscut
export function stareJudiciara(cj) {
  const r = normalizeaza(cj?.rezultat)
  return REZULTATE_CJ.includes(r) ? r : 'necunoscut'
}
export const eAtacata = cj => ['modificata', 'desfiintata'].includes(stareJudiciara(cj))
export const ETICHETA_CJ = { mentinuta: 'menținută', modificata: 'modificată ⚠️', desfiintata: 'desființată ⚠️', necunoscut: 'necunoscut' }

// Referința scurtă a deciziei, pentru liste: „nr. 3657/C1/4067,4182 · 23.12.2024” sau „BO2024_3657 (anonimizată)”
export function referintaScurta(d) {
  const nr = nrExact(d?.nr_decizie), data = fmtData(d?.data)
  if (nr) return `nr. ${nr}${data ? ` · ${data}` : ''}`
  if (d?.buletin_oficial) return `${d.buletin_oficial} (nr./data anonimizate)`
  return d?.nr_decizie || d?.id || '—'
}

// Citarea pentru export, în formatul unic din §4. { ok:true, citare, text } sau { ok:false, motiv }.
// `text` = ce ajunge în clipboard: citatul exact + citarea + „practică de interpretare, nu normă” (+ avertismentul instanței).
export function formatCitare(d, citat) {
  if (!d) return { ok: false, motiv: 'decizie lipsă' }
  if (d.verificat !== true) return { ok: false, motiv: 'decizie neverificată pe sursă — nu se exportă' }
  const pagina = paginaDinLoc(citat?.loc)
  const link = typeof d.link_sursa === 'string' ? d.link_sursa.trim() : ''
  // link = adresă web reală (http/https); orice altceva din BD (text, javascript:, …) e tratat ca lipsă
  if (!pagina || !/^https?:\/\/\S+$/i.test(link)) return { ok: false, motiv: 'nu se exportă fără pagină și link' }
  const textCitat = typeof citat?.text === 'string' ? citat.text.trim() : ''
  if (!textCitat) return { ok: false, motiv: 'citat fără text' }
  const nr = nrExact(d.nr_decizie), data = fmtData(d.data)
  let citare
  if (nr && data) citare = `Decizia CNSC nr. ${nr} din ${data}, p. ${pagina} — ${link}`
  else if (d.buletin_oficial) citare = `Decizia CNSC publicată în BO nr. ${d.buletin_oficial} (nr./data anonimizate), p. ${pagina} — ${link}`
  else return { ok: false, motiv: 'fără număr exact cu dată și fără cod BO — nu se exportă' }
  const linii = [`„${textCitat}”`, citare, '(practică de interpretare, nu normă)']
  if (eAtacata(d.control_judiciar)) {
    const cj = d.control_judiciar
    linii.push(`⚠️ Decizie ${stareJudiciara(cj) === 'desfiintata' ? 'desființată' : 'modificată'} în control judiciar${cj.instanta ? ` — ${cj.instanta}` : ''}${cj.nr_hotarare ? `, ${cj.nr_hotarare}` : ''}. Verifică hotărârea înainte de a o invoca.`)
  }
  return { ok: true, citare, text: linii.join('\n') }
}

const egal = (filtru, valoare) => !filtru || filtru === 'toate' || filtru === valoare
const triBool = (filtru, v) => !filtru || filtru === 'toate' || (filtru === 'da' ? v === true : filtru === 'nu' ? v === false : v == null)

// Filtrele fișei Decizii CNSC
export function filtreazaDecizii(decizii, f = {}) {
  return (decizii || []).filter(d =>
    egal(f.domeniu, d.domeniu) &&
    (!f.tema || f.tema === 'toate' || (d.tema || []).includes(f.tema)) &&
    egal(f.lege, d.lege_aplicabila) &&
    (!f.an || f.an === 'toate' || String(d.an) === String(f.an)) &&
    (!f.verificat || f.verificat === 'toate' || (f.verificat === 'da' ? d.verificat === true : d.verificat !== true)) &&
    egal(f.cj, stareJudiciara(d.control_judiciar)) &&
    triBool(f.subPrag, d.sub_prag) &&
    potrivesteCautare([d.regula, d.problema, d.solutie, d.cum_ne_ajuta, d.obiect, d.autoritate, d.nr_decizie, d.buletin_oficial, d.id], f.q))
}

// Cele mai noi întâi (data, apoi anul); fără dată la coada anului lor; apoi id
export function ordoneazaDecizii(decizii) {
  return (decizii || []).slice().sort((a, b) =>
    (Number(b.an) || 0) - (Number(a.an) || 0) ||
    String(b.data || '').localeCompare(String(a.data || '')) ||
    String(a.id).localeCompare(String(b.id)))
}

// Filtrele fișei Cerințe normative (implicit doar cele verificate pe sursă)
export function filtreazaCerinte(cerinte, f = {}) {
  const doarVerificate = f.doarVerificate !== false
  return (cerinte || []).filter(c =>
    (!doarVerificate || c.verificat_pe_sursa === true) &&
    egal(f.domeniu, c.domeniu) && egal(f.faza, c.faza) && egal(f.tema, c.tema) &&
    potrivesteCautare([c.cerinta, c.locator, c.requirement_id, c.source_id], f.q))
}

// Filtrele fișei Tipare de clarificări
export function filtreazaTipare(tipare, f = {}) {
  return (tipare || []).filter(t =>
    egal(f.tip, t.tip_problema) && egal(f.confidence, t.confidence) &&
    triBool(f.review, t.requires_human_legal_review) &&
    potrivesteCautare([t.titlu, t.intrebare_propusa, t.pattern_id, t.trigger?.semnal], f.q))
}

// Tiparele trimit spre decizii prin source_id („SRC-CNSC-BO2022_2473”); acceptăm și id-ul deciziei
export function indexDecizii(decizii) {
  const m = new Map()
  for (const d of decizii || []) { if (d.id) m.set(d.id, d); if (d.source_id) m.set(d.source_id, d) }
  return m
}
export function deciziiPentruTipar(tipar, index) {
  const out = []
  for (const ref of tipar?.precedente_cnsc || []) out.push({ ref, decizie: index.get(ref) || null })
  return out
}
export function tiparePentruDecizie(d, tipare) {
  if (!d) return []
  return (tipare || []).filter(t => (t.precedente_cnsc || []).some(r => r === d.id || (d.source_id && r === d.source_id)))
}

// Valorile distincte pentru un filtru (sortate, fără goluri); `din` = funcția care scoate valoarea / lista de valori
export function valoriDistincte(randuri, din) {
  const s = new Set()
  for (const r of randuri || []) { const v = din(r); for (const x of Array.isArray(v) ? v : [v]) if (x != null && x !== '') s.add(String(x)) }
  return [...s].sort((a, b) => a.localeCompare(b, 'ro'))
}

// impact_intern NU se mai citește din tabel (20261015a: SELECT pe coloană revocat pentru authenticated); owner-ul îl primește
// separat, prin fn_tipare_impact_intern(), și se lipește aici pe tipare după pattern_id. Rândurile fără pereche rămân neatinse.
export function ataseazaImpact(tipare, impact) {
  const m = new Map()
  for (const r of impact || []) if (r && r.pattern_id && r.impact_intern != null) m.set(r.pattern_id, r.impact_intern)
  return (tipare || []).map(t => (m.has(t.pattern_id) ? { ...t, impact_intern: m.get(t.pattern_id) } : t))
}
