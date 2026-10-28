# 安卓免 Root 真机 HTTPS 抓包配置实战指南（LSPatch 定制版 + AppProxy）

本文档记录了在**未解锁 Bootloader、无 Root 权限**的 Android 实体设备（如华为 HarmonyOS、小米 HyperOS、荣耀 MagicOS、OPPO ColorOS、vivo OriginOS 等）上，使用**定制版 LSPatch Manager（内置 SSLBypass / JustTrustMePro 逻辑，免 Shizuku）**与开源 **AppProxy（基于 tun2socks 的分应用代理）** 配合，实现对任意第三方 App 进行高可靠、免配置的 HTTPS 流量解密与抓包排错的完整实战指南。

---

## 目录
- [一、背景与免 Root 抓包痛点](#一背景与免-root-抓包痛点)
  - [1. 现代 Android 抓包的三大阻碍](#1-现代-android-抓包的三大阻碍)
  - [2. 本套方案的技术优势](#2-本套方案的技术优势)
- [二、整体工作架构原理](#二整体工作架构原理)
- [三、工具准备与获取](#三工具准备与获取)
  - [1. 定制版 LSPatch Manager](#1-定制版-lspatch-manager)
  - [2. AppProxy 代理客户端](#2-appproxy-代理客户端)
  - [3. 本机抓包服务（HQ Network Debugger）](#3-本机抓包服务hq-network-debugger)
- [四、第一步：安装定制版 LSPatch 并修补目标 App](#四第一步安装定制版-lspatch-并修补目标-app)
  - [1. 安装 Manager APK 到真机](#1-安装-manager-apk-到真机)
  - [2. 在手机上修补目标应用](#2-在手机上修补目标应用)
- [五、第二步：配置 AppProxy 实现精准分应用导流](#五第二步配置-appproxy-实现精准分应用导流)
  - [1. 基础代理设置](#1-基础代理设置)
  - [2. 关键核心步骤：勾选目标应用分流（避坑必读）](#2-关键核心步骤勾选目标应用分流避坑必读)
  - [3. 开启 VPN 代理服务](#3-开启-vpn-代理服务)
- [六、第三步：启动抓包与验证 HTTPS 明文报文](#六第三步启动抓包与验证-https-明文报文)
- [七、核心技术原理剖析（二次开发与集成细节）](#七核心技术原理剖析二次开发与集成细节)
  - [1. 为什么无需 Shizuku 服务？](#1-为什么无需-shizuku-服务)
  - [2. 为什么无需外挂 JustTrustMePro 模块？](#2-为什么无需外挂-justtrustmepro-模块)
- [八、常见问题排查与 FAQ](#八常见问题排查与-faq)
- [九、参考开源项目与鸣谢](#九参考开源项目与鸣谢)

---

## 一、背景与免 Root 抓包痛点

### 1. 现代 Android 抓包的三大阻碍
1. **Android 7.0+ 系统证书隔离**：系统默认只信任系统预置 CA 证书（位于 `/system/etc/security/cacerts/`），用户自行在系统设置中安装的 CA 证书不被大多数 App 信任。
2. **证书绑定（SSL / TLS Pinning）**：主流 App（如使用 OkHttp、Conscrypt、Chromium 内核或自研网络库）在客户端写死了公钥指纹或证书链，只要检测到证书被替换（即便是 Charles / Fiddler 等抓包代理自签证书），就会直接断开连接或报 `SSLHandshakeException`。
3. **忽略系统 Wi-Fi 代理**：越来越多的 App 在网络请求中显式设置了 `Proxy.NO_PROXY`，导致直接在手机 Wi-Fi 中设置的 HTTP 代理对其毫无作用，抓包工具根本捕获不到任何数据包。

### 2. 本套方案的技术优势
相比于两仪（Twoyi）等“虚拟机容器方案”或者需要刷机解锁的 Root 方案，本套方案具有极强的便捷性：
* **真机原生运行**：无需运行庞大的虚拟机镜像，直接在物理真机硬件上流畅运行，性能损耗为 0。
* **零 Root、零 Shizuku**：彻底去除原版 LSPatch 强制依赖 Shizuku 服务的门槛，普通 Android 手机均可直接安装使用。
* **零模块外挂**：将 `JustTrustMePro` 的全套网络证书信任放行逻辑**完全编译进底座核心**，修补后的 App 天然具备绕过 Pinning 能力，告别复杂的模块作用域管理。
* **精准分流**：使用基于 `tun2socks` 的 AppProxy，避免全局代理导致手机其它日常应用（微信、系统服务等）断网或速度受影响。

---

## 二、整体工作架构原理

整个链路采用 **“应用层证书解除 + 网络层 TUN 分流”** 的分层协同架构：

```
┌────────────────────────────────────────────────────────┐
│                      Android 真实物理机                 │
│                                                        │
│  ┌───────────────────────────────┐                     │
│  │    目标被修补 App (例如某电商)  │                     │
│  │  ┌─────────────────────────┐  │                     │
│  │  │ 内置 LSPatch patch-loader│  │                     │
│  │  │ (自动放行 TrustManager & │  │                     │
│  │  │  CertificatePinner)     │  │                     │
│  │  └────────────┬────────────┘  │                     │
│  └───────────────┼───────────────┘                     │
│                  │ 发起网络请求 (无需任何配置，信任抓包自签 CA) │
│                  ▼                                     │
│  ┌───────────────────────────────┐                     │
│  │      Android VpnService       │                     │
│  │  (检测包名在 AppProxy 白名单中)│                     │
│  └───────────────┬───────────────┘                     │
│                  ▼ 拦截 TCP/UDP 流量                   │
│  ┌───────────────────────────────┐                     │
│  │     AppProxy (tun2socks)      │                     │
│  │   转换成 Socks5 / HTTP 代理   │                     │
│  └───────────────┬───────────────┘                     │
└──────────────────┼─────────────────────────────────────┘
                   │ Wi-Fi 局域网传输
                   ▼
┌────────────────────────────────────────────────────────┐
│                   电脑端抓包工具                        │
│            HQ Network Debugger / Charles               │
│                                                        │
│  - 端口: 8888 (HTTP 代理端口)                          │
│  - 动态签发自签名 HTTPS 证书                             │
│  - 实时解析呈现 Structure / Sequence 请求明文          │
└────────────────────────────────────────────────────────┘
```

---

## 三、工具准备与获取

| 工具名称 | 说明 | 存放位置 / 获取方式 |
| :--- | :--- | :--- |
| **定制版 LSPatch Manager** | 已去除 Shizuku 强制检查，已内置 SSL 证书放行底座 | 项目 `apks/` 目录（或启动项目后在「手机配网」面板一键下载） |
| **AppProxy** | 基于 Flutter + tun2socks 的免 Root 分应用代理工具 | 开源项目（见文末参考链接） |
| **HQ Network Debugger** | 本项目网络调试工具（基于 Mockttp + Vue 3） | 本项目 `npm start` 或运行桌面版客户端 |

---

## 四、第一步：安装定制版 LSPatch 并修补目标 App

### 1. 安装 Manager APK 到真机
将定制编译好的安装包（可在项目的 `apks/` 目录下找到）安装至手机。手机开启 USB 调试后执行：

```bash
# 如果之前安装过旧版签名冲突，可先卸载：
adb uninstall org.lsposed.lspatch

# 安装项目内提供的定制版 Manager
adb install apks/LSPatch-v1.2-492-release.apk
```
> 也可以直接在手机浏览器访问本工具控制台（`http://<电脑局域网IP>:8899/apks/LSPatch-v1.2-492-release.apk`）直接下载安装。

### 2. 在手机上修补目标应用
1. 打开手机上的 **LSPatch**；
2. 切换到下方的 **「管理」** 标签页，点击右下角 **「+」** 号；
3. 选择一个修补模式：
   - **推荐：本地模式 (Local Mode)**：生成体积较小、修改痕迹最少的轻量级安装包。
4. 选择存储目录（首次需授权访问一个系统文件夹，如 `Download` 目录）；
5. 从列表中选择需要抓包的目标应用，或者直接选取本地的 `.apk` 安装包；
6. **模块配置**：无需在模块列表中勾选任何插件（因为证书放行逻辑已经内置进底座了）；
7. 点击右下角 **「开始修补」**，等待提示修补成功；
8. 点击 **「安装」**，系统将调用原生应用安装器直接完成安装（如提示签名冲突，先备份并卸载原版，再点击安装修补版）。

---

## 五、第二步：配置 AppProxy 实现精准分应用导流

AppProxy 是基于 Android 系统 `VpnService` 的代理客户端，它的作用是把被修补 App 的网络数据包拦截并转发至电脑端的抓包服务。

### 1. 基础代理设置
1. 打开手机上的 **AppProxy** 客户端；
2. **代理协议**：选择 `HTTP`（或 `SOCKS5`）；
3. **代理主机 (Host)**：填写电脑在局域网中的 IP 地址（可在 HQ Network Debugger 顶部「手机配网」查看，例如 `192.168.1.100`）；
4. **代理端口 (Port)**：填写抓包服务的监听端口（HQ Network Debugger 默认端口为 `8888`）。

### 2. 关键核心步骤：勾选目标应用分流（避坑必读）
> [!IMPORTANT]
> **这是最关键的避坑点！**
> AppProxy 默认通过白名单方式分流。如果未将目标 App 加入代理列表，Android 系统会认为该 App 的流量不属于 VPN 接管范围，导致数据包直接直连外网，电脑端抓包工具一条请求也收不到！

* 进入 AppProxy 的 **「应用分流 / 选择应用 (App Selection)」** 界面；
* 在应用列表里找到并**勾选刚才经过 LSPatch 修补安装的目标 App**；
* 其他日常通讯、系统服务应用无需勾选，保持正常直连。

### 3. 开启 VPN 代理服务
- 返回 AppProxy 主界面，点击连接开关；
- 系统会弹出 **“网络连接请求 / 是否信任此 VPN”** 的授权提示框，点击 **“允许 / 确定”**；
- 状态栏显示钥匙或 VPN 图标，表示代理已就绪。

---

## 六、第三步：启动抓包与验证 HTTPS 明文报文

1. **电脑端启动抓包**：
   在 HQ Network Debugger 桌面端点击顶部 **「▶ 开始抓包」** 按钮，确保右侧代理状态灯显示正常（`127.0.0.1:8888 运行中`）。
2. **手机端启动目标 App**：
   打开刚才修补后的目标应用，进行正常的页面浏览或业务操作。
3. **查看报文**：
   返回电脑端抓包控制台，即可在 **Structure 树形视图** 或 **Sequence 序列视图** 中实时看到解密后的完整 HTTPS 请求头、参数及响应体（JSON）。

---

## 七、核心技术原理剖析（二次开发与集成细节）

为了实现上述真正“开箱即用”的体验，本项目对 LSPatch 进行了针对性的二次开发与架构融合：

### 1. 为什么无需 Shizuku 服务？
- **原版痛点**：官方版 LSPatch 强制优先寻找 Shizuku 服务来静默安装修补后的 APK。如果检测不到 Shizuku，就会弹窗阻断或要求用户开启无线调试配对。
- **改进方案**：
  - 重构了 `manager/.../PatchJobHost.kt` 与 `LSPPackageManager.kt` 中的安装分发逻辑；
  - 移除了 Shizuku 的必须前置断言，若无 Shizuku，直接构造 `ACTION_VIEW` 或 `ACTION_INSTALL_PACKAGE` 意图拉起 Android 原生系统的 PackageInstaller；
  - 同时在修补结果界面提供直接导出 APK 到外部存储的能力。

### 2. 为什么无需外挂 JustTrustMePro 模块？
- **原版痛点**：通常需要同时安装一个专门的 Xposed 插件并在 LSPatch 里指定加载，操作步骤繁琐且模块容易失效。
- **改进方案**：
  - 将 `JustTrustMePro` 的关键 Hook 逻辑整合进 `patch-loader/.../SSLBypass.java`；
  - 在 `LSPApplication.java` 的类加载器初始化阶段（`switchAllClassLoader()` 之后）直接常驻激活：
    ```java
    // LSPApplication.java
    switchAllClassLoader();
    SSLBypass.doSSLBypass(appLoadedApk.getClassLoader());
    ```
  - **覆盖的 Hook 点包括**：
    - `NetworkSecurityTrustManager`: `checkServerTrusted` 与 `checkPins` 降级放行；
    - `TrustManagerImpl`: `checkServerTrusted`、`checkTrustedRecursive` 与 `verifyChain`；
    - `OkHttp3 / OkHttp2`: 拦截 `CertificatePinner.check` 与 `check$okhttp`，直接置空阻止抛出异常；
    - `SSLContext.init()`: 注入全信任的 `TrustManager` 与 `SSLSocketFactory`；
    - `WebViewClient`: 在 `onReceivedSslError` 回调中自动触发 `handler.proceed()`。

---

## 八、常见问题排查与 FAQ

### Q1: 开启了 AppProxy，为什么在抓包工具里依然完全看不到目标 App 的任何请求？
1. **检查应用是否勾选**：打开 AppProxy，确认**在分应用列表中是否准确勾选了该 App**；
2. **检查局域网连通性**：确认手机与电脑连接的是同一个 Wi-Fi（且路由器没有开启“AP 隔离”），在手机浏览器尝试访问 `http://<电脑IP>:8888`，确认能够正常访问；
3. **防火墙阻断**：确认电脑系统防火墙放行了 8888 端口。

### Q2: 请求显示红色的 SSL 握手失败，报 `SSLHandshakeException`？
- 这种情况通常说明目标 App 并非使用修补版运行。请确认手机上确实启动的是**经过 LSPatch 修补后的版本**（如果手机桌面有双开或原版，请先卸载原版）。

### Q3: 为什么有的应用修补后依然无法抓取 HTTPS？
本方案能 100% 解决基于 Java / Kotlin / Android 系统网络库（OkHttp、HttpURLConnection、Conscrypt、WebView、TBS 等）的应用。但存在以下极少数特殊情况：
- **纯 Flutter / Dart 独立网络引擎**：Flutter 应用的 Dart 虚拟机直接打包了独立的 BoringSSL，并绕过了系统的网络安全配置。此类应用需要通过 Hook `libflutter.so` 中的 `ssl_crypto_x509_session_verify_cert_chain` 符号来解除。
- **高安全级别金融/自研 C++ 网络库**：通过 Native JNI 完全自研网络传输引擎且加固反调试。此类 App 建议配合虚拟机方案（参考 [两仪虚拟机抓包配置](tuoyi虚拟机抓包配置.md)）或针对性的 Native Hook。

### Q4: 提示应用安装失败：“安装包与现有应用签名不一致”？
Android 系统强制要求同包名应用必须具有相同签名。因为 LSPatch 重打包后使用的是测试证书重新签名，所以安装前**必须先卸载手机上的原版应用**，然后再安装修补后的 APK。

---

## 九、参考开源项目与鸣谢

本方案的二次开发与技术实现参考了以下优秀的开源项目，特此致敬与鸣谢：

* **LSPatch**：[https://github.com/JingMatrix/LSPatch](https://github.com/JingMatrix/LSPatch)
  * 免 Root 环境下的 Android 动态代码加载与 APK 自动化重打包框架。
* **LSPosed**：[https://github.com/LSPosed/LSPosed](https://github.com/LSPosed/LSPosed)
  * 新一代基于 Riru / Zygisk 的 Xposed 框架标准与核心运行时 API。
* **AppProxy**：[https://github.com/ys1231/appproxy](https://github.com/ys1231/appproxy)
  * 基于 Flutter + `tun2socks` 构建的轻量级免 Root 分应用代理/抓包辅助客户端。
* **JustTrustMe**：[https://github.com/Fuzion24/JustTrustMe](https://github.com/Fuzion24/JustTrustMe)
  * 经典开源 Android 证书信任适配插件，开创了通过动态 Hook 拦截客户端 TrustManager 的调试思路。
* **JustTrustMePro**：[https://github.com/hang666/JustTrustMePro](https://github.com/hang666/JustTrustMePro)
  * 增强版证书信任适配插件，扩展了对 Android 7.0+ NetworkSecurityConfig、Conscrypt、OkHttp 高版本混淆方法的覆盖。
* **Twoyi（两仪）**：[https://github.com/twoyi/twoyi](https://github.com/twoyi/twoyi)
  * 由 weishu 主导开源的轻量级免 Root Android 容器，为不需要重打包的场景提供另一种全功能虚拟化解决方案。

