import { useState, useEffect } from 'react';

function VideoGallery({ session, onAddToTimeline }) {
  const [recordings, setRecordings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // 'all', 'raw', 'processing', 'processed'
  const [selectedRecording, setSelectedRecording] = useState(null);

  useEffect(() => {
    fetchRecordings();
    
    // Listen for storage events (when recordings are added from other tabs)
    const handleStorageChange = (e) => {
      if (e.key === 'recordings') {
        fetchRecordings();
      }
    };
    
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  const fetchRecordings = () => {
    try {
      // Read from localStorage instead of API
      const localRecordings = JSON.parse(localStorage.getItem('recordings') || '[]');
      setRecordings(localRecordings);
      console.log(`📹 Loaded ${localRecordings.length} recordings from localStorage`);
    } catch (error) {
      console.error('❌ Error loading recordings from localStorage:', error);
      setRecordings([]);
    } finally {
      setLoading(false);
    }
  };

  const deleteRecording = (id) => {
    if (!confirm('Remove this recording from the list?\n\nNote: This only removes the entry from the gallery. The video file remains in your Downloads folder.')) return;
    
    try {
      // Remove from localStorage
      const updatedRecordings = recordings.filter(r => r.id !== id);
      localStorage.setItem('recordings', JSON.stringify(updatedRecordings));
      setRecordings(updatedRecordings);
      console.log('✅ Recording removed from gallery');
    } catch (error) {
      console.error('❌ Error deleting recording:', error);
    }
  };

  const processRecording = (id, type) => {
    alert(`Processing feature coming soon!\n\nTo process this video:\n1. Locate the file in your Downloads folder\n2. Upload to media-handler API\n3. Apply AI background removal\n\nFile: ${recordings.find(r => r.id === id)?.fileName}`);
    
    // TODO: Implement manual upload to server for processing
    // For now, this is just informational
  };

  const filteredRecordings = recordings.filter(r => {
    if (filter === 'all') return true;
    return r.status === filter;
  });

  const formatDuration = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatFileSize = (bytes) => {
    const mb = (bytes / (1024 * 1024)).toFixed(2);
    return `${mb} MB`;
  };

  const formatDate = (timestamp) => {
    return new Date(timestamp).toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getStatusBadge = (status) => {
    const badges = {
      local: { label: 'Saved', class: 'status-local' },
      raw: { label: 'Raw', class: 'status-raw' },
      processing: { label: 'Processing', class: 'status-processing' },
      processed: { label: 'Processed', class: 'status-processed' },
      failed: { label: 'Failed', class: 'status-failed' }
    };
    
    const badge = badges[status] || badges.local;
    return <span className={`recording-status ${badge.class}`}>{badge.label}</span>;
  };

  if (loading) {
    return (
      <div className="gallery-loading">
        <div className="loading-spinner"></div>
        <p>Loading recordings...</p>
      </div>
    );
  }

  return (
    <section className="video-gallery">
      <div className="gallery-header">
        <div className="gallery-title-section">
          <h2 className="section-title">📹 Video Gallery</h2>
          <p className="gallery-subtitle">
            {recordings.length} recording{recordings.length !== 1 ? 's' : ''} total
          </p>
        </div>
        
        <div className="gallery-filters">
          <button 
            className={`filter-btn ${filter === 'all' ? 'active' : ''}`}
            onClick={() => setFilter('all')}
          >
            All ({recordings.length})
          </button>
          <button 
            className={`filter-btn ${filter === 'raw' ? 'active' : ''}`}
            onClick={() => setFilter('raw')}
          >
            Raw ({recordings.filter(r => r.status === 'raw').length})
          </button>
          <button 
            className={`filter-btn ${filter === 'processing' ? 'active' : ''}`}
            onClick={() => setFilter('processing')}
          >
            Processing ({recordings.filter(r => r.status === 'processing').length})
          </button>
          <button 
            className={`filter-btn ${filter === 'processed' ? 'active' : ''}`}
            onClick={() => setFilter('processed')}
          >
            Processed ({recordings.filter(r => r.status === 'processed').length})
          </button>
        </div>
      </div>

      {filteredRecordings.length === 0 ? (
        <div className="gallery-empty">
          <div className="empty-icon">🎬</div>
          <h3>No recordings yet</h3>
          <p>Start recording from the camera control panel</p>
        </div>
      ) : (
        <div className="recordings-grid">
          {filteredRecordings.map(recording => (
            <div key={recording.id} className="recording-card">
              <div className="recording-thumbnail">
                <div className="thumbnail-placeholder">
                  <span className="placeholder-icon">🎥</span>
                  <div className="local-badge">LOCAL</div>
                </div>
                <div className="thumbnail-overlay">
                  <span className="camera-badge">Camera {recording.cameraId}</span>
                  {getStatusBadge(recording.status)}
                </div>
              </div>

              <div className="recording-info">
                <div className="recording-meta">
                  <span className="meta-item">
                    <span className="meta-icon">⏱</span>
                    {formatDuration(recording.duration || 0)}
                  </span>
                  <span className="meta-item">
                    <span className="meta-icon">📦</span>
                    {formatFileSize(recording.fileSize || 0)}
                  </span>
                </div>
                
                <div className="recording-date">
                  {formatDate(recording.timestamp)}
                </div>

                {recording.filmGuid && (
                  <div className="recording-guids">
                    <div className="guid-item">
                      <span className="guid-label">Film:</span>
                      <span className="guid-value">{recording.filmGuid.slice(0, 8)}...</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="recording-actions">
                <button 
                  className="action-btn btn-timeline"
                  onClick={() => onAddToTimeline?.(recording)}
                  title="Add to timeline"
                >
                  <span className="btn-icon">⬆️</span>
                  Add to Timeline
                </button>
                
                <div className="action-info">
                  <span className="info-icon">📁</span>
                  <span className="info-text">File: {recording.fileName}</span>
                </div>
                
                <button 
                  className="action-btn btn-delete"
                  onClick={() => deleteRecording(recording.id)}
                  title="Remove from list"
                >
                  <span className="btn-icon">🗑️</span>
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default VideoGallery;
