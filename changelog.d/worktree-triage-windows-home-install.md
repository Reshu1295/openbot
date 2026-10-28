### Fixed

- On Windows, OpenBot updates again when it was installed in `%USERPROFILE%\OpenBot`, the folder that
  also holds your agent folders. Before, each update stopped with "Failed to uninstall old application
  files. Please try running the installer again.: 2", also after a restart. The update now installs
  OpenBot in `%LOCALAPPDATA%\Programs\OpenBot` and removes only the app files from the earlier folder.
  Your agents, `Shared` and `Downloads` stay where they are. **Do not uninstall OpenBot from Windows
  Settings to repair this: in that folder, the uninstaller of 0.53.1 or earlier also deletes your
  agent folders.**
- The Windows installer no longer accepts `%USERPROFILE%\OpenBot`, `%APPDATA%\OpenBot`, or a folder
  that holds one of them, as the install folder. It uses the default folder instead.
