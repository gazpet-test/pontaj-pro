# Incident egress Supabase: 1,6 TB pe 24–25.09.2026 (buclă internă Ofertare, oprită)

> **Stare (formularea Copilot, 30.09 ~01:30):** bucla dominantă de egress e **atribuită** prin dovezile raportate și **oprită** în intervalul observat (din 25.09, 16:10 UTC). **Prevenirea recidivei e incompletă.** Exploatarea externă e **nedemonstrată**, în limitele investigației. Incidentele de autorizare/confidențialitate sunt **OPEN**. Spend cap-ul (Q17) și măsurile de limitare a expunerii sunt **decizii explicite ale lui Răzvan**. Dauna financiară e deja înregistrată în ciclul 07.09–07.10.
> Investigația a fost read-only, pe 30.09, între 00:30 și 01:30 ora RO, în workflow-ul `wf_75059be4-023`. Au lucrat 3 unghiuri independente (loguri gateway/Storage; Storage + conturi; procese interne), plus o sinteză care a refăcut socoteala pe fiecare zi a ciclului. Nimic nu s-a modificat în producție.

## 1. Cifrele (reconciliate cu dashboard-ul)
| Interval (UTC) | Cached egress (Storage, cache HIT) | Ce e |
|---|---|---|
| 07.09–23.09 (17 zile) | 9,56 GB | trafic normal |
| **24.09** | **312,85 GB** | din care 310,04 GB = doc 770 (3.102 descărcări, între 14:05:55 și 23:59:58) |
| **25.09** | **1.292,93 GB** | din care 1.291,23 GB = doc 770 (12.919 descărcări) |
| 26–29.09 | 0,002 GB | după oprire |
| **Total** | **1.615,34 GB** | dashboard: 1.615,87 GB (diferență 0,03%) |

- **Fișierul:** doc **770**, licitația **101 (Huedin)**, `ofertare/101/atribuire/…HUEDIN_Lot_1_Studiu_geotehnic__Transgaz_Anexe.pdf`, **95 MB**, 714 pagini. A fost descărcat de **16.021 de ori** (1.601 GB), adică **99,1% din egress-ul ciclului**. Fără buclă, ciclul ar fi avut ~14 GB (5,6% din cotă).
- **Cine l-a descărcat:** jumătate **workerul de pe NAS Terra** (`Deno/2.9.7`, `service_role`, IP-ul biroului 84.232.142.x), jumătate **edge function `ofertare-ingest-doc`** (runtime Supabase, IP-uri AWS DE/CH).
- **Pe ore, 25.09 (UTC):**
  - 00h: 127 GB (vârful);
  - **02–05h: zero**, pentru că workerul a căzut;
  - 07–15h: 104–120 GB pe oră.

## 2. Mecanismul
1. Workerul ia doc 770 din coadă, **descarcă tot PDF-ul** (`worker/ofertare/ingest.ts:170`) și apelează `ofertare-ingest-doc`.
2. Funcția **îl descarcă din nou** (`supabase/functions/ofertare-ingest-doc/index.ts:204`), îl marchează `in_lucru` și **moare pe memorie**: **7.970 de răspunsuri `546 WORKER_RESOURCE_LIMIT`**.
3. Documentul rămâne în coadă, iar workerul îl reia la ~5–6 s, **fără limită de încercări salvată în BD** (contorul lui e doar în memorie). Un ciclu costă ~200 MB. Coada 101 a ajuns la **`lansari = 8235`**.
   - Tick-ul din cron are limita salvată: pe 25.09, între 01:49 și 01:53, a ajuns la `incercari = 4` și s-a oprit singur.
   - Workerul a reluat bucla când a repornit.
4. **Oprirea:**
   - **PR #478** (PDF-urile de peste 60 MB trec pe `ignorat`) a intrat pe main la 16:09:50 UTC; ultimul 546 e la 16:10:26.
   - Workerul a mai descărcat până la 17:33 UTC.
   - **PR #485** (citire pe felii pe NAS), 23:52 UTC: doc 770 a fost citit o singură dată și a rămas `partial`.

## 3. Ce NU a fost
- **Abuz extern: exclus pentru egress** (cifrele se închid). `service_role` apare doar din birou, din edge runtime și de pe funcțiile Vercel.
- **Signup-ul deschis nu a fost vectorul.** În **toate cele 24 de zile verificate în loguri (06.09–29.09, 22:40 UTC)**: **0 cereri** pe `/auth/v1/signup`. Proba de control a mers: pe aceleași zile, zeci–sute de cereri `/auth/v1/*` pe zi. `auth.audit_log_entries` e gol, deci auditul auth trăiește doar în loguri. `auth.users` are 31 de conturi; persoanele sunt identificabile, dar **„persoana e cunoscută” ≠ „privilegiul e justificat”** (§5). Limită: IP-ul și cheia `service_role` identifică un canal de execuție, nu persoana sau cererea inițială.
- **Scriptul din Logistică** (ipoteza lui Răzvan): nu. Acolo au fost doar actualizări de text. Nici scripturile de pe PC din 25.09 seara, care au citit planșe pe felii JPG, cu volum neglijabil.

## 4. Riscul să se repete (cod, NU se întâmplă acum)
1. Pentru PDF-urile **sub 60 MB** care trec pe citirea cu AI, edge-ul descarcă tot fișierul la fiecare apel, cu până la ~240 de apeluri pe document. Un scan de 55 MB poate costa ~13 GB „legitim”.
2. **Contoarele de încercări din worker stau în memorie** și se resetează la fiecare repornire (la fiecare commit pe main). Doar tick-ul și calea „PDF mare” au limită salvată în BD.
3. `candidati()` face 2 cereri REST pe document la fiecare iterație: ~282.000 între 12:00 și 21:00 UTC pe 24.09.
4. **`ofertare-ingest-doc` acceptă cheia publică (anon) cât timp o coadă e activă**, pentru tick-ul din cron. În fereastra aceea, oricine o poate folosi ca să pornească citiri AI plătite și descărcări de ~100 MB. **Asta e și o problemă de securitate.**
5. Alte fișiere mari care ar putea porni aceeași buclă: 102/ (8 × .rar de ~90 MB), 9/ (69–88 MB), 103/ (87 MB), 3/ (3 × 81 MB).
6. **Nu există nicio alertă pe egress**: am aflat din billing, după 4 zile.
   - Cu spend cap-ul OFF, o buclă la fel ar costa **~39 $/zi** (la ritmul din 25.09), până la ~92 $/zi la ritmul orei de vârf.
   - Nedetectată până la resetare: ~440 $.

## 5. Constatări de securitate găsite pe drum (separat de egress)
- **Tabele:** **298 din 370** sunt citibile de orice cont logat, iar **95** permit și scriere/ștergere. Printre ele:
  - `employees` (172 de rânduri, **149 cu IBAN**);
  - `profiles`, `user_module_access`, `pontaj_records`, `hr_*` (concedii, tokenuri, recrutare);
  - facturi, contracte, comenzi către furnizori, situații de plată;
  - `ofertare_*`, cu prețuri unitare și oferte de la furnizori.
- **Storage:**
  - **23 de bucket-uri** sunt deschise oricui e logat. 20 au conținut: 6.023 de obiecte, 5,07 GB (contracte, facturi, documente de proiect/flotă/firmă, rapoarte zilnice, autorizații…).
  - Pe mai multe bucket-uri, **orice cont poate scrie sau șterge**.
  - Sunt protejate corect: `ofertare`, documente-personal, pontaj, recrutare-cv, hr-semnaturi.
  - Niciun bucket nu e public.
- **`handle_new_user`** dă automat rolul **`manager_santier`** oricărui cont nou. Cu signup-ul pornit, un străin intra direct cu acest rol. **Signup-ul e acum OFF** (Răzvan, 30.09 ~00:35).
- **Efect secundar al signup OFF:** butonul „creare manager” din ERP (`src/App.jsx:6650`, `supabase.auth.signUp` din browser) **nu mai merge**. Până la un PR, care îl mută pe o funcție de admin cu verificare de owner, conturile noi se fac din Dashboard.
- **Conturi de revizuit** (fiecare cu acordul lui Răzvan):
  - **`test.ofertare@…`** (`ofertare:editor`, activ) și `test.fara.modul@…`: conturi de test din 29.09;
  - `co***`: **superadmin neconfirmat**, fără niciun login;
  - un cont gmail fără login din 25.07;
  - `cl***`: `ofertare:admin` + `hr:editor`, fără `employee_id`;
  - `ap***`: o sesiune de pe 173.255.164.x (Voxility, hosting RO; natura conexiunii **nedeterminată**; 58 de cereri pe 29.09, nimic descărcat). Un IP de hosting nu dovedește nici atac, nici legitimitate.
- **Chei:** egress-ul atribuit buclei **nu impune singur** rotirea, dar nici nu justifică verdictul general „rotirea nu e necesară” (Copilot). Rămâne de verificat cine poate vedea comenzile cron (`authenticated` nu are acces la schema `cron`) și dacă secretele au ajuns în repo, loguri sau rezultate distribuite. Dacă au ajuns la actori neautorizați, rotirea intră în răspunsul aprobat. Separat, fără grabă:
  - 9 din 51 de joburi cron au chei scrise în text → de mutat în Vault;
  - workerul NAS e pe cheia legacy JWT → de trecut pe `sb_secret`.
- **Mărunte:**
  - un browser (86.125.155.x) a făcut 45.349 de cereri REST în 8 ore pe 29.09, mai ales pe `tichete`: un UI care interoghează prea des;
  - crawler-ul Facebook a deschis 4 linkuri semnate din `rapoarte-zilnice` (1,8 MB). Linkurile trimise pe chat ar trebui să expire mai repede.

## 6. Măsuri propuse (NIMIC aplicat; decide Răzvan; tot ce atinge Ofertare vine după depunerea Jilava)
| # | Măsură | Efect |
|---|---|---|
| 1 | **Spend cap OFF înainte de 03.10** (ideal până pe 01.10), apoi verifici „Upcoming Invoice” | evită restricția: 402 pe API, baza doar în citire sau proiect pe pauză, posibil pe toată organizația. Cost: 1.365,87 GB × 0,03 $ = **40,98 $**. După grație, la următoarea depășire restricția vine imediat |
| 2 | Tichet la suportul Supabase pentru credit (bug unic, reparat pe 25.09, cu dovezile de aici) | poate recupera ~41 $; nu e garantat |
| 3 | Alertă de egress în rutina zilnică existentă (`query_logs`: >20 GB/24 h sau >50 de descărcări pe oră ale aceluiași fișier) | plasa de siguranță cât cap-ul e oprit (fișa pct. 7 + GO) |
| 4 | PR pe worker + edge: contor de încercări **în BD** pe document și pe calea AI; edge-ul să nu redescarce tot fișierul pe fiecare felie; `candidati()` fără 2 cereri pe document la fiecare iterație; intrarea cu cheia anon înlocuită cu un secret din Vault | închide repetarea buclei și calea anon |
| 5 | `handle_new_user`: rol implicit fără drepturi, în loc de `manager_santier` | un cont nou nu mai primește nimic din oficiu |
| 6 | Politici RLS și Storage pe module (ca `fn_are_acces_ofertare`). Prioritar: `employees` (IBAN), `hr_*`, facturi/contracte, prețurile Ofertare, bucket-urile cu scriere/ștergere deschisă | proiect separat, cu preview → confirmare → apply |
| 7 | Butonul „creare manager” mutat pe o funcție de admin cu verificare de owner | ERP-ul poate face iar conturi, fără signup public |
| 8 | Spend cap pornit la loc după 07.10, **după** ce există alerta (3) și contorul în BD (4) | protecție pe ciclurile viitoare |

## 7. De decis (după comisie)
- **Q17 — spend cap, înainte de 03.10.** Comisia recomandă **A condiționat + C în paralel**. B nu e recomandat ca implicit: restricția de pe 03–07.10 se suprapune cu o posibilă depunere Jilava pe 06.10. Datele exacte și serviciile afectate se confirmă în cont.
  - **A**: îl oprești, cu trei condiții (Copilot):
    1. **autorizare financiară delimitată**: ~41 $ pentru consumul existent, separat de un buget explicit pentru consum nou. „41 $” nu e plafon tehnic și nici factura garantată;
    2. **recidiva limitată ÎNAINTE de a scoate protecția**: se documentează cum rămân oprite sau strict controlate ingestia grea și sursele care o pot porni. „Coada e goală acum” nu ajunge. Orice oprire de worker/job sau patch are aprobare separată;
    3. **verificare după schimbare**: starea setării, perioada, toate liniile din Usage/Upcoming Invoice, plus un test read-only că ERP-ul merge.
  - **C**: cerere comercială de credit, cu „da”-ul tău pentru contactul extern și dovezi fără secrete. **NU** e prezentată ca „bug unic reparat”, pentru că riscul de recidivă e încă în cod.
  - Decizia de continuitate nu așteaptă nici analizele, nici suportul.
- **Ordinea prevenției** (Copilot + Jakarinos). E condiție pentru **reluarea ingestiei**, nu pentru ținerea spend cap-ului oprit:
  1. închiderea căii anon pe `ofertare-ingest-doc`: PR de securitate separat; înainte de depunere cere excepție la freeze;
  2. control persistent comun (worker, cron, edge): încercare + buget rezervate atomic înainte de GET/AI, revendicare exclusivă cu expirare, stare „blocat” la eșec de resurse; un 546 nu mai trece drept succes;
  3. detectare și oprire controlată (praguri aprobate);
  4. o singură descărcare pe versiune de conținut, iar edge-ul primește felia. Optimizarea `candidati()` intră în PR separat.

  Înainte de reluare, testele acoperă restart, eșec de resurse, 2 procese concurente, buget epuizat, expirarea revendicării și cererea neautorizată, fără AI plătit.
- **Securitatea (§5) e o extindere de domeniu a incidentului OPEN, cu prioritate azi dimineață:**
  - matricea de acces (profiles, user_module_access, personal, tokenuri, scriere/ștergere Storage);
  - revizuirea conturilor și sesiunilor, cu preview și decizia ta;
  - patch-uri separate: Ofertare / RSVTI + jurnal / stoc / **RLS citire + Storage** / TRUNCATE.

  Citirea neautorizată de date sensibile **nu** se amână automat după Jilava.
- Conturile din §5: da/nu pe fiecare.

## 8. Ce mai lipsește pentru închiderea dosarului (Copilot)
- Reconcilierea contoarelor: 7.970 × 2 = 15.940 față de 16.021 de descărcări (81 neclasificate), plus cele 8.235 de „lansări”. Nu se forțează egalitatea.
- Unitățile în bytes și versiunea obiectului servit (99,93 MB zecimali ≈ 95,30 MiB per descărcare).
- Mesajul diagnostic real din spatele `WORKER_RESOURCE_LIMIT` (memorie sau altă limită). Legarea opririi de versiunea edge și de revizia workerului **efectiv rulate**, nu doar de ora merge-ului.
- Corelarea cererilor de intrare cu joburile și transferurile (apelant → backend → Storage).
- Dosarul reproductibil al probelor: interogări, ferestre UTC, filtre, ID-uri de cereri, versiuni. Acces controlat, fără tokenuri sau URL-uri semnate. Reziduul de 0,53 GB consemnat.
- Celelalte linii de cost (apeluri AI, uncached egress).
- **Integritatea dosarului Huedin:** doc 770 e `partial` (499 de pagini fără text), iar `ignorat`/`partial` ≠ extras/verificat. De verificat ce rezultate au folosit 770 și celelalte fișiere mari, fără un fals verde.
- ✅ Acoperirea temporală a signup-ului: făcută 30.09, ~01:50. Pe 06.09–29.09: 0 cereri (§3).

## 9. Comisia PowPatroll (30.09, 01:00–01:40 RO)

Comisia a fost cerută de Răzvan: „dauna e făcută, vedem cum o reparăm și cum o evităm”. Părerile au fost date independent. Niciunul nu a văzut concluziile celorlalți înainte să răspundă.

| Membru | Ce a primit | Verdict |
|---|---|---|
| **Jakarinos** (Codex, read-only: cod + istoric git, fără BD) | faptele din billing + pistele, fără cauza găsită în loguri | **A ajuns singur la aceeași cauză.** Pe `8a6fbbb` (25.09), `ingest.ts` descarcă PDF-ul integral, iar fallback-ul AI îl descarcă din nou în edge. **Răspunsul `546 {code,message}` fără câmpul `error` e interpretat ca succes** (`ingest.ts:83,90`), deci documentul rămâne candidat și bucla îl reia. Limita „15 documente / 15 minute” cedează doar când există altă coadă activă. Calculul lui: 8.234 × 2 × 99,9 MB ≈ **1.646 GB**, față de 1.616 GB facturați. Reparațiile au intrat în edge în `1523f06` (25.09 19:09 RO) și în worker în `3069000` (26.09 02:52 RO), în acord cu logurile. Recitirea planșelor și auditul de hash **nu** pot explica volumul (25 de runde × 4 zone = maximum 100 de JPG, nu 100 de PDF-uri). |
| **Miloi** (Gemini) | același brief | **Indisponibil.** Prima rulare: comandă refuzată în modul headless. A doua: **cota Google e epuizată** („Individual quota reached”, se resetează în ~142 h, adică **~06.10 seara**). Până atunci Miloi nu poate primi sarcini. |
| **Copilot** | faptele complete + securitatea + opțiunile Q17 | **GO** pe atribuirea egress-ului buclei interne 770. **NO-GO** pe „remediat complet” și pe reluarea ingestiei în configurația actuală. **Q17: A condiționat + C în paralel.** Securitatea din §5 = extindere a incidentului OPEN, cu prioritate azi. Text integral: `INCIDENT_EGRESS_VERDICT_COPILOT_2026-09-30.md` |

**Prevenția propusă de Jakarinos**, ordonată după efect/cost; toate după GO și după depunerea Jilava:
1. **Oprire persistentă la lipsa de progres**, cu limită între ture și reporniri în `worker/ofertare/ingest.ts`. Un 546 nu mai trece ca succes. În `src/OfertareLicitatii.jsx` dispare retry-ul la 5 s după un răspuns neclar. Starea rămâne „necitit/eroare”, niciodată succes implicit.
2. **Cache local + deduplicarea descărcărilor simultane**, cu cheie pe obiect și versiune/hash verificat și cotă de disc. Cache-ul nu înlocuiește verificarea integrității.
3. **Buget de bytes și de încercări pe job, rezervat ÎNAINTE de GET**, contorizat și la eșec. Reluarea se face explicit, fără reset automat.
4. **Reutilizarea tăierii în felii**, identificată prin hash sursă + parametri + versiunea algoritmului. Auditul deduplică pe obiect în aceeași rulare și face backoff persistent.
5. **Monitorizare independentă de AI:** bytes, obiect, job, încercare, cu alertă la depășirea bugetului. Fără tokenuri și fără URL-uri semnate în loguri.

Jakarinos mai notează că **plafonul de 35 MiB din `ofertare-garantie-mail` se verifică DUPĂ descărcare**, deci nu limitează traficul.
