import { valideazaCitire } from './valideaza.ts';

function assert(ok: unknown, mesaj = 'Asserție eșuată'): asserts ok {
  if (!ok) throw new Error(mesaj);
}
Deno.test('valid: maxime calculate, uptime peste 120 secunde', () => {
  const r = valideazaCitire({ ambient: 28, cpu: 55, nvme: [42, 48], discuri: [{ dev: '/dev/sda', temp: 34 }, { dev: '/dev/sdb', temp: 39 }], uptime_s: 987654 });
  assert(r.ok);
  assert(r.valori.disc_max === 39 && r.valori.nvme_max === 48 && r.valori.uptime_s === 987654);
});
Deno.test('cheie în plus inclusiv în disc / maxime impuse de client', () => {
  for (const body of [{ extra: 1 }, { disc_max: 50 }, { discuri: [{ dev: '/dev/sda', temp: 30, extra: 1 }] }]) assert(!valideazaCitire(body).ok);
});
Deno.test('NaN, Infinity, 500, tipuri greșite și null explicit sunt respinse', () => {
  for (const t of [NaN, Infinity, -Infinity, 500, -21, '30', null, true]) {
    for (const body of [{ cpu: t }, { ambient: t }, { nvme: [t] }, { discuri: [{ dev: '/dev/sda', temp: t }] }]) assert(!valideazaCitire(body).ok);
  }
});
Deno.test('dev cu ;, path invalid sau duplicate', () => {
  for (const dev of ['/dev/sda;id', '/dev/../sda', 'sda', '/dev/SDA', '/dev/a']) assert(!valideazaCitire({ discuri: [{ dev, temp: 30 }] }).ok);
  assert(!valideazaCitire({ discuri: [{ dev: '/dev/sda', temp: 30 }, { dev: '/dev/sda', temp: 32 }] }).ok);
});
Deno.test('16 discuri acceptate, 17 respinse', () => {
  const discuri = Array.from({ length: 17 }, (_, i) => ({ dev: `/dev/sd${String.fromCharCode(97 + i)}`, temp: 30 }));
  assert(!valideazaCitire({ discuri }).ok);
  assert(valideazaCitire({ discuri: discuri.slice(0, 16) }).ok);
});
Deno.test('body gol acceptat pentru alerta de citire goală', () => {
  for (const body of [{}, { nvme: [], discuri: [] }, { uptime_s: 300 }]) {
    const r = valideazaCitire(body); assert(r.ok);
    assert(r.valori.cpu === null && r.valori.ambient === null && r.valori.disc_max === null && r.valori.nvme_max === null);
  }
  for (const body of [null, [], '', 1, { nvme: {} }, { discuri: null }]) assert(!valideazaCitire(body).ok);
});
Deno.test('limite inclusive și uptime nenegativ finit', () => {
  assert(valideazaCitire({ ambient: -20, cpu: 120, uptime_s: 0 }).ok);
  for (const uptime_s of [-1, NaN, Infinity, '20', null]) assert(!valideazaCitire({ uptime_s }).ok);
});
