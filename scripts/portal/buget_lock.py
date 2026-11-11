#!/usr/bin/env python3
"""r9 / r10: contractul static al bugetului de lock pentru 18a / 19a si revenirile lor.

Folosit de test_static.py si test_static_1b.py (si pe mutanti). Nu inlocuieste probele din harness
(scripts/portal/concurrency_lock.sh), care masoara efectiv lock-urile tinute, fereastra lor si asteptarea utilizatorilor.
probleme(sql, moduri, existente) intoarce lista abaterilor; goala = acceptat.

r10 (al doilea recenzent r9 P1-01, Jakarinos r9 P2):
  * lock_timeout / statement_timeout sunt PRIMELE instructiuni (inaintea oricarui lock, inclusiv cel consultativ);
    lock-ul consultativ numai pg_try_advisory_xact_lock (refuz, nu asteptare); PostgreSQL 17 cerut;
  * [r10/r11, INLOCUIT in r12] in $locks$, dupa bucla: transaction_timeout pornit de la zero (0, apoi 2 s);
  * dupa $locks$ ramane exact o instructiune: DO $critic$;
r12 (harness-ul PG17 real: un ceas transaction_timeout deja pornit nu se reporneste in mijlocul tranzactiei):
  * fisierul NU schimba transaction_timeout nicaieri: in textul executat (fara comentarii; cu literali si corpuri)
    numele apare EXACT o data, in verificarea din $pre$ (pg_settings ... '2000/client' => PORTAL_PLAFON_TRANZACTIE_REQUIRED),
    inaintea lock-ului consultativ si a primei schimbari; niciun RESET in codul executat;
  * reincercarea din $locks$ se socoteste de la BEGIN: clock_timestamp() >= now() + interval '1 second'.
r14 (pooler-ul de productie nu transmite optiunile de conectare; al doilea recenzent r13 P1): verificarea din $pre$ cere
  2000/session (SET-ul de sesiune al runnerului inainte de BEGIN) + marcajul plafonului (gazpet.plafon_tranzactie), citit
  din pg_catalog.pg_settings CALIFICAT; „pg_settings” apare in codul executat EXACT o data (in verificare), iar in tot
  fisierul (cu comentarii) numele ceasului si „pg_settings” apar doar in citirea exacta (regula validatorului cu plafon).
  * inainte de $locks$ nicio instructiune care ia (fie si ACCESS SHARE) un lock pe un tabel EXISTENT: referinte in
    codul executat (nivel superior, corpuri DO, corpuri de functii non-plpgsql, care se analizeaza la creare), apeluri
    ale functiilor portalului care citesc astfel de tabele, EXECUTE dinamic intr-un DO. Literalii, comentariile si
    corpurile plpgsql (neanalizate la creare) nu conteaza.
"""
import re

TABELE_UTILIZATORI = ('auth.users', 'public.employees', 'public.profiles', 'public.user_module_access')
TABELE_18A = ('public.conturi_tip', 'public.conturi_teren', 'public.conturi_tip_jurnal', 'public.portal_public_baseline')
TABELE_19A = ('public.portal_provisioning', 'public.portal_provisioning_jurnal', 'public.portal_e1_1b_manifest')
PRIMA_SCHIMBARE = re.compile(r'^(CREATE|ALTER|DROP|GRANT|REVOKE|INSERT|UPDATE|DELETE|COMMENT)\b', re.M)
TAG = re.compile(r'\$([A-Za-z_][A-Za-z0-9_]*)?\$')
EXECUTA = re.compile(r'^\s*(SELECT|INSERT|UPDATE|DELETE|WITH|VALUES|CALL|CREATE\s+(TEMP|TEMPORARY)?\s*TABLE\b.*\bAS\b)', re.S | re.I)


def _segmente(text):
    """Lexic PostgreSQL simplificat: [(tip, text)], tip = 'cod' | 'lit' ('...', E'...') | 'dolar' (corpul $tag$...$tag$).
    Comentariile (-- si /* */ imbricate) devin spatiu; identificatorii "..." raman cod."""
    i, n, out, cur = 0, len(text), [], []

    def flush():
        if cur:
            out.append(('cod', ''.join(cur)))
            cur.clear()

    while i < n:
        c = text[i]
        if text.startswith('--', i):
            j = text.find('\n', i)
            i = n if j < 0 else j
            cur.append(' ')
            continue
        if text.startswith('/*', i):
            depth, j = 1, i + 2
            while j < n and depth:
                if text.startswith('/*', j):
                    depth, j = depth + 1, j + 2
                elif text.startswith('*/', j):
                    depth, j = depth - 1, j + 2
                else:
                    j += 1
            if depth:
                raise ValueError('comentariu neterminat')
            cur.append(' ')
            i = j
            continue
        if c == "'":
            esc = i > 0 and text[i - 1] in 'eE' and (i < 2 or not (text[i - 2].isalnum() or text[i - 2] == '_'))
            j = i + 1
            while True:
                if j >= n:
                    raise ValueError('literal neterminat')
                if esc and text[j] == '\\':
                    j += 2
                    continue
                if text[j] == "'":
                    if j + 1 < n and text[j + 1] == "'":
                        j += 2
                        continue
                    break
                j += 1
            flush()
            out.append(('lit', text[i + 1:j]))
            i = j + 1
            continue
        if c == '"':
            j = text.find('"', i + 1)
            if j < 0:
                raise ValueError('identificator neterminat')
            cur.append(text[i:j + 1])
            i = j + 1
            continue
        if c == '$' and not (i > 0 and (text[i - 1].isalnum() or text[i - 1] == '_')):
            m = TAG.match(text, i)
            if m:
                j = text.find(m.group(0), m.end())
                if j < 0:
                    raise ValueError('dollar-quote neterminat: ' + m.group(0))
                flush()
                out.append(('dolar', text[m.end():j]))
                i = j + len(m.group(0))
                continue
        cur.append(c)
        i += 1
    flush()
    return out


def _instructiuni(text):
    """Instructiunile de nivel superior, fiecare ca lista de segmente."""
    st, cur = [], []
    for tip, s in _segmente(text):
        if tip != 'cod':
            cur.append((tip, s))
            continue
        parti = s.split(';')
        for k, p in enumerate(parti):
            if p:
                cur.append(('cod', p))
            if k < len(parti) - 1:
                st.append(cur)
                cur = []
    if any(t != 'cod' or s.strip() for t, s in cur):
        st.append(cur)
    return [x for x in st if any(t != 'cod' or s.strip() for t, s in x)]


def _cod(text):
    return ' '.join(s for t, s in _segmente(text) if t == 'cod')


def _fara_comentarii(text, adanc=0):
    """r12: textul executat, fara comentarii, cu literalii si corpurile $...$ (analizate la randul lor, fara comentarii).
    Un corp care nu se poate analiza ramane intreg (fail-closed: mentiunile din el se numara)."""
    rez = []
    try:
        seg = _segmente(text)
    except ValueError:
        return text
    for t, s in seg:
        if t == 'dolar':
            rez.append(_fara_comentarii(s, adanc + 1) if adanc < 8 else s)
        else:
            rez.append(s)
    return ' '.join(rez)


PLAFON_CITIRE = "FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout'"
VERIFICARE_PLAFON = ("SELECT setting || '/' || source INTO v_plafon " + PLAFON_CITIRE + ";",
                     "IF v_plafon IS DISTINCT FROM '2000/session'",
                     "OR current_setting('gazpet.plafon_tranzactie', true) IS DISTINCT FROM '2000:' || txid_current() THEN",
                     "PORTAL_PLAFON_TRANZACTIE_REQUIRED")


def _cod_livrare(text):
    """Codul executat de livrare: nivelul superior + corpurile DO (nu corpurile functiilor create), fara comentarii si
    literali (un RPC poate lua lock-uri consultative la apel, nu la livrare)."""
    rez = []
    for st in _instructiuni(text):
        cod = ' '.join(s for t, s in st if t == 'cod')
        rez.append(cod)
        if re.match(r'\s*DO\b', cod, re.I):
            rez += [_cod(s) for t, s in st if t == 'dolar']
    return ' '.join(rez)


def _norm(cod):
    cod = re.sub(r'"([^"]*)"', r'\1', cod).lower()
    return re.sub(r'\s*\.\s*', '.', cod)


def _referinte(cod, tabele):
    """Tabelele numite in cod (fara literali / comentarii). public.x se prinde si necalificat (search_path public)."""
    cod, rez = _norm(cod), []
    for t in tabele:
        schema, nume = t.split('.')
        if schema == 'public':
            pat = r'(?<![\w.$])(public\.)?' + re.escape(nume) + r'(?![\w$])'
        else:
            pat = r'(?<![\w.$])' + re.escape(schema) + r'\.' + re.escape(nume) + r'(?![\w$])'
        if re.search(pat, cod):
            rez.append(t)
    return rez


def functii_care_citesc(texte, tabele):
    """Numele functiilor public.* definite in `texte` al caror corp numeste `tabele` sau apeleaza o astfel de functie
    (punct fix). Apelul lor INAINTE de $locks$ ar lua lock-uri implicite la executie."""
    corpuri = {}
    for text in texte:
        for st in _instructiuni(text.replace('\r\n', '\n')):
            cod = ' '.join(s for t, s in st if t == 'cod')
            m = re.match(r'\s*CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+(public\.)?(\w+)\s*\(', cod, re.I)
            if m:
                corp = ' '.join(_cod(s) for t, s in st if t == 'dolar')
                corpuri[m.group(3).lower()] = corpuri.get(m.group(3).lower(), '') + ' ' + corp
    f = {k for k, corp in corpuri.items() if _referinte(corp, tabele)}
    while True:
        nou = {k for k, corp in corpuri.items() if k not in f and any(re.search(r'\b' + re.escape(x) + r'\s*\(', _norm(corp)) for x in f)}
        if not nou:
            return f
        f |= nou


def lock_implicit_inainte(sql, tabele, functii=()):
    """Instructiunile dinaintea DO $locks$ care pot lua un lock (fie si ACCESS SHARE) pe `tabele`."""
    sql = sql.replace('\r\n', '\n')
    a = sql.find('DO $locks$')
    if a < 0:
        return ['blocul $locks$ lipsa']
    p = []
    for st in _instructiuni(sql[:a]):
        cod = ' '.join(s for t, s in st if t == 'cod')
        cap = ' '.join(cod.split())[:70]
        executat = [cod]          # textul de nivel superior conteaza mereu (FK, trigger, SELECT, CREATE TABLE AS ...)
        apeluri = []
        if re.match(r'\s*DO\b', cod, re.I):
            for t, s in st:
                if t == 'dolar':
                    corp = _cod(s)    # literalii imbricati ($x$ ... $x$) nu se executa
                    executat.append(corp)
                    apeluri.append(corp)
                    if re.search(r'\bEXECUTE\b', corp, re.I):
                        p.append('EXECUTE dinamic intr-un DO inainte de $locks$: ' + cap)
        elif re.match(r'\s*CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\b', cod, re.I):
            m = re.search(r'\bLANGUAGE\s+"?(\w+)"?', cod, re.I)
            if not m or m.group(1).lower() != 'plpgsql':
                # corpul unei functii sql se analizeaza la creare (check_function_bodies) => lock-uri implicite
                for t, s in st:
                    if t == 'dolar':
                        executat.append(_cod(s))
                        apeluri.append(_cod(s))
        elif EXECUTA.match(cod):
            apeluri.append(cod)
        for bucata in executat:
            for t in _referinte(bucata, tabele):
                p.append(f'referinta la {t} inainte de $locks$: {cap}')
        for bucata in apeluri:
            for fn in sorted(functii):
                if re.search(r'(?<![\w.$])(public\.)?' + re.escape(fn) + r'\s*\(', _norm(bucata)):
                    p.append(f'apel {fn}() inainte de $locks$ (citeste tabele existente): {cap}')
    return sorted(set(p))


def _instructiuni_lock(text):
    return re.findall(r'LOCK TABLE ([^;]*?) IN ([A-Z ]+?) MODE( NOWAIT)?;', text)


def probleme(sql, moduri, existente=TABELE_UTILIZATORI, functii=()):
    """moduri = {tabel: 'SHARE ROW EXCLUSIVE' | 'SHARE' | 'ACCESS EXCLUSIVE'} asteptat in blocul $locks$ (doar
    tabelele utilizatorilor); existente = tabelele existente inaintea livrarii (nu se ating inainte de $locks$);
    functii = functiile care citesc tabele existente (functii_care_citesc)."""
    sql = sql.replace('\r\n', '\n')
    p = []
    i_timeout = sql.find("\nSET LOCAL lock_timeout = '3s';\n")
    i_stmt = sql.find("\nSET LOCAL statement_timeout = '15s';\n")
    if i_timeout < 0 or i_stmt < 0:
        return ['lock_timeout / statement_timeout lipsa']
    if sql.count('DO $locks$') != 1 or sql.count('END $locks$;') != 1:
        return ['blocul $locks$ trebuie sa apara exact o data']
    a = sql.index('DO $locks$')
    b = sql.index('END $locks$;')
    bloc, afara = sql[a:b], sql[:a] + sql[b:]
    # r10: timeout-urile = primele doua instructiuni (inainte de $pre$, de orice lock si de lock-ul consultativ).
    prime = _instructiuni(sql)[:2]
    prime_cod = [' '.join(' '.join(s for t, s in st if t == 'cod').split()) for st in prime]
    if prime_cod != ['SET LOCAL lock_timeout =', 'SET LOCAL statement_timeout ='] or \
            [s for st in prime for t, s in st if t == 'lit'] != ['3s', '15s']:
        p.append('lock_timeout / statement_timeout nu sunt primele instructiuni')
    prima_lock = sql.find('LOCK TABLE')
    if not (i_timeout < prima_lock and i_stmt < prima_lock):
        p.append('lock_timeout dupa primul LOCK')
    cod_tot = _cod_livrare(sql)
    if re.search(r'pg_advisory_(xact_)?lock(_shared)?\s*\(', cod_tot) or 'pg_try_advisory_xact_lock(' not in cod_tot:
        p.append('lock consultativ blocant (doar pg_try_advisory_xact_lock + refuz)')
    if "current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION 'PORTAL_PG17_REQUIRED'" not in sql:
        p.append('PostgreSQL 17 necerut (plafonul tranzactiei)')
    # Pe tabelele utilizatorilor: numai in $locks$, toate cu NOWAIT, cu modurile asteptate.
    for tabele, _, _ in _instructiuni_lock(afara):
        for t in (x.strip() for x in tabele.split(',')):
            if t in TABELE_UTILIZATORI or t in existente:
                p.append('LOCK in afara $locks$: ' + t)
    gasite = {}
    for tabele, mod, nowait in _instructiuni_lock(bloc):
        if not nowait:
            p.append('LOCK fara NOWAIT in $locks$: ' + tabele)
        for t in (x.strip() for x in tabele.split(',')):
            if t in TABELE_UTILIZATORI:
                gasite[t] = mod.strip()
    if gasite != moduri:
        p.append(f'moduri {gasite} != {moduri}')
    if "IF clock_timestamp() >= now() + interval '1 second' THEN" not in bloc or 'PORTAL_LOCK_BUDGET' not in bloc \
            or "USING ERRCODE = '55P03'" not in bloc or 'WHEN lock_not_available' not in bloc or 'pg_sleep(0.05)' not in bloc:
        p.append('bucla $locks$ incompleta (buget 1 s de la BEGIN / 55P03 / NOWAIT prins / pauza)')
    # r12: plafonul = ceasul de la BEGIN din conexiunea runnerului; fisierul doar il VERIFICA (in $pre$), nu-l schimba.
    executat = _fara_comentarii(sql)
    if len(re.findall(r'transaction_timeout', executat, re.I)) != 1:
        p.append('transaction_timeout apare in codul executat in afara verificarii din $pre$ (fisierul nu are voie sa-l schimbe)')
    # r14: citirea CALIFICATA (fara umbrire prin pg_temp.pg_settings), o singura data; in tot fisierul (si comentarii) doar
    # in forma exacta (altfel validatorul runnerului cu plafon refuza fisierul inainte de conexiune).
    if len(re.findall(r'pg_settings', executat, re.I)) != 1 or \
            len(re.findall(r'(?<![\w.$"])pg_catalog\s*\.\s*pg_settings(?![\w$])', executat)) != 1:
        p.append('pg_settings citit altfel decat o data, calificat (pg_catalog.pg_settings), in verificarea din $pre$')
    mic, permise = sql.lower(), sql.count(PLAFON_CITIRE)
    if any(mic.count(x) != permise for x in ('transaction_timeout', 'pg_settings')) or re.search(r'\breset\s+all\b', mic):
        p.append('transaction_timeout / pg_settings mentionate in afara citirii exacte (sau RESET ALL): validatorul cu plafon refuza')
    if re.search(r'\bRESET\b', _cod_livrare(sql), re.I):
        p.append('RESET in codul executat (poate readuce sau schimba setarile tranzactiei)')
    i_pre, f_pre = sql.find('DO $pre$'), sql.find('END $pre$;')
    pre = sql[i_pre:f_pre] if 0 <= i_pre < f_pre else ''
    poz_v = [pre.find(x) for x in VERIFICARE_PLAFON]
    i_cons = pre.find('pg_try_advisory_xact_lock(')
    m0 = PRIMA_SCHIMBARE.search(sql)
    if min(poz_v) < 0 or poz_v != sorted(poz_v) or i_cons < 0 or poz_v[-1] > i_cons \
            or sum(sql.count(x) for x in VERIFICARE_PLAFON[:3]) != 3 or (m0 and m0.start() < f_pre):
        p.append('verificarea plafonului (2000/session + marcaj) lipsa din $pre$ sau dupa lock-ul consultativ / prima schimbare')
    # r10: dupa $locks$ exact o instructiune: DO $critic$.
    coada = sql[b + len('END $locks$;'):]
    rest = _instructiuni(coada)
    if len(rest) != 1 or not re.fullmatch(r'\s*DO\s*', ' '.join(s for t, s in rest[0] if t == 'cod')) \
            or [t for t, _ in rest[0]].count('dolar') != 1 or coada.count('DO $critic$') != 1 \
            or sql.count('DO $critic$') != 1 or sql.count('END $critic$;') != 1:
        p.append('dupa $locks$ trebuie sa ramana exact o instructiune (DO $critic$)')
    # r10: niciun lock implicit pe un tabel existent inainte de $locks$.
    p += lock_implicit_inainte(sql, tuple(TABELE_UTILIZATORI) + tuple(existente), functii)
    # Preflight-ul de drepturi inaintea primei schimbari (DO-urile de garda si SET LOCAL nu sunt schimbari).
    m = PRIMA_SCHIMBARE.search(sql)
    i_priv = sql.find('DO $priv$')
    if i_priv < 0 or 'PORTAL_PRIVILEGES_MISSING' not in sql or (m and m.start() < i_priv):
        p.append('preflight $priv$ lipsa sau dupa prima schimbare')
    return p
