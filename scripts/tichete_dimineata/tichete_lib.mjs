// tichete_lib.mjs — oglinda JS a funcțiilor pure din tichete_lib.psm1 (producția rulează PowerShell pe serverul AI).
// Folosește ACELEAȘI reguli (reguli.json) și ACELEAȘI șabloane (sablon_brief.md, sablon_review.md), ca testele vitest
// să verifice regulile reale. Orice schimbare de logică în .psm1 se face și aici (și invers); cazurile de test sunt
// aceleași ca în autotest.ps1. Mapare nume: Test-NumarTichet -> testNumarTichet etc. (vezi MAPARE_PS).
// Faza 1 (r3): fără merge — getRecomandareMerge dă doar textul din raport.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const BOM = String.fromCharCode(0xFEFF)
const faraBom = s => (s.startsWith(BOM) ? s.slice(1) : s)
const citeste = f => faraBom(fs.readFileSync(path.join(DIR, f), 'utf8')).replace(/\r\n/g, '\n')
export const REGULI = JSON.parse(citeste('reguli.json'))
const SABLON_BRIEF = citeste('sablon_brief.md')
const SABLON_REVIEW = citeste('sablon_review.md')
const STARI_OK = ['PR_DRAFT', 'DECIZIE']
const STARI_CONSUMA = ['PR_DRAFT', 'PR_FARA_REVIEW', 'DECIZIE', 'ESUAT']
const c = n => String.fromCharCode(n)
const RE_CONTROL = new RegExp('[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F' + c(0x202A) + '-' + c(0x202E) + c(0x2066) + '-' + c(0x2069) + ']', 'g')

export const MAPARE_PS = {
  'Get-ReguliTichete': 'REGULI', 'Get-Camp': 'getCamp', 'Test-NumarTichet': 'testNumarTichet', 'Get-SerieTichet': 'getSerieTichet',
  'Get-AnTichet': 'getAnTichet', 'Test-SlugLansator': 'testSlugLansator', 'Get-SlugTichet': 'getSlugTichet',
  'Get-BranchTichet': 'getBranchTichet', 'Test-BranchPropriu': 'testBranchPropriu', 'Test-TichetAreUrmaGit': 'testTichetAreUrmaGit',
  'Get-CampResult': 'getCampResult', 'Get-StarePaw': 'getStarePaw', 'Test-LansatorOcupat': 'testLansatorOcupat',
  'Get-RaspunsJak': 'getRaspunsJak', 'Get-TextCurat': 'getTextCurat', 'Get-TextSigurLinie': 'getTextSigurLinie',
  'Sort-TicheteCoada': 'sortTicheteCoada', 'Select-TicheteDeLucru': 'selectTicheteDeLucru', 'Test-ListaCompleta': 'testListaCompleta',
  'Get-EffortTichet': 'getEffortTichet', 'New-MarcajDate': 'newMarcajDate', 'New-BriefTichet': 'newBriefTichet',
  'New-BriefReview': 'newBriefReview', 'Get-RezultatAgent': 'getRezultatAgent', 'Get-VerdictReview': 'getVerdictReview',
  'Test-NumeBranch': 'testNumeBranch', 'Select-PrTichet': 'selectPrTichet', 'Get-CaiNameStatusZ': 'getCaiNameStatusZ',
  'Get-LiniiNumstatZ': 'getLiniiNumstatZ', 'Get-CaleNormalizata': 'getCaleNormalizata', 'Get-CaiProtejateAtinse': 'getCaiProtejateAtinse',
  'Test-DiffAreSecurityDefiner': 'testDiffAreSecurityDefiner', 'Get-CuvinteInterziseDiff': 'getCuvinteInterziseDiff',
  'Test-DiffAreMarcajeRezultat': 'testDiffAreMarcajeRezultat', 'Get-RegiuneFunctie': 'getRegiuneFunctie',
  'Test-DiffAtingeRegiune': 'testDiffAtingeRegiune', 'Get-RegiuniInterziseAtinse': 'getRegiuniInterziseAtinse',
  'Test-ReviewTrece': 'testReviewTrece', 'Test-ChecksVerzi': 'testChecksVerzi', 'Get-StareChecks': 'getStareChecks',
  'Get-RecomandareMerge': 'getRecomandareMerge', 'Get-RezumatVerdict': 'getRezumatVerdict',
  'Test-ComandaGhPermisa': 'testComandaGhPermisa', 'Test-ComandaGitPermisa': 'testComandaGitPermisa', 'Get-ListaPs': 'getListaPs',
  'Test-LansatorProfilTichete': 'testLansatorProfilTichete', 'Get-StareNoua': 'getStareNoua', 'Get-StareRulare': 'getStareRulare',
}

const str = v => (v === null || v === undefined ? '' : String(v))
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function getCamp(o, nume) {
  if (o === null || o === undefined || typeof o !== 'object') return null
  return Object.prototype.hasOwnProperty.call(o, nume) ? o[nume] : null
}

// ── Număr, slug, branch ────────────────────────────────────────────────────────────────────────────────────

export function testNumarTichet(n) {
  if (n === null || n === undefined) return false
  return /^TKT-(?:20[0-9]{2}-)?[0-9]{1,6}$/.test(String(n)) && !String(n).includes('\n')
}

export function getSerieTichet(n) {
  if (!testNumarTichet(n)) throw new Error('numar_tichet invalid')
  return parseInt(n.slice(n.lastIndexOf('-') + 1), 10)
}

export function getAnTichet(n) {
  if (!testNumarTichet(n)) throw new Error('numar_tichet invalid')
  const m = n.match(/^TKT-(20[0-9]{2})-/)
  return m ? parseInt(m[1], 10) : 0
}

export function testSlugLansator(s) {
  return typeof s === 'string' && /^[a-z0-9][a-z0-9-]{1,40}$/.test(s) && !s.includes('\n')
}

export function getSlugTichet(n) {
  if (!testNumarTichet(n)) throw new Error('numar_tichet invalid')
  const s = 'tkt-' + n.slice(4).toLowerCase()
  if (!testSlugLansator(s)) throw new Error('slug invalid')
  return s
}

export function getBranchTichet(n, incercare) {
  if (!Number.isInteger(incercare) || incercare < 1 || incercare > 99) throw new Error('incercare invalida')
  return REGULI.prefix_branch + getSlugTichet(n) + '-i' + incercare
}

export function testBranchPropriu(n, branch) {
  if (!branch) return false
  return new RegExp('^' + esc(REGULI.prefix_branch + getSlugTichet(n)) + '-i[0-9]{1,2}$').test(branch) && !branch.includes('\n')
}

const RE_MENTIUNE = /(?<![a-z0-9])(?:tkt|tichet(?:e|ul)?)[-_ #]?([0-9]{1,6}(?:[ ]*[-_/,&+][ ]*(?:tkt[-_]?)?[0-9]{1,6})*)(?![0-9])/g

export function testTichetAreUrmaGit(numar, titluriPr = [], branchuri = []) {
  const serie = getSerieTichet(numar), an = getAnTichet(numar)
  for (const t of [...titluriPr, ...branchuri]) {
    if (t === null || t === undefined) continue
    for (const m of String(t).toLowerCase().matchAll(RE_MENTIUNE)) {
      let nums = m[1].match(/[0-9]+/g) || []
      if (nums.length >= 2 && /^20[0-9]{2}$/.test(nums[0])) {
        if (an !== 0 && parseInt(nums[0], 10) !== an) continue
        nums = nums.slice(1)
      }
      if (nums.some(x => parseInt(x, 10) === serie)) return true
    }
  }
  return false
}

// ── Ieșirile lansatoarelor ─────────────────────────────────────────────────────────────────────────────────

export function getCampResult(json) {
  if (!json || !String(json).trim()) return null
  const linii = faraBom(String(json)).split(/\r?\n/).map(l => l.trim()).filter(l => l.startsWith('{'))
  for (let i = linii.length - 1; i >= 0; i--) {
    let o
    try { o = JSON.parse(linii[i]) } catch { continue }
    if (!o || typeof o !== 'object' || Array.isArray(o) || typeof o.result !== 'string') continue
    if (o.is_error === true) return null
    return o.result
  }
  return null
}

export function getStarePaw(ultimaLinie) {
  const l = str(ultimaLinie).trim()
  if (/^PAW_GATA(\s|$)/.test(l)) return 'GATA'
  if (/^PAW_EROARE\b.*ocupat de alta rulare/.test(l)) return 'OCUPAT'
  if (/^PAW_EROARE(\s|$)/.test(l)) return 'EROARE'
  return 'NECUNOSCUT'
}

export function testLansatorOcupat(exit, ultimaLinie, cine) {
  if (!['RDR', 'RVW'].includes(cine)) throw new Error('cine invalid')
  if (exit !== 3 || ultimaLinie === null || ultimaLinie === undefined) return false
  return new RegExp('^' + cine + '_OCUPAT:').test(String(ultimaLinie).trim())
}

export function getRaspunsJak(log) {
  if (!log) return null
  const l = faraBom(String(log)).split(/\r?\n/)
  const ne = l.map((x, i) => (x.trim() !== '' ? i : -1)).filter(i => i >= 0)
  if (ne.length < 2) return null
  if (!l[ne[0]].startsWith('PAW_START ')) return null
  const iFin = ne[ne.length - 1]
  if (getStarePaw(l[iFin]) !== 'GATA') return null
  let sf = iFin
  for (let i = ne[0] + 1; i < iFin; i++) if (l[i].trim() === '--- stderr ---') { sf = i; break }
  if (sf <= ne[0] + 1) return ''
  return l.slice(ne[0] + 1, sf).join('\n')
}

// ── Text ───────────────────────────────────────────────────────────────────────────────────────────────────

export function getTextCurat(text, max = 8000) {
  if (text === null || text === undefined) return ''
  let s = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(RE_CONTROL, '')
  if (s.length > max) s = s.slice(0, max) + `\n[... text taiat la ${max} caractere ...]`
  return s
}

export function getTextSigurLinie(text, max = 120) {
  return getTextCurat(text, max).replace(/[\n\t]/g, ' ').replace(/[|`<>[\]]/g, ' ').trim()
}

// ── Coada ──────────────────────────────────────────────────────────────────────────────────────────────────

export function sortTicheteCoada(tichete = []) {
  const ord = t => { const o = REGULI.ordine_subcategorii.indexOf(str(getCamp(t, 'subcategorie'))); return o < 0 ? 99 : o }
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
  return tichete.filter(t => t !== null && t !== undefined).map((t, i) => ({ t, i }))
    .sort((a, b) => (ord(a.t) - ord(b.t)) || cmp(str(getCamp(a.t, 'created_at')), str(getCamp(b.t, 'created_at')))
      || cmp(str(getCamp(a.t, 'numar_tichet')), str(getCamp(b.t, 'numar_tichet'))) || (a.i - b.i))
    .map(x => x.t)
}

export function selectTicheteDeLucru({ tichete = [], stare = {}, titluriPr = [], branchuri = [], azi = '', max = 6, maxIncercari = REGULI.max_incercari } = {}) {
  const deLucru = [], sarite = [], vazute = new Set()
  for (const t of sortTicheteCoada(tichete)) {
    const nr = getCamp(t, 'numar_tichet')
    if (!testNumarTichet(nr)) { sarite.push({ numar: '(invalid)', motiv: 'numar_tichet in format necunoscut' }); continue }
    if (vazute.has(nr)) continue
    vazute.add(nr)
    if (REGULI.status_finale.includes(str(getCamp(t, 'status')))) { sarite.push({ numar: nr, motiv: 'status final ' + getTextSigurLinie(getCamp(t, 'status'), 30) }); continue }
    if (!REGULI.subcategorii_permise.includes(str(getCamp(t, 'subcategorie')))) { sarite.push({ numar: nr, motiv: 'subcategorie nepermisa' }); continue }
    const e = Object.prototype.hasOwnProperty.call(stare, nr) ? stare[nr] : null
    const inc = parseInt(getCamp(e, 'incercari') ?? 0, 10) || 0
    const pr = parseInt(getCamp(e, 'pr') ?? 0, 10) || 0
    if (getCamp(e, 'asteapta_decizie') === true) {
      sarite.push({ numar: nr, motiv: 'asteapta decizie (clasa ' + getTextSigurLinie(getCamp(e, 'clasa'), 3) + '): ' + getTextSigurLinie(getCamp(e, 'motiv'), 160) }); continue
    }
    let mod = 'nou', br = null, n = inc + 1
    if (pr > 0 && getCamp(e, 'review_complet') === true) { sarite.push({ numar: nr, motiv: `are deja PR draft #${pr} (raportat)` }); continue }
    if (pr > 0) {
      br = str(getCamp(e, 'branch'))
      if (!testBranchPropriu(nr, br)) { sarite.push({ numar: nr, motiv: 'stare locala nevalida (branch)' }); continue }
      mod = 'review'; n = inc
    } else {
      if (inc >= maxIncercari) { sarite.push({ numar: nr, motiv: `a atins numarul maxim de incercari (${maxIncercari})` }); continue }
      if (azi && str(getCamp(e, 'ultima_data')) === azi && str(getCamp(e, 'ultimul_rezultat')) === 'ESUAT') {
        sarite.push({ numar: nr, motiv: 'esuat azi, se reia la urmatoarea zi lucratoare' }); continue
      }
      br = getBranchTichet(nr, n)
      if (branchuri.includes(br)) mod = 'reluare_pr'
      else {
        const straine = branchuri.filter(b => !testBranchPropriu(nr, b))
        if (testTichetAreUrmaGit(nr, titluriPr, straine)) { sarite.push({ numar: nr, motiv: 'are deja PR sau branch care mentioneaza tichetul' }); continue }
      }
    }
    if (deLucru.length >= max) { sarite.push({ numar: nr, motiv: `peste plafonul zilei (${max})` }); continue }
    deLucru.push({ tichet: t, mod, incercare: n, branch: br })
  }
  return { deLucru, sarite }
}

export function testListaCompleta(numar, limita) {
  return limita > 0 && numar >= 0 && numar < limita
}

export function getEffortTichet(t) {
  const d = getTextCurat(getCamp(t, 'descriere'), 100000)
  return str(getCamp(t, 'subcategorie')) === 'cerere_functie' && d.length <= REGULI.prag_effort_medium ? 'medium' : 'high'
}

// ── Brief-uri ──────────────────────────────────────────────────────────────────────────────────────────────

export function newMarcajDate() {
  return 'DATE_COLEG_' + crypto.randomBytes(12).toString('hex')
}

const MARCAJ_OK = /^DATE_COLEG_[0-9a-f]{8,64}$/

export function newBriefTichet(t, branch, marcaj = newMarcajDate()) {
  const nr = str(getCamp(t, 'numar_tichet'))
  if (!testNumarTichet(nr)) throw new Error('numar_tichet invalid')
  const sub = str(getCamp(t, 'subcategorie'))
  if (!REGULI.subcategorii_permise.includes(sub)) throw new Error('subcategorie nepermisa')
  if (!MARCAJ_OK.test(marcaj)) throw new Error('marcaj invalid')
  if (!testBranchPropriu(nr, branch)) throw new Error('branch invalid')
  const tip = sub === 'cerere_functie' ? 'cerere de îmbunătățire (💡)' : 'eroare raportată (🐛)'
  const campuri = [
    ['titlu', getTextCurat(getCamp(t, 'titlu'), REGULI.max_titlu)],
    ['status', getTextCurat(getCamp(t, 'status'), 40)],
    ['creat_la', getTextCurat(getCamp(t, 'created_at'), 40)],
    ['departament', getTextCurat(getCamp(t, 'departament'), 40)],
    ['pagina', getTextCurat(getCamp(t, 'entitate_descriere'), 300)],
    ['descriere', getTextCurat(getCamp(t, 'descriere'), REGULI.max_descriere)],
  ]
  const date = campuri.map(([k, v]) => `${k}: ${v.split(marcaj).join('[marcaj eliminat]')}\n`).join('')
  const r = SABLON_BRIEF.split('__BRANCH__').join(branch).split('__NR__').join(nr).split('__TIP__').join(tip)
    .split('__SUB__').join(sub).split('__MARCAJ__').join(marcaj)
  return r.split('__DATE__').join(date)
}

export function newBriefReview({ numar, pr, branch, sha, diff, marcaj = newMarcajDate(), maxDiff = 200000 }) {
  if (!testNumarTichet(numar)) throw new Error('numar_tichet invalid')
  if (!testNumeBranch(branch)) throw new Error('branch invalid')
  if (!/^[0-9a-f]{40}$/.test(str(sha))) throw new Error('sha invalid')
  if (!MARCAJ_OK.test(marcaj)) throw new Error('marcaj invalid')
  let d = str(diff).replace(/\r\n/g, '\n')
  if (d.length > maxDiff) d = d.slice(0, maxDiff) + '\n[... diff taiat ...]'
  d = d.split(marcaj).join('[marcaj eliminat]')
  const r = SABLON_REVIEW.split('__NR__').join(numar).split('__PR__').join(String(pr)).split('__BRANCH__').join(branch)
    .split('__SHA__').join(sha).split('__MARCAJ__').join(marcaj)
  return r.split('__DIFF__').join(d)
}

// ── Rezultat agent, verdicte ───────────────────────────────────────────────────────────────────────────────

export function getRezultatAgent(iesire) {
  const nec = d => ({ tip: 'NECUNOSCUT', clasa: '', detaliu: d, pr: 0 })
  if (!iesire) return nec('iesire goala')
  const l = String(iesire).split(/\r?\n/).map(x => x.trim()).filter(x => x !== '')
  if (l.length === 0) return nec('iesire goala')
  const m = l[l.length - 1].match(/^`?REZULTAT_TICHET:[ \t]+(?:(L)[ \t]+(PR|ESUAT)|(B|D|F|\?))[ \t]+([^`]*[^`\s])`?$/)
  if (!m) return nec('ultima linie nu e REZULTAT_TICHET in formatul cerut')
  const det = m[4]
  if (m[1]) {
    if (m[2] === 'PR') {
      const u = det.match(/^https:\/\/github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/pull\/([0-9]{1,7})$/)
      if (!u) return nec('PR fara URL valid')
      return { tip: 'PR', clasa: 'L', detaliu: getTextSigurLinie(det, 200), pr: parseInt(u[1], 10) }
    }
    return { tip: 'ESUAT', clasa: 'L', detaliu: getTextSigurLinie(det, 200), pr: 0 }
  }
  return { tip: 'DECIZIE', clasa: m[3], detaliu: getTextSigurLinie(det, 300), pr: 0 }
}

export function getVerdictReview(iesire) {
  const rez = { verdict: 'NECUNOSCUT', p0: -1, p1: -1 }
  if (!iesire) return rez
  const l = String(iesire).split(/\r?\n/).map(x => x.trim()).filter(x => x !== '')
  if (l.length < 4) return rez
  const iv = l.length - 1
  if (!l[iv].startsWith('VERDICT:')) return rez
  let ir = -1
  for (let i = iv - 1; i >= 0; i--) if (l[i] === 'REZULTAT_REVIEW') { ir = i; break }
  if (ir < 0) return rez
  const bloc = l.slice(ir + 1, iv)
  if (bloc.length < 2 || bloc.length > 3) return rez
  const p = {}, chei = ['P0', 'P1', 'P2']
  for (let i = 0; i < bloc.length; i++) {
    const m = bloc[i].match(new RegExp('^' + chei[i] + ':[ \\t]*([0-9]{1,4})$'))
    if (!m) return rez
    p[chei[i]] = parseInt(m[1], 10)
  }
  const tok = l[iv].slice(8).trim().toUpperCase().split(c(0x021A)).join('T').split(c(0x0162)).join('T')
  const m = tok.match(/^(GO|GO[ _]CU[ _]CONDITII|NO[-_]GO)(?:[ \t]*\((\+?P[0-2](?:[ \t]*[/,+][ \t]*\+?P[0-2])*)\))?$/)
  if (!m) return rez
  const v = m[1] === 'GO' ? 'GO' : m[1].startsWith('GO') ? 'GO_CU_CONDITII' : 'NO_GO'
  if (m[2]) for (const nv of m[2].match(/P[0-2]/g)) if (Object.prototype.hasOwnProperty.call(p, nv) && p[nv] === 0) return rez
  if (v === 'GO' && (p.P0 > 0 || p.P1 > 0)) return rez
  return { verdict: v, p0: p.P0, p1: p.P1 }
}

export function testNumeBranch(n) {
  if (!n || n.length > 120) return false
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(n)) return false
  if (n.includes('..') || n.includes('//') || n.endsWith('/') || n.endsWith('.lock') || n.endsWith('.')) return false
  if (['main', 'head'].includes(n.toLowerCase())) return false
  return true
}

export function selectPrTichet(prs = [], branch, autor) {
  const pe = prs.filter(x => x && str(getCamp(x, 'headRefName')) === branch)
  if (pe.length === 0) return { pr: null, eroare: '' }
  if (pe.length > 1) return { pr: null, eroare: 'mai multe PR-uri pe branch-ul ' + branch }
  const x = pe[0], mot = []
  if (str(getCamp(x, 'state')) !== 'OPEN') mot.push('PR-ul nu e deschis')
  if (getCamp(x, 'isDraft') !== true) mot.push('PR-ul nu e draft')
  if (str(getCamp(x, 'baseRefName')) !== 'main') mot.push('PR-ul nu tinteste main')
  if (getCamp(x, 'isCrossRepository') !== false) mot.push('PR din fork')
  if (str(getCamp(getCamp(x, 'author'), 'login')) !== autor || !autor) mot.push('autor neasteptat')
  if (!/^[0-9a-f]{40}$/.test(str(getCamp(x, 'headRefOid')))) mot.push('sha invalid')
  if (!(parseInt(getCamp(x, 'number'), 10) > 0)) mot.push('numar PR invalid')
  if (mot.length > 0) return { pr: null, eroare: mot.join('; ') }
  return { pr: x, eroare: '' }
}

// ── Căi ────────────────────────────────────────────────────────────────────────────────────────────────────

export function getCaiNameStatusZ(iesire) {
  if (!iesire) return []
  let t = String(iesire).split('\0')
  if (t[t.length - 1] !== '') throw new Error('name-status -z: lipseste terminatorul NUL')
  t = t.slice(0, -1)
  if (t.length % 2 !== 0) throw new Error('name-status -z: numar impar de campuri')
  const cai = []
  for (let i = 0; i < t.length; i += 2) {
    if (!/^[ADMTUXB]$/.test(t[i])) throw new Error('name-status -z: status neasteptat')
    if (t[i + 1] === '') throw new Error('name-status -z: cale goala')
    cai.push(t[i + 1])
  }
  return cai
}

export function getLiniiNumstatZ(iesire, maxLinii) {
  if (!iesire) return 0
  const t = String(iesire).split('\0')
  if (t[t.length - 1] !== '') throw new Error('numstat -z: lipseste terminatorul NUL')
  let s = 0
  for (const r of t.slice(0, -1)) {
    const m = r.match(/^(?:\n)?([0-9]+|-)\t([0-9]+|-)\t([\s\S]+)$/)
    if (!m) throw new Error('numstat -z: inregistrare neasteptata')
    s += (m[1] === '-' || m[2] === '-') ? maxLinii + 1 : parseInt(m[1], 10) + parseInt(m[2], 10)
  }
  return s
}

export function getCaleNormalizata(cale) {
  if (cale === null || cale === undefined) return ''
  return String(cale).replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase().split('/').map(s => s.replace(/[. ]+$/, '')).join('/')
}

export function getCaiProtejateAtinse(fisiere = []) {
  return fisiere.filter(f => {
    if (!f) return false
    const n = getCaleNormalizata(f), seg = n.split('/'), baza = seg[seg.length - 1]
    return REGULI.cai_protejate.some(p => n.startsWith(p)) || REGULI.nume_protejate.includes(baza)
      || REGULI.prefix_nume_protejate.some(p => baza.startsWith(p)) || seg.some(s => REGULI.segmente_protejate.includes(s))
      || REGULI.extensii_protejate.some(e => n.endsWith(e))
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
    for (const w of REGULI.cuvinte_interzise_diff) if (ll.includes(w.toLowerCase()) && !gasite.includes(w)) gasite.push(w)
  }
  return gasite
}

export function testDiffAreMarcajeRezultat(diff) {
  if (!diff) return false
  if (REGULI.marcaje_rezultat.some(mk => diff.includes(mk))) return true
  return diff.split('\n').some(l => l.length > 0 && '+- '.includes(l[0]) && /^(VERDICT|P0|P1|P2)\s*:/.test(l.slice(1).trim()))
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
  const fn = fisiere.filter(Boolean).map(getCaleNormalizata)
  const atinse = []
  for (const r of REGULI.regiuni_interzise) {
    if (!fn.includes(r.fisier.toLowerCase())) continue
    const reg = getRegiuneFunctie(surse[r.fisier] ?? null, r.functie)
    if (!reg || testDiffAtingeRegiune(diff, r.fisier, reg.start, reg.end, r.functie)) atinse.push(`${r.fisier}:${r.functie}`)
  }
  return atinse
}

// ── Recomandarea (faza 1) ──────────────────────────────────────────────────────────────────────────────────

export function testReviewTrece(v) {
  if (!v) return false
  return (v.verdict === 'GO' || v.verdict === 'GO_CU_CONDITII') && v.p0 === 0 && v.p1 === 0
}

export function testChecksVerzi(checks = []) {
  const x = checks.filter(Boolean)
  if (x.length === 0) return false
  if (!x.some(k => str(getCamp(k, 'bucket')) === 'pass')) return false
  return x.every(k => ['pass', 'skipping'].includes(str(getCamp(k, 'bucket'))))
}

export function getStareChecks(exit, out, err) {
  const parse = s => {
    if (!s || !String(s).trim()) return null
    let o
    try { o = JSON.parse(s) } catch { return null }
    if (o === null || o === undefined) return null
    return (Array.isArray(o) ? o : [o]).filter(v => v !== null && v !== undefined)
  }
  if (exit === 0) {
    const p = parse(out)
    if (p === null) return { stare: 'eroare', checks: [], eroare: 'gh pr checks: JSON necitit' }
    if (p.length === 0) return { stare: 'gol', checks: [], eroare: '' }
    return { stare: p.some(k => str(getCamp(k, 'bucket')) === 'pending') ? 'pending' : 'ok', checks: p, eroare: '' }
  }
  if (exit === 8) return { stare: 'pending', checks: parse(out) ?? [], eroare: '' }
  if (err && /no checks reported/.test(err)) return { stare: 'gol', checks: [], eroare: '' }
  return { stare: 'eroare', checks: [], eroare: `gh pr checks exit ${exit}: ${getTextSigurLinie(err, 160)}` }
}

export function getRezumatVerdict(v) {
  return v ? `${v.verdict}, P0=${v.p0}, P1=${v.p1}` : 'lipsa'
}

export function getRecomandareMerge({ jak, fable, checks = [], clasa = 'L', fisiere = [], diff = '', liniiDiff = 0,
  maxLiniiDiff = REGULI.max_linii_diff, crossRepo = false, headSchimbat = false, regiuniAtinse = [], bazaMain = true,
  deschis = true, draft = true } = {}) {
  const motive = []
  if (!testReviewTrece(jak)) motive.push(`review Jakarinos nu e GO fara P0/P1 (${getRezumatVerdict(jak)})`)
  if (!testReviewTrece(fable)) motive.push(`review Fable nu e GO fara P0/P1 (${getRezumatVerdict(fable)})`)
  if (!testChecksVerzi(checks)) motive.push('CI nu e verde (niciun check trecut, check-uri picate sau inca in curs)')
  if (clasa !== 'L') motive.push(`agentul nu a clasat tichetul ca local (clasa ${clasa})`)
  if (fisiere.filter(Boolean).length === 0) motive.push('PR fara fisiere modificate')
  const atinse = getCaiProtejateAtinse(fisiere)
  if (atinse.length > 0) motive.push('atinge ' + atinse.slice(0, 5).map(f => getTextSigurLinie(f, 120)).join(', '))
  if (testDiffAreSecurityDefiner(diff)) motive.push('diff-ul adauga SECURITY DEFINER')
  if (testDiffAreMarcajeRezultat(diff)) motive.push('diff-ul contine marcaje de rezultat (REZULTAT_* / PAW_* / VERDICT:)')
  const cuv = getCuvinteInterziseDiff(diff)
  if (cuv.length > 0) motive.push('diff-ul atinge cuvinte interzise: ' + cuv.join(', '))
  const reg = regiuniAtinse.filter(Boolean)
  if (reg.length > 0) motive.push('atinge regiuni interzise: ' + reg.join(', '))
  if (liniiDiff > maxLiniiDiff) motive.push(`diff prea mare (${liniiDiff} > ${maxLiniiDiff} linii)`)
  if (crossRepo) motive.push('PR din fork')
  if (headSchimbat) motive.push('head-ul PR-ului s-a schimbat dupa review')
  if (!bazaMain) motive.push('PR-ul nu tinteste main')
  if (!deschis) motive.push('PR-ul nu mai e deschis')
  if (!draft) motive.push('PR-ul nu mai e draft (scos din draft de altcineva)')
  return { indeplineste: motive.length === 0, motive }
}

// ── Gărzi pe comenzi ───────────────────────────────────────────────────────────────────────────────────────

export function testComandaGhPermisa(argv = []) {
  if (argv.length < 2) return false
  if (!REGULI.gh_permise.includes(argv[0] + ' ' + argv[1])) return false
  if (argv[0] === 'api') return argv.join(' ') === 'api user --jq .login'
  return !argv.some(x => /^(-X|--method|--input|--web)\b/.test(x))
}

export function testComandaGitPermisa(argv = []) {
  if (argv.length < 1 || !REGULI.git_permise.includes(argv[0])) return false
  return !argv.some(x => /^--(upload-pack|receive-pack|exec|ext-diff)\b/.test(x) || x === '-c')
}

// ── Profilul „tichete” al lui rdr.ps1 ──────────────────────────────────────────────────────────────────────

export function getListaPs(text, nume) {
  if (!text || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(nume)) return null
  const re = new RegExp('\\$' + nume + '(?![A-Za-z0-9_])[ \\t]*=[ \\t]*@\\(', 'g')
  const ms = [...text.matchAll(re)]
  if (ms.length !== 1) return null
  let i = ms[0].index + ms[0][0].length
  const lista = []
  while (i < text.length) {
    const ch = text[i]
    if (ch === ')') return { v: lista }
    if (' \t\r\n,`'.includes(ch)) { i++; continue }
    if (ch === '#') { while (i < text.length && text[i] !== '\n') i++; continue }
    if (ch === "'") {
      const j = text.indexOf("'", i + 1)
      if (j < 0) return null
      if (text[j + 1] === "'") return null
      lista.push(text.slice(i + 1, j)); i = j + 1; continue
    }
    return null
  }
  return null
}

export function testLansatorProfilTichete(text) {
  const mot = []
  if (!text) return { ok: false, motive: ['lansatorul lipseste sau e gol'] }
  const t = String(text).replace(/\r\n/g, '\n')
  const vs = t.match(/\[ValidateSet\(([^)]*)\)\][ \t]*\[string\][ \t]*\$Profil(?![A-Za-z0-9_])/)
  if (!vs || !vs[1].includes("'tichete'")) mot.push('lipseste parametrul -Profil cu valoarea tichete')
  const p = REGULI.profil_tichete
  const i0 = t.indexOf(p.marcaj_start), i1 = t.indexOf(p.marcaj_sfarsit)
  const n0 = t.split(p.marcaj_start).length - 1, n1 = t.split(p.marcaj_sfarsit).length - 1
  if (i0 < 0 || i1 <= i0 || n0 !== 1 || n1 !== 1) { mot.push('lipseste blocul PROFIL_TICHETE (o singura data, inceput inainte de sfarsit)'); return { ok: false, motive: mot } }
  const bloc = t.slice(i0, i1)
  for (const z of p.interzise_in_bloc) if (bloc.toLowerCase().includes(z.toLowerCase())) mot.push('blocul contine ' + z)
  const perm = getListaPs(bloc, 'TichetePermise'), refz = getListaPs(bloc, 'TicheteRefuzate'), dirs = getListaPs(bloc, 'TicheteAdaugaDir')
  if (!perm) mot.push('$TichetePermise lipseste sau nu e o lista simpla')
  if (!refz) mot.push('$TicheteRefuzate lipseste sau nu e o lista simpla')
  if (!dirs) mot.push('$TicheteAdaugaDir lipseste sau nu e o lista simpla')
  else if (dirs.v.length !== 0) mot.push('$TicheteAdaugaDir trebuie sa fie gol')
  const norm = s => String(s).replace(/\s+/g, ' ').trim().toLowerCase()
  if (refz) for (const o of p.refuzuri_obligatorii) if (!refz.v.includes(o)) mot.push('refuz lipsa: ' + o)
  if (perm) {
    const rau = [...p.forme_largi, ...p.refuzuri_obligatorii].map(norm)
    for (const x of perm.v) if (rau.includes(norm(x))) mot.push('permisiune prea larga / refuzata: ' + x)
  }
  return { ok: mot.length === 0, motive: mot }
}

// ── Stare (J7) ─────────────────────────────────────────────────────────────────────────────────────────────

export function getStareNoua(vechi, numar, rezultat, azi) {
  const e = { numar, incercari: 0, ultima_data: '', ultimul_rezultat: '', clasa: '', asteapta_decizie: false, motiv: '', pr: 0, branch: '', review_complet: false, ultima_eroare: '' }
  if (vechi) for (const k of Object.keys(e)) if (Object.prototype.hasOwnProperty.call(vechi, k) && vechi[k] !== null && vechi[k] !== undefined) e[k] = vechi[k]
  e.incercari = parseInt(e.incercari, 10) || 0; e.pr = parseInt(e.pr, 10) || 0
  e.asteapta_decizie = e.asteapta_decizie === true; e.review_complet = e.review_complet === true
  const st = str(rezultat.stare), prNou = parseInt(getCamp(rezultat, 'pr') ?? 0, 10) || 0, det = str(getCamp(rezultat, 'detaliu'))
  if (STARI_CONSUMA.includes(st) && !(prNou > 0 && e.pr === prNou)) { e.incercari += 1; e.ultima_data = azi; e.ultimul_rezultat = st }
  if (st === 'PR_DRAFT' || st === 'PR_FARA_REVIEW') { e.pr = prNou; e.branch = str(getCamp(rezultat, 'branch')); e.review_complet = st === 'PR_DRAFT'; e.clasa = 'L' }
  else if (st === 'DECIZIE') { e.asteapta_decizie = true; e.clasa = str(getCamp(rezultat, 'clasa')); e.motiv = det }
  else if (st === 'BLOCAT') { e.asteapta_decizie = true; e.clasa = '!'; e.motiv = det }
  else if (st === 'ESUAT') e.motiv = det
  else {
    e.ultima_eroare = `${azi} ${st} ${det}`
    if (prNou > 0) { e.pr = prNou; e.branch = str(getCamp(rezultat, 'branch')); e.review_complet = false }
  }
  return e
}

export function getStareRulare(stari = [], nrErori = 0, eroare = '') {
  if (eroare) return 'EROARE'
  if (nrErori > 0) return 'PARTIAL'
  return stari.every(s => STARI_OK.includes(s)) ? 'OK' : 'PARTIAL'
}
