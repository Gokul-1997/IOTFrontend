import { Reports } from './reports';

describe('Production report energy evidence', () => {
  const energyKpi = (total_energy: number | string | null | undefined) =>
    (Reports.prototype as any).buildKpis('production', { total_energy })
      .find((card: { label: string }) => card.label === 'Total Energy');

  it('keeps unknown energy visibly different from a measured zero', () => {
    expect(energyKpi(null).value).toBe('--');
    expect(energyKpi(undefined).value).toBe('--');
    expect(energyKpi(0).value).toBe('0');
    expect(energyKpi('0.00').value).toBe('0');
  });

  it('formats measured energy without changing the unit or rounding the source', () => {
    expect(energyKpi('1234.567').value).toBe('1,234.57');
    expect(energyKpi('1234.567').unit).toBe('kWh');
  });
});
