import { describe, it, expect } from 'vitest';
import { ultimulScan, inventarLot, extrageJSON, clasifica, leagaLot, grupeaza, egalConstant } from './logic.js';

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
