# Revenire E1-1a r2: Auth si stub

SQL nu poate citi configuratia externa Supabase Auth. Marcajul de atestare este declaratia operatorului, nu o dovada tehnica a dezactivarii; clientii nu primesc drepturi noi.

Ordinea obligatorie, executata numai de operatorul autorizat:
1. Procedura de urgenta C1: ban pe toate conturile teren (clasificare, app_metadata sau domeniu), revocarea sesiunilor, verificarea blocarii si a refresh-ului.
2. Dezactivarea Custom Access Token Hook in configuratia Auth si verificarea starii. Nu dezactiva hook-ul inainte de C1.
3. Revenirea etapelor ulterioare (inclusiv E1-1b); revenirea 18a refuza date/istoric/configuratie noi.
4. Revenirea 18a intr-o singura tranzactie, prin artefactul si runnerul revizuite. In ACEEASI tranzactie, operatorul atesta explicit:

```sql
SELECT set_config('gazpet.hook_auth_dezactivat','ATEST:'||txid_current(),true);
```

Runnerul general nu injecteaza aceasta atestare automat. Pentru livrare, pregateste o copie revizuita a artefactului de revenire, cu aceeasi denumire, precedata de instructiunea de mai sus; calculeaza SHA-ul copiei si livreaza copia prin runner. Aprobarea este a artefactului concret. Harness-ul face aceasta copie numai pentru a simula atestarea, fara pretentia verificarii Auth real.

Revenirea pastreaza fn_auth_token_hook(jsonb) INVOKER si EXECUTE numai pentru Auth admin/proprietar. Stub-ul refuza tip_cont=teren sau email @teren.gazpet.ro; pentru restul intoarce evenimentul neschimbat, conform starii pre-portal. Nu are dependente pe tabelele portalului eliminate.

Verifica emiterea ERP, refuzul teren, lipsa obiectelor revenite si istoricul runnerului. La timeout/rezultat NECUNOSCUT, reconciliaza istoricul si configuratia; nu relua automat.

Stergerea stub-ului se face exclusiv printr-o migrare separata de curatenie, dupa confirmarea dezactivarii Auth. Reaplicarea portalului necesita o migrare ulterioara explicita; istoria runnerului si stub-ul impiedica reutilizarea accidentala a livrarii 18a.

## r9 (11.11.2026): cand refuza revenirea si procedura de urgenta

Revenirile 19a si 18a refuza (nimic schimbat) daca dupa aplicare a aparut orice date sau configuratie noua:
- orice cont nou (dupa 19a primeste profil `in_asteptare` + rand `neaprobat` in `conturi_tip`; CHECK-ul vechi pe
  profiles nu ar mai accepta rolul), orice aprobare `fn_cont_aproba_erp`, rezervare / cont teren / revocare, orice rand
  nou in jurnale;
- orice deriva pe lista alba (functii, triggere, RLS, ACL, secvente) sau pe lista PUBLIC / net;
- lock-urile ocupate mai mult de 3 s (`PORTAL_LOCK_BUDGET`, 55P03): se reincearca intr-o fereastra mai linistita;
- r10: sectiunea critica (de la primul lock la COMMIT) peste 2 s (`transaction_timeout`; serverul inchide sesiunea):
  ROLLBACK, runnerul raporteaza NEAPLICAT (cod 10); se cauta cauza (retea / server incarcat) inainte de reluare.

Refuzul e sigur pentru date, dar dupa utilizare normala revenirea NU e un buton de urgenta. Procedura:
1. Login-ul: 18a / 19a nu pornesc hook-ul. O problema de login dupa pornirea hook-ului se rezolva oprind hook-ul din
   configuratia Auth (pasul 2 de mai sus), fara SQL si fara revenire.
2. Crearea conturilor (handle_new_user nou): livrare separata, revizuita si testata, care pune la loc DOAR definitia
   `handle_live` din `portal_e1_1b_manifest` (CHECK-ul nou accepta si rolul vechi `manager_santier`). Nu e scrisa
   dinainte: se pregateste la nevoie, cu „da”-ul lui Razvan.
3. Revenirea completa dupa utilizare: migrare de curatenie noua, cu decizia owner-ului pe fiecare cont nou (rol valid
   pentru CHECK-ul vechi sau stergerea contului). Nu se forteaza revenirea existenta si nu se editeaza amprenta.

Stub-ul `fn_auth_token_hook` ramas dupa revenirea 18a nu exista inainte de 18a si e pastrat intentionat: daca hook-ul
Auth ar fi ramas configurat pe aceasta functie, stergerea ei ar opri toate login-urile. Stub-ul nu citeste tabele, e
INVOKER, EXECUTE numai pentru supabase_auth_admin, lasa conturile ERP si refuza conturile teren (`portal_e1_stub.test.sql`).

Revenirile blocheaza si citirile pe auth.users / employees (si profiles la 19a) pe durata lor (ACCESS EXCLUSIVE, cerut
de DROP-ul FK-urilor / triggerului), cel mult 2 s (plafonul r10; masurat 35–70 ms pe volum ~2x productia, PGlite):
se ruleaza intr-o fereastra controlata.

Exceptia de catalog din r2: pg_catalog ramane suprafata interna PostgreSQL. Functiile si relatiile standard information_schema cu OID sub 16384 sunt amprentate la apply; numai SELECT-ul existent pe relatii este admis, orice modificare si orice obiect nou ramane rosu. Nu sunt acordate privilegii. Aceasta exceptie este necesara pentru initdb standard si trebuie inclusa explicit in review: formula literala «numai 21+12+portal» nu acopera catalogul SQL standard.
