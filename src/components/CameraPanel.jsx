import { useEffect, useRef } from 'react';

function CameraPanel({ cameraId, camera, onToggleRecording }) {
  const videoRef = useRef(null);
  
  useEffect(() => {
    if (videoRef.current && camera.stream) {
      videoRef.current.srcObject = camera.stream;
    }
  }, [camera.stream]);
  
  const getStatusClass = () => {
    if (!camera.connected) return 'offline';
    if (camera.recording) return 'recording';
    return 'connected';
  };
  
  return (
    <div className={`camera-panel ${getStatusClass()}`}>
      <div className="camera-header">
        <div className="camera-info">
          <h3 className="camera-title">Camera {cameraId}</h3>
          <div className={`status-indicator ${getStatusClass()}`}>
            <span className="status-dot"></span>
            <span className="status-label">
              {!camera.connected && 'Offline'}
              {camera.connected && !camera.recording && 'Connected'}
              {camera.recording && 'Recording'}
            </span>
          </div>
        </div>
      </div>
      
      <div className="video-container">
        {camera.stream ? (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="camera-video"
          />
        ) : (
          <div className="video-placeholder">
            <div className="placeholder-icon">📷</div>
            <p className="placeholder-text">
              {camera.connected ? 'Establishing connection...' : 'Waiting for camera'}
            </p>
          </div>
        )}
      </div>
      
      <div className="camera-metadata">
        {camera.metadata && Object.keys(camera.metadata).length > 0 && (
          <>
            <div className="metadata-item">
              <span className="metadata-label">Film:</span>
              <span className="metadata-value">{camera.metadata.filmGuid || 'N/A'}</span>
            </div>
            <div className="metadata-item">
              <span className="metadata-label">Production:</span>
              <span className="metadata-value">{camera.metadata.productionCompanyGuid || 'N/A'}</span>
            </div>
          </>
        )}
      </div>
      
      <div className="camera-controls">
        <button
          className={`btn-control ${camera.recording ? 'btn-stop' : 'btn-record'}`}
          onClick={() => onToggleRecording(cameraId)}
          disabled={!camera.connected}
        >
          <span className="btn-icon">{camera.recording ? '⬛' : '⏺'}</span>
          <span className="btn-text">{camera.recording ? 'Stop Recording' : 'Start Recording'}</span>
        </button>
      </div>
    </div>
  );
}

export default CameraPanel;
