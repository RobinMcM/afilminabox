# Video Gallery Feature

## Overview

The Video Gallery is a viewing and management interface for recorded camera footage in the afilminabox system.

## Features

- **Grid View**: Display recordings in a responsive grid layout
- **Filtering**: Filter by status (All, Raw, Processing, Processed)
- **Metadata Display**: Show Film GUID, Production GUID, camera ID, duration, file size
- **Status Tracking**: Visual badges for recording status
- **Actions**: Process, Download, Delete recordings
- **Cyberpunk Theme**: Consistent with control panel aesthetics

## Storage Structure

```
/root/media-files/
└── productions/
    └── {productionGuid}/
        └── {filmGuid}/
            ├── camera-1/
            │   ├── raw/
            │   │   ├── recording-{timestamp}.mp4
            │   │   └── thumbnail-{timestamp}.jpg
            │   └── processed/
            │       ├── no-bg-{timestamp}.mp4
            │       └── final-{timestamp}.mp4
            ├── camera-2/
            └── camera-3/
```

## Valkey Data Schema

### Recording Metadata
```javascript
HSET recording:{recordingId}
  id                      "{uuid}"
  filmGuid                "{guid}"
  productionCompanyGuid   "{guid}"
  cameraId                "1"
  timestamp               "2026-01-29T..."
  duration                "120"  // seconds
  fileSize                "52428800"  // bytes
  filePath                "/root/media-files/..."
  thumbnailPath           "/root/media-files/...thumbnail.jpg"
  status                  "raw|processing|processed|failed"
```

### Processing Job
```javascript
HSET job:{jobId}
  id            "{uuid}"
  recordingId   "{uuid}"
  type          "remove-background|add-backdrop"
  status        "queued|processing|complete|failed"
  createdAt     "2026-01-29T..."
  startedAt     "2026-01-29T..." (when processing starts)
  completedAt   "2026-01-29T..." (when finished)
  outputPath    "/root/media-files/..." (result file)
  error         "error message" (if failed)
```

## API Endpoints

### List Recordings
```
GET /api/recordings
Response: { success: true, recordings: [...] }
```

### Get Single Recording
```
GET /api/recordings/:id
Response: { success: true, recording: {...} }
```

### Get Thumbnail
```
GET /api/recordings/:id/thumbnail
Returns: Image file or placeholder
```

### Download Recording
```
GET /api/recordings/:id/download
Returns: Video file download
```

### Process Recording
```
POST /api/recordings/:id/process
Body: { type: "remove-background" | "add-backdrop" }
Response: { success: true, jobId: "...", status: "processing" }
```

### Delete Recording
```
DELETE /api/recordings/:id
Response: { success: true, message: "Recording deleted" }
```

## Navigation

The app header includes navigation buttons to switch between:
- **Camera Control**: Live camera feeds and QR codes
- **Video Gallery**: Recorded footage library

## Recording Statuses

- **Raw**: Original footage, not processed
- **Processing**: Currently being processed by AI
- **Processed**: AI processing complete
- **Failed**: Processing error occurred

## Integration Points

### To afilminabox
- Recordings automatically saved to `/root/media-files/`
- Metadata stored in Valkey for fast querying
- Thumbnails auto-generated

### To media-handler
- Process button sends request to media-handler API
- FFmpeg operations (background removal, transcoding)
- Video stitching and editing

### To openrouter-gateway
- AI background removal (frame-by-frame processing)
- AI backdrop generation/insertion
- Image-to-video operations

## Next Steps

1. **Upload System**: Auto-upload browser-recorded videos to server
2. **Thumbnail Generation**: Extract first frame or keyframe for preview
3. **Media-Handler Integration**: Connect process button to actual FFmpeg API
4. **Background Processing**: Queue system for AI operations
5. **Backdrop Library**: UI for selecting/generating backdrops
6. **Progress Tracking**: Real-time status updates during processing
7. **Multi-camera Stitching**: Combine footage from multiple cameras

## Testing

To add sample recordings for testing:

```bash
# Create sample recording in Valkey
redis-cli HMSET recording:test-001 \
  id "test-001" \
  filmGuid "test-film-guid" \
  productionCompanyGuid "test-prod-guid" \
  cameraId "1" \
  timestamp "2026-01-29T12:00:00Z" \
  duration "120" \
  fileSize "50000000" \
  filePath "/root/media-files/test.mp4" \
  status "raw"
```

## Configuration

- **MEDIA_DIR**: Environment variable for storage location (default: `/root/media-files`)
- **VALKEY_URL**: Valkey connection string (default: `redis://valkey:6379`)
- **PROCESSING_QUEUE**: Job queue name (default: `processing-jobs`)

## Troubleshooting

### Recordings not showing
1. Check Valkey connection: `curl http://localhost:8080/health`
2. Check storage directory exists: `ls -la /root/media-files/productions/`
3. Check browser console for API errors

### Thumbnails not loading
1. Verify thumbnail files exist in storage
2. Check file permissions: `chmod 644 /root/media-files/productions/**/thumbnails/*.jpg`
3. Verify API endpoint: `curl http://localhost:8080/api/recordings/test-001/thumbnail`

### Processing not working
1. Check media-handler API is running: `docker ps | grep media-handler`
2. Verify API key is set in environment
3. Check job queue in Valkey: `redis-cli KEYS job:*`
