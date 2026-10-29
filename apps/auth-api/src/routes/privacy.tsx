import { createFileRoute, redirect } from "@tanstack/solid-router";

// A short address for the privacy policy, as in printed and spoken links.
export const Route = createFileRoute("/privacy")({
  loader: () => {
    throw redirect({ to: "/privacy-policy", statusCode: 308 });
  },
});
