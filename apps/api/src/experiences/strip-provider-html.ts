/**
 * Turns a provider description into plain text paragraphs (spec 0005 AC-5).
 *
 * Viator descriptions are plain text today, but nothing promises that, and the
 * page renders the result as text, never as HTML. So: block tags (`<br>`, `<p>`,
 * and the other block level ones) become paragraph breaks, every other tag is
 * dropped, entities are decoded, and nothing is truncated. Returns null when
 * nothing is left.
 *
 * Entities are decoded last and in one pass, so `&lt;b&gt;` ends up as the
 * literal text `<b>` (it is never re-read as a tag) and `&amp;lt;` as `&lt;`.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  bull: "•",
  middot: "·",
  copy: "©",
  reg: "®",
  trade: "™",
  euro: "€",
  pound: "£",
  yen: "¥",
  deg: "°",
};

function codePointToString(code: number): string {
  // Zero, surrogates and anything past U+10FFFF are not characters.
  if (!Number.isInteger(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return "";
  return code === 0xa0 ? " " : String.fromCodePoint(code);
}

function decodeEntities(text: string): string {
  return text.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z][a-zA-Z0-9]{1,9}));/g, (whole, dec, hex, name) => {
    if (dec !== undefined) return codePointToString(parseInt(dec, 10));
    if (hex !== undefined) return codePointToString(parseInt(hex, 16));
    const named = NAMED_ENTITIES[name as string] ?? NAMED_ENTITIES[(name as string).toLowerCase()];
    return named ?? whole;
  });
}

const PARAGRAPH_BREAK = "\n\n";

export function stripProviderHtml(input: string | null | undefined): string | null {
  if (typeof input !== "string" || input === "") return null;

  const text = input
    .replace(/\r\n?/g, "\n")
    // Content that is never prose.
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    // Block tags, opening or closing, and <br>, become a paragraph break.
    .replace(/<\/?(?:br|p|div|li|ul|ol|h[1-6]|tr|table|blockquote)\b[^>]*>/gi, PARAGRAPH_BREAK)
    // Every other tag goes. A tag starts with a letter, so "5 < 10" survives.
    .replace(/<\/?[a-zA-Z][^>]*>/g, "");

  const paragraphs = decodeEntities(text)
    .split(/\n{2,}/)
    .map((p) =>
      p
        .split("\n")
        .map((line) => line.replace(/[ \t\u00a0]+/g, " ").trim())
        .filter((line) => line !== "")
        .join("\n"),
    )
    .filter((p) => p !== "");

  return paragraphs.length > 0 ? paragraphs.join(PARAGRAPH_BREAK) : null;
}
