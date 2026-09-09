/**
 * Paged reads, because Supabase truncates silently.
 *
 * PostgREST applies a 1000-row cap to any request that does not page. It does
 * not error and it does not warn — it returns the first 1000 rows in whatever
 * order was asked for and looks entirely normal. Every consequence is therefore
 * a WRONG NUMBER rather than a missing one, which is the worst failure mode a
 * dashboard can have.
 *
 * This has now caused three separate production defects in this codebase, the
 * worst of which ran `daily_views` at 3x to 26x the truth for nine days before
 * anyone noticed. Use this for any read whose result can exceed ~1000 rows, and
 * assume it can unless the table is a small dimension.
 *
 * Two properties make it safe:
 *   - it pages until a short page proves the end, so it cannot stop early;
 *   - it THROWS at maxPages rather than returning what it has, because a
 *     partial answer is indistinguishable from a complete one downstream.
 *
 * The caller supplies the ordering. It must be a TOTAL order — a single column
 * with ties (e.g. `date` alone across many channels) lets rows shift between
 * pages, so a paged read can repeat or skip. Order by enough columns to break
 * every tie.
 */

export interface PagedResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

export async function pageAll<T>(
  /** Builds one page. `from`/`to` are inclusive row offsets for `.range()`. */
  makePage: (from: number, to: number) => PromiseLike<PagedResult<T>>,
  opts: {
    /** Named in the error, so a failure says which read blew up. */
    label: string;
    pageSize?: number;
    maxPages?: number;
  },
): Promise<T[]> {
  const pageSize = opts.pageSize ?? 1000;
  const maxPages = opts.maxPages ?? 50;
  const out: T[] = [];

  for (let page = 0; ; page++) {
    if (page >= maxPages) {
      throw new Error(
        `${opts.label}: paged read exceeded ${maxPages * pageSize} rows. ` +
          `Refusing to return a truncated result — narrow the filter or raise maxPages deliberately.`,
      );
    }
    const from = page * pageSize;
    const { data, error } = await makePage(from, from + pageSize - 1);
    if (error) {
      throw new Error(`${opts.label}: paged read failed at offset ${from} — ${error.message}`);
    }
    const rows = data ?? [];
    out.push(...rows);
    // A short page is the only proof of the end. An exactly-full page might be
    // the last one, so it costs one extra empty request to be sure.
    if (rows.length < pageSize) return out;
  }
}
