# Archive

These documents describe plans and systems that have been replaced or rejected. They are kept for the record only. Do not follow them and do not update them.

For what is true now, start with [`CONTEXT.md`](../../CONTEXT.md), the decisions in [`docs/adr/`](../adr/) and the latest review in [`docs/reviews/`](../reviews/).

| Document | What it was | What replaced it |
|---|---|---|
| [`AUDIT_REPORT.md`](AUDIT_REPORT.md) | Repository audit of June 2026. | The reviews in [`docs/reviews/`](../reviews/): the September 2026 platform review and the November 2026 product audit. |
| [`IMPLEMENTATION_SUMMARY.md`](IMPLEMENTATION_SUMMARY.md) | Summary of the work that set up the Vercel + Neon deployment. | [`DEPLOYMENT.md`](../../DEPLOYMENT.md) for the stack as it runs today, and [ADR 0001](../adr/0001-firebase-auth-and-firestore.md) for where it is going. |
| [`AUTH_ARCHITECTURE.md`](AUTH_ARCHITECTURE.md) | How Firebase Auth was layered over the Neon `users` table after Stack Auth was removed. | [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) for sign-in as it works today, and [ADR 0001](../adr/0001-firebase-auth-and-firestore.md) and [ADR 0002](../adr/0002-guests-use-anonymous-sign-in.md) for the design that replaces it. |
| [`PRD.md`](PRD.md) | Product requirements of January 2026 ("Value Add Cost Calculator" 2.0), with a roadmap of email export, quotes and templates. | [`CONTEXT.md`](../../CONTEXT.md), [ADR 0003](../adr/0003-five-pages-inventory-is-separate.md) and the [November 2026 product audit](../reviews/2026-11-product-audit.md). |
| [`AUTH_MIGRATION_ROADMAP.md`](AUTH_MIGRATION_ROADMAP.md) | Plan to move from Stack Auth to Better Auth on Cloudflare. | Superseded by [ADR 0001](../adr/0001-firebase-auth-and-firestore.md). |
| [`firebase-sql-connect-proof.md`](firebase-sql-connect-proof.md) | Notes on the Firebase SQL Connect proof that lived in `dataconnect/`. | Rejected by [ADR 0001](../adr/0001-firebase-auth-and-firestore.md). The `dataconnect/` directory has been deleted. It was added in #71 and was last present at commit `83c5f26`. |
| [`firebase-sql-connect-migration-verdict.md`](firebase-sql-connect-migration-verdict.md) | Verdict on that proof, recommending a second phase. | Rejected by [ADR 0001](../adr/0001-firebase-auth-and-firestore.md). |
| [`2026-03-27-branding-redesign-design.md`](2026-03-27-branding-redesign-design.md) | Navy and rust branding specification of March 2026. It was at `docs/superpowers/specs/`. | Superseded by [`docs/STYLE_GUIDE.md`](../STYLE_GUIDE.md), which sets the direction. [`docs/DESIGN_SYSTEM.md`](../DESIGN_SYSTEM.md) describes the look as built today. |

File paths inside these documents are as they were when each was written. Several of them no longer exist.
