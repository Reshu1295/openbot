import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/share";

export const messages = {
  "mobile.share.signInTitle": "登入後即可分享",
  "mobile.share.signInDescription": "掃描電腦上 OpenBot 顯示的 QR 碼，然後就能選擇由哪個助理接收你分享的內容。",
  "mobile.share.reading": "正在讀取你分享的內容…",
  "mobile.share.readFailed": "OpenBot 無法讀取你分享的內容，請重新分享。",
  "mobile.share.content": "待分享內容",
  "mobile.share.footer": "對話會帶著這段內容開啟並填入輸入框，在你傳送之前不會發出任何內容。",
  "mobile.share.lastUsed": "最近使用",
  "mobile.share.noAgents": "沒有助理",
  "mobile.share.chooseAgent": "選擇助理",
  "mobile.share.action": "分享給{name}",
} as const satisfies PartialTranslation<typeof source>;
