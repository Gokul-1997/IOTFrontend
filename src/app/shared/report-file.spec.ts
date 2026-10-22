import { HttpResponse } from '@angular/common/http';
import { downloadError, saveOrMessage } from './report-file';

/* A download is the file (200), or — for a large report — the message that it is being emailed (202). */
const json = (o: unknown) => new Blob([JSON.stringify(o)], { type: 'application/json' });

test('202: nothing is saved; the email message is what the screen shows', async () => {
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const message = 'This report is large (25,000 rows), so it is being prepared in the background and will be emailed to a@b.test. Please check your email in 10–15 minutes.';
  const res = new HttpResponse<Blob>({ status: 202, body: json({ status: 'success', data: { queued: true, message } }) });
  expect(await saveOrMessage(res, 'x.xlsx')).toBe(message);
  expect(click).not.toHaveBeenCalled();
  click.mockRestore();
});

test('200: the file is saved under its name, and there is no message', async () => {
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const saved: string[] = [];
  click.mockImplementation(function (this: HTMLAnchorElement) { saved.push(this.download); });
  const res = new HttpResponse<Blob>({ status: 200, body: new Blob(['a,b']) });
  expect(await saveOrMessage(res, 'oee-records_2026-10-21_to_2026-10-21.csv')).toBeNull();
  expect(saved).toEqual(['oee-records_2026-10-21_to_2026-10-21.csv']);
  click.mockRestore();
});

test("an error's sentence is read out of its Blob body", async () => {
  expect(await downloadError({ error: json({ message: 'No OEE records match these filters' }) }, 'fallback'))
    .toBe('No OEE records match these filters');
  expect(await downloadError({ error: new Blob(['<html>']) }, 'fallback')).toBe('fallback');
  expect(await downloadError({ error: { message: 'plain' } }, 'fallback')).toBe('plain');
});
