// src/routes/emailRoutes.js
const express = require('express');
const router = express.Router();
const emailController = require('../controllers/emailController');
const { body } = require('express-validator');
const { validate } = require('../middleware/validator');

// 发送验证码
router.post('/send-code', 
  [
    body('email').isEmail().withMessage('请输入有效的邮箱地址')
  ],
  validate,
  emailController.sendVerificationCode
);

// 验证验证码
router.post('/verify-code',
  [
    body('email').isEmail().withMessage('请输入有效的邮箱地址'),
    body('code').isLength({ min: 6, max: 6 }).withMessage('验证码必须是6位数字')
  ],
  validate,
  emailController.verifyCode
);

module.exports = router;
