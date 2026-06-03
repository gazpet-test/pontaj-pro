#!/usr/bin/env python3
"""
scanner_ai.py — Gazpet NAS AI Processor
Citeste documente PDF din NAS, trimite la Haiku, populeaza BD cu date + alerte.
Python 3.11 + requests (deja instalate in container)
"""
import os, sys, json, time, datetime, hashlib
from pathlib import Path

try:
    import requests
except ImportError:
    print("Instalare requests..."); os.system("pip install requests -q")
    import requests

try:
    import pdfplumber
except ImportError:
    print("Instalare pdfplumber..."); os.system("pip install pdfplumber -q")
    import pdfplumber

SUPABASE_URL = os.environ.get('SUPABASE_URL', '').rstrip('/')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY') or os.environ.get('SUPABASE_SERVICE_KEY', '')
NAS_BASE     = os.environ.get('NAS_BASE_PATH', '/data/Oferte')
MAX_DOCS     = int(os.environ.get('MAX_DOCS_PER_RUN', '20'))
MIN_SIZE_KB  = int(os.environ.get('MIN_PDF_SIZE_KB', '100'))

if not SUPABASE_URL or not SUPABASE_KEY:
    print("EROARE: Lipsesc SUPABASE_URL sau SUPABASE_SERVICE_ROLE_KEY"); sys.exit(1)

EDGE_URL = f"{SUPABASE_URL}/functions/v1/ai-parse-project-docs"
HEADERS  = {
    'apikey': SUPABASE_KEY,
    'Authorization': f'Bearer {SUPABASE_KEY}',
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal'
}

def supabase_get(table, params=''):
    r = requests.get(f"{SUPABASE_URL}/rest/v1/{table}?{params}", headers=HEADERS, timeout=30)
    r.raise_for_status()
    return r.json()

def supabase_patch(table, filters, data):
    r = requests.patch(f"{SUPABASE_URL}/rest/v1/{table}?{filters}", headers=HEADERS, json=data, timeout=30)
    return r.status_code < 300

def extract_pdf_text(file_path, max_pages=50):
    try:
        text_parts = []
        with pdfplumber.open(file_path) as pdf:
            for i, page in enumerate(pdf.pages[:max_pages]):
                t = page.extract_text()
                if t:
                    text_parts.append(t)
        return '\n'.join(text_parts)
    except Exception as e:
        print(f"  pdfplumber: {e}")
        return None

def call_edge_function(proiect_id, doc_id_hash, text, nas_path, filename):
    payload = {
        'proiect_id': proiect_id,
        'doc_id_hash': doc_id_hash,
        'text_continut': text[:80000],
        'nas_path': nas_path,
        'filename': filename
    }
    r = requests.post(EDGE_URL, headers=HEADERS, json=payload, timeout=60)
    return r.status_code, r.json() if r.headers.get('content-type','').startswith('application/json') else {}

def scor_prioritate(denumire, nas_path):
    d = (denumire + nas_path).lower()
    if 'contract' in d and 'subcontract' not in d and 'angajament' not in d: return 100
    if 'caiet' in d or 'sarcini' in d: return 80
    if 'grafic' in d or 'program' in d: return 60
    if 'situatie' in d: return 40
    return 5

def build_physical_path(nas_path):
    relative = nas_path[len('Oferte/'):] if nas_path.startswith('Oferte/') else nas_path
    return Path(NAS_BASE) / relative

def main():
    print(f"\n🤖 Scanner NAS AI Processor (Python) — {datetime.datetime.utcnow().isoformat()}Z")
    print(f"   NAS: {NAS_BASE} · Max: {MAX_DOCS} · Min: {MIN_SIZE_KB} KB\n")

    # 1. Fetch proiecte linkate la executie
    linkate = supabase_get('nas_proiecte', 'select=id_hash,executie_proiect_id&executie_proiect_id=not.is.null')
    h2p = {x['id_hash']: x['executie_proiect_id'] for x in linkate}
    hash_list = list(h2p.keys())
    print(f"   Proiecte linkate: {len(hash_list)}\n")

    if not hash_list:
        print("Niciun proiect linkat. Stop."); return

    # 2. Fetch documente PDF neprocesate din proiectele linkate
    hash_filter = '(' + ','.join(hash_list) + ')'
    params = (f"select=id_hash,nas_path,denumire,size_bytes,proiect_id_hash"
              f"&extensie=eq.pdf"
              f"&ai_procesat_la=is.null"
              f"&size_bytes=gte.{MIN_SIZE_KB * 1024}"
              f"&proiect_id_hash=in.{hash_filter}"
              f"&limit=500")
    docs = supabase_get('nas_documente', params)

    # Sortare dupa prioritate
    for d in docs:
        d['_scor'] = scor_prioritate(d['denumire'] or '', d['nas_path'] or '')
        d['_proiect_id'] = h2p[d['proiect_id_hash']]
    docs.sort(key=lambda d: d['_scor'], reverse=True)
    docs = docs[:MAX_DOCS]

    print(f"   Selectate: {len(docs)} documente\n")
    if not docs:
        print("✅ Nimic de procesat."); return

    ok = skip = erori = 0

    for doc in docs:
        file_path = build_physical_path(doc['nas_path'])
        filename  = Path(doc['nas_path']).name
        size_mb   = doc['size_bytes'] / 1024 / 1024
        print(f"\n📄 [proiect {doc['_proiect_id']}] {filename} ({size_mb:.1f}MB scor={doc['_scor']})")

        if not file_path.exists():
            print(f"   ⚠️ Fișier lipsă: {file_path}")
            supabase_patch('nas_documente', f"id_hash=eq.{doc['id_hash']}",
                {'ai_procesat_la': datetime.datetime.utcnow().isoformat() + 'Z',
                 'ai_date_extrase': {'error': 'fisier_lipsa'}})
            skip += 1; continue

        text = extract_pdf_text(str(file_path))
        if not text or len(text.strip()) < 200:
            print(f"   ⚠️ Text insuficient ({len(text) if text else 0} chars)")
            supabase_patch('nas_documente', f"id_hash=eq.{doc['id_hash']}",
                {'ai_procesat_la': datetime.datetime.utcnow().isoformat() + 'Z',
                 'text_extras': text or '',
                 'text_extras_la': datetime.datetime.utcnow().isoformat() + 'Z',
                 'ai_date_extrase': {'error': 'text_insuficient'}})
            skip += 1; continue

        print(f"   ✓ Text: {len(text):,} chars")
        supabase_patch('nas_documente', f"id_hash=eq.{doc['id_hash']}",
            {'text_extras': text[:100000],
             'text_extras_la': datetime.datetime.utcnow().isoformat() + 'Z'})

        try:
            status, body = call_edge_function(doc['_proiect_id'], doc['id_hash'],
                                              text, doc['nas_path'], filename)
            if status == 200 and body.get('success'):
                print(f"   ✅ confidence:{body.get('confidence')}% tip:{body.get('tip_doc')} alerte:{body.get('alerte_generate')}")
                ok += 1
            else:
                print(f"   ⚠️ status {status}: {str(body)[:200]}")
                erori += 1
        except Exception as e:
            print(f"   ❌ Edge Function: {e}")
            supabase_patch('nas_documente', f"id_hash=eq.{doc['id_hash']}",
                {'ai_procesat_la': datetime.datetime.utcnow().isoformat() + 'Z',
                 'ai_date_extrase': {'error': str(e)}})
            erori += 1

        time.sleep(1)

    print(f"\n{'='*50}")
    print(f"✅ OK:{ok}  ⚠️ Skip:{skip}  ❌ Erori:{erori}  Cost:~${ok*0.012:.3f}")
    print(f"{'='*50}\n")

if __name__ == '__main__':
    main()
