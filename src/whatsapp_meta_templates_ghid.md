# 📱 WhatsApp Business — Submission Templates Meta

**Status**: Gazpet Instal SRL verificat ✅ (ID 2029862804284271, 16.05.2026)

## ☎️ Numărul WhatsApp Business — opțiuni

**Meta NU cere abonament**. Orice cartelă pre-paid merge dacă:
- E activă la momentul setup (5 min, pentru SMS verification)
- Numărul NU are WhatsApp instalat (personal sau business)

**Opțiuni Gazpet**:
1. ✅ **Recomandat**: numărul Skedit eliberat (uninstall WhatsApp + șterge cont + pauză 1-2h)
2. ✅ Cartelă pre-paid veche pe care o ai în sertar (SIM activ, fără WhatsApp)
3. 💸 Cartelă nouă pre-paid (5-10 lei one-time, doar dacă nu ai variantele 1/2)

**După setup**: SIM-ul poate sta în sertar. Comunicarea cu Meta = API, nu SMS. Zero cost lunar pe SIM.

## 🎯 Procedura submission

Pentru fiecare template:

1. Meta Business Suite → **WhatsApp Manager** → **Message Templates** → **Create Template**
2. **Category**: `Utility` (NU Marketing — Utility are aprobare mai rapidă și fără opt-in)
3. **Language**: `Romanian (ro)`
4. **Name**: exact ca în coloana „Nume template" de mai jos (snake_case)
5. **Header**: opțional, lasă gol (Body e suficient)
6. **Body**: copy-paste din coloana „Body" (cu `{{1}}`, `{{2}}` etc.)
7. **Footer**: opțional — recomand `Gazpet ERP · pontaj-pro-sooty.vercel.app`
8. **Buttons**: skip pentru MVP (le adăugăm v2)
9. **Sample values**: când cere, dă exemple plauzibile (folosesc valori reale de la noi)

Review Meta: 1-3 zile per template. Trimite toate 10 deodată.

---

## 📋 Template 1 — `document_expires_soon`

**Categorie**: Utility | **Tier**: critic, manager

**Body**:
```
⚠️ *Gazpet ERP - Document expiră curând*

Salut {{1}}!

Documentul *{{2}}* pentru *{{3}}* expiră pe *{{4}}* ({{5}} zile).

🔗 Verifică în app: https://pontaj-pro-sooty.vercel.app/logistica
```

**Sample values**:
- {{1}} = `Răzvan`
- {{2}} = `ITP`
- {{3}} = `PH 22 GZP`
- {{4}} = `20 mai 2026`
- {{5}} = `4`

---

## 📋 Template 2 — `stoc_carburant_alert`

**Categorie**: Utility | **Tier**: critic, manager

**Body**:
```
⛽ *Gazpet ERP - Alertă stoc carburant*

{{1}} are *{{2}}L* din capacitatea de {{3}}L ({{4}}%).

Ultima alimentare: {{5}}.

🔗 https://pontaj-pro-sooty.vercel.app/logistica
```

**Sample values**:
- {{1}} = `Gazpet - Oscar 1`
- {{2}} = `2500`
- {{3}} = `30000`
- {{4}} = `8`
- {{5}} = `13 mai 2026`

---

## 📋 Template 3 — `transport_aprobat`

**Categorie**: Utility | **Tier**: critic, manager, hr_contabil, info

**Body**:
```
✅ *Gazpet ERP - Transport aprobat*

Cererea ta de transport pentru *{{1}}* a fost APROBATĂ.

Detalii:
- Pornire: {{2}}
- Destinație: {{3}}
- Aprobat de: {{4}}

🔗 https://pontaj-pro-sooty.vercel.app/logistica
```

**Sample values**:
- {{1}} = `20 mai 2026, 08:00`
- {{2}} = `Sediul Gazpet`
- {{3}} = `Șantier Mihăești`
- {{4}} = `Mitrache Alexandru`

---

## 📋 Template 4 — `transport_blocat`

**Categorie**: Utility | **Tier**: critic, manager

**Body**:
```
🚨 *Gazpet ERP - Transport BLOCAT*

Transportul {{1}} ({{2}}) e blocat pe status *{{3}}* de {{4}} zile.

Ultima modificare: {{5}}

🔗 Verifică: https://pontaj-pro-sooty.vercel.app/logistica
```

**Sample values**:
- {{1}} = `#234`
- {{2}} = `Materiale Mihăești`
- {{3}} = `aprobat`
- {{4}} = `3`
- {{5}} = `13 mai 2026, 14:30`

---

## 📋 Template 5 — `revizie_aproape`

**Categorie**: Utility | **Tier**: critic, manager

**Body**:
```
🔧 *Gazpet ERP - Revizie aproape*

Utilajul *{{1}}* are revizia aproape de scadență:
- Tip: {{2}}
- Scadență: {{3}}
- {{4}}

🔗 Programează: https://pontaj-pro-sooty.vercel.app/logistica
```

**Sample values**:
- {{1}} = `EXCAVATOR JCB PH 24 GZP`
- {{2}} = `Revizie 500h`
- {{3}} = `peste 50 ore lucrate`
- {{4}} = `Service preferat: Renomar Construct`

---

## 📋 Template 6 — `alimentare_anomalie`

**Categorie**: Utility | **Tier**: critic

**Body**:
```
⚠️ *Gazpet ERP - Anomalie alimentare*

{{1}} la alimentarea din {{2}}:
- Cantitate: {{3}}L
- Cost: {{4}} lei
- Consum mediu: {{5}} ({{6}}% peste medie)

🔗 https://pontaj-pro-sooty.vercel.app/logistica
```

**Sample values**:
- {{1}} = `PH 22 GZP`
- {{2}} = `15 mai 2026`
- {{3}} = `250`
- {{4}} = `1675`
- {{5}} = `35 L/100km`
- {{6}} = `45`

---

## 📋 Template 7 — `ordin_deplasare_lipsa`

**Categorie**: Utility | **Tier**: critic, hr_contabil

**Body**:
```
📋 *Gazpet ERP - Ordin deplasare lipsă*

{{1}} are diurnă bifată pentru *{{2}}* dar NU are ordin de deplasare generat.

Generează acum din PontajPRO → Diurne.

🔗 https://pontaj-pro-sooty.vercel.app/pontaj
```

**Sample values**:
- {{1}} = `POPESCU ION`
- {{2}} = `14 mai 2026`

---

## 📋 Template 8 — `concediu_aprobare`

**Categorie**: Utility | **Tier**: critic, manager, hr_contabil

**Body**:
```
🌴 *Gazpet ERP - Concediu spre aprobare*

{{1}} a cerut concediu:
- Tip: {{2}}
- Perioada: {{3}} → {{4}} ({{5}} zile)
- Motiv: {{6}}

🔗 Aprobă: https://pontaj-pro-sooty.vercel.app/hr
```

**Sample values**:
- {{1}} = `MIHALCEA ANA`
- {{2}} = `Concediu odihnă`
- {{3}} = `1 iunie 2026`
- {{4}} = `7 iunie 2026`
- {{5}} = `7`
- {{6}} = `Vacanță familie`

---

## 📋 Template 9 — `plata_diurne_urgent`

**Categorie**: Utility | **Tier**: critic, hr_contabil

**Body**:
```
💰 *Gazpet ERP - Plată diurne urgentă*

Diurnele pentru *{{1}}* (suma totală: *{{2}} lei*, {{3}} angajați) NU au fost încă marcate ca plătite.

Ultima zi recomandată: {{4}}

🔗 https://pontaj-pro-sooty.vercel.app/pontaj
```

**Sample values**:
- {{1}} = `aprilie 2026`
- {{2}} = `28450`
- {{3}} = `47`
- {{4}} = `25 mai 2026`

---

## 📋 Template 10 — `login_admin_suspect`

**Categorie**: Utility | **Tier**: critic

**Body**:
```
🔐 *Gazpet ERP - Login admin nou*

Account {{1}} (rol: {{2}}) s-a logat de pe IP nou: {{3}}

- Locație: {{4}}
- Browser: {{5}}
- Data: {{6}}

Dacă NU ești tu, schimbă parola imediat!

🔗 https://pontaj-pro-sooty.vercel.app
```

**Sample values**:
- {{1}} = `razvan@gazpet.ro`
- {{2}} = `superadmin`
- {{3}} = `188.27.45.123`
- {{4}} = `Brașov, RO`
- {{5}} = `Chrome 138 / Windows 11`
- {{6}} = `16 mai 2026, 14:30`

---

## ⏱️ Timeline așteptat

| Pas | Durată |
|---|---|
| Submit toate 10 templates | 30 min (10 × 3 min) |
| Review Meta primul template | 1-3 zile |
| Restul aprobate în paralel | 1-3 zile (toate odată) |
| **TOTAL până la „toate aprobate"** | **3-5 zile** |

## 📝 După ce ai TOATE aprobate

Vino la mine cu:
1. ✅ Confirmare că toate 10 sunt aprobate
2. 🔑 **Permanent Token** din Meta Business Manager → System Users
3. 📞 **Phone Number ID** din WhatsApp Manager → API Setup

Eu fac:
1. Adăug 2 secrets în Supabase: `META_TOKEN` + `META_PHONE_NUMBER_ID`
2. Deploy Edge Function `/notify-whatsapp`
3. Trigger BD automat + pg_cron pentru verificări zilnice
4. Test pilot pe tine → activare treptată echipa

## 🎯 Bonus pași opționali

**Verificare „green tick" brand**:
- Meta Business Suite → Settings → Display Name
- Dacă numele firmei poate fi verificat → cerere green tick (mai trustworthy pentru destinatari)

**Display name în WhatsApp**:
- Setezi „Gazpet ERP" sau „Gazpet Instal" în Account Setup
- Apare ca expeditor în loc de numărul rece

---

📌 Salvează acest ghid + iterează prin templates în Meta în ritmul tău. 🚀
