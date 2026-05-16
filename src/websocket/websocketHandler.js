// src/websocket/websocketHandler.js
const WebSocket = require('ws');
const roomManager = require('./roomManager');

const MESSAGE_TYPES = {
  CONNECTED: 'connected',
  USER_JOINED: 'user-joined',
  USER_LEFT: 'user-left',
  OFFER: 'offer',
  ANSWER: 'answer',
  ICE_CANDIDATE: 'ice-candidate',
  SCREEN_SHARE_STARTED: 'screen-share-started',
  SCREEN_SHARE_STOPPED: 'screen-share-stopped',
  MUTE_ALL: 'mute-all',
  UNMUTE_ALL: 'unmute-all',
  DISABLE_ALL_VIDEO: 'disable-all-video',
  ENABLE_ALL_VIDEO: 'enable-all-video',
  TRANSFER_ADMIN: 'transfer-admin',
  KICK_USER: 'kick-user',
  ADMIN_CHANGE: 'admin-change',
  KICKED: 'kicked',
  REQUEST_ROOM_STATE: 'request-room-state',
  ROOM_STATE: 'room-state',
  ERROR: 'error',
  PING: 'ping',
  PONG: 'pong'
};

function heartbeat() {
  this.isAlive = true;
  this.lastPing = Date.now();
}

function safeSend(ws, message, retries = 3) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.warn('WebSocket is not open; message was not sent');
    return false;
  }

  try {
    const data = typeof message === 'string' ? message : JSON.stringify(message);
    ws.send(data);
    return true;
  } catch (error) {
    console.error('Failed to send WebSocket message:', error);
    if (retries > 0 && ws.readyState === WebSocket.OPEN) {
      setTimeout(() => safeSend(ws, message, retries - 1), 100);
    }
    return false;
  }
}

function initWebSocket(server) {
  const wss = new WebSocket.Server({ 
    server,
    clientTracking: true,
    perMessageDeflate: {
      zlibDeflateOptions: {
        chunkSize: 1024,
        memLevel: 7,
        level: 3
      },
      zlibInflateOptions: {
        chunkSize: 10 * 1024
      },
      clientNoContextTakeover: true,
      serverNoContextTakeover: true,
      serverMaxWindowBits: 10,
      concurrencyLimit: 10,
      threshold: 1024
    }
  });

  console.log('WebSocket server started');
  console.log(`Heartbeat interval: ${process.env.WS_HEARTBEAT_INTERVAL || 30000}ms`);

  wss.on('connection', async (ws, req) => {
    const connectionTime = Date.now();
    console.log(`Config: heartbeat interval ${process.env.WS_HEARTBEAT_INTERVAL || 30000}ms`);

    const pathParts = req.url.split('/').filter(Boolean);
    
    if (pathParts.length < 3 || pathParts[0] !== 'ws') {
      console.error('Invalid WebSocket path:', req.url);
      safeSend(ws, {
        type: MESSAGE_TYPES.ERROR,
        message: 'Invalid path. Use /ws/roomId/userId'
      });
      ws.close(1008, 'Invalid path format');
      return;
    }

    const roomId = decodeURIComponent(pathParts[1]);
    const userId = decodeURIComponent(pathParts[2]);

    if (!roomId || !userId) {
      safeSend(ws, {
        type: MESSAGE_TYPES.ERROR,
        message: 'Room ID and User ID are required'
      });
      ws.close(1008, 'Missing required parameters');
      return;
    }

    console.log(`User ${userId} connecting to room ${roomId}`);

    ws.isAlive = true;
    ws.lastPing = Date.now();
    ws.userId = userId;
    ws.roomId = roomId;
    ws.messageCount = 0;
    ws.heartbeatCount = 0;
    ws.errorCount = 0;
    ws.on('pong', heartbeat);

    try {
      const room = await roomManager.getOrCreateRoom(roomId, userId, ws);
      
      const isAdmin = room.size === 1;
      ws.isAdmin = isAdmin;

      const adminId = roomManager.getRoomAdmin(roomId) || (isAdmin ? userId : null);

      console.log(`User ${userId} joined room ${roomId}`);
      console.log(`  - room size: ${room.size}`);
      console.log(`  - admin id: ${adminId}`);
      console.log(`  - is admin: ${isAdmin}`);
      console.log(`  - connection setup time: ${Date.now() - connectionTime}ms`);

      safeSend(ws, {
        type: MESSAGE_TYPES.CONNECTED,
        message: 'WebSocket connected successfully',
        roomId,
        userId,
        users: Array.from(room.keys()).filter(id => id !== userId),
        isAdmin,
        adminId,
        screenShareUsers: roomManager.getScreenShareUsers(roomId),
        timestamp: Date.now()
      });

      const currentAdminId = roomManager.getRoomAdmin(roomId);
      room.forEach((client, id) => {
        if (id !== userId && client.readyState === WebSocket.OPEN) {
          safeSend(client, {
            type: MESSAGE_TYPES.USER_JOINED,
            userId,
            isAdmin: false,
            adminId: currentAdminId,
            timestamp: Date.now()
          });
        }
      });

    } catch (error) {
      console.error('Failed to initialize WebSocket connection:', error);
      safeSend(ws, {
        type: MESSAGE_TYPES.ERROR,
        message: 'Failed to initialize WebSocket connection: ' + error.message
      });
      ws.close(1011, 'Internal server error');
      return;
    }

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data);
        
        if (message.type === MESSAGE_TYPES.PING) {
          ws.heartbeatCount++;
          safeSend(ws, { type: MESSAGE_TYPES.PONG, timestamp: Date.now() });
          return;
        }

        ws.messageCount++;

        console.log(`Message [${roomId}] ${userId} -> ${message.type}${message.target ? ` (to: ${message.target})` : ''}`);
        
        handleMessage(ws, roomId, userId, message);
        
      } catch (error) {
        ws.errorCount++;
        console.error('Failed to handle WebSocket message:', error);
        safeSend(ws, {
          type: MESSAGE_TYPES.ERROR,
          message: 'Failed to handle WebSocket message: ' + error.message
        });
        
        if (ws.errorCount > 10) {
          console.error(`User ${userId} had too many errors; closing connection`);
          ws.close(1008, 'Too many errors');
        }
      }
    });

    ws.on('close', (code, reason) => {
      console.log(`User ${userId} disconnected from room ${roomId} [code: ${code}, reason: ${reason || 'none'}]`);
      console.log(`  - messages: ${ws.messageCount}`);
      console.log(`  - heartbeats: ${ws.heartbeatCount}`);
      console.log(`  - errors: ${ws.errorCount}`);
      console.log(`  - duration: ${((Date.now() - connectionTime) / 1000).toFixed(2)}s`);
      
      roomManager.userLeave(roomId, userId);
    });

    ws.on('error', (error) => {
      console.error(`WebSocket error [${userId}]:`, error.message);
      ws.errorCount++;
    });
  });

  const heartbeatInterval = setInterval(() => {
    const now = Date.now();
    const timeout = parseInt(process.env.WS_HEARTBEAT_INTERVAL) || 30000;
    const maxTimeout = timeout * 3; // Allow a few missed heartbeat intervals before terminating.
    
    wss.clients.forEach(ws => {
      if (!ws.isAlive) {
        if (ws.lastPing && (now - ws.lastPing) > maxTimeout) {
          console.log(`User ${ws.userId} heartbeat timed out; terminating connection`);
          return ws.terminate();
        }
      }
      
      ws.isAlive = false;
      ws.ping();
    });
  }, parseInt(process.env.WS_HEARTBEAT_INTERVAL) || 30000);

  const statsInterval = setInterval(() => {
    const stats = {
      totalConnections: wss.clients.size,
      activeRooms: roomManager.getRoomCount(),
      totalMessages: Array.from(wss.clients).reduce((sum, ws) => sum + (ws.messageCount || 0), 0)
    };
    console.log(`Stats: ${stats.totalConnections} connections, ${stats.activeRooms} rooms, ${stats.totalMessages} messages`);
  }, 60000); // Log stats every minute.

  const shutdown = () => {
    console.log('Shutting down WebSocket server...');
    clearInterval(heartbeatInterval);
    clearInterval(statsInterval);
    
    wss.clients.forEach(ws => {
      safeSend(ws, {
        type: MESSAGE_TYPES.ERROR,
        message: 'Server is restarting. Please reconnect later.'
      });
      ws.close(1001, 'Server shutting down');
    });
    
    wss.close(() => {
      console.log('WebSocket server closed');
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  return wss;
}

function handleMessage(ws, roomId, userId, message) {
  const room = roomManager.getRoom(roomId);
  if (!room) {
    safeSend(ws, {
      type: MESSAGE_TYPES.ERROR,
      message: 'Room does not exist'
    });
    return;
  }

  if (message.target) {
    if (message.type === MESSAGE_TYPES.SCREEN_SHARE_STARTED) {
      const canShare = roomManager.setScreenShareState(roomId, userId, true);
      if (!canShare) {
        safeSend(ws, {
          type: MESSAGE_TYPES.ERROR,
          code: 'SCREEN_SHARE_BUSY',
          message: 'Only one user can share screen at a time'
        });
        return;
      }
    } else if (message.type === MESSAGE_TYPES.SCREEN_SHARE_STOPPED) {
      roomManager.setScreenShareState(roomId, userId, false);
    }

    const success = roomManager.sendToUser(roomId, message.target, {
      ...message,
      sender: userId,
      timestamp: Date.now()
    });

    if (!success) {
      console.log(`Target user ${message.target} is not reachable`);
      safeSend(ws, {
        type: 'target-error',
        target: message.target,
        message: 'Target user not reachable'
      });
    }
  }
  else if ([MESSAGE_TYPES.MUTE_ALL, MESSAGE_TYPES.UNMUTE_ALL, 
            MESSAGE_TYPES.DISABLE_ALL_VIDEO, MESSAGE_TYPES.ENABLE_ALL_VIDEO].includes(message.type)) {
    const currentAdmin = roomManager.getRoomAdmin(roomId);
    if (currentAdmin === userId) {
      room.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          safeSend(client, {
            type: message.type,
            sender: userId,
            timestamp: Date.now()
          });
        }
      });
    } else {
      safeSend(ws, {
        type: MESSAGE_TYPES.ERROR,
        message: 'Admin permission is required'
      });
    }
  }
  else if (message.broadcast) {
    if (message.type === MESSAGE_TYPES.SCREEN_SHARE_STARTED) {
      const canShare = roomManager.setScreenShareState(roomId, userId, true);
      if (!canShare) {
        safeSend(ws, {
          type: MESSAGE_TYPES.ERROR,
          code: 'SCREEN_SHARE_BUSY',
          message: 'Only one user can share screen at a time'
        });
        return;
      }
    } else if (message.type === MESSAGE_TYPES.SCREEN_SHARE_STOPPED) {
      roomManager.setScreenShareState(roomId, userId, false);
    }

    roomManager.broadcast(roomId, userId, {
      ...message,
      timestamp: Date.now()
    });

    if (message.type === MESSAGE_TYPES.SCREEN_SHARE_STARTED) {
      roomManager.setScreenShareState(roomId, userId, true);
    } else if (message.type === MESSAGE_TYPES.SCREEN_SHARE_STOPPED) {
      roomManager.setScreenShareState(roomId, userId, false);
    }
  }
  else if (message.type === MESSAGE_TYPES.TRANSFER_ADMIN) {
    const currentAdmin = roomManager.getRoomAdmin(roomId);
    if (currentAdmin === userId) {
      roomManager.transferAdmin(roomId, message.newAdminId);
    } else {
      safeSend(ws, {
        type: MESSAGE_TYPES.ERROR,
        message: 'Only admin can transfer permissions'
      });
    }
  }
  else if (message.type === MESSAGE_TYPES.KICK_USER) {
    const currentAdmin = roomManager.getRoomAdmin(roomId);
    if (currentAdmin === userId) {
      const success = roomManager.kickUser(roomId, message.targetUserId);
      if (!success) {
        safeSend(ws, {
          type: MESSAGE_TYPES.ERROR,
          message: 'Unable to kick user'
        });
      }
    } else {
      safeSend(ws, {
        type: MESSAGE_TYPES.ERROR,
        message: 'Only admin can kick users'
      });
    }
  }
  else if (message.type === MESSAGE_TYPES.SCREEN_SHARE_STARTED && !message.target && !message.broadcast) {
    const canShare = roomManager.setScreenShareState(roomId, userId, true);
    if (!canShare) {
      safeSend(ws, {
        type: MESSAGE_TYPES.ERROR,
        code: 'SCREEN_SHARE_BUSY',
        message: 'Only one user can share screen at a time'
      });
      return;
    }

    roomManager.broadcast(roomId, userId, {
      type: MESSAGE_TYPES.SCREEN_SHARE_STARTED,
      timestamp: Date.now()
    });
  }
  else if (message.type === MESSAGE_TYPES.SCREEN_SHARE_STOPPED && !message.target && !message.broadcast) {
    roomManager.setScreenShareState(roomId, userId, false);
    roomManager.broadcast(roomId, userId, {
      type: MESSAGE_TYPES.SCREEN_SHARE_STOPPED,
      timestamp: Date.now()
    });
  }
  else if (message.type === MESSAGE_TYPES.REQUEST_ROOM_STATE) {
    const participants = Array.from(room.keys());
    const adminId = roomManager.getRoomAdmin(roomId);
    const screenShareUsers = roomManager.getScreenShareUsers(roomId);
    
    safeSend(ws, {
      type: MESSAGE_TYPES.ROOM_STATE,
      participants,
      adminId,
      screenShareUsers,
      timestamp: Date.now()
    });
    
    console.log(`Sent room state to ${userId}: ${participants.length} participants`);
  }
}

module.exports = { initWebSocket };
