# Redări FAN — urmărirea AWB-urilor actualizată AUTOMAT (felia F2a)

Decizia owner-ului: 21.11.2026. Faptul de pornire: un AWB livrat pe 20.11 la 10:40 a ajuns în ERP abia pe 21.11, când cineva a apăsat
„Urmărire”. De acum urmărirea se actualizează singură, de două ori pe zi, cu **exact aceeași logică** ca butonul.

**Runda 2 (21.11.2026) — decizia owner-ului**: „verificările de livrare la 2000 de oameni o să fie aproape imposibile, trebuie să mergem pe ce
livrează API-ul”. De aceea:

- **Ridicarea (C0), livrarea (S2) și returul raportate de curier se înregistrează AUTOMAT ca fapte**, fără confirmarea omului pe fiecare plic —
  la butonul „Urmărire” și la rularea automată, cu aceeași regulă (același cod JS, același corp SQL `fn_red_fan_urmarire_scrie`). Pe loturile de
  TEST rândul FAN trece singur `generat` → `ridicat` (cu un eveniment `ridicare_auto` în jurnal); butonul „6b. Confirmă ridicarea” rămâne doar
  pentru loturile **reale**, unde confirmarea scrie expedierea pe plic (termenul de 10 zile) — bifarea automată pe plic e D4, la F4, cu „da”-ul
  juridic (spec §15.3).
- **Contradicțiile din răspunsurile curierului NU mai blochează plicul la om**: se rezolvă automat după o regulă deterministă (§3b) și rămân
  **durabil** ca semnal de audit (tabelul `red_fan_contradictii`, lista „Contradicții FAN (audit)” din ecranul AWB, cu filtru pe tip): valorile
  contradictorii, valoarea aleasă, regula, rularea / omul, de câte ori a fost văzută. O rulare ulterioară nu șterge urma și nu mai cere omul.
  Omul poate corecta manual un plic anume, dar nu e obligat.

Ce NU se schimbă: confirmările de primire (dovada pentru AR) rămân la buton; plicul nu se atinge din urmărire; codurile nelimpezi ale curierului
(S99, S50 etc.) rămân „de verificat de om”; nicio acțiune care costă (generare, trimitere, anulare, ștergere, etichete) nu poate porni din
rularea automată. Garda „doar proiecte de TEST” rămâne și aici, pe aceeași definiție.

Felia e o parte din F2 (`FAN_FLUX_OPERATOR_SPEC.md` §9, §13 F2): fără bifarea automată pe plic (D4), fără verificarea generate / tipărite /
ridicate (D11), fără întrerupător în ecran. Acelea rămân pentru F2 complet.

## 1. Ce livrează

| Fișier | Ce face |
|---|---|
| `supabase/migrations/20270102a_redari_fan_urmarire_auto.sql` (NEAPLICATĂ) | `red_fan_rulari` + `red_fan_contradictii` + 4 RPC-uri ale clasei B + corpul comun nou `fn_red_fan_urmarire_scrie` (folosit de `fn_red_fan_srv_urmarire` cu `p_actor` / `p_rulare`, de `fn_red_fan_urmarire` al owner-ului și de învelișul `fn_red_fan_urmarire_intern`) |
| `supabase/revenire/20270102a_redari_fan_urmarire_auto_ROLLBACK.sql` | revenirea (readuce textual cele 3 corpuri din 20261228a) |
| `supabase/functions/redari-fan-urmarire/index.ts` | funcția edge nouă: poarta + legăturile |
| `supabase/functions/_shared/redariFanUrmarireAuto.mjs` | rularea (testabilă, fără rețea) |
| `supabase/functions/_shared/redariFanTransport.mjs` | `urmaresteLot` = urmărirea butonului, folosită de ambele (L19); `clientFan` cu pasul plafonului pe FIECARE GET, inclusiv reluarea după 401 |
| `supabase/functions/_shared/redariFan.mjs` | `rezumatUrmarireFan`: TOATE contradicțiile evaluate, faptele după regulă (§3b), lista `contradictii`; `interpreteazaUrmarire`: forma necunoscută = eroare |
| `src/redari/ui/FanContradictii.jsx` + `FanAwbPrevizualizare.jsx` + `fanLot.js` | lista de audit „Contradicții FAN”; „6b. Confirmă ridicarea” doar pe loturi reale |
| `src/redari/fanUrmarireAuto.test.js` | vitest: poarta, drumul, plafonul (și pe reluarea după 401), erorile, forma necunoscută, suprapunerea, garda TEST, regula contradicțiilor (tabel de cazuri), mutanți JS |
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

Rândurile „de verificat” se urmăresc mai departe (faptele cunoscute rămân; o contradicție nouă se rezolvă după regulă și se adaugă în lista de audit).

## 3b. Regula faptelor și a contradicțiilor (`fan-contradictii-v1`, aceeași în JS și în BD)

Toate contradicțiile se evaluează **înainte** de a construi faptele (nu doar prima). Apoi:

| Contradicția | În același răspuns FAN (`rezumatUrmarireFan`) | Între răspunsul nou și faptul înregistrat (`fn_red_fan_urmarire_scrie`) |
|---|---|---|
| zile de ridicare (C0) diferite | **prima zi** | ziua deja înregistrată **rămâne** (pe plicul real data expedierii e imuabilă) |
| ore de livrare (S2) diferite | **ultima oră** | **ultima oră** dintre cele două |
| livrare și retur | **evenimentul final ulterior** după ora curierului; la egalitate sau cu retur fără oră (`returnAwbNumber`) → **retur** | retur nou peste livrare cunoscută: retur dacă returul n-are oră sau e la / după livrare; livrare nouă peste retur cunoscut: livrat doar dacă livrarea e **după** ultimul eveniment cunoscut la înregistrarea returului, altfel retur |
| motive de retur diferite | motivul ultimului semnal; semnale cu motive diferite la **aceeași oră** → motivul după departajare (refuz > adresă > mutat > avizat) + semnal `retur_motiv` | motivul răspunsului **mai nou**; un răspuns fără motiv păstrează motivul cunoscut |
| **orice eveniment** (C0, S2, retur, refuz, tranzit, orice cod) la un moment **imposibil** (runda 5, vezi mai jos) | respins **înaintea** regulilor de mai sus: nu intră în stare, ridicare, livrare, retur, contradicții, cronologie | un fapt cunoscut imposibil (livrare / zi de ridicare scrise înainte de 20270102a) iese din fapte; fiecare eveniment respins = un semnal `eveniment_data_imposibila` („respins”), doar în audit |

**Regula momentului posibil (runda 5, Jakarinos r4 P1 — clasa, nu cazul C0).** Un eveniment al curierului e **posibil** dacă ziua lui (ora
României) e ≥ ziua generării AWB-ului **și** momentul lui e ≤ momentul procesării + **5 minute** (toleranța mică pentru ceasurile diferite ale
curierului și ale noastre). O singură definiție, aceeași în cod (`redariFan.mjs::momentPosibilFan`, `TOLERANTA_VIITOR_S = 300`) și în BD
(`fn_red_fan_moment_posibil`, test de paritate pe text și pe cazuri). Regula se aplică **tuturor** tipurilor de eveniment:
- codul o aplică **înainte** de orice altă regulă: un eveniment imposibil e ca și cum n-ar exista în răspuns (nicio stare, livrare, retur, zi de
  ridicare, contradicție sau cronologie din el); merge în `respinse` (cel mult 100; peste = „de verificat”, fără fapte, cu numărul în motiv);
- BD-ul o **reface** cu ceasul lui pe fiecare moment al rândului: lista posibilă, cele respinse, momentele afirmate de fapte (ziua ridicării,
  livrarea, returul, valorile contradicțiilor) și faptele cunoscute. Un **dezacord** (un moment „posibil” al codului e imposibil în BD, un
  „respins” e posibil, sau o funcție edge veche trimite un fapt imposibil) = rândul **păstrat** (neschimbat, doar „verificat la”): nicio
  clasificare contestată nu devine fapt; rularea următoare o reface;
- fiecare eveniment imposibil al răspunsului = un rând în audit (`eveniment_data_imposibila`, valorile `[eveniment, reper]`, reperul = `generat
  <zi>` sau `azi <zi>`; revăzut în aceeași zi = același rând, observări + 1); un fapt cunoscut imposibil intră în audit când rândul se scrie;
- o livrare imposibilă **nu e fapt final**: AWB-ul rămâne în selecția rulării automate (`fn_red_fan_srv_de_urmarit`, același predicat) până la un
  fapt final valid; corecția validă ulterioară se înregistrează (nu „ultima oră” dintre ea și cea imposibilă).
Exemplul recenzentului: pe 21.11, C0 20.11 08:00 + S2 24.11 10:00 → **ridicat**, fără livrare, S2 în audit, AWB-ul încă de urmărit; apoi
S2 20.11 10:00 → **livrat la 20.11 10:00**.

**Evenimente la aceeași oră (runda 3).** Rezultatul nu depinde de ordinea în care FAN listează evenimentele: „ultimul eveniment” = **toate**
evenimentele de la ora maximă. Un refuz / adresă greșită / mutat la ora finală e dovadă de retur oriunde ar sta în listă (S2 + S6 la 10:00 →
retur „refuz” + semnalul livrare / retur, în ambele ordini); un cod necunoscut sau „de verificat” la ora finală dă „de verificat” (faptele rămân).
Departajarea explicită (`ORDINE_EGALITATE` în `redariFan.mjs`: înregistrat < tranzit < neutru < ridicat < avizat < livrat < confirmare refuzată <
de verificat < necunoscut < mutat < adresă < refuz < retur, apoi codul) alege doar ce trebuie ales: codul afișat ca ultim eveniment, codul
returului din semnal și motivul la egalitate. Probat pe **toate permutările** cazurilor (până la 720).

**Limita valorilor (runda 3).** O contradicție are cel mult **50** de valori, aceeași limită în cod și în BD (validarea + CHECK-ul tabelului,
test de paritate). Un răspuns cu peste 50 de zile C0 / ore S2 distincte pentru un AWB = rândul „de verificat”, **fără** fapte din acel răspuns, cu
numărul în motiv; celelalte AWB-uri din aceeași cerere se scriu normal (nimic tăiat în tăcere, nicio bucată refuzată de BD).

**Cronologia doar din momente posibile (runda 4, Jakarinos r3 P2).** Garda „ne-mai-veche” a scrierii (un răspuns mai vechi decât ce e deja
înregistrat nu se scrie) și `ultim_eveniment` / `ultim_eveniment_la` se iau **doar** din evenimentele la un moment **posibil**: ziua lui ≥ ziua
generării AWB-ului și momentul ≤ acum + toleranța, ora României (runda 5: predicatul unic de mai sus). Codul trimite lista evenimentelor
posibile (`evenimente`, distincte, în ordinea completă, cel mult **100** — ultimele; aceeași limită în BD, test de paritate), BD-ul alege ultimul
posibil. Astfel o dată respinsă ca fapt nu mai blochează corecția:
- rularea 1: C0 pe 24.11 (în viitor, pe 21.11) → nimic înregistrat, cronologia **goală** (starea „fără evenimente”), C0 în audit; rularea 2: C0 corectat pe 20.11 → **ridicat**;
- un H3 / S2 / orice cod la o dată imposibilă nu intră în cronologie (nu blochează un eveniment valid ulterior);
- un `ultim_eveniment_la` vechi aflat în viitor (scris înainte de 20270102a) nu mai blochează: răspunsul posibil îl înlocuiește;
- un răspuns **cu** evenimente, dar **fără niciunul posibil**, pe un rând cu cronologie cunoscută nu se poate ordona față de ea: rândul rămâne
  **neschimbat** (doar „verificat la”, numărat „păstrat”), iar evenimentele lui imposibile (orice cod, runda 5) intră în audit (fără alte semnale din el);
- un rând trimis fără listă (funcția edge de dinainte) = lista derivată din ultimul eveniment, cu aceeași regulă (un ultim eveniment / fapt
  imposibil = dezacord → păstrat, evenimentul în audit).

Un răspuns **fără** eveniment final nu șterge finalul cunoscut; un răspuns fără cronologie (`events: []`) doar consemnează „verificat la”;
evenimentele identice repetate sunt un singur fapt; un eveniment de formă necunoscută = rândul „de verificat”, **fără** niciun fapt din acel
răspuns (cronologia e incompletă: evenimentul pierdut poate fi chiar al doilea C0).

Fiecare contradicție = un rând în `red_fan_contradictii` (`sursa` = `acelasi_raspuns` / `intre_raspunsuri`, `tip`, `valori`, `ales`, `regula`,
`versiune_regula`, `rulare_id` sau `actor`, `observari`, `prima_la` / `ultima_la`); aceeași contradicție revăzută = același rând (`observari` + 1,
cheia unică pe AWB + conținut). Nimic nu le șterge; citirea = admin / editor Redări; scriere doar prin corpul comun. Exemple (probate pe PGlite):
- două C0 (18 și 19.11), două S2 (20.11 10:40 și 12:00) și S16 (21.11) în același răspuns → ridicat 18.11, retur, fără livrare; 3 semnale;
- prima rulare: două C0 (18 și 19.11) → ridicat 18.11 + un semnal; a doua rulare: un singur C0 pe 19.11 → rămâne 18.11, NU „de verificat”, al doilea
  semnal (între răspunsuri), primul rămâne.

Coloanele vechi `*_contrazis` nu se mai scriu (verificarea prealabilă a migrării cere să fie goale: o contradicție veche nesoluționată se
soluționează întâi cu `fn_red_fan_urmarire_solutioneaza`).

## 4. Cum rulează (funcția edge `redari-fan-urmarire`)

1. **Poarta**, înaintea oricărei citiri: `cronSauOwner` — `x-intern-secret` = Vault `INTERN_EDGE_SECRET` (verificat în BD, `fn_verifica_secret`) sau
   JWT-ul owner-ului logat (`profiles.is_owner`). Altceva = 401, nimic citit. `verify_jwt` rămâne pornit la publicare (cronul trimite și JWT-ul anon
   din Vault, ca jobul 29), dar NU ajunge: decide poarta din cod. Corpul cererii e ignorat.
2. **Revendicarea** (`fn_red_fan_srv_rulare_incepe`): lock consultativ pe cheia rulărilor → rularea rămasă „în curs” de peste 15 minute se închide
   `expirata` → una în curs = „ocupat” → slotul de cron deja rulat azi = „ocupat” → owner-ul: cel mult 4 rulări manuale pe zi. Index unic „una în
   curs” și index unic (zi, slot) ca plasă.
3. **Selecția** (§3). Garda „doar TEST” se reverifică și în cod (`transportPermis`, aceeași funcție ca butonul): un lot care n-ar trece e sărit.
4. **Secretele FAN** se citesc abia acum (nimic de urmărit = nimic citit, niciun apel).
5. **Pe fiecare lot, `urmaresteLot`** (aceeași funcție ca butonul): bucăți de ≤ 100 AWB-uri, pauză 2 s; ÎNAINTEA FIECĂRUI GET efectiv — inclusiv
   reluarea pe care clientul curierului o face după un 401 (login nou), precedată de pauza de 2 s — pasul durabil al plafonului în BD
   (`fn_red_fan_srv_rulare_apel`: contor CAS, plafon 20; RD040 = plafon atins) + plafonul local + bugetul de timp (100 s). Pasul îl cheamă clientul
   însuși (`clientFan({ inainteDeApel })`), deci nicio reluare nu-l ocolește; o rulare cu un client fără pas e refuzată înaintea oricărui GET.
   Login-ul nu e o cerere de urmărire (nu consumă plafonul) și nu pornește dacă plafonul e deja atins. Interpretarea comună
   (`interpreteazaUrmarire` / `rezumatUrmarireFan`, regula §3b); scrierea prin `fn_red_fan_srv_urmarire(p_actor NULL, p_rulare, …)` = același corp
   `fn_red_fan_urmarire_scrie` ca butonul (CAS pe versiune, faptele după regulă, contradicțiile în lista de audit), iar BD-ul adună numerele în
   rândul rulării (inclusiv contradicțiile și ridicările înregistrate).
6. **Oprirea la erori** (L05): 429 / 5xx / timeout = rularea se închide `oprita_eroare` cu codul, fără reîncercare în aceeași rulare; rularea
   următoare reia. **Forma necunoscută a ÎNTREGULUI răspuns** (nicio listă recunoscută, sau o listă în care niciun element nu are un AWB
   recunoscut) = eroare de schemă: `oprita_eroare` / `fan_forma_necunoscuta`, NIMIC scris din acea bucată, loturile următoare nu se mai cer (la
   buton: `urmarire_forma_necunoscuta`, eroare afișată, nimic scris). Diferit de un ELEMENT anume (AWB cerut și absent dintr-un răspuns valid): acel
   AWB e „de verificat”, rularea continuă. Refuz determinist pe un lot (rând schimbat între selecție și scriere: P0001 / RD032 / 22023) = lotul se
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
2. **Migrarea pe producție** (cu „da”-ul owner-ului), prin runner, ca la 20261228a. Verificarea ei prealabilă refuză dacă există contradicții
   vechi nesoluționate (`*_contrazis` sau livrare + retur pe același rând): atunci se soluționează întâi din ecran („Soluționează…”), apoi se
   reia aplicarea.
3. **Funcțiile edge, imediat după migrare**: `redari-fan-awb` (butonul — aceleași fișiere `_shared`, regula nouă; până la republicare, un răspuns
   cu livrare + retur trimis de codul vechi e refuzat de BD cu 22023, nimic scris) și `redari-fan-urmarire` (nouă) — workflow „Deploy edge
   function”; `redari-fan-urmarire` NU în `NO_JWT`.
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
runner (refuză cât există rulări în istoric, contradicții înregistrate sau ridicări automate în jurnal — atunci nu se rulează; după revenire,
`redari-fan-awb` trebuie republicată de pe commit-ul de dinainte).

## 6. Fișa de securitate a–e (CLAUDE.md pct. 7)

- **(a) Conținut extern citit**: DOAR răspunsul curierului la `GET /reports/awb/tracking`. E tratat ca **date**: coduri de eveniment pe listă albă,
  AWB numeric, date cu formă fixă, listele acceptate doar în formele cunoscute; textele curierului nu se păstrează; forma necunoscută a întregului
  răspuns = oprire, nimic scris; un eveniment de formă necunoscută = „de verificat de om”, fără fapte. Lista de contradicții trimisă în BD e
  validată pe listă albă (tip + regulă, valori de formă fixă, alesul printre valori). Curierul nu poate porni nimic: răspunde doar la întrebările noastre.
- **(b) Ce scrie / face**: câmpurile de urmărire din `red_fan_awb` (prin corpul comun cu butonul: CAS pe versiune, faptele după regula §3b) și, pe
  un lot de TEST, starea `generat` → `ridicat` (`ridicat_la` = ziua C0); semnalele din `red_fan_contradictii`; rândul rulării din `red_fan_rulari`;
  în `red_jurnal` un rând pe rulare + un rând pe ridicare automată. NU cheltuie bani (urmărirea e gratuită; generarea / trimiterea nu pot fi
  chemate: nici RPC-urile, nici căile curierului), NU scrie pe plic (fără data expedierii, fără AR, fără retur pe plic), NU trimite mail / SMS,
  NU atinge drepturi, NU șterge.
- **(c) Identitate**: `service_role` în funcția edge — fără om la cron, iar RLS-ul tabelelor FAN cere un om admin / editor Redări; un cont tehnic cu
  drept de owner ar fi exact ce interzice D2. Perimetrul: poarta (`fn_verifica_secret`, `profiles.is_owner`) și cele 5 RPC-uri din `RPC_RULARE`,
  toate cu EXECUTE **exclusiv** `service_role` și cu `auth.uid() IS NULL` cerut în corp (un JWT de om pe calea serverului = 42501). Nicio scriere
  directă pe tabele (`service_role` nu are niciun drept pe `red_fan_rulari` / `red_fan_contradictii`; postcondiția migrării o verifică).
- **(d) Cine pornește**: DOAR jobul cron (`postgres`, cu `x-intern-secret` din Vault) sau owner-ul logat — verificare de rol în cod
  (`cronSauOwner`), nu doar `verify_jwt` (cheia anon e un JWT valid). Fără secret / cu secret greșit / cu JWT de ne-owner = 401, nimic citit.
  BD-ul reverifică owner-ul (`fn_red_fan_srv_rulare_incepe`).
- **(e) Confirmarea umană păstrată** (după decizia owner-ului din 21.11.2026): expedierea pe plicul unui lot REAL („Confirmă ridicarea pe plic”;
  bifarea automată = D4 / F4, cu „da”-ul juridic), AR-ul / returul pe plic, confirmările de primire (butonul), anularea, codurile nelimpezi („de
  verificat”), corectarea manuală a unui plic anume. Faptele raportate de curier în evidența FAN (ridicare, livrare, retur) și contradicțiile NU mai
  cer omul: regula §3b decide, semnalul rămâne în lista de audit. Regula tare (a)+(b): citește conținut extern ȘI scrie → poarta = cine pornește
  (cron + secret / owner) + ce poate scrie (o listă închisă de câmpuri de urmărire + starea „ridicat” pe loturile de TEST, fără efect juridic:
  termenul de 10 zile pornește doar din data de expediere de pe plic, pusă de om).

## 7. Probe

- `npx vitest run src/redari/fanUrmarireAuto.test.js`: 401 la orice apelant în afara cron / owner (nimic chemat); drumul complet (p_actor NULL +
  p_rulare, pasul plafonului înaintea fiecărui GET, pauza, închiderea ultima); nicio cale costisitoare (garda de fetch pe tabel de cazuri); plafonul
  (local, RD040 din BD, eroarea pasului, bugetul de timp) **și pe reluarea după 401** (plafon 1 = un singur GET; RD040 / bugetul pe reluare; pauza
  înaintea reluării; contorul = GET-urile efective); rularea cu un client fără plafon = refuz; oprirea la 429 / 5xx / timeout / **forma necunoscută
  a întregului răspuns** (nimic scris, lotul următor necerut) vs. AWB absent = „de verificat”; refuzul determinist vs necunoscut la scriere;
  suprapunerea („ocupat”); garda TEST din cod; fără secrete / selecție picată / nimic de urmărit = nimic citit; răspunsul fără date; **regula
  contradicțiilor** (tabel de cazuri cu reproducerea recenzentului; perechile tip / regulă = CHECK-ul din BD); rândurile trimise poartă faptele
  rezolvate + contradicțiile; butonul (aceeași regulă, 401 = o reluare, forma necunoscută = eroare); ecranul (6b doar pe lot real, lista de audit
  citită cu keyset); **mutanți JS** (fiecare prins) + martorul nemutat.
- `node scripts/pglite/test_redari_fan_urmarire_auto_local.mjs`: validatorul runnerului (5000 / 2000), aplicarea ca la livrare (manifestul =
  lista revizuită), clasa B (authenticated / anon / service_role cu JWT de om = 42501), revendicarea, suprapunerea, slotul, plafonul manual,
  expirarea, selecția (incluse / excluse / ordinea / limita de 2.000), scrierea cu p_rulare (ridicarea înregistrată automat pe lot TEST + jurnalul
  ridicare_auto, plicul neatins, CAS, garda TEST, numerele din BD), închiderea idempotentă, RLS, butonul F1, confirmările neschimbate; **K1–K11**:
  reproducerea P1 (trei contradicții în același răspuns), două / patru rulări succesive (urma rămâne, nu cere omul, observări), livrare ↔ retur între
  răspunsuri (ambele sensuri), două ore de livrare, date C0 imposibile, payload-ul extern refuzat (22023, 10 forme), RLS / scriere directă pe
  contradicții, nicio coloană `*_contrazis`, lotul real fără ridicare automată; **K12–K17 (runda 3)**: ziua C0 imposibilă pe două rulări (nu se
  salvează, corecția validă trece), în același răspuns și în viitor, ziua veche imposibilă înlocuită; limita de 50 (acceptat), 51 (de verificat),
  bucata mixtă, 51 scris de mână = 22023; ordinile [S2, S6] / [S6, S2] identice în BD, motive la aceeași oră; paritatea cod → BD pe cazurile de
  egalitate; 15 forme noi refuzate (22023); **K18 (runda 4)**: scenariul recenzentului pe două rulări (C0 viitor respins → cronologia goală;
  C0 corectat, mai vechi → înregistrat), același lucru pe un rând cu cronologie, alt cod (H3) în viitor, regula pe moment (azi, peste 30 s),
  răspunsul neordonabil (păstrat, doar zilele imposibile în audit; S2 viitor fără livrare), cronologia veche din viitor, 121 de evenimente →
  ultimele 100 acceptate, rândul fără listă (edge vechi); lista ca date externe (9 forme refuzate, 22023); **K19 (runda 5)**: scenariul lui
  Jakarinos r4 pe două rulări (C0 + S2 viitor → ridicat, fără livrare, S2 în audit, AWB-ul de urmărit; corecția S2 → livrat), corecția peste o
  livrare imposibilă scrisă înainte (rândul de urmărit, livrarea înlocuită, cea veche în audit), **matricea** 13 coduri × (viitor / înainte de
  generare / valid), toleranța (240 s posibil, 330 s nu), dezacordul cod ↔ BD (3 forme → păstrat), limita `respinse` (100 / 101), rândul păstrat
  nu-și auditează faptele cunoscute, predicatul BD = cod pe granițe fixe; `respinse` ca date externe (6 forme refuzate); refuzurile migrării (inclusiv contradicțiile vechi nesoluționate);
  revenirea (refuz la fiecare urmă, inclusiv contradicții și ridicări automate; aplicare → revenire → re-aplicare); **mutanți SQL** + martorul;
  paritatea plafonului JS ↔ SQL; porțile 0e / Izometrie E2.
- Pe clonă (coordonatorul): `supabase/tests/20270102a_redari_fan_urmarire_auto_doua_sesiuni.sh` — S1 două porniri suprapuse (B așteaptă, apoi
  „ocupat”), S2 ultimul apel disputat (B așteaptă, apoi RD040), S3 închiderea în timpul unui apel (B așteaptă, apoi RD041).
- Live pe `TEST-RAZVAN`, după deploy: proba manuală a owner-ului (§5 pasul 4), apoi prima rulare de cron în `red_fan_rulari`.
