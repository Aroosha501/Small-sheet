"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  evaluateWorkbook,
  getAffectedCells,
} from "./lib/formula";

import {
  createDefaultFixtures,
  createEmptySheet,
} from "./lib/fixtures";

type Sheet = {
  id: string;
  name: string;
  cells: Record<string, string>;
};

type Position = {
  row: number;
  col: number;
};

type Selection = {
  start: Position;
  end: Position;
};

type SaveState = "saved" | "saving" | "failed";

type HistoryState = {
  sheets: Sheet[];
  activeSheetId: string;
  selection: Selection;
};

const COLUMN_COUNT = 12;
const INITIAL_ROW_COUNT = 10000;
const ROW_HEIGHT = 32;
const HEADER_HEIGHT = 34;
const ROW_HEADER_WIDTH = 52;
const DEFAULT_COLUMN_WIDTH = 120;
const MAX_PASTE_CELLS = 50000;

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

function columnNumber(column: string): number {
  let result = 0;

  for (const character of column.toUpperCase()) {
    result = result * 26 + character.charCodeAt(0) - 64;
  }

  return result;
}

function addressOf(position: Position): string {
  return `${columnName(position.col)}${position.row}`;
}

function parseAddress(address: string): Position | null {
  const match = address.toUpperCase().match(/^([A-Z]+)([1-9]\d*)$/);

  if (!match) return null;

  return {
    col: columnNumber(match[1]),
    row: Number(match[2]),
  };
}

function cloneSheets(sheets: Sheet[]): Sheet[] {
  return sheets.map((sheet) => ({
    ...sheet,
    cells: { ...sheet.cells },
  }));
}

function createId(): string {
  return `sheet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getSelectedPositions(selection: Selection): Position[] {
  const minRow = Math.min(selection.start.row, selection.end.row);
  const maxRow = Math.max(selection.start.row, selection.end.row);
  const minCol = Math.min(selection.start.col, selection.end.col);
  const maxCol = Math.max(selection.start.col, selection.end.col);

  const positions: Position[] = [];

  for (let row = minRow; row <= maxRow; row++) {
    for (let col = minCol; col <= maxCol; col++) {
      positions.push({ row, col });
    }
  }

  return positions;
}

function getRangeAddress(selection: Selection): string {
  const first = addressOf(selection.start);
  const last = addressOf(selection.end);

  return first === last ? first : `${first}:${last}`;
}

function getInitialSelection(): Selection {
  return {
    start: { row: 1, col: 1 },
    end: { row: 1, col: 1 },
  };
}

export default function Home() {
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [activeSheetId, setActiveSheetId] = useState("budget");
  const [selection, setSelection] = useState<Selection>(
    getInitialSelection,
  );

  const [editingCell, setEditingCell] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [formulaDraft, setFormulaDraft] = useState("");

  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveMessage, setSaveMessage] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");

  const [darkMode, setDarkMode] = useState(false);
  const [columnWidths, setColumnWidths] = useState<Record<number, number>>(
    {},
  );

  const [renamingSheetId, setRenamingSheetId] = useState<string | null>(
    null,
  );
  const [renameValue, setRenameValue] = useState("");

  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);
  const [draggingSelection, setDraggingSelection] = useState(false);

  const [history, setHistory] = useState<HistoryState[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const gridRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLInputElement>(null);
  const formulaRef = useRef<HTMLInputElement>(null);
  const resizeRef = useRef<{
    col: number;
    startX: number;
    startWidth: number;
  } | null>(null);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveSequenceRef = useRef(0);
  const latestSequenceRef = useRef(0);
  const isSavingRef = useRef(false);
  const queuedSaveRef = useRef<Sheet[] | null>(null);
  const initializedRef = useRef(false);
  const skipNextHistoryRef = useRef(false);

  const activeSheet = useMemo(
    () => sheets.find((sheet) => sheet.id === activeSheetId) ?? null,
    [sheets, activeSheetId],
  );

  const activeAddress = addressOf(selection.start);
  const selectedAddress = getRangeAddress(selection);

  const formulaResults = useMemo(() => {
    if (!activeSheet) {
      return {
        values: {},
        dependencies: {},
        dependents: {},
      };
    }

    return evaluateWorkbook(activeSheet.cells);
  }, [activeSheet]);

  const activeRawValue = activeSheet?.cells[activeAddress] ?? "";

  const activeDisplayValue =
    formulaResults.values[activeAddress] ?? activeRawValue;

  const selectedPositions = useMemo(
    () => getSelectedPositions(selection),
    [selection],
  );

  const selectionStats = useMemo(() => {
    if (!activeSheet) {
      return { sum: 0, average: 0, count: 0 };
    }

    const numbers: number[] = [];

    for (const position of selectedPositions) {
      const address = addressOf(position);
      const value = formulaResults.values[address] ?? "";

      if (value.trim() === "") continue;

      const number = Number(value);

      if (Number.isFinite(number)) {
        numbers.push(number);
      }
    }

    const sum = numbers.reduce((total, value) => total + value, 0);

    return {
      sum,
      average: numbers.length ? sum / numbers.length : 0,
      count: numbers.length,
    };
  }, [activeSheet, selectedPositions, formulaResults]);

  const firstVisibleRow = Math.max(
    1,
    Math.floor(scrollTop / ROW_HEIGHT) + 1,
  );

  const visibleRowCount = Math.ceil(viewportHeight / ROW_HEIGHT) + 5;

  const lastVisibleRow = Math.min(
    INITIAL_ROW_COUNT,
    firstVisibleRow + visibleRowCount,
  );

  const visibleRows = useMemo(() => {
    const rows: number[] = [];

    for (let row = firstVisibleRow; row <= lastVisibleRow; row++) {
      rows.push(row);
    }

    return rows;
  }, [firstVisibleRow, lastVisibleRow]);

  const isSelected = useCallback(
    (row: number, col: number) => {
      const minRow = Math.min(selection.start.row, selection.end.row);
      const maxRow = Math.max(selection.start.row, selection.end.row);
      const minCol = Math.min(selection.start.col, selection.end.col);
      const maxCol = Math.max(selection.start.col, selection.end.col);

      return (
        row >= minRow &&
        row <= maxRow &&
        col >= minCol &&
        col <= maxCol
      );
    },
    [selection],
  );

  const updateURL = useCallback(
    (sheetId: string, address: string) => {
      if (typeof window === "undefined") return;

      const url = new URL(window.location.href);

      url.searchParams.set("sheet", sheetId);
      url.searchParams.set("cell", address);

      window.history.pushState({}, "", url);
    },
    [],
  );

  const recordHistory = useCallback(
    (nextSheets: Sheet[], nextSheetId: string, nextSelection: Selection) => {
      const snapshot: HistoryState = {
        sheets: cloneSheets(nextSheets),
        activeSheetId: nextSheetId,
        selection: {
          start: { ...nextSelection.start },
          end: { ...nextSelection.end },
        },
      };

      setHistory((previous) => {
        const base =
          historyIndex >= 0
            ? previous.slice(0, historyIndex + 1)
            : [];

        const next = [...base, snapshot];

        if (next.length > 100) next.shift();

        setHistoryIndex(next.length - 1);

        return next;
      });
    },
    [historyIndex],
  );

  // Load saved workbook or start with deterministic fixtures.
  useEffect(() => {
    let cancelled = false;

    async function loadWorkbook() {
      try {
        const response = await fetch("/api/sheets", {
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error("Could not load saved workbook.");
        }

        const result = await response.json();

        if (cancelled) return;

        let loadedSheets: Sheet[];

        if (
          result.workbook &&
          Array.isArray(result.workbook.sheets) &&
          result.workbook.sheets.length > 0
        ) {
          loadedSheets = result.workbook.sheets;
        } else {
          loadedSheets = createDefaultFixtures();
        }

        setSheets(loadedSheets);

        const url = new URL(window.location.href);
        const requestedSheet = url.searchParams.get("sheet");
        const requestedCell = url.searchParams.get("cell");

        const initialSheet =
          loadedSheets.find((sheet) => sheet.id === requestedSheet) ??
          loadedSheets[0];

        const initialPosition = requestedCell
          ? parseAddress(requestedCell)
          : null;

        const initialSelection: Selection = {
          start: initialPosition ?? { row: 1, col: 1 },
          end: initialPosition ?? { row: 1, col: 1 },
        };

        setActiveSheetId(initialSheet.id);
        setSelection(initialSelection);

        setHistory([
          {
            sheets: cloneSheets(loadedSheets),
            activeSheetId: initialSheet.id,
            selection: initialSelection,
          },
        ]);

        setHistoryIndex(0);
        initializedRef.current = true;
        setLoaded(true);
      } catch {
        if (cancelled) return;

        setLoadError(
          "Unable to load the workbook from the server. You can reset the fixtures and try again.",
        );

        const fallbackSheets = createDefaultFixtures();

        setSheets(fallbackSheets);
        setActiveSheetId(fallbackSheets[0].id);

        const initialSelection = getInitialSelection();

        setHistory([
          {
            sheets: cloneSheets(fallbackSheets),
            activeSheetId: fallbackSheets[0].id,
            selection: initialSelection,
          },
        ]);

        setHistoryIndex(0);
        initializedRef.current = true;
        setLoaded(true);
      }
    }

    loadWorkbook();

    return () => {
      cancelled = true;
    };
  }, []);

  // Update formula bar when the active cell changes.
  useEffect(() => {
    if (!editingCell) {
      setFormulaDraft(activeRawValue);
    }
  }, [activeRawValue, editingCell]);

  // Track grid viewport size.
  useEffect(() => {
    const element = gridRef.current;

    if (!element) return;

    const updateSize = () => {
      setViewportHeight(element.clientHeight);
    };

    updateSize();

    const observer = new ResizeObserver(updateSize);
    observer.observe(element);

    return () => observer.disconnect();
  }, [loaded]);

  // Save changes with a debounce.
  useEffect(() => {
    if (!loaded || !initializedRef.current || sheets.length === 0) {
      return;
    }

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    setSaveState("saving");
    setSaveMessage("");

    const snapshot = cloneSheets(sheets);
    const sequence = ++saveSequenceRef.current;

    latestSequenceRef.current = sequence;

    saveTimerRef.current = setTimeout(() => {
      void saveWorkbook(snapshot, sequence);
    }, 700);

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, [sheets, loaded]);

  async function saveWorkbook(snapshot: Sheet[], sequence: number) {
    if (isSavingRef.current) {
      queuedSaveRef.current = snapshot;
      return;
    }

    isSavingRef.current = true;

    try {
      const response = await fetch("/api/sheets", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sheets: snapshot }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.message ?? "Save failed.");
      }

      if (sequence === latestSequenceRef.current) {
        setSaveState("saved");
        setSaveMessage("");
      }
    } catch (error) {
      if (sequence === latestSequenceRef.current) {
        setSaveState("failed");
        setSaveMessage(
          error instanceof Error ? error.message : "Save failed.",
        );
      }
    } finally {
      isSavingRef.current = false;

      const queued = queuedSaveRef.current;
      queuedSaveRef.current = null;

      if (queued) {
        const nextSequence = ++saveSequenceRef.current;
        latestSequenceRef.current = nextSequence;

        void saveWorkbook(queued, nextSequence);
      }
    }
  }

  const commitCell = useCallback(
    (address: string, value: string) => {
      if (!activeSheet) return;

      const nextSheets = cloneSheets(sheets);
      const target = nextSheets.find(
        (sheet) => sheet.id === activeSheetId,
      );

      if (!target) return;

      if (value === "") {
        delete target.cells[address];
      } else {
        target.cells[address] = value;
      }

      setSheets(nextSheets);

      recordHistory(nextSheets, activeSheetId, selection);
    },
    [activeSheet, sheets, activeSheetId, selection, recordHistory],
  );

  const finishEditing = useCallback(
    (move?: "up" | "down" | "left" | "right") => {
      if (!editingCell) return;

      const address = editingCell;

      setEditingCell(null);

      if (activeSheet) {
        const current = activeSheet.cells[address] ?? "";

        if (current !== draft) {
          commitCell(address, draft);
        }
      }

      if (move) {
        const next = { ...selection.start };

        if (move === "up") next.row = Math.max(1, next.row - 1);
        if (move === "down") next.row += 1;
        if (move === "left") next.col = Math.max(1, next.col - 1);
        if (move === "right") next.col += 1;

        const nextSelection = {
          start: next,
          end: next,
        };

        setSelection(nextSelection);
        updateURL(activeSheetId, addressOf(next));
      }
    },
    [
      editingCell,
      draft,
      activeSheet,
      commitCell,
      selection,
      activeSheetId,
      updateURL,
    ],
  );

  function startEditing(address: string, initialValue?: string) {
    const value = initialValue ?? activeSheet?.cells[address] ?? "";

    setEditingCell(address);
    setDraft(value);

    requestAnimationFrame(() => {
      editorRef.current?.focus();
      editorRef.current?.select();
    });
  }

  function selectCell(row: number, col: number, extend = false) {
  const position = { row, col };

  const nextSelection = extend
    ? {
        start: selection.start,
        end: position,
      }
    : {
        start: position,
        end: position,
      };

  // Update React state outside any state updater callback.
  setSelection(nextSelection);

  // Update the URL after calculating the selection.
  updateURL(activeSheetId, addressOf(position));
}

  function switchSheet(sheetId: string) {
    if (editingCell) finishEditing();

    setActiveSheetId(sheetId);

    const nextSelection = getInitialSelection();
    setSelection(nextSelection);

    updateURL(sheetId, "A1");

    recordHistory(sheets, sheetId, nextSelection);
  }

  function addSheet() {
    const newSheet = createEmptySheet(
      createId(),
      `Sheet ${sheets.length + 1}`,
    );

    const nextSheets = [...sheets, newSheet];

    setSheets(nextSheets);
    setActiveSheetId(newSheet.id);

    const nextSelection = getInitialSelection();
    setSelection(nextSelection);

    updateURL(newSheet.id, "A1");
    recordHistory(nextSheets, newSheet.id, nextSelection);
  }

  function beginRename(sheet: Sheet) {
    setRenamingSheetId(sheet.id);
    setRenameValue(sheet.name);
  }

  function finishRename() {
    if (!renamingSheetId) return;

    const name = renameValue.trim();

    if (name) {
      const nextSheets = sheets.map((sheet) =>
        sheet.id === renamingSheetId
          ? { ...sheet, name }
          : sheet,
      );

      setSheets(nextSheets);
      recordHistory(nextSheets, activeSheetId, selection);
    }

    setRenamingSheetId(null);
  }

  function deleteActiveSheet() {
    if (sheets.length <= 1) {
      alert("You must keep at least one sheet.");
      return;
    }

    if (!confirm(`Delete "${activeSheet?.name}"?`)) return;

    const nextSheets = sheets.filter(
      (sheet) => sheet.id !== activeSheetId,
    );

    const nextActive = nextSheets[0];

    setSheets(nextSheets);
    setActiveSheetId(nextActive.id);

    const nextSelection = getInitialSelection();
    setSelection(nextSelection);

    updateURL(nextActive.id, "A1");
    recordHistory(nextSheets, nextActive.id, nextSelection);
  }

  function undo() {
    if (historyIndex <= 0) return;

    const previous = history[historyIndex - 1];

    setHistoryIndex(historyIndex - 1);
    setSheets(cloneSheets(previous.sheets));
    setActiveSheetId(previous.activeSheetId);
    setSelection(previous.selection);
    setEditingCell(null);

    updateURL(
      previous.activeSheetId,
      addressOf(previous.selection.start),
    );
  }

  function redo() {
    if (historyIndex >= history.length - 1) return;

    const next = history[historyIndex + 1];

    setHistoryIndex(historyIndex + 1);
    setSheets(cloneSheets(next.sheets));
    setActiveSheetId(next.activeSheetId);
    setSelection(next.selection);
    setEditingCell(null);

    updateURL(next.activeSheetId, addressOf(next.selection.start));
  }

  function applyFormulaBar() {
    if (!activeSheet) return;

    commitCell(activeAddress, formulaDraft);
    formulaRef.current?.blur();
  }

  async function copySelection() {
    if (!activeSheet) return;

    const minRow = Math.min(selection.start.row, selection.end.row);
    const maxRow = Math.max(selection.start.row, selection.end.row);
    const minCol = Math.min(selection.start.col, selection.end.col);
    const maxCol = Math.max(selection.start.col, selection.end.col);

    const lines: string[] = [];

    for (let row = minRow; row <= maxRow; row++) {
      const values: string[] = [];

      for (let col = minCol; col <= maxCol; col++) {
        const address = addressOf({ row, col });
        values.push(activeSheet.cells[address] ?? "");
      }

      lines.push(values.join("\t"));
    }

    try {
      await navigator.clipboard.writeText(lines.join("\n"));
    } catch {
      setSaveMessage("Clipboard permission was not available.");
    }
  }

  function pasteText(text: string) {
    if (!activeSheet) return;

    const rows = text
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split("\n");

    if (rows.length && rows[rows.length - 1] === "") {
      rows.pop();
    }

    const matrix = rows.map((row) => row.split("\t"));

    const totalCells = matrix.reduce(
      (total, row) => total + row.length,
      0,
    );

    if (totalCells > MAX_PASTE_CELLS) {
      setSaveMessage(
        "Paste stopped: the maximum supported paste size is 50,000 cells.",
      );
      return;
    }

    const nextSheets = cloneSheets(sheets);
    const target = nextSheets.find(
      (sheet) => sheet.id === activeSheetId,
    );

    if (!target) return;

    matrix.forEach((row, rowIndex) => {
      row.forEach((value, colIndex) => {
        const address = addressOf({
          row: selection.start.row + rowIndex,
          col: selection.start.col + colIndex,
        });

        if (value === "") {
          delete target.cells[address];
        } else {
          target.cells[address] = value;
        }
      });
    });

    setSheets(nextSheets);

    const end = {
      row: selection.start.row + matrix.length - 1,
      col:
        selection.start.col +
        Math.max(0, ...matrix.map((row) => row.length)) -
        1,
    };

    const nextSelection = {
      start: selection.start,
      end,
    };

    setSelection(nextSelection);
    recordHistory(nextSheets, activeSheetId, nextSelection);
  }

  function handleGridPaste(event: React.ClipboardEvent<HTMLDivElement>) {
    event.preventDefault();

    const text = event.clipboardData.getData("text/plain");

    if (text) pasteText(text);
  }

  function handleGridCopy(event: React.ClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    void copySelection();
  }

  function handleGridKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (editingCell) return;

    const key = event.key;

    if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === "z") {
      event.preventDefault();

      if (event.shiftKey) redo();
      else undo();

      return;
    }

    if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === "y") {
      event.preventDefault();
      redo();
      return;
    }

    if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === "c") {
      event.preventDefault();
      void copySelection();
      return;
    }

    if (key === "Delete" || key === "Backspace") {
      event.preventDefault();

      const nextSheets = cloneSheets(sheets);
      const target = nextSheets.find(
        (sheet) => sheet.id === activeSheetId,
      );

      if (!target) return;

      for (const position of selectedPositions) {
        delete target.cells[addressOf(position)];
      }

      setSheets(nextSheets);
      recordHistory(nextSheets, activeSheetId, selection);
      return;
    }

    const next = { ...selection.start };

    if (key === "ArrowUp") next.row = Math.max(1, next.row - 1);
    else if (key === "ArrowDown") next.row += 1;
    else if (key === "ArrowLeft") next.col = Math.max(1, next.col - 1);
    else if (key === "ArrowRight") next.col += 1;
    else if (key === "Enter") {
      event.preventDefault();
      startEditing(activeAddress);
      return;
    } else if (key === "Tab") {
      next.col += event.shiftKey ? -1 : 1;
      next.col = Math.max(1, next.col);
    } else if (key === "F2") {
      event.preventDefault();
      startEditing(activeAddress);
      return;
    } else if (key === "Escape") {
      setEditingCell(null);
      return;
    } else if (key.length === 1 && !event.ctrlKey && !event.metaKey) {
      startEditing(activeAddress, key);
      return;
    } else {
      return;
    }

    event.preventDefault();

    const nextSelection = {
      start: next,
      end: next,
    };

    setSelection(nextSelection);
    updateURL(activeSheetId, addressOf(next));
  }

  function startColumnResize(
    event: React.MouseEvent<HTMLDivElement>,
    col: number,
  ) {
    event.preventDefault();
    event.stopPropagation();

    resizeRef.current = {
      col,
      startX: event.clientX,
      startWidth: columnWidths[col] ?? DEFAULT_COLUMN_WIDTH,
    };

    function onMouseMove(moveEvent: MouseEvent) {
      if (!resizeRef.current) return;

      const { col, startX, startWidth } = resizeRef.current;
      const width = Math.max(
        60,
        Math.min(400, startWidth + moveEvent.clientX - startX),
      );

      setColumnWidths((previous) => ({
        ...previous,
        [col]: width,
      }));
    }

    function onMouseUp() {
      resizeRef.current = null;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }

  async function resetFixtures() {
    if (
      !confirm(
        "Reset the workbook to the original Budget, Big Sheet and Broken Sheet fixtures? Your current workbook will be replaced.",
      )
    ) {
      return;
    }

    try {
      const response = await fetch("/api/fixtures/reset", {
        method: "POST",
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.message ?? "Reset failed.");
      }

      setSheets(result.sheets);
      setActiveSheetId(result.sheets[0].id);
      setSelection(getInitialSelection());
      setEditingCell(null);

      setSaveState("saved");
      setSaveMessage("");

      recordHistory(
        result.sheets,
        result.sheets[0].id,
        getInitialSelection(),
      );

      updateURL(result.sheets[0].id, "A1");
    } catch (error) {
      setSaveState("failed");
      setSaveMessage(
        error instanceof Error ? error.message : "Reset failed.",
      );
    }
  }

  function retrySave() {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    if (!sheets.length) return;

    const sequence = ++saveSequenceRef.current;
    latestSequenceRef.current = sequence;

    setSaveState("saving");
    setSaveMessage("");

    void saveWorkbook(cloneSheets(sheets), sequence);
  }

  // Browser Back/Forward restores the sheet and active cell from the URL.
  useEffect(() => {
    function handlePopState() {
      const url = new URL(window.location.href);
      const sheetId = url.searchParams.get("sheet");
      const cell = url.searchParams.get("cell");

      if (sheetId && sheets.some((sheet) => sheet.id === sheetId)) {
        setActiveSheetId(sheetId);
      }

      const position = cell ? parseAddress(cell) : null;

      if (position) {
        setSelection({
          start: position,
          end: position,
        });
      }
    }

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [sheets]);

  // Keep the active cell visible after keyboard navigation.
  useEffect(() => {
    const element = gridRef.current;

    if (!element) return;

    const top = (selection.start.row - 1) * ROW_HEIGHT;
    const bottom = top + ROW_HEIGHT;

    const visibleTop = element.scrollTop;
    const visibleBottom = visibleTop + element.clientHeight;

    if (top < visibleTop) {
      element.scrollTop = top;
    } else if (bottom > visibleBottom) {
      element.scrollTop = bottom - element.clientHeight + ROW_HEIGHT;
    }
  }, [selection]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  if (!loaded) {
    return (
      <main className="app">
        <div className="loading-state">Loading Small Sheet...</div>
      </main>
    );
  }

  return (
    <main className="app" data-theme={darkMode ? "dark" : "light"}>
      <header className="toolbar">
        <h1>Small Sheet</h1>

        <div className="toolbar-actions">
          <button onClick={undo} disabled={historyIndex <= 0}>
            Undo
          </button>

          <button
            onClick={redo}
            disabled={historyIndex >= history.length - 1}
          >
            Redo
          </button>

          <button onClick={addSheet}>+ New Sheet</button>

          <button onClick={deleteActiveSheet}>Delete Sheet</button>

          <button onClick={() => setDarkMode((value) => !value)}>
            {darkMode ? "Light mode" : "Dark mode"}
          </button>

          <button onClick={resetFixtures}>Reset fixtures</button>
        </div>
      </header>

      {loadError && (
        <div className="error-message" role="alert">
          {loadError}
        </div>
      )}

      <div className="formula-bar">
        <div className="formula-address">{activeAddress}</div>

        <input
          ref={formulaRef}
          aria-label="Formula bar"
          value={formulaDraft}
          onChange={(event) => setFormulaDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              applyFormulaBar();
            }

            if (event.key === "Escape") {
              setFormulaDraft(activeRawValue);
              formulaRef.current?.blur();
            }
          }}
          onBlur={() => {
            if (formulaDraft !== activeRawValue) {
              applyFormulaBar();
            }
          }}
          placeholder="Enter a value or formula, for example =SUM(A1:A5)"
        />
      </div>

      <div
        className="sheet-container"
        ref={gridRef}
        tabIndex={0}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        onKeyDown={handleGridKeyDown}
        onPaste={handleGridPaste}
        onCopy={handleGridCopy}
        onMouseUp={() => setDraggingSelection(false)}
      >
        {activeSheet ? (
          <table className="sheet-grid">
            <colgroup>
              <col style={{ width: ROW_HEADER_WIDTH }} />

              {Array.from({ length: COLUMN_COUNT }, (_, index) => {
                const col = index + 1;

                return (
                  <col
                    key={col}
                    style={{
                      width:
                        columnWidths[col] ?? DEFAULT_COLUMN_WIDTH,
                    }}
                  />
                );
              })}
            </colgroup>

            <thead>
              <tr>
                <th className="corner-header" />

                {Array.from({ length: COLUMN_COUNT }, (_, index) => {
                  const col = index + 1;

                  return (
                    <th
                      key={col}
                      className={`column-header ${
                        selection.start.col === col ? "selected-header" : ""
                      }`}
                    >
                      {columnName(col)}

                      <div
                        className="column-resize-handle"
                        onMouseDown={(event) =>
                          startColumnResize(event, col)
                        }
                      />
                    </th>
                  );
                })}
              </tr>
            </thead>

            <tbody>
              <tr style={{ height: Math.max(0, firstVisibleRow - 1) * ROW_HEIGHT }}>
                <td
                  colSpan={COLUMN_COUNT + 1}
                  style={{
                    height: Math.max(0, firstVisibleRow - 1) * ROW_HEIGHT,
                    padding: 0,
                    border: 0,
                  }}
                />
              </tr>

              {visibleRows.map((row) => (
                <tr key={row}>
                  <th
                    className={`row-header ${
                      selection.start.row === row ? "selected-header" : ""
                    }`}
                  >
                    {row}
                  </th>

                  {Array.from({ length: COLUMN_COUNT }, (_, index) => {
                    const col = index + 1;
                    const address = addressOf({ row, col });
                    const raw = activeSheet.cells[address] ?? "";
                    const value = formulaResults.values[address] ?? raw;

                    const active = address === activeAddress;
                    const selected = isSelected(row, col);
                    const editing = editingCell === address;
                    const computed = raw.startsWith("=");
                    const broken =
                      typeof value === "string" && value.startsWith("#");

                    return (
                      <td
                        key={address}
                        className={[
                          active ? "active-cell" : "",
                          selected ? "range-selected" : "",
                          editing ? "editing-cell" : "",
                          computed ? "computed-cell" : "",
                          broken ? "broken-cell" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        onMouseDown={(event) => {
                          if (event.button !== 0) return;

                          if (editingCell) finishEditing();

                          setDraggingSelection(true);

                          if (event.shiftKey) {
                            selectCell(row, col, true);
                          } else {
                            selectCell(row, col);
                          }

                          gridRef.current?.focus();
                        }}
                        onMouseEnter={() => {
                          if (draggingSelection) {
                            selectCell(row, col, true);
                          }
                        }}
                        onDoubleClick={() => {
                          startEditing(address);
                        }}
                      >
                        {editing ? (
                          <input
                            ref={editorRef}
                            className="cell-input"
                            value={draft}
                            onChange={(event) =>
                              setDraft(event.target.value)
                            }
                            onBlur={() => finishEditing()}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                finishEditing("down");
                              }

                              if (event.key === "Tab") {
                                event.preventDefault();
                                finishEditing(
                                  event.shiftKey ? "left" : "right",
                                );
                              }

                              if (event.key === "Escape") {
                                event.preventDefault();
                                setEditingCell(null);
                              }
                            }}
                          />
                        ) : (
                          <div className="cell-display">
                            {value}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}

              <tr>
                <td
                  colSpan={COLUMN_COUNT + 1}
                  style={{
                    height:
                      Math.max(
                        0,
                        INITIAL_ROW_COUNT - lastVisibleRow,
                      ) * ROW_HEIGHT,
                    padding: 0,
                    border: 0,
                  }}
                />
              </tr>
            </tbody>
          </table>
        ) : (
          <div className="empty-state">
            <h2>No sheet selected</h2>
            <p>Create a new sheet to start working.</p>
          </div>
        )}
      </div>

      <footer className="sheet-footer">
        <div className="sheet-tabs">
          {sheets.map((sheet) => (
            <div key={sheet.id}>
              {renamingSheetId === sheet.id ? (
                <input
                  className="rename-tab"
                  autoFocus
                  value={renameValue}
                  onChange={(event) =>
                    setRenameValue(event.target.value)
                  }
                  onBlur={finishRename}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") finishRename();

                    if (event.key === "Escape") {
                      setRenamingSheetId(null);
                    }
                  }}
                />
              ) : (
                <button
                  className={
                    sheet.id === activeSheetId ? "active-tab" : ""
                  }
                  onClick={() => switchSheet(sheet.id)}
                  onDoubleClick={() => beginRename(sheet)}
                  title="Double-click to rename"
                >
                  {sheet.name}
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="selection-summary">
          <span>{selectedAddress}</span>
          <span>Double-click a tab to rename</span>
        </div>
      </footer>

      <div className="status-bar">
        <div className="status-left">
          <span>Sum: {selectionStats.sum.toLocaleString()}</span>
          <span>
            Average: {selectionStats.average.toLocaleString()}
          </span>
          <span>Count: {selectionStats.count}</span>
        </div>

        <div className="status-right">
          <span className={`save-status ${saveState}`}>
            {saveState === "saved" && "● Saved"}
            {saveState === "saving" && "● Saving..."}
            {saveState === "failed" && "● Save failed"}
          </span>

          {saveState === "failed" && (
            <button onClick={retrySave}>Retry save</button>
          )}

          {saveMessage && <span>{saveMessage}</span>}
        </div>
      </div>
    </main>
  );
}