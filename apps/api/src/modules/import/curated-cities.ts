/**
 * Curated-city registry (BRI-164 / ST-11).
 *
 * Atlas is a *curated* platform, not a comprehensive mirror of Viator's
 * catalogue — so the curation boundary has to hold at the import layer, not just
 * in editorial copy. Viator's `/products/modified-since` feed is bulk-only (it
 * cannot be filtered by destination — verified against the live API), so instead
 * of importing the whole world we link only the tours whose payload destination
 * refs land in one of the cities below, and skip everything else.
 *
 * Each product carries `destinations[].ref` (e.g. Bangkok = `"343"`), and
 * Viator's `/destinations` taxonomy gives every destination a `center`
 * lat/lng — the two facts this registry is built from. Matching is by **exact
 * ref**, not geo proximity: precise, no distance threshold, and impossible to
 * mis-assign a border-case tour.
 *
 * `viatorRefs` is the *set* of refs that map a tour to this city. For a plain
 * city that is a single ref; for a **region** (Bali) it is the region ref plus
 * its descendant destination refs (Ubud, Seminyak, …), because Viator tags Bali
 * tours with the specific sub-destination, not the region. `centroid` is the
 * Viator taxonomy `center`, used as the geo fallback (BRI-163) when an imported
 * tour has no resolved coordinates of its own.
 *
 * Centroids and refs were captured from the live Viator taxonomy on 2026-07-25.
 * Hero images are real Viator product cover images (links, not editorial copy).
 */

/** One curated destination and the Viator refs that map inventory to it. */
export interface CuratedCity {
  /** URL slug for the city, e.g. `"bangkok"`. */
  readonly slug: string;
  /** URL slug for the country, e.g. `"thailand"`. */
  readonly countrySlug: string;
  /** Display name, e.g. `"Bangkok"`. */
  readonly name: string;
  /** Display country, e.g. `"Thailand"`. */
  readonly country: string;
  /**
   * The city's primary Viator destination ref (its canonical id). Stored on
   * `City.viatorDestRef`; the first entry of {@link viatorRefs}.
   */
  readonly primaryRef: string;
  /**
   * Every Viator destination ref that should map a tour to this city — the
   * primary ref plus, for a region, its descendant refs. The linker matches a
   * tour's `destinationRefs` against this set.
   */
  readonly viatorRefs: readonly string[];
  /** City centroid latitude (WGS-84), from the Viator taxonomy `center`. */
  readonly centroidLat: number;
  /** City centroid longitude (WGS-84). */
  readonly centroidLng: number;
  /** Absolute hero image URL (a real Viator product cover image). */
  readonly heroImageUrl: string;
  /** Hero image alt text. */
  readonly heroImageAlt: string;
}

export const CURATED_CITIES: readonly CuratedCity[] = [
  {
    slug: "bangkok",
    countrySlug: "thailand",
    name: "Bangkok",
    country: "Thailand",
    primaryRef: "343",
    viatorRefs: ["343"],
    centroidLat: 13.7234186,
    centroidLng: 100.4762319,
    heroImageUrl:
      "https://dynamic-media-cdn.tripadvisor.com/media/attractions-splice-spp-540x360/09/2a/0f/a1.jpg",
    heroImageAlt: "Temples and river life in Bangkok, Thailand",
  },
  {
    slug: "kyoto",
    countrySlug: "japan",
    name: "Kyoto",
    country: "Japan",
    primaryRef: "332",
    viatorRefs: ["332"],
    centroidLat: 35.0116363,
    centroidLng: 135.7680294,
    heroImageUrl:
      "https://media-cdn.tripadvisor.com/media/attractions-splice-spp-540x360/17/15/42/c1.jpg",
    heroImageAlt: "Historic shrines and gardens in Kyoto, Japan",
  },
  {
    slug: "hanoi",
    countrySlug: "vietnam",
    name: "Hanoi",
    country: "Vietnam",
    primaryRef: "351",
    viatorRefs: ["351"],
    centroidLat: 21.02425,
    centroidLng: 105.854694,
    heroImageUrl:
      "https://media-cdn.tripadvisor.com/media/attractions-splice-spp-540x360/r/32/89/f9/d4/caption.jpg",
    heroImageAlt: "Old Quarter streets and lakes in Hanoi, Vietnam",
  },
  {
    slug: "rome",
    countrySlug: "italy",
    name: "Rome",
    country: "Italy",
    primaryRef: "511",
    viatorRefs: ["511"],
    centroidLat: 41.8954656,
    centroidLng: 12.4823243,
    heroImageUrl:
      "https://media-cdn.tripadvisor.com/media/attractions-splice-spp-540x360/r/32/a8/f3/2d/caption.jpg",
    heroImageAlt: "Ancient monuments in Rome, Italy",
  },
  {
    slug: "lisbon",
    countrySlug: "portugal",
    name: "Lisbon",
    country: "Portugal",
    primaryRef: "538",
    viatorRefs: ["538"],
    centroidLat: 38.7252,
    centroidLng: -9.15,
    heroImageUrl:
      "https://media-cdn.tripadvisor.com/media/attractions-splice-spp-540x360/r/32/a4/79/4d/caption.jpg",
    heroImageAlt: "Hillside neighbourhoods and the Tagus in Lisbon, Portugal",
  },
  {
    // Bali is a Viator REGION, and tours are filed under its sub-destinations
    // (Ubud, Seminyak, Kuta, …) rather than the region ref itself — so the ref
    // set is the region plus its taxonomy descendants (captured 2026-07-25). The
    // "Bali VILLAGE" ref 50944 is deliberately excluded: its taxonomy `center`
    // is corrupt (it points at Crete), so the region ref 98's centroid is used.
    slug: "bali",
    countrySlug: "indonesia",
    name: "Bali",
    country: "Indonesia",
    primaryRef: "98",
    viatorRefs: [
      "98",
      "5467",
      "22287",
      "22290",
      "23621",
      "34198",
      "35681",
      "35829",
      "42862",
      "51549",
      "60447",
      "60448",
    ],
    centroidLat: -8.4095178,
    centroidLng: 115.188916,
    heroImageUrl:
      "https://media-cdn.tripadvisor.com/media/attractions-splice-spp-540x360/r/32/d4/cf/0f/caption.jpg",
    heroImageAlt: "Temples and rice terraces in Bali, Indonesia",
  },
];

/** Every curated Viator ref, flattened — the linker's `hasSome` match set. */
export const CURATED_REFS: readonly string[] = CURATED_CITIES.flatMap(
  (c) => c.viatorRefs,
);

/**
 * Map a set of a tour's Viator destination refs to the curated city it belongs
 * to, or `null` when none match. Registry order is the tie-breaker, so a tour
 * tagged with refs from two curated cities resolves deterministically.
 */
export function curatedCityForRefs(
  refs: readonly string[],
): CuratedCity | null {
  for (const city of CURATED_CITIES) {
    if (refs.some((r) => city.viatorRefs.includes(r))) return city;
  }
  return null;
}
