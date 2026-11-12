# First visit and empty workspaces

New regular accounts start with no knowledge bases, PDFs or images. Customer Support and Legal Assistant are admin-only. A connected empty workspace enables knowledge-base creation; upload remains disabled until a base is selected.

The welcome modal matches the existing dark blue cards and explains **New knowledge base → Upload & process → Ask / Search**. Its primary action acknowledges the guide and opens the existing creation form. Close, Escape and **I'll explore first** acknowledge it without creating anything. Save failures show an inline retry message.

The authenticated backend stores completion on the account in Supabase Auth metadata, so dismissal survives reloads and browser/device changes. There is no shared browser-only completion flag. Admin and users with existing custom bases are excluded. Session changes close the modal and discard late actions.

The build includes `onboarding.js`. Its tests cover eligibility, completion, retry, dismissal and account changes. The original workspace SQL migration remains required; this follow-up needs no extra SQL or environment configuration. Deploy frontend and backend together.
