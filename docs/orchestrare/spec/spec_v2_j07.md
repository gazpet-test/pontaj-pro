# V2-J07 (Jakarinos): poarta de aprobare/depunere pe server (P3)
GO design Copilot 29.09. Cod + teste PG16 + PR draft. **Fără producție; apply abia după Jilava 02.10.** Citește `docs/AUDIT_OFERTARE_V2/P3_TRIAJ_UI_ONLY.md` (tabelul + verdictul Copilot) și `src/ofertarePoarta.js`, `src/ofertareControale.js` (sursa logicii UI).

## Livrabile
1. Migrare `supabase/migrations/2026100Xa_ofertare_poarta_server_jakv2p3.sql` (+ _ROLLBACK):
   - câte o funcție SQL per control (`ofertare_ctl_cuprins(lic)`, `_neverificate`, `_capcane`, `_goale`, `_nescrise`, `_cantitati_f3_grafic`, `_garantie` dacă e structurată, `_grafic_relatii`, `_grafic_sursa`), fiecare returnând `{control_code, stare: ok|block|undetermined, detalii}`, STABLE, fără rețea;
   - tabel `ofertare_poarta_rezultate_text` (control_code, licitatie_id, parser_version, sursa_hash, stare, detalii, calculat_la), append-only, INSERT doar service_role. Controalele text (garantie nestructurată, anexe H5, numere H6, pachet H9 opis→fișier) se citesc de aici; lipsă sau hash diferit față de sursa curentă ⇒ `undetermined`;
   - `ofertare_poarta_server(lic) returns jsonb` = agregare. Verdictul e `block` dacă orice control e block sau undetermined;
   - integrare în `fn_ofertare_pt_pachet_poarta_documentatie` (la aprobat) și `fn_gate_depunere` (la depusa): RAISE P0001 cu lista de controale care blochează. Derogarea owner NU trece peste controalele care nu erau derogabile nici înainte (vezi R5); documentează ce e derogabil;
   - invalidare: la UPDATE pe text capitol / versiune grafic, rezultatele vechi devin stale (prin hash), fără ștergere.
2. Edge `supabase/functions/ofertare-poarta-text/` cu poarta de rol (`_shared/poartaOfertare.ts`): calculează controalele text din sursa curentă, scrie rezultatul cu `parser_version` + `sursa_hash`. Folosește aceeași logică ca UI (extrage-o într-un modul comun .mjs importat și de UI, dacă e posibil fără să schimbi comportamentul UI).
3. UI: `evalueazaPoarta` afișează în plus verdictul serverului (RPC `ofertare_poarta_server`). Nu elimina logica UI în J07 (paritate M01 = test).
4. **H1 identitate NU se implementează ca BLOCK** (decizie Răzvan în așteptare): marcat `BUSINESS_DECISION_REQUIRED`, nu contribuie la verde.
5. Teste `scripts/pg/test_jakv2p3_poarta_server.mjs` (PG16, toate triggerele active): pentru fiecare control, un caz ok și un caz block; controlul text lipsă / stale / cu parser vechi ⇒ block; invalidare la editarea capitolului; agregarea; ACL (authenticated nu poate insera rezultate text); R5/R12/J02/J05 neschimbate. Plus un test de paritate UI↔server pe fixture.

Reguli: doar worktree, fără git, fără live. Rezumat în `docs/AUDIT_OFERTARE_V2/jak_j07_rezumat.md`.
