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
import { invalidateDinIstoric, normUm, prefixInvalidare, prefixUnitate, unitateSchimbataDinIstoric } from './ofertareCantitatiInvalidare.js'

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
  const afara = (cantitati || []).filter(c => !inRetea.has(c))
  // unitatea afișată normalizată („M” / „m ” = m), ca sumele pe unitate să nu se despartă pe scriere
  const umAfis = c => (c.um == null || String(c.um).trim() === '' ? '—' : eMetri(c) ? 'm' : String(c.um).trim())
  const lipsa = [
    ...retea.filter(c => !esteAprobata(c)).map(c => ({ id: c.id, denumire: c.denumire, status: c.status, um: 'm', cantitate: cifra(c), motiv: 'nevalidat' })),
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
  const peUm = {}
  for (const x of lipsa) if (x.cantitate != null && !x.referinta) peUm[x.um] = (peUm[x.um] || 0) + x.cantitate
  return { lipsa, peUm, m: peUm.m || 0 }
}
const cantPeUm = peUm => Object.entries(peUm).map(([um, v]) => `${fmt(v)} ${um}`).join(' + ') || 'cantitate necunoscută'
export function textLipsa({ lipsa, peUm }, max = 5) {
  if (!lipsa.length) return ''
  const den = d => { const t = String(d || ''); return t.length > 60 ? t.slice(0, 59) + '…' : t }
  const rand = x => `#${x.id} „${den(x.denumire)}” (${x.status || '—'}${x.motiv !== 'nevalidat' ? `, ${x.motiv}` : ''}, ${x.cantitate == null ? '?' : fmt(x.cantitate)} ${x.um})`
  return `${lipsa.length === 1 ? 'lipsește 1 rând necesar nevalidat' : `lipsesc ${lipsa.length} rânduri necesare nevalidate`} (${cantPeUm(peUm)}): ` +
    lipsa.slice(0, max).map(rand).join('; ') + (lipsa.length > max ? `; … încă ${lipsa.length - max} (📋 Cantități → „N nevalidate”)` : '')
}

// ── Rândul „cant" din poarta graficului ──
// BLOCK cât timp vreun rând de rețea folosit ca front nu e validat: graficul se îngheață în
// grafic_versiuni și ajunge în propunerea tehnică; o cifră extrasă automat nu intră acolo ca aprobată.
// Schimbare față de regula veche: o diferență memoriu/planșă NU se mai închide doar alegând baza —
// rândul trebuie și validat (alegerea bazei spune CARE coloană, nu că cifra e verificată).
// R5 condiția 2: textul listează rândurile lipsă (id, denumire, status, cantitate pe unitate) și numără și rândurile invalidate
// ieșite din rețea; `lista` = toate, pentru afișarea completă în poartă.
export function controlCantitatiGrafic(cantitati, cantitatiAsumate) {
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
export function fronturiDinCantitati(cantitati, cantitatiAsumate) {
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
  return { fronturi, excluse, m_excluse: excluse.reduce((s, c) => s + nr(c[baza] ?? c.cantitate), 0), lipsa: L.lipsa, text_lipsa: textLipsa(L, 4) }
}

// ── Rândul „front" din poarta graficului (R5 runda 4, verificator R3) ──
// (1) Referința: totalul declarat (rândul „total … m") DOAR dacă e validat; altfel suma rândurilor de rețea VALIDATE
//     (pe baza aleasă). Înainte: un total 'extras' de 50.000 m era referința și putea da „ok" (ADV6).
// (2) Fronturile SALVATE se verifică față de cantitățile de ACUM: un front care nu vine dintr-un rând validat cu aceeași
//     cifră e BLOCK până la re-propunere. Cazuri: salvat înainte de 26.09 fără legătură (lic. 3: 6 fronturi / 29.985 m din
//     04.09, baza „planșe"), rând-sursă nevalidat / șters / redeschis, altă bază, cifra rândului schimbată de la propunere.
//     Un front introdus MANUAL (＋, `manual: true`) e decizia omului: trece, dar e numărat în detalii.
export function controlFronturiGrafic(p, cantitati) {
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
    if (f.lungime_sursa != null && Math.abs(acum - Number(f.lungime_sursa)) >= 1)
      probleme.push(`${et}: rândul-sursă #${c.id} s-a schimbat de la propunere (${fmt(f.lungime_sursa)} → ${fmt(acum)} m)`)
  })
  // R5 condiția 2: referința (rețeaua validată) și fronturile exclud rândurile nevalidate => rezultatul NU e complet; niciun „ok” verde
  const L = randuriLipsa(cantitati, p?.cantitati_asumate)
  const incomplet = L.lipsa.length ? `INCOMPLET, de reverificat — ${textLipsa(L, 3)}; ` : ''
  const base = { k: 'front', ref, lf, probleme, manuale, totalAprobat, lipsa: L.lipsa, incomplet: !!L.lipsa.length }
  if (!fronturi.length) return { ...base, stare: 'block', detalii: incomplet + 'nedefinite — „Propune din cantități" apoi ajustezi' }
  if (probleme.length) return { ...base, stare: 'block',
    detalii: incomplet + `${probleme.length} din ${fronturi.length} fronturi nu vin din cantități validate cu cifra de acum — apasă „Propune din cantități" (sau adaugă-le manual cu ＋): ` +
      probleme.slice(0, 4).join('; ') + (probleme.length > 4 ? `; … încă ${probleme.length - 4}` : '') }
  const dev = ref ? Math.abs(lf - ref) / ref : 1
  return { ...base, stare: dev > 0.1 || L.lipsa.length ? 'warn' : 'ok',
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
  if (c.lipsa.length) parti.push(textLipsa({ lipsa: c.lipsa, peUm: randuriLipsa(cantitati, parametri.cantitati_asumate).peUm }, 3))
  return { grafic_de_reverificat: c.probleme.length + c.lipsa.length, grafic_de_reverificat_text: parti.join(' · ') }
}

// ── Poarta propunerii (H2): câmpurile din v_ofertare_cantitati_nevalidate ──
// View PROPUS în docs/R5_MIGRARE_PROPUSA_cantitati_nevalidate.sql (neaplicat la 25.09.2026), cu EXACT
// filtrul de rețea din v_ofertare_pt_stare.qm. Se lipește peste rândul din v_ofertare_pt_stare, ca
// v_ofertare_pt_cerinte_neconfirmate. Eroare / view lipsă = câmpuri ABSENTE => controlCantitati nu poate
// verifica F3 și blochează (control indisponibil ≠ zero). Rând lipsă = licitația n-are rânduri de rețea = 0.
export function campuriCantitatiNevalidate(r) {
  if (!r || r.error) return {}
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
  }
}
