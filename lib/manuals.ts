// User manuals (HTML), kept out of public/ so only signed-in users can open
// them — served by app/manuals/[slug]/route.ts, listed on /dashboard/documentation.
export const MANUALS = [
  { slug: "claim", file: "claim-manual.html", title: "Claim Submission Manual", description: "How to submit expense claims", icon: "📋" },
  { slug: "leave", file: "leave-manual.html", title: "Leave Submission Manual", description: "How to apply for leave", icon: "📅" },
  { slug: "case-do", file: "case-do-manual.html", title: "Case DO Manual", description: "Doctor templates, customer copy, recording actual items, internal copy and invoice", icon: "🩺" },
  { slug: "consignment", file: "consignment-manual.html", title: "Consignment Manual", description: "Consign stock, record usage, machines and settlement", icon: "📦" },
  { slug: "inventory", file: "inventory-manual.html", title: "Inventory Manual", description: "Warehouses, field stock, movements, lots & serial numbers, Stock Rules", icon: "🏬" },
  { slug: "test-guide", file: "test-guide.html", title: "Test Guide — Inventory, Case DO, Consignment, Leave & Claims", description: "Step-by-step use cases to retest (ticks saved in your browser)", icon: "✅" },
] as const;
