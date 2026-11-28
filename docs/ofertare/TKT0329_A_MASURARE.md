# TKT-2026-0329 A — măsurarea semnalelor „aceeași cantitate, documente diferite” (șablon, spec §5.6)

Măsurarea se face DUPĂ aplicarea migrării `20270112a`, deploy-ul edge-ului `ofertare-cantitati-extrage` (PR-extragere) și îmbinarea PR-UI,
pe **3 licitații reale**, cu contul de test, de către coordonator. Rezultatul completat se scrie în `paw-data\out` (nu în repo: cifrele reale,
numele licitațiilor și ale documentelor nu intră în repo-ul public). Acest fișier e doar șablonul și regula de numărare.

## Ce se numără pe fiecare licitație

| Contor | Definiție | De unde se citește |
|---|---|---|
| Semnale corecte | verdict `diferenta` confirmat de om ca diferență reală între F3 și documentul B (aceeași măsură: lot, obiect, element, natură, UM) | ecranul „📏 Cantități între documente” din fișa licitației → tabelul pe măsură + dovezile ambelor părți |
| Semnale false | verdict `diferenta` pe o potrivire greșită (alt obiect, altă natură, total față de tronson, diametru luat drept cantitate etc.) | același ecran; se notează motivul potrivirii greșite |
| Diferențe reale ratate | diferențe între F3 și documentele B care NU au primit `diferenta` — verificate MANUAL pe o mostră de **10 măsuri** alese la întâmplare din `in_regula` + `de_verificat` + `neverificat` | tabelul pe măsură + documentele originale (📎) |
| `neverificat` | numărul măsurilor cu verdict `neverificat`, **grupate pe motiv** (`document necitit (…)`, `agregare incompletă (…)`, `poziții F3 neclasificate`) | coloana Verdict (textul după „∅ neverificat:”) |
| Pagini căutate | numărul paginilor numărate sub plafon (cumulat, ordinea id a documentelor) și dacă **plafonul a fost atins** | linia „Ultima evaluare: … plafonul de pagini a fost atins / nu a fost atins” + raportul rulării din 🧪 Probă extractor („📏 Semnale: …”) |

Reguli:
- Un semnal se numără o singură dată (pe măsură / identitate), la ultima evaluare publicată. Rezultatele „istoric” (sursele s-au schimbat) nu se numără: se reia extragerea întâi.
- `de_verificat` nu e nici corect, nici fals: se notează separat, cu motivul (`lot necunoscut`, `element sau natură necunoscute`, `documentele diferă între ele`, `o singură sursă`, `valoare zero`, `totalul documentului nu corespunde componentelor`, `sursă dispărută`).
- Ciornele `auto_surse_*` create se numără și ele (câte au fost editate / aprobate / retrase de om), dar nimic nu se trimite în cadrul măsurării.

## Șablon de completat (o secțiune pe licitație, în paw-data\out)

```
Licitația: <eticheta internă, nu numele>        Data rulării: AAAA-LL-ZZ   Extractor: A / B
Prag: __ %   Plafon: ___ pagini   Pagini căutate: ___   Plafon atins: da / nu
Documente în fotografie: __ (F3 __, ATR __, CS __, memoriu __, răspunsuri __)   Documente necitite: __ (motive: …)

Măsuri evaluate: ___
  diferenta:     ___   → corecte ___ / false ___ (motivele potrivirilor false: …)
  de_verificat:  ___   (pe motive: …)
  neverificat:   ___   (pe motive: document necitit __, agregare incompletă __, poziții F3 neclasificate __)
  in_regula:     ___
Mostra de 10 măsuri verificate manual (din in_regula / de_verificat / neverificat): diferențe reale ratate ___ (care: …)
Ciorne auto_surse_*: create ___, editate ___, aprobate ___, retrase de om ___, retrase de sistem ___
Observații (texte de dovadă greșite, UM, loturi, timp de rulare): …
```

## Ce decide măsurarea
- Pragul implicit (5 %) și plafonul (200 pagini) rămân sau se schimbă din ecran (drept de decizie), pe licitație.
- Dacă semnalele false depășesc semnalele corecte pe două din trei licitații, regulile de clasificare (`fn_ofertare_masura_clasifica`) se revizuiesc înainte de a extinde la planșe (abaterea (g)).
- Documentele „necitite” ale altor loturi / versiuni vechi: până la migrarea care pune participarea pe loturi în fotografie, omul le scoate cu decizia „nu e sursă cantitativă” din ecran.
