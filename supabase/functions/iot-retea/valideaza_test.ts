import { assertEquals } from 'jsr:@std/assert';
import { valideazaCitiri } from './valideaza.ts';

Deno.test('lot valid cu QNAP', () => {
  const r = valideazaCitiri({ citiri: [
    { extern_id: '192.168.1.42', online: true, latency_ms: 0.5, cpu_temp: 41, hdd_max: 35 },
    { extern_id: 'router-hala', online: false },
  ] });
  if (!r.ok) throw new Error(r.error);
  assertEquals(r.citiri.length, 2);
  assertEquals(r.citiri[0].cpu_temp, 41);
  assertEquals(r.citiri[1].online, false);
  assertEquals(r.citiri[1].cpu_temp, null);
});

Deno.test('respinge body fără citiri', () => assertEquals(valideazaCitiri({}).ok, false));
Deno.test('respinge listă goală', () => assertEquals(valideazaCitiri({ citiri: [] }).ok, false));
Deno.test('respinge cheie necunoscută pe body', () => assertEquals(valideazaCitiri({ citiri: [], x: 1 }).ok, false));
Deno.test('respinge cheie necunoscută pe citire', () =>
  assertEquals(valideazaCitiri({ citiri: [{ extern_id: 'a', online: true, foo: 1 }] }).ok, false));
Deno.test('respinge extern_id invalid', () =>
  assertEquals(valideazaCitiri({ citiri: [{ extern_id: 'ABC;rm', online: true }] }).ok, false));
Deno.test('respinge extern_id duplicat', () =>
  assertEquals(valideazaCitiri({ citiri: [{ extern_id: 'a', online: true }, { extern_id: 'a', online: false }] }).ok, false));
Deno.test('respinge online lipsă', () =>
  assertEquals(valideazaCitiri({ citiri: [{ extern_id: 'a' }] }).ok, false));
Deno.test('respinge temperatură absurdă', () =>
  assertEquals(valideazaCitiri({ citiri: [{ extern_id: 'a', online: true, cpu_temp: 500 }] }).ok, false));
Deno.test('respinge cpu_load > 100', () =>
  assertEquals(valideazaCitiri({ citiri: [{ extern_id: 'a', online: true, cpu_load: 150 }] }).ok, false));
Deno.test('respinge NaN', () =>
  assertEquals(valideazaCitiri({ citiri: [{ extern_id: 'a', online: true, latency_ms: NaN }] }).ok, false));
Deno.test('respinge peste 64 citiri', () => {
  const citiri = Array.from({ length: 65 }, (_, i) => ({ extern_id: `d-${i}`, online: true }));
  assertEquals(valideazaCitiri({ citiri }).ok, false);
});
