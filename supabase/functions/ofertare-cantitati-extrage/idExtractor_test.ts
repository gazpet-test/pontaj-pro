// Fix 20.10 (bug în producție): A3 construia „claude-haiku-5-5>claude-sonnet-5-5@…”, iar CHECK-ul de pe ofertare_cant_extrageri.extractor_id
// nu permite „>” → extragere_incepe pica pe fiecare document. Testul citește regex-ul DIN MIGRARE și verifică TOATE id-urile construite
// (A cu escaladare, B, cu orice convenție și context), ca un caracter nou în identitate să pice aici, nu în producție.
import { assert, assertEquals } from 'jsr:@std/assert@1'
import type { Conventie } from '../_shared/cantNumar.ts'
import { EXTRACTOARE, extractorCuContext, idExtractor } from './structurat.ts'

const MIGRARI = new URL('../../migrations/', import.meta.url)

function regexCheck(): RegExp {
  const sql = Deno.readTextFileSync(new URL('20261031a_ofertare_cantitati_b.sql', MIGRARI))
  const m = sql.match(/extractor_id\s+text NOT NULL CHECK \(extractor_id ~ '([^']+)'\)/)
  assert(m, 'CHECK-ul pe extractor_id nu mai e găsit în 20261031a — actualizează testul')
  return new RegExp(m[1])
}

Deno.test('extractor_id: CHECK-ul nu e redefinit în alte migrări (altfel testul ar citi regula greșită)', () => {
  const alte: string[] = []
  for (const f of Deno.readDirSync(MIGRARI)) {
    if (!f.isFile || !f.name.endsWith('.sql') || f.name === '20261031a_ofertare_cantitati_b.sql') continue
    const sql = Deno.readTextFileSync(new URL(f.name, MIGRARI))
    if (/extractor_id\s*~|extractor_id_check/.test(sql)) alte.push(f.name)
  }
  assertEquals(alte, [])
})

Deno.test('extractor_id: toate id-urile construite (A cu escaladare, B; orice convenție) respectă CHECK-ul din migrare', async () => {
  const re = regexCheck()
  const conventii: Conventie[] = ['ro', 'en', 'nedeterminata', 'contradictorie']
  const decizii = [{ decizie: 'text_confirmat', rol: 'f3', sectiune: '*' }, { decizie: 'exclus', rol: 'c6', sectiune: '12-340' }]
  const manifest = ['212:' + 'a'.repeat(64), '213:' + 'b'.repeat(64)]
  for (const ex of Object.values(EXTRACTOARE)) {
    const baza = idExtractor(ex)
    assert(re.test(baza), `idExtractor(${ex.cheie}) = ${baza} nu respectă ${re}`)
    for (const c of conventii) {
      // deciziile au tipul din structurat.ts; aici contează doar forma id-ului rezultat
      // deno-lint-ignore no-explicit-any
      const id = await extractorCuContext(c, manifest, decizii as any, ex)
      assert(re.test(id), `extractorCuContext(${ex.cheie}, ${c}) = ${id} nu respectă ${re}`)
    }
  }
  assertEquals(idExtractor(EXTRACTOARE.A), 'claude-haiku-5-5/claude-sonnet-5-5@p4@n4@f2')
})

// review Gemini #804 r1 (P2, verificat): modelul decontat la escaladare ('<haiku>+<sonnet>') ajunge în ofertare_ai_rezervari.model, al cărui
// CHECK (din aceeași migrare) e doar de lungime ≤ 100 — fără clasă de caractere; testul fixează regula, ca o restrângere să pice aici
Deno.test('modelul decontat (inclusiv escaladarea) respectă CHECK-ul ofertare_ai_rezervari.model din migrare', () => {
  const sql = Deno.readTextFileSync(new URL('20261031a_ofertare_cantitati_b.sql', MIGRARI))
  assert(/model\s+text CHECK \(model IS NULL OR length\(model\) <= 100\)/.test(sql), 'CHECK-ul pe model s-a schimbat — actualizează testul')
  const a = EXTRACTOARE.A
  for (const m of [a.model, `${a.model}+${a.escaladare!.model}`, EXTRACTOARE.B.model]) assert(m.length <= 100, m)
})
