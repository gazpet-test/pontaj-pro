// Teste pentru logica ecranului „Buletine NDT” (src/izoBuletineNdtLogica.js). Date inventate (repo public).
// Valorile așteptate vin din contract (migrarea 20270114a, spec §21–§23), scrise de mână, nu din codul testat (L25).
import { describe, it, expect } from 'vitest'
import {
  tronsonNrDinCod, cheieDinServer, codDinCheie, aziBucuresti, valideazaFisier, sha256Hex, caleFisier, valideazaIncarcare,
  mapeazaEroareRpc, normalizeazaCitire, mapeazaRaspunsEdge, randuriDinCitire, parseazaLipire, pregatesteRanduriConfirmare,
  combinaCitiri, randArhivaPentruStare, calculeazaVerificari, filtreazaBuletine, coduriDinPachete, valideazaEliminare,
  MAX_PDF_OCTETI, combinaSemnaleCitiri, semnaturaRanduri, alegeCitiriSalvate,
  PREFIX_CERERE_NDT, stocareLocala, scrieCerereNdt, stergeCerereNdt, cereriNdtPastrate, decizieCheieNdt, raspunsDeSalvat,
  clasificaSalvareCitire, reconciliazaCereriNdt,
} from './izoBuletineNdtLogica.js'
import { comparaCitiri } from './lib/izoNdt.js'
import { createHash, webcrypto } from 'node:crypto'

const coduri = l => l.map(p => p.cod)

describe('tronsonNrDinCod — paritate cu fn_sud_tronson_nr (20270114a)', () => {
  // cazurile din postcondițiile migrării + forme din producție (T12, TR12, tr1 FOD)
  it.each([
    ['TR 1 FOD', 1], ['T12', 12], ['TR12', 12], ['tr1 FOD', 1], ['  T7  ', 7], ['T12-A', null], ['S12', null], ['', null], [null, null], ['T1234', null],
  ])('%s → %s', (cod, n) => expect(tronsonNrDinCod(cod)).toBe(n))
})

describe('cheile serverului ↔ cheile izoNdt', () => {
  it('T12S126 → 12|126| și înapoi', () => {
    expect(cheieDinServer('T12S126')).toBe('12|126|')
    expect(cheieDinServer('T17S50A')).toBe('17|50|A')
    expect(codDinCheie('17|50|A')).toBe('T17S50A')
  })
  it('forme invalide → null', () => {
    for (const x of ['12|126|', 'T0S5', 'T12S0', 't12s5', null, 5]) expect(cheieDinServer(x)).toBeNull()
  })
})

describe('aziBucuresti (L17)', () => {
  it('la 23:30 UTC pe 31.12 e deja 1 ianuarie în București', () => {
    expect(aziBucuresti(new Date('2026-12-31T23:30:00Z'))).toBe('2027-01-01')
    expect(aziBucuresti(new Date('2026-06-30T20:59:00Z'))).toBe('2026-06-30')
  })
})

describe('valideazaFisier', () => {
  const pdf = (size, extra = {}) => ({ name: 'b.pdf', type: 'application/pdf', size, ...extra })
  it('acceptă un PDF sub limită, cu antet %PDF-', () => {
    expect(valideazaFisier(pdf(1000), new TextEncoder().encode('%PDF-1.7'))).toBeNull()
    expect(valideazaFisier(pdf(MAX_PDF_OCTETI))).toBeNull()
  })
  it('refuză: lipsă, alt tip, gol, peste 50 MB, antet greșit', () => {
    expect(valideazaFisier(null)).toMatch(/Alege/)
    expect(valideazaFisier({ name: 'b.jpg', type: 'image/jpeg', size: 10 })).toMatch(/PDF/)
    expect(valideazaFisier(pdf(0))).toMatch(/gol/)
    expect(valideazaFisier(pdf(MAX_PDF_OCTETI + 1))).toMatch(/50 MB/)
    expect(valideazaFisier(pdf(10), new TextEncoder().encode('GIF89a'))).toMatch(/antet/)
  })
})

describe('sha256Hex', () => {
  it('dă aceeași amprentă ca node:crypto (sursă independentă), hex minuscule de 64', async () => {
    const date = new TextEncoder().encode('%PDF-1.7 buletin de test')
    const asteptat = createHash('sha256').update(Buffer.from(date)).digest('hex')
    const h = await sha256Hex(date, webcrypto.subtle)
    expect(h).toBe(asteptat)
    expect(h).toMatch(/^[0-9a-f]{64}$/)
  })
  it('fără crypto.subtle: eroare clară, nu amprentă goală', async () => {
    await expect(sha256Hex(new Uint8Array(1), null)).rejects.toThrow(/crypto\.subtle/)
  })
})

describe('caleFisier — forma din politicile sud_ndt_*', () => {
  const u = '0f8fad5b-d9cb-469f-a165-70867728950e'
  it('<proiect>/<tronson>/<uuid>.pdf, potrivită cu regula din fn_sud_buletin_incarca', () => {
    const c = caleFisier(7, '42', u)
    expect(c).toBe(`7/42/${u}.pdf`)
    expect(c).toMatch(new RegExp('^7/42/[^/]+$'))
    expect(c).toMatch(/^[0-9]{1,18}\/[0-9]{1,18}\/[^/]+$/)
  })
  it('refuză id-uri lipsă / negative și uuid invalid', () => {
    expect(() => caleFisier(null, 4, u)).toThrow()
    expect(() => caleFisier(7, -1, u)).toThrow()
    expect(() => caleFisier(7, 4, '../x')).toThrow()
  })
})

describe('valideazaIncarcare', () => {
  const azi = '2026-11-27'
  it('valori bune: metoda normalizată, numărul curățat, data ISO din ZZ.LL.AAAA', () => {
    const r = valideazaIncarcare({ metoda: 'pa ut', numar: '  403 ', data: '28.10.2026', firma: ' LAB ' }, azi)
    expect(r.ok).toBe(true)
    expect(r.valori).toEqual({ metoda: 'PA-UT', numar: '403', data: '2026-10-28', firma: 'LAB', forteazaMotiv: null })
  })
  it('lipsuri și valori în afara regulilor serverului', () => {
    const r = valideazaIncarcare({ metoda: 'XX', numar: ' ', data: '31.02.2026' }, azi)
    expect(Object.keys(r.erori).sort()).toEqual(['data', 'metoda', 'numar'])
    expect(valideazaIncarcare({ metoda: 'PM', numar: 'x'.repeat(61), data: '2026-11-01' }, azi).erori.numar).toMatch(/60/)
    expect(valideazaIncarcare({ metoda: 'PM', numar: '1', data: '2026-11-29' }, azi).erori.data).toMatch(/interval/)
    expect(valideazaIncarcare({ metoda: 'PM', numar: '1', data: '2026-11-28' }, azi).ok).toBe(true)   // azi + 1 e permis
    expect(valideazaIncarcare({ metoda: 'PM', numar: '1', data: '1999-12-31' }, azi).erori.data).toMatch(/interval/)
  })
  it('forțarea cere motiv de cel puțin 3 caractere; fără forțare motivul nu pleacă', () => {
    expect(valideazaIncarcare({ metoda: 'UT', numar: '5', data: '2026-11-01', cuForteaza: true, forteazaMotiv: 'ab' }, azi).erori.forteazaMotiv).toBeTruthy()
    const ok = valideazaIncarcare({ metoda: 'UT', numar: '5', data: '2026-11-01', cuForteaza: true, forteazaMotiv: 'alt laborator' }, azi)
    expect(ok.ok).toBe(true)
    expect(ok.valori.forteazaMotiv).toBe('alt laborator')
    expect(valideazaIncarcare({ metoda: 'UT', numar: '5', data: '2026-11-01', forteazaMotiv: 'alt laborator' }, azi).valori.forteazaMotiv).toBeNull()
  })
})

describe('mapeazaEroareRpc — mesajele exacte din 20270114a', () => {
  it('23505 fisier_deja_incarcat:<id> / buletin_deja_incarcat:<id>', () => {
    expect(mapeazaEroareRpc({ code: '23505', message: 'sud: fisier_deja_incarcat:91' })).toMatchObject({ tip: 'fisier_dublura', id: 91 })
    expect(mapeazaEroareRpc({ code: '23505', message: 'sud: buletin_deja_incarcat:12' })).toMatchObject({ tip: 'buletin_dublura', id: 12 })
    expect(mapeazaEroareRpc({ code: '23505', message: 'sud: sudura e deja marcata eliminata' })).toMatchObject({ tip: 'dublura', mesaj: 'sudura e deja marcata eliminata' })
  })
  it('40001 = versiune veche; 42501 = drept; 55000 = stare', () => {
    expect(mapeazaEroareRpc({ code: '40001', message: 'sud: buletinul s-a schimbat intre timp; reincarca' }).tip).toBe('versiune')
    expect(mapeazaEroareRpc({ code: '42501', message: 'sud: doar managerul de proiect' }).tip).toBe('drept')
    expect(mapeazaEroareRpc({ code: '55000', message: 'sud: buletinul nu e ciorna (confirmat)' }).tip).toBe('stare')
  })
  it('22023: fereastra de o oră e separată de celelalte validări', () => {
    expect(mapeazaEroareRpc({ code: '22023', message: 'sud: fisierul nu e in arhiva tronsonului, nu e incarcat de tine sau e mai vechi de o ora (reincarca-l)' }).tip).toBe('fisier_expirat')
    expect(mapeazaEroareRpc({ code: '22023', message: 'sud: metoda invalida' })).toEqual({ tip: 'validare', mesaj: 'metoda invalida' })
  })
  it('L05: rețea / 5xx / fără cod = necunoscut, nu eșec cert', () => {
    expect(mapeazaEroareRpc({ message: 'TypeError: Failed to fetch' }).tip).toBe('necunoscut')
    expect(mapeazaEroareRpc({ code: 'XX000', message: 'boom' }, 503).tip).toBe('necunoscut')
    expect(mapeazaEroareRpc({ code: '', message: 'x' }, 0).tip).toBe('necunoscut')
  })
  it('funcția lipsă (migrare neaplicată) și fără eroare', () => {
    expect(mapeazaEroareRpc({ code: 'PGRST202', message: 'Could not find the function' }, 404).tip).toBe('lipsa_rpc')
    expect(mapeazaEroareRpc(null)).toBeNull()
  })
})

describe('normalizeazaCitire / mapeazaRaspunsEdge', () => {
  const citireEdge = {
    ok: true, model: 'claude-sonnet-5-5',
    citire: { antet: { numar: '403', data: '2026-10-28', tronson: 'T12', nr_randuri_tiparit: 2, partial: true, pagini_necitite: [3] },
      randuri: [{ cod_raw: 'GAZPET TR12 S127', rezultat: 'ACCEPTED' }, { cod_raw: 'GAZPET TR12 S126R', rezultat: 'ACCEPTED' }], incerte: [] },
  }
  it('semnalele din antet urcă la rădăcină (forma lui comparaCitiri), fără să se piardă', () => {
    const r = mapeazaRaspunsEdge({ data: citireEdge })
    expect(r.tip).toBe('ok')
    expect(r.citire.partial).toBe(true)
    expect(r.citire.pagini_necitite).toEqual([3])
    expect(r.citire.antet.nr_randuri_tiparit).toBe(2)
    expect(r.citire.model).toBe('claude-sonnet-5-5')
  })
  it('formă greșită = invalid (L18), nu listă goală', () => {
    expect(normalizeazaCitire({ antet: {} }).ok).toBe(false)
    expect(normalizeazaCitire({ randuri: ['x'] }).ok).toBe(false)
    expect(normalizeazaCitire({ randuri: [], partial: 'da' }).ok).toBe(false)
    expect(normalizeazaCitire({ randuri: [], pagini_necitite: [0] }).ok).toBe(false)
    expect(mapeazaRaspunsEdge({ data: { ok: true } }).tip).toBe('invalid')
  })
  it('nepublicată (404), plafon, drept, rețea = mesaj clar; introducerea manuală rămâne', () => {
    expect(mapeazaRaspunsEdge({ error: { name: 'FunctionsHttpError', context: { status: 404 } } }).tip).toBe('nepublicat')
    expect(mapeazaRaspunsEdge({ error: { name: 'FunctionsHttpError', context: { status: 429 } }, corp: { cod: 'plafon_atins', mesaj: 'plafon lunar depășit' } }).tip).toBe('plafon')
    expect(mapeazaRaspunsEdge({ data: { ok: false, cod: 'plafon_neconfigurat' } }).tip).toBe('plafon')
    expect(mapeazaRaspunsEdge({ error: { name: 'FunctionsHttpError', context: { status: 403 } } }).tip).toBe('drept')
    const r = mapeazaRaspunsEdge({ error: { name: 'FunctionsFetchError', message: 'Failed to send a request' } })
    expect(r.tip).toBe('necunoscut')
    expect(r.mesaj).toMatch(/nu se reîncearcă automat/)
    expect(mapeazaRaspunsEdge({ error: { name: 'FunctionsHttpError', context: { status: 502 } } }).tip).toBe('necunoscut')
  })
  // 20270115b: răspunsul edge-ului cu citirea păstrată pe server (contractul handler.ts: salvata / citire_id / idempotent; codurile cererii)
  it('salvată doar cu salvata: true ȘI citire_id întreg pozitiv; altfel nesalvată (L18)', () => {
    expect(mapeazaRaspunsEdge({ data: { ...citireEdge, salvata: true, citire_id: 12, idempotent: true } })).toMatchObject({ tip: 'ok', salvata: true, citireId: 12, idempotent: true })
    for (const extra of [{}, { salvata: true }, { salvata: true, citire_id: null }, { salvata: true, citire_id: '12' }, { salvata: 'true', citire_id: 12 }, { salvata: false, citire_id: 12 }, { salvata: true, citire_id: 0 }]) {
      const r = mapeazaRaspunsEdge({ data: { ...citireEdge, ...extra } })
      expect(r.tip).toBe('ok'); expect(r.salvata).toBe(false); expect(r.citireId).toBeNull()
    }
  })
  it('codurile cererii de citire: în lucru / necunoscută / eșuată / limita / cheie refolosită — fiecare cu tipul lui, nu „plafon” sau „invalid”', () => {
    const cu = cod => mapeazaRaspunsEdge({ error: { name: 'FunctionsHttpError', context: { status: 409 } }, corp: { success: false, eroare: cod, mesaj: 'm' } })
    expect(cu('citire_in_curs').tip).toBe('in_curs')
    expect(cu('citire_in_curs').mesaj).toMatch(/nu se plătește de două ori/)
    expect(cu('citire_necunoscuta').tip).toBe('necunoscuta')
    expect(cu('citire_esuata').tip).toBe('esuata')
    expect(mapeazaRaspunsEdge({ error: { name: 'FunctionsHttpError', context: { status: 429 } }, corp: { eroare: 'prea_multe_citiri', mesaj: 'maxim 5' } }).tip).toBe('limita')
    expect(cu('cheie_alta_cerere').tip).toBe('eroare')
    // cererea indisponibilă (503) rămâne „necunoscut”: nu se știe dacă a pornit ceva
    expect(mapeazaRaspunsEdge({ error: { name: 'FunctionsHttpError', context: { status: 503 } }, corp: { eroare: 'cerere_indisponibila', mesaj: 'x' } }).tip).toBe('necunoscut')
  })
})

describe('citirile salvate (20270115b): alegerea la deschidere și semnătura rândurilor', () => {
  const C = (id, tip, stare = 'gata') => ({ id, tip, stare, citire: { randuri: [] }, model: 'claude-sonnet-5-5' })
  it('ultima principală; alternativa doar dacă e MAI NOUĂ decât ea; „in_curs” / „esuat” / fără citire nu se aleg', () => {
    expect(alegeCitiriSalvate([])).toEqual({ principal: null, alternativ: null })
    expect(alegeCitiriSalvate(null)).toEqual({ principal: null, alternativ: null })
    expect(alegeCitiriSalvate([C(1, 'alternativ')])).toEqual({ principal: null, alternativ: null })
    const a = alegeCitiriSalvate([C(1, 'principal'), C(2, 'alternativ'), C(3, 'principal'), C(4, 'alternativ', 'esuat'), C(5, 'principal', 'in_curs')])
    expect(a.principal.id).toBe(3); expect(a.alternativ).toBeNull()
    const b = alegeCitiriSalvate([C(3, 'principal'), C(1, 'principal'), C(6, 'alternativ'), C(4, 'alternativ')])
    expect(b.principal.id).toBe(3); expect(b.alternativ.id).toBe(6)
    expect(alegeCitiriSalvate([{ ...C(2, 'principal'), citire: null }]).principal).toBeNull()
  })
  it('semnătura: aceleași valori = aceeași semnătură, oricare ar fi id-urile locale; o valoare schimbată / un rând în plus = alta', () => {
    const r = randuriDinCitire({ randuri: [{ cod_raw: 'T12S1', rezultat: 'acceptat', start_mm: 1.5 }] })
    const r2 = randuriDinCitire({ randuri: [{ cod_raw: 'T12S1', rezultat: 'acceptat', start_mm: 1.5 }] })
    expect(r[0]._id).not.toBe(r2[0]._id)
    expect(semnaturaRanduri(r)).toBe(semnaturaRanduri(r2))
    expect(semnaturaRanduri([{ ...r[0], rezultat: 'respins' }])).not.toBe(semnaturaRanduri(r))
    expect(semnaturaRanduri([...r, ...r2])).not.toBe(semnaturaRanduri(r))
    expect(semnaturaRanduri([])).toBe('[]')
    // null / '' sunt același gol (celula goală din tabel); 1.5 și '1.5' aceeași valoare afișată
    expect(semnaturaRanduri([{ cod_raw: 'X', start_mm: null }])).toBe(semnaturaRanduri([{ cod_raw: 'X', start_mm: '' }]))
    expect(semnaturaRanduri([{ cod_raw: 'X', start_mm: 1.5 }])).toBe(semnaturaRanduri([{ cod_raw: 'X', start_mm: '1.5' }]))
  })
})

// ── review PR #1222 r1 P1: cheia cererii nu se pierde (registrul din browser + reluarea salvării) ──
// O stocare falsă cu interfața Storage (length / key / getItem / setItem / removeItem); `rupta` simulează stocarea plină / refuzată.
function stocareFalsa({ rupta = null, mincinoasa = false } = {}) {
  const m = new Map()
  return {
    m,
    get length() { if (rupta === 'citire') throw new Error('SecurityError'); return m.size },
    key: i => [...m.keys()][i] ?? null,
    getItem: k => { if (rupta === 'citire') throw new Error('SecurityError'); return m.has(k) ? (mincinoasa ? '{}' : m.get(k)) : null },
    setItem: (k, v) => { if (rupta === 'scriere') throw new Error('QuotaExceededError'); m.set(k, String(v)) },
    removeItem: k => { m.delete(k) },
  }
}
const K1 = '0b8f7a32-5c1d-4e2f-9a6b-1c2d3e4f5a6b', K2 = '1c9e8b43-6d2e-4f3a-8b7c-2d3e4f5a6b7c', K3 = '2daf9c54-7e3f-4a4b-9c8d-3e4f5a6b7c8d'
const INTR = (cerere, o = {}) => ({ v: 1, cerere, buletin_id: 1, tip: 'principal', faza: 'trimisa', creat_la: '2026-11-28T10:00:00.000Z', ...o })

describe('cererile de citire păstrate în browser (PR #1222 r2, P1 cheia pierdută)', () => {
  it('scrierea se verifică prin recitire; stocare lipsă / plină / care minte / intrare invalidă = false (atunci citirea plătită nu pornește)', () => {
    const s = stocareFalsa()
    expect(scrieCerereNdt(s, INTR(K1))).toBe(true)
    expect(JSON.parse(s.m.get(PREFIX_CERERE_NDT + K1))).toEqual(INTR(K1))
    expect(scrieCerereNdt(null, INTR(K1))).toBe(false)
    expect(scrieCerereNdt(stocareFalsa({ rupta: 'scriere' }), INTR(K1))).toBe(false)
    expect(scrieCerereNdt(stocareFalsa({ mincinoasa: true }), INTR(K1))).toBe(false)
    for (const rau of [INTR('nu-uuid'), INTR(K1, { tip: 'alt' }), INTR(K1, { faza: 'gata' }), INTR(K1, { buletin_id: '1' }), INTR(K1, { v: 2 }), { ...INTR(K1), creat_la: 5 }]) {
      expect(scrieCerereNdt(stocareFalsa(), rau)).toBe(false)
    }
    // ștergerea e verificată și ea; pe cheia altei cereri nu atinge nimic
    expect(stergeCerereNdt(s, K2)).toBe(true); expect(s.m.size).toBe(1)
    expect(stergeCerereNdt(s, K1)).toBe(true); expect(s.m.size).toBe(0)
    expect(stergeCerereNdt(null, K1)).toBe(false)
  })
  it('stocareLocala: fereastra fără localStorage sau cu acces care aruncă = null (nu excepție)', () => {
    expect(stocareLocala(null)).toBeNull()
    expect(stocareLocala({})).toBeNull()
    expect(stocareLocala({ get localStorage() { throw new Error('SecurityError') } })).toBeNull()
    const ls = stocareFalsa()
    expect(stocareLocala({ localStorage: ls })).toBe(ls)
  })
  it('intrările unui buletin: o intrare pe cheie, cele mai noi întâi, alt buletin / alt modul neatinse, forma greșită numărată (L12), eroarea raportată (L18)', () => {
    const s = stocareFalsa()
    scrieCerereNdt(s, INTR(K1, { creat_la: '2026-11-28T10:00:00.000Z' }))
    scrieCerereNdt(s, INTR(K2, { creat_la: '2026-11-28T11:00:00.000Z', tip: 'alternativ' }))
    scrieCerereNdt(s, INTR(K3, { buletin_id: 2 }))
    s.setItem('ctc_tab', 'carti')                                   // alt modul: nu se numără, nu se atinge
    s.setItem(PREFIX_CERERE_NDT + 'x', '{nu json')                    // formă greșită
    s.setItem(PREFIX_CERERE_NDT + K3.replace('2', '3'), JSON.stringify(INTR(K1)))   // cheia din nume ≠ cheia din conținut
    const r = cereriNdtPastrate(s, 1)
    expect(r.intrari.map(x => x.cerere)).toEqual([K2, K1])
    expect(r.invalide).toBe(2); expect(r.eroare).toBeNull()
    expect(cereriNdtPastrate(s, 2).intrari.map(x => x.cerere)).toEqual([K3])
    expect(cereriNdtPastrate(null, 1)).toEqual({ intrari: [], invalide: 0, eroare: null })
    expect(cereriNdtPastrate(stocareFalsa({ rupta: 'citire' }), 1).eroare).toMatch(/SecurityError/)
    expect(s.getItem('ctc_tab')).toBe('carti')
  })
  it('decizia pe cheie după edge: salvată = iese; citire NEsalvată = rămâne cu citirea (reproducerea r1: era „ok” și se ștergea); necunoscut / în lucru = rămâne; refuz cert = iese', () => {
    // reproducerea exactă din review-ul r1 (HTTP 200, salvata:false, avertisment salvare_neconfirmata)
    const r1 = mapeazaRaspunsEdge({ data: { success: true, salvata: false, citire_id: null, avertisment: 'salvare_neconfirmata', citire: { antet: {}, randuri: [{ cod_raw: 'T12S1', rezultat: 'acceptat' }], incerte: [], partial: false, pagini_necitite: [] } } })
    expect(r1.tip).toBe('ok'); expect(decizieCheieNdt(r1)).toBe('nesalvata')
    expect(decizieCheieNdt({ tip: 'ok', salvata: true })).toBe('sterge')
    expect(decizieCheieNdt({ tip: 'ok' })).toBe('nesalvata')
    for (const tip of ['necunoscut', 'in_curs']) expect(decizieCheieNdt({ tip })).toBe('pastreaza')
    for (const tip of ['plafon', 'drept', 'stare', 'invalid', 'eroare', 'nepublicat', 'limita', 'esuata', 'necunoscuta']) expect(decizieCheieNdt({ tip }), tip).toBe('sterge')
    expect(decizieCheieNdt(null)).toBe('pastreaza')
  })
  it('ce se păstrează pentru reluare = citirea BRUTĂ + costul, exact ca de la edge; cost lipsă / invalid = nimic de reluat (cheia rămâne „trimisa”)', () => {
    const citire = { antet: { numar: '1' }, randuri: [{ cod_raw: 'T12S1' }], incerte: [] }
    expect(raspunsDeSalvat({ citire, cost_usd: 0.0123, cost_cunoscut: true, model: 'claude-sonnet-5-5' }))
      .toEqual({ citire, cost_usd: 0.0123, cost_cunoscut: true, model: 'claude-sonnet-5-5' })
    expect(raspunsDeSalvat({ citire, cost_usd: 0.37, cost_cunoscut: false }).model).toBeNull()
    for (const rau of [null, {}, { citire: null, cost_usd: 1, cost_cunoscut: true }, { citire, cost_usd: '0.1', cost_cunoscut: true }, { citire, cost_usd: -1, cost_cunoscut: true },
      { citire, cost_usd: NaN, cost_cunoscut: true }, { citire, cost_usd: 0.1 }, { citire, cost_usd: 0.1, cost_cunoscut: 'true' }]) {
      expect(raspunsDeSalvat(rau)).toBeNull()
    }
  })
  it('reluarea salvării (fn_sud_citire_salveaza): doar 55000 / 22023 sunt certe; 42501, rețea, 5xx, funcție lipsă, id lipsă = necunoscut (cheia rămâne, L05)', () => {
    expect(clasificaSalvareCitire({ data: 31 })).toEqual({ tip: 'salvata', id: 31 })
    expect(clasificaSalvareCitire({ data: '31' })).toEqual({ tip: 'salvata', id: 31 })
    expect(clasificaSalvareCitire({ error: { code: '55000', message: 'sud: cererea de citire e deja incheiata (esuat)' } }).tip).toBe('incheiata')
    expect(clasificaSalvareCitire({ error: { code: '22023', message: 'sud: citirea are alta forma (randuri)' } }).tip).toBe('refuzata')
    for (const res of [{ error: { code: '42501', message: 'sud: doar cel care a pornit' } }, { error: { code: '', message: 'TypeError: Failed to fetch' } },
      { error: { code: 'PGRST202', message: 'lipsă' } }, { error: { code: '57014', message: 'timeout' } }, { error: { message: 'x' } },
      { data: null }, { data: 0 }, { data: -1 }, { data: 1.5 }, { data: { id: 3 } }, {}]) {
      const s = clasificaSalvareCitire(res)
      expect(s.tip, JSON.stringify(res)).toBe('necunoscut'); expect(s.mesaj).toMatch(/Reia salvarea/)
    }
    expect(clasificaSalvareCitire()).toMatchObject({ tip: 'necunoscut' })
  })
  it('la deschidere: TOATE stările de pe server — gata / esuat = iese; in_curs = rămâne (de salvat sau în lucru); rând lipsă = rămâne', () => {
    const intrari = [INTR(K1, { faza: 'nesalvata' }), INTR(K2), INTR(K3, { tip: 'alternativ' }), INTR('3ebfad65-8f4a-4b5c-8d9e-4f5a6b7c8d9e')]
    const server = [{ id: 7, cheie_idempotenta: K1.toUpperCase(), stare: 'in_curs' }, { id: 8, cheie_idempotenta: K2, stare: 'gata' },
      { id: 9, cheie_idempotenta: K3, stare: 'esuat', eroare_cod: 'apel_ai_esuat' }]
    const r = reconciliazaCereriNdt(intrari, server)
    expect(r.map(x => [x.actiune, x.motiv, x.rand?.id ?? null])).toEqual([
      ['pastreaza', 'de_salvat', 7], ['sterge', 'salvata', 8], ['sterge', 'esuata', 9], ['pastreaza', 'fara_rand', null]])
    expect(reconciliazaCereriNdt([INTR(K1)], [{ id: 7, cheie_idempotenta: K1, stare: 'in_curs' }])[0].motiv).toBe('in_lucru')
    expect(reconciliazaCereriNdt([INTR(K1)], null)[0]).toMatchObject({ actiune: 'pastreaza', motiv: 'fara_rand' })
    expect(reconciliazaCereriNdt(null, server)).toEqual([])
  })
  it('ordinea livrării: „actualizare_in_curs” (edge nou, bază fără 20270115b) = nepublicat, cert (cheia iese), mesajul edge-ului', () => {
    const r = mapeazaRaspunsEdge({ error: { name: 'FunctionsHttpError', context: { status: 503 } }, corp: { success: false, eroare: 'actualizare_in_curs', mesaj: 'Citirea cu AI e oprită cât se face actualizarea serverului. Nimic consumat.' } })
    expect(r.tip).toBe('nepublicat'); expect(r.mesaj).toMatch(/Nimic consumat/); expect(decizieCheieNdt(r)).toBe('sterge')
  })
})

describe('parseazaLipire (Excel → tabel)', () => {
  it('TAB-uri, antet sărit, linia goală de la final sărită, coloanele în ordine', () => {
    const t = 'Cod sudură\tRezultat\tData\n' + 'T12S127\tacceptat\t28.10.2026\t\t\t\t\t\t\r\n' + 'T12S126\trespins\t27.10.2026\t10\t25\t15\t2\t1,5\tporozitate\n\n'
    const r = parseazaLipire(t)
    expect(r.antetSarit).toBe(true)
    expect(r.erori).toEqual([])
    expect(r.randuri.map(x => [x.cod_raw, x.rezultat, x.data_inspectie, x.adancime_mm, x.observatii])).toEqual([
      ['T12S127', 'acceptat', '28.10.2026', '', ''], ['T12S126', 'respins', '27.10.2026', '1,5', 'porozitate'],
    ])
  })
  it('prea multe coloane = eroare pe linie, nu tăiere; un cod pe prima linie nu e antet', () => {
    const r = parseazaLipire('T12S1\tA\t\t\t\t\t\t\t\tobs\tîn plus\nT12S2\tacceptat')
    expect(r.erori).toHaveLength(1)
    expect(r.erori[0]).toMatch(/Linia 1 are 11 coloane/)
    expect(r.randuri.map(x => x.cod_raw)).toEqual(['T12S2'])
    expect(parseazaLipire('T12S5\tacceptat').antetSarit).toBe(false)
  })
})

describe('pregatesteRanduriConfirmare — contractul p_randuri din fn_sud_buletin_confirma', () => {
  it('forma exactă trimisă serverului: chei, ISO, numere, null pe gol', () => {
    const r = pregatesteRanduriConfirmare([
      { cod_raw: ' GAZPET TR12 S126 ', rezultat: 'REJECTED', data_inspectie: '27.10.2026', start_mm: '10', end_mm: 25, lungime_mm: '15', inaltime_mm: '', adancime_mm: '1,5', observatii: ' porozitate ' },
      { cod_raw: 'T12S126R', rezultat: 'acceptat', data_inspectie: '2026-10-29' },
    ])
    expect(r.ok).toBe(true)
    expect(r.randuri).toEqual([
      { cod_raw: 'GAZPET TR12 S126', rezultat: 'respins', data_inspectie: '2026-10-27', start_mm: 10, end_mm: 25, lungime_mm: 15, inaltime_mm: null, adancime_mm: 1.5, observatii: 'porozitate' },
      { cod_raw: 'T12S126R', rezultat: 'acceptat', data_inspectie: '2026-10-29', start_mm: null, end_mm: null, lungime_mm: null, inaltime_mm: null, adancime_mm: null, observatii: null },
    ])
  })
  it('erori pe rând, nimic tăiat: cod lipsă / > 80, rezultat necunoscut, dată invalidă, număr ambiguu, observații > 500, rând gol', () => {
    const r = pregatesteRanduriConfirmare([
      { cod_raw: '', rezultat: 'acceptat' },
      { cod_raw: 'x'.repeat(81), rezultat: 'poate' },
      { cod_raw: 'T12S1', rezultat: 'acceptat', data_inspectie: '32.10.2026', lungime_mm: '1.500', start_mm: 'abc', observatii: 'o'.repeat(501) },
      { cod_raw: '', rezultat: '', data_inspectie: '' },
    ])
    expect(r.ok).toBe(false)
    expect(r.randuri).toEqual([])
    expect(r.erori.map(e => [e.index, e.camp])).toEqual([
      [0, 'cod_raw'], [1, 'cod_raw'], [1, 'rezultat'], [2, 'data_inspectie'], [2, 'start_mm'], [2, 'lungime_mm'], [2, 'observatii'], [3, null],
    ])
    expect(r.erori.find(e => e.camp === 'lungime_mm').mesaj).toMatch(/ambiguu/)
  })
  it('0 rânduri și peste 2000 de rânduri = refuz', () => {
    expect(pregatesteRanduriConfirmare([]).erori[0].mesaj).toMatch(/niciun rând/)
    const multe = Array.from({ length: 2001 }, (_, i) => ({ cod_raw: `T12S${i + 1}`, rezultat: 'acceptat' }))
    expect(pregatesteRanduriConfirmare(multe).erori.some(e => /limita e 2000/.test(e.mesaj))).toBe(true)
  })
})

describe('combinaCitiri — omul alege pe rândurile diferite', () => {
  const A = { randuri: [
    { cod_raw: 'T12S1', rezultat: 'acceptat', data_inspectie: '2026-10-28' },
    { cod_raw: 'T12S2', rezultat: 'acceptat', data_inspectie: '2026-10-28' },
    { cod_raw: 'T12S3', rezultat: 'acceptat', data_inspectie: '2026-10-28' },
  ] }
  const B = { randuri: [
    { cod_raw: 'T12S1', rezultat: 'acceptat', data_inspectie: '2026-10-28' },
    { cod_raw: 'T12S2', rezultat: 'respins', data_inspectie: '2026-10-28' },
    { cod_raw: 'T12S4', rezultat: 'acceptat', data_inspectie: '2026-10-28' },
  ] }
  const cmp = comparaCitiri(A, B, { tronson: 12 })
  it('fără alegeri: potrivitele trec, restul sunt nealese (fără implicit)', () => {
    const r = combinaCitiri(cmp, {})
    expect(r.randuri.map(x => x.cod_raw)).toEqual(['T12S1'])
    expect(r.nealese.sort()).toEqual(['12|2||', '12|3||', '12|4||'])
  })
  it('cu alegeri: varianta B pe diferit, scoate doar_in_A, păstrează doar_in_B', () => {
    const r = combinaCitiri(cmp, { '12|2||': 'b', '12|3||': 'scoate', '12|4||': 'pastreaza' })
    expect(r.nealese).toEqual([])
    expect(r.randuri.map(x => [x.cod_raw, x.rezultat])).toEqual([['T12S1', 'acceptat'], ['T12S2', 'respins'], ['T12S4', 'acceptat']])
  })
})

describe('calculeazaVerificari (§23)', () => {
  const buletin = { id: 50, metoda: 'PA-UT', numar: '403', data_buletin: '2026-10-28' }
  const pachete = new Set(['12|125|', '12|126|', '12|127|'])
  const rand = (cod, rezultat, data = '2026-10-28') => ({ cod_raw: cod, rezultat, data_inspectie: data })
  const arhivaPM = [
    randArhivaPentruStare({ tronson_nr: 12, nr: 125, sufix: '', refacuta: false, rezultat: 'acceptat', data_inspectie: '2026-10-20' }, { id: 7, metoda: 'PM', numar: '88', data_buletin: '2026-10-21', stare: 'confirmat', fisier_path: 'p' }),
    randArhivaPentruStare({ tronson_nr: 12, nr: 130, sufix: '', refacuta: false, rezultat: 'acceptat', data_inspectie: '2026-10-20' }, { id: 7, metoda: 'PM', numar: '88', data_buletin: '2026-10-21', stare: 'confirmat', fisier_path: 'p' }),
  ]

  it('buletin curat: doar informațiile despre comparație și totalul necunoscut', () => {
    const v = calculeazaVerificari({ randuri: [rand('T12S125', 'acceptat')], buletin, tronsonCod: 'T12', coduriPachete: pachete, eliminate: [], arhiva: arhivaPM })
    expect(v.rezumat.atentie).toBe(0)
    expect(coduri(v.probleme)).toEqual(['numar_randuri_necunoscut', 'alta_metoda_fara_aceasta'])
    expect(v.probleme[1].mesaj).toMatch(/1 suduri au buletin PM, dar nu PA-UT: T12S130/)
  })

  it('1. numărul de rânduri față de totalul tipărit', () => {
    const v = calculeazaVerificari({ randuri: [rand('T12S125', 'acceptat')], citire: { antet: { nr_randuri_tiparit: 3 } }, buletin, tronsonCod: 'T12', coduriPachete: pachete, eliminate: [], arhiva: [] })
    expect(v.probleme.find(p => p.cod === 'numar_randuri').mesaj).toMatch(/3 rânduri.*sunt 1/)
  })

  it('2. respinsă fără R acceptat → semnalată; cu R acceptat mai nou → nu', () => {
    const fara = calculeazaVerificari({ randuri: [rand('T12S126', 'respins')], buletin, tronsonCod: 'T12', coduriPachete: pachete, eliminate: [], arhiva: [] })
    expect(fara.peRand[0].map(p => p.cod)).toContain('respins_fara_refacere')
    const cu = calculeazaVerificari({ randuri: [rand('T12S126', 'respins', '2026-10-27'), rand('T12S126R', 'acceptat', '2026-10-28')], buletin, tronsonCod: 'T12', coduriPachete: pachete, eliminate: [], arhiva: [] })
    expect(coduri(cu.probleme)).not.toContain('respins_fara_refacere')
  })

  it('2b. refacerea acceptată dintr-un buletin confirmat anterior acoperă respinsul (arhiva aceleiași metode)', () => {
    const arh = [randArhivaPentruStare({ tronson_nr: 12, nr: 126, sufix: '', refacuta: true, rezultat: 'acceptat', data_inspectie: '2026-11-02' },
      { id: 8, metoda: 'PA-UT', numar: '410', data_buletin: '2026-11-03', stare: 'confirmat', fisier_path: 'p' })]
    const v = calculeazaVerificari({ randuri: [rand('T12S126', 'respins', '2026-10-27')], buletin, tronsonCod: 'T12', coduriPachete: pachete, eliminate: [], arhiva: arh })
    expect(coduri(v.probleme)).not.toContain('respins_fara_refacere')
  })

  it('3. comparația cu cealaltă metodă: sudura din buletin fără PM e marcată pe rând', () => {
    const v = calculeazaVerificari({ randuri: [rand('T12S125', 'acceptat'), rand('T12S127', 'acceptat')], buletin, tronsonCod: 'T12', coduriPachete: pachete, eliminate: [], arhiva: arhivaPM })
    expect(v.peRand[1].map(p => p.cod)).toEqual(['fara_alta_metoda'])
    expect(v.peRand[0]).toBeUndefined()
  })
  it('3b. fără buletine PM pe tronson: informație, nu listă de diferențe; metodă fără pereche: n/a', () => {
    const v = calculeazaVerificari({ randuri: [rand('T12S125', 'acceptat')], buletin, tronsonCod: 'T12', coduriPachete: pachete, eliminate: [], arhiva: [] })
    expect(coduri(v.probleme)).toContain('comparatie_fara_alta')
    const ut = calculeazaVerificari({ randuri: [rand('T12S125', 'acceptat')], buletin: { ...buletin, metoda: 'UT' }, tronsonCod: 'T12', coduriPachete: pachete, eliminate: [], arhiva: [] })
    expect(coduri(ut.probleme)).toContain('comparatie_na')
  })

  it('4. coduri nenormalizabile, din alt tronson, lipsă din pachete, dublate, eliminate', () => {
    const v = calculeazaVerificari({
      randuri: [rand('T12S88?1', 'acceptat'), rand('GAZPET TR13 S5', 'acceptat'), rand('T12S999', 'acceptat'), rand('T12S125', 'acceptat'), rand('TR 12 S 125', 'acceptat'), rand('T12S127', 'acceptat')],
      buletin, tronsonCod: 'T12', coduriPachete: pachete, eliminate: ['T12S127'], arhiva: [],
    })
    expect(v.peRand[0].map(p => p.cod)).toEqual(['cod_nepotrivit'])
    expect(v.peRand[1][0].mesaj).toMatch(/alt_tronson/)
    expect(v.peRand[2].map(p => p.cod)).toEqual(['cod_lipsa_pachet'])
    expect(v.peRand[3]).toBeUndefined()
    expect(v.peRand[4].map(p => p.cod)).toEqual(['cod_dublat'])
    expect(v.peRand[5].map(p => p.cod)).toEqual(['sudura_eliminata'])
  })

  it('5. citire parțială, pagini necitite, valori incerte; antetul diferit de ce s-a înregistrat', () => {
    const citire = { antet: { numar: '404', data: '2026-10-29', metoda: 'PM', tronson: 'TR13' }, partial: true, pagini_necitite: [2, 3], incerte: [{}] }
    const v = calculeazaVerificari({ randuri: [rand('T12S125', 'acceptat')], citire, buletin, tronsonCod: 'T12', coduriPachete: pachete, eliminate: [], arhiva: [] })
    expect(coduri(v.probleme)).toEqual(expect.arrayContaining(['citire_partiala', 'pagini_necitite', 'valori_incerte', 'antet_numar', 'antet_data', 'antet_metoda', 'antet_tronson']))
    const acelasi = calculeazaVerificari({ randuri: [rand('T12S125', 'acceptat')], citire: { antet: { numar: ' 403', data: '28.10.2026', metoda: 'pa ut', tronson: 'TR 12' } }, buletin, tronsonCod: 'T12', coduriPachete: pachete, eliminate: [], arhiva: [] })
    expect(coduri(acelasi.probleme).filter(c => c.startsWith('antet_'))).toEqual([])
  })

  it('L18: surse necitite (pachete / eliminate / arhivă) = avertisment explicit, nu „nicio problemă”', () => {
    const v = calculeazaVerificari({ randuri: [rand('T12S999', 'acceptat')], buletin, tronsonCod: 'T12', coduriPachete: null, eliminate: null, arhiva: null })
    expect(coduri(v.probleme)).toEqual(expect.arrayContaining(['pachete_necitite', 'eliminate_necitite', 'arhiva_necitita']))
    expect(coduri(v.probleme)).not.toContain('cod_lipsa_pachet')
  })

  it('data de inspecție lipsă e semnalată (ordinea R3 nu se poate stabili)', () => {
    const v = calculeazaVerificari({ randuri: [rand('T12S125', 'acceptat', '')], buletin, tronsonCod: 'T12', coduriPachete: pachete, eliminate: [], arhiva: [] })
    expect(v.peRand[0].map(p => p.cod)).toContain('data_inspectie_lipsa')
  })
})

describe('randArhivaPentruStare / coduriDinPachete / filtre / eliminare', () => {
  it('rândul nepotrivit din BD nu primește cheie (ajunge în ignorate, nu dispare)', () => {
    const r = randArhivaPentruStare({ tronson_nr: null, nr: null, sufix: '', refacuta: false, rezultat: 'acceptat' }, { id: 1, metoda: 'PM', numar: '1', data_buletin: '2026-10-01', stare: 'confirmat' })
    expect(r.tronson).toBeNull()
    expect(r.cheie).toBeUndefined()
  })
  it('coduriDinPachete: separatoarele și golurile sar, codurile nerecunoscute se numără', () => {
    const { chei, nerecunoscute } = coduriDinPachete([
      { tip_rand: 'teava', sudura_cod: 'T12S1' }, { tip_rand: 'separator', sudura_cod: 'T12S2' }, { tip_rand: 'teava', sudura_cod: '' },
      { tip_rand: 'curba', sudura_cod: 'T12S3R' }, { tip_rand: 'teava', sudura_cod: '-' },
    ], 'T12')
    expect([...chei].sort()).toEqual(['12|1|', '12|3|'])
    expect(nerecunoscute).toBe(1)
  })
  it('filtreazaBuletine: metodă + stare, data desc apoi id desc', () => {
    const l = [{ id: 1, metoda: 'PM', stare: 'confirmat', data_buletin: '2026-10-01' }, { id: 2, metoda: 'PM', stare: 'anulat', data_buletin: '2026-10-05' },
      { id: 3, metoda: 'PA-UT', stare: 'confirmat', data_buletin: '2026-10-05' }, { id: 4, metoda: 'PM', stare: 'confirmat', data_buletin: '2026-10-05' }]
    expect(filtreazaBuletine(l).map(b => b.id)).toEqual([4, 3, 2, 1])
    expect(filtreazaBuletine(l, { metoda: 'PM', stare: 'confirmat' }).map(b => b.id)).toEqual([4, 1])
  })
  it('valideazaEliminare: fără R, motiv, sudurile noi valide', () => {
    expect(valideazaEliminare({ cod: 'T12S126R', motiv: 'cupon' }, 'T12').erori.cod).toMatch(/fără „R”/)
    expect(valideazaEliminare({ cod: 'T12S126', motiv: 'c' }, 'T12').erori.motiv).toBeTruthy()
    expect(valideazaEliminare({ cod: 'T12S126', motiv: 'cupon', inlocuitaDe: 'T12S126A, T12S?' }, 'T12').erori.inlocuitaDe).toMatch(/T12S\?/)
    const ok = valideazaEliminare({ cod: 'GAZPET TR12 S126', motiv: 'tăiată, cupon', inlocuitaDe: 'T12S126A T12S126B' }, 'T12')
    expect(ok.ok).toBe(true)
    expect(ok.valori).toEqual({ cod: 'T12S126', motiv: 'tăiată, cupon', inlocuitaDe: ['T12S126A', 'T12S126B'] })
  })
})

describe('randuriDinCitire', () => {
  it('păstrează valorile, null → gol, fiecare rând cu id local unic', () => {
    const r = randuriDinCitire({ randuri: [{ cod_raw: 'T12S1', rezultat: 'ACCEPTED', start_mm: 0, observatii: null }, { cod_raw: 'T12S2' }] })
    expect(r[0]).toMatchObject({ cod_raw: 'T12S1', rezultat: 'ACCEPTED', start_mm: 0, observatii: '' })
    expect(r[0]._id).not.toBe(r[1]._id)
  })
})

// ── runda 2 (Jakarinos #1218 r1) ─────────────────────────────────────────
describe('parseazaLipire — antet recunoscut explicit, nimic pierdut (r1 P1 :257)', () => {
  it('„ILIZIBIL<TAB>respins” pe prima linie rămâne rând, marcat de verificat (codul vechi îl sărea ca antet)', () => {
    const r = parseazaLipire('ILIZIBIL\trespins\t28.10.2026\nT12S125\tacceptat\t28.10.2026')
    expect(r.antetSarit).toBe(false)
    expect(r.erori).toEqual([])
    expect(r.randuri.map(x => [x.cod_raw, x.rezultat])).toEqual([['ILIZIBIL', 'respins'], ['T12S125', 'acceptat']])
    expect(r.randuri[0]._verifica).toMatch(/fără nicio cifră/)
    expect(r.randuri[1]._verifica).toBeUndefined()
    expect(r.deVerificat).toBe(1)
  })
  it.each([
    ['Cod sudură\tRezultat', true], ['COD SUDURA\tREZULTAT\tDATA', true], ['Nr. sudură\tRezultat examinare', true], ['Weld No.\tResult', true],
    ['Sudura', true], ['cod\t\tdata', true],
    ['Sudura\trespins', false], ['ILIZIBIL\trespins', false], ['Observatii\tacceptat', false], ['nr crt\trezultat', false], ['T12S1\tRezultat', false],
  ])('esteAntetLipire pe „%s” → %s (prima linie)', (linie, antet) => {
    const r = parseazaLipire(`${linie}\nT12S125\tacceptat`)
    expect(r.antetSarit).toBe(antet)
    expect(r.randuri.length).toBe(antet ? 1 : 2)
  })
  it('antetul se sare doar pe prima linie cu date; un rând fără cifre mai jos rămâne și e marcat', () => {
    const r = parseazaLipire('T12S125\tacceptat\nCod sudură\tRezultat')
    expect(r.antetSarit).toBe(false)
    expect(r.randuri.map(x => x.cod_raw)).toEqual(['T12S125', 'Cod sudură'])
    expect(r.randuri[1]._verifica).toBeTruthy()
  })
  it('rândul marcat dă avertisment pe rândul lui în verificări (nu trece tăcut la confirmare)', () => {
    const r = parseazaLipire('ILIZIBIL\trespins\t28.10.2026\nT12S125\tacceptat\t28.10.2026')
    const v = calculeazaVerificari({ randuri: r.randuri, buletin: { id: 1, metoda: 'PM', numar: '1', data_buletin: '2026-10-28' }, tronsonCod: 'T12', coduriPachete: new Set(['12|125|']), eliminate: [], arhiva: [] })
    expect(v.peRand[0].map(p => p.cod)).toContain('rand_de_verificat')
    expect(v.peRand[1]?.some(p => p.cod === 'rand_de_verificat')).toBeFalsy()
  })
})

describe('combinaSemnaleCitiri — semnalele ambelor citiri rămân după „Aplică” (r1 P1 :544)', () => {
  const buletin = { id: 1, metoda: 'PA-UT', numar: '401', data_buletin: '2026-10-28' }
  const A = { antet: { numar: '401', data: '2026-10-28', nr_randuri_tiparit: 2 }, randuri: [], incerte: [], partial: false, pagini_necitite: [], model: 'm1' }
  const B = { antet: { numar: '410', data: '2026-10-28', nr_randuri_tiparit: 3 }, randuri: [], incerte: ['T12S126.rezultat'], partial: true, pagini_necitite: [3, 2], model: 'm2' }
  const coduriV = c => calculeazaVerificari({ randuri: [{ cod_raw: 'T12S125', rezultat: 'acceptat', data_inspectie: '2026-10-28' }, { cod_raw: 'T12S126', rezultat: 'acceptat', data_inspectie: '2026-10-28' }],
    citire: c, buletin, tronsonCod: 'T12', coduriPachete: new Set(['12|125|', '12|126|']), eliminate: [], arhiva: [] }).probleme.map(p => p.cod)
  it('a doua citire parțială / cu pagini necitite / incerte / alt total / alt număr: toate avertismentele rămân', () => {
    const c = combinaSemnaleCitiri(A, B)
    expect(c.partial).toBe(true)
    expect(c.pagini_necitite).toEqual([2, 3])
    expect(c.incerte).toEqual([{ citire: 'a doua', valoare: 'T12S126.rezultat' }])
    expect(c.tiparit_diferit).toEqual([2, 3])
    expect(c.antet.nr_randuri_tiparit).toBeNull()
    const v = coduriV(c)
    for (const k of ['citire_partiala', 'pagini_necitite', 'valori_incerte', 'numar_randuri_diferit', 'antet_numar']) expect(v).toContain(k)
    // doar prima citire (ce rămânea în cod înainte) = zero avertismente: dovada că fără combinare se pierd
    expect(coduriV(A).filter(k => ['citire_partiala', 'pagini_necitite', 'valori_incerte', 'numar_randuri_diferit', 'antet_numar'].includes(k))).toEqual([])
  })
  it('semnalele primei citiri se păstrează și ele; totalul comun rămâne cunoscut', () => {
    const c = combinaSemnaleCitiri({ ...A, partial: true, pagini_necitite: [4], incerte: ['x'] }, { ...A, antet: { ...A.antet } })
    expect(c.partial).toBe(true)
    expect(c.partial_din).toEqual(['prima'])
    expect(c.pagini_necitite).toEqual([4])
    expect(c.incerte).toEqual([{ citire: 'prima', valoare: 'x' }])
    expect(c.antet.nr_randuri_tiparit).toBe(2)
    expect(c.tiparit_diferit).toBeNull()
  })
  it('fără a doua citire = prima neschimbată', () => {
    expect(combinaSemnaleCitiri(A, null)).toBe(A)
    expect(combinaSemnaleCitiri(null, null)).toBeNull()
  })
})
