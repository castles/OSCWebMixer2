# Desk adapter layer

OSCWebMixer controls a DiGiCo console over OSC, but the OSC dialect differs by
console family. This layer isolates that difference so the rest of the server
speaks one neutral vocabulary.

| | SD / Quantum ("DiGiCo iPad") | S-Series (S21 / S31) |
|---|---|---|
| Address scheme | `/Input_Channels/{ch}/Aux_Send/{aux}/send_level` | `/channel/{ch}/send/{send}/level` |
| Read current values | query any address with a `/?` suffix (incremental) | send `/console/resend`, the desk dumps everything at once |
| Send level units | dB | dB (−90…10) |
| Send pan | 0…1 | −1…1 |
| Aux identity | a bus; mono/stereo from `/Console/Aux_Outputs/modes` | a *channel* (name) **and** a separate *send* bus (routing); stereo is not reported |
| Keepalive | `/Console/Session/!` on session change | `/console/ping` → reply `/console/pong` |

`sdAdapter.js` is a straight extraction of what used to be inlined in `index.js`,
so SD/Quantum behaviour is unchanged. `sAdapter.js` is new and modelled on
[issue #4](https://github.com/castles/OSCWebMixer2/issues/4) + the v1
[S-mapping](https://github.com/castles/OSCWebMixer/blob/main/mapping/S-mapping.mjs);
unconfirmed guesses are marked `UNVERIFIED` in the source.

## Interface

```js
const { createDeskAdapter } = require("./lib/desk/deskAdapter.js");

// config.desk = { type: "SD" }                       (default)
// config.desk = { type: "S", auxes: [ {channel, send, stereo}, ... ] }
const desk = createDeskAdapter(config.desk);

desk.type            // "SD" | "S"
desk.loadStyle       // "incremental" | "bulk"

desk.initialEvents()          // DeskEvent[]  - facts from config, not the desk
desk.bulkLoadRequest()        // OscMessage | null   (S: /console/resend)
desk.buildQuery(loadRequest)  // OscMessage | null   (SD only)
desk.parseIncoming(oscMsg)    // DeskEvent[]         (0+ neutral events)
desk.buildCommand(deskCommand)// OscMessage | null
desk.autoReply(deskEvent)     // OscMessage | null   (S: pong for ping)
```

`OscMessage` is osc.js's `{ address, args }`.

### Neutral events (`parseIncoming` → )

```
{ type: "channelCount",  count }
{ type: "channelName",   channel, name }
{ type: "auxName",       aux, name }          // aux is 1-based
{ type: "auxModes",      modes }              // [1|2, ...]  1 = mono, 2 = stereo
{ type: "sendLevel",     channel, aux, db }
{ type: "sendPan",       channel, aux, pan }  // 0..1 (0 left, 0.5 centre, 1 right)
{ type: "snapshotIndex", index }
{ type: "snapshotName",  index, name }
{ type: "sessionReset" }
{ type: "keepAlivePing" }
```

### Neutral commands (`buildCommand` ← )

```
{ type: "setSendLevel",   channel, aux, db }
{ type: "setSendPan",     channel, aux, pan }   // 0..1
{ type: "setChannelName", channel, name }
{ type: "setAuxName",     aux, name }
{ type: "recallSnapshot", index }
```

### Load requests (`buildQuery` ← , SD only)

```
{ kind: "channelCount" }
{ kind: "auxModes" }
{ kind: "auxName",     aux }
{ kind: "channelName", channel }
{ kind: "sendLevel",   channel, aux }
{ kind: "sendPan",     channel, aux }
{ kind: "snapshot" }
```

## Wiring it into `index.js` (not done yet)

This module is standalone and tested; the server still talks raw SD OSC. To
adopt it:

1. `const desk = createDeskAdapter(config.desk);` after loading config.
2. **Inbound UDP**: replace the address matching in the `udpPort.on("message")`
   handler with `desk.parseIncoming(oscMsg)`. For each event: update the cache
   (key it by the neutral shape, e.g. `sendLevel:{ch}:{aux}`), send
   `desk.autoReply(event)` if non-null, and forward the event to WebSocket
   clients.
3. **Loading**:
   - `desk.loadStyle === "incremental"` (SD): keep the current
     "ask for the next missing thing" loop, but get the address from
     `desk.buildQuery(request)` instead of hard-coding it.
   - `desk.loadStyle === "bulk"` (S): send `desk.bulkLoadRequest()` once, apply
     `desk.initialEvents()`, then treat loading as complete when no new event
     has arrived for ~1.5 s (the S-Series does not ack per value, and withholds
     initial values for sends > 15 without the channel-count upgrade — see the
     mock's `--missing-high-sends`).
4. **Outbound**: the WebSocket protocol becomes neutral JSON
   (`{ type, channel, aux, value }`); the server turns each into
   `desk.buildCommand(cmd)` for the desk. `web/mixer.js` sends neutral messages
   instead of raw SD addresses (rebuild `mixer.min.js`).
5. **Admin UI**: a `desk.type` selector on Global Settings; when `S`, a
   `send #` field + `stereo` toggle per aux on the Auxiliaries tab, persisted in
   the global config.

Test against hardware (or `npm run mock-desk` / `npm run mock-desk-s`) at each
step.
