# Validarea răspunsurilor AI — 19.10.2026

- `supabase/functions/hr-extrage-ci/index.ts:97`: HTTP nereușit, max_tokens, refuz și text gol devin `eroare`. Obiectele fără câmpuri de identitate nenule/necompletate nu ajung la INSERT în `hr_ci_extrase`.
- `supabase/functions/detect-ordine/index.ts:68`: max_tokens, refuz, text gol și obiecte fără date utile sunt respinse. După un eșec AI nu se inserează fallback-ul existent: acesta extrage numai tip/data, fără număr sau titlu. Fluxul fără apel AI rămâne neschimbat; `{}` nu mai primește confidence 50.
- `supabase/functions/financiar-verifica-factura/index.ts:113`: răspunsurile trunchiate/refuzate/goale și verdictele cu linii, totaluri sau câmpuri de verificare invalide întorc `ok:false` prin mecanismul existent.
- `supabase/functions/parse-certificat-plata/index.ts:117`: orice max_tokens este respins, inclusiv cu JSON complet. Refuzul, textul gol, liniile incomplete și suma neconformă cu totalul întorc `success:false`.
- `supabase/functions/normative-scan-lunar/index.ts:103`: max_tokens este respins; lipsurile se identifică după ID, inclusiv cu duplicate/ID-uri străine, și se raportează ca eroare parțială. Rândurile lipsă rămân `necunoscut`, fără note/stare noi pentru acest verdict; înainte de salvare se păstrează verdictele cunoscute din rulare (`:221`).

Modelele, prompturile și parametrii apelurilor AI nu au fost schimbate. Nicio excepție business nouă aruncată.

## Verificări efectuate

- Sintaxa celor cinci fișiere: Node 24, `stripTypeScriptTypes` + compilare `vm.SourceTextModule`, reușită.
- Verificări executate din stdin, fără fișiere de test noi: răspunsuri HTTP/AI simulate, obiect gol, text gol, refuz, max_tokens cu JSON complet, lipsuri de câmpuri/linii, total neînchis și cazuri valide. La normative: răspuns parțial, duplicate/ID străin, păstrarea verdictului cunoscut și răspuns complet. Verificările au trecut; aserțiunea inițială pe mesajul românesc a fost reluată fără dependența de codarea stdin PowerShell.
- Nu există `*_test.ts` lângă funcțiile vizate; nu s-au adăugat teste, conform brief-ului.

## Neexecutat

Deno/type-check Deno, vitest și verificări pe API/BD reale nu au fost rulate. Verificările locale nu validează integrarea Deno/PostgREST. Fără Git, instalări, rețea, credențiale, bază de date sau deploy.
