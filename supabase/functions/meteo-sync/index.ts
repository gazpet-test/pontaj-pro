// meteo-sync — vremea pe sediu + șantiere din Xweather (Vaisala) → public.meteo_cache
//
// Rulează din cron (meteo_sync_2h, la 2 ore) cu antet x-meteo-secret = Vault METEO_CRON_SECRET,
// sau manual de un user logat (JWT) cu {forta:true}. Credențialele Xweather (client_id/client_secret)
// stau în Vault (XWEATHER_CLIENT_ID / XWEATHER_CLIENT_SECRET), citite prin RPC meteo_xweather_creds() (service_role).
// Pentru fiecare site activ cu lat/lng (sau localitate_meteo): conditions + forecasts (4 zile) + alerts.
// Erorile per site nu opresc bucla — se scriu în răspuns; cache-ul vechi rămâne.
import { createClient } from 'npm:@supabase/supabase-js@2';

const API = 'https://data.api.xweather.com';
const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info, x-meteo-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
  const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
  const db = createClient(SUPA_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  let body: any = {}; try { body = await req.json(); } catch { /* gol */ }

  // autentificare: secret cron sau JWT user
  const sec = req.headers.get('x-meteo-secret') || '';
  if (sec) {
    const { data: cs } = await db.rpc('meteo_cron_secret');
    if (!cs || cs !== sec) return json({ error: 'secret invalid' }, 401);
  } else {
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!jwt) return json({ error: 'fără autentificare' }, 401);
    const uc = createClient(SUPA_URL, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
    const { data } = await uc.auth.getUser();
    if (!data?.user) return json({ error: 'token invalid' }, 401);
  }

  const { data: creds } = await db.rpc('meteo_xweather_creds');
  const cid = creds?.client_id, csec = creds?.client_secret;
  if (!cid || !csec) return json({ error: 'XWEATHER_CLIENT_ID / XWEATHER_CLIENT_SECRET lipsă în Vault' }, 500);
  const auth = `client_id=${encodeURIComponent(cid)}&client_secret=${encodeURIComponent(csec)}`;

  const { data: sites } = await db.from('sites').select('id, name, lat, lng, localitate_meteo, tip_locatie, raport_zilnic_necesar, meteo_activ').eq('active', true).eq('meteo_activ', true);
  const tinte = (sites || []).filter(s => (s.lat && s.lng) || s.localitate_meteo).filter(s => s.tip_locatie === 'sediu' || s.raport_zilnic_necesar || body.toate);
  const loc = (s: any) => s.lat && s.lng ? `${s.lat},${s.lng}` : encodeURIComponent(s.localitate_meteo);
  const get = async (path: string) => {
    const r = await fetch(`${API}/${path}${path.includes('?') ? '&' : '?'}${auth}`);
    const j = await r.json().catch(() => ({}));
    if (!j.success && j.error?.code !== 'warn_no_data') throw new Error(j.error?.description || `Xweather ${r.status}`);
    return j.response;
  };

  // Cotă Xweather 15k accese/lună: conditions la fiecare rulare (cron la 2h), prognoza + alertele doar
  // de 4 ori pe zi (orele UTC 4/10/16/22 → 7/13/19/01 ora României) sau când e cerut {complet:true}.
  const complet = !!body.complet || !!body.forta || new Date().getUTCHours() % 6 === 4;
  const rez: any[] = [];
  for (const s of tinte) {
    try {
      const [cond, fc, al, aq] = await Promise.all([
        get(`conditions/${loc(s)}?fields=periods.tempC,periods.feelslikeC,periods.weather,periods.icon,periods.windSpeedKPH,periods.windGustKPH,periods.windDir,periods.humidity,periods.precipMM,periods.pop,periods.isDay,periods.dateTimeISO`),
        complet ? get(`forecasts/${loc(s)}?filter=day&limit=4&fields=periods.dateTimeISO,periods.maxTempC,periods.minTempC,periods.weather,periods.icon,periods.precipMM,periods.pop,periods.windSpeedMaxKPH,periods.windGustKPH`) : null,
        complet ? get(`alerts/${loc(s)}?limit=5&fields=details.name,details.type,timestamps.beginsISO,timestamps.expiresISO`).catch(() => []) : null,
        complet ? get(`airquality/${loc(s)}?fields=periods.aqi,periods.category,periods.dominant,periods.pollutants,periods.dateTimeISO`).catch(() => null) : null,
      ]);
      const p = (Array.isArray(cond) ? cond[0] : cond)?.periods?.[0];
      if (!p) throw new Error('fără date conditions');
      const curent = { temp: p.tempC, feels: p.feelslikeC, vreme: p.weather, icon: p.icon, vant_kph: p.windSpeedKPH, rafale_kph: p.windGustKPH, dir: p.windDir, umiditate: p.humidity, precip_mm: p.precipMM, prob: p.pop, is_day: p.isDay, la: p.dateTimeISO };
      const row: any = { site_id: s.id, curent, actualizat_la: new Date().toISOString(), sursa: 'xweather' };
      if (complet) {
        row.prognoza = ((Array.isArray(fc) ? fc[0] : fc)?.periods || []).map((d: any) => ({ data: (d.dateTimeISO || '').slice(0, 10), max: d.maxTempC, min: d.minTempC, vreme: d.weather, icon: d.icon, precip_mm: d.precipMM, prob: d.pop, vant_kph: d.windSpeedMaxKPH, rafale_kph: d.windGustKPH }));
        row.alerte = (Array.isArray(al) ? al : []).map((a: any) => ({ titlu: a.details?.name, tip: a.details?.type, de_la: a.timestamps?.beginsISO, pana_la: a.timestamps?.expiresISO }));
        const a = (Array.isArray(aq) ? aq[0] : aq)?.periods?.[0];
        if (a) {
          const pol = (t: string) => (a.pollutants || []).find((x: any) => x.type === t)?.valueUGM3 ?? null;
          row.aer = { aqi: a.aqi, categorie: a.category, poluant: a.dominant, pm25: pol('pm2.5'), pm10: pol('pm10'), la: a.dateTimeISO };
        }
      }
      await db.from('meteo_cache').upsert(row, { onConflict: 'site_id' });
      rez.push({ site: s.id, ok: true, temp: p.tempC, vreme: p.weather, complet });
    } catch (e) {
      rez.push({ site: s.id, ok: false, eroare: (e as Error).message });
    }
  }
  return json({ ok: true, n: rez.length, rez });
});
