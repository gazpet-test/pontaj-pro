// 04.10.2026 D1 prep: execută handler-ele reale cu BD/Storage simulate, fără acces extern.
// node --test --test-isolation=none scripts/test-d1-logistica-ui.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { removeLogisticaFiles } from '../src/utils/logisticaStorage.js'

const require = createRequire(import.meta.url)
const { parse } = require('@babel/parser')
const traverse = require('@babel/traverse').default
const files = ['Logistica', 'DocumenteFlotaPage', 'AmcSection', 'ServiceTab', 'ConfirmareAITab', 'PiesePozeSection', 'SupapeDeclaratiiSection']
const sources = Object.fromEntries(files.map(file => {
  const source = readFileSync(new URL(`../src/${file}.jsx`, import.meta.url), 'utf8')
  return [file, { source, ast: parse(source, { sourceType: 'module', plugins: ['jsx'] }) }]
}))
const ownerFunction = path => path.findParent(p => p.isFunctionDeclaration())?.node.id.name
function expression(file, component, name) {
  const { source, ast } = sources[file]
  let result
  traverse(ast, { VariableDeclarator(path) {
    if (path.node.id.name === name && ownerFunction(path) === component) {
      result = source.slice(path.node.init.start, path.node.init.end)
    }
  } })
  assert.ok(result, `${component}.${name} există`)
  return result
}
function evaluate(code, context) {
  return Function(...Object.keys(context), `return (${code})`)(...Object.values(context))
}
function handler(file, component, name, context) {
  return evaluate(expression(file, component, name), context)
}

function fixture({ dbError = false, zero = false, storageError = false, storageThrow = false, partial = false } = {}) {
  const events = [], toasts = []
  const row = { id: 1, pdf_url: 'old.pdf', pdf_path: 'old.pdf', storage_path: 'old.pdf', numar_aviz: 'AV1' }
  const supabase = {
    auth: { getUser: async () => ({ data: { user: { id: 'user' } } }) },
    storage: { from: () => ({
      upload: async path => { events.push(['upload', path]); return { error: null } },
      remove: async paths => {
        events.push(['remove', paths])
        if (storageThrow) throw new Error('Storage network')
        return { error: storageError ? new Error('Storage denied') : null }
      },
    }) },
    from: () => {
      let operation = 'read', single = false
      const query = {
        delete() { operation = 'delete'; return this },
        update() { operation = 'update'; return this },
        insert() { operation = 'insert'; return this },
        eq() { return this }, in() { return this }, gte() { return this }, lt() { return this }, select() { return this },
        single() { single = true; return this },
        then(resolve, reject) {
          events.push([operation])
          const error = operation !== 'read' && (dbError || (zero && single)) ? new Error('BD refuzată / zero rânduri') : null
          const data = zero && operation !== 'read' ? [] : single ? row : partial && operation === 'delete' ? [row] : [row, { ...row, id: 2, pdf_path: 'second.pdf' }]
          return Promise.resolve({ error, data }).then(resolve, reject)
        },
      }
      return query
    },
  }
  const noop = () => {}
  return { events, toasts, row, context: {
    supabase, removeLogisticaFiles, BUCKET: 'test', canDelete: true, canEdit: true, isEdit: true,
    doc: row, poze: { 1: [row] }, confirm: () => true, window: { confirm: () => true },
    showToast: (...args) => toasts.push(args), onSaved: noop, load: noop, loadArhiva: noop,
    setSaving: noop, setDeleting: noop, setConfirmDel: noop, setDownloadingId: noop, setShowDeleteLuna: noop,
    setBusy: noop, setEditSupapa: noop, activ: { id: 1 },
    slugify: value => value, compressFileBeforeUpload: async value => value,
    tipuri: [{ id: 1, nume: 'ITP' }], tipSelected: { nume: 'AMC' },
    form: { entitate_id: 1, tip_id: 1, denumire: 'AMC', numar_document: 'DOC', data_expirare: '2027-01-01',
      emitent: '', observatii: '', cost: '', serie: '', producator: '', model: '', clasa_presiune: '' },
    pdfFile: { name: 'new.pdf' }, removeExistingPdf: false,
  } }
}

test('JSX valid și fiecare referință canDelete/canEdit are o declarație în domeniul ei', () => {
  for (const [file, { ast }] of Object.entries(sources)) {
    traverse(ast, { ReferencedIdentifier(path) {
      if (['canDelete', 'canEdit'].includes(path.node.name)) {
        assert.ok(path.scope.hasBinding(path.node.name), `${file}:${path.node.loc.start.line} ${path.node.name}`)
      }
    } })
  }
})

for (const [file, component, name] of [
  ['DocumenteFlotaPage', 'DocumentFormModal', 'handleDelete'],
  ['AmcSection', 'AmcFormModal', 'handleDelete'],
  ['SupapeDeclaratiiSection', 'SupapeDeclaratiiSection', 'stergeSupapa'],
  ['PiesePozeSection', 'PiesePozeSection', 'stergePoza'],
  ['PiesePozeSection', 'PiesePozeSection', 'stergePiesa'],
  ['Logistica', 'ArhivaAvizePage', 'handleDelete'],
]) {
  for (const mode of ['dbError', 'zero', 'success', 'storageError', 'storageThrow']) {
    test(`${component}.${name}: ${mode}`, async () => {
      const f = fixture({ [mode]: true })
      await handler(file, component, name, f.context)(f.row)
      if (mode === 'dbError' || mode === 'zero') {
        assert.deepEqual(f.events.map(e => e[0]), ['delete'])
        assert.ok(f.toasts.some(t => t[1] === 'error'))
      } else {
        assert.deepEqual(f.events, [['delete'], ['remove', ['old.pdf']]])
        assert.ok(!f.toasts.some(t => t[1] === 'error'))
      }
    })
  }
}

for (const [file, component, name] of [
  ['DocumenteFlotaPage', 'DocumentFormModal', 'handleSave'],
  ['AmcSection', 'AmcFormModal', 'handleSave'],
  ['SupapeDeclaratiiSection', 'SupapeDeclaratiiSection', 'saveSupapa'],
]) {
  for (const mode of ['success', 'dbError', 'zero', 'storageError', 'storageThrow']) {
    test(`${component}: înlocuire PDF / ${mode}`, async () => {
      const f = fixture({ [mode]: true })
      await handler(file, component, name, f.context)({ ...f.row, serie: 'ABC' }, { name: 'new.pdf' })
      assert.deepEqual(f.events.map(e => e[0]), ['upload', 'update', 'remove'])
      assert.deepEqual(f.events[2][1], [mode === 'dbError' || mode === 'zero' ? f.events[0][1] : 'old.pdf'])
      assert.equal(f.toasts.some(t => t[1] === 'error'), mode === 'dbError' || mode === 'zero')
    })
  }
  if (name === 'handleSave') {
    test(`${component}: eliminare PDF refuzată păstrează fișierul vechi`, async () => {
      const f = fixture({ dbError: true })
      f.context.pdfFile = null
      f.context.removeExistingPdf = true
      await handler(file, component, name, f.context)()
      assert.deepEqual(f.events, [['update']])
    })
  }
}

for (const mode of ['success', 'dbError', 'zero', 'partial', 'storageThrow']) {
  test(`Avize: ștergere multiplă / ${mode}`, async () => {
    const f = fixture({ [mode]: true })
    await handler('Logistica', 'ArhivaAvizePage', 'handleDeleteLuna', f.context)('2025-01')
    assert.deepEqual(f.events.map(e => e[0]), ['read', 'delete', ...(['dbError', 'zero'].includes(mode) ? [] : ['remove'])])
    if (mode === 'partial') assert.deepEqual(f.events[2][1], ['old.pdf'])
    if (mode === 'success') assert.deepEqual(f.events[2][1], ['old.pdf', 'second.pdf'])
    assert.equal(f.toasts.some(t => t[1] === 'error'), ['dbError', 'zero', 'partial'].includes(mode))
  })
}

// Evaluăm condiția reală din JSX, pentru fiecare buton de ștergere cerut în brief.
function buttonGate(file, component, clickText, gateName = 'canDelete') {
  const { source, ast } = sources[file]
  let code
  traverse(ast, { JSXElement(path) {
    if (path.node.openingElement.name.name !== 'button' || ownerFunction(path) !== component) return
    const click = path.node.openingElement.attributes.find(a => a.name?.name === 'onClick')
    if (!click || !source.slice(click.start, click.end).includes(clickText)) return
    const gate = path.findParent(p => p.isLogicalExpression() && p.node.operator === '&&' && source.slice(p.node.left.start, p.node.left.end).includes(gateName))
    assert.ok(gate, `${component}: ${clickText} protejat de ${gateName}`)
    code = source.slice(gate.node.left.start, gate.node.left.end)
  } })
  assert.ok(code, `${component}: buton ${clickText} găsit`)
  return code
}

test('Editorul nu vede ștergerile; adminul le vede în toate componentele cerute', () => {
  for (const [file, component, clicks] of [
    ['Logistica', 'ActivFormModal', ['handleDelete']],
    ['Logistica', 'EditAlimentareModal', ['handleDelete']],
    ['Logistica', 'ArhivaAlimentariPage', ['handleDelete(a)']],
    ['Logistica', 'ArhivaAvizePage', ['handleDelete(a)', 'setShowDeleteLuna(true)', 'handleDeleteLuna(']],
    ['Logistica', 'SubcontractoriSection', ['handleDelete(c)']],
    ['ServiceTab', 'ServiceTab', ['handleQuickDeleteFisa']],
    ['ServiceTab', 'DetailFisaModal', ['handleDeleteFisa', 'deleteIntrare', 'handleDeleteAtasament']],
    ['DocumenteFlotaPage', 'DocumentFormModal', ['setConfirmDel(true)']],
    ['AmcSection', 'AmcFormModal', ['setConfirmDel(true)']],
    ['AmcSection', 'TipuriAmcManager', ['setConfirmDelId', 'del(t.id)']],
    ['PiesePozeSection', 'PiesePozeSection', ['stergePiesa', 'stergePoza']],
    ['SupapeDeclaratiiSection', 'SupapeDeclaratiiSection', ['stergeSupapa']],
    ['ConfirmareAITab', 'AlimCard', ['onRespinge(true)']],
  ]) for (const click of clicks) {
    const gate = buttonGate(file, component, click)
    const context = { canEdit: true, canDelete: false, isEdit: true, editMode: true, luniCuAvize: [1], showDeleteLuna: true }
    assert.equal(!!evaluate(gate, context), false, `${component}: editor`)
    assert.equal(!!evaluate(gate, { ...context, canDelete: true }), true, `${component}: admin`)
  }
})

test('Transporturi: editor, aprobator, participanți și solicitant doar în cerut pentru DELETE', () => {
  const edit = buttonGate('Logistica', 'TransporturiPage', 'setEditTransport', 'canEdit')
  const del = buttonGate('Logistica', 'TransporturiPage', "from('logistica_transporturi')")
  const t = { solicitant_id: 's', manager_plecare_id: 'p', manager_destinatie_id: 'd', status: 'cerut' }
  const base = { t, canEdit: false, canDelete: false, profile: { id: 'străin' }, isAprobatorTransport: () => false }
  assert.equal(!!evaluate(edit, base), false)
  assert.equal(!!evaluate(del, base), false)
  assert.equal(!!evaluate(edit, { ...base, canEdit: true }), true)
  assert.equal(!!evaluate(del, { ...base, canEdit: true }), false)
  assert.equal(!!evaluate(edit, { ...base, isAprobatorTransport: () => true }), true)
  for (const id of ['s', 'p', 'd']) {
    assert.equal(!!evaluate(edit, { ...base, profile: { id } }), true)
    assert.equal(!!evaluate(del, { ...base, profile: { id } }), id === 's')
    assert.equal(!!evaluate(del, { ...base, profile: { id }, t: { ...t, status: 'aprobat' } }), false)
  }
  assert.equal(!!evaluate(del, { ...base, canDelete: true, t: { ...t, status: 'aprobat' } }), true)
  assert.equal(!!evaluate(edit, { ...base, profile: null, t: {} }), false)
  assert.equal(!!evaluate(del, { ...base, profile: null, t: {} }), false)
})

test('canDelete: admin de modul sau owner; rolul admin_logistica singur nu ajunge', () => {
  for (const [file, component] of [['Logistica', 'LogisticaPage'], ['DocumenteFlotaPage', 'DocumenteFlotaPage'], ['AmcSection', 'AmcSection']]) {
    const code = expression(file, component, 'canDelete')
    for (const accessLevel of [null, 'viewer', 'editor', 'admin']) {
      assert.equal(evaluate(code, { accessLevel, profile: { role: 'admin_logistica' } }), accessLevel === 'admin')
      assert.equal(evaluate(code, { accessLevel, profile: { is_owner: true } }), true)
    }
  }
})

test('canDelete este transmis la fiecare instanță a componentelor care îl primesc', () => {
  const receivers = new Set()
  for (const { ast } of Object.values(sources)) traverse(ast, { FunctionDeclaration(path) {
    if (path.node.params[0]?.properties?.some(p => p.key?.name === 'canDelete')) receivers.add(path.node.id.name)
  } })
  for (const [file, { ast }] of Object.entries(sources)) traverse(ast, { JSXOpeningElement(path) {
    if (receivers.has(path.node.name.name)) {
      assert.ok(path.node.attributes.some(a => a.name?.name === 'canDelete'), `${file}: ${path.node.name.name} primește canDelete`)
    }
  } })
})

test('Confirmare AI: editorul poate respinge fără DELETE, adminul poate șterge', async () => {
  for (const [canDelete, doSterge, operations] of [[false, false, ['update']], [false, true, []], [true, true, ['delete']]]) {
    const f = fixture()
    Object.assign(f.context, { canDelete, profile: { id: 'user' }, setProcessing: () => {}, loadData: () => {} })
    await handler('ConfirmareAITab', 'ConfirmareAITab', 'respingeAlim', f.context)(1, doSterge)
    assert.deepEqual(f.events.map(e => e[0]), operations)
  }
})

test('Poze piese: INSERT refuzat curăță fișierul nou, INSERT reușit îl păstrează', async () => {
  for (const dbError of [true, false]) {
    const f = fixture({ dbError })
    f.context.compressImage = async file => file
    await handler('PiesePozeSection', 'PiesePozeSection', 'uploadPoze', f.context)(1, [{ size: 10 }])
    assert.deepEqual(f.events.map(e => e[0]), ['upload', 'insert', ...(dbError ? ['remove'] : [])])
    if (dbError) assert.deepEqual(f.events[2][1], [f.events[0][1]])
  }
})
