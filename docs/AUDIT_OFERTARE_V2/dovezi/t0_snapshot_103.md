# T0 — snapshot de stare pe clona 103 înainte de orice scriere prin UI (28.09.2026, SELECT-only)

Cerut de Copilot (b): baseline + snapshot pe 103 înainte de P2. Se recompară cu T0 după fiecare etapă P2.

## Porțile server (ce impune serverul, nu UI-ul)
- `v_ofertare_seap_completitudine.blocaj` = „1 document(e) esențiale … necitite sau citite parțial" (`din_seap=false`, `enumerare=n/a`, `esentiale=10`, `esentiale_necitite=1`). Documentul e `1286 LISTE CANTITATI FARA VALORI.zip` (arhivă `ignorat`, conținutul C6…F3 e integral procesat) — vezi `s11_poarta_103_la_clonare.md`.
- `ofertare_r5_blocaj_sursa(103)` = „cantități de verificat: lista_f3_nevalidate = 62".
- Pachete = 0, porți semnate = 0. Deci pachetul nu se poate încă aproba (poarta de documentație + r5 sunt roșii pe server).

## v_ofertare_pt_stare (ce vede UI-ul ca roșu, dar serverul NU impune la aprobare pachet)
- `pt_verdict=null`, `pt_versiune=null`, `pachet_stare=null`, `grafic_versiune=null`.
- `cerinte_neverificate=270` (din 271 legături), `capitole_nescrise_de_om=12` (din 15), `capcane=7`, `documente_necitite=3`, `de_forma=29`.
- capitole=15, cu_capitol=270, de_raspuns=271, exceptate=1.
- **Golul de paritate (S08-01/S12-01):** aceste 270 neverificate + 12 capitole nescrise de om + 7 capcane blochează butonul în UI (`ofertarePoarta.js`), dar triggerul de aprobare pachet (`fn_ofertare_pt_pachet_poarta_documentatie`) verifică server-side DOAR completitudinea SEAP + r5. Pe clonă asta se poate demonstra dinamic în P2/P3.

## Numărători (identice cu sursa 5 — vezi p0_clona_103.md)
cerinte=417 (rezolvata 170 / de_analizat 139 / nu_se_aplica 108), acoperiri=378 (toate cu `verificat_pe_scan` nenul — ceea ce alimentează constatarea S05-01: „verificat pe scan" = cale copiată fără hash/pagină), documente=19 (19 obiecte în storage sub `103/atribuire/`), cantitati=1069 (toate `extras`, 0 validate → r5 roșu), clarificari=6 (5 trimisa / 1 raspunsa), capitole=15, legaturi=271, grafic=20.

## Observație de acces (finding candidat)
Interogarea vederii `v_ofertare_seap_completitudine` cu rolul `authenticated` (JWT-ul contului de test) → `ERROR 42501: permission denied for function ofertare_doc_are_bucati`. Vederea nu e direct interogabilă de un user obișnuit prin acea cale; UI-ul o consumă altfel (RPC/SECURITY DEFINER) — de confirmat la P2 înainte de a marca ca defect. (Rulat într-o tranzacție cu ROLLBACK; fără scriere.)

## T0 ca martor
Acest fișier + JSON-ul brut din tranzacția de citire sunt T0. Regula (Copilot): după fiecare etapă P2 majoră, se recompară cu T0 ca să se izoleze exact ce invariant s-a schimbat.
