# Bản giao việc chung cho worker trong một sóng song song

Đây là bản `COMMON.md` mà sóng 7 đặt vào từng worktree dưới `.wave7-spec/`, đã bỏ
phần riêng của sóng đó và giữ lại phần dùng lại được. `docs/agents/parallel-waves.md`
kể VÌ SAO từng ràng buộc tồn tại; file này là thứ đem copy vào worktree.

Cách dùng: điền ba chỗ `<...>`, ghi ra `<worktree>/.wave-spec/COMMON.md` cho MỖI
worktree, kèm một `TASK.md` riêng cho từng worker. Đặt dưới thư mục đã cho vào
`.git/info/exclude` để nó không bao giờ lọt vào một commit.

---

# Sóng <n>: ràng buộc chung cho mọi worker

Đọc hết file này trước khi gõ dòng code đầu tiên. Nếu hội thoại của bạn bị nén và
bạn mất trí nhớ giữa chừng, hãy quay lại đọc lại file này TRƯỚC khi làm tiếp.

## Nền

Nhánh của bạn tách từ `develop` tại `<sha>`. Đo trên đúng commit đó, lúc máy rảnh:

```
npm run lint                 sạch
npm run build                sạch
npm test                     <n> passed, 0 failed
npm run roundtrip            <n> fixtures + <n> seams: <n> passed, 0 failed
vòng hai                     <n> passed, 0 failed
npm run verify:vscode-floor  <n> checks: <n> passed, 0 failed
```

Đây là mốc. Nếu bạn thấy con số khác trước khi sửa gì, dừng lại và `ask`, đừng đoán.

Vòng hai chạy như sau, và **bước khôi phục là bắt buộc**:

```
cp harness/golden/synthetic/*.md harness/fixtures/synthetic/ && npm run roundtrip
git checkout -- harness/fixtures/synthetic/
git status --short harness/          # PHẢI rỗng
```

## Lưới đã dựng sẵn cho bạn

Điều phối viên đã commit sẵn các file seam RỖNG và ĐÃ ĐĂNG KÝ chúng trong
`harness/roundtrip.ts` trước khi cắt worktree. Mỗi worker sở hữu đúng seam của mình:

| seam | chủ |
| --- | --- |
| `<đường dẫn seam>` | `<worker>` |

`esbuild.harness.config.js` tự quét `test/*.test.ts`, nên thêm unit test KHÔNG cần
sửa file cấu hình đó.

## Ràng buộc BẮT BUỘC

1. **Cấm sửa MỌI file `.md` ở GỐC repo.** `README.md`, `CHANGELOG.md`, `AGENTS.md`,
   `CONTEXT.md`, `CLAUDE.md` đều nằm trong lệnh cấm. Lý do kép: nhiều nhánh song song
   sẽ chọi nhau, VÀ `harness/corpus.ts` quét mọi `*.md` ở gốc làm corpus nên mỗi lần
   sửa là một golden đổi. **Ràng buộc này THẮNG mọi tiêu chí trong thân issue đòi bạn
   cập nhật tài liệu.** Thay vào đó hãy viết sẵn CÂU CHỮ bạn muốn thêm vào báo cáo,
   điều phối viên sẽ tự áp dụng sau khi merge.
2. **Cấm tạo file `.md` mới ở gốc worktree.** `docs/` thì an toàn.
3. **Cấm mở issue upstream.** Thay bằng một báo cáo trong `docs/upstream/<pkg>-<số>.md`.
4. **Cấm thêm seam mới và cấm sửa `harness/roundtrip.ts`.** Seam của bạn đã đăng ký
   sẵn. Fixture MỚI dưới `harness/fixtures/synthetic/` thì được phép.
5. **Cấm sửa fixture CŨ.** Chỉ được thêm fixture mới. Trước khi báo xong việc, tự chạy
   chốt chặn này TRONG worktree của bạn và dán output vào báo cáo:
   ```
   MB=$(git merge-base develop HEAD)
   git diff $MB..HEAD --stat -- harness/fixtures/synthetic/
   ```
   Phải so với merge-base, KHÔNG so `develop..HEAD`: `develop` sẽ tiến lên trong lúc
   bạn làm việc, và so hai đỉnh sẽ báo bạn đã xoá những file bạn chưa bao giờ chạm.
6. **`harness/editor.ts` là bản gương của `initEditor()` trong `src/webview/main.ts`.**
   Sửa một bên mà không sửa bên kia thì harness đo một thứ không hề được ship. Chỉ
   **một** worker trong sóng được chạm file đó, và đó là `<worker>`.
7. **Commit sớm, cấm `git add -A`.** Liệt kê từng đường dẫn. Một worker của sóng trước
   đã treo 184 dòng chưa commit đúng lúc nó đứng im và mất trắng.
8. **`npm run verify:vscode-floor` chạy song song được, nhưng nó mở một CỬA SỔ VS CODE
   THẬT trên màn hình người dùng, khoảng 90 giây mỗi lượt.** Chỉ chạy MỘT lần, ở gần
   cuối, khi bạn đã tin là xong. Đừng chạy nó sau mỗi lần build.
9. **Cấm thêm check vào `harness/vscode-floor/extension-tests.ts` và cấm sửa
   `harness/vscode-floor/run.mjs`.** Bạn được CHẠY floor check, không được THÊM check.
   Điều phối viên thêm sau khi merge, và đó là món nợ điều phối viên phải tự trả:
   sóng 7 suýt phát hành một lỗi làm editor không mount vì phần này bị để lại sau.
10. **Mọi fixture, unit test hay seam mới phải chứng minh được là có răng.** "Xanh"
    không phải bằng chứng. Phá thứ nó phủ, rồi dán output CẢ HAI lần, và báo **BAO NHIÊU
    ca đỏ**. Con số 0 nghĩa là phép kiểm của bạn không đo gì cả. Đã có tiền lệ thật ở
    repo này: một worker giao hai ca test mà khẳng định cốt lõi là một biến do chính
    test đặt bên trong một `if` do chính test viết; phá bất kỳ hàm nào chúng vẫn xanh.
    Và khi phá, hãy phá ĐÚNG file mang cơ chế: điều phối viên sóng 7 đã hai lần đo ra
    số 0 chỉ vì revert nhầm file, một lần làm seam ngừng biên dịch nên golden không
    bao giờ được ghi.
11. **Gửi `ask` xong thì làm tiếp phần khác. ĐỪNG gửi `worker_done` trước khi nhận được
    trả lời cho câu đã hỏi.** Một worker sóng trước đã hỏi đúng chỗ issue sai, rồi tự
    chọn phương án và kết thúc trước khi điều phối viên đọc kịp; câu trả lời không tới
    nơi được nữa và phương án nó tự chọn là phương án sai.
12. **Thân issue của repo này sai khá thường xuyên: 10 trên 28 ticket tính tới sóng 6.**
    Mỗi khi thân issue trỏ vào một cơ chế cụ thể (một hàm, một dòng, một "chỗ" nào đó),
    hãy TỰ MỞ FILE RA XEM cơ chế đó có thật không trước khi làm theo. Thấy sai thì `ask`.
    Issue của bạn đã được điều phối viên đo lại và sửa trước khi giao, nhưng đừng coi
    đó là bảo đảm.

## Luật viết báo cáo

Báo cáo của bạn nằm ở `docs/reports/w<n>-<tên-nhánh>.md`. Luật này là luật cứng, vì đã
có tiền lệ một worker viết báo cáo bịa trong khi mã thì đúng:

- Mọi khối mã phải được SINH RA bằng `sed -n` hoặc `grep` rồi dán y nguyên. Cấm gõ tay
  lại từ trí nhớ.
- Mọi danh sách tên (message, hàm, file) phải sinh bằng `grep`, kèm luôn lệnh đã chạy.
- Mọi phép thử phải kèm LỆNH và OUTPUT THẬT. Phép thử nào bạn không chạy được thì viết
  thẳng là "chưa kiểm được", đừng mô tả nó ở thì quá khứ.
- Ghi rõ tiêu chí nào trong issue bạn CHƯA kiểm được và vì sao. Đóng issue mà im lặng
  về chúng là tạo một khoản nợ vô hình.

## Trước khi gửi `worker_done`

```
npm run lint
npm run build
npm test
npm run roundtrip
vòng hai + bước khôi phục
npm run verify:vscode-floor        (một lần)
MB=$(git merge-base develop HEAD); git diff $MB..HEAD --stat -- harness/fixtures/synthetic/
git status --short                 (phải sạch, mọi thứ đã commit)
```

Dán output của tất cả vào báo cáo. Rồi `orca orchestration check` một lần cuối để đọc
hộp thư, RỒI mới `worker_done` với `--outcome succeeded` hoặc `--outcome failed`.
