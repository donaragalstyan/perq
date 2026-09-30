/**
 * Integration tests for auth provisioning, profile, and credentials (Requirements 3, 4, 5).
 * Requires local perq-db. No live Cognito — provisioning takes AuthClaims directly.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { AuthClaims } from "../src/auth/claims.js";
import {
  canContributeCommunityConfirmation,
  provisionUser,
} from "../src/services/users.js";
import { getProfile, updateProfile, ValidationError } from "../src/services/profile.js";
import {
  addCredential,
  listCredentials,
  removeCredential,
} from "../src/services/credentials.js";
import { closeDb, resetDb, testPool } from "./helpers/db.js";

const claims = (over: Partial<AuthClaims> = {}): AuthClaims => ({
  sub: "cognito-sub-1",
  email: "student@uw.edu",
  emailVerified: true,
  ...over,
});

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await closeDb();
});

describe("provisionUser", () => {
  it("creates a user on first sight and is idempotent by sub", async () => {
    const a = await provisionUser(testPool, claims());
    const b = await provisionUser(testPool, claims());
    expect(a.id).toBe(b.id); // same sub -> same user
    const { rows } = await testPool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM users`,
    );
    expect(Number(rows[0]!.n)).toBe(1);
  });

  it("refreshes emailVerified on re-provision", async () => {
    const first = await provisionUser(testPool, claims({ emailVerified: false }));
    expect(first.emailVerified).toBe(false);
    const second = await provisionUser(testPool, claims({ emailVerified: true }));
    expect(second.emailVerified).toBe(true);
    expect(second.id).toBe(first.id);
  });
});

describe("canContributeCommunityConfirmation", () => {
  it("requires a verified email", () => {
    expect(canContributeCommunityConfirmation({ emailVerified: true })).toBe(true);
    expect(canContributeCommunityConfirmation({ emailVerified: false })).toBe(false);
  });
});

describe("profile (owner-scoped)", () => {
  it("reads and updates the owner's own profile", async () => {
    const user = await provisionUser(testPool, claims());
    const updated = await updateProfile(testPool, user.id, {
      university: "University of Washington",
      universityCountry: "us",
    });
    expect(updated.university).toBe("University of Washington");
    expect(updated.universityCountry).toBe("US"); // upper-cased
    const read = await getProfile(testPool, user.id);
    expect(read?.university).toBe("University of Washington");
  });

  it("rejects an invalid country code", async () => {
    const user = await provisionUser(testPool, claims());
    await expect(
      updateProfile(testPool, user.id, { universityCountry: "USA" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("cannot affect another user (owner-scoped by construction)", async () => {
    const a = await provisionUser(testPool, claims({ sub: "a", email: "a@x.edu" }));
    const b = await provisionUser(testPool, claims({ sub: "b", email: "b@x.edu" }));
    await updateProfile(testPool, a.id, { university: "A Univ" });
    // Updating a's profile leaves b untouched.
    expect((await getProfile(testPool, b.id))?.university).toBeNull();
  });
});

describe("credentials (self-asserted, owner-scoped)", () => {
  it("adds (idempotent), lists, and removes credentials", async () => {
    const user = await provisionUser(testPool, claims());
    await addCredential(testPool, user.id, "PHYSICAL_STUDENT_ID");
    await addCredential(testPool, user.id, "PHYSICAL_STUDENT_ID"); // idempotent
    await addCredential(testPool, user.id, "ISIC");
    expect(await listCredentials(testPool, user.id)).toEqual(["ISIC", "PHYSICAL_STUDENT_ID"]);

    await removeCredential(testPool, user.id, "ISIC");
    expect(await listCredentials(testPool, user.id)).toEqual(["PHYSICAL_STUDENT_ID"]);
  });

  it("stores no proof columns (schema has only the type)", async () => {
    const user = await provisionUser(testPool, claims());
    await addCredential(testPool, user.id, "EDU_EMAIL");
    const { rows } = await testPool.query(
      `SELECT * FROM user_credentials WHERE "userId" = $1`,
      [user.id],
    );
    const cols = Object.keys(rows[0]!);
    // No proof/scan/photo/document columns exist.
    for (const forbidden of ["proof", "scan", "photo", "document", "image"]) {
      expect(cols.some((c) => c.toLowerCase().includes(forbidden))).toBe(false);
    }
  });
});
