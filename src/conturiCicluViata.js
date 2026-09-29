// Ciclul de viață al conturilor (R1 legare cont↔fișă, R2 cont închis la încetare,
// R3 fost angajat ca posibil colaborator extern). Funcții pure — fără Supabase, fără React.
// Specificație: docs/CONTURI_CICLU_VIATA.md. Scrierile se fac doar prin RPC-urile cu poartă de rol.

export const COLAB_STARI = ['necunoscut', 'accepta', 'refuza']
export const TIPURI_CONT = ['angajat', 'extern', 'test', 'sistem']
export const NOTA_MIN = 5

// Ziua curentă în România (YYYY-MM-DD), ca termination_date să se compare corect și la miezul nopții.
export function ziRomania(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const get = type => parts.find(p => p.type === type).value
  return `${get('year')}-${get('month')}-${get('day')}`
}

// Ziua „bazei de date” (UTC) — aceeași cu CURRENT_DATE din Postgres, cu triggerul R2 și cu cron-ul
// hr_auto_deactivate_terminated. Închiderea automată cere termination_date <= CURRENT_DATE: între 00:00 și
// ~03:00 ora României, ziRomania() e deja „mâine” pentru BD, iar o dezactivare cu data RO NU ar închide contul
// (și cron-ul n-o mai prinde, fișa fiind deja inactivă). Pentru data implicită a încetării folosim ziua BD.
export function ziBaza(date = new Date()) {
  return date.toISOString().slice(0, 10)
}

// Fost angajat = contract încheiat (data există și a trecut / e azi) ȘI fișa nu e activă.
// O fișă inactivă fără dată (ex. import greșit) sau cu dată în viitor NU e fost angajat.
export function esteFostAngajat(emp, today = ziRomania()) {
  if (!emp || !emp.termination_date) return false
  const data = String(emp.termination_date).slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return false
  return data <= today && emp.active !== true
}

// Validarea acordului înainte de RPC (aceeași regulă ca fn_colaborare_externa_seteaza + CHECK-ul din BD).
export function valideazaColab(status, nota, document) {
  if (!COLAB_STARI.includes(status)) return { ok: false, eroare: 'Stare necunoscută. Alege Necunoscut, Acceptă sau Refuză.' }
  if (status === 'necunoscut') return { ok: true, eroare: null }
  const n = String(nota ?? '').trim()
  const d = String(document ?? '').trim()
  if (n.length >= NOTA_MIN || d.length > 0) return { ok: true, eroare: null }
  return { ok: false, eroare: `Dovada e obligatorie: o notă de minim ${NOTA_MIN} caractere sau un document.` }
}

const ETICHETE_COLAB = {
  necunoscut: { status: 'necunoscut', label: 'Necunoscut', icon: '❔', culoare: '#D29922', fundal: '#D2992222' },
  accepta:    { status: 'accepta',    label: 'Acceptă',    icon: '✅', culoare: '#2EA043', fundal: '#2EA04322' },
  refuza:     { status: 'refuza',     label: 'Refuză',     icon: '⛔', culoare: '#F85149', fundal: '#F8514922' },
}
// Textul și culorile celor 3 stări (galben / verde / roșu). Orice altă valoare = „necunoscut” (nu se deduce acord).
export function etichetaColab(status) {
  return ETICHETE_COLAB[status] || ETICHETE_COLAB.necunoscut
}

// Data (sau data+ora) în format românesc, ancorată pe Europe/Bucharest.
export function formatDataRo(value, { cuOra = false } = {}) {
  if (!value) return ''
  const s = String(value)
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T12:00:00Z`) : new Date(s)
  if (!Number.isFinite(d.getTime())) return ''
  const opt = { timeZone: 'Europe/Bucharest', day: '2-digit', month: '2-digit', year: 'numeric' }
  if (cuOra) Object.assign(opt, { hour: '2-digit', minute: '2-digit' })
  return new Intl.DateTimeFormat('ro-RO', opt).format(d)
}

// Rând din fn_cont_stare_angajati → mesajul indicatorului de pe fișa HR (sau null = nu afișa nimic).
export function mesajStareCont(row) {
  if (!row || !row.stare) return null
  if (row.stare === 'inchis') return { text: `🔒 Cont închis automat la ${formatDataRo(row.inchis_la) || 'dată necunoscută'}`, ton: 'inchis' }
  if (row.stare === 'blocat') return { text: '🔒 Cont blocat (fără jurnal de închidere)', ton: 'inchis' }
  if (row.stare === 'activ') return { text: '⚠️ Cont încă activ', ton: 'activ' }
  return null
}

// Coloana „Stare” din Admin → Manageri: închiderea deschisă, blocarea logării fără jurnal (rândul din
// fn_cont_stare_angajati — ex. o închidere manuală din Dashboard), tipul marcat (extern/test/sistem) sau „Activ”.
export function stareContProfil(profile, inchidereDeschisa, stareCont = null) {
  if (!profile) return { text: '—', ton: 'neutru' }
  if (inchidereDeschisa) return { text: `🔒 Închis ${formatDataRo(inchidereDeschisa.facut_la)}`.trim(), ton: 'inchis' }
  if (stareCont?.stare === 'inchis') return { text: `🔒 Închis ${formatDataRo(stareCont.inchis_la)}`.trim(), ton: 'inchis' }
  if (stareCont?.stare === 'blocat') return { text: '🔒 Logare blocată (fără jurnal)', ton: 'inchis' }
  if (profile.tip_cont && profile.tip_cont !== 'angajat') return { text: profile.tip_cont, ton: 'marcat' }
  return { text: 'Activ', ton: 'activ' }
}

// Eroarea de coliziune pe nume din fn_fost_angajat_leaga_extern → id-ul externului existent (sau null).
export function externExistentDinEroare(error) {
  if (!error || error.code !== '23505') return null
  const m = /\(#(\d+)\)/.exec(String(error.hint || ''))
  return m ? Number(m[1]) : null
}

// Mesaj pentru bifa „Colaborare activă” a unui extern legat de un fost angajat.
export const MESAJ_ACTIVARE_FARA_ACORD = 'Se poate activa doar după ce fostul angajat acceptă (HR → Foști angajați).'
// fostInca=false: fișa legată e din nou activă / fără contract încheiat (reangajat) → nu se activează (BD: 23514).
export function poateActivaColaborarea(extern, statusAcord, fostInca = true) {
  if (!extern || extern.fost_angajat_employee_id == null) return true
  return statusAcord === 'accepta' && fostInca !== false
}

// ---- Omonimie extern ↔ fost angajat (aceeași regulă ca fn_extern_fost_angajat_potrivire din BD) ----------
// Cuvintele unui nume: fără diacritice (ș/ț cu virgulă sau sedilă), majuscule, distincte, sortate.
export function cuvinteNume(nume) {
  const t = String(nume ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
  return [...new Set(t.split(/[^A-Z0-9]+/).filter(Boolean))].sort()
}
function primulCuvant(nume) {
  return String(nume ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean)[0] || ''
}
// Un extern NELEGAT (nume / email) care e de fapt un fost angajat: email identic, sau ≥ 2 cuvinte cu numele de
// familie al fișei (primul cuvânt din „NUME_FAMILIE PRENUME”) și un set de cuvinte îl conține pe celălalt.
// Întoarce fișa fostului angajat sau null. BD-ul refuză oricum (23514); aici doar avertizăm înainte de salvare.
export function fostAngajatPotrivit(extern, fosti, today = ziBaza()) {
  if (!extern || extern.fost_angajat_employee_id != null) return null
  const em = String(extern.email ?? '').trim().toLowerCase()
  const x = cuvinteNume(extern.nume)
  for (const e of fosti || []) {
    if (!esteFostAngajat(e, today)) continue
    if (em && String(e.email ?? '').trim().toLowerCase() === em) return e
    const f = cuvinteNume(e.name)
    if (x.length < 2 || f.length < 2 || !x.includes(primulCuvant(e.name))) continue
    if (x.every(w => f.includes(w)) || f.every(w => x.includes(w))) return e
  }
  return null
}
export const MESAJ_OMONIM_FOST_ANGAJAT = 'E fost angajat Gazpet: folosește HR → Foști angajați → „Trece ca extern” (acordul lui se confirmă acolo). Dacă e altă persoană cu același nume, activarea o face owner-ul.'
// Eroarea 23514 din triggerul BD pentru un extern nelegat omonim cu un fost angajat.
export function esteEroareOmonim(error) {
  return !!error && error.code === '23514' && /fost angajat Gazpet/i.test(String(error.message || ''))
}
// Eroarea 23514 pentru o fișă legată care nu (mai) e a unui fost angajat (ex. reangajat).
export function esteEroareReangajat(error) {
  return !!error && error.code === '23514' && /doar pentru un fost angajat/i.test(String(error.message || ''))
}

// Rândul din jurnalul acordului: cine l-a făcut (resetul automat la reactivare / anularea încetării are sursa proprie).
export function autorJurnalAcord(row, numeProfil) {
  if (row?.sursa === 'reset_automat') return `sistem (reset automat)${row.facut_de ? ` · declanșat de ${numeProfil || 'utilizator necunoscut'}` : ''}`
  return numeProfil || 'utilizator necunoscut'
}
