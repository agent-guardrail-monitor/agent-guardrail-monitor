# Security model

- Instance tokens are returned once and only SHA-256 hashes are stored.
- Every persistent record is scoped by `account_id`.
- Project references use composite account/project foreign keys to prevent cross-account project attachment.
- The server accepts only the canonical 59 blocking rules.
- Unknown rule IDs never become active rules.
- Semantic blocking requires both evidence and the configured confidence threshold.
- Destructive execution remains subject to the host platform's permissions and authorization.
- Full conversation bodies and provider credentials are not required by the core blocker.
- `INSTALL_SECRET` and `DATABASE_URL` must be supplied as runtime secrets and never committed.
