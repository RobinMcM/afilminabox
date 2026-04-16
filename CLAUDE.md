# aFilmInABox

Multi-camera management platform for film production sets.
Connect iPhone cameras via QR code, stream via WebRTC, manage recordings.
Deployed at `afilminabox.com`.

## ⚠️ Migration Notice

This service is being migrated from Vite + Express to **Next.js**.
The current Vite stack has known issues with SuperTokens auth integration.
New features will be built on the Next.js stack only.

## What It Does

- Connect up to 3 iPhone cameras by scanning QR codes
- Real-time WebRTC video streaming from iPhones to browser dashboard
- Start/stop recording per camera independently
- Session management with Film GUID and Production Company GUID
- Video gallery and timeline view
- PWA — installable on mobile and desktop

## Architecture

```
iPhone (camera)
  ↓ scan QR code
WebSocket server ← signalling →  Browser dashboard
       ↓                               ↓
  WebRTC P2P stream ──────────→  Live camera feed
                                       ↓
                               media-handler (video processing)
```

## Auth

Users must register to access camera management.
Auth via SuperTokens shared core at `auth.rapidmvp.io`.

## Current Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Vite (migrating to Next.js) |
| Backend | Node.js + Express + WebSocket |
| State | Valkey |
| Auth | SuperTokens (via auth.rapidmvp.io) |
| Deployment | Docker + Nginx |

## Quick Start (Development)

```bash
npm install
npm run dev
```

- Frontend: `http://localhost:5173`
- Backend: `http://YOUR_IP:8080`

## Production (Docker)

```bash
cp .env.example .env
# edit .env
docker compose up -d
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Liveness check |
| GET | `/api/session` | Current session metadata |
| POST | `/api/session` | Update session metadata |
| GET | `/api/qr/:cameraId` | QR code for camera 1/2/3 |
| GET | `/api/cameras` | All camera statuses |
| WS | `/` | WebRTC signalling |

## How to Connect a Camera

1. Open the dashboard in a browser
2. Each camera slot shows a QR code
3. Scan QR code with iPhone camera
4. iPhone connects automatically via WebSocket
5. Live feed appears in the dashboard
6. Use Start/Stop Recording per camera

## Planned: Next.js Migration

The migration to Next.js will:
- Fix the SuperTokens integration
- Align with MovieShakerV2 and chatbot architecture
- Maintain all existing camera management features
- Add proper registration and user management flow

## Related Services

- **media-handler** (`media.rapidmvp.io`) — video file processing
- **auth.rapidmvp.io** — shared authentication
