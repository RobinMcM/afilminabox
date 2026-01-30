import { useState, useEffect, useRef } from 'react';
import * as StorageManager from '../utils/storageManager';

function VideoGallery({ session, onAddToTimeline }) {
  const [recordings, setRecordings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // 'all', 'raw', 'processing', 'processed'
  const [selectedRecording, setSelectedRecording] = useState(null);
  const [videoPreview, setVideoPreview] = useState(null); // For modal playback
  const [videoPreviews, setVideoPreviews] = useState({}); // Map of recordingId -> blob URL
  const [hasStorageAccess, setHasStorageAccess] = useState(false);
  const fileInputRef = useRef(null);
  const pendingRecordingIdRef = useRef(null);

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

  const fetchRecordings = async () => {
    try {
      // Check if we have structured storage access
      const hasAccess = await StorageManager.hasDirectoryAccess();
      setHasStorageAccess(hasAccess);
      
      if (hasAccess) {
        // Load from structured folder with automatic video previews
        console.log('📁 Loading from "a Film in a Box" folder...');
        const { metadata, videoPreviews: loadedPreviews } = await StorageManager.loadAllVideos();
        setRecordings(metadata.recordings);
        setVideoPreviews(loadedPreviews);
        console.log(`📹 Loaded ${metadata.recordings.length} recordings with ${Object.keys(loadedPreviews).length} video previews`);
      } else {
        // Fallback: load from localStorage (legacy)
        console.log('ℹ️ Loading from localStorage (fallback)');
        const localRecordings = JSON.parse(localStorage.getItem('recordings') || '[]');
        setRecordings(localRecordings);
        console.log(`📹 Loaded ${localRecordings.length} recordings from localStorage`);
      }
    } catch (error) {
      console.error('❌ Error loading recordings:', error);
      setRecordings([]);
    } finally {
      setLoading(false);
    }
  };

  const deleteRecording = async (id) => {
    const message = hasStorageAccess
      ? 'Remove this recording from the list?\n\nNote: This removes the entry but the video file remains in the folder.'
      : 'Remove this recording from the list?\n\nNote: This only removes the entry from the gallery. The video file remains in your Downloads folder.';
    
    if (!confirm(message)) return;
    
    try {
      if (hasStorageAccess) {
        // Remove from structured storage
        await StorageManager.removeRecording(id);
        const metadata = await StorageManager.readMetadata();
        setRecordings(metadata.recordings);
        console.log('✅ Recording removed from metadata');
      } else {
        // Remove from localStorage
        const updatedRecordings = recordings.filter(r => r.id !== id);
        localStorage.setItem('recordings', JSON.stringify(updatedRecordings));
        setRecordings(updatedRecordings);
        console.log('✅ Recording removed from gallery');
      }
    } catch (error) {
      console.error('❌ Error deleting recording:', error);
      alert('Error deleting recording. Please try again.');
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
  
  const loadVideoPreview = async (recording) => {
    // Only needed for fallback mode (no structured storage)
    if (hasStorageAccess) {
      console.log('ℹ️ Video should already be loaded from folder');
      return;
    }
    
    // Fallback: manual file selection
    pendingRecordingIdRef.current = recording.id;
    fileInputRef.current?.click();
  };
  
  const handleVideoFileSelected = (e) => {
    const file = e.target.files?.[0];
    const recordingId = pendingRecordingIdRef.current;
    
    if (file && recordingId) {
      const url = URL.createObjectURL(file);
      setVideoPreviews(prev => ({
        ...prev,
        [recordingId]: url
      }));
      console.log(`✅ Video preview loaded for recording ${recordingId}`);
      
      // Reset
      e.target.value = '';
      pendingRecordingIdRef.current = null;
    }
  };
  
  const setupStorage = async () => {
    try {
      await StorageManager.requestDirectoryAccess();
      await StorageManager.getOrCreateFolder();
      alert('✅ Setup complete! Reloading gallery...');
      fetchRecordings();
    } catch (error) {
      console.error('❌ Setup failed:', error);
    }
  };
  
  const playVideoInModal = (recording) => {
    setVideoPreview(recording);
  };
  
  const closeVideoModal = () => {
    setVideoPreview(null);
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
      <input
        ref={fileInputRef}
        type="file"
        accept="video/webm,video/mp4"
        style={{ display: 'none' }}
        onChange={handleVideoFileSelected}
      />
      
      <div className="gallery-header">
        <div className="gallery-title-section">
          <h2 className="section-title">📹 Video Gallery</h2>
          <p className="gallery-subtitle">
            {recordings.length} recording{recordings.length !== 1 ? 's' : ''} total
            {!hasStorageAccess && (
              <button 
                className="setup-storage-btn"
                onClick={setupStorage}
                title="Set up structured storage"
              >
                📁 Setup Folder
              </button>
            )}
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
                {videoPreviews[recording.id] ? (
                  <div className="thumbnail-video-container">
                    <video
                      src={videoPreviews[recording.id]}
                      className="thumbnail-video"
                      preload="metadata"
                    />
                    <div 
                      className="thumbnail-play-overlay"
                      onClick={() => playVideoInModal(recording)}
                    >
                      <div className="play-button">
                        <span className="play-icon">▶</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="thumbnail-placeholder">
                    <span className="placeholder-icon">🎥</span>
                    <div className="local-badge">LOCAL</div>
                    <button
                      className="load-preview-btn"
                      onClick={() => loadVideoPreview(recording)}
                      title="Load video preview"
                    >
                      Load Preview
                    </button>
                  </div>
                )}
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
      
      {/* Video Preview Modal */}
      {videoPreview && videoPreviews[videoPreview.id] && (
        <div className="video-modal" onClick={closeVideoModal}>
          <div className="video-modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="video-modal-close" onClick={closeVideoModal}>
              ×
            </button>
            <div className="video-modal-header">
              <h3>Camera {videoPreview.cameraId} Recording</h3>
              <p className="video-modal-date">{formatDate(videoPreview.timestamp)}</p>
            </div>
            <video
              src={videoPreviews[videoPreview.id]}
              controls
              autoPlay
              className="video-modal-player"
            />
            <div className="video-modal-info">
              <span>Duration: {formatDuration(videoPreview.duration || 0)}</span>
              <span>Size: {formatFileSize(videoPreview.fileSize || 0)}</span>
              <span>File: {videoPreview.fileName}</span>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export default VideoGallery;
