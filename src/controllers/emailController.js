// src/controllers/emailController.js
const nodemailer = require('nodemailer');

// 创建邮件传输器
const createTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.EMAIL_SERVICE,
    port: parseInt(process.env.EMAIL_PORT),
    secure: true,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });
};

// 验证码存储（生产环境应使用 Redis）
const verificationCodes = new Map();

// @desc    发送验证码
// @route   POST /api/email/send-code
// @access  Public
exports.sendVerificationCode = async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: '邮箱地址是必需的'
      });
    }

    // 生成 6 位验证码
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    // 存储验证码（5分钟有效期）
    verificationCodes.set(email, {
      code,
      expiresAt: Date.now() + 5 * 60 * 1000
    });

    // 5分钟后自动删除
    setTimeout(() => {
      verificationCodes.delete(email);
    }, 5 * 60 * 1000);

    // 检查邮件配置是否正确
    const isEmailConfigured = 
      process.env.EMAIL_USER && 
      process.env.EMAIL_PASS && 
      process.env.EMAIL_USER !== 'your-email@qq.com' &&
      process.env.EMAIL_PASS !== 'your-email-authorization-code';

    if (isEmailConfigured) {
      try {
        // 发送邮件
        const transporter = createTransporter();
        const mailOptions = {
          from: process.env.EMAIL_FROM,
          to: email,
          subject: '人脸识别系统注册验证码',
          html: `
            <div style="padding: 20px; font-family: Arial, sans-serif;">
              <h2 style="color: #333;">验证码</h2>
              <p>您的验证码是：</p>
              <h1 style="color: #4CAF50; font-size: 32px; letter-spacing: 5px;">${code}</h1>
              <p style="color: #666;">验证码有效期为 5 分钟，请尽快使用。</p>
              <p style="color: #999; font-size: 12px;">如果这不是您的操作，请忽略此邮件。</p>
            </div>
          `
        };

        await transporter.sendMail(mailOptions);
        console.log(`✅ 验证码已发送到 ${email}: ${code}`);
      } catch (error) {
        console.error('发送邮件失败:', error);
        console.log(`⚠️ 邮件发送失败，但验证码已生成（开发模式）: ${code}`);
      }
    } else {
      console.log(`⚠️ 邮件未配置，使用开发模式。验证码: ${code}`);
    }

    res.json({
      success: true,
      message: isEmailConfigured 
        ? '验证码已发送到您的邮箱' 
        : '验证码已生成（开发模式，请查看控制台）',
      // 开发环境或邮件未配置时返回验证码
      ...(process.env.NODE_ENV === 'development' || !isEmailConfigured) && { code }
    });
  } catch (error) {
    console.error('发送验证码失败:', error);
    next(error);
  }
};

// @desc    验证验证码
// @route   POST /api/email/verify-code
// @access  Public
exports.verifyCode = async (req, res, next) => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({
        success: false,
        message: '邮箱和验证码是必需的'
      });
    }

    const storedData = verificationCodes.get(email);

    if (!storedData) {
      return res.status(400).json({
        success: false,
        message: '验证码不存在或已过期'
      });
    }

    if (Date.now() > storedData.expiresAt) {
      verificationCodes.delete(email);
      return res.status(400).json({
        success: false,
        message: '验证码已过期'
      });
    }

    if (storedData.code !== code) {
      return res.status(400).json({
        success: false,
        message: '验证码错误'
      });
    }

    // 验证成功后删除验证码
    verificationCodes.delete(email);

    res.json({
      success: true,
      message: '验证码验证成功'
    });
  } catch (error) {
    next(error);
  }
};
