import { mkdir, open, unlink, access } from 'node:fs/promises'
import { join } from 'node:path'
import { salveazaJson, incarcaJson } from './dovezi.mjs'
import { hash } from './supraveghere-p2.mjs'
import { incident } from './politica-p2.js'

export async function deschideSerie(dir, actor_id) {
  await mkdir(dir, { recursive: true })
  let lock
  try { lock = await open(join(dir, 'serie.lock'), 'wx') }
  catch { throw new Error('artifact: seria este blocată de alt proces sau de o execuție întreruptă; revizuire manuală, fără reluare automată') }
  const close = async () => { await lock.close(); await unlink(join(dir, 'serie.lock')) }
  try {
    let state; let exists = false
    try { await access(join(dir, 'serie.json')); exists = true }
    catch (e) { if (e.code !== 'ENOENT') throw e }
    if (exists) state = await incarcaJson(dir, 'serie')
    state ||= { actor_id, licitatie_id: 103, attempts: {}, completed: [], stopped: null, t0: null, previous: null }
    if (state.actor_id !== actor_id) throw incident('BYPASS', 'permisiune: seria are alt actor fix')
    if (state.stopped) throw incident(state.stopped.tip, `Seria este oprită: ${state.stopped.motiv}`)
    const save = () => salveazaJson(dir, 'serie', state)
    const read = async ref => {
      const value = await incarcaJson(dir, ref.name)
      if (hash(value) !== ref.hash) throw new Error('artifact: amprentă snapshot diferită în serie')
      return value
    }
    return { state, close, save, read,
      async initial(snapshot) {
        if (state.t0) return read(state.t0)
        await salveazaJson(dir, 'T0', snapshot)
        // Amprenta e a artefactului serializat/mascat, nu a unui obiect ascuns în memorie.
        const persisted = await incarcaJson(dir, 'T0')
        state.t0 = state.previous = { name: 'T0', hash: hash(persisted) }
        await save(); return persisted
      },
      async start(key) { state.attempts[key] = (state.attempts[key] || 0) + 1; await save() },
      async after(key, snapshot) {
        const name = `snapshot-${String(state.completed.length + 1).padStart(4, '0')}`
        await salveazaJson(dir, name, snapshot)
        state.previous = { name, hash: hash(await incarcaJson(dir, name)) }
        state.completed.push({ key, ...state.previous }); await save()
      },
      async stop(tip, motiv) { state.stopped = { tip, motiv }; await save() },
    }
  } catch (e) { await close(); throw e }
}
