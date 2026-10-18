/**
 * calculator.js
 * ---------------------------------------------------------------------------
 * Browser controller for the Glass Calculator.
 *
 * Responsibilities:
 *   - Translate pointer/button presses and keyboard input into calculator
 *     actions.
 *   - Render the live expression, result preview, and history tape.
 *
 * All arithmetic lives in `calculator-core.mjs`; this file is deliberately
 * free of calculation logic so that the engine stays testable in Node.
 */

import {
  calculate,
  formatNumber,
  createHistory,
  createHistoryEntry,
  pushHistory,
  clearHistory,
  formatHistoryEntry,
} from "./calculator-core.mjs";

/* ------------------------------------------------------------------------- */
/* DOM references                                                            */
/* ------------------------------------------------------------------------- */

const expressionEl = document.getElementById("expression");
const resultEl = document.getElementById("result");
const errorEl = document.getElementById("error");
const keypad = document.getElementById("keypad");
const historyList = document.getElementById("history-list");
const historyEmpty = document.getElementById("history-empty");

/* ------------------------------------------------------------------------- */
/* State                                                                     */
/* ------------------------------------------------------------------------- */

const OPERATORS = "+-*/^%";

const state = {
  expression: "",
  history: createHistory(),
  justEvaluated: false,
  lastResult: 0,
};

/* ------------------------------------------------------------------------- */
/* Rendering                                                                 */
/* ------------------------------------------------------------------------- */

function clearError() {
  errorEl.hidden = true;
  errorEl.textContent = "";
  resultEl.classList.remove("is-error");
}

function showError(message) {
  errorEl.hidden = false;
  errorEl.textContent = message;
  resultEl.textContent = "Error";
  resultEl.classList.add("is-error");
}

function render() {
  expressionEl.textContent = state.expression === "" ? "0" : state.expression;
  expressionEl.scrollLeft = expressionEl.scrollWidth;

  if (state.justEvaluated) {
    resultEl.classList.remove("is-error");
    resultEl.textContent = formatNumber(state.lastResult);
    resultEl.scrollLeft = resultEl.scrollWidth;
    return;
  }

  const expr = state.expression.trim();
  resultEl.classList.remove("is-error");

  if (expr === "") {
    resultEl.textContent = "0";
    return;
  }

  try {
    resultEl.textContent = formatNumber(calculate(expr));
  } catch {
    // While the user is mid-expression the formula may be temporarily
    // invalid; keep showing the last stable value instead of flashing an error.
    resultEl.textContent = formatNumber(state.lastResult);
  }
  resultEl.scrollLeft = resultEl.scrollWidth;
}

function renderHistory() {
  historyList.replaceChildren();

  if (state.history.length === 0) {
    historyEmpty.hidden = false;
    return;
  }
  historyEmpty.hidden = true;

  const fragment = document.createDocumentFragment();

  state.history.forEach((entry) => {
    const item = document.createElement("li");

    const button = document.createElement("button");
    button.type = "button";
    button.className = "history__item";
    button.dataset.expression = entry.expression;
    button.setAttribute("aria-label", `Reuse calculation ${formatHistoryEntry(entry)}`);

    const expression = document.createElement("span");
    expression.className = "history__item-expression";
    expression.textContent = entry.expression;

    const result = document.createElement("span");
    result.className = "history__item-result";
    result.textContent = entry.formatted;

    button.append(expression, result);
    item.append(button);
    fragment.append(item);
  });

  historyList.append(fragment);
}

/* ------------------------------------------------------------------------- */
/* Actions                                                                   */
/* ------------------------------------------------------------------------- */

const isOperator = (value) => value.length === 1 && OPERATORS.includes(value);

function appendValue(value) {
  clearError();

  // After evaluating, a digit/decimal/function starts a fresh expression while
  // an operator continues from the previous result.
  if (state.justEvaluated) {
    if (isOperator(value)) {
      state.expression = formatNumber(state.lastResult);
    } else {
      state.expression = "";
    }
    state.justEvaluated = false;
  }

  let expr = state.expression;
  const last = expr.slice(-1);

  if (isOperator(value)) {
    if (expr === "") {
      if (value !== "-") return; // only a leading unary minus is valid
      state.expression = value;
      render();
      return;
    }
    if (last === "(") {
      if (value === "-") {
        state.expression = expr + value;
        render();
      }
      return;
    }
    if (isOperator(last)) {
      // Replace the trailing operator, but allow "2 * -3" style negatives.
      state.expression = value === "-" && last !== "-" ? expr + value : expr.slice(0, -1) + value;
      render();
      return;
    }
  }

  if (value === ".") {
    const tail = expr.split(/[+\-*/^%()]/).pop() ?? "";
    if (tail.includes(".")) return; // one decimal point per number
    if (tail === "" && expr !== "" && !isOperator(last) && last !== "(") return;
  }

  if (value === ")") {
    const opens = (expr.match(/\(/g) || []).length;
    const closes = (expr.match(/\)/g) || []).length;
    if (opens <= closes) return; // nothing to close
    if (last === "(" || isOperator(last)) return;
  }

  // Implicit multiplication: 2( ... ) / 2sqrt( ... )
  const isParenStart = value === "(" || (value.length > 1 && value.endsWith("("));
  if (isParenStart && (/[0-9.)]$/.test(expr))) {
    state.expression += "*";
  }

  state.expression += value;
  render();
}

function backspace() {
  clearError();
  state.justEvaluated = false;
  state.expression = state.expression.slice(0, -1);
  render();
}

function clearAll() {
  state.expression = "";
  state.justEvaluated = false;
  state.lastResult = 0;
  clearError();
  render();
}

function evaluate() {
  const expr = state.expression.trim();
  if (expr === "") return;

  try {
    const result = calculate(expr);
    state.lastResult = result;
    state.history = pushHistory(state.history, createHistoryEntry(expr, result));
    state.expression = formatNumber(result);
    state.justEvaluated = true;
    clearError();
    render();
    renderHistory();
  } catch (err) {
    showError(err && err.message ? err.message : "Invalid expression");
  }
}

function clearHistoryTape() {
  state.history = clearHistory();
  renderHistory();
}

function reuseExpression(expression) {
  clearError();
  state.expression = expression;
  state.justEvaluated = false;
  render();
}

/* ------------------------------------------------------------------------- */
/* Keyboard feedback                                                         */
/* ------------------------------------------------------------------------- */

function flash(element) {
  if (!element) return;
  element.classList.add("is-pressed");
  window.setTimeout(() => element.classList.remove("is-pressed"), 110);
}

function keyForValue(value) {
  return keypad.querySelector(`.key[data-value="${value}"]`);
}

function keyForAction(action) {
  return keypad.querySelector(`.key[data-action="${action}"]`);
}

/* ------------------------------------------------------------------------- */
/* Event wiring                                                              */
/* ------------------------------------------------------------------------- */

keypad.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;

  if (button.dataset.action) {
    switch (button.dataset.action) {
      case "clear":
        clearAll();
        break;
      case "backspace":
        backspace();
        break;
      case "equals":
        evaluate();
        break;
      default:
        break;
    }
    return;
  }

  if (button.dataset.value !== undefined) {
    appendValue(button.dataset.value);
  }
});

historyList.addEventListener("click", (event) => {
  const button = event.target.closest(".history__item");
  if (!button) return;
  reuseExpression(button.dataset.expression ?? "");
});

document.querySelector('[data-action="clear-history"]').addEventListener("click", clearHistoryTape);

window.addEventListener("keydown", (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey) return;

  const key = event.key;

  if (/^[0-9]$/.test(key)) {
    appendValue(key);
    flash(keyForValue(key));
    event.preventDefault();
    return;
  }

  if (key === "." || key === ",") {
    appendValue(".");
    flash(keyForValue("."));
    event.preventDefault();
    return;
  }

  if (key === "+" || key === "-" || key === "*" || key === "/" || key === "^" || key === "%") {
    appendValue(key);
    flash(keyForValue(key));
    event.preventDefault();
    return;
  }

  if (key === "(" || key === ")") {
    appendValue(key);
    flash(keyForValue(key));
    event.preventDefault();
    return;
  }

  if (key === "Enter" || key === "=") {
    evaluate();
    flash(keyForAction("equals"));
    event.preventDefault();
    return;
  }

  if (key === "Backspace") {
    backspace();
    flash(keyForAction("backspace"));
    event.preventDefault();
    return;
  }

  if (key === "Escape") {
    clearAll();
    flash(keyForAction("clear"));
    event.preventDefault();
  }
});

/* ------------------------------------------------------------------------- */
/* Boot                                                                      */
/* ------------------------------------------------------------------------- */

render();
renderHistory();
