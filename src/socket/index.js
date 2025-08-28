// 🔧 COMPLETE CLIENT-SIDE SOCKET MANAGER WITH DUPLICATE PREVENTION
// src/socket/index.js

import { io } from 'socket.io-client';

class SocketManager {
  constructor() {
    this.socket = null;
    this.isConnecting = false;
    this.currentRoomId = null;
    this.pendingJoinRequests = new Map(); // Prevent duplicate join requests
    this.lastJoinAttempt = null;
    this.joinCooldownMs = 2000; // 2 second cooldown between joins
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
  }

  connect() {
    if (this.socket?.connected || this.isConnecting) {
      console.log("Socket already connected or connecting");
      return this.socket;
    }

    this.isConnecting = true;
    
    this.socket = io(process.env.REACT_APP_SERVER_URL || 'http://localhost:5000', {
      transports: ['websocket'],
      upgrade: false,
      rememberUpgrade: false,
      timeout: 10000,
      forceNew: false, // ✅ Prevent multiple connections
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5,
      maxReconnectionAttempts: 5
    });

    // ✅ Connection event handlers
    this.socket.on('connect', () => {
      console.log('✅ Socket connected:', this.socket.id);
      this.isConnecting = false;
      this.reconnectAttempts = 0;
    });

    this.socket.on('disconnect', (reason) => {
      console.log('🔌 Socket disconnected:', reason);
      this.isConnecting = false;
      this.currentRoomId = null;
      this.pendingJoinRequests.clear();
      this.lastJoinAttempt = null;
    });

    this.socket.on('connect_error', (error) => {
      console.error('❌ Socket connection error:', error);
      this.isConnecting = false;
      this.reconnectAttempts++;
      
      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        console.error('❌ Max reconnection attempts reached');
        this.pendingJoinRequests.clear();
      }
    });

    // ✅ Handle reconnection
    this.socket.on('reconnect', (attemptNumber) => {
      console.log(`🔄 Reconnected after ${attemptNumber} attempts`);
      this.reconnectAttempts = 0;
      
      // Clear any stale pending requests after reconnection
      this.pendingJoinRequests.clear();
      this.lastJoinAttempt = null;
    });

    return this.socket;
  }

  // ✅ SAFE ROOM JOIN WITH COMPREHENSIVE DUPLICATE PREVENTION
  joinRoom(roomId, userId, username) {
    return new Promise((resolve, reject) => {
      // ✅ STEP 1: Connection check
      if (!this.socket?.connected) {
        reject(new Error('Socket not connected'));
        return;
      }

      // ✅ STEP 2: Input validation
      if (!roomId || !userId || !username) {
        reject(new Error('Missing required parameters: roomId, userId, or username'));
        return;
      }

      // Clean inputs
      roomId = roomId.toString().trim();
      userId = userId.toString().trim();
      username = username.toString().trim();

      // ✅ STEP 3: Cooldown check - prevent rapid successive joins
      const now = Date.now();
      if (this.lastJoinAttempt && (now - this.lastJoinAttempt) < this.joinCooldownMs) {
        const remainingCooldown = this.joinCooldownMs - (now - this.lastJoinAttempt);
        console.log(`🚫 Join request blocked - cooldown active: ${Math.ceil(remainingCooldown/1000)}s remaining`);
        reject(new Error(`Please wait ${Math.ceil(remainingCooldown/1000)} seconds before trying again`));
        return;
      }

      // ✅ STEP 4: Check if already in target room
      if (this.currentRoomId === roomId) {
        console.log(`ℹ️ Already in room ${roomId}, skipping join request`);
        resolve({ 
          roomId, 
          message: 'Already in room',
          alreadyInRoom: true 
        });
        return;
      }

      // ✅ STEP 5: Prevent duplicate requests to same room
      const requestKey = `${roomId}-${userId}`;
      
      if (this.pendingJoinRequests.has(requestKey)) {
        const pendingTime = this.pendingJoinRequests.get(requestKey);
        const timePending = now - pendingTime;
        
        if (timePending < 10000) { // 10 second pending timeout
          console.log(`🚫 Join request blocked - already pending for ${Math.ceil(timePending/1000)}s`);
          reject(new Error('Join request already in progress'));
          return;
        } else {
          // Clear stale pending request
          console.log(`🧹 Clearing stale pending request (${Math.ceil(timePending/1000)}s old)`);
          this.pendingJoinRequests.delete(requestKey);
        }
      }

      console.log(`🚪 Attempting to join room: ${roomId} as ${username} (${userId})`);

      // ✅ STEP 6: Mark as pending and set cooldown
      this.pendingJoinRequests.set(requestKey, now);
      this.lastJoinAttempt = now;

      // ✅ STEP 7: Set up response handlers with cleanup
      let resolved = false;
      let timeoutId = null;

      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        this.pendingJoinRequests.delete(requestKey);
        this.socket.off('joined_room', onJoined);
        this.socket.off('error', onError);
      };

      const onJoined = (gameRoom) => {
        if (resolved) return;
        resolved = true;
        
        console.log(`✅ Successfully joined room: ${roomId}`);
        this.currentRoomId = roomId;
        
        cleanup();
        resolve(gameRoom);
      };

      const onError = (error) => {
        if (resolved) return;
        resolved = true;
        
        console.error(`❌ Failed to join room ${roomId}:`, error.message || error);
        
        cleanup();
        reject(new Error(error.message || 'Unknown error occurred'));
      };

      // ✅ STEP 8: Set up timeout protection
      timeoutId = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        
        console.error(`⏰ Join room timeout for ${roomId} after 10 seconds`);
        
        cleanup();
        reject(new Error('Join request timeout - server did not respond'));
      }, 10000);

      // ✅ STEP 9: Attach one-time event listeners
      this.socket.once('joined_room', onJoined);
      this.socket.once('error', onError);

      // ✅ STEP 10: Send join request
      try {
        this.socket.emit('join_room', { 
          roomId, 
          userId, 
          username 
        });
        console.log(`📤 Join request sent for room ${roomId}`);
      } catch (emitError) {
        if (!resolved) {
          resolved = true;
          cleanup();
          reject(new Error(`Failed to send join request: ${emitError.message}`));
        }
      }
    });
  }

  // ✅ SAFE ROOM LEAVE WITH COMPREHENSIVE ERROR HANDLING
  leaveRoom(roomId, userId) {
    return new Promise((resolve, reject) => {
      // ✅ Connection check
      if (!this.socket?.connected) {
        reject(new Error('Socket not connected'));
        return;
      }

      // ✅ Input validation
      if (!roomId || !userId) {
        reject(new Error('Missing required parameters: roomId or userId'));
        return;
      }

      // Clean inputs
      roomId = roomId.toString().trim();
      userId = userId.toString().trim();

      // ✅ Check if actually in the room
      if (this.currentRoomId !== roomId) {
        console.log(`ℹ️ Not in room ${roomId}, skipping leave request`);
        resolve({ 
          message: 'Not in room',
          wasInRoom: false 
        });
        return;
      }

      console.log(`🚪 Attempting to leave room: ${roomId}`);

      // ✅ Set up response handlers
      let resolved = false;
      let timeoutId = null;

      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        this.socket.off('left_room', onLeft);
        this.socket.off('error', onError);
      };

      const onLeft = (response) => {
        if (resolved) return;
        resolved = true;
        
        console.log(`✅ Successfully left room: ${roomId}`);
        this.currentRoomId = null;
        
        cleanup();
        resolve(response || { message: 'Left room successfully' });
      };

      const onError = (error) => {
        if (resolved) return;
        resolved = true;
        
        console.error(`❌ Failed to leave room ${roomId}:`, error.message || error);
        
        cleanup();
        reject(new Error(error.message || 'Unknown error occurred'));
      };

      // ✅ Timeout protection
      timeoutId = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        
        console.error(`⏰ Leave room timeout for ${roomId}`);
        
        // Assume left on timeout
        this.currentRoomId = null;
        
        cleanup();
        resolve({ message: 'Leave request timeout - assumed successful' });
      }, 5000);

      // ✅ Attach event listeners
      this.socket.once('left_room', onLeft);
      this.socket.once('error', onError);

      // ✅ Send leave request
      try {
        this.socket.emit('leave_room', { roomId, userId });
        console.log(`📤 Leave request sent for room ${roomId}`);
      } catch (emitError) {
        if (!resolved) {
          resolved = true;
          cleanup();
          reject(new Error(`Failed to send leave request: ${emitError.message}`));
        }
      }
    });
  }

  // ✅ CLEANUP DUPLICATES (ADMIN FUNCTION)
  cleanupDuplicates(roomId, adminId = null) {
    if (!this.socket?.connected) {
      console.error('Socket not connected');
      return Promise.reject(new Error('Socket not connected'));
    }

    if (!roomId) {
      console.error('Missing roomId for cleanup');
      return Promise.reject(new Error('Missing roomId'));
    }

    return new Promise((resolve, reject) => {
      console.log(`🧹 Requesting duplicate cleanup for room: ${roomId}`);

      // Set up response handlers
      const onNotification = (notification) => {
        if (notification.type === 'success' && notification.message.includes('duplicate')) {
          console.log(`✅ Cleanup successful: ${notification.message}`);
          this.socket.off('notification', onNotification);
          resolve(notification);
        }
      };

      const onError = (error) => {
        console.error(`❌ Cleanup failed:`, error.message);
        this.socket.off('notification', onNotification);
        this.socket.off('error', onError);
        reject(new Error(error.message));
      };

      // Listen for responses
      this.socket.on('notification', onNotification);
      this.socket.once('error', onError);

      // Send cleanup request
      this.socket.emit('cleanup_room_duplicates', { roomId, adminId });

      // Timeout
      setTimeout(() => {
        this.socket.off('notification', onNotification);
        this.socket.off('error', onError);
        resolve({ message: 'Cleanup request sent (no response timeout)' });
      }, 5000);
    });
  }

  // ✅ FORCE CLEAR PENDING REQUESTS (for debugging/recovery)
  clearPendingRequests() {
    const pendingCount = this.pendingJoinRequests.size;
    console.log(`🧹 Clearing ${pendingCount} pending join requests`);
    this.pendingJoinRequests.clear();
    this.lastJoinAttempt = null;
    return pendingCount;
  }

  // ✅ GET STATUS AND DEBUG INFO
  getCurrentRoomId() {
    return this.currentRoomId;
  }

  isConnected() {
    return this.socket?.connected || false;
  }

  getPendingRequestsCount() {
    return this.pendingJoinRequests.size;
  }

  getConnectionInfo() {
    return {
      connected: this.isConnected(),
      connecting: this.isConnecting,
      currentRoom: this.currentRoomId,
      pendingRequests: this.getPendingRequestsCount(),
      reconnectAttempts: this.reconnectAttempts,
      socketId: this.socket?.id || null
    };
  }

  // ✅ EMERGENCY RESET (for development/debugging)
  emergencyReset() {
    console.warn('🚨 Emergency reset triggered');
    this.currentRoomId = null;
    this.pendingJoinRequests.clear();
    this.lastJoinAttempt = null;
    this.isConnecting = false;
    this.reconnectAttempts = 0;
    
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
  }

  // ✅ GRACEFUL DISCONNECT
  disconnect() {
    console.log('🔌 Disconnecting socket manager');
    
    if (this.socket) {
      // Clear all pending requests
      this.pendingJoinRequests.clear();
      
      // Remove all listeners
      this.socket.removeAllListeners();
      
      // Disconnect
      this.socket.disconnect();
      this.socket = null;
    }
    
    // Reset state
    this.currentRoomId = null;
    this.isConnecting = false;
    this.lastJoinAttempt = null;
    this.reconnectAttempts = 0;
  }
}

// ✅ SINGLETON INSTANCE
const socketManager = new SocketManager();

// ✅ AUTO-CONNECT AND CREATE SOCKET
const socket = socketManager.connect();

// ✅ EXPORTS
export default socket;
export { socketManager };

// ✅ DEVELOPMENT MODE DEBUG HELPERS
if (process.env.NODE_ENV === 'development') {
  // Attach to window for debugging
  window.socketManager = socketManager;
  window.clearPendingRequests = () => socketManager.clearPendingRequests();
  window.getConnectionInfo = () => socketManager.getConnectionInfo();
  window.emergencyReset = () => socketManager.emergencyReset();
  
  console.log('🛠️ Development mode: Socket debug helpers attached to window');
  console.log('  - window.socketManager');
  console.log('  - window.clearPendingRequests()');
  console.log('  - window.getConnectionInfo()');
  console.log('  - window.emergencyReset()');
}

console.log("✅ Enhanced SocketManager loaded with comprehensive duplicate prevention");