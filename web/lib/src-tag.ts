// The ?src= campaign tag (e.g. ?src=pitch-nov14), kept for the browser session so it is still known
// when a visitor reaches /login a few clicks after landing. Pure (no imports) so it can be unit
// tested by the root test run, which doesn't install web/'s dependencies.
const SRC_KEY = "metis_src";
const SRC_PATTERN = /^[a-z0-9_-]{1,40}$/i;

/** Remember a valid ?src= tag for this browser session. Invalid or missing tags are ignored. */
export function rememberSrc(search: string = typeof window === "undefined" ? "" : window.location.search): void {
  try {
    const src = new URLSearchParams(search).get("src");
    if (src && SRC_PATTERN.test(src)) sessionStorage.setItem(SRC_KEY, src.toLowerCase());
  } catch {
    // storage unavailable: events just go out as "direct"
  }
}

export function currentSrc(): string {
  try {
    return sessionStorage.getItem(SRC_KEY) ?? "direct";
  } catch {
    return "direct";
  }
}
