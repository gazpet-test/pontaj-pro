import { describe, it, expect } from 'vitest'
import { parseAst } from 'vite'
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, copyFileSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import * as E from './intrebariMascare.js'
import { ruleazaCazuri, randuriContract, inlocuiesteInvizibile, dictionarCaz } from '../worker/intrebari-tehnice/motor_cazuri.mjs'
import { trateaza, creeazaSesiune, OPERATII } from '../worker/intrebari-tehnice/motor_protocol.mjs'
import { manifest, FISIERE as FISIERE_GENERATOR, INTRARE } from '../scripts/intrebari/manifest_motor.mjs'
import { NUME_MAX_LISTA as NUME_MAX_EDGE } from '../supabase/functions/intrebari-tehnice-worker/logic.js'
import { curataRaspuns } from './intrebariSurse.js'

// Motorul unic (r4, PR #1086): TOATE regulile într-un singur modul. Același set de cazuri (teste_motor.json) rulează aici, prin
// procesul Node real (test_motor.py) și în browser (worker/intrebari-tehnice/motor_browser.html). Date INVENTATE.
const T = JSON.parse(readFileSync('worker/intrebari-tehnice/teste_motor.json', 'utf8'))
const RAD = resolve('.')
const CLI = join(RAD, 'worker/intrebari-tehnice/motor_cli.mjs')
const DICT = E.Dictionar.dinRaspuns(inlocuiesteInvizibile(T.dictionar))

describe('motorul unic — cazurile comune (contractul de acoperire, regresiile r2 / r3, regula B)', () => {
  it('toate cazurile trec', () => {
    const esecuri = ruleazaCazuri(E, T)
    expect(esecuri, JSON.stringify(esecuri, null, 1)).toEqual([])
  })
  it('fiecare rând al contractului are cazuri', () => {
    expect(randuriContract(T)).toEqual(['combinate', 'cratima', 'diacritice', 'exceptii', 'flexiuni', 'forme_juridice', 'invizibile', 'majuscule',
      'ordine_si_propagare', 'separatoare'])
  })
  it('O SINGURĂ normalizare: caracterele numite în contract se scot la recunoaștere', () => {
    for (const c of [0x34f, 0xfe0f, 0x200b, 0xad, 0xfeff, 0xfe00, 0xfe0e, 0xe0100, 0xe01ef, 0x301, 0x326, 0x327, 0x200e])
      expect(E.curata('a' + String.fromCodePoint(c) + 'b').s, c.toString(16)).toBe('ab')
    expect(E.norm('ȘERBAN')).toBe('serban')
    expect(E.norm('Ş' + 'erban')).toBe('serban')
    expect(E.curata('fara nimic de scos').idx).toBe(null)                                // ASCII: textul e chiar reprezentarea
    // r6: aceeași funcție dă reprezentarea de recunoaștere (descompunerea de compatibilitate) și forma de comparare a numelor
    const r = E.curata('ＶａｒｎｉｔｅｃＳ．Ｒ．Ｌ． și ﬁr')
    expect(r.s).toBe('VarnitecS.R.L. si fir')
    expect([r.idx[15], r.sf[15], r.idx[18], r.sf[18], r.idx[19], r.sf[19]]).toEqual([15, 16, 18, 19, 18, 19])  // „ș” → „s”; „ﬁ” → 2 unități
    for (const x of ['ＶＬĂＤＥＳＣＵ', 'Vlădescu', 'İon', 'ﬁr', 'Șerban', 'Ｓ．Ｃ．']) expect(E.norm(x), x).toBe(E.curata(E.curata(x).s.toLowerCase()).s)
  })
  it('previzualizarea și workerul: același obiect Mascare (o etichetă dată în titlu e stabilă în speță)', () => {
    const p = E.previzualizare({ titlu: 'Mare a cerut avizul', intrebare: 'Cine semnează?', context: 'Ion Mare, diriginte' }, DICT)
    expect(p.titlu).toBe('[PERSOANA_1] a cerut avizul')
    // r7 (B3): „Mare” e în DOUĂ nume din dicționarul de test (MARE VASILE, MARE ION) → ascuns, dar entitate ambiguă proprie
    expect(p.context).toBe('[PERSOANA_2], diriginte')
    const q = E.previzualizare({ titlu: 'Ion a cerut avizul', intrebare: 'Cine semnează?', context: 'Ion Mare, diriginte' }, DICT)
    expect([q.titlu, q.context]).toEqual(['[PERSOANA_1] a cerut avizul', '[PERSOANA_1_F2], diriginte'])   // „Ion”: un singur nume (B2)
  })
  it('regula B după curățarea răspunsului: un verdict ferm fără citat nu poate rămâne Da', () => {
    const s = [{ id: 'C1', titlu: 'PT C9', extras: 'Responsabilul tehnic cu sudura este atestat de ISCIR.', inceput_sigur: true, sfarsit_sigur: true }]
    const [curat] = curataRaspuns('Da — RTS e atestat de ISCIR [C1].', s)
    expect(curat.startsWith('Da')).toBe(true)
    expect(E.aplicaRegulaB(curat, s).text.startsWith(E.INCERT_REGULA_B)).toBe(true)
  })
})

// ── r6 (review r5 P1): O SINGURĂ reprezentare a textului pentru TOATE etapele de recunoaștere ──
// Inventarul ÎNCHIS al funcțiilor motorului care aplică o expresie regulată (literal, `new RegExp`, o constantă-expresie, `toate` /
// `potriveste`), fiecare cu reprezentarea pe care lucrează. O funcție nouă care aplică o expresie pică testul până e clasificată aici.
const REPREZENTARE = 'reprezentarea de recunoaștere (curata): textul vine din detecteaza'
const LISTE = 'intrările listelor (dicționar, nemascate.json, cuvinte_comune.json), trecute prin curata / norm'
const ETICHETE = 'EXCEPȚIE: etichetele emise de motor, căutate EXACT în textul modelului (o etichetă scrisă altfel nu e etichetă → refuz)'
const REGULA_B = 'EXCEPȚIE: regula B — structura surselor și a răspunsului (paragrafe, marcaje, citate), nu recunoașterea numelor (închisă în r5)'
const INVENTAR_RECUNOASTERE = {
  'curata': 'normalizarea însăși (construiește reprezentarea, caracter cu caracter)',
  'inapoi': 'EXCEPȚIE: harta înapoi spre original — semnele de combinare de după un interval găsit (nu recunoaște nimic)',
  'asemanatoare': `${REPREZENTARE}; în demascheazaSigur: ${ETICHETE}`,
  'eAsemanator': 'EXCEPȚIE: predicat folosit doar de teste (motor_cazuri.mjs), pe o etichetă întreagă',
  'larg': `${REPREZENTARE} (își face singură curata, apoi scoate spațiile albe); în demascheazaSigur: ${ETICHETE}`,
  'doarCifre': REPREZENTARE, 'majuscula': REPREZENTARE, 'areMajuscula': REPREZENTARE, 'titluCaz': REPREZENTARE, 'cifra': REPREZENTARE,
  'parti': REPREZENTARE,
  'setDin': 'EXCEPȚIE: listele scurte scrise în cod (despărțirea pe spații)', '(modul)': LISTE, 'incarcaComune': LISTE,
  'tokeniFirmaLista': LISTE, 'cheieEntitate': LISTE, 'Dictionar.constructor': LISTE, 'Dictionar.firmaComuna': LISTE,
  'Dictionar.distinctivFirma': LISTE,
  'Mascare.detecteaza': REPREZENTARE, 'Mascare.cuiLista': REPREZENTARE, 'Mascare.variante': REPREZENTARE,
  'Mascare.potrivireFirma': REPREZENTARE, 'Mascare.prefixSC': REPREZENTARE, 'Mascare.firmeComponente': REPREZENTARE,
  'Mascare.localitatiMarcate': REPREZENTARE, 'Mascare.publice': REPREZENTARE, 'Mascare.firmeForma': REPREZENTARE,
  'Mascare.persoane': REPREZENTARE, 'Mascare.persoane.vecinPereche': REPREZENTARE, 'Mascare.delimiteaza.spatiu': REPREZENTARE,
  'Mascare.delimiteaza.sep': REPREZENTARE, 'Mascare.invataDin': 'cheile normalizate ale numelor deja găsite (norm)',
  'marcajCompus': 'regula B (r7): numerotarea compusă, pe reprezentarea comună (curata), cu majusculele păstrate — apelată cu curata(text).s',
  'Mascare.demascheaza': ETICHETE, 'Mascare.demascheazaSigur': ETICHETE, 'Mascare.emiseIn': ETICHETE, 'bucatiMascate': ETICHETE,
  'areDinLista': REGULA_B, 'inClasa': REGULA_B, 'ultimulSemn': REGULA_B, 'formaCitat': REGULA_B, 'paragrafeText': REGULA_B,
  'motivParagraf': REGULA_B, 'verdict': REGULA_B, 'tipVerdict': REGULA_B, 'marcaje': REGULA_B, 'citatSustinut': REGULA_B,
  'areCitat': REGULA_B, 'aplicaRegulaB': REGULA_B,
  'ascundeSelectia': 'EXCEPȚIE: ecranul — selecția omului (spații, rânduri noi), nu recunoaștere',
}
/** {funcție → numărul aplicărilor de expresii regulate} și {metodă Mascare → apelanții ei} pe arborele sintactic al motorului. */
function analizaMotor(sursa) {
  const ast = parseAst(sursa)
  const eRegex = n => n && ((n.type === 'Literal' && n.regex) || (n.type === 'NewExpression' && n.callee.name === 'RegExp'))
  const ids = new Set()
  for (const st of ast.body) {
    const d = st.type === 'ExportNamedDeclaration' ? st.declaration : st
    if (d?.type === 'VariableDeclaration') for (const v of d.declarations) if (eRegex(v.init)) ids.add(v.id.name)
  }
  const re = x => eRegex(x) || (x?.type === 'Identifier' && ids.has(x.name)) || (x?.type === 'CallExpression' && x.callee.name === 'eticheta')
  const aplicari = new Map(), apelanti = new Map(), detecteaza = []
  const viz = (n, fn, cls) => {
    if (!n || typeof n.type !== 'string') return
    if (n.type === 'ClassDeclaration') cls = n.id.name
    if (n.type === 'FunctionDeclaration') fn = n.id.name
    if (n.type === 'MethodDefinition') fn = `${cls}.${n.key.name}`
    if (n.type === 'VariableDeclarator' && /FunctionExpression$/.test(n.init?.type || '')) fn = fn === '(modul)' ? n.id.name : `${fn}.${n.id.name}`
    if (n.type === 'CallExpression') {
      const c = n.callee
      if ((c.type === 'MemberExpression' && re(c.object)) || n.arguments.some(re) || (c.type === 'Identifier' && ['toate', 'potriveste'].includes(c.name)))
        aplicari.set(fn, (aplicari.get(fn) || 0) + 1)
      if (c.type === 'MemberExpression' && c.object.type === 'ThisExpression' && cls === 'Mascare') {
        const k = `Mascare.${c.property.name}`
        if (!apelanti.has(k)) apelanti.set(k, new Set())
        apelanti.get(k).add(fn.split('.').slice(0, 2).join('.'))
        if (c.property.name === 'detecteaza') detecteaza.push(sursa.slice(n.arguments[0].start, n.arguments[0].end))
      }
    }
    for (const [k, v] of Object.entries(n)) {
      if (k === 'parent') continue
      if (Array.isArray(v)) v.forEach(x => viz(x, fn, cls)); else if (v && typeof v === 'object' && typeof v.type === 'string') viz(v, fn, cls)
    }
  }
  viz(ast, '(modul)', null)
  return { aplicari, apelanti, detecteaza }
}
const latime = s => [...s].map(c => { const x = c.codePointAt(0); return x > 0x20 && x < 0x7f ? String.fromCodePoint(x + 0xfee0) : c }).join('')

describe('r6 (review r5 P1): o singură reprezentare a textului pentru toate etapele de recunoaștere', () => {
  const SURSA = readFileSync('src/intrebariMascare.js', 'utf8')
  it('inventarul ÎNCHIS: fiecare funcție care aplică o expresie regulată e clasificată (reprezentare / liste / excepție cu motiv)', () => {
    const { aplicari } = analizaMotor(SURSA)
    expect([...aplicari.keys()].sort()).toEqual(Object.keys(INVENTAR_RECUNOASTERE).sort())
  })
  it('etapele de recunoaștere sunt atinse DOAR din detecteaza, iar detecteaza primește DOAR reprezentarea (curata)', () => {
    const { apelanti, detecteaza } = analizaMotor(SURSA)
    // etapele lui detecteaza (și cele care nu aplică direct o expresie, dar dau mai departe textul)
    const etape = ['detecteaza', 'cuiLista', 'variante', 'potrivireFirma', 'prefixSC', 'firmeDictionar', 'firmeComponente', 'firmeFlexionate',
      'localitatiMarcate', 'publice', 'firmeForma', 'componenteToken', 'persoane', 'delimiteaza', 'emitePersoane', 'internaToken', 'invataDin',
      'propaga'].map(x => `Mascare.${x}`)
    for (const k of Object.keys(INVENTAR_RECUNOASTERE).filter(x => x.startsWith('Mascare.') && INVENTAR_RECUNOASTERE[x] === REPREZENTARE))
      expect(etape, k).toContain(k.split('.').slice(0, 2).join('.'))
    for (const k of etape.filter(x => x !== 'Mascare.detecteaza')) {
      expect(apelanti.has(k), `${k} nu e apelată`).toBe(true)
      for (const a of apelanti.get(k)) expect(etape, `${k} e apelată din ${a}`).toContain(a)
    }
    expect([...apelanti.get('Mascare.detecteaza')].sort()).toEqual(['Mascare.invata', 'Mascare.mascheaza'])
    expect(detecteaza.sort()).toEqual(['curata(t).s', 'r.s'])
    expect(SURSA.replace(/\r\n/g, '\n')).toContain('    const t = String(text ?? \'\')\n    const r = curata(t)\n')
  })
  it('contraexemplul inventarului: o etapă nouă care caută pe textul brut (în mascheaza) e o funcție neclasificată sau un apel în afara lui detecteaza', () => {
    const lf = SURSA.replace(/\r\n/g, '\n'), ancora = "    let out = '', poz = 0\n"
    expect(lf).toContain(ancora)
    expect(analizaMotor(lf).aplicari.has('Mascare.mascheaza')).toBe(false)
    expect(analizaMotor(lf.replace(ancora, ancora + '    FORMA_LIPITA.exec(t)\n')).aplicari.has('Mascare.mascheaza')).toBe(true)
  })
  it('invarianța la reprezentare (clasa, nu cazul): orice caz scris de mână, rescris cu litere late sau descompus (NFD), dă ACEEAȘI mascare', () => {
    const T2 = inlocuiesteInvizibile(T)
    let n = 0
    for (const c of [...T2.contract, ...T2.cazuri]) {
      const dict = dictionarCaz(E, T2, c.dictionar)
      const ruleaza = f => {
        const m = new E.Mascare(dict)
        if (c.invata) m.invata(...c.texte.map(f))
        return c.texte.map(x => { const o = m.mascheaza(f(x), false); expect(m.demascheaza(o), c.nume).toBe(f(x)); return o })
      }
      const baza = ruleaza(x => x)
      // indicele de formă (_F2…) numără scrierile ORIGINALE diferite: după NFD două scrieri pot deveni una → se compară entitatea
      const fara = o => o.replace(/_F[0-9]+\]/g, ']')
      for (const f of [latime, x => x.normalize('NFD')]) {
        const asteptat = baza.map(o => fara(E.bucatiMascate(o).map(b => b.t === 'eticheta' ? b.v : f(b.v)).join('')))
        expect(ruleaza(f).map(fara), c.nume).toEqual(asteptat)
        n++
      }
    }
    expect(n).toBeGreaterThan(100)
  })
})

// ── r7 (review r6 P2-1, A1): inventarul ÎNCHIS al locurilor care construiesc, EXTIND sau REUNESC un interval / o entitate de persoană ──
// Pe arborele sintactic al motorului. Regulile:
//   (a) literalul 'PERSOANA' apare DOAR în funcțiile din INVENTAR_PERSOANE (o cale nouă de persoane pică până e clasificată);
//   (b) orice apel adauga(…) are categoria SCRISĂ (literal sau null) — o categorie calculată ar ocoli (a); 'PERSOANA' doar în emitePersoane;
//   (c) emitePersoane e apelată DOAR cu rezultatul lui this.delimiteaza(…), iar delimiteaza DOAR din persoane / propaga;
//   (d) emitePersoane dă mai departe intervalul grupului NESCHIMBAT (g.s, g.e) — fără extindere;
//   (e) out / luate (rezultatul lui detecteaza) se scriu DOAR în adauga, care refuză suprapunerile;
//   (f) entitate() nu unește nimic: singurele apeluri sunt căutarea după cheie și adăugarea unei entități noi;
//   (g) identitatea (Dictionar.identitate) e calculată DOAR în delimiteaza.
const INVENTAR_PERSOANE = {          // (a) funcțiile în care apare literalul 'PERSOANA'
  '(modul)': 'lista categoriilor (CATEGORII) — fără intervale',
  'Mascare.emitePersoane': 'SINGURUL apel adauga(…, \'PERSOANA\', …): grupurile lui delimiteaza, neschimbate',
  'Mascare.entitate': 'identitate → entitate: egalitate de cheie, fără unire (B3–B4)',
  'Mascare.invataDin': 'învață ce cuvinte se propagă — nici intervale, nici identități',
}
const INVENTAR_CAI_PERSOANE = {      // (c) / (e): cine marchează, cine delimitează, cine scrie
  'Mascare.persoane': 'lista + titlul: DOAR marcaje (componente, context = ctx, persoană necunoscută = nec), apoi delimiteaza → emitePersoane',
  'Mascare.propaga': 'propagarea: DOAR marcaje (prop = context, nec), apoi delimiteaza → emitePersoane',
  'Mascare.delimiteaza': 'O SINGURĂ delimitare: grupurile (grup = extinderea, doar aici), identitatea B1–B3, împărțirea B5',
  'Mascare.detecteaza.adauga': 'SINGURUL care scrie un interval (out / luate); refuză suprapunerile, nu extinde',
  'Mascare.mascheaza': 'EXCEPȚIE: intervalul găsit e pus înapoi pe textul original (inapoi) și tăiat la caracterul descompus deja folosit — nu adaugă cuvinte',
}
function analizaPersoane(sursa) {
  const ast = parseAst(sursa)
  const literal = new Set(), adauga = [], emite = [], delim = new Set(), scrieri = [], entitate = [], identitate = new Set()
  const viz = (n, fn, cls) => {
    if (!n || typeof n.type !== 'string') return
    if (n.type === 'ClassDeclaration') cls = n.id.name
    if (n.type === 'FunctionDeclaration') fn = n.id.name
    if (n.type === 'MethodDefinition') fn = `${cls}.${n.key.name}`
    if (n.type === 'VariableDeclarator' && /FunctionExpression$/.test(n.init?.type || '')) fn = fn === '(modul)' ? n.id.name : `${fn}.${n.id.name}`
    if (n.type === 'Literal' && n.value === 'PERSOANA') literal.add(fn)
    if (n.type === 'CallExpression') {
      const c = n.callee
      if (c.type === 'Identifier' && c.name === 'adauga') {
        const a = n.arguments[2]
        adauga.push({ fn, cat: a?.type === 'Literal' ? a.value : '(calculat)', s: sursa.slice(n.arguments[0].start, n.arguments[0].end),
          e: sursa.slice(n.arguments[1].start, n.arguments[1].end) })
      }
      if (c.type === 'MemberExpression' && c.object.type === 'ThisExpression' && c.property.name === 'emitePersoane') {
        const a = n.arguments[0]
        emite.push(a?.type === 'CallExpression' && a.callee.type === 'MemberExpression' && a.callee.object.type === 'ThisExpression'
          && a.callee.property.name === 'delimiteaza' ? fn : `${fn}: argument „${sursa.slice(a.start, a.end)}”`)
      }
      if (c.type === 'MemberExpression' && c.property.name === 'delimiteaza') delim.add(fn)
      if (c.type === 'MemberExpression' && c.property.name === 'identitate') identitate.add(fn)
      if (c.type === 'MemberExpression' && c.property.name === 'push' && c.object.type === 'Identifier' && ['out', 'luate'].includes(c.object.name)
          && fn.startsWith('Mascare.detecteaza')) scrieri.push(fn)
      if (fn === 'Mascare.entitate') entitate.push(sursa.slice(c.start, c.end))
    }
    for (const [k, v] of Object.entries(n)) {
      if (k === 'parent') continue
      if (Array.isArray(v)) v.forEach(x => viz(x, fn, cls)); else if (v && typeof v === 'object' && typeof v.type === 'string') viz(v, fn, cls)
    }
  }
  viz(ast, '(modul)', null)
  return { literal, adauga, emite, delim, scrieri, entitate, identitate }
}
function incalcariPersoane(sursa) {
  const a = analizaPersoane(sursa), out = []
  for (const f of a.literal) if (!Object.hasOwn(INVENTAR_PERSOANE, f)) out.push(`(a) 'PERSOANA' în ${f}`)
  for (const x of a.adauga) {
    if (x.cat === '(calculat)') out.push(`(b) categorie calculată în ${x.fn}`)
    if (x.cat === 'PERSOANA' && x.fn !== 'Mascare.emitePersoane') out.push(`(b) adauga PERSOANA în ${x.fn}`)
    if (x.cat === 'PERSOANA' && (x.s !== 'g.s' || x.e !== 'g.e')) out.push(`(d) interval schimbat: ${x.s}, ${x.e}`)
  }
  for (const f of a.emite) if (!['Mascare.persoane', 'Mascare.propaga'].includes(f)) out.push(`(c) emitePersoane din ${f}`)
  for (const f of a.delim) if (!['Mascare.persoane', 'Mascare.propaga'].includes(f)) out.push(`(c) delimiteaza din ${f}`)
  for (const f of a.scrieri) if (f !== 'Mascare.detecteaza.adauga') out.push(`(e) scriere în rezultat din ${f}`)
  for (const c of a.entitate) if (!['lista.find', 'lista.push'].includes(c)) out.push(`(f) entitate apelează ${c}`)
  for (const f of a.identitate) if (f !== 'Mascare.delimiteaza') out.push(`(g) identitate din ${f}`)
  return out
}

describe('r7 (review r6 P2-1, A1): o singură delimitare pentru TOATE căile care construiesc / extind / reunesc persoane', () => {
  const SURSA = readFileSync('src/intrebariMascare.js', 'utf8').replace(/\r\n/g, '\n')
  it('inventarul ÎNCHIS e respectat: (a) literalul PERSOANA, (b) categoriile scrise, (c) emitePersoane ← delimiteaza ← persoane / propaga, (d) fără extindere, (e) un singur scriitor, (f) fără unire, (g) identitatea doar în delimiteaza', () => {
    expect(incalcariPersoane(SURSA)).toEqual([])
    const a = analizaPersoane(SURSA)
    expect([...a.literal].sort()).toEqual(Object.keys(INVENTAR_PERSOANE).sort())
    expect(a.emite.sort()).toEqual(['Mascare.persoane', 'Mascare.propaga'])
    expect([...a.delim].sort()).toEqual(['Mascare.persoane', 'Mascare.propaga'])
    expect([...new Set(a.scrieri)]).toEqual(['Mascare.detecteaza.adauga'])
    expect(a.adauga.filter(x => x.cat === 'PERSOANA').length).toBe(1)
    // căile vechi (titlul care construia singur intervalul, lista cu gruparea ei, unirea după submulțime) nu mai există
    for (const x of ['persoaneTitlu', 'persoaneLista', 'subset(']) expect(SURSA, x).not.toContain(x)
  })
  it('contraexemplele inventarului sunt prinse: titlul care adaugă singur o persoană, categoria calculată, extinderea intervalului, emiterea unei liste făcute de mână, unirea în entitate()', () => {
    const titlu = '    this.emitePersoane(this.delimiteaza(t, info), adauga)\n  }\n\n  /** r7 (review r6 P2-1 / P2-2, A1'
    expect(SURSA).toContain(titlu)
    const mut = [
      SURSA.replace(titlu, "    adauga(info[0].s, info[1].e, 'PERSOANA', { id: 'x', comp: [] })\n" + titlu),                 // (a)(b)
      SURSA.replace(titlu, "    const cat = ['PER', 'SOANA'].join(''); adauga(info[0].s, info[1].e, cat, { id: 'x', comp: [] })\n" + titlu),  // (b)
      SURSA.replace("adauga(g.s, g.e, 'PERSOANA'", "adauga(g.s, g.e + 4, 'PERSOANA'"),                                            // (d)
      SURSA.replace(titlu, '    this.emitePersoane([{ s: 0, e: 9, id: \'x\', comp: [] }], adauga)\n' + titlu),                    // (c)
      SURSA.replace('    if (gasit) return gasit\n', '    if (gasit) return gasit\n    const cand = lista.filter(x => x.k.length > 0)\n'),  // (f)
      SURSA.replace(titlu, '    this.d.identitate([])\n' + titlu),                                                            // (g)
    ]
    for (const m of mut) { expect(m).not.toBe(SURSA); expect(incalcariPersoane(m).length).toBeGreaterThan(0) }
  })
})

describe('r7 (review r6 P2-2, B1–B5): identitatea persoanelor — DOAR din dicționar, stabilă la ordinea învățării', () => {
  const T2 = inlocuiesteInvizibile(T)
  it('Dictionar.identitate: B1 (exact, unic / mai multe), B2 (inclus într-un singur nume), B3 (în mai multe / în niciunul)', () => {
    const D = dictionarCaz(E, T2, 'incluse')        // 0 = ANA VLADESCU, 1 = ANA MARIA VLADESCU, 2 = ION MARE
    expect(D.identitate(['vladescu', 'ana'])).toEqual({ id: 'N:0', exact: true })          // B1, deși e inclus și în ANA MARIA VLADESCU
    expect(D.identitate(['ana', 'maria', 'vladescu'])).toEqual({ id: 'N:1', exact: true })
    expect(D.identitate(['maria'])).toEqual({ id: 'N:1', exact: false })                  // B2
    expect(D.identitate(['mare'])).toEqual({ id: 'N:2', exact: false })
    expect(D.identitate(['vladescu']).id.startsWith('A:')).toBe(true)                     // B3: în două nume
    expect(D.identitate(['ana']).id.startsWith('A:')).toBe(true)
    expect(D.identitate(['vladescu', 'mare']).id.startsWith('A:')).toBe(true)             // în niciun nume (componente din nume diferite)
    const G = dictionarCaz(E, T2, 'egalitate')       // PETRESCU OLGA și OLGA PETRESCU: aceeași mulțime, două identități
    expect(G.identitate(['olga', 'petrescu'])).toMatchObject({ exact: true })
    expect(G.identitate(['olga', 'petrescu']).id.startsWith('A:')).toBe(true)              // B1: mai multe → ambiguă
    // aceeași intrare scrisă de două ori = o singură identitate
    expect(E.Dictionar.dinRaspuns({ persoane: ['ANA VLADESCU', 'Ana Vlădescu'.toUpperCase()], firme: [], cui: [] }).identitate(['ana', 'vladescu']).id).toBe('N:0')
  })
  it('identitatea nu depinde de ordinea intrărilor din listă (aceleași clase de nume)', () => {
    const r = T2.dictionare.incluse, inv = { ...r, persoane: [...r.persoane].reverse() }
    const a = E.Dictionar.dinRaspuns(r), b = E.Dictionar.dinRaspuns(inv)
    const nume = (D, id) => id.startsWith('N:') ? [...D.nume[Number(id.slice(2))]].sort().join(' ') : id
    for (const g of [['ana', 'vladescu'], ['ana', 'maria', 'vladescu'], ['maria'], ['vladescu'], ['ana'], ['mare'], ['ion', 'mare']])
      expect(nume(b, b.identitate(g).id), g.join(' ')).toBe(nume(a, a.identitate(g).id))
  })
  it('identitățile sunt STABILE la schimbarea ordinii de învățare (aceleași clase de forme, în orice ordine a textelor)', () => {
    const D = dictionarCaz(E, T2, 'incluse')
    const texte = ['Vladescu a cerut avizul; Mare a sunat.', 'Ana Vladescu și Ana Maria Vladescu au semnat.', 'Vladescului i s-a spus; Ion Mare a plecat; Maria a venit.',
      'dl. Ana Vladescu Ion Mare a venit; dl. Popescu Mare a sunat.']
    const clase = ordine => {
      const m = new E.Mascare(D)
      m.invata(...ordine)
      const o = ordine.map(t => m.mascheaza(t, false))
      const ent = new Map()
      for (const x of o) for (const b of E.bucatiMascate(x)) if (b.t === 'eticheta') {
        const k = b.v.replace(/_F[0-9]+\]$/, ']')
        if (!ent.has(k)) ent.set(k, new Set())
        ent.get(k).add(m.demascheaza(b.v))
      }
      return [...ent.values()].map(s => [...s].sort().join(' | ')).sort()
    }
    const baza = clase(texte)
    expect(baza).toContain('Ana Vladescu')
    expect(baza).toContain('Vladescu | Vladescului')
    for (const ord of [[...texte].reverse(), [texte[2], texte[0], texte[3], texte[1]], [texte[1], texte[3], texte[0], texte[2]]]) expect(clase(ord)).toEqual(baza)
  })
})

// ── Mutanți: fiecare rând al contractului (și fiecare excludere din regula B) are o regulă care, scoasă, face cazurile să pice ──
const MUTANTI = [
  ['majuscule (firma întreagă doar cu majusculă)', '[majuscule]', 'for (let i = 0; i < simpli.length; i++) {\n      const chei = new Set(this.variante(',
    'for (let i = 0; i < simpli.length; i++) {\n      if (!/^\\p{Lu}/u.test(simpli[i][2])) continue\n      const chei = new Set(this.variante('],
  ['majuscule (r5: persoanele scrise mic nu mai sunt nume)', '[majuscule]', 'if (c && !c.mare && !c.distinct && !interna(c) && !vecinPereche(k)) fara.push(k)',
    'if (c && !c.mare) fara.push(k)'],
  ['majuscule (r5: fără componenta distinctivă de firmă singură)', '[majuscule]', 'if (!(r.context || areMajuscula(p))) continue', 'continue'],
  ['majuscule (r5: doar prima literă mare, nu „orice majusculă”)', '[majuscule]', 'if (!(r.context || areMajuscula(p))) continue',
    'if (!(r.context || majuscula(p))) continue'],
  ['diacritice (reprezentarea fără descompunere)', '[diacritice]', "for (const c of ch.normalize('NFKD')) {", 'for (const c of ch) {'],
  ['diacritice (r5: fără formele de compatibilitate — literele late)', 'r5 (F4)', "for (const c of ch.normalize('NFKD')) {", "for (const c of ch.normalize('NFD')) {"],
  // r6 (review r5 P1): recunoașterea pe textul BRUT (forma juridică, „SC”, tiparele căutate în textul nenormalizat) — cazurile r6 pică
  ['forme_juridice (r6: recunoașterea pe textul brut, nu pe reprezentare)', 'r6 (review r5 P1)', '    const r = curata(t)\n    // o etichetă emisă',
    '    const r = { s: t, idx: null, sf: null }\n    // o etichetă emisă'],
  ['forme_juridice (r6: forma juridică lipită căutată fără descompunerea de compatibilitate)', 'r6 (review r5 P1)',
    "for (const c of ch.normalize('NFKD')) {", "for (const c of ch.normalize(cp >= 0xff01 && cp <= 0xff5e ? 'NFD' : 'NFKD')) {"],
  ['separatoare', '[separatoare]', 'const SEP_FIRMA = new RegExp(`^[${SEP_CLASA}]{1,6}$`, \'u\')', 'const SEP_FIRMA = /^ +$/u'],
  ['separatoare (r5: fără „/”)', '[separatoare]', "'„”“«»‚‘’()&+/", "'„”“«»‚‘’()&+"],
  ['forme_juridice (lipite)', '[forme_juridice]', 'if (f && !(f[0] === f[0].toLowerCase()', 'if (false && !(f[0] === f[0].toLowerCase()'],
  ['forme_juridice (r5: flexiune + formă lipită)', '[forme_juridice]', 'if (!(v.n === tup[x] || (x === ultim && componentaFirma(v.n, tup[x], true) !== null))) continue',
    'if (!(v.n === tup[x] || (x === ultim && v.forma < 0 && componentaFirma(v.n, tup[x], true) !== null))) continue'],
  ['forme_juridice (r6: varianta cu flexiune câștigă în fața formei lipite care acoperă mai mult / are context)', 'găsite de matricea r6',
    'if (f > fin || (f === fin && r > rang)) { gasit = v; rang = r; fin = f }', 'if (rang < 0 || r < rang) { gasit = v; rang = r; fin = f }'],
  ['forme_juridice („SC” în față)', '[forme_juridice]', 'if (p) return { start: start - p[1].length, end, context: true }', ''],
  ['flexiuni', '[flexiuni]', 'for (const t of TERMINATII) {\n    const b = n.slice(0, -t.length)', 'for (const t of []) {\n    const b = n.slice(0, -t.length)'],
  ['cratima', '[cratima]', 'const parti = tok => tok.split(RE_CRATIMA).filter(Boolean)', 'const parti = tok => [tok]'],
  ['invizibile (doar Cf)', '[invizibile]', 'const ELIMINABIL = /[\\p{M}\\p{Cf}]/u', 'const ELIMINABIL = /[\\p{Cf}]/u'],
  ['ordine_si_propagare (fără propagare)', '[ordine_si_propagare]', '    if (!this.vazute.size) return\n', '    return\n'],
  ['ordine_si_propagare (fără pre-trecere)', '[ordine_si_propagare]', 'invata(...texte) { for (const t of texte) this.detecteaza(curata(t).s, false) }', 'invata() {}'],
  ['ordine_si_propagare (r5: fără propagarea scrisă mic)', '[ordine_si_propagare]', '(!areMajuscula(p) && !this.vazuteMici.has(c))', '!areMajuscula(p)'],
  ['exceptii (firma privată după fragmentul public)', '[exceptii]',
    '    this.firmeDictionar(t, simpli, adauga)          // 10.', '    this.publice(t, simpli, adauga); this.firmeDictionar(t, simpli, adauga) // 10.'],
  ['exceptii (firmă comună fără context)', '[exceptii]', 'if (this.d.firmaComuna(tup) && !r.context) continue', ''],
  ['exceptii (persoană comună fără context)', '[exceptii]', 'const vizibil = i === j && w.c.comun && !g.intreg && !w.ctx && !w.prop ? 1 : 0',
    'const vizibil = 0'],
  // r7 (review r6 P2-1): titlul — contextul DOAR primului grup; persoana necunoscută se oprește înaintea componentelor cunoscute
  ['r7 (A4): contextul titlului pe TOATE cuvintele ferestrei', 'r7 (A4)', 'if (k === i) w.ctx = true', 'w.ctx = true'],
  // titlul construiește singur intervalul din cel mult trei cuvinte, cunoscute sau nu (= motorul r6): „dl. Ana Vladescu Ion Mare” →
  // „dl. [PERSOANA_1] Mare” (cazul recenzentului) și „dl. Popescu Ana Vladescu” → o singură persoană
  ['r7 (A1–A3): titlul construiește singur intervalul (persoana necunoscută absoarbe și componentele cunoscute)', 'r7 (review r6 P2-1, A1–A2)',
    '        if (!w.c) {                                  // necunoscut listei', '        if (true) {                                  // necunoscut listei'],
  ['r7 (A3): idem — cazul „dl. Popescu Ana Vladescu”', 'r7 (review r6 P2-1, A3)',
    '        if (!w.c) {                                  // necunoscut listei', '        if (true) {                                  // necunoscut listei'],
  // r7 (review r6 P2-2): identitatea — B1–B5
  ['r7 (B1): fără potrivirea exactă (doar includerea)', 'r7 (B5, departajarea', 'if (ex.length) r = {', 'if (false) r = {'],
  ['r7 (B3): forma inclusă în mai multe nume se leagă de primul (ca unirea după submulțime din r6)', 'r7 (B3',
    "r = { id: sup.length === 1 ? `N:${sup[0]}` : `A:${k}`, exact: false }", "r = { id: sup.length >= 1 ? `N:${sup[0]}` : `A:${k}`, exact: false }"],
  ['r7 (B5): fără departajarea după numele exacte', 'r7 (B5', 'const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]',
    'const cmp = (a, b) => a[0] - b[0] || a[1] - b[1]'],
  ['r7 (B5): la egalitate cu identități incompatibile se alege prima împărțire (nu entitatea ambiguă)', 'r7 (B5)',
    'if ([...pe.values()].every(v => v.size === 1)) {', 'if (true) {'],
  ['r7 (B5): oprirea la primul nume complet (nu se evaluează toate împărțirile)', 'r7 (B1 + B5)',
    'if (info[k + 1].c && sep(k, k + 1) && this.d.acelasiNume([...cunoscute, ...info[k + 1].c.chei]))',
    'if (info[k + 1].c && sep(k, k + 1) && !this.d.exacte.has(cheiePers(cunoscute)) && this.d.acelasiNume([...cunoscute, ...info[k + 1].c.chei]))'],
  ['r7 (găsit de matricea r7): al doilea prenume poate repeta o componentă a aceluiași nume', 'r7 (găsit de matricea r7)',
    '(mij.c ? !mij.c.chei.some(x => cunoscute.includes(x) || info[k + 2].c.chei.includes(x)) : !COMUN.has(norm(mij.tok)))',
    '(mij.c || !COMUN.has(norm(mij.tok)))'],
  // r7 (review r6 P2-3): numerotările compuse
  ['r7 (C1): fără „litere.cifre”', 'r7 (C1)', 'const marcajCompus = s => MARCAJ_LITERA_CIFRA.test(s) ||', 'const marcajCompus = s => false ||'],
  ['r7 (C2–C5): fără „cifre.cifre”', 'r7 (C3)', '(MARCAJ_NUMEROTARE.test(s) && !CANTITATE_ZECIMALA.test(s))', 'false'],
  ['r7 (C4): excepția lărgită la orice cuvânt scris mic', 'r7 (C4)', '+ +(?:bar|m)(?![', '+ +(?:\\p{Ll}+)(?!['],
  ['r7 (C4): fără excepție (și „6.5 bar” / „0.5 m” devin marcaj — L20)', 'r7 (C4, L20)', '&& !CANTITATE_ZECIMALA.test(s)', '&& true'],
  ['r7 (C4): unitatea fără deosebire de majuscule', 'r7 (C4, unitatea', '(?![\\p{L}\\p{N}_])/u\nconst marcajCompus', '(?![\\p{L}\\p{N}_])/iu\nconst marcajCompus'],
  ['r7 (C4): fără limita de cuvânt după unitate', 'r7 (C4, limita', '+ +(?:bar|m)(?![\\p{L}\\p{N}_])/u', '+ +(?:bar|m)/u'],
  ['r7: numerotarea compusă pe textul brut (nu pe reprezentarea comună) — cifrele și punctul late', 'r7: cifrele late', 'marcajCompus(curata(text).s.replace(DESCHIDERE',
    'marcajCompus(text.replace(DESCHIDERE'],
  ['r7: numerotarea compusă pe textul brut — spațiul neîntrerupt nu mai e spațiu (pozitivul „6.5 bar” pică, L20)', 'cu spațiu neîntrerupt', 'marcajCompus(curata(text).s.replace(DESCHIDERE', 'marcajCompus(text.replace(DESCHIDERE'],
  ['exceptii (r5: cuvântul unei entități publice ar deveni componentă distinctivă)', '[exceptii]', ' && !CUVINTE_PUBLICE.has(c)', ''],
  // r6 (review r5 P2): fără delimitarea persoanelor (orice componente alăturate formează un nume) — enumerările și persoanele alăturate pică
  ['separatoare (r6: componentele unor persoane diferite se combină)', 'r6 (review r5 P2)', '  acelasiNume(chei) {\n',
    '  acelasiNume(chei) {\n    return true\n'],
  ['separatoare (virgula leagă persoane diferite)', '[separatoare]', '  acelasiNume(chei) {\n', '  acelasiNume(chei) {\n    return true\n'],
  ['eticheta fără paranteză (L20)', 'demascare_sigura', "new RegExp('\\\\[(?:PERSOANA|FIRMA", "new RegExp('(?:PERSOANA|FIRMA"],
  // regula B (r5, structurală): câte un mutant pe fiecare regulă
  ['regula B: context tăiat', 'regula_b', 'if (taiat || ', 'if (false && '],
  ['regula B: context necunoscut', 'regula_b', "if (typeof precedent !== 'string') return 'context_necunoscut'", ''],
  ['regula B: tabel', 'regula_b', "if (/[|\\t]/.test(text)) return 'tabel'", ''],
  ['regula B: element de listă (marcajul)', 'regula_b', "MARCAJ_ELEMENT.test(text.replace(DESCHIDERE, ''))", 'false'],
  ['regula B: element de listă (paragraful precedent „…:”)', 'regula_b', '/[:;]/.test(ultimulSemn(precedent))', 'false'],
  ['regula B: element de listă (se termină el însuși cu „:”)', 'regula_b', "|| /[:;]/.test(ultimulSemn(text))) return 'element_lista'", ") return 'element_lista'"],
  ['regula B: marcaj — categoria Pd', 'regula_b', '[\\\\p{Pd}${inClasa(SEMNE_LISTA)}]', '[${inClasa(SEMNE_LISTA)}]'],
  ['regula B: marcaj — plafon de lungime', 'regula_b', '[\\\\p{L}\\\\p{M}\\\\p{N}]+(?:\\\\)', '[\\\\p{L}\\\\p{M}\\\\p{N}]{1,4}(?:\\\\)'],
  ['regula B: marcaj — doar litere mici', 'regula_b', '[\\\\p{L}\\\\p{M}\\\\p{N}]+(?:\\\\)', '[\\\\p{Ll}\\\\p{M}\\\\p{N}]+(?:\\\\)'],
  // r6 (review r5 P4): „.” urmat de o CIFRĂ ar fi marcaj → „6.5 bar …” pică (L20)
  ['regula B: marcaj — punct urmat de cifră (r6)', 'regula_b r6 (review r5 P4', '[.:](?=[\\\\s\\\\p{L}]|$)', '[.:](?=[\\\\s\\\\p{L}\\\\p{N}]|$)'],
  ['regula B: marcaj — punct urmat direct de literă (r6)', 'regula_b r6: marcajul „1.”', '[.:](?=[\\\\s\\\\p{L}]|$)', '[.:](?=[\\\\s]|$)'],
  ['regula B: paragraf cu mai multe propoziții', 'regula_b', "if (GRANITA.test(text)) return 'mai_multe_propozitii'", ''],
  ['regula B: granița „;”', 'regula_b', 'const GRANITA = new RegExp(`[.!?;][', 'const GRANITA = new RegExp(`[.!?]['],
  ['regula B: granița „rând nou”', 'regula_b', "]*\\\\s|\\\\n`, 'u')", "]*\\\\s`, 'u')"],
  ['regula B: trimiteri', 'regula_b', "if (areDinLista(text, SET_TRIMITERI, TRIMITERI_EXPRESII)) return 'trimitere'", ''],
  ['regula B: excepții', 'regula_b', "if (areDinLista(text, SET_EXCEPTII, EXCEPTII_EXPRESII)) return 'exceptie'", ''],
  ['regula B: fragment', 'regula_b', "return 'fragment'", 'return null'],
  ['regula B: fără sfârșit', 'regula_b', "return 'fara_sfarsit'", 'return null'],
  ['regula B: paragrafele brute și mascate nealiniate', 'regula_b', 'const aliniat = brute.length === mascate.length', 'const aliniat = true'],
  ['regula B: comparare permisivă (semne, diacritice)', 'regula_b', ".trim().replace(/[.;:!?]+$/, '')",
    ".trim().replace(/[.;:!?]+$/, '').normalize('NFD').replace(/\\p{M}/gu, '').replace(/(^|[ (])-/g, '$1')"],
]

describe('mutanți pe fiecare rând al contractului (motorul copiat cu o regulă scoasă, rulat în Node)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'motor_mutanti_'))
  const sursa = readFileSync('src/intrebariMascare.js', 'utf8').replace(/\r\n/g, '\n')
  mkdirSync(join(dir, 'worker/intrebari-tehnice'), { recursive: true })
  for (const f of ['nemascate.json', 'vocabular_web.json', 'cuvinte_comune.json', 'motor_cazuri.mjs', 'teste_motor.json'])
    copyFileSync(join(RAD, 'worker/intrebari-tehnice', f), join(dir, 'worker/intrebari-tehnice', f))
  writeFileSync(join(dir, 'ruleaza.mjs'), [
    "import { readFileSync } from 'node:fs'",
    "import { ruleazaCazuri } from './worker/intrebari-tehnice/motor_cazuri.mjs'",
    "const E = await import('./src/m.js')",
    "const T = JSON.parse(readFileSync(new URL('./worker/intrebari-tehnice/teste_motor.json', import.meta.url), 'utf8'))",
    "process.stdout.write(JSON.stringify(ruleazaCazuri(E, T).map(x => x.caz + ' | ' + x.ce)))",
  ].join('\n'))
  mkdirSync(join(dir, 'src'), { recursive: true })
  const ruleaza = text => {
    writeFileSync(join(dir, 'src/m.js'), text)
    const r = spawnSync(process.execPath, [join(dir, 'ruleaza.mjs')], { encoding: 'utf8', timeout: 60000 })
    expect(r.status, r.stderr).toBe(0)
    return JSON.parse(r.stdout)
  }
  it('fără mutant, copia motorului trece toate cazurile (harness-ul e corect)', () => {
    expect(ruleaza(sursa)).toEqual([])
  })
  for (const [nume, rand, cauta, inlocuieste] of MUTANTI) {
    it(nume, () => {
      expect(sursa.includes(cauta), `mutantul nu se aplică: ${cauta}`).toBe(true)
      const pica = ruleaza(sursa.replace(cauta, inlocuieste))
      expect(pica.some(c => c.includes(rand)), `${nume}: niciun caz „${rand}” nu pică — ${JSON.stringify(pica.slice(0, 5))}`).toBe(true)
    })
  }
  it('curățenie', () => rmSync(dir, { recursive: true, force: true }))
})

// ── „Fără rețea” (r5, review r4 P2): o proprietate a CODULUI fixat prin manifest, NU o izolare a procesului. Verificarea e pe
// ARBORELE SINTACTIC (parseAst din vite, deja dependență directă — fără librării noi), nu pe text: un filtru textual nu vede
// `globalThis["pro" + "cess"]`. Reguli pentru motor și protocol (orice fișier .js / .mjs din manifest, afară de intrare):
//   - importurile statice / re-exporturile: doar căi relative care sunt fișiere din manifest;
//   - niciun import dinamic, niciun `import.meta`;
//   - niciun identificator din IDENTIFICATORI_INTERZISI, oriunde (și ca nume de proprietate — prudent);
//   - nicio accesare a proprietății `constructor` (calea spre Function), nici cu nume calculat literal.
// Excepțiile, enumerate, DOAR pentru intrarea care gestionează procesul (motor_cli.mjs): importurile node:crypto / node:fs /
// node:path / node:url; importurile dinamice cu text literal './motor_protocol.mjs' și '../../src/intrebariMascare.js';
// identificatorii `process` și `globalThis`; `import.meta`.
const IDENTIFICATORI_INTERZISI = ['process', 'globalThis', 'global', 'self', 'window', 'frames', 'require', 'module', 'exports', 'eval', 'Function',
  'fetch', 'WebSocket', 'XMLHttpRequest', 'EventSource', 'Worker', 'SharedWorker', 'importScripts', 'navigator', 'Deno', 'Bun', 'WebAssembly']
const EXCEPTII_INTRARE = { importuri: ['node:crypto', 'node:fs', 'node:path', 'node:url'], dinamice: ['./motor_protocol.mjs', '../../src/intrebariMascare.js'],
  identificatori: ['process', 'globalThis'], meta: true }
/** Încălcările regulilor de mai sus într-o sursă (lista goală = în regulă). `cale` = fișierul (pentru căile relative). */
function incalcari(sursa, cale, exceptii = null) {
  const out = []
  const ast = parseAst(sursa)
  const relativ = s => {
    if (!s.startsWith('.')) return false
    return FISIERE_GENERATOR.includes(join(cale, '..', s).replace(/\\/g, '/'))
  }
  const viziteaza = n => {
    if (!n || typeof n.type !== 'string') return
    switch (n.type) {
      case 'ImportDeclaration': case 'ExportAllDeclaration': case 'ExportNamedDeclaration':
        if (n.source && !relativ(n.source.value) && !(exceptii?.importuri.includes(n.source.value))) out.push(`import „${n.source.value}”`)
        break
      case 'ImportExpression':
        if (!(exceptii && n.source.type === 'Literal' && exceptii.dinamice.includes(n.source.value))) out.push('import dinamic')
        break
      case 'MetaProperty':
        if (!exceptii?.meta) out.push('import.meta')
        break
      case 'Identifier':
        if (IDENTIFICATORI_INTERZISI.includes(n.name) && !exceptii?.identificatori.includes(n.name)) out.push(`identificator „${n.name}”`)
        break
      case 'MemberExpression':
        if ((!n.computed && n.property.name === 'constructor') || (n.computed && n.property.type === 'Literal' && n.property.value === 'constructor'))
          out.push('proprietatea constructor')
        break
    }
    for (const [k, v] of Object.entries(n)) {
      if (k === 'parent') continue
      if (Array.isArray(v)) v.forEach(viziteaza)
      else if (v && typeof v === 'object' && typeof v.type === 'string') viziteaza(v)
    }
  }
  viziteaza(ast)
  return out
}
describe('„fără rețea” = codul fixat prin manifest nu conține apeluri de rețea (arborele sintactic; NU izolarea procesului)', () => {
  for (const f of FISIERE_GENERATOR.filter(x => /\.m?js$/.test(x))) {
    it(f, () => {
      expect(incalcari(readFileSync(f, 'utf8'), f, f === INTRARE ? EXCEPTII_INTRARE : null), f).toEqual([])
    })
  }
  it('contraexemplele unui filtru textual sunt prinse (ocolirea prin nume calculat, încărcătoare alternative, constructor)', () => {
    const f = 'src/intrebariMascare.js'
    for (const [sursa, asteptat] of [
      ['const p = globalThis["pro" + "cess"]', 'identificator „globalThis”'],
      ["process.getBuiltinModule('net').createConnection(1)", 'identificator „process”'],
      ['const x = (() => 1).constructor', 'proprietatea constructor'],
      ["const x = ''['constructor']", 'proprietatea constructor'],
      ["const m = await import('node:' + 'net')", 'import dinamic'],
      ["import net from 'node:net'", 'import „node:net”'],
      ["export * from 'node:dns'", 'import „node:dns”'],
      ['const u = import.meta.url', 'import.meta'],
      ['const e = (0, eval)', 'identificator „eval”'],
      ['const w = new WebAssembly.Module(b)', 'identificator „WebAssembly”'],
    ]) expect(incalcari(sursa, f), sursa).toContain(asteptat)
    expect(incalcari("import { x } from './App.jsx'\nconst y = x.constructor2", f)).toEqual(['import „./App.jsx”'])   // relativ, dar în afara manifestului
    expect(incalcari("import N from '../worker/intrebari-tehnice/nemascate.json' with { type: 'json' }", f)).toEqual([])
  })
  it('excepțiile intrării sunt exact cele enumerate (un import nou în intrare pică)', () => {
    const t = readFileSync(INTRARE, 'utf8')
    expect(incalcari(t + "\nimport 'node:net'", INTRARE, EXCEPTII_INTRARE)).toEqual(['import „node:net”'])
    expect(incalcari(t + "\nawait import('./alt.mjs')", INTRARE, EXCEPTII_INTRARE)).toEqual(['import dinamic'])
    expect(incalcari(t + '\nfetch(1)', INTRARE, EXCEPTII_INTRARE)).toEqual(['identificator „fetch”'])
  })
  it('intrarea scoate funcțiile de rețea globale și încărcătoarele alternative ÎNAINTE de a încărca motorul (import dinamic, după amprente)', () => {
    const t = readFileSync(INTRARE, 'utf8')
    const scoate = t.indexOf("for (const k of ['fetch', 'WebSocket'"), neutralizeaza = t.indexOf('for (const k of NEUTRALIZATE)')
    const importMotor = t.indexOf("await import('./motor_protocol.mjs')")
    expect(scoate).toBeGreaterThan(0)
    expect(neutralizeaza).toBeGreaterThan(scoate)
    expect(t).toContain("export const NEUTRALIZATE = ['getBuiltinModule', 'binding', '_linkedBinding', 'dlopen']")
    expect(importMotor).toBeGreaterThan(t.indexOf('amprente[f] = createHash'))
    expect(importMotor).toBeGreaterThan(neutralizeaza)
    expect(t).not.toMatch(/^import .*(?:intrebariMascare|motor_protocol)/m)
  })
  it('în PROCESUL real (aceleași flaguri), după neutralizare: getBuiltinModule / binding / _linkedBinding / dlopen și funcțiile de rețea globale lipsesc', () => {
    // copie a intrării + fișierele manifestului, cu protocolul înlocuit de o sondă care raportează ce vede codul încărcat după intrare
    const dir = mkdtempSync(join(tmpdir(), 'motor_sonda_'))
    try {
      for (const f of FISIERE_GENERATOR) { mkdirSync(join(dir, f, '..'), { recursive: true }); copyFileSync(join(RAD, f), join(dir, f)) }
      writeFileSync(join(dir, 'worker/intrebari-tehnice/motor_protocol.mjs'), [
        "export const PROTOCOL = 1",
        "const g = globalThis",
        "const sonda = { getBuiltinModule: typeof process.getBuiltinModule, binding: typeof process.binding, _linkedBinding: typeof process._linkedBinding,",
        "  dlopen: typeof process.dlopen, fetch: typeof g.fetch, WebSocket: typeof g.WebSocket, Request: typeof g.Request }",
        "export function creeazaSesiune() { return { gata: false } }",
        "export function trateaza(s, c) { s.gata = true; return { v: 1, id: c.id, ok: true, rez: sonda } }",
      ].join('\n'))
      const r = spawnSync(process.execPath, ['--permission', `--allow-fs-read=${dir}`, '--disallow-code-generation-from-strings',
        join(dir, INTRARE)], { input: '{"v":1,"id":1,"op":"gata"}\n', encoding: 'utf8', timeout: 60000, env: {} })
      const linii = r.stdout.split('\n').filter(Boolean).map(x => JSON.parse(x))
      expect(linii[1]?.rez, r.stderr).toEqual({ getBuiltinModule: 'undefined', binding: 'undefined', _linkedBinding: 'undefined', dlopen: 'undefined',
        fetch: 'undefined', WebSocket: 'undefined', Request: 'undefined' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('livrarea verificabilă: manifestul sha256 al motorului', () => {
  const M = JSON.parse(readFileSync('worker/intrebari-tehnice/motor_manifest.json', 'utf8'))
  it('manifestul din repo e la zi (altfel: node scripts/intrebari/manifest_motor.mjs)', () => {
    const m = manifest()
    expect(M.fisiere).toEqual(m.fisiere)
    expect([M.versiune, M.protocol, M.motor, M.node_major, M.intrare]).toEqual([m.versiune, m.protocol, m.motor, m.node_major, m.intrare])
    expect(M.unicode).toMatch(/^[0-9]+\.[0-9]+$/)
  })
  it('aceeași listă de fișiere în manifest, în generator și în intrare (motor_cli.mjs)', () => {
    const cli = readFileSync(INTRARE, 'utf8').match(/export const FISIERE = \[([\s\S]*?)\]/)[1].match(/'[^']+'/g).map(x => x.slice(1, -1))
    expect(Object.keys(M.fisiere)).toEqual(FISIERE_GENERATOR)
    expect(cli).toEqual(FISIERE_GENERATOR)
    expect(readFileSync(INTRARE, 'utf8')).toContain(`export const NODE_MAJOR = ${M.node_major}`)
    expect(JSON.parse(readFileSync('package.json', 'utf8')).engines.node).toBe(`${M.node_major}.x`)
  })
  it('limita listelor de nume e aceeași în motor și în edge', () => expect(E.NUME_MAX_LISTA).toBe(NUME_MAX_EDGE))
})

describe('protocolul (motor_protocol.mjs): schemă exactă, o speță = o stare', () => {
  const init = (s, id = 1) => trateaza(s, { v: 1, id, op: 'init', dictionar: inlocuiesteInvizibile(T.dictionar) })
  it('cererile cu altă formă sunt refuzate cu un cod, fără date', () => {
    const s = creeazaSesiune()
    expect(trateaza(s, { v: 2, id: 1, op: 'contoare' })).toEqual({ v: 1, id: 1, ok: false, eroare: 'protocol' })
    expect(trateaza(s, { v: 1, id: 1, op: 'contoare' }).eroare).toBe('neinitializat')
    expect(trateaza(s, { v: 1, id: 1, op: 'contoare' }).eroare).toBe('id')                       // id-urile cresc strict
    expect(trateaza(s, { v: 1, id: 2, op: 'nu_exista' }).eroare).toBe('operatie')
    expect(trateaza(s, { v: 1, id: 3, op: '__proto__' }).eroare).toBe('operatie')
    expect(trateaza(s, { v: 1, id: 4, op: 'mascheaza', text: 'x' }).eroare).toBe('schema')       // lipsește protejeaza
    expect(trateaza(s, { v: 1, id: 5, op: 'mascheaza', text: 'x', protejeaza: false, alt: 1 }).eroare).toBe('schema')
    expect(trateaza(s, { v: 1, id: 6, op: 'mascheaza', text: 3, protejeaza: false }).eroare).toBe('schema')
    expect(trateaza(s, null).eroare).toBe('schema')
    expect(trateaza(s, { v: 1, id: 7, op: 'init', dictionar: { persoane: [], firme: [], cui: [] } })).toEqual({ v: 1, id: 7, ok: false, eroare: 'motor' })
    expect(init(s, 8).ok).toBe(true)
    expect(init(s, 9).eroare).toBe('init_repetat')
    const r = trateaza(s, { v: 1, id: 10, op: 'regula_b', text: 'Da', surse: [{ id: 'C1', titlu: '', extras: 'x', inceput_sigur: 'da', sfarsit_sigur: true }] })
    expect(r.eroare).toBe('schema')
  })
  it('operațiile întorc exact ce dă motorul', () => {
    const s = creeazaSesiune()
    init(s)
    expect(trateaza(s, { v: 1, id: 2, op: 'invata', texte: ['Ion Mare răspunde', null] })).toEqual({ v: 1, id: 2, ok: true, rez: {} })
    expect(trateaza(s, { v: 1, id: 3, op: 'mascheaza', text: 'Ion a cerut', protejeaza: false }).rez).toEqual({ text: '[PERSOANA_1] a cerut' })
    expect(trateaza(s, { v: 1, id: 4, op: 'emise_in', text: '[PERSOANA_1] și [PERSOANA_9]' }).rez).toEqual({ n: 1 })
    expect(trateaza(s, { v: 1, id: 5, op: 'demascheaza_sigur', text: 'Da — [PERSOANA_1].' }).rez).toEqual({ afisat: 'Da — Ion.', motiv: null })
    expect(trateaza(s, { v: 1, id: 6, op: 'contoare' }).rez).toEqual({ contoare: { PERSOANA: 1 }, inlocuiri: 1, total: 1 })
    expect(trateaza(s, { v: 1, id: 7, op: 'cere_citat', text: 'Da.', surse: [] }).rez).toEqual({ cere_citat: true })
    expect(trateaza(s, { v: 1, id: 8, op: 'regula_b', text: 'Da.', surse: [] }).rez.motiv).toBe('fara_citat')
    expect(trateaza(s, { v: 1, id: 9, op: 'gata' }).ok).toBe(true)
    expect(trateaza(s, { v: 1, id: 10, op: 'contoare' }).eroare).toBe('sesiune_inchisa')
  })
  it('două spețe = două stări; nimic nu trece dintr-una în alta', () => {
    const a = creeazaSesiune(), b = creeazaSesiune()
    init(a); init(b)
    expect(trateaza(a, { v: 1, id: 2, op: 'mascheaza', text: 'Zamfirescu Maria', protejeaza: false }).rez.text).toBe('[PERSOANA_1]')
    expect(trateaza(b, { v: 1, id: 2, op: 'demascheaza_sigur', text: '[PERSOANA_1]' }).rez).toEqual({ afisat: null, motiv: 'eticheta_neemisa' })
    expect(trateaza(b, { v: 1, id: 3, op: 'mascheaza', text: 'Ana Vlădescu', protejeaza: false }).rez.text).toBe('[PERSOANA_1]')
    expect(trateaza(a, { v: 1, id: 3, op: 'demascheaza_sigur', text: '[PERSOANA_1]' }).rez.afisat).toBe('Zamfirescu Maria')
  })
  it('lista operațiilor e cea folosită de motor.py', () => {
    const py = readFileSync('worker/intrebari-tehnice/motor.py', 'utf8')
    for (const op of Object.keys(OPERATII)) expect(py, op).toContain(`'${op}'`)
  })
})

// ── Procesul real (aceleași flaguri ca motor.py): salut, protocol, erori, izolare, permisiuni ──
const ARGV = (citire = RAD) => ['--permission', `--allow-fs-read=${citire}`, '--disallow-code-generation-from-strings', CLI]
function proces(linii, citire) {
  const r = spawnSync(process.execPath, ARGV(citire), { input: linii.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join('\n') + '\n', encoding: 'utf8', timeout: 60000, env: {} })
  return { status: r.status, stderr: r.stderr, linii: r.stdout.split('\n').filter(Boolean).map(x => JSON.parse(x)) }
}
describe('procesul Node real (motor_cli.mjs)', () => {
  const D = inlocuiesteInvizibile(T.dictionar)
  it('salutul are versiunile și amprentele din manifest; dus-întors exact cu emoji și invizibile; stderr gol', () => {
    const M = JSON.parse(readFileSync('worker/intrebari-tehnice/motor_manifest.json', 'utf8'))
    const text = inlocuiesteInvizibile('Ana Vlădescu 👷🏽{ZWJ}♀{VS16} a semnat; Vlă{CGJ}descu{ZW} ✅')
    const r = proces([{ v: 1, id: 1, op: 'init', dictionar: D }, { v: 1, id: 2, op: 'mascheaza', text, protejeaza: false }])
    expect(r.stderr).toBe('')
    const [salut, init, masc] = r.linii
    expect(salut).toEqual({ v: 1, tip: 'salut', protocol: 1, motor: M.motor, node: process.versions.node, unicode: process.versions.unicode, amprente: M.fisiere })
    expect(init.ok).toBe(true)
    expect(masc.rez.text).toBe(inlocuiesteInvizibile('[PERSOANA_1] 👷🏽{ZWJ}♀{VS16} a semnat; [PERSOANA_1_F2]{ZW} ✅'))
    const r2 = proces([{ v: 1, id: 1, op: 'init', dictionar: D }, { v: 1, id: 2, op: 'mascheaza', text, protejeaza: false },
      { v: 1, id: 3, op: 'demascheaza_sigur', text: masc.rez.text }, { v: 1, id: 4, op: 'gata' }])
    expect(r2.linii[3].rez).toEqual({ afisat: text, motiv: null })
    expect(r2.status).toBe(0)
  })
  it('JSON stricat → o linie de eroare și ieșire cu cod (fără ecou al intrării)', () => {
    const r = proces(['{"v":1,"id":1,"op":"init","dictionar":{"persoane":["SECRET NUME"]'])
    expect(r.linii.slice(1)).toEqual([{ v: 1, id: null, ok: false, eroare: 'json' }])
    expect(r.status).toBe(73)
    expect(r.stderr).toBe('')
  })
  it('schemă greșită → eroare și ieșire (sesiunea se oprește)', () => {
    const r = proces([{ v: 1, id: 1, op: 'init', dictionar: D }, { v: 1, id: 2, op: 'mascheaza', text: 'x' }, { v: 1, id: 3, op: 'contoare' }])
    expect(r.linii.slice(2)).toEqual([{ v: 1, id: 2, ok: false, eroare: 'schema' }])
    expect(r.status).toBe(76)
  })
  it('dicționar fără persoane (citire eșuată) → refuz', () => {
    const r = proces([{ v: 1, id: 1, op: 'init', dictionar: { persoane: [], firme: ['X SRL'], cui: [] } }])
    expect(r.linii[1]).toEqual({ v: 1, id: 1, ok: false, eroare: 'motor' })
  })
  it('permisiunea de citire în afara fișierelor motorului → procesul nu pornește', () => {
    const r = proces([{ v: 1, id: 1, op: 'gata' }], join(RAD, 'src'))
    expect(r.status).not.toBe(0)
    expect(r.linii).toEqual([])
    expect(r.stderr).toBe('')
  })
  it('două procese concurente (două spețe) nu împart nimic', async () => {
    const porneste = () => {
      const p = spawn(process.execPath, ARGV(), { env: {} })
      const linii = []
      let buf = ''
      p.stdout.on('data', d => { buf += d; let k; while ((k = buf.indexOf('\n')) >= 0) { linii.push(JSON.parse(buf.slice(0, k))); buf = buf.slice(k + 1) } })
      const asteapta = n => new Promise((ok, nu) => { const t0 = Date.now(); const f = () => linii.length >= n ? ok(linii[n - 1]) : Date.now() - t0 > 20000 ? nu(new Error('timp')) : setTimeout(f, 10); f() })
      const trimite = o => p.stdin.write(JSON.stringify(o) + '\n')
      return { p, asteapta, trimite }
    }
    const a = porneste(), b = porneste()
    a.trimite({ v: 1, id: 1, op: 'init', dictionar: D }); b.trimite({ v: 1, id: 1, op: 'init', dictionar: D })
    await a.asteapta(2); await b.asteapta(2)
    a.trimite({ v: 1, id: 2, op: 'mascheaza', text: 'Zamfirescu Maria', protejeaza: false })
    b.trimite({ v: 1, id: 2, op: 'mascheaza', text: 'Ana Vlădescu', protejeaza: false })
    expect((await a.asteapta(3)).rez.text).toBe('[PERSOANA_1]')
    expect((await b.asteapta(3)).rez.text).toBe('[PERSOANA_1]')
    a.trimite({ v: 1, id: 3, op: 'demascheaza_sigur', text: '[PERSOANA_1]' }); b.trimite({ v: 1, id: 3, op: 'demascheaza_sigur', text: '[PERSOANA_1]' })
    expect((await a.asteapta(4)).rez.afisat).toBe('Zamfirescu Maria')
    expect((await b.asteapta(4)).rez.afisat).toBe('Ana Vlădescu')
    a.p.kill(); b.p.kill()
  }, 30000)
})

describe('entitățile publice — un singur loc (nemascate.json), decizia owner-ului 13.11.2026', () => {
  const J = JSON.parse(readFileSync('worker/intrebari-tehnice/nemascate.json', 'utf8'))
  it('NEMASCATE = formele din nemascate.json; nicio listă scrisă în cod', () => {
    expect([...E.NEMASCATE].sort()).toEqual(J.entitati.flatMap(e => e.forme).sort())
    expect(readFileSync('src/intrebariMascare.js', 'utf8')).not.toMatch(/'transgaz|`transgaz|"transgaz/)
  })
  it('intrările invalide sunt refuzate', () => {
    const strica = [d => { d.entitati[0].categorie = 'furnizor' }, d => { d.entitati[0].forme = [] }, d => { d.entitati[0].forme = ['SNTGN Transgaz SA'] },
      d => { d.entitati = [] }, d => { d.entitati[0].motiv = 'x' }, d => { d.categorii.furnizor = 'x' }]
    for (const f of strica) { const d = JSON.parse(JSON.stringify(J)); f(d); expect(() => E.incarcaNemascate(d)).toThrow() }
    expect(() => E.incarcaComune({ cuvinte: ['Alfa'] })).toThrow()
    expect(() => E.incarcaComune({ cuvinte: [] })).toThrow()
  })
  it('cheia entității', () => {
    for (const [nume, cheie] of [['S.N.T.G.N. TRANSGAZ S.A.', 'sntgn transgaz'], ['SC Gazpet Instal S.R.L.', 'gazpet instal'], ['E.ON', 'e on'],
      ['Engie România SA', 'engie romania'], ['Transgaz Construct SRL', 'transgaz construct']]) expect(E.cheieEntitate(nume)).toBe(cheie)
  })
  it('o firmă privată care începe cu numele unei entități publice intră în listă', () => {
    const d = new E.Dictionar([], ['TRANSGAZ SA', 'Delgaz Grid SA', 'SC GAZPET INSTAL SRL', 'S.N.T.G.N. TRANSGAZ S.A.', 'Transgaz Construct SRL'], [])
    expect(d.firme.get('transgaz')).toEqual([['transgaz', 'construct']])
    expect(d.statistici().aruncate.firme_publice).toBe(4)
  })
  it('dicționarul din edge: formă greșită sau fără persoane → refuz', () => {
    for (const r of [null, [], {}, { persoane: [], firme: [], cui: [] }, { persoane: ['A'], firme: 'x', cui: [] }, { persoane: ['A', 3], firme: [], cui: [] },
      { persoane: ['A'], firme: [], cui: [], localitati: 'x' }, { persoane: Array(NUME_MAX_EDGE + 1).fill('A'), firme: [], cui: [] }])
      expect(() => E.Dictionar.dinRaspuns(r), JSON.stringify(r)?.slice(0, 40)).toThrow()
    expect(E.Dictionar.dinRaspuns({ persoane: ['VLĂDESCU ANA'], firme: [], cui: [] }).statistici().localitati).toBe(0)
  })
})

describe('previzualizarea din ecran', () => {
  it('maschează titlu → speță → context (ordinea workerului) și numără', () => {
    const p = E.previzualizare({ titlu: 'Aviz Alfa Construct', intrebare: 'A sunat Vlădescu Ana la 0722 123 456.', context: 'cu Ana Vlădescu' }, DICT)
    expect([p.titlu, p.intrebare, p.context]).toEqual(['Aviz [FIRMA_1]', 'A sunat [PERSOANA_1] la [TELEFON_1].', 'cu [PERSOANA_1_F2]'])
    expect(p.total).toBe(3)
    expect(p.rezumat).toBe('1 persoană, 1 firmă, 1 telefon')
  })
  it('fără nimic de ascuns → total 0', () => {
    const p = E.previzualizare({ titlu: 'Distanța față de canalizare', intrebare: 'Care e distanța minimă la subtraversare?', context: '' }, DICT)
    expect(p.total).toBe(0)
  })
  it('bucățile pentru evidențiere', () => {
    expect(E.bucatiMascate('a [PERSOANA_1] b')).toEqual([{ t: 'text', v: 'a ' }, { t: 'eticheta', v: '[PERSOANA_1]' }, { t: 'text', v: ' b' }])
  })
  it('dicționarul din rândurile citite în ecran (angajați + terți)', () => {
    const d = E.dictionarDinRanduri([{ name: 'VLĂDESCU ANA' }, { name: null }], [{ nume: 'Lumivo Servicii SRL', contact_nume: 'Zamfirescu Maria', cif: 'RO12345678' }, { nume: '' }])
    expect(new E.Mascare(d).mascheaza('Lumivo Servicii, Maria Zamfirescu, Ana Vlădescu, 12345678', false)).toBe('[FIRMA_1], [PERSOANA_1], [PERSOANA_2], [CUI_1]')
  })
  it('ascunderea manuală: [[ ]] fără spațiile de margine; selecție goală / cu rând nou / prea lungă → nimic', () => {
    expect(E.ascundeSelectia('A zis Zbârcea ieri', 5, 14)).toEqual({ text: 'A zis [[Zbârcea]] ieri', cursor: 17 })
    expect(E.ascundeSelectia('abc', 1, 1)).toBe(null)
    expect(E.ascundeSelectia('a\nb', 0, 3)).toBe(null)
    expect(E.ascundeSelectia('x'.repeat(300), 0, 300)).toBe(null)
  })
})

describe('ecranul: previzualizare ORIENTATIVĂ (review r3 P2-5)', () => {
  const jsx = readFileSync('src/IntrebariTehnice.jsx', 'utf8')
  it('textul recenzentului e lângă previzualizare; nicio promisiune „serverul ascunde cel puțin la fel”', () => {
    expect(jsx).toContain('<strong>Previzualizare orientativă.</strong> {AVERTISMENT_PREVIZUALIZARE}')
    expect(jsx).toContain("'Serverul folosește lista completă din platformă și poate ascunde nume suplimentare. Localitățile cunoscute rămân vizibile pe server, chiar dacă aici apar ascunse. Mascarea automată nu garantează eliminarea tuturor numelor.'")
    for (const x of ['cel puțin la fel', 'Ce pleacă la AI', 'se ascund în plus']) expect(jsx, x).not.toContain(x)
  })
  it('ecranul spune ce e în afara contractului (aceleași clase ca în document; r5: lista la zi + limitele F4 distinct)', () => {
    const doc = readFileSync('docs/intrebari/MASCARE_SI_VERDICT.md', 'utf8').replace(/\s+/g, ' ')
    for (const x of ['porecle', 'greșeli de scriere', 'alte alfabete', 'litere despărțite prin spații', 'diminutive',
      'integral cu litere mici fără numele întreg', 'nu le cunoaște', 'literele late', 'CUI-ul cunoscut scris cu spații',
      'cel mult trei cuvinte']) {
      expect(jsx, x).toContain(x)
      expect(doc, x).toContain(x)
    }
    expect(jsx).not.toContain('nume de persoane scrise doar cu litere mici')          // r4: nu mai e o limită
    // r7 (B3): forma ambiguă — ascunsă, dar ca persoană separată (ecranul) = entitate ambiguă proprie (documentul)
    expect(jsx).toContain('se ascunde, dar ca persoană separată')
    expect(doc).toContain('entitate ambiguă proprie')
  })
  it('ecranul și documentul spun exact garanția „fără rețea”: o proprietate a codului, nu o izolare a procesului', () => {
    const doc = readFileSync('docs/intrebari/MASCARE_SI_VERDICT.md', 'utf8').replace(/\s+/g, ' ')
    expect(jsx).toContain('nu conține apeluri de rețea (verificare a codului, nu o izolare a procesului)')
    expect(doc).toContain('codul fixat prin manifest nu conține apeluri de rețea')
    expect(doc).toContain('NU o proprietate de izolare a procesului')
    for (const f of ['docs/intrebari/MASCARE_SI_VERDICT.md', 'worker/intrebari-tehnice/README.md', 'worker/intrebari-tehnice/motor.py',
      'worker/intrebari-tehnice/motor_cli.mjs', 'src/intrebariMascare.js'])
      expect(readFileSync(f, 'utf8').replace(/\s+/g, ' '), f).not.toMatch(/nu are pe unde să trimită/)
  })
})

describe('granița Python (r5): mascarea și regula B în motor; validarea răspunsului în cercetare.py + intrebariSurse.js', () => {
  it('nicio afirmație „Python nu mai conține nicio regulă” în cod sau documente', () => {
    for (const f of ['docs/intrebari/MASCARE_SI_VERDICT.md', 'worker/intrebari-tehnice/README.md', 'worker/intrebari-tehnice/motor.py',
      'worker/intrebari-tehnice/intrebari_worker.py', 'worker/intrebari-tehnice/cercetare.py', 'src/intrebariMascare.js', 'src/IntrebariTehnice.jsx'])
      expect(readFileSync(f, 'utf8').replace(/\s+/g, ' '), f).not.toMatch(/Python (?:NU|nu) mai (?:conține|are) (?:nicio regulă|reguli)|Python NU mai conține/)
    expect(readFileSync('docs/intrebari/MASCARE_SI_VERDICT.md', 'utf8').replace(/\s+/g, ' ')).toContain('validarea răspunsului (susținere, polaritate, `curata_raspuns`) rămâne în `cercetare.py`')
  })
  it('mascare.py nu mai există; motor.py / cercetare.py / workerul nu taie, nu normalizează și nu compară nume sau citate', () => {
    expect(() => readFileSync('worker/intrebari-tehnice/mascare.py')).toThrow()
    const motor = readFileSync('worker/intrebari-tehnice/motor.py', 'utf8')
    for (const x of ['unicodedata', 'TERMINATII', 'ETICHETA', 'normalize(', 'casefold', '.lower()', 'NEMASCATE']) expect(motor, x).not.toContain(x)
    const w = readFileSync('worker/intrebari-tehnice/intrebari_worker.py', 'utf8')
    expect(w).not.toMatch(/import mascare|C\.aplica_regula_b|C\.cere_citat/)
    const c = readFileSync('worker/intrebari-tehnice/cercetare.py', 'utf8')
    for (const x of ['def aplica_regula_b', 'def forma_citat', 'def propozitii_citat', 'def citat_sustinut', 'CITAT_MIN_CUVINTE']) expect(c, x).not.toContain(x)
  })
})
