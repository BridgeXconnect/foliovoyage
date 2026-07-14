/**
 * Editorial promises, not customer reviews.
 *
 * Folio Voyage is pre-launch and has no booking history, so there are no real
 * traveller testimonials to show — and inventing them (named "customers",
 * "Booked …" claims) would be exactly the kind of fake social proof an affiliate
 * reviewer distrusts. Instead this band carries the site's own editorial
 * promises, in the publisher's voice, clearly attributed to Folio Voyage. When
 * real, verifiable traveller feedback exists post-launch, it can replace these.
 */
export interface Testimonial {
  quote: string;
  name: string;
  location: string;
}

/** Kept the export names `Testimonial`/`testimonials` to avoid call-site churn. */
export const testimonials: Testimonial[] = [
  {
    quote:
      "If we wouldn't send a good friend there, it doesn't make the guide. Curation only means something when it's willing to leave things out.",
    name: "Folio Voyage",
    location: "Our editorial promise",
  },
  {
    quote:
      "Every recommendation comes with its catch — the 11am crowd, the tourist-trap two streets over, the cheaper way to do the same thing.",
    name: "Folio Voyage",
    location: "How we write",
  },
  {
    quote:
      "We write from time actually spent in these cities, not a template. The neighbourhood notes are the detail most sites skip.",
    name: "Folio Voyage",
    location: "How we research",
  },
  {
    quote:
      "Reader-supported means a commission never moves anything up the page. The editorial list is decided first, and the money attaches to it — or it doesn't.",
    name: "Folio Voyage",
    location: "Our independence",
  },
  {
    quote:
      "Guides worth going back to: original writing, honest best-time-to-go, and links that go live only as partners are properly approved.",
    name: "Folio Voyage",
    location: "What we're building",
  },
];
