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

// cheia listei de angajați (altă listă = alt context: rândurile și istoricul se recitesc)
export const cheiaListei = (emps) => (emps || []).map(e => Number(e.id)).sort((a, b) => a - b).join(',')

// ══ Starea ZILEI afișate = un instantaneu (snapshot) imuabil al controlorului de mai jos ══
// snap = { zi, emps (null = lista încă necitită), cheie, ctx (crește la orice schimbare de zi / listă),
//          randuri: { stare: 'incarc'|'gata'|'eroare', recs, err, reincerc }, istoric: { stare, harta, err, reincerc },
//          r4: exportZi: { stare, exportat, info, err, reincerc } („zi plătită”), ciorne: { 'emp|zi': editarea în curs }, operatii: { 'emp|zi':
//          { salveaza, siteTinta, necunoscut } }, mesaje: { 'emp|zi': text } }
// Funcțiile de mai jos citesc DOAR instantaneul: pagina, testele și controlorul (la salvare) decid la fel (L19).

// rândul angajatului DOAR dacă rândurile zilei afișate sunt citite și rândul e chiar al acestei zile
export function randulZilei(snap, empId) {
  if (snap.randuri.stare !== 'gata') return null
  const r = snap.randuri.recs[empId]
  return r && r.date === snap.zi ? r : null
}

// spinnerul paginii (lista se demontează): DOAR cât contextul nou se citește prima oară. Reîncercarea după eroare și citirile de fundal
// NU îl aprind — altfel rândurile s-ar demonta și s-ar pierde ce a completat utilizatorul.
export const arataSpinner = (snap) => snap.randuri.stare === 'incarc'

// Șantierul propus pentru angajat în ziua afișată (afișare, select, filtru, „Nealocate”, salvare).
// sursa: 'zi' | 'precedent' | 'fisa' | null (nealocat) | 'incarc' (nu se știe încă; eroare: true = citirea rândurilor a eșuat)
export function propuneSantier(snap, emp) {
  const rec = randulZilei(snap, emp.id)
  if (rec && rec.site_id != null) return { site_id: rec.site_id, sursa: 'zi', data: null }
  if (snap.randuri.stare !== 'gata') {
    const p = { site_id: null, sursa: 'incarc', data: null, asteapta: 'randuri' }
    return snap.randuri.stare === 'eroare' ? { ...p, eroare: true } : p
  }
  const s = snap.istoric.stare
  if (s !== 'gata' && s !== 'eroare') return { site_id: null, sursa: 'incarc', data: null, asteapta: 'istoric' }
  // eroare la citire ≠ fără pontaj anterior (L18): fișa, cu semnul că istoricul lipsește (ecranul o spune)
  if (s === 'eroare') return { ...santierImplicit({ rec, ultim: undefined, emp }), istoricEroare: true }
  return santierImplicit({ rec, ultim: snap.istoric.harta.get(emp.id), emp })
}

// Salvarea e permisă? Orice salvare al cărei șantier ar veni din istoric (rând lipsă SAU rând fără șantier) e refuzată cât timp
// rândurile / istoricul zilei afișate nu sunt citite; pentru ore, șantierul e obligatoriu (regula de azi).
export function verificaSalvare(prop, fields) {
  if (prop.sursa === 'incarc') {
    const motiv = prop.eroare ? 'Pontajul zilei nu s-a putut citi — apasă „Reîncearcă” (ce ai completat rămâne), apoi salvează'
      : prop.asteapta === 'randuri' ? 'Se citește pontajul zilei — salvează după ce se încarcă'
        : 'Se citește ultimul șantier pontat — salvează după ce se încarcă'
    return { ok: false, nivel: 'warn', motiv }
  }
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
export function nealocati(snap) {
  const lista = []
  let inAsteptare = 0
  for (const e of snap.emps || []) {
    const p = propuneSantier(snap, e)
    if (p.sursa === 'incarc') inAsteptare++
    else if (p.site_id == null) lista.push(e)
  }
  return { lista, inAsteptare }
}

// ══ r4 (re-review #1091 r3): versiunea rândului, valorile din câmpuri și starea pe rând — citite de pagină DOAR din instantaneu ══
export const cheieRand = (empId, zi) => `${empId}|${zi}`

// Amprenta = versiunea rândului pe care se sprijină o editare sau o intenție de scriere ('lipsa' = fără rând).
// Toate coloanele, cu cheile sortate: ecoul upsert-ului și citirea au aceleași coloane, poate în altă ordine.
export function amprenta(rec) {
  if (!rec) return 'lipsa'
  return JSON.stringify(Object.keys(rec).sort().map(k => [k, rec[k]]))
}

const hhmm = (iso) => new Date(iso).toTimeString().slice(0, 5)
// Ce arată câmpurile rândului fără editări (regula de până acum din PontajRow, inclusiv orele implicite pe rândul gol).
export function valoriDinRand(rec, oreDef) {
  return {
    ci: rec?.check_in ? hhmm(rec.check_in) : (rec ? '' : oreDef.intrare),
    co: rec?.check_out ? hhmm(rec.check_out) : (rec ? '' : oreDef.iesire),
    norma: rec?.norma || '', diurna: rec?.diurna || false, supl: rec?.meal_supplement || false, mode: rec?.norma ? 'norma' : 'ore',
  }
}
const valoriEgale = (a, b) => a.ci === b.ci && a.co === b.co && a.norma === b.norma && a.diurna === b.diurna && a.supl === b.supl && a.mode === b.mode

// Ce arată rândul: editarea în curs (ciorna, ținută de controlor) dacă există, altfel valorile rândului zilei.
export function valoriAfisate(snap, emp, oreDef) {
  const c = snap.ciorne[cheieRand(emp.id, snap.zi)]
  return c ? c.valori : valoriDinRand(randulZilei(snap, emp.id), oreDef)
}

// Starea rândului pentru afișare: editare în curs, „modificat între timp”, conflict, scriere în curs, rezultat necunoscut.
export function stareRand(snap, empId) {
  const k = cheieRand(empId, snap.zi)
  const c = snap.ciorne[k] || null
  const op = snap.operatii[k] || null
  return {
    editat: !!c, schimbat: !!c?.schimbat, conflict: c?.conflict || null,
    salveaza: !!op?.salveaza, siteTinta: op?.salveaza ? op.siteTinta : undefined,
    necunoscut: !!op?.necunoscut, mesaj: snap.mesaje[k] || null,
  }
}

// rândul salvat, pe scurt (în mesajul de conflict)
export function descriereRand(rec) {
  if (!rec) return null
  if (rec.norma) return rec.norma
  if (rec.check_in) return rec.check_out ? `${hhmm(rec.check_in)}–${hhmm(rec.check_out)}` : hhmm(rec.check_in)
  return 'fără ore'
}

// O intenție (salvare / alocare) poate merge mai departe? Aceeași funcție ÎNAINTEA porții de parolă și CHIAR ÎNAINTEA scrierii (după orice
// așteptare). Pură: citește doar instantaneul și intenția (L19). Ordinea: zi/listă → „zi plătită” cunoscută → rezultat necunoscut → regula
// șantierului / rânduri citite → versiunea rândului (pct. 3: rândul apărut / schimbat de la începutul editării = conflict, nimic scris).
export function verificaIntentie(snap, it, { necunoscut = false } = {}) {
  if (it.ctx !== snap.ctx || it.zi !== snap.zi) return { ok: false, nivel: 'warn', motiv: 'Ziua sau lista afișată s-a schimbat între timp — nu am salvat nimic; verifică rândul și apasă din nou 💾' }
  const ex = snap.exportZi
  if (ex.stare === 'incarc') return { ok: false, nivel: 'warn', motiv: 'Se verifică dacă ziua e plătită (exportată) — salvează după ce se încarcă' }
  if (ex.stare !== 'gata') return { ok: false, nivel: 'error', motiv: 'Nu s-a putut verifica dacă ziua e plătită — apasă „Reîncearcă”; până atunci nu salvez nimic' }
  if (it.exportat !== ex.exportat) return { ok: false, nivel: 'warn', motiv: 'Starea „zi plătită” s-a schimbat de la apăsare — nu am salvat nimic; apasă din nou' }
  if (necunoscut) return { ok: false, nivel: 'warn', motiv: 'Rezultatul salvării anterioare pe acest rând nu e cunoscut — recitesc rândul din bază; verifică-l și salvează din nou' }
  const e = (snap.emps || []).find(x => x.id === it.empId) || it.emp
  let site_id
  if (it.tip === 'salveaza') {
    const v = verificaSalvare(propuneSantier(snap, e), it.fields)
    if (!v.ok) return v
    site_id = v.site_id
  } else if (snap.randuri.stare !== 'gata') {
    return { ok: false, nivel: 'warn', motiv: 'Pontajul zilei nu e citit — alege șantierul după ce se încarcă' }
  }
  const rec = randulZilei(snap, it.empId)
  if (amprenta(rec) !== it.baza) {
    const ce = it.tip === 'salveaza' ? 'verifică și salvează din nou' : 'verifică și alege din nou șantierul'
    const motiv = rec ? `Există deja un pontaj salvat la ${descriereRand(rec)}${e?.name ? ` pentru ${e.name}` : ''} (modificat între timp) — nu am salvat nimic; ${ce}`
      : `Pontajul acestui rând a fost șters între timp — nu am salvat nimic; ${ce}`
    return { ok: false, conflict: true, nivel: 'warn', rec, motiv }
  }
  return { ok: true, site_id }
}

// O eroare cu cod SQL / PostgREST = refuz sigur al serverului (nimic scris). Fără cod (rețea, 5xx, excepție) = rezultat NECUNOSCUT (L05).
export const eroareDeterminista = (err) => typeof err?.code === 'string' && /^([0-9A-Z]{5}|PGRST\d+)$/.test(err.code)

// ══ Controlorul zilei (r3 + r4 după re-review #1091): TOATĂ orchestrarea asincronă a zilei afișate, fără React ══
// Pagina (PontajPage) doar se abonează (useSyncExternalStore(aboneaza, getStare)), redă instantaneul și cheamă metodele. Nu decide nimic
// asincron despre ziua afișată: rândurile, istoricul, starea „zi plătită”, salvarea, alocarea și editările în curs sunt aici. Garanții:
//   * trei surse ale zilei (rânduri, istoric, „zi exportată / plătită”), fiecare cu generația ei: „ultima cerere câștigă, pe sursă”;
//     orice schimbare de zi le invalidează pe toate trei (lista nouă: rândurile și istoricul); nimic citit înainte nu mai e folosit;
//   * fiecare citire are termen (20 s): la expirare sursa trece în eroare (cu „Reîncearcă”), iar răspunsul târziu e aruncat prin generație;
//   * scrierile (salvare, alocare) se SERIALIZEAZĂ pe rând (angajat + zi): a doua pornește doar după ce prima s-a terminat, deci ordinea de
//     pe ecran = ordinea din bază; pe rând stau cel mult o scriere în curs + câte UNA nepornită pe fel (o intenție nouă de același fel o
//     înlocuiește pe cea nepornită) — coada e mărginită;
//   * fiecare intenție reține versiunea rândului pe care s-a bazat (editarea în curs: versiunea de la începutul ei); înaintea porții de parolă
//     și chiar înaintea scrierii (după identitate / poartă / coadă) se compară cu rândul curent: rând apărut / schimbat = conflict, nimic
//     scris, valorile rămân în câmpuri, mesaj pe rând; „salvează din nou” pleacă de la rândul văzut acum;
//   * starea „zi plătită” trebuie CUNOSCUTĂ pentru ziua afișată: cât se citește sau e în eroare, salvarea / alocarea sunt refuzate (L18);
//     poarta de parolă / tichet (a paginii) primește starea controlorului, nu una proprie;
//   * o scriere expirată (sau cu eroare de rețea / 5xx) are rezultat NECUNOSCUT: rândul se recitește din bază, iar până la o citire pornită
//     după expirare nicio altă scriere nu pleacă pe el (L05); răspunsul târziu pornește încă o recitire;
//   * editările în curs (ciornele) sunt ale controlorului: un răspuns de fundal nu le suprascrie; dacă rândul din bază diferă de cel pe care
//     se sprijină editarea, rândul e marcat „modificat între timp” și salvarea lui trece prin verificarea versiunii;
//   * scrierile bat citirile plecate înaintea lor (r3), iar un rând cu scriere în zbor își păstrează valoarea până la răspunsul ei.
// Dependențe (injectate; testele le eliberează în ordinea aleasă):
//   citesteRanduri(zi, ids) → { data, error }; citesteIstoric(ids, zi) → Map (aruncă la eroare); citesteExport(zi) → { data: [], error };
//   scrieRand(rand) → { data, error }; uid() → id; poarta({ zi, exportat, info, numeAngajat }) → { ok, tichet } (parola / tichetul HR);
//   noteaza({ tichet, emp, zi, campuri }) → mesaj de eroare | null; scrieFisa(empId, siteId) → { error }; oreImplicite(emp) → { intrare, iesire };
//   termenMs; timer(ms, fn) → anulare.
const RANDURI_INCARC = Object.freeze({ stare: 'incarc', recs: Object.freeze({}), err: null, reincerc: false })
const ISTORIC_INCARC = Object.freeze({ stare: 'incarc', harta: new Map(), err: null, reincerc: false })
const EXPORT_INCARC = Object.freeze({ stare: 'incarc', exportat: null, info: null, err: null, reincerc: false })
export const TERMEN_MS = 20000
const timerImplicit = (ms, fn) => { const h = setTimeout(fn, ms); return () => clearTimeout(h) }

export function creeazaControlorZi({
  zi, citesteRanduri, citesteIstoric, citesteExport, scrieRand, uid,
  poarta = async () => ({ ok: true, tichet: null }), noteaza = async () => null, scrieFisa = null,
  oreImplicite = () => ({ intrare: '', iesire: '' }), termenMs = TERMEN_MS, timer = timerImplicit,
  acum = () => new Date().toISOString(),
}) {
  let st = Object.freeze({ zi, emps: null, cheie: null, ctx: 0, randuri: RANDURI_INCARC, istoric: ISTORIC_INCARC, exportZi: EXPORT_INCARC,
    ciorne: Object.freeze({}), operatii: Object.freeze({}), mesaje: Object.freeze({}) })
  let genR = 0          // generația ultimei cereri de rânduri (crește și la scrieri)
  let genI = 0          // generația ultimei cereri de istoric
  let genE = 0          // generația ultimei cereri „zi exportată”
  let zborR = false     // o citire de rânduri din generația curentă e în zbor
  const coada = new Map()      // cheie rând → { curenta: intenție | null, urmatoare: [{ it, rezolva }] (cel mult una pe fel) }
  const inZbor = new Map()     // cheie rând → { empId, zi }: scriere trimisă, fără răspuns
  const deRecitit = new Set()  // chei la care o citire din timpul scrierii a văzut alt rând → se recitește după răspuns
  const prag = new Map()       // cheie → genR la momentul în care rezultatul a devenit necunoscut (doar o citire pornită DUPĂ îl lămurește)
  const abonati = new Set()
  const pune = (patch) => { st = Object.freeze({ ...st, ...patch }) }
  const notifica = () => { for (const f of [...abonati]) f() }
  const idsCurente = () => (st.emps || []).map(e => e.id)
  const empDin = (id, rezerva) => (st.emps || []).find(x => x.id === id) || rezerva
  const cuHarta = (camp, k, val) => { const m = { ...st[camp] }; if (val == null) delete m[k]; else m[k] = Object.freeze(val); pune({ [camp]: Object.freeze(m) }) }
  const puneCiorna = (k, c) => cuHarta('ciorne', k, c)
  const puneMesaj = (k, m) => cuHarta('mesaje', k, m)
  const puneOp = (k, patch) => {
    const v = { ...(st.operatii[k] || {}), ...patch }
    cuHarta('operatii', k, (v.salveaza || v.necunoscut) ? v : null)
  }

  // promisiunea cu termen: { v } | { e } | { expirat: true } — se rezolvă O SINGURĂ dată
  function cuTermen(p) {
    return new Promise(res => {
      let gata = false
      const anuleaza = timer(termenMs, () => { if (!gata) { gata = true; res({ expirat: true }) } })
      Promise.resolve(p).then(
        v => { if (!gata) { gata = true; anuleaza(); res({ v }) } },
        e => { if (!gata) { gata = true; anuleaza(); res({ e: e || new Error('eroare') }) } })
    })
  }
  const mesajTermen = () => `fără răspuns în ${Math.round(termenMs / 1000)} s`

  function citesteRand() {
    const g = ++genR
    const ziC = st.zi, ids = idsCurente()
    if (!ids.length) { zborR = false; pune({ randuri: { stare: 'gata', recs: {}, err: null, reincerc: false } }); return Promise.resolve() }
    zborR = true
    let p
    try { p = citesteRanduri(ziC, ids) } catch (e) { p = Promise.reject(e) }
    return cuTermen(p).then(({ v, e, expirat }) => {
      if (g !== genR) return // a venit între timp o cerere mai nouă sau o scriere: răspunsul e vechi
      zborR = false
      if (expirat) genR++ // răspunsul târziu al acestei cereri e aruncat prin generație
      const res = expirat ? { data: null, error: { message: mesajTermen() } } : e ? { data: null, error: { message: e?.message || String(e) } } : v
      const r = st.randuri
      if (res?.error || !Array.isArray(res?.data)) {
        if (r.stare === 'gata') return // citire de fundal eșuată: rămâne ultima citire reușită a ACESTUI context
        pune({ randuri: { stare: 'eroare', recs: {}, err: res?.error?.message || 'răspuns fără rânduri', reincerc: false } })
      } else {
        const m = {}
        for (const x of res.data) {
          if (!x || x.date !== ziC) continue // un rând al altei zile nu intră niciodată
          const old = r.recs[x.employee_id]
          // identitatea obiectelor nemodificate se păstrează
          m[x.employee_id] = (old && JSON.stringify(old) === JSON.stringify(x)) ? old : x
        }
        // rândul cu scriere în zbor își păstrează valoarea: decide răspunsul scrierii; dacă citirea a văzut altceva, se recitește după el
        for (const [k, w] of inZbor) {
          if (w.zi !== ziC) continue
          const vechi = r.stare === 'gata' ? r.recs[w.empId] : undefined
          if (amprenta(m[w.empId]) !== amprenta(vechi)) deRecitit.add(k)
          if (vechi) m[w.empId] = vechi; else delete m[w.empId]
        }
        // pct. 5: editările în curs NU se suprascriu (câmpurile vin din ciornă); rândul schimbat sub o editare e marcat
        const ciorne = { ...st.ciorne }
        for (const [k, c] of Object.entries(st.ciorne)) {
          if (c.zi !== ziC || c.schimbat) continue
          if (amprenta(m[c.empId] || null) !== c.baza) ciorne[k] = Object.freeze({ ...c, schimbat: true })
        }
        // rezultatul necunoscut se lămurește doar printr-o citire pornită DUPĂ ce a devenit necunoscut
        const operatii = { ...st.operatii }
        for (const [k, pr] of [...prag]) {
          const o = operatii[k]
          if (!o || o.zi !== ziC || g <= pr) continue
          prag.delete(k)
          if (o.salveaza) operatii[k] = Object.freeze({ ...o, necunoscut: false }); else delete operatii[k]
        }
        pune({ randuri: { stare: 'gata', recs: m, err: null, reincerc: false }, ciorne: Object.freeze(ciorne), operatii: Object.freeze(operatii) })
      }
      notifica()
    })
  }

  function citesteIst() {
    const g = ++genI
    const ziC = st.zi, ids = idsCurente()
    if (!ids.length) { pune({ istoric: { stare: 'gata', harta: new Map(), err: null, reincerc: false } }); return Promise.resolve() }
    let p
    try { p = citesteIstoric(ids, ziC) } catch (e) { p = Promise.reject(e) }
    return cuTermen(p).then(({ v: h, e, expirat }) => {
      if (g !== genI) return
      if (expirat) genI++
      if (expirat || e || !(h instanceof Map)) pune({ istoric: { stare: 'eroare', harta: new Map(), err: expirat ? mesajTermen() : e ? (e.message || String(e)) : 'răspuns fără rezultat', reincerc: false } })
      else pune({ istoric: { stare: 'gata', harta: h, err: null, reincerc: false } })
      notifica()
    })
  }

  // pct. 2: „ziua e într-o perioadă exportată ca plată?” = a treia sursă a zilei; eroarea NU înseamnă „neexportată” (L18)
  function citesteExp() {
    const g = ++genE
    const ziC = st.zi
    let p
    try { p = citesteExport(ziC) } catch (e) { p = Promise.reject(e) }
    return cuTermen(p).then(({ v, e, expirat }) => {
      if (g !== genE) return
      if (expirat) genE++
      if (expirat || e || v?.error || !Array.isArray(v?.data)) {
        pune({ exportZi: { stare: 'eroare', exportat: null, info: null, reincerc: false,
          err: expirat ? mesajTermen() : (e?.message || v?.error?.message || 'răspuns fără rezultat') } })
      } else {
        pune({ exportZi: { stare: 'gata', exportat: v.data.length > 0, info: v.data[0] || null, err: null, reincerc: false } })
      }
      notifica()
    })
  }

  // zi SAU listă nouă: tot ce s-a citit înainte iese din stare, răspunsurile în zbor devin vechi, se citește contextul nou.
  // Ziua nouă invalidează și „zi plătită” și editările (ca înainte: lista se demonta la schimbarea zilei).
  function schimbaContext(patch, ziNoua) {
    const p = { ...patch, ctx: st.ctx + 1, randuri: RANDURI_INCARC, istoric: ISTORIC_INCARC }
    if (ziNoua) Object.assign(p, { exportZi: EXPORT_INCARC, ciorne: Object.freeze({}), mesaje: Object.freeze({}) })
    pune(p)
    genR++; genI++; zborR = false
    if (ziNoua) citesteExp()
    if (st.emps) { citesteRand(); citesteIst() }
    notifica()
  }

  // după o scriere reușită pe `ziScrisa` (rândul întors de server = starea după scriere)
  function dupaScriere(ziScrisa, rand, k) {
    const vazutAltceva = deRecitit.delete(k)
    if (ziScrisa === st.zi) {
      const aruncata = zborR || vazutAltceva
      genR++; zborR = false // orice citire plecată înaintea acestui răspuns e aruncată (și cea de fundal)
      if (st.randuri.stare === 'gata' && rand && rand.date === st.zi) {
        pune({ randuri: { ...st.randuri, recs: { ...st.randuri.recs, [rand.employee_id]: rand } } })
      }
      if (aruncata) citesteRand() // ce aducea citirea aruncată (ex. modificările altora) se recitește; fără „se încarcă”
    } else if (st.emps && ziScrisa < st.zi) {
      // istoricul zilei afișate = zilele de DINAINTEA ei: o scriere acolo îl poate schimba → se recitește
      pune({ istoric: ISTORIC_INCARC })
      citesteIst()
    }
    notifica()
  }

  // conflict de versiune (pct. 3): nimic scris; valorile rămân în câmpuri (ciorna), noua bază = rândul văzut acum, mesaj pe rând
  function aplicaConflict(k, it, v) {
    if (it.zi !== st.zi) return
    if (it.tip === 'salveaza') {
      const c = st.ciorne[k]
      const baza = amprenta(v.rec || null)
      puneCiorna(k, c ? { ...c, baza, schimbat: false, conflict: v.motiv } : { empId: it.empId, zi: it.zi, valori: it.valori, baza, rev: 1, schimbat: false, conflict: v.motiv })
    } else puneMesaj(k, v.motiv)
  }

  // o singură scriere, cu verificarea finală chiar înaintea ei
  async function executa(k, it) {
    const idR = await cuTermen(uid())
    if (idR.expirat || idR.e) return { ok: false, scris: false, nivel: 'error', motiv: 'Nu s-a putut afla utilizatorul conectat — nu am salvat nimic; încearcă din nou' }
    const v = verificaIntentie(st, it, { necunoscut: !!st.operatii[k]?.necunoscut })
    if (!v.ok) {
      if (v.conflict) aplicaConflict(k, it, v)
      return { ok: false, scris: false, conflict: !!v.conflict, nivel: v.nivel, motiv: v.motiv }
    }
    const u = idR.v
    const rand = it.tip === 'salveaza'
      ? randPentruSalvare({ empId: it.empId, zi: it.zi, siteId: v.site_id, uid: u, fields: it.fields, acum: acum() })
      : { employee_id: it.empId, date: it.zi, site_id: it.siteId || null, updated_by: u, updated_at: acum() }
    inZbor.set(k, { empId: it.empId, zi: it.zi })
    let p
    try { p = scrieRand(rand) } catch (e) { p = Promise.reject(e) }
    const { v: res, e, expirat } = await cuTermen(p)
    inZbor.delete(k)
    const err = e || res?.error
    if (expirat || (err && !eroareDeterminista(err))) {
      // L05: NU e eșec — poate s-a scris. Recitesc rândul; până la o citire pornită de acum încolo, nicio altă scriere pe el.
      deRecitit.delete(k)
      prag.set(k, genR)
      puneOp(k, { necunoscut: true, empId: it.empId, zi: it.zi })
      if (st.zi === it.zi && st.emps) citesteRand()
      Promise.resolve(p).catch(() => {}).then(() => {
        // răspunsul târziu: dacă rezultatul e încă necunoscut, doar o citire pornită DUPĂ el îl lămurește; ecranul se recitește oricum
        if (st.operatii[k]?.necunoscut) prag.set(k, genR)
        if (st.zi === it.zi && st.emps) citesteRand()
      })
      notifica()
      return { ok: false, scris: false, necunoscut: true, nivel: 'warn',
        motiv: expirat ? `Salvarea n-a răspuns în ${Math.round(termenMs / 1000)} s — nu se știe dacă s-a scris; recitesc rândul din bază înainte de orice altă salvare pe el`
          : 'Legătura cu serverul a căzut la salvare — nu se știe dacă s-a scris; recitesc rândul din bază înainte de orice altă salvare pe el' }
    }
    if (err || !res?.data) {
      deRecitit.delete(k)
      return { ok: false, scris: false, nivel: 'error', motiv: it.tip === 'salveaza' ? 'Eroare la salvare' : (err?.message || 'răspuns gol') }
    }
    const R = res.data
    // editarea pe care s-a bazat scrierea: salvată exact → dispare; editată mai departe între timp → rămâne, cu baza = rândul scris
    const c = st.ciorne[k]
    if (c && c.baza === it.baza) {
      if (it.tip === 'salveaza' && c.rev === it.rev) puneCiorna(k, null)
      else puneCiorna(k, { ...c, baza: amprenta(R), schimbat: false, conflict: it.tip === 'salveaza' ? null : c.conflict })
    }
    puneMesaj(k, null)
    dupaScriere(it.zi, R, k)
    return { ok: true, scris: true, zi: it.zi, rand: R, altaZi: it.zi !== st.zi }
  }

  // pct. 1: serializare pe rând; ce afișează rândul („se salvează”, șantierul țintă al ultimei alocări cerute)
  function actualizeazaOp(k) {
    const c = coada.get(k)
    if (!c) { puneOp(k, { salveaza: false, siteTinta: undefined }); return }
    const alocari = [c.curenta, ...c.urmatoare.map(u => u.it)].filter(x => x && x.tip === 'aloca')
    const it0 = c.curenta || c.urmatoare[0]?.it
    puneOp(k, { salveaza: true, siteTinta: alocari.length ? (alocari[alocari.length - 1].siteId || null) : undefined, empId: it0.empId, zi: it0.zi })
  }
  function programeaza(k, it) {
    return new Promise(rezolva => {
      let c = coada.get(k)
      if (!c) { c = { curenta: null, urmatoare: [] }; coada.set(k, c) }
      // o intenție nouă de același fel o înlocuiește pe cea încă nepornită (rămâne doar ultima)
      const i = c.urmatoare.findIndex(u => u.it.tip === it.tip)
      if (i >= 0) {
        const [vechi] = c.urmatoare.splice(i, 1)
        vechi.rezolva({ ok: false, scris: false, inlocuita: true, nivel: 'info', motiv: 'Înlocuită de o modificare mai nouă pe același rând' })
      }
      c.urmatoare.push({ it, rezolva })
      actualizeazaOp(k); notifica()
      if (!c.curenta) pompa(k, c)
    })
  }
  async function pompa(k, c) {
    while (c.urmatoare.length) {
      const { it, rezolva } = c.urmatoare.shift()
      c.curenta = it
      let rez
      try { rez = await executa(k, it) } catch (e) { rez = { ok: false, scris: false, nivel: 'error', motiv: 'Eroare la salvare' } }
      c.curenta = null
      // intențiile nepornite care se sprijineau pe aceeași versiune trec pe rândul scris de noi (nu e conflict cu propria scriere)
      if (rez.scris) for (const u of c.urmatoare) if (u.it.baza === it.baza) u.it.baza = amprenta(rez.rand)
      // rezultat necunoscut: nimic nu mai pleacă pe rând până la recitire
      if (rez.necunoscut) for (const u of c.urmatoare.splice(0)) u.rezolva({ ok: false, scris: false, nivel: 'warn', motiv: 'Salvarea anterioară pe acest rând are rezultat necunoscut — nu am trimis-o pe aceasta; verifică rândul după recitire și salvează din nou' })
      if (c.urmatoare.length) { actualizeazaOp(k); notifica() }
      rezolva(rez)
    }
    coada.delete(k)
    actualizeazaOp(k)
    notifica()
  }

  // salvare / alocare: verificare imediată, poarta de parolă (cu starea „zi plătită” a controlorului), coada rândului, apoi nota pe tichet
  async function trimite(it) {
    const k = cheieRand(it.empId, it.zi)
    const rec = randulZilei(st, it.empId)
    const c = it.tip === 'salveaza' ? st.ciorne[k] : null
    it.baza = c ? c.baza : amprenta(rec)          // versiunea pe care o vede utilizatorul (editarea: de la începutul ei)
    it.rev = c ? c.rev : 0
    it.valori = c ? c.valori : valoriDinRand(rec, oreImplicite(empDin(it.empId, it.emp)))
    it.exportat = st.exportZi.stare === 'gata' ? st.exportZi.exportat : null
    const v0 = verificaIntentie(st, it, { necunoscut: !!st.operatii[k]?.necunoscut })
    if (!v0.ok) {
      if (v0.conflict) { aplicaConflict(k, it, v0); notifica() }
      return { ok: false, scris: false, conflict: !!v0.conflict, nivel: v0.nivel, motiv: v0.motiv }
    }
    let g
    try { g = await poarta({ zi: it.zi, exportat: it.exportat, info: st.exportZi.info, numeAngajat: empDin(it.empId, it.emp)?.name }) } catch (e) { g = null }
    if (!g?.ok) return { ok: false, scris: false, anulat: true, nivel: 'warn', motiv: it.tip === 'salveaza' ? 'Modificare anulată — parolă necesară pentru zi plătită' : 'Realocare anulată — parolă necesară pentru zi plătită' }
    it.tichet = g.tichet || null
    const rez = await programeaza(k, it)
    if (!rez.ok) return rez
    // după o corectură pe lună închisă (după termen): nota în istoricul tichetului, pe ZIUA scrisă
    if (it.tichet) {
      try { rez.notaEroare = await noteaza({ tichet: it.tichet, emp: empDin(it.empId, it.emp), zi: it.zi, campuri: it.tip === 'salveaza' ? Object.keys(it.fields || {}) : ['site_id'] }) } catch (e) { rez.notaEroare = e?.message || 'nota pe tichet a eșuat' }
    }
    // alocarea pe zi a unui angajat fără șantier în fișă îl scoate și din „nealocați” (fișa din lista CURENTĂ, nu cea de la apăsare)
    if (it.tip === 'aloca' && it.siteId && scrieFisa) {
      const e = empDin(it.empId, null)
      if (e && e.site_id == null) {
        let r
        try { r = await scrieFisa(it.empId, it.siteId) } catch (err) { r = { error: err } }
        if (r?.error) rez.fisaEroare = r.error.message || 'eroare'
        else if (st.emps) { pune({ emps: st.emps.map(x => x.id === it.empId ? { ...x, site_id: it.siteId } : x) }); notifica() }
      }
    }
    return rez
  }

  async function reincearca() {
    const ctx0 = st.ctx
    const ps = []
    const dinEroareR = !!st.emps && st.randuri.stare === 'eroare'
    if (dinEroareR) { pune({ randuri: { ...st.randuri, reincerc: true } }); ps.push(citesteRand()) }
    if (st.emps && st.istoric.stare === 'eroare') { pune({ istoric: { ...st.istoric, reincerc: true } }); ps.push(citesteIst()) }
    if (st.exportZi.stare === 'eroare') { pune({ exportZi: { ...st.exportZi, reincerc: true } }); ps.push(citesteExp()) }
    // rânduri cu rezultat necunoscut pe ziua afișată: o recitire le lămurește
    if (!dinEroareR && st.emps && st.randuri.stare === 'gata' && Object.values(st.operatii).some(o => o.necunoscut && o.zi === st.zi)) ps.push(citesteRand())
    notifica()
    await Promise.all(ps)
    // angajații care AU deja pontaj în ziua asta (necunoscut până acum); cei cu editări sunt marcați pe rând („modificat între timp”)
    const randuriNoi = (dinEroareR && st.ctx === ctx0 && st.randuri.stare === 'gata') ? Object.values(st.randuri.recs).map(r => r.employee_id) : []
    return { randuri: st.randuri.stare, istoric: st.istoric.stare, export: st.exportZi.stare, randuriNoi }
  }

  return {
    getStare: () => st,
    aboneaza(f) { abonati.add(f); return () => { abonati.delete(f) } },
    seteazaZi(z) { if (z && z !== st.zi) schimbaContext({ zi: z }, true) },
    // aceeași listă (aceleași id-uri) = doar fișele se actualizează (ex. șantierul din fișă după alocare), fără recitire
    seteazaAngajati(emps) {
      const lista = emps || []
      const cheie = cheiaListei(lista)
      if (genE === 0) citesteExp() // prima activare: „zi plătită” pentru ziua inițială
      if (st.emps && cheie === st.cheie) { pune({ emps: lista }); notifica(); return }
      schimbaContext({ emps: lista, cheie }, false)
    },
    reincearca,
    // citirea de fundal (poll / focus): în eroare reîncearcă; altfel recitește rândurile — editările în curs sunt protejate pe rând (pct. 5)
    reimprospateaza() {
      if (!st.emps) return Promise.resolve(null)
      if (st.randuri.stare === 'eroare' || st.istoric.stare === 'eroare' || st.exportZi.stare === 'eroare') return reincearca()
      if (st.randuri.stare !== 'gata') return Promise.resolve(null)
      return citesteRand().then(() => null)
    },
    // editările din câmpurile rândului (ore, normă, diurnă, supliment, tip): ciorna se sprijină pe rândul văzut la PRIMA modificare
    editeaza(emp, patch) {
      const k = cheieRand(emp.id, st.zi)
      const e = empDin(emp.id, emp)
      const rec = randulZilei(st, emp.id)
      const baza0 = valoriDinRand(rec, oreImplicite(e))
      const c = st.ciorne[k]
      const valori = { ...(c ? c.valori : baza0), ...patch }
      const curat = valoriEgale(valori, baza0) && (!c || (!c.schimbat && !c.conflict && c.baza === amprenta(rec)))
      puneCiorna(k, curat ? null : { empId: emp.id, zi: st.zi, valori: Object.freeze(valori), baza: c ? c.baza : amprenta(rec), rev: (c?.rev || 0) + 1, schimbat: !!c?.schimbat, conflict: c?.conflict || null })
      notifica()
    },
    // „ia valorile salvate”: renunță la editarea rândului (după „modificat între timp” / conflict)
    renuntaEditare(emp) { const k = cheieRand(emp.id, st.zi); if (st.ciorne[k] || st.mesaje[k]) { puneCiorna(k, null); puneMesaj(k, null); notifica() } },
    // ctx = st.ctx din momentul apăsării: dacă ziua / lista s-au schimbat între timp, nu se scrie nimic
    salveaza(emp, fields, { ctx } = {}) { return trimite({ tip: 'salveaza', empId: emp.id, emp, zi: st.zi, ctx: ctx ?? st.ctx, fields }) },
    aloca(emp, siteId, { ctx } = {}) { return trimite({ tip: 'aloca', empId: emp.id, emp, zi: st.zi, ctx: ctx ?? st.ctx, siteId: siteId || null }) },
  }
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
