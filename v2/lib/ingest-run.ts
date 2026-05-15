import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Shared helper for the cron route handlers.
 *
 * Every /api/cron/* invocation opens a row in ops_ingest_run with
 * status='running', then closes it with 'ok' | 'partial' | 'failed' on its way
 * out. The run_id is carried into every fact-row insertion so a row can be
 * traced back to the ingest that produced it. Failures additionally land in
 * ops_error_log.
 */

export type IngestSource =
  | 'youtube_channels'
  | 'youtube_videos'
  | 'stocks'
  | 'corporate_actions'
  | 'seed'
  | 'health';

export interface OpenedRun {
  run_id: number;
  started_at: string;
}

export async function openRun(
  supabase: SupabaseClient,
  source: IngestSource,
): Promise<OpenedRun> {
  const { data, error } = await supabase
    .from('ops_ingest_run')
    .insert({ source, status: 'running' })
    .select('run_id, started_at')
    .single();

  if (error || !data) {
    throw new Error(`openRun(${source}): ${error?.message ?? 'no row returned'}`);
  }
  return { run_id: data.run_id as number, started_at: data.started_at as string };
}

export interface CloseRunInput {
  run_id: number;
  status: 'ok' | 'partial' | 'failed';
  rows_in?: number;
  rows_out?: number;
  detail?: Record<string, unknown>;
}

export async function closeRun(
  supabase: SupabaseClient,
  input: CloseRunInput,
): Promise<void> {
  const { error } = await supabase
    .from('ops_ingest_run')
    .update({
      status: input.status,
      rows_in: input.rows_in ?? null,
      rows_out: input.rows_out ?? null,
      detail: input.detail ?? null,
      ended_at: new Date().toISOString(),
    })
    .eq('run_id', input.run_id);

  if (error) {
    console.error(`closeRun(${input.run_id}): ${error.message}`);
  }
}

export async function logError(
  supabase: SupabaseClient,
  args: {
    error_type: string;
    error_message: string;
    ingest_run_id?: number;
    detail?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await supabase.from('ops_error_log').insert({
      error_type: args.error_type,
      error_message: args.error_message.slice(0, 5000),
      ingest_run_id: args.ingest_run_id ?? null,
      detail: args.detail ?? null,
    });
  } catch (e) {
    console.error(`ops_error_log write failed: ${(e as Error).message}`);
  }
}
