# P0 — sandbox 103: ground truth + originale în Storage (28.09.2026, 14:40–14:45Z)

Identitatea cu care s-a scris: `claude@gazpet.ro` (JWT-ul sesiunii din tab-ul ERP, Edge CDP 9333; `is_owner=false`, `ofertare:admin`) prin API-ul Storage — adică exact politica `ofertare_storage_ins` (`fn_are_acces_ofertare()`), nu service_role. Scriptul: `C:\Users\Public\gt_upload.mjs` (tokenul nu se afișează, nu se scrie pe disc). Bucket `ofertare`, `file_size_limit` = 200 MB.

## Ce a ajuns în bucket (SELECT pe `storage.objects`, name LIKE '103/%')
| prefix | obiecte | MB | owner |
|---|---|---|---|
| `103/atribuire/` | 19 | 33,3 | toate cu owner (claude@) |
| `103/depus/` | 81 | 467,1 | toate cu owner |

- `103/atribuire/*` = copii server-side (`POST /storage/v1/object/copy`) ale celor 19 obiecte `5/atribuire/*` ale licitației 5 — 19/19 OK (`gt_copy_1790606444719.json`). Clona 103 va rescrie `fisier_path` din `5/atribuire/…` în `103/atribuire/…`.
- `103/depus/*` = ground truth de pe NAS: subfolderele `documente depuse in SEAP` (57 = setul depus efectiv), `clarificari` (7), `doc SEAP` (14) + 3 fișiere din rădăcină. 81/82 — singura eroare: `~$cerinte licitatie.xlsx` (fișier de lock Office, cheie invalidă; nu e document). Manifestul complet al dosarului (467 fișiere): `ground_truth_manifest_domnesti.txt`.

## Read-back SHA-256 (descărcare din bucket + hash, `gt_upload.mjs sha`) vs manifestul de pe Z:
| obiect | bytes | sha256 (read-back) | = manifest Z: |
|---|---|---|---|
| `103/depus/documente depuse in SEAP/1.Documente calificare.pdf` | 3.460.647 | 04fe0a19…c13bb8 | DA |
| `103/depus/documente depuse in SEAP/propunere tehnica/propunere tehnica.pdf` | 91.663.289 | 6c3af1cf…0cdf73 | DA |
| `103/depus/clarificari/Raspuns consolidat.pdf` | 234.405 | 2678b194…5a7bc | DA |
| `103/atribuire/mtk3ggam_CAIET_DE_SARCINI.pdf` | 666.219 | 654a78bd…52806 | = `5/atribuire/mtk3ggam_CAIET_DE_SARCINI.pdf` (654a78bd…52806) |

Constatare colaterală (veriga 1, Domnești): `doc SEAP\CAIET DE SARCINI.pdf` de pe NAS are **același SHA-256** (654a78bd…52806) cu obiectul din ERP `5/atribuire/mtk3ggam_CAIET_DE_SARCINI.pdf` → identitatea documentului sursă e demonstrabilă prin hash, deși ERP-ul nu o înregistrează nicăieri pentru lic 5 (`ofertare_seap_manifest` = 0 rânduri). Pasul P2-1 va face comparația pe toate cele 14 din `doc SEAP` vs cele 19 din `5/atribuire`.

## Setul depus efectiv (`103/depus/documente depuse in SEAP/…`), sha256 · bytes · cale
```
04fe0a195dd5da5bd8b4912fdd3768e89a10654c42876e29f85175dba5c13bb8 3460647 1.Documente calificare.pdf
6a573f64ba9cc1dad1de9077ab050e754ab57aad48d87116d52c72b4bc0327a3 3465388 1.Documente calificare.pdf.p7s
8eed8ad60a101443ed2844af4bc65ef022ed35afaaef1bb70c41bf016d0635e1 18231582 1_PDFsam_3.propunere financiara .pdf
509910e59e78bae77270b33dccb110726db62afae790ebc4fb846d4e8badfcd0 1275004 2. Polita_AX1008206.pdf
c22ec791e01a53e2024677e54f996b63b2ab102ed98a1153438e1b3d3472a469 1279661 2. Polita_AX1008206.pdf.p7s
b6ee5c5894732cdd1bdc3ffb9a23532b52c665ee5a3ddd008f63c76073430189 111237 2.1.Dovada platii.pdf
e71b5a26df294c84a4c8a5f781d856239532c9c716fe3e9ac30dccfa886e62ad 115849 2.1.Dovada platii.pdf.p7s
ff8e893f292b1fd260633ba77986a6e04c0d63d6985ad068a8c011e88d9f79ca 18529444 3.propunere financiara .pdf
c6ff8c3c54cbe878bd0f8bad25f2676af021b6a33051fc478e77d5a2f51d0f15 18534146 3.propunere financiara .pdf.p7s
7a99b0c410cc6027a7eec4c31ef9111848b9bfd6a71cf88901c69dc72cd4e333 30300700 4.1propunere tehnica pg 1_536.pdf
4916c92a3a28a9b4318ace6cf8a2ddfe718d9073d969dbad9c6a25cf6a838c50 30305457 4.1propunere tehnica pg 1_536.pdf.p7s
22bc1bac5563060646b2a679e16ec414d8d476bb41b411d5bd0d6b7ea502ca21 31194454 4.2propunere tehnica pg 537_630.pdf
2598c176f3bd662708cc72b4e8bd7e6cdced64703dc08744bfeac07d1ee55a09 31199216 4.2propunere tehnica pg 537_630.pdf.p7s
b8114f919b3409f5f6f0a3a9f5378692646749e1411d035012a7348594819dc2 29419168 4.3propunere tehnica pg 631_974.pdf
4a9efc0fd9794de188199219cf287032347afe392f62615b64181fac0ef9d143 29423920 4.3propunere tehnica pg 631_974.pdf.p7s
f87dd56eb81bf427e1e9c5f4c8ad651bc2f3332e32930dfa09fdce31e7ed4533 294782 calificare/DC. Opis Doc.eligibilitate Domnesti.pdf
d6af5f38f5bd06cd06af5a0943e7a92bfe47e03d45612102e4ca2ea959ebe14a 791864 calificare/DC.1.Imputernicire Tanase_olograf.pdf
0d9c7a069fe89e9de2a37e5965c2302e01f9d7217e75aa458e26581cd404f12b 64032 calificare/DC.10.Duae-14.09.2026 (1).pdf
9fd6ffc98357de967ea2baf6dda437e6d51ef01d3298cf602ba9a96bd4a984ee 173929 calificare/DC.2.Formular 20.pdf
af038272ffdf43fe3d1847f5b3b2ba88c2da5ecc4ba6b934971f17306e4850b5 122613 calificare/DC.3.Formular 1.pdf
db56d63ca5ed4aace52fbc3d0aef44ed3695128a05f92ffb651ec24329b8ebe5 133343 calificare/DC.4.Formular 2.pdf
149b592d65cb11b16ce85d86110ed757bad56f0c89450e817fe14c1e9caa17f1 140844 calificare/DC.5.Formular 3.pdf
1bbbf129fec33d139a392fa4f91090a8b10b691ab91fe11366b117e5aef29dad 143116 calificare/DC.6.Formular 5.pdf
dd9426afda20125fb3200825bd45c6acbd8c30a2319cf28d9aa0e65a1873223d 129947 calificare/DC.7.Formular 8.pdf
1900ca6b1ec78f55962e74a4dceee93d8049d83bb05dadd6fcef42a3c5951690 214782 calificare/DC.8. Formular F17.pdf
485f641de552be310b1769d52d8fb4f1eb8460086d4b787e1c3875f35e133dd1 1231270 calificare/DC.8.1.Formular F17.1.contr.ad.facturi facturi Krieb.pdf
d07811417e6c84f0569be5405bd547179425ca4448786815fea2421b9be4b9ed 150737 calificare/DC.9.Formular 21.pdf
60f4924a3b864a318dcaa842a54888149d3376f7546902bf3f5bfebd6532d566 179663 propunere financiara/OF.0.Opis Prop Financiara.docx
134fe93aaf1687e1de91b1b74a934aad7ef488d60332344be44837ac237de9ad 289476 propunere financiara/OF.0.Opis Prop Financiara.pdf
4dcff8369dcf0b52c3fc343814d0884d1d5cacbc47667d40ebcf6a3acee016c6 172054 propunere financiara/OF.1.Formular F12 Formular de oferta.pdf
1900ca6b1ec78f55962e74a4dceee93d8049d83bb05dadd6fcef42a3c5951690 214782 propunere financiara/OF.10.1.Formular F17.pdf
485f641de552be310b1769d52d8fb4f1eb8460086d4b787e1c3875f35e133dd1 1231270 propunere financiara/OF.10.2.Formular F17.1.contr.ad.facturi facturi Krieb.pdf
074e9130d78507dd590e12d688429edc78bd79774eea4021deccee132b963701 886132 propunere financiara/OF.11..grafic valoric apa Domnesti.pdf
2ed697fa9cb23b8a3c55de85a4c54c5715c6df884966d95ccb1ae363e187407d 252355 propunere financiara/OF.2.F1.pdf
12deed959e35413ed7e7cd79e9daaaeda903203467b73bb3b8f5cf554bd1ab87 252204 propunere financiara/OF.3.1.F2_0153_0001.pdf
3e387af7406709f3f805e42c8e0f4f0fc6f7e68a9ffb8913be0e08e342818471 252195 propunere financiara/OF.3.10.F2_0153_0010.pdf
eb607bb4e0886f62366c9769d9b1d8a81dd0e4275fdd0da967c4022ff44aed8e 252202 propunere financiara/OF.3.11.F2_0153_0011.pdf
5b2cf4482b487ee59271a566ddc3a94ba91fcdb6ff89b20cf3e86a6843818623 251928 propunere financiara/OF.3.12.F2_0153_0012.pdf
20746ee318cf8a435aa06f05c4208a718643b85a63103416d342bdde4030b4a3 252201 propunere financiara/OF.3.2.F2_0153_0002.pdf
cd735c7afc617ee8d75358cf6202ceacaee2545d1ed76bdf3586e20c86c9bc12 252208 propunere financiara/OF.3.3.F2_0153_0003.pdf
3ff11933789aa141c6b678b6860e8114edce571f45684b6a327a2dea59c53254 252147 propunere financiara/OF.3.4.F2_0153_0004.pdf
987dec3a9ae85e28ee9c7e90ea742b19f3751c9330afd50a75e155087e988acf 252202 propunere financiara/OF.3.5.F2_0153_0005.pdf
13780b1a5a1db2af55630e13ef8269f02cd88e8be6179867dd8ddc08fdf9a733 252200 propunere financiara/OF.3.6.F2_0153_0006.pdf
7d555d6747ee1c06b8d4a707b4a7cc297c851bc73190fa186f80e31bc4686b37 1841 propunere financiara/OF.3.7.F2_0153_0007.pdf
44afdd5e98c704dafac1e7b0e3f3d64f31cc9932d8f8f90d6daa03abc50f39c9 252206 propunere financiara/OF.3.8.F2_0153_0008.pdf
a024da546e76dc6b3fe0834f2f9fd60b45d18511d5dd8fbaf23cbf9bfc0c7e57 252145 propunere financiara/OF.3.9.F2_0153_0009.pdf
3fb78ae2d70bdb98f8e5ee5b6e5d8e84849b1bac65ad4e9a6bfea8f8ff206459 11225843 propunere financiara/OF.4.Formularul F3.pdf
c3df21c5a6a2b43b98ae8db233ae0fb3e7bdd1994e5057df0d39811b9e347271 377293 propunere financiara/OF.5.C6.pdf
e12b42dc7763881eab78bf717d4b839378c9c3b297101e84c3614735932a5e79 342835 propunere financiara/OF.6.C7.pdf
8996eb4acca07de2fef74afbec02f2d70098ab542f8a6c129afc3008e8cca580 344865 propunere financiara/OF.7.C8.pdf
39424fb752af8a9f34f6a45c03105ceb78c3a7ff1ec659a184a79dbbea0e894b 343075 propunere financiara/OF.8.C9.pdf
53ae730f6aab110c66ff3c0e269492bce8ba66dc330e8726427e78241333309e 176360 propunere financiara/OF.9.Formular F14.pdf
ff8e893f292b1fd260633ba77986a6e04c0d63d6985ad068a8c011e88d9f79ca 18529444 propunere financiara/propunere financiara .pdf
7a99b0c410cc6027a7eec4c31ef9111848b9bfd6a71cf88901c69dc72cd4e333 30300700 propunere tehnica/propunere tehnica pg 1_536.pdf
22bc1bac5563060646b2a679e16ec414d8d476bb41b411d5bd0d6b7ea502ca21 31194454 propunere tehnica/propunere tehnica pg 537_630.pdf
b8114f919b3409f5f6f0a3a9f5378692646749e1411d035012a7348594819dc2 29419168 propunere tehnica/propunere tehnica pg 631_974.pdf
6c3af1cfb0f29b8ba85a4746fceb38598feac9ff20066f0a71c0506d0c0cdf73 91663289 propunere tehnica/propunere tehnica.pdf
```
Observații de identitate (utile pentru P4): `OF.10.1.Formular F17.pdf` = `calificare/DC.8. Formular F17.pdf` (același hash 1900ca6b…, aceeași piesă în două opisuri); `OF.3.7.F2_0153_0007.pdf` are 1.841 bytes (posibil fișier gol/corupt în dosarul depus — de verificat în P4, nu se „corectează”); `3.propunere financiara .pdf` (rădăcină) = `propunere financiara/propunere financiara .pdf` (ff8e893f…); cele 3 părți ale propunerii tehnice din rădăcină = cele din subfolder (hash identic), iar `.p7s`-urile sunt semnăturile lor detașate.

## Restul din `103/depus/`
`clarificari/`: Raspuns consolidat.pdf (2678b194…), Raspuns consolidat - 2.pdf (ac815e53…), Raspuns consolidat -3.pdf (a0d572e7…), Solicitare clarificari Domnesti.docx (+.p7s), Solicitare clarificari Domnesti nr.2.docx (+.p7s). `doc SEAP/`: AC 258 (93bfafc7…), CAIET DE SARCINI (654a78bd…), DUAE_CERERE_383900.xml (3b0a07d2…), FORMULARE.doc (dda798f4…), Instructiuni_ofertanti_FisaDate_DF1279378.pdf (80a2b023…), LISTE CANTITATI FARA VALORI/* (C6–C9, F1–F3), PT/PT/01. Parte scrisa PT.pdf (7ae3bc7e…, 4.487.980), PT/PT/02. Parte desenata PT.pdf (d82eb8e8…, 11.694.037). Rădăcină: cerinte licitatie Domnesti.xlsx, PV evaluare GP - anexa 1 .pdf, SCN1179360 Anunt de participare simplificat.pdf.

Rollback P0 (dacă e nevoie): ștergerea obiectelor `103/%` din bucket (DELETE direct în `storage.objects` e blocat de `protect_objects_delete` → se șterge prin API-ul Storage cu aceeași identitate, sau de owner).
