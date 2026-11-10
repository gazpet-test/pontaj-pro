// Rulează autotestul PowerShell al sarcinii „Gazpet Dialog TGZ” (cod real, nu o copie JS) sub vitest.
// Offline: fără rețea, fără BD, fără Claude (psql și claude sunt simulate în test_dialog_tgz.ps1).
// Doar pe Windows, cu powershell.exe (5.1, ca sarcina programată); altundeva (CI Linux) se sare.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const aici = path.dirname(fileURLToPath(import.meta.url))
const script = path.join(aici, 'test_dialog_tgz.ps1')

function gasesteShell() {
  if (process.platform !== 'win32') return null
  const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8' })
  return r.status === 0 ? 'powershell.exe' : null
}
const shell = gasesteShell()

describe('dialog_tgz (autotest PowerShell)', () => {
  it.skipIf(!shell)('toate verificările trec', () => {
    const r = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], {
      encoding: 'utf8', timeout: 290000,
    })
    const iesire = `${r.stdout || ''}\n${r.stderr || ''}`
    console.log(r.status !== 0 ? iesire : (iesire.match(/Rezultat: .*/) || ['fara rezultat'])[0])
    expect(iesire).toMatch(/Rezultat: \d+ OK, 0 ESEC/)
    expect(r.status).toBe(0)
  }, 300000)
})
