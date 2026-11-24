# -*- coding: utf-8 -*-
"""
cpm.py - calcul CPM/PERT determinist pentru grafic_ai.txt (Gazpet, test generator AI).

Intrare : grafic_ai.txt (tabel separat prin " | ", coloanele start/finish pot fi "?").
Ieșiri  : grafic_ai.txt (rescris cu start/finish calculate, inclusiv rezumate),
          pert_ai.txt, drum_critic_ai.txt.

Convenții:
 - calendar: zile lucrătoare luni–vineri, fără sărbători; ziua 0 = data OI (2026-11-02);
 - ES/LS = indexul primei zile lucrate; EF/LF = ES+durata (exclusiv);
   data de start = zi(ES); data de finish = zi(EF-1); jalon (durata 0) = sfârșitul zilei zi(ES-1)
   (sau zi(0) pentru jalonul de la ziua 0);
 - relații cu decalaj în zile lucrătoare: FS: ES_s >= EF_p+L ; SS: ES_s >= ES_p+L ;
   FF: EF_s >= EF_p+L ; SF: EF_s >= ES_p+L ;
 - trecerea înapoi pornește de la finalul proiectului calculat (max EF) pentru toate activitățile;
 - marja totală = LS-ES ; critic = marja 0.
"""
import datetime as dt
import re
import sys
from pathlib import Path

BAZA = Path(__file__).resolve().parent
F_GRAFIC = BAZA / "grafic_ai.txt"
F_PERT = BAZA / "pert_ai.txt"
F_CRITIC = BAZA / "drum_critic_ai.txt"

DATA_OI = dt.date(2026, 11, 2)
TERMEN_CONTRACT = dt.date(2027, 2, 1)  # 3 luni calendaristice de la OI (Fișa de date II.2.4 / II.2.7)

HEADER = ("WBS | rezumat | jalon | denumire | executant | durata_zile_lucratoare | sursa_durata | "
          "start | finish | predecesori (WBS tip+lag)")


# Sărbători legale RO în fereastra contractului – folosite DOAR pentru analiza de sensibilitate
# (calculul principal nu modelează sărbători, conform regulii ERP pentru acest test).
SARBATORI_RO = {dt.date(2026, 11, 30), dt.date(2026, 12, 1), dt.date(2026, 12, 25), dt.date(2026, 12, 26),
                dt.date(2027, 1, 1), dt.date(2027, 1, 2), dt.date(2027, 1, 6), dt.date(2027, 1, 7),
                dt.date(2027, 1, 24)}


def lucratoare(d, sarb=frozenset()):
    return d.weekday() < 5 and d not in sarb


def zi(idx, sarb=frozenset()):
    """Data calendaristică a zilei lucrătoare cu indexul idx (idx>=0)."""
    d = DATA_OI
    n = 0
    while not lucratoare(d, sarb):
        d += dt.timedelta(days=1)
    while n < idx:
        d += dt.timedelta(days=1)
        if lucratoare(d, sarb):
            n += 1
    return d


def index_zi(data):
    """Numărul de zile lucrătoare de la OI până la data inclusiv, minus 1 (indexul zilei)."""
    d = DATA_OI
    n = -1
    while d <= data:
        if d.weekday() < 5:
            n += 1
        d += dt.timedelta(days=1)
    return n


def fmt(d):
    return d.strftime("%Y-%m-%d")


REL = re.compile(r"^\s*([0-9][0-9.]*)\s+(FS|SS|FF|SF)\s*([+-]\s*\d+)?\s*z?\s*$")


def citeste():
    linii = F_GRAFIC.read_text(encoding="utf-8").splitlines()
    if linii[0].strip() != HEADER:
        sys.exit("Header neașteptat în grafic_ai.txt")
    rows = []
    for ln in linii[1:]:
        if not ln.strip():
            continue
        c = [x.strip() for x in ln.rstrip().rstrip("|").rstrip().split(" | ")]
        if len(c) == 9:  # ultimul câmp (predecesori) gol
            c.append("-")
        if len(c) != 10:
            sys.exit(f"Linie cu {len(c)} coloane: {ln}")
        rows.append({
            "wbs": c[0], "rezumat": c[1] == "da", "jalon": c[2] == "da", "den": c[3],
            "exec": c[4], "dur": c[5], "sursa": c[6], "pred_txt": c[9], "raw": c,
        })
    return rows


def parse_pred(txt):
    out = []
    if not txt or txt == "-":
        return out
    for p in txt.split(";"):
        p = p.strip()
        if not p:
            continue
        m = REL.match(p)
        if not m:
            sys.exit(f"Predecesor invalid: '{p}'")
        lag = int(m.group(3).replace(" ", "")) if m.group(3) else 0
        out.append((m.group(1), m.group(2), lag))
    return out


def main():
    rows = citeste()
    act = {r["wbs"]: r for r in rows if not r["rezumat"]}
    for r in act.values():
        r["d"] = int(r["dur"])
        r["preds"] = parse_pred(r["pred_txt"])
        for (p, t, l) in r["preds"]:
            if p not in act:
                sys.exit(f"{r['wbs']}: predecesor inexistent sau rezumat: {p}")
    succ = {w: [] for w in act}
    for w, r in act.items():
        for (p, t, l) in r["preds"]:
            succ[p].append((w, t, l))

    # ordonare topologică (Kahn), deterministă
    indeg = {w: len(act[w]["preds"]) for w in act}
    ordine_fisier = [r["wbs"] for r in rows if not r["rezumat"]]
    coada = [w for w in ordine_fisier if indeg[w] == 0]
    topo = []
    while coada:
        w = coada.pop(0)
        topo.append(w)
        for (s, t, l) in succ[w]:
            indeg[s] -= 1
            if indeg[s] == 0:
                coada.append(s)
    if len(topo) != len(act):
        bucla = [w for w in act if indeg[w] > 0]
        sys.exit(f"Buclă în rețea: {bucla}")

    # trecerea înainte
    for w in topo:
        r = act[w]
        es = 0
        for (p, t, l) in r["preds"]:
            P = act[p]
            if t == "FS":
                v = P["EF"] + l
            elif t == "SS":
                v = P["ES"] + l
            elif t == "FF":
                v = P["EF"] + l - r["d"]
            else:  # SF
                v = P["ES"] + l - r["d"]
            es = max(es, v)
        r["ES"] = es
        r["EF"] = es + r["d"]
    T = max(r["EF"] for r in act.values())

    # trecerea înapoi
    for w in reversed(topo):
        r = act[w]
        lf = T
        for (s, t, l) in succ[w]:
            S = act[s]
            if t == "FS":
                v = S["LS"] - l
            elif t == "SS":
                v = S["LS"] - l + r["d"]
            elif t == "FF":
                v = S["LF"] - l
            else:  # SF
                v = S["LF"] - l + r["d"]
            lf = min(lf, v)
        r["LF"] = lf
        r["LS"] = lf - r["d"]
        r["TF"] = r["LS"] - r["ES"]

    def d_start(i, dur):
        if dur == 0:
            return zi(i - 1) if i > 0 else zi(0)
        return zi(i)

    def d_fin(i_end, dur):
        if dur == 0:
            return zi(i_end - 1) if i_end > 0 else zi(0)
        return zi(i_end - 1)

    # rezumate
    rez = {}
    for r in rows:
        if r["rezumat"]:
            pref = r["wbs"] + "."
            copii = [a for w, a in act.items() if w.startswith(pref) or r["wbs"] == "0"]
            es = min(a["ES"] for a in copii)
            ef = max(a["EF"] for a in copii)
            rez[r["wbs"]] = (es, ef)

    # rescriere grafic
    out = [HEADER]
    for r in rows:
        c = list(r["raw"])
        if r["rezumat"]:
            es, ef = rez[r["wbs"]]
            c[5] = str(ef - es)
            c[7] = fmt(zi(es))
            c[8] = fmt(zi(ef - 1))
        else:
            a = act[r["wbs"]]
            c[7] = fmt(d_start(a["ES"], a["d"]))
            c[8] = fmt(d_fin(a["EF"], a["d"]))
        if not c[9]:
            c[9] = "-"
        out.append(" | ".join(c))
    F_GRAFIC.write_text("\n".join(out) + "\n", encoding="utf-8")

    # PERT
    termen_idx = index_zi(TERMEN_CONTRACT)  # ultima zi lucrătoare permisă (index)
    fin_proiect = zi(T - 1)
    rezerva = termen_idx - (T - 1)
    p = ["WBS | denumire | durata | ES | EF | LS | LF | marja | critic"]
    for w in ordine_fisier:
        a = act[w]
        p.append(" | ".join([
            w, a["den"], str(a["d"]),
            fmt(d_start(a["ES"], a["d"])), fmt(d_fin(a["EF"], a["d"])),
            fmt(d_start(a["LS"], a["d"])), fmt(d_fin(a["LF"], a["d"])),
            str(a["TF"]), "DA" if a["TF"] == 0 else "nu"]))
    nr_pres = sum(1 for a in act.values() if a["sursa"].upper().startswith("PRESUPUS"))
    p += ["",
          f"# Activități (fără rezumate): {len(act)}  | dintre care jaloane: {sum(1 for a in act.values() if a['jalon'])}"
          f"  | durate PRESUPUS: {nr_pres}",
          f"# Start (OI): {fmt(DATA_OI)}  | Final calculat: {fmt(fin_proiect)}  | Durată: {T} zile lucrătoare",
          f"# Termen contractual (3 luni calendaristice de la OI): {fmt(TERMEN_CONTRACT)} = {termen_idx + 1} zile lucrătoare"
          f"  | Rezervă față de termen: {rezerva} zile lucrătoare -> "
          + ("SE ÎNCADREAZĂ" if rezerva >= 0 else "NU SE ÎNCADREAZĂ"),
          "# Marja în zile lucrătoare; date calendaristice; jalon = sfârșitul zilei afișate.",
          f"# Sensibilitate (nemodelat în grafic): cu sărbătorile legale RO din fereastră "
          f"(30.11, 1.12, 25.12, 1.01, 6.01, 7.01 în zile lucrătoare) finalul ar deveni "
          f"{fmt(zi(T - 1, SARBATORI_RO))}"
          + (" -> DEPĂȘEȘTE termenul" if zi(T - 1, SARBATORI_RO) > TERMEN_CONTRACT else " -> în termen")]
    F_PERT.write_text("\n".join(p) + "\n", encoding="utf-8")

    # drum critic
    crit = sorted([a for a in act.values() if a["TF"] == 0],
                  key=lambda a: (a["ES"], a["EF"], ordine_fisier.index(a["wbs"])))
    c = ["# Drumul critic (marjă totală 0), în ordinea ES — derivat din grafic_ai.txt prin cpm.py",
         "nr | WBS | denumire | durata | start | finish | predecesori critici"]
    critset = {a["wbs"] for a in crit}
    for i, a in enumerate(crit, 1):
        pc = [f"{pw} {t}{('+' + str(l) + 'z') if l > 0 else (str(l) + 'z' if l < 0 else '')}"
              for (pw, t, l) in a["preds"] if pw in critset]
        c.append(" | ".join([str(i), a["wbs"], a["den"], str(a["d"]),
                             fmt(d_start(a["ES"], a["d"])), fmt(d_fin(a["EF"], a["d"])), "; ".join(pc)]))
    c += ["", f"# Durata drumului critic: {T} zile lucrătoare ({fmt(DATA_OI)} – {fmt(fin_proiect)});"
              f" termen contractual {fmt(TERMEN_CONTRACT)}; rezervă {rezerva} zile lucrătoare."]
    F_CRITIC.write_text("\n".join(c) + "\n", encoding="utf-8")

    print(f"activitati={len(act)} presupus={nr_pres} T={T} final={fmt(fin_proiect)} "
          f"termen_idx+1={termen_idx + 1} rezerva={rezerva} critice={len(crit)}")


if __name__ == "__main__":
    main()
