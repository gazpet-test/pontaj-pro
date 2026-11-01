import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const src = readFileSync(new URL('../src/HrPersonalExtern.jsx', import.meta.url), 'utf8')
test('Contacte externe: matricea reala UI foloseste owner/modifier, independent de isAdmin', () => {
  const expression = src.match(/const poateScrieContacte = ([^\n]+)/)[1]
  const access = new Function('esteOwner', 'poateLega', `return ${expression}`)
  for (const [owner, modifier, expected] of [[false,false,false],[true,false,true],[false,true,true],[true,true,true]]) {
    assert.equal(access(owner,modifier),expected)
  }
  assert.match(src, /\{poateScrieContacte && \(\s*<button onClick=\{\(\) => setEditPers\(\{\}\)\}/)
  assert.match(src, /\{poateScrieContacte && <button onClick=\{\(\) => setEditPers\(p\)\}/)
  assert.match(src, /const dezleaga = async \(p\) => \{\s*if \(!poateScrieContacte\) return/)
  assert.match(src, /\{editPers && poateScrieContacte && \(/)
  assert.match(src, /\{!poateScrieContacte && <div[^>]*>Doar citire:/)
})
