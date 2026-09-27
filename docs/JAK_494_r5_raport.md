# JAK_494_r5 — raport (27.09.2026)

Implementate ambele cerințe din `JAK_494_r5.md`.

- `worker/ofertare/plansa.ts`: `citesteDoc` citește întotdeauna manifestul, inclusiv când `job.doc_sha256` este NULL. Regula existentă din `motivAnulare` respinge minimum două hash-uri valide distincte, indiferent de hash-ul jobului. Fără hash înghețat în job, identitatea rămâne `neverificata` în jurnal chiar dacă manifestul conține un hash valid; acesta nu se copiază în job. Restul regulilor r4 sunt păstrate.
- Toate corpurile workerului, inclusiv lipirea, trimit `asteptat` cu `licitatie_id`, `fisier_path`, `taiat_la`, `cale_felii`, din job.
- `supabase/functions/ofertare-plansa-citeste/handler.ts`: modificată numai garda `asteptat`. Compară fiecare câmp prezent: licitația numeric, calea fișierului exact, tăierea și calea feliilor cu normalizarea NULL existentă. Câmpurile absente nu se compară. Nepotrivirea la citire sau lipire întoarce 409, `cost_usd: 0`, fără `in_lucru`, cu mesajul `Documentul nu mai corespunde jobului — anulat`, înainte de storage/rezervări/AI.
- `worker/ofertare/plansa_test.ts`: două teste noi parametrizate pentru hash NULL, inclusiv contradicție apărută în timpul rezervării; extinse testele pentru manifest indisponibil și cele patru câmpuri în toate modurile și în apelul efectiv de lipire.
- `poarta_test.ts`: extinse regresiile existente pe ambele moduri pentru licitație/cale diferite, comparație exactă a căii (majuscule/spații), NULL explicit, compatibilitatea cu câmpuri absente și echivalența numerică `95`/`"95"`. Refuzurile verifică exact corpul răspunsului și zero AI/storage/scrieri.

Verificări RULATE:

| Verificare | Rezultat |
| --- | --- |
| `deno check --node-modules-dir=none worker/ofertare/plansa.ts worker/ofertare/plansa_test.ts` | PASS |
| `deno test -A --node-modules-dir=none worker/ofertare/plansa_test.ts` | Runner Deno 2.9.7 căzut: `Unexpected client pipe failure`, Windows 5 / handle invalid; teste neexecutate |
| `deno test -A --node-modules-dir=none supabase/functions/ofertare-plansa-citeste/` | Descărcarea manifestului JSR `@std/assert` a eșuat; teste neexecutate |
| Worker prin `deno eval --node-modules-dir=none` și adaptor | **36 PASS, 0 FAIL** |
| Toate cele 7 fișiere de teste handler prin adaptor Deno și dependențe locale | **240 PASS, 0 FAIL** |

Distribuția handlerului: agregare 57, aprobare_runda5 5, cantitati_nevalidate 30, concurenta 96, invalidare_unitati 24, poarta 16 (cazuri extinse în testele parametrizate), transfer_conflicte 12.

Adaptorul worker urmează codul din `JAK_494_r3_raport.md`; cel pentru handler urmează codul reproductibil din `JAK_494_r4_raport.md`, cu import map temporar `jak494-r5-import-map.json`. Înregistrează și execută secvențial funcțiile originale de test. Pentru handler, numai adaptorul înlocuiește JSR cu aserțiunile `node:assert/strict` și importul npm cu pachetul Supabase local, folosind `deno eval --no-config --no-lock --cached-only --node-modules-dir=manual --import-map ...`. Importurile surselor nu au fost schimbate.

Limite: adaptorul nu reproduce verificările de resurse ale runnerului nativ și nu validează tipurile handlerului. Supabase și AI sunt simulate; nu am verificat PostgREST/Postgres real. Nu am rulat Vitest/build (fără schimbări React), git sau operații în producție. Nu am modificat schema, RPC-uri ori migrări.
