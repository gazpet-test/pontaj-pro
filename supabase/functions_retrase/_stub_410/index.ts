// Stub generic de retragere (etapa 2c, 14.10.2026). Toate cele 29 de stub-uri șterse din producție răspundeau doar 410.
// Revenire pentru oricare dintre ele: se copiază acest fișier în supabase/functions/<slug>/index.ts și se publică
// cu workflow-ul „Deploy edge function (manual)”. Nu are cod activ, nu citește secrete.
Deno.serve(() => new Response(JSON.stringify({ error: 'retrasă' }), { status: 410, headers: { 'Content-Type': 'application/json' } }));
