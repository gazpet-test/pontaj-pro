# CDX - Magazie EIP B1

Livrare completa, ASCII, pentru review si rulare pe PostgreSQL 17 ca owner nesuperuser.
Au fost scrise numai cele trei fisiere cerute si acest raport. Fara Git, credidentiale,
conexiuni la BD, modificari UI sau deploy.

1. Idempotenta legata de continut
   - eip_receptii.continut_hash: MD5 al JSON-ului canonic antet + linii.
   - Antetul include toate campurile folosite la persistare. CUI si marimea sunt
     normalizate; ID-urile si numerele sunt convertite, scalele numerice eliminate.
     Liniile sunt sortate dupa articol_id, marime si continut pentru duplicate.
     Multiplicitatea liniilor se pastreaza. Data implicita ramane NULL in hash,
     pentru ca o reluare in alta zi sa poata returna receptia initiala.
   - Aceeasi cheie cu hash diferit ridica eip_cheie_reutilizata inainte de scrieri.
   - Teste: reluare identica dupa alta receptie, factura B cu cheia A, schimbari
     separate de antet/cantitate/pret, snapshot integral nemodificat, normalizare
     numerica si reordonare cu duplicate, conflict concurent dupa commit.

2. Marime obligatorie
   - Intrarea si mutarea refuza NULL/gol/spatii pentru numar si litera cu
     eip_marime_obligatorie. Articolele unica accepta numai marime NULL normalizata.
     Migrarea pastreaza NULL istoric pentru randurile mapate.
   - Teste pentru bocanci, salopeta, casca, normalizare XL si atomicitatea refuzurilor.
   - Testul vechi de deriva foloseste acum o marime concreta; o intrare noua de
     bocanci cu NULL ar fi oprita mai devreme, corect, de validarea marimii.

3. Mutare
   - fn_eip_muta: SECURITY DEFINER, search_path fix, verificare drept, motiv si
     cantitate finita pozitiva; destinatie activa validata si creata la nevoie
     cu categorie eip, stare functional, UM din articol.
   - Acelasi advisory lock global ca intrare/corectie. Lock pe inventarul legacy
     pentru stabilizarea asignarilor, apoi FOR UPDATE pe cele doua stocuri in
     ordine crescatoare de id. Se reverifica invariantul la ambele capete.
   - Doua randuri de jurnal sursa mutare, cantitati opuse si acelasi motiv;
     actualizari atomice. Sursa ramane cel putin la cantitatea nereturnata asignata.
     Mutarea in acelasi rand este refuzata explicit.
   - Teste: NULL->42 cu total articol constant, Weldstar->Steeler, valori implicite,
     motiv gol/NULL, cantitati invalide, lipsa drept, sub asignat, excluderea
     retururilor, anularea destinatiei la eroare, destinatie unica NULL,
     concurenta pe destinatie noua comuna, depasirea disponibilului dupa commit,
     destinatie cu id mai mic, deriva la sursa/destinatie si invariant dupa operatii.

4. RLS
   - SELECT pe eip_intrari si eip_receptii foloseste EXISTS pe profiles cu auth.uid(),
     exact aceleasi patru drepturi ca verificarea RPC.
   - Fixture-ul are SELECT pe propriul profil prin RLS, necesar politicilor EXISTS.
   - Teste: toate cele patru drepturi vad randurile; utilizator fara drept,
     profil inexistent si JWT fara sub nu vad jurnalul/receptiile.

5. ACL si Gate 0e
   - REVOKE explicit inclusiv service_role pentru cele cinci functii cerute.
     Helperul nu are EXECUTE pentru authenticated; doar cele patru RPC UI primesc
     acest GRANT. Triggerul ramane fara EXECUTE direct pentru rolurile client.
   - Nicio functie nu apeleaza set_config.
   - Teste: default privileges simulate pentru anon/authenticated/service_role,
     inspectie ACL inclusiv PUBLIC, apeluri refuzate efectiv pentru anon/service_role,
     helper refuzat din UI, verificare corpuri fara set_config, DML direct refuzat.

6. Rollback
   - Advisory lock global, blocarea inventarului/stocului/jurnalului, verificarea
     invariantului inainte de DROP si garda istoricului operational.
     Verificarea include randuri inactive si randuri cu jurnal, chiar fara mapare.
   - Sterge si fn_eip_muta. Ordinea lock-urilor urmeaza RPC-urile de corectie/mutare.
   - Teste: garda refuza deriva pe fixture curata inainte de receptii; rollback
     complet pastreaza datele/politicile legacy si elimina toate functiile B1;
     garda refuza istoricul operational. Garzile de refuz sunt rulate ca
     subtranzactii, iar revenirea reusita ruleaza fisierul complet.

7. Compatibilitate
   - Maparea exacta include BOCANCI S3 - SUDURA si SALOPETA CU PIEPTAR CLASICA.
     Se migreaza numai EIP active. Fixture: 6 active, 190 buc, 2 inactive,
     plus SCULA nemapata. Datele si politicile legacy sunt comparate integral.
   - Sunt pastrate scenariile existente: alias exact, multilinie, duplicate,
     concurenta intrarilor, corectie si copie marime, atomicitate, deriva,
     rollback. Testele care acceptau continut diferit cu aceeasi cheie au fost
     corectate conform noii reguli; nu se mai asteapta acceptarea acestuia.

Verificari efectuate aici: citire si review static, verificarea ASCII a fisierelor,
structura functiilor/ACL si prezenta scenariilor din harness.
NU am rulat Node, psql, harness-ul PG17, vitest sau validarea PostgREST; Node/psql
nu sunt disponibile in sandbox conform brief-ului. Nu declar niciun test trecut.
Rularea pe PostgreSQL 17 real ramane necesara, inclusiv comportamentul lock-urilor
si politicile profiles din mediul real (harness-ul foloseste schema izolata teste).

Comanda pentru mediul local autorizat:

```sh
PGURI=postgresql://localhost/eip_b1_test_local node scripts/pg/test_magazie_eip.mjs
```

Harness-ul verifica PG17, owner nesuperuser si numele local dedicat; nu creeaza
roluri. Rolurile authenticated/service_role/anon trebuie sa existe, iar ownerul
sa le poata folosi prin SET ROLE. Schema teste trebuie sa lipseasca; se elimina
la final. Namespace-urile public/auth din fisiere sunt doar remapate la teste.
