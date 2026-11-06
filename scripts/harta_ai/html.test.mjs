import { describe, expect, it } from 'vitest'
import { construiesteHtml, escapeazaJsInScript, escapeazaJsonInScript } from './html.mjs'

describe('Harta AI › HTML standalone', () => {
  it('JSON-ul cu </script> în el nu închide elementul și se citește înapoi identic', () => {
    const date = { meta: { titlu: 'Hartă <test> & "x"' }, noduri: [{ id: 'a', nume: '</script><script>alert(1)</script>' + String.fromCharCode(0x2028) + '' }] }
    const html = construiesteHtml(date, 'console.log(1)')
    // exact două închideri de <script>: cea a JSON-ului și cea a codului
    expect(html.match(/<\/script>/g).length).toBe(2)
    const json = html.split('<script type="application/json" id="harta-date">')[1].split('</script>')[0]
    expect(JSON.parse(json)).toEqual(date)
    expect(html).toContain('<title>Hartă &lt;test&gt; &amp; &quot;x&quot;</title>')
  })
  it('escaparea codului păstrează sensul șirurilor și al expresiilor regulate (și cu flagul u)', () => {
    const cod = 'return ["</script>", "<!--", /<!--/u.test("<!--"), "</SCRIPT"]'
    const esc = escapeazaJsInScript(cod)
    expect(esc).not.toMatch(/<\/script/i)
    expect(esc).not.toContain('<!--')
    // eslint-disable-next-line no-new-func
    expect(new Function(esc)()).toEqual(['</script>', '<!--', true, '</SCRIPT'])
  })
  it('escaparea JSON-ului scoate orice „<”', () => {
    expect(escapeazaJsonInScript('{"a":"<b>"}')).toBe('{"a":"\\u003cb>"}')
  })
})
