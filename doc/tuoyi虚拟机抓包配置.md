# 两仪（Twoyi）免 Root 虚拟机 HTTPS 抓包配置全指南

本文档记录了在**未解锁 Bootloader / 无法获取真机 Root** 的设备（如华为 HarmonyOS、荣耀、OPPO、vivo 等）上，使用开源轻量级 Android 容器 **两仪（Twoyi）** 进行 HTTPS 全局抓包、系统根证书安装及幽灵进程解除的完整标准作业流程。

---

## 目录
- [一、背景与方案选型优势](#一背景与方案选型优势)
  - [1. 为什么弃用 VMOS Pro？](#1-为什么弃用-vmos-pro)
  - [2. 两仪（Twoyi）的核心技术优势](#2-两仪twoyi的核心技术优势)
- [二、前置准备：宿主机解除 Android 12+ 幽灵进程限制](#二前置准备宿主机解除-android-12-幽灵进程限制)
  - [1. 限制原理](#1-限制原理)
  - [2. 完整解除指令（通过 USB ADB 执行）](#2-完整解除指令通过-usb-adb-执行)
  - [3. 验证与恢复指令](#3-验证与恢复指令)
- [三、两仪的安装与初始化](#三两仪的安装与初始化)
  - [1. 下载与安装](#1-下载与安装)
  - [2. 首次启动与运行限制说明](#2-首次启动与运行限制说明)
- [四、极速安装抓包根证书（专属 ADB 22122 端口法）](#四极速安装抓包根证书专属-adb-22122-端口法)
  - [1. 证书准备](#1-证书准备)
  - [2. 连接两仪独立 ADB](#2-连接两仪独立-adb)
  - [3. 一键推送与赋权](#3-一键推送与赋权)
  - [4. 系统凭据验证](#4-系统凭据验证)
- [五、流量转发与全局代理配置](#五流量转发与全局代理配置)
  - [1. 一键开启全局代理](#1-一键开启全局代理)
  - [2. 一键清除/关闭代理](#2-一键清除关闭代理)
- [六、高级进阶：绕过 SSL Pinning（证书双向锁定）](#六高级进阶绕过-ssl-pinning证书双向锁定)
- [七、常见排查与故障处理（FAQ）](#七常见排查与故障处理faq)

---

## 一、背景与方案选型优势

### 1. 为什么弃用 VMOS Pro？
在 Android 7.0+ 之后，应用默认仅信任系统级 CA 证书（`/system/etc/security/cacerts/`），无法直接解密用户证书的 HTTPS 流量。为了在非 Root 真机上获取可写入的 `/system` 环境，传统方案多采用商业虚拟机（如 VMOS Pro），但存在严重痛点：
* **商业限制严重**：强制开屏广告、弹窗诱导、VIP 会员限制，甚至对关键功能加锁。
* **激活陷阱**：在 Android 12+ 强依赖 AOSP“无线调试配对码”，而华为 HarmonyOS 系统底层完全精简了该开关，导致卡死在激活界面。
* **权限冲突与挂载失败**：其预装的超级用户（Superuser）容易出现 `deny Permission denied` 拦截；底层分区挂载为只读时，MT 管理器常报 `挂载读写失败`。

### 2. 两仪（Twoyi）的核心技术优势
两仪由国内安全领域知名极客作者 **weishu**（太极 TaiChi、VirtualXposed 作者）主导开源（[GitHub: twoyi/twoyi](https://github.com/twoyi/twoyi)），具备以下特性：
* **完全开源且零广告**：代码公开透明，无任何商业广告与隐私上报。
* **真机免 Root 运行独立系统**：基于轻量级用户态容器技术，运行完整的 Android 8.1 操作系统，启动仅需 3 秒。
* **原生开放 Root**：内置 `su` 权限，无需授权弹窗或打架，直接提供最高 `uid=0(root)` 权限。
* **直接暴露独立 ADB 服务（端口 `22122`）**：电脑端可以通过局域网直接 `adb connect` 进虚拟机内部，一键部署证书与应用，体验堪比物理机。
* **系统证书目录直接可写**：`/system/etc/security/cacerts/` 直接归属于容器用户，免去复杂的 remount 挂载。

---

## 二、前置准备：宿主机解除 Android 12+ 幽灵进程限制

### 1. 限制原理
Google 自 Android 12 起引入了 **幽灵进程杀手（Phantom Process Killer）** 机制，限制单个应用所属的后台子进程数不能超过 32 个。两仪作为一个容器需要运行多个系统服务进程，极易触发该机制被系统无警告强杀。

### 2. 完整解除指令（通过 USB ADB 执行）
手机开启开发者模式并通过 USB 连接电脑，确认 `adb devices` 识别到真机后，在电脑终端执行以下持久化配置命令：

```bash
# 1. 禁用测试配置同步覆盖（防止系统重启后自动恢复）
adb shell "/system/bin/device_config set_sync_disabled_for_tests persistent"

# 2. 将幽灵进程最大允许数量提升至整型最大值 (2147483647)
adb shell "/system/bin/device_config put activity_manager max_phantom_processes 2147483647"

# 3. 彻底关闭幽灵进程监控开关 (兼容 Android 12 / 13 / 14 / HarmonyOS 4.x)
adb shell "/system/bin/settings put global settings_enable_monitor_phantom_procs 0"
```

### 3. 验证与恢复指令
* **验证当前限制值**：
  ```bash
  adb shell "/system/bin/device_config get activity_manager max_phantom_processes"
  # 输出 2147483647 即表示解除成功
  ```
* **如果未来不再使用两仪并希望恢复出厂默认值**：
  ```bash
  adb shell "/system/bin/device_config set_sync_disabled_for_tests none"
  adb shell "/system/bin/device_config put activity_manager max_phantom_processes 32"
  adb shell "/system/bin/settings put global settings_enable_monitor_phantom_procs 1"
  ```

---

## 三、两仪的安装与初始化

### 1. 下载与安装
* **官方网站**：[https://twoyi.app](https://twoyi.app)
* **GitHub Releases**：[https://github.com/twoyi/twoyi/releases](https://github.com/twoyi/twoyi/releases)
* 下载最新的 `twoyi-*.apk`，在真机上安装（包名为 `io.twoyi`）。

### 2. 首次启动与运行限制说明
1. **首次初始化**：打开两仪 App，会开始解压内置的 `rootfs.7z` 系统镜像，耗时约 1~2 分钟。初始化完成后，后续启动仅需 3 秒左右。
2. **架构约束**：两仪**仅支持 64 位（arm64-v8a）应用**，不支持老旧的 32 位应用（官方出于性能和体积考虑明确不适配 32 位）。

---

## 四、极速安装抓包根证书（专属 ADB 22122 端口法）

本方案直接利用两仪对局域网暴露的 **`22122`** 端口，在电脑端 5 秒内完成系统级根证书安装，无需手机端繁琐导入与挂载。

### 1. 证书准备
确保电脑本地已生成 `HqNetworkDebuger` 抓包根证书，标准的安卓哈希格式命名为：
* **证书文件**：`~/.hqnetwork/certs/8adeb422.0`（或当前项目根目录 `certs/8adeb422.0`）

### 2. 连接两仪独立 ADB
手机与电脑连接至同一 WiFi 网络，先获取手机的局域网 IP（例如 `10.10.204.197`）：

```bash
# 保证手机两仪 App 在前台运行，电脑执行连接：
adb connect 10.10.204.197:22122
```
*连接成功后，运行 `adb devices` 可看到：*
```text
List of devices attached
XPL0219B29000667       device      # 真机宿主 (USB)
10.10.204.197:22122    device      # 两仪虚拟机内部系统 (WiFi)
```

### 3. 一键推送与赋权
指定两仪设备标识符 `-s <手机IP>:22122`，直接写入系统证书目录：

```bash
# 1. 推送证书到两仪内部存储
adb -s 10.10.204.197:22122 push ~/.hqnetwork/certs/8adeb422.0 /sdcard/

# 2. 复制到系统受信任 CA 目录并设置 644 权限 (rw-r--r--)
adb -s 10.10.204.197:22122 shell "su -c 'cp /sdcard/8adeb422.0 /system/etc/security/cacerts/8adeb422.0 && chmod 644 /system/etc/security/cacerts/8adeb422.0'"
```

### 4. 系统凭据验证
在两仪桌面打开 **【设置】➔【安全】➔【信任的凭据】➔【系统】**，往下滚动，即可查看到：
* **证书名称**：`HqNetworkDebuger`
* **颁发者**：`HqNetworkDebuger`

说明系统根证书已永久信任生效！

---

## 五、流量转发与全局代理配置

抓包时需要将两仪系统内的所有网络流量路由到电脑端的 **HQ Network Debugger**（默认监听端口 `8888`）。

假设电脑的局域网 IP 为 **`10.10.206.99`**：

### 1. 一键开启全局代理
在电脑终端直接向两仪发送全局代理设置：
```bash
adb -s 10.10.204.197:22122 shell "settings put global http_proxy 10.10.206.99:8888"
```
*此时两仪内所有 App 发起的 HTTP/HTTPS 请求均会自动走电脑代理并被解密。*

### 2. 一键清除/关闭代理
抓包测试完成后，一键还原代理配置：
```bash
adb -s 10.10.204.197:22122 shell "settings put global http_proxy :0"
```

---

## 六、高级进阶：绕过 SSL Pinning（证书双向锁定）

部分高安全等级应用（如银行、社交、金融类 App）内置了客户端证书锁定（SSL Pinning），即使安装了系统根证书依然会断网或报握手失败。

两仪原生深度集成了 **太极·阳** 与 Xposed 支持：
1. **安装 Xposed 插件**：在两仪中安装 `JustTrustMe.apk` 或 `TrustMeAlready.apk`。
2. **太极激活**：在两仪内部打开预装的【太极】，勾选目标抓包 App 和 `JustTrustMe` 模块。
3. **效果**：系统在运行时会自动 Hook 掉底层 TrustManager 的校验逻辑，彻底粉碎 SSL Pinning 机制，实现 100% 成功抓包。

---

## 七、常见排查与故障处理（FAQ）

| 异常现象 | 核心原因 | 解决方案 |
| :--- | :--- | :--- |
| **`adb connect` 提示 connection refused** | 手机与电脑不在同一网段，或两仪未在前台运行 | 1. 确认手机和电脑连在同一个 WiFi 下；<br>2. 确保手机屏幕常亮且两仪 App 正在前台展示。 |
| **设备列表提示 `10.10.204.197:22122 offline`** | 手机息屏、锁屏或切到后台，系统将两仪网络挂起 | 点亮手机屏幕，重新切入两仪 App，在电脑端重新执行 `adb connect <手机IP>:22122`。 |
| **两仪闪退 / 运行一段时间被系统清理** | 未执行宿主机的幽灵进程解除指令 | 重新连接 USB，执行本文第二章的 `device_config put activity_manager max_phantom_processes 2147483647` 命令。 |
| **安装某个目标测试 App 提示失败** | 目标 App 仅包含 32 位 native so 库 | 检查该应用是否有 64 位（v8a）版本，两仪不支持仅 32 位的历史旧包。 |
| **抓包工具看到全是 CONNECT 但无解密明文** | 证书未生效或代理设置错误 | 1. 确认两仪系统凭据中已存在 `HqNetworkDebuger`；<br>2. 若 App 开启了证书绑定，按第六章安装 `JustTrustMe` 模块。 |
