import { buildPackage } from '../../core/src/package';
import { extract, type ExtractOptions } from './extract';

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
    figma.ui.postMessage({ type: 'progress', message: 'Building package', done: 0, total: 0 });
    const files = buildPackage(snap, { exportedAt: new Date().toISOString(), timing: { extractMs: t1 - t0 } });
    const timing = { extractMs: t1 - t0, packageMs: Date.now() - t1 };
    figma.ui.postMessage({ type: 'done', files, status: snap.status, timing, fileName: snap.file.name });
  } catch (e) {
    figma.ui.postMessage({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  } finally {
    running = false;
  }
};
