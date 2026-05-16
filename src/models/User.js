// src/models/User.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: [true, '用户名是必需的'],
    unique: true,
    trim: true,
    minlength: [3, '用户名至少3个字符'],
    maxlength: [30, '用户名最多30个字符'],
    index: true // 添加索引
  },
  email: {
    type: String,
    required: [true, '邮箱是必需的'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, '请输入有效的邮箱地址'],
    index: true // 添加索引
  },
  password: {
    type: String,
    required: [true, '密码是必需的'],
    minlength: [6, '密码至少6个字符'],
    select: false // 默认查询时不返回密码
  },
  avatar: {
    type: String,
    default: null
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true // 添加索引用于查询活跃用户
  },
  lastLogin: {
    type: Date,
    default: null,
    index: true // 添加索引用于查询最近登录
  }
}, {
  timestamps: true // 自动添加 createdAt 和 updatedAt
});

// 复合索引：用于常见查询组合
userSchema.index({ username: 1, isActive: 1 });
userSchema.index({ email: 1, isActive: 1 });
userSchema.index({ createdAt: -1 }); // 降序索引用于最新用户查询
userSchema.index({ lastLogin: -1 }); // 降序索引用于最近活跃用户

// 保存前加密密码
userSchema.pre('save', async function(next) {
  // 只有密码被修改时才加密
  if (!this.isModified('password')) {
    return next();
  }
  
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// 验证密码方法
userSchema.methods.comparePassword = async function(candidatePassword) {
  try {
    return await bcrypt.compare(candidatePassword, this.password);
  } catch (error) {
    throw new Error('密码验证失败');
  }
};

// 转换为 JSON 时移除敏感信息
userSchema.methods.toJSON = function() {
  const obj = this.toObject();
  delete obj.password;
  delete obj.__v;
  return obj;
};

module.exports = mongoose.model('User', userSchema);
