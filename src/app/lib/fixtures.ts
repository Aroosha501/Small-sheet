export type SheetFixture = {
  id: string;
  name: string;
  cells: Record<string, string>;
};

function columnName(number: number): string {
  let result = "";
  let current = number;

  while (current > 0) {
    const remainder = (current - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    current = Math.floor((current - 1) / 26);
  }

  return result;
}

function createBudgetSheet(): SheetFixture {
  const cells: Record<string, string> = {
    A1: "MONTHLY BUDGET",
    A2: "Category",
    B2: "Planned",
    C2: "Actual",
    D2: "Difference",

    A3: "Housing",
    B3: "1200",
    C3: "1200",
    D3: "=B3-C3",

    A4: "Utilities",
    B4: "250",
    C4: "220",
    D4: "=B4-C4",

    A5: "Internet",
    B5: "80",
    C5: "75",
    D5: "=B5-C5",

    A6: "Groceries",
    B6: "500",
    C6: "465",
    D6: "=B6-C6",

    A7: "Transport",
    B7: "180",
    C7: "155",
    D7: "=B7-C7",

    A8: "Fuel",
    B8: "120",
    C8: "110",
    D8: "=B8-C8",

    A9: "Healthcare",
    B9: "100",
    C9: "60",
    D9: "=B9-C9",

    A10: "Entertainment",
    B10: "150",
    C10: "125",
    D10: "=B10-C10",

    A11: "Shopping",
    B11: "200",
    C11: "175",
    D11: "=B11-C11",

    A12: "Education",
    B12: "150",
    C12: "150",
    D12: "=B12-C12",

    A13: "Savings",
    B13: "400",
    C13: "400",
    D13: "=B13-C13",

    A14: "Insurance",
    B14: "130",
    C14: "130",
    D14: "=B14-C14",

    A15: "Subscriptions",
    B15: "60",
    C15: "45",
    D15: "=B15-C15",

    A16: "Dining",
    B16: "120",
    C16: "95",
    D16: "=B16-C16",

    A17: "Personal care",
    B17: "90",
    C17: "75",
    D17: "=B17-C17",

    A18: "Gifts",
    B18: "70",
    C18: "40",
    D18: "=B18-C18",

    A19: "Miscellaneous",
    B19: "100",
    C19: "65",
    D19: "=B19-C19",

    A21: "Fixed expenses",
    B21: "=SUM(B3:B5)",
    C21: "=SUM(C3:C5)",
    D21: "=B21-C21",

    A22: "Living expenses",
    B22: "=SUM(B6:B10)",
    C22: "=SUM(C6:C10)",
    D22: "=B22-C22",

    A23: "Other expenses",
    B23: "=SUM(B11:B19)",
    C23: "=SUM(C11:C19)",
    D23: "=B23-C23",

    A25: "Expense subtotal",
    B25: "=SUM(B21:B23)",
    C25: "=SUM(C21:C23)",
    D25: "=B25-C25",

    A26: "Budget reserve",
    B26: "200",
    C26: "150",
    D26: "=B26-C26",

    A28: "TOTAL PLANNED / ACTUAL",
    B28: "=B25+B26",
    C28: "=C25+C26",
    D28: "=B28-C28",

    A29: "Remaining budget",
    B29: "=B28-C28",
    C29: "=B29",
    D29: "=B29-C29",

    
  };

  return {
    id: "budget",
    name: "Budget",
    cells,
  };
}

function createBigSheet(): SheetFixture {
  const cells: Record<string, string> = {
    A1: "ID",
    B1: "Product",
    C1: "Region",
    D1: "Units",
    E1: "Unit Price",
    F1: "Revenue",
    G1: "Cost",
    H1: "Profit",
    I1: "Quarter",
    J1: "Sales Rep",
    K1: "Tax",
    L1: "Net Total",
  };

  const regions = ["North", "South", "East", "West"];
  const quarters = ["Q1", "Q2", "Q3", "Q4"];
  const products = ["Laptop", "Monitor", "Keyboard", "Mouse", "Tablet"];
  const salesReps = ["Alex", "Jordan", "Taylor", "Morgan"];

  for (let row = 2; row <= 10001; row++) {
    const index = row - 2;
    const units = (index % 20) + 1;
    const price = 50 + ((index * 17) % 450);
    const cost = 20 + ((index * 11) % 180);

    cells[`A${row}`] = String(index + 1);
    cells[`B${row}`] = products[index % products.length];
    cells[`C${row}`] = regions[index % regions.length];
    cells[`D${row}`] = String(units);
    cells[`E${row}`] = String(price);
    cells[`F${row}`] = `=D${row}*E${row}`;
    cells[`G${row}`] = String(cost);
    cells[`H${row}`] = `=F${row}-(D${row}*G${row})`;
    cells[`I${row}`] = quarters[index % quarters.length];
    cells[`J${row}`] = salesReps[index % salesReps.length];
    cells[`K${row}`] = `=F${row}*0.05`;
    cells[`L${row}`] = `=F${row}-K${row}`;
  }

  cells.A10002 = "GRAND TOTAL";
  cells.F10002 = "=SUM(F2:F10001)";
  cells.H10002 = "=SUM(H2:H10001)";
  cells.K10002 = "=SUM(K2:K10001)";
  cells.L10002 = "=SUM(L2:L10001)";

  return {
    id: "big-sheet",
    name: "Big Sheet",
    cells,
  };
}

function createBrokenSheet(): SheetFixture {
  return {
    id: "broken",
    name: "Broken Sheet",
    cells: {
      A1: "Formula error test",
      A2: "Circular reference",
      B2: "=C2+1",
      C2: "=B2+1",

      A4: "Missing reference",
      B4: "=ZZ999999+10",

      A6: "Division by zero",
      B6: "=100/0",

      A8: "Depends on broken formula",
      B8: "=B6+20",

      A10: "Valid formula",
      B10: "20",
      C10: "30",
      D10: "=B10+C10",

      A12: "Valid range",
      B12: "10",
      B13: "20",
      B14: "30",
      B15: "=SUM(B12:B14)",
    },
  };
}

export function createDefaultFixtures(): SheetFixture[] {
  return [
    createBudgetSheet(),
    createBigSheet(),
    createBrokenSheet(),
  ];
}

export function createEmptySheet(
  id: string,
  name: string,
): SheetFixture {
  return {
    id,
    name,
    cells: {},
  };
}