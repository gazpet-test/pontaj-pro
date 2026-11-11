// garda_agent.mjs — garda PreToolUse a agentului „Tichete dimineața” (r5, P1). O pornește Claude Code (CLI 2.1.319) la FIECARE
// apel de unealtă al agentului, din setările date explicit lansatorului (--settings, fișier scris de orchestrator într-un director
// doar-citire pentru contul agentului): forma exec (node.exe + această cale, fără shell), matcher „*”, onFailure = block.
// Intrarea (stdin): JSON-ul hook-ului (hook_event_name, tool_name, tool_input, cwd …). Mediul: TICHETE_WT (worktree-ul tichetului),
// TICHETE_BRANCH (branch-ul exact al rulării), opțional TICHETE_GARDA_LOG (jurnal, informativ). Toate puse de lansator în mediul
// procesului claude, pe care agentul nu-l poate schimba.
// Ieșire: exit 0 fără nimic pe stdout = „nu mă opun” (lista dontAsk + --allowedTools se aplică mai departe); exit 2 + motivul pe
// stderr = unealta REFUZATĂ (CLI: „Exit code 2 - show stderr to model and block tool call”). Orice eroare => exit 2 (fail-closed;
// în plus onFailure = block transformă în refuz și un hook care nu pornește / expiră / iese cu alt cod).
// Fișierul stă în clona orchestratorului (în afara worktree-ului, doar-citire pentru agent); nu importă nimic din node_modules.
import fs from 'node:fs'
import path from 'node:path'
import { verificaApelAgent } from './tichete_lib.mjs'

const MAX_INTRARE = 2_000_000

function jurnal(rez, unealta, motiv) {
  const f = process.env.TICHETE_GARDA_LOG
  if (!f || !/^[A-Za-z]:\\[A-Za-z0-9_\\.-]+\.log$/.test(f)) return
  try { fs.appendFileSync(f, new Date().toISOString() + ' ' + rez + ' ' + String(unealta).slice(0, 40) + (motiv ? ' ' + motiv.slice(0, 200) : '') + '\r\n') } catch { /* jurnalul e informativ */ }
}

function refuza(motiv, unealta = '?') {
  jurnal('REFUZ', unealta, motiv)
  process.stderr.write('GARDA_REFUZ: ' + motiv + ' (lista agentului e inchisa: vezi brief-ul, sectiunea Unelte)\n')
  process.exit(2)
}

try {
  let buf = ''
  process.stdin.setEncoding('utf8')
  for await (const bucata of process.stdin) {
    buf += bucata
    if (buf.length > MAX_INTRARE) refuza('intrare prea mare')
  }
  let apel
  try { apel = JSON.parse(buf) } catch { refuza('intrare JSON invalida') }
  if (apel === null || typeof apel !== 'object' || apel.hook_event_name !== 'PreToolUse') refuza('eveniment neasteptat')
  const wt = process.env.TICHETE_WT || '', branch = process.env.TICHETE_BRANCH || ''
  // directorul de lucru al sesiunii trebuie să fie chiar worktree-ul tichetului
  if (typeof apel.cwd !== 'string' || path.win32.resolve(apel.cwd).toLowerCase() !== path.win32.resolve(wt || 'C:\\').toLowerCase()) refuza('directorul sesiunii nu e worktree-ul tichetului', apel.tool_name)
  const r = verificaApelAgent(apel, { wt, branch })
  if (!r.ok) refuza(r.motiv, apel.tool_name)
  jurnal('OK', apel.tool_name, '')
  process.exit(0)
} catch {
  refuza('eroare in garda')
}
