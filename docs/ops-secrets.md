# Secrete operaționale — unde trăiesc (fără valori!)

| Secret | Vercel env | Supabase Edge secrets | Folosit de |
|---|---|---|---|
| SEAP_IMPORT_SECRET | ✅ | ✅ (din 01.09.2026) | api/seap-import.js, api/plansa-felii.js (header x-import-secret); supabase/functions/hr-autorizatii-scan (header x-hr-secret) |
| SUPABASE_SERVICE_ROLE_KEY | ✅ | (implicit) | api/* server-side |
| RESEND_API_KEY | — | ✅ | recrutare-aplica, noutati-mail, normative-scan-lunar |
| ANTHROPIC_API_KEY | — | ✅ | contracte-ai, citeste-orice, normative-scan-lunar etc. |
| OLX_CLIENT_ID / OLX_CLIENT_SECRET | — | ⏳ (după aprobarea aplicației OLX) | olx-api |

Notă: env-urile Vercel se activează abia la următorul deploy (serverless le îngheață la build).
