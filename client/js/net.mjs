// WebSocket client with typed message handlers and clock sync.
export class Net {
  constructor() {
    this.ws = null;
    this.handlers = new Map();
    this.connected = false;
    this.serverOffset = 0;   // serverTime - clientTime (ms)
    this.rtt = 0;
    this.queue = [];
    this.pingTimer = null;
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
    return () => this.handlers.get(type).delete(fn);
  }

  emit(type, msg) {
    const set = this.handlers.get(type);
    if (set) for (const fn of set) { try { fn(msg); } catch (e) { console.error('handler error', type, (e && e.stack) || e); } }
  }

  connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      ws.onopen = () => {
        this.connected = true;
        for (const m of this.queue) ws.send(JSON.stringify(m));
        this.queue.length = 0;
        this.pingTimer = setInterval(() => this.send({ t: 'ping', c: performance.now() }), 2000);
        this.emit('open', {});
        resolve();
      };
      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch (e) { return; }
        if (msg.t === 'pong') {
          const now = performance.now();
          this.rtt = now - msg.c;
          this.serverOffset = msg.st - (Date.now() - this.rtt / 2);
          return;
        }
        this.emit(msg.t, msg);
      };
      ws.onclose = () => {
        const was = this.connected;
        this.connected = false;
        clearInterval(this.pingTimer);
        this.emit('close', {});
        if (!was) reject(new Error('connection failed'));
      };
      ws.onerror = () => { /* onclose follows */ };
    });
  }

  send(obj) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
    else if (!this.ws || this.ws.readyState === 0) this.queue.push(obj);
  }

  close() {
    if (this.ws) this.ws.close();
  }
}
