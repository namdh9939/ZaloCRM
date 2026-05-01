# ZaloCRM

> Hệ thống CRM quản lý nhiều tài khoản Zalo cá nhân, dùng nội bộ cho công ty **Nhà Của Mình (NCM)** — dịch vụ **Trợ Lý Xây Nhà (TLXN)**.

**🌐 Production**: https://zalo.nhacuaminh.com

---

## 🤖 Cho AI agent (Claude Code, Cursor, ChatGPT…)

**ĐỌC TRƯỚC TIÊN: [AGENTS.md](AGENTS.md)** — quy tắc cứng + bối cảnh + anti-patterns.

Tóm tắt rule quan trọng:
- KHÔNG đụng cấu trúc `backend/` `frontend/` trừ khi user yêu cầu rõ
- KHÔNG đổi nameserver `nhacuaminh.com`
- AI feature phải **suggest-only**, không auto-apply vào trường nghiệp vụ
- KHÔNG auto-detect status `converted` (manual only)
- Cảnh báo trước khi làm action không reverse được

---

## 🏗️ Tech stack

| Layer | Tech |
|---|---|
| Runtime | Node.js 20 |
| Backend | Fastify 5 + Prisma 7 |
| Database | PostgreSQL 16 |
| Frontend | Vue 3 + Vuetify 3 + Vite |
| Realtime | Socket.IO |
| AI | Anthropic Claude / Gemini / OpenAI / Qwen / Kimi |
| Zalo SDK | zca-js 2.x |
| Container | Docker Compose |
| Reverse proxy | Caddy 2 (auto SSL Let's Encrypt) |
| Mobile | PWA (Service Worker + Manifest) |

---

## 📂 Cấu trúc thư mục

```
ZaloCRM/
├── AGENTS.md                ← rules cho AI agent (đọc trước)
├── README.md                ← bạn đang đọc
├── docs/                    ← tài liệu cho human
│   ├── install-guide.md     ← cài đặt từ đầu lên VPS
│   ├── user-guide.md        ← hướng dẫn nhân viên dùng app
│   └── business-context-ncm.md  ← business model NCM/TLXN
├── backend/                 ← Fastify API + Prisma
│   ├── src/modules/         ← chia theo domain (ai/, chat/, contacts/...)
│   ├── prisma/              ← schema + migrations
│   └── ...
├── frontend/                ← Vue 3 SPA
│   ├── src/components/
│   ├── src/composables/
│   ├── src/views/
│   └── ...
├── docker/                  ← Dockerfile
├── docker-compose.yml       ← prod stack (app + db + backup)
├── docker-compose.dev.yml   ← dev stack
├── plans/                   ← sprint plans (lịch sử)
├── artifacts/               ← SOP nội bộ
└── bin/                     ← dev-setup, dev-teardown scripts
```

---

## 🚀 Quick start (local dev)

```bash
git clone https://github.com/namdh9939/ZaloCRM.git
cd ZaloCRM
cp .env.example .env
# Sửa .env — đặt JWT_SECRET, ENCRYPTION_KEY, DB_PASSWORD, AI tokens
docker compose -f docker-compose.dev.yml up
```

Truy cập http://localhost:3080 → tạo tài khoản admin đầu tiên.

> Cài đặt production trên VPS: xem [docs/install-guide.md](docs/install-guide.md).

---

## ✨ Tính năng chính

### CRM core
- Quản lý nhiều tài khoản Zalo (QR login, auto reconnect, session persist)
- Chat real-time với khách (tin nhắn, ảnh, file, sticker, group)
- Pipeline 6 bước: `new → consulting → quoting → nurturing → converted` (+ `lost`)
- Lịch hẹn + nhắc nhở tự động
- Phân quyền 3 cấp: owner / admin / member

### AI Assistant
- **Lead-status detection** ⭐ — AI đề xuất chuyển trạng thái khách dựa trên hội thoại (suggest-only, debounce 30s)
- **Service quality scoring** — chấm điểm thái độ phục vụ của nhân viên
- **Reply suggestions** — gợi ý nội dung trả lời
- **Conversation summary + sentiment**

### Vận hành
- Webhook + Public API (key auth)
- Backup tự động hàng ngày (Postgres)
- Push notifications (Web Push, VAPID)
- Dashboard + báo cáo (theo tuần/tháng)

---

## 🔧 Deploy lên production

Hiện đang chạy trên VPS `cyber-box-986` (1 vCPU / 2GB RAM) với stack:
- Docker Compose + Caddy reverse proxy + Postgres 16
- DNS A record `zalo.nhacuaminh.com` → IP VPS

Quy trình update code → xem [AGENTS.md § 6](AGENTS.md#6-quy-trình-deploy).

Helper scripts SSH/upload đặt ở `D:/Zalo/ops/` (paramiko-based vì VPS disable SFTP).

---

## 📚 Tài liệu

| Mục đích | File |
|---|---|
| **Rules cho AI agent** | [AGENTS.md](AGENTS.md) |
| **Cài đặt từ đầu** | [docs/install-guide.md](docs/install-guide.md) |
| **Hướng dẫn nhân viên** | [docs/user-guide.md](docs/user-guide.md) |
| **Business context NCM** | [docs/business-context-ncm.md](docs/business-context-ncm.md) |

---

## 📜 Phiên bản

| Version | Ngày | Highlights |
|---|---|---|
| **v2.2** | 2026-05-01 | AI lead-status detection (suggest-only), service quality scoring, push notifications |
| v2.1 | 2026-04-16 | Tab "Khác", tên KH 2 lớp, bộ lọc, template nhanh |
| v2.0 | 2026-03-31 | AI Assistant, Workflow Automation, PWA, Multi-Provider AI |
| v1.0 | 2026-03-29 | MVP — Zalo, chat, CRM, lịch hẹn, dashboard, API, webhook |

---

## 📄 Giấy phép

Internal use — Nhà Của Mình (NCM). Code được fork và customize từ [vuongnguyenbinh/ZaloCRM](https://github.com/vuongnguyenbinh/ZaloCRM).
