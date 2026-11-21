// TKT-0353: client Supabase fals pentru testele intrării peste stoc (doar teste).
// Tabelul magazie_echipamente în memorie; .eq/.is filtrează ca PostgREST (=== pe valoare, is null doar pe NULL);
// hook-uri: dupaCitire(tabel, nrCitire) simulează o scriere concurentă, laUpdate(tabel, q) înlocuiește răspunsul UPDATE.
// r2: citirile de listă (v_magazie_echipamente = același tabel) suportă .order('id') / .gt / .limit și plafonul serverului
// `maxRows` (PostgREST întoarce cel mult atâtea rânduri, oricât cere .limit); laLista(nrPagina) poate întoarce o eroare.
// r3: .insert(payload) adaugă rânduri cu id-uri noi (după cel mai mare id); laInsert(tabel, payload, insereaza) poate înlocui răspunsul
// (ex. inserarea ajunge în tabel, dar răspunsul e o eroare de rețea cu status 0, ca în postgrest-js). Răspunsurile poartă status.
// r5 (migrarea 20261231a): referinta_intentie e UNICĂ (NULL-urile nu se compară). .upsert(v, { onConflict: 'referinta_intentie',
// ignoreDuplicates: true }) = INSERT … ON CONFLICT DO NOTHING (rândul cu cheie existentă se sare); .insert cu o cheie existentă = 409 / 23505,
// nimic scris (instrucțiunea e atomică). `insereaza` primit de laInsert aplică aceleași reguli (cererea întârziată care ajunge mai târziu).
// `unic: false` = BD-ul FĂRĂ migrare (pentru mutanți: dublura devine posibilă). .in(c, lista) filtrează; laRecitire(nr) poate întoarce o eroare.
export function dbFals(randuri, { dupaCitire, laUpdate, laInsert, maxRows = 1000, laLista, laRecitire, unic = true } = {}) {
  const tabel = new Map(randuri.map(r => [r.id, { ...r }]))
  const jurnal = { citiri: 0, liste: 0, recitiri: 0, update: [], insert: [], upsert: [] }
  const areCheia = k => k != null && [...tabel.values()].some(r => r.referinta_intentie != null && r.referinta_intentie === k)
  // ignora = true: ON CONFLICT DO NOTHING; false: INSERT simplu (cheie existentă → 23505 pe toată instrucțiunea)
  const insereaza = (payload, ignora = true) => {
    const rows = [].concat(payload)
    if (unic && !ignora) {
      const chei = rows.map(p => p.referinta_intentie).filter(k => k != null)
      if (chei.some(areCheia) || new Set(chei).size !== chei.length) return { data: null, error: { message: 'duplicate key value violates unique constraint "magazie_echipamente_referinta_intentie_key"', code: '23505' }, status: 409 }
    }
    let id = Math.max(0, ...[...tabel.keys()].map(Number).filter(Number.isFinite))
    for (const p of rows) {
      if (unic && ignora && areCheia(p.referinta_intentie)) continue
      id++; tabel.set(id, { activ: true, ...p, id })
    }
    return { data: null, error: null, status: 201 }
  }
  const potriveste = (rand, filtre) => filtre.every(([op, c, v]) => op === 'eq' ? rand[c] === v : op === 'gt' ? rand[c] > v : op === 'in' ? v.includes(rand[c]) : (rand[c] ?? null) === v)
  const db = {
    from(nume) {
      if (nume !== 'magazie_echipamente' && nume !== 'v_magazie_echipamente') throw new Error('tabel neașteptat: ' + nume)
      const q = { op: 'select', filtre: [], valori: null, ordine: null, limita: null, optiuni: null }
      const exec = singur => {
        if (q.op === 'insert' || q.op === 'upsert') {
          const ignora = q.op === 'upsert'
          if (ignora && !(q.optiuni?.onConflict === 'referinta_intentie' && q.optiuni?.ignoreDuplicates === true)) throw new Error('upsert neașteptat: ' + JSON.stringify(q.optiuni))
          jurnal.insert.push(q.valori)
          if (ignora) jurnal.upsert.push(q.optiuni)
          const ins = p => insereaza(p, ignora)
          if (laInsert) { const r = laInsert(tabel, q.valori, ins); if (r) return r }
          return ins(q.valori)
        }
        if (q.op === 'update') {
          jurnal.update.push({ valori: q.valori, filtre: q.filtre })
          if (laUpdate) { const r = laUpdate(tabel, q); if (r) return r }
          const atinse = [...tabel.values()].filter(r => potriveste(r, q.filtre))
          for (const r of atinse) Object.assign(r, q.valori)
          return { data: atinse.map(r => ({ id: r.id })), error: null }
        }
        // vederea listei are coloanele fixate la creare (înaintea migrării): referinta_intentie NU apare în ea, ca pe live
        const gasite = [...tabel.values()].filter(r => potriveste(r, q.filtre)).map(r => {
          const c = { ...r }
          if (nume === 'v_magazie_echipamente') delete c.referinta_intentie
          return c
        })
        if (singur) {
          jurnal.citiri++
          const rez = { data: gasite[0] || null, error: null }
          if (dupaCitire) dupaCitire(tabel, jurnal.citiri)
          return rez
        }
        if (q.filtre.some(([op]) => op === 'in')) {
          jurnal.recitiri++
          if (laRecitire) { const r = laRecitire(jurnal.recitiri); if (r) return r }
          return { data: gasite.slice(0, maxRows), error: null, status: 200 }
        }
        jurnal.liste++
        if (laLista) { const r = laLista(jurnal.liste); if (r) return r }
        if (q.ordine) gasite.sort((a, b) => (a[q.ordine] > b[q.ordine] ? 1 : a[q.ordine] < b[q.ordine] ? -1 : 0))
        return { data: gasite.slice(0, Math.min(q.limita ?? Infinity, maxRows)), error: null }
      }
      const b = {
        select() { return b },
        update(v) { q.op = 'update'; q.valori = v; return b },
        insert(v) { q.op = 'insert'; q.valori = v; return b },
        upsert(v, o) { q.op = 'upsert'; q.valori = v; q.optiuni = o; return b },
        eq(c, v) { q.filtre.push(['eq', c, v]); return b },
        is(c, v) { q.filtre.push(['is', c, v]); return b },
        gt(c, v) { q.filtre.push(['gt', c, v]); return b },
        in(c, v) { q.filtre.push(['in', c, v]); return b },
        order(c) { q.ordine = c; return b },
        limit(n) { q.limita = n; return b },
        maybeSingle() { return Promise.resolve(exec(true)) },
        then(ok, err) { return Promise.resolve(exec(false)).then(ok, err) },
      }
      return b
    },
  }
  return { db, tabel, jurnal }
}
