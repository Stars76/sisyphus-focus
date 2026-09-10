// 冒烟测试入口（必须从项目根目录作为 Electron 的 app path 启动，否则 loadFile 的相对路径会指向 tools/）
//   .\electron\electron.exe smoke.js     或     npm run smoke
require('./tools/smoke-test.js');
