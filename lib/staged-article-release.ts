import { load } from "cheerio";

export type AliasReleaseDecision =
  | { kind: "redirected" }
  | { kind: "preserved" }
  | { kind: "restore" }
  | { kind: "block"; reason: string };

export function articleContentSignature(html: string) {
  const $ = load(html);
  const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
  return JSON.stringify({
    title: normalize($("main h1").first().text()),
    body: normalize($(".service-content").first().text()),
    image: $(".page-hero-bg img").attr("src") || "",
    imageAlt: $(".page-hero-bg img").attr("alt") || "",
  });
}

export function decideStagedAliasRelease(input: {
  status: number;
  location: string | null;
  expectedLocation: string;
  liveContent?: string;
  canonicalContent?: string;
}): AliasReleaseDecision {
  if (input.status === 301) {
    return input.location === input.expectedLocation
      ? { kind: "redirected" }
      : {
          kind: "block",
          reason: `existing 301 points to ${input.location || "no location"}, expected ${input.expectedLocation}`,
        };
  }
  if (input.status === 200) {
    return input.liveContent === input.canonicalContent
      ? { kind: "preserved" }
      : {
          kind: "block",
          reason: "live alias content differs from the current canonical article; review before deployment",
        };
  }
  if (input.status === 404) return { kind: "restore" };
  return {
    kind: "block",
    reason: `unexpected live status ${input.status}`,
  };
}
