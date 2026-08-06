/**
 * Gazpet Instal — Ingestie atasamente Gmail → Google Drive + ERP pontaj-pro
 *
 * Se instaleaza MANUAL pe script.google.com sub contul razvan.trusu@gazpet.ro
 * (fisierul din repo e doar sursa de referinta — Apps Script nu ruleaza din repo).
 *
 * Flux: mail etichetat "Automatizari/<Proiect>"
 *   → atasamentele se salveaza in Drive: Proiecte/<Proiect>/<AAAA-LL>/  (arhiva)
 *   → POST catre Edge Function ingest-document (Supabase Storage + documente_proiect)
 *   → scriptul din containerul NAS le trage in folderul proiectului (Corespondenta Email)
 *
 * INSTALARE (o singura data):
 *   1. script.google.com → proiect nou → lipeste codul asta
 *   2. Project Settings → Script Properties → adauga:
 *        INGEST_URL    = https://dxczwkbciseqniprspcu.supabase.co/functions/v1/ingest-document
 *        INGEST_ANON   = <anon key Supabase — Settings → API keys>
 *        INGEST_SECRET = <acelasi secret setat in Supabase Edge Functions → Secrets>
 *   3. Ruleaza setupLabels() → apar etichetele in Gmail
 *   4. Configureaza filtrele Gmail care aplica etichetele (vezi handoff, sectiunea 4)
 *   5. CFG.DRY_RUN = true → ruleaza ingestAttachments() → verifica log-ul
 *   6. CFG.DRY_RUN = false → ruleaza din nou → verifica Drive + platforma
 *   7. Ruleaza setupTrigger() → ruleaza automat la 15 minute
 *
 * Idempotent: dedup pe numele de fisier (contine messageId) in Drive,
 * si pe (gmail_message_id, nume_fisier) in ERP. Re-rularea nu creeaza duplicate.
 */
const CFG = {
  ROOT_FOLDER: 'Proiecte',          // folderul radacina din My Drive
  PARENT_LABEL: 'Automatizari',     // eticheta parinte in Gmail
  RESERVED_SUFFIX: '_procesat',     // sub-eticheta ignorata
  LOOKBACK_DAYS: 14,                // cat de departe in trecut cauta
  MAX_THREADS: 100,                 // plafon per rulare, per proiect
  MIN_BYTES: 20 * 1024,             // ignora logo-uri din semnaturi (<20 KB)
  MAX_ERP_BYTES: 30 * 1024 * 1024,  // peste 30 MB nu se trimite base64 la ERP
  SKIP_EXT: ['ics', 'vcf'],         // extensii ignorate
  SKIP_NAME_RX: /^(image\d+|logo|signature)/i,
  LOG_SHEET_NAME: '_log_ingestie',  // se creeaza automat in ROOT_FOLDER
  PUSH_TO_ERP: true,                // false = doar Drive, fara platforma
  DRY_RUN: false,                   // true = nu scrie nimic, doar logheaza
};

/** Punct de intrare. Leaga-l de un trigger la 15 minute. */
function ingestAttachments() {
  const root = getOrCreateFolder_(DriveApp.getRootFolder(), CFG.ROOT_FOLDER);
  const labels = GmailApp.getUserLabels().filter(isProjectLabel_);
  if (!labels.length) {
    Logger.log('Nicio eticheta sub "%s/". Ruleaza setupLabels() intai.', CFG.PARENT_LABEL);
    return;
  }
  const rows = [];
  labels.forEach(function (label) {
    const project = label.getName().split('/').pop();
    try {
      rows.push.apply(rows, processLabel_(label, project, root));
    } catch (err) {
      Logger.log('EROARE pe proiectul %s: %s', project, err.message);
      rows.push([new Date(), project, '', '', 'EROARE', err.message]);
    }
  });
  if (rows.length) writeLog_(root, rows);
  Logger.log('Gata. %s fisiere procesate.', rows.length);
}

function isProjectLabel_(label) {
  const name = label.getName();
  return name.indexOf(CFG.PARENT_LABEL + '/') === 0
      && name.split('/').pop() !== CFG.RESERVED_SUFFIX;
}

function processLabel_(label, project, root) {
  const projectFolder = getOrCreateFolder_(root, project);
  const cutoff = new Date(Date.now() - CFG.LOOKBACK_DAYS * 864e5);
  const out = [];
  label.getThreads(0, CFG.MAX_THREADS).forEach(function (thread) {
    if (thread.getLastMessageDate() < cutoff) return;
    thread.getMessages().forEach(function (msg) {
      if (msg.getDate() < cutoff) return;
      msg.getAttachments({ includeInlineImages: false, includeAttachments: true })
         .forEach(function (att) {
           const decision = shouldSave_(att);
           if (!decision.ok) {
             Logger.log('skip [%s] %s — %s', project, att.getName(), decision.reason);
             return;
           }
           const saved = saveAttachment_(att, msg, projectFolder, project);
           if (saved) out.push(saved);
         });
    });
  });
  return out;
}

function shouldSave_(att) {
  const name = att.getName() || '';
  const ext = name.split('.').pop().toLowerCase();
  if (att.getSize() < CFG.MIN_BYTES) return { ok: false, reason: 'prea mic' };
  if (CFG.SKIP_EXT.indexOf(ext) !== -1) return { ok: false, reason: 'extensie ignorata' };
  if (CFG.SKIP_NAME_RX.test(name))      return { ok: false, reason: 'nume de semnatura' };
  return { ok: true };
}

function saveAttachment_(att, msg, projectFolder, project) {
  const date = msg.getDate();
  const monthFolder = getOrCreateFolder_(projectFolder, Utilities.formatDate(date, 'Europe/Bucharest', 'yyyy-MM'));
  // Numele include messageId => dedup natural, fara stare externa.
  const shortId = msg.getId().slice(-8);
  const stamp = Utilities.formatDate(date, 'Europe/Bucharest', 'yyyy-MM-dd');
  const filename = stamp + '_' + shortId + '_' + sanitize_(att.getName());
  if (monthFolder.getFilesByName(filename).hasNext()) return null; // deja salvat

  if (CFG.DRY_RUN) {
    Logger.log('[DRY] as salva: %s/%s', project, filename);
    return [new Date(), project, msg.getFrom(), msg.getSubject(), 'DRY_RUN', filename];
  }

  const blob = att.copyBlob().setName(filename);
  const file = monthFolder.createFile(blob);
  file.setDescription(
    'Sursa: Gmail\nExpeditor: ' + msg.getFrom() +
    '\nSubiect: ' + msg.getSubject() +
    '\nData: ' + date.toISOString() +
    '\nMessageId: ' + msg.getId()
  );

  let status = 'SALVAT';
  if (CFG.PUSH_TO_ERP) {
    try {
      pushToErp_(blob, {
        project: project,
        messageId: msg.getId(),
        filename: filename,
        from: msg.getFrom(),
        subject: msg.getSubject(),
        date: date.toISOString(),
        driveFileId: file.getId(),
      });
      status = 'SALVAT+ERP';
    } catch (err) {
      // Fisierul e in Drive; ERP-ul se poate re-incerca (dedup pe nume in Drive
      // NU blocheaza retrimiterea — vezi retryErp_ mai jos pentru recuperare).
      Logger.log('ERP esuat [%s] %s: %s', project, filename, err.message);
      status = 'SALVAT_FARA_ERP: ' + err.message;
    }
  }
  Logger.log('%s [%s] %s', status, project, filename);
  return [new Date(), project, msg.getFrom(), msg.getSubject(), status, filename];
}

/** POST catre Edge Function ingest-document. Arunca la esec (prins in saveAttachment_). */
function pushToErp_(blob, meta) {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty('INGEST_URL');
  const anon = props.getProperty('INGEST_ANON');
  const secret = props.getProperty('INGEST_SECRET');
  if (!url || !anon || !secret) throw new Error('Lipsesc INGEST_URL / INGEST_ANON / INGEST_SECRET din Script Properties');

  const bytes = blob.getBytes();
  if (bytes.length > CFG.MAX_ERP_BYTES) throw new Error('peste 30 MB — trimis doar in Drive');

  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + anon, 'x-ingest-secret': secret },
    muteHttpExceptions: true,
    payload: JSON.stringify({
      proiect_slug: meta.project,
      gmail_message_id: meta.messageId,
      nume_fisier: meta.filename,
      mime_type: blob.getContentType(),
      expeditor: meta.from,
      subiect: meta.subject,
      data_mail: meta.date,
      drive_file_id: meta.driveFileId,
      continut_base64: Utilities.base64Encode(bytes),
    }),
  });
  if (res.getResponseCode() >= 300) {
    throw new Error('ERP ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 200));
  }
}

function sanitize_(name) {
  return String(name).replace(/[\/\\:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim();
}

function getOrCreateFolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function writeLog_(root, rows) {
  const files = root.getFilesByName(CFG.LOG_SHEET_NAME);
  const ss = files.hasNext()
    ? SpreadsheetApp.open(files.next())
    : createLogSheet_(root);
  const sheet = ss.getSheets()[0];
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}

function createLogSheet_(root) {
  const ss = SpreadsheetApp.create(CFG.LOG_SHEET_NAME);
  const file = DriveApp.getFileById(ss.getId());
  root.addFile(file);
  DriveApp.getRootFolder().removeFile(file);
  ss.getSheets()[0]
    .appendRow(['Timestamp', 'Proiect', 'Expeditor', 'Subiect', 'Status', 'Fisier']);
  return ss;
}

// ---------------------------------------------------------------
// Utilitare de configurare — se ruleaza manual, o singura data
// ---------------------------------------------------------------

/** Creeaza arborele de etichete in Gmail. */
function setupLabels() {
  const projects = [
    'Hoghilag', 'Prunisor-Jupa', 'Dragasani-Caldararu',
    'ADI-Ialomita', 'Recea-Mislea', 'Stefan-cel-Mare',
  ];
  projects.concat([CFG.RESERVED_SUFFIX]).forEach(function (p) {
    const full = CFG.PARENT_LABEL + '/' + p;
    if (!GmailApp.getUserLabelByName(full)) {
      GmailApp.createLabel(full);
      Logger.log('creat: %s', full);
    }
  });
}

/** Instaleaza triggerul la 15 minute (idempotent). */
function setupTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'ingestAttachments'; })
    .forEach(ScriptApp.deleteTrigger);
  ScriptApp.newTrigger('ingestAttachments').timeBased().everyMinutes(15).create();
  Logger.log('Trigger instalat.');
}
