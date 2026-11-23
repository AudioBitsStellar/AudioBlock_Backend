# Copyright Takedown Policy

AudioBlock responds to notices of copyright infringement. This page explains how to send one, and
how a notice is handled. It covers #986.

The designated agent's current details are published by the API at `GET /api/takedown/policy`.
That response includes `agentRegistration`. It reads `recorded` only once the agent is configured.

## 1. Send a notice

Send a notice in either of these ways:

- **Through the platform.** Sign in and submit a request to `POST /api/takedown/request` with
  `songId`, `reason` (`copyright`, `trademark` or `other`), and optional `description` and
  `evidenceUrl`. The request is recorded with status `pending`.
- **By email** to the designated agent listed at `GET /api/takedown/policy`.

A notice must contain the following, as required for DMCA notices (17 U.S.C. § 512(c)(3)):

1. Identification of the copyrighted work you say has been infringed.
2. Identification of the material on AudioBlock that is infringing, with enough detail to find it.
   The song ID or URL is sufficient.
3. Your name, postal address, telephone number and email address.
4. A statement that you have a good-faith belief the use is not authorized by the copyright
   owner, its agent, or the law.
5. A statement, under penalty of perjury, that the information in the notice is accurate and that
   you are the copyright owner or are authorized to act for the owner.
6. Your physical or electronic signature.

A notice that leaves out these elements may not be actionable.

## 2. Designated agent

The DMCA designated agent is registered with the U.S. Copyright Office. Its details are published
at `GET /api/takedown/policy`. The registration must be renewed every three years, as the Copyright
Office requires.

## 3. What happens after a notice

1. An administrator reviews the request. It is either **approved** or **rejected**.
2. On **approve**, the song is temporarily unpublished. Streaming returns 404 and the song is
   marked `flagged` with reason `takedown:...`. This step is **reversible**.
3. On **reject**, the request is closed as rejected and the song is not changed.
4. On **reverse**, an approved takedown is undone and the song returns to the state it was in
   before the takedown. Only approved takedowns can be reversed.

Approvals and rejections are written to the audit log.

## 4. Counter-notices

A user whose content was taken down may send a counter-notice to the designated agent. The API does
not yet accept counter-notices directly. Send them by email to the designated agent. Counter-notices
are handled under the DMCA's counter-notice procedure.

## 5. Repeat infringers

This section is intentionally blank until the operator defines the repeat-infringer procedure.

---

## For maintainers

Before this page is treated as final:

- [ ] Set `DMCA_AGENT_NAME`, `DMCA_AGENT_EMAIL`, `DMCA_AGENT_ADDRESS`,
      `DMCA_AGENT_REGISTRATION_NUMBER` and, if known, `DMCA_AGENT_REGISTERED_AT`. Confirm that
      `GET /api/takedown/policy` returns `agentRegistration: "recorded"`.
- [ ] Register the designated agent in the Copyright Office's DMCA designated agent directory
      (dmca.copyright.gov). The code cannot do this for you, and until it is done the designation
      is not in effect.
- [ ] Define the counter-notice intake and the repeat-infringer procedure (section 4 and 5).
- [ ] Have counsel review this page before publication.
