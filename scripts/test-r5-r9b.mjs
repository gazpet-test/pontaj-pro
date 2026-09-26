// Verificare locală fără dependențe. Suplimentară, nu înlocuiește Vitest / PGlite.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { clasaUnitate } from '../src/ofertareUnitati.js'
import { controlTotaluri } from '../src/ofertareTotaluri.js'
import { controlCantitatiGrafic, controlFronturiGrafic, fronturiDinCantitati, randuriLipsa, categoriiRetea } from '../src/ofertareCantitatiAprobare.js'
import { stareBazaCiorna, deExportat } from '../src/ofertareClarificariBaza.js'
import { controlSursaAprobareFinala } from '../src/ofertarePoarta.js'

const r = (id, cantitate, extra = {}) => ({ id, licitatie_id: 1, obiect: 'Lot A', categorie: 'Conducte', sursa: 'Document #8',
  tip_sursa: 'lista_f3', denumire: 'Tronson A', status: 'validat', um: 'm', cantitate, ...extra })
const sql = readFileSync(new URL('../docs/R5_MIGRARE_PROPUSA_cantitati_nevalidate.sql', import.meta.url), 'utf8')

test('Maparea efectivă SQL = JS, inclusiv factorii și unitățile necunoscute', () => {
  const f = sql.split('CREATE OR REPLACE FUNCTION public.ofertare_clasa_unitate(')[1].split('$function$;')[0]
  const reguli = [...f.matchAll(/WHEN u (?:IN \(([^)]+)\)|= '([^']+)') THEN jsonb_build_object\('tip','([^']+)'(?:,'factor',(\d+))?\)/g)]
  assert.equal(reguli.length, 4)
  for (const regula of reguli) {
    const unitati = regula[1] ? [...regula[1].matchAll(/'([^']+)'/g)].map(x => x[1]) : [regula[2]]
    for (const u of unitati) assert.deepEqual(clasaUnitate(u), { tip: regula[3], ...(regula[4] ? { factor: Number(regula[4]) } : {}) })
  }
  for (const u of [null, '', '100 m', 'sute m', 'neștiut']) assert.deepEqual(clasaUnitate(u), { tip: 'de_verificat' })
  assert.deepEqual(clasaUnitate(' M\u00a0'), { tip: 'lungime', factor: 1 })
})

test('Fronturile convertesc hm/km/ml și păstrează unitatea sursei', () => {
  const rows = [r(1, 2, { um: 'hm' }), r(2, 0.8, { um: 'km' }), r(3, 40, { um: 'm.l' })]
  const fronturi = fronturiDinCantitati(rows, '').fronturi
  assert.deepEqual(fronturi.map(f => f.lungime_m), [200, 800, 40])
  assert.equal(controlFronturiGrafic({ fronturi }, rows).stare, 'ok')
  assert.equal(controlFronturiGrafic({ fronturi }, rows.map(x => x.id === 1 ? { ...x, um: 'km' } : x)).stare, 'block')
  assert.equal(fronturiDinCantitati([r(1, 100)], 'plansa').fronturi.length, 0)
})

test('Unitățile neclare validate rămân în incomplet; mc rămâne separat', () => {
  for (const um of [null, '100 m', 'xyz']) {
    const rows = [r(1, 100), r(2, 10, { um })]
    assert.equal(controlCantitatiGrafic(rows, '').stare, 'block')
    assert.equal(randuriLipsa(rows, '').lipsa[0].motiv, 'unitate de verificat')
  }
  const rows = [r(1, 100), r(2, 80, { um: 'mc' })]
  assert.equal(randuriLipsa(rows, '').informativ.length, 1)
  assert.equal(fronturiDinCantitati(rows, '').fronturi.length, 1)
})

test('TOTAL comparabil egal/diferit, fără dublare sau alegere automată', () => {
  const rows = [r(1, 1200, { denumire: 'TOTAL' }), r(2, 1, { um: 'km' }), r(3, 2, { um: 'hm' })]
  assert.equal(controlTotaluri(rows)[0].stare, 'ok')
  rows[0].cantitate = 1200.1
  const t = controlTotaluri(rows)[0]
  assert.deepEqual([t.stare, t.declarat, t.suma_detalii], ['diferit', 1200.1, 1200])
  const fronturi = fronturiDinCantitati(rows, '').fronturi
  assert.equal(fronturi.length, 2)
  assert.equal(controlCantitatiGrafic(rows, '').stare, 'warn')
  assert.equal(controlFronturiGrafic({ fronturi }, rows).ref, null)
})

test('Detalii incomplete, TOTAL multiplu, alte surse/baze/perimetre', () => {
  const rows = [r(1, 100, { denumire: 'TOTAL' }), r(2, 100)]
  for (const patch of [{ cantitate: null }, { um: '100 m' }, { status: 'extras' }, { obiect: 'Lot B' }, { sursa: 'Document #9' }]) {
    assert.equal(controlTotaluri([rows[0], { ...rows[1], ...patch }])[0].stare, 'necomparabil')
  }
  assert.equal(controlTotaluri(rows, 'cantitate_plansa')[0].stare, 'necomparabil')
  assert.ok(controlTotaluri([...rows, r(3, 100, { denumire: 'TOTAL' })]).every(t => t.stare === 'necomparabil'))
})

test('Stările fără aprobare curentă, inclusiv luat_act, blochează exportul', () => {
  const q = { id: 1, cheie: 'auto_planse_1', status: 'de_trimis', intrebare: '123 m, scris de om' }
  for (const stare of ['schimbata', 'indisponibila', 'necesita_review', 'luat_act', 'necunoscut']) {
    assert.equal(stareBazaCiorna(q, new Map([[1, { stare }]]), null).blocheaza, true)
    assert.equal(deExportat([q], [{ id: 1, stare }], null).incluse.length, 0)
  }
  assert.equal(stareBazaCiorna({ ...q, _mod: true }, new Map([[1, { stare: 'ok' }]]), null).blocheaza, true)
  assert.equal(stareBazaCiorna(q, null, 'indisponibil').blocheaza, true)
})

test('Poarta finală: control lipsă, TOTAL diferit, unitate neclară blocate', () => {
  const st = { transfer_conflicte_docs: 0, transfer_in_curs: 0, totaluri_control: [], unitati_de_verificat: 0 }
  assert.equal(controlSursaAprobareFinala(st).stare, 'ok')
  assert.equal(controlSursaAprobareFinala({ ...st, totaluri_control: undefined }).stare, 'block')
  assert.equal(controlSursaAprobareFinala({ ...st, unitati_de_verificat: 1 }).stare, 'block')
  assert.equal(controlSursaAprobareFinala({ ...st, totaluri_control: [{ stare: 'diferit', text: 'TOTAL diferit' }] }).stare, 'block')
})

test('Generator fără cifre interpolate, parser eliminat, fără trigger de scanare la scriere', () => {
  const generator = sql.split('CREATE OR REPLACE FUNCTION public.ofertare_clarificare_planse_auto(')[1]
  const proza = generator.split('  v_text :=')[1].split('  v_baza_gen :=')[0]
  assert.doesNotMatch(proza, /v_f3|v_baza\s*->|cardinality|v_ilizibile\s*\|\||v_fara_date\s*\|\|/)
  assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public.ofertare_clarificare_mod_text/)
  assert.doesNotMatch(sql, /CREATE TRIGGER trg_zzz_ofertare_cantitati_clar_baza/)
})

test('Setul de regresie R9: contoare după conversiile explicite', () => {
  const rows = [r(1, 100, { status: 'extras' }), r(2, 0.8, { um: 'km', status: 'extras' }), r(3, null), r(4, 3, { um: '100 m' }), r(5, 4, { um: 'mc' })]
  const c = categoriiRetea(rows)
  assert.equal(c.retea_nevalidate, 2)
  assert.equal(c.retea_nevalidate_m, 900)
  assert.equal(c.retea_validate_fara_cant, 1)
  assert.equal(c.retea_alte_unitati, 2)
})
