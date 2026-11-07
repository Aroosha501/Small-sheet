import { NextRequest, NextResponse } from "next/server";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATA_DIRECTORY = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIRECTORY, "sheets.json");

type Sheet = {
  id: string;
  name: string;
  cells: Record<string, string>;
};

type Workbook = {
  sheets: Sheet[];
  updatedAt: string;
};

async function readWorkbook(): Promise<Workbook | null> {
  try {
    const content = await readFile(DATA_FILE, "utf8");
    return JSON.parse(content) as Workbook;
  } catch {
    return null;
  }
}

async function ensureDataDirectory() {
  await mkdir(DATA_DIRECTORY, { recursive: true });
}

export async function GET() {
  try {
    const workbook = await readWorkbook();

    return NextResponse.json({
      success: true,
      workbook,
    });
  } catch {
    return NextResponse.json(
      { success: false, message: "Could not load workbook." },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();

    if (
      !body ||
      !Array.isArray(body.sheets) ||
      body.sheets.length === 0
    ) {
      return NextResponse.json(
        { success: false, message: "Invalid workbook data." },
        { status: 400 },
      );
    }

    const sheets: Sheet[] = [];

    for (const sheet of body.sheets) {
      if (
        !sheet ||
        typeof sheet.id !== "string" ||
        typeof sheet.name !== "string" ||
        !sheet.cells ||
        typeof sheet.cells !== "object" ||
        Array.isArray(sheet.cells)
      ) {
        return NextResponse.json(
          { success: false, message: "Invalid sheet data." },
          { status: 400 },
        );
      }

      const entries = Object.entries(sheet.cells);

      if (entries.length > 150000) {
        return NextResponse.json(
          { success: false, message: "Sheet contains too many cells." },
          { status: 413 },
        );
      }

      const safeCells: Record<string, string> = {};

      for (const [address, value] of entries) {
        if (
          !/^[A-Z]+[1-9]\d*$/i.test(address) ||
          typeof value !== "string" ||
          value.length > 10000
        ) {
          return NextResponse.json(
            { success: false, message: "Invalid cell data." },
            { status: 400 },
          );
        }

        safeCells[address.toUpperCase()] = value;
      }

      sheets.push({
        id: sheet.id.slice(0, 100),
        name: sheet.name.slice(0, 100),
        cells: safeCells,
      });
    }

    // Deliberate assessment delay: 300–1500 ms.
    const delay = 300 + Math.floor(Math.random() * 1201);

    await new Promise((resolve) => setTimeout(resolve, delay));

    // Deliberate assessment failure simulation: approximately 1 in 5 saves.
    if (Math.random() < 0.2) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Simulated save failure. Your local changes are still available; retry saving.",
        },
        { status: 503 },
      );
    }

    await ensureDataDirectory();

    const workbook: Workbook = {
      sheets,
      updatedAt: new Date().toISOString(),
    };

    await writeFile(DATA_FILE, JSON.stringify(workbook), "utf8");

    return NextResponse.json({
      success: true,
      updatedAt: workbook.updatedAt,
    });
  } catch {
    return NextResponse.json(
      { success: false, message: "Could not save workbook." },
      { status: 500 },
    );
  }
}