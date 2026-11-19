import Script from "next/script";

// Cookieless page-view counts from our self-hosted Umami (Railway project
// zuse-marketing). Renders nothing unless both variables are set, so local
// and preview builds stay untracked. The script's origin is added to the CSP
// in next.config.ts from the same variables.
export function UmamiScript() {
  const src = process.env.NEXT_PUBLIC_UMAMI_SRC;
  const websiteId = process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID;
  if (!src || !websiteId) return null;
  return (
    <Script
      src={src}
      data-website-id={websiteId}
      data-domains="metisanalytic.com,www.metisanalytic.com"
      data-do-not-track="true"
      strategy="afterInteractive"
    />
  );
}
