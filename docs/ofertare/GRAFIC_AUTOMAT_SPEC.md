# Grafic de execuție automat (AI generator → motor de calcul → verificare Paw) — SPEC

Stare: **propunere, de aprobat de owner**. Data: 24.11.2026. Scris în sesiunea de analiză „MS Project ↔ ERP”.
Destinatar: sesiunea **Ofertare — programare** (implementare). Modul: Ofertare (`/grafic/licitatie/:id`).
Dovezile testului din 24.11 sunt în [`grafic_automat_test_jilava/`](grafic_automat_test_jilava/).

---

## 1. De ce

**Licitația 93, Jilava** (protejare conductă DN700 Bobești–Jilava cu tub de protecție Ø914, VE ≈ 1 mil. lei) a fost **respinsă pe 19.11.2026**.
Unul dintre cele trei motive a fost graficul Gantt/PERT. Comisia (solicitarea 407) a constatat:
- astuparea șanțului înaintea izolării și verificării tubului (drum principal);
- verificarea izolației înaintea izolării (bretea);
- instalația de aerisire montată înaintea săpăturii (bretea);
- subcontractantul SUBCONTRACTANT_A nu era evidențiat;
- PERT-ul nu avea LS/LF.

Răspunsul nostru la clarificări a adus un grafic nou, ceea ce poate fi văzut ca o completare a ofertei. Graficul se face azi de mână în MS Project, de un singur om, fără nicio verificare independentă înainte de depunere.

**Ce vrea owner-ul** (24.11.2026):
- graficul se face **singur**, fără să depindă de un om;
- AI-ul citește din caietul de sarcini cum trebuie făcut graficul;
- ia din ERP ce îi trebuie;
- îl generează;
- **alt AI, separat, îl verifică** prin Paw.

**Testul din 24.11.2026** (doar citire, nimic scris în ERP; detalii în §11):
- **Jakarinos** a verificat „orb” graficul depus de noi (din .mpp-ul original). A găsit **toate cele 5 constatări ale comisiei**, plus 14 probleme pe care comisia nu le-a ridicat. Verdict NO-GO, în 2,5 minute.
- **Un AI generator** (Claude), cu acces doar la documentele beneficiarului și la datele din ERP, a produs un grafic. Jakarinos i-a confirmat succesiunea tehnologică drept corectă, cu zero erori de ordine. Cele 12 probleme rămase sunt de trei feluri:
  - **mecanice**: calendarul fără sărbători, articole de deviz grupate, lipsa desenelor;
  - **date lipsă**: norme, termen de livrare pentru țeavă, echipe, ce face subcontractantul — exact ce AI-ul a cerut;
  - **detalii tehnologice**, care se închid într-o a doua tură.

## 2. Obiective, non-obiective, anti-obiective

**Obiective**
1. De la un clic pe „Generează automat” până la un grafic **GO de la verificator**, fără muncă umană. Excepția sunt răspunsurile la întrebările de date pe care sistemul nu le poate afla singur.
2. Graficul respectă **tot ce cere documentația** licitației. Tipic (fișa de date IV.4.1 pct. 2 la Jilava):
   - Gantt la nivel de **articol de deviz**, în **zile lucrătoare**;
   - jaloane;
   - drum critic ca diagramă separată;
   - PERT cu ES/LS/EF/LF/durată/marjă pentru fiecare activitate;
   - subcontractanții evidențiați distinct;
   - alocarea resurselor;
   - încadrarea în termen.
3. Succesiunea tehnologică e corectă și **trasabilă**: fiecare legătură importantă are în spate un document (PCC, caiet de sarcini, memoriu) sau o regulă tehnologică numită.
4. Rezultatul se poate deschide în MS Project (export MSPDI `.xml`) și se poate depune.
5. Fiecare versiune e înghețată, împreună cu verdictul ei (istoric, fără suprascriere).

**Non-obiective (v1)**
- Graficele de **execuție** pentru proiecte în curs (Execuție → 📅 Grafic). Rămân la importul `.mpp` existent.
- Generarea fără documente. Fără caiet sau listă de cantități nu se pornește.
- Desenarea în ERP a diagramelor Gantt, PERT și drum critic ca PDF (vezi §6.4, decizia D4).
- Înlocuirea motorului PEHD existent (`motorPEHD` din `GraficPoarta.jsx`). Rămâne pentru rețele PEHD, cu modul lui.

**Anti-obiective** (dacă se întâmplă, e eșec chiar dacă „merge”)
- **AI-ul inventează durate sau norme fără să spună.** Regula owner-ului: *se oprește și cere datele, nu estimează.*
- **Datele calendaristice și drumul critic calculate de AI.** Trebuie să fie reproductibile, deci le calculează motorul.
- **Verificatorul e același model sau vede ce „trebuie” să găsească.** Verificarea trebuie să fie independentă și oarbă.
- **O cheltuială AI pornită de cineva fără drept**, sau o buclă care consumă fără limită.
- **Textul din documentele licitației tratat ca instrucțiune.** E conținut extern (CLAUDE.md pct. 10).
- **Un grafic marcat „GO” care nu respectă termenul cu sărbătorile incluse.**

## 3. Abordări luate în calcul

| | Abordare | De ce nu / de ce da |
|---|---|---|
| A | **AI-ul face tot**: activități, durate, date, drum critic, PERT | Respins. În test, calculele AI au ieșit corecte doar pe un calendar fără sărbători. Calculul de date nu trebuie lăsat unui model: nu e reproductibil și nu se poate testa. |
| B | **Motor cu șabloane fixe pe tip de lucrare**, fără AI (extinderea `motorPEHD`) | Respins ca soluție generală. Fiecare licitație are alt caiet, alte etape și alte puncte de control (PCC). Șabloanele trebuie scrise de mână pentru fiecare tip și tot nu citesc cerințele de prezentare. Rămâne bun pentru PEHD. |
| **C** | **AI generator (structură + ordine) → motor determinist (calendar, CPM, PERT, export) → verificator Paw independent, în buclă** | **Ales** (owner-ul, 24.11.2026: cele trei etape). Testul arată că AI-ul e bun la ce e greu de codat (citește documente, ordinea tehnologică), motorul la ce trebuie să fie exact, iar Paw prinde ce scapă ambilor. |

## 4. Fluxul (cele trei etape)

```
[clic „🤖 Generează automat”]  (doar cine trece fn_ofertare_poate_cheltui)
        │
        ▼
 ┌─ Etapa 1 — GENERATOR (AI) ───────────────────────────────┐
 │ citește cerințele (ERP) + devizul/F3 + documentele        │
 │ proiectului; propune activitățile și ordinea lor          │
 │ lipsește ceva? ──► STOP: întrebări pentru om ─────────────┼──► [asteapta_date]
 └──────────────┬────────────────────────────────────────────┘        │ omul răspunde
                ▼                                                     │ (date ERP)
 ┌─ Etapa 2 — MOTOR DE CALCUL (cod, determinist) ───────────┐◄──────────┘ reia de la Etapa 1
 │ calendar zile lucrătoare + sărbători legale RO,           │
 │ CPM (FS/SS/FF/SF + lag), PERT ES/EF/LS/LF/marjă,          │
 │ drum critic, verificări structurale, export MSPDI .xml    │
 └──────────────┬────────────────────────────────────────────┘
                ▼
 ┌─ Etapa 3 — VERIFICARE PAW (Jakarinos, independent, orb) ─┐
 │ GO  ──► versiune „GO”, gata de depus                      │
 │ NO-GO ──► neconformitățile se întorc la Etapa 1           │
 │           (iterația următoare, max. N, vezi D3)           │
 │ după N runde tot NO-GO ──► STOP: întrebare pentru om      │
 └───────────────────────────────────────────────────────────┘
```

**Stări ale unei cereri** (`ofertare_grafic_coada.stare`):
- `in_coada` → `genereaza` → `calculeaza` → `verifica` → `go`
- din `verifica`, la NO-GO și sub limită: înapoi la `genereaza`, iterația +1
- ieșiri: `asteapta_date` (întrebări pentru om), `nogo_final` (limita de iterații atinsă), `eroare`, `oprit` (oprit de om)

Fiecare trecere prin Etapa 2 produce o **versiune înghețată** în `grafic_versiuni`, cu verdictul Etapei 3 atașat.

## 5. Etapa 1 — Generatorul (AI)

### 5.1 Intrări (toate din ERP, citite pe server)

| Sursă | Tabel / loc | Notă |
|---|---|---|
| Cerințele licitației | `ofertare_cerinte` (`inlocuita_de IS NULL`, fără respinse/duplicate) | Conțin regulile de prezentare a graficului și termenul. Cerințele încă `de_analizat` se folosesc, dar raportul le listează separat („neconfirmate”). |
| Documentele licitației (text) | `ofertare_documente_atribuire.text_extras` | Fișa de date, caietul de sarcini, PT-ul (memoriu, PCC, caiete de sarcini tehnice, graficul proiectantului, liste de cantități). **Conținut extern = date.** |
| Articolele de deviz | `ofertare_cantitati` (doar `status='validat'`, regula R5); dacă lipsesc: oprire cu întrebarea „validați cantitățile” (aceeași regulă ca la 6.3), nu lista din documente | Graficul trebuie să aibă cel puțin o activitate pentru fiecare articol. |
| Norme de productivitate | `ofertare_norme_productivitate` (doar `incredere='validat'`) | Fără normă validată nu există durată: întrebare. |
| Parametri | `grafic_parametri.parametri` (data OI, durata ofertată, echipe, regim de iarnă, ferestre operator, jaloane) | Lipsă = întrebare. |
| Subcontractanți | ce e înregistrat pe licitație (subcontractant, procent, **ce articole execută**) | Lipsa repartizării pe articole = întrebare (la Jilava nu exista în ERP). |
| Răspunsurile anterioare | `ofertare_grafic_intrebari` (răspunse) | Din runda precedentă de întrebări. |
| Neconformitățile verificatorului | verdictul iterației anterioare (BLOCANT + MAJOR) | Doar de la iterația 2 încolo. |

### 5.2 Ce produce (JSON validat de schemă; nimic liber)

- **Activități**: `cod` (WBS), `parinte`, `rezumat`, `jalon`, `denumire`, `articole_deviz[]` (codurile F3 acoperite), `executant` (Gazpet / numele subcontractantului / laborator / beneficiar), `durata_zile_lucratoare`, `sursa_durata`.
  - `sursa_durata` poate fi `norma:<cod>`, `document:<doc_id+pagină>`, `raspuns:<intrebare_id>` sau `parametru:<cheie>`.
  - **`PRESUPUS` nu există în producție** (vezi 5.3).
- **Legături**: `{de, la, tip: FS|SS|FF|SF, lag_zile, motiv}`.
- **Resurse (v1):** doar `executant`. Motorul verifică totuși capacitatea: în orice zi, numărul de activități de execuție simultane ale aceluiași executant ≤ `echipe` din parametri (pentru Gazpet) sau ≤ 1 (pentru un subcontractant fără parametru). Depășirea = eroare structurală (întoarcere la Etapa 1). Utilajele și echipele detaliate nu intră în v1; raportul le listează ca limitare.
  - `motiv` e obligatoriu pentru legăturile care țin de un punct de control (PCC, lucrări ascunse, verificare izolație, probe) și citează documentul.
- **Jaloane cerute** (din cerințe și PCC), fiecare cu sursa lui.
- **Întrebări** (vezi 5.3). Dacă există cel puțin o întrebare blocantă, nu se trimit activități la motor.
- **Note**: deciziile de succesiune, cu trimiterea la document (ca `note_generator.md` din test).

### 5.3 Regula „se oprește și întreabă” (decizia owner-ul, 24.11.2026)

Generatorul **nu estimează**. Se oprește și scrie întrebări în `ofertare_grafic_intrebari` când lipsește:
- o **durată** fără normă validată, document sau răspuns. Întrebarea se pune pe **operație sau normă**, nu pe fiecare activitate: „Ce productivitate are echipa la sudura tubului Ø914 (îmbinări/zi)?”;
- **termenul de aprovizionare** pentru materialele de pe drumul critic (la Jilava: țeava Ø914,4×7,1 L245N cu certificat 3.1);
- **numărul de echipe** pe meserie, și dacă cele două fronturi merg în paralel sau succesiv;
- **repartizarea subcontractantului** pe articole de deviz;
- **data OI presupusă** și **regimul de iarnă**. Exemple: beton sub 0 °C, sudură sub +5 °C doar cu procedură calificată, izolație la ≥3 °C peste punctul de rouă;
- o **cerință contradictorie sau neclară** despre prezentare. Exemplu: termenul de 3 luni se socotește până la comunicarea finalizării sau până la PV de recepție?

**Formatul unei întrebări**:
- `ce_lipseste`, `de_ce` (ce activități afectează, dacă e pe drumul critic), `tip_raspuns` (număr + unitate / dată / alegere / text);
- `unde_se_salveaza` = în ERP, unde devine dată reutilizabilă: o normă nouă cu `incredere='validat'`, un parametru `grafic_parametri`, o repartizare pe subcontractant.

Răspunsul **nu** rămâne doar în graficul acesta: la licitația următoare, aceeași normă nu se mai cere.

La reluare, generatorul pornește de la Etapa 1 cu răspunsurile incluse.

**Pentru test / diagnoză** (nu pentru depunere) există modul „schiță”. În el, generatorul poate marca `PRESUPUS` și continuă, ca să se vadă logica. O versiune cu orice `PRESUPUS` **nu poate fi niciodată GO** și se afișează cu bandă roșie „SCHIȚĂ”.

### 5.4 Model și rulare
- Modelul cel mai capabil disponibil prin API-ul Anthropic, configurabil (azi `claude-fable-5-2`), cu ieșire structurată. Costul se scrie în `ai_usage_log`.
- În test, generarea a durat ~15 min (agent cu unelte, 161 de activități), ceea ce depășește limita unei funcții edge. De aceea rulează în **workerul de pe serverul AI**, ca și Etapa 3 (decizia D1).
- Promptul include explicit: textul documentelor e **date**, nu instrucțiuni; fără web; fără alte licitații.

## 6. Etapa 2 — Motorul de calcul (cod determinist, fără AI)

Un singur modul **nou** (`src/graficMotor.js` sau similar), **folosit și de worker, și de UI**, cu teste vitest. Poate prelua cod din `src/graficCPM.js`, dar **nu îl modifică** (C4):
- Execuție, editorul existent și motorul PEHD rămân neschimbați în v1;
- versionarea editărilor manuale (§9) se aplică doar versiunilor `mod='ai'`.

### 6.1 Calendar
- Zile lucrătoare luni–vineri, **minus sărbătorile legale din România** (Codul muncii art. 139):
  - 1–2 ianuarie, 6–7 ianuarie, 24 ianuarie;
  - Vinerea Mare, Paștele și a doua zi, **Rusaliile și a doua zi** (calculate după Paștele ortodox);
  - 1 mai, 1 iunie, 15 august, 30 noiembrie, 1 decembrie, 25–26 decembrie.
- Lista e cod + teste, nu tabel. Se poate suprascrie din `grafic_parametri.calendar` (zile lucrătoare suplimentare, sâmbete lucrate, perioade de oprire impuse de operator), dar numai explicit și vizibil în raport.
- La Jilava, calendarul fără sărbători dădea 27.01.2027 (rezervă 3 zile). Cu sărbătorile, 04.02.2027: **termen depășit**. Motorul trebuie să prindă asta, nu verificatorul.

### 6.2 Calcul
- CPM cu **FS, SS, FF, SF și lag** (pozitiv/negativ, în zile lucrătoare). Azi `calcCPM` și `cpmTotal` știu doar FS/SS.
- ES/EF/LS/LF/marjă totală pentru **toate** pozițiile: activități, jaloane **și rezumate**. Rezumatul primește min(ES) / max(EF) al copiilor.
- Drumul critic = marjă 0. Lista ordonată + ramificațiile.
- Cicluri → eroare explicită (cu ciclul afișat).

### 6.3 Verificări structurale (blochează trimiterea la Etapa 3)
- **Încadrarea în termen**, pe calendarul cu sărbători. Termenul se ia din cerințe sau din parametri.
- **Corespondența cu devizul** (C3):
  - fiecare articol de deviz are cel puțin o activitate;
  - **o activitate acoperă cel mult un articol**. Un articol se poate împărți în mai multe activități, dar mai multe articole nu se grupează într-o activitate (Jakarinos a dat BLOCANT pe grupare);
  - nicio activitate „de execuție” fără articol, în afara celor marcate explicit (organizare, notificări, jaloane, verificări de recepție).
  - Lista de referință = `ofertare_cantitati` cu `status='validat'`. Dacă lipsește, generatorul se oprește cu întrebarea „validați cantitățile”, nu lucrează pe lista din documente.
- Fiecare activitate, în afara jalonului final, are succesor (la Y: aerisire bretea, predare front).
- Intervalul rezumatului acoperă toți copiii.
- Durată 0 doar la jaloane. O „remediere eventuală” se modelează cu o rezervă cerută omului, nu cu 0.
- În modul „depunere”: nicio `sursa_durata = PRESUPUS`, niciun executant presupus.

Dacă o verificare pică, cererea se întoarce la Etapa 1 cu lista problemelor (ca o neconformitate), fără să consume o verificare Paw. **Limită:** cel mult 3 întoarceri structurale la rând pentru aceeași cerere; la a patra, fluxul se oprește și pune o întrebare omului (ca după 3 NO-GO Paw). Contorul se resetează doar după un grafic care trece toate verificările motorului.

### 6.4 Ieșiri
1. **Versiune înghețată** în `grafic_versiuni`: `mod='ai'`, `activitati` cu tot calculul, `snapshot` (intrări, versiuni de model/prompt, hash-uri documente, răspunsuri folosite), `poarta` = verificările 6.3 + verdictul Paw.
2. **Export MSPDI `.xml`**, corectat față de `exportMSPDI` actual:
   - calendar **luni–vineri cu excepțiile** de sărbători. Azi exportul declară „Calendaristic 7 zile”, ceea ce contrazice „zile lucrătoare”;
   - legături FF/SF (tipurile MSPDI 0/2);
   - **executantul ca resursă** și un câmp text „Subcontractant” (ca să apară distinct în MS Project);
   - rezumatele marcate `Summary=1` după structură, nu după euristica actuală.
3. **Tabelele PERT și drum critic** (ca în test): în UI și ca xlsx.
4. **Diagramele de depunere** (Gantt, drum critic separat, rețea PERT), decizia D4:
   - **v1**: din MS Project, pe `.xml`-ul exportat. E pasul de tipărire al ofertantului, nu o decizie;
   - **v2**: randare în ERP.

## 7. Etapa 3 — Verificarea independentă (Paw / Jakarinos)

- **Cine**: `run_paw.cmd jak` (Codex, read-only, fără MCP și fără chei). E alt model decât generatorul: independența ține de model, nu doar de prompt.
- **Brief orb**, după șablonul din test ([`brief_verificator.md`](grafic_automat_test_jilava/brief_verificator.md)):
  - nu spune cine a făcut graficul, nici câte iterații au fost;
  - nu primește verdictele anterioare. Fiecare verificare e de la zero, ca să nu „confirme” corecturile;
  - primește cerințele relevante, fișa de date, PT-ul (graficul proiectantului, PCC, caiete de sarcini, memoriu), F3 și graficul (Gantt + PERT + drum critic) ca text, în `C:\Users\Public\paw-data\brief\grafic_<lic>_<versiune>\`.
- **Pachetul verificatorului îl face workerul, determinist** (C2). Nu îl alege nici omul, nici generatorul, ca să nu se piardă independența:
  - toate documentele licitației cu text (`fisa_date`, `cs_volum`, `lista_cantitati`, PT-ul) și toate cerințele valide, întregi;
  - fără extrase alese și fără trimiteri de tip „în jurul liniei 676”.
  - Verificat la lic. 93: toate cele 47 de documente utile au `text_extras`, inclusiv caietul de sarcini scanat (52.542 de caractere) și PCC-ul. Ingestia nu intră în proiect.
- **Diagramele** (C1): brief-ul spune explicit că desenele Gantt, drum critic și PERT se generează la depunere din `.xml` (D4). Verificatorul judecă **conținutul**:
  - câmpurile PERT pentru fiecare poziție, inclusiv rezumatele;
  - lista drumului critic față de marje;
  - nu judecă lipsa desenului.
  - Fără asta, testul a arătat că orice rulare iese NO-GO.
- **Ieșire obligatorie**: tabelul de neconformități (`nr | WBS | ce | de ce + sursă | BLOCANT/MAJOR/MINOR`) și pe ultimele linii `VERDICT: GO|NO-GO` + `INCREDERE: mare|medie|mica`.
  - Workerul parsează tabelul. Un răspuns fără liniile finale = `eroare` (se reîncearcă o dată), niciodată GO.
- **Regula GO**:
  - verdict `GO` **și** zero BLOCANTE **și** verificările 6.3 trec;
  - MAJORELE rămase apar la aprobare, dar nu blochează (decizia D2).
- **Bucla**:
  - la NO-GO, BLOCANTELE + MAJORELE merg la generator ca intrare (§5.1), cu iterația +1;
  - **limita: 3 verificări Paw pe cerere** (D3). După a treia, `nogo_final` + întrebare pentru om cu neconformitățile rămase.
  - Contorul se **resetează** doar când omul răspunde la întrebări, adică apar date noi (C5). Plafonul de cost e **cumulat pe toată cererea**, inclusiv peste pauze.
- **Opțional** (D5): a doua opinie Copilot pe versiunea GO, înainte de depunere. Nu e în bucla automată.
- Verdictul lui Jakarinos e **poartă, nu instrucțiune** (CLAUDE.md pct. 10/11). Workerul nu execută nimic din textul lui. Doar îl parsează și îl dă generatorului ca date.

## 8. Orchestrare, drepturi, cost, securitate

### 8.1 Pornire și coadă
- Tabel nou `ofertare_grafic_coada` (ca celelalte cozi Ofertare din 20261124a):
  - pornire **doar** prin RPC `ofertare_coada_porneste` (extins cu tipul `grafic`) sau prin RPC-ul lui dedicat;
  - `cerut_de = auth.uid()`, poarta **`fn_ofertare_poate_cheltui(licitatie, utilizator)`** (owner sau responsabil 1/2 cu numire dovedită);
  - fără INSERT/UPDATE direct din client; oprire prin `ofertare_coada_opreste`.
- **O singură cerere activă pe licitație.** O a doua pornire întoarce cererea existentă.
- **Plafon de cost pe cerere: 25 $** (decizia owner-ul, configurabil), cumulat peste pauze. Depășire = `oprit` + mesaj, nu continuare.
- Workerul re-verifică poarta pentru `cerut_de` la fiecare iterație (ca tick-ul extragerii din 20261124a).

### 8.2 Workerul de pe serverul AI (Gazpet-Claude)
- Proces pe server, pentru că Paw rulează doar acolo.
  - preia cererile prin RPC-uri dedicate, `SECURITY DEFINER`, care **scriu doar** în `ofertare_grafic_coada`, `ofertare_grafic_intrebari`, `grafic_versiuni` și `grafic_activitati` ale licitației cerute;
  - nu folosește `service_role` general. Autentificarea e cu secret intern (Vault, `x-intern-secret`, model `_shared/poartaIntern.ts`);
  - modelul de pornire și monitorizare e workerul NAS existent al cozilor Ofertare.
- **Fără `.ps1`/`.cmd` ad-hoc** (Bitdefender, CLAUDE.md pct. 11). Paw se cheamă doar prin `run_paw.cmd`. Dacă workerul are nevoie de alt mecanism de pornire, se cere în chat.
- Verifică doar **ultima linie** a log-ului Paw (`PAW_GATA` / `PAW_EROARE`) și nu lasă procese în urmă (regulile din 27.10).
- Jakarinos nu are web. Generatorul nu are web.

### 8.3 Fișa de securitate (CLAUDE.md pct. 7), de copiat în `registru_automatizari` + `public.automatizari`
- **(a) Conținut extern citit**: documentele licitației (caiet, fișă de date, PT, clarificări) și verdictul Paw.
- **(b) Ce scrie**:
  - doar graficul și întrebările licitației cerute, plus `ai_usage_log`;
  - nu trimite mailuri, nu atinge bani, drepturi sau alte licitații;
  - nu depune nimic în SEAP.
- **(c) Identitate**: RPC-uri `SECURITY DEFINER` înguste + secret intern, nu `service_role`. Paw = Codex read-only.
- **(d) Cine o pornește**: doar `fn_ofertare_poate_cheltui` (rol verificat în cod, nu doar JWT valid).
- **(e) Confirmare umană**:
  - răspunsurile la întrebări (datele noi, inclusiv normele validate, le introduce un om);
  - decizia de a depune graficul GO.
- (a) și (b) se ating, deci poarta de rol la pornire e obligatorie, iar ce scrie e limitat la licitația cerută.

## 9. Interfața (în „📅 Poarta grafic + Gantt”, licitație)

- Butonul **🤖 Generează automat**: vizibil tuturor, activ doar pentru cine trece poarta. Tooltip cu motivul când e inactiv.
- **Starea cererii** live: etapa, iterația, ultimul verdict, costul consumat.
- **Întrebări**: listă cu câmpuri de răspuns tipizate; „Trimite răspunsurile și reia”. Fiecare întrebare arată activitățile afectate și dacă e pe drumul critic.
- **Versiuni**: tabel cu versiune / iterație / verdict / nr. BLOCANTE-MAJORE / durată / dată finală / descărcare `.xml` + xlsx PERT. Neconformitățile se pot deschide.
- Versiunea GO se poate deschide în editorul existent (`grafic_activitati`) pentru ajustări manuale.
  - **Orice editare manuală o face o versiune nouă, neverificată**: trebuie retrimisă la Etapa 3 înainte să fie din nou GO.

## 10. Criterii de acceptare

1. **Reluarea Jilava (lic. 93)**:
   - pornit pe licitația 93, sistemul se oprește întâi cu întrebări. Cel puțin: termen livrare țeavă Ø914, norme sudură/sablare/izolare/săpătură manuală, echipe, articolele SUBCONTRACTANT_A, regim de iarnă;
   - după răspunsuri, ajunge la GO în ≤3 verificări Paw;
   - termenul ține cu sărbătorile incluse sau sistemul spune clar că nu se poate.
2. **Regresia verificatorului**: graficul depus la Jilava (`grafic_X.txt` din dovezi) trece prin Etapa 3 și primește NO-GO cu cele 5 constatări ale comisiei găsite. E test fix, rulat la orice schimbare de brief.
3. **Motorul**: teste vitest pentru:
   - sărbători, inclusiv Paștele ortodox și Rusaliile pe 2027–2030;
   - FS/SS/FF/SF cu lag negativ/pozitiv;
   - rezumate, cicluri, LS/LF pe rezumate;
   - verificările 6.3;
   - exportul MSPDI: calendar luni–vineri cu excepții, tipurile de legătură, resursa executant. Fișierul se deschide în MS Project, verificat o dată manual.
4. **Poarta**: un utilizator fără drept primește refuz la pornire. Workerul refuză o cerere al cărei `cerut_de` și-a pierdut dreptul între iterații.
5. **Nicio versiune GO cu `PRESUPUS`.** O schiță nu poate fi GO (test).

## 11. Testul din 24.11.2026 (dovezi)

Toate în [`grafic_automat_test_jilava/`](grafic_automat_test_jilava/). Nimic nu s-a scris în ERP.

| Ce | Rezultat |
|---|---|
| Graficul depus (REV 0, citit din `.mpp` cu `scripts/grafic/import_mpp.py --test-parsare`), 122 de poziții | — |
| Jakarinos pe graficul depus („Grafic X”, orb) | **NO-GO, încredere mare**; 19 neconformități (9 BLOCANTE), **5/5 constatări ale comisiei găsite**; 150 s |
| Generator AI (Claude, agent separat; a văzut doar documentele beneficiarului + cerințele ERP + F3; nu a văzut clarificările, respingerea sau graficul nostru), mod „schiță” | 161 de activități + 37 rezumate, 63 de zile lucrătoare, 02.11.2026–27.01.2027; 138 de durate PRESUPUS; **23 de întrebări** (7 blocante), inclusiv contradicții reale între documente (metoda CND la tub: F3 vs memoriu; momentul DCVG: CS vs PCC); ~15 min |
| Jakarinos pe graficul AI („Grafic Y”, orb) | **NO-GO, încredere mare**; 12 neconformități (3 BLOCANTE: calendar fără sărbători, articole grupate, lipsa desenelor); „succesiune principală corectă”, CPM recalculat și confirmat; 183 s |

**Concluzii pentru construcție**:
1. Ordinea tehnologică o poate face AI-ul.
2. Calendarul și exportul trebuie să fie cod.
3. Detalierea pe articol trebuie verificată de motor înainte de Paw.
4. Datele lipsă sunt reale și recurente (norme, livrări, echipe, subcontractanți), deci se salvează în ERP, nu în grafic.

## 12. Decizii

**Ale owner-ului (24.11.2026)**
- Cele trei etape: generator AI → motor → verificare Paw, în buclă până la GO sau întrebare pentru om.
- Lipsesc date → **se oprește și cere**, nu estimează.
- Graficul se face fără să depindă de un om. Omul doar răspunde la întrebările de date și depune.
- **Normele introduse ca răspuns** le pot valida (`incredere='validat'`, folosite la toate licitațiile viitoare) **owner-ul sau responsabilul 1/2 al licitației** care trece `fn_ofertare_poate_cheltui`.
  - Se păstrează cine a validat și din ce licitație/întrebare (`validat_de`, sursa).
  - Owner-ul poate retrage o normă.
- **Cheie API Anthropic nouă, dedicată, pe serverul AI** (Gazpet-Claude), cu plafon lunar setat în consola Anthropic.
  - Numele cheii se trece în `registru_automatizari` și `public.automatizari`, niciodată valoarea.
- **Plafon de cost: 25 $ pe cerere**, cumulat peste pauze și iterații. Plafonul e configurabil.

**Propuse de Claude (de confirmat la review; constructorul nu le schimbă fără întrebare)**
- **D1**: generatorul rulează în workerul de pe serverul AI, nu în edge (durată ~15 min).
- **D2**: GO = verdict GO + zero BLOCANTE + verificările motorului. MAJORELE se afișează, dar nu blochează.
- **D3**: maximum 3 verificări Paw pe cerere, apoi întrebare pentru om.
- **D4**: v1 nu desenează diagramele în ERP. Se folosesc din MS Project pe `.xml`.
- **D5**: Copilot nu e în bucla automată, doar opțional pe versiunea finală.
- **D6**: sărbătorile ca listă în cod (cu Paștele ortodox calculat), nu tabel nou.
- **D7**: v1 doar pentru licitații (Ofertare). Proiectele în execuție rămân pe importul `.mpp`.

**Lămurite de Claude după verificarea constructorului (24.11.2026)**
- **C1**: verificatorul judecă conținutul, nu lipsa desenelor (§7).
- **C2**: pachetul verificatorului îl face workerul, determinist, din documentele întregi (§7).
- **C3**: o activitate acoperă cel mult un articol de deviz; referința sunt cantitățile validate (§6.3).
- **C4**: motorul e un modul nou; Execuție și PEHD rămân neschimbate (§6).
- **C5**: contorul de verificări se resetează la răspunsurile omului; costul se cumulează (§7).
- **C6**: generatorul e un agent cu unelte (citește documentele pe bucăți, cere cerințele, scrie ieșirea structurată) prin API-ul Anthropic, rulat de workerul Node de pe serverul AI. Nu e un singur apel: documentele lic. 93 au ~1 mil. de caractere.

## 13. Ce rămâne la constructor
- Schema exactă a `ofertare_grafic_coada` / `ofertare_grafic_intrebari` și a RPC-urilor. **Schemă nouă = „da”-ul owner-ului** (CLAUDE.md pct. 3/4) + migrare cu revenire + gărzi, ca 20261124a.
- Schema JSON a ieșirii generatorului și promptul. Pornește de la `note_generator.md` și `cereri_date.md` din dovezi.
- Unde se înregistrează repartizarea pe subcontractant (azi nu există în ERP; vezi `ofertare_calibrari_subcontractori`).
- Parsarea verdictului Paw (format fix + test pe cele două verdicte din dovezi).
- Ordinea de livrare: motor + export (fără AI, util imediat și pentru motorul PEHD) → coadă + worker + generator → Paw → UI.
