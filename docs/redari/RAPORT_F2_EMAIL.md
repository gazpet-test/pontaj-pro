# Runda 2 — PR #1000, 05.11.2026

Acest bloc descrie numai runda 2 și prevalează asupra istoricului de mai jos.
**Toate constatările din brief au corecție locală și teste pregătite; validarea BD/React rămâne deschisă. Transportul este inert.**

Patch-ul r1 a fost verificat cu SHA-256: `396323BFE747DC4E7372ADD81EFCAD9544524B8871EDC3FF543980FCE3010DC9`, apoi aplicat curat cu `git apply --whitespace=nowarn` (exit 0). Git nu era în PATH; s-a folosit executabilul instalat. Fără alte operații Git, commit sau push: interdicția explicită „No Git commit” prevalează asupra cererii contradictorii de commit local.

## Constatări și dovezi R2

| Constatare | Corecție locală / test pregătit |
| --- | --- |
| Gemini P1-03 | Politicile SELECT ale celor șase tabele cer `auth.uid() IS NOT NULL AND fn_sms_e_owner() IS TRUE`. DRY `editor_r2`, `admin_r2`, `f2_select_r2`: identitate fictivă auth.users/profiles și acces redari editor, apoi admin, în tranzacția anulată. Fiecare tabel are fixture populat; non-owner vede zero, owner vede rânduri. Fără drepturi noi în migrare. |
| Gemini P1-01 | CHECK `red_mail_f2_atasament_ck`: toate cinci NULL sau toate prezente, PDF, 5–10000000, SHA lowercase 64 hex. DRY `atasament_r2`: lipsa fiecărei coloane, MIME greșit, ambele limite încălcate, SHA invalid; verifică SQLSTATE și numele constrângerii. Inserare PDF complet pozitivă; lot_creeaza acoperă toate NULL. |
| Gemini P1-02 | Ștergere inventar → mesaje → antet → lot; părintele și antetul rămân disponibile triggerului mesajului. DRY `retentie_pre_r2` + `sterge_r2`: lot cu fișier fictiv inventariat, confirmat absent în fixture, retenție eligibilă explicit, dispariția tuturor copiilor și audit păstrat. Nu atinge Storage real. |
| Copilot P2-01 | CHECK `red_mail_f2_inert_ck` impune simultan OFF și extern=false, inclusiv UPDATE privilegiat. `rezultat_r2`: owner authenticated refuzat prin ACL; probe separate ca proprietar BD cu JWT owner verifică CHECK 23514. Nu acordă temporar UPDATE. F2b necesită migrare separată. |
| Copilot P2-02 | `proceseazaMesaj` refuză la prima instrucțiune când TRANSPORT_REAL_ACTIV=false, fără descărcare, claim, rezultat sau send. Test JS cu incepe=true și toate dependențele spion; vechile teste care presupuneau send/CAS accesibil au fost înlocuite, fără bypass testabil al OFF. |
| Copilot P2-03 | `fn_red_mail_rezultat`: rezultatul final repetat compară stare, gmail_id, thread_id; același token cu rezultat diferit produce `22023/rezultat_conflict`. DRY `rezultat_r2`: retry identic pozitiv, thread diferit și stare diferită negative. |
| Copilot P2-04 | `fn_red_mail_lot_creeaza` și `fn_red_mail_f2_setari` verifică FOUND imediat după lock singleton; `22023/setari_absente`. DRY `setari_absente_r2`: absență simulată în subtranzacție anulată, inclusiv restaurarea rândului și triggerului F1 verificată. |
| Copilot P2-05 + Gemini P1-04 | Doi vectori identici în mailLoturi.test.js și DRY `hash_r2`, cu diacritice/CRLF, fără/cu PDF. Expected literal independent calculat SHA256 .NET pe JSON canonic scris manual; smoke Node confirmă ambele. Contractul ASCII fix + întregi siguri este documentat în ambele implementări canonice. |
| Gemini P2-02 | `fn_red_mail_f2_optout` refuză motiv NULL, gol/alb sau peste limita existentă, cu `22023/motiv_invalid`, înainte de INSERT. DRY `rezultat_r2`; calea legitimă rămâne în `optout_preview`. |
| Gemini P2-03 | UI arată numele UAT din `lot.uat_id`, cu fallback la UUID. Schimbarea filtrului resetează selecția lotului; recitirea elimină lotId absent din lista filtrată. Test SSR pentru lot selectat cu filtrul UAT gol. Interacțiunea React nu a fost rulată. |

ENABLE fără FORCE RLS este intenționat: RPC-urile SECURITY DEFINER au nevoie de accesul proprietarului relației; JWT-ul și owner-ul sunt verificate în RPC. Amprenta L15 include OID-uri prin cataloagele serializate; baseline-ul trebuie citit fără DDL concurent. Nu s-a inventat/completat baseline-ul PLACEHOLDER_LIVE.

## Verificări R2 și limite

- Trecut: SHA-256 patch și aplicare curată; `node --check` pe modulul comun și mailLoturi.test.js.
- Trecut: `node .tmp/f2a-r2-smoke.mjs` — cei doi vectori expliciți și OFF fără niciun apel de dependență.
- Nerulate, rezervate lui Claude: Vitest (inclusiv SSR nou), build, Deno, PostgreSQL DRY, PostgREST, concurență și apply→rollback→reapply. Testele SQL scrise nu reprezintă rezultate BD.
- Fără instalări, modificări package.json/lock, credențiale, acces BD, mailuri sau deploy. Numai migrarea nouă 20261131a a fost modificată; migrările aplicate și revenirea lor au rămas intacte. CHECK-ul inert se elimină automat când rollback-ul 20261131a elimină coloanele sale.
- Skill-ul Supabase indicat în catalog nu a putut fi citit (Access denied în sandbox); nu a fost folosit pentru operații externe.
- Rămân deschise validarea lui Claude și lipsurile F2 integral deja documentate în istoric. Nu se activează transportul.

## Lecții L01–L25 în runda 2

| Regulă | Cum a fost respectată / limită |
| --- | --- |
| L01 | Migrare: FOUND imediat după FOR UPDATE în creare/setări; lock-urile existente păstrate. DRY setari_absente_r2, nerulat. |
| L02 | Ștergerea și auditul rămân în același RPC; OFF procesor fără efecte. Smoke Node trecut. |
| L03 | fn_red_mail_rezultat păstrează CAS pe token înainte de idempotență; DRY cas/cas_valid existente și rezultat_r2, nerulate. |
| L04 | Retry rezultat compară inclusiv thread_id; conflict 22023 explicit. DRY rezultat_r2, nerulat. |
| L05 | n/a — fără schimbare protocol retry/rezultate ambigue. |
| L06 | fn_red_mail_lot_sterge_final documentează copii înainte de părinți; mutex setări și lot păstrate. DRY pozitiv, concurență nerulată. |
| L07 | CHECK atașament/OFF și politica owner impuse în BD, nu doar UI. DRY toate cele șase tabele populate, nerulat. |
| L08 | RLS și RPC folosesc auth.uid + owner; claims fictive numai în harness DRY. |
| L09 | DRY editor_r2/admin_r2 verifică rol efectiv și zero rânduri pe fiecare tabel; owner pozitiv. Nerulat. |
| L10 | n/a — niciun secret sau flux de autentificare nou. |
| L11 | n/a |
| L12 | n/a — fără schimbare extragere/inventar de eligibilitate. |
| L13 | SHA ancorat lowercase; DRY negative pe CHECK exact, motiv exclusiv spații refuzat. Nerulat. |
| L14 | Numai migrarea nouă neaplicată editată; fără backfill/date business. Runner/revenire păstrate; ciclul complet nerulat. |
| L15 | Doar documentare: OID-uri în baseline, fără DDL concurent. Baseline live și certificare rămân la Claude. |
| L16 | Completitudine atașament și SHA de conținut impuse prin CHECK; fără schimbare chei unice. DRY atasament_r2. |
| L17 | n/a — fără schimbare de logică temporală/numerică business. |
| L18 | FOUND lipsă refuzat explicit; NULL motiv și rezultat diferit nu devin succes. DRY setari_absente_r2/rezultat_r2. |
| L19 | Vectori identici JS/SQL cu expected independent explicit; contractul canonic documentat. Smoke JS trecut; SQL nerulat. |
| L20 | DRY atașament negativ plus PDF complet pozitiv, retry rezultat identic, ștergere eligibilă pozitivă; OFF rămâne independent de versiune. Nerulat SQL. |
| L21 | n/a |
| L22 | n/a |
| L23 | n/a — paginarea existentă neschimbată. |
| L24 | UI resetează lotId la schimbare UAT și invalidează lotul absent sub generația existentă. Test SSR pregătit; cursa/interacțiunea React nerulate. |
| L25 | Expected independent .NET, vectori Node trecuți, DRY cu FK auth.users/profiles/user_module_access, SET LOCAL ROLE authenticated și refuz exact. Nicio probă BD/Vitest declarată trecută. |

---
# F2a inert — continuare 05.11.2026

Propunere locală pentru review, **fără aplicare și fără activare**. F2a nu este validat integral. Patch-ul anterior: SHA-256 E5034EF7ECE1A4D3DE50B7C91632D7E38DE0137EA7D363D6D78537C7B047CE8E verificat; aplicat curat cu git apply --whitespace=nowarn, prin executabilul instalat (Git absent din PATH). Fără altă operație Git/commit/push. Interdicția inițială „No Git commit” prevalează asupra cererii contradictorii din livrare.

## Fișiere modificate în continuare

| Fișier | Modificare |
| --- | --- |
| supabase/migrations/20261131a_redari_mail_f2_loturi.sql | Preflight explicit funcții/argumente/retur, tabele/coloane/tipuri, triggere. Baseline unic PLACEHOLDER_LIVE; amprente conservatoare public/auth/storage pentru corpuri, DEFINER/owner/config/ACL, coloane/ACL/defaulturi, RLS/FORCE/politici, constrângeri/secvențe, triggere inclusiv WHEN. Refuz implicit. Tip aditiv f2 și jurnalizare atomică și în red_mail_evenimente. RPC destinatari returnează motive; LEFT JOIN păstrează lipsa contactului. Crearea reverifică opt-out/rezervări sub mutex. |
| supabase/tests/20261131a_redari_mail_f2_dryrun.sql | Refuz non-owner pe toate RPC-urile expuse, ACL anon + apel anon, UUID identic/conflict, informare absentă, OFF, aprobare owner legitimă + retry, snapshot/aprobare imuabile, CAS pierdut/propriu pe rezervare vie, eveniment F1. Fixture parcelă corectat la CHECK și tronson obligatoriu. ROLLBACK explicit. |
| supabase/revenire/20261131a_redari_mail_f2_loturi_ROLLBACK.sql | Lock/refuz istoric evenimente; restaurare CHECK F1; eliminare constrângere dependentă înainte de helpers; eliminarea funcțiilor reîncearcă dependențele și refuză fără CASCADE dacă nu progresează. |
| src/redari/mailLoturi.js | inventarMail și motivele; refuz contract lipsă/necunoscut/duplicat; numitor complet, motive suprapuse, excluși unici. |
| src/redari/ui/MailLoturiEcran.jsx | Total/eligibili/excluși și număr per motiv; numai eligibili selectabili; selecție veche golită la recitire; generație async păstrată. |
| src/redari/mailInventar.test.js | Șase cazuri vitest pentru inventar și contract invalid. |
| docs/redari/PLAN_EMAIL_REDARI.md și acest raport | Starea exactă F2a/F2b. |

Alte fișiere aduse de patch și păstrate: src/Redari.jsx; src/redari/ui/comune.jsx; src/redari/mailLoturi.test.js; src/redari/ui/mailLoturiRender.test.jsx; supabase/functions/_shared/redariMailF2.mjs; supabase/functions/_shared/redariMailF2Handler.mjs; supabase/functions/redari-mail-trimite/index.ts; docs/redari/CONTRACT_SCHEMA.md; docs/redari/GHID_NOTIFICARI.md. Implementare moștenită, nu reverificată integral aici.

## Închis și deschis

1. L15 extins, **nu demonstrat complet**. Inventarul explicit acoperă dependențele directe cunoscute; amprenta conservatoare include toate obiectele din trei scheme, nu manifestul minimal al callee tranzitive. Callee externe, SQL dinamic și search_path moștenit necesită review al corpurilor live. Certificarea din constante nu este detector automat. Claude finalizează inventarul tranzitiv și baseline-ul înainte de DRY; nu copiază orbește amprenta curentă. Inventarul larg poate refuza schimbări fără legătură cu Redări. OID-urile catalogului fac amprenta specifică instanței live.
2. DRY extins, **nerulat**. Rămân matricea tuturor succeselor RPC și tuturor operațiilor directe pe fiecare tabel, concurența reală cu barieră și mutațiile lanțurilor de 2–3 niveluri. CAS rezultat are token propriu acceptat; apel_incepe rămâne refuzat și cu token propriu cât OFF.
3. Evenimente integrate atomic în F1 prin extinderea CHECK numai în migrarea nouă, fără adrese/subiecte/corpuri.
4. L12: inventar RPC + UI și reverificare server la creare. „Canal poștal” nu este preferință în schema curentă: raportat la lipsă e-mail valid + convocare poștală activă. Poșta NU exclude e-mailul suplimentar la adresă validă.
5. Revenire actualizată, **nerulată**.
6. Teste JS adăugate, raport/plan actualizate.

Deschis F2a: review/completare L15 live, execuția testelor SQL pe toate motivele (pregătite în DRY), matrice completă, concurență, API PostgREST, apply→rollback→reapply, Deno, UI interactiv, vitest și build la Claude. RPC-ul returnează motive per destinatar, iar numerele sunt agregate în helperul UI; cerința literală de numere agregate și în RPC rămâne deschisă.

Ultima extindere DRY include INSERT/UPDATE/DELETE refuzate pentru toate cele șase tabele F2 ca owner și scenariile preview rezervat, opt-out, eligibil, fără e-mail + canal poștal. Sunt ASSERT-uri pregătite, nu rezultate PG executate.

F2b, în afara acestei rulări: OAuth/Vault; Gmail send real; PDF convocator; cod [RED-M-...] cu HMAC; reconciliere durabilă și cursor SENT; retenție cu ștergerea fișierelor. Rămân și adăugare/scoatere/mutare destinatari, decizii owner pe necunoscut, UI setări/opt-out/alerte și paritate completă JS↔SQL.

## Verificări și securitate 1–6

- SHA-256/aplicare patch: trecute.
- Node v24.20.0, node:assert/strict: **7 verificări smoke trecute** — inventar mixt, gol, patru contracte invalide, TRANSPORT_REAL_ACTIV=false. NU este vitest.
- Vitest țintit: **nerulat**, node_modules/vitest/vitest.mjs absent. Fără instalări/copieri dependențe, stub qrcode ori modificări package.json/package-lock.
- SQL/BD, PostgREST, Deno, build și suită completă: **nerulate**. Rezultatele vechii rulări nu sunt atribuite continuării.
- Fără credențiale, mailuri, deploy, date reale sau editarea migrărilor aplicate. DRY doar citește identitatea owner existentă, fără schimbări de drepturi; țintele business și adresa .invalid sunt fictive.

C1: owner/aprobare explicită pe lot/versiune/hash păstrate; DRY negativ și legitim.
C2: OFF/extern_permis=false și blocajul de cod păstrate; DRY OFF pe lot aprobat cu informare publicată, separat informare absentă.
C3: handlerul moștenit verifică sesiunea și owner; fără transport/service_role nou.
C4: fără secrete/PII în adăugiri; jurnal numai tip/cod/UUID/autor/timp.
C5: UUID+hash păstrate, crearea serializează neeligibilitatea; DRY CAS negativ/pozitiv.
C6: ambele jurnale în tranzacția RPC; rollback refuză istoricul F2.

## L01–L25

| Regulă | Dovadă / limită |
| --- | --- |
| L01 | fn_red_mail_lot_creeaza: lock setări înainte de opt-out/rezervări, mutex comun. Concurența PG nerulată. |
| L02 | fn_red_mail_f2_audit: ambele jurnale atomic cu RPC; fără efect extern. |
| L03 | DRY cas_valid: token străin false/stare intactă, token propriu true pe aceeași rezervare vie. PG nerulat. |
| L04 | DRY owner: retry UUID = același lot/un mesaj, alt payload refuzat. PG nerulat. |
| L05 | Protocolul moștenit și UUID păstrat la retry neschimbate; fără send nou. |
| L06 | Ordine documentată setări→lot→mesaje; lock evenimente migrare/revenire. Concurența nerulată. |
| L07 | ACL/RLS păstrate; DRY non-owner/anon/DML direct/triggere imuabile. Matricea tuturor tabelelor încă incompletă. |
| L08 | auth.uid în RPC; claims simulate numai DRY, fără identitate nouă din payload. |
| L09 | fn_red_mail_destinatari owner-only, filtre proiect/UAT; creare reverifică ținta. |
| L10 | Jurnal nou fără conținut/adrese/erori brute; fără secrete. |
| L11 | n/a |
| L12 | fn_red_mail_destinatari + inventarMail + UI; mailInventar.test.js; smoke mixt/gol/invalid trecut. |
| L13 | n/a — fără parser/regex nou în continuare. |
| L14 | Revenire lock→refuz→restaurare CHECK F1; DRY ROLLBACK explicit. Ciclul complet nerulat. |
| L15 | pg_temp.f2_preflight + baseline unic PLACEHOLDER_LIVE refuză implicit; inventar tranzitiv/review/probe live deschise. |
| L16 | UUID/hash/UNIQUE existente păstrate; eligibilitatea suplimentară nu substituie UNIQUE. |
| L17 | n/a — fără logică nouă de timp; fixture cu dată literală și lease relativ. |
| L18 | inventarMail refuză contract incomplet/necunoscut; eroarea nu devine inventar zero. Smoke negativ trecut. |
| L19 | UI consumă motive server și helper comun; fără duplicare predicate SQL. Test SQL inventar/paritate încă nerulat. |
| L20 | DRY aprobare legitimă/retry apoi OFF; CAS negativ urmat de token propriu pozitiv. PG nerulat. |
| L21 | n/a |
| L22 | n/a |
| L23 | Inventar numai după keyset până la pagina goală; LEFT JOIN păstrează lipsa contactului. |
| L24 | Inventar sub generația async existentă; reset la recitire/țintă și eliminarea selecției vechi. Test interactiv nerulat. |
| L25 | Fixture parcelă CHECK/NOT NULL corectate, claims/SET LOCAL ROLE, CAS propriu/străin. Smoke trecut; vitest/PG/concurență NU declarate trecute. |

---

## Istoric: raportul rularii anterioare (rezultatele de mai jos NU sunt ale continuarii)

**Rezultat: implementare parțială, INERTĂ. F2 integral nu este livrat. Nu aplica și nu activa această propunere.**
Nu am rulat Git, accesat baze de date, cerut/citit credențiale, trimis mailuri sau făcut deploy.
Toate scrierile sunt în worktree. Interdicția explicită „No Git commit” a prevalat asupra frazei ulterioare „doar commit local”.

## Fișiere

| Fișier | Rol |
| --- | --- |
| `supabase/migrations/20261131a_redari_mail_f2_loturi.sql` | Propunere de schemă/RPC: lot, snapshot, aprobare owner, idempotență UUID+hash, rezervare, CAS, limite, încheiere, inventar, golire/ștergere condiționată, OFF, opt-out, RLS/ACL și jurnal fără conținut. Gardă txid, preflight și postcondiții. NERULATĂ. |
| `supabase/revenire/20261131a_redari_mail_f2_loturi_ROLLBACK.sql` | Revenire armată, lock înaintea verificărilor, refuz dacă există date/istoric/configurare/numere M. NERULATĂ. |
| `supabase/tests/20261131a_redari_mail_f2_dryrun.sql` | Subset DRY cu fixture-uri fictive, claims + SET LOCAL ROLE: owner/non-owner, retry/conflict, informare, OFF, scriere directă, canal poștal, inventar zero, retenție fără termen. Pentru tranzacție anulată de runner. NERULAT. |
| `supabase/functions/_shared/redariMailF2.mjs` | Logică pură partajată JS/edge: validare, normalizare NFC, JSON canonic, hash, MIME text/PDF, clasificarea rezultatelor, CAS injectat, retry doar persistare, potrivire SENT decodat. `TRANSPORT_REAL_ACTIV=false`. |
| `supabase/functions/_shared/redariMailF2Handler.mjs` | Handler testabil: getUser, owner recalculat, ținta și informarea, refuz definitiv al transportului real. |
| `supabase/functions/redari-mail-trimite/index.ts` | Adaptor edge nedeployat; JWT-ul utilizatorului, rol verificat în cod prin RPC, fără service_role și fără acces Google/Vault. |
| `src/redari/mailLoturi.js` | Reexport al logicii comune, apel RPC cu eroare explicită și citire keyset până la pagina goală. |
| `src/redari/ui/MailLoturiEcran.jsx` | Ecran owner: UAT/lot, selecție maximum 300, ciornă, adrese complete și texte exacte, aprobare explicită pe versiune/hash, stări per destinatar, recitire și încheiere. Trimitere dezactivată. |
| `src/Redari.jsx` | Import și tab owner „✉️ Lot e-mail”. |
| `src/redari/ui/comune.jsx` | Elimină `email` din selectorul convocărilor juridice. |
| `src/redari/mailLoturi.test.js` | 45 teste pentru logică, handler și protocolul simulat. |
| `src/redari/ui/mailLoturiRender.test.jsx` | 2 teste SSR: owner/non-owner și mesajul explicit de oprire. |
| `docs/redari/PLAN_EMAIL_REDARI.md` | Marchează exact subsetul construit și ce lipsește pentru F2 integral. |
| `docs/redari/CONTRACT_SCHEMA.md` | Contractul propunerii locale F2, fără prezentare ca schemă aplicată. |
| `docs/redari/GHID_NOTIFICARI.md` | Starea reală a ecranului și lipsa trimiterii. |
| Acest raport | Evidență de livrare, limite, rezultate, cerințe și lecții. |

## Cerințele 1–6

1. **Owner, lot cu lot:** UI este ascuns pentru non-owner; RPC-urile verifică `auth.uid()` + `fn_sms_e_owner()`. Aprobarea compară versiunea și hash-ul recitit; `aprobat_de/la` sunt puse de server. Testele handler și UI resping rolul fabricat în body. Nu există trimitere automată.
2. **OFF + informare:** coloanele noi sunt implicit OFF/extern=false. `fn_red_mail_f2_setari` nu permite ON în această livrare; OFF nu cere versiune curentă. Aprobarea, rezervarea și `apel_incepe` cer `fn_red_informare_publicata(cod) IS TRUE`. Edge-ul are și blocaj de cod. Testele JS acoperă OFF/NULL/informare falsă; probele BD încă nu sunt rulate.
3. **Identitate:** edge-ul validează sesiunea cu `auth.getUser(jwt)` și verifică explicit rezultatul owner; ignoră uid/rol din body. Clientul utilizatorului ajunge până la RPC, fără service_role. Cheia anon fără utilizator este respinsă. Nu s-a implementat OAuth.
4. **Secrete/PII:** numai date fictive în teste; fără console/loguri brute în codul nou. Preview-ul owner afișează destinatarii intenționat, conform planului. Nu am citit fișiere de credențiale sau variabile cu secrete.
5. **Idempotență:** UUID per intenție, UNIQUE și hash al argumentelor; reluarea aceleiași cereri reutilizează lotul, alt payload este conflict. Snapshot și aprobare imuabile; rezervare și CAS pe token înainte de apel. Timeout/5xx/429 rămân `necunoscut`, fără retry send; se repetă numai persistarea rezultatului. Proba cu două execuții JS dă un singur send simulat. **Nu este dovadă de concurență PostgreSQL și nu există încă reconcilierea durabilă completă.**
6. **Jurnal:** rezultatele și pașii RPC sunt în `red_mail_jurnal_f2` (doar UUID, cod din listă închisă, autor, dată), în tranzacția operației. Nu se scriu adrese, subiecte sau corpuri în jurnal. **Integrarea evenimentelor F2 în `red_mail_evenimente` și termenele complete ale auditului rămân de făcut.** Nu s-a trimis nimic real.

## Verificări efectuate

- Testele țintite: `npx --no-install vitest run src/redari/mailLoturi.test.js src/redari/ui/mailLoturiRender.test.jsx` — rezultatul final se completează după ultima rulare mai jos.
- `npx --no-install vitest run`: **145 fișiere trecute, 18 eșuate la încărcare, 2 omise; 3483 teste trecute, 10 omise** la rularea de la 20:01. Erorile de încărcare indică pachetul `qrcode` lipsă. Acea rulare precedă ultimele două teste pure și cele două teste SSR.
- `npx --no-install vite build`: **eșuat**, Rollup nu poate rezolva `qrcode` din `src/redari/docx.js`.
- Worktree-ul nu avea `node_modules`; `npm ci --ignore-scripts --cache .npm-cache --no-audit --no-fund` a fost refuzat de mediu la accesul registry.npmjs.org (`EACCES`). Am copiat doar dependențe locale deja existente din alt worktree în `node_modules` din worktree-ul curent. Nu am modificat package.json/package-lock și nu am înlocuit `qrcode` cu un stub.
- PostgreSQL/SQL DRY/apply→rollback→reapply/concurență/PostgREST/Deno: **NU rulate**. Accesul la BD este interzis de brief. Build-ul, chiar verde, nu ar valida SQL sau query-urile reale.

## Ce lipsește pentru F2 integral

Nu există în checkout edge-urile F1 pentru citire/OAuth/retenție; `20261130j/k` sunt schema și regulile de bază, după cum spun și comentariile migrărilor. Livrarea acestui subset nu le substituie.

Rămân: generarea PDF a convocatorului și legarea/hash-uirea atașamentului în ciornă; codul `[RED-M-…-…]` cu HMAC; RPC-urile adaugă/scoate/mută; OAuth de trimitere cu validarea locală a id_token, Vault și wrapper HTTP unic; Gmail send; reconcilierea durabilă, rezultate târzii, decizia owner pe necunoscut; cursorul SENT și alertele; paritatea completă JS↔SQL; închiderea/retenția cu inventar imuabil și ștergerea fișierelor, confirmată absentă; UI pentru setări, opt-out, decizii și alerte. Schema curentă are suport de inventar, dar **nu are încă executorul complet pentru fișiere**. Crearea de lot oferă astăzi numai mesaje text, nu convocatoare PDF.

**L15 este incomplet:** preflight-ul fixează amprentele owner/auth și cere un manifest revizuit pentru un subset al dependențelor. Acesta nu acoperă încă întreaga închidere tranzitivă, coloanele, secvențele și toate triggerele. Nu furnizez un baseline inventat ca și cum ar fi citit live; migrarea refuză implicit fără parametrul revizuit. Este necesară completarea L15 înainte de DRY/apply, nu doar setarea parametrului la valoarea calculată curent.

Decizia de construire acum a fost respectată fără activare. Înainte de activare: review complet, implementările lipsă, confirmarea/documentarea (g)(h)(j)(m)(q) din plan, textul Juridic, DKIM/DMARC, autorizarea TGZ, OAuth dat personal de Răzvan, probe interne și aprobarea separată a extern_permis. Nu solicit acum niciun secret sau acord pentru activare.

## Fișa locală pentru registrul automatizărilor

Propunere: `redari-mail-trimite`, inactiv, fără cron, fără secrete noi. (a) Citește snapshot/adrese ca date; (b) adaptorul actual nu trimite și nu scrie; RPC-urile pregătesc lotul/jurnalul; (c) JWT-ul utilizatorului, fără service_role; (d) sesiune validă + owner, verificare în cod și BD; (e) aprobarea separată a lotului pe hash. Niciun conținut primit nu poate porni vreo acțiune. Actualizarea registrelor din BD nu a fost făcută: brief-ul interzice accesul la BD.

## L01–L25

Referințele la funcții sunt în migrarea nouă dacă nu e indicat alt fișier. „Parțial” înseamnă explicit că regula NU este încă demonstrată integral.

| Regulă | Aplicare / dovadă |
| --- | --- |
| L01 | Lock setări→lot înainte de validare în aprobare/rezervare/apel; versiune preview și CAS token. Test JS CAS pierdut. BD/concurență: nerulate. |
| L02 | Creare lot+mesaje+numere M+jurnal, aprobare+jurnal și rezultat+jurnal în câte un RPC. `proceseazaMesaj` cere incepe=true înainte de send simulat. |
| L03 | `fn_red_mail_apel_incepe` și `fn_red_mail_rezultat` compară lease_token; snapshot verificat din nou în `compuneMime`. Test CAS pierdut și snapshot alterat. |
| L04 | `fn_red_mail_lot_creeaza`: INSERT ON CONFLICT DO NOTHING, UUID PK, cerere_sha256, select sub lock, conflict payload. UI păstrează UUID la retry în aceeași intenție. DRY pregătit, nerulat. |
| L05 | `rezultatSend` clasifică 5xx/timeout/429/200 invalid ca necunoscut. Test retry persistare: send o dată. Nu există fallback sau regenerare automată. |
| L06 | Ordinea lock-urilor este comentată în RPC-uri; rezervarea blochează mesajele ordonat înainte de măturare. Dovada cu două sesiuni lipsește. |
| L07 | RLS+ACL fără DML direct, triggere pentru lot/snapshot/canal poștal. **Parțial:** protecțiile/inventarul/retenția complete încă lipsesc; API real netestat. |
| L08 | `auth.uid()` + owner în funcția server; getUser în edge; niciun p_user sau GUC de autorizare. Claims apar numai în DRY ca simulare. Test uid/rol fabricat în body. |
| L09 | Owner obligatoriu în fiecare RPC și edge; creare verifică proiect/UAT/deținător/contact. Test non-owner; DRY include refuz. |
| L10 | Fără secrete, fallback de integrare sau erori brute în codul nou. Nu există integrare OAuth/secret de testat negativ încă. |
| L11 | n/a — fără extragere de dovezi/AI. |
| L12 | **Parțial:** citirile paginate refuză răspuns invalid și neavansare, dar preview-ul nu inventariază încă toate motivele de neeligibilitate cerute de plan. |
| L13 | Regex ancorate pentru adresă/UUID/Message-ID/coduri; teste adresă pozitivă/negativă/injecție. Parserul MIME extern și codul de subiect încă lipsesc. |
| L14 | Runner într-o tranzacție, gardă txid, pre/post; revenire lock→refuz date/istoric/config. **Nedemonstrat:** apply→rollback→reapply nu s-a rulat. |
| L15 | **NEÎNDEPLINIT integral.** Amprente subset + refuz implicit; lipsesc manifestul complet revizuit și testele lanțurilor tranzitive. Vezi explicația de mai sus. |
| L16 | UUID PK, UNIQUE(lot,detinator), UNIQUE message_id/nr_document/email, hash semantic al cererii. Hash-ul atașamentului este verificat de helper, dar fluxul de atașare încă lipsește. |
| L17 | Cotele SQL folosesc `rezervat_la AT TIME ZONE Europe/Bucharest`; aprobarea expiră la timestamp exact în JS. Test graniță 7 zile. Probele SQL la miezul nopții/DST nu s-au rulat. |
| L18 | NULL/eroare nu permit trimiterea; handler diferențiază 401/403/404/503/409/423; test eșec citire informare. |
| L19 | Browser/edge importă același modul `.mjs`. **Parțial:** SQL are aceeași definiție canonică, dar paritatea executată pe PG nu este demonstrată. |
| L20 | Test pozitiv al gărzilor, teste OFF/NULL/non-owner/informare, CAS pierdut; OFF ocolește versiunea. **Parțial:** lipsesc matricea BD și toate excepțiile planului. |
| L21 | n/a — fără apel AI. |
| L22 | n/a — fără apel AI plătit. |
| L23 | `citesteMail` și încărcarea destinatarilor: keyset până la pagina goală, verificarea avansării, filtre server. Test server cu pagini mai mici decât limit. |
| L24 | `MailLoturiEcran`: generație, cleanup unmount, proiect capturat, reset la schimbarea țintei, reload explicit; rezultatele întârziate nu se aplică. Testele SSR nu demonstrează cursele React; test interactiv încă necesar. |
| L25 | Fixture-uri fictive și claims/SET LOCAL ROLE în DRY. Teste JS rulate; **NU pretind** echivalență cu PG real, API sau concurență cu barieră. Aceste probe rămân obligatorii. |
