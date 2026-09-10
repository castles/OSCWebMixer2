"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createAdminAuthMiddleware } = require("../lib/adminAuth.js");

function makeReq(headers = {})
{
	return { headers };
}

function makeRes()
{
	const res = {
		statusCode: null,
		headers: {},
		body: null,
		set(name, value) { this.headers[name] = value; return this; },
		status(code) { this.statusCode = code; return this; },
		send(body) { this.body = body; return this; }
	};
	return res;
}

function basicAuthHeader(user, pass)
{
	return "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
}

test("auth disabled by default (no ADMIN_PASSWORD) lets requests through unauthenticated", () =>
{
	const middleware = createAdminAuthMiddleware({});
	const req = makeReq();
	const res = makeRes();
	let nextCalled = false;

	middleware(req, res, () => { nextCalled = true; });

	assert.equal(nextCalled, true);
	assert.equal(res.statusCode, null);
});

test("auth enabled with valid credentials calls next()", () =>
{
	const middleware = createAdminAuthMiddleware({ ADMIN_PASSWORD: "secret", ADMIN_USER: "admin" });
	const req = makeReq({ authorization: basicAuthHeader("admin", "secret") });
	const res = makeRes();
	let nextCalled = false;

	middleware(req, res, () => { nextCalled = true; });

	assert.equal(nextCalled, true);
	assert.equal(res.statusCode, null);
});

test("auth enabled with missing Authorization header returns 401", () =>
{
	const middleware = createAdminAuthMiddleware({ ADMIN_PASSWORD: "secret" });
	const req = makeReq();
	const res = makeRes();
	let nextCalled = false;

	middleware(req, res, () => { nextCalled = true; });

	assert.equal(nextCalled, false);
	assert.equal(res.statusCode, 401);
	assert.match(res.headers["WWW-Authenticate"], /Basic/);
});

test("auth enabled with wrong password returns 401", () =>
{
	const middleware = createAdminAuthMiddleware({ ADMIN_PASSWORD: "secret", ADMIN_USER: "admin" });
	const req = makeReq({ authorization: basicAuthHeader("admin", "wrong") });
	const res = makeRes();
	let nextCalled = false;

	middleware(req, res, () => { nextCalled = true; });

	assert.equal(nextCalled, false);
	assert.equal(res.statusCode, 401);
});

test("auth enabled with wrong user returns 401", () =>
{
	const middleware = createAdminAuthMiddleware({ ADMIN_PASSWORD: "secret", ADMIN_USER: "admin" });
	const req = makeReq({ authorization: basicAuthHeader("someone-else", "secret") });
	const res = makeRes();
	let nextCalled = false;

	middleware(req, res, () => { nextCalled = true; });

	assert.equal(nextCalled, false);
	assert.equal(res.statusCode, 401);
});

test("the same protected middleware instance guards both the admin page and the admin POST action", () =>
{
	// index.js wires this single middleware into both `app.get('/admin', requireAdminAuth, ...)`
	// and `app.post('/admin', requireAdminAuth, ...)` - the middleware itself is method-agnostic,
	// so protecting one call site protects both.
	const middleware = createAdminAuthMiddleware({ ADMIN_PASSWORD: "secret" });

	const getReq = makeReq();
	const getRes = makeRes();
	middleware(getReq, getRes, () => {});
	assert.equal(getRes.statusCode, 401);

	const postReq = makeReq();
	const postRes = makeRes();
	middleware(postReq, postRes, () => {});
	assert.equal(postRes.statusCode, 401);
});
