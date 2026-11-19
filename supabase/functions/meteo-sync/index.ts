// meteo-sync — vremea pe sediu + șantiere din Xweather (Vaisala) → public.meteo_cache
//
// Rulează din cron (meteo_sync_2h, la 2 ore) cu antet x-meteo-secret = Vault METEO_CRON_SECRET,
// sau manual de un user logat (JWT) cu {forta:true}. Credențialele Xweather (client_id/client_secret)
// stau în Vault (XWEATHER_CLIENT_ID / XWEATHER_CLIENT_SECRET), citite prin RPC meteo_xweather_creds() (service_role).
// Pentru fiecare site activ cu lat/lng (sau localitate_meteo): conditions + forecasts (4 zile) + alerts (+ airquality după XW_AER_PE_ZI).
// Erorile per site nu opresc bucla — se scriu în răspuns; cache-ul vechi rămâne.
//
// r5 (docs/METEO_XWEATHER_COTA.md):
//  - TOATE cererile Xweather trec printr-un singur loc (clientXweather): costul din antetul X-Cost-Tokens (fără el: multiplicatorii din
//    antet sau multiplicatorul documentat, marcat „estimat”), ultimele antete de cotă (perioadă / minut) și oprirea la depășire
//    (maxhits / maxhits_daily = nimic Xweather în restul rulării; maxhits_min = o singură așteptare a minutului, în limita termenului).
//    Răspunsul are blocul `cota` (unități pe endpoint, restul perioadei, limita, resetarea, câte sunt estimate). Fără chei, fără URL-uri;
//  - un singur TERMEN, de la intrarea în handler (TERMEN_HANDLER_MS = 100 s, sub cele 120 s ale cronului): vremea curentă, istoricul
//    Open-Meteo și pasul zilnic Xweather îl respectă (cererile tăiate la termen, citirile / scrierile BD nu mai sunt așteptate după el);
//    ce nu mai are timp apare „neajuns (termen)”. Ordinea: vremea curentă (prioritară; aduce și antetele de cotă), istoricul, pasul zilnic;
//  - XW_ZILNIC_ACTIV: pasul zilnic Xweather și comanda owner-ului rulează DOAR cu valoarea exactă '1' (altfel: nicio cerere
//    conditions/summary / observations/summary, nicio citire din tabelul nou) — funcția se poate publica înaintea migrării 20261221a;
//  - XW_AER_PE_ZI (0..4, implicit 4 = ca înainte): câte dintre rulările complete cer și airquality (cost 5).
//
// r6: TOATE așteptările (corpul cererii, autentificarea, credențialele, citirile / scrierile, fetch-ul și corpul răspunsurilor) trec prin
// cuTermen / cerereRetea; depășirea înaintea primului pas = 504 „termen depășit la <ce>”. Coada zilnică are două părți (ieri / restanțe,
// partiCoada). Pasul zilnic raportează restante_vechi (zilele cu raport și fără vreme ieșite din fereastră). cota.aer_pe_zi_sursa.
//
// r7: clientul bazei = adaptorul bazaCuTermen (orice interogare mărginită singură la termen, oricum ar fi așteptată); restante_vechi verifică
// vremea exact pe zilele-șantier citite ca rapoarte (citită până la capăt); părțile cozii împletite cu rotunjire (orice prefix ≈ proporția).
//
// Istoricul meteo zilnic (migrarea 20261206a → public.meteo_istoric_zilnic), în ACEEAȘI funcție și în ACELAȘI cron (fără automatizare nouă):
//  - pasul zilnic: la rularea cron de la 04:05 UTC (o dată pe zi), pentru site-urile active cu meteo_activ și coordonate, se reiau ultimele
//    ZILE_REFACERE zile până ieri din arhiva Open-Meteo (fără cheie; cu OPEN_METEO_API_KEY dacă e setat) și se scriu cu upsert pe (site_id, data);
//    merge și dacă lipsesc credențialele Xweather; r5: cel mult BUGET_ISTORIC_ZILNIC_MS și sub termenul global;
//  - backfill-ul (o singură dată, de la data_start a proiectului fiecărui site sau de la `de_la`): DOAR owner-ul, cu {istoric_backfill:true};
//  - răspunsul arhivei e conținut extern: doar numere validate (istoric_logica.ts); o eroare pe un site nu oprește bucla și se raportează.
//
// Rezumatul zilnic Vaisala Xweather (migrarea 20261221a → public.meteo_zilnic_xweather, NEMODIFICABIL), tot aici și în ACELAȘI cron:
//  - pasul zilnic (rularea de la 04:05 UTC, doar cu XW_ZILNIC_ACTIV=1): șantierele cu meteo_activ și coordonate, dar DOAR (a) cele active
//    (raport zilnic în ultimele ZILE_ACTIVITATE zile): ieri + zilele lipsă din ultimele ZILE_RELUARE_ACTIVE, și (b) zilele-șantier cu raport
//    zilnic fără vreme din ultimele FEREASTRA_RAPOARTE_ZILE zile; ordinea rotită zilnic (rotesteCoada). Fără reverificare automată.
//    Plafon MAX_UNITATI_XW_RULARE în unități de cost (din antete; cererile eșuate socotite prudent), garda de cotă (restul perioadei trebuie
//    să acopere vremea curentă până la resetare + MARJA_COTA; fără antete: PLAFON_COTA_NECUNOSCUTA), termen propriu BUGET_XW_ZILNIC_MS
//    sub termenul global; ce nu încape = „neajunsă”, se reia a doua zi (HTTP 207). Nimic de făcut = nicio cerere;
//  - completarea zilelor vechi: DOAR owner-ul, cu {xweather_backfill:true, site_id, de_la?, pana?, max_zile?, reverifica?} — un șantier pe
//    apel, cel mult MAX_ZILE_APEL zile și MAX_UNITATI_XW_APEL unități (și garda de cotă, din antetele primite), idempotentă (o zi existentă
//    nu se mai cere / scrie; cu reverifica:true zilele existente se reverifică și o corecție târzie a furnizorului intră ca versiune nouă).
//    Reluarea: `pana` = continua_pana din răspuns, calculat DUPĂ rezultate (cea mai nouă zi nesalvată), deci nicio zi eșuată nu e sărită;
//    zile_nesalvate le enumeră, zile_fara_date le listează pe cele pentru care furnizorul nu are date (sărite);
//  - credențialele (XWEATHER_CLIENT_ID / XWEATHER_CLIENT_SECRET, Vault, prin RPC meteo_xweather_creds) se pun DOAR în URL-ul apelului;
//    cererea salvată în tabel e fără ele; răspunsurile sunt conținut extern (doar numere validate + text scurt; brutul păstrat ca probă).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { planCitire, intervale, urlArhiva, randuriDinRaspuns, ieriBucuresti, esteZi, coordValide } from './istoric_logica.ts';
import { planXweather, procesZi, clasificaRaspuns, valoriDinConditii, cerereConditii, cerereObservatii, cuCredentiale, ieriBuc,
  continuaPana, zConfirmata, PRIMA_ZI_XW, MAX_ZILE_APEL, VALORI, STATIE_EXTRA,
  motivNesalvat, rezultatLot, statusHttpXweather, type Nesalvata,
  fereastraZilnica, rotesteCoada, partiCoada, esteIeri, poateIncepeZi, motivOprire, MAX_UNITATI_XW_APEL, BUGET_XW_ZILNIC_MS, BUGET_XW_APEL_MS, MIN_TIMP_ZI_MS,
} from './xweather_zilnic_logica.ts';
import { contorNou, inregistreaza, depasire, motivDepasire, endpointDin, blocCota, totalPrudent, costZiSantier, gardaCota, incapeInCota,
  aerPeZi, cereAer, zilnicActiv, ORE_COMPLETE_UTC, MAX_UNITATI_XW_RULARE, type Contor,
} from './xweather_cota_logica.ts';

const API = 'https://data.api.xweather.com';
const ORA_ISTORIC_UTC = 4;            // cron 5 */2 * * * → o singură rulare pe zi la 04:05 UTC
const TIMP_CERERE_MS = 25_000;
const LOT_UPSERT = 500;
// r5: termenul global al handlerului (de la intrare), sub cele 120 s cât așteaptă cron-ul (meteo_cron_tick); 20 s rămân pentru răspuns
// și pentru o citire / scriere BD aflată în zbor (nu mai e așteptată după termen)
const TERMEN_HANDLER_MS = 100_000;
const BUGET_ISTORIC_ZILNIC_MS = 30_000;   // istoricul Open-Meteo din cron: cel mult 30 s (normal ≈ 19 cereri rapide), ca pasul zilnic să aibă timp
const MIN_TIMP_CERERE_MS = 2_000;         // o cerere nouă (Xweather / Open-Meteo) pleacă doar dacă mai sunt cel puțin 2 s până la termen
const MIN_TIMP_PAS_MS = 5_000;            // un site / un pas nou începe doar dacă mai sunt cel puțin 5 s
const NEAJUNS_TERMEN = 'neajuns (termen)';

// r6: eroarea de termen e distinctă de erorile BD / rețea; ajunsă până la handler (înaintea primului pas: corpul cererii, autentificarea,
// credențialele) devine răspunsul 504 „termen depășit la <ce>”, sub cele 120 s ale cronului
class TermenDepasit extends Error {
  constructor(ce: string) { super(`termen depășit la ${ce}`); }
}
// r6: tipul minim al răspunsului bazei ({ data, error }); clientul din funcțiile de mai jos e declarat `any`, iar fără tipul implicit
// rezultatul lui cuTermen ar rămâne `unknown` (deno check)
type EroareBd = { message: string; code?: string };
// deno-lint-ignore no-explicit-any
type RezBd<D = any> = { data: D | null; error: EroareBd | null };
type Creds = { client_id?: string | null; client_secret?: string | null };
// SINGURUL ajutător de termen: o promisiune / un „thenable” (builderul bazei e leneș: fiecare consumare = o cerere) e consumat O SINGURĂ dată
// (Promise.resolve) și așteptat cel mult până la termen; după el handlerul nu îl mai așteaptă (TermenDepasit). Termen trecut = nici nu se consumă.
async function cuTermen<T = RezBd>(p: PromiseLike<T>, termen: number, ce: string): Promise<T> {
  const ms = termen - Date.now();
  if (ms <= 0) throw new TermenDepasit(ce);
  let t: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([Promise.resolve(p), new Promise<never>((_, rej) => { t = setTimeout(() => rej(new TermenDepasit(ce)), ms); })]);
  } finally { clearTimeout(t); }
}
const dormi = (ms: number) => new Promise(r => setTimeout(r, ms));

// r7 (P2 r6): garanția termenului e STRUCTURALĂ, nu lexicală. bazaCuTermen = SINGURUL loc unde se creează clientul bazei (supabase-js,
// serviciu + utilizator) și singurul care atinge clientul brut. Handlerul primește doar adaptorul: fiecare builder / rpc întors de el e
// învelit, iar ORICE consumare (await, .then, Promise.all, Promise.resolve) trece prin cuTermen — un apel suspendat nu mai poate ține
// răspunsul, oricum ar fi scris. Builderul brut e consumat tot O SINGURĂ dată (cuTermen → Promise.resolve). Etichetele explicite din
// handler (cuTermen(…, 'site-urile')) rămân: dau mesajul; adaptorul e plasa care nu depinde de ele.
// deno-lint-ignore no-explicit-any
type Bd = { from: (tabel: string) => any; rpc: (functie: string, args?: Record<string, unknown>) => any };
function bazaCuTermen(url: string, termen: number) {
  const brut = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  // deno-lint-ignore no-explicit-any
  const invelit = (b: any, ce: string): any => new Proxy(b, {
    get(t, k) {
      // deno-lint-ignore no-explicit-any
      if (k === 'then') return (ok?: (v: any) => unknown, err?: (e: unknown) => unknown) => cuTermen(t, termen, ce).then(ok, err);
      const v = Reflect.get(t, k, t);
      if (typeof v !== 'function') return v;
      // metodele builderului (select / eq / order / limit / insert …) întorc tot un builder: îl învelim la fel
      return (...a: unknown[]) => {
        const r = v.apply(t, a);
        return r && typeof r === 'object' && typeof r.then === 'function' ? invelit(r, ce) : r;
      };
    },
  });
  const db: Bd = { from: (tabel) => invelit(brut.from(tabel), `tabela ${tabel}`), rpc: (f, args) => invelit(brut.rpc(f, args), `funcția ${f}`) };
  // utilizatorul din JWT (clientul cu cheia anon, folosit doar aici), tot sub termen
  const utilizator = async (jwt: string) => {
    const uc = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
    return await cuTermen(uc.auth.getUser(), termen, 'verificarea utilizatorului');
  };
  return { db, utilizator };
}

// r6: SINGURUL loc prin care pleacă o cerere de rețea (Xweather și Open-Meteo). Timpul ei = min(TIMP_CERERE_MS, termen − acum); cererea și
// citirea corpului sunt așteptate prin cuTermen (nimic nu mai e așteptat după termen), iar la depășire cererea e anulată (abort).
// Corpul ilizibil / tăiat la termen → json: undefined, cu statusul și antetele primite (costul din antete rămâne în contor).
type RaspunsRetea = { status: number; antete: Headers; json: unknown };
async function cerereRetea(url: string, termen: number, ce: string): Promise<RaspunsRetea> {
  const lim = Math.min(Date.now() + TIMP_CERERE_MS, termen);
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), Math.max(0, lim - Date.now()));
  try {
    let r: Response;
    try { r = await cuTermen(fetch(url, { signal: ctl.signal }), lim, ce); }
    catch (e) { ctl.abort(); throw e; }
    try { return { status: r.status, antete: r.headers, json: await cuTermen(r.json(), lim, ce) }; }
    catch { ctl.abort(); return { status: r.status, antete: r.headers, json: undefined }; }
  } finally { clearTimeout(t); }
}

// ── r5: SINGURUL loc prin care pleacă cererile Xweather (vremea curentă, pasul zilnic, comanda owner-ului) ──
// Credențialele doar în URL-ul cererii (niciodată în mesaje / tabel / contor). Fiecare cerere TRIMISĂ intră în contor (costul din antete sau
// estimat; ultimele antete de cotă). Rețea / timp depășit = status 0. După termen sau după o oprire (maxhits / maxhits_daily) cererea NU
// mai pleacă (`netrimisa`). maxhits_min: o singură așteptare a resetării minutului pe rulare, dacă încape până la termen; altfel oprire.
type RaspunsXw = { status: number; json: any; cerere: string; netrimisa?: string };
function clientXweather(cid: string, csec: string, contor: Contor) {
  return async (cerere: string, termen: number): Promise<RaspunsXw> => {
    const endpoint = endpointDin(cerere);
    for (;;) {
      if (contor.oprit) return { status: 0, json: null, cerere, netrimisa: 'oprit: ' + contor.oprit };
      if (termen - Date.now() < MIN_TIMP_CERERE_MS) return { status: 0, json: null, cerere, netrimisa: NEAJUNS_TERMEN };
      // deno-lint-ignore no-explicit-any
      let status = 0, json: any = null, antete: Headers | null = null;
      try {
        const r = await cerereRetea(`${API}/${cuCredentiale(cerere, cid, csec)}`, termen, 'cererea Xweather');
        status = r.status; antete = r.antete; json = r.json ?? null;
      } catch { status = 0; }
      inregistreaza(contor, endpoint, status, antete, Date.now());
      const d = depasire(status, json);
      if (d === 'minut' && contor.asteptari_minut === 0) {
        const reset = contor.minut.resetare ?? Date.now() + 60_000;
        const asteapta = Math.min(61_000, Math.max(0, reset - Date.now()) + 250);
        if (Date.now() + asteapta + MIN_TIMP_CERERE_MS < termen) { contor.asteptari_minut++; await dormi(asteapta); continue; }
      }
      if (d) contor.oprit = motivDepasire(d, status);
      return { status, json, cerere };
    }
  };
}
type ClientXw = ReturnType<typeof clientXweather>;

// deno-lint-ignore no-explicit-any
async function sincronizeazaIstoric(db: any, { mod, deLa, siteId, termen }: { mod: 'zilnic' | 'backfill'; deLa?: string | null; siteId?: number | null; termen: number }) {
  let sites: any[];
  try {
    const { data, error } = await cuTermen(db.from('sites').select('id, name, lat, lng, proiect_id').eq('active', true).eq('meteo_activ', true), termen, 'site-urile');
    if (error) return { ok: false, eroare: 'site-urile nu se pot citi: ' + error.message };
    sites = data || [];
  } catch (e) { return { ok: false, complet: false, eroare: (e as Error).message }; }
  const tinte = sites.filter((s: any) => siteId == null || s.id === siteId);
  if (siteId != null && !tinte.length) return { ok: false, eroare: `site ${siteId} inexistent, inactiv sau fără meteo_activ` };
  const start = new Map<string, string | null>();
  if (mod === 'backfill' && deLa == null) {
    const ids = [...new Set(tinte.map((s: any) => s.proiect_id).filter((x: unknown) => x != null))];
    if (ids.length) {
      try {
        const { data: pr, error: ep } = await cuTermen(db.from('executie_proiecte').select('id, data_start').in('id', ids), termen, 'proiectele');
        if (ep) return { ok: false, eroare: 'proiectele nu se pot citi: ' + ep.message };
        for (const p of pr || []) start.set(String(p.id), p.data_start ?? null);
      } catch (e) { return { ok: false, complet: false, eroare: (e as Error).message }; }
    }
  }
  const ieri = ieriBucuresti();
  let pl: ReturnType<typeof planCitire>;
  try { pl = planCitire(tinte, start, { mod, ieri, deLa: deLa ?? null }); }
  catch (e) { return { ok: false, eroare: (e as Error).message }; }
  const { plan, sarite } = pl;
  const cheie = Deno.env.get('OPEN_METEO_API_KEY') || null;
  const rez: any[] = [];
  let neajunse = 0;
  for (const p of plan) {
    const r = { site: p.site_id, de: p.de, pana: p.pana, zile_scrise: 0, lipsa: 0, respinse: 0, absente: 0, complet: true, ok: true, eroare: null as string | null };
    // r5: un site nou începe doar dacă mai e timp; altfel „neajuns (termen)” (se reia la rularea următoare: fereastra e de 7 zile)
    if (termen - Date.now() < MIN_TIMP_PAS_MS) { r.ok = false; r.complet = false; r.eroare = NEAJUNS_TERMEN; neajunse++; rez.push(r); continue; }
    try {
      for (const [de, pana] of intervale(p.de, p.pana)) {
        if (termen - Date.now() < MIN_TIMP_CERERE_MS) throw new Error(NEAJUNS_TERMEN);
        const resp = await cerereRetea(urlArhiva({ lat: p.lat, lng: p.lng, de, pana, cheie }), termen, 'arhiva Open-Meteo');
        if (resp.status < 200 || resp.status > 299) throw new Error(`arhiva Open-Meteo ${resp.status}`);
        if (resp.json === undefined) throw new Error('arhiva Open-Meteo: răspuns ilizibil sau tăiat la termen');
        const j = resp.json;
        const { randuri, lipsa, respinse, absente } = randuriDinRaspuns(j, { site_id: p.site_id, lat: p.lat, lng: p.lng, de, pana, preluatLa: new Date().toISOString() });
        r.lipsa += lipsa; r.respinse += respinse; r.absente += absente;
        for (let i = 0; i < randuri.length; i += LOT_UPSERT) {
          const lot = randuri.slice(i, i + LOT_UPSERT);
          const { error: eu } = await cuTermen(db.from('meteo_istoric_zilnic').upsert(lot, { onConflict: 'site_id,data' }), termen, 'scrierea istoricului');
          if (eu) throw new Error('scrierea istoricului: ' + eu.message);
          r.zile_scrise += lot.length;
        }
      }
    } catch (e) {
      r.ok = false; r.eroare = (e as Error).message;
      if (r.eroare === NEAJUNS_TERMEN) neajunse++;
    }
    // complet = fiecare zi cerută a ajuns în tabel (scrisă); lipsa / respinse / absente se raportează, nu se ascund
    r.complet = r.ok && r.lipsa === 0 && r.respinse === 0 && r.absente === 0;
    rez.push(r);
  }
  return { ok: rez.every(x => x.ok), complet: rez.every(x => x.complet) && !sarite.length, mod, ieri, rez, sarite, neajunse };
}

// ── rezumatul zilnic Vaisala Xweather (20261221a) ──
// ultima versiune a fiecărei zile existente, pe chei (data, pe fiecare șantier, până la pagina goală; L23); eroarea se aruncă (L18)
// deno-lint-ignore no-explicit-any
async function zileXweatherExistente(db: any, siteIds: number[], de: string, pana: string, termen: number) {
  const out = new Map<string, Map<string, Record<string, unknown>>>();
  for (const s of siteIds) {
    const m = new Map<string, Record<string, unknown>>();
    for (let ultima: string | null = null; ;) {
      let q = db.from('v_meteo_zilnic_xweather').select(['data', 'versiune', ...VALORI, ...STATIE_EXTRA].join(',')).eq('site_id', s).gte('data', de).lte('data', pana);
      if (ultima) q = q.gt('data', ultima);
      const { data, error } = await cuTermen(q.order('data', { ascending: true }).limit(1000), termen, 'zilele Xweather existente');
      if (error) throw new Error('zilele Xweather existente nu se pot citi: ' + error.message);
      if (!data || !data.length) break;
      const u = data[data.length - 1].data;
      if (ultima != null && !(u > ultima)) throw new Error('zilele Xweather: paginare neordonată');
      for (const r of data) m.set(r.data, r);
      ultima = u;
    }
    out.set(String(s), m);
  }
  return out;
}

// zilele cu raport zilnic ale șantierelor date (site_id → zile), din fereastra pasului zilnic (r5: ≥ de), keyset pe id până la pagina goală
// (plafonul de 1000 de rânduri al serverului, L23); eroarea se aruncă (L18): fără rapoarte citite nu se poate ști ce e activ
// deno-lint-ignore no-explicit-any
async function zileCuRaport(db: any, siteIds: number[], de: string, termen: number) {
  const out = new Map<string, Set<string>>();
  if (!siteIds.length) return out;
  for (let ultim = 0; ;) {
    const { data, error } = await cuTermen(db.from('rapoarte_zilnice').select('id, site_id, data').in('site_id', siteIds).gte('data', de < PRIMA_ZI_XW ? PRIMA_ZI_XW : de)
      .gt('id', ultim).order('id', { ascending: true }).limit(1000), termen, 'rapoartele zilnice');
    if (error) throw new Error('rapoartele zilnice nu se pot citi: ' + error.message);
    if (!data || !data.length) break;
    const u = Number(data[data.length - 1].id);
    if (!(u > ultim)) throw new Error('rapoartele zilnice: paginare neordonată');
    for (const r of data) {
      const k = String(r.site_id);
      if (!out.has(k)) out.set(k, new Set());
      out.get(k)!.add(String(r.data));
    }
    ultim = u;
  }
  return out;
}

// r6 (P2, L12): restanțele IEȘITE din fereastră = zilele-șantier cu raport zilnic și fără vreme, mai vechi decât fereastra pasului automat
// (le mai poate face doar comanda owner-ului). Semnal operațional, doar la pasul zilnic (întrerupătorul pornit), fără cereri la furnizor.
// r7 (P2 r6: o singură pagină de vreme pe tot intervalul putea omite zile care AU vreme → restanțe inexistente): „are vreme” se stabilește
// pentru ACELEAȘI zile-șantier citite ca rapoarte.
//  1) o pagină mărginită de rapoarte (cele mai vechi, ordine (data, id)) = zilele-șantier VERIFICATE;
//  2) pentru fiecare șantier din pagină, vremea salvată pe intervalul zilelor lui din pagină, citită PÂNĂ LA CAPĂT (cheie = data, până la
//     pagina goală; L23), sub termen. Nu se poate termina → „neajuns (termen)”, niciodată o cifră.
// Sensul: `numar` = restanțe CONFIRMATE printre cele `verificate`; `exact: false` doar când pagina de rapoarte a fost plină (POATE să fi rămas
// rapoarte neverificate; la exact 1.000 nu e sigur) → `numar` e un minim adevărat. Cost: 1 + cel puțin 2 interogări pe șantier din pagină
// (pagina cu vreme + pagina goală), plus una la fiecare 1.000 de zile cu vreme pe interval; secvențiale, după zilele servite, sub termen. Fiecare exemplu = o zi-șantier verificată complet (raport prezent, vreme absentă).
// Eroarea de citire → { eroare } (L18).
const LIMITA_RESTANTE = 1000;
// r8: la exact 1.000 de rapoarte pagina e plină fără să existe neapărat altele → exact:false = „posibil incomplet”, nu „sigur mai sunt”
const SENS_RESTANTE = 'numar = restanțe confirmate (raport fără vreme) printre zilele-șantier verificate; exact:false = pagina de rapoarte '
  + 'a fost plină (1.000), pot exista rapoarte neverificate (posibil incomplet), numar e un minim';
// deno-lint-ignore no-explicit-any
async function restanteVechi(db: any, siteIds: number[], de: string, termen: number) {
  if (termen - Date.now() < MIN_TIMP_PAS_MS) return NEAJUNS_TERMEN;
  const gol = { numar: 0, verificate: 0, exact: true, cea_mai_veche: null as string | null, exemple: [] as { site_id: number; zi: string }[],
    inainte_de: de, sens: SENS_RESTANTE };
  if (!siteIds.length || de <= PRIMA_ZI_XW) return gol;
  try {
    const { data: rap, error: er } = await cuTermen<RezBd<{ site_id: number; data: string }[]>>(db.from('rapoarte_zilnice').select('id, site_id, data')
      .in('site_id', siteIds).gte('data', PRIMA_ZI_XW).lt('data', de).order('data', { ascending: true }).order('id', { ascending: true })
      .limit(LIMITA_RESTANTE), termen, 'restanțele vechi (rapoarte)');
    if (er) return { eroare: 'restanțele vechi: rapoartele nu se pot citi: ' + er.message };
    const zile = new Map<string, { site_id: number; zi: string }>();
    // intervalul zilelor din pagină, pe fiecare șantier
    const interval = new Map<number, { de: string; pana: string }>();
    for (const r of rap || []) {
      const zi = String(r.data), s = Number(r.site_id);
      if (!esteZi(zi) || !Number.isInteger(s)) continue;
      zile.set(`${s}|${zi}`, { site_id: s, zi });
      const i = interval.get(s);
      if (!i) interval.set(s, { de: zi, pana: zi });
      else { if (zi < i.de) i.de = zi; if (zi > i.pana) i.pana = zi; }
    }
    if (!zile.size) return { ...gol, exact: (rap || []).length < LIMITA_RESTANTE };
    const verificate = zile.size;
    for (const [s, i] of interval) {
      for (let ultimaV: string | null = null; ;) {
        if (termen - Date.now() < MIN_TIMP_CERERE_MS) return NEAJUNS_TERMEN;
        let q = db.from('v_meteo_zilnic_xweather').select('data').eq('site_id', s).gte('data', i.de).lte('data', i.pana);
        if (ultimaV != null) q = q.gt('data', ultimaV);
        const { data: vr, error: ev } = await cuTermen<RezBd<{ data: string }[]>>(q.order('data', { ascending: true }).limit(LIMITA_RESTANTE),
          termen, 'restanțele vechi (vremea)');
        if (ev) return { eroare: 'restanțele vechi: vremea salvată nu se poate citi: ' + ev.message };
        if (!vr || !vr.length) break;
        const u = String(vr[vr.length - 1].data);
        if (ultimaV != null && !(u > ultimaV)) return { eroare: 'restanțele vechi: vremea salvată: paginare neordonată' };
        for (const v of vr) zile.delete(`${s}|${v.data}`);
        ultimaV = u;
      }
    }
    const rest = [...zile.values()].sort((a, b) => (a.zi < b.zi ? -1 : a.zi > b.zi ? 1 : a.site_id - b.site_id));
    return { numar: rest.length, verificate, exact: (rap || []).length < LIMITA_RESTANTE,
      cea_mai_veche: rest[0]?.zi ?? null, exemple: rest.slice(0, 10), inainte_de: de, sens: SENS_RESTANTE };
  } catch (e) {
    return e instanceof TermenDepasit ? NEAJUNS_TERMEN : { eroare: 'restanțele vechi: ' + (e as Error).message };
  }
}

// țintele vremii curente (aceeași regulă ca bucla ei): coordonate sau localitate, și sediu / raport zilnic necesar (sau `toate`)
const tinteCurente = (sites: any[], toate: boolean) =>
  (sites || []).filter(s => (s.lat && s.lng) || s.localitate_meteo).filter(s => s.tip_locatie === 'sediu' || s.raport_zilnic_necesar || toate);

// deno-lint-ignore no-explicit-any
async function sincronizeazaXweather(db: any, xw: ClientXw, contor: Contor,
  { mod, siteId = null, deLa = null, pana = null, maxZile = MAX_ZILE_APEL, reverifica = false, termenGlobal, aer }:
    { mod: 'zilnic' | 'backfill'; siteId?: number | null; deLa?: string | null; pana?: string | null; maxZile?: number; reverifica?: boolean;
      termenGlobal: number; aer: number }) {
  const t0 = Date.now();
  // termenul pasului = cel propriu (40 s zilnic / 100 s comanda owner-ului), dar niciodată după termenul global al handlerului
  const buget = mod === 'zilnic' ? BUGET_XW_ZILNIC_MS : BUGET_XW_APEL_MS;
  const termen = Math.min(t0 + buget, termenGlobal);
  const u0 = totalPrudent(contor), c0 = contor.cereri;
  const unitati = () => totalPrudent(contor) - u0;
  let oprit: string | null = null;
  let sites: any[];
  try {
    const { data, error } = await cuTermen(db.from('sites').select('id, name, lat, lng, proiect_id, localitate_meteo, tip_locatie, raport_zilnic_necesar')
      .eq('active', true).eq('meteo_activ', true), termen, 'site-urile');
    if (error) return { ok: false, eroare: 'site-urile nu se pot citi: ' + error.message };
    sites = data || [];
  } catch (e) { return { ok: false, complet: false, eroare: (e as Error).message }; }
  // garda de cotă: vremea curentă a programului cron (nu `toate`) până la resetare
  const nCurente = tinteCurente(sites, false).length;
  const tinte = sites.filter((s: any) => siteId == null || s.id === siteId);
  if (mod === 'backfill' && tinte.length !== 1) return { ok: false, eroare: `site ${siteId} inexistent, inactiv sau fără meteo_activ` };
  const start = new Map<string, string | null>();
  const ieri = ieriBuc();
  let pl: ReturnType<typeof planXweather>;
  try {
    const ids = [...new Set(tinte.map((s: any) => s.proiect_id).filter((x: unknown) => x != null))];
    if (ids.length) {
      const { data: pr, error: ep } = await cuTermen(db.from('executie_proiecte').select('id, data_start').in('id', ids), termen, 'proiectele');
      if (ep) return { ok: false, eroare: 'proiectele nu se pot citi: ' + ep.message };
      for (const p of pr || []) start.set(String(p.id), p.data_start ?? null);
    }
    // fereastra citită din BD = fereastra planului (zilnic: ultimele FEREASTRA_RAPOARTE_ZILE zile; backfill: [de_la sau start, pana sau ieri])
    let rapoarte = new Map<string, Set<string>>();
    let de: string, deCitit: number[];
    if (mod === 'zilnic') {
      de = fereastraZilnica(ieri);
      rapoarte = await zileCuRaport(db, tinte.filter((s: any) => coordValide(s.lat, s.lng)).map((s: any) => s.id), de, termen);
      deCitit = tinte.filter((s: any) => rapoarte.has(String(s.id))).map((s: any) => s.id);   // fără raport = fără țintă
    } else {
      const st = tinte.length === 1 && tinte[0].proiect_id != null ? start.get(String(tinte[0].proiect_id)) ?? null : null;
      de = deLa ?? (st && esteZi(st) ? st : PRIMA_ZI_XW);
      deCitit = tinte.map((s: any) => s.id);
    }
    const existente = await zileXweatherExistente(db, deCitit, de < PRIMA_ZI_XW ? PRIMA_ZI_XW : de, pana ?? ieri, termen);
    pl = planXweather(tinte, existente, start, { mod, ieri, deLa, pana, maxZile, reverifica, rapoarte });
  } catch (e) { return { ok: false, complet: false, eroare: (e as Error).message }; }

  // r6 (P2): restanțele ieșite din fereastră, citite DUPĂ zilele servite (au prioritate), sub termenul global
  const cuCoord = tinte.filter((s: any) => coordValide(s.lat, s.lng)).map((s: any) => s.id);
  const restante = () => restanteVechi(db, cuCoord, fereastraZilnica(ieri), termenGlobal);
  // r5 (P2): nimic de făcut (toate țintele ferestrei au vreme) → nicio cerere, nicio unitate
  if (mod === 'zilnic' && !pl.sarcini.length) {
    return { ...rezultatLot([], []), mod, ieri, sarcini: 0, nimic_de_facut: true, accese_xweather: 0, unitati_xweather: 0,
      sarite: pl.sarite, santiere_active: pl.activi, restante_vechi: await restante(), durata_ms: Date.now() - t0 };
  }
  // garda de cotă și plafonul rulării (în unități): zilnic = min(MAX_UNITATI_XW_RULARE, disponibilul de după rezerva vremii curente), sau
  // plafonul mic dacă cota e necunoscută; comanda owner-ului = MAX_UNITATI_XW_APEL (garda pe zi se aplică din antetele primite)
  const garda = gardaCota(contor, { acum: Date.now(), tinte: nCurente, aer, plafon: mod === 'zilnic' ? MAX_UNITATI_XW_RULARE : MAX_UNITATI_XW_APEL });
  const plafon = mod === 'zilnic' ? garda.plafon : MAX_UNITATI_XW_APEL;
  // ordinea parcurgerii (zilnic): rotită cu ziua calendaristică, pas = zilele-șantier care încap sigur în plafon
  const pas = Math.max(1, Math.floor(plafon / costZiSantier(contor)));
  // r6 (P1): când există și „ieri” și restanțe, cel puțin o treime din locuri e rezervată restanțelor (partiCoada), restul lui „ieri”
  const rot = mod === 'zilnic' ? rotesteCoada(pl.sarcini, ieri, pas) : { sarcini: pl.sarcini, pornire: 0 };
  const parti = mod === 'zilnic' ? partiCoada(pl.sarcini.filter(x => esteIeri(x, ieri)).length, pl.sarcini.filter(x => !esteIeri(x, ieri)).length, pas, ieri) : null;

  const r = { scrise: 0, versiuni_noi: 0, neschimbate: 0, deja: 0, lipsa: 0, respinse: 0, tranzitorii: 0, neajunse: 0, oprite: 0,
    reverificari_incomplete: 0, statii_pastrate: 0, erori: [] as string[] };
  // răspunsurile mai sărace la reverificare (nimic scris, versiunea afișată rămâne) și aliasurile tolerate folosite efectiv (r3)
  const incomplete: Nesalvata[] = [];
  const aliasuri: Record<string, number> = {};
  const faraDate: Nesalvata[] = [];
  // zilele cu rezultat DOVEDIT (scrise / existente / neschimbate / „fără date” definitiv) — doar ele mută cursorul reluării (L05)
  const confirmate = new Set<string>();
  const nesalvate: Nesalvata[] = [];
  const oprita = (s: { site_id: number; zi: string }) => { r.oprite++; nesalvate.push({ site_id: s.site_id, zi: s.zi, motiv: `oprită: ${contor.oprit}` }); };
  for (const s of rot.sarcini) {
    // o zi începe doar dacă: nicio oprire, încape sub garda de cotă (ultimele antete), încape întreagă sub plafon, mai e timp
    const costZi = costZiSantier(contor);
    oprit = contor.oprit ?? oprit;
    const neajunsa = oprit ? `neajunsă (oprit: ${oprit})`
      : incapeInCota(contor, costZi, { acum: Date.now(), tinte: nCurente, aer }) ?? poateIncepeZi(unitati(), plafon, Date.now(), termen, costZi);
    if (neajunsa) { r.neajunse++; nesalvate.push({ site_id: s.site_id, zi: s.zi, motiv: neajunsa }); continue; }
    let scriere: 'ok' | 'deja' | 'eroare' | null = null;
    // deno-lint-ignore no-explicit-any
    let z: any = null;
    try {
      const cond = await xw(cerereConditii(s), termen);
      if (cond.netrimisa) { r.neajunse++; nesalvate.push({ site_id: s.site_id, zi: s.zi, motiv: 'neajunsă (' + cond.netrimisa + ')' }); continue; }
      // depășirea cotei (maxhits / maxhits_daily, și HTTP 200 cu maxhits în corp): ziua NU se procesează, nimic nu se mai trimite
      if (contor.oprit) { oprita(s); continue; }
      oprit = motivOprire('conditions', cond.status, cond.json);
      // observațiile (a doua cerere) doar dacă ziua are valori: o zi fără date nu consumă încă un apel
      const ok = !oprit && clasificaRaspuns(cond.status, cond.json) === 'ok' && !!valoriDinConditii(cond.json, s.zi).valori;
      const obs = ok ? await xw(cerereObservatii(s), termen) : null;
      if (obs?.netrimisa) { r.neajunse++; nesalvate.push({ site_id: s.site_id, zi: s.zi, motiv: 'neajunsă (' + obs.netrimisa + ')' }); continue; }
      // r5: oprirea la observații (ex. 200 + maxhits în corp la ULTIMA sarcină) nu mai salvează ziua și nu mai raportează „complet”
      if (contor.oprit) { oprita(s); continue; }
      if (obs) oprit = motivOprire('observations', obs.status, obs.json);
      z = procesZi(s, cond, obs);
      if ('rand' in z && z.rand) {
        const { error: ei } = await cuTermen(db.from('meteo_zilnic_xweather').insert(z.rand), termenGlobal, 'scrierea zilei');
        // 23505: ziua / versiunea există deja (altă rulare) sau nicio schimbare față de versiunea anterioară — idempotent, nu eroare
        if (ei && ei.code === '23505') { scriere = 'deja'; r.deja++; }
        else if (ei) { scriere = 'eroare'; r.erori.push(`site ${s.site_id} ${s.zi}: scrierea a eșuat (${ei.code || 'eroare'})`); }
        else { scriere = 'ok'; if (z.rand.versiune > 1) r.versiuni_noi++; else r.scrise++; }
      } else if ('neschimbat' in z) r.neschimbate++;
      else if ('incomplet' in z) { r.reverificari_incomplete++; incomplete.push({ site_id: s.site_id, zi: s.zi, motiv: z.incomplet }); }
      else if ('lipsa' in z) { r.lipsa++; faraDate.push({ site_id: s.site_id, zi: s.zi, motiv: z.lipsa }); }
      else if ('respins' in z) { r.respinse++; r.erori.push(`site ${s.site_id} ${s.zi}: răspuns respins (${z.respins})`); }
      else if ('tranzitoriu' in z) r.tranzitorii++;
      else if ('eroare' in z) r.erori.push(`site ${s.site_id} ${s.zi}: ${z.eroare}`);
    } catch (e) {
      r.erori.push(`site ${s.site_id} ${s.zi}: ${(e as Error).message}`);
    }
    if (z?.statie_pastrata && (scriere === 'ok' || 'neschimbat' in z)) r.statii_pastrate++;
    for (const a of z?.aliasuri || []) aliasuri[a] = (aliasuri[a] || 0) + 1;
    if (z && zConfirmata(z, scriere)) confirmate.add(`${s.site_id}|${s.zi}`);
    else nesalvate.push({ site_id: s.site_id, zi: s.zi, motiv: motivNesalvat(z, scriere) });
  }
  oprit = contor.oprit ?? oprit;
  // reluarea (doar completarea owner-ului, un șantier): de la cea mai nouă zi NECONFIRMATĂ, nu de la plan
  const cursor = mod === 'backfill'
    ? continuaPana(pl.sarcini, new Set([...confirmate].map(k => k.split('|')[1])), pl.ramase)
    : null;
  // ok / complet / nr_nesalvate / zile_nesalvate din rezultatele zilelor (r3): orice zi cerută și nesalvată → ok:false, complet:false
  // r5: unitati_xweather = unitățile pasului (antete + estimări prudente), accese_xweather = cererile trimise, garda și plafonul folosite
  return { ...rezultatLot(r.erori, nesalvate), mod, ieri, sarcini: pl.sarcini.length, ...r, erori: r.erori.slice(0, 30),
    reverificari_incomplete_lista: incomplete.slice(0, 62), aliasuri_folosite: aliasuri, zile_fara_date: faraDate.slice(0, 62),
    sarite: pl.sarite, ramase: pl.ramase, continua_pana: cursor,
    accese_xweather: contor.cereri - c0, unitati_xweather: unitati(), plafon_unitati: plafon, cost_zi_santier: costZiSantier(contor),
    garda_cota: garda, cota_necunoscuta: !garda.cunoscuta, rotatie: { pornire: rot.pornire, pas, ...(parti ? { parti } : {}) }, buget_ms: buget,
    oprit, sarcini_pe_tinta: { activ: pl.sarcini.filter(x => x.tinta === 'activ').length, raport: pl.sarcini.filter(x => x.tinta === 'raport').length },
    santiere_active: pl.activi, ...(mod === 'zilnic' ? { restante_vechi: await restante() } : {}), durata_ms: Date.now() - t0 };
}

// ── vremea curentă (meteo_cache): neschimbată ca regulă; r5 = prin clientul unic (cost + cotă), sub termen, aerul după XW_AER_PE_ZI ──
// deno-lint-ignore no-explicit-any
async function vremeaCurenta(db: any, xw: ClientXw, contor: Contor, { body, termen, aer }: { body: any; termen: number; aer: number }) {
  let sites: any[];
  try {
    const { data, error } = await cuTermen(db.from('sites').select('id, name, lat, lng, localitate_meteo, tip_locatie, raport_zilnic_necesar, meteo_activ')
      .eq('active', true).eq('meteo_activ', true), termen, 'site-urile');
    if (error) return { rez: [], eroare: 'site-urile nu se pot citi: ' + error.message };
    sites = data || [];
  } catch (e) { return { rez: [], eroare: (e as Error).message }; }
  const tinte = tinteCurente(sites, !!body.toate);
  const loc = (s: any) => s.lat && s.lng ? `${s.lat},${s.lng}` : encodeURIComponent(s.localitate_meteo);
  const get = async (path: string) => {
    const r = await xw(path, termen);
    if (r.netrimisa) throw new Error(r.netrimisa);
    const j = r.json && typeof r.json === 'object' ? r.json : {};
    if (!j.success && j.error?.code !== 'warn_no_data') throw new Error(String(j.error?.description || `Xweather ${r.status}`).slice(0, 200));
    return j.response;
  };
  // conditions la fiecare rulare (cron la 2h), prognoza + alertele de 4 ori pe zi (orele UTC 4/10/16/22 → 7/13/19/01 ora României) sau
  // când e cerut {complet:true} / {forta:true}; aerul (cost 5) doar la orele din XW_AER_PE_ZI (la cerere manuală: dacă XW_AER_PE_ZI ≥ 1)
  const ora = new Date().getUTCHours();
  const laOra = ORE_COMPLETE_UTC.includes(ora);
  const complet = !!body.complet || !!body.forta || laOra;
  const cuAer = complet && cereAer(aer, ora, !laOra);
  const rez: any[] = [];
  for (const s of tinte) {
    if (contor.oprit) { rez.push({ site: s.id, ok: false, eroare: 'oprit: ' + contor.oprit }); continue; }
    if (termen - Date.now() < MIN_TIMP_PAS_MS) { rez.push({ site: s.id, ok: false, eroare: NEAJUNS_TERMEN }); continue; }
    try {
      const [cond, fc, al, aq] = await Promise.all([
        get(`conditions/${loc(s)}?fields=periods.tempC,periods.feelslikeC,periods.weather,periods.icon,periods.windSpeedKPH,periods.windGustKPH,periods.windDir,periods.humidity,periods.precipMM,periods.pop,periods.isDay,periods.dateTimeISO`),
        complet ? get(`forecasts/${loc(s)}?filter=day&limit=4&fields=periods.dateTimeISO,periods.maxTempC,periods.minTempC,periods.weather,periods.icon,periods.precipMM,periods.pop,periods.windSpeedMaxKPH,periods.windGustKPH`) : null,
        complet ? get(`alerts/${loc(s)}?limit=5&fields=details.name,details.type,timestamps.beginsISO,timestamps.expiresISO`).catch(() => []) : null,
        cuAer ? get(`airquality/${loc(s)}?fields=periods.aqi,periods.category,periods.dominant,periods.pollutants,periods.dateTimeISO`).catch(() => null) : null,
      ]);
      const p = (Array.isArray(cond) ? cond[0] : cond)?.periods?.[0];
      if (!p) throw new Error('fără date conditions');
      const curent = { temp: p.tempC, feels: p.feelslikeC, vreme: p.weather, icon: p.icon, vant_kph: p.windSpeedKPH, rafale_kph: p.windGustKPH, dir: p.windDir, umiditate: p.humidity, precip_mm: p.precipMM, prob: p.pop, is_day: p.isDay, la: p.dateTimeISO };
      const row: any = { site_id: s.id, curent, actualizat_la: new Date().toISOString(), sursa: 'xweather' };
      if (complet) {
        row.prognoza = ((Array.isArray(fc) ? fc[0] : fc)?.periods || []).map((d: any) => ({ data: (d.dateTimeISO || '').slice(0, 10), max: d.maxTempC, min: d.minTempC, vreme: d.weather, icon: d.icon, precip_mm: d.precipMM, prob: d.pop, vant_kph: d.windSpeedMaxKPH, rafale_kph: d.windGustKPH }));
        row.alerte = (Array.isArray(al) ? al : []).map((a: any) => ({ titlu: a.details?.name, tip: a.details?.type, de_la: a.timestamps?.beginsISO, pana_la: a.timestamps?.expiresISO }));
        // fără cererea de aer, coloana `aer` nu e în rând → upsert-ul păstrează ultima valoare (cu momentul ei, `la`)
        const a = (Array.isArray(aq) ? aq[0] : aq)?.periods?.[0];
        if (a) {
          const pol = (t: string) => (a.pollutants || []).find((x: any) => x.type === t)?.valueUGM3 ?? null;
          row.aer = { aqi: a.aqi, categorie: a.category, poluant: a.dominant, pm25: pol('pm2.5'), pm10: pol('pm10'), la: a.dateTimeISO };
        }
      }
      const { error: eu } = await cuTermen(db.from('meteo_cache').upsert(row, { onConflict: 'site_id' }), termen, 'scrierea vremii curente');
      if (eu) throw new Error('scrierea vremii curente: ' + eu.message);
      rez.push({ site: s.id, ok: true, temp: p.tempC, vreme: p.weather, complet, aer: cuAer });
    } catch (e) {
      rez.push({ site: s.id, ok: false, eroare: (e as Error).message });
    }
  }
  return { rez };
}


const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info, x-meteo-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type Json = (b: unknown, status?: number) => Response;
Deno.serve(async (req: Request) => {
  // r5: termenul global se socotește de la INTRAREA în handler
  const t0 = Date.now();
  const termen = t0 + TERMEN_HANDLER_MS;
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const json: Json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
  // r6: TOATE așteptările handlerului (corpul cererii, autentificarea, credențialele, citirile / scrierile, rețeaua) trec prin cuTermen /
  // cerereRetea. Pașii își prind singuri depășirea (o raportează și merg mai departe); cea care ajunge aici e dinaintea primului pas → 504.
  try {
    return await proceseaza(req, t0, termen, json);
  } catch (e) {
    if (e instanceof TermenDepasit) return json({ ok: false, error: e.message, termen: { ms: TERMEN_HANDLER_MS, durata_ms: Date.now() - t0 } }, 504);
    throw e;
  }
});

async function proceseaza(req: Request, t0: number, termen: number, json: Json): Promise<Response> {
  // r7: doar adaptorul (fiecare interogare / apel mărginit singur la termen); clientul brut nu e vizibil aici
  const { db, utilizator } = bazaCuTermen(Deno.env.get('SUPABASE_URL')!, termen);
  // deno-lint-ignore no-explicit-any
  let body: any = {};
  try { body = await cuTermen(req.json(), termen, 'corpul cererii'); } catch (e) { if (e instanceof TermenDepasit) throw e; /* gol */ }

  // autentificare: secret cron sau JWT user
  const sec = req.headers.get('x-meteo-secret') || '';
  let esteOwner = false;
  if (sec) {
    const { data: cs } = await cuTermen<RezBd<string>>(db.rpc('meteo_cron_secret'), termen, 'secretul cronului');
    if (!cs || cs !== sec) return json({ error: 'secret invalid' }, 401);
  } else {
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!jwt) return json({ error: 'fără autentificare' }, 401);
    const { data } = await utilizator(jwt);
    if (!data?.user) return json({ error: 'token invalid' }, 401);
    // rolul se verifică în cod (verify_jwt nu ajunge: cheia anon e și ea un JWT valid)
    const { data: pr } = await cuTermen<RezBd<{ is_owner: boolean | null }>>(db.from('profiles').select('is_owner').eq('id', data.user.id).maybeSingle(),
      termen, 'profilul utilizatorului');
    esteOwner = pr?.is_owner === true;
  }

  // r5: configurarea (variabile de mediu, fără secrete): întrerupătorul pasului zilnic și frecvența calității aerului
  const zilnicPornit = zilnicActiv(Deno.env.get('XW_ZILNIC_ACTIV'));
  const aer = aerPeZi(Deno.env.get('XW_AER_PE_ZI'));
  const contor = contorNou();
  const cota = () => ({ ...blocCota(contor), aer_pe_zi: aer.n, aer_pe_zi_invalid: aer.invalid, aer_pe_zi_sursa: aer.sursa, pas_zilnic_activ: zilnicPornit });
  const OPRIT_CONFIG = 'pas zilnic oprit (configurare)';

  // ── istoricul meteo zilnic (20261206a) ──
  if (body.istoric_backfill) {
    if (!esteOwner) return json({ error: 'doar owner-ul pornește completarea istoricului meteo' }, 403);
    const deLa = body.de_la == null ? null : String(body.de_la);
    if (deLa != null && !esteZi(deLa)) return json({ error: 'de_la invalid (AAAA-LL-ZZ)' }, 400);
    const siteId = body.site_id == null ? null : Number(body.site_id);
    if (siteId != null && !Number.isInteger(siteId)) return json({ error: 'site_id invalid' }, 400);
    return json({ ok: true, istoric: await sincronizeazaIstoric(db, { mod: 'backfill', deLa, siteId, termen }) });
  }
  // ── rezumatul zilnic Xweather (20261221a): completarea zilelor vechi, DOAR owner-ul, un șantier pe apel ──
  if (body.xweather_backfill) {
    if (!esteOwner) return json({ error: 'doar owner-ul pornește completarea vremii zilnice (Xweather)' }, 403);
    // r5: cu întrerupătorul oprit, nicio citire din tabelul nou și nicio cerere
    if (!zilnicPornit) return json({ ok: false, error: OPRIT_CONFIG, cota: cota() }, 409);
    const siteId = Number(body.site_id);
    if (!Number.isInteger(siteId) || siteId <= 0) return json({ error: 'site_id obligatoriu (un șantier pe apel)' }, 400);
    const deLa = body.de_la == null ? null : String(body.de_la);
    const pana = body.pana == null ? null : String(body.pana);
    if ((deLa != null && !esteZi(deLa)) || (pana != null && !esteZi(pana)) || (deLa != null && pana != null && deLa > pana)) return json({ error: 'de_la / pana invalide (AAAA-LL-ZZ)' }, 400);
    const maxZile = body.max_zile == null ? 31 : Number(body.max_zile);
    if (!Number.isInteger(maxZile) || maxZile < 1 || maxZile > MAX_ZILE_APEL) return json({ error: `max_zile între 1 și ${MAX_ZILE_APEL}` }, 400);
    if (body.reverifica != null && typeof body.reverifica !== 'boolean') return json({ error: 'reverifica: true / false' }, 400);
    const reverifica = body.reverifica === true;
    const { data: cr } = await cuTermen<RezBd<Creds>>(db.rpc('meteo_xweather_creds'), termen, 'credențialele Xweather');
    if (!cr?.client_id || !cr?.client_secret) return json({ error: 'XWEATHER_CLIENT_ID / XWEATHER_CLIENT_SECRET lipsă în Vault' }, 500);
    const xw = await sincronizeazaXweather(db, clientXweather(cr.client_id, cr.client_secret, contor), contor,
      { mod: 'backfill', siteId, deLa, pana, maxZile, reverifica, termenGlobal: termen, aer: aer.n });
    // r3: ok-ul de sus spune adevărul (zile nesalvate → false, HTTP 207), nu doar că funcția a rulat
    return json({ ok: xw.ok === true, xweather: xw, cota: cota() }, statusHttpXweather(xw));
  }

  // o dată pe zi din cron; la cerere doar owner-ul (pașii scriu date preluate din exterior)
  const pasZilnic = !!sec && new Date().getUTCHours() === ORA_ISTORIC_UTC;
  const { data: creds } = await cuTermen<RezBd<Creds>>(db.rpc('meteo_xweather_creds'), termen, 'credențialele Xweather');
  const cid = creds?.client_id, csec = creds?.client_secret;
  const xwc = cid && csec ? clientXweather(cid, csec, contor) : null;

  // 1) vremea curentă — prioritară; aduce și antetele de cotă pentru garda pasului zilnic
  const curent = xwc ? await vremeaCurenta(db, xwc, contor, { body, termen, aer: aer.n }) : null;

  // 2) istoricul Open-Meteo (fără Xweather): cel mult BUGET_ISTORIC_ZILNIC_MS, sub termenul global
  let istoric: unknown = null;
  if (pasZilnic || (body.istoric && (sec || esteOwner))) {
    istoric = termen - Date.now() < MIN_TIMP_PAS_MS ? { ok: false, complet: false, eroare: NEAJUNS_TERMEN }
      : await sincronizeazaIstoric(db, { mod: 'zilnic', termen: Math.min(termen, Date.now() + BUGET_ISTORIC_ZILNIC_MS) });
  }
  if (!xwc) return json({ error: 'XWEATHER_CLIENT_ID / XWEATHER_CLIENT_SECRET lipsă în Vault', istoric }, 500);

  // 3) rezumatul zilnic Xweather: o dată pe zi din cron; la cerere doar owner-ul; DOAR cu XW_ZILNIC_ACTIV=1
  // deno-lint-ignore no-explicit-any
  let xweather: any = null;
  if (pasZilnic || (body.xweather_zilnic && (sec || esteOwner))) {
    if (!zilnicPornit) xweather = { activ: false, motiv: OPRIT_CONFIG };
    else if (termen - Date.now() < MIN_TIMP_ZI_MS) xweather = { ok: false, complet: false, neajuns: NEAJUNS_TERMEN, accese_xweather: 0, unitati_xweather: 0,
      restante_vechi: NEAJUNS_TERMEN };
    else xweather = await sincronizeazaXweather(db, xwc, contor, { mod: 'zilnic', termenGlobal: termen, aer: aer.n });
  }

  const rez = curent?.rez ?? [];
  // r3: xweather_ok = null (pasul n-a rulat sau e oprit din configurare) / true (toate zilele cerute salvate) / false (parțial); parțial →
  // HTTP 207, vizibil în net._http_response.status_code al cron-ului (cron.job_run_details arată doar că cererea a fost trimisă)
  const xwRulat = xweather != null && xweather.activ !== false;
  const xwOk = xwRulat ? xweather.ok === true : null;
  // accesele (cererile) pasului zilnic la vârf (null = pasul n-a rulat); r5: tot costul rulării e în `cota`
  const xwAccese = xwRulat ? xweather.accese_xweather ?? null : null;
  return json({ ok: true, n: rez.length, rez, eroare_curente: curent?.eroare ?? null, istoric, xweather, xweather_ok: xwOk, accese_xweather: xwAccese,
    cota: cota(), termen: { ms: TERMEN_HANDLER_MS, durata_ms: Date.now() - t0 } },
    statusHttpXweather(xwRulat ? xweather : null));
}
