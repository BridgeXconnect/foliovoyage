"use client";

import { useState } from "react";
import {
  DestinationRevealCard,
  type RevealDestination,
} from "./DestinationRevealCard";

/**
 * "Other destinations" grid on the destination page — the hover image-reveal
 * tiles, with the first revealed by default (as Covilla highlights one in its
 * "other vacations" grid).
 */
export function OtherDestinationsGrid({
  destinations,
}: {
  destinations: RevealDestination[];
}) {
  const [active, setActive] = useState(0);
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {destinations.map((d, i) => (
        <DestinationRevealCard
          key={d.slug}
          destination={d}
          variant="tile"
          active={active === i}
          onActivate={() => setActive(i)}
        />
      ))}
    </div>
  );
}
