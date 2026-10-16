-- Re-run inserts its upload event as service_role (lib/ingest/rerun.ts), which has no usage on
-- change_control (20261014010000_change_control.sql). This trigger ran with the caller's rights,
-- so its call to change_control.current_person_id() failed with "permission denied for schema
-- change_control". Run it with its owner's rights, like shift_events_initialize_workflow.
alter function change_control.stamp_event_person() security definer;
