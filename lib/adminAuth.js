"use strict";

const crypto = require("crypto");

/**
 * Builds Express middleware that optionally protects the admin area with HTTP Basic Auth.
 *
 * Auth is opt-in: if ADMIN_PASSWORD is not set, the middleware calls next() immediately,
 * preserving the unauthenticated behaviour that trusted-LAN deployments rely on by default.
 * @param {NodeJS.ProcessEnv} env
 * @returns {(req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => void}
 */
function createAdminAuthMiddleware(env = process.env)
{
	const expectedPass = env.ADMIN_PASSWORD;
	const expectedUser = env.ADMIN_USER || "admin";

	return function requireAdminAuth(req, res, next)
	{
		if(!expectedPass)
		{
			return next();
		}

		const header = req.headers.authorization || "";
		const [scheme, encoded] = header.split(" ");
		let user = "", pass = "";
		if(scheme === "Basic" && encoded)
		{
			const decoded = Buffer.from(encoded, "base64").toString("utf-8");
			const sep = decoded.indexOf(":");
			user = decoded.slice(0, sep);
			pass = decoded.slice(sep + 1);
		}

		const userBuf = Buffer.from(user), passBuf = Buffer.from(pass);
		const expUserBuf = Buffer.from(expectedUser), expPassBuf = Buffer.from(expectedPass);
		const userOk = userBuf.length === expUserBuf.length && crypto.timingSafeEqual(userBuf, expUserBuf);
		const passOk = passBuf.length === expPassBuf.length && crypto.timingSafeEqual(passBuf, expPassBuf);

		if(!userOk || !passOk)
		{
			res.set("WWW-Authenticate", "Basic realm=\"Admin\"");
			return res.status(401).send("Unauthorized");
		}

		next();
	};
}

module.exports = { createAdminAuthMiddleware };
