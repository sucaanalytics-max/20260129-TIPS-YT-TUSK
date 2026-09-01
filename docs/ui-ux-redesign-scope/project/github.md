repo: sucaanalytics-max/20260129-TIPS-YT-TUSK
branch: main
path: v2

## Last sync

date: 2026-09-01T04:22:00Z

### Updated in this project

- Recreated the live v2 dashboard shell (14-tab nav, dark tokens) plus Overview, Signals, Nowcast, Channels and Ops screens.
- Redesigned the IA from 14 flat tabs into 4 tabs — Monitor / Explain / Forecast / Evidence — with Ops folded into a status chip.
- Added a light theme alongside the existing dark token set, using the repo's validated chart palette.
- Replaced standing methodology prose with expand-on-demand disclosure.

## Screen map

| Project screen | Repo files |
| --- | --- |
| Current — TUSK v2 · shell + nav | v2/app/layout.tsx, v2/components/nav.tsx, v2/app/globals.css, v2/tailwind.config.ts |
| Current — TUSK v2 · Overview | v2/app/page.tsx, v2/components/overview/dual-symbol-kpi-strip.tsx, v2/components/overview/dual-symbol-chart.tsx, v2/components/overview/pipeline-pulse.tsx, v2/components/breakdowns/company-growth.tsx, v2/components/signals/event-horizon-strip.tsx, v2/components/stock/range-selector.tsx, v2/components/freshness-badge.tsx, v2/components/charts/sparkline.tsx |
| Current — TUSK v2 · Signals | v2/app/signals/page.tsx, v2/components/signals/read-card.tsx, v2/components/signals/signal-grid.tsx |
| Current — TUSK v2 · Nowcast | v2/app/nowcast/page.tsx, v2/components/nowcast/estimate-column.tsx |
| Current — TUSK v2 · Channels | v2/app/channels/page.tsx, v2/components/breakdowns/channel-leaderboard.tsx |
| Current — TUSK v2 · Ops | v2/app/ops/page.tsx, v2/components/ops/run-history.tsx, v2/components/ops/data-quality.tsx |
| Redesign — TUSK | all of the above + v2/lib/chart-palette.ts, v2/lib/stock-range.ts, v2/README.md |
