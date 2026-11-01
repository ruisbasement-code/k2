import { describe, it, expect, afterEach } from 'vitest';
import { createServer } from 'node:http';
import WebSocket from 'ws';
import { Relay } from '../server/relay.js';

let server, relay;
afterEach(() => { relay?.close(); server?.close(); });

async function start() {
  relay = new Relay(['ABCD']);
  server = createServer();
  relay.attach(server);
  await new Promise((r) => server.listen(0, r));
  return `ws://localhost:${server.address().port}/mp`;
}

/** A player: connects, says hello and collects every message. */
function player(url, hello) {
  const ws = new WebSocket(url);
  const got = [];
  const waiters = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    got.push(m);
    for (const w of waiters.splice(0)) w();
  });
  ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', ...hello })));
  const next = async (pred) => {
    for (;;) {
      const m = got.find(pred);
      if (m) { got.splice(got.indexOf(m), 1); return m; }
      await new Promise((r) => waiters.push(r));
    }
  };
  return { ws, next, send: (data, to) => ws.send(JSON.stringify({ t: 'send', data, to })) };
}

describe('multiplayer relay', () => {
  it('turns away a wrong join code', async () => {
    const url = await start();
    const a = player(url, { name: 'Rui', room: 'ZZZZ' });
    expect((await a.next((m) => m.t === 'error')).why).toMatch(/No game/);
    a.ws.close();
  });

  it('puts players with the code in one room, shares the first one\'s world and passes messages on', async () => {
    const url = await start();
    const a = player(url, { name: 'Rui', room: 'abcd', world: { seed: 42, start: 18000, time: 18000 } });
    const wa = await a.next((m) => m.t === 'welcome');
    expect(wa.room).toBe('ABCD');
    a.send({ k: 'state', ms: 20000 });
    await new Promise((r) => setTimeout(r, 30));
    const b = player(url, { name: 'Rui', room: 'AB-CD', world: { seed: 7, start: 0, time: 0 } });
    const wb = await b.next((m) => m.t === 'welcome');
    // Same name: told apart. Same weather and clock as the first player.
    expect(wb.name).toBe('Rui 2');
    expect(wb.world).toEqual({ seed: 42, start: 18000, time: 20000 });
    expect(wb.players).toEqual([{ id: wa.id, name: 'Rui' }]);
    expect((await a.next((m) => m.t === 'joined')).name).toBe('Rui 2');
    // To everyone, and to one player.
    b.send({ k: 'chat', text: 'hi' });
    expect((await a.next((m) => m.t === 'msg')).data).toEqual({ k: 'chat', text: 'hi' });
    a.send({ k: 'help', help: { act: 'revive' } }, wb.id);
    const h = await b.next((m) => m.t === 'msg');
    expect(h.from).toBe(wa.id);
    expect(h.data.help.act).toBe('revive');
    b.ws.close();
    expect((await a.next((m) => m.t === 'left')).id).toBe(wb.id);
    a.ws.close();
  });
});
