// rag-normative — RETRASĂ (14.10.2026, securitate etapa 2 grup B).
// v22 rula cu verify_jwt=false și accepta un antet intern comparat cu un literal scris în cod: oricine îl știa
// pornea, fără cont, embedding-uri + UPDATE în rag_normative (process_pending) și apeluri Claude plătite (ask); în rest,
// orice cont logat (inclusiv fără niciun drept) avea același acces.
// Nu are niciun consumator găsit: 0 referințe în repo (src/, supabase/, worker/, scripts/, api/); 0 în cron.job (și istoricul
// cron.job_run_details), funcții/trigger-e BD, coada pg_net; 0 în cele 29 de surse edge deployate fără repo citite (inclusiv
// chatbot) și în versiunile deployate ale normative-scan-lunar și rag-utilaj; 0 apeluri în jurnalele edge din 06–14.10; rag_normative are
// 22 de rânduri, toate din 09.06.2026, toate cu embedding; tabelul rag_test_log (save_test) nici nu mai există.
// Stub-ul o neutralizează până la ștergerea din producție (dashboard sau workflow de ștergere, decizia lui Răzvan).
// Revenire: supabase/functions_retrase/revenire_grupb/rag-normative.v22.ts (literalul e REDACTAT acolo) + slug-ul în NO_JWT.
Deno.serve(() => new Response(JSON.stringify({ error: 'functie retrasa' }), { status: 410, headers: { 'Content-Type': 'application/json' } }))
