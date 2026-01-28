# afilminabox - Film Production Multi-Camera Server

Professional multi-camera streaming system for film production with WebSocket signaling, WebRTC video streams, and QR code-based iPhone camera connections.

## 🎬 Features

- **Multi-Camera Support**: Control up to 3 simultaneous camera streams
- **WebRTC Video Streaming**: Real-time peer-to-peer video transmission
- **QR Code Connection**: Auto-connect iPhone cameras by scanning QR codes
- **Cyberpunk UI**: Professional dashboard with animated backgrounds and neon effects
- **Session Management**: Organize recordings with Film GUID and Production Company GUID
- **Recording Controls**: Start/stop recording for each camera independently
- **Real-time Status**: Live connection and recording status indicators
- **PWA Ready**: Progressive Web App for standalone installation
- **Responsive Design**: Works on desktop, tablet, and mobile devices

## 🚀 Quick Start

### Installation

```bash
cd afilminabox
npm install
```

### Development

Start both backend and frontend servers:

```bash
npm run dev
```

This will start:
- **Backend Server**: http://YOUR_LOCAL_IP:8080
- **Frontend Dev Server**: http://localhost:5173

### Production Build

```bash
npm run build
npm run preview
```

## 📱 How to Use

1. **Start the Application**
   ```bash
   npm run dev
   ```

2. **Access the Dashboard**
   - Open http://localhost:5173 in your browser
   - You'll see the production setup interface with 3 QR codes

3. **Configure Session (Optional)**
   - Update Film GUID and Production Company GUID
   - Click "Update Session & Regenerate QR Codes"

4. **Connect iPhone Cameras**
   - Scan QR Code 1 with iPhone 1
   - Scan QR Code 2 with iPhone 2
   - Scan QR Code 3 with iPhone 3
   - Each iPhone will automatically connect via WebSocket

5. **Control Recording**
   - Once connected, camera feeds appear in real-time
   - Click "Start Recording" to begin recording on a specific camera
   - Click "Stop Recording" to end recording

## 🏗️ Architecture

```
┌─────────────────┐      WebSocket       ┌──────────────────┐
│  iPhone Camera  │ ←──── Signaling ────→ │  WebSocket       │
│   (WebRTC)      │                       │  Server          │
└─────────────────┘                       │  (port 8080)     │
                                          └──────────────────┘
                                                   ↑
                                                   │
                                          ┌────────┴────────┐
                                          │  React Web      │
                                          │  Client         │
                                          │  (port 5173)    │
                                          └─────────────────┘
```

### Data Flow

1. Web client requests QR codes from backend
2. QR codes contain: server IP, port, Film GUID, Production GUID, camera ID
3. iPhone scans QR code and connects via WebSocket
4. WebSocket server brokers WebRTC signaling (offer/answer/ICE candidates)
5. Direct P2P video stream established between iPhone and web client
6. Web client displays live camera feeds with recording controls

## 🛠️ Technology Stack

### Backend
- **Node.js** with Express
- **WebSocket Server** (`ws` library)
- **QR Code Generation** (`qrcode` library)
- **UUID** for session management

### Frontend
- **React 18** with hooks
- **Vite** for fast development
- **WebRTC** for peer-to-peer video
- **Modern CSS** with animations

## 📁 Project Structure

```
afilminabox/
├── package.json              # Dependencies and scripts
├── vite.config.js           # Vite configuration
├── index.html               # HTML entry point
├── public/
│   └── manifest.json        # PWA manifest
├── src/
│   ├── main.jsx            # React entry point
│   ├── App.jsx             # Main app with WebSocket/WebRTC
│   ├── components/
│   │   ├── ProductionSetup.jsx   # Session config & QR codes
│   │   ├── QRCodeDisplay.jsx     # Individual QR display
│   │   ├── CameraPanel.jsx       # Single camera view
│   │   └── CameraGrid.jsx        # 3-column camera layout
│   └── styles/
│       └── global.css       # Cyberpunk theme styles
└── server/
    └── server.js            # Express + WebSocket server
```

## 🔌 API Endpoints

### GET /api/session
Returns current session metadata.

**Response:**
```json
{
  "success": true,
  "filmGuid": "uuid-v4",
  "productionCompanyGuid": "uuid-v4"
}
```

### POST /api/session
Updates session metadata.

**Request Body:**
```json
{
  "filmGuid": "uuid-v4",
  "productionCompanyGuid": "uuid-v4"
}
```

### GET /api/qr/:cameraId
Generates QR code for specified camera (1, 2, or 3).

**Response:**
```json
{
  "success": true,
  "qrCode": "data:image/png;base64,...",
  "connectionData": {
    "serverIP": "192.168.1.100",
    "port": 8080,
    "filmGuid": "uuid-v4",
    "productionCompanyGuid": "uuid-v4",
    "cameraId": 1,
    "cameraName": "Camera 1",
    "timestamp": "2026-01-28T12:00:00.000Z"
  }
}
```

### GET /api/cameras
Returns status of all cameras.

**Response:**
```json
{
  "success": true,
  "cameras": {
    "1": { "connected": false, "metadata": {} },
    "2": { "connected": false, "metadata": {} },
    "3": { "connected": false, "metadata": {} }
  }
}
```

## 🌐 WebSocket Protocol

### Messages from Camera to Server

**Register Camera:**
```json
{
  "type": "register-camera",
  "cameraId": 1,
  "metadata": { "deviceInfo": "..." }
}
```

**WebRTC Answer:**
```json
{
  "type": "answer",
  "cameraId": 1,
  "answer": { "sdp": "...", "type": "answer" }
}
```

**ICE Candidate:**
```json
{
  "type": "candidate",
  "cameraId": 1,
  "candidate": { "candidate": "...", "sdpMid": "...", "sdpMLineIndex": 0 }
}
```

### Messages from Web Client to Server

**Register Client:**
```json
{
  "type": "register-client"
}
```

**WebRTC Offer:**
```json
{
  "type": "offer",
  "cameraId": 1,
  "offer": { "sdp": "...", "type": "offer" }
}
```

**Recording Control:**
```json
{
  "type": "start-recording",
  "cameraId": 1
}
```

### Messages from Server to Clients

**Camera Connected:**
```json
{
  "type": "camera-connected",
  "cameraId": 1,
  "metadata": {}
}
```

**Camera Disconnected:**
```json
{
  "type": "camera-disconnected",
  "cameraId": 1
}
```

## 🎨 Cyberpunk Theme

The application features a professional cyberpunk aesthetic:

- **Animated Grid Background**: Moving 50px grid with cyan lines
- **Glassmorphism Effects**: Semi-transparent panels with backdrop blur
- **Neon Borders**: Glowing cyan and magenta borders
- **Status Indicators**: Pulsing dots for connection status
- **Recording Animation**: Magenta pulse effect when recording
- **Responsive Design**: Adapts to desktop, tablet, and mobile

### Color Palette

- Background: `#0a0e27` (dark blue)
- Secondary: `#151b3d` (medium blue)
- Accent Cyan: `#00fff2` (neon cyan)
- Accent Magenta: `#ff00e5` (neon magenta)
- Accent Yellow: `#ffed00` (bright yellow)

## 🔒 Network Configuration

The server automatically detects your local network IP address. For production use:

1. Ensure all devices are on the same network
2. Configure firewall to allow ports 8080 and 5173
3. For external access, set up port forwarding or use a VPN

## 🐛 Troubleshooting

### Camera Won't Connect
- Verify iPhone and server are on the same network
- Check firewall settings for ports 8080 and 5173
- Ensure camera has granted camera/microphone permissions

### Video Not Displaying
- Check browser console for WebRTC errors
- Verify STUN server connectivity
- Try refreshing the page and reconnecting camera

### QR Code Not Scanning
- Increase phone screen brightness
- Ensure QR code is fully visible
- Try generating new QR codes with updated session

## 📄 License

This project is provided as-is for film production use.

## 🎬 Credits

Built with modern web technologies for professional film production environments.
