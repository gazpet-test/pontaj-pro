# Temperaturile Terra

Script POSIX `sh`, rulat ca root pe Terra la fiecare 10 minute. Necesită utilitarele
Linux `awk`, `stat`, `mktemp`, `smartctl` și `curl` cu suport `--header @fișier`.

## Instalare (manual, de administrator)

1. Claude completează `TODO-CLAUDE` din migrare și rollback cu corpul real al
   `iot_cron_tick`, verifică schema și aplică migrarea. Apelul Terra trebuie pus
   înainte de verificarea integrărilor cloud conectate. Fără acest pas nu rulează alertele.
2. Configurează în Vault secretul existent `TERRA_TEMP_SECRET` și publică `iot-terra`
   fără verificare JWT (inclus în `NO_JWT`). Endpointul acceptă exclusiv `x-terra-secret`.
3. Instalează scriptul ca `/root/terra-temp/trimite.sh`, cu permisiuni `700` și owner root.
   Pune același secret într-o singură linie în `/root/.terra_temp_secret`, owner root,
   permisiuni **600** (fără symlink). Editează fișierul direct; nu pune secretul în comenzi
   salvate în istoricul shell. Nu porni scriptul cu `sh -x`.
4. Pune URL-ul HTTPS al funcției (`https://<proiect>.supabase.co/functions/v1/iot-terra`)
   în `/root/.terra_temp_url` (owner root, `600`). Nu este necesar JWT/apikey.
5. Rulează manual `/bin/sh /root/terra-temp/trimite.sh`; apoi adaugă prin `crontab -e`
   la root (păstrând celelalte intrări):

   ```cron
   */10 * * * * /bin/sh /root/terra-temp/trimite.sh >/dev/null 2>&1
   ```

## Ce trimite

- `ambient`: maximul zonelor `acpitz`, `cpu`: maximul zonelor `x86_pkg_temp`.
- `nvme`: toate temperaturile `temp*_input` din hwmon cu `name=nvme`.
- `discuri`: maximum 16 perechi `/dev/sd?` + `Temperature_Celsius` (coloana 10 din `smartctl -A`).
- `uptime_s`: secundele de funcționare, întregi, din `/proc/uptime`.

Valorile sysfs sunt convertite din miligrade în °C. Temperaturile absente sau în afara
[-20, 120] sunt omise. Uptime este o durată nenegativă, fără limita de temperatură 120.
Endpointul calculează `disc_max` / `nvme_max`; normalizează senzorii omiși la `null`.
Un obiect gol este acceptat și produce avertismentul „citire goală” prin verificatorul SQL.
`null` explicit în payload nu este un număr valid; câmpul trebuie omis.

Secretul este trimis printr-un fișier temporar `600`, într-un director `700`, șters la
ieșire. Curl are timeout 20 secunde, fără retry sau redirect. Eșecurile se înregistrează
în `/var/log/terra-temp.log`, rotit la aproximativ 100 KB în `.log.1` (o singură arhivă).
Codurile de eroare sunt logate fără secret și fără corpul răspunsului.

Alerte: disc >45/>50, NVMe >65/>70, CPU >80/>90, ambient >35/>40 °C (warning/error).
Egalitatea cu pragul nu îl depășește. Peste 30 minute fără citire: error. Nicio citire
de la instalare: error. Titlurile distincte per prag păstrează escaladarea prin deduplicarea
existentă de 12 ore. Verificarea rulează la cron-ul IoT de 10 minute.

## Dezinstalare

Elimină numai intrarea Terra din crontab. Administratorul poate elimina scriptul și cele
două fișiere de configurare și poate retrage funcția `iot-terra` / secretul Vault dacă nu
mai sunt folosite. Pentru oprirea alertelor, Claude completează și aplică rollback-ul SQL:
restaurează cron-ul original și transformă verificatorul Terra în no-op. Dispozitivul și
istoricul rămân păstrate; rollback-ul nu șterge date.
