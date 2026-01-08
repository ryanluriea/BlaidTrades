-- RESUME CRON JOBS
-- Run this when ready to re-enable autonomy features
-- Recommended: Enable in batches, monitoring for PGRST002 errors

-- ============================================
-- PHASE 1: Essential job processing (start here)
-- ============================================

SELECT cron.schedule(
  'job-dispatcher-every-minute',
  '* * * * *',
  $$SELECT net.http_post(
    url := 'https://oxkjdoltkazipawcgmtg.supabase.co/functions/v1/job-dispatcher',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{"mode": "SCHEDULER"}'::jsonb
  ) AS request_id;$$
);

SELECT cron.schedule(
  'job-watchdog-every-minute',
  '* * * * *',
  $$SELECT net.http_post(
    url := 'https://oxkjdoltkazipawcgmtg.supabase.co/functions/v1/job-watchdog',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );$$
);

SELECT cron.schedule(
  'process-bot-jobs-every-minute',
  '* * * * *',
  $$SELECT net.http_post(
    url := 'https://oxkjdoltkazipawcgmtg.supabase.co/functions/v1/job-processor',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;$$
);

-- ============================================
-- PHASE 2: Health monitoring (after Phase 1 stable)
-- ============================================

SELECT cron.schedule(
  'health-score-2m',
  '*/2 * * * *',
  $$SELECT net.http_post(
    url := 'https://oxkjdoltkazipawcgmtg.supabase.co/functions/v1/compute-health-score',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{"mode": "SCHEDULER"}'::jsonb
  )$$
);

SELECT cron.schedule(
  'kill-engine-check',
  '*/2 * * * *',
  $$SELECT net.http_post(
    url:='https://oxkjdoltkazipawcgmtg.supabase.co/functions/v1/kill-engine',
    headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im94a2pkb2x0a2F6aXBhd2NnbXRnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU1MDM1NzcsImV4cCI6MjA4MTA3OTU3N30.YGHJEPpI0Q49wsFejf3qPqYulJEDCLHlJmplFJVZFlk"}'::jsonb,
    body:='{}'::jsonb
  ) AS request_id;$$
);

-- ============================================
-- PHASE 3: Autonomy engines (after Phase 2 stable)
-- ============================================

SELECT cron.schedule(
  'capital-allocator-5m',
  '*/5 * * * *',
  $$SELECT net.http_post(
    url := 'https://oxkjdoltkazipawcgmtg.supabase.co/functions/v1/capital-allocator',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{"mode": "SCHEDULER"}'::jsonb
  )$$
);

SELECT cron.schedule(
  'demotion-engine-5m',
  '*/5 * * * *',
  $$SELECT net.http_post(
    url := 'https://oxkjdoltkazipawcgmtg.supabase.co/functions/v1/demotion-engine',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{"mode": "SCHEDULER"}'::jsonb
  )$$
);

SELECT cron.schedule(
  'promotion-engine-5min',
  '*/5 * * * *',
  $$SELECT net.http_post(
    url := 'https://oxkjdoltkazipawcgmtg.supabase.co/functions/v1/promotion-engine',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{"mode": "SCHEDULER"}'::jsonb
  ) AS request_id;$$
);

SELECT cron.schedule(
  'priority-compute-5min',
  '*/5 * * * *',
  $$SELECT net.http_post(
    url := 'https://oxkjdoltkazipawcgmtg.supabase.co/functions/v1/priority-compute',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{"mode": "SCHEDULER"}'::jsonb
  ) AS request_id;$$
);

-- ============================================
-- PHASE 4: Backtests and evolution (after Phase 3 stable)
-- ============================================

SELECT cron.schedule(
  'backtest-scheduler-every-minute',
  '* * * * *',
  $$SELECT net.http_post(
    url := 'https://oxkjdoltkazipawcgmtg.supabase.co/functions/v1/backtest-scheduler',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;$$
);

SELECT cron.schedule(
  'evolution-engine-auto-evolve',
  '*/10 * * * *',
  $$SELECT net.http_post(
    url := 'https://oxkjdoltkazipawcgmtg.supabase.co/functions/v1/evolution-engine',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{"mode": "SCHEDULER", "auto_evolve": true}'::jsonb
  );$$
);

-- ============================================
-- PHASE 5: Strategy Lab (after Phase 4 stable)
-- ============================================

SELECT cron.schedule(
  'strategy-lab-dispatcher-every-minute',
  '* * * * *',
  $$SELECT net.http_post(
    url:='https://oxkjdoltkazipawcgmtg.supabase.co/functions/v1/strategy-lab-dispatcher',
    headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im94a2pkb2x0a2F6aXBhd2NnbXRnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU1MDM1NzcsImV4cCI6MjA4MTA3OTU3N30.YGHJEPpI0Q49wsFejf3qPqYulJEDCLHlJmplFJVZFlk"}'::jsonb,
    body:='{}'::jsonb
  ) as request_id;$$
);

SELECT cron.schedule(
  'strategy-lab-watchdog-every-minute',
  '* * * * *',
  $$SELECT net.http_post(
    url:='https://oxkjdoltkazipawcgmtg.supabase.co/functions/v1/strategy-lab-watchdog',
    headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im94a2pkb2x0a2F6aXBhd2NnbXRnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU1MDM1NzcsImV4cCI6MjA4MTA3OTU3N30.YGHJEPpI0Q49wsFejf3qPqYulJEDCLHlJmplFJVZFlk"}'::jsonb,
    body:='{}'::jsonb
  ) as request_id;$$
);

-- ============================================
-- PHASE 6: Remaining jobs (after all phases stable)
-- ============================================

SELECT cron.schedule(
  'kill-engine-every-minute',
  '* * * * *',
  $$SELECT net.http_post(
    url := 'https://oxkjdoltkazipawcgmtg.supabase.co/functions/v1/kill-engine',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  )$$
);

SELECT cron.schedule(
  'pause-resolver-every-minute',
  '* * * * *',
  $$SELECT net.http_post(
    url := 'https://oxkjdoltkazipawcgmtg.supabase.co/functions/v1/pause-resolver',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;$$
);

SELECT cron.schedule(
  'reconcile-execution-every-minute',
  '* * * * *',
  $$SELECT net.http_post(
    url := 'https://oxkjdoltkazipawcgmtg.supabase.co/functions/v1/reconcile-bot-execution',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{"mode": "SCHEDULER"}'::jsonb
  ) AS request_id;$$
);

SELECT cron.schedule(
  'ai-telemetry-rollup',
  '*/5 * * * *',
  $$SELECT net.http_post(
    url:='https://oxkjdoltkazipawcgmtg.supabase.co/functions/v1/ai-telemetry-rollup',
    headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im94a2pkb2x0a2F6aXBhd2NnbXRnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU1MDM1NzcsImV4cCI6MjA4MTA3OTU3N30.YGHJEPpI0Q49wsFejf3qPqYulJEDCLHlJmplFJVZFlk"}'::jsonb,
    body:='{}'::jsonb
  ) AS request_id;$$
);

SELECT cron.schedule(
  'autonomy-contract-check',
  '*/5 * * * *',
  $$SELECT net.http_post(
    url:='https://oxkjdoltkazipawcgmtg.supabase.co/functions/v1/autonomy-contract',
    headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im94a2pkb2x0a2F6aXBhd2NnbXRnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU1MDM1NzcsImV4cCI6MjA4MTA3OTU3N30.YGHJEPpI0Q49wsFejf3qPqYulJEDCLHlJmplFJVZFlk"}'::jsonb,
    body:='{"action": "verify"}'::jsonb
  ) AS request_id;$$
);
