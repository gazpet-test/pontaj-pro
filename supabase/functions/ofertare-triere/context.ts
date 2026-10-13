// ofertare-triere v1.9 (13.10.2026) — contextul suplimentar al trierii și verificările din cod, pure (testabile fără BD / AI).
// Cauzele (diagnostic 12.10, claude_context #1727, plan docs/ofertare/PLAN_TRIERE_102.md):
//   1. trierea citea DOAR fișa de date; detalierea criteriilor de atribuire (doc separat, ex. 522 pe Botoșani) nu intra în context,
//      deci factorul „personal cheie 15%” apărea ca „rol” fără barem;
//   2. autorizațiile de FIRMĂ (ET, EDIB… din documente_firma) nu erau în context, iar modelul „acoperea” ET cu legitimația EGT a unei
//      persoane — echivalență inventată;
//   3. nimic nu verifica în cod ce cod ANRE are persoana propusă.
// Review Jakarinos r1 (NO-GO, 9 P1): fiecare verificare e fail-closed — ce nu se poate confirma determinist iese „neconfirmat”, intră
// în avertismente și scoate verdictul din „mergem”; valabilitatea se judecă la TERMENUL DE DEPUNERE, nu azi.
import { acoperaCod, codTip } from '../_shared/echivalenteAnre.ts'

// ── 1. documentele de criterii ─────────────────────────────────────────────────────────────────────────
// Decizia D3 (Răzvan 13.10): recunoaștere după nume, fără schemă nouă. Același filtru în SQL (index.ts) și aici.
export const RE_CRITERII = /criteri|detaliere|factor(i|ii|ilor)?\s+de\s+evaluare|algoritm\s+de\s+calcul/i
export const SQL_CRITERII = 'nume_original.ilike.%criteri%,nume_original.ilike.%detaliere%,nume_original.ilike.%factor%evaluare%,nume_original.ilike.%algoritm%calcul%'
export const MAX_CRITERII_DOC = 3
export const MAX_CRITERII_CARACTERE = 40_000

export type DocCriterii = { id: number; nume_original: string | null; tip?: string | null; are_text: boolean }
// relevante = după nume (fără fișă); cele fără text și cele peste plafon NU dispar în tăcere (Jakarinos r1 P1 #8)
export function selecteazaCriterii(docs: DocCriterii[], fisaId: number): { cu_text: number[]; fara_text: number[]; peste_plafon: number[] } {
  const rel = docs.filter((d) => Number(d.id) !== Number(fisaId) && RE_CRITERII.test(String(d.nume_original || '').replace(/[_]/g, ' ')))
    .sort((a, b) => Number(a.id) - Number(b.id))
  const cu = rel.filter((d) => d.are_text).map((d) => Number(d.id))
  return { cu_text: cu.slice(0, MAX_CRITERII_DOC), fara_text: rel.filter((d) => !d.are_text).map((d) => Number(d.id)), peste_plafon: cu.slice(MAX_CRITERII_DOC) }
}

// ── 2. autorizațiile de firmă ─────────────────────────────────────────────────────────────────────────
export type DocFirma = { id: number; denumire: string | null; tip: string | null; categorie?: string | null; data_valabilitate: string | null; fara_expirare: boolean | null }
export type StareFirma = 'valabil' | 'expirat' | 'valabilitate_necunoscuta'
export function stareDocFirma(d: DocFirma, ref: string): StareFirma {
  if (d.fara_expirare) return 'valabil'
  if (!d.data_valabilitate) return 'valabilitate_necunoscuta'   // ex. #14 „ET+EPI 2022 (versiune veche)” — nu se socotește
  return d.data_valabilitate >= ref ? 'valabil' : 'expirat'
}
// Documentele valabile AZI intră în listă; cele care expiră înainte de termenul de depunere sunt marcate (Jakarinos r1 P1 #2).
export function liniiFirma(docs: DocFirma[], azi: string, termen?: string | null): { linii: string[]; valabile: Map<number, DocFirma> } {
  const linii: string[] = [], valabile = new Map<number, DocFirma>()
  for (const d of [...docs].sort((a, b) => a.id - b.id)) {
    const st = stareDocFirma(d, azi)
    const pana = d.fara_expirare ? 'fără expirare' : d.data_valabilitate ? `până ${d.data_valabilitate}` : ''
    const expiraInainte = st === 'valabil' && !!termen && stareDocFirma(d, termen) !== 'valabil'
    const marcaj = st === 'valabil' ? `(${pana})${expiraInainte ? ` [EXPIRĂ ÎNAINTE DE TERMENUL ${termen}]` : ''}`
      : st === 'expirat' ? `[EXPIRAT ${d.data_valabilitate}] — nu se poate folosi` : '[VALABILITATE NECUNOSCUTĂ] — nu îndeplinește cerința'
    linii.push(`- #${d.id} ${d.denumire || d.tip || 'document'}${d.tip && d.denumire && !String(d.denumire).includes(String(d.tip)) ? ' [' + d.tip + ']' : ''} ${marcaj}`)
    if (st === 'valabil') valabile.set(d.id, d)
  }
  return { linii, valabile }
}

// Codurile unei autorizații de firmă / cerințe: tokenuri ANRE (2-5 majuscule, fără cuvinte comune) + „ISO nnnn”.
const NU_COD = new Set(['ANRE', 'SRL', 'SA', 'ISC', 'TIP', 'NR', 'SI', 'CU', 'DE', 'IN', 'LA', 'PE', 'AL', 'UE', 'RO', 'DN', 'PE', 'SDR', 'ID', 'CE'])
export function coduriAutorizatie(text: string): Set<string> {
  const t = String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  const s = new Set<string>()
  for (const m of t.matchAll(/\bISO\s*[-:]?\s*(\d{4,5})\b/gi)) s.add('ISO' + m[1])
  for (const m of t.matchAll(/(?:^|[^A-Za-z0-9])([A-Z]{2,5})(?=$|[^A-Za-z0-9])/g)) if (!NU_COD.has(m[1]) && m[1] !== 'ISO') s.add(m[1])
  return s
}

// Modelul întoarce "atestari_firma": [{cerinta, document_firma_id}]; codul verifică (Jakarinos r1 P1 #1, #2, #4):
//   - id-ul e al unui document VALABIL azi, și ACOPERĂ cerința: toate codurile cerinței (ET, ISO9001…) sunt în codurile documentului;
//   - cerință fără cod recunoscut = „neconfirmată” (nu „îndeplinită”);
//   - valabil azi dar expiră înainte de termen = „expiră înainte de termen” (nu verde).
export type RezAtestari = { neacoperite: string[]; neconfirmate: string[]; expira: string[] }
export function valideazaAtestariFirma(parsed: any, valabile: Map<number, DocFirma>, termen?: string | null): RezAtestari {
  const lista: any[] = Array.isArray(parsed.atestari_firma) ? parsed.atestari_firma.slice(0, 20) : []
  const rez: RezAtestari = { neacoperite: [], neconfirmate: [], expira: [] }
  parsed.atestari_firma = lista.map((a) => {
    const cerinta = String(a?.cerinta || '').trim().slice(0, 400)
    const cer = coduriAutorizatie(cerinta)
    const id = Number(a?.document_firma_id)
    const d = Number.isSafeInteger(id) ? valabile.get(id) : undefined
    if (!cer.size) {
      rez.neconfirmate.push(cerinta)
      return { cerinta, document_firma_id: d?.id ?? null, status: 'neconfirmata', sursa: 'cerința nu are un cod de autorizație recunoscut — de verificat de om' }
    }
    const docCod = d ? coduriAutorizatie(`${d.tip || ''} ${d.denumire || ''}`) : new Set<string>()
    if (!d || ![...cer].every((c) => docCod.has(c))) {
      rez.neacoperite.push(cerinta)
      return { cerinta, document_firma_id: null, status: 'neacoperita',
        sursa: d ? `documentul #${d.id} („${d.denumire || d.tip}”) nu acoperă ${[...cer].join(', ')}` : 'nicio autorizație de firmă valabilă în platformă pentru cerință (documente_firma)' }
    }
    const pana = d.fara_expirare ? 'fără expirare' : `până ${d.data_valabilitate}`
    if (termen && stareDocFirma(d, termen) !== 'valabil') {
      rez.expira.push(cerinta)
      return { cerinta, document_firma_id: d.id, status: 'expira_inainte_de_termen',
        sursa: `documente_firma #${d.id} „${d.denumire || d.tip}” (${pana}) — EXPIRĂ ÎNAINTE DE TERMENUL DE DEPUNERE ${termen}: de reînnoit / verificat` }
    }
    return { cerinta, document_firma_id: d.id, status: 'indeplinita', sursa: `îndeplinită prin documente_firma #${d.id} „${d.denumire || d.tip}” (${pana})` }
  })
  // „atestari” (textul) arată cerințe de firmă, dar lista structurată e goală = nimic verificat (Jakarinos r1 P1 #4)
  const txt = String(parsed.atestari || '').trim()
  if (!lista.length && txt && !/^(null|nu|niciuna|—|-)$/i.test(txt) && coduriAutorizatie(txt).size) rez.neconfirmate.push(txt.slice(0, 200))
  return rez
}

// ── 3. personalul: codurile ANRE ale fiecărei persoane + verificarea propunerii ─────────────────────────────
// valabil = valabil la TERMENUL DE DEPUNERE (sau azi, dacă termenul lipsește) — calculat de apelant (Jakarinos r1 P1 #2)
export type AutPers = { cine: string; tip: string; valabil: boolean }
export const normNume = (s: any) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()
export function coduriPePersoana(aut: AutPers[]): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>()
  for (const a of aut) {
    const k = normNume(a.cine)
    if (!m.has(k)) m.set(k, new Set())   // persoana există chiar fără cod valabil (contează la ambiguitate)
    if (!a.valabil) continue
    const c = codTip(a.tip); if (c) m.get(k)!.add(c)
  }
  return m
}
const prefixCuvinte = (scurt: string, lung: string) => { const x = scurt.split(' '), y = lung.split(' '); return x.length <= y.length && x.every((w, i) => y[i] === w) }
// Persoana din lista platformei: potrivire EXACTĂ întâi; un nume scurtat („TRUSU RAZVAN”) doar dacă există UN SINGUR candidat
// (Jakarinos r1 P1 #5: „POPESCU ION” vs „POPESCU ION VASILE”). Ambiguu sau negăsit = null.
export function rezolvaPersoana(nume: string, chei: Iterable<string>): string | null {
  const n = normNume(nume); if (!n) return null
  const toate = [...chei]
  if (toate.includes(n)) return n
  const cand = toate.filter((k) => prefixCuvinte(n, k))
  return cand.length === 1 ? cand[0] : null
}
export function aceeasiPersoana(a: string, b: string): boolean {
  const x = normNume(a), y = normNume(b)
  return !!x && !!y && (x === y || prefixCuvinte(x, y) || prefixCuvinte(y, x))
}

// Decizia #1727 pct. 3: pe rolul de persoană EGT se propune de principiu TRUȘU RĂZVAN sau STĂNESCU SILVIU.
export const PREFERINTE_COD: Record<string, string[]> = { EGT: ['TRUSU RAZVAN', 'STANESCU SILVIU'] }
// codurile de persoană recunoscute în textul unei cerințe de rol (pentru cerințele fără "autorizatie_ceruta" — r1 P1 #4)
const RE_COD_PERS = /\b(EGT|EGD|EGIU|PGT|PGD|PGIU)\b/

// Pe fiecare rol cu "autorizatie_ceruta" (cod ANRE literal), propunerea trebuie să aibă codul literal sau o echivalență APROBATĂ.
// Rolurile repartizate din matrice nu se schimbă; preferința nu mută o persoană deja propusă pe ALT rol (r1 P1 #6 — cumul ascuns).
// Întoarce rolurile cu probleme (pentru avertismente + verdict, r1 P1 #3).
export function verificaAutorizatiiRoluri(parsed: any, coduri: Map<string, Set<string>>, preferinte = PREFERINTE_COD): string[] {
  const roluri: any[] = Array.isArray(parsed.roluri) ? parsed.roluri : []
  const probleme: string[] = []
  const chei = [...coduri.keys()]
  const coduriLui = (nume: string) => { const k = rezolvaPersoana(nume, chei); return k ? coduri.get(k)! : null }
  for (const r of roluri) {
    let cerut = String(r?.autorizatie_ceruta || '').trim().toUpperCase()
    if (cerut && !/^[A-Z]{2,6}$/.test(cerut)) cerut = ''
    if (!cerut) {
      // cerința rolului pomenește un cod de persoană, dar modelul n-a completat câmpul structurat → neconfirmat, nu sărit
      const m = RE_COD_PERS.exec(String(r?.cerinte || '').toUpperCase())
      if (m && r?.propunere) { r.validare_autorizatie = 'neconfirmata'; r.autorizatie_ceruta = m[1]; probleme.push(`${r.rol}: ${m[1]} necompletat structurat`) }
      if (!m) continue
      cerut = m[1]
    }
    const dinMatrice = Number.isFinite(r.puncte_conditionat)
    const pref = (preferinte[cerut] || []).find((p) => { const c = coduriLui(p); return !!c && acoperaCod(c, cerut).acoperit })
    const prefDejaAltundeva = pref && roluri.some((o) => o !== r && o.propunere && aceeasiPersoana(o.propunere, pref))
    const propusaEPreferata = !!r.propunere && (preferinte[cerut] || []).some((p) => aceeasiPersoana(p, r.propunere))
    if (!dinMatrice && pref && !propusaEPreferata) {
      if (prefDejaAltundeva) r.motiv = `[Preferința pe ${cerut} (${pref}) NU s-a aplicat: persoana e deja propusă pe alt rol.] ` + String(r.motiv || '')
      else {
        const vechi = r.propunere
        r.propunere = pref
        r.motiv = `[Preferință Răzvan pe ${cerut}] ${pref}${vechi ? ` în locul propunerii AI (${vechi})` : ''}. ` + String(r.motiv || '')
      }
    }
    if (!r.propunere) continue
    const c = coduriLui(r.propunere)
    if (!c) {
      r.validare_autorizatie = 'persoana_nerezolvata'
      r.motiv = `ATENȚIE: „${r.propunere}” nu se identifică unic în lista de personal (nume ambiguu sau absent) — autorizația ${cerut} neverificată. ` + String(r.motiv || '')
      probleme.push(`${r.rol}: ${r.propunere} neidentificat unic`); continue
    }
    const ac = acoperaCod(c, cerut)
    if (r.validare_autorizatie !== 'neconfirmata') r.validare_autorizatie = ac.acoperit ? (ac.prin === 'literal' ? 'cod_literal' : 'echivalenta_aprobata') : 'echivalenta_nevalidata'
    if (!ac.acoperit) {
      r.motiv = `ATENȚIE: ${r.propunere} nu are în platformă autorizația ${cerut} valabilă la termen și nicio echivalență APROBATĂ nu o acoperă — de verificat (nu e confirmat). ` + String(r.motiv || '')
      probleme.push(`${r.rol}: ${r.propunere} fără ${cerut}`)
    } else if (ac.prin === 'echivalenta') {
      r.motiv = `[Echivalență aprobată ${ac.cod} → ${cerut}] ` + String(r.motiv || '')
    }
  }
  return probleme
}

// ── 4. bonusul din barem (ex. +2 p pentru certificat de curs „Manager de proiect”, Botoșani factor 2) ─────────
// Condiția trebuie RECUNOSCUTĂ explicit în textul bonusului (r1 P1 #7 — rolul canonic nu o înlocuiește). Recunoscut azi: certificatul
// de curs de manager de proiect. Bonusul intră în OPTIMIZAREA echipei (r1 P1 #8): index.ts trimite bonusPersoana în repartizare.
export const RE_CERT_MANAGER = /manager\s*(de\s*)?proiect|project\s*manager/i
export function conditieBonusRecunoscuta(conditie: string): 'cert_manager_proiect' | null {
  return RE_CERT_MANAGER.test(String(conditie || '')) && /certificat|curs|atestat|diplom/i.test(String(conditie || '')) ? 'cert_manager_proiect' : null
}
export function areCertManager(aut: AutPers[], nume: string): boolean {
  const chei = [...new Set(aut.map((a) => normNume(a.cine)))]
  const k = rezolvaPersoana(nume, chei)
  return !!k && aut.some((a) => a.valabil && normNume(a.cine) === k && RE_CERT_MANAGER.test(a.tip))
}
// bonusul (puncte) al unei persoane pe un rol — 0 dacă rolul n-are bonus recunoscut sau persoana n-are certificatul
export function bonusPersoana(r: any, persoana: string, aut: AutPers[]): number {
  const b = r?.barem?.bonus, puncte = Number(b?.puncte)
  if (!b || !Number.isFinite(puncte) || puncte <= 0) return 0
  return conditieBonusRecunoscuta(b.conditie) === 'cert_manager_proiect' && areCertManager(aut, persoana) ? puncte : 0
}
// Adnotarea pe rol, după repartizare (punctele sunt deja în totaluri dacă rolul a fost repartizat din matrice).
export function adnoteazaBonus(parsed: any, aut: AutPers[]): void {
  for (const r of (Array.isArray(parsed.roluri) ? parsed.roluri : []) as any[]) {
    const b = r?.barem?.bonus, puncte = Number(b?.puncte)
    if (!b || !Number.isFinite(puncte) || puncte <= 0) continue
    const conditie = String(b.conditie || '').slice(0, 200)
    const recunoscuta = conditieBonusRecunoscuta(conditie)
    const acordat = !!r.propunere && bonusPersoana(r, r.propunere, aut) > 0
    r.bonus = { puncte, conditie, acordat, recunoscuta: !!recunoscuta }
    if (!r.propunere) continue
    r.motiv = String(r.motiv || '') + (acordat ? ` +${puncte} p bonus (${conditie} — găsit în platformă).`
      : !recunoscuta ? ` +${puncte} p bonus pe condiția „${conditie}” — condiție nerecunoscută de cod, de verificat de om.`
      : ` +${puncte} p POSIBIL dacă ${r.propunere} prezintă ${conditie} — nu e în platformă.`)
  }
}
