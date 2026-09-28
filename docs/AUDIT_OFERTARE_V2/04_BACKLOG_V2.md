# Backlog Audit Ofertare V2 (nou, separat de R01–R17)

Generat 28.09.2026. Sursă: fleet white-box (S01–S12, 303 constatări, verificare adversarială în curs) + a doua opinie Jakarinos (JAK-V2-01…12, toate CONFIRMATE de un verificator independent pe schema live, SELECT-only). R01–R17 rămân închise (baseline istoric).

## Închise deja în acest audit
- **JAK-V2-01** (BYPASS critic, aprobat→propus / propus→depus prin OR-ul politicilor) → **FIX în PR #515** (trigger matrice de tranziții + test pg-real). Merge doar cu GO.

## Critice CONFIRMATE, de decis (fix acum vs backlog)
| ID | Clasă | Rezumat | Fix minim propus |
|---|---|---|---|
| JAK-V2-07 / S10-02 | BYPASS critic | ~50 politici de scriere pe ofertare_* au doar `auth.uid() IS NOT NULL`; orice cont autentificat **fără modul** poate `DELETE` o licitație → CASCADE șterge cerințe/acoperiri/pachete/manifest (dovada „ce s-a aprobat" pierdută, fără urmă). | Politici de scriere prin `fn_are_acces_ofertare()` (nu doar autentificat) pe tabelele ofertare_*; `DELETE` doar owner/responsabil. |
| JAK-V2-06 | BYPASS critic (nedovedit dinamic) | 4 edge functions (`ofertare-e0-autofill`, `-inventar-ai`, `-citire-test`, `-triere`) cu `verify_jwt=true` dar fără poartă de rol în cod, rulează cu `service_role`; cheia anon e un JWT valid (gaura din PR #318) → posibil citit orice obiect din bucket / scris `ofertare_triere`. | Poartă de rol în cod (verificare modul/owner) la începutul fiecărei funcții; de dovedit dinamic cu cheia anon pe clona 103. |
| JAK-V2-05 / S10-01 | BYPASS mare→critic | Rute `api/*` (pdf-sparge, cad-parse, seap-import, plansa-felii) și edge (word-text, verificare-finala, garantie-mail, etapa1-mail) verifică doar `getUser` (sesiune validă), apoi operează cu `service_role` — fără modul/owner. | Verificare de modul după `getUser`; mailurile și cheltuiala AI doar cu poartă. |
| JAK-V2-03 / S09-01 / S12-02 | MISSING_LINK / FALSE_GREEN | `status='depusa'` pe licitație nu cere niciun pachet `depus`; `fn_gate_depunere` trece cu registrul gol (79/87 licitații live ar trece cu 0 cerințe). Tranziția e un UPDATE fără rol. | Gate să ceară pachet `depus` + cel puțin o cerință; RLS pe modul, nu doar autentificat. |
| JAK-V2-02 / S09-05 / S10-10 | BYPASS mare | Serverul nu verifică bytes-ii la depunere: `fisier_path` nullable, doar regex pe sha256, niciun JOIN cu `storage.objects`; read-back-ul R11 e doar în browser. Manifest fictiv → „depus". | Trigger care confirmă că fișierele `depus_final`/`dovada_seap` există în bucket cu size/sha potrivite (sau RPC server de read-back). |
| JAK-V2-04 / S08-01 / S12-01 | BYPASS mare | Poarta de **aprobare** pachet impune server-side doar completitudine SEAP + R5; restul (capitole neverificate/goale/nescrise, cuprins, anexe, grafic) e doar în JS (`ofertarePoarta.js`). Pachetul nu e legat de poartă (`pt_poarta_id` NULL). | Trigger care citește starea PT (v_ofertare_pt_stare) la aprobare; leagă `pt_poarta_id`. |

## Constatări white-box (fleet) încă în verificare adversarială
S03-01 (DELETE cerință cascadează dovada), S05-01/02/03 (dovada „verificat pe scan" fără hash/pagină; nu_se_aplica AI fără om; scriere directă PostgREST), S06-01/02 (r5 NULL fără cantități; ștergere rânduri scoate contoarele), S08-02 (export Word fără poartă/urmă). Se consolidează în 01_INVENTAR_WHITEBOX.md pe măsură ce verdictele se închid.

## Observații colaterale (igienă)
- `authenticated` are `TRUNCATE` pe ofertare_pt_pachet/_poarta/_licitatii (nu e expus prin PostgREST, dar ocolește RLS).
- `.delete()` din OfertarePropunere.jsx:1861 eșuează tăcut (authenticated fără DELETE pe pachet) → rânduri `propus` orfane (S09-11).
- `fn_ofertare_pt_pachet_poarta_documentatie` live provine din `docs/R5_MIGRARE_3_review_copilot.sql`, nu din `supabase/migrations` (drift repo↔live).
