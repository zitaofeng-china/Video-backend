// src/controllers/faceController.js
const FaceData = require('../models/FaceData');
const User = require('../models/User');

// @desc    注册人脸数据
// @route   POST /api/face/register
// @access  Private
exports.registerFaceData = async (req, res, next) => {
  try {
    const { username, descriptor } = req.body;

    // 查找用户
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: '用户不存在'
      });
    }

    // 检查是否已有人脸数据
    let faceData = await FaceData.findOne({ userId: user._id });

    if (faceData) {
      // 更新现有数据
      faceData.descriptor = descriptor;
      faceData.isActive = true;
      await faceData.save();

      return res.json({
        success: true,
        message: '人脸数据更新成功',
        data: { faceData }
      });
    }

    // 创建新的人脸数据
    faceData = await FaceData.create({
      userId: user._id,
      username: user.username,
      descriptor,
      method: 'faceapi'
    });

    res.status(201).json({
      success: true,
      message: '人脸数据注册成功',
      data: { faceData }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    获取所有人脸数据（用于人脸识别匹配）
// @route   GET /api/face/data
// @access  Public
exports.getAllFaceData = async (req, res, next) => {
  try {
    const faceDataList = await FaceData.find({ isActive: true })
      .select('username descriptor method createdAt')
      .lean();

    res.json({
      success: true,
      count: faceDataList.length,
      data: faceDataList
    });
  } catch (error) {
    next(error);
  }
};

// @desc    人脸识别登录
// @route   POST /api/face/login
// @access  Public
exports.faceLogin = async (req, res, next) => {
  try {
    const { descriptor } = req.body;

    if (!descriptor || !Array.isArray(descriptor) || descriptor.length !== 128) {
      return res.status(400).json({
        success: false,
        message: '无效的面部特征数据'
      });
    }

    // 获取所有激活的人脸数据
    const faceDataList = await FaceData.find({ isActive: true });

    if (faceDataList.length === 0) {
      return res.status(404).json({
        success: false,
        message: '系统中没有注册的人脸数据'
      });
    }

    // 计算欧氏距离找到最匹配的用户
    let minDistance = Infinity;
    let matchedFaceData = null;

    for (const faceData of faceDataList) {
      const distance = euclideanDistance(descriptor, faceData.descriptor);
      if (distance < minDistance) {
        minDistance = distance;
        matchedFaceData = faceData;
      }
    }

    // 设置匹配阈值
    const THRESHOLD = 0.6;

    if (minDistance < THRESHOLD && matchedFaceData) {
      // 查找对应的用户
      const user = await User.findById(matchedFaceData.userId);

      if (!user || !user.isActive) {
        return res.status(403).json({
          success: false,
          message: '用户不存在或已被禁用'
        });
      }

      // 更新最后登录时间
      user.lastLogin = new Date();
      await user.save();

      // 生成 token
      const { generateToken } = require('../middleware/auth');
      const token = generateToken(user._id);

      return res.json({
        success: true,
        message: '人脸识别登录成功',
        data: {
          user: {
            id: user._id,
            username: user.username,
            email: user.email,
            avatar: user.avatar
          },
          token,
          matchDistance: minDistance.toFixed(4)
        }
      });
    }

    res.status(401).json({
      success: false,
      message: '人脸识别失败，未找到匹配的用户',
      matchDistance: minDistance.toFixed(4)
    });
  } catch (error) {
    next(error);
  }
};

// @desc    删除人脸数据
// @route   DELETE /api/face/data/:username
// @access  Private
exports.deleteFaceData = async (req, res, next) => {
  try {
    const { username } = req.params;

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: '用户不存在'
      });
    }

    const faceData = await FaceData.findOneAndDelete({ userId: user._id });

    if (!faceData) {
      return res.status(404).json({
        success: false,
        message: '该用户没有人脸数据'
      });
    }

    res.json({
      success: true,
      message: '人脸数据删除成功'
    });
  } catch (error) {
    next(error);
  }
};

// 辅助函数：计算欧氏距离
function euclideanDistance(arr1, arr2) {
  if (arr1.length !== arr2.length) {
    throw new Error('数组长度不匹配');
  }

  let sum = 0;
  for (let i = 0; i < arr1.length; i++) {
    sum += Math.pow(arr1[i] - arr2[i], 2);
  }

  return Math.sqrt(sum);
}
