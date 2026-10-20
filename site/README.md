# qs.205716.xyz

极简项目站，静态托管在 yecaoyun 的 nginx；重点是把最新版两个 APK 放到可下载的位置，并保留 GitHub 入口。

## 当前部署

- 目录：`/var/www/qs.205716.xyz/`
- nginx：`/etc/nginx/sites-available/qs.205716.xyz.conf`
- 证书：`/etc/letsencrypt/live/qs.205716.xyz/`（Let's Encrypt，webroot `/var/www/html`）
- DNS：Cloudflare A `qs.205716.xyz` → `68.64.178.247`，DNS-only
- APK：`/downloads/quiet-shore-headset.apk`、`/downloads/quiet-shore-control.apk`
- manifest：`/downloads/manifest.json`

`site/main.js` 优先读同源 manifest，再回退 GitHub API；manifest 存在时页面显示的版本、下载和安装命令都来自本地镜像。

## 发布新版本

本机构建后：

```bash
npm run build && npm run standalone
(cd android && ./gradlew :headset:assembleDebug :control:assembleDebug)
./site/deploy.sh
```

仓库已公开，公网页面可以调用 GitHub Release API。服务器上运行 `sync-downloads.sh` 时，本地镜像会自动跟随 latest release；若镜像暂缺，页面回退 GitHub。部署方式：

1. 在服务器上放一个有 `repo` 读权限的 GitHub token，定时运行 `sync-downloads.sh`（脚本已支持 `GITHUB_TOKEN`），或
2. 在 release workflow / 独立 workflow 中用 SSH secrets 直接把 APK 推到本目录。

在完成其中一条之前，`deploy.sh` 是可靠的当前方案；页面仍会在 manifest 缺失时回退到 GitHub Release 页面。
