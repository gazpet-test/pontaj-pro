import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { FAZE, ERORI, codEroare, mesajEroare, programCitire, fazaUrmatoare, formularActiune, ceLipseste, pregatestePayload, pregatesteCreare, confirmaSalt, operatieValida } from './probeTerenLogica.js'

const aer = { id: 7, tip_fluid: 'aer', faza_curenta: 'proba' }
const apa = { id: 8, tip_fluid: 'apa', faza_curenta: 'presurizare' }
const utilaj = { active_id: '4', rol: 'compresor', ore_bord: '120.5', poza_path: 'teren/7/bord.jpg' }
const form = (proba = aer, actiune = 'citire') => ({ proba, actiune, presiune: '5.25', poza: `teren/${proba.id}/man.jpg`, utilaje: proba.tip_fluid === 'apa' ? [] : [utilaj], observatii: '' })
const ora = '2026-10-26T00:00:00Z'
const log = (faza, limita_faza = true, offset = 0) => ({ faza, limita_faza, ora_citire: new Date(Date.parse(ora) + offset * 3600000).toISOString(), presiune_citita_bar: 5 })
const contine = (lista, element) => assert.ok(lista.includes(element), `${element} lipseste din ${lista.join(', ')}`)
const sql = ['20261114a_probe_teren.sql', '20261115a_probe_teren_faze.sql'].map(path => readFileSync(new URL(`../supabase/migrations/${path}`, import.meta.url), 'utf8')).join('\n')

describe('erori server', () => {
  it('traduce toate codurile din contractele SQL E1/E2a', () => {
    for (const code of new Set(sql.match(/pt_[a-z_]+(?=:)/g))) assert.ok(ERORI[code], code)
  })
  it('separa reteaua de refuzul serverului si schema absenta', () => {
    assert.equal(codEroare({ message: 'pt_bord_salt: mare' }), 'pt_bord_salt')
    assert.equal(mesajEroare({ message: 'Failed to fetch' }), 'Nu s-a trimis, reincerc')
    assert.equal(mesajEroare({ code: 'PGRST202', message: 'missing' }), ERORI.pt_schema)
    assert.equal(mesajEroare({ message: 'pt_bord_scade: 1 < 2' }), ERORI.pt_bord_scade)
  })
})
describe('faze si programul citirilor', () => {
  it('respecta ordinea si capatul ambelor fluxuri', () => {
    for (const fluid of ['aer', 'apa']) FAZE[fluid].forEach((f, i) => assert.equal(fazaUrmatoare({ tip_fluid: fluid, faza_curenta: f }), FAZE[fluid][i + 1] || null))
  })
  it('6h pana la citire, intarziere strict peste 8h; ignora alte faze', () => {
    const logs = [log('proba'), log('calibrare', true, 2)]
    const at = h => programCitire(aer, logs, Date.parse(ora) + h * 3600000)
    assert.equal(at(5).ramaseMs, 3600000)
    assert.equal(at(6).ramaseMs, 0)
    assert.equal(at(8).intarziata, false)
    assert.equal(at(8.01).intarziata, true)
    assert.equal(programCitire({ ...aer, faza_curenta: 'uscare' }, logs).urmatoarea, null)
    assert.equal(programCitire(aer, []).urmatoarea, null)
    assert.equal(programCitire(aer, [...logs, log('proba', false, 6)], Date.parse(ora) + 7 * 3600000).ramaseMs, 5 * 3600000)
  })
  it('hidraulic: umplere fara citiri, jumatate la 3h de la prima; apoi numai final', () => {
    assert.equal(programCitire({ ...apa, faza_curenta: 'umplere' }, []).urmatoarea, null)
    assert.equal(programCitire(apa, [log('presurizare')], Date.parse(ora)).ramaseMs, 3 * 3600000)
    assert.equal(programCitire(apa, [log('presurizare'), log('presurizare', false, 3)]).urmatoarea, null)
    assert.equal(programCitire(apa, [log('presurizare')], Date.parse(ora) + 9 * 3600000).intarziata, false)
  })
})
describe('dovezi si payload RPC', () => {
  it('formularul de inchidere pastreaza rezultatul ales si goleste dovezile vechi', () => {
    const f = formularActiune(aer, 'inchide', 'respins', [utilaj])
    assert.equal(f.rezultat, 'respins')
    assert.equal(f.utilaje[0].poza_path, '')
    contine(ceLipseste(f), 'Motiv respingere')
  })
  it('aer: fiecare limita cere manometru si contoare; zero este valoare valida', () => {
    for (const actiune of ['porneste', 'schimba_faza', 'citire', 'inchide']) {
      const f = { ...form(aer, actiune), rezultat: 'admis' }
      assert.deepEqual(ceLipseste(f), [])
      const lipsuri = ceLipseste({ ...f, poza: '', presiune: '', utilaje: [{ ...utilaj, ore_bord: '', poza_path: '' }] })
      for (const lipsa of ['Presiune valida', 'Poza manometru', 'Ore bord utilaj', 'Poza ceas utilaj']) contine(lipsuri, lipsa)
    }
    assert.deepEqual(ceLipseste({ ...form(), presiune: 0, utilaje: [{ ...utilaj, ore_bord: 0 }] }), [])
    contine(ceLipseste({ ...form(), presiune: Infinity }), 'Presiune valida')
    contine(ceLipseste({ ...form(aer, 'porneste'), utilaje: [] }), 'Cel putin un utilaj')
    assert.throws(() => pregatestePayload({ ...form(), presiune: -1 }, 'invalid'))
  })
  it('hidraulic: pornire si respins umplere fara dovezi; motiv obligatoriu', () => {
    const umplere = { ...apa, faza_curenta: 'umplere' }
    const f = { ...form(umplere, 'porneste'), presiune: '', poza: '' }
    assert.deepEqual(ceLipseste(f), [])
    assert.equal(pregatestePayload(f, 'start').args.p_presiune_bar, null)
    contine(ceLipseste({ ...f, actiune: 'inchide', rezultat: 'respins' }), 'Motiv respingere')
    assert.deepEqual(ceLipseste({ ...f, actiune: 'inchide', rezultat: 'respins', observatii: 'Pierdere' }), [])
    contine(ceLipseste({ ...f, actiune: 'schimba_faza' }), 'Poza manometru')
    contine(ceLipseste({ ...form(apa, 'inchide'), rezultat: 'respins', poza: '', observatii: 'Pierdere' }), 'Poza manometru')
  })
  it('pompele nu transmit ore sau poze; admis cere faza finala', () => {
    const op = pregatestePayload({ ...form(apa), utilaje: [utilaj] }, 'apa')
    assert.deepEqual(op.args.p_utilaje[0], { active_id: 4, rol: 'pompa', ore_bord: null, poza_path: null })
    contine(ceLipseste({ ...form({ ...aer, faza_curenta: 'uscare' }, 'inchide'), rezultat: 'admis' }), 'Faza finala')
  })
  it('oprire si inlocuitor atomic, fara timpi client sau duplicate', () => {
    const op = pregatestePayload({ ...form(aer, 'opreste_utilaj'), motiv: 'inlocuit', inlocuitor: { ...utilaj, active_id: 9, poza_path: 'teren/7/nou.jpg' } }, 'oprire')
    assert.equal(op.nom, 'fn_probe_opreste_utilaj')
    assert.equal(op.args.p_poza, utilaj.poza_path)
    assert.equal(op.args.p_inlocuitor.active_id, 9)
    assert.equal(Object.keys(op.args).some(k => /ora|timp|data/.test(k)), false)
    contine(ceLipseste({ ...form(), inlocuitor: utilaj }), 'Utilaje duplicate')
  })
  it('retry identic; confirmarea pastreaza cheia si pozele fara mutarea originalului', () => {
    const op = pregatestePayload(form(aer, 'porneste'), 'uuid-constant')
    assert.deepEqual(JSON.parse(JSON.stringify(op)), op)
    const confirmat = confirmaSalt(op, 'Contor verificat')
    assert.equal(confirmat.args.p_cheie, op.args.p_cheie)
    assert.deepEqual(confirmat.args.p_utilaje[0], { ...op.args.p_utilaje[0], confirma_salt: true, motiv_salt: 'Contor verificat' })
    assert.equal(op.args.p_utilaje[0].confirma_salt, undefined)
    assert.throws(() => confirmaSalt(op, '  '))
    assert.equal(operatieValida(op), true)
    assert.equal(operatieValida({ nom: 'arbitrary', args: op.args }), false)
    const stop = pregatestePayload({ ...form(aer, 'opreste_utilaj'), motiv: 'defect', inlocuitor: { ...utilaj, active_id: 9 } }, 'stop')
    const c = confirmaSalt(stop, 'verificat')
    assert.equal(c.args.p_confirma_salt, true)
    assert.equal(c.args.p_inlocuitor.confirma_salt, true)
    assert.equal(c.args.p_cheie, 'stop')
  })
  it('payload-urile au exact argumentele semnaturilor SQL', () => {
    for (const actiune of ['porneste', 'citire', 'schimba_faza', 'inchide', 'opreste_utilaj']) {
      const op = pregatestePayload({ ...form(aer, actiune), rezultat: 'admis', motiv: 'terminat' }, 'contract')
      const signature = new RegExp(`FUNCTION public\\.${op.nom}\\(([^)]+)\\)`).exec(sql)[1]
      const names = signature.split(',').map(p => p.trim().split(' ')[0])
      assert.deepEqual(Object.keys(op.args).sort(), names.sort(), op.nom)
    }
  })
})

describe('creare pe teren', () => {
  const baza = { proiect: '12', tronson: '', nrTronsoane: 0, fluid: 'apa', beneficiar: 'gazpet' }
  it('0 sau 1 tronsoane nu obliga selectie; minimum 2 obliga', () => {
    const op = pregatesteCreare(baza, 'creare-uuid')
    assert.equal(op.args.p_tronson_id, null)
    assert.equal(op.args.p_tert_ref_tip, null)
    assert.equal(pregatesteCreare({ ...baza, nrTronsoane: 1 }, 'unu').args.p_tronson_id, null)
    assert.throws(() => pregatesteCreare({ ...baza, nrTronsoane: 2 }, 'doi'))
    assert.equal(pregatesteCreare({ ...baza, nrTronsoane: 2, tronson: '13' }, 'doi').args.p_tronson_id, 13)
    assert.deepEqual(pregatesteCreare(baza, 'creare-uuid'), op)
  })
  it('tert cere proiect, client si referinta; curata campurile incompatibile', () => {
    const tert = { ...baza, beneficiar: 'tert', referintaTip: 'comanda', comanda: '  ABC  ', client: '  Client  ', referintaId: 99 }
    assert.throws(() => pregatesteCreare({ ...tert, proiect: '' }, 'x'))
    assert.throws(() => pregatesteCreare({ ...tert, comanda: 'ab' }, 'x'))
    assert.throws(() => pregatesteCreare({ ...tert, client: '' }, 'x'))
    const op = pregatesteCreare(tert, 'tert')
    assert.equal(op.args.p_tert_ref_text, 'ABC')
    assert.equal(op.args.p_tert_ref_id, null)
    assert.equal(op.args.p_tert_client, 'Client')
    const contract = pregatesteCreare({ ...tert, referintaTip: 'contract' }, 'contract')
    assert.equal(contract.args.p_tert_ref_id, 99)
    assert.equal(contract.args.p_tert_ref_text, null)
  })
  it('argumentele crearii respecta semnatura E2a', () => {
    const op = pregatesteCreare(baza, 'contract')
    const signature = /FUNCTION public\.fn_probe_creeaza_teren\(([^)]+)\)/.exec(sql)[1]
    assert.deepEqual(Object.keys(op.args).sort(), signature.split(',').map(p => p.trim().split(' ')[0]).sort())
  })
})