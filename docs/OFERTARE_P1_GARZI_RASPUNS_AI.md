# Protectii P1 pentru raspunsuri AI invalide

- `supabase/functions/ofertare-rfq-import/index.ts`: raspuns HTTP acceptat, fara max_tokens/refuz, text nevid; lista de preturi nevida, cu materiale cunoscute si unice si pret explicit null sau numar finit nenegativ. Validarea precede stergerea preturilor si actualizarea metadatelor/importat_ai. Eliminat fallback-ul la `{}`.
- `supabase/functions/ofertare-cerinte/core.ts`: aceleasi garzi de raspuns; JSON incomplet nu se mai recupereaza partial. Resetul ruleaza doar dupa obtinerea unei liste validate nevida, pastrand filtrele pentru cerinte AI neconfirmate, fara Source Pack. Eroarea de stergere opreste inserarea.
- `supabase/functions/ofertare-clauze-formulare/index.ts`: garzi max_tokens/refuz/text gol pentru extragere si completare; stergerea clauzelor cere lista nevida dupa validarea citatelor. Completarea accepta doar text de tip string, nevid dupa trim.

Modelele, prompturile si semnaturile RPC nu au fost modificate.

## Verificare offline

Exista teste adiacente doar la ofertare-cerinte: actualizate asteptarile pentru raspunsuri incomplete si adaugate scenarii reset cu HTTP esuat, max_tokens, refuz, lipsa textului, JSON/lista invalida, eroare de transport, plus ordinea AI -> delete -> insert pe raspuns valid.

36/36 teste din core_test.ts si exemple_test.ts trecute folosind Node v24.20.0 cu adaptor minim Deno.test/Deno.env (`.tmp/verifica-ofertare-p1.mjs`). Verificare de sintaxa TypeScript prin stripTypeScriptTypes + vm.Script trecuta pentru cele trei fisiere modificate.

Deno nu este disponibil; nu s-au rulat deno test sau verificarea sa de tipuri. Nu exista teste adiacente RFQ/clauze, deci nu s-au adaugat, conform brief-ului. Nu s-au folosit retea, baza de date, credentiale, Git sau deploy. Operatiile delete/insert existente raman netranzactionale; schimbarea protejeaza impotriva raspunsurilor AI invalide, fara modificari de schema/RPC.
