import { NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createDefaultFixtures } from "../../../lib/fixtures";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATA_DIRECTORY = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIRECTORY, "sheets.json");

export async function POST() {
  try {
    const sheets = createDefaultFixtures();

    await mkdir(DATA_DIRECTORY, { recursive: true });

    const workbook = {
      sheets,
      updatedAt: new Date().toISOString(),
    };

    await writeFile(DATA_FILE, JSON.stringify(workbook), "utf8");

    return NextResponse.json({
      success: true,
      message: "Fixtures have been reset.",
      sheets,
    });
  } catch {
    return NextResponse.json(
      {
        success: false,
        message: "Could not reset fixtures.",
      },
      { status: 500 },
    );
  }
}