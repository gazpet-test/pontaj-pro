# noutati-mail — scoaterea secretului din cod (07.10.2026)

**Problema:** funcția `noutati-mail` (v8 pe live, `verify_jwt = false`) avea secretul de acces scris direct în cod, iar aceeași valoare era copiată în clar în `claude_context` #990. Oricine o vedea putea porni trimiterea tuturor rândurilor netrimise din `platforma_noutati` (doar destinatarii din rânduri, dar fără control).

**Ce face PR-ul:**
- `supabase/functions/noutati-mail/index.ts` (funcția intră pentru prima dată în repo): secretul se citește din `NOUTATI_SECRET` (Edge Secrets), comparat în timp constant. Dacă secretul lipsește sau are sub 24 de caractere, calea cu secret e închisă (fail-closed) și rămâne doar JWT de owner.
- `titlu` și `descriere` sunt escapate în HTML-ul mailului (înainte erau interpolate direct).
- Restul comportamentului e identic cu v8 (Resend, `trimis_la`, un mail per rând).

**Ordinea de livrare (doar cu OK-ul lui Răzvan):**
1. Răzvan setează în Supabase → Edge Functions → Secrets `NOUTATI_SECRET` = o valoare NOUĂ, aleatoare (min. 24 caractere). Valoarea veche se consideră compromisă.
2. Deploy `noutati-mail` din acest branch (v9).
3. Test: apel fără header → 401, apel cu valoarea veche → 401, apel cu cea nouă și coadă goală → `procesate: 0`.
4. Ștergerea valorii vechi din `claude_context` #990 (UPDATE cu preview + OK — e scriere în date).
5. Rând nou / actualizat în `registru_automatizari` + `public.automatizari` (fișa a–e).

Până la pasul 2 nimic nu se schimbă pe live.
