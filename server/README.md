# vrdata 临时接收服务

静岸 VR 设备把本机记录（训练会话、问卷答卷、体验记录、行为事件）批量 POST 到 yecaoyun，落进一份 SQLite 文件。

服务有两个面：

- **上传面**：设备批量 POST，永远可用，不需要任何凭据。
- **读取面**：一个口令保护的单页数据台，`/vrdata/admin/`。**未设置 `VRDATA_PASSWORD` 时整个读取面不存在**，任何读取路由都回 404，服务退回纯只写接收器。口令只从环境变量读，不入库、不写日志、不返回。

标准库即可跑，零第三方 Python 依赖；前端是一个静态 HTML 文件，无构建、无 CDN、无第三方脚本。

## 契约

### `POST /vrdata/`

请求，`Content-Type` 必须恰为 `application/json`：

```json
{
  "version": 1,
  "deviceId": "tablet-01",
  "records": [
    {
      "id": "r-0001",
      "kind": "questionnaire",
      "occurredAt": "2026-11-14T09:30:00.000Z",
      "data": { "answers": [1, 0, 3], "score": null }
    }
  ]
}
```

- 整个请求体 **≤ 1 MiB**，`records` **≤ 100 条**（`nextBatchSize` 回这个上限）。
- `version` 必须是整数 `1`。
- `deviceId` / `id`：`[A-Za-z0-9._:-]`，1–128 字符。它们会被 shell 与 SQL 引用，故不收空格、引号、斜杠。
- `kind` 只能是 `questionnaire` / `training` / `experience` / `event`。
- `occurredAt`：ISO 8601，必须带时间（可带偏移，缺偏移按 UTC）。字符串本身另存一列。
- `data`：任意 JSON 值，**原样存文本**，服务不认识它的结构，也不校验业务字段。
- 同一批内 `id` 不得重复（两个 payload 可能不同，ACK 无法说明存了哪个）。

成功响应 `200`：

```json
{
  "version": 1,
  "acknowledged": ["r-0001"],
  "accepted": 1,
  "duplicates": 0,
  "nextBatchSize": 100
}
```

`acknowledged` **总是列出本批全部 id**，无论新入库还是重复。设备只凭这一列清理本地记录；返回部分 id 会让剩余记录永远留在头显里。判重键是 `(device_id, record_id)`：重放同一批不会新写任何东西，`accepted=0, duplicates=n`，ACK 与首次相同。

**整批原子**：任一条记录不合法 → `400`，整批不入库（校验在事务之前完成）。`accepted` 与 `duplicates` 在同一事务里数出来，重试竞争不会把一条记录既算新又算重。

失败响应体：

```json
{ "version": 1, "error": { "code": "invalid_record", "message": "records[2].kind must be one of event,experience,questionnaire,training" } }
```

| HTTP | code | 含义 |
| --- | --- | --- |
| 400 | `invalid_json` / `invalid_encoding` | 非 UTF-8，或非法 JSON（含 `NaN`/`Infinity`） |
| 400 | `length_required` / `invalid_length` / `incomplete_body` | 缺 `Content-Length`（含 chunked）、长度非法、体提前结束 |
| 400 | `body_too_large` | > 1 MiB；直接断连，不读取剩余请求体 |
| 400 | `unsupported_version` | `version` ≠ 1 |
| 400 | `invalid_field` | 缺字段或类型不对（`version`、`deviceId`、`records`、`id`、`kind`、`occurredAt`） |
| 400 | `invalid_timestamp` | 时间不是 ISO 8601 或过长 |
| 400 | `invalid_record` | 记录不是对象、`id` 非法、`kind` 不在白名单、`occurredAt` 非字符串、缺 `data` |
| 400 | `duplicate_in_batch` | 同批 `id` 重复 |
| 400 | `batch_too_large` | 记录数 > 100 |
| 415 | `unsupported_media_type` | `Content-Type` 不是 `application/json` |
| 503 | `storage_unavailable` | 写库失败；**不是** ACK，设备应保留记录后重试 |

响应头固定带 `Cache-Control: no-store`、`X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、`Referrer-Policy: no-referrer`、`Content-Security-Policy: default-src 'none'`。

### `GET /vrdata/health`

只回服务状态，不含记录数、设备列表或任何数据：

```json
{ "status": "ok", "version": 1 }
```

### 其他路径 / 方法

其他路径 `404`（空体），`/vrdata/` 上的 GET 与 `/vrdata/health` 上的 POST 回 `405` + `Allow`。`PUT`/`PATCH`/`DELETE`/`OPTIONS` 一律 `404`/`405`，空体——不确认服务存在什么。查询串被丢弃，`/vrdata/?id=…` 仍是提交端点。

## 读取面（口令保护，默认关闭）

设置环境变量 `VRDATA_PASSWORD` 后，服务多出 `/vrdata/admin/` 下的一个页面和一组只读 JSON 接口。未设置（或为空）时这些路径全部回 `404` 空体，与纯只写接收器不可区分。

口令**只**来自环境变量：没有命令行参数、没有配置文件字段、不入库、不在任何响应里回显、不写日志。启动时只保留一份加盐 PBKDF2 摘要用于常数时间比较。

### 页面

| 路径 | 说明 |
| --- | --- |
| `GET /vrdata/admin/` | 单页数据台。页面本身是登录框，不含任何记录；未登录也返回 200，登录与否由接口判定。 |

页面无构建步骤、无第三方依赖，`script-src 'unsafe-inline'` 与 `style-src 'unsafe-inline'` 是唯一的内联授权，其余 CSP 全部 `'none'`（含 `frame-ancestors 'none'`、`base-uri 'none'`、`form-action 'none'`）。响应带 `Cache-Control: no-store, must-revalidate`。

功能：四类记录计数（可点选筛选）、kind/device/时间区间筛选、分页表格、JSON 详情抽屉、按当前筛选导出 CSV、手动刷新与 30 秒自动刷新（页面隐藏或详情打开时暂停）、登出。手机与桌面共用同一份 DOM；键盘操作、可见焦点、`prefers-reduced-motion` 与深浅色对比都已处理。空结果、加载中、错误各有自己的状态与恢复动作。

### 接口

全部只读。没有任何删除、修改或导出路由。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/vrdata/admin/api/login` | 体 `{"password":"…"}`。成功 `200` + `Set-Cookie`；口令错 `401 invalid_credentials`；尝试过多 `429 too_many_attempts`。 |
| `POST` | `/vrdata/admin/api/logout` | 吊销当前会话并让浏览器清 Cookie，回 `{"authenticated":false}`。 |
| `GET` | `/vrdata/admin/api/session` | `200 {"authenticated":true,"expiresIn":43200}`；无会话 `401`。 |
| `GET` | `/vrdata/admin/api/facets` | 每类计数、每台设备计数、总数与时间跨度（最近 100 台设备）。 |
| `GET` | `/vrdata/admin/api/records` | 分页元数据，见下。 |
| `GET` | `/vrdata/admin/api/records/<deviceId>/<recordId>` | 单条详情，含解析后的 `data`。不存在回 `404 not_found`。 |
| `GET` | `/vrdata/admin/api/export.csv` | 按当前筛选导出 CSV，见下。 |

`/vrdata/admin/api/records` 的查询参数：

| 参数 | 取值 | 默认 |
| --- | --- | --- |
| `kind` | 四种 kind 之一 | 全部 |
| `device` | 设备 id（与上传同一套字符集） | 全部 |
| `since` / `until` | ISO 8601，两端**闭区间** | 不限 |
| `limit` | 1–100 | 25 |
| `offset` | 0–1000000 | 0 |
| `order` | `asc` / `desc`（按 `occurred_at`） | `desc` |

响应：

```json
{ "total": 128, "limit": 25, "offset": 0, "order": "desc",
  "records": [
    { "deviceId": "tablet-01", "recordId": "q-1", "kind": "questionnaire",
      "occurredAt": "2026-11-10T08:00:00.000Z", "occurredAtRaw": "2026-11-10T08:00:00Z",
      "receivedAt": "2026-11-10T08:00:03.220Z", "payloadBytes": 34 }
  ] }
```

列表**不返回** `payload`，只返回字节数；单条超过 64 KiB 的载荷在详情里以 `truncated: true` 标注而不是整段塞回。非法参数一律 `400`（`invalid_query` / `invalid_timestamp`），不会静默忽略——静默忽略会让人以为筛掉了。

### CSV 导出

`GET /vrdata/admin/api/export.csv` 复用 `kind` / `device` / `since` / `until` / `order` / `offset`，**忽略 `limit`**：导出的是筛选选中的全部记录，不是当前那一页。页面上的「导出 CSV」按钮就是这个路由，并会先探一次同样的筛选，确认 `401`/`400`/`413` 时在界面里报错而不是把错误 JSON 存成 `.csv`。

- `Content-Type: text/csv; charset=utf-8`，`Content-Disposition: attachment; filename="vrdata-<UTC 时间戳>.csv"`。
- 文件以 **UTF-8 BOM** 开头，Excel 直接双击中文不乱码。
- 列：`device_id,record_id,kind,occurred_at,occurred_at_raw,received_at,data_json`。`data_json` 是记录 `data` 的原始 JSON 文本。
- 逐行 `chunked` 流出，内存只驻留一行；单次最多 `50000` 行，超过回 `413 export_too_large` 并提示收窄筛选——**不截断**，一个看起来完整但其实少了一半的文件比报错更糟。
- 防公式注入：任何以 `=`、`+`、`-`、`@`、制表符或回车开头的单元格前置一个 `'`。记录 id 允许 `-`，载荷又是设备自定义文本，不加这一层，一条 `=HYPERLINK(...)` 就能在打开文件的运维机器上执行。
- 引号按 RFC 4180：含逗号、引号或换行的字段加双引号，内部引号翻倍。载荷里的换行因此仍是一条记录。
- 未登录 `401`，未配置口令 `404`，非法筛选 `400`——都不会开始输出文件体。

### 会话

- Cookie 名 `vrdata_session`，`Path=/vrdata/admin/`、`HttpOnly`、`SameSite=Strict`、`Max-Age=43200`（12 小时）；经 nginx 转发时附加 `Secure`（见下）。
- 令牌是 `<nonce>.<expiry>.<hmac>`，用 `/var/lib/vrdata/session.key`（`0600`，32 字节，首次启动生成）签名；重启不清登录态，换密钥则全部失效。
- 登出在服务端标记该令牌作废，旧 Cookie 重放回 `401`。
- 登录限流：同一来源地址 5 分钟内 5 次失败后 `429`，成功登录清零。限流在比对口令之前，所以被限流时口令正确也进不去。

## 数据库

单表，`WITHOUT ROWID`，主键即时判重键：

```sql
CREATE TABLE records (
    device_id       TEXT NOT NULL,
    record_id       TEXT NOT NULL,
    kind            TEXT NOT NULL CHECK (kind IN ('questionnaire','training','experience','event')),
    occurred_at     TEXT NOT NULL,   -- 规范化为 UTC ...,000Z，便于排序
    occurred_at_raw TEXT NOT NULL,   -- 设备原始字符串，便于回溯偏移/精度
    received_at     TEXT NOT NULL,   -- 服务端落库时刻
    payload         TEXT NOT NULL,   -- data 的 JSON 文本，键已排序
    PRIMARY KEY (device_id, record_id)
) WITHOUT ROWID;

CREATE INDEX records_by_occurred_at ON records (kind, occurred_at);
```

WAL、`synchronous=NORMAL`、`busy_timeout=15s`、每批一个 `BEGIN IMMEDIATE … COMMIT`。`synchronous=NORMAL` 的取舍：断电可能丢 WAL 尾部的未提交内容，但已提交并被 ACK 的批次（设备已删除本地副本）不会丢。`foreign_keys=ON` 目前无外键，保留给后续表。

## 部署

### 0. 本地试跑

```bash
# 写入面照旧
python3 server/vrdata_receiver.py --database /tmp/vrdata.sqlite3
curl -sS http://127.0.0.1:8197/vrdata/health

# 加口令后才有读取面
VRDATA_PASSWORD='local-test' python3 server/vrdata_receiver.py --database /tmp/vrdata.sqlite3
# 浏览器打开 http://127.0.0.1:8197/vrdata/admin/
```

默认监听 `127.0.0.1:8197`，数据库默认 `$VRDATA_DATABASE` 或当前目录下的 `vrdata.sqlite3`（不写进仓库：用 `/tmp` 或 `--database` 指到别处）。会话签名密钥默认在数据库同目录的 `session.key`，可用 `--key-file` 或 `$VRDATA_SESSION_KEY_FILE` 改位置。

`vrdata_admin.html` 必须与 `vrdata_receiver.py` 放在同一目录：配置了口令却找不到页面时，服务拒绝启动而不是给出一个空页面。

### 1. 代码与账号

```bash
sudo install -d -m 0755 /opt/vrdata
sudo install -m 0755 server/vrdata_receiver.py /opt/vrdata/
sudo install -m 0644 server/vrdata_admin.html server/README.md /opt/vrdata/

sudo useradd --system --no-create-home --shell /usr/sbin/nologin vrdata
sudo install -d -m 0700 -o vrdata -g vrdata /var/lib/vrdata
```

`python3` 3.11+ 即可（用到 `datetime.fromisoformat` 解析 `Z` 后缀）。服务只依赖标准库，不需要 venv、pip 或 requirements。

### 1b. 口令

```bash
sudo install -d -m 0700 /etc/vrdata
sudo sh -c 'umask 077; printf "VRDATA_PASSWORD=%s\n" "$(head -c 24 /dev/urandom | base64 | tr -d "/+=")" > /etc/vrdata/vrdata.env'
sudo chmod 0600 /etc/vrdata/vrdata.env
sudo systemctl restart vrdata-receiver
```

口令文件由 systemd 的 `EnvironmentFile=-/etc/vrdata/vrdata.env` 读入。该文件必须 `0600`（属主 root 或 `vrdata`）：它和数据库同等敏感。把它写进仓库、单元文件或数据库都是错的。

不建这个文件，服务就是纯只写接收器，读取面完全不存在。想临时关掉读取面：删掉文件里的 `VRDATA_PASSWORD=` 一行并 `systemctl restart`。

### 2. systemd

```bash
sudo install -m 0644 server/vrdata-receiver.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now vrdata-receiver
systemctl status vrdata-receiver
journalctl -u vrdata-receiver -n 20      # 只有请求行与计数
```

单元里 `ProtectSystem=strict` + `ReadWritePaths=/var/lib/vrdata`：除了数据库目录，整个文件系统只读。`User=vrdata`、`UMask=0077`、空 `CapabilityBoundingSet`、`SystemCallFilter=@system-service`、`PrivateUsers`、`MemoryDenyWriteExecute` 等把服务面压到最小。日志只记方法、路径与结果码，不记请求体、口令、会话值，也不记患者内容。

`UMask=0077` 决定 `session.key` 与 SQLite 文件的权限；密钥另在创建时显式 `0600`，不依赖 umask。

### 3. Nginx

```bash
sudo cp server/nginx-vrdata.conf.example /etc/nginx/conf.d/vrdata.conf
sudo vi /etc/nginx/conf.d/vrdata.conf   # 改 server_name 与证书路径
sudo nginx -t && sudo systemctl reload nginx
```

示例只放行 `/vrdata/`、`/vrdata/health` 与 `/vrdata/admin/`（后者本身还要口令），其余 `/vrdata/` 与 `/` 都 `return 404`；80 端口只做 308 跳转，避免明文上传。证书用 certbot 签发后把两行 `ssl_certificate*` 指向 `live/` 下的文件。接收器本身只监听 `127.0.0.1:8197`，公网不可直连。

`/vrdata/admin/` 的两个 location 转发 `X-Forwarded-Proto $scheme`：服务据此给会话 Cookie 加 `Secure`，即使后端在回环上说的是明文 HTTP。没有 nginx（本地直连）时会话照常工作，只是不带 `Secure`。

防火墙只需放行 443（80 只为跳转）：

```bash
sudo firewall-cmd --add-service=https --add-service=http --permanent && sudo firewall-cmd --reload
# 或 ufw allow 443/tcp; ufw allow 80/tcp
```

### 4. 验收

```bash
curl -sS https://vrdata.example.invalid/vrdata/health
# {"status":"ok","version":1}

curl -sS -X POST https://vrdata.example.invalid/vrdata/ \
  -H 'Content-Type: application/json' \
  -d '{"version":1,"deviceId":"probe","records":[
        {"id":"probe-1","kind":"event","occurredAt":"2026-11-14T00:00:00Z","data":{"probe":true}}]}'
# {"version":1,"acknowledged":["probe-1"],"accepted":1,"duplicates":0,"nextBatchSize":100}

# 重放同一条：duplicates=1, accepted=0, ACK 相同
curl -sS -X POST …（同上）

# 未登录读不到记录
curl -sS -o /dev/null -w '%{http_code}\n' https://vrdata.example.invalid/vrdata/admin/api/records   # 401

# 口令正确才拿到会话
curl -sS -c /tmp/vr.cookie -X POST https://vrdata.example.invalid/vrdata/admin/api/login \
  -H 'Content-Type: application/json' -d "{\"password\":\"$VRDATA_PASSWORD\"}"
curl -sS -b /tmp/vr.cookie 'https://vrdata.example.invalid/vrdata/admin/api/records?limit=2' | head -c 400
rm -f /tmp/vr.cookie

# 页面与无关路径
curl -sS -o /dev/null -w '%{http_code}\n' https://vrdata.example.invalid/vrdata/admin/   # 200
curl -sS -o /dev/null -w '%{http_code}\n' https://vrdata.example.invalid/                # 404
```

未配置口令时，`/vrdata/admin/` 与全部 `/vrdata/admin/api/*` 都回 `404` 空体——此时最后三条里第一条应是 `404` 而不是 `401`。

验收后把探针行删掉（务必带 `WHERE`）：

```bash
sudo -u vrdata sqlite3 /var/lib/vrdata/vrdata.sqlite3 \
  "DELETE FROM records WHERE device_id='probe';"
```

## SSH 查询

日志里没有数据，数据只在这份文件里。以 `vrdata` 账号身分只读打开，避免误写：

```bash
# 最近 20 条（只显示元数据）
sudo -u vrdata sqlite3 -readonly -header -column /var/lib/vrdata/vrdata.sqlite3 \
  "SELECT received_at, device_id, kind, occurred_at, record_id
     FROM records ORDER BY received_at DESC LIMIT 20;"

# 某台设备的各类计数
sudo -u vrdata sqlite3 -readonly -header -column /var/lib/vrdata/vrdata.sqlite3 \
  "SELECT kind, count(*) AS n, min(occurred_at) AS first, max(occurred_at) AS last
     FROM records WHERE device_id='tablet-01' GROUP BY kind;"

# 问卷答卷：payload 就是 JSON 文本，交给 jq
sudo -u vrdata sqlite3 -readonly /var/lib/vrdata/vrdata.sqlite3 \
  "SELECT payload FROM records WHERE kind='questionnaire' ORDER BY occurred_at DESC LIMIT 1;" \
  | jq .

# 全部问卷汇总成一张表（id、分数、答完与否、场景）
sudo -u vrdata sqlite3 -readonly -json /var/lib/vrdata/vrdata.sqlite3 \
  "SELECT occurred_at, device_id, payload FROM records WHERE kind='questionnaire' ORDER BY occurred_at;" \
  | jq -r '.[] | [.occurred_at, .device_id,
        (.payload|fromjson|.questionnaireId), (.payload|fromjson|.score),
        (.payload|fromjson|.complete), (.payload|fromjson|.scene)]
        | @tsv'

# 导出整库（复制前先确保没有写入高峰；SQLite 的 .backup 是安全做法）
sudo -u vrdata sqlite3 /var/lib/vrdata/vrdata.sqlite3 ".backup '/tmp/vrdata-backup.sqlite3'"
sudo -u vrdata sqlite3 /var/lib/vrdata/vrdata.sqlite3 ".mode csv" ".output /tmp/records.csv" \
  "SELECT * FROM records;" ".output stdout"
```

`payload` 里的键已排序、分隔符紧凑，`fromjson` 直接可用；服务不解释内容，业务结构随设备端版本变化也不会需要迁移。

## 运维注意

- **备份**：`.backup` 或 `sqlite3 VACUUM INTO`，不要直接 `cp` 处于 WAL 状态的库文件（也要一并 copy `-wal`/`-shm`，否则不一致）。
- **容量**：一条记录通常是几百字节到几 KB；按 100 条/批估算，十万条约几十 MB，无需分区。
- **清理**：数据由设备端在收到 ACK 后删除本地副本；服务端从不主动删。需要留存策略时按 `received_at` 手动删：`DELETE FROM records WHERE received_at < '2026-12-01T00:00:00.000Z';`
- **TLS 到期**：证书续期由 certbot 负责，`nginx -s reload` 后生效；健康检查失败时先看 `journalctl -u vrdata-receiver` 与 `nginx -t`。
- **停机**：`systemctl stop vrdata-receiver` 会让设备收到连接错误而非 ACK，记录保留在设备侧，恢复后自动重发；重发幂等，不会重复入库。
- **隐私**：日志与错误信息只含字段名、下标和计数，不含患者作答与体验文本，也不含口令或会话值；数据库文件权限 `0600` 且属 `vrdata`。日常查看走 `/vrdata/admin/`，需要原始行时仍用 `sudo -u vrdata sqlite3 -readonly`。
- **口令轮换**：改 `/etc/vrdata/vrdata.env` 后 `systemctl restart vrdata-receiver`。签名密钥不变，所以已在别处的旧会话仍有效直到 12 小时过期；想立刻踢掉所有会话就同时删除 `/var/lib/vrdata/session.key` 再重启（密钥重新生成）。

## 测试

```bash
python3 -m unittest discover -s server -p 'test_*.py' -v
```

测试用真实临时数据库 + 真实回环 HTTP（随机端口、后台线程），断言直接读 SQLite。

上传面覆盖：首次入库、整批重放、部分重复、同 id 跨设备、100/101 条边界、1 MiB 边界、各类非法字段整批拒绝、`Content-Type`/`Content-Length` 缺失。

读取面覆盖：未配置口令时 `/vrdata/admin/` 与全部接口（含 CSV 导出）`404` 空体且不写密钥文件、错误口令 `401` 不发 Cookie 且不回显口令、成功登录的 Cookie 属性（`HttpOnly`/`SameSite=Strict`/`Path`/`Max-Age`，以及经 `X-Forwarded-Proto` 才有 `Secure`）、伪造与过期令牌被拒、5 次失败后限流 `429`、成功登录清零计数、密钥文件 `0600`、重启后旧会话仍有效、日志不含口令与会话值、登出后重放旧 Cookie 回 `401`、以及 kind/device/时间闭区间筛选、升序降序、分页不重不漏、非法参数 `400`、详情与 `404`、空结果 `total:0`，最后确认上传不需要会话、读取不写库。

CSV 导出覆盖：未登录 `401`、未配置口令 `404`、BOM 与 `Content-Disposition: attachment` 文件名、七列表头与逐行字段、多行中文载荷往返（用 `csv` 模块解析验证一条记录仍是一条记录）、`=`/`+`/`-`/`@`/制表符/回车六种公式前缀都被加 `'` 中和、普通文本不被多加引号、逗号/引号/换行按 RFC 4180 转义、筛选被复用（kind/device/闭区间）、空结果只出表头、非法筛选在输出文件体之前就 `400`、超过行数上限 `413` 而不是截断、`limit` 被忽略而 `offset` 生效、POST 回 `405`、以及流式迭代器按行产出并在上限处停下。

测试里的口令是固定 fixture（`TEST_PASSWORD`），不是任何真实部署值；服务端只在 `main()` 里从环境变量取口令，测试直接把它传给 `make_server`。
