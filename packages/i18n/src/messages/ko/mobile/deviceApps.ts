import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/deviceApps";

export const messages = {
  "mobile.deviceApps.title": "연결된 앱",
  "mobile.deviceApps.apps": "앱",
  "mobile.deviceApps.appsFooter":
    "에이전트가 이 iPhone의 앱을 사용하도록 허용합니다. 앱을 켜면 iPhone이 해당 권한을 요청합니다. 앱이 꺼져 있는 동안에는 에이전트가 처음 접근할 때 OpenBot이 먼저 묻습니다.",
  "mobile.deviceApps.writes": "항목 추가",
  "mobile.deviceApps.writesFooter":
    "'항상'을 선택하기 전에는 에이전트가 일정이나 미리 알림을 추가하기 전에 OpenBot이 먼저 묻습니다.",
  "mobile.deviceApps.app.calendar": "캘린더",
  "mobile.deviceApps.app.reminders": "미리 알림",
  "mobile.deviceApps.app.contacts": "연락처",
  "mobile.deviceApps.app.location": "위치",
  "mobile.deviceApps.app.denied": "{app}(거부됨)",
  "mobile.deviceApps.write.calendar": "묻지 않고 일정 추가",
  "mobile.deviceApps.write.reminders": "묻지 않고 미리 알림 추가",
  "mobile.deviceApps.osDenied": "iPhone 설정에서 {app} 허용",
  "mobile.deviceApps.consent.heading": "{app}을(를) 허용할까요?",
  "mobile.deviceApps.consent.calendarListEvents": "에이전트가 캘린더의 일정을 읽으려고 합니다.",
  "mobile.deviceApps.consent.calendarAddEvent": "에이전트가 캘린더에 이 일정을 추가하려고 합니다: {title}",
  "mobile.deviceApps.consent.remindersList": "에이전트가 미리 알림을 읽으려고 합니다.",
  "mobile.deviceApps.consent.remindersAdd": "에이전트가 이 미리 알림을 추가하려고 합니다: {title}",
  "mobile.deviceApps.consent.contactsFind": "에이전트가 연락처에서 사람을 찾으려고 합니다.",
  "mobile.deviceApps.consent.locationCurrent": "에이전트가 약 100미터 이내의 정확도로 현재 위치를 알려고 합니다.",
  "mobile.deviceApps.consent.privacy":
    "에이전트가 읽은 내용은 해당 컴퓨터로 전송되며 모델 제공업체에 전달될 수 있습니다.",
  "mobile.deviceApps.consent.once": "한 번 허용",
  "mobile.deviceApps.consent.always": "항상 허용",
  "mobile.deviceApps.consent.deny": "거부",
} as const satisfies PartialTranslation<typeof source>;
