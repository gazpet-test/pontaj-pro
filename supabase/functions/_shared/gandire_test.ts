import { deepStrictEqual as assertEquals } from 'node:assert/strict'
import { faraGandire, SONNET_55 } from './gandire.ts'

Deno.test('faraGandire: Sonnet 5.5 → between_tools (disabled = 400); celelalte modele → disabled', () => {
  assertEquals(SONNET_55, 'claude-sonnet-5-5')
  assertEquals(faraGandire('claude-sonnet-5-5'), { type: 'between_tools' })
  for (const m of ['claude-haiku-5-5', 'claude-sonnet-5', 'claude-opus-5', 'claude-haiku-4-5-20251001']) assertEquals(faraGandire(m), { type: 'disabled' })
})
