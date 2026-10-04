/** @jest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { TourRating } from "@/components/tour/TourRating";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const scripts = () => Array.from(document.querySelectorAll<HTMLScriptElement>("script[data-tour-rating-script]"));
let host: HTMLElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

describe("TourRating", () => {
  it("renders only an empty placeholder on the server, holding the experience id only", () => {
    const html = renderToStaticMarkup(<TourRating experienceId="cabc" />);
    expect(html).toMatch(/^<div data-tour-rating="cabc"[^>]*><\/div>$/);
  });

  it("injects the async script on mount", () => {
    act(() => root.render(<TourRating experienceId="cabc" />));
    const [s] = scripts();
    expect(scripts()).toHaveLength(1);
    expect(s.getAttribute("src")).toBe("/protected/tour-rating.js");
    expect(s.async).toBe(true);
  });

  it("replaces its own earlier copy on a second mount instead of stacking", () => {
    act(() => root.render(<TourRating experienceId="cabc" />));
    const first = scripts()[0];
    const second = document.createElement("div");
    document.body.appendChild(second);
    const root2 = createRoot(second);
    act(() => root2.render(<TourRating experienceId="cdef" />));
    expect(scripts()).toHaveLength(1);
    expect(scripts()[0]).not.toBe(first);
    expect(first.isConnected).toBe(false);
    act(() => root2.unmount());
  });

  it("injects again when the experience id changes (client side navigation)", () => {
    act(() => root.render(<TourRating experienceId="cabc" />));
    const first = scripts()[0];
    act(() => root.render(<TourRating experienceId="cdef" />));
    expect(scripts()).toHaveLength(1);
    expect(scripts()[0]).not.toBe(first);
  });
});
