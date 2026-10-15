import { assertEquals } from 'jsr:@std/assert@1'
import { dnDinText, dnuriDenumire } from './dn.ts'

Deno.test('dnDinText: formele cerute de spec §5.1', () => {
  assertEquals(dnDinText('PEHD 100 SDR11 Dn 90').dn, [90])
  assertEquals(dnDinText('teava De 90').dn, [90])
  assertEquals(dnDinText('conducta Ø90').dn, [90])
  assertEquals(dnDinText('TEAVA PVC ... DISTRIBUTIE D= 90 MM').dn, [90])
  assertEquals(dnDinText('D=90mm').dn, [90])
  assertEquals(dnDinText('Dn 90/110'), { dn: [90, 110], interval: true })
})
Deno.test('dnDinText: grosimea peretelui nu e Dn; reducția da', () => {
  assertEquals(dnDinText('@TV HDPE80 312UNI7611.7615 PN10 DN 90X8. 2 COD 64000115').dn, [90])
  assertEquals(dnDinText('TEAVA PE100 SDR11 De 90x8,2').dn, [90])
  assertEquals(dnDinText('@TEU REDUS PE100 FT. SUDURA PN 10 DN 90X32').dn, [32, 90])
  assertEquals(dnDinText('fara diametru').dn, [])
})
Deno.test('dnuriDenumire neschimbat (planșe): „D=” nu e prefix acolo', () => {
  assertEquals(dnuriDenumire('D= 90 MM').dn, [])
  assertEquals(dnuriDenumire('Total conducte De 110'), { dn: [110], interval: false })
})
