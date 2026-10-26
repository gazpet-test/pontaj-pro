// tuya — dispozitive Tuya (camere de santier, prize, senzori) prin Tuya Cloud OpenAPI (oficial) → iot_dispozitive / iot_citiri
//
// Proiect „ERP Gazpet” pe platform.tuya.com (Central Europe → openapi.tuyaeu.com). Chei in Vault: TUYA_ACCESS_ID / TUYA_ACCESS_SECRET.
// Semnatura (v2): sign = HMAC-SHA256(secret, client_id + [access_token] + t + nonce + stringToSign).toUpperCase(),
//   stringToSign = METHOD\n sha256(body)\n headers\n url. Token: GET /v1.0/token?grant_type=1 (fara access_token in semnatura).
// Dispozitive: GET /v1.0/users/{uid}/devices pentru fiecare uid legat prin „Link App Account”; uid-urile le luam din
//   GET /v1.0/iot-01/associated-users/actions/list-users? — pe unele conturi nu e disponibil → alternativ config.uids in iot_integrari.
// Stare: GET /v1.0/iot-03/devices/{id}/status → lista {code, value}.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { autorizeazaLumini, executaLumini } from './lumini_edge.ts';

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
  if (req.method !== 'POST') return new Response('Doar POST', { status: 405, headers: CORS });
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
  const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
  const db = createClient(SUPA_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  let body: any = {}; try { body = await req.json(); } catch { return json({ error: 'JSON invalid' }, 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Obiect JSON obligatoriu' }, 400);
  if (body.actiune !== undefined && typeof body.actiune !== 'string') return json({ error: 'actiune trebuie sa fie string' }, 400);
  const actiune = body.actiune === undefined ? 'sync' : body.actiune;
  const lumini = ['comanda','test_comanda_noop','programe_tick'].includes(actiune);
  let luminiUser: string | null = null;

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
  let apeluriTuya = 0;

  if (lumini) {
    const gate = await autorizeazaLumini(req, db, actiune, !!sec);
    if (!gate.ok) return json({ error: gate.error }, gate.status || 403);
    luminiUser = gate.userId || null;
  }

  try {
    const [{ data: id }, { data: secret }, { data: integ }] = await Promise.all([
      db.rpc('iot_secret_get', { p_name: 'TUYA_ACCESS_ID' }), db.rpc('iot_secret_get', { p_name: 'TUYA_ACCESS_SECRET' }),
      db.from('iot_integrari').select('config').eq('cheie', 'tuya').maybeSingle(),
    ]);
    if ((!id || !secret) && !lumini) return json({ error: 'TUYA_ACCESS_ID / TUYA_ACCESS_SECRET lipsă în Vault' }, 500);
    const cfg = integ?.config || {};
    const configInitial = JSON.stringify(cfg);
    const BASE = cfg.endpoint || 'https://openapi.tuyaeu.com';
    let token = '';
    let cota: Error | null = null;
    let coada: Promise<unknown> = Promise.resolve();

    // apel semnat Tuya v2
    const trimite = async (method: string, path: string, bodyObj?: unknown, permis?: () => boolean) => {
      if (cota) throw cota;
      const t = String(Date.now()); const nonce = crypto.randomUUID();
      const bodyStr = bodyObj ? JSON.stringify(bodyObj) : '';
      const strToSign = [method, await sha256(bodyStr), '', path].join('\n');
      const sign = await hmac(secret, id + token + t + nonce + strToSign);
      if (permis && !permis()) throw Object.assign(new Error('Buget timp depasit in coada Tuya'),{bugetExpirat:true});
      apeluriTuya++;
      const r = await fetch(`${BASE}${path}`, { method, signal: AbortSignal.timeout(10000), headers: { client_id: id, sign, t, nonce, sign_method: 'HMAC-SHA256', ...(token ? { access_token: token } : {}), 'Content-Type': 'application/json' }, body: bodyStr || undefined });
      const j = await r.json().catch(() => ({}));
      if (!j.success) {
        const error = new Error(`${path}: ${j.code} ${j.msg || ''}`);
        // Doar raspunsul explicit de business este refuz cert; reteaua ramane incerta.
        Object.assign(error, { refuzCert: j.success === false && j.code != null });
        if (String(j.code) === '28841004' || /quota|trial.*exhaust|resource.*exhaust|insufficient.*(balance|fund)|balance.*insufficient|payment.*(required|overdue)|subscription.*expir/i.test(String(j.msg || ''))) {
          cota = error;
          Object.assign(error, { cotaTuya: true });
          // iot_alerta are dedup de 12h; verificarea comuna extinde fereastra la 24h.
          const title = 'Tuya: cota API epuizata';
          const recent = await db.from('notifications').select('id').eq('type','error').eq('title',title)
            .gt('created_at',new Date(Date.now()-86400000).toISOString()).limit(1);
          if (recent.error) throw error;
          if (!recent.data?.length) {
            const fresh = await db.from('iot_integrari').select('config').eq('cheie','tuya').maybeSingle();
            const old = fresh.data?.config;
            // Rezervare scurta pentru concurenta; dedup-ul de 24h foloseste notificarea reala.
            // Daca workerul moare inainte de RPC, nu ascundem alerta o zi intreaga.
            if (!fresh.error && old && !(Date.parse(old.cota_alerta_tuya_la)>Date.now()-600000)) {
              const reserved = {...old,cota_alerta_tuya_la:new Date().toISOString()};
              // Compare-and-set pe JSONB: un singur castigator intre sync si tick.
              const lock = await db.from('iot_integrari').update({config:reserved}).eq('cheie','tuya').eq('config',JSON.stringify(old)).select('config').maybeSingle();
              if (!lock.error && lock.data) {
                const notice = await db.rpc('iot_alerta', { p_type:'error', p_title:title,
                  p_message:`Cod ${j.code}: ${String(j.msg || '').slice(0,300)}. Apelurile acestei executii au fost oprite. Alimentati contul sau cumparati un pachet de resurse Tuya.`, p_link:'/cladire' });
                // Daca notificarea esueaza, permitem reincercarea fara sa suprascriem alte schimbari.
                if (notice.error) await db.from('iot_integrari').update({config:old}).eq('cheie','tuya').eq('config',JSON.stringify(reserved));
              }
            }
          }
        }
        throw error;
      }
      return j.result;
    };
    // Serializam transportul: dupa primul refuz de cota nu exista alte cereri in zbor.
    const call = (method: string, path: string, payload?: unknown, permis?: () => boolean) => {
      const next = coada.then(() => trimite(method,path,payload,permis));
      coada = next.catch(() => undefined);
      return next;
    };
    // Includem tokenul in calea jurnalizata a comenzilor, inclusiv esecul autentificarii Tuya.
    if (lumini) {
      let tokenPromise: Promise<void> | undefined;
      const luminiCall = async (method: string, path: string, payload?: unknown, permis?: () => boolean) => {
        if (!id || !secret) throw new Error('Chei Tuya indisponibile in Vault');
        // Inclusiv esecul este comun: nu reluam autentificarea pentru fiecare lumina.
        tokenPromise ||= call('GET','/v1.0/token?grant_type=1').then(tk => { token=tk.access_token; });
        await tokenPromise;
        return call(method,path,payload,permis);
      };
      const result = await executaLumini(db, luminiCall, { ...body, actiune }, luminiUser);
      return json({ ...result, apeluri_tuya:apeluriTuya }, result.ok ? 200 : 409);
    }
    const tk = await call('GET', '/v1.0/token?grant_type=1');
    token = tk.access_token;
    const uid = tk.uid;

    // ── STREAM LIVE (Video Live Stream autorizat 06.09.2026): URL HLS/RTSP valabil cateva minute pentru o camera
    if (actiune === 'stream') {
      const devId = String(body.device_id || ''); const tip = body.tip === 'rtsp' ? 'rtsp' : 'hls';
      if (!devId) return json({ error: 'device_id lipsă' }, 400);
      try {
        const r = await call('POST', `/v1.0/devices/${devId}/stream/actions/allocate`, { type: tip });
        return json({ ok: true, url: r?.url || null, tip, expira_s: 300 });
      } catch (e) { return json({ error: (e as Error)?.message || String(e) }, 502); } // nu marcam integrarea ca 'eroare' pt un stream esuat
    }

    // ── LISTA DISPOZITIVE ── uid-urile conturilor legate (config.uids) sau uid-ul proiectului; fallback: dispozitivele proiectului
    const cached = await db.from('iot_dispozitive').select('id,extern_id,nume,activ,meta,ultima_citire,citit_la').eq('sursa','tuya');
    if (cached.error) return json({ok:false,error:'Catalog Tuya indisponibil',apeluri_tuya:apeluriTuya},500);
    const existente = new Map<string,any>((cached.data || []).map((d:any)=>[d.extern_id,d]));
    const expirat = (stamp: unknown) => !Number.isFinite(Date.parse(String(stamp))) || Date.now()-Date.parse(String(stamp))>=6*3600000;
    const listaNoua = expirat(cfg.lista_tuya_la);
    const camereNoi = expirat(cfg.status_camere_tuya_la);
    // Rezervam intervalul inainte de API, inclusiv cand Tuya refuza lista/statusul.
    if (listaNoua || (actiune!=='lista' && camereNoi)) {
      if (listaNoua) cfg.lista_tuya_la = new Date().toISOString();
      if (actiune!=='lista' && camereNoi) cfg.status_camere_tuya_la = new Date().toISOString();
      const saved = await db.from('iot_integrari').update({config:cfg,actualizat_la:new Date().toISOString()})
        .eq('cheie','tuya').eq('config',configInitial).select('config').maybeSingle();
      if (saved.error || !saved.data) return json({ok:false,error:'Cache Tuya nesalvat sau rezervat concurent; apeluri oprite',apeluri_tuya:apeluriTuya},409);
    }
    let devs: any[] = (cached.data || []).map((d:any)=>({id:d.extern_id,name:d.nume,category:d.meta?.categorie,product_name:d.meta?.model,online:d.ultima_citire?.online}));
    const uids: string[] = Array.isArray(cfg.uids) && cfg.uids.length ? cfg.uids : (uid ? [uid] : []);
    // erorile per uid nu mai sunt inghitite in tacere (08.10.2026: sync-ul dadea n:0 fara niciun motiv vizibil) — le strangem si le scriem in iot_integrari.eroare
    const erori: string[] = [];
    if (listaNoua) {
      const gasite:any[]=[];
      for (const u of uids) {
        try { const d = await call('GET', `/v1.0/users/${u}/devices`); gasite.push(...(d || [])); }
        catch (e) { erori.push(`uid ${u}: ${(e as Error)?.message || String(e)}`); }
        if (cota) break;
      }
      if (!gasite.length && !cota) {
        try { const d = await call('GET', '/v1.3/iot-03/devices?page_size=100'); gasite.push(...(d?.list || [])); }
        catch (e) { erori.push(`iot-03: ${(e as Error)?.message || String(e)}`); }
      }
      // Dedup intre conturi; dispozitivele absente temporar raman in catalog.
      devs = [...new Map([...devs,...gasite].map(d=>[d.id,d])).values()];
      for (const d of new Map<string,any>(gasite.map(d=>[d.id,d])).values()) {
        const old = existente.get(d.id);
        if (old?.activ === false) continue;
        const patch = {sursa:'tuya',extern_id:d.id,nume:d.name,
          meta:{...old?.meta,model:d.product_name ?? old?.meta?.model,categorie:d.category ?? old?.meta?.categorie,uuid:d.uuid ?? old?.meta?.uuid,ip:d.ip ?? old?.meta?.ip,activ_la:d.active_time ?? old?.meta?.activ_la,
            tip:old?.meta?.tip || (/^(sp|camera|dvr)/.test(String(d.category))?'camera':'altul')},
          ultima_citire:{...old?.ultima_citire,online:!!d.online}};
        const mutation = old ? db.from('iot_dispozitive').update(patch).eq('id',old.id).eq('activ',true)
          : db.from('iot_dispozitive').upsert(patch,{onConflict:'sursa,extern_id',ignoreDuplicates:true});
        const saved = await mutation.select('id,extern_id,nume,activ,meta,ultima_citire,citit_la').maybeSingle();
        if (saved.error) return json({ok:false,error:'Salvare catalog esuata',apeluri_tuya:apeluriTuya},500);
        if (saved.data) existente.set(d.id,saved.data);
      }
    }
    if (cota) {await setInteg({stare:'eroare',eroare:(cota as Error).message});return json({ok:false,error:(cota as Error).message,apeluri_tuya:apeluriTuya},409);}
    const avertisment = erori.length ? erori.join(' | ').slice(0, 1000) : null;
    if (actiune === 'lista') return json({ ok: true, uid, n: devs.length, avertisment, apeluri_tuya:apeluriTuya, dispozitive: devs.map(d => ({ id: d.id, name: d.name, category: d.category, product_name: d.product_name, online: d.online })) });

    // ── STARE PER DISPOZITIV ──
    const out: any[] = [];
    for (const d of devs) {
      const anterior = existente.get(d.id);
      if (anterior?.activ === false) continue;
      const camera = anterior?.meta?.tip === 'camera' || /^(sp|camera|dvr)/.test(String(d.category));
      if (camera && !camereNoi) continue;
      let status: any[] = [];
      try { status = await call('GET', `/v1.0/iot-03/devices/${d.id}/status`); } catch { /* unele (camere) nu au status */ }
      if (cota) break;
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
      const tip = camera ? 'camera' : (v.putere_w != null || v.pornit != null) ? 'priza' : (v.temp != null || v.umiditate != null) ? 'senzor' : anterior?.meta?.tip || 'altul';
      const patch = {
        sursa: 'tuya', extern_id: d.id, nume: d.name, meta: { ...anterior?.meta, model: d.product_name, categorie: d.category, tip, uuid: d.uuid ?? anterior?.meta?.uuid, ip: d.ip ?? anterior?.meta?.ip, activ_la: d.active_time ?? anterior?.meta?.activ_la },
        ultima_citire: v, citit_la: new Date().toISOString(),
      };
      // UPDATE cu poarta activ; INSERT ignora conflictele, nu reactiveaza un rand concurent.
      const mutation = anterior ? db.from('iot_dispozitive').update(patch).eq('id',anterior.id).eq('activ',true)
        : db.from('iot_dispozitive').upsert(patch, {onConflict:'sursa,extern_id',ignoreDuplicates:true});
      const { data: disp, error: writeError } = await mutation.select('id').maybeSingle();
      if (writeError) return json({ok:false,error:'Salvare dispozitiv esuata',apeluri_tuya:apeluriTuya},500);
      if (disp?.id) await db.from('iot_citiri').insert({ dispozitiv_id: disp.id, valori: { online: v.online, pornit: v.pornit, putere_w: v.putere_w, temp: v.temp, umiditate: v.umiditate, baterie_pct: v.baterie_pct } });
      out.push({ id: d.id, nume: d.name, tip, online: v.online });
    }
    if (cota) {await setInteg({stare:'eroare',eroare:(cota as Error).message});return json({ok:false,error:(cota as Error).message,apeluri_tuya:apeluriTuya},409);}
    // 0 dispozitive + erori la listare = integrarea e „conectata” (token OK) dar listarea a esuat → pastram motivul in `eroare`
    await setInteg({ stare: 'conectat', eroare: (!out.length && avertisment) ? avertisment : null, conectat_la: new Date().toISOString() });
    return json({ ok: true, uid, n: out.length, avertisment, apeluri_tuya:apeluriTuya, dispozitive: out });
  } catch (e) {
    const msg = (e as Error)?.message || String(e);
    await setInteg({ stare: 'eroare', eroare: msg });
    return json({ error: msg, apeluri_tuya:apeluriTuya }, 500);
  }
});
