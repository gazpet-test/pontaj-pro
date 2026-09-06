// tuya — dispozitive Tuya (camere de santier, prize, senzori) prin Tuya Cloud OpenAPI (oficial) → iot_dispozitive / iot_citiri
//
// Proiect „ERP Gazpet” pe platform.tuya.com (Central Europe → openapi.tuyaeu.com). Chei in Vault: TUYA_ACCESS_ID / TUYA_ACCESS_SECRET.
// Semnatura (v2): sign = HMAC-SHA256(secret, client_id + [access_token] + t + nonce + stringToSign).toUpperCase(),
//   stringToSign = METHOD\n sha256(body)\n headers\n url. Token: GET /v1.0/token?grant_type=1 (fara access_token in semnatura).
// Dispozitive: GET /v1.0/users/{uid}/devices pentru fiecare uid legat prin „Link App Account”; uid-urile le luam din
//   GET /v1.0/iot-01/associated-users/actions/list-users? — pe unele conturi nu e disponibil → alternativ config.uids in iot_integrari.
// Stare: GET /v1.0/iot-03/devices/{id}/status → lista {code, value}.
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info, x-iot-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const enc = new TextEncoder();
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (s: string) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
async function hmac(secret: string, msg: string) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(msg))).toUpperCase();
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
  const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
  const db = createClient(SUPA_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  let body: any = {}; try { body = await req.json(); } catch { /* gol */ }
  const actiune = String(body.actiune || 'sync');

  const sec = req.headers.get('x-iot-secret') || '';
  if (sec) {
    const { data: cs } = await db.rpc('iot_secret_get', { p_name: 'IOT_CRON_SECRET' });
    if (!cs || cs !== sec) return json({ error: 'secret invalid' }, 401);
  } else {
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!jwt) return json({ error: 'fără autentificare' }, 401);
    const uc = createClient(SUPA_URL, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
    const { data } = await uc.auth.getUser();
    if (!data?.user) return json({ error: 'token invalid' }, 401);
  }
  const setInteg = (patch: any) => db.from('iot_integrari').update({ ...patch, actualizat_la: new Date().toISOString() }).eq('cheie', 'tuya');

  try {
    const [{ data: id }, { data: secret }, { data: integ }] = await Promise.all([
      db.rpc('iot_secret_get', { p_name: 'TUYA_ACCESS_ID' }), db.rpc('iot_secret_get', { p_name: 'TUYA_ACCESS_SECRET' }),
      db.from('iot_integrari').select('config').eq('cheie', 'tuya').maybeSingle(),
    ]);
    if (!id || !secret) return json({ error: 'TUYA_ACCESS_ID / TUYA_ACCESS_SECRET lipsă în Vault' }, 500);
    const cfg = integ?.config || {};
    const BASE = cfg.endpoint || 'https://openapi.tuyaeu.com';
    let token = '';

    // apel semnat Tuya v2
    const call = async (method: string, path: string, bodyObj?: unknown) => {
      const t = String(Date.now()); const nonce = crypto.randomUUID();
      const bodyStr = bodyObj ? JSON.stringify(bodyObj) : '';
      const strToSign = [method, await sha256(bodyStr), '', path].join('\n');
      const sign = await hmac(secret, id + token + t + nonce + strToSign);
      const r = await fetch(`${BASE}${path}`, { method, headers: { client_id: id, sign, t, nonce, sign_method: 'HMAC-SHA256', ...(token ? { access_token: token } : {}), 'Content-Type': 'application/json' }, body: bodyStr || undefined });
      const j = await r.json().catch(() => ({}));
      if (!j.success) throw new Error(`${path}: ${j.code} ${j.msg || ''}`);
      return j.result;
    };
    const tk = await call('GET', '/v1.0/token?grant_type=1');
    token = tk.access_token;
    const uid = tk.uid;

    // ── LISTA DISPOZITIVE ── uid-urile conturilor legate (config.uids) sau uid-ul proiectului; fallback: dispozitivele proiectului
    let devs: any[] = [];
    const uids: string[] = Array.isArray(cfg.uids) && cfg.uids.length ? cfg.uids : (uid ? [uid] : []);
    for (const u of uids) { try { const d = await call('GET', `/v1.0/users/${u}/devices`); devs.push(...(d || [])); } catch (e) { /* uid fara drepturi */ } }
    if (!devs.length) {
      try { const d = await call('GET', '/v1.3/iot-03/devices?page_size=100'); devs = d?.list || []; } catch { /* nimic */ }
    }
    if (actiune === 'lista') return json({ ok: true, uid, n: devs.length, dispozitive: devs.map(d => ({ id: d.id, name: d.name, category: d.category, product_name: d.product_name, online: d.online })) });

    // ── STARE PER DISPOZITIV ──
    const out: any[] = [];
    for (const d of devs) {
      let status: any[] = [];
      try { status = await call('GET', `/v1.0/iot-03/devices/${d.id}/status`); } catch { /* unele (camere) nu au status */ }
      const st: Record<string, unknown> = {}; for (const s of status || []) st[s.code] = s.value;
      const v: Record<string, unknown> = {
        online: !!d.online, categorie: d.category, produs: d.product_name,
        // chei uzuale Tuya (DP codes): prize/relee, senzori, camere
        pornit: st.switch_1 ?? st.switch ?? null,
        putere_w: typeof st.cur_power === 'number' ? st.cur_power / 10 : null,
        curent_ma: st.cur_current ?? null, tensiune_v: typeof st.cur_voltage === 'number' ? st.cur_voltage / 10 : null,
        energie_kwh: typeof st.add_ele === 'number' ? st.add_ele / 100 : null,
        temp: typeof st.temp_current === 'number' ? st.temp_current / 10 : (typeof st.va_temperature === 'number' ? st.va_temperature / 10 : null),
        umiditate: st.humidity_value ?? st.va_humidity ?? null,
        baterie_pct: st.battery_percentage ?? st.battery_state ?? null,
        miscare: st.pir ?? st.motion_switch ?? null, usa: st.doorcontact_state ?? null, apa: st.watersensor_state ?? null,
        stare_bruta: st,
      };
      const tip = /^(sp|camera|dvr)/.test(String(d.category)) ? 'camera' : (v.putere_w != null || v.pornit != null) ? 'priza' : (v.temp != null || v.umiditate != null) ? 'senzor' : 'altul';
      const { data: disp } = await db.from('iot_dispozitive').upsert({
        sursa: 'tuya', extern_id: d.id, nume: d.name, meta: { model: d.product_name, categorie: d.category, tip, uuid: d.uuid, ip: d.ip, activ_la: d.active_time },
        ultima_citire: v, citit_la: new Date().toISOString(),
      }, { onConflict: 'sursa,extern_id' }).select('id').single();
      if (disp?.id) await db.from('iot_citiri').insert({ dispozitiv_id: disp.id, valori: { online: v.online, pornit: v.pornit, putere_w: v.putere_w, temp: v.temp, umiditate: v.umiditate, baterie_pct: v.baterie_pct } });
      out.push({ id: d.id, nume: d.name, tip, online: v.online });
    }
    await setInteg({ stare: 'conectat', eroare: null, conectat_la: new Date().toISOString() });
    return json({ ok: true, uid, n: out.length, dispozitive: out });
  } catch (e) {
    const msg = (e as Error)?.message || String(e);
    await setInteg({ stare: 'eroare', eroare: msg });
    return json({ error: msg }, 500);
  }
});
