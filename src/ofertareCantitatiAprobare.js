// ════════════════════════════════════════════════════════════════
// ofertareCantitatiAprobare.js — CE înseamnă „cantitate aprobată" (R5, Copilot 25.09.2026).
//
// Regula: un rând din ofertare_cantitati e APROBAT numai cu status='validat' (bifa ✓ din 📋 Cantități).
// 'extras' (scris de AI, de transferul din planșă sau de citirea CAD) și 'diferenta' (surse care nu se
// potrivesc) sunt DATE DE LUCRU: se arată, se compară, se clarifică — NU se folosesc ca valori aprobate
// (fronturi de grafic, referința F3 a porții propunerii, cifre în texte către autoritate).
// 'revizuit_clarificare' nu e scris de niciun cod azi (0 rânduri în BD la 25.09.2026); până îl bifează
// un om, nu e nici el aprobat.
//
// Cazul care a cerut regula: lic. 95 (Vâlcelele), rândurile 1751–1756, extrase automat din planșa 470
// (status 'extras', tip_sursa NULL). 1751 = Dn200 17.785 m, din care 13.765 m (Nr 1–4) în afara UAT,
// nevalidați. Poarta graficului îi număra „ok" și „Propune din cantități" îi punea ca fronturi.
//
// Funcții PURE (fără React, fără Supabase): se testează cu vitest (ofertareCantitatiAprobare.test.js).
// ════════════════════════════════════════════════════════════════
import { aceeasiValoare, fmtExact, invalidateDinIstoric, normUm, prefixInvalidare, prefixUnitate, unitateSchimbataDinIstoric } from './ofertareCantitatiInvalidare.js'
import { NOTA_LUNGIMI, restantePeTip, textRestante } from './ofertareTransferRestante.js'

export const STATUS_APROBAT = 'validat'
export const esteAprobata = c => c?.status === STATUS_APROBAT

const nr = v => { const x = Number(v); return Number.isFinite(x) ? x : 0 }
const fmt = n => Math.round(n).toLocaleString('ro-RO')
const bazaCol = cantitatiAsumate => cantitatiAsumate === 'plansa' ? 'cantitate_plansa' : 'cantitate'

// ── Rândurile care reprezintă FRONTURILE de lucru (tronsoane cu lungime) ──────
// Mutat NESCHIMBAT din GraficPoarta.jsx (25.09.2026), ca să poată fi testat fără React.
// 17.09.2026, Domnești: generatorul căuta `categorie ~ /rețea/`, nomenclatura de la GAZE. La o
// licitație de APĂ categoriile se cheamă „Conducte și montaj" și „TITLU SECȚIUNE", deci poarta
// găsea 0 rânduri de rețea și butonul rămânea blocat pe o licitație cu datele complete.
// Ordinea contează și NU e o preferință de stil:
//   1. rândurile de TITLU SECȚIUNE („Extindere rețele ... - Făgului") sunt LUNGIMILE REALE pe stradă;
//   2. categoriile de conducte sunt articole de DEVIZ: suma lor (39.772 m la Domnești) e de 7 ori
//      lungimea reală a rețelei. Folosite ca fronturi, ar produce un grafic de șapte ori mai lung.
// De aceea titlurile de secțiune câștigă când există, și nu se amestecă niciodată cele două surse.
const rxFrontTitlu = /re[țt]ea|conduct|extindere/i
const rxFrontCateg = /re[țt]ea|conduct/i
// runda 6 (decis în audit, reversibil): unitatea NORMALIZATĂ (trim + lower + spații Unicode — `normUm`, aceeași ca regula de
// invalidare și ca view-ul / v6): „M” / „m ” sunt metri; „ml” nu.
export const eMetri = c => normUm(c?.um) === 'm'
export function randuriFront(cantitati, baza = 'cantitate') {
  const cuMetri = (cantitati || []).filter(c =>
    eMetri(c) &&
    !/total/i.test(c.obiect || '') &&
    Number(c[baza] ?? c.cantitate) > 0)
  const titluri = cuMetri.filter(c => /titlu/i.test(c.categorie || '') && rxFrontTitlu.test(c.denumire || ''))
  if (titluri.length) return titluri
  return cuMetri.filter(c => rxFrontCateg.test(c.categorie || ''))
}

// ── R5 (Copilot 26.09.2026, condiția 2): rândurile NECESARE care lipsesc din ce e aprobat ──
// Un consumator care folosește doar rândurile validate NU le lasă să dispară tacit: le numără, le listează și își marchează
// rezultatul ca incomplet / de reverificat. „Necesare” = rândurile de rețea (randuriFront) nevalidate + rândurile INVALIDATE
// (nota „Rândul era VALIDAT …”, pusă de regula aprobării) care au ieșit din setul de rețea (ex. unitatea m → ml, categoria
// schimbată): altfel un rând aprobat, redeschis de o schimbare de unitate, n-ar mai apărea nicăieri.
// R5 runda 5 (verificator, MAJOR 1): „invalidat” NU mai depinde doar de textul notei (transferul / CAD rescriu nota oricărui rând
// nevalidat, deci o recitire ștergea semnalul). Surse: `invalidat_istoric` (pus de `marcheazaInvalidate` din istoricul BD —
// ultimul eveniment 'invalidat' / 'redeschis', fără validare după el; aceeași regulă ca v_ofertare_cantitati_nevalidate) SAU
// prefixul regulii în notă (până la aplicarea migrării; transferul și CAD îl păstrează acum, `pastreazaInvalidarea`).
export const esteInvalidat = c => !esteAprobata(c) && (c?.invalidat_istoric === true || prefixInvalidare(c?.diferenta_nota) !== '')
// runda 6: rândul NEAPROBAT a cărui unitate a ieșit din / intrat în „m” (istoric 'unitate_schimbata' după ultima validare, sau
// prefixul „Unitatea s-a schimbat …” pus de editor până la migrare) — nu dispare tacit din semnalul de lipsă când iese din rețea
export const esteUnitateSchimbata = c => !esteAprobata(c) && (c?.unitate_schimbata_istoric === true || prefixUnitate(c?.diferenta_nota) !== '')
// runda 6 (decis în audit, reversibil): rândul TOTAL = „total” în obiect, denumire sau sursă (ca filtrul de rețea qm / view)
export const eRandTotal = c => /total/i.test(`${c?.obiect || ''} ${c?.denumire || ''} ${c?.sursa || ''}`)
// cantitati + evenimentele din ofertare_cantitati_istoric (id, cantitate_id, motiv) => aceleași rânduri, cu `invalidat_istoric`
// pe cele invalidate / redeschise după istoric și `unitate_schimbata_istoric` (runda 6). Istoric indisponibil (migrarea neaplicată)
// = [] => rămân doar prefixele notei.
export function marcheazaInvalidate(cantitati, evenimente) {
  const inv = invalidateDinIstoric(evenimente), um = unitateSchimbataDinIstoric(evenimente)
  return (cantitati || []).map(c => {
    const i = inv.has(Number(c.id)), u = um.has(Number(c.id))
    return i || u ? { ...c, ...(i ? { invalidat_istoric: true } : {}), ...(u ? { unitate_schimbata_istoric: true } : {}) } : c
  })
}
export function randuriLipsa(cantitati, cantitatiAsumate) {
  const baza = bazaCol(cantitatiAsumate)
  const retea = randuriFront(cantitati, baza)
  const inRetea = new Set(retea)
  const cifra = c => { const v = c[baza] ?? c.cantitate; return v == null || v === '' ? null : Number(v) }
  // unitatea afișată normalizată („M” / „m ” = m; sarcina 2 (d): și sinonimele exacte — bucata = buc, m cub = mc), ca sumele pe unitate
  // să nu se despartă pe scriere; unitățile DIFERITE rămân separate (textCantitatiPeUnitati)
  const umAfis = c => umAfisata(c.um) || '—'
  // sarcina 2 (d): rândurile de rețea NEVALIDATE fără cantitate determinată (lic. 3 reală: #6, #7 „Tub protecție … Dn250”, m, NULL) nu
  // intrau în randuriFront (cer cantitate > 0), deci dispăreau TACIT din lipsă (view-ul le număra: memoriu_nevalidate). Acum sunt
  // listate ca „fără cantitate determinată” — numărate separat, nu „0 m”. Același criteriu de rețea ca randuriFront (titluri / categorie).
  const eTitlu = c => /titlu/i.test(c.categorie || '') && rxFrontTitlu.test(c.denumire || '')
  const peTitluri = retea.length > 0 && retea.every(eTitlu)
  const faraCant = (cantitati || []).filter(c => !inRetea.has(c) && !esteAprobata(c) && eMetri(c) && !/total/i.test(c.obiect || '') &&
    (c[baza] ?? c.cantitate) == null && (peTitluri ? eTitlu(c) : rxFrontCateg.test(c.categorie || '')))
  const inFaraCant = new Set(faraCant)
  const afara = (cantitati || []).filter(c => !inRetea.has(c) && !inFaraCant.has(c))
  const lipsa = [
    ...retea.filter(c => !esteAprobata(c)).map(c => ({ id: c.id, denumire: c.denumire, status: c.status, um: 'm', cantitate: cifra(c), motiv: 'nevalidat' })),
    ...faraCant.map(c => ({ id: c.id, denumire: c.denumire, status: c.status, um: 'm', cantitate: null, motiv: 'nevalidat, fără cantitate determinată' })),
    ...afara.filter(c => esteInvalidat(c) && !eRandTotal(c))
      .map(c => ({ id: c.id, denumire: c.denumire, status: c.status, um: umAfis(c), cantitate: cifra(c), motiv: 'invalidat, ieșit din rețea' })),
    // runda 6 (decis în audit, reversibil; minorul 4 al verificatorului): rândul TOTAL invalidat e LISTAT (ca în view,
    // total_invalidate), marcat ca referință — nu se adună la metrii lipsă (ar dubla rândurile pe care le totalizează)
    ...afara.filter(c => esteInvalidat(c) && eRandTotal(c))
      .map(c => ({ id: c.id, denumire: c.denumire, status: c.status, um: umAfis(c), cantitate: cifra(c), motiv: 'invalidat, rând TOTAL (referință, nu se adună)', referinta: true })),
    // runda 6 (minorul 1 al verificatorului): rândul NEAPROBAT ieșit din rețea prin schimbarea unității (m → ml) — nu tacit
    ...afara.filter(c => !esteInvalidat(c) && esteUnitateSchimbata(c) && !eRandTotal(c))
      .map(c => ({ id: c.id, denumire: c.denumire, status: c.status, um: umAfis(c), cantitate: cifra(c), motiv: 'unitate schimbată, ieșit din rețea' })),
  ]
  // sarcina 2 (d): sume pe unitate (fără conversii) + rândurile fără cantitate numărate separat; TOTAL-ul (referinta) nu se adună
  const { peUm, faraCantitate } = grupeDinRanduri(lipsa.filter(x => !x.referinta))
  return { lipsa, peUm, faraCantitate, m: peUm.m || 0 }
}
// ── R5 sarcina 2 (d) (Copilot, închiderea R4/R5): mesajele de lipsă NU agregă „X m” peste unități diferite ──
// Clase: lungimi (m, ml, km, sute m), suprafețe (mp, ha, sute mp), volume (mc, l, sute mc), bucăți, alte unități, fără unitate; fiecare
// unitate rămâne SEPARATĂ în clasa ei (nicio conversie: „1.000 m + 50 ml”, nu „1.050 m” — Copilot: fără conversie automată m ↔ ml).
// Doar sinonimele exacte ale aceleiași unități se unesc (bucata = buc, m cub = mc, m2 = mp, m.l. = ml). Rândurile FĂRĂ cantitate se
// numără separat („N poziții fără cantitate determinată”), nu intră ca 0 în nicio sumă.
const SIN_UM = { bucata: 'buc', bucati: 'buc', 'bucăți': 'buc', 'buc.': 'buc', bc: 'buc', 'm cub': 'mc', m3: 'mc', 'm³': 'mc', 'm2': 'mp', 'm²': 'mp',
  'm.l.': 'ml', 'ml.': 'ml', metri: 'm', metru: 'm', 'm.': 'm' }
export const umAfisata = um => { const u = normUm(um); return u ? (SIN_UM[u] || u) : '' }
const CLASE_UM = [['lungimi', /^(m|ml|km|sute m)$/], ['suprafete', /^(mp|ha|sute mp)$/], ['volume', /^(mc|l|litri|sute mc)$/], ['bucati', /^buc$/]]
export const clasaUnitate = um => { const u = umAfisata(um); if (!u) return 'fara_unitate'; for (const [c, rx] of CLASE_UM) if (rx.test(u)) return c; return 'alte' }
const ETICHETA_CLASA = { lungimi: 'lungimi', suprafete: 'suprafețe', volume: 'volume', bucati: 'bucăți', alte: 'alte unități', fara_unitate: 'fără unitate' }
// reparația rundei 1 (verificatorul UI, minor „0,004 mc apare «0 mc»”): cantitățile din mesajele de lipsă — EXACT (max. 6 zecimale),
// nu rotunjite la 2 (o cantitate nenulă nu mai poate apărea ca 0)
const fmtQ = v => fmtExact(v)
// grupe = { peUm: { um: suma }, faraCantitate: n } — din rânduri ([{um, cantitate}]) sau din view (*_pe_um: {um: {suma, randuri, fara_cantitate}})
export function grupeDinRanduri(items) {
  const peUm = {}; let faraCantitate = 0
  for (const x of items || []) {
    if (x?.cantitate == null || x.cantitate === '' || !Number.isFinite(Number(x.cantitate))) { faraCantitate++; continue }
    const u = umAfisata(x.um) || '—'
    peUm[u] = (peUm[u] || 0) + Number(x.cantitate)
  }
  return { peUm, faraCantitate }
}
export function grupeDinView(peUmView) {
  const peUm = {}; let faraCantitate = 0
  for (const [um, v] of Object.entries(peUmView && typeof peUmView === 'object' ? peUmView : {})) {
    faraCantitate += Number(v?.fara_cantitate) || 0
    if (v?.suma == null || !Number.isFinite(Number(v.suma))) continue
    const u = umAfisata(um) || '—'
    peUm[u] = (peUm[u] || 0) + Number(v.suma)
  }
  return { peUm, faraCantitate }
}
// „1.000 m” (o singură unitate) | „lungimi 1.000 m + 50 ml; bucăți 3 buc; 2 poziții fără cantitate determinată”
export function textCantitatiPeUnitati({ peUm = {}, faraCantitate = 0 } = {}) {
  const intrari = Object.entries(peUm)
  const fc = faraCantitate > 0 ? `${faraCantitate === 1 ? '1 poziție' : `${faraCantitate} poziții`} fără cantitate determinată` : ''
  if (!intrari.length) return fc || 'cantitate necunoscută'
  const fmtU = ([um, v]) => `${fmtQ(v)} ${um === '—' ? '(fără unitate)' : um}`
  if (intrari.length === 1) return [fmtU(intrari[0]), fc].filter(Boolean).join('; ')
  const peClasa = {}
  for (const e of intrari) (peClasa[clasaUnitate(e[0] === '—' ? '' : e[0])] ||= []).push(e)
  const ordine = ['lungimi', 'suprafete', 'volume', 'bucati', 'alte', 'fara_unitate']
  return [...ordine.filter(c => peClasa[c]).map(c => `${ETICHETA_CLASA[c]} ${peClasa[c].map(fmtU).join(' + ')}`), fc].filter(Boolean).join('; ')
}
export function textLipsa({ lipsa }, max = 5) {
  if (!lipsa.length) return ''
  const den = d => { const t = String(d || ''); return t.length > 60 ? t.slice(0, 59) + '…' : t }
  const rand = x => `#${x.id} „${den(x.denumire)}” (${x.status || '—'}${x.motiv !== 'nevalidat' && !x.motiv.startsWith('nevalidat, fără cantitate') ? `, ${x.motiv}` : ''}, ${x.cantitate == null ? 'fără cantitate determinată' : `${fmtQ(x.cantitate)} ${x.um}`})`
  // rândurile TOTAL (referinta) sunt listate, dar nu intră în sume
  const cant = textCantitatiPeUnitati(grupeDinRanduri(lipsa.filter(x => !x.referinta)))
  return `${lipsa.length === 1 ? 'lipsește 1 rând necesar nevalidat' : `lipsesc ${lipsa.length} rânduri necesare nevalidate`} (${cant}): ` +
    lipsa.slice(0, max).map(rand).join('; ') + (lipsa.length > max ? `; … încă ${lipsa.length - max} (📋 Cantități → „N nevalidate”)` : '')
}

// ── R5 sarcina 2 (a) + (c) (Copilot, închiderea R4/R5): SURSA cantităților ──
// „Nimic scris ≠ nicio problemă”: conflictele transferului planșă → cantități care NU au produs niciun rând (v_ofertare_transfer_conflicte,
// deschise = sursă incompletă) și istoricul aprobărilor (ofertare_cantitati_istoric, din care se recunosc rândurile invalidate).
// `sursa` = { conflicte: rândurile view-ului pe licitație, eroare_conflicte, eroare_istoric } — sau null = NECITITĂ. Orice citire eșuată
// (eroare, view inexistent — de ex. codul nou publicat înainte de migrarea 2) = „nu putem verifica” => BLOCK, NU zero restanțe.
const numeDoc = c => { const t = String(c?.nume_original || `document #${c?.document_id ?? '?'}`).split('/').pop(); return t.length > 50 ? t.slice(0, 49) + '…' : t }
// Reparația rundei 1 (ADDENDUM 2 Copilot, b + d): restanțele DISTINCTE, fiecare cu acțiunea ei (src/ofertareTransferRestante.js) — Dn
// nestandard ≠ diametru imposibil, adnotare fără corespondent ≠ tronson suplimentar, transfer amânat ≠ contradicție a autorității —, iar
// lungimile din conflicte NU sunt prezentate ca „metri lipsă” (sunt observații pe planșă, pot fi suprapuse).
export function textConflicteTransfer(desc) {
  const n = desc.reduce((q, c) => q + (Number(c.n) || 0), 0)
  const lista = desc.slice(0, 4).map(c => `„${numeDoc(c)}” (${Number(c.n) || 0}${c.stare === 'neefectuat' ? ', transfer nefăcut' : c.stare === 'legacy_partial' ? ', evaluat de codul vechi' : ''})`).join('; ') +
    (desc.length > 4 ? `; … încă ${desc.length - 4}` : '')
  const rest = textRestante(restantePeTip(desc))
  return `sursă incompletă: ${n === 1 ? '1 restanță deschisă' : `${n} restanțe deschise`} la transferul din ${desc.length === 1 ? '1 planșă' : `${desc.length} planșe`} (${lista})` +
    (rest ? ` — ${rest}` : '') + ` — nescrise în cantități, deci neaprobate de nimeni (${NOTA_LUNGIMI}); recitește planșa sau confirmă explicit (✋ rezolvare / excepție justificată) în Documente`
}
export function stareSursa(sursa) {
  if (!sursa) return { verificata: false, blocheaza: true, conflicte: [], text: 'nu putem verifica sursa cantităților (conflictele transferului din planșe și istoricul aprobărilor nu s-au citit)' }
  const parti = []
  if (sursa.eroare_istoric) parti.push(`nu putem verifica invalidările (istoricul aprobărilor indisponibil: ${sursa.eroare_istoric})`)
  if (sursa.eroare_conflicte) parti.push(`nu putem verifica sursa (conflictele transferului din planșe indisponibile: ${sursa.eroare_conflicte})`)
  const toate = Array.isArray(sursa.conflicte) ? sursa.conflicte : []
  const desc = toate.filter(c => c?.deschis === true)
  const inCurs = toate.filter(c => c?.in_curs === true)
  if (desc.length) parti.push(textConflicteTransfer(desc))
  if (inCurs.length) parti.push(`transfer în curs pe ${inCurs.map(c => `„${numeDoc(c)}”`).join(', ')} — reîncarcă după ce se termină`)
  return { verificata: !sursa.eroare_istoric && !sursa.eroare_conflicte, blocheaza: parti.length > 0, conflicte: desc, text: parti.join(' · ') }
}

// ── Rândul „cant" din poarta graficului ──
// BLOCK cât timp vreun rând de rețea folosit ca front nu e validat: graficul se îngheață în
// grafic_versiuni și ajunge în propunerea tehnică; o cifră extrasă automat nu intră acolo ca aprobată.
// Schimbare față de regula veche: o diferență memoriu/planșă NU se mai închide doar alegând baza —
// rândul trebuie și validat (alegerea bazei spune CARE coloană, nu că cifra e verificată).
// R5 condiția 2: textul listează rândurile lipsă (id, denumire, status, cantitate pe unitate) și numără și rândurile invalidate
// ieșite din rețea; `lista` = toate, pentru afișarea completă în poartă.
// Sarcina 2: al treilea parametru `sursa` (stareSursa) — conflictele transferului / citirile eșuate BLOCHEAZĂ chiar cu zero rânduri
// nevalidate; `undefined` = apel fără sursă (compatibil), `null` = sursa necitită => „nu putem verifica”.
export function controlCantitatiGrafic(cantitati, cantitatiAsumate, sursa) {
  const r = controlCantitatiGraficRanduri(cantitati, cantitatiAsumate)
  if (sursa === undefined) return r
  const ss = stareSursa(sursa)
  if (!ss.blocheaza) return { ...r, sursa: ss }
  return { ...r, sursa: ss, stare: 'block', detalii: `${r.detalii} · ${ss.text}` }
}
function controlCantitatiGraficRanduri(cantitati, cantitatiAsumate) {
  const baza = bazaCol(cantitatiAsumate)
  const retea = randuriFront(cantitati, baza)
  const totalRetea = (cantitati || []).find(c => /total/i.test(c.obiect || '') && eMetri(c)) || null
  const nevalidate = retea.filter(c => !esteAprobata(c))
  const cuDif = retea.filter(c => c.status === 'diferenta')
  const mNevalidate = nevalidate.reduce((s, c) => s + nr(c[baza] ?? c.cantitate), 0)
  const L = randuriLipsa(cantitati, cantitatiAsumate)
  const txtTotal = totalRetea
    ? `, total declarat ${fmt(nr(totalRetea.cantitate))} m${esteAprobata(totalRetea) ? '' : ' (nevalidat)'}` : ''
  const base = { k: 'cant', retea, nevalidate, m_nevalidate: mNevalidate, totalRetea, lipsa: L.lipsa, lista: L.lipsa }
  if (!retea.length && !L.lipsa.length) return { ...base, stare: 'block', detalii: 'niciun rând de rețea în Cantități' }
  if (L.lipsa.length) return { ...base, stare: 'block',
    detalii: `${nevalidate.length ? `${nevalidate.length} din ${retea.length} rânduri de rețea NEVALIDATE — ` : ''}${textLipsa(L)} — nu sunt cantități aprobate: graficul ar fi INCOMPLET; verifică-le și validează-le (✓) în 📋 Cantități înainte de grafic`
      + (cuDif.length ? ` · ${cuDif.length} cu diferență memoriu/planșă → alege și baza (memoriu / planșă)` : '') + txtTotal }
  return { ...base, stare: 'ok', detalii: `${retea.length} rânduri rețea, toate validate${txtTotal}` }
}

// ── „Propune din cantități": fronturi DOAR din rândurile validate ──
// Rândurile nevalidate nu se propun (ar deveni fronturi, apoi grafic_fronturi_m în poarta propunerii).
// R5 runda 4 (verificator R3): fiecare front poartă PROVENIENȚA — cantitate_id (rândul-sursă), baza (coloana folosită) și
// lungime_sursa (cifra rândului la propunere). grafic_parametri.parametri e jsonb: câmpurile noi nu cer schimbare de schemă,
// iar consumatorii fronturilor (motorPEHD, v_ofertare_pt_stare.gp) citesc doar nume / lungime_m / dn / echipe.
export function fronturiDinCantitati(cantitati, cantitatiAsumate, sursa) {
  const baza = bazaCol(cantitatiAsumate)
  const retea = randuriFront(cantitati, baza)
  const excluse = retea.filter(c => !esteAprobata(c))
  const fronturi = retea.filter(esteAprobata).map(c => {
    // numele frontului = ce e după liniuță („… - Făgului"), cu em-dash sau minus
    const d = (c.denumire || '').replace(/Țeavă\s+PE\d+\s+SDR\d+\s*/i, '')
    const dupaLiniuta = d.split(/\s[—–-]\s/).slice(1).join(' - ').trim()
    return {
      nume: dupaLiniuta || d.slice(0, 40),
      lungime_m: Math.round(Number(c[baza] ?? c.cantitate)),
      dn: ((c.denumire || '').match(/D[ne]?\s*(\d{2,3})/i) || [])[1] || '',
      echipe: 1,
      cantitate_id: c.id ?? null, baza, lungime_sursa: Number(c[baza] ?? c.cantitate),
    }
  })
  // R5 condiția 2: și rândurile invalidate ieșite din rețea sunt numite (nu devin fronturi, dar nici nu dispar tacit)
  const L = randuriLipsa(cantitati, cantitatiAsumate)
  // sarcina 2: și sursa incompletă (conflicte de transfer / citiri eșuate) face fronturile INCOMPLETE — numită, nu tăcută
  const ss = sursa === undefined ? null : stareSursa(sursa)
  return { fronturi, excluse, m_excluse: excluse.reduce((s, c) => s + nr(c[baza] ?? c.cantitate), 0), lipsa: L.lipsa, text_lipsa: textLipsa(L, 4),
    text_sursa: ss?.blocheaza ? ss.text : '' }
}

// ── Rândul „front" din poarta graficului (R5 runda 4, verificator R3) ──
// (1) Referința: totalul declarat (rândul „total … m") DOAR dacă e validat; altfel suma rândurilor de rețea VALIDATE
//     (pe baza aleasă). Înainte: un total 'extras' de 50.000 m era referința și putea da „ok" (ADV6).
// (2) Fronturile SALVATE se verifică față de cantitățile de ACUM: un front care nu vine dintr-un rând validat cu aceeași
//     cifră e BLOCK până la re-propunere. Cazuri: salvat înainte de 26.09 fără legătură (lic. 3: 6 fronturi / 29.985 m din
//     04.09, baza „planșe"), rând-sursă nevalidat / șters / redeschis, altă bază, cifra rândului schimbată de la propunere.
//     Un front introdus MANUAL (＋, `manual: true`) e decizia omului: trece, dar e numărat în detalii.
export function controlFronturiGrafic(p, cantitati, sursa) {
  const baza = bazaCol(p?.cantitati_asumate)
  const retea = randuriFront(cantitati, baza)
  const totalRetea = (cantitati || []).find(c => /total/i.test(c.obiect || '') && eMetri(c)) || null
  const fronturi = p?.fronturi || []
  const lf = fronturi.reduce((s, f) => s + (Number(f.lungime_m) || 0), 0)
  const totalAprobat = esteAprobata(totalRetea) && nr(totalRetea.cantitate) > 0
  const ref = totalAprobat ? nr(totalRetea.cantitate) : retea.filter(esteAprobata).reduce((s, c) => s + nr(c[baza] ?? c.cantitate), 0)
  const refTxt = totalAprobat ? 'totalul declarat (validat)' : `rețeaua validată${totalRetea ? '; totalul declarat e nevalidat, nu e referință' : ''}`
  const peId = new Map((cantitati || []).map(c => [c.id, c]))
  const probleme = []
  let manuale = 0
  fronturi.forEach((f, i) => {
    const et = `„${f.nume || `frontul ${i + 1}`}"`
    if (f.manual) { manuale++; return }
    if (f.cantitate_id == null) { probleme.push(`${et} e salvat fără legătură cu un rând de cantități (dinainte de 26.09.2026)`); return }
    const c = peId.get(f.cantitate_id)
    if (!c) { probleme.push(`${et}: rândul-sursă #${f.cantitate_id} nu mai există`); return }
    if (!esteAprobata(c)) { probleme.push(`${et}: rândul-sursă #${c.id} nu e validat (${c.status || 'fără status'})`); return }
    if ((f.baza || baza) !== baza) { probleme.push(`${et} e propus pe altă bază (${f.baza === 'cantitate_plansa' ? 'planșe' : 'memoriu / F3'})`); return }
    const acum = nr(c[baza] ?? c.cantitate)
    // runda 1b (Copilot, închiderea R4/R5): frontul e al cifrei de la propunere — ORICE altă valoare (nu doar ≥ 1 m) cere repropunere
    if (f.lungime_sursa != null && !aceeasiValoare(acum, f.lungime_sursa))
      probleme.push(`${et}: rândul-sursă #${c.id} s-a schimbat de la propunere (${fmt(f.lungime_sursa)} → ${fmt(acum)} m)`)
  })
  // R5 condiția 2: referința (rețeaua validată) și fronturile exclud rândurile nevalidate => rezultatul NU e complet; niciun „ok” verde
  const L = randuriLipsa(cantitati, p?.cantitati_asumate)
  // sarcina 2: sursa incompletă (conflicte de transfer nerezolvate / istoric sau conflicte necitite) — referința NU e completă
  const ss = sursa === undefined ? null : stareSursa(sursa)
  const incSursa = !!ss?.blocheaza
  const incomplet = L.lipsa.length || incSursa ? `INCOMPLET, de reverificat — ${[L.lipsa.length ? textLipsa(L, 3) : '', incSursa ? ss.text : ''].filter(Boolean).join(' · ')}; ` : ''
  const base = { k: 'front', ref, lf, probleme, manuale, totalAprobat, lipsa: L.lipsa, incomplet: !!(L.lipsa.length || incSursa) }
  if (!fronturi.length) return { ...base, stare: 'block', detalii: incomplet + 'nedefinite — „Propune din cantități" apoi ajustezi' }
  if (probleme.length) return { ...base, stare: 'block',
    detalii: incomplet + `${probleme.length} din ${fronturi.length} fronturi nu vin din cantități validate cu cifra de acum — apasă „Propune din cantități" (sau adaugă-le manual cu ＋): ` +
      probleme.slice(0, 4).join('; ') + (probleme.length > 4 ? `; … încă ${probleme.length - 4}` : '') }
  const dev = ref ? Math.abs(lf - ref) / ref : 1
  return { ...base, stare: dev > 0.1 || base.incomplet ? 'warn' : 'ok',
    detalii: incomplet + `${fronturi.length} fronturi, ${fmt(lf)} m (${ref ? `${Math.round(lf / ref * 100)}% din ${refTxt}` : 'fără referință validată'})` +
      (manuale ? ` · ${manuale} introduse manual` : '') }
}

// ── Poarta propunerii, rândul „grafic”: versiunea ÎNGHEȚATĂ reverificată față de cantitățile de ACUM (R5 runda 5, minorul 5) ──
// H2 leagă F3 de fronturi, dar nu vede un rând-sursă de front (memoriu / planșă) invalidat DUPĂ îngheț (Dn / tronson schimbat,
// aceeași lungime) și nici rândurile necesare nevalidate ivite după îngheț. Se rulează controlFronturiGrafic pe fronturile
// versiunii înghețate (snapshot.parametri) față de cantitățile de acum (cu `marcheazaInvalidate`) => WARN „de reverificat”.
// `parametri` lipsă (nicio versiune / versiune fără parametri) => {} (rândul „grafic” rămâne ca înainte).
export function reverificareGraficInghetat(parametri, cantitati) {
  if (!parametri || !Array.isArray(parametri.fronturi)) return {}
  const c = controlFronturiGrafic(parametri, cantitati)
  const parti = []
  if (c.probleme.length) parti.push(`${c.probleme.length} din ${parametri.fronturi.length} fronturi nu mai vin din cantități validate cu cifra de acum: ` +
    c.probleme.slice(0, 3).join('; ') + (c.probleme.length > 3 ? `; … încă ${c.probleme.length - 3}` : ''))
  if (c.lipsa.length) parti.push(textLipsa({ lipsa: c.lipsa }, 3))
  return { grafic_de_reverificat: c.probleme.length + c.lipsa.length, grafic_de_reverificat_text: parti.join(' · ') }
}

// ── Poarta propunerii (H2): câmpurile din v_ofertare_cantitati_nevalidate ──
// View PROPUS în docs/R5_MIGRARE_PROPUSA_cantitati_nevalidate.sql (neaplicat la 25.09.2026), cu EXACT
// filtrul de rețea din v_ofertare_pt_stare.qm. Se lipește peste rândul din v_ofertare_pt_stare, ca
// v_ofertare_pt_cerinte_neconfirmate. Eroare / view lipsă = câmpuri ABSENTE => controlCantitati nu poate
// verifica F3 și blochează (control indisponibil ≠ zero). Rând lipsă = licitația n-are rânduri de rețea = 0.
// Sarcina 2 (c): eroare / view lipsă => pe lângă câmpurile absente, `cantitati_nevalidate_indisponibil` (motivul) — controlCantitati spune
// explicit „nu putem verifica cantitățile / sursa” și blochează (inclusiv când F3 lipsește), nu întoarce zero restanțe.
export function campuriCantitatiNevalidate(r) {
  if (!r) return { cantitati_nevalidate_indisponibil: 'nicio citire' }
  if (r.error) return { cantitati_nevalidate_indisponibil: String(r.error?.message || r.error || 'eroare').slice(0, 160) }
  const d = r.data || {}
  const n = v => (v == null ? 0 : Number(v))
  const m = v => (v == null ? null : Number(v))
  // R5 condiția 2: câmpurile noi (fără tip, invalidate ieșite din rețea). Rând prezent fără câmp = view-ul în versiunea veche =>
  // `undefined` (controlCantitati spune „control parțial”, nu „0”); rând absent = licitația n-are rânduri de rețea = 0.
  const nou = (k, f) => (r.data && !(k in d) ? undefined : f(d[k]))
  return {
    lista_f3_nevalidate: n(d.lista_f3_nevalidate),
    lista_f3_nevalidate_m: m(d.lista_f3_nevalidate_m),
    lista_c6_nevalidate: n(d.lista_c6_nevalidate),
    memoriu_nevalidate: n(d.memoriu_nevalidate),
    plansa_nevalidate: n(d.plansa_nevalidate),
    fara_tip_nevalidate: nou('fara_tip_nevalidate', n),
    fara_tip_nevalidate_m: nou('fara_tip_nevalidate_m', m),
    retea_nevalidate: nou('retea_nevalidate', n),
    retea_nevalidate_m: nou('retea_nevalidate_m', m),
    invalidate_in_afara_retea: nou('invalidate_in_afara_retea', n),
    invalidate_in_afara_retea_m: nou('invalidate_in_afara_retea_m', m),
    // runda 6: rândurile TOTAL invalidate, rândurile neaprobate cu unitatea schimbată ieșite din rețea, rândurile de rețea cu unitatea
    // scrisă altfel decât exact „m” (v_ofertare_pt_stare.qm nu le adună)
    total_invalidate: nou('total_invalidate', n),
    total_invalidate_m: nou('total_invalidate_m', m),
    unitate_schimbata_in_afara_retea: nou('unitate_schimbata_in_afara_retea', n),
    unitate_schimbata_in_afara_retea_m: nou('unitate_schimbata_in_afara_retea_m', m),
    um_de_normalizat: nou('um_de_normalizat', n),
    um_de_normalizat_m: nou('um_de_normalizat_m', m),
    um_de_normalizat_f3: nou('um_de_normalizat_f3', n),
    // sarcina 2 (d): defalcarea pe unitate a grupurilor din afara rețelei (*_m = doar rândurile în m) + rândurile fără cantitate
    invalidate_in_afara_retea_pe_um: nou('invalidate_in_afara_retea_pe_um', v => v || {}),
    total_invalidate_pe_um: nou('total_invalidate_pe_um', v => v || {}),
    unitate_schimbata_in_afara_retea_pe_um: nou('unitate_schimbata_in_afara_retea_pe_um', v => v || {}),
    lista_f3_nevalidate_fara_cant: nou('lista_f3_nevalidate_fara_cant', n),
    fara_tip_nevalidate_fara_cant: nou('fara_tip_nevalidate_fara_cant', n),
    um_de_normalizat_fara_cant: nou('um_de_normalizat_fara_cant', n),
    // sarcina 2 (a): planșele cu conflicte de transfer DESCHISE (v_ofertare_transfer_conflicte) — și când nu există niciun rând
    transfer_conflicte_docs: nou('transfer_conflicte_docs', n),
    transfer_conflicte_n: nou('transfer_conflicte_n', n),
    transfer_conflicte_lista: nou('transfer_conflicte_lista', v => v ?? null),
    transfer_in_curs: nou('transfer_in_curs', n),
    // reparația rundei 1: restanțele distincte pe licitație {tip: n}
    transfer_restante: nou('transfer_restante', v => (v && typeof v === 'object' ? v : {})),
  }
}
