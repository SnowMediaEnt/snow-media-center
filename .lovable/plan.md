## Goal

While viewing an AI conversation, show your other recent saved conversations in a panel **below the active chat**, so you can re-read or jump back into them without leaving the page (matches the support tickets pattern). Retention stays at the current 5 most recent.

## Changes

**File: `src/components/AIConversationSystem.tsx`** (only file changed)

Inside the `view === 'conversation'` branch, under the existing chat Card (after the reply input), add a second Card titled **"Your Recent Conversations"** that:

- Lists the other saved conversations from the already-loaded `conversations` array (excludes the one currently open).
- Each row shows: title (line-clamp-1), "Last message: X ago", and a small Trash button.
- Clicking a row calls the existing `handleViewConversation(id)` to swap the active chat to that conversation (state stays on the same page, just re-renders with new `selectedConversationId`).
- Trash button calls existing `handleDeleteConversation` with `e.stopPropagation()`.
- If no other conversations exist, show a muted "No other saved conversations" line.
- Styled to match existing dark cards (`bg-slate-800/50 border-slate-700`, hover `bg-slate-700/50`), D-pad-friendly (focusable buttons, glow-and-grow already inherited from button styles).
- Small note at bottom: "Showing up to 5 most recent" (consistent with list view badge).

No changes to:
- Database schema, RLS, or the `limit_ai_conversations` trigger (5-cap stays).
- `useAIConversations` hook (already exposes everything needed).
- The grid list view or create view.

## Technical notes

- Reuses `conversations`, `handleViewConversation`, `handleDeleteConversation`, `formatDistanceToNow` already in scope.
- No new dependencies, no edge function changes, no migration.
