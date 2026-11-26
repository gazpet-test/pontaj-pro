// TKT-2026-0329 A (PR-UI, Task 8): helperii puri ai ecranului semnalelor „aceeași cantitate, documente diferite” și ai ciornelor auto_surse_*.
// Verdictul, dovezile, inventarul și starea bazei sunt calculate DOAR pe server (20270112a: fn_ofertare_semnale_publica, fn_ofertare_semnale_lista,
// ofertare_semnal_baza_stare — L19); aici doar afișare, grupare și validări de formular. Fail-closed: o valoare necunoscută nu devine „în regulă” (L18).
import { eCiornaAutomata } from './ofertareClarificariBaza.js'

export const CULORI = { verde: '#3FB950', rosu: '#F85149', portocaliu: '#F0883E', gri: '#8B949E' }

const PAGINA = 1000
const PAGINI_MAX = 200   // 200 × 1000 rânduri: gardă împotriva unui server care nu avansează range-ul
// migrarea neaplicată: tabel / funcție inexistente (PostgREST: PGRST202 pentru RPC, PGRST205 / 42P01 pentru tabel, 42883 funcție)
export const eNeactiv = e => ['42P01', 'PGRST202', '42883', 'PGRST205'].includes(String(e?.code || '')) || /does not exist|Could not find the (function|table)/i.test(String(e?.message || ''))
// toate rândurile fn_ofertare_semnale_lista, pagină cu pagină (range pe rezultatul funcției), până la pagina goală — nu „length < pagină” (L23)
export async function incarcaSemnale(sb, licitatieId) {
  const randuri = []
  for (let p = 0; p < PAGINI_MAX; p++) {
    const de = p * PAGINA
    const { data, error } = await sb.rpc('fn_ofertare_semnale_lista', { p_licitatie_id: licitatieId }).range(de, de + PAGINA - 1)
    if (error) return { error }
    if (!Array.isArray(data)) return { error: { message: 'răspuns neașteptat de la server (nu e listă)' } }
    if (!data.length) return { data: randuri }
    for (const r of data) randuri.push(r)   // nu push(...data): RangeError la liste mari
  }
  return { error: { message: `prea multe rânduri (peste ${PAGINI_MAX * PAGINA}) — lista nu e completă` } }
}
const ORDINE_VERDICT = { diferenta: 0, de_verificat: 1, neverificat: 2, in_regula: 3 }
const NUME_VERDICT = { in_regula: 'în regulă', diferenta: 'diferență', de_verificat: 'de verificat', neverificat: 'neverificat' }
const cuMotiv = (t, motiv) => (motiv != null && String(motiv).trim() ? `${t}: ${String(motiv).trim()}` : t)

// verdictul semnalului → etichetă; orice altceva decât cele patru valori = „stare necunoscută”, gri (nu verde)
export function eticheta(verdict, motiv) {
  if (verdict === 'in_regula') return { text: '✓ în regulă', culoare: CULORI.verde }
  if (verdict === 'diferenta') return { text: cuMotiv('⚠ diferență', motiv), culoare: CULORI.rosu }
  if (verdict === 'de_verificat') return { text: cuMotiv('? de verificat', motiv), culoare: CULORI.portocaliu }
  if (verdict === 'neverificat') return { text: cuMotiv('∅ neverificat', motiv), culoare: CULORI.gri }
  return { text: 'stare necunoscută', culoare: CULORI.gri }
}

// actualitatea rezultatului publicat (decizia 8): in_curs → se reevaluează; actual ≠ true → istoric (verdictul se arată tăiat, nu verde)
export function etichetaActualitate(rand) {
  if (rand?.in_curs === true) return { text: '⏳ se reevaluează', culoare: CULORI.portocaliu }
  if (rand?.actual !== true) return { text: 'rezultat istoric — sursele s-au schimbat, nereverificat', culoare: CULORI.gri }
  return null
}

// motivele lipsei dovezii, pe codurile din CHECK-ul ofertare_cantitati_masuratori.verificare (20270112a)
export const MOTIV_VERIFICARE = {
  nedovedit: 'rândul nu a fost găsit în document', fara_sursa: 'poziție fără document-sursă', neclasificat: 'element sau natură necunoscute',
  lot_necunoscut: 'lot necunoscut', neatribuibil: 'observațiile feliei reluate nu pot fi legate de o încercare', pagina_nepermisa: 'pagină peste plafonul de pagini',
  fragment_lipsa: 'fragmentul nu apare pe pagina declarată', fragment_ambiguu: 'fragmentul apare de mai multe ori pe pagină', rand_lipsa: 'rândul nu apare pe pagina declarată',
  rand_ambiguu: 'rândul apare de mai multe ori pe pagină', antet_lipsa: 'tabel fără antet recunoscut', coloana_necunoscuta: 'coloana nu e una de cantitate',
  um_lipsa: 'unitatea de măsură lipsește', tipar_necunoscut: 'textul nu are un tipar de cantitate acceptat', numar_ambiguu: 'format numeric ambiguu',
  numar_neintreg: 'numărul nu e un token întreg', diametru_nu_cantitate: 'numărul e un diametru, nu o cantitate', unitate_incompatibila: 'unitate incompatibilă',
}
const numeDoc = m => (m?.document_nume ? String(m.document_nume) : m?.document_id != null ? `#${m.document_id}` : '')

// o măsurătoare → text pentru om: dovada (tabel / text) sau „fără dovadă: motiv”
export function descriereDovada(m) {
  if (!m || typeof m !== 'object') return 'fără dovadă: măsurătoare lipsă'
  if (m.verificare !== 'ok') {
    const motiv = MOTIV_VERIFICARE[m.verificare] || String(m.verificare ?? 'necunoscut')
    const d = m.verificare === 'fara_sursa' ? '' : numeDoc(m)
    return `fără dovadă: ${motiv}${d ? ` (${d})` : ''}`
  }
  const valoare = [m.valoare_text, m.um_text].filter(x => x != null && String(x).trim()).map(x => String(x).trim()).join(' ')
  const unde = `${numeDoc(m) || 'document'} p.${m.pagina}`
  if (m.fel_dovada === 'tabel') return `${unde}, rândul „${m.rand ?? ''}”, coloana „${m.antet_coloana ?? ''}” → ${valoare}`
  return `${unde}, fragment „${m.fragment ?? ''}” → ${valoare}`
}

// rândurile fn_ofertare_semnale_lista → [{semnal, a, b, rezolvat, actual, in_curs}], ordonate pe gravitate; un semnal o singură dată
export function grupeazaPeMasura(randuri) {
  const peId = new Map()
  for (const r of Array.isArray(randuri) ? randuri : []) {
    const s = r?.semnal
    if (!s || typeof s !== 'object' || s.id == null || peId.has(s.id)) continue
    const ms = Array.isArray(r.masuratori) ? r.masuratori : []
    peId.set(s.id, { semnal: s, a: ms.filter(m => m?.parte === 'a'), b: ms.filter(m => m?.parte === 'b'),
      rezolvat: r.rezolvat === true, actual: r.actual === true, in_curs: r.in_curs === true })
  }
  const rang = v => (v in ORDINE_VERDICT ? ORDINE_VERDICT[v] : 9)
  return [...peId.values()].sort((x, y) => rang(x.semnal.verdict) - rang(y.semnal.verdict) || Number(x.semnal.id) - Number(y.semnal.id))
}

// inventar #11: ciornele automate (auto_planse_* / auto_surse_*) nu se șterg din client (triggerul refuză oricum)
export const poateStergeCiorna = q => !eCiornaAutomata(q)

// eroarea PostgREST / RPC → text pentru om: 23505 (UNIQUE (licitatie_id, nr), decizia 10) = reîncearcă; „CM_COD: text” = textul; altfel mesajul brut
export function mesajEroareClarificare(error) {
  if (error == null) return 'eroare necunoscută'
  if (typeof error === 'string') return error
  const msg = String(error.message ?? error.details ?? '')
  if (error.code === '23505' || /duplicate key value violates unique constraint/i.test(msg)) return 'Numărul întrebării e deja luat — reîncearcă.'
  const cm = /^CM_[A-Z_]+:\s*(.*)$/s.exec(msg.trim())
  if (cm) return cm[1].trim()
  return msg || 'eroare necunoscută'
}

const fmtNr = v => (v == null || v === '' || !Number.isFinite(Number(v)) ? '—' : Number(v).toLocaleString('ro-RO', { maximumFractionDigits: 6 }))
const fmtPrag = v => (v == null || !Number.isFinite(Number(v)) ? '—' : `${Number((Number(v) * 100).toFixed(4)).toLocaleString('ro-RO', { maximumFractionDigits: 4 })} %`)
// diferențele din ofertare_semnal_baza_stare (detalii.diferente: verdict / a / b / prag, {vechi, acum}) → rânduri pentru panoul bazei din Clarificări
export function textDiferenteSemnal(detalii) {
  if (!detalii || detalii.evaluare !== 'surse_v1' || !detalii.diferente || typeof detalii.diferente !== 'object') return []
  const d = detalii.diferente, out = []
  const dif = (x) => x && typeof x === 'object' && String(x.vechi ?? '') !== String(x.acum ?? '')
  if (dif(d.verdict)) out.push(`verdict ${NUME_VERDICT[d.verdict.vechi] || d.verdict.vechi || '—'} → ${NUME_VERDICT[d.verdict.acum] || d.verdict.acum || '—'}`)
  if (dif(d.a)) out.push(`A ${fmtNr(d.a.vechi)} → ${fmtNr(d.a.acum)}`)
  if (dif(d.b)) out.push(`B ${fmtNr(d.b.vechi)} → ${fmtNr(d.b.acum)}`)
  if (dif(d.prag)) out.push(`prag ${fmtPrag(d.prag.vechi)} → ${fmtPrag(d.prag.acum)}`)
  return out
}

// ── „răspuns posibil relevant” (spec §3.6): potrivire textuală pe măsură, fără AI; omul confirmă valoarea și legarea ──
const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()
export const dnElement = el => { const m = /_dn(\d{2,4})$/.exec(String(el ?? '')); return m ? Number(m[1]) : null }
// familiile fără DN (ofertare_elemente_masura): cuvântul-cheie pe textul normalizat (fără diacritice)
const FAMILIE_RE = { bransament: /\bbransament/, sapatura: /\bsapatur|\bexcava/, refacere: /\brefacer/ }
const elementInText = (element, t) => {
  const dn = dnElement(element)
  // DN-ul ca „DN 160” / „Dn160” / „Ø160” / „De 160”, întreg (nu parte din 1600 / 1160); textul e normalizat (minuscule)
  if (dn != null) return new RegExp(`(?:^|[^a-z0-9])(?:dn|ø|de)[ ]*${dn}(?![0-9])`).test(t)
  const re = FAMILIE_RE[String(element ?? '')]
  return re ? re.test(t) : false
}
export function propuneRaspunsRelevant(semnale, textExtras) {
  const t = norm(textExtras)
  if (!t) return []
  const out = []
  for (const r of Array.isArray(semnale) ? semnale : []) {
    const s = r?.semnal ?? r
    if (!s || s.id == null || r?.rezolvat === true || s.element == null || s.element === 'necunoscut') continue
    if (!elementInText(s.element, t)) continue
    const ob = norm(s.obiect_cheie)
    const oriceObiect = !ob || ob === '*'
    if (!oriceObiect && !t.includes(ob)) continue
    const dn = dnElement(s.element)
    const ce = dn != null ? `DN ${dn}` : `elementul „${s.element}”`
    out.push({ semnal_id: s.id, motiv: oriceObiect ? `${ce} apare în răspuns (măsură la nivelul lucrării)` : `${ce} și obiectul „${ob}” apar în răspuns` })
  }
  return out
}

// linia din raportul rulării (Task 9): rezumatul publicat de edge (masuratori.rezumat) sau motivul pentru care comparația n-a rulat
export function textRezumatSemnale(masuratori) {
  if (!masuratori || typeof masuratori !== 'object') return null
  if (masuratori.ok !== true) return `Semnale: comparația nu a rulat — ${masuratori.eroare || 'motiv necunoscut'}${masuratori.evaluare_depasita ? ' (sursele s-au schimbat în timpul rulării)' : ''}`
  const r = masuratori.rezumat
  if (!r || typeof r !== 'object') return 'Semnale: rezumat lipsă din răspuns'
  const n = k => Number(r[k]) || 0
  return `Semnale: ${n('diferente')} diferențe, ${n('de_verificat')} de verificat, ${n('neverificate')} neverificate (${n('in_regula')} în regulă, ${n('total')} în total)`
}

// validarea formularului de setări — aceleași limite ca CHECK-urile din ofertare_cantitati_setari (serverul le impune oricum)
export function eroareSetari(pragProcent, plafonPagini) {
  const p = Number(String(pragProcent ?? '').trim().replace(',', '.'))
  if (String(pragProcent ?? '').trim() === '' || !Number.isFinite(p) || p < 0.1 || p > 50) return 'Pragul trebuie să fie între 0,1 % și 50 %.'
  const s = String(plafonPagini ?? '').trim()
  if (!/^\d+$/.test(s) || Number(s) < 10 || Number(s) > 2000) return 'Plafonul trebuie să fie un număr întreg între 10 și 2000 de pagini.'
  return null
}
export const pragDinProcent = pragProcent => Math.round(Number(String(pragProcent).replace(',', '.')) * 1e4) / 1e6

// sha256('') — identitatea textului unui document FĂRĂ text (decizia „nu e sursă cantitativă” se ia pe sha-ul textului, ca în fotografie)
export const SHA256_TEXT_GOL = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
// documentele necitite din inventarul semnalelor (decizia 15), reunite, cu numele din lista documentelor licitației
export function documenteNecitite(randuri, documente) {
  const ids = new Set()
  for (const r of Array.isArray(randuri) ? randuri : []) {
    const l = r?.semnal?.inventar?.documente_necitite
    for (const x of Array.isArray(l) ? l : []) { const n = Number(x); if (Number.isSafeInteger(n) && n > 0) ids.add(n) }
  }
  const peId = new Map((Array.isArray(documente) ? documente : []).map(d => [Number(d?.id), d]))
  return [...ids].sort((a, b) => a - b).map(id => {
    const d = peId.get(id)
    // fara_text doar dacă lista documentelor a adus text_extras; altfel necunoscut (null), nu „fără text” (L18)
    const areCamp = d && Object.prototype.hasOwnProperty.call(d, 'text_extras')
    return { id, nume: d?.nume_original ? String(d.nume_original) : `#${id}`, fara_text: areCamp ? !String(d.text_extras ?? '').length : null }
  })
}
export async function sha256Text(text) {
  const buf = new TextEncoder().encode(String(text ?? ''))
  const h = await globalThis.crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(h), b => b.toString(16).padStart(2, '0')).join('')
}
