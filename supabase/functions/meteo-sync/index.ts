// meteo-sync — vremea pe sediu + șantiere din Xweather (Vaisala) → public.meteo_cache
//
// Rulează din cron (meteo_sync_2h, la 2 ore) cu antet x-meteo-secret = Vault METEO_CRON_SECRET,
// sau manual de un user logat (JWT) cu {forta:true}. Credențialele Xweather (client_id/client_secret)
// stau în Vault (XWEATHER_CLIENT_ID / XWEATHER_CLIENT_SECRET), citite prin RPC meteo_xweather_creds() (service_role).
// Pentru fiecare site activ cu lat/lng (sau localitate_meteo): conditions + forecasts (4 zile) + alerts.
// Erorile per site nu opresc bucla — se scriu în răspuns; cache-ul vechi rămâne.
//
// Istoricul meteo zilnic (migrarea 20261202a → public.meteo_istoric_zilnic), în ACEEAȘI funcție și în ACELAȘI cron (fără automatizare nouă):
//  - pasul zilnic: la rularea cron de la 04:05 UTC (o dată pe zi), pentru site-urile active cu meteo_activ și coordonate, se reiau ultimele
//    ZILE_REFACERE zile până ieri din arhiva Open-Meteo (fără cheie; cu OPEN_METEO_API_KEY dacă e setat) și se scriu cu upsert pe (site_id, data);
//    merge și dacă lipsesc credențialele Xweather (pasul e înaintea lor);
//  - backfill-ul (o singură dată, de la data_start a proiectului fiecărui site sau de la `de_la`): DOAR owner-ul, cu {istoric_backfill:true};
//  - răspunsul arhivei e conținut extern: doar numere validate (istoric_logica.ts); o eroare pe un site nu oprește bucla și se raportează.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { planCitire, intervale, urlArhiva, randuriDinRaspuns, ieriBucuresti, esteZi } from './istoric_logica.ts';

const API = 'https://data.api.xweather.com';
const ORA_ISTORIC_UTC = 4;            // cron 5 */2 * * * → o singură rulare pe zi la 04:05 UTC
const TIMP_CERERE_MS = 25_000;
const LOT_UPSERT = 500;

// deno-lint-ignore no-explicit-any
async function sincronizeazaIstoric(db: any, { mod, deLa, siteId }: { mod: 'zilnic' | 'backfill'; deLa?: string | null; siteId?: number | null }) {
  const { data: sites, error } = await db.from('sites').select('id, name, lat, lng, proiect_id').eq('active', true).eq('meteo_activ', true);
  if (error) return { ok: false, eroare: 'site-urile nu se pot citi: ' + error.message };
  const tinte = (sites || []).filter((s: any) => siteId == null || s.id === siteId);
  if (siteId != null && !tinte.length) return { ok: false, eroare: `site ${siteId} inexistent, inactiv sau fără meteo_activ` };
  const start = new Map<string, string | null>();
  if (mod === 'backfill' && deLa == null) {
    const ids = [...new Set(tinte.map((s: any) => s.proiect_id).filter((x: unknown) => x != null))];
    if (ids.length) {
      const { data: pr, error: ep } = await db.from('executie_proiecte').select('id, data_start').in('id', ids);
      if (ep) return { ok: false, eroare: 'proiectele nu se pot citi: ' + ep.message };
      for (const p of pr || []) start.set(String(p.id), p.data_start ?? null);
    }
  }
  const ieri = ieriBucuresti();
  let pl: ReturnType<typeof planCitire>;
  try { pl = planCitire(tinte, start, { mod, ieri, deLa: deLa ?? null }); }
  catch (e) { return { ok: false, eroare: (e as Error).message }; }
  const { plan, sarite } = pl;
  const cheie = Deno.env.get('OPEN_METEO_API_KEY') || null;
  const rez: any[] = [];
  for (const p of plan) {
    const r = { site: p.site_id, de: p.de, pana: p.pana, zile_scrise: 0, lipsa: 0, respinse: 0, ok: true, eroare: null as string | null };
    try {
      for (const [de, pana] of intervale(p.de, p.pana)) {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), TIMP_CERERE_MS);
        let j: unknown;
        try {
          const resp = await fetch(urlArhiva({ lat: p.lat, lng: p.lng, de, pana, cheie }), { signal: ctl.signal });
          if (!resp.ok) throw new Error(`arhiva Open-Meteo ${resp.status}`);
          j = await resp.json();
        } finally { clearTimeout(t); }
        const { randuri, lipsa, respinse } = randuriDinRaspuns(j, { site_id: p.site_id, lat: p.lat, lng: p.lng, de, pana, preluatLa: new Date().toISOString() });
        r.lipsa += lipsa; r.respinse += respinse;
        for (let i = 0; i < randuri.length; i += LOT_UPSERT) {
          const lot = randuri.slice(i, i + LOT_UPSERT);
          const { error: eu } = await db.from('meteo_istoric_zilnic').upsert(lot, { onConflict: 'site_id,data' });
          if (eu) throw new Error('scrierea istoricului: ' + eu.message);
          r.zile_scrise += lot.length;
        }
      }
    } catch (e) {
      r.ok = false; r.eroare = (e as Error).message;
    }
    rez.push(r);
  }
  return { ok: rez.every(x => x.ok), mod, ieri, rez, sarite };
}


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
  let esteOwner = false;
  if (sec) {
    const { data: cs } = await db.rpc('meteo_cron_secret');
    if (!cs || cs !== sec) return json({ error: 'secret invalid' }, 401);
  } else {
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!jwt) return json({ error: 'fără autentificare' }, 401);
    const uc = createClient(SUPA_URL, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
    const { data } = await uc.auth.getUser();
    if (!data?.user) return json({ error: 'token invalid' }, 401);
    // rolul se verifică în cod (verify_jwt nu ajunge: cheia anon e și ea un JWT valid)
    const { data: pr } = await db.from('profiles').select('is_owner').eq('id', data.user.id).maybeSingle();
    esteOwner = pr?.is_owner === true;
  }

  // ── istoricul meteo zilnic (20261202a) ──
  if (body.istoric_backfill) {
    if (!esteOwner) return json({ error: 'doar owner-ul pornește completarea istoricului meteo' }, 403);
    const deLa = body.de_la == null ? null : String(body.de_la);
    if (deLa != null && !esteZi(deLa)) return json({ error: 'de_la invalid (AAAA-LL-ZZ)' }, 400);
    const siteId = body.site_id == null ? null : Number(body.site_id);
    if (siteId != null && !Number.isInteger(siteId)) return json({ error: 'site_id invalid' }, 400);
    return json({ ok: true, istoric: await sincronizeazaIstoric(db, { mod: 'backfill', deLa, siteId }) });
  }
  let istoric: unknown = null;
  // o dată pe zi din cron; la cerere doar owner-ul (pasul scrie date preluate din exterior)
  if ((sec && new Date().getUTCHours() === ORA_ISTORIC_UTC) || (body.istoric && (sec || esteOwner))) {
    istoric = await sincronizeazaIstoric(db, { mod: 'zilnic' });
  }

  const { data: creds } = await db.rpc('meteo_xweather_creds');
  const cid = creds?.client_id, csec = creds?.client_secret;
  if (!cid || !csec) return json({ error: 'XWEATHER_CLIENT_ID / XWEATHER_CLIENT_SECRET lipsă în Vault', istoric }, 500);
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
  return json({ ok: true, n: rez.length, rez, istoric });
});
