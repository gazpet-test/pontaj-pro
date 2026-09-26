# R5 — consumatorii lui `ofertare_cantitati`: cantitățile nevalidate folosite ca aprobate

Cerința (Copilot, R5): „Verifică punctual consumatorii: calcul financiar, F3/centralizator, grafic, generator PT și poartă finală. Existența rândului cu status='extras' nu demonstrează singură că a intrat în oferta aprobată. Dacă este consumat ca valoare aprobată, oprește acea utilizare și marchează rezultatele derivate pentru reverificare."

- Ramura: `claude/cantitati-nevalidate-consumatori`, **reașezată (rebase, 26.09) peste `claude/r4-rezervare-zone` @ 8db5587** (reparațiile R4 + deduplicarea pe identitatea rândului), apoi **a doua oară peste `claude/r4-rezervare-zone` @ ab5c449** (R4 runda 6: vecinătatea feliilor pe geometria reală, coliziunea grupurilor sigure pe aceeași poziție; §2.3). Nepushată, fără PR. Nimic deployat.
  - `0686331` (fost 233753a, inițial 990a6b1) = commit-ul R5 inițial, cu conflictul din `treciInCantitati` rezolvat păstrând ambele semantici (§2.2);
  - `67e423c` (fost 48f52d6; conflictul cu R4 runda 6 rezolvat aici, §2.3), `ec6cb3d`, `b36535d` + commit-ul de documentație `a75b62c` = **runda 4** (problemele verificatorului rundei 3, §2.1);
  - commit-ul de după rebase-ul 2: testele interacțiunii R4 × R5 + actualizarea acestui document (§2.3, §5.1).
- BD: doar SELECT (25.09.2026 după transferul planșei 470 din 16:51:08 UTC; recontrolat 26.09.2026). Migrările și SQL-ul pentru lic. 95 și lic. 3 sunt **propuse, neexecutate**.
- Regula folosită peste tot: **aprobat = `status='validat'`** (bifa ✓ din 📋 Cantități). `extras`, `diferenta` și `revizuit_clarificare` (0 rânduri în BD, nescris de niciun cod) sunt date de lucru. Regula stă într-un singur loc: `src/ofertareCantitatiAprobare.js`.
- **Runda 4: regula acoperă și `cantitate_plansa`.** Un scriitor automat (transferul din planșă, citirea CAD) care pune pe un rând o cifră diferită cu ≥ 1 m de cea pe care rândul o avea scoate rândul din `validat` (`diferenta`): validarea se reface pe cifra nouă.

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
   - `ofertare_clarificare_planse_auto` v6, care nu mai citează autorității un total F3 luat din rânduri nevalidate; din runda 4, cu **același set F3 ca H2** (filtrul `qm`) și cu numărul scris ro-RO fără ambiguitate.
   Ordinea e: **întâi migrarea, apoi merge-ul**. Invers, H2 blochează cu „nu putem verifica” pe licitațiile care au F3 (fail-closed, ca la P0c). Azi doar lic. 5 are F3.
5. **Runda 4 (verificatorul rundei 3): „validat” nu mai poate rămâne peste o cifră pe care n-a văzut-o nimeni.** Cazul real e lic. 3: rândurile 2, 3 și 4 au fost validate **înainte** de transferul planșei 1.1 din 15.09, care le-a scris apoi `cantitate_plansa` (Dn180: 1.100 validat, 2.210 din planșă). Codul nou o împiedică pe viitor (§2.1); pentru cele 3 rânduri existente e propus un SQL separat (`docs/R5_LIC3_VALIDARI_INAINTE_DE_TRANSFER_PROPUS.sql`, preview = 3 rânduri). Tot în runda 4: poarta graficului ia totalul declarat ca referință doar dacă e validat, se recalculează întreagă la îngheț și blochează fronturile salvate care nu vin din rânduri validate (lic. 3: 6 fronturi / 29.985 m din 04.09).

## 1. Inventarul consumatorilor

Surse: grep pe `src/`, `api/`, `supabase/functions/`, `worker/`, `supabase/migrations/`, plus catalogul BD (`pg_views`, `pg_matviews`, `pg_proc.prosrc`, `pg_trigger` care conțin `ofertare_cantitati`). Rezultatul din BD: 2 view-uri (`v_ofertare_pt_stare`, `v_ofertare_contradictii`), 2 funcții (`ofertare_clarificare_planse_auto`, `ofertare_transfer_plansa_cantitati`) și 1 trigger (`trg_categorie_cantitate`). Niciun view și nicio funcție nu depind de cele două view-uri. Liniile „HEAD” se referă la 8a6fbbb, iar „acum” la ramură.

| # | Consumator | Fișier:linie | Citește | Filtru status | Tratează `extras` ca aprobat? | Derivate lic. 95 (SELECT 25.09) | Acțiune |
|---|---|---|---|---|---|---|---|
| 1 | **Graficul**: poarta graficului + generatorul (`PoartaGrafic`) | `src/GraficPoarta.jsx` HEAD l.239 (load), l.45–53 `randuriFront`, l.261–276 „Propune din cantități”, l.290–294 rândul „cant”, l.316–330 înghețul; acum (runda 4) l.216 (load), l.236 „Propune”, l.260 poarta (`graficPoartaCalcul.js`), l.263–285 generarea | `cantitate` sau `cantitate_plansa` (după „Baza cantităților”), `status`, `um`, `categorie`, `obiect` | niciunul; doar `diferenta` dădea warn/block | **DA.** „cant” = ok pe rânduri `extras`, iar fronturile se propuneau din orice rând. Lanțul: fronturi → `grafic_parametri` → `motorPEHD` → `grafic_versiuni` (snapshot + poartă) → `grafic_activitati` → capitolele PT. Pe lic. 95: „6 rânduri rețea” ok, 6 fronturi Σ 48.195 m | 0 `grafic_parametri`, 0 `grafic_versiuni`, 0 `grafic_activitati` | **FIX**: „cant” = BLOCK cât timp un rând de rețea e nevalidat; fronturile se propun doar din rânduri validate; cantitățile se recitesc din BD înainte de îngheț. **Runda 4**: „front” ia totalul declarat ca referință doar dacă e validat; poarta se recalculează ÎNTREAGĂ pe cantitățile recitite; fronturile poartă rândul-sursă și sunt BLOCK dacă acesta nu mai e validat cu aceeași cifră (sau dacă sunt salvate înainte de R5) |
| 2 | **Poarta propunerii / poarta finală**: rândul H2 „Cantitățile rețelei” (card în fișă, panou, semnătura `ofertare_pt_poarta`) | view `v_ofertare_pt_stare`, CTE `qm`; `src/ofertareControale.js` HEAD l.30–52 (`controlCantitati`), acum l.37–70; `src/ofertarePoarta.js` l.150; `src/OfertarePropunere.jsx` l.1202 / l.1841; `src/OfertareLicitatii.jsx` l.3353 | Σ `cantitate` pe `tip_sursa` ∈ {lista_f3, lista_c6, memoriu}, Σ `coalesce(cantitate_plansa, cantitate)` pe `plansa`; rețea = `um='m'`, categorie conductă/rețea, fără „total” | **niciunul** | **DA.** F3 e referința „pe ea punem banii”. O F3 transcrisă de AI și nevalidată trecea „ok” dacă era egală cu fronturile | 0 `ofertare_pt_poarta`. `tip_sursa` NULL pe toate 6, deci H2 = block „lipsește F3”, fără cifre. Latent: pasul A din R5 v2 (`tip_sursa='plansa'`) → „există doar planșe 13.765 m” | **FIX JS**: F3 cu rânduri nevalidate = BLOCK; câmp absent = „nu putem verifica” = BLOCK; memoriul, planșele și C6 nevalidate poartă eticheta „(nevalidat)”. **View nou propus** (§4). Notă (runda 4): cardul din fișă (`PropunereRezumat`, `OfertareLicitatii.jsx` l.3353) citește doar `v_ofertare_pt_stare`, fără view-urile suplimentare (nici `v_ofertare_pt_cerinte_neconfirmate`, nici cel nou) — deci H2 acolo e „nu putem verifica” = block; cardul era oricum block din lipsa câmpurilor de documentație (divergență preexistentă card ↔ panou, nereparată aici) |
| 3 | **Clarificarea automată „planșe”** (RPC, apelat din `plansa-citeste` l.599/903 și `api/plansa-felii.js` l.131) | funcția `ofertare_clarificare_planse_auto`, `SELECT round(sum(cantitate),1) INTO v_f3` | Σ `cantitate` pe F3 de conductă (`tip_sursa='lista_f3'`, um m/ml, denumire conductă/țeavă/tub) | **niciunul** | **DA**: cifra intră în textul către AC („lungimea totală de conductă din F3: X m”) | #63 (`auto_planse_1`, `de_trimis`) e text editat de om (v5 nu-l mai rescrie) și nu citează F3; lic. 95 n-are F3. Nicio ciornă `auto_planse` nu citează F3 azi | **v6 propusă** (§4): totalul vine doar din rânduri validate; fără total cât există F3 nevalidată. Runda 4: setul F3 = filtrul `qm` (ca H2), format ro-RO |
| 4 | **Generatorul de clarificări** (edge + worker NAS, același `core.ts`) | `supabase/functions/ofertare-clarificari-propune/core.ts` HEAD l.69 (select), l.95 (payload); acum l.91, l.118, funcția `randCantitatePentruAI` l.60 | rândurile cu `diferenta_nota` (max 40): `cantitate`, `cantitate_plansa`, `tip_sursa`; **fără** `status` | niciunul | **PARȚIAL.** Nu le aprobă, dar pune `cantitate` sub cheia `"lista"`: 1751 ar fi plecat ca `lista: 17785, plansa: 17785`, adică o F3 inexistentă „confirmată” de planșă | 0 apeluri AI pe lic. 95 după 16:51:08, 0 clarificări `platforma` | **FIX**: `status` în select; `sursa_cantitate` și `status_validat` (runda 4: redenumit din `validat_de_om` — „validat” n-are autor) în payload; regula explicată în prompt („marcat validat în platformă”). Cere deploy edge; workerul o preia la pull |
| 5 | **Transferul planșă → cantități** (la recitire) | `supabase/functions/ofertare-plansa-citeste/handler.ts` HEAD l.268–270, l.301–310, l.317; acum (după rebase + runda 4) l.717–742 (reguli), l.789 (select), l.804–904 (potrivire, patch), l.930–952 („doar de verificat”), l.960–975 (TOTAL) | rândurile existente: `cantitate`, `status`; acum și `sursa`, `tip_sursa` | păstra doar rândurile `validat` | **DA, la recitire.** `cantitate` unui rând scris de un transfer anterior devenea „dinMemoriu”. Rezultatul: „Planșa 1 confirmă: 2.275 m” (planșa confirmată de ea însăși) și „Memoriu 13.140 m vs planșa 13.740 m” | 1 transfer (doc 470, `transfer.stare='facut'`, 16:51:08), nicio recitire, deci 0 note false | **FIX**: rândurile din planșă nu mai sunt „memoriu”. Nota spune „recitire … nu confirmare”; o recitire diferită → `diferenta`. **Runda 4**: cifră nouă ≥ 1 m pe un rând `validat` (și pe TOTAL) → `diferenta`; `tip_sursa` bate sursa; „recitire” doar pe aceeași planșă, altfel ambiguu; două grupuri (Dn, material) pe aceeași poziție → ambiguu |
| 6 | **Citirea CAD** (scriitor care se auto-aproba) | `api/cad-parse.js` HEAD l.118–128 (`status: 'validat'` la l.123); acum l.121–125 + `api/_cadCantitate.js` | — | — | **DA, auto-aprobare**: o măsurătoare automată intra `validat` și ar fi trecut prin toate porțile de mai sus | 0 pe lic. 95. Lic. 3, rândul 9 (35.620,59 m): `validat`, cu `created_at = updated_at` = 28.08 20:19:55 | **FIX**: rând nou → `extras`. **Runda 4**: măsurătoare nouă ≥ 1 m față de `cantitate_plansa` (sau `cantitate`) → `diferenta`, și pe rândul validat (înainte primea tăcut cifra nouă în `cantitate_plansa`). Rândul 9 = decizie (§6) |
| 7 | 📋 Cantități (editorul) | `src/OfertareCantitati.jsx` l.50 / 63 / 72 / 76 / 82 | tot | — (arată statusul) | NU (afișează, nu calculează) | — | Contor „N nevalidate” + tooltip pe ✓ |
| 8 | `v_ofertare_contradictii` | view (pg_get_viewdef) | toate rândurile | niciunul | NU. E un detector de diferențe; valorile se compară, nu se aprobă. Niciun cod nu-l citește (grep) | 0 rânduri pentru 95 | nimic |
| 9 | Extragerea cantităților (scriitor) | `supabase/functions/ofertare-cantitati-extrage/handler.ts` l.266 (citește `obiect`), l.375 (insert `extras`) | `obiect` | — | NU | — | nimic |
| 10 | RPC `ofertare_transfer_plansa_cantitati` (scriitor) | `supabase/migrations/20260927_…atomic.sql` l.34–44 | — | aplică `status` din patch **fără gardă pe statusul curent** | NU, dar are o fereastră de cursă cu o validare umană făcută între citirea handler-ului și RPC | — | **Runda 4, închis în cod, fără schimbarea RPC-ului**: patch-ul poartă `status='diferenta'` ori de câte ori cifra din planșă se schimbă, deci o validare dată în fereastră pe cifra veche e scoasă (§2.1). RPC-ul NU trebuie să primească garda propusă în runda 3 (§7) |
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
| `src/graficPoartaCalcul.js` (nou, runda 4) + `src/GraficPoarta.jsx` | Checklist-ul porții = funcție pură `calculeazaPoartaGrafic`, mutată din componentă; la generare se recalculează ÎNTREAGĂ pe cantitățile recitite și asta se îngheață. Rândul „front” vine din `controlFronturiGrafic` (§2.1). ＋ creează front `manual`; butonul „✋ Le asum ca manuale” (cu confirmare) marchează explicit fronturile vechi fără legătură | `graficPoartaCalcul.test.js` 4 teste; `ofertareCantitatiAprobare.test.js` +10 (25) |
| `supabase/functions/ofertare-clarificari-propune/core.ts` | `status` în select; `randCantitatePentruAI`: `cantitate` + `sursa_cantitate` (tip_sursa sau „planșă (citire automată…)”) + `status_validat` (runda 4; era `validat_de_om`); cheia `lista` dispare; regula e în prompt: `status_validat: true` = „marcat validat în platformă”, fără autor/dată, nu cifră de citat autorității. Runda 4: adnotări de tip pentru cele 4 erori TS preexistente (fără schimbare de comportament) — `deno check` / `deno test` trec acum fără `--no-check` | `core_test.ts`: 4 teste (unul capăt-la-capăt cu fetch simulat și `dry_run`). Contra-probă pe core.ts de la HEAD: testul capăt-la-capăt **pică** |
| `supabase/functions/ofertare-plansa-citeste/handler.ts` | `randDinPlansa` (runda 4: `tip_sursa` declarat decide; doar fără tip contează sursa „… citit automat din scanare”). Un astfel de rând nu mai e „dinMemoriu”. Recitirea identică dă nota „valoare din planșă, nu confirmare din memoriu”. Recitirea diferită dă „rândul are X m din citirea anterioară … verifică” și status `diferenta`. **Runda 4**: `cifraSchimbata` — și rândul `validat` (și TOTAL) trece pe `diferenta` când cifra din planșă se schimbă cu ≥ 1 m; „recitire” doar pe aceeași planșă (`dinAceeasiPlansa`), altfel ambiguu și neatins; ordine deterministă a grupurilor. Coliziunea a două grupuri (Dn, material) pe aceeași poziție urmează, după rebase-ul 2, regula R4 runda 6 (§2.3): o notă pe poziție, `cantitate_plansa` neatinsă. `treciInCantitati` e exportat pentru test. | `cantitati_nevalidate_test.ts`: 16 teste (5 + 11 în runda 4) + 3 după rebase-ul 2 (§2.3). Contra-probă pe HEAD 8a6fbbb (runda 3): **2/5 pică comportamental**, al treilea doar pentru că exportul lipsea (corectat; „3/5” din runda 3 era greșit). Contra-probă runda 4 pe 233753a: 8/8 teste noi de comportament pică. Suita planșei: 116/116 |
| `api/_cadCantitate.js` (nou) + `api/cad-parse.js` | Rândul CAD nou intră `extras`. **Runda 4**: măsurătoarea nouă diferită cu ≥ 1 m de `cantitate_plansa` (sau de `cantitate`) → `diferenta`, și pe rândul validat (a cărui `cantitate` a omului rămâne neatinsă); aceeași cifră (< 1 m) nu atinge statusul. `cad-parse.js` citește și `cantitate_plansa`. | `api/_cadCantitate.test.js`: 6 teste (4 noi în runda 4 pe rândul 9 real al lic. 3), fără nicio ramură care să scrie `validat`. Contra-probă pe 233753a: 4/4 noi pică (fișierul cu „_” nu devine funcție Vercel) |

### 2.1 Runda 4 — problemele verificatorului rundei 3

**MAJOR: `cantitate_plansa` rescrisă după validare.** Regula „aprobat = `validat`” acoperea rândul, dar nu și coloana pe care graficul o folosește cu baza „planșe”. `treciInCantitati` (patch fără status pe rândul `validat`) și `api/_cadCantitate.js` (ramura „validat”) scriau o cifră nouă, automată, peste o validare dată pe altă cifră. Am aplicat **varianta (a)**, în ambii scriitori, cu aceeași regulă (`cifraSchimbata`, `handler.ts` l.734 și `_cadCantitate.js` l.21):

- **referința** = cifra pe care rândul o avea deja: `cantitate_plansa`; dacă n-are, `cantitate`; dacă n-are niciuna, orice cifră nouă contează;
- cifra nouă diferă cu **≥ 1 m** de referință ⇒ `status='diferenta'`, iar nota începe cu „Rândul era VALIDAT cu … ; planșa X dă acum Y m — validarea se reface.”; `cantitate` (cifra omului) nu se atinge;
- aceeași cifră recitită (< 1 m) nu atinge statusul: o validare dată **după** transferul anterior rămâne. De aceea referința e `cantitate_plansa` existentă și **nu** și `cantitate`: altfel un rând validat cu memoriu ≠ planșă (omul a văzut ambele cifre și a ales baza) ar fi redeschis la fiecare recitire a aceleiași planșe;
- regula se aplică și rândului TOTAL (e referința „front” când e validat);
- **cursa citire → RPC**: statusul pleacă în patch **oricare** ar fi statusul citit. RPC-ul `ofertare_transfer_plansa_cantitati` (neschimbat) aplică statusul din patch fără gardă, deci o validare dată între citirea handler-ului și RPC, pe cifra veche, e scoasă. La CAD (UPDATE direct, tot fără gardă) la fel. Ce rămâne în fereastră e doar cazul „aceeași cifră”, inofensiv.

Cazul real, lic. 3 (SELECT 26.09.2026; în toată BD există doar 4 rânduri `validat`, toate la lic. 3): rândurile 2 (Dn180: validat 1.100, planșa 1.1 = 2.210, +1.110 m), 3 (Dn160: 5.250 / 5.245, −5 m) și 4 (TOTAL: 37.320 / 41.920, +4.600 m) au `updated_at` 15.09 15:19:53.008 / .032 / .053 — **batch-ul transferului planșei 1.1** (rândul 1, `diferenta`, e în același batch la 15:19:52.967, toate cu nota „Memoriu X vs planșa 1.1 Y”). Cum ✓ (`valideazaC`) scrie și el `updated_at`, ultima scriere a fost transferul: **validarea s-a dat înainte, pe cifra din memoriu**. Pe codul nou, transferul acela ar fi pus 2, 3 și 4 pe `diferenta` (test „runda 4 (MAJOR) lic. 3 real”). Pe datele de azi, o recitire cu aceleași cifre NU le redeschide (referința e 2.210 etc. — testul-pereche o arată), deci pentru ele e propus separat `docs/R5_LIC3_VALIDARI_INAINTE_DE_TRANSFER_PROPUS.sql`: preview (rulat ca SELECT pe 26.09 → exact 2, 3, 4), aplicare cu gardă pe `updated_at` (un rând revalidat de om după 15.09 iese din filtru), rollback exact (status, notă, `updated_at`); PGlite 7/7. Rândul 9 (CAD) rămâne decizia separată din §6.

**Minore:**
- `randDinPlansa` = `r?.tip_sursa ? r.tip_sursa === 'plansa' : /citit automat din scanare/i.test(r?.sursa)` (ADV4: un rând reclasificat F3 nu mai e „citire anterioară”; nota spune „F3 2.300 m vs planșa 1 2.275 m”, nu „Memoriu …”).
- „Recitire” doar când sursa rândului începe cu eticheta **aceleiași** planșe (`dinAceeasiPlansa`: „Planșa 1 — …” sau „Planșa „PL1.pdf” — …”; „Planșa 1” ≠ „Planșa 12”). Rândul altei planșe (ADV3) nu se suprascrie și nici nu se golește pe ramura „doar de verificat”: apare în `ambigue` cu motivul. **Limită**: sursa nu poartă id-ul documentului, deci două documente diferite cu același nr. de planșă nu se pot deosebi. **Vizibilitate**: `ambigue` apare doar în răspunsul transferului / `analiza.citire_ai.sumar.cantitati` (preexistent, UI-ul nu le afișează).
- Două grupuri (Dn, material) care ajung la aceeași poziție (Dn63 PE + Dn63 OL, o singură poziție „Dn63”): defect preexistent (ADV5, reprodus și pe 8a6fbbb). În runda 4 R5 le trata ca ambigue, **fără niciun update**; **după rebase-ul 2 rămâne regula R4 runda 6** (§2.3): o singură notă pe poziție, cu toate grupurile, `cantitate_plansa` neatinsă. Din R5 rămâne ordinea deterministă (Dn desc, apoi material); testul cu ordinea inversată e păstrat.
- **GraficPoarta** (`controlFronturiGrafic`, `ofertareCantitatiAprobare.js` l.100; `calculeazaPoartaGrafic`, `graficPoartaCalcul.js`):
  - referința „front” = totalul declarat **doar dacă e validat**; altfel suma rândurilor de rețea validate (ADV6: un total `extras` de 50.000 m nu mai e referință);
  - la generare, **toată poarta** se recalculează pe cantitățile recitite și asta se îngheață (înainte: doar „cant” era actualizat, „front” rămânea pe starea veche);
  - „Propune din cantități” salvează pe fiecare front `cantitate_id`, `baza` și `lungime_sursa` (`grafic_parametri.parametri` e jsonb — **schema permite, fără migrare**; `motorPEHD` și `v_ofertare_pt_stare.gp` citesc doar `lungime_m`). Poarta e **BLOCK** pe fronturile fără legătură (salvate înainte de 26.09), cu rândul-sursă nevalidat / șters, propuse pe altă bază sau cu cifra rândului schimbată de la propunere — până la re-propunere. Un front adăugat cu ＋ e `manual` (decizia omului, numărat în detalii). Lic. 3 (singura cu `grafic_parametri`, SELECT 26.09): 6 fronturi / 29.985 m din 04.09, baza „planșe”, fără legătură ⇒ acum block. Fronturile par scrise de om (localități, cifre = memoriul: 6.200 + 8.015 + 6.255 + 3.165 = 23.635 ≈ 23.630 Dn250; 1.100; 5.250), de aceea există butonul „✋ Le asum ca manuale” (confirmare explicită) — alternativ, re-propunere din cantități după validare.
- `core.ts`: `status_validat` în loc de `validat_de_om`; promptul: „marcat validat în platformă”, marcajul n-are autor/dată.
- Documentație: antetul SQL (PGlite 18.3, nu Postgres 16); preview-ul `ai_usage_log` extins la documentele licitației (§3.1); contra-proba „3/5” corectată (§2); instabilitatea `concurenta_test` notată (§5); cardul din fișă (§1, rândul 2).

### 2.2 Rebase-ul peste `claude/r4-rezervare-zone`

Conflictul a fost doar în `treciInCantitati` (`handler.ts`), modificat de ambele ramuri. Rezolvare, păstrând ambele semantici:
- semnătura R4 (`rest?: RestTransfer` — rândurile „de verificat” pe (Dn, material)) + exportul R5;
- select-ul citește `cantitate_plansa` (R4, pentru nota „cifra veche”) **și** `sursa`, `tip_sursa` (R5);
- `diferenta` pe `extras` când recitirea diferă de cifra din rând (R5) **sau** când pe (Dn, material) există rânduri de verificat (R4).
Testul R4 „identitate 470: retransfer peste 1751–1756” aștepta „Planșa 1 confirmă” pe 1751–1755 — exact defectul R5 (planșa confirmată de ea însăși); acum așteaptă nota „(recitire) … nu confirmare din memoriu”. Cifrele și statusurile sunt aceleași (doar 1756 → `diferenta`, 13.740). După rebase, înainte de runda 4: vitest 401/401, deno `supabase/functions/` 126/126 (cu `--no-check` din cauza celor 4 erori TS preexistente din `core.ts`), `test-cas-felii` 34/34, build OK.

### 2.3 Rebase-ul 2 peste `claude/r4-rezervare-zone` @ ab5c449 (R4 runda 6)

Conflictul a fost tot în `treciInCantitati` (`handler.ts`), la commit-ul rundei 4 (fost 48f52d6). R4 runda 6 (f1c4b66) repară **același defect** ca ADV5 din R5 (două grupuri sigure pe o singură poziție ⇒ două update-uri pe același id, ultimul câștigă), dar cu altă semantică pe poziție. Rezolvare:
- **coliziunea = regula R4**: o singură scriere pe id, doar `diferenta_nota` (toate grupurile cu metrii și rândurile lor, suma, „nu se adună și nu se suprascriu automat”, cifra veche numită veche) + `extras` ⇒ `diferenta`; `cantitate_plansa` **neatinsă**; o intrare în `ambigue` cu `grupuri`. Varianta R5 („ambele ambigue, nimic pe poziție”) lăsa urma doar în JSON-ul transferului, pe care UI-ul nu-l arată (§7), deci poziția își păstra tăcut nota și statusul citirii anterioare;
- **din R5 rămân**: ordinea deterministă a grupurilor (Dn desc, apoi material) — acum și lista de operații trimisă RPC-ului e identică în orice ordine a tronsoanelor, nu doar starea finală; `candidatiDn` (același filtru pe material în ambele ramuri); `randDinPlansa` / „recitire” doar pe aceeași planșă; `cifraSchimbata` (validarea se reface doar când cifra din planșă se schimbă — la coliziune cifra nu se schimbă, deci „validat rămâne validat”, ca în R4);
- **interacțiunea nouă**: poziția cu cifra **altei planșe** nu primește nici nota coliziunii (regula R5: planșa de acum nu scrie pe rândul altei planșe); apare o intrare în `ambigue` cu `grupuri` și ambele motive. Mulțimea `neatinse` din R5 a dispărut: după regula R4 ea ar fi conținut doar pozițiile altei planșe, pe care le prinde direct `cifraAlteiPlanse`. Restul „doar de verificat” care cade pe poziția unei coliziuni din aceeași planșă se adaugă la nota coliziunii (comportamentul R4), nu mai e „neatins”.

**Testul ADV5 a fost adaptat** (singurul test modificat): aserțiunea „1755 nu primește nimic” contrazicea direct testul R4 „runda 6 MAJOR transfer: Dn110 PE 500 + Dn110 OL 90 … => ambiguu” pe același scenariu, deci nu se putea repara din cod fără să pice unul din ele. Intenția ADV5 e păstrată: nicio cifră scrisă sau adunată, ambele grupuri numite, aceleași operații și același raport în orice ordine. Teste noi (în `cantitati_nevalidate_test.ts`, secțiunea „Rebase R5 peste R4 runda 6”): coliziune pe poziția altei planșe (0 operații, o intrare cu `grupuri`); rest „doar de verificat” pe poziția unei coliziuni (notă adăugată, `actiune: 'nota'`); coliziune pe rând validat (fără status în patch). Contra-probe (copii în scratchpad): fără poarta „altă planșă” în ramura coliziunii (doar R4) pică primul; cu coliziunea „neatinsă” pentru rest (doar R5) pică al doilea.

## 3. Lic. 95: derivatele și marcarea lor

### 3.1 Starea din BD (SELECT, 25.09.2026, după transferul din 16:51:08 UTC; preview-ul recontrolat pe 26.09.2026 — identic)

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
| `ai_usage_log` după transfer — pe licitație (`ofertare_licitatii`, 95) / pe documentele ei (`ofertare_documente_atribuire`, doc-urile lic. 95) | 0 / 1 | pe licitație: ultimul apel 14:14:52. Pe documente: **#4632** (`ofertare-plansa-citeste`, doc 470, 16:52:38) = pasul „note lipite” al **aceleiași** citiri, nu un derivat al rândurilor. În runda 3, „0 apeluri AI după transfer” era adevărat doar pentru filtrul `ref_table='ofertare_licitatii'`; preview-ul acoperă acum ambele |
| `v_ofertare_pt_stare` (95) | — | `lista_f3_m`, `lista_c6_m`, `memoriu_m`, `plansa_m`, `grafic_fronturi_m` = NULL |
| `v_ofertare_contradictii` (95) | 0 | — |

### 3.2 SQL propus (NEEXECUTAT): `docs/R5_REVERIFICARE_LIC95_PROPUS.sql`

- **(0) Preview**: un singur SELECT pe cele 10 surse. Rulat pe producție pe 25.09 și 26.09 (e doar SELECT): **0 în cele 9 surse de derivate; `ai_usage_log` = 1 (#4632, vezi mai sus)**. Runda 4: linia `ai_usage_log` numără și `ref_table='ofertare_documente_atribuire'` pe documentele lic. 95.
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

Testat local pe PGlite (Postgres 18.3 în proces, de unică folosință): runda 3 8/8; runda 4 (`test_rev95_runda4.mjs`, cu `ofertare_documente_atribuire` și #4632 în schemă) **9/9** — în plus: preview-ul numără exact #4632, nu un apel pe documentul altei licitații și nici unul de dinainte de transfer:
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
   - **runda 4**: setul F3 = **exact filtrul `qm` / `lista_f3_m`** din `v_ofertare_pt_stare` (`um='m'`, categorie conductă/rețea, fără „total” în obiect/denumire/sursa) — același set ca view-ul nou și H2. Filtrul vechi (um m/ml/M, denumire conduct/țeav/tub) lua și articole de deviz și rândurile TOTAL: la lic. 5 (SELECT 26.09) 62 de rânduri / 7.747,68 m față de 47 / 6.519,79 m pe `qm` (diferența = 15 rânduri cu um „M”, 1.227,89 m, ex. „MONTAREA PARAPETELOR SI PODETELOR…”; 0 rânduri TOTAL azi);
   - **runda 4**: numărul se scrie ro-RO fără ambiguitate, independent de `lc_numeric` („,” și „.” din șablonul `to_char` sunt fixe, apoi `translate`): 6.519,8 / 6.520 / 1.234.567,8. Live scria „7.747.7” (mii și zecimale cu același punct).
   Azi n-ar schimba nicio ciornă: singura `auto_planse` e #63, text de om.
3. **Rollback**: DROP VIEW și funcția live exactă (md5 identic, verificat local). Se face **împreună cu revert-ul codului**.

Testat pe PGlite (Postgres 18.3 compilat WASM, **nu** Postgres 16 cum scria antetul în runda 3 — corectat):
- runda 3 (`test_r5.mjs`), 12/12 atunci: rollback = live (md5); live citează „1.600.0 m” din rânduri nevalidate (bug reprodus); view-ul (lic. 95 = 6 fără tip, lic. 5 = 1 F3 nevalidat, 500 m, TOTAL exclus); `security_invoker` și grant-urile; v6: F3 nevalidată → fără total, validată → total, fără F3 → varianta veche; rollback. Pe v6 din runda 4, două verificări ale lui pică **intenționat** („2.000.5 m” și „1.600.0 m” după validare — exact defectele raportate);
- runda 4 (`test_r5_runda4.mjs`), **11/11**: live pe o F3 validată cu TOTAL validat și un articol de deviz „M” citează „2.250.0 m” (dublare + deviz + format); v6 citează „1.000 m”; lic. 7 „2.000,5 m”; „1.234.567,8 m”; lic. 5 după validare „800 m” (TOTAL exclus; runda 3 dădea „1.600.0”) și ciorna rămâne `de_trimis`; `f3_nevalidate` (v6) = `lista_f3_nevalidate` (view) pe toate licitațiile de test; `lc_numeric=C` nu schimbă formatul; rollback = live (md5), view șters.

## 5. Teste rulate

Runda 4 (26.09.2026, după rebase peste `claude/r4-rezervare-zone` și commit-urile rundei 4):

| Comandă | Rezultat |
|---|---|
| `npx vitest run` | 18 fișiere, **417/417** (runda 3: 401; +2 CAD, +10 aprobare/fronturi, +4 `graficPoartaCalcul`) |
| `npm install && npx vite build` | build OK (doar avertismentul obișnuit de mărime a chunk-urilor) |
| `deno test --node-modules-dir=none --no-lock -A supabase/functions/` | **137/137**, **cu** type-check (runda 3 avea nevoie de `--no-check` pentru `core.ts`; cele 4 erori TS preexistente au primit adnotări de tip) |
| — din care `ofertare-plansa-citeste/` | **116/116** (R4 105 + R5 11 noi în runda 4); rulat de 10 ori: 10/10 verde |
| — din care `ofertare-clarificari-propune/core_test.ts` | **4/4** |
| `node scripts/test-cas-felii.mjs` | **34/34** |
| `deno check` pe `ofertare-plansa-citeste/index.ts`, `ofertare-clarificari-propune/index.ts`, `worker/ofertare/clarificari.ts` | curat (0 erori; runda 3: cele 4 preexistente) |
| contra-probe runda 4 (testele noi pe codul de dinainte, 233753a, copii temporare în scratchpad) | planșă: **8/8** teste noi de comportament pică (validat + cifră nouă, lic. 3 real, ADV1, cursa → RPC, ADV4, ADV3 ×2, ADV5); controalele negative (aceeași cifră ⇒ validarea rămâne; lic. 3 azi fără recitire diferită) trec pe ambele. CAD: **4/4** noi pică, 2 vechi trec |
| testele adversariale ale verificatorului (`scratchpad/adv3/r5cons/adv_test.ts`, scrise să treacă pe defect) | ADV1–ADV4 **pică acum** (defectul nu se mai reproduce); ADV5 (ordinea) **trece**; ADV6 testează `controlCantitatiGrafic.totalRetea`, nu referința „front” — acoperit în vitest (`controlFronturiGrafic`) |
| contra-proba din runda 3, corectată | pe HEAD 8a6fbbb **2/5** teste ale planșei pică comportamental („Planșa 1 confirmă” fals); al treilea pica doar pentru că exportul `treciInCantitati` lipsea — „3/5” din runda 3 era greșit |
| PGlite: `test_r5_runda4.mjs` (v6), `test_rev95_runda4.mjs` (lic. 95), `test_lic3_r4.mjs` (lic. 3) | **11/11, 9/9, 7/7** |
| `md5sum deno.lock` înainte / după | `875e293d073b359f7433064914937c86` neschimbat |

**Instabilitate preexistentă**: `concurenta_test.ts` „R4: două rulări concurente pe zone diferite” (temporizări de 5 și 30 ms) a picat o dată din 7 rulări la verificatorul rundei 3. Testul vine din #475 (af02588, pe `main`), fișierul nu e atins de R5 decât în testul „identitate 470” (§2.2); aici 10/10 rulări verzi. De tratat separat (temporizările → promisiuni explicite), nu în R5.

Runda 3 (25.09.2026, pe 990a6b1, înainte de rebase): vitest 401/401; build OK; planșă 49/49 (majoritar — vezi instabilitatea); `core_test.ts` 4/4 cu `--no-check`; PGlite `test_r5.mjs` 12/12, `test_rev95.mjs` 8/8.

### 5.1 După rebase-ul 2 (peste R4 runda 6, ab5c449)

| Comandă | Rezultat |
|---|---|
| `deno test --node-modules-dir=none --no-lock -A supabase/functions/` | **149/149**, cu type-check |
| — din care `ofertare-plansa-citeste/` | **128/128** (R4 runda 6 + R5 runda 4 + 3 teste noi ale interacțiunii) |
| `concurenta_test.ts`, de 10 ori | 10/10 verde (59/59 la fiecare rulare) |
| `npx vitest run` | 18 fișiere, **417/417** |
| `npm install && npx vite build` | build OK |
| `node scripts/test-cas-felii.mjs` | **34/34** |
| `deno check` pe `ofertare-plansa-citeste/index.ts`, `ofertare-clarificari-propune/index.ts`, `worker/ofertare/clarificari.ts` | curat |
| `md5sum deno.lock` înainte / după | `875e293d073b359f7433064914937c86` neschimbat |

## 6. Rămâne / de decis (Razvan)

1. **GO pentru migrarea propusă** (view + v6 din runda 4), înaintea merge-ului ramurii. Altfel H2 = „nu putem verifica” pe licitațiile cu F3.
2. **Push, PR, merge** pentru `claude/cantitati-nevalidate-consumatori` (conține acum și `claude/r4-rezervare-zone` — se merge-uiește după / împreună cu ea), plus **deploy** pentru `ofertare-clarificari-propune` și `ofertare-plansa-citeste`. Workerul NAS ia `core.ts` la pull. `api/cad-parse.js` pleacă la Vercel cu merge-ul.
3. **Lic. 3, rândurile 2, 3, 4** (validate înainte de transferul planșei 1.1): GO pentru `docs/R5_LIC3_VALIDARI_INAINTE_DE_TRANSFER_PROPUS.sql` (preview 3 rânduri → `diferenta` + notă, rollback exact) sau le revalidează direct un om, văzând ambele cifre (Dn180: 1.100 vs 2.210).
4. **Lic. 3, rândul 9** (CAD, 35.620,59 m, `validat` automat pe 28.08): îl trecem pe `extras` (preview → GO → UPDATE cu RETURNING) sau îl lăsăm validat? N-am scris SQL de aplicare.
5. **Schimbări de comportament de confirmat** (runda 4): (a) o recitire a planșei / o re-măsurare CAD cu altă cifră redeschide un rând validat; (b) fronturile salvate înainte de 26.09 blochează poarta graficului până la re-propunere sau „✋ Le asum ca manuale” (lic. 3 — dacă butonul e prea permisiv, se scoate și rămâne doar re-propunerea); (c) referința „front” nu mai folosește un total nevalidat.
6. **Validarea cantităților de lic. 95** (Oana Nica / responsabilul), după R5 v2 și #63. Până atunci graficul și fronturile rămân blocate, iar asta e comportamentul dorit. Dn200 1751 (17.785, dintre care 13.765 din afara UAT) nu trebuie validat în forma de azi.
7. **SQL-ul pentru lic. 95** (`docs/R5_REVERIFICARE_LIC95_PROPUS.sql`) se rulează doar dacă apar derivate înainte de merge. Azi preview-ul dă 0 derivate (plus #4632, care nu e derivat).
8. **Lic. 5**: 47 de rânduri F3 de rețea de validat, dacă licitația mai e în lucru (termen 18.09 trecut, status `in_lucru`).

## 7. Constatări secundare (nereparate aici)

- **„validat” nu are autor și nici oră.** Tabela n-are `validat_de` / `validat_la`, deci `status='validat'` nu dovedește că a validat un om (rândul 9 al lic. 3 a fost marcat automat de CAD). **Corectat în runda 4**: în runda 3 scria aici că `updated_at`-urile rândurilor 2, 3, 4 ale lic. 3 (15.09 15:19:53.008 / .032 / .053, „3 actualizări în 45 ms”) ar fi validări automate. Nu sunt: sunt **scrierile transferului planșei 1.1** (rândul 1 e în același batch, la 15:19:52.967, toate cu nota „Memoriu X vs planșa 1.1 Y”). Validările au fost **anterioare** transferului, iar transferul a scris apoi cifre noi peste rânduri validate — exact problema MAJORĂ din §2.1. Concluzia „validat n-are autor” rămâne; o schemă nouă (coloane + UI) e decizia lui Razvan.
- **Transferul din planșă pune cifra planșei în `cantitate` și lasă `tip_sursa` NULL** pe diametrele noi (1751–1756). Orice consumator care citește `cantitate` drept „memoriu/F3” vede o cifră de planșă; exemplu: baza „memoriu / F3” din grafic. Cu regula „doar validat” riscul e închis, dar semantica rămâne ambiguă. De decis împreună cu pasul A din R5 v2 (care propune `cantitate` NULL pentru Nr 1–4).
- **RPC-ul de transfer aplică `status` din patch fără gardă** pe statusul curent. **Runda 4**: fereastra de cursă e închisă în codul care construiește patch-ul (patch-ul poartă `diferenta` când cifra se schimbă, §2.1). Garda propusă în runda 3 (`… AND status = 'extras'`) ar fi **greșită** acum: ar lăsa o validare dată în fereastră peste o cifră nouă. RPC-ul rămâne neschimbat.
- **`ofertare_clarificare_planse_auto` (live) are două defecte**, rezolvate în v6 propusă (runda 4, §4) și încă prezente live până la migrare:
  - setul F3 ia și articole de deviz (lic. 5: +15 rânduri „M”, 1.227,89 m) și ar dubla un rând TOTAL; live 62 rânduri / 7.747,68 m față de 47 / 6.519,79 m pe `qm`;
  - formatul numărului iese „7.747.7 m” (`lc_numeric` = en_US.UTF-8; `replace(',', '.')`).
- **Fișierul `supabase/migrations/20260926b_…_v5.sql` din repo ≠ funcția live.** Repo are `v_nou := v_noi > 0`, live are `… AND v_standard`. Migrarea propusă pornește de la live.
- **Transferul: sursa rândului nu poartă id-ul documentului** — două planșe din documente diferite cu același nr. („Planșa 1”) se tratează ca aceeași planșă la recitire. Iar pozițiile ambigue din „altă planșă” apar doar în rezumatul JSON al transferului, nu în UI (preexistent). Coliziunea grupurilor sigure pe aceeași poziție se vede acum și pe poziție (nota R4 runda 6), cu excepția poziției altei planșe, care rămâne neatinsă.
- **Lic. 3**: `grafic_parametri` are 6 fronturi / 29.985 m, pe baza „planșe” (04.09), iar 3 din 5 rânduri de memoriu sunt nevalidate. Pe codul nou, „Propune din cantități” și generarea cer validarea întâi, iar fronturile vechi blochează poarta până la re-propunere / asumare ca manuale.
