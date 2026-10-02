import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { estDovadaVerificataPT, clasificaDoveziPT, inchisaCuDovadaPT,
  citesteSursePT, citesteDatePT, creeazaGardaIncarcarePT } from './ofertarePropunereDate.js'
import { MatriceCerinte } from './OfertarePropunere.jsx'
import { evalueazaPoarta } from './ofertarePoarta.js'

vi.mock('./lib/supabase.js', () => ({ supabase: {} }))

const acoperire = patch => ({ cerinta_id: 1, status: 'acoperit', verificat_pe_scan: true, reverificare_ceruta: false, ...patch })
const cerinte = [{ id: 1, tip: 'propunere', text_cerinta: 'Cerința PT93' }]
const matrice = (dovezi, props = {}) => renderToStaticMarkup(<MatriceCerinte licId={93}
  cerinte={cerinte} legaturi={[]} capitole={[]} {...clasificaDoveziPT(dovezi)}
  sel={new Set()} profiluri={new Map()} filtru="" {...props} />)

describe('QW0 — dovadă R06 și matrice', () => {
  it.each([
    [{}, true],
    [{ verificat_pe_scan: false }, false],
    [{ verificat_pe_scan: null }, false],
    [{ verificat_pe_scan: undefined }, false],
    [{ reverificare_ceruta: true }, false],
    [{ reverificare_ceruta: null }, true],
    [{ reverificare_ceruta: undefined }, true],
    [{ status: 'neacoperit' }, false],
    [{ status: 'acoperit_partener' }, true],
  ])('predicat %j → %s', (patch, rezultat) => {
    expect(estDovadaVerificataPT(acoperire(patch))).toBe(rezultat)
  })

  it('păstrează paritatea cu expresia SQL R06 pe toate combinațiile status/scan/reverificare', () => {
    const sql = readFileSync(new URL('../supabase/migrations/20260928g_ofertare_pt_stare_r06_r09.sql', import.meta.url), 'utf8')
    expect(sql).toContain("a.status = ANY (ARRAY['acoperit'::text, 'acoperit_partener'::text])")
    expect(sql).toContain('AND a.verificat_pe_scan AND NOT COALESCE(a.reverificare_ceruta, false)')
    for (const status of ['acoperit', 'acoperit_partener', 'neacoperit', null]) {
      for (const scan of [true, false, null]) for (const rev of [true, false, null]) {
        const r06 = ['acoperit', 'acoperit_partener'].includes(status) && scan === true && !(rev ?? false)
        expect(estDovadaVerificataPT(acoperire({ status, verificat_pe_scan: scan, reverificare_ceruta: rev }))).toBe(r06)
      }
    }
  })

  it('PT93: acoperit fără scan ⇒ filtru și contor 0, badge portocaliu distinct', () => {
    const dovezi = [acoperire({ verificat_pe_scan: false })]
    const { dovedite } = clasificaDoveziPT(dovezi)
    expect(cerinte.filter(c => inchisaCuDovadaPT(c.id, [], dovedite))).toHaveLength(0)
    expect(matrice(dovezi, { filtru: 'dovada' })).toContain('0 cerințe')
    const html = matrice(dovezi)
    expect(html).toContain('color:#F0883E">dovadă propusă — neverificată pe scan')
    expect(html).not.toContain('✓ dovadă în registru')
  })

  it('scan valid ⇒ un singur rând închis, fără dublare din acoperiri multiple', () => {
    const dovezi = [acoperire({ verificat_pe_scan: false }), acoperire({}), acoperire({ status: 'acoperit_partener' })]
    expect(clasificaDoveziPT(dovezi).propuse.size).toBe(0)
    expect(matrice(dovezi, { filtru: 'dovada' })).toContain('1 cerințe')
    expect(matrice(dovezi)).toContain('✓ dovadă în registru')
  })

  it.each(['capitol', 'exceptat'])('legătura %s exclude cerința din contorul închise cu dovadă', fel => {
    expect(matrice([acoperire({})], { filtru: 'dovada', legaturi: [{ cerinta_id: 1, fel }] })).toContain('0 cerințe')
  })

  it('gata include atribuirea blocată, dar eticheta nu pretinde verificarea; constatarea rămâne vizibilă', () => {
    const html = matrice([], { filtru: 'gata', capitole: [{ id: 7, nr: 1 }], legaturi: [
      { cerinta_id: 1, fel: 'capitol', capitol_id: 7, stare: 'blocata', constatare: 'Lipsește proba de presiune' },
    ] })
    expect(html).toContain('atribuite/exceptate')
    expect(html).not.toContain('rezolvate')
    expect(html).toContain('1 cerințe')
    expect(html).toContain('constatare: Lipsește proba de presiune')
  })
})

function mockSupabase(raspunde = () => undefined) {
  const cereri = []
  return { cereri, from(sursa) {
    const q = { sursa, filtre: {}, coloane: null, cumul: false }
    const chain = {
      select(coloane) { q.coloane = coloane; return chain },
      eq(k, v) { q.filtre[k] = v; return chain },
      in(k, v) { q.filtre[k] = v; return chain },
      is() { return chain }, order() { return chain }, limit() { return chain }, maybeSingle() { return chain },
      filter() { q.cumul = true; return chain },
      then(ok, err) {
        cereri.push(q)
        return Promise.resolve().then(() => raspunde(q) ?? { data:
          sursa === 'ofertare_cerinte' ? cerinte : sursa === 'ofertare_pt_capitole' ? [{ id: 7 }]
            : sursa === 'v_ofertare_pt_stare' ? { licitatie_id: q.filtre.licitatie_id } : []
        }).then(ok, err)
      },
    }
    return chain
  } }
}

describe('QW0 — încărcare completă, erori cu sursă', () => {
  const surse = ['v_ofertare_pt_stare', 'ofertare_pt_capitole', 'ofertare_cerinte', 'v_ofertare_pt_conformitate',
    'hr_autorizatii_tipuri', 'hr_autorizatii', 'ofertare_pt_observatii', 'profiles', 'ofertare_documente_atribuire',
    'ofertare_pt_pachet', 'ofertare_pt_garantie', 'ofertare_pt_participanti', 'ofertare_parteneri',
    'ofertare_pt_declaratii', 'ofertare_pt_anexe_asteptate', 'v_ofertare_pt_cerinte_neconfirmate',
    'v_ofertare_seap_completitudine', 'v_ofertare_cantitati_nevalidate', 'ofertare_pt_capitole_versiuni',
    'ofertare_pt_legaturi', 'ofertare_acoperire', 'v_ofertare_pt_echipa', 'v_ofertare_pt_echipa_blocaje']
  it.each(surse)('%s cu eroare nu produce date parțiale sau liste goale', async sursa => {
    const db = mockSupabase(q => q.sursa === sursa ? { data: null, error: { message: 'citire refuzată' } } : undefined)
    await expect(citesteDatePT(db, 93, async () => ({}))).rejects.toThrow(`${sursa}: citire refuzată`)
  })

  it('eroarea regulii de cumul este așteptată și identificată separat', async () => {
    const db = mockSupabase(q => q.cumul ? Promise.reject(new Error('rețea indisponibilă')) : undefined)
    await expect(citesteDatePT(db, 93, async () => ({}))).rejects.toThrow('ofertare_cerinte (regula cumul): rețea indisponibilă')
  })

  it('strânge toate sursele eșuate, inclusiv excepții și promisiuni respinse', async () => {
    await expect(citesteSursePT({
      profiles: () => ({ error: { message: 'refuz' } }),
      ofertare_pt_pachet: () => Promise.reject(new Error('offline')),
    })).rejects.toThrow('profiles: refuz · ofertare_pt_pachet: offline')
  })

  it('eroarea din reverificarea graficului ajunge la încărcarea panoului', async () => {
    const db = mockSupabase(q => q.sursa === 'v_ofertare_pt_stare' ? { data: { grafic_versiune: 1 } } : undefined)
    await expect(citesteDatePT(db, 93, async () => ({ grafic_reverificare_eroare: 'ofertare_cantitati_istoric: refuz' })))
      .rejects.toThrow('ofertare_cantitati_istoric: refuz')
  })

  it('citește constatare și toate câmpurile R06; păstrează datele necesare afișării', async () => {
    const db = mockSupabase(q => q.sursa === 'ofertare_pt_legaturi' ? { data: [{ constatare: 'Lipsește proba' }] }
      : q.sursa === 'ofertare_acoperire' ? { data: [acoperire({ verificat_pe_scan: false })] } : undefined)
    const r = await citesteDatePT(db, 93, async () => ({}))
    expect(db.cereri.find(q => q.sursa === 'ofertare_pt_legaturi').coloane).toContain('constatare')
    // J02b (stareExceptarePT): exceptarea propusă de AI se recunoaște după legaturi.sursa === 'ai' — fără coloană ar arăta ca una umană.
    expect(db.cereri.find(q => q.sursa === 'ofertare_pt_legaturi').coloane.split(',').map(c => c.trim())).toContain('sursa')
    expect(db.cereri.find(q => q.sursa === 'ofertare_acoperire').coloane).toBe('cerinta_id, status, verificat_pe_scan, reverificare_ceruta')
    expect(r.rest.ofertare_pt_legaturi[0].constatare).toBe('Lipsește proba')
    expect(r.dovedite.size).toBe(0)
  })
})

describe('QW0 — răspunsuri întârziate și invalidare', () => {
  it.each([false, true])('licitația anterioară termină ultima (eroare=%s): nu înlocuiește noua stare', async esueaza => {
    let terminaVeche
    const veche = new Promise(resolve => { terminaVeche = resolve })
    const db = mockSupabase(q => q.sursa === 'v_ofertare_pt_stare' && q.filtre.licitatie_id === 93 ? veche : undefined)
    const garda = creeazaGardaIncarcarePT()
    let stare = null, eroare = null
    const load = async id => {
      const token = garda.incepe(id)
      if (token == null) return
      stare = null; eroare = null
      try {
        const r = await citesteDatePT(db, id, async () => ({}))
        if (garda.actual(token)) stare = r.initial.v_ofertare_pt_stare
      } catch (e) { if (garda.actual(token)) eroare = e.message }
    }
    garda.selecteaza(93)
    const prima = load(93)
    garda.selecteaza(94)
    await load(94)
    terminaVeche(esueaza ? { error: { message: 'eroare veche' } } : { data: { licitatie_id: 93 } })
    await prima
    expect(stare.licitatie_id).toBe(94)
    expect(eroare).toBeNull()
  })

  it('A → B → A, reload concurent, handler vechi și demontare invalidează tokenurile', () => {
    const g = creeazaGardaIncarcarePT()
    g.selecteaza(93)
    const a = g.incepe(93)
    g.selecteaza(94)
    expect(g.incepe(93)).toBeNull()
    g.selecteaza(93)
    expect(g.actual(a)).toBe(false)
    const b = g.incepe(93)
    const c = g.incepe(93)
    expect(g.actual(b)).toBe(false)
    expect(g.actual(c)).toBe(true)
    g.invalideaza()
    expect(g.actual(c)).toBe(false)
  })

  it('sursa eșuată lasă poarta fără verdict verde și păstrează cauza în eroare', async () => {
    let stare = null, eroare = null
    try {
      const r = await citesteDatePT(mockSupabase(q => q.sursa === 'profiles' ? { error: { message: 'indisponibil' } } : undefined), 93, async () => ({}))
      stare = r.initial.v_ofertare_pt_stare
    } catch (e) { eroare = e.message }
    expect(eroare).toBe('profiles: indisponibil')
    expect(evalueazaPoarta(stare)).toBeNull()
  })
})
