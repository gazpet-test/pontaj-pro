# Corecție vizuală — Modulul Administratorului

Referință: randarea deschisă acceptată de Răzvan, reconfirmată prin captura din 22.09.2026.

- Fundal gri-albastru deschis, carduri albe, text închis și accente discrete.
- Trei contoare alăturate, mesaj vizibil pentru surse incomplete/date lipsă, refresh manual.
- Alerte compacte și linkuri scurte; detaliile rămân expandabile.
- Sub 760 px, aprobările trec sub alerte. Desktop: două coloane.
- Modificat doar componentul de prezentare. Drepturile, interogările, clasificarea, ordinea și paginarea rămân identice.

## Capturi din componenta reală, cu date demonstrative

Capturile nu sunt dintr-o sesiune autentificată de producție și nu includ bara globală ERP. Aceasta rămâne neschimbată.

[Mobil 360 px](admin-design-360.png) · [Desktop 1280 px](admin-design-1280.png)

Verificat în Chromium: fără overflow la ambele dimensiuni, fără erori JS, filtre, detalii, refresh, sursă cu eroare (6/7), lipsă acces (zero interogări). Suita existentă: 340 teste trecute în UTC; build trecut. Fără modificări BD sau de drepturi. Clasificarea celor 77 de alerte critice nu face parte din această corecție.

Review vizual de către Răzvan înainte de merge. Fără merge automat.
