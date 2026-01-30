import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';

const VideoTimeline = forwardRef(({ videos, setVideos }, ref) => {
  const [currentVideoIndex, setCurrentVideoIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [playheadPosition, setPlayheadPosition] = useState(0);
  
  // Range selection markers
  const [startMarkerPosition, setStartMarkerPosition] = useState(0);
  const [stopMarkerPosition, setStopMarkerPosition] = useState(100);
  const [isDraggingStart, setIsDraggingStart] = useState(false);
  const [isDraggingStop, setIsDraggingStop] = useState(false);
  
  // Modal playback
  const [showModal, setShowModal] = useState(false);
  const [modalVideoIndex, setModalVideoIndex] = useState(0);
  const [modalIsPlaying, setModalIsPlaying] = useState(false);
  
  const videoRef = useRef(null);
  const modalVideoRef = useRef(null);
  const timelineBarRef = useRef(null);
  const fileInputRef = useRef(null);
  const pendingRecordingRef = useRef(null);

  // Expose methods to parent via ref
  useImperativeHandle(ref, () => ({
    addToTimeline: (recording, videoUrl) => {
      if (videoUrl) {
        // Direct add with existing video URL (no file picker needed)
        const videoWithUrl = {
          ...recording,
          videoUrl: videoUrl
        };
        
        setVideos(prev => [...prev, videoWithUrl]);
        console.log(`✅ Added "${recording.fileName}" to timeline (auto)`);
      } else {
        // Fallback: prompt for file selection (legacy mode)
        pendingRecordingRef.current = recording;
        fileInputRef.current?.click();
      }
    }
  }));

  // Handle file selection (fallback mode only)
  const handleFileSelected = (e) => {
    const file = e.target.files?.[0];
    const recording = pendingRecordingRef.current;
    
    if (file && recording) {
      // Verify filename matches
      if (file.name !== recording.fileName) {
        alert(`⚠️ File mismatch!\n\nExpected: ${recording.fileName}\nSelected: ${file.name}\n\nPlease select the correct file.`);
        return;
      }
      
      const url = URL.createObjectURL(file);
      const videoWithFile = {
        ...recording,
        videoUrl: url,
        fileObject: file
      };
      
      setVideos(prev => [...prev, videoWithFile]);
      console.log(`✅ Added "${recording.fileName}" to timeline`);
      
      // Reset
      pendingRecordingRef.current = null;
      e.target.value = '';
    }
  };

  // Calculate total timeline duration
  const totalDuration = videos.reduce((sum, v) => sum + (v.duration || 0), 0);

  // Handle video playback
  useEffect(() => {
    if (videos.length > 0 && currentVideoIndex < videos.length) {
      const video = videos[currentVideoIndex];
      if (videoRef.current && video.videoUrl) {
        videoRef.current.src = video.videoUrl;
        if (isPlaying) {
          videoRef.current.play().catch(err => {
            console.error('❌ Error playing video:', err);
            setIsPlaying(false);
          });
        }
      }
    }
  }, [currentVideoIndex, videos, isPlaying]);

  // Handle video end - auto-advance
  const handleVideoEnded = () => {
    if (currentVideoIndex < videos.length - 1) {
      setCurrentVideoIndex(prev => prev + 1);
    } else {
      setIsPlaying(false);
      setCurrentVideoIndex(0);
      console.log('🎬 Timeline playback complete');
    }
  };

  // Update playhead position
  const handleTimeUpdate = () => {
    if (!videoRef.current || totalDuration === 0) return;
    
    const currentTime = videoRef.current.currentTime;
    
    // Calculate total elapsed time across all videos
    let totalElapsed = 0;
    for (let i = 0; i < currentVideoIndex; i++) {
      totalElapsed += videos[i].duration || 0;
    }
    totalElapsed += currentTime;
    
    const position = (totalElapsed / totalDuration) * 100;
    setPlayheadPosition(Math.min(position, 100));
    setCurrentTime(totalElapsed);
  };

  // Play/Pause toggle
  const togglePlayback = () => {
    if (!videos.length) return;
    
    if (isPlaying) {
      videoRef.current?.pause();
      setIsPlaying(false);
    } else {
      videoRef.current?.play();
      setIsPlaying(true);
    }
  };

  // Remove video from timeline
  const removeVideo = (index) => {
    setVideos(prev => prev.filter((_, i) => i !== index));
    
    // Reset playback if removed current video
    if (index === currentVideoIndex) {
      setIsPlaying(false);
      setCurrentVideoIndex(0);
    } else if (index < currentVideoIndex) {
      setCurrentVideoIndex(prev => prev - 1);
    }
  };

  // Save timeline configuration
  const saveTimelineConfig = () => {
    const config = {
      savedAt: new Date().toISOString(),
      videos: videos.map(v => ({
        recordingId: v.id,
        fileName: v.fileName,
        duration: v.duration,
        cameraId: v.cameraId
      }))
    };
    localStorage.setItem('timeline-config', JSON.stringify(config));
    console.log('💾 Timeline configuration saved');
    alert('✅ Timeline configuration saved!');
  };

  // Clear all videos
  const clearTimeline = () => {
    if (confirm('Clear all videos from timeline?')) {
      setVideos([]);
      setCurrentVideoIndex(0);
      setIsPlaying(false);
      setPlayheadPosition(0);
    }
  };

  // Format time display
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };
  
  // Calculate which videos are in the selected range
  const getVideoRangeFromMarkers = () => {
    if (videos.length === 0) {
      return { startIndex: 0, endIndex: 0 };
    }
    
    // When durations are missing/zero, treat each video as equal width (equal segments)
    if (totalDuration === 0) {
      const n = videos.length;
      const startIndex = Math.min(n - 1, Math.floor((startMarkerPosition / 100) * n));
      // Last video whose segment overlaps the stop position
      const endIndex = Math.min(n - 1, Math.max(0, Math.ceil((stopMarkerPosition / 100) * n) - 1));
      return { startIndex, endIndex: Math.max(endIndex, startIndex) };
    }
    
    let cumulativeTime = 0;
    let startIndex = 0;
    let endIndex = videos.length - 1;
    
    // Find which videos fall within the marker range by duration
    for (let i = 0; i < videos.length; i++) {
      const videoStart = (cumulativeTime / totalDuration) * 100;
      const videoEnd = ((cumulativeTime + (videos[i].duration || 0)) / totalDuration) * 100;
      
      if (startMarkerPosition >= videoStart && startMarkerPosition < videoEnd) {
        startIndex = i;
      }
      if (stopMarkerPosition > videoStart && stopMarkerPosition <= videoEnd) {
        endIndex = i;
        break;
      }
      
      cumulativeTime += videos[i].duration || 0;
    }
    
    return { startIndex, endIndex: Math.max(endIndex, startIndex) };
  };
  
  // Marker drag handlers
  const handleMarkerMouseDown = (markerType) => (e) => {
    e.preventDefault();
    if (markerType === 'start') {
      setIsDraggingStart(true);
    } else {
      setIsDraggingStop(true);
    }
  };
  
  const handleMouseMove = (e) => {
    if (!timelineBarRef.current) return;
    
    const rect = timelineBarRef.current.getBoundingClientRect();
    const position = ((e.clientX - rect.left) / rect.width) * 100;
    const clampedPosition = Math.max(0, Math.min(100, position));
    
    if (isDraggingStart) {
      // Don't allow start to go past stop
      setStartMarkerPosition(Math.min(clampedPosition, stopMarkerPosition - 1));
    } else if (isDraggingStop) {
      // Don't allow stop to go before start
      setStopMarkerPosition(Math.max(clampedPosition, startMarkerPosition + 1));
    }
  };
  
  const handleMouseUp = () => {
    setIsDraggingStart(false);
    setIsDraggingStop(false);
  };
  
  // Attach drag handlers to window
  useEffect(() => {
    if (isDraggingStart || isDraggingStop) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDraggingStart, isDraggingStop, startMarkerPosition, stopMarkerPosition]);
  
  // Modal playback handlers
  const playSelectedRange = () => {
    const { startIndex } = getVideoRangeFromMarkers();
    setModalVideoIndex(startIndex);
    setShowModal(true);
    setModalIsPlaying(true);
  };
  
  const handleModalVideoEnded = () => {
    const { startIndex, endIndex } = getVideoRangeFromMarkers();
    
    if (modalVideoIndex < endIndex) {
      // Play next video in range
      setModalVideoIndex(prev => prev + 1);
    } else {
      // Range complete
      setModalIsPlaying(false);
      console.log('🎬 Selected range playback complete');
    }
  };
  
  const closeModal = () => {
    setShowModal(false);
    setModalIsPlaying(false);
    if (modalVideoRef.current) {
      modalVideoRef.current.pause();
      modalVideoRef.current.currentTime = 0;
    }
  };
  
  // Update modal video source when index changes
  useEffect(() => {
    if (showModal && modalVideoIndex < videos.length && modalVideoRef.current) {
      const video = videos[modalVideoIndex];
      if (video && video.videoUrl) {
        modalVideoRef.current.src = video.videoUrl;
        if (modalIsPlaying) {
          modalVideoRef.current.play().catch(err => {
            console.error('❌ Error playing modal video:', err);
          });
        }
      }
    }
  }, [modalVideoIndex, showModal, videos, modalIsPlaying]);

  if (videos.length === 0) {
    return (
      <section className="video-timeline-empty">
        <input
          ref={fileInputRef}
          type="file"
          accept="video/webm,video/mp4"
          style={{ display: 'none' }}
          onChange={handleFileSelected}
        />
        <div className="timeline-empty-message">
          <span className="timeline-empty-icon">🎬</span>
          <p className="timeline-empty-text">Timeline is empty</p>
          <p className="timeline-empty-hint">Click ⬆️ on videos below to add them</p>
        </div>
      </section>
    );
  }

  return (
    <section className="video-timeline">
      <input
        ref={fileInputRef}
        type="file"
        accept="video/webm,video/mp4"
        style={{ display: 'none' }}
        onChange={handleFileSelected}
      />
      
      <div className="timeline-header">
        <h3 className="timeline-title">
          <span className="timeline-icon">🎞️</span>
          Video Timeline
        </h3>
        <div className="timeline-info">
          {videos.length} video{videos.length !== 1 ? 's' : ''} • {formatTime(totalDuration)}
        </div>
      </div>

      {/* Video Player (hidden but functional) */}
      <video
        ref={videoRef}
        className="timeline-video-player"
        onEnded={handleVideoEnded}
        onTimeUpdate={handleTimeUpdate}
        playsInline
      />

      {/* Timeline Bar with Range Overlay */}
      <div className="timeline-bar-container">
        {/* Editor-style range overlay: track + selection bar + circle handles */}
        <div className="timeline-range-wrapper" ref={timelineBarRef}>
          <div className="timeline-range-overlay">
            <div className="timeline-range-track" />
            {/* Selection bar (line covering timeline section) */}
            <div 
              className="timeline-selection-range"
              style={{
                left: `${startMarkerPosition}%`,
                width: `${stopMarkerPosition - startMarkerPosition}%`
              }}
            />
            {/* Circle handles above the track */}
            <div 
              className="range-handle range-handle-start"
              style={{ left: `${startMarkerPosition}%` }}
              onMouseDown={handleMarkerMouseDown('start')}
              title="Drag to set start"
            />
            <div 
              className="range-handle range-handle-stop"
              style={{ left: `${stopMarkerPosition}%` }}
              onMouseDown={handleMarkerMouseDown('stop')}
              title="Drag to set end"
            />
          </div>
          <div className="timeline-bar">
            {videos.map((video, index) => {
              const segmentWidth = ((video.duration || 0) / totalDuration) * 100;
              const isActive = index === currentVideoIndex;
              
              return (
                <div
                  key={video.id || index}
                  className={`timeline-segment ${isActive ? 'active' : ''}`}
                  style={{ width: `${segmentWidth}%` }}
                  onClick={() => {
                    if (!isPlaying) {
                      setCurrentVideoIndex(index);
                    }
                  }}
                >
                  <div className="segment-label">
                    <span className="segment-camera">Cam {video.cameraId}</span>
                    <span className="segment-duration">{formatTime(video.duration || 0)}</span>
                  </div>
                  <button
                    className="segment-remove"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeVideo(index);
                    }}
                    title="Remove from timeline"
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="timeline-controls">
        <div className="timeline-controls-left">
          <button
            className="timeline-btn timeline-btn-play-range"
            onClick={playSelectedRange}
            disabled={videos.length === 0}
            title="Play selected range"
          >
            <span className="btn-icon">▶</span>
            <span className="btn-text">Play Selected Range</span>
          </button>
          
          <div className="timeline-range-info">
            {(() => {
              const { startIndex, endIndex } = getVideoRangeFromMarkers();
              const videoCount = endIndex - startIndex + 1;
              return `${videoCount} video${videoCount !== 1 ? 's' : ''} selected`;
            })()}
          </div>
        </div>
        
        <div className="timeline-controls-right">
          <button
            className="timeline-btn timeline-btn-save"
            onClick={saveTimelineConfig}
            title="Save timeline configuration"
          >
            <span className="btn-icon">💾</span>
            <span className="btn-text">Save</span>
          </button>
          
          <button
            className="timeline-btn timeline-btn-clear"
            onClick={clearTimeline}
            title="Clear timeline"
          >
            <span className="btn-icon">🗑️</span>
            <span className="btn-text">Clear</span>
          </button>
        </div>
      </div>
      
      {/* Video Modal */}
      {showModal && modalVideoIndex < videos.length && videos[modalVideoIndex] && (
        <div className="video-modal" onClick={closeModal}>
          <div className="video-modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="video-modal-close" onClick={closeModal}>
              ×
            </button>
            
            <div className="video-modal-header">
              <h3>Timeline Playback</h3>
              <p className="video-modal-info">
                Video {modalVideoIndex + 1} of {videos.length} • 
                Camera {videos[modalVideoIndex].cameraId}
              </p>
            </div>
            
            <video
              ref={modalVideoRef}
              src={videos[modalVideoIndex].videoUrl}
              controls
              autoPlay={modalIsPlaying}
              onEnded={handleModalVideoEnded}
              className="video-modal-player"
            />
            
            <div className="video-modal-progress">
              <span>
                Playing range: Video {getVideoRangeFromMarkers().startIndex + 1} 
                {' to '}
                {getVideoRangeFromMarkers().endIndex + 1}
              </span>
            </div>
          </div>
        </div>
      )}
    </section>
  );
});

VideoTimeline.displayName = 'VideoTimeline';

export default VideoTimeline;
