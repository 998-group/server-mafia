// 🔧 CLIENT-SIDE DUPLICATE PREVENTION

// src/socket/index.js - Client Socket Configuration
import { io } from 'socket.io-client';

class SocketManager {
  constructor() {
    this.socket = null;
    this.isConnecting = false;
    this.currentRoomId = null;
    this.pendingJoinRequests = new Map(); // Prevent duplicate join requests
    this.lastJoinAttempt = null;
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
      reconnectionAttempts: 3,
      maxReconnectionAttempts: 3
    });

    // ✅ Connection event handlers
    this.socket.on('connect', () => {
      console.log('✅ Socket connected:', this.socket.id);
      this.isConnecting = false;
    });

    this.socket.on('disconnect', (reason) => {
      console.log('🔌 Socket disconnected:', reason);
      this.isConnecting = false;
      this.currentRoomId = null;
      this.pendingJoinRequests.clear();
    });

    this.socket.on('connect_error', (error) => {
      console.error('❌ Socket connection error:', error);
      this.isConnecting = false;
    });

    return this.socket;
  }

  // ✅ SAFE ROOM JOIN WITH DUPLICATE PREVENTION
  joinRoom(roomId, userId, username) {
    return new Promise((resolve, reject) => {
      if (!this.socket?.connected) {
        reject(new Error('Socket not connected'));
        return;
      }

      // ✅ Prevent duplicate requests
      const requestKey = `${roomId}-${userId}`;
      const now = Date.now();
      
      if (this.pendingJoinRequests.has(requestKey)) {
        const lastRequest = this.pendingJoinRequests.get(requestKey);
        if (now - lastRequest < 2000) { // 2 second cooldown
          console.log(`🚫 Join request blocked - too recent (${now - lastRequest}ms ago)`);
          reject(new Error('Please wait before trying again'));
          return;
        }
      }

      // ✅ Check if already in this room
      if (this.currentRoomId === roomId) {
        console.log(`ℹ️ Already in room ${roomId}, skipping join request`);
        resolve({ roomId, message: 'Already in room' });
        return;
      }

      console.log(`🚪 Attempting to join room: ${roomId} as ${username}`);
      
      // Mark request as pending
      this.pendingJoinRequests.set(requestKey, now);

      // Set up one-time event listeners
      const onJoined = (roomData) => {
        console.log(`✅ Successfully joined room: ${roomId}`);
        this.currentRoomId = roomId;
        this.pendingJoinRequests.delete(requestKey);
        this.socket.off('joined_room', onJoined);
        this.socket.off('error', onError);
        resolve(roomData);
      };

      const onError = (error) => {
        console.error(`❌ Failed to join room ${roomId}:`, error.message);
        this.pendingJoinRequests.delete(requestKey);
        this.socket.off('joined_room', onJoined);
        this.socket.off('error', onError);
        reject(new Error(error.message));
      };

      // Set timeout for request
      const timeout = setTimeout(() => {
        console.error(`⏰ Join room timeout for ${roomId}`);
        this.pendingJoinRequests.delete(requestKey);
        this.socket.off('joined_room', onJoined);
        this.socket.off('error', onError);
        reject(new Error('Join request timeout'));
      }, 10000); // 10 second timeout

      this.socket.once('joined_room', onJoined);
      this.socket.once('error', onError);

      // Send join request
      this.socket.emit('join_room', { roomId, userId, username });

      // Clear timeout when resolved/rejected
      Promise.race([
        new Promise(resolve => this.socket.once('joined_room', resolve)),
        new Promise((_, reject) => this.socket.once('error', reject))
      ]).finally(() => {
        clearTimeout(timeout);
      });
    });
  }

  // ✅ SAFE ROOM LEAVE
  leaveRoom(roomId, userId) {
    return new Promise((resolve, reject) => {
      if (!this.socket?.connected) {
        reject(new Error('Socket not connected'));
        return;
      }

      if (this.currentRoomId !== roomId) {
        console.log(`ℹ️ Not in room ${roomId}, skipping leave request`);
        resolve({ message: 'Not in room' });
        return;
      }

      console.log(`🚪 Leaving room: ${roomId}`);

      const onLeft = (response) => {
        console.log(`✅ Successfully left room: ${roomId}`);
        this.currentRoomId = null;
        this.socket.off('left_room', onLeft);
        this.socket.off('error', onError);
        resolve(response);
      };

      const onError = (error) => {
        console.error(`❌ Failed to leave room ${roomId}:`, error.message);
        this.socket.off('left_room', onLeft);
        this.socket.off('error', onError);
        reject(new Error(error.message));
      };

      this.socket.once('left_room', onLeft);
      this.socket.once('error', onError);

      this.socket.emit('leave_room', { roomId, userId });

      // Timeout
      setTimeout(() => {
        this.socket.off('left_room', onLeft);
        this.socket.off('error', onError);
        reject(new Error('Leave request timeout'));
      }, 5000);
    });
  }

  // ✅ CLEANUP DUPLICATES (ADMIN FUNCTION)
  cleanupDuplicates(roomId) {
    if (!this.socket?.connected) {
      console.error('Socket not connected');
      return;
    }

    console.log(`🧹 Requesting duplicate cleanup for room: ${roomId}`);
    this.socket.emit('cleanup_room_duplicates', { roomId });
  }

  // ✅ GET CURRENT ROOM STATE
  getCurrentRoomId() {
    return this.currentRoomId;
  }

  // ✅ CHECK CONNECTION STATUS
  isConnected() {
    return this.socket?.connected || false;
  }

  // ✅ DISCONNECT
  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.currentRoomId = null;
      this.pendingJoinRequests.clear();
      this.isConnecting = false;
    }
  }
}

// ✅ SINGLETON INSTANCE
const socketManager = new SocketManager();
export default socketManager.connect();
export { socketManager };

// ✅ REACT HOOK FOR SAFE ROOM OPERATIONS
import { useState, useEffect, useCallback } from 'react';
import { useSelector } from 'react-redux';

export const useRoomOperations = () => {
  const user = useSelector(state => state.auth?.user);
  const [isJoining, setIsJoining] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const [currentRoom, setCurrentRoom] = useState(null);

  // ✅ SAFE JOIN ROOM
  const joinRoom = useCallback(async (roomId, roomName) => {
    if (!user?._id || isJoining) {
      console.log('Cannot join room: missing user or already joining');
      return { success: false, error: 'Cannot join room' };
    }

    setIsJoining(true);
    
    try {
      const result = await socketManager.joinRoom(roomId, user._id, user.username);
      setCurrentRoom({ roomId, roomName });
      console.log(`✅ Join room success:`, result);
      return { success: true, data: result };
    } catch (error) {
      console.error(`❌ Join room failed:`, error.message);
      return { success: false, error: error.message };
    } finally {
      setIsJoining(false);
    }
  }, [user, isJoining]);

  // ✅ SAFE LEAVE ROOM  
  const leaveRoom = useCallback(async (roomId) => {
    if (!user?._id || isLeaving) {
      console.log('Cannot leave room: missing user or already leaving');
      return { success: false, error: 'Cannot leave room' };
    }

    setIsLeaving(true);
    
    try {
      const result = await socketManager.leaveRoom(roomId, user._id);
      setCurrentRoom(null);
      console.log(`✅ Leave room success:`, result);
      return { success: true, data: result };
    } catch (error) {
      console.error(`❌ Leave room failed:`, error.message);
      return { success: false, error: error.message };
    } finally {
      setIsLeaving(false);
    }
  }, [user, isLeaving]);

  // ✅ CLEANUP DUPLICATES
  const cleanupDuplicates = useCallback((roomId) => {
    socketManager.cleanupDuplicates(roomId);
  }, []);

  return {
    joinRoom,
    leaveRoom,
    cleanupDuplicates,
    isJoining,
    isLeaving,
    currentRoom,
    isConnected: socketManager.isConnected()
  };
};