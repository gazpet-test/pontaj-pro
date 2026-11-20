// Unități protejate (UPA, 20261229a; calculul 20270101a) — logica pură a ecranului (fără rețea; testele: src/upaAlerta.test.js).
// Contribuția, deducerea, reportul și „mai e de cumpărat după ziua din setări” NU se calculează aici: vin din BD (fn_upa_situatie, L19).
import { lei, ziText } from '../supabase/functions/_shared/upaAlerta.mjs'
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

// o sumă scrisă în ecran (input type=number: punct zecimal): număr cu cel mult 2 zecimale, sub 10 milioane; zero doar dacă e permis
export function validaSuma(text, { zero = false, ce = 'Suma' } = {}) {
  const t = String(text ?? '').trim()
  if (!/^[0-9]{1,7}([.][0-9]{1,2})?$/.test(t)) return { eroare: `${ce} trebuie să fie un număr, cu cel mult două zecimale.` }
  const v = Number(t)
  if (!Number.isFinite(v) || v < 0 || (!zero && v === 0)) return { eroare: `${ce} trebuie să fie mai mare ca zero.` }
  return { valoare: v }
}
// valoarea fără TVA a unei facturi: obligatorie, > 0 și cel mult valoarea cu TVA (aceeași regulă ca CHECK-ul upa_achizitii_fara_tva_interval)
export function validaFaraTva(text, valoareCuTva) {
  const v = validaSuma(text, { ce: 'Valoarea fără TVA' })
  if (v.eroare) return v
  const c = Number(valoareCuTva)
  if (Number.isFinite(c) && v.valoare > c) return { eroare: 'Valoarea fără TVA nu poate fi mai mare decât valoarea cu TVA.' }
  return v
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
// 20270101a: + valoare_fara_tva, data_plata, stare_plata (aceeași listă ca fn_upa_campuri_intentie_v2 din BD; fără ele, amprenta e cea din 20261229a)
export const CAMPURI_INTENTIE = ['furnizor_id', 'furnizor_nume', 'numar_factura', 'data_factura', 'luna', 'valoare', 'descriere', 'document_path',
  'valoare_fara_tva', 'data_plata', 'stare_plata']
// plata unei facturi din formular / din listă: 'platita' (cu data) / 'neplatita' (știut: nu se deduce) / '' = necunoscut (luna nu se închide);
//   aceeași regulă ca CHECK-ul upa_achizitii_stare_plata
export function validaPlata(stare, data) {
  if (stare === 'platita') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data ?? ''))) return { eroare: 'Alege data plății.' }
    return { stare_plata: 'platita', data_plata: data }
  }
  if (stare === 'neplatita') return { stare_plata: 'neplatita', data_plata: null }
  if (stare === '' || stare == null) return { stare_plata: null, data_plata: null }
  return { eroare: 'Starea plății e necunoscută.' }
}
// starea plății unui rând (pentru listă)
export function textPlata(a) {
  if (!a) return { text: '—', ton: 'gri' }
  if (a.stare_plata === 'platita') {
    const tarziu = String(a.data_plata ?? '').slice(0, 7) > String(a.luna ?? '').slice(0, 7)
    return { text: `plătită ${ziText(a.data_plata)}${tarziu ? ' (după sfârșitul lunii: nu se deduce)' : ''}`, ton: tarziu ? 'rosu' : 'gri' }
  }
  if (a.stare_plata === 'neplatita') return { text: 'neplătită (nu se deduce dacă nu se plătește în lună)', ton: 'galben' }
  return { text: 'plata necompletată (luna nu se poate închide)', ton: 'galben' }
}
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

// ─── Calculul contribuției (20270101a, răspunsul expertului contabil) ────────────────────────────────────────────────────
// Numerele vin calculate din BD (fn_upa_situatie -> fn_upa_calcul_la, L19); aici doar textele ecranului. null = necunoscut, nu 0 (L18).
export const esteNumar = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v))
export const leiSauLipsa = v => esteNumar(v) ? lei(v) : '—'
const nrTxt = (n, unu, multe) => `${n} ${n === 1 ? unu : multe}`
// codurile de blocaj / avertisment ale calculului -> text pentru oameni (necunoscut = codul, lizibil)
const TEXTE_COD = {
  fara_salariu_minim: () => 'salariul minim al lunii nu e înregistrat (Parametri)',
  fara_nr_handicap: () => 'numărul angajaților cu handicap nu e înregistrat (Parametri)',
  fara_inceput_calcul: () => 'prima lună a calculului nu e stabilită (Parametri → report inițial)',
  inainte_de_inceput: () => 'luna e dinaintea primei luni a calculului',
  luna_anterioara_neinchisa: () => 'luna anterioară nu are încă calculul închis',
  report_necunoscut: () => 'reportul din lunile anterioare nu se poate calcula',
  report_din_previziune: () => 'reportul vine din previziunea lunii anterioare',
  pontaj_neinchis: () => 'pontajul lunii nu e încă închis (corecturile se fac până pe 12 a lunii următoare)',
  pontaj_in_curs: () => 'luna e în curs: pontajul zilelor rămase se completează',
  pontaj_lipsa: n => nrTxt(n, 'zi lucrătoare', 'zile lucrătoare') + ' fără pontaj (angajat × zi): se completează pontajul înainte de închidere',
  calendar_incomplet: an => `calendarul sărbătorilor legale pe ${an ?? 'an'} nu e încărcat (Setări → Calendar)`,
  angajati_cu_corectii: n => nrTxt(n, 'angajat cu corecție', 'angajați cu corecții') + ' HR (normă / administrator / suspendare), vezi Detaliu NMA',
  sub_50_angajati: () => 'sub 50 de angajați: nu există obligație',
  achizitii_fara_tva: n => nrTxt(n, 'factură fără', 'facturi fără') + ' valoarea fără TVA',
  achizitii_fara_data_platii: n => nrTxt(n, 'factură fără', 'facturi fără') + ' data plății',
  achizitii_fara_stare_plata: n => nrTxt(n, 'factură', 'facturi') + ' cu plata necompletată (plătită / neplătită)',
  achizitii_neplatite: n => nrTxt(n, 'factură neplătită', 'facturi neplătite') + ' încă (se deduc doar dacă se plătesc până la sfârșitul lunii)',
  achizitii_neplatite_excluse: n => nrTxt(n, 'factură neplătită', 'facturi neplătite') + ' în lună (nu intră în deducere)',
  achizitii_platite_dupa_termen: n => nrTxt(n, 'factură plătită', 'facturi plătite') + ' după sfârșitul lunii (nu intră în deducere)',
  angajati_fara_data_angajarii: n => nrTxt(n, 'angajat', 'angajați') + ' fără data angajării (se completează în HR)',
  angajati_fara_norma: n => nrTxt(n, 'angajat', 'angajați') + ' fără normă (se completează în HR)',
  inactivi_fara_data_incetarii_cu_pontaj: n => nrTxt(n, 'angajat inactiv', 'angajați inactivi') + ' fără data încetării, cu pontaj în lună (se completează data în HR)',
}
export function textCod(cod) {
  const m = /^([a-z_]{1,60})(?::([0-9]{1,6}))?$/.exec(String(cod ?? ''))
  if (!m) return String(cod ?? '')
  const f = TEXTE_COD[m[1]]
  return f ? f(m[2] == null ? null : Number(m[2])) : m[1].replace(/_/g, ' ')
}
const lst = v => Array.isArray(v) ? v : []
// starea unei luni din istoric (un rând din fn_upa_situatie.luni)
export function stareCalculLuna(c) {
  if (!c || typeof c !== 'object') return { text: '—', ton: 'gri' }
  if (c.stare === 'in_afara_calculului') return { text: 'în afara calculului', ton: 'gri' }
  const rep = esteNumar(c.report_iesit) && Number(c.report_iesit) > 0
  if (c.stare === 'definitiv') {
    return { text: `închis · de plată la stat ${lei(c.de_plata)} lei până pe ${ziText(c.termen_stat)}${rep ? ` · se reportează ${lei(c.report_iesit)} lei` : ''}`,
             ton: Number(c.de_plata) > 0 ? 'rosu' : 'verde' }
  }
  if (!esteNumar(c.de_plata)) return { text: 'calcul incomplet: ' + (lst(c.blocaje).map(textCod).join('; ') || 'date lipsă'), ton: 'galben' }
  const pref = c.poate_inchide ? 'gata de închis' : c.pontaj_inchis ? 'de completat înainte de închidere' : 'previziune'
  return { text: `${pref} · de plată ${c.poate_inchide ? '' : 'estimat '}${lei(c.de_plata)} lei${rep ? ` · report ${c.poate_inchide ? '' : 'estimat '}${lei(c.report_iesit)} lei` : ''}`,
           ton: c.poate_inchide ? 'verde' : 'galben' }
}
// eticheta stării (insignă): PREVIZIUNE până la închiderea pontajului, apoi valoarea exactă
export const etichetaStare = c => !c ? '' : c.stare === 'definitiv' ? 'EXACT (închis)' : c.stare === 'previziune' ? (c.pontaj_inchis ? 'DE ÎNCHIS' : 'PREVIZIUNE') : ''

// ─── Parametrii pe perioade (upa_parametri, fn_upa_parametru_seteaza) ──────────────────────────────────────────────────
export const CHEI_PARAMETRI = ['salariu_minim', 'angajati_handicap', 'report_initial']
export const NUME_PARAMETRU = { salariu_minim: 'Salariul minim brut pe țară (lei)', angajati_handicap: 'Angajați cu handicap', report_initial: 'Report inițial (lei, prima lună a calculului)' }
// luna din ecran ('AAAA-LL') + valoarea -> argumentele RPC-ului, sau eroarea
export function validaParametru(cheie, lunaText, text) {
  if (!CHEI_PARAMETRI.includes(cheie)) return { eroare: 'Alege parametrul.' }
  const m = /^(\d{4})-(\d{2})$/.exec(String(lunaText ?? ''))
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return { eroare: 'Alege luna de la care se aplică.' }
  const v = validaSuma(text, { zero: cheie !== 'salariu_minim', ce: 'Valoarea' })
  if (v.eroare) return v
  if (cheie === 'angajati_handicap' && !Number.isInteger(v.valoare)) return { eroare: 'Numărul angajaților cu handicap trebuie să fie întreg.' }
  return { de_la: `${m[1]}-${m[2]}-01`, valoare: v.valoare }
}
// valoarea văzută de om pentru rândul (cheie, de_la) — CAS-ul RPC-ului (p_vechi); null = rândul nu există
export function valoareVazuta(parametri, cheie, deLa) {
  const r = lst(parametri).find(p => p.cheie === cheie && String(p.de_la).slice(0, 10) === deLa)
  return r && esteNumar(r.valoare) ? Number(r.valoare) : null
}
// ─── Corecțiile HR pe interval (upa_angajat_perioade, fn_upa_perioada_adauga; doar owner-ul) ──────────────────────────────
// formularul -> argumentele RPC-ului, sau eroarea (aceleași reguli ca în BD: interval, normă în (0, 1], cel puțin o schimbare, motivul)
export function validaPerioada({ employee_id, de_la, pana_la, norma, administrator, suspendat, nota }) {
  const id = Number(employee_id)
  if (!Number.isSafeInteger(id) || id <= 0) return { eroare: 'Alege angajatul.' }
  if (!ZI.test(String(de_la ?? '')) || !ZI.test(String(pana_la ?? ''))) return { eroare: 'Alege intervalul (de la / până la).' }
  if (String(pana_la) < String(de_la)) return { eroare: '„Până la” e înaintea lui „de la”.' }
  let n = null
  if (String(norma ?? '').trim() !== '') {
    const t = String(norma).trim()
    if (!/^(0([.][0-9]{1,4})?|1([.]0{1,4})?)$/.test(t) || Number(t) <= 0) return { eroare: 'Norma e o fracție între 0 și 1 (ex. 0.5 = 4 ore din 8).' }
    n = Number(t)
  }
  const adm = administrator === 'da' ? true : administrator === 'nu' ? false : null
  const susp = suspendat === true
  if (n === null && adm === null && !susp) return { eroare: 'Alege ce se schimbă: norma, administrator sau suspendare.' }
  const motiv = String(nota ?? '').trim()
  if (!motiv) return { eroare: 'Scrie motivul (actul adițional / decizia).' }
  if (motiv.length > 300) return { eroare: 'Motivul are peste 300 de caractere.' }
  return { p_employee_id: id, p_de_la: de_la, p_pana_la: pana_la, p_norma: n, p_administrator: adm, p_suspendat: susp, p_nota: motiv }
}
export function mesajPerioada(err) {
  if (err?.code === '42501') return 'Corecțiile HR le face doar owner-ul.'
  if (err?.code === 'UPA05') return 'Intervalul se suprapune cu altă corecție a angajatului: șterge-o sau alege alt interval.'
  if (err?.code === 'UPA03') return 'O lună deja închisă folosește intervalul: nu se mai poate schimba.'
  if (err?.code === '22023') return 'Corecție invalidă (interval, normă, motiv).'
  return 'Eroare: ' + (err?.message || 'refuzat')
}
// închiderea calculului (owner, pe amprenta văzută)
export function mesajInchidere(err) {
  if (err?.code === '42501') return 'Închiderea calculului (confirmarea datelor HR) o face doar owner-ul.'
  if (err?.code === '40001') return 'Datele lunii s-au schimbat de la afișare (pontaj, facturi, corecții). Am reîncărcat: verifică din nou și închide.'
  return 'Eroare: ' + (err?.message || 'refuzat')
}

// refuzurile RPC-ului de parametri -> text
export function mesajParametru(err) {
  if (err?.code === '42501') return 'Nu ai drept să schimbi parametrii (cere acces Administrativ › Unități protejate, editor).'
  if (err?.code === '40001') return 'Parametrul s-a schimbat între timp (din alt ecran). Am reîncărcat valorile.'
  if (err?.code === 'UPA03') return 'O lună deja închisă folosește valoarea asta: alege o lună de după ultima lună închisă.'
  return 'Eroare: ' + (err?.message || 'refuzat')
}
