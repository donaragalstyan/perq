import { describe, expect, it } from "vitest";
import {
  claimKey,
  detectCredential,
  detectMoney,
  normalizeText,
  valueBucket,
} from "./normalization.js";
import type { NormalizedClaim } from "./types.js";

const BIZ = "biz-123";

describe("normalizeText — canonical percent examples (Requirement 6.4)", () => {
  // The three phrases from the spec must all map to the SAME normalized claim / claimKey,
  // when reported in the same student-ID context. A community report carries a structured
  // credential (Requirement 6.1); we pass it as the hint. Text that names a specific
  // credential (e.g. "college card") still resolves to PHYSICAL_STUDENT_ID, so all three
  // agree.
  const HINT = "PHYSICAL_STUDENT_ID" as const;
  const phrases = [
    "15% off",
    "They took 15 percent off when I showed my college card",
    "Student ID = 15% off",
  ];

  it("all three map to PERCENT 15 with PHYSICAL_STUDENT_ID", () => {
    for (const p of phrases) {
      const c = normalizeText(p, HINT);
      expect(c).not.toBeNull();
      expect(c!.discountType).toBe("PERCENT");
      expect(c!.discountValue).toBe(15);
      expect(c!.credentialType).toBe("PHYSICAL_STUDENT_ID");
    }
  });

  it("all three produce an identical claimKey", () => {
    const keys = phrases.map((p) => claimKey(BIZ, normalizeText(p, HINT)!));
    expect(new Set(keys).size).toBe(1);
  });
});

describe("resolveCredential precedence", () => {
  it("specific text credential overrides the hint", () => {
    // Text says ISIC; even with a student-ID hint, the specific text wins.
    const c = normalizeText("15% off with ISIC", "PHYSICAL_STUDENT_ID")!;
    expect(c.credentialType).toBe("ISIC");
  });

  it("hint is used when text names no specific credential", () => {
    const c = normalizeText("15% off", "EDU_EMAIL")!;
    expect(c.credentialType).toBe("EDU_EMAIL");
  });

  it("falls back to text-only inference when no hint", () => {
    expect(normalizeText("15% off")!.credentialType).toBe("OTHER");
    expect(normalizeText("student 15% off")!.credentialType).toBe("PHYSICAL_STUDENT_ID");
  });
});

describe("claimKey — non-match cases (Requirement 6, trust-first)", () => {
  it('"15%" vs "15% with ISIC" are DIFFERENT claims (credential differs)', () => {
    const plain = normalizeText("15% off")!;
    const isic = normalizeText("15% off with ISIC")!;
    expect(isic.credentialType).toBe("ISIC");
    expect(claimKey(BIZ, plain)).not.toBe(claimKey(BIZ, isic));
  });

  it("percent vs currency are DIFFERENT claims", () => {
    const pct: NormalizedClaim = {
      discountType: "PERCENT",
      discountValue: 15,
      currency: null,
      credentialType: "PHYSICAL_STUDENT_ID",
    };
    const fixed: NormalizedClaim = {
      discountType: "FIXED",
      discountValue: 15,
      currency: "USD",
      credentialType: "PHYSICAL_STUDENT_ID",
    };
    expect(claimKey(BIZ, pct)).not.toBe(claimKey(BIZ, fixed));
  });

  it("different businesses never share a claimKey", () => {
    const c = normalizeText("15% off")!;
    expect(claimKey("biz-A", c)).not.toBe(claimKey("biz-B", c));
  });

  it("different percent values are different claims", () => {
    expect(claimKey(BIZ, normalizeText("15% off")!)).not.toBe(
      claimKey(BIZ, normalizeText("10% off")!),
    );
  });
});

describe("normalizeText — money and special price", () => {
  it('"€8" student price -> SPECIAL_PRICE 8 EUR', () => {
    const c = normalizeText("student price €8")!;
    expect(c.discountType).toBe("SPECIAL_PRICE");
    expect(c.discountValue).toBe(8);
    expect(c.currency).toBe("EUR");
  });

  it('"$5 off" -> FIXED 5 USD', () => {
    const c = normalizeText("$5 off for students")!;
    expect(c.discountType).toBe("FIXED");
    expect(c.discountValue).toBe(5);
    expect(c.currency).toBe("USD");
  });

  it('"120 CZK" ISO code -> amount + CZK', () => {
    const m = detectMoney("students: 120 CZK");
    expect(m).toEqual({ amount: 120, currency: "CZK" });
  });
});

describe("normalizeText — free and none", () => {
  it('"free entry for students" -> FREE', () => {
    expect(normalizeText("free entry for students")!.discountType).toBe("FREE");
  });

  it('"no student discount" -> NONE (not misread as a student credential match)', () => {
    const c = normalizeText("no student discount here")!;
    expect(c.discountType).toBe("NONE");
  });

  it('"they didn\'t work" negative report -> NONE', () => {
    expect(normalizeText("the discount didnt work")!.discountType).toBe("NONE");
  });

  it("empty / unparseable text -> null (fail toward not-a-claim)", () => {
    expect(normalizeText("")).toBeNull();
    expect(normalizeText("   ")).toBeNull();
    expect(normalizeText("hello there")).toBeNull();
  });
});

describe("detectCredential", () => {
  it("detects specific programs", () => {
    expect(detectCredential("show your ISIC")).toBe("ISIC");
    expect(detectCredential("via UNiDAYS")).toBe("UNIDAYS");
    expect(detectCredential("Student Beans code")).toBe("STUDENT_BEANS");
    expect(detectCredential("use your .edu email")).toBe("EDU_EMAIL");
    expect(detectCredential("with a college card")).toBe("PHYSICAL_STUDENT_ID");
    expect(detectCredential("any university id works")).toBe("ANY_UNIVERSITY_ID");
  });

  it("defaults a bare student mention to PHYSICAL_STUDENT_ID, else OTHER", () => {
    expect(detectCredential("student discount")).toBe("PHYSICAL_STUDENT_ID");
    expect(detectCredential("loyalty program")).toBe("OTHER");
  });
});

describe("valueBucket", () => {
  it("formats each discount type distinctly", () => {
    expect(
      valueBucket({ discountType: "PERCENT", discountValue: 15, currency: null, credentialType: "OTHER" }),
    ).toBe("P:15");
    expect(
      valueBucket({ discountType: "FIXED", discountValue: 5, currency: "usd", credentialType: "OTHER" }),
    ).toBe("F:USD:5.00");
    expect(
      valueBucket({ discountType: "SPECIAL_PRICE", discountValue: 8, currency: "EUR", credentialType: "OTHER" }),
    ).toBe("S:EUR:8.00");
    expect(
      valueBucket({ discountType: "FREE", discountValue: null, currency: null, credentialType: "OTHER" }),
    ).toBe("FREE");
    expect(
      valueBucket({ discountType: "NONE", discountValue: null, currency: null, credentialType: "OTHER" }),
    ).toBe("NONE");
  });
});
