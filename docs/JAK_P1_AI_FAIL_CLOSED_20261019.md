# P1: raspunsuri AI invalide

- `hr-recomandare-citeste/index.ts`: ambele apeluri verifica HTTP ok, max_tokens, refuz si text gol prin helper-ele comune. Erorile sunt returnate fara scriere. Recomandarile necesita nume_persoana, rol, beneficiar si obiect_lucrare ca siruri nevida dupa trim; obiectivele necesita denumire text nevida. Lista goala dupa validare opreste actualizarea parintelui si dezactivarea copiilor.
- `meta-publish/index.ts`: text doar din blocuri text; HTTP invalid, max_tokens, refuz sau text principal gol opresc actualizarea text_postare si ai_generat. Textul optional de distribuire existent este pastrat daca raspunsul secundar nu trece garzile.
- `citeste-orice/index.ts`: aceleasi garzi si eliminarea fallback-ului JSON gol. Esecul foloseste eroare(): status eroare + ai_eroare, fara modificarea payload_ai/tip_document si fara status clasificat.

Validare: 28 verificari offline trecute cu Node 24, codul TypeScript transpus cu stripTypeScriptTypes si handler-ele executate in VM. Fetch, Supabase si mediul Deno au fost simulate exclusiv in memorie. Cazuri: HTTP 500, max_tokens cu text prezent, refuz, doar thinking, text alb, recomandari incomplete/goale, lista mixta, obiective invalide si generare valida cu thinking inaintea textului.

Nu exista *_test.ts langa cele trei functii; nu am adaugat fisiere de teste, conform brief-ului. Deno nu este disponibil; nu am rulat deno test/check. Nu am folosit retea, Git, instalari, secrete, baza de date sau deploy. Modelele, prompturile si configuratia de gandire au ramas neschimbate.
