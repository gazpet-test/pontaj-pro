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

// Coloana „Stare” din Admin → Manageri: tipul marcat (extern/test/sistem), închiderea deschisă sau „Activ”.
export function stareContProfil(profile, inchidereDeschisa) {
  if (!profile) return { text: '—', ton: 'neutru' }
  if (inchidereDeschisa) return { text: `🔒 Închis ${formatDataRo(inchidereDeschisa.facut_la)}`.trim(), ton: 'inchis' }
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
export function poateActivaColaborarea(extern, statusAcord) {
  if (!extern || extern.fost_angajat_employee_id == null) return true
  return statusAcord === 'accepta'
}
