# E4 — Montajul: tableta inginerului de izometrie, cu salvare (design r1, pentru review ÎNAINTE de cod)

**Stare**: r1, prima ciornă. Fără cod, fără nicio scriere în BD (doar SELECT-uri de catalog și numărători, 21.10.2026). Branch `izometrie/e4-design`, din `origin/izometrie/e3` (#825, încă deschis; `20261103b` neaplicată). La merge-ul #825 se face retarget pe `main` înainte de ștergerea branch-ului de bază (anti-bug #1785).

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
- trigger-ele existente pe `executie_tevi` / pachete sunt DEFINER, owner `postgres` (în afară de `touch`).

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
9. **De decis**: 16 întrebări (§12). Țin codul Q-E4-1 (fluxul pe tronson), Q-E4-2 (ieșirea din depozit), Q-E4-4 (offline) și Q-E4-5 (pachetul).

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
- `sens_numerotare` ∈ {`crescator`, `descrescator`} (pe IZO TR9 numerele scad);
- `perete_proiectat` jsonb: zonele cu peretele cerut de proiect (pe interval de suduri sau de km), cu textul (de exemplu „subtraversare DN1A”). Alimentează avertizarea informativă din prototip (`ZONE_PERETE`); gol = fără avertizare;
- `executant_implicit` text (Gazpet; Petroconst pe T16 / T17, D#18): doar propunere pe sudură;
- `server_ver`.

**`fn_izo_seteaza_flux(p_tronson, p_activ, p_motiv)`**
- Owner `izo_montaj_writer`; EXECUTE doar `postgres`; cere `session_user = postgres`. O rulează sesiunea de chat, cu „da”.
- Pornirea cere:
  - nivelul proiectului ≠ `off`;
  - porțile complete (E2a + E3 + E4);
  - tronsonul fără rânduri de pachet nelegate. T14 / T15 n-au pachete.
- Oprirea e refuzată după primul fapt de montaj pe tronson, ca `stoc → off` în E2a.

`fn_izo_nivel(p) = 'montaj'` (proiectul întreg) rămâne rezervat pentru „toate tronsoanele în flux” (E8); E2a îl refuză în continuare.

### 3.2 Tableta (E4b)

**`izo_fronturi`**: un dispozitiv activ pe tronson (pilot, v2.3 §4.6).
- `id`, `proiect_id`, `tronson_id`, `profile_id`;
- `dispozitiv_id`: uuid generat de tabletă la primul „Pregătește”;
- `de_la`, `expira_la` (implicit +14 h), `predat_la`, `activ`;
- UNIQUE (`tronson_id`) WHERE `activ`.

**`izo_operatii`**: jurnalul de idempotență, comun tabletei și ecranelor de birou.
- UNIQUE (`autor_profile_id`, `op_id`);
- `canal` ∈ {`teren`, `aprobare`, `depozit`, `pachet`}, `tip_op`;
- `dispozitiv_id`, `seq` (doar pe `teren`), `versiune_format`;
- `payload` jsonb canonic + `payload_sha256`, **calculat de server**;
- `rezultat` ∈ {`acceptat`, `duplicat`, `conflict`, `blocat_de_conflict`, `alt_dispozitiv`, `alt_autor`, `eroare`}, `cod`, `mesaj`;
- `raspuns` jsonb: exact ce se întoarce la o retrimitere;
- `ora_tableta`, `ora_server`, `offset_ceas_s`;
- doar adaug: UPDATE / DELETE / TRUNCATE refuzate;
- operațiile `alt_*` rămân aici, cu payload-ul lor. Ele sunt „carantina de sincronizare” din v2.3, ca vedere, nu ca tabel separat. Aplicarea lor, de către MP, cu motiv, vine în E6.

**`izo_preverificari`** (sesiunea: proiect, tronson, zi, autor):
- `id`, `uid` (generat de tabletă, UNIQUE), `proiect_id`, `tronson_id`, `zi` (Europe/Bucharest), `autor_profile_id`, `dispozitiv_id`;
- `stare` ∈ {`deschisa`, `trimisa`, `inchisa`}, `trimisa_la`, `trimisa_op_id`;
- `versiune`: +1 la fiecare scriere;
- o singură sesiune `deschisa` per (tronson, autor): UNIQUE parțial.

**`izo_declaratii`** (rândul; în v2.3, `izo_preverificari_randuri`):
- **Identitatea**:
  - `id`, `uid` (generat de tabletă, UNIQUE), `preverificare_id`, `proiect_id`, `tronson_id`;
  - `tip` ∈ {`montaj`, `taiere`, `cuplare`};
  - `versiune` (≥ 1), `declarat_de`, `dispozitiv_id`, `ultimul_op_id`.
- **Starea**: `stare` ∈ {`ciorna` (sesiune deschisă), `trimisa`, `in_verificare`, `conflict`, `blocata`, `revizie_ceruta`, `aprobata`, `respinsa`, `stearsa`}.
- **Montaj**:
  - piesa: `bucata_id` | `bucata_decl_uid` (copilul unei tăieri) | niciuna (rândul `in_verificare`);
  - `capat_amonte`: litera capătului care se sudează amonte (implicit prima);
  - legătura amonte: `amonte_tip` ∈ {`bucata`, `decl`, `inceput_lant`}, `amonte_ref`, `amonte_capat`;
  - `sudura_nr`, `sudura_sufix`: sudura amonte, cu capetele (amonte, piesă);
  - `lungime_montata_mm`;
  - **confirmarea lungimii**: `lungime_confirmata_mod` ∈ {`marcaj`, `marcaj_diferit`, `masurat`, `taiata`}, `lungime_confirmata_cm` (cele 2 cifre tastate de pe marcaj), `lungime_masurata_mm`, `lungime_confirmata_la` (ora tabletei);
  - `depinde_de_uid`: tăierea din care vine piesa.
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
  - GPS: `gps_lat`, `gps_lon`, `gps_precizie_m`, `gps_la`, citite doar la salvare (D2#15);
  - `km_propus_m`, `ora_tableta_creat` / `ora_tableta_modif`;
  - `executant`, `poanson`;
  - `data_montaj`: cel mult azi și cel puțin data ieșirii pe tronson.
- **Decizia**: `aprobare_id`, `aprobat_de`, `aprobat_la`, `motiv_decizie`, `eveniment_ids` bigint[].
- **CHECK-uri**: coerența pe `tip` (câmpurile celorlalte tipuri sunt NULL); `in_verificare` ⇔ fără bucată.
- **Istoricul**, `izo_declaratii_versiuni` (doar adaug):
  - coloane: `declaratie_id`, `versiune`, `payload`, `payload_sha256`, `op_id`, `la`;
  - o versiune nouă e permisă doar în `ciorna` sau după `revizie_ceruta`.

**`izo_bucati_declarate`** (copiii tăierilor încă neaprobate, v2.3 §1.6):
- `uid` PK (generat de tabletă), `declaratie_id`;
- `parinte_bucata_id` | `parinte_decl_uid`, `radacina_id`;
- `lungime_mm`, `lungime_calculata`;
- `capat_stanga`, `capat_dreapta`, `cod_bucata`: **literele rezervate de server la acceptare**, în ordinea sosirii;
- `destinatie` ∈ {`montaj`, `ramane_montat`, `depozit`}, `depozit_destinatie_id`;
- `stare` ∈ {`declarata`, `aprobata`, `anulata`};
- `bucata_id`, după aprobare (cu același `uid` în `magazie_bucati.uid`);
- UNIQUE (`radacina_id`, `cod_bucata`) WHERE `stare = 'declarata'`. Împreună cu `ux_magbuc_izo_cod` (E2a, pe aceleași coloane), o literă nu se dă de două ori. Uid-ul copilului e unic și în registru (`ux_magbuc_izo_uid`), deci un uid refolosit în alt arbore e refuzat (`uid_alt_arbore`).

**`izo_rezervari`** (Q2 A):
- `id`, `proiect_id`, `bucata_id`, `declaratie_id`;
- `tip` = `fizic` (în E4; `planificat` vine după pilot);
- `activa`, `creata_la`, `eliberata_la`;
- `motiv_eliberare` ∈ {`versiune_noua`, `stearsa`, `respinsa`, `consumata`}, `eveniment_id`;
- UNIQUE (`bucata_id`) WHERE `activa`: arbitrul când două tablete aleg aceeași țeavă.

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

**`izo_aprobari`** (lotul aprobat de MP):
- `id`, `cheie_operatie` uuid UNIQUE (idempotența), `proiect_id`, `tronson_id`, `aprobator`;
- `randuri` jsonb: [{`declaratie_id`, `versiune`}];
- `hash` al listei, `eveniment_ids`, `creat_la`.

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
| tăiere | copilul rămas în șanț (cuplare / cut-out) | — | `montata` | tronsonul, cu aceleași capete |
| tăiere | restul | — | `in_tranzit` | tronsonul tăierii; destinația în `atribute.destinatie_depozit_id` |
| montaj | piesa | `pe_tronson` | `montata` | tronsonul |
| primire | restul | `in_tranzit` | `retur` (≥ `prag_rest_mm`) / `rest_nereutilizabil` (sub prag) | depozitul de destinație |
| corecție | piesa | neschimbată | neschimbată | `lungime_masurata_mm` / `lungime_mm`, cu `inainte` / `dupa` |

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
- `tip_rand`: `teava` / `curba`, iar `legare` pentru o cuplare;
- `sudura_cod`: sudura aval, după convenția IZO (rândul i = țeava i + sudura dintre i și i+1).

`pm_cod`, `pa_ut_cod`, `ut_cod` și `observatii` rămân editabile din client până la E10.

### 3.5 Codul sudurii

- **Identitatea**: (`proiect`, `tronson`, `nr`, `sufix`).
- **Afișarea**: `TR` + numărul tronsonului + `S` + nr, **fără zerouri** (`TR14S7`, `TR13S48`), după `izo_proiect_config.format_sudura` (`TR`) și `formatSudura({…}, { prefix: 'TR', pad: 0 })`.
- **Normalizatorul SQL** `fn_izo_sudura_normalizeaza(text, tronson)` = `normalizeazaSudura` din `src/lib/izoSudura.js`, testate pe același `izoSudura.cazuri.json`.
- **Sufixele**: doar cele din `conventie_sufixe`. Cât convenția e goală, tableta dă numai coduri fără sufix; un R final rămâne „cod de confirmat”.
- **Numerotarea**:
  - numărul următor = max(aprobate, declarate) + 1, în sensul `sens_numerotare`;
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
| `fn_izo_teren_preda(p_tronson, p_dispozitiv)` | `izo_teren_editor` | `authenticated` | predă frontul (cere coada goală) |
| `fn_izo_sync_push(p_dispozitiv, p_ops)` | `izo_teren_editor` | `authenticated` | lotul de operații (cel mult 50), cu rezultatul pe fiecare operație (§5.4) |
| `fn_izo_aprobare_lot(p_preverificare)` | `izo_montaj_writer` | `authenticated` | doar citire: rândurile, versiunile, efectele așteptate, alertele, hash-ul lotului |
| `fn_izo_aproba(p_cheie, p_preverificare, p_randuri, p_hash, p_decizii)` | `izo_montaj_writer` | `authenticated` | faptele (§6.3) |
| `fn_izo_revizie_cere(p_decl, p_versiune, p_motiv)` | `izo_montaj_writer` | `authenticated` | „revizie cerută” pe un rând |
| `fn_izo_respinge(p_cheie, p_decl, p_versiune, p_motiv, p_dependente)` | `izo_montaj_writer` | `authenticated` | respingerea, cu decizia pe fiecare dependență |
| `fn_izo_serie_lamureste(p_decl, p_versiune, p_bucata, p_motiv)` | `izo_montaj_writer` | `authenticated` | rândul „în verificare” trece pe bucata reală (rămâne de aprobat) |
| `fn_izo_tranzitie_confirma(p_sudura, p_motiv)` | `izo_montaj_writer` | `authenticated` | „tranziție executată conform proiect / WPS” |
| `fn_izo_iesire_tronson(p_cheie, p_depozit, p_tronson, p_bucati, p_nr_aviz, p_data)` | `izo_montaj_writer` | `authenticated` | ieșirea pe tronson (gestionar) |
| `fn_izo_primire_depozit(p_cheie, p_depozit, p_bucati)` | `izo_montaj_writer` | `authenticated` | primirea resturilor în depozit (gestionar) |
| `fn_izo_pachet_completeaza(p_cheie, p_pachet, p_updated_at, p_sudura_de, p_sudura_pana)` | `izo_montaj_writer` | `authenticated` | adaugă în pachet rândurile din montajele aprobate (§7.2) |
| `fn_izo_pachet_leaga(p_teava, p_bucata, p_updated_at)` / `fn_izo_pachet_dezleaga(p_teava, p_motiv)` | `izo_montaj_writer` | `authenticated` | picker-ul ca legătură reală (§7.3) |
| `fn_izo_pachet_aprobare_transgaz(p_pachet, p_cale, p_sha256)` | `izo_montaj_writer` | `authenticated` | varianta minimă (E4a), doar pe tronsoanele în flux: fișierul + documentul + statusul, într-o tranzacție |
| `fn_izo_seteaza_flux(p_tronson, p_activ, p_motiv)` | `izo_montaj_writer` | `postgres` | §3.1 |

**Ajutătoarele interne**: owner `postgres`, EXECUTE doar pentru rolurile E4; REVOKE de la PUBLIC, `anon`, `authenticated`, `service_role`.
- intrarea și autorizarea: `fn_izo_montaj_api_verifica`, `fn_izo_montaj_autorizare_lock`;
- contextul și garda: `fn_izo_montaj_marcheaza` (owner `izo_montaj_writer`), `fn_izo_garda_montaj`, `fn_izo_garda_teren`;
- efectele așteptate: `fn_izo_decl_efecte(decl, versiune)`, `fn_izo_pachet_rand_asteptat`, `fn_izo_coloane_tevi`;
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
  "lungime_montata_mm":8000,"confirmare":{"mod":"taiata"},"depinde_de_uid":"T1",
  "gps":{"lat":"…","lon":"…","precizie_m":6,"la":"…"}}}
```

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
- **frunzele active ale proiectului**, în formă compactă: id, uid, serie, serie_canon, șarjă, `lungime_mm`, `lungime_cm`, `perete_mm`, `tip_cod`, stare, tronson / depozit, „rezervată de” (declarația, sudura), „fără PV”. Servesc R1 (d) și R2 offline: ~3.400 de rânduri, sub 1 MB;
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

Pașii (v2.3 §4.4b, adaptat):

0. **`fn_izo_teren_api_verifica()`**:
   - lock-ul schemei, partajat;
   - `session_user = authenticator`, JWT `authenticated`, uid prezent;
   - contextele goale;
   - poarta completă (E2a + E3 + E4).
1. **Frontul**: rândul activ din `izo_fronturi` al dispozitivului, FOR SHARE. Dacă alt dispozitiv e activ pe tronson, toate operațiile primesc `alt_dispozitiv`: se jurnalizează, fără efecte.
2. **Fiecare operație**, în ordinea `seq`, are savepoint propriu (`BEGIN … EXCEPTION`):
   1. **Înregistrarea**: INSERT în `izo_operatii` (autor, `op_id`, sha256 calculat de server pe payload-ul canonic), ON CONFLICT DO NOTHING:
      - există cu același hash → `duplicat`, plus `raspuns`-ul inițial;
      - există cu alt hash → `conflict` (`izo_conflict_sync`), fără efecte.
   2. **Autorizarea**, sub lock: `inginer_izometrie` activ pe proiect + cheia de modul. Apoi sesiunea FOR UPDATE și declarația FOR UPDATE (după uid).
   3. **Locul**: rândul `izo_tronson_config` FOR SHARE (fluxul activ), apoi proiectul și tronsonul FOR SHARE; nivelul ≠ `off`.
   4. **Rădăcinile** bucăților atinse, inclusiv ale părinților declarați: FOR UPDATE, în ordinea id-ului (`fn_izo_radacini_blocheaza`, DEFINER), aceeași ordine ca la aprobare.
   5. **Validarea completă**:
      - tipurile și intervalele;
      - starea bucății, PV-ul, carantina, tronsonul;
      - R1 (d) pe frunze + declarate; R3 pe tăiere; R4 pe sudură;
      - confirmarea lungimii: la `marcaj`, cifrele tastate = centimetrii bucății.
   6. **Efectele**:
      - versiunea declarației (+ istoricul);
      - rezervarea: cea veche se eliberează (`versiune_noua`), se creează cea nouă; 23505 → `conflict`;
      - bucățile declarate, cu literele rezervate;
      - sudura declarată: `INSERT … ON CONFLICT (identitate) DO NOTHING`, apoi recitire FOR UPDATE; alte capete → `conflict` (R4).
   7. **`raspuns`** se salvează pe operație.

   O eroare pe o operație dă `eroare` (cu cod); operațiile care depind de ea (`depinde_de_uid`) primesc `blocat_de_conflict`. Lotul continuă.
3. **Golurile de `seq`**: serverul ține ultimul `seq` pe dispozitiv. Un gol nu oprește lotul; deschide `izo_gol_operatii` (MEDIUM).
4. **Răspunsul**: rezultatul pe operație + starea curentă a declarațiilor atinse + `server_ver_max`. Dacă `server_ver_max` s-a mișcat, tableta reîmprospătează instantaneul.

Tripleta dublată (R1 d) găsită pe server nu oprește operația, pentru că tăierea fizică s-a întâmplat deja. Declarația e acceptată cu `stare = conflict` (R1 d deschis, „revizie cerută”), iar nimic nu intră în registru până la lungimea reală.

### 5.5 Conflictele

| Situația | Serverul | Ce arată tableta |
|---|---|---|
| două tablete, pe tronsoane diferite, aleg aceeași țeavă | a doua rezervare dă 23505 → `conflict` | cardul roșu „montată și pe TR15S3 (Viciu, 11:20)”; alege altă țeavă (prototip `SERVER_MONTAT`) |
| bucata e montată, tăiată sau mutată între instantaneu și sincronizare | `conflict` (starea bucății) | la fel |
| aceeași sudură (nr + sufix), declarată cu alte capete | `conflict` (R4) | „sudura există cu altă țeavă — verifică numărul” |
| copil cu tripletă dublată (R1 d), aflată pe server | `conflict`, „revizie cerută” | „măsoară din nou lungimea reală” |
| tăiere sau montaj pe o bucată fără PV / în carantină | `eroare` (`fara_pv` / `carantina`) | mesaj clar; alege altă țeavă |
| alt dispozitiv pe front | `alt_dispozitiv` (operațiile rămân în `izo_operatii`) | „tronsonul e luat de altă tabletă”; decide MP-ul |
| retrimitere identică / același `op_id` cu alt conținut | `duplicat` / `conflict` | nimic / roșu |
| declarația a fost schimbată pe server între timp (revizie cerută, respinsă) | `conflict` (CAS pe `versiune_baza`) | reîncarcă declarația |

### 5.6 Idempotența, pe canale

- **Tableta**: (autor, `op_id`) + hash-ul calculat de server.
- **Aprobarea**: `cheie_operatie` (uuid generat la deschiderea lotului) + hash-ul listei (declarație, versiune). Aceeași cheie cu același hash → același răspuns; cu alt hash → refuz.
- **Gestionarul** (ieșire, primire) și **pachetul** (`completeaza`): `cheie_operatie` în `izo_operatii`, pe canalele `depozit` / `pachet`.
- **Legarea unui rând**: naturală (aceeași pereche nu mai are efect) + CAS pe `executie_tevi.updated_at`.

### 5.7 Ceasul, GPS-ul, identitatea

- **Ceasul**: ora oficială = `now()` pe server. `offset_ceas_s` se calculează la fiecare lot; peste 5 minute dă LOW `izo_ceas_tableta`. Data montajului e declarată, cu limitele de la §3.2.
- **GPS-ul**:
  - se citește **doar la salvarea declarației** (lat / lon / precizie / oră); nu se înregistrează niciun traseu între declarații (D2#15);
  - propunerea tronsonului din GPS: Q-E4-10;
  - vizibilitatea coordonatelor (dată personală): Q-E4-15.
- **Dispozitivul**: un uuid generat la primul „Pregătește” și păstrat în IndexedDB; fără amprentarea dispozitivului.
- **Două taburi**: Web Locks; al doilea e „doar citire” (prototip `otherTab`).

### 5.8 Ce verifică tableta offline și ce reverifică serverul

| Regula | Tableta (offline, pe datele locale) | Serverul, la acceptare | Serverul, la aprobare |
|---|---|---|---|
| formatul seriei `999AA99999`; prefixul; aceleași 3 cifre pe 2 prefixe (alegere explicită) | da | — | — |
| bucata disponibilă / rezervată | da (instantaneul) | da (arbitru: rezervarea) | da |
| R1 (d), tripleta serie + șarjă + lungime la cm | da, blochează salvarea normală | da (`conflict`, revizie) | refuz |
| R3, conservarea la tăiere | da | da | da (exact) |
| R4, sudura cu 2 capete; capătul liber | da | da | da |
| R5, lungimea ≤ disponibil + 20 mm, ≤ `lungime_max_mm` | da | da | da |
| confirmarea lungimii | da (pas separat) | da (cifrele = centimetrii) | da |
| tranziția de perete 7,1 ↔ 8,8 | informativă | calculată | calculată; o confirmă MP-ul înainte de emitere (E8) |
| peretele cerut de proiect (zonele) | informativ | — | afișat |
| seria „în verificare” | nu blochează trimiterea | acceptată | nu se aprobă |
| GPS-ul arată alt tronson | întrebare, o dată pe sesiune | — | LOW |

## 6. Fluxul de aprobare

### 6.1 Trimiterea sesiunii (operația `sesiune_trimite`)

- Conține lista (uid, versiune) a declarațiilor sesiunii. Serverul cere ca lista să fie exact mulțimea declarațiilor `ciorna`; altfel `conflict`, „sesiunea s-a schimbat”.
- E refuzată cât există rânduri blocante (conflict, R1 d, R4, lungime neconfirmată). Răspunsul le listează, iar sesiunea rămâne deschisă (prototip: „respins”).
- Rândurile „în verificare” nu o opresc (D2#2): trec în `in_verificare`.
- După trimitere, declarațiile sunt `trimisa` și imutabile, iar sesiunea e `trimisa`. Cum află MP-ul: Q-E4-13.

### 6.2 Ecranul MP-ului (Execuție → Izometrie → Aprobare teren)

- **Lotul**, pe zi și tronson, arată: rândurile cu alertele lor, dependențele (tăiere → montaj), frunzele arborelui la fiecare țeavă tăiată, rândurile „în verificare”, tranzițiile de perete și corecțiile de lungime.
- MP-ul bifează rândurile. Ecranul cere `fn_izo_aprobare_lot` (versiunile, efectele așteptate, hash-ul) și trimite înapoi exact perechile văzute.

### 6.3 `fn_izo_aproba(p_cheie, p_preverificare, p_randuri, p_hash, p_decizii)`

Ordinea, ca în E3 §4:

1. `fn_izo_montaj_api_verifica()`: schema, API, poarta.
2. `izo_operatii` (canalul `aprobare`, cheia). La retrimitere cu același hash, se întoarce răspunsul salvat.
3. Sesiunea FOR UPDATE; declarațiile din listă FOR UPDATE, după id.
4. **Autorizarea**, sub lock, toate FOR SHARE: `profiles` → `user_module_access` (cheia exactă, editor) → `izo_atribuiri` (`manager_aprobator` sau `inlocuitor_aprobator`, activă, valabilă azi).
5. Proiectul, tronsonul și depozitele de destinație ale resturilor FOR SHARE (`fn_izo_blocheaza_locuri`).
6. `fn_izo_blocheaza_tabele()` + advisory partajat (73010, proiect).
7. Rădăcinile FOR UPDATE după id, apoi bucățile atinse, apoi sudurile, tot după id.
8. **Revalidarea pe starea comisă**:
   - lotul: versiunile = cele trimise; hash-ul recalculat bate; nivelul și fluxul sunt active;
   - **niciun rând nu e declarat de aprobator** (Q8);
   - fiecare rând:
     - e `trimisa`, fără conflict deschis, cu R1 (d) închis;
     - R3 exact, R4 cu 2 capete, lungimea confirmată;
     - dependențele: montajul unui copil cere tăierea lui aprobată în același lot sau înainte;
     - bucata e încă rezervată de acest rând și în starea așteptată;
     - are PV (regula E3 §8) și e pe tronson (ieșirea e făcută, Q-E4-2 A);
   - corecțiile de lungime au motivul în `p_decizii`.
9. **Marcajul**: `fn_izo_montaj_marcheaza('aproba', aprobare, proiect, tronson, …)`. De aici urmează doar DML static:
   - pe fiecare rând, în ordinea lanțului:
     - `corectie`, dacă e cazul;
     - `taiere`: părintele trece `taiata`; copiii se nasc cu uid-ul și literele rezervate (copilul calculat cu `lungime_calculata`); mișcările `consumat` / `nascut`;
     - `montaj`: piesa trece `montata`; mișcarea `montat`;
   - sudurile: `declarata` → `aprobata`; capetele trec de pe `bucata_decl_uid` pe `bucata_id`; se calculează `tranzitie_perete`;
   - rezervările: `consumata`, cu `eveniment_id`;
   - declarațiile: `aprobata`, cu `aprobat_de` și `eveniment_ids`;
   - sesiunea: `inchisa` când nu mai are rânduri deschise; cât are rânduri `in_verificare`, rămâne `trimisa`.
10. **Reconcilierea**, înainte de RETURN: mișcările, bucățile și sudurile scrise = efectele așteptate (`fn_izo_decl_efecte`). Altfel excepție, deci rollback total.

**Răspunsul**: evenimentele, bucățile noi (uid → id), sudurile aprobate și lista „fișe de tăiere de generat” (rădăcinile tăiate în lot).

### 6.4 Revizia, respingerea, seria lămurită

- **„Revizie cerută”** (de preferat, v2.3 §2.7):
  - doar pe rândul greșit, cu motiv;
  - rezervarea și literele rămân;
  - inginerul trimite o versiune nouă (`decl_salveaza` cu `versiune_baza`), care revine `trimisa`.
- **Respingerea**:
  - cu lista dependențelor afișată (copiii declarați, montajele lor, sudurile) și o decizie pe fiecare;
  - eliberează rezervările și literele; copiii declarați devin `anulata`.
- **Seria „în verificare”** (D2#2) se lămurește:
  - (a) de inginer, prin corectarea transcrierii: o versiune nouă, pe bucata găsită;
  - (b) de MP, prin legarea rândului de bucata reală (`fn_izo_serie_lamureste`, cu motiv); rezervarea se creează atunci;
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

## 7. Legătura bucată ↔ `executie_tevi`: picker-ul devine legătura reală

### 7.1 Regula

- Adevărul despre montaj e registrul: bucata `montata` pe tronson + sudurile. `executie_tevi` e doar proiecția lui în pachet.
- Legătura rămâne una singură, cea existentă: `magazie_bucati.executie_teava_id` → `executie_tevi(id)`. FK-ul NO ACTION e arbitrul din 2c; indexul nou `ux_magbuc_izo_teava` cere o bucată pe rând.
- Pe tronsoanele în flux:
  - rândurile `teava` / `curba` / `legare` le scrie doar `izo_montaj_writer` (§7.4);
  - câmpurile de identitate ale unui rând legat se iau din registru, nu se tastează.

### 7.2 `fn_izo_pachet_completeaza(p_cheie, p_pachet, p_updated_at, p_sudura_de, p_sudura_pana)`

- MP-ul alege pachetul și intervalul de suduri. Antetul pachetului îl creează ca azi, pe tronsonul în flux.
- **Rândurile noi**:
  - serverul adaugă rândurile bucăților `montata` nelegate din interval;
  - ordinea vine din lanț (după capete), nu după numerele sudurilor;
  - rândul i = bucata i + sudura ei aval (convenția IZO); cuplările dau rânduri `legare`.
- **Refuză**:
  - golurile din lanț (un capăt fără sudură în interiorul intervalului);
  - pozițiile încă „în verificare”;
  - un interval care se suprapune cu alt pachet activ.
- `poz_in_pachet` și `poz_km_m` le recalculează trigger-ele existente (DEFINER, owner `postgres`, ✓BD 21.10).

### 7.3 `fn_izo_pachet_leaga(p_teava, p_bucata, p_updated_at)` / `fn_izo_pachet_dezleaga(p_teava, p_motiv)` — contractul E4a din #823

**Ordinea de lock**, în trepte:
1. schema → autorizarea (MP);
2. **proiectul și locațiile** FOR SHARE (`fn_izo_blocheaza_locuri`);
3. **rândul `executie_tevi`** FOR SHARE;
4. **pachetul și tronsonul lui** FOR SHARE (`fn_izo_proiecte_pachet_blocat`);
5. revalidarea:
   - rândul e încă în pachetul din cerere (CAS pe `pachet_id` + `updated_at`, ca `actualizeazaRandInPachet`);
   - pachetul e pe un tronson în flux;
   - proiectul pachetului = proiectul tronsonului = proiectul bucății;
6. tabelele → advisory partajat → bucata FOR UPDATE.

**De ce FOR SHARE pe rândul țevii**:
- intră în conflict cu FOR UPDATE-ul pe care garda mutării (`fn_izo_refuz_mutare_tevi`, 2c) îl ia înainte să verifice legătura;
- deci o mutare sau o ștergere în curs e așteptată și apoi văzută, iar una ulterioară așteaptă legarea;
- testul e harness-ul 4j3, în ambele ordini, reluat pe funcția reală.

**Verificările**:
- bucata e `montata` pe tronsonul pachetului, de tipul rândului (`teava` ↔ `teava`, `curba` ↔ `curba`), și nu e legată de alt rând;
- rândul e nelegat. Dacă e deja legat de aceeași bucată, apelul nu mai are efect.

**Scrierile**, sub același context (`leaga`):
- `executie_teava_id` pe bucată;
- câmpurile de identitate ale rândului, din registru (forma `patchDinRegistru`, calculată pe server).

**`dezleaga`**: doar cu motiv; refuzat pe un pachet aprobat de Transgaz (sau emis, în E8).

**Interblocajul**:
- pe tronsoanele în flux, UPDATE-ul km-ului pachetului din client e refuzat (calea 21);
- deci recalculul km-ului, care ar lua rândurile după pachet, nu poate rula în paralel cu legarea;
- în rest, PostgreSQL detectează ciclul și anulează una dintre tranzacții: fail-closed, fără stare parțială.

### 7.4 Garda pe tronsoanele în flux (E4a: căile 1, 4, 5, 7, 8, 18, 21)

- **`trg_executie_tevi_izo_flux`** (BEFORE INSERT / UPDATE / DELETE), pe pachetele unui tronson în flux:
  - din client se pot schimba doar `observatii`, `pm_cod`, `pa_ut_cod`, `ut_cod`, pe rânduri existente; orice altceva → 42501;
  - scriitorul trece doar sub context (`completeaza` / `leaga` / `dezleaga`) și doar cu rândul așteptat (proiecția exactă, `fn_izo_pachet_rand_asteptat`);
  - cascadele DEFINER existente (renumerotarea, recalculul km, totalurile) rulează ca `postgres`. Sunt acceptate doar când contextul E4 al tranzacției e valid ȘI se schimbă doar coloanele derivate:
    - pe rânduri: `poz_in_pachet`, `poz_km_m`, `updated_at`;
    - pe pachet: `nr_tevi`, `total_lungime_m`, `nr_pending_sant`, `updated_at`.
- **Antetul pachetului** (`executie_pachete_lansare`) pe un tronson în flux:
  - se creează din client;
  - `km_start_m`, `status`, `aprobat_*`, `pdf_aprobare_*` și DELETE sunt refuzate din client;
  - starea „aprobat” se pune doar prin `fn_izo_pachet_aprobare_transgaz` (fișierul la o cale dată de server; documentul și starea într-o tranzacție).
- **`executie_pachete_documente`** e doar-adaug, iar în Storage (`executie-pachete-pdf`) nu există UPDATE / DELETE pe pachetele tronsoanelor în flux.
- **`executie_tronsoane`**: km-ul unui tronson în flux nu se schimbă din client.
- RLS-ul din 20261029a rămâne. Scrierile pe tronsoanele în flux trec prin RPC.

### 7.5 Picker-ul (UI, `src/Izometrie.jsx`)

- **Pe un tronson în flux**:
  - lista = bucățile `montata` nelegate ale tronsonului (nu `pe_tronson`);
  - alegerea cheamă `fn_izo_pachet_leaga`: o singură scriere, pe server;
  - butonul „Adaugă din montajele aprobate” → `fn_izo_pachet_completeaza`.
- **Pe celelalte tronsoane** (T12 etc.): `patchDinRegistru` + `actualizeazaRandInPachet` rămân ca azi (text). Legarea istorică vine cu E4c (Q-E4-5).

## 8. Tăierea unei țevi

### 8.1 Gestul de pe tabletă („Țeavă tăiată”) dă 2 declarații

- Inginerul confirmă întâi lungimea țevii întregi, cu cifrele de pe marcaj. Dacă marcajul ≠ stoc, restul se calculează din marcaj (corecție).
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
  - serverul, dacă rândul ajunge totuși, îl acceptă cu `conflict` R1 (d) + „revizie cerută”;
  - aprobarea refuză;
  - indexul `ux_magbuc_izo_frunza` e ultima barieră: părintele trece `taiata` înainte să se nască copiii.
- **Rotunjirea la cm** = `round(mm / 10)`, aceeași pe tabletă și în coloana generată `lungime_cm`.

### 8.4 Restul merge în depozit (Q3 B)

- Tot restul pleacă în depozit, cu aceeași serie și șarjă, fără aviz.
- Destinația e depozitul de origine al țevii (`atribute.depozit_origine_id`). Pentru o bucată fără origine, MP-ul alege la aprobare.
- Sub `prag_rest_mm` (500 mm, de confirmat), la primire restul devine `rest_nereutilizabil`: rămâne în depozit, dar nu e propus la montaj.
- Pe rest se scrie cu markerul: serie · șarjă · lungime · din TRxSy (prototip `restLbl`). Codul bucății nu se scrie.
- În E4 nu există deșeu pe tabletă (Q-E4-7).

### 8.5 Tăierea unei bucăți deja montate (cuplare, cut-out)

- **Mecanica e aceeași** pentru ambele:
  - părintele `montata` trece `taiata`, iar copilul rămas în șanț se naște `montata`, în aceeași poziție;
  - în același eveniment, capătul sudurii amonte trece de pe părinte pe copil;
  - restul pleacă în depozit.
- **Cuplarea** (tie-in, D#13): o declarație `cuplare` cu cele două capete de lanț + tăierea țevii cu capătul liber la lungimea reală. Nu există sudură cu un singur capăt.
- **Cut-out-ul** (D2#11): Q-E4-12.

### 8.6 Corecția de lungime

- **`marcaj_diferit`** (pe marcaj scrie altă lungime) și **`masurat` peste ±20 mm**:
  - la aprobare se scrie evenimentul `corectie` pe bucată (`lungime_masurata_mm`, `lungime_mm`, `inainte` / `dupa`), cu motivul MP-ului;
  - alerta `izo_lungime_diferita_aviz` blochează fișa și pachetul până decide MP-ul (v2.3 §1.1 p7).
- **`masurat` în ±20 mm**: lungimea din stoc rămâne (prototip `masOk`), iar măsurătoarea se păstrează pe declarație.

## 9. Roluri și drepturi

### 9.1 Rolurile noi de BD (ca în E3 §3.1)

| Rol | Deține | Ce scrie |
|---|---|---|
| `izo_teren_editor` | `fn_izo_teren_*`, `fn_izo_sync_push` | `izo_fronturi`, `izo_operatii` (canalul `teren`), `izo_preverificari`, `izo_declaratii` (+ versiuni), `izo_bucati_declarate`, `izo_rezervari`, `izo_suduri` / `_capete` doar în `declarata`. **Nimic în registru** |
| `izo_montaj_writer` | `fn_izo_aproba`, `fn_izo_revizie_cere`, `fn_izo_respinge`, `fn_izo_serie_lamureste`, `fn_izo_tranzitie_confirma`, `fn_izo_iesire_tronson`, `fn_izo_primire_depozit`, `fn_izo_pachet_*`, `fn_izo_seteaza_flux`, `fn_izo_montaj_marcheaza` | registrul (doar sub context); stările tabelelor de mai sus; sudurile aprobate; `izo_aprobari`; `izo_tronson_config`; pe tronsoanele în flux, sub context: `executie_tevi`, pachetele, documentele |

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
| aprobarea, revizia, respingerea, seria lămurită, tranziția, pachetul | `manager_aprobator` sau `inlocuitor_aprobator` (sau owner); niciodată pe propriile rânduri |
| ieșirea, primirea | `gestionar` pe proiect + depozit (sau owner) |
| fluxul pe tronson | `postgres` (chat, cu „da”) |

### 9.4 Matricea privilegiilor

Rezumatul de mai jos se detaliază celulă cu celulă odată cu codul și se verifică cu `has_*_privilege`.

| Tabel | `authenticated` | `izo_teren_editor` | `izo_montaj_writer` |
|---|---|---|---|
| tabelele E4 noi | SELECT (RLS `fn_izo_citire(proiect_id)`; coloanele GPS după Q-E4-15) | SELECT, INSERT, UPDATE pe coloanele lui (politici `izo_teren_*`) | SELECT, UPDATE pe coloanele de decizie (politici `izo_montaj_*`) |
| `magazie_bucati` | neschimbat (E2a) | SELECT (politica `magbuc_izo_teren_sel`) | SELECT; INSERT pe `C` ∪ {`id`, `uid`, `radacina_id`, `server_ver`}; UPDATE pe stare, loc, `tronson_id`, `depozit_id`, `atribute`, lungimi, `executie_teava_id`, `server_ver`, `updated_at` (politici `magbuc_izo_montaj_*`) |
| evenimente / mișcări | neschimbat | SELECT | SELECT, INSERT (politici `izo_ev_montaj_*`, `izo_mis_montaj_*`) |
| `executie_tevi`, pachete, documente | neschimbat (RLS 20261029a) | SELECT (pentru instantaneu) | SELECT, INSERT, UPDATE pe coloanele proiecției (politici `executie_*_izo_montaj`) |
| config, atribuiri, importuri | — | — | — (doar prin helpere) |
| secvențe | — | — | USAGE pe `magazie_bucati_id_seq` și `izo_server_ver_seq` |

## 10. Garda și poarta — ce se refolosește din E3

### 10.1 Intrarea

`fn_izo_montaj_api_verifica()`, copiată după `fn_izo_doc_api_verifica`:
- lock-ul schemei, partajat, primul;
- `session_user = authenticator`, JWT `authenticated`, uid prezent;
- contextele E3 și E4 goale;
- poarta completă `fn_izo_porti_lipsa()` (E2a + E3 + E4; ≈ 0,4 s, de măsurat la cod pe un lot de 50).

### 10.2 Contextul

- Forma: `izo.montaj_ctx` = `<txid>|<op>|<ref>|<proiect>|<tronson>|<versiune>|<arg>`.
- `op` ∈ {`aproba`, `revizie`, `respinge`, `serie`, `tranzitie`, `iesire`, `primire`, `completeaza`, `leaga`, `dezleaga`, `transgaz`, `flux`}.
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
  - efectul așteptat vine din `fn_izo_decl_efecte(decl, versiune)` la aprobare și din cererea validată la ieșire, primire, legare;
  - la copii, `radacina_id` = rădăcina părintelui, verificat separat; `aviz_intrare_id` / `nr_crt_aviz` sunt NULL.
- **Evenimentul și mișcarea**: `fn_izo_coloane_ev()` / `fn_izo_coloane_mis()` (E3), cu valorile așteptate pe operație: `document_tip` = `izo_declaratie`, `aplicat_de` = uid-ul aprobatorului, `declarat_de` = autorul declarației, `ora_tableta`, `dispozitiv_id`.
- **Rândul de pachet**: proiecția nouă `fn_izo_coloane_tevi()` + `fn_izo_pachet_rand_asteptat`.
- **Coloanele**: mulțimea coloanelor fiecărui tabel e verificată în poartă. O coloană nouă → porți lipsă → intrările refuză.

### 10.5 Ordinea globală a lock-urilor

O singură ordine, compatibilă cu E2a / E3 / 2c:
1. schema (partajat);
2. frontul / sesiunea / aprobarea / declarațiile (FOR UPDATE, după id);
3. profilul → accesul pe modul → atribuirea;
4. `izo_tronson_config`, proiectul, depozitele, tronsoanele (FOR SHARE);
5. rândul `executie_tevi` (FOR SHARE, doar la legare);
6. pachetul și tronsonul pachetului (FOR SHARE);
7. tabelele (ACCESS SHARE);
8. advisory (73010, proiect): partajat, exclusiv doar la activarea fluxului;
9. rădăcinile → bucățile → sudurile (FOR UPDATE, după id).

**Fără cicluri**:
- sincronizarea ia rădăcinile fără advisory, pentru că nu scrie în registru;
- aprobarea ia advisory-ul înaintea rădăcinilor, iar sincronizarea nu ține advisory, deci cele două nu pot închide un ciclu;
- storno-ul și importul E2a (advisory exclusiv → bucăți) rămân sufixe ale aceleiași ordini.

### 10.6 Regula E3 §8, PV-ul (Q-E4-6 A)

- Orice funcție E4 care scoate, taie sau montează o bucată refuză bucata cu `aviz_intrare_id` NOT NULL al cărei document n-are `eveniment_pv_id`.
- Verificarea se face sub lock, după bucăți. Are test dedicat.

### 10.7 Poarta E4 și amprenta

- **`fn_izo_porti_e4_definitii()`** inventariază:
  - tabelele E4: RLS, ACL, owner, privilegiile pe coloane;
  - politicile `izo_teren_*`, `izo_montaj_*`, `magbuc_izo_teren_*`, `magbuc_izo_montaj_*`, `executie_*_izo_*`;
  - trigger-ele E4 + `tgenabled`;
  - indexurile `ux_izo_*` ale E4, `ux_magbuc_ev_decl`, `ux_magbuc_izo_teava`;
  - rolurile + membership;
  - **trigger-ele DEFINER existente pe `executie_tevi` / pachete**, cu corpul (md5), pentru că garda acceptă cascadele lor.
- **`fn_izo_porti_e4_lipsa()`** se cheamă la finalul `fn_izo_porti_lipsa`. Migrarea o înlocuiește din nou, păstrând închiderea rapidă din E3.
- **`c_e4_revizuite`** = semnătura → md5, pentru intrările E4 acceptate ca scriitori (ca `c_e3_revizuite`).
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
   - operație retrimisă → `duplicat`, un singur efect; același `op_id` cu alt payload → `conflict`, zero efecte;
   - aprobare retrimisă cu aceeași cheie → același răspuns; cu altă listă → refuz;
   - ieșire / primire / completare retrimise → un singur efect.
4. **Lotul**:
   - o operație greșită la mijloc → ea primește `eroare`, dependenții `blocat_de_conflict`, restul `acceptat`;
   - gol de `seq` → `izo_gol_operatii`;
   - `versiune_format` necunoscută → `eroare`.
5. **Curse cu barieră**, în ambele ordini, cu `pg_locks` care confirmă așteptarea:
   - două tablete pe aceeași țeavă: una acceptată, cealaltă `conflict`, fără deadlock;
   - sincronizare ↔ aprobare pe aceeași rădăcină; aprobare ↔ aprobare (aceeași sesiune); aprobare ↔ primire; ieșire ↔ sincronizare;
   - legare ↔ mutare / ștergere din client (4j3, reluat pe funcția reală);
   - oprirea fluxului ↔ sincronizare;
   - revocarea modulului / atribuirii ↔ aprobare (ca testul 2 din E3).
6. **Regulile**:
   - 12 → 4 + 4 + 4 e blocată; 4,00 / 3,99 / 4,01 trece; R3 exact;
   - tăierea în 2 puncte → 3 copii, cu literele în ordinea sosirii;
   - restul sub prag → `rest_nereutilizabil` la primire;
   - sudura cu un singur capăt → refuz la aprobare;
   - cuplarea cu tăierea țevii cu capătul liber → sudura amonte trece pe copil;
   - montaj fără confirmarea lungimii → refuz (tabletă, sincronizare, aprobare); cifrele de marcaj greșite → refuz;
   - tranziția 7,1 ↔ 8,8 nu oprește nimic și e calculată pe sudură;
   - seria în verificare: sesiunea se trimite, celelalte rânduri se aprobă, rândul nu devine fapt, iar sudurile lui așteaptă;
   - bucată E3 fără PV → refuz (ieșire, tăiere, montaj); carantina → refuz;
   - montaj din depozit fără ieșire → aprobarea e refuzată până la ieșire (Q-E4-2 A).
7. **Pachetul**:
   - pe un tronson în flux, din client: INSERT, UPDATE de identitate, DELETE, mutare, km, status → refuz; `observatii` și codurile NDT trec;
   - cascadele DEFINER (renumerotarea, km-ul, totalurile) trec doar sub context și doar pe coloanele derivate;
   - `completeaza` respectă ordinea lanțului și refuză golurile;
   - legarea unei bucăți nemontate, de alt tip, de pe alt tronson sau deja legate → refuz; o bucată ↔ un rând (indexul);
   - pe T12 (nu e în flux), editorul și picker-ul text merg ca azi (regresia 2c).
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
    - `src/lib/izoCoada.test.js`, pe adaptorul în memorie: ordinea `seq`, ACK pierdut, două taburi.
12. **Pilotul** (T14 sau T15, cu semnal):
    - **fluxul owner-ului, cap-coadă** (v2.3 §6.3 E4b):
      - seria → L / șarjă / perete → confirmarea lungimii → „Țeavă tăiată” 8,00 din 11,98;
      - restul de 3,98 apare în Magazie „declarat, neaprobat · în drum spre depozit”;
      - aprobarea MP-ului → `in_tranzit` → primirea Janetei → `retur`;
    - semnal pierdut 10 minute, cu pagina deschisă → 0 operații pierdute;
    - a doua tabletă pe același tronson → `alt_dispozitiv`.

## 12. Întrebări deschise (A / B / C)

Recomandarea e prima variantă, dacă nu scrie altfel.

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
   - **A** regula E3 §8 rămâne: bucata dintr-un aviz fără PV nu iese, nu se taie și nu se montează (stocul LOT 2 de azi vine din import, fără aviz).
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
    - **A** în pilot tronsonul se alege manual. GPS-ul doar se salvează la declarație și dă LOW la o nepotrivire mare (pe km-ul tronsoanelor).
    - B tronsonul propus din GPS, pe axul KML calibrat: cere `izo_surse_proiect` + `izo_ax_ancore` în BD, încărcate cu „da”.
    - C fără GPS în E4.
11. **Q-E4-11 — Importul REPLACE atomic** (promis de 2c pentru E4a).
    - **A** un PR separat, după pilot.
    - B în E4a.
12. **Q-E4-12 — Cut-out-ul și robinetele.**
    - **A** cuplarea intră în E4, pe tabletă; cut-out-ul în E4 doar de pe laptop (MP / inginer); robinetele (`izo_elemente_fara_stoc`) doar dacă pe T14 / T15 există un robinet din proiect (de verificat pe PT).
    - B cut-out-ul și pe tabletă, în E4.
    - C cut-out-ul după pilot.
13. **Q-E4-13 — Cum află MP-ul.**
    - **A** din lista de pe ecranul de aprobare, cu numărul de sesiuni trimise; fără scrieri în `notifications`, fără cron.
    - B notificarea zilnică (`izo_notificari_zilnice` + un rând în `notifications`).
    - C ca B, plus jobul zilnic de alerte (automatizare nouă, cu fișa a–e).
14. **Q-E4-14 — Fronturile.**
    - **A** un singur dispozitiv activ pe tronson, în pilot.
    - B pe interval de km.
15. **Q-E4-15 — Coordonatele GPS (date personale).**
    - **A** păstrate pe declarație, vizibile doar MP-ului și owner-ului (privilegii pe coloane + o funcție de citire).
    - B șterse după aprobarea pachetului de Transgaz.
    - C păstrat doar km-ul calculat.
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
