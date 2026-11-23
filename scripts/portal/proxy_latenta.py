"""Runda 14 a runnerului (portal r18): proxy TCP local care intarzie FIECARE sens cu D ms (latenta de propagare, fara
limita de banda) — ca traseul de productie (pooler Supabase de pe serverul din Ploiesti: ~41 ms pe drum client-server).

De ce un proxy si nu `tc netem`: netem cere root (CAP_NET_ADMIN) si intarzie TOT traficul pe loopback (inclusiv alte
clustere / harness-uri de pe masina); proxy-ul ruleaza ca utilizatorul harness-ului, atinge doar conexiunile prin portul
lui si dispare cu procesul (oprit de harness la iesire, si la esec). Doar Python 3 stdlib.

Utilizare: python3 proxy_latenta.py --asculta <port> --tinta <port> --intarziere-ms <D> --gata <fisier>
  asculta pe 127.0.0.1:<port>, conecteaza fiecare client la 127.0.0.1:<tinta>; fiecare bucata primita pe un sens e
  trimisa mai departe la exact D ms dupa primire, in ordine (un drum dus-intors = 2 x D). <fisier> se scrie cand portul
  asculta (harness-ul il asteapta).
"""
import argparse
import asyncio
import socket
import sys
import time


async def pompa(cititor, scriitor, d):
    coada = asyncio.Queue()

    async def trimite():
        while True:
            t, bucata = await coada.get()
            if bucata is None:
                break
            ramas = t - time.monotonic()
            if ramas > 0:
                await asyncio.sleep(ramas)
            scriitor.write(bucata)
            await scriitor.drain()
        try:
            scriitor.write_eof()
        except (OSError, RuntimeError):
            pass

    sarcina = asyncio.create_task(trimite())
    try:
        while True:
            bucata = await cititor.read(65536)
            coada.put_nowait((time.monotonic() + d, bucata if bucata else None))
            if not bucata:
                break
    except (OSError, ConnectionError):
        coada.put_nowait((0, None))
    try:
        await sarcina
    except (OSError, ConnectionError):
        pass


def fara_nagle(s):
    sock = s.get_extra_info("socket")
    if sock is not None:
        sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)


async def client(cr, cw, tinta, d):
    try:
        sr, sw = await asyncio.open_connection("127.0.0.1", tinta)
    except OSError:
        cw.close()
        return
    fara_nagle(cw)
    fara_nagle(sw)
    await asyncio.gather(pompa(cr, sw, d), pompa(sr, cw, d), return_exceptions=True)
    for w in (cw, sw):
        try:
            w.close()
        except OSError:
            pass


async def main():
    p = argparse.ArgumentParser()
    p.add_argument("--asculta", type=int, required=True)
    p.add_argument("--tinta", type=int, required=True)
    p.add_argument("--intarziere-ms", type=float, required=True)
    p.add_argument("--gata", required=True)
    a = p.parse_args()
    d = a.intarziere_ms / 1000.0
    srv = await asyncio.start_server(lambda r, w: client(r, w, a.tinta, d), "127.0.0.1", a.asculta)
    with open(a.gata, "w", encoding="ascii") as f:
        f.write(f"{a.asculta}\n")
    async with srv:
        await srv.serve_forever()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        sys.exit(0)
