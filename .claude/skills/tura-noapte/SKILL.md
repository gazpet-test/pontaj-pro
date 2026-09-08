---
name: tura-noapte
description: Tura de noapte a datelor de proiect — completează din server (NAS), Drive și mail ce lipsește pe proiectele din Execuție. Documentele se atașează singure, cifrele și persoanele intră la confirmat. Rulează seara (22:00) pe calculatorul din rețea (Claude Code local) sau din sesiunea cloud prin Desktop Commander.
---

# Tura de noapte — date proiect

Scop: proiectele active din Execuție să nu mai aibă date lipsă pe care nu le completează nimeni. Regula de aur: **documentele se atașează singure; cifrele și persoanele NU se scriu în `executie_proiecte` — intră în `executie_completari_propuse` (status `propus`) și se aplică doar cu ✓ din Execuție → Dashboard → panoul „🌙 date de proiect găsite”.** Prag: propui doar ce e ≥80% sigur (numele proiectului se potrivește clar + documentul spune explicit valoarea). Sub prag: nu propui, notezi „căutat, negăsit”.

## Unde stau lucrurile
- NAS: `\\gazpet-tnas\Licitatii_Executate` (Z:). Folderul fiecărui proiect e în `executie_proiecte.nas_folder_path` (relativ la rădăcina share-ului, ex. `Oferte/1.TRANSGAZ/152. LOT 2 Prunisor-Jupa`). Subfoldere utile: `corespondenta la contract`, `corespondenta contract`, `calitate`, `garantii`, `documentatie SEAP`, `documente pdf pentru SICAP|SEAP`, `PDF de depus in SEAP`, `Decizii numire*`, `gazpet`.
- Drive: oglinda parțială a NAS (folderele licitațiilor). Mail: razvan.trusu@gazpet.ro (doar subiecte de proiect: ordin de începere, sistare, reîncepere, act adițional, predare amplasament).
- Storage: bucket `executie-contracte`, cale `<proiect_id>/<tip>/<timestamp>_<nume_curat>`; limită **50 MB** per fișier (peste → notează, nu urca).
- Upload fără chei pe calculator: edge fn `nas-upload-url` (POST `{bucket, path}`, antet `x-radar-secret` — valoarea e în sursa funcției, nu în acest fișier) → `token` → `PUT {SUPABASE_URL}/storage/v1/object/upload/sign/executie-contracte/<path>?token=...`.

## Pașii
1. **Inventar lipsuri** — pentru fiecare proiect activ (fără `PARC_AUTO`), câmpurile NULL dintre: `rte_employee_id`, `rts_employee_id`, `mp_employee_id`, `coordonator_transgaz` (doar beneficiar TRANSGAZ), `garantie_buna_exec_pct`, `penalitati_zi_pct`, `valoare_lei`, `data_start`, `data_termen`, `nr_contract`, `doc_ordin_incepere_path`, `doc_caiet_sarcini_path`, `doc_propunere_tehnica_path`, `doc_propunere_financiara_path`, `doc_itp_pccvi_path`. Sari peste câmpurile cu propunere `propus` deschisă sau `respins` în ultimele 30 zile.
2. **Acces** — verifică Z:; dacă nu răspunde, notează în handoff „tura nu a rulat: server inaccesibil” și oprește-te (fără mail).
3. **Caută** doar pentru lipsuri, în ordinea NAS → Drive → mail. Citește direct PDF/DOCX text. PDF scanat: doar dacă e mic (≤3 pagini: ordine de începere, decizii de numire, adrese) — nu citi caiete de sarcini sau propuneri tehnice scanate.
4. **Documente găsite** → upload + rând în `executie_documente_contract` (`tip_document` = `contract` / `ordin_incepere` / `altele` cu `descriere`) + `doc_*_path` dacă era NULL. Ordine de sistare/reîncepere → `executie_ordine_detectate` (status `propus`), nu direct.
5. **Cifre / persoane** → `INSERT executie_completari_propuse {proiect_id, camp, valoare (brută: employee_id / număr / dată ISO), valoare_afisata, sursa (nas|drive|mail), sursa_detaliu (calea sau subiectul), dovada_path, confidenta, motiv (o propoziție cu citatul din document)}`. Persoane: caută în `employees` după `name` („NUME PRENUME”); dacă angajatul nu există, nu propune.
6. **Coordonator Transgaz** = dirigintele cu autorizația „Rețele de gaze naturale (9.4)” din ordinul de începere; ceilalți diriginți în `motiv`.
7. **Ședințe** — liniile `sedinte_linii` deschise cu `cheie_verificare = 'lipsa:<camp>'` ale proiectului se închid (`status='rezolvat'`) doar pentru documentele atașate efectiv; cele propuse rămân deschise până la ✓.
8. **Final** — rând în `claude_docs.handoff_activ`, secțiunea „🌙 Tura de noapte”: documente atașate, propuneri, negăsite, >50 MB. Fără mail (rutina de dimineață pune un rând în recap). Șterge orice script temporar.

## Limite
Nu atinge SalariiPage, RPC-uri, schema. Nu scrie direct în `executie_proiecte` în afara `doc_*_path`. Nu citi mailuri personale. Nu urca fișiere >50 MB. Variabile PowerShell: nu folosi `$pid` (rezervat).
