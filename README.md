# Cờ vua 3D

Cờ vua 3D chạy trên trình duyệt (điện thoại và máy tính), không cần cài đặt. Chơi hai người một máy, chơi với máy (Dễ/Vừa/Khó) hoặc chơi online với bạn ở xa bằng mã phòng.

## Chạy thử và triển khai
```
npm install
npm test            # 79 bài kiểm tra: luật cờ, máy đánh, phòng online, hình học, khay quân
npm run build       # gộp và làm rối mã vào dist/
npm run dev         # chạy thử tại máy (wrangler dev)
npm run deploy      # đưa lên Cloudflare
```
Đặt mật khẩu vào Cloudflare: `npx wrangler secret put SITE_PASSWORD`. Nên để repo GitHub ở chế độ private.

## Cấu trúc
- `public/shared/chess.js`: luật cờ vua đầy đủ (nhập thành, bắt tốt qua đường, phong cấp, chiếu hết, pat, thiếu quân, lặp thế 3 lần, 50 nước).
- `public/shared/engine.js`: máy đánh (alpha-beta, bảng băm, tìm kiếm tĩnh, 3 cấp độ).
- `public/client/`: giao diện (`board3d.js` dùng Three.js và quân GLB, `board2d.js` là phương án 2D, `main.js` là vòng chơi).
- `public/models/*.glb`: sáu loại quân. Mã nạp quân theo tên vật liệu `body` (đổi màu theo bên).
- `worker/`: Cloudflare Worker và Durable Object `Room` cho chơi online.
- `tests/`: các bài kiểm tra (`npm test`).
