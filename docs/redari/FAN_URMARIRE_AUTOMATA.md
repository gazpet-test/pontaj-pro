# Redări FAN — urmărirea AWB-urilor actualizată AUTOMAT (felia F2a)

Decizia owner-ului: 21.11.2026. Faptul de pornire: un AWB livrat pe 20.11 la 10:40 a ajuns în ERP abia pe 21.11, când cineva a apăsat
„Urmărire”. De acum urmărirea se actualizează singură, de două ori pe zi, cu **exact aceeași logică** ca butonul.

Ce NU se schimbă: ridicarea (C0) rămâne **propusă** și o confirmă omul („Confirmă ridicarea”, ca azi); contradicțiile ajung „de verificat de om”,
ca azi; confirmările de primire (dovada pentru AR) rămân la buton; plicul nu se atinge; nicio acțiune care costă (generare, trimitere, anulare,
ștergere, etichete) nu poate porni din rularea automată. Garda „doar proiecte de TEST” rămâne și aici, pe aceeași definiție.

Felia e o parte din F2 (`FAN_FLUX_OPERATOR_SPEC.md` §9, §13 F2): fără bifarea automată pe plic (D4), fără verificarea generate / tipărite /
ridicate (D11), fără întrerupător în ecran. Acelea rămân pentru F2 complet.

## 1. Ce livrează

| Fișier | Ce face |
|---|---|
| `supabase/migrations/20270102a_redari_fan_urmarire_auto.sql` (NEAPLICATĂ) | tabelul `red_fan_rulari` + 4 RPC-uri ale clasei B + `fn_red_fan_srv_urmarire` cu `p_rulare` activ |
| `supabase/revenire/20270102a_redari_fan_urmarire_auto_ROLLBACK.sql` | revenirea (readuce textual corpul din 20261228a) |
| `supabase/functions/redari-fan-urmarire/index.ts` | funcția edge nouă: poarta + legăturile |
| `supabase/functions/_shared/redariFanUrmarireAuto.mjs` | rularea (testabilă, fără rețea) |
| `supabase/functions/_shared/redariFanTransport.mjs` | `urmaresteLot` = urmărirea butonului, exportată și folosită de ambele (L19) |
| `supabase/functions/_shared/redariFan.mjs` | `rezumatUrmarireFan`: regula contradicțiilor în același răspuns (precondiția F2, §9.2) |
| `src/redari/fanUrmarireAuto.test.js` | vitest: poarta, drumul, plafonul, erorile, suprapunerea, garda TEST, mutanți JS |
| `scripts/pglite/test_redari_fan_urmarire_auto_local.mjs` | PGlite: migrarea ca runnerul, comportamentul SQL, revenirea, mutanți SQL, porțile 0e / E2 |
| `supabase/tests/20270102a_redari_fan_urmarire_auto_doua_sesiuni.sh` | două sesiuni reale pe clonă (S1 suprapunere, S2 plafon pe muchie, S3 închidere în timpul unui apel) — de rulat de coordonator |
| `supabase/tests/20270102a_redari_fan_urmarire_auto.l15.obiecte.tsv` | lista obiectelor din manifestul L15 v2 (generată pe PGlite) |

## 2. Când rulează și de ce de două ori pe zi

Jobul cron (îl pune coordonatorul după aplicare, §5): `30 5,16 * * *` în UTC = **07:30 și 18:30** ora României iarna (08:30 și 19:30 vara).

- **Seara** prinde aproape tot ce s-a întâmplat în ziua aceea (curierul ridică și livrează ziua): AWB-ul livrat pe 20.11 la 10:40 ar fi fost în ERP
  pe 20.11 seara, nu pe 21.11.
- **Dimineața** prinde scanările de seară târziu și îi dă operatorului starea proaspătă la începutul zilei.
- Cost: apelurile de urmărire sunt gratuite; o rulare cere cel mult 20 de solicitări (2.000 de AWB-uri). Două rulări pe zi sunt mult sub orice
  limită rezonabilă a curierului (limita pe minut nu e documentată: pauză 2 s între solicitări, niciodată în paralel).
- Ora de vară: BD-ul decide slotul după ora României (`< 13` = dimineața, altfel seara), deci o oră de decalaj vara nu strică nimic.
  O singură rulare de cron pe slot și zi (UNIQUE în BD): un al doilea apel al cronului în același slot = „ocupat”, nimic cerut curierului.

Varianta „o dată pe zi, 18:30” e la fel de sigură; o alege owner-ul dacă vrea mai puține rulări (se schimbă doar programul jobului).

## 3. Ce se urmărește (o singură definiție, în BD: `fn_red_fan_srv_de_urmarit`)

Rândurile `red_fan_awb` cu:
- `stare` `generat` sau `ridicat`, cu AWB;
- **nelivrate** (`livrat_la` gol și `urmarire_stare` ≠ `livrat`), **fără retur cunoscut**; cele anulate sunt excluse prin stare;
- generate în ultimele **60 de zile**;
- pe loturile permise de garda „doar TEST” (`fn_red_fan_lot_permis`, aceeași funcție ca pe orice cale cu efect; când garda cade la F4, loturile
  reale intră automat, fără altă schimbare);
- cele **mai vechi urmărite primele** (`urmarit_la` gol întâi), cel mult plafon × 100 = 2.000 de rânduri pe rulare; restul vin la rularea următoare.

Rândurile „de verificat” se urmăresc mai departe (faptele cunoscute nu se suprascriu; o contradicție nouă se adaugă lângă cea veche, ca la buton).

## 4. Cum rulează (funcția edge `redari-fan-urmarire`)

1. **Poarta**, înaintea oricărei citiri: `cronSauOwner` — `x-intern-secret` = Vault `INTERN_EDGE_SECRET` (verificat în BD, `fn_verifica_secret`) sau
   JWT-ul owner-ului logat (`profiles.is_owner`). Altceva = 401, nimic citit. `verify_jwt` rămâne pornit la publicare (cronul trimite și JWT-ul anon
   din Vault, ca jobul 29), dar NU ajunge: decide poarta din cod. Corpul cererii e ignorat.
2. **Revendicarea** (`fn_red_fan_srv_rulare_incepe`): lock consultativ pe cheia rulărilor → rularea rămasă „în curs” de peste 15 minute se închide
   `expirata` → una în curs = „ocupat” → slotul de cron deja rulat azi = „ocupat” → owner-ul: cel mult 4 rulări manuale pe zi. Index unic „una în
   curs” și index unic (zi, slot) ca plasă.
3. **Selecția** (§3). Garda „doar TEST” se reverifică și în cod (`transportPermis`, aceeași funcție ca butonul): un lot care n-ar trece e sărit.
4. **Secretele FAN** se citesc abia acum (nimic de urmărit = nimic citit, niciun apel).
5. **Pe fiecare lot, `urmaresteLot`** (aceeași funcție ca butonul): bucăți de ≤ 100 AWB-uri, pauză 2 s; ÎNAINTEA fiecărui GET, pasul durabil al
   plafonului în BD (`fn_red_fan_srv_rulare_apel`: contor CAS, plafon 20; RD040 = plafon atins) + plafonul local + bugetul de timp (100 s);
   interpretarea comună (`interpreteazaUrmarire` / `rezumatUrmarireFan`); scrierea prin `fn_red_fan_srv_urmarire(p_actor NULL, p_rulare, …)` =
   același corp `fn_red_fan_urmarire_intern` (CAS pe versiune, propuneri), iar BD-ul adună numerele în rândul rulării.
6. **Oprirea la erori** (L05): 429 / 5xx / timeout / formă necunoscută a curierului = rularea se închide `oprita_eroare` cu codul, fără reîncercare
   în aceeași rulare; rularea următoare reia. Refuz determinist pe un lot (rând schimbat între selecție și scriere: P0001 / RD032 / 22023) = lotul se
   sare, rularea continuă. Eroare necunoscută la scriere = oprire.
7. **Închiderea** (`fn_red_fan_srv_rulare_incheie`): o singură dată (a doua oară = starea existentă), cu un rând `urmarire_auto` în `red_jurnal`
   (numerele, sursa, slotul; fără AWB-uri, fără nume).

Apărare în adâncime: clientul curierului al rulării lasă să treacă DOAR `POST /login` și `GET /reports/awb/tracking` (calea exactă, aceeași origine);
orice altceva (`POST /intern-awb`, `DELETE /awb`, etichete, confirmări, borderou, comanda) e refuzat local, nimic trimis. RPC-urile pe listă albă
(`RPC_RULARE`). Răspunsul funcției (păstrat de pg_net) are doar numere și coduri.

## 5. După merge — ce face coordonatorul (în ordine)

Nimic din pașii de mai jos nu se face din PR. Secrete noi: **niciunul** (`INTERN_EDGE_SECRET` și `SUPABASE_ANON_JWT` sunt deja în Vault, jobul 29 le
folosește; `FAN_SELFAWB_USERNAME` / `FAN_SELFAWB_PASSWORD` / `FAN_CLIENT_ID` sunt deja Edge Secrets, ale lui `redari-fan-awb`).

1. **Proba pe clonă**: migrarea prin runner (`--plafon-tranzactie-ms 5000 --amprenta-globala … --diferente-globale …`, manifestul generat cu
   `scripts/livrare_l15_manifest.sh` și comparat cu `supabase/tests/20270102a_redari_fan_urmarire_auto.l15.obiecte.tsv`), apoi
   `supabase/tests/20270102a_redari_fan_urmarire_auto_doua_sesiuni.sh`, apoi revenirea și re-aplicarea.
2. **Migrarea pe producție** (cu „da”-ul owner-ului), prin runner, ca la 20261228a.
3. **Funcția edge** `redari-fan-urmarire` (workflow „Deploy edge function”, slug `redari-fan-urmarire`; NU în `NO_JWT`).
4. **Proba manuală** a owner-ului: un POST cu JWT-ul lui pe funcție (fără corp) → `{ cod: 'ok' | 'oprita' | 'rulare_ocupata', … }`; în
   `red_fan_rulari` apare rularea `manual`; pe `TEST-RAZVAN` rândurile se actualizează ca la buton.
5. **Jobul cron** (SQL, ca postgres; aceleași antete ca jobul 29):

```sql
SELECT cron.schedule('redari_fan_urmarire_zilnic', '30 5,16 * * *', $cmd$SELECT net.http_post(
    url := 'https://dxczwkbciseqniprspcu.supabase.co/functions/v1/redari-fan-urmarire',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT s.decrypted_secret FROM vault.decrypted_secrets s WHERE s.name = 'SUPABASE_ANON_JWT'),
      'apikey', (SELECT s.decrypted_secret FROM vault.decrypted_secrets s WHERE s.name = 'SUPABASE_ANON_JWT'),
      'x-intern-secret', (SELECT s.decrypted_secret FROM vault.decrypted_secrets s WHERE s.name = 'INTERN_EDGE_SECRET')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  )$cmd$);
```

6. **Registrul**: rând în `public.automatizari` (tip `cron_bd` + `edge_function`, referința `redari_fan_urmarire_zilnic` / `redari-fan-urmarire`,
   `secrete_nume` = `INTERN_EDGE_SECRET, SUPABASE_ANON_JWT (Vault); FAN_SELFAWB_USERNAME, FAN_SELFAWB_PASSWORD, FAN_CLIENT_ID, SUPABASE_SERVICE_ROLE_KEY (Edge Secrets)`,
   fișa a–e de la §6) + secțiunea din `claude_docs.registru_automatizari`.

**Oprirea**: `SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname = 'redari_fan_urmarire_zilnic'), active := false);` (sau
`cron.unschedule`). O rulare deja pornită se termină singură (cel mult ~2 minute). **Revenirea** migrării: întâi jobul oprit, apoi revenirea prin
runner (refuză cât există rulări în istoric — atunci nu se rulează).

## 6. Fișa de securitate a–e (CLAUDE.md pct. 7)

- **(a) Conținut extern citit**: DOAR răspunsul curierului la `GET /reports/awb/tracking`. E tratat ca **date**: coduri de eveniment pe listă albă,
  AWB numeric, date cu formă fixă, listele acceptate doar în formele cunoscute; textele curierului nu se păstrează; forma necunoscută = „de
  verificat de om”. Curierul nu poate porni nimic: răspunde doar la întrebările noastre.
- **(b) Ce scrie / face**: DOAR câmpurile de urmărire din `red_fan_awb` (prin corpul comun cu butonul: CAS pe versiune, faptele cunoscute nu se
  suprascriu, contradicția → „de verificat”), rândul rulării din `red_fan_rulari` și un rând de jurnal pe rulare. NU cheltuie bani (urmărirea e
  gratuită; generarea / trimiterea nu pot fi chemate: nici RPC-urile, nici căile curierului), NU confirmă ridicarea, NU scrie pe plic (fără data
  expedierii, fără AR, fără retur), NU trimite mail / SMS, NU atinge drepturi, NU șterge.
- **(c) Identitate**: `service_role` în funcția edge — fără om la cron, iar RLS-ul tabelelor FAN cere un om admin / editor Redări; un cont tehnic cu
  drept de owner ar fi exact ce interzice D2. Perimetrul: poarta (`fn_verifica_secret`, `profiles.is_owner`) și cele 5 RPC-uri din `RPC_RULARE`,
  toate cu EXECUTE **exclusiv** `service_role` și cu `auth.uid() IS NULL` cerut în corp (un JWT de om pe calea serverului = 42501). Nicio scriere
  directă pe tabele (`service_role` nu are niciun drept pe `red_fan_rulari`; postcondiția migrării o verifică).
- **(d) Cine pornește**: DOAR jobul cron (`postgres`, cu `x-intern-secret` din Vault) sau owner-ul logat — verificare de rol în cod
  (`cronSauOwner`), nu doar `verify_jwt` (cheia anon e un JWT valid). Fără secret / cu secret greșit / cu JWT de ne-owner = 401, nimic citit.
  BD-ul reverifică owner-ul (`fn_red_fan_srv_rulare_incepe`).
- **(e) Confirmarea umană păstrată**: ridicarea (rămâne propusă, „Confirmă ridicarea”), contradicțiile („de verificat”, soluționarea owner /
  admin), livrarea / AR-ul / returul (pe plic doar de om), confirmările de primire (butonul), anularea. Regula tare (a)+(b): citește conținut
  extern ȘI scrie → poarta = cine pornește (cron + secret / owner) + ce poate scrie (o listă închisă de câmpuri de urmărire, înainte-numai, fără
  efect juridic: termenul de 10 zile pornește doar din data de expediere de pe plic, pusă de om).

## 7. Probe

- `npx vitest run src/redari/fanUrmarireAuto.test.js`: 401 la orice apelant în afara cron / owner (nimic chemat); drumul complet (p_actor NULL +
  p_rulare, pasul plafonului înaintea fiecărui GET, pauza, închiderea ultima); nicio cale costisitoare (garda de fetch pe tabel de cazuri); plafonul
  (local, RD040 din BD, eroarea pasului, bugetul de timp); oprirea la 429 / 5xx / timeout; refuzul determinist vs necunoscut la scriere;
  suprapunerea („ocupat”); garda TEST din cod; fără secrete / selecție picată / nimic de urmărit = nimic citit; răspunsul fără date; regula
  contradicțiilor (tabel de cazuri); butonul neschimbat; **16 mutanți JS**, fiecare prins.
- `node scripts/pglite/test_redari_fan_urmarire_auto_local.mjs`: validatorul runnerului (5000 / 2000), aplicarea ca la livrare (manifestul =
  lista revizuită), clasa B (authenticated / anon / service_role cu JWT de om = 42501), revendicarea, suprapunerea, slotul, plafonul manual,
  expirarea, selecția (incluse / excluse / ordinea / limita de 2.000), scrierea cu p_rulare (ridicarea rămâne propusă, plicul neatins, CAS,
  garda TEST, numerele din BD), închiderea idempotentă, RLS, butonul F1 neschimbat, confirmările neschimbate; refuzurile migrării; revenirea (refuz
  la fiecare urmă, aplicare → revenire → re-aplicare); **18 mutanți SQL** + martorul; paritatea plafonului JS ↔ SQL; porțile 0e / Izometrie E2.
- Pe clonă (coordonatorul): `supabase/tests/20270102a_redari_fan_urmarire_auto_doua_sesiuni.sh` — S1 două porniri suprapuse (B așteaptă, apoi
  „ocupat”), S2 ultimul apel disputat (B așteaptă, apoi RD040), S3 închiderea în timpul unui apel (B așteaptă, apoi RD041).
- Live pe `TEST-RAZVAN`, după deploy: proba manuală a owner-ului (§5 pasul 4), apoi prima rulare de cron în `red_fan_rulari`.
