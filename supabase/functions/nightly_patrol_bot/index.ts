// Scorilos v20 - 13.10.2026: poarta noua (acces.ts) — DOAR cron (x-bot-secret verificat in BD, Vault BOT_SECRET),
//   fara fallback in cod. Raspunsul nu mai intoarce output_text (sta in claude_bot_runs).
// v19 - 10.06.2026: KILL SWITCH - verifica settings.scorilos_enabled la inceput
//   Daca scorilos_enabled='false' => iese IMEDIAT, ZERO apeluri API => ZERO cost
// v18 - 27.05.2026: TIP NOU alim_pe_deep_sleep (frauda card pe vehicule marcate deep_sleep)
// Plus pastreaza tot v17 (fix false positives + vehicul_fara_gps_history)
import { createClient } from "jsr:@supabase/supabase-js@2";
import { autorizeaza } from "./acces.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const MAX_WEB_SEARCH_ACTIVE = Number(Deno.env.get("MAX_WEB_SEARCH_ACTIVE") || "4");
const MAX_WEB_SEARCH_DIMENSIUNI = Number(Deno.env.get("MAX_WEB_SEARCH_DIMENSIUNI") || "3");
const DELAY_BETWEEN_CALLS_MS = Number(Deno.env.get("DELAY_BETWEEN_CALLS_MS") || "4000");
const MAX_WEB_USES_PER_CALL = 2;

const ALIM_FARA_TELEM_MIN_LITRI = 50;
const KM_DISCREPANCY_MIN_DIFF = 5000;
const KM_DISCREPANCY_CRITIC_DIFF = 100000;
const GPS_HISTORY_WINDOW_DAYS = 60;
const DEEP_SLEEP_LOOKBACK_DAYS = 90; // v18: cat de departe in trecut caut alim pe vehicule deep_sleep

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-bot-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// v19: verifica daca Scorilos e activat din settings (kill switch)
async function isScorilosEnabled(): Promise<boolean> {
  const { data } = await supabase.from("settings").select("value").eq("key", "scorilos_enabled").maybeSingle();
  return data?.value !== "false";
}

function normalizeTipCarburant(v: string | null): string | null {
  if (!v) return null;
  const s = String(v).toLowerCase().trim();
  if (s.match(/^(diesel|motorin[\u0103a]|gas\u00f3leo|gasoil|dizel)$/i)) return 'motorina';
  if (s.match(/^(benzin[\u0103a]|petrol|gasoline|essence|gasolina|95|98)$/i)) return 'benzina';
  if (s.match(/^(electric|electrico|electrique|ev|battery)$/i)) return 'electric';
  if (s.match(/^(hibrid|hybrid|hybride)$/i)) return 'hibrid';
  if (s.match(/^(gpl|lpg|autogas|propan|gaz)$/i)) return 'gpl';
  return null;
}

function normalizeUnitateNorma(v: string | null): string | null {
  if (!v) return null;
  const s = String(v).toLowerCase().trim();
  if (s.match(/^l\s*\/\s*h$/)) return 'l/h';
  if (s.match(/^l\s*\/\s*100\s*km$/)) return 'l/100km';
  if (s.match(/^kwh\s*\/\s*h$/)) return 'kWh/h';
  if (s.match(/^kwh\s*\/\s*100\s*km$/)) return 'kWh/100km';
  return null;
}

function cleanModelForAI(model: string | null, nr_inmatriculare: string | null): string {
  if (!model) return '';
  let m = model;
  if (nr_inmatriculare) {
    const placutaEsc = nr_inmatriculare.replace(/\s+/g, '\\s*').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    m = m.replace(new RegExp('\\s*/?\\s*' + placutaEsc, 'gi'), '');
  }
  m = m.replace(/^\s*(AUTOTURISM|AUTOUTILITAR[\u0102A]|EXCAVATOR|BULDOZER|CILINDRU\s+COMPACTOR|COMPACTOR|MOTOPOMPA|MOTOCOMPRESOR|ELECTROCOMPRESOR|ELECTROPOMPA|REMORCA|REMORC[\u0102A]|SEMIREMORCA|SEMIREMORC[\u0102A]|CAMION|MACARA|MOTOSTIVUITOR|INCARCATOR|\u00ceNCARCATOR|MOTOSAPATOR|GENERATOR|TRAILER|CAP\s+TRACTOR|VIBROCOMPACTOR|RULOTA|RULOT[\u0102A])\s+/gi, '');
  m = m.replace(/\s+(ROSU|RO\u015eU|ALB|ALB[\u0102A]|GALBEN|GALBEN[\u0102A]|VERDE|ALBASTR[UA]|PORTOCALIU|NEGRU|NEAGR[\u0102A])\b/gi, '');
  m = m.replace(/\s*\([^)]*\)\s*/g, ' ');
  m = m.replace(/\s*\/?\s*\d{4}\s*$/g, '');
  m = m.replace(/\s+UT\s?\d{3,5}\b/gi, '');
  m = m.replace(/\s*\bNR\s+(ROSU|ALB|GALBEN)\b/gi, '');
  m = m.replace(/\s*\bNU\s+(NECESITA|AM\s+GASIT|ARE)[^,]*/gi, '');
  m = m.replace(/\s+/g, ' ').trim();
  return m;
}

function extractLastJson(txt: string): any | null {
  const cleaned = txt.replace(/```json\s*/gi, "").replace(/```\s*/g, "");
  const matches: string[] = [];
  let depth = 0, start = -1;
  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i] === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (cleaned[i] === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        matches.push(cleaned.slice(start, i + 1));
        start = -1;
      }
    }
  }
  for (let i = matches.length - 1; i >= 0; i--) {
    try { return JSON.parse(matches[i]); } catch { /* try next */ }
  }
  return null;
}

async function callAnthropic(body: any, retries = 2): Promise<{ data: any | null, status: number, txt: string }> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 429 || res.status >= 500) {
        if (attempt < retries) {
          const backoff = (attempt + 1) * 30000;
          await new Promise(r => setTimeout(r, backoff));
          continue;
        }
        return { data: null, status: res.status, txt: `${res.status} retry exhausted` };
      }
      if (!res.ok) return { data: null, status: res.status, txt: `HTTP ${res.status}` };
      const data = await res.json();
      let txt = "";
      for (const b of (data.content || [])) if (b.type === "text") txt += b.text + "\n";
      return { data, status: 200, txt };
    } catch (e: any) {
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 10000));
        continue;
      }
      return { data: null, status: 0, txt: 'EXCEPTION: ' + (e.message || String(e)).slice(0, 200) };
    }
  }
  return { data: null, status: 0, txt: 'UNREACHABLE' };
}

async function webSearchActivSpecs(act: any): Promise<{ data: any | null, errMsg: string | null }> {
  if (!ANTHROPIC_API_KEY) return { data: null, errMsg: 'NO_API_KEY' };
  const modelCurat = cleanModelForAI(act.model, act.nr_inmatriculare);
  const descriere = [act.marca && `Marca: ${act.marca}`, modelCurat && `Model: ${modelCurat}`, act.an_fabricatie && `An: ${act.an_fabricatie}`, act.capacitate_motor && `Capacitate motor: ${act.capacitate_motor}`, act.putere_kw && `Putere: ${act.putere_kw} kW`].filter(Boolean).join("\n");
  const prompt = `Cauta online specs tehnice oficiale pentru:\n${descriere}\n\nReturneaza DOAR JSON la final (fara markdown):\n{\n  "tip_carburant": "motorina"|"benzina"|"electric"|"gpl"|"hibrid"|null,\n  "norma_consum": numar zecimal sau null,\n  "unitate_norma": "l/h"|"l/100km"|"kWh/h"|"kWh/100km"|null,\n  "source_url": URL sau null,\n  "confidence": 0-1,\n  "motivare": text scurt\n}\nUtilaje grele -> l/h. Autoturisme/camioane -> l/100km. Fara date concrete -> null + confidence<0.3.`;
  const result = await callAnthropic({ model: "claude-haiku-4-5-20251001", max_tokens: 1500, tools: [{ type: "web_search_20250305", name: "web_search", max_uses: MAX_WEB_USES_PER_CALL }], messages: [{ role: "user", content: prompt }] });
  if (!result.data) return { data: null, errMsg: result.txt };
  if (!result.txt.trim()) return { data: null, errMsg: 'EMPTY_TEXT' };
  const p = extractLastJson(result.txt);
  if (!p) return { data: null, errMsg: 'NO_JSON: ' + result.txt.slice(0, 150) };
  return { data: { tip_carburant: normalizeTipCarburant(p.tip_carburant) || (p.tip_carburant || null), norma_consum: p.norma_consum != null ? Number(p.norma_consum) : null, unitate_norma: normalizeUnitateNorma(p.unitate_norma) || (p.unitate_norma || null), source_url: p.source_url || null, confidence: Math.min(Math.max(Number(p.confidence) || 0, 0), 1), motivare: String(p.motivare || "").slice(0, 500), model_curat_folosit: modelCurat }, errMsg: null };
}

async function webSearchActivDimensiuni(act: any): Promise<{ data: any | null, errMsg: string | null }> {
  if (!ANTHROPIC_API_KEY) return { data: null, errMsg: 'NO_API_KEY' };
  const modelCurat = cleanModelForAI(act.model, act.nr_inmatriculare);
  const descriere = [act.marca && `Marca: ${act.marca}`, modelCurat && `Model: ${modelCurat}`, act.an_fabricatie && `An: ${act.an_fabricatie}`].filter(Boolean).join("\n");
  const prompt = `Cauta online dimensiuni de transport pentru:\n${descriere}\n\nPentru utilaje grele dau dimensiuni TRANSPORT (cu brat pliat), nu de lucru.\n\nReturneaza DOAR JSON la final:\n{\n  "lungime_m": numar zecimal sau null,\n  "latime_m": numar zecimal sau null,\n  "inaltime_m": numar zecimal sau null,\n  "greutate_kg": numar intreg sau null,\n  "source_url": URL sau null,\n  "confidence": 0-1,\n  "motivare": text scurt romana\n}\nToate in metri si kg. Fara date concrete -> null + confidence<0.3.`;
  const result = await callAnthropic({ model: "claude-haiku-4-5-20251001", max_tokens: 1500, tools: [{ type: "web_search_20250305", name: "web_search", max_uses: MAX_WEB_USES_PER_CALL }], messages: [{ role: "user", content: prompt }] });
  if (!result.data) return { data: null, errMsg: result.txt };
  if (!result.txt.trim()) return { data: null, errMsg: 'EMPTY_TEXT' };
  const p = extractLastJson(result.txt);
  if (!p) return { data: null, errMsg: 'NO_JSON: ' + result.txt.slice(0, 150) };
  const lung = p.lungime_m != null ? Number(p.lungime_m) : null;
  const lat = p.latime_m != null ? Number(p.latime_m) : null;
  const inalt = p.inaltime_m != null ? Number(p.inaltime_m) : null;
  const gr = p.greutate_kg != null ? Math.round(Number(p.greutate_kg)) : null;
  const agabariticCalculat = (lung && lung > 22) || (lat && lat > 3) || (inalt && inalt > 4) || (gr && gr > 40000);
  return { data: { lungime_m: lung, latime_m: lat, inaltime_m: inalt, greutate_kg: gr, necesita_agabaritic: agabariticCalculat, source_url: p.source_url || null, confidence: Math.min(Math.max(Number(p.confidence) || 0, 0), 1), motivare: String(p.motivare || "").slice(0, 300), model_curat_folosit: modelCurat }, errMsg: null };
}

async function existsSimilarSuggestion(tinta_id: number, tip_sugestie: string, dayWindow: number = 7): Promise<boolean> {
  const since = new Date(Date.now() - dayWindow*24*3600*1000).toISOString();
  const { data } = await supabase.from("claude_bot_sugestii").select("id").eq("tinta_tip", "logistica_active").eq("tinta_id", tinta_id).eq("tip_sugestie", tip_sugestie).eq("status", "propus").gte("created_at", since).limit(1).maybeSingle();
  return !!data;
}

async function existsSimilarSuggestionForAlim(alim_id: number, tip_sugestie: string, dayWindow: number = 14): Promise<boolean> {
  const since = new Date(Date.now() - dayWindow*24*3600*1000).toISOString();
  const { data } = await supabase.from("claude_bot_sugestii").select("id").eq("tip_sugestie", tip_sugestie).eq("status", "propus").like("motivare", `%alim#${alim_id}%`).gte("created_at", since).limit(1).maybeSingle();
  return !!data;
}

async function activHasGpsHistory(active_id: number, windowDays: number = GPS_HISTORY_WINDOW_DAYS): Promise<boolean> {
  const since = new Date(Date.now() - windowDays*24*3600*1000).toISOString().slice(0, 10);
  const { data } = await supabase.from("logistica_telemetrie_zilnica").select("data").eq("asset_id", active_id).eq("sursa", "evogps").gte("data", since).limit(1).maybeSingle();
  return !!data;
}

async function isSilentiated(tinta_id: number, tip_sugestie: string): Promise<{silentiat: boolean, pana?: string, motiv?: string}> {
  const { data } = await supabase.from("claude_bot_silentiate").select("silentiat_pana, motiv").eq("tinta_tip", "logistica_active").eq("tinta_id", tinta_id).eq("tip_sugestie", tip_sugestie).gte("silentiat_pana", new Date().toISOString().slice(0, 10)).limit(1).maybeSingle();
  if (data) return { silentiat: true, pana: data.silentiat_pana, motiv: data.motiv };
  return { silentiat: false };
}

async function runPatrol(runType: string) {
  const started = Date.now();
  const erori: string[] = [];
  let sugestii_create = 0, alerte_emise = 0, web_searches = 0, web_searches_ok = 0;
  let dim_searches = 0, dim_searches_ok = 0;
  let silentiate_skip = 0;
  let cross_check_create = 0;
  let skip_no_gps_history = 0;
  const lines: string[] = [`Scorilos patrula ${new Date().toLocaleString("ro-RO", { timeZone: "Europe/Bucharest" })}`, ""];

  const { data: runRow } = await supabase.from("claude_bot_runs").insert({ run_type: runType, status: "running" }).select().single();
  if (!runRow) throw new Error("Nu pot crea bot run");
  const run_id = runRow.id;

  try {
    const { data: activeLipsa } = await supabase.from("v_active_date_lipsa").select("*").maybeSingle();
    const { data: candidati } = await supabase.from("logistica_active").select("id, marca, model, nr_inmatriculare, cod_intern, tip_carburant, norma_consum, an_fabricatie, capacitate_motor, putere_kw").eq("vandut", false).eq("deep_sleep", false).eq("non_motor", false).or("tip_carburant.is.null,tip_carburant.eq.,norma_consum.is.null").not("marca", "is", null).neq("marca", "").limit(MAX_WEB_SEARCH_ACTIVE * 4);

    let active_scanate = 0, cercetate = 0;
    for (const act of (candidati || [])) {
      if (cercetate >= MAX_WEB_SEARCH_ACTIVE) break;
      const { data: existent } = await supabase.from("claude_bot_sugestii").select("id").eq("tinta_tip", "logistica_active").eq("tinta_id", act.id).eq("status", "propus").in("tip_sugestie", ["tip_carburant_lipsa", "norma_consum_lipsa", "specs_negaste"]).gte("created_at", new Date(Date.now() - 7*24*3600*1000).toISOString()).limit(1).maybeSingle();
      if (existent) { active_scanate++; continue; }
      const silSpec = await isSilentiated(act.id, "specs_negaste");
      if (silSpec.silentiat) { silentiate_skip++; active_scanate++; continue; }
      const descriere = `${act.marca || ""} ${act.model || ""} (${act.cod_intern || act.nr_inmatriculare || `#${act.id}`})`;
      cercetate++; web_searches++;
      const result = await webSearchActivSpecs(act);
      if (!result.data) { erori.push(`Esuat specs #${act.id} ${descriere} :: ${result.errMsg}`); await new Promise(r => setTimeout(r, DELAY_BETWEEN_CALLS_MS)); continue; }
      const specs = result.data;
      web_searches_ok++;
      const tipCarburantValid = normalizeTipCarburant(specs.tip_carburant);
      if (!act.tip_carburant && tipCarburantValid) {
        const sil = await isSilentiated(act.id, "tip_carburant_lipsa");
        if (!sil.silentiat) {
          await supabase.from("claude_bot_sugestii").insert({ bot_run_id: run_id, tip_sugestie: "tip_carburant_lipsa", tinta_tip: "logistica_active", tinta_id: act.id, tinta_descriere: descriere, camp_propus: "tip_carburant", valoare_noua: tipCarburantValid, motivare: `Scorilos: ${specs.motivare}`, source_url: specs.source_url, confidence: specs.confidence, severity: "info", status: "propus" });
          sugestii_create++;
        } else silentiate_skip++;
      }
      if (!act.norma_consum && specs.norma_consum != null) {
        const sil = await isSilentiated(act.id, "norma_consum_lipsa");
        if (!sil.silentiat) {
          const unitateValida = normalizeUnitateNorma(specs.unitate_norma) || "l/h";
          await supabase.from("claude_bot_sugestii").insert({ bot_run_id: run_id, tip_sugestie: "norma_consum_lipsa", tinta_tip: "logistica_active", tinta_id: act.id, tinta_descriere: descriere, camp_propus: "norma_consum", valoare_noua: `${specs.norma_consum} ${unitateValida}`, motivare: `Scorilos: ${specs.motivare}`, source_url: specs.source_url, confidence: specs.confidence, severity: specs.confidence >= 0.7 ? "high" : "info", status: "propus" });
          sugestii_create++;
        } else silentiate_skip++;
      }
      if (specs.confidence < 0.3 && !specs.norma_consum && !tipCarburantValid) {
        await supabase.from("claude_bot_sugestii").insert({ bot_run_id: run_id, tip_sugestie: "specs_negaste", tinta_tip: "logistica_active", tinta_id: act.id, tinta_descriere: descriere, motivare: `Scorilos n-a gasit: ${specs.motivare}`, source_url: specs.source_url, confidence: specs.confidence, severity: "info", status: "propus" });
        sugestii_create++;
      }
      active_scanate++;
      await new Promise(r => setTimeout(r, DELAY_BETWEEN_CALLS_MS));
    }

    lines.push(`Date lipsa: ${activeLipsa?.fara_tip_carburant || 0} fara carburant, ${activeLipsa?.fara_norma_consum || 0} fara norma`);
    if (web_searches > 0) lines.push(`Specs cercetate ${web_searches} (${web_searches_ok} ok)`);

    const { data: candidatiDim } = await supabase.from("logistica_active").select("id, marca, model, nr_inmatriculare, cod_intern, an_fabricatie, lungime_m, latime_m, inaltime_m, greutate_kg").eq("vandut", false).eq("deep_sleep", false).is("lungime_m", null).is("latime_m", null).is("inaltime_m", null).not("marca", "is", null).neq("marca", "").limit(MAX_WEB_SEARCH_DIMENSIUNI * 4);

    let dim_scanate = 0, dim_cercetate = 0;
    for (const act of (candidatiDim || [])) {
      if (dim_cercetate >= MAX_WEB_SEARCH_DIMENSIUNI) break;
      const { data: existDim } = await supabase.from("claude_bot_sugestii").select("id").eq("tinta_tip", "logistica_active").eq("tinta_id", act.id).in("tip_sugestie", ["dimensiuni_lipsa", "dimensiuni_negaste"]).eq("status", "propus").gte("created_at", new Date(Date.now() - 14*24*3600*1000).toISOString()).limit(1).maybeSingle();
      if (existDim) { dim_scanate++; continue; }
      const silDim = await isSilentiated(act.id, "dimensiuni_lipsa");
      if (silDim.silentiat) { silentiate_skip++; dim_scanate++; continue; }
      const descriere = `${act.marca || ""} ${act.model || ""} (${act.cod_intern || act.nr_inmatriculare || `#${act.id}`})`;
      dim_cercetate++; dim_searches++;
      const result = await webSearchActivDimensiuni(act);
      if (!result.data) { erori.push(`Esuat dim #${act.id} ${descriere} :: ${result.errMsg}`); await new Promise(r => setTimeout(r, DELAY_BETWEEN_CALLS_MS)); continue; }
      const dim = result.data;
      dim_searches_ok++;
      const haveAny = (dim.lungime_m != null) || (dim.latime_m != null) || (dim.inaltime_m != null) || (dim.greutate_kg != null);
      if (haveAny && dim.confidence >= 0.3) {
        const valTxt = [dim.lungime_m != null ? `L: ${dim.lungime_m}m` : null, dim.latime_m != null ? `W: ${dim.latime_m}m` : null, dim.inaltime_m != null ? `H: ${dim.inaltime_m}m` : null, dim.greutate_kg != null ? `M: ${dim.greutate_kg}kg` : null, dim.necesita_agabaritic ? '\u26a0\ufe0f AGABARITIC' : null].filter(Boolean).join(" | ");
        const dimJson = JSON.stringify({ lungime_m: dim.lungime_m, latime_m: dim.latime_m, inaltime_m: dim.inaltime_m, greutate_kg: dim.greutate_kg, regim_transport_special: dim.necesita_agabaritic });
        await supabase.from("claude_bot_sugestii").insert({ bot_run_id: run_id, tip_sugestie: "dimensiuni_lipsa", tinta_tip: "logistica_active", tinta_id: act.id, tinta_descriere: descriere, camp_propus: "dimensiuni_transport", valoare_noua: valTxt + " || JSON: " + dimJson, motivare: `Scorilos: ${dim.motivare}` + (dim.model_curat_folosit && dim.model_curat_folosit !== act.model ? ` [model: \"${dim.model_curat_folosit}\"]` : ''), source_url: dim.source_url, confidence: dim.confidence, severity: dim.necesita_agabaritic ? "high" : "info", status: "propus" });
        sugestii_create++;
      } else if (dim.confidence < 0.3) {
        await supabase.from("claude_bot_sugestii").insert({ bot_run_id: run_id, tip_sugestie: "dimensiuni_negaste", tinta_tip: "logistica_active", tinta_id: act.id, tinta_descriere: descriere, motivare: `Scorilos n-a gasit dimensiuni: ${dim.motivare}`, source_url: dim.source_url, confidence: dim.confidence, severity: "info", status: "propus" });
        sugestii_create++;
      }
      dim_scanate++;
      await new Promise(r => setTimeout(r, DELAY_BETWEEN_CALLS_MS));
    }
    if (dim_searches > 0) lines.push(`Dimensiuni cercetate ${dim_searches} (${dim_searches_ok} ok)`);
    lines.push("");

    const { data: patterns } = await supabase.from("v_pattern_recurent_alimentari").select("*").order("nr_alimentari_critice", { ascending: false });
    let patternsInserate = 0;
    for (const p of (patterns || [])) {
      if (await existsSimilarSuggestion(p.active_id, "pattern_recurent", 7)) continue;
      const sil = await isSilentiated(p.active_id, "pattern_recurent");
      if (sil.silentiat) { silentiate_skip++; continue; }
      await supabase.from("claude_bot_sugestii").insert({ bot_run_id: run_id, tip_sugestie: "pattern_recurent", tinta_tip: "logistica_active", tinta_id: p.active_id, tinta_descriere: p.utilaj, motivare: `${p.nr_alimentari_critice} alim critice/30 zile. Tipuri: ${(p.tipuri_suspiciuni || []).join(", ")}.`, confidence: Math.min(0.5 + (p.nr_alimentari_critice * 0.1), 0.95), severity: p.nr_alimentari_critice >= 5 ? "critic" : "high", status: "propus" });
      sugestii_create++; alerte_emise++; patternsInserate++;
    }

    const { data: drifturi } = await supabase.from("v_drift_consum").select("*").order("abatere_pct", { ascending: false });
    let drifturiInserate = 0;
    for (const d of (drifturi || [])) {
      if (await existsSimilarSuggestion(d.active_id, "drift_consum", 3)) continue;
      const sil = await isSilentiated(d.active_id, "drift_consum");
      if (sil.silentiat) { silentiate_skip++; continue; }
      await supabase.from("claude_bot_sugestii").insert({ bot_run_id: run_id, tip_sugestie: "drift_consum", tinta_tip: "logistica_active", tinta_id: d.active_id, tinta_descriere: d.utilaj, motivare: `Drift: ${d.media_recenta_7zile} vs ${d.media_istorica_30zile} ${d.unitate} (${d.abatere_pct}%).`, confidence: Math.abs(d.abatere_pct) > 50 ? 0.85 : 0.65, severity: d.severity, status: "propus" });
      sugestii_create++; alerte_emise++; drifturiInserate++;
    }

    // ============================================================
    // v18 27.05.2026: TIP NOU alim_pe_deep_sleep (FRAUDA CARD ABSOLUTA)
    // Alimentari pe vehicule MARKAT deep_sleep dupa deep_sleep_data
    // ============================================================
    const { data: alimDeepSleep } = await supabase
      .from("logistica_alimentari")
      .select(`id, data_alimentare, cantitate_litri, statie_combustibil, anomalie_confirmata, active_id, logistica_active!active_id(id, marca, model, nr_inmatriculare, deep_sleep, deep_sleep_data, deep_sleep_motiv)`)
      .gte("data_alimentare", new Date(Date.now() - DEEP_SLEEP_LOOKBACK_DAYS*24*3600*1000).toISOString().slice(0, 10));

    let alimDeepSleepInserate = 0;
    if (alimDeepSleep && Array.isArray(alimDeepSleep)) {
      for (const al of alimDeepSleep) {
        const asset = (al as any).logistica_active;
        if (!asset?.deep_sleep) continue;
        if (!asset.deep_sleep_data) continue;
        if (al.data_alimentare < asset.deep_sleep_data) continue; // alim INAINTE de deep_sleep = legitim
        if (await existsSimilarSuggestionForAlim(al.id, "alim_pe_deep_sleep", 30)) continue;
        const sil = await isSilentiated(asset.id, "alim_pe_deep_sleep");
        if (sil.silentiat) { silentiate_skip++; continue; }

        const motivare = `alim#${al.id}: ${al.cantitate_litri}L ${al.statie_combustibil} pe ${al.data_alimentare} pentru vehiculul ${asset.marca} ${asset.model} (${asset.nr_inmatriculare}) - DAR vehiculul a fost marcat DEEP_SLEEP din ${asset.deep_sleep_data}. Motiv: \"${(asset.deep_sleep_motiv || "fara motiv").slice(0, 200)}\". FRAUDA CARD - cardul folosit pentru alt vehicul.`;

        await supabase.from("claude_bot_sugestii").insert({
          bot_run_id: run_id, tip_sugestie: "alim_pe_deep_sleep", tinta_tip: "logistica_active",
          tinta_id: asset.id, tinta_descriere: `${asset.marca} ${asset.model} (${asset.nr_inmatriculare})`,
          motivare, confidence: 0.98, severity: "critic", status: "propus",
        });
        sugestii_create++; alerte_emise++; alimDeepSleepInserate++; cross_check_create++;
      }
    }

    // ============================================================
    // v17: Cross-check Rompetrol vs EvoGPS (alim_fara_telemetrie + km_discrepancy_evogps + vehicul_fara_gps_history)
    // ============================================================
    const { data: alimFaraTelem } = await supabase.from("v_alim_fara_telemetrie").select("*").gte("data_alimentare", new Date(Date.now() - 60*24*3600*1000).toISOString().slice(0, 10)).gte("cantitate_litri", ALIM_FARA_TELEM_MIN_LITRI).lte("zile_cu_miscare_7zile", 2).order("cantitate_litri", { ascending: false }).limit(100);

    let alimFaraTelemInserate = 0;
    for (const a of (alimFaraTelem || [])) {
      if (await existsSimilarSuggestionForAlim(a.alimentare_id, "alim_fara_telemetrie", 14)) continue;
      const sil = await isSilentiated(a.active_id, "alim_fara_telemetrie");
      if (sil.silentiat) { silentiate_skip++; continue; }
      const hasGps = await activHasGpsHistory(a.active_id);
      if (!hasGps) { skip_no_gps_history++; continue; }
      const litri = Number(a.cantitate_litri);
      const zileMiscare = Number(a.zile_cu_miscare_7zile);
      const kmTotal = Number(a.km_total_7zile);
      let severity = "info";
      if (litri > 100 && zileMiscare === 0) severity = "critic";
      else if (litri > 75 || zileMiscare === 0) severity = "high";
      const motivare = `alim#${a.alimentare_id}: ${litri}L Rompetrol pe ${a.data_alimentare}, dar EvoGPS arata ${zileMiscare} zile cu miscare in +/-7z (total ${Math.round(kmTotal)} km). GPS-ul vehiculului FUNCTIONEAZA in BD - posibila frauda card sau vehicul oprit nealimentat.`;
      await supabase.from("claude_bot_sugestii").insert({ bot_run_id: run_id, tip_sugestie: "alim_fara_telemetrie", tinta_tip: "logistica_active", tinta_id: a.active_id, tinta_descriere: a.utilaj, motivare, confidence: zileMiscare === 0 ? 0.85 : 0.65, severity, status: "propus" });
      sugestii_create++; alerte_emise++; alimFaraTelemInserate++; cross_check_create++;
    }

    const { data: kmDiscrep } = await supabase.from("v_km_pompa_vs_evogps").select("*").gte("data_alimentare", new Date(Date.now() - 60*24*3600*1000).toISOString().slice(0, 10)).not("km_evogps", "is", null).order("data_alimentare", { ascending: false }).limit(100);

    let kmDiscrepInserate = 0;
    for (const k of (kmDiscrep || [])) {
      const diff = Math.abs(Number(k.km_pompa) - Number(k.km_evogps));
      if (diff < KM_DISCREPANCY_MIN_DIFF) continue;
      if (await existsSimilarSuggestionForAlim(k.alimentare_id, "km_discrepancy_evogps", 14)) continue;
      const sil = await isSilentiated(k.active_id, "km_discrepancy_evogps");
      if (sil.silentiat) { silentiate_skip++; continue; }
      let severity = "info";
      if (diff > KM_DISCREPANCY_CRITIC_DIFF) severity = "critic";
      else if (diff > 20000) severity = "high";
      const kmPompaFmt = Number(k.km_pompa).toLocaleString("ro-RO");
      const kmEvoFmt = Math.round(Number(k.km_evogps)).toLocaleString("ro-RO");
      const diffFmt = Math.round(diff).toLocaleString("ro-RO");
      const motivare = `alim#${k.alimentare_id}: km la pompa Rompetrol (${kmPompaFmt}) vs km EvoGPS (${kmEvoFmt}) au diferenta de ${diffFmt} km pe ${k.data_alimentare}. Posibila inversare cifre, frauda card, sau reset km neinregistrat.`;
      await supabase.from("claude_bot_sugestii").insert({ bot_run_id: run_id, tip_sugestie: "km_discrepancy_evogps", tinta_tip: "logistica_active", tinta_id: k.active_id, tinta_descriere: k.utilaj, motivare, confidence: diff > 50000 ? 0.9 : 0.7, severity, status: "propus" });
      sugestii_create++; alerte_emise++; kmDiscrepInserate++; cross_check_create++;
    }

    const { data: vehiculeFaraGps } = await supabase.rpc('fn_vehicule_fara_gps_history', { p_window_days: 60, p_min_alim_recente: 2 });

    let vehiculeFaraGpsInserate = 0;
    if (vehiculeFaraGps && Array.isArray(vehiculeFaraGps)) {
      for (const v of vehiculeFaraGps) {
        if (await existsSimilarSuggestion(v.active_id, "vehicul_fara_gps_history", 30)) continue;
        const sil = await isSilentiated(v.active_id, "vehicul_fara_gps_history");
        if (sil.silentiat) { silentiate_skip++; continue; }
        const motivare = `Vehicul ${v.nr_inmatriculare} (${v.marca} ${v.model}): ${v.nr_alim_recente} alimentari Rompetrol in ultimele 60 zile (total ${Math.round(v.total_litri)}L), DAR ZERO records EvoGPS in BD. Verifica daca GPS-ul fizic e montat/functional sau marcheaza activul ca non_motor (daca e generator/utilaj static).`;
        await supabase.from("claude_bot_sugestii").insert({ bot_run_id: run_id, tip_sugestie: "vehicul_fara_gps_history", tinta_tip: "logistica_active", tinta_id: v.active_id, tinta_descriere: `${v.marca} ${v.model} (${v.nr_inmatriculare})`, motivare, confidence: 0.95, severity: "info", status: "propus" });
        sugestii_create++; vehiculeFaraGpsInserate++;
      }
    }

    if (cross_check_create > 0 || vehiculeFaraGpsInserate > 0) {
      const partsx: string[] = [];
      if (alimDeepSleepInserate > 0) partsx.push(`${alimDeepSleepInserate} \ud83d\udea8 FRAUDA card (deep_sleep)`);
      if (alimFaraTelemInserate > 0) partsx.push(`${alimFaraTelemInserate} alim suspect (GPS validat)`);
      if (kmDiscrepInserate > 0) partsx.push(`${kmDiscrepInserate} km discrepancy`);
      if (vehiculeFaraGpsInserate > 0) partsx.push(`${vehiculeFaraGpsInserate} vehicule fara GPS history`);
      if (skip_no_gps_history > 0) partsx.push(`${skip_no_gps_history} skip (no GPS history)`);
      lines.push(`Cross-check v18: ${partsx.join(" + ")}`);
    }

    const { count: totalPropuse } = await supabase.from("claude_bot_sugestii").select("*", { count: "exact", head: true }).eq("status", "propus").eq("tinta_tip", "logistica_active");
    lines.push(`Sugestii Logistica pentru review: ${totalPropuse || 0} (${sugestii_create} noi)`);
    if (patterns?.length && patternsInserate < patterns.length) lines.push(`Patterns: ${patternsInserate} noi, ${patterns.length - patternsInserate} skip`);
    if (drifturi?.length && drifturiInserate < drifturi.length) lines.push(`Drifturi: ${drifturiInserate} noi, ${drifturi.length - drifturiInserate} skip`);
    if (silentiate_skip > 0) lines.push(`Silentiate active: ${silentiate_skip} alerte skip`);
    lines.push(`Scanat ${active_scanate} active specs + ${dim_scanate} dimensiuni in ${Date.now() - started}ms`);
    const outputText = lines.join("\n");

    if (web_searches_ok > 0 || alerte_emise > 0 || dim_searches_ok > 0 || cross_check_create > 0) {
      const { data: destinatari } = await supabase.from("profiles").select("id, name, is_owner, role").or("is_owner.eq.true,role.eq.admin_logistica");
      const parts: string[] = [];
      if (alimDeepSleepInserate > 0) parts.push(`\ud83d\udea8 ${alimDeepSleepInserate} frauda card`);
      if (patternsInserate > 0) parts.push(`${patternsInserate} patterns`);
      if (drifturiInserate > 0) parts.push(`${drifturiInserate} drift`);
      if (web_searches_ok > 0) parts.push(`${web_searches_ok} specs`);
      if (dim_searches_ok > 0) parts.push(`${dim_searches_ok} dimensiuni`);
      if (alimFaraTelemInserate > 0) parts.push(`${alimFaraTelemInserate} alim suspect`);
      if (kmDiscrepInserate > 0) parts.push(`${kmDiscrepInserate} km diff`);
      if (vehiculeFaraGpsInserate > 0) parts.push(`${vehiculeFaraGpsInserate} vehicule fara GPS`);
      if (parts.length > 0 && destinatari && destinatari.length > 0) {
        const notifRows = destinatari.map(d => ({ profile_id: d.id, type: alimDeepSleepInserate > 0 || alerte_emise > 0 ? "warning" : "info", modul: "Logistic\u0103", title: `Scorilos - ${parts.join(" + ")} noi`, message: outputText.slice(0, 1000), link_to: "/logistica?tab=bot-sugestii", created_at: new Date().toISOString() }));
        await supabase.from("notifications").insert(notifRows);
      }
    }

    await supabase.from("claude_bot_runs").update({ finished_at: new Date().toISOString(), duration_ms: Date.now() - started, sugestii_create, alerte_emise, active_scanate: active_scanate + dim_scanate, output_text: outputText, status: "success", erori: erori.length > 0 ? erori : null }).eq("id", run_id);
    return { run_id, sugestii_create, alerte_emise, active_scanate, dim_scanate, web_searches, web_searches_ok, dim_searches, dim_searches_ok, silentiate_skip, cross_check_create, skip_no_gps_history };
  } catch (e: any) {
    await supabase.from("claude_bot_runs").update({ finished_at: new Date().toISOString(), status: "error", erori: [e.message] }).eq("id", run_id);
    throw e;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  // doar cron: fara cale UI (moduleUi gol)
  if (await autorizeaza(req, supabase) !== "cron") return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  try {
    const body = await req.json().catch(() => ({}));
    // v19: KILL SWITCH - daca Scorilos e suspendat din settings, iese imediat fara apeluri API (zero cost)
    if (!(await isScorilosEnabled())) {
      return new Response(JSON.stringify({ success: true, skipped: true, reason: "scorilos_enabled=false (suspendat din settings)", cost: 0 }), { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    }
    const result = await runPatrol(body.run_type || "manual");
    return new Response(JSON.stringify({ success: true, ...result }), { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  }
});
