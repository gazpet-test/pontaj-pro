// V1: reguli locale, numai citire. Nu scrie drepturi, notificări sau statusuri.
export const ADMIN_ALERTE_KEY = 'admin_alerte'
export const SURSE_ADMIN = [
  { id: 'ofertare', label: 'Ofertare', module: 'ofertare', path: '/ofertare' },
  { id: 'hr', label: 'HR · autorizații', module: 'hr', path: '/hr' },
  { id: 'flota', label: 'Logistică · documente', module: 'logistica', path: '/logistica?tab=documente&sub=alerte' },
  { id: 'firma', label: 'Documente firmă', module: 'administrativ', submodule: 'administrativ.documente', path: '/administrativ' },
  { id: 'gbe', label: 'Garanții GBE', module: 'financiar', path: '/financiar?tab=gbe' },
  { id: 'comenzi', label: 'Aprobări comenzi', module: 'achizitii', path: '/achizitii', approval: true },
  { id: 'transport', label: 'Aprobări transport', module: 'logistica', path: '/logistica?tab=transporturi', approval: true },
]

// Cheia transversală este explicită inclusiv pentru owner. Nu moștenește dreptul HR.
export function areAccesAdministrator(profile) {
  return !!profile?.id && (profile.module_access || []).includes(ADMIN_ALERTE_KEY)
}

export function areAccesSursa(profile, source) {
  if (!areAccesAdministrator(profile)) return false
  if (profile.is_owner === true) return true
  const modules = profile.module_access || []
  return modules.includes(source.module) || (!!source.submodule && modules.includes(source.submodule))
}

export function ziBucuresti(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const get = type => parts.find(p => p.type === type).value
  return `${get('year')}-${get('month')}-${get('day')}`
}

function ziValida(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const stamp = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === value ? stamp : null
}

export function zileRamase(value, today) {
  const date = ziValida(value), now = ziValida(today)
  return date == null || now == null ? null : Math.round((date - now) / 86400000)
}

const ordine = { critical: 0, week: 1, attention: 2, missing: 3 }
export function sorteazaAlerte(rows) {
  return [...rows].sort((a, b) => (ordine[a.priority] - ordine[b.priority]) || (a.date || '9999').localeCompare(b.date || '9999') || a.id.localeCompare(b.id))
}

function alerta(source, id, fields) {
  return { id: `${source}:${id}`, source, owner: 'Responsabil de confirmat', priority: 'attention', date: null, estimated: false, ...fields }
}

function expirare(source, id, title, date, today, fields = {}) {
  const days = zileRamase(date, today)
  if (days != null && days > 30) return null
  return alerta(source, id, {
    title, date: days == null ? null : date,
    priority: days == null ? 'missing' : days < 0 ? 'critical' : days <= 7 ? 'week' : 'attention',
    impact: days == null ? 'Valabilitatea nu poate fi stabilită. Verifică documentul.' : days < 0 ? `Expirat de ${Math.abs(days)} zile. Verifică utilizarea și reînnoirea.` : days === 0 ? 'Expiră astăzi. Verifică reînnoirea.' : `Expiră în ${days} zile. Urmărește reînnoirea.`,
    reason: 'Data documentului, comparată cu ziua curentă în România. Lipsa datei nu înseamnă document expirat.',
    ...fields,
  })
}

export function alerteOfertare(rows, now = new Date()) {
  const today = ziBucuresti(now)
  return rows.flatMap(row => {
    if (!['identificata', 'analiza', 'go', 'in_lucru'].includes(row.status) || row.decizie_go === 'no_go') return []
    const deadline = row.termen_depunere ? new Date(row.termen_depunere) : null
    const valid = deadline && Number.isFinite(deadline.getTime())
    const date = valid ? ziBucuresti(deadline) : null
    const days = zileRamase(date, today)
    const unassigned = !row.responsabil_id
    if (valid && days > 7 && !unassigned) return []
    const late = valid && deadline < now
    const committed = ['go', 'in_lucru'].includes(row.status)
    const priority = !valid ? 'missing' : committed && (late || (unassigned && days <= 3)) ? 'critical' : days <= 7 ? 'week' : 'attention'
    const issues = [!valid ? 'Termen lipsă sau invalid' : late ? 'Termen depășit; status rămas deschis' : `Depunere în ${days} zile`, unassigned ? 'Responsabil neatribuit' : null].filter(Boolean)
    return [alerta('ofertare', row.id, {
      title: row.nr_anunt || `Licitație #${row.id}`, reference: row.obiect || row.autoritate || '',
      priority, date, timestamp: valid ? row.termen_depunere : null,
      owner: unassigned ? 'Neatribuit' : 'Responsabil desemnat · vezi fișa',
      impact: issues.join(' · '),
      reason: `Status: ${row.status}. Termenul se verifică la ora exactă. Licitațiile depuse, câștigate, pierdute sau abandonate nu sunt incluse. Nu se evaluează acoperirea cerințelor.`,
      locator: `ofertare_licitatii · ID ${row.id}`,
    })]
  })
}

export function alerteHr(rows, today) {
  return rows.flatMap(row => {
    const fields = { reference: `${row.employee_name || 'Titular necunoscut'} · ${row.numar_autorizatie || 'fără număr'}`, locator: `hr_autorizatii · ID ${row.id}`, reason: 'Autorizație din evidența HR curentă. Titularii cu contract încheiat și autorizațiile șterse sunt excluse de sursă. Impactul în licitații/șantiere nu este dedus.' }
    const result = []
    if (!row.fara_expirare) result.push(expirare('hr', row.id, row.tip_denumire || 'Autorizație', row.data_expirare, today, fields))
    if (row.necesita_confirmare_rsvti) result.push(expirare('hr', `${row.id}:viza`, `Viză RSVTI · ${row.tip_denumire || 'autorizație'}`, row.rsvti_urmatoarea_confirmare, today, fields))
    return result.filter(Boolean)
  })
}

export function alerteFirma(rows, today) {
  return rows.filter(row => row.activ && !row.fara_expirare && !row.se_reemite).map(row => expirare('firma', row.id, row.denumire || 'Document firmă', row.data_valabilitate, today, {
    reference: row.numar_document || `Document #${row.id}`, locator: `documente_firma · ID ${row.id}`,
  })).filter(Boolean)
}

export function alerteFlota(docs, assets, types, today) {
  const byAsset = new Map(assets.map(a => [String(a.id), a]))
  const byType = new Map(types.map(t => [String(t.id), t.nume]))
  return docs.flatMap(row => {
    if (row.fara_expirare || (row.entitate_tip && row.entitate_tip !== 'activ')) return []
    const asset = byAsset.get(String(row.active_id || row.entitate_id))
    if (!asset || asset.vandut || asset.deep_sleep) return []
    const item = expirare('flota', row.id, `${byType.get(String(row.tip_id)) || 'Document'} · ${asset.nr_inmatriculare || asset.cod_intern || `Activ #${asset.id}`}`, row.data_expirare, today, {
      reference: [asset.marca, asset.model, row.numar_document].filter(Boolean).join(' · '), locator: `logistica_documente · ID ${row.id}; activ ${asset.id}`,
      reason: 'Document asociat unui activ nevândut, în afara deep-sleep. Nu se deduce automat blocarea unui transport sau șantier.',
    })
    return item ? [item] : []
  })
}

export function alerteGbeAdmin(balances, policies, contracts, today) {
  const byContract = new Map(contracts.map(c => [String(c.id), c]))
  const rows = balances.flatMap(row => {
    if (['reziliat', 'draft'].includes(row.status) || !(Number(row.gbe_ramas) > 0)) return []
    const days = zileRamase(row.gbe_data_estimata_recuperare, today)
    const fields = { reference: row.denumire || '', locator: `v_gbe_per_contract · contract ${row.contract_id}`, amount: Number(row.gbe_ramas), currency: 'RON', estimated: true }
    const result = []
    if (days == null || days <= 30) result.push(alerta('gbe', `${row.contract_id}:recuperare`, {
      ...fields, title: `Recuperare GBE · ${row.numar_contract || row.contract_id}`,
      priority: days == null ? 'missing' : days >= 0 && days <= 7 ? 'week' : 'attention',
      date: days == null ? null : row.gbe_data_estimata_recuperare,
      impact: days == null ? 'Sold rămas; lipsește termenul estimat de recuperare.' : days < 0 ? 'Estimarea recuperării a trecut. Verifică recepția și condițiile contractuale.' : `Recuperare estimată în ${days} zile. Pregătește verificarea condițiilor.`,
      reason: 'Soldul este cel din evidența GBE existentă (reținut minus restituit). Data este o estimare, nu o scadență contractuală confirmată. Nu se declară automat sumă exigibilă.',
    }))
    if (row.gbe_cont_valabil_pana) result.push(expirare('gbe', `${row.contract_id}:cont`, `Cont GBE · ${row.numar_contract || row.contract_id}`, row.gbe_cont_valabil_pana, today, { ...fields, estimated: false }))
    return result.filter(Boolean)
  })
  for (const policy of policies) {
    const contract = byContract.get(String(policy.contract_id))
    if (!contract || ['reziliat', 'draft'].includes(contract.status) || !policy.activ) continue
    const item = expirare('gbe', `polita:${policy.id}`, `Poliță GBE · ${policy.numar_polita || policy.id}`, policy.data_expirare, today, {
      reference: contract.numar_contract || `Contract ${policy.contract_id}`, locator: `gbe_polite · ID ${policy.id}`, reason: 'Poliță activă, pe contract nereziliat și semnat. Alerta urmărește valabilitatea, fără a declara automat o sumă de recuperat.',
    })
    if (item) rows.push(item)
  }
  return rows
}

export function statusuriTransport(profile) {
  const name = (profile?.name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  return [...(profile?.is_owner || name.includes('mitrache') ? ['submitata'] : []), ...(profile?.is_owner || name.includes('puscasu') ? ['aprobata_mitrache'] : [])]
}

// Paginare cu număr exact: o limită sau o pagină incompletă nu devine succes cu date tăiate.
export async function citesteToate(makeQuery, signal) {
  const rows = [], size = 500, cap = 20000
  let expected = null
  for (let offset = 0; offset < cap; offset += size) {
    if (signal?.aborted) throw new Error('Citire întreruptă')
    const { data, error, count } = await makeQuery().range(offset, offset + size - 1).abortSignal(signal)
    if (error) throw error
    if (!Array.isArray(data) || !Number.isInteger(count)) throw new Error('Răspuns incomplet al sursei')
    if (expected != null && count !== expected) throw new Error('Sursa s-a schimbat în timpul citirii. Reîmprospătează.')
    expected = count
    if (count > cap) throw new Error('Sursa depășește limita de 20.000 înregistrări; evaluare incompletă')
    rows.push(...data)
    if (rows.length === count) return rows
    if (data.length < size) throw new Error('Sursă incompletă; numărul de rânduri nu corespunde')
  }
  throw new Error('Evaluare incompletă')
}

// Proiecții explicite, reutilizabile în verificarea API. Niciun SELECT * pe personal/financiar.
export const SELECT_ADMIN = {
  ofertare_licitatii: 'id,nr_anunt,obiect,autoritate,status,decizie_go,responsabil_id,termen_depunere',
  v_hr_autorizatii_status: 'id,employee_id,employee_name,tip_denumire,numar_autorizatie,data_expirare,fara_expirare,necesita_confirmare_rsvti,rsvti_urmatoarea_confirmare',
  documente_firma: 'id,denumire,numar_document,data_valabilitate,fara_expirare,se_reemite,activ',
  logistica_documente: 'id,active_id,entitate_id,entitate_tip,tip_id,numar_document,data_expirare,fara_expirare',
  logistica_active: 'id,cod_intern,nr_inmatriculare,marca,model,vandut,deep_sleep',
  logistica_tipuri_documente: 'id,nume',
  v_gbe_per_contract: 'contract_id,numar_contract,denumire,gbe_ramas,gbe_data_estimata_recuperare,gbe_cont_valabil_pana,status',
  gbe_polite: 'id,contract_id,numar_polita,data_expirare,activ',
  contracte_terti: 'id,numar_contract,status',
  comenzi_furnizor_aprobari: 'id,comanda:comenzi_furnizor(id,numar_comanda,moneda,status,linii:comenzi_furnizor_linii(cantitate,pret_unitar))',
  logistica_comenzi_transport: 'id,numar_comanda,data_transport,status',
}

export async function incarcaSursaAdmin(client, source, profile, { signal, now = new Date() } = {}) {
  if (!areAccesSursa(profile, source)) return { state: 'denied', rows: [], message: 'Acces neacordat la modulul sursă.' }
  const today = ziBucuresti(now)
  const read = (table, filter = q => q, order = 'id') => citesteToate(() => filter(client.from(table).select(SELECT_ADMIN[table], { count: 'exact' })).order(order), signal)
  try {
    let rows = []
    if (source.id === 'ofertare') rows = alerteOfertare(await read('ofertare_licitatii', q => q.in('status', ['identificata', 'analiza', 'go', 'in_lucru'])), now)
    if (source.id === 'hr') rows = alerteHr(await read('v_hr_autorizatii_status'), today)
    if (source.id === 'firma') rows = alerteFirma(await read('documente_firma', q => q.eq('activ', true)), today)
    if (source.id === 'flota') {
      const [docs, assets, types] = await Promise.all([read('logistica_documente'), read('logistica_active'), read('logistica_tipuri_documente')])
      rows = alerteFlota(docs, assets, types, today)
    }
    if (source.id === 'gbe') {
      const [balances, policies, contracts] = await Promise.all([read('v_gbe_per_contract', q => q.gt('gbe_ramas', 0), 'contract_id'), read('gbe_polite', q => q.eq('activ', true)), read('contracte_terti')])
      rows = alerteGbeAdmin(balances, policies, contracts, today)
    }
    if (source.id === 'comenzi') rows = (await read('comenzi_furnizor_aprobari', q => q.eq('profile_id', profile.id).eq('status', 'in_asteptare')))
      .filter(a => a.comanda?.status === 'in_aprobare').map(a => ({
        id: `comenzi:${a.id}`, source: 'comenzi', title: a.comanda.numar_comanda || `Comandă #${a.comanda.id}`,
        amount: (a.comanda.linii || []).reduce((sum, line) => sum + Number(line.cantitate || 0) * Number(line.pret_unitar || 0), 0), currency: a.comanda.moneda,
        path: `/achizitii?id=${a.comanda.id}`, impact: 'Așteaptă aprobarea ta. Decizia se ia în fișa comenzii.',
      }))
    if (source.id === 'transport') {
      const statuses = statusuriTransport(profile)
      rows = statuses.length ? (await read('logistica_comenzi_transport', q => q.in('status', statuses))).map(row => ({
        id: `transport:${row.id}`, source: 'transport', title: row.numar_comanda || `Transport #${row.id}`, date: row.data_transport,
        impact: row.status === 'submitata' ? 'Pasul 1 · Mitrache' : 'Pasul 2 · Pușcașu', path: source.path,
      })) : []
    }
    return { state: 'ok', rows, evaluatedAt: new Date().toISOString(), message: rows.length ? '' : 'Nicio situație în datele vizibile utilizatorului.' }
  } catch (error) {
    const denied = ['42501', 'PGRST301', 'PGRST302'].includes(error.code)
    return { state: denied ? 'denied' : 'error', rows: [], message: denied ? 'Citirea a fost refuzată de sursă.' : `Evaluare nereușită${error.code ? ` (${error.code})` : ''}. Reîmprospătează sau verifică modulul sursă.` }
  }
}
