import { describe, expect, it } from "@jest/globals";

import {
  CHECK_MAX_SENTENCES,
  CHECK_MAX_WORDS,
  CHECK_MIN_OVERLAP_WORDS,
  CHECK_MIN_SENTENCES,
  CHECK_MIN_WORDS,
  CORRECTIVE_SENTENCES,
  PRICE_WORDS,
  TOUR_COPY_CHECK_REASON_CODES,
  TOUR_COPY_FAILURE_REASON_CODES,
} from "./tour-copy-check.constants";
import { checkTourCopy, type TourCopyCheckInput } from "./tour-copy-check";
import type { TourCopyGroundingInput } from "./tour-copy-grounding-hash";

const SOURCE: TourCopyGroundingInput = {
  title: "Canalside Longtail Boat Excursion",
  description:
    "Passengers cruise past floating vendors selling mangoes coconuts noodles bracelets lanterns umbrellas postcards magnets.",
  durationMin: 90,
  inclusions: [],
  exclusions: [],
};

/** The 18 non-stopword, length->=4 tokens in {@link SOURCE}'s title + description. */
const SOURCE_CONTENT_WORDS = [
  "canalside", "longtail", "boat", "excursion", "passengers", "cruise",
  "past", "floating", "vendors", "selling", "mangoes", "coconuts",
  "noodles", "bracelets", "lanterns", "umbrellas", "postcards", "magnets",
];

/** Generic filler words: length->=4, not stopwords, and absent from {@link SOURCE}. */
const UNRELATED_WORDS = [
  "castle", "bridge", "forest", "desert", "mountain", "river", "valley",
  "canyon", "meadow", "harbor", "island", "garden", "statue", "fountain",
  "chapel", "tunnel", "stadium", "arena",
];

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function distributeIntoSentences(words: string[], sentenceCount: number): string {
  const perSentence = Math.floor(words.length / sentenceCount);
  const remainder = words.length % sentenceCount;
  const sentences: string[] = [];
  let idx = 0;
  for (let s = 0; s < sentenceCount; s++) {
    const count = perSentence + (s < remainder ? 1 : 0);
    const chunk = words.slice(idx, idx + count);
    idx += count;
    sentences.push([capitalize(chunk[0]), ...chunk.slice(1)].join(" ") + ".");
  }
  return sentences.join(" ");
}

/**
 * Builds a candidate paragraph with an exact word count, exact sentence
 * count, and an exact number of distinct words shared with {@link SOURCE}
 * (the rest padded with words that share nothing with it) — so a test can
 * pin one check dimension while holding the others deliberately inert.
 */
function buildCandidate(opts: {
  totalWords: number;
  sentences: number;
  sourceWordCount: number;
}): string {
  const sourceWords = SOURCE_CONTENT_WORDS.slice(0, opts.sourceWordCount);
  const fillerCount = Math.max(opts.totalWords - sourceWords.length, 0);
  const filler = Array.from(
    { length: fillerCount },
    (_, i) => UNRELATED_WORDS[i % UNRELATED_WORDS.length],
  );
  return distributeIntoSentences([...sourceWords, ...filler], opts.sentences);
}

function check(candidate: string, source: TourCopyGroundingInput = SOURCE) {
  const input: TourCopyCheckInput = { candidate, source };
  return checkTourCopy(input);
}

describe("checkTourCopy", () => {
  it("passes a paragraph grounded in the source, within the sentence/word/overlap bounds", () => {
    const candidate = buildCandidate({ totalWords: 43, sentences: 3, sourceWordCount: 10 });
    expect(check(candidate)).toEqual({
      passed: true,
      reasons: [],
      voiceCounts: { emDash: 0, contrastiveReveal: 0, clicheOrIntensifier: 0 },
    });
  });

  describe("price_language (AC-5a)", () => {
    it("blocks a price word, and only that", () => {
      const words = buildCandidate({ totalWords: 43, sentences: 3, sourceWordCount: 10 }).split(" ");
      // Swap one filler word for a price word; word/sentence/overlap counts hold.
      const withPrice = words.map((w, i) => (i === words.length - 1 ? "cost." : w)).join(" ");
      const result = check(withPrice);
      expect(result.passed).toBe(false);
      expect(result.reasons).toEqual(["price_language"]);
    });

    it("blocks a currency symbol", () => {
      const candidate = buildCandidate({ totalWords: 43, sentences: 3, sourceWordCount: 10 });
      const result = check(candidate.replace("castle", "$50"));
      expect(result.reasons).toContain("price_language");
    });

    it("blocks a currency code as a whole word", () => {
      const candidate = buildCandidate({ totalWords: 43, sentences: 3, sourceWordCount: 10 });
      const result = check(candidate.replace("castle", "USD"));
      expect(result.reasons).toContain("price_language");
    });

    it("does not treat 'free' as price language (grounded inclusions text)", () => {
      expect(PRICE_WORDS).not.toContain("free");
      const candidate = buildCandidate({ totalWords: 43, sentences: 3, sourceWordCount: 10 }).replace(
        "castle",
        "free",
      );
      const result = check(candidate);
      expect(result.reasons).not.toContain("price_language");
    });
  });

  describe("cancellation_language (AC-5b)", () => {
    it("blocks a single cancellation word, and only that", () => {
      const words = buildCandidate({ totalWords: 43, sentences: 3, sourceWordCount: 10 }).split(" ");
      const withRefund = words.map((w, i) => (i === words.length - 1 ? "refund." : w)).join(" ");
      const result = check(withRefund);
      expect(result.passed).toBe(false);
      expect(result.reasons).toEqual(["cancellation_language"]);
    });

    it("blocks a multi-word cancellation phrase ('book now')", () => {
      const candidate = buildCandidate({ totalWords: 43, sentences: 3, sourceWordCount: 10 });
      const result = check(candidate.replace("castle", "book now"));
      expect(result.reasons).toContain("cancellation_language");
    });
  });

  describe("unsourced_number (AC-5c): duration is unit-aware, not a raw substring match", () => {
    it("allows the raw duration-minutes figure ('about 90 minutes')", () => {
      const result = check("The ride covers about 90 minutes of narrow canals and market stalls end to end today.");
      expect(result.reasons).not.toContain("unsourced_number");
    });

    it("allows the equivalent expressed as hours and a half ('1.5 hours', 90 minutes = 1h30)", () => {
      const result = check("The ride covers about 1.5 hours of narrow canals and market stalls end to end today.");
      expect(result.reasons).not.toContain("unsourced_number");
    });

    it("blocks an invented duration ('3 hours') that isn't derivable from durationMin", () => {
      const result = check("The ride covers about 3 hours of narrow canals and market stalls end to end today.");
      expect(result.reasons).toContain("unsourced_number");
    });

    it("blocks any digit run absent from the source and not derived from durationMin", () => {
      const result = check("There are 12 stalls selling snacks along the canal route on this trip today.");
      expect(result.reasons).toContain("unsourced_number");
    });

    it("allows a digit run that appears verbatim in the source text", () => {
      const sourceWithNumber: TourCopyGroundingInput = {
        ...SOURCE,
        description: `${SOURCE.description} There are 12 stops along the way.`,
      };
      const result = check("There are 12 stalls selling snacks along the canal route on this trip today.", sourceWithNumber);
      expect(result.reasons).not.toContain("unsourced_number");
    });
  });

  describe("unsourced_number (AC-5c): dates", () => {
    it("blocks a month name not present in the source", () => {
      const result = check("The market is at its best in May, with plenty of shade along the canal.");
      expect(result.reasons).toContain("unsourced_number");
    });

    it("allows a month name that is present in the source", () => {
      const sourceWithMonth: TourCopyGroundingInput = {
        ...SOURCE,
        description: `${SOURCE.description} Busiest in May.`,
      };
      const result = check("The market is at its best in May, with plenty of shade along the canal.", sourceWithMonth);
      expect(result.reasons).not.toContain("unsourced_number");
    });

    it("blocks a four-digit year not present in the source", () => {
      const result = check("The floating market has operated in its current form since 1920, locals say.");
      expect(result.reasons).toContain("unsourced_number");
    });
  });

  describe("unsourced_number: spelled out numbers (spec 0003 AC-3)", () => {
    const base = buildCandidate({ totalWords: 43, sentences: 3, sourceWordCount: 10 });
    const withPhrase = (phrase: string) => base.replace("castle", phrase);
    const sourceWith = (extra: string): TourCopyGroundingInput => ({
      ...SOURCE,
      description: `${SOURCE.description} ${extra}`,
    });

    it.each(["three", "twenty", "forty", "hundred", "thousand", "million", "dozen"])(
      "blocks the unsourced word %s, and only that",
      (word) => {
        const result = check(withPhrase(word));
        expect(result.reasons).toEqual(["unsourced_number"]);
      },
    );

    it.each(["twenty five", "twenty-five", "two hundred", "three thousand", "two dozen", "ninety nine"])(
      "blocks the unsourced compound %s",
      (phrase) => {
        expect(check(withPhrase(phrase)).reasons).toContain("unsourced_number");
      },
    );

    it("reads a compound as one value: 'twenty five' passes when the source says 25", () => {
      expect(check(withPhrase("twenty five"), sourceWith("Groups of 25.")).reasons).not.toContain("unsourced_number");
    });

    it("does not accept the parts of a compound: 'twenty five' fails when the source only says 20 and 5", () => {
      expect(check(withPhrase("twenty five"), sourceWith("Ages 20 and 5.")).reasons).toContain("unsourced_number");
    });

    it("passes a word whose value is in the source as the same word", () => {
      expect(check(withPhrase("seven"), sourceWith("Seven stops.")).reasons).not.toContain("unsourced_number");
    });

    it("passes a word whose value is in the source as digits", () => {
      expect(check(withPhrase("twelve"), sourceWith("Groups of up to 12.")).reasons).not.toContain("unsourced_number");
    });

    it("compares source digits after removing commas: 'twelve hundred' passes for 1,200", () => {
      expect(check(withPhrase("twelve hundred"), sourceWith("Covers 1,200 metres.")).reasons).not.toContain(
        "unsourced_number",
      );
    });

    it("treats a hyphen as a space in the candidate and the source", () => {
      expect(check(withPhrase("twenty-five"), sourceWith("Twenty five guests.")).reasons).not.toContain("unsourced_number");
    });

    it("accepts a spelled duration that matches durationMin in some unit", () => {
      // 90 minutes: "ninety" minutes, or the "thirty" of an hour and thirty minutes (no "five", see below).
      expect(check(withPhrase("ninety")).reasons).not.toContain("unsourced_number");
      expect(check(withPhrase("thirty")).reasons).not.toContain("unsourced_number");
      const twoHours: TourCopyGroundingInput = { ...SOURCE, durationMin: 120 };
      expect(check(withPhrase("two"), twoHours).reasons).not.toContain("unsourced_number");
    });

    it("does not accept the half hour fraction as a word: 'five' fails for a 90 minute tour", () => {
      expect(check(withPhrase("five")).reasons).toContain("unsourced_number");
    });

    it.each(["one", "first", "second", "third", "hundreds", "thousands", "tenth"])(
      "does not check %s",
      (word) => {
        expect(check(withPhrase(word)).reasons).not.toContain("unsourced_number");
      },
    );

    it("still checks a word inside a longer word list without treating the neighbours as one number", () => {
      // "two three" is two numbers, so a source with only "two" is not enough.
      expect(check(withPhrase("two three"), sourceWith("Two stops.")).reasons).toContain("unsourced_number");
    });

    it("rewords the corrective sentence to cover words", () => {
      expect(CORRECTIVE_SENTENCES.unsourced_number).toContain("a number written as digits or as words");
    });
  });

  describe("sentence_count / word_count (AC-5d)", () => {
    it("blocks too few sentences", () => {
      const candidate = buildCandidate({ totalWords: 43, sentences: 1, sourceWordCount: 10 });
      const result = check(candidate);
      expect(result.reasons).toContain("sentence_count");
    });

    it("blocks too many sentences", () => {
      const candidate = buildCandidate({ totalWords: 43, sentences: 5, sourceWordCount: 10 });
      const result = check(candidate);
      expect(result.reasons).toContain("sentence_count");
    });

    it("passes at the sentence-count boundaries (2 and 4)", () => {
      const min = buildCandidate({ totalWords: 43, sentences: CHECK_MIN_SENTENCES, sourceWordCount: 10 });
      const max = buildCandidate({ totalWords: 43, sentences: CHECK_MAX_SENTENCES, sourceWordCount: 10 });
      expect(check(min).reasons).not.toContain("sentence_count");
      expect(check(max).reasons).not.toContain("sentence_count");
    });

    it("blocks too few words", () => {
      const candidate = buildCandidate({ totalWords: 10, sentences: 3, sourceWordCount: 10 });
      const result = check(candidate);
      expect(result.reasons).toContain("word_count");
    });

    it("blocks too many words", () => {
      const candidate = buildCandidate({ totalWords: 120, sentences: 3, sourceWordCount: 10 });
      const result = check(candidate);
      expect(result.reasons).toContain("word_count");
    });

    it("passes at the word-count boundaries (30 and 100)", () => {
      const min = buildCandidate({ totalWords: CHECK_MIN_WORDS, sentences: 3, sourceWordCount: 10 });
      const max = buildCandidate({ totalWords: CHECK_MAX_WORDS, sentences: 3, sourceWordCount: 10 });
      expect(check(min).reasons).not.toContain("word_count");
      expect(check(max).reasons).not.toContain("word_count");
    });

    it("does not count 'St. Paul's' as a sentence break", () => {
      const withoutAbbrev =
        "We paddle past St. Paul's Cathedral before the canal narrows toward the docks. " +
        "Vendors along the banks sell mangoes, coconuts, and noodles from small wooden stalls near the market each morning.";
      expect(check(withoutAbbrev).reasons).not.toContain("sentence_count");
    });

    it("does not count a decimal like '2.5 hours' as a sentence break", () => {
      const withDecimal =
        "The full loop takes about 2.5 hours if you stop for photos along the way. " +
        "Vendors sell mangoes, coconuts, and noodles from small stalls near the canal each morning for visitors.";
      expect(check(withDecimal).reasons).not.toContain("sentence_count");
    });
  });

  describe("low_overlap (AC-5e)", () => {
    it("passes at exactly the overlap floor (8 distinct shared content words)", () => {
      const candidate = buildCandidate({ totalWords: 43, sentences: 3, sourceWordCount: CHECK_MIN_OVERLAP_WORDS });
      expect(check(candidate).reasons).not.toContain("low_overlap");
    });

    it("blocks one word under the overlap floor (7 distinct shared content words)", () => {
      const candidate = buildCandidate({
        totalWords: 43,
        sentences: 3,
        sourceWordCount: CHECK_MIN_OVERLAP_WORDS - 1,
      });
      expect(check(candidate).reasons).toContain("low_overlap");
    });

    it("blocks a paragraph that shares nothing with the source", () => {
      const candidate = buildCandidate({ totalWords: 43, sentences: 3, sourceWordCount: 0 });
      expect(check(candidate).reasons).toContain("low_overlap");
    });
  });

  describe("closed reason-code set (AC-5)", () => {
    it("has exactly the six blocking codes the check itself can produce", () => {
      expect(TOUR_COPY_CHECK_REASON_CODES).toEqual([
        "price_language",
        "cancellation_language",
        "unsourced_number",
        "sentence_count",
        "word_count",
        "low_overlap",
      ]);
    });

    it("extends to exactly eight codes once refusal and source_too_thin are included", () => {
      expect(TOUR_COPY_FAILURE_REASON_CODES).toEqual([
        "price_language",
        "cancellation_language",
        "unsourced_number",
        "sentence_count",
        "word_count",
        "low_overlap",
        "refusal",
        "source_too_thin",
      ]);
    });

    it("never produces a reason code outside the closed set", () => {
      const candidate = buildCandidate({ totalWords: 5, sentences: 1, sourceWordCount: 0 }).replace(
        "castle",
        "$5 refund 1999",
      );
      const result = check(candidate);
      for (const reason of result.reasons) {
        expect(TOUR_COPY_CHECK_REASON_CODES as readonly string[]).toContain(reason);
      }
    });
  });

  describe("corrective sentences", () => {
    it("defines exactly one fixed sentence per checkable reason code", () => {
      expect(Object.keys(CORRECTIVE_SENTENCES).sort()).toEqual([...TOUR_COPY_CHECK_REASON_CODES].sort());
    });

    it("states the sentence/word bounds that match the check's own constants", () => {
      expect(CORRECTIVE_SENTENCES.sentence_count).toContain(String(CHECK_MIN_SENTENCES));
      expect(CORRECTIVE_SENTENCES.sentence_count).toContain(String(CHECK_MAX_SENTENCES));
      expect(CORRECTIVE_SENTENCES.word_count).toContain(String(CHECK_MIN_WORDS));
      expect(CORRECTIVE_SENTENCES.word_count).toContain(String(CHECK_MAX_WORDS));
    });
  });

  describe("voice counters (non-blocking, AC-15)", () => {
    const voiceCandidate =
      "The longtail boat trip isn't just a ride — it's a slow float past floating vendors selling mangoes, " +
      "coconuts, and noodles. Come for the canal views, stay for the bracelets, lanterns, and postcards near the docks. " +
      "It truly feels like a hidden gem tucked along the water, though the ride runs about 90 minutes today.";

    it("counts em dashes without blocking", () => {
      const result = check(voiceCandidate);
      expect(result.voiceCounts.emDash).toBe(1);
      expect(result.reasons).not.toContain("price_language");
      expect(result.reasons).not.toContain("cancellation_language");
    });

    it("counts the contrastive-reveal and 'come for X, stay for Y' patterns without blocking", () => {
      const result = check(voiceCandidate);
      expect(result.voiceCounts.contrastiveReveal).toBeGreaterThanOrEqual(2);
    });

    it("counts docs/08 cliché and stacked-intensifier terms without blocking", () => {
      const result = check(voiceCandidate);
      expect(result.voiceCounts.clicheOrIntensifier).toBeGreaterThanOrEqual(2);
    });

    it("reports zero voice counts for a clean paragraph", () => {
      const clean = buildCandidate({ totalWords: 43, sentences: 3, sourceWordCount: 10 });
      expect(check(clean).voiceCounts).toEqual({ emDash: 0, contrastiveReveal: 0, clicheOrIntensifier: 0 });
    });
  });
});
