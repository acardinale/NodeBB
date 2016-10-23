
'use strict';

var async = require('async');
var validator = require('validator');

var db =  require('./database');
var batch = require('./batch');
var user = require('./user');
var utils = require('../public/src/utils');

(function (events) {
	events.log = function (data, callback) {
		callback = callback || function () {};

		async.waterfall([
			function (next) {
				db.incrObjectField('global', 'nextEid', next);
			},
			function (eid, next) {
				data.timestamp = Date.now();
				data.eid = eid;

				async.parallel([
					function (next) {
						db.sortedSetAdd('events:time', data.timestamp, eid, next);
					},
					function (next) {
						db.setObject('event:' + eid, data, next);
					}
				], next);
			}
		], function (err, result) {
			callback(err);
		});
	};

	events.getEvents = function (start, stop, callback) {
		async.waterfall([
			function (next) {
				db.getSortedSetRevRange('events:time', start, stop, next);
			},
			function (eids, next) {
				var keys = eids.map(function (eid) {
					return 'event:' + eid;
				});
				db.getObjects(keys, next);
			},
			function (eventsData, next) {
				addUserData(eventsData, 'uid', 'user', next);
			},
			function (eventsData, next) {
				addUserData(eventsData, 'targetUid', 'targetUser', next);
			},
			function (eventsData, next) {
				eventsData.filter(function (element) {
					return element !== undefined;
				})
				.forEach(function (event) {
					Object.keys(event).forEach(function (key) {
						if (typeof event[key] === 'string') {
							event[key] = validator.escape(String(event[key] || ''));
						}
					});
					var e = utils.merge(event);
					e.eid = e.uid = e.type = e.ip = e.user = undefined;
					event.jsonString = JSON.stringify(e, null, 4);
					event.timestampISO = new Date(parseInt(event.timestamp, 10)).toUTCString();
				});
				next(null, eventsData);
			}
		], callback);
	};

	function addUserData(eventsData, field, objectName, callback) {
		var uids = eventsData.map(function (event) {
			return event && event[field];
		}).filter(function (uid, index, array) {
			return uid && array.indexOf(uid) === index;
		});

		if (!uids.length) {
			return callback(null, eventsData);
		}

		async.parallel({
			isAdmin: function (next) {
				user.isAdministrator(uids, next);
			},
			userData: function (next) {
				user.getUsersFields(uids, ['username', 'userslug', 'picture'], next);
			}
		}, function (err, results) {
			if (err) {
				return callback(err);
			}

			var userData = results.userData;

			var map = {};
			userData.forEach(function (user, index) {
				user.isAdmin = results.isAdmin[index];
				map[user.uid] = user;
			});

			eventsData.filter(function (element) {
				return element !== undefined;
			}).forEach(function (event) {
				if (map[event[field]]) {
					event[objectName] = map[event[field]];
				}
			});
			callback(null, eventsData);
		});
	}

	events.deleteEvents = function (eids, callback) {
		callback = callback || function () {};
		async.parallel([
			function (next) {
				var keys = eids.map(function (eid) {
					return 'event:' + eid;
				});
				db.deleteAll(keys, next);
			},
			function (next) {
				db.sortedSetRemove('events:time', eids, next);
			}
		], callback);
	};

	events.deleteAll = function (callback) {
		callback = callback || function () {};

		batch.processSortedSet('events:time', function (eids, next) {
			events.deleteEvents(eids, next);
		}, {alwaysStartAt: 0}, callback);
	};


}(module.exports));
