import { strToU8, zipSync, type Zippable } from 'fflate';
import { slugify } from '../../core/src/normalize';

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
  if (msg.type === 'done') {
    setRunning(false);
    const entries: Zippable = {};
    for (const [path, data] of Object.entries(msg.files as Record<string, string | Uint8Array>))
      entries[`${ROOT}/${path}`] = [typeof data === 'string' ? strToU8(data) : data, { mtime: ZIP_MTIME }];
    const zip = zipSync(entries, { level: 6 });
    const url = URL.createObjectURL(new Blob([zip as BlobPart], { type: 'application/zip' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slugify(msg.fileName)}-f2f.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    const count = Object.keys(msg.files).length;
    status.textContent = `${msg.status === 'complete' ? 'Done' : `Finished with status "${msg.status}"`}: ${count} files, ${(zip.length / 1024).toFixed(0)} KB, extract ${msg.timing.extractMs} ms, package ${msg.timing.packageMs} ms. See reports/extraction-report.json.`;
  }
};
