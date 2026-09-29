// Alternativă locală când CLI-ul standard întâlnește spawn EPERM pe Windows.
// Aceleași teste Vitest JS; fără bundling esbuild, procese fork sau modificări la Vite-ul aplicației.
import { startVitest } from 'vitest/node'
import { fileURLToPath } from 'node:url'

const ctx = await startVitest('test', ['scripts/audit-v2'], {
  config: false, watch: false, pool: 'threads', maxWorkers: 1, minWorkers: 1,
  cache: false,
}, {
  configFile: false, esbuild: false, resolve: { preserveSymlinks: true },
  cacheDir: fileURLToPath(new URL('./.vite-test-cache', import.meta.url)), plugins: [],
})
if (ctx) await ctx.close()
else process.exitCode = 1
