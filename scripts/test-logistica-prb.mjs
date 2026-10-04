import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse } from '@babel/parser'
import { matchWhatsAppUnic, sursaBonComunValida, identitateBonComun, recalculeazaPret, rezultatPoza, salveazaIntrariService } from '../src/lib/logisticaPrB.js'

// Executam si handler-ele reale din JSX cu dependente simulate, fara BD/retea.
const sources = Object.fromEntries(['Logistica', 'ServiceTab', 'ImportWhatsAppModal', 'ImportRompetrolModal'].map(name => [name, readFileSync(new URL(`../src/${name}.jsx`, import.meta.url), 'utf8')]))
const trees = Object.fromEntries(Object.entries(sources).map(([name, source]) => [name, parse(source, { sourceType: 'module', plugins: ['jsx'] })]))
function find(node, predicate) {
  if (!node || typeof node !== 'object') return null
  if (predicate(node)) return node
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) { for (const child of value) { const found = find(child, predicate); if (found) return found } }
    else if (value && typeof value === 'object') { const found = find(value, predicate); if (found) return found }
  }
  return null
}
function handler(file, name, scope) {
  const node = find(trees[file], n => (n.type === 'VariableDeclarator' || n.type === 'FunctionDeclaration') && n.id?.name === name)
  assert.ok(node, name)
  const fn = node.type === 'FunctionDeclaration' ? node : node.init
  return new Function(...Object.keys(scope), `return (${sources[file].slice(fn.start, fn.end)})`)(...Object.values(scope))
}

test('toate cele patru fisiere JSX se parseaza', () => assert.equal(Object.keys(trees).length, 4))

const alim = (id, date, active_id = 1) => ({ id, data_alimentare: date, active_id })
const msg = (hash, date, id = 1) => ({ hash, dt: new Date(date), parsed: { vehicle: { id }, site: { id: 3 }, score: 1, formatStrict: true } })
test('J8: mesaj unic pentru cea mai apropiata alimentare, indiferent de ordinea BD', () => {
  const rows = [alim(1, '2026-10-01'), alim(2, '2026-10-03')]
  for (const list of [rows, [...rows].reverse()]) {
    const matches = matchWhatsAppUnic(list, [msg('a', '2026-10-03T01:00:00Z')])
    assert.equal(matches.length, 1); assert.equal(matches[0].alim.id, 2)
  }
})
test('J8: hash repetat, vehicul diferit, mesaj fara santier si fereastra depasita', () => {
  const m = msg('a', '2026-10-03')
  assert.equal(matchWhatsAppUnic([alim(1, '2026-10-03'), alim(2, '2026-10-03')], [m, { ...m }]).length, 1)
  assert.equal(matchWhatsAppUnic([alim(1, '2026-10-03', 2)], [m]).length, 0)
  assert.equal(matchWhatsAppUnic([alim(1, '2026-09-28')], [m]).length, 0)
  assert.equal(matchWhatsAppUnic([alim(1, '2026-10-03')], [{ ...m, parsed: { vehicle: { id: 1 } } }]).length, 0)
})
test('J10: Oscar nu ajunge la insert si mesajul explica sursele acceptate', async () => {
  let message
  await handler('Logistica', 'handleLeagaBon', { alim: { qr_sursa: 'oscar' }, sursaBonComunValida, showToast: text => { message = text } })()
  assert.match(message, /Rompetrol.*benzinarie.*oscar/)
  assert.equal(sursaBonComunValida('rompetrol'), true)
  assert.equal(sursaBonComunValida('benzinarie'), true)
})
test('J11: acelasi volum/data nu poate selecta bonul altui vehicul sau card', () => {
  const findBon = handler('ImportRompetrolModal', 'findBonComunMatch', { identitateBonComun })
  const wrong = { bon_comun_id: 1, active_ids: [9], total_litri_bon: 50, data_min: '2026-10-03' }
  const right = { ...wrong, bon_comun_id: 2, active_ids: [1] }
  assert.equal(findBon([wrong, right], new Set(), 50, '2026-10-03', 1, null).bon_comun_id, 2)
  assert.equal(findBon([wrong], new Set(), 50, '2026-10-03', 1, null), null)
  assert.equal(identitateBonComun({ card_combustibil: 'GAZPET1' }, null, 'GAZPET2'), 'exclus')
  assert.equal(identitateBonComun({}, null, null), 'confirmare')
})
test('J11: refuzul confirmarii opreste importul inainte de prima scriere', async () => {
  let confirms = 0
  await handler('ImportRompetrolModal', 'handleImport', {
    matchResults: { matched: [], carduriFaraQR: [], qrMatched: [{ is_bon_comun: true, necesita_confirmare: true, cod_bon: '1234', sursa_linie: 'GAZPET1', data: '2026-10-03', litri: 50 }] },
    window: { confirm: text => { confirms++; assert.match(text, /1234/); return false } },
    setImporting: () => assert.fail('import pornit fara confirmare'),
  })()
  assert.equal(confirms, 1)
})

function serviceDb(insertResult, deleteResult, throws = false) {
  const calls = []
  return { calls, from(table) {
    calls.push(table)
    return { insert: async () => { if (throws) throw new Error('network'); return insertResult },
      delete: () => ({ eq: (key, id) => { calls.push([key, id]); return { select: async () => deleteResult } } }),
    }
  } }
}
test('J14: esec intrari sterge exact fisa noua si propaga eroarea', async () => {
  const db = serviceDb({ error: { message: 'insert refuzat' } }, { data: [{ id: 42 }], error: null })
  await assert.rejects(salveazaIntrariService(db, 42, [{}]), /insert refuzat.*stearsa/)
  assert.deepEqual(db.calls.at(-1), ['id', 42])
})
test('J14: esec compensare sau zero randuri mentioneaza fisa incompleta', async () => {
  for (const result of [{ error: { message: 'RLS' } }, { data: [], error: null }]) {
    const db = serviceDb({ error: { message: 'insert refuzat' } }, result)
    await assert.rejects(salveazaIntrariService(db, 42, [{}]), /#42.*incompleta.*Compensare esuata/)
  }
})
test('J14: succes nu sterge; exceptia de transport incearca compensarea', async () => {
  const db = serviceDb({ error: null })
  await salveazaIntrariService(db, 42, [{}]); assert.equal(db.calls.length, 1)
  await assert.rejects(salveazaIntrariService(serviceDb(null, { data: [{ id: 42 }] }, true), 42, [{}]), /network.*stearsa/)
})
test('J15: UPDATE rapid pastreaza parintele montat; UPDATE esuat nu porneste avizul', async () => {
  for (const error of [null, { message: 'refuzat' }]) {
    const events = []
    const fn = handler('Logistica', 'handleSchimbaStatus', {
      T: { id: 1, aviz_generat: false }, confirm: () => true,
      supabase: { from: () => ({ update: () => ({ eq: async () => ({ error }) }) }) },
      setAvizDupaTranzit: () => {}, setActionLoading: () => {}, showToast: text => events.push(text),
      setAutoAviz: value => events.push(['auto', value]), setShowAviz: value => events.push(['show', value]),
      onClose: () => assert.fail('parinte demontat inainte de aviz'), onChanged: () => assert.fail('refresh prematur'),
    })
    await fn('in_tranzit')
    assert.equal(events.some(e => Array.isArray(e) && e[0] === 'auto'), !error)
    assert.equal(events.some(e => typeof e === 'string' && e.includes('aviz generat automat!')), false)
  }
})
test('J15: rezultatul callbackului inchide numai la succesul arhivarii', () => {
  const attr = find(trees.Logistica, n => n.type === 'JSXAttribute' && n.name.name === 'onAutoArhivat')
  const fn = attr.value.expression
  for (const ok of [false, true]) {
    const events = []
    const callback = new Function('setAutoAviz', 'setShowAviz', 'onChanged', 'onClose', `return (${sources.Logistica.slice(fn.start, fn.end)})`)(() => {}, () => events.push('hide'), () => events.push('refresh'), () => events.push('close'))
    callback(ok)
    assert.deepEqual(events, ok ? ['hide', 'refresh', 'close'] : [])
  }
})
test('J15: arhivarea raporteaza succes numai dupa upload, insert si update reusite', async () => {
  for (const fail of [null, 'upload', 'insert', 'update']) {
    const events = []
    const result = step => ({ error: step === fail ? { message: `${step} refuzat` } : null })
    const fn = handler('Logistica', 'handleArhivare', {
      T: { id: 1, numar_transport: 'TRP-1', data_transport: '2026-10-04' }, profile: { id: 'user' },
      setArhivareLoading: () => {}, showToast: text => events.push(text), console: { error: () => {} },
      supabase: {
        storage: { from: () => ({ upload: async () => result('upload') }) },
        from: () => ({
          select: () => ({ eq: () => ({ single: async () => ({ data: {}, error: null }) }) }),
          insert: async () => result('insert'), update: () => ({ eq: async () => result('update') }),
        }),
      },
      document: { querySelector: () => ({}) }, html2canvas: async () => ({ height: 297, width: 210, toDataURL: () => 'data:' }),
      jsPDF: class { addImage() {} output() { return new Blob(['pdf']) } },
      compressFileBeforeUpload: async file => file, formatLocatie: () => 'locatie', onTrimisEmail: () => events.push('refresh'),
    })
    assert.equal(await fn(true), fail === null)
    assert.equal(events.includes('refresh'), fail === null)
    assert.equal(events.some(e => e.includes('Aviz arhivat AUTOMAT')), fail === null)
  }
})
test('J18: baza sosita tarziu si schimbata recalculeaza totalul', () => {
  let form = { cantitate_litri: '10', pret_per_litru: '', pret_total: '' }
  form = recalculeazaPret(form, null, 7)
  assert.equal(form.pret_total, '70.00')
  form = recalculeazaPret(form, null, 8)
  assert.equal(form.pret_total, '80.00')
  assert.equal(recalculeazaPret(form, null, 8), form)
})
test('J18: pret sau total manual are prioritate si ajunge la punct fix fara bucla', () => {
  const form = { cantitate_litri: '10', pret_per_litru: '9', pret_total: '70' }
  const fromPrice = recalculeazaPret(form, 'pret', 8)
  assert.equal(fromPrice.pret_total, '90.00')
  assert.equal(recalculeazaPret(fromPrice, 'pret', 8), fromPrice)
  const fromTotal = recalculeazaPret({ ...form, pret_total: '95' }, 'total', 8)
  assert.equal(fromTotal.pret_per_litru, '9.5000')
  assert.equal(recalculeazaPret(fromTotal, 'total', 8), fromTotal)
  assert.equal(recalculeazaPret({ ...form, pret_total: '' }, 'total', 8).pret_per_litru, '')
})
test('Nit: stare_schimbata numarata la sarite, separat de succes/eroare', () => {
  const totals = { uploaded: 0, skipped: 0, errors: 0 }
  for (const r of [{ ok: true }, { ok: false, reason: 'stare_schimbata' }, { ok: false, reason: 'update_error' }]) totals[rezultatPoza(r)]++
  assert.deepEqual(totals, { uploaded: 1, skipped: 1, errors: 1 })
})
