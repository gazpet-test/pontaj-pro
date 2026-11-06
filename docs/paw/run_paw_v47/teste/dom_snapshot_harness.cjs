// Offline DOM fixture adapter, no browser/network/packages. Runs the exact
// production snapshot JS against an independent ordered tree with attributes.
const fs = require('node:fs');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
let order = 0;
class Element {
  constructor(data, parent = null) {
    this.tagName = data.tag || 'div';
    this.attrs = data.attrs || {};
    this.text = data.text || '';
    this.parent = parent;
    this.order = order++;
    this.visible = data.visible !== false;
    this.children = (data.children || []).map(x => new Element(x, this));
  }
  get id() { return this.attrs.id || ''; }
  get href() { return this.attrs.href; }
  get innerText() { return this.text + this.children.map(x => x.innerText).join(''); }
  getAttribute(name) { return this.attrs[name] ?? null; }
  matches(selector) {
    return selector.split(',').some(part => {
      part = part.trim();
      const tag = /^[a-z]+/.exec(part)?.[0];
      if (tag && tag !== this.tagName) return false;
      const attrs = [...part.matchAll(/\[([a-z-]+)(?:(\^?=)"([^"]*)")?\]/g)];
      if (!tag && !attrs.length) throw new Error('Unsupported fixture selector: ' + part);
      return attrs.every(([,name,op,value]) => name in this.attrs &&
        (!op || (op === '=' ? this.attrs[name] === value : this.attrs[name].startsWith(value))));
    });
  }
  querySelectorAll(selector) {
    return this.children.flatMap(x => [x, ...x.descendants()]).filter(x => x.matches(selector));
  }
  descendants() { return this.children.flatMap(x => [x, ...x.descendants()]); }
  closest(selector) {
    for (let p = this; p; p = p.parent) if (p.matches(selector)) return p;
    return null;
  }
  contains(el) { return this === el || this.descendants().includes(el); }
  compareDocumentPosition(el) { return this.order < el.order ? 4 : this.order > el.order ? 2 : 0; }
  getClientRects() {
    for (let p = this; p; p = p.parent) if (!p.visible) return [];
    return [{}];
  }
}
const document = new Element(input.tree);
const snapshot = new Function('document', 'Node', 'arg', 'return (' + input.script + ')(arg)');
process.stdout.write(JSON.stringify(snapshot(document, {DOCUMENT_POSITION_FOLLOWING:4}, {index:input.index})));
