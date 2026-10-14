// extract_external_bon — RETRASĂ (14.10.2026, securitate etapa 2 grup A).
// v24 rula cu verify_jwt=false și accepta antetul X-Internal-MCP-Bypass comparat cu un literal scris în cod: oricine îl știa
// pornea Vision AI plătit și INSERT/UPDATE în logistica_alimentari (inclusiv marcaje „card swap”), fără cont.
// Nu are niciun consumator găsit: 0 referințe în repo (src/, supabase/, worker/, scripts/, api/); 0 în cron.job, funcții/trigger-e BD,
// coada pg_net; 0 în sursele deployate fără repo citite (analyze_bon_rompetrol, qr-alimentare-submit, import-evogps-gmail, chatbot);
// 0 apeluri în jurnalele edge din ultimele 48h; 0 alimentări create vreodată de ea în BD (ocr_tip_dovada bon_external_ai*).
// Stub-ul o neutralizează până la ștergerea din producție (dashboard sau workflow de ștergere, decizia lui Răzvan).
// Revenire: supabase/functions_retrase/revenire_grupa/extract_external_bon.v24.ts (literalul e REDACTAT acolo) + slug-ul în NO_JWT.
Deno.serve(() => new Response(JSON.stringify({ error: 'functie retrasa' }), { status: 410, headers: { 'Content-Type': 'application/json' } }))
