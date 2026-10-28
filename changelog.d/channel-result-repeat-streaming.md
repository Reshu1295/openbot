### Fixed

- A channel no longer stops all work when a member repeats its result as its last reply. Before, that reply could stay "still arriving" after the turn ended, and every later assignment in the channel failed with "The provider could not start this assignment". A channel that this blocked works again when OpenBot starts after the upgrade.
