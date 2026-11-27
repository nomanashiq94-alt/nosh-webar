# Nosh WebAR recovery runbook

## Code recovery
Recovery branch: `backup-prelaunch-2026-11-27`. Keep main and multi-restaurant intact. Test recovery in a preview deployment before changing production.

## Database backup
Use the official Supabase CLI backup and restore guide: https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore . Export roles, schema and data following the guide, including application private schemas and required Auth data. Verify the actual schema coverage, grants, RLS, triggers, RPCs and Auth restoration in an isolated project. Never commit dumps, credentials, customer data or secret keys to GitHub. Store encrypted copies offsite. Free projects need manual exports; paid daily backups do not cover Storage file contents.

## Storage and Edge Functions
Copy actual objects from menu-media and restaurant logo buckets, preserving paths and content types. Record bucket configuration and policies. Preserve Edge Function source, deployment settings, allowed origins and secret names; keep secret values in a separate secure password manager. Restore secrets and functions before testing checkout. Never expose service keys in browser code.

## Recovery drill
1. Stop production changes and identify the last known good backup.
2. Restore to an isolated project, never overwrite live data as a first test.
3. Restore files and check menu media URLs, auth mappings, restaurant isolation, subscriptions and ordering.
4. Verify checkout, kitchen realtime, owner analytics and PIN behavior. Keep PIN activation locked until approved testing.
5. Reconcile orders and payments created since backup; schedule cutover and rollback plan before changing production configuration.

## Proposed schedule
Daily encrypted database backup; media backup after changes and daily reconciliation; code checkpoint before releases. Retain 7 daily and 4 weekly copies initially. Review privacy retention obligations before keeping customer data longer. Perform a restore drill before launch and periodically thereafter.

## Status
Code recovery branch created. Database export, media copy, secret inventory and restore drill are NOT yet completed. No automated backup job is configured. See https://supabase.com/docs/guides/platform/backups .
