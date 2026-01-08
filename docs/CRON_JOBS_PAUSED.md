# Paused Cron Jobs - 2025-12-16

## Reason
High-frequency cron jobs were causing a PGRST002/503 spiral by hammering the PostgREST schema cache during a transient DB stress event.

## Jobs Removed (19 total)

### Every Minute (10 jobs)
| Job ID | Name | Schedule |
|--------|------|----------|
| 23 | backtest-scheduler-every-minute | `* * * * *` |
| 24 | job-dispatcher-every-minute | `* * * * *` |
| 16 | job-watchdog-every-minute | `* * * * *` |
| 13 | kill-engine-every-minute | `* * * * *` |
| 39 | pause-resolver-check | `* * * * *` |
| 29 | pause-resolver-every-minute | `* * * * *` |
| 31 | process-bot-jobs-every-minute | `* * * * *` |
| 33 | reconcile-execution-every-minute | `* * * * *` |
| 43 | strategy-lab-dispatcher-every-minute | `* * * * *` |
| 44 | strategy-lab-watchdog-every-minute | `* * * * *` |

### Every 2 Minutes (2 jobs)
| Job ID | Name | Schedule |
|--------|------|----------|
| 19 | health-score-2m | `*/2 * * * *` |
| 38 | kill-engine-check | `*/2 * * * *` |

### Every 5 Minutes (6 jobs)
| Job ID | Name | Schedule |
|--------|------|----------|
| 40 | ai-telemetry-rollup | `*/5 * * * *` |
| 35 | autonomy-contract-check | `*/5 * * * *` |
| 17 | capital-allocator-5m | `*/5 * * * *` |
| 18 | demotion-engine-5m | `*/5 * * * *` |
| 30 | priority-compute-5min | `*/5 * * * *` |
| 32 | promotion-engine-5min | `*/5 * * * *` |

### Every 10 Minutes (1 job)
| Job ID | Name | Schedule |
|--------|------|----------|
| 15 | evolution-engine-auto-evolve | `*/10 * * * *` |

## Jobs Still Active (12 jobs - all daily/weekly)
- bqs-compute-periodic (*/30 during market hours)
- tournament-incremental (every 2 hours)
- daily-bot-snapshots (daily 2am)
- night-report-weekdays (daily 11pm)
- weekly-chaos-test (weekly)
- graduation-evaluation-daily
- tournament-daily-major
- daily-production-scorecard
- production-scorecard-daily  
- weekly-archetype-certification
- morning-briefing-weekdays
- readiness-audit-daily-8am

## To Resume Jobs
Run the SQL in `docs/RESUME_CRON_JOBS.sql` when ready to re-enable autonomy features.
