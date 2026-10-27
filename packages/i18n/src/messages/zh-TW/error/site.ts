import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/site";

export const messages = {
  // Hosted site errors.
  "error.site.absolutePath": "請選擇網站目錄的絕對路徑。",
  "error.site.rootSymlink": "託管網站不允許使用符號連結。",
  "error.site.notDirectory": "網站源必須是一個目錄。",
  "error.site.outsideWorkspace": "網站必須位於該助理的工作區或 OpenBot 共享資料夾內。",
  "error.site.packageJsonInvalid": "網站的 package.json 無效。",
  "error.site.astroServerOutput": "Astro 必須使用靜態輸出。",
  "error.site.astroAdapter": "不允許使用 Astro 伺服器端介面卡和 React 整合。",
  "error.site.astroApiRoutes": "不允許使用 Astro API 路由和伺服器端操作。",
  "error.site.astroMiddleware": "不允許使用 Astro 中介軟體和伺服器端原始碼。",
  "error.site.astroNotBuilt": "請先建置 Astro 專案，需要已存在的 dist/ 目錄。",
  "error.site.astroDistNotDirectory": "Astro 的 dist/ 必須是真實目錄。",
  "error.site.astroDistOutside": "Astro 的 dist/ 必須位於專案目錄內。",
  "error.site.directoryOutsideRoot": "網站目錄必須位於源根目錄內。",
  "error.site.siteTooLarge": "網站超過了 2 MB 的上限。",
  "error.site.missingIndex": "網站根目錄必須包含 index.html。",
  "error.site.symlink": "不允許使用符號連結：{name}",
  "error.site.unsupportedEntry": "不支援的網站條目：{name}",
  "error.site.tooManyFiles": "一個網站最多包含 {limit} 個檔案。",
  "error.site.hiddenFile": "不允許包含隱藏檔案：{path}",
  "error.site.unsafePath": "不允許使用該檔案路徑：{path}",
  "error.site.secretFile": "不允許包含憑證、私鑰或伺服器端原始碼：{path}",
  "error.site.fileType": "不允許使用該檔案類型：{path}",
  "error.site.fileOutsideRoot": "網站檔案必須位於源根目錄內：{path}",
  "error.site.fileTooLarge": "某個檔案超過了 1 MB 上限：{path}",
} as const satisfies PartialTranslation<typeof source>;
