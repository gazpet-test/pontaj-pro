# Review #027 - runda 4 cdx - 2026-10-18

Baza: 49007d5, branch codex/run-paw-cdx. Commit nou, fara amend/rebase/push.
Review-uri citite integral: pr759_cdx_r3_cop.log si pr759_cdx_r3_gem.log,
din C:/Users/Public/paw-data/out. Implementare si teste numai in worktree;
fara Install, Run/Seal real, model, conturi, firewall sau date ERP.

| Punct | Decizie si motiv | Reparatie si dovada |
|---|---|---|
| Copilot: control nativ de retea lipsa | ACCEPTAT. Succesul TcpClient nu confirma copia curl. | TestNativeNetworkControl porneste exact nativeSource, pe acelasi URL/listener LAN al probei; cere cerere primita si exit 0. Raspuns HTTP sintetic gol; hash si URL pastrate si cerute la Seal. Fixture local loopback reusit; executabil sintetic exit 7 si exit 0 fara conexiune respinse. LAN real ramane pentru operator. |
| Gemini: IndexOf pe comanda intreaga | ACCEPTAT riscul de quoting; RESPINS caracterul universal/determinist al afirmatiei: un wrapper poate si pastra substring-ul. | ID + toate action_tokens numai din campurile de ACTIUNE JSON deja decodate; verb, cale GUID, argumente/payload esentiale. Limite de cale previn potrivirea unui sibling cu sufix. Structurile patch/tool sunt parcurse ca valori, fara dublu JSON/de-escaping. Teste PS -Command / cmd /c, cale GUID gresita, verb/argument lipsa, stdout/proza, reuse linie/item, succes/refuz. Formatul shell exact ramane in manifest pentru review uman. |
| Gemini: link creat, scriere blocata | ACCEPTAT pentru cele trei link-uri cunoscute din permisul protejat. Regula veche producea NO-GO conservator chiar daca tinta nu fusese modificata. | Dupa Job idle: parintele verifica tip/tinta (hardlink prin volum+file index), elimina NUMAI intrarea linkului, fara recursie, si inregistreaza reparse_points_blocked / hardlinks_blocked. Canarul extern trebuie sa ramana neschimbat; Seal cere si evenimentul real cu refuz. Alte link-uri/tinte neasteptate raman refuzate. Modul normal nu se schimba. Junction + hardlink testate local cu canar intact; symlink real SKIPPED, privilegiu indisponibil. |
| Copilot: certificat fara durata/binding suficient | ACCEPTAT. Alegem expirare + obligatie de recertificare; adaugam si build/UBR Windows + versiunea Codex la binding. | Schema 4, cdx-probes-r4; expirare la 24h de la INCEPUTUL Run, nu de la ultimul Seal. Seal refuza dovezi vechi/fara timp/in viitor; nu poate reinnoi la nesfarsit aceeasi rulare. Codex/runtime deja hash-bound. OS/UBR/Codex schimbat => refuz automat. Firewall si conturile sandbox NU au fingerprint automat: operatorul trebuie sa retraga certificatul INAINTE de schimbare si sa recertifice dupa. Fereastra reziduala este declarata, nu ascunsa. |
| Copilot: helper vechi transformat in cod de incredere | ACCEPTAT. Copierea tuturor fisierelor vechi era prea larga. | Numai cgpt_pw.py (dependenta legacy neinclusa in pachet) poate intra in incoming: hash SHA-256 explicit din review, ACL admin-only al helperului si stramosilor verificat INAINTE de orice schimbare ACL, apoi revalidare ACL/hash si hash dupa copie. Lipsa hash/ACL nesigur/modificare => refuz. Fisierele necunoscute raman numai in backup/retired, niciodata executabile mostenite in incoming. |
| Gemini: LanAddress | ACCEPTAT. | Run fara IP explicit da mesaj clar inainte de orice efect; fara autodetectie/modificare retea. Validarea de IP local non-loopback ramane. |
| Gemini: file:/// Windows | ACCEPTAT testul cerut, fara a presupune versiunea de OS din review. | Curl copiat din System32, versiune 8.21.0, read/write pe canare sintetice si URI cu spatii (%20) au trecut. Registry masurat: build 26200, UBR 9711, DisplayVersion 25H2, EditionID Professional; ProductName legacy raporteaza Windows 10 Pro. Nu am testat Windows Server 2019/2022 si nu deduc aceasta platforma din review. |

## Observatii confirmate si limite

Copilot considera rezolvate reuse-ul de evenimente, setul de probe r2,
install.lock nemostenibil si pinning-ul runtime/Git. Nu le-am slabit; regresiile
au trecut. Recomandarea de a pastra varianta 1 ca CANDIDAT este acceptata; nu
implementam inca PawCdx. Afirmatia Gemini „100% gata” si afirmatiile universale
despre imposibilitatea blocarii junction-urilor nu sunt validate de aceste teste.
Crearea unui link nu este echivalenta cu scrierea permisa prin el.

Potrivirea tokenurilor nu este un interpret PowerShell si nu certifica singura
semantica. Administratorul trebuie sa examineze comanda efectiva si refuzul;
un echo/comment cu tokenuri ori o eroare de sintaxa NU este dovada de tentativa
reala. Rezultatele curl 7/23/26/37 singure nu certifica refuzul de acces. Controlul
pozitiv elimina indisponibilitatea initiala a binarului, nu toate cauzele de esec.

Campul reparse_points_blocked inseamna „detectat si eliminat de parinte in
certificare”, NU „Windows a interzis crearea”. Numai cele 3 nume root-level si
tintele fixe din permis beneficiaza de aceasta exceptie. Un link necunoscut,
tinta incorecta sau esecul de unlink opreste certificarea. Probe care nu au putut
crea deloc link-ul pot ramane fara inregistrare; evenimentul trebuie sa dovedeasca
refuzul crearii. Nu fabricam o detectie inexistenta.

Backup-ul vechi este material de audit, NU radacina de incredere. Hash-ul pentru
cgpt_pw.py trebuie aprobat dupa verificarea provenientei/continutului, nu calculat
orbeste pe un helper gasit acolo. Un helper user-writable este refuzat chiar daca
hash-ul coincide; este necesara remediere/reprovisionare explicita de operator.

Teste si limitari detaliate: TEST_RESULTS.md. Activarea ramane NO-GO pana la
certificarea OS reala, repetata, cu probele native/shell/tool/credentiale/retea.
Nicio instalare, certificare, migrare, schimbare globala sau push nu s-a facut.
