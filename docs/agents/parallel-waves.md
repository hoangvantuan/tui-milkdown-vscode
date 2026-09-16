# Chạy một sóng worker song song

Cách điều phối nhiều agent cùng sửa repo này. Viết sau sóng 3 (2026-09-16), khi
bốn worker `agy` chạy song song đóng tám issue roundtrip.

Đây là tri thức QUY TRÌNH, dùng lại cho mọi sóng sau. Phần trạng thái ở cuối là
ảnh chụp một thời điểm; git log và issue tracker mới là nguồn đúng.

## Công thức phóng worker agy, ĐÃ CHỨNG MINH ở sóng 3

`agy` KHÔNG phải agent orca biết (`worker-start --agent agy` trả
`agent_unconfigured`). Bắt buộc theo lối terminal-first.

Dựng sẵn worktree trước, sóng 4 làm thế này và chạy trơn:

```
orca worktree create --repo id:<repo_id> --name <tên> --base-branch develop   --no-parent --setup skip --json
  -> ~/orca/workspaces/<repo>/<tên>, nhánh <gituser>/<tên>

repo này KHÔNG có setup hook, nên node_modules phải tự lo.
cp -Rc node_modules <worktree>/node_modules   # APFS clone, tức thì; đừng npm ci
```

Spec đặt ở `<worktree>/.wave4-spec/` rồi thêm `.wave4-spec/` vào
`.git/info/exclude` của repo GỐC (worktree liên kết dùng chung file đó). Worker
đọc được vì spec nằm trong workspace của nó, và không bao giờ lọt vào commit.
Đặt spec ngoài repo cũng chạy nhưng mất lợi thế đó.

Rồi mới tới phần terminal:

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
- Sóng 4 còn thấy điều tệ hơn: worker ĐANG CHẠY cũng không đọc hộp thư kịp. Một
  chỉ thị khẩn gửi qua `orchestration send` nằm im hơn 15 phút với cả bốn worker,
  TUI chỉ hiện dòng "You have 1 orchestration message" mà agent không tự chạy
  `check`. Trong 15 phút đó thêm một worker nữa khởi động đúng cái lệnh bị cấm.
  Việc gì đổi luật giữa chừng thì gửi bằng `orca terminal send`, nó tới nơi ngay.
- Và phải VÁ LUÔN FILE SPEC trong worktree, không chỉ gửi tin. Worker bị nén hội
  thoại sẽ đọc lại spec; nếu spec còn luật cũ thì nó quay về làm đúng cái vừa bị
  cấm. Sóng 4 chèn một mục "SỬA ĐỔI GIỮA SÓNG" ngay dưới tiêu đề H1 của cả hai
  file spec, nói rõ nó thắng mọi câu khác trong file.
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

**`verify:vscode-floor` từng KHÔNG chạy được hai lượt cùng lúc. ĐÃ SỬA ở sóng 5,
`#110`.** Giữ lại mục này vì cách truy nguyên nhân mới là thứ đáng dùng lại.

Sóng 3 quy cho tải CPU. Sai. Sóng 4 truy ra cơ chế thật: `harness/vscode-floor/run.mjs`
lấy `ws`, `ud` và `ext` từ MỘT thư mục cố định dùng chung, `/tmp/tuimd-floor`,
không pid, không `mkdtemp`, không khoá. Hai lượt song song ghi đè `ws/sample.md`
của nhau và dùng chung user-data-dir, tức chung cả IPC socket lẫn cơ chế
một-thực-thể của VS Code. Đúng cửa sổ 25 giây mà check `document still unmodified
after the hold` đang đo. Sóng 5 đọc lại code còn thấy một điều thân issue chưa
ghi: lượt thứ hai `rmSync` nguyên thư mục nền ngay lúc khởi động, tức là XOÁ
SỐNG cây thư mục của lượt đang chạy.

Bài học dùng lại được: một check "nhạy với tải máy" hầu như luôn là một tài
nguyên dùng chung bị giấu. Trước khi quy cho tải, hãy đi tìm thư mục cố định,
cổng cố định, cache dùng chung, khoá toàn cục. Sóng 5 tìm thêm được một cái thứ
hai trong cùng file mà issue không nêu: cache tải VS Code ở
`~/.cache/tui-markdown-vscode-floor/` cũng bị hai lượt lạnh cache giẫm lên nhau.

Nay mỗi lượt có `mkdtemp` riêng và mọi lần ghi vào cache đều staging rồi rename,
nên **worker được phép chạy lệnh đó**. Bằng chứng: hai lượt phóng cùng lúc, cả
hai 15/15, hai base khác nhau.

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

**Nhưng một fixture MỚI cũng có thể là fixture rỗng ruột.** Chốt chặn trên chỉ
bắt được fixture CŨ bị sửa. Sóng 4: `#106` đòi fixture chứa `<u>x</u>` và `++x++`
để golden chứng minh phép chuyển sang `<ins>`. Fixture mà worker giao đã chứa
`<ins>` ở mọi dòng, kể cả hai dòng tự nhận là ca `<u>` và ca `++x++`. Đầu vào thô
đã bị thay bằng đầu ra. Roundtrip xanh, chốt chặn qua, mà hai trong năm ca không
ghim gì cả.

Phép thử duy nhất đáng tin, bắt buộc với mọi fixture mới ghim một extension:

```
gỡ extension khỏi harness/editor.ts  ->  fixture PHẢI ĐỎ
trả lại                              ->  fixture PHẢI XANH
```

Bắt worker tự chạy và dán output cả hai lần. Áp cùng cách cho seam: gỡ extension
ra rồi đếm xem BAO NHIÊU ca trong seam đổi. Seam `list-keys` của `#107` có 5 trên
8 ca đổi; ba ca còn lại giống nhau vì chúng là hành vi upstream, tức là chốt
chống hồi quy, và đó là lành mạnh. Nếu con số đó bằng 0 thì seam không đo gì.

## Kỷ luật đã chứng minh là đáng giá

**Đừng tin báo cáo của worker.** Fixture VÀ golden đều do worker tự viết, nên
roundtrip xanh là lập luận vòng tròn. Phải tự dựng ca tái hiện lấy THẲNG TỪ THÂN
ISSUE rồi chạy độc lập. Sóng 3 làm 14 ca như vậy.

**agy dưới Gemini Flash bịa BÁO CÁO trong khi MÃ thì đúng.** Đây là dạng hỏng của
sóng 4, và nó khó bắt hơn dạng bịa đều. Báo cáo của W1 liệt kê 20 tên loại message
không tồn tại (`exportDocx`, `searchFiles`, `toggleBreadcrumbs`...), trích khối mã
`showError` sai cả chữ ký lẫn nội dung, viết `storedPostMessage` trong khi mã thật
là `vscode.postMessage`, và mô tả một phép thử chưa từng chạy ở thì quá khứ. Cùng
báo cáo đó, claim về `document.isClosed` lại ĐÚNG. Mã nguồn thì sạch: 33 literal
khớp chính xác bản kiểm kê.

Đừng đọc báo cáo bằng mắt, kiểm bằng máy: bóc mọi khối mã trong báo cáo ra rồi
`grep -F` ngược vào file được nêu tên. Khối nào không khớp file nào là khối bịa,
trừ output lệnh.

Rồi trả về cho worker sửa, kèm luật cứng: mọi khối mã phải SINH RA bằng `sed -n`
rồi dán y nguyên, mọi danh sách phải sinh bằng `grep`, mọi phép thử phải kèm lệnh
và output thật, phép thử nào không chạy được thì viết thẳng là chưa kiểm được. W1
sửa xong trong một vòng và bản thứ hai qua được phép kiểm bằng máy.

**Ghi rõ trong bản đóng issue tiêu chí nào CHƯA kiểm được.** Sóng 4 có bốn tiêu
chí kiểu đó, đều cần một cửa sổ VS Code sống: ép lỗi clipboard (`#105`), gõ rồi
Ctrl+W mười lần (`#104`), ảnh chụp trước/sau hai theme (`#86`), Keyboard Shortcuts
liệt kê hai lệnh (`#108`). Đóng issue mà im lặng về chúng là tự tạo một khoản nợ
vô hình.

**Issue của repo này có thể sai, tỉ lệ cao.** Sóng 3 bắt được `#99` có tiêu chí
tự mâu thuẫn (đòi sửa bug nhưng cấm golden đang chụp bug đó thay đổi), `#96` sai
nguyên nhân gốc, `#95` sót một nguyên nhân thứ hai. Cộng với `#93` và `#94` của
sóng 2 là 5 trên 13 ticket. Sóng 4 thêm hai, thành 7 trên 24. Đọc issue xong VẪN
phải tự kiểm bằng code.

Hai ca của sóng 4, cả hai đều do worker phát hiện rồi `ask`, đúng như spec dạy:

- `#105` bảo trả lỗi về "để webview bật toast lỗi sẵn có (`showError`)". Không hề
  có toast. `showError` gán thẳng `editorEl.innerHTML`, nó là màn hình lỗi chí
  mạng, ba chỗ gọi hiện có đều là ca editor không dựng nổi. Làm theo issue là xoá
  trắng tài liệu người dùng đang mở, tức tệ hơn hẳn cái lỗi im lặng đang cần chữa.
- `#91` bảo đặt comment "ở chỗ serialize list". Repo không có chỗ đó: list do
  `@tiptap/extension-list` serialize. Nếu để worker tự xoay, nó sẽ dựng một
  `renderMarkdown` mới cho list chỉ để có chỗ treo comment, và đâm thẳng vào nhánh
  đang làm `#109`. Chỗ đúng là header của `BlankLineHandler`.

Bài học chung: khi thân issue trỏ vào một cơ chế, hãy tự mở file ra xem cơ chế đó
CÓ THẬT không, trước khi chép nó vào spec. Cả hai lần trên tôi đã chép nguyên câu
sai từ issue vào spec, và worker là người phát hiện.

**Đo trước khi chia việc.** Sóng 3 gộp `#97 #99 #100 #101` về một worker vì đo
được cả bốn dồn vào `MarkdownManager.escapeMarkdownSyntax`, và `#99` với `#101`
đòi hai điều ngược nhau từ CÙNG một quy tắc cho ký tự `[`. Đưa sẵn cơ chế vào
spec nên worker không mất vòng nào để mò. Đây là thứ tiết kiệm nhiều nhất.

Sóng 4 làm lại cách đó và vẫn đúng: dựng bảng "hàm nào bị ai chạm" trước khi chia,
rồi gộp theo CƠ CHẾ chứ không theo nhãn issue. `#109` và `#107` về một worker vì
cả hai là cơ chế list; `#87` và `#105` về một worker vì `#105` cần đúng cái union
mà `#87` tạo ra; `#104` bị CẮT ĐÔI theo ranh giới sở hữu, mẩu host về với `#87` vì
worker đó sở hữu `resolveCustomTextEditor`, và issue chỉ đóng sau khi cả hai nhánh
về đích.

Và biết HOÃN. `#88` bị hoãn vì nó bị `#87` chặn cứng, lại là hai PR viết lại đúng
cái file cả bốn worker đều chạm. Để chung sóng là cầm chắc xung đột không giải nổi.

**Phạm vi phình ra đôi khi là ĐÚNG.** W3 sửa `table-markdown-serializer.ts`, ngoài
spec. Không phải thừa: `#107` cho Tab tạo list lồng trong ô bảng, mà
`renderCellContent` cũ chỉ duyệt item cấp một và bỏ rơi im lặng mọi sub-list, nên
không sửa thì `#107` làm mất dữ liệu lúc lưu. Gặp phình phạm vi thì hỏi "thiếu nó
thì tính năng có sai không", đừng chặn theo phản xạ.

## LỖI CỦA ĐIỀU PHỐI VIÊN SÓNG 3, đừng lặp lại

Spec riêng của worker #102 (đã xoá cùng thư mục spec sóng 3) vừa cho worker
ngoại lệ được chạm
`list-continuation-underindented.md`, vừa ra ràng buộc "với mặc định 2 dấu cách
KHÔNG golden nào hiện có được đổi". Hai câu chọi nhau. Worker chọn cách an toàn
nên không chữa, và fixture đó vẫn đỏ tới giờ.

Bài học: khi nêu một ngoại lệ, phải nói luôn nó THẮNG ràng buộc nào.

Sóng 4 áp dụng bài học đó và nó chạy: spec của W3 nói thẳng "ngoại lệ seam THẮNG
ràng buộc 4" và "chốt chặn fixture THẮNG câu ghim marker của `#109`", nên worker
không mất một vòng nào để hỏi.

## LỖI CỦA ĐIỀU PHỐI VIÊN SÓNG 4, đừng lặp lại

**Chép nguyên câu sai từ thân issue vào spec.** Hai lần, `#105` và `#91`. Cả hai
lần worker là người phát hiện, tốn của mỗi bên một vòng hỏi đáp. Lẽ ra lúc đo để
chia việc, mỗi khi thân issue trỏ vào một cơ chế cụ thể (một hàm, một dòng, một
"chỗ" nào đó) thì phải mở file ra xác nhận cơ chế ấy có thật, y như cách tôi đã
làm với `#109` và nhờ đó xác nhận được nó đúng.

**Cấm `verify:vscode-floor` quá muộn.** Tôi chỉ nghĩ tới việc kiểm harness đó sau
khi đã thấy hai worker chạy nó song song. Khi lệnh cấm ra thì worker thứ ba đã
khởi động nó. Việc phải làm TRƯỚC khi phóng: rà xem lệnh kiểm nào dùng tài nguyên
dùng chung (thư mục cố định, cổng cố định, khoá toàn cục) và cấm sẵn trong spec.

## Ràng buộc bắt buộc đưa vào spec mọi worker

1. Cấm sửa MỌI `.md` ở GỐC repo, không riêng `CHANGELOG.md` và `AGENTS.md`:
   `README.md`, `CONTEXT.md`, `CLAUDE.md` cũng vậy. Lý do kép: nhiều nhánh song
   song sẽ chọi nhau, VÀ `harness/corpus.ts` quét mọi `*.md` ở gốc làm corpus nên
   mỗi lần sửa là một golden đổi. Sóng 4 có ba issue cùng muốn sửa `README.md`.
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
8. Ghi rõ số fixture failed ở vòng hai hiện tại (nay là 0, `#109` đã chữa) để
   worker không tưởng mình làm hỏng. Con số này là bằng chứng rẻ nhất về việc
   một worker có phá vỡ gì không, nên hãy đo nó lúc máy rảnh NGAY TRƯỚC khi phóng
   và dán vào spec.
9. `npm run verify:vscode-floor` nay chạy song song được (`#110` đã sửa ở sóng 5),
   không cần cấm nữa. Nhưng nó cần MỘT CỬA SỔ VS CODE THẬT mở ra rồi đóng lại
   trên màn hình, mỗi lượt khoảng 90 giây. Bốn worker cùng chạy là bốn cửa sổ
   nhảy lên máy người dùng. Hãy nói trong spec worker được chạy nó lúc nào,
   đừng để mỗi lần build xong lại chạy một lượt.
10. Với mọi fixture mới ghim một extension: bắt worker chứng minh bằng cách gỡ
    extension ra cho fixture ĐỎ rồi trả lại cho XANH, dán output cả hai lần.

## Quy trình merge cho sóng SONG SONG

Kiểm trên nhánh là kiểm với nền đã cũ, nên phải:

Thứ tự merge có ý nghĩa. Sóng 4 đưa nhánh giao thức message (`#87`) vào trước,
vì sau đó mọi lệch lạc giữa host và webview của ba nhánh còn lại trở thành lỗi
`tsc` chứ không phải lỗi chạy.

```
1. trong worktree của nhánh:  git merge develop
2. GIẢI XUNG ĐỘT TẠI ĐÂY, điều phối viên tự làm, không đẩy cho worker
   Xung đột ở main.ts và harness/editor.ts là CHẮC CHẮN từ lần merge thứ 2.
   Sóng 3 cả hai lần đều chỉ là khối import, giải bằng hợp cả hai ý.
   Sóng 4 có ba xung đột, đều tầm thường và đều giải bằng HỢP CẢ HAI: một khối
   import ở main.ts, và hai khối tuỳ chọn `StarterKit.configure` (`underline:
   false` chọi `orderedList: false`) ở main.ts và harness/editor.ts. Chưa lần nào
   xung đột chạm vào logic. Nếu gặp xung đột logic thật thì ranh giới sở hữu
   trong spec đã sai, quay lại sửa cách chia việc chứ đừng gắng giải.
3. chạy 4 lệnh + vòng hai TRÊN NHÁNH đã merge
4. fast-forward develop
5. chạy lại 4 lệnh + vòng hai TRÊN DEVELOP
6. gh issue close <n> --comment kèm bằng chứng CỦA MÌNH, không phải của worker
```

Sau khi điều phối viên sửa `CHANGELOG.md` hoặc `AGENTS.md`, hai golden
`harness/golden/repo/` tương ứng sẽ ĐỎ. Chạy `npm run roundtrip:update`, rồi
kiểm là CHỈ hai file đó đổi. Tiền lệ `ad2b67b`.

## Còn treo sau sóng 4

Mục này gắn với một thời điểm, không phải quy trình. Kiểm lại trước khi tin.

- **Bốn tiêu chí nghiệm thu chưa ai kiểm**, đều cần một cửa sổ VS Code sống, và
  đều đã ghi rõ trong bản đóng issue: ép lỗi clipboard rồi dán ảnh (`#105`), gõ
  năm ký tự rồi Ctrl+W mười lần (`#104`), ảnh chụp trước/sau một theme sáng một
  theme tối (`#86`), Keyboard Shortcuts liệt kê hai lệnh (`#108`). Nên làm bằng
  tay trước khi phát hành.
- `#102` vẫn còn bước kiểm TAY từ sóng 3 chưa thực thi: đổi `editor.tabSize` rồi
  xem lần sửa sau có ghi ra thụt lề mới không. Quy trình ở `docs/reports/w4-indent.md`
  mục 7. Chưa ai làm.
- `#96` còn hai tiêu chí hành vi editor chưa kiểm được bằng harness: sửa chữ cạnh
  cặp thẻ inline không làm vỡ cặp, và xoá một chip chỉ xoá đúng thẻ đó.
- `harness/editor.ts` và webview thật KHÔNG khớp ở một ca:
  `harness/vscode-floor/sample.md` không phải điểm bất động vòng một dưới
  `roundtripMarkdown`, nhưng webview không đẩy edit nên floor check vẫn xanh.
  Chưa truy tiếp, chưa có issue. Sang sóng 4 vẫn đúng như vậy.
- `#107` ghi sub-list lồng ở độ thụt sáu dấu cách chứ không phải ba như tiêu chí
  issue viết. Vẫn là markdown hợp lệ và vẫn là điểm bất động vòng hai, nên xếp
  loại Normalized chứ không phải lỗi. Đã ghi trong bản đóng issue.
- Ba run orchestration cũ còn trong Orca: `run_c607755eea03` (sóng 2),
  `run_81e972296c40` (sóng 3), `run_7c86994cae6d` (sóng 4, cả 6 dispatch
  succeeded, đã release, terminal đã đóng, hộp thư rỗng). CỐ Ý KHÔNG chạy
  `orca orchestration reset` vì lệnh đó không có cờ `--run`, nó xoá state TOÀN CỤC
  và sẽ đụng các dự án khác của người dùng (sekisan3, kiotviet-lite...). Sóng 5
  chỉ cần `run-create` một run mới.
- Bốn worktree của sóng 4 (`w1-messages`, `w2-cleanup`, `w3-lists`, `w4-editing`)
  đã merge hết vào `develop`. Xoá được bằng `orca worktree rm`, cùng với bốn mục
  tương ứng trong `trustedWorkspaces` của `~/.gemini/antigravity-cli/settings.json`.

## Sóng 5 nên làm gì

`#88` và `#89` là đầu sóng 5 rất gọn. `#88` giờ đã hết bị chặn: `#87` đã vào
`develop`, nên `Record<WebviewToHostMessage["type"], Handler>` mà nó cần đã có
sẵn union để khoá. `#89` không đụng file nào của `#88`. Thêm `#110` nữa là ba.

## Skill nên gọi

- `orchestration` BẮT BUỘC trước mọi lệnh Orca. Nó là stub, phải chạy tiếp
  `orca skills get orchestration`. Thêm `--reference references/coordinator-loop.md`
  khi tái dùng terminal hoặc chọn model, `references/placement-and-remote.md` khi
  tạo worktree mới, `references/recovery-and-cleanup.md` khi dispatch hỏng.
- `code-review` sau mỗi lần merge, cần một SHA mốc cố định.
- `resolving-merge-conflicts` khi nhiều nhánh cùng chạm `main.ts`. Sóng 4 không
  cần tới nó: cả ba xung đột đều là hợp-cả-hai.
- `tdd` nếu đụng `#89`.

Không dùng công cụ Agent hay workflow trừ khi người dùng, CLAUDE.md, hoặc một
skill yêu cầu. Worker `agy` chạy qua Orca, không phải qua công cụ Agent.

## Ảnh chụp trạng thái cuối sóng 4, 2026-09-16

Giữ lại làm ví dụ về mức độ chi tiết một bàn giao nên có. Số liệu bên dưới ĐÃ CŨ
ngay khi có commit tiếp theo; kiểm lại bằng git và `gh issue list`.

```
develop            131987e, CHƯA push
lint, build, build:dev  xanh
roundtrip          39 fixtures + 7 seams: 46 passed, 0 failed
vòng hai           46 passed, 0 failed     <- sóng 3 là 1 failed
verify:vscode-floor 15/15
issue mở           6, trong đó #83 #84 #85 là issue mẹ; còn #88 #89 #110
```

Sóng 4 đóng `#86 #87 #91 #104 #105 #106 #107 #108 #109` và mở ra `#110`.
Bốn worker, sáu dispatch: hai worker phải làm thêm một vòng sửa, W1 vì báo cáo
bịa, W4 vì fixture rỗng ruột. Cả hai lần mã nguồn đều đã đúng ngay từ vòng một.
