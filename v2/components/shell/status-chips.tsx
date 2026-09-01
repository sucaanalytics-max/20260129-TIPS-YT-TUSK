import { cacheLife, cacheTag } from 'next/cache';
import { getFreshness, getOpsRunHistory } from '@/lib/queries';
import { CACHE_TAGS } from '@/lib/revalidate';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DAY = 86_400_000;

type Tone = 'good' | 'warn' | 'bad';

const DOT: Record<Tone, string> = {
  good: 'rgb(var(--good))',
  warn: 'rgb(var(--warn))',
  bad: 'rgb(var(--bad))',
};
const TEXT: Record<Tone, string> = {
  good: 'text-muted-foreground',
  warn: 'text-warn',
  bad: 'text-bad',
};

function Chip({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span
      className={`border-border inline-flex items-center gap-[7px] whitespace-nowrap rounded-full border px-2.5 py-[5px] font-mono text-[11px] ${TEXT[tone]}`}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: DOT[tone] }} />
      {children}
    </span>
  );
}

/**
 * The two header chips. The design folds the whole Ops page into these, so they
 * are the only standing signal that the pipeline is healthy — they carry real
 * numbers and a word, never a bare colour.
 *
 * This matters more than it looks: the channel ingest silently wrote zero rows
 * for four days in August while every page kept rendering confidently off a
 * stale series. A chip that reads DATA 4d in amber is what makes that visible
 * without opening anything.
 */
export async function StatusChips() {
  'use cache';
  cacheLife('minutes');
  cacheTag(CACHE_TAGS.ops, CACHE_TAGS.overview);

  const [freshness, runs] = await Promise.all([
    getFreshness(),
    getOpsRunHistory({ limit: 60 }),
  ]);

  // Freshness is the OLDEST of the core series, not the newest: the dashboard is
  // only as current as the series that lags most.
  const dates = freshness
    .map((f) => f.latest_date)
    .filter((d): d is string => typeof d === 'string' && d.length > 0)
    .sort();
  const oldest = dates[0] ?? null;

  let dataTone: Tone = 'good';
  let dataLabel = 'DATA —';
  if (oldest) {
    const lagDays = Math.max(
      0,
      Math.round((Date.now() - Date.parse(`${oldest}T00:00:00Z`)) / DAY),
    );
    const [, m, d] = oldest.split('-');
    dataLabel = `DATA ${Number(d)} ${MONTHS[Number(m) - 1]} · ${lagDays}d`;
    dataTone = lagDays <= 1 ? 'good' : lagDays <= 3 ? 'warn' : 'bad';
  } else {
    dataTone = 'bad';
  }

  // One row per source, most recent run wins.
  const latestBySource = new Map<string, string>();
  for (const r of runs) {
    if (!latestBySource.has(r.source)) latestBySource.set(r.source, r.status);
  }
  const total = latestBySource.size;
  const healthy = [...latestBySource.values()].filter((s) => s === 'ok').length;
  const pipeTone: Tone = total === 0 ? 'bad' : healthy === total ? 'good' : healthy >= total - 1 ? 'warn' : 'bad';

  return (
    <>
      <Chip tone={dataTone}>{dataLabel}</Chip>
      <Chip tone={pipeTone}>{total === 0 ? 'PIPELINE —' : `PIPELINE ${healthy}/${total}`}</Chip>
    </>
  );
}

export function StatusChipsSkeleton() {
  return (
    <>
      <span className="border-border bg-surface2/60 h-[26px] w-[124px] animate-pulse rounded-full border" />
      <span className="border-border bg-surface2/60 h-[26px] w-[96px] animate-pulse rounded-full border" />
    </>
  );
}
