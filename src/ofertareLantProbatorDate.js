import { citestePaginat } from './ofertareCantitatiInvalidare.js'

// Embed-uri deja folosite în OfertareCerinte.jsx; restul relațiilor se citesc separat.
const ACOPERIRE = '*, autorizatie:hr_autorizatii(id, numar_autorizatie, tip:hr_autorizatii_tipuri(denumire), emp:employees(name), ext:hr_personal_extern(nume)), partener:ofertare_parteneri(nume), doc_firma:documente_firma(id, tip, denumire, numar_document), experienta:ofertare_experienta(id, denumire, beneficiar), recomandare:hr_recomandari(id, rol, beneficiar, emp:employees(name), ext:hr_personal_extern(nume)), studii:hr_documente_personale(id, numar_document, emitent, tip:hr_documente_personale_tipuri(denumire), emp:employees(name))'

// Doar SELECT. O eroare se păstrează pe veriga ei, nu se transformă în „nu există”.
export async function incarcaLantProbator(db, licId, cerintaId) {
  const erori = {}
  const citeste = async (cheie, query, gol = []) => {
    try {
      const { data, error } = await query
      if (error) throw error
      return data ?? gol
    } catch (e) { erori[cheie] = e.message || String(e); return gol }
  }
  const paginat = query => citestePaginat((a, b) => query().order('id').range(a, b))
  const [cerinta, istoric, acoperiri, legaturi, clarificari, ultimul] = await Promise.all([
    citeste('cerinta', db.from('ofertare_cerinte').select('*').eq('licitatie_id', licId).eq('id', cerintaId).maybeSingle(), null),
    citeste('istoric', paginat(() => db.from('ofertare_cerinte').select('*').eq('licitatie_id', licId).not('inlocuita_de', 'is', null))),
    citeste('acoperire', paginat(() => db.from('ofertare_acoperire').select(ACOPERIRE).eq('cerinta_id', cerintaId))),
    citeste('legaturi', paginat(() => db.from('ofertare_pt_legaturi').select('*').eq('cerinta_id', cerintaId))),
    citeste('clarificari', paginat(() => db.from('ofertare_clarificari').select('*').eq('licitatie_id', licId))),
    citeste('pachet', db.from('ofertare_pt_pachet').select('*').eq('licitatie_id', licId).order('versiune', { ascending: false }).limit(1).maybeSingle(), null),
  ])
  // Evită URL-uri PostgREST enorme pentru o cerință cu multe legături.
  const dupaIds = async (cheie, tabel, coloana, ids) => {
    const unice = [...new Set(ids.filter(id => id != null))]
    const randuri = []
    for (let i = 0; i < unice.length; i += 100) {
      randuri.push(...await citeste(cheie, paginat(() => db.from(tabel).select('*').in(coloana, unice.slice(i, i + 100)))))
    }
    return randuri
  }
  const [dovezi, capitole, fisiere, raspunsSet] = await Promise.all([
    dupaIds('dovezi', 'ofertare_pt_dovezi', 'legatura_id', legaturi.map(l => l.id)),
    dupaIds('capitole', 'ofertare_pt_capitole', 'id', legaturi.map(l => l.capitol_id)),
    ultimul ? citeste('fisiere', paginat(() => db.from('ofertare_pt_pachet_fisiere').select('*').eq('pachet_id', ultimul.id))) : [],
    cerinta?.raspuns_set_id ? citeste('raspunsSet', db.from('ofertare_raspuns_set').select('*')
      .eq('licitatie_id', licId).eq('id', cerinta.raspuns_set_id).maybeSingle(), null) : null,
  ])
  const documente = await dupaIds('documente', 'ofertare_documente_atribuire', 'id',
    [cerinta?.sursa_document_id, ...istoric.map(c => c.sursa_document_id), ...dovezi.map(d => d.document_id)])
  return { cerinta, istoric, acoperiri, dovezi, legaturi, capitole, clarificari,
    pachet: ultimul ? { ...ultimul, fisiere } : null, documente, raspunsSet, erori }
}
