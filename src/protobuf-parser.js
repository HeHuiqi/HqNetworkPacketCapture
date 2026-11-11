/**
 * Schema-less Protobuf 二进制反编译器 / 自动解码器
 * 针对 application/x-protobuf / application/protobuf 等二进制报文，
 * 在无需 .proto 模式定义文件的情况下，基于 Protobuf Wire Format 规范
 * 逆向解析出字段编号 (Field Number)、数据类型 (Wire Type) 与嵌套结构 (Embedded Messages / Strings / Varints)。
 */

function isPrintableUtf8(buf) {
  if (!buf || buf.length === 0) return true;
  let str;
  try {
    str = buf.toString('utf8');
  } catch (e) {
    return false;
  }
  // 校验 UTF-8 编码往返一致性
  if (Buffer.byteLength(str, 'utf8') !== buf.length) return false;

  // 判断是否为正常文本（排除不可打印的二进制控制字符，允许换行符、回车符、制表符）
  let nonPrintable = 0;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code === 0 || (code < 32 && code !== 9 && code !== 10 && code !== 13)) {
      nonPrintable++;
    }
  }
  return nonPrintable === 0;
}

/**
 * 尝试将 Buffer 解码为 packed repeated varint 数组（如 [1, 2, 3, 100]）
 */
function tryParsePackedVarints(buf) {
  if (!buf || buf.length < 2) return null;
  const list = [];
  let offset = 0;
  while (offset < buf.length) {
    let res = 0n;
    let shift = 0n;
    let ok = false;
    while (offset < buf.length) {
      const b = buf[offset++];
      res |= BigInt(b & 0x7f) << shift;
      shift += 7n;
      if ((b & 0x80) === 0) {
        list.push(res <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(res) : res.toString());
        ok = true;
        break;
      }
      if (shift > 64n) return null;
    }
    if (!ok) return null;
  }
  return list.length >= 2 ? list : null;
}

/**
 * 核心递归解析函数
 */
function parseProtobufInternal(buffer, depth = 0) {
  if (depth > 12 || !buffer || buffer.length === 0) return null;
  const result = {};
  let offset = 0;
  let fieldCount = 0;

  function readVarint() {
    let res = 0n;
    let shift = 0n;
    while (offset < buffer.length) {
      const b = buffer[offset++];
      res |= BigInt(b & 0x7f) << shift;
      shift += 7n;
      if ((b & 0x80) === 0) {
        return res <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(res) : res.toString();
      }
      if (shift > 64n) throw new Error('Varint overflow');
    }
    throw new Error('Unexpected EOF reading varint');
  }

  try {
    while (offset < buffer.length) {
      const tag = readVarint();
      if (typeof tag !== 'number' || tag <= 0) return null;

      const fieldNumber = tag >>> 3;
      const wireType = tag & 0x07;
      if (fieldNumber === 0) return null;

      let value;

      if (wireType === 0) {
        // WireType 0: Varint (int32/int64/uint32/uint64/sint32/sint64/bool/enum)
        value = readVarint();
      } else if (wireType === 1) {
        // WireType 1: 64-bit (fixed64, sfixed64, double)
        if (offset + 8 > buffer.length) return null;
        const doubleVal = buffer.readDoubleLE(offset);
        const hex = buffer.subarray(offset, offset + 8).toString('hex');
        offset += 8;
        if (!isNaN(doubleVal) && Math.abs(doubleVal) > 1e-15 && Math.abs(doubleVal) < 1e15 && String(doubleVal).includes('.')) {
          value = doubleVal;
        } else {
          value = `0x${hex}`;
        }
      } else if (wireType === 2) {
        // WireType 2: Length-delimited (string, embedded message, packed repeated, bytes)
        const len = readVarint();
        if (typeof len !== 'number' || len < 0 || offset + len > buffer.length) return null;

        const slice = buffer.subarray(offset, offset + len);
        offset += len;

        if (len > 0) {
          // 优先尝试是否为嵌套子消息 (Embedded Message)
          const nested = parseProtobufInternal(slice, depth + 1);
          if (nested && Object.keys(nested).length > 0) {
            value = nested;
          } else if (isPrintableUtf8(slice)) {
            // 文本字符串
            value = slice.toString('utf8');
          } else {
            // 尝试 packed repeated varints 数组
            const packed = tryParsePackedVarints(slice);
            if (packed) {
              value = packed;
            } else {
              // 兜底为十六进制字节
              value = `0x${slice.toString('hex')}`;
            }
          }
        } else {
          value = '';
        }
      } else if (wireType === 5) {
        // WireType 5: 32-bit (fixed32, sfixed32, float)
        if (offset + 4 > buffer.length) return null;
        const floatVal = buffer.readFloatLE(offset);
        const intVal = buffer.readInt32LE(offset);
        offset += 4;
        if (!isNaN(floatVal) && Math.abs(floatVal) > 1e-6 && Math.abs(floatVal) < 1e9 && String(floatVal).includes('.')) {
          value = floatVal;
        } else {
          value = intVal;
        }
      } else {
        // 不支持或非法的 wireType（3, 4 为已弃用的 groups，6, 7 非法）
        return null;
      }

      fieldCount++;
      const fieldKey = String(fieldNumber);
      if (Object.prototype.hasOwnProperty.call(result, fieldKey)) {
        if (Array.isArray(result[fieldKey])) {
          result[fieldKey].push(value);
        } else {
          result[fieldKey] = [result[fieldKey], value];
        }
      } else {
        result[fieldKey] = value;
      }
    }
  } catch (e) {
    return null;
  }

  return fieldCount > 0 ? result : null;
}

/**
 * 判断是否为 Protobuf 相关的 Content-Type
 */
function isProtobufContentType(contentType = '') {
  if (!contentType) return false;
  const lower = contentType.toLowerCase();
  return lower.includes('application/x-protobuf') ||
         lower.includes('application/protobuf') ||
         lower.includes('application/x-google-protobuf') ||
         lower.includes('application/vnd.google.protobuf') ||
         lower.includes('x-protobuf');
}

/**
 * 对外公开的解码函数
 * @param {Buffer} buffer 原始二进制数据
 * @returns {{ success: boolean, data?: object, json?: string, error?: string }}
 */
function decodeProtobuf(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
    return { success: false, error: 'Empty buffer' };
  }

  const parsed = parseProtobufInternal(buffer, 0);
  if (parsed && Object.keys(parsed).length > 0) {
    return {
      success: true,
      data: parsed,
      json: JSON.stringify(parsed, null, 2)
    };
  }

  return { success: false, error: 'Invalid or unsupported Protobuf format' };
}

module.exports = {
  isProtobufContentType,
  decodeProtobuf
};
