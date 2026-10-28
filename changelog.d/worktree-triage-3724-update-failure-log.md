### Fixed

- A failed update check, download or install now writes its reason, error code and HTTP status in
  `logs/main/main.log`. Before, the logs showed only `check_failed`, with no reason.
