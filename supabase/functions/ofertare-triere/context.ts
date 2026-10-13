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
// Copilot r1 P1: expresia JS e ACEEAȘI cu filtrul SQL (ilike cu %), ca nimic adus de SQL să nu dispară la clasificare.
export const RE_CRITERII = /criteri|detaliere|factor.*evaluare|algoritm.*calcul/i
export const SQL_CRITERII = 'nume_original.ilike.%criteri%,nume_original.ilike.%detaliere%,nume_original.ilike.%factor%evaluare%,nume_original.ilike.%algoritm%calcul%'
export const MAX_CRITERII_DOC = 3
export const LIMITA_CANDIDATI_CRITERII = 20   // SQL cere LIMITA+1: al 21-lea rând = trunchiere raportată
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
// Valabilitatea se judecă la TERMENUL DE DEPUNERE (și la o re-triere după termen — Jakarinos r3 P2, Copilot r2 P2); fără termen, azi.
// `valabile` = valabile la termen; `expiraInainte` = valabile azi dar NU la termen (cerința nu e îndeplinită, motivul e specific).
export function liniiFirma(docs: DocFirma[], azi: string, termen?: string | null):
  { linii: string[]; valabile: Map<number, DocFirma>; expiraInainte: Map<number, DocFirma> } {
  const ref = termen ?? azi
  const linii: string[] = [], valabile = new Map<number, DocFirma>(), expiraInainte = new Map<number, DocFirma>()
  for (const d of [...docs].sort((a, b) => a.id - b.id)) {
    const st = stareDocFirma(d, ref), stAzi = stareDocFirma(d, azi)
    const pana = d.fara_expirare ? 'fără expirare' : d.data_valabilitate ? `până ${d.data_valabilitate}` : ''
    const exp = st !== 'valabil' && stAzi === 'valabil'
    const marcaj = st === 'valabil' ? `(${pana})` : exp ? `(${pana}) [EXPIRĂ ÎNAINTE DE TERMENUL ${ref}] — nu îndeplinește cerința la termen`
      : st === 'expirat' ? `[EXPIRAT ${d.data_valabilitate}${termen ? ` — la termenul ${ref}` : ''}] — nu se poate folosi` : '[VALABILITATE NECUNOSCUTĂ] — nu îndeplinește cerința'
    linii.push(`- #${d.id} ${d.denumire || d.tip || 'document'}${d.tip && d.denumire && !String(d.denumire).includes(String(d.tip)) ? ' [' + d.tip + ']' : ''} ${marcaj}`)
    if (st === 'valabil') valabile.set(d.id, d)
    else if (exp) expiraInainte.set(d.id, d)
  }
  return { linii, valabile, expiraInainte }
}

// Codurile unei autorizații de firmă / cerințe: tokenuri ANRE (2-5 majuscule, fără cuvinte comune) + „ISO nnnn”.
const NU_COD = new Set(['ANRE', 'SRL', 'SA', 'TIP', 'NR', 'SI', 'CU', 'DE', 'IN', 'LA', 'PE', 'AL', 'UE', 'RO', 'DN', 'PE', 'SDR', 'ID', 'CE'])
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
// segmentele unei enumerări de cerințe („ANRE ET, ISO 9001 și autorizație ISC”) — fiecare trebuie verificat separat (Copilot r2 P1 #2)
export function segmenteCerinte(text: string): string[] {
  return String(text || '').split(/[;,\n]|\s+(?:și|si|plus)\s+|\s\+\s/i).map((s) => s.trim()).filter((s) => s.length >= 2)
}
export function valideazaAtestariFirma(parsed: any, valabile: Map<number, DocFirma>, termen?: string | null,
  expiraInainte: Map<number, DocFirma> = new Map()): RezAtestari {
  const brut: any[] = Array.isArray(parsed.atestari_firma) ? parsed.atestari_firma : []
  const lista = brut.slice(0, 20)
  const rez: RezAtestari = { neacoperite: [], neconfirmate: [], expira: [] }
  if (brut.length > 20) rez.neconfirmate.push(`${brut.length - 20} cerințe de firmă peste plafonul de 20 — neverificate`)
  parsed.atestari_firma = lista.map((a) => {
    // codurile pe textul INTEGRAL; tăierea doar pentru afișare (Jakarinos r3 P1 #1)
    const integral = String(a?.cerinta || '').trim()
    const cerinta = integral.slice(0, 400)
    const cer = coduriAutorizatie(integral)
    const id = Number(a?.document_firma_id)
    const d = Number.isSafeInteger(id) ? valabile.get(id) : undefined
    const dExp = Number.isSafeInteger(id) ? expiraInainte.get(id) : undefined
    if (!cer.size) {
      rez.neconfirmate.push(cerinta)
      return { cerinta, document_firma_id: d?.id ?? null, status: 'neconfirmata', sursa: 'cerința nu are un cod de autorizație recunoscut — de verificat de om' }
    }
    if (!d && dExp && [...cer].every((c) => coduriAutorizatie(`${dExp.tip || ''} ${dExp.denumire || ''}`).has(c))) {
      rez.expira.push(cerinta)
      return { cerinta, document_firma_id: dExp.id, status: 'expira_inainte_de_termen',
        sursa: `documente_firma #${dExp.id} „${dExp.denumire || dExp.tip}” (până ${dExp.data_valabilitate}) — EXPIRĂ ÎNAINTE DE TERMENUL DE DEPUNERE ${termen}: de reînnoit / verificat` }
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
  // COMPLETITUDINEA (Jakarinos r1 P1 #4, r2 P1 #1, Copilot r1 P1 #2): textul „atestari” e sursa cerințelor de firmă; fiecare cod
  // recunoscut în el trebuie să apară în lista structurată, iar un text fără niciun cod recunoscut nu se poate verifica — neconfirmat.
  const txt = String(parsed.atestari || '').trim()
  if (txt && !/^(null|nu|niciuna|nu e cazul|—|-)\.?$/i.test(txt)) {
    const dinLista = new Set<string>(); for (const a of lista) for (const c of coduriAutorizatie(String(a?.cerinta || ''))) dinLista.add(c)
    // fiecare SEGMENT al enumerării: fără cod recunoscut = neconfirmat; cu cod absent din lista structurată = neconfirmat
    for (const seg of segmenteCerinte(txt)) {
      const c = coduriAutorizatie(seg)
      if (!c.size) rez.neconfirmate.push(`„${seg.slice(0, 160)}” — fără cod recunoscut, de verificat de om`)
      else { const lipsa = [...c].filter((x) => !dinLista.has(x)); if (lipsa.length) rez.neconfirmate.push(`${lipsa.join(', ')} (din „${seg.slice(0, 160)}”) — lipsă din verificarea structurată`) }
    }
  }
  return rez
}

// ── 3. personalul: codurile ANRE ale fiecărei persoane + verificarea propunerii ─────────────────────────────
// valabil = valabil la TERMENUL DE DEPUNERE (sau azi, dacă termenul lipsește) — calculat de apelant (Jakarinos r1 P1 #2)
// titular = identitatea stabilă (e<employee_id> / x<extern_id>) — două persoane cu același nume NU se comasează (Copilot r1 P1 #4)
export type AutPers = { cine: string; tip: string; valabil: boolean; titular?: string }
export type Pers = { coduri: Set<string>; titulari: Set<string> }
export const normNume = (s: any) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()
export function coduriPePersoana(aut: AutPers[]): Map<string, Pers> {
  const m = new Map<string, Pers>()
  for (const a of aut) {
    const k = normNume(a.cine)
    if (!m.has(k)) m.set(k, { coduri: new Set(), titulari: new Set() })   // există chiar fără cod valabil (contează la ambiguitate)
    m.get(k)!.titulari.add(a.titular || k)
    if (!a.valabil) continue
    const c = codTip(a.tip); if (c) m.get(k)!.coduri.add(c)
  }
  return m
}
const prefixCuvinte = (scurt: string, lung: string) => { const x = scurt.split(' '), y = lung.split(' '); return x.length <= y.length && x.every((w, i) => y[i] === w) }
// Persoana din lista platformei: potrivire EXACTĂ întâi; un nume scurtat („TRUSU RAZVAN”) doar dacă există UN SINGUR candidat
// (Jakarinos r1 P1 #5: „POPESCU ION” vs „POPESCU ION VASILE”). Ambiguu sau negăsit = null.
export function rezolvaPersoana(nume: string, pers: Map<string, Pers>): string | null {
  const n = normNume(nume); if (!n) return null
  const unic = (k: string) => (pers.get(k)?.titulari.size ?? 0) === 1   // omonimi = ambiguu
  if (pers.has(n)) return unic(n) ? n : null
  const cand = [...pers.keys()].filter((k) => prefixCuvinte(n, k))
  return cand.length === 1 && unic(cand[0]) ? cand[0] : null
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
export function verificaAutorizatiiRoluri(parsed: any, pers: Map<string, Pers>, preferinte = PREFERINTE_COD): string[] {
  const roluri: any[] = Array.isArray(parsed.roluri) ? parsed.roluri : []
  const probleme: string[] = []
  const coduriLui = (nume: string) => { const k = rezolvaPersoana(nume, pers); return k ? pers.get(k)!.coduri : null }
  for (const r of roluri) {
    let cerut = String(r?.autorizatie_ceruta || '').trim().toUpperCase()
    if (cerut && !/^[A-Z]{2,6}$/.test(cerut)) cerut = ''
    if (!cerut) {
      // cerința rolului pomenește un cod de persoană, dar modelul n-a completat câmpul structurat → neconfirmat, nu sărit
      const txtCer = String(r?.cerinte || '')
      const m = RE_COD_PERS.exec(txtCer.toUpperCase())
      if (!m) {
        // cerință de autorizare de persoană fără cod recunoscut (ex. un cod NOU) — nu se sare în tăcere, nici nu se ghicește codul
        if (/\banre\b|legitima[tț]i|autoriza[tț]i/i.test(txtCer)) {
          r.validare_autorizatie = 'neconfirmata'
          r.motiv = 'ATENȚIE: cerința rolului pomenește o autorizare ANRE de persoană fără cod structurat — de verificat de om. ' + String(r.motiv || '')
          probleme.push(`${r.rol}: cerință ANRE de persoană nestructurată`)
        }
        continue
      }
      r.validare_autorizatie = 'neconfirmata'; r.autorizatie_ceruta = m[1]; probleme.push(`${r.rol}: ${m[1]} necompletat structurat`)
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
    if (!r.propunere) {   // autorizație cerută, nimeni propus — verificabil determinist (Jakarinos r2 P1 #3, Copilot r1 P1 #3)
      if (r.validare_autorizatie !== 'neconfirmata') r.validare_autorizatie = 'fara_persoana'
      r.motiv = `ATENȚIE: rolul cere ${cerut} și nu e propus nimeni care să-l aibă în platformă. ` + String(r.motiv || '')
      probleme.push(`${r.rol}: nimeni propus pentru ${cerut}`); continue
    }
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
// Recunoscută DOAR condiția simplă, pe LISTĂ ALBĂ (Jakarinos r2 P1 #2, r3 P1 #2): toate cuvintele condiției trebuie să fie din
// vocabularul certificatului de curs de manager de proiect (formularea tipică din fișe, ex. Botoșani 522). Orice cuvânt în plus
// (alt certificat — BIM, Scrum, PMP —, ani de experiență, „și”, cifre) = nerecunoscută: bonus neacordat automat, de verificat de om.
const VOCABULAR_BONUS = new Set(('certificat certificatul certificate eliberat emis de un o catre furnizor furnizorul formare profesionala ' +
  'acreditat acreditata autorizat care atesta ca acesta aceasta a urmat urmarea absolvirea absolvire cursuri cursul curs de specializare ' +
  'pentru ocupatia ocupatiei manager managerul proiect proiecte al in domeniul privind cu').split(' '))
export function conditieBonusRecunoscuta(conditie: string): 'cert_manager_proiect' | null {
  const c = String(conditie || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  if (!RE_CERT_MANAGER.test(c) || !/certificat|curs/.test(c)) return null
  const cuvinte = c.split(/[^a-z0-9]+/).filter(Boolean)
  return cuvinte.every((w) => VOCABULAR_BONUS.has(w)) ? 'cert_manager_proiect' : null
}
export function areCertManager(aut: AutPers[], nume: string): boolean {
  const k = rezolvaPersoana(nume, coduriPePersoana(aut))
  return !!k && aut.some((a) => a.valabil && normNume(a.cine) === k && RE_CERT_MANAGER.test(a.tip))
}
// bonusul (puncte) al unei persoane pe un rol — 0 dacă rolul n-are bonus recunoscut sau persoana n-are certificatul
export function bonusPersoana(r: any, persoana: string, aut: AutPers[]): number {
  const b = r?.barem?.bonus, puncte = Number(b?.puncte)
  if (!b || !Number.isFinite(puncte) || puncte <= 0) return 0
  return conditieBonusRecunoscuta(b.conditie) === 'cert_manager_proiect' && areCertManager(aut, persoana) ? puncte : 0
}
// Adnotarea pe rol, după repartizare. „Acordat” = exact ce a intrat în totaluri: rol repartizat din matrice, cu punctaj pozitiv
// (Jakarinos r2 P2). Întoarce problemele (condiție nerecunoscută) pentru avertismente (Copilot r1 P2).
export function adnoteazaBonus(parsed: any, aut: AutPers[]): string[] {
  const probleme: string[] = []
  for (const r of (Array.isArray(parsed.roluri) ? parsed.roluri : []) as any[]) {
    const b = r?.barem?.bonus, puncte = Number(b?.puncte)
    if (!b || !Number.isFinite(puncte) || puncte <= 0) continue
    const conditie = String(b.conditie || '').slice(0, 200)   // doar pentru afișare
    const recunoscuta = conditieBonusRecunoscuta(String(b.conditie || ''))
    const punctat = Number.isFinite(r.puncte_conditionat) && r.puncte_conditionat > 0
    const acordat = !!r.propunere && punctat && bonusPersoana(r, r.propunere, aut) > 0
    r.bonus = { puncte, conditie, acordat, recunoscuta: !!recunoscuta }
    if (!recunoscuta) probleme.push(`${r.rol}: bonus +${puncte} p pe condiția „${conditie}” nerecunoscută de cod`)
    if (!r.propunere) continue
    r.motiv = String(r.motiv || '') + (acordat ? ` +${puncte} p bonus (${conditie} — găsit în platformă, inclus în punctaj).`
      : !recunoscuta ? ` +${puncte} p bonus pe condiția „${conditie}” — condiție nerecunoscută de cod, de verificat de om.`
      : !punctat ? ` +${puncte} p bonus doar pe un punctaj pozitiv calculat din matrice — aici nu se aplică.`
      : ` +${puncte} p POSIBIL dacă ${r.propunere} prezintă ${conditie} — nu e în platformă.`)
  }
  return probleme
}
