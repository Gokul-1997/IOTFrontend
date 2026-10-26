/*
 * The design's four OEE grades, one definition for every page that grades
 * OEE (the OEE Dashboard's machine tiles, Operator Performance's OEE card):
 * > 85 Excellent · 75–85 Good · 60–75 Avg · < 60 Needs Improvement.
 * The colours are the global .mexa-grade-* classes (--band, --band-ink).
 */
export type OeeGrade = 'EXCELLENT' | 'GOOD' | 'AVG' | 'POOR' | 'UNKNOWN';

export function oeeGrade(oee: number | null | undefined): OeeGrade {
  if (oee === null || oee === undefined || !Number.isFinite(Number(oee))) return 'UNKNOWN';
  const v = Number(oee);
  return v >= 85 ? 'EXCELLENT' : v >= 75 ? 'GOOD' : v >= 60 ? 'AVG' : 'POOR';
}

const CLASS: Record<OeeGrade, string> = {
  EXCELLENT: 'mexa-grade-excellent', GOOD: 'mexa-grade-good', AVG: 'mexa-grade-avg', POOR: 'mexa-grade-poor', UNKNOWN: 'mexa-grade-unknown'
};
const WORD: Record<OeeGrade, string> = {
  EXCELLENT: 'Excellent', GOOD: 'Good', AVG: 'Avg', POOR: 'Needs Improvement', UNKNOWN: 'No cycle time'
};

export const oeeGradeClass = (g: OeeGrade): string => CLASS[g] ?? CLASS.UNKNOWN;
export const oeeGradeWord = (g: OeeGrade): string => WORD[g] ?? WORD.UNKNOWN;
