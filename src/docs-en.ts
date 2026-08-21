/**
 * English version of the in-app documentation.
 *
 * The chapters mirror `docs-page.ts` one for one — same ids, so a link into a
 * section keeps working when the language is switched. Written for someone who
 * did not build the application.
 */

export interface KapitolaEn {
  id: string;
  nadpis: string;
  telo: string;
}

export const CHAPTERS: KapitolaEn[] = [
  {
    id: 'k-cemu',
    nadpis: 'What this is for',
    telo: `
      <p>
        The application works out <b>what the household costs</b> and how much of that falls
        on each person. It is <b>not rent</b> — it is a share of real costs, so anyone can see
        where their number comes from.
      </p>
      <p>
        Contributions are paid as a <b>fixed advance</b> by standing order. The application
        matches incoming payments against the bank account, tracks the running balance and,
        once per period, reconciles the advances against reality.
      </p>`,
  },
  {
    id: 'naklady',
    nadpis: 'House costs',
    telo: `
      <p>
        Every cost is one item: a name, an amount <b>per period</b> (not a monthly average —
        so it matches the invoice), a periodicity and a category.
      </p>
      <h3>Kinds of item</h3>
      <ul>
        <li><b>Recurring</b> — goes into the monthly average.</li>
        <li><b>One-off</b>, <b>underpayment</b>, <b>overpayment</b> — these do not enter the
            average; they go straight into the balance. An overpayment carries a minus sign.</li>
      </ul>
      <h3>Who shares it</h3>
      <p>
        Shares point at <b>named people</b>, not fixed groups — the combination differs from
        item to item. A share is entered either as a percentage or as a fixed amount; what is
        left over is shown as <b>unallocated</b> and never quietly disappears.
      </p>
      <p>
        "Split the rest evenly" divides whatever is not covered by fixed amounts, using the
        largest-remainder method, so a third of 299 does not leave a stray heller behind.
      </p>
      <h3>Sorting and filtering</h3>
      <p>
        Clicking a column header sorts by it; the row below the header filters. <b>Totals and
        the per-category summary are calculated from what is visible</b>, so a filtered view
        never shows a selection of items above a total for everything.
      </p>`,
  },
  {
    id: 'osoby',
    nadpis: 'People',
    telo: `
      <p>
        Everyone recorded takes part in the split — that is how it stays visible what the
        house costs and on whom it falls. Money, however, only actually arrives from some of
        them; tick <b>pays into the account</b> for those.
      </p>
      <p>
        A minor has their own share, so the cost is visible, but the obligation is carried by
        a parent. Set that with <b>share carried by</b>; the overview then shows it separately
        as well as summed.
      </p>
      <p>
        <b>Gender</b> is optional and controls how the application addresses that person.
        Leave it unset and the wording stays neutral — nothing is guessed from the name.
      </p>`,
  },
  {
    id: 'platby',
    nadpis: 'How payments are recognised',
    telo: `
      <p>
        The primary marker is the <b>variable symbol</b>: with it a contribution can arrive
        from anywhere, even from someone else's account. The account number is an optional
        fallback for when the symbol is missing from the order.
      </p>
      <p>
        When both are missing, a known symbol is looked for in the <b>comment</b> you add to
        the transaction in Fio internet banking, then in the message for the recipient and in
        the payer identification. Only numbers matching a registered variable symbol are
        taken from free text — otherwise matching would latch onto random numbers in notes.
      </p>
      <p>
        Every payment shows <b>how</b> it was recognised. What cannot be recognised is not an
        error: it waits for manual assignment, and a manual assignment is never overwritten by
        a later automatic run.
      </p>
      <h3>Which month a payment belongs to</h3>
      <p>
        A payment carries the month it is <b>for</b>, pre-filled from the date it arrived.
        An advance for December sent on 3 January can therefore be moved to December, so the
        month does not show a gap that is not real.
      </p>
      <h3>When it downloads</h3>
      <p>
        Automatically every 15 minutes, and on demand with the button on the Payments page.
        The whole window is always fetched, not "since last time" — if a write fails, the next
        run fetches the same data again and nothing is lost.
      </p>`,
  },
  {
    id: 'rozpousteni',
    nadpis: 'A purchase is not consumption',
    telo: `
      <p>
        Coal bought for 42,000 is not one month's cost — it is burned over a year. Set
        <b>how many months</b> the item is spread over and <b>from which month</b>; it then
        enters the costs in twelfths and disappears on its own once it runs out.
      </p>
      <p>
        Outside its window the item does not count at all, which is why a closed month keeps
        the figure that genuinely applied then.
      </p>
      <h3>Who paid for it</h3>
      <p>
        An item paid <b>out of someone's own pocket</b> is credited to them. Without that
        distinction the cost would be counted twice — once as an expense and once as a
        deposit. The credit accrues along with the cost, so a spread purchase is credited in
        parts, not in one lump.
      </p>`,
  },
  {
    id: 'vyrovnani',
    nadpis: 'Advances and the balance',
    telo: `
      <p>
        The contribution is paid as a <b>fixed advance</b> — the same amount every month by
        standing order. The balance is calculated from the advance, not from fluctuating
        costs, so what someone has to send does not change during the period.
      </p>
      <p><code>owed = advance × months past due − what arrived</code></p>
      <p>
        A month only counts from its <b>due date</b> (configurable, 20th by default). Until
        then there is nothing to owe. The debt <b>carries from month to month</b>: what is
        short one month is added to the next, and anything paid over reduces it.
      </p>
      <h3>How an advance is proposed</h3>
      <p>
        The application works out what falls on a person over the next twelve months, adds a
        <b>buffer for unplanned purchases</b> and rounds up to hundreds. The proposal is then
        <b>confirmed by the administrator</b> — the application never sets an advance on its
        own. Rounding up is deliberate: a small overpayment is easier to return than a
        shortfall is to collect.
      </p>`,
  },
  {
    id: 'uzaverky',
    nadpis: 'Monthly closings',
    telo: `
      <p>
        Costs change over time — the internet gets more expensive, the coal runs out, the
        split is adjusted. While a month is <b>open</b> it is calculated from current
        settings, so hindsight would claim today's figure applied back then.
      </p>
      <p>
        <b>A closing freezes</b> what really applied in that month: total costs, each person's
        share, the valid advance and the list of items. Reconciliation then uses the frozen
        figures and later changes no longer move them.
      </p>
      <ul>
        <li>A month closes <b>on the due date of the following month</b>. That extra month is
            deliberate — a payment sent at the last moment lands a few days later.</li>
        <li>It happens <b>automatically</b>; the toggle on the Closings page turns it off.</li>
        <li>Automation never re-closes a closed month, and it signs itself in the history, so
            it is clear what a person did.</li>
        <li>A closing can be undone when a mistake is found.</li>
      </ul>`,
  },
  {
    id: 'vyuctovani',
    nadpis: 'Settling a period',
    telo: `
      <p>
        The advance is deliberately fixed so nobody has to change a standing order every
        month. Real costs fluctuate, though, so a difference accumulates somewhere. The
        settlement reconciles it once per period — the same way utilities work.
      </p>
      <p><code>difference = actual share of costs − what arrived during the period</code></p>
      <p>
        Only <b>closed, consecutive</b> months can be settled, because the settlement uses the
        frozen figures. An open month would still be calculated from today's settings and the
        settled number could change retrospectively.
      </p>
      <h3>What happens to the difference</h3>
      <ul>
        <li><b>Fold into the advance</b> — the difference is spread over twelve months and
            added to the new advance. The standing order stays fixed, it is just rewritten once.</li>
        <li><b>Pay separately</b> — the difference stands as an amount to pay (or to refund)
            and is shown separately in the balance, outside the advance.</li>
      </ul>
      <p>
        A shortfall above the <b>threshold in Settings</b> is not folded in automatically — it
        would raise the advance too sharply, so the application asks. The administrator always
        has the last word: the amount can be typed in by hand.
      </p>
      <h3>Periods follow one another</h3>
      <p>
        Saving a settlement <b>moves the start of tracking</b> past the end of the period and
        the new advances take effect from the following month. Money already reconciled is not
        counted again — otherwise the same overpayment would keep reducing the balance forever.
      </p>
      <p>
        Once a full period is closed, the settlement also runs <b>automatically</b>, using
        exactly what the form pre-selects. Only the most recent settlement can be undone;
        the advances it set stay in force and are changed on the Balance page.
      </p>`,
  },
  {
    id: 'odkaz',
    nadpis: "A member's personal overview",
    telo: `
      <p>
        Each member can get their <b>own link</b>, created in Settings on their row. The link
        is random and unguessable; whoever has it reaches the page without signing in.
      </p>
      <p>On their overview they see:</p>
      <ul>
        <li><b>what is left to pay in total</b>, or how much they have paid ahead, in large
            type at the top;</li>
        <li><b>month by month</b>: what they were due to send, what arrived, and the
            <b>running balance</b> after that month;</li>
        <li>a <b>QR payment</b> for the amount — scanned in a banking app, the amount and the
            variable symbol fill themselves in, so no typo can creep in. The <b>recipient name
            and message</b> are written by the administrator in Settings; anything left empty
            is not put into the code at all. Both are limited to 35 characters without
            diacritics — that is a constraint of the QR standard, and accents are stripped
            automatically;</li>
        <li>their share month by month, their own payments, and the yearly house costs by
            category.</li>
      </ul>
      <p>
        <b>Nothing about anyone else.</b> Whoever holds the link sees their own figures and the
        household total, never what the others pay — which is why each person gets a separate
        link. A link can be revoked if it ends up somewhere it should not.
      </p>
      <h3>You write the wording</h3>
      <p>
        The sentences a member reads ("less arrived than was due", "not due yet") are
        <b>not in the code</b> — they are rewritten in Settings. The application only picks
        which sentence fits a given month; how it reads is up to you. An empty field restores
        the default shown beneath it.
      </p>`,
  },
  {
    id: 'nastaveni',
    nadpis: 'Settings and the bank token',
    telo: `
      <p>
        Anything that may change belongs in <b>Settings</b>, not in the code: the start of
        tracking, the due date, the buffer in an advance, the threshold for folding in a
        shortfall, the length of a settlement period, the QR wording and the sentences for
        members.
      </p>
      <p>
        The <b>Fio token</b> is entered in Settings and is issued <b>read-only</b> — the
        application only downloads transactions, it never pays anything. Once stored it cannot
        be read back from the interface; only the last few characters are shown, and it can be
        replaced with a new one.
      </p>`,
  },
  {
    id: 'zmeny',
    nadpis: 'Who changed what',
    telo: `
      <p>
        <b>No write happens without a record.</b> The change and its audit entry go into the
        database in a single batch, so a change without a visible who and when cannot exist.
      </p>
      <p>
        The last changes are listed at the bottom of Settings, and each cost item has its own
        history showing exactly what moved and from what to what. Automatic closings and
        settlements sign themselves as <code>automat (cron)</code>, so it is clear which
        entries a person is responsible for.
      </p>`,
  },
  {
    id: 'pristup',
    nadpis: 'Access and security',
    telo: `
      <p>
        Administration is protected by a <b>PIN</b>. The PIN itself is never stored — only a
        salted PBKDF2 hash. Five wrong attempts lock sign-in for 15 minutes, ten for an hour.
      </p>
      <p>
        The stronger option is <b>Cloudflare Access</b>: e-mail sign-in with a second factor.
        When enabled it takes precedence over the PIN and the change history records the real
        e-mail address instead of "PIN (address)".
      </p>
      <div class="varovani">
        A four-digit PIN on a public address is weaker protection than Access — only the
        slowdown stands between it and guessing. For data that matters, turn Access on.
      </div>`,
  },
  {
    id: 'ai',
    nadpis: 'Artificial intelligence',
    telo: `
      <p>
        On the Overview the application can write a <b>short commentary on how costs are
        developing</b>. It never runs by itself — you start it with a button, so you always
        know when it happened.
      </p>
      <h3>What leaves the application</h3>
      <p>
        The model receives <b>house costs only</b>: amounts, categories, the largest items
        and the trend across closed months. <b>No names, no account numbers, no payments.</b>
      </p>
      <h3>Which backend</h3>
      <ul>
        <li><b>Automatic (default)</b> — free, via Cloudflare Workers AI. The data never
            leaves Cloudflare and the application never spends money on its own.</li>
        <li><b>Free only</b> — a paid call can never happen.</li>
        <li><b>Paid Claude</b> — more accurate; used only if you pick it and a key is stored.</li>
        <li><b>Off</b> — nothing is sent anywhere.</li>
      </ul>
      <h3>Why the model does not do the arithmetic</h3>
      <p>
        Every sum and percentage is calculated by the application and handed to the model
        ready-made — a small model gets arithmetic wrong. On top of that there is a hard
        guard: <b>a sentence containing a number that does not appear in the source data is
        not published</b>. A shorter commentary beats plausible-sounding nonsense.
      </p>
      <div class="varovani">
        The commentary is a summary, not a calculation. The figures in the tables are what
        counts — which is why the text always states when it was produced and by which backend.
      </div>`,
  },
  {
    id: 'export',
    nadpis: 'Exporting data',
    telo: `
      <p>
        Costs can be downloaded as <b>CSV for Excel</b> using the button on the House costs
        page. The file uses semicolons, a Czech decimal comma and an encoding mark, so Excel
        opens it directly without the import wizard.
      </p>`,
  },
];
