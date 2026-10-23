// Stand-in for "electrobun/view" when the webview runs in a plain browser (see server.ts).
// Requests become POST /rpc/<name>, messages arrive over Server-Sent Events from /events.

type Handlers = { messages?: Record<string, (payload: any) => void> };

export class Electroview {
	static defineRPC<_Schema>(config: { handlers: Handlers }) {
		const events = new EventSource("/events");
		events.onmessage = (event) => {
			const { name, payload } = JSON.parse(event.data);
			config.handlers.messages?.[name]?.(payload);
		};
		const request = new Proxy(
			{},
			{
				get: (_, name: string) => async (params: unknown) => {
					const res = await fetch(`/rpc/${name}`, { method: "POST", body: JSON.stringify(params ?? {}) });
					if (!res.ok) throw new Error(`${name}: ${res.status} ${await res.text()}`);
					return res.json();
				},
			},
		);
		return { request, send: {} } as any;
	}

	constructor(_options: unknown) {}
}

export default { Electroview };
