/**
 * calculator-core.mjs
 * ---------------------------------------------------------------------------
 * Pure, dependency-free calculation engine for the Glass Calculator.
 *
 * This module contains NO DOM references and no browser-only APIs, so it can
 * be imported both by the browser UI (`calculator.js`) and by the Node test
 * suite (`test.mjs`).
 *
 * Public API
 *   calculate(expression)            -> number  (throws on invalid input)
 *   formatNumber(num)                -> string  (display-safe formatting)
 *   scientificOp(op, value[, exp])   -> number  (unary/binary sci functions)
 *   history tape helpers: createHistory, createHistoryEntry, pushHistory,
 *                         clearHistory, formatHistoryEntry, MAX_HISTORY
 *
 * The expression evaluator is a small hand-written recursive-descent parser.
 * It is intentionally NOT `eval`/`Function` based: no user input is ever
 * executed as code.
 */

/* ------------------------------------------------------------------------- */
/* Float hygiene                                                             */
/* ------------------------------------------------------------------------- */

const PRECISION = 12;

/**
 * Round a float to a sane number of significant digits so that binary
 * floating point artifacts (e.g. 0.1 + 0.2 = 0.30000000000000004) do not
 * leak into results. Non-finite values pass through untouched so callers can
 * detect errors (Infinity/NaN).
 */
function cleanFloat(value) {
  if (!Number.isFinite(value)) return value;
  const rounded = Number(value.toPrecision(PRECISION));
  return Object.is(rounded, -0) ? 0 : rounded;
}

/* ------------------------------------------------------------------------- */
/* Constants and functions                                                   */
/* ------------------------------------------------------------------------- */

const CONSTANTS = Object.freeze({
  pi: Math.PI,
  tau: Math.PI * 2,
  e: Math.E,
});

const FUNCTIONS = Object.freeze({
  sqrt: (x) => {
    if (x < 0) throw new Error("Square root of a negative number");
    return Math.sqrt(x);
  },
  cbrt: Math.cbrt,
  abs: Math.abs,
  exp: Math.exp,
  ln: Math.log,
  log: Math.log10,
  log2: Math.log2,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  sign: Math.sign,
  pow: (a, b) => Math.pow(a, b),
  min: Math.min,
  max: Math.max,
});

/* ------------------------------------------------------------------------- */
/* Tokenizer                                                                 */
/* ------------------------------------------------------------------------- */

function normalize(input) {
  return String(input)
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .replace(/−/g, "-")
    .replace(/√/g, "sqrt")
    .replace(/π/g, "pi")
    .replace(/\s+/g, "");
}

function tokenize(rawInput) {
  const input = normalize(rawInput);
  const tokens = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    // Number literal (supports decimals and scientific notation: 1.5e-3)
    if (ch >= "0" && ch <= "9") {
      const start = i;
      let seenDot = false;
      while (i < input.length && ((input[i] >= "0" && input[i] <= "9") || input[i] === ".")) {
        if (input[i] === ".") {
          if (seenDot) throw new Error(`Invalid number literal in "${rawInput}"`);
          seenDot = true;
        }
        i += 1;
      }
      if (input[i] === "e" || input[i] === "E") {
        const save = i;
        i += 1;
        if (input[i] === "+" || input[i] === "-") i += 1;
        if (i < input.length && input[i] >= "0" && input[i] <= "9") {
          while (i < input.length && input[i] >= "0" && input[i] <= "9") i += 1;
        } else {
          i = save; // not an exponent, leave the 'e' for the identifier reader
        }
      }
      const literal = input.slice(start, i);
      const value = Number(literal);
      if (!Number.isFinite(value)) throw new Error(`Invalid number literal "${literal}"`);
      tokens.push({ type: "number", value });
      continue;
    }

    // Leading-dot decimals such as ".5"
    if (ch === ".") {
      const start = i;
      i += 1;
      while (i < input.length && input[i] >= "0" && input[i] <= "9") i += 1;
      const literal = input.slice(start, i);
      const value = Number(literal);
      if (!Number.isFinite(value)) throw new Error(`Invalid number literal "${literal}"`);
      tokens.push({ type: "number", value });
      continue;
    }

    // Identifier / function / constant
    if (/[A-Za-z_]/.test(ch)) {
      const start = i;
      while (i < input.length && /[A-Za-z0-9_]/.test(input[i])) i += 1;
      tokens.push({ type: "identifier", value: input.slice(start, i).toLowerCase() });
      continue;
    }

    if ("+-*/^%(),".includes(ch)) {
      tokens.push({ type: "operator", value: ch });
      i += 1;
      continue;
    }

    throw new Error(`Unexpected character "${ch}" in expression`);
  }

  return tokens;
}

/* ------------------------------------------------------------------------- */
/* Parser (recursive descent)                                                */
/* ------------------------------------------------------------------------- */

function evaluateTokens(tokens) {
  let pos = 0;

  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function expect(value) {
    const token = peek();
    if (!token || token.value !== value) {
      throw new Error(`Expected "${value}" in expression`);
    }
    return next();
  }

  // expression := term (("+" | "-") term)*
  function parseExpression() {
    let value = parseTerm();
    while (peek() && peek().type === "operator" && (peek().value === "+" || peek().value === "-")) {
      const op = next().value;
      const rhs = parseTerm();
      value = cleanFloat(op === "+" ? value + rhs : value - rhs);
    }
    return value;
  }

  // term := unary (("*" | "/" | "%") unary)*
  function parseTerm() {
    let value = parseUnary();
    while (
      peek() &&
      peek().type === "operator" &&
      (peek().value === "*" || peek().value === "/" || peek().value === "%")
    ) {
      const op = next().value;
      const rhs = parseUnary();
      if ((op === "/" || op === "%") && rhs === 0) {
        throw new Error("Division by zero");
      }
      if (op === "*") value = cleanFloat(value * rhs);
      else if (op === "/") value = cleanFloat(value / rhs);
      else value = cleanFloat(value % rhs);
    }
    return value;
  }

  // unary := ("+" | "-") unary | power
  function parseUnary() {
    const token = peek();
    if (token && token.type === "operator" && (token.value === "+" || token.value === "-")) {
      next();
      const value = parseUnary();
      return token.value === "-" ? cleanFloat(-value) : value;
    }
    return parsePower();
  }

  // power := primary ("^" unary)?   (right associative, exponent may be unary)
  function parsePower() {
    const base = parsePrimary();
    if (peek() && peek().type === "operator" && peek().value === "^") {
      next();
      const exponent = parseUnary();
      const result = Math.pow(base, exponent);
      if (!Number.isFinite(result)) {
        throw new Error("Result is not a finite number");
      }
      return cleanFloat(result);
    }
    return base;
  }

  // primary := number | constant | function call | "(" expression ")"
  function parsePrimary() {
    const token = peek();
    if (!token) throw new Error("Unexpected end of expression");

    if (token.type === "number") {
      next();
      return token.value;
    }

    if (token.type === "operator" && token.value === "(") {
      next();
      const value = parseExpression();
      expect(")");
      return value;
    }

    if (token.type === "identifier") {
      next();
      const name = token.value;

      if (FUNCTIONS[name]) {
        expect("(");
        const args = [];
        if (!(peek() && peek().type === "operator" && peek().value === ")")) {
          args.push(parseExpression());
          while (peek() && peek().type === "operator" && peek().value === ",") {
            next();
            args.push(parseExpression());
          }
        }
        expect(")");
        const result = FUNCTIONS[name](...args);
        if (!Number.isFinite(result)) {
          throw new Error(`Function "${name}" did not produce a finite result`);
        }
        return cleanFloat(result);
      }

      if (Object.prototype.hasOwnProperty.call(CONSTANTS, name)) {
        return CONSTANTS[name];
      }

      throw new Error(`Unknown identifier "${name}"`);
    }

    throw new Error(`Unexpected token "${token.value}"`);
  }

  const result = parseExpression();
  if (pos < tokens.length) {
    throw new Error(`Unexpected token "${tokens[pos].value}" in expression`);
  }
  return result;
}

/* ------------------------------------------------------------------------- */
/* Public: calculate                                                         */
/* ------------------------------------------------------------------------- */

/**
 * Evaluate an arithmetic expression string.
 *
 * Supports: + - * / % ^, parentheses, unary signs, numeric literals
 * (including scientific notation and `.5`), constants `pi`/`e`/`tau`, and
 * the functions listed in FUNCTIONS (sqrt, sin, cos, tan, log, pow, ...).
 *
 * @param {string|number} expression
 * @returns {number}
 * @throws {Error} on malformed input, division/modulo by zero, or non-finite results
 */
export function calculate(expression) {
  if (typeof expression === "number") {
    if (!Number.isFinite(expression)) throw new Error("Expression is not a finite number");
    return cleanFloat(expression);
  }

  if (typeof expression !== "string") {
    throw new Error("Expression must be a string or number");
  }

  const trimmed = expression.trim();
  if (trimmed === "") throw new Error("Expression is empty");

  const tokens = tokenize(trimmed);
  if (tokens.length === 0) throw new Error("Expression is empty");

  const result = evaluateTokens(tokens);
  if (!Number.isFinite(result)) {
    throw new Error("Result is not a finite number");
  }
  return cleanFloat(result);
}

/* ------------------------------------------------------------------------- */
/* Public: formatNumber                                                      */
/* ------------------------------------------------------------------------- */

/**
 * Format a number for display.
 * - Non-finite values become "NaN", "∞" or "-∞".
 * - Very large / very small magnitudes use exponential notation.
 * - Otherwise rounds to 12 significant digits and trims trailing zeros.
 *
 * @param {number|string} num
 * @returns {string}
 */
export function formatNumber(num) {
  const value = typeof num === "string" ? Number(num) : num;

  if (typeof value !== "number" || Number.isNaN(value)) return "NaN";
  if (value === Infinity) return "∞";
  if (value === -Infinity) return "-∞";
  if (Object.is(value, -0)) return "0";
  if (value === 0) return "0";

  const abs = Math.abs(value);
  if (abs >= 1e15 || abs < 1e-9) {
    return value.toExponential(9).replace(/\.?0+e/, "e");
  }

  const cleaned = Number(value.toPrecision(PRECISION));
  return String(cleaned);
}

/* ------------------------------------------------------------------------- */
/* Public: scientificOp                                                      */
/* ------------------------------------------------------------------------- */

const SCIENTIFIC_OPS = Object.freeze({
  sqrt: (x) => FUNCTIONS.sqrt(x),
  cbrt: (x) => Math.cbrt(x),
  abs: (x) => Math.abs(x),
  sin: (x) => Math.sin(x),
  cos: (x) => Math.cos(x),
  tan: (x) => Math.tan(x),
  asin: (x) => Math.asin(x),
  acos: (x) => Math.acos(x),
  atan: (x) => Math.atan(x),
  log: (x) => Math.log10(x),
  ln: (x) => Math.log(x),
  exp: (x) => Math.exp(x),
  pow: (x, exponent) => Math.pow(x, exponent),
  round: (x) => Math.round(x),
});

/**
 * Apply a named scientific operation to a value.
 *
 * @param {string} op            one of: sqrt, cbrt, abs, sin, cos, tan, asin,
 *                               acos, atan, log, ln, exp, pow, round
 * @param {number} value         operand
 * @param {number} [exponent]    second operand, required for `pow`
 * @returns {number}
 * @throws {Error} on unknown op, invalid operand, or non-finite result
 */
export function scientificOp(op, value, exponent) {
  const key = String(op ?? "").trim().toLowerCase();
  const fn = SCIENTIFIC_OPS[key];
  if (!fn) throw new Error(`Unknown scientific operation "${op}"`);

  const operand = typeof value === "string" ? Number(value) : value;
  if (typeof operand !== "number" || !Number.isFinite(operand)) {
    throw new Error(`Invalid value for scientific operation "${key}"`);
  }

  const result =
    key === "pow"
      ? fn(operand, typeof exponent === "string" ? Number(exponent) : exponent)
      : fn(operand);

  if (!Number.isFinite(result)) {
    throw new Error(`Scientific operation "${key}" did not produce a finite result`);
  }
  return cleanFloat(result);
}

/* ------------------------------------------------------------------------- */
/* Public: history tape helpers                                              */
/* ------------------------------------------------------------------------- */

export const MAX_HISTORY = 50;

/** @returns {Array} a fresh, empty history tape */
export function createHistory() {
  return [];
}

/**
 * Build a history entry.
 * @param {string} expression raw expression the user evaluated
 * @param {number} result     numeric result
 * @param {number} [timestamp] epoch ms (defaults to Date.now())
 */
export function createHistoryEntry(expression, result, timestamp = Date.now()) {
  const numericResult = typeof result === "string" ? Number(result) : result;
  if (typeof numericResult !== "number" || Number.isNaN(numericResult)) {
    throw new Error("History entry result must be a number");
  }
  return {
    expression: String(expression).trim(),
    result: numericResult,
    formatted: formatNumber(numericResult),
    timestamp,
  };
}

/**
 * Immutably prepend an entry to the tape and cap its length (newest first).
 * @param {Array} history
 * @param {object} entry
 * @param {number} [max]
 * @returns {Array}
 */
export function pushHistory(history, entry, max = MAX_HISTORY) {
  const base = Array.isArray(history) ? history : [];
  const next = [entry, ...base];
  return next.length > max ? next.slice(0, max) : next;
}

/** @returns {Array} an empty tape (kept as a helper for symmetry/testability) */
export function clearHistory() {
  return [];
}

/**
 * Human-readable rendering of an entry, e.g. "2 + 3 = 5".
 * @param {object} entry
 * @returns {string}
 */
export function formatHistoryEntry(entry) {
  if (!entry || typeof entry !== "object") return "";
  return `${entry.expression} = ${formatNumber(entry.result)}`;
}

export default {
  calculate,
  formatNumber,
  scientificOp,
  createHistory,
  createHistoryEntry,
  pushHistory,
  clearHistory,
  formatHistoryEntry,
  MAX_HISTORY,
};
