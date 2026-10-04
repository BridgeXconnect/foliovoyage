/** @jest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const capture = jest.fn();
jest.mock("posthog-js", () => ({ __esModule: true, default: { capture: (...a: unknown[]) => capture(...a) } }));

import { BookButton } from "@/components/tour/BookButton";

const AFFILIATE = "https://www.viator.com/tours/Bangkok/Canal/d343-1P5?pid=P1&mcid=42383";
const props = { experienceId: "cabc", title: "Canal Tour", citySlug: "bangkok", label: "Book on Viator" as const };

let host: HTMLElement;
let root: Root;
beforeEach(() => {
  capture.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

describe("BookButton", () => {
  it("fires experience_booking_clicked with source tour_page and the experience id", () => {
    act(() => root.render(<BookButton {...props} />));
    const a = host.querySelector("a")!;
    act(() => {
      a.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(capture).toHaveBeenCalledTimes(1);
    const [name, payload] = capture.mock.calls[0] as [string, Record<string, unknown>];
    expect(name).toBe("experience_booking_clicked");
    expect(payload).toMatchObject({ experience_id: "cabc", source: "tour_page", city: "bangkok", provider: "viator" });
  });

  it("links to our redirect, and no affiliate URL is in the output or the payload", () => {
    const html = renderToStaticMarkup(<BookButton {...props} />);
    expect(html).toContain('href="/go/tours/cabc"');
    expect(html).toContain('rel="sponsored nofollow noopener"');
    expect(html).not.toContain("viator.com");
    expect(html).not.toContain("pid=");

    act(() => root.render(<BookButton {...props} />));
    act(() => {
      host.querySelector("a")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(JSON.stringify(capture.mock.calls)).not.toContain(AFFILIATE);
    expect(JSON.stringify(capture.mock.calls)).not.toContain("viator.com");
    // The component accepts no URL prop at all.
    expect(Object.keys(props)).not.toContain("affiliateUrl");
  });
});
