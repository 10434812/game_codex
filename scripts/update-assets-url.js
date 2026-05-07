const fs = require('fs');
const path = require('path');

// ==========================================
// 请在这里填写您的服务器资源基础路径
// 例如: 'https://www.yourdomain.com'
// ==========================================
const CDN_BASE_URL = 'https://xcx.ukb88.com';

const TARGET_DIR = path.join(__dirname, '..');

// 需要处理的文件扩展名
const EXTENSIONS = ['.wxml', '.js', '.wxss', '.json'];

// 忽略的目录
const IGNORE_DIRS = ['node_modules', '.git', 'scripts', 'assets'];

function walkAndReplace(dir) {
  const files = fs.readdirSync(dir);

  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      if (!IGNORE_DIRS.includes(file)) {
        walkAndReplace(fullPath);
      }
    } else {
      const ext = path.extname(file);
      if (EXTENSIONS.includes(ext)) {
        let content = fs.readFileSync(fullPath, 'utf8');
        
        // 替换逻辑：匹配 "/assets/" 并替换为 CDN_BASE_URL + "/assets/"
        // 注意：这里使用正则表达式匹配，避免重复替换
        const regex = /(["'`])\/assets\//g;
        
        if (regex.test(content)) {
          const newContent = content.replace(regex, `$1${CDN_BASE_URL}/assets/`);
          fs.writeFileSync(fullPath, newContent, 'utf8');
          console.log(`✅ 已更新: ${path.relative(TARGET_DIR, fullPath)}`);
        }
      }
    }
  }
}

console.log(`开始替换资源路径，基础 URL 为: ${CDN_BASE_URL}`);
walkAndReplace(TARGET_DIR);
console.log('🎉 替换完成！');
