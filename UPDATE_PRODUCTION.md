# Production Update Guide

## Quick Update Steps

When you need to deploy updates to the production server:

### On Production Server (afilminabox-application-docker)

```bash
# 1. Navigate to project
cd /root/afilminabox

# 2. Pull latest changes
git pull origin main

# 3. Rebuild and restart containers
docker compose up -d --build

# 4. Check logs
docker compose logs -f

# 5. Verify deployment
curl https://afilminabox.com/health
```

## What Changed in This Update

### Domain-Based Configuration
- **Before**: Auto-detected local IP address
- **After**: Uses `afilminabox.com` domain name

### QR Code Updates
- Now includes **HTTPS** protocol information
- Includes **WSS** (secure WebSocket) endpoint
- iPhone app will connect via secure protocols

### Environment Variables
Added `SERVER_DOMAIN` to support custom domains:
```bash
# In .env or docker-compose.yml
SERVER_DOMAIN=afilminabox.com
```

## Testing After Update

```bash
# 1. Check all containers are healthy
docker compose ps

# 2. Test API
curl https://afilminabox.com/api/session

# 3. Test WebSocket health
curl https://afilminabox.com/health

# 4. Generate test QR code
curl https://afilminabox.com/api/qr/1
```

## New QR Code Format

The QR codes now include:
```json
{
  "serverIP": "afilminabox.com",
  "port": 443,
  "protocol": "https",
  "wsProtocol": "wss",
  "filmGuid": "...",
  "productionCompanyGuid": "...",
  "cameraId": 1,
  "cameraName": "Camera 1",
  "timestamp": "..."
}
```

## Rollback (if needed)

If something goes wrong:

```bash
cd /root/afilminabox
git log --oneline -5  # See recent commits
git checkout <previous-commit-hash>
docker compose up -d --build
```

## Troubleshooting

### If QR codes still show IP address
Check environment variable:
```bash
docker compose exec app env | grep SERVER_DOMAIN
```

Should show: `SERVER_DOMAIN=afilminabox.com`

### If WebSocket connection fails
- Ensure nginx is configured for WSS
- Check SSL certificates are valid
- Verify firewall allows port 443

### View detailed logs
```bash
docker compose logs app --tail 100
docker compose logs nginx --tail 100
docker compose logs valkey --tail 100
```

## Next Steps

Once deployed, the iPhone app can now:
- Connect via secure WebSocket (WSS)
- Use HTTPS for API calls
- Properly handle SSL certificates
- Work reliably in production environment
