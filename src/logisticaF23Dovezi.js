// TKT-2026-0362 — Logistică, Formular 23: listă separată pe o categorie de utilaje (ex. aparatele de sudură automată), cu dovada
// deținerii / chiriei pentru fiecare bucată. Varianta A: doar ce există DEJA pe activ, nimic inventat:
//   * categoria = logistica_categorii (tip / subcategorie) aleasă de om din lista reală;
//   * deținerea = logistica_active.tip_proprietate ('firma' / 'inchiriat' / 'comodat');
//   * dovada: chirie / comodat = contractul atașat pe activ (comodat_contract_path), furnizorul (inchiriere_furnizor), perioada
//     (comodat_data_start / _sfarsit); proprietate = numărul de inventar (registrul mijloacelor fixe) — pe activ NU există o
//     factură de achiziție atașată, deci lipsa nr. de inventar e marcată, nu acoperită.
// Excluse, ca din F23: activele vândute și cele în conservare (deep sleep).
// r2 (Jakarinos #1068): exportul NU mai pleacă din lista din ecran (citită fără paginare); își citește singur,
// complet (keyset pe id + numărare), activele categoriei — „fiecare utilaj” trebuie să fie adevărat.

import { paginareKeyset } from './hrDeciziiUtil.js'
import { incarcaNumeAngajati, numeAngajat } from './lib/arhivaAlimentari.js'
import { ziBucuresti } from './lib/izoTeren.js'

export const DETINERE = { firma: 'Proprietate', inchiriat: 'În chirie', comodat: 'Comodat' }

// stare dovadă: 'ok' | 'lipsa' | 'neinceput' | 'expirat' | 'necunoscut' (tip de proprietate necunoscut — nu-l ghicim)
// azi = ziua exportului, 'AAAA-LL-ZZ' în Europe/Bucharest (L17: comparăm zile calendaristice, ca text ISO)
export function dovadaActiv(a, azi, numeAngajat = () => null) {
  const tip = a?.tip_proprietate || 'firma'   // același implicit ca formularul activului (ActivFormModal)
  if (tip === 'firma') {
    const inv = String(a?.nr_inventar ?? '').trim()
    const proprietar = String(a?.firma_proprietara ?? '').trim()
    const text = [inv ? `nr. inventar ${inv}` : 'fără nr. de inventar în evidență', proprietar ? `proprietar: ${proprietar}` : null].filter(Boolean).join(' · ')
    return { detinere: DETINERE.firma, dovada: text, stare: inv ? 'ok' : 'lipsa' }
  }
  if (tip === 'inchiriat' || tip === 'comodat') {
    const contract = String(a?.comodat_contract_path ?? '').trim() !== ''
    const start = a?.comodat_data_start ? String(a.comodat_data_start).slice(0, 10) : null
    const sfarsit = a?.comodat_data_sfarsit ? String(a.comodat_data_sfarsit).slice(0, 10) : null
    const cine = tip === 'inchiriat' ? (String(a?.inchiriere_furnizor ?? '').trim() || null) : (numeAngajat(a?.comodat_employee_id) || null)
    const perioada = start || sfarsit ? `${start ? fmtZi(start) : '…'} – ${sfarsit ? fmtZi(sfarsit) : 'nedeterminat'}` : null
    // r2 (P2): un contract care începe DUPĂ ziua exportului nu dovedește deținerea azi → „neînceput”.
    const neinceput = !!(start && azi && start > azi)
    const expirat = !neinceput && !!(sfarsit && azi && sfarsit < azi)
    const text = [
      contract ? (tip === 'inchiriat' ? 'contract de închiriere atașat' : 'contract de comodat atașat') : 'LIPSĂ contract atașat',
      cine ? (tip === 'inchiriat' ? `furnizor: ${cine}` : `proprietar: ${cine}`) : null,
      perioada ? `perioada: ${perioada}` : null,
      neinceput ? `NEÎNCEPUT (începe la ${fmtZi(start)})` : null,
      expirat ? 'EXPIRAT' : null,
    ].filter(Boolean).join(' · ')
    return { detinere: DETINERE[tip], dovada: text, stare: neinceput ? 'neinceput' : expirat ? 'expirat' : contract ? 'ok' : 'lipsa' }
  }
  return { detinere: String(tip), dovada: 'formă de deținere necunoscută', stare: 'necunoscut' }
}

const fmtZi = iso => { const [y, m, d] = String(iso).split('-'); return d && m && y ? `${d}.${m}.${y}` : String(iso) }

// rândurile listei pentru o categorie (id) — din activele citite COMPLET de incarcaActiveCategorie (r2).
// Aceleași excluderi ca lista din pagină: vândute, conservate, rândul tehnic NEALOCAT.
export function randuriF23Categorie(active, categorieId, azi, numeAngajat) {
  const id = Number(categorieId)
  if (!Number.isFinite(id)) return []
  return (active || [])
    .filter(a => Number(a.categorie_id) === id && !a.vandut && !a.deep_sleep && a.cod_intern !== 'NEALOCAT')
    .map(a => ({
      cod_intern: a.cod_intern || '',
      denumire: [a.marca, a.model].filter(Boolean).join(' ').trim() || a.cod_intern || '—',
      serie: a.serie_sasiu || a.nr_inmatriculare || '',
      an: a.an_fabricatie ?? '',
      stare_activ: a.stare || '',
      ...dovadaActiv(a, azi, numeAngajat),
    }))
    .sort((x, y) => x.denumire.localeCompare(y.denumire, 'ro') || x.cod_intern.localeCompare(y.cod_intern, 'ro'))
}

export const ETICHETA_STARE = { ok: 'OK', lipsa: 'LIPSĂ DOVADĂ', neinceput: 'NEÎNCEPUT', expirat: 'EXPIRAT', necunoscut: 'DE VERIFICAT' }

// foaia Excel (array of arrays): antet + rânduri + sumar
export function foaieF23Categorie(randuri, eticheta, azi) {
  const cap = ['Nr. crt.', 'Denumire', 'Cod intern', 'Serie', 'An', 'Stare activ', 'Deținere', 'Dovada', 'Verificare']
  const corp = randuri.map((r, i) => [i + 1, r.denumire, r.cod_intern, r.serie, r.an, r.stare_activ, r.detinere, r.dovada, ETICHETA_STARE[r.stare] || r.stare])
  const deVerificat = randuri.filter(r => r.stare !== 'ok').length
  return [
    [`Formular 23 — listă separată: ${eticheta}`],
    [`Situația la ${fmtZi(azi)} · ${randuri.length} bucăți · ${deVerificat} fără dovadă completă`],
    [],
    cap,
    ...corp,
  ]
}

// Citire COMPLETĂ a activelor unei categorii (L23): numărare exactă, apoi keyset pe id (ordine stabilă,
// cheie unică) până la pagina goală (paginareKeyset, src/hrDeciziiUtil.js), apoi aceeași numărare din nou.
// Orice diferență = eroare (exportul nu se face cu o listă parțială). tabel() = supabase.from('logistica_active').
export async function incarcaActiveCategorie(tabel, categorieId, { pas = 1000 } = {}) {
  const id = Number(categorieId)
  if (!Number.isSafeInteger(id)) throw new Error('Categoria aleasă nu e validă.')
  const numara = async () => {
    const { error, count } = await tabel().select('id', { count: 'exact', head: true }).eq('categorie_id', id)
    if (error) throw error
    if (!Number.isInteger(count) || count < 0) throw new Error('Serverul nu a confirmat numărul de utilaje din categorie.')
    return count
  }
  const inainte = await numara()
  const rows = await paginareKeyset((ultim, n) => {
    let q = tabel().select('*').eq('categorie_id', id)
    if (ultim != null) q = q.gt('id', ultim)
    return q.order('id', { ascending: true }).limit(n)
  }, pas)
  const dupa = await numara()
  if (rows.length !== inainte || dupa !== inainte) {
    throw new Error(`Lista utilajelor din categorie s-a modificat în timpul citirii (la început ${inainte}, citite ${rows.length}, la final ${dupa}). Reîncercați exportul.`)
  }
  return rows
}

// Tot exportul fără Excel: active (complet) → nume proprietari comodat → rânduri → foaie.
// tabel(nume) = supabase.from(nume). azi = ziua exportului în Europe/Bucharest (implicit acum).
// Întoarce { randuri, foaie, eticheta, avertisment }; erorile de citire se aruncă.
export async function pregatesteF23Categorie(tabel, categorie, { azi = ziBucuresti(), pas = 1000 } = {}) {
  const active = await incarcaActiveCategorie(() => tabel('logistica_active'), categorie?.id, { pas })
  const ids = [...new Set(active.filter(a => a.tip_proprietate === 'comodat' && a.comodat_employee_id != null).map(a => a.comodat_employee_id))]
  let nume = new Map(), avertisment = ''
  if (ids.length) {
    const r = await incarcaNumeAngajati(() => tabel('employees').select('id, name', { count: 'exact' }).in('id', ids))
    nume = r.nume
    avertisment = r.avertisment
  }
  const randuri = randuriF23Categorie(active, categorie.id, azi, id => (id == null ? null : numeAngajat(nume, id)))
  const eticheta = [categorie.tip, categorie.subcategorie].filter(Boolean).join(' · ')
  return { randuri, foaie: foaieF23Categorie(randuri, eticheta, azi), eticheta, azi, avertisment }
}

// Textul de lângă buton (fapt din producție, 12.11.2026: nicio subcategorie dedicată sudurii automate).
// Lista NU ghicește după denumire: ia exact categoria (Tip · Subcategorie) aleasă pe fișa activului.
export const NOTA_F23_CATEGORIE = 'Lista ia utilajele după categoria de pe fișa activului (Tip · Subcategorie), nu după denumire. ' +
  'Ca un aparat să apară în lista „sudură automată”, Logistica îi alege pe fișă subcategoria dedicată; dacă ea nu există încă în listă, se cere adăugarea ei (din aplicație nu se pot crea categorii noi).'
