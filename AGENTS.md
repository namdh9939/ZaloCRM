# AGENTS.md — Quy tắc và context cho AI agent

> File này là **nguồn sự thật** cho mọi agent (Claude Code, Cursor, ChatGPT…) khi làm việc với codebase ZaloCRM. Đọc kỹ trước khi đề xuất thay đổi. Cập nhật file này khi user đưa ra preference mới.

---

## 1. Bối cảnh dự án

**ZaloCRM** = hệ thống CRM quản lý nhiều tài khoản Zalo cá nhân, dùng nội bộ cho công ty **Nhà Của Mình (NCM)**.

- **Doanh nghiệp**: NCM cung cấp dịch vụ **Trợ Lý Xây Nhà (TLXN)** — tư vấn & giám sát xây dựng dân dụng độc lập.
- **Phạm vi địa lý**: chỉ **TP.HCM** (khách ngoài tỉnh = `lost`).
- **Khách hàng**: chủ nhà mới xây / sửa nhà.
- **Sản phẩm**: 17 SKU gồm khóa học + gói giám sát theo tháng (4.98tr → 34.98tr/tháng).
- Chi tiết business → [docs/business-context-ncm.md](docs/business-context-ncm.md).

---

## 2. Production

| Thông tin | Giá trị |
|---|---|
| **URL production** | `https://zalo.nhacuaminh.com` |
| **VPS** | `cyber-box-986` — Ubuntu 20.04, 1 vCPU, 2GB RAM, 25GB NVMe |
| **IP public** | `23.142.84.68` (Montana, US) |
| **SSH** | `ubuntu@23.142.84.68` (password auth, **NO** SFTP subsystem) |
| **Code path trên VPS** | `/home/ubuntu/ZaloCRM/` (KHÔNG phải git repo) |
| **Reverse proxy** | Caddy 2 (auto SSL Let's Encrypt) |
| **DB** | Postgres 16 trong container `zalo-crm-db` |
| **Backup** | Container `zalo-crm-backup` chạy `@daily` |
| **DNS** | SiteGround quản nameserver `nhacuaminh.com`, có A record `zalo` → `23.142.84.68` |

> **Cheatsheet ops + secrets reference**: `D:/Zalo/ops/secrets-cheatsheet.md` (chỉ có vị trí, không có raw key).

---

## 3. Quy tắc cứng (HARD RULES)

### 3.1. KHÔNG đụng cấu trúc/quy trình của ZaloCRM
- KHÔNG refactor `backend/`, `frontend/`, `docker/`, `prisma/` trừ khi user yêu cầu rõ.
- KHÔNG đổi schema DB tùy tiện — phải tạo migration file riêng và verify trước.
- KHÔNG đổi `docker-compose.yml` / `docker-compose.override.yml` trên VPS — đã có Caddy setup hoạt động ổn định.
- Khi thêm feature mới, **mirror pattern hiện có** (vd `service-scoring.ts` là template chuẩn cho AI feature mới).

### 3.2. KHÔNG đổi nameserver `nhacuaminh.com`
- Domain này có nhiều dịch vụ khác (website, email Google Workspace, MX, DKIM, SPF) đang chạy production.
- Mọi thay đổi DNS = chỉ chỉnh **DNS record** (A, CNAME) tại SiteGround, KHÔNG bao giờ đổi NS sang Cloudflare/AWS Route53.
- Cloudflare Tunnel **đã bỏ** — không khôi phục lại.

### 3.3. AI features phải SUGGEST-ONLY (không tự áp dụng)
- AI có thể phân tích, ghi vào field `suggested_*` riêng.
- KHÔNG bao giờ ghi thẳng vào `contact.status` hoặc trường nghiệp vụ chính.
- Nhân viên phải bấm nút **Apply** hoặc **Reject** để commit.

### 3.4. KHÔNG auto-detect `converted`
- Trạng thái `converted` (đã chuyển khoản / ký HĐ) **chỉ nhân viên đặt thủ công**.
- AI phát hiện dấu hiệu converted → trả `null` + lý do "cần xác nhận thủ công".
- Lý do: liên quan tiền + hợp đồng → cần human-in-the-loop, không AI tự quyết.

### 3.5. KHÔNG modify password / disable security mà không nói
- Cảnh báo trước nếu thay đổi liên quan SSH, firewall, password.
- Verify với user trước khi tắt password auth, mở port lạ, đổi user permissions.

---

## 4. AI Lead-Status Detection (feature mới — quan trọng)

### Behavior chốt:
- **Trigger**: tự động khi có tin nhắn mới (debounce 30 giây/contact).
- **Phạm vi**: chỉ chạy khi `contactType='customer'` AND `threadType='user'` (không phải group).
- **Strict no-regression**: chỉ suggest tiến trong phễu. Lùi → bị reject. `lost` luôn được phép trừ khi đã `converted`.
- **Phễu trạng thái**: `new` (1) → `consulting` (2) → `quoting` (3) → `nurturing` (4) → `converted` (5).
- **AI KHÔNG suggest `converted`** — manual only.

### Files cốt lõi:
- Backend: [backend/src/modules/ai/lead-status-detection.ts](backend/src/modules/ai/lead-status-detection.ts), [backend/src/modules/ai/prompts/lead-status.ts](backend/src/modules/ai/prompts/lead-status.ts)
- Frontend: [frontend/src/components/contacts/SuggestedStatusBadge.vue](frontend/src/components/contacts/SuggestedStatusBadge.vue)
- DB fields: `contacts.suggested_status`, `suggested_status_reason`, `suggested_status_at`
- Routes: `POST /api/v1/contacts/:id/suggested-status/{apply|reject|detect}`

### Realtime sync:
- Backend emit socket event `contact:suggestion-updated`
- Frontend listen trong [use-chat.ts](frontend/src/composables/use-chat.ts)

---

## 5. Tech stack & conventions

| Layer | Tech |
|---|---|
| Runtime | Node.js 20 |
| Backend framework | Fastify 5 |
| ORM | Prisma 7 |
| Database | PostgreSQL 16 |
| Frontend | Vue 3 + Vuetify 3 + Vite |
| Realtime | Socket.IO |
| Container | Docker Compose |
| Reverse proxy | Caddy 2 |
| AI default | Anthropic Claude Sonnet 4.6 (`claude-sonnet-4-6`) |
| Zalo SDK | `zca-js` |

### Conventions
- **Status enum**: chỉ dùng `new`, `consulting`, `quoting`, `nurturing`, `converted`, `lost`. Không tạo status mới mà không update `STATUS_OPTIONS` ở `frontend/src/composables/use-contacts.ts` + `STAGE_ORDER` trong analytics.
- **ContactType**: `customer | internal | partner` — chỉ `customer` xuất hiện trong pipeline/funnel/reports.
- **Status change audit**: mọi thay đổi `contact.status` **PHẢI** gọi `logStatusChange()` từ `backend/src/shared/utils/status-logger.ts`.
- **Member scope**: queries trong route phải dùng `memberContactScope(user)` để filter access (member chỉ thấy contact được assign).
- **AI prompt files**: mỗi feature AI có file riêng trong `backend/src/modules/ai/prompts/` export 1 hàm `buildXxxPrompt(): string`.

### Anti-patterns
- ❌ Đổi schema mà không tạo migration SQL riêng
- ❌ Hardcode org_id, user_id trong query
- ❌ Bỏ qua `member-scope.ts` filter
- ❌ Gọi AI trong synchronous handler không có debounce/rate-limit
- ❌ Lưu raw secret vào code (dùng `.env`)
- ❌ Commit `.env` vào git (đã có .gitignore)

---

## 6. Quy trình deploy

### Cập nhật code lên VPS:
1. Code modify trên local (`D:/Zalo/ZaloCRM`)
2. Backup DB trên VPS: `docker exec zalo-crm-db pg_dump -U crmuser zalocrm > ~/backup-$(date +%F).sql`
3. Upload file modify qua paramiko exec + base64 (vì SFTP disabled). Helper: `D:/Zalo/ops/upload-via-exec.py`
4. Run migration nếu có schema change: `docker exec -i zalo-crm-db psql -U crmuser -d zalocrm < migration.sql`
5. Rebuild: `docker compose up -d --build app` (chỉ rebuild app, không động đến db/caddy)
6. Verify: `docker logs zalo-crm-app --tail 30` + test endpoint

### Local development:
- `cd ZaloCRM && docker compose -f docker-compose.dev.yml up`
- Hoặc dùng `bin/dev-setup` script

---

## 7. Đặc thù VPS hiện tại

- ⚠️ **SSH chỉ password auth** (`5Gyx6z` đã lộ, cần đổi). SFTP subsystem disabled — phải upload qua `exec + base64`.
- ⚠️ **Code KHÔNG phải git repo** trên VPS. Deploy bằng cách upload file trực tiếp (paramiko + base64) thay vì `git pull`.
- ⚠️ **Region Montana, US** (~200ms ping VN). Có thể cần migrate sang VPS Singapore sau.
- ⚠️ **VPS chưa có hardening**: chưa cài fail2ban, UFW chưa enable, password auth bật. Cần làm khi user yêu cầu.
- ⚠️ **API keys, JWT secret, DB password** đang ở `.env` trên VPS — backup ngoài VPS trước khi thao tác.

---

## 8. Style guidelines giao tiếp với user

- **Tiếng Việt** mặc định (user chính người Việt Nam).
- **Concise**: trả lời ngắn gọn, đi thẳng vào vấn đề. Không over-summary, không lặp lại task description.
- **Đưa option có số** (1, 2, 3) khi có nhiều cách làm để user dễ chọn.
- **Cảnh báo trước** nếu action phá hủy / không reverse được.
- **Acknowledge sai sót** rõ ràng khi đưa thông tin sai (đừng vòng vo).
- **Đề xuất khi user chưa rõ**: "Tôi gợi ý X vì lý do Y. Bạn muốn (A) hay (B)?".

---

## 9. Things NOT to do

| Hành động | Lý do |
|---|---|
| Đổi NS `nhacuaminh.com` | Có nhiều service khác đang dùng |
| Auto-apply AI suggestion | Phải human-in-the-loop |
| Auto-detect `converted` | Liên quan tiền/HĐ — manual only |
| Build Cloudflare Tunnel lại | Đã bỏ — dùng Caddy + A record direct |
| Đụng `docker-compose.yml` trên VPS | Đã có Caddy override hoạt động |
| Push thẳng lên VPS không backup DB | Migration sai = mất data thật |
| Commit `.env` / secrets vào git | Bảo mật |
| Test feature mới trên prod trước local | Có thể crash data thật |
| Bỏ filter `contactType='customer'` ở AI feature | Spam internal/partner contacts |

---

## 10. Tài liệu liên quan

- [README.md](README.md) — overview + quick start
- [docs/install-guide.md](docs/install-guide.md) — cài đặt từ đầu
- [docs/user-guide.md](docs/user-guide.md) — hướng dẫn sử dụng cho nhân viên
- [docs/business-context-ncm.md](docs/business-context-ncm.md) — chi tiết business model NCM/TLXN
- [plans/](plans/) — sprint plans (lịch sử, không cần đọc khi code)
- [artifacts/](artifacts/) — SOP nội bộ (HTML)

---

**Last updated**: 2026-05-01 — sau session deploy lead-status feature lên production.
