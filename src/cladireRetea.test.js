import { describe, it, expect, vi } from 'vitest'
vi.mock('./lib/supabase.js', () => ({ supabase: {} }))
vi.mock('./Meteo.jsx', () => ({ MeteoSantier: () => null }))
import { nivelRetea, areGpu } from './Cladire.jsx'

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
})
