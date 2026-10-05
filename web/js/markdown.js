// A small, safe Markdown renderer for the chat: it builds DOM nodes (never HTML strings), so nothing in a message can inject markup.
// Supports headings, bold, italic, `code`, fenced code blocks, lists (nested), block quotes, tables, rules and http(s) links.

const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e }

const INLINE = /`([^`\n]+)`|\*\*(.+?)\*\*|__(.+?)__|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(?<![\w*])\*([^*\s][^*\n]*?)\*(?![\w*])|(?<![\w_])_([^_\s][^_\n]*?)_(?![\w_])/g

function inline(text, parent) {
  let last = 0
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) parent.append(text.slice(last, m.index))
    if (m[1] !== undefined) { const c = el('code'); c.textContent = m[1]; parent.append(c) }
    else if (m[2] !== undefined || m[3] !== undefined) { const b = el('strong'); inline(m[2] ?? m[3], b); parent.append(b) }
    else if (m[4] !== undefined) {
      const a = el('a'); a.href = m[5]; a.target = '_blank'; a.rel = 'noopener noreferrer'; inline(m[4], a); parent.append(a)
    } else { const i = el('em'); inline(m[6] ?? m[7], i); parent.append(i) }
    last = m.index + m[0].length
  }
  if (last < text.length) parent.append(text.slice(last))
}

const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/
const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((s) => s.trim())

function renderList(items) {
  const frag = document.createDocumentFragment()
  const stack = []
  for (const it of items) {
    while (stack.length && it.indent < stack.at(-1).indent) stack.pop()
    if (!stack.length || it.indent > stack.at(-1).indent) {
      const list = el(it.ordered ? 'ol' : 'ul')
      if (stack.length && stack.at(-1).last) stack.at(-1).last.append(list); else frag.append(list)
      stack.push({ list, indent: it.indent, last: null })
    }
    const top = stack.at(-1), li = el('li')
    inline(it.text, li)
    top.list.append(li)
    top.last = li
  }
  return frag
}

export function renderMarkdown(src) {
  const root = document.createDocumentFragment()
  const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n')
  const para = []
  const flush = () => {
    if (!para.length) return
    const p = el('p')
    para.forEach((l, k) => { if (k) p.append(el('br')); inline(l, p) })
    root.append(p)
    para.length = 0
  }
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    let m
    if (/^\s*(```|~~~)/.test(line)) { // fenced code block
      flush()
      const buf = []
      i++
      while (i < lines.length && !/^\s*(```|~~~)\s*$/.test(lines[i])) buf.push(lines[i++])
      i++
      const pre = el('pre'), code = el('code')
      code.textContent = buf.join('\n')
      pre.append(code)
      root.append(pre)
      continue
    }
    if (!line.trim()) { flush(); i++; continue }
    if ((m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line))) { flush(); const h = el('div', 'md-h'); inline(m[2], h); root.append(h); i++; continue }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); root.append(el('hr')); i++; continue }
    if (/^\s*>/.test(line)) { // block quote
      flush()
      const buf = []
      while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''))
      const q = el('blockquote')
      q.append(renderMarkdown(buf.join('\n')))
      root.append(q)
      continue
    }
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) { // table
      flush()
      const table = el('table'), head = el('thead'), body = el('tbody'), hr = el('tr')
      for (const c of cells(line)) { const th = el('th'); inline(c, th); hr.append(th) }
      head.append(hr)
      i += 2
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        const tr = el('tr')
        for (const c of cells(lines[i])) { const td = el('td'); inline(c, td); tr.append(td) }
        body.append(tr)
        i++
      }
      table.append(head, body)
      const wrap = el('div', 'md-table')
      wrap.append(table)
      root.append(wrap)
      continue
    }
    if (LIST_ITEM.test(line)) { // list, with nested levels by indentation
      flush()
      const items = []
      while (i < lines.length) {
        const lm = LIST_ITEM.exec(lines[i])
        if (lm) { items.push({ indent: lm[1].replace(/\t/g, '  ').length, ordered: /\d/.test(lm[2]), text: lm[3] }); i++ }
        else if (items.length && lines[i].trim() && /^\s{2,}\S/.test(lines[i])) { items.at(-1).text += ' ' + lines[i].trim(); i++ } // continuation of the item
        else break
      }
      root.append(renderList(items))
      continue
    }
    para.push(line.trim())
    i++
  }
  flush()
  return root
}

// The same text without the markers, for the short speech bubbles in the scene.
export function plainText(src) {
  return String(src ?? '')
    .replace(/```[^\n]*\n?/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*|__(.+?)__/g, '$1$2')
    .replace(/(?<![\w*])\*([^*\s][^*\n]*?)\*(?![\w*])/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/\[([^\]\n]+)\]\([^)\s]+\)/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '• ')
    .replace(/^\s*>\s?/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
}
