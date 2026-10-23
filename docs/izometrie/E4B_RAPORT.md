E4b-1 PARȚIAL / NO-GO pentru aplicare: gen_e4b.py + e4b_*_tpl.sql generează 20261109b_izometrie_e4b_teren.sql și supabase/revenire/20261109b_izometrie_e4b_teren_ROLLBACK.sql; E4a migrare/rollback verificate identice, fără Git/BD/secrete/deploy.
§3.2/§9.5/Q-E4-15 A: 11 tabele, RLS, jurnale imuabile, dispozitive/fronturi/sesiuni/declarații/rezervări; GPS separat și citire MP/owner, hash-uri excluse din SELECT API; nicio scriere în acces/module sau date reale.
§5.2–5.8/§8.1–8.3: instantaneu cu checksum/tombstone/disponibil, push cu savepoint/jurnal final/CAS/idempotență, GPS în hash, rezervare la sync, litere și R1d/R3; harness scripts/test_izometrie_e4b.sh + harness_e4b_wsl.sh, fixture/test SQL izometrie_e4b*.
NEFINALIZAT §9.4/§10.3–10.5: scriere prin helpere private postgres, NU matricea writer + garda cu proiecții exacte; lock-uri conservative pe toate rădăcinile proiectului; fără deblocarea completă a descendenților; snapshot fără suduri reale, montaj cu sudură/cuplare/tăiere pe montată refuzate explicit până la verificatorul R4; front predare/eliberare și integrarea alertelor rămân; MP/depozit/UI excluse.
Verificat: generator executat, 9 teste Python E4b + 11 E4a PASS, inventar/delimitatori/lanț harness și identitatea ieșirilor E4a; PG16/PG17, SQL, curse, PostgREST, control_0e și rollback efectiv NERULATE conform interdicției BD; schema/corpurile SQL necesită validare reală, testele offline nu dovedesc aplicabilitatea.

E4b-2 — PARȚIAL / NO-GO: extins doar 20261109b prin șabloane + gen_e4b.py; E4a și migrările LIVE nemodificate; fără Git/BD/secrete/deploy.
SQL: preview + amprentă, CAS updated_at/versiune, aprobare parțială a montajelor simple, respingere cu rezervări eliberate, revizie simplă/retrimitere, serie lămurită, front eliberat și ieșire depozit idempotentă.
Faptele sunt scrise de izo_montaj_writer cu proiecții exacte; porți/ștampile/inventar actualizate, secvențe închise; corpurile E4a înlocuite au precondiții MD5 și restaurare exactă verificată static.
PASS: 12 teste Python E4b + 15 E4a; izometrie_e4b_aprobare.test.sql legat la harness cu E4B_APROBARE_TEST_END. SQL/PG16/control_0e/PostgREST/curse/rollback efectiv NERULATE, conform interdicției BD.
Neimplementate: aprobarea tăierilor/sudurilor/cuplărilor, simularea topologică și transferul rezervărilor; revizia cu descendenți refuzată explicit. Matricea §9.4 rămâne parțială: orchestrarea E4 încă folosește helpere postgres.

E4b-2b — PARȚIAL: tăieri pe pe_tronson; consumatori copii în lot comun sau separat; revizie cu descendenți. E4a e identic cu baza.
SQL: simulare topologică fără scrieri pentru tăieri și montaje simple; amprentă pe proiect; proiecții exacte prin writer (R3/R1d); lanțul de rezervări R→R′ exclusiv, cu reconciliere. Destinația restului protejează depozitul, cu restaurare exactă la rollback.
Verificat de cdx: generator, 16 teste Python E4b și 15 E4a PASS. Integrat de Claude: harness-ul PG16 E4b PASS, după un fix de test (`zi` lipsea la `sesiune_deschide` în scenariul de tăiere).
Lipsesc: tabelele, declararea și aprobarea sudurilor și cuplărilor; simularea capetelor (R4); tăierile pe montată (§8.5); corecțiile și deciziile MP (§8.6); loturile cu declarații din sesiuni diferite; matricea §9.4 completă și testele SQL ale acestor ramuri. Aprobările lor rămân refuzate.
Orchestrarea rulează încă pe postgres (fn_izo_*): teren_intern, teren_push, teren_op, aprobare_intern, aproba_intern, decizie_intern, iesire_intern, front_intern, serie_intern, birou_jurnal. Doar faptele de montaj, ieșire și tăiere și transferul rezervărilor trec prin izo_montaj_writer.

E4b-2c — PARȚIAL / NO-GO pentru aplicare până la verificarea SQL/PG16; numai worktree, fără Git/BD/secrete/deploy; E4a identic cu baza.
SQL generat: suduri/capete cu RLS și unicitate, declarare tabletă, aprobare MP, simulare/reconciliere R4; tăieri pe montată (capăt liber și cut-out), mutarea capetelor și consumarea rezervărilor ramane_montat.
Corecție pe rădăcină fără descendenți înaintea tăierii/montajului, motiv MP obligatoriu și chei exacte; selecție din sesiuni trimise diferite pe aceeași zi/tronson; preview amprentează sesiunile, sudurile și capetele.
PASS executat: gen_e4b.py, 21 teste Python E4b + 15 E4a; scenarii SQL adăugate în izometrie_e4b_aprobare.test.sql, marker păstrat; PG16, control_0e real, PostgREST, curse și rollback efectiv NERULATE conform interdicției BD.
Lipsesc: matricea §9.4 completă și gărzile cu proiecții exacte pentru suduri/capete (helpere încă postgres); integrarea alertei izo_lungime_diferita_aviz și confirmării tranziției de perete; normalizarea SQL↔JS cu test de paritate; acoperirea exhaustivă a reviziilor/invalidării capetelor, refuzurilor și curselor; confirmarea harness-ului PG16 pe această versiune. Ramura 3 și robinetele rămân neacoperite.
E4b-2d — Cauza: fn_izo_teren_op crea rezervarile ramane_montat, apoi le elibera ca parinte_anulat comparand baza_mm a parintelui cu lungimea copilului; corectat e4b_api_tpl.sql si regenerat 20261109b.
Trasare statica test.e4bc.t1: sync pastreaza cele 2 rezervari proprii la versiunea curenta; trimiterea elimina expirarea; simularea le cere in continuare; aprobarea le consuma cu evenimentul taierii. Copiii anulati si consumatorii distincti incompatibili raman invalidati.
Verificat: gen_e4b.py + 22 teste test_gen_e4b.py PASS; SQL adaugat pentru sync/trimitere, inactiva/versiune gresita/expirare nenula si consum la aprobare. PG16/harness SQL NERULATE (interdictie BD); E4a/20261109a identice cu baza; fara Git, secrete sau deploy.

E4b-3 — implementare în worktree; generatorul produce numai livrarea 20261109b și rollback-ul ei; fără Git/BD/secrete/deploy.
Matrice: teren_intern/push/op și sudura_decl → teren; aprobare/aproba/decizie/iesire/front/serie_intern, birou_jurnal și aplicarea sudurilor/capetelor → writer; coloane/RLS/secvențe explicite, fără acces GPS pentru writer; proiecții exacte OLD/NEW, CAS serie sub context.
Postgres DEFINER rămâne pentru teren_autorizat/autor_valabil/birou_autorizat (identitate și lock-uri), teren_entra (intrare și contor), birou_intrare (poartă), config_blocheaza/teren_radacini_blocheaza (lock fără UPDATE), pv_lipsa/gps_citeste (date private), teren_snapshot/birou_preview/proiect_config_citeste/teren_praguri și emitere_blocaje/fisa_verifica (citire controlată); detalii în e4b_writer_tpl.sql.
Alerte live security_invoker: izo_lungime_diferita_aviz până la decizia MP, tranziție de perete până la confirmarea MP idempotentă; verificator fișă și blocaj în calea existentă de aprobare pachet; motivul corecției păstrat; fără notificări/cron/storage DDL.
Normalizare: izoNormalizare.js reutilizează funcțiile pure existente; SQL fn_izo_sudura_normalizeaza(text,jsonb), aceiași 29 vectori JSON în testul SQL generat și testul Node; harness legat la markerul normalizării.
PASS executat: gen_e4b.py, 27 teste Python E4b, 15 E4a, Node 29 vectori; E4a/20261109a identice cu baza; teste SQL pentru revizie/retrimitere/CAS vechi/respingere și invalidarea capetelor, proiecții refuzate, alertă/corecție și confirmare de perete, marker final păstrat.
Lipsesc validarea PG16/control_0e/PostgREST și rollback-ul efectiv pe această versiune (interdicție BD), matricea exhaustivă de curse/refuzuri/revizii și integrarea verificatorului în viitoarea emitere E8; ramura 3 și robinetele rămân în afara implementării.

E4b-4a — UI tabletă și coadă offline, numai worktree; fără Git, BD, secrete sau deploy.
Fișiere: src/lib/izoCoada.js, src/lib/izoTeren.js, src/IzometrieTeren.jsx, scripts/izometrie/e4_gen/test_coada.mjs; integrare lazy în src/Izometrie.jsx, liniile 21, 27, 251, 261 (plus linie goală 262).
Acoperire: §4.1–4.3, §5.1–5.3 și contractele client §5.4–5.5; montaj, tăiere+montaj atomic (§8.1–8.4), capăt liber (§8.5 ramura 1), cuplare; confirmare separată, normalizare strictă, GPS doar la salvare, propunere locală de sudură.
Coada: IndexedDB atomic / fallback memorie cu banner, UUID/seq pe dispozitiv și profil/proiect izolate, Web Locks pentru tab editor unic, refresh înainte de RPC, loturi 50/limitate în bytes, retry identic, toate codurile inclusiv duplicat/conflict_op, ACK durabil, arhivă de verificat, snapshot separat, export JSON și retragere trimitere înainte de expediere.
PASS executat cu C:/Program Files/nodejs/node.exe: test_coada.mjs — 22 scenarii storage/RPC simulate; test_normalizare.mjs — 29 vectori; node --check pe cele două module JS. Fișierele SQL/E9/App.jsx identice byte-cu-byte cu baza copiată.
Lipsesc UI: serii necunoscute, corecții de lungime/revizii și repararea conflictelor, tăiere la ambele capete/cut-out laptop; cuplarea copiilor din tăieri diferite cere aprobare înainte; blocarea globală a logoutului nu este integrată (doar protecție beforeunload, fără modificări App.jsx).
NERULATE: browser/tabletă reală, IndexedDB/Web Locks reale, API/PostgREST și Vite build; acestea necesită validarea integratorului. Pornirea fără rețea/service worker rămâne E6.

E4b-4b — UI birou/MP și gestionar, numai worktree; fără Git, secrete, BD sau deploy.
Fișiere: src/IzometrieAprobare.jsx (include IzometrieGestionar), src/lib/izoBirou.js, scripts/izometrie/e4_gen/test_birou.mjs; integrare lazy src/Izometrie.jsx:29–30,252–253,265–268.
Acoperire §6.2–6.4, §8.6 și alerte: sesiuni trimise pe proiect/tronson, preview topologic, aprobare totală/parțială, CAS versiune/updated_at/amprentă, respingere cu motiv și decizii pe descendenți, revizie și serie lămurită; motiv corecție lungime și confirmare tranziție perete prin RPC.
Gestionar §6.5/6.7 (parțial): ieșire cu aviz/data și retry cu aceeași cheie/payload, rezervări active paginate, fronturi și eliberare prin RPC (serverul cere MP); resturi în tranzit doar afișate. Generații izolate, inclusiv remontarea StrictMode.
PASS Node: test_birou.mjs 14 scenarii (RPC fake, timeout după commit, CAS, cascadă, paginare 1201 rânduri, semnături comparate offline cu migrarea); test_coada.mjs 22 scenarii; test_normalizare.mjs 29 vectori; node --check src/lib/izoBirou.js.
Lipsesc: primire resturi/acțiuni pe resturi încă declarate, tratarea sesiunilor deschise abandonate și alertă dedicată autor revocat (drepturile rămân validate pe server); cererea de retry birou este păstrată numai cât ecranul rămâne montat.
NERULATE: browser/React, API/PostgREST și Vite build (la integrator); SQL și fișierele protejate verificate identice cu baza, fără pachete npm noi.
E4b-5a — toate cele 5 P1 și P2 din brief corectate; exclusiv worktree, fără Git/BD/deploy.
Teren: refuz după trimitere/în verificare, cu excepțiile de revizie din §6.4; identitatea nerezolvată se rezolvă numai la MP (API + trigger).
Birou: patru ochi la decizie/serie (profil + angajat, inclusiv cascadă); 30 apeluri/minut/profil/funcție înaintea porții; data Europe/Bucharest.
Owner: ACL/ALTER forward și DROP rollback executate ca owner; inventar fix pentru toate cele 59 funcții, inclusiv cele două triggere; fără DDL storage.*.
P2/UI/coadă: uid sesiune verifică dispozitiv/zi/stare; amprentă cu polpermissive și ACL/policies existente; motiv minim 3 caractere; operațiile refuzate nu generează capete/copii.
PASS: gen_e4b.py; test_gen_e4b.py 30 teste; Node birou 15, coadă 23, normalizare 29 vectori, picker 6. SQL adăugat pentru P1 1–3 și uid sesiune.
NERULATE: harness PG16, API/PostgREST, browser/React și build; restricția fără BD respectată. E4a/20261109a și celelalte fișiere LIVE identice cu baza copiată.

E4b-5b — mod IZO_E4B_PROD_LIKE=1 implicit în harness și WSL; =0 păstrează modul superuser; fără Git/BD/secrete/deploy.
Bootstrap supabase_admin; postgres NOSUPERUSER CREATEROLE BYPASSRLS LOGIN permanent; proprietari expliciți ai fixture-urilor, default ACL postgres și EXECUTE pg_control_system documentate.
E3/E4a primesc temporar membership Storage numai pentru pregătire, retras înainte de baseline E4b; probe directe postgres înainte/după apply/rollback: rolsuper=f, writer SET fără INHERIT, ALTER Storage refuzat must-be-owner.
Apply/reapply prin runner ca postgres (reapply cere cod 11); rollback LIVE neschimbat concatenat cu adaptor local prin același runner, cu înregistrare separată doar în istoricul harness-ului; gate/control_0e/rollback exact păstrate.
Testele SQL existente folosesc login bootstrap pentru SET SESSION AUTHORIZATION, dar identitatea efectivă și resetările sunt postgres; copii temporare, fără modificarea surselor testelor.
PASS static: bash -n ambele scripturi; validatorul oficial pe adaptor+rollback; verificare adaptare 1+14 resetări și comparație byte-cu-byte cu baza pentru fișierele protejate. PG16 și testele SQL NERULATE, conform brief-ului.
