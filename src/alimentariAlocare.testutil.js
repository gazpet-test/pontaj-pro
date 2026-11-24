// Client Supabase FALS pentru testele alocării alimentărilor (alimentariAlocare.test.js, FaraSantierBulkModal.test.jsx):
// un tabel în memorie care se comportă ca PostgREST pe operațiile folosite — select / update cu RETURNING, is / eq / gt,
// filter(col, 'in', '("a","b")'), or('col.is.null,col.in.(...)'), order, limit, count exact — și cu plafonul de
// rânduri al serverului (max-rows = 1000 implicit, ca în producție). Fiecare cerere e jurnalizată (filtrele ca text),
// iar testele pot: amâna răspunsul unei cereri (L24), injecta o modificare concurentă înainte de un UPDATE (CAS),
// întoarce o eroare sau respinge promisiunea.

// Lista PostgREST „(v1,"v 2","a\"b")” → valori (ghilimele cu \ și " escapate; fără ghilimele = text brut)
export function parseazaListaIn(text) {
  if (!text.startsWith('(') || !text.endsWith(')')) throw new Error('lista in invalidă: ' + text)
  const s = text.slice(1, -1)
  const out = []
  let i = 0
  if (s === '') return out
  while (i <= s.length) {
    if (s[i] === '"') {
      let v = ''
      i++
      while (i < s.length && s[i] !== '"') { if (s[i] === '\\') i++; v += s[i]; i++ }
      if (s[i] !== '"') throw new Error('ghilimele neînchise: ' + text)
      i++
      out.push(v)
    } else {
      let j = i
      while (j < s.length && s[j] !== ',') j++
      out.push(s.slice(i, j))
      i = j
    }
    if (i >= s.length) break
    if (s[i] !== ',') throw new Error('separator lipsă: ' + text)
    i++
  }
  return out
}

// Împarte după virgulele de pe nivelul 0 (în afara parantezelor și ghilimelelor)
function imparteNivel0(expr) {
  const parti = []
  let ad = 0, ghi = false, cur = ''
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i]
    if (ghi) { cur += c; if (c === '\\') { cur += expr[++i] } else if (c === '"') ghi = false; continue }
    if (c === '"') ghi = true
    else if (c === '(') ad++
    else if (c === ')') ad--
    if (c === ',' && ad === 0) { parti.push(cur); cur = '' } else cur += c
  }
  parti.push(cur)
  return parti
}

function conditie(col, op, val) {
  if (op === 'is' && val === 'null') return r => (r[col] ?? null) === null
  if (op === 'in') { const v = parseazaListaIn(val); return r => typeof r[col] === 'string' && v.includes(r[col]) }
  if (op === 'eq') return r => String(r[col]) === val
  throw new Error('operator necunoscut în or(): ' + op)
}

export function clientFals(randuri = [], { maxRows = 1000, amana = null, inainteDeUpdate = null, eroare = null } = {}) {
  const tabel = randuri.map(r => ({ ...r }))
  const cereri = []

  function executa(st) {
    const potrivite = () => tabel.filter(r => st.filtre.every(f => f(r)))
    if (st.op === 'update') {
      if (inainteDeUpdate) inainteDeUpdate(st, tabel)
      const err = eroare && eroare(st)
      if (err === 'respinge') return Promise.reject(new Error('Failed to fetch'))
      if (err) return { data: null, error: err, count: null }
      const m = potrivite()
      for (const r of m) Object.assign(r, st.upd)
      return { data: st.ret ? m.map(r => ({ id: r.id })) : null, error: null, count: null }
    }
    const err = eroare && eroare(st)
    if (err === 'respinge') return Promise.reject(new Error('Failed to fetch'))
    if (err) return { data: null, error: err, count: null }
    let m = potrivite()
    const count = st.count ? m.length : null
    m = [...m].sort((a, b) => {
      for (const [c, asc] of st.ord) {
        const x = a[c] ?? '', y = b[c] ?? ''
        if (x < y) return asc ? -1 : 1
        if (x > y) return asc ? 1 : -1
      }
      return 0
    })
    m = m.slice(0, Math.min(st.lim ?? Infinity, maxRows))
    return { data: m.map(r => ({ ...r })), error: null, count }
  }

  const client = {
    from(t) {
      const st = { tabel: t, op: 'select', filtre: [], urme: [], ord: [], lim: null, upd: null, ret: false, count: false }
      cereri.push(st)
      const b = {
        select(cols, opt) {
          if (st.op === 'update') st.ret = true
          else { st.cols = cols; st.count = opt?.count === 'exact' }
          return b
        },
        update(v) { st.op = 'update'; st.upd = { ...v }; return b },
        is(c, v) { st.urme.push(`${c}=is.${v}`); st.filtre.push(r => (r[c] ?? null) === v); return b },
        eq(c, v) { st.urme.push(`${c}=eq.${v}`); st.filtre.push(r => r[c] === v); return b },
        gt(c, v) { st.urme.push(`${c}=gt.${v}`); st.filtre.push(r => r[c] > v); return b },
        filter(c, op, v) { st.urme.push(`${c}=${op}.${v}`); st.filtre.push(conditie(c, op, v)); return b },
        or(expr) {
          st.urme.push(`or=(${expr})`)
          const cond = imparteNivel0(expr).map(p => { const m = p.match(/^([a-z_]+)\.([a-z]+)\.(.*)$/s); if (!m) throw new Error('or() invalid: ' + p); return conditie(m[1], m[2], m[3]) })
          st.filtre.push(r => cond.some(f => f(r)))
          return b
        },
        order(c, o = {}) { st.ord.push([c, o.ascending !== false]); return b },
        limit(n) { st.lim = n; return b },
        then(rez, resp) {
          const p = Promise.resolve(amana ? amana(st) : null).then(() => executa(st))
          return p.then(rez, resp)
        },
      }
      return b
    },
  }
  return { client, tabel, cereri }
}
