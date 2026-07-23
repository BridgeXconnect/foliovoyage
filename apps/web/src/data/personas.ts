/**
 * Traveller personas (a working subset of the product spec §4), used to tag
 * blog posts so readers can filter The Folio by how they actually travel.
 * Ids are stable slugs referenced from `BlogPost.personas`.
 */
export interface Persona {
  id: string;
  /** Short chip label. */
  label: string;
  /** One-line description of who this is / what they want. */
  blurb: string;
}

export const personas: Persona[] = [
  {
    id: "backpacker",
    label: "Backpacker",
    blurb: "Maximise experiences per dollar — authenticity over polish.",
  },
  {
    id: "luxury",
    label: "Luxury",
    blurb: "A curated shortlist of the best, with time well spent.",
  },
  {
    id: "family",
    label: "Family",
    blurb: "Kid-friendly, safe, and logistically simple days out.",
  },
  {
    id: "weekend",
    label: "Weekend",
    blurb: "Short trips, high efficiency — see the best in 48 hours.",
  },
  {
    id: "solo",
    label: "Solo",
    blurb: "Social, safe, flexible experiences for travelling alone.",
  },
];

export function getPersona(id: string): Persona | undefined {
  return personas.find((p) => p.id === id);
}
