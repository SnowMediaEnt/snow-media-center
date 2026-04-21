

## App Alerts are already built — make them easier to find

### What's actually going on

Good news: there is **nothing missing in the database or the code**. The feature you're asking for already exists and is fully wired up:

- A component called **`AppAlertsManager`** lets admins pick one or more apps from the live app list, type a title + message, choose a severity (info / warning / critical), and post the alert.
- That alert is then shown to every user as a popup the next time they open the matching app (handled by `useAppAlerts` + `AppAlertDialog`).
- It's already gated to admins only (`useAdminRole`).

The reason you don't see it in the **Admin Support Dashboard** is that it was never placed there. Today it lives at:

```text
Home → Settings (gear icon)
   └── Tabs: Layout | Media | Updates | App Alerts   ← admin-only tab
```

So as the admin (`joshua.perez@snowmediaent.com`) you should be able to open it right now by going to **Settings → App Alerts** tab.

### The real problem: discoverability

You expected to find it in the Admin section (next to Tickets), and that's the right instinct — managing user-facing alerts is an admin task, not a "settings" task. Burying it in Settings makes it easy to miss.

### Plan

I'll do two small things to fix this without duplicating the component:

1. **Add an "App Alerts" entry point alongside Tickets in the Admin area.**
   - In the Admin Support Dashboard, add a top-level toggle (or second tab) so admins see two sections:
     - **Support Tickets** (current view)
     - **App Alerts** (renders the existing `AppAlertsManager`)
   - This is where you instinctively looked, so this is where it should live.

2. **Add a clear admin entry point on the Dashboard / Account screen.**
   - Add an "App Alerts" tile/button next to the existing "Admin Support" tile (admin-only, same `isAdmin` gate).
   - Clicking it jumps straight into the alerts manager.

3. **Keep the Settings → App Alerts tab as a secondary shortcut** (don't remove it — some admins may be used to it, and removing it is a needless regression).

### Files that will change

- `src/components/AdminSupportDashboard.tsx` — add a tab/segmented control: "Tickets" vs "App Alerts", render `<AppAlertsManager />` in the second tab.
- `src/components/UserDashboard.tsx` (or wherever the "Admin Support" tile is) — add a sibling "App Alerts" tile, admin-only.
- `src/pages/Index.tsx` — add a new route/view key like `'admin-alerts'` so the tile can navigate directly to the alerts screen (alternative: just route to `'admin-support'` and default-select the Alerts tab via a query param/prop).
- No database changes. No edge function changes. No new dependencies.

### What you'll see after the change

- Open the **Admin Support** screen → you'll now see two tabs at the top: **Tickets** | **App Alerts**.
- The App Alerts tab shows: a list of apps with checkboxes, title field, severity buttons (info/warning/critical), message box, "Post alert" button, and a list of existing alerts with on/off switches and delete buttons.
- The same screen is still reachable from Settings → App Alerts and from a new "App Alerts" tile on the Dashboard.

### Quick clarification (optional)

You can tell me right now: do you want the existing **Settings → App Alerts** tab **kept** as a shortcut, or **removed** to keep alert management strictly inside the Admin area? Default if you don't say: keep both.

