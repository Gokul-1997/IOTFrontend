import { pageKey } from './page-identity';

describe('pageKey', () => {
  it('names the live floor and the machine page apart', () => {
    expect(pageKey('/dashboard')).toBe('live');
    expect(pageKey('/dashboard/live/7')).toBe('machine');
  });

  it('shortens the long addresses and ignores the query and fragment', () => {
    expect(pageKey('/oee-dashboard?machine=3')).toBe('oee');
    expect(pageKey('/energy-tariff#limits')).toBe('tariff');
    expect(pageKey('/operator-performance')).toBe('operator-perf');
  });

  it('keeps a section for its sub-pages', () => {
    expect(pageKey('/machines/create')).toBe('machines');
    expect(pageKey('/admin/users')).toBe('admin');
    expect(pageKey('/security/2fa')).toBe('security');
  });

  it('uses the first segment for everything else', () => {
    expect(pageKey('/quality')).toBe('quality');
    expect(pageKey('/')).toBe('');
  });
});
