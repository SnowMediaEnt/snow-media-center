# Prompt for your Telegram bot (paste into Claude Code)

Copy everything below the line into your bot project's Claude Code session. It contains everything the bot needs to post App Alerts into Snow Media Center the same way the admin UI does — using your admin Supabase login, RLS-safe, no service-role key on the bot.

---

## Goal

Extend the existing Python Telegram bot (the one that already updates the RSS feed) with a new conversational command that creates an **App Alert** in the Snow Media Center Supabase project. The flow:

1. Admin sends `/alert` (or mentions "new alert").
2. Bot lists the available apps (fetched live from the `apps` table) and asks which one(s) the alert is for. Accept multiple selections.
3. Bot asks for a **title** (default `Heads up` if user replies "skip").
4. Bot asks for a **message** (required, free text).
5. Bot asks for **severity**: `info`, `warning`, or `critical`.
6. Bot shows a confirmation summary, waits for "yes/no".
7. On "yes", bot inserts one row per selected app into `public.app_alerts` and replies with the alert IDs.

Also support: `/alerts` to list active alerts, `/alert_off <id>` to deactivate, `/alert_delete <id>` to delete.

Restrict the whole feature to a hard-coded allowlist of Telegram user IDs (the admin's chat IDs).

## Snow Media Center Supabase project

- Project ref: `falmwzhvxoefvkfsiylp`
- Supabase URL: `https://falmwzhvxoefvkfsiylp.supabase.co`
- Anon (publishable) key — safe to embed in the bot:
  `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZhbG13emh2eG9lZnZrZnNpeWxwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTE4MjIwNDMsImV4cCI6MjA2NzM5ODA0M30.I-YfvZxAuOvhehrdoZOgrANirZv0-ucGUKbW9gOfQak`

## Authentication (use admin email/password — DO NOT use service-role key)

The `app_alerts` table is protected by RLS. INSERT / UPDATE / DELETE require `has_role(auth.uid(), 'admin')`. So the bot must sign in **as the admin user** with email + password and use the returned JWT for every request.

Store these as env vars in the bot:
- `SMC_SUPABASE_URL`
- `SMC_SUPABASE_ANON_KEY`
- `SMC_ADMIN_EMAIL`
- `SMC_ADMIN_PASSWORD`
- `TELEGRAM_ADMIN_IDS` (comma-separated list of allowed Telegram user IDs)

Use `supabase-py` (`pip install supabase`):

```python
from supabase import create_client
sb = create_client(os.environ["SMC_SUPABASE_URL"], os.environ["SMC_SUPABASE_ANON_KEY"])
sb.auth.sign_in_with_password({"email": os.environ["SMC_ADMIN_EMAIL"],
                                "password": os.environ["SMC_ADMIN_PASSWORD"]})
```

Refresh the session if it expires (catch the 401 and re-sign in, or call `sb.auth.refresh_session()` on a timer).

## Tables and shape

### `public.apps` — read this to list app names

Columns the bot needs: `id`, `name`, `is_available`. Query:

```python
apps = sb.table("apps").select("id,name,is_available").eq("is_available", True).order("name").execute().data
```

The `name` value is what gets stored in `app_alerts.app_match` — it must match exactly.

### `public.app_alerts` — insert here

Columns:
- `app_match` (text, required) — exact app name from `apps.name`
- `title` (text, default `'Heads up'`)
- `message` (text, required)
- `severity` (text: `info` | `warning` | `critical`, default `warning`)
- `active` (bool, default `true`) — set `true` to publish
- `source` (text, default `'admin'`) — set to `'telegram-bot'` so we can tell where it came from
- `created_by` (uuid) — set to the admin's `auth.uid()` (get from `sb.auth.get_user().user.id`)

Insert example (one row per selected app):

```python
admin_uid = sb.auth.get_user().user.id
rows = [{
    "app_match": app_name,
    "title": title or "Heads up",
    "message": message,
    "severity": severity,           # 'info' | 'warning' | 'critical'
    "active": True,
    "source": "telegram-bot",
    "created_by": admin_uid,
} for app_name in selected_app_names]

result = sb.table("app_alerts").insert(rows).execute()
inserted_ids = [r["id"] for r in result.data]
```

### Listing / deactivating / deleting

```python
# List active
sb.table("app_alerts").select("id,app_match,title,severity,created_at") \
  .eq("active", True).order("created_at", desc=True).execute()

# Deactivate
sb.table("app_alerts").update({"active": False}).eq("id", alert_id).execute()

# Delete
sb.table("app_alerts").delete().eq("id", alert_id).execute()
```

## Conversation UX (use python-telegram-bot ConversationHandler)

States: `PICK_APPS → TITLE → MESSAGE → SEVERITY → CONFIRM`.

- `PICK_APPS`: send an InlineKeyboard with one button per app (toggle ✅ on tap), plus a "Done" button. Also accept typed names separated by commas. Validate every name against the live `apps` list; if anything doesn't match, reply with the closest matches and re-ask.
- `TITLE`: free text, "skip" keeps default `Heads up`.
- `MESSAGE`: free text, required, reject empty.
- `SEVERITY`: InlineKeyboard with three buttons (`info`, `warning`, `critical`).
- `CONFIRM`: show summary `Apps: A, B, C\nTitle: …\nSeverity: …\nMessage: …` with Yes / Cancel buttons. On Yes, do the insert and reply with the inserted IDs and a link to the admin UI: `https://id-preview--f4432411-0df8-40ae-a0a1-fb97cafa76e7.lovable.app` (or the published URL once it exists).

## Authorization gate

At the start of every handler:

```python
if update.effective_user.id not in ADMIN_TG_IDS:
    await update.message.reply_text("Not authorized.")
    return ConversationHandler.END
```

## Error handling

- Wrap Supabase calls in try/except; on `PostgrestAPIError` reply with the error message so I can see it in chat.
- On 401 (JWT expired), call `sb.auth.sign_in_with_password(...)` again and retry once.
- Log everything with the `logging` module at INFO level.

## Deliverables

1. New module `bot/app_alerts.py` exposing `register_handlers(app)` that the existing bot's main file can import and call.
2. Update the bot's main file to call `register_handlers(app)` alongside the existing RSS handlers.
3. Update the bot's `.env.example` and README with the four new env vars listed above and the `TELEGRAM_ADMIN_IDS` list.
4. Add `supabase>=2.0.0` to `requirements.txt`.
5. No changes to the RSS feature.

---

That's the full prompt. Drop it into Claude Code in the bot repo and it should be able to build the feature end-to-end. After it's running, the bot will appear in the Snow Media Center admin under the alerts list with `source = 'telegram-bot'` so we can audit which alerts came from chat.