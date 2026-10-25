import { describe, it, expect, vi } from 'vitest'
vi.mock('./lib/supabase.js', () => ({ supabase: {} }))
vi.mock('./Meteo.jsx', () => ({ MeteoSantier: () => null }))
import { nivelRetea, areGpu, areLimiteAi, textReset, nivelUps, textUps, UPS_PRAGURI } from './Cladire.jsx'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

describe('UPS server AI', () => {
  it('culori la praguri si pe retea; date incomplete nu devin pe retea', () => {
    for (const pct of [0, 20, 24.9, 25, 49.9]) expect(nivelUps(pct, true)).toBe('error')
    for (const pct of [50, 80, 100]) expect(nivelUps(pct, true)).toBe('warning')
    for (const pct of [0, 20, 100]) expect(nivelUps(pct, false)).toBe('ok')
    for (const pct of [null, undefined, '92', NaN, -1, 101]) expect(nivelUps(pct, true)).toBe('lipsa')
    expect(nivelUps(92, undefined)).toBe('lipsa')
    expect(textUps({ ups_pct: 92 })).toBe('UPS: 92% - stare necunoscuta')
  })
  it('model din meta, runtime optional inclusiv zero; fara procent nu apare', () => {
    expect(textUps({ ups_pct: 92, ups_pe_baterie: false }, 'njoy Echo Pro 2000')).toBe('UPS njoy Echo Pro 2000: 92% - pe retea')
    expect(textUps({ ups_pct: 40, ups_pe_baterie: true, ups_runtime_min: 12 })).toBe('UPS: 40% - pe baterie - autonomie estimata 12 min')
    expect(textUps({ ups_pct: 80, ups_pe_baterie: true, ups_runtime_min: 0 })).toContain('0 min')
    expect(textUps({ ups_pct: 80, ups_pe_baterie: true, ups_runtime_min: null })).not.toContain('min')
    expect(textUps({})).toBe('')
    expect(textUps({ ups_pct: '92' })).toBe('')
  })
  it('SQL: praguri identice; regulile vechi si rollback au corp exact', () => {
    const read = p => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
    const old = read('../supabase/migrations/20261023d_iot_retea_limite_ai.sql').split('$corp$')[1]
    const decode = s => s.split('$iot_ups_body_20261112a$')[1].replace(/@U(\d+)@/g, (_, n) => String.fromCharCode(Number(n)))
    const migration = read('../supabase/migrations/20261112a_iot_ups_alerte.sql')
    const body = decode(migration)
    expect(body).toContain(`IF valoare < ${UPS_PRAGURI.baterie} THEN`)
    expect(body).toContain(`IF valoare < ${UPS_PRAGURI.oprire} THEN`)
    expect(body.replace(/\n    -- UPS: alerte cumulative,[\s\S]*?(?=  END LOOP;\n  RETURN n;)/, '')).toBe(old)
    const rollback = read('../supabase/revenire/20261112a_iot_ups_alerte_ROLLBACK.sql')
    expect(decode(rollback)).toBe(old)
    expect(createHash('md5').update(old).digest('hex')).toBe('d6e0db3c7c2f6b49497b267e1bf06ac5')
    for (const sql of [migration, rollback]) {
      expect(sql).not.toMatch(/[^\x00-\x7f]/)
      expect(sql).toContain('pg_advisory_xact_lock')
      expect(sql).toContain("current_user <> 'postgres'")
    }
  })
})

describe('Clădire — praguri rețea (aliniate cu iot_verifica_retea, 20261023c)', () => {
  it('gpu_temp: > 80 warning, fără nivel de eroare', () => {
    expect(nivelRetea('gpu_temp', 80)).toBe('ok')
    expect(nivelRetea('gpu_temp', 81)).toBe('warning')
    expect(nivelRetea('gpu_temp', 119)).toBe('warning')
  })
  it('disk_pct: > 90 warning', () => {
    expect(nivelRetea('disk_pct', 90)).toBe('ok')
    expect(nivelRetea('disk_pct', 95)).toBe('warning')
  })
  it('praguri vechi neschimbate', () => {
    expect(nivelRetea('cpu_temp', 90)).toBe('error')
    expect(nivelRetea('hdd_max', 55)).toBe('warning')
    expect(nivelRetea('cpu_temp', null)).toBe('lipsa')
  })
  it('areGpu: doar server cu cel puțin o valoare GPU numerică', () => {
    expect(areGpu({ meta: { tip: 'server' }, ultima_citire: { gpu_temp: 45 } })).toBe(true)
    expect(areGpu({ meta: { tip: 'server' }, ultima_citire: { cpu_load: 8 } })).toBe(false)
    expect(areGpu({ meta: { tip: 'nas' }, ultima_citire: { gpu_temp: 45 } })).toBe(false)
    expect(areGpu({ meta: { tip: 'server' }, ultima_citire: { gpu_temp: '45' } })).toBe(false)
  })
  it('areLimiteAi: doar server cu procent numeric', () => {
    expect(areLimiteAi({ meta: { tip: 'server' }, ultima_citire: { ai_gemini_ramas_pct: 68 } })).toBe(true)
    expect(areLimiteAi({ meta: { tip: 'server' }, ultima_citire: { ai_gemini_reset_s: 1 } })).toBe(false)
    expect(areLimiteAi({ meta: { tip: 'nas' }, ultima_citire: { ai_claude_ramas_pct: 100 } })).toBe(false)
    expect(areLimiteAi({ meta: { tip: 'server' }, ultima_citire: { ai_anthropic_saptamana_ramas_pct: 0 } })).toBe(true)
    expect(areLimiteAi({ meta: { tip: 'server' }, ultima_citire: { ai_codex_plan: 'plus' } })).toBe(false)
  })
  it('textReset: ore sub o zi, zile peste, trecut', () => {
    const acum = Date.UTC(2026, 9, 9, 12)
    expect(textReset(acum / 1000 + 5 * 3600, acum)).toBe('reset în 5 h')
    expect(textReset(acum / 1000 + 5 * 86400, acum)).toBe('reset în 5 z')
    expect(textReset(acum / 1000 - 10, acum)).toBe('reset trecut')
    expect(textReset(null, acum)).toBe('')
  })
})
