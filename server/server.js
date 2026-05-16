import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import QRCode from 'qrcode';
import { v4 as uuidv4 } from 'uuid';
import { networkInterfaces } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { timingSafeEqual } from 'crypto';
import Redis from 'ioredis';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/signaling' });

const PORT = process.env.PORT || 8080;

// Initialize Valkey (Redis) client
const valkey = new Redis({
  host: process.env.VALKEY_HOST || 'localhost',
  port: process.env.VALKEY_PORT || 6379,
  password: process.env.VALKEY_PASSWORD || undefined,
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  }
});

valkey.on('connect', () => {
  console.log('✅ Connected to Valkey');
});

valkey.on('error', (err) => {
  console.error('❌ Valkey connection error:', err);
});

// Server domain/IP configuration
// Use environment variable or default to domain name for production
// Falls back to local IP detection for development
const SERVER_DOMAIN = process.env.SERVER_DOMAIN || process.env.SERVER_IP || 'afilminabox.com';

// Get local network IP (fallback for development)
function getLocalIP() {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      // Skip internal (loopback) and non-IPv4 addresses
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

// Use domain in production, local IP in development
const SERVER_IP = process.env.NODE_ENV === 'production' ? SERVER_DOMAIN : (process.env.SERVER_DOMAIN || getLocalIP());

// Initialize session in Valkey if not exists
async function initializeSession() {
  const sessionExists = await valkey.exists('session:filmGuid');
  if (!sessionExists) {
    await valkey.set('session:filmGuid', uuidv4());
    await valkey.set('session:productionCompanyGuid', uuidv4());
    console.log('🎬 Initialized new session in Valkey');
  }
}

const VALID_CAMERA_ROLES = new Set(['A_CAM', 'B_CAM', 'GIMBAL_CAM', 'BTS_CAM']);

// Camera state management in Valkey
async function getCameraState(cameraId) {
  const state = await valkey.hgetall(`camera:${cameraId}`);
  const role = await valkey.get(`camera:${cameraId}:role`);
  return {
    connected: state.connected === 'true',
    metadata: state.metadata ? JSON.parse(state.metadata) : {},
    role: role || null
  };
}

async function setCameraState(cameraId, connected, metadata = {}) {
  await valkey.hmset(`camera:${cameraId}`, {
    connected: connected.toString(),
    metadata: JSON.stringify(metadata),
    lastUpdate: Date.now()
  });
}

// ===================================
// User Session Management
// ===================================

const SESSION_COOKIE = 'afiab_session';
const SESSION_TTL = 86400; // 24 hours

function parseCookies(req) {
  const cookies = {};
  const header = req.headers.cookie || '';
  header.split(';').forEach(part => {
    const eqIdx = part.indexOf('=');
    if (eqIdx > 0) {
      cookies[part.slice(0, eqIdx).trim()] = part.slice(eqIdx + 1).trim();
    }
  });
  return cookies;
}

async function getUserSession(req) {
  const cookies = parseCookies(req);
  const sessionId = cookies[SESSION_COOKIE];
  if (!sessionId) return null;
  try {
    const data = await valkey.hgetall(`user:session:${sessionId}`);
    if (!data || !data.userId) return null;
    return { ...data, sessionId };
  } catch {
    return null;
  }
}

async function requireSession(req, res, next) {
  const user = await getUserSession(req);
  if (!user) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }
  req.user = user;
  // Refresh lastSeenAt so stale session detection and operator visibility stay accurate
  valkey.hset(`user:session:${user.sessionId}`, 'lastSeenAt', new Date().toISOString()).catch(() => {});
  next();
}

async function requireProjectMatch(req, res, next) {
  try {
    const syncProd = await valkey.get('sync:production');
    if (syncProd) {
      const { projectId: syncedProjectId } = JSON.parse(syncProd);
      if (syncedProjectId && req.user.projectId !== syncedProjectId) {
        console.warn(`🚫 Project mismatch: session=${req.user.projectId} synced=${syncedProjectId} user=${req.user.userId}`);
        return res.status(403).json({
          success: false,
          error: 'Project mismatch — your session is for a different project. Re-launch from MovieShaker.',
        });
      }
    }
  } catch { /* Valkey failure is non-critical — allow through */ }
  next();
}

// Track WebSocket connections in memory (per instance)
const webClients = new Set();
const cameraClients = new Map(); // cameraId -> ws connection

// Middleware
app.use(express.json());

// CRITICAL: Set CSP headers BEFORE serving static files
app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; " +
    "connect-src 'self' wss: ws: https:; " +  // Allow all WebSocket and HTTPS connections
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src 'self' data: https://fonts.gstatic.com; " +
    "img-src 'self' data: https: blob:; " +
    "media-src 'self' blob: mediastream:; " +
    "worker-src 'self' blob:;"
  );
  next();
});

// Serve static files (CSP already set above)
app.use(express.static(path.join(__dirname, '../dist')));

// API Routes

// ===================================
// Auth — Launch token handshake
// ===================================

// GET /launch - Validate MovieShaker launch token, create session, redirect to dashboard
app.get('/launch', async (req, res) => {
  const { token, projectId } = req.query;
  if (!token || !projectId) {
    return res.status(400).send('Missing token or projectId');
  }

  const movieshakerBase = (process.env.MOVIESHAKER_BASE_URL || '').replace(/\/$/, '');
  const apiKey = process.env.MOVIESHAKER_API_KEY || '';
  if (!movieshakerBase || !apiKey) {
    return res.status(503).send('aFilmInABox is not configured for MovieShaker integration');
  }

  try {
    const resp = await fetch(`${movieshakerBase}/api/production/launch/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-API-Key': apiKey },
      body: JSON.stringify({ token, project_id: projectId }),
    });

    if (!resp.ok) {
      return res.status(401).send('Invalid or expired launch token');
    }

    const payload = await resp.json();
    if (!payload.success) {
      return res.status(401).send('Token validation failed');
    }

    // Confirm user is still a project member — token could be up to 5 min old
    try {
      const memberResp = await fetch(`${movieshakerBase}/api/production/member-check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Internal-API-Key': apiKey },
        body: JSON.stringify({ user_id: payload.userId, project_id: payload.projectId }),
      });
      if (memberResp.ok) {
        const memberData = await memberResp.json();
        if (!memberData.isMember) {
          console.warn(`🚫 Launch denied: ${payload.userId} is not a member of project ${payload.projectId}`);
          return res.status(403).send('Permission denied: user is not a member of this project');
        }
      }
      // If memberResp is not ok, proceed — token verify already confirmed access
    } catch (memberErr) {
      console.warn('⚠️ Member check error (proceeding):', memberErr.message);
    }

    const sessionId = uuidv4();
    const isProduction = process.env.NODE_ENV === 'production';

    // Pull director from sync:production if not in token payload
    let director = payload.director || '';
    if (!director) {
      try {
        const syncProd = await valkey.get('sync:production');
        if (syncProd) director = JSON.parse(syncProd).director || '';
      } catch { /* non-critical */ }
    }

    const now = new Date().toISOString();
    const sessionData = {
      userId: payload.userId,
      projectId: payload.projectId,
      projectName: payload.projectName || '',
      director,
      launchedBy: payload.userId,  // who generated the token; differs from userId when director launches for operator
      launchedAt: now,
      lastSeenAt: now,
    };
    if (payload.cameraRole) sessionData.cameraRole = payload.cameraRole;
    if (payload.operatorName) sessionData.operatorName = payload.operatorName;

    await valkey.hset(`user:session:${sessionId}`, sessionData);
    await valkey.expire(`user:session:${sessionId}`, SESSION_TTL);

    const cookieParts = [
      `${SESSION_COOKIE}=${sessionId}`,
      'HttpOnly',
      'SameSite=Lax',
      `Max-Age=${SESSION_TTL}`,
      'Path=/',
    ];
    if (isProduction) cookieParts.push('Secure');

    res.setHeader('Set-Cookie', cookieParts.join('; '));
    res.redirect('/');
  } catch (err) {
    console.error('❌ Launch token validation failed:', err);
    res.status(500).send('Authentication error');
  }
});

// GET /api/me - Return current authenticated user context
app.get('/api/me', requireSession, (req, res) => {
  res.json({
    success: true,
    user: {
      userId: req.user.userId,
      projectId: req.user.projectId,
      projectName: req.user.projectName || null,
      director: req.user.director || null,
      cameraRole: req.user.cameraRole || null,
      operatorName: req.user.operatorName || null,
      launchedBy: req.user.launchedBy || null,
      launchedAt: req.user.launchedAt || null,
      lastSeenAt: req.user.lastSeenAt || null,
    },
  });
});

// POST /api/session/logout - Clear session and cookie
app.post('/api/session/logout', async (req, res) => {
  const cookies = parseCookies(req);
  const sessionId = cookies[SESSION_COOKIE];
  if (sessionId) {
    await valkey.del(`user:session:${sessionId}`).catch(() => {});
  }
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Max-Age=0; Path=/`);
  res.json({ success: true });
});

// GET /api/session - Return current session metadata
app.get('/api/session', async (req, res) => {
  try {
    const filmGuid = await valkey.get('session:filmGuid');
    const productionCompanyGuid = await valkey.get('session:productionCompanyGuid');
    
    res.json({
      success: true,
      filmGuid,
      productionCompanyGuid
    });
  } catch (error) {
    console.error('❌ Error fetching session:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch session' });
  }
});

// POST /api/session - Update session metadata
app.post('/api/session', async (req, res) => {
  try {
    const { filmGuid, productionCompanyGuid } = req.body;
    
    if (filmGuid) await valkey.set('session:filmGuid', filmGuid);
    if (productionCompanyGuid) await valkey.set('session:productionCompanyGuid', productionCompanyGuid);
    
    const updatedFilmGuid = await valkey.get('session:filmGuid');
    const updatedProductionGuid = await valkey.get('session:productionCompanyGuid');
    
    console.log('✅ Session updated:', { filmGuid: updatedFilmGuid, productionCompanyGuid: updatedProductionGuid });
    
    res.json({
      success: true,
      filmGuid: updatedFilmGuid,
      productionCompanyGuid: updatedProductionGuid
    });
  } catch (error) {
    console.error('❌ Error updating session:', error);
    res.status(500).json({ success: false, error: 'Failed to update session' });
  }
});

// GET /api/qr/:cameraId - Generate QR code for camera
app.get('/api/qr/:cameraId', async (req, res) => {
  const cameraId = parseInt(req.params.cameraId);
  
  if (![1, 2, 3].includes(cameraId)) {
    return res.status(400).json({ success: false, error: 'Invalid camera ID' });
  }
  
  try {
    const filmGuid = await valkey.get('session:filmGuid');
    const productionCompanyGuid = await valkey.get('session:productionCompanyGuid');
    
    // Determine protocol based on environment
    const isProduction = process.env.NODE_ENV === 'production';
    const protocol = isProduction ? 'https' : 'http';
    const wsProtocol = isProduction ? 'wss' : 'ws';
    
    const connectionData = {
      serverIP: SERVER_IP,
      port: isProduction ? 443 : PORT, // Use 443 for HTTPS in production
      protocol: protocol,
      wsProtocol: wsProtocol,
      filmGuid,
      productionCompanyGuid,
      cameraId: cameraId,
      cameraName: `Camera ${cameraId}`,
      timestamp: new Date().toISOString()
    };
    
    const qrCode = await QRCode.toDataURL(JSON.stringify(connectionData), {
      width: 300,
      margin: 2,
      color: {
        dark: '#00fff2',
        light: '#0a0e27'
      }
    });
    
    res.json({
      success: true,
      qrCode: qrCode,
      connectionData: connectionData
    });
  } catch (error) {
    console.error('❌ QR code generation error:', error);
    res.status(500).json({ success: false, error: 'Failed to generate QR code' });
  }
});

// GET /api/cameras - Get status of all cameras
app.get('/api/cameras', async (req, res) => {
  try {
    const cameraStatus = {};
    
    for (let i = 1; i <= 3; i++) {
      const state = await getCameraState(i);
      cameraStatus[i] = state;
    }
    
    res.json({ success: true, cameras: cameraStatus });
  } catch (error) {
    console.error('❌ Error fetching cameras:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch cameras' });
  }
});

// ===================================
// Recording Management Endpoints
// ===================================

// GET /api/recordings - List all recordings
app.get('/api/recordings', async (req, res) => {
  try {
    // Get all recording keys from Valkey
    const keys = await valkey.keys('recording:*');
    const recordings = [];
    
    for (const key of keys) {
      const data = await valkey.hgetall(key);
      if (data && data.id) {
        recordings.push({
          id: data.id,
          filmGuid: data.filmGuid,
          productionCompanyGuid: data.productionCompanyGuid,
          cameraId: parseInt(data.cameraId),
          timestamp: data.timestamp,
          duration: parseFloat(data.duration || 0),
          fileSize: parseInt(data.fileSize || 0),
          filePath: data.filePath,
          thumbnailPath: data.thumbnailPath,
          status: data.status || 'raw'
        });
      }
    }
    
    // Sort by timestamp (newest first)
    recordings.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    res.json({ success: true, recordings });
  } catch (error) {
    console.error('❌ Error fetching recordings:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch recordings' });
  }
});

// GET /api/recordings/:id - Get single recording
app.get('/api/recordings/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const data = await valkey.hgetall(`recording:${id}`);
    
    if (!data || !data.id) {
      return res.status(404).json({ success: false, error: 'Recording not found' });
    }
    
    res.json({
      success: true,
      recording: {
        id: data.id,
        filmGuid: data.filmGuid,
        productionCompanyGuid: data.productionCompanyGuid,
        cameraId: parseInt(data.cameraId),
        timestamp: data.timestamp,
        duration: parseFloat(data.duration || 0),
        fileSize: parseInt(data.fileSize || 0),
        filePath: data.filePath,
        thumbnailPath: data.thumbnailPath,
        status: data.status || 'raw'
      }
    });
  } catch (error) {
    console.error('❌ Error fetching recording:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch recording' });
  }
});

// GET /api/recordings/:id/thumbnail - Get recording thumbnail
app.get('/api/recordings/:id/thumbnail', async (req, res) => {
  try {
    const { id } = req.params;
    const data = await valkey.hgetall(`recording:${id}`);
    
    if (!data || !data.thumbnailPath) {
      return res.status(404).sendFile(path.join(__dirname, '../public/placeholder-thumbnail.jpg'));
    }
    
    res.sendFile(data.thumbnailPath);
  } catch (error) {
    console.error('❌ Error fetching thumbnail:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch thumbnail' });
  }
});

// GET /api/recordings/:id/download - Download recording
app.get('/api/recordings/:id/download', async (req, res) => {
  try {
    const { id } = req.params;
    const data = await valkey.hgetall(`recording:${id}`);
    
    if (!data || !data.filePath) {
      return res.status(404).json({ success: false, error: 'Recording not found' });
    }
    
    res.download(data.filePath, `recording-${id}.mp4`);
  } catch (error) {
    console.error('❌ Error downloading recording:', error);
    res.status(500).json({ success: false, error: 'Failed to download recording' });
  }
});

// POST /api/recordings/:id/process - Submit recording for processing
app.post('/api/recordings/:id/process', requireSession, async (req, res) => {
  try {
    const { id } = req.params;
    const { type } = req.body; // 'remove-background' or 'add-backdrop'
    
    const recordingData = await valkey.hgetall(`recording:${id}`);
    
    if (!recordingData || !recordingData.id) {
      return res.status(404).json({ success: false, error: 'Recording not found' });
    }
    
    // Create processing job
    const jobId = uuidv4();
    await valkey.hmset(`job:${jobId}`, {
      id: jobId,
      recordingId: id,
      type,
      status: 'queued',
      createdAt: new Date().toISOString()
    });
    
    // Update recording status
    await valkey.hset(`recording:${id}`, 'status', 'processing');
    
    console.log(`🎨 Processing job created: ${jobId} for recording ${id}`);
    
    // TODO: Send to media-handler API for actual processing
    
    res.json({ success: true, jobId, status: 'processing' });
  } catch (error) {
    console.error('❌ Error processing recording:', error);
    res.status(500).json({ success: false, error: 'Failed to process recording' });
  }
});

// DELETE /api/recordings/:id - Delete recording
app.delete('/api/recordings/:id', requireSession, async (req, res) => {
  try {
    const { id } = req.params;
    const data = await valkey.hgetall(`recording:${id}`);
    
    if (!data || !data.id) {
      return res.status(404).json({ success: false, error: 'Recording not found' });
    }
    
    // Delete file if exists
    if (data.filePath) {
      const fs = await import('fs/promises');
      try {
        await fs.unlink(data.filePath);
      } catch (err) {
        console.warn('⚠️ Could not delete file:', err.message);
      }
    }
    
    // Delete thumbnail if exists
    if (data.thumbnailPath) {
      const fs = await import('fs/promises');
      try {
        await fs.unlink(data.thumbnailPath);
      } catch (err) {
        console.warn('⚠️ Could not delete thumbnail:', err.message);
      }
    }
    
    // Delete from Valkey
    await valkey.del(`recording:${id}`);
    
    console.log(`🗑️ Deleted recording: ${id}`);
    
    res.json({ success: true, message: 'Recording deleted' });
  } catch (error) {
    console.error('❌ Error deleting recording:', error);
    res.status(500).json({ success: false, error: 'Failed to delete recording' });
  }
});

// ===================================
// Internal API key auth (sync routes)
// ===================================

function requireInternalKey(req, res, next) {
  const expected = process.env.INTERNAL_API_KEY || '';
  const provided = req.headers['x-internal-api-key'] || '';
  if (!expected || expected.length !== provided.length) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  if (!timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(provided, 'utf8'))) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  next();
}

// ===================================
// Production Sync Endpoints (MovieShaker → aFilmInABox)
// ===================================

// POST /api/sync/production — receive project identity from MovieShaker
app.post('/api/sync/production', requireInternalKey, async (req, res) => {
  try {
    const { projectId, name, director, syncedAt, callbackUrl } = req.body;
    if (!projectId) {
      return res.status(400).json({ success: false, error: 'projectId is required' });
    }

    const payload = JSON.stringify({ projectId, name: name || '', director: director || '', syncedAt: syncedAt || new Date().toISOString(), callbackUrl: callbackUrl || '' });
    await valkey.set('sync:production', payload);

    // Align session filmGuid with the MovieShaker project ID so QR codes carry the correct GUID
    await valkey.set('session:filmGuid', projectId);

    console.log(`🎬 Production synced: ${projectId} (${name})`);
    res.json({ success: true, projectId });
  } catch (error) {
    console.error('❌ Error syncing production:', error);
    res.status(500).json({ success: false, error: 'Failed to sync production' });
  }
});

// GET /api/sync/production — read back synced production (verification)
app.get('/api/sync/production', requireInternalKey, async (req, res) => {
  try {
    const raw = await valkey.get('sync:production');
    if (!raw) return res.json({ success: true, production: null });
    res.json({ success: true, production: JSON.parse(raw) });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to read production sync' });
  }
});

// POST /api/sync/scenes — receive scene list from MovieShaker (idempotent)
app.post('/api/sync/scenes', requireInternalKey, async (req, res) => {
  try {
    const { scenes } = req.body;
    if (!Array.isArray(scenes)) {
      return res.status(400).json({ success: false, error: 'scenes must be an array' });
    }

    await valkey.set('sync:scenes', JSON.stringify(scenes));

    console.log(`🎞️ Scenes synced: ${scenes.length} scenes`);
    res.json({ success: true, sceneCount: scenes.length });
  } catch (error) {
    console.error('❌ Error syncing scenes:', error);
    res.status(500).json({ success: false, error: 'Failed to sync scenes' });
  }
});

// GET /api/sync/scenes — read back synced scenes (verification)
app.get('/api/sync/scenes', requireInternalKey, async (req, res) => {
  try {
    const raw = await valkey.get('sync:scenes');
    if (!raw) return res.json({ success: true, scenes: [] });
    res.json({ success: true, scenes: JSON.parse(raw) });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to read scenes sync' });
  }
});

// POST /api/sync/shots — receive shot list from MovieShaker (idempotent)
app.post('/api/sync/shots', requireInternalKey, async (req, res) => {
  try {
    const { shots } = req.body;
    if (!Array.isArray(shots)) {
      return res.status(400).json({ success: false, error: 'shots must be an array' });
    }

    await valkey.set('sync:shots', JSON.stringify(shots));

    console.log(`🎯 Shots synced: ${shots.length} shots`);
    res.json({ success: true, shotCount: shots.length });
  } catch (error) {
    console.error('❌ Error syncing shots:', error);
    res.status(500).json({ success: false, error: 'Failed to sync shots' });
  }
});

// GET /api/sync/shots — read back synced shots (verification)
app.get('/api/sync/shots', requireInternalKey, async (req, res) => {
  try {
    const raw = await valkey.get('sync:shots');
    if (!raw) return res.json({ success: true, shots: [] });
    res.json({ success: true, shots: JSON.parse(raw) });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to read shots sync' });
  }
});

// POST /api/sync/cameras — batch assign camera roles from MovieShaker (idempotent)
app.post('/api/sync/cameras', requireInternalKey, async (req, res) => {
  try {
    const { cameras } = req.body;
    if (!Array.isArray(cameras)) {
      return res.status(400).json({ success: false, error: 'cameras must be an array' });
    }

    for (const cam of cameras) {
      const slot = parseInt(cam.slot);
      if (![1, 2, 3].includes(slot)) continue;
      if (cam.role && VALID_CAMERA_ROLES.has(cam.role)) {
        await valkey.set(`camera:${slot}:role`, cam.role);
        if (cam.operatorName) await valkey.set(`camera:${slot}:operator`, cam.operatorName);
      } else {
        await valkey.del(`camera:${slot}:role`);
      }
    }

    broadcastToWebClients({ type: 'camera-roles-updated' });
    console.log(`🎥 Camera roles synced: ${cameras.length} assignments`);
    res.json({ success: true, count: cameras.length });
  } catch (error) {
    console.error('❌ Error syncing cameras:', error);
    res.status(500).json({ success: false, error: 'Failed to sync camera roles' });
  }
});

// GET /api/sync/cameras — read back camera role assignments (verification)
app.get('/api/sync/cameras', requireInternalKey, async (req, res) => {
  try {
    const cameras = [];
    for (let i = 1; i <= 3; i++) {
      const role = await valkey.get(`camera:${i}:role`);
      const operator = await valkey.get(`camera:${i}:operator`);
      cameras.push({ slot: i, role: role || null, operatorName: operator || null });
    }
    res.json({ success: true, cameras });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to read camera sync' });
  }
});

// PUT /api/cameras/:id/role — assign or clear a camera role on a specific slot
app.put('/api/cameras/:id/role', requireInternalKey, async (req, res) => {
  const cameraId = parseInt(req.params.id);
  if (![1, 2, 3].includes(cameraId)) {
    return res.status(400).json({ success: false, error: 'Invalid camera ID' });
  }

  const { role, operatorName } = req.body;

  try {
    if (role === null || role === undefined || role === '') {
      await valkey.del(`camera:${cameraId}:role`);
      await valkey.del(`camera:${cameraId}:operator`);
    } else {
      if (!VALID_CAMERA_ROLES.has(role)) {
        return res.status(400).json({ success: false, error: `role must be one of: ${[...VALID_CAMERA_ROLES].join(', ')}` });
      }
      await valkey.set(`camera:${cameraId}:role`, role);
      if (operatorName) await valkey.set(`camera:${cameraId}:operator`, operatorName);
    }

    broadcastToWebClients({ type: 'camera-role-assigned', cameraId, role: role || null });
    console.log(`🎥 Camera ${cameraId} role set to: ${role || 'none'}`);
    res.json({ success: true, cameraId, role: role || null });
  } catch (error) {
    console.error('❌ Error setting camera role:', error);
    res.status(500).json({ success: false, error: 'Failed to set camera role' });
  }
});

// ===================================
// MovieShaker take callbacks (fire-and-forget helpers)
// ===================================

async function notifyMovieShakerTakeStart({ projectId, sceneId, tramLineId, cameraRole, recordingId, startedAt }) {
  const baseUrl = (process.env.MOVIESHAKER_BASE_URL || '').replace(/\/$/, '');
  const apiKey = process.env.MOVIESHAKER_API_KEY || '';
  if (!baseUrl || !apiKey) return null;

  const resp = await fetch(`${baseUrl}/api/production/takes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Internal-API-Key': apiKey },
    body: JSON.stringify({ project_id: projectId, scene_id: sceneId || null, tram_line_id: tramLineId, camera_role: cameraRole, take_number: 0, recording_id: recordingId || null, started_at: startedAt, status: 'recording' })
  });
  if (!resp.ok) throw new Error(`MovieShaker take start ${resp.status}`);
  return resp.json();
}

async function notifyMovieShakerTakeComplete({ takeId, takeNumber, completedAt, duration, videoPath, recordingId }) {
  const baseUrl = (process.env.MOVIESHAKER_BASE_URL || '').replace(/\/$/, '');
  const apiKey = process.env.MOVIESHAKER_API_KEY || '';
  if (!baseUrl || !apiKey) return null;

  const resp = await fetch(`${baseUrl}/api/production/takes/${takeId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Internal-API-Key': apiKey },
    body: JSON.stringify({ status: 'completed', take_number: takeNumber, completed_at: completedAt, duration, video_path: videoPath || null, recording_id: recordingId })
  });
  if (!resp.ok) throw new Error(`MovieShaker take update ${resp.status}`);
  return resp.json();
}

// ===================================
// Recording Creation (browser → server on capture complete)
// ===================================

// POST /api/recordings — called by browser when a recording file is saved
app.post('/api/recordings', async (req, res) => {
  try {
    const { id, cameraId, duration, fileSize, filePath, thumbnailPath } = req.body;
    const parsedCameraId = parseInt(cameraId) || 1;

    const activeShot = await getActiveShot();
    const role = await valkey.get(`camera:${parsedCameraId}:role`);
    const filmGuid = await valkey.get('session:filmGuid');
    const productionCompanyGuid = await valkey.get('session:productionCompanyGuid');

    // Read pending take (created on start-recording)
    const pendingRaw = await valkey.get(`pending:take:${parsedCameraId}`);
    const pending = pendingRaw ? JSON.parse(pendingRaw) : null;

    // Determine take number: use pending number if available, else increment counter
    let takeNumber = pending?.takeNumber || null;
    if (!takeNumber && activeShot?.id) {
      takeNumber = await valkey.incr(`take:count:${activeShot.id}`);
    }
    takeNumber = takeNumber || 1;

    const recordingId = id || uuidv4();
    const timestamp = new Date().toISOString();

    await valkey.hmset(`recording:${recordingId}`, {
      id: recordingId,
      filmGuid: filmGuid || '',
      productionCompanyGuid: productionCompanyGuid || '',
      cameraId: String(parsedCameraId),
      timestamp,
      duration: String(duration || 0),
      fileSize: String(fileSize || 0),
      filePath: filePath || '',
      thumbnailPath: thumbnailPath || '',
      status: 'raw',
      shotId: activeShot?.id || '',
      sceneId: activeShot?.sceneId || '',
      takeNumber: String(takeNumber),
      cameraRole: role || '',
      movieshakerTakeId: pending?.movieshakerTakeId || ''
    });

    // Notify MovieShaker: update existing take to completed
    if (pending?.movieshakerTakeId) {
      notifyMovieShakerTakeComplete({
        takeId: pending.movieshakerTakeId,
        takeNumber,
        completedAt: timestamp,
        duration: parseFloat(duration || 0),
        videoPath: filePath || null,
        recordingId
      }).catch(err => console.error('Take complete notification failed:', err));
      await valkey.del(`pending:take:${parsedCameraId}`);
    }

    broadcastToWebClients({ type: 'recording-saved', recording: { id: recordingId, cameraId: parsedCameraId, takeNumber, shotId: activeShot?.id || null, cameraRole: role || null } });
    console.log(`🎬 Recording saved: ${recordingId} (take ${takeNumber}, shot: ${activeShot?.title || 'unlinked'})`);
    res.json({ success: true, recording: { id: recordingId, takeNumber, shotId: activeShot?.id || null } });
  } catch (error) {
    console.error('❌ Error creating recording:', error);
    res.status(500).json({ success: false, error: 'Failed to create recording' });
  }
});

// ===================================
// Shot Execution (active shot selection)
// ===================================

// Build the full active shot record from a shotId by joining sync:shots + sync:scenes
async function buildActiveShotData(shotId) {
  const shotsRaw = await valkey.get('sync:shots');
  const scenesRaw = await valkey.get('sync:scenes');
  const shots = shotsRaw ? JSON.parse(shotsRaw) : [];
  const scenes = scenesRaw ? JSON.parse(scenesRaw) : [];

  const shot = shots.find(s => s.id === shotId);
  if (!shot) return null;

  const scene = scenes.find(s => s.id === shot.sceneId) || null;

  const titleParts = [];
  if (scene?.sceneNumber) titleParts.push(`Scene ${scene.sceneNumber}`);
  if (scene?.heading) titleParts.push(scene.heading);
  if (shot.lineNumber) titleParts.push(`Shot ${shot.lineNumber}`);
  if (shot.shotType) titleParts.push(`(${shot.shotType})`);

  return {
    id: shot.id,
    sceneId: shot.sceneId || null,
    title: titleParts.join(' — '),
    sceneHeading: scene?.heading || '',
    sceneNumber: scene?.sceneNumber || null,
    lineNumber: shot.lineNumber,
    cameraRole: shot.cameraRole || null,
    shotType: shot.shotType || null,
    framingNotes: shot.framingNotes || '',
    movementNotes: shot.movementNotes || '',
    durationTarget: shot.durationTarget || null,
    characterNames: shot.characterNames || '',
  };
}

async function getActiveShot() {
  const raw = await valkey.get('active:shot');
  return raw ? JSON.parse(raw) : null;
}

// POST /api/active-shot — select which shot is currently being filmed
app.post('/api/active-shot', requireSession, requireProjectMatch, async (req, res) => {
  try {
    const { shotId } = req.body;
    if (!shotId) {
      return res.status(400).json({ success: false, error: 'shotId is required' });
    }

    const shotData = await buildActiveShotData(shotId);
    if (!shotData) {
      return res.status(404).json({ success: false, error: 'Shot not found in sync data — run sync-to-box first' });
    }

    await valkey.set('active:shot', JSON.stringify(shotData));

    // Push shot context to all connected cameras immediately
    cameraClients.forEach((cameraWs, camId) => {
      if (cameraWs.readyState === 1) {
        cameraWs.send(JSON.stringify({ type: 'active-shot', shot: shotData }));
      }
    });

    broadcastToWebClients({ type: 'active-shot-changed', shot: shotData });
    console.log(`🎯 Active shot set: ${shotData.title}`);
    res.json({ success: true, shot: shotData });
  } catch (error) {
    console.error('❌ Error setting active shot:', error);
    res.status(500).json({ success: false, error: 'Failed to set active shot' });
  }
});

// DELETE /api/active-shot — clear the active shot
app.delete('/api/active-shot', requireSession, requireProjectMatch, async (req, res) => {
  try {
    await valkey.del('active:shot');
    broadcastToWebClients({ type: 'active-shot-changed', shot: null });
    cameraClients.forEach((cameraWs) => {
      if (cameraWs.readyState === 1) {
        cameraWs.send(JSON.stringify({ type: 'active-shot', shot: null }));
      }
    });
    console.log('🎯 Active shot cleared');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to clear active shot' });
  }
});

// GET /api/active-shot — read current active shot
app.get('/api/active-shot', async (req, res) => {
  try {
    const shot = await getActiveShot();
    res.json({ success: true, shot });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to read active shot' });
  }
});

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    await valkey.ping();
    res.json({ status: 'healthy', valkey: 'connected' });
  } catch (error) {
    res.status(503).json({ status: 'unhealthy', valkey: 'disconnected' });
  }
});

// WebSocket handling
wss.on('connection', async (ws, req) => {
  console.log('🔌 New WebSocket connection');

  // Attach user session from cookie if present (best-effort; cameras won't have one)
  const wsSession = await getUserSession(req).catch(() => null);
  if (wsSession) {
    ws.userId = wsSession.userId;
    ws.projectId = wsSession.projectId;
    ws.sessionId = wsSession.sessionId;
  }

  let clientType = null;
  let cameraId = null;
  
  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());
      console.log('📨 Received message:', message.type, message.cameraId ? `(Camera ${message.cameraId})` : '');
      console.log('📋 Full message data:', JSON.stringify(message));
      
      switch (message.type) {
        case 'register-camera':
          // Camera registration
          cameraId = message.cameraId;
          clientType = 'camera';

          if ([1, 2, 3].includes(cameraId)) {
            cameraClients.set(cameraId, ws);
            await setCameraState(cameraId, true, message.metadata || {});

            console.log(`📷 Camera ${cameraId} connected`);

            // Warn if no production sync data — camera won't have shot/scene context
            const syncProdRaw = await valkey.get('sync:production').catch(() => null);
            if (!syncProdRaw) {
              console.warn(`⚠️ Camera ${cameraId} connected but no sync:production in Valkey — sync to box first`);
            }

            const role = await valkey.get(`camera:${cameraId}:role`);
            const activeShot = await getActiveShot();

            // CRITICAL: Send confirmation + shot context back to camera
            ws.send(JSON.stringify({
              type: 'registered',
              cameraId: cameraId,
              status: 'connected',
              cameraRole: role || null,
              shot: activeShot
            }));
            console.log(`✅ Sent registration confirmation to Camera ${cameraId} (role: ${role || 'unassigned'})`);

            // Broadcast to all web clients
            broadcastToWebClients({
              type: 'camera-connected',
              cameraId: cameraId,
              metadata: message.metadata || {},
              cameraRole: role || null
            });
          }
          break;
          
        case 'register-client':
          // Web client registration
          clientType = 'web-client';
          webClients.add(ws);
          console.log('🌐 Web client registered');
          console.log(`👥 Total web clients: ${webClients.size}`);

          // Send current camera states + active shot
          const cameraStates = {};
          for (let i = 1; i <= 3; i++) {
            const state = await getCameraState(i);
            if (state.connected) {
              cameraStates[i] = state;
            }
          }
          const currentActiveShot = await getActiveShot();

          const userCtx = wsSession ? {
            userId: wsSession.userId,
            projectId: wsSession.projectId,
            projectName: wsSession.projectName || null,
            director: wsSession.director || null,
            cameraRole: wsSession.cameraRole || null,
            operatorName: wsSession.operatorName || null,
          } : null;

          ws.send(JSON.stringify({
            type: 'initial-state',
            cameras: cameraStates,
            activeShot: currentActiveShot,
            userSession: userCtx,
          }));
          break;
          
        case 'offer':
        case 'answer':
        case 'candidate':
          // WebRTC signaling - route between camera and web client
          if (message.cameraId) {
            // Auto-detect camera from offer if not registered yet
            if (message.type === 'offer' && !clientType && [1, 2, 3].includes(message.cameraId)) {
              console.log(`🎥 Auto-registering Camera ${message.cameraId} from offer`);
              clientType = 'camera';
              cameraId = message.cameraId;
              cameraClients.set(cameraId, ws);
              await setCameraState(cameraId, true, message.metadata || {});

              const autoRole = await valkey.get(`camera:${cameraId}:role`);
              broadcastToWebClients({
                type: 'camera-connected',
                cameraId: cameraId,
                metadata: message.metadata || {},
                cameraRole: autoRole || null
              });
            }
            
            if (clientType === 'web-client') {
              // From web client to camera
              const targetCamera = cameraClients.get(message.cameraId);
              if (targetCamera && targetCamera.readyState === 1) {
                targetCamera.send(JSON.stringify(message));
                console.log(`📤 Forwarded ${message.type} to Camera ${message.cameraId}`);
              }
            } else if (clientType === 'camera') {
              // From camera to all web clients
              broadcastToWebClients(message);
              console.log(`📤 Forwarded ${message.type} from Camera ${cameraId} to web clients`);
            }
          }
          break;
          
        case 'set-zoom':
          // Route zoom command to specific camera
          if (message.cameraId) {
            const targetCamera = cameraClients.get(message.cameraId);
            if (targetCamera && targetCamera.readyState === 1) {
              targetCamera.send(JSON.stringify({
                type: 'set-zoom',
                zoom: message.zoom
              }));
              console.log(`🔍 Sent zoom ${message.zoom}x to Camera ${message.cameraId}`);
            } else {
              console.warn(`⚠️ Camera ${message.cameraId} not connected for zoom command`);
            }
          }
          break;
        
        case 'start-recording': {
          // Forward to camera with active shot context
          if (message.cameraId) {
            const targetCamera = cameraClients.get(message.cameraId);
            if (targetCamera && targetCamera.readyState === 1) {
              const shotForCamera = await getActiveShot();
              const roleForCamera = await valkey.get(`camera:${message.cameraId}:role`);
              targetCamera.send(JSON.stringify({
                ...message,
                shot: shotForCamera,
                cameraRole: roleForCamera || null
              }));
              console.log(`🎬 start-recording sent to Camera ${message.cameraId} (shot: ${shotForCamera?.title || 'none'})`);

              // Notify MovieShaker: take created (fire-and-forget)
              if (shotForCamera?.id) {
                const prodRaw = await valkey.get('sync:production');
                const production = prodRaw ? JSON.parse(prodRaw) : null;
                if (production?.projectId) {
                  const startedAt = new Date().toISOString();
                  const camId = message.cameraId;
                  // Increment take counter now; POST /api/recordings uses this stored number
                  const takeNumber = await valkey.incr(`take:count:${shotForCamera.id}`);
                  notifyMovieShakerTakeStart({
                    projectId: production.projectId,
                    sceneId: shotForCamera.sceneId || null,
                    tramLineId: shotForCamera.id,
                    cameraRole: roleForCamera || '',
                    recordingId: null,
                    startedAt
                  }).then(result => {
                    if (result?.take?.id) {
                      valkey.set(`pending:take:${camId}`, JSON.stringify({
                        movieshakerTakeId: result.take.id,
                        shotId: shotForCamera.id,
                        sceneId: shotForCamera.sceneId || null,
                        takeNumber,
                        startedAt
                      })).catch(() => {});
                    }
                  }).catch(err => console.error('Take start notification failed:', err));
                }
              }
            }
          }
          break;
        }

        case 'stop-recording':
          // Recording control - forward to camera
          if (message.cameraId) {
            const targetCamera = cameraClients.get(message.cameraId);
            if (targetCamera && targetCamera.readyState === 1) {
              targetCamera.send(JSON.stringify(message));
              console.log(`🎬 stop-recording sent to Camera ${message.cameraId}`);
            }
          }
          break;
          
        default:
          console.log('⚠️ Unknown message type:', message.type);
          console.log('⚠️ Full unknown message:', JSON.stringify(message));
      }
    } catch (error) {
      console.error('❌ Error processing message:', error);
    }
  });
  
  ws.on('close', async () => {
    console.log('🔌 WebSocket disconnected');
    
    if (clientType === 'camera' && cameraId) {
      cameraClients.delete(cameraId);
      await setCameraState(cameraId, false, {});
      
      console.log(`📷 Camera ${cameraId} disconnected`);
      
      // Broadcast to all web clients
      broadcastToWebClients({
        type: 'camera-disconnected',
        cameraId: cameraId
      });
    } else if (clientType === 'web-client') {
      webClients.delete(ws);
      console.log('🌐 Web client disconnected');
    }
  });
  
  ws.on('error', (error) => {
    console.error('❌ WebSocket error:', error);
  });
});

// Broadcast message to all web clients
function broadcastToWebClients(message) {
  const messageStr = JSON.stringify(message);
  let sentCount = 0;
  webClients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(messageStr);
      sentCount++;
    }
  });
  console.log(`📤 Broadcast sent to ${sentCount} clients`);
}

// Initialize and start server
async function startServer() {
  try {
    await initializeSession();
    
    const filmGuid = await valkey.get('session:filmGuid');
    const productionGuid = await valkey.get('session:productionCompanyGuid');
    
    server.listen(PORT, () => {
      console.log('');
      console.log('🎬 ═══════════════════════════════════════════════════════');
      console.log('🎬  Film Production Multi-Camera Server (Docker + Valkey)');
      console.log('🎬 ═══════════════════════════════════════════════════════');
      console.log('');
      console.log(`🌐 Server running on: http://${SERVER_IP}:${PORT}`);
      console.log(`🔌 WebSocket endpoint: ws://${SERVER_IP}:${PORT}/signaling`);
      console.log(`🗄️  Valkey: ${process.env.VALKEY_HOST || 'localhost'}:${process.env.VALKEY_PORT || 6379}`);
      console.log('');
      console.log(`📋 Film GUID: ${filmGuid}`);
      console.log(`🏢 Production GUID: ${productionGuid}`);
      console.log('');
      console.log('🎥 Camera Status:');
      console.log('   Camera 1: Waiting');
      console.log('   Camera 2: Waiting');
      console.log('   Camera 3: Waiting');
      console.log('');
      console.log('📱 Scan QR codes from the web interface to connect cameras');
      console.log('🎬 ═══════════════════════════════════════════════════════');
      console.log('');
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('📴 SIGTERM received, shutting down gracefully...');
  
  // Close all WebSocket connections
  wss.clients.forEach((client) => {
    client.close();
  });
  
  // Close server
  server.close(() => {
    console.log('Server closed');
  });
  
  // Close Valkey connection
  await valkey.quit();
  console.log('Valkey connection closed');
  
  process.exit(0);
});

startServer();
