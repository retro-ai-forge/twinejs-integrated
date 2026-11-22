// The 20 Legend names in their 10 pairs, as backend/legend.py LEGEND_PAIRS has
// them (checked by the app's tests/test_engine_legend_names.py). Only changes
// to these fields of $char, $lead and $picked are reported; story code can't
// change anything else of a character (story check), and the control layer
// applies the changes by the Legend rules.
exports.LEGEND_PAIRS = [
	['fame', 'infamy'],
	['renown', 'obscurity'],
	['faith', 'heresy'],
	['honor', 'shame'],
	['loyalty', 'treachery'],
	['mercy', 'cruelty'],
	['courage', 'cowardice'],
	['favour', 'disgrace'],
	['purity', 'corruption'],
	['wildkin', 'despoiler']
];

exports.LEGEND_NAMES = new Set(exports.LEGEND_PAIRS.flat());
