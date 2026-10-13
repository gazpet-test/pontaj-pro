// mail-cu-atasamente — RETRAS 13.10.2026 (decizia Razvan, inventar securitate): trimitea mail arbitrar cu atasamente
// de pe rapoarte@gazpet.ro, pazit doar de un secret scris in cod. Fara consumatori in cod/cron/scripturi.
// Stergerea definitiva: din dashboard (Razvan).
Deno.serve(() => new Response(JSON.stringify({ eroare: 'functie retrasa' }), { status: 410, headers: { 'content-type': 'application/json' } }))
