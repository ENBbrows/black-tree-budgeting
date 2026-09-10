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

  /* Foreign currencies a client can log income in, beyond their home
     currency (set per-profile). Each needs an exchange rate (Settings →
     Exchange Rates) before it converts into the Dashboard's unified view —
     rates are set manually, not fetched live, so currency conversion keeps
     working fully offline like everything else here. */
  EXTRA_CURRENCIES: ["USD", "GBP", "EUR", "CAD"],

  /* Every outflow — including debt payments, savings contributions, and
     insurance — is logged as an "expense" with one of these categories,
     so the single Expense Tracker shortcut can feed the whole dashboard. */
  EXPENSE_CATEGORIES: [
    "Housing", "Utilities", "Transport", "Food", "Personal",
    "Insurance", "Debt Repayment", "Savings & Investments", "Education", "Taxes", "Other"
  ],

  /* Categories that can optionally be tagged to a goal or a debt so that
     item's progress updates itself automatically. */
  GOAL_LINK_CATEGORY: "Savings & Investments",
  DEBT_LINK_CATEGORY: "Debt Repayment",

  GOAL_CATEGORIES: ["Debt Reduction", "Investing", "Education", "Emergency Fund", "Taxes", "Personal", "Other"],

  /* Categories treated as "cost of living" — the baseline that has to keep
     running no matter what. Everything else (Personal, Education, Other)
     counts as discretionary. Used for the Cost of Living / Disposable
     Income breakdown, not stored per-client — the same split for everyone. */
  ESSENTIAL_CATEGORIES: ["Housing", "Utilities", "Transport", "Food", "Insurance", "Debt Repayment", "Taxes"],

  /* Auto-categorization: as a client types what an expense was for (or a
     scanned bill's text), the first category whose keyword appears in that
     text (case-insensitive) is pre-selected — so the client just describes
     the spend instead of hunting through a dropdown first. Always shown as
     an editable guess, never applied silently. */
  CATEGORY_KEYWORDS: {
    "Housing": ["rent", "mortgage", "landlord", "hoa"],
    "Utilities": ["electricity", "t&tec", "ttec", "water", "wasa", "internet", "flow", "digicel", "phone bill", "gas bill"],
    "Transport": ["gas", "fuel", "petrol", "uber", "taxi", "maxi", "car repair", "parking", "car service", "registration"],
    "Food": ["grocery", "groceries", "supermarket", "restaurant", "lunch", "dinner", "takeout", "take-out", "kfc", "subway", "market"],
    "Insurance": ["insurance", "premium"],
    "Debt Repayment": ["loan payment", "car loan", "credit card payment", "mortgage payment", "loan installment"],
    "Savings & Investments": ["savings", "investment", "mutual fund", "stocks", "utc", "deposit"],
    "Education": ["school", "tuition", "textbook", "books", "course", "exam fee"],
    "Taxes": ["tax", "board of inland revenue", "bir", "vat", "property tax", "income tax"],
    "Personal": ["netflix", "spotify", "gym", "haircut", "salon", "shopping", "clothes", "subscription"]
  },

  /* How money physically moved — set on every income and expense entry so
     it can be tracked by card/account, not just by category. Same list
     used on both sides: an expense is "paid with", income is "received via". */
  PAYMENT_TYPES: ["Cash", "Debit Card", "Credit Card", "Cheque", "Bank Transfer", "Mobile Payment", "Other"],

  /* Same idea as CATEGORY_KEYWORDS, but for guessing the payment type off
     a scanned receipt (e.g. a card network name printed near the total). */
  PAYMENT_KEYWORDS: {
    "Credit Card": ["credit card", "visa credit", "mastercard credit", "amex", "american express", "credit"],
    "Debit Card": ["debit card", "debit"],
    "Cash": ["cash tendered", "cash paid", "cash change", "cash"],
    "Cheque": ["cheque", "check no", "check #", "chq"],
    "Mobile Payment": ["wipay", "linqpay", "paypal", "mobile pay"]
  },

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
