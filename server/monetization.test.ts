import { describe, it, expect } from "vitest";
import {
  canAdvanceSponsorship,
  nextSponsorshipStages,
  validAffiliateLink,
  applyAffiliateClick,
  validMerchPrice,
  contentTierForPlan,
  TIER_BENEFITS,
} from "./monetization";

describe("Monetarisierung (Abschnitt 3.2)", () => {
  it("Sponsoring-Pipeline: nur schrittweite Vorwaerts-Übergänge", () => {
    expect(canAdvanceSponsorship("lead", "contacted")).toBe(true);
    expect(canAdvanceSponsorship("contacted", "negotiating")).toBe(true);
    expect(canAdvanceSponsorship("negotiating", "closed")).toBe(true);
    expect(canAdvanceSponsorship("lead", "closed")).toBe(false);
    expect(canAdvanceSponsorship("lead", "declined")).toBe(true);
    expect(canAdvanceSponsorship("negotiating", "declined")).toBe(true);
    expect(canAdvanceSponsorship("closed", "lead")).toBe(false);
    expect(canAdvanceSponsorship("declined", "negotiating")).toBe(false);
    expect(nextSponsorshipStages("lead")).toEqual(["contacted", "declined"]);
    expect(nextSponsorshipStages("closed")).toEqual([]);
  });

  it("validAffiliateLink prueft Label und http(s)-URL", () => {
    expect(validAffiliateLink({ label: "Tool", url: "https://example.com/x" })).toBe(true);
    expect(validAffiliateLink({ label: "Tool", url: "http://example.com/x" })).toBe(true);
    expect(validAffiliateLink({ label: "", url: "https://example.com" })).toBe(false);
    expect(validAffiliateLink({ label: "Tool", url: "javascript:alert(1)" })).toBe(false);
    expect(validAffiliateLink({ label: "Tool", url: "kein-url" })).toBe(false);
  });

  it("applyAffiliateClick zaehlt Klicks und Provisionen ehrlich", () => {
    const link = { clickCount: 10, revenueCents: 500 };
    expect(applyAffiliateClick(link)).toEqual({ clickCount: 11, revenueCents: 500 });
    expect(applyAffiliateClick(link, 250)).toEqual({ clickCount: 11, revenueCents: 750 });
    expect(applyAffiliateClick(link, -99)).toEqual({ clickCount: 11, revenueCents: 500 });
  });

  it("validMerchPrice lehnt 0, negativ und Fantasie-Preise ab", () => {
    expect(validMerchPrice(1999)).toBe(true);
    expect(validMerchPrice(0)).toBe(false);
    expect(validMerchPrice(-100)).toBe(false);
    expect(validMerchPrice(200_000_000)).toBe(false);
    expect(validMerchPrice(19.99)).toBe(false); // keine Cent-Brueche
  });

  it("Content-Tiers mappen auf das Subscriptionssystem", () => {
    expect(contentTierForPlan("pro")).toBe("pro");
    expect(contentTierForPlan("free")).toBe("free");
    expect(TIER_BENEFITS.pro).toContain("Exklusive Dossier-Zugriffe");
    expect(TIER_BENEFITS.free).toContain("Oeffentliche Posts");
  });
});
