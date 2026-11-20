// TKT-0353: client Supabase fals pentru testele intrării peste stoc (doar teste).
// Tabelul magazie_echipamente în memorie; .eq/.is filtrează ca PostgREST (=== pe valoare, is null doar pe NULL);
// hook-uri: dupaCitire(tabel, nrCitire) simulează o scriere concurentă, laUpdate(tabel, q) înlocuiește răspunsul UPDATE.
// r2: citirile de listă (v_magazie_echipamente = același tabel) suportă .order('id') / .gt / .limit și plafonul serverului
// `maxRows` (PostgREST întoarce cel mult atâtea rânduri, oricât cere .limit); laLista(nrPagina) poate întoarce o eroare.
// r3: .insert(payload) adaugă rânduri cu id-uri noi (după cel mai mare id); laInsert(tabel, payload) poate înlocui răspunsul
// (ex. inserarea ajunge în tabel, dar răspunsul e o eroare de rețea cu status 0, ca în postgrest-js). Răspunsurile poartă status.
export function dbFals(randuri, { dupaCitire, laUpdate, laInsert, maxRows = 1000, laLista } = {}) {
  const tabel = new Map(randuri.map(r => [r.id, { ...r }]))
  const jurnal = { citiri: 0, liste: 0, update: [], insert: [] }
  const insereaza = payload => {
    let id = Math.max(0, ...[...tabel.keys()].map(Number).filter(Number.isFinite))
    for (const p of [].concat(payload)) { id++; tabel.set(id, { activ: true, ...p, id }) }
  }
  const potriveste = (rand, filtre) => filtre.every(([op, c, v]) => op === 'eq' ? rand[c] === v : op === 'gt' ? rand[c] > v : (rand[c] ?? null) === v)
  const db = {
    from(nume) {
      if (nume !== 'magazie_echipamente' && nume !== 'v_magazie_echipamente') throw new Error('tabel neașteptat: ' + nume)
      const q = { op: 'select', filtre: [], valori: null, ordine: null, limita: null }
      const exec = singur => {
        if (q.op === 'insert') {
          jurnal.insert.push(q.valori)
          if (laInsert) { const r = laInsert(tabel, q.valori, insereaza); if (r) return r }
          insereaza(q.valori)
          return { data: null, error: null, status: 201 }
        }
        if (q.op === 'update') {
          jurnal.update.push({ valori: q.valori, filtre: q.filtre })
          if (laUpdate) { const r = laUpdate(tabel, q); if (r) return r }
          const atinse = [...tabel.values()].filter(r => potriveste(r, q.filtre))
          for (const r of atinse) Object.assign(r, q.valori)
          return { data: atinse.map(r => ({ id: r.id })), error: null }
        }
        const gasite = [...tabel.values()].filter(r => potriveste(r, q.filtre)).map(r => ({ ...r }))
        if (singur) {
          jurnal.citiri++
          const rez = { data: gasite[0] || null, error: null }
          if (dupaCitire) dupaCitire(tabel, jurnal.citiri)
          return rez
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
        eq(c, v) { q.filtre.push(['eq', c, v]); return b },
        is(c, v) { q.filtre.push(['is', c, v]); return b },
        gt(c, v) { q.filtre.push(['gt', c, v]); return b },
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
