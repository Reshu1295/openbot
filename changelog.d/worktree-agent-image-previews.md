### Added

- An image file that an agent names in its answer, such as a PNG or SVG in the shared folder, now
  shows as a preview under the answer. Click it to open it at full size.

### Fixed

- An SVG path in an agent answer was plain text. It is now a file link that opens the file.
- An agent that tried to attach an SVG file got a general "not supported" error. It now gets told
  to write the file path in its answer, where the chat shows the image.
