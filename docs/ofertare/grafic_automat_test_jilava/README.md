# Test 24.11.2026: grafic automat pe licitația 93 (Jilava)

Dovezile pentru `../GRAFIC_AUTOMAT_SPEC.md` §11. Testul a fost făcut doar prin citire: nu s-a scris nimic în ERP.

## Graficul X: cel depus în ofertă (REV 0, făcut manual în MS Project)
| Fișier | Ce conține |
|---|---|
| `grafic_X_depus_rev0.txt` | Graficul, citit din `.mpp` cu `scripts/grafic/import_mpp.py --test-parsare` (MPXJ). |
| `verdict_jakarinos_X.md` | Verdictul lui Jakarinos (Codex, prin `run_paw.cmd jak`, verificare oarbă): **NO-GO**. A găsit 19 neconformități, printre ele toate cele 5 constatări ale comisiei (solicitarea 407). |

## Graficul Y: generat de AI
Generatorul (Claude) a lucrat doar cu:
- documentele beneficiarului: fișa de date, PT, PCC, caiete de sarcini, memoriu, liste de cantități;
- cerințele extrase de ERP;
- F3.

A rulat în mod „schiță”: duratele care lipsesc sunt marcate `PRESUPUS`.

| Fișier | Ce conține |
|---|---|
| `grafic_Y_ai.txt` | Graficul Gantt, cu executant și sursa fiecărei durate. |
| `grafic_Y_pert.txt`, `grafic_Y_drum_critic.txt`, `cpm.py` | Calculul CPM. Calendarul e luni–vineri, **fără sărbători**: asta e una dintre neconformitățile găsite. |
| `cereri_date.md` | Cele 23 de întrebări pe care platforma le-ar pune omului. |
| `note_generator.md` | Deciziile de succesiune, fiecare cu documentul pe care se bazează. |
| `verdict_jakarinos_Y.md` | **NO-GO**, cu 12 neconformități. Succesiunea principală e confirmată corectă. |

## Șablonul de brief al verificatorului
`brief_verificator.md` este brief-ul folosit pentru Y. Cel pentru X diferă doar prin descrierea fișierelor.

Contextul dat lui Jakarinos (fișa de date, PT, PCC, cerințe) se află în `C:\Users\Public\paw-data\brief\jilava_ctx\` pe serverul AI. Nu e copiat în repo: documentele licitației stau pe NAS (`Oferte/5.DIFERITI BENEFICIARI/Primaria JILAVA jud.Ilfov`).
