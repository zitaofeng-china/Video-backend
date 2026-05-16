// src/middleware/auth.js
const jwt = require('jsonwebtoken');
const User = require('../models/User');

// 验证 JWT Token
exports.protect = async (req, res, next) => {
  try {
    let token;

    // 从 Authorization header 获取 token
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    // 检查 token 是否存在
    if (!token) {
      return res.status(401).json({
        success: false,
        message: '未授权访问，请先登录'
      });
    }

    try {
      // 验证 token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // 获取用户信息（不包括密码）
      req.user = await User.findById(decoded.id).select('-password');

      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: '用户不存在'
        });
      }

      if (!req.user.isActive) {
        return res.status(401).json({
          success: false,
          message: '用户已被禁用'
        });
      }

      next();
    } catch (error) {
      return res.status(401).json({
        success: false,
        message: 'Token 无效或已过期'
      });
    }
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: '服务器错误'
    });
  }
};

// 生成 JWT Token
exports.generateToken = (userId) => {
  return jwt.sign(
    { id: userId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRE || '7d' }
  );
};
