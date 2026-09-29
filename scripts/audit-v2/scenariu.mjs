import { readFile, mkdir } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { conecteaza } from './cdp.mjs'
import { clientDinEnv, citesteLicitatia, citesteTabel, citesteDupaIds, verificaLant } from './verifica_lant.mjs'
import { verificaSandbox, verificaIds } from './siguranta.js'
import { contracte } from './contracte.js'
import { salveazaJson, incarcaJson } from './dovezi.mjs'
import { verdictAsertiuni, VERDICTE } from './asertiuni.js'
import { comparaGroundTruth } from './comparatie.js'
import { retete } from './retete.js'
import { selecteazaFaze } from './costuri.js'
import { verificaRefuzServer } from './refuz.js'
import { VERIGI_AUXILIARE, eroriBlocante } from './rls.js'

const root = fileURLToPath(new URL('../../', import.meta.url))
export async function verificaContextUI(driver, lic, context) {
  // În PT/Clarificări/Cantități selecția se probează prin VALUE, nu prin titlul
  // copiat al licitației sau un număr SANDBOX vizibil în lista din fundal.
  if (context?.tip === 'select') {
    await driver.asteapta(context.selector)
    if (String((await driver.observa(context.selector)).value) !== String(lic.id)) throw new Error('Selectorul licitației din UI nu indică clona')
    return
  }
  await driver.asteapta(`text=🏛 ${lic.nr_anunt}`)
}
export async function snapshot(db, fixture, contract) {
  const ids = ['D1', 'D6', 'D8'].map(k => fixture.cerinte[k])
  const lant = await verificaLant(db, fixture.licitatie_id, ids)
  const tabele = {}; const erori = {}; const eroriAuxiliare = {}
  await Promise.all([...new Set([...contract.tabele, 'ofertare_cerinte', 'ofertare_clarificari', 'ofertare_pt_capitole', 'ofertare_pt_pachet'])].map(async table => {
    try { tabele[table] = await citesteTabel(db, table, 'licitatie_id', fixture.licitatie_id, (table.endsWith('_coada') || table.startsWith('v_')) ? 'licitatie_id' : 'id') }
    catch (e) {
      erori[table] = e.message
      if (VERIGI_AUXILIARE[table] && e.code === '42501') eroriAuxiliare[table] = e.message
    }
  }))
  const copii = async (table, column, parents) => {
    try { tabele[table] = await citesteDupaIds(db, table, column, parents) }
    catch (e) { erori[table] = e.message }
  }
  const cerinteIds = (tabele.ofertare_cerinte || []).map(c => c.id)
  await Promise.all([
    copii('ofertare_acoperire', 'cerinta_id', cerinteIds),
    copii('ofertare_pt_legaturi', 'cerinta_id', cerinteIds),
    copii('ofertare_cerinte_dovezi', 'cerinta_id', cerinteIds),
    copii('ofertare_clarificari_puncte', 'clarificare_id', (tabele.ofertare_clarificari || []).map(c => c.id)),
    copii('ofertare_pt_capitole_versiuni', 'capitol_id', (tabele.ofertare_pt_capitole || []).map(c => c.id)),
  ])
  await copii('ofertare_pt_dovezi', 'legatura_id', (tabele.ofertare_pt_legaturi || []).map(l => l.id))
  tabele.ofertare_pt_pachet_fisiere = []
  for (const p of tabele.ofertare_pt_pachet || []) {
    try { tabele.ofertare_pt_pachet_fisiere.push(...await citesteTabel(db, 'ofertare_pt_pachet_fisiere', 'pachet_id', p.id)) }
    catch (e) { erori.ofertare_pt_pachet_fisiere = e.message }
  }
  tabele.ofertare_licitatii = lant.randuri[0]?.licitatie ? [lant.randuri[0].licitatie] : []
  tabele.ofertare_pt_anexe_asteptate = lant.randuri[0]?.anexe || []
  tabele.ofertare_seap_manifest ??= lant.randuri[0]?.manifest || []
  for (const d of lant.randuri) Object.assign(erori, d.erori)
  for (const [table, eroare] of Object.entries(eroriAuxiliare)) {
    for (const r of lant.rezultate) for (const v of VERIGI_AUXILIARE[table]) {
      const link = r.verigi[v]
      r.verigi[v] = { ...link, stare: 'nedeterminat', de_ce: `${link.de_ce}; SELECT auxiliar refuzat: ${eroare}`,
        eroriAuxiliare: { ...link.eroriAuxiliare, [table]: eroare } }
    }
  }
  return { lant, tabele, erori, eroriAuxiliare }
}

function raspunsDialog(action) {
  const text = action.prompt_env ? process.env[action.prompt_env] : action.text
  const type = action.dialog_type || (action.prompt_env || action.text != null ? 'prompt' : 'confirm')
  if (!['prompt', 'confirm', 'alert'].includes(type)) throw new Error('Tip de dialog invalid în rețetă')
  if (type === 'prompt' && typeof text !== 'string') throw new Error('Textul promptului din rețetă lipsește')
  return { type, accept: action.accept !== false, text }
}

export async function actiuniUI(driver, actions, options = {}) {
  const observatii = []
  for (let i = 0; i < actions.length; i++) {
    const action = actions[i]
    const dialogs = []
    if (action.tip === 'click') {
      while (actions[i + 1 + dialogs.length]?.tip === 'confirma') dialogs.push(raspunsDialog(actions[i + 1 + dialogs.length]))
    }
    const dialog = dialogs.length ? dialogs : null
    const obs = await actiuneUI(driver, action, { ...options, dialog })
    if (obs) observatii.push(obs)
    i += dialogs.length // Consumate prin evenimente CDP, înainte să se termine clickul.
  }
  return observatii
}

export async function actiuneUI(driver, action, { readOnly = false, dialog = null } = {}) {
  if (!action || !['click', 'scrie', 'asteapta', 'incarca', 'confirma', 'observa'].includes(action.tip)) throw new Error('Acțiune UI lipsă/invalidă; nu se execută JS arbitrar din fixture')
  if (readOnly && !['asteapta', 'observa'].includes(action.tip)) throw new Error('Comparația acceptă numai observații UI')
  if (action.tip === 'confirma') throw new Error('confirma trebuie să urmeze imediat clickului în rețetă')
  if (typeof action.selector !== 'string' || !action.selector) throw new Error('Selectorul trebuie completat după clonare')
  if (action.tip === 'asteapta') return driver.asteapta(action.selector, action.ms || 15000)
  if (action.tip === 'observa') {
    const observed = await driver.observa(action.selector)
    if (!action.asteptat || !Object.keys(action.asteptat).length) throw new Error('Observație fără rezultat așteptat')
    const trece = Object.entries(action.asteptat).every(([key, value]) => observed[key] === value)
    const la_esec = action.la_esec || 'PARTIAL'
    if (!VERDICTE.includes(la_esec) || la_esec === 'MATCH') throw new Error('Verdict UI la eșec invalid')
    return { tip: 'observa', selector: action.selector, observat: observed, trece, la_esec }
  }
  if (action.tip === 'incarca') {
    if (!action.fisiere?.length) throw new Error('Lipsesc fișierele locale pentru upload')
    return driver.incarca(action.selector, action.fisiere.map(f => resolve(f)))
  }
  if (action.tip === 'scrie') return driver.scrie(action.selector, action.text)
  return driver.click(action.selector, dialog)
}

export async function ruleaza(pas, args = process.argv.slice(2), deps = {}) {
  const contract = contracte[pas]
  const fixturePath = args.includes('--fixture') ? args[args.indexOf('--fixture') + 1] : join(root, 'scripts/audit-v2/fixture.json')
  const fixture = retete(JSON.parse(await readFile(fixturePath, 'utf8')))
  if (!contract) throw new Error('Scenariu invalid')
  const cfg = fixture.scenarii?.[pas] || {}
  const selectie = selecteazaFaze(contract, cfg, args)
  if (!args.includes('--apply') || args.includes('--dry-run')) {
    console.log(JSON.stringify({ mod: 'preview', pas, contract, ...selectie, configurat: cfg, mesaj: 'Nicio conexiune, nicio scriere. --apply numai după GO; fiecare fază cere acțiuni UI și aserțiuni concrete.' }, null, 2))
    return { verdict: 'UNDETERMINED', preview: true }
  }
  const dir = deps.dir || join(root, 'docs/AUDIT_OFERTARE_V2/dovezi', pas, new Date().toISOString().replace(/[:.]/g, '-'))
  await mkdir(dir, { recursive: true })
  const raport = { pas, verdict: 'UNDETERMINED', faze: [], limite: [], inceput: new Date().toISOString(), ...selectie }
  const drivers = []; let db; let inainte
  try {
    if (!selectie.selectate.length) throw new Error('Nicio fază fără AI selectată; fazele AI cer --allow-ai după GO de buget')
    db = deps.db || clientDinEnv()
    const lic = await citesteLicitatia(db, fixture.licitatie_id)
    verificaSandbox(lic, fixture) // ÎNAINTE de orice conexiune CDP / UI, inclusiv navigare.
    inainte = await snapshot(db, fixture, contract)
    verificaIds(fixture, inainte.tabele.ofertare_cerinte || [])
    await salveazaJson(dir, 'preconditii', inainte)
    if (contract.readOnly) {
      const gt = fixture.ground_truth_json ? JSON.parse(await readFile(fixture.ground_truth_json, 'utf8')) : []
      await salveazaJson(dir, 'matrice-P4', comparaGroundTruth(inainte, gt))
      if (!gt.length) throw new Error('Ground truth indisponibil: matricea P4 este UNDETERMINED')
    }
    if (eroriBlocante(inainte).length) throw new Error('Precondiții necitite complet; consultați erorile din dovezi')
    const preconditii = contract.restart && args.includes('--resume') ? cfg.preconditii_reluare : cfg.preconditii
    const pre = verdictAsertiuni(preconditii, inainte, inainte)
    if (pre.verdict !== 'MATCH' && !pre.doarAuxiliare) throw new Error('Precondiții lipsă sau neîndeplinite (la --resume se folosesc preconditii_reluare)')
    if (pre.doarAuxiliare) raport.limite.push('Precondiții auxiliare nedeterminate: SELECT refuzat de RLS; verificările independente continuă.')
    const connect = deps.conecteaza || conecteaza
    const c = await connect(fixture.cdp_port, fixture.cdp_target_id, { appUrl: fixture.app_url }); drivers.push(c)
    if (fixture.app_url && await c.evalueaza('location.origin') !== new URL(fixture.app_url).origin) throw new Error('Tabul CDP nu este aplicația configurată')
    // Sesiunea este deja autentificată. Operatorul deschide fișa clonei; nu selectăm după titlul copiat al licitației 5.
    await verificaContextUI(c, lic, cfg.context_ui || fixture.context_ui)
    if (contract.concurenta) {
      const obj = cfg.obiect
      if (!obj || obj.tabela !== contract.obiect || !inainte.tabele[obj.tabela]?.some(r => r.id === obj.id)) throw new Error('Obiectul concurent nu aparține clonei/D1,D6,D8')
      const samePort = Number(fixture.cdp_port_2 || fixture.cdp_port) === Number(fixture.cdp_port)
      const c2 = await connect(fixture.cdp_port_2 || fixture.cdp_port, fixture.cdp_target_id_2,
        { appUrl: fixture.app_url, excludeTarget: samePort ? c.target : null })
      drivers.push(c2)
      if (c.target === c2.target && samePort) throw new Error('Concurența cere două taburi distincte, nu două socket-uri către același DOM')
      if (await c.evalueaza('location.origin') !== await c2.evalueaza('location.origin')) throw new Error('Cele două sesiuni au origini diferite')
      await verificaContextUI(c2, lic, cfg.context_ui || fixture.context_ui)
    }
    let start = 0
    if (contract.restart && args.includes('--resume')) {
      const markerFile = args[args.indexOf('--resume') + 1]
      const marker = JSON.parse(await readFile(markerFile, 'utf8'))
      if (marker.pas !== pas || marker.licitatie_id !== fixture.licitatie_id || marker.fixture_hash !== createHash('sha256').update(JSON.stringify(fixture)).digest('hex')) throw new Error('Checkpoint incompatibil cu fixture-ul')
      // Folosim snapshotul inițial din marker pentru a detecta dubluri apărute peste restart.
      inainte = await incarcaJson(dirname(resolve(markerFile)), marker.snapshot_initial); start = 1
    }
    for (let i = start; i < contract.faze.length; i++) {
      const nume = contract.faze[i]; const phase = cfg.faze?.[nume]
      if (!selectie.selectate.includes(nume)) continue
      if (!phase?.actiuni?.length || !phase.postconditii?.length) {
        raport.faze.push({ nume, verdict: 'UNDETERMINED', motiv: phase?.motiv_indisponibil || 'Acțiuni/selectori/postcondiții concrete necompletate' }); break
      }
      verificaSandbox(await citesteLicitatia(db, fixture.licitatie_id), fixture)
      for (const d of drivers) await verificaContextUI(d, lic, phase.context_ui || cfg.context_ui || fixture.context_ui)
      const before = contract.restart && start === 1 && i === 1 ? inainte : await snapshot(db, fixture, contract)
      if (phase.preconditii?.length && verdictAsertiuni(phase.preconditii, before, before).verdict !== 'MATCH') throw new Error('Precondițiile fazei nu sunt îndeplinite')
      await salveazaJson(dir, `${i + 1}-${nume}-inainte`, before)
      await c.captura(join(dir, `${i + 1}-${nume}-inainte.png`))
      const jurnalStart = c.jurnal().length
      const observatii = []
      if (contract.concurenta) {
        if (!phase.actiuni_2?.length || !phase.pregatire?.length || !phase.pregatire_2?.length) throw new Error('Concurența cere pregătire în ambele taburi și două liste de salvare')
        // Barieră: ambele formulare trebuie încărcate/editate înaintea primei salvări.
        for (const obs of await Promise.all(drivers.map((d, n) => actiuniUI(d, n ? phase.pregatire_2 : phase.pregatire, contract)))) observatii.push(...obs)
        for (const obs of await Promise.all(drivers.map((d, n) => actiuniUI(d, n ? phase.actiuni_2 : phase.actiuni, contract)))) observatii.push(...obs)
      } else observatii.push(...await actiuniUI(c, phase.actiuni, contract))
      if (phase.asteapta) await c.asteapta(phase.asteapta, phase.timeout_ms || 30000)
      const after = await snapshot(db, fixture, contract)
      await salveazaJson(dir, `${i + 1}-${nume}-dupa`, after)
      for (let n = 0; n < drivers.length; n++) await drivers[n].captura(join(dir, `${i + 1}-${nume}-dupa-${n + 1}.png`))
      const rezultat = eroriBlocante(after).length || eroriBlocante(before).length
        ? { verdict: 'UNDETERMINED', motiv: 'Eroare citire BD' } : verdictAsertiuni(phase.postconditii, before, after)
      if ((rezultat.verdict === 'MATCH' || rezultat.doarAuxiliare) && observatii.some(o => o.trece === false)) {
        rezultat.verdict = observatii.find(o => o.trece === false).la_esec
        rezultat.doarAuxiliare = false
      }
      const cereri = c.jurnal().slice(jurnalStart)
      if (rezultat.verdict === 'MATCH' && phase.refuz_server && !verificaRefuzServer(phase.refuz_server, cereri)) {
        rezultat.verdict = 'UNDETERMINED'; rezultat.motiv = 'Lipsește cererea server respinsă și finalizată a acestei faze'
      }
      if (rezultat.verdict === 'MATCH' && phase.verdict_succes) rezultat.verdict = phase.verdict_succes
      raport.faze.push({ nume, cost_ai: phase.cost_ai, ...rezultat, observatii, cereri, limita: phase.limita })
      if (contract.restart && i === 0) {
        await salveazaJson(dir, 'checkpoint', { pas, licitatie_id: fixture.licitatie_id,
          fixture_hash: createHash('sha256').update(JSON.stringify(fixture)).digest('hex'), snapshot_initial: `${i + 1}-${nume}-inainte`, snapshot_dupa_pornire: `${i + 1}-${nume}-dupa` })
        raport.limite.push('PAUZĂ — Claude repornește workerul. Reluare cu --apply --resume <checkpoint.json>; driverul nu repornește servicii.')
        console.log(raport.limite.at(-1)); break
      }
      if (rezultat.verdict !== 'MATCH' && !rezultat.doarAuxiliare) break
    }
    raport.verdict = raport.faze.find(p => p.verdict !== 'MATCH' && !p.doarAuxiliare)?.verdict
      || raport.faze.find(p => p.verdict !== 'MATCH')?.verdict
      || (raport.faze.length === selectie.selectate.length - start && !raport.limite.length ? 'MATCH' : 'UNDETERMINED')
    raport.semnificatie = 'MATCH se referă strict la aserțiunile enumerate, nu certifică modulul sau întregul lanț.'
    if (pas === '06_cantitati') raport.limite.push('ofertare_r5_blocaj_sursa este funcție SQL, nu tabel. Verificatorul SELECT-only nu o apelează; blocarea se observă prin UI și read-back al stării pachetului.')
  } catch (e) {
    raport.eroare = e.message; raport.verdict = 'UNDETERMINED'
    // Read-back și când UI-ul a eșuat, inclusiv după o mutație parțială.
    if (db && inainte) try { await salveazaJson(dir, 'dupa-eroare', await snapshot(db, fixture, contract)) } catch { /* Eroarea inițială rămâne vizibilă. */ }
  } finally {
    for (let i = 0; i < drivers.length; i++) {
      await salveazaJson(dir, `dialoguri-${i + 1}`, drivers[i].dialoguri?.() || [])
      await salveazaJson(dir, `jurnal-${i + 1}`, drivers[i].jurnal()); drivers[i].inchide()
    }
    await salveazaJson(dir, 'verdict', raport)
  }
  console.log(`${pas}: ${raport.verdict} — ${dir}`)
  if (raport.verdict !== 'MATCH') process.exitCode = 2
  return raport
}
