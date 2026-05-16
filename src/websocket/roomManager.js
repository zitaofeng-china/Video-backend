// src/websocket/roomManager.js
const Room = require('../models/Room');
const WebSocket = require('ws');

class RoomManager {
  constructor() {
    // 内存中的房间管理
    this.rooms = new Map(); // roomId -> Map(userId -> ws)
    this.screenShareStates = new Map(); // roomId -> Set(userId)
    this.roomMetadata = new Map(); // roomId -> { createdAt, adminId, messageCount }
  }

  // 获取房间数量
  getRoomCount() {
    return this.rooms.size;
  }

  // 获取房间统计信息
  getRoomStats(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    const metadata = this.roomMetadata.get(roomId) || {};
    return {
      userCount: room.size,
      users: Array.from(room.keys()),
      adminId: this.getRoomAdmin(roomId),
      screenShareUsers: this.getScreenShareUsers(roomId),
      createdAt: metadata.createdAt,
      messageCount: metadata.messageCount || 0
    };
  }

  // 创建或获取房间
  async getOrCreateRoom(roomId, userId, ws) {
    let isNewRoom = false;
    
    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, new Map());
      this.roomMetadata.set(roomId, {
        createdAt: Date.now(),
        adminId: userId,
        messageCount: 0
      });
      isNewRoom = true;
      
      // 在数据库中创建房间记录
      try {
        await Room.findOneAndUpdate(
          { roomId },
          {
            roomId,
            adminId: userId,
            isActive: true,
            participants: [{ userId, joinedAt: new Date() }]
          },
          { upsert: true, new: true }
        );
        console.log(`✨ 创建新房间: ${roomId}`);
      } catch (error) {
        console.error('❌ 创建房间记录失败:', error);
      }
    }

    const room = this.rooms.get(roomId);
    
    // 优化：在添加用户前检查人数限制
    if (!room.has(userId)) {
      try {
        const roomDoc = await Room.findOne({ roomId });
        const maxParticipants = roomDoc && roomDoc.maxParticipants ? roomDoc.maxParticipants : 20;
        
        if (room.size >= maxParticipants) {
          throw new Error(`房间已满（最多 ${maxParticipants} 人）`);
        }
      } catch (error) {
        // 如果数据库查询失败，使用默认限制
        if (room.size >= 20) {
          throw new Error('房间已满（最多 20 人）');
        }
      }
    }
    
    // 如果用户已存在，关闭旧连接
    if (room.has(userId)) {
      const oldWs = room.get(userId);
      if (oldWs && oldWs.readyState === WebSocket.OPEN) {
        console.log(`⚠️ 用户 ${userId} 重复连接，关闭旧连接`);
        try {
          oldWs.close(1000, 'Duplicate connection');
        } catch (error) {
          console.error('关闭旧连接失败:', error);
        }
      }
      room.delete(userId);
    }

    // 添加新连接
    room.set(userId, ws);

    // 更新数据库中的参与者列表
    if (!isNewRoom) {
      try {
        await Room.findOneAndUpdate(
          { roomId },
          {
            $addToSet: {
              participants: { userId, joinedAt: new Date() }
            },
            isActive: true
          }
        );
      } catch (error) {
        console.error('❌ 更新参与者列表失败:', error);
      }
    }

    return room;
  }

  // 获取房间
  getRoom(roomId) {
    return this.rooms.get(roomId);
  }

  // 获取房间管理员
  getRoomAdmin(roomId) {
    const metadata = this.roomMetadata.get(roomId);
    if (metadata && metadata.adminId) {
      return metadata.adminId;
    }

    const room = this.rooms.get(roomId);
    if (!room) return null;

    // 查找具有管理员标识的用户
    for (const [userId, ws] of room.entries()) {
      if (ws.isAdmin) {
        return userId;
      }
    }

    // 如果没有找到，返回第一个用户
    const users = Array.from(room.keys());
    return users.length > 0 ? users[0] : null;
  }

  // 转移管理员权限
  transferAdmin(roomId, newAdminId) {
    const room = this.rooms.get(roomId);
    if (!room || !room.has(newAdminId)) {
      console.error(`❌ 无法转移管理员: 房间或用户不存在`);
      return false;
    }

    const oldAdmin = this.getRoomAdmin(roomId);

    // 更新元数据
    const metadata = this.roomMetadata.get(roomId);
    if (metadata) {
      metadata.adminId = newAdminId;
    }

    // 清除旧管理员标识
    if (oldAdmin && room.has(oldAdmin)) {
      room.get(oldAdmin).isAdmin = false;
    }

    // 设置新管理员标识
    room.get(newAdminId).isAdmin = true;

    // 通知房间内所有用户
    this.broadcast(roomId, null, {
      type: 'admin-change',
      oldAdmin,
      newAdmin: newAdminId,
      timestamp: Date.now()
    }, true); // 包括发送者

    // 更新数据库
    Room.findOneAndUpdate(
      { roomId },
      { adminId: newAdminId }
    ).catch(err => console.error('❌ 更新管理员失败:', err));

    console.log(`🔄 管理员权限: ${oldAdmin} -> ${newAdminId}`);
    return true;
  }

  // 踢出用户
  kickUser(roomId, targetUserId) {
    const room = this.rooms.get(roomId);
    if (!room || !room.has(targetUserId)) {
      return false;
    }

    const targetWs = room.get(targetUserId);
    
    // 发送踢出通知
    if (targetWs.readyState === WebSocket.OPEN) {
      try {
        targetWs.send(JSON.stringify({ 
          type: 'kicked',
          timestamp: Date.now()
        }));
      } catch (error) {
        console.error('❌ 发送踢出通知失败:', error);
      }
      targetWs.close(4000, 'Kicked by admin');
    }
    
    room.delete(targetUserId);

    // 通知其他用户
    this.broadcast(roomId, null, {
      type: 'user-left',
      userId: targetUserId,
      reason: 'kicked',
      timestamp: Date.now()
    }, true);

    // 更新数据库
    Room.findOneAndUpdate(
      { roomId },
      { $pull: { participants: { userId: targetUserId } } }
    ).catch(err => console.error('❌ 移除参与者失败:', err));

    console.log(`👢 用户 ${targetUserId} 被踢出房间 ${roomId}`);
    return true;
  }

  // 用户离开房间
  async userLeave(roomId, userId) {
    const room = this.rooms.get(roomId);
    if (!room) return;

    room.delete(userId);

    // 清理屏幕共享状态
    this.setScreenShareState(roomId, userId, false);

    // 检查是否是管理员离开
    const metadata = this.roomMetadata.get(roomId);
    if (metadata && metadata.adminId === userId && room.size > 0) {
      // 转移管理员权限
      const newAdminId = Array.from(room.keys())[0];
      if (newAdminId) {
        console.log(`🔄 管理员 ${userId} 离开，转移权限给 ${newAdminId}`);
        this.transferAdmin(roomId, newAdminId);
      }
    }

    // 通知其他用户
    this.broadcast(roomId, null, {
      type: 'user-left',
      userId,
      timestamp: Date.now()
    }, true);

    // 如果房间为空，清理房间
    if (room.size === 0) {
      this.rooms.delete(roomId);
      this.screenShareStates.delete(roomId);
      this.roomMetadata.delete(roomId);
      
      // 更新数据库
      try {
        await Room.findOneAndUpdate(
          { roomId },
          { isActive: false }
        );
        console.log(`🗑️ 房间 ${roomId} 已清空并标记为非活跃`);
      } catch (error) {
        console.error('❌ 更新房间状态失败:', error);
      }
    } else {
      // 更新数据库中的参与者列表
      try {
        await Room.findOneAndUpdate(
          { roomId },
          { $pull: { participants: { userId } } }
        );
      } catch (error) {
        console.error('❌ 移除参与者失败:', error);
      }
    }
  }

  // 设置屏幕共享状态
  setScreenShareState(roomId, userId, isSharing) {
    if (!this.screenShareStates.has(roomId)) {
      this.screenShareStates.set(roomId, new Set());
    }

    const sharingUsers = this.screenShareStates.get(roomId);
    if (isSharing) {
      const activeSharingUser = Array.from(sharingUsers).find(existingUserId => existingUserId !== userId);
      if (activeSharingUser) {
        console.log(`📺 用户 ${userId} 请求屏幕共享失败，${activeSharingUser} 正在共享`);
        return false;
      }

      sharingUsers.add(userId);
      console.log(`📺 用户 ${userId} 开始屏幕共享`);
    } else {
      sharingUsers.delete(userId);
      console.log(`📺 用户 ${userId} 停止屏幕共享`);
    }

    if (sharingUsers.size === 0) {
      this.screenShareStates.delete(roomId);
    }

    return true;
  }

  // 获取屏幕共享用户列表
  getScreenShareUsers(roomId) {
    if (this.screenShareStates.has(roomId)) {
      return Array.from(this.screenShareStates.get(roomId));
    }
    return [];
  }

  // 广播消息（可选是否包括发送者）
  broadcast(roomId, senderId, message, includeSender = false) {
    const room = this.rooms.get(roomId);
    if (!room) return 0;

    // 更新消息计数
    const metadata = this.roomMetadata.get(roomId);
    if (metadata) {
      metadata.messageCount = (metadata.messageCount || 0) + 1;
    }

    let sentCount = 0;
    const messageStr = JSON.stringify({
      ...message,
      sender: senderId
    });

    room.forEach((ws, userId) => {
      if ((includeSender || userId !== senderId) && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(messageStr);
          sentCount++;
        } catch (error) {
          console.error(`❌ 发送消息给 ${userId} 失败:`, error);
        }
      }
    });

    return sentCount;
  }

  // 发送消息给特定用户
  sendToUser(roomId, targetUserId, message) {
    const room = this.rooms.get(roomId);
    if (!room) return false;

    const targetWs = room.get(targetUserId);
    if (targetWs && targetWs.readyState === WebSocket.OPEN) {
      try {
        targetWs.send(JSON.stringify(message));
        
        // 更新消息计数
        const metadata = this.roomMetadata.get(roomId);
        if (metadata) {
          metadata.messageCount = (metadata.messageCount || 0) + 1;
        }
        
        return true;
      } catch (error) {
        console.error(`❌ 发送消息给 ${targetUserId} 失败:`, error);
        return false;
      }
    }
    return false;
  }

  // 清理所有房间（用于测试或维护）
  clearAllRooms() {
    console.log(`🧹 清理所有房间 (${this.rooms.size} 个)`);
    
    this.rooms.forEach((room, roomId) => {
      room.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close(1001, 'Server maintenance');
        }
      });
    });

    this.rooms.clear();
    this.screenShareStates.clear();
    this.roomMetadata.clear();
  }
}

module.exports = new RoomManager();

