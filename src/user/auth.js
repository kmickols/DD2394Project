'use strict';

const winston = require('winston');
const validator = require('validator');
const util = require('util');
const _ = require('lodash');
const db = require('../database');
const meta = require('../meta');
const events = require('../events');
const batch = require('../batch');
const utils = require('../utils');

module.exports = function (User) {
	User.auth = {};

	User.auth.logAttempt = async function (uid, ip) {
		if (!(parseInt(uid, 10) > 0)) {
			return;
		}
		
		// Username & IP lockout: 10 failed attempts = 24h lockout 
		const IPandUIDExists = await db.exists(`lockout:${uid, ip}`);
		if (IPandUIDExists) {
			throw new Error('[[error:account-locked]]');
		}
		
		const IPandUIDAttempts = await db.increment(`loginAttempts:${uid, ip}`);
		
		// meta.config.loginAttempts
		if (IPandUIDAttempts <= 10) {
			return await db.pexpire(`loginAttempts:${uid, ip}`, 1000 * 60 * 60);
		}
		// Lock out the account
		await db.set(`lockout:${uid, ip}`, '');
		// meta.config.lockoutDuration
		const IPandUIDDuration = 1000 * 60 * 60 * 24; // duration 24h

		await db.delete(`loginAttempts:${uid, ip}`);
		await db.pexpire(`lockout:${uid, ip}`, IPandUIDDuration);
		await events.log({
			type: 'account-locked',
			uid: uid,
			ip: ip,
		});
		throw new Error('[[error:account-locked]]');
		
		// Username lockout: 50 failed attempts = 24h lockout 
		const uidExists = await db.exists(`lockout:${uid}`);
		if (uidExists) {
			throw new Error('[[error:account-locked]]');
		}
		
		const userAttempts = await db.increment(`loginAttempts:${uid}`);
		
		// meta.config.loginAttempts
		if (userAttempts <= 50) {
			return await db.pexpire(`loginAttempts:${uid}`, 1000 * 60 * 60);
		}
		// Lock out the account
		await db.set(`lockout:${uid}`, '');
		// meta.config.lockoutDuration
		const uidDuration = 1000 * 60 * 60 * 24; // duration 24h

		await db.delete(`loginAttempts:${uid}`);
		await db.pexpire(`lockout:${uid}`, uidDuration);
		await events.log({
			type: 'account-locked',
			uid: uid,
			ip: ip,
		});
		throw new Error('[[error:account-locked]]');
		
		
		// IP lockout: 100 failed attempts = 24h lockout
		
		const ipExists = await db.exists(`lockout:${ip}`);
		if (ipExists) {
			throw new Error('[[error:account-locked]]');
		}
		const ipAttempts = await db.increment(`loginAttempts:${ip}`);
		
		// meta.config.loginAttempts
		if (ipAttempts <= 100) {
			return await db.pexpire(`loginAttempts:${ip}`, 1000 * 60 * 60);
		}
		// Lock out the account
		await db.set(`lockout:${ip}`, '');
		// meta.config.lockoutDuration
		const ipDuration = 1000 * 60 * 60 * 24; // duration 24h

		await db.delete(`loginAttempts:${ip}`);
		await db.pexpire(`lockout:${ip}`, ipDuration);
		await events.log({
			type: 'account-locked',
			uid: uid,
			ip: ip,
		});
		throw new Error('[[error:account-locked]]');
		
	};

	User.auth.getFeedToken = async function (uid) {
		if (!(parseInt(uid, 10) > 0)) {
			return;
		}
		const _token = await db.getObjectField(`user:${uid}`, 'rss_token');
		const token = _token || utils.generateUUID();
		if (!_token) {
			await User.setUserField(uid, 'rss_token', token);
		}
		return token;
	};

	User.auth.clearLoginAttempts = async function (uid) {
		await db.delete(`loginAttempts:${uid}`);
	};

	User.auth.resetLockout = async function (uid) {
		await db.deleteAll([
			`loginAttempts:${uid}`,
			`lockout:${uid}`,
		]);
	};

	const getSessionFromStore = util.promisify(
		(sid, callback) => db.sessionStore.get(sid, (err, sessObj) => callback(err, sessObj || null))
	);
	const sessionStoreDestroy = util.promisify(
		(sid, callback) => db.sessionStore.destroy(sid, err => callback(err))
	);

	User.auth.getSessions = async function (uid, curSessionId) {
		await cleanExpiredSessions(uid);
		const sids = await db.getSortedSetRevRange(`uid:${uid}:sessions`, 0, 19);
		let sessions = await Promise.all(sids.map(sid => getSessionFromStore(sid)));
		sessions = sessions.map((sessObj, idx) => {
			if (sessObj && sessObj.meta) {
				sessObj.meta.current = curSessionId === sids[idx];
				sessObj.meta.datetimeISO = new Date(sessObj.meta.datetime).toISOString();
				sessObj.meta.ip = validator.escape(String(sessObj.meta.ip));
			}
			return sessObj && sessObj.meta;
		}).filter(Boolean);
		return sessions;
	};

	async function cleanExpiredSessions(uid) {
		const uuidMapping = await db.getObject(`uid:${uid}:sessionUUID:sessionId`);
		if (!uuidMapping) {
			return;
		}
		const expiredUUIDs = [];
		const expiredSids = [];
		await Promise.all(Object.keys(uuidMapping).map(async (uuid) => {
			const sid = uuidMapping[uuid];
			const sessionObj = await getSessionFromStore(sid);
			const expired = !sessionObj || !sessionObj.hasOwnProperty('passport') ||
				!sessionObj.passport.hasOwnProperty('user') ||
				parseInt(sessionObj.passport.user, 10) !== parseInt(uid, 10);
			if (expired) {
				expiredUUIDs.push(uuid);
				expiredSids.push(sid);
			}
		}));
		await db.deleteObjectFields(`uid:${uid}:sessionUUID:sessionId`, expiredUUIDs);
		await db.sortedSetRemove(`uid:${uid}:sessions`, expiredSids);
	}

	User.auth.addSession = async function (uid, sessionId) {
		if (!(parseInt(uid, 10) > 0)) {
			return;
		}
		await cleanExpiredSessions(uid);
		await db.sortedSetAdd(`uid:${uid}:sessions`, Date.now(), sessionId);
		await revokeSessionsAboveThreshold(uid, meta.config.maxUserSessions);
	};

	async function revokeSessionsAboveThreshold(uid, maxUserSessions) {
		const activeSessions = await db.getSortedSetRange(`uid:${uid}:sessions`, 0, -1);
		if (activeSessions.length > maxUserSessions) {
			const sessionsToRevoke = activeSessions.slice(0, activeSessions.length - maxUserSessions);
			await Promise.all(sessionsToRevoke.map(sessionId => User.auth.revokeSession(sessionId, uid)));
		}
	}

	User.auth.revokeSession = async function (sessionId, uid) {
		winston.verbose(`[user.auth] Revoking session ${sessionId} for user ${uid}`);
		const sessionObj = await getSessionFromStore(sessionId);
		if (sessionObj && sessionObj.meta && sessionObj.meta.uuid) {
			await db.deleteObjectField(`uid:${uid}:sessionUUID:sessionId`, sessionObj.meta.uuid);
		}
		await Promise.all([
			db.sortedSetRemove(`uid:${uid}:sessions`, sessionId),
			sessionStoreDestroy(sessionId),
		]);
	};

	User.auth.revokeAllSessions = async function (uids, except) {
		uids = Array.isArray(uids) ? uids : [uids];
		const sids = await db.getSortedSetsMembers(uids.map(uid => `uid:${uid}:sessions`));
		const promises = [];
		uids.forEach((uid, index) => {
			const ids = sids[index].filter(id => id !== except);
			if (ids.length) {
				promises.push(ids.map(s => User.auth.revokeSession(s, uid)));
			}
		});
		await Promise.all(promises);
	};

	User.auth.deleteAllSessions = async function () {
		await batch.processSortedSet('users:joindate', async (uids) => {
			const sessionKeys = uids.map(uid => `uid:${uid}:sessions`);
			const sessionUUIDKeys = uids.map(uid => `uid:${uid}:sessionUUID:sessionId`);
			const sids = _.flatten(await db.getSortedSetRange(sessionKeys, 0, -1));

			await Promise.all([
				db.deleteAll(sessionKeys.concat(sessionUUIDKeys)),
				...sids.map(sid => sessionStoreDestroy(sid)),
			]);
		}, { batch: 1000 });
	};
};
