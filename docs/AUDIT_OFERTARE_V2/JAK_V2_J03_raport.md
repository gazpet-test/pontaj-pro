# V2-J03 — poarta de acces Ofertare

Data: 29.09.2026. Specificație: `C:\Users\Public\spec_v2_j03.md`.

## Implementare

- Helper Edge comun: Authorization Bearer → client cu cheia anon și Authorization al utilizatorului → `auth.getUser()` → `fn_are_acces_ofertare`. Lipsa identității / eroare de autentificare: 401. Lipsa modulului / eroare ori excepție RPC: 403. Numai `data === true` permite accesul.
- Contract Edge: `null` la succes, `Response` la refuz. Identitatea validată se transmite prin `deps.context.userId`; `createClient` și mediul sunt injectabile, iar clientul permite simularea `getUser` / `rpc`. Contextul este golit înaintea fiecărei verificări.
- Poarta este imediat după OPTIONS în cele patru funcții Edge, înainte de body, client service_role, AI și scrieri. `ofertare-triere.created_by` folosește aceeași identitate, fără a doua autentificare.
- Helper Node echivalent, cu `null` la succes și `{ status, body }` la refuz. Cele patru rute îl apelează înainte de citirea body și utilizarea service_role.
- Excepția internă rămâne numai la `seap-import`: secret configurat, nevid și identic. Secret greșit/lipsă trece prin verificarea JWT; cheia service_role ca Bearer nu are bypass.
- Workflow: filtre pentru helper-ele noi și cele patru API-uri, suită Node în jobul `unit`, directorul `_shared` în jobul `deno`.
- `deno.lock` a fost actualizat automat la rezolvarea dependenței helperului în verificarea Deno.

## Diferență găsită față de descrierea inițială

În codul inițial, toate cele patru API-uri acceptau `x-import-secret`. Am păstrat excepția doar la `seap-import`, conform punctului 3 al specificației.

Impact concret: `supabase/functions/vercel-relay/index.ts` permite destinațiile `pdf-sparge` și `plansa-felii` și transmite doar acest secret, fără JWT. Aceste apeluri vor primi acum 401. Releul nu a fost modificat; extinderea excepției la alte rute ar contrazice specificația primită. Nu pot stabili din cod dacă aceste căi sunt folosite în prezent.

## Verificare efectuată

- `deno check --no-lock --node-modules-dir=none supabase/functions/_shared/poartaOfertare.ts supabase/functions/_shared/poartaOfertare_test.ts`: trecut.
- Cele **19 teste** din `poartaOfertare_test.ts`: trecute prin runner secvențial în `deno run`, înregistrând callback-urile `Deno.test` și executându-le cu aceleași aserțiuni. Include cele patru verificări textuale ale ordinii din handlers. Aceasta nu este o rulare standard `deno test` și nu oferă izolarea/sanitizarea runnerului standard.
- **56 probe Node native** executate prin stdin: helperul și cele patru handlers reale, cu importurile externe simulate prin `node:module.registerHooks`, `node:assert/strict`, contoare pentru body, fetch, acces BD și scrieri. Acoperă lipsa JWT, cheile anon/service_role fără user, erori/excepții auth/RPC, refuz înainte de body invalid, acces permis și excepția secretului SEAP. Nu sunt declarate drept teste Vitest trecute.
- `node --check`: trecut pentru helperul Node, suita Vitest și cele patru API-uri.
- Aserțiunile pentru filtrele și comenzile workflow-ului: trecute prin Node.

## Ce nu a putut rula

- `npx vitest run api/_poartaOfertare.test.js`: blocat, `node_modules` lipsește și npm întoarce `ENOTCACHED` în modul offline. Suita Vitest este scrisă și inclusă în CI, dar nu o declar trecută.
- `deno test -A --node-modules-dir=none supabase/functions/_shared`: Deno 2.9.7 se prăbușește la crearea pipe-ului Windows (`Unexpected client pipe failure`, cod 5 / handle invalid). Verificarea de tipuri și execuția secvențială alternativă au reușit.
- Nu am apelat API-uri Supabase reale, AI, Vercel sau producția. Semantica și permisiunile RPC-ului existent trebuie confirmate de Claude pe calea reală. Testele acoperă body în handler; nu parserul HTTP din infrastructura Vercel, care poate rula anterior handlerului.
- Nu am rulat git și nu am creat un PR pe GitHub: lucrul a rămas local, conform instrucțiunii. Textul draftului este mai jos.

## Draft PR pregătit local

Titlu: `fix(ofertare): verifică identitatea și accesul înainte de Edge AI și API`

Descriere: Cele patru funcții Edge acceptau cereri fără identitate validată, iar cele patru API-uri nu verificau accesul la Ofertare. Helper-ele comune cer utilizator valid și răspuns explicit pozitiv de la `fn_are_acces_ofertare` înainte de procesare sau operații privilegiate. Trierea păstrează identitatea verificată în `created_by`; excepția cu secret intern rămâne doar pentru importul SEAP. Testele și workflow-ul acoperă refuzurile 401/403, lipsa efectelor secundare și excepția SEAP. Validarea locală și limitele ei sunt documentate mai sus; apelurile releului spre spargere PDF și felii necesită atenție la review.

## Fișiere

1. `supabase/functions/_shared/poartaOfertare.ts` — nou.
2. `supabase/functions/_shared/poartaOfertare_test.ts` — nou.
3. `supabase/functions/ofertare-e0-autofill/index.ts`.
4. `supabase/functions/ofertare-inventar-ai/index.ts`.
5. `supabase/functions/ofertare-citire-test/index.ts`.
6. `supabase/functions/ofertare-triere/index.ts`.
7. `api/_poartaOfertare.js` — nou.
8. `api/_poartaOfertare.test.js` — nou.
9. `api/cad-parse.js`.
10. `api/pdf-sparge.js`.
11. `api/plansa-felii.js`.
12. `api/seap-import.js`.
13. `.github/workflows/ofertare-regresie.yml`.
14. `deno.lock` — actualizat automat de Deno.
15. `docs/AUDIT_OFERTARE_V2/JAK_V2_J03_raport.md` — acest raport și draftul local.
