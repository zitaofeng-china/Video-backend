// src/models/FaceData.js
const mongoose = require('mongoose');

const faceDataSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true // 显式添加索引
  },
  username: {
    type: String,
    required: true,
    index: true // 添加索引用于按用户名查询
  },
  descriptor: {
    type: [Number], // 存储面部特征向量
    required: true,
    validate: {
      validator: function(v) {
        return v.length === 128; // face-api.js 的特征向量长度为 128
      },
      message: '面部特征向量长度必须为 128'
    }
  },
  method: {
    type: String,
    enum: ['faceapi'],
    default: 'faceapi'
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true // 添加索引用于查询活跃的人脸数据
  }
}, {
  timestamps: true
});

// 复合索引：用于常见查询组合
faceDataSchema.index({ userId: 1, isActive: 1 });
faceDataSchema.index({ username: 1, isActive: 1 });
faceDataSchema.index({ isActive: 1, updatedAt: -1 }); // 查询活跃数据并按更新时间排序

module.exports = mongoose.model('FaceData', faceDataSchema);
