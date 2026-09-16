# Chạy một sóng worker song song

Cách điều phối nhiều agent cùng sửa repo này. Viết sau sóng 3 (2026-09-16), khi
bốn worker `agy` chạy song song đóng tám issue roundtrip.

Đây là tri thức QUY TRÌNH, dùng lại cho mọi sóng sau. Phần trạng thái ở cuối là
ảnh chụp một thời điểm; git log và issue tracker mới là nguồn đúng.

## Công thức phóng worker agy, ĐÃ CHỨNG MINH ở sóng 3

`agy` KHÔNG phải agent orca biết (`worker-start --agent agy` trả
`agent_unconfigured`). Bắt buộc theo lối terminal-first:

```
1. thêm ĐÚNG đường dẫn worktree vào trustedWorkspaces của agy
   ~/.gemini/antigravity-cli/settings.json, khớp chính xác, không phải prefix

2. orca terminal create --worktree path:<worktree> --command "agy" --json

3. đợi tới khi terminal read thấy "Antigravity CLI", rồi gửi một prompt vô hại
   để xác nhận tài khoản chạy được turn. Thanh trạng thái ghi "AI: Out of
   credits" nhưng model VẪN trả lời. Đừng tin thanh đó, tin phép thử.

4. orca orchestration worker-start --run <run_id> --spec "<đoạn ngắn trỏ file spec>" \
     --terminal <handle> --worktree path:<worktree> --json

5. terminal read lại: PHẢI thấy preamble + === TASK === + worker tự gọi
   orca orchestration check. Không thấy thì dừng, đừng đi tiếp.

6. bằng chứng cuối cùng là HEARTBEAT về tới hộp thư. Đủ số heartbeat bằng số
   worker thì token dispatch đã tới nơi cả lượt.
```

Cú pháp hay nhầm: `orca terminal send --terminal <h> --text "..." --enter
--wait-submit 20 --json`. Cờ là `--enter`, không phải `--submit`, và
`--wait-submit` cần một số GIÂY (tối đa 3600).

## Bẫy đã dính, kèm cách chữa

**agy nén hội thoại quanh 1.5M token rồi CHẾT LẶNG.** Sau khi nén, agent mất
nghĩa vụ dispatch trong preamble, tưởng xong việc, về prompt im lặng mà không
gửi `worker_done`. Xảy ra với 2 trên 4 worker sóng 3.

- Dấu hiệu: `worker-list` cho `activity='done'` nhưng `outcome='in_progress'`.
  ĐỪNG chỉ ngồi chờ `worker_done`, phải chủ động rà cặp này.
- `orca orchestration send` KHÔNG đánh thức được worker đang nhàn rỗi. Guide đã
  nói trước: "best-effort attention only". Hộp thư chỉ tới được worker ĐANG chạy.
- Cách chữa chắc chắn: `orca terminal send` gõ thẳng vào TUI.
- Khi đánh thức PHẢI TÁI NEO bối cảnh: worker nào, worktree nào, nhánh nào, spec
  ở đâu, đã làm tới đâu, còn thiếu gì. Bảo suông "làm tiếp" là vô nghĩa với một
  agent vừa mất trí nhớ.
- Phòng ngừa: bắt worker COMMIT SỚM ngay trong spec. Một worker đã treo 184 dòng
  chưa commit lúc đứng im.

**Bash của điều phối viên chết cứng ở 600000ms.** Đừng đặt `--timeout-ms 900000`.
Dùng <= 540000, hoặc chạy nền.

**`orca orchestration check` in HAI tài liệu JSON liền nhau** khi vừa ack vừa
wait, và còn chen các dòng `{"_keepalive":true,...}`. `json.load` sẽ nổ. Dùng
`JSONDecoder.raw_decode` trong vòng lặp và bỏ qua doc có `_keepalive`.

**Terminal do điều phối viên tự tạo** thì `worker-release` không tự đóng. Phải
tự `orca terminal close`.

**`verify:vscode-floor` NHẠY VỚI TẢI MÁY.** Check `document still unmodified
after the hold` đã fail giả một lần khi 4 worker đang nghiến CPU, và tôi đã trót
công bố sai cho cả 4 worker. Đo baseline lúc máy rảnh, và chạy lại trước khi tin
một kết quả đỏ.

**`harness/corpus.ts` quét mọi `*.md` ở GỐC repo làm corpus.** Cấm worker tạo
tài liệu tạm ở đó. `docs/` an toàn.

**Bước kiểm vòng hai ghi đè 22 fixture, bước khôi phục rất dễ quên.** Đã xảy ra
thật ở sóng 3. Nếu lọt vào commit thì input thô bị thay bằng output, roundtrip
VẪN BÁO XANH, và mất im lặng. Chốt chặn bắt buộc trước mỗi merge:

```
git diff develop..<nhánh> --stat -- harness/fixtures/synthetic/
```

Chỉ được có fixture MỚI. Fixture CŨ bị sửa thì chặn lại, bắt worker tự khôi
phục, đừng sửa hộ.

## Kỷ luật đã chứng minh là đáng giá

**Đừng tin báo cáo của worker.** Fixture VÀ golden đều do worker tự viết, nên
roundtrip xanh là lập luận vòng tròn. Phải tự dựng ca tái hiện lấy THẲNG TỪ THÂN
ISSUE rồi chạy độc lập. Sóng 3 làm 14 ca như vậy.

**Issue của repo này có thể sai, tỉ lệ cao.** Sóng 3 bắt được `#99` có tiêu chí
tự mâu thuẫn (đòi sửa bug nhưng cấm golden đang chụp bug đó thay đổi), `#96` sai
nguyên nhân gốc, `#95` sót một nguyên nhân thứ hai. Cộng với `#93` và `#94` của
sóng 2 là 5 trên 13 ticket. Đọc issue xong VẪN phải tự kiểm bằng code.

**Đo trước khi chia việc.** Sóng 3 gộp `#97 #99 #100 #101` về một worker vì đo
được cả bốn dồn vào `MarkdownManager.escapeMarkdownSyntax`, và `#99` với `#101`
đòi hai điều ngược nhau từ CÙNG một quy tắc cho ký tự `[`. Đưa sẵn cơ chế vào
spec nên worker không mất vòng nào để mò. Đây là thứ tiết kiệm nhiều nhất.

## LỖI CỦA ĐIỀU PHỐI VIÊN SÓNG 3, đừng lặp lại

Spec riêng của worker #102 (đã xoá cùng thư mục spec sóng 3) vừa cho worker
ngoại lệ được chạm
`list-continuation-underindented.md`, vừa ra ràng buộc "với mặc định 2 dấu cách
KHÔNG golden nào hiện có được đổi". Hai câu chọi nhau. Worker chọn cách an toàn
nên không chữa, và fixture đó vẫn đỏ tới giờ.

Bài học: khi nêu một ngoại lệ, phải nói luôn nó THẮNG ràng buộc nào.

## Ràng buộc bắt buộc đưa vào spec mọi worker

1. Cấm sửa `CHANGELOG.md` và `AGENTS.md`. Nhiều nhánh song song sẽ chọi nhau.
   Bắt worker viết sẵn câu chữ vào báo cáo, điều phối viên tự áp dụng sau merge.
2. Cấm tạo file `.md` mới ở gốc worktree.
3. Cấm mở issue upstream. Thay bằng báo cáo trong `docs/upstream/<pkg>-<số>.md`,
   theo tiền lệ `3372ad2`.
4. Cấm thêm seam mới vào harness. Nhiều nhánh cùng thêm seam là chắc chắn đụng.
   Fixture mới thì được.
5. Nêu rõ ranh giới SỞ HỮU theo HÀM, không theo file. Mọi worker đều sẽ sửa
   `src/webview/main.ts` và `harness/editor.ts`, đụng file là không tránh được.
6. Nhắc `harness/editor.ts` là bản gương của `initEditor()`, sửa một bên phải
   sửa bên kia cùng lúc.
7. Bắt commit sớm, cấm `git add -A`.
8. Ghi rõ số fixture failed ở vòng hai hiện tại (nay là 1, do #109) để worker
   không tưởng mình làm hỏng.

## Quy trình merge cho sóng SONG SONG

Kiểm trên nhánh là kiểm với nền đã cũ, nên phải:

```
1. trong worktree của nhánh:  git merge develop
2. GIẢI XUNG ĐỘT TẠI ĐÂY, điều phối viên tự làm, không đẩy cho worker
   Xung đột ở main.ts và harness/editor.ts là CHẮC CHẮN từ lần merge thứ 2.
   Sóng 3 cả hai lần đều chỉ là khối import, giải bằng hợp cả hai ý.
3. chạy 4 lệnh + vòng hai TRÊN NHÁNH đã merge
4. fast-forward develop
5. chạy lại 4 lệnh + vòng hai TRÊN DEVELOP
6. gh issue close <n> --comment kèm bằng chứng CỦA MÌNH, không phải của worker
```

Sau khi điều phối viên sửa `CHANGELOG.md` hoặc `AGENTS.md`, hai golden
`harness/golden/repo/` tương ứng sẽ ĐỎ. Chạy `npm run roundtrip:update`, rồi
kiểm là CHỈ hai file đó đổi. Tiền lệ `ad2b67b`.

## Còn treo sau sóng 3

Mục này gắn với một thời điểm, không phải quy trình. Kiểm lại trước khi tin.

- `#102` còn một bước kiểm TAY chưa thực thi: đổi `editor.tabSize` trong VS Code
  rồi xem lần sửa sau có ghi ra thụt lề mới không. Quy trình ở
  `docs/reports/w4-indent.md` mục 7. Cần làm trước khi phát hành.
- `#96` còn hai tiêu chí hành vi editor chưa kiểm được bằng harness: sửa chữ
  cạnh cặp thẻ inline không làm vỡ cặp, và xoá một chip chỉ xoá đúng thẻ đó.
- `harness/editor.ts` và webview thật KHÔNG khớp ở một ca:
  `harness/vscode-floor/sample.md` không phải điểm bất động vòng một dưới
  `roundtripMarkdown`, nhưng webview không đẩy edit nên floor check vẫn xanh.
  Chưa truy tiếp, chưa có issue. Đáng theo dõi vì harness tự nhận là bản gương.
- Hai run orchestration cũ còn trong Orca: `run_c607755eea03` (sóng 2, có worker
  failed/abandoned) và `run_81e972296c40` (sóng 3, cả 4 succeeded, đã release,
  hộp thư rỗng). CỐ Ý KHÔNG chạy `orca orchestration reset` vì lệnh đó không có
  cờ `--run`, nó xoá state TOÀN CỤC và sẽ đụng các dự án khác của người dùng
  (sekisan3, kiotviet-lite...). Sóng 4 chỉ cần `run-create` một run mới, hai run
  cũ không gây hại: không còn worker nào chờ, không còn tin nào chưa đọc.

## Skill nên gọi

- `orchestration` BẮT BUỘC trước mọi lệnh Orca. Nó là stub, phải chạy tiếp
  `orca skills get orchestration`. Thêm `--reference references/coordinator-loop.md`
  khi tái dùng terminal hoặc chọn model, `references/placement-and-remote.md` khi
  tạo worktree mới, `references/recovery-and-cleanup.md` khi dispatch hỏng.
- `ask-matt` là quy trình người dùng yêu cầu từ đầu.
- `code-review` sau mỗi lần merge, cần một SHA mốc cố định.
- `resolving-merge-conflicts` khi nhiều nhánh cùng chạm `main.ts`.
- `tdd` nếu đụng `#89`.

Không dùng công cụ Agent hay workflow trừ khi người dùng, CLAUDE.md, hoặc một
skill yêu cầu.

## Ảnh chụp trạng thái cuối sóng 3, 2026-09-16

Giữ lại làm ví dụ về mức độ chi tiết một bàn giao nên có. Số liệu bên dưới ĐÃ CŨ
ngay khi có commit tiếp theo; kiểm lại bằng git và `gh issue list`.

```
develop            4a0a988, đã push
lint, build        xanh
roundtrip          43 passed, 0 failed
vòng hai           42 passed, 1 failed  <- chính là #109
verify:vscode-floor 15/15
issue mở           14, trong đó #83 #84 #85 là issue mẹ
```

Sóng 3 đóng `#92 #95 #96 #97 #99 #100 #101 #102` và tách ra `#109`.
