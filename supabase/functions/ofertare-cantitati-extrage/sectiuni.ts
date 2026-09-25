// Secțiunile unei LISTE DE CANTITĂȚI după antetul formularului (F3 / C6 / C7–C9) și feliile pe secțiuni.
// Funcții pure, testate în sectiuni_test.ts (fără rețea, fără BD).
//
// De ce (25.09.2026, Jilava lic. 93, doc 434 „…LST-002-00-R Cantitati de lucrari.pdf"): un singur PDF
// conține cele 26 de liste F3 (pag. 10–75) ȘI anexele C6 „Lista cuprinzand consumurile de resurse
// materiale" (pag. 76–80), C7 manoperă (81), C8 utilaje (82), C9 transport (83). Handlerul punea
// tip_sursa='lista_f3' pe TOATE rândurile unui document lista_cantitati, deci consumurile C6 ar fi intrat
// în suma F3 (v_ofertare_pt_stare.lista_f3_m), lista_c6_m ar fi rămas NULL, iar controlul F3↔C6
// (controlCantitati, src/ofertareControale.js) ar fi comparat F3+C6 cu nimic.
//
// Regula: tipul se decide în COD, din antetele din textul documentului — nu din ce răspunde modelul.
// Valorile sunt cele permise de ofertare_cantitati_tip_sursa_check și folosite deja pe Domnești (lic. 5):
//   F3 → 'lista_f3' (referința de decontare), C6 → 'lista_c6' (control), C7/C8/C9 → 'lista_alt'.
// Feliile nu mai trec peste o graniță de secțiune, ca fiecare felie să aibă UN singur tip.
// Un document fără niciun antet se comportă exact ca înainte: o secțiune 'lista_f3', aceleași felii.

export type TipLista = 'lista_f3' | 'lista_c6' | 'lista_alt'
export type Sectiune = { de: number; pana: number; tip: TipLista }

export const FELIE = 55000        // caractere per apel — sub pragul unde se pierde mijlocul
export const SUPRAPUNERE = 2000   // ca un tabel rupt între felii să nu dispară

// Antetele formularelor (eDevize / HG 907). Atât „Formular Xn" (antet + subsol de pagină), cât și titlul
// listei, cu/fără diacritice. (?!\d) ca „C 60" să nu fie C6.
const ANTETE: { tip: TipLista; re: RegExp }[] = [
  { tip: 'lista_f3', re: /Formular\s*F\s*3(?!\d)|Lista\s+cu\s+cantit[aăâ][tțţ]i\s+de\s+lucr[aăâ]ri/gi },
  { tip: 'lista_c6', re: /Formular\s*C\s*6(?!\d)|Lista\s+cuprinz[aâă]nd\s+consumurile\s+de\s+resurse\s+materiale/gi },
  { tip: 'lista_alt', re: /Formular\s*C\s*[789](?!\d)|Lista\s+cuprinz[aâă]nd\s+consumurile\s+(?:cu\s+m[aâă]n|de\s+ore|privind\s+transport)/gi },
]
const PAGINA = '⟦PAGINA'   // marcajul de pagină pus de citirea OCR (ofertare-ingest-doc)

// Ultimul antet întâlnit decide secțiunea. Textul dinaintea primului antet (copertă, deviz general)
// ține de primul formular. Granița se pune la începutul PAGINII pe care apare antetul nou (antetul
// poate fi doar în subsolul primei pagini a formularului), dacă textul are marcaje de pagină.
export function sectiuniLista(t: string): Sectiune[] {
  const marc: { poz: number; tip: TipLista }[] = []
  for (const a of ANTETE) for (const m of t.matchAll(a.re)) marc.push({ poz: m.index ?? 0, tip: a.tip })
  marc.sort((x, y) => x.poz - y.poz)
  if (!marc.length) return [{ de: 0, pana: t.length, tip: 'lista_f3' }]
  const s: Sectiune[] = [{ de: 0, pana: t.length, tip: marc[0].tip }]
  for (const m of marc) {
    const cur = s[s.length - 1]
    if (m.tip === cur.tip) continue
    const pag = t.lastIndexOf(PAGINA, m.poz)
    const de = pag > cur.de ? pag : m.poz
    cur.pana = de
    s.push({ de, pana: t.length, tip: m.tip })
  }
  return s
}

// Feliile unui text (neschimbat față de varianta din handler.ts).
export function felii(t: string): string[] {
  if (t.length <= FELIE) return [t]
  const out: string[] = []
  for (let i = 0; i < t.length; i += FELIE - SUPRAPUNERE) out.push(t.slice(i, i + FELIE))
  return out
}

export type FelieDoc = { bucata: string; nr: number; din: number; tipSursa: TipLista | null; inceputSectiune: boolean }

// Feliile unui document. Doar lista_cantitati primește tip_sursa (pe secțiuni); celelalte tipuri
// (cs_volum, alta) rămân ca înainte: tot textul feliat, fără tip_sursa.
// nr = numărul feliei în document (1..din), continuu peste secțiuni — intră în `ordine` (nr*100000+idx).
export function feliiDocument(text: string, tipDoc: string): FelieDoc[] {
  const sect: { text: string; tip: TipLista | null }[] = tipDoc === 'lista_cantitati'
    ? sectiuniLista(text).map((s) => ({ text: text.slice(s.de, s.pana), tip: s.tip }))
    : [{ text, tip: null }]
  const out: FelieDoc[] = []
  for (const s of sect) felii(s.text).forEach((b, i) => out.push({ bucata: b, nr: 0, din: 0, tipSursa: s.tip, inceputSectiune: i === 0 }))
  out.forEach((f, i) => { f.nr = i + 1; f.din = out.length })
  return out
}
