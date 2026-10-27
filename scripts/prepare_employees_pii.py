"""Inventar static reproductibil; nu modifica sursele aplicatiei."""
from pathlib import Path
import argparse
import re
import unicodedata

ROOT = Path(__file__).resolve().parent.parent
PERSONAL = 'cnp,iban,adresa,data_nasterii,telefon,email,observatii_hr,qr_pin,qr_pin_active,qr_pin_creat_la,marime_incaltaminte,marime_imbracaminte'.split(',')

def ascii_text(value):
    return unicodedata.normalize('NFKD', value).encode('ascii', 'backslashreplace').decode()

def inventory(target):
    if not target.resolve().is_relative_to(ROOT):
        raise SystemExit('Output permis numai in worktree')
    if target.exists():
        raise SystemExit('Inventarul existent este pastrat; foloseste --output pentru alta cale')
    out = ['# EMPLOYEES PII - inventar static', '',
           'Sursa: worktree, fara conexiune BD. Nu reprezinta catalogul live.',
           'Fiecare aparitie executabila directa/embed este listata; SQL include si DDL/FK/trigger pentru completitudine.',
           'Coloanele SQL sunt referintele din blocul obiectului, nu dovada ca toate sunt returnate.',
           'Inventarul descrie starea curenta; liniile indica fisierele citite la generare.', '',
           '## Citiri / scrieri src si edge', '', '| Loc | Utilizator | Operatie / coloane cerute | Personal necesar |', '| --- | --- | --- | --- |']
    counts = {}
    for base in ['src', 'supabase/functions', 'api']:
        count = 0
        for path in sorted((ROOT / base).rglob('*')):
            if not path.is_file() or path.suffix not in ['.jsx', '.js', '.ts']: continue
            text = path.read_text(encoding='utf-8-sig')
            for match in re.finditer(r"\.from\(\s*['\"]employees['\"]\s*\)|\bemployees(?:![\w]+)?\s*\(", text):
                line = text.count('\n', 0, match.start()) + 1
                if text[text.rfind('\n', 0, match.start())+1:match.start()].lstrip().startswith('//'): continue
                chunk = text[match.start():match.start()+2200]
                direct = match.group().startswith('.')
                if direct:
                    op = re.search(r'\.(select|update|insert|delete)\(', chunk)
                    if not op: continue
                    start = op.start()
                    # Balansare pentru payload-uri multiline si .select dupa INSERT.
                    depth = 0
                    end = start
                    for pos in range(op.end()-1, len(chunk)):
                        if chunk[pos] == '(': depth += 1
                        if chunk[pos] == ')': depth -= 1
                        if depth == 0:
                            end = pos+1
                            break
                    detail = chunk[:end]
                    if op.group(1) in ['insert', 'update']:
                        tail = chunk[end:end+130]
                        ret = re.search(r'\.select\([^)]*\)', tail)
                        if ret: detail += ' RETURNING ' + ret.group()
                    count += 1
                else:
                    detail = chunk[:chunk.find(')')+1]
                fields = [c for c in PERSONAL if re.search(r'\b'+c+r'\b', detail)]
                broad = bool(re.search(r"\.select\(\s*(?:\)|['\"]\*)", detail))
                who = 'HR / owner' if path.name.startswith(('HR.', 'Hr')) else 'ERP: '+path.stem
                if base != 'src': who = 'Server: '+path.parent.name
                need = ','.join(fields) if fields else ('DE AUDITAT: wildcard' if broad else 'Nu; identificare/operational')
                detail = ' '.join(detail.split()).replace('|', '\\|')
                out.append(f'| {path.relative_to(ROOT).as_posix()}:{line} | {who} | `{ascii_text(detail)}` | {need} |')
        counts[base] = count
    out += ['', 'Apeluri directe gasite: '+str(counts)+'. Numarul din brief nu este folosit ca total presupus.', '', '## SQL: migrari, obiecte si coloane', '',
            '| Loc | Obiect / context | Coloane mentionate in obiect (superset) | Referinta |', '| --- | --- | --- | --- |']
    sqlpaths = sorted((ROOT/'supabase/migrations').glob('*.sql')) + sorted(ROOT.glob('*.sql'))
    for path in sqlpaths:
        text = path.read_text(encoding='utf-8-sig')
        objects = list(re.finditer(r'(?im)^CREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?(?:FUNCTION|VIEW|TRIGGER|TABLE|POLICY)\s+([^\s(]+)', text))
        for match in re.finditer(r'\bemployees\b', text):
            line_start = text.rfind('\n', 0, match.start())+1
            line_end = text.find('\n', match.start())
            ref = text[line_start:line_end if line_end >= 0 else len(text)].strip()
            if ref.startswith('--'): continue
            previous = [o for o in objects if o.start() < match.start()]
            obj = previous[-1] if previous else None
            following = next((o.start() for o in objects if o.start() > match.start()), len(text))
            block = text[obj.start() if obj else line_start:following]
            known = PERSONAL + 'id,name,department,position,active,created_at,site_id,hire_date,termination_date,functii_extra,functie,departament_hr,rol_in_firma,are_autorizatii,cetatenie,tip_contract,procent_ocupare,co_maxim_zile,cetatenie_secundara,protejat_la_stergere,cod_cor,functie_cim,colaborare_externa_status,colaborare_externa_confirmat_de,colaborare_externa_confirmat_la,colaborare_externa_nota,colaborare_externa_document'.split(',')
            fields = ','.join(c for c in known if re.search(r'\b'+c+r'\b', block)) or 'Niciuna explicita (verifica rowtype/*)'
            line = text.count('\n', 0, match.start())+1
            out.append(f'| {path.relative_to(ROOT).as_posix()}:{line} | {obj.group(1) if obj else "DDL/preflight"} | {fields} | `{ascii_text(ref).replace("|", " / ")}` |')
    out += ['', '## Constatari revizuite', '',
            '- HR: lista activa, fisa fostului angajat, wizard. Date personale pentru owner/can_access_personal_data. INSERT wizard returneaza deja doar id,name.',
            '- App: pontaj/dashboard/exporturi operationale nu cer personal. Export banca diurne cere IBAN; numai owner/HR il primeste. Admin cere observatii_hr. Salarii cere email, fara atingerea calculului.',
            '- HrPersonalExtern: emailul fostului angajat era folosit la potrivire omonimi; acum se completeaza doar pentru owner/HR. Verificarea autoritativa ramane in RPC/trigger existent.',
            '- Logistica QR: citirea/administrarea PIN nu mai primeste PIN pentru non-HR. Propunere de exceptie necesita decizia lui Razvan; nu se acorda aici.',
            '- Magazie EIP: marimile sunt personale conform deciziei A. Non-HR nu le mai citeste; exceptie operationala de discutat, nu acordata.',
            '- Nu am identificat un select employees.telefon pentru soferul intern in Logistica. Telefoanele soferilor externi sunt alta sursa.',
            '- fn_cont_persoana_cnp / fn_cont_persoana_chei / matcher-ele interne citesc identitate/email, dar au EXECUTE revocat pentru authenticated in migrarile existente. Nu se schimba.',
            '- fn_ofertare_personal_disponibil este INVOKER si intoarce nume/functie/autorizatii, nu coloanele personale din brief.',
            '- RPC-uri existente care folosesc employees%ROWTYPE trebuie verificate pe catalogul live pentru ACL si forma rezultatului; inventarul SQL include fiecare referinta, inclusiv migrari rollback istorice.',
            '- qr-utilaj-info, qr-alimentare-submit si qr-bon-comun-lookup sunt apelate din QrUtilajPage, dar SURSELE edge qr-* LIPSESC din worktree. Nu se poate confirma cheia folosita acolo.',
            '- Un client service_role cu SELECT pe tabel neafectat continua sa citeasca PIN; BYPASSRLS singur nu acorda privilegii de coloane. Migrarea nu revoca service_role.',
            '- View-uri owner/definer care depind de coloane personale: preflight recursiv pe pg_depend refuza expunerea efectiva catre authenticated/anon. Functiile PL/pgSQL/dynamic nu au graf complet in pg_depend; auditul live ramane obligatoriu.', '']
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text('\n'.join(out), encoding='ascii', newline='\n')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', default='docs/securitate/EMPLOYEES_PII_INVENTAR.md')
    args = parser.parse_args()
    inventory(ROOT / args.output)
