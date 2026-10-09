# Clona ERP pentru Izocond-Tech — inventar hard-codări Gazpet (07.10.2026, doar citire)

Context: decizie Răzvan 07.10 — Izocond-Tech (33% Gazpet) primește o clonă a ERP-ului, goală de date, în cont Supabase + Vercel propriu. Repo nou `izocond-erp` în org gazpet-test. Inventarul de mai jos e baza PR-ului „setari_firma”.

## Concluzia care decide ordinea
**Nu există schemă de bază în `supabase/migrations/`** — doar 189 de migrări incrementale (din 12.09.2026). Baza reală trăiește doar în producție. Deci pasul 0 e `supabase db dump --schema-only` din proiectul Gazpet + curățarea seed-urilor, abia apoi parametrizarea codului.

## Cifre (fără docs/)
| Categorie | Fișiere | Ocurențe |
|---|---|---|
| Gazpet / GAZPET | 110 | 430 |
| gazpet.ro / @gazpet.ro | 48 | 143 |
| PontajPRO (nume produs) | 28 | 40 |
| Ploiești | 34 | 74 |
| CUI / J29 / IBAN | ~11 | ~25 |
| Persoane (Răzvan, Marilena, Pantea, Tudorache, Cristiana…) | 90 | ~190 |
| Ref Supabase dxczwk… / URL sooty | 35 | 57 |
| ANRE / Transgaz / Distrigaz | 45 | 122 |
| SEAP / motorină / PIUSI | 64 | 325 |
Peste jumătate sunt în Ofertare — dacă Ofertare se ascunde la clonă, nu se ating.

## 1. Identitatea firmei
- Există deja `firma_profil` (migrarea 20260925, 1 rând, scris doar de owner), dar o citesc doar OfertareNomenclatoare și ofertare-clauze-formulare. **Devine sursa unică** (+ logo, nume_produs, domeniu_mail, culori).
- De mutat pe firma_profil: `App.jsx` 3561/3806 (fallback J29), 5115 (IBAN default), 8093/8128 (placeholdere), header 1008+ („Gazpet ERP”), 987/1100/1180 („Made by Trusu Razvan”), `0700165029` ×7 (App + Financiar:124, de identificat ce e); `AdeverinteLegator.jsx:66-69`; `OfertareRFQ:151`, `OfertareClarificari:264`, `MagazieProductie:945` (antet complet → componentă `<AntetFirma/>`); `GeneratorContractMontaj:44`; `garantiiCerereOferta.js:141`; `DeclaratieTehnicaSection:287` + `SupapeDeclaratiiSection:615` (al doilea CUI RO13038090); `HrRecrutare:466` + `AplicaPublic:75` (text anunț).
- Logo: `src/logo.js` (JPEG base64, folosit în 8 fișiere) → Storage + URL în firma_profil. `public/logo_gazpet.jpg`, icon-*, apple-touch-icon → înlocuite. `manifest.webmanifest`, `index.html` title → `VITE_APP_NAME`.
- Seed-ul din `20260925_firma_profil.sql` se scoate (rândul se completează din UI).

## 2. Persoane hard-codate
- `TabConcedii.jsx:31-36`: hartă UUID profil → id (9 persoane) → coloană în employees/profiles.
- `App.jsx:1884-2162` gate diurnă: logica e pe `is_owner`/`can_modify_*` (OK), dar textele numesc persoane → generalizat.
- `emailsAllow` în `allModules` (Inventar Corecții, temporar) → se elimină.
- Texte cu nume: QrUtilajPage:1066, Logistica:652/4667/5121, ImportEvoGPSModal:1120, Consumabile:272, OCRValidateBulkModal:471, Marketing:4, SedintePage:97-113 (de verificat dacă e logică), HR:152-154.
- Edge cu mailuri personale: redirect-mai-gov, parse-contract-proiect, upa-plafon-alerta, probleme-parc-reminder, hr-recomandare-citeste, ofertare-* → tabel de destinatari.
- `is_owner` e flag pe profiles, nu nume → reutilizabil.

## 3. Infrastructură
- Ref `dxczwkbciseqniprspcu`: workflows deploy-edge-function:75/84, verifica-edge-functions:52; 15 URL-uri `functions/v1/` în src (QrUtilajPage, OfertareLicitatii, OfertareClauzeFormulare, HrRecrutare, AplicaPublic, MagazieProductie, GeneratorContractMontaj); normative-scan-lunar; scripts → `VITE_SUPABASE_URL` / `secrets.SUPABASE_PROJECT_REF`.
- `pontaj-pro-sooty.vercel.app` ×33: 12 edge (olx-aplicari-sync, upa-plafon-alerta, recrutare-aplica, ofertare-etapa1-mail, ofertare-seap-veghe, ofertare-alerte-mail, probleme-parc-reminder, necesar-notificari, reminder-rapoarte, ofertare-garantie-mail, hr-digest-saptamanal, vercel-relay) + HrRecrutare, AplicaPublic → secret `APP_BASE_URL` / `VITE_APP_URL`.
- Expeditor `'PontajPRO <rapoarte@gazpet.ro>'` în 12 funcții → `MAIL_FROM` într-un helper `_shared/mail.ts`; domeniul verificat în Resend-ul Izocond.
- Sentry DSN hard-codat `src/main.jsx:12` → `VITE_SENTRY_DSN`, opțional.
- Chei anon: doar JWT-uri false de test în scripts; front-end corect pe env.
- NAS/Terra (192.168.1.42 ×2, docker-compose, iot-*/tuya/vicare/salus) → dezactivate la clonă.

## 4. Module (constanta `allModules`, App.jsx:1008-1030)
administrator, panou, financiar, logistica, **ofertare**, magazie, comercial, achizitii, ctc, administrativ, hr, tichete, consumabile, **executie** (izometrie Transgaz), rapoarte-santier, sedinte, marketing, **cladire**, organigrama-propuneri (temp), inventar-corectii (temp).
→ `settings.modules_disabled` citit peste `allModules`. La Izocond: Ofertare, Clădire, cele temporare, probabil Marketing și CTC. Tab PIUSI/bot din Logistica sub flag.

## 5. Texte de domeniu gaze (în afara Ofertare)
transgazTemplate.js, exportCentralizatorXlsx.js (ascunse cu Execuție); HR:58/2008 + TabScannerDocumenteHR:94/835 (nomenclator autorizații → BD); TabSantiere:1278-1566 (ANRE/Transgaz la probe → generic); Executie:1301/1618/2959; placeholdere în ProiectNouWizard:378, CtcTemplate:35, ParcAutoProbleme:371, Logistica:4945/5005; GeneratorContractMontaj (doar Transgaz/Romgaz/Conpet).

## 6. Edge functions — secrete (nume)
Comune SUPABASE_URL / SERVICE_ROLE / ANON. ANTHROPIC_API_KEY (~28 fn) + ANTHROPIC_WORKSPACE_ID (3), GEMINI_API_KEY, OPENAI_API_KEY (2), RESEND_API_KEY (14), SEAP_IMPORT_SECRET, HR_DIGEST_SECRET, NORM_SCAN_SECRET, OFERTARE_INGEST_SECRET, RFQ_INBOX_SECRET, GMAIL_* (redirect-mai-gov). Workflows: SUPABASE_ACCESS_TOKEN. De eliminat la clonă: tmp-probe-url, _test, ofertare-citire-test, redirect-mai-gov.

## 7. Minim ca aplicația să pornească (bază goală)
profiles (1 rând is_owner=true + role), settings (diurna_amount, meal_supplement_amount, iban_firma, firma_*), firma_profil id=1, user_module_access, sites, employees. Rolurile sunt stringuri în cod, modulele constantă. Seed-uri Gazpet de scos: 20260925_firma_profil, 20261003a + 20261006b (IBAN, de verificat), 20260929c (profiles), 9 migrări ofertare cu „Gazpet”.

## Estimare
~60–70 fișiere dacă Ofertare/Clădire/temporare doar se ascund (35 src, 15 edge, 2 workflows, public + index, ~5 migrări). ~120 dacă se curăță și Ofertare.
**Top 5 grele:** (1) schema de bază lipsă, (2) App.jsx, (3) Logistica.jsx, (4) mailurile din edge (helper _shared + MAIL_FROM + APP_BASE_URL), (5) documentele generate (logo.js + antete PDF).

## Plan propus (PR-uri, sesiunea Module ERP, după OK Răzvan)
1. **PR-A „setari_firma”** (Gazpet, util și nouă): firma_profil = sursă unică + `<AntetFirma/>` + logo din Storage + `VITE_APP_NAME/URL` + helper mail `_shared` + `modules_disabled`. Fără schimbare de comportament la Gazpet.
2. **PR-B „fără persoane în cod”**: TabConcedii, texte, destinatari în tabel.
3. **Pas 0 Izocond**: dump schemă din Gazpet → proiect nou → migrări → nomenclatoare minime → verificare că UI pornește gol.
4. Repo `izocond-erp` (fork), env-uri, Vercel Izocond, 5 utilizatori (drepturi date de Răzvan).
