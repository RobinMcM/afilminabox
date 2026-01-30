import { useState, useEffect, useRef } from 'react';
import ProductionSetup from './components/ProductionSetup';
import CameraGrid from './components/CameraGrid';
import VideoGallery from './components/VideoGallery';

function App() {
  const [currentView, setCurrentView] = useState('control'); // 'control' or 'gallery'
  
  const [cameras, setCameras] = useState({
    1: { connected: false, recording: false, stream: null, pc: null, metadata: {}, mediaRecorder: null, recordedChunks: [] },
    2: { connected: false, recording: false, stream: null, pc: null, metadata: {}, mediaRecorder: null, recordedChunks: [] },
    3: { connected: false, recording: false, stream: null, pc: null, metadata: {}, mediaRecorder: null, recordedChunks: [] }
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
        // Construct proper SDP description object
        const offerSdp = message.offer || { type: 'offer', sdp: message.sdp };
        await handleOffer(message.cameraId, offerSdp);
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
    console.log(`📋 Offer format:`, offer);
    
    try {
      // Ensure offer is in correct format
      const sdpDescription = typeof offer === 'string' 
        ? { type: 'offer', sdp: offer }
        : offer;
      
      console.log(`📋 SDP Description:`, { type: sdpDescription.type, sdpLength: sdpDescription.sdp?.length });
      
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
      
      // Handle ICE connection state
      pc.oniceconnectionstatechange = () => {
        console.log(`🧊 Camera ${cameraId} ICE state:`, pc.iceConnectionState);
      };
      
      // Store peer connection
      setCameras(prev => ({
        ...prev,
        [cameraId]: { ...prev[cameraId], pc: pc }
      }));
      
      // Set remote description from offer
      await pc.setRemoteDescription(new RTCSessionDescription(sdpDescription));
      console.log(`✅ Set remote description from Camera ${cameraId} offer`);
      
      // Create answer
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      console.log(`✅ Created answer for Camera ${cameraId}`);
      
      // Send answer back to camera
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'answer',
          cameraId: cameraId,
          sdp: answer.sdp
        }));
        console.log(`📤 Sent answer to Camera ${cameraId}`);
      }
    } catch (error) {
      console.error(`❌ Error handling offer from Camera ${cameraId}:`, error);
      console.error(`❌ Error details:`, error.message, error.stack);
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
    
    if (!camera.recording) {
      // Start recording
      startLocalRecording(cameraId);
    } else {
      // Stop recording
      stopLocalRecording(cameraId);
    }
  };
  
  const startLocalRecording = (cameraId) => {
    const camera = cameras[cameraId];
    
    if (!camera.stream) {
      console.error(`❌ No stream available for Camera ${cameraId}`);
      return;
    }
    
    try {
      // Create MediaRecorder for local recording
      const options = {
        mimeType: 'video/webm;codecs=vp9,opus',
        videoBitsPerSecond: 2500000
      };
      
      // Fallback to vp8 if vp9 not supported
      if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        options.mimeType = 'video/webm;codecs=vp8,opus';
      }
      
      const mediaRecorder = new MediaRecorder(camera.stream, options);
      const chunks = [];
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunks.push(event.data);
        }
      };
      
      mediaRecorder.onstop = () => {
        saveRecordingToPC(cameraId, chunks);
      };
      
      mediaRecorder.start(1000); // Collect data every second
      
      // Update state with mediaRecorder
      setCameras(prev => ({
        ...prev,
        [cameraId]: {
          ...prev[cameraId],
          recording: true,
          mediaRecorder: mediaRecorder,
          recordedChunks: chunks,
          recordingStartTime: Date.now()
        }
      }));
      
      console.log(`🎬 Started local recording for Camera ${cameraId}`);
      
      // Also notify the iPhone camera (optional - for status sync)
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'start-recording',
          cameraId: cameraId
        }));
      }
    } catch (error) {
      console.error(`❌ Error starting recording for Camera ${cameraId}:`, error);
    }
  };
  
  const stopLocalRecording = (cameraId) => {
    const camera = cameras[cameraId];
    
    if (camera.mediaRecorder && camera.mediaRecorder.state !== 'inactive') {
      camera.mediaRecorder.stop();
      
      setCameras(prev => ({
        ...prev,
        [cameraId]: { ...prev[cameraId], recording: false }
      }));
      
      console.log(`⏹️ Stopped local recording for Camera ${cameraId}`);
      
      // Notify iPhone camera (optional)
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'stop-recording',
          cameraId: cameraId
        }));
      }
    }
  };
  
  const saveRecordingToPC = (cameraId, chunks) => {
    if (chunks.length === 0) {
      console.warn(`⚠️ No data recorded for Camera ${cameraId}`);
      return;
    }
    
    const camera = cameras[cameraId];
    const blob = new Blob(chunks, { type: 'video/webm' });
    const timestamp = Date.now();
    const fileName = `camera-${cameraId}-${timestamp}.webm`;
    
    // Auto-download to PC
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    
    // Cleanup
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
    
    // Calculate duration (rough estimate based on recording time)
    const duration = camera.recordingStartTime 
      ? Math.floor((Date.now() - camera.recordingStartTime) / 1000)
      : 0;
    
    // Save metadata to localStorage
    const recording = {
      id: `${Date.now()}-${cameraId}`,
      cameraId: cameraId,
      fileName: fileName,
      timestamp: new Date().toISOString(),
      duration: duration,
      fileSize: blob.size,
      filmGuid: session.filmGuid,
      productionCompanyGuid: session.productionCompanyGuid,
      status: 'local'
    };
    
    // Get existing recordings from localStorage
    const existingRecordings = JSON.parse(localStorage.getItem('recordings') || '[]');
    existingRecordings.unshift(recording); // Add to beginning (newest first)
    localStorage.setItem('recordings', JSON.stringify(existingRecordings));
    
    console.log(`✅ Recording saved: ${fileName}`);
    console.log(`💾 Metadata saved to localStorage`);
  };
  
  const handleZoomChange = (cameraId, zoom) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'set-zoom',
        cameraId: cameraId,
        zoom: zoom
      }));
      console.log(`🔍 Sent zoom ${zoom}x command to Camera ${cameraId}`);
    } else {
      console.warn(`⚠️ WebSocket not connected, cannot send zoom command`);
    }
  };
  
  return (
    <div className="app">
      <header className="app-header">
        <div className="header-content">
          <div className="header-title-section">
            <h1 className="app-title">
              <span className="title-icon">🎬</span>
              a Film in a Box
            </h1>
            <p className="app-subtitle">Film Production Multi-Camera Controller</p>
          </div>
          
          <nav className="app-navigation">
            <button 
              className={`nav-btn ${currentView === 'control' ? 'active' : ''}`}
              onClick={() => setCurrentView('control')}
            >
              <span className="nav-icon">📹</span>
              Camera Control
            </button>
            <button 
              className={`nav-btn ${currentView === 'gallery' ? 'active' : ''}`}
              onClick={() => setCurrentView('gallery')}
            >
              <span className="nav-icon">🎬</span>
              Video Gallery
            </button>
          </nav>
        </div>
      </header>
      
      {currentView === 'control' ? (
        <>
          <ProductionSetup
            session={session}
            qrCodes={qrCodes}
            cameras={cameras}
            onUpdateSession={updateSession}
          />
          
        <CameraGrid 
          cameras={cameras} 
          onToggleRecording={toggleRecording}
          onZoomChange={handleZoomChange}
        />
        </>
      ) : (
        <VideoGallery session={session} />
      )}
    </div>
  );
}

export default App;
