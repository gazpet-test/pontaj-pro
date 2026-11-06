# Contul Claude de dezvoltare (redari@gazpet.ro) — reguli

Decizia lui Răzvan (06.11.2026): un abonament **Max separat**, pe redari@gazpet.ro, este **contul de dezvoltare pentru
toate modulele** (Redări, Ofertare, HR, Logistica, Magazie etc.). Răzvan vorbește cu **un singur chat** (contul
principal, sesiunea de coordonare); contul redari@ nu are chat propriu: chat-ul îi pornește rulări de cod în spate.
Nu se rotește cu contul principal ca să ocolească limitele: are rolul lui (scrie cod), chat-ul are al lui (coordonează).

## Cum lucrează
- Chat-ul pornește o rulare: `powershell -File C:\Users\Gazpet-Ai\claude-redari\rdr.ps1 -Brief <paw-data\brief\...md> -Slug <nume>`.
  Rularea e Claude Code headless (`claude -p`) cu `CLAUDE_CONFIG_DIR=C:\Users\Gazpet-Ai\.claude-redari`, în clona
  `C:\Users\Gazpet-Ai\gazpet-erp-redari`, pornind de pe `main` proaspăt; rezultatul în `paw-data\out\rdr_<slug>.json`.
- O singură rulare odată (lock `paw-data\lock_rdr`); un modul = o sarcină în lucru.
- Agentul face: branch cu prefixul modulului, cod, teste (`npx vitest run` + `npx vite build`), push, PR **draft**.
- NU face: merge, aplicare de migrări, deploy, secrete, date reale, mailuri. Acestea rămân la chat (cu „treci pe manual”
  și „da”-ul lui Răzvan unde trebuie).
- Review-ul rămâne la Jakarinos + Copilot/Gemini; Codex web lucrează în paralel, ca până acum.
- Starea fiecărui modul stă în `claude_docs` (handoff-uri), nu în memoria conturilor.

## Pornire (făcută 06.11.2026)
- Login o singură dată: `Desktop\Claude Redari.cmd` → `/login` cu redari@gazpet.ro → `/exit`.
- Verificat: `.claude-redari\.claude.json` → cont redari@gazpet.ro; rulare de test „TEST OK main”.
- Pe contul redari@ NU se conectează Gmail (contul de dezvoltare nu trimite mailuri).