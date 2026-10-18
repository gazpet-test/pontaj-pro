# Garduri fail-closed pentru raspunsurile AI

- `supabase/functions/hr-autorizatie-citeste/index.ts:113`: `max_tokens` devine `eroare` inainte de extragerea obiectelor JSON. Textul este citit cu `textRaspuns`; textul gol este respins explicit. Refuzul si jurnalizarea consumului pastreaza mecanismul existent; nu se modifica propunerile la eroare.
- `supabase/functions/extract-talon-ai/handler.ts:128`: `max_tokens` si textul gol intorc HTTP 200 cu `success:false`, inainte de parsare si de scrierea in staging. Garda de refuz ramane activa.
- `supabase/functions/detect_plate_orphan_msgs/handler.ts:196`: motivul opririi este propagat din `callVision`; raspunsurile trunchiate, refuzate sau goale nu se parseaza. Se pastreaza calea de business `no_match` / `FAILED`, fara salvarea unei placute partiale sau actualizarea alimentarii.
- `supabase/functions/nightly_patrol_bot/index.ts:123`: `callAnthropic` intoarce `data:null` / `MAX_TOKENS`, astfel incat candidatul intra pe calea existenta de eroare. Nu se extrage JSON din raspunsul trunchiat.

Teste adaugate in `extract-talon-ai/handler_test.ts:143` si `detect_plate_orphan_msgs/handler_test.ts:130`: JSON valid cu `stop_reason:max_tokens`, text gol si refuz cu JSON valid. Se verifica lipsa scrierilor de date extrase, respectiv doar marcarea erorii pe mesajul corect. Celelalte doua directoare nu au fisiere `*_test.ts`; conform brief-ului nu s-au creat suite noi.

Verificare statica locala: toate cele patru garduri `max_tokens` preced parsarea/construirea textului. Testele Deno NU au putut rula: executabilul `deno` nu este disponibil. Comanda incercata, fara descarcari: `deno test --cached-only --node-modules-dir=none supabase/functions/extract-talon-ai/handler_test.ts supabase/functions/detect_plate_orphan_msgs/handler_test.ts`.

Nu s-au schimbat prompturi sau modele. Nu s-au folosit git, retea, instalari, credentiale, baza de date sau deploy.
