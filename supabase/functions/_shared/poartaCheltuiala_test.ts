import { assertEquals } from 'jsr:@std/assert@1'
import { poateCheltui } from './poartaCheltuiala.ts'

const db = (r: { data: unknown; error: unknown } | 'arunca', apeluri: unknown[] = []) => ({
  rpc: (fn: string, args: Record<string, unknown>) => { apeluri.push([fn, args]); return r === 'arunca' ? Promise.reject(new Error('rețea')) : Promise.resolve(r) },
})
Deno.test('poateCheltui: doar data === true trece; parametrii merg exact la fn_ofertare_poate_cheltui', async () => {
  const a: unknown[] = []
  assertEquals(await poateCheltui(db({ data: true, error: null }, a), 95, 'u1'), true)
  assertEquals(a, [['fn_ofertare_poate_cheltui', { p_licitatie_id: 95, p_uid: 'u1' }]])
  assertEquals(await poateCheltui(db({ data: '95', error: null }), '95', 'u1'), false)   // ne-boolean
  assertEquals(await poateCheltui(db({ data: false, error: null }), 95, 'u1'), false)
})
Deno.test('poateCheltui: fail-closed pe eroare, excepție, uid / licitație lipsă sau invalidă (fără apel)', async () => {
  assertEquals(await poateCheltui(db({ data: true, error: { message: 'x' } }), 95, 'u1'), false)
  assertEquals(await poateCheltui(db('arunca'), 95, 'u1'), false)
  for (const [lic, uid] of [[95, null], [95, ''], [null, 'u1'], [0, 'u1'], [-1, 'u1'], ['abc', 'u1'], [1.5, 'u1']] as const) {
    const a: unknown[] = []
    assertEquals(await poateCheltui(db({ data: true, error: null }, a), lic as number, uid as string), false, `${lic} ${uid}`)
    assertEquals(a.length, 0)
  }
})
