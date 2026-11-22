# Video Dialogue Translator

Web học ngoại ngữ qua video: dán đường link video hoặc tải video lên -> tự tạo khung lời thoại kèm bản dịch, chạy karaoke song ngữ theo từng từ.

## Trạng thái
MVP đã build xong + qua 2 vòng QA (dựng -> test thật -> sửa -> test lại) ngày 22/11/2026. Chi tiết: `SPEC.md` (bản chốt thảo luận) và `BUILD-REPORT.md` (kết quả test + giới hạn thành thật).

## Chạy web
```bash
npm install
npm run build
npm run start        # http://localhost:3000
```
Không cần biến môi trường. Tùy chọn: `OPENROUTER_API_KEY` để thêm 1 nhà cung cấp dịch trước các API free (MyMemory -> LibreTranslate).

## Chức năng chính
- Nhập link (YouTube tự lấy phụ đề; trang web lạ tự tìm video chính, mập mờ thì cho chọn) hoặc tải file video lên; có video mẫu chạy trọn luồng.
- Tự nhận diện ngôn ngữ trong video (đa ngôn ngữ hiện % để người dùng xác nhận), người dùng chọn ngôn ngữ dịch sang.
- Đếm token thật của toàn bộ lời thoại + hạn mức 50.000 token/ngày theo tài khoản; không đủ thì dịch phần vừa hạn mức.
- Karaoke song ngữ từng từ (gốc + dịch cùng chạy), bấm câu nhảy đúng thời điểm, lặp câu, tua chậm, ẩn gốc/dịch, tìm trong lời thoại.
- Lưu nhanh từ/câu kèm ngữ cảnh (câu gốc + dịch + timestamp); Sổ tay + nhắc ôn 1-3-7-14-30 ngày; bài tập dễ->khó sinh từ nội dung đã lưu, chấm + giải thích.
- Thư viện video đã xem: tiến độ, xem tiếp, số mục đã lưu. Đăng ký/đăng nhập lưu mọi dữ liệu theo tài khoản.

> Repo tạo 22/11/2026, tên cũ `new-project-discussion` — đã đổi tên cho đúng chức năng.
