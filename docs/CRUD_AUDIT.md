# CRUD Audit

This document identifies every feature that is still pure data management — storing and retrieving records without any meaningful automated action following from the stored data. Each entry describes what's actually built, what's genuinely missing, and a rough effort estimate to close the gap.

---

## Still Pure CRUD

### 1. Vuln Tracker — `/security/vuln-tracker`

**What the UI lets you do:**
Filter tracked vulnerabilities by status (Open / In Progress / Fixed / Won't Fix) and package name. Update the status of any item via a dropdown. Click "Mark Fixed" as a shortcut. The page shows an "Overdue" count for items where `dueDate < today` and the status is not terminal.

**What's genuinely missing:**
The overdue count is a passive visual indicator only. Nothing acts on it. There are no automated reminders when a due date passes — no Slack DM to the assigned team, no status escalation (e.g. auto-promote to a higher severity bucket after X days without movement), and no webhook or EventBridge event published when an item becomes overdue. The `alert-evaluator` Lambda has a `critical_vuln` evaluator condition, but it evaluates raw npm audit findings, not the tracking items, so the tracker's due dates and assignment data are entirely disconnected from the alert pipeline.

**Effort to close the gap:**
Medium. The `alert-evaluator` needs a new evaluator function that queries the `wep-security-*` table for items where `dueDate < today AND status IN (open, in_progress)`, groups them by assigned team, and publishes a Slack message per team listing their overdue items. An EventBridge schedule rule at a daily cadence is enough. The `notifySubscribers` fan-out already exists in the Lambda — adding a `vuln_overdue` condition would reuse it.

---

### 2. Service Subscriptions — `/notify/subscriptions`

**What the UI lets you do:**
Subscribe a user to a service for one or more event types (`deploy`, `drift`, `ownership_change`). Delete subscriptions. View all active subscriptions.

**What's genuinely missing:**
The `deploy` and `drift` subscription event types are wired: the `alert-evaluator` Lambda calls `notifySubscribers` for `deploy_failed` and `config_drift` conditions when a matching alert rule fires. However, the `ownership_change` event type is stored in DynamoDB but is never published — no code in any router, Lambda, or scanner emits an ownership change event. A user who subscribes to ownership changes will never receive a notification. Additionally, a `deploy` subscription is only effective if a `deploy_failed` alert rule also exists for the relevant service; the subscription table is not consulted by any other path.

**Effort to close the gap:**
Small for ownership changes. The service catalog router already handles service `PATCH` operations. When the `ownerTeamId` field changes, publish an EventBridge event `service-catalog.service.ownership_changed` and add a handler in the `alert-evaluator` (or the API itself) that calls `notifySubscribers` with event type `ownership_change`. The `notifySubscribers` function already exists and handles the Slack DM fan-out — the only work is the publish trigger and the condition mapping.

---

### 3. On-Call Schedule — `/oncall/schedule`

**What the UI lets you do:**
Set the primary and secondary on-call engineer for a team by week. Edit existing assignments. View the current week's schedule.

**What's genuinely missing:**
The schedule is stored but never consulted by anything. When an incident is created on `/oncall/incidents`, the `commanderId` is set manually by whoever opens the incident — it is not auto-populated from the schedule. There is no automated Slack notification when a new week's on-call rotation begins (a "you are now on call" DM). The `oncall_shift` alert rule condition exists in `AlertRulesPage.tsx` but the `alert-evaluator` does not have a corresponding evaluator function — it only has `deploy_failed`, `p1_incident`, `cost_spike`, `critical_vuln`, and `config_drift` evaluators.

**Effort to close the gap:**
Small to medium. Add a weekly EventBridge schedule rule that invokes the `alert-evaluator` (or a dedicated Lambda) to query the `wep-on-call-*` table for the current week's entries and DM each primary/secondary engineer their assignment via `chat.postMessage`. Optionally, wire the incident creation flow to auto-populate `commanderId` by looking up the current week's primary for the incident's `assignedTeamId`.

---

### 4. Announcements — `/announcements`

**What the UI lets you do:**
Create announcements with a title, body, severity (info / warning / critical), and author. View all announcements in reverse-chronological order.

**What's genuinely missing:**
Announcements are stored in DynamoDB and displayed in the web UI, but they are never broadcast to Slack. The `notify-router.ts` has a `broadcastChannel` helper function that selects the correct Slack channel based on message type (incident → `#incidents`, maintenance → `#engineering`, release → `#releases`), and it uses the Slack `WebClient` directly. The announcements router is separate and does not call that helper. An `info`-severity announcement posted by an engineer has no effect outside the platform.

**Effort to close the gap:**
Small. On announcement creation in the API router, call `slackClient.chat.postMessage` to the appropriate channel based on severity (`critical` → `#incidents`, `warning` → `#engineering`, `info` → `#general`). This is a single async call after the DynamoDB `PutItem` succeeds, reusing the already-initialized `WebClient` instance in the notify router. The announcements router does not currently have Slack imports — they would need to be added, or the Slack call extracted into a shared helper.

---

## No Longer Pure CRUD (Closed)

These features started as data stores but are now connected to downstream actions.

| Feature | URL | What closed the gap |
|---|---|---|
| Alert Rules | `/notify/alert-rules` | Rules are evaluated by the `alert-evaluator` Lambda on EventBridge schedules. Creating an enabled rule causes Slack alerts to fire when the condition is met. |
| Broadcasts | `/notify/broadcasts` | Posting a broadcast calls `slackClient.chat.postMessage` directly in the API route handler, immediately publishing to the mapped Slack channel. |
| Runbooks | `/portal/runbooks` | Runbooks have an Execute button that calls `POST /portal/runbooks/:id/execute`, which runs each block step in sequence and tracks execution state. |
| Incidents (timeline) | `/oncall/incidents` | Incident records support timeline event appending and status transitions via `POST /on-call/incidents/:id/timeline`. A P1 incident creation triggers the `p1_incident` alert rule condition in the evaluator. |
| Service Subscriptions (deploy + drift) | `/notify/subscriptions` | The `alert-evaluator` calls `notifySubscribers` for `deploy_failed` and `config_drift` conditions, sending Slack DMs to all matching subscribers. |
| Weekly Digest | `/notify/weekly-digest` | The digest is generated on demand (or scheduled) by aggregating deployment and highlight data, not just stored. |
