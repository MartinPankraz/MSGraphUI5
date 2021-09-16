/* global QUnit */

QUnit.config.autostart = false;

sap.ui.getCore().attachInit(function() {
	"use strict";

	sap.ui.require([
		"azure/graph/example/msgraphui/test/integration/AllJourneys"
	], function() {
		QUnit.start();
	});
});