/**
 * Discovery canvas engine (spec 0004, AC-L7, AC-L8, AC-L15): the section culler,
 * the view clamp, the input rules and the pan controller. Client only. Import it
 * from the `/discover` route alone, so its script never loads elsewhere (AC-L12).
 */

export * from "./view";
export * from "./sections";
export * from "./input";
export * from "./pan-controller";
