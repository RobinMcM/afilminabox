import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';

const VideoTimeline = forwardRef(({ videos, setVideos }, ref) => {
  const [currentVideoIndex, setCurrentVideoIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [playheadPosition, setPlayheadPosition] = useState(0);
  const videoRef = useRef(null);
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

      {/* Timeline Bar */}
      <div className="timeline-bar-container">
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
          
          {/* Playhead */}
          <div
            className="timeline-playhead"
            style={{ left: `${playheadPosition}%` }}
          />
        </div>
      </div>

      {/* Controls */}
      <div className="timeline-controls">
        <div className="timeline-controls-left">
          <button
            className={`timeline-btn timeline-btn-play ${isPlaying ? 'playing' : ''}`}
            onClick={togglePlayback}
            title={isPlaying ? 'Pause' : 'Play'}
          >
            <span className="btn-icon">{isPlaying ? '⏸' : '▶'}</span>
            <span className="btn-text">{isPlaying ? 'Pause' : 'Play'}</span>
          </button>
          
          <div className="timeline-time-display">
            {formatTime(currentTime)} / {formatTime(totalDuration)}
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
    </section>
  );
});

VideoTimeline.displayName = 'VideoTimeline';

export default VideoTimeline;
