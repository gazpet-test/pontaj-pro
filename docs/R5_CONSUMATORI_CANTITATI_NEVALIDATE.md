# R5 — consumatorii lui `ofertare_cantitati`: cantitățile nevalidate folosite ca aprobate

Cerința (Copilot, R5): „Verifică punctual consumatorii: calcul financiar, F3/centralizator, grafic, generator PT și poartă finală. Existența rândului cu status='extras' nu demonstrează singură că a intrat în oferta aprobată. Dacă este consumat ca valoare aprobată, oprește acea utilizare și marchează rezultatele derivate pentru reverificare."

- Ramura: `claude/cantitati-nevalidate-consumatori` (din `main` @ 8a6fbbb). Nepushată, fără PR. Nimic deployat.
- BD: doar SELECT (25.09.2026, după transferul planșei 470 din 16:51:08 UTC). Migrările și SQL-ul pentru lic. 95 sunt **propuse, neexecutate**.
- Regula folosită peste tot: **aprobat = `status='validat'`** (bifa ✓ din 📋 Cantități). `extras`, `diferenta` și `revizuit_clarificare` (0 rânduri în BD, nescris de niciun cod) sunt date de lucru. Regula stă într-un singur loc: `src/ofertareCantitatiAprobare.js`.

## 0. Pe scurt

1. **Lic. 95 nu are încă niciun rezultat derivat din rândurile 1751–1756.** Au fost verificate 10 surse, toate cu 0 rânduri (§3): grafic (parametri, versiuni, activități), poarta propunerii, pachetul, capitolele PT, verificarea finală, RFQ, clarificările născute din cantități și apelurile AI de după transfer. Și `v_ofertare_pt_stare` are `lista_f3_m`, `memoriu_m`, `plansa_m` și `grafic_fronturi_m` pe NULL, pentru că toate cele 6 rânduri au `tip_sursa` NULL. Singurul derivat e un text: `handoff_activ` spune „NU aplicat în ofertă” și „+3.840 = Dn200 din afara UAT” (§3.2).
2. **Riscul era latent, dar real, în 4 consumatori din cod, plus un scriitor care se aproba singur.** Pe starea de azi:
   - Poarta graficului dădea „ok” pe cele 6 rânduri `extras`.
   - „Propune din cantități” punea fronturi Dn200 17.785 m, adică inclusiv cei 13.765 m din afara UAT.
   - Generatorul de clarificări ar fi trimis modelului `lista: 17785`, deci o F3 care nu există.
   - O recitire a planșei ar fi scris „Planșa 1 confirmă” pe 1752–1755.
   - Citirea CAD scria direct `status='validat'`.
   Toate cinci sunt reparate în cod, cu teste. Pe cele verificabile pe codul vechi (clarificări, transferul din planșă) testele noi pică, adică prind defectul.
3. **Nu există consumatori pentru calculul financiar, devize, prețuri sau F3/centralizator.** Platforma nu calculează bani și nu generează F3 din `ofertare_cantitati` (grep, §1 rândurile 14–15). Verificarea finală și generatorul PT nu citesc tabela. Generatorul PT o atinge doar indirect, prin grafic, care e acoperit de fix-ul 1.
4. **Două schimbări SQL sunt propuse în `docs/`, neaplicate:**
   - un view nou, `v_ofertare_cantitati_nevalidate`, pentru poarta propunerii (H2);
   - `ofertare_clarificare_planse_auto` v6, care nu mai citează autorității un total F3 luat din rânduri nevalidate.
   Ordinea e: **întâi migrarea, apoi merge-ul**. Invers, H2 blochează cu „nu putem verifica” pe licitațiile care au F3 (fail-closed, ca la P0c). Azi doar lic. 5 are F3.

## 1. Inventarul consumatorilor

Surse: grep pe `src/`, `api/`, `supabase/functions/`, `worker/`, `supabase/migrations/`, plus catalogul BD (`pg_views`, `pg_matviews`, `pg_proc.prosrc`, `pg_trigger` care conțin `ofertare_cantitati`). Rezultatul din BD: 2 view-uri (`v_ofertare_pt_stare`, `v_ofertare_contradictii`), 2 funcții (`ofertare_clarificare_planse_auto`, `ofertare_transfer_plansa_cantitati`) și 1 trigger (`trg_categorie_cantitate`). Niciun view și nicio funcție nu depind de cele două view-uri. Liniile „HEAD” se referă la 8a6fbbb, iar „acum” la ramură.

| # | Consumator | Fișier:linie | Citește | Filtru status | Tratează `extras` ca aprobat? | Derivate lic. 95 (SELECT 25.09) | Acțiune |
|---|---|---|---|---|---|---|---|
| 1 | **Graficul**: poarta graficului + generatorul (`PoartaGrafic`) | `src/GraficPoarta.jsx` HEAD l.239 (load), l.45–53 `randuriFront`, l.261–276 „Propune din cantități”, l.290–294 rândul „cant”, l.316–330 înghețul; acum l.217, l.241, l.267, l.292–311 | `cantitate` sau `cantitate_plansa` (după „Baza cantităților”), `status`, `um`, `categorie`, `obiect` | niciunul; doar `diferenta` dădea warn/block | **DA.** „cant” = ok pe rânduri `extras`, iar fronturile se propuneau din orice rând. Lanțul: fronturi → `grafic_parametri` → `motorPEHD` → `grafic_versiuni` (snapshot + poartă) → `grafic_activitati` → capitolele PT. Pe lic. 95: „6 rânduri rețea” ok, 6 fronturi Σ 48.195 m | 0 `grafic_parametri`, 0 `grafic_versiuni`, 0 `grafic_activitati` | **FIX**: „cant” = BLOCK cât timp un rând de rețea e nevalidat; fronturile se propun doar din rânduri validate; cantitățile se recitesc din BD înainte de îngheț |
| 2 | **Poarta propunerii / poarta finală**: rândul H2 „Cantitățile rețelei” (card în fișă, panou, semnătura `ofertare_pt_poarta`) | view `v_ofertare_pt_stare`, CTE `qm`; `src/ofertareControale.js` HEAD l.30–52 (`controlCantitati`), acum l.37–70; `src/ofertarePoarta.js` l.150; `src/OfertarePropunere.jsx` l.1202 / l.1841; `src/OfertareLicitatii.jsx` l.3353 | Σ `cantitate` pe `tip_sursa` ∈ {lista_f3, lista_c6, memoriu}, Σ `coalesce(cantitate_plansa, cantitate)` pe `plansa`; rețea = `um='m'`, categorie conductă/rețea, fără „total” | **niciunul** | **DA.** F3 e referința „pe ea punem banii”. O F3 transcrisă de AI și nevalidată trecea „ok” dacă era egală cu fronturile | 0 `ofertare_pt_poarta`. `tip_sursa` NULL pe toate 6, deci H2 = block „lipsește F3”, fără cifre. Latent: pasul A din R5 v2 (`tip_sursa='plansa'`) → „există doar planșe 13.765 m” | **FIX JS**: F3 cu rânduri nevalidate = BLOCK; câmp absent = „nu putem verifica” = BLOCK; memoriul, planșele și C6 nevalidate poartă eticheta „(nevalidat)”. **View nou propus** (§4) |
| 3 | **Clarificarea automată „planșe”** (RPC, apelat din `plansa-citeste` l.599/903 și `api/plansa-felii.js` l.131) | funcția `ofertare_clarificare_planse_auto`, `SELECT round(sum(cantitate),1) INTO v_f3` | Σ `cantitate` pe F3 de conductă (`tip_sursa='lista_f3'`, um m/ml, denumire conductă/țeavă/tub) | **niciunul** | **DA**: cifra intră în textul către AC („lungimea totală de conductă din F3: X m”) | #63 (`auto_planse_1`, `de_trimis`) e text editat de om (v5 nu-l mai rescrie) și nu citează F3; lic. 95 n-are F3. Nicio ciornă `auto_planse` nu citează F3 azi | **v6 propusă** (§4): totalul vine doar din rânduri validate; fără total cât există F3 nevalidată |
| 4 | **Generatorul de clarificări** (edge + worker NAS, același `core.ts`) | `supabase/functions/ofertare-clarificari-propune/core.ts` HEAD l.69 (select), l.95 (payload); acum l.91, l.118, funcția `randCantitatePentruAI` l.60 | rândurile cu `diferenta_nota` (max 40): `cantitate`, `cantitate_plansa`, `tip_sursa`; **fără** `status` | niciunul | **PARȚIAL.** Nu le aprobă, dar pune `cantitate` sub cheia `"lista"`: 1751 ar fi plecat ca `lista: 17785, plansa: 17785`, adică o F3 inexistentă „confirmată” de planșă | 0 apeluri AI pe lic. 95 după 16:51:08, 0 clarificări `platforma` | **FIX**: `status` în select; `sursa_cantitate` și `validat_de_om` în payload; regula explicată în prompt. Cere deploy edge; workerul o preia la pull |
| 5 | **Transferul planșă → cantități** (la recitire) | `supabase/functions/ofertare-plansa-citeste/handler.ts` HEAD l.268–270, l.301–310, l.317; acum l.252, l.273, l.313–332 | rândurile existente: `cantitate`, `status`; acum și `sursa`, `tip_sursa` | păstra doar rândurile `validat` | **DA, la recitire.** `cantitate` unui rând scris de un transfer anterior devenea „dinMemoriu”. Rezultatul: „Planșa 1 confirmă: 2.275 m” (planșa confirmată de ea însăși) și „Memoriu 13.140 m vs planșa 13.740 m” | 1 transfer (doc 470, `transfer.stare='facut'`, 16:51:08), nicio recitire, deci 0 note false | **FIX**: rândurile din planșă nu mai sunt „memoriu”. Nota spune „recitire … nu confirmare”; o recitire diferită → `diferenta` |
| 6 | **Citirea CAD** (scriitor care se auto-aproba) | `api/cad-parse.js` HEAD l.118–128 (`status: 'validat'` la l.123); acum l.121–125 + `api/_cadCantitate.js` | — | — | **DA, auto-aprobare**: o măsurătoare automată intra `validat` și ar fi trecut prin toate porțile de mai sus | 0 pe lic. 95. Lic. 3, rândul 9 (35.620,59 m): `validat`, cu `created_at = updated_at` = 28.08 20:19:55 | **FIX**: rând nou → `extras`; rândul validat de om nu primește cifră și status noi. Rândul 9 = decizie (§6) |
| 7 | 📋 Cantități (editorul) | `src/OfertareCantitati.jsx` l.50 / 63 / 72 / 76 / 82 | tot | — (arată statusul) | NU (afișează, nu calculează) | — | Contor „N nevalidate” + tooltip pe ✓ |
| 8 | `v_ofertare_contradictii` | view (pg_get_viewdef) | toate rândurile | niciunul | NU. E un detector de diferențe; valorile se compară, nu se aprobă. Niciun cod nu-l citește (grep) | 0 rânduri pentru 95 | nimic |
| 9 | Extragerea cantităților (scriitor) | `supabase/functions/ofertare-cantitati-extrage/handler.ts` l.266 (citește `obiect`), l.375 (insert `extras`) | `obiect` | — | NU | — | nimic |
| 10 | RPC `ofertare_transfer_plansa_cantitati` (scriitor) | `supabase/migrations/20260927_…atomic.sql` l.34–44 | — | aplică `status` din patch **fără gardă pe statusul curent** | NU, dar are o fereastră de cursă cu o validare umană făcută între citirea handler-ului și RPC | — | recomandare §7 (neaplicată) |
| 11 | Trigger `trg_categorie_cantitate` | `fn_trg_categorie_cantitate` | `denumire` | — | NU | — | nimic |
| 12 | **Verificarea finală** (`ofertare-verificare-finala`) | `index.ts` l.68–85: citește `ofertare_licitatii`, `ofertare_cerinte`, `v_dovezi_stare`, `ofertare_formulare_registru` | **nu citește** `ofertare_cantitati` | — | NU | 0 `ofertare_verificari` | nimic |
| 13 | **Generatorul PT** (`ofertare-genereaza-capitol`) | `index.ts` l.90–100: citește `grafic_activitati`, acoperirea, garanția, participanții, … | **nu citește** tabela; indirect prin `grafic_activitati` (nume de front cu metri) | — | indirect, prin #1 | 0 capitole, 0 activități | acoperit de FIX #1 |
| 14 | **Calcul financiar / devize / prețuri** | `Financiar.jsx`, `devizParser.js`, `CatalogDevizPanel.jsx`, `OfertareRFQ.jsx` | **niciunul** nu citește `ofertare_cantitati` (grep). Materialele RFQ se introduc manual (`ofertare_rfq_materiale`) | — | NU | 0 `ofertare_rfq` | nimic |
| 15 | **F3 / centralizator** | `exportCentralizatorXlsx.js` (Transgaz, execuție), `Izometrie.jsx`, `OfertareExport.js` (propunere / borderou / F23 / F9) | **niciunul** nu generează F3 din `ofertare_cantitati` | — | NU | — | nimic |
| 16 | Pachetul (depunerea) | `src/ofertarePachet.js`, trigger `fn_ofertare_pt_pachet_poarta_documentatie` | nu citește cantități; depinde de semnătura porții | — | indirect, prin #2 | 0 `ofertare_pt_pachet` | acoperit de FIX #2 |
| 17 | `controlTronsoane`, `controlGraficSursa`, `GraficLucrare.jsx` | `src/ofertareControale.js` l.433+ | nu citesc `ofertare_cantitati`; `controlTronsoane` nu e apelat nicăieri | — | NU | — | nimic |
| 18 | Worker NAS (ingest, SEAP) | `worker/ofertare/ingest.ts` l.150, `seap.ts` l.40 | doar tipul de document `lista_cantitati` | — | NU | — | nimic |

## 2. Fix-urile (cod, pe ramură)

| Fișier | Ce face acum | Test |
|---|---|---|
| `src/ofertareCantitatiAprobare.js` (nou) | Conține regula (`esteAprobata`), `randuriFront` mutat neschimbat, `controlCantitatiGrafic`, `fronturiDinCantitati` și `campuriCantitatiNevalidate`. Funcțiile sunt pure. | `src/ofertareCantitatiAprobare.test.js`: 15 teste, pe rândurile reale 1751–1756 |
| `src/GraficPoarta.jsx` | Rândul „cant” e BLOCK cât timp un rând de rețea e nevalidat (lic. 95: „6 din 6 rânduri de rețea NEVALIDATE (48.195 m…)”). „Propune din cantități” ia doar rândurile validate: pe lic. 95 azi propune 0 fronturi și are 6 excluse; după validarea lui 1752–1756 propune 5 fronturi / 30.410 m, iar Dn200 rămâne pe dinafară. Generarea recitește cantitățile din BD și refuză dacă între timp s-a redeschis un rând. În `grafic_versiuni` se îngheață cantitățile proaspete. **Schimbare de comportament**: „diferență memoriu/planșă + baza aleasă” nu mai trece ca warn; rândul trebuie validat. | idem |
| `src/ofertareControale.js` (H2) | F3 cu rânduri de rețea nevalidate → BLOCK („F3 … include N rânduri de rețea NEVALIDATE (X m) — transcrise automat…”). Câmpul lipsă sau invalid → BLOCK „nu putem verifica” (control indisponibil ≠ zero). Memoriul, planșele și C6 nevalidate → „(nevalidat)” în text. Cu F3 validată, regula veche rămâne neschimbată. | `ofertareControale.test.js`: +8 teste; cazurile vechi primesc explicit `lista_f3_nevalidate: 0`. `ofertarePoarta.test.js`: +2 teste; fixture-ul VERDE are câmpurile noi |
| `src/OfertarePropunere.jsx` | Lipește `v_ofertare_cantitati_nevalidate` peste `v_ofertare_pt_stare` la încărcare (l.1238) și la recitirea din `semneaza` (l.1845), ca neconfirmatele | build + testele porții |
| `src/OfertareCantitati.jsx` | Contor „N nevalidate” (galben) cu explicație; tooltip pe ✓ | build |
| `supabase/functions/ofertare-clarificari-propune/core.ts` | `status` în select; `randCantitatePentruAI`: `cantitate` + `sursa_cantitate` (tip_sursa sau „planșă (citire automată…)”) + `validat_de_om`; cheia `lista` dispare; regula e în prompt | `core_test.ts`: 4 teste (unul capăt-la-capăt cu fetch simulat și `dry_run`). Contra-probă pe core.ts de la HEAD: testul capăt-la-capăt **pică** |
| `supabase/functions/ofertare-plansa-citeste/handler.ts` | `randDinPlansa` (sursa „… citit automat din scanare” sau `tip_sursa='plansa'`). Un astfel de rând nu mai e „dinMemoriu”. Recitirea identică dă nota „valoare din planșă, nu confirmare din memoriu”. Recitirea diferită dă „rândul are X m din citirea anterioară … verifică” și status `diferenta` (dacă rândul era `extras`). Rândurile validate își păstrează statusul. `treciInCantitati` e exportat pentru test. | `cantitati_nevalidate_test.ts`: 5 teste. Contra-probă pe HEAD: **3/5 pică** („Planșa 1 confirmă” fals). Suita planșei: 49/49 |
| `api/_cadCantitate.js` (nou) + `api/cad-parse.js` | Rândul CAD nou intră `extras`. Rândul validat de om: nu i se schimbă nici cifra, nici statusul; primește doar măsurătoarea și nota („validat cu X m — noua măsurătoare diferă”). Rândul nevalidat: cifra se actualizează, statusul rămâne. | `api/_cadCantitate.test.js`: 4 teste, fără nicio ramură care să scrie `validat` (fișierul cu „_” nu devine funcție Vercel) |

## 3. Lic. 95: derivatele și marcarea lor

### 3.1 Starea din BD (SELECT, 25.09.2026, după transferul din 16:51:08 UTC)

- Sursa: `ofertare_cantitati` 1751–1756, toate `status='extras'`, `tip_sursa` NULL, `extras_de_ai` true, sursa „Planșa 1 — tabel de dimensionare, citit automat din scanare”. Σ `cantitate` = Σ `cantitate_plansa` = 48.195 m. Pe diametre: Dn200 17.785, Dn125 2.275, Dn110 780, Dn90 4.545, Dn63 9.670, Dn40 13.140.
- Doc 470: `citire_ai.transfer` = `facut` (rulare `250693c3…`), iar `sumar.cantitati` = 6 adăugate, 0 actualizate, `total_m` 48.195. E jurnalul scriitorului: nu îl citește niciun consumator (grep `pe_diametre` / `sumar.cantitati`). **Nu se marchează**: `analiza.citire_ai` e scris cu CAS pe `rev`, deci o scriere manuală ar concura cu handler-ul.

| Derivat posibil | n | Observații |
|---|---|---|
| `grafic_versiuni` / `grafic_parametri` (fronturi) / `grafic_activitati` | 0 / 0 / 0 | — |
| `ofertare_pt_poarta` / `ofertare_pt_pachet` | 0 / 0 | `pt_versiune` NULL |
| `ofertare_pt_capitole` (cu cifrele 1751–1756) | 0 | lic. 95 n-are niciun capitol |
| `ofertare_verificari` | 0 | — |
| `ofertare_clarificari` legate (`cantitate_id` 1751–1756) sau `platforma` după transfer | 0 | #63 (automat, 11:50, editat 16:43) și #64 (manual, 16:03) sunt create **înainte** de transfer. Cifrele din #63 (44.355, 11.525, 32.830, 29.555) vin din memoriu / CS, nu din rânduri. |
| `ofertare_rfq` | 0 | — |
| `ai_usage_log` (`ofertare_licitatii`, 95) după transfer | 0 | ultimul apel: 14:14:52 |
| `v_ofertare_pt_stare` (95) | — | `lista_f3_m`, `lista_c6_m`, `memoriu_m`, `plansa_m`, `grafic_fronturi_m` = NULL |
| `v_ofertare_contradictii` (95) | 0 | — |

### 3.2 SQL propus (NEEXECUTAT): `docs/R5_REVERIFICARE_LIC95_PROPUS.sql`

- **(0) Preview**: un singur SELECT pe cele 10 surse. Rulat pe producție pe 25.09 (e doar SELECT), dă **0 peste tot**.
- **(1) Aplicare** (bloc DO, o tranzacție, idempotentă). Nu face nimic dacă 1751–1756 au fost între timp validate. Pune marcajul „[R5-reverificare 25.09.2026: calculat pe cantități NEVALIDATE…]” pe:
  - `grafic_versiuni.nota` (snapshot cu un rând 1751–1756 nevalidat);
  - `ofertare_pt_poarta.nota` (semnată după transfer);
  - `ofertare_pt_pachet.nota` (doar pachetul nedepus);
  - `ofertare_pt_capitole.nota` (capitole care citează cifrele; `nota` nu creează versiune nouă);
  - `ofertare_clarificari.sursa` (doar ciornele `propunere` / `de_trimis`).

  Ce e depus sau trimis, `grafic_parametri` și verificările doar se **raportează** în NOTICE. Pe starea de azi blocul nu modifică nimic: e o plasă pentru fereastra de până la merge. Nu atinge rândurile 1751–1756, ca să nu strice gărzile SQL-ului R5 v2 pe `diferenta_nota`.
- **(R) Rollback** exact: scoate aceeași constantă, iar `NULL` redevine `NULL`.
- **(3) Opțional, la ritualul de final de sesiune**: linia din `handoff_activ` (v5, 25.09 17:47), „470 re-citită complet: … 48.195 m … (candidat; +3.840 m vs 44.355 CS = Dn200 din afara UAT …). NU aplicat în ofertă.”, conține două afirmații de reverificat:
  - „NU aplicat în ofertă”: rândurile există în `ofertare_cantitati`, cu Σ `cantitate` 48.195. Sunt nevalidate, deci neaprobate, dar prezente.
  - „+3.840 = Dn200 din afara UAT”: R5 v2 a respins atribuirea (Nr 1–4 = 13.765 m; diferența candidată e +4.440…+4.560).

Testat local pe PGlite (Postgres 18.3 în proces, de unică folosință), cu 8/8 verificări:
- preview 0 și aplicare fără efect pe starea de azi;
- pe derivate sintetice se marchează exact v1, poarta, pachetul nedepus, capitolul și ciornele; cele depuse sau trimise doar se raportează;
- rularea e idempotentă, iar #63 și #64 rămân neatinse;
- rollback-ul readuce starea identică;
- cu rândurile validate, blocul nu face nimic.

## 4. Migrarea propusă: `docs/R5_MIGRARE_PROPUSA_cantitati_nevalidate.sql` (+ `_ROLLBACK.sql`)

1. **`v_ofertare_cantitati_nevalidate`** (`security_invoker = on`; REVOKE anon/PUBLIC; GRANT SELECT authenticated/service_role). Numără, pe licitație, rândurile de rețea nevalidate pe `tip_sursa`, cu **exact** filtrul `qm` din `v_ofertare_pt_stare`. Preview pe producție (corpul view-ului rulat ca SELECT, 25.09):

   | lic. | F3 nevalidate (m) | C6 | memoriu | planșă | fără tip | rețea nevalidate / total |
   |---|---|---|---|---|---|---|
   | 3 | 0 | 0 | 3 | 0 | 0 | 3 / 5 |
   | 5 | **47 (6.520)** | 5 | 11 | 20 | 0 | 94 / 94 |
   | 95 | 0 | 0 | 0 | 0 | **6** | 6 / 6 |
   | 102 | 0 | 0 | 0 | 0 | 2 | 2 / 2 |

   Efect după aplicare și merge: pe lic. 5 (Domnești, termen 18.09 trecut) H2 devine block până se validează cele 47 de rânduri F3. Celelalte licitații n-au F3, deci H2 rămâne block „lipsește F3”, ca azi.
2. **`ofertare_clarificare_planse_auto` v6.** Baza e funcția **live**: repo v5 plus linia `v_nou := v_noi > 0 AND v_standard`, verificată prin md5 al corpului fără comentarii și spații = `0875c2200e072289cd5b972b49cabb0c`. Față de live se schimbă:
   - totalul F3 vine doar din `status='validat'`;
   - cu rânduri F3 nevalidate, punctul 2 devine „Corespondența fiecărui tronson cu poziția din lista de cantități (F3) în care este cuprins;”, fără total;
   - `f3_nevalidate` apare în rezultat.
   Azi n-ar schimba nicio ciornă: singura `auto_planse` e #63, text de om.
3. **Rollback**: DROP VIEW și funcția live exactă (md5 identic, verificat local). Se face **împreună cu revert-ul codului**.

Testat pe PGlite, 12/12:
- rollback = live (md5);
- live citează „1.600.0 m” din rânduri nevalidate, deci bug-ul e reprodus;
- view-ul dă lic. 95 = 6 fără tip, lic. 5 = 1 F3 nevalidat (500 m, TOTAL exclus);
- `security_invoker` și grant-urile sunt corecte;
- v6: F3 nevalidată → fără total; F3 validată → total; fără F3 → varianta veche;
- după validare totalul apare și ciorna rămâne `de_trimis`;
- rollback-ul readuce live.

## 5. Teste rulate

| Comandă | Rezultat |
|---|---|
| `npx vitest run` | 17 fișiere, **401/401** (înainte: 372; +8 H2, +2 poartă, +15 aprobare, +4 CAD) |
| `npm install && npx vite build` | build OK (doar avertismentul obișnuit de mărime a chunk-urilor) |
| `deno test --node-modules-dir=none --no-lock -A supabase/functions/ofertare-plansa-citeste/` | **49/49** (44 existente + 5 noi) |
| `deno test --no-check --node-modules-dir=none --no-lock -A supabase/functions/ofertare-clarificari-propune/core_test.ts` | **4/4**. `--no-check` pentru că `core.ts` are 4 erori TS **preexistente** (identic pe HEAD: TS2571 ×2, TS7006 ×2) |
| contra-probe pe codul de la HEAD | clarificări: testul capăt-la-capăt pică („select-ul … include status”); planșă: 3/5 pică |
| `node --check api/cad-parse.js` + import dinamic | OK |
| PGlite: `test_r5.mjs` (migrare), `test_rev95.mjs` (lic. 95) | 12/12, 8/8 |
| `md5sum deno.lock` înainte / după | `875e293d…` neschimbat |

## 6. Rămâne / de decis (Razvan)

1. **GO pentru migrarea propusă**, înaintea merge-ului ramurii. Altfel H2 = „nu putem verifica” pe licitațiile cu F3.
2. **Push, PR, merge** pentru `claude/cantitati-nevalidate-consumatori`, plus **deploy** pentru `ofertare-clarificari-propune` și `ofertare-plansa-citeste`. Workerul NAS ia `core.ts` la pull.
3. **Validarea cantităților de lic. 95** (Oana Nica / responsabilul), după R5 v2 și #63. Până atunci graficul și fronturile rămân blocate, iar asta e comportamentul dorit. Dn200 1751 (17.785, dintre care 13.765 din afara UAT) nu trebuie validat în forma de azi.
4. **Lic. 3, rândul 9** (CAD, 35.620,59 m, `validat` automat pe 28.08): îl trecem pe `extras` (preview → GO → UPDATE cu RETURNING) sau îl lăsăm validat? Nu e lic. 95, deci n-am scris SQL de aplicare.
5. **SQL-ul pentru lic. 95** (`docs/R5_REVERIFICARE_LIC95_PROPUS.sql`) se rulează doar dacă apar derivate înainte de merge. Azi preview-ul dă 0.
6. **Lic. 5**: 47 de rânduri F3 de rețea de validat, dacă licitația mai e în lucru (termen 18.09 trecut, status `in_lucru`).

## 7. Constatări secundare (nereparate aici)

- **„validat” nu are autor și nici oră.** Tabela n-are `validat_de` / `validat_la`, deci `status='validat'` nu dovedește că a validat un om. Rândurile 2, 3 și 4 (lic. 3) au `updated_at` 15.09 15:19:53.008 / .032 / .053, adică 3 actualizări în 45 ms, ceea ce nu arată a clic uman. O schemă nouă (coloane + UI) e decizia lui Razvan.
- **Transferul din planșă pune cifra planșei în `cantitate` și lasă `tip_sursa` NULL** pe diametrele noi (1751–1756). Orice consumator care citește `cantitate` drept „memoriu/F3” vede o cifră de planșă; exemplu: baza „memoriu / F3” din grafic. Cu regula „doar validat” riscul e închis, dar semantica rămâne ambiguă. De decis împreună cu pasul A din R5 v2 (care propune `cantitate` NULL pentru Nr 1–4).
- **RPC-ul de transfer aplică `status` din patch fără gardă** pe statusul curent. O validare umană făcută între citirea handler-ului și RPC poate fi suprascrisă cu `diferenta`. Propunere: `status = CASE WHEN v_patch ? 'status' AND status = 'extras' THEN … ELSE status END`.
- **`ofertare_clarificare_planse_auto` are două defecte latente:**
  - Suma F3 include și rândurile „TOTAL” care conțin „conductă”; azi sunt 0 pe lic. 5 (62 de rânduri F3 de conductă, 7.747,7 m), dar o listă cu rând de total s-ar dubla.
  - Formatul numărului iese „7.747.7 m” (`lc_numeric` = en_US.UTF-8; `replace(',', '.')`), adică separator de mii și zecimale identic, în textul către autoritate.
- **Fișierul `supabase/migrations/20260926b_…_v5.sql` din repo ≠ funcția live.** Repo are `v_nou := v_noi > 0`, live are `… AND v_standard`. Migrarea propusă pornește de la live.
- **Lic. 3**: `grafic_parametri` are 6 fronturi / 29.985 m, pe baza „planșe” (04.09), iar 3 din 5 rânduri de memoriu sunt nevalidate. Pe codul nou, „Propune din cantități” și generarea cer validarea întâi.
