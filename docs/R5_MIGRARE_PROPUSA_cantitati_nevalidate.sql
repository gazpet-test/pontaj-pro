-- RUNDA 9b (înlocuiește regulile istorice v6/runda 9 descrise mai jos): text automat fără cifre,
-- mapare explicită a unităților, TOTAL separat, review pe hash text + date, notificare la citire.
-- NEAPLICATĂ. Migrarea 1/1b rămâne neschimbată.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
-- R5 (Copilot 25.09.2026) — MIGRARE PROPUSĂ, NEAPLICATĂ. Nu e în supabase/migrations/ tocmai ca să nu fie luată drept aplicată.
-- „Existența rândului cu status='extras' nu demonstrează singură că a intrat în oferta aprobată."
-- Context și inventarul consumatorilor: docs/R5_CONSUMATORI_CANTITATI_NEVALIDATE.md.
--
-- Se aplică DOAR cu GO Razvan, prin apply_migration (nume propus: r5_cantitati_nevalidate), DUPĂ r5_cantitati_aprobare_istoric
-- (docs/R5_MIGRARE_PROPUSA_aprobare_istoric.sql — view-ul citește istoricul; fără el, migrarea se oprește cu mesaj) și ÎNAINTE de merge-ul ramurii
-- claude/cantitati-nevalidate-consumatori. Ordinea contează: codul nou citește v_ofertare_cantitati_nevalidate; fără view,
-- rândul H2 („cantitati") din poarta propunerii spune „nu putem verifica" pe orice licitație care are F3 (fail-closed, ca
-- P0c cu v_ofertare_pt_cerinte_neconfirmate). Azi (SELECT 25.09.2026) doar lic. 5 are F3 de rețea: 47 rânduri, toate 'extras'.
--
-- Conține:
--   1) VIEW NOU v_ofertare_cantitati_nevalidate (security_invoker) — câte rânduri de rețea NU sunt validate de om, pe surse.
--      Filtrul de rețea e IDENTIC cu CTE-ul qm din v_ofertare_pt_stare (dacă îl schimbi acolo, schimbă-l și aici și în v6).
--   2) ofertare_clarificare_planse_auto v6 — totalul F3 citat AUTORITĂȚII vine doar din rânduri validate; cât există
--      rânduri F3 de rețea nevalidate, textul cere corespondența fără total. Baza = funcția LIVE (verificat: repo v5
--      + linia `v_nou := v_noi > 0 AND v_standard` = live, md5 fără comentarii/spații 0875c2200e072289cd5b972b49cabb0c).
--      Atenție: fișierul supabase/migrations/20260926b_…_v5.sql din repo NU e identic cu live (are `v_nou := v_noi > 0`).
--      Runda 4 (verificator R3): setul F3 din v6 = EXACT filtrul qm / lista_f3_m din v_ofertare_pt_stare (același set ca
--      view-ul de mai sus și H2), nu filtrul vechi (um m/ml/M + denumire conduct/țeav/tub), care lua și articole de deviz și
--      rândurile TOTAL; numărul se scrie ro-RO fără ambiguitate („6.519,8 m”, „6.520 m”), independent de lc_numeric.
--
--   0) SARCINA 2 (Copilot, închiderea R4/R5, 26.09.2026 — condiția 2a + (c) + (d) + (e)):
--      0a) ofertare_transfer_stare(jsonb) — starea conflictelor transferului planșă → cantități a unui document (analiza.transfer_cantitati,
--          scris de ofertare-plansa-citeste; sau derivarea „legacy” din jurnalul citire_ai.sumar.cantitati scris de codul vechi);
--      0b) VIEW NOU v_ofertare_transfer_conflicte (security_invoker) — per document: deschis / n / token / confirmare;
--      0c) ofertare_transfer_conflicte_confirma(doc, token, notă) — confirmarea umană explicită (acces Ofertare, notă, autor = auth.uid());
--      v_ofertare_cantitati_nevalidate primește transfer_conflicte_docs / _n / _lista / transfer_in_curs (și licitațiile FĂRĂ rânduri, dar
--      cu conflicte), *_pe_um (defalcarea pe unitate; *_m = doar rândurile în m) și *_fara_cant; v6 protejează ciornele umane (textul și
--      statusul unei ciorne editate SAU aprobate — 'de_trimis' — nu se mai ating: marcaj ',revizie_planse_auto' + notificare internă).
--      Fără tabel și fără coloană nouă. Coexistă cu codul publicat azi (edge ofertare-plansa-citeste v25 = main, byte cu byte): codul vechi
--      nu citește nimic din ce e nou; transferurile lui sunt citite prin derivarea „legacy”; cheia analiza.transfer_cantitati e păstrată de
--      scrierile vechi (toate fac { ...analiza, ... }); v6 are aceeași semnătură (câmpuri noi doar în rezultat).
--
--   R1) REPARAȚIA RUNDEI 1 (verificatorii + ADDENDUM 2 Copilot, 26.09.2026) — detalii și dovezi: docs/R5_CONSUMATORI_CANTITATI_NEVALIDATE.md §14:
--      - jurnalele codului vechi FĂRĂ marcajele R5 (identitate_randuri) = 'legacy_partial' DESCHIS (restanța 'evaluare_partiala'), nu
--        „fără conflicte” (2a pe jurnalele legacy); restanțele DISTINCTE pe tip (`restante`), `motiv`, `confirmare_tip`;
--      - parsare DEFENSIVĂ: ofertare_ts_valid(text) (NOU) + bloc EXCEPTION — un document corupt = „necunoscut” deschis, view-ul nu cade;
--        confirmarea contează DOAR validă (uuid, ISO, tip, notă, token = id; coalesce => o cheie lipsă nu mai dă NULL / fail-open);
--      - confirmarea: ofertare_transfer_conflicte_confirma(doc, token, TIP, notă) — 'rezolvat' (≥ 5) / 'exceptie' (≥ 20), dreptul =
--        fn_ofertare_source_pack_poate_decide (LIVE: owner / responsabil / admin Ofertare), confirmat_token = id-ul rulării; varianta cu
--        3 parametri e ȘTEARSĂ (UI-ul nou o cheamă cu 4);
--      - trigger NOU trg_ofertare_doc_chei_server (fn_trg_ofertare_doc_chei_server, SECURITY INVOKER intenționat): o scriere DIRECTĂ a
--        unui utilizator (authenticated / anon) nu poate schimba cheile serverului transfer_cantitati / citire_ai (confirmare falsificată,
--        jurnal „curățat”); service_role și funcțiile DEFINER scriu normal;
--      - aprobarea finală: fn_ofertare_pt_pachet_poarta_documentatie (LIVE, a trigger-ului existent pe ofertare_pt_pachet) EXTINSĂ —
--        restanțe de transfer deschise / transfer în curs / view indisponibil => RAISE la 'aprobat' / 'depus' (partea de documentație
--        neschimbată; rollback-ul pune înapoi corpul live, md5(prosrc) a45ccdb853da8d7a6cabead04d9a95af);
--      - v_ofertare_cantitati_nevalidate: transfer_restante (pe tip, pe licitație); v6: ciorna „a mașinii” doar după AMPRENTA textului
--        generat (gen_<md5[:12]>) — un corp editat de om sub antet nu mai e rescris / retras; marcajul + notificarea O DATĂ PE EVENIMENT
--        (ev_<md5[:12]> al textului generat + planșelor), nu la fiecare apel.
--
--   R2) REPARAȚIA RUNDEI 2 (verificatorii rundei 1, 26.09.2026) — detalii și dovezi: docs/R5_CONSUMATORI_CANTITATI_NEVALIDATE.md §15:
--      - POARTA DE DEPUNERE (MAJOR): fn_gate_depunere (LIVE, trigger-ul trg_gate_depunere pe ofertare_licitatii, md5(prosrc)
--        6ee66ed8decff19a0c303c324454cfe1) EXTINSĂ: trecerea în 'depusa' e refuzată cât sursa cantităților are restanțe de transfer deschise /
--        un transfer în curs / controlul indisponibil (partea live — cerințe, acoperire, dovezi — NESCHIMBATĂ). Derogarea (derogare_depunere)
--        rămâne decizia lui Razvan, ca azi; pentru partea R5 contează doar dacă trecerea o face cineva cu drept de decizie
--        (fn_ofertare_source_pack_poate_decide) sau serverul. Rollback-ul pune la loc corpul live;
--      - verificarea sursei = O SINGURĂ funcție, ofertare_r5_blocaj_sursa(licitație) (NOU), folosită de poarta pachetului și de cea de
--        depunere; poarta pachetului o aplică și la aprobat → depus (un conflict apărut DUPĂ aprobare nu mai trece la depunere);
--      - v6 (MAJOR): un rând F3 de rețea VALIDAT FĂRĂ cantitate => textul către autoritate NU mai citează total (era „…din F3: 500 m”);
--        view-ul numără rândurile de rețea fără cantitate pe orice status (lista_f3_fara_cant, retea_fara_cant, *_validate_fara_cant);
--        UPDATE-ul ciornei mașinii cu gardă (FOR UPDATE + status / text neschimbate) — fără „lost update” peste o editare umană;
--      - view: rândurile APROBATE ȘTERSE (sterse_dupa_validare, _retea, _pe_um, _ultima, _lista — din istoric, motiv 'sters') și rândurile de
--        rețea în ALTE unități decât m (retea_alte_unitati, _f3, _pe_um — „sute m”, „mc”, fără unitate), numite, fără conversie;
--      - parsare defensivă și pe TIP: transfer_cantitati care nu e obiect, citire_ai / sumar / cantitati care nu sunt obiect => documentul
--        e „necunoscut” DESCHIS (înainte: lipsea din view sau apărea „nimic” închis);
--      - trigger NOU trg_ofertare_doc_conflict_pastrat: un utilizator FĂRĂ drept de decizie nu mai poate șterge / muta pe altă licitație un
--        document cu conflicte de transfer deschise (scotea conflictul din poartă fără urmă);
--      - trigger NOU trg_ofertare_cantitati_doar_om_valideaza: un proces al serverului (service_role) nu mai poate pune un rând în 'validat'
--        (cad-parse PUBLICAT pe main îl scrie direct) — rândul rămâne 'extras' / statusul lui, cu nota spusă. Închide EFECTIV fereastra
--        „fără import CAD” dintre migrare și deploy (nu mai e doar o regulă verbală); după deploy codul nou nu scrie oricum 'validat'.
--   R9) RUNDA 9 (verificatorii rundei 8 + ADDENDUM 3 Copilot, 26.09.2026 seara) — detalii și dovezi: docs/R5_CONSUMATORI_CANTITATI_NEVALIDATE.md §16.
--      Principiul: textul automat NU spune „total” pentru o sumă incompletă; o ciornă aprobată / editată de om NU se rescrie — amprenta bazei ei
--      e comparată cu baza de acum oriunde e afișată / exportată / trimisă.
--      - M1 (v6 subtotal ca total): cifra F3 vine din ofertare_f3_baza (NOU; aceeași clasificare ca view-ul) — citată DOAR când e completă (toate
--        pozițiile F3 de rețea validate, exact „m”, cu cantitate; niciuna de LUNGIME în ml / km / sute m / fără unitate, niciuna invalidată ieșită,
--        nicio aprobată ștearsă nerevizuită, niciun conflict de transfer deschis), cu identitatea sursei și fără „total”: „suma pozițiilor de
--        conductă din lista de cantități F3, exprimate în m: X m”; altfel textul cere corespondența fără cifră, iar rezultatul spune intern
--        „Subtotal din rândurile validate, exprimate în m, pentru lista de cantități F3 (…): X m — NU e total; există N poziții suplimentare de
--        verificat: …”. „Nu le-am identificat” = doar fără NICIUN rând F3 (M9c). Ștergerile F3 aprobate: criteriul H2 (M9b);
--      - M2 (ciorna cu cifra veche): COLOANĂ NOUĂ ofertare_clarificari.baza_generare (amprenta bazei: identitatea rândurilor, valori canonice,
--        unități, statut, obiect / denumire / sursă / categorie — fără ordine, fără timestamp-uri) + v_ofertare_clarificari_baza (starea: ok /
--        schimbata / indisponibila / luat_act, cu diferențele) + trg_ofertare_clarificari_baza (backend: → de_trimis / → trimisa REFUZATE pe o
--        bază schimbată / nereconfirmată sau cu marcajul planșelor; câmpurile serverului nu se scriu direct — minorul saveQ) +
--        ofertare_clarificare_reconfirma (omul decide pe amprenta CURENTĂ; cifra veche: corectată sau marcată „valoare istorică”; transmisă: doar
--        „am luat act”) + trg_zzz_ofertare_cantitati_clar_baza (o schimbare F3 care face baza neactuală => O notificare internă, o dată pe
--        abatere; nimic trimis). v6: evenimentul = doar planșele (fără notificare dublă pentru aceeași schimbare F3);
--      - M3: view-ul numără rețeaua de LUNGIME în alte unități (retea_alte_unitati_lungimi, _f3, _nevalidate — aceeași clasă ca JS);
--        *_m la 6 zecimale (minorul „0,4 m apare 0 m”);
--      - M12 (fereastra v25): o citire NETERMINATĂ (citire_ai.gata = false) fără înregistrare = stare DESCHISĂ „citire_neterminata” (înainte:
--        documentul ieșea din view, depunerea trecea); M7: trigger-ul „doar omul validează” vede și rolul din JWT (funcțiile DEFINER);
--      - ADDENDUM 3 (3): jurnalul vechi = „verificare indisponibilă” (motivul legacy_partial), nu contradicție, nu recitire plătită obligatorie.
-- Rollback exact: docs/R5_MIGRARE_PROPUSA_cantitati_nevalidate_ROLLBACK.sql.
-- Testat local pe PGlite 0.5.8 (Postgres 18.3 compilat WASM, în proces, de unică folosință; schemă minimă cu coloanele reale),
-- NU pe un Postgres 16 și nu pe BD-ul de producție — un Postgres local (initdb) a fost refuzat de izolarea worktree-ului.
-- Scripturile de test: scratchpad/pglite/test_r5.mjs (runda 3) și test_r5_runda4.mjs (runda 4).
-- Sarcina 2 (26.09.2026): scratchpad/pglite/test_sarcina2.mjs (75/75, peste migrarea 1 în forma aplicată + 1b, cu rândurile și documentele
-- reale md5 = producția) + variantele _s2 ale suitelor anterioare; 12 mutații ale acestui fișier — toate prinse.
-- Runda 9: scratchpad/pglite/test_runda9.mjs (69/69: R9-0 aplicare fără schimbare de date, M1, M3 paritate JS ↔ view, M2 + ADDENDUM 3 A–E, ADDENDUM 2
-- testele 1–4 + confirmarea, M12, M7, rollback + reaplicare) — 13 mutanți ai acestui fișier / JS, toți prinși (scratchpad/r9/mut_runda9); variantele _r9
-- ale suitelor echipei (127 / 48 / 18 / 13 / 17) și ale verificatorilor rundei 8 (vfui3_adv_r9 37/37, vf_final/adv_final_r9 58/58).
-- Reparația rundei 2: scratchpad/pglite/test_sarcina2_r2.mjs (secțiunile R2-*, peste toate verificările rundei 1) + suitele verificatorilor
-- (vf_bd/adv_bd.mjs, pglite/vfui_r1_adv.mjs) rulate pe această versiune: constatările C5 / C8 / C9b / D1 / V-C4 nu mai apar.
-- Reparația rundei 1: scratchpad/pglite/test_sarcina2_r1.mjs (102/102) + variantele _r1 ale suitelor anterioare (66 / 18 / 13 / 17);
-- 14 mutații ale acestui fișier (scratchpad/r1/mutanti.py, din 29 în total) — toate prinse; controale negative pe codul de la be63d25.
--
-- PREVIEW (rulează ÎNAINTE, doar SELECT; execute_sql întoarce doar ultimul rezultat → un SELECT per apel):
--   (P1) ce va arăta view-ul, pe licitații:
--     SELECT q.licitatie_id, count(*) FILTER (WHERE q.tip_sursa='lista_f3' AND q.status<>'validat') f3_nev,
--            round(sum(q.cantitate) FILTER (WHERE q.tip_sursa='lista_f3' AND q.status<>'validat')) f3_nev_m,
--            count(*) FILTER (WHERE q.tip_sursa='plansa' AND q.status<>'validat') plansa_nev,
--            count(*) FILTER (WHERE q.tip_sursa IS NULL AND q.status<>'validat') fara_tip_nev, count(*) retea
--       FROM ofertare_cantitati q
--      WHERE q.um='m' AND q.categorie ~* 'conduct|re[țt]ea'
--        AND (coalesce(q.obiect,'')||' '||coalesce(q.denumire,'')||' '||coalesce(q.sursa,'')) !~* 'total'
--      GROUP BY 1 ORDER BY 1;
--     La 25.09.2026: lic. 3 → 0 F3 (memoriu 3 din 5 nevalidate); lic. 5 → F3 47 nevalidate / 6.520 m; lic. 95 → 6 fără tip,
--     toate nevalidate (48.195 m); lic. 102 → 2 fără tip, nevalidate.
--   (P1b) ce total F3 ar cita v6 (runda 4, filtrul qm; NULL = fără total, pentru că există F3 nevalidată) vs filtrul vechi:
--     SELECT q.licitatie_id, count(*) FILTER (WHERE q.um='m' AND q.categorie ~* 'conduct|re[țt]ea'
--              AND (coalesce(q.obiect,'')||' '||coalesce(q.denumire,'')||' '||coalesce(q.sursa,'')) !~* 'total') f3_qm_n,
--            count(*) FILTER (WHERE q.um='m' AND q.categorie ~* 'conduct|re[țt]ea' AND q.status<>'validat'
--              AND (coalesce(q.obiect,'')||' '||coalesce(q.denumire,'')||' '||coalesce(q.sursa,'')) !~* 'total') f3_qm_nev,
--            round(sum(q.cantitate) FILTER (WHERE lower(coalesce(q.um,'')) ~ '^m(l|\.l\.)?\.?$' AND q.denumire ~* '(conduct|teav|țeav|tub)'), 1) f3_filtru_vechi_m
--       FROM ofertare_cantitati q WHERE q.tip_sursa='lista_f3' GROUP BY 1 ORDER BY 1;
--     La 26.09.2026: doar lic. 5 — qm 47 rânduri (6.519,79 m), toate nevalidate => v6 fără total; filtrul vechi 62 rânduri /
--     7.747,68 m (+15 rânduri cu um „M” = articole de deviz, 1.227,89 m, ex. „MONTAREA PARAPETELOR SI PODETELOR…”), 0 rânduri TOTAL.
--   (P2) ciornele automate „planse_auto" al căror text s-ar schimba la următorul apel (text standard + F3 cu rânduri nevalidate):
--     SELECT c.id, c.licitatie_id, c.status, left(c.intrebare, 60) FROM ofertare_clarificari c
--      WHERE c.origine='automat' AND c.cheie LIKE 'auto_planse_%' AND c.status IN ('propunere','de_trimis')
--        AND left(coalesce(c.intrebare,''), 92) = 'Solicitare de clarificare (art. 160–161 din Legea nr. 98/2016) — date cantitative din planșe'
--        AND EXISTS (SELECT 1 FROM ofertare_cantitati q WHERE q.licitatie_id=c.licitatie_id AND q.tip_sursa='lista_f3' AND q.status<>'validat'
--                     AND q.um='m' AND q.categorie ~* 'conduct|re[țt]ea'
--                     AND (coalesce(q.obiect,'')||' '||coalesce(q.denumire,'')||' '||coalesce(q.sursa,'')) !~* 'total');
--     (#63 de la lic. 95 NU intră: text editat de om, iar lic. 95 n-are F3.)
--   (P1c) condiția 2 (26.09.2026) — corpul view-ului extins, rulat ca SELECT pe producție: lic. 3 → 3 de rețea nevalidate (23.630 m),
--     0 invalidate ieșite; lic. 5 → F3 47 / 6.520 m, rețea 94 / 94 (28.862 m); lic. 95 → 6 fără tip (48.195 m); lic. 102 → 2 fără tip
--     (167.200 m); invalidate_in_afara_retea = 0 peste tot (regula de invalidare nu rulează încă în BD — vezi
--     docs/R5_MIGRARE_PROPUSA_aprobare_istoric.sql). PGlite capăt-la-capăt cu trigger-ul: scratchpad pglite/test_view_conditia2.mjs
--     (runda 6: 18/18), adv_r6.mjs 13/13, test_r5_runda4.mjs 16/16.
--   (P1d) runda 6 (unitatea normalizată, decis în audit 26.09.2026, reversibil) — rândurile care intră în setul de rețea DOAR prin
--     normalizare (um ≠ exact 'm', dar ofertare_norm_text(um) = 'm'):
--     SELECT q.licitatie_id, q.um, q.tip_sursa, q.status, count(*), round(sum(q.cantitate), 2) FROM ofertare_cantitati q
--      WHERE q.um IS DISTINCT FROM 'm' AND lower(btrim(translate(coalesce(q.um,''), chr(160), ' '))) = 'm'
--        AND q.categorie ~* 'conduct|re[țt]ea' AND (coalesce(q.obiect,'')||' '||coalesce(q.denumire,'')||' '||coalesce(q.sursa,'')) !~* 'total'
--      GROUP BY 1,2,3,4;
--     La 26.09.2026: DOAR lic. 5 — 15 rânduri F3 „M”, extras, 1.227,89 m, în „Conducte și montaj”, dar sunt ARTICOLE DE DEVIZ (borduri,
--     parapete…). Efect după aplicare: lista_f3_nevalidate lic. 5 47 → 62 și um_de_normalizat_f3 = 15 (H2 BLOCK, numite); v6 nu citează
--     total cât există rânduri F3 cu unitatea ≠ exact 'm' (f3_um_de_normalizat). Nimic nu se adună tacit; corecția = categoria lor.
--   (P3) sarcina 2 — conflictele transferului (derivarea legacy, rulată ca SELECT pe producție 26.09.2026; nicio înregistrare nouă încă):
--     8 documente cu jurnal de transfer (130, 470–475, 1035), toate cu forma cunoscută, niciunul în curs; conflicte: DOAR doc 470
--     (lic. 95) — 2: Dn60 nestandard 110 m + 3 adnotări pe Dn absent (1.770 m). Deci după aplicare: lic. 95 transfer_conflicte_docs = 1,
--     _n = 2 (lic. 95 e oricum BLOCK pe cele 6 rânduri extras); lic. 3 / 102: 0. *_pe_um: goale peste tot (0 rânduri invalidate azi).
--   (P4) sarcina 2 (e) — ciornele auto_planse protejate: azi o singură ciornă, #63 (lic. 95, de_trimis, text editat de om, sursa =
--     planșele 475..471 exact) => v6 întoarce „neschimbat”, fără marcaj; se marchează doar dacă se schimbă mulțimea planșelor.
--   (P3-R1) reparația rundei 1 (SELECT pe producție 26.09.2026, aceleași 8 documente, niciunul cu transfer_cantitati sau cu marcaje R5;
--     derivarea rulată pe copiile md5 = producția în PGlite): TOATE 8 DESCHISE — 130 (lic. 3) legacy_partial 1; 470 (lic. 95) conflicte
--     n = 3 (Dn60 nestandard, adnotări, evaluare parțială); 471–475 (lic. 95) legacy_partial 1 fiecare; 1035 (lic. 102) legacy_partial 1.
--     Pe licitații: lic. 3 → 1 doc / 1 restanță; lic. 95 → 6 doc / 8; lic. 102 → 1 / 1. EFECT: poarta graficului BLOCK și aprobarea
--     finală blocată pe lic. 3 / 95 / 102 până la „♻ reevaluează (fără AI)” (după deploy-ul edge; GO pentru scrierile în rânduri) sau ✋
--     (471–475 au citiri goale => rămân deschise până la ✋ „excepție”). 0 pachete în BD — nimic aprobat nu e afectat retroactiv.
--   (P4-R1) #63 (lic. 95, de_trimis, text editat, fără tokeni gen_ / ev_) => v6 „neschimbat”, nicio notificare (verificat în PGlite pe copia
--     reală); la primul eveniment nou (altă mulțime de planșe) => marcaj + 1 notificare, apoi nimic până la următorul eveniment.
--   (P5-R2) reparația rundei 2 (SELECT pe producție 26.09.2026): poarta de depunere live = md5(prosrc) 6ee66ed8decff19a0c303c324454cfe1
--     (trg_gate_depunere BEFORE UPDATE pe ofertare_licitatii); licitațiile în_lucru: 3 (termen 14.10), 5 (18.09), 93 (02.10), 95 (19.10);
--     go: 15, 101, 102. După aplicare, „depusa” e refuzată pe lic. 3 și 95 (restanțe de transfer deschise) și pe 102 când va fi în lucru, până
--     la ♻ reevaluare / ✋ confirmare / derogare (Razvan); 5 și 93 n-au jurnal de transfer => neatinse. Nicio licitație „depusa” nu e atinsă
--     (trigger-ul verifică doar TRECEREA în depusa). 0 documente cu cheile serverului de alt tip (V-C4), 0 rânduri validate fără cantitate,
--     istoricul gol (0 ștergeri), lic. 5: 29 de rânduri de rețea în alte unități (F3: 11 „mc”, 12 „sute m”; plus 1 „ore”, 5 fără unitate).
--     Verificare statică: niciun cod de pe main sau de pe ramură nu scrie 'validat' din server, în afară de api/cad-parse.js PUBLICAT (main).
--   (P6-R9) runda 9 (SELECT pe producție 26.09.2026 seara): documente cu citire_ai.gata = false: 0 (M12 nu schimbă nimic azi); ciorne automate:
--     doar #63 (lic. 95, de_trimis, fără amprentă) — evaluarea deterministă a textului: „nu am identificat liste de cantități”, lic. 95 fără F3 =>
--     baza „ok”, nicio notificare, nimic blocat; rețeaua de LUNGIME în alte unități: DOAR lic. 5 — 17 rânduri, toate nevalidate (12 F3 „sute m”
--     + 5 fără unitate; plus „mc” / „ore”, numite) => poarta graficului lic. 5: +17 rânduri „lipsă” (era deja BLOCK pe 62 de rânduri F3
--     nevalidate), H2 lic. 5 „subtotal F3” (era deja BLOCK), v6 lic. 5 tot fără cifră; lic. 3 / 95 / 102: nimic. Coloana nouă = NULL peste tot.
--   FERESTRE (între aplicarea migrărilor și merge / deploy): importul CAD publicat NU mai poate scrie 'validat' (trigger-ul 0f îl ține
--     'extras' / pe statusul vechi — suspendare efectivă a părții afectate, nu doar regulă verbală); o citire de planșă cu edge v25 lăsată
--     NETERMINATĂ apare „citire neterminată” (deschisă, blochează depunerea — runda 9, M12; înainte nota spunea „sigur”, dar documentul ieșea
--     din poartă); UI-ul publicat: „✓ revizuită” (scoaterea marcajului prin `sursa`) nu mai are efect — trigger-ul păstrează tokenii serverului;
--     reconfirmarea se face din UI-ul nou; deploy imediat după merge: ofertare-plansa-citeste, ofertare-clarificari-propune,
--     ofertare-document-nou-citeste (workerul NAS se actualizează singur la commitul nou de pe main); UI-ul publicat: bannerul din
--     OfertareLicitatii numără tokenii gen_ / ev_ / revizie_ ca planșe (cosmetic, doar în fereastră).
--   DUPĂ APLICARE: get_advisors + registru_automatizari (trigger-ul nou al cheilor serverului; confirmarea cu drept de decizie; extinderea
--     trigger-ului pachetului ȘI a porții de depunere; trigger-ele noi ale rundei 2 — documentul cu conflicte nu se șterge / mută fără drept
--     de decizie, serverul nu validează; modul „reevaluează” al edge-ului — nu citește conținut extern nou, scrie în cantități ca transferul,
--     poarta pe cheltuială owner / responsabil). Runda 9: trg_zzz_ofertare_cantitati_clar_baza (fișa: (a) citește rândurile F3 și textul ciornelor
--     — date interne, nimic extern nou; (b) scrie DOAR notifications + ofertare_clarificari.baza_generare (marcajul notificării), fără mail, bani
--     sau drepturi; (c) SECURITY DEFINER — scrie notificarea indiferent cine a schimbat rândul; (d) pornit de orice scriere pe un rând F3; (e)
--     nimic de confirmat: doar semnalează), trg_ofertare_clarificari_baza (INVOKER) și ofertare_clarificare_reconfirma (DEFINER, acces Ofertare,
--     autorul = auth.uid(); nu trimite nimic).
-- SANITY (după): SELECT * FROM v_ofertare_cantitati_nevalidate WHERE licitatie_id IN (3,5,95,102) ORDER BY 1;
--   R9: SELECT id, licitatie_id, status, stare, mod_ciorna FROM v_ofertare_clarificari_baza ORDER BY 1;   -- #63: ok, neidentificat
--       SELECT public.ofertare_f3_baza(5) ->> 'mod', public.ofertare_f3_baza(5) ->> 'text';   -- corespondenta, „Nicio poziție F3 de rețea validată în m …”
--       SELECT tgname FROM pg_trigger WHERE tgname IN ('trg_ofertare_clarificari_baza', 'trg_zzz_ofertare_cantitati_clar_baza');   -- 2
--   SELECT document_id, licitatie_id, sursa, stare, n, deschis, restante FROM v_ofertare_transfer_conflicte ORDER BY 1;
--     -- R1: 8 rânduri, toate deschis; 470: legacy, conflicte, 3; celelalte: legacy, legacy_partial, 1
--   SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid = 'public.ofertare_documente_atribuire'::regclass AND tgname = 'trg_ofertare_doc_chei_server';
--   R2: SELECT tgname FROM pg_trigger WHERE tgname IN ('trg_ofertare_doc_conflict_pastrat', 'trg_ofertare_cantitati_doar_om_valideaza', 'trg_gate_depunere');  -- 3
--       SELECT md5(prosrc) <> '6ee66ed8decff19a0c303c324454cfe1' FROM pg_proc WHERE proname = 'fn_gate_depunere';  -- true (extinsă)
--       SELECT public.ofertare_r5_blocaj_sursa(95) IS NOT NULL, public.ofertare_r5_blocaj_sursa(5) IS NULL;  -- true, true
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════

-- 1) ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- R5 condiția 2 (Copilot 26.09.2026): rândul invalidat / nevalidat nu dispare TACIT. În plus față de runda 4: metrii pe fiecare
-- sursă, rândurile de rețea fără tip de sursă (nu intră în nicio sumă a lui v_ofertare_pt_stare) și rândurile INVALIDATE care au
-- ieșit din setul de rețea (ex. unitatea m → ml a scos un rând F3 din qm, deci lista_f3_m a scăzut fără semnal). DROP + CREATE
-- (coloane noi în mijloc); view-ul e nou, nimic nu depinde de el.
-- Runda 5 (verificator, MAJOR 1): „invalidat” NU mai depinde doar de textul notei — transferul din planșă și CAD rescriu nota
-- oricărui rând nevalidat, deci o recitire ștergea prefixul „Rândul era VALIDAT …” și rândul ieșea tacit din numărătoare. Sursa
-- principală e ISTORICUL (docs/R5_MIGRARE_PROPUSA_aprobare_istoric.sql): ultimul eveniment al rândului e 'invalidat' / 'redeschis'
-- (fără 'validat' după el); prefixul notei rămâne sursă secundară (transferul și CAD îl păstrează acum). Aceeași regulă ca
-- `esteInvalidat` + `marcheazaInvalidate` din src/ofertareCantitatiAprobare.js. ORDINEA: migrarea istoricului se aplică ÎNAINTE.
DO $$ BEGIN
  IF to_regclass('public.ofertare_cantitati_istoric') IS NULL OR to_regprocedure('public.ofertare_norm_text(text)') IS NULL THEN
    RAISE EXCEPTION 'R5: aplică întâi docs/R5_MIGRARE_PROPUSA_aprobare_istoric.sql (r5_cantitati_aprobare_istoric) — view-ul citește istoricul';
  END IF;
  -- reparația rundei 1: obiectele LIVE refolosite — dreptul de decizie (confirmarea) și poarta server-side a aprobării finale (pachetul)
  IF to_regprocedure('public.fn_ofertare_source_pack_poate_decide(bigint)') IS NULL OR to_regprocedure('public.fn_ofertare_pt_pachet_poarta_documentatie()') IS NULL
     OR to_regclass('public.v_ofertare_seap_completitudine') IS NULL THEN
    RAISE EXCEPTION 'R5: lipsesc obiectele live fn_ofertare_source_pack_poate_decide / fn_ofertare_pt_pachet_poarta_documentatie / v_ofertare_seap_completitudine';
  END IF;
  -- reparația rundei 2: poarta de DEPUNERE live (trigger-ul trg_gate_depunere pe ofertare_licitatii) — se extinde, nu se dublează
  IF to_regprocedure('public.fn_gate_depunere()') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_gate_depunere' AND tgrelid = 'public.ofertare_licitatii'::regclass) THEN
    RAISE EXCEPTION 'R5: lipsește poarta de depunere live (fn_gate_depunere + trg_gate_depunere pe ofertare_licitatii)';
  END IF;
END $$;
-- Runda 6 (decis în audit 26.09.2026 pe principiile Copilot, reversibil):
--  (a) unitatea NORMALIZATĂ (ofertare_norm_text: trim, lower, spații Unicode — ca `normUm` / randuriFront din JS și regula de
--      invalidare): „M” / „m ” sunt metri, „ml” nu. v_ofertare_pt_stare.qm (live, neatins aici) cere încă exact 'm' => rândurile de
--      rețea cu unitatea scrisă altfel nu intră în totalurile ei: SEMNALATE (um_de_normalizat, _m, _f3), nu scăzute tacit;
--  (b) rândurile TOTAL (‚total’ în obiect / denumire / sursă) invalidate: numărate SEPARAT (total_invalidate, _m — referință, nu se
--      adună cu rândurile pe care le totalizează), ca în randuriLipsa din JS; invalidate_in_afara_retea = fără TOTAL;
--  (c) rândul NEAPROBAT ieșit din rețea prin schimbarea unității (istoric 'unitate_schimbata' după ultima validare, sau prefixul notei
--      „Unitatea s-a schimbat … de reverificat.”): unitate_schimbata_in_afara_retea, _m — nu mai dispare tacit;
--  (d) „invalidat” din istoric = ultimul eveniment al APROBĂRII (fără 'unitate_schimbata'), ca invalidateDinIstoric din JS; prefixele
--      notei contează doar cu terminatorul lor („validarea se reface.” / „de reverificat.”), ca prefixInvalidare / prefixUnitate.
DROP VIEW IF EXISTS public.v_ofertare_cantitati_nevalidate;
DROP VIEW IF EXISTS public.v_ofertare_transfer_conflicte;

-- 0) ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- R5 sarcina 2 (Copilot, închiderea R4/R5 — condiția 2a, „nimic scris ≠ nicio problemă”): conflictele transferului planșă → cantități
-- care NU produc niciun rând (grupuri ambigue, Dn-uri doar „de verificat”, secvență Nr incompletă, Nr fără lungime, tronsoane fără Dn /
-- nestandard / fără identitate, mai multe rânduri TOTAL, transfer amânat / căzut) — persistate de ofertare-plansa-citeste în
-- analiza.transfer_cantitati (transfer_conflicte.ts), legate de jurnal prin citire_ai.sumar.cantitati.inregistrare_id. Fără tabel sau
-- coloană nouă (analiza e jsonb). Poarta le vede CHIAR DACĂ numărul rândurilor nevalidate e zero.
-- 0a) Starea normalizată a unui document — O SINGURĂ definiție, folosită de view și de funcția de confirmare:
--   'inregistrare' = transfer_cantitati legat de jurnal (sau fără jurnal: citire în curs pe runde; sau înregistrarea „legacy” convertită
--                    de codul nou) => sursa de adevăr;
--   'legacy'       = jurnalul scris de codul VECHI (fără legătură; ex. edge v25 de pe main): aceleași reguli ca `conflicteTransfer`
--                    (handler.ts) + `stareLegacy` (transfer_conflicte.ts), numărate aici — ambigue, „doar de verificat” (fără dublura
--                    „ambiguu”), TOTAL multiplu, identitate (fără identitate / conflicte de citire), identitate incertă (comasări /
--                    perechi), Nr lipsă (max. 6, + 1 pentru rest), Nr fără lungime, fără Dn, Dn nestandard, adnotări pe Dn absent;
--                    amânat / căzut = 'neefectuat'; formă necunoscută = 'necunoscut' (DESCHIS: nu putem verifica).
--                    REPARAȚIA RUNDEI 1 (verificatorul BD, MAJOR): un jurnal FĂRĂ marcajele R5 (sumarul n-are `identitate_randuri` —
--                    codul vechi nu evalua identitatea, Nr, TOTAL-ul multiplu, adnotările) NU mai e „fara_conflicte” închis: e
--                    'legacy_partial', DESCHIS (restanța 'evaluare_partiala'), iar cu conflicte numărate primește și ea restanța.
--                    Se închide prin reevaluarea cu codul nou (citire completă, ancorele acoperite) sau prin confirmare umană.
--   jurnal {in_curs} = transfer în curs: sub 10 minute starea înregistrării precedente; peste = 'neefectuat' (întrerupt);
--   'nimic'        = document fără transfer.
-- Deschis = orice stare în afară de 'fara_conflicte' (inclusiv una necunoscută — fail-closed), fără o confirmare umană VALIDĂ:
--   autor uuid, moment ISO valid, tip 'rezolvat' / 'exceptie', nota minimă (5 / 20 de caractere), legată de înregistrarea exactă
--   (confirmat_token = id). REPARAȚIA RUNDEI 1 (verificatorii, minorii „confirmat_la oarecare” / „confirmare falsificată”): un
--   `confirmat_la` nevalid („nu-e-data”) sau scris fără celelalte câmpuri NU mai închide nimic.
-- Parsare DEFENSIVĂ (reparația rundei 1, minorul „un jurnal corupt blochează H2 pe TOATE licitațiile”): orice valoare coruptă (dată
-- „2026-13-45”, n peste int, tipuri greșite) => pentru ACEL document stare 'necunoscut' DESCHISĂ cu motivul „date corupte” — niciodată
-- o eroare care să cadă tot view-ul (filtrul pe licitație nu coboară prin FULL JOIN). Câmpurile întoarse (confirmat_de / _la, la, n)
-- sunt deja validate, deci cast-urile din view nu mai pot cădea.
-- `restante` = [{tip, n}] — restanțele DISTINCTE (ADDENDUM 2 Copilot, b), fiecare cu cauza și acțiunea ei în UI (src/ofertareTransferRestante.js).
-- SECURITY INVOKER, STABLE (now() doar pentru „întrerupt”).
CREATE OR REPLACE FUNCTION public.ofertare_ts_valid(p text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF p IS NULL OR p !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]{1,6})?)?(Z|[+-][0-9]{2}(:?[0-9]{2})?)?$' THEN RETURN false; END IF;
  PERFORM p::timestamptz;
  RETURN true;
EXCEPTION WHEN others THEN RETURN false;
END $function$;
REVOKE ALL ON FUNCTION public.ofertare_ts_valid(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ofertare_ts_valid(text) TO authenticated, service_role;
COMMENT ON FUNCTION public.ofertare_ts_valid(text) IS 'R5 reparația rundei 1 (26.09.2026): text = moment ISO 8601 valid (regex + cast protejat) — pentru ofertare_transfer_stare (confirmat_la, la), fără să poată cădea.';

CREATE OR REPLACE FUNCTION public.ofertare_transfer_stare(p_analiza jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_rec jsonb; v_s jsonb; v_c jsonb; v_rd boolean; v_n int; v_nl int; v_stare text; v_conf boolean; v_rest jsonb; v_marcaje boolean;
  v_nr int; v_la text; v_lista jsonb; v_parti jsonb;
  nr_ CONSTANT text := '^-?[0-9]+(\.[0-9]+)?$';
  uuid_ CONSTANT text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
BEGIN
  IF jsonb_typeof(p_analiza) IS DISTINCT FROM 'object' THEN
    RETURN jsonb_build_object('sursa', 'nimic', 'n', 0, 'deschis', false, 'in_curs', false, 'restante', '[]'::jsonb);
  END IF;
  -- REPARAȚIA RUNDEI 2 (verificatorul UI, V-C4 — corupție de TIP): o cheie a serverului PREZENTĂ, dar de alt tip decât obiect (înregistrarea =
  -- array / text; jurnalul citire_ai / sumar / cantitati = text) NU mai e ignorată (înainte: documentul lipsea din view sau ieșea „nimic”
  -- ÎNCHIS, deci 0 restanțe și aprobarea trecea). RAISE => blocul EXCEPTION de mai jos: „necunoscut” DESCHIS, cu motivul, doar pe acest
  -- document. Înregistrarea coruptă contează oricând; jurnalul corupt doar fără o înregistrare-obiect (care e sursa de adevăr — inclusiv
  -- cea creată de confirmarea umană a acestei stări). JSON null = cheie absentă. Producția (SELECT 26.09.2026): 0 documente cu astfel de forme.
  IF p_analiza ? 'transfer_cantitati' AND jsonb_typeof(p_analiza -> 'transfer_cantitati') NOT IN ('object', 'null') THEN
    RAISE EXCEPTION 'transfer_cantitati de tip %', jsonb_typeof(p_analiza -> 'transfer_cantitati');
  END IF;
  v_rec := CASE WHEN jsonb_typeof(p_analiza -> 'transfer_cantitati') = 'object' THEN p_analiza -> 'transfer_cantitati' END;
  v_s := CASE WHEN jsonb_typeof(p_analiza -> 'citire_ai') = 'object' AND jsonb_typeof(p_analiza -> 'citire_ai' -> 'sumar') = 'object' THEN p_analiza -> 'citire_ai' -> 'sumar' END;
  v_c := CASE WHEN jsonb_typeof(v_s -> 'cantitati') = 'object' THEN v_s -> 'cantitati' END;
  IF v_rec IS NULL AND (
       (p_analiza ? 'citire_ai' AND jsonb_typeof(p_analiza -> 'citire_ai') NOT IN ('object', 'null'))
    OR (jsonb_typeof(p_analiza -> 'citire_ai') = 'object' AND (p_analiza -> 'citire_ai') ? 'sumar'
        AND jsonb_typeof(p_analiza -> 'citire_ai' -> 'sumar') NOT IN ('object', 'null'))
    OR (v_s IS NOT NULL AND v_s ? 'cantitati' AND jsonb_typeof(v_s -> 'cantitati') NOT IN ('object', 'null'))) THEN
    RAISE EXCEPTION 'jurnalul transferului (citire_ai / sumar / cantitati) nu e obiect';
  END IF;
  IF v_rec IS NOT NULL THEN
    -- confirmarea VALIDĂ (pereche cu confirmareValida din transfer_conflicte.ts)
    -- coalesce(…, false): o cheie LIPSĂ (ex. confirmat_de absent lângă un confirmat_la valid) dă NULL în AND — fără coalesce, „deschis” ieșea
    -- NULL și documentul NU se număra ca deschis (fail-open; prins de testul R1-confirmare, 26.09)
    v_conf := coalesce(jsonb_typeof(v_rec -> 'confirmat_la') = 'string' AND public.ofertare_ts_valid(v_rec ->> 'confirmat_la')
      AND jsonb_typeof(v_rec -> 'confirmat_de') = 'string' AND (v_rec ->> 'confirmat_de') ~ uuid_
      AND coalesce(v_rec ->> 'confirmare_tip', '') IN ('rezolvat', 'exceptie')
      AND length(btrim(coalesce(v_rec ->> 'confirmare_nota', ''))) >= CASE WHEN v_rec ->> 'confirmare_tip' = 'exceptie' THEN 20 ELSE 5 END
      AND jsonb_typeof(v_rec -> 'id') IS NOT NULL AND (v_rec ->> 'confirmat_token') IS NOT NULL AND (v_rec ->> 'confirmat_token') = (v_rec ->> 'id'), false);
    v_rd := coalesce(v_rec ->> 'stare', '') <> 'fara_conflicte' AND NOT v_conf;
    v_lista := CASE WHEN jsonb_typeof(v_rec -> 'conflicte') = 'array' THEN v_rec -> 'conflicte' ELSE '[]'::jsonb END;
    SELECT coalesce(jsonb_agg(jsonb_build_object('tip', q.t, 'n', q.k) ORDER BY q.t), '[]'::jsonb) INTO v_rest
      FROM (SELECT coalesce(nullif(CASE WHEN jsonb_typeof(e) = 'object' THEN e ->> 'tip' END, ''), 'necunoscut') AS t, count(*)::int AS k
              FROM jsonb_array_elements(v_lista) e GROUP BY 1) q;
    v_nr := CASE WHEN coalesce(v_rec ->> 'n', '') ~ '^[0-9]{1,9}$' THEN (v_rec ->> 'n')::int ELSE jsonb_array_length(v_lista) END;
    IF v_rd AND v_nr = 0 THEN v_nr := 1; END IF;   -- o stare deschisă fără conflicte numărate (necunoscută) are măcar o restanță
    IF v_rd AND v_rest = '[]'::jsonb THEN v_rest := jsonb_build_array(jsonb_build_object('tip', coalesce(nullif(v_rec ->> 'stare', ''), 'necunoscut'), 'n', 1)); END IF;
    v_la := CASE WHEN public.ofertare_ts_valid(v_rec ->> 'la') THEN v_rec ->> 'la' END;
  END IF;
  IF v_rec IS NOT NULL AND (v_c IS NULL OR (v_c ->> 'inregistrare_id') IS NOT DISTINCT FROM (v_rec ->> 'id')) THEN
    RETURN jsonb_build_object('sursa', 'inregistrare', 'id', v_rec ->> 'id', 'stare', coalesce(nullif(v_rec ->> 'stare', ''), 'necunoscut'),
      'n', v_nr, 'deschis', v_rd, 'in_curs', false, 'la', v_la, 'cod', v_rec ->> 'cod', 'restante', v_rest,
      'confirmat_de', CASE WHEN v_conf THEN v_rec ->> 'confirmat_de' END, 'confirmat_la', CASE WHEN v_conf THEN v_rec ->> 'confirmat_la' END,
      'confirmare_nota', CASE WHEN v_conf THEN v_rec ->> 'confirmare_nota' END, 'confirmare_tip', CASE WHEN v_conf THEN v_rec ->> 'confirmare_tip' END);
  END IF;
  -- RUNDA 9 (verificatorul BD, MAJOR M12 — fereastra migrare → deploy): edge-ul PUBLICAT (v25) rescrie citire_ai la FIECARE rundă, cu un
  -- `sumar` fără `cantitati` până la „gata” și fără să convertească jurnalul vechi => conflictele planșei (ex. Dn60 + adnotările de pe 470)
  -- dispăreau din view la o recitire NETERMINATĂ (stare „nimic”, depunerea trecea — PGlite, copia lui 470). Acum o citire neterminată
  -- (citire_ai.gata = false) FĂRĂ înregistrare de transfer = stare DESCHISĂ „citire neterminată — nu putem verifica” (restanța
  -- 'citire_neterminata'); se închide prin citirea COMPLETĂ (transferul codului nou evaluează tot) sau prin ✋ confirmare. Cu înregistrare,
  -- sursa de adevăr rămâne înregistrarea (codul nou nu mai pierde conflictele pe runde). Producția (SELECT 26.09.2026): 0 documente cu gata = false.
  IF v_rec IS NULL AND v_c IS NULL AND jsonb_typeof(p_analiza -> 'citire_ai') = 'object' AND (p_analiza -> 'citire_ai' ->> 'gata') = 'false' THEN
    RETURN jsonb_build_object('sursa', 'legacy', 'id', 'neterminat:' || md5(coalesce(p_analiza -> 'citire_ai' ->> 'rulare', '') || '|' || coalesce(p_analiza -> 'citire_ai' ->> 'rev', '')),
      'stare', 'citire_neterminata', 'n', 1, 'deschis', true, 'in_curs', false,
      'la', CASE WHEN public.ofertare_ts_valid(p_analiza -> 'citire_ai' ->> 'actualizat') THEN p_analiza -> 'citire_ai' ->> 'actualizat' END,
      'motiv', 'citire a planșei NETERMINATĂ (jurnalul anterior a fost rescris de o citire pe runde încă neîncheiată) — nu putem verifica conflictele transferului; termină citirea sau confirmă explicit',
      'restante', jsonb_build_array(jsonb_build_object('tip', 'citire_neterminata', 'n', 1)));
  END IF;
  IF v_c IS NULL THEN
    RETURN jsonb_build_object('sursa', 'nimic', 'n', 0, 'deschis', false, 'in_curs', false, 'restante', '[]'::jsonb);
  END IF;
  IF v_c ? 'in_curs' THEN
    IF public.ofertare_ts_valid(v_c ->> 'la') AND now() - (v_c ->> 'la')::timestamptz <= interval '10 minutes' THEN
      RETURN jsonb_build_object('sursa', CASE WHEN v_rec IS NULL THEN 'nimic' ELSE 'inregistrare' END, 'id', v_rec ->> 'id', 'stare', 'in_curs',
        'n', coalesce(v_nr, 0), 'deschis', coalesce(v_rd, false), 'in_curs', true, 'la', v_c ->> 'la', 'restante', coalesce(v_rest, '[]'::jsonb));
    END IF;
    RETURN jsonb_build_object('sursa', 'legacy', 'id', 'legacy:' || md5(v_c::text), 'stare', 'neefectuat', 'n', 1, 'deschis', true,
      'in_curs', false, 'la', CASE WHEN public.ofertare_ts_valid(v_c ->> 'la') THEN v_c ->> 'la' END, 'motiv', 'transfer întrerupt (în curs de peste 10 minute)',
      'restante', jsonb_build_array(jsonb_build_object('tip', 'transfer_intrerupt', 'n', 1)));
  END IF;
  -- derivarea legacy — aceleași reguli ca conflicteTransfer (handler.ts) + stareLegacy (transfer_conflicte.ts)
  v_marcaje := coalesce(jsonb_typeof(v_s -> 'identitate_randuri') = 'object', false);   -- NULL (câmp absent) = fără marcaje
  v_nl := CASE WHEN jsonb_typeof(v_s -> 'nr_lipsa') = 'array' THEN jsonb_array_length(v_s -> 'nr_lipsa') ELSE 0 END;
  v_parti := jsonb_build_object(
    'transfer_eroare', CASE WHEN nullif(v_c ->> 'eroare', '') IS NOT NULL THEN 1 ELSE 0 END,
    'transfer_amanat', CASE WHEN nullif(v_c ->> 'amanat', '') IS NOT NULL THEN 1 ELSE 0 END,
    'ambiguu', CASE WHEN jsonb_typeof(v_c -> 'ambigue') = 'array' THEN jsonb_array_length(v_c -> 'ambigue') ELSE 0 END,
    'de_verificat', CASE WHEN jsonb_typeof(v_c -> 'doar_de_verificat') = 'array'
               THEN (SELECT count(*)::int FROM jsonb_array_elements(v_c -> 'doar_de_verificat') e
                      WHERE (CASE WHEN jsonb_typeof(e) = 'object' THEN e ->> 'actiune' END) IS DISTINCT FROM 'ambiguu') ELSE 0 END,
    'total_ambiguu', CASE WHEN jsonb_typeof(v_c -> 'totaluri_multiple') = 'array' AND jsonb_array_length(v_c -> 'totaluri_multiple') > 1 THEN 1 ELSE 0 END,
    'identitate', CASE WHEN (coalesce(v_s ->> 'randuri_fara_identitate_n', '') ~ nr_ AND (v_s ->> 'randuri_fara_identitate_n')::numeric <> 0)
                 OR (jsonb_typeof(v_s -> 'conflicte') = 'array' AND jsonb_array_length(v_s -> 'conflicte') > 0) THEN 1 ELSE 0 END,
    'identitate_incerta', (CASE WHEN jsonb_typeof(v_s -> 'comasari_neconfirmate') = 'array' AND jsonb_array_length(v_s -> 'comasari_neconfirmate') > 0 THEN 1 ELSE 0 END)
                        + (CASE WHEN jsonb_typeof(v_s -> 'perechi_neimperecheate') = 'array' AND jsonb_array_length(v_s -> 'perechi_neimperecheate') > 0 THEN 1 ELSE 0 END),
    'nr_lipsa', least(v_nl, 6) + (CASE WHEN v_nl > 6 THEN 1 ELSE 0 END),
    'nr_fara_lungime', CASE WHEN coalesce(v_s ->> 'nr_fara_lungime_n', '') ~ nr_ AND (v_s ->> 'nr_fara_lungime_n')::numeric > 0 THEN 1 ELSE 0 END,
    'fara_dn', CASE WHEN coalesce(v_s ->> 'tronsoane_fara_dn_n', '') ~ nr_ AND (v_s ->> 'tronsoane_fara_dn_n')::numeric > 0 THEN 1 ELSE 0 END,
    'dn_nestandard', CASE WHEN jsonb_typeof(v_s -> 'diametre_nestandard') = 'array' AND jsonb_array_length(v_s -> 'diametre_nestandard') > 0 THEN 1 ELSE 0 END,
    'adnotari_dn_absent', CASE WHEN jsonb_typeof(v_s -> 'adnotari_diametru_absent') = 'array' AND jsonb_array_length(v_s -> 'adnotari_diametru_absent') > 0 THEN 1 ELSE 0 END);
  SELECT coalesce(sum(v::int), 0)::int INTO v_n FROM jsonb_each_text(v_parti) x(k, v);
  v_stare := CASE WHEN nullif(v_c ->> 'eroare', '') IS NOT NULL OR nullif(v_c ->> 'amanat', '') IS NOT NULL THEN 'neefectuat'
                  WHEN v_n > 0 THEN 'conflicte'
                  WHEN v_c ? 'adaugate' AND v_marcaje THEN 'fara_conflicte'
                  WHEN v_c ? 'adaugate' THEN 'legacy_partial'
                  ELSE 'necunoscut' END;
  -- reparația rundei 1: fără marcajele R5, „fără conflicte” nu e dovedit => restanța 'evaluare_partiala' (nu și la 'neefectuat')
  IF v_stare IN ('conflicte', 'legacy_partial') AND NOT v_marcaje THEN v_parti := v_parti || jsonb_build_object('evaluare_partiala', 1); END IF;
  IF v_stare = 'necunoscut' THEN v_parti := jsonb_build_object('necunoscut', 1); END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('tip', k, 'n', v::int) ORDER BY k) FILTER (WHERE v::int > 0), '[]'::jsonb) INTO v_rest FROM jsonb_each_text(v_parti) x(k, v);
  SELECT coalesce(sum((e ->> 'n')::int), 0)::int INTO v_n FROM jsonb_array_elements(v_rest) e;
  RETURN jsonb_build_object('sursa', 'legacy', 'id', 'legacy:' || md5(v_c::text), 'stare', v_stare,
    'n', v_n, 'deschis', v_stare <> 'fara_conflicte', 'in_curs', false, 'restante', v_rest,
    'la', CASE WHEN public.ofertare_ts_valid(p_analiza -> 'citire_ai' -> 'transfer' ->> 'la') THEN p_analiza -> 'citire_ai' -> 'transfer' ->> 'la' END,
    -- runda 9 (ADDENDUM 3 Copilot, 3): jurnalul vechi = „verificare indisponibilă”, nu contradicție și nu recitire plătită obligatorie
    'motiv', CASE WHEN v_stare = 'legacy_partial' THEN 'verificare indisponibilă (jurnal evaluat de codul vechi: identitatea rândurilor, secvența Nr, TOTAL-ul multiplu și adnotările nu au fost verificate) — incertitudine de verificare, NU o contradicție a documentației; ♻ reevaluare deterministă fără AI pe observațiile salvate sau review uman documentat (✋)' END);
EXCEPTION WHEN others THEN
  -- date corupte: DOAR documentul ăsta e „nu putem verifica” (deschis) — view-ul nu mai cade pe toate licitațiile
  RETURN jsonb_build_object('sursa', 'necunoscut', 'id', 'corupt:' || md5(coalesce(p_analiza -> 'transfer_cantitati', 'null'::jsonb)::text || '|' ||
      coalesce(p_analiza #> '{citire_ai,sumar,cantitati}', 'null'::jsonb)::text), 'stare', 'necunoscut', 'n', 1, 'deschis', true, 'in_curs', false,
    'motiv', 'date corupte în înregistrarea / jurnalul transferului (' || left(SQLERRM, 120) || ') — nu putem verifica; reia citirea planșei',
    'restante', jsonb_build_array(jsonb_build_object('tip', 'necunoscut', 'n', 1)));
END $function$;
REVOKE ALL ON FUNCTION public.ofertare_transfer_stare(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ofertare_transfer_stare(jsonb) TO authenticated, service_role;
COMMENT ON FUNCTION public.ofertare_transfer_stare(jsonb) IS 'R5 sarcina 2 + reparația rundei 1 (26.09.2026): starea conflictelor transferului planșă → cantități a unui document (analiza.transfer_cantitati legat de jurnal, sau derivarea legacy din citire_ai.sumar.cantitati — fără marcajele R5 = legacy_partial DESCHIS), cu restanțele distincte pe tip și confirmarea doar dacă e VALIDĂ (uuid, ISO, tip rezolvat/excepție, notă, token = id). Parsare defensivă: date corupte => necunoscut deschis pe acel document, fără eroare. Folosită de v_ofertare_transfer_conflicte și ofertare_transfer_conflicte_confirma.';

-- 0b) Per document: conflictele transferului (deschise sau nu), cu tokenul pe care îl confirmă omul și restanțele DISTINCTE pe tip
-- (reparația rundei 1: `restante`, `confirmare_tip`, `motiv`; cast-urile sunt pe valori deja validate de ofertare_transfer_stare —
-- un document corupt nu mai poate căde view-ul). security_invoker (RLS-ul documentelor).
CREATE VIEW public.v_ofertare_transfer_conflicte WITH (security_invoker = on) AS
SELECT d.id AS document_id, d.licitatie_id, d.nume_original, d.tip,
       s.x ->> 'sursa' AS sursa, s.x ->> 'id' AS token, s.x ->> 'stare' AS stare, (s.x ->> 'n')::int AS n,
       coalesce((s.x ->> 'deschis')::boolean, true) AS deschis, (s.x ->> 'in_curs')::boolean AS in_curs,   -- NULL => deschis (fail-closed)
       s.x ->> 'la' AS la, s.x ->> 'cod' AS cod,
       (s.x ->> 'confirmat_de')::uuid AS confirmat_de, (s.x ->> 'confirmat_la')::timestamptz AS confirmat_la, s.x ->> 'confirmare_nota' AS confirmare_nota,
       s.x ->> 'confirmare_tip' AS confirmare_tip,
       CASE WHEN s.x ->> 'sursa' = 'inregistrare' AND jsonb_typeof(d.analiza -> 'transfer_cantitati' -> 'conflicte') = 'array'
            THEN d.analiza -> 'transfer_cantitati' -> 'conflicte' END AS conflicte,
       s.x -> 'restante' AS restante,
       s.x ->> 'motiv' AS motiv
  FROM public.ofertare_documente_atribuire d
 CROSS JOIN LATERAL (SELECT public.ofertare_transfer_stare(d.analiza) AS x) s
 WHERE jsonb_typeof(d.analiza) = 'object'
   -- reparația rundei 2 (V-C4): și documentele cu cheile serverului de alt TIP (înregistrare / jurnal corupt) — altfel lipseau din view (0 restanțe)
   AND (d.analiza ? 'transfer_cantitati'
        OR (d.analiza ? 'citire_ai' AND jsonb_typeof(d.analiza -> 'citire_ai') NOT IN ('object', 'null'))
        OR (jsonb_typeof(d.analiza -> 'citire_ai') = 'object' AND (d.analiza -> 'citire_ai') ? 'sumar'
            AND jsonb_typeof(d.analiza -> 'citire_ai' -> 'sumar') NOT IN ('object', 'null'))
        OR (jsonb_typeof(d.analiza -> 'citire_ai' -> 'sumar') = 'object' AND (d.analiza -> 'citire_ai' -> 'sumar') ? 'cantitati')
        -- runda 9 (M12): și citirea NETERMINATĂ (gata = false) — altfel o rundă v25 scotea documentul din view (0 restanțe)
        OR (jsonb_typeof(d.analiza -> 'citire_ai') = 'object' AND (d.analiza -> 'citire_ai' ->> 'gata') = 'false'));
REVOKE ALL ON public.v_ofertare_transfer_conflicte FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_ofertare_transfer_conflicte TO authenticated, service_role;
COMMENT ON VIEW public.v_ofertare_transfer_conflicte IS 'R5 sarcina 2 + reparația rundei 1 (26.09.2026): per document (planșă), conflictele transferului planșă → cantități care nu au (neapărat) produs rânduri — deschis = sursă incompletă până la o recitire care le ACOPERĂ sau o confirmare umană VALIDĂ (ofertare_transfer_conflicte_confirma: rezolvare / excepție justificată, cu drept de decizie). restante = [{tip, n}] distincte (cauza și acțiunea: src/ofertareTransferRestante.js). Citit de poarta graficului, H2 (prin v_ofertare_cantitati_nevalidate), aprobarea finală (trigger-ul pachetului), Documente și generatorul de clarificări. security_invoker.';

-- 0c) Confirmarea umană EXPLICITĂ a conflictelor unui document.
-- REPARAȚIA RUNDEI 1 (ADDENDUM 2 Copilot, „închiderea conflictelor”): „Confirmă conflictele” = REZOLVARE sau EXCEPȚIE JUSTIFICATĂ, nu „am
-- văzut avertismentul”:
--   - legată de conflictul EXACT: tokenul = id-ul înregistrării (rularea) pe care l-a văzut omul — alt token => refuz, nimic scris; se
--     salvează confirmat_token = id; o rulare nouă (recitire) = înregistrare nouă, NECONFIRMATĂ (confirmarea nu acoperă conflicte noi);
--   - tipul: 'rezolvat' (ce s-a verificat / corectat — dovada, min. 5 caractere) sau 'exceptie' (de ce NU afectează cantitatea / soluția
--     ofertată și ce sursă o acoperă — min. 20 de caractere);
--   - actorul: auth.uid() (nu o valoare de la client), cu DREPT DE DECIZIE pe licitație — reutilizează fn_ofertare_source_pack_poate_decide
--     (owner / responsabilul licitației / admin Ofertare; aceeași poartă ca decizia pe „source pack”, cf. „poarta pe cheltuială”), nu
--     simplul acces la modul (înainte: fn_are_acces_ofertare);
--   - NU validează cantități: atinge doar analiza.transfer_cantitati (+ legătura jurnalului la legacy) și citire_ai.rev.
-- Nu șterge nimic: la legacy / date necunoscute creează înregistrarea confirmată (cu restanțele) și o leagă de jurnal; precedenta (dacă era)
-- rămâne în `anterior` / `istoric`. Schimbă citire_ai.rev (ca RPC-ul de transfer), deci orice scriere CAS concurentă pe `analiza`
-- (citire, retăiere, rezervări) recitește și nu suprascrie confirmarea. SECURITY DEFINER (scrie jsonb-ul atomic, sub FOR UPDATE; trece de
-- trigger-ul care păstrează cheile serverului — rulează ca proprietarul), cu verificarea dreptului în corp. Nu citește conținut extern,
-- nu trimite nimic.
DROP FUNCTION IF EXISTS public.ofertare_transfer_conflicte_confirma(bigint, text, text);
CREATE OR REPLACE FUNCTION public.ofertare_transfer_conflicte_confirma(p_doc_id bigint, p_token text, p_tip text, p_nota text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_an jsonb; v_lic bigint; v_st jsonb; v_rec jsonb; v_prev jsonb; v_min int;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('error', 'fără sesiune'); END IF;
  IF coalesce(p_tip, '') NOT IN ('rezolvat', 'exceptie') THEN
    RETURN jsonb_build_object('error', 'alege: „rezolvat” (ai verificat / corectat — spune ce) sau „excepție justificată” (de ce nu afectează oferta)');
  END IF;
  v_min := CASE WHEN p_tip = 'exceptie' THEN 20 ELSE 5 END;
  IF length(coalesce(btrim(p_nota), '')) < v_min THEN
    RETURN jsonb_build_object('error', CASE WHEN p_tip = 'exceptie'
      THEN 'excepția cere justificare (min. 20 de caractere): de ce conflictul NU afectează cantitatea / soluția ofertată și ce sursă o acoperă'
      ELSE 'scrie ce ai verificat / corectat (min. 5 caractere) — dovada rezolvării' END);
  END IF;
  SELECT analiza, licitatie_id INTO v_an, v_lic FROM public.ofertare_documente_atribuire WHERE id = p_doc_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'document inexistent'); END IF;
  IF NOT public.fn_ofertare_source_pack_poate_decide(v_lic) THEN
    RETURN jsonb_build_object('error', 'confirmarea conflictelor e o decizie: doar ownerul, responsabilul licitației sau un admin Ofertare');
  END IF;
  v_st := public.ofertare_transfer_stare(v_an);
  IF coalesce((v_st ->> 'in_curs')::boolean, false) THEN
    RETURN jsonb_build_object('error', 'transferul e în curs — reîncearcă după ce se termină');
  END IF;
  IF NOT coalesce((v_st ->> 'deschis')::boolean, false) THEN
    RETURN jsonb_build_object('error', 'nu există conflicte deschise pe document (s-au închis între timp?) — reîncarcă');
  END IF;
  IF (v_st ->> 'id') IS DISTINCT FROM p_token THEN
    RETURN jsonb_build_object('error', 'conflictele documentului s-au schimbat între timp (altă citire / alt transfer) — reîncarcă și verifică din nou');
  END IF;
  IF v_st ->> 'sursa' = 'inregistrare' THEN
    v_rec := (v_an -> 'transfer_cantitati') || jsonb_build_object('confirmat_de', auth.uid(), 'confirmat_la', now(), 'confirmare_nota', btrim(p_nota),
      'confirmare_tip', p_tip, 'confirmat_token', v_an -> 'transfer_cantitati' -> 'id');
  ELSE
    -- legacy / date necunoscute: înregistrarea confirmată se creează acum, cu restanțele văzute; precedenta (dacă era) rămâne în `anterior` / `istoric`
    v_prev := CASE WHEN jsonb_typeof(v_an -> 'transfer_cantitati') = 'object' THEN v_an -> 'transfer_cantitati' END;
    v_rec := jsonb_build_object('v', 2, 'id', p_token, 'sursa', v_st ->> 'sursa', 'la', now(), 'stare', v_st ->> 'stare', 'n', (v_st ->> 'n')::int,
      'conflicte', (SELECT coalesce(jsonb_agg(jsonb_build_object('tip', e ->> 'tip', 'n', (e ->> 'n')::int, 'text', 'restanță „' || (e ->> 'tip') || '” (' || (e ->> 'n') || ') din jurnal — confirmată de om')), '[]'::jsonb)
                    FROM jsonb_array_elements(coalesce(v_st -> 'restante', '[]'::jsonb)) e),
      'motiv', v_st ->> 'motiv', 'confirmat_de', auth.uid(), 'confirmat_la', now(), 'confirmare_nota', btrim(p_nota),
      'confirmare_tip', p_tip, 'confirmat_token', p_token,
      'anterior', CASE WHEN v_prev IS NULL THEN NULL ELSE v_prev - 'anterior' - 'istoric' END,
      'istoric', CASE WHEN v_prev IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(jsonb_build_object('id', v_prev -> 'id', 'la', v_prev -> 'la',
        'stare', v_prev -> 'stare', 'n', v_prev -> 'n', 'confirmat_de', v_prev -> 'confirmat_de', 'confirmat_la', v_prev -> 'confirmat_la',
        'confirmare_nota', v_prev -> 'confirmare_nota')) || coalesce(CASE WHEN jsonb_typeof(v_prev -> 'istoric') = 'array' THEN v_prev -> 'istoric' END, '[]'::jsonb) END);
    IF jsonb_typeof(v_an -> 'citire_ai' -> 'sumar' -> 'cantitati') = 'object' THEN
      v_an := jsonb_set(v_an, '{citire_ai,sumar,cantitati,inregistrare_id}', to_jsonb(p_token), true);
    END IF;
  END IF;
  v_an := jsonb_set(v_an, '{transfer_cantitati}', v_rec, true);
  IF jsonb_typeof(v_an -> 'citire_ai') = 'object' THEN
    v_an := jsonb_set(v_an, '{citire_ai,rev}', to_jsonb(gen_random_uuid()::text), true);
  END IF;
  UPDATE public.ofertare_documente_atribuire SET analiza = v_an WHERE id = p_doc_id;
  RETURN jsonb_build_object('ok', true, 'document_id', p_doc_id, 'licitatie_id', v_lic, 'token', p_token, 'tip', p_tip);
END $function$;
REVOKE ALL ON FUNCTION public.ofertare_transfer_conflicte_confirma(bigint, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ofertare_transfer_conflicte_confirma(bigint, text, text, text) TO authenticated, service_role;
COMMENT ON FUNCTION public.ofertare_transfer_conflicte_confirma(bigint, text, text, text) IS 'R5 sarcina 2 + reparația rundei 1 (26.09.2026): confirmarea umană a conflictelor transferului planșă → cantități ale unui document = REZOLVARE sau EXCEPȚIE JUSTIFICATĂ (p_tip rezolvat / exceptie, notă min. 5 / 20), legată de înregistrarea exactă (token = id, salvat în confirmat_token; o rulare nouă nu e acoperită), autor = auth.uid() cu drept de DECIZIE (fn_ofertare_source_pack_poate_decide: owner / responsabil / admin Ofertare). Nu validează cantități, nu șterge conflictele.';

-- 0d) REPARAȚIA RUNDEI 1 (verificatorii, minorii „confirmarea se poate falsifica fără funcție” / „confirmat_la oarecare”): politica UPDATE
-- a documentelor (fn_are_acces_ofertare) lasă orice utilizator Ofertare să scrie `analiza` DIRECT (PostgREST) — deci să pună un
-- `confirmat_la` / `confirmat_de` arbitrar în transfer_cantitati sau să rescrie jurnalul citire_ai (ex. „adaugate” + marcajele R5 ca un
-- legacy să pară curat). Cheile SERVERULUI — analiza.transfer_cantitati și analiza.citire_ai — le scriu doar: edge-ul
-- ofertare-plansa-citeste și /api (service_role) și funcțiile SECURITY DEFINER (ofertare_transfer_conflicte_confirma, RPC-ul de
-- transfer). La o scriere directă a unui utilizator (current_user authenticated / anon), trigger-ul PĂSTREAZĂ valorile din BD pentru
-- aceste două chei (restul `analiza` se scrie normal) — nicio scriere legitimă a UI-ului nu le atinge (UI-ul nu scrie `analiza`; verificat
-- în cod: src/, 26.09.2026), iar o copie veche a lor nu mai poate suprascrie o înregistrare mai nouă. SECURITY INVOKER intenționat:
-- trebuie să vadă rolul APELANTULUI (current_user); într-o funcție SECURITY DEFINER apelată de utilizator, current_user = proprietarul,
-- deci confirmarea prin funcție trece.
CREATE OR REPLACE FUNCTION public.fn_trg_ofertare_doc_chei_server()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v jsonb;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN RETURN NEW; END IF;
  v := CASE WHEN jsonb_typeof(NEW.analiza) = 'object' THEN NEW.analiza ELSE '{}'::jsonb END - 'transfer_cantitati' - 'citire_ai';
  IF TG_OP = 'UPDATE' AND jsonb_typeof(OLD.analiza) = 'object' THEN
    IF OLD.analiza ? 'transfer_cantitati' THEN v := v || jsonb_build_object('transfer_cantitati', OLD.analiza -> 'transfer_cantitati'); END IF;
    IF OLD.analiza ? 'citire_ai' THEN v := v || jsonb_build_object('citire_ai', OLD.analiza -> 'citire_ai'); END IF;
  END IF;
  IF (TG_OP = 'INSERT' AND jsonb_typeof(NEW.analiza) = 'object' AND (NEW.analiza ? 'transfer_cantitati' OR NEW.analiza ? 'citire_ai'))
     OR (TG_OP = 'UPDATE' AND ((NEW.analiza -> 'transfer_cantitati') IS DISTINCT FROM (OLD.analiza -> 'transfer_cantitati')
                            OR (NEW.analiza -> 'citire_ai') IS DISTINCT FROM (OLD.analiza -> 'citire_ai'))) THEN
    NEW.analiza := v;
  END IF;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.fn_trg_ofertare_doc_chei_server() FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.fn_trg_ofertare_doc_chei_server() IS 'R5 reparația rundei 1 (26.09.2026): la o scriere DIRECTĂ a unui utilizator (authenticated / anon) pe ofertare_documente_atribuire, cheile serverului analiza.transfer_cantitati și analiza.citire_ai păstrează valorile din BD (confirmarea conflictelor doar prin ofertare_transfer_conflicte_confirma; jurnalul doar de edge / service_role). SECURITY INVOKER intenționat (vede rolul apelantului).';
DROP TRIGGER IF EXISTS trg_ofertare_doc_chei_server ON public.ofertare_documente_atribuire;
CREATE TRIGGER trg_ofertare_doc_chei_server BEFORE INSERT OR UPDATE OF analiza ON public.ofertare_documente_atribuire
  FOR EACH ROW EXECUTE FUNCTION public.fn_trg_ofertare_doc_chei_server();

-- 0e) REPARAȚIA RUNDEI 2 (verificatorul BD, minorul C8): un editor Ofertare FĂRĂ drept de decizie scotea conflicte DESCHISE din poartă fără
-- urmă — ștergând documentul (politica DELETE = fn_are_acces_ofertare) sau mutându-l pe altă licitație (UPDATE licitatie_id); trigger-ul
-- cheilor păzește doar `analiza`. Acum, la o scriere DIRECTĂ a unui utilizator (authenticated / anon), ștergerea / mutarea unui document cu
-- restanțe de transfer deschise (sau cu transfer în curs) cere dreptul de DECIZIE pe licitația de pe care pleacă (fn_ofertare_source_pack_
-- poate_decide: owner / responsabil / admin Ofertare) — același drept ca la confirmarea conflictelor. Serverul (service_role), funcțiile
-- DEFINER și ștergerea în cascadă a licitației (rulează ca proprietarul tabelului) trec. Niciun ecran nu șterge / mută azi documente
-- (verificat în src/ la 26.09.2026) — trigger-ul închide calea directă (PostgREST). SECURITY INVOKER intenționat (vede rolul apelantului).
CREATE OR REPLACE FUNCTION public.fn_trg_ofertare_doc_conflict_pastrat()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_st jsonb;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.licitatie_id IS NOT DISTINCT FROM OLD.licitatie_id THEN RETURN NEW; END IF;
  END IF;
  v_st := public.ofertare_transfer_stare(OLD.analiza);
  IF (coalesce((v_st ->> 'deschis')::boolean, true) OR coalesce((v_st ->> 'in_curs')::boolean, false))
     AND NOT coalesce(public.fn_ofertare_source_pack_poate_decide(OLD.licitatie_id), false) THEN
    RAISE EXCEPTION 'Documentul „%” are restanțe DESCHISE la transferul din planșă (%): % lui ar scoate conflictele din poarta licitației #% fără rezolvare. Rezolvă-le (recitire) sau confirmă-le în Documente (✋ rezolvare / excepție justificată) — ori cere-o ownerului / responsabilului licitației / unui admin Ofertare.',
      coalesce(OLD.nume_original, '#' || OLD.id), coalesce(v_st ->> 'n', '?') || ' restanțe', CASE WHEN TG_OP = 'DELETE' THEN 'ștergerea' ELSE 'mutarea' END, OLD.licitatie_id
      USING ERRCODE = 'P0001';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $function$;
REVOKE ALL ON FUNCTION public.fn_trg_ofertare_doc_conflict_pastrat() FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.fn_trg_ofertare_doc_conflict_pastrat() IS 'R5 reparația rundei 2 (26.09.2026): o ștergere / mutare pe altă licitație, DIRECTĂ (authenticated / anon), a unui document cu restanțe de transfer deschise cere dreptul de decizie pe licitație (fn_ofertare_source_pack_poate_decide) — conflictul nu mai iese din poartă fără rezolvare. SECURITY INVOKER intenționat.';
DROP TRIGGER IF EXISTS trg_ofertare_doc_conflict_pastrat ON public.ofertare_documente_atribuire;
CREATE TRIGGER trg_ofertare_doc_conflict_pastrat BEFORE DELETE OR UPDATE OF licitatie_id ON public.ofertare_documente_atribuire
  FOR EACH ROW EXECUTE FUNCTION public.fn_trg_ofertare_doc_conflict_pastrat();

-- 0f) REPARAȚIA RUNDEI 2 (verificatorul BD, minorul C9b — „fereastra fără import CAD e doar o regulă verbală”): cad-parse PUBLICAT (main,
-- api/cad-parse.js) scrie cu service_role rânduri cu status 'validat' — insert direct 'validat', iar pe un rând existent (chiar 'diferenta')
-- îl RE-VALIDEAZĂ cu valoarea mașinii (istoricul înregistra 'validat'). R5: 'validat' = bifa ✓ a unui OM. Un proces al serverului
-- (current_user = service_role: /api, edge-urile, workerul) NU mai poate pune un rând în 'validat': la INSERT rândul intră 'extras', la
-- UPDATE își păstrează statusul (extras / diferenta / revizuit_clarificare); scrierea în rest trece (nimic nu se pierde), cu nota spusă.
-- Pe un rând DEJA validat decide regula aprobării (trigger-ul trg_zz_…, după acesta: cifra / atributele schimbate => 'diferenta').
-- Suspendă EFECTIV doar partea afectată a importului CAD publicat, între aplicarea migrării și deploy (Copilot, pct. 3: „suspendă doar
-- transferurile automate afectate”); codul ramurii nu scrie 'validat' din server (cad-parse: 'extras'; transferul din planșă: prin RPC
-- DEFINER, 'extras' / 'diferenta'), deci trigger-ul rămâne și după deploy, ca invariant. Omul (authenticated, ✓ din 📋 Cantități) și SQL-ul
-- rulat de proprietar (postgres, cu GO) validează normal. SECURITY INVOKER intenționat (vede rolul apelantului).
CREATE OR REPLACE FUNCTION public.fn_trg_ofertare_cantitati_doar_om_valideaza()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_rol text;
BEGIN
  -- runda 9 (verificatorul BD, minor M7): RPC-ul DEFINER ofertare_transfer_plansa_cantitati (EXECUTE doar service_role) rulează ca proprietarul
  -- (current_user = postgres), deci un `status: 'validat'` din payload ocolea regula. Acum contează ȘI rolul din JWT (request.jwt.claims.role,
  -- ca v_rol din trigger-ul aprobării, 1b): un apel al serverului prin orice funcție DEFINER rămâne „server”. Omul (JWT authenticated) și
  -- SQL-ul proprietarului (fără JWT) nu sunt atinși.
  BEGIN v_rol := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
  EXCEPTION WHEN others THEN v_rol := NULL; END;
  IF (current_user = 'service_role' OR coalesce(v_rol, '') = 'service_role') AND NEW.status = 'validat' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'validat') THEN
    NEW.status := CASE WHEN TG_OP = 'INSERT' THEN 'extras' ELSE OLD.status END;
    NEW.diferenta_nota := 'Scriere automată: „validat” cerut de un proces al serverului a fost refuzat — doar bifa ✓ a unui om validează (R5); rândul a rămas „'
      || NEW.status || '”. ' || coalesce(NEW.diferenta_nota, '');
  END IF;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.fn_trg_ofertare_cantitati_doar_om_valideaza() FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.fn_trg_ofertare_cantitati_doar_om_valideaza() IS 'R5 reparația rundei 2 (26.09.2026): un proces al serverului (service_role) nu poate pune un rând de cantități în „validat” (INSERT => extras; UPDATE => statusul vechi, cu notă) — doar bifa unui om validează. Închide fereastra importului CAD publicat (scria validat). SECURITY INVOKER intenționat.';
DROP TRIGGER IF EXISTS trg_ofertare_cantitati_doar_om_valideaza ON public.ofertare_cantitati;
-- numele sortează ÎNAINTE de trg_zz_ofertare_cantitati_aprobare (trigger-ele BEFORE rulează alfabetic): regula aprobării vede statusul corectat
CREATE TRIGGER trg_ofertare_cantitati_doar_om_valideaza BEFORE INSERT OR UPDATE OF status ON public.ofertare_cantitati
  FOR EACH ROW EXECUTE FUNCTION public.fn_trg_ofertare_cantitati_doar_om_valideaza();

-- 1, continuare ─────────────────────────────────────────────────────────────────────────────────────────
-- v_ofertare_cantitati_nevalidate (comentariile de la „1)” de mai sus + cele de mai jos)
-- Sarcina 2 (d) — UNITĂȚI: coloanele *_m ale grupurilor din AFARA rețelei (invalidate ieșite, TOTAL invalidate, unitate schimbată) însumau
-- cantități în unități diferite (700 ml + 3 buc = „703 m”). Acum *_m = DOAR rândurile cu unitatea normalizată „m”, iar *_pe_um (jsonb)
-- dă defalcarea pe unitate {um: {suma, randuri, fara_cantitate}} — mesajele le grupează pe lungimi / suprafețe / volume / bucăți / alte
-- unități + poziții fără cantitate (JS: textCantitatiPeUnitati). *_fara_cant = rândurile fără cantitate determinată (nu „0 m”).
-- Sarcina 2 (a): transfer_conflicte_* = documentele cu conflicte DESCHISE (v_ofertare_transfer_conflicte); licitația apare în view și
-- când nu are niciun rând de cantități (lista `lic`; până în runda 1: FULL JOIN) — „nimic scris ≠ nicio problemă”.
-- Reparația rundei 2 (verificatorii rundei 1):
--  - rândurile de rețea FĂRĂ cantitate pe ORICE status (lista_f3_fara_cant, retea_fara_cant) și, separat, cele VALIDATE fără cantitate
--    (lista_f3_validate_fara_cant, retea_validate_fara_cant): „validat” fără cifră nu e o cantitate aprobată — totalul F3 e parțial (H2 BLOCK,
--    v6 fără total). Înainte, doar rândurile nevalidate fără cantitate erau numărate;
--  - rândurile de rețea (categorie conductă / rețea, fără „total”) în ALTE unități decât m — „sute m”, „mc”, „ml”, fără unitate
--    (retea_alte_unitati, _f3, _pe_um): în afara comparației F3 ↔ grafic, numite, FĂRĂ conversie (lic. 5 reală: 12 F3 în „sute m”, 11 F3 în
--    „mc”); cele deja numărate ca invalidate / unitate schimbată NU se repetă aici;
--  - rândurile APROBATE ȘTERSE (istoricul: motiv 'sters' — trigger-ul îl scrie DOAR pentru un rând 'validat'): sterse_dupa_validare, _retea,
--    _pe_um, _ultima (momentul ultimei ștergeri), _lista (ultimele 20: cantitate_id, la, um, cantitate, denumire, retea) — consumatorii
--    (H2, poarta graficului) le arată „de reverificat” până la o versiune nouă a graficului generată după ștergere;
--  - licitațiile apar dacă au rânduri (de rețea / invalidate / în alte unități), conflicte de transfer deschise / în curs SAU ștergeri de
--    rânduri aprobate (lista `lic`).
-- R9b: singura clasificare SQL; paritate cu src/ofertareUnitati.js.
CREATE OR REPLACE FUNCTION public.ofertare_clasa_unitate(p_um text)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN u IN ('m','m.','metri','metru','ml','ml.','m.l.','m.l','metri liniari','metru liniar') THEN jsonb_build_object('tip','lungime','factor',1)
    WHEN u = 'km' THEN jsonb_build_object('tip','lungime','factor',1000)
    WHEN u = 'hm' THEN jsonb_build_object('tip','lungime','factor',100)
    WHEN u IN ('mc','m cub','m3','m³','mp','m2','m²','ha','l','litri','buc','bucata','bucati','bucăți','buc.','bc','kg','t','to','h','ore','set','cpl') THEN jsonb_build_object('tip','alta')
    ELSE jsonb_build_object('tip','de_verificat') END
  FROM (SELECT public.ofertare_norm_text(p_um) u) n
$function$;
REVOKE ALL ON FUNCTION public.ofertare_clasa_unitate(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ofertare_clasa_unitate(text) TO authenticated, service_role;

-- TOTAL separat de detalii. Perimetrul nu se reconstruiește din text liber.
CREATE OR REPLACE FUNCTION public.ofertare_totaluri_control(p_licitatie_id bigint, p_baza text DEFAULT 'cantitate')
RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'public', 'pg_temp'
AS $function$
WITH r AS (
 SELECT q.id, q.status, q.obiect, q.sursa,
   public.ofertare_norm_text(q.obiect) o, public.ofertare_norm_text(q.sursa) s,
   public.ofertare_norm_text(q.categorie) k, public.ofertare_norm_text(q.tip_sursa) ts,
   public.ofertare_norm_text(q.um) um, public.ofertare_clasa_unitate(q.um) u,
   CASE p_baza WHEN 'cantitate' THEN q.cantitate WHEN 'cantitate_plansa' THEN q.cantitate_plansa END v,
   (coalesce(q.obiect,'') || ' ' || coalesce(q.denumire,'') || ' ' || coalesce(q.sursa,'')) ~* 'total' tot
 FROM public.ofertare_cantitati q WHERE q.licitatie_id = p_licitatie_id
), t AS (
 SELECT r.*, a.n, a.nt, a.complet, a.suma,
   r.v * coalesce((r.u->>'factor')::numeric,1) declarat
 FROM r CROSS JOIN LATERAL (
   SELECT count(*) FILTER (WHERE NOT d.tot) n, count(*) FILTER (WHERE d.tot) nt,
     bool_and(d.status IS NOT DISTINCT FROM 'validat' AND d.v IS NOT NULL AND d.u->>'tip' = r.u->>'tip'
       AND (r.u->>'tip' = 'lungime' OR (r.u->>'tip' = 'alta' AND d.um = r.um))) FILTER (WHERE NOT d.tot) complet,
     sum(d.v * coalesce((d.u->>'factor')::numeric,1)) FILTER (WHERE NOT d.tot AND d.status = 'validat'
       AND d.u->>'tip' = r.u->>'tip' AND (r.u->>'tip' = 'lungime' OR (r.u->>'tip' = 'alta' AND d.um = r.um))) suma
   FROM r d WHERE (d.o,d.s,d.k,d.ts) IS NOT DISTINCT FROM (r.o,r.s,r.k,r.ts)
 ) a WHERE r.tot
), e AS (
 SELECT t.*, CASE WHEN coalesce(o,'') = '' OR coalesce(s,'') = '' OR coalesce(ts,'') = ''
   OR n = 0 OR nt <> 1 OR NOT coalesce(complet,false) OR status IS DISTINCT FROM 'validat' OR v IS NULL OR u->>'tip' = 'de_verificat'
   THEN 'necomparabil' WHEN round(declarat,6) IS DISTINCT FROM round(suma,6) THEN 'diferit' ELSE 'ok' END stare FROM t
)
SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'baza',p_baza,'obiect',obiect,'sursa',sursa,
 'declarat',declarat,'suma_detalii',suma,'um',CASE WHEN u->>'tip' = 'lungime' THEN 'm' ELSE um END,
 'stare',stare,'text',CASE stare WHEN 'necomparabil' THEN 'Totalul declarat nu poate fi verificat din detaliile disponibile.'
 WHEN 'diferit' THEN 'Totalul declarat diferă de suma detaliilor validate.' ELSE '' END) ORDER BY id),'[]'::jsonb) FROM e
$function$;
REVOKE ALL ON FUNCTION public.ofertare_totaluri_control(bigint,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ofertare_totaluri_control(bigint,text) TO authenticated, service_role;

CREATE VIEW public.v_ofertare_cantitati_nevalidate WITH (security_invoker = on) AS
WITH ist AS (
  SELECT DISTINCT ON (h.cantitate_id) h.cantitate_id, h.motiv
    FROM public.ofertare_cantitati_istoric h
   WHERE h.motiv <> 'unitate_schimbata'
   ORDER BY h.cantitate_id, h.id DESC
), ium AS (
  SELECT DISTINCT ON (h.cantitate_id) h.cantitate_id, h.motiv
    FROM public.ofertare_cantitati_istoric h
   WHERE h.motiv IN ('validat', 'unitate_schimbata')
   ORDER BY h.cantitate_id, h.id DESC
), b0 AS (
  SELECT q.licitatie_id, q.tip_sursa, q.status, q.cantitate * coalesce((public.ofertare_clasa_unitate(q.um)->>'factor')::numeric,1) AS cantitate, q.cantitate AS cantitate_originala, q.um, coalesce(public.ofertare_norm_text(q.um), '') AS um_norm,
         -- filtrul qm din v_ofertare_pt_stare, cu unitatea NORMALIZATĂ (runda 6); coalesce: categorie NULL = în afara rețelei
         coalesce(public.ofertare_clasa_unitate(q.um)->>'tip' = 'lungime' AND q.categorie ~* 'conduct|re[țt]ea'::text
           AND ((((COALESCE(q.obiect, ''::text) || ' '::text) || COALESCE(q.denumire, ''::text)) || ' '::text) || COALESCE(q.sursa, ''::text)) !~* 'total'::text, false) AS in_retea,
         coalesce(q.categorie ~* 'conduct|re[țt]ea'::text, false) AS cat_retea,
         -- runda 9 (M1 / M3): clasa „lungimi” (m, ml, km, sute m + sinonimele exacte: m. / metri / metru, m.l. / ml.) SAU fără unitate — aceeași
         -- definiție ca umAfisata + clasaUnitate din src/ofertareCantitatiAprobare.js (lungimi / fara_unitate); testul de paritate JS ↔ view o păzește
         public.ofertare_clasa_unitate(q.um)->>'tip' = 'de_verificat' AS um_lungime,
         ((((COALESCE(q.obiect, ''::text) || ' '::text) || COALESCE(q.denumire, ''::text)) || ' '::text) || COALESCE(q.sursa, ''::text)) ~* 'total'::text AS e_total,
         q.status IS DISTINCT FROM 'validat' AND ((coalesce(q.diferenta_nota, '') LIKE 'Rândul era VALIDAT%' AND strpos(q.diferenta_nota, 'validarea se reface.') > 0)
           OR coalesce(i.motiv IN ('invalidat', 'redeschis'), false)) AS invalidat,
         q.status IS DISTINCT FROM 'validat' AND ((strpos(coalesce(q.diferenta_nota, ''), 'Unitatea s-a schimbat') = 1 AND strpos(q.diferenta_nota, 'de reverificat.') > 0)
           OR coalesce(u.motiv = 'unitate_schimbata', false)) AS unitate
    FROM public.ofertare_cantitati q
    LEFT JOIN ist i ON i.cantitate_id = q.id
    LEFT JOIN ium u ON u.cantitate_id = q.id
), b1 AS (
  SELECT b0.*, (NOT in_retea AND unitate AND NOT invalidat AND NOT e_total) AS unitate_iesit,
         CASE WHEN NOT in_retea AND invalidat AND NOT e_total THEN 'inv'
              WHEN e_total AND invalidat THEN 'tot'
              WHEN NOT in_retea AND unitate AND NOT invalidat AND NOT e_total THEN 'us' END AS grup_afara
    FROM b0
), b AS (
  -- reparația rundei 2: rețea în ALTE unități (categoria de rețea, fără „total”, unitatea normalizată ≠ m), dacă nu e deja în alt grup
  SELECT b1.*, (cat_retea AND NOT e_total AND NOT in_retea AND grup_afara IS NULL) AS alte_um
    FROM b1
), agg AS (
  SELECT b.licitatie_id,
       count(*) FILTER (WHERE in_retea AND tip_sursa = 'lista_f3' AND status IS DISTINCT FROM 'validat')                  AS lista_f3_nevalidate,
       round(sum(cantitate) FILTER (WHERE in_retea AND tip_sursa = 'lista_f3' AND status IS DISTINCT FROM 'validat'), 6)   AS lista_f3_nevalidate_m,
       count(*) FILTER (WHERE in_retea AND tip_sursa = 'lista_c6' AND status IS DISTINCT FROM 'validat')                  AS lista_c6_nevalidate,
       count(*) FILTER (WHERE in_retea AND tip_sursa = 'memoriu'  AND status IS DISTINCT FROM 'validat')                  AS memoriu_nevalidate,
       count(*) FILTER (WHERE in_retea AND tip_sursa = 'plansa'   AND status IS DISTINCT FROM 'validat')                  AS plansa_nevalidate,
       count(*) FILTER (WHERE in_retea AND tip_sursa IS NULL      AND status IS DISTINCT FROM 'validat')                  AS fara_tip_nevalidate,
       round(sum(cantitate) FILTER (WHERE in_retea AND tip_sursa IS NULL AND status IS DISTINCT FROM 'validat'), 6)        AS fara_tip_nevalidate_m,
       count(*) FILTER (WHERE in_retea AND status IS DISTINCT FROM 'validat')                                              AS retea_nevalidate,
       round(sum(cantitate) FILTER (WHERE in_retea AND status IS DISTINCT FROM 'validat'), 6)                                AS retea_nevalidate_m,
       count(*) FILTER (WHERE in_retea)                                                                      AS retea_randuri,
       count(*) FILTER (WHERE grup_afara = 'inv')                                                            AS invalidate_in_afara_retea,
       round(sum(cantitate) FILTER (WHERE grup_afara = 'inv' AND um_norm = 'm'), 6)                            AS invalidate_in_afara_retea_m,
       count(*) FILTER (WHERE grup_afara = 'tot')                                                            AS total_invalidate,
       round(sum(cantitate) FILTER (WHERE grup_afara = 'tot' AND um_norm = 'm'), 6)                            AS total_invalidate_m,
       count(*) FILTER (WHERE grup_afara = 'us')                                                             AS unitate_schimbata_in_afara_retea,
       round(sum(cantitate) FILTER (WHERE grup_afara = 'us' AND um_norm = 'm'), 6)                             AS unitate_schimbata_in_afara_retea_m,
       count(*) FILTER (WHERE in_retea AND um IS DISTINCT FROM 'm')                                          AS um_de_normalizat,
       round(sum(cantitate) FILTER (WHERE in_retea AND um IS DISTINCT FROM 'm'), 6)                            AS um_de_normalizat_m,
       count(*) FILTER (WHERE in_retea AND um IS DISTINCT FROM 'm' AND tip_sursa = 'lista_f3')              AS um_de_normalizat_f3,
       count(*) FILTER (WHERE in_retea AND tip_sursa = 'lista_f3' AND status IS DISTINCT FROM 'validat' AND cantitate IS NULL) AS lista_f3_nevalidate_fara_cant,
       count(*) FILTER (WHERE in_retea AND tip_sursa IS NULL AND status IS DISTINCT FROM 'validat' AND cantitate IS NULL)      AS fara_tip_nevalidate_fara_cant,
       count(*) FILTER (WHERE in_retea AND um IS DISTINCT FROM 'm' AND cantitate IS NULL)                        AS um_de_normalizat_fara_cant,
       -- reparația rundei 2: fără cantitate pe ORICE status + cele VALIDATE fără cantitate
       count(*) FILTER (WHERE in_retea AND tip_sursa = 'lista_f3' AND cantitate IS NULL)                         AS lista_f3_fara_cant,
       count(*) FILTER (WHERE in_retea AND cantitate IS NULL)                                                     AS retea_fara_cant,
       count(*) FILTER (WHERE in_retea AND tip_sursa = 'lista_f3' AND status = 'validat' AND cantitate IS NULL)  AS lista_f3_validate_fara_cant,
       count(*) FILTER (WHERE in_retea AND status = 'validat' AND cantitate IS NULL)                             AS retea_validate_fara_cant,
       count(*) FILTER (WHERE alte_um)                                                                           AS retea_alte_unitati,
       count(*) FILTER (WHERE alte_um AND tip_sursa = 'lista_f3')                                                AS retea_alte_unitati_f3,
       -- runda 9 (M1 / M3): dintre ele, cele de LUNGIME în altă unitate (ml, km, sute m) sau FĂRĂ unitate — pot fi tronsoane de conductă
       -- scoase din orice sumă în m: poarta graficului le cere validate (BLOCK cât sunt nevalidate), H2 blochează F3 când sunt în F3, v6 nu
       -- citează suma F3; restul (mc, mp, buc, ore) = poziții de deviz în alte unități, NUMITE (nu sunt lungimi de conductă)
       count(*) FILTER (WHERE alte_um AND um_lungime)                                                             AS retea_alte_unitati_lungimi,
       count(*) FILTER (WHERE alte_um AND um_lungime AND tip_sursa = 'lista_f3')                                  AS retea_alte_unitati_lungimi_f3,
       count(*) FILTER (WHERE alte_um AND um_lungime AND status IS DISTINCT FROM 'validat')                                     AS retea_alte_unitati_lungimi_nevalidate
  FROM b
 GROUP BY b.licitatie_id
HAVING count(*) FILTER (WHERE in_retea OR invalidat OR unitate_iesit OR alte_um OR e_total OR um_lungime) > 0
), pu AS (
  SELECT b.licitatie_id, coalesce(b.grup_afara, 'au') AS grup, b.um_norm, sum(b.cantitate_originala) AS suma, count(*) AS randuri, count(*) FILTER (WHERE b.cantitate IS NULL) AS fara_cant
    FROM b WHERE b.grup_afara IS NOT NULL OR b.alte_um GROUP BY 1, 2, 3
), pj AS (
  SELECT pu.licitatie_id,
         jsonb_object_agg(pu.um_norm, jsonb_build_object('suma', pu.suma, 'randuri', pu.randuri, 'fara_cantitate', pu.fara_cant)) FILTER (WHERE pu.grup = 'inv') AS inv,
         jsonb_object_agg(pu.um_norm, jsonb_build_object('suma', pu.suma, 'randuri', pu.randuri, 'fara_cantitate', pu.fara_cant)) FILTER (WHERE pu.grup = 'tot') AS tot,
         jsonb_object_agg(pu.um_norm, jsonb_build_object('suma', pu.suma, 'randuri', pu.randuri, 'fara_cantitate', pu.fara_cant)) FILTER (WHERE pu.grup = 'us') AS us,
         jsonb_object_agg(pu.um_norm, jsonb_build_object('suma', pu.suma, 'randuri', pu.randuri, 'fara_cantitate', pu.fara_cant)) FILTER (WHERE pu.grup = 'au') AS au
    FROM pu GROUP BY pu.licitatie_id
), tcd AS (
  SELECT c.licitatie_id, c.document_id, c.nume_original, c.n, c.deschis, c.in_curs, c.restante FROM public.v_ofertare_transfer_conflicte c
), tc AS (
  SELECT c.licitatie_id,
         count(*) FILTER (WHERE c.deschis)                                                                   AS docs,
         coalesce(sum(c.n) FILTER (WHERE c.deschis), 0)                                                      AS n,
         count(*) FILTER (WHERE c.in_curs)                                                                   AS in_curs,
         (array_agg(left(regexp_replace(coalesce(c.nume_original, '#' || c.document_id), '^.*/', ''), 80) || ' (' || c.n || ')'
            ORDER BY c.document_id) FILTER (WHERE c.deschis))[1:5]                                            AS lista
    FROM tcd c
   GROUP BY c.licitatie_id
), tcr AS (
  -- reparația rundei 1 (ADDENDUM 2 Copilot, b): restanțele DISTINCTE pe licitație {tip: n} (doar documentele deschise)
  SELECT r.licitatie_id, jsonb_object_agg(r.tip, r.n ORDER BY r.tip) AS restante
    FROM (SELECT c.licitatie_id, e ->> 'tip' AS tip, sum(coalesce((e ->> 'n')::int, 1))::int AS n
            FROM tcd c CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(c.restante) = 'array' THEN c.restante ELSE '[]'::jsonb END) e
           WHERE c.deschis AND jsonb_typeof(e) = 'object' AND (e ->> 'tip') IS NOT NULL GROUP BY 1, 2) r
   GROUP BY r.licitatie_id
), sh AS (
  -- reparația rundei 2: rândurile APROBATE ȘTERSE (evenimentul 'sters' — scris doar pentru OLD.status = 'validat'), cu rândul întreg din valori_vechi
  SELECT h.id, h.licitatie_id, h.cantitate_id, h.created_at,
         coalesce(public.ofertare_norm_text(h.valori_vechi ->> 'um'), '') AS um_norm,
         CASE WHEN jsonb_typeof(h.valori_vechi -> 'cantitate') = 'number' THEN (h.valori_vechi ->> 'cantitate')::numeric END AS cantitate,
         left(h.valori_vechi ->> 'denumire', 80) AS denumire,
         coalesce(public.ofertare_norm_text(h.valori_vechi ->> 'um') = 'm' AND (h.valori_vechi ->> 'categorie') ~* 'conduct|re[țt]ea'
           AND (coalesce(h.valori_vechi ->> 'obiect', '') || ' ' || coalesce(h.valori_vechi ->> 'denumire', '') || ' ' || coalesce(h.valori_vechi ->> 'sursa', '')) !~* 'total', false) AS in_retea
    FROM public.ofertare_cantitati_istoric h
   WHERE h.motiv = 'sters' AND h.licitatie_id IS NOT NULL
), sd AS (
  SELECT sh.licitatie_id, count(*) AS n, count(*) FILTER (WHERE sh.in_retea) AS n_retea, max(sh.created_at) AS ultima,
         to_jsonb((array_agg(jsonb_build_object('cantitate_id', sh.cantitate_id, 'la', sh.created_at, 'um', sh.um_norm, 'cantitate', sh.cantitate,
                                                'denumire', sh.denumire, 'retea', sh.in_retea) ORDER BY sh.id DESC))[1:20]) AS lista
    FROM sh GROUP BY sh.licitatie_id
), sdu AS (
  SELECT x.licitatie_id, jsonb_object_agg(x.um_norm, jsonb_build_object('suma', x.suma, 'randuri', x.randuri, 'fara_cantitate', x.fara_cant)) AS pe_um
    FROM (SELECT sh.licitatie_id, sh.um_norm, sum(sh.cantitate) AS suma, count(*) AS randuri, count(*) FILTER (WHERE sh.cantitate IS NULL) AS fara_cant
            FROM sh GROUP BY 1, 2) x
   GROUP BY x.licitatie_id
), lic AS (
  SELECT licitatie_id FROM agg
  UNION SELECT licitatie_id FROM tc WHERE docs > 0 OR in_curs > 0
  UNION SELECT licitatie_id FROM sd
)
SELECT l.licitatie_id                                           AS licitatie_id,
       coalesce(a.lista_f3_nevalidate, 0)                       AS lista_f3_nevalidate,
       a.lista_f3_nevalidate_m,
       coalesce(a.lista_c6_nevalidate, 0)                       AS lista_c6_nevalidate,
       coalesce(a.memoriu_nevalidate, 0)                        AS memoriu_nevalidate,
       coalesce(a.plansa_nevalidate, 0)                         AS plansa_nevalidate,
       coalesce(a.fara_tip_nevalidate, 0)                       AS fara_tip_nevalidate,
       a.fara_tip_nevalidate_m,
       coalesce(a.retea_nevalidate, 0)                          AS retea_nevalidate,
       a.retea_nevalidate_m,
       coalesce(a.retea_randuri, 0)                             AS retea_randuri,
       coalesce(a.invalidate_in_afara_retea, 0)                 AS invalidate_in_afara_retea,
       a.invalidate_in_afara_retea_m,
       coalesce(a.total_invalidate, 0)                          AS total_invalidate,
       a.total_invalidate_m,
       coalesce(a.unitate_schimbata_in_afara_retea, 0)          AS unitate_schimbata_in_afara_retea,
       a.unitate_schimbata_in_afara_retea_m,
       coalesce(a.um_de_normalizat, 0)                          AS um_de_normalizat,
       a.um_de_normalizat_m,
       coalesce(a.um_de_normalizat_f3, 0)                       AS um_de_normalizat_f3,
       coalesce(a.lista_f3_nevalidate_fara_cant, 0)             AS lista_f3_nevalidate_fara_cant,
       coalesce(a.fara_tip_nevalidate_fara_cant, 0)             AS fara_tip_nevalidate_fara_cant,
       coalesce(a.um_de_normalizat_fara_cant, 0)                AS um_de_normalizat_fara_cant,
       coalesce(p.inv, '{}'::jsonb)                             AS invalidate_in_afara_retea_pe_um,
       coalesce(p.tot, '{}'::jsonb)                             AS total_invalidate_pe_um,
       coalesce(p.us, '{}'::jsonb)                              AS unitate_schimbata_in_afara_retea_pe_um,
       coalesce(t.docs, 0)                                      AS transfer_conflicte_docs,
       coalesce(t.n, 0)                                         AS transfer_conflicte_n,
       coalesce(t.in_curs, 0)                                   AS transfer_in_curs,
       array_to_string(t.lista, '; ')                           AS transfer_conflicte_lista,
       coalesce(tr.restante, '{}'::jsonb)                       AS transfer_restante,
       -- reparația rundei 2
       coalesce(a.lista_f3_fara_cant, 0)                        AS lista_f3_fara_cant,
       coalesce(a.retea_fara_cant, 0)                           AS retea_fara_cant,
       coalesce(a.lista_f3_validate_fara_cant, 0)               AS lista_f3_validate_fara_cant,
       coalesce(a.retea_validate_fara_cant, 0)                  AS retea_validate_fara_cant,
       coalesce(a.retea_alte_unitati, 0)                        AS retea_alte_unitati,
       coalesce(a.retea_alte_unitati_f3, 0)                     AS retea_alte_unitati_f3,
       coalesce(p.au, '{}'::jsonb)                              AS retea_alte_unitati_pe_um,
       coalesce(s.n, 0)                                         AS sterse_dupa_validare,
       coalesce(s.n_retea, 0)                                   AS sterse_dupa_validare_retea,
       coalesce(su.pe_um, '{}'::jsonb)                          AS sterse_dupa_validare_pe_um,
       s.ultima                                                 AS sterse_dupa_validare_ultima,
       coalesce(s.lista, '[]'::jsonb)                           AS sterse_dupa_validare_lista,
       -- runda 9
       coalesce(a.retea_alte_unitati_lungimi, 0)                AS retea_alte_unitati_lungimi,
       coalesce(a.retea_alte_unitati_lungimi_f3, 0)             AS retea_alte_unitati_lungimi_f3,
       coalesce(a.retea_alte_unitati_lungimi_nevalidate, 0)     AS retea_alte_unitati_lungimi_nevalidate,
       public.ofertare_totaluri_control(l.licitatie_id) AS totaluri_control,
       (SELECT count(*) FROM b WHERE b.licitatie_id=l.licitatie_id AND b.um_lungime) AS unitati_de_verificat,
       (SELECT sum(cantitate) FROM b WHERE b.licitatie_id=l.licitatie_id AND in_retea AND status='validat' AND tip_sursa='lista_f3') AS lista_f3_validate_m,
       (SELECT sum(cantitate) FROM b WHERE b.licitatie_id=l.licitatie_id AND in_retea AND status='validat' AND tip_sursa='lista_c6') AS lista_c6_validate_m,
       (SELECT sum(cantitate) FROM b WHERE b.licitatie_id=l.licitatie_id AND in_retea AND status='validat' AND tip_sursa='memoriu') AS memoriu_validate_m,
       (SELECT sum(cantitate) FROM b WHERE b.licitatie_id=l.licitatie_id AND in_retea AND status='validat' AND tip_sursa='plansa') AS plansa_validate_m
  FROM lic l
  LEFT JOIN agg a ON a.licitatie_id = l.licitatie_id
  LEFT JOIN tc t ON t.licitatie_id = l.licitatie_id
  LEFT JOIN pj p ON p.licitatie_id = l.licitatie_id
  LEFT JOIN tcr tr ON tr.licitatie_id = l.licitatie_id
  LEFT JOIN sd s ON s.licitatie_id = l.licitatie_id
  LEFT JOIN sdu su ON su.licitatie_id = l.licitatie_id
 WHERE l.licitatie_id IS NOT NULL;
-- runda 5: default privileges dau ALL pe obiectele noi — întâi REVOKE ALL (și de la authenticated), apoi doar SELECT
REVOKE ALL ON public.v_ofertare_cantitati_nevalidate FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_ofertare_cantitati_nevalidate TO authenticated, service_role;
COMMENT ON VIEW public.v_ofertare_cantitati_nevalidate IS 'R5 (25–26.09.2026, runda 6 + sarcina 2): per licitație, câte rânduri de rețea (filtrul qm din v_ofertare_pt_stare, cu unitatea normalizată) NU sunt validate de om (status<>validat), pe tip_sursa, cu metri; plus rândurile INVALIDATE (istoricul aprobării: ultimul eveniment invalidat / redeschis; sau prefixul notei) ieșite din rețea, rândurile TOTAL invalidate (separat), rândurile neaprobate ieșite din rețea prin schimbarea unității și rândurile de rețea cu unitatea scrisă altfel decât exact m (pe care qm din v_ofertare_pt_stare nu le adună). Sarcina 2: *_m = doar rândurile în m, *_pe_um = defalcarea pe unitate (fără sume peste unități diferite), *_fara_cant = fără cantitate determinată; transfer_conflicte_* = planșele cu conflicte de transfer DESCHISE (v_ofertare_transfer_conflicte), și când licitația nu are niciun rând. Reparația rundei 2: rândurile de rețea fără cantitate pe orice status și validate fără cantitate (*_fara_cant), rândurile de rețea în alte unități decât m (retea_alte_unitati*, fără conversie), rândurile aprobate ȘTERSE (sterse_dupa_validare*, din istoric). Citit de OfertarePropunere (H2, controlCantitati), de poarta pachetului și de poarta de depunere (ofertare_r5_blocaj_sursa): nimic nu dispare tacit. security_invoker.';

-- 1b) ────────────────────────────────────────────────────────────────────────────────────────────────────
-- REPARAȚIA RUNDEI 1 (ADDENDUM 2 Copilot, a — „APROBAREA FINALĂ”): „WARN [la H2] e bun pentru lucrul intermediar; la APROBAREA FINALĂ un
-- conflict deschis BLOCHEAZĂ dacă afectează cantitatea / soluția ofertată sau impactul nu e stabilit … Dacă o poartă server-side
-- existentă impune deja blocajul, demonstreaz-o (nu duplica).” Mecanismul existent: aprobarea pachetului (ofertare_pt_pachet.stare →
-- 'aprobat' / 'depus'), păzită server-side de trigger-ul trg_ofertare_pt_pachet_poarta_documentatie (live, 24.09.2026: DOAR
-- completitudinea documentației — v_ofertare_seap_completitudine; SELECT 26.09.2026). NU verifica sursa cantităților => se EXTINDE
-- aceeași funcție (nu un trigger nou): conflictele de transfer DESCHISE (neconfirmate ca rezolvare / excepție justificată — deci cu
-- impactul nestabilit) sau un transfer în curs BLOCHEAZĂ aprobarea; view-ul indisponibil / eroarea = „nu putem verifica” = BLOCAT
-- (control indisponibil ≠ zero) — și când utilizatorul a confirmat avertismentul pe draft. Partea de documentație e NESCHIMBATĂ
-- (corpul live, md5(prosrc) a45ccdb853da8d7a6cabead04d9a95af, refăcut exact de rollback). Pachete existente: 0 (SELECT 26.09.2026).
-- REPARAȚIA RUNDEI 2: verificarea sursei cantităților e O SINGURĂ funcție (ofertare_r5_blocaj_sursa), folosită de poarta pachetului și de
-- poarta de depunere (fn_gate_depunere, mai jos). NULL = sursa e verificată și nu are restanțe; altfel textul blocajului (după prefixul
-- porții). SECURITY INVOKER: rulează cu identitatea porții care o cheamă (trigger-e SECURITY DEFINER => proprietarul, fără RLS).
CREATE OR REPLACE FUNCTION public.ofertare_r5_blocaj_sursa(p_licitatie_id bigint)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_tot jsonb; v_um int; v_tcd int; v_tcn int; v_tic int; v_tcl text; v_err text;
BEGIN
  BEGIN
    v_tot := public.ofertare_totaluri_control(p_licitatie_id);
    IF jsonb_typeof(v_tot) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'control TOTAL indisponibil'; END IF;
    SELECT count(*) INTO v_um FROM public.ofertare_cantitati q WHERE q.licitatie_id=p_licitatie_id
      AND public.ofertare_clasa_unitate(q.um)->>'tip'='de_verificat';
    SELECT coalesce(c.transfer_conflicte_docs, 0), coalesce(c.transfer_conflicte_n, 0), coalesce(c.transfer_in_curs, 0), c.transfer_conflicte_lista
      INTO v_tcd, v_tcn, v_tic, v_tcl FROM public.v_ofertare_cantitati_nevalidate c WHERE c.licitatie_id = p_licitatie_id;
  EXCEPTION WHEN others THEN v_err := SQLERRM;
  END;
  IF v_err IS NOT NULL THEN
    RETURN format(': nu putem verifica sursa cantităților (conflictele transferului din planșe: %s) — nu înseamnă zero restanțe', v_err);
  END IF;
  IF v_um > 0 THEN RETURN ' — unitate de verificat: baza cantităților este incompletă'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_tot) t WHERE t->>'stare' <> 'ok') THEN
    RETURN ' — ' || (SELECT string_agg(DISTINCT t->>'text',' ') FROM jsonb_array_elements(v_tot) t WHERE t->>'stare'<>'ok');
  END IF;
  IF coalesce(v_tcd, 0) > 0 THEN
    RETURN format(' — sursa cantităților e incompletă: %s la transferul din %s (%s): rezolvă-le (recitire care le acoperă) sau confirmă-le în Documente (rezolvare / excepție justificată, cu drept de decizie)',
      CASE WHEN v_tcn = 1 THEN '1 restanță deschisă' ELSE v_tcn || ' restanțe deschise' END, CASE WHEN v_tcd = 1 THEN '1 planșă' ELSE v_tcd || ' planșe' END,
      coalesce(v_tcl, '—'));
  END IF;
  IF coalesce(v_tic, 0) > 0 THEN
    RETURN format(' — transfer din planșă în curs (%s documente): impactul asupra cantităților nu e stabilit; reîncearcă după ce se termină', v_tic);
  END IF;
  RETURN NULL;
END $function$;
REVOKE ALL ON FUNCTION public.ofertare_r5_blocaj_sursa(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ofertare_r5_blocaj_sursa(bigint) TO service_role;
COMMENT ON FUNCTION public.ofertare_r5_blocaj_sursa(bigint) IS 'R5 reparația rundei 2 (26.09.2026): blocajul aprobării finale din sursa cantităților (restanțe de transfer deschise / transfer în curs / control indisponibil = „nu putem verifica”, nu zero) — NULL = fără blocaj. Folosită de fn_ofertare_pt_pachet_poarta_documentatie și fn_gate_depunere.';

CREATE OR REPLACE FUNCTION public.fn_ofertare_pt_pachet_poarta_documentatie()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_blocaj text; v_gasit boolean; v_r5 text;
BEGIN
  IF (NEW.stare = 'aprobat' AND (TG_OP = 'INSERT' OR OLD.stare IS DISTINCT FROM 'aprobat'))
     OR (NEW.stare = 'depus' AND (TG_OP = 'INSERT' OR OLD.stare NOT IN ('aprobat', 'depus'))) THEN
    SELECT true, blocaj INTO v_gasit, v_blocaj FROM public.v_ofertare_seap_completitudine WHERE licitatie_id = NEW.licitatie_id;
    IF v_gasit IS NULL THEN
      RAISE EXCEPTION 'Aprobare blocată: nu putem verifica completitudinea documentației (licitația % nu apare în control)', NEW.licitatie_id USING ERRCODE = 'P0001';
    END IF;
    IF v_blocaj IS NOT NULL THEN
      RAISE EXCEPTION 'Aprobare blocată — documentația nu e completă: %', v_blocaj USING ERRCODE = 'P0001';
    END IF;
  END IF;
  -- R5 (reparația rundei 1): sursa cantităților — conflictele transferului planșă → cantități DESCHISE blochează aprobarea finală.
  -- Reparația rundei 2 (verificatorul BD, minor): și la aprobat → depus — un conflict apărut DUPĂ aprobare (ex. dintr-o recitire) nu mai
  -- trece la depunere (partea de documentație rămâne ca live: nu se reverifică la aprobat → depus).
  IF NEW.stare IN ('aprobat', 'depus') AND (TG_OP = 'INSERT' OR OLD.stare IS DISTINCT FROM NEW.stare) THEN
    v_r5 := public.ofertare_r5_blocaj_sursa(NEW.licitatie_id);
    IF v_r5 IS NOT NULL THEN
      RAISE EXCEPTION 'Aprobare blocată%', v_r5 USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.fn_ofertare_pt_pachet_poarta_documentatie() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ofertare_pt_pachet_poarta_documentatie() TO service_role;

-- 1c) ────────────────────────────────────────────────────────────────────────────────────────────────────
-- REPARAȚIA RUNDEI 2 (verificatorul BD, MAJOR + condiția „ADDENDUM 2 a”): POARTA DE DEPUNERE existentă — trigger-ul trg_gate_depunere pe
-- ofertare_licitatii (BEFORE UPDATE, fn_gate_depunere, LIVE md5(prosrc) 6ee66ed8decff19a0c303c324454cfe1) — bloca trecerea în 'depusa'
-- doar pentru cerințe, acoperire și dovezi. În producție sunt 0 pachete și 3 licitații „depusa” (SELECT 26.09.2026): depunerea se face
-- practic prin STATUSUL licitației (OfertareLicitatii.jsx: in_lucru → depusa, update simplu, eroarea serverului apare în toast). Pe PGlite,
-- cu definiția live, lic. 95 reală (Dn60 + adnotările de pe 470 deschise) trecea în „depusa” fără eroare. Copilot: „Conflictele Dn60 + 3
-- adnotări pe 470 … să nu permită aprobarea ofertei fără rezolvare”.
-- Acum: partea live NESCHIMBATĂ (același bloc, aceleași mesaje); în plus, trecerea în 'depusa' e refuzată cât ofertare_r5_blocaj_sursa
-- întoarce un blocaj (restanțe de transfer deschise / transfer în curs / control indisponibil). Derogarea: derogare_depunere = true, ca
-- azi „doar cu decizia lui Razvan”; pentru partea R5 contează doar dacă trecerea în 'depusa' o face cineva cu DREPT DE DECIZIE pe licitație
-- (fn_ofertare_source_pack_poate_decide — același drept ca la confirmarea conflictelor) sau serverul / SQL-ul proprietarului (fără
-- auth.uid()) — politica licitațiilor lasă ORICE utilizator autentificat să scrie derogare_depunere. Rollback: corpul live, exact.
-- Efect la aplicare (SELECT 26.09.2026): lic. 3 (in_lucru, termen 14.10) și lic. 95 (in_lucru, termen 19.10) nu mai pot trece în „depusa”
-- până la ♻ reevaluare (după deploy) / ✋ confirmare / derogare; lic. 5 și 93 (in_lucru) nu au jurnal de transfer => neatinse.
CREATE OR REPLACE FUNCTION public.fn_gate_depunere()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  n_neconfirmate int; n_neacoperite int; n_rosii int; msg text; v_r5 text;
BEGIN
  IF NEW.status = 'depusa' AND OLD.status IS DISTINCT FROM 'depusa' AND NOT COALESCE(NEW.derogare_depunere, false) THEN
    SELECT count(*) INTO n_neconfirmate FROM ofertare_cerinte c
      WHERE c.licitatie_id = NEW.id AND c.inlocuita_de IS NULL AND c.confirmata_de IS NULL;
    SELECT count(*) INTO n_neacoperite FROM ofertare_cerinte c
      WHERE c.licitatie_id = NEW.id AND c.inlocuita_de IS NULL
      AND NOT EXISTS (SELECT 1 FROM ofertare_acoperire a WHERE a.cerinta_id = c.id AND a.status IN ('acoperit','acoperit_partener'));
    SELECT count(*) INTO n_rosii FROM ofertare_acoperire a
      JOIN ofertare_cerinte c ON c.id = a.cerinta_id AND c.licitatie_id = NEW.id AND c.inlocuita_de IS NULL
      JOIN documente_firma d ON d.id = a.doc_firma_id
      WHERE NOT d.utilizabil
         OR (NOT d.fara_expirare AND d.data_valabilitate IS NOT NULL AND
             d.data_valabilitate < COALESCE(NEW.termen_depunere::date, CURRENT_DATE) + CASE WHEN d.se_reemite THEN 0 ELSE 90 END);
    IF n_neconfirmate > 0 OR n_neacoperite > 0 OR n_rosii > 0 THEN
      msg := format('BLOCAT LA DEPUNERE: %s cerințe neconfirmate de om, %s cerințe fără acoperire, %s dovezi roșii (expirate/expiră <90 zile după termen/neutilizabile; certificatele de 30 zile trebuie valabile în ziua depunerii). Rezolvă-le sau setează derogare_depunere=true (doar cu decizia lui Razvan).', n_neconfirmate, n_neacoperite, n_rosii);
      RAISE EXCEPTION '%', msg;
    END IF;
  END IF;
  -- R5 (reparația rundei 2): sursa cantităților — restanțe de transfer din planșe deschise / transfer în curs / control indisponibil
  -- Runda 9 (verificatorul BD, minor M5b / M5c — AVERTISMENT, nu protecție completă): „dreptul de decizie” = fn_ofertare_source_pack_poate_decide
  -- (owner / responsabil_id / admin Ofertare), iar politica live ofertare_licitatii_all lasă ORICE utilizator autentificat să scrie
  -- responsabil_id — deci dreptul se poate AUTO-ACORDA în doi pași (responsabil_id = el însuși, apoi derogare + depusa), fără urmă pentru
  -- schimbarea responsabilului. Slăbiciune PRE-EXISTENTĂ (aceeași la poarta pe cheltuială); închiderea ei e o schimbare de DREPTURI =>
  -- decizia lui Razvan (propunere: trigger BEFORE UPDATE OF responsabil_id — doar owner / admin Ofertare / responsabilul curent — + urmă).
  IF NEW.status = 'depusa' AND OLD.status IS DISTINCT FROM 'depusa' THEN
    v_r5 := public.ofertare_r5_blocaj_sursa(NEW.id);
    IF v_r5 IS NOT NULL THEN
      RAISE EXCEPTION 'BLOCAT LA DEPUNERE%. Oferta nu se depune cu sursa cantităților nerezolvată; derogare_depunere=true doar cu decizia lui Razvan (pentru partea asta contează doar dacă depunerea o face ownerul / responsabilul / un admin Ofertare).', v_r5 USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $function$;

-- 1d) ────────────────────────────────────────────────────────────────────────────────────────────────────
-- Runda 9b: revizia datelor și hash-ul textului; fără parser numeric pe proză.
ALTER TABLE public.ofertare_clarificari ADD COLUMN IF NOT EXISTS baza_generare jsonb;
COMMENT ON COLUMN public.ofertare_clarificari.baza_generare IS 'R9b: baza generării, textul aprobat și istoricul deciziilor umane; păstrate la rollback.';

CREATE OR REPLACE FUNCTION public.ofertare_f3_baza(p_licitatie_id bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_randuri jsonb; v_conflicte jsonb; v_doc jsonb; v_totaluri jsonb; v_suma numeric; v_n int; v_nev int; v_um int; v_alte jsonb;
BEGIN
  -- Perimetru: lista financiară și rețeaua licitației. În hash intră toate atributele relevante,
  -- inclusiv validarea, baza planșei și sursa, fără timestamp-uri sau ordinea afișării.
  SELECT coalesce(jsonb_agg(x ORDER BY (x->>'id')::bigint),'[]'::jsonb) INTO v_randuri FROM (
    SELECT jsonb_build_object('id',q.id,'c',round(q.cantitate,6),'cp',round(q.cantitate_plansa,6),
      'um',public.ofertare_norm_text(q.um),'s',q.status,'o',public.ofertare_norm_text(q.obiect),
      'd',public.ofertare_norm_text(q.denumire),'categorie',public.ofertare_norm_text(q.categorie),
      'sursa',public.ofertare_norm_text(q.sursa),'tip_sursa',q.tip_sursa,'specificatii',public.ofertare_norm_text(q.specificatii),
      'cod_articol',public.ofertare_norm_text(q.cod_articol),'unitate',public.ofertare_clasa_unitate(q.um),
      'total',(coalesce(q.obiect,'') || ' ' || coalesce(q.denumire,'') || ' ' || coalesce(q.sursa,'')) ~* 'total') x
    FROM public.ofertare_cantitati q WHERE q.licitatie_id = p_licitatie_id
      AND (q.tip_sursa = 'lista_f3' OR q.categorie ~* 'conduct|re[țt]ea'
        OR (coalesce(q.obiect,'') || ' ' || coalesce(q.denumire,'') || ' ' || coalesce(q.sursa,'')) ~* 'total'
        OR EXISTS (SELECT 1 FROM public.ofertare_cantitati t WHERE t.licitatie_id=q.licitatie_id
          AND (coalesce(t.obiect,'') || ' ' || coalesce(t.denumire,'') || ' ' || coalesce(t.sursa,'')) ~* 'total'
          AND (public.ofertare_norm_text(t.obiect),public.ofertare_norm_text(t.sursa),public.ofertare_norm_text(t.categorie),public.ofertare_norm_text(t.tip_sursa))
            IS NOT DISTINCT FROM (public.ofertare_norm_text(q.obiect),public.ofertare_norm_text(q.sursa),public.ofertare_norm_text(q.categorie),public.ofertare_norm_text(q.tip_sursa))))
  ) r;
  SELECT coalesce(jsonb_agg(x || jsonb_build_object('h',md5(x::text)) ORDER BY (x->>'id')::bigint),'[]'::jsonb)
    INTO v_randuri FROM jsonb_array_elements(v_randuri) x;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',t.document_id,'token',t.token,'stare',t.stare,
      'conflicte',t.conflicte,'restante',t.restante,'in_curs',t.in_curs) ORDER BY t.document_id),'[]'::jsonb)
    INTO v_conflicte FROM public.v_ofertare_transfer_conflicte t WHERE t.licitatie_id = p_licitatie_id AND (t.deschis OR t.in_curs);
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',d.id,'nume',d.nume_original,'plansa',d.analiza->'plansa',
      'eroare',d.eroare) ORDER BY d.id),'[]'::jsonb) INTO v_doc
    FROM public.ofertare_documente_atribuire d WHERE d.licitatie_id = p_licitatie_id AND (d.analiza ? 'plansa' OR d.tip = 'lista_cantitati');
  v_totaluri := public.ofertare_totaluri_control(p_licitatie_id);
  SELECT count(*) FILTER (WHERE x->>'tip_sursa' = 'lista_f3'),
    count(*) FILTER (WHERE NOT (x->>'total')::boolean AND (x->>'s' IS DISTINCT FROM 'validat' OR x->>'c' IS NULL)),
    count(*) FILTER (WHERE x->'unitate'->>'tip' = 'de_verificat'),
    sum((x->>'c')::numeric * (x->'unitate'->>'factor')::numeric)
      FILTER (WHERE x->>'tip_sursa' = 'lista_f3' AND x->>'categorie' ~* 'conduct|re[țt]ea' AND x->>'s' = 'validat' AND NOT (x->>'total')::boolean AND x->'unitate'->>'tip' = 'lungime')
    INTO v_n,v_nev,v_um,v_suma FROM jsonb_array_elements(v_randuri) x;
  SELECT coalesce(jsonb_object_agg(u,jsonb_build_object('suma',s,'randuri',n)),'{}'::jsonb) INTO v_alte FROM (
    SELECT x->>'um' u,sum((x->>'c')::numeric) s,count(*) n FROM jsonb_array_elements(v_randuri) x
    WHERE x->'unitate'->>'tip' = 'alta' AND NOT (x->>'total')::boolean GROUP BY 1
  ) a;
  RETURN jsonb_build_object('v',2,'evaluare','r9b','mod','corespondenta',
    'amprenta',md5(jsonb_build_array(v_randuri,v_conflicte,v_doc)::text),'randuri',v_randuri,
    'n_f3',v_n,'n_de_verificat',v_nev+v_um,'de_verificat',jsonb_build_object('nevalidate',v_nev,'unitate_de_verificat',v_um),
    'suma',v_suma,'alte_unitati',v_alte,'totaluri',v_totaluri,'conflicte_transfer',jsonb_array_length(v_conflicte),
    'text',format('Review intern: %s poziții de verificat; %s cu unitate de verificat. Suma lungimilor F3 validate: %s m (detalii, fără TOTAL). Alte unități: %s. Conflicte deschise: %s.',
      v_nev,v_um,coalesce(v_suma::text,'nedeterminată'),v_alte::text,jsonb_array_length(v_conflicte)));
END $function$;
REVOKE ALL ON FUNCTION public.ofertare_f3_baza(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ofertare_f3_baza(bigint) TO authenticated, service_role;

-- Fără interpretarea cifrelor din proză. Tokenul de review leagă datele ȘI textul citit de om.
CREATE OR REPLACE FUNCTION public.ofertare_clarificare_baza_stare(p_licitatie_id bigint,p_intrebare text,p_sursa text,p_baza jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_cur jsonb; v_st text; v_token text; v_hash text := md5(coalesce(p_intrebare,'')); v_old jsonb; v_dif jsonb;
BEGIN
  v_cur := public.ofertare_f3_baza(p_licitatie_id);
  IF nullif(v_cur->>'amprenta','') IS NULL THEN RAISE EXCEPTION 'bază indisponibilă'; END IF;
  v_token := md5((v_cur->>'amprenta') || '|' || v_hash);
  v_st := CASE WHEN p_baza->>'evaluare' IS DISTINCT FROM 'r9b' THEN 'indisponibila'
    WHEN p_baza->>'amprenta' IS DISTINCT FROM v_cur->>'amprenta' THEN 'schimbata'
    WHEN p_baza->'reconfirmare'->>'token' IS DISTINCT FROM v_token THEN 'necesita_review'
    ELSE 'ok' END;
  -- Luarea la cunoștință este informativă, NICIODATĂ aprobare pentru export sau de_trimis.
  IF v_st <> 'ok' AND p_baza->'luat_act'->>'token' = v_token THEN v_st := 'luat_act'; END IF;
  v_old := CASE WHEN jsonb_typeof(p_baza->'randuri') = 'array' THEN p_baza->'randuri' ELSE '[]'::jsonb END;
  SELECT jsonb_build_object(
    'adaugate',coalesce((SELECT jsonb_agg(n) FROM jsonb_array_elements(v_cur->'randuri') n WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_old) o WHERE o->>'id'=n->>'id')),'[]'::jsonb),
    'scoase',coalesce((SELECT jsonb_agg(o) FROM jsonb_array_elements(v_old) o WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_cur->'randuri') n WHERE o->>'id'=n->>'id')),'[]'::jsonb),
    'modificate',coalesce((SELECT jsonb_agg(jsonb_build_object('id',o->'id','inainte',o,'acum',n)) FROM jsonb_array_elements(v_old) o JOIN jsonb_array_elements(v_cur->'randuri') n ON o->>'id'=n->>'id' WHERE o->>'h' IS DISTINCT FROM n->>'h'),'[]'::jsonb)) INTO v_dif;
  RETURN jsonb_build_object('stare',v_st,'evaluare','r9b','amprenta_curenta',v_token,'amprenta_baza',v_cur->>'amprenta',
    'text_hash',v_hash,'curent',v_cur-'randuri','diferente',v_dif,'mod_ciorna','corespondenta',
    'marcaj_planse','revizie_planse_auto'=ANY(string_to_array(coalesce(p_sursa,''),',')),
    'text',CASE v_st WHEN 'ok' THEN 'Text aprobat de om pe baza curentă. Cantitățile din text nu sunt validate automat.'
      WHEN 'schimbata' THEN 'baza s-a schimbat — de reverificat'
      WHEN 'luat_act' THEN 'baza s-a schimbat după transmitere — luat act; textul transmis rămâne neschimbat'
      WHEN 'indisponibila' THEN 'necesită review — baza ciornei vechi nu este demonstrabilă'
      ELSE 'necesită review — aprobă textul exact pe baza curentă' END);
EXCEPTION WHEN others THEN
  RETURN jsonb_build_object('stare','indisponibila','text','nu putem verifica baza: ' || SQLERRM);
END $function$;
REVOKE ALL ON FUNCTION public.ofertare_clarificare_baza_stare(bigint,text,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ofertare_clarificare_baza_stare(bigint,text,text,jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ofertare_clarificare_reconfirma(p_id bigint,p_amprenta text,p_decizie text,p_nota text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE c record; v_st jsonb; v_cur jsonb; v_decizie jsonb; v_sursa text;
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.fn_are_acces_ofertare(),false) THEN RETURN jsonb_build_object('error','fără acces la Ofertare'); END IF;
  IF coalesce(p_decizie,'') NOT IN ('revizuit','luat_act') THEN RETURN jsonb_build_object('error','alege revizuit sau, după transmitere, luat_act'); END IF;
  IF length(btrim(coalesce(p_nota,''))) < CASE WHEN p_decizie='luat_act' THEN 10 ELSE 5 END THEN RETURN jsonb_build_object('error','nota de review este prea scurtă'); END IF;
  SELECT * INTO c FROM public.ofertare_clarificari WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR coalesce(c.cheie,'') NOT LIKE 'auto_planse_%' THEN RETURN jsonb_build_object('error','nu e ciornă automată'); END IF;
  v_st := public.ofertare_clarificare_baza_stare(c.licitatie_id,c.intrebare,c.sursa,c.baza_generare);
  IF p_amprenta IS NULL OR v_st->>'amprenta_curenta' IS DISTINCT FROM p_amprenta THEN RETURN jsonb_build_object('error','textul sau baza s-au schimbat — reîncarcă și verifică'); END IF;
  v_decizie := jsonb_build_object('token',p_amprenta,'text_hash',md5(coalesce(c.intrebare,'')),
    'amprenta',v_st->>'amprenta_baza','text_aprobat',c.intrebare,'de',auth.uid(),'la',now(),'decizie',p_decizie,'nota',btrim(p_nota));
  IF c.status IN ('trimisa','raspunsa') THEN
    IF p_decizie <> 'luat_act' THEN RETURN jsonb_build_object('error','document transmis imuabil — doar luat_act'); END IF;
    UPDATE public.ofertare_clarificari SET baza_generare=coalesce(baza_generare,'{}'::jsonb)||jsonb_build_object('luat_act',v_decizie,
      'istoric_decizii',coalesce(baza_generare->'istoric_decizii','[]'::jsonb)||jsonb_build_array(v_decizie)) WHERE id=p_id;
  ELSE
    IF c.status NOT IN ('propunere','de_trimis') OR p_decizie <> 'revizuit' THEN RETURN jsonb_build_object('error','decizie incompatibilă cu starea ciornei'); END IF;
    v_cur := public.ofertare_f3_baza(c.licitatie_id);
    IF md5((v_cur->>'amprenta') || '|' || md5(coalesce(c.intrebare,''))) IS DISTINCT FROM p_amprenta THEN RETURN jsonb_build_object('error','baza s-a schimbat în timpul verificării'); END IF;
    SELECT string_agg(t,',' ORDER BY o) INTO v_sursa FROM unnest(string_to_array(coalesce(c.sursa,''),',')) WITH ORDINALITY x(t,o) WHERE t <> 'revizie_planse_auto';
    UPDATE public.ofertare_clarificari SET sursa=v_sursa, updated_at=now(),
      baza_generare=v_cur||jsonb_build_object('text_hash',md5(coalesce(c.intrebare,'')),'reconfirmare',v_decizie,
        'istoric_decizii',coalesce(c.baza_generare->'istoric_decizii','[]'::jsonb)||
          CASE WHEN c.baza_generare->'reconfirmare' IS NOT NULL AND NOT (c.baza_generare ? 'istoric_decizii') THEN jsonb_build_array(c.baza_generare->'reconfirmare') ELSE '[]'::jsonb END || jsonb_build_array(v_decizie))
      WHERE id=p_id;
  END IF;
  RETURN jsonb_build_object('ok',true,'id',p_id,'decizie',p_decizie);
END $function$;
REVOKE ALL ON FUNCTION public.ofertare_clarificare_reconfirma(bigint,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ofertare_clarificare_reconfirma(bigint,text,text,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_trg_ofertare_clarificari_baza()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_st jsonb; v_auto boolean;
BEGIN
  IF TG_OP='DELETE' THEN
    IF coalesce(OLD.cheie,'') LIKE 'auto_planse_%' THEN RAISE EXCEPTION 'Proveniența și deciziile se păstrează; retrage ciorna în loc de ștergere'; END IF;
    RETURN OLD;
  END IF;
  v_auto := coalesce(NEW.cheie,'') LIKE 'auto_planse_%' OR (TG_OP='UPDATE' AND coalesce(OLD.cheie,'') LIKE 'auto_planse_%');
  IF NOT v_auto THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' THEN
    IF (NEW.cheie,NEW.licitatie_id,NEW.origine) IS DISTINCT FROM (OLD.cheie,OLD.licitatie_id,OLD.origine) THEN
      RAISE EXCEPTION 'Proveniența clarificării automate este imuabilă';
    END IF;
    IF OLD.status IN ('trimisa','raspunsa') AND ((NEW.intrebare,NEW.fisier_path) IS DISTINCT FROM (OLD.intrebare,OLD.fisier_path)
      OR NEW.status IS NULL OR NEW.status NOT IN ('trimisa','raspunsa')) THEN RAISE EXCEPTION 'Documentul transmis este imuabil'; END IF;
  END IF;
  IF current_user IN ('authenticated','anon','service_role') THEN
    IF TG_OP='INSERT' THEN RAISE EXCEPTION 'Ciorna automată se creează doar prin generatorul controlat'; END IF;
    IF NEW.baza_generare IS DISTINCT FROM OLD.baza_generare THEN RAISE EXCEPTION 'Baza și aprobarea se scriu doar prin reconfirmare'; END IF;
    NEW.sursa := OLD.sursa;
  END IF;
  IF TG_OP='UPDATE' AND NEW.intrebare IS DISTINCT FROM OLD.intrebare AND current_user IN ('authenticated','anon','service_role') THEN
    -- Textul se salvează, aprobarea nu se transferă. Istoricul deciziilor se păstrează.
    NEW.baza_generare := (coalesce(NEW.baza_generare,'{}'::jsonb)-'reconfirmare') ||
      CASE WHEN OLD.baza_generare ? 'reconfirmare' AND NOT (OLD.baza_generare ? 'istoric_decizii')
        THEN jsonb_build_object('istoric_decizii',jsonb_build_array(OLD.baza_generare->'reconfirmare')) ELSE '{}'::jsonb END ||
      jsonb_build_object('text_editat_de',auth.uid(),'text_editat_la',now());
    IF NEW.status='de_trimis' THEN NEW.status := 'propunere'; END IF;
  END IF;
  IF NEW.status IN ('de_trimis','trimisa') AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    v_st := public.ofertare_clarificare_baza_stare(NEW.licitatie_id,NEW.intrebare,NEW.sursa,NEW.baza_generare);
    IF v_st->>'stare' IS DISTINCT FROM 'ok' OR coalesce((v_st->>'marcaj_planse')::boolean,true) THEN
      RAISE EXCEPTION 'Clarificare blocată: %. Reconfirmă textul pe baza curentă.',v_st->>'text';
    END IF;
  END IF;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.fn_trg_ofertare_clarificari_baza() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_ofertare_clarificari_baza ON public.ofertare_clarificari;
CREATE TRIGGER trg_ofertare_clarificari_baza BEFORE INSERT OR UPDATE OR DELETE ON public.ofertare_clarificari
FOR EACH ROW EXECUTE FUNCTION public.fn_trg_ofertare_clarificari_baza();

-- Nicio scanare/notificare în tranzacția scrierii F3. Istoricul și invalidarea din 1/1b rămân intacte.
DROP TRIGGER IF EXISTS trg_zzz_ofertare_cantitati_clar_baza ON public.ofertare_cantitati;
DROP FUNCTION IF EXISTS public.fn_trg_ofertare_cantitati_clar_baza();
DROP FUNCTION IF EXISTS public.ofertare_clarificare_mod_text(text);

-- Control la citire, separat de salvare. Marcajul și notificarea se scriu atomic; eșecul permite retry.
CREATE OR REPLACE FUNCTION public.ofertare_clarificari_notifica(p_licitatie_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE c record; v_st jsonb; v_resp uuid; v_n int := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.fn_are_acces_ofertare(),false) THEN RETURN jsonb_build_object('error','fără acces'); END IF;
  SELECT responsabil_id INTO v_resp FROM public.ofertare_licitatii WHERE id=p_licitatie_id;
  FOR c IN SELECT * FROM public.ofertare_clarificari WHERE licitatie_id=p_licitatie_id AND cheie LIKE 'auto_planse_%' AND status <> 'retrasa' ORDER BY id FOR UPDATE LOOP
    v_st := public.ofertare_clarificare_baza_stare(c.licitatie_id,c.intrebare,c.sursa,c.baza_generare);
    IF v_st->>'stare' IN ('schimbata','indisponibila') AND v_st->>'amprenta_curenta' IS NOT NULL AND v_resp IS NOT NULL AND c.baza_generare->>'notificat_neactual' IS DISTINCT FROM v_st->>'amprenta_curenta' THEN
      INSERT INTO public.notifications(profile_id,type,modul,title,message,link_to) VALUES
        (v_resp,'info','Ofertare','Clarificare de reverificat','Licitația #'||p_licitatie_id||': baza s-a schimbat — de reverificat. Textul rămâne păstrat. Nimic trimis automat.','/ofertare');
      UPDATE public.ofertare_clarificari SET baza_generare=coalesce(baza_generare,'{}'::jsonb)||jsonb_build_object('notificat_neactual',v_st->>'amprenta_curenta') WHERE id=c.id;
      v_n:=v_n+1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('ok',true,'notificari',v_n);
EXCEPTION WHEN others THEN RETURN jsonb_build_object('error',SQLERRM);
END $function$;
REVOKE ALL ON FUNCTION public.ofertare_clarificari_notifica(bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ofertare_clarificari_notifica(bigint) TO authenticated,service_role;

-- Exportul primește textul și verificarea din ACELAȘI snapshot backend, fără două citiri care pot diverge.
CREATE OR REPLACE FUNCTION public.ofertare_clarificari_export(p_licitatie_id bigint)
RETURNS jsonb LANGUAGE plpgsql SET search_path TO 'public','pg_temp'
AS $function$
DECLARE c record; v_st jsonb; v_out jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.fn_are_acces_ofertare(),false) THEN RAISE EXCEPTION 'fără acces'; END IF;
  FOR c IN SELECT * FROM public.ofertare_clarificari WHERE licitatie_id=p_licitatie_id AND status='de_trimis' ORDER BY nr FOR SHARE LOOP
    IF coalesce(c.sursa,'') ~ '(^|,)revizie_' THEN RAISE EXCEPTION 'Clarificarea #% necesită revizie',c.nr; END IF;
    IF coalesce(c.cheie,'') LIKE 'auto_planse_%' THEN
      v_st := public.ofertare_clarificare_baza_stare(c.licitatie_id,c.intrebare,c.sursa,c.baza_generare);
      IF v_st->>'stare' IS DISTINCT FROM 'ok' THEN RAISE EXCEPTION 'Export blocat: %',v_st->>'text'; END IF;
    END IF;
    v_out := v_out || jsonb_build_array(to_jsonb(c));
  END LOOP;
  RETURN v_out;
END $function$;
REVOKE ALL ON FUNCTION public.ofertare_clarificari_export(bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ofertare_clarificari_export(bigint) TO authenticated,service_role;

DROP VIEW IF EXISTS public.v_ofertare_clarificari_baza;
CREATE VIEW public.v_ofertare_clarificari_baza WITH (security_invoker = on) AS
SELECT c.id, c.licitatie_id, c.nr, c.status, s.x ->> 'stare' AS stare, s.x ->> 'mod_ciorna' AS mod_ciorna, s.x -> 'curent' ->> 'mod' AS mod_curent,
       s.x ->> 'amprenta_curenta' AS amprenta_curenta, coalesce((s.x ->> 'marcaj_planse')::boolean, false) AS marcaj_planse, s.x ->> 'text' AS text, s.x AS detalii
  FROM public.ofertare_clarificari c
 CROSS JOIN LATERAL (SELECT public.ofertare_clarificare_baza_stare(c.licitatie_id, c.intrebare, c.sursa, c.baza_generare) AS x) s
 WHERE coalesce(c.cheie, '') LIKE 'auto_planse_%' AND c.status <> 'retrasa';
REVOKE ALL ON public.v_ofertare_clarificari_baza FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_ofertare_clarificari_baza TO authenticated, service_role;
COMMENT ON VIEW public.v_ofertare_clarificari_baza IS 'R9b: starea review-ului textului exact pe baza curentă, cu diferențe și valori pentru panoul intern. Necesita_review și luat_act nu sunt aprobări de export. security_invoker.';

-- 2) ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- v6 / R9b: text extern calitativ cu identificarea documentelor. Datele cantitative rămân numai în review.
CREATE OR REPLACE FUNCTION public.ofertare_clarificare_planse_auto(p_licitatie_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ids bigint[]; v_nume text[]; v_motive text[]; v_acoperite bigint[]; v_draft record; v_lot int;
  v_text text; v_lista text; v_det text; v_id bigint; v_nou boolean := false; v_resp uuid; v_nr int; v_noi int;
  v_antet constant text := 'Solicitare de clarificare (art. 160–161 din Legea nr. 98/2016) — date cantitative din planșe';
  v_standard boolean; v_tok text; v_det_fd text; v_ilizibile int; v_fara_date int;
  v_protejat boolean; v_flag int := 0; v_tc int;
  -- reparația rundei 1 (verificatorii, MAJOR v6 „ciorna umană suprascrisă”; ADDENDUM 2 Copilot, c): amprenta textului GENERAT (gen_…) și
  -- a EVENIMENTULUI notificat (ev_…), ca tokeni în sursa (lângă revizie_*; ignorați de v_acoperite / v_noi, care iau doar cifre)
  v_gen text; v_ev text; v_tok_gen text; v_tok_ev text; v_ids_sursa text; v_sursa_noua text;
  v_ev_fara constant text := left(md5('fara_planse_de_clarificat'), 12);
  -- runda 9: baza F3 (ofertare_f3_baza — o singură definiție) și amprenta ei, salvată în baza_generare a ciornei mașinii
  v_baza jsonb; v_baza_gen jsonb; v_financiar text;
BEGIN
  -- sarcina 2 (a): conflictele DESCHISE ale transferului planșă → cantități pe licitație (doar raportate în rezultat; textul nu le citează)
  SELECT count(*) INTO v_tc FROM public.v_ofertare_transfer_conflicte WHERE licitatie_id = p_licitatie_id AND deschis;
  SELECT array_agg(id ORDER BY nume_original),
         array_agg(regexp_replace(nume_original, '\.pdf$', '', 'i') ORDER BY nume_original),
         array_agg(CASE
           WHEN analiza->'plansa'->>'rezultat' = 'citita_fara_date_cantitative'
             OR eroare IN ('citită fără rezultat','citită fără date cantitative') THEN 'fara_date'
           ELSE 'ilizibil' END ORDER BY nume_original)
    INTO v_ids, v_nume, v_motive
  FROM ofertare_documente_atribuire
  WHERE licitatie_id = p_licitatie_id
    AND coalesce(analiza->'plansa'->>'rezultat','') NOT IN ('sursa_gresita_sigla','ok','partial')
    AND NOT (analiza->'plansa'->>'rezultat' IS NULL
             AND NOT coalesce((analiza->'plansa'->>'vectorial')::boolean, false)
             AND greatest(coalesce((analiza->'plansa'->>'latime')::int,0), coalesce((analiza->'plansa'->>'inaltime')::int,0)) BETWEEN 1 AND 1999)
    AND ( analiza->'plansa'->>'rezultat' IN ('ilizibil','citita_fara_date_cantitative')
          OR (analiza->'plansa'->>'citibila') = 'false'
          OR eroare IN ('citită fără rezultat','citită fără date cantitative','ilizibilă')
          OR (analiza->'plansa'->>'randare_esuata') = 'true' );
    -- v4: eșecul tehnic (status eroare fără verdict de lizibilitate) NU mai e tratat ca „ilizibil”.
  IF v_ids IS NULL THEN
    -- v4: se retrag DOAR ciornele cu textul standard; o ciornă editată de om rămâne (decide omul).
    -- v6 sarcina 2 (e): și DOAR cele încă 'propunere' (ale mașinii). O ciornă PROTEJATĂ — editată de om SAU aprobată de om ('de_trimis',
    -- „✅ Confirm motivul — de trimis”) — NU se retrage și nu i se schimbă textul / statusul: primește marcajul ',revizie_planse_auto'
    -- (exclusă din adresa generată până la revizie; OfertareClarificari.necesitaRevizie) + o notificare internă.
    -- Reparația rundei 1: „a mașinii” = textul e EXACT ultimul text generat (amprenta gen_<md5[:12]> din sursa) — NU doar antetul păstrat
    -- (omul editează corpul sub antet în textarea; înainte ciorna lui era retrasă). Fără amprentă (ciornă v5): protejată (decide omul).
    -- Notificarea: o singură dată pe EVENIMENT (ev_<…>): apeluri repetate, sau după „✓ revizuită” pe aceeași stare, nu mai notifică.
    UPDATE ofertare_clarificari c SET status = 'retrasa', updated_at = now()
     WHERE c.licitatie_id = p_licitatie_id AND c.origine = 'automat' AND c.cheie LIKE 'auto_planse_%' AND c.status = 'propunere'
       AND c.baza_generare->>'evaluare'='r9b' AND NOT (c.baza_generare ? 'reconfirmare' OR c.baza_generare ? 'text_editat_de')
       AND EXISTS (SELECT 1 FROM unnest(string_to_array(coalesce(c.sursa, ''), ',')) WITH ORDINALITY AS x(t, o)
                    WHERE x.o > 1 AND x.t ~ '^gen_[0-9a-f]{12}$' AND substr(x.t, 5) = left(md5(coalesce(c.intrebare, '')), 12));
    WITH m AS (
      UPDATE ofertare_clarificari c SET
        sursa = coalesce((SELECT string_agg(x.t, ',' ORDER BY x.o) FROM unnest(string_to_array(coalesce(c.sursa, ''), ',')) WITH ORDINALITY AS x(t, o)
                  WHERE x.o = 1 OR x.t !~ '^ev_[0-9a-f]{12}$'), '')
                || ',ev_' || v_ev_fara
                || CASE WHEN 'revizie_planse_auto' = ANY (string_to_array(coalesce(c.sursa, ''), ',')) THEN '' ELSE ',revizie_planse_auto' END,
        updated_at = now()
       WHERE c.licitatie_id = p_licitatie_id AND c.origine = 'automat' AND c.cheie LIKE 'auto_planse_%' AND c.status IN ('propunere','de_trimis')
         AND NOT (('ev_' || v_ev_fara) = ANY (string_to_array(coalesce(c.sursa, ''), ',')))
      RETURNING c.id)
    SELECT count(*) INTO v_flag FROM m;
    -- R9b: notificarea schimbării este centralizată în RPC-ul de citire; fără dublură aici.
    RETURN jsonb_build_object('actiune','nimic', 'de_revizuit', v_flag, 'transfer_conflicte_deschise', v_tc);
  END IF;

  SELECT coalesce(array_agg(x::bigint), '{}') INTO v_acoperite
  FROM ofertare_clarificari c, unnest(string_to_array(replace(c.sursa, 'planse_auto:', ''), ',')) x
  WHERE c.licitatie_id = p_licitatie_id AND c.origine = 'automat' AND c.cheie LIKE 'auto_planse_%'
    AND c.status NOT IN ('propunere','de_trimis') AND x ~ '^\d+$';
  SELECT array_agg(i), array_agg(n), array_agg(m) INTO v_ids, v_nume, v_motive
  FROM unnest(v_ids, v_nume, v_motive) AS t(i, n, m) WHERE NOT (i = ANY(v_acoperite));
  IF v_ids IS NULL THEN RETURN jsonb_build_object('actiune','deja_trimise', 'transfer_conflicte_deschise', v_tc); END IF;

  SELECT string_agg('documentul #' || d.id || ' „' || d.nume_original || '”', '; ' ORDER BY d.id) INTO v_financiar
    FROM public.ofertare_documente_atribuire d WHERE d.licitatie_id=p_licitatie_id AND d.tip='lista_cantitati';
  v_baza := public.ofertare_f3_baza(p_licitatie_id);
  v_baza_gen := v_baza || jsonb_build_object('la', now(), 'sursa_generare', 'v6-r9b');

  v_lista := array_to_string(v_nume, ', ');
  SELECT string_agg('   – ' || n, E'\n'), count(*) INTO v_det, v_ilizibile FROM unnest(v_nume, v_motive) t(n, m) WHERE m = 'ilizibil';
  SELECT string_agg('   – ' || n, E'\n'), count(*) INTO v_det_fd, v_fara_date FROM unnest(v_nume, v_motive) t(n, m) WHERE m = 'fara_date';
  v_text := v_antet || E'\n\n' ||
    CASE WHEN v_ilizibile > 0 THEN
      'În documentația de atribuire, următoarele planșe nu au putut fi citite (textul — cote, lungimi, diametre, materiale, notări de tronsoane — nu este lizibil sau fișierul nu poate fi deschis):' || E'\n' || v_det || E'\n\n'
    ELSE '' END ||
    CASE WHEN v_fara_date > 0 THEN
      'Pentru următoarele planșe, în lectura efectuată nu au fost identificate date cantitative (lungimi, diametre, tronsoane):' || E'\n' || v_det_fd || E'\n\n'
    ELSE '' END ||
    'Pentru fundamentarea corectă a ofertei, vă rugăm să ne comunicați, pentru planșele de mai sus:' || E'\n' ||
    '1. Lista tronsoanelor: denumire/capete tronson, lungime (m), diametru nominal, material și SDR, mod de pozare, subtraversări/traversări;' || E'\n' ||
    '2. Vă rugăm să precizați corespondența dintre pozițiile din ' || coalesce(v_financiar,'documentul financiar aplicabil (vă rugăm să îl identificați)') || ' și tronsoanele din planșele identificate mai sus, pentru obiectele / loturile / etapele aferente, precum și modul de tratare a neclarităților descrise. Vă rugăm să indicați paginile, pozițiile și reperele corespunzătoare;' ||
    CASE WHEN v_ilizibile > 0 THEN E'\n' || '3. Ca alternativă, pentru planșele care nu au putut fi citite, varianta în format editabil (DWG/DXF) sau PDF cu text selectabil.' ELSE '' END ||
    E'\n\n' ||
    'Precizăm că informațiile solicitate sunt necesare exclusiv pentru elaborarea ofertei și nu modifică cerințele documentației de atribuire.';

  -- reparația rundei 1: amprenta textului generat acum și a evenimentului (textul generat + mulțimea planșelor)
  v_baza_gen := v_baza_gen || jsonb_build_object('text_hash',md5(v_text));
  v_gen := left(md5(v_text), 12);
  -- runda 9: evenimentul v6 = DOAR planșele (ids + motive). Schimbările cifrelor F3 au mecanismul lor (baza_generare + v_ofertare_clarificari_baza
  -- + ofertare_clarificari_notifica la citire — o notificare pe revizie), ca aceeași schimbare să nu fie notificată de două ori
  v_ev := left(md5(array_to_string(v_ids, ',') || '|' || array_to_string(v_motive, ',')), 12);
  -- Reparația rundei 2 (verificatorul UI, PLAUSIBIL „lost update”): ciorna se citește FOR UPDATE — o salvare umană concurentă (editare /
  -- „✅ de trimis”) așteaptă sau e văzută; în plus, UPDATE-ul ciornei mașinii (mai jos) are gardă pe status și pe text.
  SELECT * INTO v_draft FROM ofertare_clarificari
  WHERE licitatie_id = p_licitatie_id AND origine = 'automat' AND cheie LIKE 'auto_planse_%' AND status IN ('propunere','de_trimis')
  ORDER BY id DESC LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    -- tokenii din sursa: planșele (cifrele, primul poartă prefixul „planse_auto:”), amprenta gen_, evenimentul ev_, marcajele revizie_*
    SELECT string_agg(x.t, ',' ORDER BY x.o) INTO v_ids_sursa
      FROM unnest(string_to_array(replace(coalesce(v_draft.sursa, ''), 'planse_auto:', ''), ',')) WITH ORDINALITY AS x(t, o) WHERE x.t ~ '^\d+$';
    SELECT substr(x.t, 5) INTO v_tok_gen FROM unnest(string_to_array(coalesce(v_draft.sursa, ''), ',')) WITH ORDINALITY AS x(t, o)
     WHERE x.o > 1 AND x.t ~ '^gen_[0-9a-f]{12}$' ORDER BY x.o DESC LIMIT 1;
    SELECT substr(x.t, 4) INTO v_tok_ev FROM unnest(string_to_array(coalesce(v_draft.sursa, ''), ',')) WITH ORDINALITY AS x(t, o)
     WHERE x.o > 1 AND x.t ~ '^ev_[0-9a-f]{12}$' ORDER BY x.o DESC LIMIT 1;
    -- textul e încă cel generat de funcție? Reparația rundei 1 (verificatorii, MAJOR): DOAR prin amprentă — textul de acum are exact md5-ul
    -- textului scris ultima dată de funcție (gen_ din sursa). Înainte: „începe cu antetul standard” — o ciornă „propunere” cu CORPUL editat
    -- de om sub antet (textarea din Clarificări, salvată la ieșirea din câmp, fără marcaj) era rescrisă tăcut la orice apel (și retrasă când
    -- planșele deveneau citibile). Ciornele fără amprentă (create de v5): standard doar dacă textul e IDENTIC cu cel generat acum.
    v_standard := CASE WHEN v_draft.baza_generare->>'evaluare' = 'r9b' AND v_tok_gen IS NOT NULL THEN left(md5(coalesce(v_draft.intrebare, '')), 12) = v_tok_gen
                       ELSE false END;
    -- v6 sarcina 2 (e): PROTEJATĂ = editată de om SAU aprobată de om ('de_trimis'). v5 rescria textul standard al unei ciorne APROBATE
    -- (de_trimis) când se schimba totalul F3 / motivele, fără să-i schimbe statusul — omul aprobase alt text decât cel „de trimis”.
    v_protejat := NOT v_standard OR v_draft.status = 'de_trimis' OR v_draft.baza_generare ? 'reconfirmare' OR v_draft.baza_generare ? 'text_editat_de';
    -- v4: marcajele rezervate de revizie (,revizie_*) din sursa se PĂSTREAZĂ la rescriere
    SELECT coalesce(string_agg(',' || t, '' ORDER BY o), '') INTO v_tok
      FROM unnest(string_to_array(v_draft.sursa, ',')) WITH ORDINALITY AS x(t, o) WHERE o > 1 AND t ~ '^revizie_[a-z0-9_]+$';
    SELECT count(*) INTO v_noi FROM unnest(v_ids) i
      WHERE NOT (i::text = ANY(string_to_array(replace(v_draft.sursa,'planse_auto:',''), ',')));
    -- runda 9 (verificatorul UI, MAJOR M2 — ciorna PROTEJATĂ cu cifra F3 veche): pentru o ciornă protejată (editată / aprobată de om), v6 răspunde
    -- DOAR de planșe: aceeași mulțime de planșe (și aceleași motive, dacă evenimentul e consemnat) => „neschimbat”, textul și statusul neatinse.
    -- Cifrele F3 NU mai trec pe aici: baza de la generare (baza_generare) e comparată cu cea de ACUM oriunde e afișată / exportată / trimisă
    -- ciorna (v_ofertare_clarificari_baza, trg_ofertare_clarificari_baza), iar o schimbare a rândurilor F3 notifică O dată (trigger-ul pe
    -- ofertare_cantitati) — înainte, o ciornă editată ieșea „neschimbat” și intra în adresă cu cifra veche (PGlite S5e).
    IF v_protejat AND v_noi = 0 AND v_ids_sursa IS NOT DISTINCT FROM array_to_string(v_ids, ',') AND (v_tok_ev IS NULL OR v_tok_ev = v_ev) THEN
      RETURN jsonb_build_object('actiune','neschimbat','id',v_draft.id,'planse',cardinality(v_ids),'editat_de_om', NOT v_standard, 'transfer_conflicte_deschise', v_tc);
    END IF;
    -- R9b: aceeași ciornă își păstrează baza de la generare; datele schimbate cer review, chiar fără cifre în text.
    IF NOT v_protejat AND v_noi = 0 AND v_ids_sursa IS NOT DISTINCT FROM array_to_string(v_ids, ',') AND v_draft.intrebare = v_text
       AND v_tok_gen IS NOT DISTINCT FROM v_gen THEN
      RETURN jsonb_build_object('actiune','neschimbat','id',v_draft.id,'planse',cardinality(v_ids),'editat_de_om', false, 'baza_actualizata', false,
        'transfer_conflicte_deschise', v_tc, 'f3_baza', v_baza - 'randuri');
    END IF;
    IF v_protejat THEN
      -- R9b: păstrăm textul și statusul; marcăm o singură dată evenimentul planșelor.
      -- Notificarea de schimbare se emite numai prin ofertare_clarificari_notifica, la citire.
      v_flag := CASE WHEN v_tok_ev IS NOT DISTINCT FROM v_ev THEN 0 ELSE 1 END;
      SELECT 'planse_auto:' || array_to_string(v_ids, ',') || coalesce(string_agg(',' || x.t, '' ORDER BY x.o), '') INTO v_sursa_noua
        FROM unnest(string_to_array(coalesce(v_draft.sursa, ''), ',')) WITH ORDINALITY AS x(t, o)
       WHERE x.o > 1 AND x.t !~ '^\d+$' AND x.t !~ '^ev_[0-9a-f]{12}$' AND (v_flag = 0 OR x.t <> 'revizie_planse_auto');
      v_sursa_noua := v_sursa_noua || ',ev_' || v_ev || CASE WHEN v_flag = 1 THEN ',revizie_planse_auto' ELSE '' END;
      UPDATE ofertare_clarificari SET sursa = v_sursa_noua, updated_at = now()
        WHERE id = v_draft.id AND sursa IS DISTINCT FROM v_sursa_noua;
    -- R9b: notificarea schimbării este centralizată în RPC-ul de citire; fără dublură aici.
      RETURN jsonb_build_object('actiune','protejat_de_revizuit','id',v_draft.id,'planse',cardinality(v_ids),'editat_de_om', NOT v_standard,
        'status', v_draft.status, 'marcat_acum', v_flag = 1, 'transfer_conflicte_deschise', v_tc);
    END IF;
    -- ciorna MAȘINII (textul = exact ultimul text generat, încă 'propunere'): se rescrie (text + planșe + amprenta nouă), rămâne 'propunere'
    -- reparația rundei 2: gardă — se rescrie DOAR dacă e încă 'propunere' cu exact textul citit (altfel omul a scris între timp: nu se atinge)
    UPDATE ofertare_clarificari SET
      intrebare = v_text,
      sursa = 'planse_auto:' || array_to_string(v_ids, ',') || v_tok || ',gen_' || v_gen || ',ev_' || v_ev,
      baza_generare = v_baza_gen,   -- runda 9: amprenta bazei cifrelor textului generat acum
      status = 'propunere', updated_at = now()
      WHERE id = v_draft.id AND status = 'propunere' AND intrebare IS NOT DISTINCT FROM v_draft.intrebare;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('actiune','neschimbat_concurent','id',v_draft.id,'planse',cardinality(v_ids), 'transfer_conflicte_deschise', v_tc);
    END IF;
    v_id := v_draft.id; v_nou := v_noi > 0;
  ELSE
    SELECT count(*) + 1 INTO v_lot FROM ofertare_clarificari WHERE licitatie_id = p_licitatie_id AND cheie LIKE 'auto_planse_%';
    SELECT coalesce(max(nr), 0) + 1 INTO v_nr FROM ofertare_clarificari WHERE licitatie_id = p_licitatie_id;
    INSERT INTO ofertare_clarificari (licitatie_id, nr, intrebare, sursa, status, origine, cheie, baza_generare)
      VALUES (p_licitatie_id, v_nr, v_text, 'planse_auto:' || array_to_string(v_ids, ',') || ',gen_' || v_gen || ',ev_' || v_ev, 'propunere', 'automat', 'auto_planse_' || v_lot, v_baza_gen)
      ON CONFLICT (licitatie_id, cheie) DO NOTHING RETURNING id INTO v_id;
    v_nou := v_id IS NOT NULL;
  END IF;

  IF v_nou THEN
    SELECT responsabil_id INTO v_resp FROM ofertare_licitatii WHERE id = p_licitatie_id;
    IF v_resp IS NOT NULL THEN
      INSERT INTO notifications (profile_id, type, modul, title, message, link_to)
      VALUES (v_resp, 'info', 'Ofertare', '💭 Propunere de clarificare (planșe)',
        'Licitația #' || p_licitatie_id || ': ' || cardinality(v_ids) || ' planșe fără date extrase (' || left(v_lista, 160) ||
        '). Verifică dacă datele nu sunt în memoriu/F3, apoi confirmă motivul în Clarificări. NU s-a trimis nimic.',
        '/ofertare');
    END IF;
  END IF;
  RETURN jsonb_build_object('actiune', CASE WHEN v_draft.id IS NOT NULL THEN 'actualizat' ELSE 'creat' END, 'id', v_id,
    'planse', cardinality(v_ids), 'motive', to_jsonb(v_motive), 'ilizibile', v_ilizibile, 'fara_date', v_fara_date, 'transfer_conflicte_deschise', v_tc,
    -- runda 9: baza cifrei (modul, suma, pozițiile de verificat pe categorii, textul intern „Subtotal … / Suma pozițiilor …”), fără rânduri
    'f3_baza', v_baza - 'randuri');
END $function$;
REVOKE EXECUTE ON FUNCTION public.ofertare_clarificare_planse_auto(bigint) FROM PUBLIC, anon, authenticated;
