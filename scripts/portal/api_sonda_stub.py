#!/usr/bin/env python3
"""Portal E1 r22: API REST FALS, doar pe 127.0.0.1, pentru testele verificarii schemelor expuse (scheme_expuse.sh).

NU e folosit pe productie. Raspunde la orice GET cu eroarea PGRST106 a PostgREST 13 (lista schemelor expuse in hint),
ca API-ul real cand profilul cerut nu exista; --raspuns brut trimite alt text (raspuns nerecunoscut = NECUNOSCUT).
Portul ales de sistem se scrie in --port-fisier (testul il citeste). Se opreste singur dupa --durata secunde.

  python3 scripts/portal/api_sonda_stub.py --scheme 'public, graphql_public' --port-fisier <f> [--durata 600]
  python3 scripts/portal/api_sonda_stub.py --brut '{"code":"PGRST301","message":"JWT expired"}' --port-fisier <f>
"""
import argparse
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ap = argparse.ArgumentParser()
grup = ap.add_mutually_exclusive_group(required=True)
grup.add_argument("--scheme")
grup.add_argument("--brut")
ap.add_argument("--port-fisier", required=True)
ap.add_argument("--durata", type=int, default=600)
args = ap.parse_args()

if args.scheme is not None:
    CORP = json.dumps({"code": "PGRST106", "details": None,
                       "hint": "Only the following schemas are exposed: " + args.scheme,
                       "message": "Invalid schema: portal_e1_sonda_inexistenta"}).encode()
else:
    CORP = args.brut.encode()


class H(BaseHTTPRequestHandler):
    def do_GET(self):
        # cererea trebuie sa aiba antetele unei sonde reale (cheia nu se afiseaza si nu se pastreaza)
        if not self.headers.get("apikey") or self.headers.get("Accept-Profile") != "portal_e1_sonda_inexistenta":
            self.send_response(400)
            self.end_headers()
            self.wfile.write(b'{"code":"STUB","message":"sonda fara antetele cerute"}')
            return
        self.send_response(406)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(CORP)

    def log_message(self, *a):
        pass


srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
with open(args.port_fisier, "w", encoding="utf-8") as f:
    f.write(str(srv.server_address[1]))
threading.Timer(args.durata, srv.shutdown).start()
srv.serve_forever()
