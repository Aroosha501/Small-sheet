"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type CellStyle = {
  bold?: boolean;
  italic?: boolean;
  align?: "left" | "center" | "right";
  color?: string;
  backgroundColor?: string;
};

type Sheet = {
  id: string;
  name: string;
  cells: Record<string, string>;
  styles: Record<string, CellStyle>;
};

type Selection = {
  start: string;
  end: string;
};

type History = {
  past: Record<string, string>[];
  present: Record<string, string>;
  future: Record<string, string>[];
};

const STORAGE_KEY = "small-sheet-workbook";
const COLUMNS = ["A", "B", "C", "D", "E", "F", "G", "H"];
const ROWS = Array.from({ length: 20 }, (_, index) => index + 1);

function getColumnNumber(column: string) {
  let number = 0;

  for (const character of column) {
    number = number * 26 + character.charCodeAt(0) - 64;
  }

  return number;
}

function getColumnName(number: number) {
  let result = "";

  while (number > 0) {
    const remainder = (number - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    number = Math.floor((number - 1) / 26);
  }

  return result;
}

function getCellAddress(row: number, column: string) {
  return `${column}${row}`;
}

function getCellPosition(address: string) {
  const match = address.match(/^([A-Z]+)(\d+)$/);

  if (!match) {
    return null;
  }

  return {
    column: getColumnNumber(match[1]),
    row: Number(match[2]),
  };
}

function getRangeAddresses(start: string, end: string) {
  const first = getCellPosition(start);
  const last = getCellPosition(end);

  if (!first || !last) {
    return [start];
  }

  const minRow = Math.min(first.row, last.row);
  const maxRow = Math.max(first.row, last.row);
  const minColumn = Math.min(first.column, last.column);
  const maxColumn = Math.max(first.column, last.column);

  const addresses: string[] = [];

  for (let row = minRow; row <= maxRow; row++) {
    for (let column = minColumn; column <= maxColumn; column++) {
      addresses.push(`${getColumnName(column)}${row}`);
    }
  }

  return addresses;
}

function parseCSV(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let insideQuotes = false;

  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    const nextCharacter = text[index + 1];

    if (character === '"' && insideQuotes && nextCharacter === '"') {
      value += '"';
      index++;
    } else if (character === '"') {
      insideQuotes = !insideQuotes;
    } else if (character === "," && !insideQuotes) {
      row.push(value);
      value = "";
    } else if ((character === "\n" || character === "\r") && !insideQuotes) {
      if (character === "\r" && nextCharacter === "\n") {
        index++;
      }

      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else {
      value += character;
    }
  }

  row.push(value);

  if (row.length > 1 || row[0] !== "" || rows.length === 0) {
    rows.push(row);
  }

  return rows;
}

function escapeCSV(value: string) {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }

  return value;
}

function evaluateArithmetic(expression: string): number {
  const matchedTokens = expression.match(/\d+(?:\.\d+)?|[()+\-*/]/g);
  const tokens: string[] = matchedTokens || [];

  if (
    tokens.length === 0 ||
    tokens.join("") !== expression.replace(/\s/g, "")
  ) {
    throw new Error("Invalid formula");
  }

  let position = 0;

  function parseExpression(): number {
    let result = parseTerm();

    while (
      tokens[position] === "+" ||
      tokens[position] === "-"
    ) {
      const operator = tokens[position++];
      const right = parseTerm();

      result =
        operator === "+"
          ? result + right
          : result - right;
    }

    return result;
  }

  function parseTerm(): number {
    let result = parseFactor();

    while (
      tokens[position] === "*" ||
      tokens[position] === "/"
    ) {
      const operator = tokens[position++];
      const right = parseFactor();

      if (operator === "/" && right === 0) {
        throw new Error("Division by zero");
      }

      result =
        operator === "*"
          ? result * right
          : result / right;
    }

    return result;
  }

  function parseFactor(): number {
    const token = tokens[position];

    if (token === "+") {
      position++;
      return parseFactor();
    }

    if (token === "-") {
      position++;
      return -parseFactor();
    }

    if (token === "(") {
      position++;

      const result = parseExpression();

      if (tokens[position] !== ")") {
        throw new Error("Missing closing bracket");
      }

      position++;
      return result;
    }

    if (!token || !/^\d+(?:\.\d+)?$/.test(token)) {
      throw new Error("Invalid formula");
    }

    position++;

    return Number(token);
  }

  const result = parseExpression();

  if (position !== tokens.length || !Number.isFinite(result)) {
    throw new Error("Invalid formula");
  }

  return result;
}
function calculateCell(
  address: string,
  cells: Record<string, string>,
  visiting = new Set<string>()
): string {
  const rawValue = cells[address] ?? "";

  if (!rawValue.startsWith("=")) {
    return rawValue;
  }

  if (visiting.has(address)) {
    return "#CIRCULAR!";
  }

  const nextVisiting = new Set(visiting);
  nextVisiting.add(address);

  try {
    let expression = rawValue.slice(1).trim();

    const functionMatch = expression.match(
      /^(SUM|AVERAGE|COUNT|MIN|MAX)\(([A-Z]+\d+):([A-Z]+\d+)\)$/i
    );

    if (functionMatch) {
      const functionName = functionMatch[1].toUpperCase();
      const addresses = getRangeAddresses(
        functionMatch[2],
        functionMatch[3]
      );

      const values = addresses.map((cellAddress) => {
        const result = calculateCell(cellAddress, cells, nextVisiting);

        if (result === "#CIRCULAR!" || result === "#ERROR!") {
          throw new Error("Invalid referenced cell");
        }

        const number = Number(result);
        return result.trim() !== "" && Number.isFinite(number)
          ? number
          : null;
      });

      const numbers = values.filter(
        (value): value is number => value !== null
      );

      if (functionName === "COUNT") {
        return String(numbers.length);
      }

      if (numbers.length === 0) {
        return "0";
      }

      if (functionName === "SUM") {
        return String(numbers.reduce((total, value) => total + value, 0));
      }

      if (functionName === "AVERAGE") {
        return String(
          numbers.reduce((total, value) => total + value, 0) /
            numbers.length
        );
      }

      if (functionName === "MIN") {
        return String(Math.min(...numbers));
      }

      return String(Math.max(...numbers));
    }

    expression = expression.replace(
      /([A-Z]+\d+)/g,
      (reference) => {
        const result = calculateCell(reference, cells, nextVisiting);

        if (result === "#CIRCULAR!" || result === "#ERROR!") {
          throw new Error("Invalid referenced cell");
        }

        if (result.trim() === "") {
          return "0";
        }

        const number = Number(result);

        if (!Number.isFinite(number)) {
          throw new Error("Referenced cell is not a number");
        }

        return String(number);
      }
    );

    return String(evaluateArithmetic(expression));
  } catch {
    return "#ERROR!";
  }
}

export default function Home() {
  const [sheets, setSheets] = useState<Sheet[]>([
    {
      id: "sheet-1",
      name: "Sheet1",
      cells: {},
      styles: {},
    },
  ]);

  const [activeSheetId, setActiveSheetId] = useState("sheet-1");
  const [cellValues, setCellValues] = useState<Record<string, string>>({});
  const [cellStyles, setCellStyles] = useState<Record<string, CellStyle>>({});
  const [activeCell, setActiveCell] = useState("A1");
  const [selectedRange, setSelectedRange] = useState<Selection>({
    start: "A1",
    end: "A1",
  });
  const [editingCell, setEditingCell] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saveStatus, setSaveStatus] = useState("Loading...");
  const [isLoaded, setIsLoaded] = useState(false);

  const historyRef = useRef<Record<string, History>>({});
  const nextSheetNumberRef = useRef(2);
  const csvInputRef = useRef<HTMLInputElement | null>(null);
  const jsonInputRef = useRef<HTMLInputElement | null>(null);
  const isDraggingRef = useRef(false);

  const activeSheet = sheets.find((sheet) => sheet.id === activeSheetId);

  const getCommittedCells = useCallback(() => {
    if (!editingCell) {
      return cellValues;
    }

    const next = { ...cellValues };

    if (draft === "") {
      delete next[editingCell];
    } else {
      next[editingCell] = draft;
    }

    return next;
  }, [cellValues, draft, editingCell]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);

      if (saved) {
        const parsed = JSON.parse(saved);

        if (Array.isArray(parsed.sheets) && parsed.sheets.length > 0) {
          const loadedSheets: Sheet[] = parsed.sheets.map(
            (sheet: Partial<Sheet>, index: number) => ({
              id: sheet.id || `sheet-${index + 1}`,
              name: sheet.name || `Sheet${index + 1}`,
              cells: sheet.cells || {},
              styles: sheet.styles || {},
            })
          );

          const savedActiveId = loadedSheets.some(
            (sheet) => sheet.id === parsed.activeSheetId
          )
            ? parsed.activeSheetId
            : loadedSheets[0].id;

          setSheets(loadedSheets);
          setActiveSheetId(savedActiveId);

          const selectedSheet = loadedSheets.find(
            (sheet) => sheet.id === savedActiveId
          );

          setCellValues(selectedSheet?.cells || {});
          setCellStyles(selectedSheet?.styles || {});

          loadedSheets.forEach((sheet) => {
            historyRef.current[sheet.id] = {
              past: [],
              present: sheet.cells || {},
              future: [],
            };
          });

          const highestNumber = loadedSheets.reduce((highest, sheet) => {
            const match = sheet.id.match(/sheet-(\d+)/);
            return Math.max(highest, match ? Number(match[1]) : 0);
          }, 1);

          nextSheetNumberRef.current = Math.max(
            parsed.nextSheetNumber || 2,
            highestNumber + 1
          );
        }
      }
    } catch {
      setSaveStatus("Load failed");
    }

    setIsLoaded(true);
  }, []);

  useEffect(() => {
    if (!isLoaded) {
      return;
    }

    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          sheets,
          activeSheetId,
          nextSheetNumber: nextSheetNumberRef.current,
        })
      );

      setSaveStatus("Saved");
    } catch {
      setSaveStatus("Save failed");
    }
  }, [sheets, activeSheetId, isLoaded]);

  useEffect(() => {
    const stopDragging = () => {
      isDraggingRef.current = false;
    };

    window.addEventListener("mouseup", stopDragging);

    return () => {
      window.removeEventListener("mouseup", stopDragging);
    };
  }, []);

  const updateSheetData = useCallback(
    (
      nextCells: Record<string, string>,
      nextStyles: Record<string, CellStyle> = cellStyles
    ) => {
      setCellValues(nextCells);
      setCellStyles(nextStyles);

      setSheets((currentSheets) =>
        currentSheets.map((sheet) =>
          sheet.id === activeSheetId
            ? {
                ...sheet,
                cells: nextCells,
                styles: nextStyles,
              }
            : sheet
        )
      );
    },
    [activeSheetId, cellStyles]
  );

  const commitCells = useCallback(
    (nextCells: Record<string, string>) => {
      const history = historyRef.current[activeSheetId] || {
        past: [],
        present: cellValues,
        future: [],
      };

      historyRef.current[activeSheetId] = {
        past: [...history.past, history.present].slice(-100),
        present: nextCells,
        future: [],
      };

      updateSheetData(nextCells);
    },
    [activeSheetId, cellValues, updateSheetData]
  );

  const finishEditing = useCallback(
    (moveTo?: string) => {
      if (editingCell) {
        const nextCells = { ...cellValues };

        if (draft === "") {
          delete nextCells[editingCell];
        } else {
          nextCells[editingCell] = draft;
        }

        commitCells(nextCells);
        setEditingCell(null);
      }

      if (moveTo) {
        setActiveCell(moveTo);
        setSelectedRange({ start: moveTo, end: moveTo });
      }
    },
    [cellValues, commitCells, draft, editingCell]
  );

  const startEditing = useCallback(
    (address: string, initialValue?: string) => {
      setActiveCell(address);
      setSelectedRange({ start: address, end: address });
      setEditingCell(address);
      setDraft(
        initialValue !== undefined ? initialValue : cellValues[address] || ""
      );
    },
    [cellValues]
  );

  const undo = useCallback(() => {
    const history = historyRef.current[activeSheetId];

    if (!history || history.past.length === 0) {
      return;
    }

    const previous = history.past[history.past.length - 1];

    historyRef.current[activeSheetId] = {
      past: history.past.slice(0, -1),
      present: previous,
      future: [history.present, ...history.future],
    };

    updateSheetData(previous);
    setEditingCell(null);
  }, [activeSheetId, updateSheetData]);

  const redo = useCallback(() => {
    const history = historyRef.current[activeSheetId];

    if (!history || history.future.length === 0) {
      return;
    }

    const next = history.future[0];

    historyRef.current[activeSheetId] = {
      past: [...history.past, history.present],
      present: next,
      future: history.future.slice(1),
    };

    updateSheetData(next);
    setEditingCell(null);
  }, [activeSheetId, updateSheetData]);

  const createSheet = () => {
    const committedCells = getCommittedCells();
    const currentSheets = sheets.map((sheet) =>
      sheet.id === activeSheetId
        ? { ...sheet, cells: committedCells, styles: cellStyles }
        : sheet
    );

    const number = nextSheetNumberRef.current++;
    const newSheet: Sheet = {
      id: `sheet-${number}`,
      name: `Sheet${number}`,
      cells: {},
      styles: {},
    };

    historyRef.current[activeSheetId] = {
      ...(historyRef.current[activeSheetId] || {
        past: [],
        future: [],
      }),
      present: committedCells,
    };

    historyRef.current[newSheet.id] = {
      past: [],
      present: {},
      future: [],
    };

    setSheets([...currentSheets, newSheet]);
    setActiveSheetId(newSheet.id);
    setCellValues({});
    setCellStyles({});
    setActiveCell("A1");
    setSelectedRange({ start: "A1", end: "A1" });
    setEditingCell(null);
  };

  const switchSheet = (sheetId: string) => {
    if (sheetId === activeSheetId) {
      return;
    }

    const committedCells = getCommittedCells();

    const updatedSheets = sheets.map((sheet) =>
      sheet.id === activeSheetId
        ? { ...sheet, cells: committedCells, styles: cellStyles }
        : sheet
    );

    const targetSheet = updatedSheets.find((sheet) => sheet.id === sheetId);

    if (!targetSheet) {
      return;
    }

    historyRef.current[activeSheetId] = {
      ...(historyRef.current[activeSheetId] || {
        past: [],
        future: [],
      }),
      present: committedCells,
    };

    setSheets(updatedSheets);
    setActiveSheetId(sheetId);
    setCellValues(targetSheet.cells);
    setCellStyles(targetSheet.styles || {});
    setActiveCell("A1");
    setSelectedRange({ start: "A1", end: "A1" });
    setEditingCell(null);
  };

  const renameSheet = (sheetId: string) => {
    const sheet = sheets.find((item) => item.id === sheetId);

    if (!sheet) {
      return;
    }

    const newName = window.prompt("Enter the new sheet name:", sheet.name);

    if (newName && newName.trim()) {
      setSheets((currentSheets) =>
        currentSheets.map((item) =>
          item.id === sheetId
            ? { ...item, name: newName.trim() }
            : item
        )
      );
    }
  };

  const deleteSheet = () => {
    if (sheets.length <= 1) {
      window.alert("You must keep at least one sheet.");
      return;
    }

    const sheet = sheets.find((item) => item.id === activeSheetId);

    if (!sheet || !window.confirm(`Delete "${sheet.name}"?`)) {
      return;
    }

    const committedCells = getCommittedCells();

    const updatedSheets = sheets.map((item) =>
      item.id === activeSheetId
        ? { ...item, cells: committedCells, styles: cellStyles }
        : item
    );

    const remainingSheets = updatedSheets.filter(
      (item) => item.id !== activeSheetId
    );

    delete historyRef.current[activeSheetId];

    const nextSheet = remainingSheets[0];

    setSheets(remainingSheets);
    setActiveSheetId(nextSheet.id);
    setCellValues(nextSheet.cells);
    setCellStyles(nextSheet.styles || {});
    setActiveCell("A1");
    setSelectedRange({ start: "A1", end: "A1" });
    setEditingCell(null);
  };

  const applyStyle = (style: Partial<CellStyle>) => {
    const addresses = getRangeAddresses(
      selectedRange.start,
      selectedRange.end
    );

    const nextStyles = { ...cellStyles };

    addresses.forEach((address) => {
      nextStyles[address] = {
        ...nextStyles[address],
        ...style,
      };
    });

    updateSheetData(getCommittedCells(), nextStyles);
  };

  const toggleStyle = (property: "bold" | "italic") => {
    const currentStyle = cellStyles[activeCell]?.[property];

    applyStyle({ [property]: !currentStyle });
  };

  const clearSelectedCells = () => {
    const nextCells = { ...cellValues };

    getRangeAddresses(selectedRange.start, selectedRange.end).forEach(
      (address) => {
        delete nextCells[address];
      }
    );

    commitCells(nextCells);
    setEditingCell(null);
  };

  const copySelectedCells = async () => {
    const start = getCellPosition(selectedRange.start);
    const end = getCellPosition(selectedRange.end);

    if (!start || !end) {
      return;
    }

    const minRow = Math.min(start.row, end.row);
    const maxRow = Math.max(start.row, end.row);
    const minColumn = Math.min(start.column, end.column);
    const maxColumn = Math.max(start.column, end.column);

    const rows: string[] = [];

    for (let row = minRow; row <= maxRow; row++) {
      const values: string[] = [];

      for (let column = minColumn; column <= maxColumn; column++) {
        const address = `${getColumnName(column)}${row}`;
        values.push(cellValues[address] || "");
      }

      rows.push(values.join("\t"));
    }

    await navigator.clipboard.writeText(rows.join("\n"));
  };

  const pasteCells = async () => {
    const clipboardText = await navigator.clipboard.readText();
    const rows = clipboardText.replace(/\r/g, "").split("\n");

    if (rows.length === 1 && rows[0] === "") {
      return;
    }

    const start = getCellPosition(activeCell);

    if (!start) {
      return;
    }

    const nextCells = { ...cellValues };

    rows.forEach((row, rowIndex) => {
      row.split("\t").forEach((value, columnIndex) => {
        const rowNumber = start.row + rowIndex;
        const columnNumber = start.column + columnIndex;

        if (
          rowNumber >= 1 &&
          rowNumber <= 20 &&
          columnNumber >= 1 &&
          columnNumber <= 8
        ) {
          const address = `${getColumnName(columnNumber)}${rowNumber}`;

          if (value === "") {
            delete nextCells[address];
          } else {
            nextCells[address] = value;
          }
        }
      });
    });

    commitCells(nextCells);
  };

  const exportCSV = () => {
    const csvRows = ROWS.map((row) =>
      COLUMNS.map((column) => {
        const address = getCellAddress(row, column);
        return escapeCSV(cellValues[address] || "");
      }).join(",")
    );

    const blob = new Blob([csvRows.join("\r\n")], {
      type: "text/csv;charset=utf-8;",
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `${activeSheet?.name || "sheet"}.csv`;
    link.click();

    URL.revokeObjectURL(url);
  };

  const importCSV = async (file: File) => {
    try {
      const text = await file.text();
      const rows = parseCSV(text);
      const nextCells: Record<string, string> = {};

      rows.slice(0, 20).forEach((row, rowIndex) => {
        row.slice(0, 8).forEach((value, columnIndex) => {
          if (value !== "") {
            const address = `${getColumnName(columnIndex + 1)}${rowIndex + 1}`;
            nextCells[address] = value;
          }
        });
      });

      commitCells(nextCells);
      setCellStyles({});
      setSheets((currentSheets) =>
        currentSheets.map((sheet) =>
          sheet.id === activeSheetId
            ? { ...sheet, cells: nextCells, styles: {} }
            : sheet
        )
      );
      setActiveCell("A1");
      setSelectedRange({ start: "A1", end: "A1" });
      setEditingCell(null);
      setSaveStatus("CSV imported");
    } catch {
      window.alert("Could not import this CSV file.");
    }
  };

  const exportJSON = () => {
    const committedCells = getCommittedCells();

    const workbook = {
      version: 1,
      activeSheetId,
      nextSheetNumber: nextSheetNumberRef.current,
      sheets: sheets.map((sheet) =>
        sheet.id === activeSheetId
          ? { ...sheet, cells: committedCells, styles: cellStyles }
          : sheet
      ),
    };

    const blob = new Blob([JSON.stringify(workbook, null, 2)], {
      type: "application/json",
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = "small-sheet-workbook.json";
    link.click();

    URL.revokeObjectURL(url);
  };

  const importJSON = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);

      if (
        !parsed ||
        !Array.isArray(parsed.sheets) ||
        parsed.sheets.length === 0
      ) {
        throw new Error("Invalid workbook");
      }

      const importedSheets: Sheet[] = parsed.sheets.map(
        (sheet: Partial<Sheet>, index: number) => {
          if (!sheet || typeof sheet.cells !== "object") {
            throw new Error("Invalid sheet data");
          }

          return {
            id: sheet.id || `sheet-${index + 1}`,
            name: sheet.name || `Sheet${index + 1}`,
            cells: sheet.cells || {},
            styles: sheet.styles || {},
          };
        }
      );

      const importedActiveId = importedSheets.some(
        (sheet) => sheet.id === parsed.activeSheetId
      )
        ? parsed.activeSheetId
        : importedSheets[0].id;

      const selectedSheet = importedSheets.find(
        (sheet) => sheet.id === importedActiveId
      )!;

      historyRef.current = {};

      importedSheets.forEach((sheet) => {
        historyRef.current[sheet.id] = {
          past: [],
          present: sheet.cells,
          future: [],
        };
      });

      const highestNumber = importedSheets.reduce((highest, sheet) => {
        const match = sheet.id.match(/sheet-(\d+)/);
        return Math.max(highest, match ? Number(match[1]) : 0);
      }, 1);

      nextSheetNumberRef.current = Math.max(
        parsed.nextSheetNumber || 2,
        highestNumber + 1
      );

      setSheets(importedSheets);
      setActiveSheetId(importedActiveId);
      setCellValues(selectedSheet.cells);
      setCellStyles(selectedSheet.styles);
      setActiveCell("A1");
      setSelectedRange({ start: "A1", end: "A1" });
      setEditingCell(null);
      setSaveStatus("Workbook restored");
    } catch {
      window.alert("This JSON file is not a valid Small Sheet backup.");
    }
  };

  const handleGridKeyDown = async (
    event: React.KeyboardEvent<HTMLDivElement>
  ) => {
    const target = event.target as HTMLElement;
    const isInput =
      target.tagName === "INPUT" || target.tagName === "TEXTAREA";

    if (isInput) {
      return;
    }

    if (event.ctrlKey && event.key.toLowerCase() === "z") {
      event.preventDefault();
      undo();
      return;
    }

    if (
      event.ctrlKey &&
      (event.key.toLowerCase() === "y" ||
        (event.shiftKey && event.key.toLowerCase() === "z"))
    ) {
      event.preventDefault();
      redo();
      return;
    }

    if (event.ctrlKey && event.key.toLowerCase() === "c") {
      event.preventDefault();
      await copySelectedCells();
      return;
    }

    if (event.ctrlKey && event.key.toLowerCase() === "v") {
      event.preventDefault();
      await pasteCells();
      return;
    }

    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      clearSelectedCells();
      return;
    }

    if (event.key === "F2") {
      event.preventDefault();
      startEditing(activeCell);
      return;
    }

    const position = getCellPosition(activeCell);

    if (!position) {
      return;
    }

    let nextRow = position.row;
    let nextColumn = position.column;

    if (event.key === "ArrowUp") nextRow--;
    else if (event.key === "ArrowDown") nextRow++;
    else if (event.key === "ArrowLeft") nextColumn--;
    else if (event.key === "ArrowRight") nextColumn++;
    else if (event.key === "Enter") nextRow++;
    else if (event.key === "Tab") nextColumn += event.shiftKey ? -1 : 1;
    else if (
      event.key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      event.preventDefault();
      startEditing(activeCell, event.key);
      return;
    } else {
      return;
    }

    event.preventDefault();

    nextRow = Math.max(1, Math.min(20, nextRow));
    nextColumn = Math.max(1, Math.min(8, nextColumn));

    const nextAddress = `${getColumnName(nextColumn)}${nextRow}`;

    if (event.shiftKey && event.key.startsWith("Arrow")) {
      setSelectedRange((current) => ({
        start: current.start,
        end: nextAddress,
      }));
      setActiveCell(nextAddress);
    } else {
      setActiveCell(nextAddress);
      setSelectedRange({ start: nextAddress, end: nextAddress });
    }
  };

  const selectedAddresses = useMemo(
    () => new Set(getRangeAddresses(selectedRange.start, selectedRange.end)),
    [selectedRange]
  );

  const formulaValue = editingCell
    ? draft
    : cellValues[activeCell] || "";

  const activeStyle = cellStyles[activeCell] || {};

  return (
    <main className="app" onKeyDown={handleGridKeyDown} tabIndex={0}>
      <header className="toolbar">
        <h1>Small Sheet</h1>

        <div className="toolbar-actions">
          <button onClick={undo}>Undo</button>
          <button onClick={redo}>Redo</button>
          <button onClick={createSheet}>+ New Sheet</button>
          <button onClick={deleteSheet}>Delete Sheet</button>
        </div>
      </header>

      <div className="format-toolbar">
        <button
          className={activeStyle.bold ? "format-active" : ""}
          onClick={() => toggleStyle("bold")}
          title="Bold"
        >
          <strong>B</strong>
        </button>

        <button
          className={activeStyle.italic ? "format-active" : ""}
          onClick={() => toggleStyle("italic")}
          title="Italic"
        >
          <em>I</em>
        </button>

        <select
          aria-label="Text alignment"
          value={activeStyle.align || "left"}
          onChange={(event) =>
            applyStyle({
              align: event.target.value as "left" | "center" | "right",
            })
          }
        >
          <option value="left">Align left</option>
          <option value="center">Align center</option>
          <option value="right">Align right</option>
        </select>

        <label className="color-control" title="Text color">
          <span>A</span>
          <input
            type="color"
            value={activeStyle.color || "#111827"}
            onChange={(event) => applyStyle({ color: event.target.value })}
          />
        </label>

        <label className="color-control" title="Cell background color">
          <span>Fill</span>
          <input
            type="color"
            value={activeStyle.backgroundColor || "#ffffff"}
            onChange={(event) =>
              applyStyle({ backgroundColor: event.target.value })
            }
          />
        </label>

        <button onClick={() => applyStyle({ color: undefined })}>
          Clear text color
        </button>

        <button onClick={() => applyStyle({ backgroundColor: undefined })}>
          Clear fill
        </button>
      </div>

      <div className="file-toolbar">
        <button onClick={exportCSV}>Export CSV</button>
        <button onClick={() => csvInputRef.current?.click()}>
          Import CSV
        </button>
        <button onClick={exportJSON}>Backup Workbook</button>
        <button onClick={() => jsonInputRef.current?.click()}>
          Restore Workbook
        </button>

        <input
          ref={csvInputRef}
          type="file"
          accept=".csv,text/csv"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];

            if (file) {
              void importCSV(file);
            }

            event.target.value = "";
          }}
        />

        <input
          ref={jsonInputRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];

            if (file) {
              void importJSON(file);
            }

            event.target.value = "";
          }}
        />
      </div>

      <div className="formula-bar">
        <div className="cell-reference">{activeCell}</div>

        <div className="formula-symbol">fx</div>

        <input
          value={formulaValue}
          onChange={(event) => {
            if (!editingCell) {
              setEditingCell(activeCell);
            }

            setDraft(event.target.value);
          }}
          onFocus={() => {
            if (!editingCell) {
              setEditingCell(activeCell);
              setDraft(cellValues[activeCell] || "");
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === "Tab") {
              event.preventDefault();

              const position = getCellPosition(activeCell);

              if (position) {
                const nextColumn =
                  event.key === "Tab"
                    ? Math.max(
                        1,
                        Math.min(8, position.column + (event.shiftKey ? -1 : 1))
                      )
                    : position.column;

                const nextRow =
                  event.key === "Enter"
                    ? Math.max(1, Math.min(20, position.row + 1))
                    : position.row;

                finishEditing(
                  `${getColumnName(nextColumn)}${nextRow}`
                );
              }
            }

            if (event.key === "Escape") {
              setEditingCell(null);
              setDraft("");
            }
          }}
          placeholder="Enter a value or formula"
        />
      </div>

      <div className="sheet-container">
        <table className="sheet-grid">
          <thead>
            <tr>
              <th className="row-header"></th>
              {COLUMNS.map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>

          <tbody>
            {ROWS.map((row) => (
              <tr key={row}>
                <th className="row-header">{row}</th>

                {COLUMNS.map((column) => {
                  const address = getCellAddress(row, column);
                  const isActive = activeCell === address;
                  const isSelected = selectedAddresses.has(address);
                  const style = cellStyles[address] || {};
                  const displayValue = calculateCell(address, cellValues);

                  return (
                    <td
                      key={address}
                      className={[
                        isActive ? "active-cell" : "",
                        isSelected ? "range-selected" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      onMouseDown={(event) => {
                        if (event.shiftKey) {
                          setSelectedRange((current) => ({
                            start: current.start,
                            end: address,
                          }));
                        } else {
                          setSelectedRange({
                            start: address,
                            end: address,
                          });
                        }

                        setActiveCell(address);
                        setEditingCell(null);
                        isDraggingRef.current = true;
                      }}
                      onMouseEnter={() => {
                        if (isDraggingRef.current) {
                          setSelectedRange((current) => ({
                            start: current.start,
                            end: address,
                          }));
                          setActiveCell(address);
                        }
                      }}
                      onDoubleClick={() => startEditing(address)}
                    >
                      {editingCell === address ? (
                        <input
                          className="cell-input"
                          value={draft}
                          autoFocus
                          onChange={(event) => setDraft(event.target.value)}
                          onBlur={() => finishEditing()}
                          onKeyDown={(event) => {
                            if (
                              event.key === "Enter" ||
                              event.key === "Tab"
                            ) {
                              event.preventDefault();

                              const position = getCellPosition(address);

                              if (position) {
                                const nextColumn =
                                  event.key === "Tab"
                                    ? Math.max(
                                        1,
                                        Math.min(
                                          8,
                                          position.column +
                                            (event.shiftKey ? -1 : 1)
                                        )
                                      )
                                    : position.column;

                                const nextRow =
                                  event.key === "Enter"
                                    ? Math.max(
                                        1,
                                        Math.min(20, position.row + 1)
                                      )
                                    : position.row;

                                finishEditing(
                                  `${getColumnName(nextColumn)}${nextRow}`
                                );
                              }
                            }

                            if (event.key === "Escape") {
                              setEditingCell(null);
                              setDraft("");
                            }
                          }}
                          style={{
                            fontWeight: style.bold ? "bold" : "normal",
                            fontStyle: style.italic ? "italic" : "normal",
                            textAlign: style.align || "left",
                            color: style.color || "#111827",
                            backgroundColor:
                              style.backgroundColor || "transparent",
                          }}
                        />
                      ) : (
                        <div
                          className="cell-display"
                          style={{
                            fontWeight: style.bold ? "bold" : "normal",
                            fontStyle: style.italic ? "italic" : "normal",
                            textAlign: style.align || "left",
                            color: style.color || "#111827",
                            backgroundColor:
                              style.backgroundColor || "transparent",
                          }}
                        >
                          {displayValue}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <footer className="sheet-footer">
        <div className="sheet-tabs">
          {sheets.map((sheet) => (
            <div
              key={sheet.id}
              className={`sheet-tab ${
                sheet.id === activeSheetId ? "active-tab" : ""
              }`}
            >
              <button onClick={() => switchSheet(sheet.id)}>
                {sheet.name}
              </button>

              <button
                className="rename-tab"
                onClick={() => renameSheet(sheet.id)}
                title="Rename sheet"
              >
                ✎
              </button>
            </div>
          ))}
        </div>

        <div className="status-bar">
          <span>{saveStatus}</span>
          <span>
            SUM:{" "}
            {getRangeAddresses(
              selectedRange.start,
              selectedRange.end
            )
              .map((address) => Number(calculateCell(address, cellValues)))
              .filter(Number.isFinite)
              .reduce((total, value) => total + value, 0)}
          </span>
          <span>
            COUNT:{" "}
            {getRangeAddresses(
              selectedRange.start,
              selectedRange.end
            ).filter((address) => {
              const value = calculateCell(address, cellValues);
              return value.trim() !== "" && Number.isFinite(Number(value));
            }).length}
          </span>
        </div>
      </footer>
    </main>
  );
}