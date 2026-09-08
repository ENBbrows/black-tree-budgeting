/* ═════════════════════════════════════════════════════════
   BLACK TREE INVESTMENTS — BUDGETING TOOL SETTINGS
   Paste your Supabase project values here ONCE.
   This app is fully separate from the Eleganza CRM's config.js —
   it needs its own Supabase project (its own auth users + tables),
   not the same one Eleganza uses.

   Where to find these: Supabase dashboard → Project Settings → API.
   ═════════════════════════════════════════════════════════ */
const BT_CONFIG = {
  SUPABASE_URL: "https://txgzztcfsvwbbaagpuqz.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_s-F7IuwdzVxh29zpU04f3A_1aY1uztv",

  BRAND_NAME: "Black Tree Investments",
  APP_NAME: "Black Tree Budgeting",
  SUPPORT_EMAIL: "info@blacktreeinvestments.com",

  /* Income source quick-pick suggestions (client can still type any source). */
  INCOME_SOURCE_SUGGESTIONS: [
    "Salary / Primary Job", "Side Work / Consulting", "Freelance / Extra Work",
    "UTC / Mutual Fund Returns", "Stock Dividends", "Rental Income", "Bonuses / Extra Pay"
  ],
  INCOME_FREQUENCIES: ["Weekly", "Bi-Weekly", "Monthly", "Annually", "One-time"],

  /* Every outflow — including debt payments, savings contributions, and
     insurance — is logged as an "expense" with one of these categories,
     so the single Expense Tracker shortcut can feed the whole dashboard. */
  EXPENSE_CATEGORIES: [
    "Housing", "Utilities", "Transport", "Food", "Personal",
    "Insurance", "Debt Repayment", "Savings & Investments", "Education", "Other"
  ],

  /* Categories that can optionally be tagged to a goal or a debt so that
     item's progress updates itself automatically. */
  GOAL_LINK_CATEGORY: "Savings & Investments",
  DEBT_LINK_CATEGORY: "Debt Repayment",

  GOAL_CATEGORIES: ["Debt Reduction", "Investing", "Education", "Emergency Fund", "Personal", "Other"],

  /* Health-check thresholds — pulled directly from the Blacktree Financial
     Services 12-Month Tracking Tool's own guideline sheets, just applied
     live instead of read off a spreadsheet. */
  THRESHOLDS: {
    savingsRateGreen: 0.20,
    savingsRateYellow: 0.10,
    debtRatioYellow: 0.20,
    debtRatioRed: 0.40,
    housingRatioRed: 0.30,
    cashFlowYellowPct: 0.05,
    cashFlowGreenPct: 0.10
  }
};
