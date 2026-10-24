# E4 — Montajul: tableta inginerului de izometrie, cu salvare (design r7, pentru review ÎNAINTE de cod)

**Stare**: r7 (review Jakarinos pe r6: NO-GO, 0 P0, 1 P1 nou — rândurile `legare` la aprobarea Transgaz; P1 + P2 din r5 închise. Prima trecere pe r7: P1 din r6 închis, 1 P1 nou — pachetul de cuplare —, reparat tot în r7; pe r5: NO-GO, 1 P1, 1 P2; r4 închis integral; pe r4: NO-GO, 3 P1, 1 P2; pe r3: NO-GO, 7 P1; pe r2: NO-GO, 11 P1). Fără cod, fără nicio scriere în BD (doar SELECT-uri de catalog și numărători, 21.10.2026). Branch `izometrie/e4-design`, din `origin/izometrie/e3` (#825, încă deschis; `20261103b` neaplicată). La merge-ul #825 se face retarget pe `main` înainte de ștergerea branch-ului de bază (anti-bug #1785).

**r2 (21.10.2026)** — răspunsul la review-ul Jakarinos pe r1 (2 P0, 8 P1, 3 P2):
- **P0** corecția de lungime e permisă doar pe o rădăcină fără descendenți; în arbore e refuzată explicit (§8.6). Tăierea unei bucăți montate are trei ramuri separate, cu ambele capete reconciliate, iar o bucată legată de pachet se dezleagă întâi (§8.5);
- **P1** rezervarea ține și copiii declarați, iar aprobarea evaluează pe efectele simulate, în ordine topologică (§3.2, §6.3). Mașina de stări e completă: rândul aprobat e final, invalidarea descendenților, expirarea frontului, revocarea, oprirea fluxului, limitele (§6.4, §6.7);
- **P1** jurnalul rămâne doar-adaug: un singur INSERT, la final, iar erorile se scriu după rollback-ul savepoint-ului (§5.4). Hash-ul cererii e separat de amprenta preview-ului (§5.6). Identitatea e fixată pe lot și pe angajat (§5.7, §6.3);
- **P1** lock-urile se iau o dată pe lot, în ordinea globală, iar picker-ul nu mai urcă de la FOR SHARE la UPDATE (§5.4, §7.3, §10.5). Matricea de securitate e completă, cu GPS-ul scos din JSON (§9.4, §9.5). Activarea pe tronson verifică OLD și NEW (§7.4);
- **P2** CAS-ul din `actualizeazaRandInPachet` e descris corect (§7.3); Q-E4-13 B / C cer fișa de automatizare (§12); testele noi (§11, 13–16).

**r7 (22.10.2026)** — răspunsul la review-ul Jakarinos pe r6 (închise de Jak: P1 + P2 din r5; 1 P1 nou):
- **cuplarea nu mai blochează aprobarea Transgaz**: „rând legat” e definit pe tipul rândului. `teava` / `curba` = legat de o bucată (`executie_teava_id`), ca până acum; `legare` = legat de sudura lui de cuplare, identificată din `sudura_cod`, fără coloană nouă. Verificarea `legare` (sudura găsită pe tronsonul pachetului, `cuplare` + `aprobata`, cele două capete active pe bucăți `montata` ale tronsonului, unicitatea, proiecția) rulează la `completeaza` și la aprobarea Transgaz; verificarea pe bucată se aplică doar rândurilor `teava` / `curba`. Lock-ul pe sudura de cuplare e după bucăți, în ordinea globală (§3.4, §4.2, §7.1, §7.2, §7.3, §7.4, §7.5, §10.4, §10.5, testul 22).
- **review r7** (Jak: P1 din r6 închis, 1 P1 nou): capetele cuplării nu mai trebuie să fie pe piese din același pachet. **Pachetul de cuplare** (doar rândul `legare`) e valid, ca o cuplare între două lanțuri deja în pachete aprobate (P1 / P2) să intre într-un pachet nou, fără să atingă P1 / P2. Suprapunerea la `completeaza` se judecă pe ce adaugă apelul, nu pe numerele sudurilor (§7.2, §7.3 pasul 4, testul 22).

**r6 (21.10.2026)** — răspunsul la review-ul Jakarinos pe r5 (închise de Jak: toate cele 3 P1 + P2 din r4; 1 P1 nou, 1 P2):
- **pachetul aprobat nu se mai schimbă**: scriitorii structurali (`completeaza`, `leaga`, `dezleaga`) cer pachetul editabil (`status` inițial, fără aprobare), revalidat sub lock-ul pachetului; aprobarea Transgaz are CAS pe `updated_at`, iar orice scriere structurală mută `updated_at` pe antet. Cursa `completeaza` ↔ `aprobare_transgaz` e serializată pe pachet, în ambele ordini (§4.2, §5.6, §7.2, §7.3, §7.4, testul 21);
- **P2**: motivele stării `conflict` sunt o listă închisă (`r1d`, `corectie_in_arbore`), folosită de CHECK, de trigger-ul de stări și de toate rândurile tabelului din §6.4 (§3.2, §6.4, testul 21).

**r5 (21.10.2026)** — răspunsul la review-ul Jakarinos pe r4 (închise de Jak: r3 #2 PV-ul, #3 contorul, #6 ACK-ul, #7 activarea; 3 P1, 1 P2):
- **reconcilierea** acceptă lanțul complet: R (pe `bucata_decl_uid`) → `transferata` → R′ (pe `bucata_id`, `transfer_din_id` = R) → `consumata` de consumatorul din același lot, cu evenimentul lui. R nu e niciodată „consumată de consumator” (§3.2, §6.3 pașii 8–10, testul 13);
- **seria lămurită de MP**: `izo_montaj_writer` primește UPDATE și pe `identificare`; trigger-ul de stări îi permite `bucata_id` / `identificare` doar în tranziția `in_verificare` → `trimisa` / `conflict`, `nerezolvata` → `bucata`, sub contextul `fn_izo_serie_lamureste` (§6.4, §9.4, testul 20);
- **`conflict` are toate tranzițiile**: `conflict` → `blocata` la invalidarea dependenței (ștergere, revizie, respingere), `conflict` → `respinsa` de MP într-o sesiune trimisă; decizia de cascadă e definită pe fiecare stare deschisă; o sesiune rămasă fără rânduri deschise după o decizie a MP-ului se închide, oricare ar fi starea ei (§6.4, testul 20);
- **P2**: R1 (d) găsit pe server = **rezultatul** `acceptat` + **starea** `conflict` (`conflict_cod = r1d`), nu rezultatul `conflict` (§5.4, §5.5, §5.8, §8.3, §8.6).

**r4 (21.10.2026)** — răspunsul la review-ul Jakarinos pe r3 (închise de Jak: r2 #2, #3, #4, #6, #8, #9, #10; 7 P1):
- **transferul** acoperă **orice** consumator al copilului (și o tăiere ulterioară care îl are ca sursă); invariantul „nicio rezervare activă pe uid-ul unui copil născut” e verificat la reconciliere (§3.2, §6.3);
- **PV-ul** are cale de citire: helper-ul `fn_izo_pv_lipsa` (owner `postgres`), fără drepturi noi pe tabelele E3 (§10.6, §9.4);
- **intrarea**: izolarea → schema → identitatea → filtrele ieftine (rolul, contorul) → poarta; nicio scriere înaintea lock-ului schemei (§5.4 pasul 0, §10.1);
- **seria necunoscută**: `identificare` separată de stare; ciorna poate fi nerezolvată, `in_verificare` vine la trimitere (§3.2, §6.4);
- **invalidarea**: închiderea tranzitivă a descendenților, în orice stare deschisă, intră în lock-urile oricărei operații care invalidează (teren și birou); tranzițiile spre `conflict` la revalidarea R1 sunt în tabel (§5.4, §6.4);
- **ACK-ul**: `duplicat` e terminal pentru coadă (repetă rezultatul salvat); `conflict_op` trece în lista locală „de verificat” (§5.3, §5.4);
- **activarea** are ramura administrativă (`session_user = postgres`), separată de verificatorul API (§10.1);
- **P2**: testul de pachet aliniat (notele doar prin RPC); revocarea dă `fara_drept`, nu `duplicat` (§5.5); Q-E4-15 C cere Q-E4-10 B; testele 19.

**r3 (21.10.2026)** — răspunsul la review-ul Jakarinos pe r2 (închise de Jak: P0-1, P0-2, P1-3, P1-4, P1-5, P1-8; 11 P1 noi sau rămase):
- **rezervarea copilului** nu mai dispare între aprobări: la aprobarea tăierii se **transferă** pe `bucata_id`, în același eveniment (§3.2, §6.3);
- **expirarea leneșă** nu mai scrie declarația altui autor: rezervarea veche devine `expirata` sub lock-ul rădăcinii, iar declarația veche rămâne neatinsă. Pierderea rezervării e o condiție derivată (`rezervare_pierduta`), nu o tranziție: oprește trimiterea și aprobarea (§5.4, §6.1, §6.4, §6.7);
- **revocarea și abandonul**: MP-ul respinge, cu motiv, rândurile unei sesiuni abandonate (frontul inactiv sau autorul fără drept), apoi sesiunea se închide. Oprirea fluxului nu mai poate rămâne blocată (§6.4, §6.7);
- **corecția + tăierea**: copiii declarați de aceeași declarație nu contează ca descendenți (§8.6);
- **ACL / API**: activarea cere rândul de config existent; lock-urile pe tabele fără UPDATE trec prin helpere `postgres`; drepturile pe coloanele deblocării; `p_cheie` pe revizie și pe seria lămurită (§3.1, §4.2, §9.4);
- **GPS-ul**: `hash_cerere` nu se poate citi din API (privilegii pe coloane), deci nu există verificator de coordonate (§9.4, §9.5);
- **costul**: o pre-verificare ieftină și un contor de apeluri, **înaintea** porții (§5.4 pasul 0.4);
- **`alt_dispozitiv`** devine nefinal: operația rămâne în coadă, iar încercarea se vede la MP (`izo_sync_incercari`). După ce frontul revine, se aplică normal (§5.4, §6.7);
- **laptopul** = un dispozitiv al inginerului, cu frontul predat de tabletă; MP-ul nu declară (§8.5);
- **pachetul**: pe tronsoanele în flux, clientul nu mai scrie deloc `executie_tevi`. Cascada `tg_tevi_update_totaluri` (rând → pachet, ✓BD 21.10) ar inversa ordinea, așa că observațiile și codurile NDT trec printr-un RPC (§7.3, §7.4);
- **READ COMMITTED** impus la fiecare intrare, ca în E3 r5f (§10.1);
- **P2**: `expira_dupa` în schemă; numerotarea descrescătoare; RLS-ul real pe `executie_tevi` (§1.1 #15); Q-E4-10 fără comparație GPS–km; Q-E4-12 și Q-E4-15 blochează codul; testele 17–18 (§11).

**Surse**:
- deciziile owner-ului din `claude_context`: #1788 (Q1–Q10), #1789 (tableta, oamenii), #1811 (conturile Titi / Viciu), #1817 (fără versiune „doar citire”: se așteaptă tableta completă, cu salvare, după E3 și E4);
- design v2.3 (`C:\Users\Public\claude-server\IZOMETRIE_DESIGN_v2.md`): §1.5–§1.8, §1.14, §2.4–§2.9, §3, §4, §5, §6 (E4a / E4b);
- prototipul static `proto/izometrie-tableta` (`public/proto/izometrie-tableta.html`, v4, #802, date fictive, NU se face merge);
- registrul E2a (`20261102a`), căile vechi (`20261102c`, #823, cu contractul de lock pentru E4a), E3 (`E3_CONFIRMA_DESIGN.md` r5e: tiparul de securitate), picker-ul din #824 (`src/Izometrie.jsx`, `src/lib/izoRegistru.js`), normalizatorul `src/lib/izoSudura.js`, `src/lib/izoKml.js`.

**Faptele live citite pe 21.10.2026 (✓BD 21.10, doar citire)**:
- proiectul 3 (LOT 2) e la nivelul `stoc`; registrul are 3352 de bucăți: 1884 `receptionat`, 1466 `pe_tronson`, 2 `carantina`; niciuna legată de `executie_tevi`;
- T14 (id 18) și T15 (id 19), pilotul: 0 bucăți `pe_tronson`, 0 pachete. Proiectul 3 are un singur pachet, pe T12;
- `izo_atribuiri` pe proiectul 3: TITI JENO (emp 115) și VICIU MARIUS ALEXANDRU (emp 177) `inginer_izometrie`; TOMA RAZVAN ALIN (emp 117) `manager_aprobator`; CIOC JANETA (emp 30) `gestionar` pe depozitele 9, 10, 11. Nu există `inlocuitor_aprobator`;
- `app_modules` are doar `executie`, fără sub-chei (cheia `executie.izometrie` din v2.3 nu există);
- `coordonator_transgaz` pe proiectul 3 = „Adrian Somesan” (corectat);
- trigger-ele existente pe `executie_tevi` / pachete sunt DEFINER, owner `postgres` (în afară de `touch`);
- `profiles.employee_id` are index unic; 7 profiluri n-au angajat, dar ambii owneri și toate atribuirile `izo_atribuiri` active au angajat (✓BD 21.10, r2).

**Ce cere „da”-ul lui Razvan**:
- schema: două migrări, cu rolurile noi;
- datele reale: cheia de modul, configurarea și activarea fluxului pe T14 / T15;
- drepturile: accesul pe modul pentru oameni.

Nimic din document nu se aplică fără „da”.

---

## 0. Pe scurt

1. **Pe tabletă**, inginerul (Titi Jeno sau Viciu Alexandru) lucrează pe un tronson în flux (pilot T14 / T15):
   - alege tronsonul și primește sudura propusă (`TR14S7`, fără zerouri);
   - tastează seria; apar șarja, lungimea și **peretele** (7,1 / 8,8), mare și colorat;
   - **confirmă lungimea separat**;
   - la „Țeavă tăiată” scrie cât a montat; restul pleacă în depozit.

   GPS-ul se citește doar la salvarea unei declarații.
2. **Salvarea și sincronizarea.** Fiecare salvare intră într-o coadă durabilă pe tabletă și pleacă la server. Serverul o acceptă ca **declarație**, nu ca fapt: rezervă bucata, deci **disponibilul scade la sincronizare** (Q2 A), și rezervă literele tăierii.
3. **Trimiterea.** Sesiunea zilei se trimite MP-ului. O serie „în verificare” nu oprește trimiterea (#1789).
4. **Aprobarea.** MP-ul (Toma Razvan Alin) aprobă pe identificarea inginerului. Abia atunci intră faptele în registru: tăierea, montajul și sudurile, fiecare cu 2 capete. **Stocul oficial scade la aprobare.** Nimeni nu-și aprobă propriile rânduri (Q8).
5. **Depozitul.** Resturile se nasc „în drum spre depozit”, iar Cioc Janeta le primește. Ieșirea din depozit pe tronson (aviz CJPT / CJPJ) o înregistrează tot ea, în ERP (Q-E4-2 A).
6. **Fișa de tăiere.** Pentru fiecare țeavă tăiată, fișa se printează din platformă, o semnează MP-ul și dirigintele Transgaz, iar scanul încărcat o face „aprobată” (E5). Până atunci pachetul nu pleacă la Transgaz. E4 dă datele și lista „fișe de generat”.
7. **Pachetul de lansare.** Pe tronsoanele în flux, rândurile `executie_tevi` le scrie doar serverul, din montajele aprobate. Picker-ul din #824 devine legătura reală (`magazie_bucati.executie_teava_id`), printr-o funcție de server, cu contractul de lock din #823.
8. **Securitatea** copiază E3: doi scriitori noi (tableta / registrul), contextul operației, poarta completă sub lock-ul schemei, proiecții exacte și o singură ordine de lock-uri.
9. **De decis**: 16 întrebări (§12). Țin codul Q-E4-1 (fluxul pe tronson), Q-E4-2 (ieșirea din depozit), Q-E4-4 (offline), Q-E4-5 (pachetul), Q-E4-12 (ramurile tăierii) și Q-E4-15 (coordonatele GPS). Q-E4-6, Q-E4-9, Q-E4-10 și Q-E4-14 schimbă contractele (PV-ul, cheia de modul, GPS-ul, frontul), deci se fixează tot înainte de cod. Corpul documentului e scris pe recomandări; ele **nu** sunt decizii aprobate până nu răspunde Razvan.

## 1. Ce face E4 și ce nu

E4 = E4a + E4b din v2.3, adaptate la ce s-a construit efectiv în E2a, 2c și E3.

**Face:**
- **E4a** (`20261104a_izometrie_e4a_flux`):
  - activarea fluxului de montaj **pe tronson** (Q-E4-1 A);
  - porțile pe tronsoanele în flux: căile 1, 4, 5, 7, 8, 18, 21 din v2.3 §5.4;
  - varianta minimă `fn_izo_pachet_aprobare_transgaz`.
- **E4b** (`20261104b_izometrie_e4b_teren`):
  - tabelele tabletei și sincronizarea idempotentă;
  - aprobarea MP-ului;
  - ieșirea pe tronson și primirea în depozit;
  - sudurile cu capete;
  - legătura cu pachetul;
  - UI: tableta, ecranul de aprobare, ecranele gestionarului, picker-ul.

**Nu face:**
- E4c (montajul istoric pe T12–T13, T16–T19);
- E5 (circuitul fișei de tăiere: generatorul, stările, scanul), E5b (exportul rapid), E8 (emiterea pachetului), E10 (NDT);
- E6: shell-ul offline separat (`/teren`, SW cu precache, pornire fără rețea);
- jobul zilnic de alerte (cron), OCR-ul, deșeul declarat;
- robinetele (elementele fără stoc), vezi Q-E4-12;
- importul REPLACE atomic, promis de 2c pentru E4a (Q-E4-11).

### 1.1 Discrepanțe găsite (de știut înainte de review)

| # | Unde | Ce | Ce propun |
|---|---|---|---|
| 1 | prototip | codul sudurii cu zerouri (`TR13S041`, `pad3`) | fără zerouri: `TR13S41`, `TR13S48` (Q5 A; `formatSudura`, pad 0) |
| 2 | prototip | restul sub 0,50 m: „depozit sau deșeu” | tot la depozit (Q3 B): sub prag devine `rest_nereutilizabil`; fără deșeu pe tabletă în E4 (Q-E4-7) |
| 3 | prototip | bucăți identice: „Salvează · decide MP” trece la trimitere | Q1 B: blochează. Dacă ajunge totuși pe server, e doar declarație, cu R1 (d) deschis; MP-ul nu o poate aproba |
| 4 | prototip | stocul = depozitul („Stoc LOT 2 Jupânești”) | registrul: bucățile `pe_tronson` ale tronsonului + cele din depozit, cu ieșire (§3.3, Q-E4-2) |
| 5 | prototip v4 | confirmarea lungimii = cele 2 cifre de pe marcaj, apoi salvare automată cu „Desfă” | #1789: confirmarea separată, nu salvare la o atingere → Q-E4-3 |
| 6 | prototip | restul „în drum” folosit offline, „în verificare” | Q3 B: restul trece prin depozit și iese din nou. Calea se scoate |
| 7 | v2.3 față de E2 | v2.3: fără carantină; E2 a introdus `carantina` (decizia MP-ului, 21.10) | carantina = nedisponibilă la montaj |
| 8 | v2.3 față de BD | înlocuitorul lui Toma = „Alexandru Biciu”. În BD există VICIU MARIUS ALEXANDRU (emp 177), atribuit `inginer_izometrie` | Q-E4-8 |
| 9 | v2.3 | cheia `executie.izometrie` | nu există (✓BD 21.10) → Q-E4-9 |
| 10 | pilot | T14 / T15 au 0 bucăți `pe_tronson`, iar ieșirea din depozit (E2b) nu e construită | Q-E4-2 |
| 11 | E3 §8 | E4 refuză bucățile din documente E3 fără PV. D2#12: disponibilă de la confirmarea avizului | Q-E4-6 |
| 12 | 2c | la `montaj` pe proiect se refuză tot pe `executie_tevi`; pachetul de pe T12 e în lucru (regresia din 21.10) | fluxul pe tronson (Q-E4-1) |
| 13 | v2.3 | GPS pe axul KML calibrat. Axul și ancorele nu sunt în BD (`izo_surse_proiect` / `izo_ax_ancore` neconstruite) | Q-E4-10 |
| 14 | E3 | indexul `ux_magbuc_izo_aviz_rand` (o bucată vie per rând de aviz) | copiii unei tăieri NU copiază `aviz_intrare_id` / `nr_crt_aviz`; legătura cu avizul trece prin `radacina_id` |
| 15 | BD față de r2 | RLS-ul pe `executie_tevi` e larg: `executie_tevi_modify` (ALL, `auth.uid() IS NOT NULL`) și `executie_tevi_select` (`true`), ✓BD 21.10. 20261029a strânge doar pachetele, documentele și Storage-ul (`fn_executie_pachete_acces`) | pe tronsoanele în flux, bariera pe rânduri e trigger-ul E4 (§7.4), nu RLS-ul |
| 16 | BD | `tg_tevi_update_totaluri` (AFTER ROW, la orice UPDATE pe `executie_tevi`) face UPDATE pe pachet, ✓BD 21.10: o scriere din client pe un rând ia rândul, apoi pachetul | pe tronsoanele în flux, clientul nu mai scrie rânduri deloc (§7.4) |

## 2. Principiile (moștenite, aplicate la montaj)

1. **Declarația nu e fapt.**
   - Tableta trimite declarații. Serverul le acceptă: rezervarea fizică + literele tăierii.
   - Faptul intră în registru doar la aprobarea MP-ului.
   - Q2 A: disponibilul scade la acceptare, stocul oficial la aprobare.
2. **Registrul E2a rămâne doar-adaug.** Stările din `magazie_bucati` le scrie doar registrul.
3. **Un scriitor pe etapă**, ca în E3 (`izo_doc_editor` / `izo_receptie_writer`):
   - `izo_teren_editor`: tableta, fără niciun drept în registru;
   - `izo_montaj_writer`: faptele.

   `izo_registru_writer` nu e folosit de E4.
4. **Contextul operației** (GUC `izo.montaj_ctx`) se scrie după toate validările. Garda verifică fiecare rând scris față de efectul așteptat (proiecție exactă).
5. **Poarta completă** rulează la fiecare intrare, sub lock-ul schemei (`gazpet.livrare_migrare`, partajat).
6. **Un singur predicat de activare**, folosit peste tot: `coalesce(fn_izo_nivel(p), 'off') IN ('stoc', 'montaj') AND fn_izo_flux_tronson(t)`.
7. **Tableta nu ghicește**: nicio completare automată care alege o bucată, nicio corecție automată de serie sau de sudură. Tot ce verifică offline, serverul reverifică.

## 3. Modelul de date

### 3.1 Activarea pe tronson (E4a, Q-E4-1 A)

**`izo_tronson_config`**: scrie doar `postgres`, prin funcție. RLS activ; citirea prin `fn_izo_citire(proiect_id)`.
- `tronson_id` (PK → `executie_tronsoane`) și `proiect_id` (copie, verificată = proiectul tronsonului);
- `flux_montaj` bool (implicit false), `flux_de_la`, `flux_motiv`, `flux_schimbat_de`;
- `sens_numerotare` ∈ {`crescator`, `descrescator`} (pe IZO TR9 numerele scad); `nr_sudura_start` int: numărul primei suduri din IZO, obligatoriu la `descrescator` (CHECK), §3.5;
- `perete_proiectat` jsonb: zonele cu peretele cerut de proiect (pe interval de suduri sau de km), cu textul (de exemplu „subtraversare DN1A”). Alimentează avertizarea informativă din prototip (`ZONE_PERETE`); gol = fără avertizare;
- `executant_implicit` text (Gazpet; Petroconst pe T16 / T17, D#18): doar propunere pe sudură;
- `server_ver`.

**`fn_izo_seteaza_flux(p_tronson, p_activ, p_motiv)`**
- Owner `izo_montaj_writer`; EXECUTE doar `postgres`; cere `session_user = postgres`. O rulează sesiunea de chat, cu „da”. Intrarea ei e ramura administrativă din §10.1 (r4), nu verificatorul API.
- Pornirea cere:
  - **rândul `izo_tronson_config` existent** (r3): îl creează întâi `postgres`, cu „da” (sensul, zonele, executantul, §13 pasul 4). Funcția nu face INSERT; un rând lipsă → refuz `config_lipsa`. Deci `izo_montaj_writer` n-are nevoie de INSERT pe tabel (§9.4);
  - nivelul proiectului ≠ `off`;
  - porțile complete (E2a + E3 + E4);
  - tronsonul fără rânduri de pachet nelegate (r7: „legat” după tipul rândului, §7.1) și fără anteturi aprobate de Transgaz (r3, §7.4). T14 / T15 n-au pachete.
- **Oprirea** e refuzată (r2):
  - după primul fapt de montaj pe tronson, ca `stoc → off` în E2a;
  - și înainte de fapte, cât există pe tronson rezervări active, declarații deschise (stare ∉ {`aprobata`, `respinsa`, `stearsa`}) sau un front activ. Întâi se predă frontul și se închid declarațiile. Dacă autorul nu mai e disponibil (revocat, plecat), drumul e: MP-ul eliberează frontul, respinge rândurile sesiunii abandonate, iar sesiunea se închide (§6.4, §6.7). Deci oprirea nu rămâne blocată de un autor absent.
- **Concurența** (r2, §7.4, §10.5), în ordinea din `fn_izo_seteaza_nivel` (E2a): tabelele → advisory **exclusiv** (73010, proiect) → rândul `izo_tronson_config` FOR UPDATE (existent; lipsa lui = refuz) → precondițiile, citite pe starea comisă.
  - scriitorii registrului și ai pachetului citesc fluxul **după** advisory-ul partajat, fără lock pe rândul de config;
  - sincronizarea (fără advisory) ține config-ul FOR SHARE, prin helper-ul `fn_izo_config_blocheaza(p_tronson)` (owner `postgres`, EXECUTE doar `izo_teren_editor`): FOR SHARE cere UPDATE pe tabel, iar editorul n-are (§9.4);
  - o mutare din client îl citește după advisory-ul partajat (§7.4).

  Deci activarea așteaptă tot ce e în curs, iar ce vine după ea așteaptă commit-ul și vede fluxul nou (READ COMMITTED, ca în E2a).

`fn_izo_nivel(p) = 'montaj'` (proiectul întreg) rămâne rezervat pentru „toate tronsoanele în flux” (E8); E2a îl refuză în continuare.

### 3.2 Tableta (E4b)

**`izo_fronturi`**: un dispozitiv activ pe tronson (pilot, v2.3 §4.6).
- `id`, `proiect_id`, `tronson_id`, `profile_id`;
- `dispozitiv_id`: uuid generat de tabletă la primul „Pregătește”;
- `de_la`, `expira_la` (implicit +14 h), `predat_la`, `activ`, `eliberat_de` / `eliberat_motiv` (MP-ul, §6.7);
- UNIQUE (`tronson_id`) WHERE `activ`.
- `dispozitiv_id` coordonează frontul; **nu e o dovadă de identitate** (§5.7).

**`izo_operatii`**: jurnalul de idempotență, comun tabletei și ecranelor de birou.
- UNIQUE (`autor_profile_id`, `op_id`); `proiect_id` NOT NULL (RLS-ul, §9.4);
- `canal` ∈ {`teren`, `aprobare`, `depozit`, `pachet`}, `tip_op`;
- `dispozitiv_id`, `seq` (doar pe `teren`), `versiune_format`;
- `payload` jsonb canonic, **fără GPS** (coordonatele stau doar în `izo_declaratii_gps`, §9.5);
- `hash_cerere`: sha256, **calculat de server** pe forma canonică a cererii întregi (`versiune_format`, `tip_op`, `dispozitiv_id`, `proiect_id`, payload-ul cu tot cu GPS-ul), §5.6. **Nu se poate citi din API** (r3): `authenticated` are SELECT doar pe celelalte coloane, iar hash-ul nu apare în niciun răspuns sau vedere. Altfel, cererea cunoscută + hash-ul public ar fi un verificator offline pentru coordonatele GPS (§9.5);
- `rezultat` (doar cele finale, §5.4) ∈ {`acceptat`, `conflict`, `eroare`, `eroare_interna`}, `cod`, `mesaj`;
- `raspuns` jsonb: exact ce se întoarce la o retrimitere (fără GPS);
- `ora_tableta`, `ora_server`, `offset_ceas_s`;
- **doar adaug**: rândul se scrie o singură dată, cu rezultatul final (§5.4). UPDATE / DELETE / TRUNCATE sunt refuzate pentru toți, inclusiv `postgres` (trigger, ca în E2a);
- operațiile refuzate cu `alt_dispozitiv` **nu** se scriu aici (r3): rezultatul e nefinal, deci `op_id`-ul rămâne liber, iar operația rămâne în coada tabletei (§5.4, §6.7).

**`izo_sync_incercari`** (r3: „carantina de sincronizare” din v2.3, doar ca vedere a încercărilor):
- `id`, `proiect_id`, `tronson_id`, `autor_profile_id`, `op_id`, `dispozitiv_id`, `tip_op`, `payload` (fără GPS), `prima_la`;
- UNIQUE (`autor_profile_id`, `op_id`), scris cu `INSERT … ON CONFLICT DO NOTHING`: doar prima încercare, fără UPDATE. Doar adaug (trigger, ca la `izo_operatii`);
- `v_izo_carantina_sync` = încercările fără rând în `izo_operatii` cu același (autor, `op_id`): ce așteaptă frontul. MP-ul le vede și decide cui dă frontul (§6.7);
- volumul e mărginit de contorul de apeluri (§5.4 pasul 0.4) și de limita de operații pe lot.

**`izo_rata_apeluri`** (r3, contorul de apeluri, §5.4 pasul 0.4):
- PK (`profile_id`, `functie`), `fereastra_de_la`, `n`;
- îl scrie doar helper-ul `fn_izo_rata_consuma(p_functie)` (owner `postgres`, EXECUTE doar rolurile E4), cu `INSERT … ON CONFLICT DO UPDATE`; nimeni altcineva n-are drepturi pe el. Nu e jurnal de audit, deci UPDATE-ul e permis aici.

**`izo_preverificari`** (sesiunea: proiect, tronson, zi, autor):
- `id`, `uid` (generat de tabletă, UNIQUE), `proiect_id`, `tronson_id`, `zi` (Europe/Bucharest), `autor_profile_id`, `dispozitiv_id`;
- `stare` ∈ {`deschisa`, `trimisa`, `inchisa`}, `trimisa_la`, `trimisa_op_id`;
- `inchisa` vine fie după ultima aprobare / respingere, fie (r3) când MP-ul a respins toate rândurile rămase ale unei sesiuni `deschisa` abandonate (§6.4): o sesiune fără niciun rând deschis se închide în aceeași tranzacție;
- `versiune`: +1 la fiecare scriere;
- o singură sesiune `deschisa` per (tronson, autor): UNIQUE parțial.

**`izo_declaratii`** (rândul; în v2.3, `izo_preverificari_randuri`):
- **Identitatea**:
  - `id`, `uid` (generat de tabletă, UNIQUE), `preverificare_id`, `proiect_id`, `tronson_id`;
  - `tip` ∈ {`montaj`, `taiere`, `cuplare`};
  - `versiune` (≥ 1), `declarat_de` (profilul = `auth.uid()` al lotului), `declarat_de_angajat` (`profiles.employee_id`, NOT NULL, copiat la acceptare), `dispozitiv_id`, `ultimul_op_id`.
- **Starea**: `stare` ∈ {`ciorna` (sesiune deschisă), `trimisa`, `in_verificare`, `conflict`, `blocata`, `revizie_ceruta`, `aprobata`, `respinsa`, `stearsa`}. Tranzițiile permise sunt doar cele din §6.4 (trigger pe rol + stare).
  - `conflict_cod` ∈ {`r1d`, `corectie_in_arbore`} (r6: lista închisă din §6.4); pierderea rezervării nu e o stare, ci o condiție derivată (§5.4);
  - `stare_inainte_blocare` + `blocata_motiv` (r3): starea în care revine rândul la deblocare (§6.4). NULL când rândul nu e `blocata` (CHECK).
- **Montaj**:
  - piesa: `bucata_id` | `bucata_decl_uid` (copilul unei tăieri) | niciuna (`identificare = 'nerezolvata'`, seria în verificare);
  - `capat_amonte`: litera capătului care se sudează amonte (implicit prima);
  - legătura amonte: `amonte_tip` ∈ {`bucata`, `decl`, `inceput_lant`}, `amonte_ref`, `amonte_capat`;
  - `sudura_nr`, `sudura_sufix`: sudura amonte, cu capetele (amonte, piesă);
  - `lungime_montata_mm`;
  - **confirmarea lungimii**: `lungime_confirmata_mod` ∈ {`marcaj`, `marcaj_diferit`, `masurat`, `taiata`}, `lungime_confirmata_cm` (cele 2 cifre tastate de pe marcaj), `lungime_masurata_mm`, `lungime_confirmata_la` (ora tabletei);
  - `depinde_de_uid` + `depinde_de_versiune`: tăierea din care vine piesa, la versiunea pe care s-a sprijinit (§6.4, invalidarea).
- **În verificare** (D2#2):
  - `serie_bruta`;
  - `sarja_declarata` (sau `nu_se_vede`);
  - `perete_declarat`: 7,1 / 8,8 / necunoscut;
  - `lungime_masurata_mm`;
  - `ultimele3_reconfirmate`.
- **Tăiere**:
  - sursa: `sursa_bucata_id` | `sursa_decl_uid`;
  - `puncte_mm` int[]: 1–2 puncte, măsurate de la capătul A;
  - `baza_mm`: lungimea pe care s-a tăiat (din stoc sau, la corecție, de pe marcaj);
  - copiii stau în `izo_bucati_declarate`.
- **Cuplare**:
  - cele două capete de lanț (`capat1_*`, `capat2_*`);
  - `sudura_nr`, `sudura_sufix`;
  - opțional `depinde_de_uid`: tăierea țevii cu capătul liber.
- **Câmpuri comune**:
  - GPS-ul (citit doar la salvare, D2#15) **nu stă în declarație și nici în JSON-uri**: e în tabelul separat `izo_declaratii_gps` (§9.5). Pe declarație rămâne doar `gps_prezent` bool;
  - `km_propus_m`, `ora_tableta_creat` / `ora_tableta_modif`;
  - `executant`, `poanson`;
  - `data_montaj`: cel mult azi și cel puțin data ieșirii pe tronson.
- **Decizia**: `aprobare_id`, `aprobat_de`, `aprobat_la`, `motiv_decizie`, `eveniment_ids` bigint[].
- **Identificarea piesei, separată de stare** (r4): `identificare` ∈ {`bucata`, `bucata_decl`, `nerezolvata`}, doar la `tip = montaj` (la tăiere și cuplare piesele sunt mereu identificate).
- **CHECK-uri**: coerența pe `tip` (câmpurile celorlalte tipuri sunt NULL); `identificare = 'nerezolvata'` ⇔ fără `bucata_id` și fără `bucata_decl_uid`; `stare = 'in_verificare'` ⇒ `nerezolvata`; `stare IN ('trimisa', 'aprobata')` ⇒ identificată; `stare = 'conflict'` ⇒ `conflict_cod` ∈ {`r1d`, `corectie_in_arbore`} (r6: lista închisă a motivelor, §6.4); `conflict_cod` e NULL pe `ciorna`, `trimisa`, `in_verificare`, `revizie_ceruta` și `aprobata`; pe `blocata`, doar cu `stare_inainte_blocare = 'conflict'` (motivul se păstrează la blocare, r5); pe `respinsa` / `stearsa` poate rămâne, ca istoric. O ciornă (sau un `conflict` / `blocata`) poate fi nerezolvată: abia `sesiune_trimite` o duce în `in_verificare` (§6.4).
- **Istoricul**, `izo_declaratii_versiuni` (doar adaug):
  - coloane: `declaratie_id`, `versiune`, `payload` (fără GPS), `hash_cerere`, `op_id`, `la`;
  - o versiune nouă e permisă doar în stările din §6.4 (`ciorna`, `conflict`, `blocata`, `in_verificare`, `revizie_ceruta`); niciodată pe `aprobata`, `respinsa`, `stearsa`.

**`izo_bucati_declarate`** (copiii tăierilor încă neaprobate, v2.3 §1.6):
- `uid` PK (generat de tabletă), `declaratie_id`, `declaratie_versiune` (versiunea tăierii care l-a declarat);
- `parinte_bucata_id` | `parinte_decl_uid`, `radacina_id`;
- `lungime_mm`, `lungime_calculata`;
- `capat_stanga`, `capat_dreapta`, `cod_bucata`: **literele rezervate de server la acceptare**, în ordinea sosirii;
- `destinatie` ∈ {`montaj`, `ramane_montat`, `depozit`}, `depozit_destinatie_id`;
- `stare` ∈ {`declarata`, `aprobata`, `anulata`};
- `bucata_id`, după aprobare (cu același `uid` în `magazie_bucati.uid`);
- UNIQUE (`radacina_id`, `cod_bucata`) WHERE `stare = 'declarata'`. Împreună cu `ux_magbuc_izo_cod` (E2a, pe aceleași coloane), o literă nu se dă de două ori. Uid-ul copilului e unic și în registru (`ux_magbuc_izo_uid`), deci un uid refolosit în alt arbore e refuzat (`uid_alt_arbore`).

**`izo_rezervari`** (Q2 A; r2: resursa e bucata **sau** copilul declarat):
- `id`, `proiect_id`, `tronson_id`, `declaratie_id`, `declaratie_versiune`, `autor_profile_id`;
- resursa, exact una (CHECK): `bucata_id` (bucată din registru) | `bucata_decl_uid` (copilul declarat al unei tăieri încă neaprobate);
- `din_depozit` bool (bucata era în depozit la rezervare, pentru limita din §6.7);
- `tip` = `fizic` (în E4; `planificat` vine după pilot);
- `activa`, `creata_la`, `eliberata_la`;
- `expira_dupa` (r3): NULL la rândurile trimise; la rândurile `ciorna` = `expira_la` al frontului + 24 h, mutat la fiecare reînnoire a frontului (§6.7);
- `motiv_eliberare` ∈ {`versiune_noua`, `stearsa`, `respinsa`, `consumata`, `expirata`, `parinte_anulat`, `transferata`}, `eveniment_id`;
- `transfer_din_id` (r3): rezervarea pe `bucata_decl_uid` din care s-a născut această rezervare pe `bucata_id` (mai jos);
- UNIQUE (`bucata_id`) WHERE `activa` și UNIQUE (`bucata_decl_uid`) WHERE `activa`: arbitrul când două tablete (sau două rânduri) aleg aceeași țeavă.
- **Cine ține ce**:
  - tăierea ține sursa: bucata din registru sau copilul declarat al unei tăieri anterioare;
  - montajul ține piesa: bucata întreagă sau copilul declarat cu destinația `montaj`;
  - copilul `ramane_montat` (§8.5) e ținut de tăiere, pe `bucata_decl_uid`;
  - resturile (`depozit`) nu se rezervă: nu sunt disponibile până la primire (§3.3).
- **Transferul la nașterea copilului** (r3; r4: pentru **orice** consumator). Aprobarea tăierii naște copilul (`magazie_bucati.uid` = uid-ul declarat). În același eveniment, **fiecare** rezervare activă pe `bucata_decl_uid` = acel uid, oricine o ține:
  - a copilului `ramane_montat`, ținută chiar de tăierea aprobată → `consumata` (copilul se naște `montata`);
  - a oricărei alte declarații (un montaj pe copil sau **o tăiere ulterioară** T2 care are copilul ca sursă) → `transferata`. În aceeași tranzacție se creează rezervarea pe `bucata_id` = copilul născut, pentru aceeași declarație (`declaratie_id`, `declaratie_versiune`, autor, `expira_dupa`), cu `transfer_din_id`. Consumatorul rămâne neaprobat, iar copilul nu devine liber nicio clipă: indexul UNIQUE pe `bucata_id` WHERE `activa` îl apără din commit-ul tăierii;
  - dacă consumatorul e în același lot, el consumă apoi, în ordinea simulării, rezervarea **transferată** R′ (pe `bucata_id`), nu pe cea originală R: R rămâne `transferata`, iar R′ devine `consumata`, cu `eveniment_id` = evenimentul consumatorului (`montaj`, sau `taiere` la T2). Lanțul R → R′ e exact ce verifică reconcilierea (§6.3 pasul 10, r5).

  După eveniment nu mai rămâne nicio rezervare activă pe `bucata_decl_uid` al unui copil născut (invariant, verificat la reconciliere și de un CHECK prin trigger). Deci orice consumator **neaprobat** al unui copil are tot timpul exact o rezervare activă: pe `bucata_decl_uid` înainte de naștere, pe `bucata_id` după. Instantaneul arată copilul născut ca „rezervat”. O versiune nouă a consumatorului, salvată după naștere, care numește copilul prin `decl_uid`, rezervă `bucata_id`-ul lui: serverul rezolvă uid-ul prin `magazie_bucati.uid`, sub lock-ul rădăcinii.

**`izo_suduri` + `izo_suduri_capete`** (v2.3 §1.5; prefixul `izo_`, ca în Q-E3-1 A):
- **sudura**:
  - `id`, `proiect_id`, `tronson_id`, `nr` int, `sufix` (forma canonică; `''` fără sufix);
  - `tip_sudura` ∈ {`linie`, `cuplare`, `reparatie`}, `stare` ∈ {`declarata`, `aprobata`, `anulata`};
  - `declaratie_id`, `executant`, `poanson`, `data_sudura`;
  - `tranzitie_perete`: calculat la aprobare (pereții celor două capete diferă);
  - `tranzitie_confirmata_de` / `_la` / `_motiv`: confirmarea MP-ului, înainte de emiterea pachetului (D2#10);
  - `server_ver`;
  - UNIQUE (`proiect_id`, `tronson_id`, `nr`, `sufix`) WHERE `stare <> 'anulata'`.
- **capătul**:
  - `sudura_id`, `parte` ∈ {`amonte`, `aval`};
  - exact unul dintre `bucata_id` și `bucata_decl_uid` (`element_id` vine odată cu robinetele, Q-E4-12);
  - `capat_litera`, `activ`, `de_la_eveniment_id`;
  - UNIQUE (`sudura_id`, `parte`) WHERE `activ`; UNIQUE (`bucata_id`, `capat_litera`) WHERE `activ`, la fel pe `bucata_decl_uid`.
- **O sudură aprobată are exact 2 capete active** (R4, verificat la aprobare).

**`izo_aprobari`** (lotul aprobat de MP; doar adaug):
- `id`, `cheie_operatie` uuid UNIQUE (idempotența), `proiect_id`, `tronson_id`, `aprobator`, `aprobator_angajat`;
- `randuri` jsonb: [{`declaratie_id`, `versiune`}], `decizii` jsonb (canonic);
- `hash_cerere` (cererea întreagă) și `amprenta_preview` (ce a văzut MP-ul), separate (§5.6);
- `eveniment_ids`, `raspuns` jsonb, `creat_la`.

### 3.3 Registrul E2a — ce folosește E4 (fără coloane noi)

**Evenimentele** sunt deja în CHECK-ul E2a: `taiere`, `montaj`, `livrare` (ieșirea pe tronson), `confirmare_primire_depozit`, `corectie` (marcajul arată altă lungime).
- `document_tip` ∈ {`izo_declaratie`, `izo_iesire`, `izo_primire`}, plus `document_id`.
- **UNIQUE parțial nou**, `ux_magbuc_ev_decl` pe evenimente (`document_id`, `tip`) WHERE `document_tip = 'izo_declaratie'` AND `tip IN ('taiere','montaj','corectie')`: un singur fapt de fiecare tip per declarație, deci retrimiterea aprobării nu dublează nimic. Numele e trecut explicit în amprenta E4, ca la E3.

**Stările**:

| Operație | Bucata | Înainte | După | Locul după |
|---|---|---|---|---|
| ieșire pe tronson | piesa din depozit | `sosit` / `receptionat` / `retur` | `pe_tronson` | tronsonul (`atribute.depozit_origine_id` = depozitul) |
| tăiere | părintele | `pe_tronson` / `montata` | `taiata` | neschimbat |
| tăiere | copilul de montat | — | `pe_tronson` (apoi montaj) | tronsonul |
| tăiere | copilul rămas în șanț (§8.5) | — | `montata` | tronsonul; preia **capătul sudat** al părintelui (litera + sudura), pe ramura lui |
| tăiere | restul | — | `in_tranzit` | tronsonul tăierii; destinația în `atribute.destinatie_depozit_id` |
| montaj | piesa | `pe_tronson` | `montata` | tronsonul |
| primire | restul | `in_tranzit` | `retur` (≥ `prag_rest_mm`) / `rest_nereutilizabil` (sub prag) | depozitul de destinație |
| corecție | **doar o rădăcină fără descendenți** (§8.6) | neschimbată | neschimbată | `lungime_masurata_mm` / `lungime_mm`, cu `inainte` / `dupa`; R3 rămâne adevărat (rădăcina e singura frunză) |

**Disponibile pe tabletă**:
- da: `pe_tronson` pe tronsonul sesiunii, plus `sosit` / `receptionat` / `retur` din depozite, afișate „în depozitul X — cere ieșirea” (Q-E4-2 A);
- niciodată:
  - `carantina`, `in_tranzit`, `montata`, `taiata`, `anulata`;
  - `rest_nereutilizabil` (o alegere explicită, cu motiv, vine după pilot);
  - bucățile rezervate de altă declarație activă;
  - bucățile E3 fără PV (Q-E4-6 A).

**Index nou**: `ux_magbuc_izo_teava` UNIQUE (`executie_teava_id`) WHERE `executie_teava_id IS NOT NULL AND tip_cod IS NOT NULL AND stare <> 'anulata'`: o bucată ↔ un rând de pachet. Numele intră în amprentă prin `ux_magbuc_izo_%`. Preflight în migrare: 0 bucăți legate (azi toate 3352 au NULL, ✓BD 21.10).

**Moștenirea la tăiere** (v2.3 §1.2):
- copilul copiază de la rădăcină `serie` (brută), `sarja`, `tip_material_id` / `tip_cod`, `grad_otel`, `standard`, `dimensiune`, `diametru_mm`, `perete_mm`, `lot`, `provenienta`, `proiect_id`, `locatie_site_id`;
- primește `parinte_id`, `radacina_id` (rădăcina părintelui), `cod_bucata`, capetele, `lungime_mm` (+ `lungime_m` / `lungime_originala_m`, ținute sincron), `lungime_calculata` și `uid` = uid-ul declarat;
- **nu primește** `aviz_intrare_id` / `nr_crt_aviz` / `lungime_aviz_mm`: indexul E3 `ux_magbuc_izo_aviz_rand` le-ar refuza (discrepanța 14);
- `fn_izo_depozit_in_registru` (E2a) se extinde cu `atribute.destinatie_depozit_id`, ca un depozit care așteaptă un rest să nu-și poată schimba site-ul.

### 3.4 `executie_tevi` — fără coloane noi

Proiecția pachetului (§7) din registru:
- `serie_unica`, `sarja`, `lot`;
- `lungime_m` = lungimea montată; `lungime_originala_m` = lungimea rădăcinii;
- `dimensiune` (`610X7.1`), `tip` (`L360` / `CIC`);
- `tip_rand`: `teava` / `curba` (din bucata legată), iar `legare` pentru o cuplare (r7: din sudura de cuplare, fără bucată, §7.1);
- `sudura_cod`: sudura aval, după convenția IZO (rândul i = țeava i + sudura dintre i și i+1). Pe un rând `legare` e codul afișat al sudurii de cuplare (§3.5), singura lui identitate; serie, șarjă, tip și lungime rămân goale, ca la rândul `legare` de azi (`ImportExcelIzometrie.jsx`: „doar sudura = legare cap-la-cap”).

`pm_cod`, `pa_ut_cod`, `ut_cod` și `observatii` rămân editabile până la E10: pe tronsoanele în flux doar prin `fn_izo_pachet_rand_note` (r3, §7.4), pe celelalte din client, ca azi.

### 3.5 Codul sudurii

- **Identitatea**: (`proiect`, `tronson`, `nr`, `sufix`).
- **Afișarea**: `TR` + numărul tronsonului + `S` + nr, **fără zerouri** (`TR14S7`, `TR13S48`), după `izo_proiect_config.format_sudura` (`TR`) și `formatSudura({…}, { prefix: 'TR', pad: 0 })`.
- **Normalizatorul SQL** `fn_izo_sudura_normalizeaza(text, tronson)` = `normalizeazaSudura` din `src/lib/izoSudura.js`, testate pe același `izoSudura.cazuri.json`.
- **Sufixele**: doar cele din `conventie_sufixe`. Cât convenția e goală, tableta dă numai coduri fără sufix; un R final rămâne „cod de confirmat”.
- **Numerotarea**:
  - numărul următor, pe direcția de lucru: la `crescator` = max(aprobate, declarate) + 1 (primul = 1); la `descrescator` = min(aprobate, declarate) − 1 (primul = `nr_sudura_start`, §3.1). Sub 1 → nicio propunere, „cod de confirmat”;
  - „sudura uitată” (prototip `insPlan`) decalează doar sudurile încă `declarata` ale aceleiași sesiuni deschise, ca versiuni noi;
  - o sudură aprobată nu se renumerotează niciodată: numărul e scris pe țeavă;
  - numerele sărite dau o alertă LOW (`izo_salt_numerotare`) și apar în rezumat.

## 4. Punctele de intrare

### 4.1 UI

| Cine | Unde | Fișier |
|---|---|---|
| Inginer | tableta: ruta `/izometrie/teren` în aplicație (chunk separat, încărcat la cerere, fără xlsx / jspdf), cu tema de teren a prototipului (deschisă, contrast mare), pe ecran întreg | `src/IzoTeren.jsx`; `src/lib/izoTeren.js` (regulile prototipului, funcții pure, cu teste); `src/lib/izoCoada.js` (coada) |
| MP / înlocuitor | Execuție → Izometrie → tab „✅ Aprobare teren” | `src/IzoAprobareTeren.jsx` |
| Gestionar | Magazie → 🧱 Țeavă proiecte → „Ieșire pe tronson” și „De primit” | `src/IzoDepozitTeren.jsx`, din `src/IzoStocTeava.jsx` |
| MP / inginer, la birou | editorul pachetului: picker-ul #824 devine legătura reală pe tronsoanele în flux | `src/Izometrie.jsx`, `src/lib/izoRegistru.js` |
| Owner | activarea fluxului pe tronson, din sesiunea de chat (`postgres`), cu „da” | — |

### 4.2 API

Toate funcțiile sunt SECURITY DEFINER, cu `SET search_path = public, pg_temp` și EXECUTE doar pe semnătura exactă.

| Funcție | Owner | EXECUTE | Ce face |
|---|---|---|---|
| `fn_izo_teren_pregateste(p_proiect, p_tronson, p_dispozitiv)` | `izo_teren_editor` | `authenticated` | ia sau reînnoiește frontul și întoarce instantaneul (§5.2) |
| `fn_izo_teren_instantaneu(p_proiect, p_tronson)` | `izo_teren_editor` | `authenticated` | doar citire: instantaneul + checksum |
| `fn_izo_teren_preda(p_tronson, p_dispozitiv)` | `izo_teren_editor` | `authenticated` | predă frontul (cere coada goală și sesiunea trimisă sau fără rânduri) |
| `fn_izo_sync_push(p_dispozitiv, p_ops)` | `izo_teren_editor` | `authenticated` | lotul de operații (cel mult 50), cu rezultatul pe fiecare operație (§5.4) |
| `fn_izo_aprobare_lot(p_preverificare)` | `izo_montaj_writer` | `authenticated` | doar citire: rândurile, versiunile, efectele simulate, deciziile cerute, alertele, `amprenta` preview-ului (§5.6) |
| `fn_izo_aproba(p_cheie, p_preverificare, p_randuri, p_amprenta, p_decizii)` | `izo_montaj_writer` | `authenticated` | faptele (§6.3) |
| `fn_izo_front_elibereaza(p_tronson, p_motiv)` | `izo_montaj_writer` | `authenticated` | MP-ul eliberează frontul altui dispozitiv (§6.7); idempotentă natural (un front deja inactiv nu se mai scrie) |
| `fn_izo_gps_citeste(p_decl)` | `postgres` | `authenticated` | doar citire: coordonatele unei declarații, doar MP-ului proiectului și owner-ului (Q-E4-15, §9.5) |
| `fn_izo_revizie_cere(p_cheie, p_decl, p_versiune, p_motiv)` | `izo_montaj_writer` | `authenticated` | „revizie cerută” pe un rând |
| `fn_izo_respinge(p_cheie, p_decl, p_versiune, p_motiv, p_dependente)` | `izo_montaj_writer` | `authenticated` | respingerea, cu decizia pe fiecare dependență; și rândurile unei sesiuni abandonate (§6.4) |
| `fn_izo_serie_lamureste(p_cheie, p_decl, p_versiune, p_bucata, p_motiv)` | `izo_montaj_writer` | `authenticated` | rândul „în verificare” trece pe bucata reală: `identificare` `nerezolvata` → `bucata`, starea `trimisa` (rămâne de aprobat); contractul în §6.4 (r5) |
| `fn_izo_tranzitie_confirma(p_sudura, p_motiv)` | `izo_montaj_writer` | `authenticated` | „tranziție executată conform proiect / WPS” (idempotentă natural: o sudură deja confirmată nu se mai scrie) |
| `fn_izo_pachet_rand_note(p_teava, p_updated_at, p_observatii, p_pm_cod, p_pa_ut_cod, p_ut_cod)` | `izo_montaj_writer` | `authenticated` | r3: pe tronsoanele în flux, singura cale pentru observații și codurile NDT, cu ordinea scriitorilor de pachet (§7.3, §7.4) |
| `fn_izo_iesire_tronson(p_cheie, p_depozit, p_tronson, p_bucati, p_nr_aviz, p_data)` | `izo_montaj_writer` | `authenticated` | ieșirea pe tronson (gestionar) |
| `fn_izo_primire_depozit(p_cheie, p_depozit, p_bucati)` | `izo_montaj_writer` | `authenticated` | primirea resturilor în depozit (gestionar) |
| `fn_izo_pachet_completeaza(p_cheie, p_pachet, p_updated_at, p_sudura_de, p_sudura_pana)` | `izo_montaj_writer` | `authenticated` | adaugă în pachet rândurile din montajele aprobate (§7.2) |
| `fn_izo_pachet_leaga(p_teava, p_bucata, p_updated_at)` / `fn_izo_pachet_dezleaga(p_teava, p_motiv)` | `izo_montaj_writer` | `authenticated` | picker-ul ca legătură reală (§7.3); r7: doar pe rândurile `teava` / `curba` |
| `fn_izo_pachet_aprobare_transgaz(p_pachet, p_updated_at, p_cale, p_sha256)` | `izo_montaj_writer` | `authenticated` | varianta minimă (E4a), doar pe tronsoanele în flux: fișierul + documentul + statusul, într-o tranzacție; r6: CAS pe `p_updated_at` (§7.4); r7: fiecare rând legat după tipul lui (§7.1), rândurile `legare` prin verificarea `legare` (§7.3) |
| `fn_izo_seteaza_flux(p_tronson, p_activ, p_motiv)` | `izo_montaj_writer` | `postgres` | §3.1 |

**Ajutătoarele interne**: owner `postgres`, EXECUTE doar pentru rolurile E4; REVOKE de la PUBLIC, `anon`, `authenticated`, `service_role`.
- intrarea și autorizarea: `fn_izo_montaj_api_verifica`, `fn_izo_teren_api_verifica`, `fn_izo_montaj_autorizare_lock`; înaintea porții (r3, §5.4 pasul 0.4): `fn_izo_montaj_preverifica(p_rol, p_proiect)` (citire fără lock) și `fn_izo_rata_consuma(p_functie)`;
- lock-urile pe tabelele pe care rolul apelant n-are UPDATE (FOR SHARE / FOR UPDATE cer UPDATE pe cel puțin o coloană): `fn_izo_montaj_autorizare_lock` (profilul, accesul, atribuirea), `fn_izo_blocheaza_locuri` (proiectul, tronsonul, depozitele), `fn_izo_config_blocheaza` (config-ul, la sincronizare), `fn_izo_radacini_blocheaza` (rădăcinile și bucățile). Fiecare ia lock-urile în ordinea din §10.5 și nu întoarce date;
- contextul și garda: `fn_izo_montaj_marcheaza` (owner `izo_montaj_writer`), `fn_izo_garda_montaj`, `fn_izo_garda_teren`;
- efectele așteptate: `fn_izo_decl_efecte(decl, versiune, stare_simulata)`, `fn_izo_lot_efecte(randuri)` (simularea lotului în ordine topologică, §6.3), `fn_izo_aprobare_amprenta`, `fn_izo_pachet_rand_asteptat`, `fn_izo_coloane_tevi`;
- lock-uri și utilitare: `fn_izo_radacini_blocheaza(ids)`, `fn_izo_sudura_normalizeaza`, `fn_izo_flux_tronson`;
- poarta: `fn_izo_porti_e4_definitii`, `fn_izo_porti_e4_lipsa`.

### 4.3 Operațiile de pe tabletă (`versiune_format` = 1)

- Forma operației: `{op_id, seq, tip_op, ora_tableta, payload}`.
- `tip_op` ∈ {`sesiune_deschide`, `decl_salveaza`, `decl_sterge`, `sesiune_trimite`}.
- `decl_salveaza` poartă `versiune_baza`: 0 la creare, apoi versiunea pe care o înlocuiește (CAS).
- Exemplul gestului „Țeavă tăiată”: două operații, valorile sunt fictive.

```json
{"op_id":"…","seq":42,"tip_op":"decl_salveaza","ora_tableta":"2026-11-03T09:41:12+02:00","payload":{
  "preverificare_uid":"…","uid":"T1","versiune_baza":0,"tip":"taiere","sursa":{"bucata_id":51234},
  "baza_mm":11980,"puncte_mm":[8000],"confirmare":{"mod":"marcaj","cm":98},
  "copii":[{"uid":"C1","lungime_mm":8000,"destinatie":"montaj"},
           {"uid":"C2","lungime_mm":3980,"destinatie":"depozit","calculata":true}]}}
{"op_id":"…","seq":43,"tip_op":"decl_salveaza","payload":{
  "preverificare_uid":"…","uid":"M1","versiune_baza":0,"tip":"montaj","bucata":{"decl_uid":"C1"},
  "capat_amonte":"A","amonte":{"tip":"bucata","bucata_id":51177,"capat":"B"},"sudura":{"nr":7,"sufix":""},
  "lungime_montata_mm":8000,"confirmare":{"mod":"taiata"},"depinde_de_uid":"T1","depinde_de_versiune":1,
  "gps":{"lat":"…","lon":"…","precizie_m":6,"la":"…"}}}
```

Serverul scoate `gps` din payload înainte de orice scriere în JSON (§9.5): îl pune în `izo_declaratii_gps`, iar `hash_cerere` îl include, ca o retrimitere cu alte coordonate să fie tot `conflict_op`.

## 5. Offline și sincronizare

### 5.1 Ce livrează E4 și ce rămâne pentru E6 (Q-E4-4 A)

- **E4**:
  - coada durabilă (IndexedDB) și protocolul **final** pe server (același și în E6), plus instantaneul;
  - tableta lucrează și când semnalul cade cât pagina e deschisă: salvările stau în coadă și pleacă la revenire;
  - un singur tab scrie (Web Locks);
  - stocarea persistentă se cere (`navigator.storage.persist`); dacă e refuzată apare un banner;
  - exportul cozii, ca fișier JSON, e plasa de siguranță.
- **E6**:
  - shell-ul `/teren` separat (Vite cu mai multe intrări, SW cu precache pe versiuni, pornire fără rețea, refresh controlat al sesiunii);
  - profilul local și adoptarea cozii altui utilizator;
  - GPS-ul offline, pe axul calibrat.
- **Consecința pentru pilot**: „Pregătește” se face dimineața, cu semnal. Până la E6, după o repornire fără semnal aplicația nu se deschide; datele din coadă rămân.

### 5.2 Instantaneul (`fn_izo_teren_instantaneu`)

Un singur document jsonb, calculat într-o singură tranzacție, cu `snapshot_id`, `checksum` (sha256 pe forma canonică) și `server_ver_max`. Conține:
- **frunzele active ale proiectului**, în formă compactă: id, uid, serie, serie_canon, șarjă, `lungime_mm`, `lungime_cm`, `perete_mm`, `tip_cod`, stare, tronson / depozit, „rezervată” (da / nu și tronsonul, fără autor pe rândurile altora), „fără PV”. Servesc R1 (d) și R2 offline: ~3.400 de rânduri, sub 1 MB. Instantaneul **nu conține GPS**;
- **detaliul tronsonului**:
  - lanțurile (bucățile montate + capetele libere);
  - sudurile (aprobate + declarate) și numărul următor;
  - zonele de perete, `sens_numerotare`, `conventie_sufixe`;
  - pragurile: `toleranta_mm`, `prag_rest_mm`, `lungime_max_mm`;
- declarațiile proprii neaprobate (stare + versiune) și bucățile declarate;
- **lista tombstone**: bucățile consumate sau anulate față de instantaneul precedent, ca tableta să avertizeze rândurile locale care le folosesc.

Tableta înlocuiește datele locale atomic, într-o tranzacție IndexedDB; coada nu se atinge. Instantaneul conține doar proiectele pe care utilizatorul are atribuire (`fn_izo_citire`).

### 5.3 Coada locală (`src/lib/izoCoada.js`)

- **Stocarea**: IndexedDB, o bază pe (profil, proiect), accesată printr-un adaptor. Testele folosesc un adaptor în memorie, fără librării noi.
- **Operația**: `op_id` uuid, `seq` crescător pe dispozitiv, `versiune_format`, payload. Stările: `pe_tableta` → `trimisa` → `confirmata`; ultima vine doar după ACK-ul serverului, salvat durabil.
- **Rezultatele nefinale** (§5.4: `reincearca`, `blocat_de_conflict`, `fara_drept`, `front_expirat`, `limita`, `alt_dispozitiv`) lasă operația în coadă, cu același `op_id`; o scot doar cele finale și cele terminale pentru coadă (`duplicat`, `conflict_op`, mai jos). La `alt_dispozitiv`, tableta arată „tronsonul e luat de altă tabletă — decide MP-ul”, oprește trimiterea automată și o reia după un „Pregătește” reușit (r3, §6.7). O operație finală greșită (`eroare`, `conflict`) se repară cu o operație nouă (alt `op_id`).
- **Repornirea**: coada, `seq`-ul curent și `dispozitiv_id` se citesc din IndexedDB la deschidere; o operație `trimisa` fără ACK se retrimite cu același `op_id` (serverul răspunde `duplicat` dacă o avea deja).
- **`duplicat` e terminal pentru coadă** (r4): poartă răspunsul final salvat (`acceptat` / `conflict` / `eroare` / `eroare_interna`), iar tableta îl tratează exact ca pe rezultatul original: îl salvează durabil ca ACK și scoate operația. Deci un ACK pierdut nu ține operația în coadă.
- **`conflict_op`** (același `op_id`, alt conținut: o eroare de client) e și el terminal pentru coadă: operația trece într-o listă locală „de verificat” (vizibilă, inclusă în exportul cozii), cu raport în Sentry; coada merge mai departe, iar operațiile care depindeau de ea primesc `blocat_de_conflict`.
- **„Desfă”** (prototip: 8 s / 2 min) e local:
  - operația n-a plecat → se scoate din coadă;
  - a plecat → „Desfă” înseamnă o versiune nouă sau `decl_sterge`.
- **Retragerea trimiterii**: doar cât `sesiune_trimite` e încă `pe_tableta`, ca în prototip. După ACK, doar MP-ul poate cere revizie sau respinge.
- **Utilizatorii**: logout-ul e blocat cât coada nu e goală; coada altui profil nu se vede.
- **Trimiterea**:
  - după fiecare salvare (cu ~1,5 s întârziere, ca în prototip) și la revenirea semnalului;
  - în loturi de cel mult 50, în ordinea `seq`;
  - cu `refreshSession` înainte.

### 5.4 `fn_izo_sync_push` (serverul)

Pașii (v2.3 §4.4b, adaptat; r2: lock-urile o dată pe lot, jurnalul scris o singură dată):

0. **Intrarea, `fn_izo_teren_api_verifica()`, în ordinea aceasta** (r4: izolarea → schema → identitatea → filtrele ieftine → poarta; nicio scriere și niciun lock pe date înaintea lock-ului schemei):
   1. **READ COMMITTED impus**, înaintea oricărui lock (ca E3 r5f, `fn_izo_doc_api_verifica`): altfel → refuz `25001`;
   2. lock-ul schemei, partajat (`gazpet.livrare_migrare`): o migrare care îl ține exclusiv e așteptată aici, înainte ca apelul să atingă vreun tabel, deci contorul de mai jos nu poate face ciclu cu ea;
   3. `session_user = authenticator`, JWT `authenticated`, uid prezent; contextele goale;
   4. **filtrele ieftine, înaintea porții** (r3: poarta costă ≈ 0,4 s, iar refuzurile nejurnalizate nu intră în limita din §6.7):
      - `fn_izo_montaj_preverifica('inginer_izometrie', proiect)`: o citire fără lock pe rânduri, pe index, a atribuirii active și a cheii de modul (sau owner). Lipsa → `fara_drept`, întors imediat, fără poartă și fără scrieri. E doar un filtru de cost: autorizarea reală rămâne cea de la pasul 3, sub lock;
      - `fn_izo_rata_consuma('sync')`: contorul pe (profil, funcție), cel mult 30 de apeluri pe minut (de confirmat la pilot). Peste → `limita`, fără poartă. Același filtru + contor stă la intrarea `fn_izo_teren_pregateste` și `fn_izo_teren_instantaneu` (instantaneul e cel mai scump răspuns);
      - pe canalele de birou (aprobare, depozit, pachet), refuzurile sunt excepții, deci un contor s-ar anula odată cu ele. Acolo rămâne filtrul de rol (fără poartă pentru cine nu e MP / gestionar pe proiect); apelanții care trec de el sunt persoane numite (≤ 4 pe proiect);
   5. poarta completă (E2a + E3 + E4);
   6. lotul: cel mult 50 de operații și 256 KB, `versiune_format` cunoscută, un singur proiect și un singur tronson (ale frontului).
1. **Pre-analiza lotului**, fără lock-uri pe date și fără efecte:
   - fiecare operație se parsează, iar `hash_cerere` se calculează pe forma canonică (§3.2);
   - se adună mulțimea resurselor atinse de **tot** lotul: sesiunile și declarațiile (după uid), copiii declarați, bucățile (sursă, piesă, amonte, plus rădăcinile lor și ale părinților declarați), sudurile (după identitate);
   - r4: **orice operație care poate invalida sau debloca** (o versiune nouă sau ștergerea unei tăieri; o versiune nouă a unui rând de care depind altele) aduce în mulțime **închiderea tranzitivă a descendenților neaprobați, în orice stare deschisă** (`ciorna`, `conflict`, `blocata`, `trimisa`, `in_verificare`, `revizie_ceruta`; montajele și tăierile pe copiii ei, cuplările dependente, sudurile cu capete pe acești copii), ca blocarea, deblocarea sau anularea lor să fie sub lock-ul luat la pasul 2. Descendenții sunt mereu ai aceluiași autor (§5.7: nimeni nu leagă de copilul declarat al altuia). Închiderea se calculează înaintea lock-urilor și se recalculează după ele; dacă diferă → `reincearca` pentru lot, fără efecte;
   - o operație care ar atinge o resursă din afara acestei mulțimi e imposibilă prin construcție: payload-ul își numește toate referințele. Dacă apare totuși una la pasul 4, operația primește `eroare_interna` (`resursa_neanuntata`), fail-closed.
2. **Lock-urile, o singură dată pe lot, în ordinea globală (§10.5)**:
   - frontul tronsonului FOR UPDATE (serializează loturile pe același tronson, inclusiv o cerere expirată la client care încă rulează pe server, plus retrimiterea ei);
   - sesiunile, apoi declarațiile (FOR UPDATE, după id);
   - `profiles` → `user_module_access` → `izo_atribuiri` (FOR SHARE, prin `fn_izo_montaj_autorizare_lock`);
   - `izo_tronson_config` (`fn_izo_config_blocheaza`), proiectul, tronsonul și depozitele implicate (`fn_izo_blocheaza_locuri`), FOR SHARE;
   - rădăcinile, apoi bucățile (FOR UPDATE, după id, `fn_izo_radacini_blocheaza`), apoi sudurile existente (FOR UPDATE, după id).

   Lock-urile pe tabelele pe care `izo_teren_editor` n-are UPDATE trec prin helperele `postgres` din §4.2; pe tabelele E4 ale tabletei (front, sesiuni, declarații, suduri) rolul are UPDATE pe coloane (§9.4), deci le blochează direct.

   Două loturi care ating X și Y, în orice ordine din payload, le blochează amândouă X → Y, deci nu se pot închide într-un ciclu. Sudurile noi sunt pe tronsonul frontului, deci un `INSERT … ON CONFLICT` nu așteaptă niciodată după alt lot de sincronizare.
3. **Autorizarea și identitatea, o dată pe lot** (§5.7):
   - `auth.uid()` = `izo_fronturi.profile_id`; `p_dispozitiv` = `dispozitiv_id` al frontului; frontul e activ și `expira_la` > `now()`;
   - `inginer_izometrie` activ, valabil azi, pe proiect + cheia de modul (editor); `profiles.employee_id` NOT NULL;
   - fiecare sesiune, declarație și copil declarat numit în lot e al aceluiași autor (`autor_profile_id` / `declarat_de` = `auth.uid()`), al proiectului și al tronsonului frontului.

   Rezultatele, pe tot lotul, fără efecte și **fără jurnal** (nu există efect de reluat):
   - drepturile lipsă → `fara_drept`;
   - frontul expirat → `front_expirat` (tableta cere „Pregătește”);
   - limitele din §6.7 depășite → `limita`;
   - alt dispozitiv activ pe tronson → fiecare operație primește `alt_dispozitiv`, **nefinal și nejurnalizat în `izo_operatii`** (r3), fără efecte. Se scrie doar prima încercare în `izo_sync_incercari` (payload-ul fără GPS), ca MP-ul să vadă ce așteaptă (carantina din v2.3). `op_id`-ul rămâne liber: după ce dispozitivul reia frontul (predarea celuilalt sau eliberarea de către MP, §6.7), aceeași operație se aplică normal, cu validarea completă pe starea de atunci.

   O referință la obiectul altui autor dă `eroare` `ref_alt_autor` pe operația ei.
4. **Fiecare operație**, în ordinea `seq`, în savepoint propriu (`BEGIN … EXCEPTION`):
   1. **Jurnalul existent**: SELECT pe (autor, `op_id`). Lotul e deja serializat de lock-ul frontului (canalul `teren`):
      - există, cu același `hash_cerere` → `duplicat`, plus `raspuns`-ul salvat; nicio scriere;
      - există, cu alt hash → `conflict_op`; nicio scriere, iar clientul raportează în Sentry (e o eroare de client).
   2. **Validarea completă**, pe starea comisă + efectele operațiilor acceptate mai devreme în lot:
      - tipurile și intervalele;
      - starea bucății, PV-ul (pe rădăcină), carantina, tronsonul;
      - R1 (d) pe frunze + declarate; R3 pe tăiere; R4 pe sudură;
      - confirmarea lungimii: la `marcaj`, cifrele tastate = centimetrii bucății;
      - CAS pe `versiune_baza`; tranziția de stare permisă (§6.4).
   3. **Efectele**:
      - versiunea declarației (+ istoricul, payload-ul fără GPS) și rândul `izo_declaratii_gps`;
      - rezervarea: cea veche se eliberează (`versiune_noua`), se creează cea nouă. La 23505: dacă rezervarea care ține resursa a expirat (`expira_dupa` < `now()`, §6.7), se eliberează (`expirata`) și se reîncearcă o dată; altfel → `conflict`. Rezervările unei resurse (bucată sau copil declarat) se scriu, de oricine, doar sub lock-ul rădăcinii ei (pasul 2);
      - **preluarea nu atinge declarația celuilalt autor** (r3): se scrie doar rândul `izo_rezervari` (sub lock-ul rădăcinii, deja ținut). Declarația veche nu se scrie deloc: pierderea rezervării e o **condiție derivată** („fără rezervare activă”, `rezervare_pierduta` în instantaneu), nu o stare nouă (§6.4). Autorul o vede la următorul instantaneu; o versiune nouă care cere aceeași resursă primește `conflict`; `sesiune_trimite` refuză (`eroare` `rezervare_pierduta`, cu lista rândurilor) cât există o ciornă fără rezervare activă; aprobarea refuză oricum un rând fără rezervare activă (§6.3). Deci niciun lot nu blochează rândul altui autor după rădăcini;
      - bucățile declarate, cu literele rezervate;
      - sudura declarată: `INSERT … ON CONFLICT (identitate) DO NOTHING`, apoi recitire FOR UPDATE; alte capete → `conflict` (R4).
   4. **Jurnalul**: un singur INSERT în `izo_operatii`, cu rezultatul final (`acceptat`) și `raspuns`-ul. E ultima scriere din savepoint, deci efectele și jurnalul se comit sau se anulează împreună.

   **Erorile** (handler-ul `EXCEPTION` rulează după rollback-ul savepoint-ului, deci nu mai rămâne niciun efect al operației):
   - erorile de business (SQLSTATE din clasa proprie `IZ`, cu codul în DETAIL: `fara_pv`, `carantina`, `cas`, `stare`, R1 / R4…) și 23505 pe rezervare → INSERT în `izo_operatii`, în handler, cu `eroare` / `conflict` + cod + `raspuns`. E un rezultat final: retrimiterea primește același răspuns;
   - erorile trecătoare (`40001`, `40P01`, `55P03`, `57014`) → **nimic jurnalizat**, rezultatul `reincearca`. Lotul se oprește aici, ca ordinea `seq` să rămână; tableta retrimite de la această operație, cu același `op_id`;
   - orice altă excepție → `eroare_interna`, jurnalizată cu SQLSTATE-ul (o operație otrăvită nu blochează coada pentru totdeauna), plus Sentry pe client;
   - operațiile care depind de o operație fără `acceptat` în lot, sau de o declarație în `conflict` / `blocata` (`depinde_de_uid`), primesc `blocat_de_conflict`, **nejurnalizat**. Rămân în coadă până se repară părintele.

   Lotul continuă după erorile de business și după `eroare_interna`.
5. **Golurile de `seq`**: serverul ține ultimul `seq` pe dispozitiv. Un gol nu oprește lotul; deschide `izo_gol_operatii` (MEDIUM).
6. **Răspunsul**: rezultatul pe operație + starea curentă a declarațiilor atinse + `server_ver_max`. Dacă `server_ver_max` s-a mișcat, tableta reîmprospătează instantaneul.

**Rezultatele, pe scurt**:
- finale, jurnalizate: `acceptat`, `conflict`, `eroare`, `eroare_interna`;
- nejurnalizate, dar **terminale pentru coadă** (r4): `duplicat` (repetă răspunsul final salvat, deci tableta îl ia drept ACK), `conflict_op` (operația trece în lista locală „de verificat”);
- nejurnalizate și nefinale (operația rămâne în coadă, cu același `op_id`): `blocat_de_conflict`, `reincearca`, `fara_drept`, `front_expirat`, `limita`, `alt_dispozitiv` (cu prima încercare în `izo_sync_incercari`).

Tripleta dublată (R1 d) găsită pe server nu oprește operația, pentru că tăierea fizică s-a întâmplat deja. **Două lucruri separate** (r5): rezultatul operației (`izo_operatii.rezultat`) e `acceptat` (efectele se scriu, iar o retrimitere primește `duplicat` cu același `acceptat`); **starea** declarației e `conflict`, cu `conflict_cod = r1d`. Nu e rezultatul `conflict` (acela e un refuz, fără efecte) și nici starea `revizie_ceruta` (pe aceea o cere doar MP-ul). Inginerul îl repară cu o versiune nouă, pe lungimea reală; nimic nu intră în registru până atunci.

### 5.5 Conflictele

Coloana „Serverul” dă **rezultatul operației** (`izo_operatii.rezultat`, §5.4); unde se schimbă și starea declarației, e scrisă separat, ca „starea …” (r5).

| Situația | Serverul | Ce arată tableta |
|---|---|---|
| două tablete, pe tronsoane diferite, aleg aceeași țeavă | a doua rezervare dă 23505 → `conflict` | cardul roșu „montată și pe TR15S3 (Viciu, 11:20)”; alege altă țeavă (prototip `SERVER_MONTAT`) |
| bucata e montată, tăiată sau mutată între instantaneu și sincronizare | `conflict` (starea bucății) | la fel |
| aceeași sudură (nr + sufix), declarată cu alte capete | `conflict` (R4) | „sudura există cu altă țeavă — verifică numărul” |
| copil cu tripletă dublată (R1 d), aflată pe server | rezultatul `acceptat`; **starea** declarației `conflict` (`conflict_cod = r1d`), nimic în registru (r5) | „măsoară din nou lungimea reală” |
| tăiere sau montaj pe o bucată fără PV / în carantină | `eroare` (`fara_pv` / `carantina`) | mesaj clar; alege altă țeavă |
| alt dispozitiv pe front | `alt_dispozitiv`, nefinal (prima încercare în `izo_sync_incercari`, `op_id` liber) | „tronsonul e luat de altă tabletă — decide MP-ul”; operațiile rămân în coadă și pleacă după ce frontul revine |
| rezervarea unei ciorne, expirată și preluată de altă declarație | nimic pe declarația veche; ea apare `rezervare_pierduta` în instantaneu, iar `sesiune_trimite` e refuzată până la o versiune nouă sau ștergere | „țeava a fost luată între timp — alege alta” |
| retrimitere identică / același `op_id` cu alt conținut | `duplicat` / `conflict_op` | nimic / roșu |
| declarația a fost schimbată pe server între timp (revizie cerută, respinsă, blocată) | `conflict` (CAS pe `versiune_baza`) | reîncarcă declarația |
| retrimiterea unei operații vechi după respingere | `duplicat`, cu răspunsul vechi; nicio scriere nouă | nimic |
| retrimiterea după revocare | `fara_drept` (refuzul de drept vine înaintea citirii jurnalului, §5.4 pașii 0 / 3); nicio scriere | coada rămâne |
| frontul expirat / eliberat de MP | `front_expirat` / `alt_dispozitiv` | „Pregătește din nou” / „tronsonul e luat” |
| dreptul revocat (modul, atribuire) | `fara_drept`, pe tot lotul, fără efecte | „nu mai ai drept pe tronson”; coada rămâne |
| limita de rezervări / operații depășită (§6.7) | `limita` | „prea multe țevi rezervate — trimite sesiunea” |

### 5.6 Idempotența, pe canale

Două lucruri separate (r2), ca nicio diferență relevantă să nu primească răspunsul vechi:
- **`hash_cerere`** = sha256 pe forma canonică a **tuturor** parametrilor cererii. Leagă cheia de idempotență de intenție: aceeași cheie + același hash → răspunsul salvat; aceeași cheie + alt hash → refuz (`cheie_refolosita`), fără efecte.
- **`amprenta`** = sha256 pe ce a văzut MP-ul în preview (doar la aprobare). Recalculată sub lock-uri pe starea comisă, trebuie să bată cu `p_amprenta`; altfel refuz (`preview_vechi`), iar ecranul reîncarcă lotul.

Pe canale:
- **Tableta**: (autor, `op_id`) + `hash_cerere` (versiunea formatului, tipul, dispozitivul, proiectul, payload-ul cu GPS). Hash-ul îl compară doar serverul; nu e citibil din API (§3.2, §9.4).
- **Aprobarea**: `cheie_operatie` (uuid generat la deschiderea lotului).
  - `hash_cerere` pe (`p_preverificare`, `p_randuri` sortate, `p_amprenta`, `p_decizii` canonic);
  - `amprenta` pe:
    - sesiunea (id, versiune) și rândurile (id, versiune, stare);
    - efectele simulate ale fiecărui rând (`fn_izo_lot_efecte`, forma canonică);
    - `server_ver` al fiecărei bucăți atinse și al rădăcinilor lor; sudurile (id, `server_ver`, capetele active); rezervările rândurilor (id, activă);
    - `izo_tronson_config.server_ver`, nivelul proiectului, depozitele de destinație (id, site);
    - **cheile deciziilor cerute** (de exemplu `motiv_corectie` pe declarația X, `depozit_rest` pe copilul Y fără origine) și alertele deschise (coduri).
  - `p_decizii` trebuie să aibă **exact** cheile cerute de preview: nicio cheie lipsă, nicio cheie în plus. Valorile se validează (lungimea motivului, depozitul valid pe proiect).
- **Respingerea, revizia, seria lămurită**: `cheie_operatie` (`p_cheie`, în semnăturile din §4.2) + `hash_cerere` pe toți parametrii (inclusiv `p_dependente`) + versiunea rândului (CAS).
- **Tranziția confirmată, eliberarea frontului**: naturale (starea țintă deja atinsă = niciun efect), fără cheie.
- **Notele pe rând** (`fn_izo_pachet_rand_note`): naturale + CAS pe `executie_tevi.updated_at`.
- **Gestionarul** (ieșire, primire) și **pachetul** (`completeaza`): `cheie_operatie` în `izo_operatii`, pe canalele `depozit` / `pachet`. `hash_cerere` acoperă toți parametrii (`p_bucati` sortate, `p_nr_aviz`, `p_data`, `p_updated_at`, intervalul de suduri).
- **Legarea unui rând**: naturală (aceeași pereche nu mai are efect) + CAS pe `executie_tevi.updated_at`.
- **Aprobarea Transgaz** (r6): naturală (pachetul deja aprobat cu același `p_sha256` = niciun efect; cu alt fișier → `pachet_needitabil`) + CAS pe `executie_pachete_lansare.updated_at` (`p_updated_at`).

Pe canalele de birou, rândul din `izo_operatii` (și `izo_aprobari`) se scrie în aceeași tranzacție cu faptele, ca ultimă scriere. Orice refuz e o excepție, deci rollback total: nimic jurnalizat, iar o reîncercare cu aceeași cheie e evaluată din nou. Două cereri concurente cu aceeași cheie:
- la aprobare, sunt serializate de lock-ul pe sesiune, luat **înaintea** citirii jurnalului (§6.3);
- pe canalele `depozit` / `pachet`, a doua se oprește pe indexul unic (autor, `op_id`) și primește 23505, deci rollback total; reîncercarea ei întoarce răspunsul salvat.

### 5.7 Ceasul, GPS-ul, identitatea

- **Ceasul**: ora oficială = `now()` pe server. `offset_ceas_s` se calculează la fiecare lot; peste 5 minute dă LOW `izo_ceas_tableta`. Data montajului e declarată, cu limitele de la §3.2.
- **GPS-ul**:
  - se citește **doar la salvarea declarației** (lat / lon / precizie / oră); nu se înregistrează niciun traseu între declarații (D2#15);
  - propunerea tronsonului din GPS și orice comparație GPS ↔ tronson: Q-E4-10 (la A, niciuna în E4: comparația cere axul calibrat, care nu e în BD);
  - vizibilitatea coordonatelor (dată personală): Q-E4-15.
- **Dispozitivul**: un uuid generat la primul „Pregătește” și păstrat în IndexedDB; fără amprentarea dispozitivului.
- **Două taburi**: Web Locks; al doilea e „doar citire” (prototip `otherTab`).
- **Identitatea (r2)**:
  - singura dovadă de identitate e JWT-ul (`auth.uid()`). `dispozitiv_id`, GPS-ul și ora tabletei sunt **date declarate**: nu dovedesc nici identitatea, nici prezența pe tronson. Nu intră în nicio autorizare, doar în alerte (LOW) și în coordonarea frontului;
  - pe un lot se cere egalitatea: utilizatorul (`auth.uid()`) = frontul (`profile_id`) = sesiunea (`autor_profile_id`) = autorul fiecărei declarații atinse (`declarat_de`) = autorul operației (`izo_operatii.autor_profile_id`). Orice referință din payload (sesiune, declarație, copil declarat, `depinde_de_uid`, amonte declarat, sursa declarată) trebuie să fie a aceluiași autor, proiect și tronson;
  - **lanțul peste predarea frontului**: un al doilea inginer nu poate lega amonte de copilul declarat (neaprobat) al primului. Predarea cere coada goală și sesiunea trimisă (§4.2), iar MP-ul aprobă înainte. Bucățile reale din registru (inclusiv o piesă montată declarată de altul, dar neaprobată) se pot folosi ca amonte, după `bucata_id`;
  - **persoana**, nu profilul: autorul și aprobatorul se compară pe `profile_id` **și** pe `profiles.employee_id` (index unic, ✓BD 21.10). Un profil fără angajat nu poate nici declara, nici aproba (`identitate_neclara`).

### 5.8 Ce verifică tableta offline și ce reverifică serverul

| Regula | Tableta (offline, pe datele locale) | Serverul, la acceptare | Serverul, la aprobare |
|---|---|---|---|
| formatul seriei `999AA99999`; prefixul; aceleași 3 cifre pe 2 prefixe (alegere explicită) | da | — | — |
| bucata disponibilă / rezervată | da (instantaneul) | da (arbitru: rezervarea) | da |
| R1 (d), tripleta serie + șarjă + lungime la cm | da, blochează salvarea normală | da: rezultatul `acceptat`, starea `conflict` (`r1d`) | refuz |
| R3, conservarea la tăiere | da | da | da (exact) |
| R4, sudura cu 2 capete; capătul liber | da | da | da |
| R5, lungimea ≤ disponibil + 20 mm, ≤ `lungime_max_mm` | da | da | da |
| confirmarea lungimii | da (pas separat) | da (cifrele = centimetrii) | da |
| tranziția de perete 7,1 ↔ 8,8 | informativă | calculată | calculată; o confirmă MP-ul înainte de emitere (E8) |
| peretele cerut de proiect (zonele) | informativ | — | afișat |
| seria „în verificare” | nu blochează trimiterea | acceptată | nu se aprobă |
| GPS-ul arată alt tronson | — (Q-E4-10 A: fără ax în BD, nu se compară în E4) | — | — |

## 6. Fluxul de aprobare

### 6.1 Trimiterea sesiunii (operația `sesiune_trimite`)

- Conține lista (uid, versiune) a declarațiilor sesiunii. Serverul cere ca lista să fie exact mulțimea declarațiilor `ciorna`; altfel `conflict`, „sesiunea s-a schimbat”.
- E refuzată cât există rânduri blocante (`conflict`, `blocata`, R1 d, R4, lungime neconfirmată, `corectie_in_arbore`, `rezervare_pierduta`: o ciornă cu piesă fără rezervare activă). Răspunsul le listează, iar sesiunea rămâne deschisă (prototip: „respins”).
- Rândurile „în verificare” nu o opresc (D2#2): trec în `in_verificare`.
- După trimitere, declarațiile sunt `trimisa` și imutabile, iar sesiunea e `trimisa`. Cum află MP-ul: Q-E4-13.

### 6.2 Ecranul MP-ului (Execuție → Izometrie → Aprobare teren)

- **Lotul**, pe zi și tronson, arată: rândurile cu alertele lor, dependențele (tăiere → montaj), frunzele arborelui la fiecare țeavă tăiată, rândurile „în verificare”, tranzițiile de perete și corecțiile de lungime.
- MP-ul bifează rândurile. Ecranul cere `fn_izo_aprobare_lot` (versiunile, efectele simulate, deciziile cerute, amprenta) și trimite înapoi exact perechile văzute, amprenta și deciziile, câte una pentru fiecare cheie cerută (§5.6).
- Ecranul arată și rezervările active ale sesiunii (§6.7) și alerta `izo_autor_fara_drept`, când e cazul.

### 6.3 `fn_izo_aproba(p_cheie, p_preverificare, p_randuri, p_amprenta, p_decizii)`

Ordinea, ca în E3 §4:

1. `fn_izo_montaj_api_verifica()`, în ordinea din §5.4 pasul 0 (r4): READ COMMITTED impus → schema → API (identitatea, contextele) → filtrul de rol fără lock (`fn_izo_montaj_preverifica`) → poarta. `hash_cerere` se calculează pe parametri (§5.6).
2. Sesiunile (a lotului și ale dependențelor, după id), apoi declarațiile din listă **și dependențele lor neaprobate** (închiderea pe `depinde_de_uid` / `bucata_decl_uid` / capete), toate FOR UPDATE, după id. Ca la sincronizare, o declarație se blochează doar după sesiunea ei. Închiderea se calculează înainte de lock și se recalculează după; dacă diferă, refuz `preview_vechi`. Lock-ul pe sesiune serializează două aprobări cu aceeași cheie.
3. `izo_operatii` / `izo_aprobari` (canalul `aprobare`, cheia), citite **după** lock: aceeași cheie + același `hash_cerere` → răspunsul salvat, fără scrieri; alt hash → refuz `cheie_refolosita`.
4. **Autorizarea**, sub lock, toate FOR SHARE: `profiles` → `user_module_access` (cheia exactă, editor) → `izo_atribuiri` (`manager_aprobator` sau `inlocuitor_aprobator`, activă, valabilă azi). Aprobatorul are `employee_id` (§5.7).
5. Proiectul, tronsonul și depozitele de destinație ale resturilor FOR SHARE (`fn_izo_blocheaza_locuri`).
6. `fn_izo_blocheaza_tabele()` + advisory partajat (73010, proiect).
7. Rădăcinile FOR UPDATE după id, apoi bucățile atinse, apoi sudurile, tot după id.
8. **Revalidarea pe starea comisă, apoi pe efectele simulate**:
   - lotul: versiunile = cele trimise; nivelul și fluxul sunt active; **amprenta** recalculată = `p_amprenta` (altfel `preview_vechi`); `p_decizii` are exact cheile cerute (§5.6);
   - **nimeni nu-și aprobă rândurile** (Q8): pentru fiecare rând din lot și pentru fiecare dependență neaprobată a lui, `declarat_de` ≠ aprobatorul și `declarat_de_angajat` ≠ `employee_id`-ul aprobatorului. Regula e aceeași pentru înlocuitor și pentru owner;
   - **ordinea simulării** (`fn_izo_lot_efecte`): rândurile se sortează topologic (corecția → tăierea → montajul copiilor ei → sudurile; cuplarea după tăierea capătului liber; la egalitate, după id). Fiecare rând se validează pe starea comisă + efectele simulate ale rândurilor dinaintea lui, fără scrieri;
   - fiecare rând:
     - e `trimisa`, fără conflict deschis, cu R1 (d) închis;
     - R3 exact, R4 cu 2 capete, lungimea confirmată;
     - **montajul pe o bucată din registru**: rezervarea activă pe `bucata_id` e a rândului (versiunea lui); bucata e `pe_tronson` pe tronsonul sesiunii;
     - **montajul pe un copil declarat**: tăierea lui e aprobată deja sau e în lot, mai devreme în ordinea simulării, la versiunea din `depinde_de_versiune`. Rezervarea rândului (versiunea lui) e: pe `bucata_decl_uid`, dacă tăierea e în lot; pe `bucata_id` = copilul născut, cu `transfer_din_id`, dacă tăierea a fost aprobată într-un lot anterior (r3, §3.2). r5: când tăierea e în lot, starea simulată de după pasul ei are deja transferul (R `transferata`, R′ activă pe `bucata_id`), deci montajul se validează și se marchează pe R′. În starea simulată, copilul e `pe_tronson` pe tronsonul sesiunii (îl moștenește de la părinte, care trebuie să fie acolo: ieșirea e făcută, Q-E4-2 A);
     - **tăierea**: rezervarea pe sursă e a ei: pe `bucata_id` (sursă din registru, inclusiv un copil născut dintr-o tăiere aprobată anterior, cu rezervarea transferată, r4) sau pe `bucata_decl_uid` (sursa e copilul unei tăieri din același lot; ca la montaj, după pasul tăierii-părinte se validează pe R′, transferată); în starea simulată, sursa e `pe_tronson` sau `montata` (§8.5);
     - PV-ul se verifică pe **rădăcină** (copiii n-au aviz, §3.3), după regula E3 §8;
   - o dependență care lipsește (nici aprobată, nici în lot) → refuz pe tot apelul, cu lista. MP-ul adaugă tăierea în lot sau scoate montajul;
   - corecțiile de lungime au motivul în `p_decizii` și respectă §8.6 (doar rădăcina fără descendenți).
9. **Marcajul**: `fn_izo_montaj_marcheaza('aproba', aprobare, proiect, tronson, …)`. De aici urmează doar DML static, **în ordinea simulării**:
   - pe fiecare rând:
     - `corectie`, dacă e cazul;
     - `taiere`: părintele trece `taiata`; copiii se nasc cu uid-ul și literele rezervate (copilul calculat cu `lungime_calculata`); mișcările `consumat` / `nascut`; capetele sudate ale părintelui trec pe copii, după ramura din §8.5; rezervările pe copii (`bucata_decl_uid`): a copilului `ramane_montat` (ținută de tăierea însăși) → `consumata`; **toate celelalte** (montaje, tăieri ulterioare) → `transferata` + rezervarea nouă pe `bucata_id`, pentru aceeași declarație (§3.2, r4). Consumatorul din același lot consumă R′ la pasul lui; R rămâne `transferata` (r5);
     - `montaj`: piesa trece `montata`; mișcarea `montat`;
   - sudurile: `declarata` → `aprobata`; capetele trec de pe `bucata_decl_uid` pe `bucata_id`; se calculează `tranzitie_perete`;
   - rezervările: pe fiecare rând `montaj` / `taiere` aprobat, rezervarea lui activă pe piesă / sursă (la consumatorul unui copil născut în lot: R′, cea transferată) → `consumata`, cu `eveniment_id` = evenimentul `montaj` / `taiere` al rândului;
   - declarațiile: `aprobata`, cu `aprobat_de` și `eveniment_ids`;
   - sesiunea: `inchisa` când nu mai are rânduri deschise; cât are rânduri `in_verificare`, rămâne `trimisa`.
10. **Reconcilierea**: mișcările, bucățile, capetele, sudurile și rezervările scrise = efectele simulate de la pasul 8. R3 se reverifică pe fiecare rădăcină atinsă. **Rezervările copiilor născuți** (r5: lanțul complet). Pentru fiecare copil născut din lot și fiecare rezervare R activă pe `bucata_decl_uid`-ul lui înainte de marcaj:
    - pe `bucata_decl_uid` nu mai rămâne nicio rezervare activă;
    - R a copilului `ramane_montat`, ținută de tăierea însăși → `consumata`, cu `eveniment_id` = evenimentul `taiere`;
    - orice altă R → `transferata`, cu **exact o** rezervare R′ pe `bucata_id` = copilul, cu `transfer_din_id` = R.id și aceeași `declaratie_id` + `declaratie_versiune` + autor. Apoi:
      - declarația lui R′ e în lot → R′ e `consumata`, cu `eveniment_id` = evenimentul acelei declarații (`montaj`, sau `taiere` la o tăiere ulterioară T2), iar declarația e `aprobata` în acest apel;
      - declarația lui R′ nu e în lot → R′ rămâne activă (o consumă un lot ulterior, testul 17);
    - un copil fără nicio R înainte rămâne liber (n-avea consumator declarat).

    Pe rândurile aprobate în apel: nicio rezervare activă nu le mai rămâne; fiecare `montaj` / `taiere` are exact o rezervare `consumata` pe piesă / sursă, cu evenimentul lui (plus, la tăiere, rezervarea copilului `ramane_montat`). R `consumata` direct de un consumator, R′ lipsă sau dublă, R′ activă după aprobarea declarației ei → excepție, deci rollback total.
11. **Jurnalul**, ultima scriere: `izo_aprobari` + `izo_operatii` (cheia, `hash_cerere`, `amprenta`, deciziile, răspunsul). O excepție oriunde înainte anulează tot, inclusiv jurnalul.

**Răspunsul**: evenimentele, bucățile noi (uid → id), sudurile aprobate și lista „fișe de tăiere de generat” (rădăcinile tăiate în lot).

### 6.4 Mașina de stări, revizia, respingerea, seria lămurită

**Tranzițiile declarației** (r2). Orice altă tranziție e refuzată de trigger, pe rol și pe stare.

**Motivele stării `conflict`** (r6): o listă închisă, `conflict_cod` ∈ {`r1d` (tripleta dublată, §8.3), `corectie_in_arbore` (diferența de lungime peste ±20 mm pe o bucată din arbore, §8.6)}. Ambele intră la fel: serverul acceptă operația (rezultatul `acceptat`) și scrie starea `conflict` cu motivul găsit. Oriunde tabelul de mai jos scrie „`conflict` (motiv)”, intrarea e permisă pe **oricare** motiv din listă; trigger-ul verifică `conflict_cod` în listă, nu doar `r1d`. Ieșirile din `conflict` nu depind de motiv.

| Din | În | Cine, prin ce |
|---|---|---|
| — | `ciorna` / `conflict` (motiv) | inginerul, `decl_salveaza` (`conflict` = un motiv din listă, găsit pe server) |
| `ciorna`, `conflict`, `blocata` | `ciorna` / `conflict` (motiv) (versiune nouă; `conflict` = un motiv din listă, găsit la revalidarea pe server, r4 / r6) | inginerul, `decl_salveaza` cu CAS, cât sesiunea e `deschisa` |
| `ciorna`, `conflict`, `blocata` | `stearsa` | inginerul, `decl_sterge`, cât sesiunea e `deschisa` |
| `ciorna` | `trimisa` (piesa identificată) / `in_verificare` (`identificare = 'nerezolvata'`, r4) | inginerul, `sesiune_trimite` |
| `trimisa`, `in_verificare` | `revizie_ceruta` / `respinsa` | MP-ul (`fn_izo_revizie_cere` / `fn_izo_respinge`) |
| `in_verificare` | `trimisa` / `conflict` (motiv) (versiune nouă, pe bucată; `conflict` = un motiv din listă) | inginerul (a) sau MP-ul (b), mai jos |
| `revizie_ceruta`, `conflict`, `blocata` (sesiune trimisă) | `trimisa` / `conflict` (motiv) / `in_verificare` (versiune nouă: `conflict` la un motiv din listă, `in_verificare` dacă piesa rămâne nerezolvată) | inginerul, `decl_salveaza` cu CAS |
| `revizie_ceruta`, `blocata`, `conflict` (sesiune trimisă; `conflict` adăugat în r5) | `respinsa` | MP-ul, `fn_izo_respinge`, cu motiv, oricând (ca la `trimisa`): un rând revenit `conflict` după revizie nu mai ține sesiunea deschisă dacă autorul e plecat sau revocat |
| `trimisa` | `aprobata` | MP-ul, `fn_izo_aproba` |
| `ciorna`, `conflict` (r5), `trimisa`, `in_verificare`, `revizie_ceruta` | `blocata` | serverul, când o dependență e revizuită, respinsă sau ștearsă (mai jos), în ambele tipuri de sesiune; starea veche se păstrează în `stare_inainte_blocare` (la `conflict`, și `conflict_cod` rămâne) |
| `blocata` (`dependenta_in_revizie`) | `stare_inainte_blocare` (inclusiv `conflict`, r5) | serverul, în lotul inginerului care salvează versiunea nouă a dependenței, când aceasta revine `trimisa` cu copilul folosit neschimbat (mai jos) și nicio altă dependență din lanțul rândului nu mai e în revizie sau anulată |
| `ciorna`, `conflict`, `blocata`, într-o sesiune `deschisa` **abandonată** (r3) | `respinsa` | MP-ul, `fn_izo_respinge`, cu motiv. „Abandonată” = frontul autorului pe tronson e inactiv sau expirat (eliberat de MP, §6.7) **sau** autorul nu mai are dreptul (modul / atribuire). Cât autorul are front valid, MP-ul nu-i respinge ciornele |

- **`aprobata` e finală**: nu se revizuiește, nu se respinge și nu primește versiuni noi (refuz `rand_aprobat`, pe orice canal). O greșeală descoperită după aprobare se repară în registru, prin storno / corecție (E2a), în afara E4; un design separat după pilot.
- **`respinsa`** și **`stearsa`** sunt finale.
- **Pierderea rezervării** (o ciornă a cărei rezervare a expirat și a fost preluată, §5.4) **nu e o tranziție**: rândul rămâne în starea lui, iar condiția derivată `rezervare_pierduta` oprește `sesiune_trimite` și aprobarea până la o versiune nouă sau ștergere. Deci nicio scriere pe rândul altui autor.
- **Un rând deja `blocata`** rămâne `blocata` la o nouă invalidare (r5): `stare_inainte_blocare` nu se suprascrie, iar `blocata_motiv` trece pe cel mai sever (`dependenta_anulata` înaintea `dependenta_in_revizie`). Nu e o tranziție nouă, ci aceeași stare cu motivul actualizat (permisă de trigger doar serverului, în operațiile care invalidează).
- **Sesiunea abandonată** (r3): după ce MP-ul a respins ultimul rând deschis, sesiunea trece `inchisa` în aceeași tranzacție (§3.2). Rezervările rândurilor respinse se eliberează (`respinsa`). Cu asta, oprirea fluxului (§3.1) nu poate rămâne blocată de un autor plecat sau revocat.
- **Închiderea sesiunii, în general** (r5): după orice decizie a MP-ului (aprobare, respingere, cascadă), o sesiune `trimisa` sau `deschisa` abandonată fără niciun rând deschis (`ciorna`, `trimisa`, `in_verificare`, `conflict`, `blocata`, `revizie_ceruta`) trece `inchisa` în aceeași tranzacție. Cu autorul revocat, drumul pe o sesiune trimisă e: MP-ul respinge rândurile rămase (inclusiv cele `conflict` / `blocata`) → sesiunea `inchisa` → oprirea fluxului poate trece.

**Invalidarea descendenților** (r2). Închiderea unei tăieri T = montajele și tăierile pe copiii ei declarați, sudurile cu capete pe acești copii și cuplările care depind de T, calculată tranzitiv:
- **T → `revizie_ceruta`**: descendenții neaprobați trec `blocata` (`dependenta_in_revizie`). Rezervările și literele lor rămân. Când T revine `trimisa`, la o versiune nouă:
  - copiii cu același uid și aceeași lungime rămân, iar dependenții lor revin la `stare_inainte_blocare` (cu `depinde_de_versiune` actualizat de server, în același lot, sub lock-urile din §5.4 pasul 1–2). La aprobare se revalidează oricum, iar amprenta se schimbă;
  - copiii schimbați sau dispăruți devin `anulata`: literele se eliberează, rezervările pe ei se eliberează (`parinte_anulat`), iar dependenții lor rămân `blocata` până la o versiune nouă a lor.
- **T → `respinsa` / `stearsa`**: toți copiii declarați devin `anulata`, iar rezervările pe ei se eliberează. Pentru fiecare descendent, MP-ul (`p_dependente`) alege `respinge` (în cascadă) sau `blocheaza` (inginerul îl salvează din nou, pe altă piesă). La `stearsa` (inginerul, în sesiune deschisă), descendenții trec `blocata`. **Decizia permisă, pe starea descendentului** (r5), ca nicio cascadă să nu ceară o tranziție lipsă din tabel:
  - într-o sesiune `trimisa` (`trimisa`, `in_verificare`, `revizie_ceruta`, `conflict`, `blocata`): `respinge` → `respinsa`, `blocheaza` → `blocata` (un `blocata` rămâne `blocata`, cu motivul `dependenta_anulata`);
  - într-o sesiune `deschisa` (`ciorna`, `conflict`, `blocata`): doar `blocheaza`, pentru că MP-ul nu respinge ciornele unui autor cu front valid; `respinge` e permis doar dacă sesiunea e abandonată (rândul de mai sus din tabel). Altă decizie → refuz `decizie_nepermisa`, pe tot apelul;
  - `p_dependente` are exact câte o decizie pe fiecare descendent din închiderea recalculată sub lock (§5.6, ca `p_decizii`).
- **T `aprobata`** nu se mai schimbă, deci nu invalidează nimic.

**Lock-urile invalidării pe birou** (r4): `fn_izo_revizie_cere` și `fn_izo_respinge` iau, ca aprobarea (§6.3 pasul 2), sesiunile și declarațiile rândului **și ale închiderii lui tranzitive** (descendenții neaprobați, în orice stare deschisă, plus sudurile lor), FOR UPDATE, după id, apoi rădăcinile (9). Închiderea se calculează înaintea lock-urilor și se recalculează după ele; dacă diferă → refuz `preview_vechi`, rollback total.

**Cum se aplică regulile**:
- **„Revizie cerută”** (de preferat, v2.3 §2.7):
  - doar pe rândul greșit, cu motiv;
  - rezervarea și literele rămân;
  - inginerul trimite o versiune nouă (`decl_salveaza` cu `versiune_baza`), care revine `trimisa`.
- **Respingerea**:
  - cu lista dependențelor afișată (copiii declarați, montajele lor, sudurile) și o decizie pe fiecare;
  - eliberează rezervările și literele; copiii declarați devin `anulata`.
- **Seria „în verificare”** (D2#2) se lămurește:
  - (a) de inginer, prin corectarea transcrierii: o versiune nouă, pe bucata găsită;
  - (b) de MP, prin legarea rândului de bucata reală (`fn_izo_serie_lamureste`, cu motiv); rezervarea se creează atunci. **Contractul** (r5):
    - sub lock-urile din §10.5 (sesiunea, declarația, rădăcina bucății), CAS pe `p_versiune`, rândul `in_verificare` și `identificare = 'nerezolvata'`;
    - bucata e a proiectului, disponibilă (regulile din §6.3 pasul 8 pentru montaj) și fără rezervare activă a altei declarații; altfel refuz (`bucata_rezervata` / `stare`), iar rândul rămâne `in_verificare`;
    - **un singur UPDATE** pe declarație: `bucata_id` = `p_bucata`, `identificare` = `bucata`, `stare` = `trimisa` (sau `conflict`, cu motivul din listă găsit pe bucata aleasă, de exemplu `r1d`), `versiune` + 1. CHECK-urile din §3.2 se evaluează pe rândul final, deci sunt adevărate după instrucțiune; `bucata_decl_uid` rămâne NULL;
    - plus versiunea în `izo_declaratii_versiuni`, rezervarea nouă pe `bucata_id` și jurnalul (`izo_operatii`, canalul `aprobare`, cheia `p_cheie`);
    - **trigger-ul de stări** îi permite lui `izo_montaj_writer` să schimbe `bucata_id` / `identificare` **doar** în această tranziție (`in_verificare` → `trimisa` / `conflict`, `nerezolvata` → `bucata`), sub contextul `fn_izo_serie_lamureste`; orice altă schimbare a lor de către writer (pe alt rând, spre `bucata_decl`, fără context) → refuz. Drepturile pe coloane sunt în §9.4;
  - (c) o bucată chiar necunoscută intră prin inventar / `gasit` (E3b), în afara E4.

  Cât seria e deschisă, rândul nu se aprobă, iar sudurile lui (amonte și aval) așteaptă. Restul lotului se aprobă.
- R1 nu se deblochează manual. Niciun rând nu se aprobă de autorul lui.

### 6.5 Depozitul (gestionarul: Cioc Janeta)

- **Ieșirea pe tronson** (Q-E4-2 A), `fn_izo_iesire_tronson`:
  - pentru bucățile `sosit` / `receptionat` / `retur` din depozitul ei, cu numărul avizului de hârtie (CJPT / CJPJ) și tronsonul;
  - scrie evenimentul `livrare`: bucata trece `pe_tronson`, cu `atribute.depozit_origine_id`;
  - refuză carantina și bucățile E3 fără PV;
  - o bucată deja rezervată de o declarație (montaj din depozit) poate ieși: asta e chiar regularizarea.
- **Primirea resturilor**:
  - lista „De primit” = resturile `in_tranzit` spre depozitul ei + resturile declarate și neaprobate, doar afișate („declarat, neaprobat”);
  - `fn_izo_primire_depozit` lucrează doar pe resturile aprobate (Q-E4-7 A). Evenimentul `confirmare_primire_depozit` le face `retur` (≥ `prag_rest_mm`) sau `rest_nereutilizabil` (sub prag), cu locul în depozit.
- **Autorizarea**: `gestionar` pe proiect ȘI pe depozit, ca în E3.

### 6.6 După aprobare: fișa de tăiere și pachetul (predarea către E5 / E5b / E8)

Fluxul owner-ului (Q8, Q9 A, #1788):
1. inginerul identifică și declară în teren;
2. MP-ul aprobă pe identificarea lui. În E4, asta e faptul în registru: stocul oficial scade;
3. **fișa de tăiere**, pentru fiecare țeavă tăiată (E5):
   - se printează din platformă și o semnează MP-ul;
   - merge la Transgaz și revine semnată de dirigintele de șantier (`coordonator_transgaz` = „Adrian Somesan”, ✓BD 21.10);
   - se scanează cu telefonul și se încarcă = `aprobata`;
4. pachetul de lansare care conține bucăți din acel arbore pleacă la Transgaz doar cu toate fișele `aprobata`. E5b îl marchează „DOCUMENT DE LUCRU”, iar E8 refuză emiterea.

**Ce dă E4 mai departe**:
- arborii tăiați: frunzele, literele finale, sudurile pe capete;
- lista „fișe de generat”, pe ecranul MP-ului;
- alerta `izo_fisa_lipsa` în `v_izo_alerte` (vedere live, `security_invoker`).

Circuitul fișei (`izo_fise_taiere*`, contorul FT, scanul) rămâne în E5.

### 6.7 Fronturi, revocări, oprirea fluxului, limite (r2)

- **Expirarea frontului** (`expira_la`):
  - operațiile dispozitivului primesc `front_expirat`, nejurnalizat; coada rămâne;
  - „Pregătește” (cu semnal) reînnoiește frontul, dacă nu l-a luat alt dispozitiv;
  - declarațiile rămân. Rezervările declarațiilor încă `ciorna` primesc `expira_dupa` = `expira_la` + 24 h și expiră **leneș**, fără cron: o altă declarație care cere aceeași resursă o preia (rezervarea veche devine `expirata`, sub lock-ul rădăcinii). Declarația veche **nu se scrie** (r3): rămâne cu `rezervare_pierduta` derivat, care îi oprește trimiterea (§5.4, §6.4). Rezervările rândurilor `trimisa` nu expiră: așteaptă MP-ul.
- **Eliberarea frontului de MP** (`fn_izo_front_elibereaza`, cu motiv): frontul devine inactiv, iar dispozitivul vechi primește `front_expirat`, apoi `alt_dispozitiv` dacă a luat altul frontul. Declarațiile lui rămân, cu regula de expirare de mai sus.
- **Recuperarea după `alt_dispozitiv`** (r3, utilizabilă în pilot): MP-ul vede în `v_izo_carantina_sync` ce așteaptă fiecare dispozitiv (autor, număr de operații, de când). Decide: cere predarea pe tableta care ține frontul, sau eliberează frontul ei (cu motiv). Dispozitivul care aștepta face „Pregătește”, iar coada lui pleacă cu aceleași `op_id`-uri, validată pe starea de atunci: ce s-a suprapus între timp (aceeași țeavă, aceeași sudură) iese `conflict` pe rândul lui, ca orice conflict. Nimic nu se pierde și nimic nu se aplică fără validare.
- **Revocarea accesului** (cheia de modul, atribuirea, `activ = false`, `valabil_pana` trecut):
  - loturile autorului sunt refuzate întregi (`fara_drept`), nejurnalizate, fără efecte;
  - ciornele lui nu se mai pot trimite; rezervările lor expiră leneș (24 h). MP-ul le respinge explicit, cu motiv, ca rânduri ale unei sesiuni abandonate (§6.4): `fn_izo_respinge` ia întâi frontul tronsonului FOR SHARE (ordinea §10.5: frontul înaintea sesiunii), apoi sesiunea și declarațiile, și verifică sub lock că frontul autorului e inactiv / expirat sau că autorul n-are drept (prin `fn_izo_montaj_autorizare_lock` pe autor). Rezervările se eliberează, iar sesiunea fără rânduri deschise se închide;
  - rândurile deja `trimisa` rămân aprobabile: declarația era autorizată la acceptare, iar dovada e în `izo_operatii`. Lotul arată alerta `izo_autor_fara_drept`;
  - aprobatorul revocat e refuzat la pasul 4 din §6.3 (testul de cursă revocare ↔ aprobare, §11.5).
- **Oprirea fluxului** pe tronson: §3.1. E refuzată cât există rezervări active, declarații deschise sau un front activ. Cu un autor absent, drumul e: eliberarea frontului → respingerea rândurilor sesiunii abandonate → sesiunea închisă → oprirea (testul 17). Pe o sesiune deja trimisă (r5): MP-ul respinge rândurile rămase, inclusiv cele `conflict`, `blocata` sau `revizie_ceruta` → sesiunea `inchisa` → oprirea (testul 20).
- **Limitele** (disponibilul nu poate fi blocat abuziv):
  - pe autor: cel mult 60 de rezervări active, din care cel mult 10 pe bucăți din depozit („cere ieșirea”); valorile se confirmă la pilot;
  - cel mult 200 de declarații pe sesiune și 50 de operații pe lot;
  - cel mult 600 de operații pe oră pe autor, numărate în `izo_operatii` (index pe `autor_profile_id`, `ora_server`);
  - r3: cel mult 30 de apeluri pe minut pe (profil, funcție), numărate **înaintea porții** în `izo_rata_apeluri` (§5.4 pasul 0.4), deci și refuzurile, duplicatele și instantaneele repetate costă din limită;
  - peste limită → `limita`, nejurnalizat;
  - doar bucăți ale proiectului: de pe tronsonul sesiunii sau din depozitele proiectului;
  - MP-ul vede rezervările active (cine, de când, ce sesiune) pe ecranul de aprobare și le poate elibera prin respingere: rândurile trimise oricând, ciornele doar într-o sesiune abandonată (§6.4).

## 7. Legătura bucată ↔ `executie_tevi`: picker-ul devine legătura reală

### 7.1 Regula

- Adevărul despre montaj e registrul: bucata `montata` pe tronson + sudurile. `executie_tevi` e doar proiecția lui în pachet.
- Legătura rămâne una singură, cea existentă: `magazie_bucati.executie_teava_id` → `executie_tevi(id)`. FK-ul NO ACTION e arbitrul din 2c; indexul nou `ux_magbuc_izo_teava` cere o bucată pe rând.
- Pe tronsoanele în flux:
  - rândurile `teava` / `curba` / `legare` le scrie doar `izo_montaj_writer` (§7.4);
  - câmpurile de identitate ale unui rând legat se iau din registru, nu se tastează.
- **Rândul legat** (r7), după `tip_rand`. Definiția o folosesc aprobarea Transgaz (§7.3, §7.4) și activarea fluxului (§3.1, §7.4):
  - `teava` / `curba`: legat = exact o bucată cu `executie_teava_id` = rândul (indexul `ux_magbuc_izo_teava`), `montata` pe tronsonul pachetului, de același tip;
  - `legare` (cuplarea): nu are bucată, deci nu trece prin `executie_teava_id`. E legat de sudura lui de cuplare, găsită din `sudura_cod` (fără coloană nouă, §3.4), dacă trece **verificarea `legare`** (§7.3);
  - orice alt `tip_rand` (de exemplu `separator`) pe un pachet în flux = nelegat (fail-closed). Pe tronsoanele în flux nu-l scrie nimeni: clientul e refuzat (§7.4), iar `completeaza` nu-l produce.

### 7.2 `fn_izo_pachet_completeaza(p_cheie, p_pachet, p_updated_at, p_sudura_de, p_sudura_pana)`

- MP-ul alege pachetul și intervalul de suduri. Antetul pachetului îl creează ca azi, pe tronsonul în flux.
- **Rândurile noi**:
  - serverul adaugă rândurile bucăților `montata` nelegate din interval;
  - ordinea vine din lanț (după capete), nu după numerele sudurilor;
  - rândul i = bucata i + sudura ei aval (convenția IZO); cuplările dau rânduri `legare`;
  - r7: o cuplare dă un rând `legare` doar cu sudura `aprobata`, iar rândul trece verificarea `legare` (§7.3). Verificarea rulează după scrierea tuturor rândurilor apelului, înaintea jurnalului; un refuz anulează tot apelul;
  - r7 (review r7): **pachetul de cuplare**. Un interval format doar din cuplare (`p_sudura_de` = `p_sudura_pana` = sudura de cuplare) dă un pachet cu un singur rând, `legare`, fără rânduri de piese. E cazul cuplării dintre două lanțuri ale căror piese terminale sunt deja în pachete aprobate (P1 / P2): pachetele lor nu se mai schimbă (r6), iar piesele rămân legate acolo. Apartenența cuplării la tronson se dovedește prin sudura aprobată și capetele ei (§7.3, verificarea `legare`), nu printr-o piesă din același pachet.
- **Refuză**:
  - golurile din lanț (un capăt fără sudură în interiorul intervalului). r7: o cuplare din interval încă `declarata` e tot un gol;
  - r7: un rând `legare` care nu trece verificarea `legare` (§7.3), cu codul ei;
  - pozițiile încă „în verificare”;
  - un interval care se suprapune cu alt pachet activ. r7: suprapunerea se judecă pe ce ar adăuga apelul (o bucată din interval deja legată de rândul altui pachet; o cuplare deja purtată de rândul `legare` al altui pachet → `legare_dubla`), nu pe numerele sudurilor. Piesele terminale ale lanțurilor vecine, din afara intervalului, nu intră în suprapunere;
  - un pachet ne-editabil (`pachet_needitabil`, r6, mai jos).
- **Pachetul editabil** (r6). Toți scriitorii **structurali** ai pachetului (`completeaza`, `leaga`, `dezleaga`) cer, la revalidarea din §7.3 pasul 6, deci **sub lock-ul pachetului** luat la pasul 3, ca antetul să fie încă editabil:
  - `status` = starea inițială (`draft`), iar `aprobat_*` și `pdf_aprobare_*` sunt NULL;
  - valorile `status` din UI-ul de azi (`src/Izometrie.jsx`): `draft`, `trimis_aprobare`, `aprobat`, `lansat`, `finalizat`. Lista exactă se ia din CHECK-ul BD la implementare; orice valoare în afară de `draft` e ne-editabilă (fail-closed);
  - altfel → refuz `pachet_needitabil`, zero efecte (rollback total, nimic jurnalizat). Singura excepție: `leaga` pe un rând deja legat de aceeași bucată rămâne fără efect (idempotența naturală), fără refuz;
  - fiecare scriere structurală mută explicit `updated_at` pe antet, în aceeași tranzacție (nu doar prin cascada totalurilor), ca CAS-ul aprobării Transgaz să vadă orice schimbare (§7.4);
  - `fn_izo_pachet_rand_note` nu e structurală (scrie doar cele patru note, nu lista de țevi, lungimile, sudurile sau ordinea): merge și pe un pachet aprobat, jurnalizată în `izo_operatii` (canalul `pachet`).
  - pe pilot, o schimbare după aprobare se face printr-un pachet nou (montajele încă nelegate); anularea unei aprobări (revenirea la `draft`, cu documentul păstrat ca istoric) e un design separat, în E8. Pe tronsoanele fără flux (T12), editorul vechi rămâne neschimbat.
- `poz_in_pachet` și `poz_km_m` le recalculează trigger-ele existente (DEFINER, owner `postgres`, ✓BD 21.10).

### 7.3 `fn_izo_pachet_leaga(p_teava, p_bucata, p_updated_at)` / `fn_izo_pachet_dezleaga(p_teava, p_motiv)` — contractul E4a din #823

**Ordinea de lock**, în trepte (r2: aceeași pentru toți scriitorii pachetului: `leaga`, `dezleaga`, `completeaza`, `transgaz`; r3: și `fn_izo_pachet_rand_note`, fără pasul 7, bucata):
1. schema → autorizarea (MP);
2. **proiectul și locațiile** FOR SHARE (`fn_izo_blocheaza_locuri`); o pre-verificare a fluxului, fără lock, refuză devreme un pachet care nu e pe un tronson în flux;
3. **pachetul** FOR NO KEY UPDATE, direct (apoi `fn_izo_proiecte_pachet_blocat` nu mai așteaptă nimic) și tronsonul lui FOR SHARE;
4. **rândul / rândurile `executie_tevi`** FOR NO KEY UPDATE, după id;
5. tabelele → advisory partajat (lock-urile pe rânduri vin înaintea advisory-ului, ca în protocolul E2a);
6. revalidarea, pe starea comisă:
   - fluxul, citit acum (după advisory): pachetul e pe un tronson în flux;
   - rândul e încă în pachetul din cerere: CAS pe `pachet_id`, plus `updated_at`, verificat aici pe server. `actualizeazaRandInPachet` din #824 face CAS doar pe `id` + `pachet_id` (`src/lib/izoRegistru.js`); `updated_at` e în plus, în E4;
   - proiectul pachetului = proiectul tronsonului = proiectul bucății;
   - r6: la scriitorii structurali (`completeaza`, `leaga`, `dezleaga`), pachetul e încă editabil (§7.2); la `transgaz`, CAS pe `updated_at`-ul antetului (§7.4);
7. bucata FOR UPDATE. r7: apoi sudurile de cuplare ale rândurilor `legare`, după id (sudurile vin după bucăți, ca în §10.5 pasul 9): FOR UPDATE la `completeaza` (arbitrul „o sudură ↔ un rând `legare`”, ca bucata la `leaga`), FOR SHARE la `transgaz` (doar citire). `izo_montaj_writer` are UPDATE pe `izo_suduri` (§9.4), deci lock-ul nu cere helper.

**De ce FOR NO KEY UPDATE (nu FOR SHARE) pe rândul țevii și pe pachet** (r2):
- contractul 2c (`fn_izo_refuz_mutare_tevi`) cere un lock care intră în conflict cu FOR UPDATE-ul gărzii mutării, ca legarea să fie văzută. FOR NO KEY UPDATE intră și el în conflict, deci contractul rămâne respectat. Dar contractul 2c acoperă doar legătura (`executie_teava_id`), iar E4 mai scrie câmpurile de identitate ale rândului și, prin cascadele DEFINER, totalurile pachetului;
- cu FOR SHARE urmat de UPDATE, două legări concurente pe același rând (sau pe același pachet) ar urca amândouă de la SHARE la UPDATE, deci interblocaj. Cu FOR NO KEY UPDATE de la început, a doua așteaptă, iar UPDATE-ul nu mai urcă nimic;
- FOR NO KEY UPDATE nu intră în conflict cu KEY SHARE-ul luat de FK-ul `magazie_bucati.executie_teava_id`;
- testele: harness-ul 4j3, în ambele ordini, reluat pe funcția reală; plus două `leaga` pe același rând, două pe același pachet și `leaga` ↔ `completeaza`, cu `pg_locks` care arată așteptarea și fără deadlock (§11.5).

**Verificările**:
- bucata e `montata` pe tronsonul pachetului, de tipul rândului (`teava` ↔ `teava`, `curba` ↔ `curba`), și nu e legată de alt rând;
- rândul e nelegat. Dacă e deja legat de aceeași bucată, apelul nu mai are efect;
- r7: `leaga` / `dezleaga` pe un rând `legare` (sau pe orice `tip_rand` în afară de `teava` / `curba`) → refuz `rand_fara_bucata`, zero efecte. Rândul `legare` nu se leagă de o bucată, ci se verifică prin sudura lui (mai jos).

**Verificarea `legare`** (r7). Rulează la `completeaza` (pe rândurile `legare` scrise de apel, §7.2) și la `transgaz` (pe fiecare rând `legare` al pachetului), pe starea comisă, după lock-urile de mai sus (pasul 7: sudura). Un refuz e o excepție: zero efecte.
1. **Sudura**: `fn_izo_sudura_normalizeaza(sudura_cod, tronsonul pachetului)` dă (`nr`, `sufix`); în `izo_suduri` există exact o sudură cu `proiect_id` / `tronson_id` = ale pachetului, același (`nr`, `sufix`) și `stare <> 'anulata'` (UNIQUE-ul din §3.2 o face cel mult una). Cod nenormalizabil sau nicio sudură → `legare_fara_sudura`. Căutarea e doar pe tronsonul pachetului, deci o sudură de pe alt tronson nu se găsește.
2. **Tipul și starea**: `tip_sudura = 'cuplare'` și `stare = 'aprobata'`. Altfel → `legare_sudura_neaprobata`: o cuplare încă `declarata` sau o sudură `linie` / `reparatie` pe un rând `legare`. O sudură anulată după completare (din E10) nu mai e găsită la pasul 1 → `legare_fara_sudura`.
3. **Tronsonul**: proiectul și tronsonul sudurii = ale antetului pachetului = ale tronsonului lui (verificate explicit, nu doar prin căutare).
4. **Capetele** (R4): exact două capete active (`amonte`, `aval`). Fiecare stă pe o bucată din registru (`bucata_id`, nu `bucata_decl_uid`: la aprobarea sudurii, capetele trec pe `bucata_id`, §6.3 pasul 9), `montata` pe tronsonul pachetului. Altfel → `legare_capete`. Bucățile capetelor **nu** trebuie să fie în același pachet (review r7): pot fi legate de rânduri ale altor pachete (și aprobate) sau nelegate; cuplarea aparține tronsonului prin sudura aprobată și capetele ei, deci un pachet de cuplare (doar rândul `legare`, §7.2) e valid.
5. **Unicitatea**: niciun alt rând `legare` de pe tronson (din orice pachet, oricare `status`) nu duce aceeași sudură. Altfel → `legare_dubla`. La `completeaza`, lock-ul FOR UPDATE pe sudură (pasul 7) serializează două completări cu aceeași cuplare, pe pachete diferite: a doua așteaptă, recitește după commit-ul primei (READ COMMITTED) și e refuzată.
6. **Proiecția**: rândul = `fn_izo_pachet_rand_asteptat` pe sudură: `tip_rand = 'legare'`, `sudura_cod` = codul afișat (§3.5), fără serie / șarjă / tip / lungime (§3.4). Altfel → `legare_proiectie`.

Verificarea pe bucată (`executie_teava_id`) se aplică **doar** rândurilor `teava` / `curba`. Pe un rând `legare`, verificarea de mai sus o înlocuiește.

**Scrierile**, sub același context (`leaga`):
- `executie_teava_id` pe bucată;
- câmpurile de identitate ale rândului, din registru (forma `patchDinRegistru`, calculată pe server).

**`dezleaga`**: doar cu motiv; refuzat pe un pachet ne-editabil (§7.2, r6: aprobat de Transgaz, emis în E8 sau orice `status` ≠ `draft`). Rândul rămâne în pachet, nelegat; `fn_izo_pachet_aprobare_transgaz` refuză un pachet cu rânduri nelegate, în sensul din §7.1 (r7): un rând `teava` / `curba` fără bucata lui → `rand_nelegat`; un rând `legare` care nu trece verificarea `legare` → codul verificării; orice alt `tip_rand` → `rand_nelegat`. Un pachet valid cu o cuplare (rândurile pieselor legate + rândul `legare` verificat) trece.

**Interblocajul** (r3, pe cascadele reale, ✓BD 21.10):
- cascadele pe `executie_tevi` (toate DEFINER, owner `postgres`): `tg_tevi_update_totaluri` (AFTER ROW, la **orice** INSERT / UPDATE / DELETE) face UPDATE pe pachet; `trg_executie_tevi_update_recalc` / `_insert_recalc` / `_delete_recalc` (AFTER STATEMENT) recalculează km-ul pe rândurile pachetului; `tg_tevi_renumber` (BEFORE INSERT) renumerotează. Pe pachet: `trg_executie_pachete_recalc_poz_km` (AFTER UPDATE, doar la `km_start_m`) ia rândurile;
- deci o scriere din client pe un rând, **chiar și doar pe `observatii`**, ia rândul, apoi pachetul (prin totaluri) — ordinea inversă scriitorilor E4 (pachetul, apoi rândurile). De aceea, pe tronsoanele în flux, `a0_izo_flux_tevi` refuză **orice** INSERT / UPDATE / DELETE din client pe rânduri (§7.4). Refuzul vine în trigger-ul BEFORE: clientul ține doar lock-ul implicit al rândului, fără să fi atins pachetul, iar AFTER-urile nu mai rulează. Notele (observații, coduri NDT) trec prin `fn_izo_pachet_rand_note`, cu ordinea scriitorilor de pachet;
- pe tronsoanele în flux, UPDATE-ul km-ului pachetului din client e refuzat (calea 21), deci recalculul km-ului (pachet → rânduri) nu rulează din client;
- o scriere din client pe antetul unui pachet în flux (coloanele permise, §7.4) ia doar pachetul și nu pornește nicio cascadă spre rânduri, deci nu poate face ciclu cu un scriitor E4 (care ia tot pachetul întâi);
- cascadele pornite de scriitorii E4 (totalurile, km-ul, renumerotarea) rulează sub lock-ul pachetului deja ținut de ei; rândurile în plus pe care le ating sunt ale aceluiași pachet, deci două scriitoare E4 se serializează pe pachet;
- în rest (tronsoanele fără flux, unde E4 nu scrie), ordinea 2c rămâne neschimbată; dacă PostgreSQL găsește totuși un ciclu, anulează una dintre tranzacții: fail-closed, fără stare parțială.

### 7.4 Garda pe tronsoanele în flux (E4a: căile 1, 4, 5, 7, 8, 18, 21)

- **OLD și NEW, peste tot** (r2). Proiectul rămâne la `stoc`, deci verificarea 2c pe `montaj` (care se uită la ambele pachete) nu prinde tronsoanele în flux. Gărzile E4 se uită la tronsonul pachetului vechi **și** la al celui nou:
  - un rând mutat de pe un pachet T12 pe un pachet T14 (NEW în flux) sau invers (OLD în flux) → 42501;
  - un antet de pachet mutat pe alt tronson (`tronson_id` / `proiect_id`), dinspre sau spre un tronson în flux → 42501;
  - INSERT-ul verifică NEW, DELETE-ul OLD, UPDATE-ul pe amândouă.
- **Cum se citește fluxul în gardă, fără ciclu cu activarea**:
  1. pachetul → tronsonul, citite fără lock: pe un tronson în flux, `tronson_id` / `proiect_id` ale antetului nu se pot schimba, iar mutarea spre un tronson în flux e refuzată;
  2. citirea fluxului pentru OLD și NEW, fără lock: dacă oricare e în flux → refuz imediat, fără alte lock-uri (refuzul e fail-closed, deci nu cere stabilitate);
  3. altfel: advisory partajat pe proiectele OLD / NEW (`fn_izo_lock_partajat`, crescător) și recitirea fluxului. O activare concurentă (advisory exclusiv, §3.1) e fie așteptată și văzută (refuz), fie ajunge după commit-ul mutării. Activarea cere apoi 0 rânduri de pachet nelegate pe tronson (§7.1, r7: și rândurile `legare` fără sudura de cuplare verificată), deci o mutare comisă chiar înainte o oprește.
- **Numele trigger-elor** (r3) sortează **primele** dintre trigger-ele BEFORE ale tabelului, nu doar înaintea celor E2a / 2c: `a0_izo_flux_tevi`, `a0_izo_flux_pachete`, `a0_izo_flux_documente` < `tg_…` (cele vechi, ✓BD 21.10) < `trg_…`. Motivul: `tg_tevi_renumber` (BEFORE INSERT, DEFINER) face UPDATE pe alte rânduri ale pachetului, iar `tg_pachete_lansare_assign_numar` (BEFORE INSERT) ia proiectul FOR UPDATE; cu numele vechi, ar rula înaintea refuzului. Așa, refuzul vine înaintea oricărei cascade și înainte ca garda 2c să ia pachetul FOR SHARE. Poarta verifică ordinea: niciun trigger BEFORE pe cele trei tabele nu sortează înaintea celui E4 (§10.7).
- **Crearea unui antet din client** (permisă și pe un tronson în flux): la INSERT, `a0_izo_flux_pachete` nu ia niciun lock (crearea e permisă în ambele stări). Ordinea rămâne cea veche: proiectul FOR UPDATE (`tg_pachete_lansare_assign_numar`), apoi advisory-ul partajat (garda 2c), adică aceeași direcție ca scriitorii E4 (proiectul înaintea advisory-ului), deci fără ciclu. Câmpurile interzise din client pe un tronson în flux (`status` ≠ inițial, `aprobat_*`, `pdf_aprobare_*`) le verifică un trigger AFTER ROW (`a0_izo_flux_pachete_dupa`), care recitește fluxul **după** advisory-ul luat de garda 2c. O activare concurentă e deci fie așteptată și văzută (refuz), fie comisă după antet; iar activarea cere tronsonul fără rânduri nelegate și fără anteturi aprobate.
- **`a0_izo_flux_tevi`** (BEFORE INSERT / UPDATE / DELETE), pe pachetele unui tronson în flux:
  - din client: **nimic** (r3) → 42501, inclusiv `observatii`, `pm_cod`, `pa_ut_cod`, `ut_cod` (motivul: cascada totalurilor, §7.3). Acestea patru se scriu prin `fn_izo_pachet_rand_note` (CAS pe `updated_at`, autorizare: `inginer_izometrie`, `manager_aprobator` / `inlocuitor_aprobator` pe proiect sau owner). UI-ul editorului folosește RPC-ul pe tronsoanele în flux și UPDATE-ul direct pe celelalte;
  - scriitorul trece doar sub context (`completeaza` / `leaga` / `dezleaga` / `nota`) și doar cu rândul așteptat (proiecția exactă, `fn_izo_pachet_rand_asteptat`; la `nota`, doar cele patru coloane + `updated_at` diferă);
  - cascadele DEFINER existente (renumerotarea, recalculul km, totalurile) rulează ca `postgres`. Sunt acceptate doar când contextul E4 al tranzacției e valid ȘI se schimbă doar coloanele derivate:
    - pe rânduri: `poz_in_pachet`, `poz_km_m`, `updated_at`;
    - pe pachet: `nr_tevi`, `total_lungime_m`, `nr_pending_sant`, `updated_at`.
- **Antetul pachetului** (`executie_pachete_lansare`) pe un tronson în flux:
  - se creează din client;
  - `km_start_m`, `status`, `aprobat_*`, `pdf_aprobare_*` și DELETE sunt refuzate din client;
  - starea „aprobat” se pune doar prin `fn_izo_pachet_aprobare_transgaz` (fișierul la o cale dată de server; documentul și starea într-o tranzacție). r6: cu **CAS pe `p_updated_at`** = `updated_at`-ul antetului afișat pe ecranul de încărcare, lângă conținutul pachetului pe care MP-ul îl confirmă ca fiind cel din PDF-ul semnat. Ordinea de lock e a scriitorilor de pachet (§7.3), deci cu `completeaza` se serializează pe pachet: completarea comisă întâi mută `updated_at` → aprobarea e refuzată (`pachet_schimbat`) și ecranul reîncarcă; aprobarea comisă întâi → completarea vede pachetul ne-editabil (`pachet_needitabil`).
  - r7: înaintea scrierii, după CAS, aprobarea verifică fiecare rând după tipul lui (§7.1): `teava` / `curba` legate de bucată; `legare` prin verificarea `legare` (§7.3), cu sudurile de cuplare FOR SHARE la pasul 7. O aprobare a unei tăieri care mută capătul unei cuplări (pe o bucată nelegată de niciun pachet; una legată nu se taie, `bucata_in_pachet`, §8.5) ia sudura FOR UPDATE (§6.3, §10.5 pasul 9), deci cele două se serializează pe sudură și verificarea vede starea comisă. Un rând nevalid → refuzul lui, zero efecte (statusul rămâne `draft`, niciun document).
- **`executie_pachete_documente`** e doar-adaug pe pachetele tronsoanelor în flux: politicile 20261029a permit UPDATE / DELETE celor cu acces de scriere, deci un trigger E4 (`a0_izo_flux_documente`) le refuză acolo. În Storage (`executie-pachete-pdf`) nu există UPDATE / DELETE pe pachetele tronsoanelor în flux. **Frontiera (r2, decizia Răzvan A, 23.10.2026):** pe Supabase, `storage.objects` aparține lui `supabase_storage_admin`, așa că pe ea nu putem pune trigger-e. Imuabilitatea se face prin două politici RLS **RESTRICTIVE**: `izo_flux_pdf_imuabil_upd` / `_del` (TO public), cu predicatul `fn_izo_flux_pdf_blocat(bucket, name)`. Ea e garantată **doar pentru clienți** (`anon` / `authenticated`, adică orice apel din aplicație, inclusiv storage-api cu JWT de utilizator). Rolurile de server și admin care ocolesc RLS (`service_role`, `postgres` cu BYPASSRLS, proprietarul `supabase_storage_admin`) rămân în afara protecției, ca la toate bucket-urile. Pentru acum NU se adaugă o dovadă de modificare (amprentă eTag / size la aprobare); dacă devine necesară, e o variantă B separată.
- **`executie_tronsoane`**: km-ul unui tronson în flux nu se schimbă din client.
- **RLS-ul** (r3, corectat): pe pachete, documente și Storage rămâne cel din 20261029a (`fn_executie_pachete_acces`). Pe `executie_tevi` RLS-ul existent e larg (`executie_tevi_modify`, ALL, `auth.uid() IS NOT NULL`; ✓BD 21.10, §1.1 #15), deci pe tronsoanele în flux bariera e doar trigger-ul E4 de mai sus, care intră în poartă (numele, corpul, `tgenabled = 'A'`). Scrierile pe tronsoanele în flux trec prin RPC.

### 7.5 Picker-ul (UI, `src/Izometrie.jsx`)

- **Pe un tronson în flux**:
  - lista = bucățile `montata` nelegate ale tronsonului (nu `pe_tronson`);
  - alegerea cheamă `fn_izo_pachet_leaga`: o singură scriere, pe server;
  - r7: pe un rând `legare`, picker-ul nu se deschide; rândul arată sudura de cuplare și rezultatul verificării `legare` (§7.3);
  - butonul „Adaugă din montajele aprobate” → `fn_izo_pachet_completeaza`.
- **Pe celelalte tronsoane** (T12 etc.): `patchDinRegistru` + `actualizeazaRandInPachet` rămân ca azi (text). Legarea istorică vine cu E4c (Q-E4-5).

## 8. Tăierea unei țevi

### 8.1 Gestul de pe tabletă („Țeavă tăiată”) dă 2 declarații

- Inginerul confirmă întâi lungimea țevii întregi, cu cifrele de pe marcaj. Dacă marcajul ≠ stoc, restul se calculează din marcaj (corecție), dar doar pe o rădăcină fără descendenți (§8.6).
- Apoi tastează lungimea montată. Tableta produce:
  - `taiere`: geometria, adică un punct la lungimea montată, de la capătul A; copiii = piesa montată AC + restul CB;
  - `montaj`: pe copilul AC, cu `depinde_de_uid` = tăierea.
- „Tăiat și la capătul B” (opțiune pliată): 2 puncte → 3 copii, într-un singur eveniment.
- Capătul montat e A implicit; opțiunea e pliată.

### 8.2 Geometria și literele

- Σ copiilor = baza, exact (pierdere 0, Q4 A). Toleranța de ±20 mm e doar între măsurat și aviz / stoc.
- Literele le rezervă serverul la acceptare, în ordinea sosirii (următoarea literă nefolosită în arbore), și le fixează la aprobare. Tableta nu le afișează (D#1: doar pe fișă).
- R3 pe frunze: Σ `lungime_mm` a frunzelor (stare ∉ {`taiata`, `anulata`}) = rădăcina, exact.

### 8.3 Identitatea (Q1 B)

- **Regula**: două frunze active (sau declarate) cu aceeași serie + șarjă + lungime la cm se blochează, inclusiv surorile din aceeași țeavă. O tăiere 12 → 4 + 4 + 4 trece doar cu lungimile reale (4,00 / 3,99 / 4,01).
- **Cine o aplică**:
  - tableta blochează salvarea normală și deschide remăsurarea (prototip `eqPiece`);
  - serverul, dacă rândul ajunge totuși, îl acceptă (rezultatul `acceptat`) cu **starea** `conflict`, `conflict_cod = r1d` (§5.4, r5); inginerul îl repară cu o versiune nouă, pe lungimea reală;
  - aprobarea refuză;
  - indexul `ux_magbuc_izo_frunza` e ultima barieră: părintele trece `taiata` înainte să se nască copiii.
- **Rotunjirea la cm** = `round(mm / 10)`, aceeași pe tabletă și în coloana generată `lungime_cm`.

### 8.4 Restul merge în depozit (Q3 B)

- Tot restul pleacă în depozit, cu aceeași serie și șarjă, fără aviz.
- Destinația e depozitul de origine al țevii (`atribute.depozit_origine_id`). Pentru o bucată fără origine, MP-ul alege la aprobare.
- Sub `prag_rest_mm` (500 mm, de confirmat), la primire restul devine `rest_nereutilizabil`: rămâne în depozit, dar nu e propus la montaj.
- Pe rest se scrie cu markerul: serie · șarjă · lungime · din TRxSy (prototip `restLbl`). Codul bucății nu se scrie.
- În E4 nu există deșeu pe tabletă (Q-E4-7).

### 8.5 Tăierea unei bucăți deja montate (r2: trei ramuri separate)

Ramura se stabilește pe server, după capetele **active** ale părintelui `montata` (`izo_suduri_capete`), nu după ce declară tableta. Pe toate ramurile:
- părintele trece `taiata`, iar copiii rămași în șanț se nasc `montata`, pe tronson;
- în același eveniment `taiere`, fiecare capăt sudat activ al părintelui se dezactivează și se reactivează pe copilul care conține litera lui (aceeași sudură, aceeași literă). Garda verifică: numărul capetelor active pe fiecare sudură atinsă e același înainte și după (R4), iar niciun capăt nu rămâne pe părintele `taiata`;
- resturile pleacă în depozit (§8.4); R3 pe rădăcină rămâne exact.

**Ramura 1 — capătul liber** (cuplare / tie-in, D#13; tabletă și laptop):
- părintele are **exact un** capăt sudat activ (de exemplu A, la sudura amonte), iar celălalt capăt e liber;
- un singur punct de tăiere: copilul cu capătul sudat rămâne `montata` și preia sudura; celălalt copil e rest;
- apoi declarația `cuplare` leagă noul capăt liber al copilului de celălalt capăt de lanț, cu sudura ei. Nu există sudură cu un singur capăt;
- un părinte cu **ambele** capete sudate nu intră pe ramura 1: refuz `ramura_gresita`.

**Ramura 2 — tăiere în mijloc, pe o bucată sudată la ambele capete** (cut-out pe o țeavă, D2#11; în E4 doar de pe laptop, Q-E4-12 A). **Contractul laptopului** (r3):
- laptopul e un dispozitiv al **inginerului** (`inginer_izometrie`), cu aceeași rută `/izometrie/teren`, același `fn_izo_sync_push` și aceeași coadă; ecranul ramurii 2 e vizibil doar pe ecrane late;
- frontul e unul singur pe tronson: tableta îl predă („Predă”: coada goală, sesiunea trimisă), laptopul face „Pregătește” și ia frontul; apoi invers. Un laptop fără front primește `alt_dispozitiv`, ca orice dispozitiv;
- autorul declarației e inginerul logat; MP-ul **nu declară** (n-are `inginer_izometrie`), deci regula „nimeni nu-și aprobă rândurile” rămâne neatinsă.

Geometria ramurii 2:
- două puncte de tăiere → 3 copii: stânga (cu capătul amonte, preia sudura amonte), mijlocul (rest → depozit), dreapta (cu capătul aval, preia sudura aval). **Ambele** suduri se mută, fiecare pe copilul ei;
- golul rămas se închide cu un montaj (piesa de inserție) și două suduri noi, în același lot sau mai târziu. Până atunci, lanțul are două capete libere, nu suduri cu un capăt (R4 rămâne adevărat);
- o tăiere cu un singur punct pe o bucată sudată la ambele capete ar lăsa o sudură pe un copil care nu conține litera ei: refuz `ramura_gresita`.

**Ramura 3 — scoaterea unei suduri** (cut-out de sudură, repararea unei suduri respinse la NDT): **refuzată în E4** (`ramura_neacoperita`). Cere anularea sudurii (`anulata`, cu motiv) și două tăieri pe țevile vecine, plus legătura cu NDT. Intră în E10.

**Bucata legată de un rând de pachet** (`executie_teava_id` NOT NULL, §7):
- aprobarea unei tăieri pe ea e refuzată (`bucata_in_pachet`), pe orice ramură, cât legătura există;
- MP-ul o dezleagă întâi (`fn_izo_pachet_dezleaga`, cu motiv). Pe un pachet aprobat de Transgaz (sau emis, E8), dezlegarea e refuzată, deci tăierea nu se aprobă în E4;
- după aprobare, copilul (copiii) rămas în șanț se leagă din nou (`fn_izo_pachet_leaga`) sau intră prin `fn_izo_pachet_completeaza`. Proiecția rândului (lungimea, `lungime_originala_m`, sudura aval) se recalculează din registru, prin `fn_izo_pachet_rand_asteptat`;
- așa, aprobarea nu scrie niciodată în `executie_tevi`: legătura și proiecția pachetului rămân la scriitorii lor (§7.3), cu ordinea lor de lock-uri.

### 8.6 Corecția de lungime (r2: doar pe o rădăcină fără descendenți)

- **Unde e permisă**: doar pe o bucată care e propria rădăcină (`parinte_id IS NULL`), fără niciun copil în registru și fără copii declarați (neanulați) de **altă** declarație. Copiii declarați de aceeași declarație care poartă corecția (tăierea cu `marcaj_diferit`, §8.1) nu contează (r3): sunt efectul ei, nu descendenți preexistenți. Rădăcina e atunci singura frunză în momentul corecției, deci R3 (Σ frunze = rădăcina) rămâne adevărat după ea.
- **Corecția urmată de tăiere** (marcajul ≠ stoc, §8.1) e **o singură declarație** `taiere`, cu `confirmare.mod = marcaj_diferit`. La aprobare dă două evenimente, în ordine: `corectie`, apoi `taiere` (§6.3). Tăierea pornește de la lungimea corectată (`baza_mm`), iar Σ copiilor = baza, exact. Verificarea „fără descendenți” se face pe starea dintre cele două evenimente: rădăcina fără copii în registru și fără copii declarați de alte declarații.
- **În arbore** (bucata are părinte sau copii): `corectie` e **refuzată explicit** (`corectie_in_arbore`), la sincronizare (rând blocant) și la aprobare. Exemplul: rădăcina 12 m, copiii 8 + 4; corectarea unui copil la 4,1 ar da 12,1 m. Ce se face:
  - la tăierea unui copil, `baza_mm` = lungimea lui din registru, exact (altfel R3 s-ar rupe); măsurătoarea tabletei rămâne doar pe declarație. O diferență peste ±20 mm dă rezultatul `acceptat` cu **starea** `conflict` (`conflict_cod = corectie_in_arbore`, r5), iar MP-ul decide în afara E4;
  - corecția unui arbore întreg (rădăcina + frunzele, cu R3 refăcut) e un design separat, după pilot.
- **Cazurile**:
  - **`marcaj_diferit`** (pe marcaj scrie altă lungime) și **`masurat` peste ±20 mm**, pe o rădăcină fără descendenți:
    - la aprobare se scrie evenimentul `corectie` pe bucată (`lungime_masurata_mm`, `lungime_mm`, `inainte` / `dupa`), cu motivul MP-ului;
    - alerta `izo_lungime_diferita_aviz` blochează fișa și pachetul până decide MP-ul (v2.3 §1.1 p7);
  - **`masurat` în ±20 mm**: lungimea din stoc rămâne (prototip `masOk`), iar măsurătoarea se păstrează pe declarație.

## 9. Roluri și drepturi

### 9.1 Rolurile noi de BD (ca în E3 §3.1)

| Rol | Deține | Ce scrie |
|---|---|---|
| `izo_teren_editor` | `fn_izo_teren_*`, `fn_izo_sync_push` | `izo_fronturi`, `izo_operatii` (canalul `teren`), `izo_sync_incercari`, `izo_preverificari`, `izo_declaratii` (+ versiuni, + `izo_declaratii_gps`), `izo_bucati_declarate`, `izo_rezervari`, `izo_suduri` / `_capete` doar în `declarata`. **Nimic în registru** |
| `izo_montaj_writer` | `fn_izo_aproba`, `fn_izo_revizie_cere`, `fn_izo_respinge`, `fn_izo_serie_lamureste`, `fn_izo_tranzitie_confirma`, `fn_izo_front_elibereaza`, `fn_izo_iesire_tronson`, `fn_izo_primire_depozit`, `fn_izo_pachet_*` (inclusiv `fn_izo_pachet_rand_note`), `fn_izo_seteaza_flux`, `fn_izo_montaj_marcheaza` | registrul (doar sub context); stările tabelelor de mai sus; sudurile aprobate; `izo_aprobari`; `izo_operatii` (canalele `aprobare` / `depozit` / `pachet`); `izo_tronson_config` (doar UPDATE pe coloanele fluxului, fără INSERT); pe tronsoanele în flux, sub context: `executie_tevi`, pachetele, documentele |

Helperele `postgres` (DEFINER, EXECUTE doar rolurile E4 care le folosesc): `fn_izo_montaj_autorizare_lock`, `fn_izo_blocheaza_locuri`, `fn_izo_config_blocheaza`, `fn_izo_radacini_blocheaza`, `fn_izo_montaj_preverifica`, `fn_izo_rata_consuma`, `fn_izo_pv_lipsa` (r4, §10.6), `fn_izo_gps_citeste` (aceasta și pentru `authenticated`, §9.5). Ele iau lock-urile pe tabelele pe care rolurile E4 n-au UPDATE: FOR SHARE / FOR UPDATE cer UPDATE pe cel puțin o coloană, deci un rol cu doar SELECT n-ar putea bloca direct.

**Postcondițiile pe roluri**:
- ambele: NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
- membership: `postgres` e singurul membru (SET, fără INHERIT, fără ADMIN), plus rândul ADMIN automat al creatorului, ca la E2a / E3;
- verificate în `pg_roles` / `pg_auth_members`.

### 9.2 Oamenii pe LOT 2 (✓BD 21.10, `izo_atribuiri`)

| Rol în modul | Om | Atribuire azi | De cerut, cu „da” |
|---|---|---|---|
| `inginer_izometrie` | TITI JENO (emp 115) | da | cheia de modul a tabletei (Q-E4-9), editor |
| `inginer_izometrie` | VICIU MARIUS ALEXANDRU (emp 177) | da | la fel; rolul de înlocuitor: Q-E4-8 |
| `manager_aprobator` | TOMA RAZVAN ALIN (emp 117) | da | cheia de modul, editor |
| `inlocuitor_aprobator` | — | nimeni | Q-E4-8 |
| `gestionar` (9 JUP, 10 ORN, 11 TOP) | CIOC JANETA (emp 30) | da | nimic nou (`magazie` editor din E2); de verificat la apply |
| diriginte Transgaz | Adrian Somesan (`coordonator_transgaz`, proiectul 3) | — | nimic: semnează fișa pe hârtie (E5) |
| owner | Razvan | bypass | ultima rezervă la aprobare |

### 9.3 Autorizarea, sub lock

Helper-ul `fn_izo_montaj_autorizare_lock(p_proiect, p_rol, p_depozit)` (owner `postgres`, DEFINER), ca în E3 §3.4. Ordinea, toate FOR SHARE:
1. `profiles`: `is_owner` → autorizat;
2. `user_module_access`: rândul exact (cheia de modul, editor / admin);
3. `izo_atribuiri`: rândul activ, valabil azi, pe rol (și pe depozit, la gestionar).

| Operația | Rolul cerut |
|---|---|
| sincronizarea, instantaneul, frontul | `inginer_izometrie` (sau owner) |
| aprobarea, revizia, respingerea, seria lămurită, tranziția, eliberarea frontului, pachetul | `manager_aprobator` sau `inlocuitor_aprobator` (sau owner); niciodată pe propriile rânduri |
| notele pe rândul de pachet (`fn_izo_pachet_rand_note`, r3) | `inginer_izometrie`, `manager_aprobator` sau `inlocuitor_aprobator` (sau owner) |
| ieșirea, primirea | `gestionar` pe proiect + depozit (sau owner) |
| fluxul pe tronson | `postgres` (chat, cu „da”) |

**Identitatea** (r2, §5.7): pe lângă rol, fiecare intrare cere `profiles.employee_id` NOT NULL. „Propriile rânduri” se compară pe profil **și** pe angajat, pentru MP, înlocuitor și owner deopotrivă. Atribuirile `izo_atribuiri` sunt pe `profile_id` (E2a). Un al doilea profil al aceleiași persoane n-ar putea avea același `employee_id` (indexul e unic), deci ar avea NULL și n-ar trece deloc.

### 9.4 Matricea privilegiilor (r2: completă, celulă cu celulă)

**Regulile comune**, pe toate tabelele E4:
- owner `postgres`; RLS activ; REVOKE ALL de la PUBLIC, `anon`, `authenticated`, `service_role`, apoi GRANT doar ce scrie mai jos;
- nimeni nu are DELETE / TRUNCATE. Trigger-ul doar-adaug (ca în E2a) refuză UPDATE / DELETE / TRUNCATE pe tabelele-jurnal, chiar și pentru `postgres`: `izo_operatii`, `izo_declaratii_versiuni`, `izo_aprobari`, `izo_sync_incercari`;
- **lock-urile pe rânduri** (r3): un rol blochează direct (FOR SHARE / FOR UPDATE) doar tabelele pe care are UPDATE pe cel puțin o coloană; pentru restul (profilul, accesul, atribuirea, proiectul, tronsonul, depozitele, config-ul la sincronizare, registrul la tabletă) folosește helperele `postgres` din §9.1. Testul 16 o verifică pe fiecare lock, ca rolul real;
- **citirea API** (`authenticated`, doar SELECT): direct prin `fn_izo_citire(proiect_id)` pe tabelele cu `proiect_id`; prin părinte (`EXISTS` pe părintele filtrat de RLS), ca în E3, pe cele fără `proiect_id`;
- **rolurile E4**: politici pe rând largi (`USING / WITH CHECK (proiect_id IS NOT NULL)` sau prin părinte), ca în E3 §3.5. Restricția reală e în trigger-ul de stări (§6.4), în gardă și în privilegiile pe coloane;
- **numele politicilor**, câte una pe (tabel, rol, comandă) din matrice: `<tabel>_api_sel` (`authenticated`, de exemplu `izo_fronturi_api_sel`), `izo_teren_<tabel fără izo_>_sel / _ins / _upd`, `izo_montaj_<tabel fără izo_>_sel / _ins / _upd`. Toate intră în amprentă prin prefixele din §10.7; o politică în plus sau în minus → porți lipsă;
- **coloanele**: `INSERT (…)` / `UPDATE (…)` pe liste explicite; `id` e mereu `GENERATED ALWAYS AS IDENTITY`, deci nu e în nicio listă;
- **secvențele**: USAGE explicit pe secvența identity a fiecărui tabel unde rolul face INSERT (ca E2a pentru `izo_importuri_id_seq`); `izo_teren_editor` și `izo_montaj_writer` primesc `izo_server_ver_seq`; doar `izo_montaj_writer` primește `magazie_bucati_id_seq` și secvențele evenimentelor / mișcărilor.

| Tabel | `authenticated` (SELECT) | `izo_teren_editor` | `izo_montaj_writer` |
|---|---|---|---|
| `izo_tronson_config` | `fn_izo_citire(proiect_id)` | SELECT (FOR SHARE doar prin `fn_izo_config_blocheaza`) | SELECT, UPDATE (`flux_montaj`, `flux_de_la`, `flux_motiv`, `flux_schimbat_de`, `server_ver`), **fără INSERT** (r3). Rândul, sensul, `nr_sudura_start`, zonele și executantul le scrie `postgres` direct, cu „da” |
| `izo_fronturi` | `fn_izo_citire(proiect_id)` | SELECT, INSERT (toate, fără `id`), UPDATE (`expira_la`, `predat_la`, `activ`) | SELECT, UPDATE (`activ`, `predat_la`, `eliberat_de`, `eliberat_motiv`) |
| `izo_operatii` | `fn_izo_citire(proiect_id)`; payload-ul n-are GPS; SELECT pe **toate coloanele în afară de `hash_cerere`** (r3, grant pe coloane) | SELECT, INSERT (toate, fără `id`); politica `WITH CHECK (canal = 'teren' AND autor_profile_id IS NOT NULL)` | SELECT, INSERT; `WITH CHECK (canal IN ('aprobare','depozit','pachet'))` |
| `izo_sync_incercari` (r3) | `fn_izo_citire(proiect_id)`, prin `v_izo_carantina_sync`; payload-ul n-are GPS | SELECT, INSERT (toate, fără `id`) | SELECT |
| `izo_rata_apeluri` (r3) | nimic | nimic (doar prin `fn_izo_rata_consuma`) | nimic (la fel) |
| `izo_preverificari` | `fn_izo_citire(proiect_id)` | SELECT, INSERT (toate, fără `id`), UPDATE (`stare`, `trimisa_la`, `trimisa_op_id`, `versiune`) | SELECT, UPDATE (`stare`, `versiune`) |
| `izo_declaratii` | `fn_izo_citire(proiect_id)` (fără coloane GPS: nu există) | SELECT, INSERT (toate, fără `id` și coloanele de decizie), UPDATE (lista explicită, r3: coloanele de conținut din §3.2, inclusiv piesa `bucata_id` / `bucata_decl_uid` și `identificare` (r5), `stare`, `conflict_cod`, `stare_inainte_blocare`, `blocata_motiv`, `depinde_de_versiune`, `versiune`, `ultimul_op_id`, `gps_prezent`) | SELECT, UPDATE (`stare`, `conflict_cod`, `stare_inainte_blocare`, `blocata_motiv`, `versiune`, coloanele de decizie; r5: `bucata_id` **și `identificare`**, folosite doar de seria lămurită, restrânse de trigger-ul de stări la tranziția din §6.4) |
| `izo_declaratii_versiuni` | prin `izo_declaratii`; toate coloanele în afară de `hash_cerere` (r3) | SELECT, INSERT | SELECT, INSERT (versiunea creată de seria lămurită) |
| `izo_declaratii_gps` (§9.5) | **nimic** | **doar INSERT** (fără SELECT, deci și fără `RETURNING`) | **nimic** |
| `izo_bucati_declarate` | prin `izo_declaratii` | SELECT, INSERT (toate), UPDATE (`stare`, `lungime_mm`, `lungime_calculata`, `destinatie`, `depozit_destinatie_id`) | SELECT, UPDATE (`stare`, `bucata_id`, `depozit_destinatie_id`) |
| `izo_rezervari` | `fn_izo_citire(proiect_id)` | SELECT, INSERT (toate, fără `id`), UPDATE (`activa`, `eliberata_la`, `motiv_eliberare`, `expira_dupa`) | SELECT, INSERT (seria lămurită; transferul pe `bucata_id`, cu `transfer_din_id`, §3.2), UPDATE (`activa`, `eliberata_la`, `motiv_eliberare`, `eveniment_id`) |
| `izo_suduri` | `fn_izo_citire(proiect_id)` | SELECT, INSERT, UPDATE (`nr`, `sufix`, `executant`, `poanson`, `data_sudura`, `stare` → `anulata`, `server_ver`), doar pe `declarata` | SELECT, UPDATE (`stare`, `tranzitie_*`, `server_ver`) |
| `izo_suduri_capete` | prin `izo_suduri` | SELECT, INSERT, UPDATE (`activ`), doar pe suduri `declarata` | SELECT, INSERT, UPDATE (`activ`, `de_la_eveniment_id`) |
| `izo_aprobari` | `fn_izo_citire(proiect_id)` | — | SELECT, INSERT |
| `magazie_bucati` | neschimbat (E2a) | SELECT (politica `magbuc_izo_teren_sel`) | SELECT; INSERT pe `C` ∪ {`id`, `uid`, `radacina_id`, `server_ver`}; UPDATE pe stare, loc, `tronson_id`, `depozit_id`, `atribute`, lungimi, `executie_teava_id`, `server_ver`, `updated_at` (politici `magbuc_izo_montaj_*`) |
| evenimente / mișcări | neschimbat | SELECT | SELECT, INSERT (politici `izo_ev_montaj_*`, `izo_mis_montaj_*`) |
| `executie_tevi`, pachete, documente | neschimbat: pe pachete / documente RLS-ul 20261029a; pe `executie_tevi` RLS-ul larg existent (§1.1 #15). Pe tronsoanele în flux, trigger-ele `a0_izo_flux_*` refuză orice scriere a rândurilor din client (§7.4) | SELECT (pentru instantaneu) | SELECT, INSERT, UPDATE pe coloanele proiecției și pe cele patru note (politici `executie_*_izo_montaj`) |
| config proiect, atribuiri, importuri | — | — | — (doar prin helpere) |
| documentele E3 (`izo_documente_intrare*`) | neschimbat (E3) | — (PV-ul doar prin `fn_izo_pv_lipsa`, r4) | — (la fel) |

**Vederile**, toate `WITH (security_invoker = on)`, SELECT doar pentru `authenticated`, deci filtrate de RLS-ul tabelelor de dedesubt:
- `v_izo_alerte` (extinsă cu alertele E4);
- `v_izo_carantina_sync` (încercările `alt_dispozitiv` din `izo_sync_incercari`, încă fără rând în `izo_operatii`);
- `v_izo_rezervari_active` (ecranul MP-ului, §6.7).

Niciuna nu expune GPS-ul sau `hash_cerere`.

**Funcțiile**: EXECUTE doar pe semnătura exactă, ca în §4.2. Ajutătoarele: REVOKE de la PUBLIC, `anon`, `authenticated`, `service_role`.

### 9.5 GPS-ul și păstrarea datelor (r2)

- **Coordonatele stau într-un singur loc**: `izo_declaratii_gps` (`declaratie_id`, `versiune`, `lat`, `lon`, `precizie_m`, `la`), PK (`declaratie_id`, `versiune`), FK → declarație. Nimeni nu are SELECT; citirea trece doar prin `fn_izo_gps_citeste(p_decl)` (DEFINER, owner `postgres`), care cere MP-ul proiectului (atribuire activă) sau owner-ul (Q-E4-15 A).
- **Nicăieri altundeva**: serverul scoate `gps` din payload înainte de `izo_operatii.payload`, `izo_declaratii_versiuni.payload`, `izo_sync_incercari.payload`, `raspuns`, instantaneu și vederi. `hash_cerere` se calculează însă pe payload-ul întreg, deci idempotența rămâne exactă. Testul caută coordonatele în toate coloanele jsonb și text ale tabelelor E4 (§11.14).
- **Hash-ul nu e un verificator** (r3): cine știe restul cererii (o citește din `payload`) ar putea verifica offline coordonate candidate pe un sha256 public. De aceea `hash_cerere` (în `izo_operatii` și `izo_declaratii_versiuni`) nu e în niciun grant pe coloane al `authenticated`, nu apare în `raspuns`, în instantaneu sau în vederi; îl citesc doar rolurile E4, în funcții. Testul 14 verifică `has_column_privilege` = false pentru `authenticated`.
- **Păstrarea**:
  - `izo_operatii`, `izo_declaratii_versiuni`, `izo_aprobari`, `izo_sync_incercari`, `izo_rezervari`, `izo_fronturi`: permanent, ca jurnal de audit, fără DELETE (fără date personale în afară de profil și oră);
  - `izo_declaratii_gps`: după Q-E4-15. La A, permanent; la B, ștergerea după aprobarea Transgaz a pachetului e singura excepție de la „fără DELETE”, printr-o funcție a `izo_montaj_writer`, sub context, pe acel tabel;
  - `dispozitiv_id` nu identifică persoana (uuid local, fără amprentare).

## 10. Garda și poarta — ce se refolosește din E3

### 10.1 Intrarea

**Intrările API** (`authenticated`, prin PostgREST): `fn_izo_montaj_api_verifica()` și `fn_izo_teren_api_verifica()`, copiate după `fn_izo_doc_api_verifica` din E3 r5f (`origin/izometrie/e3`), în ordinea din §5.4 pasul 0 (r4):
1. **READ COMMITTED impus**, înaintea oricărui lock (r3): `current_setting('transaction_isolation') <> 'read committed'` → refuz `25001`. Sub REPEATABLE READ / SERIALIZABLE, poarta și revalidările de după lock-uri ar citi pe snapshot-ul de dinainte;
2. lock-ul schemei, partajat, primul dintre lock-uri;
3. `session_user = authenticator`, JWT `authenticated`, uid prezent; contextele E3 și E4 goale;
4. filtrele ieftine (rolul, fără lock pe rânduri; contorul doar pe canalul tabletei), §5.4 pasul 0.4;
5. poarta completă `fn_izo_porti_lipsa()` (E2a + E3 + E4; ≈ 0,4 s, de măsurat la cod pe un lot de 50).

**Intrarea administrativă** (r4): `fn_izo_seteaza_flux` nu trece prin verificatorul API (care cere `authenticator`). Are ramura ei, ca `fn_izo_seteaza_nivel` (E2a): READ COMMITTED impus → lock-ul schemei, partajat → `session_user = postgres` (altfel 42501) → contextele goale → poarta completă (la pornire) → apoi lock-urile din §3.1 (tabelele → advisory exclusiv → config). Nu e chemabilă din API: EXECUTE doar pentru `postgres`.

### 10.2 Contextul

- Forma: `izo.montaj_ctx` = `<txid>|<op>|<ref>|<proiect>|<tronson>|<versiune>|<arg>`.
- `op` ∈ {`aproba`, `revizie`, `respinge`, `serie`, `tranzitie`, `iesire`, `primire`, `completeaza`, `leaga`, `dezleaga`, `nota`, `transgaz`, `flux`}.
- Îl scrie doar `fn_izo_montaj_marcheaza` (EXECUTE doar owner-ul), după toate validările.
- Tableta n-are context în registru: `izo_teren_editor` nu trece niciodată de garda registrului.

### 10.3 Integrarea în gardă, fără RETURN timpuriu (ca în E3 §3.2)

```
v_aut := public.fn_izo_garda_scriitor();
IF v_aut IS NOT TRUE AND current_user = 'izo_receptie_writer' THEN v_aut := public.fn_izo_garda_receptie(…); END IF;
IF v_aut IS NOT TRUE AND current_user = 'izo_montaj_writer' THEN v_aut := public.fn_izo_garda_montaj(TG_TABLE_NAME, TG_OP, OLD, NEW); END IF;
```

- Blocul intră în `fn_izo_garda_bucati` și în `fn_izo_garda_fapte` (CREATE OR REPLACE). Definițiile E3 se salvează pentru revenire.
- Restul verificărilor E2a rămân pentru toți scriitorii.
- `fn_izo_garda_montaj` întoarce true sau ridică 42501, niciodată un false tăcut.

### 10.4 Proiecțiile exacte

- **Bucata**:
  - aceeași constantă `C` (`fn_izo_coloane_c()`, E3), pe ambele părți;
  - efectul așteptat vine din simularea lotului (`fn_izo_lot_efecte`, §6.3) la aprobare și din cererea validată la ieșire, primire, legare;
  - la tăierea unei bucăți montate, și capetele de sudură mutate (§8.5): exact capetele active ale părintelui, pe copiii cu literele lor;
  - la copii, `radacina_id` = rădăcina părintelui, verificat separat; `aviz_intrare_id` / `nr_crt_aviz` sunt NULL.
- **Evenimentul și mișcarea**: `fn_izo_coloane_ev()` / `fn_izo_coloane_mis()` (E3), cu valorile așteptate pe operație: `document_tip` = `izo_declaratie`, `aplicat_de` = uid-ul aprobatorului, `declarat_de` = autorul declarației, `ora_tableta`, `dispozitiv_id`.
- **Rândul de pachet**: proiecția nouă `fn_izo_coloane_tevi()` + `fn_izo_pachet_rand_asteptat`: pe `teava` / `curba` din bucata legată, pe `legare` din sudura de cuplare (r7, §3.4, §7.3).
- **Coloanele**: mulțimea coloanelor fiecărui tabel e verificată în poartă. O coloană nouă → porți lipsă → intrările refuză.

### 10.5 Ordinea globală a lock-urilor

O singură ordine, compatibilă cu E2a / E3 / 2c (r2: pe **lot / apel**, nu pe operație):
1. schema (partajat);
2. frontul → sesiunile → aprobarea → declarațiile (FOR UPDATE, după id). O declarație se blochează doar după sesiunea ei;
3. profilul → accesul pe modul → atribuirea (FOR SHARE);
4. proiectul, depozitele, tronsoanele (FOR SHARE); `izo_tronson_config` FOR SHARE **doar la sincronizare** (care nu ia advisory);
5. pachetul (FOR NO KEY UPDATE) și tronsonul pachetului (FOR SHARE), doar la scriitorii pachetului;
6. rândurile `executie_tevi` (FOR NO KEY UPDATE, după id), doar la scriitorii pachetului;
7. tabelele (ACCESS SHARE);
8. advisory (73010, proiect): partajat; exclusiv doar la activarea fluxului, la import și la storno (E2a). Fluxul și nivelul se citesc **după** el, la toți cei care îl iau;
9. rădăcinile → bucățile → sudurile (FOR UPDATE, după id). r7: la scriitorii pachetului, sudurile de cuplare ale rândurilor `legare` intră tot aici, după bucăți: FOR UPDATE la `completeaza`, FOR SHARE la `transgaz` (§7.3 pasul 7).

**Excepțiile, toate sufixe ale aceleiași ordini**:
- activarea / oprirea fluxului (ca `fn_izo_seteaza_nivel`): 7 → 8 (exclusiv) → rândul de config FOR UPDATE;
- căile din client (2c), pe un tronson în flux: rândul (implicit, prin UPDATE / DELETE) → refuz în `a0_izo_flux_tevi`, primul trigger BEFORE, fără alt lock și fără cascade (§7.3, §7.4). Asta acoperă și notele (observații / NDT), care pe flux trec prin RPC, cu ordinea scriitorilor de pachet (5 → 6 → 7 → 8). Pe un tronson fără flux: rândul → advisory partajat → (2c) pachetul FOR SHARE → … Lock-urile pe rânduri vin înaintea advisory-ului, ca în protocolul E2a; E4 nu scrie acolo;
- antetul creat din client: proiectul (FOR UPDATE, `tg_pachete_lansare_assign_numar`) → advisory partajat (2c), adică 4 → 8, un sufix al ordinii (§7.4);
- respingerea rândurilor unei sesiuni abandonate: frontul (FOR SHARE) → sesiunea → declarațiile → profilul / accesul / atribuirea autorului (§6.7) → rădăcinile pieselor rezervate, adică 2 → 3 → 9;
- **orice scriere în `izo_rezervari`** (sincronizarea, aprobarea cu transferul, respingerea, revizia, seria lămurită) se face după lock-ul rădăcinii resursei (9), luat în ordinea de mai sus; fără advisory, dacă funcția nu scrie registrul (ca sincronizarea).

**Fără cicluri**:
- **lot față de lot**: fiecare lot își adună toate resursele înainte (§5.4 pas 1) și le blochează o singură dată, sortate. Loturile X → Y și Y → X iau amândouă X, apoi Y. Pe același tronson, loturile sunt serializate de front;
- **sincronizare față de aprobare**: aprobarea ia advisory-ul înaintea rădăcinilor, iar sincronizarea nu ține advisory. O aprobare care așteaptă advisory-ul nu ține încă rădăcini;
- **sincronizare față de activare**: sincronizarea ține config-ul FOR SHARE și nu așteaptă niciodată advisory-ul, iar activarea, cu advisory-ul exclusiv, așteaptă config-ul. Ciclul ar cere ca sincronizarea să aștepte ceva ținut de activare, iar activarea nu ține rânduri;
- **aprobare / scriitor de pachet față de activare**: ambele iau advisory-ul (8) înaintea citirii fluxului și nu blochează rândul de config, deci nu se pot încrucișa cu „advisory → config” al activării;
- **scriitor de pachet față de clientul 2c**: pe un tronson în flux clientul e refuzat de primul trigger BEFORE, deci nu ajunge să țină pachetul (nici prin cascada totalurilor, r3); pe unul fără flux, scriitorul E4 nu blochează pachetul (pre-verificarea, §7.3);
- **preluarea unei rezervări expirate** (r3): scrie doar `izo_rezervari`, sub lock-ul rădăcinii deja ținut, nu declarația celuilalt autor (§5.4), deci nu ia niciun lock de declarație după rădăcini;
- **două legări / completări**: pachetul înaintea rândurilor, toate FOR NO KEY UPDATE de la început, deci fără urcare de lock (§7.3);
- storno-ul și importul E2a (advisory exclusiv → bucăți) rămân sufixe ale aceleiași ordini.

Testele de cursă (§11.5) acoperă fiecare pereche de mai sus, în ambele ordini, cu `pg_locks`.

### 10.6 Regula E3 §8, PV-ul (Q-E4-6 A)

- Orice funcție E4 care scoate, taie sau montează o bucată refuză bucata cu `aviz_intrare_id` NOT NULL al cărei document n-are `eveniment_pv_id`.
- La copii (care n-au aviz, §3.3), verificarea se face pe **rădăcină**.
- E aceeași regulă pe care o aplică E3 la punerea PV-ului (`20261103b`: refuzul „bucăți ieșite / modificate înainte de PV”), deci cele două capete ale contractului se potrivesc (Q-E4-6 A).
- Verificarea se face sub lock, după bucăți. Are test dedicat.
- **Calea de citire** (r4): rolurile E4 n-au drepturi pe tabelele E3 (`izo_documente_intrare`: SELECT doar pentru `authenticated`, `izo_doc_editor`, `izo_receptie_writer`, cu politicile lor). Verificarea trece prin helper-ul `fn_izo_pv_lipsa(p_radacini bigint[])` (owner `postgres`, DEFINER, `SET search_path = public, pg_temp`, EXECUTE doar `izo_teren_editor` și `izo_montaj_writer`; REVOKE de la PUBLIC, `anon`, `authenticated`, `service_role`): întoarce rădăcinile cu `aviz_intrare_id` al căror document n-are `eveniment_pv_id`, fără alte coloane. Se cheamă după lock-urile pe rădăcini, deci pe aceeași stare ca restul validării. Intră în poartă (corp + ACL) și în matricea din §9.4; nicio politică sau GRANT nou pe tabelele E3.

### 10.7 Poarta E4 și amprenta

- **`fn_izo_porti_e4_definitii()`** inventariază:
  - tabelele E4: RLS, ACL, owner, privilegiile pe coloane;
  - politicile `izo_*_api_sel` (pe tabelele E4), `izo_teren_*`, `izo_montaj_*`, `magbuc_izo_teren_*`, `magbuc_izo_montaj_*`, `executie_*_izo_*`;
  - trigger-ele E4 + `tgenabled`;
  - indexurile `ux_izo_*` ale E4, `ux_magbuc_ev_decl`, `ux_magbuc_izo_teava`;
  - rolurile + membership;
  - **trigger-ele DEFINER existente pe `executie_tevi` / pachete**, cu corpul (md5), pentru că garda acceptă cascadele lor;
  - **ordinea trigger-elor** (r3): pe `executie_tevi`, `executie_pachete_lansare` și `executie_pachete_documente`, trigger-ul `a0_izo_flux_*` e primul BEFORE (niciun nume mai mic), `tgenabled = 'A'`;
  - grant-urile pe coloane ale `authenticated` pe `izo_operatii` / `izo_declaratii_versiuni` (fără `hash_cerere`, r3);
  - **indexul unic pe `profiles.employee_id`** (r2): regula „nimeni nu-și aprobă rândurile” se sprijină pe el (§9.3);
  - vederile E4 (`security_invoker`) și ACL-ul pe `izo_declaratii_gps` (nimeni cu SELECT).
- **`fn_izo_porti_e4_lipsa()`** se cheamă la finalul `fn_izo_porti_lipsa`. Migrarea o înlocuiește din nou, păstrând închiderea rapidă din E3.
- **`c_e4_revizuite`** = semnătura → md5, pentru intrările E4 acceptate ca scriitori (lista din designul E3, §3.2; în migrarea E3 ea apare ca amprenta pe `prosrc | proconfig | owner | proacl | prosecdef`, lângă `c_dinamice_revizuite`). Numele constantei se aliniază la cod.
- **Amprenta E2a se schimbă și ea**: `ux_magbuc_izo_teava` intră prin filtrul `ux_magbuc_izo_%`, iar `fn_izo_garda_bucati` / `fn_izo_garda_fapte` / `fn_izo_depozit_in_registru` primesc corpuri noi. Migrarea o re-fixează deliberat (ca 2c), cu valoarea de dinainte păstrată pentru revenire.
- Ștampila se fixează doar în migrare.

### 10.8 Revenirea

- E4 fără fapte → scoate tot și reface E3: gărzile, poarta, amprenta.
- Cu orice fapt E4 (declarație, operație, sudură, eveniment cu `document_tip` E4, bucată legată) → refuz. Drumul e înainte, cu o migrare revizuită.
- Ordinea revenirilor: E4 → E3 → 2c → E2a.

## 11. Teste

Negative întâi. Harness PG16 (`scripts/test_izometrie_e4.sh`) + branch PG17 + PostgREST real; rezultatul așteptat e scris dinainte.

1. **Autentificarea / autorizarea**, pe fiecare intrare:
   - refuzați: `anon`; `service_role`; `authenticated` fără modul, cu `viewer` sau fără atribuire; atribuirea expirată sau pe alt proiect; gestionarul pe alt depozit;
   - owner-ul trece;
   - MP-ul pe propriile rânduri e refuzat; inginerul și viewer-ul nu pot aproba.
2. **Garda**:
   - `izo_teren_editor` nu poate scrie nicio bucată, niciun eveniment și nicio mișcare, nici cu un context fals;
   - `izo_montaj_writer` fără context, sau cu context pe alt lot / altă versiune / alt txid → refuz;
   - pe fiecare coloană din `C`, o bucată scrisă cu acea singură coloană diferită → refuz (copii, montaj, ieșire, primire, legare); la fel un eveniment sau o mișcare;
   - suita E2a (180) și suita E3 rulează nemodificate după E4.
3. **Idempotența**:
   - operație retrimisă → `duplicat`, un singur efect; același `op_id` cu alt payload (inclusiv doar alt GPS) → `conflict_op`, zero efecte;
   - aprobare retrimisă cu aceeași cheie → același răspuns; cu altă listă, **alte `p_decizii`** sau altă amprentă → `cheie_refolosita`, zero efecte;
   - **deciziile schimbate după preview**: o cheie de decizie în plus sau lipsă → refuz; o bucată, sudură, rezervare sau un depozit schimbat între preview și aprobare (`server_ver`) → `preview_vechi`;
   - ieșire / primire / completare / respingere retrimise → un singur efect; cu alți parametri → `cheie_refolosita`;
   - **reluarea după respingere / revocare**: operația veche retrimisă după respingerea declarației → `duplicat`, cu răspunsul vechi, nicio scriere; o operație nouă pe declarația respinsă → `conflict` (CAS / stare); după revocarea accesului → `fara_drept`, nejurnalizat, coada rămâne.
4. **Lotul și jurnalul**:
   - o operație greșită la mijloc → ea primește `eroare` (jurnalizată, cu cod), dependenții `blocat_de_conflict` (nejurnalizați), restul `acceptat`;
   - eroarea de business: rândul din `izo_operatii` există, iar efectele ei sunt zero (savepoint-ul anulat); retrimiterea primește același `raspuns`;
   - eroarea trecătoare (`40P01` / `55P03` simulate): nimic jurnalizat, lotul se oprește acolo, iar retrimiterea cu același `op_id` reușește;
   - `UPDATE` / `DELETE` / `TRUNCATE` pe `izo_operatii` → refuz, inclusiv ca `postgres`;
   - gol de `seq` → `izo_gol_operatii`;
   - `versiune_format` necunoscută → `eroare`.
5. **Curse cu barieră**, în ambele ordini, cu `pg_locks` care confirmă așteptarea:
   - două tablete pe aceeași țeavă: una acceptată, cealaltă `conflict`, fără deadlock;
   - **două loturi X → Y și Y → X** (aceleași două rădăcini, ordine inversă în payload): unul așteaptă, niciun deadlock;
   - sincronizare ↔ aprobare pe aceeași rădăcină; aprobare ↔ aprobare (aceeași sesiune, aceeași cheie); aprobare ↔ primire; ieșire ↔ sincronizare;
   - legare ↔ mutare / ștergere din client (4j3, reluat pe funcția reală); **legare ↔ legare** pe același rând și pe același pachet; **legare ↔ completare**: fără urcare de lock, fără deadlock;
   - activarea fluxului ↔ sincronizare / aprobare / legare / mutare din client (cu advisory-ul exclusiv în așteptare);
   - oprirea fluxului ↔ sincronizare (cu o rezervare creată în paralel → oprirea e refuzată);
   - revocarea modulului / atribuirii ↔ aprobare (ca testul 2 din E3) și ↔ sincronizare.
6. **Regulile**:
   - 12 → 4 + 4 + 4 e blocată; 4,00 / 3,99 / 4,01 trece; R3 exact;
   - tăierea în 2 puncte → 3 copii, cu literele în ordinea sosirii;
   - restul sub prag → `rest_nereutilizabil` la primire;
   - sudura cu un singur capăt → refuz la aprobare;
   - cuplarea cu tăierea țevii cu capătul liber (ramura 1) → sudura amonte trece pe copil, iar pe părintele `taiata` nu rămâne niciun capăt activ;
   - ramura 2 (tăiere în mijloc pe o bucată sudată la ambele capete) → ambele suduri se mută, fiecare pe copilul cu litera ei; R4 și R3 rămân adevărate; o tăiere cu un singur punct pe o astfel de bucată → `ramura_gresita`; ramura 3 → `ramura_neacoperita`;
   - tăierea unei bucăți legate de un rând de pachet → `bucata_in_pachet`; după `dezleaga` → trece; pe un pachet aprobat de Transgaz → dezlegarea e refuzată;
   - **corecția**: pe o rădăcină fără descendenți trece, iar R3 rămâne exact; pe un copil, sau pe o rădăcină deja tăiată, → `corectie_in_arbore` (exemplul 12 = 8 + 4, corecția la 4,1); corecția + tăierea în același lot → tăierea pornește de la lungimea corectată;
   - montaj fără confirmarea lungimii → refuz (tabletă, sincronizare, aprobare); cifrele de marcaj greșite → refuz;
   - tranziția 7,1 ↔ 8,8 nu oprește nimic și e calculată pe sudură;
   - seria în verificare: sesiunea se trimite, celelalte rânduri se aprobă, rândul nu devine fapt, iar sudurile lui așteaptă;
   - bucată E3 fără PV → refuz (ieșire, tăiere, montaj); carantina → refuz;
   - montaj din depozit fără ieșire → aprobarea e refuzată până la ieșire (Q-E4-2 A).
7. **Pachetul**:
   - pe un tronson în flux, din client: INSERT, orice UPDATE (inclusiv doar `observatii` / codurile NDT, r3), DELETE, mutare, km, status → refuz; `observatii` și codurile NDT trec doar prin `fn_izo_pachet_rand_note`;
   - cascadele DEFINER (renumerotarea, km-ul, totalurile) trec doar sub context și doar pe coloanele derivate;
   - `completeaza` respectă ordinea lanțului și refuză golurile;
   - legarea unei bucăți nemontate, de alt tip, de pe alt tronson sau deja legate → refuz; o bucată ↔ un rând (indexul);
   - pe T12 (nu e în flux), editorul și picker-ul text merg ca azi (regresia 2c);
   - **OLD / NEW**: un rând mutat T12 → T14 și T14 → T12 → refuz; un antet de pachet mutat pe / de pe T14 → refuz; o mutare T12 → T13 (ambele fără flux) trece;
   - mutarea concurentă cu activarea fluxului pe tronsonul NEW: fie e așteptată și refuzată, fie e comisă înainte, iar activarea e refuzată (rânduri nelegate).
8. **Privilegiile pe catalog**:
   - fiecare celulă din matrice (`has_table_privilege`, `has_column_privilege`, `has_function_privilege`);
   - fiecare operație cap-coadă, ca rolul real, fără `permission denied`.
9. **Poarta**: o funcție, politică, trigger sau ACL E4 modificat, un wrapper peste intrările E4, o coloană nouă pe un tabel E4 → porți lipsă → toate intrările (E2a / E3 / E4) refuză.
10. **Revenirea**: fără fapte → curat, cu amprenta E3 refăcută; cu un fapt → refuz.
11. **Tableta** (vitest):
    - `src/lib/izoTeren.test.js`, cu regulile portate din prototip:
      - numerotarea fără zerouri, inserarea sudurii uitate, golurile;
      - tranziția amonte / aval, zonele de perete;
      - R1 (d) local, R3;
      - cifrele de marcaj, prefixul ambiguu;
      - restul și eticheta lui;
      - „Desfă”, retragerea;
    - `src/lib/izoCoada.test.js`, pe adaptorul în memorie: ordinea `seq`, ACK pierdut, două taburi;
    - **repornirea**: coada se recreează peste aceeași stocare a adaptorului (repornire simulată, fără librării noi), cu aceleași operații, același `op_id`, același `seq` următor și același `dispozitiv_id`; rezultatele nefinale lasă operația în coadă, cele finale o scot.
12. **Pilotul** (T14 sau T15, cu semnal):
    - **fluxul owner-ului, cap-coadă** (v2.3 §6.3 E4b):
      - seria → L / șarjă / perete → confirmarea lungimii → „Țeavă tăiată” 8,00 din 11,98;
      - restul de 3,98 apare în Magazie „declarat, neaprobat · în drum spre depozit”;
      - aprobarea MP-ului → `in_tranzit` → primirea Janetei → `retur`;
    - semnal pierdut 10 minute, cu pagina deschisă → 0 operații pierdute;
    - **tableta repornită** (tab închis / browser oprit) cu operații în coadă → la redeschidere, cu semnal, aceleași operații pleacă o singură dată (IndexedDB real);
    - a doua tabletă pe același tronson → `alt_dispozitiv`.
13. **Tăierea + montajul în același lot** (r2):
    - „Țeavă tăiată” 8,00 din 11,98 + montajul pe copil, aprobate împreună (r5): copilul se naște; rezervarea montajului pe `bucata_decl_uid` (R) devine `transferata`; R′ pe `bucata_id` (`transfer_din_id` = R) e `consumata`, cu `eveniment_id` = evenimentul `montaj`; reconcilierea trece, iar pe copil nu rămâne nicio rezervare activă. La fel T1 + T2 (tăierea copilului) în același lot: R′ e consumată de evenimentul `taiere` al lui T2;
    - **reconcilierea, negativ** (r5): o abatere forțată (R `consumata` direct de montaj, fără R′; R′ încă activă după aprobarea montajului; două R′ pe același R) → excepție la pasul 10, rollback total;
    - montajul pe copil fără tăiere (nici aprobată, nici în lot) → refuz pe tot apelul, cu lista;
    - ordinea din `p_randuri` inversată (montajul înaintea tăierii) → același rezultat (ordinea topologică);
    - **rollback-ul total**: o eroare forțată la reconciliere (pasul 10) → zero evenimente, bucăți, capete, rezervări consumate, `izo_aprobari` și `izo_operatii`; reîncercarea cu aceeași cheie e evaluată din nou și reușește.
14. **Mașina de stări și GPS-ul** (r2):
    - fiecare tranziție din afara tabelului §6.4 → refuz (în special: revizie / respingere / versiune nouă pe `aprobata`);
    - revizia unei tăieri → descendenții `blocata`; versiunea nouă cu aceiași copii → descendenții revin; cu un copil schimbat → copilul `anulata`, literele și rezervările eliberate, dependenții rămân `blocata`;
    - frontul expirat → `front_expirat`; rezervarea expirată preluată de altă declarație (cea veche rămâne nescrisă, cu `rezervare_pierduta`, iar trimiterea ei e refuzată); eliberarea frontului de MP;
    - limitele: a 61-a rezervare activă, a 11-a din depozit → `limita`;
    - **GPS-ul**: după un lot cu coordonate, valorile lat / lon nu apar în nicio coloană jsonb sau text a tabelelor E4 (`izo_operatii`, versiuni, `raspuns`, instantaneu, vederi), ci doar în `izo_declaratii_gps`; SELECT direct pe ea → `permission denied` pentru toți; `fn_izo_gps_citeste` → MP-ul și owner-ul da, inginerul și gestionarul nu.
15. **Identitatea** (r2):
    - lot cu `p_dispozitiv` al frontului, dar alt `auth.uid()` → `fara_drept`; o referință la sesiunea / copilul altui inginer → `ref_alt_autor`;
    - un al doilea profil cu același `employee_id` → refuzat de indexul unic (care e în poartă, §10.7: scoaterea lui → porți lipsă); un profil fără `employee_id` → `identitate_neclara`;
    - înlocuitorul și owner-ul pe propriile rânduri sau pe o dependență neaprobată a lor → refuz;
    - GPS-ul, ora tabletei sau `dispozitiv_id` falsificate nu schimbă nicio autorizare (doar alertele).
16. **Matricea pe catalog** (r2): fiecare celulă din §9.4, inclusiv INSERT-ul pe `izo_aprobari` / `izo_operatii` al `izo_montaj_writer`, USAGE pe secvențele identity, politicile prin părinte pe tabelele fără `proiect_id` și `security_invoker` pe vederi. r3: **fiecare lock** din §5.4 / §6.3 / §7.3, rulat ca rolul real (nu ca `postgres`), fără `permission denied` (FOR SHARE / FOR UPDATE cer UPDATE: direct sau prin helper); `has_column_privilege(authenticated, hash_cerere)` = false pe ambele tabele; `izo_montaj_writer` fără INSERT pe `izo_tronson_config`; `fn_izo_seteaza_flux` pe un tronson fără config → `config_lipsa`.
17. **Aprobările separate, expirarea, revocarea** (r3, cu barieră și `pg_locks`):
    - tăierea aprobată singură, montajul pe copil rămas pentru un lot ulterior: copilul se naște cu rezervarea transferată pe `bucata_id`; o a doua tabletă care cere copilul primește `conflict`; montajul trece în lotul următor și consumă rezervarea transferată; reconcilierea (pasul 10) prinde un copil fără rezervare;
    - **expirarea între autori**: lotul lui B preia rezervarea expirată a lui A cât A rulează un lot care ține declarația lui A (barieră în ambele ordini): fără deadlock, declarația lui A nescrisă de B, `rezervare_pierduta` la A, `sesiune_trimite` a lui A refuzată;
    - **revocare → închidere → oprire**: autorul revocat cu ciorne și rezervări; MP-ul eliberează frontul, respinge rândurile (cu front valid al autorului → refuz; după eliberare → trece), sesiunea se închide, rezervările se eliberează, iar `fn_izo_seteaza_flux(…, false)` trece (fără fapte);
    - **corecția + tăierea** pe o rădăcină cu copiii declarați de aceeași declarație → trece (evenimentele `corectie`, apoi `taiere`); cu un copil declarat de altă declarație (neanulat) → `corectie_in_arbore`;
    - **recuperarea `alt_dispozitiv`**: operațiile dispozitivului fără front rămân în coadă, cu prima încercare în `v_izo_carantina_sync`; după eliberarea frontului de MP și „Pregătește”, aceleași `op_id`-uri se aplică o singură dată; una suprapusă între timp (aceeași țeavă) iese `conflict`;
    - **laptopul**: fără front → `alt_dispozitiv`; după predarea frontului de pe tabletă → declarația de ramura 2 trece; MP-ul (fără `inginer_izometrie`) nu poate sincroniza (`fara_drept`).
18. **Costul, izolarea, notele pe pachet** (r3):
    - apeluri repetate fără drept → `fara_drept` fără poartă (măsurat: fără `fn_izo_porti_lipsa` în plan / timp); peste 30 de apeluri pe minut, inclusiv duplicate și instantanee → `limita`, fără poartă;
    - fiecare intrare E4 sub `REPEATABLE READ` și `SERIALIZABLE` → `25001`, zero efecte;
    - pe un tronson în flux, din client: UPDATE doar pe `observatii` / `pm_cod` → 42501 (fără să fi luat pachetul: `pg_locks` arată doar rândul); INSERT (cu `tg_tevi_renumber`) → 42501 înainte de renumerotare; `fn_izo_pachet_rand_note` trece, cu CAS pe `updated_at`;
    - **client NDT ↔ legare**: `fn_izo_pachet_rand_note` ↔ `leaga` / `completeaza` pe același pachet, în ambele ordini: serializate pe pachet, fără deadlock;
    - un antet creat din client cu `status` aprobat pe un tronson în flux, concurent cu activarea → refuzat de `a0_izo_flux_pachete_dupa` sau activarea refuzată;
    - poarta: un trigger BEFORE nou, cu nume mai mic decât `a0_izo_flux_*`, pe oricare din cele trei tabele → porți lipsă.
19. **r4** (review Jakarinos pe r3):
    - **tăieri succesive**: T1 (copilul C) și T2 (sursa C), T1 aprobată singură → rezervarea lui T2 se transferă pe `bucata_id` = C; o altă tabletă care cere C → `conflict`; T2 se aprobă apoi pe rezervarea transferată; reconcilierea refuză un copil născut care mai are o rezervare activă pe `bucata_decl_uid`;
    - **PV-ul**: `izo_teren_editor` / `izo_montaj_writer` fără SELECT pe `izo_documente_intrare` (`has_table_privilege` = false); `fn_izo_pv_lipsa` → aceleași rezultate ca regula E3 §8; EXECUTE refuzat pentru `authenticated`;
    - **contorul după schemă**: o migrare care ține lock-ul schemei exclusiv + un apel de sincronizare concurent → apelul așteaptă la schemă, fără să fi scris contorul (`pg_locks`), fără deadlock;
    - **seria necunoscută**: ciornă `nerezolvata` → salvată; `sesiune_trimite` → `in_verificare`; un CHECK încălcat (`in_verificare` cu bucată, `trimisa` nerezolvată) → refuz;
    - **invalidarea**: `decl_sterge` pe o tăiere cu descendenți `ciorna` (montaj pe copil, sudura lui) → descendenții `blocata` în același lot, sub lock-uri luate la pasul 2, fără `resursa_neanuntata`; o versiune nouă a unui rând care revalidează R1 d → rezultatul `acceptat`, starea `conflict` (tranziția din tabel);
    - **ACK pierdut**: operația aplicată, răspunsul pierdut, retrimiterea → `duplicat` cu rezultatul salvat, iar tableta scoate operația; `conflict_op` → operația în lista „de verificat”, coada continuă;
    - **ramura administrativă**: `fn_izo_seteaza_flux` din API (`authenticator`) → refuz; ca `postgres`, sub REPEATABLE READ → `25001`; ca `postgres`, READ COMMITTED → trece prin poartă.
20. **r5** (review Jakarinos pe r4):
    - **lanțul rezervărilor** (pasul 10): tăiere + montaj pe copil în același lot și T1 + T2 în același lot → R `transferata`, R′ `consumata` cu evenimentul consumatorului, nicio rezervare activă pe copil; abaterile forțate din testul 13 → rollback total;
    - **seria lămurită, ca rolul real** `izo_montaj_writer` (nu `postgres`): `has_column_privilege(izo_montaj_writer, izo_declaratii, identificare / bucata_id, UPDATE)` = true; `fn_izo_serie_lamureste` pe un rând `in_verificare` → `trimisa`, `identificare = bucata`, rezervarea creată, fără `permission denied` și fără CHECK încălcat; pe o bucată rezervată de alt rând → `bucata_rezervata`, rândul rămâne `in_verificare`; writer-ul care schimbă `bucata_id` / `identificare` pe un rând `trimisa`, spre `bucata_decl` sau fără contextul funcției → refuzat de trigger;
    - **`conflict` în cascadă**: `decl_sterge` pe o tăiere cu un descendent `conflict` → descendentul `blocata`, cu `stare_inainte_blocare = conflict` și `conflict_cod` păstrat; revizia aceleiași tăieri → la fel; versiunea nouă a tăierii, cu copilul neschimbat → descendentul revine `conflict`;
    - **matricea cascadei**: pentru fiecare stare deschisă a descendentului × tipul sesiunii (deschisă / abandonată / trimisă) × operația (ștergere, revizie, respingere cu `respinge` / `blocheaza`) → exact rezultatul din §6.4; nicio cascadă legitimă nu primește „tranziție refuzată”; `respinge` pe o ciornă a unui autor cu front valid → `decizie_nepermisa`, zero efecte;
    - **revocarea pe o sesiune trimisă**: un rând revenit `conflict` după revizie, autorul revocat → MP-ul îl respinge (și rândurile `blocata` / `revizie_ceruta` rămase) → sesiunea `inchisa`, rezervările eliberate, iar `fn_izo_seteaza_flux(…, false)` trece (fără fapte);
    - **rezultat vs. stare**: R1 d găsit pe server → `izo_operatii.rezultat = acceptat`, `izo_declaratii.stare = conflict`, `conflict_cod = r1d`; retrimiterea → `duplicat` cu `acceptat`; zero scrieri în registru.
21. **r6** (review Jakarinos pe r5):
    - **pachetul ne-editabil, secvențial**: pe un pachet `aprobat` (și pe fiecare `status` ≠ `draft`), `completeaza` cu `p_updated_at` curent și un interval valid, `leaga` pe un rând nelegat, `dezleaga` → `pachet_needitabil`, zero efecte (rânduri, legături, `updated_at`, `izo_operatii`); `leaga` repetat pe aceeași pereche → fără efect, fără refuz; `fn_izo_pachet_rand_note` → trece;
    - **cursa `completeaza` ↔ `aprobare_transgaz`**, cu barieră, în ambele ordini, `pg_locks` arătând așteptarea pe pachet: completarea întâi → aprobarea refuzată `pachet_schimbat` (CAS), pachetul rămâne `draft`; aprobarea întâi → completarea refuzată `pachet_needitabil`; fără deadlock. La fel `leaga` / `dezleaga` ↔ `aprobare_transgaz`;
    - **aprobarea Transgaz retrimisă**: același fișier → fără efect; alt fișier pe pachetul aprobat → `pachet_needitabil`;
    - **`conflict` pe `corectie_in_arbore`**: tăierea unui copil cu diferența de lungime peste ±20 mm → rezultatul `acceptat`, starea `conflict`, `conflict_cod = corectie_in_arbore`; din această stare: versiunea nouă, ștergerea, `blocata` la invalidarea dependenței și `respinsa` de MP (sesiune trimisă) trec ca la `r1d`; un `conflict_cod` în afara listei → refuz (CHECK).
22. **r7** (review Jakarinos pe r6), rândurile `legare`:
    - **cuplarea cap-coadă, pozitiv**: tăierea țevii cu capătul liber (ramura 1) + cuplarea, aprobate → `completeaza` pe intervalul care conține cuplarea → pachetul are rândurile pieselor, legate, și rândul `legare` (proiecția din sudură, în ordinea lanțului, `updated_at` mutat) → `aprobare_transgaz` cu `p_updated_at` curent → trece: `status` aprobat, documentul scris, într-o tranzacție; retrimiterea cu același fișier → fără efect. La fel o cuplare între două capete de lanț fără tăiere;
    - **pachetul de cuplare** (review r7): două lanțuri cu piesele terminale în pachetele P1 și P2, ambele aprobate de Transgaz → cuplarea fără tăiere dintre capetele lor, declarată și aprobată → `completeaza` pe un pachet nou P3, cu intervalul = cuplarea → P3 are doar rândul `legare` → `aprobare_transgaz` pe P3 trece; P1 și P2 rămân neschimbate (rânduri, legături, `updated_at`, `status`); a doua completare a aceleiași cuplări, pe P4 → `legare_dubla`;
    - **cuplarea neaprobată la completare**: cuplarea încă `declarata` în interval → `completeaza` refuzată (gol în lanț), zero efecte; după aprobarea ei, aceeași cerere (cheie nouă) → trece;
    - **refuzul la aprobarea Transgaz**, pe rânduri `legare` forțate în harness (scrise ca `postgres`, cu garda ocolită, ca abaterile din testul 13), fiecare pe un pachet altfel valid: `sudura_cod` fără sudură sau nenormalizabil → `legare_fara_sudura`; sudura `declarata` → `legare_sudura_neaprobata`; sudura `anulata` (forțată, ca în E10) → `legare_fara_sudura`; o sudură `linie` → `legare_sudura_neaprobata`; codul unei suduri de pe alt tronson → `legare_fara_sudura`; un singur capăt activ, un capăt pe `bucata_decl_uid`, pe o bucată ne-`montata` sau de pe alt tronson → `legare_capete`; aceeași sudură în rândurile `legare` a două pachete → `legare_dubla`; o proiecție schimbată (de exemplu o lungime pe rândul `legare`) → `legare_proiectie`. În fiecare caz: zero efecte (`status` `draft`, niciun document, `updated_at` neschimbat), iar după repararea forțată aprobarea trece;
    - **verificarea pe bucată doar pe `teava` / `curba`**: un pachet cu o cuplare nu primește `rand_nelegat` pe rândul `legare`; un rând `teava` dezlegat în același pachet → `rand_nelegat`; un rând `separator` forțat pe un pachet în flux → `rand_nelegat` (fail-closed);
    - **`leaga` / `dezleaga` pe un rând `legare`** → `rand_fara_bucata`, zero efecte;
    - **curse**, cu barieră, în ambele ordini, `pg_locks` arătând așteptarea: `completeaza` ↔ `completeaza` pe două pachete cu aceeași cuplare → a doua așteaptă pe sudură, apoi `legare_dubla` (sau intervalul suprapus), fără deadlock; `aprobare_transgaz` ↔ aprobarea unei tăieri care mută capătul unei cuplări din pachet (bucata nelegată de niciun pachet) → serializate pe sudură, fără deadlock, iar aprobarea Transgaz trece în ambele ordini (capătul rămâne pe o bucată `montata` a tronsonului);
    - **activarea fluxului** pe un tronson cu un rând `legare` fără sudura de cuplare verificată (de exemplu un pachet vechi, scris din client înainte de flux) → refuzată (rânduri nelegate, §7.1).

## 12. Întrebări deschise (A / B / C)

Recomandarea e prima variantă, dacă nu scrie altfel. Blochează codul: Q-E4-1, Q-E4-2, Q-E4-4, Q-E4-5, Q-E4-12, Q-E4-15 (r3); r4: și Q-E4-6, Q-E4-9, Q-E4-10, Q-E4-14, care schimbă contractele (PV-ul, cheia de modul, GPS-ul, frontul). r5: Q-E4-12 A cere și verificarea pe PT a robinetelor de pe T14 / T15; Q-E4-15 A cere acceptarea explicită a păstrării permanente a coordonatelor. Celelalte (Q-E4-3 C, Q-E4-7 / 8 / 11 / 13 / 16 A) nu blochează arhitectura, dar se confirmă înaintea funcției pe care o ating. Corpul documentului e scris pe recomandări, dar ele devin decizii doar cu răspunsul lui Razvan.

1. **Q-E4-1 — Unde se activează montajul.**
   - **A** pe tronson (`izo_tronson_config.flux_montaj`), cu proiectul rămas la `stoc`. Pachetul T12 și editorul vechi merg mai departe; pilotul e pe T14 / T15.
   - B pe tot proiectul (`montaj`): 2c refuză tot pe `executie_tevi`, deci se oprește lucrul pe T12.
   - C `montaj` pe proiect, dar închiderile doar pe tronsoanele în flux (gărzile 2c se rescriu încă o dată).
2. **Q-E4-2 — Ieșirea din depozit și ce propune tableta.**
   - **A** ieșirea intră în E4 (Janeta, cu avizul CJPT / CJPJ). Tableta arată și bucățile din depozit, „cere ieșirea”, iar aprobarea așteaptă ieșirea.
   - B ca în v2.3: montaj din depozit cu alertă HIGH neblocantă, regularizat ulterior.
   - C doar `pe_tronson`: pilotul pornește după ieșirile introduse în ERP.
3. **Q-E4-3 — Confirmarea lungimii** (#1789: „nu salvare directă la un tap”).
   - **C** cele 2 cifre de pe marcaj confirmă lungimea, iar salvarea e o a doua atingere, separată, care apare după o pauză de 450 ms.
   - A prototipul v4: cifrele confirmă și salvează automat, cu „Desfă” 8 s.
   - B v2.3: butonul „CONFIRM LUNGIMEA”, apoi „SALVEAZĂ”, fără cifrele de pe marcaj.
4. **Q-E4-4 — Offline-ul în E4.**
   - **A** coada durabilă + protocolul final în E4; shell-ul offline în E6.
   - B tot offline-ul în E4 (E4 și E6 împreună, livrare mai lungă).
   - C E4 doar online, fără coadă; coada vine în E6.
5. **Q-E4-5 — Pachetul.**
   - **A** pe tronsoanele în flux, serverul scrie rândurile din montajele aprobate (`completeaza`), iar picker-ul leagă. Pe T12, picker-ul rămâne text, iar legarea istorică vine în E4c.
   - B aprobarea adaugă singură rândurile în pachetul de lucru al tronsonului.
   - C fără pachet în E4: îl construiește E5b. Pe T12, legarea bucăților `pe_tronson` ca pre-identificare.
6. **Q-E4-6 — PV-ul bucăților venite prin E3.**
   - **A** regula E3 §8 rămâne: bucata dintr-un aviz fără PV nu iese, nu se taie și nu se montează (stocul LOT 2 de azi vine din import, fără aviz). Se potrivește cu E3, care refuză PV-ul pe bucăți ieșite înainte de el (§10.6).
   - B extinderea contractului PV: PV-ul se poate pune și pe bucăți ieșite (design separat).
   - C PV-ul se cere doar la emiterea pachetului (E8).
7. **Q-E4-7 — Restul.**
   - **A** tot restul în depozit; sub 0,50 m `rest_nereutilizabil`; fără deșeu pe tabletă; primirea doar după aprobare.
   - B ca A, plus bifa „deșeu”, cu motiv și confirmarea gestionarului (v2.3).
   - C ca A, plus primirea și înainte de aprobare (v2.3).

   Și: confirmi pragul de 0,50 m?
8. **Q-E4-8 — Înlocuitorul MP-ului.** VICIU MARIUS ALEXANDRU (emp 177) e azi `inginer_izometrie`; v2.3 (D2#8) îl numea pe „Alexandru Biciu” înlocuitor.
   - **A** Viciu rămâne doar inginer; nu există înlocuitor până îl numești tu (tu ești rezerva).
   - B Viciu e și `inlocuitor_aprobator`: aprobă doar rândurile lui Titi, niciodată pe ale lui.
   - C altcineva.
9. **Q-E4-9 — Cheia de modul a tabletei.**
   - **A** o sub-cheie nouă, `executie.izometrie` (rând nou în `app_modules`, date reale, cu „da”), cu editor pentru Titi, Viciu și Toma.
   - B `executie` editor, cum există, + atribuirea: fără cheie nouă, dar `executie` deschide mult în UI.
   - C o cheie separată, `izometrie_teren`.
10. **Q-E4-10 — GPS-ul și tronsonul.**
    - **A** în pilot tronsonul se alege manual. GPS-ul doar se salvează la declarație; nicio comparație GPS ↔ tronson în E4 (r3: comparația cere axul calibrat, care nu e în BD; vine cu B, în E6).
    - B tronsonul propus din GPS, pe axul KML calibrat: cere `izo_surse_proiect` + `izo_ax_ancore` în BD, încărcate cu „da”.
    - C fără GPS în E4.
11. **Q-E4-11 — Importul REPLACE atomic** (promis de 2c pentru E4a).
    - **A** un PR separat, după pilot.
    - B în E4a.
12. **Q-E4-12 — Cut-out-ul și robinetele** (ramurile din §8.5).
    - **A** ramura 1 (capătul liber, cuplarea) intră în E4, pe tabletă și pe laptop; ramura 2 (tăierea în mijloc pe o țeavă sudată la ambele capete) în E4 doar de pe laptopul inginerului, cu frontul predat de tabletă (§8.5; MP-ul nu declară); ramura 3 (scoaterea unei suduri) în E10. Robinetele (`izo_elemente_fara_stoc`) doar dacă pe T14 / T15 există un robinet din proiect (de verificat pe PT).
    - B ramura 2 și pe tabletă, în E4.
    - C ramura 2 după pilot.
13. **Q-E4-13 — Cum află MP-ul.**
    - **A** din lista de pe ecranul de aprobare, cu numărul de sesiuni trimise; fără scrieri în `notifications`, fără cron.
    - B notificarea zilnică (`izo_notificari_zilnice` + un rând în `notifications`).
    - C ca B, plus jobul zilnic de alerte.

    **B și C sunt automatizări noi** (un cron sau un trigger notabil, CLAUDE.md pct. 7). Înainte de pornire cer, în aceeași sesiune: fișa de securitate a–e în `registru_automatizari`, un rând în `public.automatizari` și un pas de confirmare umană (Razvan pornește automatizarea, cu „da”). Fișa: citește doar date interne (declarații, alerte), scrie doar în `notifications`, fără mail și fără bani. Rulează ca `postgres` sau ca un rol dedicat, nu ca `service_role` fără justificare. Nu se poate porni din API.
14. **Q-E4-14 — Fronturile.**
    - **A** un singur dispozitiv activ pe tronson, în pilot.
    - B pe interval de km.
15. **Q-E4-15 — Coordonatele GPS (date personale).** În toate variantele, coordonatele stau doar în `izo_declaratii_gps`, niciodată în JSON-uri (§9.5). **DECIS 24.10.2026 (Răzvan): B, cu termenul de 60 de zile de la decizia pe declarație (aprobare, respingere sau ștergere)**, nu de la aprobarea Transgaz. Implementarea e în migrarea nouă `20261111a` (`fn_izo_gps_curata` + pg_cron zilnic + jurnalul `izo_gps_stergeri`, fără coordonate). Până la apply rămâne comportamentul A (coordonatele se păstrează). Detalii în `E4_PILOT.md` §3.
    - **A** păstrate, vizibile doar MP-ului și owner-ului (fără SELECT pe tabel, doar `fn_izo_gps_citeste`).
    - B ca A, dar șterse după aprobarea pachetului de Transgaz (singurul DELETE din E4, printr-o funcție sub context).
    - C păstrat doar km-ul calculat; tabelul GPS nu se mai creează. (r4: C cere sursa km-ului, adică axul calibrat din Q-E4-10 B; cu Q-E4-10 A nu e implementabil.)
16. **Q-E4-16 — Raport de sesiune semnat.**
    - **A** nu: doar fișa de tăiere (Q9).
    - B și un PDF al sesiunii aprobate, semnat de MP, pentru dosar.

## 13. Livrarea și „da”-urile

1. **Acest design** → review Copilot (conversația Module) + Jakarinos, iar Gemini ca opinie suplimentară. Apoi răspunsurile lui Razvan la §12.
2. **Precondiții**: #825 (E3) aplicată și cu merge făcut; `20261104a` + `20261104b` trec pe harness și pe branch-ul PG17.
3. **Migrările E4a + E4b** (schemă, cu „da”), apoi UI-ul: tableta, aprobarea, depozitul, picker-ul.
4. **Datele și drepturile**, fiecare cu „da” separat:
   - cheia de modul + accesul (Titi, Viciu, Toma);
   - `izo_tronson_config` pentru T14 / T15 (sensul numerotării, zonele de perete);
   - activarea fluxului pe T14 / T15;
   - ieșirile Janetei pe T14 / T15.
5. **Pilotul**, cu semnal, o săptămână în paralel cu hârtia.

## Notă: probele pe branch Supabase (lecția E3b, 22.10.2026)

De la E3 r5h, lista albă a porții amprentează **corpul** funcțiilor de platformă (`realtime.subscription_check_filters`, `extensions.grant_pg_net_access`, `extensions.grant_pg_graphql_access`, plus excepțiile mutatorilor; `E3_CONFIRMA_DESIGN.md` §17–18).
- Un branch Supabase nou are adesea o platformă mai nouă decât prod (22.10: pg_net 0.20.4 pe branch, 0.20.0 pe prod). `postgres` nu poate înlocui acele funcții, al căror owner e `supabase_admin`; nici prin MCP nu se poate. Rezultatul: poarta E3 e roșie și orice migrare E3 / E3b / E4 e refuzată pe branch.
- **Proba pe branch cere un override declarat** pe amprenta funcției respective, în copii de probă, cu diff-ul și ambele sha-uri în raport, cât timp platforma branch-ului e mai nouă decât prod.
  - Override-ul a fost refuzat de clasificatorul de permisiuni al sesiunii (Security Weaken), deci cere aprobarea explicită a lui Razvan în acea sesiune.
  - Alternativă: fără probă PG17. Garanțiile rămân harness-ul local, review-ul și dry-run-ul pe prod. Așa s-a decis pentru E3b (Razvan B, 22.10).
- **Pentru E4:** se decide din design, înainte de cod, care variantă se folosește. Proba de pe branch a E3b (`scripts/izometrie/e3b_gen/proba_pg17/`) se refolosește, inclusiv replicile din `baseline_pre_e3.json` și verificarea amprentelor (`verifica.sql`).
