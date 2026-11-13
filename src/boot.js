// Entry point: start the updater hooks first, then the app itself.
require('./updater').install();
require('./main');
