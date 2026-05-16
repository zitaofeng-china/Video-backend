// src/utils/envCheck.js

/**
 * 环境变量检查工具
 * 确保所有必需的环境变量都已正确配置
 */

const requiredEnvVars = [
  'MONGODB_URI',
  'JWT_SECRET',
  'PORT'
];

const sensitiveDefaults = {
  JWT_SECRET: [
    'your-super-secret-jwt-key-change-this-in-production',
    'CHANGE_THIS_TO_A_RANDOM_STRING_OR_YOUR_APP_WILL_BE_INSECURE',
    'change-this',
    'secret',
    'your-secret-key'
  ]
};

/**
 * 检查环境变量
 */
function checkEnvironment() {
  const errors = [];
  const warnings = [];

  // 检查必需的环境变量
  requiredEnvVars.forEach(varName => {
    if (!process.env[varName]) {
      errors.push(`❌ 缺少必需的环境变量: ${varName}`);
    }
  });

  // 检查敏感配置是否使用了默认值
  Object.keys(sensitiveDefaults).forEach(varName => {
    const value = process.env[varName];
    if (value && sensitiveDefaults[varName].some(def => value.includes(def))) {
      if (process.env.NODE_ENV === 'production') {
        errors.push(`❌ 生产环境不能使用默认的 ${varName}！`);
      } else {
        warnings.push(`⚠️  ${varName} 使用了默认值，请在生产环境前修改`);
      }
    }
  });

  // 检查 JWT_SECRET 强度
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
    warnings.push(`⚠️  JWT_SECRET 长度过短（当前: ${process.env.JWT_SECRET.length}，建议: 64+）`);
  }

  // 检查 MongoDB URI
  if (process.env.MONGODB_URI) {
    if (process.env.MONGODB_URI.includes('localhost') && process.env.NODE_ENV === 'production') {
      warnings.push('⚠️  生产环境使用 localhost MongoDB，建议使用远程数据库');
    }
  }

  // 检查 CORS 配置
  if (!process.env.CORS_ORIGIN && process.env.NODE_ENV === 'production') {
    warnings.push('⚠️  未配置 CORS_ORIGIN，将允许所有来源（不安全）');
  }

  // 输出结果
  if (errors.length > 0) {
    console.error('\n🚨 环境配置错误:\n');
    errors.forEach(err => console.error(err));
    console.error('\n请修复以上错误后再启动服务器\n');
    process.exit(1);
  }

  if (warnings.length > 0) {
    console.warn('\n⚠️  环境配置警告:\n');
    warnings.forEach(warn => console.warn(warn));
    console.warn('');
  }

  console.log('✅ 环境配置检查通过\n');
}

/**
 * 生成随机 JWT Secret
 */
function generateJWTSecret() {
  const crypto = require('crypto');
  return crypto.randomBytes(64).toString('hex');
}

/**
 * 显示环境配置帮助
 */
function showHelp() {
  console.log(`
╔═══════════════════════════════════════════════════════╗
║           环境配置帮助                                 ║
╚═══════════════════════════════════════════════════════╝

必需的环境变量:
  MONGODB_URI    - MongoDB 连接字符串
  JWT_SECRET     - JWT 签名密钥（必须是强随机字符串）
  PORT           - 服务器端口

生成安全的 JWT_SECRET:
  node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

或者使用此工具:
  node src/utils/envCheck.js --generate-secret

示例 .env 文件:
  PORT=8080
  MONGODB_URI=mongodb://localhost:27017/video-chat-app
  JWT_SECRET=${generateJWTSecret()}
  JWT_EXPIRE=7d
  CORS_ORIGIN=http://localhost:3000
  `);
}

// 命令行工具
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h')) {
    showHelp();
  } else if (args.includes('--generate-secret')) {
    console.log('\n生成的 JWT_SECRET:');
    console.log(generateJWTSecret());
    console.log('\n请将此值复制到 .env 文件中\n');
  } else {
    require('dotenv').config();
    checkEnvironment();
  }
}

module.exports = {
  checkEnvironment,
  generateJWTSecret,
  showHelp
};
