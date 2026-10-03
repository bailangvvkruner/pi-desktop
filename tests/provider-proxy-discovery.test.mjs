// Regression tests for provider model discovery over the system-proxy route.
// Covers the fixes for:
// - undici ProxyAgent tunnel timeouts: `connect:{timeout}` is ignored by
//   ProxyAgent (it reads the top-level `connectTimeout`), so lazy proxies that
//   take >10s to establish the tunnel killed every proxied discovery.
// - unconfigured providers must follow the system proxy by default (previously
//   "unset" meant a direct connection, which is unreachable for blocked hosts).
// - discovery failures must name the route (system proxy vs direct) so users
//   can tell a broken proxy exit from a blocked direct connection.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import net from 'node:net';
import { createServer } from 'node:http';
import { test } from 'node:test';

const listen = (server, host = '127.0.0.1') => new Promise((resolveListen) => server.listen(0, host, () => resolveListen(server.address())));

function modelsServer() {
	const requests = [];
	const server = createServer((request, response) => {
		requests.push({ url: request.url, authorization: request.headers.authorization ?? null });
		response.writeHead(200, { 'content-type': 'application/json' });
		response.end(JSON.stringify({ data: [
			{ id: 'proxy-mini', display_name: 'Proxy Mini', context_length: 65536, max_output_tokens: 8192 },
			{ id: 'proxy-max', display_name: 'Proxy Max', context_length: 131072, max_output_tokens: 16384, reasoning: true },
		] }));
	});
	return { server, requests };
}

/** HTTP proxy that tunnels CONNECT targets after a configurable delay. */
function tunnelProxy(delayMs) {
	const events = [];
	const server = net.createServer((socket) => {
		socket.once('error', () => {});
		let buffer = '';
		const parse = (chunk) => {
			buffer += chunk.toString('latin1');
			const end = buffer.indexOf('\r\n\r\n');
			if (end === -1) return;
			const head = buffer.slice(0, end);
			const rest = Buffer.from(buffer.slice(end + 4), 'latin1');
			socket.removeListener('data', parse);
			const target = /^CONNECT (\S+)/i.exec(head)?.[1];
			if (!target) { events.push({ nonConnect: head.slice(0, 120) }); socket.end('HTTP/1.1 405 Only CONNECT\r\n\r\n'); return; }
			events.push({ connect: target });
			// Lazy proxies (v2ray & friends) answer 200 before the upstream exists;
			// slow ones keep the client waiting inside the tunnel connect phase.
			setTimeout(() => {
				if (socket.destroyed) return;
				const colon = target.lastIndexOf(':');
				const upstream = net.connect({ host: target.slice(0, colon), port: Number(target.slice(colon + 1)) });
				upstream.once('error', () => socket.destroy());
				upstream.once('connect', () => {
					socket.write('HTTP/1.1 200 Connection established\r\n\r\n', 'latin1', () => {
						if (rest.length) upstream.write(rest);
						socket.pipe(upstream);
						upstream.pipe(socket);
					});
				});
			}, delayMs);
		};
		socket.on('data', parse);
	});
	return { server, events };
}

test('outside the Electron host a proxied scope falls back to the inherited fetch instead of failing', async () => {
	const { runWithProviderNetwork } = await import('../packages/agent/src/providerNetwork.ts');
	const inherited = globalThis.fetch;
	let routedThroughStub = false;
	globalThis.fetch = async () => {
		routedThroughStub = true;
		return new Response('{}', { headers: { 'content-type': 'application/json' } });
	};
	try {
		await runWithProviderNetwork(true, () => fetch('http://fallback.example.invalid/v1/models'));
		assert.equal(routedThroughStub, true, 'without a configured resolver the inherited fetch must serve the request');
	} finally {
		globalThis.fetch = inherited;
	}
});

test('a slow proxy tunnel outlives the old 10s undici default and still discovers models', async () => {
	const { configureProviderNetwork, runWithProviderNetwork } = await import('../packages/agent/src/providerNetwork.ts');
	const { discoverProviderModels } = await import('../packages/agent/src/providerDiscovery.ts');
	const models = modelsServer();
	const proxy = tunnelProxy(12_000);
	const modelsAddress = await listen(models.server);
	const proxyAddress = await listen(proxy.server);
	configureProviderNetwork(async () => `PROXY 127.0.0.1:${proxyAddress.port}`);
	try {
		const started = Date.now();
		const result = await runWithProviderNetwork(true, () => discoverProviderModels({
			baseUrl: `http://127.0.0.1:${modelsAddress.port}/v1`, api: 'openai-completions', apiKey: 'proxy-test-key',
		}));
		// Before the fix the tunnel connect timed out at undici's 10s default.
		assert.ok(Date.now() - started >= 12_000, `tunnel delay must be waited out, took ${Date.now() - started}ms`);
		assert.deepEqual(result.models.map((model) => model.id), ['proxy-mini', 'proxy-max']);
		assert.equal(proxy.events.length, 1);
	} finally {
		models.server.close();
		proxy.server.close();
	}
});

test('a DIRECT system-proxy directive reaches the provider through the real network stack', async () => {
	const { configureProviderNetwork, runWithProviderNetwork } = await import('../packages/agent/src/providerNetwork.ts');
	const { discoverProviderModels } = await import('../packages/agent/src/providerDiscovery.ts');
	const models = modelsServer();
	const address = await listen(models.server);
	configureProviderNetwork(async () => 'DIRECT');
	try {
		const result = await runWithProviderNetwork(true, () => discoverProviderModels({
			baseUrl: `http://127.0.0.1:${address.port}/v1`, api: 'openai-completions', apiKey: 'direct-test-key',
		}));
		assert.equal(result.models.length, 2);
		assert.equal(models.requests[0].authorization, 'Bearer direct-test-key');
	} finally {
		models.server.close();
	}
});

test('a SOCKS system proxy is rejected with an explicit message instead of silently connecting', async () => {
	const { configureProviderNetwork, runWithProviderNetwork } = await import('../packages/agent/src/providerNetwork.ts');
	const { discoverProviderModels } = await import('../packages/agent/src/providerDiscovery.ts');
	configureProviderNetwork(async () => 'SOCKS5 127.0.0.1:1080');
	await assert.rejects(
		runWithProviderNetwork(true, () => discoverProviderModels({ baseUrl: 'http://127.0.0.1:1/v1', api: 'openai-completions' })),
		/SOCKS/,
	);
});

test('agent discovery defaults unconfigured providers to the system proxy and names the failing route', async (t) => {
	const root = mkdtempSync(join(realpathSync.native(tmpdir()), 'pi-desktop-proxy-discovery-'));
	const cwd = join(root, 'workspace');
	const agentDir = join(root, 'agent');
	mkdirSync(cwd); mkdirSync(agentDir);
	const environment = new Map(['PI_CODING_AGENT_DIR', 'PI_OFFLINE'].map((name) => [name, process.env[name]]));
	process.env.PI_CODING_AGENT_DIR = agentDir;
	delete process.env.PI_OFFLINE;
	const models = modelsServer();
	const proxy = tunnelProxy(0);
	const modelsAddress = await listen(models.server);
	const proxyAddress = await listen(proxy.server);
	const modelsUrl = `http://127.0.0.1:${modelsAddress.port}/v1`;
	const { configureProviderNetwork } = await import('../packages/agent/src/providerNetwork.ts');
	configureProviderNetwork(async () => `PROXY 127.0.0.1:${proxyAddress.port}`);
	const { AgentService } = await import('../packages/agent/src/index.ts');
	let service;
	t.after(async () => {
		try { await service?.dispose(); } catch { /* the service may already be disposed */ }
		models.server.close();
		proxy.server.close();
		for (const [name, value] of environment) {
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
		const resolvedRoot = resolve(root);
		if (!resolvedRoot.startsWith(realpathSync.native(tmpdir()) + sep)) throw new Error('Unsafe temporary path');
		rmSync(resolvedRoot, { recursive: true, force: true });
	});
	service = new AgentService(async () => ({ trusted: true, remember: false }), async () => null);
	await service.init({ cwd });
	// No desktopUseSystemProxy preference is saved on purpose: unset keeps the inherited direct route.
	await service.saveCustomProvider({ provider: 'proxy-default', name: 'Proxy Default', baseUrl: modelsUrl, api: 'openai-completions', mode: 'create', models: [{ id: 'existing-model' }] });

	const result = await service.discoverProviderModels({ provider: 'proxy-default' });
	assert.equal(result.models.length, 2);
	assert.equal(proxy.events.length, 0, 'providers without a proxy preference keep the inherited direct route');

	const drafted = await service.discoverProviderModels({ baseUrl: modelsUrl, api: 'openai-completions', apiKey: 'draft-key', useSystemProxy: true });
	assert.equal(drafted.models.length, 2);
	assert.equal(models.requests.length, 2, 'an explicit system-proxy draft routes through the tunnel');

	await assert.rejects(
		service.discoverProviderModels({ provider: 'proxy-default', baseUrl: 'http://127.0.0.1:9/v1', api: 'openai-completions', apiKey: 'moved-key', useSystemProxy: true }),
		(error) => error instanceof Error && error.message.includes('系统代理') && error.message.includes('使用系统代理'),
		'a proxied failure must point at the system proxy and offer the direct alternative',
	);

	configureProviderNetwork(async () => 'DIRECT');
	await assert.rejects(
		service.discoverProviderModels({ provider: 'proxy-default', baseUrl: 'http://127.0.0.1:9/v1', api: 'openai-completions', apiKey: 'moved-key', useSystemProxy: true }),
		(error) => error instanceof Error && error.message.includes('直连') && error.message.includes('使用系统代理'),
		'a direct failure must name the direct route and suggest the system proxy',
	);
});
