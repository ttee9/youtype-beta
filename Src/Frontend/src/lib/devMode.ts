// Shared with src/app/admin/page.tsx, which is where this gets set.
// Dev mode has no separate on/off flag — having a saved admin token IS dev
// mode. That's the only state that matters, since the backend enforces the
// token on every privileged request regardless of what the client thinks.
export const ADMIN_TOKEN_STORAGE_KEY = "youtype_admin_token";
