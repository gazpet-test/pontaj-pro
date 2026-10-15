# Plan de test — Gemini 4 Argon (`gemini-4-argon`)

Scop: să aflăm, pe sarcini de-ale noastre și pe un set de probleme cu răspuns verificabil, dacă Argon poate înlocui modelele scumpe din platformă (în primul rând Opus 5) fără pierdere de calitate. Bugetul întregului test este **sub ~1 USD**.

Unealta este funcția edge `supabase/functions/test-gemini-argon` (doar owner, plafoane dure, jurnal în `ai_usage_log`). **Nu e deployată.** Deploy-ul și rularea se fac doar cu „da”-ul lui Răzvan.

## 0. Ce știm sigur (surse oficiale, citite la 15.10.2026)

| | Gemini 4 Argon |
|---|---|
| ID API | `gemini-4-argon` (stable). Varianta `gemini-4-argon-cyber-permissive` e doar pentru proiecte aprobate Fairwind, deci nu ne privește. |
| Preț Standard, USD / 1M tokeni | **intrare $2, ieșire $10** până la 30.11.2026; **intrare $4, ieșire $20** de la 01.12.2026. Ieșirea include tokenii de gândire. |
| Cache | doar implicit (prefix comun ≥ ~4–6k tokeni), $0,10 → $0,20. Cache-ul explicit (`cachedContents`) nu e suportat. |
| Batch / Flex | jumătate din preț: $1/$5 → $2/$10 |
| Free tier | nu există, deci cheia funcționează numai pe proiect cu facturare |
| Context / ieșire | 1.048.576 tokeni, comun pentru intrare, gândire și ieșire. Ieșirea implicită e de 65.536 (32.768 pe HTTP direct fără streaming). |
| Intrări | text, imagine, PDF, audio, video. Iese doar text. |
| Gândire | `thinkingLevel` = low / medium (implicit) / high. `MINIMAL` și `thinkingBudget` dau HTTP 400. |
| Ignorate / interzise | `temperature`, `top_p` și `top_k` se ignoră. `frequency_penalty`, `presence_penalty` și `candidate_count` dau 400. Prefill-ul nu e suportat. |
| Imagini / PDF | Nu au tarif separat: intră ca tokeni de intrare. Ghidul de rezoluție media dă orientativ ~1120 tokeni pe imagine la setarea implicită, iar pentru PDF ~560 pe pagină + textul nativ; `medium` e recomandat pentru PDF. Tabelul e general pentru Gemini 3/4 și nu e confirmat separat pentru Argon, așa că îl verificăm din `usage` la primul apel. |
| Date | Pe API-ul plătit, Google **nu** folosește prompturile și răspunsurile ca să-și îmbunătățească produsele. Le loghează un timp limitat, pentru abuz. Excepție: grounding cu Google Search le păstrează 30 de zile. Programul „Contributor” (invite-only) **folosește** datele; cheia noastră nu trebuie să fie într-un astfel de proiect. |
| Limitări declarate | Poate halucina. Poate fi lent sau poate da timeout: cererile grele durează minute. Cutoff de cunoștințe: martie 2026. |

Surse: [model](https://ai.google.dev/gemini-api/docs/models/gemini-4-argon) · [prețuri](https://ai.google.dev/gemini-api/docs/pricing) · [ce e nou / migrare](https://ai.google.dev/gemini-api/docs/latest-model) · [ghid dezvoltator Google Cloud](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/guides/gemini-4-argon) · [model card](https://deepmind.google/models/model-cards/gemini-4-argon/) · [termeni API](https://ai.google.dev/gemini-api/terms) · [anunț](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-4-argon/) · [rezoluție media](https://ai.google.dev/gemini-api/docs/media-resolution)

### Comparația de preț cu ce folosim azi (USD / 1M tokeni, intrare / ieșire)

| Model | Preț | Unde îl folosim (ultimele 30 de zile) |
|---|---|---|
| Claude Opus 5 | 5 / 25 | ofertare-acoperire, plansa-citeste, cerinte, hr-recomandare-citeste: **~54 USD** |
| Claude Sonnet 5 | 2 / 10 | mai multe funcții: ~27 USD |
| Claude Haiku 4.5 | 1 / 5 | ofertare-ingest-doc: ~14 USD |
| Claude Haiku 5.5 | 0,10 / 0,50 (≤100k intrare) | OCR local |
| gpt-5-mini | 0,25 / 2 | extragere F3 (implicit) |
| gemini-3.8-flash | 0,75 / 3,75 (se dublează la 01.01.2027) | comutator în cantitati-extrage |
| **Gemini 4 Argon** | **2 / 10 → 4 / 20 de la 01.12** | — |
| (de referință) Claude Opus 5.5 | 4 / 20 | — |

Pe scurt: până la 30.11, Argon costă cât Sonnet 5 și cu 60% mai puțin decât Opus 5. După 01.12 costă cât Opus 5.5, adică cu 20% mai puțin decât Opus 5. E mai scump decât Haiku 4.5, Haiku 5.5 și gpt-5-mini, deci nu are ce înlocui acolo.

⚠️ Notă din repo: `ofertare-cerinte/core.ts`, `ofertare-citire-test` și `ofertare-clarificari-propune` calculează Sonnet 5 la 3/15. Tariful curent e 2/10, deci costul afișat de acolo e supraestimat cu 50%. Nu am schimbat nimic: e o temă separată.

## 1. Sarcinile de citire (4 sarcini, comparabile cu folosirea reală)

Intrările sunt **doar documente de atribuire SEAP publice**, adică rânduri din `ofertare_documente_atribuire` (funcția refuză orice altă cale). Răzvan alege documentele, de preferat de pe o licitație unde avem deja rezultatul modelului actual verificat de om.

**Baza de comparație e gratuită**: folosim ieșirea pe care modelul actual a produs-o deja pentru același document. Modelul actual nu se mai plătește încă o dată.

| # | Sarcina | Apel | Model actual (bază) | Adevărul de referință |
|---|---|---|---|---|
| T1 | Citirea unei planșe (indicator + lungimi/diametre/trasee) | `task: 'imagine'` (sau `'pdf'` dacă planșa e PDF), `thinking: 'medium'`, `max_output: 6144` | ofertare-plansa-citeste (Opus 5) | om: indicatorul + lista de elemente de pe planșă |
| T2 | Tabel de cantități dintr-o pagină F3 / deviz | `task: 'pdf'` (o pagină), `thinking: 'low'`, același prompt ca `ofertare-cantitati-extrage` | ofertare-cantitati-extrage (gpt-5-mini), rândurile din `ofertare_cantitati` | om: rândurile paginii |
| T3 | Rezumatul cerințelor dintr-un caiet de sarcini (text) | `task: 'text'`, textul (≤ 60k caractere) lipit în prompt, `thinking: 'medium'` | ofertare-cerinte (Opus 5) | om: lista de ~15 cerințe-cheie |
| T4 | OCR pe o pagină scanată | `task: 'imagine'`, `thinking: 'low'`, același prompt de transcriere ca `ofertare-citire-test` | `text_extras` existent (Haiku 4.5 / OCR local) | om: transcrierea paginii |

### Punctaj (pe fiecare sarcină, Argon față de bază)

- **T1 planșă**
  - indicatorul: 5 câmpuri (titlu, nr. planșă, scară, fază, proiectant), exacte, 1 punct fiecare;
  - elementele: precizie și recall față de lista omului (o lungime e corectă doar cu cifra exactă și unitatea);
  - **−2 puncte pentru fiecare element inventat**.
- **T2 F3**
  - recall pe rânduri;
  - procentul de cantități exacte (cifră cu cifră) și procentul de coduri de articol exacte;
  - rânduri inventate (penalizare dublă);
  - `null` pus corect acolo unde lipsește cantitatea.
- **T3 caiet**
  - recall pe cerințele-cheie;
  - cerințe false (penalizare);
  - **citatul verificabil**: fiecare cerință trebuie să vină cu un pasaj copiat din text, verificat automat ca subșir; un citat inexistent primește 0.
- **T4 OCR**
  - CER (rata de eroare pe caractere) față de transcrierea omului;
  - procentul de numere exacte (cote, cantități, date).

**Regula de decizie:** Argon înlocuiește un model pe o sarcină doar dacă
- (a) punctajul e ≥ cel al bazei;
- (b) nu are mai multe elemente inventate decât baza;
- (c) **costul pe sarcină**, socotit la tariful de după 01.12 (4/20), e mai mic decât al bazei.

Costul pe sarcină contează, nu cel pe token: gândirea se plătește ca ieșire și poate umfla costul.

## 2. „Test de inteligență” — 10 probleme cu răspuns verificabil (fără date ale firmei)

Setul rulează **identic** pe 4 modele: `argon`, `sonnet-5`, `haiku-5-5`, `gpt-5-mini`. Folosește parametrul `model` al aceleiași funcții, cu `task: 'text'`, `thinking: 'medium'` și `max_output: 4096`.

Fiecare prompt se termină cu: *„Arată pașii pe scurt. Pe ultima linie scrie exact: RĂSPUNS FINAL: <rezultatul cu unitatea>.”*

Fiecare problemă are 10 puncte, deci maximum 100:
- **6 puncte** pentru rezultatul final în toleranță;
- **2 puncte** pentru metodă și unități corecte;
- **2 puncte** pentru capcana evitată sau ipotezele declarate.

Punctarea se face pe linia „RĂSPUNS FINAL” (automat, cu toleranța dată) plus o citire rapidă a pașilor.

**P1. Viteza gazului.** O conductă PE100 SDR11 De 110 mm transportă 200 Nm³/h de gaz natural la 4 bar presiune relativă. Ignoră temperatura și compresibilitatea; presiunea atmosferică e 1,01325 bar. Care e viteza medie a gazului în conductă?
- Răspuns: grosimea peretelui e 10 mm, deci Di = 90 mm. Debitul real este Q = 200 × 1,01325 / 5,01325 = 40,42 m³/h. v = 40,42 / 3600 / (π × 0,045²) = **1,76 m/s** (toleranță ±0,05).
- Capcane:
  - presiunea relativă folosită drept absolută dă 2,21 m/s;
  - diametrul exterior 110 mm folosit în loc de Di dă 1,18 m/s.

**P2. Pierderea de sarcină, apă.** Apa curge cu 10 l/s printr-o conductă cu Di = 100 mm, lungă de 500 m, cu λ = 0,02 (Darcy–Weisbach). Care e pierderea liniară de sarcină, în m și în bar?
- Răspuns: v = 1,273 m/s, iar hf = 0,02 × (500 / 0,1) × v² / (2g) = **8,26 m ≈ 0,81 bar** (toleranță ±2%).

**P3. Volumul de săpătură.** O tranșee lungă de 250 m are adâncimea 1,20 m și lățimea la fund 0,60 m, cu taluzuri 1:0,5 pe ambele părți. Care e volumul excavat și ce volum trebuie transportat dacă coeficientul de afânare e 1,25?
- Răspuns: lățimea la suprafață e 0,6 + 2 × 0,5 × 1,2 = 1,8 m. Aria secțiunii este (0,6 + 1,8) / 2 × 1,2 = 1,44 m². Volumul excavat e **360 m³**, iar cel de transportat **450 m³** (exact).

**P4. Cantități din dimensiuni.** Conducta traversează 3 străzi, fiecare traversare având 8 m de tranșee. Tranșeea are 0,80 m lățime la suprafață, iar asfaltul se taie cu încă 0,25 m pe fiecare parte. Refacerea se face cu un strat de binder de 6 cm și unul de uzură de 4 cm, cu densitatea 2,4 t/m³. Care e suprafața de asfalt și câte tone se pun?
- Răspuns: lățimea tăiată e 0,8 + 2 × 0,25 = 1,3 m. Suprafața este 3 × 8 × 1,3 = **31,2 m²**, iar cantitatea 31,2 × 0,10 × 2,4 = **7,49 t** (toleranță ±0,01).
- Capcana: dacă omite supralățimea, rezultă 19,2 m².

**P5. Planificare cu constrângeri.** Activitățile, cu durata în zile, sunt:
- A trasare (1);
- B săpătură (4), după A și după G;
- C pozare (3), după B și după F;
- D probă de presiune (1), după C;
- E umplutură (2), după D;
- F aprovizionare materiale (5), poate începe din ziua 0;
- G avizul de spargere a carosabilului (6), poate începe din ziua 0.

Întrebări:
- Care e durata minimă și care e drumul critic?
- Cu cât se lungește lucrarea dacă A întârzie 3 zile?
- Dar dacă G întârzie 2 zile?

Răspuns:
- **16 zile**, drum critic **G → B → C → D → E** (G se termină în ziua 6; B: 6–10; C: 10–13; D: 13–14; E: 14–16);
- A întârziată 3 zile: **0 zile** (A are 5 zile de rezervă);
- G întârziată 2 zile: **+2, adică 18 zile**.

Capcană: modelul pornește B după A (ziua 1) și uită de aviz.

**P6. Întrebare normativă cu capcană.** *„Conform NTPEE-2018, care e distanța minimă de 50 m impusă între o stație de reglare-măsurare și orice branșament de gaz, și în ce articol e prevăzută?”*

Răspuns așteptat: modelul **nu** confirmă cifra și **nu** inventează un număr de articol. Spune că nu poate verifica premisa fără textul normativului și cere textul sau recomandă verificarea lui.

Punctaj:
- 10 puncte: refuză să inventeze și explică de ce;
- 5 puncte: răspunde evaziv, dar fără articol inventat;
- 0 puncte: dă un articol sau o justificare inventată;
- +0 în plus, dar se notează: dacă precizează că NTPEE-2018 a fost aprobat prin Ordinul ANRE nr. 89/2018.

Orice articol citat de model se verifică de om în corpusul `rag-normative` înainte de punctare.

**P7. Listă de cantități cu o greșeală plantată.** Verifică lista și spune ce e greșit:

| Nr. | Poziție | Cant. | U.M. | Preț unitar (lei) | Valoare (lei) |
|---|---|---|---|---|---|
| 1 | Conductă PE100 SDR11 De110 | 1.250 | m | 42,50 | 53.125,00 |
| 2 | Conductă PE100 SDR11 De63 | 430 | m | 18,20 | 7.826,00 |
| 3 | Branșamente De32, 38 buc × 12 m | 456 | m | 9,80 | 4.486,80 |
| 4 | Robinet De110 | 6 | buc | 1.150,00 | 6.900,00 |
| | **Total** | | | | **72.337,80** |

- Răspuns: **rândul 3** e greșit. 456 × 9,80 = 4.468,80, nu 4.486,80: cifrele sunt inversate. Totalul corect este **72.319,80 lei**, cu **18,00 lei** mai puțin.
- Capcană: totalul declarat e calculat corect din rândurile greșite. Un model care verifică doar suma nu găsește nimic.

**P8. Consumul și costul anual al unei centrale.** O centrală de 24 kW are echivalentul a 1.800 de ore pe an la sarcină plină și randament 92%. Puterea calorifică a gazului e 10,5 kWh/m³, iar prețul 0,30 lei/kWh (facturat pe energia gazului). Cât gaz se consumă pe an și cât costă?
- Răspuns: energia gazului este 24 × 1800 / 0,92 = **46.957 kWh**, adică **4.472 m³**, la un cost de **14.087 lei** (toleranță ±0,5%).
- Capcană: dacă înmulțește cu randamentul în loc să împartă, rezultă 39.744 kWh.

**P9. Apa pentru proba hidraulică.** O conductă PE100 SDR11 De110, lungă de 1.250 m, se umple cu apă la 2 l/s. Ce volum de apă trebuie și cât durează umplerea?
- Răspuns: Di = 90 mm, deci V = π × 0,045² × 1250 = **7,95 m³**. Umplerea durează 3.976 s, adică **≈ 66 de minute** (toleranță ±2%).
- Capcană: cu De în loc de Di rezultă 11,88 m³.

**P10. Matematică în mai mulți pași.** Echipa A sapă 1 km de tranșee în 12 zile, echipa B în 18 zile. A începe singură, iar B i se alătură după 3 zile. În câte zile e gata kilometrul, din momentul în care a pornit A?
- Răspuns: în primele 3 zile, A face 0,25 km. Restul de 0,75 km se sapă cu ritmul comun de 1/12 + 1/18 = 5/36 km/zi, în 5,4 zile. Total: **8,4 zile** (exact).

## 3. Cost estimat (sub 1 USD)

Ipotezele sunt prudente: probleme de ~350 de tokeni de intrare; ieșire plus gândire ~4.000 la Argon „medium” și ~2.500 la celelalte.

| Bloc | Apeluri | Estimare | Maximul teoretic (toate apelurile la plafon) |
|---|---|---|---|
| Argon, 4 sarcini de citire (T3 cu ~15k tokeni de intrare) | 4 | ~0,21 USD | ~0,37 USD (`max_output` 6144) |
| Argon, setul de 10 probleme | 10 | ~0,41 USD | ~0,42 USD (4096 × $10/1M × 10) |
| Sonnet 5, cele 10 probleme | 10 | ~0,26 USD | ~0,42 USD |
| Haiku 5.5, cele 10 probleme | 10 | ~0,01 USD | ~0,02 USD |
| gpt-5-mini, cele 10 probleme | 10 | ~0,05 USD | ~0,08 USD |
| Baza pentru T1–T4 | 0 | 0 (rezultate deja existente) | 0 |
| **Total** | **44** | **~0,94 USD** | **~1,31 USD** |

**Regula de oprire:** după fiecare bloc se citește `SELECT sum(cost_usd) FROM ai_usage_log WHERE function_name = 'test-gemini-argon'`. Dacă suma trece de **0,90 USD**, Sonnet 5 rulează doar pe P1, P5, P6 și P7, ceea ce ține totalul sub 1 USD.

Testul trebuie rulat **înainte de 30.11.2026**, cât e prețul introductiv. După 01.12, același test costă cam de două ori mai mult pe partea Argon.

## 4. Pașii (fiecare cu „da”-ul lui Răzvan)

1. Răzvan confirmă că `GEMINI_API_KEY_Argon` e pe un proiect Google **cu facturare** și **nu** în programul Contributor.
2. Deploy `test-gemini-argon` cu `verify_jwt = true`, plus un rând în `public.automatizari` și în `registru_automatizari`, cu fișa a–e din `handler.ts`. Nu e cron: o pornește doar ownerul.
3. Răzvan alege documentele pentru T1–T4 și furnizează (sau confirmă) adevărul de referință.
4. Rularea: întâi setul de 10 probleme pe Argon, apoi T1–T4, apoi comparatorii. Rezultatele (JSON-urile întoarse) se salvează local și se punctează după rubricile de mai sus.
5. Concluzia se scrie aici, pe o pagină, în secțiunea 5.
6. După test, funcția se retrage (`stare = retras` în `automatizari`). Nu rămâne deployată.

## 5. Rezultate

*(se completează după rulare)*

| Model | P1 | P2 | P3 | P4 | P5 | P6 | P7 | P8 | P9 | P10 | Total /100 | Cost USD | Timp total |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Argon (medium) | | | | | | | | | | | | | |
| Sonnet 5 | | | | | | | | | | | | | |
| Haiku 5.5 | | | | | | | | | | | | | |
| gpt-5-mini | | | | | | | | | | | | | |

| Sarcină | Bază (model, punctaj, cost) | Argon (punctaj, cost la 2/10, cost la 4/20) | Verdict |
|---|---|---|---|
| T1 planșă | | | |
| T2 F3 | | | |
| T3 caiet | | | |
| T4 OCR | | | |
