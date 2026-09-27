# JAK_494_r3 — raport (27.09.2026)

Implementate cerințele din `JAK_494_r3.md`. Plafoanele implicite rămân 10 USD/job și 40 USD/zi.

- `docs/R4_MIGRARE_PROPUSA_ofertare_plansa_coada.sql`: registru `ofertare_plansa_buget`, RLS și SELECT numai autentificat cu UID; două RPC-uri accesibile numai `service_role`. Rezervare atomică prin lock pe zi + lock pe job; plafonul jobului include toate zilele. Ziua rezervării rămâne fixă. Re-claim nu eliberează rezervările vechi. Regularizarea incertă păstrează cel puțin rezerva; SQL actualizează costul cozii. Eliminate coloana de rezervă din coadă și RPC-ul vechi `cost_zi` din propunerea neaplicată.
- `worker/ofertare/plansa.ts`: rezervare înaintea fiecărui apel și regularizare după apel, inclusiv excepții/JSON invalid/cost lipsă. Cost cert numai numeric, finit, nenegativ. Workerul nu suprascrie costul registrului la finalizare. Lipirea cere HTTP 200, JSON valid, `perechi` numeric și fără eroare. Verificare `fisier_path` și hash-uri valide din manifest cu `stare='deja_in_platforma'`; lipsa hash-ului este jurnalizată `identitate: 'neverificata'`. Eroarea citirii manifestului oprește procesarea înainte de AI.
- `worker/ofertare/plansa_test.ts`: păstrate cele 19 teste existente, adăugate 9 teste (unele cu mai multe cazuri), inclusiv concurență 36+3+3, retry după cost incert și răspuns întârziat din claim vechi. Aserțiunile folosesc `node:assert/strict`, inclus în Deno, fără import extern.
- `scripts/pg/test_r4_coada_plansa.mjs`: 12 probe în total. Include sesiuni service_role suprapuse, cu așteptarea lock-ului verificată în `pg_locks`, token vechi, cost incert/idempotent, ziua rezervării, ACL/RLS și rollback. Cazul 23:59 folosește un fixture datat ieri la 23:59 București, regularizat cu ceasul real de azi; nu modifică ceasul serverului.
- `docs/R4_MIGRARE_PROPUSA_ofertare_plansa_coada_ROLLBACK.sql`: dezactivează înscrierea, claim-ul și rezervarea nouă, păstrând datele și regularizarea apelurilor deja trimise. Este o retragere conservatoare, fără ștergere de schemă/date.

Verificări executate:

- `deno check --node-modules-dir=none worker/ofertare/plansa.ts worker/ofertare/plansa_test.ts`: **PASS**.
- Cele **28 teste: 28 PASS, 0 FAIL**, executate în Deno 2.9.7 prin adaptorul de mai jos, inclusiv toate cele 19 existente.
- `node --check scripts/pg/test_r4_coada_plansa.mjs`: **PASS** (sintaxă JavaScript, nu validare SQL).
- `deno test -A --node-modules-dir=none worker/ofertare/plansa_test.ts`: **runnerul nativ nu a putut rula**. Inițial importul deno.land a fost inaccesibil; după eliminarea importului extern, Deno a căzut cu `Unexpected client pipe failure`, cod Windows 5 / handle invalid. Adaptorul execută aceleași funcții de test și aserțiuni, secvențial; nu înlocuiește verificările interne de resurse ale runnerului nativ.
- `node scripts/pg/test_r4_coada_plansa.mjs`: **blocat la setup**, `PGURI` local neconfigurat; rezultat `0 PASS, 1 FAIL; 12 probe definite`. Nici migrarea, nici rollback-ul și nici concurența SQL nu au fost executate pe PostgreSQL 16 aici. `psql` nu este în PATH.

Adaptorul rulat din rădăcina proiectului în PowerShell:

```powershell
$runner = @'
const tests = [];
Deno.test = (name, fn) => tests.push({ name, fn });
await import('./worker/ofertare/plansa_test.ts');
let failed = 0;
for (const t of tests) {
  try { await t.fn(); }
  catch (e) { failed++; console.error('FAIL', t.name, e); }
}
console.log(`${tests.length - failed} PASS, ${failed} FAIL`);
if (failed) Deno.exit(1);
'@
deno eval --node-modules-dir=none $runner
```

Limite: fără hash valid în manifest identitatea conținutului nu poate fi dovedită; rămân verificările căii/tăierii și jurnalizarea cerută. Rezerva de 3 USD/rundă și 1 USD/lipire rămâne estimarea existentă: regularizarea contabilizează și un cost real mai mare, însă nu poate anula o cheltuială deja făcută. Testele simulate nu dovedesc atomicitatea pe PostgreSQL real. Query-ul nou spre manifest și RPC-urile trebuie verificate și prin PostgREST de Claude, în mediul autorizat.

Nu am rulat git, nu am accesat producția și nu am modificat `supabase/functions/ofertare-plansa-citeste/handler.ts`. Nu am rulat Vitest/build: schimbarea este în workerul Deno și SQL, fără modificări în aplicația React.
