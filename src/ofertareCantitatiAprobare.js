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
export function randuriFront(cantitati, baza = 'cantitate') {
  const cuMetri = (cantitati || []).filter(c =>
    String(c.um || '').toLowerCase() === 'm' &&
    !/total/i.test(c.obiect || '') &&
    Number(c[baza] ?? c.cantitate) > 0)
  const titluri = cuMetri.filter(c => /titlu/i.test(c.categorie || '') && rxFrontTitlu.test(c.denumire || ''))
  if (titluri.length) return titluri
  return cuMetri.filter(c => rxFrontCateg.test(c.categorie || ''))
}

// ── Rândul „cant" din poarta graficului ──
// BLOCK cât timp vreun rând de rețea folosit ca front nu e validat: graficul se îngheață în
// grafic_versiuni și ajunge în propunerea tehnică; o cifră extrasă automat nu intră acolo ca aprobată.
// Schimbare față de regula veche: o diferență memoriu/planșă NU se mai închide doar alegând baza —
// rândul trebuie și validat (alegerea bazei spune CARE coloană, nu că cifra e verificată).
export function controlCantitatiGrafic(cantitati, cantitatiAsumate) {
  const baza = bazaCol(cantitatiAsumate)
  const retea = randuriFront(cantitati, baza)
  const totalRetea = (cantitati || []).find(c => /total/i.test(c.obiect || '') && c.um === 'm') || null
  const nevalidate = retea.filter(c => !esteAprobata(c))
  const cuDif = retea.filter(c => c.status === 'diferenta')
  const mNevalidate = nevalidate.reduce((s, c) => s + nr(c[baza] ?? c.cantitate), 0)
  const txtTotal = totalRetea
    ? `, total declarat ${fmt(nr(totalRetea.cantitate))} m${esteAprobata(totalRetea) ? '' : ' (nevalidat)'}` : ''
  const base = { k: 'cant', retea, nevalidate, m_nevalidate: mNevalidate, totalRetea }
  if (!retea.length) return { ...base, stare: 'block', detalii: 'niciun rând de rețea în Cantități' }
  if (nevalidate.length) return { ...base, stare: 'block',
    detalii: `${nevalidate.length} din ${retea.length} rânduri de rețea NEVALIDATE (${fmt(mNevalidate)} m: 🤖 extras / ⚠ diferență) — nu sunt cantități aprobate; verifică-le și validează-le (✓) în 📋 Cantități înainte de grafic`
      + (cuDif.length ? ` · ${cuDif.length} cu diferență memoriu/planșă → alege și baza (memoriu / planșă)` : '') + txtTotal }
  return { ...base, stare: 'ok', detalii: `${retea.length} rânduri rețea, toate validate${txtTotal}` }
}

// ── „Propune din cantități": fronturi DOAR din rândurile validate ──
// Rândurile nevalidate nu se propun (ar deveni fronturi, apoi grafic_fronturi_m în poarta propunerii).
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
    }
  })
  return { fronturi, excluse, m_excluse: excluse.reduce((s, c) => s + nr(c[baza] ?? c.cantitate), 0) }
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
  return {
    lista_f3_nevalidate: n(d.lista_f3_nevalidate),
    lista_f3_nevalidate_m: d.lista_f3_nevalidate_m == null ? null : Number(d.lista_f3_nevalidate_m),
    lista_c6_nevalidate: n(d.lista_c6_nevalidate),
    memoriu_nevalidate: n(d.memoriu_nevalidate),
    plansa_nevalidate: n(d.plansa_nevalidate),
  }
}
