const fs = require('fs');
const path = require('path');
const os = require('os');
const mockttp = require('mockttp');

// 优先使用用户主目录 ~/.hqnetwork 存放证书，确保即使作为打包 App 运行在只读系统目录下也有写权限
const BASE_DIR = process.env.HQ_DATA_DIR || path.join(os.homedir(), '.hqnetwork');
const CERT_DIR = path.join(BASE_DIR, 'certs');
const CA_KEY_PATH = path.join(CERT_DIR, 'ca.key');
const CA_CERT_PATH = path.join(CERT_DIR, 'ca.pem');
const CA_CRT_PATH = path.join(CERT_DIR, 'ca.crt');

/**
 * 获取或生成持久化的 CA 根证书
 * 保证代理服务重启后手机端无需重新安装/信任证书
 */
async function getOrCreateCA() {
  if (!fs.existsSync(CERT_DIR)) {
    fs.mkdirSync(CERT_DIR, { recursive: true });
  }

  if (fs.existsSync(CA_KEY_PATH) && fs.existsSync(CA_CERT_PATH)) {
    const key = fs.readFileSync(CA_KEY_PATH, 'utf8');
    const cert = fs.readFileSync(CA_CERT_PATH, 'utf8');
    try {
      const crypto = require('crypto');
      const x509 = new crypto.X509Certificate(cert);
      if (x509.subject && x509.subject.includes('HqNetworkDebuger')) {
        return { key, cert };
      }
      console.log('[CertManager] 检测到旧版证书名称，正在升级生成 HqNetworkDebuger 根证书...');
    } catch (e) {
      return { key, cert };
    }
  } else {
    console.log('[CertManager] 正在生成全新的 Root CA 证书...');
  }

  const ca = await mockttp.generateCACertificate({
    subject: {
      commonName: 'HqNetworkDebuger',
      organizationName: 'HqNetworkDebuger',
      countryName: 'CN'
    }
  });

  cachedSystemCertFilename = null;
  fs.writeFileSync(CA_KEY_PATH, ca.key, { mode: 0o600 });
  fs.writeFileSync(CA_CERT_PATH, ca.cert, { mode: 0o644 });
  // 同时输出一份 .crt 文件便于 Android 系统直接识别安装
  fs.writeFileSync(CA_CRT_PATH, ca.cert, { mode: 0o644 });
  getAndroidSystemCertFilename();

  console.log(`[CertManager] 根证书已成功保存至: ${CA_CERT_PATH}`);
  return ca;
}

let cachedSystemCertFilename = null;

/**
 * 计算 Android 系统根证书文件名 (<subject_hash_old>.0，例如 406a290f.0)
 * 供 VMOS 虚拟机或 Root 设备直接放入 /system/etc/security/cacerts/
 */
function getAndroidSystemCertFilename() {
  if (cachedSystemCertFilename) return cachedSystemCertFilename;
  try {
    if (fs.existsSync(CA_CERT_PATH)) {
      const { execSync } = require('child_process');
      const hash = execSync(`openssl x509 -inform PEM -subject_hash_old -in "${CA_CERT_PATH}" -noout`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim().split('\n')[0].trim();
      if (hash && /^[0-9a-f]{8}$/i.test(hash)) {
        cachedSystemCertFilename = `${hash}.0`;
        const sysCertPath = path.join(CERT_DIR, cachedSystemCertFilename);
        if (!fs.existsSync(sysCertPath)) {
          fs.copyFileSync(CA_CERT_PATH, sysCertPath);
        }
        return cachedSystemCertFilename;
      }
    }
  } catch (e) {}
  return '8adeb422.0';
}

module.exports = {
  getOrCreateCA,
  getAndroidSystemCertFilename,
  CA_CERT_PATH,
  CA_CRT_PATH,
  CA_KEY_PATH,
  CERT_DIR
};
