// ═══════════════════════════════════════════════════════════════════════════
// executieContractRepere.js — logica (fără React) a rubricii Execuție → proiect → „📜 Contract” (cererea lui Răzvan, 09.11.2026).
// Tabelul: executie_contract_repere (migrarea 20261203a). Secțiunile, stările și puterile de aici sunt ACELEAȘI ca listele albe din CHECK-urile
// migrării (testul de paritate citește blocurile SECTIUNI / STARI / PUTERI din fișierul SQL). Scrierea trece DOAR prin RPC-ul
// fn_executie_contract_salveaza; aici se construiește payload-ul (lista albă a câmpurilor pe secțiune) și se validează înainte de trimitere,
// cu aceleași limite ca în BD (BD rămâne poarta).
// ═══════════════════════════════════════════════════════════════════════════

export const SECTIUNI = ['clauza', 'cale', 'termen', 'eveniment', 'sursa']          // ordinea din SQL
export const STARI = ['de_notificat', 'notificat', 'in_curs', 'asteapta_raspuns', 'decazut', 'inchis', 'risc', 'viitor']
export const PUTERI = ['puternica', 'medie', 'slaba', 'nula']

export const SECTIUNI_UI = [
  { key: 'eveniment', label: 'Registrul evenimentelor', scurt: 'Evenimente', icon: '📅' },
  { key: 'cale',      label: 'Căi de prelungire',       scurt: 'Prelungire', icon: '⏩' },
  { key: 'termen',    label: 'Termene de notificare',   scurt: 'Termene',    icon: '⏱️' },
  { key: 'clauza',    label: 'Clauze principale',       scurt: 'Clauze',     icon: '📜' },
  { key: 'sursa',     label: 'Surse',                   scurt: 'Surse',      icon: '📁' },
]
export const PREFIX_COD = { clauza: 'A', cale: 'B', termen: 'T', eveniment: 'E', sursa: 'S' }

export const STARE_INFO = {
  de_notificat:     { label: 'de notificat',       ton: 'rosu',  ordine: 1 },
  in_curs:          { label: 'în curs',            ton: 'galben', ordine: 0 },
  notificat:        { label: 'notificat',          ton: 'albastru', ordine: 2 },
  asteapta_raspuns: { label: 'așteaptă răspuns',   ton: 'albastru', ordine: 3 },
  risc:             { label: 'risc',               ton: 'portocaliu', ordine: 4 },
  viitor:           { label: 'viitor',             ton: 'gri',   ordine: 5 },
  decazut:          { label: 'decăzut',            ton: 'gri',   ordine: 6 },
  inchis:           { label: 'închis',             ton: 'gri',   ordine: 7 },
}
export const PUTERE_INFO = {
  puternica: { label: 'puternică', ton: 'verde' },
  medie:     { label: 'medie',     ton: 'galben' },
  slaba:     { label: 'slabă',     ton: 'portocaliu' },
  nula:      { label: 'nulă',      ton: 'gri' },
}
export const STARI_DESCHISE = ['de_notificat', 'in_curs', 'notificat', 'asteapta_raspuns', 'risc']

// câmpurile text cu limita lor (aceleași ca în CHECK-urile din 20261203a)
export const LIMITE = {
  titlu: 300, clauze: 600, continut: 6000, citat: 3000, conditie: 4000, dovezi: 4000, dovezi_lipsa: 4000,
  termen_text: 1500, efect: 1500, notificare: 1500, raspuns: 1500, termen_ce: 2000, sursa: 4000,
}
// câmpurile care există doar la evenimente (CHECK-ul executie_contract_repere_eveniment)
export const DOAR_EVENIMENT = ['data_eveniment', 'notificare', 'raspuns', 'stare', 'termen_urmator', 'termen_ce', 'putere', 'dovezi_lipsa']

// câmpurile afișate / editabile pe secțiune, cu eticheta lor (ordinea = ordinea din fișă)
export const CAMPURI = {
  clauza: [['clauze', 'Clauza'], ['continut', 'Ce spune'], ['citat', 'Text esențial'], ['sursa', 'Sursa']],
  cale: [['clauze', 'Clauze'], ['conditie', 'Condiția'], ['dovezi', 'Dovezi cerute'], ['termen_text', 'Notificare (termen)'], ['efect', 'Ce dă'],
         ['continut', 'Pe acest proiect'], ['sursa', 'Sursa']],
  termen: [['clauze', 'Clauza'], ['termen_text', 'Termenul'], ['continut', 'Ce înseamnă'], ['sursa', 'Sursa']],
  eveniment: [['data_eveniment', 'Data evenimentului'], ['clauze', 'Clauze'], ['continut', 'Ce s-a întâmplat'], ['notificare', 'Notificat? (nr. / dată)'],
              ['raspuns', 'Răspunsul beneficiarului'], ['stare', 'Stare'], ['termen_urmator', 'Următorul termen'], ['termen_ce', 'Ce trebuie făcut'],
              ['dovezi', 'Dovezi existente'], ['dovezi_lipsa', 'Dovezi lipsă'], ['putere', 'Putere'], ['efect', 'Ce poate aduce'], ['sursa', 'Sursa']],
  sursa: [['continut', 'Ce conține'], ['sursa', 'Unde se află']],
}
export const CAMPURI_DATA = ['data_eveniment', 'termen_urmator']

export const COLOANE = 'id, proiect_id, sectiune, cod, ordine, titlu, clauze, continut, citat, conditie, dovezi, dovezi_lipsa, termen_text, efect, ' +
  'data_eveniment, notificare, raspuns, stare, termen_urmator, termen_ce, putere, sursa, activ, versiune, modificat_la'

const RE_DATA = /^(\d{4})-(\d{2})-(\d{2})$/
const RE_COD = /^[A-Z]{1,3}[0-9]{1,4}$/
const neviu = v => typeof v === 'string' && /[^\s]/.test(v)

// zi calendaristică 'AAAA-LL-ZZ' -> număr de zile (UTC, fără ore; L17: nu new Date('AAAA-LL-ZZ'))
export function ziNr(s) {
  const m = typeof s === 'string' ? RE_DATA.exec(s) : null
  if (!m) return null
  const y = Number(m[1]), l = Number(m[2]), z = Number(m[3])
  const t = Date.UTC(y, l - 1, z)
  const d = new Date(t)
  if (d.getUTCFullYear() !== y || d.getUTCMonth() !== l - 1 || d.getUTCDate() !== z) return null
  return Math.round(t / 86400000)
}
export const fmtZi = s => (s && RE_DATA.test(s) ? s.split('-').reverse().join('.') : '—')

// urgența unui termen față de „azi” (ambele 'AAAA-LL-ZZ', azi în Europe/Bucharest calculat de apelant)
// nivel: depasit (< azi) / azi / urgent (≤ 7 zile) / curand (≤ 30) / ok / null (fără termen sau dată invalidă)
export function urgenta(termen, azi) {
  const t = ziNr(termen), a = ziNr(azi)
  if (t == null || a == null) return { zile: null, nivel: null, text: '' }
  const zile = t - a
  if (zile < 0) return { zile, nivel: 'depasit', text: `depășit cu ${-zile} ${-zile === 1 ? 'zi' : 'zile'}` }
  if (zile === 0) return { zile, nivel: 'azi', text: 'AZI' }
  if (zile <= 7) return { zile, nivel: 'urgent', text: `în ${zile} ${zile === 1 ? 'zi' : 'zile'}` }
  if (zile <= 30) return { zile, nivel: 'curand', text: `în ${zile} zile` }
  return { zile, nivel: 'ok', text: `în ${zile} zile` }
}

const cmpCod = (a, b) => {
  const na = Number(String(a.cod || '').replace(/^[A-Z]+/, '')), nb = Number(String(b.cod || '').replace(/^[A-Z]+/, ''))
  return (String(a.cod || '').replace(/[0-9]+$/, '')).localeCompare(String(b.cod || '').replace(/[0-9]+$/, '')) || (na - nb) || (a.id - b.id)
}

// ordinea în listă: evenimentele după stare (deschise întâi), apoi termenul următor (cele fără termen la urmă), apoi cod;
// celelalte secțiuni după „ordine”, apoi cod
export function sorteaza(randuri, sectiune) {
  const r = [...randuri]
  if (sectiune === 'eveniment') {
    return r.sort((a, b) => ((STARE_INFO[a.stare]?.ordine ?? 9) - (STARE_INFO[b.stare]?.ordine ?? 9))
      || ((ziNr(a.termen_urmator) ?? Infinity) - (ziNr(b.termen_urmator) ?? Infinity))
      || cmpCod(a, b))
  }
  return r.sort((a, b) => ((a.ordine ?? 0) - (b.ordine ?? 0)) || cmpCod(a, b))
}

// căutare fără diacritice pe titlu, cod, clauze și conținut; arhivatele doar la cerere
const fara = s => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
export function filtreaza(randuri, { sectiune, text = '', arhivate = false } = {}) {
  const q = fara(text).trim()
  return randuri.filter(x => (!sectiune || x.sectiune === sectiune) && (arhivate || x.activ !== false)
    && (!q || [x.cod, x.titlu, x.clauze, x.continut, x.termen_ce, x.notificare].some(v => fara(v).includes(q))))
}

// rezumatul de sus: evenimentele active pe stări + următoarele termene deschise (inclusiv cele depășite, ca să nu dispară)
export function rezumat(randuri, azi, n = 4) {
  const ev = randuri.filter(x => x.sectiune === 'eveniment' && x.activ !== false)
  const peStari = Object.fromEntries(STARI.map(s => [s, 0]))
  for (const x of ev) if (x.stare in peStari) peStari[x.stare] += 1
  const urmatoare = ev.filter(x => STARI_DESCHISE.includes(x.stare) && ziNr(x.termen_urmator) != null)
    .sort((a, b) => (ziNr(a.termen_urmator) - ziNr(b.termen_urmator)) || cmpCod(a, b))
    .slice(0, n)
    .map(x => ({ id: x.id, cod: x.cod, titlu: x.titlu, termen: x.termen_urmator, ...urgenta(x.termen_urmator, azi) }))
  return { total: ev.length, peStari, urmatoare }
}

// codul următor liber pe secțiune (A01, B07, E12…); doar o propunere, BD verifică unicitatea
export function codUrmator(randuri, sectiune) {
  const p = PREFIX_COD[sectiune]
  const max = randuri.filter(x => x.sectiune === sectiune && new RegExp(`^${p}[0-9]+$`).test(x.cod || ''))
    .reduce((m, x) => Math.max(m, Number(x.cod.slice(p.length))), 0)
  return `${p}${String(max + 1).padStart(2, '0')}`
}

// formularul gol / pornit dintr-un rând existent (valorile sunt mereu șiruri, ca în inputuri)
export function formular(sectiune, rand = null) {
  const f = { sectiune, cod: rand?.cod || '', titlu: rand?.titlu || '', ordine: rand?.ordine != null ? String(rand.ordine) : '0', activ: rand ? rand.activ !== false : true }
  for (const [c] of CAMPURI[sectiune]) f[c] = rand?.[c] != null ? String(rand[c]) : ''
  if (sectiune === 'eveniment' && !f.stare) f.stare = 'de_notificat'
  return f
}

// validarea, cu aceleași reguli ca CHECK-urile (mesajele sunt pentru utilizator)
export function valideaza(f, { nou }) {
  const e = {}
  if (!SECTIUNI.includes(f.sectiune)) e.sectiune = 'Secțiune necunoscută.'
  if (nou && !RE_COD.test(f.cod || '')) e.cod = 'Codul: 1–3 litere mari urmate de 1–4 cifre (ex. E12).'
  if (!neviu(f.titlu)) e.titlu = 'Titlul e obligatoriu.'
  if (!/^[0-9]{1,5}$/.test(String(f.ordine ?? '0').trim() || '0')) e.ordine = 'Ordinea: număr întreg între 0 și 99999.'
  for (const [c, lim] of Object.entries(LIMITE)) {
    const v = c === 'titlu' ? f.titlu : f[c]
    if (typeof v === 'string' && v.trim().length > lim) e[c] = `Cel mult ${lim} caractere (acum ${v.trim().length}).`
  }
  for (const c of CAMPURI_DATA) if (f[c] && ziNr(f[c]) == null) e[c] = 'Dată invalidă.'
  if (f.sectiune === 'eveniment') {
    if (!STARI.includes(f.stare)) e.stare = 'Alege starea.'
    if (f.putere && !PUTERI.includes(f.putere)) e.putere = 'Putere necunoscută.'
  }
  return { ok: Object.keys(e).length === 0, erori: e }
}

// payload-ul pentru RPC: DOAR câmpurile secțiunii (lista albă); text gol -> null; la rând nou și sectiune + cod
export function payload(f, { nou }) {
  const p = {}
  if (nou) { p.sectiune = f.sectiune; p.cod = String(f.cod || '').trim() }
  p.titlu = String(f.titlu || '').trim()
  p.ordine = Number(String(f.ordine ?? '0').trim() || '0')
  p.activ = f.activ !== false
  for (const [c] of CAMPURI[f.sectiune]) {
    const v = typeof f[c] === 'string' ? f[c].trim() : f[c]
    p[c] = v === '' || v == null ? null : v
  }
  return p
}

// amprenta locală a unei intenții de salvare (aceeași intenție = aceeași cheie la reîncercare, L04/L05)
export const amprenta = (proiectId, id, versiune, p) => JSON.stringify([proiectId, id ?? null, versiune ?? null, p])

// rândul întors de RPC înlocuiește rândul din listă doar dacă e mai nou (o citire veche nu suprascrie o salvare)
export function aplicaRand(lista, rand) {
  if (!rand || rand.id == null) return lista
  const i = lista.findIndex(x => x.id === rand.id)
  if (i < 0) return [...lista, rand]
  if ((lista[i].versiune ?? 0) > (rand.versiune ?? 0)) return lista
  const n = [...lista]; n[i] = rand; return n
}
export function imbinaLista(citite, curente) {
  const dupaId = new Map(curente.map(x => [x.id, x]))
  return citite.map(x => {
    const c = dupaId.get(x.id)
    return c && (c.versiune ?? 0) > (x.versiune ?? 0) ? c : x
  })
}

// mesajul pentru o eroare de la RPC (L18: eroarea nu e „gol”)
export function mesajEroare(err) {
  const cod = err?.code || ''
  const m = String(err?.message || err || 'eroare necunoscută')
  if (cod === '42501') return 'Nu ai drept de scriere pe fișa contractului (doar owner sau administrator Execuție).'
  if (cod === '23505') return 'Codul există deja în această secțiune.'
  if (cod === '23514') return 'Datele nu respectă regulile fișei: ' + m
  return m
}
// erori „ambigue” (rețea / timeout / 5xx): rezultatul e NECUNOSCUT, nu eșec (L05)
export const eAmbigua = err => !err?.code || /^(5|08|57)/.test(String(err.code)) || /fetch|network|timeout/i.test(String(err?.message || ''))
