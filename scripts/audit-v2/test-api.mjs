// Aceleași aserțiuni native rulează prin node --test și prin Vitest.
import { format } from 'node:util'
import { mock } from 'node:test'
const api = await import(process.env.VITEST ? 'vitest' : 'node:test')
export const describe = api.describe
export const afterEach = api.afterEach
export const it = Object.assign((...args) => api.it(...args), {
  each: values => (name, fn) => {
    for (const value of values) {
      const args = Array.isArray(value) ? value : [value]
      api.it(format(name, ...args), () => fn(...args))
    }
  },
})
export { mock }
const env = new Map()
export const stubEnv = (key, value) => {
  if (!env.has(key)) env.set(key, process.env[key])
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}
export const restoreEnv = () => {
  for (const [key, value] of env) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  env.clear()
}
