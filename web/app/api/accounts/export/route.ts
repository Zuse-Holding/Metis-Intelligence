import { NextRequest, NextResponse } from "next/server";
import { accountsToCsv } from "../../../../lib/accounts";
import { listAccounts, requireAccountsAccess } from "../../../../lib/supabase/accounts";

/** The account list as a CSV that HubSpot, Salesforce or a spreadsheet can import. */
export async function GET(req: NextRequest) {
  const access = await requireAccountsAccess();
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  try {
    const { accounts } = await listAccounts(access.userId);
    const origin = req.nextUrl.origin;
    const csv = accountsToCsv(
      accounts.map((a) => ({
        company: a.company,
        stage: a.stage,
        dealValue: a.dealValue,
        nextStep: a.nextStep,
        health: a.health,
        owner: a.owner,
        notes: a.notes,
        latestReportAt: a.latestRun?.generatedAt ?? null,
        latestReportUrl: a.latestRun ? `${origin}/app?run=${a.latestRun.id}` : null,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
      })),
    );
    const date = new Date().toISOString().slice(0, 10);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="metis-accounts-${date}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[accounts] export failed:", err);
    return NextResponse.json({ error: "Couldn't build the export." }, { status: 500 });
  }
}
