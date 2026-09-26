-- ════════════════════════════════════════════════════════════════════════════════════════════════════════
-- R5 runda 4 · lic. 3 (Mânăstirea) · rânduri VALIDATE înaintea transferului din planșă care le-a scris cantitate_plansa
-- PROPUNERE NEEXECUTATĂ — se rulează DOAR cu GO Razvan, pas cu pas (preview → confirmare → aplicare → sanity).
-- Context: docs/R5_CONSUMATORI_CANTITATI_NEVALIDATE.md §2.1 și §7.
--
-- Ce s-a întâmplat (SELECT 26.09.2026): rândurile 2, 3 și 4 ale lic. 3 sunt 'validat' (memoriu), iar updated_at-ul lor
-- (15.09 15:19:53.008 / .032 / .053) e batch-ul TRANSFERULUI planșei 1.1 — rândul 1 e în același batch (15:19:52.967), iar
-- toate au nota „Memoriu X vs planșa 1.1 Y”. Cum validarea (✓, valideazaC) scrie și ea updated_at, ultima scriere a fost
-- transferul: validarea s-a dat ÎNAINTE, pe cifra din memoriu, iar cifra din planșă n-a văzut-o nimeni:
--   #2 Dn180: validat 1.100, planșa 1.1 = 2.210 (+1.110 m)      #3 Dn160: validat 5.250, planșa 1.1 = 5.245 (−5 m)
--   #4 TOTAL: validat 37.320, planșa 1.1 = 41.920 (+4.600 m)
-- Codul de pe ramură (runda 4) nu mai permite asta pe viitor (o cifră nouă din planșă scoate rândul din 'validat'), dar NU
-- repară retroactiv aceste 3 rânduri: la o recitire cu aceleași cifre, referința e cantitate_plansa existentă (2.210 etc.),
-- deci nu se schimbă nimic. De aceea, SQL-ul de mai jos le trece pe 'diferenta' ca omul să le revalideze văzând ambele cifre.
-- Rândul 9 (CAD, 'validat' automat pe 28.08) NU e aici — e o decizie separată (§6).
--
-- Garda: doar rândurile încă 'validat' și NEATINSE de la transfer (updated_at în batch-ul din 15.09 15:19:52–54). Dacă
-- între timp cineva le-a revalidat (updated_at nou), ies din filtru — validarea lui e dată pe cifrele de acum.
-- Efect în UI: 📋 Cantități arată ⚠ diferență pe 3 rânduri; poarta graficului lic. 3 rămâne block (era block oricum:
-- rândul 1 e 'diferenta', iar cele 6 fronturi din 04.09 n-au legătură cu rândurile).
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════

-- (0) PREVIEW — așteptat la 26.09.2026: 3 rânduri (2, 3, 4).
SELECT id, status, tip_sursa, left(denumire, 50) AS denumire, cantitate, cantitate_plansa,
       round(cantitate_plansa - coalesce(cantitate, 0), 2) AS dif_m, updated_at, left(coalesce(diferenta_nota, ''), 80) AS nota
  FROM ofertare_cantitati
 WHERE licitatie_id = 3 AND id IN (2, 3, 4) AND status = 'validat'
   AND cantitate_plansa IS NOT NULL AND abs(cantitate_plansa - coalesce(cantitate, 0)) >= 1
   AND updated_at BETWEEN '2026-09-15 15:19:52+00' AND '2026-09-15 15:19:54+00'
 ORDER BY id;

-- (1) APLICARE — o singură instrucțiune (o tranzacție). Idempotentă: după aplicare rândurile nu mai sunt 'validat'.
--     RETURNING = lista pentru rollback (id + updated_at-ul VECHI).
WITH vechi AS (
  SELECT id, updated_at FROM ofertare_cantitati
   WHERE licitatie_id = 3 AND id IN (2, 3, 4) AND status = 'validat'
     AND cantitate_plansa IS NOT NULL AND abs(cantitate_plansa - coalesce(cantitate, 0)) >= 1
     AND updated_at BETWEEN '2026-09-15 15:19:52+00' AND '2026-09-15 15:19:54+00'
   FOR UPDATE
), u AS (
  UPDATE ofertare_cantitati q SET
    status = 'diferenta',
    diferenta_nota = '[R5-revalidare 26.09.2026: validat ÎNAINTE de transferul planșei 1.1 din 15.09 — cifra din planșă n-a fost văzută la validare; verifică și revalidează] '
                     || coalesce(q.diferenta_nota, ''),
    updated_at = now()
  FROM vechi v WHERE q.id = v.id
  RETURNING q.id, v.updated_at AS updated_at_vechi, q.cantitate, q.cantitate_plansa
)
SELECT count(*) AS n, array_agg(id ORDER BY id) AS ids, json_agg(json_build_object('id', id, 'updated_at_vechi', updated_at_vechi) ORDER BY id) AS pentru_rollback
  FROM u;

-- (2) SANITY — așteptat: 3 rânduri 'diferenta', nota începe cu marcajul; 0 rânduri 'validat' cu cifra din planșă nevăzută.
-- SELECT id, status, left(diferenta_nota, 60) FROM ofertare_cantitati WHERE licitatie_id = 3 AND id IN (2, 3, 4) ORDER BY id;

-- (R) ROLLBACK EXACT (status, notă, updated_at-ul de dinainte; valorile din SELECT-ul de pe 26.09.2026 = pentru_rollback):
-- UPDATE ofertare_cantitati q SET
--   status = 'validat',
--   diferenta_nota = NULLIF(replace(q.diferenta_nota, '[R5-revalidare 26.09.2026: validat ÎNAINTE de transferul planșei 1.1 din 15.09 — cifra din planșă n-a fost văzută la validare; verifică și revalidează] ', ''), ''),
--   updated_at = v.u
-- FROM (VALUES (2::bigint, '2026-09-15 15:19:53.008+00'::timestamptz), (3, '2026-09-15 15:19:53.032+00'), (4, '2026-09-15 15:19:53.053+00')) AS v(id, u)
-- WHERE q.id = v.id AND q.licitatie_id = 3 AND q.status = 'diferenta'
--   AND q.diferenta_nota LIKE '[R5-revalidare 26.09.2026:%'
-- RETURNING q.id, q.status, q.updated_at;
