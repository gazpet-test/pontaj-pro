# Rotație parole HR — cod și operațiuni rămase

Data: 06.11.2026. Branch: `sec/rotire-parole-hr`; PR draft către `main`, fără merge.
Nu s-au accesat Supabase, datele reale sau serviciul de mail. Nu s-au setat secrete.
Parolele publicate sunt compromise; eliminarea din cod nu le revocă și nu șterge istoricul Git.

## Schimbarea din cod

- `supabase/functions/hr-autorizatii-scan/index.ts:53`: citește exclusiv
  `Deno.env.get('HR_AUTORIZATII_SCAN_PAROLA')` și verifică `x-hr-secret` înainte de clientul BD.
- `supabase/functions/hr-digest-saptamanal/index.ts:27`: citește exclusiv
  `Deno.env.get('HR_DIGEST_SAPTAMANAL_PAROLA')`. Restul logicii digestului, inclusiv
  destinatarii, interogările, corpul mailului și `?test=1`, rămâne identic.
- `_shared/secretHr.mjs:1`: SHA-256 pe ambele intrări, apoi `node:crypto.timingSafeEqual`
  pe digesturi de 32 octeți. Comparația criptografică are timp constant; costul hash-ului
  depinde de lungimea intrării, nu există comparație de parole cu `===` sau ieșire la primul octet diferit.
- Configurare absentă, goală sau numai spații: **503**, mesaj generic. Secret greșit,
  lipsă sau vechi: **401**. Nicio valoare primită/configurată nu este logată ori returnată.
  Nu există fallback pe `SEAP_IMPORT_SECRET`, `HR_DIGEST_SECRET` sau service_role.
  `OPTIONS` la scan rămâne preflight fără operațiuni HR.
- `docs/ofertare/RFQ_FURNIZORI_PROPUNERE.md:109`: mobilul SINTAX a fost înlocuit cu
  `telefon: in ERP, la furnizor`. `docs/ops-secrets.md` indică noile secrete, încă neconfigurate.

## Apelanți: ce dovedește repository-ul

Inventar pe main `db2e40ef949df96fa8cfbad420836747ed225f17`, inclusiv fișiere ascunse,
migrări, scripturi, API/Vercel, UI și celelalte edge functions. Căutări după slugurile
exacte, variantele cu `_`, `x-hr-secret` și potriviri exacte ale vechilor constante
(valorile au fost ținute doar în memorie și mascate în ieșire).

| Funcție / loc | Rezultat | Acțiune |
|---|---|---|
| `hr-autorizatii-scan` | Niciun apelant executabil și nicio migrare cu apel găsite în repo | Răzvan inventariază apelanții manuali/externi; fiecare client server citește noul secret, fără literal |
| `hr-digest-saptamanal` | Comentariul `index.ts:7` numește jobul pg_cron `hr_digest_saptamanal`, luni 05:30 UTC | Răzvan verifică jobul real și schimbă headerul în citire din Vault; programarea nu se schimbă |
| Migrări SQL / pg_cron versionat | Nu apare niciun apel al celor două funcții și nicio copie a vechilor valori | Nicio migrare aplicată modificată; nu s-a creat migrare |
| Alte edge functions / scripturi / UI | Niciun apel găsit | Nimic de actualizat în cod |
| `.github/workflows/deploy-edge-function.yml:10,96` | Exemplu de slug și lista `NO_JWT`, nu apelant HTTP | Păstrate; workflow-ul de deploy nu a fost pornit |
| `docs/ops-secrets.md` | Inventar operațional, nu apelant | Actualizat; celelalte documente istorice rămân surse istorice |

Nu putem confirma din repo dacă jobul real există, ce comandă are sau dacă există
wrapper-e SQL / scripturi externe. Inventarul BD de mai jos este obligatoriu înainte de rotație.

## Pașii lui Răzvan — necesită aprobarea lui explicită „da” pentru BD/producție

1. **Inventar privat, numai citire.** În SQL Editor, listați metadatele, fără să afișați
   `cron.job.command`, `vault.decrypted_secrets.decrypted_secret` ori definiții cu parole:

   ```sql
   SELECT jobid, jobname, schedule, active
   FROM cron.job
   WHERE jobname = 'hr_digest_saptamanal'
      OR command ILIKE '%hr-digest-saptamanal%'
      OR command ILIKE '%hr-autorizatii-scan%'
      OR command ILIKE '%x-hr-secret%';

   SELECT n.nspname AS schema, p.proname, p.oid::regprocedure AS semnatura
   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE p.prokind IN ('f', 'p') AND (
      p.prosrc ILIKE '%hr-digest-saptamanal%'
      OR p.prosrc ILIKE '%hr-autorizatii-scan%'
      OR p.prosrc ILIKE '%x-hr-secret%');
   ```

   Pentru wrapper-ele găsite, urmăriți și joburile care le cheamă. Verificați și scripturi
   externe ori apeluri manuale. Inspectați comenzile numai în mediul privat de administrare;
   nu le copiați în chat, issue, PR sau raport dacă includ valori sensibile.

2. **Generare.** Într-un manager de parole, generați independent câte o valoare aleatoare
   de **minimum 32 caractere** pentru fiecare integrare. Nu reutilizați parola între funcții,
   nu folosiți date personale, nu afișați valorile în shell/loguri și nu le salvați în repo.

3. **Supabase Edge Secrets.** În Dashboard → Edge Functions → Secrets setați
   `HR_AUTORIZATII_SCAN_PAROLA` și `HR_DIGEST_SAPTAMANAL_PAROLA`.
   Nu configurați valori implicite sau nume alternative. Păstrați celelalte secrete pentru
   integrările lor; nu le ștergeți global doar fiindcă HR nu le mai acceptă.

4. **BD / Vault / apelanți.** După „da”, suspendați temporar joburile afectate, păstrând
   jobid, schedule, active și setările nesensibile pentru restaurare. În Vault creați/actualizați
   două intrări cu **aceleași nume și valori** ca în Edge Secrets. Edge env și Vault nu se
   sincronizează automat. Verificați exact o intrare per nume și valoare nevidă, fără SELECT pe valori.

   În comanda jobului **`hr_digest_saptamanal`**, înlocuiți strict valoarea literală
   a headerului `x-hr-secret` cu expresia:

   ```sql
   (SELECT decrypted_secret FROM vault.decrypted_secrets
    WHERE name = 'HR_DIGEST_SAPTAMANAL_PAROLA')
   ```

   Pentru orice job al scanului folosiți expresia identică, cu numele
   `HR_AUTORIZATII_SCAN_PAROLA`. Păstrați URL-ul, metoda, body-ul, celelalte headere și
   programarea existente. Salvați comanda prin `cron.alter_job`, pe jobid-ul verificat,
   într-o tranzacție; verificați postcondițiile fără a returna parola/comanda completă.
   Lipsa Vault nu justifică revenirea la literal: opriți operațiunea dacă intrarea nu există,
   este duplicată sau goală. Nu folosiți un șir formatat care ar îngloba valoarea decriptată
   în `cron.job.command`; expresia trebuie evaluată la fiecare execuție.

   Dacă există cron SQL într-o migrare deja aplicată, migrarea rămâne intactă:
   modificați jobul real prin operațiunea aprobată. În repo nu s-a găsit o asemenea migrare.
   Orice script extern citește numele corespunzător din secretul serverului; browserul nu
   primește secrete, nu folosiți `VITE_*`. O integrare UI ar necesita un flux server autorizat.

5. **Deploy coordonat.** După review și autorizarea separată a livrării, publicați numai
   cele două funcții și helperul lor comun din acest branch. PR-ul rămâne draft, fără merge
   făcut de Codex. Verificați compatibilitatea runtime-ului Deno cu `node:crypto`.
   Noile secrete singure nu dezactivează codul vechi: sunt necesare și deploy-ul, și actualizarea
   apelanților. Programați o fereastră scurtă; nu reactivați cronul înainte de verificări.

6. **Teste operaționale private.** Pentru fiecare funcție, POST pe URL-ul ei, header
   `x-hr-secret` injectat din managerul de parole, fără valoare în comandă, istoric sau log.
   Parola veche trebuie să dea **401**; cea nouă **200**. Testați și lipsa headerului: **401**.
   Pentru scan folosiți body `{"actiune":"lista"}` (numai citire; nu `ataseaza`).
   Pentru digest folosiți **`?test=1`**: apelul autorizat trimite efectiv un mail către Răzvan;
   Răzvan îl pornește explicit o singură dată, fără retry automat. La timeout/5xx, verificați
   întâi livrarea în Resend, fiindcă rezultatul poate fi necunoscut. Nu porniți testul în masă.
   503 la configurare lipsă/gol este verificat local; nu ștergeți secretul de producție pentru test.

7. **Închidere.** Reactivați numai joburile anterior active și verificați următoarea execuție.
   Notați jobid / numele secretelor / statusurile HTTP, fără valori. Dacă apare incident,
   opriți cronul și remediați configurația; nu restaurați parolele compromise ori fallback-urile.
   Rotația efectivă și testele 401/200 în Supabase rămân neexecutate de Codex.

Documentație verificată: [Edge Function Secrets](https://supabase.com/docs/guides/functions/secrets)
și [changelog](https://supabase.com/changelog.md). Configurarea în Dashboard evită presupuneri
despre CLI v3; nu s-a rulat nicio comandă Supabase.

## Teste și limite

`supabase/functions/_shared/secretHr.test.js` testează helperul pur și execută entrypoint-urile
reale transpuse din TS, cu Deno, BD și fetch simulate. Fixture-urile sunt exclusiv fictive.
Teste: configurare absentă/gol/spații → 503; lipsă/greșit/vechi/prefix/lungime diferită → 401;
fără BD/mail/log la refuz; fără fallback service_role/secrete legacy; integrare separată;
nou → 200 în ambele funcții; digest `?test=1` păstrează destinatarul și trimite o singură dată
în simulator; scan OPTIONS păstrează CORS. Deno CLI nu este instalat, deci nu s-a rulat Deno test.

Verificare pe main `db2e40ef949df96fa8cfbad420836747ed225f17` plus schimbarea HR:

- `npx vitest run`: **4164 trecute, 22 sărite, 1 eșuat** (175 fișiere: 171 trecute,
  3 sărite, 1 eșuat). Cele **33 teste HR sunt verzi**.
- Unicul eșec este preexistent: `api/_poartaOfertare.test.js:172` așteaptă două apariții
  ale filtrelor din `.github/workflows/ofertare-regresie.yml`; main a eliminat triggerul
  `push` și a păstrat filtrul pentru PR. Testul izolat reproduce eroarea pe fișierele main,
  fără dependență de modificările HR. Nu am modificat workflow-ul sau testul fără legătură.
- `npx vite build`: **verde**, 39.04 s; avertismente existente despre dimensiunea chunk-urilor
  și combinații de importuri statice/dinamice.
- `git diff --check`: verde. Verificare în memorie: logica după autentificare din ambele
  funcții este identică byte cu byte; vechile valori nu mai apar în arborele curent.
- Shell-ul nu putea contacta proxy-ul; main a fost citit prin conectorul GitHub și validat
  într-o copie separată. Fișierele schimbate între copia locală și main au fost verificate
  după SHA blob. Singurul DOCX nou a fost regenerat cu scriptul main și corespunde exact
  SHA-ului din main. Fișierele acestea nu fac parte din schimbarea HR.

Cerința „vitest + build verzi” este **parțial neîndeplinită** din cauza regresiei preexistente
în testul workflow-ului. Verificarea runtime Supabase, cronului live și livrării reale de mail
îi revine lui Răzvan.

## Conformitate L01–L25

| Regulă | Dovadă / aplicabilitate la schimbare |
|---|---|
| L01 | n/a |
| L02 | n/a — nu schimbăm fluxuri de scriere/mail |
| L03 | n/a |
| L04 | n/a — logica mailului existent rămâne identică; testul autorizat e manual, fără retry |
| L05 | Pasul 6: timeout/5xx la mail = rezultat necunoscut, reconciliere înainte de repetare |
| L06 | n/a |
| L07 | n/a — fără schimbări de schemă/RLS |
| L08 | Calea server verifică exclusiv secretul dedicat; fără identitate din body și fără bypass service_role; teste entrypoint |
| L09 | n/a — nu modificăm accesul pe entități sau operațiunile HR existente |
| L10 | `_shared/secretHr.mjs:1`; secrete independente, fără fallback/log; teste 401 cu valoare veche fictivă; pașii 2–6 |
| L11 | n/a |
| L12 | Inventarul apelanților delimitează explicit repo vs BD/scripturi externe neverificate |
| L13 | n/a — fără regex/parser nou în produs |
| L14 | Nu modificăm migrări aplicate; pasul 4 cere tranzacție și postcondiții pentru schimbarea operațională propusă |
| L15 | n/a |
| L16 | n/a |
| L17 | n/a — nu schimbăm timp/cantități; programarea existentă rămâne intactă |
| L18 | `_shared/secretHr.mjs:6`: lipsă/gol/spații → 503 înainte de I/O; teste pe ambele entrypoint-uri |
| L19 | Un singur helper `_shared/secretHr.mjs`, importat de ambele funcții |
| L20 | Teste pozitive 200, negative 401/503 și excepția OPTIONS; fără operații HR la refuz |
| L21 | n/a |
| L22 | n/a |
| L23 | n/a — interogările existente nu sunt modificate |
| L24 | n/a |
| L25 | Teste cu Request și headerul real `x-hr-secret`, așteptări explicite, entrypoint-uri reale; I/O simulat declarat, fără a pretinde validare live |
