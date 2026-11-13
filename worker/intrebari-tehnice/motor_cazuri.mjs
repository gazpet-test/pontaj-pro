// Rularea cazurilor comune (teste_motor.json) pe MOTORUL UNIC — aceeași în vitest (src/intrebariMascare.test.js) și în pagina de
// browser (motor_browser.html). Procesul Node real are rularea lui, prin protocol (test_motor.py). Nu face parte din motor și nu
// e în manifest: doar teste. Fără importuri (motorul și cazurile vin ca argumente), ca să meargă și în browser fără bundler.

/** Caracterele scrise în cazuri ca nume între acolade (vezi „_despre” din teste_motor.json). */
export const INVIZIBILE = { NBSP: 0xa0, ZW: 0x200b, SHY: 0xad, BOM: 0xfeff, CGJ: 0x34f, VS16: 0xfe0f, VS1: 0xfe00, VS17: 0xe0100,
  ZWJ: 0x200d, VIRGULA_JOS: 0x326, SEDILA: 0x327, U2010: 0x2010, U2011: 0x2011, LINIUTA_EN: 0x2013, U2012: 0x2012, U2014: 0x2014,
  U2E3A: 0x2e3a, BULINA: 0x2022, MINUS: 0x2212 }

export function inlocuiesteInvizibile(x) {
  if (typeof x === 'string') return x.replace(/\{([A-Z0-9_]+)\}/g, (tot, n) => Object.hasOwn(INVIZIBILE, n) ? String.fromCodePoint(INVIZIBILE[n]) : tot)
  if (Array.isArray(x)) return x.map(inlocuiesteInvizibile)
  if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, inlocuiesteInvizibile(v)]))
  return x
}

/** JSON cu cheile sortate (comparație fără să conteze ordinea cheilor). */
export function canonic(x) {
  if (Array.isArray(x)) return '[' + x.map(canonic).join(',') + ']'
  if (x && typeof x === 'object') return '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + canonic(x[k])).join(',') + '}'
  return JSON.stringify(x === undefined ? null : x)
}

/** Dicționarul unui caz: „complet” (implicit), „fara_localitati” (previzualizarea), „gol” (fără dicționar — doar ecranul). */
export function dictionarCaz(E, T, fel) {
  if (fel === 'gol') return new E.Dictionar()
  if (fel === 'fara_localitati') return E.Dictionar.dinRaspuns({ ...T.dictionar, localitati: [] })
  return E.Dictionar.dinRaspuns(T.dictionar)
}

/** Toate cazurile → lista eșecurilor [{caz, ce, asteptat, primit}] (goală = totul trece). `E` = modulul motorului. */
export function ruleazaCazuri(E, brut) {
  const T = inlocuiesteInvizibile(brut)
  const esecuri = []
  const verifica = (caz, ce, asteptat, primit) => {
    if (canonic(asteptat) !== canonic(primit)) esecuri.push({ caz, ce, asteptat, primit })
  }
  for (const c of [...T.contract, ...T.cazuri]) {
    const nume = (c.rand ? `[${c.rand}] ` : '') + c.nume
    const m = new E.Mascare(dictionarCaz(E, T, c.dictionar))
    if (c.invata) m.invata(...c.texte)
    const mascate = c.texte.map(t => m.mascheaza(t, false))
    verifica(nume, 'mascate', c.mascate, mascate)
    if (c.contoare) verifica(nume, 'contoare', c.contoare, m.contoare())
    if ('inlocuiri' in c) verifica(nume, 'inlocuiri', c.inlocuiri, m.inlocuiri)
    mascate.forEach((x, i) => {
      verifica(nume, 'dus-întors', c.texte[i], m.demascheaza(x))
      verifica(nume, 'dus-întors la publicare', { afisat: c.texte[i], motiv: null }, m.demascheazaSigur(x))
      verifica(nume, 'idempotent', x, m.mascheaza(x, true))
    })
    for (const d of c.dupa || []) verifica(nume, 'dupa', d.mascat, m.mascheaza(d.text, true))
    for (const d of c.demascare_sigura || []) verifica(nume, `demascare_sigura ${JSON.stringify(d.text)}`, { afisat: d.afisat ?? null, motiv: d.motiv }, m.demascheazaSigur(d.text))
  }
  for (const s of T.asemanatoare.da) verifica('asemanatoare', s, true, E.eAsemanator(s))
  for (const s of T.asemanatoare.nu) verifica('asemanatoare', s, false, E.eAsemanator(s))
  for (const k of T.larg.cazuri) verifica('larg', JSON.stringify(k.text), k.spatii, E.larg(k.text))
  const a = T.aruncate
  const d = E.Dictionar.dinRaspuns({ persoane: a.persoane, firme: a.firme, cui: [], localitati: a.localitati })
  verifica('aruncate', 'statistici', a.statistici, d.statistici())
  verifica('aruncate', 'mascat', a.mascat, new E.Mascare(d).mascheaza(a.text, false))
  const R = T.regula_b
  verifica('regula_b', 'textul Incert', R.incert_regula_b, E.INCERT_REGULA_B)
  for (const [intrare, forma] of R.forme) verifica('regula_b forme', intrare, forma, E.formaCitat(intrare))
  for (const p of R.paragrafe) verifica('regula_b paragrafe', p.sursa, p.paragrafe, E.paragrafeSursa(R.surse.find(s => s.id === p.sursa)).map(x => [x.text, x.motiv]))
  for (const c of R.cazuri) {
    const r = E.aplicaRegulaB(c.text, R.surse)
    const prima = c.prima_linie ?? (c.motiv === 'fara_citat' ? R.incert_regula_b : c.text.split('\n')[0])
    verifica(`regula_b ${c.nume}`, 'motiv / tip', { motiv: c.motiv, tip: c.tip }, { motiv: r.motiv, tip: r.tip })
    verifica(`regula_b ${c.nume}`, 'prima linie', prima, r.text.split('\n')[0])
    verifica(`regula_b ${c.nume}`, 'restul neschimbat', c.text.split('\n').slice(1), r.text.split('\n').slice(1))
    verifica(`regula_b ${c.nume}`, 'cere_citat', c.cere_citat, E.cereCitat(c.text, R.surse))
  }
  return esecuri
}

/** Câte verificări de contract are fiecare rând (pentru „fiecare rând are cazuri”). */
export const randuriContract = brut => [...new Set(brut.contract.map(c => c.rand))].sort()
