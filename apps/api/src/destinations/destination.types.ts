/**
 * Response shape for `GET /v1/destinations/:country/:city` (ST-5 / BRI-100).
 *
 * Deliberately flat and small: exactly the fields the destination page renders
 * (a title, a hero image, and a list). Internal DB ids for the city are not
 * exposed; experiences keep a stable id for React keys.
 */
export interface ExperienceResponse {
  id: string;
  title: string;
  description: string;
}

export interface DestinationResponse {
  city: string;
  citySlug: string;
  country: string;
  countrySlug: string;
  heroImageUrl: string;
  heroImageAlt: string;
  experiences: ExperienceResponse[];
}
