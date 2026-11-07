export type CellMap = Record<string, string>;

export type FormulaResult = {
  values: Record<string, string>;
  dependencies: Record<string, string[]>;
  dependents: Record<string, string[]>;
};

type FormulaError =
  | "#REF!"
  | "#CIRCULAR!"
  | "#DIV/0!"
  | "#VALUE!"
  | "#ERROR!";

type RangeValue = {
  kind: "range";
  cells: string[];
};

type Value = number | string | RangeValue;

const ERROR_VALUES: FormulaError[] = [
  "#REF!",
  "#CIRCULAR!",
  "#DIV/0!",
  "#VALUE!",
  "#ERROR!",
];

function isError(value: Value): value is FormulaError {
  return (
    typeof value === "string" &&
    ERROR_VALUES.includes(value as FormulaError)
  );
}

function columnNumber(column: string): number {
  let result = 0;

  for (const character of column.toUpperCase()) {
    result = result * 26 + character.charCodeAt(0) - 64;
  }

  return result;
}

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

function parseAddress(address: string): {
  column: number;
  row: number;
} | null {
  const match = address.toUpperCase().match(/^([A-Z]+)([1-9]\d*)$/);

  if (!match) return null;

  return {
    column: columnNumber(match[1]),
    row: Number(match[2]),
  };
}

function expandRange(start: string, end: string): string[] {
  const first = parseAddress(start);
  const last = parseAddress(end);

  if (!first || !last) {
    throw new Error("#REF!");
  }

  const minColumn = Math.min(first.column, last.column);
  const maxColumn = Math.max(first.column, last.column);
  const minRow = Math.min(first.row, last.row);
  const maxRow = Math.max(first.row, last.row);

  const result: string[] = [];

  for (let row = minRow; row <= maxRow; row++) {
    for (let column = minColumn; column <= maxColumn; column++) {
      result.push(`${columnName(column)}${row}`);
    }
  }

  if (result.length > 50000) {
    throw new Error("#ERROR!");
  }

  return result;
}

function tokenize(expression: string): string[] {
  const tokens: string[] = [];
  let position = 0;

  while (position < expression.length) {
    const remaining = expression.slice(position);

    if (/^\s+/.test(remaining)) {
      position += remaining.match(/^\s+/)![0].length;
      continue;
    }

    const match = remaining.match(
      /^(?:\d+(?:\.\d*)?|\.\d+|[A-Za-z]+\$?[1-9]\d*|[A-Za-z]+|[()+\-*/^,:])/,
    );

    if (!match) {
      throw new Error("#ERROR!");
    }

    tokens.push(match[0]);
    position += match[0].length;
  }

  return tokens;
}

class Parser {
  private position = 0;

  constructor(
    private readonly tokens: string[],
    private readonly getCell: (address: string) => Value,
  ) {}

  private peek(): string | undefined {
    return this.tokens[this.position];
  }

  private consume(): string {
    const token = this.peek();

    if (token === undefined) {
      throw new Error("#ERROR!");
    }

    this.position++;
    return token;
  }

  parse(): Value {
    const result = this.parseExpression();

    if (this.peek() !== undefined) {
      throw new Error("#ERROR!");
    }

    return result;
  }

  private parseExpression(): Value {
    let left = this.parseTerm();

    while (this.peek() === "+" || this.peek() === "-") {
      const operator = this.consume();
      const right = this.parseTerm();

      left = this.calculate(operator, left, right);
    }

    return left;
  }

  private parseTerm(): Value {
    let left = this.parsePower();

    while (this.peek() === "*" || this.peek() === "/") {
      const operator = this.consume();
      const right = this.parsePower();

      left = this.calculate(operator, left, right);
    }

    return left;
  }

  private parsePower(): Value {
    let left = this.parseUnary();

    if (this.peek() === "^") {
      this.consume();
      const right = this.parsePower();
      left = this.calculate("^", left, right);
    }

    return left;
  }

  private parseUnary(): Value {
    if (this.peek() === "+") {
      this.consume();
      return this.toNumber(this.parseUnary());
    }

    if (this.peek() === "-") {
      this.consume();
      const value = this.toNumber(this.parseUnary());

      return typeof value === "string" ? value : -value;
    }

    return this.parsePrimary();
  }

  private parsePrimary(): Value {
    const token = this.consume();

    if (token === "(") {
      const result = this.parseExpression();

      if (this.consume() !== ")") {
        throw new Error("#ERROR!");
      }

      return result;
    }

    if (/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(token)) {
      return Number(token);
    }

    if (/^[A-Za-z]+[1-9]\d*$/.test(token)) {
      const address = token.toUpperCase();

      if (this.peek() === ":") {
        this.consume();

        const end = this.consume();

        if (!/^[A-Za-z]+[1-9]\d*$/.test(end)) {
          throw new Error("#REF!");
        }

        return {
          kind: "range",
          cells: expandRange(address, end.toUpperCase()),
        };
      }

      return this.getCell(address);
    }

    if (/^[A-Za-z]+$/.test(token)) {
      const functionName = token.toUpperCase();

      if (this.consume() !== "(") {
        throw new Error("#ERROR!");
      }

      const argumentsList: Value[] = [];

      if (this.peek() !== ")") {
        while (true) {
          argumentsList.push(this.parseExpression());

          if (this.peek() !== ",") break;

          this.consume();
        }
      }

      if (this.consume() !== ")") {
        throw new Error("#ERROR!");
      }

      return this.runFunction(functionName, argumentsList);
    }

    throw new Error("#ERROR!");
  }

  private toNumber(value: Value): number | FormulaError {
    if (isError(value)) return value;

    if (typeof value === "object") {
      return "#VALUE!";
    }

    if (typeof value === "number") return value;

    if (value.trim() === "") return 0;

    const number = Number(value);

    return Number.isFinite(number) ? number : "#VALUE!";
  }

  private calculate(
    operator: string,
    left: Value,
    right: Value,
  ): Value {
    const a = this.toNumber(left);
    const b = this.toNumber(right);

    if (typeof a === "string") return a;
    if (typeof b === "string") return b;

    switch (operator) {
      case "+":
        return a + b;
      case "-":
        return a - b;
      case "*":
        return a * b;
      case "/":
        return b === 0 ? "#DIV/0!" : a / b;
      case "^":
        return a ** b;
      default:
        return "#ERROR!";
    }
  }

  private runFunction(
    name: string,
    argumentsList: Value[],
  ): Value {
    const values: number[] = [];

    for (const argument of argumentsList) {
      const items =
        typeof argument === "object" && "kind" in argument
          ? argument.cells.map((address) => this.getCell(address))
          : [argument];

      for (const item of items) {
        if (isError(item)) return item;

        if (typeof item === "number") {
          values.push(item);
        } else if (typeof item === "string" && item.trim() !== "") {
          const number = Number(item);

          if (Number.isFinite(number)) {
            values.push(number);
          } else {
            return "#VALUE!";
          }
        }
      }
    }

    switch (name) {
      case "SUM":
        return values.reduce((sum, value) => sum + value, 0);

      case "AVERAGE":
        return values.length
          ? values.reduce((sum, value) => sum + value, 0) / values.length
          : 0;

      case "COUNT":
        return values.length;

      case "MIN":
        return values.length ? Math.min(...values) : 0;

      case "MAX":
        return values.length ? Math.max(...values) : 0;

      default:
        return "#ERROR!";
    }
  }
}

export function evaluateWorkbook(cells: CellMap): FormulaResult {
  const values: Record<string, string> = {};
  const dependencies: Record<string, string[]> = {};
  const dependents: Record<string, string[]> = {};

  const cache = new Map<string, Value>();
  const visiting = new Set<string>();

  function evaluateCell(address: string): Value {
    const normalized = address.toUpperCase();

    if (cache.has(normalized)) {
      return cache.get(normalized)!;
    }

    if (visiting.has(normalized)) {
      return "#CIRCULAR!";
    }

    if (!parseAddress(normalized)) {
      return "#REF!";
    }

    const raw = cells[normalized] ?? "";

    if (!raw.startsWith("=")) {
      cache.set(normalized, raw);
      return raw;
    }

    visiting.add(normalized);

    const usedCells = new Set<string>();

    function getCell(reference: string): Value {
      const normalizedReference = reference.toUpperCase();

      usedCells.add(normalizedReference);

      return evaluateCell(normalizedReference);
    }

    let result: Value;

    try {
      const expression = raw.slice(1);

      if (!expression.trim()) {
        result = "#ERROR!";
      } else {
        const tokens = tokenize(expression);
        result = new Parser(tokens, getCell).parse();
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "#ERROR!";

      result = ERROR_VALUES.includes(message as FormulaError)
        ? (message as FormulaError)
        : "#ERROR!";
    }

    visiting.delete(normalized);

    dependencies[normalized] = [...usedCells];

    for (const dependency of usedCells) {
      if (!dependents[dependency]) {
        dependents[dependency] = [];
      }

      if (!dependents[dependency].includes(normalized)) {
        dependents[dependency].push(normalized);
      }
    }

    cache.set(normalized, result);

    return result;
  }

  const addresses = new Set([
    ...Object.keys(cells).map((key) => key.toUpperCase()),
  ]);

  for (const address of addresses) {
    const result = evaluateCell(address);

    values[address] =
      typeof result === "object"
        ? "#VALUE!"
        : typeof result === "number"
          ? Number.isFinite(result)
            ? String(Number(result.toFixed(8)))
            : "#ERROR!"
          : result;
  }

  return {
    values,
    dependencies,
    dependents,
  };
}

export function getAffectedCells(
  changedAddress: string,
  dependents: Record<string, string[]>,
): string[] {
  const affected = new Set<string>();
  const queue = [changedAddress.toUpperCase()];

  while (queue.length) {
    const current = queue.shift()!;

    for (const dependent of dependents[current] ?? []) {
      if (!affected.has(dependent)) {
        affected.add(dependent);
        queue.push(dependent);
      }
    }
  }

  return [...affected];
}