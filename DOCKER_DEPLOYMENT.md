# Docker Deployment Guide - afilminabox

## 🐳 Production-Ready Docker Setup

This application is containerized with Docker and uses Valkey (Redis fork) for distributed state management, making it horizontally scalable.

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Nginx     │────▶│    App      │────▶│   Valkey    │
│   (Proxy)   │     │  (Node.js)  │     │   (Redis)   │
└─────────────┘     └─────────────┘     └─────────────┘
   Port 80/443         Port 8080           Port 6379
```

## Quick Start

### 1. Clone Repository
```bash
git clone git@github.com:RobinMcM/afilminabox.git
cd afilminabox
```

### 2. Configure Environment
```bash
cp .env.example .env
# Edit .env and set your own values
```

### 3. Build and Run
```bash
# Build and start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Check status
docker-compose ps
```

### 4. Access Application
- **Frontend**: http://localhost (via Nginx)
- **Direct API**: http://localhost:8080
- **Health Check**: http://localhost/health

## Services

### 1. Valkey (Redis)
- **Image**: valkey/valkey:7.2-alpine
- **Port**: 6379
- **Purpose**: Session state, camera connections, distributed state
- **Persistence**: Volume-backed with AOF (Append-Only File)

### 2. Application
- **Build**: Multi-stage Dockerfile
- **Port**: 8080
- **Features**:
  - Express API server
  - WebSocket signaling
  - Serves React frontend
  - Health checks

### 3. Nginx (Reverse Proxy)
- **Image**: nginx:alpine
- **Ports**: 80 (HTTP), 443 (HTTPS)
- **Features**:
  - WebSocket proxy support
  - Static file caching
  - SSL/TLS termination ready

## Configuration

### Environment Variables

Create `.env` file from `.env.example`:

```bash
# Valkey (Redis) Configuration
VALKEY_PASSWORD=your_secure_password_here
VALKEY_HOST=valkey
VALKEY_PORT=6379

# Application Configuration
NODE_ENV=production
PORT=8080

# Session Configuration
SESSION_SECRET=your_secure_session_secret_here
```

### SSL/TLS Configuration

1. Place SSL certificates in `./ssl/` directory:
   - `cert.pem` - SSL certificate
   - `key.pem` - Private key

2. Uncomment HTTPS section in `nginx.conf`

3. Restart nginx:
   ```bash
   docker-compose restart nginx
   ```

## Development Mode

Run with hot reload for development:

```bash
# Uncomment volume mounts in docker-compose.yml
# Then restart
docker-compose up -d

# Or run locally without Docker
npm install
npm run dev
```

## Production Deployment

### DigitalOcean Droplet

1. **Create Droplet** (Ubuntu 22.04, 2GB+ RAM)

2. **Install Docker & Docker Compose**:
```bash
# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Install Docker Compose
sudo apt install docker-compose-plugin
```

3. **Clone and Configure**:
```bash
git clone git@github.com:RobinMcM/afilminabox.git
cd afilminabox
cp .env.example .env
nano .env  # Edit with your values
```

4. **Deploy**:
```bash
docker-compose up -d
```

5. **Configure Firewall**:
```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

6. **Setup Auto-restart**:
```bash
# Docker containers are already set to restart unless-stopped
# Verify with:
docker-compose ps
```

### Monitoring

```bash
# View all logs
docker-compose logs -f

# View specific service
docker-compose logs -f app
docker-compose logs -f valkey

# Check health
curl http://localhost/health
```

### Scaling

Scale the application horizontally:

```bash
# Run multiple app instances
docker-compose up -d --scale app=3

# Nginx will load balance automatically
```

## Backup & Restore

### Backup Valkey Data

```bash
# Backup
docker-compose exec valkey valkey-cli --raw BGSAVE
docker cp afilminabox-valkey:/data/dump.rdb ./backup-$(date +%Y%m%d).rdb

# Or backup entire volume
docker run --rm -v afilminabox_valkey-data:/data -v $(pwd):/backup alpine tar czf /backup/valkey-backup.tar.gz -C /data .
```

### Restore Valkey Data

```bash
# Stop valkey
docker-compose stop valkey

# Restore backup
docker run --rm -v afilminabox_valkey-data:/data -v $(pwd):/backup alpine tar xzf /backup/valkey-backup.tar.gz -C /data

# Start valkey
docker-compose start valkey
```

## Maintenance

### Update Application

```bash
# Pull latest code
git pull origin main

# Rebuild and restart
docker-compose up -d --build

# Remove old images
docker image prune -f
```

### Clean Up

```bash
# Stop all services
docker-compose down

# Remove volumes (WARNING: deletes all data)
docker-compose down -v

# Remove all images
docker-compose down --rmi all
```

## Troubleshooting

### Check Container Status
```bash
docker-compose ps
docker-compose logs app
```

### Valkey Connection Issues
```bash
# Test Valkey connection
docker-compose exec valkey valkey-cli ping
# Should return: PONG

# Check password
docker-compose exec valkey valkey-cli -a your_password ping
```

### WebSocket Not Working
1. Check nginx configuration for WebSocket headers
2. Verify firewall allows WebSocket connections
3. Check browser console for errors

### Application Not Starting
```bash
# Check logs
docker-compose logs app

# Verify environment variables
docker-compose exec app env | grep VALKEY
```

## Performance Tuning

### Valkey Optimization

Edit `docker-compose.yml` to add:
```yaml
services:
  valkey:
    command: >
      valkey-server
      --appendonly yes
      --requirepass ${VALKEY_PASSWORD}
      --maxmemory 256mb
      --maxmemory-policy allkeys-lru
```

### Application Optimization

- Increase Node.js memory: `NODE_OPTIONS=--max-old-space-size=2048`
- Enable clustering for multi-core usage
- Use PM2 inside container for better process management

## Security Best Practices

1. **Change default passwords** in `.env`
2. **Use SSL/TLS** for production
3. **Restrict Valkey access** to internal network only
4. **Regular updates**: Keep Docker images updated
5. **Monitor logs** for suspicious activity
6. **Backup regularly**: Automate Valkey backups

## Support

For issues or questions:
- Check logs: `docker-compose logs -f`
- Health check: `curl http://localhost/health`
- GitHub Issues: https://github.com/RobinMcM/afilminabox/issues
