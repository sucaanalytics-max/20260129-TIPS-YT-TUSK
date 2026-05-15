'use client';

import { useMemo } from 'react';
import type { DataTableRow } from '@/lib/queries';

export function CsvDownload({ rows, filename }: { rows: DataTableRow[]; filename: string }) {
  const href = useMemo(() => buildCsvUrl(rows), [rows]);
  return (
    <a
      href={href}
      download={filename}
      className="border-border text-muted-foreground hover:text-foreground hover:border-foreground/40 rounded-md border px-3 py-1.5 text-xs"
    >
      Download CSV
    </a>
  );
}

function buildCsvUrl(rows: DataTableRow[]): string {
  const header = [
    'date',
    'channel_id',
    'channel_name',
    'company',
    'language',
    'total_views',
    'subscribers',
    'daily_views',
    'daily_subscribers',
  ];
  const escape = (v: unknown) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = rows
    .map((r) =>
      [
        r.date,
        r.channel_id,
        r.channel_name,
        r.company,
        r.language ?? '',
        r.total_views ?? '',
        r.subscribers ?? '',
        r.daily_views ?? '',
        r.daily_subscribers ?? '',
      ]
        .map(escape)
        .join(','),
    )
    .join('\n');
  const csv = `${header.join(',')}\n${body}`;
  return `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;
}
