// TKT-0353: client Supabase fals pentru testele intrării peste stoc (doar teste).
// Tabelul magazie_echipamente în memorie; .eq/.is filtrează ca PostgREST (=== pe valoare, is null doar pe NULL);
// hook-uri: dupaCitire(tabel, nrCitire) simulează o scriere concurentă, laUpdate(tabel, q) înlocuiește răspunsul UPDATE.
// r2: citirile de listă (v_magazie_echipamente = același tabel) suportă .order('id') / .gt / .limit și plafonul serverului
// `maxRows` (PostgREST întoarce cel mult atâtea rânduri, oricât cere .limit); laLista(nrPagina) poate întoarce o eroare.
export function dbFals(randuri, { dupaCitire, laUpdate, maxRows = 1000, laLista } = {}) {
  const tabel = new Map(randuri.map(r => [r.id, { ...r }]))
  const jurnal = { citiri: 0, liste: 0, update: [] }
  const potriveste = (rand, filtre) => filtre.every(([op, c, v]) => op === 'eq' ? rand[c] === v : op === 'gt' ? rand[c] > v : (rand[c] ?? null) === v)
  const db = {
    from(nume) {
      if (nume !== 'magazie_echipamente' && nume !== 'v_magazie_echipamente') throw new Error('tabel neașteptat: ' + nume)
      const q = { op: 'select', filtre: [], valori: null, ordine: null, limita: null }
      const exec = singur => {
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
