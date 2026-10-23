# E3b-A — infrastructura corecțiilor

Implementat numai în worktree, pe designul r5; toate Q-E3b-1…18 = A. Fără Git, rețea, credențiale, conexiuni BD sau deploy. Fișierele LIVE 20261102a / 20261102c / 20261103b nu au fost editate.

Fișiere create:

- `scripts/izometrie/e3b_gen/gen_e3b.py`, `e3b_tpl.sql`, `e3b_rev_tpl.sql`: sursele generatorului;
- `supabase/migrations/20261105a_izometrie_e3b_corectii.sql` și `supabase/revenire/20261105a_izometrie_e3b_corectii_ROLLBACK.sql`: ieșiri generate;
- `scripts/test_izometrie_e3b.sh`, `scripts/izometrie/e3b_gen/harness_wsl.sh`: harness PG16, porturi 6000+slot, directoare `/tmp/pg_izo_e3b_slot<N>`;
- `supabase/tests/izometrie_e3b.test.sql`: catalog, matrice, identitate tranzitivă, mutații de privilegii / rol / RLS / index / PUBLIC EXECUTE;
- `scripts/izometrie/e3b_gen/test_gen_e3b.py`: verificări offline;
- `.gitattributes`: `*.sh text eol=lf`;
- acest raport.

Schema cuprinde cele trei tabele cu CHECK-uri/FK-uri/indexuri, RLS și politici, extensia tipurilor de eveniment și motivul, lista L și L_ident dintr-o sursă comună, cele două roluri și privilegiile pe tabele/coloane/secvențe/helpere existente. Poarta verifică matricea pe fiecare coloană, rolurile și USAGE exact pe secvențe; ștampila inventariază catalogul nou. `fn_izo_porti_lipsa` primește numai apelul porții E3b.

Re-ștampilarea urmează §17.4 din `E3_CONFIRMA_DESIGN.md`: lock exclusiv + READ COMMITTED, baseline verde și lista post-E3 fixă înainte de DDL, lista post-E3b fixă înainte/după ștampile, apoi poarta completă. Piesa A adaugă șapte dependențe implicite, toate din politici, declarate în SQL-ul generat; nu adaugă trigger-e. Generatorul citește constantele E3 prin AST, fără importarea/rularea generatorului E3, care ar rescrie fișiere LIVE.

Rollback-ul refuză orice fapt din lista §7, verifică amprenta și poarta, retrage explicit și GRANT-urile pe coloane, restaurează corpul porții E3, CHECK-ul și valorile originale ale ștampilelor/COMMENT-ului. Verifică egalitatea amprentei finale cu cea dinainte de E3b. Harness-ul pregătește lanțul complet E3b → E3 → 2c → E2a și verifică egalitatea exactă după revenirea E3b.

Delimitări pentru B/C/D:

- `@@GARDA@@`: context, validări, autorizare, gărzi și trigger-e ALWAYS (§3.2–3.4);
- `@@OPERATII@@`: RPC-urile corecțiilor (§5);
- `@@STORNO@@`: funcțiile LIVE înlocuite și helper-ele de storno (§6, Q1=A/Q17=A);
- `@@ISTORIC@@`: salvarea cu instantaneu/diff și garda istoricului (§5.7).

Aceste patru marcaje sunt păstrate în șablon și înlocuite cu șiruri vide la generare. Nu există referințe SQL executabile la obiectele viitoare. Blocul „PIESA B/C/D: GRANT-uri” inventariază privilegiile rămase. La adăugarea trigger-elor se extind lista Python a invocărilor implicite, verificarea numărului exact de trigger-e ALWAYS și inversa din rollback. Piesa A este aplicabilă separat ca infrastructură, dar nu oferă încă operațiile sau protecțiile complete ale E3b.

Interpretări de integrare:

- Numele 20261105a și marcajele de livrare/revenire folosesc brief-ul; numele 20261104a din §2/§7 nu este reutilizat.
- Legătura eveniment/corecție respectă §2.4: FK-ul `izo_corectii.eveniment_id` și indexul unic pe `document_id` pentru `document_tip='izo_corectie'`. Nu adaugă coloane/FK text→bigint în registru; egalitatea semantică va fi verificată de garda piesei B (§3.3).
- Helper-ele constante L/L_ident sunt IMMUTABLE INVOKER, fără acces la tabele, conform matricei explicite §3.5; porțile sunt SECURITY DEFINER. Toate au `search_path = public, pg_temp` și EXECUTE retras de la PUBLIC/API pentru funcțiile interne.
- Gărzile și salvarea E3 nu sunt rescrise în A: se verifică md5-urile LIVE și se păstrează infrastructura de extragere exactă pentru D, conform brief-ului. Hash-ul documentului E3 rămâne neatins (§5.7).

Verificări executate:

- `python scripts/izometrie/e3b_gen/test_gen_e3b.py`: 3 teste trecute, inclusiv două generări consecutive identice și SHA-256 neschimbate pentru cele trei migrări LIVE;
- `python -X utf8 scripts/livrare_validator.py supabase/migrations/20261105a_izometrie_e3b_corectii.sql`: acceptat, o instrucțiune de nivel superior;
- `bash -n` separat pe ambele scripturi noi: trecut;
- generatorul refuză marcaje nereînlocuite și delimitatori dollar-quote dezechilibrați; testul verifică restaurarea byte-cu-byte a prosrc al porții și că A nu rescrie celelalte funcții rezervate lui D.

Python a fost rulat cu interpreterul local `C:\Program Files\Python313\python.exe` (nu există alias `python` în PATH). Bash este cel local din Git for Windows; nu s-au executat comenzi Git.

Nu s-au executat PostgreSQL, harness-ul SQL, PostgREST sau reveniri. Nu este demonstrată încă aplicarea pe PG16 ori primitivele de rol ca `postgres` nesuperuser pe PG17. Aceste verificări și probele tranzitive ale B/C/D rămân obligatorii înainte de livrare (§7/§9); validarea statică nu le substituie.
