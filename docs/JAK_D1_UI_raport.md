# D1 prep — UI Logistică, 04.10.2026

Implementare locală după `BRIEF_A.md`. Nu am rulat git și nu am accesat producția, BD, RPC-uri sau `supabase/`.

## Modificări

- `src/Logistica.jsx:11954`: `canDelete` pentru admin de modul/owner, transmis activelor, alimentărilor, transporturilor, avizelor, cesiunilor și Service. Owner-ul primește acces admin la inițializare (`:11138`); expresiile existente `canEdit` sunt păstrate.
- `src/Logistica.jsx:7319`: editare transport pentru editor/admin, aprobator sau participant; DELETE pentru admin/owner ori solicitant numai în `cerut`.
- `src/Logistica.jsx:7432`: DELETE aviz înainte de Storage; ștergerea multiplă (`:7471`) curăță numai fișierele rândurilor returnate efectiv. Ștergerea parțială/zero produce toast de eroare.
- `src/DocumenteFlotaPage.jsx:339`: upload → salvare BD → curățare PDF vechi; rollback al fișierului nou la eșec; DELETE BD înainte de PDF și `canDelete` în ambele căi de deschidere a modalului.
- `src/AmcSection.jsx:218`: aceeași ordine și rollback pentru AMC; `canDelete` pentru documente și tipuri, inclusiv confirmări.
- `src/SupapeDeclaratiiSection.jsx:197`: aceeași ordine pentru înlocuire/ștergere PDF supapă; buton DELETE condiționat de `canDelete`.
- `src/PiesePozeSection.jsx:75`: INSERT eșuat curăță poza nouă; ștergerea piesei/pozei confirmă BD înainte de Storage; butoane pe `canDelete`.
- `src/ServiceTab.jsx:804`: exclusiv transmitere `canDelete` și ascundere controale de ștergere fișe, intrări, atașamente și poze piese. Handler-ele nu sunt modificate.
- `src/ConfirmareAITab.jsx:142`: editorul poate respinge fără ștergere; DELETE și butonul său cer `canDelete`.
- `src/utils/logisticaStorage.js:1`: curățare best-effort; atât erorile returnate, cât și excepțiile Storage produc numai `console.warn`.
- `scripts/test-d1-logistica-ui.mjs:1`: teste locale pe handler-ele și condițiile JSX extrase din sursele reale, cu BD/Storage simulate; verifică și declarațiile/propagarea `canDelete`.

La DELETE-urile individuale care preced eliminarea fișierelor am adăugat `.select('id').single()`: un DELETE filtrat complet de RLS nu trebuie confundat cu succesul. UPDATE-urile PDF folosesc tot confirmarea unui rând. Nu există tabele/coloane noi.

## Verificare

`node --test --test-isolation=none scripts/test-d1-logistica-ui.mjs`: **59 trecute, 0 eșuate**. Include refuz BD, zero rânduri, eșec/excepție Storage, rollback PDF nou, ștergere multiplă parțială, admin/editor/owner, excepțiile transporturilor și respingerea AI fără DELETE. Sintaxa tuturor celor șapte fișiere JSX este parsată de Babel. Sunt teste simulate, nu teste de integrare PostgREST sau randare în browser.

`npx vite build`: **nu a putut compila**, cod de ieșire 1; pornirea esbuild este refuzată de mediu (`spawn EPERM`). Același refuz apare la pornirea unui proces Node copil de probă. Fragmentul relevant din eroare:

```text
failed to load config from C:\Users\Public\paw\noapte\wt_a\vite.config.js
error during build:
Error: spawn EPERM
    at ChildProcess.spawn (node:internal/child_process:441:11)
    at Object.spawn (node:child_process:796:9)
    at ensureServiceIsRunning (...esbuild/lib/main.js:1975:29)
```

Ultimele cadre din stack: `bundleConfigFile` → `loadConfigFromFile` → `resolveConfig` → `build` → `CAC.<anonymous> (...vite/dist/node/cli.js:829:11)`. Build-ul obligatoriu rămâne de rulat de Claude; nu este declarat trecut.

## Limite și puncte pentru review

- `docs/AUDIT_LOGISTICA/LOT_C_D1_RLS.md` nu există în acest worktree. Am urmat regulile explicite din brief; politica D1 efectivă nu a fost verificată.
- Nu am rulat API-ul real, teste RLS/Postgres/Deno sau browserul; brief-ul interzice accesul la BD/producție. Nu am schimbat migrări, RPC-uri, schema sau drepturi persistate.
- Atenție înainte de D1: editarea transportului multi-conținut (`src/Logistica.jsx:4622`) încă face DELETE + INSERT în `logistica_transporturi_continut`, după salvarea transportului. Dacă D1 restrânge și acest DELETE la admin, editorii/participanții pot rămâne cu salvare parțială; zero rânduri fără eroare poate lăsa conținutul vechi și adăuga cel nou. Fluxul nu a fost refactorizat, fiind în afara schimbărilor UI cerute și necesitând clarificarea politicii/RPC-ului.
- `ServiceTab.jsx:960` păstrează handler-ul existent: BD înainte de Storage, dar fără confirmarea rândului șters și fără izolarea excepției Storage. Brief-ul limitează explicit modificările aici la butoane; pentru refuz RLS cu zero rânduri este necesar review separat înainte de D1.
- Excepția de ștergere transport propriu în `cerut` este implementată exact în UI; trebuie să existe și în politica serverului, altfel butonul va primi refuz.
