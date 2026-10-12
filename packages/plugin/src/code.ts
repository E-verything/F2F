import { callStats, extract, type ExtractOptions } from './extract';

const UI_SIZE = { width: 360, height: 420 };

let cancelRequested = false;
let running = false;

figma.showUI(__html__, { ...UI_SIZE, themeColors: true });
figma.ui.postMessage({ type: 'selection', count: figma.currentPage.selection.length });
figma.on('selectionchange', () => figma.ui.postMessage({ type: 'selection', count: figma.currentPage.selection.length }));

figma.ui.onmessage = async (msg: { type: 'export'; options: ExtractOptions } | { type: 'cancel' } | { type: 'close' }) => {
  if (msg.type === 'cancel') cancelRequested = true;
  if (msg.type === 'close') figma.closePlugin();
  if (msg.type !== 'export' || running) return;
  running = true;
  cancelRequested = false;
  const t0 = Date.now();
  try {
    const snap = await extract(msg.options, {
      progress: (message, done, total) => figma.ui.postMessage({ type: 'progress', message, done, total }),
      cancelled: () => cancelRequested,
    });
    const t1 = Date.now();
    console.log(`[F2F] extract done in ${t1 - t0} ms: ${snap.assets.length} assets, ${snap.components.length} components, status ${snap.status}`);
    for (const [what, s] of Object.entries(callStats)) console.log(`[F2F]   ${what}: ${s.count} calls, ${s.ms} ms total, ${s.timeouts} timeouts`);
    console.log(`[F2F]   raw JSON_REST_V1 screens: ${Object.keys(snap.restJson ?? {}).length}`);
    // Packaging runs in the UI iframe: the same buildPackage took 5+ min in this sandbox vs ~14 s on a JIT engine.
    console.log('[F2F] sending snapshot to UI…');
    const t2 = Date.now();
    figma.ui.postMessage({ type: 'snapshot', snap, extractMs: t1 - t0 });
    console.log(`[F2F] postMessage returned after ${Date.now() - t2} ms`);
  } catch (e) {
    console.error('[F2F] export failed', e);
    figma.ui.postMessage({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  } finally {
    running = false;
  }
};
