// Contract B1: o linie RPC pentru fiecare marime; UM vine exclusiv din catalog.
function textZecimal(valoare) {
  const text = String(valoare ?? '').trim().replace(',', '.')
  if (typeof valoare !== 'number' || !text.includes('e')) return text
  const [baza, exponent] = text.split('e')
  const [intreg, fractie = ''] = baza.split('.')
  const cifre = intreg + fractie
  const punct = intreg.length + Number(exponent)
  if (punct <= 0) return '0.' + '0'.repeat(-punct) + cifre
  if (punct >= cifre.length) return cifre + '0'.repeat(punct - cifre.length)
  return cifre.slice(0, punct) + '.' + cifre.slice(punct)
}

function zecimalaCanonica(text) {
  const [intreg, fractie = ''] = text.split('.')
  return (intreg.replace(/^0+/, '') || '0') + '.' + fractie.replace(/0+$/, '')
}

// Marimea numerica are o singura forma (42, 042 si 42.0 devin 42), ca stocul sa nu se fragmenteze.
export function canonicalMarime(marime) {
  const m = String(marime ?? '').trim().toUpperCase().replace(',', '.')
  if (!/^\d+(?:\.\d+)?$/.test(m)) return m
  const [intreg, fractie = ''] = m.split('.')
  const f = fractie.replace(/0+$/, '')
  return (intreg.replace(/^0+/, '') || '0') + (f ? '.' + f : '')
}

export function normalizeazaNumar(valoare) {
  const text = textZecimal(valoare)
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(text)) return NaN
  const numar = Number(text)
  // Nu rotunjim in tacere o cantitate care nu incape in payload-ul numeric JS.
  return Number.isFinite(numar) && numar <= Number.MAX_SAFE_INTEGER && zecimalaCanonica(text) === zecimalaCanonica(textZecimal(numar)) ? numar : NaN
}

export function validareRepartizare(cantitate, pe_marimi) {
  const q = normalizeazaNumar(cantitate)
  const invalid = eroare => ({ valid: false, eroare, suma: 0 })
  if (!(q > 0)) return invalid('Cantitatea trebuie sa fie un numar pozitiv.')
  if (!Array.isArray(pe_marimi) || !pe_marimi.length) return invalid('Adauga repartizarea pe marimi.')
  const vazute = new Set()
  for (const rand of pe_marimi) {
    // NULL este rezervat articolelor cu marime unica; sirul gol nu este o marime.
    const marime = rand.marime === null ? null : canonicalMarime(rand.marime)
    if (marime === '') return invalid('Marimea lipseste. Alege nespecificat daca nu este cunoscuta.')
    if (vazute.has(marime)) return invalid('Aceeasi marime apare de doua ori.')
    vazute.add(marime)
    if (!(normalizeazaNumar(rand.cantitate) > 0)) return invalid('Cantitatea pe fiecare marime trebuie sa fie pozitiva.')
  }
  // Comparam zecimalele exact, fara toleranta care ar accepta diferente reale.
  const texte = [cantitate, ...pe_marimi.map(r => r.cantitate)].map(textZecimal)
  const scala = Math.max(...texte.map(t => (t.split('.')[1] || '').length))
  const intreg = t => {
    const [a, b = ''] = t.split('.')
    return BigInt((a || '0') + b.padEnd(scala, '0'))
  }
  const sumaExacta = texte.slice(1).reduce((s, t) => s + intreg(t), 0n)
  const cifre = sumaExacta.toString().padStart(scala + 1, '0')
  const suma = scala ? (cifre.slice(0, -scala) + '.' + cifre.slice(-scala)).replace(/\.?0+$/, '') : cifre
  const valid = sumaExacta === intreg(texte[0])
  return { valid, suma, eroare: valid ? '' : 'Suma pe marimi trebuie sa fie egala cu cantitatea.' }
}

export function validareMarime(tip, marime) {
  if (tip === 'unica') return marime === null
  const m = String(marime ?? '').trim().toUpperCase()
  if (m === 'NESPECIFICAT') return true
  if (tip === 'numar') return /^\d+(?:[.,]\d+)?$/.test(m) && normalizeazaNumar(m) > 0
  if (tip === 'litera') return /^(?:X{0,4}[SL]|M|[2-6]X[SL])$/.test(m)
  return false
}

export function construiesteAntetSiLinii(formular) {
  const text = v => String(v ?? '').trim()
  const { furnizor_cui, furnizor_nume, factura_nr, factura_data, linii } = formular
  if (!text(furnizor_cui) || !text(furnizor_nume) || !text(factura_nr)) throw new Error('Completeaza furnizorul si numarul documentului.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(factura_data) || !Number.isFinite(Date.parse(factura_data)) || new Date(factura_data).toISOString().slice(0, 10) !== factura_data) throw new Error('Data documentului este invalida.')
  if (text(formular.observatii)) throw new Error('RPC-ul B1 nu poate salva observatii.')
  if (!Array.isArray(linii) || !linii.length) throw new Error('Adauga cel putin un articol.')
  const p_linii = linii.flatMap(linie => {
    const a = linie.articol
    if (!a || !/^[1-9]\d*$/.test(String(a.id)) || !['buc', 'pereche'].includes(a.um) || a.activ === false) throw new Error('Alege un articol activ din catalog.')
    const verificare = validareRepartizare(linie.cantitate, linie.pe_marimi)
    if (!verificare.valid) throw new Error(verificare.eroare)
    return linie.pe_marimi.map(r => {
      if (!validareMarime(a.tip_marime, r.marime)) throw new Error('Marimea nu corespunde tipului articolului.')
      return { articol_id: a.id, marime: r.marime === null ? null : canonicalMarime(r.marime), cantitate: normalizeazaNumar(r.cantitate) }
    })
  })
  return { p_antet: { furnizor_cui: text(furnizor_cui).toUpperCase(), furnizor_nume: text(furnizor_nume), factura_nr: text(factura_nr), factura_data }, p_linii }
}

export function construiesteCerere(formular, cheie) {
  if (!cheie?.trim()) throw new Error('Cheia receptiei lipseste. Redeschide formularul.')
  return { ...construiesteAntetSiLinii(formular), p_cheie: cheie }
}
