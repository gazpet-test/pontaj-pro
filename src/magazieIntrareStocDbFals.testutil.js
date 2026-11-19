// TKT-0353: client Supabase fals pentru testele intrării peste stoc (doar teste).
// Tabelul magazie_echipamente în memorie; .eq/.is filtrează ca PostgREST (=== pe valoare, is null doar pe NULL);
// hook-uri: dupaCitire(tabel, nrCitire) simulează o scriere concurentă, laUpdate(tabel, q) înlocuiește răspunsul UPDATE.
export function dbFals(randuri, { dupaCitire, laUpdate } = {}) {
  const tabel = new Map(randuri.map(r => [r.id, { ...r }]))
  const jurnal = { citiri: 0, update: [] }
  const potriveste = (rand, filtre) => filtre.every(([op, c, v]) => op === 'eq' ? rand[c] === v : (rand[c] ?? null) === v)
  const db = {
    from(nume) {
      if (nume !== 'magazie_echipamente') throw new Error('tabel neașteptat: ' + nume)
      const q = { op: 'select', filtre: [], valori: null }
      const exec = () => {
        if (q.op === 'update') {
          jurnal.update.push({ valori: q.valori, filtre: q.filtre })
          if (laUpdate) { const r = laUpdate(tabel, q); if (r) return r }
          const atinse = [...tabel.values()].filter(r => potriveste(r, q.filtre))
          for (const r of atinse) Object.assign(r, q.valori)
          return { data: atinse.map(r => ({ id: r.id })), error: null }
        }
        jurnal.citiri++
        const gasite = [...tabel.values()].filter(r => potriveste(r, q.filtre)).map(r => ({ ...r }))
        const rez = { data: gasite[0] || null, error: null }
        if (dupaCitire) dupaCitire(tabel, jurnal.citiri)
        return rez
      }
      const b = {
        select() { return b },
        update(v) { q.op = 'update'; q.valori = v; return b },
        eq(c, v) { q.filtre.push(['eq', c, v]); return b },
        is(c, v) { q.filtre.push(['is', c, v]); return b },
        maybeSingle() { return Promise.resolve(exec()) },
        then(ok, err) { return Promise.resolve(exec()).then(ok, err) },
      }
      return b
    },
  }
  return { db, tabel, jurnal }
}
