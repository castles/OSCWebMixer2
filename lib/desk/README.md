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

## How `index.js` uses it

`deskConnection.js` wraps the adapter, the osc.js UDP port and the load state
machine. `index.js` creates one connection and keeps everything else
(the address-keyed `cache`, `buildConfig()`, the WebSocket protocol, the HTTP
routes) working on the **SD-shaped internal representation** - the adapter's
`serializeEvent()` turns every neutral event back into that shape on the way in,
and `sendToDesk()` turns it into the desk's dialect on the way out.

- **Inbound**: `deskConnection` runs `parseIncoming` -> `autoReply` (S pong) ->
  `serializeEvent`, then calls `onInbound(sdShapedMsg)`. For SD, anything the
  adapter does not model is passed through untouched, so SD behaviour is
  unchanged; for S, unrecognised messages are dropped.
- **Loading**: `beginLoad()` branches on `deskConn.loadStyle`. Incremental (SD)
  keeps the "ask for the next missing thing" loop, getting each address from
  `deskConn.query(request)`. Bulk (S) sends `deskConn.bulkLoadRequest()`, seeds
  `deskConn.initialEvents()` (synthetic aux modes), and finishes when the
  `/console/resend` dump stops arriving for ~1.5 s - the S-Series does not ack
  per value and withholds initial values for sends > 15 without the channel-count
  upgrade (see the mock's `--missing-high-sends`).
- **Outbound**: `broadcast()`'s desk send goes through `deskConn.sendToDesk()`,
  which translates the SD-shaped message. The WebSocket protocol and
  `web/mixer.js` are unchanged - the client still speaks SD, the connection
  translates.

## Configuring an S-Series desk

In `config/global.json`:

```json
"desk": {
  "ip": "10.0.0.5",
  "port": 8000,
  "type": "S",
  "auxes": [
    { "channel": 70, "send": 1, "stereo": true },
    { "channel": 71, "send": 2, "stereo": false }
  ]
}
```

Both `type` and the `auxes` mapping can also be set from the admin **Global
Settings** tab: pick the console type, then fill in the **S-Series Aux Routing**
rows (one per aux, in order, with its master channel number and send-bus number).
Run `node . debug` (or `npm run mock-desk-s`, which prints a ready-to-paste
mapping) and move faders on the console to find the right numbers, as with v1.
The aux *names* are read from the console; you only supply the routing.

## Still to verify against real hardware

- how / whether the S-Series reports the current snapshot and its name
- the exact send-level dB range and taper
- whether `/console/resend` needs to be repeated or paced on a busy console

Test with `npm run mock-desk` / `npm run mock-desk-s` and, when possible, a real
console.
