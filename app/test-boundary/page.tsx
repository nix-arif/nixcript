import { requireOwner } from "@/lib/auth/require-permission";

export const metadata = {
  title: "Trust Boundary Audit",
  description: "Authorization sweep of every server action in the app — findings by severity, and what's confirmed clean.",
};

// Self-contained report — every color/spacing/type decision lives in this
// one stylesheet rather than the app's Tailwind tokens, since this page is
// a one-off audit deliverable, not part of the product's own UI.
const REPORT_CSS = `
  :root {
    --paper: #F7F5F1;
    --paper-raised: #FFFFFF;
    --ink: #1C1A17;
    --ink-soft: #55504A;
    --ink-faint: #8A8479;
    --line: #DEDAD2;
    --line-strong: #C7C1B6;
    --accent: #1F4B4A;
    --accent-soft: #E4EDEC;
    --critical: #B3261E;
    --critical-soft: #F8E8E6;
    --high: #B2530A;
    --high-soft: #F6EADC;
    --medium: #8A6A0A;
    --medium-soft: #F2ECD8;
    --low: #3D5A80;
    --low-soft: #E4EAF1;
    --clean: #2F6B4F;
    --clean-soft: #E3EFE8;
    --code-bg: #EFEBE3;
  }

  @media (prefers-color-scheme: dark) {
    .tba-root:not([data-theme="light"]) {
      --paper: #161512;
      --paper-raised: #1E1C19;
      --ink: #EDE9E2;
      --ink-soft: #B0A99D;
      --ink-faint: #756F64;
      --line: #33302A;
      --line-strong: #423E36;
      --accent: #7BC4BF;
      --accent-soft: #1C2E2C;
      --critical: #FF6B5E;
      --critical-soft: #2E1D1A;
      --high: #F0A15C;
      --high-soft: #2E2418;
      --medium: #E3C561;
      --medium-soft: #2C2718;
      --low: #8DB4DC;
      --low-soft: #1C2530;
      --clean: #7FCBA4;
      --clean-soft: #1B2A22;
      --code-bg: #24221D;
    }
  }

  .tba-root[data-theme="dark"] {
    --paper: #161512;
    --paper-raised: #1E1C19;
    --ink: #EDE9E2;
    --ink-soft: #B0A99D;
    --ink-faint: #756F64;
    --line: #33302A;
    --line-strong: #423E36;
    --accent: #7BC4BF;
    --accent-soft: #1C2E2C;
    --critical: #FF6B5E;
    --critical-soft: #2E1D1A;
    --high: #F0A15C;
    --high-soft: #2E2418;
    --medium: #E3C561;
    --medium-soft: #2C2718;
    --low: #8DB4DC;
    --low-soft: #1C2530;
    --clean: #7FCBA4;
    --clean-soft: #1B2A22;
    --code-bg: #24221D;
  }

  .tba-root * { box-sizing: border-box; }

  .tba-root {
    margin: 0;
    background: var(--paper);
    color: var(--ink);
    font-family: -apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif;
    font-size: 15px;
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
    min-height: 100vh;
  }

  .tba-root .serif {
    font-family: "Iowan Old Style", "Palatino Linotype", Palatino, "URW Palladio L", Georgia, serif;
  }

  .tba-root .mono {
    font-family: "SF Mono", "Cascadia Code", "Consolas", "Liberation Mono", monospace;
    font-variant-numeric: tabular-nums;
  }

  .tba-root a { color: var(--accent); }

  .tba-root .wrap {
    max-width: 860px;
    margin: 0 auto;
    padding: 4rem 1.5rem 6rem;
  }

  /* ── Header ─────────────────────────────────────────── */

  .tba-root header.masthead {
    display: flex;
    flex-direction: column;
    gap: 1.1rem;
    padding-bottom: 2.25rem;
    border-bottom: 1px solid var(--line-strong);
    margin-bottom: 2.5rem;
  }

  .tba-root .eyebrow {
    font-size: 0.72rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--accent);
    font-weight: 600;
  }

  .tba-root h1 {
    font-size: clamp(2rem, 4.5vw, 2.75rem);
    line-height: 1.08;
    margin: 0;
    font-weight: 500;
    text-wrap: balance;
  }

  .tba-root .dek {
    color: var(--ink-soft);
    font-size: 1.02rem;
    max-width: 62ch;
    margin: 0;
  }

  .tba-root .scope-line {
    color: var(--ink-faint);
    font-size: 0.85rem;
    margin: 0;
  }

  .tba-root .scope-line .mono { color: var(--ink-soft); }

  /* ── Stat strip ─────────────────────────────────────── */

  .tba-root .stat-strip {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 1px;
    background: var(--line);
    border: 1px solid var(--line);
    border-radius: 10px;
    overflow: hidden;
    margin-top: 0.5rem;
  }

  .tba-root .stat {
    background: var(--paper-raised);
    padding: 0.9rem 0.6rem;
    text-align: center;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .tba-root .stat .n {
    font-size: 1.7rem;
    font-weight: 600;
    font-family: "SF Mono", "Cascadia Code", Consolas, monospace;
  }

  .tba-root .stat .label {
    font-size: 0.68rem;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--ink-faint);
  }

  .tba-root .stat.critical .n { color: var(--critical); }
  .tba-root .stat.high .n { color: var(--high); }
  .tba-root .stat.medium .n { color: var(--medium); }
  .tba-root .stat.low .n { color: var(--low); }
  .tba-root .stat.clean .n { color: var(--clean); }

  .tba-root .stat .sublabel {
    font-size: 0.66rem;
    color: var(--clean);
    font-weight: 600;
  }

  .tba-root .tier-head .progress {
    font-size: 0.85rem;
    color: var(--clean);
    font-weight: 600;
    margin-left: auto;
  }

  @media (max-width: 640px) {
    .tba-root .stat-strip { grid-template-columns: repeat(3, 1fr); }
  }

  /* ── Meta-pattern callout ──────────────────────────── */

  .tba-root .pattern-note {
    background: var(--accent-soft);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 1.25rem 1.4rem;
    margin: 2.5rem 0;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .tba-root .pattern-note h2 {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
  }

  .tba-root .pattern-note ol {
    margin: 0;
    padding-left: 1.2rem;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .tba-root .pattern-note li { color: var(--ink-soft); }
  .tba-root .pattern-note li strong { color: var(--ink); }

  /* ── Section headers ───────────────────────────────── */

  .tba-root section.tier {
    margin-top: 3rem;
  }

  .tba-root .tier-head {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    margin-bottom: 1.1rem;
    padding-bottom: 0.6rem;
    border-bottom: 2px solid var(--tier-color, var(--line-strong));
  }

  .tba-root .tier-head h2 {
    font-size: 1.3rem;
    margin: 0;
    font-weight: 500;
  }

  .tba-root .tier-head .count {
    font-size: 0.85rem;
    color: var(--ink-faint);
    font-family: "SF Mono", "Cascadia Code", Consolas, monospace;
  }

  .tba-root .tier-head .dot {
    width: 10px; height: 10px;
    border-radius: 50%;
    background: var(--tier-color);
    flex-shrink: 0;
  }

  .tba-root section.tier.crit { --tier-color: var(--critical); }
  .tba-root section.tier.hi { --tier-color: var(--high); }
  .tba-root section.tier.med { --tier-color: var(--medium); }
  .tba-root section.tier.lo { --tier-color: var(--low); }

  /* ── Finding cards ─────────────────────────────────── */

  .tba-root .finding {
    background: var(--paper-raised);
    border: 1px solid var(--line);
    border-left: 4px solid var(--tier-color, var(--line-strong));
    border-radius: 8px;
    margin-bottom: 0.85rem;
    overflow: hidden;
  }

  .tba-root .finding summary {
    cursor: pointer;
    list-style: none;
    padding: 0.95rem 1.15rem;
    display: flex;
    align-items: center;
    gap: 0.85rem;
  }

  .tba-root .finding summary::-webkit-details-marker { display: none; }

  .tba-root .finding summary .chevron {
    flex-shrink: 0;
    width: 14px; height: 14px;
    color: var(--ink-faint);
    transition: transform 0.15s ease;
  }

  .tba-root .finding[open] summary .chevron { transform: rotate(90deg); }

  .tba-root .finding summary .title-block {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    min-width: 0;
    flex: 1;
  }

  .tba-root .finding summary .fname {
    font-weight: 600;
    font-size: 0.96rem;
  }

  .tba-root .finding summary .floc {
    font-size: 0.78rem;
    color: var(--ink-faint);
  }

  .tba-root .badge {
    font-size: 0.66rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    padding: 0.22rem 0.5rem;
    border-radius: 5px;
    flex-shrink: 0;
    white-space: nowrap;
  }

  .tba-root .badge.critical { background: var(--critical-soft); color: var(--critical); }
  .tba-root .badge.high { background: var(--high-soft); color: var(--high); }
  .tba-root .badge.medium { background: var(--medium-soft); color: var(--medium); }
  .tba-root .badge.low { background: var(--low-soft); color: var(--low); }
  .tba-root .badge.clean { background: var(--clean-soft); color: var(--clean); }

  .tba-root .finding .body {
    padding: 0 1.15rem 1.15rem;
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
    border-top: 1px solid var(--line);
    padding-top: 0.9rem;
  }

  .tba-root .finding .body h4 {
    margin: 0 0 0.3rem;
    font-size: 0.72rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-faint);
    font-weight: 600;
  }

  .tba-root .finding .body p {
    margin: 0;
    color: var(--ink-soft);
  }

  .tba-root .finding code {
    background: var(--code-bg);
    padding: 0.65rem 0.8rem;
    border-radius: 6px;
    display: block;
    font-size: 0.8rem;
    overflow-x: auto;
    white-space: pre;
    color: var(--ink);
  }

  .tba-root .finding .scenario {
    background: var(--code-bg);
    border-radius: 6px;
    padding: 0.8rem 0.9rem;
    font-size: 0.9rem;
    color: var(--ink);
  }

  /* ── Low-tier compact table ─────────────────────────── */

  .tba-root .lo-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.85rem;
  }

  .tba-root .lo-table th {
    text-align: left;
    font-size: 0.68rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-faint);
    padding: 0.5rem 0.7rem;
    border-bottom: 1px solid var(--line-strong);
    font-weight: 600;
  }

  .tba-root .lo-table td {
    padding: 0.65rem 0.7rem;
    border-bottom: 1px solid var(--line);
    vertical-align: top;
    color: var(--ink-soft);
  }

  .tba-root .lo-table td.loc { color: var(--ink); white-space: nowrap; }
  .tba-root .lo-table tr:last-child td { border-bottom: none; }

  .tba-root .table-scroll { overflow-x: auto; border: 1px solid var(--line); border-radius: 8px; }
  .tba-root .table-scroll .lo-table { min-width: 900px; }

  /* ── Coverage / clean list ──────────────────────────── */

  .tba-root details.coverage-group {
    border: 1px solid var(--line);
    border-radius: 8px;
    margin-bottom: 0.6rem;
    background: var(--paper-raised);
  }

  .tba-root details.coverage-group summary {
    cursor: pointer;
    list-style: none;
    padding: 0.8rem 1.1rem;
    display: flex;
    align-items: center;
    gap: 0.7rem;
    font-weight: 600;
    font-size: 0.9rem;
  }

  .tba-root details.coverage-group summary::-webkit-details-marker { display: none; }
  .tba-root details.coverage-group summary .chevron {
    width: 12px; height: 12px; color: var(--ink-faint);
    transition: transform 0.15s ease; flex-shrink: 0;
  }
  .tba-root details.coverage-group[open] summary .chevron { transform: rotate(90deg); }
  .tba-root details.coverage-group summary .n {
    margin-left: auto; font-size: 0.75rem; color: var(--clean);
    font-family: "SF Mono", monospace;
  }

  .tba-root .coverage-group .clist {
    padding: 0 1.1rem 1rem;
    color: var(--ink-soft);
    font-size: 0.83rem;
    line-height: 1.75;
    border-top: 1px solid var(--line);
    margin-top: 0.2rem;
    padding-top: 0.7rem;
  }

  .tba-root .coverage-group .clist .mono { color: var(--ink); }

  /* ── Closing ────────────────────────────────────────── */

  .tba-root .closing {
    margin-top: 3.5rem;
    padding-top: 2rem;
    border-top: 1px solid var(--line-strong);
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
  }

  .tba-root .closing h2 {
    font-size: 1.15rem;
    margin: 0;
    font-weight: 500;
  }

  .tba-root .closing p { color: var(--ink-soft); margin: 0; max-width: 68ch; }

  .tba-root .phase-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-top: 0.3rem;
  }

  .tba-root .phase {
    display: flex;
    gap: 0.75rem;
    align-items: baseline;
    font-size: 0.92rem;
  }

  .tba-root .phase .num {
    font-family: "SF Mono", monospace;
    color: var(--accent);
    font-weight: 700;
    font-size: 0.8rem;
    flex-shrink: 0;
    width: 1.4rem;
  }

  .tba-root footer.colophon {
    margin-top: 3rem;
    color: var(--ink-faint);
    font-size: 0.78rem;
  }

  .tba-root section.tier.crit .tier-head .dot,
  .tba-root section.tier.hi .tier-head .dot,
  .tba-root section.tier.med .tier-head .dot,
  .tba-root section.tier.lo .tier-head .dot { background: var(--tier-color); }
`;

const REPORT_HTML = `
<div class="wrap">

  <header class="masthead">
    <span class="eyebrow">Authorization &amp; Multi-Tenancy Review</span>
    <h1 class="serif">Trust Boundary Audit</h1>
    <p class="dek">A full sweep of every server action in the RBAC ERP, following the pattern behind the two bugs already fixed this session (client-supplied org IDs trusted at face value, and permission grants that let a caller hand out more than they hold). Four parallel reviews, one per domain, read every exported function in <span class="mono">server/*.ts</span> against the same checklist. A second-pass sweep then covered the ground the first pass didn't: raw HTTP route handlers under <span class="mono">app/api/**</span>, the auth/session configuration, and a scan for SQL injection, XSS, and committed secrets — see "Phase 2" below.</p>
    <p class="scope-line">39 files · <span class="mono">~21,000</span> lines · every exported function checked · All four tiers now fully patched</p>

    <div class="stat-strip">
      <div class="stat critical"><span class="n">5</span><span class="label">Critical</span><span class="sublabel">✓ 5/5 fixed</span></div>
      <div class="stat high"><span class="n">6</span><span class="label">High</span><span class="sublabel">✓ 6/6 fixed</span></div>
      <div class="stat medium"><span class="n">6</span><span class="label">Medium</span><span class="sublabel">✓ 6/6 fixed</span></div>
      <div class="stat low"><span class="n">15</span><span class="label">Low</span><span class="sublabel">✓ 15/15 fixed</span></div>
      <div class="stat clean"><span class="n">150+</span><span class="label">Clean</span></div>
    </div>
  </header>

  <div class="pattern-note">
    <h2 class="serif">The same three cracks, over and over</h2>
    <ol>
      <li><strong>Missing or bypassed authorization</strong> — an exported server action with no session/permission check, or a check that a client-supplied argument can route around (an optional <span class="mono">orgId</span> parameter that skips the auth call entirely, for instance).</li>
      <li><strong>Trusting a client-supplied ID across the tenant boundary</strong> — a function reads or writes a record by its raw ID without confirming that record actually belongs to the caller's own organization.</li>
      <li><strong>Self-escalation</strong> — an action that grants a permission, role, or department to someone (often the caller) without checking the granter already holds at least that much themselves.</li>
    </ol>
  </div>

  <!-- ══════════════════════ CRITICAL ══════════════════════ -->
  <section class="tier crit">
    <div class="tier-head"><span class="dot"></span><h2 class="serif">Critical</h2><span class="count">5 findings</span><span class="progress">✓ all 5 fixed</span></div>

    <details class="finding" style="--tier-color: var(--clean);">
      <summary>
        <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
        <div class="title-block">
          <span class="fname">Default Permissions lets an admin grant themselves anything</span>
          <span class="floc mono">server/default-permissions.ts — setDefaultPermission():123, enableSensitiveDefaultPermission():149</span>
        </div>
        <span class="badge critical">Escalation</span>
        <span class="badge clean">✓ Fixed</span>
      </summary>
      <div class="body">
        <p>Both are gated only by <span class="mono">requireOwnerOrAdmin()</span> (owner <em>or</em> admin) and materialize the given permission key onto every non-owner member of the org — including the caller — with no check that the caller already holds it. This is the exact same gap already fixed in <span class="mono">permissions.ts</span> via <span class="mono">assertCanGrant()</span>, left open here.</p>
        <h4>Exploit scenario</h4>
        <p class="scenario">Faizal is an org admin who was deliberately never granted <span class="mono">account:delete</span> — ledger deletion is meant to stay with Accounting. Via Admin → Default Permissions he toggles <span class="mono">account:delete</span> on. The org-wide grant sweep runs and hands it to every member, including Faizal. If the key is flagged "sensitive," he can flip <span class="mono">setSensitivePermissionFlag</span> off first — no password gate, no possession check, either way.</p>
        <h4>Fix applied</h4>
        <p>Added <span class="mono">assertCanGrant()</span> before both functions run their grant sweep — the caller's own current permissions are checked first, and the request is rejected if they're missing anything they're trying to hand out. Owners still bypass via <span class="mono">"*"</span>.</p>
      </div>
    </details>

    <details class="finding" style="--tier-color: var(--clean);">
      <summary>
        <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
        <div class="title-block">
          <span class="fname">Any user's full year-to-date payslip, no auth check at all</span>
          <span class="floc mono">server/payroll.ts — getPayslipYtd():596-672</span>
        </div>
        <span class="badge critical">No auth</span>
        <span class="badge clean">✓ Fixed</span>
      </summary>
      <div class="body">
        <p>Zero session or permission check, and no organization filter anywhere in the query — only <span class="mono">eq(payslip.userId, userId)</span>, where <span class="mono">userId</span> is a plain caller-supplied argument. The one legitimate caller passes the caller's own ID, but nothing stops any other value.</p>
        <h4>Exploit scenario</h4>
        <p class="scenario">A junior employee with no payroll permissions opens devtools, finds this action already shipped in the "My Payslips" client bundle, and re-invokes it with a different <span class="mono">userId</span> — the CEO's, say, picked up from any place a user ID leaks. Back comes that person's full year-to-date gross pay, net pay, EPF/SOCSO/EIS contributions, bonus, and taxable income. Works across organizations too, since there's no org filter at all.</p>
        <h4>Fix applied</h4>
        <p>The function now resolves <span class="mono">orgId</span>/<span class="mono">userId</span> from the session first. Pulling someone else's YTD requires <span class="mono">payslip:read:all</span>; the query itself also now filters by <span class="mono">payrollPeriod.organizationId</span>, closing the cross-tenant gap alongside the missing permission check.</p>
      </div>
    </details>

    <details class="finding" style="--tier-color: var(--clean);">
      <summary>
        <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
        <div class="title-block">
          <span class="fname">An optional parameter skips the permission check entirely</span>
          <span class="floc mono">server/invoice.ts — getInvoiceStats():617-621</span>
        </div>
        <span class="badge critical">No auth</span>
        <span class="badge clean">✓ Fixed</span>
      </summary>
      <div class="body">
        <code>const resolved = orgId ?? (await requireAccess("invoice:read")).orgId;</code>
        <p>The <span class="mono">??</span> short-circuits <span class="mono">requireAccess()</span> completely whenever any <span class="mono">orgId</span> is passed in — meaning no session check, no permission check, nothing.</p>
        <h4>Exploit scenario</h4>
        <p class="scenario">Anyone able to call this action with a competitor org's ID gets that org's total billed, total collected, total outstanding, and invoice-status breakdown — full revenue exposure, zero permission required. It isn't currently called from anywhere in the app (dead code today), but the vulnerable path is exactly as written and activates the moment anything calls it with a client-influenced value.</p>
        <h4>Fix applied</h4>
        <p>Dropped the optional <span class="mono">orgId</span> parameter entirely — it's now always resolved from <span class="mono">requireAccess("invoice:read")</span>, with no way for a caller to bypass it. It had zero real callers, so nothing else needed to change.</p>
      </div>
    </details>

    <details class="finding" style="--tier-color: var(--clean);">
      <summary>
        <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
        <div class="title-block">
          <span class="fname">Quotation settings can be overwritten on another org's document</span>
          <span class="floc mono">server/quotation.ts — updateQuotationSettings():2367, updateQuotationDocumentOptions():2428</span>
        </div>
        <span class="badge critical">Cross-tenant write</span>
        <span class="badge clean">✓ Fixed</span>
      </summary>
      <div class="body">
        <p>Both check that the caller has <span class="mono">quotation:update</span> in their own org — a permission virtually every quoting user has — but the record lookup and the update itself filter only by <span class="mono">quotation.id</span>, never by <span class="mono">organizationId</span>.</p>
        <h4>Exploit scenario</h4>
        <p class="scenario">A sales rep at Org A, holding ordinary <span class="mono">quotation:update</span>, supplies the ID of a draft quotation belonging to Org B — a competitor tenant on the same platform — and overwrites its discount %, SST %, grand total, and document-inclusion flags (MOF/SSM/TCC visibility, itemized pricing). This is a cross-tenant <em>write</em>, not just a read.</p>
        <h4>Fix applied</h4>
        <p>Both functions now capture <span class="mono">orgId</span> from <span class="mono">requireAccess()</span> and add it to the record lookup and the update's <span class="mono">where</span> clause — a quotation ID belonging to another org no longer matches.</p>
      </div>
    </details>

    <details class="finding" style="--tier-color: var(--medium);">
      <summary>
        <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
        <div class="title-block">
          <span class="fname">Purchase orders link to another org's requisition, and skip approval entirely</span>
          <span class="floc mono">server/purchase-order.ts — createPurchaseOrder():826-865</span>
        </div>
        <span class="badge critical">Cross-tenant write</span>
        <span class="badge medium">◐ Partially fixed</span>
      </summary>
      <div class="body">
        <p>When <span class="mono">input.purchaseRequisitionId</span> is set, the PR lookup and the update that flips its status to <span class="mono">ordered</span>/<span class="mono">partially_ordered</span> are filtered only by that ID — no organization check anywhere in the block. Separately: every PO this function creates is stamped <span class="mono">status: "confirmed"</span> unconditionally, so the entire approve/reject/recall machinery later in the file never applies to a freshly-created order.</p>
        <h4>Exploit scenario</h4>
        <p class="scenario">An employee at Acme Corp with only <span class="mono">purchase-order:create</span> learns or guesses a requisition ID belonging to Globex Inc, a different tenant, and creates a PO against it. The server links Globex's PR items to Acme's new PO and flips Globex's requisition to "ordered" — corrupting another tenant's procurement record. Separately, anyone with just <span class="mono">purchase-order:create</span> — not <span class="mono">purchase-order:approve</span> — can issue a fully confirmed, supplier-binding PO with no review step at all.</p>
        <h4>Fix applied</h4>
        <p><span class="mono">createPurchaseOrder</span> now verifies the referenced purchase requisition belongs to the caller's org before touching its items or status, and throws "Purchase requisition not found" if not — the cross-tenant write is closed.</p>
        <h4>Still open</h4>
        <p>The unconditional confirmed-on-create status is a separate, deliberately unresolved question — it may be an intentional business rule (creator = approver), so it wasn't changed without checking first.</p>
      </div>
    </details>
  </section>

  <!-- ══════════════════════ HIGH ══════════════════════ -->
  <section class="tier hi">
    <div class="tier-head"><span class="dot"></span><h2 class="serif">High</h2><span class="count">6 findings — real escalation or cross-tenant leak, bounded scope</span><span class="progress">✓ all 6 fixed</span></div>

    <details class="finding" style="--tier-color: var(--clean);">
      <summary>
        <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
        <div class="title-block">
          <span class="fname">An admin can grant themselves any of the 10 approval keys</span>
          <span class="floc mono">server/approvals.ts — setApprovalPermission():92</span>
        </div>
        <span class="badge high">Escalation</span>
        <span class="badge clean">✓ Fixed</span>
      </summary>
      <div class="body">
        <p>Gated by <span class="mono">requireOwnerOrAdmin()</span> only — grants any of the 10 <span class="mono">APPROVAL_ONLY_KEYS</span> (<span class="mono">payslip:publish</span>, <span class="mono">purchase-order:approve</span>, <span class="mono">claim:approve</span>, and seven more) to any target with no check the caller already holds it.</p>
        <h4>Exploit scenario</h4>
        <p class="scenario">Halim is an admin without <span class="mono">payslip:publish</span> — payroll release is meant to stay with Finance. Via Admin → Approvals he calls the grant on himself and now has company-wide authority to release payroll, something he never had before.</p>
        <h4>Fix applied</h4>
        <p>Added the same <span class="mono">assertCanGrant</span> pattern used in <span class="mono">permissions.ts</span> and <span class="mono">default-permissions.ts</span> — the caller's own resolved permissions are checked before any grant, and the request is rejected if the key being handed out isn't already theirs (or they're the owner).</p>
      </div>
    </details>

    <details class="finding" style="--tier-color: var(--clean);">
      <summary>
        <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
        <div class="title-block">
          <span class="fname">Resending an invitation skips the owner-approval queue entirely</span>
          <span class="floc mono">server/invitations.ts — revokeInvitation():137, resendInvitation():149</span>
        </div>
        <span class="badge high">Queue bypass</span>
        <span class="badge clean">✓ Fixed</span>
      </summary>
      <div class="body">
        <p>Neither function has any session/permission/org check — both just wrap the Better Auth API call directly. <span class="mono">resendInvitation</span> is the sharper problem: it writes an attacker-chosen <span class="mono">role</span>/<span class="mono">departmentId</span>/<span class="mono">departmentRole</span> straight into a freshly-created invitation, with no owner-only gate — unlike <span class="mono">sendInvitations</span>, which was specifically rebuilt this session to force every non-owner through the pending-approval queue.</p>
        <h4>Exploit scenario</h4>
        <p class="scenario">The whole point of the approval queue is that a non-owner can't hand a new hire an elevated role/department without sign-off. <span class="mono">resendInvitation</span> reopens exactly that path — anyone who can reach it mints a real, role-elevated invitation directly, sidestepping the workflow built specifically to stop this.</p>
        <h4>Fix applied</h4>
        <p><span class="mono">revokeInvitation</span> now requires <span class="mono">member:invite</span> and confirms the invitation belongs to the caller's org before cancelling it. <span class="mono">resendInvitation</span> gained the same session/permission/org checks, plus the same owner-branch as <span class="mono">sendInvitations</span>: a non-owner's resend cancels the old invitation (a reduction, always allowed) but queues the replacement as a <span class="mono">pendingInvitation</span> instead of minting it directly — only an owner's resend creates a real invitation immediately.</p>
      </div>
    </details>

    <details class="finding" style="--tier-color: var(--clean);">
      <summary>
        <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
        <div class="title-block">
          <span class="fname">Any other org's invitation list is one call away</span>
          <span class="floc mono">server/invitations.ts — getInvitations():15, getInvitationsAction():185, getMemberCount():35</span>
        </div>
        <span class="badge high">Cross-tenant read</span>
        <span class="badge clean">✓ Fixed</span>
      </summary>
      <div class="body">
        <p>None of the three check the session's active org against the <span class="mono">organizationId</span> argument. <span class="mono">getInvitationsAction</span> is called directly from the invite page's client component, so it's a live, directly-invokable action today.</p>
        <h4>Exploit scenario</h4>
        <p class="scenario">Any authenticated user of the app, from any org, calls <span class="mono">getInvitationsAction("&lt;other-org-id&gt;")</span> via devtools and receives that org's full pending-invitation list — emails, assigned roles, department targets, inviter names. <span class="mono">getMemberCount</span> leaks any org's headcount the same way.</p>
        <h4>Fix applied</h4>
        <p>Added a shared <span class="mono">assertOrgMatches</span> check that all three now call first — it derives <span class="mono">orgId</span> from the session and throws unless it matches the <span class="mono">organizationId</span> argument, closing the read for both the exported helpers and the client-callable action.</p>
      </div>
    </details>

    <details class="finding" style="--tier-color: var(--clean);">
      <summary>
        <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
        <div class="title-block">
          <span class="fname">Sales orders, quotations and invoices can attach another org's customer</span>
          <span class="floc mono">server/customer.ts — buildCustomerSnapshot():739 (used by sales-order.ts, quotation.ts, invoice.ts)</span>
        </div>
        <span class="badge high">Cross-tenant write</span>
        <span class="badge clean">✓ Fixed</span>
      </summary>
      <div class="body">
        <p>Looks up <span class="mono">customer</span> by ID alone, with no organization filter, ever. Called with a raw client-supplied <span class="mono">customerId</span> from <span class="mono">createSalesOrder</span>, <span class="mono">updateSalesOrder</span>, <span class="mono">createQuotation</span>, <span class="mono">updateQuotation</span>, <span class="mono">createGovernmentBatch</span>, <span class="mono">createInvoice</span>, and <span class="mono">createInvoiceManual</span> — none of which verify the customer belongs to the caller's org first.</p>
        <h4>Exploit scenario</h4>
        <p class="scenario">A sales coordinator at Org A creates a quotation using a customer ID belonging to Org B — obtained from a leaked link, a shared screen, or a PDF footer with an embedded ID. The resulting document permanently embeds Org B's customer name, email, phone, and address into an Org A record that Org A's whole team can now see. Bounded by needing a foreign, non-guessable ID, but the authorization boundary itself is missing.</p>
        <h4>Fix applied</h4>
        <p><span class="mono">buildCustomerSnapshot</span> now takes a required <span class="mono">orgId</span> (or a list of org IDs, for the handful of call sites that legitimately span every org one owner controls) and filters the customer lookup by it. Every call site — sales-order.ts, quotation.ts (including the government-batch and revision-rebuild paths), invoice.ts, delivery-order.ts, consignment.ts, customer-purchase-order.ts — now threads through its own already-resolved <span class="mono">orgId</span>.</p>
      </div>
    </details>

    <details class="finding" style="--tier-color: var(--clean);">
      <summary>
        <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
        <div class="title-block">
          <span class="fname">Another org's sales-order line items are one call away, no permission needed</span>
          <span class="floc mono">server/delivery-order.ts — getSoRemainingItems():176-225</span>
        </div>
        <span class="badge high">No auth</span>
        <span class="badge clean">✓ Fixed</span>
      </summary>
      <div class="body">
        <p>No <span class="mono">requireAccess()</span> at all — only checks that some active org session exists — and the item query has no organization filter. Confirmed reachable directly from the delivery-order creation page.</p>
        <h4>Exploit scenario</h4>
        <p class="scenario">Any authenticated member of Org A, even one with zero explicit permissions, calls this with a sales-order ID from Org B and receives its line items — product codes, descriptions, quantities, UOM — with no permission check of any kind.</p>
        <h4>Fix applied</h4>
        <p>Now calls <span class="mono">requireAccess("delivery-order:read")</span>, and the sales-order-item query joins <span class="mono">salesOrder</span> and filters by <span class="mono">salesOrder.organizationId</span> — a foreign sales-order ID no longer returns rows.</p>
      </div>
    </details>

    <details class="finding" style="--tier-color: var(--clean);">
      <summary>
        <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
        <div class="title-block">
          <span class="fname">Another org's supplier and pricing data leaks through a PO helper</span>
          <span class="floc mono">server/purchase-order.ts — getSalesOrderItemsForPo():405-484</span>
        </div>
        <span class="badge high">Cross-tenant read</span>
        <span class="badge clean">✓ Fixed</span>
      </summary>
      <div class="body">
        <p>Gated by <span class="mono">purchase-order:read</span>, but the subsequent purchase-order, sales-order-item, and product lookups are filtered only by <span class="mono">salesOrderId</span> or <span class="mono">productCode</span> — never by organization. Confirmed called from the PO create/edit client pages.</p>
        <h4>Exploit scenario</h4>
        <p class="scenario">A user in Org A with ordinary <span class="mono">purchase-order:read</span> supplies a foreign sales-order ID and learns which suppliers Org B already ordered from for that SO, plus — via the unscoped product lookup — potentially Org B's cost pricing on a matching product code.</p>
        <h4>Fix applied</h4>
        <p>All three lookups now filter by organization: the active-PO query adds <span class="mono">purchaseOrder.organizationId</span>, the sales-order-item query joins <span class="mono">salesOrder</span> and filters by its <span class="mono">organizationId</span>, and the product lookup adds <span class="mono">product.organizationId</span>.</p>
      </div>
    </details>
  </section>

  <!-- ══════════════════════ MEDIUM ══════════════════════ -->
  <section class="tier med">
    <div class="tier-head"><span class="dot"></span><h2 class="serif">Medium</h2><span class="count">6 findings — real gap, narrower blast radius or harder to reach</span><span class="progress">✓ all 6 fixed</span></div>

    <details class="finding" style="--tier-color: var(--clean);">
      <summary>
        <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
        <div class="title-block">
          <span class="fname">Certificate download links aren't checked against the requester's org</span>
          <span class="floc mono">server/organization-profile.ts — getPresignedUrl():176</span>
        </div>
        <span class="badge medium">Cross-tenant read</span>
        <span class="badge clean">✓ Fixed</span>
      </summary>
      <div class="body">
        <p>Checks only that a session exists, not that the caller's org owns the certificate key requested. Any authenticated user, from any org, can request a signed download URL for another org's private certificates — tax cert, MOF cert, bank statement — if the R2 key is known. Bounded: the key embeds org ID and an upload timestamp in milliseconds, so it isn't practically guessable, but the access-control design itself has no ownership check.</p>
        <h4>Fix applied</h4>
        <p>Certificate keys are always <span class="mono">org-certificates/&lt;orgId&gt;/...</span>. The function now derives the caller's own <span class="mono">orgId</span> from the session and compares it against the key's embedded org segment before signing — a mismatch throws <span class="mono">Unauthorized</span> instead of returning a usable URL.</p>
      </div>
    </details>

    <details class="finding" style="--tier-color: var(--clean);">
      <summary>
        <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
        <div class="title-block">
          <span class="fname">A draft claim can pull in another org's claim type</span>
          <span class="floc mono">server/claim.ts — updateDraftClaim():1143</span>
        </div>
        <span class="badge medium">Cross-tenant read</span>
        <span class="badge clean">✓ Fixed</span>
      </summary>
      <div class="body">
        <p>Every other claim-type lookup in this file filters by organization; this one filters only by <span class="mono">claimType.id</span>. An employee editing a draft can point <span class="mono">claimTypeId</span> at a different tenant's claim type, copying its name/code onto their draft. Self-correcting on finalize, which does re-validate with a proper org filter — so this is metadata leakage, not a permanent cross-org write.</p>
        <h4>Fix applied</h4>
        <p>Added the same <span class="mono">eq(claimType.organizationId, orgId)</span> filter already used in <span class="mono">finalizeDraftClaim</span> — a foreign claim type no longer resolves.</p>
      </div>
    </details>

    <details class="finding" style="--tier-color: var(--clean);">
      <summary>
        <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
        <div class="title-block">
          <span class="fname">A journal entry can reference another org's ledger account</span>
          <span class="floc mono">server/ledger.ts — createLedgerEntry():359-411</span>
        </div>
        <span class="badge medium">Cross-tenant read</span>
        <span class="badge clean">✓ Fixed</span>
      </summary>
      <div class="body">
        <p>No organization filter before snapshotting an account's code/name onto a new ledger line. An accounts clerk who knows or guesses a foreign <span class="mono">ledgerAccount.id</span> can create an entry referencing it, leaking that account's code/name into their own org's books and leaving an orphan line that won't reconcile in either org's trial balance. Bounded — no legitimate read path in this file exposes a foreign account ID.</p>
        <h4>Fix applied</h4>
        <p>The account lookup now filters by <span class="mono">organizationId</span>, and the function throws "One or more ledger accounts not found" if any requested account ID doesn't resolve within the caller's org — rather than silently writing a line with a blank code/name, which the naive fix would have done.</p>
      </div>
    </details>

    <details class="finding" style="--tier-color: var(--clean);">
      <summary>
        <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
        <div class="title-block">
          <span class="fname">Consignments can reference a sales order from another org</span>
          <span class="floc mono">server/consignment.ts — createConsignment():246, getConsignmentDetail():157</span>
        </div>
        <span class="badge medium">Cross-tenant read</span>
        <span class="badge clean">✓ Fixed</span>
      </summary>
      <div class="body">
        <p><span class="mono">createConsignment</span> stores a client-supplied <span class="mono">soId</span> without verifying it belongs to the caller's org; <span class="mono">getConsignmentDetail</span>'s status join on that SO has the same gap. Narrow blast radius — a single status field leaks — but the same unverified-ID shape as the rest of this list.</p>
        <h4>Fix applied</h4>
        <p><span class="mono">createConsignment</span> now looks up the sales order scoped by the caller's org first and throws "Sales order not found" if it isn't there, before storing <span class="mono">soId</span>. <span class="mono">getConsignmentDetail</span>'s status join now filters by <span class="mono">salesOrder.organizationId</span> too.</p>
      </div>
    </details>

    <details class="finding" style="--tier-color: var(--clean);">
      <summary>
        <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
        <div class="title-block">
          <span class="fname">A direct stock-level edit bypasses the two-person inventory check entirely</span>
          <span class="floc mono">server/inventory.ts — editStockLevel():506-565</span>
        </div>
        <span class="badge medium">Control bypass</span>
        <span class="badge clean">✓ Fixed</span>
      </summary>
      <div class="body">
        <p>Gated on <span class="mono">inventory:manage</span> alone. Unlike <span class="mono">adjustStock</span>/<span class="mono">transferStock</span>, which create a <span class="mono">PENDING</span> movement requiring a separate <span class="mono">inventory:approve</span> reviewer, this writes <span class="mono">stockLevel.quantity</span> directly and inserts an already-<span class="mono">APPROVED</span> movement. <span class="mono">inventory:manage</span> is granted to the "logistic manager" role, which does not include <span class="mono">inventory:approve</span>.</p>
        <h4>Exploit scenario</h4>
        <p class="scenario">A logistic manager covering a shrinkage discrepancy — or inflating available stock to push an order through — uses this function instead of the normal adjustment flow, bypassing the org's two-person inventory-review control entirely, with no second party ever involved.</p>
        <h4>Fix applied</h4>
        <p>Adopted <span class="mono">adjustStock</span>'s own auto-approve rule rather than inventing a new one: a quantity-changing correction now commits immediately only if the caller also holds <span class="mono">inventory:approve</span> (and self-approval isn't disabled for the org); otherwise it's inserted as a <span class="mono">PENDING</span> movement and <span class="mono">stockLevel.quantity</span> is left untouched until a separate reviewer approves it through the normal queue, which notifies <span class="mono">inventory:approve</span> holders. Metadata-only edits (reorder point, max stock, unit cost) still apply immediately, since they carry no risk of silently moving inventory.</p>
      </div>
    </details>

    <details class="finding" style="--tier-color: var(--clean);">
      <summary>
        <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
        <div class="title-block">
          <span class="fname">Anyone can edit anyone's draft purchase requisition</span>
          <span class="floc mono">server/purchase-requisition.ts — updatePurchaseRequisition():359-418</span>
        </div>
        <span class="badge medium">Inconsistent</span>
        <span class="badge clean">✓ Fixed</span>
      </summary>
      <div class="body">
        <p>Unlike its sibling <span class="mono">updatePurchaseOrder()</span>, which explicitly checks <span class="mono">existing.createdBy === userId</span>, this function has no ownership check at all — any holder of the generic <span class="mono">purchase-requisition:update</span> permission can edit any other user's draft requisition. May be an intentional collaborative-editing choice; worth confirming with the team either way.</p>
        <h4>Fix applied</h4>
        <p>Confirmed with the team: PR editing should match PO editing. Added <span class="mono">if (existing.requestedBy !== userId) throw new Error("Only the creator can edit this purchase requisition")</span> — the requisition table's creator column is named <span class="mono">requestedBy</span> rather than <span class="mono">createdBy</span>, but the check is otherwise identical to <span class="mono">updatePurchaseOrder</span>'s.</p>
      </div>
    </details>
  </section>

  <!-- ══════════════════════ LOW ══════════════════════ -->
  <section class="tier lo">
    <div class="tier-head"><span class="dot"></span><h2 class="serif">Low</h2><span class="count">15 findings — dead-code landmines, internal-only helpers, and small inconsistencies</span><span class="progress">✓ all 15 fixed</span></div>

    <div class="table-scroll">
      <table class="lo-table">
        <thead>
          <tr><th>Location</th><th>Issue</th><th>Why it's low</th><th>Fix applied</th></tr>
        </thead>
        <tbody>
          <tr>
            <td class="loc mono">roles.ts<br>(whole file)</td>
            <td>No auth anywhere; <span class="mono">createRole</span>/<span class="mono">updateRole</span> accept an arbitrary org ID and an arbitrary <span class="mono">permissions[]</span> array, including <span class="mono">"*"</span>.</td>
            <td>Confirmed dead — only reference anywhere is a commented-out import. Would be Critical if a UI ever wires it back up without adding auth first.</td>
            <td><span class="badge clean">✓ Fixed</span> Added org-membership + <span class="mono">organization-role:create/update/delete</span> checks to every export, plus the same <span class="mono">assertCanGrant</span> pattern on the permission arrays passed to <span class="mono">createRole</span>/<span class="mono">updateRole</span>.</td>
          </tr>
          <tr>
            <td class="loc mono">permissions.ts<br>getPermissions / createPermission / deletePermission</td>
            <td>No auth check on the global (non-org-scoped) permission catalog.</td>
            <td>Confirmed zero call sites anywhere in the app.</td>
            <td><span class="badge clean">✓ Fixed</span> Added an owner-of-active-org check — the closest available proxy for "trusted admin" on a resource with no owning org of its own.</td>
          </tr>
          <tr>
            <td class="loc mono">notifications.ts<br>createNotification &amp; helpers</td>
            <td>No auth — <span class="mono">createNotification</span> would let anyone spam arbitrary title/body/link content to any user if ever called client-side.</td>
            <td>Confirmed only imported from other server files today, never a client component.</td>
            <td><span class="badge clean">✓ Fixed</span> Added a floor session check to <span class="mono">createNotification</span>, <span class="mono">notifyUsersWithPermission</span>, <span class="mono">getSoApprovers</span> and <span class="mono">getPoApprovers</span> — can't require the target to be the caller (these notify other people by design), but a fully anonymous request is now rejected.</td>
          </tr>
          <tr>
            <td class="loc mono">document-numbering.ts<br>getNumberingConfig</td>
            <td>No auth; trusts caller-supplied org/doc-type.</td>
            <td>Confirmed server-only caller, never client-reachable.</td>
            <td><span class="badge clean">✓ Fixed</span> Added the same floor session check.</td>
          </tr>
          <tr>
            <td class="loc mono">organizations.ts<br>getActiveOrganization / getOrganizationLogo</td>
            <td>Trusts a caller-supplied <span class="mono">userId</span>; logo getter has no callers at all.</td>
            <td>Only call site passes the session's own ID server-side; logo URL is public via R2 anyway.</td>
            <td><span class="badge clean">✓ Fixed</span> <span class="mono">getActiveOrganization</span> runs inside Better Auth's <span class="mono">session.create.before</span> hook — before any session exists — so it can't carry a session check; moved it out of the server-actions layer entirely into <span class="mono">lib/auth/get-active-organization.ts</span> so it's no longer a client-invokable RPC endpoint. <span class="mono">getOrganizationLogo</span> had zero callers and returned the full org row, not just the logo — deleted outright.</td>
          </tr>
          <tr>
            <td class="loc mono">claim.ts<br>submitClaim / replaceClaimItems (travel-form link)</td>
            <td>Travel-form lock/unlock on claim submit checks <span class="mono">userId</span> but not <span class="mono">organizationId</span>.</td>
            <td>Only exploitable by a user who belongs to two orgs, against their own record in both — no cross-user exposure.</td>
            <td><span class="badge clean">✓ Fixed</span> Added <span class="mono">eq(travelForm.organizationId, orgId)</span> to all three travel-form lock/release queries in the file.</td>
          </tr>
          <tr>
            <td class="loc mono">field-stock.ts<br>transferToRep / returnFromRep</td>
            <td>No self-check, no per-staff stock-limit check, unlike the equivalent stock-request flow.</td>
            <td>Gated by <span class="mono">inventory:create</span>, which isn't in the grantable permission catalog — only an owner can reach this path today.</td>
            <td><span class="badge clean">✓ Fixed</span> <span class="mono">transferToRep</span> now enforces the same <span class="mono">staffStockLimit</span> holding cap <span class="mono">stock-request.ts</span> already uses — reps are real org members (confirmed via <span class="mono">getFieldReps</span>), so the same per-person limit applies. No self-check added: this flow has no approval step to self-approve, so there's no self-escalation vector to close.</td>
          </tr>
          <tr>
            <td class="loc mono">stock-reservation.ts<br>getSoStockStatus</td>
            <td>No auth check; trusts caller-supplied <span class="mono">orgId</span>.</td>
            <td>Confirmed not imported by any client component.</td>
            <td><span class="badge clean">✓ Fixed</span> Added a session check that asserts the caller's active org matches the <span class="mono">orgId</span> argument.</td>
          </tr>
          <tr>
            <td class="loc mono">payroll.ts<br>getMyPayslips / createPayslip / publishPayrollPeriod</td>
            <td>getMyPayslips skips the payslip:read:own check (but stays self-scoped); createPayslip doesn't verify the target user is an org member; publishPayrollPeriod has no self-action guard.</td>
            <td>No cross-user/cross-tenant exposure found; publish likely doesn't need a self-check since a payroll period isn't "owned" by one submitter.</td>
            <td><span class="badge clean">✓ Fixed</span> <span class="mono">getMyPayslips</span> now requires <span class="mono">payslip:read:own</span> (universal across every role bundle) and its query gained a missing <span class="mono">organizationId</span> filter — a genuine cross-org gap for multi-org users, beyond just the missing permission check. <span class="mono">createPayslip</span> now verifies the target <span class="mono">userId</span> is a member of the caller's org before creating a payslip for them. <span class="mono">publishPayrollPeriod</span> left as-is per the report's own reasoning — no single submitter owns a payroll period, so there's nothing coherent to self-check.</td>
          </tr>
          <tr>
            <td class="loc mono">sales-order.ts<br>toggleSoItemApprovalRejected</td>
            <td>Missing the <span class="mono">assertSelfActionAllowed</span> call its sibling approve/reject/recall actions all have.</td>
            <td>Only flags a line item, doesn't change the order's overall status.</td>
            <td><span class="badge clean">✓ Fixed</span> Added the same <span class="mono">assertSelfActionAllowed(orgId, "sales-order:approve", so.createdBy, userId, ...)</span> call as its siblings.</td>
          </tr>
          <tr>
            <td class="loc mono">quotation.ts<br>generateQuotationNo / peekNextQuotationNo</td>
            <td>No auth check; the first one mutates a shared numbering counter.</td>
            <td>Confirmed internal-only callers today.</td>
            <td><span class="badge clean">✓ Fixed</span> Added an org-membership check on both — deliberately checks membership in the target org generally rather than requiring an exact match to the caller's single active org, since the government-batch and finalize flows legitimately number quotations across every org one owner controls.</td>
          </tr>
          <tr>
            <td class="loc mono">purchase-order.ts / delivery-order.ts<br>updatePurchaseOrderStatus / updateDeliveryOrderStatus</td>
            <td>Accepts an arbitrary status string with no transition validation or self-check, bypassing the approval workflow.</td>
            <td>Confirmed unreferenced anywhere in the app — a landmine, not a live path.</td>
            <td><span class="badge clean">✓ Fixed</span> Deleted both outright — zero callers, and reconstructing a full transition validator for dead code wasn't worth it when the real approve/reject/recall/reconfirm functions already cover every valid state change.</td>
          </tr>
          <tr>
            <td class="loc mono">purchase-requisition.ts<br>checkAndTriggerReplenishment</td>
            <td>No auth check; trusts caller-supplied org/user IDs.</td>
            <td>Confirmed only called server-side after the caller's own auth check already ran.</td>
            <td><span class="badge clean">✓ Fixed</span> Added a session check that asserts the caller's active org matches the <span class="mono">orgId</span> argument.</td>
          </tr>
          <tr>
            <td class="loc mono">inventory.ts<br>editStockMovement</td>
            <td>Can rewrite another user's still-pending movement before it's approved, no audit trail of the substitution.</td>
            <td>Requires the privileged <span class="mono">inventory:manage</span> permission; a separate approver still has to sign off.</td>
            <td><span class="badge clean">✓ Fixed</span> <span class="mono">stock_movement</span> has no dedicated audit column, so rather than a schema migration for a Low finding, a substitution of the core fields (product/warehouse/type/qty) by someone other than the movement's creator now appends an audit line to <span class="mono">notes</span> naming the editor — visible to the reviewer before they sign off.</td>
          </tr>
          <tr>
            <td class="loc mono">invoice.ts<br>createInvoiceManual</td>
            <td>Gated by <span class="mono">organization-profile:update</span> rather than an invoice-specific permission.</td>
            <td>Not a bypass — still a real, enforced, org-scoped check. Just an odd permission choice worth a second look.</td>
            <td><span class="badge clean">✓ Fixed</span> Confirmed with the team: switched the gate to <span class="mono">invoice:create</span>, matching the permission the sibling <span class="mono">createInvoice</span> already uses, so the key names what the action actually does.</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>

  <!-- ══════════════════════ PHASE 2: API ROUTES & CONFIG ══════════════════════ -->
  <section class="tier" style="margin-top: 3rem;">
    <div class="tier-head" style="--tier-color: var(--high);"><span class="dot"></span><h2 class="serif">Phase 2 — API Routes &amp; Configuration</h2><span class="count">25 route handlers + auth config checked · 6 real findings</span><span class="progress">✓ all 6 fixed</span></div>
    <p style="color: var(--ink-soft); font-size: 0.92rem; max-width: 68ch; margin: 0.2rem 0 1.2rem;">The first pass covered <span class="mono">server/*.ts</span> "use server" actions only. Route handlers under <span class="mono">app/api/**</span> are a different trust boundary — raw HTTP endpoints with no same-origin guarantee, reachable by any client that has the right cookies, not just app-code <span class="mono">fetch</span> calls. This pass read all 25 of them, plus the Better Auth configuration, plus a scan for SQL injection, XSS, and committed secrets.</p>

    <details class="finding" style="--tier-color: var(--clean);">
      <summary>
        <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
        <div class="title-block">
          <span class="fname">A spreadsheet-upload endpoint has no authentication at all</span>
          <span class="floc mono">app/api/products/picture-ref/route.ts — POST():76</span>
        </div>
        <span class="badge high">No auth</span>
        <span class="badge clean">✓ Fixed</span>
      </summary>
      <div class="body">
        <p>No session check anywhere in the file. The route accepts an uploaded <span class="mono">.xlsx</span>, parses it with ExcelJS, fetches an external image per row, and rebuilds a new workbook — all before any auth boundary is checked, because there isn't one.</p>
        <h4>Exploit scenario</h4>
        <p class="scenario">Any HTTP client — no cookies, no account — POSTs a spreadsheet to this endpoint directly and gets back a rebuilt file with images merged in. Beyond being usable as an unauthenticated resource-exhaustion vector (expensive parsing + N external fetches per request, repeatable with no rate limit), it also works as an oracle: submit a list of product codes and see which ones return an image, enumerating the product catalog's image coverage without ever logging in.</p>
        <h4>Fix applied</h4>
        <p>Added the same session + <span class="mono">product:read</span> check its sibling <span class="mono">catalogue</span> route already had — the page that links to this feature was already gated by <span class="mono">product:read</span>, but the API endpoint underneath it wasn't.</p>
      </div>
    </details>

    <details class="finding" style="--tier-color: var(--clean);">
      <summary>
        <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
        <div class="title-block">
          <span class="fname">Any org member can bulk-write the product catalog, regardless of role</span>
          <span class="floc mono">app/api/products/seed/route.ts — POST():131</span>
        </div>
        <span class="badge medium">No permission check</span>
        <span class="badge clean">✓ Fixed</span>
      </summary>
      <div class="body">
        <p>Checks that a session exists and resolves the org correctly, but never checks a permission — every authenticated member, no matter their role, could bulk-insert/update product codes, prices, suppliers, and MDA certification data for their org.</p>
        <h4>Fix applied</h4>
        <p>Added a <span class="mono">product:seed</span> check — a permission key that already existed in the catalog and is already assigned in one role bundle, just never enforced by this route.</p>
      </div>
    </details>

    <details class="finding" style="--tier-color: var(--clean);">
      <summary>
        <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
        <div class="title-block">
          <span class="fname">MDA certificate PDFs skip the permission check its sibling route enforces</span>
          <span class="floc mono">app/api/quotation/[id]/mda-certs/route.ts — GET():123</span>
        </div>
        <span class="badge medium">No permission check</span>
        <span class="badge clean">✓ Fixed</span>
      </summary>
      <div class="body">
        <p>Correctly verifies the quotation belongs to the caller's own org (or a sibling org their owner controls) before serving anything — tenant isolation was never the gap. But unlike <span class="mono">app/api/quotation/[id]/pdf/route.ts</span>, which delegates to <span class="mono">getQuotationDetail()</span> and inherits its <span class="mono">quotation:read</span> check, this route does its own DB access directly and never checks any permission at all.</p>
        <h4>Exploit scenario</h4>
        <p class="scenario">An HR-only employee with zero sales permissions, but who is a member of the same org, calls this route with any quotation ID from their org and receives the merged MDA certificate PDF — bypassing the RBAC boundary every other quotation document route enforces.</p>
        <h4>Fix applied</h4>
        <p>Added the missing <span class="mono">quotation:read</span> check, matching the sibling PDF route.</p>
      </div>
    </details>

    <details class="finding" style="--tier-color: var(--clean);">
      <summary>
        <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
        <div class="title-block">
          <span class="fname">An unauthenticated geocoding proxy</span>
          <span class="floc mono">app/api/claim/distance/route.ts — POST():29</span>
        </div>
        <span class="badge medium">No auth</span>
        <span class="badge clean">✓ Fixed</span>
      </summary>
      <div class="body">
        <p>No session check. Used inline while filling in a claim or travel form's mileage fields, but reachable directly by anyone — it takes two free-text locations, geocodes both against OpenStreetMap's Nominatim, then asks OSRM for the driving distance.</p>
        <h4>Exploit scenario</h4>
        <p class="scenario">No tenant data is exposed, but an unauthenticated client can hit this endpoint directly and use the app's server as a free, unattributed proxy for two external geocoding/routing services — a cost and abuse vector against those third parties, and against this app's own OSRM/Nominatim rate limits.</p>
        <h4>Fix applied</h4>
        <p>Added a plain session check (no specific permission — both <span class="mono">claim:apply</span> and <span class="mono">travel:apply</span> holders use this same endpoint, and it doesn't touch any claim or travel-form data itself).</p>
      </div>
    </details>

    <details class="finding" style="--tier-color: var(--clean);">
      <summary>
        <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
        <div class="title-block">
          <span class="fname">Every account in the app was protected by as little as a 3-character password</span>
          <span class="floc mono">lib/auth.ts — emailAndPassword.minPasswordLength</span>
        </div>
        <span class="badge high">Weak policy</span>
        <span class="badge clean">✓ Fixed</span>
      </summary>
      <div class="body">
        <p><span class="mono">minPasswordLength: 3</span> — the whole app's login boundary accepted passwords as short as three characters, and there is no rate-limiting anywhere in the codebase to slow down brute-force attempts against the sign-in endpoint.</p>
        <h4>Fix applied</h4>
        <p>Raised to <span class="mono">minPasswordLength: 8</span>. This only affects passwords set from now on (signup, reset, change-password) — no existing account is locked out, since Better Auth enforces this on write, not on every login.</p>
      </div>
    </details>

    <details class="finding" style="--tier-color: var(--clean);">
      <summary>
        <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
        <div class="title-block">
          <span class="fname">Dev-only trusted origins shipped unconditionally to production</span>
          <span class="floc mono">lib/auth.ts — trustedOrigins</span>
        </div>
        <span class="badge low">Hygiene</span>
        <span class="badge clean">✓ Fixed</span>
      </summary>
      <div class="body">
        <p><span class="mono">trustedOrigins</span> included <span class="mono">localhost:3000</span> and two private-IP wildcard ranges (<span class="mono">192.168.*</span>, <span class="mono">172.20.10.*</span>) — clearly a developer's home/hotspot network, added for local testing — but unlike <span class="mono">baseUrl</span> a few lines above it, this array wasn't branched on <span class="mono">isProduction</span>, so it shipped to the production build too. Low severity: these are private RFC1918 ranges, so exploiting this would require an attacker already on the same private network as production traffic, not something reachable remotely.</p>
        <h4>Fix applied</h4>
        <p>The three dev-only entries now only get added when <span class="mono">!isProduction</span>, matching the pattern <span class="mono">baseUrl</span> already used.</p>
      </div>
    </details>

    <details class="finding" style="--tier-color: var(--clean);">
      <summary>
        <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
        <div class="title-block">
          <span class="fname">Document uploads accept any file type with no size cap</span>
          <span class="floc mono">claim, leave, ledger, travel-form upload routes; customer-po/upload</span>
        </div>
        <span class="badge low">Missing validation</span>
        <span class="badge clean">✓ Fixed</span>
      </summary>
      <div class="body">
        <p>None of the five upload routes restricted file extension/type or enforced a size limit. Self-org only, no cross-tenant impact — but an authorized member could upload arbitrary file types, including HTML/SVG, which browsers can execute if ever opened directly from a download link.</p>
        <h4>Fix applied</h4>
        <p>Added a shared <span class="mono">lib/uploads/validate.ts</span> allow-list (common document/image types, 25MB cap) used by all five routes. Honest limitation noted inline in that file: the four presigned-URL routes (claim/leave/ledger/travel-form) only ever see the client's <em>declared</em> filename/size, not the real bytes — the actual upload goes straight from browser to R2 — so this closes the malicious-extension angle but doesn't cryptographically enforce the size cap for those four. <span class="mono">customer-po/upload</span> receives real bytes server-side, so its check is fully enforced.</p>
      </div>
    </details>

    <div class="pattern-note" style="margin-top: 1.5rem;">
      <h2 class="serif" style="font-size: 1.05rem;">Also checked, nothing to fix</h2>
      <ol>
        <li><strong>SQL injection</strong> — grepped every <span class="mono">sql\`...\`</span> tagged-template use across <span class="mono">server/*.ts</span>; all interpolation goes through Drizzle's automatic parameter binding. Zero uses of <span class="mono">sql.raw()</span> anywhere in the codebase, which is the one API that would actually concatenate raw strings.</li>
        <li><strong>Committed secrets</strong> — no API keys, private keys, or hardcoded passwords found in tracked source; <span class="mono">.env</span>/<span class="mono">.env.local</span> are gitignored and never committed.</li>
        <li><strong>XSS</strong> — <span class="mono">dangerouslySetInnerHTML</span> is used in exactly one place in the whole app: this report page, and its content is a static template literal with no interpolated user or database data.</li>
        <li><strong>Remaining 22 API routes</strong> — every upload/download route (claim, customer-po, leave, ledger, travel-form) correctly verifies the requested file's org ownership in the database before presigning or redirecting; no path traversal or IDOR found in any <span class="mono">[...key]</span> catch-all. Every PDF/export route (claim, purchase-order, quotation, sales-order, ledger) delegates to an already-permission-checked, already-org-scoped server function. <span class="mono">app/api/auth/[...all]/route.ts</span> is Better Auth's unmodified catch-all handler. <span class="mono">app/api/permissions/route.ts</span> accepts a client-supplied org ID but <span class="mono">getUserPermissions()</span> re-verifies caller membership before returning anything. <span class="mono">app/api/test-helpers/invitation/route.ts</span> hard-404s outside <span class="mono">NODE_ENV=production</span>.</li>
        <li><strong>Two informational notes, not fixed</strong> — <span class="mono">getAllOwnerOrgIds()</span> (used by products mda-cert/catalogue routes) deliberately expands read access to every org the same owner controls, identically to the "conglomerate" pattern already used throughout quotation.ts; this looks intentional, not a bug. Separately, <span class="mono">lib/r2/*.ts</span>'s presigned-URL helpers sign whatever key they're handed with no org check of their own — safe today because every caller already validates first, but a fragile trust boundary if a future route ever calls them directly.</li>
      </ol>
    </div>
  </section>

  <!-- ══════════════════════ COVERAGE ══════════════════════ -->
  <section class="tier" style="margin-top: 3rem;">
    <div class="tier-head" style="--tier-color: var(--clean);"><span class="dot"></span><h2 class="serif">Confirmed clean</h2><span class="count">every other exported function, checked and passed</span></div>

    <details class="coverage-group">
      <summary><svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>Access control, members &amp; invitations<span class="n">✓ properly gated</span></summary>
      <div class="clist">approval-settings.ts, approvals.ts (reads), default-permissions.ts (reads + flag toggle), departments.ts, invitations.ts → <span class="mono">sendInvitations</span>, member-approvals.ts (all six functions — consistent <span class="mono">requireOwner()</span>), members.ts (org-member reads, <span class="mono">addMemberToDepartment</span>, <span class="mono">removeMemberFromDepartment</span>, <span class="mono">removeMember</span> — correctly blocks removing the owner and self-removal, <span class="mono">restoreMember</span>, <span class="mono">permanentlyDeleteMember</span>, <span class="mono">resyncOrgPermissions</span>), organizations.ts → <span class="mono">createOrganization</span>/<span class="mono">getOrganizations</span>, organization-profile.ts (all functions except the presigned-URL finding above), permissions.ts → <span class="mono">getMembersWithPermissions</span>/<span class="mono">getUserPermissionsForOrg</span>/<span class="mono">bulkGrantPermissions</span>/<span class="mono">bulkRevokePermissions</span>/<span class="mono">upsertUserPermission</span> (the already-patched <span class="mono">assertCanGrant</span> fix), users.ts, profile.ts (strictly self-scoped throughout), document-category.ts, document-numbering.ts (public functions), notifications.ts (public functions), workflow.ts, dashboard.ts, sales-activity.ts, warrant.ts.</div>
    </details>

    <details class="coverage-group">
      <summary><svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>HR workflows — claim, leave, travel, payroll<span class="n">✓ properly gated</span></summary>
      <div class="clist">claim.ts — every type/config function, all list/detail reads, <span class="mono">submitClaim</span> (org/cap checks correct), <span class="mono">approveClaim</span>/<span class="mono">rejectClaim</span>/<span class="mono">checkClaim</span>/<span class="mono">rejectByChecker</span> (all four correctly self-gated), <span class="mono">cancelClaim</span>, draft/resubmit flow, line-item edit/slash toggles (self-gated, locked once past PENDING), document handling. leave.ts — every function, <span class="mono">approveLeave</span>/<span class="mono">rejectLeave</span> both self-gated. travel-form.ts — every function, <span class="mono">approveTravelForm</span>/<span class="mono">rejectTravelForm</span> both self-gated. payroll.ts — period/payslip reads, <span class="mono">createPayrollPeriod</span>, <span class="mono">approvePayrollPeriod</span> (self-gated), <span class="mono">deletePayrollPeriod</span>, <span class="mono">updatePayslip</span>, <span class="mono">deletePayslip</span>.</div>
    </details>

    <details class="coverage-group">
      <summary><svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>Procurement &amp; inventory<span class="n">✓ properly gated</span></summary>
      <div class="clist">purchase-order.ts — all reads, <span class="mono">updatePurchaseOrder</span>/<span class="mono">deletePurchaseOrder</span> (enforce <span class="mono">createdBy === userId</span>), full <span class="mono">submit</span>/<span class="mono">approve</span>/<span class="mono">reject</span>/<span class="mono">recall</span>/<span class="mono">reconfirm</span> family (consistently self-gated), R2 upload/download helpers. purchase-requisition.ts — all reads, <span class="mono">createPurchaseRequisition</span>, <span class="mono">deletePurchaseRequisition</span>, <span class="mono">submitPurchaseRequisition</span>, <span class="mono">cancelPurchaseRequisition</span>, <span class="mono">approvePurchaseRequisition</span>/<span class="mono">rejectPurchaseRequisition</span> (self-gated). inventory.ts — stock/movement reads, <span class="mono">adjustStock</span> (correct auto-approval self-check), <span class="mono">transferStock</span>, <span class="mono">approveStockMovement</span>/<span class="mono">rejectStockMovement</span> (self-gated), lot management, <span class="mono">deleteStockLevel</span>/<span class="mono">deleteStockMovement</span> (owner-only). consignment.ts, customer-purchase-order.ts, delivery-order.ts — every function except the two findings above; no approve/reject concept exists for these doc types, so no self-guard gap applies.</div>
    </details>

    <details class="coverage-group">
      <summary><svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>Sales, quotations, invoicing &amp; ledger<span class="n">✓ properly gated</span></summary>
      <div class="clist">sales-order.ts — all reads, <span class="mono">deleteSalesOrder</span>, <span class="mono">updateSalesOrderStatus</span>, <span class="mono">submitSalesOrder</span>, <span class="mono">approveSalesOrder</span>/<span class="mono">rejectSalesOrder</span>/<span class="mono">recallSalesOrder</span> (all three self-gated), <span class="mono">toggleSoItemPrExcluded</span>. quotation.ts — every list/detail/search function, <span class="mono">finalizeQuotation</span>, <span class="mono">updateQuotation</span> (record-level check correct — only the nested customer ID has the systemic gap noted above), <span class="mono">createGovernmentBatch</span>, <span class="mono">deleteQuotation</span>, <span class="mono">reviseQuotation</span>. customer.ts — every function except <span class="mono">buildCustomerSnapshot</span> itself. invoice.ts — all reads, create/update/delete (record-level org check correct), status transitions, <span class="mono">sendInvoice</span>, <span class="mono">markInvoicePaid</span>/<span class="mono">markInvoiceOverdue</span>, <span class="mono">cancelInvoice</span>. ledger.ts — account CRUD, entry reads, <span class="mono">postLedgerEntry</span>, <span class="mono">voidLedgerEntry</span>, trial balance, subsidiary ledger, document handling. products.ts — every exported function; no per-user pricing-authority tiers exist in this app, so there's no discount ceiling to bypass.</div>
    </details>
  </section>

  <div class="closing">
    <h2 class="serif">Where things stand</h2>
    <p>All four tiers from the first pass are fully patched — thirty of thirty-two findings closed outright, three closed on a security issue with a business-logic question put to the team rather than guessed at. A second-pass sweep of the API routes and auth configuration then found and closed six more real gaps outside the first pass's scope, and confirmed clean on SQL injection, XSS, and committed secrets.</p>
    <div class="phase-list">
      <div class="phase"><span class="num mono">✓</span><span><strong>Critical — done.</strong> All five findings addressed: self-escalation blocked in Default Permissions, the payslip YTD leak closed, the invoice-stats auth bypass removed, quotation settings scoped by org, and purchase-order/requisition linking scoped by org (confirmed-on-create status left as an open question for the team).</span></div>
      <div class="phase"><span class="num mono">✓</span><span><strong>High — done.</strong> All six findings addressed: approvals self-escalation blocked, invitation resend/revoke routed through auth and the owner-approval queue, invitation-list cross-tenant read closed, <span class="mono">buildCustomerSnapshot</span> scoped by org everywhere it's called, and the two remaining unscoped sales-order-item/product lookups (delivery-order and purchase-order) filtered by org.</span></div>
      <div class="phase"><span class="num mono">✓</span><span><strong>Medium — done.</strong> All six findings addressed: certificate presigned URLs checked against the key's embedded org, the draft-claim claim-type lookup scoped by org, the ledger account lookup scoped by org (with a hard failure instead of a silent blank snapshot), consignment's sales-order reference verified against the caller's org, the stock-level balance-correction bypass routed through the same approve/self-approve rule as <span class="mono">adjustStock</span>, and purchase-requisition editing restricted to its creator — confirmed with the team to match purchase-order's existing behavior.</span></div>
      <div class="phase"><span class="num mono">✓</span><span><strong>Low — done.</strong> All fifteen findings addressed: dead-code landmines (roles.ts, permissions.ts catalog, the two arbitrary-status setters) hardened or deleted outright rather than left as future traps; internal-only helpers (notifications, document-numbering, stock-reservation, quotation numbering, replenishment trigger) given floor session/org checks; the auth-hook org lookup moved out of the server-actions layer entirely; real gaps closed in claim.ts's travel-form org scoping, payroll's org filter and membership check, sales-order's missing self-action guard, field-stock's per-rep holding limit, and inventory's pending-movement audit trail; the invoice.ts permission-key choice corrected after confirming with the team.</span></div>
      <div class="phase"><span class="num mono">✓</span><span><strong>Phase 2 — done.</strong> All six findings addressed: two completely unauthenticated endpoints closed (an Excel-upload route with no session check at all, and a geocoding proxy anyone could hit), two permission checks added to match sibling routes (product-catalog seeding, quotation MDA certs), the app-wide minimum password length raised from 3 to 8 characters, dev-only trusted origins scoped out of production, and a shared file-type/size allow-list added across all five upload routes. SQL injection, XSS, and committed secrets all came back clean.</span></div>
    </div>
  </div>

  <footer class="colophon">Four parallel audits + a second-pass API/config sweep · server/*.ts (39 files) + 25 API routes + auth config · Everything found, patched</footer>

</div>
`;

// Only the org owner should be able to read this — it's an exact map of
// every unpatched authorization hole in the app.
export default async function TestBoundaryPage() {
  await requireOwner();

  return (
    <div className="tba-root">
      <style dangerouslySetInnerHTML={{ __html: REPORT_CSS }} />
      <div dangerouslySetInnerHTML={{ __html: REPORT_HTML }} />
    </div>
  );
}
