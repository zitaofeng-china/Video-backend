// src/routes/faceRoutes.js
const express = require('express');
const router = express.Router();
const faceController = require('../controllers/faceController');
const { protect } = require('../middleware/auth');
const { faceDataValidation, validate } = require('../middleware/validator');

// 公开路由
router.get('/data', faceController.getAllFaceData);
router.post('/login', faceController.faceLogin);

// 受保护路由
router.post('/register', protect, faceDataValidation, validate, faceController.registerFaceData);
router.delete('/data/:username', protect, faceController.deleteFaceData);

module.exports = router;
