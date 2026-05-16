// src/models/Room.js
const mongoose = require('mongoose');

const roomSchema = new mongoose.Schema({
  roomId: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    index: true // 显式添加索引
  },
  name: {
    type: String,
    default: '未命名房间'
  },
  adminId: {
    type: String,
    required: true,
    index: true // 添加索引用于查询管理员的房间
  },
  participants: [{
    userId: String,
    username: String,
    joinedAt: {
      type: Date,
      default: Date.now
    }
  }],
  isActive: {
    type: Boolean,
    default: true,
    index: true // 添加索引用于查询活跃房间
  },
  maxParticipants: {
    type: Number,
    default: 20  // 修改为 20 人（但建议保持 10 人以内）
  }
}, {
  timestamps: true
});

// 复合索引：用于常见查询组合
roomSchema.index({ roomId: 1, isActive: 1 });
roomSchema.index({ adminId: 1, isActive: 1 });
roomSchema.index({ isActive: 1, createdAt: -1 }); // 查询活跃房间并按创建时间排序
roomSchema.index({ 'participants.userId': 1 }); // 查询用户参与的房间

module.exports = mongoose.model('Room', roomSchema);
