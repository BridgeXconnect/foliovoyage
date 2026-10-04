import { describe, expect, it } from "@jest/globals";

import { stripProviderHtml } from "./strip-provider-html";

describe("stripProviderHtml (AC-5)", () => {
  it("removes tags and keeps the text", () => {
    expect(stripProviderHtml("Visit the <b>Grand Palace</b> and <a href='x'>Wat Pho</a>.")).toBe(
      "Visit the Grand Palace and Wat Pho.",
    );
  });

  it("turns <p> into paragraph breaks", () => {
    expect(stripProviderHtml("<p>First.</p><p>Second.</p>")).toBe("First.\n\nSecond.");
    expect(stripProviderHtml("<P class='x'>First.</P>\n<P>Second.</P>")).toBe("First.\n\nSecond.");
  });

  it("turns <br> in every spelling into a paragraph break, and collapses repeats", () => {
    expect(stripProviderHtml("One<br>Two<br/>Three<br />Four")).toBe("One\n\nTwo\n\nThree\n\nFour");
    expect(stripProviderHtml("One<br><br><br>Two")).toBe("One\n\nTwo");
  });

  it("does not run list items together", () => {
    expect(stripProviderHtml("<ul><li>Hotel pickup</li><li>Lunch</li></ul>")).toBe("Hotel pickup\n\nLunch");
  });

  it("decodes named, decimal and hex entities", () => {
    expect(stripProviderHtml("Fish &amp; chips &ndash; &quot;great&quot; &#8217;s &#x2019; &euro;5")).toBe(
      'Fish & chips – "great" ’s ’ €5',
    );
  });

  it("decodes once, and never reads a decoded entity as a tag", () => {
    expect(stripProviderHtml("&lt;b&gt;bold&lt;/b&gt;")).toBe("<b>bold</b>");
    expect(stripProviderHtml("&amp;lt;")).toBe("&lt;");
  });

  it("leaves unknown or malformed entities alone", () => {
    expect(stripProviderHtml("a &unknownthing; b &#0; c &#xD800; d")).toBe("a &unknownthing; b c d");
  });

  it("turns a non breaking space into a plain one", () => {
    expect(stripProviderHtml("a&nbsp;b\u00a0c")).toBe("a b c");
  });

  it("keeps a bare less than sign that is not a tag", () => {
    expect(stripProviderHtml("Groups of 5 < 10 people")).toBe("Groups of 5 < 10 people");
  });

  it("drops script and style blocks with their content, and comments", () => {
    expect(stripProviderHtml("Hi<script>alert(1)</script><style>p{}</style><!-- note -->there")).toBe("Hithere");
  });

  it("keeps existing paragraph breaks in plain text and does not truncate", () => {
    const long = "word ".repeat(2000).trim();
    expect(stripProviderHtml(`Para one.\n\nPara two.\n\n\n\nPara three.`)).toBe("Para one.\n\nPara two.\n\nPara three.");
    expect(stripProviderHtml(long)).toBe(long);
  });

  it("normalises CRLF and stray spaces", () => {
    expect(stripProviderHtml("  One \t two  \r\n\r\n  Three  ")).toBe("One two\n\nThree");
  });

  it("returns null when nothing remains", () => {
    expect(stripProviderHtml("")).toBeNull();
    expect(stripProviderHtml("   \n\t ")).toBeNull();
    expect(stripProviderHtml("<p></p><br/>")).toBeNull();
    expect(stripProviderHtml("<div>&nbsp;</div>")).toBeNull();
    expect(stripProviderHtml("<!-- only a comment -->")).toBeNull();
    expect(stripProviderHtml(null)).toBeNull();
    expect(stripProviderHtml(undefined)).toBeNull();
  });
});
