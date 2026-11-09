import { describe, it, expect, vi, afterAll } from 'vitest'
// Fus orar străin ÎNAINTEA importurilor: ziua și ora resetării trebuie să iasă în ora României pe orice mașină (și pe serverul din București).
const TZ_INITIAL = vi.hoisted(() => { const v = process.env.TZ; process.env.TZ = 'America/Sao_Paulo'; return v })
afterAll(() => { if (TZ_INITIAL === undefined) delete process.env.TZ; else process.env.TZ = TZ_INITIAL })
vi.mock('./lib/supabase.js', () => ({ supabase: {} }))
vi.mock('./Meteo.jsx', () => ({ MeteoSantier: () => null }))
import { nivelRetea, areGpu, areLimiteAi, textReset, nivelUps, textUps, UPS_PRAGURI, textDataReset, textResetCont, nivelCota, LimiteAi, COTE_AI } from './Cladire.jsx'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

describe('UPS server AI', () => {
  it('culori la praguri si pe retea; date incomplete nu devin pe rețea', () => {
    for (const pct of [0, 20, 24.9, 25, 49.9]) expect(nivelUps(pct, true)).toBe('error')
    for (const pct of [50, 80, 100]) expect(nivelUps(pct, true)).toBe('warning')
    for (const pct of [0, 20, 100]) expect(nivelUps(pct, false)).toBe('ok')
    for (const pct of [null, undefined, '92', NaN, -1, 101]) expect(nivelUps(pct, true)).toBe('lipsa')
    expect(nivelUps(92, undefined)).toBe('lipsa')
    expect(textUps({ ups_pct: 92 })).toBe('UPS: 92% - stare necunoscută')
  })
  it('model din meta, runtime optional inclusiv zero; fara procent nu apare', () => {
    expect(textUps({ ups_pct: 92, ups_pe_baterie: false }, 'njoy Echo Pro 2000')).toBe('UPS njoy Echo Pro 2000: 92% - pe rețea')
    expect(textUps({ ups_pct: 40, ups_pe_baterie: true, ups_runtime_min: 12 })).toBe('UPS: 40% - pe baterie - autonomie estimată 12 min')
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

describe('Limite cont: ziua și ora resetării, culori, „—” la lipsă', () => {
  // 09.11.2026 12:00 ora României (EET, UTC+2) = 10:00 UTC
  const acum = Date.UTC(2026, 10, 9, 10)
  const vineri = Date.UTC(2026, 10, 13, 8) / 1000 // vineri 13.11.2026, 10:00 ora României
  it('textDataReset: zi + oră în Europe/Bucharest, distanța în paranteză', () => {
    expect(textDataReset(vineri, acum)).toBe('vineri 13.11, 10:00 (în 4 z)')
    expect(textDataReset(acum / 1000 + 5 * 3600, acum)).toBe('luni 09.11, 17:00 (în 5 h)')
    // vara (EEST, UTC+3): 10.07.2026 07:00 UTC = 10:00 ora României
    expect(textDataReset(Date.UTC(2026, 6, 10, 7) / 1000, Date.UTC(2026, 6, 1))).toBe('vineri 10.07, 10:00 (în 9 z)')
  })
  it('textDataReset: trecut și lipsă', () => {
    expect(textDataReset(acum / 1000 - 60, acum)).toBe('luni 09.11, 11:59 (trecut)')
    for (const v of [null, undefined, NaN, Infinity, 0, -5, '1794196802', '']) expect(textDataReset(v, acum)).toBe('')
  })
  it('textReset rămâne neschimbat (compatibilitate)', () => {
    expect(textReset(vineri, acum)).toBe('reset în 4 z')
  })
  it('textResetCont: epoch-ul are prioritate; apoi textul vechi (epoch, ISO, text liber); altfel „—”', () => {
    const r = { a_s: vineri, a: 'luni 10:00', b: 'joi 12.11, 09:00', c: '2026-11-13T08:00:00Z', d: vineri, e: '   ', f: 'nu e dată' }
    expect(textResetCont(r, 'a_s', 'a', acum)).toBe('vineri 13.11, 10:00 (în 4 z)')
    expect(textResetCont(r, 'lipsa_s', 'b', acum)).toBe('joi 12.11, 09:00')
    expect(textResetCont(r, 'lipsa_s', 'c', acum)).toBe('vineri 13.11, 10:00 (în 4 z)')
    expect(textResetCont(r, null, 'd', acum)).toBe('vineri 13.11, 10:00 (în 4 z)')
    expect(textResetCont(r, 'lipsa_s', 'e', acum)).toBe('—')
    expect(textResetCont(r, 'lipsa_s', 'f', acum)).toBe('nu e dată')
    expect(textResetCont(r, 'lipsa_s', null, acum)).toBe('—')
    expect(textResetCont({ x_s: 'abc' }, 'x_s', 'x', acum)).toBe('—')
    expect(textResetCont(undefined, 'x_s', 'x', acum)).toBe('—')
  })
  it('nivelCota: verde > 40, galben 15–40, roșu < 15; lipsă / în afara 0–100 = lipsa', () => {
    for (const p of [0, 5, 14.9]) expect(nivelCota(p)).toBe('rosu')
    for (const p of [15, 30, 40]) expect(nivelCota(p)).toBe('galben')
    for (const p of [40.1, 62, 100]) expect(nivelCota(p)).toBe('verde')
    for (const p of [null, undefined, NaN, '50', -1, 100.5]) expect(nivelCota(p)).toBe('lipsa')
  })
  it('areLimiteAi: și cu doar cota redari@', () => {
    expect(areLimiteAi({ meta: { tip: 'server' }, ultima_citire: { ai_redari_saptamana_ramas_pct: 55 } })).toBe(true)
    expect(areLimiteAi({ meta: { tip: 'server' }, ultima_citire: { ai_redari_saptamana_reset_s: vineri } })).toBe(false)
  })
  it('LimiteAi: un rând pe cont, cu etichetele cerute; cheie lipsă = „—”, nu 0; 0 rămâne 0%', () => {
    const r = { ai_anthropic_saptamana_ramas_pct: 62, ai_anthropic_saptamana_reset_s: vineri, ai_anthropic_saptamana_fable_ramas_pct: 0,
      ai_codex_ramas_pct: 12, ai_codex_reset: '2026-11-13T08:00:00Z', ai_gemini_ramas_pct: 30, ai_claude_ramas_pct: 80 }
    const html = renderToStaticMarkup(createElement(LimiteAi, { r, acum }))
    const randuri = [...html.matchAll(/role="meter" aria-label="([^"]+)"/g)].map(m => m[1])
    expect(randuri).toEqual(['Claude (cont principal)', 'Fable', 'sesiune', 'Rocky (redari@)', 'Fable', 'Codex', 'Gemini', 'Claude/GPT (Antigravity)'])
    expect(COTE_AI.map(c => c.et)).toEqual(['Claude (cont principal)', 'Rocky (redari@)', 'Codex', 'Gemini', 'Claude/GPT (Antigravity)'])
    // rândul Rocky fără date: procent „—” și reset „—”, bara goală, fără „0%”
    const rocky = html.split('aria-label="Rocky (redari@)"')[1].split('role="meter"')[0]
    expect(rocky).toContain('>—</b>')
    expect(rocky).not.toMatch(/>\d+%<\/b>/)
    expect(rocky).toContain('width:0;')
    // Fable cont principal = 0 → „0%”
    const fable = html.split('aria-label="Fable"')[1].split('role="meter"')[0]
    expect(fable).toContain('>0%</b>')
    expect(html).toContain('62%')
    expect(html).toContain('reset vineri 13.11, 10:00 (în 4 z)')
  })
  it('LimiteAi: cota redari@ cu date, culorile pragurilor pe bară', () => {
    const r = { ai_redari_saptamana_ramas_pct: 23, ai_redari_saptamana_reset_s: vineri, ai_redari_saptamana_fable_ramas_pct: 9, ai_redari_saptamana_fable_reset: 'duminică 15.11, 18:00' }
    const html = renderToStaticMarkup(createElement(LimiteAi, { r, acum }))
    const rocky = html.split('aria-label="Rocky (redari@)"')[1].split('role="meter"')[0]
    expect(rocky).toContain('width:23%')
    expect(rocky).toContain('#E3B341') // galben
    expect(rocky).toContain('23%')
    expect(rocky).toContain('reset vineri 13.11, 10:00 (în 4 z)')
    const fableRocky = html.split('aria-label="Rocky (redari@)"')[1].split('aria-label="Fable"')[1].split('role="meter"')[0]
    expect(fableRocky).toContain('#F85149') // roșu
    expect(fableRocky).toContain('reset duminică 15.11, 18:00')
  })
})
