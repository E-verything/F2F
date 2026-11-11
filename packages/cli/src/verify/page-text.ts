// Runs inside the page (serialised with Function.toString), so it uses only browser globals and no imports.
// For every design text it finds the visible app text with the same words, tagged or not, and measures it the way Figma
// describes a text layer: the rendered lines, where the ink starts and ends, the top of the first line box and the style.
// A design text that is one of several Figma layers drawn by a single app element (a label split into two layers) is
// found as a run of words inside that element.
export function measureTexts(want: [string, string, string?][]): string {
  const g = globalThis as any;
  const doc = g.document;
  const key = (s: string) => s.replace(/\s+/g, '').toLowerCase();
  const keys = new Set(want.map(([, t]) => key(t)));
  type Word = { node: any; start: number; end: number; k: string };
  const visible = (el: any) => el.getClientRects().length > 0;
  const wordsOf = (el: any): Word[] => {
    const out: Word[] = [];
    const walker = doc.createTreeWalker(el, 4 /* SHOW_TEXT */);
    for (let n = walker.nextNode(); n; n = walker.nextNode())
      for (const m of (n.textContent as string).matchAll(/\S+/g)) out.push({ node: n, start: m.index!, end: m.index! + m[0].length, k: key(m[0]) });
    return out;
  };
  const measure = (el: any, words: Word[]) => {
    const lines: string[] = [], edges: number[][] = [];
    let top: number | null = null, firstTop: number | null = null, lastBottom = 0;
    // The style covering most characters, like Figma's longest run (a bold lead-in does not decide the colour of a sentence).
    const styles = new Map<string, { s: any; n: number }>();
    for (const w of words) {
      const r = doc.createRange();
      r.setStart(w.node, w.start); r.setEnd(w.node, w.end);
      const rect = r.getClientRects()[0];
      if (!rect || !rect.width) continue;
      const s = g.getComputedStyle(w.node.parentElement);
      const fs = parseFloat(s.fontSize), lh = s.lineHeight === 'normal' ? fs * 1.2 : parseFloat(s.lineHeight);
      // The glyph box sits centred in its line box; Figma's text layer starts at the line box.
      const lineTop = rect.top - (lh - rect.height) / 2;
      const st = { fontFamily: s.fontFamily, fontSize: fs, fontWeight: Number(s.fontWeight), fontStyle: s.fontStyle, color: s.color, letterSpacing: s.letterSpacing === 'normal' ? 0 : parseFloat(s.letterSpacing), textTransform: s.textTransform, textDecoration: s.textDecorationLine };
      const sk = JSON.stringify(st), cur = styles.get(sk);
      styles.set(sk, { s: st, n: (cur?.n ?? 0) + w.k.length });
      const text = (w.node.textContent as string).slice(w.start, w.end);
      if (top === null || Math.abs(rect.top - top) > rect.height / 2) { lines.push(text); edges.push([rect.left, rect.right]); top = rect.top; firstTop ??= lineTop; }
      else { lines[lines.length - 1] += ' ' + text; const e = edges[edges.length - 1]!; e[0] = Math.min(e[0]!, rect.left); e[1] = Math.max(e[1]!, rect.right); }
      lastBottom = lineTop + lh;
    }
    const r = el.getBoundingClientRect();
    const style = [...styles.values()].sort((a, b) => b.n - a.n)[0]?.s ?? null;
    // Position of the text itself (first ink and first line box), not of a wider element around it.
    const x = edges.length ? Math.min(...edges.map((e) => e[0]!)) : r.left, y = firstTop ?? r.top;
    return { style, lines, width: Math.round(r.width * 100) / 100, x: x + g.scrollX, y: y + g.scrollY,
      ...(edges.length ? { left: Math.min(...edges.map((e) => e[0]!)) + g.scrollX, right: Math.max(...edges.map((e) => e[1]!)) + g.scrollX, top: firstTop! + g.scrollY, bottom: lastBottom + g.scrollY } : {}) };
  };
  const res: Record<string, any[]> = {};
  const exact = new Set<string>();
  for (const el of doc.querySelectorAll('body *')) {
    const k = key(el.textContent || '');
    // Deepest element with exactly these words; hidden copies (a closed mobile menu) are not what the design shows.
    if (!k || !keys.has(k) || [...el.children].some((c: any) => key(c.textContent || '') === k) || !visible(el)) continue;
    (res[k] ??= []).push(measure(el, wordsOf(el)));
    exact.add(k);
  }
  // Texts with no element of their own: a run of whole words inside the deepest visible element that contains them,
  // and, for one of several Figma layers that make up one sentence, that also contains the whole sentence (so "2026]" is not taken from another card).
  const context = new Map<string, string>();
  for (const [, t, ctx] of want) if (ctx) context.set(key(t), key(ctx));
  for (const k of keys) {
    if (exact.has(k)) continue;
    const ctx = context.get(k) ?? k;
    for (const el of doc.querySelectorAll('body *')) {
      const all = key(el.textContent || '');
      if (!all.includes(k) || !all.includes(ctx) || [...el.children].some((c: any) => { const ck = key(c.textContent || ''); return ck.includes(k) && ck.includes(ctx); }) || !visible(el)) continue;
      const words = wordsOf(el);
      for (let i = 0; i < words.length; i++) {
        let acc = '';
        for (let j = i; j < words.length && acc.length < k.length; j++) {
          acc += words[j]!.k;
          if (acc === k) { (res[k] ??= []).push(measure(el, words.slice(i, j + 1))); break; }
        }
      }
    }
  }
  return JSON.stringify(res);
}
