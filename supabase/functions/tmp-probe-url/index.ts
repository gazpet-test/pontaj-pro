// tmp-probe-url — RETRASA (03.10.2026, task #17, decizie Razvan „A: repar acum").
// Era o proba temporara de debug: facea fetch pe orice URL primit si intorcea raspunsul, cu un secret
// scris literal in sursa (verify_jwt=false). Nu o mai cheama nimic (0 apeluri in loguri).
// Stub-ul o neutralizeaza pana o sterge Razvan din dashboard (Edge Functions → tmp-probe-url → Delete);
// MCP-ul si workflow-ul de deploy nu au operatie de stergere.
Deno.serve(() => new Response(JSON.stringify({ error: 'functie retrasa' }), { status: 410, headers: { 'Content-Type': 'application/json' } }))
