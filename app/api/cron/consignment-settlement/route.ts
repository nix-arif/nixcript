import { runMonthlyAutoSettlements } from "@/lib/consignment/settle";

// Monthly automatic consignment settlement. Call on the 1st of each month
// (e.g. Vercel Cron or a Trigger.dev schedule) with
//   Authorization: Bearer <CRON_SECRET>
// It settles the previous month for every owner → agent pair set to
// "automatic, monthly"; running it twice is harmless (nothing left to settle).
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const summary = await runMonthlyAutoSettlements();
  return Response.json(summary);
}
