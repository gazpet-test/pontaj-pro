# Jilava (lic. 93): de ce sunt 0 cantități în platformă

Diagnostic din 25.09.2026, runda 2 (după verificarea independentă din runda 1). În BD s-a rulat doar SELECT, plus s-au citit loguri Edge și cod. Nu s-a rulat nimic plătit, nu s-a scris nimic în BD, nu s-a făcut deploy și nu s-a făcut push.

## 1. Concluzie
**Extragerea cantităților nu a pornit niciodată pentru licitația 93.** Nu e o problemă de filtru și nici de document: nu există niciun declanșator automat, iar din butonul 🤖 nu a pornit nicio rulare. La 25.09.2026, ~22:00 UTC (runda 2), starea e aceeași: `ofertare_cantitati` are 0 rânduri pe lic. 93, iar `ai_usage_log` are 0 apeluri `ofertare-cantitati-extrage` cu `ref_id=93` (SELECT count).

Singurul POST din browser către funcție în ultimele 24 h (25.09, 15:53:55 UTC) a primit **403** de la poarta pe cheltuială, de pe contul „Claude” (10c105d3…). **Apelul nu a venit din buton.** Corpul lui avea 40 B (`function_edge_logs`, `content_length=40`). Butonul trimite `{"licitatie_id":93,"de_la":0}`, adică 29 B, și cel mult ~31 B pentru orice licitație. Din log nu se poate afla nici licitația apelului.

**Bugul de afișare există și se vede din cod** (§3), dar nu e dovedit că l-a văzut cineva pe Jilava.

## 2. Dovezi
| Fapt | Sursă |
|---|---|
| `ofertare_cantitati`: 0 rânduri pe lic. 93. Tabelul are rânduri doar pe alte licitații: `lista_f3` 756, `lista_c6` 77 și `lista_alt` 29, toate pe lic. 5 (Domnești) | `SELECT tip_sursa, licitatie_id, count(*) … GROUP BY` |
| Doc 434 (`…LST-002-00-R Cantitati de lucrari.pdf`): tip `lista_cantitati`, 83 de pagini, `text_extras` = 141.697 de caractere, OCR, cu marcaje `⟦PAGINA n⟧` | `ofertare_documente_atribuire` id=434 |
| **26 de liste F3.** Le-am numărat după antetul „Lista cu cantitati de lucrari pe categorii de lucrari” (26 de apariții). Tot 26 apar „TOTAL 1 (Cheltuieli directe)” și „Stadiul fizic:”. Șirul „Formular F3” apare de 89 de ori, pentru că e și antet, și subsol de pagină: nu e numărul de liste | `regexp_matches` pe `text_extras` id=434 |
| **Doc 434 are și anexele C6–C9:** C6 „Lista cuprinzand consumurile de resurse materiale” (pag. 76–80), C7 manoperă (pag. 81), C8 utilaje (pag. 82), C9 transport (pag. 83). Între pag. 1 și 75 nu apare niciun antet C6–C9. După pag. 76 nu mai apare niciun antet F3 | SELECT pe pagini (`⟦PAGINA n⟧`), secțiunile [0, 121.853) / [121.853, 137.048) / [137.048, 141.697) |
| Pag. 1–9, 18–19, 28–29, 44–45, 60–61 și 68–69 sunt DEVIZ GENERAL / CENTRALIZATORUL: valori în lei, fără cantități. Pe pag. 10–75 sunt 88 de rânduri „N \| 4.1.1 \| …” | SELECT pe pagini |
| În `ai_usage_log` nu e niciun apel `ofertare-cantitati-extrage` cu ref_id=93. Singurele sunt 32 de apeluri pe lic. 5 (11.09, 1,28 $) | `ai_usage_log` (runda 1, confirmat de verificator) |
| Logurile Edge nu au niciun apel al funcției între 17.09 și 24.09. Pe 25.09 sunt 7 POST-uri curl de test (cheie anon sau JWT fals), care au primit 401, și un POST din browser cu 403 (§1) | `query_logs` (runda 1, confirmat de verificator) |
| Singurul care apelează funcția e butonul din `src/OfertareCantitati.jsx`. Worker-ul NAS și `ofertare-ingest-doc` nu pornesc extragerea | `grep cantitati-extrage` |
| F3-ul din 24.09 s-a făcut în afara platformei: clarificările 10–18 (id 54–62) au `origine='manual'`, `cantitate_id` NULL, `status='de_trimis'` | `ofertare_clarificari` (runda 1) |

### Reperul de verificare pentru doc 434 (nu ~307 de rânduri)
Am numărat linii din `text_extras`, după ce am normalizat spațiile (SELECT cu `regexp_split_to_table` pe pagini):

| Secțiune (pagini) | Ce am numărat | Câte |
|---|---|---|
| F3 (10–75), poziții principale | linii „nr întreg · COD - denumire” (regex R1) | **190** (189 distincte pe pagină) |
| F3 (10–75), sub-rânduri de material | linii „x.y · cod - denumire” (regex R2) | **105** |
| C6 (76–80) | resurse cu număr distinct | **105** (nr. 1–105; pagina 76 apare de două ori în text: 44 de linii, 22 de numere distincte) |
| C7 (81) / C8 (82) / C9 (83) | rânduri numerotate | **25 / 15 / 0** (C9 are doar „TOTAL Transport”) |

```
R1: ^\|?\s*[1-9][0-9]*\s*\|\s*\S+\s+-\s
R2: ^\|?\s*[0-9]+\.[0-9]+\s*\|\s*\S+\s+-\s
```

Verificatorul din runda 1 a numărat, cu alt regex, ~214 poziții F3, ~94 de sub-rânduri și ~90 de rânduri C6–C9. **Reperul pentru F3 este deci ~190–214 poziții principale, plus ~94–105 sub-rânduri de material.** C6–C9 (~145 de rânduri distincte după numărătoarea de mai sus) se numără **separat**, nu în F3. Cifra de ~307 din runda 1 amesteca F3 cu C6–C9 și nu mai e reper.

## 3. Ce e reparat pe ramura `claude/jilava-cantitati-extragere-erori` (locală, nepushată)
**A. Butonul 🤖 din 📋 Cantități** (`src/OfertareCantitati.jsx`, bucla mutată în `src/ofertareExtragereCantitati.js`). Codul vechi (8a6fbbb) avea patru probleme:
1. La non-2xx afișa mesajul generic al supabase-js („Edge Function returned a non-2xx status code”). Motivul real (de ex. „o pornește doar ownerul sau responsabilul”) stă în `error.context`.
2. La eroare făcea `break`, apoi apela imediat `showToast('Extragere terminată: N rânduri noi','ok')`. Toast-ul e unul singur, deci eroarea era înlocuită de un fals succes. Testul „VECHE” rulează o copie a buclei vechi: la un 403 produce `[err …non-2xx…]` urmat de `[ok Extragere terminată: 0 rânduri noi]`.
3. După 40 de apeluri se oprea tot cu „terminată”, deși serverul răspundea `continua=true`.
4. Ignora `raport[].eroare` (felii cu răspuns neinterpretabil sau cu eroare de furnizor).

Acum stările sunt `ok`, `partial`, `neterminat` și `eroare`, iar mesajul arată motivul real și statusul HTTP. **Reluarea** pornește de la felia unde s-a oprit, fără să plătească din nou feliile deja făcute (upsert-ul previne dublurile, nu costul). Se reia în două situații:
- după plafonul de apeluri;
- **după o eroare trecătoare la mijlocul rulării** (`eroare` cu `deLa > 0` și status ≠ 401/403, de ex. 504/546 sau o eroare de furnizor). Butonul devine „Continuă extragerea (felia X)”.

La 401/403 nu se oferă reluare. Funcția pură `reluareDupa` are teste.

**B. `mesajInvoke` într-un singur loc:** `src/lib/mesajInvoke.js`, plus `statusInvoke`. Până acum existau copii identice în `OfertareLicitatii.jsx` și în modulul extragerii. `OfertareLicitatii.jsx` o importă acum; corpul funcției nu s-a schimbat.

**C. Funcția `ofertare-cantitati-extrage`: `tip_sursa` pe secțiuni** (`sectiuni.ts` nou, `handler.ts`).
- Problema: handlerul punea `tip_sursa='lista_f3'` pe **toate** rândurile unui document `lista_cantitati`. Pe doc 434 rândurile C6–C9 ar fi intrat ca F3. Efectele: ar fi umflat `v_ofertare_pt_stare.lista_f3_m`; `lista_c6_m` ar fi rămas NULL; `controlCantitati` (`src/ofertareControale.js:30`) ar fi comparat greșit.
- Schema nu se schimbă. Constrângerea `ofertare_cantitati_tip_sursa_check` permite deja `lista_f3`, `lista_c6`, `lista_alt`, `memoriu`, `plansa`, `caiet` și `alt` (`pg_constraint`). Valorile sunt cele din backfill-ul 13.09 (migrarea `ofertare_cantitati_tip_sursa_h2_lista`), folosite pe Domnești: C6 → `lista_c6`, C8/C9 → `lista_alt`.
- Regula: **tipul se decide în cod, din antetele din text, nu din ce răspunde modelul.** „Formular F3” / „Lista cu cantitati de lucrari…” dă `lista_f3`. „Formular C6” / „Lista cuprinzand consumurile de resurse materiale” dă `lista_c6`. „Formular C7/C8/C9” / „…consumurile cu mana de lucru / de ore de functionare / privind transporturile” dă `lista_alt`.
- Ultimul antet întâlnit decide secțiunea. Granița se pune la începutul paginii antetului. Textul dinaintea primului antet ține de primul formular.
- **Feliile nu mai trec peste o graniță de secțiune**, deci fiecare felie are un singur tip, scris și în `raport[].tip_sursa`. Răspunsul are acum și `pe_tip_sursa`.
- La începutul unei secțiuni noi, obiectul F3 nu se mai moștenește: C6 e pe investiție, nu pe Obj6.
- **Varianta aleasă e cea sigură.** Nu am ales „excludere” sau „marcaj în `diferenta_nota`”, pentru că există o valoare permisă care se potrivește exact. Un document fără antete diferite se feliază **identic** cu varianta veche (test). Documentele `cs_volum`/`alta` rămân fără `tip_sursa`, ca înainte. Rândurile existente nu se ating, pentru că upsert-ul folosește `ignoreDuplicates`.
- Ce se schimbă concret în BD (`regexp_matches` pe toate cele 13 documente `lista_cantitati` cu text):
  - **Doc 434:** se schimbă felierea, din 3 felii în 5 (F3 3 + C6 1 + C7–C9 1). Caracterele trimise rămân aceleași: 145.697.
  - **Fișierele C6/C7/C8/C9 de pe Domnești (doc 165–168):** la o nouă rulare ar primi `lista_c6`/`lista_alt`, nu `lista_f3` ca în codul vechi. Rândurile existente au deja tipul corect, din backfill.
  - **Restul documentelor** (lic. 3, 5, 15): o singură secțiune, felii identice.

**Teste** (rulate pe ramură):
- `npx vitest run`: 389/389, dintre care 17 în `src/ofertareExtragereCantitati.test.js`
- `npm install && npx vite build`: OK
- `deno test --node-modules-dir=none --no-lock supabase/functions/ofertare-cantitati-extrage/`: 25/25 (12 pentru poartă + 13 pentru secțiuni)
- `supabase/functions/ofertare-plansa-citeste/`: 44/44, pentru că `_test/fake_supa.ts` înregistrează acum și payload-ul de upsert
- Test de mutație: cu vechea regulă `tip_sursa='lista_f3'`, 2 teste de handler pică

## 4. Cum se populează cantitățile Jilavei (decizia și apăsarea îi aparțin lui Razvan)
**Cine poate porni (poarta pe cheltuială, `poarta.ts` + `handler.ts`):** doar ownerii, **Razvan Trusu** și **Tudorache Marilena Claudia** (`profiles.is_owner`), sau responsabila lic. 93, **Cristina Dumitrescu** (`ofertare_licitatii.responsabil_id`). Contul „Claude” primește 403. Calea `x-radar-secret` (worker) sare peste poarta de owner și cere OK explicit de la Razvan.

**Ordinea contează.** Funcția live e cea veche până la PR + merge + **deploy** pentru `ofertare-cantitati-extrage` (cu `sectiuni.ts`). O rulare înainte de deploy scrie C6–C9 ca `lista_f3`. Asta se repară doar cu retipizare prin UPDATE, cu preview și confirmare (SQL-ul (4) de mai jos).

| Varianta | Ce face | Cost (gpt-5-mini) |
|---|---|---|
| **B. Doar doc 434, după deploy** (recomandat) | **5 apeluri separate**, fiecare `{licitatie_id:93, de_la:N, max_felii:1}` pentru N = 17, 18, 19, 20, 21 (doc 434 ocupă feliile 17–21 din 54 după deploy; înainte ocupa 17–19 din 52). Apelul se face cu JWT-ul unui owner sau al responsabilei. Tipurile așteptate pe felii: `lista_f3`, `lista_f3`, `lista_f3`, `lista_c6`, `lista_alt`. **Verificare după FIECARE apel:** `raport[0].doc` = „…LST-002-00-R Cantitati de lucrari.pdf”, `raport[0].bucata` = „k/5”, `raport[0].tip_sursa` cel așteptat, fără `raport[].eroare`, `stop` ≠ `max_output_tokens`, apoi `cost_usd`, `pe_tip_sursa` și durata (trebuie să fie mult sub ~150 s). Dacă o felie iese „raspuns neinterpretabil” / `max_output_tokens` (riscul e mai ales pe N=18: ~178 de rânduri candidate, ~12,5k tokeni de ieșire din plafonul de 16k), se reia **o singură dată** doar felia respectivă. Dacă pică din nou, **nu se mai reia**: se decide o felie mai mică, ceea ce înseamnă cod | estimat ~0,075 $; plafon ~0,17 $ |
| **A. Butonul din UI** | Procesează **43 de documente / 54 de felii** (52 înainte), adică `lista_cantitati`, `cs_volum` și `alta`, inclusiv Plan SSM, bibliografie, acorduri și 23 de planșe tipizate `alta`. Rezultă și rânduri-zgomot fără `tip_sursa`. După fix, butonul se reia singur și după o eroare trecătoare | plafon ~1,81 $ |
| **C. Cod: parametru `doc_ids`** + opțiunea „doar lista F3” în UI | Face A la fel de curată și de ieftină ca B. Cere PR și deploy (funcție + front) | ca B |

Baza estimărilor:
- Tarif 0,25 $/2 $ per M tokeni (`handler.ts`, `MODELE.openai_mini`). ~3,2 caractere/token: presupunere, nemăsurată pe Jilava. Prompt de ~900 de tokeni pe felie. Plafonul de ieșire e 16.000 de tokeni pe felie (`max_output_tokens`).
- **B:** intrarea e 145.697 de caractere, adică ~45,5k tokeni, plus 5 × 900, deci ~50k (0,0125 $). Ieșirea: ~441 de rânduri (F3 ~295 cu sub-rânduri, C6–C9 ~146) × ~70 de tokeni ≈ 31k (0,062 $). Plafon: 5 × 16k × 2 $/M = 0,16 $, plus intrarea.
- Rânduri candidate pe felie (regexurile din §2): 1 → 78, 2 → 178, 3 → 46, 4 (C6) → 127 de linii / 105 distincte, 5 (C7–C9) → 40.
- **A:** 949.739 de caractere cu suprapunere, adică ~297k tokeni, plus 54 × 900, deci ~345k (0,086 $). Plafon de ieșire: 54 × 16k × 2 $/M = 1,728 $.

## 5. După rulare: doar SELECT, apoi UPDATE numai cu preview și confirmare
1. Breakdown pe felie și tip pentru doc 434. Reperul: felii 1–3 `lista_f3` ≈ 190–214 principale + 94–105 sub-rânduri; felia 4 `lista_c6` ≈ 105; felia 5 `lista_alt` ≈ 40.
2. Rândurile `lista_f3` cu `cantitate IS NULL`. Pot veni din paginile DEVIZ GENERAL / CENTRALIZATOR (§2) și sunt zgomot, nu clarificări.
3. Cele 9 anomalii (TSE01C1 121,5 × 100 mp etc.). Apoi `v_ofertare_contradictii` pe 93, plus `lista_f3_m` / `lista_c6_m` din `v_ofertare_pt_stare`.
4. Legarea clarificărilor 54–62 la `cantitate_id`: UPDATE cu preview și confirmare.

## 6. Checklist Jilava (2–11): ce depinde de cantități
| # | Depinde? | De ce |
|---|---|---|
| 2 Cerințe susținute | nu (direct) | — |
| 3 Clarificări propagate | **da** | clarificările 10–18 (F3) au `cantitate_id` NULL, deci răspunsul autorității nu are poziție pe care să se propage |
| 4 Dovezi + titular | nu | — |
| 5 Date tehnice/planificare | **da** | GraficPoarta: rândul „Cantități rețea în platformă” e `block` când sunt 0 rânduri, iar butonul „Generează grafic” e inactiv (`src/GraficPoarta.jsx:293,374`). `lista_f3_m` e NULL |
| 6 Redactare trasabilă | indirect | capitolele care citează cantități n-au sursă în platformă |
| 7 Coerență între piese | **da** | `v_ofertare_contradictii` și controlul F3↔C6 n-au ce compara. Cu fixul §3.C, C6 intră separat și controlul devine posibil |
| 8 Pachet verificat după asamblare | **da** | F3-ul din pachet nu are în platformă o referință de comparat |
| 9 Aprobare = exact pachetul | nu | — |
| 10 Drepturi și erori | parțial | poarta 403 funcționează. Afișarea erorilor e reparată pe ramură (nemergeată) |
| 11 Semnare/depunere | nu | — |

## 7. Atenționări (nereparate, de decis)
- **Planșele Jilava (23 de documente, id 441–463, „…parte desenata/…-DWG-…”) sunt tipizate `alta`.** `ghicesteTip` (`src/OfertareLicitatii.jsx:655`, regex `/desene|plans|palnse|\.dwg$|izometri/`) nu prinde „desenata” și nici „-DWG-”, deci controlul planșă↔F3 e imposibil. Fixul regex și retipizarea (UPDATE cu confirmare) cer decizie separată.
- `v_ofertare_contradictii` nu filtrează pe `tip_sursa`. Rândurile C6 fără consum (de ex. „Material marunt | %” gol) vor apărea ca `cantitate_lipsa`, la fel ca rândurile de centralizator. De filtrat după rulare, nu de trimis la clarificări.
- Paginile DEVIZ GENERAL / CENTRALIZATOR rămân în secțiunea F3: nu au antet de formular, iar pag. 1–9 țin de primul formular. Dacă modelul scoate rânduri din ele, acestea apar ca `lista_f3` cu `cantitate` NULL (vezi §5.2).
- `termen_depunere` pentru 93 e stocat `2026-10-02 12:00:00+00`, adică 15:00 ora României. De verificat în anunțul SEAP.
- După extragere trebuie verificat dacă `fn_categorie_cantitate` pune pe rândurile Jilava (tub de protecție DN700) categoria rețea/conductă. Altfel GraficPoarta rămâne pe `block`.
