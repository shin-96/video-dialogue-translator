# SPEC — Video Dialogue Translator (bản thảo luận, CHƯA code app)
Cập nhật: 22/11/2026. Trạng thái: đã thảo luận xong các phần chính, chờ chủ repo duyệt spec này rồi mới code.

## 1. Định vị
Web học ngoại ngữ qua video: dán link hoặc tải video lên -> khung lời thoại song ngữ chạy karaoke theo giọng đọc -> lưu từ/câu kèm ngữ cảnh -> sổ tay sinh bài tập AI chấm + giải thích.

## 2. Giao diện (đã chốt)
- Hiện đại, phong cách riêng, không quá "AI" (không gradient tím-xanh, không icon sparkle tràn lan, chỉ 1 màu accent).
- Không bê nguyên Awwwards: chỉ lấy cách trình bày đẹp phù hợp cho app công cụ. Animation ít, có mục đích (báo trạng thái), không trang trí thừa.
- Nút morphing là ngôn ngữ tương tác chính: thu gọn -> bấm thì giãn ra thành ô nhập link/upload -> nhập xong thu lại -> load (spinner + % + nút hủy) ngay trên nút đó.
- Workspace: video bên trái (tối, như phòng chiếu), khung thoại bên phải kiểu kịch bản (timestamp nhỏ, gốc đậm trên, dịch dưới, câu đang phát có vạch accent). Mockup v1 (workspace) + v2 (morphing) đã được chủ repo xem trong chat 22/11.

## 3. Luồng + các trang (assistant tự chốt theo ủy quyền của chủ repo)
1. `/` Trang chủ: nút morphing dán link / tải video, video mẫu thử, quota hôm nay (nếu đã đăng nhập).
2. `/auth` Đăng ký / đăng nhập bằng email + mật khẩu (+ quên mật khẩu). Khách dán link xem metadata được, bấm Dịch phải đăng nhập.
3. Bước xác nhận trước khi dịch: hiển thị video chính tìm được, ngôn ngữ phát hiện (+ % từng ngôn ngữ nếu đa ngôn), ngôn ngữ đích user chọn, số token đếm thật + dự trù dịch, quota còn lại. User xác nhận mới tốn token.
4. `/watch/:id` Học: player + karaoke từng từ (gốc + dịch cùng chạy), click câu -> nhảy timestamp, lặp 1 câu, tua chậm, che gốc/che dịch, tìm trong lời thoại, lưu nhanh.
5. `/library` Video đã xem: thumbnail, tiến độ, xem tiếp đúng chỗ dở, số từ đã lưu/video, lọc theo ngôn ngữ/trang nguồn.
6. `/notebook` Sổ tay: thẻ từ/cụm/câu đã lưu (nghĩa, phiên âm, câu mẫu từ video + timestamp nhảy về, âm thanh câu), lọc/tìm, lịch ôn.
7. `/notebook/review` Ôn + bài tập: bộ bài leo cấp dễ -> trung bình -> khó sinh từ chính nội dung đã lưu / video vừa học.
8. `/settings` Ngôn ngữ đích mặc định, quota token theo ngày, tài khoản.

## 4. Chức năng lõi (đã chốt)
- Nhập link + tải file video cá nhân.
- Tự tìm video chính trong trang: extractor riêng YouTube/Bilibili/TikTok; web lạ chấm điểm (kích thước, thời lượng, og:video, vị trí), mập mờ -> cho user chọn thumbnail, không chọn sai lặng lẽ.
- YouTube có phụ đề: bê qua luôn (user chọn dùng bản dịch YouTube 0 token hoặc AI dịch lại), vẫn chạy alignment để có timestamp từng từ cho karaoke. Không có phụ đề: nghe (ASR) lấy văn bản + timestamp từng từ.
- Ngôn ngữ: đích do user chọn; nguồn tự nhận diện bằng cách nghe 3 đoạn (đầu/giữa/sau) bỏ phiếu; đa ngôn thì hiển thị tỉ lệ và hỏi user chọn ngôn ngữ cần dịch; phần trùng ngôn ngữ đích giữ nguyên, không dịch.
- Karaoke song ngữ theo từng từ là tính năng lõi (không phải hiệu ứng phụ).
- Lưu nhanh 1 chạm: bấm từ -> popover nghĩa/phiên âm + Lưu; chọn cụm; bookmark cả câu. Mục lưu tự kèm câu gốc + dịch + timestamp + đoạn âm thanh câu.
- Sổ tay + bài tập: AI gen bài từ nội dung đã lưu, user làm, chấm + giải thích. Bài khách quan (trắc nghiệm/điền đáp án rõ) chấm theo đáp án + AI giải thích; bài tự do (dịch ngược/viết) AI chấm theo tiêu chí và ghi rõ AI chấm. Cấp độ leo thang dễ -> khó trong cùng bộ.
- Lịch ôn theo khoảng quên (1-3-7 ngày...) trong sổ tay.

## 5. Token + API free (đã chốt hướng)
- Không ước tính theo phút. Sau khi có toàn bộ văn bản (phụ đề hoặc ASR), đếm token thật bằng tokenizer, cộng dự trù bản dịch +10-30%, so quota ngày của tài khoản.
- Đủ -> user xác nhận -> dịch toàn bộ (tự cắt khúc theo câu/chương nếu vượt cửa sổ model). Không đủ -> dịch theo câu tới mức quota cho phép, phần còn lại để sau, không từ chối cả video, không chết giữa chừng.
- API: dùng free tier (OpenRouter / 9router...) với chuỗi dự phòng nhiều model free; hết free thì báo rõ. Không farm nhiều tài khoản lấy key (vi phạm điều khoản, dễ khóa). Key chính do chủ repo cung cấp khi bắt đầu code; về sau cân nhắc BYOK.

## 6. Tài khoản + dữ liệu
- Đăng ký/đăng nhập email + mật khẩu. Lịch sử xem, tiến độ, sổ tay, quota lưu theo tài khoản (Supabase dự kiến).
- Video cá nhân tải lên: chỉ chủ tài khoản xem được; thời hạn lưu file gốc sẽ chốt khi code (đề xuất: chỉ giữ phụ đề/kết quả, file gốc xóa sau xử lý trừ khi user chọn lưu).

## 7. Công nghệ (assistant chọn theo ủy quyền)
Next.js + Tailwind + Framer Motion (giao diện/animation) + Python worker (tải video, ASR, alignment, xử lý) + Supabase (auth/db/storage). Lý do: giao diện mượt nhất + Python mạnh nhất cho video/AI; bản fullstack-only bị loại vì nghẽn video dài.

## 8. MVP bản đầu (assistant tự chốt) vs Giai đoạn 2
MVP: đăng ký/đăng nhập; dán link YouTube + tải file; bê phụ đề YouTube / ASR khi không có; nhận diện ngôn ngữ + xác nhận; đếm token + quota ngày; dịch AI free có fallback; karaoke từng từ; click câu nhảy, lặp câu, tua chậm, che dịch; lưu nhanh kèm ngữ cảnh; thư viện video đã xem + xem tiếp; sổ tay + lịch ôn cơ bản; bài tập dễ->khó AI gen/chấm/giải thích.
Giai đoạn 2: Bilibili/TikTok/web lạ hoàn thiện sâu, shadowing thu âm, xuất Anki/SRT/PDF, học theo playlist, đăng nhập Google, BYOK.

## 9. Việc còn treo (không phải phần thảo luận, là việc lúc bắt đầu code)
- Chủ repo lấy/cung cấp API key free (OpenRouter...) khi bắt đầu code, nếu assistant không tự tạo được tài khoản hợp lệ.
- Chọn nơi host + chi phí khi deploy thật.
