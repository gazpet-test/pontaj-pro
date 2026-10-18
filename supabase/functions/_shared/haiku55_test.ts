import { deepStrictEqual as assertEquals, ok } from 'node:assert/strict'
import { costApel, HAIKU_55, jsonDinText, mesajRefuz, textRaspuns } from './haiku55.ts'

const aprox = (a: number, b: number) => ok(Math.abs(a - b) < 1e-12, `${a} != ${b}`)

Deno.test('costApel: Haiku 5.5 0,10/0,50 $ pe 1M, peste 100K prompt 0,50/2,50, cache 0,1x / 1,25x', () => {
  assertEquals(HAIKU_55, 'claude-haiku-5-5')
  aprox(costApel(HAIKU_55, { input_tokens: 1_000_000, output_tokens: 0 }), 0.5)            // 1M > prag → 0,50
  aprox(costApel(HAIKU_55, { input_tokens: 3000, output_tokens: 200 }), 0.0004)            // 0,0003 + 0,0001
  aprox(costApel(HAIKU_55, { input_tokens: 100_000, output_tokens: 1000 }), 0.0105)        // exact pragul: tariful mic
  aprox(costApel(HAIKU_55, { input_tokens: 1000, cache_read_input_tokens: 10_000 }), 0.0002) // 0,0001 + 10K × 0,01 $/1M
  aprox(costApel(HAIKU_55, { input_tokens: 0, cache_creation_input_tokens: 1_000_000 - 1 }), (1_000_000 - 1) * 0.5 / 1e6 * 1.25)
  aprox(costApel('claude-haiku-4-5-20251001', { input_tokens: 1000, output_tokens: 1000 }), 0.006)
  aprox(costApel('claude-opus-5', { input_tokens: 1000, output_tokens: 1000 }, { in: 5 / 1e6, out: 25 / 1e6 }), 0.03)
  aprox(costApel('model-necunoscut', { input_tokens: 1000 }), 0.001)                         // fără rezervă → prețul Haiku 4.5
  assertEquals(costApel(HAIKU_55, null), 0)
})

Deno.test('textRaspuns: doar blocurile text, și când răspunsul începe cu thinking', () => {
  assertEquals(textRaspuns({ content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '{"a":1}' }] }), '{"a":1}')
  assertEquals(textRaspuns({ content: [{ type: 'text', text: 'a' }, { type: 'tool_use' }, { type: 'text', text: 'b' }] }), 'a\nb')
  assertEquals(textRaspuns({}), '')
  assertEquals(textRaspuns(null), '')
})

Deno.test('mesajRefuz: doar pe stop_reason refusal, cu categoria când există', () => {
  assertEquals(mesajRefuz({ stop_reason: 'end_turn' }), null)
  assertEquals(mesajRefuz(null), null)
  ok(mesajRefuz({ stop_reason: 'refusal', stop_details: { category: 'cyber' } })!.includes('categoria cyber'))
  ok(mesajRefuz({ stop_reason: 'refusal', stop_details: null })!.startsWith('Modelul AI a refuzat'))
})

Deno.test('jsonDinText: JSON curat, în ``` sau cu text în jur; altfel null', () => {
  assertEquals(jsonDinText('{"x":1}'), { x: 1 })
  assertEquals(jsonDinText('```json\n{"x":[1,2]}\n```'), { x: [1, 2] })
  assertEquals(jsonDinText('Iată datele:\n{"x":{"y":"}"}}\nGata.'), { x: { y: '}' } })
  assertEquals(jsonDinText('fără json'), null)
  assertEquals(jsonDinText('"doar un șir"'), null)
  assertEquals(jsonDinText(''), null)
})
