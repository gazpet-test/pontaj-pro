// Șantierul implicit al angajatului în pontaj (TKT-2026-0360, decizia owner-ului 13.11.2026): implicit rămâne șantierul din ziua precedentă.
//
// Regula (o singură definiție, folosită și la afișare și la salvare):
//   1. rândul ZILEI (pontaj_records pe ziua aleasă) cu șantier = alegerea făcută deja (manual sau salvată) — are prioritate;
//   2. altfel, ultimul șantier pe care angajatul a fost pontat EFECTIV: cea mai recentă zi ANTERIOARĂ cu rând în pontaj_records care are
//      șantier și e zi de lucru (are oră de intrare, sau nu e marcată cu o normă de absență: CO / CM / BO / LL ...);
//   3. altfel (niciun pontaj anterior), șantierul din fișa angajatului (employees.site_id);
//   4. altfel, niciunul („⚠ Nealocate”, ca azi).
// Cazurile cerute în raport:
//   * două șantiere în aceeași zi: pontaj_records are UNIQUE (employee_id, date), deci un singur rând pe zi; dacă ar apărea totuși două,
//     câștigă cel cu id-ul mai mare (ultimul scris) — ordinea (date desc, id desc) e și ordinea interogării;
//   * zile libere / concediu între timp: rândurile de absență (normă fără oră de intrare) se sar, ca și zilele fără rând (weekend, sărbători):
//     contează ultima zi LUCRATĂ, nu ultima zi din calendar; concediul scris în avans (cu șantierul din fișă) nu „resetează” șantierul;
//   * prima zi a lunii: căutarea nu e limitată la lună — se ia ultima zi lucrată din luna (sau lunile) anterioare;
//   * eroare la citire ≠ „fără pontaj anterior”: funcția de încărcare aruncă, iar ecranul spune explicit că folosește fișa (L18).
// Citirea e EXACTĂ și paginată (L23): fără fereastră de zile și fără limita tăcută de 1000 de rânduri a serverului (max-rows).

// zi lucrată cu șantier: are șantier și (oră de intrare SAU nicio normă de absență)
export const esteZiLucrataCuSantier = (r) =>
  !!r && r.site_id != null && (r.check_in != null || r.norma == null || r.norma === '')

// ordinea „mai recent întâi”: data desc, apoi id desc
const maiRecent = (a, b) => (a.date !== b.date ? (a.date > b.date ? -1 : 1) : (Number(b.id) - Number(a.id)))

// din rânduri (orice ordine) → Map(employee_id → { site_id, date }) cu ultima zi lucrată STRICT înainte de `zi` ('YYYY-MM-DD')
export function ultimulSantierDinRanduri(randuri, zi) {
  const m = new Map()
  const bune = (randuri || []).filter(r => r && typeof r.date === 'string' && r.date < zi && esteZiLucrataCuSantier(r)).sort(maiRecent)
  for (const r of bune) if (!m.has(r.employee_id)) m.set(r.employee_id, { site_id: r.site_id, date: r.date })
  return m
}

// regula 1–4. rec = rândul zilei (sau null), ultim = { site_id, date } (sau undefined), emp = fișa
export function santierImplicit({ rec, ultim, emp }) {
  if (rec && rec.site_id != null) return { site_id: rec.site_id, sursa: 'zi', data: null }
  if (ultim && ultim.site_id != null) return { site_id: ultim.site_id, sursa: 'precedent', data: ultim.date }
  if (emp && emp.site_id != null) return { site_id: emp.site_id, sursa: 'fisa', data: null }
  return { site_id: null, sursa: null, data: null }
}

// ══ Starea ZILEI afișate (r2 după review #1091): rândurile zilei și istoricul sunt legate EXPLICIT de ziua pentru care au fost citite ══
// Toate răspunsurile asincrone (rândurile zilei, istoricul, salvarea, alocarea) intră în stare DOAR prin reducerZi, care le ignoră dacă
// ziua afișată nu mai e ziua pentru care a plecat cererea (L24). Pagina (PontajPage) ține starea cu useReducer(reducerZi) și citește
// totul prin propuneSantier / verificaSalvare / nealocati / treceFiltrulSantier — aceleași funcții pe care le probează testele.
const ISTORIC_GOL = Object.freeze({ zi: null, cheie: null, stare: 'incarc', harta: new Map(), err: null })

export function stareZiInitiala(zi) {
  // recsZi = ziua pentru care rândurile au fost citite (null = încă necitite); ist = istoricul + ziua și lista de angajați pentru care e valabil
  return { zi, recs: {}, recsZi: null, recsErr: null, ist: ISTORIC_GOL, istCerut: { zi: null, cheie: null } }
}

// cheia listei de angajați pentru care s-a cerut istoricul (altă listă = alt istoric)
export const cheiaListei = (emps) => (emps || []).map(e => Number(e.id)).sort((a, b) => a - b).join(',')

// un răspuns asincron se aplică stării paginii doar dacă ziua afișată e tot ziua cererii
export const raspunsAplicabil = (ziCerere, ziAfisata) => ziCerere != null && ziCerere === ziAfisata

export function reducerZi(st, a) {
  switch (a.tip) {
    case 'zi':
      // altă zi: rândurile vechi ies din stare (nu se mai folosesc nicăieri); istoricul vechi rămâne, dar e marcat cu ziua lui și nu mai e valabil
      if (a.zi === st.zi) return st
      return { ...st, zi: a.zi, recs: {}, recsZi: null, recsErr: null }
    case 'randuri': {
      if (!raspunsAplicabil(a.zi, st.zi)) return st
      const m = {}
      for (const r of a.rows || []) {
        if (!r || r.date !== a.zi) continue // un rând al altei zile nu intră niciodată
        const old = st.recs[r.employee_id]
        // identitatea obiectelor nemodificate se păstrează (PontajRow nu-și resetează ce ai tastat)
        m[r.employee_id] = (old && JSON.stringify(old) === JSON.stringify(r)) ? old : r
      }
      return { ...st, recs: m, recsZi: a.zi, recsErr: null }
    }
    case 'randuriEroare':
      if (!raspunsAplicabil(a.zi, st.zi)) return st
      return { ...st, recsErr: a.err || 'eroare' }
    case 'randSalvat':
      if (!raspunsAplicabil(a.zi, st.zi) || !a.rand || a.rand.date !== a.zi) return st
      return { ...st, recs: { ...st.recs, [a.rand.employee_id]: a.rand } }
    case 'istoricCerut':
      if (!raspunsAplicabil(a.zi, st.zi)) return st
      return { ...st, istCerut: { zi: a.zi, cheie: a.cheie } }
    case 'istoric':
      // doar răspunsul ULTIMEI cereri (zi + listă) pentru ziua afișată; cele vechi / pentru altă zi se ignoră
      if (!raspunsAplicabil(a.zi, st.zi) || a.zi !== st.istCerut.zi || a.cheie !== st.istCerut.cheie) return st
      return { ...st, ist: { zi: a.zi, cheie: a.cheie, stare: a.stare, harta: a.harta || new Map(), err: a.err || null } }
    default:
      return st
  }
}

// rândul angajatului DOAR dacă e al zilei afișate
export const randulZilei = (st, empId) => {
  const r = st.recs[empId]
  return r && r.date === st.zi ? r : null
}

// starea istoricului pentru ziua și lista afișate: 'incarc' | 'gata' | 'eroare' (alt istoric decât al zilei afișate = 'incarc')
export function stareIstoric(st, cheie) {
  const ist = st.ist
  if (ist.zi !== st.zi || ist.cheie !== cheie) return 'incarc'
  return ist.stare
}

// Șantierul propus pentru angajat în ziua afișată (afișare, select, filtru, „Nealocate”, salvare).
// sursa: 'zi' | 'precedent' | 'fisa' | null (nealocat) | 'incarc' (nu se știe încă: rândurile zilei sau istoricul zilei nu sunt citite)
export function propuneSantier({ st, cheie, emp }) {
  const rec = randulZilei(st, emp.id)
  if (rec && rec.site_id != null) return { site_id: rec.site_id, sursa: 'zi', data: null }
  if (st.recsZi !== st.zi) return { site_id: null, sursa: 'incarc', data: null, asteapta: 'randuri' }
  const s = stareIstoric(st, cheie)
  if (s === 'incarc') return { site_id: null, sursa: 'incarc', data: null, asteapta: 'istoric' }
  // eroare la citire ≠ fără pontaj anterior (L18): fișa, cu semnul că istoricul lipsește (ecranul o spune)
  if (s === 'eroare') return { ...santierImplicit({ rec, ultim: undefined, emp }), istoricEroare: true }
  return santierImplicit({ rec, ultim: st.ist.harta.get(emp.id), emp })
}

// Salvarea e permisă? Orice salvare al cărei șantier ar veni din istoric (rând lipsă SAU rând fără șantier) e refuzată cât timp
// rândurile / istoricul zilei afișate nu sunt citite; pentru ore, șantierul e obligatoriu (regula de azi).
export function verificaSalvare(prop, fields) {
  if (prop.sursa === 'incarc') return { ok: false, nivel: 'warn', motiv: prop.asteapta === 'randuri' ? 'Se citește pontajul zilei — reîncearcă într-o secundă' : 'Se citește ultimul șantier pontat — reîncearcă într-o secundă' }
  if (!fields?.norma && prop.site_id == null) return { ok: false, nivel: 'error', motiv: 'Șantierul este obligatoriu pentru ore!' }
  return { ok: true, site_id: prop.site_id }
}

// Rândul scris la salvare: angajatul, ZIUA cererii și șantierul decis nu pot fi suprascrise de câmpurile primite
// (salvarea „doar diurnă” trimite tot rândul vechi, inclusiv site_id / date — r1 putea scrie NULL peste șantierul afișat).
export function randPentruSalvare({ empId, zi, siteId, uid, fields, acum }) {
  const { site_id: _s, date: _d, employee_id: _e, ...rest } = fields || {}
  return { created_by: uid, updated_by: uid, updated_at: acum, ...rest, employee_id: empId, date: zi, site_id: siteId }
}

// Filtrul pe șantier: același șantier ca pe ecran; cât nu se știe (se încarcă), rândul rămâne vizibil, marcat „se încarcă”.
export const treceFiltrulSantier = (prop, siteF) => siteF === 'Toate' || prop.sursa === 'incarc' || String(prop.site_id) === String(siteF)

// „Nealocate”: fără rând cu șantier pe zi, fără zi lucrată anterioară, fără fișă — aceeași regulă ca rândul. Cât se încarcă, lista nu se dă (inAsteptare > 0).
export function nealocati({ st, cheie, emps }) {
  const lista = []
  let inAsteptare = 0
  for (const e of emps || []) {
    const p = propuneSantier({ st, cheie, emp: e })
    if (p.sursa === 'incarc') inAsteptare++
    else if (p.site_id == null) lista.push(e)
  }
  return { lista, inAsteptare }
}

// ── pașii asincroni ai paginii (aceleași funcții le cheamă PontajPage și testele, cu promisiuni controlate) ──

// rândurile zilei: citeste(zi, ids) → { data, error }. Eroarea nu golește starea (≠ „fără rânduri”); refresh-ul tăcut nu o afișează.
export async function incarcaRanduriZi({ zi, ids, citeste, dispatch, silent = false }) {
  let res
  try { res = await citeste(zi, ids) } catch (e) { res = { data: null, error: { message: e?.message || String(e) } } }
  if (res?.error || !Array.isArray(res?.data)) {
    if (!silent) dispatch({ tip: 'randuriEroare', zi, err: res?.error?.message || 'răspuns fără rânduri' })
    return { ok: false }
  }
  dispatch({ tip: 'randuri', zi, rows: res.data })
  return { ok: true }
}

// istoricul zilei: citeste(ids, zi) → Map (aruncă la eroare). Se marchează cererea înainte, ca doar răspunsul ultimei cereri să conteze.
export async function incarcaIstoricZi({ zi, cheie, ids, citeste, dispatch }) {
  dispatch({ tip: 'istoricCerut', zi, cheie })
  if (!ids || !ids.length) { dispatch({ tip: 'istoric', zi, cheie, stare: 'gata', harta: new Map() }); return }
  try {
    const harta = await citeste(ids, zi)
    dispatch({ tip: 'istoric', zi, cheie, stare: 'gata', harta })
  } catch (e) {
    dispatch({ tip: 'istoric', zi, cheie, stare: 'eroare', err: e?.message || String(e) })
  }
}

// salvarea unui rând: decizia (șantier, voie / refuz) pe starea zilei de PLECARE; scrierea pe ziua de plecare; răspunsul intră în stare
// doar dacă ziua afișată e tot aceea (altfel altaZi = true și pagina spune unde s-a salvat).
// uid() → id-ul utilizatorului; scrie(rand) → { data, error }; ziAfisata() → ziua afișată ACUM.
export async function salveazaRand({ st, cheie, emp, fields, uid, scrie, dispatch, ziAfisata, acum = () => new Date().toISOString() }) {
  const zi = st.zi
  const v = verificaSalvare(propuneSantier({ st, cheie, emp }), fields)
  if (!v.ok) return { ok: false, scris: false, nivel: v.nivel, motiv: v.motiv }
  const u = await uid()
  const { data, error } = await scrie(randPentruSalvare({ empId: emp.id, zi, siteId: v.site_id, uid: u, fields, acum: acum() }))
  if (error || !data) return { ok: false, scris: false, nivel: 'error', motiv: 'Eroare la salvare' }
  dispatch({ tip: 'randSalvat', zi, rand: data })
  return { ok: true, scris: true, zi, rand: data, altaZi: !raspunsAplicabil(zi, ziAfisata()) }
}

// alocarea pe zi (select-ul de șantier): aceeași regulă pentru răspuns
export async function alocaSantierZi({ zi, emp, siteId, uid, scrie, dispatch, ziAfisata, acum = () => new Date().toISOString() }) {
  const u = await uid()
  const { data, error } = await scrie({ employee_id: emp.id, date: zi, site_id: siteId || null, updated_by: u, updated_at: acum() })
  if (error || !data) return { ok: false, motiv: error?.message || 'răspuns gol' }
  dispatch({ tip: 'randSalvat', zi, rand: data })
  return { ok: true, zi, rand: data, altaZi: !raspunsAplicabil(zi, ziAfisata()) }
}

// Citirea din BD: pentru fiecare angajat, ultima zi lucrată cu șantier înainte de `zi`.
// Pe bucăți de id-uri (URL-ul lui .in() rămâne scurt); în fiecare bucată, aceeași interogare ordonată (date desc, id desc) se repetă DOAR
// pentru angajații încă nerezolvați: primul rând al unui angajat într-o pagină e chiar ultima lui zi (rândurile lui mai noi ar fi apărut
// înaintea tăieturii), deci fiecare pagină nevidă rezolvă cel puțin un angajat; se oprește la pagina GOALĂ sau când toți sunt rezolvați
// (nu la „pagină mai scurtă decât pasul”: serverul poate tăia la mai puțin). Un răspuns care nu respectă filtrul / ordinea = eroare, nu buclă.
export async function incarcaUltimulSantier(sb, ids, zi, { pas = 1000, bucata = 100 } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(zi))) throw new Error('ziua pontajului e invalidă')
  const rez = new Map()
  const toate = [...new Set((ids || []).filter(x => x != null))]
  for (let i = 0; i < toate.length; i += bucata) {
    const ramase = new Set(toate.slice(i, i + bucata))
    for (let pagina = 0; ramase.size > 0; pagina++) {
      if (pagina > bucata + 1) throw new Error('citirea ultimului șantier nu se termină (răspuns neașteptat)')
      const { data, error } = await sb.from('pontaj_records')
        .select('id,employee_id,date,site_id,check_in,norma')
        .in('employee_id', [...ramase])
        .lt('date', zi)
        .not('site_id', 'is', null)
        .or('check_in.not.is.null,norma.is.null')
        .order('date', { ascending: false })
        .order('id', { ascending: false })
        .limit(pas)
      if (error) throw new Error('citirea ultimului șantier pontat: ' + (error.message || 'eroare'))
      if (!Array.isArray(data)) throw new Error('citirea ultimului șantier pontat: răspuns fără rânduri')
      if (data.length === 0) break
      let rezolvati = 0
      for (let k = 0; k < data.length; k++) {
        const r = data[k]
        if (k > 0 && maiRecent(data[k - 1], r) > 0) throw new Error('citirea ultimului șantier pontat: rânduri în altă ordine decât cea cerută')
        if (!(typeof r.date === 'string' && r.date < zi) || !esteZiLucrataCuSantier(r)) throw new Error('citirea ultimului șantier pontat: rând în afara filtrului')
        if (ramase.has(r.employee_id)) { rez.set(r.employee_id, { site_id: r.site_id, date: r.date }); ramase.delete(r.employee_id); rezolvati++ }
      }
      if (rezolvati === 0) throw new Error('citirea ultimului șantier pontat: pagină fără angajații ceruți')
    }
  }
  return rez
}
