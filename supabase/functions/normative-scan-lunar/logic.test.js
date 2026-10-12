import { describe, it, expect } from 'vitest';
import {
  ultimulScan, inventarLot, extrageJSON, clasifica, leagaLot, grupeaza, egalConstant,
  nrLoturi, idsLot, ordoneazaDupaIds, faraRand, lotSarit, urmatorulPas, areNotaScan, linieNota, costAprox, construiesteMail,
} from './logic.js';

const lot = [
  { id: 7, identificator: 'Legea 98/2016', tip: 'Lege', numar: '98/2016', titlu: 'achiziții publice', stare: 'în vigoare' },
  { id: 12, identificator: 'NTPEE-2018', tip: 'Ordin', numar: '89/2018', titlu: 'Norme tehnice gaze', stare: 'în vigoare', modificari_ulterioare: 'Ord. 2020' },
];

describe('potrivire dupa id', () => {
  it('leaga dupa id chiar daca identificatorul vine cu titlul lipit', () => {
    const c = clasifica({ id: 7, identificator: 'Legea 98/2016 privind achizițiile publice', verdict: 'schimbare_noua', tip: 'modificat' }, lot, null);
    expect(c.id).toBe(7);
    expect(c.verdict).toBe('schimbare_noua');
  });
  it('accepta id ca string si "id=12"', () => {
    expect(clasifica({ id: '12', verdict: 'neschimbat' }, lot).id).toBe(12);
    expect(clasifica({ id: 'id=12', verdict: 'neschimbat' }, lot).id).toBe(12);
  });
  it('ignora id strain lotului', () => {
    expect(clasifica({ id: 99, verdict: 'schimbare_noua' }, lot)).toBeNull();
  });
  it('randurile fara verdict raman ca necunoscut, dublurile se ignora', () => {
    const r = leagaLot([{ id: 7, verdict: 'neschimbat' }, { id: 7, verdict: 'schimbare_noua' }], lot, null);
    expect(r).toHaveLength(2);
    expect(r.find((x) => x.id === 7).verdict).toBe('neschimbat');
    expect(r.find((x) => x.id === 12).verdict).toBe('necunoscut');
  });
  it('inventarul contine id-ul', () => {
    expect(inventarLot(lot)).toContain('id=12 | NTPEE-2018');
  });
});

describe('clasificare', () => {
  it('schimbare cu data_act inainte de ultimul scan devine forma_incompleta', () => {
    expect(clasifica({ id: 7, verdict: 'schimbare_noua', data_act: '2025-03-01' }, lot, '2026-09-01').verdict).toBe('forma_incompleta');
  });
  it('schimbare dupa ultimul scan ramane semnal', () => {
    expect(clasifica({ id: 7, verdict: 'schimbare_noua', data_act: '2026-09-15' }, lot, '2026-09-01').verdict).toBe('schimbare_noua');
  });
  it('verdict invalid → necunoscut', () => {
    expect(clasifica({ id: 7, verdict: 'modificat' }, lot).verdict).toBe('necunoscut');
  });
  it('grupeaza semnalele separat', () => {
    const g = grupeaza(leagaLot([{ id: 7, verdict: 'schimbare_noua' }, { id: 12, verdict: 'forma_incompleta' }], lot));
    expect(g.schimbare_noua.map((x) => x.id)).toEqual([7]);
    expect(g.forma_incompleta.map((x) => x.id)).toEqual([12]);
  });
  it('ultimulScan citeste cea mai noua data din note', () => {
    expect(ultimulScan([{ note: '⚠ SCAN 2026-08-01: x' }, { note: 'SCAN 2026-09-01 ok\nSCAN 2026-07-01' }, {}])).toBe('2026-09-01');
    expect(ultimulScan([])).toBeNull();
  });
  it('extrageJSON tolereaza text in jur si JSON stricat', () => {
    expect(extrageJSON('iata: [{"id":7}] gata')).toEqual([{ id: 7 }]);
    expect(extrageJSON('[nu e json')).toBeNull();
  });
});

describe('egalConstant', () => {
  it('compara corect si respinge secret lipsa', () => {
    expect(egalConstant('abc', 'abc')).toBe(true);
    expect(egalConstant('abd', 'abc')).toBe(false);
    expect(egalConstant('ab', 'abc')).toBe(false);
    expect(egalConstant('abcd', 'abc')).toBe(false);
    expect(egalConstant('', '')).toBe(false);
    expect(egalConstant('x', undefined)).toBe(false);
  });
});

describe('v10 — scan in bucati', () => {
  it('nrLoturi: 37 acte / 6 = 7 loturi, 0 acte = 0, marime invalida arunca', () => {
    expect(nrLoturi(37, 6)).toBe(7);
    expect(nrLoturi(36, 6)).toBe(6);
    expect(nrLoturi(0, 6)).toBe(0);
    expect(() => nrLoturi(5, 0)).toThrow();
  });
  it('idsLot taie in ordinea rularii; ultimul lot e partial', () => {
    const ids = Array.from({ length: 37 }, (_, i) => i + 100);
    expect(idsLot(ids, 0, 6)).toEqual([100, 101, 102, 103, 104, 105]);
    expect(idsLot(ids, 6, 6)).toEqual([136]);
    expect(idsLot(ids, 7, 6)).toEqual([]);
    expect(idsLot(['5', '6'], 0, 6)).toEqual([5, 6]);
  });
  it('ordoneazaDupaIds pastreaza ordinea si sare randurile disparute', () => {
    expect(ordoneazaDupaIds([{ id: 12 }, { id: 7 }], [7, 99, 12]).map((r) => r.id)).toEqual([7, 12]);
  });
  it('faraRand scoate randul (note) din verdictele salvate', () => {
    const v = faraRand(leagaLot([{ id: 7, verdict: 'neschimbat' }], lot, null));
    expect(v[0]).not.toHaveProperty('rand');
    expect(Object.keys(v[0]).sort()).toEqual(['data_act', 'detalii', 'id', 'identificator', 'tip', 'verdict']);
    expect(JSON.stringify(v)).not.toContain('Ord. 2020');
  });
  it('lotSarit: toate actele necunoscut, cu motivul', () => {
    const v = lotSarit(lot, 'sărit');
    expect(v.map((x) => x.verdict)).toEqual(['necunoscut', 'necunoscut']);
    expect(v[0].detalii).toBe('sărit');
  });
  it('urmatorulPas: lot / final / nimic', () => {
    expect(urmatorulPas({ stare: 'in_curs', lot_curent: 3, nr_loturi: 7 })).toBe('lot');
    expect(urmatorulPas({ stare: 'in_curs', lot_curent: 7, nr_loturi: 7, mail_la: null })).toBe('final');
    expect(urmatorulPas({ stare: 'in_curs', lot_curent: 0, nr_loturi: 0 })).toBe('final');
    expect(urmatorulPas({ stare: 'in_curs', lot_curent: 7, nr_loturi: 7, mail_la: '2026-11-01' })).toBe('nimic');
    expect(urmatorulPas({ stare: 'finalizat', lot_curent: 7, nr_loturi: 7 })).toBe('nimic');
    expect(urmatorulPas(null)).toBe('nimic');
  });
  it('areNotaScan: nota de azi nu se mai adauga a doua oara', () => {
    const azi = '2026-11-01';
    const nota = linieNota({ verdict: 'schimbare_noua', tip: 'modificat', data_act: '2026-10-20', detalii: 'x' }, azi);
    expect(nota).toContain('SCAN 2026-11-01');
    expect(areNotaScan('vechi\n' + nota, azi)).toBe(true);
    expect(areNotaScan('⚠ SCAN 2026-10-01: y', azi)).toBe(false);
    expect(areNotaScan(null, azi)).toBe(false);
  });
  it('linieNota: forma incompleta are alt marcaj', () => {
    expect(linieNota({ verdict: 'forma_incompleta', detalii: 'gol' }, '2026-11-01')).toMatch(/^ℹ SCAN 2026-11-01: forma cunoscută incompletă/);
  });
  it('costAprox', () => {
    expect(costAprox(1e6, 1e5, 10)).toBeCloseTo(5 + 2.5 + 0.1);
    expect(costAprox()).toBe(0);
  });
  it('construiesteMail: semnalele primele, TEST in subiect, HTML scapat, erori listate', () => {
    const r = {
      id: 4, test: true, azi: '2026-11-01', ref_scan: '2026-10-01', nr_loturi: 7, acte_ids: Array(37).fill(1),
      cautari: 40, tok_in: 1000, tok_out: 100, erori: ['lot 3/7: <b>timeout</b>'],
      verdicte: [
        { id: 1, identificator: 'NTPEE', verdict: 'neschimbat', detalii: 'ok' },
        { id: 2, identificator: 'Legea <98>', verdict: 'schimbare_noua', tip: 'modificat', data_act: '2026-10-20', detalii: 'OUG' },
      ],
    };
    const m = construiesteMail(r, null);
    expect(m.nSemn).toBe(1);
    expect(m.subiect).toMatch(/^\[TEST\] .*1 schimbări noi de verificat \(37 acte\)/);
    expect(m.html.indexOf('Schimbări noi')).toBeLessThan(m.html.indexOf('Neschimbat'));
    expect(m.html).toContain('Legea &lt;98&gt;');
    expect(m.html).toContain('&lt;b&gt;timeout');
    expect(m.html).toContain('7 loturi');
    expect(m.html).toContain('TEST: nimic scris');
  });
  it('construiesteMail: rulare reala fara semnale, cu erori → „scan cu erori”', () => {
    const m = construiesteMail({ id: 5, test: false, azi: '2026-11-01', nr_loturi: 1, acte_ids: [1], verdicte: [], erori: ['x'] }, 0);
    expect(m.subiect).toContain('scan cu erori');
    expect(m.html).toContain('note scrise: 0');
  });
});
