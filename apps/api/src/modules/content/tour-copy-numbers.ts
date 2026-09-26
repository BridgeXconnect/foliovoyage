/**
 * Number reading shared by the inline check's spelled out number rule and the
 * opening pattern (BRI-201 / spec 0003, AC-3 and AC-4). Pure: no DB, network
 * or clock access.
 *
 * Reading rules: a hyphen counts as a space (`twenty-five`, `90-minute`), a
 * run of number words has one value as a whole (`twenty five` is 25, `two
 * hundred` is 200), and digits with thousands commas are one number (`1,200`
 * is 1200). Words read: `two` to `twenty`, `thirty` to `ninety`, `hundred`,
 * `thousand`, `million`, `dozen`. `one` is only read where a caller asks for
 * it or inside a compound (`twenty one`, `one hundred`). Ordinals are never
 * read.
 */

const SMALL_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19,
};
const TENS_WORDS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const BIG_WORDS: Record<string, number> = { thousand: 1_000, million: 1_000_000 };

type Kind = "none" | "small" | "tens" | "hundred" | "big" | "dozen";

export interface NumberReading {
  value: number;
  /** Index of the first and last token in {@link tokenize}'s output that this number spans. */
  firstToken: number;
  lastToken: number;
  spelled: boolean;
}

interface Token {
  text: string;
  start: number;
  end: number;
  isDigits: boolean;
}

/** Hyphens become spaces, then digit runs (with thousands commas) and letter runs become tokens. */
export function tokenize(text: string): Token[] {
  const flat = text.toLowerCase().replace(/-/g, " ");
  const tokens: Token[] = [];
  const pattern = /\d+(?:,\d{3})*|[a-z]+/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(flat)) !== null) {
    tokens.push({
      text: match[0],
      start: match.index,
      end: match.index + match[0].length,
      isDigits: /^\d/.test(match[0]),
    });
  }
  return tokens;
}

function wordKind(word: string): Kind {
  if (word in SMALL_WORDS) return "small";
  if (word in TENS_WORDS) return "tens";
  if (word === "hundred") return "hundred";
  if (word in BIG_WORDS) return "big";
  if (word === "dozen") return "dozen";
  return "none";
}

interface Options {
  /** Read a lone `one` as a number. Off for the check (AC-3), on for the opening pattern (AC-4). */
  includeOne?: boolean;
}

/**
 * Every number in the text, digits and spelled, in reading order. Consecutive
 * number words are grouped into one value where they form a valid compound and
 * split into separate numbers where they do not (`two three` is 2 and 3).
 */
export function readNumbers(text: string, options: Options = {}): NumberReading[] {
  const tokens = tokenize(text);
  const readings: NumberReading[] = [];

  let run: { total: number; group: number; last: Kind; first: number; lastToken: number; onlyOne: boolean } | null = null;

  const flush = (): void => {
    if (run === null) return;
    const skip = run.onlyOne && !options.includeOne;
    if (!skip) {
      readings.push({ value: run.total + run.group, firstToken: run.first, lastToken: run.lastToken, spelled: true });
    }
    run = null;
  };

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];

    if (token.isDigits) {
      flush();
      readings.push({ value: Number(token.text.replace(/,/g, "")), firstToken: index, lastToken: index, spelled: false });
      continue;
    }

    const word = token.text;
    const kind = wordKind(word);

    // "and" bridges "two hundred and fifty" only.
    if (word === "and" && run !== null && (run.last === "hundred" || run.last === "big")) {
      const next = tokens[index + 1];
      if (next && !next.isDigits && (wordKind(next.text) === "small" || wordKind(next.text) === "tens")) continue;
    }

    if (kind === "none") {
      flush();
      continue;
    }

    const attaches = ((): boolean => {
      if (run === null) return false;
      switch (kind) {
        case "small":
          return (
            run.last === "hundred" ||
            run.last === "big" ||
            (run.last === "tens" && SMALL_WORDS[word] < 10)
          );
        case "tens":
          return run.last === "hundred" || run.last === "big";
        case "hundred":
          return run.last === "small";
        case "big":
          return run.last === "small" || run.last === "tens" || run.last === "hundred";
        case "dozen":
          return run.last === "small";
        default:
          return false;
      }
    })();

    if (!attaches) flush();
    if (run === null) run = { total: 0, group: 0, last: "none", first: index, lastToken: index, onlyOne: false };

    switch (kind) {
      case "small":
        run.group += SMALL_WORDS[word];
        run.onlyOne = run.last === "none" && word === "one";
        break;
      case "tens":
        run.group += TENS_WORDS[word];
        run.onlyOne = false;
        break;
      case "hundred":
        run.group = (run.group === 0 ? 1 : run.group) * 100;
        run.onlyOne = false;
        break;
      case "big":
        run.total += (run.group === 0 ? 1 : run.group) * BIG_WORDS[word];
        run.group = 0;
        run.onlyOne = false;
        break;
      case "dozen":
        run.group = (run.group === 0 ? 1 : run.group) * 12;
        run.onlyOne = false;
        break;
    }
    run.last = kind;
    run.lastToken = index;
  }
  flush();
  return readings;
}

/** The values of every number in `text`, as digit strings, for set membership tests. */
export function numberValueSet(text: string, options: Options = {}): Set<string> {
  return new Set(readNumbers(text, options).map((reading) => String(reading.value)));
}

/** True when the tokens from `after` up to the next token are joined by whitespace only, so the two are adjacent. */
export function nextTokenIfAdjacent(text: string, reading: NumberReading): string | null {
  const tokens = tokenize(text);
  const next = tokens[reading.lastToken + 1];
  if (!next) return null;
  const between = text
    .toLowerCase()
    .replace(/-/g, " ")
    .slice(tokens[reading.lastToken].end, next.start);
  return /^\s*$/.test(between) ? next.text : null;
}
