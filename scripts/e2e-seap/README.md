# Teste cap-coadă: import SEAP + veghe (audit #4 var. B, PR #652)

Rulează handler-ele REALE `ofertare-seap-import` și `ofertare-seap-veghe` (Deno.serve) peste un Supabase
simulat în memorie (`fake_supabase.ts`, legat prin `map.json` în locul `npm:@supabase/supabase-js@2`) și un
SEAP simulat (fetch înlocuit în fiecare fișier). Fără rețea, fără secrete, fără BD reală.

```
deno test -A --no-check --node-modules-dir=none --import-map=scripts/e2e-seap/map.json scripts/e2e-seap/import.e2e.ts scripts/e2e-seap/veghe.e2e.ts
```

Numele `*.e2e.ts` NU se potrivesc tiparului implicit al `deno test` — fără `--import-map` ar încărca supabase-js real.
Rulează în CI (`.github/workflows/ofertare-regresie.yml`, jobul `deno`). `import.e2e.ts` cere utilitarul `zip` (Info-ZIP).
