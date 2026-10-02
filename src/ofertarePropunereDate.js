import { REGEX_INTERZICE_CUMUL } from './ofertareControale.js'

// QW0: definiția R06; o propunere neverificată nu închide cerința.
export const estDovadaVerificataPT = a =>
  (a?.status === 'acoperit' || a?.status === 'acoperit_partener')
  && a.verificat_pe_scan === true && (a.reverificare_ceruta ?? false) === false

export function clasificaDoveziPT(acoperiri) {
  const dovedite = new Set(acoperiri.filter(estDovadaVerificataPT).map(a => a.cerinta_id))
  const propuse = new Set(acoperiri.filter(a =>
    (a.status === 'acoperit' || a.status === 'acoperit_partener') && !dovedite.has(a.cerinta_id)
  ).map(a => a.cerinta_id))
  return { dovedite, propuse }
}

export const inchisaCuDovadaPT = (id, legaturi, dovedite) => dovedite.has(id)
  && !legaturi.some(l => l.fel === 'capitol' || l.fel === 'exceptat')

// Nici eroarea PostgREST, nici o promisiune respinsă nu devin liste goale.
export async function citesteSursePT(surse) {
  const rezultate = await Promise.all(Object.entries(surse).map(async ([sursa, citeste]) => {
    try {
      const r = await citeste()
      if (r.error) throw r.error
      return { sursa, data: r.data }
    } catch (e) { return { sursa, eroare: `${sursa}: ${e?.message || String(e)}` } }
  }))
  const erori = rezultate.filter(r => r.eroare).map(r => r.eroare)
  if (erori.length) throw new Error(erori.join(' · '))
  return Object.fromEntries(rezultate.map(r => [r.sursa, r.data]))
}

// Schimbarea selecției invalidează inclusiv A → B → A și reload-urile concurente.
export function creeazaGardaIncarcarePT() {
  let selectie = null, secventa = 0
  return {
    selecteaza(id) { if (selectie !== id) { selectie = id; secventa++ } },
    incepe(id) { return id === selectie ? ++secventa : null },
    actual(token) { return token != null && token === secventa },
    invalideaza() { secventa++ },
  }
}

export async function citesteDatePT(supabase, id, citesteGrafic) {
  const initial = await citesteSursePT({
      'v_ofertare_pt_stare': () => supabase.from('v_ofertare_pt_stare').select('*').eq('licitatie_id', id).maybeSingle(),
      'ofertare_pt_capitole': () => supabase.from('ofertare_pt_capitole').select('*').eq('licitatie_id', id).order('nr'),
      'ofertare_cerinte': () => supabase.from('ofertare_cerinte')
        .select('id, nr_ordine, text_cerinta, tip, sursa_sectiune, sursa_pagina, confirmata_de')
        .eq('licitatie_id', id).in('tip', ['propunere','forma'])
        .is('inlocuita_de', null).is('duplicat_al', null)
        .order('nr_ordine').limit(5000),
      'v_ofertare_pt_conformitate': () => supabase.from('v_ofertare_pt_conformitate').select('*').eq('licitatie_id', id)
        .order('text_brut').limit(2000),
      'hr_autorizatii_tipuri': () => supabase.from('hr_autorizatii_tipuri').select('cod, denumire, categorie')
        .eq('activ', true).order('categorie').order('cod'),
      // Autorizatiile FARA angajat = specialistii externi (terti sustinatori). Numele lor exista
      // doar in fisier_nume/observatii, deci legatura o face omul, nu o ghicim noi.
      'hr_autorizatii': () => supabase.from('hr_autorizatii').select('id, fisier_nume, observatii, data_expirare, tip_id')
        .is('employee_id', null).is('deleted_at', null).order('id').limit(500),
      'ofertare_pt_observatii': () => supabase.from('ofertare_pt_observatii').select('*').eq('licitatie_id', id)
        .order('cerut_la', { ascending: false }).limit(1000),
      // Numele celor care au cerut/rezolvat. Fara ele istoricul arata uuid-uri, adica nimic.
      'profiles': () => supabase.from('profiles').select('id, name').limit(500),
      'ofertare_documente_atribuire': () => supabase.from('ofertare_documente_atribuire').select('id, nume_original, revizie, pagini').eq('licitatie_id', id).order('id').limit(500),
      'ofertare_pt_pachet': () => supabase.from('ofertare_pt_pachet').select('*, fisiere:ofertare_pt_pachet_fisiere(rol, nume, sha256, size_bytes, sursa_versiune, anexa_ref, semnat, sursa_participant, unit_in)')
        .eq('licitatie_id', id).order('versiune', { ascending: false }).limit(50),
      'ofertare_pt_garantie': () => supabase.from('ofertare_pt_garantie').select('*').eq('licitatie_id', id).maybeSingle(),
      'ofertare_pt_participanti': () => supabase.from('ofertare_pt_participanti').select('*, partener:ofertare_parteneri(nume)').eq('licitatie_id', id).order('rol'),
      'ofertare_parteneri': () => supabase.from('ofertare_parteneri').select('id, nume').eq('activ', true).order('nume'),
      'ofertare_pt_declaratii': () => supabase.from('ofertare_pt_declaratii').select('*').eq('licitatie_id', id).order('forma'),
      'ofertare_pt_anexe_asteptate': () => supabase.from('ofertare_pt_anexe_asteptate')
        .select('*, participant:ofertare_pt_participanti(id, nume, rol, partener:ofertare_parteneri(nume))')
        .eq('licitatie_id', id).order('id'),
  })
  const rSt = initial.v_ofertare_pt_stare
  const rCap = initial.ofertare_pt_capitole
  const rCer = initial.ofertare_cerinte
  const capIds = (rCap || []).map(c => c.id)
  const ids = (rCer || []).map(c => c.id)
  const rest = await citesteSursePT({
    v_ofertare_pt_cerinte_neconfirmate: () => supabase.from('v_ofertare_pt_cerinte_neconfirmate').select('*').eq('licitatie_id', id).maybeSingle(),
    v_ofertare_seap_completitudine: () => supabase.from('v_ofertare_seap_completitudine').select('blocaj, esentiale').eq('licitatie_id', id).maybeSingle(),
    v_ofertare_cantitati_nevalidate: () => supabase.from('v_ofertare_cantitati_nevalidate').select('*').eq('licitatie_id', id).maybeSingle(),
    'ofertare_cerinte (regula cumul)': () => supabase.from('ofertare_cerinte').select('id, text_cerinta, tip, sursa_sectiune, sursa_pagina')
      .eq('licitatie_id', id).is('inlocuita_de', null).is('duplicat_al', null)
      .filter('text_cerinta', 'imatch', REGEX_INTERZICE_CUMUL).limit(20),
    ofertare_pt_capitole_versiuni: () => capIds.length ? supabase.from('ofertare_pt_capitole_versiuni')
      .select('*').in('capitol_id', capIds).order('versiune', { ascending: false }).limit(2000) : { data: [] },
    ofertare_pt_legaturi: () => ids.length ? supabase.from('ofertare_pt_legaturi')
      .select('id, cerinta_id, capitol_id, fel, motiv, sursa, stare, locator_raspuns, constatare, verificat_la_versiunea, confirmat_la').in('cerinta_id', ids).limit(10000) : { data: [] },
    ofertare_acoperire: () => ids.length ? supabase.from('ofertare_acoperire')
      .select('cerinta_id, status, verificat_pe_scan, reverificare_ceruta').in('cerinta_id', ids).in('status', ['acoperit','acoperit_partener']).limit(10000) : { data: [] },
    v_ofertare_pt_echipa: () => supabase.from('v_ofertare_pt_echipa').select('*').eq('licitatie_id', id).order('ordine', { nullsFirst: false }).order('nume').limit(500),
    v_ofertare_pt_echipa_blocaje: () => supabase.from('v_ofertare_pt_echipa_blocaje').select('*').eq('licitatie_id', id).limit(200),
    'reverificare grafic': async () => {
      const data = rSt?.grafic_versiune ? await citesteGrafic(id) : {}
      return { data, error: data.grafic_reverificare_eroare ? new Error(data.grafic_reverificare_eroare) : null }
    },
  })
  return { initial, rest, ...clasificaDoveziPT(rest.ofertare_acoperire || []) }
}
