import { timeGreeting, toBlocks } from './assistant-chat.component';

/* How a reply is laid out in the chat: paragraphs and lists, as text — never HTML. */
test('a lead sentence, then "- " lines as a list and "1." lines as steps', () => {
  expect(toBlocks('Today 65 parts were made.\n- VMC - 12 - F: 40 pcs\n- VMC - 13 - M: 25 pcs\n\nTo download it:\n1. Open Analytics → Reports\n2. Press Excel'))
    .toEqual([
      { p: 'Today 65 parts were made.' },
      { ul: ['VMC - 12 - F: 40 pcs', 'VMC - 13 - M: 25 pcs'] },
      { p: 'To download it:' },
      { ol: ['Open Analytics → Reports', 'Press Excel'] }
    ]);
});

test('markdown bold is dropped and markup stays text', () => {
  expect(toBlocks('**OEE** is 61.2%\n<img src=x onerror=alert(1)>')).toEqual([{ p: 'OEE is 61.2%' }, { p: '<img src=x onerror=alert(1)>' }]);
  expect(toBlocks('')).toEqual([]);
});

/* The greeting follows the plant's clock (Asia/Kolkata), not the browser's. */
test('good morning, afternoon or evening at the plant; hello in the small hours', () => {
  expect(timeGreeting(new Date('2026-10-25T03:30:00Z'))).toBe('Good morning');     // 9:00 am IST
  expect(timeGreeting(new Date('2026-10-25T08:30:00Z'))).toBe('Good afternoon');   // 2:00 pm
  expect(timeGreeting(new Date('2026-10-25T13:30:00Z'))).toBe('Good evening');     // 7:00 pm
  expect(timeGreeting(new Date('2026-10-24T21:00:00Z'))).toBe('Hello');            // 2:30 am
  expect(timeGreeting(new Date('2026-10-24T18:30:00Z'))).toBe('Hello');            // midnight
});
