import CameraPanel from './CameraPanel';

function CameraGrid({ cameras, onToggleRecording, onZoomChange }) {
  return (
    <section className="camera-section">
      <h2 className="section-title">Live Camera Feeds</h2>
      
      <div className="camera-grid">
        {[1, 2, 3].map((cameraId) => (
          <CameraPanel
            key={cameraId}
            cameraId={cameraId}
            camera={cameras[cameraId]}
            onToggleRecording={onToggleRecording}
            onZoomChange={onZoomChange}
          />
        ))}
      </div>
    </section>
  );
}

export default CameraGrid;
