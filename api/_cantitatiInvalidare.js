// ════════════════════════════════════════════════════════════════
// ofertareCantitatiInvalidare.js — CÂND o aprobare („validat") a unui rând din ofertare_cantitati nu mai e valabilă.
//
// Copilot (26.09.2026, condiția 1 a „aprobat = validat"): invalidarea nu privește doar cifra. O schimbare relevantă a unității,
// a diametrului (Dn), a materialului, a SDR-ului, a tronsonului / etapei (obiectul) sau a sursei aplicabile face aprobarea
// anterioară nevalabilă chiar dacă lungimea rămâne identică. Valoarea și aprobarea veche se păstrează în ISTORIC.
//
// Regula (aceeași în BD — trigger-ul propus în docs/R5_MIGRARE_PROPUSA_aprobare_istoric.sql — și în aplicație):
//   rândul e 'validat' și o scriere schimbă RELEVANT oricare dintre CAMPURI_APROBARE ⇒ status 'diferenta' („de reverificat”),
//   cu nota „Rândul era VALIDAT — aprobarea veche (…) nu mai e valabilă: s-a schimbat …”. O validare explicită ulterioară
//   (UPDATE doar pe status, bifa ✓) rămâne posibilă — și e singurul drum înapoi în 'validat'.
//   - cifrele (cantitate, cifra din planșă): diferență ≥ 1 m pe unitățile de lungime (m / ml / fără unitate), orice diferență pe
//     celelalte; apariția / dispariția cifrei contează. Cifra din planșă se compară EFECTIV (cantitate_plansa, altfel cantitate),
//     exact ca `cifraSchimbata` din transferul planșei și din citirea CAD: prima cifră din planșă egală cu memoriul nu e o schimbare;
//   - textele (denumire — unde stau Dn / material / SDR / tronsonul —, specificații, obiect, categorie, sursa, tip_sursa,
//     cod_articol, um): orice schimbare după normalizare (spații, majuscule);
//   - schimbările SUB PRAG (ex. 5.245 → 5.245,4 m) nu invalidează, dar se raportează (în BD: rând de istoric „modificat_sub_prag”).
// Dn / material / SDR nu au coloane proprii: se citesc din denumire + specificații doar ca să NUMEASCĂ schimbarea în notă.
//
// COPII IDENTICE (ține-le la fel; testul src/ofertareCantitatiInvalidare.test.js compară octet cu octet):
//   src/ofertareCantitatiInvalidare.js (UI, 📋 Cantități) · api/_cantitatiInvalidare.js (citirea CAD, Vercel) ·
//   supabase/functions/ofertare-plansa-citeste/invalidare.js (transferul din planșă; deploy-ul pe folder nu garantează ../_shared).
// Funcții PURE, fără dependențe.
// ════════════════════════════════════════════════════════════════

export const STATUS_VALIDAT = 'validat'
export const STATUS_DE_REVERIFICAT = 'diferenta'
export const TOLERANTA_LUNGIME_M = 1
// ordinea = ordinea din notă
export const CAMPURI_APROBARE = ['licitatie_id', 'um', 'cantitate', 'cantitate_plansa', 'denumire', 'specificatii', 'obiect', 'categorie', 'tip_sursa', 'sursa', 'cod_articol']
export const ETICHETE_CAMP = {
  licitatie_id: 'licitația', um: 'unitatea de măsură', cantitate: 'cantitatea', cantitate_plansa: 'cifra din planșă',
  denumire: 'denumirea', specificatii: 'specificațiile', obiect: 'obiectul (tronson / etapă)', categorie: 'categoria',
  tip_sursa: 'tipul sursei', sursa: 'sursa', cod_articol: 'codul articolului (poziția din listă)',
  dn: 'Dn', material: 'materialul', sdr: 'SDR',
}
export const PREFIX_INVALIDARE = 'Rândul era VALIDAT — aprobarea veche'

const CIFRE = new Set(['cantitate', 'cantitate_plansa'])
const normText = v => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim().toLowerCase())
const numar = v => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
export const esteUnitateLungime = um => um == null || /^(m|ml|)$/i.test(String(um).trim())
export const toleranta = um => (esteUnitateLungime(um) ? TOLERANTA_LUNGIME_M : 0)
// a / b: numere sau null. Apariția / dispariția cifrei e mereu o schimbare.
export function cifraDiferita(a, b, tol) {
  if ((a === null) !== (b === null)) return true
  if (a === null) return false
  return tol > 0 ? Math.abs(a - b) >= tol : a !== b
}
export const fmtRo = v => {
  const n = numar(v)
  return n === null ? '—' : (+n.toFixed(2)).toLocaleString('ro-RO', { maximumFractionDigits: 2 })
}

// Dn / material / SDR din denumire + specificații (doar pentru a numi schimbarea; aceleași expresii ca în trigger-ul SQL).
// Toate valorile găsite, unice, în ordinea apariției („Tub PE80 SDR17 (Dn315) pentru conductă Dn250” → Dn „315/250”).
const unice = xs => [...new Set(xs)].join('/') || null
export function atributeTehnice(r) {
  const t = `${r?.denumire || ''} ${r?.specificatii || ''}`
  const dn = unice([...t.matchAll(/(?:\bdn|\bde|ø|φ)\s*(\d{2,4})(?!\d)/gi)].map(m => m[1]))
  const sdr = unice([...t.matchAll(/\bsdr\s*(\d+(?:[.,]\d+)?)/gi)].map(m => m[1].replace(',', '.')))
  const pe100 = /\bpe\s*-?\s*100(?!\d)/i.test(t), pe80 = /\bpe\s*-?\s*80(?!\d)/i.test(t)
  const material = unice([pe100 && 'PE100', pe80 && 'PE80', !pe100 && !pe80 && /\b(pehd|pe)\b/i.test(t) && 'PE', /\bol\b|o[țţt]el/i.test(t) && 'OL'].filter(Boolean))
  return { dn, material, sdr }
}

// Ce schimbă `patch` pe rândul `vechi` (doar câmpurile din CAMPURI_APROBARE prezente în patch).
// → { relevante: [{camp, eticheta, vechi, nou}], subPrag: [...], derivate: [{camp: 'dn'|'material'|'sdr', …}] }
export function schimbariRelevante(vechi, patch) {
  const v = vechi || {}, p = patch || {}
  const nou = { ...v, ...p }
  const tol = toleranta(nou.um)
  const relevante = [], subPrag = []
  for (const camp of CAMPURI_APROBARE) {
    if (!(camp in p)) continue
    const a = v[camp], b = nou[camp]
    let distinct, relevant
    if (camp === 'licitatie_id') { distinct = relevant = numar(a) !== numar(b) }
    else if (CIFRE.has(camp)) {
      distinct = numar(a) !== numar(b)
      relevant = camp === 'cantitate'
        ? cifraDiferita(numar(a), numar(b), tol)
        // cifra din planșă EFECTIVĂ (ca `referintaCitire` / `cifraSchimbata`)
        : distinct && cifraDiferita(numar(v.cantitate_plansa ?? v.cantitate), numar(nou.cantitate_plansa ?? nou.cantitate), tol)
    } else {
      distinct = (a ?? '') !== (b ?? '')
      relevant = normText(a) !== normText(b)
    }
    if (!distinct) continue
    const x = { camp, eticheta: ETICHETE_CAMP[camp], vechi: a ?? null, nou: b ?? null };
    (relevant ? relevante : subPrag).push(x)
  }
  const derivate = []
  if (relevante.some(x => x.camp === 'denumire' || x.camp === 'specificatii')) {
    const ta = atributeTehnice(v), tb = atributeTehnice(nou)
    for (const k of ['dn', 'material', 'sdr']) if ((ta[k] || null) !== (tb[k] || null)) derivate.push({ camp: k, eticheta: ETICHETE_CAMP[k], vechi: ta[k], nou: tb[k] })
  }
  return { relevante, subPrag, derivate }
}

const scurt = (s, n = 60) => { const t = String(s ?? '—'); return t.length > n ? t.slice(0, n - 1) + '…' : t }
const valoare = (x, v) => (CIFRE.has(x.camp) ? `${fmtRo(v)}${v == null ? '' : ' m'}` : x.camp === 'licitatie_id' ? `#${v ?? '—'}` : `„${scurt(v ?? '—')}”`)
export function descrieSchimbari({ relevante, derivate }) {
  const d = (derivate || []).map(x => `${x.eticheta} ${x.vechi ?? '—'} → ${x.nou ?? '—'}`)
  const c = (relevante || []).map(x => `${x.eticheta} (${valoare(x, x.vechi)} → ${valoare(x, x.nou)})`)
  return [...d, ...c].join('; ')
}
export function descrieAprobareaVeche(v) {
  const p = [`cantitate ${fmtRo(v?.cantitate)}${v?.cantitate == null ? '' : ' ' + (v?.um || 'm')}`]
  if (v?.cantitate_plansa != null) p.push(`cifra din planșă ${fmtRo(v.cantitate_plansa)} m`)
  if (v?.updated_at) p.push(`ultima scriere ${String(v.updated_at).slice(0, 16).replace('T', ' ')}`)
  return p.join(', ')
}
// scoate un prefix de invalidare anterior (să nu se adune la fiecare ciclu validare → schimbare)
export const faraPrefixVechi = nota => String(nota ?? '').replace(/^Rândul era VALIDAT — aprobarea veche \([^]*?validarea se reface\.\s*/, '')
export function notaInvalidare(vechi, sch, notaNoua) {
  return `${PREFIX_INVALIDARE} (${descrieAprobareaVeche(vechi)}) nu mai e valabilă: s-a schimbat ${descrieSchimbari(sch)}. ` +
    `Valoarea și aprobarea veche rămân în istoric; validarea se reface. ` + faraPrefixVechi(notaNoua)
}

// Regula la nivel de aplicație (pereche cu trigger-ul din BD, ca protecția să nu depindă doar de el):
// rând 'validat' + patch care schimbă relevant un atribut ⇒ patch cu status 'diferenta' și nota de invalidare.
// Un patch care pune el însuși alt status (ex. transferul care a scris deja „Rândul era VALIDAT cu …”) se lasă cum e.
// → { patch, invalidat: bool, schimbari }
export function aplicaRegulaAprobare(vechi, patch) {
  const sch = schimbariRelevante(vechi, patch)
  if (vechi?.status !== STATUS_VALIDAT || !sch.relevante.length) return { patch, invalidat: false, schimbari: sch }
  if (patch && 'status' in patch && patch.status !== STATUS_VALIDAT) return { patch, invalidat: true, schimbari: sch }
  const notaNoua = patch && 'diferenta_nota' in patch ? patch.diferenta_nota : vechi.diferenta_nota
  return { patch: { ...patch, status: STATUS_DE_REVERIFICAT, diferenta_nota: notaInvalidare(vechi, sch, notaNoua) }, invalidat: true, schimbari: sch }
}
