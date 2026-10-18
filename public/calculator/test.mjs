/**
 * test.mjs — Node built-in test runner suite for calculator-core.mjs
 *
 * Run with:
 *   node --test public/calculator/test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  calculate,
  formatNumber,
  scientificOp,
  createHistory,
  createHistoryEntry,
  pushHistory,
  clearHistory,
  formatHistoryEntry,
  MAX_HISTORY,
} from "./calculator-core.mjs";

/** Floating point tolerant equality. */
function approx(actual, expected, tolerance = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

/* ------------------------------------------------------------------------- */
/* Basic arithmetic                                                          */
/* ------------------------------------------------------------------------- */

test("basic arithmetic: addition", () => {
  assert.equal(calculate("2+3"), 5);
  assert.equal(calculate("10 + 32"), 42);
  assert.equal(calculate("0.1+0.2"), 0.3); // float hygiene
});

test("basic arithmetic: subtraction", () => {
  assert.equal(calculate("9-4"), 5);
  assert.equal(calculate("4-9"), -5);
  assert.equal(calculate("0-0"), 0);
});

test("basic arithmetic: multiplication", () => {
  assert.equal(calculate("6*7"), 42);
  assert.equal(calculate("2.5*4"), 10);
  assert.equal(calculate("-3*3"), -9);
});

test("basic arithmetic: division", () => {
  assert.equal(calculate("20/4"), 5);
  assert.equal(calculate("7/2"), 3.5);
  approx(calculate("1/3"), 1 / 3);
});

test("basic arithmetic: decimals and leading dot", () => {
  assert.equal(calculate(".5+.5"), 1);
  assert.equal(calculate("1.25*4"), 5);
  assert.equal(calculate("2e3+1"), 2001); // scientific notation literal
});

test("basic arithmetic: unary signs and parentheses", () => {
  assert.equal(calculate("-5+2"), -3);
  assert.equal(calculate("-(4+6)"), -10);
  assert.equal(calculate("(+5)"), 5);
  assert.equal(calculate("2*-3"), -6);
});

/* ------------------------------------------------------------------------- */
/* Operator precedence                                                       */
/* ------------------------------------------------------------------------- */

test("precedence: multiplication before addition", () => {
  assert.equal(calculate("2+3*4"), 14);
  assert.equal(calculate("2*3+4"), 10);
  assert.equal(calculate("2+3*4-5"), 9);
});

test("precedence: parentheses override", () => {
  assert.equal(calculate("(2+3)*4"), 20);
  assert.equal(calculate("2*(3+4)"), 14);
  assert.equal(calculate("((1+2)*(3+4))"), 21);
});

test("precedence: division and subtraction left-associative", () => {
  assert.equal(calculate("20/4/5"), 1);
  assert.equal(calculate("100-10-10"), 80);
});

test("precedence: exponent is right-associative and binds tighter than unary minus", () => {
  assert.equal(calculate("2^3"), 8);
  assert.equal(calculate("2^3^2"), 512); // 2^(3^2)
  assert.equal(calculate("-2^2"), -4); // -(2^2)
  assert.equal(calculate("2^-2"), 0.25);
});

test("precedence: modulo operator", () => {
  assert.equal(calculate("10%3"), 1);
  assert.equal(calculate("2+10%3"), 3); // 2 + (10 % 3)
});

/* ------------------------------------------------------------------------- */
/* Division by zero                                                          */
/* ------------------------------------------------------------------------- */

test("division by zero throws", () => {
  assert.throws(() => calculate("10/0"), /Division by zero/);
  assert.throws(() => calculate("0/0"), /Division by zero/);
  assert.throws(() => calculate("5/(3-3)"), /Division by zero/);
  assert.throws(() => calculate("1/0.0"), /Division by zero/);
});

test("modulo by zero throws", () => {
  assert.throws(() => calculate("5%0"), /Division by zero/);
});

/* ------------------------------------------------------------------------- */
/* Scientific functions                                                      */
/* ------------------------------------------------------------------------- */

test("scientific: square root", () => {
  assert.equal(calculate("sqrt(9)"), 3);
  assert.equal(calculate("sqrt(2.25)"), 1.5);
  assert.throws(() => calculate("sqrt(-1)"), /negative/);
});

test("scientific: power function and operator", () => {
  assert.equal(calculate("pow(2,10)"), 1024);
  assert.equal(calculate("pow(9,0.5)"), 3);
  assert.equal(calculate("3^4"), 81);
});

test("scientific: trigonometry (radians)", () => {
  assert.equal(calculate("sin(0)"), 0);
  assert.equal(calculate("cos(0)"), 1);
  assert.equal(calculate("tan(0)"), 0);
  approx(calculate("sin(pi/2)"), 1);
  approx(calculate("cos(pi)"), -1);
});

test("scientific: logarithm (base 10) and natural log", () => {
  assert.equal(calculate("log(1000)"), 3);
  assert.equal(calculate("log(1)"), 0);
  assert.equal(calculate("ln(e)"), 1);
  assert.throws(() => calculate("log(0)"), Error);
  assert.throws(() => calculate("log(-5)"), Error);
});

test("scientific: constants", () => {
  approx(calculate("pi"), Math.PI);
  approx(calculate("e"), Math.E);
  assert.equal(calculate("tau/pi"), 2);
});

test("scientificOp: unary operations", () => {
  assert.equal(scientificOp("sqrt", 16), 4);
  assert.equal(scientificOp("sin", 0), 0);
  assert.equal(scientificOp("cos", 0), 1);
  assert.equal(scientificOp("tan", 0), 0);
  assert.equal(scientificOp("log", 100), 2);
  assert.equal(scientificOp("ln", 1), 0);
  assert.equal(scientificOp("abs", -7), 7);
});

test("scientificOp: binary pow and validation", () => {
  assert.equal(scientificOp("pow", 2, 8), 256);
  assert.throws(() => scientificOp("unknownOp", 1), /Unknown scientific operation/);
  assert.throws(() => scientificOp("sqrt", -4), /negative/);
  assert.throws(() => scientificOp("sqrt", NaN), /Invalid value/);
});

/* ------------------------------------------------------------------------- */
/* Invalid input                                                             */
/* ------------------------------------------------------------------------- */

test("invalid expressions throw", () => {
  assert.throws(() => calculate(""), /empty/i);
  assert.throws(() => calculate("   "), /empty/i);
  assert.throws(() => calculate("2+"), Error);
  assert.throws(() => calculate("(2+3"), Error);
  assert.throws(() => calculate("2..3"), Error);
  assert.throws(() => calculate("2 + foo"), /Unknown identifier/);
  assert.throws(() => calculate("2 @ 3"), /Unexpected character/);
});

/* ------------------------------------------------------------------------- */
/* formatNumber                                                              */
/* ------------------------------------------------------------------------- */

test("formatNumber: normal numbers", () => {
  assert.equal(formatNumber(5), "5");
  assert.equal(formatNumber(3.5), "3.5");
  assert.equal(formatNumber(0.1 + 0.2), "0.3");
  assert.equal(formatNumber(-0), "0");
});

test("formatNumber: non-finite values", () => {
  assert.equal(formatNumber(NaN), "NaN");
  assert.equal(formatNumber(Infinity), "∞");
  assert.equal(formatNumber(-Infinity), "-∞");
});

test("formatNumber: exponential for extreme magnitudes", () => {
  assert.equal(formatNumber(1e20), "1e+20");
  assert.equal(formatNumber(1.5e-12), "1.5e-12");
});

/* ------------------------------------------------------------------------- */
/* History tape helpers                                                      */
/* ------------------------------------------------------------------------- */

test("history: create and format entries", () => {
  const entry = createHistoryEntry("2+3", 5, 1000);
  assert.equal(entry.expression, "2+3");
  assert.equal(entry.result, 5);
  assert.equal(entry.formatted, "5");
  assert.equal(entry.timestamp, 1000);
  assert.equal(formatHistoryEntry(entry), "2+3 = 5");
});

test("history: pushHistory prepends newest first and caps length", () => {
  let history = createHistory();
  assert.deepEqual(history, []);

  history = pushHistory(history, createHistoryEntry("1+1", 2, 1));
  history = pushHistory(history, createHistoryEntry("2+2", 4, 2));
  assert.equal(history.length, 2);
  assert.equal(history[0].expression, "2+2");
  assert.equal(history[1].expression, "1+1");

  for (let i = 0; i < MAX_HISTORY + 10; i += 1) {
    history = pushHistory(history, createHistoryEntry(`${i}+0`, i, i));
  }
  assert.equal(history.length, MAX_HISTORY);
  assert.equal(history[0].expression, `${MAX_HISTORY + 9}+0`);
});

test("history: pushHistory does not mutate the input tape", () => {
  const original = [createHistoryEntry("1+1", 2)];
  const next = pushHistory(original, createHistoryEntry("3+3", 6));
  assert.equal(original.length, 1);
  assert.equal(next.length, 2);
});

test("history: clearHistory returns an empty tape", () => {
  assert.deepEqual(clearHistory(), []);
});
