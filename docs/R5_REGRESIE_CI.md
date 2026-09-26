# Regresie Ofertare în CI

Workflow: `.github/workflows/ofertare-regresie.yml`. Pornește pe PR (orice
ramură țintă), push pe `main`, pentru căile cerute în JAK_143, sau manual prin
`workflow_dispatch`. Nu utilizează secrete ori Supabase de producție.

| Job | Ce rulează |
| --- | --- |
| `unit` | Node 20, `npm ci`, Vitest filtrat pe `src/ofertare src/grafic src/Ofertare`, apoi cele 9 teste Node din `scripts/test-r5-r9b.mjs`. |
| `deno` | Deno 2.x, toate cele 8 fișiere `*_test.ts` din cele trei directoare de mai jos, cu `-A`, `` și lock-ul existent. Clienții Supabase și apelurile AI sunt simulate în teste. |
| `postgres` | PostgreSQL 16 efemer, 10 probe R9b (2a–2d, 3a–3f): concurență, reconfirmare, export și notificări interne, pe fixture sintetic și migrările SQL din repo. |

Filtrele Vitest corespund celor 20 de fișiere din repo: 17
`src/ofertare*.test.js`, `src/OfertareExport.test.js` și cele două
`src/grafic*.test.js`. Nu există excluderi suplimentare în aceste suite.
Timeout: 15 minute pentru `unit`/`deno`, 10 minute pentru `postgres`.

## Rulare locală

Din rădăcina repo-ului, cu Node 20 și Deno 2.x:

```sh
npm ci
npx vitest run src/ofertare src/grafic src/Ofertare
node --test scripts/test-r5-r9b.mjs
deno test -A  --lock=deno.lock --node-modules-dir=none supabase/functions/ofertare-plansa-citeste supabase/functions/ofertare-clarificari-propune supabase/functions/ofertare-document-nou-citeste
```

Cu PostgreSQL 16 local dedicat testelor, superuser `postgres` și `psql` în PATH,
în PowerShell:

```powershell
$env:PGURI = 'postgres://postgres@localhost:5432/r9b'
$env:PGPASSWORD = 'postgres'
node scripts/pg/test_r9b_probe23.mjs
```

Scriptul **șterge și recreează baza locală `r9b`**. Nu folosi o bază cu date
utile. Scriptul transmite mediul procesului către toate procesele `psql`;
`--no-password` interzice promptul, iar parola vine din `PGPASSWORD`.
Detalii: [R5_TESTE_PROBE23.md](R5_TESTE_PROBE23.md).

## Blocaje și limite constatate la configurare

- `deno.lock` existent nu include `jsr:@std/assert@1` (importat de toate cele
  8 fișiere) și `npm:@supabase/supabase-js@2` (importat de `handler.ts`).
  Jobul păstrează intenționat ``: lock-ul incomplet este un blocaj,
  nu motiv de ignorat teste. Este necesară completarea și verificarea lock-ului
  cu Deno înainte de a considera acest job funcțional. Lock-ul nu a fost modificat.
- Importurile JSR/npm necesită rețea pentru instalarea dependențelor.
  Testele folosesc fake-uri, fără chei reale; `-A` nu interzice tehnic rețeaua.
  Inspecția nu a identificat teste din cele trei directoare care cer servicii
  externe ori secrete. Acest lucru nu a fost verificat prin execuție locală Deno.
- `package.json` declară Node `24.x`; CI folosește Node 20 conform sarcinii.
  Compatibilitatea completă pe Node 20 rămâne de verificat prin rularea CI.
- PGlite decisive (`scripts/pglite/test_r9b_decisive.mjs`) nu intră în acest
  workflow: dependența PGlite și fixture-urile reale din scratchpad lipsesc din
  repo. Nici UI real, PostgREST/`safeupdate`, RLS din producție, AI real sau
  calitatea extragerii din documente reale nu sunt validate de aceste joburi.
- Testele celorlalte module și cele Deno din `ofertare-cantitati-extrage`,
  `ofertare-seap-import`, `worker` și `test-fixtures` sunt în afara selecției
  cerute; nu s-a exclus niciun test din directoarele selectate.
- Filtrele de declanșare cerute nu includ schimbări doar în `package.json`,
  `package-lock.json`, `deno.lock`, `vite.config.js` ori fake-urile comune din
  `supabase/functions/_test`. Pentru asemenea schimbări, pornește workflow-ul manual.

## Verificare locală în această sesiune

- Inventariere statică: cele 20 de fișiere Vitest corespund filtrelor cerute;
  cele 8 fișiere Deno conțin 212 declarații `Deno.test`.
- `npx --no-install vitest run src/ofertare src/grafic src/Ofertare`: blocat;
  `node_modules` există, dar Vitest lipsește, iar npm întoarce `ENOTCACHED`.
- `node --test scripts/test-r5-r9b.mjs`: blocat de `spawn EPERM` în sandbox.
  Aceeași suită, cu Node 24 local și `--test-isolation=none`: **9/9 PASS**.
  În CI rămâne comanda cerută, fără acest workaround local.
- Deno și `psql` lipsesc din PATH; suitele lor nu au fost executate local.
- `node --check scripts/pg/test_r9b_probe23.mjs`: PASS.
- YAML verificat prin inspecție; validarea automată cu parser/actionlint nu
  a putut fi executată (instrumentele nu sunt instalate).
