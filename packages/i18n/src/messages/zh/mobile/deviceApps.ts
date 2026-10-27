import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/deviceApps";

export const messages = {
  "mobile.deviceApps.title": "已连接的应用",
  "mobile.deviceApps.apps": "应用",
  "mobile.deviceApps.appsFooter":
    "允许你的智能体使用这台 iPhone 上的这些应用。开启某个应用时，iPhone 会请求相应权限。应用关闭期间，智能体首次访问时 OpenBot 会先询问你。",
  "mobile.deviceApps.writes": "添加条目",
  "mobile.deviceApps.writesFooter": "在你选择“始终”之前，智能体添加日程或提醒事项前 OpenBot 会先询问你。",
  "mobile.deviceApps.app.calendar": "日历",
  "mobile.deviceApps.app.reminders": "提醒事项",
  "mobile.deviceApps.app.contacts": "通讯录",
  "mobile.deviceApps.app.location": "位置",
  "mobile.deviceApps.app.denied": "{app}（已拒绝）",
  "mobile.deviceApps.write.calendar": "无需询问即可添加日程",
  "mobile.deviceApps.write.reminders": "无需询问即可添加提醒事项",
  "mobile.deviceApps.osDenied": "在 iPhone 设置中允许{app}",
  "mobile.deviceApps.consent.heading": "允许{app}？",
  "mobile.deviceApps.consent.calendarListEvents": "智能体想读取你日历中的日程。",
  "mobile.deviceApps.consent.calendarAddEvent": "智能体想把这个日程添加到你的日历：{title}",
  "mobile.deviceApps.consent.remindersList": "智能体想读取你的提醒事项。",
  "mobile.deviceApps.consent.remindersAdd": "智能体想添加这个提醒事项：{title}",
  "mobile.deviceApps.consent.contactsFind": "智能体想在你的通讯录中查找联系人。",
  "mobile.deviceApps.consent.locationCurrent": "智能体想知道你的位置，精度约 100 米。",
  "mobile.deviceApps.consent.privacy": "智能体读取的内容会发送到它所在的电脑，并可能到达其模型提供商。",
  "mobile.deviceApps.consent.once": "允许一次",
  "mobile.deviceApps.consent.always": "始终允许",
  "mobile.deviceApps.consent.deny": "拒绝",
} as const satisfies PartialTranslation<typeof source>;
