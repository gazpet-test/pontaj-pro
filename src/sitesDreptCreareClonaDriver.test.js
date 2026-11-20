// PR #1089 runda 7: driverul probei pe clonă (supabase/tests/20261222a_sites_drept_creare_clona.sh), test STATIC.
// Proba pe clona 176 (20.11.2026) a trecut doar cu o copie locală reparată în 3 locuri; aici se fixează cele 3 reparații în driverul din repo:
//   (1) runner-ul pornește fără variabile PG* în mediu (refuza PGDATABASE, cod 2), doar PGPASSFILE rămâne;
//   (2) afișarea triggerelor: tgenabled ("char") concatenat cu ::text (altfel „operator is not unique: text || "char"”);
//   (3) curățenia șterge și magazia deschisă automat (trg_magazie_auto) pentru proiectul comis în P5, înaintea proiectului.
// Fiecare verificare e o funcție aplicată pe driverul real (trebuie să treacă) și pe mutanți cu forma veche (trebuie să pice).
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'

const citeste = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r/g, '')
const DRIVER = citeste('supabase/tests/20261222a_sites_drept_creare_clona.sh')

// corpul unei funcții bash `nume() {` … prima linie `}` de la începutul rândului
const corpFunctie = (src, nume) => {
  const i = src.indexOf(`\n${nume}() {`)
  if (i < 0) return null
  const j = src.indexOf('\n}\n', i)
  return j < 0 ? null : src.slice(i, j + 3)
}

// (1) mediul runner-ului
const mediuRunnerCurat = src => {
  const livreaza = corpFunctie(src, 'livreaza')
  if (!livreaza) return false
  // orice apel al runner-ului din tot driverul trece prin "${FARA_PG[@]}"
  const apeluri = src.match(/[^\n]*bash "\$RUNNER"[^\n]*/g) || []
  if (apeluri.length !== 1 || !livreaza.includes(apeluri[0])) return false
  if (!/R_OUT="\$\("\$\{FARA_PG\[@\]\}" bash "\$RUNNER" /.test(apeluri[0])) return false
  // FARA_PG = env + -u pe fiecare variabilă exportată care începe cu PG, în afară de PGPASSFILE
  if (!src.includes('\nFARA_PG=(env)\n')) return false
  if (!src.includes(`\nwhile IFS= read -r v; do [ "$v" = PGPASSFILE ] || FARA_PG+=(-u "$v"); done < <(compgen -e | grep '^PG' || true)\n`)) return false
  // driverul nu exportă el însuși variabile PG* și refuză ce ar refuza runner-ul (în afară de PGDATABASE, scoasă la apel)
  if (/^\s*export\s+PG/m.test(src) || /^\s*PG[A-Z]*=/m.test(src)) return false
  const refuzate = src.match(/\nfor v in (PGPASSWORD [A-Z ]+); do\n  \[ -z "\$\{!v\+x\}" \] \|\| refuz /)
  if (!refuzate) return false
  const lista = refuzate[1].trim().split(/\s+/)
  return ['PGPASSWORD', 'PGOPTIONS', 'PSQLRC', 'PGHOSTADDR', 'PGTARGETSESSIONATTRS', 'PGLOADBALANCEHOSTS', 'PGSERVICE', 'PGSERVICEFILE', 'PGSYSCONFDIR']
    .every(v => lista.includes(v))
}

// (2) tgenabled e "char": la concatenare cere ::text
const tgenabledText = src => {
  if (/\|\|\s*(?:\w+\.)?tgenabled(?!::text)/.test(src)) return false
  if (/(?:\w+\.)?tgenabled(?!::text)\s*\|\|/.test(src)) return false
  return src.includes("' | ' || tgenabled::text FROM pg_trigger WHERE tgrelid = 'public.executie_proiecte'::regclass")
}

// (3) curățenia: magazia automată a proiectului de probă, înaintea șantierelor și a proiectului, + verificarea că nu a rămas nimic
const curateniaMagaziei = src => {
  const c = corpFunctie(src, 'curatenie')
  if (!c) return false
  const delMag = c.indexOf("DELETE FROM public.magazii WHERE tip = 'santier' AND denumire LIKE 'TEST 20261222A%'\n" +
    "      AND (executie_proiect_id IS NULL OR executie_proiect_id IN (SELECT id FROM public.executie_proiecte WHERE nume LIKE 'TEST 20261222A%'));")
  const delSites = c.indexOf("DELETE FROM public.sites WHERE name LIKE 'TEST 20261222A%';")
  const delProi = c.indexOf("DELETE FROM public.executie_proiecte WHERE nume LIKE 'TEST 20261222A%';")
  const verif = c.indexOf("OR EXISTS (SELECT 1 FROM public.magazii WHERE denumire LIKE 'TEST 20261222A%') THEN")
  const commit = c.indexOf('COMMIT;"', verif)
  // o singură ștergere de magazii, doar cea cu prefixul de probă
  if ((c.match(/DELETE FROM public\.magazii/g) || []).length !== 1) return false
  return delMag >= 0 && delSites > delMag && delProi > delSites && verif > delProi && commit > verif
}

describe('20261222a — driverul probei pe clonă (runda 7, după proba pe clona 176)', () => {
  it('(1) runner-ul pornește fără PG* în mediu (doar PGPASSFILE); driverul refuză variabilele pe care le-ar refuza runner-ul', () => {
    expect(mediuRunnerCurat(DRIVER)).toBe(true)
    // mutantul = driverul de la 33984e3b (apel direct, același mediu ca driverul)
    expect(mediuRunnerCurat(DRIVER.replace('R_OUT="$("${FARA_PG[@]}" bash "$RUNNER" ', 'R_OUT="$(bash "$RUNNER" '))).toBe(false)
    // PGPASSFILE scos și el, sau excepția lărgită la toate PG*
    expect(mediuRunnerCurat(DRIVER.replace('[ "$v" = PGPASSFILE ] || FARA_PG+=', '[ "$v" = PGDATABASE ] || FARA_PG+='))).toBe(false)
    expect(mediuRunnerCurat(DRIVER.replace("grep '^PG' || true", "grep '^PGHOST$' || true"))).toBe(false)
    // al doilea apel al runner-ului, ocolind lista
    expect(mediuRunnerCurat(DRIVER.replace('\n# ── P1 baseline', '\nbash "$RUNNER" --migrare x\n# ── P1 baseline'))).toBe(false)
    // driverul exportă el o variabilă PG*
    expect(mediuRunnerCurat(DRIVER.replace('\nUUID_RE=', '\nexport PGDATABASE=postgres\nUUID_RE='))).toBe(false)
    expect(mediuRunnerCurat(DRIVER.replace('for v in PGPASSWORD PGOPTIONS PSQLRC ', 'for v in PGPASSWORD PGOPTIONS '))).toBe(false)
  })

  it('(2) afișarea triggerelor: tgenabled::text', () => {
    expect(tgenabledText(DRIVER)).toBe(true)
    expect(tgenabledText(DRIVER.replace("' | ' || tgenabled::text FROM", "' | ' || tgenabled FROM"))).toBe(false)
    expect(tgenabledText(DRIVER.replace('\nmd5_auto() {', "\nq \"SELECT tg.tgenabled || 'x' FROM pg_trigger tg\"\nmd5_auto() {"))).toBe(false)
    // comparația cu 'O' din controalele P1 rămâne (nu e concatenare)
    expect(DRIVER).toContain("tg.tgenabled = 'O'")
  })

  it('(3) curățenia: magazia automată (trg_magazie_auto) a proiectului din P5 se șterge înaintea proiectului, apoi nimic TEST 20261222A nu rămâne', () => {
    expect(curateniaMagaziei(DRIVER)).toBe(true)
    const fara = DRIVER.replace(/\n    DELETE FROM public\.magazii WHERE tip = 'santier'[^\n]*\n[^\n]*\n/, '\n')
    expect(fara).not.toBe(DRIVER)
    expect(curateniaMagaziei(fara)).toBe(false)
    // magazia ștearsă DUPĂ proiect (forma care a lăsat magazii cu executie_proiect_id NULL)
    const mag = DRIVER.match(/\n    DELETE FROM public\.magazii WHERE tip = 'santier'[^\n]*\n[^\n]*\n/)[0]
    const dupa = fara.replace("    DELETE FROM public.executie_proiecte WHERE nume LIKE 'TEST 20261222A%';\n",
      "    DELETE FROM public.executie_proiecte WHERE nume LIKE 'TEST 20261222A%';" + mag)
    expect(dupa).not.toBe(fara)
    expect(curateniaMagaziei(dupa)).toBe(false)
    // filtrul lărgit (orice magazie de șantier)
    expect(curateniaMagaziei(DRIVER.replace("DELETE FROM public.magazii WHERE tip = 'santier' AND denumire LIKE 'TEST 20261222A%'", "DELETE FROM public.magazii WHERE tip = 'santier'"))).toBe(false)
    // fără verificarea finală pe magazii
    expect(curateniaMagaziei(DRIVER.replace("OR EXISTS (SELECT 1 FROM public.magazii WHERE denumire LIKE 'TEST 20261222A%') THEN", 'THEN'))).toBe(false)
  })

  it('livrarea: L15 v1 cu plafon 2000, fără amprenta globală și fără listă .l15.obiecte.tsv / manifest .l15.tsv', () => {
    const livreaza = corpFunctie(DRIVER, 'livreaza')
    expect(livreaza).toContain('--plafon-tranzactie-ms 2000')
    expect(livreaza).not.toMatch(/--amprenta-globala|--diferente-globale/)
    expect(DRIVER).toContain('20261222a e o migrare L15 v1')
    const teste = readdirSync(new URL('../supabase/tests/', import.meta.url))
    expect(teste.filter(f => /^20261222a_.*\.l15\.(obiecte\.)?tsv$/.test(f))).toEqual([])
    const mig = readdirSync(new URL('../supabase/migrations/', import.meta.url))
    expect(mig.filter(f => /^20261222a_.*\.l15/.test(f))).toEqual([])
  })
})
