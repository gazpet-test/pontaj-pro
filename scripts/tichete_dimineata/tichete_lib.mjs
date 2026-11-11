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
const STARI_CONSUMA = ['PR_DRAFT', 'PR_FARA_REVIEW', 'PR_CI_NECITIT', 'PR_HEAD_SCHIMBAT', 'DECIZIE', 'ESUAT']
const STARI_CU_PR = ['PR_DRAFT', 'PR_FARA_REVIEW', 'PR_CI_NECITIT', 'PR_HEAD_SCHIMBAT']
const VERDICTE_SALVABILE = ['GO', 'GO_CU_CONDITII', 'NO_GO']
const AGENT = REGULI.agent_tichete
const BRS = REGULI.bariera_rulesets
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
  'Test-ComandaGhPermisa': 'testComandaGhPermisa', 'Test-ComandaGitPermisa': 'testComandaGitPermisa',
  'Join-ArgvWindows': 'joinArgvWindows', 'Get-CaiAgent': 'getCaiAgent', 'Split-ComandaPermisiune': 'splitComandaPermisiune',
  'Test-ListaAgent': 'testListaAgent', 'Get-ArgvAgent': 'getArgvAgent', 'Test-FormaTokenAgent': 'testFormaTokenAgent',
  'Get-MediuAgent': 'getMediuAgent', 'Test-ConfigAgent': 'testConfigAgent', 'Get-TextGitconfigAgent': 'getTextGitconfigAgent',
  'Test-ConfigGitAgent': 'testConfigGitAgent', 'Get-RepoDinUrl': 'getRepoDinUrl', 'Test-BarieraGitHub': 'testBarieraGitHub',
  'Get-VerdicteSalvate': 'getVerdicteSalvate', 'Get-StareNoua': 'getStareNoua', 'Get-StareRulare': 'getStareRulare',
  // r5
  'Get-CampLista': 'getCampLista', 'Test-ListaExacta': 'testListaExacta', 'Test-ObiectJson': 'testObiectJson', 'Get-CheiObiect': 'getCheiObiect',
  'Get-OptiuniCoada': 'getOptiuniCoada', 'Get-TextSetariAgent': 'getTextSetariAgent', 'Test-CaleSimpla': 'testCaleSimpla', 'Test-CaleExe': 'testCaleExe',
  'Test-CaleSub': 'testCaleSub', 'Get-CaiRadacinaAgent': 'getCaiRadacinaAgent', 'Test-SeparareCai': 'testSeparareCai', 'Get-MediuLansator': 'getMediuLansator',
  'Get-TextLansare': 'getTextLansare', 'Test-RegulaPr': 'testRegulaPr', 'Test-RulesetCanonic': 'testRulesetCanonic', 'Get-AmprentaRulesets': 'getAmprentaRulesets',
  'Test-BarieraInstalare': 'testBarieraInstalare', 'Get-TextAmprenta': 'getTextAmprenta', 'Test-Amprenta': 'testAmprenta', 'Get-StareDupaCi': 'getStareDupaCi',
}

const str = v => (v === null || v === undefined ? '' : String(v))
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function getCamp(o, nume) {
  if (o === null || o === undefined || typeof o !== 'object') return null
  return Object.prototype.hasOwnProperty.call(o, nume) ? o[nume] : null
}

// r5: liste JSON fără ambiguitate (în PS Get-Camp desface listele; aici oglinda păstrează aceeași formă a rezultatului)
export function getCampLista(o, nume) {
  if (!testObiectJson(o) || !Object.prototype.hasOwnProperty.call(o, nume)) return { lista: false, v: [] }
  const val = o[nume]
  return Array.isArray(val) ? { lista: true, v: val } : { lista: false, v: [] }
}
export function testListaExacta(l, asteptat = []) {
  if (!l || l.lista !== true || l.v.length !== asteptat.length) return false
  return asteptat.every((x, i) => typeof l.v[i] === 'string' && l.v[i] === x)
}
export function testObiectJson(o) { return o !== null && typeof o === 'object' && !Array.isArray(o) }
export function getCheiObiect(o) { return testObiectJson(o) ? Object.keys(o) : [] }

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
  if (!['AGT', 'RVW'].includes(cine)) throw new Error('cine invalid')
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
    let mod = 'nou', br = null, n = inc + 1, ver = null
    if (pr > 0 && getCamp(e, 'review_complet') === true) { sarite.push({ numar: nr, motiv: `are deja PR draft #${pr} (raportat)` }); continue }
    if (pr > 0) {
      br = str(getCamp(e, 'branch'))
      if (!testBranchPropriu(nr, br)) { sarite.push({ numar: nr, motiv: 'stare locala nevalida (branch)' }); continue }
      mod = 'review'; n = inc
      if (str(getCamp(e, 'pas_lipsa')) === 'ci') { ver = getVerdicteSalvate(getCamp(e, 'verdicte')); if (ver) mod = 'ci' }
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
    deLucru.push({ tichet: t, mod, incercare: n, branch: br, verdicte: ver })
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
  if (argv[0] === 'api') {
    if (argv.some(x => typeof x !== 'string' || x === '' || /[\s\x00-\x1F]/.test(x))) return false
    const j = argv.join(' ')
    return REGULI.gh_api_citiri.some(re => new RegExp(re).test(j))
  }
  if (!REGULI.gh_permise.includes(argv[0] + ' ' + argv[1])) return false
  return !argv.some(x => /^(-X|--method|--input|--web)\b/.test(x))
}

export function testComandaGitPermisa(argv = []) {
  if (argv.length < 1 || !REGULI.git_permise.includes(argv[0])) return false
  return !argv.some(x => /^--(upload-pack|receive-pack|exec|ext-diff)\b/.test(x) || x === '-c')
}

// ── Lansatorul PROPRIU al agentului (J1, r4): lanseaza_agent.ps1 ───────────────────────────────────────────

export function joinArgvWindows(argv = []) {
  return argv.map(a => {
    const s = str(a)
    if (s === '') return '""'
    if (!/[\s"]/.test(s)) return s
    return '"' + s.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1') + '"'
  }).join(' ')
}

export function getCaiAgent(profil) {
  if (!profil) throw new Error('profil gol')
  const d = path.win32.join(profil, AGENT.dir_config)
  return { dir: d, config: path.win32.join(d, 'agent.json'), token: path.win32.join(d, 'token_agent.txt'),
    cont: path.win32.join(d, 'cont_agent.xml'), amprenta: path.win32.join(d, 'amprenta_rulesets.json') }
}

export function testCaleSimpla(cale) {
  if (typeof cale !== 'string' || !/^[A-Za-z]:\\[A-Za-z0-9_.-]+(?:\\[A-Za-z0-9_.-]+)*$/.test(cale)) return false
  return cale.slice(3).split('\\').every(s => s !== '..' && s !== '.' && !s.endsWith('.'))
}
export function testCaleExe(cale) {
  if (typeof cale !== 'string' || !/^[A-Za-z]:\\[A-Za-z0-9 _.()-]+(?:\\[A-Za-z0-9 _.()-]+)*\.exe$/.test(cale)) return false
  return cale.slice(3).split('\\').every(s => s !== '..' && s !== '.' && !s.endsWith('.') && !s.endsWith(' ') && !s.startsWith(' '))
}
export function testCaleSub(cale, radacina) {
  if (!cale || !radacina) return false
  const c = String(cale).replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase(), r = String(radacina).replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
  return c === r || c.startsWith(r + '\\')
}
export function getCaiRadacinaAgent(radacina) {
  if (!testCaleSimpla(radacina)) throw new Error('radacina agentului invalida')
  const j = (...a) => path.win32.join(radacina, ...a)
  return { radacina, clona: j('clona'), wt: j('wt'), iesire: j('iesire'), cfg: j('cfg'), gitconfig: j('cfg', 'gitconfig'), gh: j('cfg', 'gh'),
    setari: j('setari'), fisSetari: j('setari', 'setari_agent.json'), fisLansare: j('setari', 'lansare.json') }
}
export function testSeparareCai(profilCoordonator, dataDir, repoDir, cfg) {
  if (!cfg) return ['config agent lipsa']
  const mot = [], R = str(cfg.radacina_agent), P = str(cfg.profil_agent)
  for (const [c, n] of [[R, 'radacina_agent'], [P, 'profil_agent']]) {
    if (testCaleSub(c, profilCoordonator) || testCaleSub(profilCoordonator, c)) mot.push(n + ' se suprapune cu profilul coordonatorului')
    if (testCaleSub(c, dataDir) || testCaleSub(dataDir, c)) mot.push(n + ' se suprapune cu paw-data')
  }
  if (testCaleSub(repoDir, profilCoordonator)) mot.push('clona orchestratorului e in profilul coordonatorului (agentul trebuie sa citeasca garda fara acces la profil)')
  if (testCaleSub(repoDir, R) || testCaleSub(R, repoDir) || testCaleSub(repoDir, P)) mot.push('clona orchestratorului se suprapune cu radacina / profilul agentului')
  if (testCaleSub(dataDir, repoDir)) mot.push('paw-data e in clona orchestratorului')
  for (const k of ['claude_exe', 'node_exe', 'config_claude']) if (testCaleSub(str(cfg[k]), profilCoordonator)) mot.push(k + ' e in profilul coordonatorului')
  for (const k of ['claude_exe', 'node_exe']) if (testCaleSub(str(cfg[k]), R) || testCaleSub(str(cfg[k]), P)) mot.push(k + ' e in zona agentului (l-ar putea inlocui)')
  const cc = str(cfg.config_claude)
  if (!(testCaleSub(cc, P) || testCaleSub(cc, R))) mot.push('config_claude trebuie sa fie in profilul sau radacina agentului')
  return mot
}

export function splitComandaPermisiune(intrare, permiteDouaPuncte = false) {
  if (!intrare) return null
  const m = /^Bash\((.+)\)$/.exec(String(intrare))
  if (!m) return null
  const cuv = permiteDouaPuncte ? '[A-Za-z0-9._/=:-]+' : '[A-Za-z0-9._/=-]+'
  if (!new RegExp('^' + cuv + '(?: ' + cuv + ')*(?: \\*)?$').test(m[1])) return null
  const tok = m[1].split(' ')
  const wild = tok[tok.length - 1] === '*'
  return { fix: wild ? tok.slice(0, -1) : tok, wild }
}

const prefixCuvinte = (p, t) => p.length <= t.length && p.every((x, i) => x.toLowerCase() === t[i].toLowerCase())

export function getOptiuniCoada(config = AGENT, branch = '__BRANCH__') {
  const h = {}
  const oc = getCamp(config, 'optiuni_coada')
  for (const k of getCheiObiect(oc)) if (!k.startsWith('_')) h[k.split('__BRANCH__').join(branch)] = oc[k]
  return h
}

export function testListaAgent(permise = [], config = AGENT, branch = '__BRANCH__') {
  const mot = []
  if (!permise.length) return { ok: false, motive: ['lista de unelte e goala'] }
  const coada = getOptiuniCoada(config, branch)
  const fara = config.unelte_fara_shell.map(String), prog = config.programe_shell.map(String)
  for (const u of config.unelte) if (![...fara, 'Bash'].includes(String(u))) mot.push('unealta necunoscuta in --tools: ' + u)
  const norm = s => String(s).replace(/\s+/g, ' ').trim().toLowerCase()
  const largi = config.forme_largi.map(norm)
  const refz = config.refuzuri.map(r => splitComandaPermisiune(String(r), true)).filter(Boolean)
  const vazute = new Set()
  for (const x of permise) {
    const s = String(x)
    if (vazute.has(s)) { mot.push('intrare dublata: ' + s); continue }
    vazute.add(s)
    if (largi.includes(norm(s))) { mot.push('forma larga: ' + s); continue }
    if (fara.includes(s)) continue
    const c = splitComandaPermisiune(s)
    if (!c) { mot.push('forma nepermisa (unealta necunoscuta sau comanda ne-literala): ' + s); continue }
    if (!prog.includes(c.fix[0])) { mot.push('program nepermis: ' + s); continue }
    if (c.fix.length < 2) { mot.push('prea larga (minimum 2 cuvinte fixe): ' + s); continue }
    if (c.wild && !Object.prototype.hasOwnProperty.call(coada, c.fix.join(' '))) { mot.push('coada * fara regula in optiuni_coada: ' + s); continue }
    for (const r of refz) {
      const egal = c.fix.length === r.fix.length
      if ((prefixCuvinte(c.fix, r.fix) && (c.wild || egal)) || (prefixCuvinte(r.fix, c.fix) && (r.wild || egal))) {
        mot.push('poate acoperi un refuz (' + r.fix.join(' ') + '): ' + s); break
      }
    }
  }
  return { ok: mot.length === 0, motive: mot }
}

export function getArgvAgent(numar, branch, effort, setari, config = AGENT) {
  if (!testBranchPropriu(numar, branch)) throw new Error('branch invalid')
  if (!config.efort_permis.includes(effort)) throw new Error('effort nepermis')
  if (!/^claude-[a-z0-9-]{1,60}$/.test(str(config.model))) throw new Error('model invalid')
  if (!/^[A-Za-z]:\\[A-Za-z0-9_\\.-]+\.json$/.test(str(setari)) || str(setari).includes('..')) throw new Error('fisierul de setari al garzii lipseste / cale invalida')
  const mt = parseInt(config.max_turns, 10)
  if (!(mt >= 1 && mt <= 500)) throw new Error('max_turns invalid')
  const perm = config.permise.map(x => String(x).split('__BRANCH__').join(branch))
  const t = testListaAgent(perm, config, branch)
  if (!t.ok) throw new Error('lista de unelte a agentului nu e inchisa: ' + t.motive.slice(0, 3).join('; '))
  const refz = config.refuzuri.map(String)
  if (!refz.length) throw new Error('lista de refuzuri e goala')
  const argv = ['-p', '--restricted', '--settings', setari, '--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence',
    '--permission-mode', 'dontAsk', '--permission-prompts', 'none', '--model', str(config.model), '--effort', effort,
    '--max-turns', String(mt), '--output-format', 'json', '--tools', config.unelte.join(','), '--allowedTools', ...perm, '--disallowedTools', ...refz]
  for (const a of argv) if (config.steaguri_interzise.includes(a)) throw new Error('steag interzis in linia de comanda: ' + a)
  if (argv.filter(a => a === '--settings').length !== 1) throw new Error('--settings trebuie sa apara o singura data')
  return argv
}

export function getTextSetariAgent(nodeExe, garda) {
  if (!testCaleExe(nodeExe)) throw new Error('node.exe: cale invalida')
  if (!/^[A-Za-z]:\\[A-Za-z0-9_\\.-]+\\garda_agent\.mjs$/.test(str(garda)) || str(garda).includes('..')) throw new Error('garda: cale invalida')
  return JSON.stringify({ hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: nodeExe, args: [garda], timeout: 30, onFailure: 'block' }] }] } })
}

export function testFormaTokenAgent(token) {
  return typeof token === 'string' && /^(?:github_pat_[A-Za-z0-9_]{22,255}|ghp_[A-Za-z0-9]{36,255})$/.test(token)
}

export function getMediuAgent(baza = {}, token, cfg, worktree) {
  if (!testFormaTokenAgent(token)) throw new Error('token agent invalid')
  if (!cfg || !testCaleSimpla(worktree)) throw new Error('cai lipsa')
  const ra = getCaiRadacinaAgent(str(cfg.radacina_agent))
  if (!testCaleSub(worktree, ra.wt) || worktree.toLowerCase() === ra.wt.toLowerCase()) throw new Error('worktree in afara radacinii agentului')
  const r = {}
  for (const k of Object.keys(baza)) for (const p of AGENT.mediu_pastrat) if (k.toLowerCase() === p.toLowerCase()) r[p] = String(baza[k])
  Object.assign(r, {
    CLAUDE_CONFIG_DIR: str(cfg.config_claude), GH_TOKEN: token, GH_CONFIG_DIR: ra.gh, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: ra.gitconfig, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never',
    PGPASSFILE: 'NUL', PGSERVICEFILE: 'NUL', ENABLE_CLAUDEAI_MCP_SERVERS: 'false', DISABLE_AUTOUPDATER: '1', NO_COLOR: '1', TICHETE_WT: worktree,
  })
  return r
}

export function getMediuLansator(baza = {}, cfg, token) {
  if (!testFormaTokenAgent(token)) throw new Error('token agent invalid')
  if (!cfg || !testCaleSimpla(str(cfg.profil_agent))) throw new Error('profil agent invalid')
  const r = {}
  for (const k of Object.keys(baza)) for (const p of AGENT.mediu_sistem_lansator) if (k.toLowerCase() === p.toLowerCase()) r[p] = String(baza[k])
  const sr = r.SystemRoot ?? 'C:\\Windows'
  r.Path = AGENT.path_sistem_lansator.map(x => String(x).split('%SystemRoot%').join(sr)).join(';')
  const pr = str(cfg.profil_agent)
  Object.assign(r, { USERPROFILE: pr, HOMEDRIVE: pr.slice(0, 2), HOMEPATH: pr.slice(2), APPDATA: pr + '\\AppData\\Roaming', LOCALAPPDATA: pr + '\\AppData\\Local',
    TEMP: pr + '\\AppData\\Local\\Temp', TMP: pr + '\\AppData\\Local\\Temp', USERNAME: str(cfg.cont_windows),
    GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1', NO_COLOR: '1', TICHETE_GH_TOKEN: token })
  return r
}

export function testConfigAgent(text, lansare = false) {
  const rez = { ok: false, motive: [], cfg: null }
  if (!text || !String(text).trim()) { rez.motive = ['agent.json lipseste sau e gol']; return rez }
  let o
  try { o = JSON.parse(faraBom(String(text))) } catch { rez.motive = ['agent.json nu e JSON valid']; return rez }
  if (o === null || typeof o !== 'object' || Array.isArray(o)) { rez.motive = ['agent.json nu e un obiect']; return rez }
  const mot = []
  const chei = ['versiune', 'repo', 'login_agent', 'email_commit', 'cont_windows', 'profil_agent', 'radacina_agent', 'config_claude', 'claude_exe', 'node_exe', '_nota',
    ...(lansare ? ['sid_coordonator', 'interzise_citire', 'interzise_scriere'] : [])]
  for (const k of Object.keys(o)) if (!chei.includes(k)) mot.push('cheie necunoscuta: ' + getTextSigurLinie(k, 40))
  if (o.versiune !== 2) mot.push('versiune trebuie sa fie 2 (cont Windows separat, README)')
  const repo = str(o.repo), login = str(o.login_agent), cont = str(o.cont_windows)
  if (!/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/.test(repo)) mot.push('repo invalid (owner/nume)')
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(login)) mot.push('login_agent invalid')
  let email = o.email_commit
  if (email === undefined || email === null) email = login + '@users.noreply.github.com'
  else if (!/^[A-Za-z0-9._+-]{1,64}@[A-Za-z0-9.-]{1,190}$/.test(str(email))) mot.push('email_commit invalid')
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,19}$/.test(cont)) mot.push('cont_windows invalid (nume de cont local, max 20)')
  const c = {}
  for (const k of ['profil_agent', 'radacina_agent', 'config_claude']) { const x = typeof o[k] === 'string' ? o[k] : ''; if (!testCaleSimpla(x)) { mot.push(k + ' invalid (cale simpla, fara spatii)'); c[k] = '' } else c[k] = x }
  for (const k of ['claude_exe', 'node_exe']) { const x = typeof o[k] === 'string' ? o[k] : ''; if (!testCaleExe(x)) { mot.push(k + ' invalid (cale absoluta .exe)'); c[k] = '' } else c[k] = x }
  if (c.radacina_agent && c.radacina_agent.length > 60) mot.push('radacina_agent prea lunga (max 60, caile worktree-urilor)')
  if (c.radacina_agent && /^[A-Za-z]:\\Users\\/i.test(c.radacina_agent)) mot.push('radacina_agent nu are voie sa fie sub C:\\Users (profilurile)')
  const l = { sid: '', citire: [], scriere: [] }
  if (lansare) {
    l.sid = str(o.sid_coordonator)
    if (!/^S-1-5-21-[0-9]{1,10}-[0-9]{1,10}-[0-9]{1,10}-[0-9]{1,10}$/.test(l.sid)) mot.push('sid_coordonator invalid')
    for (const k of ['interzise_citire', 'interzise_scriere']) {
      const lst = getCampLista(o, k)
      if (!lst.lista || lst.v.length < 1 || lst.v.length > 40) { mot.push(k + ': lista 1..40 obligatorie'); continue }
      for (const e of lst.v) if (typeof e !== 'string' || !/^[A-Za-z]:\\[^<>:"|?*\x00-\x1F]{1,240}$/.test(e) || e.includes('..')) mot.push(k + ': cale invalida')
      if (k === 'interzise_citire') l.citire = lst.v; else l.scriere = lst.v
    }
  }
  rez.motive = mot
  if (!mot.length) {
    rez.ok = true
    rez.cfg = { repo, login_agent: login, email_commit: str(email), cont_windows: cont, profil_agent: c.profil_agent, radacina_agent: c.radacina_agent,
      config_claude: c.config_claude, claude_exe: c.claude_exe, node_exe: c.node_exe, sid_coordonator: l.sid, interzise_citire: l.citire, interzise_scriere: l.scriere }
  }
  return rez
}

export function getTextLansare(cfg, sidCoordonator, interziseCitire = [], interziseScriere = []) {
  const o = { versiune: 2, repo: cfg.repo, login_agent: cfg.login_agent, email_commit: cfg.email_commit, cont_windows: cfg.cont_windows, profil_agent: cfg.profil_agent,
    radacina_agent: cfg.radacina_agent, config_claude: cfg.config_claude, claude_exe: cfg.claude_exe, node_exe: cfg.node_exe, sid_coordonator: sidCoordonator,
    interzise_citire: [...interziseCitire], interzise_scriere: [...interziseScriere] }
  const t = JSON.stringify(o, null, 2)
  const v = testConfigAgent(t, true)
  if (!v.ok) throw new Error('lansare.json nevalid: ' + v.motive.slice(0, 3).join('; '))
  return t
}

export function getTextGitconfigAgent(cfg) {
  if (!cfg || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(str(cfg.login_agent)) || !/^[A-Za-z0-9._+-]{1,64}@[A-Za-z0-9.-]{1,190}$/.test(str(cfg.email_commit))) throw new Error('config agent invalid')
  return '# generat de lanseaza_agent.ps1 la fiecare pornire - nu se editeaza\n[user]\n\tname = ' + cfg.login_agent + '\n\temail = ' + cfg.email_commit +
    '\n[credential]\n\thelper =\n\thelper = !gh auth git-credential\n'
}

export function testConfigGitAgent(iesire, fisierAgent, repo) {
  if (!iesire) return { ok: false, motive: ['git config: iesire goala'] }
  const t = String(iesire).split('\0')
  if (t[t.length - 1] !== '' || (t.length - 1) % 2 !== 0) return { ok: false, motive: ['git config: format neasteptat'] }
  const mot = [], urls = []
  const fa = ('file:' + String(fisierAgent).replace(/\\/g, '/')).toLowerCase()
  let agentVazut = false
  for (let i = 0; i < t.length - 1; i += 2) {
    const orig = t[i].replace(/\\/g, '/'), kv = t[i + 1], j = kv.indexOf('\n')
    const k = (j < 0 ? kv : kv.slice(0, j)).toLowerCase(), val = j < 0 ? '' : kv.slice(j + 1)
    const dinAgent = orig.toLowerCase() === fa
    if (dinAgent) agentVazut = true
    const ce = getTextSigurLinie(k, 80)
    if (orig.startsWith('command line:')) mot.push('config git din linia de comanda / mediu: ' + ce)
    if (k.startsWith('credential.') && !dinAgent) mot.push('credential din alta sursa decat gitconfig-ul agentului: ' + ce)
    if (k === 'include.path' || k.startsWith('includeif.')) mot.push('include in config git: ' + ce)
    if (/^http\..*(extraheader|cookiefile)$/.test(k) || /^url\..*\.(insteadof|pushinsteadof)$/.test(k) || k === 'core.askpass' || k === 'core.sshcommand' || k === 'remote.origin.pushurl') mot.push('cheie git nepermisa: ' + ce)
    if (k === 'remote.origin.url') urls.push(val)
  }
  if (!agentVazut) mot.push('gitconfig-ul agentului nu e incarcat')
  const ok = u => [`https://github.com/${repo}.git`, `https://github.com/${repo}`].map(x => x.toLowerCase()).includes(String(u).toLowerCase())
  if (urls.length !== 1 || !ok(urls[0])) mot.push(`remote.origin.url neasteptat (trebuie https://github.com/${repo})`)
  return { ok: mot.length === 0, motive: mot }
}

export function getRepoDinUrl(url) {
  const m = /^https:\/\/github\.com\/([A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?$/.exec(str(url).trim())
  return m ? m[1] : ''
}

const eIntreg = n => Number.isInteger(n)
export function testRegulaPr(regula) {
  if (getCamp(regula, 'type') !== 'pull_request') return false
  const p = getCamp(regula, 'parameters'), n = getCamp(p, 'required_approving_review_count')
  return eIntreg(n) && n >= 1 && getCamp(p, 'dismiss_stale_reviews_on_push') === true
}

export function testRulesetCanonic(rs, forma, ocolire) {
  const mot = []
  if (!testObiectJson(rs)) return { ok: false, motive: ['ruleset necitit'] }
  const id = getCamp(rs, 'id')
  if (!eIntreg(id) || id <= 0) mot.push('id lipsa')
  if (getCamp(rs, 'target') !== 'branch') mot.push('tinta nu e branch')
  const enf = str(getCamp(rs, 'enforcement'))
  if (enf !== 'active') mot.push('mod ' + (enf ? getTextSigurLinie(enf, 20) : 'lipsa') + ' (trebuie active)')
  const cond = getCamp(rs, 'conditions'), refn = getCamp(cond, 'ref_name')
  if (!testObiectJson(cond) || getCheiObiect(cond).length !== 1 || !testObiectJson(refn)) mot.push('conditii: doar ref_name (fara repository_name / alte conditii)')
  else {
    if (getCheiObiect(refn).some(k => !['include', 'exclude'].includes(k))) mot.push('ref_name: chei in plus')
    const incOk = forma === 'main' ? BRS.include_main : BRS.include_restul, excOk = forma === 'main' ? [] : BRS.exclude_restul
    if (!testListaExacta(getCampLista(refn, 'include'), incOk)) mot.push('include diferit de ' + incOk.join(','))
    if (!testListaExacta(getCampLista(refn, 'exclude'), excOk)) mot.push('exclude diferit de [' + excOk.join(',') + ']')
  }
  const rl = getCampLista(rs, 'rules')
  if (!rl.lista) mot.push('rules lipsa')
  else {
    const tipuri = rl.v.map(r => str(getCamp(r, 'type')))
    if (forma === 'main') { if (!rl.v.some(testRegulaPr)) mot.push('fara pull_request cu minimum 1 aprobare si aprobarile vechi anulate la push nou') }
    else {
      for (const tp of BRS.reguli_restul) if (!tipuri.includes(tp)) mot.push('fara regula ' + tp)
      for (const u of rl.v.filter(r => getCamp(r, 'type') === 'update')) if (getCamp(getCamp(u, 'parameters'), 'update_allows_fetch_and_merge') === true) mot.push('update permite fetch and merge')
    }
  }
  if (ocolire === 'agent') {
    const cub = str(getCamp(rs, 'current_user_can_bypass'))
    if (cub !== 'never') mot.push('agentul il poate ocoli (current_user_can_bypass = ' + (cub ? getTextSigurLinie(cub, 30) : 'lipsa') + ')')
  } else {
    const ba = getCampLista(rs, 'bypass_actors')
    if (!ba.lista) mot.push('bypass_actors lipsa (identitatea de instalare nu poate edita ruleset-ul?)')
    else for (const a of ba.v) {
      const aid = getCamp(a, 'actor_id')
      const ok = BRS.ocolire_permisa.some(pm => getCamp(a, 'actor_type') === pm.actor_type && eIntreg(aid) && aid === pm.actor_id)
      if (!ok) mot.push('ocolire nepermisa: ' + getTextSigurLinie(getCamp(a, 'actor_type'), 30) + ' ' + getTextSigurLinie(aid, 12))
    }
  }
  return { ok: mot.length === 0, motive: mot }
}

export function getAmprentaRulesets(lista = [], detalii = {}) {
  const a = []
  for (const s of lista) {
    const id = str(getCamp(s, 'id'))
    if (!/^[0-9]{1,12}$/.test(id) || !Object.prototype.hasOwnProperty.call(detalii, id)) throw new Error('amprenta: ruleset fara detalii')
    const u = str(getCamp(detalii[id], 'updated_at'))
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]{8,15}(?:Z|[+-][0-9]{2}:[0-9]{2})$/.test(u)) throw new Error('amprenta: updated_at lipsa la ruleset ' + id)
    a.push(id + '=' + u)
  }
  return a.sort((x, y) => (x < y ? -1 : x > y ? 1 : 0))
}

export function testBarieraGitHub({ loginServer, loginAgentConfig, loginAgent, permisiuni, ramuraImplicita, listaRulesets = [], detalii = {},
  probaAleator = [], probaMain = [], probaTichete = [] } = {}) {
  const mot = [], rez = { ok: false, motive: [], idMain: '', idRestul: '', amprenta: [] }
  if (!loginAgent || loginAgent !== loginAgentConfig) mot.push('tokenul agentului nu e al contului din agent.json')
  if (!loginServer || str(loginAgent).toLowerCase() === str(loginServer).toLowerCase()) mot.push('agentul are aceeasi identitate GitHub ca serverul (coordonatorul)')
  if (getCamp(permisiuni, 'push') !== true) mot.push('agentul nu poate impinge branch-uri (push)')
  if (getCamp(permisiuni, 'admin') !== false) mot.push('agentul are (sau nu se stie daca are) drept de administrare pe repo')
  if (getCamp(permisiuni, 'maintain') !== false) mot.push('agentul are (sau nu se stie daca are) drept maintain pe repo')
  if (str(ramuraImplicita) !== BRS.ramura_implicita) mot.push('branch-ul implicit nu e ' + BRS.ramura_implicita)
  const lista = listaRulesets.filter(x => x !== null && x !== undefined)
  if (lista.length >= BRS.max_rulesets) mot.push('prea multe ruleset-uri (' + lista.length + '): lista poate fi trunchiata')
  const ids = [], ocol = {}, gMain = [], gRest = [], mMain = [], mRest = []
  for (const s of lista) {
    const id = str(getCamp(s, 'id'))
    if (!/^[0-9]{1,12}$/.test(id)) { mot.push('ruleset cu id invalid in lista'); continue }
    if (ids.includes(id)) { mot.push('ruleset dublat in lista: ' + id); continue }
    ids.push(id)
    const d = Object.prototype.hasOwnProperty.call(detalii, id) ? detalii[id] : null
    if (!testObiectJson(d) || str(getCamp(d, 'id')) !== id) { mot.push('ruleset ' + id + ': detalii necitite'); continue }
    ocol[id] = str(getCamp(d, 'current_user_can_bypass'))
    const tm = testRulesetCanonic(d, 'main', 'agent'), tr = testRulesetCanonic(d, 'restul', 'agent')
    if (tm.ok) gMain.push(id); else mMain.push(id + ': ' + tm.motive.slice(0, 2).join(', '))
    if (tr.ok) gRest.push(id); else mRest.push(id + ': ' + tr.motive.slice(0, 2).join(', '))
  }
  if (!gMain.length) mot.push('niciun ruleset main in forma ceruta (activ, ~DEFAULT_BRANCH, PR cu aprobare, fara ocolire pentru agent)' + (mMain.length ? ' - ' + mMain.slice(0, 3).join('; ') : ''))
  if (!gRest.length) mot.push('niciun ruleset pentru restul branch-urilor in forma ceruta (activ, ~ALL minus refs/heads/tichete/**/*, creation + update + deletion, fara ocolire)' + (mRest.length ? ' - ' + mRest.slice(0, 3).join('; ') : ''))
  const verif = (proba, ce) => {
    const t = {}
    for (const rg of proba) {
      if (rg === null || rg === undefined) continue
      const rid = str(getCamp(rg, 'ruleset_id'))
      if (!Object.prototype.hasOwnProperty.call(ocol, rid)) { mot.push('proba ' + ce + ': regula dintr-un ruleset necunoscut (' + getTextSigurLinie(rid, 14) + ')'); continue }
      if (ocol[rid] !== 'never') continue
      const tp = str(getCamp(rg, 'type'))
      ;(t[tp] ??= []).push({ id: rid, regula: rg })
    }
    return t
  }
  const pa = verif(probaAleator, 'nume aleator'), pm = verif(probaMain, 'main'), pt = verif(probaTichete, 'tichete/')
  for (const tp of BRS.reguli_restul) {
    if (!pa[tp]) mot.push('proba nume aleator: fara restrictia ' + tp + ' (neocolibila)')
    else if (!pa[tp].some(x => gRest.includes(x.id))) mot.push('proba nume aleator: ' + tp + ' nu vine din ruleset-ul canonic')
  }
  if (!pm.pull_request || !pm.pull_request.some(x => testRegulaPr(x.regula) && gMain.includes(x.id))) mot.push('proba main: fara pull_request canonic neocolibil')
  if (!pm.update) mot.push('proba main: fara restrictia update (neocolibila)')
  for (const tp of ['creation', 'update']) if (pt[tp]) mot.push('proba tichete/: agentul nu poate face ' + tp + ' (restrictia se aplica si acolo)')
  rez.idMain = gMain[0] ?? ''; rez.idRestul = gRest[0] ?? ''
  if (!mot.length) { try { rez.amprenta = getAmprentaRulesets(lista, detalii) } catch (e) { mot.push(e.message) } }
  rez.motive = mot; rez.ok = mot.length === 0
  return rez
}

export function testBarieraInstalare(agent = {}, coordonator = {}, idMain, idRestul) {
  const mot = []
  for (const [id, f] of [[idMain, 'main'], [idRestul, 'restul']]) {
    if (!/^[0-9]{1,12}$/.test(str(id))) { mot.push('ruleset ' + f + ' lipsa'); continue }
    const dc = Object.prototype.hasOwnProperty.call(coordonator, id) ? coordonator[id] : null
    const da = Object.prototype.hasOwnProperty.call(agent, id) ? agent[id] : null
    const t = testRulesetCanonic(dc, f, 'instalare')
    if (!t.ok) mot.push('ruleset ' + id + ' (' + f + '): ' + t.motive.slice(0, 3).join(', '))
    const u1 = str(getCamp(da, 'updated_at')), u2 = str(getCamp(dc, 'updated_at'))
    if (!u1 || u1 !== u2) mot.push('ruleset ' + id + ': updated_at diferit intre citiri (schimbat intre timp)')
  }
  return { ok: mot.length === 0, motive: mot }
}

export function getTextAmprenta(repo, amprenta = [], loginCoordonator, data) {
  if (!amprenta.length) throw new Error('amprenta goala')
  return JSON.stringify({ versiune: 1, repo, rulesets: [...amprenta], verificat_de: loginCoordonator, verificat_la: data }, null, 2)
}

export function testAmprenta(text, repo, curenta = []) {
  if (!text || !String(text).trim()) return { ok: false, motive: ['amprenta ruleset-urilor lipseste (instalare neterminata: instaleaza_task.ps1)'] }
  let o
  try { o = JSON.parse(faraBom(String(text))) } catch { return { ok: false, motive: ['amprenta ruleset-urilor stricata'] } }
  if (!testObiectJson(o) || o.versiune !== 1 || str(o.repo).toLowerCase() !== str(repo).toLowerCase()) return { ok: false, motive: ['amprenta ruleset-urilor: versiune / repo diferite'] }
  if (!testListaExacta(getCampLista(o, 'rulesets'), curenta) || !curenta.length) return { ok: false, motive: ['ruleset-urile s-au schimbat de la instalare (id / updated_at) - reinstalare cu verificarea coordonatorului'] }
  return { ok: true, motive: [] }
}

export function getVerdicteSalvate(v) {
  if (v === null || v === undefined || typeof v !== 'object') return null
  const sha = str(getCamp(v, 'sha'))
  if (!/^[0-9a-f]{40}$/.test(sha)) return null
  const r = { sha }
  for (const k of ['jak', 'fable']) {
    const x = getCamp(v, k), vd = str(getCamp(x, 'verdict')), p0 = getCamp(x, 'p0'), p1 = getCamp(x, 'p1')
    if (!VERDICTE_SALVABILE.includes(vd)) return null
    if (![p0, p1].every(p => Number.isInteger(p) && p >= 0)) return null
    r[k] = { verdict: vd, p0, p1 }
  }
  return r
}

// ── Stare (J7) ─────────────────────────────────────────────────────────────────────────────────────────────

export function getStareNoua(vechi, numar, rezultat, azi) {
  const e = { numar, incercari: 0, ultima_data: '', ultimul_rezultat: '', clasa: '', asteapta_decizie: false, motiv: '', pr: 0, branch: '', review_complet: false, ultima_eroare: '', pas_lipsa: '', verdicte: null }
  if (vechi) for (const k of Object.keys(e)) if (Object.prototype.hasOwnProperty.call(vechi, k) && vechi[k] !== null && vechi[k] !== undefined) e[k] = vechi[k]
  e.incercari = parseInt(e.incercari, 10) || 0; e.pr = parseInt(e.pr, 10) || 0
  e.asteapta_decizie = e.asteapta_decizie === true; e.review_complet = e.review_complet === true
  const st = str(rezultat.stare), prNou = parseInt(getCamp(rezultat, 'pr') ?? 0, 10) || 0, det = str(getCamp(rezultat, 'detaliu'))
  if (STARI_CONSUMA.includes(st) && !(prNou > 0 && e.pr === prNou)) { e.incercari += 1; e.ultima_data = azi; e.ultimul_rezultat = st }
  if (STARI_CU_PR.includes(st)) {
    e.pr = prNou; e.branch = str(getCamp(rezultat, 'branch')); e.review_complet = st === 'PR_DRAFT'; e.clasa = 'L'
    e.pas_lipsa = ''; e.verdicte = null
    if (st === 'PR_CI_NECITIT') {
      const v = getVerdicteSalvate(getCamp(rezultat, 'verdicte'))
      if (v) { e.pas_lipsa = 'ci'; e.verdicte = v }
      e.ultima_eroare = `${azi} ${st} ${det}`
    }
    if (st === 'PR_HEAD_SCHIMBAT') e.ultima_eroare = `${azi} ${st} ${det}`
  }
  else if (st === 'DECIZIE') { e.asteapta_decizie = true; e.clasa = str(getCamp(rezultat, 'clasa')); e.motiv = det }
  else if (st === 'BLOCAT') { e.asteapta_decizie = true; e.clasa = '!'; e.motiv = det }
  else if (st === 'ESUAT') e.motiv = det
  else {
    e.ultima_eroare = `${azi} ${st} ${det}`
    if (prNou > 0) { e.pr = prNou; e.branch = str(getCamp(rezultat, 'branch')); e.review_complet = false }
  }
  return e
}

export function getStareDupaCi(reviewOk, shaRevizuit, headActual) {
  if (!/^[0-9a-f]{40}$/.test(str(shaRevizuit)) || str(headActual) !== str(shaRevizuit)) return 'PR_HEAD_SCHIMBAT'
  return reviewOk ? 'PR_DRAFT' : 'PR_FARA_REVIEW'
}

export function getStareRulare(stari = [], nrErori = 0, eroare = '') {
  if (eroare) return 'EROARE'
  if (nrErori > 0) return 'PARTIAL'
  return stari.every(s => STARI_OK.includes(s)) ? 'OK' : 'PARTIAL'
}

// ── Garda PreToolUse a agentului (r5, P1) — DOAR JS: o rulează garda_agent.mjs (node) la FIECARE apel de unealtă ───────────
// CLI 2.1.319 („dontAsk”) lasă să treacă fără listă comenzile Bash socotite „doar citire” (ls, cat, pwd …). Garda închide
// lista efectiv: comanda ÎNTREAGĂ e comparată cu permise + optiuni_coada; uneltele de fișiere doar în worktree-ul tichetului.
// Refuz la orice neclaritate. Rezultat: { ok, motiv }.

const GARDA = AGENT.garda
const RE_CTRL_GARDA = new RegExp('[\\x00-\\x1F\\x7F' + c(0x202A) + '-' + c(0x202E) + c(0x2066) + '-' + c(0x2069) + c(0xFEFF) + ']')
const NU = motiv => ({ ok: false, motiv })
const DA = { ok: true, motiv: '' }
const DISPOZITIVE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9]|conin\$|conout\$)$/i

export function tokenizeazaBash(cmd) {
  // Cuvinte separate de spațiu / tab. Un cuvânt e SIMPLU ([A-Za-z0-9._/=:@+,%-]) sau ÎNTREG între ghilimele ("…" / '…', fără
  // ghilimele lipite de alt text). Metacaracterele de shell sunt refuzate înainte (caractere_interzise_bash), deci în interiorul
  // ghilimelelor nu rămâne nimic expandabil ($, `, \, !). Întoarce { ok, tokeni: [{ t, citat }], motiv }.
  const tok = []
  let i = 0
  while (i < cmd.length) {
    const ch = cmd[i]
    if (ch === ' ' || ch === '\t') { i++; continue }
    if (ch === '"' || ch === "'") {
      const j = cmd.indexOf(ch, i + 1)
      if (j < 0) return { ok: false, tokeni: [], motiv: 'ghilimele neinchise' }
      if (j + 1 < cmd.length && cmd[j + 1] !== ' ' && cmd[j + 1] !== '\t') return { ok: false, tokeni: [], motiv: 'ghilimele lipite de alt text' }
      tok.push({ t: cmd.slice(i + 1, j), citat: true }); i = j + 1; continue
    }
    let j = i
    while (j < cmd.length && cmd[j] !== ' ' && cmd[j] !== '\t') j++
    const t = cmd.slice(i, j)
    if (!/^[A-Za-z0-9._/=:@+,%-]+$/.test(t)) return { ok: false, tokeni: [], motiv: 'cuvant cu caractere nepermise' }
    tok.push({ t, citat: false }); i = j
  }
  return { ok: true, tokeni: tok, motiv: '' }
}

function testCaleRelativaBash(p) {
  if (!/^[A-Za-z0-9._@+-][A-Za-z0-9._/@+,-]*$/.test(p)) return false
  const seg = p.split('/')
  return !seg.some(s => s === '..' || GARDA.segmente_interzise.some(z => z.toLowerCase() === s.toLowerCase()))
}

function verificaCoada(coada, regula) {
  const vazute = new Set()
  let dupaDD = false
  for (let i = 0; i < coada.length; i++) {
    const x = coada[i]
    if (!x.citat && !dupaDD && x.t === '--' && regula.optiuni.includes('--')) { dupaDD = true; continue }
    if (!x.citat && !dupaDD && x.t.startsWith('-')) {
      if (vazute.has(x.t)) return 'optiune repetata: ' + x.t
      if (regula.optiuni.includes(x.t)) { vazute.add(x.t); continue }
      if (regula.cu_valoare.includes(x.t)) {
        const v = coada[i + 1]
        if (!v) return 'lipseste valoarea pentru ' + x.t
        if (!v.citat && v.t.startsWith('-')) return 'valoare care incepe cu - pentru ' + x.t
        vazute.add(x.t); i++; continue
      }
      return 'optiune nepermisa: ' + x.t
    }
    if (regula.pozitionale !== 'cale') return 'argument nepermis: ' + getTextSigurLinie(x.t, 40)
    if (x.citat || !testCaleRelativaBash(x.t)) return 'cale nepermisa: ' + getTextSigurLinie(x.t, 40)
  }
  for (const o of regula.obligatorii) if (!vazute.has(o)) return 'lipseste ' + o
  return ''
}

export function verificaComandaBash(cmd, branch, config = AGENT) {
  if (typeof cmd !== 'string' || !cmd.trim()) return NU('comanda goala')
  if (cmd.length > GARDA.max_comanda) return NU('comanda prea lunga')
  if (RE_CTRL_GARDA.test(cmd)) return NU('caractere de control / linie noua in comanda')
  for (const ch of GARDA.caractere_interzise_bash) if (cmd.includes(ch)) return NU('operator / metacaracter de shell: ' + ch)
  const tz = tokenizeazaBash(cmd)
  if (!tz.ok) return NU(tz.motiv)
  const t = tz.tokeni
  const coada = getOptiuniCoada(config, branch)
  let motivBun = ''
  for (const p of config.permise) {
    const c2 = splitComandaPermisiune(String(p).split('__BRANCH__').join(branch))
    if (!c2) continue
    const n = c2.fix.length
    if (t.length < n || !c2.fix.every((w, i) => !t[i].citat && t[i].t === w)) continue
    if (!c2.wild) { if (t.length === n) return DA; continue }
    const regula = coada[c2.fix.join(' ')]
    if (!regula) { motivBun = 'coada fara regula'; continue }
    const m = verificaCoada(t.slice(n), regula)
    if (!m) return DA
    motivBun = m
  }
  return NU(motivBun || 'comanda nu e pe lista agentului')
}

export function testCaleInWorktree(p, wt, { realpath = x => fs.realpathSync.native(x), exista = x => fs.existsSync(x) } = {}) {
  if (typeof p !== 'string' || !p || p.length > 1000) return NU('cale lipsa / prea lunga')
  if (RE_CTRL_GARDA.test(p)) return NU('caractere de control in cale')
  if (/^[\\/]{2}/.test(p)) return NU('cale UNC / dispozitiv')
  if (p.startsWith('~')) return NU('cale cu ~')
  const dp = p.indexOf(':')
  if (dp !== -1 && !(dp === 1 && /^[A-Za-z]$/.test(p[0]))) return NU('cale cu : (flux alternativ / dispozitiv)')
  if (p.indexOf(':', 2) !== -1) return NU('cale cu : (flux alternativ / dispozitiv)')
  if (/[*?"<>|]/.test(p)) return NU('caractere nepermise in cale')
  if (/^[A-Za-z]:(?![\\/])/.test(p)) return NU('cale relativa la unitate')
  const brut = p.split(/[\\/]+/).filter(Boolean)
  if (brut.some(s => s === '..')) return NU('cale cu ..')
  if (brut.some(s => s !== '.' && /[. ]$/.test(s))) return NU('segment terminat cu punct / spatiu')
  const abs = path.win32.resolve(wt, p)
  if (!testCaleSub(abs, wt)) return NU('in afara worktree-ului')
  const rel = abs.length > wt.replace(/\\+$/, '').length ? abs.slice(wt.replace(/\\+$/, '').length + 1).split('\\').filter(Boolean) : []
  for (const s of rel) {
    if (GARDA.segmente_interzise.some(z => z.toLowerCase() === s.toLowerCase())) return NU('segment protejat: ' + s)
    if (DISPOZITIVE.test(s.split('.')[0])) return NU('nume de dispozitiv')
  }
  let cur = abs
  while (!exista(cur)) { const up = path.win32.dirname(cur); if (up === cur) return NU('cale fara stramos existent'); cur = up }
  let real, realWt
  try { real = realpath(cur); realWt = realpath(wt) } catch { return NU('realpath esuat') }
  if (!testCaleSub(real, realWt)) return NU('legatura (junction / symlink) care iese din worktree')
  return DA
}

function testModelCale(m) {
  if (typeof m !== 'string' || !m || m.length > 500) return NU('model lipsa / prea lung')
  if (RE_CTRL_GARDA.test(m) || /[{}~:]/.test(m) || /^[\\/]/.test(m)) return NU('model cu caractere nepermise / absolut')
  const seg = m.split(/[\\/]+/)
  if (seg.some(s => s === '..')) return NU('model cu ..')
  if (seg.some(s => GARDA.segmente_interzise.some(z => z.toLowerCase() === s.toLowerCase()))) return NU('model pe un segment protejat')
  return DA
}

export function verificaApelAgent(apel, { wt, branch, config = AGENT, realpath, exista } = {}) {
  if (!testCaleSimpla(str(wt))) return NU('worktree-ul garzii lipseste')
  if (!/^tichete\/tkt-(?:20[0-9]{2}-)?[0-9]{1,6}-i[0-9]{1,2}$/.test(str(branch))) return NU('branch-ul garzii lipseste')
  const unealta = str(getCamp(apel, 'tool_name')), inp = getCamp(apel, 'tool_input')
  if (!testObiectJson(inp)) return NU('intrare unealta lipsa')
  const opt = {}
  if (realpath) opt.realpath = realpath
  if (exista) opt.exista = exista
  if (unealta === 'Bash') {
    if (getCamp(inp, 'run_in_background') === true || getCamp(inp, 'dangerouslyDisableSandbox') === true) return NU('Bash in fundal / fara sandbox nepermis')
    return verificaComandaBash(getCamp(inp, 'command'), branch, config)
  }
  const campuri = GARDA.unelte_fisiere[unealta]
  if (!campuri || !config.unelte_fara_shell.includes(unealta)) return NU('unealta nepermisa: ' + getTextSigurLinie(unealta, 40))
  for (const k of campuri) {
    const v = getCamp(inp, k)
    if ((unealta === 'Glob' || unealta === 'Grep') && (v === null || v === undefined || v === '')) continue
    const r = testCaleInWorktree(v, wt, opt)
    if (!r.ok) return r
  }
  for (const k of (GARDA.modele_cale[unealta] || [])) {
    const v = getCamp(inp, k)
    if (v === null || v === undefined) { if (unealta === 'Glob') return NU('model lipsa'); continue }
    const r = testModelCale(v)
    if (!r.ok) return r
  }
  return DA
}
