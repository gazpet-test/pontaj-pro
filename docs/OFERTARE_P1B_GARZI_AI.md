# P1 — protejarea datelor existente la răspunsuri AI invalide

- `ofertare-organigrama-spec/index.ts`: după verificarea HTTP, respinge `max_tokens`, refuzul prin `mesajRefuz` și textul gol prin `textRaspuns`. Înaintea oricărei scrieri, `core.ts/specOrganigramaValida` cere câmpurile structurii, minimum o fază recunoscută și un rol string nevid. Listele opționale goale, booleenii `false` și valorile necunoscute `null` rămân acceptate. Spec-ul și metadatele existente nu se ating la eroare.
- `ofertare-clarificare-citeste/index.ts`: aceleași gărzi HTTP/trunchiere/refuz/text, plus `rezumat` obligatoriu string nevid. Referințele sau numărul întrebărilor nu pot înlocui rezumatul lipsă. Nici `citita_la`, nici celelalte câmpuri nu se actualizează la eroare.
- `ofertare-document-nou-citeste/index.ts`: gărzi comune în `apelAi`, înaintea normalizării și salvării fragmentelor/sintezei/PDF-ului; rezultatul trebuie să conțină un rezumat string nevid. `scriere.ts` refuză separat citirea goală și motivul `raspuns_ai_taiat`, inclusiv pentru fragmente păstrate de versiunea anterioară. Folosește `upErr`, mecanismul existent de raportare a erorilor, fără a suprascrie `citire_noi` sau a șterge starea fragmentelor.

Modelele, prompturile, semnăturile RPC și normalizarea rezultatelor valide au rămas neschimbate.

Validare offline: `node --test scripts/test-ofertare-p1b.mjs`, Node 24.20.0: **115 trecute, 0 eșuate, 1 omis**. Scriptul execută testele pure Deno existente (adaptor local pentru `Deno.test` și assert), testele noi din `core_test.ts`/`scriere_test.ts` și handler-ele reale transpuse de Node, cu Supabase și fetch simulate. Verifică HTTP nereușit, trunchiere cu JSON valid, refuz, text lipsă/alb, JSON invalid, obiect gol/parțial, rezumat invalid și rezultate valide. Pentru respingerile din handler: zero scrieri și rânduri identice cu starea inițială.

Limitări: Deno nu este disponibil. Testul existent cu `Deno.serve` și abort real pe server local a fost omis explicit pentru respectarea cerinței fără rețea. Nu s-au rulat verificări Deno native sau pe API/BD reale. Fără Git, instalări, credențiale, acces la BD ori deploy.
