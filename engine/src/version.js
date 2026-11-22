// The engine version every saved state carries (APP_INTEGRATION_HEADLESS.md
// "The engine's API"). Raise it only when the runtime or SugarCube changes so
// that states saved by an older engine can't be restored any more: such a
// frame then goes to LastResort, which gives the run back.
exports.ENGINE_VERSION = '1';
