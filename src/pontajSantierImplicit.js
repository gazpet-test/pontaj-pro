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
//          randuri: { stare: 'incarc'|'gata'|'eroare', recs, err, reincerc }, istoric: { stare, harta, err, reincerc } }
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

// ══ Controlorul zilei (r3 după re-review #1091): TOATĂ orchestrarea asincronă a pontajului zilei, fără React ══
// Pagina (PontajPage) doar se abonează (useSyncExternalStore(aboneaza, getStare)) și cheamă metodele. Garanții (L24, L03):
//   * „ultima cerere câștigă, pe sursă”: rândurile și istoricul au fiecare generația lor, crescătoare; un răspuns se aplică DOAR dacă e al
//     celei mai noi cereri a sursei lui — nicio comparație pe zi / listă nu ține loc de generație;
//   * orice schimbare de context (zi SAU lista de angajați, inclusiv revenirea pe o zi văzută) → rândurile și istoricul devin imediat
//     „se încarcă”; nimic citit înainte nu mai e folosit (fără memorie între zile);
//   * scrierile bat citirile plecate înaintea lor: o salvare / alocare reușită pe ziua afișată crește generația rândurilor (citirea în zbor,
//     inclusiv cea de fundal, e aruncată), își aplică rândul, apoi cere o citire nouă dacă a aruncat una; o scriere pe o zi ANTERIOARĂ celei
//     afișate schimbă istoricul ei → istoricul zilei afișate se recitește;
//   * salvarea se decide pe instantaneul curent și e refuzată dacă ziua / lista s-au schimbat de la apăsare (ctx), dacă rândurile nu sunt
//     citite sau dacă șantierul ar veni din istoric și istoricul nu e citit;
//   * eroarea la citirea rândurilor e o stare distinctă (L18); „Reîncearcă” recitește ce e în eroare FĂRĂ spinner (rândurile rămân montate,
//     completările rămân), iar citirea de fundal reîncearcă și ea, indiferent de editările în curs.
// Dependențe (injectate, ca testele să elibereze promisiunile în ordinea aleasă):
//   citesteRanduri(zi, ids) → { data, error }; citesteIstoric(ids, zi) → Map (aruncă la eroare); scrieRand(rand) → { data, error }; uid() → id
const RANDURI_INCARC = Object.freeze({ stare: 'incarc', recs: Object.freeze({}), err: null, reincerc: false })
const ISTORIC_INCARC = Object.freeze({ stare: 'incarc', harta: new Map(), err: null, reincerc: false })

export function creeazaControlorZi({ zi, citesteRanduri, citesteIstoric, scrieRand, uid, acum = () => new Date().toISOString() }) {
  let st = Object.freeze({ zi, emps: null, cheie: null, ctx: 0, randuri: RANDURI_INCARC, istoric: ISTORIC_INCARC })
  let genR = 0          // generația ultimei cereri de rânduri (crește și la scrieri)
  let genI = 0          // generația ultimei cereri de istoric
  let zborR = false     // o citire de rânduri din generația curentă e în zbor
  const abonati = new Set()
  const pune = (patch) => { st = Object.freeze({ ...st, ...patch }) }
  const notifica = () => { for (const f of [...abonati]) f() }
  const idsCurente = () => (st.emps || []).map(e => e.id)

  function citesteRand() {
    const g = ++genR
    const ziC = st.zi, ids = idsCurente()
    if (!ids.length) { zborR = false; pune({ randuri: { stare: 'gata', recs: {}, err: null, reincerc: false } }); return Promise.resolve() }
    zborR = true
    let p
    try { p = citesteRanduri(ziC, ids) } catch (e) { p = Promise.reject(e) }
    return Promise.resolve(p)
      .then(res => res, e => ({ data: null, error: { message: e?.message || String(e) } }))
      .then(res => {
        if (g !== genR) return // a venit între timp o cerere mai nouă sau o scriere: răspunsul e vechi
        zborR = false
        const r = st.randuri
        if (res?.error || !Array.isArray(res?.data)) {
          if (r.stare === 'gata') return // citire de fundal eșuată: rămâne ultima citire reușită a ACESTUI context
          pune({ randuri: { stare: 'eroare', recs: {}, err: res?.error?.message || 'răspuns fără rânduri', reincerc: false } })
        } else {
          const m = {}
          for (const x of res.data) {
            if (!x || x.date !== ziC) continue // un rând al altei zile nu intră niciodată
            const old = r.recs[x.employee_id]
            // identitatea obiectelor nemodificate se păstrează (PontajRow nu-și resetează ce ai tastat)
            m[x.employee_id] = (old && JSON.stringify(old) === JSON.stringify(x)) ? old : x
          }
          pune({ randuri: { stare: 'gata', recs: m, err: null, reincerc: false } })
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
    return Promise.resolve(p)
      .then(h => ({ h }), e => ({ e: e || new Error('eroare') }))
      .then(({ h, e }) => {
        if (g !== genI) return
        if (e || !(h instanceof Map)) pune({ istoric: { stare: 'eroare', harta: new Map(), err: e ? (e.message || String(e)) : 'răspuns fără rezultat', reincerc: false } })
        else pune({ istoric: { stare: 'gata', harta: h, err: null, reincerc: false } })
        notifica()
      })
  }

  // zi SAU listă nouă: tot ce s-a citit înainte iese din stare, răspunsurile în zbor devin vechi, se citește contextul nou
  function schimbaContext(patch) {
    pune({ ...patch, ctx: st.ctx + 1, randuri: RANDURI_INCARC, istoric: ISTORIC_INCARC })
    genR++; genI++; zborR = false
    if (st.emps) { citesteRand(); citesteIst() }
    notifica()
  }

  // după o scriere reușită pe `ziScrisa` (rândul întors de server = starea după scriere)
  function dupaScriere(ziScrisa, rand) {
    if (ziScrisa === st.zi) {
      const aruncata = zborR
      genR++; zborR = false // orice citire plecată înaintea acestui răspuns e aruncată (și cea de fundal)
      if (st.randuri.stare === 'gata' && rand && rand.date === st.zi) {
        pune({ randuri: { ...st.randuri, recs: { ...st.randuri.recs, [rand.employee_id]: rand } } })
      }
      if (aruncata) citesteRand() // ce aducea citirea aruncată (ex. modificările altora) se recitește; starea nu trece prin „se încarcă”
    } else if (st.emps && ziScrisa < st.zi) {
      // istoricul zilei afișate = zilele de DINAINTEA ei: o scriere acolo îl poate schimba → se recitește
      pune({ istoric: ISTORIC_INCARC })
      citesteIst()
    }
    notifica()
  }

  async function reincearca() {
    const ctx0 = st.ctx
    const ps = []
    const dinEroareR = !!st.emps && st.randuri.stare === 'eroare'
    if (dinEroareR) { pune({ randuri: { ...st.randuri, reincerc: true } }); ps.push(citesteRand()) }
    if (st.emps && st.istoric.stare === 'eroare') { pune({ istoric: { ...st.istoric, reincerc: true } }); ps.push(citesteIst()) }
    notifica()
    await Promise.all(ps)
    // angajații care AU deja pontaj în ziua asta (necunoscut până acum): pagina îi anunță, rândul lor arată acum valorile salvate
    const randuriNoi = (dinEroareR && st.ctx === ctx0 && st.randuri.stare === 'gata') ? Object.values(st.randuri.recs).map(r => r.employee_id) : []
    return { randuri: st.randuri.stare, istoric: st.istoric.stare, randuriNoi }
  }

  return {
    getStare: () => st,
    aboneaza(f) { abonati.add(f); return () => { abonati.delete(f) } },
    seteazaZi(z) { if (z && z !== st.zi) schimbaContext({ zi: z }) },
    // aceeași listă (aceleași id-uri) = doar fișele se actualizează (ex. șantierul din fișă după alocare), fără recitire
    seteazaAngajati(emps) {
      const lista = emps || []
      const cheie = cheiaListei(lista)
      if (st.emps && cheie === st.cheie) { pune({ emps: lista }); notifica(); return }
      schimbaContext({ emps: lista, cheie })
    },
    reincearca,
    // citirea de fundal (poll / focus): în eroare reîncearcă ORICUM (nu depinde de editări); altfel sare cât există editări nesalvate
    reimprospateaza({ editari = false } = {}) {
      if (!st.emps) return Promise.resolve(null)
      if (st.randuri.stare === 'eroare' || st.istoric.stare === 'eroare') return reincearca()
      if (editari || st.randuri.stare !== 'gata') return Promise.resolve(null)
      return citesteRand().then(() => null)
    },
    // ctx = st.ctx din momentul apăsării (înaintea porții de parolă): dacă ziua / lista s-au schimbat între timp, nu se scrie nimic
    async salveaza(emp, fields, { ctx } = {}) {
      const u = await uid()
      if (ctx != null && ctx !== st.ctx) return { ok: false, scris: false, nivel: 'warn', motiv: 'Ziua sau lista afișată s-a schimbat între timp — nu am salvat nimic; verifică rândul și apasă din nou 💾' }
      const snap = st
      const e = (snap.emps || []).find(x => x.id === emp.id) || emp
      const v = verificaSalvare(propuneSantier(snap, e), fields)
      if (!v.ok) return { ok: false, scris: false, nivel: v.nivel, motiv: v.motiv }
      const ziS = snap.zi
      let res
      try { res = await scrieRand(randPentruSalvare({ empId: e.id, zi: ziS, siteId: v.site_id, uid: u, fields, acum: acum() })) } catch (err) { res = { data: null, error: err } }
      if (res?.error || !res?.data) return { ok: false, scris: false, nivel: 'error', motiv: 'Eroare la salvare' }
      dupaScriere(ziS, res.data)
      return { ok: true, scris: true, zi: ziS, rand: res.data, altaZi: ziS !== st.zi }
    },
    async aloca(emp, siteId, { ctx } = {}) {
      const u = await uid()
      if (ctx != null && ctx !== st.ctx) return { ok: false, motiv: 'ziua afișată s-a schimbat între timp — nu am scris nimic' }
      const ziS = st.zi
      let res
      try { res = await scrieRand({ employee_id: emp.id, date: ziS, site_id: siteId || null, updated_by: u, updated_at: acum() }) } catch (err) { res = { data: null, error: err } }
      if (res?.error || !res?.data) return { ok: false, motiv: res?.error?.message || 'răspuns gol' }
      dupaScriere(ziS, res.data)
      return { ok: true, zi: ziS, rand: res.data, altaZi: ziS !== st.zi }
    },
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
