import { HttpResponse } from '@angular/common/http';

/*
 * A Reports download answers one of two ways (21 Oct 2026, the user: large
 * data is not downloaded — it is built in the background and emailed):
 *
 *   200  the file — saved under the name given;
 *   202  { data: { message } } — the report is large and is being emailed;
 *        the message ("…check your email in 10–15 minutes") is all the
 *        screen shows.
 *
 * Both arrive as a Blob (the request asks for one), so the 202's JSON is
 * read out of it. An error's body is a Blob too, for the same reason.
 */

/** Save the file, or return the "it is being emailed" message (null when saved). */
export async function saveOrMessage(res: HttpResponse<Blob>, filename: string): Promise<string | null> {
  if (res.status === 202) {
    const body = await readJson(res.body);
    return body?.data?.message || 'This report is large, so it will be emailed to you. Please check your email in 10–15 minutes.';
  }
  if (res.body) saveBlob(res.body, filename);
  return null;
}

/** The server's sentence for a failed download, or `fallback`. */
export async function downloadError(err: any, fallback: string): Promise<string> {
  const body = err?.error instanceof Blob ? await readJson(err.error) : err?.error;
  return body?.message || fallback;
}

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function readJson(blob: Blob | null | undefined): Promise<any> {
  if (!blob) return null;
  try { return JSON.parse(await blobText(blob)); } catch { return null; }
}

/** Blob.text(), or FileReader where a Blob has no text() (older engines, jsdom). */
function blobText(blob: Blob): Promise<string> {
  if (typeof blob.text === 'function') return blob.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}
