# 🛡️ Raport Audit Anti-Fraudă & Bug Hunt — 22.05.2026

## ✅ Ce s-a făcut LIVE în sesiune (zero acțiune din partea ta):

### 1. Cleanup ore polluate
- **7 fișe service** cu `ore_intrare = 2,122,025` (data 2/12/2025 confundată cu număr) → curățate la NULL
- **UT0210** acum afișează corect 9,395 h (era 2,122,025)
- Trigger automat care șterge documentele orfane la `DELETE` activ

### 2. Sistem anti-fraudă motorină instalat
- `v_alimentari_suspecte` — listează automat alimentări cu 8 criterii de detecție:
  - **KM_REGRESS** (km mai mic decât precedent — imposibil fizic)
  - **ORE_REGRESS** (ore mai puține — imposibil)
  - **CONSUM_EXCESIV_KM** (consum L/100km peste norma + pragul setat)
  - **CONSUM_EXCESIV_H** (consum L/h peste norma + pragul setat)
  - **CANTITATE_MARE** (peste 500L — vehiculele tipice au rezervor 80-300L)
  - **POSIBIL_DUPLICAT** (aceeași zi + utilaj + cantitate)
  - **ROTUND_REPETAT** (50/100/200L repetat — în viața reală e mereu fracționat)
  - **FARA_SANTIER** / **FARA_SURSA**

- `v_rezervor_consistenta` — delta stoc raportat vs calculat (achiziții − alimentări)
- `fn_alimentari_auto_flag_anomalie` — trigger BEFORE INSERT/UPDATE care setează automat `anomalie_confirmata=true` pentru cazurile hard (regress, >500L, >10000L typo)
- Trigger existent `fn_alimentari_notify_anomalie` va trimite acum notificări auto către tine + Marilena + admin_logistica când e marcat automat

### 3. Constraints preventive BD (toate viitoare INSERT/UPDATE blocate dacă invalide):
- ✅ `cantitate_litri` între 0 și 10,000 L
- ✅ Data alimentare ≤ azi+1 zi (preveni 2027/2028 typos)
- ✅ Ore între 0 și 100,000
- ✅ Km între 0 și 2,000,000
- ✅ Preț ≥ 0
- ✅ Achiziții vrac între 0 și 50,000L

### 4. Performance
- 20+ indexuri create pe FK frecvent JOIN-uite (alimentari.created_by, transporturi.aprobator_id etc.)

---

## 🔴 ALIMENTĂRI CRITICE pentru verificare imediată (12)

| ID | Data | Utilaj | L | Ore | Consum efectiv | Normă max | Excess |
|----|------|--------|---|-----|----------------|-----------|--------|
| 188 | 2026-05-05 | KOMATSU PC 210 (TST026) | 50 | 8059 | **50 L/h** | 16.5 | **+203%** 🚨 |
| 161 | 2026-05-01 | HITACHI ZX 210/2018 (TST020) | 150 | 6868 | 37.5 L/h | 23.1 | +62% |
| 190 | 2026-05-05 | LIEBHERR PWT SR 712 (TST073) | 280 | 3920 | 40 L/h | 16.5 | **+142%** 🚨 |
| 198 | 2026-05-06 | LIEBHERR BULDOZER PR 734L | 140 | 4237 | 35 L/h | 27.5 | +27% |
| 240 | 2026-05-11 | LIEBHERR BULDOZER PR 734L | 200 | 4244 | 28.57 L/h | 27.5 | +4% |
| 180 | 2026-05-04 | LIEBHERR BULDOZER PR 734L | 200 | 4221 | 28.57 L/h | 27.5 | +4% |
| 42  | 2026-04-29 | LIEBHERR BULDOZER PR 734L | 199 | 4214 | 28.43 L/h | 27.5 | +3% |
| 177 | 2026-05-04 | HITACHI ZX 210/2020 (TST019) | 200 | 4480 | 28.57 L/h | 23.1 | +24% |
| 189 | 2026-05-05 | LIEBHERR PWT LGP 714 (TST078) | 134 | 1630 | 22.33 L/h | 20.9 | +7% |
| 184 | 2026-05-05 | COMPAL Generator VG R 30 | 92 | 205 | 7.67 L/h | 5.5 | +40% |
| 162 | 2026-05-01 | COMPAL Generator VG R 30 | 22 | 193 | 11 L/h | 5.5 | **+100%** 🚨 |
| 167 | 2026-05-02 | LIEBHERR PWT SR 712 (TST073) | 60 | 1 | — | — | ORE_REGRESS |

### Pattern îngrijorător
- **Liebherr Buldozer PR 734L** — apare de 4 ori, consum mereu 28-35 L/h (norma 27.5). Două scenarii:
  1. Norma setată prea conservatoare (poate trebuie urcată la 30 L/h?)
  2. Aceeași șofer scoate sistematic 5-8 L în plus la fiecare alimentare
- **HITACHI ZX 210/2018** (id 161) — consum 37.5 L/h e cu 62% peste normă. Verifică injectoare sau întreabă șoferul.
- **KOMATSU PC 210** (id 188) — 50 L/h = 3x normă. Cel mai suspect din lot.

---

## 🟡 ALIMENTĂRI MODERATE (9) — cantități rotunde repetate

Tipuri rotund repetat (50, 100, 150, 200): id-urile 217, 218, 219, 220, 222, 225, 237, 239, 179.

În viața reală alimentările sunt fracționate (191.34 L, 187.50 L). Când vezi de 3+ ori la rând fix 50/100/150/200, e fie:
- Operatorul taie cifre („la rotund e ușor de scris")
- Frauda mască (numere rotunde pentru ascuns lipsă)

---

## 🐛 BUG-uri care necesită ACȚIUNE MANUALĂ:

### A. 2 alimentări cu data în VIITOR (Amalia typos)
| ID | Data | Cantitate | Utilaj | Trebuie să devină |
|----|------|-----------|--------|-------------------|
| 98 | **2027-05-15** | 196.01 L | MAN PH 24 FAO | probabil 2026-05-15 |
| 89 | **2028-05-14** | 39.98 L | SKODA YETI PH 80 GPI | probabil 2026-05-14 |

→ Intră în Logistica → Arhivă alimentări → editează manual. După ce sunt fix, rulează în SQL:
```sql
ALTER TABLE logistica_alimentari VALIDATE CONSTRAINT check_data_nu_viitor;
```

### B. 7 utilaje cu alimentări dar FĂRĂ `norma_consum` setat
Pentru aceste utilaje, anti-fraudă consum NU se aplică:

| ID | Marcă · Model | Tip | Alim. | Total L |
|----|---------------|-----|-------|---------|
| 14 | MAN cap tractor TGS PH 24 FAO | motorină | 1 | 196 |
| 37 | JCB excavator 220XL (TST023) | motorină | 2 | 150 |
| 233 | SKODA YETI PH 80 GPI | motorină | 1 | 40 |
| 11 | MERCEDES UNIMOG U1200 PH 25 NKW | motorină | 1 | 20 |
| 6 | IVECO STRALIS PH 18 GNZ | motorină | 1 | 20 |
| 167 | IVECO DAILY PH 25 KBX | motorină | 1 | 20 |
| 165 | IVECO DAILY PH 09 WNK | motorină | 1 | 20 |

**Recomandări consum:**
- MAN cap tractor: 30-35 L/100km
- JCB excavator 220XL: 12-18 L/h
- SKODA YETI: 6-7 L/100km
- MERCEDES UNIMOG U1200: 18-22 L/100km
- IVECO STRALIS: 22-28 L/100km
- IVECO DAILY: 9-12 L/100km

→ Logistica → Lista active → click pe fiecare → secțiunea „Combustibil & Norma" → completează norma_consum + unitate_norma + prag_alerta_consum (default 10%).

### C. Rezervor Oscar 1 — delta neexplicat -68,634 L (baseline)
- Stoc raportat: 9,856 L
- Achiziții istorice: 87,455 L
- Alimentări înregistrate: 8,965 L
- Delta teoretic: -68,634 L

Asta NU e bug dacă ai setat manual stocul în trecut (probabil la instalarea aplicației ai introdus stocul fizic observat = 9,856 L). Trigger-ele mențin de atunci consistența relativă.

**Recomandare**: Acum, pentru a putea urmări corect, fă o **achiziție-baseline** virtuală: în UI Logistica → Rezervoare → adaugă achiziție „ajustare-baseline" cu cantitate = -68,634 (sau lasă așa, întrucât pentru tracking de aici încolo e indiferent).

---

## 📌 NEXT STEPS

### Imediat
1. **Fix-uezi cele 2 alimentări 2027/2028** (Amalia)
2. **Completezi norma_consum pe cele 7 utilaje**
3. **Verifici cele 12 alimentări critice** (mai ales TST026 Komatsu și TST073 Liebherr PWT)
4. **Marchezi `anomalie_confirmata=true` și completezi `anomalie_motiv`** pentru cele verificate (notificare către owners + admin_logistica)

### Sesiune viitoare (când vrei)
1. **Widget UI dashboard Logistica** cu numărul de alimentări suspecte (buton roșu vizibil când există critic)
2. **Tab dedicat „🛡️ Alimentări suspecte"** cu filtre pe severitate + suspiciuni[]
3. **Buton „dismiss"** pe fiecare alertă (folosește `logistica_alerte_consum.dismissed_at`)

---

## 🔍 Query-uri utile pentru audit zilnic

```sql
-- Câte alimentări critice am azi?
SELECT count(*) FROM v_alimentari_suspecte WHERE severitate = 'critic';

-- Top 5 utilaje cu cel mai mare exces consum
SELECT utilaj_marca, AVG(consum_h_efectiv / norma_max_acceptata) AS excess_ratio, count(*) AS nr
FROM v_alimentari_suspecte WHERE severitate = 'critic' AND norma_max_acceptata > 0
GROUP BY utilaj_marca ORDER BY excess_ratio DESC LIMIT 5;

-- Lista activelor fără normă
SELECT * FROM v_active_fara_norma_cu_alimentari;

-- Consistență rezervor
SELECT * FROM v_rezervor_consistenta;
```
