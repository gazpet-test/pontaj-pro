// Contractul E3b §1 / §2.5. Serverul revalidează drepturile și valorile.
export const IDENT = ['serie', 'sarja', 'lot', 'lungime_aviz_mm', 'lungime_masurata_mm', 'unghi_curba']
export const DIRECT = ['perete_mm', 'diametru_mm', 'greutate_kg', 'dimensiune', 'grad_otel', 'standard', 'izolatie']
export const TIPURI_CORECTII = { camp:'Identitate', carantina_intrare:'Intrare în carantină', carantina_iesire:'Ieșire din carantină', pierdut:'Lipsește fizic', gasit_recuperare:'Am găsit-o', gasit_nou:'Bucată găsită nouă' }
export const aziLocal = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) }
export const activa = (a, azi = aziLocal()) => a.activ !== false && (!a.valabil_de || a.valabil_de <= azi) && (!a.valabil_pana || a.valabil_pana >= azi)
export function responsabil(eu, pid) {
  return !!eu.owner || ['editor', 'admin'].includes(eu.nivelMagazie) && eu.atribuiri.some(a => activa(a) && String(a.proiect_id) === String(pid) && a.depozit_id == null && ['manager_aprobator', 'inlocuitor_aprobator'].includes(a.rol))
}
export function propune(eu, pid, dep) {
  return responsabil(eu, pid) || !!dep && ['editor', 'admin'].includes(eu.nivelMagazie) && eu.atribuiri.some(a => activa(a) && a.rol === 'gestionar' && String(a.proiect_id) === String(pid) && String(a.depozit_id) === String(dep))
}
export function actiuni(eu, pid, c) {
  const propria = eu.id === c.propus_de, deschisa = c.stare === 'propusa'
  return { decide:deschisa && !propria && responsabil(eu, pid), retrage:deschisa && propria }
}
export const campuri = (tip, direct = false) => direct ? DIRECT : IDENT.filter(k => tip === 'curba' ? !k.startsWith('lungime_') : k !== 'unghi_curba')
export const serieCautare = s => String(s ?? '').toUpperCase().replace(/[\s._/-]/g, '')
// O recuperare din pierdut nu deschide un nou episod de carantină.
export function cereStareIesire(b) {
  const episod = [...(b.miscari || [])].reverse().find(m => m.stare_dupa === 'carantina' && (m.rol === 'nascut' || m.stare_inainte != null && !['carantina', 'pierduta'].includes(m.stare_inainte)))
  return episod?.rol === 'nascut' && b.aviz_intrare_id == null
}
export function diferenteDocument(b, rand) {
  if (!rand) return []
  const surse = { lungime_aviz_mm:'lungime_doc_mm', unghi_curba:rand.unghi_masurat != null ? 'unghi_masurat' : 'unghi_doc' }
  return [...campuri(b.tip_cod), ...DIRECT].filter(k => {
    const vechi = rand[surse[k] || k], nou = b[k]
    if (vechi == null && nou == null) return false
    return numerice.has(k) ? (vechi == null ? null : Number(vechi)) !== (nou == null ? null : Number(nou)) : (vechi ?? null) !== (nou ?? null)
  })
}
const numerice = new Set(['depozit_id', 'document_intrare_id', 'perete_mm', 'diametru_mm', 'greutate_kg', 'lungime_aviz_mm', 'lungime_masurata_mm', 'unghi_curba'])
export function valori(form, chei) {
  const r = {}
  for (const k of chei) if (Object.hasOwn(form, k)) {
    const v = String(form[k] ?? '').trim()
    r[k] = v === '' ? null : numerice.has(k) ? Number(v.replace(',', '.')) : v
    if (typeof r[k] === 'number' && !Number.isFinite(r[k])) throw new Error(`Valoare numerică invalidă: ${k}`)
  }
  return r
}
export function delta(form, bucata, chei) {
  return Object.fromEntries(Object.entries(valori(form, chei)).filter(([k, v]) => numerice.has(k) ? v !== (bucata[k] == null ? null : Number(bucata[k])) : v !== (bucata[k] ?? null)))
}
export const mesajCorectie = e => e?.code === '40001' ? 'S-a schimbat, reîncarcă. ' + (e.message || '') : e?.message || String(e)
export const lipsaCorectii = e => ['42P01', 'PGRST205', '42883', 'PGRST202'].includes(e?.code)
export const listaMesaje = x => Array.isArray(x) ? x : []
export const textMesaj = x => typeof x === 'string' ? x : JSON.stringify(x)
export function rezumatDiff(diff, baza) {
  if (baza) return 'Versiune inițială'
  const nr = x => Array.isArray(x) ? x.length : Object.keys(x || {}).length
  const randuri = diff?.randuri || {}, scanuri = diff?.scanuri || {}
  const antet = ['antet', 'aviz', 'lista', 'totaluri'].reduce((n, k) => n + nr(diff?.[k]), 0)
  return `+${nr(randuri.adaugate)} / −${nr(randuri.sterse)} rânduri; ${Object.values(randuri.modificate || {}).reduce((n, x) => n + nr(x), 0) + antet} câmpuri; scanuri +${nr(scanuri.adaugate)} / −${nr(scanuri.scoase)} / ~${nr(scanuri.modificate)}`
}
export function argumenteVerifica(tip, pid, bid, detalii) {
  return { p_corectie_id:null, p_tip:tip, p_proiect:pid, p_bucata_id:bid, p_detalii:detalii }
}
export async function pagini(cerere, cheie = 'id') {
  const tot = []; let ultim = null
  for (;;) {
    let q = cerere(); if (ultim != null) q = q.gt(cheie, ultim)
    const { data, error } = await q.order(cheie).limit(500)
    if (error) throw error
    if (!data?.length) return tot
    const nou = data[data.length - 1][cheie]
    if (nou == null || nou === ultim) throw new Error('Paginarea nu avansează')
    tot.push(...data); ultim = nou
  }
}
