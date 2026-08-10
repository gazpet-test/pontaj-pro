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
 *   8. (FAZA 1 onboarding) In editor, la "Services" (+) → adauga "Gmail API".
 *      Din acel moment, orice proiect nou din platforma cu eticheta_gmail setata
 *      isi primeste automat eticheta si filtrul in Gmail la urmatoarea rulare.
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
  try { syncGmailConfig_(); } catch (err) { Logger.log('sync config esuat: %s', err.message); }
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

/** Cere platformei lista de proiecte cu eticheta + criterii. null la esec. */
function fetchGmailConfig_() {
  const props = PropertiesService.getScriptProperties();
  const secret = props.getProperty('INGEST_SECRET');
  const anon = props.getProperty('INGEST_ANON');
  const ingestUrl = props.getProperty('INGEST_URL');
  if (!secret || !anon || !ingestUrl) return null;
  const url = ingestUrl.replace(/\/[^\/]+$/, '/gmail-config');
  const res = UrlFetchApp.fetch(url, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'Authorization': 'Bearer ' + anon, 'x-ingest-secret': secret },
    payload: JSON.stringify({ action: 'list' }),
  });
  if (res.getResponseCode() >= 300) { Logger.log('gmail-config list: HTTP %s', res.getResponseCode()); return null; }
  const cfg = JSON.parse(res.getContentText());
  return (cfg.ok && cfg.proiecte) ? cfg.proiecte : null;
}

/** Criteriile proiectului → query Gmail (identic cu ce pune filtrul). */
function construiesteQuery_(pr) {
  const parti = [];
  if (pr.filtru_gmail_from) parti.push('from:(' + pr.filtru_gmail_from + ')');
  if (pr.filtru_gmail_subject) parti.push('subject:(' + pr.filtru_gmail_subject + ')');
  if (pr.filtru_gmail_query) parti.push(pr.filtru_gmail_query);
  return parti.join(' ');
}

/**
 * FAZA 1 onboarding automat: intreaba platforma ce etichete/filtre ar trebui
 * sa existe (executie_proiecte.eticheta_gmail + filtru_gmail_*) si creeaza
 * ce lipseste. Rulat automat la inceputul fiecarei ingestii.
 *
 * NECESITA (o singura data): in editorul Apps Script, stanga la "Services" (+)
 * → adauga "Gmail API" (pentru crearea FILTRELOR; etichetele merg si fara).
 */
function syncGmailConfig_() {
  const proiecte = fetchGmailConfig_();
  if (!proiecte) return;
  const props = PropertiesService.getScriptProperties();
  const secret = props.getProperty('INGEST_SECRET');
  const anon = props.getProperty('INGEST_ANON');
  const url = props.getProperty('INGEST_URL').replace(/\/[^\/]+$/, '/gmail-config');
  const cfg = { proiecte: proiecte };

  const gmailApiOn = (typeof Gmail !== 'undefined');
  let existingFilters = [];
  if (gmailApiOn) {
    try { existingFilters = (Gmail.Users.Settings.Filters.list('me').filter) || []; }
    catch (e) { Logger.log('Filters.list: %s', e.message); }
  }

  const sincronizate = [];
  cfg.proiecte.forEach(function (pr) {
    if (!pr.eticheta_gmail) return;
    const fullName = CFG.PARENT_LABEL + '/' + pr.eticheta_gmail;
    // 1. Eticheta
    let label = GmailApp.getUserLabelByName(fullName);
    if (!label) { label = GmailApp.createLabel(fullName); Logger.log('eticheta creata: %s', fullName); }
    // 2. Filtrul (doar daca proiectul are criterii si Gmail API e activat)
    const areCriterii = pr.filtru_gmail_from || pr.filtru_gmail_subject || pr.filtru_gmail_query;
    if (areCriterii && gmailApiOn) {
      try {
        const labelId = Gmail.Users.Labels.list('me').labels
          .filter(function (l) { return l.name === fullName; })
          .map(function (l) { return l.id; })[0];
        const dejaExista = existingFilters.some(function (f) {
          return f.action && (f.action.addLabelIds || []).indexOf(labelId) !== -1;
        });
        if (labelId && !dejaExista) {
          const criteria = {};
          if (pr.filtru_gmail_from) criteria.from = pr.filtru_gmail_from;
          if (pr.filtru_gmail_subject) criteria.subject = pr.filtru_gmail_subject;
          if (pr.filtru_gmail_query) criteria.query = pr.filtru_gmail_query;
          Gmail.Users.Settings.Filters.create({ criteria: criteria, action: { addLabelIds: [labelId] } }, 'me');
          Logger.log('filtru creat pentru: %s', fullName);
        }
      } catch (e) { Logger.log('filtru %s: %s', fullName, e.message); }
    }
    sincronizate.push(pr.eticheta_gmail);
  });

  // 3. Confirmare inapoi in platforma
  if (sincronizate.length) {
    UrlFetchApp.fetch(url, {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { 'Authorization': 'Bearer ' + anon, 'x-ingest-secret': secret },
      payload: JSON.stringify({ action: 'confirm', etichete: sincronizate }),
    });
  }
}

function isProjectLabel_(label) {
  // try/catch: Gmail poate returna referinte la etichete sterse ("fantoma");
  // getName() pe ele arunca "Could not locate target object" — le ignoram.
  try {
    const name = label.getName();
    return name.indexOf(CFG.PARENT_LABEL + '/') === 0
        && name.split('/').pop() !== CFG.RESERVED_SUFFIX;
  } catch (e) {
    return false;
  }
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
// BACKFILL — populare istorica (12 luni), rulare in fundal cu cursor
// ---------------------------------------------------------------
// Porneste cu setupBackfill() (o singura data). Proceseaza cate ~4,5 min
// per rulare, isi tine minte pozitia (Script Properties) si se opreste
// singur cand a terminat toate etichetele. Dedup-ul (Drive + platforma)
// garanteaza zero duplicate fata de ingestia curenta, care merge in paralel.

const BACKFILL = {
  DAYS: 365,                 // fereastra implicita
  BATCH_THREADS: 25,         // fire pe pagina
  BUDGET_MS: 4.5 * 60 * 1000 // opreste-te inainte de limita de 6 min
};

/** Backfill pentru TOATE etichetele, pe BACKFILL.DAYS zile. */
function setupBackfill() {
  startBackfill_([], BACKFILL.DAYS);
}

/**
 * Backfill DOAR pentru anumite proiecte, pe o fereastra la alegere.
 * EDITEAZA cele doua constante de mai jos, apoi ruleaza functia asta.
 * Util cand adaugi proiecte noi: nu re-plimbi backfill-ul peste tot istoricul deja tras.
 * IMPORTANT: ruleaza INTAI aplicaEticheteRetroactiv() — backfill-ul umbla pe ETICHETE,
 * iar filtrele Gmail eticheteaza doar mailul NOU, deci istoricul nu e etichetat singur.
 */
function setupBackfillSelectiv() {
  const ETICHETE = [
    'ADI-Ialomita', 'Cosmesti', 'Munteni-Barlad', 'Tigveni', 'Isaccea-Negru-Voda',
    'PIS-Rau-Doamnei', 'PIS-Comarnic', 'PIS-Siminicea', 'Bretea-Romana',
    'Habau-Bilciuresti-Depogaz', 'Habau-Gaze-Umede', 'Neptun-Deep',
  ];
  const ZILE = 180;
  startBackfill_(ETICHETE, ZILE);
}

/** Porneste backfill-ul: reseteaza cursorul si instaleaza triggerul. */
function startBackfill_(etichete, zile) {
  const state = { li: 0, off: 0, only: etichete || [], days: zile || BACKFILL.DAYS };
  PropertiesService.getScriptProperties().setProperty('BACKFILL_STATE', JSON.stringify(state));
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'backfillRun'; })
    .forEach(ScriptApp.deleteTrigger);
  ScriptApp.newTrigger('backfillRun').timeBased().everyMinutes(15).create();
  Logger.log('Backfill pornit: %s zile, %s. Ruleaza la 15 min pana termina.',
    state.days, state.only.length ? state.only.length + ' etichete' : 'toate etichetele');
}

/** Opreste backfill-ul in curs (trigger + cursor). */
function stopBackfill() {
  PropertiesService.getScriptProperties().deleteProperty('BACKFILL_STATE');
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'backfillRun'; })
    .forEach(ScriptApp.deleteTrigger);
  Logger.log('Backfill oprit.');
}

/** Unde a ajuns backfill-ul. */
function backfillStatus() {
  const raw = PropertiesService.getScriptProperties().getProperty('BACKFILL_STATE');
  Logger.log(raw ? 'Backfill in curs: ' + raw : 'Backfill inactiv.');
}

/** O tura de backfill. NU se ruleaza manual decat pentru test. */
function backfillRun() {
  const t0 = Date.now();
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty('BACKFILL_STATE');
  if (!raw) { Logger.log('Backfill: fara stare — ruleaza setupBackfill() intai.'); return; }
  let state = JSON.parse(raw);

  const root = getOrCreateFolder_(DriveApp.getRootFolder(), CFG.ROOT_FOLDER);
  const only = state.only || [];
  let labels = GmailApp.getUserLabels().filter(isProjectLabel_)
    .sort(function (a, b) { return a.getName() < b.getName() ? -1 : 1; });
  if (only.length) {
    labels = labels.filter(function (l) { return only.indexOf(l.getName().split('/').pop()) !== -1; });
  }
  const cutoff = new Date(Date.now() - (state.days || BACKFILL.DAYS) * 864e5);
  const rows = [];

  while (state.li < labels.length && (Date.now() - t0) < BACKFILL.BUDGET_MS) {
    const label = labels[state.li];
    const project = label.getName().split('/').pop();
    const projectFolder = getOrCreateFolder_(root, project);
    const threads = label.getThreads(state.off, BACKFILL.BATCH_THREADS);

    if (!threads.length) { state.li++; state.off = 0; continue; }

    let restulPreaVechi = false;
    for (let i = 0; i < threads.length; i++) {
      if ((Date.now() - t0) >= BACKFILL.BUDGET_MS) break;
      const thread = threads[i];
      // firele vin sortate desc dupa activitate: cand am trecut de cutoff, restul e si mai vechi
      if (thread.getLastMessageDate() < cutoff) { restulPreaVechi = true; state.off += i; break; }
      thread.getMessages().forEach(function (msg) {
        if (msg.getDate() < cutoff) return;
        msg.getAttachments({ includeInlineImages: false, includeAttachments: true })
           .forEach(function (att) {
             if (!shouldSave_(att).ok) return;
             const saved = saveAttachment_(att, msg, projectFolder, project);
             if (saved) rows.push(saved);
           });
      });
      if (i === threads.length - 1) state.off += threads.length;
    }
    if (restulPreaVechi) { state.li++; state.off = 0; }
  }

  if (rows.length) writeLog_(root, rows);

  if (state.li >= labels.length) {
    props.deleteProperty('BACKFILL_STATE');
    ScriptApp.getProjectTriggers()
      .filter(function (t) { return t.getHandlerFunction() === 'backfillRun'; })
      .forEach(ScriptApp.deleteTrigger);
    Logger.log('BACKFILL TERMINAT. %s fisiere in tura finala.', rows.length);
  } else {
    props.setProperty('BACKFILL_STATE', JSON.stringify(state));
    Logger.log('Backfill: eticheta %s/%s, offset %s, %s fisiere in tura asta.',
      state.li + 1, labels.length, state.off, rows.length);
  }
}

// ---------------------------------------------------------------
// ETICHETARE RETROACTIVA — acopera istoricul
// ---------------------------------------------------------------
// Filtrele Gmail se aplica DOAR mailului nou. Cand adaugi un proiect (sau ii pui
// criterii de filtru abia acum), corespondenta veche ramane neetichetata, deci
// backfill-ul n-are ce sa gaseasca. Functia asta cauta in Gmail dupa exact
// aceleasi criterii ca filtrul si pune eticheta pe firele vechi.
//
// FLUX RECOMANDAT pentru proiecte noi:
//   1. RETRO.DRY_RUN = true  → aplicaEticheteRetroactiv() → vezi in log cate fire ar prinde
//   2. daca numerele arata bine: RETRO.DRY_RUN = false → aplicaEticheteRetroactiv()
//   3. setupBackfillSelectiv() → trage atasamentele in Drive + platforma

const RETRO = {
  DAYS: 365,          // cat de departe in urma caut mail de etichetat
  MAX_THREADS: 1000,  // plafon per proiect (protectie)
  CHUNK: 100,         // addToThreads accepta max 100 fire
  DRY_RUN: true,      // true = nu eticheteaza nimic, doar numara
};

function aplicaEticheteRetroactiv() {
  const proiecte = fetchGmailConfig_();
  if (!proiecte) { Logger.log('Nu am putut lua configul din platforma (Script Properties?).'); return; }

  proiecte.forEach(function (pr) {
    if (!pr.eticheta_gmail) return;
    const criterii = construiesteQuery_(pr);
    if (!criterii) { Logger.log('skip %s — proiectul nu are criterii de filtru', pr.eticheta_gmail); return; }

    const fullName = CFG.PARENT_LABEL + '/' + pr.eticheta_gmail;
    const label = GmailApp.getUserLabelByName(fullName) || GmailApp.createLabel(fullName);
    // -label: exclude ce e deja etichetat => in modul real, firele ies din rezultate
    // pe masura ce le etichetam si putem relua mereu de la offset 0.
    const q = criterii + ' -label:"' + fullName + '" newer_than:' + RETRO.DAYS + 'd';

    let total = 0, tur = 0;
    while (total < RETRO.MAX_THREADS && tur < 20) {
      tur++;
      const threads = GmailApp.search(q, RETRO.DRY_RUN ? total : 0, RETRO.CHUNK);
      if (!threads.length) break;
      if (!RETRO.DRY_RUN) label.addToThreads(threads);
      total += threads.length;
      if (threads.length < RETRO.CHUNK) break;
    }
    Logger.log('%s %s: %s fire   [q: %s]',
      RETRO.DRY_RUN ? '[DRY] as eticheta' : 'ETICHETATE', pr.eticheta_gmail, total, q);
  });
  if (RETRO.DRY_RUN) Logger.log('--- DRY_RUN activ: nu s-a etichetat nimic. Pune RETRO.DRY_RUN = false si ruleaza din nou. ---');
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
