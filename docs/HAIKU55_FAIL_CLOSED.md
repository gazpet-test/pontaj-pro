# Corectie fail-closed Haiku 5.5

Modificate doar cele cinci parsere: parse-pccvi-faze, ocr-packing-list, parse-anexa-pdf, parse-contract-pdf, parse-contract-proiect (supabase/functions/<functie>/index.ts).

- `result.stop_reason === 'max_tokens'` intoarce HTTP 422 cu `Raspuns AI incomplet (max_tokens); reincearca`.
- `const raw = textRaspuns(result)` elimina fallback-ul `'{}'`; `!raw.trim()` intoarce HTTP 422 cu `Raspuns AI fara text`.
- Ambele garzi sunt inainte de orice scriere, inclusiv ai_usage_log. Refuzul existent ramane returnat ca eroare de business.
- PCCVI foloseste `Array.isArray(parsed?.faze) ? parsed.faze : []`; dupa filtrarea si normalizarea existenta, `faze.length === 0` intoarce HTTP 422 cu `AI nu a gasit faze; fazele existente raman neschimbate`, inainte de DELETE si de actualizarea proiectului. Acopera si null, array absent si lista cu toate elementele eliminate prin filtrare.
- rag-utilaj verificat, nemodificat: nu are fallback `'{}'` la parsarea unui obiect. OCR-ul lui foloseste separat un fallback `[]`, iar raspunsul conversational foloseste `null`.

Verificare: controale statice locale PowerShell pentru existenta/ordinea garzilor fata de primul INSERT, eliminarea fallback-ului si pozitia garzii PCCVI inainte de DELETE; toate au trecut. Nu exista fisiere *_test.ts alaturate celor cinci functii, deci nu am adaugat teste conform brief-ului. Deno nu este disponibil in PATH; nu am executat verificare Deno sau teste runtime.

Fara Git, retea, instalari, credentiale, acces la baze de date sau deploy.
