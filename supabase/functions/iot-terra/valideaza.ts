export type Citire = {
  ambient: number | null;
  cpu: number | null;
  nvme: number[];
  discuri: { dev: string; temp: number }[];
  nvme_max: number | null;
  disc_max: number | null;
  uptime_s: number | null;
};
type Rezultat = { ok: true; valori: Citire } | { ok: false; error: string };
const obiect = (x: unknown): x is Record<string, unknown> =>
  x !== null && typeof x === 'object' && !Array.isArray(x);
const temperatura = (x: unknown): x is number =>
  typeof x === 'number' && Number.isFinite(x) && x >= -20 && x <= 120;

// Lipsa senzorilor este acceptată; SQL semnalează o citire fără temperaturi.
export function valideazaCitire(body: unknown): Rezultat {
  if (!obiect(body)) return { ok: false, error: 'Body trebuie să fie un obiect JSON' };
  const chei = ['ambient', 'cpu', 'nvme', 'discuri', 'uptime_s'];
  if (Object.keys(body).some(k => !chei.includes(k))) return { ok: false, error: 'Cheie necunoscută' };
  for (const k of ['ambient', 'cpu']) {
    if (k in body && !temperatura(body[k])) return { ok: false, error: `${k}: temperatură invalidă` };
  }
  if ('nvme' in body && (!Array.isArray(body.nvme) || !body.nvme.every(temperatura))) {
    return { ok: false, error: 'nvme: listă de temperaturi invalidă' };
  }
  if ('discuri' in body) {
    if (!Array.isArray(body.discuri) || body.discuri.length > 16) return { ok: false, error: 'discuri: maximum 16 discuri' };
    const devs = new Set<string>();
    for (const d of body.discuri) {
      if (!obiect(d) || Object.keys(d).some(k => !['dev', 'temp'].includes(k)) ||
          typeof d.dev !== 'string' || !/^\/dev\/[a-z0-9]{2,12}$/.test(d.dev) || !temperatura(d.temp)) {
        return { ok: false, error: 'Disc invalid (dev/temp)' };
      }
      if (devs.has(d.dev)) return { ok: false, error: 'Disc duplicat' };
      devs.add(d.dev);
    }
  }
  if ('uptime_s' in body && (typeof body.uptime_s !== 'number' || !Number.isFinite(body.uptime_s) || body.uptime_s < 0)) {
    return { ok: false, error: 'uptime_s: durată invalidă' };
  }
  const nvme = (body.nvme ?? []) as number[];
  const discuri = (body.discuri ?? []) as Citire['discuri'];
  return { ok: true, valori: {
    ambient: (body.ambient ?? null) as number | null,
    cpu: (body.cpu ?? null) as number | null,
    nvme, discuri,
    nvme_max: nvme.length ? nvme.reduce((a, b) => Math.max(a, b)) : null,
    disc_max: discuri.length ? Math.max(...discuri.map(d => d.temp)) : null,
    uptime_s: (body.uptime_s ?? null) as number | null,
  } };
}
