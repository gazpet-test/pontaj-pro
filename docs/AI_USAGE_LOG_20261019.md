# Jurnal cost Claude — 19.10.2026

Am adăugat inserări best-effort în `public.ai_usage_log` pentru:

- `extract-talon-ai/handler.ts`: apelul vision, referință la `logistica_active`.
- `detect_plate_orphan_msgs/handler.ts`: fiecare poză/apel vision, referință la `whatsapp_messages_processed`.
- `nightly_patrol_bot/index.ts`: fiecare tentativă din `callAnthropic`, înaintea retry-ului.
- `rag-utilaj/index.ts`: fiecare lot de transcriere (referință la `logistica_documente`) și fiecare răspuns AI la întrebări.

Costul folosește `costApel` cu usage complet, inclusiv cache și pragul per apel. Răspunsul se citește pentru jurnal dintr-o clonă, înaintea verificării HTTP și a ieșirilor pentru refuz/trunchiere/parsare. HTTP eșuat cu usage este jurnalizat; HTTP eșuat fără usage nu produce un rând. Orice excepție de jurnalizare este ignorată; și erorile returnate de Supabase rămân neblocante. Modelele, prompturile, porțile, retry-urile și rezultatele de business nu au fost schimbate.

## Verificare

Comandă rulată: `& 'C:/Program Files/nodejs/node.exe' scripts/test-ai-usage-log.mjs`.

Rezultat: **32/32 teste trecute**, fără rețea sau instalări, pe Node 24.20.0. Runner-ul încarcă testele Deno existente ale celor două handlere, cu aserțiuni noi pentru rândurile de usage și simulări de erori HTTP/jurnal. Verificările suplimentare acoperă ambele căi RAG și patrol: refuz, max_tokens, HTTP 400/500 cu usage, cost cu cache/prag, jurnal care aruncă/respinge/returnează eroare, câte un rând pentru fiecare tentativă de retry. Exporturile interne pentru verificarea RAG/patrol sunt adăugate doar în memorie de runner.

Nu am putut rula `deno test` sau `deno check`: Deno nu este disponibil în mediul local verificat. Runner-ul Node nu validează tipurile sau runtime-ul Deno. Nu am accesat baza de date, API-uri reale, credențiale, Git sau deploy.
