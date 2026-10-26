# Tuya gratuit - finalizare runda 2, 26.10.2026

Baza tuya_base2 a fost copiata integral (9 fisiere), la aceleasi cai in
worktree. Cele sase cerinte erau deja implementate; nu a fost necesara o
rescriere a motorului. Am adaugat un test prin handlerul real pentru sondarea
reusita cu raspuns intarziat si cereri concurente, plus acest raport.

## Verificarea celor sase cerinte

1. Implementat: index.ts exclude dispozitivele iot_lumini din statusurile sync;
   non-lumini la o ora, camere/liste la 6 ore, cu rezervare CAS in config inainte
   de token. Cronul care revine mai devreme produce zero apeluri Tuya.
2. Implementat: lumini_adaptiv.ts calculeaza acoperirea aprobata, pauzele si
   tranzitiile solar/orar/simulare. Citire la 15 minute sau tick de 5 minute
   la distanta strict sub 15 minute de tranzitie, ori dupa o corectie.
   lumini_edge.ts persista ultima citire completa, semnatura si reverificarea
   in runtime.motor.citiri_esuate._adaptiv. Forma respecta lista celor cinci
   chei acceptate de RPC-ul existent. Zero programe/pauze = zero apeluri.
3. Implementat: buget.ts rezerva prin CAS fiecare incercare HTTP, inclusiv
   token, refuz Tuya si esec de retea; refuzul local nu consuma apel.
   Ziua si ciclul sunt calculate in Europe/Bucharest; ciclul incepe pe 6
   (luna precedenta pentru zilele 1-5). Buget implicit 45000, configurabil
   prin buget_ciclu_tuya. Chei: consum_zi_tuya si consum_ciclu_tuya.
4. Implementat: codul 28841004 si mesajele de cota/plata deja recunoscute
   persista cota_blocata_pana. Frana de 6 ore opreste inclusiv OFF/manual owner.
   Dupa expirare, un singur apel rezerva sondarea prin CAS; concurentii primesc
   explicit data blocarii. Succesul elibereaza frana; esecul/workerul pierdut o
   lasa activa. Un token de sondare vechi nu poate sterge o blocare noua.
5. Implementat: CladireLumini.jsx cere actiunea consum, fara HTTP Tuya, si
   afiseaza consumul zilnic/ciclu/buget, starea cotei si citit_la pe lumina.
   Helper-ele JS au teste Node si Vitest. Actiunea returneaza doar sumarul,
   niciodata config-ul integral. Nu necesita schema/RPC nou.
6. Implementat si verificat local: 74 teste Node, inclusiv regresiile rundelor
   anterioare si simularile de mai jos. Convergenta, plafoanele, rotirea OFF,
   poarta de rol si jurnalul au ramas cele din baza primita, cu teste verzi.

## Apeluri pe 24 h simulate

Handlerul index.ts este executat cu DB, transport si ceas simulate, la fiecare
5 minute, pe 24.10.2026 (sambata, Ploiesti). Hardware initial OFF; raspunsuri
imediate, fara erori sau comenzi manuale. Formula motor: tokenuri + statusuri
(inclusiv recitiri dupa POST) + POST-uri.

| Scenariu motor | Token | Status | POST | Total/zi |
| --- | ---: | ---: | ---: | ---: |
| Zero programe si pauze | 0 | 0 | 0 | 0 |
| Un solar, o lumina exterioara | 104 | 107 | 3 | 214 |
| Simulare weekend, cinci lumini interioare | 132 | 676 | 16 | 824 |

Solar: 104 + 107 + 3 = 214. Sunt trei comenzi deoarece ziua incepe in
fereastra solara a zilei precedente: ON initial, OFF dimineata, ON seara.
Simulare: 132 + 676 + 16 = 824; la fiecare tick sunt cel mult doua lumini ON,
iar la final toate sunt OFF. Test separat: o lumina ramasa ON la sfarsitul
ferestrei este recitita si stinsa in cel mult 15 minute, cu transport disponibil.

Sync, exemplu explicit: N dispozitive non-camera/non-lumini, C camere si L
apeluri de lista per lot. Cand intervalele sunt aliniate si exista dispozitive
de citit, formula este 24 * (1 + N) + 4 * (L + C).
Un token pe ora, un status/ora/dispozitiv, liste si camere de patru ori pe zi.
Pentru N=4, C=8, L=3: 24*5 + 4*11 = 164.
Testul combinat executa si cronul sync la 10 minute: 824 + 164 = 988/zi.
Cu acelasi sync, zero programe ar insemna 164, iar solar 378/zi.

Toate cele trei scenarii motor sunt sub 1000; exemplul combinat este si el sub
1000, cu numai 12 apeluri rezerva. Aceste cifre nu garanteaza consumul parcului
real: nu am inventariat dispozitivele, uid-urile sau programele reale.
Fallback-ul de lista, comenzile manuale, stream-urile, erorile si alte date/
seed-uri pot mari consumul. 988*30=29640, dar 988*31=30628; limita pe zi nu
garanteaza sub 30000 in orice ciclu. Nici un buget local de 45000 nu garanteaza
incadrarea intr-o eventuala cota Trial de 26000 mentionata in brief.

## Ce opreste fiecare prag

| Prag | Opriri si operatii ramase |
| --- | --- |
| Sub 70% | Sync si tick adaptiv normale, cu portile existente. |
| 70% (31500 implicit) | Alerta stabila `Tuya: consum API la 70% din cota`, dedup 24 h; nimic oprit suplimentar. |
| 90% (40500) | Sync/liste/stream si citirile periodice fara tranzitie se opresc. Raman comenzile manuale autorizate, tranzitiile programelor si OFF de siguranta cu citirile necesare. |
| 100% (45000) | Raman numai OFF cu citirile/tokenul necesare si comenzile manuale ale ownerului. Aprinderile automate si ON manual non-owner sunt refuzate. |
| Cota externa epuizata | Toate apelurile sunt oprite 6 ore, inclusiv OFF/owner; apoi o sondare. Alerta stabila `Tuya: cota API epuizata`, dedup 24 h. |

Pragurile sunt reverificate la fiecare apel, inclusiv intre token si status/
POST. Contorul este local, porneste la prima utilizare si nu recupereaza consumul
anterior sau consumul altor clienti Tuya. Rezervarea precede fetch: un worker
ucis intre CAS si HTTP poate supraestima consumul; nu este factura Tuya.

## Verificari executate si limite

- Node 24.20.0, `node --test scripts/test_lumini_node.mjs`: 74/74 trecute.
  Initial baza avea 73/73; extensia confirma o singura sondare aflata in zbor,
  refuzul concurentilor sync/tick/manual owner si reluarea dupa succes.
- `node --check`: toate cele cinci fisiere .ts din supabase/functions/tuya trec.
  Verificarea este sintactica; nu inlocuieste Deno/typecheck.
- Node nu era in PATH; am folosit executabilul din C:/Program Files/nodejs.
- `npx --no-install vite build` si `npx --no-install vitest run src`, offline,
  cu cache configurat in worktree: ambele esueaza inainte de pornire cu
  `uv_os_homedir returned ENOMEM`. Nu exista node_modules local; nu am instalat
  dependente. Build/Vitest nu sunt declarate trecute.
- Deno nu este disponibil in PATH. Deno, browser, Tuya real, Postgres si
  PostgREST real nu au fost rulate. CAS JSONB, query-urile si latentele reale
  raman de verificat de echipa autorizata; mock-urile nu dovedesc API-ul real.
- Nicio migrare, schema sau functie RPC nu a fost schimbata. 20261113a ramane
  neatinsa. Nu sunt necesare obiecte BD noi pentru aceasta implementare.
- Siguranta OFF este limitata de disponibilitatea Tuya, frana de cota si
  plafoanele temporale existente. Nu promite stingere fizica in timpul franei.
- Raportul CDX_TUYA_CONSUM_RAPORT.md este istoricul rundei 1; formulele lui
  pentru frecventa veche sunt inlocuite pentru runda 2 de cifrele de aici.

## Fisa de securitate a-e

a. Intrari: fisiere locale din worktree si baza/briefurile locale indicate
   explicit de utilizator; transport exclusiv mock. Nimic citit din servicii
   externe, nicio pagina web, niciun secret real. Continut extern = date.
b. Scrieri viitoare ale codului: iot_integrari.config (CAS contoare/intervale/
   frana/rezervari alerte), stare/eroare integrare, notifications prin iot_alerta;
   iot_dispozitive, iot_citiri, runtime si jurnal lumini ca in calea existenta.
   In sesiune s-au scris numai fisiere din worktree, fara BD sau comenzi fizice.
c. iot_dispozitive.activ nu este modificat; inactivele sunt excluse, conflictele
   de inserare ignorate. Nicio schimbare de drepturi, module, roluri sau is_owner.
d. Client service_role existent pe server; nu am citit/cerut credentialele
   acestuia. UI nu primeste configuratia completa sau chei Tuya.
e. Pornire: cron cu x-iot-secret pentru tick, autentificarea existenta pentru
   sync; UI lumini cu poarta cladire, editor/admin/owner pentru comenzi si owner
   pentru test. Secretul cron singur nu autorizeaza comenzile manuale.
   Fara Git, commit, push, deploy, mailuri sau dependente noi. Interdictia
   explicita de commit din cererea curenta are prioritate fata de brief.
