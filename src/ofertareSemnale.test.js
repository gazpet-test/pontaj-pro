// TKT-2026-0329 A, PR-UI Task 8: helperii puri ai ecranului semnalelor (verdict, dovezi, grupare, actualitate, erori, răspuns relevant).
// Așteptatul vine din spec / migrarea 20270112a (textele motivelor, codurile verificărilor), nu din codul testat (L25).
import { describe, it, expect } from 'vitest'
import { eticheta, CULORI, descriereDovada, grupeazaPeMasura, etichetaActualitate, poateStergeCiorna, mesajEroareClarificare,
  textDiferenteSemnal, propuneRaspunsRelevant, textRezumatSemnale, eroareSetari, documenteNecitite, SHA256_TEXT_GOL, dnElement } from './ofertareSemnale.js'

describe('eticheta verdictului (spec §3.3: patru verdicte, restul = stare necunoscută, L18)', () => {
  it('cele patru verdicte au culoare și text distinct, cu motivul unde există', () => {
    expect(eticheta('in_regula', null)).toEqual({ text: '✓ în regulă', culoare: CULORI.verde })
    expect(eticheta('diferenta', 'A 6.400 m, B 3.995 m (37,6 % > 5 %)')).toEqual({ text: '⚠ diferență: A 6.400 m, B 3.995 m (37,6 % > 5 %)', culoare: CULORI.rosu })
    expect(eticheta('de_verificat', 'lot necunoscut')).toEqual({ text: '? de verificat: lot necunoscut', culoare: CULORI.portocaliu })
    expect(eticheta('neverificat', 'document necitit (ATR.pdf)')).toEqual({ text: '∅ neverificat: document necitit (ATR.pdf)', culoare: CULORI.gri })
  })
  it('motiv lipsă la de_verificat / neverificat nu dă „: undefined”', () => {
    expect(eticheta('neverificat', null).text).toBe('∅ neverificat')
    expect(eticheta('de_verificat', '').text).toBe('? de verificat')
  })
  it('orice altă valoare (null, text străin, obiect) = stare necunoscută, gri — nu verde', () => {
    for (const v of [null, undefined, '', 'ok', 'IN_REGULA', 42, {}]) {
      expect(eticheta(v, 'x')).toEqual({ text: 'stare necunoscută', culoare: CULORI.gri })
    }
  })
})

describe('etichetaActualitate (decizia 8: sursele schimbate = rezultat istoric, imediat)', () => {
  it('in_curs are prioritate și spune că se reevaluează', () => {
    expect(etichetaActualitate({ in_curs: true, actual: true })).toEqual({ text: '⏳ se reevaluează', culoare: CULORI.portocaliu })
    expect(etichetaActualitate({ in_curs: true, actual: false }).text).toBe('⏳ se reevaluează')
  })
  it('actual = false → rezultat istoric, gri', () => {
    expect(etichetaActualitate({ in_curs: false, actual: false })).toEqual({ text: 'rezultat istoric — sursele s-au schimbat, nereverificat', culoare: CULORI.gri })
  })
  it('actual necunoscut (null / lipsă) NU e tratat ca actual (L18)', () => {
    expect(etichetaActualitate({ in_curs: false, actual: null })?.text).toBe('rezultat istoric — sursele s-au schimbat, nereverificat')
    expect(etichetaActualitate({})?.text).toBe('rezultat istoric — sursele s-au schimbat, nereverificat')
  })
  it('actual și fără reevaluare → null (nimic de afișat)', () => {
    expect(etichetaActualitate({ in_curs: false, actual: true })).toBe(null)
  })
})

describe('descriereDovada (spec §3.2: dovada are document, pagină, rând / fragment, coloană, valoare, UM)', () => {
  it('tabel: document, pagina, rândul, coloana, valoarea cu UM', () => {
    const m = { verificare: 'ok', fel_dovada: 'tabel', document_id: 7, document_nume: 'F3.pdf', pagina: 12, rand: '14 | Țeavă PE100 DN160 | m | 6.400', celula: '6.400',
      antet_coloana: 'Cantitate', valoare_text: '6.400', um_text: 'm' }
    expect(descriereDovada(m)).toBe('F3.pdf p.12, rândul „14 | Țeavă PE100 DN160 | m | 6.400”, coloana „Cantitate” → 6.400 m')
  })
  it('text liber: fragmentul în loc de rând și coloană', () => {
    const m = { verificare: 'ok', fel_dovada: 'text', document_id: 9, document_nume: 'ATR.pdf', pagina: 3, fragment: 'în lungime totală de 3.995 m', valoare_text: '3.995', um_text: 'm' }
    expect(descriereDovada(m)).toBe('ATR.pdf p.3, fragment „în lungime totală de 3.995 m” → 3.995 m')
  })
  it('fără numele documentului → #id; fără UM text → doar valoarea', () => {
    expect(descriereDovada({ verificare: 'ok', fel_dovada: 'text', document_id: 9, pagina: 3, fragment: 'L = 250 m', valoare_text: '250', um_text: null })).toBe('#9 p.3, fragment „L = 250 m” → 250')
  })
  it('nedovedit → „fără dovadă” cu motivul în cuvinte și documentul', () => {
    expect(descriereDovada({ verificare: 'nedovedit', document_id: 7, document_nume: 'F3.pdf' })).toBe('fără dovadă: rândul nu a fost găsit în document (F3.pdf)')
  })
  it('fara_sursa → poziție fără document-sursă', () => {
    expect(descriereDovada({ verificare: 'fara_sursa', document_id: null })).toBe('fără dovadă: poziție fără document-sursă')
  })
  it('toate codurile de verificare din CHECK-ul tabelului au text; un cod străin rămâne vizibil, nu dispare', () => {
    const coduri = ['nedovedit', 'fara_sursa', 'neclasificat', 'lot_necunoscut', 'neatribuibil', 'pagina_nepermisa', 'fragment_lipsa', 'fragment_ambiguu', 'rand_lipsa', 'rand_ambiguu',
      'antet_lipsa', 'coloana_necunoscuta', 'um_lipsa', 'tipar_necunoscut', 'numar_ambiguu', 'numar_neintreg', 'diametru_nu_cantitate', 'unitate_incompatibila']
    for (const c of coduri) { const t = descriereDovada({ verificare: c }); expect(t, c).toMatch(/^fără dovadă: /); expect(t, c).not.toContain(c) }
    expect(descriereDovada({ verificare: 'cod_nou_din_viitor' })).toBe('fără dovadă: cod_nou_din_viitor')
    expect(descriereDovada(null)).toBe('fără dovadă: măsurătoare lipsă')
  })
})

const rand = (id, verdict, extra = {}) => ({ semnal: { id, verdict, ...extra }, rezolvat: false, actual: true, in_curs: false, masuratori: [] })
describe('grupeazaPeMasura (rândurile fn_ofertare_semnale_lista → o intrare pe măsură, în ordinea gravității)', () => {
  it('ordinea: diferenta, de_verificat, neverificat, in_regula, apoi necunoscute; în grup după id', () => {
    const r = [rand(5, 'in_regula'), rand(2, 'neverificat'), rand(9, 'diferenta'), rand(1, 'de_verificat'), rand(3, 'diferenta'), rand(4, null), rand(8, 'in_regula')]
    expect(grupeazaPeMasura(r).map(g => g.semnal.id)).toEqual([3, 9, 1, 2, 5, 8, 4])
  })
  it('măsurătorile se despart pe părți și păstrează rezolvat / actual / in_curs', () => {
    const r = { semnal: { id: 1, verdict: 'diferenta' }, rezolvat: false, actual: false, in_curs: true,
      masuratori: [{ id: 11, parte: 'a', verificare: 'ok' }, { id: 12, parte: 'b', verificare: 'ok' }, { id: 13, parte: 'a', verificare: 'nedovedit' }, { id: 14, parte: 'x' }] }
    const [g] = grupeazaPeMasura([r])
    expect(g.a.map(m => m.id)).toEqual([11, 13]); expect(g.b.map(m => m.id)).toEqual([12])
    expect(g).toMatchObject({ rezolvat: false, actual: false, in_curs: true })
  })
  it('intrare fără semnal, listă null sau măsurători ne-listă: nimic nu cade', () => {
    expect(grupeazaPeMasura(null)).toEqual([])
    expect(grupeazaPeMasura([{ semnal: null }, { semnal: { id: 1, verdict: 'in_regula' }, masuratori: 'x' }]).map(g => g.semnal.id)).toEqual([1])
  })
  it('același semnal venit de două ori (paginare pe range care s-a mișcat) rămâne o singură dată', () => {
    expect(grupeazaPeMasura([rand(1, 'in_regula'), rand(1, 'in_regula')]).length).toBe(1)
  })
})

describe('poateStergeCiorna (inventar #11: ciornele automate nu se șterg din client)', () => {
  it('auto_surse_x și auto_planse_1 nu se pot șterge; manual și fără cheie da', () => {
    expect(poateStergeCiorna({ cheie: 'auto_surse_0123456789abcdef' })).toBe(false)
    expect(poateStergeCiorna({ cheie: 'auto_planse_1' })).toBe(false)
    expect(poateStergeCiorna({ cheie: null, origine: 'manual' })).toBe(true)
    expect(poateStergeCiorna({ cheie: 'auto_sursex' })).toBe(true)
    expect(poateStergeCiorna({})).toBe(true)
  })
})

describe('mesajEroareClarificare (ui_nr_ocupat: 23505 = reîncearcă; CM_* = textul după cod)', () => {
  it('23505 → mesajul de reîncercare, indiferent de textul brut', () => {
    expect(mesajEroareClarificare({ code: '23505', message: 'duplicate key value violates unique constraint "ofertare_clarificari_licitatie_nr_key"' })).toBe('Numărul întrebării e deja luat — reîncearcă.')
    expect(mesajEroareClarificare({ message: 'duplicate key value violates unique constraint "x"' })).toBe('Numărul întrebării e deja luat — reîncearcă.')
  })
  it('CM_<COD>: text → doar textul', () => {
    expect(mesajEroareClarificare({ code: 'P0001', message: 'CM_SEMNAL: semnal inexistent' })).toBe('semnal inexistent')
    expect(mesajEroareClarificare({ code: '42501', message: 'CM_FARA_DREPT: legarea raspunsului cere drept de decizie pe licitatie' })).toBe('legarea raspunsului cere drept de decizie pe licitatie')
  })
  it('altceva → mesajul brut; lipsă → text generic', () => {
    expect(mesajEroareClarificare({ message: 'permission denied' })).toBe('permission denied')
    expect(mesajEroareClarificare(null)).toBe('eroare necunoscută')
    expect(mesajEroareClarificare('text')).toBe('text')
  })
})

describe('textDiferenteSemnal (detaliile view-ului pentru auto_surse_*: verdict / a / b / prag, vechi → acum)', () => {
  const det = (diferente) => ({ evaluare: 'surse_v1', diferente })
  it('pragul schimbat → o linie cu procente', () => {
    expect(textDiferenteSemnal(det({ verdict: { vechi: 'diferenta', acum: 'diferenta' }, a: { vechi: 6400, acum: 6400 }, b: { vechi: 3995, acum: 3995 }, prag: { vechi: 0.05, acum: 0.1 } })))
      .toEqual(['prag 5 % → 10 %'])
  })
  it('valorile și verdictul schimbate → câte o linie fiecare, cu numere în format românesc', () => {
    expect(textDiferenteSemnal(det({ verdict: { vechi: 'diferenta', acum: 'in_regula' }, a: { vechi: 6400, acum: 3995 }, b: { vechi: 3995, acum: 3995 }, prag: { vechi: 0.05, acum: 0.05 } })))
      .toEqual(['verdict diferență → în regulă', 'A 6.400 → 3.995'])
  })
  it('valoare lipsă (null) e scrisă „—”, nu 0 (L18)', () => {
    expect(textDiferenteSemnal(det({ b: { vechi: 3995, acum: null } }))).toEqual(['B 3.995 → —'])
  })
  it('nimic schimbat → []; alt tip de evaluare sau detalii lipsă → []', () => {
    expect(textDiferenteSemnal(det({ a: { vechi: 1, acum: 1 } }))).toEqual([])
    expect(textDiferenteSemnal({ evaluare: 'planse', diferente: { a: { vechi: 1, acum: 2 } } })).toEqual([])
    expect(textDiferenteSemnal(null)).toEqual([])
  })
})

describe('propuneRaspunsRelevant (spec §3.6: potrivire textuală pe măsură; omul confirmă; niciodată auto-legare)', () => {
  const s = (id, element, obiect_cheie, extra = {}) => ({ semnal: { id, element, obiect_cheie, verdict: 'diferenta', valoare_a: 6400, valoare_b: 3995 }, rezolvat: false, ...extra })
  const text = '⟦PAGINA 1⟧ Răspuns la întrebarea 3: pentru conducta PE100 DN 160 de pe Tronsonul 2, lungimea corectă este 3.995 m.'
  it('element (DN) + obiect prezente → propus, cu motivul', () => {
    const p = propuneRaspunsRelevant([s(1, 'teava_pe_dn160', 'tronsonul 2')], text)
    expect(p).toEqual([{ semnal_id: 1, motiv: 'DN 160 și obiectul „tronsonul 2” apar în răspuns' }])
  })
  it('obiect „*” = orice obiect: ajunge elementul', () => {
    expect(propuneRaspunsRelevant([s(2, 'teava_pe_dn160', '*')], text).map(p => p.semnal_id)).toEqual([2])
  })
  it('DN-ul se recunoaște ca „DN 160”, „Dn160”, „Ø160”, dar nu ca parte din alt număr', () => {
    for (const t of ['conducta Dn160 pe tronson', 'conductă Ø160', 'teava DN 160 mm']) expect(propuneRaspunsRelevant([s(3, 'teava_dn160', '*')], t).length, t).toBe(1)
    for (const t of ['DN 1600 pe tronson', 'DN1160', 'lungime 160 m fara DN']) expect(propuneRaspunsRelevant([s(3, 'teava_dn160', '*')], t).length, t).toBe(0)
  })
  it('elementele fără DN se potrivesc pe familia lor; „necunoscut” nu se propune niciodată', () => {
    expect(propuneRaspunsRelevant([s(4, 'bransament', '*')], 'numărul branșamentelor rămâne 12 buc').length).toBe(1)
    expect(propuneRaspunsRelevant([s(5, 'sapatura', '*')], 'săpătura mecanizată 500 mc').length).toBe(1)
    expect(propuneRaspunsRelevant([s(6, 'necunoscut', '*')], 'orice text cu DN 160').length).toBe(0)
  })
  it('textul pomenește doar rândul / obiectul, fără element → [] (spec §5.2: rămâne „posibil relevant” doar cu element)', () => {
    expect(propuneRaspunsRelevant([s(7, 'teava_pe_dn160', 'tronsonul 2')], 'Pe Tronsonul 2 lungimea rămâne 6.400 m.')).toEqual([])
  })
  it('element prezent dar alt obiect → []', () => {
    expect(propuneRaspunsRelevant([s(8, 'teava_pe_dn160', 'tronsonul 5')], text)).toEqual([])
  })
  it('textExtras null / gol / doar spații → [] (document necitit, nimic de propus)', () => {
    for (const t of [null, undefined, '', '   ']) expect(propuneRaspunsRelevant([s(9, 'teava_pe_dn160', '*')], t)).toEqual([])
  })
  it('semnalul deja rezolvat nu se propune; lista null → []', () => {
    expect(propuneRaspunsRelevant([s(10, 'teava_pe_dn160', '*', { rezolvat: true })], text)).toEqual([])
    expect(propuneRaspunsRelevant(null, text)).toEqual([])
  })
  it('dnElement citește DN-ul din codul elementului', () => {
    expect(dnElement('teava_pe_dn160')).toBe(160); expect(dnElement('robinet_dn63')).toBe(63); expect(dnElement('bransament')).toBe(null); expect(dnElement(null)).toBe(null)
  })
})

describe('textRezumatSemnale (linia din raportul rulării, Task 9)', () => {
  it('rezumatul edge-ului → „Semnale: N diferențe, M de verificat, K neverificate”', () => {
    expect(textRezumatSemnale({ ok: true, rezumat: { diferente: 2, de_verificat: 1, neverificate: 3, in_regula: 5, altele: 0, total: 11 } }))
      .toBe('Semnale: 2 diferențe, 1 de verificat, 3 neverificate (5 în regulă, 11 în total)')
  })
  it('comparația eșuată → eroarea, nu „0 diferențe” (L18)', () => {
    expect(textRezumatSemnale({ ok: false, eroare: 'fotografie: CM_LICITATIE' })).toBe('Semnale: comparația nu a rulat — fotografie: CM_LICITATIE')
    expect(textRezumatSemnale({ ok: false, eroare: 'propune: depasita', evaluare_depasita: true })).toBe('Semnale: comparația nu a rulat — propune: depasita (sursele s-au schimbat în timpul rulării)')
    expect(textRezumatSemnale(null)).toBe(null)
    expect(textRezumatSemnale({ ok: true })).toBe('Semnale: rezumat lipsă din răspuns')
  })
})

describe('eroareSetari (aceleași limite ca CHECK-urile ofertare_cantitati_setari: prag 0,1–50 %, plafon 10–2000 pagini)', () => {
  it('acceptă valorile din interval, cu virgulă sau punct', () => {
    for (const [p, pl] of [['5', '200'], ['0,1', '10'], ['50', '2000'], ['7.5', '150']]) expect(eroareSetari(p, pl), `${p}/${pl}`).toBe(null)
  })
  it('refuză în afara intervalului, text, gol', () => {
    for (const [p, pl] of [['0', '200'], ['0.05', '200'], ['51', '200'], ['5', '9'], ['5', '2001'], ['abc', '200'], ['5', ''], ['', '200'], ['5', '10.5']]) expect(eroareSetari(p, pl), `${p}/${pl}`).not.toBe(null)
  })
})

describe('documenteNecitite (din inventarul semnalelor: id-urile documentelor necitite, o singură dată, cu numele)', () => {
  it('reunește listele din toate semnalele, ordonat pe id, cu numele din lista documentelor și sha-ul textului gol pentru cele fără text', () => {
    const r = [rand(1, 'neverificat', { inventar: { documente_necitite: [12, 7] } }), rand(2, 'neverificat', { inventar: { documente_necitite: [7] } }), rand(3, 'in_regula', { inventar: {} })]
    const docs = [{ id: 7, nume_original: 'ATR lot 2.pdf', text_extras: null }, { id: 12, nume_original: 'Memoriu.pdf', text_extras: 'text' }]
    expect(documenteNecitite(r, docs)).toEqual([
      { id: 7, nume: 'ATR lot 2.pdf', fara_text: true },
      { id: 12, nume: 'Memoriu.pdf', fara_text: false },
    ])
    expect(documenteNecitite(r, [])).toEqual([{ id: 7, nume: '#7', fara_text: null }, { id: 12, nume: '#12', fara_text: null }])
  })
  it('sha-ul textului gol e cel al șirului vid (doc fără text → decizia „nu e sursă cantitativă” pe acest sha)', () => {
    expect(SHA256_TEXT_GOL).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })
})
