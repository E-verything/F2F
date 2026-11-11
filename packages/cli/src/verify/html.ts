import { existsSync } from 'node:fs';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixPrompt, shiftGroups, type Mismatch, type VerifyReport } from './compare';

// One self-contained HTML page over every verify run in the package: no network, images by relative path, opens from disk.

interface ScreenReport { when?: string; slug: string; report: VerifyReport; origin: { x: number; y: number }; figma: string | null; app: string | null; diff: string | null }

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const r1 = (n: number) => Math.round(n * 10) / 10;

// The delta in words, so a developer reads "12px too tall" instead of decoding Δh.
export function describe(m: Pick<Mismatch, 'delta'>): string {
  const d = m.delta, out: string[] = [];
  if (Math.abs(d.width) > 1) out.push(`${r1(Math.abs(d.width))}px too ${d.width > 0 ? 'wide' : 'narrow'}`);
  if (Math.abs(d.height) > 1) out.push(`${r1(Math.abs(d.height))}px too ${d.height > 0 ? 'tall' : 'short'}`);
  if (Math.abs(d.x) > 1) out.push(`${r1(Math.abs(d.x))}px too far ${d.x > 0 ? 'right' : 'left'}`);
  if (Math.abs(d.y) > 1) out.push(`${r1(Math.abs(d.y))}px too ${d.y > 0 ? 'low' : 'high'}`);
  return out.join(', ') || 'within 1-2px';
}

export async function loadReports(pkgDir: string, only?: Set<string>): Promise<ScreenReport[]> {
  const dir = join(pkgDir, 'verification');
  if (!existsSync(dir)) return [];
  const assets = JSON.parse(await readFile(join(pkgDir, 'assets/manifest.json'), 'utf8').catch(() => '{"assets":[]}')).assets as any[];
  const out: ScreenReport[] = [];
  for (const f of (await readdir(dir)).filter((x) => x.endsWith('.json')).sort()) {
    const slug = f.slice(0, -5);
    const j = JSON.parse(await readFile(join(dir, f), 'utf8'));
    if (!j.report?.screen) continue;
    const report = j.report as VerifyReport;
    if (only && !only.has(report.screen.id)) continue;
    const when = (await stat(join(dir, f))).mtime.toLocaleString();
    const o = j.measurements?.nodes?.[report.screen.id];
    const ref = assets.find((a) => a.role === 'screenshot' && a.sourceNodeIds?.includes(report.screen.id));
    const has = (p: string) => existsSync(join(dir, p)) ? p : null;
    out.push({ when, slug, report, origin: { x: o?.x ?? 0, y: o?.y ?? 0 }, figma: ref && existsSync(join(pkgDir, ref.file)) ? `../${ref.file}` : null, app: has(`${slug}.app.png`), diff: has(`${slug}.diff.png`) });
  }
  return out;
}

const badge = (v: string) => `<span class="badge ${esc(v)}">${esc(v.toUpperCase())}</span>`;

function screenSection(s: ScreenReport, i: number): string {
  const r = s.report, sm = r.summary;
  const vw = r.viewport.expected.width;
  const finds = r.findings ?? [];
  const prompt = fixPrompt(r, s.slug);
  const toFix = finds.filter((f) => f.severity !== 'check'), toCheck = finds.filter((f) => f.severity === 'check');
  const card = (f: (typeof finds)[number]) => `<div class="card${f.severity === 'check' ? ' maybe' : ''}" data-f="${f.n}"><div class="cardhead"><span class="n">${f.n}</span><b>${esc(f.kind)}</b> <code>${esc(f.id)}</code></div><img src="${esc(f.crop)}" alt="Figma and app around ${esc(f.name)}" loading="lazy"><p><b>${esc(f.name)}</b>: ${esc(f.what)}</p><p class="fix">Fix:${esc(f.fix)}</p></div>`;
  const wraps = (r.lines ?? []).filter((l) => l.kind !== 'align'), shifts = shiftGroups(r.lines ?? []);
  const boxes = r.mismatches.slice(0, 50).map((m, k) => ({ k, e: m.expected, a: { ...m.actual, x: m.actual.x + s.origin.x, y: m.actual.y + s.origin.y } }));
  const img = (src: string | null, label: string, kind: 'figma' | 'app' | 'diff', hint: string) => `<figure><figcaption><b>${label}</b><span>${hint}</span></figcaption>${src ? `<div class="shot" data-kind="${kind}"><img src="${esc(src)}" alt="${esc(label)}" loading="lazy">${kind === 'diff' ? finds.map((f) => `<i class="box num" data-f="${f.n}" data-b='${JSON.stringify(f.box)}'><b>${f.n}</b></i>`).join('') : boxes.map((b) => `<i class="box" data-k="${b.k}" data-b='${JSON.stringify(kind === 'figma' ? b.e : b.a)}'></i>`).join('')}</div>` : `<p class="none">No image. ${kind === 'figma' ? 'Export with "Reference screenshots" on.' : 'Run f2f verify with --url (web) to get screenshots.'}</p>`}</figure>`;
  const checks = [
    ['Layout', `${sm.passed}/${sm.measured} layers in place`, sm.failed === 0],
    ['Styles', `${sm.styleFailed} differences`, sm.styleFailed === 0],
    ['Small screen', r.narrow ? (r.narrow.ok ? `OK at ${r.narrow.width}px` : `breaks at ${r.narrow.width}px`) : 'not checked', !r.narrow || r.narrow.ok],
    ['Code rules', `${r.code?.length ?? 0} issues`, !r.code?.length],
    ['Tagged', `${sm.missingKey} required layers untagged`, sm.missingKey === 0],
    ['Text', r.lines ? `${wraps.length} wrap, ${r.lines.length - wraps.length} placed differently` : 'not checked', !r.lines?.length],
    ['Findings', `${(r.findings ?? []).filter((f) => f.severity !== 'check').length} to fix, ${(r.findings ?? []).filter((f) => f.severity === 'check').length} small`, !(r.findings ?? []).some((f) => f.severity !== 'check')],
    ['Page size', `${r.viewport.actual.width}×${r.viewport.actual.height} (design ${r.viewport.expected.width}×${r.viewport.expected.height})`, r.viewport.ok],
  ] as const;
  return `<section id="s${i}" data-vw="${vw}">
<h2>${badge(sm.verdict)} ${esc(r.screen.name)} <small>${esc(r.screen.id)}${s.when ? ` · verified ${esc(s.when)}` : ''}</small></h2>
<ul class="checks">${checks.map(([k, v, ok]) => `<li class="${ok ? 'ok' : 'bad'}"><b>${k}</b>${esc(v)}</li>`).join('')}${r.visual && !Number.isNaN(r.visual.mismatchRatio) ? `<li><b>Pixels really differing</b>${Math.round(r.visual.mismatchRatio * 1000) / 10}%${r.visual.noiseRatio ? ` (+${Math.round(r.visual.noiseRatio * 1000) / 10}% rendering only)` : ''}</li>` : ''}</ul>
${toFix.length ? `<h3>Fix these first (${toFix.length})</h3><p class="note">Each picture: left = Figma (green outline), right = your app (red outline). The numbers match the boxes on the heatmap.</p><div class="cards">${toFix.map(card).join('')}</div>` : ''}
${toCheck.length ? `<details class="check" open><summary>Small differences (${toCheck.length}): the page passes; fix these for pixel-perfect</summary><div class="cards">${toCheck.map(card).join('')}</div></details>` : ''}
${r.engineNote ? `<p class="note"><b>Text width vs Figma, not counted:</b> ${esc(r.engineNote)}</p>` : ''}
${prompt ? `<details class="prompt"><summary>Fix prompt for your AI agent (copy and paste into Claude, Codex or any agent)</summary><button type="button" class="copy">Copy prompt</button><pre>${esc(prompt)}</pre></details>` : ''}
<div class="shots">${img(s.figma, 'Figma', 'figma', 'red box = where the layer should be')}${img(s.app, 'Your app', 'app', 'red box = where it is now')}${img(s.diff, 'Heatmap', 'diff', 'see legend below')}</div>
<p class="legend"><span class="sw g"></span>Figma (where it should be) <span class="sw r"></span>your app (wrong: moved, missing or different) <span class="sw k"></span>same, or rendering only (photo compression, font smoothing) <span class="sw o"></span>numbered = finding above</p>
${s.figma && s.app ? `<details class="onion"><summary>Overlay your app on Figma</summary><label>Figma <input type="range" min="0" max="100" value="50"> Your app</label><div class="stack"><img src="${esc(s.figma)}" alt=""><img class="top" src="${esc(s.app)}" alt=""></div></details>` : ''}
${r.mismatches.length ? `<h3>Fix these, largest first (${r.mismatches.length})</h3><p class="note">Each row is this layer's own error. A shift its parent or the layer above already explains is not counted again. Hover a row to see it on the images.</p>
<table><thead><tr><th>Layer</th><th>Figma id</th><th>What is wrong</th><th>Figma x,y w×h</th><th>App x,y w×h</th></tr></thead><tbody>${r.mismatches.slice(0, 50).map((m, k) => `<tr data-k="${k}"><td>${esc(m.name)}</td><td><code>${esc(m.id)}</code></td><td>${esc(describe(m))}</td><td>${m.expected.x},${m.expected.y} ${m.expected.width}×${m.expected.height}</td><td>${m.actual.x},${m.actual.y} ${m.actual.width}×${m.actual.height}</td></tr>`).join('')}</tbody></table>${r.mismatches.length > 50 ? `<p class="note">${r.mismatches.length - 50} more in ${esc(s.slug)}.json</p>` : ''}` : ''}
${wraps.length ? `<h3>Text lines differ (${wraps.length})</h3><p class="note">The words wrap at other places than in Figma. At the design width keep the Figma line breaks.</p><table><thead><tr><th>Text</th><th>Figma id</th><th>Figma lines</th><th>Your app lines</th></tr></thead><tbody>${wraps.map((l) => `<tr><td>${esc(l.name)}</td><td><code>${esc(l.id)}</code></td><td>${l.figma.map(esc).join('<br>')}</td><td>${l.app.map(esc).join('<br>')}</td></tr>`).join('')}</tbody></table>` : ''}
${shifts.length ? `<h3>Text placed sideways (${shifts.reduce((s, g) => s + g.items.length, 0)})</h3><p class="note">Measured on the edge each text is aligned to, tagged or not. Texts moved by the same amount share one cause: fix their common container once.</p><ul>${shifts.map((g) => `<li><b>${g.items.length} text(s) ${Math.abs(g.dx)}px too far ${g.dx > 0 ? 'right' : 'left'}</b>: ${g.items.slice(0, 8).map((x) => `<code>${esc(x.id)}</code> ${esc(x.text ?? x.name)}`).join(', ')}${g.items.length > 8 ? ` and ${g.items.length - 8} more` : ''}</li>`).join('')}</ul>` : ''}
${r.styles.length ? `<h3>Style differences (${r.styles.length})</h3><table><thead><tr><th>Layer</th><th>Figma id</th><th>Property</th><th>Figma</th><th>Your app</th></tr></thead><tbody>${r.styles.slice(0, 50).map((x) => `<tr><td>${esc(x.name)}</td><td><code>${esc(x.id)}</code></td><td>${esc(x.property)}</td><td>${esc(x.expected)}</td><td>${esc(x.actual)}</td></tr>`).join('')}</tbody></table>` : ''}
${r.narrow && !r.narrow.ok ? `<h3>Small screen (${r.narrow.width}px)</h3><p>Page is ${r.narrow.scrollWidth}px wide or cuts content off.</p><ul>${r.narrow.cutOff.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
${r.code?.length ? `<h3>Code rules</h3><ul>${r.code.map((c) => `<li><code>${esc(c.file)}:${c.line}</code> ${esc(c.rule)}</li>`).join('')}</ul>` : ''}
${r.missingKeyNodes.length ? `<h3>Not tagged (${r.missingKeyNodes.length})</h3><p>${r.missingKeyNodes.slice(0, 40).map((n) => `${esc(n.name)} <code>${esc(n.id)}</code>`).join(', ')}</p>` : ''}
</section>`;
}

export function reportHtml(screens: ScreenReport[]): string {
  const pass = screens.filter((s) => s.report.summary.verdict === 'pass').length;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>F2F verify report</title><style>
:root{--bg:#f7f8fa;--card:#fff;--text:#14161a;--muted:#5b6270;--line:#e2e5ea;--red:#e5484d;--green:#1f9d55;--amber:#c27c0e}
@media (prefers-color-scheme:dark){:root{--bg:#111316;--card:#1a1d21;--text:#e8eaed;--muted:#9aa1ac;--line:#2c3036}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 system-ui,sans-serif}main{max-width:1500px;margin:auto;padding:24px 16px}
h1{margin:0 0 4px}h2{display:flex;gap:10px;align-items:center;flex-wrap:wrap}h2 small{color:var(--muted);font-weight:400}section,.summary{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 20px;margin:20px 0}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}tbody tr:hover,tr.hot{background:color-mix(in srgb,var(--red) 12%,transparent)}
.badge{font-size:12px;font-weight:700;padding:2px 8px;border-radius:99px;color:#fff;background:var(--amber)}.badge.pass{background:var(--green)}.badge.fail{background:var(--red)}
.checks{display:flex;flex-wrap:wrap;gap:8px;list-style:none;padding:0}.checks li{border:1px solid var(--line);border-radius:8px;padding:6px 10px}.checks b{display:block;font-size:12px;color:var(--muted)}.checks .bad{border-color:var(--red)}.checks .ok b::after{content:" ✓";color:var(--green)}.checks .bad b::after{content:" ✗";color:var(--red)}
.shots{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;align-items:start}figure{margin:0}figcaption{display:flex;justify-content:space-between;gap:8px;margin-bottom:6px}figcaption span,.note,.none{color:var(--muted);font-size:12px}
.shot{position:relative;max-height:80vh;overflow:auto;border:1px solid var(--line);border-radius:8px}.shot img{display:block;width:100%}
.box{position:absolute;border:2px solid var(--red);pointer-events:none}.spot{border-color:#ff8a00}.num{border-color:#7c3aed;border-width:3px}.num b{position:absolute;top:-2px;left:-2px;transform:translate(-50%,-50%);background:#7c3aed;color:#fff;font:700 12px/20px system-ui;min-width:20px;height:20px;border-radius:10px;text-align:center}.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px;margin-bottom:16px}.card{border:1px solid var(--line);border-radius:10px;padding:10px;cursor:pointer}.card img{display:block;max-width:100%;border-radius:6px;margin:6px 0;background:#fff}.card p{margin:4px 0}.card .fix{color:var(--green)}.cardhead{display:flex;gap:8px;align-items:center}.n{background:#7c3aed;color:#fff;border-radius:10px;min-width:20px;height:20px;text-align:center;font:700 12px/20px system-ui}.sw.p{border:2px solid #ff8a00}.sw.o{border:3px solid #7c3aed;background:#7c3aed33}.check summary{cursor:pointer;color:var(--muted);margin:8px 0}.card.maybe .fix{color:var(--muted)}.card.maybe .n{background:#888}
.card.hot{outline:2px solid #7c3aed}.legend{font-size:12px;color:var(--muted);display:flex;flex-wrap:wrap;gap:4px 12px;align-items:center}.sw{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:4px;vertical-align:-2px}.sw.g{background:#00aa3c}.sw.r{background:#e60000}.sw.y{background:#ffc800}.sw.k{background:#bbb}
.box.hot{border-width:3px;background:color-mix(in srgb,var(--red) 35%,transparent);z-index:1}
.stack{position:relative;max-height:80vh;overflow:auto;border:1px solid var(--line);border-radius:8px}.stack img{display:block;width:100%}.stack .top{position:absolute;inset:0 auto auto 0;opacity:.5}
code{font-size:12px}a{color:inherit}
.prompt{margin:12px 0}.prompt summary{cursor:pointer;font-weight:600}.prompt pre{white-space:pre-wrap;word-break:break-word;font-size:12px;background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px;max-height:50vh;overflow:auto}.prompt .copy{margin:8px 0;padding:6px 12px;border-radius:6px;border:1px solid var(--line);background:var(--card);color:var(--text);cursor:pointer}
</style></head><body><main>
<h1>F2F verify report</h1><p class="note">${pass}/${screens.length} screens pass. Each section shows when that page was verified. Run <code>f2f verify</code> again after changing code; <code>f2f report</code> shows every page verified so far.</p>
<div class="summary"><table><thead><tr><th>Screen</th><th>Result</th><th>Layers in place</th><th>Style diffs</th><th>Small screen</th><th>Text lines</th><th>Pixels really differing</th></tr></thead><tbody>${screens.map((s, i) => { const r = s.report, sm = r.summary; return `<tr><td><a href="#s${i}">${esc(r.screen.name)}</a></td><td>${badge(sm.verdict)}</td><td>${sm.passed}/${sm.measured}</td><td>${sm.styleFailed}</td><td>${r.narrow ? (r.narrow.ok ? 'OK' : 'FAIL') : '-'}</td><td>${r.lines ? (r.lines.length ? `${r.lines.length} differ` : 'OK') : '-'}</td><td>${r.visual && !Number.isNaN(r.visual.mismatchRatio) ? `${Math.round(r.visual.mismatchRatio * 1000) / 10}%` : '-'}</td></tr>`; }).join('')}</tbody></table></div>
${screens.length ? screens.map(screenSection).join('\n') : '<section><p>No verify results yet. Run <code>f2f verify --screen &lt;id&gt; --url &lt;url&gt;</code> first.</p></section>'}
</main><script>
for(const sec of document.querySelectorAll('section[data-vw]')){
  const vw=+sec.dataset.vw;
  const place=()=>{for(const shot of sec.querySelectorAll('.shot')){const img=shot.querySelector('img');if(!img.naturalWidth)continue;const k=img.clientWidth/vw;for(const b of shot.querySelectorAll('.box')){const v=JSON.parse(b.dataset.b);Object.assign(b.style,{left:v.x*k+'px',top:v.y*k+'px',width:Math.max(2,v.width*k)+'px',height:Math.max(2,v.height*k)+'px'});}}};
  sec.querySelectorAll('img').forEach(i=>i.addEventListener('load',place));addEventListener('resize',place);place();
  const hot=(k,on)=>sec.querySelectorAll('[data-k="'+k+'"]').forEach(e=>e.classList.toggle('hot',on));
  sec.querySelectorAll('.card[data-f]').forEach(c=>{const set=(on)=>sec.querySelectorAll('[data-f="'+c.dataset.f+'"]').forEach(e=>e.classList.toggle('hot',on));c.onmouseenter=()=>{set(true);const b=sec.querySelector('.shot .box[data-f="'+c.dataset.f+'"]');if(b){const s=b.parentElement;s.scrollTop=b.offsetTop-s.clientHeight/3;}};c.onmouseleave=()=>set(false);});
  sec.querySelectorAll('tr[data-h]').forEach(tr=>{const set=(on)=>sec.querySelectorAll('[data-h="'+tr.dataset.h+'"]').forEach(e=>e.classList.toggle('hot',on));tr.onmouseenter=()=>{set(true);const b=sec.querySelector('.shot .box[data-h="'+tr.dataset.h+'"]');if(b){const s=b.parentElement;s.scrollTop=b.offsetTop-s.clientHeight/3;}};tr.onmouseleave=()=>set(false);});
  sec.querySelectorAll('tr[data-k]').forEach(tr=>{tr.onmouseenter=()=>{hot(tr.dataset.k,true);const b=sec.querySelector('.shot .box[data-k="'+tr.dataset.k+'"]');if(b){const s=b.parentElement;s.scrollTop=b.offsetTop-s.clientHeight/3;}};tr.onmouseleave=()=>hot(tr.dataset.k,false);});
  const cp=sec.querySelector('.prompt .copy');if(cp)cp.onclick=()=>{const t=sec.querySelector('.prompt pre').textContent;const done=()=>{cp.textContent='Copied';setTimeout(()=>cp.textContent='Copy prompt',1500);};navigator.clipboard?navigator.clipboard.writeText(t).then(done,()=>{}):0;};
  const r=sec.querySelector('.onion input');if(r)r.oninput=()=>sec.querySelector('.stack .top').style.opacity=r.value/100;
}
</script></body></html>
`;
}

// `only`: the screens verified in this run, so the page shows exactly what was just checked against the current code.
export async function writeReport(pkgDir: string, only?: Set<string>): Promise<{ path: string; screens: number }> {
  const screens = await loadReports(pkgDir, only);
  const path = join(pkgDir, 'verification', 'index.html');
  if (existsSync(join(pkgDir, 'verification'))) await writeFile(path, reportHtml(screens));
  return { path, screens: screens.length };
}
