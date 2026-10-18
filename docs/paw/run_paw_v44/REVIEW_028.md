# Review #028 - valabilitate certificat cdx

Intrare: claude#028, decizia Razvan din 2026-10-18, dupa cele doua review-uri r4
GO pentru instalare si certificare. Acest GO priveste r4; politica de mai jos este
schimbarea ceruta ulterior, nu o noua atestare de izolare sau review extern.

| Cerinta | Decizie si implementare |
|---|---|
| Fara recertificare periodica | Acceptat: fara expirare calendaristica, nu zece ani. Evita o noua obligatie arbitrara la expirarea celor zece ani. Schema 5, validity_policy=until-deliberate-change, expires_utc=null. Data emiterii valida ramane obligatorie. |
| Dovezi proaspete | Acceptat: Seal pastreaza limita de 24h de la inceputul Run si refuzurile existente. Cele 20 de probe/protocolul cdx-probes-r4 nu se schimba. |
| Windows numai informativ | Acceptat: build/UBR si vechiul camp OS sunt scoase din binding. Windows este in certificatul Run/Seal si in raportul cdx, cu semnal explicit daca metadatele lipsesc. |
| Binding critic pastrat | Acceptat: runtime/bin, manifest complet Codex, versiune Codex, node.exe, auth ACL. Am legat explicit si SDDL al directorului CODEX_HOME, pe langa cel al auth.json. Schema binding 4. |
| Retragere inainte de schimbari | Acceptat/documentat: mentenanta, retragere marker INAINTE de firewall/CodexSandbox*/upgrade Codex; apoi Run + review + Seal. Fara automatizare sau schimbari globale. |

Formatul vechi nu se transforma automat in certificat permanent. Noua versiune
este ea insasi o schimbare deliberata: operatorul o instaleaza numai dupa review
si face certificarea initiala. Run/Seal nu au fost executate aici.

Limita acceptata: fara TTL si fara binding Windows, un update OS ori o modificare
neanuntata a firewall-ului/conturilor poate schimba izolarea fara invalidarea
markerului. Verificarile runtime/ACL nu sunt o atestare continua a izolarii.
Windows informativ ajuta auditul, dar nu blocheaza automat aceasta deriva.

Teste actuale: 100 verificari/subcazuri PASS, 1 OS SKIP. Include certificat din
2010 acceptat de lansator, schimbare Windows simulata fara invalidare, binding-uri
critice schimbate refuzate si dovezi vechi refuzate. Detalii si timpi in
TEST_RESULTS.md; mock-urile nu certifica Windows/ACL reale. Nu s-au facut
instalare, Run/Seal real, push, apel model/API sau modificari de productie.
