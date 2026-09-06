// salus — termostate SALUS iT600 prin cloud-ul SALUS Sense (premium.salusconnect.io) → iot_dispozitive / iot_citiri
//
// NEOFICIAL (Salus nu publica API). Protocol (dupa integrarea HA salus-it600-cloud, 2025):
//   1. login AWS Cognito (SRP) cu userul/parola din aplicatia SALUS Sense → id_token + access_token (3h) + refresh
//   2. GET  service-api.eu.premium.salusconnect.io/api/v1/occupants/slider_list           → gateway-uri
//   3. GET  .../occupants/slider_details?id=<gw>&type=gateway                              → device-uri (device_code)
//   4. POST .../devices/device_shadows {device_codes:[...]}                                → shadow-uri cu ep9:sIT600TH:* (x100)
// Credentiale in Vault: SALUS_USER / SALUS_PASS (iot_secret_get). Actiuni: sync (cron x-iot-secret sau JWT), test (JWT owner).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { CognitoUserPool, CognitoUser, AuthenticationDetails } from 'npm:amazon-cognito-identity-js@6.3.12';

const REGION = 'eu-central-1';
const POOL_ID = 'eu-central-1_XGRz3CgoY';
const CLIENT_ID = '4pk5efh3v84g5dav43imsv4fbj';
const API = 'https://service-api.eu.premium.salusconnect.io/api/v1';
const COMPANY = 'salus-eu';
const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info, x-iot-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// SRP prin librăria oficială AWS (are nevoie de un `window`/`navigator` minim în Deno)
(globalThis as any).navigator ??= { userAgent: 'deno' };
function cognitoLogin(user: string, pass: string): Promise<{ id: string; access: string; refresh: string }> {
  return new Promise((resolve, reject) => {
    const pool = new CognitoUserPool({ UserPoolId: POOL_ID, ClientId: CLIENT_ID });
    const cu = new CognitoUser({ Username: user, Pool: pool });
    cu.authenticateUser(new AuthenticationDetails({ Username: user, Password: pass }), {
      onSuccess: (s: any) => resolve({ id: s.getIdToken().getJwtToken(), access: s.getAccessToken().getJwtToken(), refresh: s.getRefreshToken().getToken() }),
      onFailure: (e: any) => reject(new Error(e?.message || String(e))),
      newPasswordRequired: () => reject(new Error('Cognito cere parolă nouă')),
      mfaRequired: () => reject(new Error('MFA activat pe contul SALUS — nu e suportat')),
    });
  });
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
  const setInteg = (patch: any) => db.from('iot_integrari').update({ ...patch, actualizat_la: new Date().toISOString() }).eq('cheie', 'salus');

  try {
    const [{ data: u }, { data: p }] = await Promise.all([db.rpc('iot_secret_get', { p_name: 'SALUS_USER' }), db.rpc('iot_secret_get', { p_name: 'SALUS_PASS' })]);
    if (!u || !p) return json({ error: 'SALUS_USER / SALUS_PASS lipsă în Vault' }, 500);
    const t = await cognitoLogin(u, p);
    const h = { 'Content-Type': 'application/json', 'x-access-token': t.access, 'x-auth-token': t.id, 'x-company-code': COMPANY };
    const api = async (path: string, init?: RequestInit) => {
      const r = await fetch(`${API}${path}`, { ...init, headers: { ...h, ...(init?.headers || {}) } });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`${path}: ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
      return j;
    };
    const lista = await api('/occupants/slider_list');
    const gws = ((lista?.data || []) as any[]).filter(x => x.type === 'gateway');
    const devices: any[] = [];
    for (const g of gws) {
      const det = await api(`/occupants/slider_details?id=${encodeURIComponent(g.id)}&type=gateway`);
      for (const it of det?.data?.items || []) { if (it.rule_trigger_key || !it.device_code) continue; devices.push({ ...it, _gw: g.id, _gw_nume: g.name }); }
    }
    const codes = devices.map(d => d.device_code);
    const sh = codes.length ? await api('/devices/device_shadows', { method: 'POST', body: JSON.stringify({ request_id: 'gazpet-erp', device_codes: codes }) }) : null;
    const shadows: Record<string, any> = {};
    for (const it of sh?.data?.success_list || []) { try { shadows[it.device_code] = JSON.parse(it.payload || '{}'); } catch { /* skip */ } }

    const out: any[] = [];
    for (const d of devices) {
      const rep = shadows[d.device_code]?.state?.reported || {};
      let props: any = null, model = d.model;
      for (const [k, val] of Object.entries(rep)) if (val && typeof val === 'object' && 'properties' in (val as any)) { props = (val as any).properties; model = (val as any).model || model; break; }
      if (!props) { out.push({ device: d.device_code, nume: d.name, ok: false, motiv: 'fără shadow' }); continue; }
      const x100 = (k: string) => typeof props[k] === 'number' ? props[k] / 100 : null;
      const v: Record<string, unknown> = {
        temp: x100('ep9:sIT600TH:LocalTemperature_x100'),
        setat: x100('ep9:sIT600TH:HeatingSetpoint_x100'),
        incalzeste: props['ep9:sIT600TH:RunningState'] != null ? (props['ep9:sIT600TH:RunningState'] & 1) === 1 : null,
        hold: props['ep9:sIT600TH:HoldType'] ?? null,     // 0 program, 2 hold temporar, 7 anti-îngheț/away
        mod: props['ep9:sIT600TH:SystemMode'] ?? null,     // 4 heat, 0 off
        umiditate: props['ep9:sIT600TH:SunnySetpoint_x100'] == null ? (props['ep9:sTempS:Humidity'] ?? null) : null,
        baterie_v: props['ep9:sBasicS:BatteryVoltage'] != null ? props['ep9:sBasicS:BatteryVoltage'] / 10 : null,
        onoff: props['ep9:sOnOffS:OnOff'] ?? null,
        online: d.online ?? d.dashboard_attributes?.online ?? null,
      };
      const este_termostat = v.temp != null;
      const { data: disp } = await db.from('iot_dispozitive').upsert({
        sursa: 'salus', extern_id: d.device_code, nume: d.name || model || d.device_code,
        meta: { model, gateway: d._gw, gateway_nume: d._gw_nume, tip: este_termostat ? 'termostat' : (v.onoff != null ? 'releu' : 'senzor'), props_chei: Object.keys(props).slice(0, 60) },
        ultima_citire: v, citit_la: new Date().toISOString(),
      }, { onConflict: 'sursa,extern_id' }).select('id').single();
      if (disp?.id) await db.from('iot_citiri').insert({ dispozitiv_id: disp.id, valori: v });
      out.push({ device: d.device_code, nume: d.name, model, ok: true, ...v });
    }
    await setInteg({ stare: 'conectat', eroare: null, conectat_la: new Date().toISOString() });
    return json({ ok: true, gateways: gws.length, dispozitive: out });
  } catch (e) {
    const msg = (e as Error)?.message || String(e);
    await setInteg({ stare: 'eroare', eroare: msg });
    return json({ error: msg }, 500);
  }
});
