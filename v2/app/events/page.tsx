import { Suspense } from 'react';
import { cacheLife, cacheTag } from 'next/cache';
import { getEventStudy, getEventTimeline } from '@/lib/queries';
import { EventStudyChart } from '@/components/charts/event-study';
import { CACHE_TAGS } from '@/lib/revalidate';

const EVENT_TYPES = ['release', 'earnings', 'split', 'bonus', 'dividend'];

interface Search { type?: string }

export default function EventsPage({ searchParams }: { searchParams: Promise<Search> }) {
  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Events</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Event-study CAR over [-5, +5] trading days vs NIFTY MIDCAP 150 · bootstrap 95% CI
        </p>
        <Suspense fallback={<div className="mt-4 h-8" />}>
          <TypeTabs searchParams={searchParams} />
        </Suspense>
      </header>

      <section className="space-y-8">
        <Suspense fallback={<Skeleton />}>
          <StudyWrapper searchParams={searchParams} />
        </Suspense>
        <Suspense fallback={<Skeleton />}>
          <TimelineWrapper searchParams={searchParams} />
        </Suspense>
      </section>
    </main>
  );
}

async function TypeTabs({ searchParams }: { searchParams: Promise<Search> }) {
  const { type } = await searchParams;
  const selected = type && EVENT_TYPES.includes(type) ? type : 'release';
  return (
    <div className="mt-4 flex flex-wrap gap-2 text-xs">
      {EVENT_TYPES.map((t) => (
        <a
          key={t}
          href={`/events?type=${t}`}
          className={`rounded-md border px-2.5 py-1 ${
            t === selected
              ? 'border-blue-500 bg-blue-500/20 text-blue-200'
              : 'border-border text-muted-foreground'
          }`}
        >
          {t}
        </a>
      ))}
    </div>
  );
}

async function StudyWrapper({ searchParams }: { searchParams: Promise<Search> }) {
  const { type } = await searchParams;
  const selected = type && EVENT_TYPES.includes(type) ? type : 'release';
  return <StudyBlock eventType={selected} />;
}

async function StudyBlock({ eventType }: { eventType: string }) {
  'use cache';
  cacheLife('hours');
  cacheTag(CACHE_TAGS.events);
  const rows = await getEventStudy({ eventType });
  return <EventStudyChart rows={rows} eventType={eventType} />;
}

async function TimelineWrapper({ searchParams }: { searchParams: Promise<Search> }) {
  const { type } = await searchParams;
  const selected = type && EVENT_TYPES.includes(type) ? type : 'release';
  return <TimelineBlock eventType={selected} />;
}

async function TimelineBlock({ eventType }: { eventType: string }) {
  'use cache';
  cacheLife('hours');
  cacheTag(CACHE_TAGS.events);
  const rows = await getEventTimeline({ eventType });
  if (!rows.length) {
    return (
      <div className="border-border bg-card text-muted-foreground rounded-lg border p-6 text-sm">
        no &lsquo;{eventType}&rsquo; events in last 365 days
      </div>
    );
  }
  return (
    <div className="border-border bg-card overflow-x-auto rounded-lg border">
      <header className="border-border border-b px-4 py-3">
        <h2 className="text-foreground text-sm font-medium">Recent {eventType} events</h2>
        <p className="text-muted-foreground text-xs">Top 500 by date</p>
      </header>
      <table className="w-full text-sm">
        <thead className="border-border text-muted-foreground border-b text-left text-xs uppercase tracking-wider">
          <tr>
            <th className="px-4 py-3">Date</th>
            <th className="px-4 py-3">Label</th>
            <th className="px-4 py-3">Channel / company</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.event_id} className="border-border/40 hover:bg-muted/30 border-b last:border-0">
              <td className="px-4 py-2 font-mono text-xs">{r.event_date}</td>
              <td className="px-4 py-2 text-xs">{r.label}</td>
              <td className="text-muted-foreground px-4 py-2 text-xs">
                {r.company ?? r.channel_id ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Skeleton() {
  return <div className="border-border bg-card/50 h-64 animate-pulse rounded-lg border" />;
}
