"""Secret exclusiv din fișier, fără fallback; niciodată argv, loguri sau URL-uri.

Singura destinație a secretului este antetul POST către edge-ul fix. Transportul
nu urmează redirecturi/proxy; erorile publice sunt coduri fără corpuri sau URL-uri.
"""
import json
import pathlib
import re
import urllib.error
import urllib.parse
import urllib.request
from .client import BASE, opener
from .e3_contract import E3Error

SECRET_FILE = pathlib.Path('C:/Users/Gazpet-Ai/.secrete/izo_ocr_local_secret.txt')


def citeste_secret(path=SECRET_FILE):
    """Citește fișierul local; nu consultă mediul sau argumentele procesului."""
    secret = pathlib.Path(path).read_text(encoding='utf-8').strip()
    if not re.fullmatch(r'[0-9a-f]{64}', secret):
        raise E3Error('secret_invalid')
    return secret


class Edge:
    def __init__(self, secret, base=BASE, transport=None):
        p = urllib.parse.urlsplit(base)
        if p.scheme != 'https' or not p.hostname or p.username or p.password or p.query or p.fragment or p.path not in ('', '/'):
            raise E3Error('config_invalid')
        self._secret, self.base = secret, base.rstrip('/')
        self.transport = transport or opener()

    def call(self, op, **body):
        """Un singur POST; secret numai în antet, fără retry sau logging."""
        if op not in ('preia', 'link', 'arbitreaza', 'rezultat', 'heartbeat', 'curata'):
            raise E3Error('operatie_invalida')
        req = urllib.request.Request(self.base + '/functions/v1/izo-e3-ocr-local',
                                     data=json.dumps({'op': op, **body}, ensure_ascii=False).encode(), method='POST',
                                     headers={'Content-Type': 'application/json', 'x-izo-ocr-local-secret': self._secret})
        try:
            with self.transport.open(req, timeout=35 if op == 'arbitreaza' else 8) as r:
                if r.status != 200:
                    raise E3Error('edge_refuz')
                return json.loads(r.read(524289))
        except urllib.error.HTTPError:
            raise E3Error('edge_refuz') from None
        except Exception:
            # URL-urile semnate / secretul / textul OCR nu intră în excepția publică.
            raise E3Error('edge_transport') from None

    def download(self, url):
        """GET fără secret, strict în bucketul E3 al aceleiași gazde."""
        p = urllib.parse.urlsplit(url)
        expected = urllib.parse.urlsplit(self.base)
        path = urllib.parse.unquote(p.path)
        if (p.scheme, p.netloc) != (expected.scheme, expected.netloc) or p.fragment or not path.startswith('/storage/v1/object/sign/ocr-local-cereri/') or '..' in path.split('/'):
            raise E3Error('link_invalid')
        try:
            # Niciodată antetul de secret pe URL-ul Storage. Fără proxy sau redirect.
            with self.transport.open(urllib.request.Request(url), timeout=10) as r:
                data = r.read(8388609)
                if r.status != 200 or len(data) > 8388608:
                    raise E3Error('pdf_invalid')
                return data
        except Exception:
            raise E3Error('pdf_invalid') from None
