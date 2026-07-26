import posthog from "posthog-js";

const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;

if (!token) {
  if (process.env.NODE_ENV !== "production") {
     
    console.error(
      "NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN variable required by PostHog is missing or un-configured, " +
        "this causes events to be silently missed. This error stops appearing once " +
        "NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN is configured",
    );
  }
} else {
  posthog.init(token, {
    api_host: "/ingest",
    ui_host: "https://us.posthog.com",
    defaults: "2026-01-30",
    capture_exceptions: true,
    // Privacy-forward: keep events anonymous. PostHog only creates a person
    // profile once a user is explicitly identified, which we never do — so no
    // identified profiles are built. Keeps us consistent with the "anonymised
    // analytics" promise in /legal/privacy.
    person_profiles: "identified_only",
    debug: process.env.NODE_ENV === "development",
  });
}

// IMPORTANT: Never combine this approach with a PostHogProvider or other
// client-side init patterns. instrumentation-client.ts is the correct
// solution for Next.js 15.3+ apps.
