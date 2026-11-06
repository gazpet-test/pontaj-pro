# Secrete operaționale — unde trăiesc (fără valori!)

| Secret | Vercel env | Supabase Edge secrets | Folosit de |
|---|---|---|---|
| SEAP_IMPORT_SECRET | ✅ | ✅ (din 01.09.2026) | api/seap-import.js, api/plansa-felii.js (header x-import-secret) |
| HR_AUTORIZATII_SCAN_PAROLA | — | de configurat de Răzvan | hr-autorizatii-scan, header x-hr-secret; apelanți server din același secret / Vault |
| HR_DIGEST_SAPTAMANAL_PAROLA | — | de configurat de Răzvan | hr-digest-saptamanal, header x-hr-secret; cron din Vault cu același nume |
| SUPABASE_SERVICE_ROLE_KEY | ✅ | (implicit) | api/* server-side |
| RESEND_API_KEY | — | ✅ | recrutare-aplica, noutati-mail, normative-scan-lunar |
| ANTHROPIC_API_KEY | — | ✅ | contracte-ai, citeste-orice, normative-scan-lunar etc. |
| OLX_CLIENT_ID / OLX_CLIENT_SECRET | — | ⏳ (după aprobarea aplicației OLX) | olx-api |

Notă: env-urile Vercel se activează abia la următorul deploy (serverless le îngheață la build).

Rotația HR nu a fost executată: pașii și inventarul apelanților sunt în
[`SECURITATE_ROTIRE_PAROLE_HR.md`](SECURITATE_ROTIRE_PAROLE_HR.md). HR nu mai acceptă
`SEAP_IMPORT_SECRET`, `HR_DIGEST_SECRET` sau cheia service_role ca alternativă la parolă.

## Noutăți mail (PR633, actualizat peste main)

`NOUTATI_SECRET`: exclusiv Supabase Edge Secrets pentru funcție; Vault pentru un eventual apelant SQL. Fără valoare în repo, Vercel sau frontend. Configurarea/rotația nu au fost executate. Vezi `NOUTATI_MAIL_SECRET.md`.
