# Merge code khi xong task

- Khi một task/feature xong (đã chạy `npm run lint`, `npm run typecheck`, `npm test` và pass), tự merge nhánh task vào `develop` rồi vào `main` mà không cần hỏi lại, sau đó push cả hai nhánh lên origin.
- Quy trình: `git fetch origin`; checkout `develop`, pull, `git merge --no-ff <nhánh-task>`, push; checkout `main`, pull, `git merge --no-ff <nhánh-task>`, push.
- Nếu có conflict hoặc test/lint/typecheck fail: dừng lại, báo cho user, không tự ý merge hay giải quyết bằng cách bỏ code của người khác.
- Không force-push, không xoá nhánh task. Commit message của merge không thêm `Co-Authored-By` hay attribution AI.
