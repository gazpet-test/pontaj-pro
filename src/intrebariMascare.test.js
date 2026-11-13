import { describe, it, expect } from 'vitest'
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, copyFileSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import * as E from './intrebariMascare.js'
import { ruleazaCazuri, randuriContract, inlocuiesteInvizibile } from '../worker/intrebari-tehnice/motor_cazuri.mjs'
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
    expect(E.curata('fără nimic de scos').idx).toBe(null)
  })
  it('previzualizarea și workerul: același obiect Mascare (o etichetă dată în titlu e stabilă în speță)', () => {
    const p = E.previzualizare({ titlu: 'Mare a cerut avizul', intrebare: 'Cine semnează?', context: 'Ion Mare, diriginte' }, DICT)
    expect(p.titlu).toBe('[PERSOANA_1] a cerut avizul')
    expect(p.context).toBe('[PERSOANA_1_F2], diriginte')
  })
  it('regula B după curățarea răspunsului: un verdict ferm fără citat nu poate rămâne Da', () => {
    const s = [{ id: 'C1', titlu: 'PT C9', extras: 'Responsabilul tehnic cu sudura este atestat de ISCIR.', inceput_sigur: true, sfarsit_sigur: true }]
    const [curat] = curataRaspuns('Da — RTS e atestat de ISCIR [C1].', s)
    expect(curat.startsWith('Da')).toBe(true)
    expect(E.aplicaRegulaB(curat, s).text.startsWith(E.INCERT_REGULA_B)).toBe(true)
  })
})

// ── Mutanți: fiecare rând al contractului (și fiecare excludere din regula B) are o regulă care, scoasă, face cazurile să pice ──
const MUTANTI = [
  ['majuscule', '[majuscule]', 'for (let i = 0; i < simpli.length; i++) {\n      const n = norm(simpli[i][2])',
    'for (let i = 0; i < simpli.length; i++) {\n      if (!/^\\p{Lu}/u.test(simpli[i][2])) continue\n      const n = norm(simpli[i][2])'],
  ['diacritice', '[diacritice]', ".toLowerCase().normalize('NFD')).s", '.toLowerCase()).s'],
  ['separatoare', '[separatoare]', 'const SEP_FIRMA = new RegExp(`^[${SEP_CLASA}]{1,6}$`, \'u\')', 'const SEP_FIRMA = /^ +$/u'],
  ['forme_juridice (lipite)', '[forme_juridice]', 'const p = prefixNorm(corp, tup[x])', 'const p = -1'],
  ['forme_juridice („SC” în față)', '[forme_juridice]', 'if (p) return { start: start - p[1].length, end, context: true }', ''],
  ['flexiuni', '[flexiuni]', 'for (const t of TERMINATII) {\n    const b = n.slice(0, -t.length)', 'for (const t of []) {\n    const b = n.slice(0, -t.length)'],
  ['cratima', '[cratima]', 'const parti = tok => tok.split(RE_CRATIMA).filter(Boolean)', 'const parti = tok => [tok]'],
  ['invizibile (doar Cf)', '[invizibile]', 'const ELIMINABIL = /[\\p{M}\\p{Cf}]/u', 'const ELIMINABIL = /[\\p{Cf}]/u'],
  ['ordine_si_propagare (fără propagare)', '[ordine_si_propagare]', '    if (!this.vazute.size) return\n', '    return\n'],
  ['ordine_si_propagare (fără pre-trecere)', '[ordine_si_propagare]', 'invata(...texte) { for (const t of texte) this.detecteaza(curata(t).s, false) }', 'invata() {}'],
  ['exceptii (firma privată după fragmentul public)', '[exceptii]',
    '    this.firmeDictionar(t, simpli, adauga)          // 10.', '    this.publice(t, simpli, adauga); this.firmeDictionar(t, simpli, adauga) // 10.'],
  ['exceptii (firmă comună fără context)', '[exceptii]', 'if (this.d.firmaComuna(tup) && !r.context) continue', ''],
  ['exceptii (persoană comună fără context)', '[exceptii]', 'if (j > i || !info[i].c.comun)', 'if (true)'],
  ['separatoare (virgula leagă orice)', '[separatoare]', '&& pereche(a, b))', '&& true)'],
  ['eticheta fără paranteză (L20)', 'demascare_sigura', "new RegExp('\\\\[(?:PERSOANA|FIRMA", "new RegExp('(?:PERSOANA|FIRMA"],
  ['regula B: liste', 'regula_b', "motiv = 'lista_sau_tabel'", 'motiv = null'],
  ['regula B: trimiteri', 'regula_b', "motiv = 'trimitere'", 'motiv = null'],
  ['regula B: excepții', 'regula_b', "motiv = 'exceptie'", 'motiv = null'],
  ['regula B: restricție în paragraf', 'regula_b', "motiv = 'restrictie_in_paragraf'", 'motiv = null'],
  ['regula B: context tăiat', 'regula_b', "motiv = 'context_taiat'", 'motiv = null'],
  ['regula B: fragment', 'regula_b', "motiv = 'fragment'", 'motiv = null'],
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

// ── Fără rețea: motorul, protocolul și intrarea nu importă nimic în afara propriilor fișiere ──
describe('fără rețea, fără procese, fără fișiere (verificare statică — Node 24 nu are permisiune pentru rețea)', () => {
  const PERMISE_CLI = new Set(['node:crypto', 'node:fs', 'node:path', 'node:url'])
  const INTERZISE = /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|require|eval|Function|child_process|process\.binding|dlopen|Worker|importScripts)\s*\(|node:(?:net|http|https|http2|dgram|dns|tls|child_process|worker_threads|vm|inspector)|new Function/
  for (const f of FISIERE_GENERATOR.filter(x => /\.m?js$/.test(x))) {
    it(f, () => {
      const t = readFileSync(f, 'utf8').replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '')
      const importuri = [...t.matchAll(/(?:import|export)\s[^'"`]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g)]
        .map(m => m[1] || m[2] || m[3])
      for (const i of importuri) {
        if (i.startsWith('.')) expect(FISIERE_GENERATOR, `${f}: ${i}`).toContain(join(f, '..', i).replace(/\\/g, '/'))
        else expect(f === INTRARE && PERMISE_CLI.has(i), `${f}: import „${i}”`).toBe(true)
      }
      expect(t.match(INTERZISE), f).toBe(null)
      expect(/import\s*\(\s*[^'"\s]/.test(t), `${f}: import dinamic din variabilă`).toBe(false)
    })
  }
  it('intrarea scoate funcțiile de rețea globale ÎNAINTE de a încărca motorul (import dinamic, după amprente)', () => {
    const t = readFileSync(INTRARE, 'utf8')
    const scoate = t.indexOf("for (const k of ['fetch', 'WebSocket'"), importMotor = t.indexOf("await import('./motor_protocol.mjs')")
    expect(scoate).toBeGreaterThan(0)
    expect(importMotor).toBeGreaterThan(t.indexOf('amprente[f] = createHash'))
    expect(importMotor).toBeGreaterThan(scoate)
    expect(t).not.toMatch(/^import .*(?:intrebariMascare|motor_protocol)/m)
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
  it('ecranul spune ce e în afara contractului (aceleași clase ca în document)', () => {
    const doc = readFileSync('docs/intrebari/MASCARE_SI_VERDICT.md', 'utf8').replace(/\s+/g, ' ')
    for (const x of ['porecle', 'greșeli de scriere', 'alte alfabete', 'diminutive', 'doar cu litere mici', 'nu le cunoaște']) {
      expect(jsx, x).toContain(x)
      expect(doc, x).toContain(x)
    }
  })
})

describe('Python nu mai are reguli (r4: un singur motor)', () => {
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
