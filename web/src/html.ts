// Email bodies come from the OS or an agent: only simple formatting tags are kept, without any
// attribute, so a body can never run a script or load anything in the page.
const AUTORISEES = new Set([
  'P',
  'BR',
  'B',
  'STRONG',
  'I',
  'EM',
  'U',
  'UL',
  'OL',
  'LI',
  'DIV',
  'SPAN',
]);

export function htmlSur(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const clean = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      const div = document.createElement('div');
      div.textContent = node.textContent ?? '';
      return div.innerHTML;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const el = node as Element;
    const inner = [...el.childNodes].map(clean).join('');
    if (!AUTORISEES.has(el.tagName))
      return el.tagName === 'SCRIPT' || el.tagName === 'STYLE' ? '' : inner;
    const tag = el.tagName.toLowerCase();
    return tag === 'br' ? '<br>' : `<${tag}>${inner}</${tag}>`;
  };
  return [...doc.body.childNodes].map(clean).join('');
}
