### Added

- Add Neon, Prisma, Netlify, Railway, Atlassian (Jira and Confluence), Todoist and Hugging Face to the Apps catalog. Sign in in the browser to connect each of them, except Hugging Face: it reads public Hub data and needs no account. Neon, Prisma, Netlify, Railway, Atlassian and Todoist give agents write access, so agents can change or delete data there. Each listing says what agents can change.

### Changed

- In the web client, the Marketplace now opens as a full page of the window, as in the desktop app. Before, it opened as a dialog over the workspace.
- The Marketplace now has a side panel, as the settings page has. Select Apps, Agents or Skills there. Below them, "Your apps" lists the apps that you connected, and a warning shows on an app that needs your attention. While you search, the panel shows how many results each kind has.
- The Marketplace now opens on Apps. Apps show in groups by category, in compact rows with Connect, Connected or Reconnect at the end of the row.
- To add your own MCP server, click "Add custom" next to the search on the Apps page of the Marketplace. Server settings open on the form for a new MCP server. Only a user who can add MCP servers to the server sees the button.
- On an app, agent or skill page of the Marketplace, the top row now shows the path to it, for example "Apps › GitHub". Click "Apps" to go back to the list. On an app, agent or skill page, Apps, Agents or Skills stays selected in the side panel. On the page of an app in "Your apps", that app is selected. The page has the same width as the list, so the content does not move when it opens.
- Connectors are now only in the Marketplace. Server settings no longer has a Connectors section. To connect or change Slack, Discord, Telegram, GitHub, 1Password or Bitwarden, open Marketplace › Apps.
- All app pages now use one layout: the header, then alerts, then sections with a heading and one card each, and last the danger zone. Text, forms and notes now show inside the cards, and all buttons in a card have the same small size. A plugin that is not completely installed shows a warning above its sections. An app that is not connected now shows "Not connected" at the top of its page. Before, some pages showed "Not set up".
- Slack, Discord and Telegram pages now have a danger zone that disconnects every workspace, server or chat at once, after you confirm. Each row still has its own Disconnect.
- The page that opens after a Slack or Discord sign-in in the browser now tells you to open Marketplace › Apps to try again.
- The connect dialogs of Marketplace apps that you sign in to, give a key to, or turn on in their desktop app now look and work as the GitHub and Slack connect dialogs do. They show OpenBot and the app with a line that moves while they connect, and Cancel and the main button at the bottom right. When a connection fails, the line breaks. Connect in the Marketplace now starts the connection at once: a sign-in opens the browser, and an app on this computer connects if its server is on. An app that needs a key opens with the cursor in the key field.
- To disconnect Bitwarden, use the button in the new danger zone at the bottom of its page.
- The Cloudflare, Airtable and Paper icons in the Marketplace are now centered and clear on a dark background.
- A plugin page now has a Connection section. It shows how each app connects: you are signed in, an API key is saved, it uses a desktop app on this computer, or it needs nothing. Use "Sign in again", "Change key" or "Connect again" there.
- When the sign-in of a plugin expires, the plugin shows "Needs attention" and a warning, and "Sign in again" signs in again. The page header, the Connection row and the Apps list use the same name for this action. A plugin with more than one app shows the button only on the row of the app that needs it.
- Every connector page now has an Information section with the developer, the category and the website.
- On the Slack, Discord and Telegram pages, the sections are now named "Workspaces", "Discord servers" and "Chats". "Add workspace", "Add Discord server" and "Link a chat" are at the right of that section.
- The 1Password and Bitwarden pages now look the same. Bitwarden shows the shared folder and the server address in one card, and the session key field has a label.
- The danger zone of every app page is now named for the app, for example "Disconnect Notion".
- Under the name of Slack, Discord, Telegram, GitHub, 1Password and Bitwarden, the page now shows a short line, as the Apps list does. The full description is at the top of the Information section.
- On the Bitwarden page, the shared folder row now says "Folder in Bitwarden" under the folder name.
- The developer of each catalog app now shows as a name, for example "Notion", not as a web address.

### Fixed

- Reconnect on a plugin that is already connected no longer fails with "An MCP server named … already exists". It now updates the saved connection.
