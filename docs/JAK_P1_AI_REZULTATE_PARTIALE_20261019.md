# Garduri pentru rezultate AI parțiale

- `supabase/functions/ofertare-triere/index.ts` și `validare.ts`: HTTP nereușit, `max_tokens`, refuz, text gol și structură incompletă / tipuri greșite întorc eroare de business înainte de orice scriere a răspunsului. Se verifică toate câmpurile trierii, inclusiv listele, justificările și obiectele imbricate; rezultatul precedent nu este înlocuit.
- `supabase/functions/ofertare-raspuns-set/index.ts` și `validare.ts`: aceleași garduri pentru inventar; se cer `dispozitii`, `coada_deschisa` explicită și `acoperit_tot: true`. O anexă cu listă goală rămâne validă. Un inventar invalid nu schimbă coada, dispozițiile, documentele citite sau starea setului.
- Modelele, prompturile, semnăturile RPC și prelucrarea rezultatelor valide sunt păstrate. Logul de consum se scrie după validare; pentru inventarul respins costul calculat este întors în eroare, fără scriere.

## Verificare locală

`& 'C:/Program Files/nodejs/node.exe' .tmp/test-p1-guards.mjs`

Rezultat: **46/46 teste trecute**, inclusiv testele existente `context_test.ts`, `loturi_test.ts` și cele două fișiere noi `validare_test.ts`. Adaptorul local folosește Node 24.20.0, suportul TypeScript nativ și un înlocuitor minimal pentru `Deno.test` / `Deno.readTextFile`. Testele gardurilor execută blocurile reale din handler cu răspunsuri simulate și verifică zero scrieri pentru erori, inclusiv JSON valid cu `max_tokens` / refuz și JSON parțial fără trunchiere.

Deno nu este disponibil: nu s-au rulat harness-ul Deno nativ sau verificarea sa de tipuri. Nu s-au folosit rețeaua, git, instalări, credențiale, baza de date sau deploy.
