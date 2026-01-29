import { useState, useEffect } from 'react';

function VideoGallery({ session }) {
  const [recordings, setRecordings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // 'all', 'raw', 'processing', 'processed'
  const [selectedRecording, setSelectedRecording] = useState(null);

  useEffect(() => {
    fetchRecordings();
  }, []);

  const fetchRecordings = async () => {
    try {
      const response = await fetch('/api/recordings');
      const data = await response.json();
      if (data.success) {
        setRecordings(data.recordings);
      }
    } catch (error) {
      console.error('❌ Error fetching recordings:', error);
    } finally {
      setLoading(false);
    }
  };

  const deleteRecording = async (id) => {
    if (!confirm('Are you sure you want to delete this recording?')) return;
    
    try {
      const response = await fetch(`/api/recordings/${id}`, {
        method: 'DELETE'
      });
      
      if (response.ok) {
        setRecordings(prev => prev.filter(r => r.id !== id));
        console.log('✅ Recording deleted');
      }
    } catch (error) {
      console.error('❌ Error deleting recording:', error);
    }
  };

  const processRecording = async (id, type) => {
    try {
      const response = await fetch(`/api/recordings/${id}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type })
      });
      
      const data = await response.json();
      if (data.success) {
        console.log('✅ Processing started:', data.jobId);
        // Update recording status
        setRecordings(prev => prev.map(r => 
          r.id === id ? { ...r, status: 'processing' } : r
        ));
      }
    } catch (error) {
      console.error('❌ Error processing recording:', error);
    }
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
      raw: { label: 'Raw', class: 'status-raw' },
      processing: { label: 'Processing', class: 'status-processing' },
      processed: { label: 'Processed', class: 'status-processed' },
      failed: { label: 'Failed', class: 'status-failed' }
    };
    
    const badge = badges[status] || badges.raw;
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
                {recording.thumbnailPath ? (
                  <img 
                    src={`/api/recordings/${recording.id}/thumbnail`} 
                    alt={`Recording ${recording.id}`}
                    onError={(e) => {
                      e.target.style.display = 'none';
                      e.target.nextSibling.style.display = 'flex';
                    }}
                  />
                ) : null}
                <div className="thumbnail-placeholder" style={{ display: recording.thumbnailPath ? 'none' : 'flex' }}>
                  <span className="placeholder-icon">🎥</span>
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
                {recording.status === 'raw' && (
                  <button 
                    className="action-btn btn-process"
                    onClick={() => processRecording(recording.id, 'remove-background')}
                    title="Remove background"
                  >
                    <span className="btn-icon">🎨</span>
                    Process
                  </button>
                )}
                
                <a 
                  href={`/api/recordings/${recording.id}/download`}
                  className="action-btn btn-download"
                  download
                  title="Download"
                >
                  <span className="btn-icon">⬇️</span>
                  Download
                </a>
                
                <button 
                  className="action-btn btn-delete"
                  onClick={() => deleteRecording(recording.id)}
                  title="Delete"
                >
                  <span className="btn-icon">🗑️</span>
                  Delete
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
