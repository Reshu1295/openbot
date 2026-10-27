### Fixed

- When this computer's server was published, OpenBot publishes it again after a start, also when the
  account service or Signal does not answer at first, for example at login before the network is
  ready. It also publishes the server again when Signal disconnects it later. It tries again after
  1 minute, and then less frequently. Before, the server stayed private after one failed try, and
  you had to publish it again, for example after an update.
