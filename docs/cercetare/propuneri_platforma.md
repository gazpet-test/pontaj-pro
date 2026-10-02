# Propuneri pentru ERP — Ofertare, Clarificări, Execuție

> Livrabil D · 01.10.2026 · **doar propuneri**. Schema BD, ordinea și ce intră în lucru decide Razvan.
> Bază: cercetarea din `cnsc_practica`, `baza_normativa`, `catalog_clarificari` + harta codului existent (citire, nu modificare).

## Ce există deja (nu reinventăm)

- **Generatorul de clarificări** `supabase/functions/ofertare-clarificari-propune/core.ts` (worker NAS, un apel Sonnet, max. 12 propuneri, categorii A–E). Intrări: `ofertare_cerinte`, golurile din `ofertare_acoperire`, `ofertare_cantitati`, `ofertare_verificari`, inventarul documentelor, clarificările existente și răspunsurile de la alte licitații. **Nu primește șabloane, normative, decizii CNSC.**
- **Controale deterministe** `src/ofertareControale.js` + poarta `src/ofertarePoarta.js`: cantități ΣF3 față de C6/memoriu/planșe/grafic (0,1%), garanție (luni), anexe, identitate străină, numere-cheie branșamente, participare (asociere/subcontractanți/terți/cumul funcții), tronsoane, grafic.
- **Acoperire** `ofertare-acoperire/core.ts` regula R20: sudor PEHD/oțel din `hr_autorizatii` (procedeu, diametru).
- **Clauze**: extragere `ajustare_pret` în `OfertareClauzeFormulare.jsx` (fără verificare față de lege/HG 1/2018).
- **`ofertare_normative`**: doar CRUD manual în `OfertareLicitatii.jsx` — **nimic automat nu o citește**.
- **Lipsesc complet:** controale tehnice (sudură/NDT/izolație/probe), consumuri de deviz, prag PNS, termene procedurale, tabel CNSC, proporționalitatea cerințelor de calificare.

## Prioritizare

**P0** = valoare mare, efort mic, fără tabele noi sau doar import de date. **P1** = tabele noi mici + control determinist. **P2** = module noi.

### P0 — imediat, aproape doar date

| # | Propunere | De ce (dovadă) | Atinge |
|---|---|---|---|
| P0.1 | **Corecturile din `ofertare_normative`** (tabelul consolidat din `baza_normativa.md`): 132/2021 → abrogat de **Ord. ANRE 17/2026**, 182/2020 → 65/2023, L50/1991 → **Legea 169/2026**, L10/1995 abrogată parțial, ediții de standarde, 20+ rânduri noi. | Tabela are 6+ intrări depășite; generatorul ar cita acte abrogate. | DML pe date reale → **preview → confirmare Razvan → apply** |
| P0.2 | **Verificare internă Ordin ANRE 17/2026** pentru Gazpet: ≥3 instalatori EGD, sudori oțel + PE (ambele procedee), aparate PE cu VTP valabilă, dovezi REGES. Raport din `hr_autorizatii` + inventar echipamente. | Termen de conformare ~26.08.2026 (dedus). Risc direct pe autorizația EDSB/EDIB și pe calificare. | doar SELECT / raport |
| P0.3 | **Injectarea catalogului în generator**: `catalog_clarificari.md` (67 șabloane, coduri `CL-X00`) + regulile de aur CNSC trimise ca context în `ofertare-clarificari-propune`; fiecare propunere returnează `cod_sablon` + `temei[]` + `precedent_cnsc[]`. | Azi propunerile n-au temei normativ; o clarificare cu temei și precedent e greu de ignorat de AC. | edge fn (cod) |
| P0.4 | **Detector de acte/ediții depășite în DA** (listă de cuvinte-cheie → șablon): „132/2021”, „182/2020”, „Legea 50/1991”, „Legea 10/1995”, „863/2008”, „NP 133-2013”, „PT CR 9-2013”, „Ordin 32/2012”, „etanșeitate 24 ore”, „licență ANRSC”, „SR EN 12068:1999”, „3834-2:2006”, „HG 395 art. 164” … | Determinist, fără AI; produce întrebări CL-A gata făcute. | `ofertareControale.js` |
| P0.5 | **Prag PNS**: alertă când oferta proprie < 80% VE (HG 395 art. 136 alin. (4)) → pornește dosarul de justificare; pentru concurenți < 80% fără cerere de justificare → motiv de contestare. | BO2023_1788, BO2025_104, BO2024_3130. | poartă |
| P0.6 | **Regula 1% (abateri tehnice)** la răspunsurile noastre la clarificări: Σ |valoarea teoretică a abaterilor/omisiunilor tehnice corectate| / preț total, blocant > 1% (HG 395 art. 134 alin. (9) lit. a)); erorile aritmetice separat, fără prag. | BO2024_159 (1,14% → respinsă). | `OfertareClarificariAC.jsx` |

### P1 — tabele mici + controale deterministe

| # | Propunere | Detaliu | Dovadă |
|---|---|---|---|
| P1.1 | **Tabel `cnsc_decizii`** importat din `cnsc_practica.json` (53 rânduri; câmpuri `id, data, an, domeniu, tema[], regula, temei_legal[], link_sursa` + detalii). Căutare pe temă în ecranul de clarificări/contestații; context pentru generator. | RLS `auth.uid() IS NOT NULL`, read-only pentru utilizatori. | — |
| P1.2 | **Calculator de termene** pe licitație: data răspuns AC (−10 / −6 zile), termen-limită întrebări, contestare 10/7 zile față de pragul 26.960.556 lei (de la fiecare comunicare / acces efectiv la dosar), cauțiune 2% cu plafon + alertă D+5 de la sesizare. | L98 art. 160–161, L101 art. 8 și 61¹; Decizia 2863/C4/3581/2025 (cauțiune tardivă). | — |
| P1.3 | **Acord Contractual HG 1/2018 structurat**: GBE %, Sume Reținute %, avans, penalitate/zi + plafon, perioadă garanție, formulă ajustare (indici, ponderi, dată referință). Câmp gol sau conflict cu L98 art. 222² (contract > 6 luni fără ajustare) → întrebare CL-D automată. | Extinde `ofertare_clauze_contract` existentă. | L98 art. 222², HG 1/2018 cl. 48 |
| P1.4 | **Validator F3/deviz** (11 reguli din `baza_normativa` → „Cum se verifică un deviz”): cantitate publicată = ofertată, cantitate × preț = valoare, Σ = centralizator, **preț unitar unic pe resursă** în C6–C9, manopera ≥ salariul minim construcții (4.582 lei/lună, ≈27,71 lei/oră, calculat cu concediul în baza anuală), indirecte 5–15%. Ieșire OK / ATENȚIE / BLOCKER. | Extinde controlul de cantități existent. | BO2026_3104, BO2021_1060, BO2020_2124 |
| P1.5 | **Tabel `salariu_minim_istoric`** (sector, data_de_la, lei_lună, ore_lună, act) — parametru pentru P1.4 și pentru verificarea concurenților. | | OUG 156/2024, HG 146/2026 |
| P1.6 | **Checker tehnic al caietului de sarcini** (cuvinte-cheie + extragere AI existentă): procent NDT lipsă, „clasa de calitate II” netradusă în ISO 5817, cerințe ISO 3834-2/IWE ca calificare, certificat 3.1 vs 3.2, clasa izolației și a îmbinărilor, protecție catodică, durata/presiunea probelor, NP 133 la apă-canal → întrebări CL-T. | `ofertare-cerinte/core.ts` deja vede NDT ca indiciu. | NTPEE art. 238, 272–273 |
| P1.7 | **Calculator probe de presiune**: din volumul tronsonului (DN × L din F3) → durata probei de etanșeitate (tabel 8¹ NTPEE) și presiunile (tabel 8); apă/canal după NP 133-2022. Comparat cu CS și cu graficul. | | Ord. ANRE 2/2023 |
| P1.8 | **Flag „concesiune”** pe UAT (operator, contract, obligații de investiții) la triere. | | BO2026_2669 |

### P2 — module noi (de discutat)

| # | Propunere | Notă |
|---|---|---|
| P2.1 | **Registru experiență similară**: contract, beneficiar, calitate (AG / subcontractant / asociat), valoare proprie, PV recepție (tip + dată), semnatar recomandare, tip lucrare (distribuție/transport/branșamente/SRM/apă-canal), DN/presiune/km, contracte subsecvente la acord-cadru. Selector automat pe fereastra de 5 ani + data documentelor < termen depunere. | BO2026_182, BO2023_140, Instr. ANAP 2/2017. Pivotul calificării. |
| P2.2 | **Registru autorizații firmă + personal + echipamente** (ANRE OE viză 5 ani, instalatori EGD/EGIU, sudori ISCIR 2 ani legați de angajator, ISO 9606-1 confirmare 6 luni, NDT, VTP aparate PE) cu alerte 60–90 zile și verificare „valabil pe durata contractului”. | **Atinge HR** (`hr_autorizatii` există) → doar cu cerere explicită (CLAUDE.md pct. 6). |
| P2.3 | **Jurnal de sudură digital** pe proiect: sudură → sudor → WPS/WPQR → buletin NDT → PV lucrări ascunse; centralizator automat pentru cartea tehnică; regula 100% la sudurile de poziție. | Execuție, nu Ofertare. |
| P2.4 | **Recepție materiale**: tip certificat (2.2/3.1/3.2), data fabricației, vârsta la livrare (PE ≤ 3 luni, oțel ≤ 24, izolație ≤ 6 — regulile Distrigaz, parametrizabile pe OSD). | Magazie. |
| P2.5 | **Bibliotecă norme de deviz** (`cod, indicator, sursa oficial/firmă/proprie, um, resursă, consum`) alimentată din **pontaj** (ore reale pe metru/sudură) → consumuri proprii documentate = cea mai bună apărare la PNS. | Ghid P91/1-02: consumurile proprii sunt permise; BO2018_6476. |
| P2.6 | **Generator de răspuns PNS** articol cu articol (consum, material cu sursă, manoperă, utilaj, transport, indirecte, profit). | BO2024_3130. Depinde de P1.4 + P2.5. |
| P2.7 | **Recepție HG 273/1994** (forma HG 343/2017): calendar automat al termenelor din data comunicării terminării; dosar recepție gaze (NTPEE art. 286) și canalizare (CCTV, PV etanșeitate). | |
| P2.8 | **Jurnal de revendicări în execuție**: alerte +30 / +60 zile (HG 1/2018), +28 zile (FIDIC). | |

## Decizia de arhitectură — unde stă cunoașterea normativă?

- **A. Fișiere în repo** (`docs/cercetare/*.json`) încărcate de edge fn la build. Simplu, versionat în git, dar se actualizează doar prin PR.
- **B. Tabele Supabase** (`cnsc_decizii` + `ofertare_normative` extinsă + `clarificari_sabloane`) cu import din JSON. Editabile din UI, interogabile, citabile de generator și de controale. **← recomandat**: datele se schimbă des (Ord. 17/2026, Legea 169/2026 au apărut în ultimele 4 luni), iar `ofertare_normative` are deja CRUD.
- **C. Hibrid**: șabloanele și regulile CNSC în cod (rar schimbate), normativele în BD. Mai puține migrări, dar două surse de adevăr.

Recomandarea mea: **B**, în ordinea P0.1 → P1.1 → P0.3. Schema și aplicarea o decizi tu.

## Actualizare runda 2 — schema propusă pentru varianta B (doar propunere)

Registrele din runda 2 sunt gândite să fie importate 1:1, ca tabele separate de `ofertare_normative` (care rămâne lista de lucru din UI):
- `norme_surse` ← `registru_surse.json` (cheie `source_id`; legătură opțională la `ofertare_normative.id`)
- `norme_cerinte` ← `registru_cerinte.json` (cheie `requirement_id`, FK `source_id`)
- `norme_graf` ← `graf_aplicabilitate.json`
- `cnsc_decizii` ← `cnsc_practica.json`
- `clarificari_tipare` ← `clarificari_tipare.json` (FK-uri logice spre `norme_cerinte`)
- `ofertare_matrice_cerinte` (per licitație): document, pagină, citat, `requirement_id`, status, `pattern_id`, draft, review (cine/când), hash snapshot — vezi `clarificari_matrice_model.md`.

Generatorul `ofertare-clarificari-propune` ar primi DOAR tiparele declanșate + cerințele lor cu `verificat_pe_sursa=true` → întrebare neutră + impact intern separat; tiparele ⚖️ cer review juridic uman înainte de export. RLS read-only pentru utilizatori, scriere doar owner.

## Anexă — propunerile brute ale fiecărei teme de cercetare


### Achiziții publice și contracte tip

1. **Calculator de termene la fiecare licitație.** Introduci data limită de depunere, tipul procedurii, valoarea estimată și legea aplicabilă (L98 sau L99). ERP-ul calculează:
   - data minimă la care AC trebuie să răspundă (−10 sau −6 zile);
   - data maximă pentru întrebări (din anunț);
   - termenul de contestație (5 sau 10 zile față de pragul de 26.960.556 lei, de la data fiecărei comunicări);
   - cauțiunea estimată (2% cu plafon pe etapă);
   - alerta „cauțiunea până la D+5 de la sesizare”.
2. **Câmpuri structurate „Acord Contractual HG 1/2018”:** GBE %, procent restituit, Sume Reținute %, avans % și varianta (46.6/46.7), penalități pe zi și plafon, perioada de garanție, tabelul de ajustare (indici, ponderi, av, data de referință), Supervizor, arbitraj/instanță. Un câmp gol generează automat întrebarea de clarificare din §10.
3. **Verificare automată a prețului:** oferta proprie sub 80% din valoarea estimată generează un dosar de justificare (șablon art. 136 alin. (2): oferte furnizori, stocuri, salarii, utilaje).
4. **Checklist ANAP pentru neconformități:** se importă tabelul din documentul ANAP 2023 și se bifează la analiza documentației. Fiecare rând bifat propune un șablon de întrebare.
5. **Registru de experiență similară** pentru Gazpet: contract, beneficiar, calitatea (antreprenor general/subcontractant/asociat), valoare fără TVA, PV recepție pe obiecte cu date, categorie de importanță, material (PE/oțel), diametru și lungime. Filtrare automată pe fereastra de 5 ani, extinsă dacă termenul de depunere se amână (Instrucțiunea 2/2017 art. 13 alin. (2)).
6. **Registru de garanții:** emitent, tip (bancă/asigurare/IFN), valoare, valabilitate față de valabilitatea ofertei, alertă la 30 de zile înainte de expirare (cl. 15.2) și termene de restituire (3 zile lucrătoare pentru garanția de participare; 14 zile/70% pentru GBE).
7. **Jurnal de revendicări în execuție:** fiecare eveniment are data apariției și generează alerte la +30 de zile (notificare) și +60 de zile (detaliere) la HG 1/2018, respectiv la +28 de zile la FIDIC.
8. **Simulator de ajustare** (formula cl. 48.4/48.5) cu indicii INS importați lunar.

### ANRE, gaze, ISCIR, apă-canal

1. **Registru de autorizări ANRE/ISCIR ale firmei și ale personalului**, cu date de expirare și alerte:
   - autorizația firmei: vizare la 5 ani, cu fereastra de 60–90 de zile;
   - instalatori EGD/EGIU: vizare la 5 ani;
   - sudori ISCIR: 2 ani, legați de angajator;
   - operatori CND (dacă sunt proprii);
   - aparate de sudură PE: verificare tehnică periodică.
2. **Verificare automată a conformității cu Ordinul 17/2026**: numără din HR instalatorii EGD (≥ 3), sudorii OL (≥ 1) și sudorii PE pe ambele procedee (≥ 2) pentru EDSB. Semnalizează lipsurile înainte de depunerea ofertei.
3. **Tabel parametric de probe în modulul Ofertare** (domeniu, treaptă de presiune, material → presiune, durată): calculează durata probei de etanșeitate din volum (Tabel 8^1 și Tabel 10) pentru fiecare tronson din lista de cantități și o compară cu ce cere caietul de sarcini.
4. **Detector de norme depășite în documentația SEAP**, după cuvinte-cheie: „132/2021”, „182/2020”, „NP 133-2013”, „I 22”, „PT CR 9-2013”, „Ordin 32/2012”, „24 ore etanșeitate”, „licență ANRSC”. Propune automat șablonul de clarificare potrivit.
5. **Checklist pentru dosarul de recepție gaze** (art. 286 NTPEE) și **canalizare** (CCTV, PV de etanșeitate, relevee GIS), legat de proiect, pentru cartea tehnică.
6. **Rubrică în deviz pentru costurile „ascunse” din norme**: CND, buletin anticoroziv, masive de ancoraj de probă, apă potabilă de probă, dezinfectare și analize, CCTV, fir trasor, bandă de avertizare.

### Sudură, NDT, izolație, materiale

1. **Registrul sudorilor** (modul HR/Magazie): pentru fiecare sudor, autorizația ISCIR (tip oțel/PEHD, procedeu, nr., dată emitere, expirare ≤ 2 ani), certificatul ISO 9606-1 (domeniu, data ultimei confirmări la 6 luni) și angajatorul. Alertă la 60 de zile înainte de expirare și la 6 luni fără confirmare. Verificare automată la ofertare: „autorizație valabilă pe durata contractului?”.
2. **Registrul WPQR/WPS:** material (grupa ISO 15608), interval de grosime, diametru, procedeu, nivel 1/2, aprobare ISCIR. La ofertare se compară cu materialele din F3 (ex. L290, DN 400) și se semnalează golurile.
3. **Laboratoare NDT subcontractate:** autorizații ISCIR (aviz 4 ani), operatori pe metodă și nivel, CNCAN, cu alerte de expirare.
4. **Aparate de sudură PE:** agrement, data reviziei și intervalul producătorului, verificare metrologică; import de protocoale (PDF/CSV) legate de sudura și proiectul respectiv.
5. **Jurnal de sudură digital** per proiect: sudură → sudor → WPS → buletin NDT → PV lucrări ascunse. Generează automat centralizatorul pentru cartea tehnică și verifică regula „100% suduri de poziție”.
6. **Checker CS la Ofertare:** caută în textul caietului „clasa de calitate”, „NDT/radiografi”, „3.2”, „3834”, „IWE”, „B2/B3”, „21809”, „12068” și ediții de standarde depășite (o listă de mapare ediție veche → nouă, ca în tabelul de la constatarea 3). Propune automat întrebările de clarificare de mai sus.
7. **Recepție materiale:** câmpuri obligatorii pentru tipul de certificat (2.2/3.1/3.2), data fabricației, cu verificarea vârstei la livrare: PE ≤ 3 luni, OL ≤ 24 luni, izolație ≤ 6 luni (regulile Distrigaz, parametrizabile pe OSD).
8. **Calculator probe de presiune:** din volumul tronsonului dă durata probei de etanșeitate (tabelul 81 NTPEE) și presiunile (tabelul 8, cu nota pentru PE80).

### Norme de deviz și legi conexe

- Tabelul `salariu_minim_istoric(sector, data_de_la, lei_luna, ore_luna, act)` cu valorile 4.582 lei pentru construcții (2025–2026), 4.050 lei, respectiv 4.325 lei de la 01.07.2026 pentru salariul general. Validator automat pe tariful orar din C7.
- O bibliotecă `norme_deviz(cod, indicator, sursa[oficial|firma|proprie], um, resursa, consum)`, populată inițial cu tabelele SOFTEH-VALROM pentru PE și cu normele proprii Gazpet din pontaj (ore reale pe metru sau pe sudură). Pontajul ERP poate genera **consumuri proprii documentate**, adică cea mai bună apărare la prețul neobișnuit de scăzut.
- Verificatorul F3 cu cele 11 reguli de mai sus, cu ieșire `OK / ATENTIE / RED / BLOCKER` și o listă de clarificări pre-completate din șabloane.
- Flag pe `ofertare_normative` de tipul `abrogat_de` + `data_abrogare` și un alert în documentațiile AC care citează acte abrogate (Ordinul 863/2008, Legea 50/1991, Legea 10/1995).
- Un câmp `clasa_consecinte` pe proiect (CATUC) pentru calculul garanției minime.
- Un checklist de recepție cu termenele din HG 273 (5/10/3/90/3/5/10 zile), cu calendar automat din data comunicării terminării lucrărilor.

### Gaze naturale

1. **Biblioteca de experiență similară.** Pentru fiecare contract Gazpet se stochează:
   - tipul (distribuție/transport/branșamente/SRM/apă-canal) și parametrii (DN, presiune, km, nr. branșamente, debit SRM);
   - valoarea executată de Gazpet (inclusiv ca subcontractant);
   - data PV de recepție la terminarea lucrărilor și tipul documentului (PV final/parțial/stadiu fizic);
   - semnatarul recomandării (beneficiar sau diriginte);
   - dacă a fost acord-cadru, lista contractelor subsecvente.
   - Verificare automată: documentul are data înaintea termenului de ofertare, iar valoarea cumulată ≥ prag, în limita numărului maxim de contracte.
2. **Registrul de autorizații ANRE ale firmei și ale persoanelor**, cu tip și valabilitate. Alertă dacă expiră înainte de termenul de ofertare sau în perioada contractului. Pentru experți: data obținerii autorizației, comparată cu perioadele proiectelor invocate (BO2026_182). Același lucru pentru subcontractanții și asociații propuși (BO2024_3288).
3. **Checklist-ul propunerii tehnice**, generat din fișa de date: elementele marcate „obligatoriu/sub sancțiunea respingerii” (proceduri pe categorii de lucrări, componentele din Gantt). Verificare că PT nu conține denumirile altor obiective sau localități (căutare automată a numelor din ofertele anterioare) și nici text corupt (BO2026_3104, D271).
4. **Validator F3/liste de cantități:** cantitățile ofertate = cantitățile publicate; cantitate × preț unitar = valoare; suma = centralizator (BO2021_1060, BO2026_3104).
5. **Modul PANS:** dacă prețul ofertei este sub 80% din VE, se generează automat dosarul de justificare. Conține ofertele furnizorilor, desfășurătoarele de cost orar pentru utilaje, transportul lei/t/km, structura indirectelor (5–15%) și corelarea orelor cu Gantt-ul (BO2023_1788).
6. **Termene CNSC:** calculator pentru termenul de contestare de 10/7 zile (art. 8 Legea 101) și pentru cauțiune (art. 61^1). Notă: termenul poate curge de la accesul efectiv la dosar. Se păstrează jurnalul cererilor de acces la dosar.
7. **Verificare concurenți:** câmpuri pentru autorizația ANRE a câștigătorului (link portal.anre.ro), prețul față de VE, sursa ES. Acestea alimentează o listă de verificare pentru contestație.
8. **Flag „concesiune”** pe localitate/UAT (operator, contract, obligații de investiții), cu sursă ANRE și UAT (BO2026_2669).
9. **Generator de întrebări de clarificare** din cele 12 șabloane de mai sus, cu completare automată din fișa de date.

### Apă-canal și teme transversale

1. **Verificare preț unitar unic:** aceeași resursă cu același preț unitar în toate devizele C6–C9. Alertă la diferențe.
2. **Parametru „tarif orar minim construcții”** pe intervale de valabilitate (17,928 lei în 2020; ≈24,19 lei din 2023; actualizat la fiecare OUG). Alertă dacă manopera din deviz e sub prag.
3. **Indicator PNS:** valoare ofertă / VE. Sub 80% → se generează pachetul de justificare. Pentru concurenți: dacă e sub 80% și AC nu a cerut justificare, se semnalează motiv de contestare.
4. **Generator de răspuns PNS pe articol** din deviz: consum, preț material (cu sursă), manoperă, utilaj, transport, cheltuieli indirecte, profit.
5. **Calculator „regula 1%”** la răspunsurile de clarificare: suma modificărilor / preț total.
6. **Calculator valabilitate GP:** data-limită + valabilitatea ofertei + marjă. Checklist GP: document original (nu SWIFT), în limba română, plată la prima cerere, încărcat în SEAP.
7. **Checklist subcontractanți:** orice terț din justificarea prețului sau din PT trebuie să apară în lista de subcontractanți, cu acord.
8. **Detector de PT copiată:** similaritate text PT față de CS, plus căutare de localități sau obiective străine (oferte refolosite).
9. **Export Gantt** vectorial, cu durata comparată automat cu termenul din DA.
10. **Monitor de termene de contestare:** 10 zile de la publicarea DA, a răspunsurilor la clarificări și a rezultatului (Legea 101/2016 art. 8). Alertă pe răspunsurile AC care nu tratează întrebarea.
11. **Fișă terț susținător:** procent din contract executat în perioada de referință + terț de rezervă (2237/2023).
12. **Bază de precedente:** tabela din `cnsc_apa_general.json`, căutabilă după temă, la redactarea clarificărilor și a contestațiilor.
