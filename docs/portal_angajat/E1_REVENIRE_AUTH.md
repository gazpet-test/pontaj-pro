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

Exceptia de catalog din r2: pg_catalog ramane suprafata interna PostgreSQL. Functiile si relatiile standard information_schema cu OID sub 16384 sunt amprentate la apply; numai SELECT-ul existent pe relatii este admis, orice modificare si orice obiect nou ramane rosu. Nu sunt acordate privilegii. Aceasta exceptie este necesara pentru initdb standard si trebuie inclusa explicit in review: formula literala «numai 21+12+portal» nu acopera catalogul SQL standard.
