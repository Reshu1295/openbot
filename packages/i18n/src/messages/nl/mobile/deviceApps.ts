import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/deviceApps";

export const messages = {
  "mobile.deviceApps.title": "Verbonden apps",
  "mobile.deviceApps.apps": "Apps",
  "mobile.deviceApps.appsFooter":
    "Laat je agenten deze apps op deze iPhone gebruiken. Als je een app inschakelt, vraagt de iPhone om toestemming. Zolang een app uit staat, vraagt OpenBot het bij de eerste toegang van een agent.",
  "mobile.deviceApps.writes": "Items toevoegen",
  "mobile.deviceApps.writesFooter":
    "Totdat je 'Altijd' kiest, vraagt OpenBot om bevestiging voordat een agent een afspraak of herinnering toevoegt.",
  "mobile.deviceApps.app.calendar": "Agenda",
  "mobile.deviceApps.app.reminders": "Herinneringen",
  "mobile.deviceApps.app.contacts": "Contacten",
  "mobile.deviceApps.app.location": "Locatie",
  "mobile.deviceApps.app.denied": "{app} (geweigerd)",
  "mobile.deviceApps.write.calendar": "Afspraken toevoegen zonder te vragen",
  "mobile.deviceApps.write.reminders": "Herinneringen toevoegen zonder te vragen",
  "mobile.deviceApps.osDenied": "{app} toestaan in de iPhone-instellingen",
  "mobile.deviceApps.consent.heading": "{app} toestaan?",
  "mobile.deviceApps.consent.calendarListEvents": "Een agent wil afspraken in je agenda lezen.",
  "mobile.deviceApps.consent.calendarAddEvent": "Een agent wil deze afspraak aan je agenda toevoegen: {title}",
  "mobile.deviceApps.consent.remindersList": "Een agent wil je herinneringen lezen.",
  "mobile.deviceApps.consent.remindersAdd": "Een agent wil deze herinnering toevoegen: {title}",
  "mobile.deviceApps.consent.contactsFind": "Een agent wil mensen in je contacten zoeken.",
  "mobile.deviceApps.consent.locationCurrent":
    "Een agent wil weten waar je bent, tot op ongeveer 100 meter nauwkeurig.",
  "mobile.deviceApps.consent.privacy":
    "Wat de agent leest, gaat naar zijn computer en kan bij zijn modelaanbieder terechtkomen.",
  "mobile.deviceApps.consent.once": "Eenmaal toestaan",
  "mobile.deviceApps.consent.always": "Altijd toestaan",
  "mobile.deviceApps.consent.deny": "Weigeren",
} as const satisfies PartialTranslation<typeof source>;
