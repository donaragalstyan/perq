---
inclusion: always
---

# perq — Security, Privacy, and Abuse Resistance

Treat privacy and abuse resistance as architectural requirements, not afterthoughts.

## SSRF — the highest-priority risk

perq fetches remote pages (AI extraction now, re-verification later). Arbitrary
user-supplied URLs are an SSRF vector. Mandatory controls on every server-side fetch:

- **Domain allowlist**. Do not fetch a domain that is not explicitly allowed.
- **Block private / link-local / loopback ranges** (10/8, 172.16/12, 192.168/16,
  127/8, 169.254/16, ::1, fc00::/7, etc.) after DNS resolution.
- **Disallow redirects to internal addresses**; re-validate the target after each hop.
- **Enforce timeouts and a max response size**.
- Never let a community submission trigger an automatic outbound fetch of a
  user-provided URL.

## Authorization boundaries

- A user may only read/update **their own** profile and credentials.
- Community endpoints may create reports but **may not** set `verificationStatus`
  directly. State transitions happen only via the deterministic state machine or admin.
- Only admin/privileged flows may force transitions (e.g., `REJECTED`, manual
  `OFFICIALLY_VERIFIED` after reviewing evidence).

## Abuse resistance

- **One confirmation per account per claim**: enforce `UNIQUE(reporterUserId, claimKey)`.
- Require **real accounts** (verified email via Cognito) before reports count toward
  quorum.
- **Rate limit** submissions and extraction requests per account and per IP.
- Admin **REJECTED** path for spam / malicious submissions.
- Known limitation (document it, don't hide it): 3 colluding accounts can currently
  fake community quorum. Reputation/trust scoring is the post-MVP mitigation.

## Privacy — minimize by default

- **User location is ephemeral**: use the request's map center / user point to run the
  query; do not persist a location history.
- **Never expose** a user's university or identity through public discount data. Show
  aggregate counts ("confirmed by 4 students"), never who.
- **Reporter identity** is used only for uniqueness; never returned by a public API.
- **Self-asserted credentials** in the MVP: do not collect ID scans or sensitive proof.
- No invasive tracking.

## Evidence and uploads (when they ship)

- Store uploaded evidence in a **private** S3 bucket; never public-read.
- Validate type and size; moderate before display.

## Secrets

- No secrets in the repo. Use environment variables / AWS parameter store / Cognito.
- Do not echo secret values in logs or responses.
