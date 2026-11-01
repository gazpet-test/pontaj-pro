// deno test supabase/functions/ofertare-cerinte/autorizare_test.ts — poarta lui ofertare-cerinte (20261124a, 3A; review #908 r1 Jakarinos P1-2)
import { assertEquals, assert } from 'jsr:@std/assert@1'
import { autorizeazaCerinte, MESAJ_CERINTE, type DepsAutorizare } from './autorizare.ts'

const jwt = (rol: string) => 'x.' + btoa(JSON.stringify({ role: rol })).replace(/=+$/, '') + '.y'
const OWNER = 'u-owner', RESP = 'u-resp', STRAIN = 'u-strain'
const deps = (o: Partial<DepsAutorizare> & { apeluri?: string[] } = {}): DepsAutorizare => ({
  esteIntern: async () => false,
  coada: async () => ({ activ: true, cerut_de: RESP }),
  getUser: async (t) => (t === 'tok-owner' ? OWNER : t === 'tok-resp' ? RESP : t === 'tok-strain' ? STRAIN : null),
  poateCheltui: async (_l, uid) => uid === OWNER || uid === RESP,
  cheieServiciu: 'cheie-serviciu',
  ...o,
})

Deno.test('cheia anon e refuzată, chiar cu coada activă (calea veche a dispărut)', async () => {
  let citit = false
  const r = await autorizeazaCerinte('Bearer ' + jwt('anon'), 7, deps({ coada: async () => { citit = true; return { activ: true, cerut_de: RESP } } }))
  assertEquals(r, 'apel neautorizat (cheie anon)')
  assert(!citit, 'coada nu se mai citește pe calea anon')
})
Deno.test('fără Authorization și fără secret intern → refuz', async () => {
  assertEquals(await autorizeazaCerinte(null, 7, deps()), 'lipsește Authorization')
})
Deno.test('utilizator: owner / responsabil trec, străinul nu, sesiunea invalidă nu', async () => {
  assertEquals(await autorizeazaCerinte('Bearer tok-owner', 7, deps()), null)
  assertEquals(await autorizeazaCerinte('Bearer tok-resp', 7, deps()), null)
  assertEquals(await autorizeazaCerinte('Bearer tok-strain', 7, deps()), MESAJ_CERINTE)
  assertEquals(await autorizeazaCerinte('Bearer tok-necunoscut', 7, deps()), 'sesiune invalidă')
})
Deno.test('intern: coada activă + cerut_de care trece poarta → trece', async () => {
  assertEquals(await autorizeazaCerinte(null, 7, deps({ esteIntern: async () => true })), null)
})
Deno.test('intern: coada inactivă / lipsă → refuz', async () => {
  assertEquals(await autorizeazaCerinte(null, 7, deps({ esteIntern: async () => true, coada: async () => ({ activ: false, cerut_de: RESP }) })),
    'apel intern refuzat: coada extragerii nu e activă')
  assertEquals(await autorizeazaCerinte(null, 7, deps({ esteIntern: async () => true, coada: async () => null })),
    'apel intern refuzat: coada extragerii nu e activă')
})
Deno.test('intern: cerut_de străin sau NULL → refuz (secretul nu ține loc de drept de cheltuială)', async () => {
  for (const cerut_de of [STRAIN, null]) {
    assertEquals(await autorizeazaCerinte(null, 7, deps({ esteIntern: async () => true, coada: async () => ({ activ: true, cerut_de }) })),
      'apel intern refuzat: cine a cerut extragerea nu trece poarta pe cheltuială')
  }
})
Deno.test('intern: licitatie_id invalid → refuz fără citiri', async () => {
  for (const l of [NaN, 0, -1, 1.5]) assertEquals(await autorizeazaCerinte(null, l, deps({ esteIntern: async () => true })), 'licitatie_id invalid')
})
Deno.test('fail-closed: excepție în verificări → refuz', async () => {
  const boom = async () => { throw new Error('rețea') }
  assertEquals(await autorizeazaCerinte(null, 7, deps({ esteIntern: boom })), 'eroare la autorizare')
  assertEquals(await autorizeazaCerinte('Bearer tok-owner', 7, deps({ poateCheltui: boom })), 'eroare la autorizare')
  assertEquals(await autorizeazaCerinte(null, 7, deps({ esteIntern: async () => true, coada: boom })), 'eroare la autorizare')
})
Deno.test('service_role (semnat, verificat de gateway) trece ca la celelalte edge-uri', async () => {
  assertEquals(await autorizeazaCerinte('Bearer ' + jwt('service_role'), 7, deps()), null)
  assertEquals(await autorizeazaCerinte('Bearer cheie-serviciu', 7, deps()), null)
})
