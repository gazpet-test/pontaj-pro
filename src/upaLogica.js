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

// ─── Salvarea unei achiziții din formular (runda 3: L04 / L05 / L16; P1 + P2 din review) ──────────────────────────────────
// Prin RPC-ul idempotent fn_upa_achizitie_adauga(p_cheie, p_rand): cheia de intenție (UUID per formular, refolosită la reîncercare)
// + amprenta DURABILĂ a valorilor, ținută de BD pe TOATE câmpurile intenției (hash_intentie). Reconcilierea e pe server: o reîncercare cu
// aceeași cheie găsește rândul intrat și întoarce 'existent', chiar dacă între timp dreptul de scriere s-a retras. Rezultatul unei încercări:
//   'salvat'          { stare: 'nou' | 'existent', id }: rândul cheii există cu EXACT valorile formularului
//   'diferit'         UPA02: cheia există cu ALTE valori — nimic scris, nimic șters, formularul rămâne înghețat
//   'refuzat'         refuz SIGUR (4xx: drept, reguli) și NICIO încercare anterioară a intenției cu rezultat nesigur: PDF-ul se poate scoate
//   'refuzat_nesigur' refuz acum, dar o încercare anterioară a avut rezultat nesigur: refuzul reîncercării NU dovedește refuzul ei
//                     (rândul ei poate exista și trimite la PDF) → nimic șters, formularul rămâne înghețat
//   'necunoscut'      rețea / timeout / 5xx / răspuns în afara contractului / conflict tranzitoriu (40001…): nimic șters, reîncercarea identică
export const CAMPURI_INTENTIE = ['furnizor_id', 'furnizor_nume', 'numar_factura', 'data_factura', 'luna', 'valoare', 'descriere', 'document_path']
export const COD_DIFERIT = 'UPA02'
const CODURI_TRANZITORII = new Set(['40001', '40P01', '55P03', '57014'])
export function stareSalvare(res, ambiguuAnterior = false) {
  const d = res && !res.error ? res.data : null
  if (d && (d.stare === 'nou' || d.stare === 'existent') && Number.isSafeInteger(Number(d.id)) && Number(d.id) > 0) return 'salvat'
  const cod = res?.error?.code
  if (cod === COD_DIFERIT) return 'diferit'
  if (respingereServer(res) && !CODURI_TRANZITORII.has(cod) && res.status !== 408) return ambiguuAnterior ? 'refuzat_nesigur' : 'refuzat'
  return 'necunoscut'
}
// după o încercare cu rezultatul ăsta intenția rămâne NESIGURĂ pentru totdeauna (formularul înghețat, PDF-ul nu se mai scoate niciodată)
export const rezultatNesigur = st => st === 'necunoscut' || st === 'diferit' || st === 'refuzat_nesigur'
// PDF-ul încărcat se scoate DOAR la un refuz sigur al unei intenții fără nicio încercare nesigură (L02 / L05)
export const poateScoatePdf = st => st === 'refuzat'
// textul refuzului (drept / numărul facturii / altceva)
export function mesajRefuzAchizitie(err) {
  if (err?.code === '42501') return 'Nu ai drept să adaugi achiziții (cere acces Administrativ › Unități protejate, editor).'
  if (refuzNumarFactura(err)) return 'Completează numărul facturii (e obligatoriu).'
  return 'Eroare: ' + (err?.message || 'refuzat')
}

// ─── Numărul facturii (20261229b: obligatoriu pe rândurile noi, în BD) ────────────────────────────────────────────────────
// Citește Orice (UPA): numărul de pe card = cel editat de om, altfel cel citit de AI; fără spații la capete; '' = lipsă (confirmarea oprită)
export const numarFacturaUpa = (editat, citit) => String(editat ?? citit ?? '').trim()
// refuzul gărzii din BD: 23514 de la triggerul trg_upa_achizitii_numar_factura sau de la CHECK-ul upa_achizitii_numar_factura_nevid
export const refuzNumarFactura = err => !!err && err.code === '23514'
  && /numar_factura|numarul facturii/i.test(`${err.message || ''} ${err.details || ''} ${err.constraint || ''}`)
export const mesajInsertUpa = err => refuzNumarFactura(err)
  ? 'Completează numărul facturii pe card: fără el factura nu se poate scădea din plafon.'
  : 'Insert achiziție UPA: ' + (err?.message || 'eroare')
// încărcarea PDF-ului: „există deja” la calea intenției (cheia + versiunea fișierului ales) = încărcarea anterioară a ACESTEI intenții
export const pdfExistaDeja = e => !!e && (String(e.statusCode ?? e.status ?? '') === '409' || /already exists|duplicate/i.test(String(e.message || '')))
export const caleaPdf = (luna, cheie, versiune) => `manual/${String(luna).slice(0, 7)}/${cheie}-${versiune}.pdf`
// furnizorii se citesc pe pagini după id (keyset, L23), apoi se ordonează după nume (alfabetul românesc), id la egalitate
export const ordineFurnizori = (a, b) => String(a.nume ?? '').localeCompare(String(b.nume ?? ''), 'ro') || (Number(a.id) - Number(b.id))
// L24 (runda 3): o buclă de paginare se oprește la invalidarea generației — cererea paginii următoare nu mai pleacă
export class Oprit extends Error { constructor() { super('oprit'); this.oprit = true } }
export const paginaCuGarda = (curent, cerePagina) => (ultim, pas) => { if (!curent()) throw new Oprit(); return cerePagina(ultim, pas) }

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
