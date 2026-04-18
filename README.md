# Meme Swipe — Hornydragon

Tinder-style 左右滑網頁，把 [hornydragon.blogspot.com](https://hornydragon.blogspot.com/?m=1) 上的迷因圖一張張刷給你看，右滑收藏、左滑跳過。

## 怎麼用

直接打開 `index.html`（或部署到 GitHub Pages）即可。

- **右滑 / 點 ❤️ / 按 →**：加入收藏
- **左滑 / 點 ✕ / 按 ←**：跳過
- **按 ↑**：開啟原文
- **按 z 或點 ↶**：復原上一張
- **點左上 ❤️ 數字**：查看你收藏的迷因，可單張移除、整批匯出 JSON
- **⚙️ 選單**：把跳過的迷因還原、清空所有紀錄

## 技術重點

- 純前端，沒有後端、沒有 build step
- 透過 Blogger 的 `alt=json-in-script` JSONP 介面分批抓取所有貼文，從 `<content>` HTML 解析出 `bp.blogspot.com` / `googleusercontent.com` 上的圖片，並把縮圖網址升級到 `/s1600/` 取大圖
- 收藏與跳過紀錄存在 `localStorage`，沒有任何資料離開你的瀏覽器
- 拖曳用 Pointer Events，桌機 / 觸控 / 鍵盤都通
