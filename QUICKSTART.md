# Quick Start Guide - afilminabox

## 🚀 5-Minute Production Deployment

### Option 1: Docker (Recommended)

Perfect for production, scalable, and easy to manage.

```bash
# 1. Clone
git clone git@github.com:RobinMcM/afilminabox.git
cd afilminabox

# 2. Configure
cp .env.example .env
nano .env  # Set your VALKEY_PASSWORD

# 3. Deploy
docker-compose up -d

# 4. Access
# Open: http://your-server-ip
```

**That's it!** ✅

### Option 2: Direct Installation

For development or simple deployments.

```bash
# 1. Clone
git clone git@github.com:RobinMcM/afilminabox.git
cd afilminabox

# 2. Install
npm install

# 3. Build
npm run build

# 4. Run
node server/server.js

# 5. Access
# Open: http://your-server-ip:8080
```

## 📱 Connect Cameras

1. Open the web interface
2. See 3 QR codes on the dashboard
3. Scan QR code with iPhone camera app
4. Camera connects automatically
5. Video stream appears in real-time

## 🎬 Start Recording

1. Wait for camera to connect (green status)
2. Click "Start Recording" button
3. Camera begins recording
4. Click "Stop Recording" when done

## 🔧 Configuration

### Environment Variables

Edit `.env`:

```bash
# Valkey password (change this!)
VALKEY_PASSWORD=your_secure_password

# Optional: Custom port
PORT=8080
```

### Session GUIDs

Update Film and Production GUIDs in the web interface:

1. Expand "Production Setup"
2. Enter Film GUID
3. Enter Production Company GUID
4. Click "Update Session & Regenerate QR Codes"

## 📊 Monitoring

### Check Status

```bash
# Docker
docker-compose ps
docker-compose logs -f

# Health check
curl http://localhost/health
```

### View Logs

```bash
# All services
docker-compose logs -f

# Just app
docker-compose logs -f app

# Just Valkey
docker-compose logs -f valkey
```

## 🛠️ Common Commands

### Docker

```bash
# Start
docker-compose up -d

# Stop
docker-compose down

# Restart
docker-compose restart

# Rebuild
docker-compose up -d --build

# View logs
docker-compose logs -f
```

### Direct Installation

```bash
# Development mode
npm run dev

# Production build
npm run build
node server/server.js

# With PM2
pm2 start server/server.js --name afilminabox
pm2 logs afilminabox
```

## 🌐 Accessing from Network

### Find Your Server IP

```bash
# Linux/Mac
hostname -I

# Or check the server startup logs
# Server displays: "Server running on: http://YOUR_IP:8080"
```

### Connect Devices

1. Ensure devices are on same network
2. Open `http://YOUR_SERVER_IP` in browser
3. Scan QR codes with iPhones

## 🔒 Security Checklist

Before production:

- ✅ Change `VALKEY_PASSWORD` in `.env`
- ✅ Set strong `SESSION_SECRET`
- ✅ Configure SSL/TLS (see DOCKER_DEPLOYMENT.md)
- ✅ Set up firewall (allow ports 80, 443)
- ✅ Keep Docker images updated
- ✅ Regular Valkey backups

## 🐛 Troubleshooting

### Camera Won't Connect

1. Check devices on same network
2. Verify server IP is correct
3. Check firewall allows port 8080
4. Regenerate QR codes

### Docker Won't Start

```bash
# Check logs
docker-compose logs

# Verify ports available
sudo lsof -i :80
sudo lsof -i :8080

# Clean and restart
docker-compose down
docker-compose up -d
```

### Valkey Connection Error

```bash
# Test Valkey
docker-compose exec valkey valkey-cli ping

# Check password
docker-compose exec valkey valkey-cli -a YOUR_PASSWORD ping
```

## 📚 Next Steps

- **Full Documentation**: See [README.md](README.md)
- **Docker Guide**: See [DOCKER_DEPLOYMENT.md](DOCKER_DEPLOYMENT.md)
- **Issues**: https://github.com/RobinMcM/afilminabox/issues

## 💡 Tips

1. **Collapsible Setup**: Click "Production Setup" header to hide/show configuration
2. **Status Indicators**: 
   - Gray = Offline
   - Cyan = Connected
   - Magenta = Recording
3. **Mobile Friendly**: Works on tablets and phones too
4. **PWA**: Add to home screen for standalone app

---

**Need Help?** Check logs first: `docker-compose logs -f`
