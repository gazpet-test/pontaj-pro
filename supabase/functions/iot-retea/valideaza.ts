export type CitireRetea = {
  extern_id: string;
  online: boolean;
  latency_ms: number | null;
  cpu_temp: number | null;
  hdd_max: number | null;
  cpu_load: number | null;
  uptime_s: number | null;
  disk_pct: number | null;
  ram_pct: number | null;
  raid_ok: boolean | null;
  gpu_temp: number | null;
  gpu_w: number | null;
  gpu_util: number | null;
  vram_pct: number | null;
  ai_gemini_ramas_pct: number | null;
  ai_claude_ramas_pct: number | null;
  ai_gemini_reset_s: number | null;
  ai_claude_reset_s: number | null;
};
type Rezultat = { ok: true; citiri: CitireRetea[] } | { ok: false; error: string };

const obiect = (x: unknown): x is Record<string, unknown> =>
  x !== null && typeof x === 'object' && !Array.isArray(x);
const numarIn = (x: unknown, min: number, max: number): x is number =>
  typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max;

const CHEI = ['extern_id', 'online', 'latency_ms', 'cpu_temp', 'hdd_max', 'cpu_load', 'uptime_s', 'disk_pct', 'ram_pct', 'raid_ok',
  'gpu_temp', 'gpu_w', 'gpu_util', 'vram_pct',
  'ai_gemini_ramas_pct', 'ai_claude_ramas_pct', 'ai_gemini_reset_s', 'ai_claude_reset_s'];

// Validare strictă a unui lot de citiri de rețea. Senzorii lipsă sunt acceptați (null);
// funcția SQL decide ce înseamnă offline/tăcut. Expeditorul nu poate crea dispozitive.
export function valideazaCitiri(body: unknown): Rezultat {
  if (!obiect(body)) return { ok: false, error: 'Body trebuie să fie un obiect JSON' };
  if (Object.keys(body).some(k => k !== 'citiri')) return { ok: false, error: 'Cheie necunoscută pe body' };
  if (!Array.isArray(body.citiri)) return { ok: false, error: 'citiri: listă lipsă' };
  if (body.citiri.length === 0) return { ok: false, error: 'citiri: listă goală' };
  if (body.citiri.length > 64) return { ok: false, error: 'citiri: maximum 64 dispozitive' };

  const vazute = new Set<string>();
  const out: CitireRetea[] = [];
  for (const c of body.citiri) {
    if (!obiect(c)) return { ok: false, error: 'Citire invalidă (nu e obiect)' };
    if (Object.keys(c).some(k => !CHEI.includes(k))) return { ok: false, error: 'Cheie necunoscută pe citire' };
    if (typeof c.extern_id !== 'string' || !/^[a-z0-9.\-]{1,64}$/.test(c.extern_id)) {
      return { ok: false, error: 'extern_id invalid' };
    }
    if (vazute.has(c.extern_id)) return { ok: false, error: 'extern_id duplicat' };
    vazute.add(c.extern_id);
    if (typeof c.online !== 'boolean') return { ok: false, error: 'online: boolean necesar' };
    if ('latency_ms' in c && !numarIn(c.latency_ms, 0, 60000)) return { ok: false, error: 'latency_ms invalid' };
    if ('cpu_temp' in c && !numarIn(c.cpu_temp, -20, 120)) return { ok: false, error: 'cpu_temp invalid' };
    if ('hdd_max' in c && !numarIn(c.hdd_max, -20, 120)) return { ok: false, error: 'hdd_max invalid' };
    if ('cpu_load' in c && !numarIn(c.cpu_load, 0, 100)) return { ok: false, error: 'cpu_load invalid' };
    if ('uptime_s' in c && (typeof c.uptime_s !== 'number' || !Number.isFinite(c.uptime_s) || c.uptime_s < 0)) {
      return { ok: false, error: 'uptime_s invalid' };
    }
    if ('disk_pct' in c && !numarIn(c.disk_pct, 0, 100)) return { ok: false, error: 'disk_pct invalid' };
    if ('ram_pct' in c && !numarIn(c.ram_pct, 0, 100)) return { ok: false, error: 'ram_pct invalid' };
    if ('raid_ok' in c && typeof c.raid_ok !== 'boolean') return { ok: false, error: 'raid_ok invalid' };
    // Server AI (09.10.2026): chei GPU opționale
    if ('gpu_temp' in c && !numarIn(c.gpu_temp, -20, 120)) return { ok: false, error: 'gpu_temp invalid' };
    if ('gpu_w' in c && !numarIn(c.gpu_w, 0, 1000)) return { ok: false, error: 'gpu_w invalid' };
    if ('gpu_util' in c && !numarIn(c.gpu_util, 0, 100)) return { ok: false, error: 'gpu_util invalid' };
    if ('vram_pct' in c && !numarIn(c.vram_pct, 0, 100)) return { ok: false, error: 'vram_pct invalid' };
    // Limite cont Antigravity (09.10.2026): procent rămas + reset ca epoch secunde, opționale
    if ('ai_gemini_ramas_pct' in c && !numarIn(c.ai_gemini_ramas_pct, 0, 100)) return { ok: false, error: 'ai_gemini_ramas_pct invalid' };
    if ('ai_claude_ramas_pct' in c && !numarIn(c.ai_claude_ramas_pct, 0, 100)) return { ok: false, error: 'ai_claude_ramas_pct invalid' };
    if ('ai_gemini_reset_s' in c && !numarIn(c.ai_gemini_reset_s, 0, 4e9)) return { ok: false, error: 'ai_gemini_reset_s invalid' };
    if ('ai_claude_reset_s' in c && !numarIn(c.ai_claude_reset_s, 0, 4e9)) return { ok: false, error: 'ai_claude_reset_s invalid' };
    out.push({
      extern_id: c.extern_id,
      online: c.online,
      latency_ms: (c.latency_ms ?? null) as number | null,
      cpu_temp: (c.cpu_temp ?? null) as number | null,
      hdd_max: (c.hdd_max ?? null) as number | null,
      cpu_load: (c.cpu_load ?? null) as number | null,
      uptime_s: (c.uptime_s ?? null) as number | null,
      disk_pct: (c.disk_pct ?? null) as number | null,
      ram_pct: (c.ram_pct ?? null) as number | null,
      raid_ok: (c.raid_ok ?? null) as boolean | null,
      gpu_temp: (c.gpu_temp ?? null) as number | null,
      gpu_w: (c.gpu_w ?? null) as number | null,
      gpu_util: (c.gpu_util ?? null) as number | null,
      vram_pct: (c.vram_pct ?? null) as number | null,
      ai_gemini_ramas_pct: (c.ai_gemini_ramas_pct ?? null) as number | null,
      ai_claude_ramas_pct: (c.ai_claude_ramas_pct ?? null) as number | null,
      ai_gemini_reset_s: (c.ai_gemini_reset_s ?? null) as number | null,
      ai_claude_reset_s: (c.ai_claude_reset_s ?? null) as number | null,
    });
  }
  return { ok: true, citiri: out };
}
