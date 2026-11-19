// Unități protejate (UPA, 20261229a) — logica pură a ecranului (fără rețea; testele: src/upaAlerta.test.js).
// Ce e „sub plafon după ziua din setări” NU se calculează aici: vine calculat din BD (fn_upa_luni.in_alerta, L19).
import { lei } from '../supabase/functions/_shared/upaAlerta.mjs'
import { respingereServer } from './citesteOriceDubluri.js'

// ziua de azi în România (L17: nu UTC, nu new Date('YYYY-MM-DD'))
export const ziRO = (acum = new Date()) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Bucharest' }).format(acum)

const ZI = /^(\d{4})-(\d{2})-(\d{2})$/
// 'AAAA-LL-ZZ' -> 'AAAA-LL-01'; altceva -> null
export function lunaDinZi(zi) {
  const m = ZI.exec(String(zi ?? ''))
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return null
  return `${m[1]}-${m[2]}-01`
}
// prima zi a lunii de acum n luni (n >= 0), din ziua dată
export function luniInapoi(zi, n) {
  const m = ZI.exec(String(zi ?? ''))
  if (!m) return null
  const t = Number(m[1]) * 12 + (Number(m[2]) - 1) - n
  return `${Math.floor(t / 12)}-${String(t % 12 + 1).padStart(2, '0')}-01`
}

const LUNI = ['ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie', 'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie']
const numeLuna = l => { const x = lunaDinZi(l); return x ? `${LUNI[Number(x.slice(5, 7)) - 1]} ${x.slice(0, 4)}` : '—' }

// plafonul scris în ecran (input type=number: punct zecimal): număr pozitiv, cel mult 2 zecimale, sub 10 milioane
export function validaPlafon(text) {
  const t = String(text ?? '').trim()
  if (!/^[0-9]{1,7}([.][0-9]{1,2})?$/.test(t)) return { eroare: 'Plafonul trebuie să fie un număr pozitiv, cu cel mult două zecimale.' }
  const v = Number(t)
  if (!Number.isFinite(v) || v <= 0) return { eroare: 'Plafonul trebuie să fie mai mare ca zero.' }
  return { valoare: v }
}

// avertismentele la adăugarea unei achiziții (nu blochează salvarea)
export function avertismenteAchizitie({ dataFactura, luna, arePdf }) {
  const a = []
  if (!arePdf) a.push({ cod: 'fara_pdf', text: 'Fără PDF: factura nu are dovada atașată pentru control.' })
  const ld = lunaDinZi(dataFactura), ll = lunaDinZi(luna)
  if (ld && ll && ld !== ll) a.push({ cod: 'luna_diferita', text: `Factura e din ${numeLuna(ld)}, dar se scade din ${numeLuna(ll)}.` })
  return a
}

// ─── Salvarea unei achiziții din formular (L04 / L05, runda 2) ───────────────────────────────────────────────────────────
// Fiecare formular are o cheie de intenție (UUID, coloana cheie_intentie, UNIQUE în BD); reîncercarea trimite ACEEAȘI cheie,
// deci o salvare intrată cu răspunsul pierdut nu se dublează. Rezultatul:
//   'salvat'     INSERT-ul a întors rândul, sau rândul cu cheia noastră se vede (după un răspuns pierdut / conflict pe cheie)
//   'refuzat'    serverul a refuzat SIGUR (4xx, respingereServer) și nu e conflictul cheii noastre: nimic scris, PDF-ul se poate scoate
//   'necunoscut' rețea / timeout / 5xx / răspuns ciudat și rândul nu se vede (sau citirea a picat): nu se șterge nimic, formularul
//                rămâne înghețat, singura acțiune e reîncercarea identică
//   'diferit'    rândul cu cheia noastră există, dar cu alte valori (n-ar trebui să se întâmple: formularul e înghețat) — nimic șters
export const CONSTRANGERE_CHEIE = 'upa_achizitii_cheie_intentie_uidx'
export const conflictCheie = res => !!(res && res.error && res.error.code === '23505' && String(res.error.message || '').includes(CONSTRANGERE_CHEIE))
// trebuie citit rândul după cheie? (tot ce nu e rând întors sau refuz sigur fără legătură cu cheia)
export function citireDupaSalvare(res) {
  if (res && !res.error && Array.isArray(res.data) && res.data.length === 1) return false
  if (conflictCheie(res)) return true
  return !respingereServer(res)
}
// același rând? (valorile pe care le-a scris formularul)
export function acelasiRand(r, p) {
  if (!r || !p) return false
  const n = x => x == null || x === '' ? null : String(x)
  return n(r.numar_factura) === n(p.numar_factura) && String(r.luna).slice(0, 10) === String(p.luna).slice(0, 10)
    && Number(r.valoare) === Number(p.valoare) && n(r.furnizor_id) === n(p.furnizor_id) && n(r.document_path) === n(p.document_path)
}
// res = răspunsul INSERT-ului ({ data, error, status }; o excepție = { error } fără status); citire = { data: rând | null, error } după cheie
export function stareSalvare(res, citire, payload) {
  if (res && !res.error && Array.isArray(res.data) && res.data.length === 1) return 'salvat'
  if (respingereServer(res) && !conflictCheie(res)) return 'refuzat'
  const { data: r, error: e } = citire || {}
  if (!citire || e || !r) return 'necunoscut'
  return acelasiRand(r, payload) ? 'salvat' : 'diferit'
}
// încărcarea PDF-ului: „există deja” la calea intenției (cheia + versiunea fișierului ales) = încărcarea anterioară a ACESTEI intenții
export const pdfExistaDeja = e => !!e && (String(e.statusCode ?? e.status ?? '') === '409' || /already exists|duplicate/i.test(String(e.message || '')))
export const caleaPdf = (luna, cheie, versiune) => `manual/${String(luna).slice(0, 7)}/${cheie}-${versiune}.pdf`
// furnizorii se citesc pe pagini după id (keyset, L23), apoi se ordonează după nume (alfabetul românesc), id la egalitate
export const ordineFurnizori = (a, b) => String(a.nume ?? '').localeCompare(String(b.nume ?? ''), 'ro') || (Number(a.id) - Number(b.id))

// textul unei luni din istoric (rândurile fn_upa_luni): plafonul ACELEI luni, necheltuitul de la închidere (instantaneul), diferențele de după
export function starePlafonLuna(l) {
  const plafon = l.plafon == null ? null : Number(l.plafon)
  const consumat = Number(l.consumat) || 0
  if (l.e_curenta) {
    if (plafon == null) return { text: 'în curs · plafon neînregistrat', ton: 'galben' }
    const r = Math.max(0, plafon - consumat)
    return r > 0 ? { text: `în curs · rămân ${lei(r)} lei`, ton: l.in_alerta ? 'rosu' : 'gri' } : { text: 'în curs · plafon consumat ✓', ton: 'verde' }
  }
  if (l.inchisa) {
    const rn = Number(l.ramas_necheltuit) || 0
    const dupa = consumat - (Number(l.consumat_inchis) || 0)
    const extra = Math.abs(dupa) >= 0.005 ? ` · după închidere ${dupa > 0 ? '+' : '−'}${lei(Math.abs(dupa))} lei` : ''
    return rn > 0 ? { text: `necheltuit ${lei(rn)} lei (de plătit la bugetul de stat, plafon ${lei(l.plafon_inchis)})${extra}`, ton: 'rosu' }
      : { text: `plafon consumat ✓${extra}`, ton: 'verde' }
  }
  if (plafon == null) return { text: 'plafon neînregistrat pentru luna asta', ton: 'gri' }
  const r = Math.max(0, plafon - consumat)
  return { text: r > 0 ? `neînchisă · estimat necheltuit ${lei(r)} lei` : 'neînchisă · plafon consumat ✓', ton: r > 0 ? 'galben' : 'verde' }
}
