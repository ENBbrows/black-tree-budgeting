# Black Tree Investments — Budgeting & Goal Tracking Tool

A mobile-first budgeting app for Black Tree clients (and the agents who
advise them), built as three installable shortcuts:

| Page | Who uses it | Purpose |
|---|---|---|
| `income.html` | Clients & agents | Shortcut 1 — quick income entry (source, amount, frequency) |
| `expense.html` | Clients & agents | Shortcut 2 — quick expense entry (category, amount, date) |
| `dashboard.html` | Clients & agents | Shortcut 3 — week/month/YTD summary, cash flow, savings target, goal & debt tracker |
| `agent.html` | Agents only | Client list — claim a client by email, view their dashboard read-only |
| `login.html` | Everyone | Magic-link sign-in |
| `setup-guide.html` | Everyone | "Add to Home Screen" instructions for end users |

This started as a module inside the Eleganza CRM repo, then moved here —
its own repo, own Supabase project, own GitHub Pages URL — since Black
Tree Investments is a completely separate business with nothing to do
with Eleganza. Nothing here touches Eleganza's data or code.

It does **not** try to replicate the client's `Blacktree_Tool_12Month_Fixed.xlsx`
spreadsheet as a UI. What it takes from that workbook is its calculation
logic and its red/yellow/green guideline thresholds (see `config.js` →
`THRESHOLDS`, applied in `store.js` → `btHealthFlags`) — the app is a
simple plug-in-your-numbers, get-your-outputs tool, not a spreadsheet clone.

## 1. Create a Supabase project

Use a **new, separate** Supabase project — not Eleganza's. This is a
different business with different clients; keeping the data stores apart
means a bug or a leaked key in one app can never expose the other's data.

**Live project:** `black-tree-budgeting` (`https://txgzztcfsvwbbaagpuqz.supabase.co`).

## 2. Run the database migration

Supabase dashboard → **SQL Editor** → paste the contents of
`supabase/migrations/0001_blacktree_budgeting_tool.sql` → Run.

This creates `bt_profiles`, `bt_goals`, `bt_liabilities`, `bt_income_entries`,
`bt_expense_entries`, the `bt_goal_progress` / `bt_liability_progress` views,
and locks every table down with Row Level Security so a client only ever
sees their own rows, and an agent only sees the clients assigned to them.

## 3. Turn on magic-link email auth

Supabase dashboard → **Authentication → Providers** → make sure **Email**
is enabled with "Confirm email" style OTP/magic links (this is the default).

Then, **Authentication → URL Configuration**:
- **Site URL**: `https://enbbrows.github.io/black-tree-budgeting/`
- **Redirect URLs**: add `https://enbbrows.github.io/black-tree-budgeting/dashboard.html`

(Swap both for a custom domain later if one gets pointed at this repo's
GitHub Pages site — Settings → Pages → Custom domain.)

**Authentication → Email Templates → Magic Link**: this is a good place to
put Black Tree's branding on the login email itself. Keep the link's default
short expiry — that's what backs the "you can't just forward this link"
promise in `setup-guide.html`.

## 4. Edit `config.js`

```js
SUPABASE_URL: "https://xxxx.supabase.co",
SUPABASE_ANON_KEY: "eyJ...",
```

Both are in Supabase dashboard → **Project Settings → API**. The anon key
is safe to ship in client-side code — it's meaningless without the RLS
policies from the migration, which is why step 2 has to happen first.

## 5. Make yourself (or an agent) an agent

There's no self-serve way to become an agent — that's deliberate. After
someone has signed in at least once (so their `bt_profiles` row exists),
promote them from the Supabase SQL Editor:

```sql
update public.bt_profiles set role = 'agent' where email = 'advisor@blacktreeinvestments.com';
```

An agent then adds clients themselves from `agent.html` → **Add a client**,
by typing the client's email (the client must have signed in at least once
already).

## 6. Deploy

These are plain static files. **Live now via GitHub Pages:**
`https://enbbrows.github.io/black-tree-budgeting/` (Settings → Pages →
Deploy from a branch → `main`). Point clients and agents there and send
them to `setup-guide.html` first. A custom domain can be added later
under Settings → Pages without changing anything else — just update the
Supabase Auth URLs in step 3 to match.

## How the security model actually works

- **Data isolation**: enforced in the database (Row Level Security), not
  just hidden in the UI — even someone reading the API traffic directly
  can't pull another client's rows.
- **"Can't share the link"**: every page requires a live Supabase session.
  Forwarding a shortcut just hands someone a locked door — without their
  own magic-link sign-in (which only that email inbox can receive), they
  see the login screen, never your data.
- **Agent visibility**: read-only, and only for clients an agent has
  explicitly claimed by email. Agents can never see another agent's book,
  and can never edit a client's numbers for them.

## How offline works

Once a page has been opened online at least once, its service worker
(`sw.js`) has it cached — it opens with no signal at all after that. Income
and expense entries write to a local snapshot immediately and queue for
sync; `window`'s `online` event flushes the queue automatically the next
time there's a connection. The dashboard's numbers are always computed
from that same local snapshot, so they read correctly offline too — not
just the entry forms.

The one thing that always needs a live connection: the **first** sign-in on
a given device, since the magic link has to be emailed and verified.
