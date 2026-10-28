### Fixed

- An agent can attach files in the built-in browser when the page opens its file chooser from a
  button, such as the "Paste, drop, or click to add files" button in a GitHub comment. Before,
  `upload_files` worked only on a file input, and on these pages it stopped with "Node is not a file
  input element".
