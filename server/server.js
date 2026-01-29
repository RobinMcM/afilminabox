import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import QRCode from 'qrcode';
import { v4 as uuidv4 } from 'uuid';
import { networkInterfaces } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
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

// Camera state management in Valkey
async function getCameraState(cameraId) {
  const state = await valkey.hgetall(`camera:${cameraId}`);
  return {
    connected: state.connected === 'true',
    metadata: state.metadata ? JSON.parse(state.metadata) : {}
  };
}

async function setCameraState(cameraId, connected, metadata = {}) {
  await valkey.hmset(`camera:${cameraId}`, {
    connected: connected.toString(),
    metadata: JSON.stringify(metadata),
    lastUpdate: Date.now()
  });
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
wss.on('connection', (ws) => {
  console.log('🔌 New WebSocket connection');
  
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
            console.log(`👥 Broadcasting to ${webClients.size} web clients`);
            
            // Broadcast to all web clients
            const broadcastMessage = {
              type: 'camera-connected',
              cameraId: cameraId,
              metadata: message.metadata || {}
            };
            console.log('📡 Broadcasting message:', JSON.stringify(broadcastMessage));
            broadcastToWebClients(broadcastMessage);
          }
          break;
          
        case 'register-client':
          // Web client registration
          clientType = 'web-client';
          webClients.add(ws);
          console.log('🌐 Web client registered');
          console.log(`👥 Total web clients: ${webClients.size}`);
          
          // Send current camera states
          const cameraStates = {};
          for (let i = 1; i <= 3; i++) {
            const state = await getCameraState(i);
            if (state.connected) {
              cameraStates[i] = state;
            }
          }
          
          console.log('📤 Sending initial state to client:', JSON.stringify(cameraStates));
          ws.send(JSON.stringify({
            type: 'initial-state',
            cameras: cameraStates
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
              
              // Broadcast camera connected
              const broadcastMessage = {
                type: 'camera-connected',
                cameraId: cameraId,
                metadata: message.metadata || {}
              };
              console.log('📡 Broadcasting message:', JSON.stringify(broadcastMessage));
              broadcastToWebClients(broadcastMessage);
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
          
        case 'start-recording':
        case 'stop-recording':
          // Recording control - forward to camera
          if (message.cameraId) {
            const targetCamera = cameraClients.get(message.cameraId);
            if (targetCamera && targetCamera.readyState === 1) {
              targetCamera.send(JSON.stringify(message));
              console.log(`🎬 ${message.type} sent to Camera ${message.cameraId}`);
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
