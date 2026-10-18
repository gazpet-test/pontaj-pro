# Regresii fail-closed — 19.10.2026

Implementat exclusiv local, fără Git, rețea, instalări, credențiale, bază de date sau deploy.

- `hr-recomandare-citeste/index.ts`: validarea întregului pachet înaintea înlocuirii. Identitatea persoanei este obligatorie; rolul, emitentul și lucrarea pot fi null. Nu se mai filtrează sau trunchiază lista înaintea dezactivării copiilor.
- `parse-contract-pdf/index.ts`, `extract-talon-ai/handler.ts`: obiectele fără câmpuri utile sunt erori de business; nu înlocuiesc clauzele și nu intră în staging. Metadatele precum confidence nu sunt suficiente.
- `parse-pccvi-faze/index.ts`: acceptă lista goală numai cu `are_faze_determinante === false`; o listă parțial invalidă este respinsă integral înainte de ștergeri.
- `citeste-orice/index.ts`: cere tip și informație extrasă, inclusiv titlu/entitate/date; `campuri: {}` și modul null rămân permise. Eroarea păstrează payload-ul existent. Numerele din câmpurile text sunt convertite; valorile monetare rămân numerice.
- `hr-autorizatie-citeste/index.ts`: verifică HTTP și structura care definește propunerea înainte de retragerea celei existente. Tipul necunoscut/null și clasificarea negativă explicită rămân acceptate.
- `rag-utilaj/index.ts`: respinge lotul înainte de indexare dacă nu acoperă exact paginile cerute, fără duplicate sau pagini străine. Paginile explicit goale rămân permise. Răspunsul conversațional max_tokens primește `incomplet: true` și o notă vizibilă.
- `src/process_carte_service_ai_index.ts`: max_tokens, refusal, text gol sau decizie invalidă produc unmatched cu confidence 0, fără asociere sau cache nou.
- Validările comune: `supabase/functions/_shared/structuraExtrageri.ts`. Modelele, prompturile și semnăturile RPC nu au fost schimbate. Jurnalizarea costurilor AI existentă rămâne separată de scrierile datelor extrase.

Verificare: `node --test scripts/test-regresii-fail-closed.mjs` cu Node 24.20.0 — **36 teste trecute, 0 eșuate**. Include testele existente de acces și handler pentru talon prin adaptor Node cu importuri externe simulate, teste pentru validări și execuția handlerelor/funțiilor reale cu dependențe simulate. Fixture-urile de succes pentru talon conțin acum date utile, nu `{}`.

Nu s-au rulat Deno test/check sau Vitest: Deno nu este disponibil, iar dependențele node_modules lipsesc; nu s-au instalat. Adaptorul Node elimină tipurile TypeScript, nu efectuează verificarea tipurilor Deno. Nu s-a validat PostgREST sau o bază de date reală, conform restricției. Nu există modificări de query sau schemă.
