function QRCodeDisplay({ cameraId, qrCode, connected }) {
  return (
    <div className="qr-display">
      <div className="qr-header">
        <h4 className="qr-camera-name">Camera {cameraId}</h4>
        <div className={`status-badge ${connected ? 'connected' : 'waiting'}`}>
          <span className="status-dot"></span>
          <span className="status-text">{connected ? 'Connected' : 'Waiting'}</span>
        </div>
      </div>
      
      <div className="qr-container">
        {qrCode ? (
          <img src={qrCode} alt={`QR Code for Camera ${cameraId}`} className="qr-image" />
        ) : (
          <div className="qr-loading">
            <div className="loading-spinner"></div>
            <p>Generating QR code...</p>
          </div>
        )}
      </div>
      
      <div className="qr-footer">
        <p className="qr-hint">Scan to connect iPhone {cameraId}</p>
      </div>
    </div>
  );
}

export default QRCodeDisplay;
