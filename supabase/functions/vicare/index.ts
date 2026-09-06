// vicare — integrare Viessmann ViCare (API oficial IoT v2, OAuth2 PKCE) → iot_dispozitive / iot_citiri
//
// Actiuni (POST JSON {actiune}):
//   auth_url   (JWT owner)  → genereaza PKCE + URL de autorizare Viessmann; verifier-ul sta temporar in iot_integrari.config
//   callback   (JWT owner)  {code} → schimba codul pe access+refresh; refresh-ul in Vault (VICARE_REFRESH_TOKEN)
//   sync       (x-iot-secret cron sau JWT) → refresh token → instalatii/gateways/devices → features → iot_dispozitive + iot_citiri
//   deconecteaza (JWT owner) → sterge tokenul, stare neconectat
// Client ID (public) sta in iot_integrari.config. Rate limit Viessmann: ~1450 apeluri/zi pe planul de baza →
// sync la 10 min = 144 rulari × (1 + nr_device) apeluri; OK pentru 1-3 device-uri.
import { createClient } from 'npm:@supabase/supabase-js@2';

const IAM = 'https://iam.viessmann-climatesolutions.com/idp/v3';
const API = 'https://api.viessmann-climatesolutions.com/iot/v2';
const SCOPE = 'IoT User offline_access';
const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info, x-iot-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const b64url = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// Ce citim din lista de features Viessmann (cheie → nume scurt); restul se pastreaza brut doar pentru cele „interesante”
const FEATURES: Record<string, string> = {
  'heating.sensors.temperature.outside': 'temp_exterior',
  'heating.boiler.sensors.temperature.commonSupply': 'temp_tur',
  'heating.boiler.temperature': 'temp_cazan',
  'heating.sensors.temperature.return': 'temp_retur',
  'heating.circuits.0.sensors.temperature.supply': 'temp_tur_circuit0',
  'heating.circuits.0.sensors.temperature.room': 'temp_camera',
  'heating.circuits.0.operating.modes.active': 'regim',
  'heating.circuits.0.operating.programs.active': 'program',
  'heating.dhw.sensors.temperature.hotWaterStorage': 'temp_acm',
  'heating.dhw.sensors.temperature.dhwCylinder': 'temp_acm',
  'heating.boiler.sensors.pressure.supply': 'presiune_bar',
  'heating.sensors.pressure.supply': 'presiune_bar',
  'heating.burners.0': 'arzator_activ',
  'heating.burners.0.modulation': 'modulatie_pct',
  'heating.burners.0.statistics': 'arzator_stat',
  'heating.gas.consumption.summary.heating': 'gaz_incalzire',
  'heating.gas.consumption.summary.dhw': 'gaz_acm',
  'heating.power.consumption.summary.heating': 'curent_incalzire',
  'device.messages.errors.raw': 'erori',
  'heating.boiler.serial': 'serie_cazan',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
  const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
  const db = createClient(SUPA_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  let body: any = {}; try { body = await req.json(); } catch { /* gol */ }
  const actiune = String(body.actiune || '');

  // autentificare: secret cron (doar sync) sau JWT user (owner pentru auth/callback/deconectare)
  let user: any = null, isOwner = false;
  const sec = req.headers.get('x-iot-secret') || '';
  if (sec) {
    const { data: cs } = await db.rpc('iot_secret_get', { p_name: 'IOT_CRON_SECRET' });
    if (!cs || cs !== sec) return json({ error: 'secret invalid' }, 401);
  } else {
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!jwt) return json({ error: 'fără autentificare' }, 401);
    const uc = createClient(SUPA_URL, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
    const { data } = await uc.auth.getUser(); user = data?.user;
    if (!user) return json({ error: 'token invalid' }, 401);
    const { data: prof } = await db.from('profiles').select('is_owner').eq('id', user.id).maybeSingle();
    isOwner = !!prof?.is_owner;
  }
  const { data: integ } = await db.from('iot_integrari').select('*').eq('cheie', 'vicare').maybeSingle();
  const cfg = integ?.config || {};
  if (!cfg.client_id) return json({ error: 'client_id ViCare lipsă în iot_integrari' }, 500);
  const setInteg = (patch: any) => db.from('iot_integrari').update({ ...patch, actualizat_la: new Date().toISOString() }).eq('cheie', 'vicare');

  try {
    // ── AUTH_URL ──
    if (actiune === 'auth_url') {
      if (!isOwner) return json({ error: 'doar owner' }, 403);
      const rnd = crypto.getRandomValues(new Uint8Array(48));
      const verifier = b64url(rnd.buffer);
      const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
      await setInteg({ config: { ...cfg, pkce_verifier: verifier } });
      const u = new URL(`${IAM}/authorize`);
      u.searchParams.set('client_id', cfg.client_id);
      u.searchParams.set('redirect_uri', cfg.redirect_uri);
      u.searchParams.set('response_type', 'code');
      u.searchParams.set('scope', SCOPE);
      u.searchParams.set('code_challenge', challenge);
      u.searchParams.set('code_challenge_method', 'S256');
      return json({ ok: true, url: u.toString() });
    }

    // ── CALLBACK ──
    if (actiune === 'callback') {
      if (!isOwner) return json({ error: 'doar owner' }, 403);
      if (!body.code) return json({ error: 'code lipsă' }, 400);
      if (!cfg.pkce_verifier) return json({ error: 'nu există o autorizare în curs — apasă din nou Conectează' }, 400);
      const r = await fetch(`${IAM}/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', client_id: cfg.client_id, redirect_uri: cfg.redirect_uri, code: body.code, code_verifier: cfg.pkce_verifier }) });
      const t = await r.json().catch(() => ({}));
      if (!r.ok || !t.refresh_token) throw new Error(`token: ${t.error_description || t.error || r.status}`);
      await db.rpc('iot_secret_set', { p_name: 'VICARE_REFRESH_TOKEN', p_value: t.refresh_token });
      const { pkce_verifier: _v, ...rest } = cfg;
      await setInteg({ config: rest, stare: 'conectat', eroare: null, conectat_de: user.id, conectat_la: new Date().toISOString() });
      const rez = await sync(t.access_token);
      return json({ ok: true, ...rez });
    }

    // ── DECONECTEAZA ──
    if (actiune === 'deconecteaza') {
      if (!isOwner) return json({ error: 'doar owner' }, 403);
      await db.rpc('iot_secret_set', { p_name: 'VICARE_REFRESH_TOKEN', p_value: '' });
      await setInteg({ stare: 'neconectat', eroare: null });
      return json({ ok: true });
    }

    // ── SYNC ──
    if (actiune === 'sync') {
      const { data: rt } = await db.rpc('iot_secret_get', { p_name: 'VICARE_REFRESH_TOKEN' });
      if (!rt) return json({ error: 'ViCare neconectat' }, 400);
      const r = await fetch(`${IAM}/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', client_id: cfg.client_id, refresh_token: rt }) });
      const t = await r.json().catch(() => ({}));
      if (!r.ok || !t.access_token) {
        await setInteg({ stare: 'eroare', eroare: `refresh: ${t.error_description || t.error || r.status}` });
        return json({ error: 'refresh token respins — reconectează ViCare' }, 401);
      }
      if (t.refresh_token && t.refresh_token !== rt) await db.rpc('iot_secret_set', { p_name: 'VICARE_REFRESH_TOKEN', p_value: t.refresh_token });
      const rez = await sync(t.access_token);
      return json({ ok: true, ...rez });
    }
    return json({ error: `acțiune necunoscută: ${actiune}` }, 400);
  } catch (e) {
    const msg = (e as Error)?.message || String(e);
    await setInteg({ stare: actiune === 'sync' ? 'eroare' : integ?.stare, eroare: msg });
    return json({ error: msg }, 500);
  }

  // Citeste toate instalatiile → gateways → devices → features; scrie in iot_dispozitive + iot_citiri
  async function sync(access: string) {
    const h = { Authorization: `Bearer ${access}` };
    const gi = async (path: string) => {
      const r = await fetch(`${API}${path}`, { headers: h });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`${path}: ${j?.message || j?.error || r.status}`);
      return j.data ?? j;
    };
    const inst = await gi('/equipment/installations?includeGateways=true');
    const out: any[] = [];
    for (const i of inst || []) {
      for (const g of i.gateways || []) {
        for (const d of g.devices || []) {
          if (d.deviceType === 'vitoconnect' || d.roles?.includes('type:gateway')) continue;  // gateway-ul nu are senzori utili
          const key = `${i.id}/${g.serial}/${d.id}`;
          let feats: any[] = [];
          try { feats = await gi(`/features/installations/${i.id}/gateways/${g.serial}/devices/${d.id}/features`); } catch (e) { out.push({ device: key, ok: false, eroare: (e as Error).message }); continue; }
          const v: Record<string, unknown> = {};
          for (const f of feats) {
            const nume = FEATURES[f.feature]; if (!nume || !f.isEnabled) continue;
            const p = f.properties || {};
            if (f.feature === 'heating.burners.0') v[nume] = p.active?.value ?? null;
            else if (f.feature === 'heating.burners.0.statistics') v[nume] = { ore: p.hours?.value ?? null, porniri: p.starts?.value ?? null };
            else if (f.feature.startsWith('heating.gas.consumption') || f.feature.startsWith('heating.power.consumption')) v[nume] = { azi: p.currentDay?.value ?? null, luna: p.currentMonth?.value ?? null, an: p.currentYear?.value ?? null, um: p.currentDay?.unit ?? null };
            else if (f.feature === 'device.messages.errors.raw') v[nume] = (p.entries?.value || []).map((e: any) => ({ cod: e.errorCode, prioritate: e.priority, la: e.timestamp }));
            else v[nume] = p.value?.value ?? p.value ?? null;
          }
          const { data: disp } = await db.from('iot_dispozitive').upsert({
            sursa: 'vicare', extern_id: key, nume: `${d.modelId || d.deviceType || 'Viessmann'}${g.serial ? ' · ' + g.serial : ''}`,
            meta: { installation: i.id, gateway: g.serial, device: d.id, model: d.modelId, tip: d.deviceType, adresa: i.address || null },
            ultima_citire: v, citit_la: new Date().toISOString(),
          }, { onConflict: 'sursa,extern_id' }).select('id, site_id').single();
          if (disp?.id) await db.from('iot_citiri').insert({ dispozitiv_id: disp.id, valori: v });
          out.push({ device: key, ok: true, ...v });
        }
      }
    }
    await setInteg({ stare: 'conectat', eroare: null });
    return { dispozitive: out };
  }
});
