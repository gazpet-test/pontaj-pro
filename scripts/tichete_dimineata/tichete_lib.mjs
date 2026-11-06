// tichete_lib.mjs — oglinda JS a funcțiilor pure din tichete_lib.psm1 (producția rulează PowerShell pe serverul AI).
// Folosește ACELEAȘI reguli (reguli.json) și ACELEAȘI șabloane (sablon_brief.md, sablon_review.md), ca testele vitest
// să verifice regulile reale. Orice schimbare de logică în .psm1 se face și aici (și invers); cazurile de test sunt
// aceleași ca în autotest.ps1. Mapare nume: Test-NumarTichet -> testNumarTichet etc. (vezi MAPARE_PS).
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const citeste = f => fs.readFileSync(path.join(DIR, f), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
export const REGULI = JSON.parse(citeste('reguli.json'))
const SABLON_BRIEF = citeste('sablon_brief.md')
const SABLON_REVIEW = citeste('sablon_review.md')

export const MAPARE_PS = {
  'Get-ReguliTichete': 'REGULI', 'Test-NumarTichet': 'testNumarTichet', 'Get-SerieTichet': 'getSerieTichet', 'Get-SlugTichet': 'getSlugTichet',
  'Test-TichetAreUrmaGit': 'testTichetAreUrmaGit', 'Get-CampResult': 'getCampResult', 'Get-StarePaw': 'getStarePaw',
  'Get-CuvinteInterziseDiff': 'getCuvinteInterziseDiff', 'Test-DiffAreMarcajeRezultat': 'testDiffAreMarcajeRezultat',
  'Get-RegiuneFunctie': 'getRegiuneFunctie', 'Test-DiffAtingeRegiune': 'testDiffAtingeRegiune',
  'Get-RegiuniInterziseAtinse': 'getRegiuniInterziseAtinse',
  'Select-TicheteNoi': 'selectTicheteNoi', 'Get-TextCurat': 'getTextCurat',
  'Get-TextSigurLinie': 'getTextSigurLinie', 'Get-EffortTichet': 'getEffortTichet', 'New-MarcajDate': 'newMarcajDate',
  'New-BriefTichet': 'newBriefTichet', 'New-BriefReview': 'newBriefReview', 'Get-RezultatAgent': 'getRezultatAgent',
  'Get-VerdictReview': 'getVerdictReview', 'Test-NumeBranch': 'testNumeBranch', 'Get-CaiInterziseAtinse': 'getCaiInterziseAtinse',
  'Test-DiffAreSecurityDefiner': 'testDiffAreSecurityDefiner', 'Test-ReviewTrece': 'testReviewTrece',
  'Test-ChecksVerzi': 'testChecksVerzi', 'Get-DecizieMerge': 'getDecizieMerge', 'Get-RezumatVerdict': 'getRezumatVerdict',
}

const str = v => (v === null || v === undefined ? '' : String(v))

export function testNumarTichet(n) {
  if (n === null || n === undefined) return false
  return /^TKT-(?:20[0-9]{2}-)?[0-9]{1,6}$/.test(String(n)) && !String(n).includes('\n')
}

export function getSerieTichet(n) {
  if (!testNumarTichet(n)) throw new Error('numar_tichet invalid')
  return parseInt(n.slice(n.lastIndexOf('-') + 1), 10)
}

export function getSlugTichet(n) {
  if (!testNumarTichet(n)) throw new Error('numar_tichet invalid')
  return 'tkt_' + n.slice(4).replace(/-/g, '_')
}

const RE_MENTIUNE = /(?<![a-z0-9])(?:tkt|tichet(?:e|ul)?)[-_ #]?([0-9]{1,6}(?:[ ]*[-_/,&+][ ]*(?:tkt[-_]?)?[0-9]{1,6})*)(?![0-9])/g

export function testTichetAreUrmaGit(numar, titluriPr = [], branchuri = []) {
  const serie = getSerieTichet(numar)
  return [...titluriPr, ...branchuri].some(t => t !== null && t !== undefined &&
    [...String(t).toLowerCase().matchAll(RE_MENTIUNE)].some(m => (m[1].match(/[0-9]+/g) || []).some(c => parseInt(c, 10) === serie)))
}

export function getCampResult(json) {
  if (!json || !String(json).trim()) return null
  let o
  try { o = JSON.parse(String(json).replace(/^﻿/, '')) } catch { return null }
  if (!o || typeof o !== 'object' || Array.isArray(o) || typeof o.result !== 'string') return null
  return o.result
}

export function getStarePaw(ultimaLinie) {
  const l = str(ultimaLinie).trim()
  if (/^PAW_GATA(\s|$)/.test(l)) return 'GATA'
  if (/^PAW_EROARE\b.*ocupat de alta rulare/.test(l)) return 'OCUPAT'
  if (/^PAW_EROARE(\s|$)/.test(l)) return 'EROARE'
  return 'NECUNOSCUT'
}

export function getTextCurat(text, max = 8000) {
  if (text === null || text === undefined) return ''
  let s = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\u202A-\u202E\u2066-\u2069]/g, '')
  if (s.length > max) s = s.slice(0, max) + `\n[... text taiat la ${max} caractere ...]`
  return s
}

export function getTextSigurLinie(text, max = 120) {
  return getTextCurat(text, max).replace(/[\n\t]/g, ' ').replace(/[|`<>[\]]/g, ' ').trim()
}

export function selectTicheteNoi({ tichete = [], titluriPr = [], branchuri = [], incercateAnterior = [], max = 9 } = {}) {
  const deLucru = [], sarite = [], vazute = new Set()
  for (const t of tichete) {
    if (!t) continue
    const nr = t.numar_tichet
    if (!testNumarTichet(nr)) { sarite.push({ numar: '(invalid)', motiv: 'numar_tichet in format necunoscut' }); continue }
    if (vazute.has(nr)) continue
    vazute.add(nr)
    if (!REGULI.status_permise.includes(str(t.status))) { sarite.push({ numar: nr, motiv: 'status ' + getTextSigurLinie(t.status, 30) }); continue }
    if (!REGULI.subcategorii_permise.includes(str(t.subcategorie))) { sarite.push({ numar: nr, motiv: 'subcategorie nepermisa' }); continue }
    if (testTichetAreUrmaGit(nr, titluriPr, branchuri)) { sarite.push({ numar: nr, motiv: 'are deja PR sau branch' }); continue }
    if (incercateAnterior.some(i => str(i).toLowerCase() === nr.toLowerCase())) { sarite.push({ numar: nr, motiv: 'incercat intr-o rulare anterioara (vezi incercari.json)' }); continue }
    if (deLucru.length >= max) { sarite.push({ numar: nr, motiv: `peste plafonul rularii (${max})` }); continue }
    deLucru.push(t)
  }
  return { deLucru, sarite }
}

export function getEffortTichet(t) {
  const d = getTextCurat(t.descriere, 100000)
  return str(t.subcategorie) === 'cerere_functie' && d.length <= REGULI.prag_effort_medium ? 'medium' : 'high'
}

export function newMarcajDate() {
  return 'DATE_COLEG_' + crypto.randomBytes(12).toString('hex')
}

const MARCAJ_OK = /^DATE_COLEG_[0-9a-f]{8,64}$/

export function newBriefTichet(t, marcaj = newMarcajDate()) {
  const nr = str(t.numar_tichet)
  if (!testNumarTichet(nr)) throw new Error('numar_tichet invalid')
  const sub = str(t.subcategorie)
  if (!REGULI.subcategorii_permise.includes(sub)) throw new Error('subcategorie nepermisa')
  if (!MARCAJ_OK.test(marcaj)) throw new Error('marcaj invalid')
  const tip = sub === 'cerere_functie' ? 'cerere de îmbunătățire (💡)' : 'eroare raportată (🐛)'
  const campuri = [
    ['titlu', getTextCurat(t.titlu, REGULI.max_titlu)],
    ['status', getTextCurat(t.status, 40)],
    ['creat_la', getTextCurat(t.created_at, 40)],
    ['departament', getTextCurat(t.departament, 40)],
    ['pagina', getTextCurat(t.entitate_descriere, 300)],
    ['descriere', getTextCurat(t.descriere, REGULI.max_descriere)],
  ]
  const date = campuri.map(([k, v]) => `${k}: ${v.split(marcaj).join('[marcaj eliminat]')}\n`).join('')
  const r = SABLON_BRIEF.split('__NRLOW__').join(nr.toLowerCase()).split('__NR__').join(nr).split('__TIP__').join(tip)
    .split('__SUB__').join(sub).split('__MARCAJ__').join(marcaj)
  return r.split('__DATE__').join(date)
}

export function newBriefReview({ numar, pr, branch, diff, marcaj = newMarcajDate(), maxDiff = 200000 }) {
  if (!testNumarTichet(numar)) throw new Error('numar_tichet invalid')
  if (!testNumeBranch(branch)) throw new Error('branch invalid')
  if (!MARCAJ_OK.test(marcaj)) throw new Error('marcaj invalid')
  let d = str(diff).replace(/\r\n/g, '\n')
  if (d.length > maxDiff) d = d.slice(0, maxDiff) + '\n[... diff taiat ...]'
  d = d.split(marcaj).join('[marcaj eliminat]')
  const r = SABLON_REVIEW.split('__NR__').join(numar).split('__PR__').join(String(pr)).split('__BRANCH__').join(branch)
    .split('__MARCAJ__').join(marcaj)
  return r.split('__DIFF__').join(d)
}

export function getRezultatAgent(iesire) {
  if (!iesire) return { tip: 'NECUNOSCUT', detaliu: 'iesire goala', nelocal: false }
  const linii = iesire.split(/\r?\n/).map(l => l.trim()).filter(l => /^`?REZULTAT_TICHET:/.test(l))
  const nelocal = linii.some(l => /^`?REZULTAT_TICHET:[ \t]*NELOCAL\b/.test(l))
  if (linii.length === 0) return { tip: 'NECUNOSCUT', detaliu: 'fara linie REZULTAT_TICHET', nelocal }
  const m = linii[linii.length - 1].match(/^`?REZULTAT_TICHET:[ \t]*(PR|NELOCAL|ESUAT)(?:[ \t]+([^`]*))?`?$/)
  if (!m) return { tip: 'NECUNOSCUT', detaliu: 'linie REZULTAT_TICHET neclara', nelocal }
  return { tip: m[1], detaliu: getTextSigurLinie(m[2] ?? '', 200), nelocal }
}

const TOKEN_VERDICT = { GO: 'GO', GO_CU_CONDITII: 'GO_CU_CONDITII', 'GO_CU_CONDIȚII': 'GO_CU_CONDITII', NO_GO: 'NO_GO', 'NO-GO': 'NO_GO' }

export function getVerdictReview(iesire) {
  const rez = { verdict: 'NECUNOSCUT', p0: -1, p1: -1 }
  if (!iesire) return rez
  const l = iesire.split(/\r?\n/).map(x => x.trim())
  let iv = -1
  for (let i = l.length - 1; i >= 0; i--) if (l[i].startsWith('VERDICT:')) { iv = i; break }
  if (iv < 0) return rez
  let ir = -1
  for (let i = iv - 1; i >= 0; i--) if (l[i] === 'REZULTAT_REVIEW') { ir = i; break }
  if (ir < 0) return rez
  const bloc = l.slice(ir + 1)
  if (bloc.filter(x => /^VERDICT\s*:/.test(x)).length !== 1) return rez
  const v = Object.prototype.hasOwnProperty.call(TOKEN_VERDICT, l[iv].slice(8).trim().toUpperCase()) ? TOKEN_VERDICT[l[iv].slice(8).trim().toUpperCase()] : null
  if (!v) return rez
  const dupa = l.slice(iv + 1)
  const p = {}
  for (const k of ['P0', 'P1']) {
    const re = new RegExp('^' + k + '\\s*:')
    if (bloc.filter(x => re.test(x)).length !== 1) return rez
    const lin = dupa.filter(x => re.test(x))
    if (lin.length !== 1) return rez
    const m = lin[0].match(new RegExp('^' + k + ':[ \\t]*([0-9]{1,4})$'))
    if (!m) return rez
    p[k] = parseInt(m[1], 10)
  }
  return { verdict: v, p0: p.P0, p1: p.P1 }
}

export function testNumeBranch(n) {
  if (!n || n.length > 120) return false
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(n)) return false
  if (n.includes('..') || n.includes('//') || n.endsWith('/') || n.endsWith('.lock') || n.endsWith('.')) return false
  if (['main', 'head'].includes(n.toLowerCase())) return false
  return true
}

export function getCaiInterziseAtinse(fisiere = []) {
  return fisiere.filter(f => {
    if (!f) return false
    const n = f.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase()
    return REGULI.cai_interzise.some(p => n.startsWith(p)) || REGULI.extensii_interzise.some(e => n.endsWith(e))
  })
}

export function testDiffAreSecurityDefiner(diff) {
  if (!diff) return false
  return diff.split('\n').some(l => l.startsWith('+') && !l.startsWith('+++') && /security\s+definer/i.test(l))
}

const eLinieModificata = l => (l.startsWith('+') || l.startsWith('-')) && !l.startsWith('+++') && !l.startsWith('---')

export function getCuvinteInterziseDiff(diff) {
  if (!diff) return []
  const gasite = []
  for (const l of diff.split('\n')) {
    if (!eLinieModificata(l)) continue
    const ll = l.toLowerCase()
    for (const c of REGULI.cuvinte_interzise_diff) if (ll.includes(c.toLowerCase()) && !gasite.includes(c)) gasite.push(c)
  }
  return gasite
}

export function testDiffAreMarcajeRezultat(diff) {
  if (!diff) return false
  if (REGULI.marcaje_rezultat.some(mk => diff.includes(mk))) return true
  return diff.split('\n').some(l => l.length > 0 && '+- '.includes(l[0]) && /^(VERDICT|P0|P1)\s*:/.test(l.slice(1).trim()))
}

export function getRegiuneFunctie(text, functie) {
  if (!text || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(functie)) return null
  const l = text.split(/\r?\n/)
  const reStart = new RegExp(`^(export\\s+)?(default\\s+)?(async\\s+)?(function\\s+${functie}\\b|const\\s+${functie}\\b)`)
  const reDecl = /^(export\s+)?(default\s+)?(async\s+)?(function|const|let|var|class)\s/
  const s = l.findIndex(x => reStart.test(x))
  if (s < 0) return null
  let e = l.length - 1
  for (let i = s + 1; i < l.length; i++) if (reDecl.test(l[i])) { e = i - 1; break }
  return { start: s + 1, end: e + 1 }
}

export function testDiffAtingeRegiune(diff, fisier, start, end, functie = '') {
  if (!diff) return false
  const tinta = fisier.replace(/\\/g, '/').toLowerCase()
  let inFisier = false
  for (const l of diff.split('\n')) {
    if (l.startsWith('diff --git ')) {
      const m = l.match(/^diff --git a\/(.+?) b\/(.+?)\s*$/)
      inFisier = !!m && (m[1].toLowerCase() === tinta || m[2].toLowerCase() === tinta)
      continue
    }
    if (!inFisier) continue
    const h = l.match(/^@@ -([0-9]+)(?:,([0-9]+))? \+[0-9]+(?:,[0-9]+)? @@(.*)$/)
    if (!h) continue
    const a = parseInt(h[1], 10), b = h[2] === undefined ? 1 : parseInt(h[2], 10)
    const lo = a, hi = b === 0 ? a + 1 : a + b - 1
    if (lo <= end && hi >= start) return true
    if (functie && h[3].includes(functie)) return true
  }
  return false
}

export function getRegiuniInterziseAtinse(diff, fisiere = [], surse = {}) {
  const fn = fisiere.filter(Boolean).map(f => f.replace(/\\/g, '/').toLowerCase())
  const atinse = []
  for (const r of REGULI.regiuni_interzise) {
    if (!fn.includes(r.fisier.toLowerCase())) continue
    const reg = getRegiuneFunctie(surse[r.fisier] ?? null, r.functie)
    if (!reg || testDiffAtingeRegiune(diff, r.fisier, reg.start, reg.end, r.functie)) atinse.push(`${r.fisier}:${r.functie}`)
  }
  return atinse
}

export function testReviewTrece(v) {
  if (!v) return false
  return (v.verdict === 'GO' || v.verdict === 'GO_CU_CONDITII') && v.p0 === 0 && v.p1 === 0
}

export function testChecksVerzi(checks = []) {
  const c = checks.filter(x => x)
  if (c.length === 0) return false
  return c.every(x => ['pass', 'skipping'].includes(str(x.bucket)))
}

export function getRezumatVerdict(v) {
  return v ? `${v.verdict}, P0=${v.p0}, P1=${v.p1}` : 'lipsa'
}

export function getDecizieMerge({ jak, fable, checks = [], nelocal = false, fisiere = [], diff = '', liniiDiff = 0,
  maxLiniiDiff = REGULI.max_linii_diff, crossRepo = false, headSchimbat = false, regiuniAtinse = [], bazaMain = true, deschis = true } = {}) {
  const motive = []
  if (!testReviewTrece(jak)) motive.push(`review Jakarinos nu e GO fara P0/P1 (${getRezumatVerdict(jak)})`)
  if (!testReviewTrece(fable)) motive.push(`review Fable nu e GO fara P0/P1 (${getRezumatVerdict(fable)})`)
  if (!testChecksVerzi(checks)) motive.push('CI nu e verde (sau nu are niciun check)')
  if (nelocal) motive.push('agentul a marcat NELOCAL')
  if (fisiere.filter(Boolean).length === 0) motive.push('PR fara fisiere modificate')
  const atinse = getCaiInterziseAtinse(fisiere)
  if (atinse.length > 0) motive.push('atinge cai interzise: ' + atinse.slice(0, 5).join(', '))
  if (testDiffAreSecurityDefiner(diff)) motive.push('diff-ul adauga SECURITY DEFINER')
  if (testDiffAreMarcajeRezultat(diff)) motive.push('diff-ul contine marcaje de rezultat (REZULTAT_* / PAW_* / VERDICT:)')
  const cuv = getCuvinteInterziseDiff(diff)
  if (cuv.length > 0) motive.push('diff-ul atinge cuvinte interzise: ' + cuv.join(', '))
  const reg = regiuniAtinse.filter(Boolean)
  if (reg.length > 0) motive.push('atinge regiuni interzise: ' + reg.join(', '))
  if (liniiDiff > maxLiniiDiff) motive.push(`diff prea mare pentru merge automat (${liniiDiff} > ${maxLiniiDiff} linii)`)
  if (crossRepo) motive.push('PR din fork')
  if (headSchimbat) motive.push('head-ul PR-ului s-a schimbat dupa review')
  if (!bazaMain) motive.push('PR-ul nu tinteste main (diff-ul revizuit e fata de main)')
  if (!deschis) motive.push('PR-ul nu mai e deschis')
  return { merge: motive.length === 0, motive }
}
