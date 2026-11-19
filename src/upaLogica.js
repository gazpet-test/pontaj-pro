// Unități protejate (UPA, 20261229a) — logica pură a ecranului (fără rețea; testele: src/upaAlerta.test.js).
// Ce e „sub plafon după ziua din setări” NU se calculează aici: vine calculat din BD (fn_upa_luni.in_alerta, L19).
import { lei } from '../supabase/functions/_shared/upaAlerta.mjs'

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
