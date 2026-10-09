import { assertEquals } from 'jsr:@std/assert';
import { valideazaCitiri } from './valideaza.ts';

Deno.test('lot valid cu QNAP', () => {
  const r = valideazaCitiri({ citiri: [
    { extern_id: '192.168.1.42', online: true, latency_ms: 0.5, cpu_temp: 41, hdd_max: 35, disk_pct: 72, ram_pct: 86, uptime_s: 100600, raid_ok: true },
    { extern_id: 'router-hala', online: false },
  ] });
  if (!r.ok) throw new Error(r.error);
  assertEquals(r.citiri.length, 2);
  assertEquals(r.citiri[0].cpu_temp, 41);
  assertEquals(r.citiri[0].disk_pct, 72);
  assertEquals(r.citiri[0].ram_pct, 86);
  assertEquals(r.citiri[0].raid_ok, true);
  assertEquals(r.citiri[1].online, false);
  assertEquals(r.citiri[1].cpu_temp, null);
  assertEquals(r.citiri[1].disk_pct, null);
  assertEquals(r.citiri[1].raid_ok, null);
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
Deno.test('respinge disk_pct > 100', () =>
  assertEquals(valideazaCitiri({ citiri: [{ extern_id: 'a', online: true, disk_pct: 150 }] }).ok, false));
Deno.test('respinge raid_ok non-boolean', () =>
  assertEquals(valideazaCitiri({ citiri: [{ extern_id: 'a', online: true, raid_ok: 'da' }] }).ok, false));
Deno.test('respinge peste 64 citiri', () => {
  const citiri = Array.from({ length: 65 }, (_, i) => ({ extern_id: `d-${i}`, online: true }));
  assertEquals(valideazaCitiri({ citiri }).ok, false);
});
Deno.test('server AI cu chei GPU', () => {
  const r = valideazaCitiri({ citiri: [
    { extern_id: '192.168.1.94', online: true, cpu_load: 8, ram_pct: 25, disk_pct: 8, uptime_s: 3600, gpu_temp: 45, gpu_w: 32.5, gpu_util: 3, vram_pct: 12 },
  ] });
  if (!r.ok) throw new Error(r.error);
  assertEquals(r.citiri[0].gpu_temp, 45);
  assertEquals(r.citiri[0].gpu_w, 32.5);
  assertEquals(r.citiri[0].gpu_util, 3);
  assertEquals(r.citiri[0].vram_pct, 12);
});
Deno.test('fără chei GPU rămân null', () => {
  const r = valideazaCitiri({ citiri: [{ extern_id: 'a', online: true }] });
  if (!r.ok) throw new Error(r.error);
  assertEquals(r.citiri[0].gpu_temp, null);
  assertEquals(r.citiri[0].vram_pct, null);
});
Deno.test('respinge gpu_temp absurd', () =>
  assertEquals(valideazaCitiri({ citiri: [{ extern_id: 'a', online: true, gpu_temp: 200 }] }).ok, false));
Deno.test('respinge gpu_w negativ sau > 1000', () => {
  assertEquals(valideazaCitiri({ citiri: [{ extern_id: 'a', online: true, gpu_w: -1 }] }).ok, false);
  assertEquals(valideazaCitiri({ citiri: [{ extern_id: 'a', online: true, gpu_w: 1001 }] }).ok, false);
});
Deno.test('respinge gpu_util / vram_pct > 100', () => {
  assertEquals(valideazaCitiri({ citiri: [{ extern_id: 'a', online: true, gpu_util: 101 }] }).ok, false);
  assertEquals(valideazaCitiri({ citiri: [{ extern_id: 'a', online: true, vram_pct: 101 }] }).ok, false);
});
Deno.test('respinge gpu_temp ca text', () =>
  assertEquals(valideazaCitiri({ citiri: [{ extern_id: 'a', online: true, gpu_temp: '45' }] }).ok, false));
Deno.test('server AI cu limite Antigravity', () => {
  const r = valideazaCitiri({ citiri: [
    { extern_id: '192.168.1.94', online: true, ai_gemini_ramas_pct: 68, ai_claude_ramas_pct: 100, ai_gemini_reset_s: 1791996170, ai_claude_reset_s: 1792177424 },
  ] });
  if (!r.ok) throw new Error(r.error);
  assertEquals(r.citiri[0].ai_gemini_ramas_pct, 68);
  assertEquals(r.citiri[0].ai_claude_ramas_pct, 100);
  assertEquals(r.citiri[0].ai_gemini_reset_s, 1791996170);
  assertEquals(r.citiri[0].ai_claude_reset_s, 1792177424);
});
Deno.test('fără limite AI rămân null', () => {
  const r = valideazaCitiri({ citiri: [{ extern_id: 'a', online: true }] });
  if (!r.ok) throw new Error(r.error);
  assertEquals(r.citiri[0].ai_gemini_ramas_pct, null);
  assertEquals(r.citiri[0].ai_claude_reset_s, null);
});
Deno.test('respinge procent AI în afara 0..100', () => {
  assertEquals(valideazaCitiri({ citiri: [{ extern_id: 'a', online: true, ai_gemini_ramas_pct: 101 }] }).ok, false);
  assertEquals(valideazaCitiri({ citiri: [{ extern_id: 'a', online: true, ai_claude_ramas_pct: -1 }] }).ok, false);
});
Deno.test('respinge reset ca text ISO sau în afara intervalului', () => {
  assertEquals(valideazaCitiri({ citiri: [{ extern_id: 'a', online: true, ai_gemini_reset_s: '2026-10-14T14:42:50Z' }] }).ok, false);
  assertEquals(valideazaCitiri({ citiri: [{ extern_id: 'a', online: true, ai_claude_reset_s: 5e9 }] }).ok, false);
});
Deno.test('chei AI noi: Codex + Anthropic (colector server, 10.10)', () => {
  const r = valideazaCitiri({ citiri: [{ extern_id: 'a', online: true,
    ai_codex_ramas_pct: 42, ai_codex_reset: '2026-10-12T07:00:00Z', ai_codex_masurat_la: '2026-10-09T20:58:11.123Z', ai_codex_plan: 'plus',
    ai_anthropic_saptamana_ramas_pct: 0, ai_anthropic_saptamana_fable_ramas_pct: 35, ai_anthropic_sesiune_ramas_pct: 80,
    ai_anthropic_saptamana_reset: 'Oct 12, 7:59am', ai_anthropic_saptamana_fable_reset: 'Oct 12, 7:59am', ai_anthropic_sesiune_reset: '1:00am' }] });
  if (!r.ok) throw new Error(r.error);
  assertEquals(r.citiri[0].ai_codex_ramas_pct, 42);
  assertEquals(r.citiri[0].ai_anthropic_saptamana_ramas_pct, 0);
  assertEquals(r.citiri[0].ai_anthropic_saptamana_reset, 'Oct 12, 7:59am');
  assertEquals(r.citiri[0].ai_codex_reset, '2026-10-12T07:00:00Z');
});
Deno.test('chei AI noi lipsă rămân null', () => {
  const r = valideazaCitiri({ citiri: [{ extern_id: 'a', online: true }] });
  if (!r.ok) throw new Error(r.error);
  assertEquals(r.citiri[0].ai_codex_plan, null);
  assertEquals(r.citiri[0].ai_anthropic_sesiune_ramas_pct, null);
});
Deno.test('respinge chei AI noi invalide', () => {
  const rau = (x: Record<string, unknown>) => assertEquals(valideazaCitiri({ citiri: [{ extern_id: 'a', online: true, ...x }] }).ok, false);
  rau({ ai_codex_ramas_pct: 101 });
  rau({ ai_anthropic_saptamana_ramas_pct: '0' });
  rau({ ai_codex_reset: 'Oct 12, 7:59am' });
  rau({ ai_codex_masurat_la: '2026-10-09T23:00:00+03:00' });
  rau({ ai_codex_reset: '2026-13-45T99:00:00Z' });
  rau({ ai_anthropic_sesiune_reset: '<img src=x>' });
  rau({ ai_codex_plan: 'x'.repeat(41) });
  rau({ ai_anthropic_saptamana_reset: null });
  rau({ ai_altceva_pct: 5 });
});
