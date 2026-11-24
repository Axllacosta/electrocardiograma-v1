import type { QualityLevel } from '../analysis/quality.ts';

const TEXT: Record<QualityLevel, string> = { good: 'Buena', fair: 'Regular', poor: 'Mala' };
const HELP: Record<QualityLevel, string> = {
  good: 'Pulsos limpios y regulares: los valores son fiables.',
  fair: 'Algunos pulsos irregulares: los valores son aproximados.',
  poor: 'Pulsos deformados por movimiento o mala colocación: no te fíes de los valores.',
};

export function QualityBadge({ level }: { level: QualityLevel | null }) {
  if (level === null) return <span className="quality quality-none">–</span>;
  return (
    <span className={`quality quality-${level}`} title={HELP[level]}>
      {TEXT[level]}
    </span>
  );
}
