# CLAUDE.md — afilminabox

## Service Identity
Camera management service for the FilmInABox platform.
Part of the RapidMVP app family — uses shared auth via `auth.rapidmvp.io`.

## Rules — Read Before Every Task

### Scope
- Only modify the file(s) explicitly named in the request
- Do not modify auth integration without explicit confirmation
- Auth pattern follows RapidMVP standard:
  `afilminabox.com/auth/*` → `auth.rapidmvp.io/auth/*`

### Git
- Do NOT run any git commands
- Developer handles all git operations

### Running the Service
- Do NOT start, stop, or restart any service automatically
- Do NOT run build commands without explicit confirmation

### Auth Boundaries
- Each app owns its own first-party session
- Do NOT attempt to share cookies with other RapidMVP apps
- SSO via redirect-based callback only

## If Uncertain
Ask before proceeding. Do not infer intent and act.
