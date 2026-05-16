// src/routes/authRoutes.js
const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { protect } = require('../middleware/auth');
const { registerValidation, loginValidation, validate } = require('../middleware/validator');

// 公开路由
router.post('/register', registerValidation, validate, authController.register);
router.post('/login', loginValidation, validate, authController.login);

// 受保护路由
router.get('/me', protect, authController.getMe);
router.put('/update', protect, authController.updateUser);
router.put('/change-password', protect, authController.changePassword);

module.exports = router;
