import { strToU8, zipSync, type Zippable } from 'fflate';
import { slugify } from '../../core/src/normalize';
import { buildPackage, type PackageFiles } from '../../core/src/package';
import type { RawSnapshot } from '../../core/src/raw';

// Fixed zip entry time so identical packages produce byte-identical archives.
const ZIP_MTIME = new Date('2000-01-01T00:00:00Z');
const ROOT = 'f2f';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const post = (msg: unknown) => parent.postMessage({ pluginMessage: msg }, '*');

const exportBtn = $<HTMLButtonElement>('export');
const cancelBtn = $<HTMLButtonElement>('cancel');
const status = $('status');
const bar = $<HTMLProgressElement>('bar');

function setRunning(running: boolean) {
  exportBtn.disabled = running;
  cancelBtn.hidden = !running;
  bar.hidden = !running;
}

exportBtn.onclick = () => {
  const scope = (document.querySelector('input[name=scope]:checked') as HTMLInputElement).value;
  setRunning(true);
  status.textContent = 'Starting…';
  post({ type: 'export', options: { scope, screenshots: $<HTMLInputElement>('screenshots').checked, restJson: $<HTMLInputElement>('rest').checked } });
};
cancelBtn.onclick = () => {
  status.textContent = 'Cancelling after the current layer…';
  post({ type: 'cancel' });
};

window.onmessage = (e: MessageEvent) => {
  const msg = e.data.pluginMessage;
  if (!msg) return;
  if (msg.type === 'selection') $('selcount').textContent = String(msg.count);
  if (msg.type === 'progress') {
    status.textContent = msg.message;
    if (msg.total) bar.value = msg.done / msg.total;
    else bar.removeAttribute('value');
  }
  if (msg.type === 'error') {
    setRunning(false);
    status.textContent = `Error: ${msg.message}`;
  }
  if (msg.type === 'snapshot') console.log('[F2F] UI received snapshot');
  if (msg.type === 'snapshot') void packageAndDownload(msg.snap as RawSnapshot, msg.extractMs as number);
};

// Each step is synchronous; yielding first lets the status message paint.
const paint = (text: string) => {
  status.textContent = text;
  bar.removeAttribute('value');
  return new Promise((r) => setTimeout(r, 50));
};

async function packageAndDownload(snap: RawSnapshot, extractMs: number) {
  try {
    await paint('Building package…');
    const t0 = Date.now();
    const files = buildPackage(snap, { exportedAt: new Date().toISOString(), timing: { extractMs } });
    const packageMs = Date.now() - t0;
    console.log(`[F2F] package built in ${packageMs} ms: ${Object.keys(files).length} files`);
    await paint(`Zipping ${Object.keys(files).length} files…`);
    download({ files, status: snap.status, timing: { extractMs, packageMs }, fileName: snap.file.name });
  } catch (err) {
    console.error('[F2F] packaging failed', err);
    status.textContent = `Error while packaging: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    setRunning(false);
  }
}

function download(msg: { files: PackageFiles; status: string; timing: { extractMs: number; packageMs: number }; fileName: string }) {
  const t0 = Date.now();
  const entries: Zippable = {};
  for (const [path, data] of Object.entries(msg.files as Record<string, string | Uint8Array>))
    entries[`${ROOT}/${path}`] = [typeof data === 'string' ? strToU8(data) : data, { mtime: ZIP_MTIME }];
  const zip = zipSync(entries, { level: 6 });
  console.log(`[F2F] zipped ${(zip.length / 1e6).toFixed(1)} MB in ${Date.now() - t0} ms`);
  const url = URL.createObjectURL(new Blob([zip as BlobPart], { type: 'application/zip' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${slugify(msg.fileName)}-f2f.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  const count = Object.keys(msg.files).length;
  status.textContent = `${msg.status === 'complete' ? 'Done' : `Finished with status "${msg.status}"`}: ${count} files, ${(zip.length / 1024).toFixed(0)} KB, extract ${msg.timing.extractMs} ms, package ${msg.timing.packageMs} ms. See reports/extraction-report.json.`;
}
