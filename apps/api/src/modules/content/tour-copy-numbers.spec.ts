import { describe, expect, it } from "@jest/globals";

import { numberValueSet, readNumbers } from "./tour-copy-numbers";

const values = (text: string, includeOne = false) => readNumbers(text, { includeOne }).map((reading) => reading.value);

describe("readNumbers (spec 0003 AC-3, AC-4 reading rules)", () => {
  it.each([
    ["two", [2]],
    ["twenty", [20]],
    ["ninety", [90]],
    ["nineteen", [19]],
    ["hundred", [100]],
    ["thousand", [1000]],
    ["million", [1_000_000]],
    ["dozen", [12]],
  ])("reads the word %s", (text, expected) => {
    expect(values(text)).toEqual(expected);
  });

  it.each([
    ["twenty five", [25]],
    ["twenty-five", [25]],
    ["two hundred", [200]],
    ["two hundred and fifty", [250]],
    ["one hundred twenty three", [123]],
    ["three thousand five hundred", [3500]],
    ["two dozen", [24]],
    ["a dozen", [12]],
    ["eleven hundred", [1100]],
    ["twenty one", [21]],
  ])("reads the compound %s as one value", (text, expected) => {
    expect(values(text)).toEqual(expected);
  });

  it.each([
    ["two three", [2, 3]],
    ["twenty thirty", [20, 30]],
    ["five twenty", [5, 20]],
    ["twenty eleven", [20, 11]],
  ])("splits %s into separate numbers", (text, expected) => {
    expect(values(text)).toEqual(expected);
  });

  it("reads digits, dropping thousands commas", () => {
    expect(values("1,200 metres and 90 minutes and 2.5 hours")).toEqual([1200, 90, 2, 5]);
  });

  it("reads a hyphen as a space", () => {
    expect(values("90-minute, twenty-five")).toEqual([90, 25]);
  });

  it("does not read one by default, or ordinals or plurals", () => {
    expect(values("one guide, the first stop, second, hundreds, thousands")).toEqual([]);
  });

  it("reads a lone one when asked, and keeps it inside compounds either way", () => {
    expect(values("one hour", true)).toEqual([1]);
    expect(values("one hundred")).toEqual([100]);
    expect(values("twenty one")).toEqual([21]);
  });

  it("does not bridge 'and' between unrelated numbers", () => {
    expect(values("two and three")).toEqual([2, 3]);
  });

  it("marks spelled and digit numbers", () => {
    expect(readNumbers("ten and 10").map((reading) => reading.spelled)).toEqual([true, false]);
  });
});

describe("numberValueSet", () => {
  it("returns values as strings so spelled and digit forms compare equal", () => {
    expect(numberValueSet("Twenty five people, 1,200 metres")).toEqual(new Set(["25", "1200"]));
  });
});
