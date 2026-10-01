# Verdict Copilot pe #537 runda 2 (94909d6) — 30.09.2026 ~02:05 RO

Text integral, primit prin canalul Copilot (conversația 2), 184 s. Mesajul trimis: antet cu DELTA, constatările, dovezile și limitările, plus cele 3 fișiere SQL integral (commit 94909d6). Testele nu au fost trimise.

---

NO-GO pentru pachetul 94909d6 în forma actuală. Migrarea principală reduce expunerea, dar revenirea propusă încalcă protecțiile Audit V2, iar execuția tranzacțională trebuie clarificată. Review static pe SQL-ul transmis; cele 344 de verificări sunt rezultate raportate, nu executate independent de mine.

Verdict pe fișiere și teste discriminatorii

Fișierul 1 — HOLD pentru corectarea refuzului pe NULL și a procedurii de aplicare. În ambele funcții, înlocuiți:

```sql
IF NOT public.fn_are_acces_ofertare() THEN
```

cu:

```sql
IF public.fn_are_acces_ofertare() IS NOT TRUE THEN
```

În forma actuală, un rezultat NULL nu intră în ramura de refuz. Nu afirm că helper-ul întoarce NULL în live: definiția lui nu este în mesaj, iar hash-ul nu permite verificarea acestei proprietăți. Test local: UID nenul, helper care produce NULL → 42501, fără modificări. Codul actual nu garantează rezultatul cerut.

Fișierul 2 — NO-GO ca revenire operațională sigură. Reintroduce explicit pragul zero și suprascrierea respins_de_om. Păstrarea porții pentru conturile fără modul nu compensează aceste regresii. Testele care trebuie să rămână verzi inclusiv după revenire sunt: verdictul uman respins rămâne neschimbat; pragul zero nu elimină artificial lipsurile. Fișierul actual le încalcă. Revenirea acceptabilă păstrează protecțiile sau oprește funcționalitatea afectată.

Fișierul 3 — numai artefact tehnic, fără GO de execuție. O eventuală utilizare cere decizie și review specifice, nu doar existența comutatorului de armare.

În plus, cele două reveniri nu trebuie descoperite ca migrări forward. Mutați-le din directorul parcurs automat sau demonstrați excluderea lor. Armarea care le face să eșueze nu este echivalentă cu excluderea: poate opri întregul traseu de migrări.

Proveniență: B acum este acceptabil pentru remedierea punctuală, nu pentru închiderea invariantului.

Nu condiționez reducerea urgentă a bypass-ului de realizarea tabelului A, dacă Răzvan acceptă explicit limita temporară. Dar A sau o soluție echivalentă de istoric persistent trebuie să rămână obligație pentru închiderea auditului, nu „dacă mai vrem audit”.

RAISE LOG poate consemna o încercare dintr-o tranzacție ulterior anulată; nu dovedește singur o schimbare comisă. Pierderea alegerii precedente, scrierile REST și concurența rămân OPEN. GO-ul punctual nu certifică proveniența completă a alegerilor.

Precondiția MD5 suplimentară pe rollback: DA, o păstrăm.

Împiedică suprascrierea tacită a unei definiții necunoscute. Nu este însă autorizare și nu acoperă proprietarul sau ACL-ul.

Dacă stările aprobate sunt combinații complete — live, patch, revenire — verificați perechea de amprente acceptată, nu permiteți implicit orice combinație între cele două liste independente. Orice stare mixtă acceptată trebuie justificată explicit.

PG16/PG17 și ipoteza „un singur query”: nu sunt suficiente așa pentru procedura de revenire.

Diferența de MD5 care produce refuz este sigură față de suprascriere, dar verificarea abia după COMMIT poate descoperi că procedurile pregătite de revenire/reaplicare nu mai funcționează. Validați definițiile canonice pe PG17 și/sau introduceți comparația obligatorie a rezultatului înainte de COMMIT. Nu actualizați automat lista albă cu orice amprentă găsită după apply.

Armarea trebuie pusă după BEGIN, prin SET LOCAL, în aceeași tranzacție, nu bazată pe interpretarea unui prefix trimis separat. Trebuie stabilit un singur gestionar al tranzacției: fișierul sau runnerul, cu comportamentul demonstrat.

Două teste obligatorii:

- eroare injectată după prima înlocuire de funcție → ambele definiții inițiale rămân, fără înregistrarea migrării ca aplicată;
- armare urmată de eroare și rollback → reluarea fără armare nouă este refuzată.

În fișierul 3, un SET de sesiune executat înaintea tranzacției poate rămâne activ după eșec, deoarece dezarmarea de la final nu mai este executată. Verificarea pg_db_role_setting nu acoperă acest caz.

Rezidualele: nu toate blochează remedierea punctuală, dar niciunul nu se declară închis.

TRUNCATE, nivelurile viewer/editor/admin și scrierile directe REST pot rămâne în patch-urile distincte, cu acceptarea explicită a domeniului limitat; TRUNCATE rămâne precondiție pentru P2. Privilegiile SQL administrative sunt o limită de încredere; o cale API care permite falsificarea claims-urilor ar fi, în schimb, un bypass separat.

Rezidualul 3 nu este doar o decizie de produs: similaritatea care produce „acoperit” și ascunde obligații neconfirmate contrazice Audit V2. Nu blochează introducerea izolată a porții ca reducere a expunerii, dar blochează declararea matching-ului drept corect și închiderea constatării complete (3). Pragul 0.45 nu este dovadă semantică de satisfacere.

Pentru noul review: revizia corectată, definiția exactă a fn_are_acces_ofertare() și probele relevante din harness, inclusiv execuția tranzacțională și testele de mai sus. Acordul lui Răzvan și excepția de freeze rămân necesare separat.
