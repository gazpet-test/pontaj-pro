# Draft PR: V2-J04 — verificare SHA-256 pe server înainte de pachet depus

Un manifest cu hash declarat de client putea permite marcarea pachetului `depus` fără obiecte Storage valide. Tranziția cere acum dovezi PASS scrise numai de serviciu, legate de id-ul fișierului, hash și versiunea curentă a obiectului (id, updated_at, eTag, size).

Funcția `ofertare-pachet-verifica` validează contul și modulul înainte de body, citește snapshot înainte/după și calculează SHA-256 streaming. Refuzurile sunt auditate per fișier. UI-ul apelează verificarea înainte de tranziție și afișează motivele. Fișierele peste 32 MiB sunt refuzate pentru worker Terra, neimplementat în acest PR. R12/R5 și matricea de tranziții rămân neschimbate.

Validare: 41/41 teste Node, Deno check și probă directă Deno pentru hash identic/diferit trecute. Harness PG16 pregătit, dar nerulat: PGURI/psql lipsesc. Suita Deno blocată de panic pipe Windows; build/vitest blocate de dependențe indisponibile și registry inaccesibil. API-ul real nu a fost testat.

Migrare nouă cu rollback fără ștergerea auditului. Detalii și fișa de securitate: [raportul V2-J04](jak_j04_rezumat.md). Draft local; fără git, PR publicat, producție sau deploy. Aplicare numai după Jilava 02.10.
