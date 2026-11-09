-- Registru automatizări + rândul #133 din public.automatizari, după deploy-ul edge-ului ofertare-rc-necitit cu destinatarii noi
-- (decizia Răzvan 28.10.2026, varianta B). Se rulează DOAR după deploy (descrie starea live). Gărzile: înlocuire numai dacă textul vechi e
-- încă acolo (altfel 0 rânduri — nimic suprascris). Fără valori de secrete.
UPDATE public.claude_docs
SET content_md = replace(content_md,
  '- **(b) Scrie:** notifications (≤1 clopoțel/zi/licitație/destinatar), ofertare_alerte_amprenta; mail Resend ≤1/zi/licitație către owner + responsabil (destinatari interni ficși), Idempotency-Key fix. Nu atinge bani/drepturi.',
  '- **(b) Scrie:** notifications (≤1 clopoțel/zi/licitație/destinatar), ofertare_alerte_amprenta; mail Resend ≤1/zi/licitație, Idempotency-Key fix. Nu atinge bani/drepturi.' || chr(10) ||
  '- **Destinatari mail (din 28.10.2026, decizia Răzvan, varianta B):** TO = responsabilul licitației (ofertare_licitatii.responsabil_id → profiles.email), CC = owner-ul principal razvan.trusu@ (doar el, verificat în profiles.is_owner); fără responsabil / fără email @gazpet.ro valid → TO = owner-ul principal, cu „FĂRĂ RESPONSABIL” în subiect și corp. Adresele vin doar din BD, doar @gazpet.ro, niciodată din documente. Clopoțelul neschimbat. Cod: supabase/functions/ofertare-rc-necitit/destinatari.ts (+ teste).')
WHERE slug = 'registru_automatizari'
  AND position('- **(b) Scrie:** notifications (≤1 clopoțel/zi/licitație/destinatar), ofertare_alerte_amprenta; mail Resend ≤1/zi/licitație către owner + responsabil' in content_md) > 0
RETURNING slug, md5(content_md), octet_length(content_md);

UPDATE public.automatizari
SET ce_scrie = 'notifications (cel mult 1 clopoțel / zi / licitație / destinatar; altul în aceeași zi doar la document nou), ofertare_alerte_amprenta (fel rc_necitit / rc_necitit_mail). Mail Resend cel mult 1 / zi / licitație, cheie de idempotență fixă rc-necitit-<licitație>-<zi>. Destinatari (din 28.10.2026, varianta B): TO = responsabilul licitației, CC = owner-ul principal (razvan.trusu@); fără responsabil / email invalid → TO = owner-ul principal + „FĂRĂ RESPONSABIL”. Adrese doar din profiles, doar @gazpet.ro, niciodată din conținutul documentelor. Nu atinge bani, drepturi sau date de ofertă.',
    ce_face = 'Pentru licitațiile active cu termen viitor, găsește răspunsurile la clarificări rămase necitite (regula comună ofertare_rc_doc_stare din 20261104a: necitit / perechi necitite / text OCR neverificat) și trimite: ziua 1 clopoțel „critical” la responsabil, din ziua 2 și la owner; mail la responsabil (CC owner-ul principal) când sunt ≤ 5 zile până la depunere. Se oprește singur când documentul e citit.',
    referinta = referinta || '; destinatari mail varianta B: PR ofertare-rc-mail-destinatari (28.10.2026)',
    verificat_la = current_date, updated_at = now()
WHERE id = 133 AND cod = 'cron_ofertare_rc_necitit' AND position('varianta B' in ce_scrie) = 0
RETURNING id, verificat_la;
