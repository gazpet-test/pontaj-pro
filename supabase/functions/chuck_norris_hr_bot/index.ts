// Chuck Norris HR Bot v2 - 13.10.2026: poarta noua (acces.ts) — fara secret in frontend si fara fallback in cod.
//   cron: x-bot-secret verificat in BD (Vault BOT_SECRET); UI: JWT owner sau modul 'hr'.
// v1 - 24.05.2026
// "Chuck Norris nu intra in BD, BD intra in Chuck Norris"
// Patruleaza zilnic: autorizatii expirate/expirante + angajati fara aviz medical valid

import { createClient } from "jsr:@supabase/supabase-js@2";
import { autorizeaza } from "./acces.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-bot-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Anti-spam: skip daca exista deja sugestie identica in ultimele N zile
async function existsSimilarSuggestion(
  tinta_tip: string, tinta_id: number, tip_sugestie: string, dayWindow: number = 7
): Promise<boolean> {
  const since = new Date(Date.now() - dayWindow * 24 * 3600 * 1000).toISOString();
  const { data } = await supabase
    .from("claude_bot_sugestii")
    .select("id")
    .eq("tinta_tip", tinta_tip)
    .eq("tinta_id", tinta_id)
    .eq("tip_sugestie", tip_sugestie)
    .eq("status", "propus")
    .gte("created_at", since)
    .limit(1).maybeSingle();
  return !!data;
}

// Verificare silentiere activa (din claude_bot_silentiate)
async function isSilentiated(tinta_tip: string, tinta_id: number, tip_sugestie: string): Promise<boolean> {
  const { data } = await supabase
    .from("claude_bot_silentiate")
    .select("silentiat_pana")
    .eq("tinta_tip", tinta_tip)
    .eq("tinta_id", tinta_id)
    .eq("tip_sugestie", tip_sugestie)
    .gte("silentiat_pana", new Date().toISOString().slice(0, 10))
    .limit(1).maybeSingle();
  return !!data;
}

async function runChuckPatrol(runType: string) {
  const started = Date.now();
  const erori: string[] = [];
  let sugestii_create = 0, alerte_emise = 0, silentiate_skip = 0, anti_spam_skip = 0;
  const lines: string[] = [
    `Chuck Norris HR Patrula ${new Date().toLocaleString("ro-RO", { timeZone: "Europe/Bucharest" })}`,
    `"Chuck Norris nu intra in BD, BD intra in Chuck Norris."`,
    "",
  ];

  const { data: runRow } = await supabase
    .from("claude_bot_runs")
    .insert({ run_type: runType, status: "running" })
    .select().single();
  if (!runRow) throw new Error("Nu pot crea bot run");
  const run_id = runRow.id;

  try {
    // ============================================================
    // CATEGORIA 1: AUTORIZATII EXPIRATE (date trecut)
    // ============================================================
    const { data: expirate } = await supabase
      .from("v_chuck_hr_alerte")
      .select("*")
      .eq("status", "expirat")
      .order("zile_pana_expirare", { ascending: true });

    let nr_expirate = 0;
    for (const a of (expirate || [])) {
      if (await existsSimilarSuggestion("hr_autorizatii", a.autorizatie_id, "autorizatie_expirata", 7)) {
        anti_spam_skip++; continue;
      }
      if (await isSilentiated("hr_autorizatii", a.autorizatie_id, "autorizatie_expirata")) {
        silentiate_skip++; continue;
      }
      const zileExp = Math.abs(a.zile_pana_expirare);
      const titlu = `${a.angajat_nume} - ${a.tip_denumire} EXPIRATĂ acum ${zileExp} zile`;
      const motiv = `${a.angajat_nume} (${a.functie || "fără funcție"}) are ${a.tip_denumire} (cat: ${a.tip_categorie}) expirată din ${a.data_expirare} - ${zileExp} zile depășire. Risk: angajat lucrează nautorizat. Acțiune: solicitați reînnoire urgentă.`;

      await supabase.from("claude_bot_sugestii").insert({
        bot_run_id: run_id,
        tip_sugestie: "autorizatie_expirata",
        tinta_tip: "hr_autorizatii",
        tinta_id: a.autorizatie_id,
        tinta_descriere: titlu,
        motivare: motiv,
        confidence: 1.0, // E exact, nu predicție
        severity: zileExp > 30 ? "critic" : "high",
        status: "propus",
      });
      sugestii_create++; alerte_emise++; nr_expirate++;
    }
    lines.push(`Autorizații EXPIRATE: ${nr_expirate} alerte noi (${(expirate?.length || 0) - nr_expirate} skip)`);

    // ============================================================
    // CATEGORIA 2: AUTORIZATII EXPIRA IN 30 ZILE (preventiv urgent)
    // ============================================================
    const { data: expira30 } = await supabase
      .from("v_chuck_hr_alerte")
      .select("*")
      .eq("status", "expira_30z")
      .order("zile_pana_expirare", { ascending: true });

    let nr_30z = 0;
    for (const a of (expira30 || [])) {
      if (await existsSimilarSuggestion("hr_autorizatii", a.autorizatie_id, "autorizatie_expira_30z", 14)) {
        anti_spam_skip++; continue;
      }
      if (await isSilentiated("hr_autorizatii", a.autorizatie_id, "autorizatie_expira_30z")) {
        silentiate_skip++; continue;
      }
      const titlu = `${a.angajat_nume} - ${a.tip_denumire} expiră în ${a.zile_pana_expirare} zile`;
      const motiv = `${a.angajat_nume} (${a.functie || "fără funcție"}) - ${a.tip_denumire} (${a.tip_categorie}) expiră pe ${a.data_expirare}. Programare reînnoire necesară.`;

      await supabase.from("claude_bot_sugestii").insert({
        bot_run_id: run_id,
        tip_sugestie: "autorizatie_expira_30z",
        tinta_tip: "hr_autorizatii",
        tinta_id: a.autorizatie_id,
        tinta_descriere: titlu,
        motivare: motiv,
        confidence: 1.0,
        severity: "high",
        status: "propus",
      });
      sugestii_create++; alerte_emise++; nr_30z++;
    }
    lines.push(`Autorizații expira ≤30z: ${nr_30z} alerte noi (${(expira30?.length || 0) - nr_30z} skip)`);

    // ============================================================
    // CATEGORIA 3: AUTORIZATII EXPIRA IN 60 ZILE (early warning)
    // ============================================================
    const { data: expira60 } = await supabase
      .from("v_chuck_hr_alerte")
      .select("*")
      .eq("status", "expira_60z")
      .order("zile_pana_expirare", { ascending: true });

    let nr_60z = 0;
    for (const a of (expira60 || [])) {
      if (await existsSimilarSuggestion("hr_autorizatii", a.autorizatie_id, "autorizatie_expira_60z", 21)) {
        anti_spam_skip++; continue;
      }
      if (await isSilentiated("hr_autorizatii", a.autorizatie_id, "autorizatie_expira_60z")) {
        silentiate_skip++; continue;
      }
      const titlu = `${a.angajat_nume} - ${a.tip_denumire} expiră în ${a.zile_pana_expirare} zile (60z preview)`;
      const motiv = `Notificare timpurie: ${a.angajat_nume} (${a.functie || "fără funcție"}) - ${a.tip_denumire} expiră pe ${a.data_expirare} (în ${a.zile_pana_expirare} zile). Planificați reînnoirea.`;

      await supabase.from("claude_bot_sugestii").insert({
        bot_run_id: run_id,
        tip_sugestie: "autorizatie_expira_60z",
        tinta_tip: "hr_autorizatii",
        tinta_id: a.autorizatie_id,
        tinta_descriere: titlu,
        motivare: motiv,
        confidence: 1.0,
        severity: "info",
        status: "propus",
      });
      sugestii_create++; nr_60z++;
    }
    lines.push(`Autorizații expira ≤60z: ${nr_60z} alerte noi (${(expira60?.length || 0) - nr_60z} skip)`);

    // ============================================================
    // CATEGORIA 4: ANGAJATI FARA AVIZ MEDICAL VALID
    // ============================================================
    const { data: faraAviz } = await supabase
      .from("v_chuck_hr_fara_aviz_medical")
      .select("*")
      .eq("are_aviz_medical_valid", false);

    let nr_fara_aviz = 0;
    for (const e of (faraAviz || [])) {
      if (await existsSimilarSuggestion("employee", e.employee_id, "angajat_fara_aviz_medical", 14)) {
        anti_spam_skip++; continue;
      }
      if (await isSilentiated("employee", e.employee_id, "angajat_fara_aviz_medical")) {
        silentiate_skip++; continue;
      }
      const titlu = `${e.angajat_nume} - FĂRĂ aviz medical valid`;
      const motiv = `${e.angajat_nume} (${e.functie || "fără funcție"}, dept ${e.departament_hr || "?"}) - angajat activ fără aviz medical valid în sistem. Verifică dacă: (1) aviz există dar nu-i uploadat în BD, (2) angajat nou care nu a făcut încă, (3) aviz expirat și neînregistrat.`;

      await supabase.from("claude_bot_sugestii").insert({
        bot_run_id: run_id,
        tip_sugestie: "angajat_fara_aviz_medical",
        tinta_tip: "employee",
        tinta_id: e.employee_id,
        tinta_descriere: titlu,
        motivare: motiv,
        confidence: 0.85, // ar putea fi false positive daca avizu-i fizic dar neuploadat
        severity: "high",
        status: "propus",
      });
      sugestii_create++; alerte_emise++; nr_fara_aviz++;
    }
    lines.push(`Angajați fără aviz medical: ${nr_fara_aviz} alerte noi (${(faraAviz?.length || 0) - nr_fara_aviz} skip)`);

    // ============================================================
    // FINALIZARE
    // ============================================================
    const { count: totalPropuseHR } = await supabase
      .from("claude_bot_sugestii")
      .select("*", { count: "exact", head: true })
      .eq("status", "propus")
      .in("tinta_tip", ["hr_autorizatii", "employee"]);

    lines.push("");
    lines.push(`TOTAL sugestii HR pentru review: ${totalPropuseHR || 0} (${sugestii_create} noi)`);
    if (anti_spam_skip > 0) lines.push(`Anti-spam (dedup 7-21z): ${anti_spam_skip} skip`);
    if (silentiate_skip > 0) lines.push(`Silentiate active: ${silentiate_skip} skip`);
    lines.push(`Chuck a vorbit. Durata: ${Date.now() - started}ms`);

    const outputText = lines.join("\n");

    // Notificare owners daca s-au gasit alerte
    if (alerte_emise > 0) {
      const { data: owners } = await supabase.from("profiles").select("id").eq("is_owner", true);
      for (const o of (owners || [])) {
        await supabase.from("notifications").insert({
          profile_id: o.id,
          type: "warning",
          modul: "HR",
          title: `Chuck Norris HR - ${alerte_emise} alerte noi`,
          message: outputText.slice(0, 1000),
          link_to: "/hr?tab=sugestii-chuck",
          created_at: new Date().toISOString(),
        });
      }
    }

    await supabase.from("claude_bot_runs").update({
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - started,
      sugestii_create,
      alerte_emise,
      active_scanate: (expirate?.length || 0) + (expira30?.length || 0) + (expira60?.length || 0) + (faraAviz?.length || 0),
      output_text: outputText,
      status: "success",
      erori: erori.length > 0 ? erori : null,
    }).eq("id", run_id);

    return {
      run_id,
      sugestii_create,
      alerte_emise,
      silentiate_skip,
      anti_spam_skip,
      durata_ms: Date.now() - started,
    };
  } catch (e: any) {
    await supabase.from("claude_bot_runs").update({
      finished_at: new Date().toISOString(),
      status: "error",
      erori: [e.message],
    }).eq("id", run_id);
    throw e;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  const cale = await autorizeaza(req, supabase, ["hr"]);
  if (!cale) {
    return new Response(JSON.stringify({ error: "Chuck Norris nu primeste 403. Tu primesti 403." }), {
      status: 403,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
  try {
    const body = await req.json().catch(() => ({}));
    // rulare din UI: tipul se fixeaza aici, nu din body
    const result = await runChuckPatrol(cale === "ui" ? "manual_chuck_ui" : (body.run_type || "manual"));
    return new Response(JSON.stringify({ success: true, ...result }), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
