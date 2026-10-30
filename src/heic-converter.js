const os = require('os');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

/**
 * 通过文件前导 Magic Bytes 探测是否为 HEIC / HEIF 图像文件
 * ISO Base Media File Format (ISOBMFF):
 * offset 4: 'ftyp'
 * offset 8: brand ('heic', 'heix', 'heim', 'heis', 'mif1', 'msf1', 'hevc', 'hevx')
 */
function isBufferHeic(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length < 12) return false;
  const isFtyp = buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70;
  if (!isFtyp) return false;
  const brand = buffer.slice(8, 12).toString('ascii').toLowerCase();
  return ['heic', 'heix', 'heim', 'heis', 'mif1', 'msf1', 'hevc', 'hevx'].includes(brand);
}

/**
 * 将 HEIC Buffer 转换为高质量 JPEG Buffer
 * macOS 下直接调用硬件加速的系统内置 /usr/bin/sips 工具，执行速度极快（10~50ms），零外部 C++ 依赖
 */
function convertHeicToJpeg(heicBuffer) {
  return new Promise((resolve, reject) => {
    if (!heicBuffer || heicBuffer.length === 0) {
      return reject(new Error('HEIC buffer is empty'));
    }

    if (process.platform !== 'darwin') {
      // 非 macOS 平台如暂无 sips，直接返回原 buffer
      return resolve(heicBuffer);
    }

    const uniqueId = `hq_heic_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const tempIn = path.join(os.tmpdir(), `${uniqueId}.heic`);
    const tempOut = path.join(os.tmpdir(), `${uniqueId}.jpg`);

    fs.writeFile(tempIn, heicBuffer, (writeErr) => {
      if (writeErr) {
        return reject(new Error(`写入临时 HEIC 文件失败: ${writeErr.message}`));
      }

      execFile('/usr/bin/sips', ['-s', 'format', 'jpeg', tempIn, '--out', tempOut], { timeout: 5000 }, (execErr) => {
        // 清理输入临时文件
        fs.unlink(tempIn, () => {});

        if (execErr) {
          fs.unlink(tempOut, () => {});
          return reject(new Error(`sips 转换 HEIC 失败: ${execErr.message}`));
        }

        fs.readFile(tempOut, (readErr, jpegData) => {
          // 清理输出临时文件
          fs.unlink(tempOut, () => {});

          if (readErr) {
            return reject(new Error(`读取已转换 JPEG 失败: ${readErr.message}`));
          }
          resolve(jpegData);
        });
      });
    });
  });
}

module.exports = {
  isBufferHeic,
  convertHeicToJpeg
};
