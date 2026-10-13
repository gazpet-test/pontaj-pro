// ofertare-triere v1.9 (13.10.2026) — contextul suplimentar al trierii și verificările din cod, pure (testabile fără BD / AI).
// Cauzele (diagnostic 12.10, claude_context #1727, plan docs/ofertare/PLAN_TRIERE_102.md):
//   1. trierea citea DOAR fișa de date; detalierea criteriilor de atribuire (doc separat, ex. 522 pe Botoșani) nu intra în context,
//      deci factorul „personal cheie 15%” apărea ca „rol” fără barem;
//   2. autorizațiile de FIRMĂ (ET, EDIB… din documente_firma) nu erau în context, iar modelul „acoperea” ET cu legitimația EGT a unei
//      persoane — echivalență inventată;
//   3. nimic nu verifica în cod ce cod ANRE are persoana propusă.
import { acoperaCod, codTip } from '../_shared/echivalenteAnre.ts'

// ── 1. documentele de criterii ─────────────────────────────────────────────────────────────────────────
// Decizia D3 (Răzvan 13.10): recunoaștere după nume, fără schemă nouă.
export const RE_CRITERII = /criteri|detaliere|factor(i|ii|ilor)?\s+de\s+evaluare|algoritm\s+de\s+calcul/i
export const MAX_CRITERII_CARACTERE = 40_000

export type DocCriterii = { id: number; nume_original: string | null; tip?: string | null; are_text: boolean }
export function selecteazaCriterii(docs: DocCriterii[], fisaId: number): number[] {
  return docs
    .filter((d) => Number(d.id) !== Number(fisaId) && d.are_text && RE_CRITERII.test(String(d.nume_original || '').replace(/[_]/g, ' ')))
    .map((d) => Number(d.id))
    .sort((a, b) => a - b)
}

// ── 2. autorizațiile de firmă ─────────────────────────────────────────────────────────────────────────
export type DocFirma = { id: number; denumire: string | null; tip: string | null; categorie?: string | null; data_valabilitate: string | null; fara_expirare: boolean | null }
export type StareFirma = 'valabil' | 'expirat' | 'valabilitate_necunoscuta'
export function stareDocFirma(d: DocFirma, azi: string): StareFirma {
  if (d.fara_expirare) return 'valabil'
  if (!d.data_valabilitate) return 'valabilitate_necunoscuta'   // ex. #14 „ET+EPI 2022 (versiune veche)” — nu se socotește
  return d.data_valabilitate >= azi ? 'valabil' : 'expirat'
}
export function liniiFirma(docs: DocFirma[], azi: string): { linii: string[]; valabile: Map<number, DocFirma> } {
  const linii: string[] = [], valabile = new Map<number, DocFirma>()
  for (const d of [...docs].sort((a, b) => a.id - b.id)) {
    const st = stareDocFirma(d, azi)
    const pana = d.fara_expirare ? 'fără expirare' : d.data_valabilitate ? `până ${d.data_valabilitate}` : ''
    const marcaj = st === 'valabil' ? `(${pana})` : st === 'expirat' ? `[EXPIRAT ${d.data_valabilitate}] — nu se poate folosi` : '[VALABILITATE NECUNOSCUTĂ] — nu îndeplinește cerința'
    linii.push(`- #${d.id} ${d.denumire || d.tip || 'document'}${d.tip && d.denumire && !String(d.denumire).includes(String(d.tip)) ? ' [' + d.tip + ']' : ''} ${marcaj}`)
    if (st === 'valabil') valabile.set(d.id, d)
  }
  return { linii, valabile }
}

// Modelul întoarce "atestari_firma": [{cerinta, document_firma_id}]; codul verifică id-ul față de documentele VALABILE (nu se crede
// pe cuvânt) și scrie sursa: „îndeplinită prin documente_firma #13 (până 2027-07-27)”. Fără id valabil = neacoperită.
export function valideazaAtestariFirma(parsed: any, valabile: Map<number, DocFirma>, termen?: string | null): string[] {
  const lista: any[] = Array.isArray(parsed.atestari_firma) ? parsed.atestari_firma.slice(0, 20) : []
  const neacoperite: string[] = []
  parsed.atestari_firma = lista.map((a) => {
    const cerinta = String(a?.cerinta || '').trim().slice(0, 400)
    const id = Number(a?.document_firma_id)
    const d = Number.isSafeInteger(id) ? valabile.get(id) : undefined
    if (!d) {
      neacoperite.push(cerinta)
      return { cerinta, document_firma_id: null, status: 'neacoperita', sursa: 'nicio autorizație de firmă valabilă în platformă pentru cerință (documente_firma)' }
    }
    const pana = d.fara_expirare ? 'fără expirare' : `până ${d.data_valabilitate}`
    const expiraInainte = !d.fara_expirare && termen && d.data_valabilitate! < termen
    return { cerinta, document_firma_id: d.id, status: 'indeplinita',
      sursa: `îndeplinită prin documente_firma #${d.id} „${d.denumire || d.tip}” (${pana})` + (expiraInainte ? ` — ATENȚIE: expiră înainte de ${termen}` : '') }
  })
  return neacoperite
}

// ── 3. personalul: codurile ANRE ale fiecărei persoane + verificarea propunerii ─────────────────────────────
export type AutPers = { cine: string; tip: string; valabil: boolean }
export function coduriPePersoana(aut: AutPers[]): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>()
  for (const a of aut) {
    if (!a.valabil) continue
    const c = codTip(a.tip); if (!c) continue
    const k = normNume(a.cine)
    if (!m.has(k)) m.set(k, new Set())
    m.get(k)!.add(c)
  }
  return m
}
export const normNume = (s: any) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()
// numele din fișă / propunere poate fi scurtat („TRUSU RAZVAN” vs „TRUSU RAZVAN MIHAIL”): potrivire pe prefix de cuvinte
export function aceeasiPersoana(a: string, b: string): boolean {
  const x = normNume(a).split(' '), y = normNume(b).split(' ')
  if (!x[0] || !y[0]) return false
  const [scurt, lung] = x.length <= y.length ? [x, y] : [y, x]
  return scurt.every((w, i) => lung[i] === w)
}
function coduriLui(coduri: Map<string, Set<string>>, nume: string): Set<string> {
  for (const [k, v] of coduri) if (aceeasiPersoana(k, nume)) return v
  return new Set()
}

// Decizia #1727 pct. 3: pe rolul de persoană EGT se propune de principiu TRUȘU RĂZVAN sau STĂNESCU SILVIU.
export const PREFERINTE_COD: Record<string, string[]> = { EGT: ['TRUSU RAZVAN', 'STANESCU SILVIU'] }

// Pe fiecare rol cu "autorizatie_ceruta" (cod ANRE literal), propunerea trebuie să aibă codul literal sau o echivalență APROBATĂ.
// Rolurile repartizate din matrice (experiență punctată) nu se schimbă de aici — doar se marchează; la celelalte se aplică preferința.
export function verificaAutorizatiiRoluri(parsed: any, coduri: Map<string, Set<string>>, preferinte = PREFERINTE_COD): void {
  const roluri: any[] = Array.isArray(parsed.roluri) ? parsed.roluri : []
  for (const r of roluri) {
    const cerut = String(r?.autorizatie_ceruta || '').trim().toUpperCase()
    if (!cerut || !/^[A-Z]{2,6}$/.test(cerut)) continue
    const dinMatrice = Number.isFinite(r.puncte_conditionat)
    // preferința: dacă rolul nu e repartizat din matrice și o persoană preferată acoperă codul, ea e propunerea
    const pref = (preferinte[cerut] || []).find((p) => acoperaCod(coduriLui(coduri, p), cerut).acoperit)
    if (!dinMatrice && pref && !(r.propunere && preferinte[cerut].some((p) => aceeasiPersoana(p, r.propunere)))) {
      const vechi = r.propunere
      r.propunere = pref
      r.motiv = `[Preferință Răzvan pe ${cerut}] ${pref}${vechi ? ` în locul propunerii AI (${vechi})` : ''}. ` + String(r.motiv || '')
    }
    if (!r.propunere) continue
    const ac = acoperaCod(coduriLui(coduri, r.propunere), cerut)
    r.validare_autorizatie = ac.acoperit ? (ac.prin === 'literal' ? 'cod_literal' : 'echivalenta_aprobata') : 'echivalenta_nevalidata'
    if (!ac.acoperit) {
      r.motiv = `ATENȚIE: ${r.propunere} nu are în platformă autorizația ${cerut} valabilă și nicio echivalență APROBATĂ nu o acoperă — de verificat (nu e confirmat). ` + String(r.motiv || '')
    } else if (ac.prin === 'echivalenta') {
      r.motiv = `[Echivalență aprobată ${ac.cod} → ${cerut}] ` + String(r.motiv || '')
    }
  }
}

// ── 4. bonusul din barem (ex. +2 p pentru certificat de curs „Manager de proiect”, Botoșani factor 2) ─────────
export const RE_CERT_MANAGER = /manager\s*(de\s*)?proiect|project\s*manager/i
export function aplicaBonusBarem(parsed: any, aut: AutPers[]): void {
  const roluri: any[] = Array.isArray(parsed.roluri) ? parsed.roluri : []
  let bonusEchipa = 0
  for (const r of roluri) {
    const b = r?.barem?.bonus
    const puncte = Number(b?.puncte)
    if (!b || !Number.isFinite(puncte) || puncte <= 0 || !r.propunere) continue
    const conditie = String(b.conditie || '').slice(0, 200)
    // condiția recunoscută azi: certificat de curs de manager de proiect, valabil, în hr_autorizatii
    const eCertManager = RE_CERT_MANAGER.test(conditie) || r.rol_canonic === 'manager_proiect'
    const are = eCertManager && aut.some((a) => a.valabil && RE_CERT_MANAGER.test(a.tip) && aceeasiPersoana(a.cine, r.propunere))
    r.bonus = { puncte, conditie, acordat: are }
    if (are) { r.puncte_bonus = puncte; bonusEchipa += puncte }
    r.motiv = String(r.motiv || '') + (are ? ` +${puncte} p bonus (${conditie || 'certificat'} — găsit în platformă).`
      : ` +${puncte} p POSIBIL dacă ${r.propunere} prezintă ${conditie || 'documentul cerut'} — nu e în platformă.`)
  }
  if (bonusEchipa && parsed.repartizare_calculata) parsed.repartizare_calculata.bonus_puncte = bonusEchipa
}
