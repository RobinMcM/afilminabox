// Storage Manager for "a Film in a Box" directory
// Uses File System Access API for persistent folder access

const DB_NAME = 'afilminabox-storage';
const DB_VERSION = 1;
const STORE_NAME = 'directory-handles';
const FOLDER_NAME = 'a Film in a Box';
const METADATA_FILE = 'recordings.json';

// Open IndexedDB for storing directory handle
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
}

// Save directory handle to IndexedDB
async function saveDirectoryHandle(dirHandle) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(dirHandle, 'mainDirectory');
    
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// Get directory handle from IndexedDB
async function getDirectoryHandle() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get('mainDirectory');
    
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Request directory access from user
export async function requestDirectoryAccess() {
  try {
    // Check if File System Access API is supported
    if (!('showDirectoryPicker' in window)) {
      throw new Error('File System Access API not supported in this browser');
    }
    
    // Check if we already have access
    const existingHandle = await getDirectoryHandle();
    if (existingHandle) {
      // Verify we still have permission
      const permission = await existingHandle.queryPermission({ mode: 'readwrite' });
      if (permission === 'granted') {
        console.log('✅ Using existing directory access');
        return existingHandle;
      }
    }
    
    // Request new directory access
    const dirHandle = await window.showDirectoryPicker({
      mode: 'readwrite',
      startIn: 'downloads',
    });
    
    // Save for future use
    await saveDirectoryHandle(dirHandle);
    console.log('✅ Directory access granted and saved');
    
    return dirHandle;
  } catch (error) {
    if (error.name === 'AbortError') {
      console.log('ℹ️ User cancelled directory selection');
    } else {
      console.error('❌ Error requesting directory access:', error);
    }
    throw error;
  }
}

// Get or create "a Film in a Box" folder
export async function getOrCreateFolder() {
  try {
    const parentHandle = await getDirectoryHandle();
    if (!parentHandle) {
      throw new Error('No directory handle available');
    }
    
    // Verify permission
    const permission = await parentHandle.queryPermission({ mode: 'readwrite' });
    if (permission !== 'granted') {
      const newPermission = await parentHandle.requestPermission({ mode: 'readwrite' });
      if (newPermission !== 'granted') {
        throw new Error('Permission denied');
      }
    }
    
    // Get or create "a Film in a Box" subfolder
    const folderHandle = await parentHandle.getDirectoryHandle(FOLDER_NAME, { create: true });
    console.log(`✅ Folder "${FOLDER_NAME}" ready`);
    
    return folderHandle;
  } catch (error) {
    console.error('❌ Error accessing folder:', error);
    throw error;
  }
}

// Read metadata JSON file
export async function readMetadata() {
  try {
    const folderHandle = await getOrCreateFolder();
    
    try {
      const fileHandle = await folderHandle.getFileHandle(METADATA_FILE);
      const file = await fileHandle.getFile();
      const text = await file.text();
      const metadata = JSON.parse(text);
      console.log(`📖 Read metadata: ${metadata.recordings?.length || 0} recordings`);
      return metadata;
    } catch (error) {
      // File doesn't exist yet, return empty metadata
      console.log('ℹ️ No existing metadata file, creating new');
      return { recordings: [] };
    }
  } catch (error) {
    console.error('❌ Error reading metadata:', error);
    return { recordings: [] };
  }
}

// Write metadata JSON file
export async function writeMetadata(metadata) {
  try {
    const folderHandle = await getOrCreateFolder();
    const fileHandle = await folderHandle.getFileHandle(METADATA_FILE, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(metadata, null, 2));
    await writable.close();
    console.log(`💾 Metadata saved: ${metadata.recordings?.length || 0} recordings`);
    return true;
  } catch (error) {
    console.error('❌ Error writing metadata:', error);
    throw error;
  }
}

// Save video file to folder
export async function saveVideoToFolder(blob, fileName) {
  try {
    const folderHandle = await getOrCreateFolder();
    const fileHandle = await folderHandle.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
    console.log(`✅ Video saved: ${fileName}`);
    return true;
  } catch (error) {
    console.error('❌ Error saving video:', error);
    throw error;
  }
}

// Get video file from folder
export async function getVideoFromFolder(fileName) {
  try {
    const folderHandle = await getOrCreateFolder();
    const fileHandle = await folderHandle.getFileHandle(fileName);
    const file = await fileHandle.getFile();
    const url = URL.createObjectURL(file);
    console.log(`✅ Video loaded: ${fileName}`);
    return url;
  } catch (error) {
    console.error(`❌ Error loading video ${fileName}:`, error);
    throw error;
  }
}

// Load all video URLs from folder based on metadata
export async function loadAllVideos() {
  try {
    const metadata = await readMetadata();
    const videoPreviews = {};
    
    for (const recording of metadata.recordings) {
      try {
        const url = await getVideoFromFolder(recording.fileName);
        videoPreviews[recording.id] = url;
      } catch (error) {
        console.warn(`⚠️ Could not load video: ${recording.fileName}`);
      }
    }
    
    console.log(`✅ Loaded ${Object.keys(videoPreviews).length} video previews`);
    return { metadata, videoPreviews };
  } catch (error) {
    console.error('❌ Error loading videos:', error);
    return { metadata: { recordings: [] }, videoPreviews: {} };
  }
}

// Add new recording to metadata
export async function addRecording(recordingData) {
  try {
    const metadata = await readMetadata();
    metadata.recordings = metadata.recordings || [];
    metadata.recordings.unshift(recordingData); // Add to beginning (newest first)
    await writeMetadata(metadata);
    console.log(`✅ Recording added to metadata: ${recordingData.fileName}`);
    return metadata;
  } catch (error) {
    console.error('❌ Error adding recording:', error);
    throw error;
  }
}

// Remove recording from metadata
export async function removeRecording(recordingId) {
  try {
    const metadata = await readMetadata();
    metadata.recordings = metadata.recordings.filter(r => r.id !== recordingId);
    await writeMetadata(metadata);
    console.log(`✅ Recording removed from metadata: ${recordingId}`);
    return metadata;
  } catch (error) {
    console.error('❌ Error removing recording:', error);
    throw error;
  }
}

// Check if directory access is set up
export async function hasDirectoryAccess() {
  try {
    const handle = await getDirectoryHandle();
    if (!handle) return false;
    
    const permission = await handle.queryPermission({ mode: 'readwrite' });
    return permission === 'granted';
  } catch (error) {
    return false;
  }
}

// Setup prompt - show once on first load
export async function checkAndPromptSetup() {
  const hasAccess = await hasDirectoryAccess();
  if (!hasAccess) {
    const userWants = confirm(
      '📁 Set up "a Film in a Box" folder?\n\n' +
      'This will:\n' +
      '• Create a dedicated folder in your Downloads\n' +
      '• Auto-save all recordings there\n' +
      '• Auto-load video previews in gallery\n' +
      '• Keep metadata organized\n\n' +
      'Click OK to select your Downloads folder.'
    );
    
    if (userWants) {
      try {
        await requestDirectoryAccess();
        await getOrCreateFolder(); // Create the subfolder
        alert('✅ Setup complete! Videos will now save to:\nDownloads/a Film in a Box/');
        return true;
      } catch (error) {
        alert('❌ Setup cancelled. You can set this up later from settings.');
        return false;
      }
    }
  }
  return hasAccess;
}
