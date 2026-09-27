// Exclusiv pentru testele r3: exercită lock-ul real din verificaManifest, fără rețea/SDK.
import { verificaManifest } from './verifica_manifest_lib.ts'

const [mod] = Deno.args
const supa = {
  from: () => ({ select: () => ({ eq: () => ({ abortSignal: () => ({
    async single() {
      console.log('obtinut')
      if (mod === 'tine') await Deno.stdin.read(new Uint8Array(1))
      throw new Error('oprire-test')
    },
  }) }) }) }),
} as unknown as Parameters<typeof verificaManifest>[0]

try {
  await verificaManifest(supa, 93)
  throw new Error('verificarea trebuia oprită de stub')
} catch (e) {
  if ((e as Error).message === 'oprire-test') console.log('eliberat')
  else if ((e as Error).message === 'verificare deja în curs pentru 93') console.log('refuzat')
  else throw e
}
