import { useState, useEffect, useRef } from 'react';
import ProductionSetup from './components/ProductionSetup';
import CameraGrid from './components/CameraGrid';

function App() {
  const [cameras, setCameras] = useState({
    1: { connected: false, recording: false, stream: null, pc: null, metadata: {} },
    2: { connected: false, recording: false, stream: null, pc: null, metadata: {} },
    3: { connected: false, recording: false, stream: null, pc: null, metadata: {} }
  });
  
  const [session, setSession] = useState({
    filmGuid: '',
    productionCompanyGuid: ''
  });
  
  const [qrCodes, setQRCodes] = useState({
    1: null,
    2: null,
    3: null
  });
  
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttempts = useRef(0);
  
  // Fetch initial session data
  useEffect(() => {
    fetchSession();
    fetchQRCodes();
  }, []);
  
  // WebSocket connection with reconnection logic
  useEffect(() => {
    connectWebSocket();
    
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, []);
  
  const connectWebSocket = () => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // In production (HTTPS), use default port 443 (no port specified)
    // In development, use explicit port
    const port = window.location.port ? `:${window.location.port}` : '';
    const wsUrl = `${protocol}//${window.location.hostname}${port}/signaling`;
    
    console.log('🔌 Connecting to WebSocket:', wsUrl);
    
    const ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
      console.log('✅ WebSocket connected');
      reconnectAttempts.current = 0;
      
      // Register as web client
      ws.send(JSON.stringify({ type: 'register-client' }));
    };
    
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        handleWebSocketMessage(message);
      } catch (error) {
        console.error('❌ Error parsing WebSocket message:', error);
      }
    };
    
    ws.onerror = (error) => {
      console.error('❌ WebSocket error:', error);
    };
    
    ws.onclose = () => {
      console.log('🔌 WebSocket disconnected');
      wsRef.current = null;
      
      // Attempt reconnection with exponential backoff
      const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
      console.log(`🔄 Reconnecting in ${delay}ms...`);
      
      reconnectTimeoutRef.current = setTimeout(() => {
        reconnectAttempts.current++;
        connectWebSocket();
      }, delay);
    };
    
    wsRef.current = ws;
  };
  
  const handleWebSocketMessage = async (message) => {
    console.log('📨 WebSocket message:', message.type, message.cameraId ? `Camera ${message.cameraId}` : '');
    
    switch (message.type) {
      case 'initial-state':
        // Set initial camera states
        if (message.cameras) {
          setCameras(prev => {
            const updated = { ...prev };
            for (const [id, data] of Object.entries(message.cameras)) {
              if (data.connected) {
                updated[id] = { ...updated[id], connected: true, metadata: data.metadata };
                // Create peer connection for already connected cameras
                createPeerConnection(parseInt(id));
              }
            }
            return updated;
          });
        }
        break;
        
      case 'camera-connected':
        setCameras(prev => ({
          ...prev,
          [message.cameraId]: {
            ...prev[message.cameraId],
            connected: true,
            metadata: message.metadata
          }
        }));
        // Just mark as connected, wait for camera to send offer
        console.log(`📷 Camera ${message.cameraId} connected - waiting for offer`);
        break;
        
      case 'camera-disconnected':
        handleCameraDisconnect(message.cameraId);
        break;
        
      case 'offer':
        // Camera is sending an offer, we need to create answer
        await handleOffer(message.cameraId, message.offer || message.sdp);
        break;
        
      case 'answer':
        await handleAnswer(message.cameraId, message.answer);
        break;
        
      case 'candidate':
        await handleCandidate(message.cameraId, message.candidate);
        break;
    }
  };
  
  const createPeerConnection = async (cameraId) => {
    console.log(`🔗 Creating peer connection for Camera ${cameraId}`);
    
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    });
    
    // Handle incoming tracks
    pc.ontrack = (event) => {
      console.log(`📹 Received track from Camera ${cameraId}:`, event.track.kind);
      setCameras(prev => ({
        ...prev,
        [cameraId]: { ...prev[cameraId], stream: event.streams[0] }
      }));
    };
    
    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        console.log(`🧊 Sending ICE candidate for Camera ${cameraId}`);
        wsRef.current.send(JSON.stringify({
          type: 'candidate',
          cameraId: cameraId,
          candidate: event.candidate
        }));
      }
    };
    
    // Handle connection state changes
    pc.onconnectionstatechange = () => {
      console.log(`📡 Camera ${cameraId} connection state:`, pc.connectionState);
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        handleCameraDisconnect(cameraId);
      }
    };
    
    // Store peer connection
    setCameras(prev => ({
      ...prev,
      [cameraId]: { ...prev[cameraId], pc: pc }
    }));
    
    // Create and send offer
    try {
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });
      
      await pc.setLocalDescription(offer);
      
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'offer',
          cameraId: cameraId,
          offer: offer
        }));
        console.log(`📤 Sent offer to Camera ${cameraId}`);
      }
    } catch (error) {
      console.error(`❌ Error creating offer for Camera ${cameraId}:`, error);
    }
  };
  
  const handleOffer = async (cameraId, offer) => {
    console.log(`📥 Received offer from Camera ${cameraId}`);
    
    try {
      // Create peer connection if it doesn't exist
      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      });
      
      // Handle incoming tracks
      pc.ontrack = (event) => {
        console.log(`📹 Received track from Camera ${cameraId}:`, event.track.kind);
        setCameras(prev => ({
          ...prev,
          [cameraId]: { ...prev[cameraId], stream: event.streams[0] }
        }));
      };
      
      // Handle ICE candidates
      pc.onicecandidate = (event) => {
        if (event.candidate && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          console.log(`🧊 Sending ICE candidate for Camera ${cameraId}`);
          wsRef.current.send(JSON.stringify({
            type: 'candidate',
            cameraId: cameraId,
            candidate: event.candidate
          }));
        }
      };
      
      // Handle connection state changes
      pc.onconnectionstatechange = () => {
        console.log(`📡 Camera ${cameraId} connection state:`, pc.connectionState);
        if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
          handleCameraDisconnect(cameraId);
        }
      };
      
      // Store peer connection
      setCameras(prev => ({
        ...prev,
        [cameraId]: { ...prev[cameraId], pc: pc }
      }));
      
      // Set remote description from offer
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      console.log(`✅ Set remote description from Camera ${cameraId} offer`);
      
      // Create answer
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      
      // Send answer back to camera
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'answer',
          cameraId: cameraId,
          answer: answer
        }));
        console.log(`📤 Sent answer to Camera ${cameraId}`);
      }
    } catch (error) {
      console.error(`❌ Error handling offer from Camera ${cameraId}:`, error);
    }
  };
  
  const handleAnswer = async (cameraId, answer) => {
    console.log(`📥 Received answer from Camera ${cameraId}`);
    
    setCameras(prev => {
      const camera = prev[cameraId];
      if (camera.pc) {
        camera.pc.setRemoteDescription(new RTCSessionDescription(answer))
          .then(() => console.log(`✅ Set remote description for Camera ${cameraId}`))
          .catch(err => console.error(`❌ Error setting remote description for Camera ${cameraId}:`, err));
      }
      return prev;
    });
  };
  
  const handleCandidate = async (cameraId, candidate) => {
    console.log(`🧊 Received ICE candidate for Camera ${cameraId}`);
    
    setCameras(prev => {
      const camera = prev[cameraId];
      if (camera.pc) {
        camera.pc.addIceCandidate(new RTCIceCandidate(candidate))
          .then(() => console.log(`✅ Added ICE candidate for Camera ${cameraId}`))
          .catch(err => console.error(`❌ Error adding ICE candidate for Camera ${cameraId}:`, err));
      }
      return prev;
    });
  };
  
  const handleCameraDisconnect = (cameraId) => {
    console.log(`📷 Camera ${cameraId} disconnected`);
    
    setCameras(prev => {
      const camera = prev[cameraId];
      
      // Clean up peer connection
      if (camera.pc) {
        camera.pc.close();
      }
      
      return {
        ...prev,
        [cameraId]: {
          connected: false,
          recording: false,
          stream: null,
          pc: null,
          metadata: {}
        }
      };
    });
  };
  
  const fetchSession = async () => {
    try {
      const response = await fetch('/api/session');
      const data = await response.json();
      if (data.success) {
        setSession({
          filmGuid: data.filmGuid,
          productionCompanyGuid: data.productionCompanyGuid
        });
      }
    } catch (error) {
      console.error('❌ Error fetching session:', error);
    }
  };
  
  const fetchQRCodes = async () => {
    const codes = {};
    for (let i = 1; i <= 3; i++) {
      try {
        const response = await fetch(`/api/qr/${i}`);
        const data = await response.json();
        if (data.success) {
          codes[i] = data.qrCode;
        }
      } catch (error) {
        console.error(`❌ Error fetching QR code for Camera ${i}:`, error);
      }
    }
    setQRCodes(codes);
  };
  
  const updateSession = async (filmGuid, productionCompanyGuid) => {
    try {
      const response = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filmGuid, productionCompanyGuid })
      });
      
      const data = await response.json();
      if (data.success) {
        setSession({
          filmGuid: data.filmGuid,
          productionCompanyGuid: data.productionCompanyGuid
        });
        // Refresh QR codes
        await fetchQRCodes();
      }
    } catch (error) {
      console.error('❌ Error updating session:', error);
    }
  };
  
  const toggleRecording = (cameraId) => {
    const camera = cameras[cameraId];
    const newRecordingState = !camera.recording;
    
    // Update local state
    setCameras(prev => ({
      ...prev,
      [cameraId]: { ...prev[cameraId], recording: newRecordingState }
    }));
    
    // Send message to camera
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: newRecordingState ? 'start-recording' : 'stop-recording',
        cameraId: cameraId
      }));
      console.log(`🎬 ${newRecordingState ? 'Started' : 'Stopped'} recording for Camera ${cameraId}`);
    }
  };
  
  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">
          <span className="title-icon">🎬</span>
          a Film in a Box
        </h1>
        <p className="app-subtitle">Film Production Multi-Camera Controller</p>
      </header>
      
      <ProductionSetup
        session={session}
        qrCodes={qrCodes}
        cameras={cameras}
        onUpdateSession={updateSession}
      />
      
      <CameraGrid
        cameras={cameras}
        onToggleRecording={toggleRecording}
      />
    </div>
  );
}

export default App;
