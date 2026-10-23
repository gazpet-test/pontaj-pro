# Magazie EIP B1 r3

Livrare completa in cele patru cai cerute. Numai fisiere noi in worktree.

- Idempotenta: `fn_eip_muta(bigint,bigint,text,numeric,text,text)` cere cheia.
  `eip_receptii` este registrul global pentru receptie/mutare, cu `tip` explicit.
  Hash-ul mutarii include tipul `muta`, sursa, articolul destinatie, marimea
  upper/btrim, cantitatea trim_scale si motivul btrim. Sub acelasi advisory lock,
  retry identic intoarce rezultatul memorat; alt continut/tip este refuzat.
  ACL-urile si rollback-ul folosesc noua semnatura obligatorie, fara overload vechi.
- UM la mutare: sursa si destinatia sunt comparate prin upper/btrim cu UM a
  articolului destinatie, inainte de jurnal; incompatibilitatea este atomica.
- Migrare: se verifica UM, cu exceptia istorica explicita pentru cele doua
  mapari de bocanci. Sardegna 47 si bocanci sudura 24 trec din `buc` in `pereche`.
  Se schimba numai eticheta, fara conversie sau impartire a cantitatii; suma
  numerica a celor sase randuri ramane 190 (nu reprezinta 190 buc omogene).
  Celelalte UM compatibile sunt canonizate la UM articolului; orice alta
  incompatibilitate opreste migrarea. Randurile inactive/nemapate raman intacte.
  `eip_migrare_um` salveaza UM exacta pentru fiecare rand mapat, cu RLS si fara
  grant-uri UI. Rollback-ul restaureaza aceste valori numai dupa garzile existente.

Harness: cele 19 scenarii r2 sunt pastrate, adaptate pentru cheia obligatorie
si pentru noua regula UM. Scenariul destinatie unica foloseste acum salopeta
spre casca (`buc` spre `buc`), deoarece bocanci spre casca trebuie refuzat.
Sunt adaugate 9 scenarii r3 (28 total): mapare/backup/190, incompatibilitate la
mapare si normalizare, retry cu 23/1 si doua randuri de jurnal, continut diferit,
cheie globala in ambele sensuri, retry concurent, chei NULL/goale, UM sursa,
UM destinatie si comparatie normalizata intre articole. Rollback-ul complet
compara toate randurile legacy cu starea initiala, inclusiv UM. Sunt verificate
si ACL-urile tabelei de salvare si absenta semnaturii vechi.

Verificare efectuata: inspectie statica a celor patru fisiere, ASCII, semnaturi,
numar de scenarii si corespondenta obiectelor create/eliminate. Nu am rulat
Node, psql, testele PG17 sau API PostgREST: Node/psql nu sunt disponibile in
mediul indicat. Nu declar teste PASS. Nu am executat Git, accesat credentiale,
conectat vreo baza de date sau aplicat/deployat ceva.

Rulare ulterioara de catre owner, numai pe baza locala dedicata PG17, cu owner
nesuperuser si rolurile existente cerute de harness:

```sh
PGURI=postgresql://localhost/eip_b1_test_local node scripts/pg/test_magazie_eip.mjs
```
