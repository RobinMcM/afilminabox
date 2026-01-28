import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import QRCode from 'qrcode';
import { v4 as uuidv4 } from 'uuid';
import { networkInterfaces } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/signaling' });

const PORT = 8080;

// Get local network IP
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

const SERVER_IP = getLocalIP();

// Session state
const sessionState = {
  filmGuid: uuidv4(),
  productionCompanyGuid: uuidv4(),
  cameras: {
    1: { connected: false, wsClient: null, metadata: {} },
    2: { connected: false, wsClient: null, metadata: {} },
    3: { connected: false, wsClient: null, metadata: {} }
  }
};

// Track all connected web clients
const webClients = new Set();

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '../dist')));

// API Routes

// GET /api/session - Return current session metadata
app.get('/api/session', (req, res) => {
  res.json({
    success: true,
    filmGuid: sessionState.filmGuid,
    productionCompanyGuid: sessionState.productionCompanyGuid
  });
});

// POST /api/session - Update session metadata
app.post('/api/session', (req, res) => {
  const { filmGuid, productionCompanyGuid } = req.body;
  
  if (filmGuid) sessionState.filmGuid = filmGuid;
  if (productionCompanyGuid) sessionState.productionCompanyGuid = productionCompanyGuid;
  
  console.log('✅ Session updated:', { filmGuid: sessionState.filmGuid, productionCompanyGuid: sessionState.productionCompanyGuid });
  
  res.json({
    success: true,
    filmGuid: sessionState.filmGuid,
    productionCompanyGuid: sessionState.productionCompanyGuid
  });
});

// GET /api/qr/:cameraId - Generate QR code for camera
app.get('/api/qr/:cameraId', async (req, res) => {
  const cameraId = parseInt(req.params.cameraId);
  
  if (![1, 2, 3].includes(cameraId)) {
    return res.status(400).json({ success: false, error: 'Invalid camera ID' });
  }
  
  const connectionData = {
    serverIP: SERVER_IP,
    port: PORT,
    filmGuid: sessionState.filmGuid,
    productionCompanyGuid: sessionState.productionCompanyGuid,
    cameraId: cameraId,
    cameraName: `Camera ${cameraId}`,
    timestamp: new Date().toISOString()
  };
  
  try {
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
app.get('/api/cameras', (req, res) => {
  const cameraStatus = {};
  
  for (const [id, camera] of Object.entries(sessionState.cameras)) {
    cameraStatus[id] = {
      connected: camera.connected,
      metadata: camera.metadata
    };
  }
  
  res.json({ success: true, cameras: cameraStatus });
});

// WebSocket handling
wss.on('connection', (ws) => {
  console.log('🔌 New WebSocket connection');
  
  let clientType = null;
  let cameraId = null;
  
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      console.log('📨 Received message:', message.type, message.cameraId ? `(Camera ${message.cameraId})` : '');
      
      switch (message.type) {
        case 'register-camera':
          // Camera registration
          cameraId = message.cameraId;
          clientType = 'camera';
          
          if (sessionState.cameras[cameraId]) {
            sessionState.cameras[cameraId].connected = true;
            sessionState.cameras[cameraId].wsClient = ws;
            sessionState.cameras[cameraId].metadata = message.metadata || {};
            
            console.log(`📷 Camera ${cameraId} connected`);
            
            // Broadcast to all web clients
            broadcastToWebClients({
              type: 'camera-connected',
              cameraId: cameraId,
              metadata: message.metadata || {}
            });
          }
          break;
          
        case 'register-client':
          // Web client registration
          clientType = 'web-client';
          webClients.add(ws);
          console.log('🌐 Web client registered');
          
          // Send current camera states
          const cameraStates = {};
          for (const [id, camera] of Object.entries(sessionState.cameras)) {
            if (camera.connected) {
              cameraStates[id] = {
                connected: true,
                metadata: camera.metadata
              };
            }
          }
          
          ws.send(JSON.stringify({
            type: 'initial-state',
            cameras: cameraStates
          }));
          break;
          
        case 'offer':
        case 'answer':
        case 'candidate':
          // WebRTC signaling - route between camera and web client
          if (message.cameraId && sessionState.cameras[message.cameraId]) {
            if (clientType === 'web-client') {
              // From web client to camera
              const targetCamera = sessionState.cameras[message.cameraId];
              if (targetCamera.wsClient && targetCamera.wsClient.readyState === 1) {
                targetCamera.wsClient.send(JSON.stringify(message));
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
          if (message.cameraId && sessionState.cameras[message.cameraId]) {
            const targetCamera = sessionState.cameras[message.cameraId];
            if (targetCamera.wsClient && targetCamera.wsClient.readyState === 1) {
              targetCamera.wsClient.send(JSON.stringify(message));
              console.log(`🎬 ${message.type} sent to Camera ${message.cameraId}`);
            }
          }
          break;
          
        default:
          console.log('⚠️ Unknown message type:', message.type);
      }
    } catch (error) {
      console.error('❌ Error processing message:', error);
    }
  });
  
  ws.on('close', () => {
    console.log('🔌 WebSocket disconnected');
    
    if (clientType === 'camera' && cameraId) {
      sessionState.cameras[cameraId].connected = false;
      sessionState.cameras[cameraId].wsClient = null;
      sessionState.cameras[cameraId].metadata = {};
      
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
  webClients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(messageStr);
    }
  });
}

// Start server
server.listen(PORT, () => {
  console.log('');
  console.log('🎬 ═══════════════════════════════════════════════════════');
  console.log('🎬  Film Production Multi-Camera Server');
  console.log('🎬 ═══════════════════════════════════════════════════════');
  console.log('');
  console.log(`🌐 Server running on: http://${SERVER_IP}:${PORT}`);
  console.log(`🔌 WebSocket endpoint: ws://${SERVER_IP}:${PORT}/signaling`);
  console.log('');
  console.log(`📋 Film GUID: ${sessionState.filmGuid}`);
  console.log(`🏢 Production GUID: ${sessionState.productionCompanyGuid}`);
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
